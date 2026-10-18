import { describe, expect, it } from 'vitest';
import {
  MICROPHONE_GATE,
  MICROPHONE_SENSITIVITY_PROFILES,
  TutorMicrophoneGate,
  pcmRms
} from '../src/tutorMicrophoneGate.js';

function pcmChunk(amplitude: number): string {
  const pcm = Buffer.alloc(3200);
  for (let offset = 0; offset < pcm.length; offset += 2) pcm.writeInt16LE(amplitude, offset);
  return pcm.toString('base64');
}

describe('Tutor Live microphone loudness gate', () => {
  // Added 2026-10-02: V183 guards clicks independently in every sensitivity profile.
  it.each(['quietRoom', 'balanced', 'noisyRoom'] as const)(
    'V183 requires two consecutive loud chunks in %s with speech onset in pre-roll', (sensitivity) => {
      let clock = 1_000;
      const gate = new TutorMicrophoneGate(() => clock, sensitivity);
      const loud = pcmChunk(4_000);
      const quiet = pcmChunk(0);
      expect(gate.acceptWithReport(loud)).toMatchObject({ opened: false, chunks: [] });
      clock += 100;
      expect(gate.acceptWithReport(quiet)).toMatchObject({ opened: false, chunks: [] });
      expect(gate.acceptWithReport(loud)).toMatchObject({ opened: false, chunks: [] });
      clock += 100;
      expect(gate.acceptWithReport(loud)).toMatchObject({ opened: true, chunks: [quiet, loud, loud] });
    }
  );
  it('measures signed 16-bit little-endian PCM by root mean square', () => {
    expect(pcmRms(Buffer.from(pcmChunk(240), 'base64'))).toBe(240);
    expect(pcmRms(Buffer.alloc(0))).toBe(0);
  });

  // Changed 2026-10-02: V183 holds speech onset until the second loud chunk, preserving pre-roll.
  it('V183 holds a loud first chunk while it continues calibrating the room', () => {
    const gate = new TutorMicrophoneGate(() => 1_000);
    const firstWord = pcmChunk(MICROPHONE_GATE.absoluteFloor * 2);

    expect(gate.accept(firstWord)).toEqual([]);
    expect(gate.accept(firstWord)).toEqual([firstWord, firstWord]);
  });

  it('V139 reports the first speech opening and the later transition back to closed', () => {
    let clock = 1_000;
    const gate = new TutorMicrophoneGate(() => clock);
    // Changed 2026-10-02: V183 opens on the second consecutive loud chunk.
    gate.accept(pcmChunk(MICROPHONE_GATE.absoluteFloor * 2));
    const opened = gate.acceptWithReport(pcmChunk(MICROPHONE_GATE.absoluteFloor * 2));
    expect(opened).toMatchObject({ opened: true, closed: false });

    clock += MICROPHONE_GATE.hangoverMs + 1;
    const closed = gate.acceptWithReport(pcmChunk(0));
    expect(closed).toMatchObject({ opened: false, closed: true });
    expect(gate.acceptWithReport(pcmChunk(0))).toMatchObject({ opened: false, closed: false });
  });

  // Added 2026-09-20 by hand after V126: a reader who starts talking immediately would
  // otherwise teach the gate that their own voice is the room's quiet level, and stay shut.
  it('does not learn a talking reader as the room, and still opens for them', () => {
    let clock = 1_000;
    const gate = new TutorMicrophoneGate(() => clock);
    const speech = pcmChunk(4000);
    for (let chunk = 0; chunk < MICROPHONE_GATE.calibrationChunks; chunk += 1) {
      clock += 100;
      gate.accept(speech);
    }
    // Past the hangover, so this chunk is judged on its own and not carried by the previous one.
    clock += MICROPHONE_GATE.hangoverMs + 100;
    expect(gate.accept(speech)).toEqual([speech]);
  });

  // Added 2026-09-20: this ratio check pins the layer B boundary independently of the
  // controller test, so changing the gate to forward every helper chunk must turn it red.
  it('passes four times the learned floor while twice the floor stays closed', () => {
    const gate = new TutorMicrophoneGate(() => 1_000);
    const quiet = pcmChunk(100);
    for (let index = 0; index < MICROPHONE_GATE.calibrationChunks; index += 1) {
      expect(gate.accept(quiet)).toEqual([]);
    }

    expect(gate.accept(pcmChunk(200))).toEqual([]);
    // Changed 2026-10-02: V183 keeps the first loud chunk in the two-chunk pre-roll.
    expect(gate.accept(pcmChunk(400))).toEqual([]);
    expect(gate.accept(pcmChunk(400))).toEqual([pcmChunk(200), pcmChunk(400), pcmChunk(400)]);
  });

  it('V136 gives every sensitivity its own gate ratio and Standard quiet period', () => {
    expect(MICROPHONE_SENSITIVITY_PROFILES.quietRoom.gate.openRatio)
      .toBeLessThan(MICROPHONE_SENSITIVITY_PROFILES.balanced.gate.openRatio);
    expect(MICROPHONE_SENSITIVITY_PROFILES.noisyRoom.gate.openRatio)
      .toBeGreaterThan(MICROPHONE_SENSITIVITY_PROFILES.balanced.gate.openRatio);
    expect(new Set(Object.values(MICROPHONE_SENSITIVITY_PROFILES)
      .map((profile) => profile.standardQuietPeriodMs))).toEqual(new Set([500, 800, 1_000]));
    expect(new Set(Object.values(MICROPHONE_SENSITIVITY_PROFILES)
      .map((profile) => profile.silenceDurationMs))).toEqual(new Set([500, 800, 1_000]));

    const calibrated = (sensitivity: 'quietRoom' | 'balanced' | 'noisyRoom') => {
      const gate = new TutorMicrophoneGate(() => 1_000, sensitivity);
      for (let index = 0; index < 10; index += 1) gate.accept(pcmChunk(100));
      // Changed 2026-10-02: Prime one loud chunk; the assertion still verifies each ratio.
      return { accept: (chunk: string) => { gate.accept(chunk); return gate.accept(chunk); } };
    };
    expect(calibrated('quietRoom').accept(pcmChunk(250))).not.toEqual([]);
    expect(calibrated('balanced').accept(pcmChunk(250))).toEqual([]);
    expect(calibrated('balanced').accept(pcmChunk(350))).not.toEqual([]);
    expect(calibrated('noisyRoom').accept(pcmChunk(350))).toEqual([]);
    expect(calibrated('noisyRoom').accept(pcmChunk(430))).not.toEqual([]);
  });
});
