import { waitForRetry } from '@kren/core/retry';
import { classifyRequestStatus, requestRetryDelay, responseRefused, safeCodes, safeRoute, identifier, boundedTransportAttempts, centerTransportAttempts, consumeRequestBudget, routeBudgetAvailable, requestBoundary, retryAttempt, shouldFallback, shouldRetryContent, recoveryAfterFailure, failureActions, compatibilityFailureCause, decisionUsageEvent, decisionFailureEvent } from '@kren/core/request-decisions';
export { classifyRequestStatus, requestRetryDelay };
import { ProviderError } from './errors.js';
import { TUTOR_DEFAULTS } from './tutor/defaults.js';
import { DEFAULT_PROVIDER_ORDER, ProviderExhaustionState, runWithProviderSwitch, providerSwitchMessage,
  isProviderQuotaExhausted, providerSwitchDependencies, type ProviderSwitchDependencies } from './languageModelSwitching.js';
import { httpFailure, reportedLanguageModelUsage, recordLanguageModelUsage, recordLanguageModelFailure,
  trackLanguageModelAttempt, validateLanguageModelOutput, type LanguageModelRequest } from './languageModelUsage.js';
import { canEscalateThinking, modeEffort, tutorFastModel, tutorModeModel, TUTOR_THINKING_MODES,
  tutorFastEffort, runTutorThinking, runAdaptiveThinking, type ThinkingMode } from './tutor/thinkingMode.js';
import type { GeminiQuotaCategory } from './providers/gemini.js';
import { type KrenRuntime, type TutorLanguageModelRoute } from './operations.js';
import type { TutorStructuredGenerationRequest } from './tutor/generation.js';
import type { LanguageModelRoutingProvider, LanguageModelRoutingEffort } from './languageModelRouting.js';

export type RequestFeature = 'translate' | 'rewrite' | 'explain' | 'userDictionary' | 'grammar' | 'tutor';
export type RequestKind = Exclude<keyof typeof TUTOR_THINKING_MODES, 'liveSessionCredential'> | 'capture' | 'grammar' | 'rewrite' | 'explain';
export type FindingCode = 'unreadableOutput' | 'requiredField' | 'wordCount' | 'excerpt' | 'contentRejected' | 'refused';
export type FailureCause = 'noResponse' | 'authenticationRejected' | 'quotaExhausted' | 'rateLimit' |
  'overloaded' | 'serviceUnavailable' | 'requestRejected' | 'unreadableOutput' | 'contentRejected' | 'refused' | 'budget' | 'deadline';
export type ReaderAction = 'retry' | 'checkQuota' | 'setCredential' | 'configureProvider';

export interface RequestIdentity {
  feature: RequestFeature;
  kind: RequestKind;
  trigger: 'explicitAction' | 'existingPrefetch';
  signal: AbortSignal;
}
export interface AuthorizedPayload { readonly instruction: string; readonly input: string }
export interface RequestRoute {
  provider: LanguageModelRoutingProvider;
  geminiProfile: 'standard' | 'pro';
  model: string;
  mode: ThinkingMode;
  effort: LanguageModelRoutingEffort;
}
export interface SelectedRequestRoute extends RequestRoute {
  fastModel?: string;
  thoroughModel?: string;
  thoroughEffort?: LanguageModelRoutingEffort;
  fallback?: { model: string; effort: LanguageModelRoutingEffort };
}
export type ValidationResult<T> =
  | { type: 'accepted'; value: T }
  | { type: 'acceptedWithWarnings' | 'salvaged'; value: T; warnings: readonly FindingCode[] }
  | { type: 'rejected'; cause: 'unreadableOutput' | 'contentRejected' | 'refused'; codes: readonly FindingCode[] };

import { CURRENT_REQUEST_POLICIES, type RequestPolicy } from '@kren/core/request-decisions';
export { CURRENT_REQUEST_POLICIES, type RequestPolicy };

export interface RequestRecoveryPolicy {
  /** Already resolved host settings, including the retry-enabled toggle. Values are capped at five. */
  transportAttempts: Readonly<Record<LanguageModelRoutingProvider, number>>;
  escalation: 'once' | 'never';
  providerSwitch: boolean;
  providerOrder?: readonly LanguageModelRoutingProvider[];
  contentRetry: { allowance: number; correctiveInstruction: string; on: readonly FindingCode[] };
  policy: RequestPolicy;
}
export interface RequestBudget {
  /** Across the entire request, keyed by provider, profile, model, mode and effort. */
  perRouteAttempts: number;
  totalRequests: number;
  /** Absolute clock time in milliseconds. */
  deadline: number;
}
export interface CenterRequest<T> {
  identity: RequestIdentity;
  payload: AuthorizedPayload;
  route: SelectedRequestRoute;
  validate(value: unknown, route: RequestRoute): ValidationResult<T> | Promise<ValidationResult<T>>;
  recovery: RequestRecoveryPolicy;
  budget: RequestBudget;
  preservation?: 'none' | 'previousResult' | 'localFindings' | 'conversation';
}
/** One network attempt only. Credentials stay in the injected host transport. */
export interface TransportResponse {
  status: number;
  envelope?: unknown;
  value?: unknown;
  output?: 'empty' | 'refused';
  retryAfter?: string | null;
}
export interface AttemptHistory {
  attempt: number;
  route: RequestRoute;
  status?: number;
  outcome: 'accepted' | 'acceptedWithWarnings' | 'salvaged' | 'failed' | 'canceled';
  cause?: FailureCause;
  codes: readonly FindingCode[];
}
export type RecoveryDecision =
  | { decision: 'switch' | 'preflightSkip'; from: RequestRoute; to: RequestRoute; cause: 'quotaExhausted' | 'overloaded' }
  | { decision: 'fallback' | 'escalation'; from: RequestRoute; to: RequestRoute }
  | { decision: 'contentRetry' | 'salvage'; route: RequestRoute; codes: readonly FindingCode[] };
interface EventIdentity { feature: RequestFeature; kind: RequestKind; trigger: RequestIdentity['trigger'] }
export type RequestEvent = EventIdentity & (
  | { type: 'usage'; attempt: number; route: RequestRoute; input: number; output: number; thinking: number }
  /** diagnostic is produced only by the existing allowlisted HTTP formatter or fixed local text. */
  | { type: 'failure'; attempt: number; route: RequestRoute; cause: FailureCause; status?: number; codes: readonly FindingCode[]; diagnostic: string }
  | { type: 'recovery'; recovery: RecoveryDecision }
);
export type RequestOutcome<T> =
  | { type: 'accepted'; value: T; warnings: readonly FindingCode[]; route: RequestRoute; history: AttemptHistory[]; recovery: RecoveryDecision[] }
  | { type: 'failed'; cause: FailureCause | 'missingCredentials'; attemptedRoute?: RequestRoute; actions: readonly ReaderAction[];
      missingCredentials?: MissingCredentials;
      preservation: NonNullable<CenterRequest<T>['preservation']>; history: AttemptHistory[]; recovery: RecoveryDecision[] }
  | { type: 'canceled'; history: AttemptHistory[]; recovery: RecoveryDecision[] };

