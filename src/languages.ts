import {
  AUTO_ENGLISH_KOREAN_TARGET,
  KREN_LANGUAGES,
  localeLanguageName,
  isSameLanguage as coreIsSameLanguage,
  type KrenLanguage
} from '@kren/core/languages';
import { isPlausibleLanguageCode as coreIsPlausibleLanguageCode } from '@kren/core/validation';

export {
  AUTO_ENGLISH_KOREAN_TARGET,
  KREN_LANGUAGES,
  type KrenLanguage
};

/**
 * The name of a language, for a reader or for a prompt.
 *
 * Three sources, in order of specificity. `KREN_LANGUAGES` carries bare codes, `ko` and
 * `de`. The Edge speech catalog carries locale ids, `en-US` and `pt-BR`, and those are what
 * the Translation and Explanation controls emit since 1.7.7. Before 1.7.9 only the first was
 * consulted, so choosing English (United States) put the literal string `en-US` into a
 * Gemini instruction: "give a natural en-US equivalent". The owner saw the result of that as
 * an explanation that behaved differently for English than for other languages.
 *
 * The region is dropped last rather than first, so `pt-BR` reads as Portuguese (Brazilian)
 * where the catalog knows it and falls back to Portuguese where it does not, instead of
 * collapsing both to Portuguese.
 */
export function languageName(code: string): string {
  return localeLanguageName(code);
}

export function isPlausibleLanguageCode(value: string): boolean {
  return coreIsPlausibleLanguageCode(value);
}

/**
 * Whether two language codes name the same language, ignoring region.
 *
 * `en` and `en-US` are the same language written two ways, and both are in circulation: the
 * settings carry locale ids while the classifier carries bare codes. Comparing the strings
 * would call them different, which is how "give a natural English equivalent" of English
 * text reached a prompt.
 *
 * `auto` is not a language, so it matches nothing: an undeclared source is not evidence that
 * the source and the target agree.
 */
export function isSameLanguage(left: string, right: string): boolean {
  return coreIsSameLanguage(left, right);
}
