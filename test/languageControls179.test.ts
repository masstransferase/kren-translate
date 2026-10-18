import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { validatedPanelSetting } from '../src/panelSettings.js';
import { isSameLanguage, languageName } from '../src/languages.js';
import { normalizeProModel } from '../src/providers/geminiModels.js';
import { KREN_SECRET_KEYS, runKrenOperation, type KrenRuntime } from '../src/operations.js';
import { DEFAULT_TRANSLATION_TARGET, LEGACY_AUTO_TRANSLATION_TARGET } from '../src/types.js';
import { EDGE_SPEECH_LOCALES } from '@kren/core/edge-speech';
import { REWRITE_OTHER_LANGUAGES } from '@kren/core/rewrite-axes';
import type { KrenResult } from '../src/types.js';

afterEach(() => vi.restoreAllMocks());

const ENGLISH = 'The committee deferred the motion without a recorded vote this morning.';

function runtimeFor(settings: Record<string, unknown>): KrenRuntime {
  return {
    getSecret: async (key) => (
      key === KREN_SECRET_KEYS.gemini ? 'gemini-key'
        : key === KREN_SECRET_KEYS.googleCloudTranslation ? 'cloud-key'
          : undefined
    ),
    getSetting: <T>(key: string, fallback: T): T => (
      key in settings ? settings[key] as T : fallback
    ),
    reserveCloudCharacters: async () => undefined,
    beforeGeminiRequest: async () => undefined
  } as KrenRuntime;
}

function geminiOk(): Response {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({
      kind: 'translation', translatedText: 'x', note: 'y'
    }) }] } }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function explainInstruction(settings: Record<string, unknown>, text: string): Promise<string> {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(geminiOk());
  await runKrenOperation(
    runtimeFor({ 'explanation.provider': 'gemini', ...settings }),
    'explain',
    { text },
    new AbortController().signal
  );
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  const body = JSON.parse(String(init?.body ?? '{}')) as {
    systemInstruction?: { parts?: Array<{ text?: string }> };
  };
  return body.systemInstruction?.parts?.[0]?.text ?? '';
}

function settingsHtml(overrides = {}): string {
  return renderKrenResultViewHtml({
    cspSource: 'vscode-webview://test',
    nonce: 'test-nonce',
    settings: { ...PANEL_SETTINGS_FIXTURE, ...overrides },
    activeScreen: 'settings',
    proModels: []
  });
}

/*
 * "I know Gemini released Gemini 3.7 Flash, but this model is not retrieved upon refresh
 * button action. Why is that?"
 *
 * Because the normalizer kept only ids carrying `pro`. It was written when the one Refresh
 * button belonged to the alternate profile and that profile meant Pro; both profiles have
 * shared the discovered list since 1.7.7, so it was quietly deleting every Flash model from
 * a list the Default profile reads.
 */
describe('model discovery keeps Flash models', () => {
  it('admits a Flash model that supports generateContent', () => {
    expect(normalizeProModel({
      name: 'models/gemini-3.7-flash',
      displayName: 'Gemini 3.7 Flash',
      supportedGenerationMethods: ['generateContent']
    })).toEqual({ id: 'gemini-3.7-flash', displayName: 'Gemini 3.7 Flash' });
  });

  it('no longer decides from whether the id says pro', () => {
    const source = readFileSync('src/providers/geminiModels.ts', 'utf8');
    expect(source, 'the Pro-only filter is back').not.toContain("(?:^|-)pro(?:-|$)");
  });

  it('still refuses a model that cannot answer a text prompt', () => {
    for (const id of ['gemini-3.7-flash-tts', 'imagen-4-image']) {
      expect(normalizeProModel({
        name: `models/${id}`,
        supportedGenerationMethods: ['generateContent']
      }), id).toBeUndefined();
    }
    // Changed 2026-09-21: the API capability, not `live` in a name, separates Live models.
    expect(normalizeProModel({
      name: 'models/gemini-conversation-next',
      supportedGenerationMethods: ['bidiGenerateContent']
    })).toBeUndefined();
  });
});