export interface RequestCenterDependencies {
  transport(payload: AuthorizedPayload, route: RequestRoute, signal: AbortSignal): Promise<TransportResponse>;
  hasCredentials(provider: LanguageModelRoutingProvider): Promise<boolean>;
  exhaustion: ProviderExhaustionState;
  now?: () => number;
  random?: () => number;
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  scheduleDeadline?: (milliseconds: number, expire: () => void) => () => void;
  event?: (event: RequestEvent) => void | Promise<void>;
  log?: (line: string) => void | Promise<void>;
  notice?: (message: string) => void | Promise<void>;
  switching?: typeof runWithProviderSwitch;
  thinking?: { canEscalate: typeof canEscalateThinking; effort: typeof modeEffort; fastModel: typeof tutorFastModel; model: typeof tutorModeModel };
  usage?: { record: typeof recordLanguageModelUsage; failure: typeof recordLanguageModelFailure };
}

const ignored = (callback: () => unknown): void => {
  try { const result = callback(); if (result && typeof (result as PromiseLike<unknown>).then === 'function') void Promise.resolve(result).catch(() => {}); }
  catch { /* Presentation and recording cannot change a request outcome. */ }
};
class CenterFailure extends ProviderError {
  constructor(override readonly cause: FailureCause, route: RequestRoute, status?: number, retryable = false,
    readonly validationEscalation = false) {
    super('Language-model request failed.', undefined, retryable, status,
      cause === 'quotaExhausted' ? 'quotaExhausted' : cause === 'overloaded' ? 'overloaded'
        : cause === 'unreadableOutput' ? 'structuredOutput' : cause === 'refused' ? 'refused' : undefined);
    this.attemptedRoute = route;
  }
}

export type TransportAttemptEvent = {
  attempt: number; request: LanguageModelRequest;
} & ({ type: 'usage'; input: number; output: number; thinking: number }
  | { type: 'failure'; cause: FailureCause; status?: number; diagnostic: string });
export interface TransportFailure {
  cause: FailureCause; status?: number; retryable: boolean; envelope?: unknown; attempts: number;
}
export interface TransportRequest<T> {
  request: LanguageModelRequest & { provider: LanguageModelRoutingProvider };
  signal: AbortSignal;
  maxAttempts: number;
  opening?: boolean;
  /** Performs exactly one send, with the original authorized body and host-owned credential. */
  send(): Promise<Response>;
  decode(envelope: unknown): T;
  failure(failure: TransportFailure): ProviderError;
  refused?: (envelope: unknown) => ProviderError;
  onAttempt?: () => void;
  onBackoff?: (milliseconds: number) => void;
}
const attemptObservers = new WeakMap<AbortSignal, (event: TransportAttemptEvent) => void>();
const requestBudgets = new WeakMap<AbortSignal, { remaining: number }>();
const contentAttempts = new WeakMap<AbortSignal, { reject?: (cause: FailureCause) => void }>();
class RequestBudgetError extends Error {}

export interface TransportDependencies {
  now?: () => number;
  random?: () => number;
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  event?: (event: TransportAttemptEvent) => void;
  usage?: { record: typeof recordLanguageModelUsage; failure: typeof recordLanguageModelFailure };
}

/** Run 2 boundary: transport retries and events, while feature recovery remains with its current caller. */
export async function requestWithRetry<T>(call: TransportRequest<T>, dependencies: TransportDependencies = {}): Promise<T> {
  const now = dependencies.now ?? Date.now, delay = dependencies.delay ?? waitForRetry;
  const usage = dependencies.usage ?? { record: recordLanguageModelUsage, failure: recordLanguageModelFailure };
  const request = { feature: identifier(call.request.feature), provider: call.request.provider, model: identifier(call.request.model),
    ...(call.request.geminiProfile ? { geminiProfile: call.request.geminiProfile } : {}) };
  const observer = attemptObservers.get(call.signal);
  const emit = (event: TransportAttemptEvent) => {
    ignored(() => observer?.(event));
    ignored(() => dependencies.event?.(event));
    if (event.type === 'failure') ignored(() => usage.failure(event.request, event.diagnostic));
    else ignored(() => usage.record(event.request, event.request.provider === 'gemini'
      ? { usageMetadata: { promptTokenCount: event.input, candidatesTokenCount: event.output, thoughtsTokenCount: event.thinking } }
      : { usage: { prompt_tokens: event.input, completion_tokens: event.output } }));
  };
  const attempts = boundedTransportAttempts(call.maxAttempts, call.opening);
  for (let index = 0; index < attempts; index += 1) {
    call.signal.throwIfAborted();
    const budget = requestBudgets.get(call.signal);
    const budgetDecision = budget ? consumeRequestBudget(budget.remaining) : undefined;
    if (budgetDecision && !budgetDecision.allowed) throw new RequestBudgetError('The request budget is used up.');
    call.onAttempt?.();
    call.signal.throwIfAborted();
    if (budget) budget.remaining = consumeRequestBudget(budget.remaining).remaining;
    let response: Response | undefined, envelope: unknown;
    try {
      response = await call.send();
      envelope = await response.json().catch(() => undefined);
    } catch { /* Exceptions never enter events or reader diagnostics. */ }
    const event = decisionUsageEvent(request.provider, request.model, index + 1, reportedLanguageModelUsage(request.provider, envelope));
    emit({ type: 'usage', attempt: event.attempt, request, input: event.input, output: event.output, thinking: event.thinking });
    call.signal.throwIfAborted();
    let failed = false;
    const failure = (cause: FailureCause, diagnostic: string) => {
      if (failed) return;
      failed = true;
      const event = decisionFailureEvent(request.provider, request.model, index + 1, response?.status, cause);
      emit({ type: 'failure', attempt: event.attempt, request, cause, status: response?.status, diagnostic });
    };
    const content = contentAttempts.get(call.signal);
    if (content) content.reject = cause => failure(cause, 'unreadable output');
    if (response?.ok) {
      const refused = responseRefused(request.provider, envelope);
      trackLanguageModelAttempt(response, request, () => failure(refused ? 'refused' : 'unreadableOutput', refused ? 'request refused' : 'unreadable output'));
      if (envelope && typeof envelope === 'object') trackLanguageModelAttempt(envelope, request, () => failure('unreadableOutput', 'unreadable output'));
      return validateLanguageModelOutput(response, () => {
        if (refused) throw call.refused?.(envelope) ?? new ProviderError('The provider returned no structured result.', undefined, false, undefined, 'refused');
        return call.decode(envelope);
      });
    }
    const classification = response ? classifyRequestStatus(request.provider, response.status, envelope)
      : { cause: 'noResponse' as const, retryable: true };
    failure(classification.cause, response ? httpFailure(request.provider, response.status, envelope) : 'no response');
    if (!retryAttempt(classification.retryable, index, attempts)) {
      const error = call.failure({ ...classification, status: response?.status, envelope, attempts: index + 1 });
      throw new ProviderError(error.message, error.action, classification.retryable, response?.status,
        classification.cause === 'quotaExhausted' ? 'quotaExhausted' : classification.cause === 'overloaded' ? 'overloaded' : error.reason);
    }
    const milliseconds = requestRetryDelay(request.provider, index, response?.headers.get('retry-after'), envelope, now, dependencies.random);
    const started = now();
    await delay(milliseconds, call.signal);
    call.onBackoff?.(now() - started);
  }
  throw new Error('The provider request failed.');
}

