import { ProviderError, attributeProviderError } from './errors.js';
import { classifyGeminiRateLimit } from './providers/gemini.js';
import { isLanguageModelRoutingProvider, languageModelCredentialSlot } from './languageModelRouting.js';
import type { LanguageModelRoutingProvider } from './languageModelRouting.js';
import type { KrenRuntime, TutorLanguageModelRoute } from './operations.js';
import { KREN_SECRET_KEYS } from './operations.js';
import { TUTOR_MODELS, modeEffort, type ThinkingMode } from './tutor/thinkingMode.js';

export const DEFAULT_PROVIDER_ORDER = ['gemini', 'groq', 'cloudflare'] as const;
export const PROVIDER_EXHAUSTION_KEY = 'kren.languageModelExhaustion.v2';
interface SwitchStorage { get<T>(key: string, fallback: T): T; update(key: string, value: unknown): PromiseLike<void> }
const dayOf = (date: Date): string => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
type QuotaRoute = Pick<TutorLanguageModelRoute, 'provider' | 'geminiProfile' | 'model'>;
interface Exhaustion { day: string; exhausted: string[] }
const quotaPool = (route: QuotaRoute): string => `${route.provider}:${route.provider === 'gemini' ? route.geminiProfile : 'standard'}:${
  route.provider === 'gemini' || route.provider === 'groq' ? route.model.replace(/^models\//u, '') : '*'}`;
const validPool = (pool: unknown): pool is string => typeof pool === 'string' &&
  isLanguageModelRoutingProvider(pool.split(':')[0]) && pool.split(':').length === 3;

/** Only quota pool identifiers and the local day persist, never text, responses, or credentials. */
export class ProviderExhaustionState {
  private state: Exhaustion;
  // Safe, already formatted errors are session-only. They never enter persisted state.
  private readonly quotaFailures = new Map<string, ProviderError>();
  // 2026-10-15: Both switch causes share one popup per provider and model this session.
  private readonly notified = new Set<string>();
  private writes = Promise.resolve();
  constructor(private readonly storage?: SwitchStorage, private readonly now: () => Date = () => new Date(),
    private readonly changed: () => void = () => {}) {
    const stored = storage?.get<Partial<Exhaustion>>(PROVIDER_EXHAUSTION_KEY, {}) ?? {};
    this.state = { day: typeof stored.day === 'string' ? stored.day : '',
      exhausted: Array.isArray(stored.exhausted) ? stored.exhausted.filter(validPool) : [] };
  }
  private today(): void {
    const day = dayOf(this.now());
    if (this.state.day !== day) { this.state = { day, exhausted: [] }; this.quotaFailures.clear(); this.persist(); }
  }
  private persist(): void {
    const snapshot = { ...this.state, exhausted: [...this.state.exhausted] };
    this.writes = this.writes.then(() => this.storage?.update(PROVIDER_EXHAUSTION_KEY, snapshot)).then(() => {}, () => {});
  }
  public exhausted(): LanguageModelRoutingProvider[] {
    this.today(); return [...new Set(this.state.exhausted.map(pool => pool.split(':')[0] as LanguageModelRoutingProvider))];
  }
  public isExhausted(route: QuotaRoute): boolean { this.today(); return this.state.exhausted.includes(quotaPool(route)); }
  public mark(route: QuotaRoute, failure?: ProviderError): void {
    const pool = quotaPool(route);
    this.today();
    if (failure && !this.quotaFailures.has(pool)) this.quotaFailures.set(pool,
      new ProviderError(failure.message, failure.action, false, failure.status ?? 429, 'quotaExhausted'));
    if (!this.state.exhausted.includes(pool)) { this.state.exhausted.push(pool); this.persist(); this.changed(); }
  }
  public quotaFailure(route: QuotaRoute): ProviderError {
    this.today();
    const stored = this.quotaFailures.get(quotaPool(route));
    const error = new ProviderError(stored?.message ?? `${name(route.provider)} returned 429. Check provider quota and billing before retrying.`,
      stored?.action, false, stored?.status ?? 429, 'quotaExhausted');
    error.attemptedRoute = { provider: route.provider, model: route.model, geminiProfile: route.geminiProfile };
    return error;
  }
  public notifyOnce(route: QuotaRoute): boolean {
    const key = `${route.provider}:${route.model.replace(/^models\//u, '')}`;
    if (this.notified.has(key)) return false;
    this.notified.add(key); return true;
  }
  public async flush(): Promise<void> { await this.writes; }
  public clear(provider?: LanguageModelRoutingProvider): void {
    this.today();
    const keep = (pool: string) => provider !== undefined && !pool.startsWith(`${provider}:`);
    this.state.exhausted = this.state.exhausted.filter(keep);
    for (const pool of this.quotaFailures.keys()) if (!keep(pool)) this.quotaFailures.delete(pool);
    this.persist(); this.changed();
  }
}
let exhaustion = new ProviderExhaustionState();
export function configureProviderExhaustion(state: ProviderExhaustionState): void { exhaustion = state; }
export function exhaustedProvidersToday(): LanguageModelRoutingProvider[] { return exhaustion.exhausted(); }
export function isQuotaPoolExhaustedToday(route: QuotaRoute): boolean { return exhaustion.isExhausted(route); }
export function clearProviderExhaustionForCredential(key: string): void {
  const provider = key === KREN_SECRET_KEYS.gemini || key === KREN_SECRET_KEYS.geminiPro ? 'gemini'
    : key === KREN_SECRET_KEYS.groq ? 'groq' : key === KREN_SECRET_KEYS.openai ? 'openai'
      : key === KREN_SECRET_KEYS.anthropic ? 'anthropic'
        : key === KREN_SECRET_KEYS.cloudflareApiToken || key === KREN_SECRET_KEYS.cloudflareAccountId ? 'cloudflare' : undefined;
  if (provider) exhaustion.clear(provider);
}
export async function resetProviderExhaustion(): Promise<void> { exhaustion.clear(); await exhaustion.flush(); }

