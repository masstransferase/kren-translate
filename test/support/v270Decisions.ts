import { RequestCenter, CURRENT_REQUEST_POLICIES, runFeatureRequest, requestWithRetry, type CenterRequest, type RequestRoute } from '../../src/requestCenter.js';
import { ProviderExhaustionState } from '../../src/languageModelSwitching.js';
import { LanguageModelUsageRecorder } from '../../src/languageModelUsage.js';
import { ProviderError } from '../../src/errors.js';
import { TUTOR_MODELS } from '../../src/tutor/models.js';
import type { KrenRuntime, TutorLanguageModelRoute } from '../../src/operations.js';

export const scenarios = ['success', 'minute', 'daily', 'overloaded', 'server', 'timeout', 'refusal', 'malformed', 'cancellation'] as const;
const providers = ['gemini', 'groq', 'cloudflare', 'openai', 'anthropic'] as const;
const kinds = { ordinary: 'translate', tutor: 'conversationTurn', userDictionary: 'capture', grammar: 'grammar', lesson: 'lesson', singleReview: 'review', reviewAll: 'reviewBatch', takeHome: 'conversationTakeHome', hint: 'conversationHint' } as const;
const tokens = { usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, thoughtsTokenCount: 1 }, usage: { prompt_tokens: 4, completion_tokens: 2 } };
function response(scenario: string, provider: string, index: number): { status: number; envelope: unknown; value?: unknown; output?: 'refused' } {
  if (index || scenario === 'success' || scenario === 'cancellation') return { status: 200, value: { ready: true }, envelope: tokens };
  if (scenario === 'timeout') throw new Error('Private network detail.');
  if (scenario === 'refusal') return { status: 200, output: 'refused', envelope: provider === 'gemini' ? { promptFeedback: { blockReason: 'SAFETY' } } : provider === 'anthropic' ? { stop_reason: 'refusal' } : provider === 'openai' ? { output: [{ content: [{ type: 'refusal' }] }] } : { choices: [{ message: { refusal: 'Private refusal.' } }] } };
  if (scenario === 'malformed') return { status: 200, value: {}, envelope: {} };
  const status = scenario === 'overloaded' ? 503 : scenario === 'server' ? 500 : 429;
  return { status, envelope: scenario === 'minute' || scenario === 'daily' ? { error: { message: scenario === 'daily' ? 'daily limit' : 'per minute limit', details: [{ '@type': 'google.rpc.QuotaFailure', violations: [{ quotaId: scenario === 'daily' ? 'RequestsPerDay' : 'RequestsPerMinute', quotaValue: '10' }] }, { '@type': 'google.rpc.RetryInfo', retryDelay: '2s' }] } } : {} };
}
export async function decisionTrace(policyName: keyof typeof CURRENT_REQUEST_POLICIES, scenario: string, provider: typeof providers[number], host: boolean): Promise<unknown> {
  const policy = CURRENT_REQUEST_POLICIES[policyName], trace: unknown[] = [], controller = new AbortController();
  let clock = new Date(2026, 9, 19, 12).getTime(), index = 0;
  const saved = new Map<string, unknown>();
  const storage = { get: <T>(key: string, fallback: T): T => (saved.get(key) ?? fallback) as T, update: async (key: string, value: unknown) => { saved.set(key, value); } };
  const exhaustion = new ProviderExhaustionState(storage, () => new Date(clock));
  const recorder = new LanguageModelUsageRecorder(storage, line => trace.push(['usageLog', line]), undefined, () => new Date(clock));
  const route: RequestRoute = { provider, model: TUTOR_MODELS[provider].thorough, geminiProfile: 'standard', mode: 'fast', effort: 'auto' };
  const send = async (actual: { provider: string; model: string }, mode: string, effort: string) => {
    trace.push(['attempt', actual.provider, actual.model, mode, effort]);
    if (scenario === 'cancellation') controller.abort();
    return response(scenario, actual.provider, index++);
  };
  let outcome: unknown;
  if (!host) {
    const request: CenterRequest<unknown> = {
      identity: { feature: policyName === 'ordinary' ? 'translate' : policyName === 'userDictionary' ? 'userDictionary' : policyName === 'grammar' ? 'grammar' : 'tutor', kind: kinds[policyName], trigger: 'explicitAction', signal: controller.signal },
      payload: { instruction: 'Fixed instruction.', input: 'Private input.' }, route: { ...route, fallback: { model: 'gemini-fallback', effort: 'low' } },
      validate: value => value && (value as { ready?: boolean }).ready ? { type: 'accepted', value } : { type: 'rejected', cause: 'unreadableOutput', codes: ['unreadableOutput'] },
      recovery: { policy, transportAttempts: { gemini: 2, groq: 2, cloudflare: 2, openai: 2, anthropic: 2 }, escalation: 'once', providerSwitch: true, providerOrder: providers, contentRetry: { allowance: 0, correctiveInstruction: '', on: [] } },
      budget: { totalRequests: 20, perRouteAttempts: 5, deadline: clock + 60_000 }
    };
    outcome = await new RequestCenter({ transport: (_payload, actual) => send(actual, actual.mode, actual.effort), exhaustion, now: () => clock, random: () => 0,
      delay: async ms => { trace.push(['delay', ms]); clock += ms; }, scheduleDeadline: () => () => {}, hasCredentials: async () => true,
      event: event => { trace.push(['event', event]); }, log: line => { trace.push(['log', line]); }, notice: message => { trace.push(['notice', message]); },
      usage: { record: recorder.record.bind(recorder), failure: recorder.failure.bind(recorder) } }).run(request);
  } else {
    const selected: TutorLanguageModelRoute = { ...route, thinkingOrEffort: 'auto', fallbackEnabled: true, fallbackModel: 'gemini-fallback', fallbackThinkingOrEffort: 'low' };
    const runtime: KrenRuntime = { getSetting: <T>(key: string, fallback: T): T => ({ 'llm.providerOrder': providers, 'gemini.retry.maxAttempts': 2, 'languageModel.retry.maxAttempts': 2 }[key] ?? fallback) as T,
      getSecret: async () => 'configured', beforeGeminiRequest: async () => {}, reserveCloudCharacters: async () => {}, providerExhaustion: exhaustion,
      log: line => { trace.push(['log', line]); }, providerSwitchNotice: message => { trace.push(['notice', message]); } };
    const kind = kinds[policyName];
    outcome = await runFeatureRequest({ runtime, route: selected, policy, signal: controller.signal,
      thinking: kind === 'capture' || kind === 'grammar' || kind === 'translate' ? { kind: policyName === 'ordinary' ? 'translate' : policyName === 'grammar' ? 'grammar' : 'userDictionary', text: 'Short input.' }
        : { tutor: { kind, input: '{}', instruction: 'Fixed instruction.', schema: {}, schemaName: 'probe' } },
      execute: (actual, mode, signal, _request, maxAttempts) => requestWithRetry({ request: { feature: policyName, ...actual }, signal, maxAttempts,
        send: async () => { const r = await send(actual, mode, actual.thinkingOrEffort); return new Response(JSON.stringify({ ...r.envelope as object, ...(r.value ? { value: r.value } : {}) }), { status: r.status, headers: { 'retry-after': '9' } }); },
        decode: envelope => {
          const value = (envelope as { value?: unknown }).value;
          if (!value) throw new ProviderError('Fixed malformed answer.', undefined, true, undefined, 'structuredOutput');
          // Fast validators for hints and turns accept this same fixed value on every run.
          return { ...value as object, explanation: 'A hint.', example: 'For example.', reply: 'What happened?', question: 'What happened?', correction: '', feedback: { correct: [], incorrect: [] } };
        }, failure: f => new ProviderError(`Fixed failure ${f.status ?? 'timeout'}.`, undefined, f.retryable, f.status, f.cause === 'quotaExhausted' ? 'quotaExhausted' : f.cause === 'overloaded' ? 'overloaded' : undefined)
      }, { now: () => clock, random: () => 0, delay: async ms => { trace.push(['delay', ms]); clock += ms; }, event: event => trace.push(['transportEvent', event]), usage: { record: recorder.record.bind(recorder), failure: recorder.failure.bind(recorder) } }) });
  }
  await exhaustion.flush(); await recorder.flush();
  return JSON.parse(JSON.stringify({ trace, outcome, usage: recorder.today(), exhausted: saved.get('kren.languageModelExhaustion.v2') }));
}
export const decisionCases = Object.keys(CURRENT_REQUEST_POLICIES).flatMap(policy => providers.flatMap(provider => scenarios.flatMap(scenario => [false, true].map(host => ({ policy: policy as keyof typeof CURRENT_REQUEST_POLICIES, provider, scenario, host, name: `${host ? 'host' : 'center'}:${policy}:${provider}:${scenario}` })))));
