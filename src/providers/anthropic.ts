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
      rewriteSchema(request),
      signal
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
    signal: AbortSignal
  ): Promise<unknown> {
    const body = JSON.stringify(buildAnthropicRequestBody(
      this.model,
      system,
      text,
      schema,
      this.effort
    ));
    const attempts = Math.max(1, Math.min(5, Math.floor(this.maxAttempts || 3)));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01'
          },
          body,
          signal
        });
      } catch (error) {
        if (signal.aborted) throw error;
        if (attempt < attempts - 1) {
          await waitForRetry(1000 * 2 ** attempt, signal);
          continue;
        }
        throw new ProviderError('Anthropic API could not be reached.', 'configureAnthropicModel', true);
      }
      const payload = (await response.json().catch(() => ({}))) as AnthropicResponse;
      if (!response.ok) {
        const detail = typeof payload.error?.message === 'string' ? ` ${payload.error.message}` : '';
        if (retryableStatus(response.status) && attempt < attempts - 1) {
          await waitForRetry(retryDelayMs(attempt, response.headers.get('retry-after')), signal);
          continue;
        }
        const action = response.status === 401 || response.status === 403
          ? 'setAnthropicKey' as const
          : 'configureAnthropicModel' as const;
        throw new ProviderError(
          `Anthropic request failed (${response.status}).${detail}`,
          action,
          retryableStatus(response.status),
          response.status
        );
      }
      const raw = payload.content
        ?.find((block) => block.type === 'text' && typeof block.text === 'string')?.text;
      if (typeof raw !== 'string' || !raw.trim()) {
        throw new ProviderError('Anthropic returned no usable text output.');
      }
      return parseJson(raw.trim(), 'Anthropic');
    }
    throw new ProviderError('Anthropic request failed after retries.', undefined, true);
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
    const detail = typeof payload.error?.message === 'string' ? ` ${payload.error.message}` : '';
    throw new ProviderError(
      `Anthropic model discovery failed (${response.status}).${detail}`,
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
