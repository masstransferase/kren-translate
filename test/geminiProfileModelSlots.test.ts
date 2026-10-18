import { TUTOR_DEFAULTS } from '../src/tutor/defaults.js';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  renderKrenResultViewHtml,
  type KrenPanelSettings
} from '../src/resultViewHtml.js';
import { EXPLANATION_SAME_AS_SOURCE } from '../src/types.js';
import { validatedPanelSetting } from '../src/panelSettings.js';
import { EDGE_SPEECH_LOCALES } from '@kren/core/edge-speech';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

/*
 * The owner reported two faults on 2026-08-28 that are one fault:
 *
 *   "when I change the model for default, it changes the model of alternate same as the
 *   model I changed; also, vice versa"
 *
 *   "When pressing model Refresh buttons in any LLM ROUTING setting, it gives KREN found 9
 *   Gemini text models available or recommended for the alternate profile, but the list of
 *   model is not refreshed."
 *
 * Both follow from one `<feature>.model` slot serving both Gemini profiles, and one refresh
 * command reading the alternate key whichever profile was on screen. With no alternate key
 * stored, that refresh returned the built-in list and changed nothing.
 *
 * The constraint the owner set in the same exchange: "Model refresh could be a mutual
 * update, but it should not change the model selected for another." So the discovered list
 * is shared and the stored model is not.
 */

const FEATURES = ['translation', 'explanation', 'rewrite', 'userDictionary', 'tutor'] as const;

interface ManifestProperty { type?: string; default?: unknown; description?: string }

function manifest(): Record<string, ManifestProperty> {
  const parsed = JSON.parse(readFileSync('package.json', 'utf8')) as {
    contributes: { configuration: { properties: Record<string, ManifestProperty> } };
  };
  return parsed.contributes.configuration.properties;
}

describe('each Gemini profile stores its own model', () => {
  it('declares an alternateModel setting beside every feature model setting', () => {
    const properties = manifest();
    for (const feature of FEATURES) {
      const alternate = properties[`kren.${feature}.alternateModel`];
      expect(alternate, `kren.${feature}.alternateModel is not declared`).toBeDefined();
      expect(alternate?.type).toBe('string');
      expect(properties[`kren.${feature}.model`], `kren.${feature}.model`).toBeDefined();
    }
  });

  it('keeps the two defaults apart, so a fresh install is not already sharing one model', () => {
    const properties = manifest();
    for (const feature of FEATURES) {
      // Changed 2026-10-03: the owner's tutor slots intentionally share a default.
      if (feature === 'tutor') {
        expect(properties['kren.tutor.alternateModel']?.default).toBe(TUTOR_DEFAULTS.configuration['tutor.alternateModel']);
        expect(properties['kren.tutor.model']?.default).toBe(TUTOR_DEFAULTS.configuration['tutor.model']);
        continue;
      }
      expect(
        properties[`kren.${feature}.alternateModel`]?.default,
        `${feature}: the alternate default matches the default-profile default`
      ).not.toBe(properties[`kren.${feature}.model`]?.default);
    }
  });

  it('accepts a model identifier on every new key, rather than rejecting it as unknown', () => {
    for (const feature of FEATURES) {
      expect(
        validatedPanelSetting(`${feature}.alternateModel` as never, 'gemini-3.1-pro-preview'),
        feature
      ).toBe('gemini-3.1-pro-preview');
      expect(
        validatedPanelSetting(`${feature}.alternateModel` as never, 'nonsense'),
        `${feature}: an unvalidated key would accept anything`
      ).toBeUndefined();
    }
  });
});

/*
 * The routing settings source, read structurally. The decision that matters is which
 * setting key each of the two Model controls writes to, and a rendered panel shows it
 * directly.
 */
