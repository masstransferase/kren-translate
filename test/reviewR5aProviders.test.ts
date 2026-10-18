import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider, listOpenAIModels } from '../src/providers/openai.js';
import { AnthropicProvider, listAnthropicModels } from '../src/providers/anthropic.js';
import { GeminiProvider, geminiErrorMetadata, transcribeGeminiAudio } from '../src/providers/gemini.js';
import { listGeminiProModels } from '../src/providers/geminiModels.js';
import { GoogleCloudTranslationProvider } from '../src/providers/googleCloudTranslation.js';
import { generateSituationPicture } from '../src/providers/situationPicture.js';
import { requestTutorStructuredJson, tutorExampleQuestionRequest } from '../src/tutor/generation.js';
import { MerriamWebsterProvider } from '../src/providers/merriamWebster.js';
import { KoreanDictionaryProvider } from '../src/providers/koreanDictionary.js';
import type { TranslationRequest } from '../src/types.js';

const request: TranslationRequest = {
  text: 'hello', sourceLanguage: 'en', targetLanguage: 'ko', kind: 'translation', operation: 'explain'
};
const signal = () => new AbortController().signal;
// Deliberately synthetic, masked provider text, never a credential.
const serverText = 'Incorrect API key provided: sk-proj-****abcd';
afterEach(() => vi.unstubAllGlobals());

describe('R5a finding 1: provider error bodies never reach readers', () => {
  it('keeps bounded structured quota diagnostics and drops free text in those fields', () => {
    const payload = (quotaId: string, retryDelay: string) => ({ error: { message: serverText, details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId }] },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }
    ] } });
    // Changed 2026-10-17: V259, R14 finding 1, quota diagnostics expose only the window category.
    expect(geminiErrorMetadata(payload('limits:GenerateRequests/PerDay-FreeTier', '47s')))
      .toContain('"quotaCategory":"perDay"');
    expect(geminiErrorMetadata(payload('limits:GenerateRequests/PerDay-FreeTier', '47s')))
      .toContain('"retryDelay":"47s"');
    // Changed 2026-10-16: V257, R13 finding 1, an unknown quota name is reported as "other";
    // the server's free text must still never appear.
    const freeText = geminiErrorMetadata(payload(serverText, '47s ' + serverText));
    expect(freeText).not.toContain('sk-proj');
    expect(freeText).not.toContain('Incorrect API key');
    expect(freeText.trim()).toBe('{"quotaCategory":"other"}');
    expect(geminiErrorMetadata(payload('x'.repeat(161), 'x'.repeat(161))).trim()).toBe('{"quotaCategory":"other"}');
  });
  it('keeps safety finish identifiers but drops free-text refusal and finish fields', async () => {
    for (const provider of ['gemini', 'openai', 'anthropic'] as const) {
      for (const finishReason of ['SAFETY', serverText, 'x'.repeat(161)]) {
        const fetcher = vi.fn(async () => new Response(JSON.stringify({ refusal: serverText, finishReason }), { status: 200 }));
        const error = await requestTutorStructuredJson({ provider, apiKey: 'test-key', model: 'test-model', thinkingOrEffort: 'low', maxAttempts: 1 },
          tutorExampleQuestionRequest({ sentence: 'Hello.', question: 'Why?' }), signal(), fetcher).catch((value: Error) => value);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).not.toContain(serverText);
        expect((error as Error).message).not.toContain('x'.repeat(161));
        if (finishReason === 'SAFETY') expect((error as Error).message).toContain('SAFETY');
      }
    }
  });
  it('suppresses Korean Dictionary XML error messages even with HTTP 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`<error><error_code>020</error_code><message>${serverText}</message></error>`, { status: 200 })));
    const error = await new KoreanDictionaryProvider('test-key').lookup({ ...request, operation: 'translate', kind: 'dictionary' }, signal()).catch((value: Error) => value);
    expect(error).toBeInstanceOf(Error);
    for (const fragment of ['Incorrect', 'sk-proj', 'abcd']) expect((error as Error).message).not.toContain(fragment);
    expect(error).toMatchObject({ action: 'setDictionaryKey' });
  });
  const calls = {
    OpenAI: () => new OpenAIProvider('test-key', 'test-model', 'auto', 1).explain(request, signal()),
    Anthropic: () => new AnthropicProvider('test-key', 'test-model', 'low', 1).explain(request, signal()),
    Gemini: () => new GeminiProvider('test-key', 'test-model').explain(request, signal()),
    Cloud: () => new GoogleCloudTranslationProvider('test-key', async () => undefined).translate(request, signal()),
    'OpenAI discovery': () => listOpenAIModels('test-key', signal()),
    'Anthropic discovery': () => listAnthropicModels('test-key', signal()),
    'Gemini discovery': () => listGeminiProModels('test-key', signal()),
    'Gemini transcription': () => transcribeGeminiAudio('test-key', new Uint8Array([1]), signal(), 1),
    'Gemini picture': () => generateSituationPicture('a room', 'test-key', signal())
    , Collegiate: () => new MerriamWebsterProvider('test-key', 'collegiate').lookup({ ...request, operation: 'translate', kind: 'dictionary' }, signal())
    , Medical: () => new MerriamWebsterProvider('test-key', 'medical').lookup({ ...request, operation: 'translate', kind: 'dictionary' }, signal())
    , Thesaurus: () => new MerriamWebsterProvider('test-key', 'thesaurus').lookup({ ...request, operation: 'translate', kind: 'dictionary' }, signal())
    , Korean: () => new KoreanDictionaryProvider('test-key').lookup({ ...request, operation: 'translate', kind: 'dictionary' }, signal())
  };
  it.each(Object.entries(calls))('%s rejects authentication with only fixed local wording', async (_name, call) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { message: serverText, status: serverText }
    }), { status: 401 })));
    const error = await call().catch((value: Error) => value);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    for (const fragment of ['Incorrect', 'sk-proj', 'abcd', serverText]) expect(message).not.toContain(fragment);
  });
  it.each(['gemini', 'openai', 'anthropic'] as const)('%s structured transport suppresses both error and unusable-result body text', async (provider) => {
    for (const status of [401, 200]) {
      const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: serverText } }), { status }));
      const error = await requestTutorStructuredJson({ provider, apiKey: 'test-key', model: 'test-model', thinkingOrEffort: 'low', maxAttempts: 1 },
        tutorExampleQuestionRequest({ sentence: 'Hello.', question: 'Why?' }), signal(), fetcher).catch((value: Error) => value);
      expect(error).toBeInstanceOf(Error);
      for (const fragment of ['Incorrect', 'sk-proj', 'abcd']) expect((error as Error).message).not.toContain(fragment);
    }
  });
});
