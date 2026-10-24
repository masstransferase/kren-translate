import { RequestCenter, CURRENT_REQUEST_POLICIES, runFeatureRequest, requestWithRetry, type CenterRequest, type RequestRoute, type RequestOutcome } from '../../src/requestCenter.js';
import { ProviderExhaustionState, PROVIDER_EXHAUSTION_KEY } from '../../src/languageModelSwitching.js';
import { LanguageModelUsageRecorder } from '../../src/languageModelUsage.js';
import { ProviderError } from '../../src/errors.js';
import { TUTOR_MODELS } from '../../src/tutor/models.js';
import { classifyGeminiRateLimit, geminiErrorMetadata } from '../../src/providers/gemini.js';
import type { KrenRuntime, TutorLanguageModelRoute } from '../../src/operations.js';

const providers = ['gemini', 'groq', 'cloudflare', 'openai', 'anthropic'] as const;
const tokens = { usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, thoughtsTokenCount: 1 }, usage: { prompt_tokens: 4, completion_tokens: 2 } };
export const minuteQuotaEnvelope = { error: {
  message: 'You exceeded your current quota, please check your plan and billing details.',
  details: [
    { '@type': 'google.rpc.QuotaFailure', violations: [{ quotaId: 'RequestsPerMinute', quotaValue: '10' }] },
    { '@type': 'google.rpc.RetryInfo', retryDelay: '2s' }
  ]
} };
type Scenario = 'opening' | 'grammar' | 'midnight' | 'minute' | 'emptyFallback';
export interface V272Trace {
  trace: unknown[];
  outcome: RequestOutcome<unknown>;
  usage: unknown;
  exhausted?: unknown;
}

