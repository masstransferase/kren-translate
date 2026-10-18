import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validatedPanelSetting } from '../src/panelSettings.js';
import {
  ALL_REWRITE_VARIANTS_ID,
  REMOVED_PREFERRED_VARIANT_SETTING,
  isRewriteVariantId,
  migrateRetiredRewriteVariantSettings,
  REWRITE_VARIANT_IDS,
  REWRITE_VARIANT_ID_SET,
  REWRITE_VARIANT_LIST
} from '../src/rewriteVariants.js';
import { REWRITE_VARIANTS } from '@kren/core/rewrite-variants';
import { rewriteSchema } from '../src/providers/openai.js';
import type { RewriteRequest } from '../src/types.js';

const rewriteRequest: RewriteRequest = {
  kind: 'translation',
  operation: 'rewrite',
  text: 'Rewrite this sentence.',
  sourceLanguage: 'en',
  targetLanguage: 'en',
  englishVariety: 'american',
  domain: 'general',
  modality: 'written',
  function: 'general',
  formality: 'neutral',
  voice: 'preserve',
  stance: 'neutral',
  length: 'preserve',
  perspective: 'preserve',
  rhetoricalMode: 'preserve'
};

describe('rewrite variant definitions', () => {
  it('keeps the identifiers and display labels in one ordered list', () => {
    expect(REWRITE_VARIANT_LIST.map(({ id, label }) => [id, label])).toEqual(
      REWRITE_VARIANTS.map(({ id, label }) => [id, label])
    );
  });

  it('derives the runtime set and guard from the list', () => {
    expect(REWRITE_VARIANT_IDS).toEqual(REWRITE_VARIANT_LIST.map(({ id }) => id));
    for (const { id } of REWRITE_VARIANT_LIST) {
      expect(REWRITE_VARIANT_ID_SET.has(id)).toBe(true);
      expect(isRewriteVariantId(id)).toBe(true);
    }
    expect(isRewriteVariantId(ALL_REWRITE_VARIANTS_ID)).toBe(false);
    expect(isRewriteVariantId('unknownVariant')).toBe(false);
  });

  it('derives the OpenAI schema enum and all-variant count from the list', () => {
    const schema = rewriteSchema(rewriteRequest) as {
      properties: {
        variants: {
          minItems: number;
          maxItems: number;
          items: { properties: { id: { enum: readonly string[] } } };
        };
      };
    };
    expect(schema.properties.variants.items.properties.id.enum).toBe(REWRITE_VARIANT_IDS);
    expect(schema.properties.variants.minItems).toBe(REWRITE_VARIANT_LIST.length);
    expect(schema.properties.variants.maxItems).toBe(REWRITE_VARIANT_LIST.length);
  });

  it('migrates every retired variant id to Full Rewrite at its stored scope', async () => {
    const updates: Array<[string, string | undefined, string]> = [];
    const stored = {
      'rewrite.quickMenuVariant': {
        globalValue: 'natural',
        workspaceFolderValue: 'jargonFree'
      }
    };
    await migrateRetiredRewriteVariantSettings({
      inspect: <T>(key: string) => stored[key as keyof typeof stored] as {
        globalValue?: T;
        workspaceValue?: T;
        workspaceFolderValue?: T;
      } | undefined,
      update: (key, value, target) => {
        updates.push([key, value, target]);
        return Promise.resolve();
      }
    });

    expect(updates).toEqual([
      ['rewrite.quickMenuVariant', 'full', 'global'],
      ['rewrite.quickMenuVariant', 'full', 'workspaceFolder']
    ]);
  });

  /*
   * `rewrite.preferredVariant` was removed on 2026-08-28, on the owner's instruction. It
   * had been inert since the panel began showing both variants together, and its own
   * control said so.
   *
   * Removing the declaration is not enough. A value stored in any scope stays in the
   * reader's settings file, where VS Code then marks it as an unknown setting. It is
   * cleared with `undefined`, which removes the entry rather than writing a value KREN no
   * longer understands.
   */
  it('clears a stored value for the removed preferred-variant setting, in every scope', async () => {
    const updates: Array<[string, string | undefined, string]> = [];
    const stored = {
      [REMOVED_PREFERRED_VARIANT_SETTING]: {
        globalValue: 'minimal',
        workspaceValue: 'full',
        workspaceFolderValue: 'minimal'
      }
    };
    await migrateRetiredRewriteVariantSettings({
      inspect: <T>(key: string) => stored[key as keyof typeof stored] as {
        globalValue?: T;
        workspaceValue?: T;
        workspaceFolderValue?: T;
      } | undefined,
      update: (key, value, target) => {
        updates.push([key, value, target]);
        return Promise.resolve();
      }
    });

    expect(updates).toEqual([
      [REMOVED_PREFERRED_VARIANT_SETTING, undefined, 'global'],
      [REMOVED_PREFERRED_VARIANT_SETTING, undefined, 'workspace'],
      [REMOVED_PREFERRED_VARIANT_SETTING, undefined, 'workspaceFolder']
    ]);
  });

  it('writes nothing when the removed setting was never stored', async () => {
    const updates: unknown[] = [];
    await migrateRetiredRewriteVariantSettings({
      inspect: () => undefined,
      update: (...args) => {
        updates.push(args);
        return Promise.resolve();
      }
    });
    expect(updates).toEqual([]);
  });

  it('is gone from the manifest, the panel, and the validator', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      contributes: { configuration: { properties: Record<string, unknown> } };
    };
    expect(Object.keys(manifest.contributes.configuration.properties))
      .not.toContain('kren.rewrite.preferredVariant');
    expect(readFileSync('src/resultViewHtml.ts', 'utf8'), 'the control still renders')
      .not.toContain('Preferred rewrite style');
    expect(validatedPanelSetting('rewrite.preferredVariant' as never, 'full'))
      .toBeUndefined();
  });
});
