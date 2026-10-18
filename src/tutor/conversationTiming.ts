type TimingLog = (line: string) => void;
type Clock = () => number;

function offset(startedAt: number, at: number | undefined): string {
  return at === undefined ? 'na' : String(Math.max(0, Math.round(at - startedAt)));
}

abstract class ConversationTurnTiming {
  protected readonly startedAt: number;
  protected written = false;
  private providerAttempts = 0;
  private providerBackoffMs = 0;

  protected constructor(
    protected readonly log: TimingLog,
    protected readonly now: Clock
  ) {
    this.startedAt = now();
  }

  protected once(current: number | undefined): number {
    return current ?? this.now();
  }

  public providerAttempt(): void {
    this.providerAttempts += 1;
  }

  public providerBackoff(milliseconds: number): void {
    this.providerBackoffMs += Math.max(0, Math.round(milliseconds));
  }

  protected providerFields(): string {
    return `provider_attempts=${this.providerAttempts} provider_backoff_ms=${this.providerBackoffMs}`;
  }
}

/** Holds only timestamps, fixed event names, counts and fixed gate-reason tokens. */
export class LiveConversationTurnTiming extends ConversationTurnTiming {
  private microphoneOpenedAt?: number;
  private firstChunkForwardedAt?: number;
  private gateFirstOpenedAt?: number;
  private gateLastClosedAt?: number;
  private gateHeldCount = 0;
  private readonly gateReasons = new Set<'calibration' | 'below-threshold'>();
  private echoGateBlockedFromAt?: number;
  private echoGateBlockedUntilAt?: number;
  private firstInputTranscriptionAt?: number;
  private lastInputTranscriptionAt?: number;
  private turnCommittedAt?: number;
  private replyAudioFirstByteAt?: number;
  private replyAudioCompleteAt?: number;
  private coachingRequestSentAt?: number;
  private coachingRequestReturnedAt?: number;

  public constructor(log: TimingLog, now: Clock) {
    super(log, now);
  }

  public microphoneOpened(): void {
    this.microphoneOpenedAt = this.once(this.microphoneOpenedAt);
  }

  public firstChunkForwarded(): void {
    this.firstChunkForwardedAt = this.once(this.firstChunkForwardedAt);
  }

  public gateOpened(): void {
    this.gateFirstOpenedAt = this.once(this.gateFirstOpenedAt);
  }

  public gateClosed(): void {
    this.gateLastClosedAt = this.now();
  }

  public gateHeld(reason: 'calibration' | 'below-threshold', count = 1): void {
    this.gateHeldCount += Math.max(0, Math.round(count));
    this.gateReasons.add(reason);
  }

  public echoGateBlocked(): void {
    this.echoGateBlockedFromAt = this.once(this.echoGateBlockedFromAt);
  }

  public echoGateReleased(until: number): void {
    this.echoGateBlockedUntilAt = Math.max(this.echoGateBlockedUntilAt ?? 0, until);
  }

  public inputTranscriptionFragment(): void {
    const at = this.now();
    this.firstInputTranscriptionAt ??= at;
    this.lastInputTranscriptionAt = at;
  }

  public turnCommitted(): void {
    this.turnCommittedAt = this.once(this.turnCommittedAt);
  }

  public replyAudioFirstByte(): void {
    this.replyAudioFirstByteAt = this.once(this.replyAudioFirstByteAt);
  }

  public replyAudioComplete(): void {
    this.replyAudioCompleteAt = this.once(this.replyAudioCompleteAt);
  }

  public coachingRequestSent(): void {
    this.coachingRequestSentAt = this.once(this.coachingRequestSentAt);
  }

  public coachingRequestReturned(): void {
    this.coachingRequestReturnedAt = this.once(this.coachingRequestReturnedAt);
  }

