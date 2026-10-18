// 2026-10-13: Exercise the shipped host, mounted panel and extension speech entry.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn() }, window: {},
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { completeTutorConversationOpening } from '../src/resultsViewConversation.js';
import { completeStandardTutorTurn } from '../src/resultsViewTurns.js';
import { refreshTutorSpeechAvailability } from '../src/resultsViewDictation.js';
import { GoogleChirpSpeech, tutorChirpVoices } from '../src/speech/speechCenter.js';
import { priorityWebviewCommand } from '../src/webviewMessagePriority.js';
import { mountSpeechCenter } from './support/speechCenterHarness.js';
import { mountedPanel } from './support/mountedPanel.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { TUTOR_DEFAULTS } from '../src/tutor/defaults.js';
import { EDGE_SPEECH_AUTO_LOCALE, resolveEdgeSpeechLocale, resolveEdgeSpeechVoice } from '@kren/core/edge-speech';
import { edgeSpeechFailureMessage, edgeSpeechRetryNotice } from '../src/edgeSpeechMessages.js';

const source = readFileSync('src/extension.ts', 'utf8');
const entry = source.slice(source.indexOf('async function readAloudText('), source.indexOf('\nasync function ', source.indexOf('async function readAloudText(') + 1));
const script = ts.transpileModule(entry, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const first = 'Please follow me to the refrigerator beside the bread.';
const second = 'We also have plenty of fresh vegetables in our shop.';
const opening = { scene: first + ' ' + second, opening: 'What groceries can I help you find today?', tutorRole: 'store clerk', learnerRole: 'customer' };
afterEach(() => vi.useRealTimers());

function harness(provider = 'googleChirp', gender: 'male' | 'female' = 'male') {
  vi.useFakeTimers();
  let panel!: ReturnType<typeof mountedPanel>;
  let documents = 0, drop = 0, holdReady = false;
  const messages: Array<Record<string, unknown>> = [], panelMessages: Array<Record<string, unknown>> = [];
  const media: { playError?: { name: string } } = {};
  const notify = vi.fn((_kind: string, message: string) => { void view.showWarningMessage(message); });
  const log = vi.fn();
  const settings = { ...PANEL_SETTINGS_FIXTURE, tutorReadAloudProvider: provider,
    tutorLiveMaleVoice: 'Enceladus', tutorLiveFemaleVoice: 'Callirrhoe',
    credentialPresence: { ...PANEL_SETTINGS_FIXTURE.credentialPresence, geminiDefault: true } };
  const actions = { settings: () => settings, log, notify, writeTutorPreferences: vi.fn(),
    refreshReadAloudVoices: vi.fn(async () => {}), generateTutor: vi.fn(() => new Promise(() => {})),
    readAloudText: async (text: string, _language?: string, _settings?: string, voice?: string) => {
      await context.readAloudText({}, text, 'en', 'tutor', voice);
    }, stopReadAloud: () => { context.readAloudSession++; chirp.stop(); edge.stop(); windows.stop(); } };
  const view = new KrenResultsViewProvider(actions as never, {} as never, { detect: vi.fn(async () => undefined), toggle: vi.fn() });
  const internals = view as unknown as { activeScreen: string; handlePriorityMessage(command: string, message: unknown): void };
  internals.activeScreen = 'tutor';
  const webview = { cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }),
    set html(value: string) { documents++; panel = mountedPanel(value, message => {
      panelMessages.push(message);
      const priority = priorityWebviewCommand(message);
      if (priority) internals.handlePriorityMessage(priority, message);
    }, media); },
    postMessage: vi.fn(async (message: Record<string, unknown>) => {
      messages.push(message);
      if (message.command === 'playGeneratedAudio' && drop-- > 0) return false;
      if (message.command === 'requestGeneratedAudioReady' && holdReady) return false;
      panel?.message(message); return true;
    }) };
  view.view = { webview, visible: true } as never;
  Object.assign(view.tutorState.conversation, { status: 'active', busy: false, speakerOn: true, replies: 'standard', situationPicture: 'none', liveVoice: gender === 'male' ? 'Enceladus' : 'Callirrhoe' });
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ audioContent: 'AQIDBA==' })));
  const chirp = new GoogleChirpSpeech(async () => ['test', 'only'].join('-'), {
    play: (audio: string, volume: number, started?: () => void) => view.playGeneratedAudioBase64(audio, volume, started),
    stop: () => view.stopGeneratedAudio(),
    failureCause: () => view.generatedAudioFailureCause()
  }, message => notify('warning', message), fetcher, log);
  const edge = { speak: vi.fn(async (_text: string, _options: any) => 'failed'), stop: vi.fn() };
  let endWindows!: (completed: boolean) => void;
  const windows = { speak: vi.fn((_text: string, _options: any) => new Promise<boolean>(resolve => { endWindows = resolve; })), stop: vi.fn() };
  const values: Record<string, unknown> = {
    'tutor.readAloud.provider': provider, 'tutor.readAloud.voice': 'Tutor Windows', 'tutor.readAloud.rate': 3, 'tutor.readAloud.volume': 65,
    'tutor.readAloud.edgeLocale': 'auto', 'tutor.readAloud.edgeVoice': 'en-US-ChristopherNeural', 'tutor.readAloud.edgeRatePercent': -15,
    'tutor.readAloud.edgeMaleVoice': 'en-US-GuyNeural', 'tutor.readAloud.edgeFemaleVoice': 'en-US-JennyNeural',
    'readAloud.voice': 'Shared Windows', 'readAloud.edgeVoice': 'en-US-AriaNeural', 'readAloud.volume': 10
  };
  const context: any = { readAloudSession: 0, resultsView: view, chirpSpeech: chirp, readAloudPlayer: windows, edgeReadAloudPlayer: edge,
    // 2026-10-13: Read Aloud owns a separate adapter; tutor requests only stop it.
    readAloudChirpSpeech: new GoogleChirpSpeech(async () => undefined, { play: vi.fn(), stop: vi.fn() }, message => notify('warning', message)),
    vscode: { workspace: { isTrusted: true, getConfiguration: () => ({ get: (key: string, fallback: unknown) => values[key] ?? fallback }) },
      commands: { executeCommand: vi.fn(async () => {}) }, window: { setStatusBarMessage: () => ({ dispose: vi.fn() }) } },
    TUTOR_DEFAULTS, READ_ALOUD_PROVIDER_DEFAULT: 'windowsLocal', EDGE_SPEECH_AUTO_LOCALE,
    resolveEdgeSpeechLocale, resolveEdgeSpeechVoice, tutorChirpVoices, edgeSpeechFailureMessage, edgeSpeechRetryNotice,
    ensureEdgeTtsConsent: vi.fn(async () => true), notify, outputChannel: { appendLine: log },
    showKrenErrorMessage: vi.fn(), text: '', console };
  // 2026-10-14: The extension entry delegates to the actual center, preserving mounted assertions.
  mountSpeechCenter(context);
  runInNewContext(script, context);
  view.render();
  return { view, chirp, edge, windows, fetcher, notify, log, messages, panelMessages, media, context, internals,
    panel: () => panel, documents: () => documents, drop: (count = 1) => { drop = count; },
    holdReady: () => { holdReady = true; }, ready: () => internals.handlePriorityMessage('generatedAudioReady', { command: 'generatedAudioReady' }),
    startWindows: () => windows.speak.mock.calls.at(-1)![1].onStarted(), endWindows: () => endWindows(true),
    speak: (text = first, voice = gender === 'male' ? 'Enceladus' : 'Callirrhoe') => context.readAloudText({}, text, 'en', 'tutor', provider === 'googleChirp' ? voice : undefined) as Promise<void> };
}
const transcript = (h: ReturnType<typeof harness>) => h.panel().query('[data-tutor-transcript]')!.textContent;
async function refreshDuringSpeech(h: ReturnType<typeof harness>) {
  const panel = h.panel(), player = panel.query('#kren-audio'), draft = panel.query('[data-tutor-conversation-answer]');
  h.view.render(); await refreshTutorSpeechAvailability(h.view); h.view.render(false, true);
  for (const message of [
    { command: 'tutorConversationPictureReady', image: 'data:image/png;base64,AAAA', requestId: 1, mode: 'intro' },
    { command: 'tutorConversationPictureRequestFinished' }, { command: 'tutorLiveSpeakerState', speakerOn: true }
  ]) panel.message(message);
  await flush();
  expect(h.panel()).toBe(panel); expect(panel.query('#kren-audio')).toBe(player);
  expect(panel.query('[data-tutor-conversation-answer]')).toBe(draft);
}