/*
 * "Add Farsi to all relevant language drop-down menus."
 *
 * Added to the two shared catalogs rather than to each control, so Read Aloud, Translation,
 * Explanation, and Rewrite Text all gain it from one edit. The voices are what
 * edge_tts.list_voices() publishes for fa-IR, read from the runtime.
 */
describe('Persian is offered wherever a language is chosen', () => {
  it('is in the Read Aloud catalog, with the voices Microsoft actually publishes', () => {
    const persian = EDGE_SPEECH_LOCALES.find((locale) => locale.id === 'fa-IR');
    expect(persian, 'fa-IR is not in the catalog').toBeDefined();
    expect(persian?.label).toBe('Persian (Farsi)');
    expect(persian?.voices.map((voice) => voice.id).sort())
      .toEqual(['fa-IR-DilaraNeural', 'fa-IR-FaridNeural']);
    expect(persian?.voices).toContainEqual({ id: persian?.defaultVoice, label: 'Dilara (Female)' });
  });

  it('is in the Rewrite Text output language list', () => {
    expect(REWRITE_OTHER_LANGUAGES.map((language: { id: string }) => language.id))
      .toContain('fa');
  });

  it('reaches every control drawn from the shared catalog', () => {
    const html = settingsHtml();
    for (const key of [
      'translation.sourceLanguage', 'translation.targetLanguage',
      'explanation.outputLanguage', 'readAloud.edgeLocale'
    ]) {
      const at = html.indexOf(`data-setting="${key}"`);
      expect(at, `${key} is not rendered`).toBeGreaterThan(-1);
      const control = html.slice(at, html.indexOf('</select>', at));
      expect(control, `${key} does not offer Persian`).toContain('value="fa-IR"');
    }
    const rewrite = html.indexOf('data-setting="rewrite.otherOutputLanguage"');
    expect(html.slice(rewrite, html.indexOf('</select>', rewrite))).toContain('value="fa"');
  });

  it('names a language rather than printing a code, for a bare code and a locale id', () => {
    expect(languageName('fa')).toBe('Persian');
    expect(languageName('fa-IR')).toBe('Persian (Farsi)');
  });
});

/*
 * "Explaining Meaning or Nuance currently still translates in Korean and Korean mixed when
 * selecting English (United States) ... and select Same as source. Other languages don't
 * have this issue."
 *
 * Two faults met here. The equivalent target read `analysis.targetLanguage`, which is the
 * English-to-Korean translation direction and sends everything that is not Korean to Korean,
 * so English produced a Korean equivalent beside an English note. And languageName knew only
 * bare codes, so a locale id chosen from the new list reached the prompt as a literal:
 * "give a natural en-US equivalent".
 */
describe('Explain follows the explanation language, not the Korean direction', () => {
  it('names the language rather than the code, for every locale the list offers', () => {
    for (const locale of EDGE_SPEECH_LOCALES) {
      expect(languageName(locale.id), locale.id).toBe(locale.label);
      expect(languageName(locale.id), `${locale.id} printed as a code`).not.toBe(locale.id);
    }
  });

  it('falls back to the bare language when a region is unknown', () => {
    expect(languageName('de-AT')).toBe('German');
    expect(languageName('zz-ZZ')).toBe('zz-ZZ');
  });

  it('asks for a restatement, not a Korean equivalent, for English under Same as source',
    async () => {
      const instruction = await explainInstruction(
        { 'explanation.outputLanguage': 'sameAsSource' },
        ENGLISH
      );
      expect(instruction, 'English still routes to a Korean equivalent')
        .not.toContain('Korean');
      expect(instruction).toContain('restate it plainly in English (United States)');
    });

  it('does the same for a named English, which printed the raw code before', async () => {
    const instruction = await explainInstruction(
      { 'explanation.outputLanguage': 'en-US' },
      ENGLISH
    );
    expect(instruction).not.toContain('en-US');
    expect(instruction).toContain('Write the note in English (United States) only.');
    expect(instruction).toContain('restate it plainly in English (United States)');
  });

  it('still gives a real equivalent when the note language differs from the text', async () => {
    const instruction = await explainInstruction(
      { 'explanation.outputLanguage': 'ko' },
      ENGLISH
    );
    expect(instruction).toContain('give a natural Korean equivalent');
    expect(instruction).toContain('Write the note in Korean only.');
  });

  it('behaves the same for Korean text, which is the case that already looked right',
    async () => {
      const instruction = await explainInstruction(
        { 'explanation.outputLanguage': 'sameAsSource' },
        '이 문장은 한국어로 작성되었으며 의미를 설명해 주세요.'
      );
      expect(instruction).toContain('restate it plainly in Korean');
    });

  it('names the detected source, rather than calling it automatically detected', async () => {
    expect(await explainInstruction({ 'explanation.outputLanguage': 'ko' }, ENGLISH))
      .toContain('Explain the selected English (United States) text');
  });
});

