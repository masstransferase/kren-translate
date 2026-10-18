/**
 * One provider list and one effort list, for every KREN feature that calls a language model.
 *
 * Five features route to a model: Translation, Grammar Check, Explain Meaning or Nuance,
 * Rewrite Text, and User Dictionary. Before this module the provider names and the effort
 * levels were written out again in each place that needed them, which is how the grammar
 * dialect list reached four copies and disagreed with itself in three of them. The lists
 * live here and every caller reads them, so adding a provider is one edit.
 *
 * `USER_DICTIONARY_PROVIDERS` stays the underlying constant because the User Dictionary
 * capture contract in Core already names it and that contract is versioned; this module
 * gives it the neutral name the other four features need.
 */
import { USER_DICTIONARY_PROVIDERS } from '@kren/core/user-dictionary';
import type { LanguageModelProviderId } from './types.js';
import { DEFAULT_GEMINI_MODEL } from './providers/geminiModels.js';

export const LANGUAGE_MODEL_ROUTING_PROVIDERS = [...USER_DICTIONARY_PROVIDERS, 'groq', 'cloudflare'] as const;

export type LanguageModelRoutingProvider = LanguageModelProviderId;

/** The credential slot used by execution and by Start page availability. */
export function languageModelCredentialSlot(
  provider: LanguageModelRoutingProvider,
  profile: 'standard' | 'pro'
): 'gemini' | 'geminiPro' | 'openai' | 'anthropic' | 'groq' | 'cloudflareApiToken' {
  return provider === 'gemini' ? profile === 'pro' ? 'geminiPro' : 'gemini' : provider === 'cloudflare' ? 'cloudflareApiToken' : provider;
}

interface RoutingOption<T extends string> {
  id: T;
  label: string;
}

export const LANGUAGE_MODEL_ROUTING_EFFORTS = [
  { id: 'auto', label: 'Auto' },
  { id: 'none', label: 'None' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' }
] as const satisfies readonly RoutingOption<string>[];

export type LanguageModelRoutingEffort =
  typeof LANGUAGE_MODEL_ROUTING_EFFORTS[number]['id'];

/**
 * A model identifier is free text because a provider can publish one at any time, but it is
 * not arbitrary text: it goes into a request path, so it is held to the characters the three
 * providers actually use. The `models/` prefix is Gemini's own fully-qualified form.
 */
export const LANGUAGE_MODEL_IDENTIFIER_PATTERN = /^(?:models\/)?[\w@.:-]+(?:\/[\w.:-]+)*$/u;

export function languageModelRoutingProviderOptions(): Array<[
  LanguageModelRoutingProvider,
  string
]> {
  return LANGUAGE_MODEL_ROUTING_PROVIDERS.map((id) => [
    id,
    id === 'gemini' ? 'Google Gemini' : id === 'openai' ? 'OpenAI API' : id === 'groq' ? 'Groq' : id === 'cloudflare' ? 'Cloudflare Workers AI' : 'Anthropic Claude API'
  ]);
}

export function languageModelRoutingEffortOptions(): Array<[
  LanguageModelRoutingEffort,
  string
]> {
  return LANGUAGE_MODEL_ROUTING_EFFORTS.map((option) => [option.id, option.label]);
}

export function languageModelRoutingProviderLabel(
  provider: LanguageModelRoutingProvider
): string {
  return languageModelRoutingProviderOptions()
    .find(([id]) => id === provider)?.[1] ?? provider;
}

export function languageModelRoutingEffortLabel(
  effort: LanguageModelRoutingEffort
): string {
  return LANGUAGE_MODEL_ROUTING_EFFORTS
    .find((option) => option.id === effort)?.label ?? effort;
}

export function isLanguageModelRoutingProvider(
  value: unknown
): value is LanguageModelRoutingProvider {
  return typeof value === 'string' &&
    LANGUAGE_MODEL_ROUTING_PROVIDERS.some((provider) => provider === value);
}

export function isLanguageModelRoutingEffort(
  value: unknown
): value is LanguageModelRoutingEffort {
  return typeof value === 'string' &&
    LANGUAGE_MODEL_ROUTING_EFFORTS.some((option) => option.id === value);
}

export function isLanguageModelIdentifier(value: unknown): value is string {
  return typeof value === 'string' && LANGUAGE_MODEL_IDENTIFIER_PATTERN.test(value.trim());
}

/**
 * Translation's routing defaults reproduce what Translation did before it owned these
 * settings: the default Gemini profile, its model, and a thinking level the model chooses.
 * A reader who has changed nothing must see no change, so these three literals are the
 * contract, and `test/languageModelRouting.test.ts` pins them against the old behaviour.
 */
export const TRANSLATION_ROUTING_DEFAULTS = {
  provider: 'gemini',
  model: DEFAULT_GEMINI_MODEL,
  thinkingOrEffort: 'auto'
} as const satisfies {
  provider: LanguageModelRoutingProvider;
  model: string;
  thinkingOrEffort: LanguageModelRoutingEffort;
};