/** Each run has independent budgets; exhaustion and notice state are session scoped. */
export class RequestCenter {
  constructor(private readonly dependencies: RequestCenterDependencies) {}

  public async run<T>(request: CenterRequest<T>): Promise<RequestOutcome<T>> {
    const d = this.dependencies, now = d.now ?? Date.now, delay = d.delay ?? waitForRetry;
    const thinking = d.thinking ?? { canEscalate: canEscalateThinking, effort: modeEffort, fastModel: tutorFastModel, model: tutorModeModel };
    const usage = d.usage ?? { record: recordLanguageModelUsage, failure: recordLanguageModelFailure };
    const { recovery: policy, identity, budget } = request;
    const history: AttemptHistory[] = [], recovery: RecoveryDecision[] = [], counts = new Map<string, number>();
    const controller = new AbortController();
    let expired = now() >= budget.deadline;
    const abort = () => controller.abort();
    identity.signal.addEventListener('abort', abort, { once: true });
    if (identity.signal.aborted || expired) abort();
    const schedule = d.scheduleDeadline ?? ((ms, expire) => { const timer = setTimeout(expire, ms); return () => clearTimeout(timer); });
    const unschedule = expired ? () => {} : schedule(Math.max(0, budget.deadline - now()), () => { expired = true; abort(); });
    const signal = controller.signal;
    let route = safeRoute(request.route), mode = route.mode, escalated = false, contentRetries = 0, correction = '';
    const emit = (event: RequestEvent) => ignored(() => d.event?.(event));
    const eventIdentity: EventIdentity = { feature: identity.feature, kind: identity.kind, trigger: identity.trigger };
    const decision = (value: RecoveryDecision) => {
      recovery.push(value);
      emit({ ...eventIdentity, type: 'recovery', recovery: value });
      if (value.decision === 'switch' || value.decision === 'preflightSkip') {
        if (value.decision === 'switch')
          ignored(() => d.log?.(`[provider switch] ${providerSwitchMessage(value.from, value.to, value.cause)}`));
      } else ignored(() => d.log?.(`[request recovery] ${identity.feature} ${identity.kind} ${value.decision}`));
    };
    const check = () => {
      const boundary = requestBoundary(identity.signal.aborted, expired, now(), budget.deadline);
      if (boundary === 'canceled') throw new DOMException('Canceled.', 'AbortError');
      if (boundary === 'deadline') throw new CenterFailure('deadline', route);
      signal.throwIfAborted();
    };
    const fail = (cause: FailureCause, attemptedRoute?: RequestRoute): RequestOutcome<T> => ({ type: 'failed', cause, attemptedRoute,
      actions: failureActions(cause),
      preservation: request.preservation ?? 'none', history, recovery });
    const attemptsFor = (selected: RequestRoute) => centerTransportAttempts(policy.policy, identity.kind, request.route.provider, selected.provider, policy.transportAttempts);
    const asTutorRoute = (selected: RequestRoute): TutorLanguageModelRoute => ({ ...selected, thinkingOrEffort: selected.effort,
      fallbackEnabled: false, fallbackModel: '', fallbackThinkingOrEffort: 'auto' });
    const fromTutorRoute = (selected: TutorLanguageModelRoute): RequestRoute => safeRoute({ ...selected, mode, effort: selected.thinkingOrEffort });
    const perform = async (selected: RequestRoute): Promise<{ value: T; warnings: readonly FindingCode[]; route: RequestRoute }> => {
      route = selected;
      check();
      if (d.exhaustion.isExhausted(selected)) {
        ignored(() => d.log?.(`[provider skip] ${selected.provider} ${identifier(selected.model)} quota exhausted this session`));
        throw new CenterFailure('quotaExhausted', selected, 429);
      }
      const attempts = attemptsFor(selected);
      for (let index = 0; index < attempts; index += 1) {
        check();
        const key = JSON.stringify(selected), used = counts.get(key) ?? 0;
        if (!routeBudgetAvailable(history.length, used, budget.totalRequests, budget.perRouteAttempts)) throw new CenterFailure('budget', selected);
        counts.set(key, used + 1);
        const entry: AttemptHistory = { attempt: history.length + 1, route: safeRoute(selected), outcome: 'failed', codes: [] };
        history.push(entry);
        let response: TransportResponse | undefined, exception: unknown;
        try {
          // Always rebuild from the original authorized payload. No previous answer can enter a retry.
          response = await d.transport({ instruction: request.payload.instruction + (correction ? `\n\n${correction}` : ''),
            input: request.payload.input }, { ...selected }, signal);
        } catch (error) { exception = error; }
        const tokens = reportedLanguageModelUsage(selected.provider, response?.envelope);
        emit({ ...eventIdentity, type: 'usage', attempt: entry.attempt, route: entry.route, ...tokens });
        const localRequest = { feature: identity.feature, ...entry.route };
        // Reconstruct only count fields for the existing recorder, never pass response content to a sink.
        ignored(() => usage.record(localRequest, selected.provider === 'gemini'
          ? { usageMetadata: { promptTokenCount: tokens.input, candidatesTokenCount: tokens.output, thoughtsTokenCount: tokens.thinking } }
          : { usage: { prompt_tokens: tokens.input, completion_tokens: tokens.output } }));
        if (identity.signal.aborted || signal.aborted || now() >= budget.deadline) {
          entry.outcome = 'canceled'; check();
        }
        const status = response?.status ?? (exception instanceof ProviderError ? exception.status : undefined);
        entry.status = status;
        let cause: FailureCause | undefined, retryable = false, diagnostic = 'no response', validationEscalation = false;
        if (!response) {
          cause = exception instanceof ProviderError && exception.reason === 'refused' ? 'refused'
            : exception instanceof ProviderError && exception.reason === 'structuredOutput' ? 'unreadableOutput'
            : exception instanceof ProviderError && exception.reason === 'quotaExhausted' ? 'quotaExhausted'
              : exception instanceof ProviderError && exception.reason === 'overloaded' ? 'overloaded' : 'noResponse';
          retryable = cause === 'noResponse' && (!(exception instanceof ProviderError) || exception.retryable);
          validationEscalation = cause === 'unreadableOutput';
          diagnostic = cause === 'refused' ? 'request refused' : cause === 'unreadableOutput' ? 'unreadable output'
            : status === undefined ? 'no response' : httpFailure(selected.provider, status);
        } else if (response.status < 200 || response.status >= 300) {
          ({ cause, retryable } = classifyRequestStatus(selected.provider, response.status, response.envelope));
          diagnostic = httpFailure(selected.provider, response.status, response.envelope);
        } else {
          let validation: ValidationResult<T>;
          try {
            validation = response.output === 'refused' ? { type: 'rejected', cause: 'refused', codes: ['refused'] }
              : response.output === 'empty' ? { type: 'rejected', cause: 'unreadableOutput', codes: ['unreadableOutput'] }
                : await request.validate(response.value, { ...selected });
          } catch { validation = { type: 'rejected', cause: 'contentRejected', codes: ['contentRejected'] }; }
          if (identity.signal.aborted || signal.aborted || now() >= budget.deadline) { entry.outcome = 'canceled'; check(); }
          if (validation.type !== 'rejected') {
            const warnings = validation.type === 'accepted' ? [] : safeCodes(validation.warnings);
            entry.outcome = validation.type; entry.codes = warnings;
            if (validation.type === 'salvaged') decision({ decision: 'salvage', route: entry.route, codes: warnings });
            return { value: validation.value, warnings, route: entry.route };
          }
          cause = validation.cause;
          entry.codes = safeCodes(validation.codes);
          validationEscalation = cause === 'unreadableOutput';
          diagnostic = cause === 'refused' ? 'request refused' : 'unreadable output';
        }
        entry.cause = cause;
        emit({ ...eventIdentity, type: 'failure', attempt: entry.attempt, route: entry.route, cause, status, codes: entry.codes, diagnostic });
        ignored(() => usage.failure(localRequest, diagnostic));
        const failure = new CenterFailure(cause, selected, status, retryable, validationEscalation);
        if (cause === 'quotaExhausted') d.exhaustion.mark(selected, failure);
        if (!retryAttempt(retryable, index, attempts)) throw failure;
        const milliseconds = requestRetryDelay(selected.provider, index, response?.retryAfter, response?.envelope, now, d.random);
        if (now() + milliseconds >= budget.deadline) throw new CenterFailure('deadline', selected);
        await delay(milliseconds, signal);
      }
      throw new CenterFailure('budget', selected);
    };
    try {
      for (;;) {
        check();
        const model = policy.policy.modeRouting === 'tutorModels' ? mode === 'fast'
            ? thinking.fastModel(request.route.provider, request.route.fastModel, request.route.thoroughModel ?? request.route.model)
            : thinking.model(request.route.provider, mode, request.route.thoroughModel ?? request.route.model) : request.route.model;
        const initial = safeRoute({ ...request.route, mode, model,
          effort: thinking.effort(request.route.provider, model,
            mode, request.route.thoroughEffort ?? request.route.effort) });
        let switchEvent: Extract<RecoveryDecision, { decision: 'switch' | 'preflightSkip' }> | undefined;
        const switchDependencies: ProviderSwitchDependencies = {
          enabled: policy.providerSwitch, order: policy.providerOrder ?? DEFAULT_PROVIDER_ORDER, state: d.exhaustion,
          hasCredentials: async provider => {
            check();
            if (history.length >= budget.totalRequests) throw new CenterFailure('budget', route);
            const result = await d.hasCredentials(provider); check(); return result;
          },
          // The typed decision presenter owns logging. Legacy quiet preflight and popup suppression remain in the helper.
          notice: () => {
            if (switchEvent) {
              const event = switchEvent;
              ignored(() => d.notice?.(providerSwitchMessage(event.from, event.to, event.cause)));
            }
          },
          skip: skipped => ignored(() => d.log?.(`[provider skip] ${skipped.provider} ${identifier(skipped.model)} quota exhausted this session`)),
          decision: event => {
            switchEvent = { decision: event.preflight ? 'preflightSkip' : 'switch', cause: event.cause,
              from: safeRoute({ ...(event.preflight ? initial : route), ...event.from }), to: fromTutorRoute(event.to) };
            decision(switchEvent);
          }
        };
        try {
          const result = await (d.switching ?? runWithProviderSwitch)(asTutorRoute(initial), mode, signal, async selected => {
            const current = fromTutorRoute(selected);
            try { return await perform(current); }
            catch (error) {
              check();
              const fallback = request.route.fallback;
              if (!(error instanceof CenterFailure) || !fallback || !shouldFallback({ providerError: true, status: error.status, reason: error.reason }, current,
                  { enabled: true, model: fallback.model }, false, policy.providerSwitch)) throw error;
              const next = safeRoute({ ...current, model: fallback.model, effort: fallback.effort });
              decision({ decision: 'fallback', from: current, to: next });
              return perform(next);
            }
          }, switchDependencies);
          return { type: 'accepted', ...result, history, recovery };
        } catch (error) {
          check();
          if (!(error instanceof CenterFailure)) {
            if (error instanceof ProviderError && error.reason === 'quotaExhausted') return fail('quotaExhausted', route);
            return fail('noResponse', history.at(-1)?.route);
          }
          const last = history.at(-1);
          const nextRecovery = recoveryAfterFailure({ mode, aborted: signal.aborted, escalated, escalation: policy.escalation,
            validationFailure: error.validationEscalation, escalationEligible: thinking.canEscalate(mode, signal.aborted, error.validationEscalation), cause: error.cause,
            contentRetries, allowance: policy.contentRetry.allowance, codes: last?.codes ?? [], on: policy.contentRetry.on });
          if (nextRecovery === 'escalation') {
            escalated = true; mode = 'thorough';
            decision({ decision: 'escalation', from: safeRoute(route), to: safeRoute({ ...initial, mode,
              model: policy.policy.modeRouting === 'tutorModels' ? thinking.model(initial.provider, mode, request.route.thoroughModel ?? request.route.model) : initial.model,
              effort: thinking.effort(initial.provider, request.route.thoroughModel ?? initial.model, mode, request.route.thoroughEffort ?? request.route.effort) }) });
            continue;
          }
          if (nextRecovery === 'contentRetry' && last) {
            contentRetries += 1; correction = policy.contentRetry.correctiveInstruction;
            decision({ decision: 'contentRetry', route: safeRoute(route), codes: last.codes }); continue;
          }
          return fail(error.cause, history.at(-1)?.route);
        }
      }
    } catch (error) {
      if (identity.signal.aborted) return { type: 'canceled', history, recovery };
      return fail(expired || now() >= budget.deadline ? 'deadline' : error instanceof CenterFailure ? error.cause : 'noResponse', history.at(-1)?.route);
    } finally { unschedule(); identity.signal.removeEventListener('abort', abort); }
  }
}

