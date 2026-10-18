/**
 * What each of the two reset actions clears, decided free of the editor so it can be tested.
 *
 * The owner asked for both on 2026-08-28: a **Default Setting** button that returns "the
 * default state of the whole settings except credentials keys", and a **Reset KREN** button
 * that "will go back to default and remove all credentials, too", with "one more
 * confirmation required before executing the reset".
 *
 * The difference between them is exactly one thing, credentials, plus the state that only
 * exists because a credential was once used: the consent a provider was granted, and the
 * Cloud Translation usage ledger. Keeping a granted consent after every key is deleted would
 * mean the next key stored skips the confirmation the first one required.
 */

export type KrenResetScope = 'settings' | 'everything';

export interface KrenResetPlan {
  /** Whether every `kren.*` configuration value returns to its manifest default. */
  configuration: boolean;
  /** Whether every credential in Secret Storage is deleted. */
  credentials: boolean;
  /**
   * Global-state keys cleared outright. Consent flags and the usage ledger only mean
   * anything while a credential exists, and the local grammar vocabulary is reader data
   * rather than a setting, so neither is touched by the settings-only reset.
   */
  globalStateKeys: readonly string[];
  /** How many separate confirmations the reader must give before anything is removed. */
  confirmations: number;
}

/**
 * The state a full reset clears beyond configuration and credentials.
 *
 * Named here rather than in extension.ts so the list a test reads is the list the command
 * uses. Migration markers are deliberately absent: clearing them would re-run a migration
 * against settings that have just been returned to their defaults, which can only move a
 * default off its default.
 */
export const KREN_RESET_GLOBAL_STATE_KEYS = [
  'kren.gemini.termsConsent.v4',
  'kren.openai.paidConsent.v2',
  'kren.groq.consent.v1',
  'kren.cloudflare.consent.v1',
  'kren.anthropic.paidConsent.v2',
  'kren.edgeTts.onlineConsent.v1',
  'kren.googleCloudTranslation.usage.v1',
  'kren.languageModelExhaustion.v2',
  'kren.grammar.customWords.v1',
  'kren.grammar.ignoredLints.v1'
] as const;

export function krenResetPlan(scope: KrenResetScope): KrenResetPlan {
  return scope === 'everything'
    ? {
      configuration: true,
      credentials: true,
      globalStateKeys: KREN_RESET_GLOBAL_STATE_KEYS,
      confirmations: 2
    }
    : {
      configuration: true,
      credentials: false,
      globalStateKeys: [],
      // Two, on the owner's instruction of 2026-08-28: "Pressing Default Setting button
      // should also generate a double-checking message like reset KREN button." It is
      // recoverable, but it reaches every setting at once and the reader may have spent a
      // while arriving at them.
      confirmations: 2
    };
}

/**
 * The `kren.*` configuration keys a reset returns to their manifest defaults.
 *
 * Read from the manifest rather than listed, so a setting added later is reset without
 * anyone remembering to add it here. That is the defect this project keeps hitting: one
 * rule stored in two places, where the second copy is the one that goes stale.
 */
export function krenConfigurationKeys(manifest: unknown): string[] {
  const contributes = (manifest as {
    contributes?: { configuration?: { properties?: Record<string, unknown> } };
  })?.contributes;
  const properties = contributes?.configuration?.properties ?? {};
  return Object.keys(properties)
    .filter((name) => name.startsWith('kren.'))
    .map((name) => name.slice('kren.'.length));
}
