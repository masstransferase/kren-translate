// Changed 2026-10-18: V263, owner item I43, the in-chat microphone owns state and replaces the lower control.
// 2026-10-12: Observe the mounted panel and actual host/audio message sequence.
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn() }, window: {},
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { completeTutorConversationOpening } from '../src/resultsViewConversation.js';
import { completeStandardTutorTurn } from '../src/resultsViewTurns.js';
import { refreshTutorSpeechAvailability, stopGeminiDictation } from '../src/resultsViewDictation.js';
import { GoogleChirpSpeech, chirpSentences } from '../src/speech/speechCenter.js';
import { cancelTutorConversationReplayAll } from '../src/resultsViewReplay.js';
import { mountedPanel } from './support/mountedPanel.js';
import { priorityWebviewCommand } from '../src/webviewMessagePriority.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const opening = { scene: 'You meet a store clerk at the grocery store.', opening: 'What groceries can I help you find today?', tutorRole: 'store clerk', learnerRole: 'customer' };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const response = () => new Response(JSON.stringify({ audioContent: 'AQIDBA==' }));
afterEach(() => vi.useRealTimers());
function harness(speakerOn = true) {
  vi.useFakeTimers();
  let panel!: ReturnType<typeof mountedPanel>;
  const messages: Array<Record<string, unknown>> = [];
  const idleDrafts: string[] = [];
  const actions = { settings: () => ({ ...PANEL_SETTINGS_FIXTURE, tutorReadAloudProvider: 'googleChirp',
    credentialPresence: { ...PANEL_SETTINGS_FIXTURE.credentialPresence, geminiDefault: true } }),
    log: vi.fn(), notify: vi.fn(), stopReadAloud: () => chirp.stop(),
    readAloudText: (text: string) => chirp.speak(text, { voice: 'Kore', ratePercent: 0, volume: 50 }, async () => {}),
    writeTutorPreferences: vi.fn(), refreshReadAloudVoices: vi.fn(async () => {}),
    generateTutor: vi.fn(() => new Promise(() => {})), transcribeTutorAudio: vi.fn(async () => 'I would like some milk.') };
  const handy = { detect: vi.fn(async () => undefined), toggle: vi.fn(async () => {}) };
  const view = new KrenResultsViewProvider(actions as never, {} as never, handy);
  const internals = view as unknown as { activeScreen: string; handleMessage(message: unknown): Promise<void>; handlePriorityMessage(command: string, message: unknown): void };
  internals.activeScreen = 'tutor';
  const chirp = new GoogleChirpSpeech(async () => ['test', 'only'].join('-'), {
    play: (audio, volume, onStarted) => view.playGeneratedAudioBase64(audio, volume, onStarted), stop: () => view.stopGeneratedAudio()
  }, vi.fn(), vi.fn(async () => response()), actions.log, () => view.tutorOpeningSpeechFallback());
  const webview = { cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }),
    set html(value: string) { panel = mountedPanel(value, message => {
      const priority = priorityWebviewCommand(message);
      if (priority) internals.handlePriorityMessage(priority, message);
      else void internals.handleMessage(message);
    }); },
    postMessage: vi.fn(async (message: Record<string, unknown>) => {
      messages.push(message);
      if (message.command === 'tutorDictationState' && message.state === 'idle') idleDrafts.push(view.tutorState.conversation.draftAnswer);
      panel?.message(message); return true;
    }) };
  view.view = { webview } as never;
  Object.assign(view.tutorState.conversation, { status: 'active', busy: true, speakerOn, replies: 'standard', situationPicture: 'none' });
  view.render();
  const controller = new AbortController(); view.tutorConversationController = controller;
  completeTutorConversationOpening(view, opening, controller, false);
  return { view, actions, chirp, messages, idleDrafts, panel: () => panel, message: (command: string, fields = {}) => internals.handleMessage({ command, ...fields }) };
}
const text = (h: ReturnType<typeof harness>) => h.panel().query('[data-tutor-transcript]')!.textContent;
const controlsHidden = (h: ReturnType<typeof harness>) => {
  expect(h.panel().query('[data-tutor-chat-mic-control]')!.hidden).toBe(true);
  // Changed 2026-10-18: V263, owner item I43, hide the persistent control while playback owns the turn.
  expect(h.panel().query('[data-tutor-chat-microphone]')!.hidden).toBe(true);
};

