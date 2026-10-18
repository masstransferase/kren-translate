// 2026-10-11: V218 uses the coaching card shape in the existing lifecycle fixture.
// 2026-10-10: V216 renames reader-facing Gemini profiles Free Tier and Paid; exact expectations follow the brief.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';

const boundary = vi.hoisted(() => ({
  mkdtemp: vi.fn(async () => 'unused'), readFile: vi.fn(), rm: vi.fn(async () => undefined),
  writeFile: vi.fn(), appendFile: vi.fn(), mkdir: vi.fn(), spawn: vi.fn(),
  configuration: new Map<string, unknown>()
}));
vi.mock('node:fs/promises', async (original) => ({
  ...await original<typeof import('node:fs/promises')>(),
  mkdtemp: boundary.mkdtemp, readFile: boundary.readFile, rm: boundary.rm,
  writeFile: boundary.writeFile, appendFile: boundary.appendFile, mkdir: boundary.mkdir
}));
vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(), spawn: boundary.spawn
}));
vi.mock('vscode', () => ({
  commands: { executeCommand: vi.fn() }, env: {},
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (key: string, fallback: unknown) => boundary.configuration.get(key) ?? fallback }) },
  window: { showWarningMessage: vi.fn(async () => 'Reset panel') }
}));

import { KrenResultsViewProvider } from '../src/resultsView.js';
import { startGeminiDictation, stopGeminiDictation, cancelGeminiDictation, toggleTutorDictation } from '../src/resultsViewDictation.js';
import { stopTutorConversation, resumeTutorConversation } from '../src/resultsViewTurns.js';
import { disableTutorLive } from '../src/resultsViewLive.js';
import { TutorLiveSessionError } from '../src/tutor/liveSession.js';
import { writeTutorPracticeHint } from '../src/resultsViewHints.js';
import { replaceTutorExerciseSet } from '../src/tutor/state.js';
import { renderKrenResultViewHtml, renderTutorConversation, renderTutorExercises } from '../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { transcribeCloudflareAudio, CloudflareAiError, CLOUDFLARE_PICTURE_ALLOWANCE, CLOUDFLARE_PICTURE_CREDENTIALS } from '../src/providers/cloudflare.js';
import { ensureTutorConversationPicture, cancelTutorConversationPicture } from '../src/resultsViewConversation.js';
import { generateCloudflareSituationPicture } from '../src/providers/situationPicture.js';
import { reconcileTutorPictureProviderChange } from '../src/resultsViewSettings.js';
import { CLOUDFLARE_IMAGE_MODEL_DEFAULT, validatedPanelSetting } from '../src/panelSettings.js';
import { load } from 'cheerio';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function wav() {
  const bytes = Buffer.alloc(48);
  bytes.write('RIFF'); bytes.writeUInt32LE(40, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(4, 40);
  return bytes;
}
function nativeCapture(finalChunk = '', finalAfterExit = false) {
  const children: Array<{ child: EventEmitter; input: PassThrough; script: string }> = [];
  boundary.readFile.mockResolvedValue(wav());
  boundary.spawn.mockImplementation((_command, args) => {
    const input = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdin: input, stdout, stderr, kill: vi.fn() });
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    children.push({ child, input, script });
    input.on('finish', () => {
      if (finalAfterExit) {
        child.emit('exit', 0);
        queueMicrotask(() => { stdout.write(finalChunk + '\n'); child.emit('close', 0); });
      } else {
        if (finalChunk) stdout.write(finalChunk + '\n');
        child.emit('exit', 0); child.emit('close', 0);
      }
    });
    queueMicrotask(() => stdout.write(script.includes('KREN_WAVEIN_READY') ? 'KREN_WAVEIN_READY\nAQIDBA==\n' : 'KREN_RECORDING_READY\n'));
    return child;
  });
  return children;
}
function harness(nativeRecorder = false) {
  boundary.configuration.set('tutor.speechProvider', 'gemini');
  const recording = { filePath: 'unused', cancel: vi.fn(async () => undefined),
    finish: vi.fn(async (consume: (bytes: Uint8Array, format: { sampleRate: number; channels: number; bitsPerSample: number }) => Promise<string>) => consume(wav(), { sampleRate: 16000, channels: 1, bitsPerSample: 16 })) };
  const recorder = { start: vi.fn(async () => recording) };
  const handy = { detect: vi.fn(async (): Promise<string | undefined> => undefined), toggle: vi.fn(async (_executable: string) => undefined) };
  const liveSocketFactory = vi.fn(() => { throw new Error('Unexpected Live connection'); });
  const actions = {
    settings: vi.fn(() => ({ ...PANEL_SETTINGS_FIXTURE, credentialPresence: { geminiDefault: true } })),
    generateTutor: vi.fn(async (_request: unknown, _route: unknown, _signal: AbortSignal): Promise<unknown> => ({ doneWell: [], naturally: [], tryNext: 'Keep practicing.' })),
    transcribeTutorAudio: vi.fn(async (_audio: Uint8Array, _signal: AbortSignal, _provider?: 'gemini' | 'cloudflare') => 'Dictated answer.'),
    runTutorTool: vi.fn(async (_tool: unknown, _input: string, _signal: AbortSignal, _language?: string): Promise<unknown> => ({ text: 'Result' })),
    generateSituationPicture: vi.fn(async () => 'data:image/png;base64,AAAA'),
    log: vi.fn(), notify: vi.fn(), stopReadAloud: vi.fn(), invalidateResultRequests: vi.fn(),
    refreshReadAloudVoices: vi.fn(async () => undefined),
    readSelectedEditorPassage: vi.fn(), writeTutorPreferences: vi.fn()
  };
  const view = new KrenResultsViewProvider(actions as never, {} as never, handy, nativeRecorder ? undefined : recorder as never, liveSocketFactory);
  vi.spyOn(view, 'render').mockImplementation(() => undefined);
  view.tutorState.conversation = { ...view.tutorState.conversation, status: 'active', replies: 'standard', speakerOn: false, currentQuestion: 'Your answer?' };
  view.tutorState.exerciseSet = { exercises: [{ id: 'one', prompt: 'First question.', targetIds: [] }, { id: 'two', prompt: 'Second question.', targetIds: [] }] } as never;
  view.tutorState.speech.handyStatus = 'notFound';
  let receiver!: (message: unknown) => void;
  let dispose!: () => void;
  const postMessage = vi.fn(async (_message: unknown) => true);
  const webview = { html: '', cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }), postMessage,
    onDidReceiveMessage: (callback: typeof receiver) => { receiver = callback; return { dispose: vi.fn() }; } };
  view.resolveWebviewView({ webview, onDidChangeVisibility: () => ({ dispose: vi.fn() }),
    onDidDispose: (callback: () => void) => { dispose = callback; return { dispose: vi.fn() }; } } as never);
  const message = (command: string, fields = {}) => (view as unknown as { handleMessage(message: unknown): Promise<void> }).handleMessage({ command, ...fields });
  return { view, actions, recording, recorder, handy, liveSocketFactory, postMessage, message, receive: (message: unknown) => receiver(message), dispose: () => dispose() };
}
afterEach(() => { boundary.configuration.clear(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('V215 Cloudflare Image Model and diagnostics', () => {
  it('shows exactly the Cloudflare choices in reachable voice/model routing, with Gemini controls restored on return', () => {
    const h = harness();
    const settings = { ...PANEL_SETTINGS_FIXTURE, tutorPictureProvider: 'cloudflare', tutorCloudflareImageModel: '@cf/black-forest-labs/flux-2-klein-4b',
      tutorImageModel: 'gemini-selected-image', tutorImageModels: [{ id: 'gemini-selected-image', displayName: 'Gemini image' }], customTutorImageModels: ['gemini-custom-image'] };
    const render = () => load(renderKrenResultViewHtml({ activeScreen: 'tutor', settings, tutor: h.view.tutorState, cspSource: 'test', nonce: 'test', brandImageUri: 'test', proModels: [] } as never));
    const $ = render();
    const model = $('[data-setting="tutor.cloudflareImageModel"]');
    expect(model.is('select:not([disabled]):not([tabindex="-1"])')).toBe(true);
    expect(model.closest('[data-persist-id="tutor-routing"]').parent().closest('[data-persist-id="tutor-setting"]')).toHaveLength(1);
    expect(model.closest('label').find('.setting-title').text()).toBe('Image Model');
    expect(model.closest('label').find('.setting-description').text()).toMatch(/Cloudflare model.*free daily allowance.*25 seconds/u);
    expect(model.find('option').map((_i, el) => $(el).text()).get()).toEqual(['FLUX.1 schnell', 'FLUX.2 klein 4B']);
    expect(model.find('option[selected]').attr('value')).toBe(settings.tutorCloudflareImageModel);
    expect($('[data-setting="tutor.imageModel"], [data-command="refreshGeminiImageModels"], [data-model-provider="geminiImage"]')).toHaveLength(0);
    // The row is reached through these keyboard-operable disclosure summaries, never lesson or conversation folds.
    expect(model.parents('details').map((_i, el) => $(el).attr('data-persist-id')).get()).toEqual(['tutor-routing', 'tutor-setting']);
    expect($('[data-persist-id="tutor-setting"] > summary').text()).toMatch(/VOICE.*MODEL/u);
    expect($('[data-persist-id="tutor-routing"] > summary').text()).toMatch(/LLM ROUTING/u);
    expect($('button[data-tutor-jump-configuration]')).toHaveLength(1);
    settings.tutorPictureProvider = 'gemini';
    const gemini = render();
    expect(gemini('[data-setting="tutor.cloudflareImageModel"]')).toHaveLength(0);
    expect(gemini('[data-model-preset="tutor.imageModel"] option[selected]').attr('value')).toBe('gemini-selected-image');
    expect(gemini('[data-command="refreshGeminiImageModels"]')).toHaveLength(1);
  });

  it('stores model and provider changes and patches the mounted row while preserving the answer and open disclosures', async () => {
    const h = harness(); await flush();
    const settings = { ...PANEL_SETTINGS_FIXTURE, tutorPictureProvider: 'gemini', tutorImageModel: 'gemini-selected-image', tutorCloudflareImageModel: CLOUDFLARE_IMAGE_MODEL_DEFAULT };
    h.actions.settings.mockReturnValue(settings as never);
    const updateSetting = vi.fn(async (key: string, value: string) => {
      if (key === 'tutor.pictureProvider') settings.tutorPictureProvider = value;
      if (key === 'tutor.cloudflareImageModel') settings.tutorCloudflareImageModel = value;
    });
    Object.assign(h.actions, { updateSetting });
    Object.assign(h.view, { activeScreen: 'tutor' });
    h.view.tutorState.conversation.draftAnswer = 'Keep my draft';
    const originalDocument = h.view.view!.webview.html;
    vi.mocked(h.view.render).mockRestore();
    h.view.render(false, true);
    const initialPatch = h.postMessage.mock.calls.map(([message]) => message as { command: string; html?: string }).find(message => message.command === 'tutorVoiceModelReady')!;
    h.postMessage.mockClear();
    await h.message('updateSetting', { key: 'tutor.pictureProvider', value: 'cloudflare' });
    await h.message('updateSetting', { key: 'tutor.cloudflareImageModel', value: '@cf/black-forest-labs/flux-2-klein-4b' });
    expect(updateSetting).toHaveBeenLastCalledWith('tutor.cloudflareImageModel', '@cf/black-forest-labs/flux-2-klein-4b');
    const patches = h.postMessage.mock.calls.map(([message]) => message as { command: string; html?: string }).filter(message => message.command === 'tutorVoiceModelReady');
    expect(patches).toHaveLength(2);
    expect(h.view.view!.webview.html === originalDocument).toBe(true);
    expect(h.view.tutorState.conversation.draftAnswer).toBe('Keep my draft');
    const mounted = load(initialPatch.html!);
    // Changed 2026-10-18: V263, owner item I43, preserve the actual microphone through settings patches.
    const answer = mounted('[data-tutor-chat-mic-control]')[0];
    expect(answer).toBeDefined();
    mounted('[data-persist-id="tutor-routing"]').attr('open', '');
    const current = {
      get innerHTML() { return mounted('[data-persist-id="tutor-setting"]').html(); },
      set innerHTML(html: string | null) { mounted('[data-persist-id="tutor-setting"]').html(html!); },
      querySelectorAll: () => mounted('[data-persist-id="tutor-setting"] details[data-persist-id]').toArray().map(el => ({
        get open() { return mounted(el).attr('open') !== undefined; },
        set open(value: boolean) { if (value) mounted(el).attr('open', ''); else mounted(el).removeAttr('open'); },
        getAttribute: (key: string) => mounted(el).attr(key)
      }))
    };
    const script = mounted('script').text();
    const patch = script.slice(script.indexOf('function patchTutorVoiceModel(message)'), script.indexOf('function patchTutorConversationSpeechDetection'));
    class Parser { parseFromString(html: string) { return { querySelector: () => ({ innerHTML: load(html)('[data-persist-id="tutor-setting"]').html() }) }; } }
    const applyPatch = (message: { html?: string }) => runInNewContext(patch + '\npatchTutorVoiceModel(message);', {
      document: { querySelector: () => current }, DOMParser: Parser, message, applyConditionalSettings: vi.fn()
    });
    applyPatch(patches[0]!);
    // 2026-10-10: V216 names survive the mounted voice/model patch, including the profile selector.
    expect(mounted('[data-setting="tutor.pictureProvider"] option').map((_i, el) => mounted(el).text()).get()).toEqual(['Gemini Paid profile', 'Cloudflare free models']);
    expect(mounted('[data-setting="tutor.geminiProfile"] option').map((_i, el) => mounted(el).text()).get()).toEqual(['Free Tier', 'Paid']);
    expect(mounted('[data-model-preset="tutor.imageModel"]')).toHaveLength(0);
    expect(mounted('[data-setting="tutor.cloudflareImageModel"] option')).toHaveLength(2);
    applyPatch(patches[1]!);
    expect(mounted('[data-setting="tutor.cloudflareImageModel"] option[selected]').attr('value')).toBe('@cf/black-forest-labs/flux-2-klein-4b');
    expect(mounted('[data-setting="tutor.imageModel"]')).toHaveLength(0);
    expect(mounted('[data-persist-id="tutor-routing"]').attr('open')).toBeDefined();
    expect(mounted('[data-tutor-chat-mic-control]')[0]).toBe(answer);
    // Changed 2026-10-18: V263, owner item I43, voice/model patches cannot restore a conversation text box.
    expect(mounted('[data-tutor-conversation-answer]')).toHaveLength(0);
    await h.message('updateSetting', { key: 'tutor.pictureProvider', value: 'gemini' });
    const last = h.postMessage.mock.calls.map(([message]) => message as { command: string; html?: string }).filter(message => message.command === 'tutorVoiceModelReady').at(-1)!;
    expect(load(last.html!)('input[data-setting="tutor.imageModel"]').attr('value')).toBe('gemini-selected-image');
    applyPatch(last);
    expect(mounted('[data-setting="tutor.cloudflareImageModel"]')).toHaveLength(0);
    expect(mounted('[data-tutor-chat-mic-control]')[0]).toBe(answer);
    expect(settings.tutorImageModel).toBe('gemini-selected-image');
  });

  it.each([30_000, 90_000])('uses the longer of 60 seconds and configured %i for Cloudflare pictures', async timeout => {
    vi.useFakeTimers(); const h = harness(); await flush();
    h.view.tutorConversationScene = 'Cafe.'; h.view.tutorState.conversation.situationPicture = 'intro';
    h.actions.settings.mockReturnValue({ ...PANEL_SETTINGS_FIXTURE, requestTimeoutMs: timeout, tutorPictureProvider: 'cloudflare', credentialPresence: { cloudflareAccountId: true, cloudflareApiToken: true } } as never);
    h.actions.generateSituationPicture.mockReturnValue(new Promise(() => {}));
    ensureTutorConversationPicture(h.view);
    const signal = h.view.tutorConversationPictureController!.signal;
    await vi.advanceTimersByTimeAsync(Math.max(60_000, timeout) - 1);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    cancelTutorConversationPicture(h.view);
  });

  it.each(['picture', 'dictation'] as const)('V215 %s failure log includes HTTP and numeric codes without remote text or credentials', async purpose => {
    const h = harness(); await flush();
    h.actions.settings.mockReturnValue({ ...PANEL_SETTINGS_FIXTURE, tutorPictureProvider: 'cloudflare', credentialPresence: { cloudflareAccountId: true, cloudflareApiToken: true } } as never);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false,
      errors: [{ code: 1001, message: 'REMOTE-TEXT-MUST-NOT-APPEAR' }, { code: '1002' }, { code: 1003 }] }), { status: 400 })));
    if (purpose === 'picture') {
      h.view.tutorConversationScene = 'Cafe.'; h.view.tutorState.conversation.situationPicture = 'intro';
      h.actions.generateSituationPicture.mockImplementation((...args: unknown[]) => generateCloudflareSituationPicture(String(args[0]), 'private-account', 'private-credential', args[1] as AbortSignal));
      ensureTutorConversationPicture(h.view); await flush();
    } else {
      boundary.configuration.set('tutor.speechProvider', 'cloudflare');
      h.actions.transcribeTutorAudio.mockImplementation((audio, signal) => transcribeCloudflareAudio('private-account', 'private-credential', audio, signal));
      await startGeminiDictation(h.view, { conversation: true }, 'cloudflare');
      await stopGeminiDictation(h.view, { conversation: true });
    }
    const log = h.actions.log.mock.calls.map(([line]) => line).find(line => /failed/u.test(line));
    expect(log).toContain('Cloudflare HTTP 400, codes 1001, 1003.');
    expect(log).toContain(purpose === 'picture' ? '[conversation situation picture failed]' : '[Cloudflare transcription failed]');
    expect(log).not.toMatch(/REMOTE-TEXT-MUST-NOT-APPEAR|private-account|private-credential|Bearer/u);
    expect(JSON.stringify(h.postMessage.mock.calls)).not.toContain('REMOTE-TEXT-MUST-NOT-APPEAR');
  });

  it('V215 host validates the saved Cloudflare model and passes it with SecretStorage credentials', async () => {
    const source = readFileSync('src/extension.ts', 'utf8');
    const expression = source.slice(source.indexOf('tutorCloudflareImageModel:') + 'tutorCloudflareImageModel:'.length, source.indexOf('    tutorImageModel:'))
      .trim().replace(/,\s*$/u, '').replace(' as string | undefined', '').replace('config.get<string>', 'config.get');
    const readModel = (value: string) => runInNewContext(expression, { config: { get: () => value }, validatedPanelSetting, CLOUDFLARE_IMAGE_MODEL_DEFAULT });
    expect(readModel('@cf/black-forest-labs/flux-2-klein-4b')).toBe('@cf/black-forest-labs/flux-2-klein-4b');
    expect(readModel('other')).toBe(CLOUDFLARE_IMAGE_MODEL_DEFAULT);
    const action = source.slice(source.indexOf('generateSituationPicture: async') + 'generateSituationPicture: '.length, source.indexOf('    transcribeTutorAudio:')).trim().replace(/,$/u, '');
    const generate = vi.fn(async () => 'picture');
    const getSecret = vi.fn(async (key: string) => key);
    const signal = new AbortController().signal;
    const callback = runInNewContext('(' + action + ')', { extensionRuntime: () => ({ getSecret }), context: {},
      // 2026-10-11: V218 passes the configured style along with the existing model and credentials.
      readPanelSettings: () => ({ tutorPictureProvider: 'cloudflare', tutorConversationPictureStyle: 'realistic', tutorCloudflareImageModel: readModel('@cf/black-forest-labs/flux-2-klein-4b') }),
      KREN_SECRET_KEYS: { cloudflareAccountId: 'account-slot', cloudflareApiToken: 'token-slot' }, generateCloudflareSituationPicture: generate });
    await callback('Cafe.', signal);
    expect(getSecret.mock.calls).toEqual([['account-slot'], ['token-slot']]);
    expect(generate).toHaveBeenCalledWith('Cafe.', 'account-slot', 'token-slot', signal, undefined, '@cf/black-forest-labs/flux-2-klein-4b', 'realistic');
  });
});

