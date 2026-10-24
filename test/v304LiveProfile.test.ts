import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { load } from 'cheerio';
import { renderKrenResultViewHtml, type KrenPanelSettings } from '../src/resultViewHtml.js';
import { createTutorViewState } from '../src/tutor/state.js';
import { TUTOR_DEFAULTS } from '../src/tutor/defaults.js';
import { validatedPanelSetting } from '../src/panelSettings.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';
import { runTutorStructuredRequest, KREN_SECRET_KEYS, type KrenRuntime } from '../src/operations.js';
import { tutorLiveSessionCredentialRequest, type TutorStructuredGenerationRequest } from '../src/tutor/generation.js';
import * as usage from '../src/languageModelUsage.js';
import { TutorLiveSessionError, type TutorLiveSocketEvent } from '../src/tutor/liveSession.js';

// Changed 2026-10-23 (V306, verification R30): start choices inspect the effective configuration scope.
vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback, inspect: () => undefined }) },
  window: {}, commands: { executeCommand: vi.fn() }, env: {}, Uri: { joinPath: () => ({ toString: () => 'test' }) } }));
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { startTutorConversation, tutorLanguageModelRoute, openTutorLiveSession } from '../src/resultsViewConversation.js';
import { startTutorConversationDemo, openTutorDemoLiveSessions } from '../src/resultsViewDemo.js';
import { previewTutorGeminiVoice, updateTutorSetting } from '../src/resultsViewSettings.js';
import { disableTutorLive } from '../src/resultsViewLive.js';

const extension = readFileSync('src/extension.ts', 'utf8');
function extensionFunction(name: string, dependencies: Record<string, unknown>) {
  const file = ts.createSourceFile('extension.ts', extension, ts.ScriptTarget.Latest, true);
  const node = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
  const js = ts.transpileModule(node.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(js + '\n' + name, dependencies) as (...args: any[]) => Promise<any>;
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const views: KrenResultsViewProvider[] = [];
afterEach(() => { for (const view of views.splice(0)) view.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

class Socket {
  readyState = 0;
  listeners = new Map<string, Array<(event: TutorLiveSocketEvent) => void>>();
  send = vi.fn((raw: string) => {
    const frame = JSON.parse(raw);
    if (frame.setup) queueMicrotask(() => this.emit('message', { setupComplete: {} }));
    if (frame.clientContent) queueMicrotask(() => this.emit('message', { serverContent: {
      outputTranscription: { text: 'Hello.' }, turnComplete: true
    }, usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 } }));
  });
  close = vi.fn();
  addEventListener(type: string, callback: (event: TutorLiveSocketEvent) => void) {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], callback]);
    if (type === 'open') queueMicrotask(() => { this.readyState = 1; callback({}); });
  }
  removeEventListener(type: string, callback: (event: TutorLiveSocketEvent) => void) {
    this.listeners.set(type, this.listeners.get(type)?.filter(value => value !== callback) ?? []);
  }
  emit(type: string, data: unknown) { this.listeners.get(type)?.forEach(callback => callback({ data: JSON.stringify(data) })); }
}
function fixture(profile: 'standard' | 'pro' = 'pro', selected = false, other = true) {
  const settings: KrenPanelSettings = { ...PANEL_SETTINGS_FIXTURE, tutorProfile: profile === 'pro' ? 'standard' : 'pro',
    tutorLiveProfile: profile, tutorReadAloudProvider: 'edgeOnline', credentialPresence: {
      geminiDefault: profile === 'standard' ? selected : other, geminiAlternate: profile === 'pro' ? selected : other
    } };
  const sockets: Socket[] = [];
  const actions = { settings: () => settings, notify: vi.fn(), log: vi.fn(), stopReadAloud: vi.fn(),
    readAloudText: vi.fn(async () => undefined), writeTutorPreferences: vi.fn(),
    updateSetting: vi.fn(async (key: string, value: unknown) => {
      if (key === 'tutor.liveGeminiProfile') settings.tutorLiveProfile = value as 'standard' | 'pro';
    }), generateTutor: vi.fn(async (request: TutorStructuredGenerationRequest) => {
      if (request.kind === 'liveSessionCredential') return { apiKey: String(Symbol()) };
      // Keep the opening pending, because start tests inspect the boundary before a reply.
      return new Promise(() => {});
    }) };
  const player = { play: vi.fn(), stop: vi.fn(), close: vi.fn() };
  const view = new KrenResultsViewProvider(actions as never, {} as never, undefined, undefined,
    () => { const socket = new Socket(); sockets.push(socket); return socket; },
    { start: vi.fn(async () => player) });
  views.push(view);
  Object.assign(view.tutorState.conversation, { from: 'anything', replies: 'liveGemini', situationPicture: 'none' });
  vi.spyOn(view, 'render').mockImplementation(() => undefined);
  let resolve!: (choice?: string) => void;
  const popup = vi.spyOn(view, 'showInformationMessage').mockImplementation(() => new Promise(done => { resolve = done; }));
  return { view, settings, actions, sockets, popup, choose: (choice?: string) => resolve(choice) };
}

