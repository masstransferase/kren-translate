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
import * as core from '@kren/core';
import type { LanguageModelProviderId } from './types.js';

export const LANGUAGE_MODEL_ROUTING_PROVIDERS = core.LANGUAGE_MODEL_ROUTING_PROVIDERS;

export type LanguageModelRoutingProvider = LanguageModelProviderId;

/** The credential slot used by execution and by Start page availability. */
export function languageModelCredentialSlot(
  provider: LanguageModelRoutingProvider,
  profile: 'standard' | 'pro'
): 'gemini' | 'geminiPro' | 'openai' | 'anthropic' | 'groq' | 'cloudflareApiToken' {
  return core.languageModelCredentialSlot(provider, profile);
}

export const LANGUAGE_MODEL_ROUTING_EFFORTS = core.LANGUAGE_MODEL_ROUTING_EFFORTS;

export type LanguageModelRoutingEffort =
  typeof LANGUAGE_MODEL_ROUTING_EFFORTS[number]['id'];

/**
 * A model identifier is free text because a provider can publish one at any time, but it is
 * not arbitrary text: it goes into a request path, so it is held to the characters the three
 * providers actually use. The `models/` prefix is Gemini's own fully-qualified form.
 */
export const LANGUAGE_MODEL_IDENTIFIER_PATTERN = core.LANGUAGE_MODEL_IDENTIFIER_PATTERN;

export function languageModelRoutingProviderOptions(): Array<[
  LanguageModelRoutingProvider,
  string
]> {
  return core.languageModelRoutingProviderOptions();
}

export function languageModelRoutingEffortOptions(): Array<[
  LanguageModelRoutingEffort,
  string
]> {
  return core.languageModelRoutingEffortOptions();
}

export function languageModelRoutingProviderLabel(
  provider: LanguageModelRoutingProvider
): string {
  return core.languageModelRoutingProviderLabel(provider);
}

export function languageModelRoutingEffortLabel(
  effort: LanguageModelRoutingEffort
): string {
  return core.languageModelRoutingEffortLabel(effort);
}

export function isLanguageModelRoutingProvider(
  value: unknown
): value is LanguageModelRoutingProvider {
  return core.isLanguageModelRoutingProvider(value);
}

export function isLanguageModelRoutingEffort(
  value: unknown
): value is LanguageModelRoutingEffort {
  return core.isLanguageModelRoutingEffort(value);
}

export function isLanguageModelIdentifier(value: unknown): value is string {
  return core.isLanguageModelIdentifier(value);
}

/**
 * Translation's routing defaults reproduce what Translation did before it owned these
 * settings: the default Gemini profile, its model, and a thinking level the model chooses.
 * A reader who has changed nothing must see no change, so these three literals are the
 * contract, and `test/languageModelRouting.test.ts` pins them against the old behaviour.
 */
export const TRANSLATION_ROUTING_DEFAULTS = core.TRANSLATION_ROUTING_DEFAULTS;
