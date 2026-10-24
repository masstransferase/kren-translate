import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from 'cheerio';
import { mountedPanel } from './support/mountedPanel.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

vi.mock('vscode', () => ({
  commands: { executeCommand: vi.fn() }, env: { remoteName: undefined },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
  Uri: { joinPath: (...parts: unknown[]) => parts },
  window: { showWarningMessage: vi.fn(async () => 'Reset panel') }
}));

import { KrenResultsViewProvider } from '../src/resultsView.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { cancelTutorConversationReplayAll, replayTutorConversation, waitForTutorIntroCompletion } from '../src/resultsViewReplay.js';
import { tutorConversationStopState } from '../src/resultsViewStop.js';
import { tutorSpeechPlaybackBarriers } from '../src/speech/speechAdapter.js';
import type { TutorStructuredGenerationRequest } from '../src/tutor/generation.js';
import type { TutorLiveSocket, TutorLiveSocketEvent } from '../src/tutor/liveSession.js';

const scene = 'Two colleagues meet. A visitor approaches.';
const opening = 'How can I help?';
const cast = { scene, male: { name: 'Tom', role: 'colleague', description: 'A man.' },
  female: { name: 'Mina', role: 'visitor', description: 'A woman.' } };
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
  emit(type: string, value?: unknown) {
    if (type === 'open') this.readyState = 1;
    this.listeners.get(type)?.forEach(callback => callback({ data: value }));
  }
  message(serverContent: unknown) { this.emit('message', JSON.stringify({ serverContent })); }
  complete(text = scene, audio = false) {
    this.message({ outputTranscription: { text }, ...(audio ? { modelTurn: { parts: [
      { inlineData: { data: Buffer.alloc(48_000).toString('base64'), mimeType: 'audio/pcm;rate=24000' } }
    ] } } : {}), turnComplete: true });
  }
  turns() { return this.sent.filter(message => message.clientContent); }
}
type Mode = 'standard' | 'learner' | 'demo' | 'live' | 'liveLearner' | 'liveDemo';
const cleanup: Array<() => void> = [];
function fixture(mode: Mode, sentencePause = 0, speakerOn = true) {
  const narration = deferred();
  const line = deferred();
  const sockets: Socket[] = [];
  let progress: ((completed: number, queued: number) => void) | undefined;
  let playerError: ((error: Error) => void) | undefined;
  const player = { play: vi.fn(), stop: vi.fn(), close: vi.fn() };
  const waveOut = { start: vi.fn(async (onError: (error: Error) => void, onProgress?: typeof progress) => {
    playerError = onError;
    progress = onProgress;
    return player;
  }) };
  const settings = { ...PANEL_SETTINGS_FIXTURE, tutorReadAloudProvider: 'edgeOnline' as const,
    tutorSentencePauseMilliseconds: sentencePause, credentialPresence: { geminiDefault: true } };
  const played = vi.fn();
  const actions = {
    settings: vi.fn(() => settings), notify: vi.fn(), log: vi.fn(), stopReadAloud: vi.fn(),
    readAloudText: vi.fn((text: string) => {
      // Changed 2026-10-23 (V303, owner I63): preparation precedes the mark; only playback starts speech.
      const barrier = tutorSpeechPlaybackBarriers.get(actions.readAloudText);
      return (async () => {
        if (barrier && !await barrier()) return;
        played(text);
        provider.tutorSpeechPlaybackStarted();
        await (text === scene ? narration.promise : line.promise);
      })();
    }),
    generateTutor: vi.fn(async (request: TutorStructuredGenerationRequest) => {
      if (request.kind === 'liveSessionCredential') return { apiKey: ['unit', 'test', 'credential'].join('-') };
      if (request.kind === 'conversationOpening') return { scene, tutorRole: 'colleague', learnerRole: 'visitor',
        ...(!mode.toLowerCase().includes('learner') && mode !== 'learner' ? { opening } : {}) };
      if (request.kind === 'conversationDemoCast') return cast;
      if (request.kind === 'conversationDemoBatch') return { lines: Array.from({ length: 8 }, (_, i) => ({
        speaker: i % 2 ? 'male' : 'female', text: `Line ${i + 1}.`
      })) };
      return {};
    }),
    writeTutorPreferences: vi.fn(), updateSetting: vi.fn(), refreshReadAloudVoices: vi.fn(async () => [])
  };
  const provider = new KrenResultsViewProvider(actions as never, {} as never, undefined, undefined,
    () => { const socket = new Socket(); sockets.push(socket); return socket; }, waveOut);
  const internals = provider as unknown as { handleMessage(message: unknown): Promise<void>; activeScreen: string };
  internals.activeScreen = 'tutor';
  Object.assign(provider.tutorState.conversation, { from: 'anything', replies: mode.startsWith('live') ? 'liveGemini' : 'standard',
    starts: mode === 'learner' || mode === 'liveLearner' ? 'learner' : 'kren', speakerOn, situationPicture: 'none', coaching: 'afterwards' });
  const messages: Array<Record<string, any>> = [];
  let panel: ReturnType<typeof mountedPanel> | undefined;
  const postMessage = vi.fn(async (message: Record<string, any>) => { messages.push(message); panel?.message(message); return true; });
  provider.view = { webview: { html: '', cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }), postMessage } } as never;
  vi.spyOn(provider, 'render').mockImplementation(() => undefined);
  const result = { provider, actions, narration, line, sockets, player, waveOut, messages, settings, played,
    command: (command: string) => internals.handleMessage({ command }),
    drain: () => progress?.(1, 0),
    failAudio: () => playerError?.(new Error('test playback failure')),
    mount: () => {
      const html = renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', settings: settings as never,
        activeScreen: 'tutor', tutor: provider.tutorState, tutorConversationScene: scene, proModels: [] });
      panel = mountedPanel(html, () => undefined);
      return panel;
    }
  };
  cleanup.push(() => { provider.dispose(); narration.resolve(); line.resolve(); });
  return result;
}
async function flush() { await vi.advanceTimersByTimeAsync(0); }
async function start(f: ReturnType<typeof fixture>, mode: Mode, audio = true, complete = true) {
  await f.command(mode.toLowerCase().includes('demo') ? 'startTutorConversationDemo' : 'startTutorConversation');
  await flush();
  for (const socket of f.sockets) {
    socket.emit('open'); socket.emit('message', JSON.stringify({ setupComplete: {} }));
  }
  await flush();
  if (mode.startsWith('live')) {
    const narrator = f.sockets.find(socket => socket.turns().length)!;
    if (complete) narrator.complete(scene, audio);
    await flush();
    return narrator;
  }
  return undefined;
}
function transitions(f: ReturnType<typeof fixture>) {
  return f.messages.filter(message => message.command === 'tutorConversationDemoLine' ||
    message.command === 'tutorConversationOpeningReady' && (message.opening || message.reveal === 'ready'));
}

