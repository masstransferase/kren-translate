import { describe, expect, it, vi } from 'vitest';
import { RequestCenter, CURRENT_REQUEST_POLICIES, type CenterRequest, type RequestEvent, type RequestPolicy,
  type RequestCenterDependencies, type TransportResponse, type RequestRoute, type ValidationResult } from '../src/requestCenter.js';
import { ProviderExhaustionState, PROVIDER_EXHAUSTION_KEY } from '../src/languageModelSwitching.js';
import { LanguageModelUsageRecorder } from '../src/languageModelUsage.js';
import { TUTOR_MODELS } from '../src/tutor/thinkingMode.js';

const daily = { error: { details: [{ '@type': 'google.rpc.QuotaFailure', violations: [{ quotaId: 'RequestsPerDay', quotaValue: '10' }] }] } };
const minute = { error: { details: [{ '@type': 'google.rpc.QuotaFailure', violations: [{ quotaId: 'RequestsPerMinute', quotaValue: '10' }] }] } };
const retryInfo = (seconds: number) => ({ error: { details: [{ '@type': 'google.rpc.RetryInfo', retryDelay: `${seconds}s` }] } });
const ok = (value: unknown = 'accepted'): TransportResponse => ({ status: 200, value,
  envelope: { usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, thoughtsTokenCount: 1 }, usage: { prompt_tokens: 4, completion_tokens: 2 } } });
const http = (status: number, envelope?: unknown, retryAfter?: string): TransportResponse => ({ status, envelope, retryAfter });
const route: RequestRoute = { provider: 'gemini', geminiProfile: 'standard', model: TUTOR_MODELS.gemini.thorough, mode: 'thorough', effort: 'high' };
const request = (policy: RequestPolicy = CURRENT_REQUEST_POLICIES.tutor): CenterRequest<string> => ({
  identity: { feature: 'tutor', kind: 'lesson', trigger: 'explicitAction', signal: new AbortController().signal },
  payload: { instruction: 'Local instruction.', input: 'private-payload-marker' }, route: { ...route },
  validate: value => ({ type: 'accepted', value: String(value) }),
  recovery: { transportAttempts: { gemini: 2, groq: 2, cloudflare: 2, openai: 2, anthropic: 2 }, escalation: 'once',
    providerSwitch: true, contentRetry: { allowance: 0, correctiveInstruction: '', on: [] }, policy },
  budget: { totalRequests: 20, perRouteAttempts: 10, deadline: new Date(2026, 9, 16, 12).getTime() + 60_000 }
});
function harness(responses: Array<TransportResponse | Error>, overrides: Partial<RequestCenterDependencies> = {}) {
  let clock = new Date(2026, 9, 16, 12).getTime();
  const saved = new Map<string, unknown>(), lines: string[] = [], events: RequestEvent[] = [];
  const storage = { get: <T>(key: string, fallback: T): T => (saved.get(key) ?? fallback) as T,
    update: async (key: string, value: unknown) => { saved.set(key, value); } };
  const exhaustion = new ProviderExhaustionState(storage, () => new Date(clock));
  const recorder = new LanguageModelUsageRecorder(storage, line => lines.push(line), undefined, () => new Date(clock));
  const transport = vi.fn<RequestCenterDependencies['transport']>(async () => {
    const next = responses.shift();
    if (!next) throw new Error('Unexpected attempt.');
    if (next instanceof Error) throw next;
    return next;
  });
  const delay = vi.fn(async (ms: number, _signal: AbortSignal) => { clock += ms; });
  const notice = vi.fn(), log = vi.fn((line: string) => { lines.push(line); });
  const dependencies: RequestCenterDependencies = { transport, exhaustion, now: () => clock, random: () => 0, delay,
    scheduleDeadline: () => () => {}, hasCredentials: async provider => provider === 'groq',
    event: event => { events.push(event); }, notice, log,
    usage: { record: recorder.record.bind(recorder), failure: recorder.failure.bind(recorder) }, ...overrides };
  return { center: new RequestCenter(dependencies), dependencies, transport, exhaustion, recorder, lines, events, notice, delay, saved,
    setClock: (value: number) => { clock = value; } };
}
const sequence = (outcome: Awaited<ReturnType<RequestCenter['run']>>) => outcome.history.map(attempt =>
  [attempt.attempt, attempt.route.provider, attempt.route.model, attempt.status, attempt.outcome, attempt.cause ?? null, attempt.codes]);

