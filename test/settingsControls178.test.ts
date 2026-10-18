import { load } from 'cheerio';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  renderKrenResultViewHtml,
  type KrenPanelSettings
} from '../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { validatedPanelSetting } from '../src/panelSettings.js';
import { PANEL_COMMANDS } from '../src/panelCommands.js';
import {
  KREN_RESET_GLOBAL_STATE_KEYS,
  krenConfigurationKeys,
  krenResetPlan
} from '../src/resetKren.js';
import { EXPLANATION_SAME_AS_SOURCE, TRANSLATION_AUTO_SOURCE } from '../src/types.js';
import { KREN_SECRET_KEYS, runKrenOperation, type KrenRuntime } from '../src/operations.js';
import { EDGE_SPEECH_LOCALES } from '@kren/core/edge-speech';
import { AUTO_ENGLISH_KOREAN_TARGET } from '../src/languages.js';

afterEach(() => vi.restoreAllMocks());

function settingsHtml(overrides: Partial<KrenPanelSettings> = {}): string {
  return renderKrenResultViewHtml({
    cspSource: 'vscode-webview://test',
    nonce: 'test-nonce',
    settings: { ...PANEL_SETTINGS_FIXTURE, ...overrides },
    activeScreen: 'settings',
    proModels: [
      { id: 'gemini-3.6-flash', displayName: 'Gemini 3.6 Flash' },
      { id: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro Preview' },
      { id: 'gemini-4.0-experimental', displayName: 'Gemini 4.0 Experimental' }
    ]
  });
}

/*
 * The owner's report, 2026-08-28, with a screenshot: "Model selection has a dropdown menu,
 * but it doesn't provide the list of that 9 models at all."
 *
 * The control was a text input backed by a `<datalist>`. A datalist filters its options
 * against whatever is already in the field, so with a complete model id typed there, exactly
 * one option survives the filter. Nine discovered models were in the markup and unreachable.
 */
/*
 * Read with line endings normalised, because these tests slice the source on literal
 * newlines. Git checks this repository out with CRLF on Windows, so `'
}
'` matches
 * nothing in a fresh clone, the slice overruns its function, and assertions about that
 * function's body count things from the rest of the file. It passed here only because these
 * particular files happened to be LF on this machine, and it failed the moment one was
 * copied in from a worktree that had been checked out normally.
 *
 * A test that depends on how a file was checked out is testing the checkout.
 */
function extensionSource(): string {
  return readFileSync('src/extension.ts', 'utf8').split('\r\n').join('\n');
}

describe('the Model control lists every discovered model', () => {
  const html = settingsHtml();

  it('offers the models in a select, which cannot filter itself away', () => {
    const at = html.indexOf('data-model-preset="rewrite.model"');
    expect(at, 'the Model select is gone').toBeGreaterThan(-1);
    const control = html.slice(at, html.indexOf('</select>', at));
    for (const id of ['gemini-3.6-flash', 'gemini-3.1-pro-preview', 'gemini-4.0-experimental']) {
      expect(control, `${id} is not offered`).toContain(`value="${id}"`);
    }
  });

  /*
   * The mechanism, asserted directly. A datalist anywhere in the Model control brings the
   * filtering back, and the reader would once again see one suggestion out of nine.
   */
  it('uses no datalist for a model, because a datalist filters against the typed value', () => {
    const at = html.indexOf('data-model-preset="rewrite.model"');
    expect(html.slice(at - 500, at + 1500)).not.toContain('<datalist');
    expect(html).not.toContain('list="models-');
  });

  it('keeps an editable field, so a model the list has not got is still reachable', () => {
    expect(html).toContain('data-setting="rewrite.model"');
    expect(html).toContain('Model identifier');
  });

  it('V114 puts reader models first, removes discovered duplicates, and offers Add and Remove', () => {
    const value = settingsHtml({
      customGeminiModels: ['gemini-reader-choice', 'gemini-3.6-flash']
    });
    const at = value.indexOf('data-model-preset="rewrite.model"');
    const control = value.slice(at, value.indexOf('</select>', at));
    const ids = [...control.matchAll(/<option value="([^"]+)"/gu)].map((match) => match[1]);
    expect(ids.slice(0, 2)).toEqual(['gemini-reader-choice', 'gemini-3.6-flash']);
    expect(ids.filter((id) => id === 'gemini-3.6-flash')).toHaveLength(1);
    const field = value.indexOf('data-setting="rewrite.model"', at);
    expect(value.slice(field, field + 1200)).toContain('data-command="addCustomModel"');
    expect(value).toContain(
      'data-command="removeCustomModel" data-model-provider="gemini" data-model-id="gemini-reader-choice"'
    );
  });

  it('selects the stored model in the list when the list carries it', () => {
    const on = settingsHtml({ rewriteModel: 'gemini-3.1-pro-preview' });
    const at = on.indexOf('data-model-preset="rewrite.model"');
    const control = on.slice(at, on.indexOf('</select>', at));
    expect(control).toContain('value="gemini-3.1-pro-preview" selected');
    expect(control).toContain('<option value="__custom__">Custom model identifier</option>');
  });

  it('falls to Custom when the stored model is not one of the discovered ones', () => {
    const off = settingsHtml({ rewriteModel: 'some-future-model' });
    const at = off.indexOf('data-model-preset="rewrite.model"');
    const control = off.slice(at, off.indexOf('</select>', at));
    expect(control).toContain('<option value="__custom__" selected>');
    const field = off.indexOf('data-setting="rewrite.model"');
    expect(off.slice(field, field + 80)).toContain('value="some-future-model"');
  });

  it('writes the chosen model to its own setting, and writes nothing for Custom', () => {
    const script = html.slice(html.indexOf("hasAttribute('data-model-preset')"));
    const branch = script.slice(0, script.indexOf('return;\n      }') + 15);
    expect(branch).toContain("target.value === '__custom__'");
    expect(branch).toContain("command: 'updateSetting', key: modelKey");
  });
});

/*
 * "For Explain Meaning or Nuance, I do not need that Bilingual (English and Korean). Remove
 * it. Make sure input supports multilingual and the output follows the explanation language
 * setting."
 */
describe('Explanation language no longer offers Bilingual', () => {
  function explanationControl(value: string): string {
    const html = settingsHtml({ explanationOutputLanguage: value });
    const at = html.indexOf('data-setting="explanation.outputLanguage"');
    expect(at, 'the Explanation language control is gone').toBeGreaterThan(-1);
    return html.slice(at, html.indexOf('</select>', at));
  }

  it('drops the option from the list', () => {
    const control = explanationControl(EXPLANATION_SAME_AS_SOURCE);
    expect(control).not.toContain('value="bilingual"');
    expect(control).not.toContain('Bilingual');
  });

  it('refuses the value, so nothing can write it back', () => {
    expect(validatedPanelSetting('explanation.outputLanguage', 'bilingual')).toBeUndefined();
  });

  it('defaults to Same as source in the manifest, not to the removed value', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      contributes: { configuration: { properties: Record<string, { default?: unknown }> } };
    };
    expect(manifest.contributes.configuration.properties['kren.explanation.outputLanguage']?.default)
      .toBe(EXPLANATION_SAME_AS_SOURCE);
  });

  /*
   * The migration. Without it a reader who had chosen Bilingual keeps a stored value the
   * list no longer carries, so the control renders it as "(stored)" and the prompt receives
   * an instruction it no longer understands.
   */
  it('migrates a stored bilingual to Same as source, once, in every scope', () => {
    const source = extensionSource();
    const at = source.indexOf('async function migrateBilingualExplanation');
    expect(at, 'no migration exists for the removed value').toBeGreaterThan(-1);
    const body = source.slice(at, source.indexOf('\n}\n', at));
    expect(body).toContain("stored === 'bilingual'");
    expect(body).toContain('EXPLANATION_SAME_AS_SOURCE');
    expect(body).toContain('globalValue');
    expect(body).toContain('workspaceValue');
    expect(body).toContain('workspaceFolderValue');
    expect(source).toContain('await migrateBilingualExplanation(context);');
  });

  it('tells the model one language, never two', () => {
    const gemini = readFileSync('src/providers/gemini.ts', 'utf8');
    const at = gemini.indexOf('const explanationLanguage =');
    const branch = gemini.slice(at, gemini.indexOf(';', at));
    expect(branch).not.toContain('both English and Korean');
    expect(branch).toContain('EXPLANATION_SAME_AS_SOURCE');
  });
});