/*
 * "Translation output language: Remove Auto (English to Korean, Korean to English). Set
 * Korean as the default. When input and output the same language, generate a warning message
 * in the result panel."
 */
describe('the translation output language is a plain language', () => {
  const html = settingsHtml();

  function control(key: string): string {
    const at = html.indexOf(`data-setting="${key}"`);
    expect(at, `${key} is not rendered`).toBeGreaterThan(-1);
    return html.slice(at, html.indexOf('</select>', at));
  }

  it('no longer offers the Auto mode on the output', () => {
    const output = control('translation.targetLanguage');
    expect(output).not.toContain(`value="${LEGACY_AUTO_TRANSLATION_TARGET}"`);
    expect(output).not.toContain('Korean to English');
  });

  it('keeps Auto-detect on the input, which is a different question', () => {
    expect(control('translation.sourceLanguage')).toContain('value="auto"');
  });

  it('defaults to Korean in the manifest', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      contributes: { configuration: { properties: Record<string, { default?: unknown }> } };
    };
    expect(manifest.contributes.configuration.properties['kren.translation.targetLanguage']?.default)
      .toBe(DEFAULT_TRANSLATION_TARGET);
    /*
     * The locale id, not the bare code. The Output control is built from the Read Aloud
     * catalog, which carries ko-KR, so a default of `ko` is not one of its options and the
     * control rendered it as "ko (stored)" rather than Korean.
     */
    expect(DEFAULT_TRANSLATION_TARGET).toBe('ko-KR');
  });

  /*
   * The default has to be one of the options the control offers, or the reader opens
   * Settings and finds their own default listed as an unknown stored value.
   */
  it('offers its own default as a choice in the control', () => {
    const output = control('translation.targetLanguage');
    expect(output).toContain(`value="${DEFAULT_TRANSLATION_TARGET}"`);
    const rendered = settingsHtml({ translationTargetLanguage: DEFAULT_TRANSLATION_TARGET });
    const at = rendered.indexOf('data-setting="translation.targetLanguage"');
    expect(rendered.slice(at, rendered.indexOf('</select>', at)))
      .not.toContain('(stored)');
  });

  it('refuses the removed mode as a stored value', () => {
    expect(validatedPanelSetting('translation.targetLanguage', LEGACY_AUTO_TRANSLATION_TARGET))
      .toBeUndefined();
    expect(validatedPanelSetting('translation.targetLanguage', 'ja-JP')).toBe('ja-JP');
  });

  /*
   * The migration that runs the other way from the one it replaces. Leaving the old one in
   * place would be worse than doing nothing: it is keyed on a global-state marker, so on a
   * fresh install it would fire and write a value the control no longer offers.
   */
  it('migrates a stored auto-en-ko to Korean, and the old migration is gone', () => {
    const source = readFileSync('src/extension.ts', 'utf8');
    // Comments stripped first. The replaced function is named in the comment that explains
    // why it is gone, and an assertion that matched that would pass whether or not the
    // function itself was still there.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/u, ''))
      .join('\n');
    expect(code, 'the migration that wrote auto-en-ko is still present')
      .not.toContain('migrateTranslationTargetToAutomatic');
    const at = source.indexOf('async function migrateAutoTranslationTargetToKorean');
    expect(at, 'no migration off the removed mode').toBeGreaterThan(-1);
    const body = source.slice(at, source.indexOf('\n}\n', at));
    expect(body).toContain("stored === 'auto-en-ko'");
    expect(body).toContain('DEFAULT_TRANSLATION_TARGET');
    expect(source).toContain('await migrateAutoTranslationTargetToKorean(context);');
  });

  it('reads a stored auto-en-ko as Korean rather than raising an error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        data: { translations: [{ translatedText: 'x', detectedSourceLanguage: 'en' }] }
      }), { status: 200 })
    );
    await runKrenOperation(
      runtimeFor({
        translationProvider: 'googleCloudTranslation',
        'translation.targetLanguage': LEGACY_AUTO_TRANSLATION_TARGET
      }),
      'translate',
      { text: ENGLISH },
      new AbortController().signal
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(init?.body ?? '{}')).target).toBe('ko-KR');
  });
});

