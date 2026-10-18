import { readProviderListedIds } from './geminiModels.js';
import { requestWithRetry } from '../requestCenter.js';
import { providerHttpError } from './httpError.js';
import { ProviderError } from '../errors.js';
import type {
  LanguageModelProvider,
  RewriteRequest,
  RewriteResult,
  TranslationRequest,
  TranslationResult
} from '../types.js';
import {
  normalizeGeminiResult,
  normalizeGeminiRewriteResult,
  parseJson,
  rewriteSystemInstruction,
  systemInstruction
} from './gemini.js';
import { REWRITE_VARIANT_IDS } from '../rewriteVariants.js';
import { requestStructuredJson } from './structuredJsonTransport.js';
import type { CompatibleProvider } from './openAICompatible.js';
import type { LanguageModelRoutingEffort } from '../languageModelRouting.js';

/** Shares OpenAI's feature schemas and local normalizers without changing its wire format. */
export class CompatibleLanguageModelProvider implements LanguageModelProvider {
  public constructor(public readonly id: CompatibleProvider, private readonly apiKey: string,
    private readonly model: string, private readonly thinkingOrEffort: LanguageModelRoutingEffort = 'auto',
    private readonly maxAttempts = 3, private readonly accountId?: string) {}

  public async explain(request: TranslationRequest, signal: AbortSignal): Promise<TranslationResult> {
    const value = await this.generate(systemInstruction(request), request.text, 'kren_explanation', explanationSchema(), signal, request.operation === 'translate' ? 'translation' : 'explanation');
    return { ...normalizeGeminiResult(value, request, this.id), modelId: this.model };
  }

  public async rewrite(request: RewriteRequest, signal: AbortSignal): Promise<RewriteResult> {
    const value = await this.generate(rewriteSystemInstruction(request), request.text, 'kren_rewrite', rewriteSchema(request), signal);
    return { ...normalizeGeminiRewriteResult(value, request, this.id), modelId: this.model };
  }

  private async generate(instruction: string, input: string, schemaName: string, schema: Record<string, unknown>, signal: AbortSignal, feature = schemaName.replace(/^kren_/u, '')): Promise<unknown> {
    return requestStructuredJson({ provider: this.id, apiKey: this.apiKey, accountId: this.accountId,
      model: this.model, thinkingOrEffort: this.thinkingOrEffort, schemaName, schema, feature }, { instruction, input }, signal, fetch, this.maxAttempts,
      text => parseJson(text, this.id === 'groq' ? 'Groq' : 'Cloudflare'));
  }
}

export type OpenAIReasoningEffort = 'auto' | 'none' | 'low' | 'medium' | 'high';

interface OpenAIResponse {
  output?: Array<{
    type?: unknown;
    content?: Array<{ type?: unknown; text?: unknown; refusal?: unknown }>;
  }>;
  error?: { message?: unknown };
}
export interface LanguageModelOption {
  id: string;
  displayName: string;
}

export class OpenAIProvider implements LanguageModelProvider {
  public readonly id = 'openai' as const;

