import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GEMINI_MODEL, DEFAULT_PRO_MODELS } from '../src/providers/geminiModels.js';

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
const EXEMPT_SETTINGS = new Set(['kren.gemini.alternateModel']);

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
        // The alternate pro model is a separate, deliberate choice and stays where it is.
        const matches = [...source.matchAll(/'(gemini-\d[A-Za-z0-9.-]*)'/gu)]
          .map((match) => match[1] as string)
          .filter((id) => !id.includes('pro'));
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
