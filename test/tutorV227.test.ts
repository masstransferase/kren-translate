// 2026-10-12: V227 probes the verified R9 defects at their request and panel boundaries.
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { load } from 'cheerio';
vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn() }, env: {},
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback }) },
  window: { showWarningMessage: vi.fn(async () => 'OK') } }));
import { KREN_SECRET_KEYS, runKrenOperation, runTutorStructuredRequest, type KrenRuntime, type TutorLanguageModelRoute } from '../src/operations.js';
import { recordedRequestOutcome } from '../src/requestCenter.js';
import { ProviderError } from '../src/errors.js';
import * as switching from '../src/languageModelSwitching.js';
import { LanguageModelUsageRecorder, configureLanguageModelUsage, LANGUAGE_MODEL_USAGE_KEY } from '../src/languageModelUsage.js';
import { TUTOR_MODELS } from '../src/tutor/thinkingMode.js';
import { tutorConversationTurnRequest, requestTutorStructuredJson, type TutorStructuredGenerationRequest } from '../src/tutor/generation.js';
import { renderKrenResultViewHtml, renderLanguageModelUsage, renderTutorConversation } from '../src/resultViewHtml.js';
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { tutorConversationFailureMessage, startTutorConversation, ensureTutorConversationPicture } from '../src/resultsViewConversation.js';
import { startTutorConversationDemo } from '../src/resultsViewDemo.js';
import { stopTutorConversation } from '../src/resultsViewTurns.js';
import { finalizeTutorTakeHome, speakTutorTakeHome } from '../src/resultsViewTakeHome.js';
import { replayTutorConversation, replayTutorLiveConversation } from '../src/resultsViewReplay.js';
import { GoogleChirpSpeech } from '../src/speech/speechCenter.js';
import { runCloudflareAi, CloudflareAiError } from '../src/providers/cloudflare.js';
import { krenResetPlan } from '../src/resetKren.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const signal = () => new AbortController().signal;
const credentials = ['fixture', 'credential'].join('-');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise<void>(resolve => setImmediate(resolve)); };
const route: TutorLanguageModelRoute = { provider: 'gemini', model: TUTOR_MODELS.gemini.thorough,
  thinkingOrEffort: 'auto', geminiProfile: 'pro', fallbackEnabled: true, fallbackModel: 'gemini-fallback-flash', fallbackThinkingOrEffort: 'auto' };
const request: TutorStructuredGenerationRequest = { kind: 'lesson', input: '{}', instruction: 'Write JSON.', schema: {}, schemaName: 'lesson' };
const quota = { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'RequestsPerDay', quotaValue: '10' }] }] } };
const card = { naturally: [], doneWell: [], tryNext: 'Ask a question.' };
function runtime(settings: Record<string, unknown> = {}): KrenRuntime {
  return { getSetting: <T>(key: string, fallback: T) => (settings[key] ?? (key.endsWith('.enabled') ? false : fallback)) as T,
    getSecret: vi.fn(async () => 'fixture-credential'), beforeLanguageModelRequest: vi.fn(async () => {}),
    beforeGeminiRequest: vi.fn(async () => {}), reserveCloudCharacters: vi.fn(), log: vi.fn(),
    providerExhaustion: new switching.ProviderExhaustionState() };
}
function harness(generate = vi.fn(async (_request: TutorStructuredGenerationRequest, _route: TutorLanguageModelRoute, _signal: AbortSignal): Promise<unknown> => card)) {
  const actions = { settings: () => ({ ...PANEL_SETTINGS_FIXTURE, tutorConversationTakeHome: true }), generateTutor: generate,
    writeTutorPreferences: vi.fn(), log: vi.fn(), stopReadAloud: vi.fn(), notify: vi.fn(), readAloudText: vi.fn(async () => {}) };
  const view = new KrenResultsViewProvider(actions as never, {} as never);
  Object.assign(view.tutorState.conversation, { from: 'anything', status: 'stopped', replies: 'standard', speakerOn: false,
    transcript: [{ question: 'When?', learnerAnswer: 'I go yesterday.', reply: 'At nine?', correction: '', explanation: '' }] });
  view.view = { webview: { html: '', cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }), postMessage: vi.fn(async () => true) } } as never;
  vi.spyOn(view, 'render').mockImplementation(() => {});
  return { view, actions, generate };
}
const panel = (settings = PANEL_SETTINGS_FIXTURE, activeScreen: 'settings' | 'tutor' = 'settings') => renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen, proModels: [], settings });
afterEach(() => { vi.unstubAllGlobals(); switching.configureProviderExhaustion(new switching.ProviderExhaustionState()); configureLanguageModelUsage(undefined); });

