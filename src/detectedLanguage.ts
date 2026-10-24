import { detectedLanguage as coreDetectedLanguage } from '@kren/core/languages';

/** Shared detector: script first, then clear evidence from Latin-script words. */
export function detectedLanguage(text: string): string | undefined {
  return coreDetectedLanguage(text);
}