describe('V214 review regressions', () => {
  it.each(['practice', 'standard'] as const)('finding 1: %s Stop survives configuration refresh and credential changes', async targetKind => {
    const h = harness(); await h.message('showTutor'); await flush();
    boundary.configuration.set('tutor.speechProvider', 'cloudflare');
    h.actions.settings.mockReturnValue({ ...PANEL_SETTINGS_FIXTURE, credentialPresence: { cloudflareAccountId: true, cloudflareApiToken: true } } as never);
    h.view.tutorState.currentExerciseIndex = 1;
    // Changed 2026-10-18: V263, owner item I43, automatic submission needs a valid conversation response.
    if (targetKind === 'standard') h.actions.generateTutor.mockResolvedValueOnce({ move: 'reaction', reply: 'Thanks for explaining.',
      replyQuote: '', correction: 'Cloudflare answer.', explanation: 'This is already natural.', targetId: '',
      rephrase: 'Cloudflare answer.', rephraseWhy: 'This is already natural.', spokenPunctuated: 'Cloudflare answer.' });
    const target = targetKind === 'practice' ? { exerciseId: 'two' } : { conversation: true as const };
    await toggleTutorDictation(h.view, target);
    vi.mocked(h.view.render).mockRestore();
    const selector = targetKind === 'practice' ? '[data-command="dictateTutorExercise"][data-tutor-exercise="two"]' : '[data-command="dictateTutorConversation"]';
    for (const provider of ['off', 'gemini']) {
      boundary.configuration.set('tutor.speechProvider', provider);
      // Exercise the function called by extension.ts's configuration and secret-change handlers.
      h.view.refresh(); await flush();
      const $ = load(h.view.view!.webview.html); const button = $(selector);
      expect(button.length).toBe(1);
      expect(button.is('[disabled]')).toBe(false);
      expect(button.attr('aria-label')).toMatch(/Stop.*Cloudflare/u);
      expect(button.closest('details').length).toBe(0);
      expect(button.attr('tabindex')).not.toBe('-1');
      expect(h.recording.cancel).not.toHaveBeenCalled();
    }
    await toggleTutorDictation(h.view, target);
    h.view.refresh(); await flush();
    expect(load(h.view.view!.webview.html)(selector).is('[disabled]')).toBe(true);
    expect(h.actions.transcribeTutorAudio).toHaveBeenCalledWith(expect.any(Uint8Array), expect.any(AbortSignal), 'cloudflare');
  });

  it.each(['fetch', 'body'] as const)('finding 2: Cloudflare timeout aborts stalled %s and counts failures', async phase => {
    vi.useFakeTimers(); const h = harness(); await flush();
    h.view.tutorConversationScene = 'Cafe.'; h.view.tutorState.conversation.situationPicture = 'intro';
    h.actions.settings.mockReturnValue({ ...PANEL_SETTINGS_FIXTURE, requestTimeoutMs: 1234, tutorPictureProvider: 'cloudflare', credentialPresence: { cloudflareAccountId: true, cloudflareApiToken: true } } as never);
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init: RequestInit) => {
      const signal = init.signal!; signals.push(signal);
      const stalled = () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('remote text must stay local')), { once: true }));
      return phase === 'fetch' ? stalled() : Promise.resolve({ ok: true, status: 200, json: stalled });
    }));
    h.actions.generateSituationPicture.mockImplementation((...args: unknown[]) => generateCloudflareSituationPicture(String(args[0]), 'account', 'credential', args[1] as AbortSignal));
    ensureTutorConversationPicture(h.view); await flush();
    // 2026-10-10: Cloudflare pictures now wait at least 60 seconds.
    await vi.advanceTimersByTimeAsync(59_999); expect(signals[0]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(signals[0]!.aborted).toBe(true);
    expect(h.view.tutorConversationPictureFailures).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.view.tutorConversationPictureFailures).toBe(2);
    expect(h.view.tutorState.conversation.picturePaused).toMatch(/Cloudflare.*timed out/u);
    expect(h.view.tutorConversationPictureController).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(JSON.stringify(h.postMessage.mock.calls)).not.toContain('remote text must stay local');
  });

  it('finding 2: intentional picture cancellation is silent and clears the deadline; Gemini has no deadline', async () => {
    vi.useFakeTimers(); const h = harness(); await flush();
    h.view.tutorConversationScene = 'Cafe.'; h.view.tutorState.conversation.situationPicture = 'intro';
    h.actions.settings.mockReturnValue({ ...PANEL_SETTINGS_FIXTURE, requestTimeoutMs: 1234, tutorPictureProvider: 'cloudflare', credentialPresence: { cloudflareAccountId: true, cloudflareApiToken: true, geminiDefault: true } } as never);
    const result = deferred<string>(); h.actions.generateSituationPicture.mockReturnValue(result.promise);
    ensureTutorConversationPicture(h.view);
    expect(vi.getTimerCount()).toBe(1);
    cancelTutorConversationPicture(h.view);
    expect(vi.getTimerCount()).toBe(0);
    result.resolve('data:image/png;base64,AAAA'); await flush();
    expect(h.view.tutorConversationPictureFailures).toBe(0);
    expect(h.view.tutorState.conversation.picturePaused).toBeUndefined();
    h.actions.settings.mockReturnValue({ ...h.actions.settings(), tutorPictureProvider: 'gemini' } as never);
    h.actions.generateSituationPicture.mockReturnValue(new Promise(() => {}));
    ensureTutorConversationPicture(h.view);
    expect(vi.getTimerCount()).toBe(0);
    cancelTutorConversationPicture(h.view);
  });

  it('finding 2: successful Cloudflare picture body completion clears the deadline', async () => {
    vi.useFakeTimers(); const h = harness(); await flush();
    h.view.tutorConversationScene = 'Cafe.'; h.view.tutorState.conversation.situationPicture = 'intro';
    h.actions.settings.mockReturnValue({ ...PANEL_SETTINGS_FIXTURE, requestTimeoutMs: 1234, tutorPictureProvider: 'cloudflare', credentialPresence: { cloudflareAccountId: true, cloudflareApiToken: true } } as never);
    const body = deferred<unknown>();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: () => body.promise })));
    h.actions.generateSituationPicture.mockImplementation((...args: unknown[]) => generateCloudflareSituationPicture(String(args[0]), 'account', 'credential', args[1] as AbortSignal));
    ensureTutorConversationPicture(h.view); await flush();
    expect(vi.getTimerCount()).toBe(1);
    body.resolve({ result: { image: 'AQID' } }); await flush();
    expect(h.view.tutorConversationPicturePending).toBeDefined();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1234);
    expect(h.view.tutorConversationPictureFailures).toBe(0);
  });

  it('finding 3: VS Code configuration handler clears the old picture provider pause once', async () => {
    const h = harness();
    const settings = { ...PANEL_SETTINGS_FIXTURE, tutorPictureProvider: 'gemini' as 'gemini' | 'cloudflare', credentialPresence: { cloudflareAccountId: true, cloudflareApiToken: true } };
    h.actions.settings.mockReturnValue(settings as never);
    let handler!: (event: { affectsConfiguration: (key: string) => boolean }) => void;
    const source = readFileSync('src/extension.ts', 'utf8');
    const start = source.indexOf('vscode.workspace.onDidChangeConfiguration((event) => {');
    const registration = source.slice(start, source.indexOf('\n    }),', start) + '\n    })'.length);
    runInNewContext('let previousPictureProvider = "gemini";\n' + registration, {
      vscode: { workspace: { onDidChangeConfiguration: (callback: typeof handler) => { handler = callback; } } },
      resultsView: h.view, readPanelSettings: () => settings, reconcileTutorPictureProviderChange
    });
    h.view.tutorConversationPictureFailures = 2; h.view.tutorConversationPictureStopped = true;
    h.view.tutorState.conversation.picturePaused = 'Previous provider pause';
    const old = new AbortController(); h.view.tutorConversationPictureController = old;
    settings.tutorPictureProvider = 'cloudflare';
    const event = { affectsConfiguration: (key: string) => key === 'kren' || key === 'kren.tutor.pictureProvider' };
    handler(event); await flush();
    expect(old.signal.aborted).toBe(true);
    expect(h.view.tutorState.conversation.picturePaused).toBeUndefined();
    expect(h.view.tutorConversationPictureFailures).toBe(0);
    expect(h.view.tutorConversationPictureStopped).toBe(false);
    const current = new AbortController(); h.view.tutorConversationPictureController = current;
    handler(event); await flush();
    // The panel save and the configuration event may both reconcile the same change.
    reconcileTutorPictureProviderChange(h.view, 'gemini');
    expect(current.signal.aborted).toBe(false);
  });

  it('finding 3: changing provider clears failure pause and pending work, retaining turns and picture limit', async () => {
    const h = harness();
    // 2026-10-10: V216 pictures use the Paid credential even when text uses Free Tier.
    const settings = { ...PANEL_SETTINGS_FIXTURE, tutorPictureProvider: 'gemini' as 'gemini' | 'cloudflare', credentialPresence: { geminiDefault: true, geminiAlternate: true, cloudflareAccountId: true, cloudflareApiToken: true } };
    h.actions.settings.mockReturnValue(settings as never);
    Object.assign(h.actions, { updateSetting: vi.fn(async (_key: string, value: 'gemini' | 'cloudflare') => { settings.tutorPictureProvider = value; }) });
    h.view.tutorConversationScene = 'Cafe.'; h.view.tutorState.conversation.situationPicture = 'switching';
    const conversation = h.view.tutorState.conversation;
    h.actions.generateSituationPicture.mockRejectedValue(new Error('Gemini 429'));
    ensureTutorConversationPicture(h.view); await flush();
    expect(h.view.tutorConversationPictureStopped).toBe(true);
    h.view.tutorConversationPictureCount = 9;
    const old = new AbortController(); h.view.tutorConversationPictureController = old;
    h.view.tutorConversationPicturePending = { requestId: 42, image: 'data:image/png;base64,AAAA' };
    h.actions.generateSituationPicture.mockResolvedValue('data:image/png;base64,AQID');
    await h.message('updateSetting', { key: 'tutor.pictureProvider', value: 'cloudflare' }); await flush();
    expect(old.signal.aborted).toBe(true);
    expect(h.view.tutorConversationPictureFailures).toBe(0);
    expect(h.view.tutorConversationPictureStopped).toBe(false);
    expect(h.view.tutorState.conversation.picturePaused).toBeUndefined();
    expect(h.view.tutorState.conversation).toBe(conversation);
    expect(h.view.tutorConversationPictureCount).toBe(9);
    expect(h.actions.generateSituationPicture).toHaveBeenCalledTimes(3);
    expect(h.postMessage).toHaveBeenCalledWith({ command: 'tutorConversationPictureCancelled', requestId: 42 });
    const pending = h.view.tutorConversationPicturePending;
    await h.message('updateSetting', { key: 'tutor.pictureProvider', value: 'cloudflare' });
    expect(h.view.tutorConversationPicturePending).toBe(pending);
    await h.message('tutorConversationPictureDecoded', { requestId: pending!.requestId, input: pending!.image });
    expect(h.view.tutorConversationPictureCount).toBe(10);
    await h.message('updateSetting', { key: 'tutor.pictureProvider', value: 'gemini' }); await flush();
    expect(h.actions.generateSituationPicture).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403])('finding 5: picture HTTP %i preserves fixed authentication instructions in its pause notice', async status => {
    const h = harness(); h.view.tutorConversationScene = 'Cafe.'; h.view.tutorState.conversation.situationPicture = 'intro';
    h.actions.settings.mockReturnValue({ ...PANEL_SETTINGS_FIXTURE, tutorPictureProvider: 'cloudflare', credentialPresence: { cloudflareAccountId: true, cloudflareApiToken: true } } as never);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: 'remote text must stay local' }] }), { status })));
    h.actions.generateSituationPicture.mockImplementation((...args: unknown[]) => generateCloudflareSituationPicture(String(args[0]), 'account', 'credential', args[1] as AbortSignal));
    ensureTutorConversationPicture(h.view); await flush(); await flush();
    const text = h.view.tutorState.conversation.picturePaused;
    // 2026-10-10: V217 redirects credential repair; assert the reason and the actionable route.
    expect(text).toMatch(/authentication failed.*Check.*Cloudflare credentials.*KREN menu, Credentials/u);
    expect(h.postMessage).toHaveBeenCalledWith({ command: 'tutorPicturePaused', text });
    expect(JSON.stringify([h.postMessage.mock.calls, h.actions.log.mock.calls])).not.toContain('remote text must stay local');
  });
});