it('V226 reproduction: a full render and all opening patches must not finish the scene playback', async () => {
  const h = harness(); await flush();
  expect(text(h)).not.toContain(opening.opening);
  h.panel().audioStart(); await flush();
  // This is the real render path V225 omitted. It used to stop the pending audio.
  h.view.render(); await flush();
  expect(text(h)).not.toContain(opening.opening);
  await refreshTutorSpeechAvailability(h.view); await flush();
  expect(text(h)).not.toContain(opening.opening);
  for (const message of [
    { command: 'tutorConversationPictureReady', image: 'data:image/png;base64,AAAA', requestId: 1, mode: 'intro' },
    { command: 'tutorConversationPictureTransparencyReady', transparency: 50 },
    { command: 'tutorConversationBalloonTransparencyReady', transparency: 50 },
    { command: 'tutorConversationPictureCancelled', requestId: 1 },
    { command: 'tutorConversationPictureRequestFinished' },
    { command: 'tutorLiveSpeakerState', speakerOn: true }
  ]) { h.panel().message(message); expect(text(h)).not.toContain(opening.opening); }
  h.view.render(false, true); await flush();
  expect(text(h)).not.toContain(opening.opening); controlsHidden(h);
  expect(h.messages.filter(message => message.command === 'playGeneratedAudio')).toHaveLength(1);
  h.panel().audioEnd(); await flush();
  expect(text(h)).not.toContain(opening.opening);
  expect(h.panel().query('[data-tutor-typing]')).not.toBeNull();
  h.panel().audioStart(); await flush();
  expect(text(h)).toContain(opening.opening); controlsHidden(h);
  h.panel().audioEnd(); await flush();
  expect(h.panel().query('[data-tutor-chat-mic-control]')!.hidden).toBe(false);
  expect(h.panel().query('[data-tutor-chat-mic-control]')!.disabled).toBe(false);
  expect(h.panel().query('[data-tutor-chat-stop]')!.closest('details')).toBeNull();
  h.chirp.stop();
});

it('V226 playback gate: each reply stays dots until playing and releases controls only at ended', async () => {
  const h = harness(false); await flush();
  h.view.tutorState.conversation.speakerOn = true;
  const reply = 'The milk is in the refrigerator beside the bread.';
  completeStandardTutorTurn(h.view, { move: 'reaction', reply, correction: '', explanation: '' }, opening.opening, 'I need milk.', true);
  h.view.tutorState.conversation.busy = false; h.view.render(); await flush();
  expect(text(h)).toContain('I need milk.');
  expect(text(h)).not.toContain(reply);
  expect(h.panel().query('[data-tutor-typing]')).not.toBeNull(); controlsHidden(h);
  h.panel().audioStart(); await flush();
  expect(text(h)).toContain(reply); controlsHidden(h);
  h.panel().audioEnd(); await flush();
  expect(h.panel().query('[data-tutor-chat-microphone]')).not.toBeNull();
  h.chirp.stop();
});

it('V226 sentence pipeline: play the first sentence before requesting the next, with one lookahead', async () => {
  const first = 'The milk is in the refrigerator beside the bread.';
  const second = 'Please follow me and I will help you find everything.';
  const third = 'You can also choose from our fresh vegetables today.';
  const events: string[] = []; const ends: Array<(result: 'completed') => void> = [];
  const speech = new GoogleChirpSpeech(async () => ['test', 'only'].join('-'), {
    play: async (_audio, _volume, onStarted) => { events.push('play'); onStarted?.(); return new Promise(resolve => ends.push(resolve)); }, stop: () => false
  }, vi.fn(), vi.fn(async (_url, init) => { events.push(JSON.parse(String(init?.body)).input.text); return response(); }));
  const pending = speech.speak([first, second, third].join(' '), { voice: 'Kore', ratePercent: 0, volume: 50 }, vi.fn());
  await flush();
  expect(events).toEqual([first, 'play', second]);
  ends[0]!('completed'); await flush();
  expect(events).toEqual([first, 'play', second, 'play', third]);
  ends[1]!('completed'); await flush(); ends[2]!('completed'); await pending;
});

