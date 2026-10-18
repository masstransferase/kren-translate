import { normalizeGeminiModel } from './providers/geminiModels.js';
import { classifyGeminiRateLimit } from './providers/gemini.js';

export interface LanguageModelUsage {
  geminiProfile?: 'standard' | 'pro';
  provider: string;
  model: string;
  requests: number;
  input: number;
  output: number;
  thinking: number;
  characters?: number;
}
export interface LanguageModelRequest { feature: string; provider: string; model: string; geminiProfile?: 'standard' | 'pro' }
interface UsageState { days: Record<string, LanguageModelUsage[]> }
interface LocalState { get<T>(key: string, fallback: T): T; update(key: string, value: unknown): PromiseLike<void> }
export const LANGUAGE_MODEL_USAGE_KEY = 'kren.languageModelUsage.v1';
const recordObject = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const count = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

/** Read reported counts only. No prompt, completion, audio, credential, or response is retained. */
export function reportedLanguageModelUsage(provider: string, envelope: unknown): Pick<LanguageModelUsage, 'input' | 'output' | 'thinking'> {
  const value = recordObject(envelope);
  const usage = recordObject(provider === 'gemini' ? value.usageMetadata : value.usage ?? recordObject(value.result).usage);
  return provider === 'gemini'
    ? { input: count(usage.promptTokenCount), output: count(usage.candidatesTokenCount ?? usage.responseTokenCount), thinking: count(usage.thoughtsTokenCount) }
    : { input: count(usage.prompt_tokens ?? usage.input_tokens), output: count(usage.completion_tokens ?? usage.output_tokens), thinking: 0 };
}
const localDay = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const identifier = (value: string): string => /^[A-Za-z0-9@_./:+-]{1,160}$/u.test(value) ? value : 'custom';