describe('the panel draws one Model control per profile slot', () => {
  const settings: KrenPanelSettings = PANEL_SETTINGS_FIXTURE;

  // Tutor's routing group lives on the Tutor screen, not the Settings screen, so both are
  // rendered and joined. Reading only Settings silently exempted Tutor from every check.
  const html = (['settings', 'tutor'] as const)
    .map((activeScreen) => renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings,
      activeScreen,
      proModels: []
    }))
    .join('\n');

  it('binds the default slot and the alternate slot to different settings', () => {
    for (const feature of FEATURES) {
      expect(html, `${feature} default slot`)
        .toContain(`data-setting="${feature}.model"`);
      expect(html, `${feature} alternate slot`)
        .toContain(`data-setting="${feature}.alternateModel"`);
    }
  });

  /*
   * Counted as a pair rather than against a fixed number. A routing group is drawn wherever
   * its feature's settings appear, and Grammar Check and User Dictionary share one, so the
   * total is not the feature count. What must hold is that no default slot was added
   * without its alternate, which is how a sixth feature would silently share one model.
   */
  it('marks the two slots so exactly one can be shown, and never one without the other', () => {
    const defaults = html.split('data-model-slot="default"').length - 1;
    const alternates = html.split('data-model-slot="alternate"').length - 1;
    expect(defaults).toBeGreaterThanOrEqual(FEATURES.length);
    expect(alternates, 'a routing group has a Model control with no alternate slot')
      .toBe(defaults);
  });

  it('gives each slot the provider and profile keys its visibility depends on', () => {
    for (const feature of FEATURES) {
      for (const slot of ['default', 'alternate']) {
        const at = html.indexOf(
          `data-model-slot="${slot}" data-provider-for="${feature}.provider"`
        );
        expect(at, `${feature} ${slot} slot is missing its provider key`).toBeGreaterThan(-1);
        expect(html.slice(at, at + 200))
          .toContain(`data-gemini-profile-for="${feature}.geminiProfile"`);
      }
    }
  });

  /*
   * The visibility rule is a conjunction, not an equality, so it cannot ride on the two
   * generic conditional-group loops. Those loops hide any element carrying their attribute
   * without a matching value attribute, which both slots do, so a slot handled by them
   * would be permanently hidden. Deleting either guard makes this fail.
   */
  it('excludes the model slots from the two equality-based conditional loops', () => {
    const script = html.slice(html.indexOf('function applyConditionalSettings()'));
    const body = script.slice(0, script.indexOf('\n    }'));
    expect(body.split("if (group.hasAttribute('data-model-slot')) return;").length - 1).toBe(2);
    expect(body).toContain("group.getAttribute('data-model-slot') === 'alternate'");
    expect(body).toContain("settingValue(providerKey) === 'gemini'");
    expect(body).toContain("settingValue(profileKey) === 'pro'");
  });

  it('shows the stored value of each slot, so neither control mirrors the other', () => {
    const changed = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: {
        ...settings,
        rewriteModel: 'default-side-model',
        rewriteAlternateModel: 'alternate-side-model'
      },
      activeScreen: 'settings',
      proModels: []
    });
    const slot = (key: string): string => {
      const at = changed.indexOf(`data-setting="${key}"`);
      return changed.slice(at, at + 120);
    };
    expect(slot('rewrite.model')).toContain('value="default-side-model"');
    expect(slot('rewrite.alternateModel')).toContain('value="alternate-side-model"');
  });

  /*
   * The Refresh beside a Default-profile Model field must query the default key. It read
   * refreshProModels until 1.7.7, which is why the notification said "for the alternate
   * profile" whichever profile was on screen and why nothing came back for a reader who
   * had stored no alternate key.
   */
  it('refreshes each slot from its own profile key', () => {
    for (const feature of FEATURES) {
      const defaultSlot = html.slice(
        html.indexOf(`data-model-slot="default" data-provider-for="${feature}.provider"`)
      );
      const bounded = defaultSlot.slice(0, defaultSlot.indexOf('</div>'));
      expect(bounded, `${feature}: the Default profile Refresh queries the alternate key`)
        .toContain('data-command="refreshGeminiModels"');
      expect(bounded).not.toContain('data-command="refreshProModels"');

      const alternateSlot = html.slice(
        html.indexOf(`data-model-slot="alternate" data-provider-for="${feature}.provider"`)
      );
      expect(alternateSlot.slice(0, alternateSlot.indexOf('</div>')))
        .toContain('data-command="refreshProModels"');
    }
  });
});