it('V226 speech send: no visible answer or Send, and no draft write before the learner balloon', async () => {
  const h = harness(false); await flush();
  h.view.tutorState.conversation.send = 'stopSpeaking'; h.view.render();
  // Changed 2026-10-18: V263, owner item I43, neither an answer box nor Send is rendered.
  expect(h.panel().query('[data-tutor-conversation-answer]')).toBeNull();
  expect(h.panel().query('[data-command="submitTutorConversationTurn"]')).toBeNull();
  h.view.geminiRecording = { finish: async (consume: Function) => consume(new Uint8Array([0]), { sampleRate: 16000, channels: 1, bitsPerSample: 16 }) } as never;
  await stopGeminiDictation(h.view, { conversation: true }); await flush();
  expect(h.view.tutorState.conversation.draftAnswer).toBe('');
  expect(h.idleDrafts).toEqual(['']);
  expect(text(h)).toContain('I would like some milk.');
  expect(h.panel().query('[data-tutor-conversation-answer]')).toBeNull();
  h.chirp.stop();
});

it('V226 direct transcript: automatic Send never stages the transcript in the host or panel draft', async () => {
  const h = harness(false); await flush(); h.view.tutorState.conversation.send = 'stopSpeaking';
  h.view.geminiRecording = { finish: async (consume: Function) => consume(new Uint8Array([0]), { sampleRate: 16000, channels: 1, bitsPerSample: 16 }) } as never;
  await stopGeminiDictation(h.view, { conversation: true }); await flush();
  expect(h.idleDrafts).toEqual(['']);
  expect(h.messages.filter(message => message.command === 'tutorDictationState').every(message => message.transcript === undefined)).toBe(true);
  expect(text(h)).toContain('I would like some milk.');
  expect(h.panel().query('[data-tutor-conversation-answer]')).toBeNull();
  h.chirp.stop();
});

it.each(['stopSpeaking', 'liveGemini', 'button'] as const)('V226 mounted preference updates for %s preserve voice-only input', async choice => {
  const h = harness(false); await flush();
  // Changed 2026-10-18: V263, owner item I43, legacy Send updates cannot restore removed input controls.
  const panel = h.panel();
  const replies = panel.query('[data-tutor-conversation-replies]')!;
  if (choice === 'liveGemini') { replies.value = choice; panel.change(replies); }
  expect(h.panel().query('[data-tutor-conversation-answer]')).toBeNull();
  expect(h.panel().query('[data-tutor-conversation-send]')).toBeNull();
  expect(h.panel().query('[data-command="submitTutorConversationTurn"]')).toBeNull();
  expect(h.view.tutorState.conversation.send).toBe('stopSpeaking');
  expect(h.panel().query('[data-tutor-chat-mic-control]')).not.toBeNull();
  h.chirp.stop();
});

it('V226 stopping dictation sends directly with no answer box or Send', async () => {
  const h = harness(false); await flush(); h.view.tutorState.conversation.send = 'stopSpeaking'; // Changed 2026-10-18: V263, owner item I43, every runtime turn sends on speech stop. h.view.render();
  h.view.geminiRecording = { finish: async (consume: Function) => consume(new Uint8Array([0]), { sampleRate: 16000, channels: 1, bitsPerSample: 16 }) } as never;
  await stopGeminiDictation(h.view, { conversation: true }); await flush();
  // Changed 2026-10-18: V263, owner item I43, stopping dictation submits the balloon immediately.
  expect(text(h)).toContain('I would like some milk.');
  expect(h.view.tutorState.conversation.draftAnswer).toBe('');
  expect(h.view.tutorState.conversation.pendingAnswer).toBe('I would like some milk.');
  expect(h.panel().query('[data-command="submitTutorConversationTurn"]')).toBeNull();
  h.chirp.stop();
});

it.each(['off', 'cancel', 'stalled'] as const)('V226 %s releases reply text and reachable controls', async event => {
  const h = harness(false); await flush(); h.view.tutorState.conversation.speakerOn = true;
  const reply = 'Please choose whatever vegetables you would like today.';
  completeStandardTutorTurn(h.view, { move: 'reaction', reply, correction: '', explanation: '' }, opening.opening, 'Vegetables, please.', true);
  h.view.render(); await flush(); expect(text(h)).not.toContain(reply);
  if (event === 'off') await h.message('toggleTutorConversationSpeaker');
  if (event === 'cancel') cancelTutorConversationReplayAll(h.view);
  if (event === 'stalled') await vi.advanceTimersByTimeAsync(120_000);
  await flush();
  expect(text(h)).toContain(reply);
  expect(h.panel().query('[data-tutor-chat-microphone]')).not.toBeNull();
  expect(h.panel().query('[data-tutor-typing]')).toBeNull();
  h.chirp.stop();
});

