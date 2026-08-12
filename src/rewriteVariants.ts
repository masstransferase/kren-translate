import type { RewriteOperation, RewriteVariantId } from './types.js';

// Rewrite variants used to be repeated as type unions, validators, dropdown options,
// provider arrays, and a JSON schema enum. A variant added to only the rendering side
// could produce a normal-looking button whose message was rejected at runtime.
//
// One array is now the single source. The shared core type checks every identifier at
// compile time, while the guard, labels, operations, settings options, and schemas are
// derived from the array and cannot drift from it.
//
// This module deliberately imports nothing from vscode, so it can be unit tested.

export const REWRITE_VARIANT_LIST = [
  {
    id: 'natural',
    label: 'Natural',
    englishResultLabel: 'Natural English',
    operation: 'rewriteNatural',
    quickPickIcon: '$(sparkle)'
  },
  {
    id: 'concise',
    label: 'Concise',
    englishResultLabel: 'Concise',
    operation: 'rewriteConcise',
    quickPickIcon: '$(symbol-ruler)'
  },
  {
    id: 'jargonFree',
    label: 'Jargon-Free',
    englishResultLabel: 'Jargon-Free',
    operation: 'rewriteJargonFree',
    quickPickIcon: '$(clear-all)'
  }
] as const satisfies readonly {
  id: RewriteVariantId;
  label: string;
  englishResultLabel: string;
  operation: Exclude<RewriteOperation, 'rewrite'>;
  quickPickIcon: string;
}[];

export type RewriteVariantListId = typeof REWRITE_VARIANT_LIST[number]['id'];

type AssertNoMissingVariant<T extends never> = T;
export type RewriteVariantListCoverage = AssertNoMissingVariant<
  Exclude<RewriteVariantId, RewriteVariantListId>
>;

export const REWRITE_VARIANT_IDS: readonly RewriteVariantListId[] = REWRITE_VARIANT_LIST.map(
  ({ id }) => id
);

export const REWRITE_VARIANT_ID_SET: ReadonlySet<RewriteVariantListId> = new Set(
  REWRITE_VARIANT_IDS
);

export const ALL_REWRITE_VARIANTS_ID = 'all' as const;

export type QuickMenuRewriteVariantId =
  | typeof ALL_REWRITE_VARIANTS_ID
  | RewriteVariantListId;

export function isRewriteVariantId(value: unknown): value is RewriteVariantListId {
  return typeof value === 'string' && REWRITE_VARIANT_ID_SET.has(value as RewriteVariantListId);
}
