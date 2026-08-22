import {
  REWRITE_OUTPUT_RULES,
  REWRITE_VARIANT_IDS,
  REWRITE_VARIANTS,
  rewriteVariantLabel
} from '@kren/core/rewrite-variants';
import type { RewriteOperation, RewriteVariantId } from './types.js';

export {
  REWRITE_OUTPUT_RULES,
  REWRITE_PRIORITY_RULE,
  REWRITE_VARIANT_IDS,
  REWRITE_VARIANTS,
  REWRITE_WORKED_EXAMPLE,
  rewriteVariantLabel
} from '@kren/core/rewrite-variants';

const VS_CODE_VARIANT_FIELDS = {
  minimal: {
    operation: 'rewriteMinimal',
    quickPickIcon: '$(edit)'
  },
  full: {
    operation: 'rewriteFull',
    quickPickIcon: '$(sparkle)'
  }
} as const satisfies Record<RewriteVariantId, {
  operation: Exclude<RewriteOperation, 'rewrite'>;
  quickPickIcon: string;
}>;

export const REWRITE_VARIANT_LIST = REWRITE_VARIANTS.map((variant) => ({
  ...variant,
  ...VS_CODE_VARIANT_FIELDS[variant.id]
}));

export type RewriteVariantListId = typeof REWRITE_VARIANT_IDS[number];

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

const RETIRED_REWRITE_VARIANT_IDS = ['natural', 'concise', 'jargonFree'] as const;

type RewriteVariantConfigurationTarget = 'global' | 'workspace' | 'workspaceFolder';

interface RewriteVariantConfiguration {
  inspect<T>(key: string): {
    globalValue?: T;
    workspaceValue?: T;
    workspaceFolderValue?: T;
  } | undefined;
  update(
    key: string,
    value: RewriteVariantId,
    target: RewriteVariantConfigurationTarget
  ): PromiseLike<void>;
}

export async function migrateRetiredRewriteVariantSettings(
  configuration: RewriteVariantConfiguration
): Promise<void> {
  const settings = ['rewrite.preferredVariant', 'rewrite.quickMenuVariant'] as const;
  const targets = [
    ['globalValue', 'global'],
    ['workspaceValue', 'workspace'],
    ['workspaceFolderValue', 'workspaceFolder']
  ] as const;

  for (const setting of settings) {
    const inspected = configuration.inspect<string>(setting);
    if (!inspected) continue;
    for (const [valueKey, target] of targets) {
      const value = inspected[valueKey];
      if (RETIRED_REWRITE_VARIANT_IDS.some((retired) => retired === value)) {
        await configuration.update(setting, 'full', target);
      }
    }
  }
}