type FailedRequest = Extract<RequestOutcome<never>, { type: 'failed' }>;
export type CredentialProvider = LanguageModelRoutingProvider | 'googleCloudTranslation' | 'googleCloudTextToSpeech' |
  'merriamWebsterCollegiate' | 'merriamWebsterMedical' | 'merriamWebsterThesaurus' | 'koreanDictionary';
export interface MissingCredentials {
  provider: CredentialProvider;
  geminiProfile?: 'standard' | 'pro';
  slots: readonly string[];
  action: 'openCredentials';
}
export const OPEN_CREDENTIALS = 'Open Credentials';
export function credentialProviderName(provider: CredentialProvider, profile: 'standard' | 'pro' = 'standard'): string {
  const credentialNames: Record<CredentialProvider, string> = {
    gemini: 'Gemini', groq: 'Groq', cloudflare: 'Cloudflare', openai: 'OpenAI', anthropic: 'Anthropic',
    googleCloudTranslation: 'Google Cloud Translation', googleCloudTextToSpeech: 'Google Cloud Text-to-Speech',
    merriamWebsterCollegiate: 'Merriam-Webster Collegiate', merriamWebsterMedical: 'Merriam-Webster Medical',
    merriamWebsterThesaurus: 'Merriam-Webster Collegiate Thesaurus', koreanDictionary: 'Korean Basic Dictionary'
  };
  return credentialNames[provider] + (provider === 'gemini' ? profile === 'pro' ? ' Paid' : ' Free Tier' : '');
}
/** This descriptor contains presence information only, never credential values. */
export function missingCredentialDetails(provider: CredentialProvider, geminiProfile: 'standard' | 'pro' = 'standard',
  slots: readonly string[] = provider === 'cloudflare' ? ['account ID', 'API token']
    : provider === 'googleCloudTextToSpeech' ? ['Google Cloud Text-to-Speech API key', 'Google Cloud Translation API key'] : ['API key']): MissingCredentials {
  return { provider, ...(provider === 'gemini' ? { geminiProfile } : {}), slots: [...slots], action: 'openCredentials' };
}
export interface GeminiCredentialPresence { geminiDefault?: boolean; geminiAlternate?: boolean }
/** Uses presence only so initial rendering and mounted setting updates share one rule. */
export function otherGeminiProfileMessage(provider: string, profile: string, presence: GeminiCredentialPresence = {}): string {
  if (provider !== 'gemini') return '';
  const selected = profile === 'pro' ? presence.geminiAlternate : presence.geminiDefault;
  const other = profile === 'pro' ? presence.geminiDefault : presence.geminiAlternate;
  if (selected || !other) return '';
  const name = profile === 'pro' ? 'Free Tier' : 'Paid';
  return ` Gemini ${name} has a key: choose ${name} in this feature's settings to use it.`;
}
export function missingCredentialMessage(details: MissingCredentials, presence?: GeminiCredentialPresence): string {
  const name = credentialProviderName(details.provider, details.geminiProfile);
  const message = details.provider === 'googleCloudTextToSpeech'
    ? 'Set your Google Cloud Text-to-Speech API key or Google Cloud Translation API key in KREN menu, Credentials.'
    : `Set ${details.provider === 'cloudflare' ? 'the' : 'your'} ${name} ${details.slots.join(' and ')} in KREN menu, Credentials.`;
  return message + otherGeminiProfileMessage(details.provider, details.geminiProfile ?? 'standard', presence);
}
export function missingCredentialSelectionMessage(details: MissingCredentials, presence?: GeminiCredentialPresence): string {
  return `No ${credentialProviderName(details.provider, details.geminiProfile)} ${details.provider === 'cloudflare' ? details.slots.join(' and ') : 'key'} yet.` +
    otherGeminiProfileMessage(details.provider, details.geminiProfile ?? 'standard', presence);
}
export class MissingCredentialError extends ProviderError {
  constructor(readonly missingCredentials: MissingCredentials) {
    const actions: Partial<Record<CredentialProvider, ProviderError['action']>> = {
      googleCloudTranslation: 'setGoogleCloudTranslationKey', merriamWebsterCollegiate: 'setMerriamWebsterCollegiateKey',
      merriamWebsterMedical: 'setMerriamWebsterMedicalKey', merriamWebsterThesaurus: 'setMerriamWebsterThesaurusKey', koreanDictionary: 'setDictionaryKey'
    };
    super(missingCredentialMessage(missingCredentials), actions[missingCredentials.provider] ??
      (['gemini', 'openai', 'anthropic', 'groq', 'cloudflare'].includes(missingCredentials.provider)
        ? providerCredentialAction({ provider: missingCredentials.provider as LanguageModelRoutingProvider,
          geminiProfile: missingCredentials.geminiProfile ?? 'standard' }) : undefined));
    this.name = 'MissingCredentialError';
  }
}
export function missingCredentialError(provider: CredentialProvider, profile: 'standard' | 'pro' = 'standard',
  slots?: readonly string[]): MissingCredentialError {
  const error = new MissingCredentialError(missingCredentialDetails(provider, profile, slots));
  outcomes.set(error, missingCredentialFailure(error.missingCredentials));
  return error;
}
function missingCredentialFailure(missingCredentials: MissingCredentials, attemptedRoute?: RequestRoute,
  history: AttemptHistory[] = [], recovery: RecoveryDecision[] = []): FailedRequest {
  return { type: 'failed', cause: 'missingCredentials', missingCredentials, attemptedRoute,
    actions: ['setCredential'], preservation: 'none', history, recovery };
}
export function missingCredentialsOf(error: unknown): MissingCredentials | undefined {
  return error instanceof MissingCredentialError ? error.missingCredentials : recordedRequestOutcome(error)?.type === 'failed'
    ? (recordedRequestOutcome(error) as FailedRequest).missingCredentials : undefined;
}
/** Uses the V292 choice boundary, which routes questions to a native modal dialog. */
export async function showMissingCredentialNotice(details: MissingCredentials,
  host: { showErrorMessage(message: string, options: { modal: true }, choice: string): PromiseLike<string | undefined>; showCredentials(): PromiseLike<void>;
    credentialPresence?(): GeminiCredentialPresence | undefined },
  continuation = '', offerProviderChoice = false, offerOtherGeminiProfile = offerProviderChoice): Promise<void> {
  // A feature's dictionary lookup may still target a fixed reference work.
  const chooseAnother = offerProviderChoice &&
    !['merriamWebsterCollegiate', 'merriamWebsterMedical', 'merriamWebsterThesaurus', 'koreanDictionary'].includes(details.provider);
  const message = missingCredentialMessage(details, offerOtherGeminiProfile ? host.credentialPresence?.() : undefined) + (chooseAnother ? ' Or press Cancel and choose another provider.' : '') +
    (continuation ? ` ${continuation}` : '');
  const selected = await host.showErrorMessage(message, { modal: true }, OPEN_CREDENTIALS);
  if (selected === OPEN_CREDENTIALS) await host.showCredentials();
}
const outcomes = new WeakMap<object, RequestOutcome<unknown>>();
const terminalErrors = new WeakMap<object, unknown>();
export function recordedRequestOutcome(value: unknown): RequestOutcome<unknown> | undefined {
  return value && typeof value === 'object' ? outcomes.get(value) : undefined;
}
export function centeredProviderError(error: ProviderError, route: TutorLanguageModelRoute): ProviderError {
  const outcome = requestFailure(error, safeRoute({ ...route, mode: 'thorough', effort: route.thinkingOrEffort }));
  outcomes.set(error, outcome);
  terminalErrors.set(outcome, error);
  return error;
}
export function providerCredentialAction(route: Pick<RequestRoute, 'provider' | 'geminiProfile'>): NonNullable<ProviderError['action']> {
  return route.provider === 'gemini' ? route.geminiProfile === 'pro' ? 'setGeminiProKey' : 'setGeminiKey'
    : route.provider === 'groq' ? 'setGroqKey' : route.provider === 'cloudflare' ? 'setCloudflareCredentials'
      : route.provider === 'openai' ? 'setOpenAIKey' : 'setAnthropicKey';
}
const providerName = (provider?: LanguageModelRoutingProvider): string => provider === 'gemini' ? 'Gemini'
  : provider === 'groq' ? 'Groq' : provider === 'cloudflare' ? 'Cloudflare' : provider === 'openai' ? 'OpenAI'
    : provider === 'anthropic' ? 'Anthropic' : 'The provider';

