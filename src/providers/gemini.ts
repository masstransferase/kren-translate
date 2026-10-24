import { classifyGeminiRateLimit } from '@kren/core';
export { classifyGeminiRateLimit, type GeminiQuotaCategory, type GeminiRateLimitClassification } from '@kren/core';
import * as coreRequests from '@kren/core/provider-requests';
import { buildGeminiRewriteRequestBody, buildGeminiRequestBody, thinkingLevelForModel, configuredThinkingLevel, systemInstruction, rewriteSystemInstruction, rewriteOutputViolation, type GeminiThinkingLevel } from '@kren/core/provider-requests';
export { buildGeminiRewriteRequestBody, buildGeminiRequestBody, thinkingLevelForModel, configuredThinkingLevel, systemInstruction, rewriteSystemInstruction, rewriteOutputViolation, type GeminiThinkingLevel };
import { normalizeGeminiModel } from './geminiModels.js';
import { requestWithRetry, classifyRequestStatus } from '../requestCenter.js';
import { usageTrackedFetch, validateLanguageModelOutput } from '../languageModelUsage.js';
import { providerHttpError } from './httpError.js';
import { ProviderError, attributeProviderError } from '../errors.js';

import {
  retryDelayMs as coreRetryDelayMs,
  waitForRetry
} from '@kren/core/retry';
import type {
  RewriteRequest,
  RewriteResult,
  LanguageModelProvider,
  TranslationProvider,
  TranslationRequest,
  TranslationResult
} from '../types.js';

/** Keep host errors and recovery actions outside the shared response reader. */
export function readCoreOutput<T>(read: () => T, emptyAction?: ProviderError['action']): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof coreRequests.ProviderResponseError) {
      throw new ProviderError(error.message, error.code === 'emptyOutput' ? emptyAction : undefined,
        error.retryable, error.status, error.reason);
    }
    throw error;
  }
}

interface GeminiPayload {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown }> };
  }>;
  error?: { message?: unknown; details?: unknown; status?: unknown };
}

export const GEMINI_TRANSCRIPTION_MODEL = 'gemini-3.5-transcribe';

export interface GeminiTranscriptionRequestBody {
  contents: Array<{
    role: 'user';
    parts: Array<{ inlineData: { mimeType: 'audio/wav'; data: string } }>;
  }>;
}

/**
 * The complete transcription request body. It contains the explicit recording and no
 * editor, workspace, tutor, credential, or other provider context.
 */
export function buildGeminiTranscriptionRequestBody(
  audio: Uint8Array
): GeminiTranscriptionRequestBody {
  return {
    contents: [{
      role: 'user',
      parts: [{
        inlineData: {
          mimeType: 'audio/wav',
          data: Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength).toString('base64')
        }
      }]
    }]
  };
}

/**
 * Sends one WAV inline to Google's non-live transcription model and returns only text.
 * Inline media avoids creating a second audio file through Google's Files API.
 */
