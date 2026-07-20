import type { LanguageCode, SelectionAnalysis } from './types.js';

const HANGUL_PATTERN = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u;
const WORD_PATTERN = /^[\p{L}\p{M}\p{N}'’-]+$/u;

export function containsHangul(text: string): boolean {
  return HANGUL_PATTERN.test(text);
}

export function detectDirection(text: string): {
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
} {
  return containsHangul(text)
    ? { sourceLanguage: 'ko', targetLanguage: 'en' }
    : { sourceLanguage: 'en', targetLanguage: 'ko' };
}

export function isWordCandidate(text: string): boolean {
  return WORD_PATTERN.test(text.trim());
}

export function analyzeSelection(rawText: string): SelectionAnalysis {
  const text = rawText.trim();
  if (!text) {
    throw new Error('Select a word, phrase, or sentence first.');
  }

  const direction = detectDirection(text);
  return {
    text,
    ...direction,
    kind: isWordCandidate(text) ? 'dictionary' : 'translation'
  };
}
