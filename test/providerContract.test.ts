import { describe, expect, it } from 'vitest';
import {
  normalizeGeminiResult,
  normalizeGeminiRewriteResult
} from '../src/providers/gemini.js';
import type {
  LanguageModelProviderId,
  RewriteRequest,
  TranslationRequest
} from '../src/types.js';

const providers: LanguageModelProviderId[] = ['gemini', 'openai', 'anthropic'];

describe('normalized language-model contract', () => {
  it.each(providers)('normalizes the same explanation fixture for %s', (providerId) => {
    const request: TranslationRequest = {
      text: 'deliberate',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      kind: 'translation',
      operation: 'explain'
    };
    expect(normalizeGeminiResult({
      kind: 'translation', translatedText: '신중한', alternatives: ['고의의'], note: 'Context matters.'
    }, request, providerId)).toMatchObject({
      kind: 'translation', providerId, sourceText: 'deliberate', translatedText: '신중한'
    });
  });

  it.each(providers)('normalizes the same rewrite fixture for %s', (providerId) => {
    const request: RewriteRequest = {
      text: 'Leverage synergies.',
      sourceLanguage: 'en',
      targetLanguage: 'en',
      kind: 'translation',
      operation: 'rewrite',
      englishVariety: 'british',
      domain: 'business',
      tone: 'plainLanguage'
    };
    const variants = [
      { id: 'natural', text: 'Use our combined strengths.' },
      { id: 'concise', text: 'Combine our strengths.' },
      { id: 'jargonFree', text: 'Work together more effectively.' }
    ];
    expect(normalizeGeminiRewriteResult({ kind: 'rewrite', variants }, request, providerId))
      .toMatchObject({
        kind: 'rewrite',
        providerId,
        sourceText: request.text,
        englishVariety: 'british',
        variants
      });
  });
});
