import { TUTOR_DEFAULTS } from '../src/tutor/defaults.js';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GEMINI_MODEL, DEFAULT_PRO_MODELS } from '../src/providers/geminiModels.js';
import { CLOUDFLARE_IMAGE_MODEL_DEFAULT, TUTOR_LIVE_MODEL_DEFAULT } from '../src/panelSettings.js';

/**
 * The default Gemini model was a literal repeated in eight source sites and three settings.
 * They had already drifted: kren.userDictionary.model declared gemini-3.6-flash while the
 * code fallback behind it said gemini-3.5-flash, so the two disagreed about what the default
 * was and only VS Code applying the declared value hid it.
 *
 * A model upgrade is not a rare event, so the rule is one constant and a test rather than a
 * careful search. The alternate profile is deliberately a different model and is exempt.
 */
const packageJson = JSON.parse(
  readFileSync('package.json', 'utf8')
) as {
  contributes: { configuration: { properties: Record<string, { default?: unknown }> } };
};

// The alternate profile exists precisely to be a second, heavier model.
/*
 * The alternate Gemini profile keeps its own model, and its default is a Pro model rather
 * than the flash default every other setting carries. Since 1.7.7 each feature has its own
 * alternate slot as well, so the exemption is a rule rather than one name: a setting whose
 * key ends in `alternateModel` belongs to that profile.
 */
// Changed 2026-09-24: Live requires its own live-capable model, and V149 deliberately gives
// only Hint the lower-latency Flash entry. Neither follows the ordinary generation default.
const EXEMPT_SETTINGS = new Set([
  'kren.gemini.alternateModel', 'kren.tutor.hintModel', 'kren.tutor.liveModel'
]);
const isAlternateProfileModel = (name: string): boolean => name.endsWith('.alternateModel');

describe('the default Gemini model', () => {
  it('is a model the product already lists', () => {
    expect(
      DEFAULT_PRO_MODELS.some((option) => option.id === DEFAULT_GEMINI_MODEL),
      `${DEFAULT_GEMINI_MODEL} is not in DEFAULT_PRO_MODELS, so the product would default to a model it does not offer`
    ).toBe(true);
  });

  it('is what every Gemini model setting declares', () => {
    const properties = packageJson.contributes.configuration.properties;
    const disagreeing: string[] = [];

    for (const [name, definition] of Object.entries(properties)) {
      if (!name.startsWith('kren.') || !name.toLowerCase().endsWith('model')) continue;
      if (name.startsWith('kren.tutor.')) {
        // Changed 2026-10-03: tutor models follow the owner's tutor defaults.
        const key = name.slice(5) as keyof typeof TUTOR_DEFAULTS.configuration;
        // Changed 2026-10-22 (V294, owner I60/I64): picture defaults come from the effective settings resolver.
        expect(definition.default).toBe(key === 'tutor.cloudflareImageModel'
          ? CLOUDFLARE_IMAGE_MODEL_DEFAULT : TUTOR_DEFAULTS.configuration[key]);
        continue;
      }
      if (isAlternateProfileModel(name)) {
        expect(
          DEFAULT_PRO_MODELS.some((option) => option.id === definition.default),
          `${name} defaults to a model DEFAULT_PRO_MODELS does not offer`
        ).toBe(true);
        continue;
      }
      if (EXEMPT_SETTINGS.has(name)) continue;
      if (typeof definition.default !== 'string') continue;
      if (!definition.default.startsWith('gemini-')) continue;
      if (definition.default !== DEFAULT_GEMINI_MODEL) {
        disagreeing.push(`${name} declares ${definition.default}`);
      }
    }

    expect(
      disagreeing,
      `these settings disagree with DEFAULT_GEMINI_MODEL (${DEFAULT_GEMINI_MODEL}): ${disagreeing.join(', ')}`
    ).toEqual([]);
    // Changed 2026-10-03: Hint follows the owner's chosen tutor default.
    expect(properties['kren.tutor.hintModel']?.default).toBe(TUTOR_DEFAULTS.configuration['tutor.hintModel']);
    expect(properties['kren.tutor.liveModel']?.default).toBe(TUTOR_LIVE_MODEL_DEFAULT);
  });

  it('is never written as a literal outside the module that owns it', () => {
    const owner = 'geminiModels.ts';
    const offenders: string[] = [];

    const walk = (directory: string): void => {
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        const child = `${directory}/${item.name}`;
        if (item.isDirectory()) {
          walk(child);
          continue;
        }
        if (!item.name.endsWith('.ts') || item.name === owner) continue;
        const source = readFileSync(child, 'utf8');
        // The alternate pro model and the fixed speech-to-text model are separate,
        // deliberate choices. Neither is a configurable text-generation default.
        const matches = [...source.matchAll(/'(gemini-\d[A-Za-z0-9.-]*)'/gu)]
          .map((match) => match[1] as string)
          .filter((id) => !id.includes('pro') && id !== 'gemini-3.5-transcribe' &&
            id !== TUTOR_LIVE_MODEL_DEFAULT);
        if (matches.length > 0) {
          offenders.push(`${item.name}: ${[...new Set(matches)].join(', ')}`);
        }
      }
    };
    walk('src');

    expect(
      offenders,
      `import DEFAULT_GEMINI_MODEL instead of writing the id: ${offenders.join('; ')}`
    ).toEqual([]);
  });
});