/*
 * "Translation language: change it to be input and output language two dropdown menus, the
 * list there same as read aloud language/region dropdown ... Make sure we have the
 * auto-detection gate for google translation as well as LLM translation path."
 */
describe('Translation has an input language and an output language', () => {
  const html = settingsHtml();

  function control(key: string): string {
    const at = html.indexOf(`data-setting="${key}"`);
    expect(at, `${key} is not rendered`).toBeGreaterThan(-1);
    return html.slice(at, html.indexOf('</select>', at));
  }

  it('renders both as selects rather than a typed code', () => {
    for (const key of ['translation.sourceLanguage', 'translation.targetLanguage']) {
      const at = html.indexOf(`data-setting="${key}"`);
      expect(html.slice(at - 150, at), key).toContain('<select');
    }
  });

  it('offers the same languages the Read Aloud control offers, on both', () => {
    for (const key of ['translation.sourceLanguage', 'translation.targetLanguage']) {
      const options = control(key);
      for (const locale of EDGE_SPEECH_LOCALES) {
        expect(options, `${key} is missing ${locale.id}`).toContain(`value="${locale.id}"`);
      }
    }
  });

  it('heads the input with Auto-detect and the output with the English-Korean mode', () => {
    const source = control('translation.sourceLanguage');
    expect(source.indexOf(`value="${TRANSLATION_AUTO_SOURCE}"`)).toBeLessThan(
      source.indexOf(`value="${EDGE_SPEECH_LOCALES[0]!.id}"`)
    );
    const target = control('translation.targetLanguage');
    expect(target.indexOf(`value="${AUTO_ENGLISH_KOREAN_TARGET}"`)).toBeLessThan(
      target.indexOf(`value="${EDGE_SPEECH_LOCALES[0]!.id}"`)
    );
  });

  it('accepts a chosen language and refuses a value that is not one', () => {
    expect(validatedPanelSetting('translation.sourceLanguage', 'de-DE')).toBe('de-DE');
    expect(validatedPanelSetting('translation.sourceLanguage', TRANSLATION_AUTO_SOURCE))
      .toBe(TRANSLATION_AUTO_SOURCE);
    expect(validatedPanelSetting('translation.sourceLanguage', 'not a language'))
      .toBeUndefined();
  });
});

