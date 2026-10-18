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
    // The same pencil as Minimal Rewrite. A sparkle read as a different kind of action
    // rather than the same action at a different strength, which is what these two are.
    quickPickIcon: '$(edit)'
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
    value: RewriteVariantId | undefined,
    target: RewriteVariantConfigurationTarget
  ): PromiseLike<void>;
}

/**
 * Clear values KREN no longer understands from the two rewrite variant settings.
 *
 * `rewrite.preferredVariant` was removed on 2026-08-28, on the owner's instruction. It had
 * been inert since the panel started showing Minimal Rewrite and Full Rewrite together, and
 * its own control said so. Removing the declaration is not enough: a value stored in any
 * scope stays in the reader's settings file and VS Code marks it as an unknown setting, so
 * it is cleared here too.
 */
export async function migrateRetiredRewriteVariantSettings(
  configuration: RewriteVariantConfiguration
): Promise<void> {
  const settings = ['rewrite.quickMenuVariant'] as const;
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

  // Undefined removes the stored value rather than replacing it, which is what a removed
  // setting needs: there is no value left that KREN would understand.
  const removed = configuration.inspect<string>(REMOVED_PREFERRED_VARIANT_SETTING);
  if (!removed) return;
  for (const [valueKey, target] of targets) {
    if (removed[valueKey] !== undefined) {
      await configuration.update(REMOVED_PREFERRED_VARIANT_SETTING, undefined, target);
    }
  }
}

/** Removed 2026-08-28. Named here only so a stored value can be cleared. */
export const REMOVED_PREFERRED_VARIANT_SETTING = 'rewrite.preferredVariant';