/** The status alone never establishes daily exhaustion. Free-text diagnostics stay local. */
export function isProviderQuotaExhausted(provider: string, status: number, payload: unknown): boolean {
  if (provider === 'gemini') return status === 429 && classifyGeminiRateLimit(payload).kind === 'quotaExhausted';
  if (provider !== 'groq' && provider !== 'cloudflare') return false;
  const data = payload as { errors?: Array<{ code?: number }>; error?: { code?: number; message?: string }; message?: string } | undefined;
  if (provider === 'cloudflare' && (data?.errors?.some(error => error.code === 3036) || data?.error?.code === 3036)) return true;
  const text = JSON.stringify(payload ?? '').toLowerCase();
  return status === 429 && !/per[_ -]?(?:minute|second)|\b(?:rpm|tpm)\b/u.test(text) &&
    /per[_ -]?(?:day|month)|daily|monthly|\b(?:rpd|tpd)\b/u.test(text);
}

export function validProviderOrder(value: unknown): value is LanguageModelRoutingProvider[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 5 &&
    value.every(isLanguageModelRoutingProvider) && new Set(value).size === value.length;
}
const name = (provider: string) => provider === 'gemini' ? 'Gemini' : provider === 'groq' ? 'Groq'
  : provider === 'cloudflare' ? 'Cloudflare' : provider === 'openai' ? 'OpenAI' : 'Anthropic';

// Host-only attribution follows the returned object through thinking and panel boundaries.
const responseProviders = new WeakMap<object, LanguageModelRoutingProvider>();
function attributedResponse<T>(value: T, route: TutorLanguageModelRoute): T {
  if (value && typeof value === 'object') responseProviders.set(value, route.provider);
  return value;
}

export function tutorProviderSwitchMessage(value: unknown, selected: LanguageModelRoutingProvider,
  kind: 'lesson' | 'practice set' | 'review', message: string): string {
  const provider = value instanceof ProviderError ? value.attemptedRoute?.provider
    : value && typeof value === 'object' ? responseProviders.get(value) : undefined;
  return provider && provider !== selected
    ? `${name(selected)} was unavailable, so ${name(provider)} drafted this ${kind}. ${message}` : message;
}

export async function withProviderSwitch<T>(runtime: KrenRuntime, route: TutorLanguageModelRoute, mode: ThinkingMode,
  signal: AbortSignal, run: (route: TutorLanguageModelRoute) => Promise<T>): Promise<T> {
  return runWithProviderSwitch(route, mode, signal, run, providerSwitchDependencies(runtime));
}

/** Host credentials and session state stay outside feature payloads. */
export function providerSwitchDependencies(runtime: KrenRuntime): ProviderSwitchDependencies {
  const enabled = runtime.getSetting('llm.providerSwitch', true);
  const setting = enabled ? runtime.getSetting<unknown>('llm.providerOrder', [...DEFAULT_PROVIDER_ORDER]) : [...DEFAULT_PROVIDER_ORDER];
  return {
    enabled,
    order: validProviderOrder(setting) ? setting : [...DEFAULT_PROVIDER_ORDER],
    state: runtime.providerExhaustion ?? exhaustion,
    hasCredentials: async provider => Boolean(await runtime.getSecret(KREN_SECRET_KEYS[languageModelCredentialSlot(provider, 'standard')])) &&
      (provider !== 'cloudflare' || Boolean(await runtime.getSecret(KREN_SECRET_KEYS.cloudflareAccountId))),
    log: line => runtime.log?.(line), notice: message => runtime.providerSwitchNotice?.(message)
  };
}