describe('V304 migration and storage', () => {
  it.each(['globalValue', 'workspaceValue', 'workspaceFolderValue'])('seeds Paid from explicit tutor %s, then the second run is a no-op', async field => {
    const values: Record<string, any> = { 'tutor.geminiProfile': { [field]: 'pro' } };
    const update = vi.fn(async (key: string, value: unknown) => { values[key] = { globalValue: value }; });
    const config = { inspect: (key: string) => values[key], get: () => 'standard', update };
    const migrate = extensionFunction('migrateTutorLiveGeminiProfile', { vscode: {
      workspace: { getConfiguration: () => config }, ConfigurationTarget: { Global: 1 }
    } });
    await migrate(); await migrate();
    expect(update.mock.calls).toEqual([['tutor.liveGeminiProfile', 'pro', 1]]);
  });
  it.each(['globalValue', 'workspaceValue', 'workspaceFolderValue'])('keeps Live explicitly set at %s', async field => {
    const update = vi.fn();
    const config = { inspect: (key: string) => key === 'tutor.liveGeminiProfile' ? { [field]: 'standard' } : { globalValue: 'pro' }, update };
    await extensionFunction('migrateTutorLiveGeminiProfile', { vscode: { workspace: { getConfiguration: () => config } } })();
    expect(update).not.toHaveBeenCalled();
  });
  it('uses the effective tutor profile when no scope is explicit and runs on activation', async () => {
    const update = vi.fn();
    await extensionFunction('migrateTutorLiveGeminiProfile', { vscode: { workspace: { getConfiguration: () => ({
      inspect: () => undefined, get: () => 'pro', update
    }) }, ConfigurationTarget: { Global: 1 } } })();
    expect(update).toHaveBeenCalledWith('tutor.liveGeminiProfile', 'pro', 1);
    expect(extension.slice(extension.indexOf('export async function activate'), extension.indexOf('export function deactivate'))).toContain('await migrateTutorLiveGeminiProfile()');
  });
  it('declares Free Tier and stores both valid choices through the real panel write path', async () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(manifest.contributes.configuration.properties['kren.tutor.liveGeminiProfile']).toMatchObject({ default: 'standard', enum: ['standard', 'pro'] });
    expect(TUTOR_DEFAULTS.configuration['tutor.liveGeminiProfile']).toBe('standard');
    expect(validatedPanelSetting('tutor.liveGeminiProfile', 'bad')).toBeUndefined();
    const f = fixture();
    for (const value of ['standard', 'pro']) {
      expect(validatedPanelSetting('tutor.liveGeminiProfile', value)).toBe(value);
      await updateTutorSetting(f.view, 'tutor.liveGeminiProfile', value);
      expect(f.actions.updateSetting).toHaveBeenLastCalledWith('tutor.liveGeminiProfile', value);
      expect(f.view.render).toHaveBeenLastCalledWith(false, true);
    }
  });
});

