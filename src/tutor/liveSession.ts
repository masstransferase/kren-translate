import { recordLanguageModelUsage, recordLanguageModelNoResponse, reportedLanguageModelUsage } from '../languageModelUsage.js';
import { normalizeGeminiModel } from '../providers/geminiModels.js';
import type { TutorMicrophoneSensitivity, TutorSpeechDetection, TutorPauseBeforeReply } from '../tutorMicrophoneGate.js';

export const GEMINI_LIVE_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

export interface TutorLiveAudioChunk {
  data: string;
  mimeType: string;
}

export interface TutorLiveSocketEvent {
  data?: unknown;
}

export interface TutorLiveSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: TutorLiveSocketEvent) => void
  ): void;
  removeEventListener?(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: TutorLiveSocketEvent) => void
  ): void;
}

export type TutorLiveSocketFactory = (url: string) => TutorLiveSocket;

export const defaultTutorLiveSocketFactory: TutorLiveSocketFactory = (url) => {
  const socket = new globalThis.WebSocket(url);
  // Google sends every Live message as a binary frame, and the standard default for
  // binaryType is "blob". Until 1.61.1 frames arrived as Blobs the reader below could not
  // decode, so the first real session failed with "unreadable message" and every reply fell
  // back to the standard path and its Edge voice.
  socket.binaryType = 'arraybuffer';
  return socket as unknown as TutorLiveSocket;
};

export type TutorLiveFailureCode =
  | 'socketOpen'
  | 'setupTimeout'
  | 'socketClosed'
  | 'serverError'
  | 'interrupted'
  | 'goAway'
  | 'reconnect'
  | 'protocol';

const FAILURE_MESSAGES: Record<TutorLiveFailureCode, string> = {
  socketOpen: 'the Live socket could not open',
  setupTimeout: 'setupComplete did not arrive before the timeout',
  socketClosed: 'the Live socket closed before the turn completed',
  serverError: 'the Live server returned an error',
  interrupted: 'the Live server interrupted the turn',
  goAway: 'the Live server asked the session to close',
  reconnect: 'the Live session could not reconnect',
  protocol: 'the Live server returned an unreadable message'
};

/**
 * Carries only a fixed KREN-authored reason. Browser events and server bodies can contain
 * the authenticated WebSocket URL, so neither is retained as a cause or interpolated.
 */
export class TutorLiveSessionError extends Error {
  public constructor(public readonly code: TutorLiveFailureCode) {
    super(FAILURE_MESSAGES[code]);
    this.name = 'TutorLiveSessionError';
  }
}

export interface TutorLiveSessionOptions {
  /** Conversation sessions may report a replacement character through a structured tool. */
  handoffEnabled?: boolean;
  apiKey: string;
  geminiProfile?: 'standard' | 'pro';
  model: string;
  systemInstruction: string;
  /** A Gemini prebuilt voice name; left out, the server uses its default voice. */
  voiceName?: string;
  /** Manual activity markers replace server voice detection for Press to talk sessions. */
  pressToTalk?: boolean;
  /** One shared sensitivity choice for KREN's gate and Gemini's activity detection. */
  microphoneSensitivity?: TutorMicrophoneSensitivity;
  speechDetection?: TutorSpeechDetection;
  pauseBeforeReply?: TutorPauseBeforeReply;
  /** Host conversations hold replies until input is English or the bounded hold ends. */
  holdInputReply?: boolean;
  /** Classifies the host's accumulated input, including the English request exception. */
  isInputEnglish?(): boolean;
  /** English practice is the default; automatic is the exact pre-V148 provider behavior. */
  transcriptionLanguage?: 'english' | 'automatic';
  socketFactory?: TutorLiveSocketFactory;
  setupTimeoutMs?: number;
  /** Requests the credential again through the host's existing SecretStorage-backed path. */
  requestApiKey?(signal: AbortSignal): Promise<string>;
  onReconnected?(): void;
  onText(text: string): void;
  onAudio(chunk: TutorLiveAudioChunk): void;
  onInputText?(text: string): void;
  onReplyStart?(classificationLate?: boolean): void;
  onReplyPending?(): void;
  onTurnComplete?(): void;
  onInterrupted?(): void;
  onEnded?(error: TutorLiveSessionError): void;
}

