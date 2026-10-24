import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { GoogleChirpSpeech, SpeechCenter, WindowsEdgeReadAloudPlayer } from '../src/speech/speechCenter.js';
import { EdgeOnlineSpeechAdapter, LocalWindowsSpeechAdapter } from '../src/speech/windowsSpeechAdapters.js';
import { tutorSpeechPlaybackBarriers } from '../src/speech/speechAdapter.js';
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
import { cancelTutorConversationReplayAll } from '../src/resultsViewReplay.js';
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
function fixture(mode: Mode, source: 'googleChirp' | 'edgeOnline' | 'windowsLocal' = 'googleChirp', synthesisMs = 400, pause = 500) {
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
  const settings = { ...PANEL_SETTINGS_FIXTURE, tutorReadAloudProvider: source,
    tutorSentencePauseMilliseconds: pause, credentialPresence: { geminiDefault: true, googleCloudTextToSpeech: true } };
  const actions = {
    settings: vi.fn(() => settings), notify: vi.fn(), log: vi.fn(), stopReadAloud: vi.fn(),
    readAloudText: vi.fn((text: string, language?: string, settingsSource?: 'tutor' | 'shared', voice?: string) => {
      if (text === scene) { provider.tutorSpeechPlaybackStarted(); return narration.promise; }
      return center.speak(text, language, settingsSource, voice, tutorSpeechPlaybackBarriers.get(actions.readAloudText)).then(() => {});
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
  const preparedAt: number[] = [], playedAt: number[] = [];
  const play = vi.fn(async (_audio?: string, _volume?: number, onStarted?: () => void) => {
    playedAt.push(Date.now()); onStarted?.(); provider.tutorSpeechPlaybackStarted();
    await line.promise; return 'completed' as const;
  });
  const chirp = new GoogleChirpSpeech(async () => ['unit', 'test'].join('-'), { play, stop: () => false }, vi.fn(),
    vi.fn(async () => {
      preparedAt.push(Date.now());
      await new Promise(resolve => setTimeout(resolve, synthesisMs));
      return { ok: true, status: 200, json: async () => ({ audioContent: 'YQ==' }) } as Response;
    }));
  const edge = new WindowsEdgeReadAloudPlayer('win32', () => {
    preparedAt.push(Date.now());
    const child = new EventEmitter() as ChildProcess;
    Object.defineProperty(child, 'stdin', { value: new PassThrough() });
    child.kill = vi.fn(() => { child.emit('exit', 1); return true; });
    setTimeout(() => child.emit('exit', 0), synthesisMs);
    return child;
  }, async () => ({ directory: 'test-memory', file: 'test-memory/speech.mp3' }), async () => {}, async () => true);
  const windows = new LocalWindowsSpeechAdapter({ stop: () => false, speak: async (_text, options) => {
    await play(undefined, undefined, options?.onStarted); return true;
  } });
  const values: Record<string, unknown> = { 'tutor.readAloud.provider': source, 'tutor.readAloud.sentencePauseMilliseconds': pause };
  const center = new SpeechCenter(chirp, chirp, new EdgeOnlineSpeechAdapter(edge), windows, {
    configuration: () => ({ get: ((key: string, fallback: unknown) => values[key] ?? fallback) as never }),
    trusted: () => true, consent: async () => true, active: async () => {}, status: () => ({ dispose() {} }),
    hold: () => provider.holdTutorSpeech(), started: () => provider.tutorSpeechPlaybackStarted(), liveSpeaking: () => false,
    conversation: () => provider.tutorSpeechConversationIdentity(), speakerVoice: () => '',
    playback: () => ({ play: () => play(), stop: () => false }), notify: vi.fn(), log: vi.fn()
  });
  actions.stopReadAloud.mockImplementation(() => { center.stop(); });
  const internals = provider as unknown as { handleMessage(message: unknown): Promise<void>; activeScreen: string };
  internals.activeScreen = 'tutor';
  Object.assign(provider.tutorState.conversation, { from: 'anything', replies: mode.startsWith('live') ? 'liveGemini' : 'standard',
    starts: mode === 'learner' || mode === 'liveLearner' ? 'learner' : 'kren', speakerOn: true, situationPicture: 'none', coaching: 'afterwards' });
  const messages: Array<Record<string, any>> = [];
  let panel: ReturnType<typeof mountedPanel> | undefined;
  const postMessage = vi.fn(async (message: Record<string, any>) => { messages.push(message); panel?.message(message); return true; });
  provider.view = { webview: { html: '', cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }), postMessage } } as never;
  vi.spyOn(provider, 'render').mockImplementation(() => undefined);
  const result = { provider, actions, narration, line, sockets, player, waveOut, messages, settings, preparedAt, playedAt, center,
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
  cleanup.push(() => { provider.dispose(); center.dispose(); narration.resolve(); line.resolve(); });
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

describe('V303 first chat audio from the intro last sound', () => {
  beforeEach(() => vi.useFakeTimers({ now: 0 }));
  afterEach(async () => {
    for (const close of cleanup.splice(0)) close();
    await flush(); vi.useRealTimers(); vi.restoreAllMocks();
  });

  for (const mode of ['standard', 'demo'] as const) {
    for (const source of ['googleChirp', 'edgeOnline'] as const) {
      it.each([400, 1300])(`${mode} ${source}: preparation %s ms starts at the later of readiness and 1000 ms`, async ms => {
        const f = fixture(mode, source, ms); await start(f, mode);
        f.narration.resolve(); await flush();
        await vi.advanceTimersByTimeAsync(999); expect(f.playedAt).toEqual([]);
        await vi.advanceTimersByTimeAsync(Math.max(1000, ms) - 999);
        expect(f.playedAt).toEqual([Math.max(1000, ms)]);
        expect(f.preparedAt).toEqual([0]);
        if (mode === 'standard') {
          expect(transitions(f).some(message => message.opening === opening)).toBe(true);
          expect(f.provider.tutorConversationSpeechSequenceRunning).toBe(true);
          expect(f.provider.tutorState.conversation.openingReveal).toBe('opening');
        }
      });
    }
    it.each([400, 1300])(`${mode} Edge with Engine default: preparation %s ms uses the same mark`, async ms => {
      const f = fixture(mode, 'edgeOnline', ms, 0); await start(f, mode);
      f.narration.resolve(); await flush();
      await vi.advanceTimersByTimeAsync(999); expect(f.playedAt).toEqual([]);
      await vi.advanceTimersByTimeAsync(Math.max(1000, ms) - 999);
      expect(f.playedAt).toEqual([Math.max(1000, ms)]);
      expect(f.preparedAt).toEqual([0]);
    });
    it.each(['googleChirp', 'edgeOnline'] as const)(`${mode} %s: cancel at 500 ms also retires synthesis finishing at 1300 ms`, async source => {
      const f = fixture(mode, source, 1300); await start(f, mode);
      f.narration.resolve(); await flush(); await vi.advanceTimersByTimeAsync(500);
      await f.command('stopTutorConversation');
      const messages = transitions(f).length;
      await vi.advanceTimersByTimeAsync(2000);
      expect(f.playedAt).toEqual([]);
      expect(transitions(f)).toHaveLength(messages);
      expect(f.provider.tutorLiveMicrophone).toBeUndefined();
    });
    it(`${mode} Windows starts its speech call at 1000 ms`, async () => {
      const f = fixture(mode, 'windowsLocal'); await start(f, mode);
      f.narration.resolve(); await flush();
      await vi.advanceTimersByTimeAsync(999); expect(f.playedAt).toEqual([]);
      await vi.advanceTimersByTimeAsync(1); expect(f.playedAt).toEqual([1000]);
    });
    for (const source of ['googleChirp', 'edgeOnline', 'windowsLocal'] as const) {
      it.each(['stopTutorConversation', 'showStartPage', 'showSettings', 'host', 'reset', 'replacement'])(`${mode} ${source}: cancel via %s at 500 ms discards prepared audio`, async action => {
        const f = fixture(mode, source); await start(f, mode);
        f.narration.resolve(); await flush(); await vi.advanceTimersByTimeAsync(500);
        if (action === 'host') f.actions.stopReadAloud();
        else if (action === 'reset') { cancelTutorConversationReplayAll(f.provider); await f.command('resetTutorSession'); }
        else if (action === 'replacement') { await f.command('stopTutorConversation'); await f.command('startNewTutorConversation'); }
        else await f.command(action);
        const afterCancel = transitions(f).length;
        await vi.advanceTimersByTimeAsync(2000);
        expect(f.playedAt).toEqual([]);
        expect(transitions(f)).toHaveLength(afterCancel);
        expect(f.provider.tutorLiveMicrophone).toBeUndefined();
      });
      it(`${mode} ${source}: muting at 500 ms releases text without audio`, async () => {
        const f = fixture(mode, source); await start(f, mode);
        f.narration.resolve(); await flush(); await vi.advanceTimersByTimeAsync(500);
        await f.command('toggleTutorConversationSpeaker'); await flush();
        await vi.advanceTimersByTimeAsync(2000);
        expect(f.playedAt).toEqual([]);
        expect(transitions(f).length).toBeGreaterThan(0);
      });
    }
  }

  it('Live requests at native completion and holds chunks received at 300 ms until 1000 ms', async () => {
    const f = fixture('live'); const socket = (await start(f, 'live'))!;
    await vi.advanceTimersByTimeAsync(2000);
    expect(socket.turns()).toHaveLength(1);
    f.drain(); await flush(); expect(socket.turns()).toHaveLength(2);
    f.player.play.mockClear();
    await vi.advanceTimersByTimeAsync(300); socket.complete(opening, true); await flush();
    expect(f.player.play).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(699); expect(f.player.play).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(f.player.play).toHaveBeenCalledOnce();
  });

  it('an early fallback notification cannot reveal the first line before the mark or hide it again at the mark', async () => {
    const f = fixture('standard'); await start(f, 'standard');
    const read = f.actions.readAloudText.getMockImplementation()!;
    f.actions.readAloudText.mockImplementationOnce((...args) => {
      f.provider.tutorOpeningSpeechFallback();
      return read(...args);
    });
    f.narration.resolve(); await flush();
    await vi.advanceTimersByTimeAsync(999);
    expect(f.provider.tutorState.conversation.openingReveal).toBe('scene');
    expect(f.playedAt).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.provider.tutorState.conversation.openingReveal).toBe('opening');
    expect(f.playedAt).toEqual([1000]);
  });

  it.each(['stopTutorConversation', 'showStartPage', 'showSettings', 'host', 'interrupt', 'replacement'])(
    'Live held audio is discarded by %s at 500 ms', async action => {
      const f = fixture('live'); const socket = (await start(f, 'live'))!;
      f.drain(); await flush(); f.player.play.mockClear();
      await vi.advanceTimersByTimeAsync(300); socket.complete(opening, true); await flush();
      await vi.advanceTimersByTimeAsync(200);
      if (action === 'host') f.actions.stopReadAloud();
      else if (action === 'interrupt') socket.message({ interrupted: true });
      else if (action === 'replacement') { await f.command('stopTutorConversation'); await f.command('startNewTutorConversation'); }
      else await f.command(action);
      const messages = transitions(f).length;
      await vi.advanceTimersByTimeAsync(2000);
      expect(f.player.play).not.toHaveBeenCalled();
      expect(transitions(f)).toHaveLength(messages);
      expect(f.provider.tutorLiveMicrophone).toBeUndefined();
    });

  it('Live host cancellation also discards opening chunks that arrive after cancel', async () => {
    const f = fixture('live'); const socket = (await start(f, 'live'))!;
    f.drain(); await flush(); f.player.play.mockClear();
    await vi.advanceTimersByTimeAsync(500); f.actions.stopReadAloud(); await flush();
    const messages = transitions(f).length;
    await vi.advanceTimersByTimeAsync(100); socket.complete(opening, true); await flush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.player.play).not.toHaveBeenCalled();
    expect(transitions(f)).toHaveLength(messages);
    expect(f.provider.tutorLiveMicrophone).toBeUndefined();
  });

  it('Live Demo requests after native intro completion, holds its first line and waits for its playback', async () => {
    const f = fixture('liveDemo', 'edgeOnline'); await start(f, 'liveDemo');
    await vi.advanceTimersByTimeAsync(1500);
    expect(f.sockets.flatMap(socket => socket.turns())).toHaveLength(1);
    f.drain(); await flush();
    const speaker = f.sockets.find(socket => socket.turns().some(turn =>
      turn.clientContent.turns[0].parts[0].text.includes('Line 1.')))!;
    expect(speaker).toBeDefined();
    f.player.play.mockClear();
    await vi.advanceTimersByTimeAsync(300); speaker.complete('Line 1.', true); await flush();
    expect(f.player.play).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(699); expect(f.player.play).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(f.player.play).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(999);
    expect(f.sockets.flatMap(socket => socket.turns())).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1001);
    expect(f.sockets.flatMap(socket => socket.turns())).toHaveLength(3);
  });

  it('mounted Standard controls remain hidden until the prepared line ends, then are keyboard reachable', async () => {
    const f = fixture('standard'); await start(f, 'standard'); const panel = f.mount();
    f.narration.resolve(); await flush(); await vi.advanceTimersByTimeAsync(999);
    expect(panel.query('[data-tutor-chat-mic-control]')!.closest('[hidden]')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(panel.query('[data-tutor-chat-mic-control]')!.closest('[hidden]')).not.toBeNull();
    f.line.resolve(); await flush();
    const mic = panel.query('[data-tutor-chat-mic-control]')!;
    expect(mic.closest('[hidden], details:not([open])')).toBeNull();
    expect(mic.tagName).toBe('BUTTON'); expect(mic.getAttribute('tabindex')).not.toBe('-1');
    expect(mic.disabled).toBe(true); expect(mic.title).toMatch(/microphone|speech|dictation|unavailable|start/iu);
    const stop = panel.query('[data-tutor-composer-stop]')!;
    expect(stop.closest('[hidden], details:not([open])')).toBeNull();
    expect(stop.disabled).toBe(false); expect(stop.getAttribute('tabindex')).not.toBe('-1');
    stop.focus(); expect(panel.document.activeElement).toBe(stop);
  });
});

