import { missingCredentialError } from '../requestCenter.js';
import { buildCompatibleRequestBody, strictSchema, validatedCompatibleText as readCompatibleText, ProviderResponseError } from '@kren/core/provider-requests';
export { strictSchema };
import { usageTrackedFetch } from '../languageModelUsage.js';
import { normalizeGeminiModel, readProviderListedIds } from './geminiModels.js';

import { ProviderError } from '../errors.js';
import { providerHttpError } from './httpError.js';

import type { LanguageModelRoutingEffort } from '../languageModelRouting.js';
import { isLanguageModelRoutingProvider } from '../languageModelRouting.js';
import { tutorModeModel } from '../tutor/models.js';

// Owner rule 2026-10-15: only models of the gpt-oss-120b / qwen3.8-27b class or larger.
export const GROQ_MODELS = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b'];
export const CLOUDFLARE_TEXT_MODELS = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct',
  '@cf/meta/llama-3-8b-instruct', '@hf/nousresearch/hermes-2-pro-mistral-7b',
  '@hf/thebloke/deepseek-coder-6.7b-instruct-awq', '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'
];
export function routedModel(provider: string, model: string): string {
  // 2026-10-12: panel controls and every feature share the tutor's ownership check.
  const resolved = isLanguageModelRoutingProvider(provider) ? tutorModeModel(provider, 'thorough', model) : model;
  return provider === 'gemini' ? normalizeGeminiModel(resolved) : resolved;
}

export type CompatibleProvider = 'groq' | 'cloudflare';
export const compatibleProviderName = (provider: CompatibleProvider): string => provider === 'groq' ? 'Groq' : 'Cloudflare';
export const compatibleDefaultModel = (provider: CompatibleProvider): string =>
  (provider === 'groq' ? GROQ_MODELS : CLOUDFLARE_TEXT_MODELS)[0]!;

/** Host-owned endpoints prevent a credential from being routed to another provider. */
export function compatibleBaseUrl(provider: CompatibleProvider, accountId?: string): string {
  if (provider === 'groq') return 'https://api.groq.com/openai/v1';
  if (!accountId) throw new ProviderError('Set the Cloudflare account ID and API token in KREN menu, Credentials.', 'setCloudflareCredentials');
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1`;
}

export interface CompatibleCall {
  provider: CompatibleProvider;
  apiKey: string;
  accountId?: string;
  model: string;
  thinkingOrEffort: LanguageModelRoutingEffort;
  schema: Record<string, unknown>;
  schemaName: string;
}

/** One Chat Completions request shape, with provider-specific schema capabilities. */
export function compatibleRequestInit(call: CompatibleCall, instruction: string, input: string, signal: AbortSignal): RequestInit {
 const { provider, model, thinkingOrEffort, schema, schemaName } = call;
 return { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${call.apiKey}` }, signal,
  body: JSON.stringify(buildCompatibleRequestBody({ provider, model, thinkingOrEffort, schema, schemaName }, instruction, input)) };
}

/** Optional properties become required nullable properties only on the wire. */

export function compatibleFailure(provider: CompatibleProvider, reason: 'structuredOutput' | 'refused' = 'structuredOutput'): ProviderError {
  return new ProviderError(`${compatibleProviderName(provider)} returned invalid structured output. Try again.`,
    provider === 'groq' ? 'configureGroqModel' : 'configureCloudflareModel', false, undefined, reason);
}

/** The provider's promise never replaces local validation and feature validators. */
export function validatedCompatibleText(call: Pick<CompatibleCall, 'provider' | 'schema' | 'model'> & { batchEnvelope?: boolean }, envelope: unknown): string {
 try { return readCompatibleText({ provider: call.provider, model: call.model, schema: call.schema, batchEnvelope: call.batchEnvelope }, envelope); }
 catch (error) {
  if (error instanceof ProviderResponseError) throw compatibleFailure(call.provider, error.reason);
  throw error;
 }
}

export interface GroqRequestLimits {
  limit?: number;
  remaining?: number;
}

export async function listGroqModels(apiKey: string, signal: AbortSignal, limits?: GroqRequestLimits): Promise<Array<{ id: string; displayName: string }>> {
  let response: Response;
  try {
    response = await fetch(`${compatibleBaseUrl('groq')}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal });
  } catch { throw new ProviderError('Groq model discovery could not be reached.', 'configureGroqModel'); }
  if (!response.ok) throw new ProviderError(providerHttpError('Groq', response.status), 'setGroqKey', false, response.status);
  if (limits) {
    // Only numeric headers can reach a notice. Discovery itself remains one request.
    const limit = response.headers.get('x-ratelimit-limit-requests');
    const remaining = response.headers.get('x-ratelimit-remaining-requests');
    if (limit !== null && remaining !== null && /^\d+$/.test(limit) && /^\d+$/.test(remaining) &&
        Number.isSafeInteger(Number(limit)) && Number.isSafeInteger(Number(remaining)) && Number(remaining) <= Number(limit)) {
      limits.limit = Number(limit);
      limits.remaining = Number(remaining);
    }
  }
  const payload = await response.json().catch(() => ({})) as { data?: Array<{ id?: unknown; active?: unknown }> };
  return (payload.data ?? []).flatMap(item => item.active !== false && typeof item.id === 'string' && GROQ_MODELS.includes(item.id) && item.id !== apiKey
    ? [{ id: item.id, displayName: item.id }] : []).sort((a, b) => a.id.localeCompare(b.id));
}

/** Availability checks need every advertised id, independently of picker policy. */
export async function listGroqModelsUnfiltered(apiKey: string, signal: AbortSignal): Promise<Array<{ id: string }>> {
  let response: Response;
  try {
    response = await fetch(`${compatibleBaseUrl('groq')}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal });
  } catch { throw new ProviderError('Groq model discovery could not be reached.', 'configureGroqModel'); }
  if (!response.ok) throw new ProviderError(providerHttpError('Groq', response.status), 'setGroqKey', false, response.status);
  return readProviderListedIds(response, 'data');
}

export async function transcribeGroqAudio(apiKey: string, audio: Uint8Array, signal: AbortSignal): Promise<string> {
  if (!apiKey) throw missingCredentialError('groq');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'dictation.wav');
  form.append('model', 'whisper-large-v3-turbo');
  form.append('response_format', 'json');
  let response: Response;
  try { response = await usageTrackedFetch({ feature: 'dictation', provider: 'groq', model: 'whisper-large-v3-turbo' })(`${compatibleBaseUrl('groq')}/audio/transcriptions`, {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal
  }); } catch { throw new ProviderError('Groq dictation service could not be reached.'); }
  if (!response.ok) throw new ProviderError(providerHttpError('Groq', response.status), 'setGroqKey', false, response.status);
  const payload = await response.json().catch(() => undefined) as { text?: unknown } | undefined;
  if (typeof payload?.text !== 'string' || !payload.text.trim()) throw new ProviderError('Groq returned an empty transcript.');
  return payload.text.trim();
}
