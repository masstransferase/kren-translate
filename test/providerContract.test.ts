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
  it.each(providers)('R5a finding 15: records English output language for a Korean rewrite from %s', (providerId) => {
    const request = { text: '안녕하세요', sourceLanguage: 'ko', targetLanguage: 'ko', kind: 'translation', operation: 'rewrite',
      englishVariety: 'american', domain: 'general', modality: 'written', function: 'general', formality: 'preserve',
      voice: 'preserve', stance: 'preserve', length: 'preserve', perspective: 'preserve', rhetoricalMode: 'preserve' } as RewriteRequest;
    const result = normalizeGeminiRewriteResult({ kind: 'rewrite', variants: [{ id: 'minimal', text: 'Hello.' }, { id: 'full', text: 'Hello there.' }] }, request, providerId);
    expect(result.sourceLanguage).toBe('ko');
    expect(result.targetLanguage).toBe('en');
    expect(result.variants).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'full', targetLanguage: 'en' }), expect.objectContaining({ id: 'minimal', targetLanguage: 'en' })
    ]));
  });
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
      modality: 'written',
      function: 'general',
      formality: 'neutral',
      voice: 'preserve',
      stance: 'direct',
      length: 'preserve',
      perspective: 'preserve',
      rhetoricalMode: 'preserve'
    };
    const variants = [
      { id: 'minimal', text: 'Use our combined strengths.' },
      { id: 'full', text: 'Work together more effectively.' }
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
