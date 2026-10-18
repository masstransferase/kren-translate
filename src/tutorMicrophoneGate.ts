/**
 * Keeps a nearby conversation out of the Live session. The owner's room is not silent, and every
 * chunk KREN forwards is speech to Gemini, so someone talking behind them became their turn.
 *
 * The gate measures how loud each chunk is and forwards only what stands out from the room's own
 * quiet level. It works on distance: sound falls off as it travels, so a voice three meters away
 * reaches the microphone roughly ten times weaker than the reader's at arm's length. **It cannot
 * separate two people at the same distance**, which is what Press to talk is for.
 */

export type TutorMicrophoneSensitivity = 'quietRoom' | 'balanced' | 'noisyRoom';

export type TutorPauseBeforeReply = 1 | 2 | 3 | 4 | 5;
export type TutorSpeechDetection = 'kren' | 'geminiKren';

export function isTutorSpeechDetection(value: unknown): value is TutorSpeechDetection {
  return value === 'kren' || value === 'geminiKren';
}

export function isTutorPauseBeforeReply(value: unknown): value is TutorPauseBeforeReply {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

/**
 * V186, 2026-10-02: sensitivity selects the gate and Standard quiet period. Live uses the
 * separate Pause before reply setting, including hangover in that pause. The local ratios
 * bracket the existing 3.2 ratio without changing proven gate values.
 */
export const MICROPHONE_SENSITIVITY_PROFILES = {
  quietRoom: {
    gate: {
      calibrationChunks: 10,
      openRatio: 2.4,
      absoluteFloor: 120,
      preRollChunks: 2,
      openingChunks: 2,
      hangoverMs: 300,
      floorDecay: 0.05,
      maxFloor: 600
    },
    silenceDurationMs: 500,
    standardQuietPeriodMs: 500
  },
  balanced: {
    gate: {
      calibrationChunks: 10,
      openRatio: 3.2,
      absoluteFloor: 120,
      preRollChunks: 2,
      openingChunks: 2,
      hangoverMs: 300,
      floorDecay: 0.05,
      maxFloor: 600
    },
    silenceDurationMs: 800,
    standardQuietPeriodMs: 800
  },
  noisyRoom: {
    gate: {
      calibrationChunks: 10,
      openRatio: 4.2,
      absoluteFloor: 120,
      preRollChunks: 2,
      openingChunks: 2,
      hangoverMs: 300,
      floorDecay: 0.05,
      maxFloor: 600
    },
    silenceDurationMs: 1_000,
    standardQuietPeriodMs: 1_000
  }
} as const;

export function isTutorMicrophoneSensitivity(value: unknown): value is TutorMicrophoneSensitivity {
  return value === 'quietRoom' || value === 'balanced' || value === 'noisyRoom';
}

/** Compatibility name for the pre-V136, balanced gate. */
export const MICROPHONE_GATE = MICROPHONE_SENSITIVITY_PROFILES.balanced.gate;

export type TutorMicrophoneGateReason = 'calibration' | 'below-threshold';

export interface TutorMicrophoneGateDecision {
  chunks: string[];
  heldChunks: number;
  reason?: TutorMicrophoneGateReason;
  /** True only on the transition where this chunk is judged to be speech. */
  opened: boolean;
  /** True only on the first quiet chunk after the speech hangover expires. */
  closed: boolean;
}

type MicrophoneGateSettings = {
  readonly calibrationChunks: number;
  readonly openRatio: number;
  readonly absoluteFloor: number;
  readonly preRollChunks: number;
  readonly openingChunks: number;
  readonly hangoverMs: number;
  readonly floorDecay: number;
  readonly maxFloor: number;
};

/** Root mean square of one chunk of 16-bit little-endian mono PCM, 0 for an empty chunk. */
export function pcmRms(pcm: Buffer): number {
  const samples = Math.floor(pcm.byteLength / 2);
  if (samples === 0) return 0;
  let total = 0;
  for (let index = 0; index < samples; index += 1) {
    const sample = pcm.readInt16LE(index * 2);
    total += sample * sample;
  }
  return Math.sqrt(total / samples);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export class TutorMicrophoneGate {
  /** Last chunk judged loud while opening or maintaining speech, before quiet hangover. */
  public lastLoudChunkAt: number | undefined;
  private readonly calibration: number[] = [];
  private floor: number | undefined;
  private preRoll: string[] = [];
  private openUntil = 0;
  private open = false;
  private consecutiveLoudChunks = 0;

  private readonly settings: MicrophoneGateSettings;

  public constructor(
    private readonly now: () => number = Date.now,
    sensitivity: TutorMicrophoneSensitivity = 'balanced',
    private readonly openingChunks?: number
  ) {
    this.settings = MICROPHONE_SENSITIVITY_PROFILES[sensitivity].gate;
  }

  /**
   * Takes one chunk and returns what should be sent, oldest first: the held pre-roll and the
   * chunk when the gate opens, the chunk alone while it stays open, nothing while it is shut.
   */
  public accept(base64Pcm: string): string[] {
    return this.acceptWithReport(base64Pcm).chunks;
  }

  /** The same gate decision plus fixed, content-free diagnostics for the per-turn timing line. */
  public acceptWithReport(base64Pcm: string): TutorMicrophoneGateDecision {
    const settings = this.settings;
    const level = pcmRms(Buffer.from(base64Pcm, 'base64'));
    const calibrating = this.floor === undefined;
    if (calibrating) {
      this.calibration.push(level);
      if (this.calibration.length >= settings.calibrationChunks) {
        this.floor = Math.min(median(this.calibration), settings.maxFloor);
      }
    }
    const floor = this.floor ?? Math.min(median(this.calibration), settings.maxFloor);
    // During the first second the running median may be the reader's own voice. The absolute
    // floor therefore opens the gate until calibration completes, while those same chunks
    // continue teaching the capped room floor used by every later turn.
    const loud = calibrating
      ? level >= settings.absoluteFloor
      : level >= Math.max(floor * settings.openRatio, settings.absoluteFloor);
    this.consecutiveLoudChunks = loud ? this.consecutiveLoudChunks + 1 : 0;
    // 2026-10-02: A single click cannot open a hands-free turn; pre-roll keeps speech onset.
    if (loud && (this.open || this.consecutiveLoudChunks >= (this.openingChunks ?? settings.openingChunks))) {
      const opened = !this.open;
      this.open = true;
      this.lastLoudChunkAt = this.now();
      this.openUntil = this.lastLoudChunkAt + settings.hangoverMs;
      const held = this.preRoll;
      this.preRoll = [];
      return { chunks: [...held, base64Pcm], heldChunks: 0, opened, closed: false };
    }
    // A quiet chunk teaches the gate the room, never the other way round: the level only falls.
    if (this.floor !== undefined && level < this.floor) {
      this.floor += (level - this.floor) * settings.floorDecay;
    }
    if (this.now() < this.openUntil) {
      return { chunks: [base64Pcm], heldChunks: 0, opened: false, closed: false };
    }
    const closed = this.open;
    this.open = false;
    this.preRoll.push(base64Pcm);
    if (this.preRoll.length > settings.preRollChunks) this.preRoll.shift();
    return {
      chunks: [],
      heldChunks: 1,
      opened: false,
      closed,
      reason: calibrating ? 'calibration' : 'below-threshold'
    };
  }
}