it('V226 a short synthesis delay does not consume the scene playback deadline', async () => {
  const h = harness(); await flush();
  await vi.advanceTimersByTimeAsync(15_000); h.panel().audioStart(); await flush();
  expect(text(h)).not.toContain(opening.opening);
  expect(h.view.tutorState.conversation.openingReveal).toBe('scene');
  h.panel().audioEnd(); await flush(); h.panel().audioStart(); await flush(); h.panel().audioEnd(); await flush(); h.chirp.stop();
});

it('V226 full speech patches retain the draft object, picture object and player', async () => {
  const h = harness(); await flush(); const panel = h.panel();
  const answer = panel.query('[data-tutor-conversation-answer]');
  const picture = panel.query('[data-tutor-picture]');
  const player = panel.query('#kren-audio');
  h.view.render(); await flush();
  expect(h.panel()).toBe(panel);
  expect(panel.query('[data-tutor-conversation-answer]')).toBe(answer);
  expect(panel.query('[data-tutor-picture]')).toBe(picture);
  expect(panel.query('#kren-audio')).toBe(player);
  h.panel().audioEnd(); await flush(); h.panel().audioEnd(); await flush(); h.chirp.stop();
});

it('V226 sentence splitting joins tiny sentences forward and keeps a short tail with its neighbor', () => {
  const text = 'Hi. Please follow me to the refrigerator beside the bread. Yes. We also have plenty of fresh vegetables today. Thanks.';
  const chunks = chirpSentences(text);
  expect(chunks).toEqual(['Hi. Please follow me to the refrigerator beside the bread.', 'Yes. We also have plenty of fresh vegetables today. Thanks.']);
  expect(chunks.every(chunk => chunk.length >= 40)).toBe(true);
  expect(chirpSentences('Hello.')).toEqual(['Hello.']);
});

it('V226 Stop aborts the lookahead request and rejects late audio, with one first-audio log', async () => {
  const first = 'Please follow me to the refrigerator beside the bread.';
  const second = 'We also have plenty of fresh vegetables in our shop.';
  const requests: AbortSignal[] = []; let late!: (value: Response) => void;
  let end!: (result: 'stopped') => void; const log = vi.fn();
  const play = vi.fn(async (_audio, _volume, started) => { started(); return new Promise<'stopped'>(resolve => { end = resolve; }); });
  const speech = new GoogleChirpSpeech(async () => ['test', 'only'].join('-'), { play, stop: () => { end?.('stopped'); return true; } }, vi.fn(),
    vi.fn(async (_url, init): Promise<Response> => { requests.push(init!.signal as AbortSignal); return requests.length === 1 ? response() : new Promise<Response>(resolve => { late = resolve; }); }), log);
  const pending = speech.speak(first + ' ' + second, { voice: 'Kore', ratePercent: 0, volume: 50 }, vi.fn());
  await flush(); expect(requests).toHaveLength(2);
  speech.stop(); await pending; expect(requests.every(signal => signal.aborted)).toBe(true);
  late(response()); await flush(); expect(play).toHaveBeenCalledOnce();
  expect(log.mock.calls.map(([line]) => line).filter(line => /^\[speech\] Chirp first audio after \d+ ms$/u.test(line))).toHaveLength(1);
});

it('V226 each sentence has its own single retry and earlier audio is not replayed', async () => {
  vi.useFakeTimers();
  const lines = ['Please follow me to the refrigerator beside the bread.', 'We also have plenty of fresh vegetables in our shop.'];
  const requests: string[] = []; const attempts = new Map<string, number>();
  const player = { play: vi.fn(async (_audio, _volume, started) => { started(); return 'completed' as const; }), stop: () => false };
  const fallback = vi.fn(async () => {}), log = vi.fn();
  const speech = new GoogleChirpSpeech(async () => ['test', 'only'].join('-'), player, vi.fn(),
    vi.fn(async (_url, init) => {
      const text = JSON.parse(String(init!.body)).input.text; requests.push(text);
      const attempt = attempts.get(text) ?? 0; attempts.set(text, attempt + 1);
      return attempt === 0 ? new Response('{}', { status: 503 }) : response();
    }), log);
  const pending = speech.speak(lines.join(' '), { voice: 'Kore', ratePercent: 0, volume: 50 }, fallback);
  await vi.advanceTimersByTimeAsync(2000); await pending;
  expect(requests).toEqual([lines[0], lines[0], lines[1], lines[1]]);
  expect(player.play).toHaveBeenCalledTimes(2); expect(fallback).not.toHaveBeenCalled();
  expect(log.mock.calls.map(([line]) => line).filter(line => line.includes('retrying once'))).toHaveLength(2);
  expect(log.mock.calls.map(([line]) => line).filter(line => line.includes('Chirp first audio after'))).toHaveLength(1);
});

