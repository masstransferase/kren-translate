import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));
import { runKrenOperation, runTutorStructuredRequest, runUserDictionaryCapture, KREN_SECRET_KEYS,
  type KrenRuntime, type TutorLanguageModelRoute } from '../src/operations.js';
import { CURRENT_REQUEST_POLICIES, recordedRequestOutcome, presentRequestFailure, runFeatureRequest,
  requestWithRetry, unwrapRequestOutcome } from '../src/requestCenter.js';
import { ProviderExhaustionState } from '../src/languageModelSwitching.js';
import { ProviderError } from '../src/errors.js';
import { tutorConversationFailureMessage } from '../src/resultsViewConversation.js';
import { TUTOR_MODELS } from '../src/tutor/thinkingMode.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const route: TutorLanguageModelRoute = { provider: 'gemini', model: TUTOR_MODELS.gemini.thorough,
  geminiProfile: 'standard', thinkingOrEffort: 'auto', fallbackEnabled: true,
  fallbackModel: 'gemini-fallback', fallbackThinkingOrEffort: 'low' };
const request = { kind: 'lesson' as const, instruction: 'Return JSON.', input: '{}', schema: {}, schemaName: 'probe' };
const signal = () => new AbortController().signal;
const busy = () => new Response('{}', { status: 503, headers: { 'retry-after': '0' } });
const daily = () => new Response(JSON.stringify({ error: { details: [{ '@type': 'google.rpc.QuotaFailure',
  violations: [{ quotaId: 'RequestsPerDay' }] }] } }), { status: 429 });