describe('Explanation language is chosen from a list', () => {
  const settings: KrenPanelSettings = PANEL_SETTINGS_FIXTURE;

  const render = (value: string): string => renderKrenResultViewHtml({
    cspSource: 'vscode-webview://test',
    nonce: 'test-nonce',
    settings: { ...settings, explanationOutputLanguage: value },
    activeScreen: 'settings',
    proModels: []
  });

  function control(html: string): string {
    const at = html.indexOf('data-setting="explanation.outputLanguage"');
    expect(at, 'the Explanation language control is gone').toBeGreaterThan(-1);
    return html.slice(at, html.indexOf('</select>', at));
  }

  it('is a select rather than a free-text field', () => {
    const html = render('bilingual');
    const at = html.indexOf('data-setting="explanation.outputLanguage"');
    expect(html.slice(at - 120, at)).toContain('<select');
  });

  it('offers Same as source first, before every language', () => {
    const options = control(render('bilingual'));
    const first = options.indexOf(`value="${EXPLANATION_SAME_AS_SOURCE}"`);
    expect(first, 'Same as source is not offered').toBeGreaterThan(-1);
    for (const locale of EDGE_SPEECH_LOCALES) {
      expect(options.indexOf(`value="${locale.id}"`), locale.id).toBeGreaterThan(first);
    }
  });

  it('offers every language the Read Aloud Language/Region control offers', () => {
    const options = control(render('bilingual'));
    for (const locale of EDGE_SPEECH_LOCALES) {
      expect(options, `${locale.id} is missing`).toContain(`value="${locale.id}"`);
      expect(options).toContain(locale.label);
    }
  });

  /*
   * Removed on the owner's instruction, 2026-08-28. The value is no longer offered, no
   * longer accepted by the validator, and a stored `bilingual` is migrated to Same as
   * source once at activation, so an existing reader is not left with an empty control.
   */
  it('no longer offers Bilingual, and refuses it if something writes it', () => {
    expect(control(render(EXPLANATION_SAME_AS_SOURCE)))
      .not.toContain('Bilingual (English and Korean)');
    expect(validatedPanelSetting('explanation.outputLanguage', 'bilingual')).toBeUndefined();
  });

  it('keeps a stored value the list does not carry, rather than replacing it silently', () => {
    const options = control(render('sv'));
    expect(options).toContain('value="sv"');
    expect(options).toContain('sv (stored)');
  });

  it('marks the stored value as selected', () => {
    expect(control(render(EXPLANATION_SAME_AS_SOURCE)))
      .toContain(`value="${EXPLANATION_SAME_AS_SOURCE}" selected`);
    expect(control(render('ko'))).toContain('value="ko" selected');
  });

  it('accepts Same as source, which the setting rejected before it was offered', () => {
    expect(validatedPanelSetting('explanation.outputLanguage', EXPLANATION_SAME_AS_SOURCE))
      .toBe(EXPLANATION_SAME_AS_SOURCE);
    expect(validatedPanelSetting('explanation.outputLanguage', 'not a language'))
      .toBeUndefined();
  });

  it('tells the model to write in the source language, not in English', () => {
    const gemini = readFileSync('src/providers/gemini.ts', 'utf8');
    const at = gemini.indexOf('const explanationLanguage =');
    const branch = gemini.slice(at, gemini.indexOf(';', at));
    expect(branch).toContain('EXPLANATION_SAME_AS_SOURCE');
    expect(branch).toContain('the same language as the selected text');
  });
});