export async function transcribeGeminiAudio(
  apiKey: string,
  audio: Uint8Array,
  signal: AbortSignal,
  maxAttempts = 4,
  fetcher: typeof fetch = fetch
): Promise<string> {
  if (audio.byteLength === 0) throw new ProviderError('The microphone recording was empty.');
  if (audio.byteLength > 20 * 1024 * 1024) {
    throw new ProviderError('The microphone recording is too large to send inline to Gemini.');
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TRANSCRIPTION_MODEL}:generateContent`;
  const body = JSON.stringify(buildGeminiTranscriptionRequestBody(audio));
  const requestedAttempts = Number.isFinite(maxAttempts) ? maxAttempts : 4;
  const attempts = Math.max(1, Math.min(5, Math.floor(requestedAttempts)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response;
    try {
      response = await usageTrackedFetch({ feature: 'dictation', provider: 'gemini', model: GEMINI_TRANSCRIPTION_MODEL }, fetcher)(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
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
      throw new ProviderError(
        `Gemini transcription could not be reached after ${attempts} ${attempts === 1 ? 'attempt' : 'attempts'}.`,
        'configureGeminiModel',
        true
      );
    }
    const payload = (await response.json().catch(() => ({}))) as GeminiPayload;
    if (!response.ok) {
      if (isRetryableGeminiStatus(response.status, payload) && attempt < attempts - 1) {
        await waitForRetry(
          retryDelayMs(attempt, response.headers.get('retry-after'), payload), signal
        );
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError(
          'Gemini transcription authentication failed. Check the Gemini Free Tier API key.',
          'setGeminiKey',
          false,
          response.status
        );
      }
      throw new ProviderError(
        `Gemini transcription request failed (${response.status}).`,
        'configureGeminiModel',
        isRetryableGeminiStatus(response.status, payload),
        response.status
      );
    }
    const transcript = payload.candidates?.[0]?.content?.parts
      ?.map((part) => typeof part.text === 'string' ? part.text : '')
      .join('')
      .trim();
    if (!transcript) throw new ProviderError('Gemini returned an empty transcript.');
    return transcript;
  }
  throw new ProviderError(`Gemini transcription failed after ${attempts} attempts.`);
}

export class GeminiProvider implements TranslationProvider, LanguageModelProvider {
  public readonly id = 'gemini' as const;

  public constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly modelAction: 'configureGeminiModel' | 'configureGeminiProModel' = 'configureGeminiModel',
    private readonly thinkingLevel?: GeminiThinkingLevel,
    private readonly maxAttempts = 4
  ) {}

  public async translate(
    request: TranslationRequest,
    signal: AbortSignal
  ): Promise<TranslationResult> {
    const value = await this.generate(
      buildGeminiRequestBody(request, this.thinkingLevel ?? thinkingLevelForModel(this.model)),
      signal, request.operation === 'translate' ? 'translation' : 'explanation'
    );
    return {
      ...normalizeGeminiResult(value, request, this.id),
      modelId: normalizeGeminiModel(this.model).replace(/^models\//u, '')
    };
  }

  public async explain(
    request: TranslationRequest,
    signal: AbortSignal
  ): Promise<TranslationResult> {
    return this.translate(request, signal);
  }

  public async rewrite(
    request: RewriteRequest,
    signal: AbortSignal
  ): Promise<RewriteResult> {
    const value = await this.generate(
      buildGeminiRewriteRequestBody(
        request,
        this.thinkingLevel ?? thinkingLevelForModel(this.model)
      ),
      signal, 'rewrite'
    );
    return {
      ...normalizeGeminiRewriteResult(value, request, this.id),
      modelId: normalizeGeminiModel(this.model).replace(/^models\//u, '')
    };
  }

  private async generate(
    requestBody: ReturnType<typeof buildGeminiRequestBody>, signal: AbortSignal, feature: string
  ): Promise<unknown> {
    try { return await this.generateOnce(requestBody, signal, feature); }
    catch (error) { throw attributeProviderError(error, { provider: 'gemini', model: this.model,
      geminiProfile: this.modelAction === 'configureGeminiProModel' ? 'pro' : 'standard' }); }
  }

  private async generateOnce(
    requestBody: ReturnType<typeof buildGeminiRequestBody>,
    signal: AbortSignal,
    feature: string
  ): Promise<unknown> {
    const modelId = normalizeGeminiModel(this.model).replace(/^models\//u, '');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
    const body = JSON.stringify(requestBody);

    const attempts = Number.isFinite(this.maxAttempts) ? this.maxAttempts : 4;
    return requestWithRetry({
      request: { feature, provider: this.id, model: this.model,
        geminiProfile: this.modelAction === 'configureGeminiProModel' ? 'pro' : 'standard' },
      signal, maxAttempts: attempts,
      send: () => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey }, body, signal }),
      failure: ({ cause, status, retryable, envelope, attempts: count }) => {
        if (status === undefined) return new ProviderError(
          `Gemini could not be reached after ${count} ${count === 1 ? 'attempt' : 'attempts'}.`, this.modelAction, true);
        if (status === 404) return new ProviderError(`Gemini model ${this.model} is unavailable (404).`, this.modelAction, false, status);
        if (cause === 'overloaded') return new ProviderError(
          `Gemini model ${this.model} is temporarily overloaded after ${count} ${count === 1 ? 'attempt' : 'attempts'}. KREN ${count > 1 ? 'retried automatically. ' : ''}Try again shortly or choose another Gemini model.`,
          this.modelAction, true, status, 'overloaded');
        if (cause === 'quotaExhausted') return new ProviderError(providerHttpError('Gemini', status) + geminiErrorMetadata(envelope), this.modelAction, false, status, 'quotaExhausted');
        if (retryable) return new ProviderError(
          `Gemini returned a temporary ${status} response after ${count} ${count === 1 ? 'attempt' : 'attempts'}. Try again shortly or choose another Gemini model.`, this.modelAction, true, status);
        return new ProviderError(providerHttpError('Gemini', status));
      },
      refused: () => new ProviderError('Gemini returned no result.', this.modelAction, false, undefined, 'refused'),
      decode: envelope => {
        return readCoreOutput(() => coreRequests.readGeminiFeatureResponse(envelope), this.modelAction);
      }
    });
  }
}

export function isRetryableGeminiStatus(status: number, payload?: unknown): boolean {
  return classifyRequestStatus('gemini', status, payload).retryable;
}

function retryDelayMs(
  attempt: number,
  retryAfter: string | null = null,
  payload?: unknown
): number {
  const googleDelay = payload === undefined
    ? undefined : classifyGeminiRateLimit(payload).retryDelayMs;
  if (googleDelay !== undefined) return googleDelay;
  return coreRetryDelayMs(attempt, retryAfter, {
    baseDelayMs: 1_250,
    jitterMs: 500,
    parseHttpDate: true
  });
}

/** Whitelisted structured diagnostics, never the provider's free-text message or links. */
export function geminiErrorMetadata(payload: unknown): string {
  const { quotaCategory, quotaLimit, retryDelayMs } = classifyGeminiRateLimit(payload);
  const fields = { ...(quotaCategory ? { quotaCategory } : {}), ...(quotaLimit === undefined ? {} : { limit: quotaLimit }), ...(retryDelayMs === undefined ? {} : { retryDelay: `${retryDelayMs / 1000}s` }) };
  return Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : '';
}

export function parseJson(raw: string, providerName = 'Provider'): unknown {
  return readCoreOutput(() => coreRequests.parseJson(raw, providerName));
}

export function normalizeGeminiResult(value: unknown, request: TranslationRequest, providerId: string): TranslationResult {
  return validateLanguageModelOutput(value, () => readCoreOutput(() => coreRequests.normalizeTranslationResult(value, request, providerId, new Date().toISOString())));
}

export function normalizeGeminiRewriteResult(value: unknown, request: RewriteRequest, providerId: string, createdAt = new Date().toISOString()): RewriteResult {
  return validateLanguageModelOutput(value, () => readCoreOutput(() => coreRequests.normalizeRewriteResult(value, request, providerId, createdAt)));
}
