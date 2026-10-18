// Changed 2026-10-18: V263, owner item I43, the in-chat microphone owns state and replaces the lower control.
import { speakTutorTakeHome } from '../src/resultsViewTakeHome.js';
import { openTutorDemoLiveSessions, speakTutorDemoText } from '../src/resultsViewDemo.js';
import { configureLanguageModelUsage, LanguageModelUsageRecorder } from '../src/languageModelUsage.js';
// 2026-10-11: V218 uses the coaching card shape in the existing lifecycle fixture.
import { TUTOR_DEFAULTS } from '../src/tutor/defaults.js';
import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { mountedPanel } from './support/mountedPanel.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const executeCommand = vi.hoisted(() => vi.fn(async () => undefined));
const workspaceGet = vi.hoisted(() => vi.fn((_key: string, fallback: unknown) => fallback));
const showWarningMessage = vi.hoisted(() => vi.fn(
  async (): Promise<string | undefined> => undefined
));

vi.mock('vscode', () => ({
  commands: { executeCommand },
  env: { remoteName: undefined },
  workspace: { getConfiguration: () => ({ get: workspaceGet }) },
  Uri: { joinPath: (...parts: unknown[]) => parts },
  window: { showWarningMessage }
}));

import { TUTOR_SITUATIONS } from '@kren/core/tutor';
import { ProviderError } from '../src/errors.js';
import {
  KrenResultsViewProvider,
  TUTOR_CONVERSATION_STOP_SAFETY_TIMEOUT_MS
} from '../src/resultsView.js';
import { renderKrenResultViewHtml, renderTutorConversation } from '../src/resultViewHtml.js';
import type { TutorStructuredGenerationRequest } from '../src/tutor/generation.js';
import {
  TutorLiveSession,
  defaultTutorLiveSocketFactory,
  TutorLiveSessionError,
  type TutorLiveSocket,
  type TutorLiveSocketEvent
} from '../src/tutor/liveSession.js';
import { LiveConversationTurnTiming } from '../src/tutor/conversationTiming.js';
import { createTutorViewState, type TutorViewState } from '../src/tutor/state.js';
import { pcmSampleRate } from '../src/windowsWaveOutPlayer.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const TEST_CREDENTIAL = ['unit', 'test', 'credential'].join('-');
// Added 2026-09-24 for V150: every Live controller fixture now satisfies the same exact
// two-field opening contract as Standard, including tests that replace the generator mock.
const LIVE_OPENING_RESPONSE = {
  // 2026-10-11: Standard casting supplies named roles before the Live session opens.
  tutorRole: 'counterpart', learnerRole: 'visitor',
  scene: 'The other speaker is ready for this exchange.',
  opening: 'Welcome. How can I help?'
};

class FakeSocket implements TutorLiveSocket {
  public readyState = 0;
  public readonly sent: string[] = [];
  public closeCalls = 0;
  private readonly listeners = new Map<string, Set<(event: TutorLiveSocketEvent) => void>>();

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(): void {
    this.closeCalls += 1;
    this.readyState = 3;
  }

  public addEventListener(type: string, listener: (event: TutorLiveSocketEvent) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  public removeEventListener(type: string, listener: (event: TutorLiveSocketEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  public emit(type: 'open' | 'message' | 'error' | 'close', data?: unknown): void {
    if (type === 'open') this.readyState = 1;
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }

  public message(value: unknown): void {
    this.emit('message', JSON.stringify(value));
  }
}

interface ProviderInternals {
  handleMessage(message: unknown): Promise<void>;
  toggleTutorLiveMicrophone(): Promise<void>;
  refresh(): void;
  activeScreen: 'result' | 'start' | 'settings' | 'manual' | 'userDictionary' | 'tutor';
  tutorState: TutorViewState;
  tutorLiveReplyText: string;
  tutorLiveInputText: string;
  tutorLiveInputReplyPending: boolean;
  tutorTargetSearchController?: AbortController;
  tutorLiveFailed: boolean;
  tutorLivePauseBeforeReply: number;
  tutorLiveReplyAudio: Array<{ data: string; mimeType: string }>;
  tutorLiveReplyAudioComplete?: boolean;
  tutorLiveAudioPlayer?: unknown;
  tutorLiveConversationAudio: Map<number, Array<{ data: string; mimeType: string }>>;
  tutorLivePlaybackQueuedUntil: number;
  tutorLiveInputLatency?: {
    firstMicrophoneForwardedAt?: number;
    firstInputFragmentAt?: number;
    learnerBubblePatchedAt?: number;
  };
  tutorLiveTurnTiming?: LiveConversationTurnTiming;
  tutorConversationTurnGeneration: number;
  beginTutorLiveReply(): void;
  speakTutorConversationSequence(utterances: readonly string[], failure: string): void;
  postTutorConversationStopState(): void;
  cancelTutorLiveCoachingRequests(): boolean;
  tutorLiveResumeController?: AbortController;
  tutorLiveSession?: unknown;
  view?: {
    webview: {
      html: string;
      cspSource: string;
      asWebviewUri(value: unknown): { toString(): string };
      postMessage(message: unknown): Promise<boolean>;
    };
  };
}

// 2026-10-11: Standard replies and inline Live coaching share fixtures, while batch corrections have another shape.
function isInlineTutorTurn(request: TutorStructuredGenerationRequest): boolean {
  return request.kind === 'conversationTurn' || request.kind === 'conversationCorrections' && request.schemaName === 'kren_tutor_conversation_coaching';
}

function liveProvider(socketFactory: (url: string) => TutorLiveSocket, dictationRecorder?: KrenResultsViewProvider['recorder']) {
  const postMessage = vi.fn(async (_message: unknown) => true);
  // 2026-10-11: inline coaching has its own Thorough kind; batch corrections keep their separate shape.
  const generateTutor = vi.fn(async (request: TutorStructuredGenerationRequest): Promise<unknown> => {
    if (request.kind === 'liveSessionCredential') return { apiKey: TEST_CREDENTIAL };
    // Changed 2026-09-24 for V150: Standard and Live consume this same two-field opening.
    if (request.kind === 'conversationOpening') return LIVE_OPENING_RESPONSE;
    if (isInlineTutorTurn(request)) return {
      move: 'recast',
      reply: 'Structured reply that Live must ignore.',
      replyQuote: '',
      correction: 'I went there yesterday.',
      targetId: '',
      explanation: 'Use the past tense.',
      rephrase: 'I went there yesterday.',
      rephraseWhy: 'This naturally answers the question.',
      nextQuestion: 'Structured next question that Live must ignore?'
    };
    if (request.kind === 'conversationCorrections') return { corrections: [] };
    return {};
  });
  const actions = {
    notify: vi.fn(), copy: vi.fn(), details: vi.fn(), replace: vi.fn(), copyText: vi.fn(),
    replaceText: vi.fn(), applyGrammarChoices: vi.fn(), manageGrammarIssue: vi.fn(),
    readAloudText: vi.fn(), stopReadAloud: vi.fn(), clear: vi.fn(),
    loadUserDictionary: vi.fn(), saveUserDictionaryEntry: vi.fn(),
    deleteUserDictionaryEntry: vi.fn(), deleteUserDictionaryEntries: vi.fn(),
    previewUserDictionaryPurge: vi.fn(), confirmUserDictionaryPurge: vi.fn(),
    previewUserDictionaryImport: vi.fn(), applyUserDictionaryImport: vi.fn(),
    exportUserDictionary: vi.fn(), regenerateUserDictionaryEntry: vi.fn(),
    readSelectedEditorPassage: vi.fn(), generateTutor, transcribeTutorAudio: vi.fn(),
    runTutorTool: vi.fn(), updateSetting: vi.fn(async (_key: unknown, _value: unknown) => undefined), updateTutorVoiceSetting: vi.fn(),
    runCommand: vi.fn(), rerunOperation: vi.fn(),
    log: vi.fn(), settings: vi.fn(() => ({ ...PANEL_SETTINGS_FIXTURE })),
    refreshGeminiModels: vi.fn(), refreshGeminiLiveModels: vi.fn(),
    refreshProModels: vi.fn(), refreshOpenAIModels: vi.fn(),
    refreshAnthropicModels: vi.fn(), refreshReadAloudVoices: vi.fn()
  };
  const waveOutSession = {
    play: vi.fn(),
    stop: vi.fn(),
    close: vi.fn()
  };
  let waveOutFailure: ((error: Error) => void) | undefined;
  let waveOutProgress: ((completedBuffers: number, queuedBuffers: number) => void) | undefined;
  const waveOutPlayer = {
    start: vi.fn(async (
      onError: (error: Error) => void,
      onProgress?: (completedBuffers: number, queuedBuffers: number) => void
    ) => {
      waveOutFailure = onError;
      waveOutProgress = onProgress;
      return waveOutSession;
    })
  };
  const waveInSession = { stop: vi.fn() };
  let waveInChunk: ((base64Pcm: string) => void) | undefined;
  let waveInFailure: ((error: Error) => void) | undefined;
  const waveInRecorder = {
    start: vi.fn(async (
      onChunk: (base64Pcm: string) => void,
      onError: (error: Error) => void,
      _stopTimeoutMs?: number
    ) => {
      waveInChunk = onChunk;
      waveInFailure = onError;
      return waveInSession;
    })
  };
  const provider = new KrenResultsViewProvider(
    actions as never, {} as never, undefined, dictationRecorder, socketFactory, waveOutPlayer, waveInRecorder
  );
  const internals = provider as unknown as ProviderInternals;
  internals.view = { webview: {
    html: '', cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }), postMessage
  } };
  internals.tutorState.conversation.from = 'situation';
  internals.activeScreen = 'tutor';
  internals.tutorState.conversation.situationId = TUTOR_SITUATIONS[0]!.id;
  internals.tutorState.conversation.register = 'professional';
  internals.tutorState.conversation.replies = 'liveGemini';
  // 2026-10-11: existing per-turn coaching probes explicitly select the opt-in mode.
  internals.tutorState.conversation.coaching = 'inline';
  return {
    provider, internals, actions, postMessage, generateTutor, waveOutPlayer, waveOutSession,
    waveInRecorder, waveInSession,
    emitWaveIn: (base64Pcm: string) => waveInChunk?.(base64Pcm),
    reportWaveOutProgress: (completedBuffers: number, queuedBuffers: number) =>
      waveOutProgress?.(completedBuffers, queuedBuffers),
    failWaveIn: (error: Error) => waveInFailure?.(error),
    failWaveOut: (error: Error) => waveOutFailure?.(error)
  };
}

function pcmChunk(amplitude: number): string {
  const pcm = Buffer.alloc(3200);
  for (let offset = 0; offset < pcm.length; offset += 2) pcm.writeInt16LE(amplitude, offset);
  return pcm.toString('base64');
}

async function waitForSent(socket: FakeSocket, count: number): Promise<void> {
  await vi.waitFor(() => expect(socket.sent).toHaveLength(count));
}

async function waitForLiveSession(internals: ProviderInternals): Promise<void> {
  await vi.waitFor(() => expect(internals.tutorLiveSession).toBeDefined());
}

async function openLiveConversation(internals: ProviderInternals, socket: FakeSocket): Promise<void> {
  await internals.handleMessage({ command: 'startTutorConversation' });
  // Changed 2026-09-24 after the owner chose spoken Live opening B: scene casting still
  // precedes the socket, then Gemini owns the one opening turn and its transcription.
  await waitForLiveSession(internals);
  socket.emit('open');
  await waitForSent(socket, 1);
  socket.message({ setupComplete: {} });
  await waitForSent(socket, 2);
  socket.message({ serverContent: { outputTranscription: { text: 'Welcome. ' } } });
  socket.message({ serverContent: { outputTranscription: { text: 'How can I help?' } } });
  socket.message({ serverContent: { turnComplete: true } });
  await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));
}

function tutorStopStates(postMessage: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return postMessage.mock.calls.map(([message]) => message as Record<string, unknown>)
    .filter((message) => message.command === 'tutorConversationStopState');
}

describe('Gemini Live session protocol', () => {
  beforeEach(() => {
    vi.useRealTimers();
    workspaceGet.mockImplementation((_key: string, fallback: unknown) => fallback);
  });

  // Added 2026-09-20. These package settings intentionally bypass the shared panel-setting
  // writer, but still need a bounded command that persists only their exact tutor keys.
  it('writes gender defaults only through the dedicated tutor voice setting path', async () => {
    const { internals, actions } = liveProvider(() => new FakeSocket());

    await internals.handleMessage({
      command: 'updateTutorEdgeFemaleVoice', input: 'en-AU-NatashaNeural'
    });
    await internals.handleMessage({ command: 'updateTutorGeminiMaleVoice', input: 'Charon' });

    expect(actions.updateTutorVoiceSetting).toHaveBeenNthCalledWith(
      1, 'tutor.readAloud.edgeFemaleVoice', 'en-AU-NatashaNeural'
    );
    expect(actions.updateTutorVoiceSetting).toHaveBeenNthCalledWith(
      2, 'tutor.liveMaleVoice', 'Charon'
    );
    expect(actions.updateSetting).not.toHaveBeenCalled();

    await internals.handleMessage({
      command: 'updateTutorEdgeFemaleVoice', input: 'en-US-ChristopherNeural'
    });
    expect(actions.updateTutorVoiceSetting).toHaveBeenCalledTimes(2);
  });

  // Added 2026-09-19. The owner's first real session logged "the Live server returned an
  // unreadable message": Google sends every Live message as a binary frame, the built-in
  // WebSocket delivers binary frames as Blobs by default, and this fake only ever sent text.
  it.each([
    ['Blob', (json: string) => new Blob([json])],
    ['ArrayBuffer', (json: string) => new TextEncoder().encode(json).buffer],
    ['Uint8Array', (json: string) => new TextEncoder().encode(json)]
  ] as const)('reads setup, text and audio sent as %s frames, in arrival order', async (_name, frame) => {
    const socket = new FakeSocket();
    const events: string[] = [];
    const session = new TutorLiveSession({
      apiKey: TEST_CREDENTIAL,
      model: 'gemini-3.8-live',
      systemInstruction: 'Setting.',
      socketFactory: () => socket,
      onText: (fragment) => events.push(`text:${fragment}`),
      onAudio: (chunk) => events.push(`audio:${chunk.data}`)
    });
    const send = (value: unknown) => socket.emit('message', frame(JSON.stringify(value)));

    const connected = session.connect();
    socket.emit('open');
    send({ setupComplete: {} });
    await connected;

    const turn = session.sendTurn('Hello.');
    send({ serverContent: { outputTranscription: { text: 'Hi ' } } });
    send({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAA=' } }] } } });
    send({ serverContent: { outputTranscription: { text: 'there.' } } });
    send({ serverContent: { turnComplete: true } });
    await turn;

    expect(events).toEqual(['text:Hi ', 'audio:AAA=', 'text:there.']);
  });

  it('asks the runtime for ArrayBuffer frames when it opens the real socket', () => {
    const created: Array<{ binaryType?: string }> = [];
    const original = globalThis.WebSocket;
    class RecordingSocket {
      public binaryType = 'blob';
      public readyState = 0;
      constructor() { created.push(this); }
      send(): void {}
      close(): void {}
      addEventListener(): void {}
    }
    globalThis.WebSocket = RecordingSocket as unknown as typeof WebSocket;
    try {
      defaultTutorLiveSocketFactory('wss://example.invalid');
    } finally {
      globalThis.WebSocket = original;
    }
    expect(created[0]?.binaryType).toBe('arraybuffer');
  });

  it('sends the exact setup and discrete clientContent messages and streams callbacks in order', async () => {
    const socket = new FakeSocket();
    const text: string[] = [];
    const audio: string[] = [];
    const session = new TutorLiveSession({
      apiKey: TEST_CREDENTIAL,
      model: 'gemini-3.8-live',
      systemInstruction: 'Setting: a hotel desk. Register: professional.',
      socketFactory: () => socket,
      onText: (fragment) => text.push(fragment),
      onAudio: (chunk) => audio.push(`${chunk.mimeType}:${chunk.data}`)
    });

    const connected = session.connect();
    socket.emit('open');
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      setup: {
        model: 'models/gemini-3.8-live',
        generationConfig: { responseModalities: ['AUDIO'] },
        systemInstruction: { parts: [{ text: 'Setting: a hotel desk. Register: professional.' }] },
        // Changed 2026-09-23 for V145: hands-free and Press to talk both use KREN's local
        // activity markers, so Gemini must not make a second, variably delayed turn decision.
        realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
        // Changed 2026-09-24 for V148: English is the default, and mode remains omitted so
        // the transcriber cannot tidy away the learner's disfluencies or self-corrections.
        inputAudioTranscription: { languageCodes: ['en-US'] },
        outputAudioTranscription: {},
        // Changed 2026-09-23: V141 asks Google for a session resumption handle so a goAway
        // warning can be answered with a replacement session instead of falling back to
        // Standard. An empty object opts in without resuming a previous session.
        sessionResumption: {}
      }
    });
    socket.message({ setupComplete: {} });
    await connected;

    const turn = session.sendTurn('I need a room.');
    expect(JSON.parse(socket.sent[1]!)).toEqual({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text: 'I need a room.' }] }],
        turnComplete: true
      }
    });
    socket.message({ serverContent: { outputTranscription: { text: 'Of ' } } });
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'AQI=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });
    socket.message({ serverContent: { outputTranscription: { text: 'course. ' } } });
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'AwQ=', mimeType: 'audio/pcm;rate=16000'
    } }] } } });
    socket.message({ serverContent: { outputTranscription: { text: 'Welcome.' } } });
    socket.message({ serverContent: { turnComplete: true } });
    await turn;

    expect(text).toEqual(['Of ', 'course. ', 'Welcome.']);
    expect(audio).toEqual([
      'audio/pcm;rate=24000:AQI=',
      'audio/pcm;rate=16000:AwQ='
    ]);
  });

  it('V148 returns exactly to automatic input transcription when the switch says automatic', async () => {
    const socket = new FakeSocket();
    const session = new TutorLiveSession({
      apiKey: TEST_CREDENTIAL,
      model: 'gemini-3.8-live',
      systemInstruction: 'Setting.',
      transcriptionLanguage: 'automatic',
      socketFactory: () => socket,
      onText: () => undefined,
      onAudio: () => undefined
    });

    const connected = session.connect();
    socket.emit('open');
    const setup = JSON.parse(socket.sent[0]!) as { setup: {
      inputAudioTranscription: Record<string, unknown>;
    } };
    expect(setup.setup.inputAudioTranscription).toEqual({});
    expect(setup.setup.inputAudioTranscription).not.toHaveProperty('mode');
    socket.message({ setupComplete: {} });
    await connected;
  });

  // Changed 2026-09-23 for V145: sensitivity now changes KREN's local wait, never Gemini's
  // setup. All hands-free profiles disable the remote detector that caused the measured delay.
  it('V145 disables Gemini automatic activity detection for every hands-free sensitivity', () => {
    const setupFor = (microphoneSensitivity: 'quietRoom' | 'balanced' | 'noisyRoom'): object => {
      const socket = new FakeSocket();
      const session = new TutorLiveSession({
        apiKey: TEST_CREDENTIAL,
        model: 'gemini-3.8-live',
        systemInstruction: 'A fixed instruction.',
        microphoneSensitivity,
        socketFactory: () => socket,
        onText: () => undefined,
        onAudio: () => undefined
      });
      void session.connect().catch(() => undefined);
      socket.emit('open');
      const config = JSON.parse(socket.sent[0]!).setup.realtimeInputConfig as object;
      session.close();
      return config;
    };
    const disabled = { automaticActivityDetection: { disabled: true } };

    expect(setupFor('balanced')).toEqual(disabled);
    expect(setupFor('quietRoom')).toEqual(disabled);
    expect(setupFor('noisyRoom')).toEqual(disabled);
    expect(new Set([
      JSON.stringify(setupFor('quietRoom')),
      JSON.stringify(setupFor('balanced')),
      JSON.stringify(setupFor('noisyRoom'))
    ])).toHaveLength(1);
  });

  it('times out setup and exposes no socket event text', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const ended = vi.fn();
    const session = new TutorLiveSession({
      apiKey: TEST_CREDENTIAL, model: 'gemini-3.8-live',
      systemInstruction: 'Instruction.', socketFactory: () => socket,
      setupTimeoutMs: 25, onText: vi.fn(), onAudio: vi.fn(), onEnded: ended
    });
    const connected = session.connect();
    const rejected = expect(connected).rejects.toMatchObject({ code: 'setupTimeout' });
    socket.emit('open');
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(ended).toHaveBeenCalledWith(expect.objectContaining({
      message: 'setupComplete did not arrive before the timeout'
    }));
  });

  it.each([
    ['serverError', { error: { message: 'do not expose this body' } }]
  ] as const)('closes safely on %s', async (code, message) => {
    const socket = new FakeSocket();
    const ended = vi.fn();
    const session = new TutorLiveSession({
      apiKey: TEST_CREDENTIAL, model: 'gemini-3.8-live', systemInstruction: 'Instruction.',
      socketFactory: () => socket, onText: vi.fn(), onAudio: vi.fn(), onEnded: ended
    });
    const connected = session.connect();
    socket.emit('open');
    socket.message({ setupComplete: {} });
    await connected;
    socket.message(message);
    expect(ended).toHaveBeenCalledWith(expect.objectContaining({ code }));
    expect(socket.closeCalls).toBe(1);
  });

  it('V141 resumes on goAway and buffers microphone audio until the replacement is ready', async () => {
    // Added 2026-09-23 for V15: goAway is advance notice, not a terminal server error.
    const sockets = [new FakeSocket(), new FakeSocket()];
    const factory = vi.fn(() => sockets[factory.mock.calls.length - 1]!);
    const ended = vi.fn();
    const session = new TutorLiveSession({
      apiKey: TEST_CREDENTIAL, model: 'gemini-3.8-live', systemInstruction: 'Instruction.',
      socketFactory: factory, onText: vi.fn(), onAudio: vi.fn(), onEnded: ended
    });
    const connected = session.connect();
    sockets[0]!.emit('open');
    sockets[0]!.message({ setupComplete: {} });
    await connected;
    sockets[0]!.message({
      sessionResumptionUpdate: { resumable: true, newHandle: 'opaque-session-handle' }
    });

    sockets[0]!.message({ goAway: { timeLeft: '60s' } });
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(2));
    session.sendAudio('AQI=');
    expect(sockets[0]!.sent).toHaveLength(1);
    expect(sockets[0]!.closeCalls).toBe(0);
    expect(ended).not.toHaveBeenCalled();

    sockets[1]!.emit('open');
    expect(JSON.parse(sockets[1]!.sent[0]!).setup.sessionResumption).toEqual({
      handle: 'opaque-session-handle'
    });
    sockets[1]!.message({ setupComplete: {} });
    await vi.waitFor(() => expect(sockets[1]!.sent).toHaveLength(2));
    expect(JSON.parse(sockets[1]!.sent[1]!)).toEqual({
      realtimeInput: { audio: { data: 'AQI=', mimeType: 'audio/pcm;rate=16000' } }
    });
    expect(sockets[0]!.closeCalls).toBe(1);
    expect(ended).not.toHaveBeenCalled();
  });
});