describe('request center transport sequences', () => {
  it('finishes Gemini 503 retries, switches to Groq, and records every ordered attempt', async () => {
    const h = harness([http(503, retryInfo(2), '9'), http(503), ok()]);
    // Changed 2026-10-16: V256, F4 run 2, all transports share Google RetryInfo precedence.
    const result = await h.center.run(request());
    expect(result.type).toBe('accepted');
    expect(sequence(result)).toEqual([
      [1, 'gemini', route.model, 503, 'failed', 'overloaded', []],
      [2, 'gemini', route.model, 503, 'failed', 'overloaded', []],
      [3, 'groq', TUTOR_MODELS.groq.thorough, 200, 'accepted', null, []]
    ]);
    expect(h.delay.mock.calls.map(([ms]) => ms)).toEqual([2000]);
    expect(result.recovery).toEqual([{ decision: 'switch', from: route,
      to: { ...route, provider: 'groq', model: TUTOR_MODELS.groq.thorough }, cause: 'overloaded' }]);
    expect(result).toMatchObject({ route: { provider: 'groq', model: TUTOR_MODELS.groq.thorough } });
    expect(h.events.map(event => event.type)).toEqual(['usage', 'failure', 'usage', 'failure', 'recovery', 'usage']);
    expect(h.exhaustion.exhausted()).toEqual([]);
    expect(h.notice).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/Gemini.*overloaded.*Groq/u));
    expect(h.lines.filter(line => line.startsWith('[usage]'))).toEqual([
      `[usage] tutor gemini ${route.model} in=0 out=0 think=0`, `[usage] tutor gemini ${route.model} in=0 out=0 think=0`,
      `[usage] tutor groq ${TUTOR_MODELS.groq.thorough} in=4 out=2 think=0`
    ]);
    expect(h.lines.filter(line => line.startsWith('[provider failure]'))).toEqual([
      `[provider failure] tutor gemini ${route.model} HTTP 503 serviceUnavailable`,
      `[provider failure] tutor gemini ${route.model} HTTP 503 serviceUnavailable`
    ]);
  });
  it('a Groq 503 retries and terminates on Groq', async () => {
    const h = harness([http(503), http(503)]), r = request();
    r.route = { ...route, provider: 'groq', model: TUTOR_MODELS.groq.thorough };
    const result = await h.center.run(r);
    expect(sequence(result)).toEqual([
      [1, 'groq', TUTOR_MODELS.groq.thorough, 503, 'failed', 'serviceUnavailable', []],
      [2, 'groq', TUTOR_MODELS.groq.thorough, 503, 'failed', 'serviceUnavailable', []]
    ]);
    expect(result).toMatchObject({ type: 'failed', cause: 'serviceUnavailable', attemptedRoute: r.route, actions: ['retry'] });
    expect(result.recovery).toEqual([]); expect(h.notice).not.toHaveBeenCalled();
  });
  it.each(['openai', 'anthropic', 'cloudflare'] as const)('%s 503 stays on its provider', async provider => {
    const h = harness([http(503), http(503)]), r = request();
    r.route = { ...route, provider, model: TUTOR_MODELS[provider].thorough };
    const result = await h.center.run(r);
    expect(result).toMatchObject({ type: 'failed', cause: 'serviceUnavailable' });
    expect(result.history.map(attempt => attempt.route.provider)).toEqual([provider, provider]);
    expect(result.recovery).toEqual([]);
  });
  it('daily quota stops at once with switching off and remembers exhaustion', async () => {
    const h = harness([http(429, daily)]), r = request(); r.recovery.providerSwitch = false;
    const result = await h.center.run(r);
    expect(sequence(result)).toEqual([[1, 'gemini', route.model, 429, 'failed', 'quotaExhausted', []]]);
    expect(result).toMatchObject({ type: 'failed', cause: 'quotaExhausted', actions: ['checkQuota'] });
    // Changed 2026-10-16: V257, R13 finding 3, quota is remembered with switching off.
    expect(h.delay).not.toHaveBeenCalled(); expect(h.exhaustion.exhausted()).toEqual(['gemini']);
    const second = await h.center.run(r);
    expect(second).toMatchObject({ type: 'failed', cause: 'quotaExhausted', actions: ['checkQuota'], history: [] });
    expect(h.transport).toHaveBeenCalledOnce(); expect(h.notice).not.toHaveBeenCalled();
    expect(h.lines.filter(line => line.startsWith('[provider skip]'))).toHaveLength(1);
    await h.exhaustion.flush();
    expect(h.saved.get(PROVIDER_EXHAUSTION_KEY)).toMatchObject({ exhausted: [`gemini:standard:${route.model}`] });
  });
  it('daily quota switches immediately, remembers only the attempted pool, and skips it on later requests', async () => {
    const h = harness([http(429, daily), ok(), ok()]);
    const first = await h.center.run(request()), second = await h.center.run(request());
    expect(sequence(first)).toEqual([[1, 'gemini', route.model, 429, 'failed', 'quotaExhausted', []],
      [2, 'groq', TUTOR_MODELS.groq.thorough, 200, 'accepted', null, []]]);
    expect(second.history.map(attempt => attempt.route.provider)).toEqual(['groq']);
    expect(second.recovery).toMatchObject([{ decision: 'preflightSkip', cause: 'quotaExhausted' }]);
    expect(h.exhaustion.isExhausted(route)).toBe(true);
    expect(h.exhaustion.isExhausted({ ...route, geminiProfile: 'pro' })).toBe(false);
    expect(h.exhaustion.isExhausted({ ...route, model: TUTOR_MODELS.gemini.fast })).toBe(false);
    await h.exhaustion.flush(); expect(h.saved.get(PROVIDER_EXHAUSTION_KEY)).toMatchObject({ exhausted: [`gemini:standard:${route.model}`] });
    expect(h.notice).toHaveBeenCalledTimes(1); expect(h.delay).not.toHaveBeenCalled();
    expect(h.lines.filter(line => line.startsWith('[provider switch]'))).toHaveLength(1);
  });
  it('per-minute 429 retries without switching or persisted exhaustion (red-probe target)', async () => {
    const h = harness([http(429, minute), ok()]);
    const result = await h.center.run(request());
    expect(sequence(result)).toEqual([[1, 'gemini', route.model, 429, 'failed', 'rateLimit', []],
      [2, 'gemini', route.model, 200, 'accepted', null, []]]);
    expect(result.type).toBe('accepted'); expect(result.recovery).toEqual([]);
    expect(h.delay.mock.calls.map(([ms]) => ms)).toEqual([1000]);
    expect(h.exhaustion.isExhausted(route)).toBe(false); await h.exhaustion.flush();
    expect(h.saved.get(PROVIDER_EXHAUSTION_KEY)).toMatchObject({ exhausted: [] });
    expect(h.notice).not.toHaveBeenCalled();
  });
  it.each([408, 500, 502, 504])('retries transient Gemini HTTP %s', async status => {
    const h = harness([http(status), ok()]);
    expect((await h.center.run(request())).history.map(attempt => attempt.status)).toEqual([status, 200]);
  });
  it('Google UNAVAILABLE at HTTP 400 retries before switching', async () => {
    const h = harness([http(400, { error: { status: 'UNAVAILABLE' } }), http(400, { error: { status: 'UNAVAILABLE' } }), ok()]);
    const result = await h.center.run(request());
    expect(result.history.map(attempt => [attempt.route.provider, attempt.status])).toEqual([['gemini', 400], ['gemini', 400], ['groq', 200]]);
    expect(result.recovery).toMatchObject([{ decision: 'switch', cause: 'overloaded' }]);
  });
  it.each([false, true])('Gemini 404 with UNAVAILABLE is terminal even with switching %s', async providerSwitch => {
    const h = harness([http(404, { error: { status: 'UNAVAILABLE' } })]), r = request();
    r.recovery.providerSwitch = providerSwitch;
    r.recovery.transportAttempts = { ...r.recovery.transportAttempts, gemini: 4 };
    const result = await h.center.run(r);
    expect(result).toMatchObject({ type: 'failed', cause: 'requestRejected', history: [{ status: 404 }], recovery: [] });
    expect(h.transport).toHaveBeenCalledOnce(); expect(h.delay).not.toHaveBeenCalled(); expect(h.notice).not.toHaveBeenCalled();
  });
  it('skips providers without credentials', async () => {
    const h = harness([http(503), http(503), ok()], { hasCredentials: async provider => provider === 'cloudflare' });
    expect((await h.center.run(request())).history.map(attempt => attempt.route.provider)).toEqual(['gemini', 'gemini', 'cloudflare']);
  });
});

