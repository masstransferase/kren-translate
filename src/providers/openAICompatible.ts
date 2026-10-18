import { usageTrackedFetch } from '../languageModelUsage.js';
import { normalizeGeminiModel, readProviderListedIds } from './geminiModels.js';
import { parseStructuredJson } from '@kren/core/structured-json';
import { ProviderError } from '../errors.js';
import { providerHttpError } from './httpError.js';
import { schemaInstruction } from './structuredJsonShape.js';
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
  const strict = call.provider === 'groq' && GROQ_MODELS.includes(call.model);
  const responseFormat = call.provider === 'cloudflare'
    ? { type: 'json_schema', json_schema: call.schema }
    : strict ? { type: 'json_schema', json_schema: { name: call.schemaName, strict: true, schema: strictSchema(call.schema) } }
      : { type: 'json_object' };
  const effort = call.thinkingOrEffort === 'none' || call.thinkingOrEffort === 'minimal' ? 'low' : call.thinkingOrEffort;
  return {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${call.apiKey}` }, signal,
    body: JSON.stringify({
      model: call.model,
      messages: [{ role: 'system', content: `${instruction}\n\n${schemaInstruction(call.schema)}` }, { role: 'user', content: input }],
      max_tokens: 4096, stream: false, response_format: responseFormat,
      ...(call.provider === 'groq' && call.model === 'openai/gpt-oss-120b' && effort !== 'auto'
        ? { reasoning_effort: effort } : {})
    })
  };
}

/** Optional properties become required nullable properties only on the wire. */
export function strictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result = { ...schema };
  if (schema.type === 'object' || Array.isArray(schema.type) && schema.type.includes('object')) {
    result.additionalProperties = false;
    result.required = [];
  }
  if (schema.properties && typeof schema.properties === 'object') {
    const required = Array.isArray(schema.required) ? schema.required : [];
    result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => {
      const child = strictSchema(value as Record<string, unknown>);
      return [key, required.includes(key) ? child : child.type
        ? { ...child, type: [...(Array.isArray(child.type) ? child.type : [child.type]), 'null'],
          ...(Array.isArray(child.enum) ? { enum: [...child.enum, null] } : {}) }
        : { anyOf: [child, { type: 'null' }] }];
    }));
    result.required = Object.keys(schema.properties);
    result.additionalProperties = false;
  }
  if (schema.items && typeof schema.items === 'object') result.items = strictSchema(schema.items as Record<string, unknown>);
  for (const key of ['anyOf', 'oneOf', 'allOf']) if (Array.isArray(schema[key])) result[key] = schema[key].map(item => strictSchema(item));
  return result;
}

export function compatibleFailure(provider: CompatibleProvider, reason: 'structuredOutput' | 'refused' = 'structuredOutput'): ProviderError {
  return new ProviderError(`${compatibleProviderName(provider)} returned invalid structured output. Try again.`,
    provider === 'groq' ? 'configureGroqModel' : 'configureCloudflareModel', false, undefined, reason);
}

/** The provider's promise never replaces local validation and feature validators. */
export function validatedCompatibleText(call: Pick<CompatibleCall, 'provider' | 'schema' | 'model'> & { batchEnvelope?: boolean }, envelope: unknown): string {
  const refusal = (envelope as { choices?: Array<{ message?: { refusal?: unknown } }> } | undefined)?.choices?.[0]?.message?.refusal;
  if (refusal) throw compatibleFailure(call.provider, 'refused');
  try {
    const payload = envelope as { choices?: Array<{ message?: { content?: unknown; refusal?: unknown } }> };
    const message = payload?.choices?.[0]?.message;
    if (message?.refusal || typeof message?.content !== 'string') throw new Error();
    const parsed = parseStructuredJson(message.content);
    const value = call.provider === 'groq' && GROQ_MODELS.includes(call.model)
      ? removeOptionalNulls(parsed, call.schema) : parsed;
    // 2026-10-12: Review all recovers malformed reviews individually after the transport.
    const validationSchema = call.batchEnvelope ? { ...call.schema, properties: {
      ...(call.schema.properties as Record<string, unknown>), reviews: {
        ...((call.schema.properties as Record<string, unknown>)?.reviews as Record<string, unknown>), items: {}
      }
    } } : call.schema;
    if (!matchesSchema(value, validationSchema)) throw new Error();
    return JSON.stringify(value);
  } catch { throw compatibleFailure(call.provider); }
}

function removeOptionalNulls(value: unknown, schema: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map(item => removeOptionalNulls(item, schema.items as Record<string, unknown> ?? {}));
  if (value && typeof value === 'object' && schema.properties) {
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const required = schema.required as string[] ?? [];
    return Object.fromEntries(Object.entries(value).filter(([key, item]) => item !== null || required.includes(key) || !Object.hasOwn(properties, key))
      .map(([key, item]) => [key, removeOptionalNulls(item, properties[key] ?? {})]));
  }
  return value;
}

function matchesSchema(value: unknown, schema: Record<string, unknown>): boolean {
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some(item => matchesSchema(value, item))) return false;
  if (Array.isArray(schema.oneOf) && schema.oneOf.filter(item => matchesSchema(value, item)).length !== 1) return false;
  if (Array.isArray(schema.allOf) && !schema.allOf.every(item => matchesSchema(value, item))) return false;
  if (schema.const !== undefined && value !== schema.const) return false;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).some(t => t === type || t === 'integer' && typeof value === 'number' && Number.isInteger(value))) return false;
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems || typeof schema.maxItems === 'number' && value.length > schema.maxItems) return false;
    if (schema.items && !value.every(item => matchesSchema(item, schema.items as Record<string, unknown>))) return false;
  } else if (type === 'object') {
    const record = value as Record<string, unknown>;
    const properties = schema.properties as Record<string, Record<string, unknown>> ?? {};
    if (Array.isArray(schema.required) && !schema.required.every(key => Object.hasOwn(record, key))) return false;
    if (schema.additionalProperties === false && Object.keys(record).some(key => !Object.hasOwn(properties, key))) return false;
    if (!Object.entries(properties).every(([key, child]) => !Object.hasOwn(record, key) || matchesSchema(record[key], child))) return false;
  }
  if (typeof value === 'string' && (typeof schema.minLength === 'number' && value.length < schema.minLength || typeof schema.maxLength === 'number' && value.length > schema.maxLength)) return false;
  if (typeof value === 'number' && (!Number.isFinite(value) || typeof schema.minimum === 'number' && value < schema.minimum || typeof schema.maximum === 'number' && value > schema.maximum)) return false;
  return true;
}

export async function listGroqModels(apiKey: string, signal: AbortSignal): Promise<Array<{ id: string; displayName: string }>> {
  let response: Response;
  try {
    response = await fetch(`${compatibleBaseUrl('groq')}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal });
  } catch { throw new ProviderError('Groq model discovery could not be reached.', 'configureGroqModel'); }
  if (!response.ok) throw new ProviderError(providerHttpError('Groq', response.status), 'setGroqKey', false, response.status);
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
  if (!apiKey) throw new ProviderError('Set your Groq API key in KREN menu, Credentials before recording with Groq.', 'setGroqKey');
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
