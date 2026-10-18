// 2026-10-11: Reproduce R8's independent function routing failures at their host and panel boundaries.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { load } from 'cheerio';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn() }, env: {},
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));
import { ProviderError } from '../src/errors.js';
import { ProviderExhaustionState, withProviderSwitch } from '../src/languageModelSwitching.js';
import { KREN_SECRET_KEYS, runKrenOperation, runUserDictionaryCapture, type KrenRuntime, type TutorLanguageModelRoute } from '../src/operations.js';
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { tutorReplayLearnerEdgeVoice, readTutorConversationText } from '../src/resultsViewReplay.js';
import { skipTutorConversationTurn, skipLiveTutorTurn } from '../src/resultsViewTurns.js';
import { startTutorConversationDemo } from '../src/resultsViewDemo.js';
import { tutorConversationReplayAvailable } from '../src/resultsViewLive.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { geminiRefreshTarget } from '../src/geminiProfileRefresh.js';
import { listGeminiImageModels } from '../src/providers/geminiModels.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const signal = () => new AbortController().signal;
const route: TutorLanguageModelRoute = { provider: 'gemini', model: 'gemini-3.8-flash', geminiProfile: 'standard',
  thinkingOrEffort: 'auto', fallbackEnabled: false, fallbackModel: '', fallbackThinkingOrEffort: 'auto' };