  public write(): void {
    if (this.written) return;
    this.written = true;
    const reason = this.gateReasons.size === 0 ? 'none' : [...this.gateReasons].join('+');
    this.log(
      '[conversation timing] mode=Live offsets_ms ' +
      `microphone_opened=${offset(this.startedAt, this.microphoneOpenedAt)} ` +
      `first_chunk_forwarded=${offset(this.startedAt, this.firstChunkForwardedAt)} ` +
      `gate_first_opened=${offset(this.startedAt, this.gateFirstOpenedAt)} ` +
      `gate_last_closed=${offset(this.startedAt, this.gateLastClosedAt)} ` +
      `gate_held=${this.gateHeldCount} gate_reason=${reason} ` +
      `echo_gate_blocked_from=${offset(this.startedAt, this.echoGateBlockedFromAt)} ` +
      `echo_gate_blocked_until=${offset(this.startedAt, this.echoGateBlockedUntilAt)} ` +
      `first_input_transcription=${offset(this.startedAt, this.firstInputTranscriptionAt)} ` +
      `last_input_transcription=${offset(this.startedAt, this.lastInputTranscriptionAt)} ` +
      `turn_committed=${offset(this.startedAt, this.turnCommittedAt)} ` +
      `reply_audio_first_byte=${offset(this.startedAt, this.replyAudioFirstByteAt)} ` +
      `reply_audio_complete=${offset(this.startedAt, this.replyAudioCompleteAt)} ` +
      `coaching_request_sent=${offset(this.startedAt, this.coachingRequestSentAt)} ` +
      `coaching_request_returned=${offset(this.startedAt, this.coachingRequestReturnedAt)} ` +
      this.providerFields()
    );
  }
}

/** Holds only timestamps for one Standard conversation turn. */
export class StandardConversationTurnTiming extends ConversationTurnTiming {
  private dictationProvider?: 'handy' | 'gemini' | 'cloudflare' | 'groq';
  private dictationStartedAt?: number;
  private transcriptReceivedAt?: number;
  private quietPeriodStartedAt?: number;
  private quietPeriodElapsedAt?: number;
  private requestSentAt?: number;
  private replyReceivedAt?: number;
  private renderedAt?: number;

  public constructor(log: TimingLog, now: Clock) {
    super(log, now);
  }

  public dictationStarted(provider?: 'handy' | 'gemini' | 'cloudflare' | 'groq'): void {
    this.dictationProvider ??= provider;
    this.dictationStartedAt = this.once(this.dictationStartedAt);
  }

  public dictationProviderRan(provider: 'handy' | 'gemini' | 'cloudflare' | 'groq'): void {
    this.dictationProvider ??= provider;
  }

  public transcriptReceived(): void {
    this.transcriptReceivedAt = this.once(this.transcriptReceivedAt);
  }

  public quietPeriodStarted(): void {
    this.quietPeriodStartedAt = this.now();
  }

  public quietPeriodElapsed(): void {
    this.quietPeriodElapsedAt = this.once(this.quietPeriodElapsedAt);
  }

  public requestSent(): void {
    this.requestSentAt = this.once(this.requestSentAt);
  }

  public replyReceived(): void {
    this.replyReceivedAt = this.once(this.replyReceivedAt);
  }

  public rendered(): void {
    this.renderedAt = this.once(this.renderedAt);
  }

  public write(): void {
    if (this.written) return;
    this.written = true;
    this.log(
      '[conversation timing] mode=Standard offsets_ms ' +
      `dictation_provider=${this.dictationProvider ?? 'na'} ` +
      `dictation_started=${offset(this.startedAt, this.dictationStartedAt)} ` +
      `transcript_received=${offset(this.startedAt, this.transcriptReceivedAt)} ` +
      `quiet_period_started=${offset(this.startedAt, this.quietPeriodStartedAt)} ` +
      `quiet_period_elapsed=${offset(this.startedAt, this.quietPeriodElapsedAt)} ` +
      `request_sent=${offset(this.startedAt, this.requestSentAt)} ` +
      `reply_received=${offset(this.startedAt, this.replyReceivedAt)} ` +
      `rendered=${offset(this.startedAt, this.renderedAt)} ` +
      this.providerFields()
    );
  }
}