describe('V295 intro playback barrier', () => {
  beforeEach(() => vi.useFakeTimers({ now: 10_000 }));
  afterEach(async () => {
    for (const close of cleanup.splice(0)) close();
    await flush(); vi.useRealTimers(); vi.restoreAllMocks();
  });

  for (const mode of ['standard', 'learner', 'demo', 'live', 'liveLearner', 'liveDemo'] as const) {
    // Changed 2026-10-22 (coordinator): 250 and 500 added; at 0 and 1,000 a pause that wrongly follows the Sentence pause also gives 1,000 ms.
    it.each([0, 250, 500, 1_000])(`${mode}: nothing at 999 ms, transition at 1000 ms, sentence pause %s`, async pause => {
      const f = fixture(mode, pause);
      const socket = await start(f, mode);
      // Synthesis and server turnComplete precede actual playback completion by five seconds.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(transitions(f)).toEqual([]);
      if (mode.startsWith('live')) f.drain(); else f.narration.resolve();
      await flush();
      if (mode === 'standard' || mode === 'learner') expect(f.provider.tutorConversationIntroSpeaking).toBe(true);
      expect(tutorConversationStopState(f.provider).disabled).toBe(false);
      await vi.advanceTimersByTimeAsync(999);
      expect(transitions(f)).toEqual([]);
      // Changed 2026-10-23 (V303, owner I63): request the opening during the pause, hold its audio.
      if (mode === 'live' || mode === 'liveLearner') expect(socket!.turns()).toHaveLength(mode === 'live' ? 2 : 1);
      await vi.advanceTimersByTimeAsync(1);
      if (mode === 'live') {
        expect(socket!.turns()).toHaveLength(2);
        expect(socket!.turns()[0]!.clientContent.turns[0].parts[0].text).not.toMatch(/say exactly this opening/u);
        expect(socket!.turns()[1]!.clientContent.turns[0].parts[0].text).toContain(`say exactly this opening: ${JSON.stringify(opening)}`);
        socket!.complete(opening); await flush();
      }
      if (mode === 'liveLearner') expect(socket!.turns()).toHaveLength(1);
      if (mode === 'liveDemo') {
        const lines = f.sockets.flatMap(item => item.turns()).filter(turn => turn.clientContent.turns[0].parts[0].text.includes('Line 1.'));
        expect(lines).toHaveLength(1);
      }
      expect(transitions(f)).toHaveLength(1);
    });

    it.each(['stopTutorConversation', 'showStartPage', 'showSettings', 'resetTutorSession', 'host', 'cancel', 'replacement'])(
      `${mode}: cancel via %s at 500 ms leaves no later opening effects`, async action => {
        const f = fixture(mode);
        // Reset can already be awaiting its human choice when an opening begins.
        // A fresh Reset request is unavailable while Live's narration is busy today.
        const resetChoice = deferred();
        if (action === 'resetTutorSession') vi.spyOn(f.provider, 'showWarningMessage').mockImplementation(async () => {
          await resetChoice.promise; return 'Reset panel';
        });
        const pendingReset = action === 'resetTutorSession' ? f.command(action) : undefined;
        await flush();
        await start(f, mode);
        if (mode.startsWith('live')) f.drain(); else f.narration.resolve();
        await flush(); await vi.advanceTimersByTimeAsync(500);
        if (action === 'resetTutorSession') { resetChoice.resolve(); await pendingReset; }
        else if (action === 'host') f.actions.stopReadAloud();
        else if (action === 'cancel') cancelTutorConversationReplayAll(f.provider);
        else if (action === 'replacement') {
          await f.command('stopTutorConversation'); await f.command('startNewTutorConversation');
        } else await f.command(action);
        await flush();
        expect(f.provider.tutorIntroCompletionWait).toBeUndefined();
        // Changed 2026-10-23 (V303, owner I63): a canceled prepared request has made no playback call.
        if (mode.startsWith('live')) expect(f.sockets.flatMap(socket => socket.turns())).toHaveLength(mode === 'liveLearner' ? 1 : 2);
        else {
          expect(f.actions.readAloudText).toHaveBeenCalledTimes(mode === 'learner' ? 1 : 2);
          expect(f.played).toHaveBeenCalledTimes(1);
        }
        if (mode.toLowerCase().includes('demo')) expect(transitions(f)).toEqual([]);
        const afterCancel = { messages: f.messages.length, speech: f.actions.readAloudText.mock.calls.length,
          turns: f.sockets.map(socket => socket.turns().length), state: JSON.stringify(f.provider.tutorState.conversation) };
        await vi.advanceTimersByTimeAsync(20_000);
        expect({ messages: f.messages.length, speech: f.actions.readAloudText.mock.calls.length,
          turns: f.sockets.map(socket => socket.turns().length), state: JSON.stringify(f.provider.tutorState.conversation) }).toEqual(afterCancel);
      });
  }

  it.each(['live', 'liveLearner', 'liveDemo'] as const)('%s: Live interruption at 500 ms cancels the opening', async mode => {
    const f = fixture(mode); const socket = await start(f, mode);
    f.drain(); await flush(); await vi.advanceTimersByTimeAsync(500);
    socket!.message({ interrupted: true }); await flush();
    expect(f.provider.tutorIntroCompletionWait).toBeUndefined();
    const messages = f.messages.length;
    await vi.advanceTimersByTimeAsync(20_000);
    // Changed 2026-10-23 (V303, owner I63): Live has prepared a turn; cancellation prevents its delivery.
    expect(f.sockets.flatMap(item => item.turns())).toHaveLength(mode === 'liveLearner' ? 1 : 2);
    expect(transitions(f)).toEqual([]);
    expect(f.messages).toHaveLength(messages);
  });

  it('rechecks cancellation after the timer has resolved and before its continuation runs', async () => {
    const f = fixture('standard'); let current = true; const transition = vi.fn();
    const pending = waitForTutorIntroCompletion(f.provider, () => current).then(allowed => { if (allowed) transition(); });
    vi.advanceTimersByTime(1_000); current = false;
    await pending; expect(transition).not.toHaveBeenCalled();
  });

  it('Live waits for a late player to start and drain before starting the pause', async () => {
    const f = fixture('live'); const ready = deferred();
    f.waveOut.start.mockImplementationOnce(async (_error, onProgress) => {
      await ready.promise;
      // Use the fixture's normal callback registration after the delayed startup.
      return f.waveOut.start(_error, onProgress);
    });
    const socket = await start(f, 'live');
    await vi.advanceTimersByTimeAsync(5_000); expect(socket!.turns()).toHaveLength(1);
    ready.resolve(); await flush(); expect(f.player.play).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5_000); expect(socket!.turns()).toHaveLength(1);
    f.drain(); await flush(); await vi.advanceTimersByTimeAsync(999);
    // Changed 2026-10-23 (V303, owner I63): native completion releases the request before the mark.
    expect(socket!.turns()).toHaveLength(2);
    expect(transitions(f)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1); expect(socket!.turns()).toHaveLength(2);
  });

  it('Live anchors the pause to native completion even when turnComplete arrives 400 ms later', async () => {
    const f = fixture('live'); const socket = (await start(f, 'live', false, false))!;
    socket.message({ outputTranscription: { text: scene }, modelTurn: { parts: [{ inlineData: {
      data: Buffer.alloc(48_000).toString('base64'), mimeType: 'audio/pcm;rate=24000'
    } }] } });
    await flush(); f.drain(); await vi.advanceTimersByTimeAsync(400);
    socket.message({ turnComplete: true }); await flush();
    // Changed 2026-10-23 (V303, owner I63): the second turn prepares now, its audio waits for the original mark.
    expect(socket.turns()).toHaveLength(2);
    socket.complete(opening, true); await flush();
    await vi.advanceTimersByTimeAsync(599); expect(f.player.play).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(f.player.play).toHaveBeenCalledTimes(2);
  });

  it('Demo retains its one-second delay for later exchanges', async () => {
    const f = fixture('demo'); await start(f, 'demo');
    f.narration.resolve(); await flush(); await vi.advanceTimersByTimeAsync(1_000);
    expect(transitions(f)).toHaveLength(1);
    f.line.resolve(); await flush(); await vi.advanceTimersByTimeAsync(999);
    expect(transitions(f)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); expect(transitions(f)).toHaveLength(2);
  });

  it('Live playback failure while draining does not strand the intro barrier', async () => {
    const f = fixture('live'); const socket = (await start(f, 'live'))!;
    f.failAudio(); await flush();
    // Changed 2026-10-23 (V303, owner I63): failed playback releases preparation without releasing the mark.
    await vi.advanceTimersByTimeAsync(999); expect(socket.turns()).toHaveLength(2);
    expect(transitions(f)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1); expect(socket.turns()).toHaveLength(2);
    expect(f.player.close).toHaveBeenCalled();
  });

  it.each(['standard', 'learner', 'live', 'liveLearner'] as const)('%s: speaker off adds no pause', async mode => {
    const f = fixture(mode, 1_000, false); const socket = await start(f, mode, false);
    if (mode === 'live') { expect(socket!.turns()).toHaveLength(2); socket!.complete(opening); await flush(); }
    expect(f.provider.tutorIntroCompletionWait).toBeUndefined();
    expect(transitions(f)).toHaveLength(1);
    expect(f.actions.readAloudText).not.toHaveBeenCalled();
  });

  it('Live failure preserves the Standard fallback intro barrier', async () => {
    const f = fixture('live'); await start(f, 'live');
    f.sockets[0]!.emit('message', JSON.stringify({ error: { message: 'test failure' } }));
    await flush();
    f.narration.resolve(); await flush();
    // Changed 2026-10-23 (V303, owner I63): fallback prepares during the pause and plays at the mark.
    await vi.advanceTimersByTimeAsync(999); expect(f.actions.readAloudText).toHaveBeenCalledTimes(2);
    expect(f.played).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(f.played).toHaveBeenCalledTimes(2);
  });

  it.each(['standard', 'demo'] as const)('%s: Replay without an intro adds no barrier', async mode => {
    const f = fixture(mode);
    Object.assign(f.provider.tutorState.conversation, { status: 'stopped', currentQuestion: opening,
      demoMode: mode === 'demo', demoCast: cast, demoLines: [{ speaker: 'female', text: opening }] });
    replayTutorConversation(f.provider); await flush();
    expect(f.actions.readAloudText).toHaveBeenCalledTimes(1);
    expect(f.provider.tutorIntroCompletionWait).toBeUndefined();
  });

  it('mounted learner controls stay hidden through 999 ms and become reachable at 1000 ms', async () => {
    const f = fixture('learner'); await start(f, 'learner');
    const panel = f.mount();
    f.narration.resolve(); await flush(); await vi.advanceTimersByTimeAsync(999);
    expect(panel.query('[data-tutor-chat-mic-control]')!.closest('[hidden]')).not.toBeNull();
    // Existing Standard narration hides Stop too. V295 preserves that visibility during the pause.
    expect(panel.query('[data-tutor-composer-stop]')!.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    const mic = panel.query('[data-tutor-chat-mic-control]')!;
    expect(mic.closest('[hidden]')).toBeNull();
    expect(mic.closest('details:not([open])')).toBeNull();
    expect(mic.tagName).toBe('BUTTON'); expect(mic.getAttribute('tabindex')).not.toBe('-1');
    const stop = panel.query('[data-tutor-composer-stop]')!;
    expect(stop.closest('[hidden]')).toBeNull();
    expect(stop.closest('details:not([open])')).toBeNull();
    expect(stop.tagName).toBe('BUTTON'); expect(stop.disabled).toBe(false);
    expect(stop.getAttribute('tabindex')).not.toBe('-1');
    // The existing unavailable-action wording is retained when no microphone route is installed.
    const $ = load(mic.outerHTML);
    expect(mic.disabled).toBe(true);
    expect($('button').attr('title')).toMatch(/microphone|speech|dictation|unavailable|start/iu);
  });
});
