import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountedPanel } from './support/mountedPanel.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const configuration = vi.hoisted(() => new Map<string, unknown>());
vi.mock('vscode', () => ({
  commands: { executeCommand: vi.fn() }, env: { remoteName: undefined },
  workspace: { getConfiguration: () => ({ get: (key: string, fallback: unknown) => configuration.get(key) ?? fallback }) },
  Uri: { joinPath: (...parts: unknown[]) => parts }, window: { showWarningMessage: vi.fn() }
}));

import { KrenResultsViewProvider } from '../src/resultsView.js';
import { tutorSpeechPlaybackBarriers } from '../src/speech/speechAdapter.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { ensureTutorConversationPicture, generateTutorConversation } from '../src/resultsViewConversation.js';
import { writeTutorConversationHint, writeTutorPracticeHint } from '../src/resultsViewHints.js';
import { finalizeTutorTakeHome } from '../src/resultsViewTakeHome.js';
import { missingCredentialError, missingCredentialsOf, OPEN_CREDENTIALS, recordedRequestOutcome } from '../src/requestCenter.js';
import { ProviderError } from '../src/errors.js';
import { ProviderExhaustionState } from '../src/languageModelSwitching.js';
import { KREN_SECRET_KEYS, runTutorStructuredRequest, type KrenRuntime, type TutorLanguageModelRoute } from '../src/operations.js';
import type { TutorStructuredGenerationRequest } from '../src/tutor/generation.js';
import type { TutorLiveSocket, TutorLiveSocketEvent } from '../src/tutor/liveSession.js';

const scene = 'Two colleagues meet. A visitor approaches.';
const opening = 'How can I help?';
const request: TutorStructuredGenerationRequest = { kind: 'practiceHint', input: '{}', instruction: 'Return a hint.', schema: {}, schemaName: 'v300' };
const route: TutorLanguageModelRoute = { provider: 'gemini', geminiProfile: 'standard', model: 'gemini-3.8-flash',
  thinkingOrEffort: 'auto', fastModel: 'gemini-custom-fast', fallbackEnabled: true, fallbackModel: 'gemini-3.5-flash-lite', fallbackThinkingOrEffort: 'auto' };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
class Socket implements TutorLiveSocket {
  readyState = 0;
  sent: Array<Record<string, any>> = [];
  listeners = new Map<string, Set<(event: TutorLiveSocketEvent) => void>>();
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; }
  addEventListener(type: string, callback: (event: TutorLiveSocketEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(callback);
  }
  removeEventListener(type: string, callback: (event: TutorLiveSocketEvent) => void) { this.listeners.get(type)?.delete(callback); }
  emit(type: string, data?: unknown) {
    if (type === 'open') this.readyState = 1;
    this.listeners.get(type)?.forEach(callback => callback({ data }));
  }
  complete(text: string) {
    this.emit('message', JSON.stringify({ serverContent: { outputTranscription: { text }, modelTurn: { parts: [
      { inlineData: { data: Buffer.alloc(48_000).toString('base64'), mimeType: 'audio/pcm;rate=24000' } }
    ] }, turnComplete: true } }));
  }
  turns() { return this.sent.filter(message => message.clientContent); }
}

