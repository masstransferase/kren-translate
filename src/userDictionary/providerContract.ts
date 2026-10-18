/** Extend the frozen Core provider enum while retaining its recursive entry validation. */
import * as core from '@kren/core/user-dictionary';
import type { LanguageModelRoutingProvider } from '../languageModelRouting.js';
export * from '@kren/core/user-dictionary';
export type UserDictionaryProvider = LanguageModelRoutingProvider;
export const USER_DICTIONARY_PROVIDERS = [...core.USER_DICTIONARY_PROVIDERS, 'groq', 'cloudflare'] as const;
type Extended<T> = [T] extends [undefined | null] ? T : [NonNullable<T>] extends [core.UserDictionaryProvider]
  ? LanguageModelRoutingProvider | Extract<T, undefined | null>
  : T extends (...args: infer A) => infer R ? (...args: { [K in keyof A]: Extended<A[K]> }) => Extended<R>
    : T extends object ? { [K in keyof T]: Extended<T[K]> } : T;
export type UserDictionaryEntryV1 = Extended<core.UserDictionaryEntryV1>;
export type UserDictionaryStoreV1 = Extended<core.UserDictionaryStoreV1>;
export type UserDictionaryImportPreview = Extended<core.UserDictionaryImportPreview>;
export const isUserDictionaryProvider = (value: unknown): value is UserDictionaryProvider =>
  core.isUserDictionaryProvider(value) || value === 'groq' || value === 'cloudflare';

/** Normalize only capture.provider for Core, then restore the locally validated enum. */
function bridge<F extends (...args: never[]) => unknown>(fn: F): Extended<F> {
  return ((...args: unknown[]) => {
    const providers = new Map<string, 'groq' | 'cloudflare'>();
    const normalize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(normalize);
      if (!value || typeof value !== 'object' || value instanceof Date) return value;
      const record = value as Record<string, unknown>;
      const capture = record.capture as Record<string, unknown> | undefined;
      if (typeof record.id === 'string' && (capture?.provider === 'groq' || capture?.provider === 'cloudflare')) {
        providers.set(record.id, capture.provider);
        return { ...record, capture: { ...capture, provider: 'openai' } };
      }
      return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, normalize(item)]));
    };
    const restore = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(restore);
      if (!value || typeof value !== 'object' || value instanceof Date) return value;
      const record = value as Record<string, unknown>;
      const result = Object.fromEntries(Object.entries(record).map(([key, item]) => [key, restore(item)]));
      const provider = typeof record.id === 'string' ? providers.get(record.id) : undefined;
      if (provider && result.capture && typeof result.capture === 'object') result.capture = { ...result.capture, provider };
      return result;
    };
    // JSON imports contain entries inside a string, which must cross the same gate.
    const normalized = args.map(arg => {
      if (typeof arg === 'string' && arg.trim().startsWith('{')) {
        try { return JSON.stringify(normalize(JSON.parse(arg))); } catch { return arg; }
      }
      return normalize(arg);
    });
    return restore((fn as unknown as (...args: unknown[]) => unknown)(...normalized));
  }) as Extended<F>;
}

export const validateUserDictionaryEntry = bridge(core.validateUserDictionaryEntry);
export const validateUserDictionaryStore = bridge(core.validateUserDictionaryStore);
export const canonicalUserDictionaryStore = bridge(core.canonicalUserDictionaryStore);
export const importUserDictionaryJson = bridge(core.importUserDictionaryJson);
export const previewUserDictionaryImportDocument = bridge(core.previewUserDictionaryImportDocument);
export const previewUserDictionaryImport = bridge(core.previewUserDictionaryImport);
export const previewUserDictionaryMarkdownImport = bridge(core.previewUserDictionaryMarkdownImport);
export const applyUserDictionaryImport = bridge(core.applyUserDictionaryImport);
export const previewUserDictionaryPurge = bridge(core.previewUserDictionaryPurge);
export const entriesRemainingAfterPurge = bridge(core.entriesRemainingAfterPurge);
export const exportUserDictionaryMarkdown = bridge(core.exportUserDictionaryMarkdown);
export const filterUserDictionaryEntries = bridge(core.filterUserDictionaryEntries);
export const userDictionaryFilterValues = bridge(core.userDictionaryFilterValues);
export const userDictionarySourceLine = core.userDictionarySourceLine as Extended<typeof core.userDictionarySourceLine>;
export function exportUserDictionaryJson(store: UserDictionaryStoreV1): string {
  return `${JSON.stringify(canonicalUserDictionaryStore(store), null, 2)}\n`;
}
export function assembleUserDictionaryDraft(
  expression: string, settings: core.UserDictionaryCaptureSettings, provider: UserDictionaryProvider,
  model: string, value: unknown, now?: () => string, uuid?: () => string, options?: core.UserDictionaryGenerationOptions
): UserDictionaryEntryV1 {
  const entry = core.assembleUserDictionaryDraft(expression, settings,
    provider === 'groq' || provider === 'cloudflare' ? 'openai' : provider, model, value, now, uuid, options);
  return validateUserDictionaryEntry({ ...entry, capture: { ...entry.capture, provider } });
}
