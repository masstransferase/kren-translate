import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  LANGUAGE_MODEL_ROUTING_EFFORTS,
  LANGUAGE_MODEL_ROUTING_PROVIDERS,
  TRANSLATION_ROUTING_DEFAULTS,
  isLanguageModelIdentifier,
  isLanguageModelRoutingEffort,
  isLanguageModelRoutingProvider,
  languageModelRoutingEffortOptions,
  languageModelRoutingProviderOptions
} from '../src/languageModelRouting.js';
import {
  USER_DICTIONARY_THINKING_OR_EFFORTS,
  userDictionaryProviderOptions,
  userDictionaryThinkingOrEffortOptions
} from '../src/userDictionary/settings.js';
import { DEFAULT_GEMINI_MODEL } from '../src/providers/geminiModels.js';
import { validatedPanelSetting } from '../src/panelSettings.js';
import { TUTOR_ROUTING_DEFAULTS } from '../src/tutor/state.js';
import { USER_DICTIONARY_CAPTURE_DEFAULTS } from '../src/userDictionary/settings.js';

interface ManifestProperty {
  default?: unknown;
  enum?: string[];
}

/** Reads a manifest entry by name and fails loudly when the setting is not declared. */
function manifestProperties(): (key: string) => ManifestProperty {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
    contributes: { configuration: { properties: Record<string, ManifestProperty> } };
  };
  return (key) => {
    const property = manifest.contributes.configuration.properties[key];
    if (!property) throw new Error(`package.json declares no setting named ${key}`);
    return property;
  };
}

describe('Translation routing defaults', () => {
  /**
   * This is the criterion the change exists to satisfy, because getting it wrong sends a
   * reader's Translation to a model they never chose and bills them for it. Before
   * Translation owned these three settings it read gemini.model and gemini.thinkingLevel,
   * whose manifest defaults are the two literals asserted here.
   */
  it('reproduce exactly what Translation used before it owned these settings', () => {
    const properties = manifestProperties();

    expect(TRANSLATION_ROUTING_DEFAULTS.model).toBe(DEFAULT_GEMINI_MODEL);
    expect(TRANSLATION_ROUTING_DEFAULTS.model)
      .toBe(properties('kren.gemini.model').default);
    expect(TRANSLATION_ROUTING_DEFAULTS.thinkingOrEffort)
      .toBe(properties('kren.gemini.thinkingLevel').default);
    expect(TRANSLATION_ROUTING_DEFAULTS.provider).toBe('gemini');
  });

  it('are the values the manifest ships, so the panel and the request path agree', () => {
    const properties = manifestProperties();
    expect(properties('kren.translation.provider').default)
      .toBe(TRANSLATION_ROUTING_DEFAULTS.provider);
    expect(properties('kren.translation.model').default)
      .toBe(TRANSLATION_ROUTING_DEFAULTS.model);
    expect(properties('kren.translation.thinkingOrEffort').default)
      .toBe(TRANSLATION_ROUTING_DEFAULTS.thinkingOrEffort);
  });
});

describe('all six routing defaults', () => {
  it('preserves each feature\'s provider, model, and effort from before the full control set', () => {
    const properties = manifestProperties();
    const oldGeminiDefaults = {
      provider: 'gemini',
      model: properties('kren.gemini.model').default,
      thinkingOrEffort: properties('kren.gemini.thinkingLevel').default
    };
    const routes = [
      ['Translation', 'translation', TRANSLATION_ROUTING_DEFAULTS],
      ['Grammar Check', 'userDictionary', USER_DICTIONARY_CAPTURE_DEFAULTS],
      ['Explain Meaning or Nuance', 'explanation', oldGeminiDefaults],
      ['Rewrite Text', 'rewrite', oldGeminiDefaults],
      ['User Dictionary', 'userDictionary', USER_DICTIONARY_CAPTURE_DEFAULTS],
      ['AI English Tutor', 'tutor', TUTOR_ROUTING_DEFAULTS]
    ] as const;

    for (const [feature, prefix, expected] of routes) {
      expect(properties(`kren.${prefix}.provider`).default, `${feature} provider`)
        .toBe(expected.provider);
      expect(properties(`kren.${prefix}.model`).default, `${feature} model`)
        .toBe(expected.model);
      expect(properties(`kren.${prefix}.thinkingOrEffort`).default, `${feature} effort`)
        .toBe(expected.thinkingOrEffort);
    }
  });
});

describe('one provider list and one effort list', () => {
  it('are the same objects User Dictionary reads, not a second copy that agrees today', () => {
    expect(USER_DICTIONARY_THINKING_OR_EFFORTS).toBe(LANGUAGE_MODEL_ROUTING_EFFORTS);
    expect(userDictionaryThinkingOrEffortOptions())
      .toEqual(languageModelRoutingEffortOptions());
    expect(userDictionaryProviderOptions())
      .toEqual(languageModelRoutingProviderOptions());
  });

  it('are the lists the manifest enumerates for every routing setting', () => {
    const properties = manifestProperties();
    for (const key of ['kren.translation.provider', 'kren.explanation.provider',
      'kren.rewrite.provider', 'kren.userDictionary.provider', 'kren.tutor.provider']) {
      expect(properties(key).enum).toEqual([...LANGUAGE_MODEL_ROUTING_PROVIDERS]);
    }
    for (const key of ['kren.translation.thinkingOrEffort',
      'kren.explanation.thinkingOrEffort', 'kren.rewrite.thinkingOrEffort',
      'kren.userDictionary.thinkingOrEffort', 'kren.tutor.thinkingOrEffort']) {
      expect(properties(key).enum)
        .toEqual(LANGUAGE_MODEL_ROUTING_EFFORTS.map((option) => option.id));
    }
  });

  it('drive the validator, so Translation and User Dictionary cannot disagree on a value', () => {
    for (const provider of LANGUAGE_MODEL_ROUTING_PROVIDERS) {
      expect(validatedPanelSetting('translation.provider', provider)).toBe(provider);
      expect(validatedPanelSetting('userDictionary.provider', provider)).toBe(provider);
    }
    for (const { id } of LANGUAGE_MODEL_ROUTING_EFFORTS) {
      expect(validatedPanelSetting('translation.thinkingOrEffort', id)).toBe(id);
      expect(validatedPanelSetting('userDictionary.thinkingOrEffort', id)).toBe(id);
    }
    expect(validatedPanelSetting('translation.provider', 'nonsense')).toBeUndefined();
    expect(validatedPanelSetting('translation.thinkingOrEffort', 'nonsense')).toBeUndefined();
    expect(validatedPanelSetting('translation.model', 'not a model id')).toBeUndefined();
    expect(validatedPanelSetting('translation.model', ' gemini-3.6-flash '))
      .toBe('gemini-3.6-flash');
  });

  it('recognise their own members and refuse everything else', () => {
    expect(isLanguageModelRoutingProvider('gemini')).toBe(true);
    expect(isLanguageModelRoutingProvider('googleCloudTranslation')).toBe(false);
    expect(isLanguageModelRoutingEffort('minimal')).toBe(true);
    expect(isLanguageModelRoutingEffort('maximal')).toBe(false);
    expect(isLanguageModelIdentifier('models/gemini-3.6-flash')).toBe(true);
    expect(isLanguageModelIdentifier('gpt-5.1-mini')).toBe(true);
    expect(isLanguageModelIdentifier('two words')).toBe(false);
  });
});