/*
 * The warning the removal makes necessary. Auto had been hiding this case by swapping the
 * target, so with Auto gone the reader can ask for Korean to Korean and has to be told.
 */
describe('the result warns when input and output are the same language', () => {
  function translationHtml(
    sourceLanguage: string,
    targetLanguage: string,
    operation: 'translate' | 'explain' = 'translate'
  ): string {
    const result = {
      kind: 'translation',
      operation,
      providerId: 'googleCloudTranslation',
      sourceText: 'text',
      sourceLanguage,
      targetLanguage,
      translatedText: 'result',
      createdAt: new Date().toISOString()
    } as unknown as KrenResult;
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: PANEL_SETTINGS_FIXTURE,
      activeScreen: 'result',
      result,
      sourceText: 'text',
      allowReplace: false,
      proModels: []
    });
    /*
     * The rendered result only. `same-language-warning` is also a CSS rule in the
     * stylesheet every render carries, so searching the whole document matches on every
     * call and the silent cases pass no matter what the renderer does.
     */
    return html.slice(html.indexOf('<div class="direction">'));
  }

  it('warns when the two agree exactly', () => {
    const html = translationHtml('ko', 'ko');
    expect(html).toContain('same-language-warning');
    expect(html).toContain('Input and output languages are identical.');
  });

  it('warns when they agree but are written differently, en and en-US', () => {
    expect(translationHtml('en', 'en-US')).toContain('same-language-warning');
    expect(translationHtml('en-US', 'en')).toContain('same-language-warning');
  });

  it('stays silent on a real translation', () => {
    expect(translationHtml('en', 'ko')).not.toContain('same-language-warning');
    expect(translationHtml('de-DE', 'ko')).not.toContain('same-language-warning');
  });

  it('stays silent when the source was never declared, which is not agreement', () => {
    expect(translationHtml('auto', 'ko')).not.toContain('same-language-warning');
    expect(translationHtml('auto', 'auto')).not.toContain('same-language-warning');
  });

  /*
   * Never on an explanation. Explanation language defaults to Same as source, so the two
   * agreeing is the normal case there. The warning fired on every default explanation in
   * 1.7.9 because the result carried no operation and the renderer could not tell them
   * apart.
   */
  it('stays silent on an explanation, where the same language is the default', () => {
    expect(translationHtml('ko', 'ko', 'explain')).not.toContain('same-language-warning');
    expect(translationHtml('en-US', 'en-US', 'explain')).not.toContain('same-language-warning');
  });

  it('says only what the owner asked it to say', () => {
    const html = translationHtml('ko', 'ko');
    expect(html).toContain('Input and output languages are identical.');
    // The 1.7.9 wording, which the owner asked to cut down on 2026-08-28.
    expect(html).not.toContain('KREN did not translate this');
    expect(html).not.toContain('Choose a different Output language');
  });

  it('compares by language and not by string, so a region never hides the case', () => {
    expect(isSameLanguage('pt-BR', 'pt-PT')).toBe(true);
    expect(isSameLanguage('en-US', 'en-GB')).toBe(true);
    expect(isSameLanguage('zh-CN', 'ja-JP')).toBe(false);
    expect(isSameLanguage('auto', 'en')).toBe(false);
  });
});