describe('V120 conversation controller', () => {
  beforeEach(() => {
    vi.useRealTimers();
    workspaceGet.mockImplementation((_key: string, fallback: unknown) => fallback);
  });

  // V124, 2026-09-19: duration-aware replay exposed the frozen Date.now spy left by
  // the queued-audio test; restore spies after every controller test.
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Added 2026-09-24 for V146: configuration is validated at the host boundary and the
  // resulting seconds reach the helper as a finite millisecond deadline.
  it.each([
    [2, 2_000],
    [8, 8_000],
    // Changed 2026-10-03: invalid values use the current default.
    [3, TUTOR_DEFAULTS.configuration['tutor.conversation.microphoneCloseWait'] * 1_000]
  ])('passes stored microphone close wait %i as %i ms', async (stored, expectedMs) => {
    workspaceGet.mockImplementation((key: string, fallback: unknown) =>
      key === 'tutor.conversation.microphoneCloseWait' ? stored : fallback
    );
    const socket = new FakeSocket();
    const { internals, waveInRecorder } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);

    await internals.toggleTutorLiveMicrophone();

    expect(waveInRecorder.start).toHaveBeenCalledWith(
      expect.any(Function), expect.any(Function), expectedMs
    );
  });

  // Added 2026-09-24 for V146: after sleep the retained button must never fail silently.
  it.each([
    ['no Live session', 'no session', (internals: ProviderInternals) => {
      internals.tutorLiveSession = undefined;
    }],
    ['the Live session failed', 'session failed', (internals: ProviderInternals) => {
      internals.tutorLiveFailed = true;
    }],
    ['the conversation is not active', 'conversation not active', (internals: ProviderInternals) => {
      internals.tutorState.conversation.status = 'stopped';
    }],
    ['Replies is not Live', 'replies not Live', (internals: ProviderInternals) => {
      internals.tutorState.conversation.replies = 'standard';
    }]
  ] as const)('names %s and reports the microphone unavailable', async (
    _condition, logName, configure
  ) => {
    const { internals, actions, postMessage, waveInRecorder } = liveProvider(() => new FakeSocket());
    internals.tutorLiveSession = {};
    internals.tutorLiveFailed = false;
    internals.tutorState.conversation.status = 'active';
    internals.tutorState.conversation.replies = 'liveGemini';
    configure(internals);

    await internals.toggleTutorLiveMicrophone();

    expect(actions.log).toHaveBeenCalledWith(
      `[conversation Live microphone refused: ${logName}]`
    );
    // 2026-10-05: R5b finding 6 exposes Standard fallback for an active Live conversation;
    // unrelated inactive-conversation and non-Live refusal patches keep their original shape.
    expect(postMessage).toHaveBeenCalledWith({
      command: 'tutorLiveTalkState', available: false, listening: false, pressToTalk: false,
      ...(logName === 'no session' || logName === 'session failed'
        ? { standardFallback: true, dictationProvider: undefined, dictationUnavailable: true }
        : {})
    });
    expect(waveInRecorder.start).not.toHaveBeenCalled();
  });

  it('routes a retained Live button with no session through Standard dictation', async () => {
    const recording = { cancel: vi.fn(async () => undefined), finish: vi.fn() };
    const recorder = { start: vi.fn(async () => recording) };
    const socketFactory = vi.fn(() => new FakeSocket());
    const { internals, actions, postMessage } = liveProvider(socketFactory, recorder);
    workspaceGet.mockImplementation((key: string, fallback: unknown) => key === 'tutor.speechProvider' ? 'gemini' : fallback);
    actions.settings.mockReturnValue({ ...PANEL_SETTINGS_FIXTURE, credentialPresence: { geminiDefault: true } });
    internals.tutorLiveSession = undefined;
    internals.tutorState.conversation.status = 'active';
    internals.tutorState.conversation.replies = 'liveGemini';

    await internals.handleMessage({ command: 'dictateTutorConversation' });

    // 2026-10-05: R5b findings 2 and 6 use the displayed Standard route after Live closes.
    expect(actions.log).not.toHaveBeenCalledWith(
      '[conversation Live microphone refused: no session]'
    );
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'tutorDictationState', conversation: true, state: 'recording', provider: 'gemini'
    }));
    expect(recorder.start).toHaveBeenCalledTimes(1);
    expect(actions.transcribeTutorAudio).toHaveBeenCalledTimes(0);
    expect(actions.generateTutor).toHaveBeenCalledTimes(0);
    expect(socketFactory).toHaveBeenCalledTimes(0);
    (internals as unknown as KrenResultsViewProvider).dispose();
    expect(recording.cancel).toHaveBeenCalledTimes(1);
  });

  // Added 2026-09-23 for V145: a gate opening owns one activity marker even though it may
  // release pre-roll plus many open-gate chunks. Closed-gate sound creates no wire traffic.
  it('starts hands-free activity once when speech opens the gate and sends no synthetic silence', async () => {
    // Changed 2026-10-03: explicitly exercise KREN's manual activity gate.
    const previousGet = workspaceGet.getMockImplementation()!;
    workspaceGet.mockImplementation((key: string, fallback: unknown) =>
      key === 'tutor.conversation.speechDetection' ? 'kren' : previousGet(key, fallback));
    const socket = new FakeSocket();
    const { internals, emitWaveIn } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    vi.useFakeTimers({ now: 1_000 });
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    const messages = () => socket.sent.map((message) => JSON.parse(message));

    for (let index = 0; index < 10; index += 1) emitWaveIn(pcmChunk(90));
    expect(messages().filter((message) => message.realtimeInput?.audio)).toHaveLength(0);
    expect(messages().filter((message) => message.realtimeInput?.activityStart)).toHaveLength(0);

    // Changed 2026-10-02: V183 requires two loud chunks for hands-free speech.
    emitWaveIn(pcmChunk(400));
    emitWaveIn(pcmChunk(400));
    expect(messages().filter((message) => message.realtimeInput?.activityStart)).toHaveLength(1);
    expect(messages().filter((message) => message.realtimeInput?.audio)).toHaveLength(3);
    emitWaveIn(pcmChunk(500));
    emitWaveIn(pcmChunk(600));
    expect(messages().filter((message) => message.realtimeInput?.activityStart)).toHaveLength(1);
    expect(messages().filter((message) => message.realtimeInput?.audio)).toHaveLength(5);
  });

  // Changed 2026-09-23 for V145: KREN owns the hands-free turn boundary. The silence window
  // starts when the gate closes after hangover, so a shorter mid-sentence pause stays in one turn.
  it('ends a hands-free turn only after the gate stays closed for the silence window', async () => {
    // Changed 2026-10-03: explicitly exercise KREN's manual activity gate.
    const previousGet = workspaceGet.getMockImplementation()!;
    workspaceGet.mockImplementation((key: string, fallback: unknown) =>
      key === 'tutor.conversation.speechDetection' ? 'kren' : previousGet(key, fallback));
    const socket = new FakeSocket();
    const { internals, waveInRecorder, emitWaveIn } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    expect(waveInRecorder.start).not.toHaveBeenCalled();

    vi.useFakeTimers({ now: 1_000 });
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    expect(waveInRecorder.start).toHaveBeenCalledOnce();
    const activityMessages = (name: 'activityStart' | 'activityEnd') =>
      socket.sent.map((message) => JSON.parse(message))
        .filter((message) => message.realtimeInput?.[name]);

    // Changed 2026-10-02: V183 requires two loud chunks for hands-free speech.
    emitWaveIn(pcmChunk(400));
    emitWaveIn(pcmChunk(400));
    await vi.advanceTimersByTimeAsync(301);
    emitWaveIn(pcmChunk(90));
    await vi.advanceTimersByTimeAsync(799);
    // Changed 2026-10-02: V183 requires two loud chunks for hands-free speech.
    emitWaveIn(pcmChunk(400));
    emitWaveIn(pcmChunk(400));
    expect(activityMessages('activityEnd')).toHaveLength(0);
    expect(activityMessages('activityStart')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(301);
    emitWaveIn(pcmChunk(90));
    // Changed 2026-10-02: the default pause is 2 seconds from the last loud chunk.
    await vi.advanceTimersByTimeAsync(1_698);
    expect(activityMessages('activityEnd')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(activityMessages('activityEnd')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    emitWaveIn(pcmChunk(90));
    expect(activityMessages('activityEnd')).toHaveLength(1);
    // Changed 2026-10-02: V183 requires two loud chunks for hands-free speech.
    emitWaveIn(pcmChunk(400));
    emitWaveIn(pcmChunk(400));
    expect(activityMessages('activityStart')).toHaveLength(2);
  });

  it('keeps an untranscribed noise turn from adding a visible or audible Live reply', async () => {
    // Changed 2026-10-03: explicitly exercise KREN's manual activity gate.
    const previousGet = workspaceGet.getMockImplementation()!;
    workspaceGet.mockImplementation((key: string, fallback: unknown) =>
      key === 'tutor.conversation.speechDetection' ? 'kren' : previousGet(key, fallback));
    const socket = new FakeSocket();
    const { internals, actions, postMessage, waveOutSession, emitWaveIn } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'updateTutorConversationAnswer', answer: 'A real answer.' });
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    await waitForSent(socket, 3);
    socket.message({ serverContent: { outputTranscription: { text: 'The stored reply.' } } });
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));
    expect(internals.tutorState.conversation.transcript[0]?.reply).toBe('The stored reply.');

    vi.useFakeTimers({ now: 1_000 });
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    postMessage.mockClear();
    waveOutSession.play.mockClear();
    // Changed 2026-10-02: V183 requires two loud chunks for hands-free speech.
    emitWaveIn(pcmChunk(1_000));
    emitWaveIn(pcmChunk(1_000));
    await vi.advanceTimersByTimeAsync(301);
    emitWaveIn(pcmChunk(0));
    // Changed 2026-10-02: wait for the new default Live pause, including hangover.
    await vi.advanceTimersByTimeAsync(1_699);
    const wire = socket.sent.map((message) => JSON.parse(message));
    expect(wire.filter((message) => message.realtimeInput?.activityStart)).toHaveLength(1);
    expect(wire.filter((message) => message.realtimeInput?.activityEnd)).toHaveLength(1);

    socket.message({ serverContent: { outputTranscription: { text: 'An unsolicited extra question?' } } });
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'AQI=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });
    socket.message({ serverContent: { turnComplete: true } });
    expect(internals.tutorLiveReplyText).toBe('The stored reply.');
    expect(internals.tutorState.conversation.currentQuestion).toBe('The stored reply.');
    expect(internals.tutorState.conversation.transcript).toHaveLength(1);
    expect(postMessage.mock.calls.map(([message]) => message as Record<string, unknown>)
      .filter((message) => message.command === 'tutorLiveReplyFragment')).toEqual([]);
    expect(waveOutSession.play).not.toHaveBeenCalled();
    // A held-back reply leaves one line, so a reader who hears nothing can see why.
    expect(actions.log).toHaveBeenCalledWith('[conversation Live] Held back a reply that no learner turn asked for.');
  });

  it('answers speech after an untranscribed gate opening and a quiet wait', async () => {
    const socket = new FakeSocket();
    const { internals, postMessage, emitWaveIn } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    vi.useFakeTimers({ now: 1_000 });
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    emitWaveIn(pcmChunk(1_000));
    await vi.advanceTimersByTimeAsync(301);
    emitWaveIn(pcmChunk(0));
    // Changed 2026-10-02: wait for the new default Live pause, including hangover.
    await vi.advanceTimersByTimeAsync(1_699);
    socket.message({ serverContent: { outputTranscription: { text: 'Unasked question.' } } });
    socket.message({ serverContent: { turnComplete: true } });

    postMessage.mockClear();
    emitWaveIn(pcmChunk(1_000));
    socket.message({ serverContent: { inputTranscription: { text: 'I need some flour.' } } });
    socket.message({ serverContent: { outputTranscription: { text: 'The next delivery is Wednesday.' } } });
    socket.message({ serverContent: { turnComplete: true } });
    expect(internals.tutorState.conversation.transcript).toHaveLength(1);
    expect(internals.tutorState.conversation.transcript[0]).toMatchObject({
      learnerAnswer: 'I need some flour.', reply: 'The next delivery is Wednesday.'
    });
    expect(postMessage.mock.calls.map(([message]) => message as Record<string, unknown>))
      // Changed 2026-10-04: highlight ranges accompany the same streamed text and reset boundary.
      .toContainEqual(expect.objectContaining({
        command: 'tutorLiveReplyFragment', text: 'The next delivery is Wednesday.', reset: true
      }));
  });

  // Changed 2026-10-02 for V186: sensitivity cannot decide Live's pause, and hangover
  // plus delayed observation of a closed gate count inside the chosen 3 seconds.
  it.each([
    ['quietRoom', 300], ['balanced', 301], ['noisyRoom', 450]
  ] as const)('V186 ends the 3-second pause at 3,000 ms with %s and gate close at %i ms', async (
    sensitivity, closedAt
  ) => {
    workspaceGet.mockImplementation((key: string, fallback: unknown) =>
      key === 'tutor.conversation.microphoneSensitivity' ? sensitivity :
        key === 'tutor.conversation.pauseBeforeReply' ? 3 : fallback
    );
    // Changed 2026-10-03: explicitly exercise KREN's manual activity gate.
    const previousGet = workspaceGet.getMockImplementation()!;
    workspaceGet.mockImplementation((key: string, fallback: unknown) =>
      key === 'tutor.conversation.speechDetection' ? 'kren' : previousGet(key, fallback));
    const socket = new FakeSocket();
    const { internals, emitWaveIn } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    vi.useFakeTimers({ now: 1_000 });
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    const activityEnds = () => socket.sent.map((message) => JSON.parse(message))
      .filter((message) => message.realtimeInput?.activityEnd);

    // Changed 2026-10-02: V183 requires two loud chunks for hands-free speech.
    emitWaveIn(pcmChunk(1_000));
    emitWaveIn(pcmChunk(1_000));
    await vi.advanceTimersByTimeAsync(closedAt);
    emitWaveIn(pcmChunk(0));
    await vi.advanceTimersByTimeAsync(2_999 - closedAt);
    expect(activityEnds()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(activityEnds()).toHaveLength(1);
  });

  it('V186 cancels the 3-second activity end when speech returns at 2,900 ms', async () => {
    workspaceGet.mockImplementation((key: string, fallback: unknown) =>
      key === 'tutor.conversation.pauseBeforeReply' ? 3 : fallback
    );
    // Changed 2026-10-03: explicitly exercise KREN's manual activity gate.
    const previousGet = workspaceGet.getMockImplementation()!;
    workspaceGet.mockImplementation((key: string, fallback: unknown) =>
      key === 'tutor.conversation.speechDetection' ? 'kren' : previousGet(key, fallback));
    const socket = new FakeSocket();
    const { internals, emitWaveIn } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    vi.useFakeTimers({ now: 1_000 });
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    const activities = (name: string) => socket.sent.map((message) => JSON.parse(message))
      .filter((message) => message.realtimeInput?.[name]);
    emitWaveIn(pcmChunk(1_000));
    emitWaveIn(pcmChunk(1_000));
    await vi.advanceTimersByTimeAsync(300);
    emitWaveIn(pcmChunk(0));
    await vi.advanceTimersByTimeAsync(2_600);
    emitWaveIn(pcmChunk(1_000));
    emitWaveIn(pcmChunk(1_000));
    await vi.advanceTimersByTimeAsync(300);
    emitWaveIn(pcmChunk(0));
    expect(activities('activityEnd')).toHaveLength(0);
    expect(activities('activityStart')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_699);
    expect(activities('activityEnd')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(activities('activityEnd')).toHaveLength(1);
  });

  it.each([1, 2, 3, 4, 5, 0, 6, 2.5, '3', true, undefined])(
    'V186 restores stored pause %s with invalid values falling back to 2', async (stored) => {
      workspaceGet.mockImplementation((key: string, fallback: unknown) =>
        key === 'tutor.conversation.pauseBeforeReply' ? stored : fallback
      );
      const socket = new FakeSocket();
      const { internals } = liveProvider(() => socket);
      await openLiveConversation(internals, socket);
      const expected = typeof stored === 'number' && [1, 2, 3, 4, 5].includes(stored) ? stored : 2;
      expect(internals.tutorLivePauseBeforeReply).toBe(expected);
      internals.refresh();
      const $ = load(internals.view!.webview.html);
      expect($('[data-setting="tutor.conversation.pauseBeforeReply"]').val()).toBe(String(expected));
    }
  );

  it('V186 stores a pause in place, freezes the current turn, and recaptures on Back to chat', async () => {
    let stored = 3;
    workspaceGet.mockImplementation((key: string, fallback: unknown) =>
      key === 'tutor.conversation.pauseBeforeReply' ? stored : fallback
    );
    // Changed 2026-10-03: explicitly exercise KREN's manual activity gate.
    const previousGet = workspaceGet.getMockImplementation()!;
    workspaceGet.mockImplementation((key: string, fallback: unknown) =>
      key === 'tutor.conversation.speechDetection' ? 'kren' : previousGet(key, fallback));
    const sockets = [new FakeSocket(), new FakeSocket()];
    let opened = 0;
    const { internals, actions, postMessage, emitWaveIn } = liveProvider(() => sockets[opened++]!);
    actions.updateSetting.mockImplementation(async (_key: unknown, value: unknown) => { stored = Number(value); });
    await openLiveConversation(internals, sockets[0]!);
    internals.view!.webview.html = 'active panel with an unfinished answer';
    await internals.handleMessage({ command: 'updateSetting', key: 'tutor.conversation.pauseBeforeReply', value: '4' });
    expect(actions.updateSetting).toHaveBeenCalledWith('tutor.conversation.pauseBeforeReply', 4);
    expect(internals.tutorLivePauseBeforeReply).toBe(3);
    expect(internals.view!.webview.html).toBe('active panel with an unfinished answer');
    expect(postMessage).toHaveBeenCalledWith({ command: 'tutorConversationPauseBeforeReply', seconds: 4 });
    vi.useFakeTimers({ now: 1_000 });
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    emitWaveIn(pcmChunk(1_000));
    emitWaveIn(pcmChunk(1_000));
    await vi.advanceTimersByTimeAsync(300);
    emitWaveIn(pcmChunk(0));
    await vi.advanceTimersByTimeAsync(2_700);
    expect(sockets[0]!.sent.map((message) => JSON.parse(message))
      .filter((message) => message.realtimeInput?.activityEnd)).toHaveLength(1);
    vi.useRealTimers();
    await internals.handleMessage({ command: 'stopTutorConversation' });
    await internals.handleMessage({ command: 'resumeTutorConversation' });
    await vi.waitFor(() => expect(opened).toBe(2));
    expect(internals.tutorLivePauseBeforeReply).toBe(4);
    sockets[1]!.emit('open');
    await waitForSent(sockets[1]!, 1);
    sockets[1]!.message({ setupComplete: {} });
    await vi.waitFor(() => expect(internals.tutorLiveSession).toBeDefined());
    const second = liveProvider(() => new FakeSocket());
    second.internals.refresh();
    expect(load(second.internals.view!.webview.html)('[data-setting="tutor.conversation.pauseBeforeReply"]').val()).toBe('4');
  });

  it('V127 records the three learner-bubble latency points and announces hearing at first forward', async () => {
    let now = 10_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const socket = new FakeSocket();
    const { internals, postMessage, emitWaveIn } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    postMessage.mockClear();

    for (let index = 0; index < 10; index += 1) {
      now += 100;
      emitWaveIn(pcmChunk(90));
    }
    now += 100;
    // Changed 2026-10-02: V183 requires two loud chunks for hands-free speech.
    emitWaveIn(pcmChunk(400));
    emitWaveIn(pcmChunk(400));
    expect(postMessage).toHaveBeenCalledWith({ command: 'tutorLiveInputStarted' });
    expect(internals.tutorLiveInputLatency?.firstMicrophoneForwardedAt).toBe(11_100);

    now += 2;
    await internals.handleMessage({ command: 'tutorLiveInputBubblePatched' });
    now += 648;
    socket.message({ serverContent: { inputTranscription: { text: 'The first words.' } } });
    expect(internals.tutorLiveInputLatency?.firstInputFragmentAt).toBe(11_750);

    // V135: the provider owns the delay after speech ends, but KREN must forward the final
    // fragment to the panel synchronously when it arrives instead of collecting the turn.
    const speechEndedAt = 11_400;
    now += 150;
    socket.message({ serverContent: { inputTranscription: { text: ' Last words.' } } });
    expect(postMessage).toHaveBeenCalledWith({
      command: 'tutorLiveInputFragment', text: ' Last words.', reset: false
    });
    const lastFragmentArrivedAt = now;
    expect(lastFragmentArrivedAt - speechEndedAt).toBe(500);

    expect(internals.tutorLiveInputLatency).toEqual({
      firstMicrophoneForwardedAt: 11_100,
      firstInputFragmentAt: 11_750,
      learnerBubblePatchedAt: 11_102
    });
  });

  it('V183 measures the two-chunk gate delay for a loud first turn and a later turn separately', async () => {
    let now = 20_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const socket = new FakeSocket();
    const { internals, emitWaveIn } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });

    const firstSpeechAt = now;
    emitWaveIn(pcmChunk(400));
    // Changed 2026-10-02: The second chunk confirms speech 100 ms later.
    now += 100;
    emitWaveIn(pcmChunk(400));
    const firstTurnDelay = internals.tutorLiveInputLatency!.firstMicrophoneForwardedAt! -
      firstSpeechAt;
    expect(firstTurnDelay).toBe(100);

    // Finish calibration without rebuilding the gate, as happens between turns in one session.
    for (let index = 0; index < 9; index += 1) {
      now += 100;
      emitWaveIn(pcmChunk(90));
    }
    internals.beginTutorLiveReply();
    now += 1_000;
    const laterSpeechAt = now;
    emitWaveIn(pcmChunk(400));
    // Changed 2026-10-02: The second chunk confirms speech 100 ms later.
    now += 100;
    emitWaveIn(pcmChunk(400));
    const laterTurnDelay = internals.tutorLiveInputLatency!.firstMicrophoneForwardedAt! -
      laterSpeechAt;
    expect(laterTurnDelay).toBe(100);
  });

  // Added 2026-09-19 to finish V123: every way out of a Live conversation must turn the
  // reader's microphone off, not only the Talk button.
  it.each([
    ['Stop', async (internals: ProviderInternals) => {
      await internals.handleMessage({ command: 'stopTutorConversation' });
    }],
    ['Replies set to Standard', async (internals: ProviderInternals) => {
      await internals.handleMessage({ command: 'updateTutorConversationReplies', input: 'standard' });
    }],
    ['a Live fallback', async (_internals: ProviderInternals, socket: FakeSocket) => {
      socket.message({ goAway: { timeLeft: '1s' } });
    }],
    ['closing the panel', async (_internals: ProviderInternals, _socket: FakeSocket,
      provider: { dispose(): void }) => {
      provider.dispose();
    }],
    ['hiding KREN', async (_internals: ProviderInternals, _socket: FakeSocket,
      provider: { hide(): Promise<void> }) => {
      await provider.hide().catch(() => undefined);
    }]
  ] as const)('turns the Talk microphone off on %s', async (_name, close) => {
    const socket = new FakeSocket();
    const { provider, internals, waveInSession, emitWaveIn } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    expect(waveInSession.stop).not.toHaveBeenCalled();
    await close(internals, socket, provider as never);
    expect(waveInSession.stop).toHaveBeenCalledOnce();
    const sent = socket.sent.length;
    emitWaveIn('AQI=');
    expect(socket.sent.length).toBe(sent);
  });

  it('V128 closes Live capture, socket and playback before Reset replaces the conversation', async () => {
    const socket = new FakeSocket();
    const {
      internals, waveInSession, waveOutSession, emitWaveIn
    } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    showWarningMessage.mockResolvedValueOnce('Reset panel');

    await internals.handleMessage({ command: 'resetTutorSession' });

    expect(waveInSession.stop).toHaveBeenCalledOnce();
    expect(socket.closeCalls).toBe(1);
    expect(waveOutSession.stop).toHaveBeenCalled();
    expect(waveOutSession.close).toHaveBeenCalledOnce();
    const sentAfterReset = socket.sent.length;
    emitWaveIn(pcmChunk(2_000));
    expect(socket.sent).toHaveLength(sentAfterReset);
    expect(internals.tutorState.conversation.status).toBe('idle');
  });

  // Changed 2026-09-19: V124 replaces the unknown server default with explicit Kore.
  it('migrates an empty voice to Kore and sends every chosen voice explicitly', async () => {
    const first = new FakeSocket();
    const { internals } = liveProvider(() => first);
    internals.tutorState.conversation.liveVoice = '';
    await internals.handleMessage({ command: 'startTutorConversation' });
    await waitForLiveSession(internals);
    first.emit('open');
    await waitForSent(first, 1);
    expect(internals.tutorState.conversation.liveVoice).toBe('Kore');
    expect(JSON.parse(first.sent[0]!).setup.generationConfig).toEqual({
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
    });

    const second = new FakeSocket();
    const chosen = liveProvider(() => second);
    await chosen.internals.handleMessage({ command: 'updateTutorConversationLiveVoice', input: 'Kore' });
    await chosen.internals.handleMessage({ command: 'updateTutorConversationLiveVoice', input: 'NotAVoice' });
    expect(chosen.internals.tutorState.conversation.liveVoice).toBe('Kore');
    await chosen.internals.handleMessage({ command: 'startTutorConversation' });
    await waitForLiveSession(chosen.internals);
    second.emit('open');
    await waitForSent(second, 1);
    expect(JSON.parse(second.sent[0]!).setup.generationConfig).toEqual({
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
    });
  });

  it('asks Gemini for the next question on Skip instead of replaying the last message', async () => {
    const socket = new FakeSocket();
    const { internals, actions, waveOutSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAA=' } }] } } });
    // 2026-09-26: Finish this unsolicited output before Skip starts its own requested turn.
    socket.message({ serverContent: { turnComplete: true } });
    waveOutSession.play.mockClear();

    await internals.handleMessage({ command: 'skipTutorConversationTurn' });
    // Changed 2026-09-24 after the owner chose spoken Live opening B: Skip follows the
    // session-owned opening turn.
    await waitForSent(socket, 3);
    const skip = JSON.parse(socket.sent[2]!).clientContent;
    expect(skip.turnComplete).toBe(true);
    expect(skip.turns[0].parts.at(-1).text).toContain('the learner skipped your last question');
    expect(waveOutSession.play).not.toHaveBeenCalled();

    socket.message({ serverContent: { outputTranscription: { text: 'No problem. Where is the leak?' } } });
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));
    const conversation = internals.tutorState.conversation;
    expect(conversation.transcript.at(-1)).toMatchObject({
      question: 'Welcome. How can I help?', skipped: true, nextQuestion: 'No problem. Where is the leak?'
    });
    expect(conversation.currentQuestion).toBe('No problem. Where is the leak?');
    expect(actions.readAloudText).not.toHaveBeenCalled();
  });

  it('reopens the Live session on Back to chat with the exchange so far, and no new opening', async () => {
    const sockets = [new FakeSocket(), new FakeSocket()];
    let opened = 0;
    const { internals, postMessage } = liveProvider(() => sockets[opened++]!);
    // Changed 2026-09-25 for V157: Live keeps the length fixed in its opening system
    // instruction, including when Back to chat creates a resumed session.
    internals.tutorState.conversation.replyLength = 'long';
    await openLiveConversation(internals, sockets[0]!);
    expect(JSON.parse(sockets[0]!.sent[0]!).setup.systemInstruction.parts[0].text)
      .toContain("Keep KREN's entire reply to up to five sentences");
    await internals.handleMessage({ command: 'stopTutorConversation' });
    expect(sockets[0]!.closeCalls).toBe(1);

    await internals.handleMessage({ command: 'updateTutorConversationReplyLength', input: 'brief' });

    postMessage.mockClear();
    await internals.handleMessage({ command: 'resumeTutorConversation' });
    await vi.waitFor(() => expect(opened).toBe(2));
    // Changed 2026-09-26 for V163: Back to chat makes Stop available during reconnect.
    expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: false, title: 'Stop conversation'
    });
    const socket = sockets[1]!;
    socket.emit('open');
    await waitForSent(socket, 1);
    const instruction = JSON.parse(socket.sent[0]!).setup.systemInstruction.parts[0].text as string;
    expect(instruction).toContain('Do not open it again');
    expect(instruction).toContain("Keep KREN's entire reply to up to five sentences");
    expect(instruction).not.toContain("Keep KREN's entire reply to one sentence");
    expect(instruction).toContain('"speaker":"KREN","text":"Welcome. How can I help?"');
    postMessage.mockClear();
    socket.message({ setupComplete: {} });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'tutorLiveTalkState', available: true })
    ));
    await vi.waitFor(() => expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: false, title: 'Stop conversation'
    }));
    expect(socket.sent).toHaveLength(1);
    expect(internals.tutorState.conversation.status).toBe('active');
  });

  it('V163 stops a Live reopen before setup completes and ignores its late socket', async () => {
    const sockets = [new FakeSocket(), new FakeSocket()];
    let opened = 0;
    const { internals, postMessage, waveOutSession } = liveProvider(() => sockets[opened++]!);
    await openLiveConversation(internals, sockets[0]!);
    await internals.handleMessage({ command: 'stopTutorConversation' });
    postMessage.mockClear();
    await internals.handleMessage({ command: 'resumeTutorConversation' });
    await vi.waitFor(() => expect(opened).toBe(2));
    expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: false, title: 'Stop conversation'
    });
    await internals.handleMessage({ command: 'stopTutorConversation' });
    sockets[1]!.emit('open');
    sockets[1]!.message({ setupComplete: {} });
    expect(internals.tutorState.conversation.status).toBe('stopped');
    expect(internals.tutorLiveSession).toBeUndefined();
    expect(sockets[1]!.closeCalls).toBeGreaterThan(0);
    expect(waveOutSession.play).not.toHaveBeenCalled();
  });

  it('V163 keeps Stop available through Live situation narration and stops its audio', async () => {
    const socket = new FakeSocket();
    const { internals, postMessage, waveOutSession } = liveProvider(() => socket);
    await internals.handleMessage({ command: 'startTutorConversation' });
    await waitForLiveSession(internals);
    socket.emit('open');
    await waitForSent(socket, 1);
    socket.message({ setupComplete: {} });
    await waitForSent(socket, 2);
    postMessage.mockClear();
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      mimeType: 'audio/pcm;rate=24000', data: 'AAA='
    } }] } } });
    expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: false, title: 'Stop conversation'
    });
    await internals.handleMessage({ command: 'stopTutorConversation' });
    expect(internals.tutorState.conversation.status).toBe('stopped');
    expect(internals.tutorLiveSession).toBeUndefined();
    expect(waveOutSession.stop).toHaveBeenCalled();
  });

  it('V141 keeps Live after goAway and falls back once with one sentence only if resumption fails', async () => {
    // Added 2026-09-23 for V15: a failed replacement, not the warning itself, owns fallback.
    const first = new FakeSocket();
    const socketFactory = vi.fn(() => {
      if (socketFactory.mock.calls.length === 1) return first;
      throw new Error('replacement detail must stay private');
    });
    const { internals, actions, generateTutor } = liveProvider(socketFactory);
    await openLiveConversation(internals, first);
    first.message({
      sessionResumptionUpdate: { resumable: true, newHandle: 'opaque-session-handle' }
    });
    actions.log.mockClear();
    actions.notify.mockClear();

    first.message({ goAway: { timeLeft: '60s' } });
    await vi.waitFor(() => expect(internals.tutorLiveFailed).toBe(true));
    first.emit('close');

    const fallbackLines = actions.log.mock.calls.flat().filter((line: unknown) =>
      String(line).includes('[conversation Live fallback: session ended]')
    );
    expect(fallbackLines).toHaveLength(1);
    expect(fallbackLines[0]).not.toContain('replacement detail');
    expect(actions.notify).toHaveBeenCalledTimes(1);
    expect(actions.notify).toHaveBeenCalledWith(
      // 2026-10-11: Every failed Live session explains the spoken Standard fallback.
      'warning', expect.stringMatching(/Live.*Standard replies/iu)
    );
    // Changed 2026-09-24 for V150: Live uses exactly the same one structured opening request
    // as Standard. Reconnection must not add another one.
    expect((generateTutor.mock.calls as Array<[TutorStructuredGenerationRequest]>).filter(
      ([request]) => request.kind === 'conversationOpening'
    )).toHaveLength(1);
  });

  // Added 2026-09-20 for V125 item 2. Back to chat has no opening turn, so its reopen
  // finishes before a slower PowerShell waveOut helper is ready. The helper belongs to the
  // current Live session, not to the already-finished reopen controller.
  it('keeps a Back to chat player that resolves after reopen and sends the next reply to it', async () => {
    const sockets = [new FakeSocket(), new FakeSocket()];
    let opened = 0;
    const { internals, waveOutPlayer } = liveProvider(() => sockets[opened++]!);
    await openLiveConversation(internals, sockets[0]!);
    await internals.handleMessage({ command: 'stopTutorConversation' });

    const latePlayer = { play: vi.fn(), stop: vi.fn(), close: vi.fn() };
    let resolvePlayer!: (player: typeof latePlayer) => void;
    const delayedPlayer = new Promise<typeof latePlayer>((resolve) => { resolvePlayer = resolve; });
    waveOutPlayer.start.mockImplementationOnce(async () => delayedPlayer);

    await internals.handleMessage({ command: 'resumeTutorConversation' });
    await vi.waitFor(() => expect(opened).toBe(2));
    const resumedSocket = sockets[1]!;
    resumedSocket.emit('open');
    await waitForSent(resumedSocket, 1);
    resumedSocket.message({ setupComplete: {} });
    await vi.waitFor(() => expect(internals.tutorLiveResumeController).toBeUndefined());

    resolvePlayer(latePlayer);
    await vi.waitFor(() => expect(latePlayer.close).not.toHaveBeenCalled());
    internals.tutorState.conversation.draftAnswer = 'Please continue.';
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    await waitForSent(resumedSocket, 2);
    resumedSocket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'AQI=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });

    await vi.waitFor(() => expect(latePlayer.play).toHaveBeenCalledWith({
      data: 'AQI=', mimeType: 'audio/pcm;rate=24000'
    }));
  });

  it('previews Gemini in one Live session, plays it, closes it, and exposes no credential', async () => {
    const socket = new FakeSocket();
    const { internals, actions, waveOutPlayer, waveOutSession } = liveProvider(() => socket);
    const preview = internals.handleMessage({ command: 'previewTutorGeminiVoice' });
    await vi.waitFor(() => expect(waveOutPlayer.start).toHaveBeenCalledOnce());
    socket.emit('open');
    await waitForSent(socket, 1);
    socket.message({ setupComplete: {} });
    await waitForSent(socket, 2);
    expect(JSON.parse(socket.sent[1]!).clientContent.turns[0].parts[0].text)
      .toContain('Hello, I am KREN');
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'AQI=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });
    socket.message({ serverContent: { turnComplete: true } });
    await preview;

    expect(waveOutSession.play).toHaveBeenCalledWith({
      data: 'AQI=', mimeType: 'audio/pcm;rate=24000'
    });
    expect(waveOutSession.close).toHaveBeenCalledOnce();
    expect(socket.closeCalls).toBe(1);
    const outward = JSON.stringify({
      log: actions.log.mock.calls,
      notify: actions.notify.mock.calls,
      panel: internals.view?.webview.html,
      frames: socket.sent
    });
    expect(outward).not.toContain(TEST_CREDENTIAL);
  });

  it('reports one credential-safe Gemini preview failure sentence and logs its stage', async () => {
    const socket = new FakeSocket();
    const { internals, actions, waveOutPlayer } = liveProvider(() => socket);
    waveOutPlayer.start.mockRejectedValueOnce(new Error(TEST_CREDENTIAL));
    await internals.handleMessage({ command: 'previewTutorGeminiVoice' });

    expect(actions.notify).toHaveBeenCalledOnce();
    expect(actions.notify).toHaveBeenCalledWith(
      'error', 'KREN: The Gemini voice preview failed.'
    );
    expect(actions.log).toHaveBeenCalledWith(
      '[tutor Gemini voice preview failed] starting the audio player failed.'
    );
    expect(JSON.stringify([actions.notify.mock.calls, actions.log.mock.calls]))
      .not.toContain(TEST_CREDENTIAL);
  });

  it('does not reopen a Live session on Back to chat after Stop in Standard mode', async () => {
    const socketFactory = vi.fn(() => new FakeSocket());
    const { internals } = liveProvider(socketFactory);
    internals.tutorState.conversation.replies = 'standard';
    await internals.handleMessage({ command: 'startTutorConversation' });
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));
    await internals.handleMessage({ command: 'stopTutorConversation' });
    await internals.handleMessage({ command: 'resumeTutorConversation' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(socketFactory).not.toHaveBeenCalled();
  });

  it('stops the continuous microphone on the second Talk press', async () => {
    const socket = new FakeSocket();
    const { internals, waveInRecorder, waveInSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    expect(waveInRecorder.start).toHaveBeenCalledOnce();
    expect(waveInSession.stop).toHaveBeenCalledOnce();
    expect(socket.sent.map((message) => JSON.parse(message)))
      .not.toContainEqual({ realtimeInput: { audioStreamEnd: true } });
  });

  // Added 2026-09-20: V126 manual activity begins only after the helper is ready, ends on
  // the second explicit press, and cannot forward any helper output outside that interval.
  it('marks a Press to talk turn and forwards audio only between its two presses', async () => {
    workspaceGet.mockImplementation((key: string, fallback: unknown) =>
      key === 'tutor.conversation.pressToTalk' ? true : fallback
    );
    const socket = new FakeSocket();
    const { internals, waveInRecorder, waveInSession, emitWaveIn } = liveProvider(() => socket);
    await internals.handleMessage({ command: 'startTutorConversation' });
    await waitForLiveSession(internals);
    socket.emit('open');
    await waitForSent(socket, 1);
    expect(JSON.parse(socket.sent[0]!).setup.realtimeInputConfig).toEqual({
      automaticActivityDetection: { disabled: true }
    });
    socket.message({ setupComplete: {} });
    await waitForSent(socket, 2);
    socket.message({ serverContent: { outputTranscription: { text: 'Welcome.' } } });
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));
    // Changed 2026-09-24 after the owner chose spoken Live opening B: setup and the one
    // session-owned opening turn finish before Press to talk becomes available.
    expect(socket.sent).toHaveLength(2);
    workspaceGet.mockImplementation((_key: string, fallback: unknown) => fallback);

    emitWaveIn(pcmChunk(2_000));
    expect(socket.sent).toHaveLength(2);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    expect(waveInRecorder.start).toHaveBeenCalledOnce();
    expect(JSON.parse(socket.sent[2]!)).toEqual({ realtimeInput: { activityStart: {} } });
    for (let index = 0; index < 10; index += 1) emitWaveIn(pcmChunk(100));
    // V143, 2026-09-23: manual activity detection needs no synthetic silence. Quiet chunks
    // suppressed by the gate still produce no socket messages between the two button presses.
    expect(socket.sent).toHaveLength(3);
    emitWaveIn(pcmChunk(400));
    expect(socket.sent.slice(3)).toHaveLength(3);

    await internals.handleMessage({ command: 'dictateTutorConversation' });
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ realtimeInput: { activityEnd: {} } });
    expect(waveInSession.stop).toHaveBeenCalledOnce();
    const afterEnd = socket.sent.length;
    emitWaveIn(pcmChunk(2_000));
    expect(socket.sent).toHaveLength(afterEnd);
    expect(socket.sent.map((value) => JSON.parse(value)))
      .not.toContainEqual({ realtimeInput: { audioStreamEnd: true } });
  });

  it('V156 patches Stop only around detected hands-free speech, not an open microphone', async () => {
    const socket = new FakeSocket();
    const { internals, postMessage, waveInSession, emitWaveIn } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    vi.useFakeTimers();
    postMessage.mockClear();

    await internals.handleMessage({ command: 'dictateTutorConversation' });
    expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: false, title: 'Stop conversation'
    });

    // Changed 2026-10-02: V183 needs two loud chunks before the hands-free activity starts.
    emitWaveIn(pcmChunk(400));
    emitWaveIn(pcmChunk(400));
    expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: true,
      title: 'Stop is available when you finish speaking'
    });

    await vi.advanceTimersByTimeAsync(301);
    emitWaveIn(pcmChunk(0));
    // Changed 2026-10-02: wait for the new default Live pause, including hangover.
    await vi.advanceTimersByTimeAsync(1_699);
    expect(waveInSession.stop).not.toHaveBeenCalled();
    expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: false, title: 'Stop conversation'
    });
  });

  it('V156 patches Stop around the two Press to talk presses', async () => {
    workspaceGet.mockImplementation((key: string, fallback: unknown) =>
      key === 'tutor.conversation.pressToTalk' ? true : fallback
    );
    const socket = new FakeSocket();
    const { internals, postMessage, waveInSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    postMessage.mockClear();

    await internals.handleMessage({ command: 'dictateTutorConversation' });
    expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: true,
      title: 'Stop is available when you finish speaking'
    });
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    expect(waveInSession.stop).toHaveBeenCalledOnce();
    expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: false, title: 'Stop conversation'
    });
  });

  it('V221 sends Live coaching through the Thorough profile model and configured thinking', async () => {
    const socket = new FakeSocket();
    const { internals, actions, postMessage, generateTutor } = liveProvider(() => socket);
    actions.settings.mockReturnValue({
      ...PANEL_SETTINGS_FIXTURE,
      tutorProfile: 'pro',
      tutorModel: 'gemini-default-request-model',
      tutorAlternateModel: 'gemini-alternate-request-model',
      tutorThinkingOrEffort: 'high'
    });
    // Changed 2026-09-23: teaching mode's spoken correction supplements its visible block.
    // This drives the mounted Live completion path, not only the full Standard renderer.
    internals.tutorState.conversation.coaching = 'teaching';
    internals.refresh();
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    postMessage.mockClear();

    socket.message({ serverContent: { inputTranscription: { text: 'I go ' } } });
    socket.message({ serverContent: { inputTranscription: { text: 'there yesterday.' } } });
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'AQI=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });
    socket.message({ serverContent: { outputTranscription: { text: 'Thanks for telling me.' } } });
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));

    const messages = postMessage.mock.calls.map(([message]) => message as Record<string, unknown>);
    expect(messages.filter((message) => message.command === 'tutorLiveInputFragment')).toEqual([
      { command: 'tutorLiveInputFragment', text: 'I go ', reset: true },
      { command: 'tutorLiveInputFragment', text: 'there yesterday.', reset: false }
    ]);
    // 2026-10-02: V184 adds visibility metadata; guard the committed English
    // answer and its owner without pinning unrelated message fields.
    expect(messages).toContainEqual(expect.objectContaining({
      command: 'tutorLiveInputCommitted', text: 'I go there yesterday.', index: 0,
      learnerNotShown: false
    }));
    // Changed 2026-09-23: V141 commits the turn when the reply ends and patches the
    // correction in when it returns, so this waits for the later arrival. What this test
    // guards is the route the correction request takes, asserted below and unchanged.
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript[0]).toMatchObject({
      learnerAnswer: 'I go there yesterday.',
      spoken: true,
      correction: 'I went there yesterday.',
      reply: 'Thanks for telling me.'
    }));
    const correctionCall = (generateTutor.mock.calls as unknown as Array<[
      TutorStructuredGenerationRequest,
      { model: string; thinkingOrEffort: string; geminiProfile: string }
    ]>).find(([request]) => isInlineTutorTurn(request))!;
    const [correctionRequest, route] = correctionCall;
    expect(JSON.parse(correctionRequest.input).learnerAnswer).toBe('I go there yesterday.');
    expect(correctionRequest.instruction).toContain('came from speech recognition');
    expect(route).toMatchObject({
      model: 'gemini-alternate-request-model',
      thinkingOrEffort: 'high', // 2026-10-11: correction work is Thorough.
      geminiProfile: 'pro'
    });
    expect(messages).toContainEqual(expect.objectContaining({
      command: 'tutorLiveTurnCommitted', replayAvailable: true
    }));
    // Changed 2026-09-23: the correction now travels in its own message, after the turn.
    const coachingMessages = postMessage.mock.calls.map(([message]) => message as Record<string, unknown>);
    expect(coachingMessages).toContainEqual(expect.objectContaining({
      command: 'tutorLiveTurnCoaching', correction: 'I went there yesterday.', showFeedback: true
    }));
  });

  it('V127 enables Replay after a spoken Live reply has stored audio even while the player is starting', async () => {
    const socket = new FakeSocket();
    const { internals, postMessage, waveOutPlayer } = liveProvider(() => socket);
    waveOutPlayer.start.mockImplementationOnce(() => new Promise(() => undefined));
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    postMessage.mockClear();

    socket.message({ serverContent: { inputTranscription: { text: 'I spoke this answer.' } } });
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'AQI=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });
    socket.message({ serverContent: { outputTranscription: { text: 'A spoken Live reply.' } } });
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));

    const committed = postMessage.mock.calls.map(([message]) => message as Record<string, unknown>)
      .reverse().find((message) => message.command === 'tutorLiveTurnCommitted');
    expect(internals.tutorLiveReplyAudioComplete).toBe(true);
    expect(internals.tutorLiveReplyAudio).toHaveLength(1);
    expect(internals.tutorLiveAudioPlayer).toBeUndefined();
    expect(committed).toMatchObject({ command: 'tutorLiveTurnCommitted', replayAvailable: true });
  });

  it('V147 advances one spoken Live turn exactly once from first reply fragment through commit', async () => {
    // Added 2026-09-24 for mutation probe 8. Spoken Live commits through a separate path from
    // typed Live, so both the fragment boundary and that path's final generation are asserted.
    const socket = new FakeSocket();
    const { internals } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    const generationBeforeTurn = internals.tutorConversationTurnGeneration;
    await internals.handleMessage({ command: 'dictateTutorConversation' });

    // 2026-10-02: V187 holds the reply until classification or the 1500 ms limit.
    vi.useFakeTimers();
    socket.message({ serverContent: { inputTranscription: { text: 'My spoken answer.' } } });
    socket.message({ serverContent: { outputTranscription: { text: 'The next spoken question?' } } });
    await vi.advanceTimersByTimeAsync(1500);
    vi.useRealTimers();
    expect(internals.tutorConversationTurnGeneration).toBe(generationBeforeTurn + 1);

    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));
    expect(internals.tutorConversationTurnGeneration).toBe(generationBeforeTurn + 1);
  });

  // Changed 2026-09-22: completion comes from WHDR_DONE, so a byte-count estimate can neither
  // release the microphone early nor hold it after actual playback plus the 120 ms margin.
  it('drops microphone chunks until waveOut reports idle plus the echo margin', async () => {
    let now = 10_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const socket = new FakeSocket();
    const { internals, emitWaveIn, reportWaveOutProgress } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    for (let index = 0; index < 10; index += 1) emitWaveIn(pcmChunk(90));
    const sentBeforeAudio = socket.sent.length;
    const oneHundredMilliseconds = Buffer.alloc(3200).toString('base64');

    // 2026-09-26: Playback gating applies to a reply caused by transcribed speech.
    // 2026-10-02: V187 holds the reply until classification or the 1500 ms limit.
    vi.useFakeTimers();
    socket.message({ serverContent: { inputTranscription: { text: 'A spoken answer.' } } });
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: oneHundredMilliseconds, mimeType: 'audio/pcm;rate=16000'
    } }] } } });
    await vi.advanceTimersByTimeAsync(1500);
    vi.useRealTimers();
    emitWaveIn(pcmChunk(2_000));
    now += 10_000;
    emitWaveIn(pcmChunk(2_000));
    expect(socket.sent).toHaveLength(sentBeforeAudio);
    reportWaveOutProgress(1, 0);
    now += 119;
    emitWaveIn(pcmChunk(2_000));
    expect(socket.sent).toHaveLength(sentBeforeAudio);
    now += 1;
    const unblocked = pcmChunk(2_000);
    // Changed 2026-10-02: V183 opens hands-free only on the second loud chunk.
    emitWaveIn(unblocked);
    emitWaveIn(unblocked);
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      realtimeInput: { audio: { data: unblocked, mimeType: 'audio/pcm;rate=16000' } }
    });
  });

  it('V139 checks all Live turns once on Stop when Correction is When you stop', async () => {
    const socket = new FakeSocket();
    const { internals, generateTutor, postMessage } = liveProvider(() => socket);
    internals.tutorState.conversation.coaching = 'afterwards';
    await openLiveConversation(internals, socket);
    generateTutor.mockClear();
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    socket.message({ serverContent: { inputTranscription: { text: 'I go yesterday.' } } });
    socket.message({ serverContent: { outputTranscription: { text: 'That sounds interesting.' } } });
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));
    socket.message({ serverContent: { inputTranscription: { text: 'She have a car.' } } });
    socket.message({ serverContent: { outputTranscription: { text: 'What colour is it?' } } });
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(2));

    expect(generateTutor).not.toHaveBeenCalled();
    expect(internals.tutorState.conversation.transcript.every((turn) =>
      turn.coachingPending === true && turn.rephrase === undefined
    )).toBe(true);
    generateTutor.mockImplementation((async (request: TutorStructuredGenerationRequest) => {
      // Changed 2026-10-15: V241, owner item I6, Stop requests corrections alone.
      if (request.kind === 'conversationTakeHome') return { doneWell: [], naturally: [], tryNext: 'Try a question.' };
      expect(request.kind).toBe('conversationCorrections');
      expect(JSON.parse(request.input)).toMatchObject({
        register: 'professional',
        recipeTargets: { supportingTargets: [] },
        turns: [
          { question: 'Welcome. How can I help?', learnerAnswer: 'I go yesterday.', spoken: true },
          { question: 'That sounds interesting.', learnerAnswer: 'She have a car.', spoken: true }
        ]
      });
      return { corrections: [
        { correction: 'I went yesterday.', targetId: '', explanation: 'Use the past tense.',
          rephrase: 'I went yesterday.', rephraseWhy: 'This naturally answers the question.' },
        { correction: 'She has a car.', targetId: '', explanation: 'Use has with she.',
          rephrase: 'She owns a car.', rephraseWhy: 'This is natural in context.' }
      ] };
    }) as never);

    // Changed 2026-10-04: this probe checks structured closing/coaching; Live card audio has its own probe.
    internals.tutorState.conversation.speakerOn = false;
    await internals.handleMessage({ command: 'stopTutorConversation' });
    expect(generateTutor).toHaveBeenCalledTimes(1);
    expect(internals.tutorState.conversation.transcript.map(({
      correction, explanation, rephrase, rephraseWhy
    }) => ({
      correction, explanation, rephrase, rephraseWhy
    }))).toEqual([
      { correction: 'I went yesterday.', explanation: 'Use the past tense.',
        rephrase: 'I went yesterday.', rephraseWhy: 'This naturally answers the question.' },
      { correction: 'She has a car.', explanation: 'Use has with she.',
        rephrase: 'She owns a car.', rephraseWhy: 'This is natural in context.' }
    ]);
  });

  it('V139 drops unheard Live audio while the speaker is off to bound retained memory', async () => {
    const socket = new FakeSocket();
    const { internals, waveOutSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'toggleTutorConversationSpeaker' });
    waveOutSession.play.mockClear();

    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: Buffer.alloc(4_800).toString('base64'), mimeType: 'audio/pcm;rate=24000'
    } }] } } });

    // V139, 2026-09-22: Replay cannot justify retaining an unbounded stream the reader chose
    // not to hear. Turning the speaker back on resumes retention with the next received chunk.
    expect(internals.tutorLiveReplyAudio).toEqual([]);
    expect(waveOutSession.play).not.toHaveBeenCalled();
  });

  it('stops playback and discards queued audio when Gemini reports an interruption', async () => {
    const socket = new FakeSocket();
    const { internals, waveOutSession, postMessage } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    waveOutSession.stop.mockClear();
    postMessage.mockClear();
    // 2026-09-26: A spoken reply needs learner transcription before audio can play.
    // 2026-10-02: V187 holds the reply until classification or the 1500 ms limit.
    vi.useFakeTimers();
    socket.message({ serverContent: { inputTranscription: { text: 'A spoken answer.' } } });
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'AQI=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });
    await vi.advanceTimersByTimeAsync(1500);
    vi.useRealTimers();
    socket.message({ serverContent: { outputTranscription: { text: 'The spoken reply.' } } });
    expect(internals.tutorLiveReplyAudio).toHaveLength(1);
    expect(tutorStopStates(postMessage).at(-1)?.disabled).toBe(true);
    waveOutSession.stop.mockClear();
    socket.message({ serverContent: { interrupted: true } });
    expect(waveOutSession.stop).toHaveBeenCalledOnce();
    expect(internals.tutorLiveReplyAudio).toEqual([]);
    // Changed 2026-09-25 for V155: interruption is a complete reply-ending path.
    // 2026-09-26: A real spoken turn keeps Stop disabled until its correction settles.
    await vi.waitFor(() => expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: false, title: 'Stop conversation'
    }));
  });

  it('does not spawn the microphone on conversation start or after a reply finishes', async () => {
    const socket = new FakeSocket();
    const { internals, waveInRecorder } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    expect(internals.tutorState.conversation.currentQuestion).toBe('Welcome. How can I help?');
    expect(waveInRecorder.start).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(waveInRecorder.start).not.toHaveBeenCalled();
  });

  it.each([
    ['Stop', async (provider: KrenResultsViewProvider, internals: ProviderInternals, socket: FakeSocket) => {
      await internals.handleMessage({ command: 'stopTutorConversation' });
    }],
    ['Start new', async (provider: KrenResultsViewProvider, internals: ProviderInternals, socket: FakeSocket) => {
      internals.tutorState.conversation.status = 'stopped';
      await internals.handleMessage({ command: 'startTutorConversation' });
    }],
    ['Back to chat', async (provider: KrenResultsViewProvider, internals: ProviderInternals, socket: FakeSocket) => {
      internals.tutorState.conversation.status = 'stopped';
      await internals.handleMessage({ command: 'resumeTutorConversation' });
    }],
    ['leaving conversation', async (provider: KrenResultsViewProvider, internals: ProviderInternals, socket: FakeSocket) => {
      await internals.handleMessage({ command: 'showStartPage' });
    }],
    ['disposing the panel', async (provider: KrenResultsViewProvider) => {
      provider.dispose();
    }],
    ['switching Replies to Standard', async (provider: KrenResultsViewProvider, internals: ProviderInternals) => {
      await internals.handleMessage({ command: 'updateTutorConversationReplies', input: 'standard' });
    }],
    ['a Live fallback', async (provider: KrenResultsViewProvider, internals: ProviderInternals, socket: FakeSocket) => {
      socket.emit('error');
    }]
  ])('stops the microphone on %s', async (_name, close) => {
    const socket = new FakeSocket();
    const { provider, internals, waveInSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    waveInSession.stop.mockClear();
    await close(provider, internals, socket);
    await vi.waitFor(() => expect(waveInSession.stop).toHaveBeenCalledOnce());
  });

  it('keeps typed clientContent working while the Talk microphone stays open', async () => {
    const socket = new FakeSocket();
    const { internals, waveInSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    await internals.handleMessage({ command: 'updateTutorConversationAnswer', answer: 'A typed answer.' });
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    // Changed 2026-09-24 after the owner chose spoken Live opening B: the typed turn follows
    // the session-owned opening rather than the structured fallback text.
    await waitForSent(socket, 3);
    expect(JSON.parse(socket.sent[2]!)).toEqual({ clientContent: {
      turns: [{ role: 'user', parts: [{ text: 'A typed answer.' }] }], turnComplete: true
    } });
    expect(waveInSession.stop).not.toHaveBeenCalled();
  });

  it('grows the reply fragment by fragment and sends three audio chunks only to the host helper', async () => {
    const socket = new FakeSocket();
    const { internals, postMessage, waveOutSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    postMessage.mockClear();
    waveOutSession.play.mockClear();
    await internals.handleMessage({ command: 'updateTutorConversationAnswer', answer: 'I go there yesterday.' });
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    await waitForSent(socket, 3);

    socket.message({ serverContent: { outputTranscription: { text: 'That ' } } });
    expect(internals.tutorLiveReplyText).toBe('That ');
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'AQI=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });
    socket.message({ serverContent: { outputTranscription: { text: 'sounds ' } } });
    expect(internals.tutorLiveReplyText).toBe('That sounds ');
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'AwQ=', mimeType: 'audio/pcm;rate=22050'
    } }] } } });
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'BQY=', mimeType: 'audio/pcm'
    } }] } } });
    socket.message({ serverContent: { outputTranscription: { text: 'interesting.' } } });
    expect(internals.tutorLiveReplyText).toBe('That sounds interesting.');
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));

    const messages = postMessage.mock.calls.map(([message]) => message as Record<string, unknown>);
    // Changed 2026-10-04: assert text order and reset behavior while allowing local highlight metadata.
    expect(messages.filter((message) => message.command === 'tutorLiveReplyFragment'))
      .toMatchObject([
        { command: 'tutorLiveReplyFragment', text: 'That ', reset: true },
        { command: 'tutorLiveReplyFragment', text: 'sounds ', reset: false },
        { command: 'tutorLiveReplyFragment', text: 'interesting.', reset: false }
      ]);
    expect(waveOutSession.play.mock.calls.map(([chunk]) => chunk)).toEqual([
      { data: 'AQI=', mimeType: 'audio/pcm;rate=24000' },
      { data: 'AwQ=', mimeType: 'audio/pcm;rate=22050' },
      { data: 'BQY=', mimeType: 'audio/pcm' }
    ]);
    expect(messages.some((message) => message.command === 'tutorLiveAudioChunk')).toBe(false);
    expect(internals.tutorState.conversation.transcript[0]).toMatchObject({
      learnerAnswer: 'I go there yesterday.',
      reply: 'That sounds interesting.',
      correction: 'I went there yesterday.',
      explanation: 'Use the past tense.'
    });
    expect(internals.tutorState.conversation.currentQuestion).toBe('That sounds interesting.');
  });

  it('V136 writes exactly one complete, private timing line for a real spoken Live turn', async () => {
    const socket = new FakeSocket();
    const { internals, actions, emitWaveIn, reportWaveOutProgress } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    actions.log.mockClear();
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    emitWaveIn(pcmChunk(90));
    emitWaveIn(pcmChunk(400));
    const spoken = 'private spoken sentence';
    const written = 'private KREN reply';
    socket.message({ serverContent: { inputTranscription: { text: 'private spoken ' } } });
    socket.message({ serverContent: { inputTranscription: { text: 'sentence' } } });
    socket.message({ serverContent: { outputTranscription: { text: written } } });
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'AQI=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));
    reportWaveOutProgress(1, 0);

    // Changed 2026-09-22: the timing line waits for actual waveOut completion and now carries
    // both gate transitions plus the provider retry totals.
    const lines = actions.log.mock.calls.map(([line]) => String(line))
      .filter((line) => line.startsWith('[conversation timing] mode=Live'));
    expect(lines).toHaveLength(1);
    for (const event of [
      'microphone_opened=', 'first_chunk_forwarded=', 'gate_first_opened=',
      'gate_last_closed=', 'gate_held=', 'gate_reason=',
      'echo_gate_blocked_from=', 'echo_gate_blocked_until=',
      'first_input_transcription=', 'last_input_transcription=', 'turn_committed=',
      'reply_audio_first_byte=', 'reply_audio_complete=',
      'coaching_request_sent=', 'coaching_request_returned=',
      'provider_attempts=', 'provider_backoff_ms='
    ]) expect(lines[0]).toContain(event);
    expect(lines[0]).not.toContain(spoken);
    expect(lines[0]).not.toContain(written);
    expect(lines[0]).not.toContain(TEST_CREDENTIAL);
  });

  it('V143 keeps reply audio timestamps with their own turn when two turns overlap', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const socket = new FakeSocket();
    const { internals, actions } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    actions.log.mockClear();

    const first = new LiveConversationTurnTiming(
      (line) => actions.log(line), Date.now
    );
    internals.tutorLiveTurnTiming = first;
    internals.beginTutorLiveReply();

    now += 100;
    const second = new LiveConversationTurnTiming(
      (line) => actions.log(line), Date.now
    );
    internals.tutorLiveTurnTiming = second;
    socket.message({ serverContent: { turnComplete: true } });

    now += 100;
    internals.beginTutorLiveReply();
    // 2026-09-26: The second audio reply belongs to a transcribed spoken turn.
    socket.message({ serverContent: { inputTranscription: { text: 'The next answer.' } } });
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'AQI=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });
    socket.message({ serverContent: { outputTranscription: { text: 'The next question.' } } });
    now += 100;
    socket.message({ serverContent: { turnComplete: true } });
    second.write();

    const line = actions.log.mock.calls.map(([value]) => String(value))
      .find((value) => value.startsWith('[conversation timing] mode=Live'))!;
    const firstByte = Number(/reply_audio_first_byte=(\d+)/u.exec(line)?.[1]);
    const complete = Number(/reply_audio_complete=(\d+)/u.exec(line)?.[1]);
    expect(complete).toBeGreaterThanOrEqual(firstByte);
  });

  it('V136 writes exactly one complete, private timing line for a real Standard turn', async () => {
    const socket = new FakeSocket();
    const { internals, actions } = liveProvider(() => socket);
    internals.tutorState.conversation.replies = 'standard';
    await internals.handleMessage({ command: 'startTutorConversation' });
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));
    actions.log.mockClear();
    await internals.handleMessage({ command: 'tutorHandyTranscriptReceived' });
    await internals.handleMessage({ command: 'tutorHandyQuietPeriodStarted' });
    await internals.handleMessage({ command: 'tutorHandyQuietPeriodElapsed' });
    const spoken = 'private dictated answer';
    await internals.handleMessage({ command: 'updateTutorConversationAnswer', answer: spoken });
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));

    const lines = actions.log.mock.calls.map(([line]) => String(line))
      .filter((line) => line.startsWith('[conversation timing] mode=Standard'));
    expect(lines).toHaveLength(1);
    // Changed 2026-09-22: the Standard line identifies the dictation provider and request cost.
    for (const event of [
      'dictation_provider=handy', 'dictation_started=', 'transcript_received=',
      'quiet_period_started=', 'quiet_period_elapsed=', 'request_sent=', 'reply_received=',
      'rendered=', 'provider_attempts=', 'provider_backoff_ms='
    ]) expect(lines[0]).toContain(event);
    expect(lines[0]).not.toContain(spoken);
    expect(lines[0]).not.toContain('Structured reply that Live must ignore.');
    expect(lines[0]).not.toContain(TEST_CREDENTIAL);
  });

  it('V134 uses the one configured Live model without ordinary tutor thinking', async () => {
    workspaceGet.mockImplementation((key: string, fallback: unknown) =>
      key === 'tutor.liveModel' ? 'gemini-v134-live-model' : fallback);
    const socket = new FakeSocket();
    const { internals, actions, generateTutor, postMessage } = liveProvider(() => socket);
    actions.settings.mockReturnValue({ ...PANEL_SETTINGS_FIXTURE, tutorProfile: 'pro' });
    internals.tutorState.conversation.coaching = 'teaching';
    await internals.handleMessage({ command: 'startTutorConversation' });
    await waitForLiveSession(internals);
    // The scene is visible while the socket is still unopened, not delayed until Gemini speaks.
    expect(postMessage).toHaveBeenCalledWith({
      command: 'tutorConversationSceneReady', scene: LIVE_OPENING_RESPONSE.scene
    });
    socket.emit('open');
    await waitForSent(socket, 1);
    const setup = JSON.parse(socket.sent[0]!) as { setup: {
      model: string;
      generationConfig: { responseModalities: string[] };
      inputAudioTranscription: object;
      outputAudioTranscription: object;
      systemInstruction: { parts: Array<{ text: string }> };
    } };
    const instruction = setup.setup.systemInstruction.parts[0]!.text;
    expect(setup.setup).toMatchObject({
      model: 'models/gemini-v134-live-model',
      generationConfig: { responseModalities: ['AUDIO'] },
      inputAudioTranscription: { languageCodes: ['en-US'] },
      outputAudioTranscription: {}
    });
    expect(setup.setup.inputAudioTranscription).not.toHaveProperty('mode');
    expect(instruction).toContain(TUTOR_SITUATIONS[0]!.setting);
    expect(instruction).toContain('professional');
    expect(instruction).toContain('Actually, you would say');
    expect(instruction).toContain('Do not ask for or infer document text');
    expect(setup.setup.generationConfig).not.toHaveProperty('thinkingConfig');
    const [, credentialRoute] = (generateTutor.mock.calls as unknown as Array<[
      TutorStructuredGenerationRequest,
      { geminiProfile: string }
    ]>).find(([request]) => request.kind === 'liveSessionCredential')!;
    expect(credentialRoute.geminiProfile).toBe('pro');
  });

  it('falls back after a mid-turn close with the same learner answer and stays Standard', async () => {
    const socket = new FakeSocket();
    const { internals, generateTutor, actions } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'updateTutorConversationAnswer', answer: 'Same answer.' });
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    await waitForSent(socket, 3);
    socket.emit('close');
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));

    const turnRequest = (generateTutor.mock.calls as Array<[TutorStructuredGenerationRequest]>)
      .find(([request]) => isInlineTutorTurn(request))![0];
    expect(JSON.parse(turnRequest.input).learnerAnswer).toBe('Same answer.');
    expect(internals.tutorState.conversation.transcript[0]!.reply)
      .toBe('Structured reply that Live must ignore.');
    expect(internals.tutorLiveFailed).toBe(true);
    expect(actions.log).toHaveBeenCalledWith(expect.stringContaining('Live fallback'));

    internals.tutorState.conversation.draftAnswer = 'Next answer.';
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(2));
    // Changed 2026-09-24 after the owner chose spoken Live opening B: setup, Gemini's opening,
    // and the learner turn are the only frames before Standard takes over.
    expect(socket.sent).toHaveLength(3);
    // 2026-10-11: The next reply is spoken by the Speech Source after Live fails.
    expect(actions.readAloudText).toHaveBeenCalledWith('Structured reply that Live must ignore.', 'en', 'tutor');
    expect(actions.notify).toHaveBeenCalledOnce();
  });

  it('V128 restores a spoken answer and clears busy when Live disconnects during its reply', async () => {
    const socket = new FakeSocket();
    interface CoachingResponse {
      move: string; reply: string; replyQuote: string; correction: string;
      targetId: string; explanation: string; rephrase: string; rephraseWhy: string;
      nextQuestion: string;
    }
    let resolveCoaching!: (value: CoachingResponse) => void;
    const coaching = new Promise<CoachingResponse>((resolve) => { resolveCoaching = resolve; });
    let conversationTurns = 0;
    const { internals, generateTutor, postMessage } = liveProvider(() => socket);
    generateTutor.mockImplementation((request: TutorStructuredGenerationRequest) => {
      if (request.kind === 'liveSessionCredential') return Promise.resolve({ apiKey: TEST_CREDENTIAL });
      if (request.kind === 'conversationOpening') return Promise.resolve(LIVE_OPENING_RESPONSE);
      if (isInlineTutorTurn(request) && conversationTurns++ === 0) return coaching;
      if (isInlineTutorTurn(request)) return Promise.resolve({
        move: 'reaction', reply: 'A later reply.', replyQuote: '', correction: 'A later Send works.',
        targetId: '', explanation: 'That sentence is already correct.', rephrase: 'A later Send works.',
        rephraseWhy: 'This answer is already natural.',
        nextQuestion: 'What happened after that?'
      });
      return Promise.resolve({});
    });
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    socket.message({ serverContent: { inputTranscription: { text: 'Keep my spoken words.' } } });
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'AQI=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });
    socket.message({ serverContent: { outputTranscription: { text: 'A completed Live reply.' } } });
    // Changed 2026-09-23: V141 commits a spoken turn when the reply ends, so a disconnect
    // after that strands nothing. The window this test guards is the one that remains: the
    // session dropping while the reply is still arriving, with the turn not yet committed.
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(true));

    socket.emit('close');

    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));
    expect(internals.tutorState.conversation.transcript).toHaveLength(0);
    expect(internals.tutorState.conversation.draftAnswer).toBe('Keep my spoken words.');
    expect(internals.tutorState.conversation.pendingAnswer).toBeUndefined();
    resolveCoaching({
      move: 'reaction', reply: 'Late structured reply.', replyQuote: '', correction: 'Keep my spoken words.',
      targetId: '', explanation: 'The past tense is right here.', rephrase: 'Keep my spoken words.',
      rephraseWhy: 'This answer is already natural.',
      nextQuestion: 'Late next question?'
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(internals.tutorState.conversation.transcript).toEqual([]);
    await internals.handleMessage({ command: 'updateTutorConversationAnswer', answer: 'A later Send works.' });
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));
    expect(internals.tutorState.conversation.transcript[0]?.learnerAnswer).toBe('A later Send works.');
  });

  it('leaving Live during a spoken reply restores the words and permits a later Send', async () => {
    let resolveCoaching!: (value: {
      move: string; reply: string; replyQuote: string; correction: string;
      targetId: string; explanation: string; rephrase: string; rephraseWhy: string;
      nextQuestion: string;
    }) => void;
    const coaching = new Promise<{
      move: string; reply: string; replyQuote: string; correction: string;
      targetId: string; explanation: string; rephrase: string; rephraseWhy: string;
      nextQuestion: string;
    }>((resolve) => { resolveCoaching = resolve; });
    let conversationTurns = 0;
    const socket = new FakeSocket();
    const { internals, generateTutor, postMessage } = liveProvider(() => socket);
    generateTutor.mockImplementation((request: TutorStructuredGenerationRequest) => {
      if (request.kind === 'liveSessionCredential') return Promise.resolve({ apiKey: TEST_CREDENTIAL });
      if (request.kind === 'conversationOpening') return Promise.resolve(LIVE_OPENING_RESPONSE);
      if (isInlineTutorTurn(request) && conversationTurns++ === 0) return coaching;
      if (isInlineTutorTurn(request)) return Promise.resolve({
        move: 'reaction', reply: 'A later reply.', replyQuote: '', correction: 'A later Send works.',
        targetId: '', explanation: 'That sentence is already correct.', rephrase: 'A later Send works.',
        rephraseWhy: 'This answer is already natural.',
        nextQuestion: 'What happened after that?'
      });
      return Promise.resolve({});
    });
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    socket.message({ serverContent: { inputTranscription: { text: 'Keep these spoken words.' } } });
    socket.message({ serverContent: { outputTranscription: { text: 'A partial Live reply.' } } });
    // Changed 2026-09-23: V141 commits a spoken turn when its reply ends, so leaving Live
    // after that cancels nothing. This test keeps the window it was written for: the reader
    // leaves while the reply is still arriving and their words must come back.
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(true));

    await internals.handleMessage({
      command: 'updateTutorConversationReplies', input: 'standard'
    });

    expect(internals.tutorState.conversation.busy).toBe(false);
    expect(internals.tutorState.conversation.pendingAnswer).toBeUndefined();
    expect(internals.tutorState.conversation.draftAnswer).toBe('Keep these spoken words.');
    expect(postMessage).toHaveBeenCalledWith({
      command: 'tutorLiveTurnCancelled', answer: 'Keep these spoken words.'
    });
    resolveCoaching({
      move: 'reaction', reply: 'Late structured reply.', replyQuote: '', correction: 'Keep these spoken words.',
      targetId: '', explanation: 'This result arrived after the deliberate close.',
      rephrase: 'Keep these spoken words.', rephraseWhy: 'This answer is already natural.',
      nextQuestion: 'Late next question?'
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(internals.tutorState.conversation.transcript).toEqual([]);
    await internals.handleMessage({
      command: 'updateTutorConversationAnswer', answer: 'A later Send works.'
    });
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));
    expect(internals.tutorState.conversation.transcript[0]?.learnerAnswer).toBe('A later Send works.');
  });

  it('does not create a Live socket when Standard wins the pending credential request', async () => {
    let resolveCredential!: (value: { apiKey: string }) => void;
    const credential = new Promise<{ apiKey: string }>((resolve) => {
      resolveCredential = resolve;
    });
    const factory = vi.fn(() => new FakeSocket());
    const { internals, generateTutor } = liveProvider(factory);
    generateTutor.mockImplementation((request: TutorStructuredGenerationRequest) => {
      if (request.kind === 'liveSessionCredential') return credential;
      if (request.kind === 'conversationOpening') return Promise.resolve({
        // 2026-10-11: Casting must resolve roles before the pending credential request.
        tutorRole: 'counterpart', learnerRole: 'visitor',
        scene: 'The other speaker is ready for the Standard exchange.', opening: 'Standard won.'
      });
      return Promise.resolve({});
    });
    await internals.handleMessage({ command: 'startTutorConversation' });
    await vi.waitFor(() => expect(generateTutor).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'liveSessionCredential' }), expect.anything(), expect.anything()
    ));

    await internals.handleMessage({
      command: 'updateTutorConversationReplies', input: 'standard'
    });
    resolveCredential({ apiKey: TEST_CREDENTIAL });
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));

    expect(factory).not.toHaveBeenCalled();
    expect(internals.tutorState.conversation.currentQuestion).toBe('Standard won.');
  });

  it('can choose Live again after deliberately closing a typed turn in flight', async () => {
    const sockets: FakeSocket[] = [];
    const first = new FakeSocket();
    const { internals } = liveProvider(() => {
      const socket = sockets.length === 0 ? first : new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    await openLiveConversation(internals, first);
    await internals.handleMessage({ command: 'updateTutorConversationAnswer', answer: 'Typed words.' });
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    await waitForSent(first, 3);

    await internals.handleMessage({
      command: 'updateTutorConversationReplies', input: 'standard'
    });
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));
    await internals.handleMessage({
      command: 'updateTutorConversationReplies', input: 'liveGemini'
    });

    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    expect(internals.tutorLiveFailed).toBe(false);
  });

  it('V130 abandons a reopening session when the reader chooses Standard first', async () => {
    const sockets: FakeSocket[] = [];
    const first = new FakeSocket();
    const { internals } = liveProvider(() => {
      const socket = sockets.length === 0 ? first : new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    await openLiveConversation(internals, first);
    Object.assign(internals.tutorState.conversation, {
      transcript: [{
        question: 'What happened?', learnerAnswer: 'I go there yesterday.',
        correction: 'I went there yesterday.', explanation: 'Use the past tense.'
      }],
      currentQuestion: 'Where did you go?'
    });
    await internals.handleMessage({ command: 'stopTutorConversation' });
    await internals.handleMessage({ command: 'resumeTutorConversation' });
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    const reopened = sockets[1]!;

    // The reader leaves Live while that reopen is still connecting.
    await internals.handleMessage({
      command: 'updateTutorConversationReplies', input: 'standard'
    });
    reopened.emit('open');
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Without the mode check the finished session is adopted under a Standard label, which
    // is the socket V129 promised to close.
    expect(internals.tutorLiveSession).toBeUndefined();
    await vi.waitFor(() => expect(reopened.closeCalls).toBeGreaterThan(0));
  });

  it('V130 tries Live again after a genuine failure when the reader selects it', async () => {
    const sockets: FakeSocket[] = [];
    const first = new FakeSocket();
    const { internals } = liveProvider(() => {
      const socket = sockets.length === 0 ? first : new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    await openLiveConversation(internals, first);
    first.emit('error', 'the session failed');
    await vi.waitFor(() => expect(internals.tutorLiveFailed).toBe(true));

    await internals.handleMessage({
      command: 'updateTutorConversationReplies', input: 'standard'
    });
    await internals.handleMessage({
      command: 'updateTutorConversationReplies', input: 'liveGemini'
    });

    // A failed session used to keep Live refused for the rest of the conversation, so the
    // select could be moved back to Live and never reconnect.
    expect(internals.tutorLiveFailed).toBe(false);
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(1));
  });

  it('V129 closes the Live session when the reader leaves Live mode', async () => {
    const socket = new FakeSocket();
    const { internals } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    expect(socket.closeCalls).toBe(0);

    await internals.handleMessage({ command: 'updateTutorConversationReplies', input: 'standard' });

    // An open socket used to keep costing and keep ageing toward its ten-minute limit while
    // the reader believed they had left Live mode.
    expect(socket.closeCalls).toBe(1);
  });

  it('V129 opens a Live session carrying the exchange when the reader chooses Live', async () => {
    const sockets: FakeSocket[] = [];
    const { internals } = liveProvider(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    internals.tutorState.conversation.replies = 'standard';
    await internals.handleMessage({ command: 'startTutorConversation' });
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));
    Object.assign(internals.tutorState.conversation, {
      transcript: [{
        question: 'What happened?', learnerAnswer: 'I go there yesterday.',
        correction: 'I went there yesterday.', explanation: 'Use the past tense.'
      }],
      currentQuestion: 'Where did you go?'
    });
    expect(sockets).toHaveLength(0);

    await internals.handleMessage({
      command: 'updateTutorConversationReplies', input: 'liveGemini'
    });

    // Choosing Live used to change the label alone: replies stayed Standard and silent, and
    // only the output channel said so.
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0]!;
    socket.emit('open');
    await waitForSent(socket, 1);
    const setup = JSON.parse(socket.sent[0]!) as {
      setup: { systemInstruction: { parts: { text: string }[] } };
    };
    const instruction = setup.setup.systemInstruction.parts[0]!.text;
    // The resume history carries what the reader said, and the question still on screen.
    expect(instruction).toContain('I go there yesterday.');
    expect(instruction).toContain('What happened?');
    expect(instruction).toContain('Where did you go?');
  });

  it('never posts, logs, or renders the API key after a socket error containing its URL', async () => {
    const socket = new FakeSocket();
    let authenticatedUrl = '';
    const { internals, actions, postMessage, waveOutPlayer, waveOutSession } = liveProvider((url) => {
      authenticatedUrl = url;
      return socket;
    });
    await internals.handleMessage({ command: 'startTutorConversation' });
    await waitForLiveSession(internals);
    socket.emit('error', authenticatedUrl);
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));

    const exposed = JSON.stringify({
      logs: actions.log.mock.calls,
      panel: postMessage.mock.calls,
      markup: internals.view?.webview.html,
      helperStart: waveOutPlayer.start.mock.calls,
      helperInput: waveOutSession.play.mock.calls
    });
    expect(authenticatedUrl).toContain(TEST_CREDENTIAL);
    expect(exposed).not.toContain(TEST_CREDENTIAL);
    expect(exposed).not.toContain('?key=');
  });

  it('speaker off and Stop reset the helper, while Stop also closes it and the socket', async () => {
    const socket = new FakeSocket();
    const { internals, waveOutSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    waveOutSession.stop.mockClear();
    await internals.handleMessage({ command: 'toggleTutorConversationSpeaker' });
    expect(socket.closeCalls).toBe(0);
    expect(waveOutSession.stop).toHaveBeenCalledOnce();
    waveOutSession.play.mockClear();
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'BQY=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });
    expect(waveOutSession.play).not.toHaveBeenCalled();
    await internals.handleMessage({ command: 'stopTutorConversation' });
    expect(socket.closeCalls).toBe(1);
    expect(waveOutSession.stop).toHaveBeenCalledTimes(2);
    expect(waveOutSession.close).toHaveBeenCalledOnce();
    expect(internals.tutorState.conversation.status).toBe('stopped');
  });

  it('resets queued Live audio when a new learner turn starts', async () => {
    const socket = new FakeSocket();
    const { internals, waveOutSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    waveOutSession.stop.mockClear();
    internals.tutorState.conversation.draftAnswer = 'A new turn.';
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    expect(waveOutSession.stop).toHaveBeenCalledOnce();
  });

  it('enables Replay after a spoken Live reply stores audio, and replays it without text speech', async () => {
    const socket = new FakeSocket();
    const { internals, actions, postMessage, waveOutPlayer, waveOutSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    internals.tutorState.conversation.draftAnswer = 'Please replay this reply.';
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    await waitForSent(socket, 3);
    for (const chunk of [
      { data: 'AQI=', mimeType: 'audio/pcm;rate=24000' },
      { data: 'AwQ=', mimeType: 'audio/pcm;rate=24000' }
    ]) {
      socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: chunk }] } } });
    }
    socket.message({ serverContent: { outputTranscription: { text: 'Here is the reply.' } } });
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));

    const committed = postMessage.mock.calls.map(([message]) => message as {
      command?: string;
      replayAvailable?: boolean;
    }).reverse().find((message) => message.command === 'tutorLiveTurnCommitted');
    expect(committed?.replayAvailable).toBe(true);
    const rendered = load(renderTutorConversation(
      internals.tutorState, 'auto', true, committed?.replayAvailable === true, true
    ));
    const replay = rendered('[data-command="replayTutorQuestion"]');
    expect(replay.attr('data-tutor-live-audio-available')).toBe('true');
    expect(replay.attr('disabled')).toBeUndefined();

    waveOutSession.play.mockClear();
    waveOutSession.stop.mockClear();
    actions.readAloudText.mockClear();
    await internals.handleMessage({ command: 'replayTutorQuestion' });
    expect(waveOutSession.stop).toHaveBeenCalledOnce();
    expect(waveOutSession.play.mock.calls.map(([chunk]) => chunk)).toEqual([
      { data: 'AQI=', mimeType: 'audio/pcm;rate=24000' },
      { data: 'AwQ=', mimeType: 'audio/pcm;rate=24000' }
    ]);
    expect(actions.readAloudText).not.toHaveBeenCalled();
    expect(waveOutPlayer.start).toHaveBeenCalledOnce();
  });

  it('keeps text speech silent while Live is active and speaks the fallback after failure', async () => {
    const socket = new FakeSocket();
    const { internals, actions, waveOutSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    expect(actions.readAloudText).not.toHaveBeenCalled();

    await internals.handleMessage({ command: 'replayTutorQuestion' });
    expect(waveOutSession.play).not.toHaveBeenCalled();
    internals.tutorState.conversation.draftAnswer = 'Use the fallback response.';
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    await waitForSent(socket, 3);
    socket.emit('close');
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));
    // 2026-10-11: The Edge mute applies only while a Live session is active.
    expect(actions.readAloudText).toHaveBeenCalledWith('Structured reply that Live must ignore.', 'en', 'tutor');

    await internals.handleMessage({ command: 'stopTutorConversation' });
  });

  it('V127 leaves Standard conversation Replay on the tutor and other-gender Edge voices', async () => {
    const socket = new FakeSocket();
    const { internals, actions, waveOutPlayer, waveOutSession } = liveProvider(() => socket);
    internals.tutorState.conversation.liveVoice = 'Kore';
    const settings = {
      ...PANEL_SETTINGS_FIXTURE,
      tutorReadAloudProvider: 'edgeOnline' as const,
      tutorEdgeReadAloudVoice: 'en-US-AvaNeural'
    };
    actions.settings.mockImplementation(() => ({ ...settings }));
    // Changed 2026-09-19: the learner's Edge voice arrives as readAloudText's fourth argument.
    const events: string[] = [];
    waveOutSession.play.mockImplementation((chunk: { data: string }) => {
      events.push(`Gemini:${chunk.data}`);
    });
    actions.readAloudText.mockImplementation(async (
      text: string, _language?: string, _source?: string, voice?: string
    ) => {
      expect(Date.now()).toBeGreaterThanOrEqual(internals.tutorLivePlaybackQueuedUntil);
      events.push(`Edge:${voice ?? settings.tutorEdgeReadAloudVoice}:${text}`);
    });

    await internals.handleMessage({ command: 'startTutorConversation' });
    await waitForLiveSession(internals);
    socket.emit('open');
    await waitForSent(socket, 1);
    socket.message({ setupComplete: {} });
    await waitForSent(socket, 2);
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'AQI=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });
    socket.message({ serverContent: { outputTranscription: { text: 'First Gemini question?' } } });
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));

    internals.tutorState.conversation.draftAnswer = 'First learner answer.';
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    await waitForSent(socket, 3);
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'AwQ=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });
    socket.message({ serverContent: { outputTranscription: { text: 'Second Gemini question?' } } });
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));

    internals.tutorState.conversation.draftAnswer = 'Second learner answer.';
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    await waitForSent(socket, 4);
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'BQY=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });
    socket.message({ serverContent: { outputTranscription: { text: 'Unanswered final reply.' } } });
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(2));
    await internals.handleMessage({ command: 'stopTutorConversation' });
    // Changed 2026-09-20: Stop archives the completed trailing reply before closing Live.
    // Changed 2026-09-24 after the owner chose spoken Live opening B: Gemini's opening and the
    // two later replies each retain their own audio slot.
    expect(internals.tutorLiveConversationAudio.size).toBe(3);
    expect(internals.tutorLiveConversationAudio.get(0)).not.toEqual([]);
    // Changed 2026-09-20: Live has a Gemini-only test below; this retained test now pins the
    // brief's unchanged Standard Edge behavior through the same one Replay command.
    internals.tutorState.conversation.replies = 'standard';
    events.length = 0;
    actions.readAloudText.mockClear();
    waveOutSession.play.mockClear();
    await internals.handleMessage({ command: 'replayTutorQuestion' });
    await vi.waitFor(
      () => expect(internals.tutorState.conversation.replayAllSpeaking).toBe(false),
      { timeout: 3_000 }
    );

    expect(events).toEqual([
      // Changed 2026-09-24 after the owner chose spoken Live opening B: replay uses the
      // session's opening transcript and never substitutes the structured fallback opening.
      // Changed 2026-09-25 for V152: Live narrates and says the structured opening, so the
      // stored conversation starts with that same opening rather than a free-form transcript.
      'Edge:en-US-AvaNeural:Welcome. How can I help?',
      'Edge:en-US-ChristopherNeural:I went there yesterday.',
      'Edge:en-US-AvaNeural:Second Gemini question?',
      'Edge:en-US-ChristopherNeural:I went there yesterday.',
      'Edge:en-US-AvaNeural:Unanswered final reply.'
    ]);
    expect(waveOutPlayer.start).toHaveBeenCalledOnce();
    expect(settings.tutorEdgeReadAloudVoice).toBe('en-US-AvaNeural');
  });

  it('V127 replays both Live sides in order through one extra other-gender Gemini session', async () => {
    const replaySocket = new FakeSocket();
    const socketFactory = vi.fn(() => replaySocket);
    const { internals, actions, waveOutSession, waveOutPlayer } = liveProvider(socketFactory);
    Object.assign(internals.tutorState.conversation, {
      status: 'stopped', replies: 'liveGemini', speakerOn: true, liveVoice: 'Kore',
      transcript: [
        { question: 'First?', learnerAnswer: 'First learner.', correction: 'First corrected.', explanation: '', move: 'reaction', reply: 'Second?' },
        { question: 'Second?', learnerAnswer: 'Second learner.', correction: 'Second corrected.', explanation: '', move: 'reaction', reply: 'Final KREN reply.' }
      ]
    });
    internals.tutorLiveConversationAudio.set(0, [{
      data: 'AQI=', mimeType: 'audio/pcm;rate=24000'
    }]);
    internals.tutorLiveConversationAudio.set(1, [{
      data: 'AwQ=', mimeType: 'audio/pcm;rate=24000'
    }]);
    internals.tutorLiveConversationAudio.set(2, [{
      data: 'CQo=', mimeType: 'audio/pcm;rate=24000'
    }]);
    const events: string[] = [];
    waveOutSession.play.mockImplementation((chunk: { data: string }) => events.push(chunk.data));

    await internals.handleMessage({ command: 'replayTutorQuestion' });
    await vi.waitFor(() => expect(socketFactory).toHaveBeenCalledOnce());
    replaySocket.emit('open');
    await waitForSent(replaySocket, 1);
    const setup = JSON.parse(replaySocket.sent[0]!).setup;
    expect(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Puck');
    expect(setup.systemInstruction.parts[0].text).toMatch(/read.+exactly/iu);
    replaySocket.message({ setupComplete: {} });

    await waitForSent(replaySocket, 2);
    expect(JSON.parse(replaySocket.sent[1]!).clientContent.turns[0].parts[0].text)
      .toContain('First corrected.');
    replaySocket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'BQY=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });
    replaySocket.message({ serverContent: { turnComplete: true } });
    await waitForSent(replaySocket, 3);
    expect(JSON.parse(replaySocket.sent[2]!).clientContent.turns[0].parts[0].text)
      .toContain('Second corrected.');
    replaySocket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'Bwg=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });
    replaySocket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.replayAllSpeaking).toBe(false));

    // Changed 2026-09-20: the trailing Gemini contribution is replayed once after the final
    // learner line. The first reply is not repeated because it is also the next question.
    expect(events).toEqual(['AQI=', 'BQY=', 'AwQ=', 'Bwg=', 'CQo=']);
    expect(socketFactory).toHaveBeenCalledOnce();
    expect(waveOutPlayer.start).toHaveBeenCalledOnce();
    expect(actions.readAloudText).not.toHaveBeenCalled();
  });

  it.each([
    ['나 지금 20분 뒤에.', false], ['나 지금 20분 뒤에.', true],
    ['¿Cómo se llama 나 tu papá?', false], ['¿Cómo se llama 나 tu papá?', true]
  ] as const)('V187c Live replay excludes hidden input %s and its audio (retained=%s) while synthesizing English', async (text, retained) => {
    const replaySocket = new FakeSocket();
    const socketFactory = vi.fn(() => replaySocket);
    const { internals, actions, waveOutSession } = liveProvider(socketFactory);
    Object.assign(internals.tutorState.conversation, {
      status: 'stopped', replies: 'liveGemini', speakerOn: true, liveVoice: 'Kore',
      transcript: [
        { question: 'First?', learnerAnswer: 'First learner.', correction: 'First corrected.', explanation: '', move: 'reaction', reply: 'Second?' },
        { question: 'Second?', learnerAnswer: text, learnerNotShown: true, correction: '', explanation: '', move: 'reaction', reply: '' },
        { question: 'Second?', learnerAnswer: 'Second learner.', correction: 'Second corrected.', explanation: '', move: 'reaction', reply: 'Final KREN reply.' }
      ]
    });
    internals.tutorLiveConversationAudio.set(0, [{ data: 'AQI=', mimeType: 'audio/pcm;rate=24000' }]);
    internals.tutorLiveConversationAudio.set(1, retained ? [{ data: 'DwA=', mimeType: 'audio/pcm;rate=24000' }] : []);
    internals.tutorLiveConversationAudio.set(2, [{ data: 'AwQ=', mimeType: 'audio/pcm;rate=24000' }]);
    internals.tutorLiveConversationAudio.set(3, [{ data: 'CQo=', mimeType: 'audio/pcm;rate=24000' }]);
    const played: string[] = [];
    waveOutSession.play.mockImplementation((chunk: { data: string }) => played.push(chunk.data));

    await internals.handleMessage({ command: 'replayTutorQuestion' });
    await vi.waitFor(() => expect(socketFactory).toHaveBeenCalledOnce());
    replaySocket.emit('open');
    await waitForSent(replaySocket, 1);
    replaySocket.message({ setupComplete: {} });
    for (const [index, learner, data] of [[2, 'First corrected.', 'BQY='], [3, 'Second corrected.', 'Bwg=']] as const) {
      await waitForSent(replaySocket, index);
      expect(JSON.parse(replaySocket.sent[index - 1]!).clientContent.turns[0].parts[0].text).toContain(learner);
      replaySocket.message({ serverContent: { modelTurn: { parts: [{ inlineData: { data, mimeType: 'audio/pcm;rate=24000' } }] } } });
      replaySocket.message({ serverContent: { turnComplete: true } });
    }
    await vi.waitFor(() => expect(internals.tutorState.conversation.replayAllSpeaking).toBe(false));
    expect(played).toEqual(['AQI=', 'BQY=', 'AwQ=', 'Bwg=', 'CQo=']);
    expect(replaySocket.sent).toHaveLength(3);
    expect(JSON.stringify(replaySocket.sent)).not.toContain(text);
    expect(actions.readAloudText).not.toHaveBeenCalled();
  });

  it('V131 drops a late Live Hint when the socket advances to its reply', async () => {
    // Added 2026-09-20: the provider request can outlive the question even when the same Hint
    // controller still owns the request. This uses a real Live turn, not a full re-render.
    const socket = new FakeSocket();
    const { internals, generateTutor, postMessage } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    let finishHint!: (value: { explanation: string; example: string }) => void;
    const hint = new Promise<{ explanation: string; example: string }>(
      (resolve) => { finishHint = resolve; }
    );
    generateTutor.mockImplementation((async (request: TutorStructuredGenerationRequest) => {
      if (request.kind === 'conversationHint') return hint;
      if (isInlineTutorTurn(request)) return {
        move: 'reaction', reply: 'Structured reply.', replyQuote: '', correction: 'My answer.',
        explanation: 'Complete explanation.', targetId: '', rephrase: 'My answer.',
        rephraseWhy: 'This answer is already natural.'
      };
      return { apiKey: TEST_CREDENTIAL };
    }) as never);
    const oldQuestion = internals.tutorState.conversation.currentQuestion;
    await internals.handleMessage({ command: 'hintTutorConversation' });
    await vi.waitFor(() => expect(internals.tutorState.conversation.hintBusy).toBe(true));
    internals.tutorState.conversation.draftAnswer = 'My answer.';
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    await waitForSent(socket, 3);
    postMessage.mockClear();
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'AQI=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });
    socket.message({ serverContent: { outputTranscription: { text: 'The next Live question?' } } });
    // Changed 2026-09-24 for V147: the first next-message fragment is the turn boundary.
    // Clear must precede that fragment, and aborting the old request prevents a late arrival.
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'tutorConversationHintState', clear: true
    })));
    const boundaryMessages = postMessage.mock.calls.map(([message]) => message as Record<string, unknown>);
    expect(boundaryMessages.findIndex((message) => message.command === 'tutorConversationHintState'))
      .toBeLessThan(boundaryMessages.findIndex((message) => message.command === 'tutorLiveReplyFragment'));
    expect(internals.tutorState.conversation.hintBusy).toBe(false);
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.currentQuestion).not.toBe(oldQuestion));
    postMessage.mockClear();

    finishHint({ explanation: 'Late old explanation.', example: 'Late old example.' });
    await vi.waitFor(() => expect(internals.tutorState.conversation.hintBusy).toBe(false));
    expect(internals.tutorState.conversation.hint).toBeUndefined();
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      command: 'tutorConversationHintState', hint: expect.anything()
    }));
  });

  it('V131 pressing active Live Replay again stops instead of requeueing its audio', async () => {
    const socket = new FakeSocket();
    const { internals, waveOutSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    // Changed 2026-09-24 after the owner chose spoken Live opening B: its retained Gemini audio
    // is immediately available to the same replay toggle as any later Live reply.
    // 2026-09-26: The replayed audio now belongs to a transcribed spoken turn.
    socket.message({ serverContent: { inputTranscription: { text: 'A spoken answer.' } } });
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'AQI=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });
    socket.message({ serverContent: { outputTranscription: { text: 'Replay me.' } } });
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorLiveReplyAudioComplete).toBe(true));
    waveOutSession.play.mockClear();
    waveOutSession.stop.mockClear();

    await internals.handleMessage({ command: 'replayTutorQuestion' });
    expect(internals.tutorState.conversation.replayAllSpeaking).toBe(true);
    await internals.handleMessage({ command: 'replayTutorQuestion' });

    expect(internals.tutorState.conversation.replayAllSpeaking).toBe(false);
    expect(waveOutSession.play).toHaveBeenCalledTimes(1);
    expect(waveOutSession.stop).toHaveBeenCalled();
  });

  it('V131 posts unavailable replay state when leaving Tutor clears stored Live audio', async () => {
    const socket = new FakeSocket();
    const { internals, postMessage } = liveProvider(() => socket);
    Object.assign(internals.tutorState.conversation, {
      status: 'stopped', replies: 'liveGemini', speakerOn: true,
      transcript: [{ question: 'Question?', learnerAnswer: 'Answer.', correction: 'Answer.',
        explanation: '', move: 'reaction', reply: 'Final reply.' }]
    });
    internals.tutorLiveConversationAudio.set(0, [{ data: 'AQI=', mimeType: 'audio/pcm;rate=24000' }]);
    internals.tutorLiveConversationAudio.set(1, [{ data: 'AwQ=', mimeType: 'audio/pcm;rate=24000' }]);
    postMessage.mockClear();

    await internals.handleMessage({ command: 'showStartPage' });

    expect(internals.tutorLiveConversationAudio.size).toBe(0);
    expect(postMessage).toHaveBeenCalledWith({
      command: 'tutorConversationReplayState', available: false
    });
  });

  it('V127 skips Live learner lines, logs a safe reason, and never falls back to Edge', async () => {
    const { internals, actions, generateTutor } = liveProvider(() => new FakeSocket());
    Object.assign(internals.tutorState.conversation, {
      status: 'stopped', replies: 'liveGemini', speakerOn: true, liveVoice: 'Kore',
      transcript: [{
        question: 'Question?', learnerAnswer: 'Learner.', correction: 'Corrected learner.', explanation: ''
      }]
    });
    internals.tutorLiveConversationAudio.set(0, [{
      data: 'AQI=', mimeType: 'audio/pcm;rate=24000'
    }]);
    // Changed 2026-09-20: a complete replay also owns the trailing KREN contribution.
    internals.tutorLiveConversationAudio.set(1, [{
      data: 'AwQ=', mimeType: 'audio/pcm;rate=24000'
    }]);
    generateTutor.mockRejectedValueOnce(new Error('credential unavailable'));

    await internals.handleMessage({ command: 'replayTutorQuestion' });
    await vi.waitFor(() => expect(internals.tutorState.conversation.replayAllSpeaking).toBe(false));

    expect(actions.log).toHaveBeenCalledWith(expect.stringMatching(/Live replay.+learner.+failed/iu));
    expect(actions.readAloudText).not.toHaveBeenCalled();
  });

  it('V124 drops every earlier stored Live reply on Start new', async () => {
    const first = new FakeSocket();
    const second = new FakeSocket();
    const sockets = [first, second];
    const { internals } = liveProvider(() => sockets.shift()!);
    await openLiveConversation(internals, first);
    first.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'AQI=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });
    internals.tutorState.conversation.draftAnswer = 'Store the opening.';
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    expect(internals.tutorLiveConversationAudio.size).toBe(1);
    await internals.handleMessage({ command: 'stopTutorConversation' });

    await internals.handleMessage({ command: 'startTutorConversation' });
    expect(internals.tutorLiveConversationAudio.size).toBe(0);
  });

  it.each([
    ['Replay again', async (provider: KrenResultsViewProvider, internals: ProviderInternals) => {
      await internals.handleMessage({ command: 'replayTutorQuestion' });
    }],
    ['speaker off', async (_provider: KrenResultsViewProvider, internals: ProviderInternals) => {
      await internals.handleMessage({ command: 'toggleTutorConversationSpeaker' });
    }],
    ['Back to chat', async (_provider: KrenResultsViewProvider, internals: ProviderInternals) => {
      await internals.handleMessage({ command: 'resumeTutorConversation' });
    }],
    ['Start new', async (_provider: KrenResultsViewProvider, internals: ProviderInternals) => {
      await internals.handleMessage({ command: 'startTutorConversation' });
    }],
    ['leaving conversation', async (_provider: KrenResultsViewProvider, internals: ProviderInternals) => {
      await internals.handleMessage({ command: 'showStartPage' });
    }],
    ['panel disposal', async (provider: KrenResultsViewProvider) => {
      provider.dispose();
    }]
  ] as const)('V127 stops Live conversation Replay at once on %s', async (_name, stop) => {
    const socket = new FakeSocket();
    const { provider, internals, actions, waveOutSession } = liveProvider(() => socket);
    Object.assign(internals.tutorState.conversation, {
      status: 'stopped', speakerOn: true, currentQuestion: 'Question?',
      transcript: [{
        question: 'Question?', learnerAnswer: 'Answer.', correction: 'Answer.', explanation: ''
      }]
    });
    internals.tutorLiveConversationAudio.set(0, [{
      data: 'A'.repeat(64_000), mimeType: 'audio/pcm;rate=24000'
    }]);
    // Changed 2026-09-20: stopped Live Replay is unavailable unless KREN's final line remains.
    internals.tutorLiveConversationAudio.set(1, [{
      data: 'B'.repeat(64_000), mimeType: 'audio/pcm;rate=24000'
    }]);

    // Changed 2026-09-20: the extra learner session opens before stored audio begins, so the
    // stop assertion starts from the visible playing state rather than waiting for a PCM write.
    await internals.handleMessage({ command: 'replayTutorQuestion' });
    await vi.waitFor(() => expect(internals.tutorState.conversation.replayAllSpeaking).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(internals.tutorState.conversation.replayAllSpeaking).toBe(true);
    await stop(provider, internals);

    expect(waveOutSession.stop).toHaveBeenCalled();
    expect(waveOutSession.close).toHaveBeenCalled();
    expect(internals.tutorState.conversation.replayAllSpeaking).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(actions.readAloudText).not.toHaveBeenCalled();
  });

  it('keeps Live text after the helper fails and leaves this conversation silent', async () => {
    const socket = new FakeSocket();
    const { internals, actions, failWaveOut, waveOutSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    failWaveOut(new Error('KREN waveOut failed: waveOutWrite failed with code 4.'));
    expect(actions.log).toHaveBeenCalledWith(
      '[conversation Live audio] KREN waveOut failed: waveOutWrite failed with code 4.'
    );
    waveOutSession.play.mockClear();

    internals.tutorState.conversation.draftAnswer = 'Keep the text live.';
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    await waitForSent(socket, 3);
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'AQI=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });
    socket.message({ serverContent: { outputTranscription: { text: 'Live text remains.' } } });
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));
    expect(internals.tutorState.conversation.currentQuestion).toBe('Live text remains.');
    expect(internals.tutorLiveFailed).toBe(false);
    expect(waveOutSession.play).not.toHaveBeenCalled();
    expect(actions.readAloudText).not.toHaveBeenCalled();
  });

  it('continues the Live session for text when the host helper cannot start', async () => {
    const socket = new FakeSocket();
    const { internals, actions, waveOutPlayer } = liveProvider(() => socket);
    waveOutPlayer.start.mockRejectedValueOnce(new Error('waveOut helper could not start'));
    await openLiveConversation(internals, socket);
    expect(internals.tutorState.conversation.currentQuestion).toBe('Welcome. How can I help?');
    expect(internals.tutorLiveFailed).toBe(false);
    expect(actions.log).toHaveBeenCalledWith('[conversation Live audio] waveOut helper could not start');
    expect(actions.readAloudText).not.toHaveBeenCalled();
  });

  it('V152 uses one Gemini turn to narrate the scene and speak the structured opening', async () => {
    // Added 2026-09-24 after the owner chose spoken Live opening B: the structured response
    // casts the scene and remains the fallback, but its opening must never become a Live bubble.
    const socket = new FakeSocket();
    const { internals, postMessage, actions } = liveProvider(() => socket);

    await internals.handleMessage({ command: 'startTutorConversation' });
    await waitForLiveSession(internals);
    socket.emit('open');
    await waitForSent(socket, 1);
    socket.message({ setupComplete: {} });
    await vi.waitFor(() => expect(
      socket.sent.length === 2 || !internals.tutorState.conversation.busy
    ).toBe(true));
    const setupInstruction = JSON.parse(socket.sent[0]!).setup.systemInstruction.parts[0].text as string;
    expect(setupInstruction).toContain(LIVE_OPENING_RESPONSE.scene);
    expect(setupInstruction).toContain('first read that scene as natural third-person narration');
    expect(setupInstruction).toContain('not as the counterpart addressing the learner');
    expect(setupInstruction).not.toContain(LIVE_OPENING_RESPONSE.opening);
    const openingTurn = JSON.parse(socket.sent[1]!).clientContent;
    expect(openingTurn.turns[0].parts).toEqual([{ text:
      `Read the established scene aloud as neutral third-person narration. Then switch into character and say exactly this opening: ${JSON.stringify(LIVE_OPENING_RESPONSE.opening)}`
    }]);
    socket.message({ serverContent: { outputTranscription: {
      text: 'Which achievement best demonstrates your leadership?'
    } } });
    socket.message({ serverContent: { turnComplete: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(internals.tutorState.conversation.currentQuestion)
      .toBe(LIVE_OPENING_RESPONSE.opening);
    const messages = postMessage.mock.calls.map(([message]) => message as Record<string, unknown>);
    expect(messages.filter((message) => message.command === 'tutorConversationSceneReady'))
      .toEqual([{ command: 'tutorConversationSceneReady', scene: LIVE_OPENING_RESPONSE.scene }]);
    expect(messages.filter((message) => message.command === 'tutorLiveReplyFragment')).toEqual([]);
    expect(messages).toContainEqual(expect.objectContaining({
      command: 'tutorConversationOpeningReady',
      scene: LIVE_OPENING_RESPONSE.scene,
      opening: LIVE_OPENING_RESPONSE.opening,
      talkAvailable: true
    }));
    // Live narration and opening belong only to Gemini audio, never Edge or Windows speech.
    expect(actions.readAloudText).not.toHaveBeenCalled();
  });

  it('V152 narrates the Live scene and waits indefinitely when the learner starts', async () => {
    const socket = new FakeSocket();
    const { internals, generateTutor, actions, waveOutSession } = liveProvider(() => socket);
    internals.tutorState.conversation.starts = 'learner';
    internals.tutorState.conversation.speakerOn = false;
    generateTutor.mockImplementation(async (request: TutorStructuredGenerationRequest) => {
      if (request.kind === 'liveSessionCredential') return { apiKey: TEST_CREDENTIAL };
      if (request.kind === 'conversationOpening') return {
        // 2026-10-11: Learner-first casting still resolves both roles.
        tutorRole: 'customer', learnerRole: 'member of staff',
        scene: 'The learner is the member of staff and KREN is the customer.'
      };
      return {};
    });

    await internals.handleMessage({ command: 'startTutorConversation' });
    await waitForLiveSession(internals);
    socket.emit('open');
    await waitForSent(socket, 1);
    socket.message({ setupComplete: {} });
    await waitForSent(socket, 2);
    const turn = JSON.parse(socket.sent[1]!).clientContent;
    expect(turn.turns[0].parts).toEqual([{ text:
      'Read the established scene aloud as neutral third-person narration, then wait silently for the learner to begin. Do not speak in character.'
    }]);
    socket.message({ serverContent: { outputTranscription: {
      text: 'The customer approaches the member of staff with a question.'
    } } });
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'AQI=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));

    expect(internals.tutorState.conversation.currentQuestion).toBe('');
    expect(internals.tutorState.conversation.status).toBe('active');
    expect(internals.tutorLiveSession).toBeDefined();
    expect(socket.closeCalls).toBe(0);
    expect(actions.readAloudText).not.toHaveBeenCalled();
    expect(waveOutSession.play).not.toHaveBeenCalled();
    expect(waveOutSession.close).not.toHaveBeenCalled();
  });

  it('V153 sends Live coaching at reply start, before the reply finishes', async () => {
    // Changed 2026-09-25 for V153: the owner reversed V152's wait for the full Live reply.
    // The correction request now starts on Gemini's first reply fragment and carries no reply.
    const socket = new FakeSocket();
    const spokenReply = 'Actually, you would say: from overseas. What happened next?';
    const correction = 'I arrived by bus yesterday.';
    let finishCoaching!: (value: CoachingTurnResponse) => void;
    const coaching = new Promise<CoachingTurnResponse>((resolve) => { finishCoaching = resolve; });
    const { internals, generateTutor, postMessage } = liveProvider(() => socket);
    internals.tutorState.conversation.coaching = 'teaching';
    generateTutor.mockImplementation((request: TutorStructuredGenerationRequest) => {
      if (request.kind === 'liveSessionCredential') {
        return Promise.resolve({ apiKey: TEST_CREDENTIAL });
      }
      if (request.kind === 'conversationOpening') return Promise.resolve(LIVE_OPENING_RESPONSE);
      if (isInlineTutorTurn(request)) {
        expect(JSON.parse(request.input)).toMatchObject({ voiceGender: 'female' });
        expect(JSON.parse(request.input)).not.toHaveProperty('replyTranscript');
        expect(request.instruction).toContain('character you play as a woman');
        return coaching;
      }
      return Promise.resolve({});
    });
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    // 2026-10-02: V187 holds the reply until classification or the 1500 ms limit.
    vi.useFakeTimers();
    socket.message({ serverContent: { inputTranscription: { text: 'I arrive bus yesterday.' } } });
    socket.message({ serverContent: { outputTranscription: { text: spokenReply } } });
    await vi.advanceTimersByTimeAsync(1500);
    vi.useRealTimers();

    await vi.waitFor(() => expect(generateTutor.mock.calls.some(
      ([request]) => isInlineTutorTurn(request)
    )).toBe(true));
    expect(internals.tutorState.conversation.transcript).toHaveLength(0);

    socket.message({ serverContent: { turnComplete: true } });
    finishCoaching({
      move: 'recast', reply: 'Structured reply is ignored.', replyQuote: 'model supplied',
      correction, targetId: '', explanation: 'Use the past tense and an article.',
      rephrase: correction, rephraseWhy: 'This naturally answers the question.',
      nextQuestion: 'Structured question is ignored?'
    });

    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript[0]).toMatchObject({
      reply: spokenReply, replyQuote: 'from overseas', correction
    }));
    expect(new Set(correction.toLowerCase().match(/[a-z]+/gu))).not.toContain('from');
    expect(new Set(correction.toLowerCase().match(/[a-z]+/gu))).not.toContain('overseas');
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'tutorLiveTurnCoaching', replyQuote: 'from overseas'
    }));
  });

  it('V153 derives the Live scene and system character from the selected voice', async () => {
    const socket = new FakeSocket();
    const { internals, generateTutor } = liveProvider(() => socket);
    internals.tutorState.conversation.liveVoice = 'Puck';

    await internals.handleMessage({ command: 'startTutorConversation' });
    await waitForLiveSession(internals);
    const opening = generateTutor.mock.calls.find(
      ([request]) => request.kind === 'conversationOpening'
    )?.[0] as TutorStructuredGenerationRequest;
    expect(JSON.parse(opening.input).voiceGender).toBe('male');
    expect(opening.instruction).toContain('character you play as a man');

    socket.emit('open');
    await waitForSent(socket, 1);
    const setup = JSON.parse(socket.sent[0]!).setup;
    expect(setup.systemInstruction.parts[0].text).toContain('character you play as a man');
  });

  it.each([
    ['colon', 'Actually, you would say: from overseas. What happened next?'],
    ['no colon', 'Actually, you would say from overseas. What happened next?'],
    ['capitalisation and trailing space', 'ACTUALLY, YOU WOULD SAY:   from overseas. What happened next?'],
    // Added 2026-09-25 in verification of V153. A Live transcript of KREN's own speech may drop
    // the comma after "Actually", and the extractor then returned nothing, so the highlight
    // vanished silently: the failure the owner has reported four times. The three rows above
    // all carried the comma, so none of them could catch it.
    ['no comma', 'Actually you would say from overseas. What happened next?'],
    ['no comma, with colon', 'Actually you would say: from overseas. What happened next?']
  ] as const)('V153 finds the Live teaching highlight with %s', async (_variant, spokenReply) => {
    const socket = new FakeSocket();
    const { internals, generateTutor } = liveProvider(() => socket);
    internals.tutorState.conversation.coaching = 'teaching';
    generateTutor.mockImplementation(async (request: TutorStructuredGenerationRequest) => {
      if (request.kind === 'liveSessionCredential') return { apiKey: TEST_CREDENTIAL };
      if (request.kind === 'conversationOpening') return LIVE_OPENING_RESPONSE;
      if (isInlineTutorTurn(request)) return {
        move: 'recast', reply: 'Structured reply is ignored.', replyQuote: '',
        correction: 'I came from overseas.', targetId: '', explanation: 'Use the past tense.',
        rephrase: 'I came from abroad.', rephraseWhy: 'This fits the question naturally.',
        nextQuestion: 'Structured question is ignored?'
      };
      return {};
    });
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    socket.message({ serverContent: { inputTranscription: { text: 'I come overseas.' } } });
    socket.message({ serverContent: { outputTranscription: { text: spokenReply } } });
    socket.message({ serverContent: { turnComplete: true } });

    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript[0]?.coachingPending)
      .toBeUndefined());
    expect(internals.tutorState.conversation.transcript[0]?.replyQuote).toBe('from overseas');
  });

  it('V153 leaves a differently worded Live recast unhighlighted, logs it, and keeps the turn', async () => {
    const socket = new FakeSocket();
    const spokenReply = 'A more natural version is: I came from overseas. What happened next?';
    const { internals, generateTutor, actions } = liveProvider(() => socket);
    internals.tutorState.conversation.coaching = 'teaching';
    generateTutor.mockImplementation(async (request: TutorStructuredGenerationRequest) => {
      if (request.kind === 'liveSessionCredential') return { apiKey: TEST_CREDENTIAL };
      if (request.kind === 'conversationOpening') return LIVE_OPENING_RESPONSE;
      if (isInlineTutorTurn(request)) return {
        move: 'recast', reply: 'Structured reply is ignored.', replyQuote: 'I came from overseas',
        correction: 'I came from overseas.', targetId: '', explanation: 'Use the past tense.',
        rephrase: 'I came from abroad.', rephraseWhy: 'This fits the question naturally.',
        nextQuestion: 'Structured question is ignored?'
      };
      return {};
    });
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    socket.message({ serverContent: { inputTranscription: { text: 'I come overseas.' } } });
    socket.message({ serverContent: { outputTranscription: { text: spokenReply } } });
    socket.message({ serverContent: { turnComplete: true } });

    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript[0]?.coachingPending)
      .toBeUndefined());
    expect(internals.tutorState.conversation.transcript[0]).toMatchObject({
      reply: spokenReply, replyQuote: '', correction: 'I came from overseas.'
    });
    expect(internals.tutorState.conversation.failure).toBeUndefined();
    expect(actions.log).toHaveBeenCalledWith(
      '[conversation Live highlight missing] The spoken reply did not contain "Actually, you would say".'
    );
  });

  it.each([
    ['Replies is Standard', (internals: ProviderInternals) => {
      internals.tutorState.conversation.replies = 'standard';
    }],
    // 2026-10-11: Live depends on the separate Gemini credential, whatever the text provider.
    ['no Gemini key', (internals: ProviderInternals) => {
      internals.tutorState.settings.routing.provider = 'openai';
    }]
  ] as const)('uses the Standard opening when %s', async (reason, arrange) => {
    const factory = vi.fn(() => new FakeSocket());
    const { internals, generateTutor, actions } = liveProvider(factory);
    arrange(internals);
    if (reason === 'no Gemini key') generateTutor.mockImplementation(async request => {
      if (request.kind === 'liveSessionCredential') throw new ProviderError('Missing Gemini key.', 'setGeminiKey');
      return LIVE_OPENING_RESPONSE;
    });
    await internals.handleMessage({ command: 'startTutorConversation' });
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));
    expect(factory).not.toHaveBeenCalled();
    expect(generateTutor.mock.calls.some(([request]) => request.kind === 'conversationOpening')).toBe(true);
    // Changed 2026-09-22: choosing Standard is a normal state, not a Live fallback.
    if (reason === 'Replies is Standard') {
      expect(actions.log).not.toHaveBeenCalledWith(expect.stringContaining('Live fallback'));
    } else {
      expect(actions.log).toHaveBeenCalledWith(expect.stringContaining('Live fallback'));
    }
  });

  it('speaks the Standard fallback scene and opening when Groq is routed without a Gemini key', async () => {
    const factory = vi.fn(() => new FakeSocket());
    const { internals, actions, generateTutor } = liveProvider(factory);
    internals.tutorState.settings.routing.provider = 'groq';
    generateTutor.mockImplementation(async request => {
      if (request.kind === 'liveSessionCredential') throw new ProviderError('Missing Gemini key.', 'setGeminiKey');
      return LIVE_OPENING_RESPONSE;
    });
    await internals.handleMessage({ command: 'startTutorConversation' });
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));
    expect(internals.tutorState.conversation.currentQuestion).toBe('Welcome. How can I help?');
    // 2026-10-11: Both utterances go through the chosen Speech Source when Live cannot start.
    await vi.waitFor(() => expect(actions.readAloudText).toHaveBeenCalledTimes(2));
    expect(actions.readAloudText).toHaveBeenNthCalledWith(1, LIVE_OPENING_RESPONSE.scene, 'en', 'tutor');
    expect(actions.readAloudText).toHaveBeenNthCalledWith(2, LIVE_OPENING_RESPONSE.opening, 'en', 'tutor');
    expect(factory).not.toHaveBeenCalled();
    expect(actions.notify).toHaveBeenCalledOnce();
    expect(actions.notify).toHaveBeenCalledWith('warning', 'Live replies need a Gemini key. KREN continues with Standard replies.');
  });

  it('stops an active standard voice as soon as Replies changes to Live', async () => {
    const { internals, actions } = liveProvider(() => new FakeSocket());
    Object.assign(internals.tutorState.conversation, { status: 'active', replies: 'standard' });
    await internals.handleMessage({ command: 'updateTutorConversationReplies', input: 'liveGemini' });
    expect(actions.stopReadAloud).toHaveBeenCalledOnce();
    expect(internals.tutorState.conversation.replies).toBe('liveGemini');
  });

  it('uses the Standard opening when the socket factory cannot open and does not reconnect', async () => {
    const factory = vi.fn(() => { throw new Error('URL with private query data'); });
    const { internals, generateTutor, postMessage, actions } = liveProvider(factory);
    await internals.handleMessage({ command: 'startTutorConversation' });
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));
    // Changed 2026-09-24 after the owner chose spoken Live opening B: the same structured
    // response that cast the already-visible scene supplies the first Standard fallback line.
    expect(internals.tutorState.conversation.currentQuestion).toBe('Welcome. How can I help?');
    expect(internals.tutorLiveFailed).toBe(true);
    // Changed 2026-10-01: the opening patch now also refreshes both Reset controls.
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'tutorConversationOpeningReady',
      scene: LIVE_OPENING_RESPONSE.scene,
      opening: LIVE_OPENING_RESPONSE.opening,
      talkAvailable: false,
      replayAvailable: false,
      pressToTalk: false,
      resetAvailability: expect.objectContaining({ master: true })
    }));
    expect(actions.readAloudText).not.toHaveBeenCalledWith(LIVE_OPENING_RESPONSE.opening);
    expect(generateTutor.mock.calls.filter(([request]) => request.kind === 'conversationOpening'))
      .toHaveLength(1);

    internals.tutorState.conversation.draftAnswer = 'Use Standard now.';
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));
    expect(factory).toHaveBeenCalledOnce();
  });

  it('V138 replaces failed Live and Standard openings with the same truthful Retry state', async () => {
    // Changed 2026-10-17: V259, R14 finding 1, quota diagnostics expose only the window category.
    const quotaCategory = 'perDay';
    const factory = vi.fn(() => { throw new Error('authenticated URL must stay private'); });
    const { internals, generateTutor } = liveProvider(factory);
    generateTutor.mockImplementation(async (request: TutorStructuredGenerationRequest) => {
      if (request.kind === 'liveSessionCredential') return { apiKey: TEST_CREDENTIAL };
      if (request.kind === 'conversationOpening') {
        throw new ProviderError(
          `Gemini AI English Tutor request failed (429). {"quotaCategory":"${quotaCategory}"}`,
          'configureGeminiModel', false, 429
        );
      }
      return {};
    });

    await internals.handleMessage({ command: 'startTutorConversation' });
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));

    expect(internals.tutorState.conversation.currentQuestion).toBe('');
    const failed = load(renderTutorConversation(internals.tutorState));
    expect(failed('[data-tutor-opening-failure]').text()).toMatch(/Gemini.*daily.*quota.*exhausted/iu);
    expect(failed('[data-command="startTutorConversation"]').text()).toBe('Retry');
    expect(failed.text()).not.toContain('Tell me about something that happened recently.');
  });

  it('uses the Standard opening when setupComplete times out', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const { internals, generateTutor } = liveProvider(() => socket);
    await internals.handleMessage({ command: 'startTutorConversation' });
    await vi.advanceTimersByTimeAsync(0);
    expect(internals.tutorLiveSession).toBeDefined();
    socket.emit('open');
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.resolve();
    await Promise.resolve();
    expect(internals.tutorState.conversation.currentQuestion).toBe('Welcome. How can I help?');
    expect(internals.tutorLiveFailed).toBe(true);
    expect(generateTutor.mock.calls.some(([request]) => request.kind === 'conversationOpening')).toBe(true);
  });

  it('uses the Standard opening when the Live server returns an error', async () => {
    const socket = new FakeSocket();
    const { internals, generateTutor } = liveProvider(() => socket);
    await internals.handleMessage({ command: 'startTutorConversation' });
    await waitForLiveSession(internals);
    socket.emit('open');
    socket.message({ setupComplete: {} });
    await waitForSent(socket, 2);
    socket.message({ error: { message: 'server body must stay private' } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));
    expect(internals.tutorState.conversation.currentQuestion).toBe('Welcome. How can I help?');
    expect(generateTutor.mock.calls.some(([request]) => request.kind === 'conversationOpening')).toBe(true);
  });

  // Added 2026-09-19 from the V121 review, which reproduced this with a probe.
  it('closes a session that failed, and ignores anything it sends afterwards', async () => {
    const sockets: FakeSocket[] = [];
    const { internals, postMessage } = liveProvider(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    await internals.handleMessage({ command: 'startTutorConversation' });
    await waitForLiveSession(internals);
    const first = sockets[0]!;
    first.emit('open');
    first.message({ setupComplete: {} });
    await waitForSent(first, 2);
    // An opening that completes with no words at all is a failure, and falls back.
    first.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));
    expect(first.closeCalls).toBeGreaterThanOrEqual(1);

    postMessage.mockClear();
    first.message({ serverContent: { outputTranscription: { text: 'STALE ' } } });
    expect(postMessage.mock.calls.some(([message]) =>
      JSON.stringify(message).includes('STALE'))).toBe(false);
  });

  // Changed 2026-09-19 for 1.67.0: the owner chose "KREN corrects as it replies" and heard no
  // spoken correction. A change now reaches Gemini at once as a note that asks for no reply,
  // because a spoken Talk turn has no text turn for the note to travel with.
  it('tells the live session about a Register or Correction change at once, without asking for a reply', async () => {
    const socket = new FakeSocket();
    const { internals } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);

    await internals.handleMessage({ command: 'updateTutorConversationRegister', input: 'formal' });
    await internals.handleMessage({ command: 'updateTutorConversationCoaching', input: 'teaching' });
    // Changed 2026-09-24 after the owner chose spoken Live opening B: these notes follow its
    // session-owned opening turn.
    await waitForSent(socket, 4);
    const register = JSON.parse(socket.sent[2]!).clientContent;
    const teaching = JSON.parse(socket.sent[3]!).clientContent;
    expect(register.turnComplete).toBe(false);
    expect(teaching.turnComplete).toBe(false);
    expect(register.turns[0].parts[0].text).toContain('not said by the learner');
    expect(register.turns[0].parts[0].text).toContain('formal register');
    expect(teaching.turns[0].parts[0].text).toContain('begin your reply by saying the corrected version');

    internals.tutorState.conversation.draftAnswer = 'I need a plumber.';
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    await waitForSent(socket, 5);
    const parts = JSON.parse(socket.sent[4]!).clientContent.turns[0].parts as Array<{ text: string }>;
    expect(parts).toEqual([{ text: 'I need a plumber.' }]);
  });

  it('asks Gemini Live for a spoken correction in teaching mode from the start', async () => {
    const socket = new FakeSocket();
    const { internals } = liveProvider(() => socket);
    internals.tutorState.conversation.coaching = 'teaching';
    await internals.handleMessage({ command: 'startTutorConversation' });
    await waitForLiveSession(internals);
    socket.emit('open');
    await waitForSent(socket, 1);
    const instruction = JSON.parse(socket.sent[0]!).setup.systemInstruction.parts[0].text as string;
    expect(instruction).toContain('begin your reply by saying the corrected version of their sentence out loud');
    expect(instruction).not.toContain('quote the complete correction text verbatim');
  });

  it('does not prefix a fully qualified live model name twice', async () => {
    const socket = new FakeSocket();
    const session = new TutorLiveSession({
      apiKey: TEST_CREDENTIAL,
      model: 'models/gemini-3.8-live',
      systemInstruction: 'Setting.',
      socketFactory: () => socket,
      onText: () => undefined,
      onAudio: () => undefined
    });
    void session.connect().catch(() => undefined);
    socket.emit('open');
    expect(JSON.parse(socket.sent[0]!).setup.model).toBe('models/gemini-3.8-live');
  });

  // Added 2026-09-19 after the owner's first connected Live session: text streamed, no sound
  // played, and the microphone stayed grey for the whole conversation.
  function panelScript(): string {
    const state = createTutorViewState();
    Object.assign(state.conversation, { status: 'active', replies: 'liveGemini', speakerOn: true });
    const html = renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
      activeScreen: 'tutor', tutor: state, proModels: [] });
    return [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gu)].map((match) => match[1]).join('\n');
  }
  function scriptFunction(script: string, name: string): string {
    const start = script.indexOf(`function ${name}(`);
    expect(start, name).toBeGreaterThan(-1);
    return script.slice(start, script.indexOf('\n    }\n', start));
  }

  // Updated 2026-09-19 for V122: the extension host owns Live PCM, so the panel must have
  // no Web Audio unlock path or audio protocol left to regress behind a user gesture.
  it('contains no Live Web Audio context, gesture unlock, player, or status message', () => {
    const script = panelScript();
    expect(script).not.toContain('ensureTutorLiveAudioContext');
    expect(script).not.toContain('playTutorLiveAudioChunk');
    expect(script).not.toContain("for (const gesture of ['pointerdown', 'keydown'])");
    expect(script).not.toContain('tutorLiveAudioStatus');
  });

  // Updated 2026-09-19 for V122: rate interpretation moved with playback to the host.
  it('uses 24 kHz when the host receives a chunk with no stated rate', () => {
    expect(pcmSampleRate('audio/pcm')).toBe(24_000);
    expect(pcmSampleRate('audio/pcm;rate=22050')).toBe(22_050);
  });

  it('re-enables the microphone and Replay from what is true after a live reply', () => {
    const ready = scriptFunction(panelScript(), 'markTutorLiveConversationReady');
    expect(ready).toContain('data-tutor-dictation-route-unavailable');
    expect(ready).not.toContain("getAttribute('data-tutor-dictation-disabled')");
    expect(ready).toContain('updateTutorLiveReplay');
  });

  it('shows an unavailable Live microphone after the host refuses a Talk press', () => {
    const talk = scriptFunction(panelScript(), 'updateTutorLiveTalk');
    expect(talk).toContain('Live microphone is unavailable');
    expect(talk).toContain('microphone.disabled = true');
  });

  it('marks the microphone busy but not unavailable while KREN is still opening', () => {
    const state = createTutorViewState();
    Object.assign(state.conversation, { status: 'active', busy: true, replies: 'liveGemini' });
    state.speech.handyStatus = 'available';
    const $ = load(renderTutorConversation(state));
    const microphone = $('[data-command="dictateTutorConversation"]');
    expect(microphone.attr('data-tutor-dictation-disabled')).toBe('true');
    expect(microphone.attr('data-tutor-dictation-route-unavailable')).toBe('false');
  });

  it('labels the Live microphone Talk to KREN and Stop talking with the active style', () => {
    const state = createTutorViewState();
    Object.assign(state.conversation, { status: 'active', replies: 'liveGemini' });
    const ready = load(renderTutorConversation(state, 'auto', true, false, true, false));
    const talk = ready('[data-command="dictateTutorConversation"]');
    expect(talk.attr('title')).toBe('Talk to KREN');
    expect(talk.attr('aria-label')).toBe('Talk to KREN');
    expect(talk.attr('aria-pressed')).toBe('false');
    expect(talk.hasClass('tutor-dictation-active')).toBe(false);

    const listening = load(renderTutorConversation(state, 'auto', true, false, true, true));
    const stop = listening('[data-command="dictateTutorConversation"]');
    expect(stop.attr('title')).toBe('Stop talking');
    expect(stop.attr('aria-label')).toBe('Stop talking');
    expect(stop.attr('aria-pressed')).toBe('true');
    expect(stop.hasClass('tutor-dictation-active')).toBe(true);
  });

  it('labels both Press to talk states with the setting captured by the Live session', () => {
    const state = createTutorViewState();
    Object.assign(state.conversation, { status: 'active', replies: 'liveGemini' });
    const ready = load(renderTutorConversation(state, 'auto', true, false, true, false, true));
    expect(ready('[data-command="dictateTutorConversation"]').attr('title')).toBe('Press to talk');
    const listening = load(renderTutorConversation(state, 'auto', true, false, true, true, true));
    expect(listening('[data-command="dictateTutorConversation"]').attr('title'))
      .toBe('Press when you finish');
  });

  it('keeps the Handy auto-send watcher out of Talk mode', () => {
    const script = panelScript();
    expect(script).toContain("const liveTalk = target.getAttribute('data-tutor-live-talk') === 'true'");
    expect(script).toContain('if (liveTalk) {\n          cancelTutorHandyAutoSend();');
  });

  it('keeps one state-titled Replay disabled without Live audio and enables it after Stop', () => {
    const state = createTutorViewState();
    Object.assign(state.conversation, {
      status: 'active', replies: 'liveGemini', speakerOn: true, currentQuestion: 'A Live reply.'
    });
    const unavailable = load(renderTutorConversation(state, 'auto', true, false));
    const replay = unavailable('[data-command="replayTutorQuestion"]');
    expect(replay.attr('disabled')).toBe('disabled');
    // Changed 2026-09-20: the title names the button's job, including while unavailable.
    expect(replay.attr('title')).toBe('Replay the last thing KREN said');
    expect(unavailable('[data-command="replayTutorConversation"]')).toHaveLength(0);

    state.conversation.status = 'stopped';
    state.conversation.transcript = [{
      question: 'A Live reply.', learnerAnswer: 'My answer.', correction: 'My answer.', explanation: ''
    }];
    // Changed 2026-09-20: the host passes whole-conversation availability separately from
    // the active reply's Replay availability.
    const stopped = load(renderTutorConversation(state, 'auto', true, false, false, false, false, true));
    expect(stopped('[data-command="replayTutorQuestion"]').attr('disabled')).toBeUndefined();
    expect(stopped('[data-command="replayTutorQuestion"]').attr('title')).toBe('Replay the conversation');

    const available = load(renderTutorConversation(state, 'auto', true, true, false, false, false, true));
    expect(available('[data-command="replayTutorQuestion"]').attr('disabled')).toBeUndefined();
  });

  it('logs the first host audio chunk format', async () => {
    const socket = new FakeSocket();
    const { internals, actions } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    // 2026-09-26: Only a requested reply reaches the audio format logger.
    // 2026-10-02: V187 holds the reply until classification or the 1500 ms limit.
    vi.useFakeTimers();
    socket.message({ serverContent: { inputTranscription: { text: 'A spoken answer.' } } });
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAA=' } }] } } });
    await vi.advanceTimersByTimeAsync(1500);
    vi.useRealTimers();
    expect(actions.log).toHaveBeenCalledWith('[conversation Live audio] first chunk received, audio/pcm;rate=24000');
  });

  // Added 2026-10-02: V183 retries archived checks without sending conversational text.
  it.each(['standard', 'liveGemini'] as const)('V183 Retry checks one failed %s turn in place and rejects duplicate presses', async (replies) => {
    const socket = new FakeSocket();
    const { internals, generateTutor, postMessage } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    const original = {
      question: 'Where did you go?', learnerAnswer: 'I go yesterday.', reply: 'What happened next?',
      correction: '', explanation: '', coachingFailed: true as const
    };
    Object.assign(internals.tutorState.conversation, { replies, transcript: [original], currentQuestion: original.reply });
    const rendered = load(renderTutorConversation(internals.tutorState));
    const retry = rendered('[data-tutor-coaching-failed] [data-command="retryTutorTurnCheck"]');
    expect(retry).toHaveLength(1);
    expect(retry.attr('data-tutor-turn')).toBe('0');
    expect(retry.attr('aria-label')).toBe('Check this turn again');
    expect(retry.attr('title')).toBe('Check this turn again');
    expect(retry.find('svg')).toHaveLength(1);
    let resolve!: (value: unknown) => void;
    const response = new Promise((done) => { resolve = done; });
    generateTutor.mockImplementation(() => response as never);
    generateTutor.mockClear();
    const sent = socket.sent.length;
    const html = internals.view!.webview.html;
    internals.tutorState.conversation.busy = true;
    await internals.handleMessage({ command: 'retryTutorTurnCheck', input: '0' });
    expect(generateTutor).not.toHaveBeenCalled();
    internals.tutorState.conversation.busy = false;
    const first = internals.handleMessage({ command: 'retryTutorTurnCheck', input: '0' });
    await vi.waitFor(() => expect(generateTutor).toHaveBeenCalledTimes(1));
    expect(internals.tutorState.conversation.transcript[0]?.coachingPending).toBe(true);
    expect(load(renderTutorConversation(internals.tutorState))('[data-command="retryTutorTurnCheck"]').is('[disabled]')).toBe(true);
    await internals.handleMessage({ command: 'retryTutorTurnCheck', input: '0' });
    expect(generateTutor).toHaveBeenCalledTimes(1);
    resolve({ move: 'recast', reply: 'Unused reply.', replyQuote: '', correction: 'I went yesterday.',
      explanation: 'Use past tense.', targetId: '', rephrase: 'Yesterday, I went.', rephraseWhy: 'This is natural.' });
    await first;
    expect(internals.tutorState.conversation.transcript[0]).toMatchObject({
      ...original, correction: 'I went yesterday.', explanation: 'Use past tense.', coachingFailed: undefined
    });
    expect(internals.tutorState.conversation.transcript).toHaveLength(1);
    expect(socket.sent).toHaveLength(sent);
    expect(internals.view!.webview.html).toBe(html);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'tutorLiveTurnCoaching', index: 0, coachingFailed: false, correction: 'I went yesterday.'
    }));
    expect(load(renderTutorConversation(internals.tutorState))('[data-tutor-coaching-failed]')).toHaveLength(0);
    await internals.handleMessage({ command: 'stopTutorConversation' });
  });

  it('V183 retries a stopped deferred check and leaves the failure retryable on another failure', async () => {
    const socket = new FakeSocket();
    const { internals, generateTutor, postMessage } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'stopTutorConversation' });
    Object.assign(internals.tutorState.conversation, { coaching: 'afterwards', transcript: [{
      question: 'Where?', learnerAnswer: 'I go yesterday.', reply: 'Next question?',
      correction: '', explanation: '', coachingFailed: true
    }] });
    generateTutor.mockImplementation(async () => { throw new Error('Check still unavailable.'); });
    await internals.handleMessage({ command: 'retryTutorTurnCheck', input: '0' });
    expect(internals.tutorState.conversation.transcript[0]).toMatchObject({ coachingFailed: true, coachingPending: undefined });
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorLiveTurnCoaching', coachingFailed: true, coachingPending: false }));
    const retry = load(renderTutorConversation(internals.tutorState))('[data-command="retryTutorTurnCheck"]');
    expect(retry.is('[disabled]')).toBe(false);
    generateTutor.mockImplementation(async () => ({ corrections: [{ correction: 'I went yesterday.', explanation: 'Use past tense.',
      targetId: '', rephrase: 'Yesterday, I went.', rephraseWhy: 'This is natural.' }] }));
    generateTutor.mockClear();
    await internals.handleMessage({ command: 'retryTutorTurnCheck', input: '0' });
    expect(generateTutor).toHaveBeenCalledWith(expect.objectContaining({ kind: 'conversationCorrections' }), expect.anything(), expect.anything());
    expect(JSON.parse(generateTutor.mock.calls[0]![0].input).turns).toHaveLength(1);
    expect(internals.tutorState.conversation.transcript[0]).toMatchObject({ correction: 'I went yesterday.', reply: 'Next question?', coachingFailed: undefined });
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorLiveTurnCoaching', showFeedback: true }));
  });

  // 2026-10-02: V183b limits discarded final tokens to one letter or the shared filler list.
  it.each(['I.', 'A', 'Uh', 'Um.'])('V183 discards final short transcript %s without a balloon or check and keeps the reply', async (text) => {
    const socket = new FakeSocket();
    const { internals, generateTutor, postMessage } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    generateTutor.mockClear();
    postMessage.mockClear();
    socket.message({ serverContent: { inputTranscription: { text } } });
    socket.message({ serverContent: { outputTranscription: { text: 'Could you please say it again?' } } });
    socket.message({ serverContent: { turnComplete: true } });
    expect(internals.tutorState.conversation.transcript).toHaveLength(0);
    expect(generateTutor).not.toHaveBeenCalled();
    expect(postMessage.mock.calls.some(([m]) => (m as { command: string }).command === 'tutorLiveInputFragment')).toBe(false);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorLiveInputDiscarded' }));
    expect(internals.tutorLiveInputText).toBe('');
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorLiveReplyFragment', text: 'Could you please say it again?' }));
    const rendered = load(renderTutorConversation(internals.tutorState));
    expect(rendered('[data-tutor-learner-turn]')).toHaveLength(0);
    expect(rendered('[data-tutor-kren-bubble]').text()).toContain('Could you please say it again?');
    await internals.handleMessage({ command: 'stopTutorConversation' });
    const stopped = load(internals.view!.webview.html);
    expect(stopped('[data-tutor-kren-bubble]').text()).toContain('Could you please say it again?');
    expect(stopped('[data-tutor-learner-turn]')).toHaveLength(0);
    await internals.handleMessage({ command: 'startNewTutorConversation' });
    expect(internals.tutorState.conversation.unansweredReplies).toBeUndefined();
  });

  // 2026-10-02: V186b retains interrupted discarded-input replies through full renders.
  it('V186b archives the partial reply to I. on interruption through Stop and Back to chat', async () => {
    const socket = new FakeSocket();
    const { internals, generateTutor, postMessage } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    generateTutor.mockClear(); postMessage.mockClear();
    socket.message({ serverContent: { inputTranscription: { text: 'I.' } } });
    socket.message({ serverContent: { outputTranscription: { text: 'Could you repeat that?' } } });
    socket.message({ serverContent: { interrupted: true } });
    expect(internals.tutorState.conversation.transcript).toHaveLength(0);
    expect(internals.tutorState.conversation.unansweredReplies).toEqual([
      { beforeTurn: 0, text: 'Welcome. How can I help?' },
      { beforeTurn: 0, text: 'Could you repeat that?' }
    ]);
    expect(generateTutor).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorLiveIgnoredTurnComplete' }));
    const replies = (html: string) => load(html)('[data-tutor-kren-bubble]').map((_i, node) => load(html)(node).text()).get();
    const archived = replies(renderTutorConversation(internals.tutorState));
    expect(archived).toEqual(['Welcome. How can I help?', 'Could you repeat that?']);
    await internals.handleMessage({ command: 'stopTutorConversation' });
    expect(replies(internals.view!.webview.html)).toEqual(archived);
    await internals.handleMessage({ command: 'resumeTutorConversation' });
    expect(replies(internals.view!.webview.html)).toEqual(archived);
  });

  it('V183b keeps hands-free capture visibly listening after an I. reply completes', async () => {
    const socket = new FakeSocket();
    const { internals, postMessage, waveInSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    postMessage.mockClear();
    socket.message({ serverContent: { inputTranscription: { text: 'I.' } } });
    socket.message({ serverContent: { outputTranscription: { text: 'Say it again?' } } });
    socket.message({ serverContent: { turnComplete: true } });
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'tutorLiveIgnoredTurnComplete', talkAvailable: true, listening: true
    }));
    expect(waveInSession.stop).not.toHaveBeenCalled();
    internals.refresh();
    expect(load(internals.view!.webview.html)('[data-tutor-chat-mic-control]').attr('aria-pressed')).toBe('true');
  });

  it.each(['disconnect', 'interrupted', 'Stop', 'Start new'] as const)(
    'V183b clears pending discarded-input busy state on %s', async (ending) => {
      const socket = new FakeSocket();
      const { internals, generateTutor } = liveProvider(() => socket);
      await openLiveConversation(internals, socket);
      socket.message({ serverContent: { inputTranscription: { text: 'I.' } } });
      socket.message({ serverContent: { outputTranscription: { text: 'Say it again?' } } });
      expect(internals.tutorState.conversation.busy).toBe(true);
      if (ending === 'disconnect') socket.emit('close');
      else if (ending === 'interrupted') socket.message({ serverContent: { interrupted: true } });
      else {
        await internals.handleMessage({ command: 'stopTutorConversation' });
        if (ending === 'Start new') await internals.handleMessage({ command: 'startNewTutorConversation' });
      }
      expect(internals.tutorState.conversation.busy).toBe(false);
      expect(internals.tutorLiveInputReplyPending).toBe(false);
      expect(internals.tutorLiveInputText).toBe('');
      expect(internals.tutorState.conversation.transcript).toHaveLength(0);
      if (ending === 'disconnect' || ending === 'interrupted') {
        internals.tutorState.conversation.draftAnswer = 'I am ready.';
        generateTutor.mockClear();
        const sent = socket.sent.length;
        await internals.handleMessage({ command: 'submitTutorConversationTurn' });
        if (ending === 'interrupted') {
          // 2026-10-02: A typed Live turn checks after its conversational reply completes.
          await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(sent));
          socket.message({ serverContent: { outputTranscription: { text: 'Let us begin.' }, turnComplete: true } });
        }
        await vi.waitFor(() => expect(generateTutor).toHaveBeenCalled());
      }
    }
  );

  it('V183b restores I followed by am ready after the first Gemini audio and drains the input buffer', async () => {
    const socket = new FakeSocket();
    const { internals, generateTutor, postMessage } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    generateTutor.mockClear();
    postMessage.mockClear();
    socket.message({ serverContent: { inputTranscription: { text: 'I' } } });
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: { data: 'AAA=', mimeType: 'audio/pcm;rate=24000' } }] } } });
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorLiveInputDiscarded' }));
    expect(generateTutor).not.toHaveBeenCalled();
    socket.message({ serverContent: { inputTranscription: { text: ' am ready.' } } });
    socket.message({ serverContent: { outputTranscription: { text: 'Let us begin.' }, turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));
    expect(internals.tutorState.conversation.transcript[0]?.learnerAnswer).toBe('I am ready.');
    expect(generateTutor).toHaveBeenCalledWith(expect.objectContaining({ kind: 'conversationCorrections', input: expect.stringContaining('I am ready.') }), expect.anything(), expect.anything());
    expect(internals.tutorLiveInputText).toBe('');
    expect(internals.tutorLiveInputReplyPending).toBe(false);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorLiveInputCommitted', text: 'I am ready.' }));
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorLiveInputDiscarded' }));
  });

  it.each(['No.', 'OK', 'Hi', 'Yes'])('V183b keeps and checks the real answer %s', async (text) => {
    const socket = new FakeSocket();
    const { internals, generateTutor, postMessage } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    generateTutor.mockClear();
    postMessage.mockClear();
    socket.message({ serverContent: { inputTranscription: { text } } });
    socket.message({ serverContent: { outputTranscription: { text: 'Thank you.' }, turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));
    expect(generateTutor).toHaveBeenCalledWith(expect.objectContaining({ kind: 'conversationCorrections', input: expect.stringContaining(text) }), expect.anything(), expect.anything());
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorLiveInputDiscarded' }));
    expect(load(renderTutorConversation(internals.tutorState))('[data-tutor-learner-answer]').text()).toMatch(new RegExp(text.replace('.', '\\.')));
  });

  it('V183b stores the normalized Retry answer for both the coaching patch and full render', async () => {
    const socket = new FakeSocket();
    const { internals, generateTutor, postMessage } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    internals.tutorState.conversation.transcript = [{
      question: 'Where do you live?', learnerAnswer: 'i live in seoul.', spoken: true,
      reply: 'What do you like there?', correction: '', explanation: '', coachingFailed: true
    }];
    generateTutor.mockResolvedValue({ move: 'recast', reply: 'Unused.', replyQuote: '',
      correction: 'I live in Seoul.', explanation: 'Capitalization.', targetId: '',
      rephrase: 'Seoul is where I live.', rephraseWhy: 'This is natural.' });
    await internals.handleMessage({ command: 'retryTutorTurnCheck', input: '0' });
    // Changed 2026-10-16: V253, owner item I34, a Retry response without spokenPunctuated keeps the local form.
    expect(internals.tutorState.conversation.transcript[0]?.learnerAnswer).toBe('I live in seoul.');
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorLiveTurnCoaching', correction: 'I live in Seoul.', spokenEquivalent: true }));
    internals.refresh();
    expect(load(internals.view!.webview.html)('[data-tutor-learner-answer]').text()).toBe('I live in seoul.');
  });

  it.each(['completed', 'running'] as const)('V183b invalidates a %s five-turn diagnosis after successful Retry', async (status) => {
    const socket = new FakeSocket();
    const { internals, generateTutor } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    internals.tutorState.conversation.transcript = Array.from({ length: 5 }, () => ({
      question: 'Where did you go?', learnerAnswer: 'I go yesterday.', reply: 'Tell me more.',
      correction: '', explanation: '', coachingFailed: true as const
    }));
    await internals.handleMessage({ command: 'stopTutorConversation' });
    let resolveDiagnosis!: (value: unknown) => void;
    const report = { summary: 'Old evidence.', findings: [], targets: [], focus: 'Past tense.' };
    const base = generateTutor.getMockImplementation()!;
    generateTutor.mockImplementation((request) => request.kind === 'conversationDiagnosis'
      ? status === 'completed' ? Promise.resolve(report) : new Promise((resolve) => { resolveDiagnosis = resolve; })
      : base(request));
    const diagnosis = internals.handleMessage({ command: 'diagnoseTutorConversation' });
    await vi.waitFor(() => expect(generateTutor).toHaveBeenCalledWith(expect.objectContaining({ kind: 'conversationDiagnosis' }), expect.anything(), expect.anything()));
    if (status === 'completed') {
      await diagnosis;
      // 2026-10-11: wait for the asynchronous Thorough boundary to publish the completed diagnosis.
      await vi.waitFor(() => expect(internals.tutorState.diagnosticReportSource).toEqual({ kind: 'conversation', turnCount: 5 }));
      expect(internals.tutorState.diagnosticReport).toBeDefined();
    }
    const controller = internals.tutorTargetSearchController;
    await internals.handleMessage({ command: 'retryTutorTurnCheck', input: '0' });
    if (status === 'running') {
      expect(controller?.signal.aborted).toBe(true);
      resolveDiagnosis(report);
      await diagnosis;
    }
    expect(internals.tutorState.diagnosticReport).toBeUndefined();
    expect(internals.tutorState.diagnosticReportSource).toBeUndefined();
    expect(internals.tutorState.askBusy).toBeUndefined();
    // 2026-10-02: A running diagnosis has never opened its drawer; both false and unset mean closed.
    expect(internals.tutorState.diagnosticReportDrawerOpen === true).toBe(false);
    expect(internals.tutorState.conversation.transcript[0]?.coachingFailed).toBeUndefined();
  });

  it('V183b replays the Standard opening after an early Stop and explains an unavailable replay', async () => {
    const { provider, internals, actions, postMessage } = liveProvider(() => new FakeSocket());
    internals.tutorState.conversation.replies = 'standard';
    internals.tutorState.conversation.speakerOn = true;
    await internals.handleMessage({ command: 'startTutorConversation' });
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));
    const opening = internals.tutorState.conversation.currentQuestion;
    expect(opening.trim()).not.toBe('');
    expect(load(renderTutorConversation(internals.tutorState))('[data-command="replayTutorQuestion"]').is('[disabled]')).toBe(false);
    await internals.handleMessage({ command: 'stopTutorConversation' });
    expect(internals.tutorState.conversation.transcript).toHaveLength(0);
    const replay = load(internals.view!.webview.html)('[data-command="replayTutorQuestion"]');
    expect(replay.is('[disabled]')).toBe(false);
    expect(replay.attr('aria-label')).toBe('Replay the conversation');
    actions.readAloudText.mockClear();
    const panel = mountedPanel(internals.view!.webview.html, () => {});
    postMessage.mockImplementation(async message => { panel.message(message as Record<string, unknown>); return true; });
    let endReplay!: () => void;
    actions.readAloudText.mockImplementation(() => new Promise<void>(resolve => { endReplay = resolve; }));
    await internals.handleMessage({ command: 'replayTutorQuestion' });
    await vi.waitFor(() => expect(actions.readAloudText).toHaveBeenCalledWith(opening, 'en', 'tutor'));
    internals.tutorState.conversation.currentQuestion = '';
    internals.refresh();
    // 2026-10-13: V230 patches during replay, so inspect the mounted control rather than the first HTML string.
    const unavailable = panel.query('[data-command="replayTutorQuestion"]')!;
    expect(unavailable.disabled).toBe(true);
    expect(unavailable.title).toMatch(/has not said anything/i);
    endReplay();
    await vi.waitFor(() => expect(provider.tutorConversationSpeechSequenceRunning).toBe(false));
    provider.dispose();
  });

  it('V183b scrolls to stopped actions only on the render that completes Stop', async () => {
    const socket = new FakeSocket();
    const { internals } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'stopTutorConversation' });
    expect(load(internals.view!.webview.html)('script').text()).toContain('scrollTutorStoppedActions();');
    internals.refresh();
    expect(load(internals.view!.webview.html)('[data-tutor-stopped-actions]')).toHaveLength(1);
    expect(load(internals.view!.webview.html)('script').text()).not.toContain('scrollTutorStoppedActions();');
  });

  it('V183 replays retained Live audio after Stop even when earlier clips are missing', async () => {
    const socket = new FakeSocket();
    const { internals, actions, waveOutSession, postMessage } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    internals.tutorState.conversation.transcript = [{ question: 'Missing clip.', learnerAnswer: 'An answer.', correction: '', explanation: '' }];
    internals.tutorLiveReplyAudio = [{ data: 'AAA=', mimeType: 'audio/pcm;rate=24000' }];
    internals.tutorLiveReplyAudioComplete = true;
    await internals.handleMessage({ command: 'stopTutorConversation' });
    const rendered = load(internals.view!.webview.html);
    expect(rendered('[data-command="replayTutorQuestion"]').is('[disabled]')).toBe(false);
    expect(rendered('[data-command="replayTutorQuestion"]').attr('aria-label')).toBe('Replay the conversation');
    await internals.handleMessage({ command: 'replayTutorQuestion' });
    await vi.waitFor(() => expect(waveOutSession.play).toHaveBeenCalled());
    expect(actions.readAloudText).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorReplayAllState', pressed: true }));
    await internals.handleMessage({ command: 'replayTutorQuestion' });
    internals.tutorLiveConversationAudio.clear();
    internals.refresh();
    const unavailable = load(internals.view!.webview.html)('[data-command="replayTutorQuestion"]');
    expect(unavailable.is('[disabled]')).toBe(true);
    expect(unavailable.attr('title')).toContain('No retained Live audio');
  });

  it('V135 keeps the Live reply but marks failed coaching as unchecked instead of correct', async () => {
    const socket = new FakeSocket();
    const { internals, generateTutor, actions, postMessage } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    generateTutor.mockImplementation(async (request: TutorStructuredGenerationRequest) => {
      if (isInlineTutorTurn(request)) throw new Error('coaching unavailable');
      return {};
    });
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    socket.message({ serverContent: { inputTranscription: { text: 'Already natural.' } } });
    socket.message({ serverContent: { outputTranscription: { text: 'Thanks for explaining.' } } });
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));
    // Changed 2026-09-23: V141 commits the turn when the spoken reply ends, so the failure
    // now arrives afterwards and patches the turn it belongs to. What this test guards is
    // unchanged: a check that failed is never presented as a correct answer.
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript[0]).toMatchObject({
      reply: 'Thanks for explaining.',
      learnerAnswer: 'Already natural.',
      spoken: true,
      correction: '',
      explanation: '',
      coachingFailed: true
    }));
    expect(internals.tutorState.conversation.transcript[0]?.coachingPending).toBeUndefined();
    // Added 2026-09-21: an unchecked turn carries an empty correction, which differs from the
    // learner's answer, so without its own guard the panel would build a feedback block with
    // nothing in it. Mutation on 2026-09-21 showed the guard was otherwise unprotected.
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'tutorLiveTurnCoaching',
      coachingFailed: true,
      feedbackEligible: false,
      showFeedback: false
    }));
    const rendered = load(renderTutorConversation(internals.tutorState));
    expect(rendered('[data-tutor-coaching-failed]').text()).toBe('KREN could not check this turn.');
    expect(rendered('[data-tutor-turn-feedback]')).toHaveLength(0);
    expect(actions.log).toHaveBeenCalledWith(expect.stringContaining('Live coaching failed'));
  });