it('1: npm test limits workers in the shared config', () => {
  expect(readFileSync('vitest.config.ts', 'utf8')).toMatch(/maxWorkers:\s*2\b/u);
});
it('2: foreign models resolve identically in feature requests and rendered Thorough controls', async () => {
  for (const [provider, foreign, profile] of [['groq', 'gpt-5.4', 'standard'], ['gemini', '@cf/meta/llama-3.1-8b-instruct', 'standard'],
    ['gemini', '@cf/meta/llama-3.1-8b-instruct', 'pro'], ['openai', 'gemini-3.8-flash', 'standard']] as const) {
    const fetcher = vi.fn(async () => new Response('{}', { status: 400 })); vi.stubGlobal('fetch', fetcher);
    await expect(runKrenOperation(runtime({ 'explanation.provider': provider, 'explanation.model': foreign,
      'explanation.alternateModel': foreign, 'explanation.geminiProfile': profile }), 'explain', { text: 'Hello.' }, signal())).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(provider === 'gemini' ? decodeURIComponent(url).split('/models/')[1]?.split(':')[0] : body.model).toBe(TUTOR_MODELS[provider].thorough);
    const $ = load(panel({ ...PANEL_SETTINGS_FIXTURE, tutorProvider: provider, tutorModel: foreign, tutorAlternateModel: foreign, tutorProfile: profile }, 'tutor'));
    const key = profile === 'pro' ? 'tutor.alternateModel' : 'tutor.model';
    const preset = $(`[data-model-preset="${key}"]`).first().find('option[selected]').val();
    expect(preset === '__custom__' ? $(`[data-setting="${key}"]`).first().val() : preset).toBe(TUTOR_MODELS[provider].thorough);
  }
});
it('3: fallback quotas mark the attempted pool, and switched failures name the attempted provider', async () => {
  const rt = runtime({ 'llm.providerSwitch': false, 'llm.providerOrder': ['gemini'] });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify(quota), { status: 429 })));
  let failure: unknown;
  try { await runTutorStructuredRequest(rt, route, request, signal()); } catch (error) { failure = error; }
  const paidFallback = recordedRequestOutcome(failure);
  expect((failure as any).attemptedRoute).toMatchObject({ provider: 'gemini', model: route.fallbackModel, geminiProfile: 'pro' });
  const switchingRuntime = { ...rt, getSetting: <T>(key: string, fallback: T) => key === 'llm.providerSwitch' ? true as T : rt.getSetting(key, fallback) };
  await expect(switching.withProviderSwitch(switchingRuntime, route, 'thorough', signal(), async () => { throw failure; })).rejects.toBe(failure);
  expect(rt.providerExhaustion!.isExhausted({ ...route, model: route.fallbackModel })).toBe(true);
  expect(rt.providerExhaustion!.isExhausted(route)).toBe(false);
  const other = runtime({ 'llm.providerOrder': ['gemini', 'groq', 'cloudflare'] });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(quota), { status: 429 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'requests per day reached' } }), { status: 429 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ code: 3036 }] }), { status: 429 })));
  try { await runTutorStructuredRequest(other, route, request, signal()); } catch (error) { failure = error; }
  const h = harness();
  expect(tutorConversationFailureMessage(h.view, failure)).toMatch(/^Cloudflare /u);
  vi.spyOn(h.actions, 'settings').mockReturnValue({ ...PANEL_SETTINGS_FIXTURE, tutorConversationTakeHome: true,
    tutorProvider: 'gemini', tutorProfile: 'pro', tutorAlternateModel: route.model,
    tutorFallbackEnabled: true, tutorFallbackModel: route.fallbackModel });
  const busy = new ProviderError('busy', undefined, true, 503);
  busy.attemptedRoute = { provider: 'gemini', model: route.fallbackModel, geminiProfile: 'pro' };
  // Changed 2026-10-16: V257, F4 run 3, route attribution alone does not prove a fallback was attempted.
  expect(tutorConversationFailureMessage(h.view, busy)).not.toMatch(/so was the fallback/iu);
  const reused = new ProviderError('quota', undefined, false, 429, 'quotaExhausted'), isolated = runtime();
  isolated.getSecret = async () => undefined;
  for (const provider of ['gemini', 'groq'] as const) {
    const selected = { ...route, provider, model: TUTOR_MODELS[provider].thorough };
    await expect(switching.withProviderSwitch(isolated, selected, 'thorough', signal(), async () => { throw reused; })).rejects.toBe(reused);
    expect(isolated.providerExhaustion!.isExhausted(selected)).toBe(true);
  }
  // Changed 2026-10-16: V257, F4 run 3, assert the recorded Paid fallback route instead of the removed grammar catch's source text.
  const fallbackOutcome = recordedRequestOutcome(failure);
  expect(fallbackOutcome?.history.at(-1)?.route).toMatchObject({ provider: 'cloudflare' });
  expect(paidFallback?.history.at(-1)?.route).toMatchObject({ model: route.fallbackModel, geminiProfile: 'pro' });
});
it('4: every credential slot clears only its provider pools, and full reset clears memory and storage', async () => {
  const writes = new Map<string, unknown>();
  const state = new switching.ProviderExhaustionState({ get: <T>(_key: string, fallback: T) => fallback, update: async (key, value) => { writes.set(key, value); } });
  switching.configureProviderExhaustion(state);
  const slots = { gemini: 'gemini', geminiPro: 'gemini', openai: 'openai', anthropic: 'anthropic', groq: 'groq', cloudflareApiToken: 'cloudflare', cloudflareAccountId: 'cloudflare' } as const;
  for (const [slot, provider] of Object.entries(slots)) {
    for (const p of ['gemini', 'groq', 'cloudflare', 'openai', 'anthropic'] as const) state.mark({ ...route, provider: p });
    state.mark({ ...route, geminiProfile: 'standard' });
    const clear = (switching as any).clearProviderExhaustionForCredential;
    expect(clear).toBeTypeOf('function'); clear(KREN_SECRET_KEYS[slot as keyof typeof KREN_SECRET_KEYS]);
    expect(state.exhausted()).not.toContain(provider);
    expect(state.exhausted()).toHaveLength(4);
  }
  const reset = (switching as any).resetProviderExhaustion;
  expect(reset).toBeTypeOf('function'); await reset(); await state.flush();
  expect(state.exhausted()).toEqual([]);
  expect((writes.get(switching.PROVIDER_EXHAUSTION_KEY) as any).exhausted).toEqual([]);
  expect(krenResetPlan('everything').globalStateKeys).toContain(switching.PROVIDER_EXHAUSTION_KEY);
  const extension = readFileSync('src/extension.ts', 'utf8');
  expect(extension.slice(extension.indexOf('context.secrets.onDidChange'))).toMatch(/clearProviderExhaustionForCredential\(event.key\)/u);
  expect(extension.slice(extension.indexOf('async function resetKren('), extension.indexOf('async function deleteAllApiKeys('))).toContain('await resetProviderExhaustion()');
});
it('5: only Cloudflare allocation code 3036 pauses pictures for the day', async () => {
  for (const code of [undefined, 3040, 3036]) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ errors: [{ code }] }), { status: 429 })));
    let error: any; try { await runCloudflareAi('account', 'fixture-credential', 'model', {}, signal(), 'picture'); } catch (value) { error = value; }
    expect(error.allowance).toBe(code === 3036);
    expect(error.message).toContain(code === 3036 ? 'daily free allowance' : 'Cloudflare temporarily rate-limited this request. Try again later.');
  }
  const h = harness();
  vi.spyOn(h.actions, 'settings').mockReturnValue({ ...PANEL_SETTINGS_FIXTURE, tutorConversationTakeHome: true,
    tutorPictureProvider: 'cloudflare', credentialPresence: { cloudflareAccountId: true, cloudflareApiToken: true } });
  Object.assign(h.view.tutorState.conversation, { status: 'active', situationPicture: 'graduallyEntering' });
  h.view.tutorConversationScene = 'A cafe.';
  const temporary = new CloudflareAiError('Cloudflare temporarily rate-limited this request. Try again later.', false, false, 429);
  const pictures = vi.fn().mockRejectedValueOnce(temporary).mockRejectedValueOnce(temporary).mockResolvedValueOnce('data:image/png;base64,YWJj');
  (h.actions as any).generateSituationPicture = pictures;
  for (let attempt = 0; attempt < 3; attempt++) {
    ensureTutorConversationPicture(h.view); await flush();
    expect(pictures).toHaveBeenCalledTimes(attempt + 1);
    expect(h.view.tutorConversationPictureStopped).toBe(false);
    expect(h.view.tutorState.conversation.picturePaused).toBeUndefined();
  }
  expect(h.view.tutorConversationPicturePending?.image).toBe('data:image/png;base64,YWJj');
});
it('6: Requests today matches model and Gemini profile to the exhausted pool', () => {
  const state = new switching.ProviderExhaustionState(); switching.configureProviderExhaustion(state);
  state.mark(route); state.mark({ ...route, provider: 'groq', model: TUTOR_MODELS.groq.fast });
  const recorder = new LanguageModelUsageRecorder({ get: <T>(_key: string, fallback: T) => fallback, update: async () => {} }, () => {});
  for (const entry of [{ provider: 'gemini', model: route.model, geminiProfile: 'pro' }, { provider: 'gemini', model: route.model, geminiProfile: 'standard' },
    { provider: 'gemini', model: 'gemini-other', geminiProfile: 'pro' }, { provider: 'groq', model: TUTOR_MODELS.groq.fast }, { provider: 'groq', model: TUTOR_MODELS.groq.thorough }]) recorder.record({ ...entry, feature: 'lesson' } as any);
  // Changed 2026-10-15: V244, owner item I18, Groq fast and thorough now share gpt-oss-120b, so they share one usage row.
  const rows = recorder.today(); expect(rows).toHaveLength(4);
  const $ = load(renderLanguageModelUsage(rows));
  expect($('li').filter((_, el) => $(el).text().includes('limit reached'))).toHaveLength(2);
  // Old records have no profile, so they cannot establish a match to either Gemini pool.
  state.mark({ ...route, geminiProfile: 'standard' });
  const legacy = new LanguageModelUsageRecorder({ get: <T>(key: string, fallback: T): T => key === LANGUAGE_MODEL_USAGE_KEY
    ? { days: { '2026-10-12': [{ provider: 'gemini', model: route.model, requests: 1, input: 0, output: 0, thinking: 0 }] } } as T : fallback,
    update: async () => {} }, () => {}, undefined, () => new Date(2026, 9, 12, 12));
  legacy.record({ feature: 'lesson', provider: 'gemini', model: route.model, geminiProfile: 'standard' });
  expect(legacy.today()).toHaveLength(2);
  const restored = load(renderLanguageModelUsage(legacy.today()));
  expect(restored('li').filter((_, el) => $(el).text().includes('limit reached'))).toHaveLength(1);
});
it('7: Usage moves and switching checkbox keep keyboard focus across in-place saves', () => {
  const script = load(panel())('script').text();
  const patch = script.split("if (message.command === 'providerSwitchSettings') {")[1]!.split("if (message.command === 'tutorConversationHintPrefetchSetting')")[0]!;
  class Control { disabled = false; focus = vi.fn(); constructor(public attrs: Record<string, string>) {} getAttribute(key: string) { return this.attrs[key]; } closest() { return { getAttribute: () => 'groq' }; } }
  class Region { innerHTML = ''; querySelector(selector: string) { return selector.includes('llm.providerSwitch') ? checkbox : selector.includes('"-1"') ? up : down; } }
  const up = new Control({ 'data-provider-move': '-1' }), down = new Control({ 'data-provider-move': '1' }), checkbox = new Control({ 'data-setting': 'llm.providerSwitch' });
  const region = new Region();
  for (const active of [up, down, checkbox]) {
    up.focus.mockClear(); down.focus.mockClear(); checkbox.focus.mockClear();
    up.disabled = active === up; down.disabled = active === down;
    runInNewContext(`(function() {${patch})()`, { document: { activeElement: active, querySelector: () => region }, HTMLElement: Region, HTMLButtonElement: Control, message: { html: 'saved' } });
    expect((active === checkbox ? checkbox : active === up ? down : up).focus).toHaveBeenCalledOnce();
  }
  // The click handler must transfer focus before saving if moving disables the pressed button.
  expect(script).toMatch(/if \(move.disabled\)[\s\S]{0,200}focus\(/u);
});
it('8: take-home failures offer safe credential and quota actions without provider text', async () => {
  for (const [error, message] of [[new ProviderError('Private diagnostic', 'setGeminiKey'), "The take-home card needs the selected provider's key. Open KREN menu, Credentials, then choose Try again."],
    [new ProviderError('Private diagnostic', undefined, false, 429, 'quotaExhausted'), "The selected provider's free limit is used up for today. Try again tomorrow or choose another provider."],
    [new Error('Private diagnostic'), 'The take-home card could not be prepared. Try again.']] as const) {
    const h = harness(vi.fn(async () => { throw error; })); finalizeTutorTakeHome(h.view); await flush();
    expect(h.view.tutorState.conversation.takeHome?.failure).toBe(message);
    expect(load(renderTutorConversation(h.view.tutorState))('.tutor-take-home').text()).not.toContain('Private diagnostic');
  }
});
it('9: Chirp Test and fallback logs say needs a key and make no request without either key', async () => {
  const fetcher = vi.fn(), log = vi.fn(), fallback = vi.fn(async () => {});
  const speech = new GoogleChirpSpeech(async () => undefined, { play: vi.fn(), stop: vi.fn(() => false) } as never, vi.fn(), fetcher, log);
  const options = { voice: 'Kore', ratePercent: 100, volume: 100 };
  expect(await speech.test(options)).toContain('needs a key');
  await speech.speak('Hello.', options, fallback);
  expect(log.mock.calls.every(([line]) => line.includes('needs a key') && !line.includes('no response'))).toBe(true);
  expect(fetcher).not.toHaveBeenCalled(); expect(fallback).toHaveBeenCalledOnce();
});
// Changed 2026-10-15: V241, owner item I6, card cancellation is independent of corrections-only Stop.
it('10: canceling a card during Stop preserves deferred coaching without creating a card', async () => {
  let resolve!: (value: unknown) => void, attemptedSignal!: AbortSignal;
  const pending = new Promise<unknown>(done => { resolve = done; });
  const h = harness(vi.fn(async (_request, _route, selectedSignal) => { attemptedSignal = selectedSignal; return pending; }));
  Object.assign(h.view.tutorState.conversation, { status: 'active', replies: 'liveGemini', coaching: 'afterwards' });
  h.view.tutorState.conversation.transcript[0]!.coachingPending = true;
  const stopped = stopTutorConversation(h.view); await flush();
  expect(h.generate.mock.calls[0]![0].kind).toBe('conversationCorrections');
  expect(h.view.tutorState.conversation.takeHome).toBeUndefined();
  await (h.view as any).handleMessage({ command: 'cancelTutorTakeHome' });
  expect(attemptedSignal.aborted).toBe(false);
  resolve({ takeHome: card, corrections: [{ correction: 'I went yesterday.', targetId: '', explanation: 'Use past tense.', rephrase: 'I went yesterday.', rephraseWhy: 'Natural.' }] });
  await stopped; await flush();
  expect(h.view.tutorState.conversation.transcript[0]).toMatchObject({ correction: 'I went yesterday.', coachingPending: undefined });
  expect(h.view.tutorState.conversation.takeHome?.card).toBeUndefined();
  expect(h.view.tutorState.conversation.takeHome).toBeUndefined();
});
it('11: Replay stops take-home narration, which stays silent while Replay runs', async () => {
  for (const live of [false, true]) {
    const h = harness(); Object.assign(h.view.tutorState.conversation, { speakerOn: true, replies: live ? 'liveGemini' : 'standard', takeHome: { identity: 'card', card } });
    const controller = new AbortController(), player = { close: vi.fn() }, session = { close: vi.fn() };
    h.view.tutorTakeHomeSpeaking = true; h.view.tutorTakeHomeSpeechController = controller;
    h.view.tutorTakeHomePlayer = player as never; h.view.tutorTakeHomeSession = session as never;
    h.actions.readAloudText.mockImplementation(() => new Promise(() => {}));
    if (live) { h.view.tutorLiveConversationAudio.set(0, [{ data: 'AAA=', mimeType: 'audio/pcm;rate=24000' }]); vi.spyOn(h.view.waveOutPlayer, 'start').mockImplementation(() => new Promise(() => {})); replayTutorLiveConversation(h.view); }
    else replayTutorConversation(h.view);
    expect(controller.signal.aborted).toBe(true); expect(player.close).toHaveBeenCalledOnce(); expect(session.close).toHaveBeenCalledOnce();
    expect(h.view.tutorState.conversation.replayAllSpeaking).toBe(true);
    const prior = h.actions.readAloudText.mock.calls.length; await speakTutorTakeHome(h.view);
    expect(h.actions.readAloudText.mock.calls).toHaveLength(prior); expect(h.view.tutorTakeHomeSpeaking).toBe(false);
  }
});
it('12: turn history carries reply facts and excludes coaching fields in ordinary and hidden learner requests', () => {
  for (const learnerAnswer of ['Yes, please.', '?????']) {
    const generated = tutorConversationTurnRequest({ register: 'neutral', recipeTargets: { supportingTargets: [] }, question: 'Anything else?', learnerAnswer,
      transcript: [{ question: 'Do you need a room?', learnerAnswer: 'Yes.', reply: 'Your reservation number is 4821.', nextQuestion: 'Anything else?', correction: 'Yes, please.', explanation: 'Be polite.', rephrase: 'A room, please.', rephraseWhy: 'Natural.' }] });
    expect(JSON.parse(generated.input).transcript).toEqual([{ question: 'Do you need a room?', learnerAnswer: 'Yes.', reply: 'Your reservation number is 4821.' }]);
  }
});
it('13: a stopped Demo with lines and no learner answers gets its take-home card', async () => {
  const h = harness(); Object.assign(h.view.tutorState.conversation, { demoMode: true, transcript: [], demoLines: [{ speaker: 'male', text: 'Hello.' }] });
  finalizeTutorTakeHome(h.view); await flush();
  expect(h.generate).toHaveBeenCalledOnce(); expect(h.generate.mock.calls[0]![0].kind).toBe('conversationTakeHome');
  expect(h.view.tutorState.conversation.takeHome?.card).toBeDefined();
});
it('14: Groq and Cloudflare review batches validate the envelope and preserve bad items for per-item recovery', async () => {
  const reviews = [{ feedback: 'Readable.' }, { feedback: 7 }];
  const batch = { ...request, kind: 'reviewBatch' as const, schema: { type: 'object', required: ['reviews'], properties: { reviews: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'object', required: ['feedback'], properties: { feedback: { type: 'string' } } } } } } };
  for (const provider of ['groq', 'cloudflare'] as const) {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reviews }) } }] })));
    const settings = { ...route, provider, model: TUTOR_MODELS[provider].thorough, apiKey: credentials, accountId: 'account', maxAttempts: 1 };
    await expect(requestTutorStructuredJson(settings, batch, signal(), fetcher)).resolves.toEqual({ reviews });
    expect(fetcher).toHaveBeenCalledOnce();
    await expect(requestTutorStructuredJson(settings, batch, signal(), async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"reviews":{}}' } }] })))).rejects.toThrow();
  }
});
it('15: Start and Demo clear the previous conversation picture pause', () => {
  for (const demo of [false, true]) {
    const h = harness(vi.fn(() => new Promise(() => {})));
    Object.assign(h.view.tutorState.conversation, { status: 'idle', speakerOn: true, picturePaused: 'Pictures paused', situationPicture: 'none' });
    if (demo) startTutorConversationDemo(h.view); else startTutorConversation(h.view);
    expect(h.view.tutorState.conversation.status).toBe('active');
    expect(h.view.tutorState.conversation.picturePaused).toBeUndefined();
  }
});
it('16: panel handlers retain Review all and remove obsolete per-item Review lookups', () => {
  const script = load(panel())('script').text();
  expect(script).not.toContain('[data-command="reviewTutorExercise"]');
  expect(script.match(/querySelector\('\[data-command="reviewUnreviewedTutorExercises"\]'\)/gu)).toHaveLength(2);
});