const cleanup: Array<() => void> = [];
function fixture(mode: 'standard' | 'live' | 'demo' = 'standard') {
  const narration = deferred();
  const sockets: Socket[] = [];
  let progress: ((completed: number, queued: number) => void) | undefined;
  let panel: ReturnType<typeof mountedPanel> | undefined;
  const player = { play: vi.fn(), stop: vi.fn(), close: vi.fn() };
  const settings = { ...PANEL_SETTINGS_FIXTURE, tutorReadAloudProvider: 'edgeOnline' as const,
    credentialPresence: { geminiDefault: true, geminiAlternate: true, cloudflareAccountId: false, cloudflareApiToken: true } };
  const played = vi.fn();
  const actions = { settings: () => settings, notify: vi.fn(), log: vi.fn(), stopReadAloud: vi.fn(),
    readAloudText: vi.fn((text: string) => {
      // Changed 2026-10-23 (V303, owner I63): preparation can run without starting playback.
      const barrier = tutorSpeechPlaybackBarriers.get(actions.readAloudText);
      return (async () => {
        if (barrier && !await barrier()) return;
        played(text);
        view.tutorSpeechPlaybackStarted();
        if (text === scene) await narration.promise;
      })();
    }),
    generateTutor: vi.fn(async (input: TutorStructuredGenerationRequest): Promise<unknown> => {
      if (input.kind === 'liveSessionCredential') return { apiKey: ['unit', 'fixture'].join('-') };
      if (input.kind === 'conversationOpening') return { scene, opening, tutorRole: 'colleague', learnerRole: 'visitor' };
      if (input.kind === 'conversationDemoCast') return { scene, male: { name: 'Tom', role: 'colleague', description: 'A man.' },
        female: { name: 'Mina', role: 'visitor', description: 'A woman.' } };
      if (input.kind === 'conversationDemoBatch') return { lines: Array.from({ length: 8 }, (_, i) => ({
        speaker: i % 2 ? 'male' : 'female', text: `Line ${i + 1}.`
      })) };
      return {};
    }), generateSituationPicture: vi.fn(async (): Promise<string> => 'data:image/png;base64,AAAA'),
    writeTutorPreferences: vi.fn(), updateSetting: vi.fn(), refreshReadAloudVoices: vi.fn(async () => []) };
  const view = new KrenResultsViewProvider(actions as never, {} as never, undefined, undefined,
    () => { const socket = new Socket(); sockets.push(socket); return socket; },
    { start: vi.fn(async (_error, onProgress) => { progress = onProgress; return player; }) });
  const internals = view as unknown as { handleMessage(message: unknown): Promise<void>; activeScreen: string };
  internals.activeScreen = 'tutor';
  Object.assign(view.tutorState.conversation, { from: 'anything', replies: mode === 'live' ? 'liveGemini' : 'standard',
    starts: 'kren', speakerOn: true, situationPicture: 'none', coaching: 'afterwards' });
  const messages: Record<string, any>[] = [];
  view.view = { webview: { html: '', cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }),
    postMessage: async (message: Record<string, any>) => { messages.push(message); panel?.message(message); return true; } } } as never;
  vi.spyOn(view, 'render').mockImplementation(() => undefined);
  cleanup.push(() => { view.dispose(); narration.resolve(); });
  return { view, settings, actions, player, sockets, narration, messages, played,
    command: (command: string) => internals.handleMessage({ command }), drain: () => progress?.(1, 0),
    mount: () => {
      panel = mountedPanel(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', settings, activeScreen: 'tutor',
        tutor: view.tutorState, tutorConversationScene: scene, proModels: [] }), () => undefined);
      return panel;
    } };
}
async function flush() { await vi.advanceTimersByTimeAsync(0); }
async function startLive(f: ReturnType<typeof fixture>) {
  await f.command('startTutorConversation'); await flush();
  const socket = f.sockets[0]!;
  socket.emit('open'); socket.emit('message', JSON.stringify({ setupComplete: {} })); await flush();
  socket.complete(scene); await flush(); f.drain(); await flush();
  return socket;
}
function popup(f: ReturnType<typeof fixture>) {
  const show = vi.spyOn(f.view, 'showErrorMessage').mockResolvedValue(OPEN_CREDENTIALS);
  const open = vi.spyOn(f.view, 'showCredentials').mockResolvedValue(undefined);
  return { show, open };
}
function expectPopup(show: ReturnType<typeof popup>['show'], name: RegExp) {
  expect(show).toHaveBeenCalledWith(expect.stringMatching(name), { modal: true }, OPEN_CREDENTIALS);
  const message = show.mock.calls[0]![0];
  expect(message).toContain('in KREN menu, Credentials.');
  expect(message).toContain('Or press Cancel and choose another provider.');
}