/** Compatibility at host boundaries, where a local error may predate a centered request. */
export function requestFailure(error: unknown, route: RequestRoute, history: AttemptHistory[] = [],
  recovery: RecoveryDecision[] = []): FailedRequest {
  const missingCredentials = missingCredentialsOf(error);
  if (missingCredentials) return missingCredentialFailure(missingCredentials, safeRoute(route), history, recovery);
  const failure = error instanceof ProviderError ? error : undefined;
  const cause = compatibilityFailureCause({ providerError: Boolean(failure), budget: error instanceof RequestBudgetError, status: failure?.status, reason: failure?.reason, retryable: failure?.retryable,
    malformed: error instanceof SyntaxError || error instanceof Error && error.name === 'UserDictionaryMalformedOutputError',
    credentialAction: Boolean(failure?.action?.startsWith('set')) }, route.provider);
  return { type: 'failed', cause, attemptedRoute: safeRoute(failure?.attemptedRoute ? { ...route, ...failure.attemptedRoute } : route),
    actions: failureActions(cause, Boolean(failure?.retryable), false),
    preservation: 'none', history, recovery };
}

/** One presenter owns provider, cause and permitted-action wording. Context keeps literal UI contracts. */
export function presentRequestFailure(outcome: FailedRequest, context: {
  conversation?: boolean; opening?: boolean; quotaCategory?: GeminiQuotaCategory; rejectedModel?: boolean
} = {}): { message: string; actions: readonly ReaderAction[]; credentialAction?: ProviderError['action']; quotaActionLabel?: string } {
  const route = outcome.attemptedRoute, name = providerName(route?.provider);
  const status = outcome.history.at(-1)?.status;
  const fallbackBusy = outcome.recovery.some(item => item.decision === 'fallback' &&
    outcome.history.some(attempt => attempt.route.provider === item.to.provider && attempt.route.model === item.to.model &&
      (attempt.cause === 'overloaded' || attempt.cause === 'rateLimit' || attempt.status === 503)));
  let message: string;
  if (outcome.cause === 'missingCredentials' && outcome.missingCredentials) {
    message = missingCredentialMessage(outcome.missingCredentials);
  } else if (outcome.cause === 'quotaExhausted') {
    const window = context.quotaCategory === 'perDay' ? ' daily'
      : context.quotaCategory === 'perMinute' ? ' per-minute'
        : context.quotaCategory === 'perHour' ? ' hourly' : '';
    message = `${name}${window} quota is exhausted; check its limit or billing before retrying.`;
  } else if (outcome.cause === 'authenticationRejected') {
    message = route ? missingCredentialMessage(missingCredentialDetails(route.provider, route.geminiProfile))
      : 'Check your provider credential in KREN menu, Credentials.';
  } else if (outcome.cause === 'overloaded' || outcome.cause === 'rateLimit') {
    message = fallbackBusy ? `${name} is busy right now, and so was the fallback model; try again in a moment.`
      : context.conversation ? `${name} is busy right now; try again, or turn on Automatic fallback in LLM ROUTING.`
        : `${name} request failed${status ? ` (${status})` : ''}. It is busy right now; try again in a moment.`;
  } else if (context.conversation && context.rejectedModel) {
    message = `${name} rejected the selected model for ordinary requests; change ${route?.provider === 'gemini' && route.geminiProfile === 'pro' ? 'kren.tutor.alternateModel' : 'kren.tutor.model'} in LLM ROUTING and try again.`;
  } else if (context.conversation) {
    message = context.opening ? `${name} could not open this conversation; check LLM ROUTING and try again.`
      : `${name} could not complete this conversation request; check LLM ROUTING and try again.`;
  } else {
    const cause = outcome.cause === 'unreadableOutput' ? 'It returned unreadable output.'
      : outcome.cause === 'refused' ? 'It declined this request.'
        : outcome.cause === 'requestRejected' ? 'Check the selected model in LLM ROUTING.'
          : 'Try again in a moment.';
    message = `${name} request failed${status ? ` (${status})` : ''}. ${cause}`;
  }
  const credentialAction = !outcome.actions.includes('setCredential') || !route ? undefined : providerCredentialAction(route);
  return { message, actions: outcome.actions, credentialAction,
    quotaActionLabel: outcome.actions.includes('checkQuota') ? 'Check Quota and Billing' : undefined };
}