describe('request budgets and cancellation', () => {
  it('cancellation during backoff returns cancellation and sends nothing more', async () => {
    const controller = new AbortController();
    const h = harness([http(503), ok()], { delay: async (_ms, signal) => { controller.abort(); signal.throwIfAborted(); } });
    const r = request(); r.identity.signal = controller.signal;
    const result = await h.center.run(r);
    expect(result.type).toBe('canceled'); expect(result.history).toHaveLength(1);
    expect(h.transport).toHaveBeenCalledTimes(1); expect(result.recovery).toEqual([]);
    expect(h.events.filter(event => event.type === 'failure')).toHaveLength(1);
  });
  it('cancellation before sending records no attempt', async () => {
    const h = harness([]), controller = new AbortController(), r = request(); controller.abort(); r.identity.signal = controller.signal;
    expect(await h.center.run(r)).toEqual({ type: 'canceled', history: [], recovery: [] });
    expect(h.transport).not.toHaveBeenCalled(); expect(h.events).toEqual([]);
  });
  it('cancellation while sending counts usage but no provider failure', async () => {
    const controller = new AbortController(), r = request(); r.identity.signal = controller.signal;
    const h = harness([], { transport: async () => { controller.abort(); throw new Error('private-exception-marker'); } });
    const result = await h.center.run(r);
    expect(result.type).toBe('canceled'); expect(result.history[0]?.outcome).toBe('canceled');
    expect(h.events.map(event => event.type)).toEqual(['usage']);
  });
  it('total request ceiling stops further sends across a provider switch', async () => {
    const h = harness([http(503), http(503), ok()]), r = request(); r.budget.totalRequests = 2;
    const result = await h.center.run(r);
    expect(result).toMatchObject({ type: 'failed', cause: 'budget', attemptedRoute: route });
    expect(h.transport).toHaveBeenCalledTimes(2); expect(result.history).toHaveLength(2);
  });
  it('per-route ceiling bounds retries', async () => {
    const h = harness([http(503), ok()]), r = request(); r.budget.perRouteAttempts = 1;
    const result = await h.center.run(r);
    expect(result).toMatchObject({ type: 'failed', cause: 'budget' }); expect(h.transport).toHaveBeenCalledTimes(1);
  });
  it('an elapsed deadline sends nothing', async () => {
    const h = harness([]), r = request(); r.budget.deadline = 0;
    expect(await h.center.run(r)).toMatchObject({ type: 'failed', cause: 'deadline', history: [] });
    expect(h.transport).not.toHaveBeenCalled();
  });
  it('a delay beyond the deadline stops without waiting or switching', async () => {
    const h = harness([http(429, retryInfo(61)), ok()]);
    const result = await h.center.run(request());
    expect(result).toMatchObject({ type: 'failed', cause: 'deadline' });
    expect(h.delay).not.toHaveBeenCalled(); expect(h.transport).toHaveBeenCalledTimes(1);
  });
  it('a deadline cancels an in-flight attempt and rejects its late response', async () => {
    let expire = () => {}, canceledTimer = false;
    const h = harness([], { scheduleDeadline: (_ms, callback) => { expire = callback; return () => { canceledTimer = true; }; },
      transport: async (_payload, _route, signal) => { expire(); expect(signal.aborted).toBe(true); return ok(); } });
    const result = await h.center.run(request());
    expect(result).toMatchObject({ type: 'failed', cause: 'deadline' }); expect(canceledTimer).toBe(true);
    expect(h.events.map(event => event.type)).toEqual(['usage']);
  });
});