/*
 * The result card, 2026-08-28. "Reduce the main result text/sentence font size same as the
 * input text/sentence font size" and "change the button order to be Copy result, Replace
 * selection, and Open full details. Then, change Copy result and Replace selection buttons
 * into icon buttons we are using for rewrite text results."
 */
describe('the Translation and Explain result card', () => {
  function resultHtml(allowReplace: boolean): string {
    const result = {
      kind: 'translation',
      operation: 'translate' as const,
      providerId: 'googleCloudTranslation',
      sourceText: 'text',
      sourceLanguage: 'en',
      targetLanguage: 'ko-KR',
      translatedText: 'result',
      createdAt: new Date().toISOString()
    } as unknown as KrenResult;
    return renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: PANEL_SETTINGS_FIXTURE,
      activeScreen: 'result',
      result,
      sourceText: 'text',
      allowReplace,
      proModels: []
    });
  }

  /*
   * Read from the stylesheet rather than pinned to a number, so the two move together. The
   * result was 1.15rem against the input's .95rem, which the owner reported as
   * "unnecessarily larger than other font sizes".
   */
  it('sets the result at the size the input is set at', () => {
    const html = resultHtml(true);
    const size = (selector: string): string | undefined => {
      const at = html.indexOf(`.${selector} {`);
      if (at === -1) return undefined;
      const rule = /font-size: ([^;]+);/u.exec(html.slice(at, html.indexOf('}', at)));
      return rule?.[1]?.trim();
    };
    expect(size('source'), 'the input rule is gone').toBeDefined();
    expect(size('translation'), 'the result rule is gone').toBeDefined();
    expect(size('translation')).toBe(size('source'));
  });

  it('orders the controls Copy, Replace, then Open full details', () => {
    const html = resultHtml(true);
    const actions = html.slice(html.indexOf('<div class="actions">'));
    const copy = actions.indexOf('data-command="copy"');
    const replace = actions.indexOf('data-command="replace"');
    const details = actions.indexOf('data-command="details"');
    expect(copy, 'no Copy control').toBeGreaterThan(-1);
    expect(replace).toBeGreaterThan(copy);
    expect(details).toBeGreaterThan(replace);
  });

  it('draws Copy and Replace as the icons a rewrite variant uses', () => {
    const actions = resultHtml(true).slice(resultHtml(true).indexOf('<div class="actions">'));
    for (const command of ['copy', 'replace']) {
      const at = actions.indexOf(`data-command="${command}"`);
      const button = actions.slice(actions.lastIndexOf('<button', at), actions.indexOf('</button>', at));
      expect(button, `${command} is not an icon button`).toContain('icon-button');
      expect(button, `${command} has no icon`).toContain('<svg');
      expect(button, `${command} still carries a text label`).not.toContain('Copy result');
      expect(button).not.toContain('Replace selection<');
    }
    // Still reachable without sight, which a bare glyph is not.
    expect(actions).toContain('aria-label="Copy the result"');
    expect(actions).toContain('aria-label="Replace the selection with the result"');
  });

  it('keeps Copy confirming, which is what the text button did', () => {
    expect(resultHtml(true)).toContain('data-copy-confirm');
  });

  it('drops Replace when there is no editor selection to replace', () => {
    const actions = resultHtml(false).slice(resultHtml(false).indexOf('<div class="actions">'));
    expect(actions).not.toContain('data-command="replace"');
    expect(actions).toContain('data-command="copy"');
    expect(actions).toContain('data-command="details"');
  });
});