/*
 * The gate itself, driven through a real translation so both provider paths are covered by
 * the same assertion. Every request went out marked `auto` until 1.7.8 whatever the reader
 * had chosen, because there was no Input language to choose.
 */
describe('the translation source is decided once, for both provider paths', () => {
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

  async function cloudSource(text: string, configured: string): Promise<unknown> {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        data: { translations: [{ translatedText: 'x', detectedSourceLanguage: 'en' }] }
      }), { status: 200 })
    );
    await runKrenOperation(
      runtimeFor({
        translationProvider: 'googleCloudTranslation',
        'translation.sourceLanguage': configured,
        'translation.targetLanguage': 'ko'
      }),
      'translate',
      { text },
      new AbortController().signal
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    return JSON.parse(String(init?.body ?? '{}')).source;
  }

  it('sends a named input language to Cloud Translation as the source', async () => {
    expect(await cloudSource('Guten Tag, ich komme aus Korea.', 'de-DE')).toBe('de-DE');
  });

  /*
   * Under Auto-detect the same evidence Read Aloud uses decides. German cannot be written
   * at length without its function words, and this is the passage that produced the Read
   * Aloud defect on 2026-08-24.
   */
  it('detects the source under Auto-detect rather than declaring nothing', async () => {
    const detected = await cloudSource(
      'Wie geht es dir? Ich habe das nicht gesehen und der Mann ist nicht hier.',
      TRANSLATION_AUTO_SOURCE
    );
    expect(detected).toBe('de-DE');
  });

  it('declares nothing when the evidence is thin, leaving the provider to decide', async () => {
    expect(await cloudSource('ok', TRANSLATION_AUTO_SOURCE)).toBeUndefined();
  });

  /*
   * The same decision reaches the language-model path. It is made in applyLanguages, above
   * the provider split, so one gate serves both rather than one gate per provider.
   */
  it('reaches the language-model path from the same place', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          kind: 'translation', translatedText: '번역', detectedLanguage: 'de'
        }) }] } }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    await runKrenOperation(
      runtimeFor({
        translationProvider: 'gemini',
        'translation.provider': 'gemini',
        'translation.sourceLanguage': 'de-DE',
        'translation.targetLanguage': 'ko'
      }),
      'translate',
      { text: 'Guten Tag, ich komme aus Korea.' },
      new AbortController().signal
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    /*
     * The prompt names the language, not the code. It carried the literal `de-DE` until
     * 1.7.9, because languageName knew only bare codes and returned its argument unchanged
     * for a locale id; the same gap put "give a natural en-US equivalent" into an
     * explanation instruction.
     */
    const instruction = String(init?.body ?? '');
    expect(instruction).toContain('German');
    expect(instruction, 'the raw locale id reached the prompt').not.toContain('de-DE');
  });
});