describe('session state and presentation isolation', () => {
  it('only one popup per provider and model per session; every later overload switch logs', async () => {
    const h = harness([http(503), http(503), ok(), http(503), http(503), ok()]);
    await h.center.run(request()); await h.center.run(request());
    expect(h.notice).toHaveBeenCalledTimes(1);
    expect(h.lines.filter(line => line.startsWith('[provider switch]'))).toHaveLength(2);
  });
  it('suppression shares profiles and causes, and a different model can notify', async () => {
    const h = harness([http(503), http(503), ok(), http(429, daily), ok(), http(503), http(503), ok()]);
    await h.center.run(request());
    const paid = request(); paid.route.geminiProfile = 'pro'; await h.center.run(paid);
    const another = request(); another.route.model = 'gemini-local-model'; await h.center.run(another);
    expect(h.notice).toHaveBeenCalledTimes(2);
  });
  it('local midnight expires quota pools without resetting session notices', async () => {
    const h = harness([http(429, daily), ok(), http(429, daily), ok()]); await h.center.run(request());
    h.setClock(new Date(2026, 9, 17, 0).getTime());
    const r = request(); r.budget.deadline = new Date(2026, 9, 17, 0, 1).getTime();
    expect(h.exhaustion.isExhausted(route)).toBe(false);
    const result = await h.center.run(r);
    expect(result.history.map(attempt => attempt.route.provider)).toEqual(['gemini', 'groq']);
    expect(h.notice).toHaveBeenCalledTimes(1);
  });
  it.each(['sync', 'async'] as const)('a %s failing notifier cannot fail a successful switched request', async kind => {
    const notice = kind === 'sync' ? () => { throw new Error('private-exception-marker'); }
      : async () => { throw new Error('private-exception-marker'); };
    const h = harness([http(503), http(503), ok()], { notice });
    expect(await h.center.run(request())).toMatchObject({ type: 'accepted', value: 'accepted' });
  });
  it('failing event, log and usage sinks cannot fail success', async () => {
    const broken = () => { throw new Error('private-exception-marker'); };
    const h = harness([http(503), http(503), ok()], { event: broken, log: broken, usage: { record: broken, failure: broken } });
    expect((await h.center.run(request())).type).toBe('accepted');
  });
});

