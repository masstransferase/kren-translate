import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildGeminiRequestBody,
  buildGeminiRewriteRequestBody,
  configuredThinkingLevel,
  GeminiProvider,
  isRetryableGeminiStatus,
  normalizeGeminiRewriteResult,
  thinkingLevelForModel
} from '../src/providers/gemini.js';
import type { RewriteRequest, TranslationRequest } from '../src/types.js';

const defaultRewriteAxes = {
  modality: 'written',
  function: 'general',
  formality: 'preserve',
  voice: 'preserve',
  stance: 'preserve',
  length: 'preserve',
  perspective: 'preserve',
  rhetoricalMode: 'preserve'
} as const;

afterEach(() => vi.restoreAllMocks());

describe('Gemini privacy boundary', () => {
  it('uses the exact selection as the only user-authored request content', () => {
    const request: TranslationRequest = {
      text: 'ledger',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      kind: 'translation',
      operation: 'translate'
    };

    const body = buildGeminiRequestBody(request);

    expect(body.contents).toEqual([
      {
        role: 'user',
        parts: [{ text: 'ledger' }]
      }
    ]);
    expect(Object.keys(body).sort()).toEqual([
      'contents',
      'generationConfig',
      'systemInstruction'
    ]);
    expect(body).not.toHaveProperty('document');
    expect(body).not.toHaveProperty('filename');
    expect(body).not.toHaveProperty('uri');
    expect(body).not.toHaveProperty('workspace');
    expect(body).not.toHaveProperty('surroundingText');
    expect(body.generationConfig.thinkingConfig?.thinkingLevel).toBe('minimal');
  });

  it('retries only transient Gemini statuses', () => {
    expect(isRetryableGeminiStatus(408)).toBe(true);
    expect(isRetryableGeminiStatus(429)).toBe(true);
    expect(isRetryableGeminiStatus(500)).toBe(true);
    expect(isRetryableGeminiStatus(503)).toBe(true);
    expect(isRetryableGeminiStatus(504)).toBe(true);
    expect(isRetryableGeminiStatus(400)).toBe(false);
    expect(isRetryableGeminiStatus(403)).toBe(false);
    expect(isRetryableGeminiStatus(404)).toBe(false);
  });

  it('uses a thinking level supported by each configured model family', () => {
    expect(thinkingLevelForModel('gemini-3.5-flash')).toBe('minimal');
    expect(thinkingLevelForModel('gemini-3.1-pro-preview')).toBe('low');
    expect(thinkingLevelForModel('gemini-3.5-pro-preview')).toBe('low');
    expect(thinkingLevelForModel('custom-legacy-model')).toBeUndefined();
    expect(configuredThinkingLevel('gemini-3.1-pro-preview', 'minimal')).toBe('low');
    expect(configuredThinkingLevel('gemini-3.5-flash', 'auto')).toBe('minimal');
  });

  it('honors the configured explanation output language', () => {
    const request: TranslationRequest = {
      text: 'deliberate',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      kind: 'translation',
      operation: 'explain',
      explanationLanguage: 'ko'
    };

    const body = buildGeminiRequestBody(request);

    expect(body.systemInstruction.parts[0]?.text).toContain('Korean only');
    expect(body.contents[0]?.parts[0]?.text).toBe('deliberate');
  });

  it('uses the exact text as the only user-authored multilingual rewrite content', () => {
    const request: RewriteRequest = {
      text: 'We need to leverage synergies.',
      sourceLanguage: 'auto',
      targetLanguage: 'auto',
      kind: 'translation',
      operation: 'rewrite',
      englishVariety: 'british',
      domain: 'technical',
      ...defaultRewriteAxes,
      stance: 'cautious',
      rhetoricalMode: 'recommend'
    };

    const body = buildGeminiRewriteRequestBody(request);

    expect(body.contents).toEqual([{
      role: 'user',
      parts: [{ text: 'We need to leverage synergies.' }]
    }]);
    expect(body.systemInstruction.parts[0]?.text).toContain('detectedLanguage');
    expect(body.systemInstruction.parts[0]?.text).toContain('same language');
    expect(body.systemInstruction.parts[0]?.text).toContain('never translate');
    expect(body.systemInstruction.parts[0]?.text).toContain('British English');
    expect(body.systemInstruction.parts[0]?.text).toContain('Jargon-Free');
    expect(body.systemInstruction.parts[0]?.text).toContain('no em dashes or en dashes');
    expect(body.systemInstruction.parts[0]?.text).toContain('precise technical prose');
    expect(body.systemInstruction.parts[0]?.text).toContain('appropriately qualified stance');
    expect(body.systemInstruction.parts[0]?.text).toContain('Rhetorical mode: recommend');
    expect(body.systemInstruction.parts[0]?.text).toContain('Never intensify a claim');
  });

  it('normalizes a detected non-English language without applying an English label', () => {
    const request: RewriteRequest = {
      text: '이 문장을 자연스럽게 고쳐 주세요.',
      sourceLanguage: 'auto',
      targetLanguage: 'auto',
      kind: 'translation',
      operation: 'rewriteNatural',
      englishVariety: 'british',
      domain: 'general',
      ...defaultRewriteAxes,
      formality: 'neutral',
      stance: 'neutral'
    };
    const body = buildGeminiRewriteRequestBody(request);
    expect(body.systemInstruction.parts[0]?.text).toContain(
      'fluent, native-level prose in the detected language'
    );
    expect(body.systemInstruction.parts[0]?.text).not.toContain(
      'fluent native-level English'
    );
    const result = normalizeGeminiRewriteResult({
      detectedLanguage: 'ko',
      variants: [{ id: 'natural', text: '이 문장을 더 자연스럽게 고쳐 주세요.' }]
    }, request, 'gemini');
    expect(result.sourceLanguage).toBe('ko');
    expect(result.targetLanguage).toBe('ko');
    expect(result.variants[0]?.label).toBe('Natural');
  });

  it('builds Pro rewrite requests with low rather than unsupported minimal thinking', () => {
    const request: RewriteRequest = {
      text: 'Please polish this sentence.',
      sourceLanguage: 'en',
      targetLanguage: 'en',
      kind: 'translation',
      operation: 'rewrite',
      englishVariety: 'american',
      domain: 'general',
      ...defaultRewriteAxes,
      formality: 'neutral',
      stance: 'neutral'
    };

    const body = buildGeminiRewriteRequestBody(
      request,
      thinkingLevelForModel('gemini-3.1-pro-preview')
    );

    expect(body.generationConfig.thinkingConfig?.thinkingLevel).toBe('low');
  });

  it('normalizes all three rewrite variants in a fixed order', () => {
    const request: RewriteRequest = {
      text: 'We need to leverage synergies.',
      sourceLanguage: 'en',
      targetLanguage: 'en',
      kind: 'translation',
      operation: 'rewrite',
      englishVariety: 'international',
      domain: 'general',
      ...defaultRewriteAxes,
      formality: 'neutral',
      stance: 'neutral',
      rhetoricalMode: 'constructivelyChallenge'
    };

    const result = normalizeGeminiRewriteResult({
      variants: [
        { id: 'jargonFree', text: 'We need to work together more effectively.' },
        { id: 'natural', text: 'We need to make better use of our combined strengths.' },
        { id: 'concise', text: 'We need to combine our strengths.' }
      ]
    }, request, 'gemini', '1970-01-01T00:00:00.000Z');

    expect(result.variants.map((variant) => variant.id)).toEqual([
      'natural',
      'concise',
      'jargonFree'
    ]);
    expect(result.sourceText).toBe(request.text);
    expect(result.rhetoricalMode).toBe('constructivelyChallenge');
  });

  it('retries a temporarily overloaded model and returns an actionable error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'High demand' } }), {
        status: 503,
        headers: { 'retry-after': '0' }
      })
    );
    const request: TranslationRequest = {
      text: 'partner-ready data packages.',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      kind: 'translation',
      operation: 'translate'
    };

    await expect(new GeminiProvider(
      'test-key',
      'gemini-3.5-flash',
      'configureGeminiModel',
      'minimal',
      4
    ).translate(request, new AbortController().signal)).rejects.toMatchObject({
      retryable: true,
      action: 'configureGeminiModel'
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('normalizes optional rewrite change notes without adding request context', () => {
    const request: RewriteRequest = {
      text: 'partner-ready data packages.',
      sourceLanguage: 'en',
      targetLanguage: 'en',
      kind: 'translation',
      operation: 'rewrite',
      englishVariety: 'canadian',
      domain: 'general',
      ...defaultRewriteAxes,
      formality: 'neutral',
      stance: 'direct',
      includeChangeNotes: true
    };
    const body = buildGeminiRewriteRequestBody(request);
    expect(body.contents[0]?.parts[0]?.text).toBe(request.text);
    expect(body.systemInstruction.parts[0]?.text).toContain('include a concise changeNote');

    const result = normalizeGeminiRewriteResult({ variants: [
      { id: 'natural', text: 'Data packages prepared for partners.', changeNote: 'Clarified readiness.' },
      { id: 'concise', text: 'Partner-ready data packages.', changeNote: 'No substantive change.' },
      { id: 'jargonFree', text: 'Data packages that partners can use.', changeNote: 'Expanded the compound adjective.' }
    ] }, request, 'gemini');
    expect(result.variants[0]?.changeNote).toBe('Clarified readiness.');
  });

  it('requests and normalizes one configured quick-menu rewrite variant', () => {
    const request: RewriteRequest = {
      text: 'We need to leverage synergies.',
      sourceLanguage: 'en',
      targetLanguage: 'en',
      kind: 'translation',
      operation: 'rewriteConcise',
      englishVariety: 'australian',
      domain: 'business',
      ...defaultRewriteAxes,
      formality: 'neutral',
      stance: 'direct'
    };
    const body = buildGeminiRewriteRequestBody(request);
    expect(body.systemInstruction.parts[0]?.text).toContain('"id":"concise"');
    expect(body.systemInstruction.parts[0]?.text).not.toContain('"id":"natural"');
    const result = normalizeGeminiRewriteResult({
      variants: [{ id: 'concise', text: 'Combine our strengths.' }]
    }, request, 'gemini');
    expect(result.variants.map((variant) => variant.id)).toEqual(['concise']);
    expect(result.domain).toBe('business');
    expect(result.formality).toBe('neutral');
    expect(result.stance).toBe('direct');
  });

  it.each([
    ['rewriteNatural', 'natural'],
    ['rewriteJargonFree', 'jargonFree']
  ] as const)('supports the %s quick-menu variant', (operation, expectedId) => {
    const request: RewriteRequest = {
      text: 'We need to leverage synergies.',
      sourceLanguage: 'en',
      targetLanguage: 'en',
      kind: 'translation',
      operation,
      englishVariety: 'indian',
      domain: 'general',
      ...defaultRewriteAxes
    };
    const result = normalizeGeminiRewriteResult({
      variants: [{ id: expectedId, text: 'Rewritten text.' }]
    }, request, 'gemini');
    expect(result.variants.map((variant) => variant.id)).toEqual([expectedId]);
  });
});