describe('V304 start check', () => {
  for (const profile of ['standard', 'pro'] as const) {
    const label = profile === 'pro' ? 'Paid' : 'Free Tier';
    const otherLabel = profile === 'pro' ? 'Free Tier' : 'Paid';
    it(`${label}: stored Live key starts normally`, () => {
      const f = fixture(profile, true);
      startTutorConversation(f.view);
      expect(f.popup).not.toHaveBeenCalled();
      expect(f.actions.generateTutor).toHaveBeenCalled();
    });
    it(`${label}: two choices when the other key is missing`, () => {
      const f = fixture(profile, false, false);
      startTutorConversation(f.view);
      expect(f.popup).toHaveBeenCalledWith(
        `Live replies need the Gemini ${label} key. Set it in Credentials, choose the other profile for Live, or switch Replies to Standard.`,
        // Changed 2026-10-24 (V308, owner I77/I78/I79): VS Code supplies Cancel, so Stop is no longer an explicit choice.
        { modal: true }, 'Switch to Standard');
      expect(f.actions.generateTutor).not.toHaveBeenCalled();
    });
    for (const demo of [false, true]) {
      it(`${label}: ${demo ? 'Demo' : 'Start'} sends zero requests before a choice and saves the other profile before starting`, async () => {
        const f = fixture(profile);
        (demo ? startTutorConversationDemo : startTutorConversation)(f.view);
        expect(f.popup).toHaveBeenCalledWith(expect.stringContaining(`Gemini ${label} key`), { modal: true },
          // Changed 2026-10-24 (V308, owner I77/I78/I79): Start and Demo expose only available routes beside native Cancel.
          `Use Gemini ${otherLabel}`, 'Switch to Standard');
        expect(f.actions.generateTutor).not.toHaveBeenCalled();
        expect(f.sockets).toHaveLength(0);
        expect(f.view.tutorState.conversation.status).toBe('idle');
        // A second click must neither duplicate the question nor start another request.
        (demo ? startTutorConversationDemo : startTutorConversation)(f.view);
        expect(f.popup).toHaveBeenCalledTimes(1);
        f.choose(`Use Gemini ${otherLabel}`); await flush();
        expect(f.actions.updateSetting).toHaveBeenCalledWith('tutor.liveGeminiProfile', profile === 'pro' ? 'standard' : 'pro');
        expect(f.settings.tutorProfile).toBe(profile === 'pro' ? 'standard' : 'pro');
        expect(f.view.tutorState.conversation.status).toBe('active');
        expect(f.actions.generateTutor).toHaveBeenCalled();
        expect(f.actions.updateSetting.mock.invocationCallOrder[0]).toBeLessThan(f.actions.generateTutor.mock.invocationCallOrder[0]!);
      });
      it(`${label}: ${demo ? 'Demo' : 'Start'} saves Standard and starts`, async () => {
        const f = fixture(profile);
        if (demo) f.settings.tutorReadAloudProvider = 'googleChirp';
        (demo ? startTutorConversationDemo : startTutorConversation)(f.view);
        f.choose('Switch to Standard'); await flush();
        expect(f.view.tutorState.conversation.replies).toBe('standard');
        expect(f.actions.writeTutorPreferences).toHaveBeenCalledWith(expect.objectContaining({ replies: 'standard' }));
        expect(f.view.tutorState.conversation.status).toBe('active');
        expect(f.actions.generateTutor).toHaveBeenCalled();
        expect(f.actions.updateSetting).not.toHaveBeenCalled();
      });
    }
    // Changed 2026-10-24 (V308, owner I77/I78/I79): cancellation returns undefined for both Start and Demo.
    it.each([false, true])(`${label}: Demo %s cancellation starts nothing and saves nothing`, async demo => {
      const f = fixture(profile);
      (demo ? startTutorConversationDemo : startTutorConversation)(f.view); f.choose(undefined); await flush();
      expect(f.actions.generateTutor).not.toHaveBeenCalled();
      expect(f.actions.updateSetting).not.toHaveBeenCalled();
      expect(f.actions.writeTutorPreferences).not.toHaveBeenCalled();
      expect(f.view.tutorState.conversation.status).toBe('idle');
    });
  }
  it('Standard bypasses the Live check', () => {
    const f = fixture(); f.view.tutorState.conversation.replies = 'standard';
    startTutorConversation(f.view);
    expect(f.popup).not.toHaveBeenCalled(); expect(f.actions.generateTutor).toHaveBeenCalled();
  });
  it('failed setting persistence starts nothing and reports a fixed error', async () => {
    const f = fixture(); f.actions.updateSetting.mockRejectedValueOnce(new Error());
    startTutorConversation(f.view); f.choose('Use Gemini Free Tier'); await flush();
    expect(f.actions.generateTutor).not.toHaveBeenCalled(); expect(f.actions.notify).toHaveBeenCalledWith('error', expect.stringContaining('could not save'));
  });
});