describe('named legacy policy differences', () => {
  it.each(['standard', 'pro'] as const)('tutor permits configured Gemini fallback on %s with switching off', async geminiProfile => {
    const h = harness([http(503), http(503), ok()]), r = request(); r.route.geminiProfile = geminiProfile;
    r.route.fallback = { model: 'gemini-fallback', effort: 'low' }; r.recovery.providerSwitch = false;
    const result = await h.center.run(r);
    expect(result.type).toBe('accepted'); expect(result.history.map(attempt => attempt.route.model)).toEqual([route.model, route.model, 'gemini-fallback']);
    expect(result.recovery).toMatchObject([{ decision: 'fallback', to: { geminiProfile, model: 'gemini-fallback', effort: 'low' } }]);
  });
  // Changed 2026-10-16: V258, F4 run 4, owner decision A permits Gemini fallback on both profiles.
  it.each(['standard', 'pro'] as const)('ordinary Gemini fallback supports both profiles (%s)', async geminiProfile => {
    const h = harness([http(503), http(503), ok()]), r = request(CURRENT_REQUEST_POLICIES.ordinary);
    r.route.geminiProfile = geminiProfile; r.route.fallback = { model: 'gemini-fallback', effort: 'low' }; r.recovery.providerSwitch = false;
    const result = await h.center.run(r);
    expect(result.type).toBe('accepted');
    expect(h.transport).toHaveBeenCalledTimes(3);
  });
  it('with switching enabled Gemini overload prefers provider switch to model fallback', async () => {
    const h = harness([http(503), http(503), ok()]), r = request(); r.route.fallback = { model: 'gemini-fallback', effort: 'low' };
    const result = await h.center.run(r);
    expect(result.recovery.map(item => item.decision)).toEqual(['switch']);
    expect(result.history.map(item => item.route.provider)).toEqual(['gemini', 'gemini', 'groq']);
  });
  it('404 permits tutor model fallback even with provider switching enabled', async () => {
    const h = harness([http(404), ok()]), r = request(); r.route.fallback = { model: 'gemini-fallback', effort: 'low' };
    expect((await h.center.run(r)).recovery.map(item => item.decision)).toEqual(['fallback']);
  });
  it('an exhausted fallback marks its own pool', async () => {
    const h = harness([http(404), http(429, daily), ok()]), r = request(); r.route.fallback = { model: 'gemini-fallback', effort: 'low' };
    const result = await h.center.run(r);
    expect(result.recovery.map(item => item.decision)).toEqual(['fallback', 'switch']);
    expect(h.exhaustion.isExhausted(route)).toBe(false);
    expect(h.exhaustion.isExhausted({ ...route, model: 'gemini-fallback' })).toBe(true);
  });
  it.each(['actualProvider', 'originalProvider'] as const)('switched attempt settings are explicit: %s', async switchedAttemptSettings => {
    const h = harness([http(503), http(503), http(503), http(503), http(503)]), r = request({ ...CURRENT_REQUEST_POLICIES.tutor, switchedAttemptSettings });
    r.recovery.transportAttempts = { ...r.recovery.transportAttempts, groq: 1 };
    const result = await h.center.run(r);
    expect(result.history.map(item => item.route.provider)).toEqual(switchedAttemptSettings === 'actualProvider'
      ? ['gemini', 'gemini', 'groq'] : ['gemini', 'gemini', 'groq', 'groq']);
  });
  it('the tutor opening cap is three even with five configured attempts', async () => {
    const h = harness([http(500), http(500), http(500), ok()]), r = request();
    r.identity.kind = 'conversationOpening'; r.recovery.transportAttempts = { ...r.recovery.transportAttempts, gemini: 5 };
    expect((await h.center.run(r)).history).toHaveLength(3); expect(h.transport).toHaveBeenCalledTimes(3);
  });
  // Changed 2026-10-16: V256, F4 run 2, RetryInfo takes precedence for every Gemini transport.
  it.each(['ordinary', 'tutor', 'grammar', 'userDictionary'] as const)('%s uses Google RetryInfo before Retry-After', async policy => {
    const h = harness([http(503, retryInfo(2), '9'), ok()]);
    await h.center.run(request(CURRENT_REQUEST_POLICIES[policy]));
    expect(h.delay.mock.calls.map(([ms]) => ms)).toEqual([2000]);
  });
  // Changed 2026-10-16: V256, F4 run 2, the shared backoff starts at 1000 ms, including Gemini text.
  it.each(['ordinary', 'tutor'] as const)('%s uses the shared backoff base', async policy => {
    const h = harness([http(503), ok()]); await h.center.run(request(CURRENT_REQUEST_POLICIES[policy]));
    expect(h.delay.mock.calls[0]?.[0]).toBe(1000);
  });
  it('the tutor honors RetryInfo on 429 as well as other retryable statuses', async () => {
    const h = harness([http(429, retryInfo(2), '9'), ok()]);
    await h.center.run(request());
    expect(h.delay.mock.calls.map(([ms]) => ms)).toEqual([2000]);
  });
  it('records the remaining presentation and feature-validation differences as named values', () => {
    expect(CURRENT_REQUEST_POLICIES).toMatchObject({
      // Changed 2026-10-16: V256, F4 run 2, empty success is no longer a legacy policy difference.
      // Changed 2026-10-16: V257, F4 run 3, cached exhausted routes now log a skip.
      // Changed 2026-10-16: V258, F4 run 4, owner decision A removes the Paid-only policy value.
      ordinary: { temporaryServiceSwitch: 'geminiOnly', modeRouting: 'selectedModel', fallbackProfiles: 'tutorBothProfiles', preflightObservation: 'decisionEvent' },
      // Changed 2026-10-16: V257, F4 run 3, fallback claims require recorded attempts.
      tutor: { modeRouting: 'tutorModels', validationLogging: 'trackedFastAndDictionary', fallbackClaims: 'attemptHistory' },
      // Changed 2026-10-16: V257, F4 run 3, preserve Grammar's fallback after thinking while using the actual provider's attempts.
      grammar: { switchedAttemptSettings: 'actualProvider', fallbackPlacement: 'afterThinking' },
      lesson: { contentRecovery: 'selectedLessonChecks', validationLogging: 'deferredPanel' },
      singleReview: { contentRecovery: 'singleReviewTerminal' }, reviewAll: { contentRecovery: 'reviewAllItems' },
      takeHome: { contentRecovery: 'localTakeHomeSalvage', terminalPresentation: 'preservedWork' }, hint: { terminalPresentation: 'fixedHint' }
    });
  });
});

