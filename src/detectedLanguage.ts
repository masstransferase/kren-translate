import { edgeSpeechLocaleFromLatinWords, edgeSpeechLocaleFromScript } from '@kren/core/edge-speech';

/** Shared detector: script first, then clear evidence from Latin-script words. */
export function detectedLanguage(text: string): string | undefined {
  return edgeSpeechLocaleFromScript(text) ?? edgeSpeechLocaleFromLatinWords(text);
}