describe('V300 conversation verification fixes', () => {
  beforeEach(() => vi.useFakeTimers({ now: 10_000 }));
  afterEach(async () => {
    for (const close of cleanup.splice(0)) close();
    await flush(); configuration.clear(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it('fix 1: speaker off at 500 ms still delivers the Live opening and reachable controls', async () => {
    const f = fixture('live'); const socket = await startLive(f); const panel = f.mount();
    await vi.advanceTimersByTimeAsync(500);
    await f.command('toggleTutorConversationSpeaker'); await flush();
    expect(socket.turns()).toHaveLength(2);
    const played = f.player.play.mock.calls.length;
    socket.complete(opening); await flush();
    expect(f.player.play).toHaveBeenCalledTimes(played);
    expect(f.view.tutorState.conversation).toMatchObject({ currentQuestion: opening, busy: false, speakerOn: false });
    expect(f.view.tutorConversationController).toBeUndefined();
    expect(f.view.tutorIntroCompletionWait).toBeUndefined();
    expect(f.messages).toContainEqual(expect.objectContaining({ command: 'tutorConversationOpeningReady', opening, reveal: 'ready', talkAvailable: true }));
    const mic = panel.query('[data-tutor-chat-mic-control]')!;
    const stop = panel.query('[data-tutor-composer-stop]')!;
    for (const control of [mic, stop]) {
      expect(control.closest('[hidden], details:not([open])')).toBeNull();
      expect(control.getAttribute('tabindex')).not.toBe('-1');
    }
    expect(stop.disabled).toBe(false); stop.focus(); expect(panel.document.activeElement).toBe(stop);
    if (mic.disabled) expect(mic.title).toMatch(/microphone|speech|dictation|unavailable|start/iu);
    else { mic.focus(); expect(panel.document.activeElement).toBe(mic); }
  });

  it.each(['standard', 'demo'] as const)('fix 1: %s mute during the pause releases text without reading more lines', async mode => {
    const f = fixture(mode);
    await f.command(mode === 'demo' ? 'startTutorConversationDemo' : 'startTutorConversation'); await flush();
    f.narration.resolve(); await flush(); await vi.advanceTimersByTimeAsync(500);
    await f.command('toggleTutorConversationSpeaker'); await flush(); await vi.advanceTimersByTimeAsync(1_000);
    // Changed 2026-10-23 (V303, owner I63): muting discards the prepared first line, only the intro played.
    expect(f.actions.readAloudText).toHaveBeenCalledTimes(2);
    expect(f.played).toHaveBeenCalledTimes(1);
    expect(f.view.tutorIntroCompletionWait).toBeUndefined();
    if (mode === 'standard') expect(f.view.tutorState.conversation.openingReveal).toBeUndefined();
    else expect(f.view.tutorState.conversation.demoLines.length).toBeGreaterThan(0);
  });

  it.each(['stopTutorConversation', 'showStartPage', 'startNewTutorConversation'])('fix 1: %s after mute discards the pending Live opening', async command => {
    const f = fixture('live'); const socket = await startLive(f);
    await vi.advanceTimersByTimeAsync(500); await f.command('toggleTutorConversationSpeaker'); await flush();
    if (command === 'startNewTutorConversation') await f.command('stopTutorConversation');
    await f.command(command); await flush();
    const state = JSON.stringify(f.view.tutorState.conversation);
    socket.complete(opening); await vi.advanceTimersByTimeAsync(2_000);
    expect(JSON.stringify(f.view.tutorState.conversation)).toBe(state);
    expect(f.messages.filter(message => message.command === 'tutorConversationOpeningReady' && message.opening === opening)).toEqual([]);
  });

  it('fix 3: a switched Fast request failing with 404 sends no fallback', async () => {
    const selected = { ...route, provider: 'groq' as const, model: 'openai/gpt-oss-120b' };
    const exhaustion = new ProviderExhaustionState();
    exhaustion.mark(selected, new ProviderError('The daily allowance is used up.', undefined, false, 429, 'quotaExhausted'));
    const runtime: KrenRuntime = { providerExhaustion: exhaustion,
      getSecret: async key => [KREN_SECRET_KEYS.gemini, KREN_SECRET_KEYS.groq].includes(key as never) ? 'fixture-value' : undefined,
      getSetting: <T>(key: string, fallback: T): T => ({ 'llm.providerSwitch': true,
        'llm.providerOrder': ['groq', 'gemini', 'cloudflare', 'openai', 'anthropic'],
        'gemini.retry.enabled': false, 'languageModel.retry.enabled': false }[key] ?? fallback) as T,
      reserveCloudCharacters: vi.fn(), beforeGeminiRequest: vi.fn(), log: vi.fn(), providerSwitchNotice: vi.fn() };
    const sends: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      sends.push(String(url)); return new Response('{}', { status: 404 });
    }));
    const error = await runTutorStructuredRequest(runtime, selected, request, new AbortController().signal).catch(error => error);
    expect(error).toMatchObject({ status: 404, attemptedRoute: { provider: 'gemini' } });
    expect(recordedRequestOutcome(error)?.recovery).toContainEqual(expect.objectContaining({ decision: 'preflightSkip' }));
    expect(sends).toHaveLength(1);
    expect(sends[0]).not.toContain('custom-fast');
    expect(recordedRequestOutcome(error)?.recovery.some(item => item.decision === 'fallback')).toBe(false);
  });

  it('fix 4: the Live-only Fast model error names kren.tutor.hintModel', async () => {
    const f = fixture();
    f.view.liveModels = [{ id: 'gemini-2.0-flash-live-001', displayName: 'Live', liveOnly: true }];
    configuration.set('tutor.hintModel', 'gemini-2.0-flash-live-001');
    f.settings.tutorFallbackEnabled = true;
    f.view.tutorState.settings.routing.provider = 'gemini';
    await expect(generateTutorConversation(f.view, request, new AbortController().signal, undefined,
      { ...route, fastModel: 'gemini-2.0-flash-live-001', fallbackModel: 'ordinary-retired-value' })).rejects.toThrow(/kren\.tutor\.hintModel/u);
    await expect(generateTutorConversation(f.view, request, new AbortController().signal)).rejects.toThrow(/kren\.tutor\.hintModel/u);
    expect(f.actions.generateTutor).not.toHaveBeenCalled();
  });

  it.each(['practice', 'conversation', 'takeHome'] as const)('fix 5: %s missing keys show both sentences and Open Credentials, then settle state', async kind => {
    const f = fixture(); const { show, open } = popup(f);
    f.actions.generateTutor.mockRejectedValue(missingCredentialError('gemini', 'pro'));
    Object.assign(f.view.tutorState.conversation, { status: 'active', currentQuestion: opening, speakerOn: false,
      transcript: [{ question: opening, learnerAnswer: 'I like tea.', correction: 'I like tea.', explanation: 'Correct.' }] });
    if (kind === 'practice') {
      f.view.tutorState.exerciseSet = { exercises: [{ id: 'one', prompt: 'Ask for help.', targetIds: [] }] } as never;
      await writeTutorPracticeHint(f.view, 'one');
      expect(f.view.tutorState.exerciseHintBusyIds).toEqual([]);
      expect(f.view.tutorState.exerciseHintFailures.one).toBeTruthy();
      expect(f.view.tutorHintControllers.size).toBe(0);
    } else if (kind === 'conversation') {
      await writeTutorConversationHint(f.view);
      expect(f.view.tutorState.conversation).toMatchObject({ hintBusy: false, hintFailure: expect.any(String) });
      expect(f.view.tutorConversationHintController).toBeUndefined();
    } else {
      f.view.tutorState.conversation.status = 'stopped'; finalizeTutorTakeHome(f.view); await flush();
      expect(f.view.tutorState.conversation.takeHome).toMatchObject({ failure: expect.any(String) });
      expect(f.view.tutorTakeHomeController).toBeUndefined();
    }
    await flush(); expectPopup(show, /Gemini Paid.*API key/u); expect(open).toHaveBeenCalledOnce();
  });

  it('fix 5: a background Hint failure waits for a reader action before showing a popup', async () => {
    const f = fixture(); const { show } = popup(f);
    Object.assign(f.view.tutorState.conversation, { status: 'active', currentQuestion: opening });
    f.actions.generateTutor.mockRejectedValue(missingCredentialError('groq'));
    await writeTutorConversationHint(f.view, false); await flush(); expect(show).not.toHaveBeenCalled();
    await writeTutorConversationHint(f.view); await flush(); expectPopup(show, /Groq.*API key/u);
  });

  it.each([
    ['cloudflare', false, true, ['account ID']], ['cloudflare', true, false, ['API token']],
    ['cloudflare', false, false, ['account ID', 'API token']], ['gemini', false, false, ['API key']]
  ] as const)('fix 6: %s picture pause with account %s and token %s names only missing slots once per conversation', async (provider, account, token, slots) => {
    const f = fixture(); const { show, open } = popup(f);
    f.settings.tutorPictureProvider = provider; f.settings.credentialPresence.geminiAlternate = false;
    f.settings.credentialPresence.cloudflareAccountId = account; f.settings.credentialPresence.cloudflareApiToken = token;
    Object.assign(f.view.tutorState.conversation, { status: 'active', situationPicture: 'intro' });
    f.view.tutorConversationScene = scene;
    const shared = vi.spyOn(f.view, 'showMissingCredentialError');
    ensureTutorConversationPicture(f.view); ensureTutorConversationPicture(f.view); await flush();
    expect(show).toHaveBeenCalledOnce(); expect(open).toHaveBeenCalledOnce();
    expectPopup(show, provider === 'gemini' ? /Gemini Paid/u : /Cloudflare/u);
    expect(missingCredentialsOf(shared.mock.calls[0]![0])?.slots).toEqual(slots);
    if (provider === 'cloudflare' && token) expect(f.view.tutorState.conversation.picturePaused).not.toContain('API token');
    if (provider === 'cloudflare' && account) expect(f.view.tutorState.conversation.picturePaused).not.toContain('account ID');
    expect(f.actions.generateSituationPicture).not.toHaveBeenCalled();
    f.view.tutorSpeechConversation = {}; ensureTutorConversationPicture(f.view); await flush();
    expect(show).toHaveBeenCalledTimes(2);
  });

  it('fix 6: storing the missing account resumes pictures and a later credential failure keeps the single popup', async () => {
    const f = fixture(); const { show } = popup(f);
    f.settings.tutorPictureProvider = 'cloudflare';
    Object.assign(f.view.tutorState.conversation, { status: 'active', situationPicture: 'intro' });
    f.view.tutorConversationScene = scene;
    ensureTutorConversationPicture(f.view); await flush();
    expect(f.view.tutorState.conversation.picturePaused).toMatch(/account ID/u);
    f.settings.credentialPresence.cloudflareAccountId = true;
    f.actions.generateSituationPicture.mockRejectedValue(missingCredentialError('cloudflare', 'standard', ['API token']));
    ensureTutorConversationPicture(f.view);
    expect(f.view.tutorState.conversation.picturePaused).toBeUndefined();
    await flush();
    expect(f.actions.generateSituationPicture).toHaveBeenCalledOnce();
    expect(f.view.tutorState.conversation.picturePaused).toMatch(/API token/u);
    expect(f.view.tutorState.conversation.picturePaused).not.toContain('account ID');
    expect(show).toHaveBeenCalledOnce();
    expect(f.view.tutorConversationPictureFailures).toBe(0);
  });
});