/** The transport, clock, storage and trace vocabulary match the V270 comparisons. */
export async function v272Trace(scenario: Scenario, host = false): Promise<V272Trace> {
  const policy = scenario === 'opening' ? CURRENT_REQUEST_POLICIES.tutor
    : scenario === 'grammar' ? CURRENT_REQUEST_POLICIES.grammar : CURRENT_REQUEST_POLICIES.ordinary;
  const kind = scenario === 'opening' ? 'conversationOpening' : scenario === 'grammar' ? 'grammar' : 'translate';
  const feature = scenario === 'opening' ? 'tutor' : scenario === 'grammar' ? 'grammar' : 'translate';
  const trace: unknown[] = [], controller = new AbortController();
  let clock = new Date(2026, 9, 19, scenario === 'midnight' ? 23 : 12, scenario === 'midnight' ? 59 : 0).getTime(), index = 0;
  const saved = new Map<string, unknown>();
  const storage = { get: <T>(key: string, fallback: T): T => (saved.get(key) ?? fallback) as T,
    update: async (key: string, value: unknown) => { saved.set(key, value); } };
  const exhaustion = new ProviderExhaustionState(storage, () => new Date(clock));
  const recorder = new LanguageModelUsageRecorder(storage, line => trace.push(['usageLog', line]), undefined, () => new Date(clock));
  const route: RequestRoute = { provider: 'gemini', model: TUTOR_MODELS.gemini.thorough, geminiProfile: 'standard', mode: 'fast', effort: 'auto' };
  const attempts = scenario === 'opening' ? 5 : scenario === 'minute' ? 2 : 1;
  const fallbackModel = scenario === 'emptyFallback' ? '' : 'gemini-fallback';
  if (scenario === 'midnight') {
    exhaustion.mark(route, new ProviderError('Fixed cached daily quota failure.', 'configureGeminiModel', false, 429, 'quotaExhausted'));
    await exhaustion.flush();
    const failure = exhaustion.quotaFailure(route);
    trace.push(['beforeMidnight', { exhausted: exhaustion.isExhausted(route), persisted: saved.get(PROVIDER_EXHAUSTION_KEY),
      failure: { message: failure.message, action: failure.action, status: failure.status, reason: failure.reason, attemptedRoute: failure.attemptedRoute } }]);
    clock = new Date(2026, 9, 20, 0, 1).getTime();
    // Requesting the same pool must both persist the new day and discard its cached error.
    const isExhausted = exhaustion.isExhausted(route), cleared = exhaustion.quotaFailure(route);
    await exhaustion.flush();
    trace.push(['afterMidnight', { exhausted: isExhausted, persisted: saved.get(PROVIDER_EXHAUSTION_KEY),
      failure: { message: cleared.message, action: cleared.action, status: cleared.status, reason: cleared.reason, attemptedRoute: cleared.attemptedRoute } }]);
  }
  if (scenario === 'minute') trace.push(['classification', classifyGeminiRateLimit(minuteQuotaEnvelope), geminiErrorMetadata(minuteQuotaEnvelope)]);
  const send = async (actual: { provider: string; model: string }, mode: string, effort: string) => {
    trace.push(['attempt', actual.provider, actual.model, mode, effort]);
    const current = index++;
    if (scenario === 'opening') return { status: 500, envelope: {} };
    if (scenario === 'grammar' && current === 0) return { status: 200, value: {}, envelope: {} };
    if ((scenario === 'grammar' && current === 1) || (scenario === 'emptyFallback' && current === 0)) return { status: 404, envelope: {} };
    if (scenario === 'minute' && current === 0) return { status: 429, envelope: minuteQuotaEnvelope };
    return { status: 200, value: { ready: true }, envelope: tokens };
  };
  let outcome: RequestOutcome<unknown>;
  if (!host) {
    const request: CenterRequest<unknown> = {
      identity: { feature, kind, trigger: 'explicitAction', signal: controller.signal },
      payload: { instruction: 'Fixed instruction.', input: scenario === 'grammar' ? 'Short input.' : 'Private input.' },
      route: { ...route, fallback: { model: fallbackModel, effort: 'low' } },
      validate: value => value && (value as { ready?: boolean }).ready ? { type: 'accepted', value }
        : { type: 'rejected', cause: 'unreadableOutput', codes: ['unreadableOutput'] },
      recovery: { policy, transportAttempts: { gemini: attempts, groq: attempts, cloudflare: attempts, openai: attempts, anthropic: attempts },
        escalation: scenario === 'grammar' ? 'once' : 'never', providerSwitch: false, providerOrder: providers,
        contentRetry: { allowance: 0, correctiveInstruction: '', on: [] } },
      budget: { totalRequests: 20, perRouteAttempts: 5, deadline: clock + 60_000 }
    };
    outcome = await new RequestCenter({ transport: (_payload, actual) => send(actual, actual.mode, actual.effort), exhaustion,
      now: () => clock, random: () => 0, delay: async ms => { trace.push(['delay', ms]); clock += ms; },
      scheduleDeadline: () => () => {}, hasCredentials: async () => true,
      event: event => { trace.push(['event', event]); }, log: line => { trace.push(['log', line]); }, notice: message => { trace.push(['notice', message]); },
      usage: { record: recorder.record.bind(recorder), failure: recorder.failure.bind(recorder) } }).run(request);
  } else {
    const selected: TutorLanguageModelRoute = { ...route, thinkingOrEffort: 'auto', fallbackEnabled: true,
      fallbackModel, fallbackThinkingOrEffort: 'low' };
    const runtime: KrenRuntime = {
      getSetting: <T>(key: string, fallback: T): T => ({ 'llm.providerOrder': providers, 'llm.providerSwitch': false,
        'gemini.retry.maxAttempts': attempts, 'languageModel.retry.maxAttempts': attempts }[key] ?? fallback) as T,
      getSecret: async () => 'configured', beforeGeminiRequest: async () => {}, reserveCloudCharacters: async () => {}, providerExhaustion: exhaustion,
      log: line => { trace.push(['log', line]); }, providerSwitchNotice: message => { trace.push(['notice', message]); }
    };
    outcome = await runFeatureRequest({ runtime, route: selected, policy, signal: controller.signal,
      thinking: scenario === 'opening' ? { tutor: { kind: 'conversationOpening', input: '{}', instruction: 'Fixed instruction.', schema: {}, schemaName: 'probe' } }
        : { kind: scenario === 'grammar' ? 'grammar' : 'translate', text: 'Short input.' },
      execute: (actual, mode, signal, _request, maxAttempts) => requestWithRetry({ request: { feature, ...actual }, signal, maxAttempts,
        send: async () => { const r = await send(actual, mode, actual.thinkingOrEffort);
          return new Response(JSON.stringify({ ...r.envelope, ...(r.value ? { value: r.value } : {}) }), { status: r.status, headers: { 'retry-after': '9' } }); },
        decode: envelope => {
          const value = (envelope as { value?: { ready?: boolean } }).value;
          if (!value?.ready) throw new ProviderError('Fixed malformed answer.', undefined, true, undefined, 'structuredOutput');
          return value;
        }, failure: f => new ProviderError(`Fixed failure ${f.status ?? 'timeout'}.`, undefined, f.retryable, f.status,
          f.cause === 'quotaExhausted' ? 'quotaExhausted' : f.cause === 'overloaded' ? 'overloaded' : undefined)
      }, { now: () => clock, random: () => 0, delay: async ms => { trace.push(['delay', ms]); clock += ms; },
        event: event => trace.push(['transportEvent', event]), usage: { record: recorder.record.bind(recorder), failure: recorder.failure.bind(recorder) } }) });
  }
  await exhaustion.flush(); await recorder.flush();
  return JSON.parse(JSON.stringify({ trace, outcome, usage: recorder.today(), exhausted: saved.get(PROVIDER_EXHAUSTION_KEY) }));
}

export const v272Cases = [
  ...(['opening', 'grammar', 'minute'] as const).flatMap(scenario => [false, true].map(host => ({
    name: `${host ? 'host' : 'center'}:${scenario}`, run: () => v272Trace(scenario, host)
  }))),
  { name: 'center:midnight', run: () => v272Trace('midnight') }
];
