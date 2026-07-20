import { describe, expect, it } from 'vitest';
import { analyzeSelection, containsHangul, detectDirection, isWordCandidate } from '../src/classifier.js';

describe('selection classifier', () => {
  it('detects English-to-Korean direction', () => {
    expect(detectDirection('ledger')).toEqual({
      sourceLanguage: 'en',
      targetLanguage: 'ko'
    });
  });

  it('detects Korean-to-English direction', () => {
    expect(detectDirection('분산 원장')).toEqual({
      sourceLanguage: 'ko',
      targetLanguage: 'en'
    });
  });

  it('recognizes isolated words', () => {
    expect(isWordCandidate('timezone-aware')).toBe(true);
    expect(isWordCandidate('시간대')).toBe(true);
    expect(isWordCandidate('general ledger')).toBe(false);
  });

  it('classifies a phrase as translation', () => {
    expect(analyzeSelection('general ledger')).toMatchObject({
      kind: 'translation',
      sourceLanguage: 'en',
      targetLanguage: 'ko'
    });
  });

  it('trims selected text', () => {
    expect(analyzeSelection('  ledger\r\n').text).toBe('ledger');
  });

  it('rejects empty selections', () => {
    expect(() => analyzeSelection('  ')).toThrow(/select/i);
  });

  it('recognizes Hangul Jamo and syllables', () => {
    expect(containsHangul('나무')).toBe(true);
    expect(containsHangul('ledger')).toBe(false);
  });
});
