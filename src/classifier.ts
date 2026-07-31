import type { LanguageCode, SelectionAnalysis } from './types.js';
import {
  classifySelection,
  containsHangul as coreContainsHangul,
  detectEnglishKoreanDirection,
  isWordCandidate as coreIsWordCandidate
} from '@kren/core/classification';

export function containsHangul(text: string): boolean {
  return coreContainsHangul(text);
}

export function detectDirection(text: string): {
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
} {
  return detectEnglishKoreanDirection(text);
}

export function isWordCandidate(text: string): boolean {
  return coreIsWordCandidate(text);
}

export function analyzeSelection(rawText: string): SelectionAnalysis {
  return classifySelection(rawText);
}