function runtime(settings: Record<string, unknown> = {}, credentials: string[] = []): KrenRuntime {
  return { getSetting: <T>(key: string, fallback: T): T => (settings[key] ?? fallback) as T,
    getSecret: vi.fn(async key => credentials.includes(key) ? 'fixture-credential' : undefined),
    reserveCloudCharacters: vi.fn(async () => undefined), beforeGeminiRequest: vi.fn(async () => {}),
    providerExhaustion: new ProviderExhaustionState(), providerSwitchNotice: vi.fn() };
}
function panel(overrides: Partial<typeof PANEL_SETTINGS_FIXTURE> = {}) {
  const settings = { ...PANEL_SETTINGS_FIXTURE, tutorProvider: 'groq' as const, tutorReadAloudProvider: 'edgeOnline' as const,
    credentialPresence: { geminiDefault: true }, ...overrides };
  const actions = { settings: () => settings, notify: vi.fn(), log: vi.fn(), readAloudText: vi.fn(async () => {}),
    stopReadAloud: vi.fn(), generateTutor: vi.fn(() => new Promise(() => {})) };
  const view = new KrenResultsViewProvider(actions as never, {} as never);
  view.tutorState.conversation = { ...view.tutorState.conversation, from: 'anything', status: 'active',
    replies: 'liveGemini', speakerOn: true, situationPicture: 'none', currentQuestion: 'Where shall we go?' };
  view.render = vi.fn();
  return { view, actions, settings };
}
function html(view: KrenResultsViewProvider, settings: typeof PANEL_SETTINGS_FIXTURE, extra = {}) {
  return load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'tutor', settings,
    tutor: view.tutorState, proModels: [], ...extra }));
}
function hostFunction(name: string, scope: Record<string, unknown>) {
  const source = ts.createSourceFile('extension.ts', readFileSync('src/extension.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const node = source.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name)!;
  return runInNewContext(ts.transpile(node.getText(source).replace(/^export /u, '') + `\n${name}`, { target: ts.ScriptTarget.ES2022 }), scope);
}
afterEach(() => vi.unstubAllGlobals());

describe('R8 function isolation', () => {
  it('finding 1 / red probe a: exhausting Free Tier leaves Paid and other Gemini/Groq models usable', async () => {
    const rt = runtime(), quota = new ProviderError('quota', undefined, false, 429, 'quotaExhausted');
    for (const exhausted of [route, { ...route, provider: 'groq' as const, model: 'llama-3.3-70b-versatile' }]) {
      await expect(withProviderSwitch(rt, exhausted, 'thorough', signal(), async () => { throw quota; })).rejects.toBe(quota);
      const run = vi.fn(async () => 'should not run');
      await expect(withProviderSwitch(rt, exhausted, 'thorough', signal(), run)).rejects.toMatchObject({ reason: 'quotaExhausted' });
      expect(run).not.toHaveBeenCalled();
    }
    for (const healthy of [{ ...route, geminiProfile: 'pro' as const }, { ...route, model: 'gemini-3.6-flash' },
      { ...route, provider: 'groq' as const, model: 'openai/gpt-oss-120b' }]) {
      const run = vi.fn(async () => 'healthy');
      await expect(withProviderSwitch(rt, healthy, 'thorough', signal(), run)).resolves.toBe('healthy');
      expect(run).toHaveBeenCalledExactlyOnceWith(healthy);
    }
  });
  it('finding 2 / red probe c: Cloud Translation ignores exhausted dormant text routing', async () => {
    const rt = runtime({ translationProvider: 'googleCloudTranslation', 'translation.provider': 'gemini', 'translation.model': route.model }, [KREN_SECRET_KEYS.googleCloudTranslation]);
    await expect(withProviderSwitch(rt, route, 'fast', signal(), async () => { throw new ProviderError('quota', undefined, false, 429, 'quotaExhausted'); })).rejects.toThrow();
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: { translations: [{ translatedText: '안녕하세요' }] } }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(runKrenOperation(rt, 'translate', { text: 'Hello' }, signal())).resolves.toMatchObject({ translatedText: '안녕하세요' });
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('translation.googleapis.com');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('finding 3: retained Live mode never selects Edge for Windows learner replay', async () => {
    const { view, actions } = panel({ tutorReadAloudProvider: 'windowsLocal' }); view.tutorLiveFailed = true;
    const voice = tutorReplayLearnerEdgeVoice(view);
    await readTutorConversationText(view, 'My answer.', voice);
    expect(voice).toBeUndefined();
    expect(actions.readAloudText).toHaveBeenCalledExactlyOnceWith('My answer.', 'en', 'tutor');
  });
  it('finding 4 / red probe b: Groq text Skip advances a healthy Live session', async () => {
    const { view } = panel();
    const session = { sendTurn: vi.fn(async () => { view.tutorLiveReplyText = 'What time shall we meet?'; }), close: vi.fn() };
    view.tutorLiveSession = session as never;
    skipTutorConversationTurn(view);
    await vi.waitFor(() => expect(view.tutorState.conversation.currentQuestion).toBe('What time shall we meet?'));
    expect(session.sendTurn).toHaveBeenCalledOnce();
  });
  it('finding 5: Demo rendering and execution agree on Live, Chirp, Edge, and Windows credentials', () => {
    const cases = [
      { replies: 'liveGemini', speech: 'edgeOnline', keys: { geminiDefault: true }, available: true },
      { replies: 'liveGemini', speech: 'googleChirp', keys: { googleCloudTextToSpeech: true }, available: true },
      { replies: 'liveGemini', speech: 'googleChirp', keys: {}, available: false },
      { replies: 'standard', speech: 'edgeOnline', keys: {}, available: true },
      { replies: 'standard', speech: 'windowsLocal', keys: {}, available: true }
    ] as const;
    for (const item of cases) {
      const { view, settings, actions } = panel({ tutorReadAloudProvider: item.speech, credentialPresence: item.keys });
      Object.assign(view.tutorState.conversation, { status: 'idle', replies: item.replies });
      const button = html(view, settings)('[data-command="startTutorConversationDemo"]');
      expect(button.length).toBe(1); expect(button.attr('disabled') === undefined).toBe(item.available);
      startTutorConversationDemo(view);
      expect(view.tutorState.conversation.demoMode).toBe(item.available);
      expect(actions.generateTutor.mock.calls.length > 0).toBe(item.available);
    }
  });
  it('finding 6: Standard fallback enables initial, patched, and stopped Replay without Live clips', () => {
    const { view, settings } = panel(); view.tutorLiveFailed = true;
    const $ = html(view, settings, { tutorLiveFailed: true });
    const replay = $('[data-command="replayTutorQuestion"]');
    expect(replay.attr('disabled')).toBeUndefined();
    const source = readFileSync('src/resultViewHtml.ts', 'utf8');
    const patch = source.split('    function updateTutorReplayMode() {')[1]!.split('    function patchTutorConversationScene')[0]!;
    class Element { attrs = new Map<string, string>(); disabled = true; title = ''; value = 'liveGemini';
      getAttribute(key: string) { return this.attrs.get(key); } setAttribute(key: string, value: string) { this.attrs.set(key, value); } }
    const button = new Element(), speaker = new Element(), replies = new Element(), answer = { value: 'Keep this draft.' };
    for (const [key, value] of Object.entries(replay.attr() ?? {})) button.setAttribute(key, value);
    speaker.setAttribute('aria-pressed', 'true');
    runInNewContext(`function updateTutorReplayMode() {${patch}; updateTutorReplayMode();`, { HTMLButtonElement: Element, HTMLElement: Element,
      HTMLSelectElement: Element, document: { querySelector: (s: string) => s.includes('toggleTutor') ? speaker : s.includes('replies') ? replies : s.includes('answer') ? answer : button } });
    expect(button.disabled).toBe(false); expect(answer.value).toBe('Keep this draft.');
    // A running Live panel receives fallback through a message, without rebuilding its answer box.
    button.setAttribute('data-tutor-standard-fallback', 'false');
    const talkPatch = source.split('    function updateTutorLiveTalk(message) {')[1]!.split('      const microphone =')[0]!;
    runInNewContext(`function updateTutorReplayMode() {${patch}; (function(message) {${talkPatch}})({standardFallback: true});`, {
      HTMLButtonElement: Element, HTMLElement: Element, HTMLSelectElement: Element,
      document: { querySelector: (s: string) => s.includes('toggleTutor') ? speaker : s.includes('replies') ? replies : button } });
    expect(button.getAttribute('data-tutor-standard-fallback')).toBe('true'); expect(button.disabled).toBe(false);
    expect(answer.value).toBe('Keep this draft.');
    view.tutorState.conversation.status = 'stopped';
    expect(tutorConversationReplayAvailable(view)).toBe(true);
    expect(html(view, settings, { tutorLiveFailed: true })('[data-command="replayTutorQuestion"]').attr('disabled')).toBeUndefined();
  });
  it('finding 7: a failed Live Skip speaks the committed Standard fallback when the speaker is on', async () => {
    const { view, actions } = panel();
    const session = { sendTurn: vi.fn(async () => { throw new Error('closed'); }), close: vi.fn() };
    view.tutorLiveSession = session as never;
    await skipLiveTutorTurn(view, session as never);
    expect(view.tutorLiveFailed).toBe(true);
    expect(actions.readAloudText).toHaveBeenCalledWith(view.tutorState.conversation.currentQuestion, 'en', 'tutor');
  });
  it('finding 8: Groq with Live keeps the Gemini profile reachable in the mounted settings', () => {
    const { view, settings } = panel();
    const $ = html(view, settings), profile = $('[data-setting="tutor.geminiProfile"]');
    expect(profile.length).toBe(1);
    const group = profile.closest('[data-provider-for]');
    const source = readFileSync('src/resultViewHtml.ts', 'utf8');
    const loop = source.split("document.querySelectorAll('[data-provider-for]').forEach((group) => {")[1]!.split("document.querySelectorAll('[data-gemini-profile-for]')")[0]!;
    let hidden = false;
    runInNewContext(`const group = target; (function(group) {${loop.split('});')[0]}})(group);`, {
      target: { hasAttribute: (k: string) => group.attr(k) !== undefined, getAttribute: (k: string) => group.attr(k),
        classList: { toggle: (_k: string, value: boolean) => { hidden = value; } } },
      settingValue: () => 'groq', document: { querySelector: () => ({ value: 'liveGemini' }) } });
    expect(hidden).toBe(false); expect(profile.find('option[value="pro"]').text()).toMatch(/Paid/u);
    expect(profile.closest('.hidden').length).toBe(0);
  });
  it('finding 9: Image Refresh uses Paid and Live Refresh uses its selected profile, including recovery', async () => {
    for (const profile of ['standard', 'pro'] as const) {
      const target = geminiRefreshTarget(profile === 'pro' ? 'alternate' : 'default');
      const get = vi.fn(async (key: string) => key === target.secretKey ? 'fixture-credential' : undefined);
      const discover = vi.fn(async () => []), notify = vi.fn(), executeCommand = vi.fn();
      const scope = { KREN_SECRET_KEYS, GEMINI_KEY: KREN_SECRET_KEYS.gemini, geminiRefreshTarget,
        readPanelSettings: () => ({ tutorProfile: profile }), extensionRuntime: () => ({ getSecret: get }),
        geminiModelDiscoveryProtections: () => ({}), geminiModelCatalog: () => ({ live: [] }), KNOWN_TUTOR_LIVE_MODEL_IDS: [],
        listGeminiLiveModels: discover, listGeminiImageModels: discover, notify, showLookupError: vi.fn(),
        setTimeout, clearTimeout, AbortController, vscode: { commands: { executeCommand }, ProgressLocation: { Notification: 1 },
          window: { withProgress: async (_options: unknown, run: () => unknown) => run() } } };
      await hostFunction('refreshGeminiLiveProfileModels', scope)({ secrets: { get } });
      expect(get).toHaveBeenCalledWith(target.secretKey); expect(discover).toHaveBeenCalledWith('fixture-credential', expect.any(AbortSignal), target.keyHint, {});
      expect(notify.mock.calls[0]?.[1]).toContain(target.label);
      get.mockResolvedValue(undefined); await hostFunction('refreshGeminiLiveProfileModels', scope)({ secrets: { get } });
      expect(executeCommand).toHaveBeenCalledWith(target.setKeyCommand);
    }
    const get = vi.fn(async (key: string) => key === KREN_SECRET_KEYS.geminiPro ? 'fixture-credential' : undefined), discover = vi.fn(async () => []), notify = vi.fn();
    await hostFunction('refreshGeminiImageModels', { KREN_SECRET_KEYS, extensionRuntime: () => ({ getSecret: get }),
      notify, listGeminiImageModels: discover, setTimeout, clearTimeout, AbortController })({});
    expect(discover).toHaveBeenCalledWith('fixture-credential', expect.any(AbortSignal), 'setGeminiProKey');
    get.mockResolvedValue(undefined);
    await hostFunction('refreshGeminiImageModels', { KREN_SECRET_KEYS, extensionRuntime: () => ({ getSecret: get }),
      notify, listGeminiImageModels: discover, setTimeout, clearTimeout, AbortController })({});
    expect(notify).toHaveBeenCalledWith('error', expect.stringContaining('Paid'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    await expect(listGeminiImageModels('fixture-credential', signal(), 'setGeminiProKey')).rejects.toMatchObject({ action: 'setGeminiProKey' });
  });
  it('finding 10: tutor drawer Translate keeps Groq Thorough model with dormant Paid preference', () => {
    const source = readFileSync('src/extension.ts', 'utf8');
    const code = source.split('runTutorTool: (operation, text, signal, targetLanguage, retry) => {')[1]!.split('\n    updateSetting:')[0]!;
    const settings = { ...PANEL_SETTINGS_FIXTURE, tutorProvider: 'groq', tutorProfile: 'pro', tutorModel: 'openai/gpt-oss-120b' };
    const run = vi.fn();
    runInNewContext(ts.transpile(`const runTutorTool = (operation, text, signal, targetLanguage, retry) => {${code}; runTutorTool('translate', 'word '.repeat(45), signal, 'ko', true);`, { target: ts.ScriptTarget.ES2022 }), {
      readPanelSettings: () => settings, extensionRuntime: () => ({}), context: {}, signal: signal(), runTutorTranslation: run, runKrenOperation: vi.fn() });
    expect(run.mock.calls[0]?.[1]).toMatchObject({ provider: 'groq', model: settings.tutorModel });
  });
  it('finding 11: missing User Dictionary Paid key recovers through Paid setup', async () => {
    const rt = runtime({ 'userDictionary.enabled': true, 'userDictionary.geminiProfile': 'pro', 'userDictionary.captureMode': 'llm' });
    await expect(runUserDictionaryCapture(rt, 'hello', signal())).rejects.toMatchObject({ action: 'setGeminiProKey', message: expect.stringContaining('Paid') });
  });
  it('command naming: every contributed command uses category KREN without a title prefix', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
    for (const command of manifest.contributes.commands) {
      expect(command.category, command.command).toBe('KREN'); expect(command.title, command.command).not.toMatch(/^KREN:/u);
    }
  });
});