interface CoachingTurnResponse {
  move: string; reply: string; replyQuote: string; correction: string;
  targetId: string; explanation: string; rephrase: string; rephraseWhy: string;
  nextQuestion?: string;
}

  it('V141 commits a spoken turn when the Live reply ends before coaching returns', async () => {
    // Added 2026-09-23 for V16: the separate correction is not part of the spoken turn boundary.
    const socket = new FakeSocket();
    let finishCoaching!: (value: CoachingTurnResponse) => void;
    const coaching = new Promise<CoachingTurnResponse>((resolve) => { finishCoaching = resolve; });
    const { internals, generateTutor, postMessage } = liveProvider(() => socket);
    generateTutor.mockImplementation((request: TutorStructuredGenerationRequest) => {
      if (request.kind === 'liveSessionCredential') {
        return Promise.resolve({ apiKey: TEST_CREDENTIAL });
      }
      if (request.kind === 'conversationOpening') return Promise.resolve(LIVE_OPENING_RESPONSE);
      if (isInlineTutorTurn(request)) return coaching;
      return Promise.resolve({});
    });
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    socket.message({ serverContent: { inputTranscription: { text: 'I go yesterday.' } } });
    socket.message({ serverContent: { outputTranscription: { text: 'What did you do there?' } } });
    socket.message({ serverContent: { turnComplete: true } });

    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    expect(internals.tutorState.conversation.busy).toBe(false);
    expect(internals.tutorState.conversation.transcript[0]).toMatchObject({
      learnerAnswer: 'I go yesterday.',
      reply: 'What did you do there?',
      coachingPending: true
    });
    expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: true,
      title: 'Stop is available when this turn finishes'
    });

    finishCoaching({
      move: 'reaction', reply: 'Structured reply is ignored.', replyQuote: '', correction: 'I went yesterday.',
      targetId: '', explanation: 'Use the past tense.', rephrase: 'I went yesterday.',
      rephraseWhy: 'This naturally answers the question.', nextQuestion: 'Structured question?'
    });
    await vi.waitFor(() => expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: false, title: 'Stop conversation'
    }));
  });

  it('V155 keeps Stop disabled when correction finishes before the Live reply', async () => {
    const socket = new FakeSocket();
    let correctionResolved = false;
    const { internals, generateTutor, postMessage } = liveProvider(() => socket);
    generateTutor.mockImplementation(async (request: TutorStructuredGenerationRequest) => {
      if (request.kind === 'liveSessionCredential') return { apiKey: TEST_CREDENTIAL };
      if (request.kind === 'conversationOpening') return LIVE_OPENING_RESPONSE;
      if (isInlineTutorTurn(request)) {
        correctionResolved = true;
        return {
          move: 'reaction', reply: 'Structured reply is ignored.', replyQuote: '',
          correction: 'I went yesterday.', targetId: '', explanation: 'Use the past tense.',
          rephrase: 'I went yesterday.', rephraseWhy: 'This naturally answers the question.',
          nextQuestion: 'Structured question is ignored?'
        };
      }
      return {};
    });
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    // 2026-10-02: V187 holds the reply until classification or the 1500 ms limit.
    vi.useFakeTimers();
    socket.message({ serverContent: { inputTranscription: { text: 'I go yesterday.' } } });
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    postMessage.mockClear();

    socket.message({ serverContent: { outputTranscription: { text: 'What happened there?' } } });
    await vi.advanceTimersByTimeAsync(1500);
    vi.useRealTimers();
    await vi.waitFor(() => expect(correctionResolved).toBe(true));
    expect(internals.tutorState.conversation.busy).toBe(true);
    expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: true,
      title: 'Stop is available when this turn finishes'
    });

    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));
    await vi.waitFor(() => expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: false, title: 'Stop conversation'
    }));
  });

  it('V155 enables Stop after a When you stop reply without waiting for deferred coaching', async () => {
    const socket = new FakeSocket();
    const { internals, postMessage } = liveProvider(() => socket);
    internals.tutorState.conversation.coaching = 'afterwards';
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    socket.message({ serverContent: { inputTranscription: { text: 'Keep this for later.' } } });
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    postMessage.mockClear();
    socket.message({ serverContent: { outputTranscription: { text: 'What happened next?' } } });
    socket.message({ serverContent: { turnComplete: true } });

    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));
    expect(internals.tutorState.conversation.transcript[0]?.coachingPending).toBe(true);
    expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: false, title: 'Stop conversation'
    });
  });

  it('V141 accepts a second spoken turn and patches a late correction into the first turn', async () => {
    // Added 2026-09-23 for V16: V131's turn generation identifies the owner after moving on.
    const socket = new FakeSocket();
    let finishFirst!: (value: CoachingTurnResponse) => void;
    const firstCoaching = new Promise<CoachingTurnResponse>((resolve) => { finishFirst = resolve; });
    let turnRequests = 0;
    const { internals, generateTutor, postMessage } = liveProvider(() => socket);
    generateTutor.mockImplementation((request: TutorStructuredGenerationRequest) => {
      if (request.kind === 'liveSessionCredential') {
        return Promise.resolve({ apiKey: TEST_CREDENTIAL });
      }
      if (request.kind === 'conversationOpening') return Promise.resolve(LIVE_OPENING_RESPONSE);
      if (isInlineTutorTurn(request) && turnRequests++ === 0) return firstCoaching;
      if (isInlineTutorTurn(request)) return Promise.resolve({
        move: 'reaction', reply: 'Structured second reply.', replyQuote: '', correction: 'I stayed home.',
        targetId: '', explanation: 'The second turn is already natural.', rephrase: 'I stayed home.',
        rephraseWhy: 'This answer is already natural.',
        nextQuestion: 'Structured second question?'
      });
      return Promise.resolve({});
    });
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });

    socket.message({ serverContent: { inputTranscription: { text: 'I go yesterday.' } } });
    socket.message({ serverContent: { outputTranscription: { text: 'What did you do there?' } } });
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));

    socket.message({ serverContent: { inputTranscription: { text: 'I stayed home.' } } });
    socket.message({ serverContent: { outputTranscription: { text: 'Did you enjoy the day?' } } });
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(2));
    expect(internals.tutorState.conversation.transcript[1]).toMatchObject({
      learnerAnswer: 'I stayed home.', reply: 'Did you enjoy the day?'
    });

    finishFirst({
      move: 'recast', reply: 'Structured first reply is ignored.', replyQuote: '', correction: 'I went yesterday.',
      targetId: '', explanation: 'Use went for the past tense.', rephrase: 'I went yesterday.',
      rephraseWhy: 'This naturally answers the question.', nextQuestion: 'Old question?'
    });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript[0]).toMatchObject({
      correction: 'I went yesterday.', explanation: 'Use went for the past tense.'
    }));
    expect(internals.tutorState.conversation.transcript[0]?.coachingPending).toBeUndefined();
    expect(internals.tutorState.conversation.transcript[1]?.learnerAnswer).toBe('I stayed home.');
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'tutorLiveTurnCoaching', index: 0, correction: 'I went yesterday.'
    }));
  });

  it('V141 changes a committed turn from pending to unchecked when late coaching fails', async () => {
    // Added 2026-09-23 for V16 and V135: failure must never fabricate a correct result.
    const socket = new FakeSocket();
    let failCoaching!: (error: Error) => void;
    const coaching = new Promise<CoachingTurnResponse>((_resolve, reject) => { failCoaching = reject; });
    const { internals, generateTutor, postMessage } = liveProvider(() => socket);
    generateTutor.mockImplementation((request: TutorStructuredGenerationRequest) => {
      if (request.kind === 'liveSessionCredential') {
        return Promise.resolve({ apiKey: TEST_CREDENTIAL });
      }
      if (request.kind === 'conversationOpening') return Promise.resolve(LIVE_OPENING_RESPONSE);
      if (isInlineTutorTurn(request)) return coaching;
      return Promise.resolve({});
    });
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    socket.message({ serverContent: { inputTranscription: { text: 'Keep this turn.' } } });
    socket.message({ serverContent: { outputTranscription: { text: 'It is committed.' } } });
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));
    await internals.handleMessage({ command: 'dictateTutorConversation' });

    failCoaching(new Error('late coaching failed'));
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript[0]).toMatchObject({
      correction: '', explanation: '', coachingFailed: true
    }));
    expect(internals.tutorState.conversation.transcript[0]?.coachingPending).toBeUndefined();
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'tutorLiveTurnCoaching', index: 0, coachingFailed: true,
      feedbackEligible: false
    }));
    // Added 2026-09-25 for V155: once the microphone is off, a failed correction must
    // release Stop rather than leave the reader unable to end the conversation.
    expect(postMessage).toHaveBeenCalledWith({
      command: 'tutorConversationStopState', disabled: false, title: 'Stop conversation'
    });
  });

  it('V155 re-enables Stop when a pending correction is cancelled', async () => {
    const socket = new FakeSocket();
    const coaching = new Promise<CoachingTurnResponse>(() => undefined);
    const { internals, generateTutor, postMessage } = liveProvider(() => socket);
    generateTutor.mockImplementation((request: TutorStructuredGenerationRequest) => {
      if (request.kind === 'liveSessionCredential') return Promise.resolve({ apiKey: TEST_CREDENTIAL });
      if (request.kind === 'conversationOpening') return Promise.resolve(LIVE_OPENING_RESPONSE);
      if (isInlineTutorTurn(request)) return coaching;
      return Promise.resolve({});
    });
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    socket.message({ serverContent: { inputTranscription: { text: 'Cancel this check.' } } });
    socket.message({ serverContent: { outputTranscription: { text: 'The reply is complete.' } } });
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    expect(tutorStopStates(postMessage).at(-1)?.disabled).toBe(true);

    expect(internals.cancelTutorLiveCoachingRequests()).toBe(true);
    expect(internals.tutorState.conversation.transcript[0]).toMatchObject({
      coachingPending: undefined, coachingFailed: true
    });
    expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: false, title: 'Stop conversation'
    });
  });

  it('V155 re-enables Stop when the Live session ends during a reply', async () => {
    const socket = new FakeSocket();
    const { internals, postMessage } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    socket.message({ serverContent: { inputTranscription: { text: 'A reply that will fail.' } } });
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    postMessage.mockClear();
    socket.message({ serverContent: { outputTranscription: { text: 'An unfinished reply' } } });
    expect(internals.tutorState.conversation.busy).toBe(true);
    socket.emit('close');

    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));
    expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: false, title: 'Stop conversation'
    });
  });

  it('V155 last-resort timeout releases a stranded turn and logs the release', async () => {
    vi.useFakeTimers();
    const { internals, actions, postMessage } = liveProvider(() => new FakeSocket());
    Object.assign(internals.tutorState.conversation, {
      status: 'active', demoMode: false, busy: true, replies: 'standard'
    });
    // Changed 2026-09-25 for V156: an open hands-free microphone is no longer a second
    // gate after the timeout releases a stranded KREN turn.
    (internals as unknown as { tutorLiveMicrophone: unknown }).tutorLiveMicrophone = {};
    internals.postTutorConversationStopState();
    expect(tutorStopStates(postMessage).at(-1)?.disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(TUTOR_CONVERSATION_STOP_SAFETY_TIMEOUT_MS);
    expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: false, title: 'Stop conversation'
    });
    expect(actions.log).toHaveBeenCalledWith(
      `[conversation Stop safety timeout] Re-enabled Stop after ${TUTOR_CONVERSATION_STOP_SAFETY_TIMEOUT_MS} ms.`
    );
  });

  it('V155 keeps Demo Stop enabled even while Demo is busy and speaking', async () => {
    vi.useFakeTimers();
    const { internals, actions, postMessage } = liveProvider(() => new FakeSocket());
    Object.assign(internals.tutorState.conversation, {
      status: 'active', demoMode: true, busy: true
    });
    (internals as unknown as { tutorConversationSpeechSequenceRunning: boolean })
      .tutorConversationSpeechSequenceRunning = true;
    internals.postTutorConversationStopState();
    expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: false, title: 'Stop conversation'
    });
    await vi.advanceTimersByTimeAsync(TUTOR_CONVERSATION_STOP_SAFETY_TIMEOUT_MS);
    expect(actions.log).not.toHaveBeenCalledWith(expect.stringContaining('Stop safety timeout'));
  });

  it('V155 disables Stop during a Standard reply and re-enables it when that reply fails', async () => {
    let failReply!: (error: Error) => void;
    const reply = new Promise<{
      move: string; reply: string; replyQuote: string; correction: string;
      targetId: string; explanation: string; rephrase: string; rephraseWhy: string;
      nextQuestion: string;
    }>((_resolve, reject) => { failReply = reject; });
    const { internals, generateTutor } = liveProvider(() => new FakeSocket());
    generateTutor.mockImplementation((request: TutorStructuredGenerationRequest) =>
      isInlineTutorTurn(request) ? reply : Promise.resolve({})
    );
    Object.assign(internals.tutorState.conversation, {
      status: 'active', demoMode: false, replies: 'standard', speakerOn: false,
      currentQuestion: 'What happened?', draftAnswer: 'My answer.', busy: false
    });

    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    let $ = load(internals.view!.webview.html);
    expect($('[data-command="stopTutorConversation"]').is(':disabled')).toBe(true);
    expect($('[data-command="stopTutorConversation"]').attr('title'))
      .toBe('Stop is available when this turn finishes');

    failReply(new Error('reply failed'));
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));
    $ = load(internals.view!.webview.html);
    expect($('[data-command="stopTutorConversation"]').is(':disabled')).toBe(false);
  });

  it('V155 holds Stop through Standard read-aloud and releases it after speech ends', async () => {
    let finishSpeech!: () => void;
    const speech = new Promise<void>((resolve) => { finishSpeech = resolve; });
    const { internals, actions, postMessage } = liveProvider(() => new FakeSocket());
    actions.readAloudText.mockImplementation(() => speech);
    Object.assign(internals.tutorState.conversation, {
      status: 'active', demoMode: false, replies: 'standard', speakerOn: true,
      currentQuestion: 'What happened?', busy: false
    });

    internals.speakTutorConversationSequence(
      ['A complete spoken reply.'], 'The reply could not be read aloud.'
    );
    await vi.waitFor(() => expect(actions.readAloudText).toHaveBeenCalled());
    expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: true,
      title: 'Stop is available when this turn finishes'
    });

    finishSpeech();
    await vi.waitFor(() => expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: false, title: 'Stop conversation'
    }));
  });

  it('V155 holds Stop through Live playback and releases it on the final played buffer', async () => {
    const socket = new FakeSocket();
    const { internals, postMessage, reportWaveOutProgress } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    await internals.handleMessage({
      command: 'updateTutorConversationAnswer', answer: 'A typed Live answer.'
    });
    postMessage.mockClear();
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: {
      data: 'AQI=', mimeType: 'audio/pcm;rate=24000'
    } }] } } });
    socket.message({ serverContent: { outputTranscription: { text: 'A spoken Live reply.' } } });
    socket.message({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));
    expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: true,
      title: 'Stop is available when this turn finishes'
    });

    reportWaveOutProgress(1, 0);
    expect(tutorStopStates(postMessage).at(-1)).toEqual({
      command: 'tutorConversationStopState', disabled: false, title: 'Stop conversation'
    });
  });

  it('V155 leaves Stop enabled after a skipped Standard turn has completed', async () => {
    const { internals } = liveProvider(() => new FakeSocket());
    Object.assign(internals.tutorState.conversation, {
      status: 'active', demoMode: false, replies: 'standard', speakerOn: false,
      currentQuestion: 'Skip this one?', busy: false
    });

    await internals.handleMessage({ command: 'skipTutorConversationTurn' });
    expect(internals.tutorState.conversation.transcript.at(-1)?.skipped).toBe(true);
    const $ = load(internals.view!.webview.html);
    expect($('[data-command="stopTutorConversation"]').is(':disabled')).toBe(false);
  });

  it('renders the Live reply and Live model defaults and leaves audio rates to the host', () => {
    const state = createTutorViewState();
    const conversation = renderTutorConversation(state);
    expect(conversation).toContain('<span class="setting-title">Replies</span>');
    // Changed 2026-09-20: V125 makes Live the new-conversation default.
    expect(conversation).toContain('<option value="liveGemini" selected>Live (Gemini)</option>');
    expect(conversation).toContain('Live (Gemini)');
    // 2026-10-12: The compact ADVANCED summary calls this Reply.
    expect(conversation).toContain('Reply: Live');

    const html = renderKrenResultViewHtml({
      cspSource: 'test', nonce: 'nonce', settings: PANEL_SETTINGS_FIXTURE,
      activeScreen: 'tutor', tutor: state, proModels: []
    });
    // 2026-10-05: assert the setting's purpose without pinning label capitalization.
    const liveModelLabel = load(html)('[data-model-preset="tutor.liveModel"]').closest('.setting').find('.setting-title');
    expect(liveModelLabel.text()).toMatch(/^Live model$/iu);
    expect(html).toContain('data-setting="tutor.liveModel"');
    expect(html).toContain('value="gemini-3.8-live"');
    const liveModelAt = html.indexOf('data-setting="tutor.liveModel"');
    const liveLanguageAt = html.indexOf('data-setting="tutor.conversation.liveTranscriptionLanguage"');
    // Changed 2026-10-03: Live language belongs to conversation ADVANCED.
    expect(liveLanguageAt).toBeLessThan(liveModelAt);
    expect(conversation).toContain('data-setting="tutor.conversation.liveTranscriptionLanguage"');
    expect(html).toContain('<option value="english" selected>English</option>');
    expect(html).not.toContain('connect-src');
    expect(html).not.toContain('wss://generativelanguage.googleapis.com');

    const source = readFileSync('src/windowsWaveOutPlayer.ts', 'utf8');
    expect(source).toContain('rate=(\\d+)');
    expect(source).toContain(': 24_000');
    expect(readFileSync('src/resultViewHtml.ts', 'utf8')).not.toContain('AudioContextClass');
  });

  it('resets and closes host audio with the Live socket when the panel provider is disposed', async () => {
    const socket = new FakeSocket();
    const { provider, internals, waveOutSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    waveOutSession.stop.mockClear();
    provider.dispose();
    expect(socket.closeCalls).toBe(1);
    expect(waveOutSession.stop).toHaveBeenCalledOnce();
    expect(waveOutSession.close).toHaveBeenCalledOnce();
  });
});


