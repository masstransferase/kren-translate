import { describe, expect, it } from 'vitest';
import {
  ALL_REWRITE_VARIANTS_ID,
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
    const updates: Array<[string, string, string]> = [];
    const stored = {
      'rewrite.preferredVariant': {
        globalValue: 'natural',
        workspaceValue: 'concise'
      },
      'rewrite.quickMenuVariant': {
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
      ['rewrite.preferredVariant', 'full', 'global'],
      ['rewrite.preferredVariant', 'full', 'workspace'],
      ['rewrite.quickMenuVariant', 'full', 'workspaceFolder']
    ]);
  });
});
