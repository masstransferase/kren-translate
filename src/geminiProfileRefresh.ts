import { KREN_SECRET_KEYS } from './operations.js';

export type GeminiRefreshProfile = 'default' | 'alternate';

export interface GeminiRefreshTarget {
  /** The stored credential this refresh reads. */
  secretKey: string;
  /** The command that stores that credential, offered when it is missing. */
  setKeyCommand: string;
  /** The command a 401 or 403 should point the reader at. */
  keyHint: 'setGeminiKey' | 'setGeminiProKey';
  /** The word the progress title and the result notification use. */
  label: string;
}

/**
 * Which credential a Model Refresh reads, decided by the profile whose control was pressed.
 *
 * Extracted from extension.ts so it can be exercised without the editor. One command read
 * the alternate key until 1.7.7, whichever profile was on screen, so a reader on the
 * Default profile was asked for an alternate key they did not have and saw a notification
 * naming the alternate profile beside a list that had not changed. That was reported as
 * "the list of model is not refreshed" on 2026-08-28.
 */
export function geminiRefreshTarget(profile: GeminiRefreshProfile): GeminiRefreshTarget {
  return profile === 'alternate'
    ? {
      secretKey: KREN_SECRET_KEYS.geminiPro,
      setKeyCommand: 'kren.setGeminiProApiKey',
      keyHint: 'setGeminiProKey',
      label: 'Paid'
    }
    : {
      secretKey: KREN_SECRET_KEYS.gemini,
      setKeyCommand: 'kren.setGeminiApiKey',
      keyHint: 'setGeminiKey',
      label: 'Free Tier'
    };
}
