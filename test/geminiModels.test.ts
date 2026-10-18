import { normalizeGeminiModel, normalizeModelSetting } from '../src/providers/geminiModels.js';
import { routedModel } from '../src/providers/openAICompatible.js';
import { structuredJsonUrl } from '../src/providers/structuredJsonTransport.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PRO_MODELS,
  geminiModelCatalog,
  isKnownGeminiLiveOnlyModel,
  listGeminiLiveModels,
  listGeminiProModels,
  normalizeProModel
} from '../src/providers/geminiModels.js';

afterEach(() => vi.restoreAllMocks());

describe('Gemini model discovery', () => {
  const advertised = (
    id: string,
    methods: string[] = ['generateContent'],
    displayName = id
  ) => ({
    name: `models/${id}`,
    displayName,
    supportedGenerationMethods: methods
  });

  it('V133 keeps only the current series when the highest advertised series is 3.x', () => {
    const catalog = geminiModelCatalog([
      advertised('gemini-2.9-flash'),
      advertised('gemini-3.1-pro-preview'),
      advertised('gemini-3.8-flash')
    ]);

    expect(catalog.text.map((model) => model.id)).toContain('gemini-3.8-flash');
    expect(catalog.text.map((model) => model.id)).not.toContain('gemini-2.9-flash');
  });

  it('V133 moves the two-series window when 4.0 appears without a source change', () => {
    const catalog = geminiModelCatalog([
      advertised('gemini-2.9-flash'),
      advertised('gemini-3.8-flash'),
      advertised('gemini-4.0-flash')
    ]);

    expect(catalog.text.map((model) => model.id)).toEqual(expect.arrayContaining([
      'gemini-3.8-flash', 'gemini-4.0-flash'
    ]));
    expect(catalog.text.map((model) => model.id)).not.toContain('gemini-2.9-flash');
  });

  it('V133 fails open for an unparseable future identifier', () => {
    const catalog = geminiModelCatalog([
      advertised('gemini-next-flash'),
      advertised('gemini-4.0-flash')
    ]);

    expect(catalog.text.map((model) => model.id)).toContain('gemini-next-flash');
  });

  it('V133 preserves defaults, the stored value, and reader models below the floor', () => {
    const catalog = geminiModelCatalog([
      advertised('gemini-5.0-flash')
    ], {
      textStoredIds: ['gemini-2.7-stored'],
      textCustomIds: ['gemini-1.4-reader']
    });
    const ids = catalog.text.map((model) => model.id);

    expect(ids).toEqual(expect.arrayContaining([
      ...DEFAULT_PRO_MODELS.map((model) => model.id),
      'gemini-2.7-stored',
      'gemini-1.4-reader'
    ]));
  });

  it('V133 drops irrelevant families and modalities from both catalogs', () => {
    const rejected = [
      'gemma-3-27b', 'learnlm-2.0-pro', 'aqa', 'text-bison-001',
      'gemini-4.0-flash-image', 'gemini-4.0-video', 'gemini-4.0-omni',
      'gemini-embedding-001'
    ];
    const catalog = geminiModelCatalog([
      ...rejected.map((id) => advertised(id, ['generateContent', 'bidiGenerateContent'])),
      advertised('gemini-4.0-chat', ['generateContent']),
      advertised('gemini-4.0-conversation', ['bidiGenerateContent'])
    ]);

    for (const id of rejected) {
      expect(catalog.text.map((model) => model.id), id).not.toContain(id);
      expect(catalog.live.map((model) => model.id), id).not.toContain(id);
    }
  });

  it('V133 separates API-advertised bidi models from ordinary text models', () => {
    const catalog = geminiModelCatalog([
      advertised('gemini-3.8-flash', ['generateContent']),
      advertised('gemini-3.8-conversation', ['bidiGenerateContent']),
      advertised('gemini-3.8-both', ['generateContent', 'bidiGenerateContent'])
    ]);

    expect(catalog.live.map((model) => model.id)).toEqual([
      'gemini-3.8-both', 'gemini-3.8-conversation'
    ]);
    expect(catalog.text.map((model) => model.id)).not.toEqual(expect.arrayContaining([
      'gemini-3.8-both', 'gemini-3.8-conversation'
    ]));
    expect(catalog.text.map((model) => model.id)).toContain('gemini-3.8-flash');
    expect(catalog.live.find((model) => model.id === 'gemini-3.8-conversation')?.liveOnly)
      .toBe(true);
    expect(isKnownGeminiLiveOnlyModel('gemini-3.8-conversation', catalog.live)).toBe(true);

    const retainedUnknown = geminiModelCatalog([], {
      liveStoredIds: ['gemini-future-reader-model']
    }).live;
    expect(isKnownGeminiLiveOnlyModel('gemini-future-reader-model', retainedUnknown)).toBe(false);
  });

  it('V133 collapses a dated snapshot when its undated identifier is advertised', () => {
    const catalog = geminiModelCatalog([
      advertised('gemini-4.0-flash'),
      advertised('gemini-4.0-flash-2026-09-21')
    ]);

    expect(catalog.text.map((model) => model.id)).toContain('gemini-4.0-flash');
    expect(catalog.text.map((model) => model.id)).not.toContain(
      'gemini-4.0-flash-2026-09-21'
    );
  });

  /*
   * Until 1.7.9 this kept only ids carrying `pro`, because the one Refresh button belonged
   * to the alternate profile and that profile meant Pro. Both profiles have shared the
   * discovered list since 1.7.7, so the filter was quietly removing every Flash model from
   * a list the Default profile was reading. The owner reported it as Gemini 3.7 Flash not
   * being retrieved.
   */
  it('keeps every text model that supports generateContent, Flash included', () => {
    expect(normalizeProModel({
      name: 'models/gemini-3.1-pro-preview',
      displayName: 'Gemini 3.1 Pro',
      supportedGenerationMethods: ['generateContent']
    })).toEqual({ id: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro' });
    expect(normalizeProModel({
      name: 'models/gemini-3.7-flash',
      displayName: 'Gemini 3.7 Flash',
      supportedGenerationMethods: ['generateContent']
    }), 'a Flash model is discarded, which is the 1.7.8 defect')
      .toEqual({ id: 'gemini-3.7-flash', displayName: 'Gemini 3.7 Flash' });
    expect(normalizeProModel({
      name: 'models/gemini-3.5-flash',
      supportedGenerationMethods: ['generateContent']
    })).toEqual({ id: 'gemini-3.5-flash', displayName: 'gemini-3.5-flash' });
  });

  it('still drops a model that cannot answer a KREN prompt', () => {
    for (const id of [
      'gemini-3.1-pro-preview-tts', 'imagen-4-image',
      'gemini-embedding-001', 'gemini-2.5-computer-use-preview', 'veo-3-video'
    ]) {
      expect(normalizeProModel({
        name: `models/${id}`,
        supportedGenerationMethods: ['generateContent']
      }), id).toBeUndefined();
    }
    // Changed 2026-09-21: Live classification follows the advertised method, not the name.
    expect(normalizeProModel({
      name: 'models/gemini-2.5-conversation',
      supportedGenerationMethods: ['bidiGenerateContent']
    })).toBeUndefined();
  });

  it('drops a model that does not support generateContent at all', () => {
    expect(normalizeProModel({
      name: 'models/text-embedding-004',
      supportedGenerationMethods: ['embedContent']
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

  it('V133 retrieves the Live catalog from bidiGenerateContent metadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ models: [
        advertised('gemini-4.0-flash', ['generateContent']),
        advertised('gemini-4.0-conversation', ['bidiGenerateContent'])
      ] }), { status: 200 })
    );

    const models = await listGeminiLiveModels(
      'secret-key', new AbortController().signal, 'setGeminiKey'
    );
    expect(models.map((model) => model.id)).toContain('gemini-4.0-conversation');
    expect(models.map((model) => model.id)).not.toContain('gemini-4.0-flash');
  });
});

it('V220 removes retired Flash and resolves stored settings without rewriting them', () => {
  const stored = { model: 'gemini-3.5-flash' };
  expect(DEFAULT_PRO_MODELS.map(model => model.id)).not.toContain(stored.model);
  expect(normalizeModelSetting('tutor.model', stored.model)).toBe('gemini-3.6-flash');
  expect(routedModel('gemini', stored.model)).toBe('gemini-3.6-flash');
  expect(structuredJsonUrl('gemini', stored.model)).toContain('/gemini-3.6-flash:');
  expect(geminiModelCatalog([], { textStoredIds: [stored.model] }).text.map(model => model.id)).not.toContain(stored.model);
  expect(stored.model).toBe('gemini-3.5-flash');
  expect(normalizeGeminiModel('models/gemini-3.5-flash')).toBe('models/gemini-3.6-flash');
  for (const model of ['gemini-3.5-flash-lite', 'gemini-3.5-transcribe']) expect(normalizeGeminiModel(model)).toBe(model);
});