/** globalState is local to the extension profile; this key is never registered for sync. */
export class LanguageModelUsageRecorder {
  private state: UsageState;
  private writes: Promise<void> = Promise.resolve();
  public constructor(private readonly storage: LocalState, private readonly log: (line: string) => void,
    private readonly changed: () => void = () => {}, private readonly now: () => Date = () => new Date()) {
    this.state = { days: {} };
    const stored = recordObject(storage.get<unknown>(LANGUAGE_MODEL_USAGE_KEY, undefined));
    for (const [day, rows] of Object.entries(recordObject(stored.days))) {
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(day) || !Array.isArray(rows)) continue;
      this.state.days[day] = rows.flatMap((row: unknown) => {
        const r = recordObject(row);
        return typeof r.provider === 'string' && typeof r.model === 'string'
          ? [{ provider: identifier(r.provider), model: identifier(r.model), requests: count(r.requests), input: count(r.input), output: count(r.output), thinking: count(r.thinking), ...(r.provider === 'gemini' && (r.geminiProfile === 'pro' || r.geminiProfile === 'standard') ? { geminiProfile: r.geminiProfile } : {}), ...(r.characters !== undefined ? { characters: count(r.characters) } : {}) }] : [];
      });
    }
    this.prune();
  }
  private prune(): void {
    const today = this.now(), oldest = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
    const end = localDay(today), start = localDay(oldest);
    const expired = Object.keys(this.state.days).filter(day => day < start || day > end);
    if (expired.length) { for (const day of expired) delete this.state.days[day]; this.persist(); }
  }
  private persist(): void {
    const snapshot = JSON.parse(JSON.stringify(this.state)) as UsageState;
    this.writes = this.writes.then(() => this.storage.update(LANGUAGE_MODEL_USAGE_KEY, snapshot)).then(() => {}, () => {});
  }
  public today(): LanguageModelUsage[] {
    this.prune();
    return (this.state.days[localDay(this.now())] ?? []).map(row => ({ ...row })).sort((a, b) => `${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`));
  }
  public record(request: LanguageModelRequest, envelope?: unknown): void {
    this.prune();
    const provider = identifier(request.provider);
    const model = identifier(provider === 'gemini' ? normalizeGeminiModel(request.model).replace(/^models\//u, '') : request.model);
    const tokens = reportedLanguageModelUsage(provider, envelope);
    const rows = this.state.days[localDay(this.now())] ??= [];
    const profile = provider === 'gemini' ? request.geminiProfile ?? 'standard' : undefined;
    // 2026-10-12: legacy totals with no known profile remain separate from new pool totals.
    let row = rows.find(r => r.provider === provider && r.model === model && (provider !== 'gemini' || r.geminiProfile === profile));
    if (!row) { row = { provider, model, ...(profile ? { geminiProfile: profile } : {}), requests: 0, input: 0, output: 0, thinking: 0 }; rows.push(row); }
    row.requests += 1; row.input += tokens.input; row.output += tokens.output; row.thinking += tokens.thinking;
    if (provider === 'google-tts') row.characters = (row.characters ?? 0) + count(recordObject(envelope).characters);
    this.persist();
    try { this.log(`[usage] ${identifier(request.feature)} ${provider} ${model} in=${tokens.input} out=${tokens.output} think=${tokens.thinking}`); } catch { /* Logging cannot fail a request. */ }
    try { this.changed(); } catch { /* A closed panel cannot fail a request. */ }
  }
  public async flush(): Promise<void> { await this.writes; }
  public failure(request: LanguageModelRequest, cause: string): void {
    const model = request.provider === 'gemini' ? normalizeGeminiModel(request.model).replace(/^models\//u, '') : request.model;
    try { this.log(`[provider failure] ${identifier(request.feature)} ${identifier(request.provider)} ${identifier(model)} ${cause}`); } catch { /* Logging cannot fail a request. */ }
  }
}
let recorder: LanguageModelUsageRecorder | undefined;
export function configureLanguageModelUsage(value: LanguageModelUsageRecorder | undefined): void { recorder = value; }
export function languageModelUsageToday(): LanguageModelUsage[] { return recorder?.today() ?? []; }
export function recordLanguageModelUsage(request: LanguageModelRequest, envelope?: unknown): void { recorder?.record(request, envelope); }
export function recordLanguageModelFailure(request: LanguageModelRequest, cause: string): void { recorder?.failure(request, cause); }
export function recordLanguageModelNoResponse(request: LanguageModelRequest): void { recorder?.failure(request, 'no response'); }

interface Attempt { request: LanguageModelRequest; failed: boolean; failure?: (cause: string) => void }
const attempts = new WeakMap<object, Attempt>();
/** The center owns attempt events; later feature validation shares its once-only failure gate. */
export function trackLanguageModelAttempt(source: object, request: LanguageModelRequest, failure: (cause: string) => void): void {
  attempts.set(source, { request, failed: false, failure });
}
/** Validation follows the response through parsed objects without retaining their contents. */
export function validateLanguageModelOutput<T>(source: unknown, validate: () => T): T {
  const attempt = source && typeof source === 'object' ? attempts.get(source) : undefined;
  try {
    const result = validate();
    if (attempt && result && typeof result === 'object') attempts.set(result, attempt);
    return result;
  } catch (error) {
    if (attempt) logAttemptFailure(attempt, 'unreadable output');
    throw error;
  }
}
function logAttemptFailure(attempt: Attempt, cause: string): void {
  if (attempt.failed) return;
  attempt.failed = true;
  if (attempt.failure) attempt.failure(cause);
  else recorder?.failure(attempt.request, cause);
}
/** Fixed classifications and known enum codes only, never a remote message. */
export function httpFailure(provider: string, status: number, envelope?: unknown): string {
  const payload = recordObject(envelope), error = recordObject(payload.error);
  const codes: string[] = [status === 401 || status === 403 ? 'authenticationRejected'
    : status === 429 ? 'rateLimit' : status >= 500 ? 'serviceUnavailable' : 'requestRejected'];
  if (provider === 'gemini') {
    if (status === 429) codes.push(classifyGeminiRateLimit(envelope).kind);
    const statuses = ['INVALID_ARGUMENT', 'FAILED_PRECONDITION', 'OUT_OF_RANGE', 'UNAUTHENTICATED', 'PERMISSION_DENIED', 'NOT_FOUND', 'RESOURCE_EXHAUSTED', 'CANCELLED', 'UNKNOWN', 'INTERNAL', 'UNAVAILABLE', 'DEADLINE_EXCEEDED'];
    const reasons = ['RATE_LIMIT_EXCEEDED', 'QUOTA_EXCEEDED', 'DAILY_LIMIT_EXCEEDED', 'API_KEY_INVALID', 'API_KEY_EXPIRED', 'API_KEY_SERVICE_BLOCKED', 'API_KEY_HTTP_REFERRER_BLOCKED', 'API_KEY_IP_ADDRESS_BLOCKED', 'API_KEY_ANDROID_APP_BLOCKED', 'API_KEY_IOS_APP_BLOCKED', 'SERVICE_DISABLED', 'BILLING_DISABLED', 'CONSUMER_INVALID', 'ACCESS_TOKEN_EXPIRED', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'];
    if (statuses.includes(String(error.status))) codes.push(String(error.status));
    if (Array.isArray(error.details)) for (const detail of error.details) {
      const reason = recordObject(detail).reason;
      if (typeof reason === 'string' && reasons.includes(reason)) codes.push(reason);
    }
  } else if (provider === 'cloudflare') {
    for (const item of [...(Array.isArray(payload.errors) ? payload.errors : []), error]) {
      const code = recordObject(item).code;
      if (typeof code === 'number' && Number.isSafeInteger(code)) codes.push(String(code));
    }
  } else {
    for (const code of [error.code, error.type]) if (typeof code === 'string' &&
      ['rate_limit_exceeded', 'tokens', 'requests', 'invalid_api_key', 'invalid_request_error', 'authentication_error', 'permission_error', 'not_found_error', 'rate_limit_error', 'overloaded_error', 'api_error', 'insufficient_quota'].includes(code)) codes.push(code);
  }
  return `HTTP ${status} ${[...new Set(codes)].join(' ')}`;
}

/** Transparent transport hook: inspect the existing JSON read, with no extra request or body copy. */
export function usageTrackedFetch(request: LanguageModelRequest, fetcher: typeof fetch = fetch): typeof fetch {
  return async (url, init) => {
    const attempt: Attempt = { request, failed: false };
    let response: Response;
    try { response = await fetcher(url, init); }
    catch (error) { recordLanguageModelUsage(request); logAttemptFailure(attempt, 'no response'); throw error; }
    let recorded = false;
    const record = (value?: unknown) => { if (!recorded) { recorded = true; recordLanguageModelUsage(request, value); } };
    if (!response.ok) record();
    const tracked = new Proxy(response, { get(target, key) {
      if (key === 'json') return async () => {
        try {
          const value: unknown = await target.json(); record(value);
          if (value && typeof value === 'object') attempts.set(value, attempt);
          if (!target.ok || recordObject(value).success === false) logAttemptFailure(attempt, httpFailure(request.provider, target.status, value));
          return value;
        } catch (error) { record(); logAttemptFailure(attempt, target.ok ? 'unreadable output' : httpFailure(request.provider, target.status)); throw error; }
      };
      if (key === 'arrayBuffer' || key === 'text' || key === 'blob') return async () => {
        try { return await (target[key] as () => Promise<unknown>).call(target); }
        catch (error) { record(); logAttemptFailure(attempt, 'unreadable output'); throw error; }
        finally { record(); if (!target.ok) logAttemptFailure(attempt, httpFailure(request.provider, target.status)); }
      };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    attempts.set(tracked, attempt);
    return tracked;
  };
}
