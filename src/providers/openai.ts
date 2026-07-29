import { ProviderError } from '../errors.js';
import {
  isRetryableLanguageModelStatus as retryableStatus,
  retryDelayMs,
  waitForRetry
} from '@kren/core/retry';
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
      signal
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
    signal: AbortSignal
  ): Promise<unknown> {
    const body = JSON.stringify(buildOpenAIRequestBody(
      this.model,
      instructions,
      text,
      schemaName,
      schema,
      this.reasoningEffort
    ));
    const attempts = boundedAttempts(this.maxAttempts);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`
          },
          body,
          signal
        });
      } catch (error) {
        if (signal.aborted) throw error;
        if (attempt < attempts - 1) {
          await waitForRetry(retryDelayMs(attempt), signal);
          continue;
        }
        throw new ProviderError('OpenAI API could not be reached.', 'configureOpenAIModel', true);
      }
      const payload = (await response.json().catch(() => ({}))) as OpenAIResponse;
      if (!response.ok) {
        const detail = typeof payload.error?.message === 'string' ? ` ${payload.error.message}` : '';
        if (retryableStatus(response.status) && attempt < attempts - 1) {
          await waitForRetry(retryDelayMs(attempt, response.headers.get('retry-after')), signal);
          continue;
        }
        const action = response.status === 401 || response.status === 403
          ? 'setOpenAIKey' as const
          : 'configureOpenAIModel' as const;
        throw new ProviderError(
          `OpenAI request failed (${response.status}).${detail}`,
          action,
          retryableStatus(response.status),
          response.status
        );
      }
      const raw = openAIOutputText(payload);
      if (!raw) throw new ProviderError('OpenAI returned no usable text output.');
      return parseJson(raw, 'OpenAI');
    }
    throw new ProviderError('OpenAI request failed after retries.', undefined, true);
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
    const detail = typeof payload.error?.message === 'string' ? ` ${payload.error.message}` : '';
    throw new ProviderError(
      `OpenAI model discovery failed (${response.status}).${detail}`,
      response.status === 401 || response.status === 403 ? 'setOpenAIKey' : 'configureOpenAIModel'
    );
  }
  return (payload.data ?? [])
    .map((item) => typeof item.id === 'string' ? item.id : '')
    .filter((id) => /^(?:gpt-|o\d)/u.test(id))
    .sort((left, right) => left.localeCompare(right))
    .map((id) => ({ id, displayName: id }));
}

function openAIOutputText(payload: OpenAIResponse): string | undefined {
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'refusal' && typeof content.refusal === 'string') {
        throw new ProviderError(`OpenAI declined the request: ${content.refusal}`);
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
    id: { type: 'string', enum: ['natural', 'concise', 'jargonFree'] },
    label: { type: 'string' },
    text: { type: 'string' }
  };
  if (includeChangeNotes) variantProperties.changeNote = { type: 'string' };
  const count = request.operation === 'rewrite' ? 3 : 1;
  return {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'variants'],
    properties: {
      kind: { type: 'string', enum: ['rewrite'] },
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