/** Existing host interfaces still return values or throw; their errors carry the typed outcome locally. */
export function unwrapRequestOutcome<T>(outcome: RequestOutcome<T>): T {
  if (outcome.type === 'accepted') return outcome.value;
  if (outcome.type === 'canceled') throw new DOMException('Canceled.', 'AbortError');
  const original = terminalErrors.get(outcome);
  // Feature validators retain their reader detail; the typed outcome carries safe diagnostics.
  if (!(original instanceof ProviderError)) {
    if (original && typeof original === 'object') outcomes.set(original, outcome);
    throw original ?? new Error(presentRequestFailure(outcome).message);
  }
  outcomes.set(original, outcome);
  throw original;
}

export interface FeatureRequest<T> {
  runtime: KrenRuntime;
  route: TutorLanguageModelRoute;
  policy: RequestPolicy;
  signal: AbortSignal;
  thinking: { kind: RequestFeature | 'translation' | 'explanation'; text: string; retry?: boolean } | { tutor: TutorStructuredGenerationRequest };
  geminiDefaultAttempts?: number;
  execute(route: TutorLanguageModelRoute, mode: ThinkingMode, signal: AbortSignal,
    request: TutorStructuredGenerationRequest | undefined, maxAttempts: number): Promise<T>;
}

/** Run 3 boundary: one owner of feature recovery; requestWithRetry still owns each route's transport loop. */
export async function runFeatureRequest<T>(request: FeatureRequest<T>): Promise<RequestOutcome<T>> {
  const { runtime, policy } = request;
  const exhaustion = providerSwitchDependencies(runtime).state;
  // A distinct signal isolates concurrent requests, including independent batch items.
  const controller = new AbortController(), abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) abort();
  const signal = controller.signal, history: AttemptHistory[] = [], recovery: RecoveryDecision[] = [];
  const budget = requestBudgets.get(request.signal);
  if (budget) requestBudgets.set(signal, budget);
  const content = contentAttempts.get(request.signal);
  if (content) contentAttempts.set(signal, content);
  const observedAttempts = new WeakMap<object, Map<number, AttemptHistory>>();
  let active: RequestRoute = { ...request.route, mode: 'thorough', effort: request.route.thinkingOrEffort };
  const log = (line: string) => ignored(() => runtime.log?.(line));
  attemptObservers.set(signal, event => {
    if (event.type === 'usage') {
      const entry: AttemptHistory = { attempt: history.length + 1, route: safeRoute(active), outcome: 'accepted', codes: [] };
      history.push(entry);
      const attempts = observedAttempts.get(event.request) ?? new Map<number, AttemptHistory>();
      attempts.set(event.attempt, entry); observedAttempts.set(event.request, attempts);
    }
    else {
      const entry = observedAttempts.get(event.request)?.get(event.attempt);
      if (entry) { entry.outcome = 'failed'; entry.cause = event.cause; entry.status = event.status; }
    }
  });
  const perform = async (route: TutorLanguageModelRoute, mode: ThinkingMode, tutor?: TutorStructuredGenerationRequest) => {
    signal.throwIfAborted();
    active = safeRoute({ ...route, mode, effort: route.thinkingOrEffort });
    if (exhaustion.isExhausted(active)) {
      log(`[provider skip] ${active.provider} ${identifier(active.model)} quota exhausted this session`);
      throw exhaustion.quotaFailure(active);
    }
    const start = history.length;
    const provider = policy.switchedAttemptSettings === 'originalProvider' ? request.route.provider : route.provider;
    const prefix = provider === 'gemini' ? 'gemini.retry' : 'languageModel.retry';
    const configured = runtime.getSetting<boolean>(`${prefix}.enabled`, true)
      ? runtime.getSetting<number>(`${prefix}.maxAttempts`, provider === 'gemini' ? request.geminiDefaultAttempts ?? 3 : 3) : 1;
    const maxAttempts = boundedTransportAttempts(configured, tutor?.kind === 'conversationOpening', policy.openingAttemptCap ?? 5);
    try { return await request.execute(route, mode, signal, tutor, maxAttempts); }
    catch (error) {
      if (signal.aborted) {
        const last = history.at(-1);
        if (last?.outcome === 'accepted') last.outcome = 'canceled';
        throw error;
      }
      // Content validation can reject after a successful transport decode.
      const failed = requestFailure(error, active).cause;
      if (error instanceof ProviderError && error.reason === 'quotaExhausted') exhaustion.mark(active, error);
      if (history.length > start) Object.assign(history.at(-1)!, { outcome: 'failed', cause: failed });
      throw error;
    }
  };
  const fallback = async (error: unknown, selected: TutorLanguageModelRoute, mode: ThinkingMode, tutor?: TutorStructuredGenerationRequest): Promise<T> => {
    const tutorFallback = 'tutor' in request.thinking;
    if (tutorFallback && mode !== 'thorough') throw error;
    const model = tutorFallback
      ? tutorFastModel(selected.provider, request.route.fastModel ?? runtime.getSetting('tutor.hintModel', TUTOR_DEFAULTS.configuration['tutor.hintModel']), request.route.model).trim()
      : selected.fallbackModel.trim();
    if (!shouldFallback({ providerError: error instanceof ProviderError, status: error instanceof ProviderError ? error.status : undefined,
      reason: error instanceof ProviderError ? error.reason : undefined }, selected, { enabled: selected.fallbackEnabled, model },
      signal.aborted, false) || !shouldFallback({ providerError: error instanceof ProviderError,
        status: error instanceof ProviderError ? error.status : undefined, reason: error instanceof ProviderError ? error.reason : undefined },
        selected, { enabled: selected.fallbackEnabled, model }, signal.aborted, runtime.getSetting('llm.providerSwitch', true))) throw error;
    const next = { ...selected, model, thinkingOrEffort: tutorFallback
      ? tutorFastEffort(selected.provider, model, request.route.fastThinkingOrEffort ?? runtime.getSetting('tutor.hintThinkingOrEffort', 'auto'))
      : selected.fallbackThinkingOrEffort };
    recovery.push({ decision: 'fallback', from: safeRoute(active), to: safeRoute({ ...next, mode, effort: next.thinkingOrEffort }) });
    log(`[request recovery] ${'tutor' in request.thinking ? request.thinking.tutor.kind : request.thinking.kind} fallback`);
    return perform(next, mode, tutor);
  };
  const generate = (route: TutorLanguageModelRoute, mode: ThinkingMode, tutor?: TutorStructuredGenerationRequest) => {
    if (history.length && active.mode === 'fast' && mode === 'thorough') recovery.push({ decision: 'escalation',
      from: safeRoute(active), to: safeRoute({ ...route, mode, effort: route.thinkingOrEffort }) });
    const dependencies = providerSwitchDependencies(runtime);
    dependencies.log = log;
    dependencies.notice = message => ignored(() => runtime.providerSwitchNotice?.(message));
    dependencies.skip = skipped => log(`[provider skip] ${skipped.provider} ${identifier(skipped.model)} quota exhausted this session`);
    dependencies.decision = event => recovery.push({ decision: event.preflight ? 'preflightSkip' : 'switch', cause: event.cause,
      from: safeRoute({ ...active, ...event.from }), to: safeRoute({ ...event.to, mode, effort: event.to.thinkingOrEffort }) });
    return runWithProviderSwitch(route, mode, signal, async selected => {
      try { return await perform(selected, mode, tutor); }
      catch (error) {
        if (policy.fallbackPlacement === 'afterThinking') throw error;
        return fallback(error, selected, mode, tutor);
      }
    }, dependencies);
  };
  try {
    let value: T;
    try {
      value = 'tutor' in request.thinking
        ? request.thinking.tutor.thinkingMode
          ? await generate(request.route, request.thinking.tutor.thinkingMode, request.thinking.tutor)
          : await runTutorThinking(request.thinking.tutor, request.route, signal,
          (tutor, route) => generate(route, tutor.thinkingMode ?? 'thorough', tutor), log) as T
        : await runAdaptiveThinking(request.thinking.kind, request.thinking.text, signal, mode => generate({ ...request.route,
          thinkingOrEffort: modeEffort(request.route.provider, request.route.model, mode, request.route.thinkingOrEffort) }, mode),
          log, request.thinking.retry);
    } catch (error) {
      if (policy.fallbackPlacement !== 'afterThinking') throw error;
      value = await fallback(error, request.route, 'thorough');
    }
    const outcome: RequestOutcome<T> = { type: 'accepted', value, warnings: [], route: safeRoute(active), history, recovery };
    if (value && typeof value === 'object') outcomes.set(value, outcome);
    return outcome;
  } catch (error) {
    if (signal.aborted) {
      const last = history.at(-1);
      if (last?.outcome === 'accepted') last.outcome = 'canceled';
      return { type: 'canceled', history, recovery };
    }
    const outcome = requestFailure(error, active, history, recovery);
    terminalErrors.set(outcome, error);
    return outcome;
  } finally {
    attemptObservers.delete(signal);
    requestBudgets.delete(signal);
    contentAttempts.delete(signal);
    request.signal.removeEventListener('abort', abort);
  }
}