describe('V304 Live routing and retained fallback', () => {
  it.each(['standard', 'pro'] as const)('Live key reads %s independently of the text profile', async profile => {
    const getSecret = vi.fn(async () => String(Symbol()));
    const runtime = { getSecret, getSetting: (key: string, fallback: unknown) => key === 'tutor.liveGeminiProfile' ? profile : fallback,
      beforeLanguageModelRequest: vi.fn(), beforeGeminiRequest: vi.fn() } as unknown as KrenRuntime;
    await runTutorStructuredRequest(runtime, {
      provider: 'openai', model: 'test-model', geminiProfile: profile === 'pro' ? 'standard' : 'pro', thinkingOrEffort: 'auto', fallbackEnabled: false,
      fallbackModel: 'test-model', fallbackThinkingOrEffort: 'auto'
    }, tutorLiveSessionCredentialRequest(), new AbortController().signal);
    expect(getSecret).toHaveBeenCalledWith(profile === 'pro' ? KREN_SECRET_KEYS.geminiPro : KREN_SECRET_KEYS.gemini);
    expect(runtime.beforeLanguageModelRequest).toHaveBeenCalledWith('gemini', profile);
  });
  it.each(['standard', 'pro'] as const)('Refresh discovers using Live %s', async profile => {
    const target = vi.fn(() => ({ secretKey: 'slot', label: 'Live' }));
    const list = vi.fn(async () => []);
    await extensionFunction('refreshGeminiLiveProfileModels', {
      geminiModelDiscoveryProtections: () => ({}), geminiModelCatalog: () => ({ live: [] }), KNOWN_TUTOR_LIVE_MODEL_IDS: [],
      geminiRefreshTarget: target, readPanelSettings: () => ({ tutorProfile: profile === 'pro' ? 'standard' : 'pro', tutorLiveProfile: profile }),
      withKrenProgress: (_options: unknown, run: () => unknown) => run(), listGeminiLiveModels: list,
      notify: vi.fn(), AbortController, setTimeout, clearTimeout
    })({ secrets: { get: async () => String(Symbol()) } });
    expect(target).toHaveBeenCalledWith(profile === 'pro' ? 'alternate' : 'default'); expect(list).toHaveBeenCalled();
  });
  it('conversation, Preview and Demo usage records use Live Paid while text stays Free Tier', async () => {
    const record = vi.spyOn(usage, 'recordLanguageModelUsage');
    const f = fixture('pro', true); f.view.tutorState.conversation.status = 'active';
    const signal = new AbortController().signal;
    const session = await openTutorLiveSession(f.view, 'Practice English.', signal, () => true);
    await session.sendTurn('Hello.');
    expect(tutorLanguageModelRoute(f.view).geminiProfile).toBe('standard');
    await previewTutorGeminiVoice(f.view);
    const controller = new AbortController();
    await openTutorDemoLiveSessions(f.view, f.view.tutorDemoGeneration, controller);
    await f.view.tutorDemoLiveSessions.male!.sendTurn('Hello.');
    await f.view.tutorDemoLiveSessions.female!.sendTurn('Hello.');
    expect(record).toHaveBeenCalledTimes(4);
    for (const [route] of record.mock.calls) expect(route).toMatchObject({ provider: 'gemini', geminiProfile: 'pro' });
  });
  it('a mid-conversation Live drop still continues with Standard and says so', () => {
    const f = fixture('pro', true); f.view.tutorState.conversation.status = 'active';
    disableTutorLive(f.view, new TutorLiveSessionError('socketClosed'), 'V304 test');
    expect(f.view.tutorLiveFailed).toBe(true);
    expect(f.actions.notify).toHaveBeenCalledWith('warning', 'The Live session stopped. KREN continues with Standard replies.');
    expect(f.popup).not.toHaveBeenCalled(); expect(f.actions.updateSetting).not.toHaveBeenCalled();
  });
});