describe('V182 Live English boundary', () => {
  it.each(['english', 'automatic'] as const)('sends the firm English rule early in setup even with %s transcription', async (language) => {
    vi.useRealTimers();
    workspaceGet.mockImplementation((key: string, fallback: unknown) => key === 'tutor.conversation.liveTranscriptionLanguage' ? language : fallback);
    const socket = new FakeSocket(); const { internals, provider } = liveProvider(() => socket);
    await internals.handleMessage({ command: 'startTutorConversation' });
    await waitForLiveSession(internals); socket.emit('open'); await waitForSent(socket, 1);
    const instruction = JSON.parse(socket.sent[0]!).setup.systemInstruction.parts[0].text as string;
    expect(instruction.slice(0, 500)).toContain("Speak and write only English, whatever language the learner's turn appears to be in.");
    expect(instruction).toContain('If a learner turn is not English, is unintelligible, or sounds like background noise');
    // Changed 2026-10-02: V183 keeps the English-only response, with a natural repeat request.
    expect(instruction).toContain('reply briefly in English that you did not catch that and ask the learner to say it again.');
    expect(instruction).toContain('Do not correct, translate, or answer the content of that turn.');
    expect(instruction).not.toContain('Treat the learner\'s speech transcript as English');
    // 2026-10-02: Keep the original Korean practice example intact in the sent Live setup.
    expect(instruction).toContain('how do you say 안녕하세요 in English?');
    socket.message({ setupComplete: {} }); provider.dispose();
  });
});