it('V230 reproduction: a queued tutor clip survives full renders with no reveal and a notice card', async () => {
  const h = harness(); const pending = h.speak(first + ' ' + second); await flush();
  await refreshDuringSpeech(h);
  void h.view.showWarningMessage('A KREN notice arrived.'); await flush();
  expect(h.panel().query('[data-kren-notice]')?.textContent).toContain('A KREN notice arrived.');
  h.panel().audioStart(); await refreshDuringSpeech(h); h.panel().audioEnd(); await flush();
  await refreshDuringSpeech(h); h.panel().audioStart(); h.panel().audioEnd(); await pending;
  expect(h.fetcher).toHaveBeenCalledTimes(2); expect(h.edge.speak).not.toHaveBeenCalled();
  expect(h.documents()).toBe(1);
});
it.each(['opening', 'reply'])('V230 mounted %s keeps ordering and voice reveal across every render boundary and one lost delivery', async kind => {
  const h = harness(); h.drop();
  if (kind === 'opening') {
    const controller = new AbortController(); h.view.tutorConversationController = controller;
    completeTutorConversationOpening(h.view, opening, controller, false);
  } else completeStandardTutorTurn(h.view, { move: 'reaction', reply: first + ' ' + second, nextQuestion: opening.opening, correction: '', explanation: '' }, 'Question', 'Milk, please.', true);
  await flush(); await refreshDuringSpeech(h);
  void h.view.showWarningMessage('A notice during tutor speech.'); await flush();
  expect(h.panel().query('[data-kren-notice]')?.textContent).toContain('A notice during tutor speech.');
  expect(transcript(h)).not.toContain(opening.opening);
  h.panel().audioStart(); await refreshDuringSpeech(h);
  if (kind === 'reply') expect(transcript(h)).toContain(first);
  h.panel().audioEnd(); await flush(); await refreshDuringSpeech(h);
  h.panel().audioStart(); await refreshDuringSpeech(h); h.panel().audioEnd(); await flush();
  expect(transcript(h)).not.toContain(opening.opening);
  h.panel().audioStart(); await flush(); expect(transcript(h)).toContain(opening.opening);
  h.panel().audioEnd(); await flush();
  expect(h.panel().query('[data-tutor-chat-microphone]')).not.toBeNull();
  expect(h.panel().query('[data-tutor-chat-stop]')!.closest('details')).toBeNull();
  expect(h.edge.speak).not.toHaveBeenCalled(); expect(h.documents()).toBe(1);
  expect(h.messages.filter(m => m.command === 'playGeneratedAudio')).toHaveLength(4);
  h.chirp.stop();
});
it('V230 defers another screen and renders it only when the whole Chirp utterance ends', async () => {
  const h = harness(); const pending = h.speak(first + ' ' + second); await flush(); const panel = h.panel();
  h.internals.activeScreen = 'settings'; h.view.render(); expect(h.panel()).toBe(panel);
  panel.audioStart(); panel.audioEnd(); await flush(); expect(h.panel()).toBe(panel);
  panel.audioStart(); panel.audioEnd(); await pending; await flush(); expect(h.documents()).toBe(2);
});
it.each(['NotAllowedError', 'AbortError', 'NotSupportedError', 3])('V230 reports panel playback cause %s through the host and Chirp log', async cause => {
  const h = harness();
  if (typeof cause === 'string') h.media.playError = { name: cause };
  const pending = h.speak(); await flush();
  if (typeof cause === 'number') h.panel().audioError(cause);
  await vi.advanceTimersByTimeAsync(1000);
  if (typeof cause === 'number') h.panel().audioError(cause);
  await flush();
  const label = typeof cause === 'number' ? 'media error 3' : cause;
  expect(h.panelMessages).toContainEqual(expect.objectContaining({ command: 'generatedAudioFailed', cause }));
  expect(h.log).toHaveBeenCalledWith(`[speech] panel playback failed (${label})`);
  expect(h.log.mock.calls.some(([line]) => line.includes('playback') && line.includes(label) && line.includes('Google Cloud'))).toBe(true);
  h.startWindows(); h.endWindows(); await pending;
});
it('V230 a clip retries delivery only once after the ready acknowledgment', async () => {
  const h = harness(); h.drop(2); const pending = h.speak(); await flush();
  expect(h.messages.filter(m => m.command === 'playGeneratedAudio')).toHaveLength(2);
  expect(h.fetcher).toHaveBeenCalledOnce();
  // 2026-10-14: Delivery failure now falls back immediately, so finish the fake Windows clip too.
  h.chirp.stop(); h.endWindows(); await pending;
});
it.each(['ready', 'stop'] as const)('V230 a lost clip waits for readiness and respects %s while waiting', async action => {
  const h = harness(); h.drop(); h.holdReady(); const pending = h.speak(); await flush();
  expect(h.messages.filter(m => m.command === 'playGeneratedAudio')).toHaveLength(1);
  if (action === 'stop') h.chirp.stop();
  h.ready(); await flush();
  expect(h.messages.filter(m => m.command === 'playGeneratedAudio')).toHaveLength(action === 'stop' ? 1 : 2);
  if (action === 'ready') { h.panel().audioStart(); h.panel().audioEnd(); }
  await pending; expect(h.edge.speak).not.toHaveBeenCalled(); expect(h.notify).not.toHaveBeenCalled();
});
it.each(['male', 'female'] as const)('V230 Chirp then Edge then Windows use the %s tutor voices and remaining text', async gender => {
  const h = harness('googleChirp', gender); let count = 0;
  h.fetcher.mockImplementation(async () => ++count === 1 ? new Response(JSON.stringify({ audioContent: 'AQIDBA==' })) : new Response('{}', { status: 403 }));
  const pending = h.speak(first + ' ' + second); await flush();
  h.panel().audioStart(); h.panel().audioEnd(); await flush();
  expect(h.edge.speak).toHaveBeenCalledWith(second, expect.objectContaining({ voice: gender === 'male' ? 'en-US-GuyNeural' : 'en-US-JennyNeural', ratePercent: -15, volume: 65 }));
  expect(h.windows.speak).toHaveBeenCalledWith(second, expect.objectContaining({ voice: 'Tutor Windows', rate: 3, volume: 65 }));
  h.startWindows(); h.endWindows(); await pending;
  expect(h.notify).toHaveBeenCalledOnce();
  expect(h.notify.mock.calls[0]![1]).toMatch(/Google Cloud.*failed.*Edge Online.*unavailable.*Windows voice/u);
});
it('V230 Edge failure speaks with tutor Windows settings, advances reveal, and shows one card per conversation', async () => {
  const h = harness('edgeOnline');
  for (let turn = 0; turn < 2; turn++) {
    const reply = turn === 0 ? first : second;
    completeStandardTutorTurn(h.view, { move: 'reaction', reply, correction: '', explanation: '' }, 'Question', 'Milk, please.', true);
    h.view.render(); await flush(); expect(transcript(h)).not.toContain(reply);
    expect(h.windows.speak).toHaveBeenLastCalledWith(reply, expect.objectContaining({ voice: 'Tutor Windows', rate: 3, volume: 65 }));
    h.startWindows(); await flush(); expect(transcript(h)).toContain(reply);
    h.endWindows(); await flush(); expect(h.panel().query('[data-tutor-chat-microphone]')).not.toBeNull();
  }
  expect(h.notify).toHaveBeenCalledOnce(); expect(h.notify.mock.calls[0]![1]).toMatch(/Edge Online.*Windows voice/u);
  expect(h.log.mock.calls.filter(([line]) => line.includes('Edge Online'))).toHaveLength(2);
  h.view.tutorConversationController = new AbortController();
  // A new request and a replaced opening context still belong to this conversation.
  h.view.tutorLiveOpeningContext = {} as never;
  const next = h.speak(); await flush(); h.startWindows(); h.endWindows(); await next;
  expect(h.notify).toHaveBeenCalledOnce();
  h.view.tutorSpeechConversation = {};
  const newConversation = h.speak(); await flush(); h.startWindows(); h.endWindows(); await newConversation;
  expect(h.notify).toHaveBeenCalledTimes(2);
});
it('V232 selected shared Edge falls through to its own Windows settings and one cause card', async () => {
  const h = harness('edgeOnline');
  // 2026-10-14: V232 makes selected shared Edge use Windows too, with shared settings.
  const pending = h.context.readAloudText({}, first, 'en', 'shared', 'en-US-AriaNeural'); await flush();
  expect(h.windows.speak).toHaveBeenCalledWith(first, expect.objectContaining({ voice: 'Shared Windows', volume: 10 }));
  h.endWindows(); await pending;
  expect(h.notify).toHaveBeenCalledOnce();
  expect(h.notify.mock.calls[0]![1]).toMatch(/Edge Online.*unavailable.*synthesis or playback failed.*Windows voice/u);
  expect(h.notify.mock.calls.some(([, text]) => text.includes('Auto-detect'))).toBe(false);
});
it('V230 Chirp-to-Edge success names the tutor Edge voice and shows one card across later failures', async () => {
  const h = harness(); h.fetcher.mockImplementation(async () => new Response('{}', { status: 403 }));
  h.edge.speak.mockImplementation(async (_text, options) => { options.onStarted(); return 'completed'; });
  await h.speak(); await h.speak(second);
  expect(h.edge.speak).toHaveBeenCalledTimes(2); expect(h.windows.speak).not.toHaveBeenCalled();
  expect(h.notify).toHaveBeenCalledOnce(); expect(h.notify.mock.calls[0]![1]).toMatch(/Google Cloud.*failed.*Edge voice/u);
});
it.each(['male', 'female'] as const)('V230 selected Windows failure tries the %s tutor Edge voice once and skips failed Windows', async gender => {
  const h = harness('windowsLocal', gender); h.windows.speak.mockResolvedValue(false);
  h.edge.speak.mockImplementation(async (_text, options) => { options.onStarted(); return 'completed'; });
  await h.speak();
  expect(h.edge.speak).toHaveBeenCalledWith(first, expect.objectContaining({ voice: gender === 'male' ? 'en-US-GuyNeural' : 'en-US-JennyNeural' }));
  expect(h.windows.speak).toHaveBeenCalledOnce(); expect(h.fetcher).not.toHaveBeenCalled();
  expect(h.notify).toHaveBeenCalledOnce(); expect(h.notify.mock.calls[0]![1]).toMatch(/Windows.*failed.*Edge voice/u);
});
it('V230 Stop during failed Edge synthesis never starts Windows or shows a failure card', async () => {
  const h = harness('edgeOnline'); let fail!: (result: string) => void;
  h.edge.speak.mockImplementation(() => new Promise(resolve => { fail = resolve; }));
  const pending = h.speak(); await flush(); h.context.readAloudSession++; fail('failed'); await pending;
  expect(h.windows.speak).not.toHaveBeenCalled(); expect(h.notify).not.toHaveBeenCalled();
});
it.each(['dependencyMissing', 'throw'] as const)('V230 Edge %s falls through to Windows without an Edge failure card', async failure => {
  const h = harness('edgeOnline');
  if (failure === 'throw') h.edge.speak.mockRejectedValue(new Error('Private provider detail.'));
  else h.edge.speak.mockResolvedValue(failure);
  const pending = h.speak(); await flush();
  expect(h.windows.speak).toHaveBeenCalledWith(first, expect.objectContaining({ voice: 'Tutor Windows' }));
  h.startWindows(); h.endWindows(); await pending;
  expect(h.notify).toHaveBeenCalledOnce(); expect(h.notify.mock.calls[0]![1]).toMatch(/Edge Online.*Windows voice/u);
  expect(JSON.stringify(h.log.mock.calls)).not.toContain('Private provider detail.');
});
it('V230 unknown playback exception names cannot echo arbitrary details in the speech log', async () => {
  const h = harness(); const detail = ['private', 'detail'].join('-'); h.media.playError = { name: detail };
  const pending = h.speak(); await vi.advanceTimersByTimeAsync(1000); await flush();
  expect(h.log).toHaveBeenCalledWith('[speech] panel playback failed (unknown)');
  expect(JSON.stringify(h.log.mock.calls)).not.toContain(detail);
  h.startWindows(); h.endWindows(); await pending;
});