/*
 * "have a button (between the two buttons in the bottom) for Default Setting ... Change All
 * KREN settings to Reset KREN, and this will go back to default and remove all credentials,
 * too - when this button pressed, one more confirmation required before executing the reset."
 */
describe('the two reset actions under Usage', () => {
  const html = settingsHtml();

  it('keeps Default Setting before Reset KREN in Usage and Delete all API keys in Credentials', () => {
    // 2026-10-10: V217 separates key deletion from the two Settings reset actions.
    const $ = load(html);
    const usage = $('#settings-screen [data-settings-section="usage"]');
    const buttons = usage.find('[data-action]').map((_, node) => $(node).attr('data-action')).get();
    expect($('#credentials-screen [data-action="kren.deleteAllApiKeys"]')).toHaveLength(1);
    expect(buttons.indexOf('kren.restoreDefaultSettings')).toBeGreaterThan(-1);
    expect(buttons.indexOf('kren.resetKren')).toBeGreaterThan(buttons.indexOf('kren.restoreDefaultSettings'));
  });

  it('no longer offers the button it replaced', () => {
    expect(html).not.toContain('All KREN settings');
  });

  /*
   * A button whose command is not in the allow list renders normally and does nothing when
   * clicked, which shipped once before on the Medical Dictionary controls.
   */
  it('runs commands the panel is allowed to invoke', () => {
    expect(PANEL_COMMANDS.has('kren.restoreDefaultSettings')).toBe(true);
    expect(PANEL_COMMANDS.has('kren.resetKren')).toBe(true);
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      contributes: { commands: Array<{ command: string; title: string }> };
    };
    const declared = manifest.contributes.commands.map((entry) => entry.command);
    expect(declared).toContain('kren.restoreDefaultSettings');
    expect(declared).toContain('kren.resetKren');
  });

  it('leaves credentials alone on the settings-only reset', () => {
    const plan = krenResetPlan('settings');
    expect(plan.configuration).toBe(true);
    expect(plan.credentials).toBe(false);
    expect(plan.globalStateKeys).toEqual([]);
  });

  /*
   * Both actions confirm twice, on the owner's instruction of 2026-08-28. The second
   * confirmation on each names a number rather than repeating the first question: how many
   * settings are about to move, and how many keys are about to go.
   */
  it('confirms twice on both actions, and counts something on the second', () => {
    expect(krenResetPlan('settings').confirmations).toBe(2);
    expect(krenResetPlan('everything').confirmations).toBe(2);
    const source = extensionSource();
    const at = source.indexOf('async function restoreDefaultSettings(');
    const body = source.slice(at, source.indexOf('\n}\n', at));
    // 2026-10-12: Both confirmation steps use the shared panel-or-VS Code warning entry point.
    expect(body.match(/show(?:Kren)?WarningMessage\(/gu)?.length ?? 0).toBe(2);
    expect(body).toContain('changedSettingCount');
    // Both answers are checked before anything is written.
    const firstWrite = body.indexOf('restoreDefaultConfiguration(context)');
    expect(firstWrite).toBeGreaterThan(body.indexOf("first !== 'Continue'"));
    expect(firstWrite).toBeGreaterThan(body.indexOf("second !== 'Restore Defaults'"));
  });

  it('asks before the full reset, and clears the state a key leaves behind', () => {
    const plan = krenResetPlan('everything');
    expect(plan.configuration).toBe(true);
    expect(plan.credentials).toBe(true);
    // Consent survives a key deletion otherwise, so the next key stored would skip the
    // confirmation the first one required.
    for (const key of ['kren.gemini.termsConsent.v4', 'kren.edgeTts.onlineConsent.v1']) {
      expect(plan.globalStateKeys, key).toContain(key);
    }
    expect(plan.globalStateKeys).toEqual(KREN_RESET_GLOBAL_STATE_KEYS);
  });

  it('never clears a migration marker, which would re-run against fresh defaults', () => {
    for (const key of KREN_RESET_GLOBAL_STATE_KEYS) {
      expect(key, `${key} is a migration marker`).not.toContain('kren.migration.');
    }
  });

  /*
   * The key list is read from the manifest rather than written out, so a setting added
   * later is reset without anyone remembering. A hand-written list is the copy that drifts.
   */
  it('resets every kren setting the manifest declares, without listing them', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as unknown;
    const keys = krenConfigurationKeys(manifest);
    expect(keys.length).toBeGreaterThan(50);
    expect(keys).toContain('explanation.outputLanguage');
    expect(keys).toContain('translation.sourceLanguage');
    expect(keys).toContain('rewrite.alternateModel');
    // Stripped of the section prefix, because getConfiguration('kren') is already scoped.
    expect(keys.every((key) => !key.startsWith('kren.'))).toBe(true);
  });

  it('returns each setting to its default by removing the override, not by writing one', () => {
    const source = extensionSource();
    const at = source.indexOf('async function restoreDefaultConfiguration');
    expect(at).toBeGreaterThan(-1);
    const body = source.slice(at, source.indexOf('\n}\n', at));
    expect(body, 'writing the default pins today\'s value forever')
      .toContain('config.update(key, undefined, scope)');
    expect(body).toContain('krenConfigurationKeys');
  });

  it('takes two separate answers before the full reset removes anything', () => {
    const source = extensionSource();
    const at = source.indexOf('async function resetKren(');
    expect(at).toBeGreaterThan(-1);
    const body = source.slice(at, source.indexOf('\n}\n', at));
    // 2026-10-12: Both confirmation steps use the shared panel-or-VS Code warning entry point.
    expect(body.match(/show(?:Kren)?WarningMessage\(/gu)?.length ?? 0).toBe(2);
    // Both answers are checked, and both checks sit above the first deletion.
    const firstDeletion = body.indexOf('secrets.delete');
    expect(firstDeletion).toBeGreaterThan(body.indexOf("first !== 'Continue'"));
    expect(firstDeletion).toBeGreaterThan(body.indexOf("second !== 'Reset KREN'"));
  });
});