type PendingSetup = {
  resolve(): void;
  reject(error: TutorLiveSessionError): void;
};

type PendingTurn = {
  resolve(): void;
  reject(error: TutorLiveSessionError): void;
};

/** One stateful Gemini Live WebSocket. Text turns and realtime microphone audio may coexist. */
export class TutorLiveSession {
  private handoff: unknown;

  public takeHandoff(): unknown {
    const value = this.handoff;
    this.handoff = undefined;
    return value;
  }
  private heldReply: Array<{ deliver(): void; audio: boolean }> = [];
  private replyHoldTimer: ReturnType<typeof setTimeout> | undefined;
  private replyReleased = false;

  private releaseInputReply(classificationLate = false, interrupted = false): void {
    if (this.replyHoldTimer !== undefined) clearTimeout(this.replyHoldTimer);
    this.replyHoldTimer = undefined;
    if (!this.heldReply.length) return;
    this.replyReleased = true;
    this.options.onReplyStart?.(classificationLate);
    const held = this.heldReply.splice(0);
    for (const event of held) {
      if (!interrupted || !event.audio) event.deliver();
    }
  }

  private clearInputReply(): void {
    if (this.replyHoldTimer !== undefined) clearTimeout(this.replyHoldTimer);
    this.replyHoldTimer = undefined;
    this.heldReply = [];
    this.replyReleased = false;
  }
  public isReconnecting(): boolean { return this.reconnecting; }
  private socket: TutorLiveSocket | undefined;
  private setup: PendingSetup | undefined;
  private turn: PendingTurn | undefined;
  private setupTimer: ReturnType<typeof setTimeout> | undefined;
  private closedByKren = false;
  private ready = false;
  private ended = false;
  private replyStarted = false;
  private usageCounts: ReturnType<typeof reportedLanguageModelUsage> | undefined;
  private resumptionHandle: string | undefined;
  private reconnecting = false;
  private replacementSocket: TutorLiveSocket | undefined;
  private replacementListeners: {
    open(event: TutorLiveSocketEvent): void;
    message(event: TutorLiveSocketEvent): void;
    error(event: TutorLiveSocketEvent): void;
    close(event: TutorLiveSocketEvent): void;
  } | undefined;
  private reconnectController: AbortController | undefined;
  private readonly reconnectQueue: string[] = [];

  public constructor(private readonly options: TutorLiveSessionOptions) {}