  public constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly reasoningEffort: OpenAIReasoningEffort = 'auto',
    private readonly maxAttempts = 3
  ) {}

  public async explain(
    request: TranslationRequest,
    signal: AbortSignal
  ): Promise<TranslationResult> {
    const value = await this.generate(
      systemInstruction(request),
      request.text,
      'kren_explanation',
      explanationSchema(),
      signal, request.operation === 'translate' ? 'translation' : 'explanation'
    );
    return normalizeGeminiResult(value, request, this.id);
  }

  public async rewrite(
    request: RewriteRequest,
    signal: AbortSignal
  ): Promise<RewriteResult> {
    const value = await this.generate(
      rewriteSystemInstruction(request),
      request.text,
      'kren_rewrite',
      rewriteSchema(request),
      signal
    );
    return {
      ...normalizeGeminiRewriteResult(value, request, this.id),
      modelId: this.model
    };
  }

  private async generate(
    instructions: string,
    text: string,
    schemaName: string,
    schema: Record<string, unknown>,
    signal: AbortSignal,
    feature = schemaName.replace(/^kren_/u, '')
  ): Promise<unknown> {
    const body = JSON.stringify(buildOpenAIRequestBody(
      this.model,
      instructions,
      text,
      schemaName,
      schema,
      this.reasoningEffort
    ));
    return requestWithRetry({
      request: { feature, provider: this.id, model: this.model }, signal, maxAttempts: boundedAttempts(this.maxAttempts),
      send: () => fetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` }, body, signal
      }),
      failure: ({ status, retryable }) => new ProviderError(status === undefined ? 'OpenAI API could not be reached.'
        : providerHttpError('OpenAI', status), status === 401 || status === 403 ? 'setOpenAIKey' : 'configureOpenAIModel', retryable, status),
      refused: () => new ProviderError('OpenAI declined the request.', undefined, false, undefined, 'refused'),
      decode: envelope => {
        const raw = openAIOutputText((envelope ?? {}) as OpenAIResponse);
        if (!raw) throw new ProviderError('OpenAI returned no usable text output.', undefined, false, undefined, 'structuredOutput');
        return parseJson(raw, 'OpenAI');
      }
    });
  }
}

export function buildOpenAIRequestBody(
  model: string,
  instructions: string,
  text: string,
  schemaName: string,
  schema: Record<string, unknown>,
  reasoningEffort: OpenAIReasoningEffort = 'auto'
): Record<string, unknown> {
  return {
    model,
    instructions,
    input: [{
      role: 'user',
      content: [{ type: 'input_text', text }]
    }],
    store: false,
    max_output_tokens: 4096,
    text: {
      format: {
        type: 'json_schema',
        name: schemaName,
        strict: true,
        schema
      }
    },
    ...(reasoningEffort === 'auto' ? {} : { reasoning: { effort: reasoningEffort } })
  };
}

export async function listOpenAIModels(
  apiKey: string,
  signal: AbortSignal
): Promise<LanguageModelOption[]> {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal
  });
  const payload = await response.json().catch(() => ({})) as {
    data?: Array<{ id?: unknown }>;
    error?: { message?: unknown };
  };
  if (!response.ok) {
    throw new ProviderError(
      providerHttpError('OpenAI', response.status),
      response.status === 401 || response.status === 403 ? 'setOpenAIKey' : 'configureOpenAIModel'
    );
  }
  return (payload.data ?? [])
    .map((item) => typeof item.id === 'string' ? item.id : '')
    .filter((id) => /^(?:gpt-|o\d)/u.test(id))
    .sort((left, right) => left.localeCompare(right))
    .map((id) => ({ id, displayName: id }));
}

/** Availability checks do not apply the picker's chat-family filter. */
export async function listOpenAIModelsUnfiltered(apiKey: string, signal: AbortSignal): Promise<Array<{ id: string }>> {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` }, signal
  });
  if (!response.ok) throw new ProviderError(providerHttpError('OpenAI', response.status),
    response.status === 401 || response.status === 403 ? 'setOpenAIKey' : 'configureOpenAIModel');
  return readProviderListedIds(response, 'data');
}

function openAIOutputText(payload: OpenAIResponse): string | undefined {
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'refusal' && typeof content.refusal === 'string') {
        throw new ProviderError('OpenAI declined the request.', undefined, false, undefined, 'refused');
      }
      if (content.type === 'output_text' && typeof content.text === 'string' && content.text.trim()) {
        return content.text.trim();
      }
    }
  }
  return undefined;
}

export function explanationSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'translatedText', 'alternatives', 'note'],
    properties: {
      kind: { type: 'string', enum: ['translation'] },
      translatedText: { type: 'string' },
      alternatives: { type: 'array', items: { type: 'string' }, maxItems: 3 },
      note: { type: 'string' }
    }
  };
}

export function rewriteSchema(request: RewriteRequest): Record<string, unknown> {
  const includeChangeNotes = request.includeChangeNotes === true;
  const variantProperties: Record<string, unknown> = {
    id: { type: 'string', enum: REWRITE_VARIANT_IDS },
    label: { type: 'string' },
    text: { type: 'string' }
  };
  if (includeChangeNotes) variantProperties.changeNote = { type: 'string' };
  const count = request.operation === 'rewrite' ? REWRITE_VARIANT_IDS.length : 1;
  return {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'detectedLanguage', 'variants'],
    properties: {
      kind: { type: 'string', enum: ['rewrite'] },
      detectedLanguage: { type: 'string' },
      variants: {
        type: 'array',
        minItems: count,
        maxItems: count,
        items: {
          type: 'object',
          additionalProperties: false,
          required: includeChangeNotes ? ['id', 'label', 'text', 'changeNote'] : ['id', 'label', 'text'],
          properties: variantProperties
        }
      }
    }
  };
}

function boundedAttempts(value: number): number {
  return Math.max(1, Math.min(5, Number.isFinite(value) ? Math.floor(value) : 3));
}