function html(settings: KrenPanelSettings, active = false) {
  const tutor = createTutorViewState();
  if (active) Object.assign(tutor.conversation, { status: 'active', currentQuestion: 'Hello.', busy: false });
  return renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'tutor', settings, tutor, proModels: [] });
}
describe('V304 reader access and mounted updates', () => {
  it('Live profile is reachable beside Live Model for a non-Gemini text provider', () => {
    const f = fixture('pro'); f.settings.tutorProvider = 'openai';
    const $ = load(html(f.settings));
    const profile = $('[data-setting="tutor.liveGeminiProfile"]');
    expect(profile).toHaveLength(1);
    expect(profile.closest('[data-llm-routing="tutor"]')).toHaveLength(1);
    expect(profile.closest('[data-persist-id="tutor-setting"]')).toHaveLength(1);
    expect(profile.parents('[data-provider-for], [hidden], .hidden')).toHaveLength(0);
    expect(profile.parents('details')).toHaveLength(2);
    expect(profile.closest('[data-persist-id="tutor-setting"]').children('summary').text()).toContain('VOICE & MODEL');
    expect(profile.closest('label').nextAll().filter('label').first().find('[data-model-preset="tutor.liveModel"]')).toHaveLength(1);
    expect(profile.is('[disabled], [tabindex="-1"]')).toBe(false);
    expect(profile.find('option[disabled]')).toHaveLength(0);
    expect(profile.hasClass('credential-missing')).toBe(true);
    const note = $('[data-credential-setting="tutor.liveGeminiProfile"]');
    expect(note.is('[hidden]')).toBe(false); expect(note.text()).toContain('Gemini Free Tier has a key');
    expect(note.find('a[href="#"][data-command="showCredentials"]')).toHaveLength(1);
    expect($('[data-command="startTutorConversationDemo"]').is('[disabled]')).toBe(false);
    // Native summaries expose the setting path to keyboard users before opening either fold.
    expect(profile.closest('[data-llm-routing]').children('summary').text()).toContain('LLM ROUTING');
  });
  it('mounted profile changes store the choice and patch gray state and other-profile hint without replacing the composer or a draft', () => {
    const f = fixture('pro');
    const messages: Record<string, unknown>[] = [];
    const panel = mountedPanel(html(f.settings, true), message => messages.push(message));
    const profile = panel.document.querySelector('[data-setting="tutor.liveGeminiProfile"]')!;
    const composer = panel.document.querySelector('[data-tutor-composer]');
    expect(composer).not.toBeNull();
    const answer = panel.document.querySelector('[data-tutor-map-search]');
    expect(answer).not.toBeNull();
    answer!.value = 'Keep this draft.';
    profile.value = 'standard'; panel.change(profile);
    expect(messages).toContainEqual(expect.objectContaining({ command: 'updateSetting', key: 'tutor.liveGeminiProfile', value: 'standard' }));
    expect(profile.classList.contains('credential-missing')).toBe(false);
    const note = panel.document.querySelector('[data-credential-setting="tutor.liveGeminiProfile"]')!;
    expect(note.hidden).toBe(true);
    profile.value = 'pro'; panel.change(profile);
    expect(profile.classList.contains('credential-missing')).toBe(true);
    expect(note.textContent).toContain('Gemini Free Tier has a key');
    expect(panel.document.querySelector('[data-tutor-map-search]')).toBe(answer);
    expect(panel.document.querySelector('[data-tutor-composer]')).toBe(composer);
    expect(answer!.value).toBe('Keep this draft.');
    panel.message({ command: 'credentialPresenceReady', presence: { geminiDefault: false, geminiAlternate: true } });
    expect(note.hidden).toBe(true); expect(profile.classList.contains('credential-missing')).toBe(false);
    // Exercise the real host patch, not just the select's local change event.
    f.settings.tutorLiveProfile = 'standard';
    panel.message({ command: 'tutorVoiceModelReady', html: html(f.settings, true) });
    expect(panel.document.querySelector('[data-setting="tutor.liveGeminiProfile"]')!.value).toBe('standard');
    expect(panel.document.querySelector('[data-tutor-composer]')).toBe(composer);
    expect(panel.document.querySelector('[data-tutor-map-search]')).toBe(answer);
    expect(answer!.value).toBe('Keep this draft.');
  });
});