// 2026-10-02: V187 exercises the real socket, host, audio, and archived render paths.
describe('V187 hidden replies and speech detection', () => {
  beforeEach(() => {
    vi.useRealTimers();
    workspaceGet.mockImplementation((_key: string, fallback: unknown) => fallback);
  });
  afterEach(() => vi.useRealTimers());

  it.each(['kren', 'geminiKren'] as const)('V187 exact setup for %s', async (mode) => {
    workspaceGet.mockImplementation((key: string, fallback: unknown) =>
      key === 'tutor.conversation.speechDetection' ? mode :
      key === 'tutor.conversation.pauseBeforeReply' ? 3 : fallback);
    const socket = new FakeSocket();
    const { internals } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    expect(JSON.parse(socket.sent[0]!).setup.realtimeInputConfig).toEqual({
      automaticActivityDetection: mode === 'geminiKren'
        ? { disabled: false, startOfSpeechSensitivity: 'START_SENSITIVITY_LOW',
            endOfSpeechSensitivity: 'END_SENSITIVITY_LOW', silenceDurationMs: 3500 }
        : { disabled: true }
    });
  });

  it('V187 hybrid audio is continuous and audioStreamEnd occurs exactly at the chosen pause', async () => {
    workspaceGet.mockImplementation((key: string, fallback: unknown) =>
      key === 'tutor.conversation.speechDetection' ? 'geminiKren' :
      key === 'tutor.conversation.pauseBeforeReply' ? 3 : fallback);
    const socket = new FakeSocket();
    const { internals, emitWaveIn, waveOutSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    vi.useFakeTimers({ now: 1000 });
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    const wire = () => socket.sent.map((text) => JSON.parse(text)).filter((message) => message.realtimeInput);
    emitWaveIn(pcmChunk(30));
    emitWaveIn(pcmChunk(400)); emitWaveIn(pcmChunk(400));
    expect(wire().filter((message) => message.realtimeInput.audio)).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(301);
    emitWaveIn(pcmChunk(30));
    await vi.advanceTimersByTimeAsync(2698);
    expect(wire().filter((message) => message.realtimeInput.audioStreamEnd)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(wire().filter((message) => message.realtimeInput.audioStreamEnd)).toHaveLength(1);
    expect(wire().filter((message) => message.realtimeInput.activityStart || message.realtimeInput.activityEnd)).toHaveLength(0);
    emitWaveIn(pcmChunk(30));
    expect(wire().filter((message) => message.realtimeInput.audio)).toHaveLength(5);
    socket.message({ serverContent: { inputTranscription: { text: 'I am ready.' } } });
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: { data: 'AAA=', mimeType: 'audio/pcm;rate=24000' } }] } } });
    await vi.advanceTimersByTimeAsync(1500);
    const sent = socket.sent.length;
    emitWaveIn(pcmChunk(400));
    expect(socket.sent).toHaveLength(sent);
    socket.message({ serverContent: { interrupted: true } });
    expect(waveOutSession.stop).toHaveBeenCalled();
    expect(internals.tutorLiveReplyAudio).toEqual([]);
  });

  it('V187 Press to talk forces KREN setup while preserving the stored hybrid choice', async () => {
    workspaceGet.mockImplementation((key: string, fallback: unknown) =>
      key === 'tutor.conversation.speechDetection' ? 'geminiKren' :
      key === 'tutor.conversation.pressToTalk' ? true : fallback);
    const socket = new FakeSocket();
    const { internals } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    expect(JSON.parse(socket.sent[0]!).setup.realtimeInputConfig).toEqual({ automaticActivityDetection: { disabled: true } });
    internals.refresh();
    const $ = load(internals.view!.webview.html);
    const control = $('[data-setting="tutor.conversation.speechDetection"]');
    expect(control.val()).toBe('geminiKren');
    expect(control.is(':disabled')).toBe(true);
    expect(control.attr('title')).toBe('Press to talk uses KREN detection.');
  });

  it.each(['kren', 'geminiKren', 'unknown', null] as const)('V187 storage, fallback, summary, and next-conversation capture for %s', async (stored) => {
    const values = new Map<string, unknown>([['tutor.conversation.speechDetection', stored]]);
    workspaceGet.mockImplementation((key: string, fallback: unknown) => values.has(key) ? values.get(key) : fallback);
    const socket = new FakeSocket();
    const { internals, actions, postMessage } = liveProvider(() => socket);
    actions.updateSetting.mockImplementation(async (key, value) => { values.set(String(key), value); });
    internals.refresh();
    const selector = '[data-setting="tutor.conversation.speechDetection"]';
    // Changed 2026-10-03: invalid detection uses the current default.
    const initial = stored === 'geminiKren' || stored === 'kren' ? stored : TUTOR_DEFAULTS.configuration['tutor.conversation.speechDetection'];
    expect(load(internals.view!.webview.html)(selector).val()).toBe(initial);
    await internals.handleMessage({ command: 'updateSetting', key: 'tutor.conversation.speechDetection', value: 'geminiKren' });
    expect(actions.updateSetting).toHaveBeenCalledWith('tutor.conversation.speechDetection', 'geminiKren');
    const $ = load(internals.view!.webview.html);
    expect($(selector).val()).toBe('geminiKren');
    expect($(selector).closest('.setting').prev().find('[data-setting="tutor.conversation.pauseBeforeReply"]')).toHaveLength(1);
    expect($('[data-tutor-conversation-advanced] > summary').text()).toContain('Gemini + KREN'); // 2026-10-12: The compact Microphone summary groups detection with the other microphone settings.
    await openLiveConversation(internals, socket);
    const html = internals.view!.webview.html;
    await internals.handleMessage({ command: 'updateSetting', key: 'tutor.conversation.speechDetection', value: 'kren' });
    expect(internals.view!.webview.html).toBe(html);
    expect(postMessage).toHaveBeenCalledWith({ command: 'tutorConversationSpeechDetection', value: 'kren' });
    expect(JSON.parse(socket.sent[0]!).setup.realtimeInputConfig.automaticActivityDetection.disabled).toBe(false);
    await internals.handleMessage({ command: 'updateSetting', key: 'tutor.conversation.speechDetection', value: 'invalid' });
    expect(values.get('tutor.conversation.speechDetection')).toBe('kren');
    await internals.handleMessage({ command: 'stopTutorConversation' });
    socket.sent.length = 0;
    await internals.handleMessage({ command: 'resumeTutorConversation' });
    await waitForLiveSession(internals);
    socket.emit('open');
    expect(JSON.parse(socket.sent[0]!).setup.realtimeInputConfig).toEqual({ automaticActivityDetection: { disabled: true } });
    socket.message({ setupComplete: {} });
    expect(load(internals.view!.webview.html)(selector).val()).toBe('kren');
  });

  it.each(['kren', 'geminiKren'] as const)('V187 mixed English remains visible and checks the cleaned text in %s', async (mode) => {
    workspaceGet.mockImplementation((key: string, fallback: unknown) => key === 'tutor.conversation.speechDetection' ? mode : fallback);
    const socket = new FakeSocket();
    const { internals, postMessage, generateTutor, waveOutSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    generateTutor.mockClear(); waveOutSession.play.mockClear(); postMessage.mockClear();
    socket.message({ serverContent: { inputTranscription: { text: 'I have heard of it, but I do not know how it works.' } } });
    socket.message({ serverContent: { outputTranscription: { text: 'Think of a spinning coin.' },
      modelTurn: { parts: [{ inlineData: { data: 'AAA=', mimeType: 'audio/pcm;rate=24000' } }] } } });
    // 2026-10-02: V187b releases already English input with the first reply fragment.
    expect(waveOutSession.play).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorLiveReplyFragment' }));
    socket.message({ serverContent: { inputTranscription: { text: ' 나 지금 20분 뒤에.' }, turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));
    expect(internals.tutorState.conversation.transcript[0]?.learnerAnswer).toBe('I have heard of it, but I do not know how it works.');
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorLiveInputCommitted',
      text: 'I have heard of it, but I do not know how it works.', learnerNotShown: false }));
    const requests = generateTutor.mock.calls.map(([request]) => request);
    expect(requests.some((request) => isInlineTutorTurn(request))).toBe(true);
    expect(JSON.stringify(requests)).not.toContain('나 지금');
    expect(waveOutSession.play).toHaveBeenCalledOnce();
    const $ = load(renderTutorConversation(internals.tutorState));
    expect($('[data-tutor-learner-not-shown]')).toHaveLength(0);
    expect($('[data-tutor-learner-answer]').text()).not.toContain('나 지금');
  });

  it.each(['kren', 'geminiKren'] as const)('V187 hidden Korean and Spanish have no Live text or audio in %s and remain excluded on restore', async (mode) => {
    workspaceGet.mockImplementation((key: string, fallback: unknown) => key === 'tutor.conversation.speechDetection' ? mode : fallback);
    const socket = new FakeSocket();
    const { internals, postMessage, generateTutor, waveOutSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    generateTutor.mockClear(); waveOutSession.play.mockClear(); postMessage.mockClear();
    for (const text of ['나 지금 20분 뒤에.', '¿Cómo se llama tu papá?']) {
      socket.message({ serverContent: { inputTranscription: { text } } });
      socket.message({ serverContent: { outputTranscription: { text: 'Hidden tutor response.' },
        modelTurn: { parts: [{ inlineData: { data: 'AAA=', mimeType: 'audio/pcm;rate=24000' } }] } } });
      expect(waveOutSession.play).not.toHaveBeenCalled();
      expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorLiveReplyFragment' }));
      socket.message({ serverContent: { turnComplete: true } });
    }
    expect(internals.tutorState.conversation.transcript).toHaveLength(2);
    expect(internals.tutorState.conversation.transcript.every((turn) => turn.learnerNotShown && !turn.reply)).toBe(true);
    expect(generateTutor).not.toHaveBeenCalled();
    expect(waveOutSession.play).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorLiveReplyFragment' }));
    expect(internals.tutorLiveReplyAudio).toEqual([]);
    for (const action of [undefined, 'stopTutorConversation', 'resumeTutorConversation']) {
      if (action) await internals.handleMessage({ command: action });
      const $ = load(renderTutorConversation(internals.tutorState));
      expect($('[data-tutor-learner-not-shown]')).toHaveLength(2);
      expect($('[data-tutor-kren-bubble]').text()).not.toContain('Hidden tutor response.');
    }
  });

  it('V187 English translation requests preserve Korean quotes and are answered', async () => {
    const socket = new FakeSocket();
    const { internals, generateTutor, waveOutSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    generateTutor.mockClear(); waveOutSession.play.mockClear();
    socket.message({ serverContent: { inputTranscription: { text: 'How do I say 안녕하세요 in English?' } } });
    socket.message({ serverContent: { outputTranscription: { text: 'Say hello.' },
      modelTurn: { parts: [{ inlineData: { data: 'AAA=', mimeType: 'audio/pcm;rate=24000' } }] } } });
    expect(waveOutSession.play).toHaveBeenCalledOnce();
    socket.message({ serverContent: { turnComplete: true } });
    expect(internals.tutorState.conversation.transcript[0]?.learnerNotShown).toBeUndefined();
    expect(generateTutor).toHaveBeenCalledWith(expect.objectContaining({ kind: 'conversationCorrections', input: expect.stringContaining('안녕하세요') }), expect.anything(), expect.anything());
  });

  it.each(['before', 'with'] as const)('V187b English transcription arriving %s the first reply fragment posts audio in the same tick', async (arrival) => {
    const socket = new FakeSocket();
    const { internals, postMessage, waveOutSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    vi.useFakeTimers(); waveOutSession.play.mockClear(); postMessage.mockClear();
    const inputTranscription = { text: 'What is the price' };
    if (arrival === 'before') socket.message({ serverContent: { inputTranscription } });
    const firstFragmentAt = Date.now();
    socket.message({ serverContent: {
      ...(arrival === 'with' ? { inputTranscription } : {}),
      outputTranscription: { text: 'It costs ten dollars.' },
      modelTurn: { parts: [{ inlineData: { data: 'AAA=', mimeType: 'audio/pcm;rate=24000' } }] }
    } });
    expect(Date.now()).toBe(firstFragmentAt);
    expect(waveOutSession.play).toHaveBeenCalledOnce();
    expect(internals.tutorLiveReplyAudio).toHaveLength(1);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorLiveReplyFragment', text: 'It costs ten dollars.' }));
    // 2026-10-02: Even a later Korean majority cannot pull back an accepted English reply.
    socket.message({ serverContent: { inputTranscription: { text: '나 지금 한국어로 이야기하고 있어요. 한국어로 계속 이야기하고 있어요.' },
      modelTurn: { parts: [{ inlineData: { data: 'AQI=', mimeType: 'audio/pcm;rate=24000' } }] } } });
    expect(waveOutSession.play).toHaveBeenCalledTimes(2);
    socket.message({ serverContent: { turnComplete: true } });
    expect(internals.tutorState.conversation.transcript.some((turn) => turn.learnerNotShown)).toBe(false);
  });

  it('V187b English transcription arriving 300 ms after the first fragment releases at 300 ms', async () => {
    const socket = new FakeSocket();
    const { internals, postMessage, waveOutSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    vi.useFakeTimers(); waveOutSession.play.mockClear(); postMessage.mockClear();
    const firstFragmentAt = Date.now();
    socket.message({ serverContent: { outputTranscription: { text: 'It costs ten dollars.' },
      modelTurn: { parts: [{ inlineData: { data: 'AAA=', mimeType: 'audio/pcm;rate=24000' } }] } } });
    await vi.advanceTimersByTimeAsync(300);
    expect(waveOutSession.play).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorLiveReplyFragment' }));
    socket.message({ serverContent: { inputTranscription: { text: 'What is the price' } } });
    expect(Date.now() - firstFragmentAt).toBe(300);
    expect(waveOutSession.play).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorLiveReplyFragment', text: 'It costs ten dollars.' }));
    await vi.advanceTimersByTimeAsync(1200);
    expect(waveOutSession.play).toHaveBeenCalledOnce();
    socket.message({ serverContent: { turnComplete: true } });
  });

  it('V187b Korean transcription suppresses the held reply at 1500 ms', async () => {
    const socket = new FakeSocket();
    const { internals, postMessage, waveOutSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    vi.useFakeTimers(); waveOutSession.play.mockClear(); postMessage.mockClear();
    socket.message({ serverContent: { inputTranscription: { text: '나 지금 20분 뒤에.' },
      outputTranscription: { text: 'Hidden tutor response.' },
      modelTurn: { parts: [{ inlineData: { data: 'AAA=', mimeType: 'audio/pcm;rate=24000' } }] } } });
    await vi.advanceTimersByTimeAsync(1499);
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorLiveInputCommitted' }));
    await vi.advanceTimersByTimeAsync(1);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorLiveInputCommitted', learnerNotShown: true }));
    expect(waveOutSession.play).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorLiveReplyFragment' }));
    socket.message({ serverContent: { turnComplete: true } });
    expect(internals.tutorState.conversation.transcript[0]?.learnerNotShown).toBe(true);
  });

  // 2026-10-02: V187b releases English immediately; the 1500 ms playback fallback needs missing input.
  it('V187 releases a reply at 1500 ms when input transcription is missing', async () => {
    const socket = new FakeSocket();
    const { internals, postMessage, waveOutSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    vi.useFakeTimers(); waveOutSession.play.mockClear(); postMessage.mockClear();
    socket.message({ serverContent: { outputTranscription: { text: 'Let us begin.' },
      modelTurn: { parts: [{ inlineData: { data: 'AAA=', mimeType: 'audio/pcm;rate=24000' } }] } } });
    await vi.advanceTimersByTimeAsync(1499);
    expect(waveOutSession.play).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(waveOutSession.play).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorLiveReplyFragment', text: 'Let us begin.' }));
    socket.message({ serverContent: { inputTranscription: { text: '나 지금 20분 뒤에.' } } });
    socket.message({ serverContent: { turnComplete: true } });
    expect(internals.tutorState.conversation.transcript).toHaveLength(0);
    expect(internals.tutorState.conversation.busy).toBe(false);
    expect(internals.tutorState.conversation.transcript.some((turn) => turn.learnerNotShown)).toBe(false);
  });

  it.each(['I.', 'Um.', 'No.'])('V187 hybrid preserves the lone-token policy for %s', async (text) => {
    workspaceGet.mockImplementation((key: string, fallback: unknown) => key === 'tutor.conversation.speechDetection' ? 'geminiKren' : fallback);
    const socket = new FakeSocket();
    const { internals, generateTutor, waveOutSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    generateTutor.mockClear(); waveOutSession.play.mockClear();
    socket.message({ serverContent: { inputTranscription: { text } } });
    socket.message({ serverContent: { outputTranscription: { text: 'Please say more.' },
      modelTurn: { parts: [{ inlineData: { data: 'AAA=', mimeType: 'audio/pcm;rate=24000' } }] }, turnComplete: true } });
    expect(waveOutSession.play).toHaveBeenCalledOnce();
    expect(internals.tutorState.conversation.transcript).toHaveLength(text === 'No.' ? 1 : 0);
    expect(generateTutor).toHaveBeenCalledTimes(text === 'No.' ? 1 : 0);
  });

  it('V187 interruption clears held audio without ever starting its playback', async () => {
    const socket = new FakeSocket();
    const { internals, waveOutSession } = liveProvider(() => socket);
    await openLiveConversation(internals, socket);
    waveOutSession.play.mockClear(); waveOutSession.stop.mockClear();
    // 2026-10-02: Only unclassified or non-English replies remain held in V187b.
    socket.message({ serverContent: { inputTranscription: { text: '나 지금 20분 뒤에.' } } });
    socket.message({ serverContent: { outputTranscription: { text: 'An interrupted reply.' },
      modelTurn: { parts: [{ inlineData: { data: 'AAA=', mimeType: 'audio/pcm;rate=24000' } }] } } });
    // 2026-10-02: Count interruption separately from the preceding turn's audio reset.
    waveOutSession.stop.mockClear();
    socket.message({ serverContent: { interrupted: true } });
    expect(waveOutSession.play).not.toHaveBeenCalled();
    expect(waveOutSession.stop).toHaveBeenCalledOnce();
    expect(internals.tutorLiveReplyAudio).toEqual([]);
  });
});

// 2026-10-11: V220 observes request counts with the new product default.
describe('V220 deferred Stop requests', () => {
  const card = { naturally: [], doneWell: [], tryNext: 'Try a past-tense sentence.' };
  const correction = { correction: 'I went home.', targetId: '', explanation: 'Use the past tense.',
    rephrase: 'I went home.', rephraseWhy: 'This answers the question naturally.' };

  // Changed 2026-10-15: V241, owner item I6, ten answers still use one corrections request and no Stop card.
  it('ten Live turns make zero per-turn coaching requests and one corrections request at Stop', async () => {
    const socket = new FakeSocket();
    const { internals, generateTutor } = liveProvider(() => socket);
    internals.tutorState.conversation.coaching = TUTOR_DEFAULTS.conversation.coaching;
    await openLiveConversation(internals, socket);
    generateTutor.mockClear();
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    for (let turn = 0; turn < 10; turn++) {
      socket.message({ serverContent: { inputTranscription: { text: 'I go home.' } } });
      socket.message({ serverContent: { outputTranscription: { text: 'What happened next?' } } });
      socket.message({ serverContent: { turnComplete: true } });
      await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(turn + 1));
    }
    expect(generateTutor).not.toHaveBeenCalled();
    generateTutor.mockImplementation(async (request) => {
      expect(request.kind).toBe('conversationCorrections');
      expect(JSON.parse(request.input).turns).toHaveLength(10);
      expect(JSON.parse(request.input)).not.toHaveProperty('takeHomeInput');
      return { corrections: Array.from({ length: 10 }, () => correction), takeHome: card };
    });
    internals.tutorState.conversation.speakerOn = false;
    await internals.handleMessage({ command: 'stopTutorConversation' });
    expect(generateTutor).toHaveBeenCalledTimes(1);
    expect(internals.tutorState.conversation.transcript.every((turn) => turn.correction === correction.correction && !turn.coachingPending)).toBe(true);
    expect(internals.tutorState.conversation.takeHome).toBeUndefined();
  });

  // Changed 2026-10-15: V241, owner item I6, corrections and explicit card failures are independent requests.
  it.each(['corrections', 'takeHome', 'provider'])('invalid %s stays local to its own request', async (invalid) => {
    const { internals, generateTutor } = liveProvider(() => new FakeSocket());
    Object.assign(internals.tutorState.conversation, { status: 'active', coaching: 'afterwards', speakerOn: false,
      transcript: [{ question: 'Where did you go?', learnerAnswer: 'I go home.', reply: 'What happened next?',
        correction: '', explanation: '', coachingPending: true }] });
    let firstCard = true;
    generateTutor.mockImplementation(async (request) => {
      if (request.kind === 'conversationCorrections') return { corrections: invalid === 'corrections' ? [] : [correction] };
      if (firstCard) {
        firstCard = false;
        if (invalid === 'provider') throw new Error('Request failed.');
        if (invalid === 'takeHome') return { ...card, naturally: [{ turnIndex: 0, quote: 'Invented quote.', alternatives: ['A sentence.'], why: 'Try this.' }] };
      }
      return card;
    });
    await internals.handleMessage({ command: 'stopTutorConversation' });
    expect(generateTutor.mock.calls.map(([request]) => request.kind)).toEqual(['conversationCorrections']);
    expect(internals.tutorState.conversation.transcript[0]!.correction).toBe(invalid === 'corrections' ? '' : correction.correction);
    expect(internals.tutorState.conversation.takeHome).toBeUndefined();
    await internals.handleMessage({ command: 'reviewTutorConversation' });
    // Changed 2026-10-15: V245, owner item I22, an invalid card entry is dropped and the rest kept, so only a provider error needs Retry.
    if (invalid === 'provider') {
      await vi.waitFor(() => expect(internals.tutorState.conversation.takeHome?.failure).toBeDefined());
      await internals.handleMessage({ command: 'retryTutorTakeHome' });
    }
    await vi.waitFor(() => expect(internals.tutorState.conversation.takeHome?.card).toEqual(card));
    expect(generateTutor.mock.calls.map(([request]) => request.kind)).toEqual(invalid !== 'provider'
      ? ['conversationCorrections', 'conversationTakeHome'] : ['conversationCorrections', 'conversationTakeHome', 'conversationTakeHome']);
  });

  it('Take-home off sends only deferred corrections', async () => {
    const { internals, generateTutor, actions } = liveProvider(() => new FakeSocket());
    actions.settings.mockReturnValue({ ...PANEL_SETTINGS_FIXTURE, tutorConversationTakeHome: false });
    Object.assign(internals.tutorState.conversation, { status: 'active', coaching: 'afterwards', speakerOn: false,
      transcript: [{ question: 'Where did you go?', learnerAnswer: 'I go home.', correction: '', explanation: '', coachingPending: true }] });
    generateTutor.mockImplementation(async () => ({ corrections: [correction] }));
    await internals.handleMessage({ command: 'stopTutorConversation' });
    expect(generateTutor.mock.calls.map(([request]) => request.kind)).toEqual(['conversationCorrections']);
    expect(internals.tutorState.conversation.takeHome).toBeUndefined();
  });
});

it('V220 records reported Live usage once per response and a failed turn without tokens', async () => {
  const saved: unknown[] = [];
  const logs: string[] = [];
  const recorder = new LanguageModelUsageRecorder({ get: <T>(_key: string, fallback: T) => fallback,
    update: async (_key, value) => { saved.push(value); } }, line => logs.push(line));
  configureLanguageModelUsage(recorder);
  const socket = new FakeSocket();
  const session = new TutorLiveSession({ apiKey: TEST_CREDENTIAL, model: 'gemini-unit-live', systemInstruction: 'Setting.',
    socketFactory: () => socket, onText: () => {}, onAudio: () => {} });
  try {
    const connected = session.connect(); socket.emit('open'); socket.message({ setupComplete: {} }); await connected;
    socket.message({ serverContent: { outputTranscription: { text: 'Private spoken text.' } } });
    socket.message({ usageMetadata: { promptTokenCount: 20, responseTokenCount: 12, thoughtsTokenCount: 3 }, serverContent: { turnComplete: true } });
    // 2026-10-12: V227 records Gemini profile identifiers alongside token totals.
    expect(recorder.today()).toEqual([{ provider: 'gemini', model: 'gemini-unit-live', geminiProfile: 'standard', requests: 1, input: 20, output: 12, thinking: 3 }]);
    const failed = session.sendTurn('Private typed text.'); socket.emit('error'); await expect(failed).rejects.toThrow();
    await recorder.flush();
    expect(recorder.today()[0]).toMatchObject({ requests: 2, input: 20, output: 12, thinking: 3 });
  // 2026-10-14: a failed Live turn also logs its safe failure class after usage.
  expect(logs.at(-2)).toBe('[usage] conversationLive gemini gemini-unit-live in=0 out=0 think=0');
  expect(logs.at(-1)).toBe('[provider failure] conversationLive gemini gemini-unit-live no response');
    expect(JSON.stringify(saved)).not.toMatch(/private|text|credential/iu);
  } finally { session.close(); configureLanguageModelUsage(undefined); }
});


// 2026-10-11: V222 keeps Live as a separate service and replaces only read-only sessions.
describe('V222 Chirp and independent Live service', () => {
  it('Groq plus Live opens Gemini with its key and routes deferred Stop coaching to Groq', async () => {
    const socket = new FakeSocket();
    const { internals, generateTutor, actions } = liveProvider(() => socket);
    internals.tutorState.settings.routing.provider = 'groq';
    internals.tutorState.conversation.coaching = 'afterwards';
    await openLiveConversation(internals, socket);
    expect(internals.tutorLiveSession).toBeDefined();
    internals.tutorState.conversation.draftAnswer = 'I went home.';
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    await waitForSent(socket, 3);
    socket.message({ serverContent: { outputTranscription: { text: 'What happened next?' }, turnComplete: true } });
    await vi.waitFor(() => expect(internals.tutorState.conversation.transcript).toHaveLength(1));
    await internals.handleMessage({ command: 'stopTutorConversation' });
    await vi.waitFor(() => expect(generateTutor.mock.calls.some(([request]) => request.kind === 'conversationCorrections')).toBe(true));
    const requests = generateTutor.mock.calls as unknown as Array<[TutorStructuredGenerationRequest, { provider: string }]>;
    expect(requests.filter(([request]) => request.kind === 'conversationCorrections').map(([, route]) => route.provider)).toEqual(['groq']);
    expect(actions.readAloudText).not.toHaveBeenCalled();
  });
  it('Live replies still use Gemini while Chirp is the Speech Source', async () => {
    const socket = new FakeSocket(), factory = vi.fn(() => socket);
    const { internals, actions, waveOutSession } = liveProvider(factory);
    actions.settings.mockReturnValue({ ...PANEL_SETTINGS_FIXTURE, tutorReadAloudProvider: 'googleChirp' });
    await openLiveConversation(internals, socket);
    internals.tutorState.conversation.draftAnswer = 'My answer.';
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    await waitForSent(socket, 3);
    expect(actions.stopReadAloud).toHaveBeenCalled();
    socket.message({ serverContent: { modelTurn: { parts: [{ inlineData: { data: 'AQI=', mimeType: 'audio/pcm;rate=24000' } }] } } });
    expect(factory).toHaveBeenCalledOnce(); expect(actions.readAloudText).not.toHaveBeenCalled();
    expect(waveOutSession.play).toHaveBeenCalledWith({ data: 'AQI=', mimeType: 'audio/pcm;rate=24000' });
    await internals.handleMessage({ command: 'stopTutorConversation' });
  });
  it('Chirp reads the Live take-home card without requesting a credential or opening a Live session', async () => {
    const factory = vi.fn(() => new FakeSocket());
    const { provider, internals, actions, generateTutor, waveOutPlayer } = liveProvider(factory);
    actions.settings.mockReturnValue({ ...PANEL_SETTINGS_FIXTURE, tutorReadAloudProvider: 'googleChirp' });
    internals.tutorState.conversation.status = 'stopped';
    internals.tutorState.conversation.liveVoice = 'Enceladus';
    internals.tutorState.conversation.takeHome = { identity: 'test', card: { naturally: [], doneWell: [], tryNext: 'Try a question.' } };
    const narration = speakTutorTakeHome(provider);
    await vi.waitFor(() => expect(actions.readAloudText).toHaveBeenCalledOnce());
    await narration;
    expect(actions.readAloudText).toHaveBeenCalledWith('Take-home. Try next time: Try a question.', 'en', 'tutor', 'Puck');
    expect(factory).not.toHaveBeenCalled(); expect(generateTutor).not.toHaveBeenCalled(); expect(waveOutPlayer.start).not.toHaveBeenCalled();
  });
  it('Chirp reads both Demo genders and previews without opening a Live session', async () => {
    const factory = vi.fn(() => new FakeSocket());
    const { provider, internals, actions, generateTutor } = liveProvider(factory);
    actions.settings.mockReturnValue({ ...PANEL_SETTINGS_FIXTURE, tutorReadAloudProvider: 'googleChirp', tutorLiveFemaleVoice: 'Kore', tutorLiveMaleVoice: 'Puck' });
    await openTutorDemoLiveSessions(provider, provider.tutorDemoGeneration, new AbortController());
    await speakTutorDemoText(provider, 'Female line.', 'female', provider.tutorDemoGeneration);
    await speakTutorDemoText(provider, 'Male line.', 'male', provider.tutorDemoGeneration);
    internals.tutorState.conversation.liveVoice = 'Callirrhoe';
    await internals.handleMessage({ command: 'previewTutorGeminiVoice' });
    expect(actions.readAloudText).toHaveBeenNthCalledWith(1, 'Female line.', 'en', 'tutor', 'Kore');
    expect(actions.readAloudText).toHaveBeenNthCalledWith(2, 'Male line.', 'en', 'tutor', 'Puck');
    expect(actions.readAloudText).toHaveBeenNthCalledWith(3, expect.stringContaining('Hello'), 'en', 'tutor', 'Callirrhoe');
    expect(factory).not.toHaveBeenCalled(); expect(generateTutor).not.toHaveBeenCalled();
  });
  it('Chirp Replay reads learner lines between retained Gemini clips with no Live session', async () => {
    const factory = vi.fn(() => new FakeSocket());
    const { internals, actions, generateTutor, waveOutSession } = liveProvider(factory);
    actions.settings.mockReturnValue({ ...PANEL_SETTINGS_FIXTURE, tutorReadAloudProvider: 'googleChirp', tutorLiveMaleVoice: 'Puck' });
    Object.assign(internals.tutorState.conversation, { status: 'stopped', liveVoice: 'Kore', transcript: [
      { question: 'First?', learnerAnswer: 'First learner.', correction: 'First corrected.', explanation: '', move: 'reaction', reply: 'Last?' }
    ] });
    internals.tutorLiveConversationAudio.set(0, [{ data: 'AQI=', mimeType: 'audio/pcm;rate=24000' }]);
    internals.tutorLiveConversationAudio.set(1, [{ data: 'AwQ=', mimeType: 'audio/pcm;rate=24000' }]);
    const events: string[] = [];
    waveOutSession.play.mockImplementation((chunk: { data: string }) => events.push(chunk.data));
    actions.readAloudText.mockImplementation(async (...args: unknown[]) => { events.push(String(args[0])); });
    await internals.handleMessage({ command: 'replayTutorQuestion' });
    await vi.waitFor(() => expect(internals.tutorState.conversation.replayAllSpeaking).toBe(false));
    expect(events).toEqual(['AQI=', 'First corrected.', 'AwQ=']);
    expect(actions.readAloudText).toHaveBeenCalledWith('First corrected.', 'en', 'tutor', 'Puck');
    expect(factory).not.toHaveBeenCalled(); expect(generateTutor).not.toHaveBeenCalled();
  });
  it('the in-memory MP3 player passes Volume and Stop settles the pending playback', async () => {
    const { provider, postMessage } = liveProvider(() => new FakeSocket());
    const pending = provider.playGeneratedAudioBase64('AQI=', 25);
    // 2026-10-12: Clip identities prevent a late audio acknowledgement advancing a new line.
    expect(postMessage).toHaveBeenCalledWith({ command: 'playGeneratedAudio', audioBase64: 'AQI=', volume: 25, playbackId: expect.any(Number) });
    expect(provider.stopGeneratedAudio()).toBe(true);
    await expect(pending).resolves.toBe('stopped');
  });
  it.each(['stopTutorConversation', 'confirmTutorReset', 'showStartPage'])('a pending speech is canceled by %s', async command => {
    const { provider, internals, actions } = liveProvider(() => new FakeSocket());
    Object.assign(internals.tutorState.conversation, { status: 'active', replies: 'standard' });
    actions.settings.mockReturnValue({ ...PANEL_SETTINGS_FIXTURE, tutorReadAloudProvider: 'googleChirp' });
    let finish!: () => void;
    actions.readAloudText.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    actions.stopReadAloud.mockImplementation(() => { finish?.(); });
    internals.speakTutorConversationSequence(['Pending speech.'], 'Speech failed.');
    await vi.waitFor(() => expect(actions.readAloudText).toHaveBeenCalledOnce());
    if (command === 'confirmTutorReset') { showWarningMessage.mockResolvedValueOnce('Reset panel'); await internals.handleMessage({ command: 'resetTutorSession' }); }
    else await internals.handleMessage({ command });
    expect(actions.stopReadAloud).toHaveBeenCalled();
    provider.dispose();
  });
});

// 2026-10-11: Compare the real controller request at the provider routing boundary.
it.each(['lesson', 'situation', 'anything'] as const)('V224 keeps swapped roles and identical mode inputs across providers for %s', async from => {
  let reference: TutorStructuredGenerationRequest | undefined;
  for (const routingProvider of ['gemini', 'groq', 'cloudflare', 'openai', 'anthropic'] as const) {
    const { internals, generateTutor } = liveProvider(() => new FakeSocket());
    internals.tutorState.settings.routing.provider = routingProvider;
    internals.tutorState.settings.routing.model = 'first-model';
    Object.assign(internals.tutorState.conversation, { from, replies: 'standard', status: 'active',
      rolesSwapped: true, starts: 'learner', register: 'professional', coaching: 'teaching', replyLength: 'medium',
      currentQuestion: 'What do you need?', draftAnswer: 'I need help.' });
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    await vi.waitFor(() => expect(generateTutor.mock.calls.some(([request]) => request.kind === 'conversationTurn')).toBe(true));
    const [request, route] = (generateTutor.mock.calls as unknown as Array<[TutorStructuredGenerationRequest, { provider: string }]>).find(([request]) => request.kind === 'conversationTurn')!;
    expect(route.provider).toBe(routingProvider);
    expect(request.instruction).toMatch(/you are the supervisor and the learner is the student/u);
    expect(JSON.parse(request.input)).toMatchObject({ rolesSwapped: true, learnerStarts: true, register: 'professional', coaching: 'teaching', replyLength: 'medium' });
    if (reference) expect(request).toEqual(reference); else reference = request;
    // A model change must leave both byte strings alone as well.
    internals.tutorState.settings.routing.model = 'second-model';
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));
    Object.assign(internals.tutorState.conversation, { transcript: [], currentQuestion: 'What do you need?', draftAnswer: 'I need help.' });
    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    await vi.waitFor(() => expect(generateTutor.mock.calls.filter(([request]) => request.kind === 'conversationTurn')).toHaveLength(2));
    expect(generateTutor.mock.calls.filter(([request]) => request.kind === 'conversationTurn')[1]![0]).toEqual(reference);
  }
});