it('V226 a later sentence failure falls back only on the remaining text and aborts lookahead', async () => {
  const first = 'Please follow me to the refrigerator beside the bread.';
  const second = 'We also have plenty of fresh vegetables in our shop.';
  let requests = 0; const signals: AbortSignal[] = []; const fallback = vi.fn(async (_text?: string) => {});
  const player = { play: vi.fn(async (_audio, _volume, started) => { started(); return 'completed' as const; }), stop: () => false };
  const speech = new GoogleChirpSpeech(async () => ['test', 'only'].join('-'), player, vi.fn(),
    vi.fn(async (_url, init) => { signals.push(init!.signal as AbortSignal); return ++requests === 1 ? response() : new Response('{}', { status: 403 }); }));
  await speech.speak(first + ' ' + second, { voice: 'Kore', ratePercent: 0, volume: 50 }, fallback);
  expect(player.play).toHaveBeenCalledOnce(); expect(fallback).toHaveBeenCalledExactlyOnceWith(second);
  expect(signals.every(signal => signal.aborted)).toBe(true);
});

it('V226 a two-line reply reveals each line with its own voice and keeps controls closed between them', async () => {
  const h = harness(false); await flush(); h.view.tutorState.conversation.speakerOn = true;
  const reply = 'We have fresh milk available in the refrigerator.';
  const nextQuestion = 'Would you like to see the other groceries as well?';
  completeStandardTutorTurn(h.view, { move: 'reaction', reply, nextQuestion, correction: '', explanation: '' }, opening.opening, 'Milk, please.', true);
  h.view.render(); await flush();
  expect(text(h)).not.toContain(reply); expect(text(h)).not.toContain(nextQuestion);
  h.panel().audioStart(); await flush();
  expect(text(h)).toContain(reply); expect(text(h)).not.toContain(nextQuestion); controlsHidden(h);
  h.panel().audioEnd(); await flush(); controlsHidden(h);
  h.panel().audioStart(); await flush(); expect(text(h)).toContain(nextQuestion); controlsHidden(h);
  h.panel().audioEnd(); await flush(); expect(h.panel().query('[data-tutor-chat-microphone]')).not.toBeNull(); h.chirp.stop();
});

it('V226 Handy focuses its private capture sink from the in-chat microphone', async () => {
  const h = harness(false); await flush();
  h.view.tutorState.conversation.send = 'stopSpeaking'; h.view.tutorState.speech.handyStatus = 'available'; h.view.render();
  // Changed 2026-10-18: V263, owner item I43, Handy focuses a temporary capture sink with no conversation text box.
  const panel = h.panel();
  const microphone = panel.query('[data-tutor-chat-mic-control]')!;
  panel.click(microphone);
  const capture = panel.query('[data-tutor-handy-capture]')!;
  expect(capture.classList.contains('tutor-answer-offscreen')).toBe(true);
  expect(capture.getAttribute('contenteditable')).toBe('true');
  expect(capture.getAttribute('tabindex')).toBe('-1');
  expect(panel.document.activeElement).toBe(capture);
  expect(panel.query('[data-tutor-conversation-answer]')).toBeNull(); h.chirp.stop();
});

it('V226 speaking in-place still delivers the committed turn to the continuation-picture check', async () => {
  const h = harness(false); await flush();
  h.view.tutorState.conversation.situationPicture = 'switching';
  h.view.tutorConversationPictures = ['data:image/png;base64,AAAA'];
  h.view.tutorConversationPictureTurns = [-1]; h.view.tutorConversationPicture = h.view.tutorConversationPictures[0];
  h.view.render();
  const picture = h.panel().query('[data-tutor-picture]')!;
  picture.complete = true; picture.naturalWidth = 100;
  h.view.tutorState.conversation.speakerOn = true;
  completeStandardTutorTurn(h.view, { move: 'reaction', reply: 'Please follow me to the refrigerator beside the bread.', correction: '', explanation: '' }, opening.opening, 'Milk, please.', true);
  h.view.render(); await flush();
  expect(h.view.tutorConversationPictureContinuationTurn).toBeUndefined();
  h.panel().audioStart(); await flush();
  expect(h.view.tutorConversationPictureContinuationTurn).toBe(0);
  expect(h.view.tutorState.conversation.speechReveal).toBeDefined(); controlsHidden(h);
  h.panel().audioEnd(); await flush(); h.chirp.stop();
});
