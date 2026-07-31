import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isEnglishDictionaryQuery,
  KREN_SECRET_KEYS,
  runKrenOperation,
  type KrenRuntime
} from '../src/operations.js';

afterEach(() => vi.restoreAllMocks());

describe('English dictionary query validation', () => {
  it('accepts words and short multi-word expressions', () => {
    expect(isEnglishDictionaryQuery('ledger')).toBe(true);
    expect(isEnglishDictionaryQuery('take on')).toBe(true);
    expect(isEnglishDictionaryQuery('settle on')).toBe(true);
    expect(isEnglishDictionaryQuery('get rid of')).toBe(true);
  });

  it('does not treat sentences or Korean text as English dictionary expressions', () => {
    expect(isEnglishDictionaryQuery('This is a complete sentence with far too many separate words.')).toBe(false);
    expect(isEnglishDictionaryQuery('나무')).toBe(false);
  });

  it('tries Merriam-Webster before Google Cloud for an unmatched expression', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          translations: [{ translatedText: '없애다', detectedSourceLanguage: 'en' }]
        }
      }), { status: 200 }));
    let reserved = 0;
    const secrets = new Map<string, string>([
      [KREN_SECRET_KEYS.merriamWebsterCollegiate, 'mw-key'],
      [KREN_SECRET_KEYS.googleCloudTranslation, 'cloud-key']
    ]);
    const runtime: KrenRuntime = {
      getSecret: async (key) => secrets.get(key),
      getSetting: <T>(key: string, fallback: T): T =>
        (key === 'translation.targetLanguage' ? 'ko' : fallback) as T,
      reserveCloudCharacters: async (characters) => { reserved += characters; },
      beforeGeminiRequest: async () => undefined
    };

    const result = await runKrenOperation(
      runtime,
      'englishDictionary',
      { text: 'get rid of' },
      new AbortController().signal
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/collegiate/json/get%20rid%20of');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('translation.googleapis.com');
    expect(result).toMatchObject({
      kind: 'translation',
      providerId: 'googleCloudTranslation',
      translatedText: '없애다'
    });
    expect(reserved).toBe(10);
  });

  it('does not translate an unmatched phrase when the fallback is disabled', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 })
    );
    const runtime: KrenRuntime = {
      getSecret: async (key) => key === KREN_SECRET_KEYS.merriamWebsterCollegiate
        ? 'mw-key'
        : undefined,
      getSetting: <T>(key: string, fallback: T): T =>
        (key === 'dictionary.multiWordTranslationFallback' ? false : fallback) as T,
      reserveCloudCharacters: async () => undefined,
      beforeGeminiRequest: async () => undefined
    };

    await expect(runKrenOperation(
      runtime,
      'englishDictionary',
      { text: 'get rid of' },
      new AbortController().signal
    )).rejects.toThrow('fallback is disabled');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('routes alternate-profile rewrites with the configured supported thinking level', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        detectedLanguage: 'en',
        variants: [
          { id: 'natural', text: 'Use our combined strengths.' },
          { id: 'concise', text: 'Combine our strengths.' },
          { id: 'jargonFree', text: 'Work together effectively.' }
        ]
      }) }] } }]
    }), { status: 200 }));
    let consentProfile: string | undefined;
    const runtime: KrenRuntime = {
      getSecret: async (key) => key === KREN_SECRET_KEYS.geminiPro ? 'pro-key' : undefined,
      getSetting: <T>(key: string, fallback: T): T => {
        const settings: Record<string, unknown> = {
          'rewrite.geminiProfile': 'pro',
          'gemini.alternateModel': 'gemini-3.1-pro-preview',
          'gemini.alternateThinkingLevel': 'high',
          'grammar.dialect': 'british',
          'rewrite.domain': 'academic',
          'rewrite.tone': 'preserveVoice'
        };
        return (settings[key] ?? fallback) as T;
      },
      reserveCloudCharacters: async () => undefined,
      beforeGeminiRequest: async (profile) => { consentProfile = profile; }
    };

    const result = await runKrenOperation(
      runtime,
      'rewrite',
      { text: 'Leverage synergies.' },
      new AbortController().signal
    );

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      systemInstruction: { parts: Array<{ text: string }> };
      contents: Array<{ parts: Array<{ text: string }> }>;
      generationConfig: { thinkingConfig: { thinkingLevel: string } };
    };
    expect(requestBody.contents[0]?.parts[0]?.text).toBe('Leverage synergies.');
    expect(requestBody.generationConfig.thinkingConfig.thinkingLevel).toBe('high');
    expect(requestBody.systemInstruction.parts[0]?.text).toContain('disciplined academic prose');
    expect(requestBody.systemInstruction.parts[0]?.text).toContain('British English');
    expect(requestBody.systemInstruction.parts[0]?.text).toContain("writer's recognizable voice");
    expect(consentProfile).toBe('pro');
    expect(result.kind).toBe('rewrite');
    expect(result).toMatchObject({ englishVariety: 'british' });
  });

  it('falls back from Pro 3.1 to Pro 2.5 only after transient retries are exhausted', async () => {
    const overloaded = (): Response => new Response(
      JSON.stringify({ error: { message: 'High demand' } }),
      { status: 503, headers: { 'retry-after': '0' } }
    );
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(overloaded())
      .mockResolvedValueOnce(overloaded())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ detectedLanguage: 'en', variants: [
          { id: 'natural', text: 'Data packages prepared for partners.' },
          { id: 'concise', text: 'Partner-ready data packages.' },
          { id: 'jargonFree', text: 'Data packages that partners can use.' }
        ] }) }] } }]
      }), { status: 200 }));
    const runtime: KrenRuntime = {
      getSecret: async (key) => key === KREN_SECRET_KEYS.geminiPro ? 'pro-key' : undefined,
      getSetting: <T>(key: string, fallback: T): T => {
        const settings: Record<string, unknown> = {
          'rewrite.geminiProfile': 'pro',
          'gemini.alternateModel': 'gemini-3.1-pro-preview',
          'gemini.alternateFallbackEnabled': true,
          'gemini.alternateFallbackModel': 'gemini-3.5-flash',
          'gemini.alternateFallbackThinkingLevel': 'medium',
          'gemini.retry.maxAttempts': 2
        };
        return (settings[key] ?? fallback) as T;
      },
      reserveCloudCharacters: async () => undefined,
      beforeGeminiRequest: async () => undefined
    };

    const result = await runKrenOperation(
      runtime,
      'rewrite',
      { text: 'partner-ready data packages.' },
      new AbortController().signal
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('gemini-3.1-pro-preview');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('gemini-3.1-pro-preview');
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('gemini-3.5-flash');
    const fallbackRequestBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)) as {
      generationConfig: { thinkingConfig: { thinkingLevel: string } };
    };
    expect(fallbackRequestBody.generationConfig.thinkingConfig.thinkingLevel).toBe('medium');
    expect(result).toMatchObject({
      kind: 'rewrite',
      modelId: 'gemini-3.5-flash',
      fallbackFromModel: 'gemini-3.1-pro-preview'
    });
  });

  it('uses the configured alternate Gemini fallback after malformed structured output', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{not valid json' }] } }]
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ detectedLanguage: 'en', variants: [
          { id: 'natural', text: 'Data packages prepared for partners.' },
          { id: 'concise', text: 'Partner-ready data packages.' },
          { id: 'jargonFree', text: 'Data packages that partners can use.' }
        ] }) }] } }]
      }), { status: 200 }));
    const runtime: KrenRuntime = {
      getSecret: async (key) => key === KREN_SECRET_KEYS.geminiPro ? 'pro-key' : undefined,
      getSetting: <T>(key: string, fallback: T): T => {
        const settings: Record<string, unknown> = {
          'rewrite.geminiProfile': 'pro',
          'gemini.alternateModel': 'gemini-3.1-pro-preview',
          'gemini.alternateFallbackEnabled': true,
          'gemini.alternateFallbackModel': 'gemini-3.5-flash',
          'gemini.retry.maxAttempts': 2
        };
        return (settings[key] ?? fallback) as T;
      },
      reserveCloudCharacters: async () => undefined,
      beforeGeminiRequest: async () => undefined
    };

    const result = await runKrenOperation(
      runtime,
      'rewrite',
      { text: 'partner-ready data packages.' },
      new AbortController().signal
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('gemini-3.1-pro-preview');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('gemini-3.5-flash');
    expect(result).toMatchObject({
      kind: 'rewrite',
      modelId: 'gemini-3.5-flash',
      fallbackFromModel: 'gemini-3.1-pro-preview'
    });
  });

  it('does not use the alternate-profile fallback for a non-transient request error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid request' } }), { status: 400 })
    );
    const runtime: KrenRuntime = {
      getSecret: async (key) => key === KREN_SECRET_KEYS.geminiPro ? 'pro-key' : undefined,
      getSetting: <T>(key: string, fallback: T): T => {
        const settings: Record<string, unknown> = {
          'rewrite.geminiProfile': 'pro',
          'gemini.alternateModel': 'gemini-3.1-pro-preview',
          'gemini.alternateFallbackEnabled': true,
          'gemini.alternateFallbackModel': 'gemini-3.5-flash'
        };
        return (settings[key] ?? fallback) as T;
      },
      reserveCloudCharacters: async () => undefined,
      beforeGeminiRequest: async () => undefined
    };

    await expect(runKrenOperation(
      runtime,
      'rewrite',
      { text: 'partner-ready data packages.' },
      new AbortController().signal
    )).rejects.toThrow('Gemini request failed (400)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('routes explanation through the explicitly selected alternate Gemini profile', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        kind: 'translation',
        translatedText: 'A careful explanation.',
        alternatives: [],
        note: ''
      }) }] } }]
    }), { status: 200 }));
    let consentProfile: string | undefined;
    const runtime: KrenRuntime = {
      getSecret: async (key) => key === KREN_SECRET_KEYS.geminiPro ? 'alternate-key' : undefined,
      getSetting: <T>(key: string, fallback: T): T => {
        const settings: Record<string, unknown> = {
          'explanation.provider': 'gemini',
          'explanation.geminiProfile': 'pro',
          'gemini.alternateModel': 'gemini-3.1-pro-preview',
          'gemini.alternateThinkingLevel': 'high',
          'gemini.retry.maxAttempts': 1
        };
        return (settings[key] ?? fallback) as T;
      },
      reserveCloudCharacters: async () => undefined,
      beforeGeminiRequest: async (profile) => { consentProfile = profile; }
    };

    const result = await runKrenOperation(
      runtime,
      'explain',
      { text: 'operationally fragile', outputLanguage: 'en' },
      new AbortController().signal
    );

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      generationConfig: { thinkingConfig: { thinkingLevel: string } };
    };
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('gemini-3.1-pro-preview');
    expect(requestBody.generationConfig.thinkingConfig.thinkingLevel).toBe('high');
    expect(consentProfile).toBe('pro');
    expect(result).toMatchObject({ providerId: 'gemini', modelId: 'gemini-3.1-pro-preview' });
  });

  it.each([
    { text: 'Translate this sentence.', expectedTarget: 'ko' },
    { text: '이 문장을 번역하세요.', expectedTarget: 'en' }
  ])('automatically routes $text to $expectedTarget', async ({ text, expectedTarget }) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        data: { translations: [{ translatedText: 'translated', detectedSourceLanguage: 'auto' }] }
      }), { status: 200 })
    );
    const runtime: KrenRuntime = {
      getSecret: async (key) => key === KREN_SECRET_KEYS.googleCloudTranslation
        ? 'cloud-key'
        : undefined,
      getSetting: <T>(key: string, fallback: T): T => {
        if (key === 'translation.targetLanguage') return 'auto-en-ko' as T;
        return fallback;
      },
      reserveCloudCharacters: async () => undefined,
      beforeGeminiRequest: async () => undefined
    };

    await runKrenOperation(runtime, 'translate', { text }, new AbortController().signal);

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { target: string };
    expect(request.target).toBe(expectedTarget);
  });

  it('keeps an explicit translation target over automatic routing', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        data: { translations: [{ translatedText: '翻訳', detectedSourceLanguage: 'en' }] }
      }), { status: 200 })
    );
    const runtime: KrenRuntime = {
      getSecret: async (key) => key === KREN_SECRET_KEYS.googleCloudTranslation
        ? 'cloud-key'
        : undefined,
      getSetting: <T>(_key: string, fallback: T): T => fallback,
      reserveCloudCharacters: async () => undefined,
      beforeGeminiRequest: async () => undefined
    };

    await runKrenOperation(
      runtime,
      'translate',
      { text: 'Translate this.', targetLanguage: 'ja' },
      new AbortController().signal
    );

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { target: string };
    expect(request.target).toBe('ja');
  });

  it('uses the independent Gemini fallback for an unavailable alternate explanation model', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'This model is no longer available.' }
      }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          kind: 'translation',
          translatedText: 'A careful fallback explanation.',
          alternatives: [],
          note: ''
        }) }] } }]
      }), { status: 200 }));
    const runtime: KrenRuntime = {
      getSecret: async (key) => key === KREN_SECRET_KEYS.geminiPro ? 'alternate-key' : undefined,
      getSetting: <T>(key: string, fallback: T): T => {
        const settings: Record<string, unknown> = {
          'explanation.provider': 'gemini',
          'explanation.geminiProfile': 'pro',
          'gemini.alternateModel': 'gemini-3.1-pro-preview',
          'gemini.alternateFallbackEnabled': true,
          'gemini.alternateFallbackModel': 'gemini-3.5-flash',
          'gemini.alternateFallbackThinkingLevel': 'minimal',
          'gemini.retry.maxAttempts': 1
        };
        return (settings[key] ?? fallback) as T;
      },
      reserveCloudCharacters: async () => undefined,
      beforeGeminiRequest: async () => undefined
    };

    const result = await runKrenOperation(
      runtime,
      'explain',
      { text: 'operationally fragile', outputLanguage: 'en' },
      new AbortController().signal
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('gemini-3.1-pro-preview');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('gemini-3.5-flash');
    const fallbackRequestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      generationConfig: { thinkingConfig: { thinkingLevel: string } };
    };
    expect(fallbackRequestBody.generationConfig.thinkingConfig.thinkingLevel).toBe('minimal');
    expect(result).toMatchObject({
      providerId: 'gemini',
      modelId: 'gemini-3.5-flash',
      fallbackFromModel: 'gemini-3.1-pro-preview'
    });
  });

  it('routes explanation only to the explicitly selected OpenAI provider', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({
        kind: 'translation', translatedText: 'A careful explanation.', alternatives: [], note: ''
      }) }] }]
    }), { status: 200 }));
    const consentProviders: string[] = [];
    const runtime: KrenRuntime = {
      getSecret: async (key) => key === KREN_SECRET_KEYS.openai ? 'openai-key' : undefined,
      getSetting: <T>(key: string, fallback: T): T => {
        const settings: Record<string, unknown> = {
          'explanation.provider': 'openai',
          'openai.model': 'gpt-5.4',
          'languageModel.retry.maxAttempts': 1
        };
        return (settings[key] ?? fallback) as T;
      },
      reserveCloudCharacters: async () => undefined,
      beforeGeminiRequest: async () => undefined,
      beforeLanguageModelRequest: async (provider) => { consentProviders.push(provider); }
    };

    const result = await runKrenOperation(
      runtime,
      'explain',
      { text: 'deliberate', outputLanguage: 'en' },
      new AbortController().signal
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.openai.com/v1/responses');
    expect(consentProviders).toEqual(['openai']);
    expect(result).toMatchObject({ providerId: 'openai', sourceText: 'deliberate' });
  });

  it('never crosses providers after an OpenAI temporary failure', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ error: { message: 'busy' } }),
      { status: 503, headers: { 'retry-after': '0' } }
    ));
    const runtime: KrenRuntime = {
      getSecret: async (key) => key === KREN_SECRET_KEYS.openai ? 'openai-key' : undefined,
      getSetting: <T>(key: string, fallback: T): T => {
        const settings: Record<string, unknown> = {
          'rewrite.provider': 'openai',
          'languageModel.retry.maxAttempts': 1
        };
        return (settings[key] ?? fallback) as T;
      },
      reserveCloudCharacters: async () => undefined,
      beforeGeminiRequest: async () => undefined,
      beforeLanguageModelRequest: async () => undefined
    };

    await expect(runKrenOperation(
      runtime,
      'rewriteJargonFree',
      { text: 'Leverage synergies.' },
      new AbortController().signal
    )).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('api.openai.com');
  });
});