export interface ProviderSwitchDecision {
  from: ProviderAttemptRoute;
  to: TutorLanguageModelRoute;
  cause: 'quotaExhausted' | 'overloaded';
  preflight: boolean;
}
type ProviderAttemptRoute = Pick<TutorLanguageModelRoute, 'provider' | 'model' | 'geminiProfile'>;
export interface ProviderSwitchDependencies {
  enabled: boolean;
  order: readonly LanguageModelRoutingProvider[];
  state: ProviderExhaustionState;
  hasCredentials(provider: LanguageModelRoutingProvider): Promise<boolean>;
  log?: (line: string) => void;
  notice?: (message: string) => void;
  decision?: (event: ProviderSwitchDecision) => void;
  skip?: (route: ProviderAttemptRoute) => void;
}

export function providerSwitchMessage(from: ProviderAttemptRoute, to: ProviderAttemptRoute,
  cause: ProviderSwitchDecision['cause']): string {
  return cause === 'overloaded'
    ? `${name(from.provider)} ${from.model} is overloaded. KREN is using ${name(to.provider)} for this request.`
    : `${name(from.provider)} ${from.model}${from.provider === 'gemini' ? from.geminiProfile === 'pro' ? ' (Paid)' : ' (Free Tier)' : ''} reached a daily or monthly free limit. KREN is using ${name(to.provider)} for it until local midnight.`;
}

/** Shared switching engine. Legacy callers keep their existing presentation behavior. */
export async function runWithProviderSwitch<T>(route: TutorLanguageModelRoute, mode: ThinkingMode,
  signal: AbortSignal, run: (route: TutorLanguageModelRoute) => Promise<T>, dependencies: ProviderSwitchDependencies): Promise<T> {
  if (!dependencies.enabled) {
    signal.throwIfAborted();
    if (dependencies.state.isExhausted(route)) {
      dependencies.skip?.(route);
      throw dependencies.state.quotaFailure(route);
    }
    try { return attributedResponse(await run(route), route); }
    catch (error) {
      attributeProviderError(error, route, true);
      if (!signal.aborted && error instanceof ProviderError && error.reason === 'quotaExhausted')
        dependencies.state.mark(error.attemptedRoute ?? route, error);
      throw error;
    }
  }
  const { order, state } = dependencies;
  const next = async (provider: LanguageModelRoutingProvider): Promise<LanguageModelRoutingProvider | undefined> => {
    for (const candidate of order.slice(Math.max(0, order.indexOf(provider) + 1))) {
      if (state.isExhausted(switched(candidate))) { dependencies.skip?.(switched(candidate)); continue; }
      if (!await dependencies.hasCredentials(candidate)) continue;
      return candidate;
    }
    return undefined;
  };
  const switched = (provider: LanguageModelRoutingProvider): TutorLanguageModelRoute => {
    const model = TUTOR_MODELS[provider][mode];
    return { ...route, provider, model, fastModel: TUTOR_MODELS[provider].fast, geminiProfile: 'standard',
      thinkingOrEffort: modeEffort(provider, model, mode, route.thinkingOrEffort) };
  };
  let current = route;
  if (state.isExhausted(current)) {
    dependencies.skip?.(current);
    const provider = await next(current.provider);
    if (!provider) throw state.quotaFailure(current);
    dependencies.decision?.({ from: current, to: switched(provider), cause: 'quotaExhausted', preflight: true });
    current = switched(provider);
  }
  for (;;) {
    signal.throwIfAborted();
    try { return attributedResponse(await run(current), current); }
    catch (error) {
      // 2026-10-12: a reused error receives fresh synthesized attribution, while actual
      // transport attribution still identifies a same-provider fallback's failed pool.
      attributeProviderError(error, current, true);
      if (signal.aborted || !(error instanceof ProviderError)) throw error;
      const attempted = error.attemptedRoute ?? current;
      const overloaded = attempted.provider === 'gemini' && (error.status === 503 || error.reason === 'overloaded');
      if (error.reason !== 'quotaExhausted' && !overloaded) throw error;
      if (!overloaded) state.mark(attempted, error);
      const provider = await next(attempted.provider);
      if (!provider) throw error;
      dependencies.decision?.({ from: attempted, to: switched(provider), cause: overloaded ? 'overloaded' : 'quotaExhausted', preflight: false });
      const message = providerSwitchMessage(attempted, switched(provider), overloaded ? 'overloaded' : 'quotaExhausted');
      dependencies.log?.(`[provider switch] ${message}`);
      if (state.notifyOnce(attempted)) dependencies.notice?.(message);
      current = switched(provider);
    }
  }
}
