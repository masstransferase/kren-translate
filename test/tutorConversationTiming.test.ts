import { describe, expect, it, vi } from 'vitest';
import {
  LiveConversationTurnTiming,
  StandardConversationTurnTiming
} from '../src/tutor/conversationTiming.js';

describe('V136 conversation turn timing', () => {
  it('writes one Live line carrying every named event and fixed gate reasons', () => {
    let clock = 1_000;
    const log = vi.fn();
    const timing = new LiveConversationTurnTiming(log, () => clock);
    timing.microphoneOpened();
    clock += 20;
    timing.gateHeld('below-threshold', 2);
    clock += 10;
    timing.firstChunkForwarded();
    timing.gateOpened();
    clock += 10;
    timing.gateClosed();
    clock += 20;
    timing.echoGateBlocked();
    timing.echoGateReleased(1_080);
    clock += 30;
    timing.inputTranscriptionFragment();
    clock += 10;
    timing.inputTranscriptionFragment();
    clock += 10;
    timing.turnCommitted();
    timing.coachingRequestSent();
    timing.providerAttempt();
    timing.providerBackoff(1_000);
    timing.providerAttempt();
    timing.providerBackoff(2_000);
    timing.providerAttempt();
    timing.providerBackoff(4_000);
    timing.providerAttempt();
    clock += 20;
    timing.replyAudioFirstByte();
    clock += 30;
    timing.replyAudioComplete();
    clock += 40;
    timing.coachingRequestReturned();
    timing.write();
    timing.write();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toBe(
      '[conversation timing] mode=Live offsets_ms ' +
      'microphone_opened=0 first_chunk_forwarded=30 gate_first_opened=30 gate_last_closed=40 ' +
      'gate_held=2 gate_reason=below-threshold ' +
      'echo_gate_blocked_from=60 echo_gate_blocked_until=80 ' +
      'first_input_transcription=90 last_input_transcription=100 ' +
      'turn_committed=110 reply_audio_first_byte=130 reply_audio_complete=160 ' +
      'coaching_request_sent=110 coaching_request_returned=200 ' +
      'provider_attempts=4 provider_backoff_ms=7000'
    );
  });

  it('writes one Standard line carrying every named event', () => {
    let clock = 2_000;
    const log = vi.fn();
    const timing = new StandardConversationTurnTiming(log, () => clock);
    timing.dictationStarted('gemini');
    clock += 100;
    timing.transcriptReceived();
    timing.quietPeriodStarted();
    clock += 500;
    timing.quietPeriodElapsed();
    timing.requestSent();
    timing.providerAttempt();
    timing.providerBackoff(500);
    timing.providerAttempt();
    clock += 200;
    timing.replyReceived();
    clock += 10;
    timing.rendered();
    timing.write();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toBe(
      '[conversation timing] mode=Standard offsets_ms ' +
      'dictation_provider=gemini dictation_started=0 transcript_received=100 quiet_period_started=100 ' +
      'quiet_period_elapsed=600 request_sent=600 reply_received=800 rendered=810'
      + ' provider_attempts=2 provider_backoff_ms=500'
    );
  });

  it('never writes spoken text, KREN text, an identifier or a credential', () => {
    const privateValues = [
      'spoken-private-sentence', 'written-private-reply',
      'turn-id-private-42', 'credential-private-42'
    ];
    const lines: string[] = [];
    const live = new LiveConversationTurnTiming((line) => lines.push(line), () => 10);
    live.microphoneOpened();
    live.gateHeld('calibration', 1);
    live.write();
    const standard = new StandardConversationTurnTiming((line) => lines.push(line), () => 20);
    standard.dictationStarted();
    standard.write();

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      for (const privateValue of privateValues) expect(line).not.toContain(privateValue);
      expect(line).not.toMatch(/(?:answer|question|reply_text|transcript_text|turn_id|credential)=/u);
    }
  });
});
