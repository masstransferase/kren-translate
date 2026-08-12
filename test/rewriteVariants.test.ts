import { describe, expect, it } from 'vitest';
import {
  ALL_REWRITE_VARIANTS_ID,
  isRewriteVariantId,
  REWRITE_VARIANT_IDS,
  REWRITE_VARIANT_ID_SET,
  REWRITE_VARIANT_LIST
} from '../src/rewriteVariants.js';
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
  tone: 'neutral'
};

describe('rewrite variant definitions', () => {
  it('keeps the identifiers and display labels in one ordered list', () => {
    expect(REWRITE_VARIANT_LIST.map(({ id, label }) => [id, label])).toEqual([
      ['natural', 'Natural'],
      ['concise', 'Concise'],
      ['jargonFree', 'Jargon-Free']
    ]);
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
});
