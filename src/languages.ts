import {
  AUTO_ENGLISH_KOREAN_TARGET,
  KREN_LANGUAGES,
  type KrenLanguage
} from '@kren/core/languages';
import { isPlausibleLanguageCode as coreIsPlausibleLanguageCode } from '@kren/core/validation';

export {
  AUTO_ENGLISH_KOREAN_TARGET,
  KREN_LANGUAGES,
  type KrenLanguage
};

export function languageName(code: string): string {
  if (code === 'auto') return 'Auto-detect';
  if (code === AUTO_ENGLISH_KOREAN_TARGET) return 'Auto: English ↔ Korean';
  if (code === 'bilingual') return 'English and Korean';
  return KREN_LANGUAGES.find((language) => language.code === code)?.name ?? code;
}

export function isPlausibleLanguageCode(value: string): boolean {
  return coreIsPlausibleLanguageCode(value);
}
