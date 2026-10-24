import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KREN_SECRET_KEYS, runTutorAudioTranscription, type KrenRuntime } from '../src/operations.js';
import { transcribeGroqAudio } from '../src/providers/openAICompatible.js';
import { transcribeCloudflareAudio } from '../src/providers/cloudflare.js';

vi.mock('../src/providers/openAICompatible.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/providers/openAICompatible.js')>(),
  transcribeGroqAudio: vi.fn()
}));
vi.mock('../src/providers/cloudflare.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/providers/cloudflare.js')>(),
  transcribeCloudflareAudio: vi.fn()
}));

function runtime(): KrenRuntime {
  return {
    getSecret: vi.fn(async () => 'credential'),
    getSetting: <T>(_key: string, fallback: T) => fallback,
    reserveCloudCharacters: vi.fn(),
    beforeGeminiRequest: vi.fn(),
    beforeLanguageModelRequest: vi.fn()
  };
}

beforeEach(() => vi.resetAllMocks());

describe.each(['groq', 'cloudflare', 'gemini'] as const)('%s transcription consent', provider => {
  it('rejects declined consent without reading credentials or requesting transcription', async () => {
    const host = runtime();
    const canceled = new Error('Consent declined.');
    vi.mocked(host.beforeLanguageModelRequest!).mockRejectedValue(canceled);
    const gemini = vi.fn();

    await expect(runTutorAudioTranscription(
      host, Uint8Array.of(1), new AbortController().signal, gemini, provider
    )).rejects.toBe(canceled);

    expect(host.beforeLanguageModelRequest).toHaveBeenCalledExactlyOnceWith(provider, 'standard');
    expect(host.getSecret).not.toHaveBeenCalled();
    expect(transcribeGroqAudio).not.toHaveBeenCalled();
    expect(transcribeCloudflareAudio).not.toHaveBeenCalled();
    expect(gemini).not.toHaveBeenCalled();
  });

  it('awaits one consent hook before credentials and the selected transcription request', async () => {
    const host = runtime();
    const events: string[] = [];
    let accept!: () => void;
    const decision = new Promise<void>(resolve => { accept = resolve; });
    vi.mocked(host.beforeLanguageModelRequest!).mockImplementation(async () => {
      events.push('consent');
      await decision;
      events.push('accepted');
    });
    vi.mocked(host.getSecret).mockImplementation(async key => {
      events.push(key);
      return 'credential';
    });
    const transcribe = async () => { events.push('request'); return 'Spoken answer.'; };
    vi.mocked(transcribeGroqAudio).mockImplementation(transcribe);
    vi.mocked(transcribeCloudflareAudio).mockImplementation(transcribe);
    const gemini = vi.fn(transcribe);
    const audio = Uint8Array.of(1, 2);
    const signal = new AbortController().signal;
    const result = runTutorAudioTranscription(host, audio, signal, gemini, provider);

    expect(events).toEqual(['consent']);
    expect(host.getSecret).not.toHaveBeenCalled();
    expect(transcribeGroqAudio).not.toHaveBeenCalled();
    expect(transcribeCloudflareAudio).not.toHaveBeenCalled();
    expect(gemini).not.toHaveBeenCalled();
    accept();
    await expect(result).resolves.toBe('Spoken answer.');

    expect(host.beforeLanguageModelRequest).toHaveBeenCalledExactlyOnceWith(provider, 'standard');
    expect(host.beforeGeminiRequest).not.toHaveBeenCalled();
    const keys = provider === 'cloudflare'
      ? [KREN_SECRET_KEYS.cloudflareAccountId, KREN_SECRET_KEYS.cloudflareApiToken]
      : [KREN_SECRET_KEYS[provider]];
    expect(events).toEqual(['consent', 'accepted', ...keys, 'request']);
    expect(host.getSecret).toHaveBeenCalledTimes(keys.length);
    if (provider === 'groq') {
      expect(transcribeGroqAudio).toHaveBeenCalledExactlyOnceWith('credential', audio, signal);
      expect(transcribeCloudflareAudio).not.toHaveBeenCalled();
      expect(gemini).not.toHaveBeenCalled();
    } else if (provider === 'cloudflare') {
      expect(transcribeCloudflareAudio).toHaveBeenCalledExactlyOnceWith('credential', 'credential', audio, signal);
      expect(transcribeGroqAudio).not.toHaveBeenCalled();
      expect(gemini).not.toHaveBeenCalled();
    } else {
      expect(gemini).toHaveBeenCalledExactlyOnceWith('credential', audio, signal, 3);
      expect(transcribeGroqAudio).not.toHaveBeenCalled();
      expect(transcribeCloudflareAudio).not.toHaveBeenCalled();
    }
  });
});

it('preserves the legacy Gemini consent hook when the general hook is absent', async () => {
  const host = runtime();
  host.beforeLanguageModelRequest = undefined;
  vi.mocked(host.beforeGeminiRequest).mockRejectedValue(new Error('Consent declined.'));
  const gemini = vi.fn();
  await expect(runTutorAudioTranscription(
    host, Uint8Array.of(1), new AbortController().signal, gemini
  )).rejects.toThrow('Consent declined.');
  expect(host.beforeGeminiRequest).toHaveBeenCalledExactlyOnceWith('standard');
  expect(host.getSecret).not.toHaveBeenCalled();
  expect(gemini).not.toHaveBeenCalled();
});

it('puts the audio disclosure in the shared modal permission dialog and retains existing consent', () => {
  const source = readFileSync('src/extension.ts', 'utf8');
  const consent = source.slice(source.indexOf('async function ensureLanguageModelConsent('), source.indexOf('async function ensureGeminiConsent('));
  const sharedDialog = consent.slice(consent.indexOf("if (provider === 'groq' || provider === 'cloudflare')"), consent.indexOf("const consentKey = provider === 'openai'"));
  expect(sharedDialog).toContain('`kren.${provider}.consent.v1`');
  expect(sharedDialog).toContain('if (context.globalState.get<boolean>(consentKey, false)) return;');
  // The disclosure is in the visible modal message, before its affirmative action.
  expect(sharedDialog).toMatch(/await showKrenWarningMessage\(\s*`[^`]*Recordings[^`]*transcription[^`]*audio[^`]*`,\s*\{ modal: true \}, 'I Understand'\)/u);
  expect(sharedDialog).toContain("if (accepted !== 'I Understand') throw new Error");
});