export type ContentValidation<T> = ValidationResult<T> & { correctiveInstruction?: string; error?: unknown };
export interface TutorContentRequest<T> {
  request: TutorStructuredGenerationRequest;
  route: TutorLanguageModelRoute;
  signal: AbortSignal;
  generate(request: TutorStructuredGenerationRequest, route: TutorLanguageModelRoute, signal: AbortSignal): Promise<unknown>;
  validate(value: unknown, contentAttempt: number): ContentValidation<T>;
  contentRetry: { allowance: number; on?: readonly FindingCode[] };
  /** A batch item or a card already produced by the same explicit action needs no initial send. */
  initial?: { value: unknown; source?: unknown };
  totalRequests?: number;
  trigger?: RequestIdentity['trigger'];
  event?: (event: RequestEvent) => void;
  log(line: string): void;
}

/** Features own acceptance and normalization. The center alone executes authorized content recovery. */
export async function runTutorContentRequest<T>(request: TutorContentRequest<T>): Promise<T> {
  const controller = new AbortController(), abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) abort();
  const signal = controller.signal;
  const content: { reject?: (cause: FailureCause) => void } = {};
  const rejectContent = (cause: FailureCause) => content.reject?.(cause);
  contentAttempts.set(signal, content);
  // Five attempts, five providers, model fallback and thinking, for each content attempt.
  requestBudgets.set(signal, requestBudgets.get(request.signal) ??
    { remaining: request.totalRequests ?? 100 * (1 + request.contentRetry.allowance) });
  const history: AttemptHistory[] = [], recovery: RecoveryDecision[] = [];
  let active = safeRoute({ ...request.route, mode: 'thorough', effort: request.route.thinkingOrEffort });
  let selected = request.request;
  const decision = (value: RecoveryDecision) => {
    recovery.push(value);
    const kind = request.request.kind;
    if (kind !== 'liveSessionCredential') ignored(() => request.event?.({ type: 'recovery', feature: 'tutor', kind,
      trigger: request.trigger ?? 'explicitAction', recovery: value }));
    ignored(() => request.log(`[request recovery] ${identifier(request.request.kind)} ${value.decision}`));
  };
  const collect = (source: unknown) => {
    const outcome = recordedRequestOutcome(source);
    if (!outcome) return;
    for (const entry of outcome.history) history.push({ ...entry, attempt: history.length + 1 });
    recovery.push(...outcome.recovery);
    if (outcome.type === 'accepted') active = outcome.route;
    else if (outcome.type === 'failed' && outcome.attemptedRoute) active = outcome.attemptedRoute;
  };
  try {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      let source: unknown;
      content.reject = undefined;
      try {
        source = attempt === 0 && request.initial ? request.initial.value
          : await request.generate(selected, request.route, signal);
      } catch (error) { collect(error); throw error; }
      signal.throwIfAborted();
      collect(source);
      const validationSource = attempt === 0 && request.initial ? request.initial.source ?? source : source;
      let checked: ContentValidation<T>;
      try {
        checked = request.validate(source, attempt);
      } catch (error) { checked = { type: 'rejected', cause: 'contentRejected', codes: ['contentRejected'], error }; }
      signal.throwIfAborted();
      const last = history.at(-1);
      if (checked.type !== 'rejected') {
        const warnings = checked.type === 'accepted' ? [] : safeCodes(checked.warnings);
        if (last) Object.assign(last, { outcome: checked.type, codes: warnings });
        if (checked.type === 'salvaged') decision({ decision: 'salvage', route: active, codes: warnings });
        validateLanguageModelOutput(validationSource, () => checked.value);
        const outcome: RequestOutcome<T> = { type: 'accepted', value: checked.value, warnings, route: active, history, recovery };
        if (checked.value && typeof checked.value === 'object') outcomes.set(checked.value, outcome);
        return checked.value;
      }
      const codes = safeCodes(checked.codes);
      // The transport's gate records exactly once, including deferred Thorough validation.
      rejectContent(checked.cause);
      try { validateLanguageModelOutput(validationSource, () => { throw checked.error ?? new Error('Content rejected.'); }); } catch { /* The shared gate records the rejection once. */ }
      if (last) Object.assign(last, { outcome: 'failed', cause: checked.cause, codes });
      if (shouldRetryContent(checked.cause, attempt, request.contentRetry.allowance, codes, request.contentRetry.on)) {
        decision({ decision: 'contentRetry', route: active, codes });
        selected = { ...request.request, retry: true, instruction: request.request.instruction +
          (checked.correctiveInstruction ? `\n\n${checked.correctiveInstruction}` : '') };
        continue;
      }
      const error = checked.error ?? new ProviderError('The provider returned unreadable content.', undefined, false, undefined, 'structuredOutput');
      const outcome = requestFailure(error, active, history, recovery);
      outcome.cause = checked.cause;
      if (error && typeof error === 'object') outcomes.set(error, outcome);
      throw error;
    }
  } catch (error) {
    const known = recordedRequestOutcome(error);
    const outcome: RequestOutcome<never> = signal.aborted ? { type: 'canceled', history, recovery }
      : { ...requestFailure(error, active, history, recovery), ...(known?.type === 'failed' ? { cause: known.cause } : {}) };
    if (error && typeof error === 'object') outcomes.set(error, outcome);
    throw error;
  } finally {
    requestBudgets.delete(signal);
    contentAttempts.delete(signal);
    request.signal.removeEventListener('abort', abort);
  }
}

