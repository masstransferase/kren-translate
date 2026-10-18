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
import {
  explanationSchema,
  type LanguageModelOption,
  rewriteSchema
} from './openai.js';

export type AnthropicEffort = 'auto' | 'low' | 'medium' | 'high';

interface AnthropicResponse {
  content?: Array<{ type?: unknown; text?: unknown }>;
  error?: { message?: unknown };
}
export class AnthropicProvider implements LanguageModelProvider {
  public readonly id = 'anthropic' as const;

  public constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly effort: AnthropicEffort = 'low',
    private readonly maxAttempts = 3
  ) {}

  public async explain(
    request: TranslationRequest,
    signal: AbortSignal
  ): Promise<TranslationResult> {
    const value = await this.generate(
      systemInstruction(request),
      request.text,
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
      rewriteSchema(request),
      signal, 'rewrite'
    );
    return {
      ...normalizeGeminiRewriteResult(value, request, this.id),
      modelId: this.model
    };
  }

  private async generate(
    system: string,
    text: string,
    schema: Record<string, unknown>,
    signal: AbortSignal,
    feature: string
  ): Promise<unknown> {
    const body = JSON.stringify(buildAnthropicRequestBody(
      this.model,
      system,
      text,
      schema,
      this.effort
    ));
    return requestWithRetry({
      request: { feature, provider: this.id, model: this.model }, signal,
      maxAttempts: Math.max(1, Math.min(5, Math.floor(this.maxAttempts || 3))),
      send: () => fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' }, body, signal
      }),
      failure: ({ status, retryable }) => new ProviderError(status === undefined ? 'Anthropic API could not be reached.'
        : providerHttpError('Anthropic', status), status === 401 || status === 403 ? 'setAnthropicKey' : 'configureAnthropicModel', retryable, status),
      refused: () => new ProviderError('Anthropic returned no usable text output.', undefined, false, undefined, 'refused'),
      decode: envelope => {
        const payload = (envelope ?? {}) as AnthropicResponse;
        const raw = payload.content?.find(block => block.type === 'text' && typeof block.text === 'string')?.text;
        if (typeof raw !== 'string' || !raw.trim()) throw new ProviderError('Anthropic returned no usable text output.', undefined, false, undefined, 'structuredOutput');
        return parseJson(raw.trim(), 'Anthropic');
      }
    });
  }
}

export function buildAnthropicRequestBody(
  model: string,
  system: string,
  text: string,
  schema: Record<string, unknown>,
  effort: AnthropicEffort = 'low'
): Record<string, unknown> {
  return {
    model,
    max_tokens: 4096,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text }] }],
    output_config: {
      format: { type: 'json_schema', schema },
      ...(effort === 'auto' ? {} : { effort })
    }
  };
}

export async function listAnthropicModels(
  apiKey: string,
  signal: AbortSignal
): Promise<LanguageModelOption[]> {
  const response = await fetch('https://api.anthropic.com/v1/models?limit=1000', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    signal
  });
  const payload = await response.json().catch(() => ({})) as {
    data?: Array<{ id?: unknown; display_name?: unknown }>;
    error?: { message?: unknown };
  };
  if (!response.ok) {
    throw new ProviderError(
      providerHttpError('Anthropic', response.status),
      response.status === 401 || response.status === 403
        ? 'setAnthropicKey'
        : 'configureAnthropicModel'
    );
  }
  return (payload.data ?? [])
    .flatMap((item) => typeof item.id === 'string' ? [{
      id: item.id,
      displayName: typeof item.display_name === 'string' ? item.display_name : item.id
    }] : []);
}
/** Preserve picker behavior while rejecting inconclusive availability responses. */
export async function listAnthropicModelsUnfiltered(apiKey: string, signal: AbortSignal): Promise<Array<{ id: string }>> {
  const response = await fetch('https://api.anthropic.com/v1/models?limit=1000', {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, signal
  });
  if (!response.ok) throw new ProviderError(providerHttpError('Anthropic', response.status),
    response.status === 401 || response.status === 403 ? 'setAnthropicKey' : 'configureAnthropicModel');
  return readProviderListedIds(response, 'data');
}