/*
 * The operation has to survive the provider, not just the type.
 *
 * Both mutation probes that deleted `operation: request.operation` from a provider passed
 * the whole suite on 2026-08-28, because every test above builds its result by hand. A
 * result with no operation never warns, so the feature would have been silently dead while
 * the panel tests stayed green. These run the real path and read what comes back.
 */
describe('a result carries the operation that produced it', () => {
  function providerRuntime(settings: Record<string, unknown>): KrenRuntime {
    return {
      getSecret: async (key) => (
        key === KREN_SECRET_KEYS.gemini ? 'gemini-key'
          : key === KREN_SECRET_KEYS.googleCloudTranslation ? 'cloud-key'
            : undefined
      ),
      getSetting: <T>(key: string, fallback: T): T => (
        key in settings ? settings[key] as T : fallback
      ),
      reserveCloudCharacters: async () => undefined,
      beforeGeminiRequest: async () => undefined
    } as KrenRuntime;
  }

  it('records translate on a Cloud Translation result', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: { translations: [{ translatedText: '결과', detectedSourceLanguage: 'en' }] }
    }), { status: 200 }));
    const result = await runKrenOperation(
      providerRuntime({
        translationProvider: 'googleCloudTranslation',
        'translation.targetLanguage': 'ko-KR'
      }),
      'translate',
      { text: ENGLISH },
      new AbortController().signal
    );
    expect(result.kind).toBe('translation');
    expect((result as { operation?: string }).operation).toBe('translate');
  });

  it('records translate on a Gemini translation result', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        kind: 'translation', translatedText: '결과'
      }) }] } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const result = await runKrenOperation(
      providerRuntime({
        translationProvider: 'gemini',
        'translation.provider': 'gemini',
        'translation.targetLanguage': 'ko-KR'
      }),
      'translate',
      { text: ENGLISH },
      new AbortController().signal
    );
    expect((result as { operation?: string }).operation).toBe('translate');
  });

  it('records explain on an explanation result, which must never warn', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(geminiOk());
    const result = await runKrenOperation(
      providerRuntime({
        'explanation.provider': 'gemini',
        'explanation.outputLanguage': 'sameAsSource'
      }),
      'explain',
      { text: ENGLISH },
      new AbortController().signal
    );
    expect((result as { operation?: string }).operation).toBe('explain');
  });

  /*
   * End to end: a real translation into the language it was already in has to reach the
   * panel and produce the warning. This is the assertion the two survivors needed, because
   * it is the only one that fails when the provider drops the field.
   */
  it('warns on a real translation whose target is the language it was given', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: { translations: [{ translatedText: 'restated', detectedSourceLanguage: 'en' }] }
    }), { status: 200 }));
    const result = await runKrenOperation(
      providerRuntime({
        translationProvider: 'googleCloudTranslation',
        'translation.sourceLanguage': 'en-US',
        'translation.targetLanguage': 'en-GB'
      }),
      'translate',
      { text: ENGLISH },
      new AbortController().signal
    );
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: PANEL_SETTINGS_FIXTURE,
      activeScreen: 'result',
      result,
      sourceText: ENGLISH,
      allowReplace: false,
      proModels: []
    });
    const body = html.slice(html.indexOf('<div class="direction">'));
    expect(body, 'the warning did not survive the round trip through a provider')
      .toContain('Input and output languages are identical.');
  });

  it('stays silent on a real explanation in the language of the text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(geminiOk());
    const result = await runKrenOperation(
      providerRuntime({
        'explanation.provider': 'gemini',
        'explanation.outputLanguage': 'sameAsSource'
      }),
      'explain',
      { text: ENGLISH },
      new AbortController().signal
    );
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: PANEL_SETTINGS_FIXTURE,
      activeScreen: 'result',
      result,
      sourceText: ENGLISH,
      allowReplace: false,
      proModels: []
    });
    expect(html.slice(html.indexOf('<div class="direction">')))
      .not.toContain('same-language-warning');
  });
});