/** The injected panel action may be a host adapter. Resolved mode metadata gives thinking exactly one owner. */
export async function runTutorGeneration(request: {
  request: TutorStructuredGenerationRequest; route: TutorLanguageModelRoute; policy: RequestPolicy; signal: AbortSignal;
  generate: Parameters<typeof runTutorThinking>[3]; log: (line: string) => void;
}): Promise<RequestOutcome<unknown>> {
  let actual: RequestRoute = safeRoute({ ...request.route, mode: 'thorough', effort: request.route.thinkingOrEffort });
  const history: AttemptHistory[] = [], recovery: RecoveryDecision[] = [];
  let latest: RequestOutcome<unknown> | undefined;
  const collect = (value: unknown) => {
    latest = recordedRequestOutcome(value);
    if (!latest) return;
    for (const entry of latest.history) { entry.attempt = history.length + 1; history.push(entry); }
    recovery.push(...latest.recovery);
  };
  try {
    const route = request.policy.modeRouting === 'tutorModels' ? request.route : { ...request.route, fastModel: request.route.model };
    const value = await runTutorThinking(request.request, route, request.signal, (selected, route, signal) => {
      const next = safeRoute({ ...route, mode: selected.thinkingMode ?? 'thorough', effort: route.thinkingOrEffort });
      if (history.length && actual.mode === 'fast' && next.mode === 'thorough')
        recovery.push({ decision: 'escalation', from: actual, to: next });
      actual = next;
      return request.generate(selected, route, signal).then(value => { signal.throwIfAborted(); collect(value); return value; }, error => { collect(error); throw error; });
    }, line => ignored(() => request.log(line)));
    const outcome: RequestOutcome<unknown> = { type: 'accepted', value, route: latest?.type === 'accepted' ? latest.route : actual,
      history, recovery, warnings: latest?.type === 'accepted' ? latest.warnings : [] };
    if (value && typeof value === 'object') outcomes.set(value, outcome);
    return outcome;
  } catch (error) {
    if (request.signal.aborted) return { type: 'canceled', history, recovery };
    const last = history.at(-1);
    const outcome = requestFailure(error, last?.route ?? actual, history, recovery);
    if (!(error instanceof ProviderError) && last?.cause) outcome.cause = last.cause;
    terminalErrors.set(outcome, error);
    return outcome;
  }
}