  public connect(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.setup) throw new TutorLiveSessionError('protocol');
    const factory = this.options.socketFactory ?? defaultTutorLiveSocketFactory;
    const url = `${GEMINI_LIVE_ENDPOINT}?key=${encodeURIComponent(this.options.apiKey)}`;
    let socket: TutorLiveSocket;
    try {
      socket = factory(url);
    } catch {
      return Promise.reject(new TutorLiveSessionError('socketOpen'));
    }
    this.socket = socket;
    socket.addEventListener('open', this.handleOpen);
    socket.addEventListener('message', this.handleMessage);
    socket.addEventListener('error', this.handleError);
    socket.addEventListener('close', this.handleClose);
    return new Promise<void>((resolve, reject) => {
      this.setup = { resolve, reject };
      this.setupTimer = setTimeout(() => this.fail('setupTimeout'), this.options.setupTimeoutMs ?? 5000);
    });
  }

  /**
   * Adds a note to the session's context without asking for a reply: `turnComplete: false`, which
   * the Live API accepts throughout a session. Used when a MODE choice changes while the learner
   * talks, since a spoken turn has no text turn for the note to travel with.
   */
  public sendNote(note: string): void {
    if (!this.ready || !this.socket || this.ended) return;
    this.sendMessage(JSON.stringify({
      clientContent: { turns: [{ role: 'user', parts: [{ text: note }] }], turnComplete: false }
    }));
  }

  public sendTurn(text: string, note?: string): Promise<void> {
    if (!this.ready || !this.socket || this.turn || this.ended) {
      return Promise.reject(new TutorLiveSessionError('protocol'));
    }
    this.handoff = undefined;
    const message = {
      clientContent: {
        turns: [{ role: 'user', parts: note ? [{ text: note }, { text }] : [{ text }] }],
        turnComplete: true
      }
    };
    return new Promise<void>((resolve, reject) => {
      this.turn = { resolve, reject };
      this.sendMessage(JSON.stringify(message));
    });
  }

  /** A KREN-authored text turn is still waiting for its Live reply. */
  public hasPendingTextTurn(): boolean {
    return this.turn !== undefined;
  }

  public sendAudio(base64Pcm: string): void {
    if (!this.ready || !this.socket || this.ended) return;
    this.sendMessage(JSON.stringify({
      realtimeInput: {
        audio: { data: base64Pcm, mimeType: 'audio/pcm;rate=16000' }
      }
    }));
  }

  public endAudioStream(): void {
    if (!this.ready || !this.socket || this.ended) return;
    this.sendMessage(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
  }

  public activityStart(): void {
    if (!this.ready || !this.socket || this.ended) return;
    this.sendMessage(JSON.stringify({ realtimeInput: { activityStart: {} } }));
  }

  public activityEnd(): void {
    if (!this.ready || !this.socket || this.ended) return;
    this.sendMessage(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
  }

  public close(): void {
    this.clearInputReply();
    if (this.closedByKren) return;
    if (!this.ended && (this.turn || this.replyStarted || this.setup)) this.recordUsage(true);
    this.closedByKren = true;
    this.ended = true;
    this.reconnectController?.abort();
    this.reconnectController = undefined;
    this.clearSetupTimer();
    this.setup?.reject(new TutorLiveSessionError('socketClosed'));
    this.setup = undefined;
    this.turn?.reject(new TutorLiveSessionError('socketClosed'));
    this.turn = undefined;
    try {
      this.socket?.close(1000, 'KREN closed the Live session');
    } catch {
      // Closing is best effort. The authenticated URL is deliberately never inspected.
    }
    this.detach();
    this.socket = undefined;
    this.closeReplacement();
    this.reconnectQueue.length = 0;
  }

  private readonly handleOpen = (): void => {
    if (!this.socket || this.closedByKren) return;
    const setup = this.setupMessage();
    try {
      this.socket.send(JSON.stringify(setup));
    } catch {
      this.fail('socketOpen');
    }
  };

  private setupMessage(resumptionHandle?: string): object {
    return {
      setup: {
        // The shared model validator accepts `models/...`; prefixing that again sent
        // `models/models/...`, which a real server rejects (V121).
        model: `models/${normalizeGeminiModel(this.options.model).replace(/^models\//u, '')}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          ...(this.options.voiceName
            ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.options.voiceName } } } }
            : {})
        },
        systemInstruction: { parts: [{ text: this.options.systemInstruction }] },
        ...(this.options.handoffEnabled ? { tools: [{ functionDeclarations: [{
          name: 'handoff', description: 'Report the replacement character when handing over the conversation. Call once before continuing as the new character.',
          parameters: { type: 'OBJECT', properties: { role: { type: 'STRING', description: 'New character name and role, for example Sarah, the store manager' },
            gender: { type: 'STRING', enum: ['female', 'male'] } }, required: ['role', 'gender'] }
        }] }] } : {}),
        realtimeInputConfig: {
          automaticActivityDetection: this.options.speechDetection === 'geminiKren' && !this.options.pressToTalk
            ? {
                disabled: false,
                startOfSpeechSensitivity: 'START_SENSITIVITY_LOW',
                endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
                silenceDurationMs: (this.options.pauseBeforeReply ?? 2) * 1000 + 500
              }
            : { disabled: true }
        },
        inputAudioTranscription: this.options.transcriptionLanguage === 'automatic'
          ? {}
          : { languageCodes: ['en-US'] },
        outputAudioTranscription: {},
        sessionResumption: resumptionHandle ? { handle: resumptionHandle } : {}
      }
    };
  }

  /**
   * Frames are handled in arrival order. Text and ArrayBuffer frames are handled at once; a
   * Blob decodes asynchronously, so while one is pending, later frames wait behind it.
   */
  private frameQueue: Promise<void> = Promise.resolve();
  private pendingBlobFrames = 0;

  private readonly handleMessage = (event: TutorLiveSocketEvent): void => {
    const data = event.data;
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      this.pendingBlobFrames += 1;
      this.frameQueue = this.frameQueue
        .then(() => data.text())
        .then((raw) => this.handleFrame(raw), () => this.fail('protocol'))
        .finally(() => { this.pendingBlobFrames -= 1; });
      return;
    }
    const raw = typeof data === 'string'
      ? data
      : data instanceof ArrayBuffer || ArrayBuffer.isView(data)
        ? new TextDecoder().decode(data)
        : undefined;
    if (raw === undefined) {
      this.fail('protocol');
      return;
    }
    if (this.pendingBlobFrames > 0) {
      this.frameQueue = this.frameQueue.then(() => this.handleFrame(raw));
    } else {
      this.handleFrame(raw);
    }
  };

  private handleFrame(raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      this.fail('protocol');
      return;
    }
    if (!isRecord(message)) {
      this.fail('protocol');
      return;
    }
    if (message.setupComplete !== undefined) {
      this.ready = true;
      this.clearSetupTimer();
      const setup = this.setup;
      this.setup = undefined;
      setup?.resolve();
      return;
    }
    if (message.error !== undefined) {
      this.fail('serverError');
      return;
    }
    const resumptionUpdate = isRecord(message.sessionResumptionUpdate)
      ? message.sessionResumptionUpdate : undefined;
    if (resumptionUpdate?.resumable === true &&
        typeof resumptionUpdate.newHandle === 'string' && resumptionUpdate.newHandle) {
      this.resumptionHandle = resumptionUpdate.newHandle;
      return;
    }
    if (message.goAway !== undefined) {
      this.reconnectAfterGoAway();
      return;
    }
    if (isRecord(message.usageMetadata)) this.usageCounts = reportedLanguageModelUsage('gemini', message);
    if (this.options.handoffEnabled && isRecord(message.toolCall) && Array.isArray(message.toolCall.functionCalls)) {
      const responses = message.toolCall.functionCalls.filter(isRecord).map(call => {
        if (call.name === 'handoff') this.handoff = call.args;
        return { id: call.id, name: call.name, response: { result: call.name === 'handoff' ? 'Recorded. Continue the reply.' : 'Unknown function.' } };
      });
      if (responses.length) this.sendMessage(JSON.stringify({ toolResponse: { functionResponses: responses } }));
    }
    const serverContent = isRecord(message.serverContent) ? message.serverContent : undefined;
    if (!serverContent) return;
    const inputTranscription = isRecord(serverContent.inputTranscription)
      ? serverContent.inputTranscription.text
      : undefined;
    if (typeof inputTranscription === 'string' && inputTranscription) {
      this.options.onInputText?.(inputTranscription);
    }
    const transcription = isRecord(serverContent.outputTranscription)
      ? serverContent.outputTranscription.text
      : undefined;
    const modelTurn = isRecord(serverContent.modelTurn) ? serverContent.modelTurn : undefined;
    const hasAudio = Array.isArray(modelTurn?.parts) && modelTurn.parts.some((part) => {
      const inlineData = isRecord(part) && isRecord(part.inlineData) ? part.inlineData : undefined;
      return typeof inlineData?.data === 'string' && typeof inlineData.mimeType === 'string' &&
        inlineData.mimeType.toLocaleLowerCase().startsWith('audio/pcm');
    });
    if (!this.replyStarted && ((typeof transcription === 'string' && transcription) || hasAudio)) {
      this.replyStarted = true;
      if (!this.options.holdInputReply || this.turn) {
        this.replyReleased = true;
        this.options.onReplyStart?.();
      } else {
        this.options.onReplyPending?.();
        this.replyHoldTimer = setTimeout(() => this.releaseInputReply(true), 1500);
      }
    }
    if (typeof transcription === 'string' && transcription) {
      const deliver = () => this.options.onText(transcription);
      if (this.options.holdInputReply && !this.replyReleased) this.heldReply.push({ deliver, audio: false });
      else deliver();
    }
    if (Array.isArray(modelTurn?.parts)) {
      for (const part of modelTurn.parts) {
        const inlineData = isRecord(part) && isRecord(part.inlineData) ? part.inlineData : undefined;
        if (typeof inlineData?.data === 'string' && typeof inlineData.mimeType === 'string' &&
            inlineData.mimeType.toLocaleLowerCase().startsWith('audio/pcm')) {
          const chunk = { data: inlineData.data, mimeType: inlineData.mimeType };
          const deliver = () => this.options.onAudio(chunk);
          if (this.options.holdInputReply && !this.replyReleased) this.heldReply.push({ deliver, audio: true });
          else deliver();
        }
      }
    }
    if (serverContent.interrupted === true) {
      this.handoff = undefined;
      this.recordUsage();
      this.releaseInputReply(false, true);
      this.options.onInterrupted?.();
      this.clearInputReply();
      this.replyStarted = false;
      const turn = this.turn;
      this.turn = undefined;
      turn?.resolve();
      return;
    }
    // 2026-10-02: English input releases queued fragments in this frame's tick.
    // Once released, later input cannot retract the reply.
    if (!this.replyReleased && this.options.isInputEnglish?.()) this.releaseInputReply();
    if (serverContent.turnComplete === true) {
      this.recordUsage();
      this.releaseInputReply();
      this.replyStarted = false;
      const turn = this.turn;
      this.turn = undefined;
      turn?.resolve();
      this.options.onTurnComplete?.();
      this.clearInputReply();
    }
  };

  private readonly handleError = (): void => {
    if (this.reconnecting) return;
    this.fail(this.ready ? 'socketClosed' : 'socketOpen');
  };

  private readonly handleClose = (): void => {
    if (this.reconnecting) return;
    if (!this.closedByKren) this.fail(this.ready ? 'socketClosed' : 'socketOpen');
  };

  private sendMessage(message: string): void {
    if (this.reconnecting) {
      this.reconnectQueue.push(message);
      return;
    }
    try {
      this.socket?.send(message);
    } catch {
      this.fail('socketClosed');
    }
  }

  /**
   * Opens an authenticated replacement while the warned socket is still alive. Realtime input
   * arriving during setup is held in memory, then sent once through the resumed connection.
   */
  private reconnectAfterGoAway(): void {
    if (this.reconnecting || this.ended) return;
    const handle = this.resumptionHandle;
    if (!handle) {
      this.fail('reconnect');
      return;
    }
    this.reconnecting = true;
    const controller = new AbortController();
    this.reconnectController = controller;
    const credential = this.options.requestApiKey
      ? this.options.requestApiKey(controller.signal)
      : Promise.resolve(this.options.apiKey);
    void credential.then((apiKey) => {
      if (controller.signal.aborted || this.ended || this.reconnectController !== controller) return;
      const factory = this.options.socketFactory ?? defaultTutorLiveSocketFactory;
      let socket: TutorLiveSocket;
      try {
        socket = factory(`${GEMINI_LIVE_ENDPOINT}?key=${encodeURIComponent(apiKey)}`);
      } catch {
        this.fail('reconnect');
        return;
      }
      if (controller.signal.aborted || this.ended || this.reconnectController !== controller) {
        try { socket.close(1000, 'KREN discarded a stale Live replacement'); } catch {}
        return;
      }
      this.replacementSocket = socket;
      const listeners = {
        open: () => {
          try {
            socket.send(JSON.stringify(this.setupMessage(handle)));
          } catch {
            this.fail('reconnect');
          }
        },
        message: (event: TutorLiveSocketEvent) => this.handleReplacementMessage(event, socket),
        error: () => this.fail('reconnect'),
        close: () => this.fail('reconnect')
      };
      this.replacementListeners = listeners;
      socket.addEventListener('open', listeners.open);
      socket.addEventListener('message', listeners.message);
      socket.addEventListener('error', listeners.error);
      socket.addEventListener('close', listeners.close);
      this.setupTimer = setTimeout(
        () => this.fail('reconnect'), this.options.setupTimeoutMs ?? 5000
      );
    }, () => this.fail('reconnect'));
  }

  private handleReplacementMessage(event: TutorLiveSocketEvent, socket: TutorLiveSocket): void {
    const accept = (raw: string): void => {
      if (this.replacementSocket !== socket || this.ended) return;
      let message: unknown;
      try {
        message = JSON.parse(raw);
      } catch {
        this.fail('reconnect');
        return;
      }
      if (!isRecord(message)) {
        this.fail('reconnect');
        return;
      }
      if (message.error !== undefined) {
        this.fail('reconnect');
        return;
      }
      if (message.setupComplete !== undefined) this.activateReplacement(socket);
    };
    const data = event.data;
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      void data.text().then(accept, () => this.fail('reconnect'));
      return;
    }
    const raw = typeof data === 'string'
      ? data
      : data instanceof ArrayBuffer || ArrayBuffer.isView(data)
        ? new TextDecoder().decode(data)
        : undefined;
    if (raw === undefined) this.fail('reconnect');
    else accept(raw);
  }

  private activateReplacement(socket: TutorLiveSocket): void {
    if (this.replacementSocket !== socket || this.ended) return;
    this.clearSetupTimer();
    const previous = this.socket;
    this.detach();
    this.detachReplacement();
    this.socket = socket;
    socket.addEventListener('open', this.handleOpen);
    socket.addEventListener('message', this.handleMessage);
    socket.addEventListener('error', this.handleError);
    socket.addEventListener('close', this.handleClose);
    this.replacementSocket = undefined;
    this.reconnecting = false;
    this.reconnectController = undefined;
    try {
      previous?.close(1000, 'KREN replaced the warned Live connection');
    } catch {
      // The replacement is already active, so failure to close the old socket is harmless.
    }
    const queued = this.reconnectQueue.splice(0);
    try {
      for (const message of queued) socket.send(message);
    } catch {
      this.fail('socketClosed');
    }
    if (!this.ended) this.options.onReconnected?.();
  }

  private recordUsage(failed = false): void {
    const counts = failed ? undefined : this.usageCounts;
    recordLanguageModelUsage({ feature: 'conversationLive', provider: 'gemini', model: this.options.model, geminiProfile: this.options.geminiProfile },
      counts ? { usageMetadata: { promptTokenCount: counts.input, candidatesTokenCount: counts.output, thoughtsTokenCount: counts.thinking } } : undefined);
    if (failed) recordLanguageModelNoResponse({ feature: 'conversationLive', provider: 'gemini', model: this.options.model });
    this.usageCounts = undefined;
  }

  private fail(code: TutorLiveFailureCode): void {
    this.clearInputReply();
    if (this.ended) return;
    if (this.turn || this.replyStarted || this.setup) this.recordUsage(true);
    this.ended = true;
    this.ready = false;
    this.reconnectController?.abort();
    this.reconnectController = undefined;
    this.clearSetupTimer();
    const error = new TutorLiveSessionError(code);
    this.setup?.reject(error);
    this.setup = undefined;
    this.turn?.reject(error);
    this.turn = undefined;
    this.options.onEnded?.(error);
    try {
      this.socket?.close(1000, 'KREN closed the failed Live session');
    } catch {
      // The fixed failure above is the only diagnostic allowed out of this module.
    }
    this.detach();
    this.socket = undefined;
    this.closeReplacement();
    this.reconnectQueue.length = 0;
  }

  private clearSetupTimer(): void {
    if (this.setupTimer !== undefined) clearTimeout(this.setupTimer);
    this.setupTimer = undefined;
  }

  private detach(): void {
    const socket = this.socket;
    if (!socket?.removeEventListener) return;
    socket.removeEventListener('open', this.handleOpen);
    socket.removeEventListener('message', this.handleMessage);
    socket.removeEventListener('error', this.handleError);
    socket.removeEventListener('close', this.handleClose);
  }

  private detachReplacement(): void {
    const socket = this.replacementSocket;
    const listeners = this.replacementListeners;
    if (socket?.removeEventListener && listeners) {
      socket.removeEventListener('open', listeners.open);
      socket.removeEventListener('message', listeners.message);
      socket.removeEventListener('error', listeners.error);
      socket.removeEventListener('close', listeners.close);
    }
    this.replacementListeners = undefined;
  }

  private closeReplacement(): void {
    const socket = this.replacementSocket;
    this.detachReplacement();
    this.replacementSocket = undefined;
    try {
      socket?.close(1000, 'KREN closed the Live replacement');
    } catch {
      // Closing is best effort, and no server detail leaves this module.
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