describe('validation, provenance and privacy', () => {
  it.each(['selectedModel', 'tutorModels'] as const)('escalates validation once with %s routing', async modeRouting => {
    const h = harness([ok(), ok(), ok()]), r = request({ ...CURRENT_REQUEST_POLICIES.tutor, modeRouting });
    r.route.mode = 'fast'; r.route.fastModel = TUTOR_MODELS.gemini.fast;
    r.validate = vi.fn().mockReturnValueOnce({ type: 'rejected', cause: 'unreadableOutput', codes: ['requiredField'] })
      .mockReturnValue({ type: 'accepted', value: 'valid' });
    const result = await h.center.run(r);
    expect(result.type).toBe('accepted'); expect(result.history.map(item => item.route.mode)).toEqual(['fast', 'thorough']);
    expect(result.history.map(item => item.route.model)).toEqual([modeRouting === 'selectedModel' ? route.model : TUTOR_MODELS.gemini.fast, route.model]);
    expect(result.recovery.map(item => item.decision)).toEqual(['escalation']);
    expect(result.history.map(item => item.outcome)).toEqual(['failed', 'accepted']);
  });
  it('stops after a second validation rejection and never falls back for structured output', async () => {
    const h = harness([ok(), ok()]), r = request(); r.route.mode = 'fast'; r.route.fallback = { model: 'gemini-fallback', effort: 'low' };
    r.validate = () => ({ type: 'rejected', cause: 'unreadableOutput', codes: ['requiredField'] });
    const result = await h.center.run(r);
    expect(result).toMatchObject({ type: 'failed', cause: 'unreadableOutput' }); expect(h.transport).toHaveBeenCalledTimes(2);
    expect(result.recovery.map(item => item.decision)).toEqual(['escalation']);
    expect(h.events.filter(event => event.type === 'failure')).toHaveLength(2);
  });
  it('Groq Fast to Thorough escalation records both modes even when the actual model is the same', async () => {
    const h = harness([ok(), ok()]), r = request();
    r.route = { ...route, provider: 'groq', model: TUTOR_MODELS.groq.thorough, mode: 'fast' };
    r.validate = vi.fn().mockReturnValueOnce({ type: 'rejected', cause: 'unreadableOutput', codes: ['requiredField'] })
      .mockReturnValueOnce({ type: 'accepted', value: 'valid' });
    const result = await h.center.run(r);
    expect(result.history.map(attempt => [attempt.route.mode, attempt.route.model])).toEqual([
      ['fast', TUTOR_MODELS.groq.fast], ['thorough', TUTOR_MODELS.groq.thorough]
    ]);
    expect(result.recovery).toMatchObject([{ decision: 'escalation' }]);
    expect(new Set(result.history.map(attempt => attempt.route.model)).size).toBe(1);
  });
  it.each(['gemini', 'openai', 'anthropic'] as const)('ordinary empty %s success is unreadable and escalates once', async provider => {
    const h = harness([{ status: 200, output: 'empty' }, ok()]), r = request(CURRENT_REQUEST_POLICIES.ordinary);
    r.route = { ...route, provider, model: TUTOR_MODELS[provider].thorough, mode: 'fast' };
    const result = await h.center.run(r);
    // Changed 2026-10-16: V256, F4 run 2, empty OpenAI and Anthropic answers recover like Gemini.
    expect(result.type).toBe('accepted');
    expect(h.transport).toHaveBeenCalledTimes(2);
    expect(result.history[0]?.cause).toBe('unreadableOutput');
  });
  it('refusals are terminal and preserve permitted reader actions', async () => {
    const h = harness([{ status: 200, output: 'refused' }]), r = request(); r.route.mode = 'fast';
    expect(await h.center.run(r)).toMatchObject({ type: 'failed', cause: 'refused', actions: [], history: [{ cause: 'refused' }] });
  });
  it.each(['acceptedWithWarnings', 'salvaged'] as const)('returns %s with safe findings and no failure record', async type => {
    const h = harness([ok()]), r = request(); r.validate = () => ({ type, value: 'useful partial result', warnings: ['wordCount'] });
    const result = await h.center.run(r);
    expect(result).toMatchObject({ type: 'accepted', value: 'useful partial result', warnings: ['wordCount'], history: [{ outcome: type, codes: ['wordCount'] }] });
    expect(result.recovery.map(item => item.decision)).toEqual(type === 'salvaged' ? ['salvage'] : []);
    expect(h.events.filter(event => event.type === 'failure')).toEqual([]);
  });
  it('a fixed content retry returns to the original route and never forwards the prior answer', async () => {
    const h = harness([http(503), http(503), ok('private-answer-marker'), ok('final')]), r = request();
    r.recovery.contentRetry = { allowance: 1, correctiveInstruction: 'Use the required word band.', on: ['wordCount'] };
    r.validate = value => value === 'private-answer-marker' ? { type: 'rejected', cause: 'contentRejected', codes: ['wordCount'] } : { type: 'accepted', value: String(value) };
    const result = await h.center.run(r);
    expect(result.history.map(item => item.route.provider)).toEqual(['gemini', 'gemini', 'groq', 'gemini']);
    expect(result.recovery.map(item => item.decision)).toEqual(['switch', 'contentRetry']);
    expect(h.transport.mock.calls.map(([payload]) => payload)).toEqual([
      r.payload, r.payload, r.payload, { input: r.payload.input, instruction: `${r.payload.instruction}\n\nUse the required word band.` }
    ]);
    expect(JSON.stringify(h.transport.mock.calls)).not.toContain('private-answer-marker');
  });
  it('the total ceiling includes validation and content retries', async () => {
    const h = harness([ok(), ok()]), r = request(); r.route.mode = 'fast'; r.budget.totalRequests = 1;
    r.validate = () => ({ type: 'rejected', cause: 'unreadableOutput', codes: ['requiredField'] });
    expect(await h.center.run(r)).toMatchObject({ type: 'failed', cause: 'budget', history: [{ outcome: 'failed' }] });
    expect(h.transport).toHaveBeenCalledTimes(1);
  });
  it('events, logs and persistence contain no payload, answer, credential marker, exception text or arbitrary property names', async () => {
    const h = harness([new Error('private-exception-marker'), http(503, { 'private-property-marker': 'private-credential-marker',
      error: { message: 'private-payload-marker', status: 'private-status-marker' } }), ok('private-answer-marker')]);
    const r = request(); r.validate = () => ({ type: 'salvaged', value: 'private-answer-marker', warnings: ['wordCount', 'private-code-marker'] } as unknown as ValidationResult<string>);
    const result = await h.center.run(r); await h.exhaustion.flush(); await h.recorder.flush();
    expect(result).toMatchObject({ type: 'accepted', value: 'private-answer-marker', warnings: ['wordCount'] });
    const diagnostics = JSON.stringify({ events: h.events, lines: h.lines, persisted: [...h.saved.values()], history: result.history, recovery: result.recovery });
    for (const marker of ['private-payload-marker', 'private-answer-marker', 'private-credential-marker', 'private-exception-marker',
      'private-property-marker', 'private-status-marker', 'private-code-marker']) expect(diagnostics).not.toContain(marker);
    expect(h.events.map(event => event.type)).toEqual(['usage', 'failure', 'usage', 'failure', 'recovery', 'usage', 'recovery']);
  });
  it('validator exceptions become a typed local rejection and retain preservation context', async () => {
    const h = harness([ok()]), r = request(); r.preservation = 'conversation';
    r.validate = () => { throw new Error('private-exception-marker'); };
    const result = await h.center.run(r);
    expect(result).toMatchObject({ type: 'failed', cause: 'contentRejected', preservation: 'conversation' });
    expect(JSON.stringify(h.events)).not.toContain('private-exception-marker');
  });
  it('existing prefetch uses only the supplied trigger and original authorized payload', async () => {
    const h = harness([ok()]), r = request(); r.identity.trigger = 'existingPrefetch';
    expect((await h.center.run(r)).type).toBe('accepted');
    expect(h.events).toMatchObject([{ trigger: 'existingPrefetch' }]);
    expect(h.transport).toHaveBeenCalledExactlyOnceWith(r.payload, expect.any(Object), expect.any(AbortSignal));
  });
});