describe('V213 Cloudflare panel and in-memory dictation', () => {
  it.each(['practice', 'standard'] as const)('%s sends exactly one Cloudflare WAV request at stop and patches in place', async targetKind => {
    nativeCapture(); const h = harness(true);
    boundary.configuration.set('tutor.speechProvider', 'auto');
    h.view.tutorState.conversation.send = 'stopSpeaking'; // Changed 2026-10-18: V263, owner item I43, every runtime turn sends on speech stop.
    h.actions.settings.mockReturnValue({ ...PANEL_SETTINGS_FIXTURE, credentialPresence: { geminiDefault: true, cloudflareAccountId: true, cloudflareApiToken: true } } as never);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ result: { text: 'Cloudflare answer.' } })));
    vi.stubGlobal('fetch', fetcher);
    h.actions.transcribeTutorAudio.mockImplementation((audio, signal, provider) => {
      expect(provider).toBe('cloudflare');
      return transcribeCloudflareAudio('account', 'credential', audio, signal);
    });
    // Changed 2026-10-18: V263, owner item I43, automatic submission needs a valid conversation response.
    if (targetKind === 'standard') h.actions.generateTutor.mockResolvedValueOnce({ move: 'reaction', reply: 'Thanks for explaining.',
      replyQuote: '', correction: 'Cloudflare answer.', explanation: 'This is already natural.', targetId: '',
      rephrase: 'Cloudflare answer.', rephraseWhy: 'This is already natural.', spokenPunctuated: 'Cloudflare answer.' });
    const target = targetKind === 'practice' ? { exerciseId: 'two' } : { conversation: true as const };
    await flush();
    h.view.tutorState.speech.handyStatus = 'notFound';
    const beforeRender = vi.mocked(h.view.render).mock.calls.length;
    await toggleTutorDictation(h.view, target);
    expect(fetcher).not.toHaveBeenCalled();
    expect(h.view.tutorState.speech.dictationProvider).toBe('cloudflare');
    expect(h.postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorDictationState', provider: 'cloudflare', state: 'recording' }));
    // 2026-10-10: retain the recording route even when the setting changes before Stop.
    boundary.configuration.set('tutor.speechProvider', 'gemini');
    await toggleTutorDictation(h.view, target);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(h.actions.transcribeTutorAudio).toHaveBeenCalledOnce();
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ audio: Buffer.concat([wav().subarray(0, 44), Buffer.from([1, 2, 3, 4])]).toString('base64') });
    for (const write of [boundary.mkdtemp, boundary.writeFile, boundary.appendFile, boundary.mkdir, boundary.rm]) expect(write).not.toHaveBeenCalled();
    // Changed 2026-10-18: V263, owner item I43, a conversation now renders its submitted turn immediately.
    await flush();
    if (targetKind === 'practice') expect(vi.mocked(h.view.render).mock.calls.length).toBe(beforeRender);
    else expect(vi.mocked(h.view.render).mock.calls.length).toBeGreaterThan(beforeRender);
    // Changed 2026-10-18: V263, owner item I43, practice keeps its answer while a conversation sends directly.
    expect(targetKind === 'practice' ? h.view.tutorState.answers.two : h.view.tutorState.conversation.transcript.at(-1)?.learnerAnswer).toBe('Cloudflare answer.');
    expect(h.postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorDictationState', provider: 'cloudflare', state: 'idle', ...(targetKind === 'practice' ? { transcript: 'Cloudflare answer.' } : {}) }));
  });
  it('renders Cloudflare credential icon rows and the picture provider control, and stores its change in place', async () => {
    const h = harness();
    const settings = { ...PANEL_SETTINGS_FIXTURE, tutorPictureProvider: 'cloudflare' as const, credentialPresence: { cloudflareAccountId: true, cloudflareApiToken: true } };
    h.actions.settings.mockReturnValue(settings as never);
    const html = (activeScreen: 'settings' | 'tutor') => renderKrenResultViewHtml({ activeScreen, settings, tutor: h.view.tutorState, tutorSpeechProvider: 'cloudflare', cspSource: 'test', nonce: 'test', brandImageUri: 'test', proModels: [] } as never);
    const $ = load(html('settings'));
    for (const name of ['CloudflareAccountId', 'CloudflareApiToken']) {
      expect($(`[data-action="kren.set${name}"]`).closest('.credential-row').text()).toMatch(/Cloudflare/u);
      expect($(`[data-action="kren.delete${name}"]`).is('[disabled]')).toBe(false);
      expect($(`[data-action="kren.set${name}"]`).find('svg').length).toBeGreaterThan(0);
    }
    const tutor = load(html('tutor'));
    const provider = tutor('[data-setting="tutor.pictureProvider"]');
    // 2026-10-10: V216 names the two picture choices free models and Paid profile exactly.
    expect(provider.find('option[value="cloudflare"]').text()).toBe('Cloudflare free models');
    expect(provider.find('option[value="gemini"]').text()).toBe('Gemini Paid profile');
    expect(tutor('[data-command="dictateTutorConversation"]').is('[disabled]')).toBe(false);
    const updateSetting = vi.fn(async () => undefined);
    Object.assign(h.actions, { updateSetting });
    await h.message('updateSetting', { key: 'tutor.pictureProvider', value: 'cloudflare' });
    expect(updateSetting).toHaveBeenCalledWith('tutor.pictureProvider', 'cloudflare');
    expect(h.view.render).toHaveBeenLastCalledWith(false, true);
  });
  it('pictures require both Cloudflare credentials, recover on setup, and pause safely after two allowance failures', async () => {
    const h = harness(); h.view.tutorConversationScene = 'Cafe.';
    h.view.tutorState.conversation.situationPicture = 'intro';
    h.actions.settings.mockReturnValue({ ...PANEL_SETTINGS_FIXTURE, tutorPictureProvider: 'cloudflare', credentialPresence: { geminiDefault: true, cloudflareAccountId: true } } as never);
    ensureTutorConversationPicture(h.view);
    expect(h.actions.generateSituationPicture).not.toHaveBeenCalled();
    expect(h.view.tutorState.conversation.picturePaused).toBe(CLOUDFLARE_PICTURE_CREDENTIALS);
    h.actions.settings.mockReturnValue({ ...h.actions.settings(), credentialPresence: { cloudflareAccountId: true, cloudflareApiToken: true } } as never);
    h.actions.generateSituationPicture.mockRejectedValue(new CloudflareAiError(CLOUDFLARE_PICTURE_ALLOWANCE, true));
    ensureTutorConversationPicture(h.view);
    await vi.waitFor(() => expect(h.view.tutorConversationPictureStopped).toBe(true));
    expect(h.actions.generateSituationPicture).toHaveBeenCalledTimes(2);
    expect(h.view.tutorState.conversation.picturePaused).toBe(CLOUDFLARE_PICTURE_ALLOWANCE);
    expect(h.view.tutorState.conversation.status).toBe('active');
    expect(h.postMessage).toHaveBeenCalledWith({ command: 'tutorPicturePaused', text: CLOUDFLARE_PICTURE_ALLOWANCE });
  });
  it('changing picture provider reconciles a missing-key pause while preserving the active conversation', async () => {
    const h = harness();
    const settings = { ...PANEL_SETTINGS_FIXTURE, tutorPictureProvider: 'gemini' as 'gemini' | 'cloudflare', credentialPresence: { cloudflareAccountId: true, cloudflareApiToken: true } };
    h.actions.settings.mockReturnValue(settings as never);
    Object.assign(h.actions, { updateSetting: vi.fn(async (_key: string, value: 'gemini' | 'cloudflare') => { settings.tutorPictureProvider = value; }) });
    h.view.tutorConversationScene = 'Cafe.';
    h.view.tutorState.conversation.situationPicture = 'intro';
    h.view.tutorState.conversation.draftAnswer = 'Keep my answer';
    const htmlBefore = h.view.view!.webview.html;
    ensureTutorConversationPicture(h.view);
    expect(h.view.tutorState.conversation.picturePaused).toMatch(/no Gemini Paid key/u);
    await h.message('updateSetting', { key: 'tutor.pictureProvider', value: 'cloudflare' });
    await flush();
    expect(h.actions.generateSituationPicture).toHaveBeenCalledOnce();
    expect(h.view.tutorState.conversation.picturePaused).toBeUndefined();
    expect(h.view.tutorState.conversation.draftAnswer).toBe('Keep my answer');
    expect(h.view.view!.webview.html).toBe(htmlBefore);
    expect(h.view.render).toHaveBeenLastCalledWith(false, true);
    expect(h.postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorConversationPictureReady', requestId: expect.any(Number) }));
    expect(h.view.tutorConversationPictureCount).toBe(0);
  });
});

