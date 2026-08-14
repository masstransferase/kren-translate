import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PRO_MODELS,
  listGeminiProModels,
  normalizeProModel
} from '../src/providers/geminiModels.js';

afterEach(() => vi.restoreAllMocks());

describe('Gemini model discovery', () => {
  it('keeps only Pro text models that support generateContent', () => {
    expect(normalizeProModel({
      name: 'models/gemini-3.1-pro-preview',
      displayName: 'Gemini 3.1 Pro',
      supportedGenerationMethods: ['generateContent']
    })).toEqual({ id: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro' });
    expect(normalizeProModel({
      name: 'models/gemini-3.1-pro-preview-tts',
      supportedGenerationMethods: ['generateContent']
    })).toBeUndefined();
    expect(normalizeProModel({
      name: 'models/gemini-3.5-flash',
      supportedGenerationMethods: ['generateContent']
    })).toBeUndefined();
  });

  it('retrieves models without sending selected text or the key in the URL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ models: [{
        name: 'models/gemini-4-pro-preview',
        displayName: 'Gemini 4 Pro Preview',
        supportedGenerationMethods: ['generateContent']
      }] }), { status: 200 })
    );

    const models = await listGeminiProModels('secret-key', new AbortController().signal);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).not.toContain('secret-key');
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('secret-key');
    expect(models.map((model) => model.id)).toContain('gemini-4-pro-preview');
    // Derived from the list rather than pinned to two literal ids. The literal form
    // failed the moment a model was added, which is a test breaking on a change it was
    // never meant to guard. What it is actually asserting is that the built-in defaults
    // stay ahead of discovered models, in their declared order.
    expect(models.slice(0, DEFAULT_PRO_MODELS.length).map((model) => model.id))
      .toEqual(DEFAULT_PRO_MODELS.map((model) => model.id));
  });
});