const ok = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"value":"ok"}' }] } }] }));
function runtime(settings: Record<string, unknown> = {}): KrenRuntime {
  return { getSetting: <T>(key: string, fallback: T) => ({ 'gemini.retry.maxAttempts': 1,
    'languageModel.retry.maxAttempts': 2, ...settings }[key] ?? fallback) as T,
    getSecret: async key => key === KREN_SECRET_KEYS.gemini || key === KREN_SECRET_KEYS.geminiPro || key === KREN_SECRET_KEYS.groq ? 'configured' : undefined,
    beforeGeminiRequest: async () => {}, reserveCloudCharacters: async () => {},
    providerExhaustion: new ProviderExhaustionState(), log: vi.fn(), providerSwitchNotice: vi.fn() };
}
function view() {
  return { actions: { log: vi.fn(), settings: () => ({ ...PANEL_SETTINGS_FIXTURE, tutorProvider: 'gemini',
    tutorModel: route.model, tutorFallbackEnabled: true, tutorFallbackModel: route.fallbackModel }) },
    tutorState: { settings: { routing: route } } } as unknown as Parameters<typeof tutorConversationFailureMessage>[0];
}
async function caught(run: Promise<unknown>): Promise<unknown> {
  try { await run; throw new Error('Expected a request failure.'); } catch (error) { return error; }
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('V257 actual feature routes', () => {
  // Changed 2026-10-17: V259, R14 finding 1, quota-shaped private text must become a daily category.
  it.each(['quota identifier', 'daily quota identifier', 'missing-text finish reason', 'malformed-text finish reason'] as const)(
    'unknown %s cannot enter an error, log line or reader message', async kind => {
      const quota = kind.includes('quota identifier');
      const body = quota ? { error: { details: [{ '@type': 'google.rpc.QuotaFailure',
        violations: [{ quotaId: kind === 'daily quota identifier' ? 'PrivateAnswerRequestsPerDay' : 'private-input-marker', quotaValue: '0' }] }] } }
        : { candidates: [{ finishReason: 'private-answer-marker', content: { parts: kind === 'malformed-text finish reason' ? [{ text: '{' }] : [] } }] };
      const fetcher = vi.fn(async () => new Response(JSON.stringify(body), { status: quota ? 429 : 200 }));
      vi.stubGlobal('fetch', fetcher);
      const rt = runtime({ 'llm.providerSwitch': false }), panel = view();
      const failure = await caught(runTutorStructuredRequest(rt, { ...route, fallbackEnabled: false }, request, signal()));
      expect(failure).toBeInstanceOf(ProviderError);
      expect((failure as Error).message).toMatch(kind === 'daily quota identifier' ? /"quotaCategory":"perDay"/u : /other/u);
      if (quota) expect(failure).toMatchObject({ reason: 'quotaExhausted', retryable: false });
      const message = tutorConversationFailureMessage(panel, failure);
      const diagnostics = JSON.stringify({ error: (failure as Error).message, message,
        output: [...vi.mocked(rt.log!).mock.calls, ...vi.mocked(panel.actions.log).mock.calls],
        history: recordedRequestOutcome(failure)?.history });
      expect(diagnostics).not.toContain('private-input-marker'); expect(diagnostics).not.toContain('private-answer-marker');
      expect(diagnostics).not.toContain('PrivateAnswer');
      if (kind === 'daily quota identifier') expect(message).toMatch(/Gemini.*daily.*quota.*exhausted/iu);
      expect(fetcher).toHaveBeenCalledOnce();
    });

  it('switching off remembers daily quota, repeats its message without sending, and expires at midnight', async () => {
    let now = new Date(2026, 9, 16, 12);
    const rt = runtime({ 'llm.providerSwitch': false }); rt.providerExhaustion = new ProviderExhaustionState(undefined, () => now);
    const fetcher = vi.fn().mockImplementation(daily); vi.stubGlobal('fetch', fetcher);
    const run = () => runTutorStructuredRequest(rt, { ...route, fallbackEnabled: false }, request, signal());
    const first = await caught(run()), second = await caught(run());
    expect(fetcher).toHaveBeenCalledOnce();
    expect((second as Error).message).toBe((first as Error).message);
    expect(tutorConversationFailureMessage(view(), second)).toBe(tutorConversationFailureMessage(view(), first));
    expect(recordedRequestOutcome(second)?.history).toEqual([]);
    expect(rt.providerSwitchNotice).not.toHaveBeenCalled();
    now = new Date(2026, 9, 17, 0);
    await caught(run()); expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('remembers a primary quota even when model fallback succeeds with switching off', async () => {
    const rt = runtime({ 'llm.providerSwitch': false });
    const fetcher = vi.fn().mockImplementationOnce(daily).mockImplementationOnce(ok); vi.stubGlobal('fetch', fetcher);
    expect(await runTutorStructuredRequest(rt, route, request, signal())).toEqual({ value: 'ok' });
    expect(rt.providerExhaustion!.isExhausted(route)).toBe(true);
    expect(await caught(runTutorStructuredRequest(rt, route, request, signal()))).toMatchObject({ reason: 'quotaExhausted' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('an exhausted model fallback is skipped without resending to its pool', async () => {
    const rt = runtime({ 'llm.providerSwitch': false });
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 404 })).mockImplementationOnce(daily)
      .mockResolvedValueOnce(new Response('{}', { status: 404 })); vi.stubGlobal('fetch', fetcher);
    const first = await caught(runTutorStructuredRequest(rt, route, request, signal()));
    const second = await caught(runTutorStructuredRequest(rt, route, request, signal()));
    expect((second as Error).message).toBe((first as Error).message);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(recordedRequestOutcome(second)?.history.map(attempt => attempt.route.model)).toEqual([route.model]);
    expect(vi.mocked(rt.log!).mock.calls.filter(([line]) => line.startsWith('[provider skip]'))).toHaveLength(1);
  });

  it.each(['translate', 'rewrite', 'explain', 'userDictionary'] as const)('%s switches using the actual provider attempt count', async feature => {
    const fetcher = vi.fn().mockImplementation(busy); vi.stubGlobal('fetch', fetcher);
    const rt = runtime({ translationProvider: 'gemini', 'userDictionary.enabled': true });
    const failure = await caught(feature === 'userDictionary' ? runUserDictionaryCapture(rt, 'ledger', signal())
      : runKrenOperation(rt, feature, { text: 'Hello.' }, signal()));
    expect(failure).toMatchObject({ status: 503, attemptedRoute: { provider: 'groq' } });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const outcome = recordedRequestOutcome(failure);
    expect(outcome?.history.map(item => item.route.provider)).toEqual(['gemini', 'groq', 'groq']);
    expect(outcome?.recovery.map(item => item.decision)).toEqual(['switch']);
    expect(rt.providerSwitchNotice).toHaveBeenCalledOnce();
  });

  it('configured fallback that never ran cannot be described as busy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(busy));
    const failure = await caught(runTutorStructuredRequest(runtime(), route, request, signal()));
    const outcome = recordedRequestOutcome(failure);
    expect(outcome?.history.map(item => item.route.provider)).toEqual(['gemini', 'groq', 'groq']);
    expect(outcome?.recovery.some(item => item.decision === 'fallback')).toBe(false);
    const message = tutorConversationFailureMessage(view(), failure);
    expect(message).toMatch(/Groq/iu);
    expect(message).not.toMatch(/so was the fallback|fallback model|gemini-fallback/iu);
  });

  it('a fallback that ran and was busy is described from its history', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(busy));
    const failure = await caught(runTutorStructuredRequest(runtime({ 'llm.providerSwitch': false }), route, request, signal()));
    const outcome = recordedRequestOutcome(failure);
    expect(outcome?.history.map(item => item.route.model)).toEqual([route.model, route.fallbackModel]);
    expect(tutorConversationFailureMessage(view(), failure)).toMatch(/so was the fallback model/iu);
  });

  it('an unavailable primary and a quota-exhausted fallback do not claim the fallback was busy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{}', { status: 404 })).mockImplementation(daily));
    const failure = await caught(runTutorStructuredRequest(runtime({ 'llm.providerSwitch': false }), route, request, signal()));
    expect(tutorConversationFailureMessage(view(), failure)).toMatch(/quota.*exhausted/iu);
    expect(tutorConversationFailureMessage(view(), failure)).not.toMatch(/busy/iu);
  });

  it('logs each skipped exhausted route once without another switch popup', async () => {
    const fetcher = vi.fn().mockImplementationOnce(daily).mockImplementation(ok); vi.stubGlobal('fetch', fetcher);
    const rt = runtime();
    // The switched route uses a compatible envelope, so use the center's route callback for this session probe.
    const run = () => runFeatureRequest({ runtime: rt, route, policy: CURRENT_REQUEST_POLICIES.tutor, signal: signal(),
      thinking: { kind: 'tutor', text: 'Hello.' }, execute: async (selected, _mode, selectedSignal) => {
        await requestWithRetry({ request: { feature: 'tutor', ...selected }, signal: selectedSignal, maxAttempts: 1,
          send: () => fetch('https://example.invalid/probe'), decode: () => 'ok',
          failure: failure => new ProviderError('quota', undefined, failure.retryable, failure.status,
            failure.cause === 'quotaExhausted' ? 'quotaExhausted' : undefined) });
        return 'ok';
      } });
    expect((await run()).type).toBe('accepted');
    expect((await run()).type).toBe('accepted');
    expect(rt.providerSwitchNotice).toHaveBeenCalledOnce();
    expect(vi.mocked(rt.log!).mock.calls.filter(([line]) => line.startsWith('[provider skip]'))).toEqual([
      [`[provider skip] gemini ${route.model} quota exhausted this session`]
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each(['quota', 'credential'] as const)('presents the %s cause and its permitted action', async kind => {
    const rt = runtime({ 'llm.providerSwitch': false });
    if (kind === 'credential') rt.getSecret = async () => undefined;
    const fetcher = vi.fn().mockImplementation(daily); vi.stubGlobal('fetch', fetcher);
    const failure = await caught(runTutorStructuredRequest(rt, { ...route, fallbackEnabled: false }, request, signal()));
    const outcome = recordedRequestOutcome(failure);
    expect(outcome?.type).toBe('failed');
    if (outcome?.type !== 'failed') throw new Error('Expected typed failure.');
    const presented = presentRequestFailure(outcome);
    expect(presented.actions).toEqual(kind === 'quota' ? ['checkQuota'] : ['setCredential']);
    expect(presented.message).toMatch(kind === 'quota' ? /quota.*check.*billing/iu : /set.*Gemini.*key.*Credentials/iu);
    if (kind === 'credential') { expect(fetcher).not.toHaveBeenCalled(); expect(outcome.history).toEqual([]); }
  });

  // Changed 2026-10-16: V258, F4 run 4, owner decision A permits ordinary fallback on both profiles.
  it.each(['standard', 'pro'] as const)('ordinary fallback supports both profiles on %s', async geminiProfile => {
    const rt = runtime({ 'llm.providerSwitch': false });
    const fetcher = vi.fn().mockImplementationOnce(busy).mockImplementation(ok); vi.stubGlobal('fetch', fetcher);
    const result = await runFeatureRequest({ runtime: rt, route: { ...route, geminiProfile }, signal: signal(),
      policy: CURRENT_REQUEST_POLICIES.ordinary, thinking: { kind: 'tutor', text: 'Hello.' },
      execute: async (selected, _mode, selectedSignal) => requestWithRetry({ request: { feature: 'probe', ...selected },
        signal: selectedSignal, maxAttempts: 1, send: () => fetch('https://example.invalid/probe'), decode: () => 'ok',
        failure: () => new ProviderError('busy', undefined, true, 503, 'overloaded') }) });
    expect(result.type).toBe('accepted');
    expect(fetcher).toHaveBeenCalledTimes(2);
    if (result.type === 'accepted') expect(unwrapRequestOutcome(result)).toBe('ok');
  });

  it('keeps in-flight cancellation distinct from a provider failure', async () => {
    const controller = new AbortController(), rt = runtime();
    const fetcher = vi.fn(async () => { controller.abort(); return ok(); }); vi.stubGlobal('fetch', fetcher);
    const result = await runFeatureRequest({ runtime: rt, route, policy: CURRENT_REQUEST_POLICIES.tutor,
      signal: controller.signal, thinking: { kind: 'tutor', text: 'Hello.' },
      execute: (selected, _mode, selectedSignal) => requestWithRetry({ request: { feature: 'tutor', ...selected },
        signal: selectedSignal, maxAttempts: 1, send: () => fetch('https://example.invalid/probe'), decode: () => 'ok',
        failure: () => new ProviderError('failed') }) });
    expect(result.type).toBe('canceled');
    expect(result.history).toMatchObject([{ outcome: 'canceled' }]);
    expect(result.history[0]?.cause).toBeUndefined();
    expect(result.recovery).toEqual([]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(rt.providerSwitchNotice).not.toHaveBeenCalled();
  });
});