describe('V209 R5b functional findings', () => {
  it.each(['practice', 'standard'] as const)('1: %s dictation writes no file and sends exactly one WAV at stop', async (targetKind) => {
    const children = nativeCapture();
    const h = harness(true);
    // Changed 2026-10-18: V263, owner item I43, automatic submission needs a valid conversation response.
    if (targetKind === 'standard') h.actions.generateTutor.mockResolvedValueOnce({ move: 'reaction', reply: 'Thanks for explaining.',
      replyQuote: '', correction: 'Cloudflare answer.', explanation: 'This is already natural.', targetId: '',
      rephrase: 'Cloudflare answer.', rephraseWhy: 'This is already natural.', spokenPunctuated: 'Cloudflare answer.' });
    const target = targetKind === 'practice' ? { exerciseId: 'two' } : { conversation: true as const };
    await startGeminiDictation(h.view, target);
    expect(h.actions.transcribeTutorAudio).toHaveBeenCalledTimes(0);
    await stopGeminiDictation(h.view, target);
    for (const write of [boundary.mkdtemp, boundary.writeFile, boundary.appendFile, boundary.mkdir, boundary.rm]) expect(write).not.toHaveBeenCalled();
    expect(h.actions.transcribeTutorAudio).toHaveBeenCalledTimes(1);
    expect(Buffer.from(h.actions.transcribeTutorAudio.mock.calls[0]![0])).toEqual(Buffer.concat([wav().subarray(0, 44), Buffer.from([1, 2, 3, 4])]));
    expect(children[0]!.input.writableEnded).toBe(true);
    expect(children[0]!.script).not.toMatch(/System\.IO|Out-File|Set-Content|save krenrecorder|dictation\.wav/iu);
  });

  it.each(['practice', 'standard'] as const)('1: %s capture releases on Cancel, Reset and either disposal', async (targetKind) => {
    for (const action of ['cancel', 'reset', 'dispose', 'viewDispose'] as const) {
      const children = nativeCapture(); const h = harness(true);
      await startGeminiDictation(h.view, targetKind === 'practice' ? { exerciseId: 'two' } : { conversation: true });
      if (action === 'cancel') cancelGeminiDictation(h.view);
      else if (action === 'reset') await h.message('resetTutorSession');
      else if (action === 'dispose') h.view.dispose();
      else h.dispose();
      await flush();
      expect(children[0]!.input.writableEnded, action).toBe(true);
      expect(h.view.geminiRecording, action).toBeUndefined();
      expect(h.actions.transcribeTutorAudio, action).toHaveBeenCalledTimes(0);
      expect(h.actions.generateTutor, action).toHaveBeenCalledTimes(0);
    }
  });

  it('1: the one WAV includes final PCM delivered while the microphone closes', async () => {
    // 2026-10-05: Node may emit exit before the helper's final stdout bytes are drained.
    nativeCapture('BQYHCA==', true); const h = harness(true);
    await startGeminiDictation(h.view, { exerciseId: 'two' });
    await stopGeminiDictation(h.view, { exerciseId: 'two' });
    expect(h.actions.transcribeTutorAudio).toHaveBeenCalledTimes(1);
    const bytes = Buffer.from(h.actions.transcribeTutorAudio.mock.calls[0]![0]);
    expect(bytes.readUInt32LE(4)).toBe(44); expect(bytes.readUInt32LE(40)).toBe(8);
    expect(bytes.subarray(44)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  });

  it('2: leaving Tutor releases practice capture and Live session, preserving work', async () => {
    const h = harness(); await h.message('showTutor');
    h.view.tutorState.answers.two = 'Existing answer';
    h.view.tutorState.conversation.draftAnswer = 'Unsent draft';
    const conversation = h.view.tutorState.conversation;
    await startGeminiDictation(h.view, { exerciseId: 'two' });
    const close = vi.fn(); const stop = vi.fn();
    h.view.tutorLiveSession = { close } as never;
    h.view.tutorLiveMicrophone = { stop };
    await h.message('showStartPage');
    expect(h.recording.cancel).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
    expect(h.actions.stopReadAloud).toHaveBeenCalled();
    expect(h.view.tutorState.answers.two).toBe('Existing answer');
    expect(h.view.tutorState.conversation.draftAnswer).toBe('Unsent draft');
    expect(h.view.tutorState.conversation.transcript).toEqual(conversation.transcript);
    await h.message('showTutor');
    await startGeminiDictation(h.view, { conversation: true });
    expect(h.recorder.start).toHaveBeenCalledTimes(2);
    cancelGeminiDictation(h.view);
    expect(h.actions.transcribeTutorAudio).toHaveBeenCalledTimes(0);
    expect(h.actions.generateTutor).toHaveBeenCalledTimes(0);
    expect(h.liveSocketFactory).toHaveBeenCalledTimes(0);
  });

  it.each(['showStartPage', 'showSettings', 'showManual'])('2: %s cancels Standard capture, pending speech and a late recorder start', async (command) => {
    const h = harness(); await h.message('showTutor');
    await startGeminiDictation(h.view, { conversation: true });
    h.view.tutorConversationScene = 'Cafe';
    h.view.tutorState.conversation.situationPicture = 'intro';
    const pendingReply = new AbortController(); h.view.tutorConversationController = pendingReply;
    const speech = new AbortController(); h.view.tutorTakeHomeSpeechController = speech;
    await h.message(command); await flush();
    expect(h.recording.cancel).toHaveBeenCalledTimes(1);
    expect(pendingReply.signal.aborted).toBe(true); expect(speech.signal.aborted).toBe(true);
    expect(h.actions.generateSituationPicture).toHaveBeenCalledTimes(0);
    expect(h.actions.generateTutor).toHaveBeenCalledTimes(0);
    expect(h.actions.transcribeTutorAudio).toHaveBeenCalledTimes(0);
    expect(h.liveSocketFactory).toHaveBeenCalledTimes(0);
    await h.message('showTutor');
    const late = deferred<typeof h.recording>(); h.recorder.start.mockReturnValueOnce(late.promise);
    const starting = startGeminiDictation(h.view, { exerciseId: 'two' });
    await h.message(command); late.resolve(h.recording); await starting;
    expect(h.recording.cancel).toHaveBeenCalledTimes(2);
    expect(h.view.geminiRecording).toBeUndefined();
  });

  it.each(['practice', 'standard'] as const)('2: leaving Tutor also stops %s Handy dictation', async (targetKind) => {
    const h = harness(); await flush(); await h.message('showTutor');
    boundary.configuration.set('tutor.speechProvider', 'handy');
    h.view.handyExecutable = 'handy'; h.view.tutorState.speech.handyStatus = 'available';
    await toggleTutorDictation(h.view, targetKind === 'practice' ? { exerciseId: 'two' } : { conversation: true });
    expect(h.handy.toggle).toHaveBeenCalledTimes(1);
    await h.message('showManual'); await flush();
    expect(h.handy.toggle).toHaveBeenCalledTimes(2);
    expect(h.view.tutorState.speech.dictationProvider).toBeUndefined();
    expect(h.actions.generateTutor).toHaveBeenCalledTimes(0);
    expect(h.actions.transcribeTutorAudio).toHaveBeenCalledTimes(0);
    expect(h.liveSocketFactory).toHaveBeenCalledTimes(0);
  });

  it('3: receiver processes Cancel immediately during lesson Ask and drops its late result', async () => {
    const h = harness(); const response = deferred<unknown>();
    const preparedBefore = h.view.tutorState.questionPrepared;
    h.actions.generateTutor.mockReturnValue(response.promise);
    h.receive({ command: 'askTutorQuestion', search: 'Teach me questions.' });
    await flush(); expect(h.actions.generateTutor).toHaveBeenCalledTimes(1);
    const signal = h.actions.generateTutor.mock.calls[0]![2] as AbortSignal;
    h.receive({ command: 'cancelTutorAsk' }); await flush();
    const abortedBeforeResponse = signal.aborted;
    response.resolve({ targets: [] }); await flush();
    expect(abortedBeforeResponse).toBe(true);
    // 2026-10-05: cancellation preserves the initial unprepared state, whose flag is unset.
    expect(h.view.tutorState.questionPrepared).toBe(preparedBefore);
    expect(h.view.tutorState.preparedPrompt).toBeUndefined();
    expect(h.actions.generateTutor).toHaveBeenCalledTimes(1);
  });

  it('4: Stop and Back to chat preserve an unsent draft and its spoken flag', async () => {
    const h = harness(); h.view.tutorState.conversation.draftAnswer = 'Keep this draft';
    h.view.tutorState.conversation.draftAnswerSpoken = true;
    await stopTutorConversation(h.view); resumeTutorConversation(h.view);
    expect(h.view.tutorState.conversation.draftAnswer).toBe('Keep this draft');
    expect(h.view.tutorState.conversation.draftAnswerSpoken).toBe(true);
  });

  it('5: transcription belongs to its practice item after navigation and ignores a replaced set', async () => {
    const h = harness(); h.view.tutorState.answers.two = 'Typed';
    h.view.tutorState.currentExerciseIndex = 1;
    const response = deferred<string>(); h.actions.transcribeTutorAudio.mockReturnValueOnce(response.promise);
    await startGeminiDictation(h.view, { exerciseId: 'two' });
    const pending = stopGeminiDictation(h.view, { exerciseId: 'two' }); await flush();
    await h.message('showPreviousTutorExercise');
    expect(h.view.tutorState.currentExerciseIndex).toBe(0);
    response.resolve('Dictated answer.'); await pending;
    h.view.tutorState.currentExerciseIndex = 1;
    expect(h.view.tutorState.answers.two).toBe('Typed Dictated answer.');
    expect(renderTutorExercises(h.view.tutorState, 'gemini', true)).toContain('Typed Dictated answer.');
    expect(h.postMessage.mock.calls.some(([value]) => (value as { transcript?: string }).transcript === 'Dictated answer.')).toBe(true);
    const late = deferred<string>(); h.actions.transcribeTutorAudio.mockReturnValueOnce(late.promise);
    await startGeminiDictation(h.view, { exerciseId: 'two' });
    const obsolete = stopGeminiDictation(h.view, { exerciseId: 'two' }); await flush();
    h.view.tutorState = replaceTutorExerciseSet(h.view.tutorState, { ...h.view.tutorState.exerciseSet! });
    late.resolve('Old set answer'); await obsolete;
    expect(h.view.tutorState.answers.two).toBeUndefined();
    expect(h.actions.transcribeTutorAudio).toHaveBeenCalledTimes(2);
  });

  it('6: a failed Live session patches its microphone to Standard and executes that route', async () => {
    const h = harness(); h.view.tutorState.conversation.replies = 'liveGemini';
    h.view.tutorLiveSession = { close: vi.fn() } as never;
    disableTutorLive(h.view, new TutorLiveSessionError('socketClosed'), 'test');
    await toggleTutorDictation(h.view, { conversation: true });
    expect(h.recorder.start).toHaveBeenCalledTimes(1);
    const patches = h.postMessage.mock.calls.map(([value]) => value as { command: string; provider?: string });
    expect(patches.some((patch) => patch.command === 'tutorDictationState' && patch.provider === 'gemini')).toBe(true);
    expect(renderTutorConversation(h.view.tutorState, 'gemini', true, undefined, false)).toContain('data-tutor-dictation-provider="gemini"');
    cancelGeminiDictation(h.view);
    expect(h.actions.transcribeTutorAudio).toHaveBeenCalledTimes(0);
    expect(h.actions.generateTutor).toHaveBeenCalledTimes(0);
    expect(h.liveSocketFactory).toHaveBeenCalledTimes(0);
  });

  it('6: the failure patch enables Standard dictation in the mounted composer without losing its draft', () => {
    const h = harness(); h.view.tutorState.conversation.replies = 'liveGemini';
    const html = renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
      activeScreen: 'tutor', tutor: h.view.tutorState, proModels: [] });
    const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gu)].map((match) => match[1]).join('\n');
    const start = script.indexOf('function updateTutorLiveTalk(');
    const code = script.slice(start, script.indexOf('\n    }\n', start) + 6);
    class Button {
      disabled = true; title = ''; attributes = new Map([['data-tutor-live-talk', 'true']]);
      classList = { remove: vi.fn(), toggle: vi.fn() };
      getAttribute(key: string) { return this.attributes.get(key) ?? null; }
      setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    }
    class Select { value = 'liveGemini'; }
    const microphone = new Button(); const replies = new Select(); const draft = { value: 'Unsent draft' };
    disableTutorLive(h.view, new TutorLiveSessionError('socketClosed'), 'test');
    const patch = h.postMessage.mock.calls.map(([value]) => value as { standardFallback?: boolean }).reverse().find((value) => value.standardFallback);
    expect(patch).toBeDefined();
    runInNewContext(code + '\nupdateTutorLiveTalk(message);', {
      message: patch, HTMLButtonElement: Button, HTMLSelectElement: Select,
      document: { querySelector: (selector: string) => selector.includes('mic-control') ? microphone : selector.includes('replies') ? replies : draft },
      syncTutorPictureMicrophone: vi.fn()
    });
    expect(microphone.disabled).toBe(false);
    expect(microphone.getAttribute('data-tutor-live-talk')).toBe('false');
    expect(microphone.getAttribute('data-tutor-dictation-provider')).toBe('gemini');
    expect(microphone.getAttribute('data-tutor-dictation-route-unavailable')).toBe('false');
    expect(draft.value).toBe('Unsent draft');
    expect(h.actions.generateTutor).toHaveBeenCalledTimes(0);
    expect(h.liveSocketFactory).toHaveBeenCalledTimes(0);
  });

  it('7: a replacement practice set clears old hints and rejects an old in-flight Hint', async () => {
    const h = harness(); h.view.tutorState.exerciseHints.one = { explanation: 'Old hint', example: 'Old example' };
    h.view.tutorState.exerciseHintFailures.one = 'Old failure';
    const response = deferred<unknown>(); h.actions.generateTutor.mockReturnValue(response.promise);
    const pending = writeTutorPracticeHint(h.view, 'two');
    h.view.tutorState = replaceTutorExerciseSet(h.view.tutorState, { ...h.view.tutorState.exerciseSet! });
    response.resolve({ explanation: 'Late old hint', example: 'Old example' }); await pending;
    expect(h.view.tutorState.exerciseHints).toEqual({});
    expect(h.view.tutorState.exerciseHintFailures).toEqual({});
    expect(h.view.tutorState.exerciseHintBusyIds).toEqual([]);
    expect(renderTutorExercises(h.view.tutorState, 'gemini', true)).not.toContain('Old hint');
    expect(h.actions.generateTutor).toHaveBeenCalledTimes(1);
  });

  it.each(['dictionary', 'translate'] as const)('8: %s completion preserves input and language edits made while loading', async (tool) => {
    const h = harness(); const response = deferred<unknown>(); h.actions.runTutorTool.mockReturnValue(response.promise);
    h.view.tutorState.toolDrawer = { tool, input: 'Original input', targetLanguage: 'ko', status: 'editing' };
    await h.message('submitTutorTool');
    await h.message('updateTutorToolInput', { input: 'New input' });
    await h.message('updateTutorToolTargetLanguage', { targetLanguage: 'en' });
    response.resolve({ text: 'Result' }); await flush();
    expect(h.view.tutorState.toolDrawer).toMatchObject({ input: 'New input', targetLanguage: 'en', status: 'ready', result: { text: 'Result' } });
    expect(h.actions.runTutorTool).toHaveBeenCalledTimes(1);
    expect(h.actions.runTutorTool.mock.calls[0]).toEqual([tool === 'dictionary' ? 'englishDictionary' : 'translate', 'Original input', expect.any(AbortSignal), 'ko']);
    expect(h.actions.generateTutor).toHaveBeenCalledTimes(0);
  });
});
