// 2026-10-10: V216 renames reader-facing Gemini profiles Free Tier and Paid; exact expectations follow the brief.
import { describe, expect, it, vi } from 'vitest';
import {
  GEMINI_TRANSCRIPTION_MODEL,
  buildGeminiTranscriptionRequestBody,
  transcribeGeminiAudio
} from '../src/providers/gemini.js';
import {
  KREN_SECRET_KEYS,
  runTutorAudioTranscription,
  type KrenRuntime
} from '../src/operations.js';

function runtime(secret = 'credential'): KrenRuntime {
  return {
    getSecret: vi.fn(async () => secret || undefined),
    getSetting: vi.fn((_key: string, fallback: unknown) => fallback) as never,
    reserveCloudCharacters: vi.fn(),
    beforeGeminiRequest: vi.fn(),
    beforeLanguageModelRequest: vi.fn()
  };
}

describe('Gemini 3.5 audio transcription boundary', () => {
  it('sends only inline WAV bytes to the fixed non-live transcription model', async () => {
    const audio = Uint8Array.from([1, 2, 3, 4]);
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '  Spoken answer.  ' }] } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await expect(transcribeGeminiAudio(
      'credential', audio, new AbortController().signal, 1, fetcher
    ))
      .resolves.toBe('Spoken answer.');
    expect(GEMINI_TRANSCRIPTION_MODEL).toBe('gemini-3.5-transcribe');
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-transcribe:generateContent'
    );
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': 'credential' }
    });
    expect(JSON.parse(String(init!.body))).toEqual(buildGeminiTranscriptionRequestBody(audio));
    expect(JSON.stringify(JSON.parse(String(init!.body)))).not.toContain('credential');
  });

  it('names an empty provider transcript as a failure', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '   ' }] } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await expect(transcribeGeminiAudio(
      'credential', Uint8Array.from([1]), new AbortController().signal, 1, fetcher
    )).rejects.toThrow(/empty transcript/iu);
  });

  it('reuses the Gemini Free Tier secret and consent path without exposing the key', async () => {
    const host = runtime();
    const transcribe = vi.fn(async () => 'Answer');
    await expect(runTutorAudioTranscription(
      host, Uint8Array.from([9]), new AbortController().signal, transcribe
    )).resolves.toBe('Answer');
    expect(host.getSecret).toHaveBeenCalledWith(KREN_SECRET_KEYS.gemini);
    expect(host.beforeLanguageModelRequest).toHaveBeenCalledWith('gemini', 'standard');
    expect(transcribe).toHaveBeenCalledWith(
      'credential', Uint8Array.from([9]), expect.any(AbortSignal), 3
    );
  });

  it('names the missing Gemini Free Tier key before any audio request', async () => {
    const host = runtime('');
    const transcribe = vi.fn();
    await expect(runTutorAudioTranscription(
      host, Uint8Array.from([9]), new AbortController().signal, transcribe
    )).rejects.toThrow(/Gemini Free Tier API key/iu);
    expect(transcribe).not.toHaveBeenCalled();
  });
});
