import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { resultDetails } from '../src/render.js';
import type { DictionaryResult, RewriteResult, TranslationResult } from '../src/types.js';

const base = {
  sourceLanguage: 'en',
  targetLanguage: 'en',
  createdAt: '1970-01-01T00:00:00.000Z'
};

describe('plain-text full details', () => {
  it('puts dictionary content before the metadata footer', () => {
    const result: DictionaryResult = {
      ...base,
      kind: 'dictionary',
      providerId: 'merriamWebsterCollegiate',
      sourceText: 'multilingual',
      headword: 'mul·ti·lin·gual',
      pronunciation: 'ˌməl-tē-ˈliŋ-gwəl',
      entries: [],
      sections: [{
        headword: 'mul·ti·lin·gual',
        partOfSpeech: 'adjective',
        pronunciation: 'ˌməl-tē-ˈliŋ-gwəl',
        entries: [{ meaning: 'expressed in several languages', examples: ['a multilingual sign'] }]
      }]
    };

    const details = resultDetails(result);

    expect(details.startsWith('mul·ti·lin·gual [ˌməl-tē-ˈliŋ-gwəl]')).toBe(true);
    expect(details).not.toContain('Original\n--------');
    expect(details.indexOf('expressed in several languages')).toBeLessThan(
      details.indexOf('Direction: English -> English')
    );
    expect(details.trimEnd().endsWith('----------')).toBe(true);
  });

  it('puts every rewrite variant before the metadata footer', () => {
    const result: RewriteResult = {
      ...base,
      kind: 'rewrite',
      providerId: 'gemini',
      sourceText: 'Leverage synergies.',
      englishVariety: 'international',
      domain: 'business',
      modality: 'written',
      function: 'general',
      formality: 'neutral',
      voice: 'preserve',
      stance: 'direct',
      length: 'preserve',
      perspective: 'preserve',
      rhetoricalMode: 'persuade',
      variants: [
        { id: 'minimal', label: 'Minimal Rewrite', text: 'Use our combined strengths.' },
        { id: 'full', label: 'Full Rewrite', text: 'Work together effectively.' }
      ]
    };

    const details = resultDetails(result);

    expect(details.indexOf('Minimal Rewrite')).toBeLessThan(details.indexOf('=============='));
    expect(details.indexOf('Full Rewrite')).toBeLessThan(details.indexOf('Provider: Gemini'));
    expect(details).toContain('English: International English');
    expect(details).toContain('Domain: Business');
    expect(details).toContain('Formality: Neutral');
    expect(details).toContain('Stance: Direct');
  });

  it('identifies and preserves an editorial synonym discussion', () => {
    const result: DictionaryResult = {
      ...base,
      kind: 'dictionary',
      providerId: 'merriamWebsterCollegiate',
      sourceText: 'description',
      headword: 'description',
      entries: [],
      sections: [{
        headword: 'description',
        partOfSpeech: 'noun',
        entries: [{ meaning: 'a statement that tells what something is like' }],
        synonymDiscussions: [{
          label: 'synonyms',
          text: 'type and description refer to groups.',
          blocks: [
            { kind: 'text', text: 'type and description refer to groups.' },
            { kind: 'example', text: 'acts of that description' }
          ]
        }]
      }]
    };

    const details = resultDetails(result);
    expect(details).toContain('Choose the Right Synonym for description');
    expect(details).toContain('not a translation');
    expect(details.indexOf('type and description')).toBeLessThan(
      details.indexOf('Example: acts of that description')
    );
  });

  it('includes Google attribution and a disclaimer in translation details', () => {
    const result: TranslationResult = {
      ...base,
      kind: 'translation',
      providerId: 'googleCloudTranslation',
      sourceText: 'hello',
      translatedText: 'hello translated'
    };

    const details = resultDetails(result);
    expect(details).toContain('Powered by Google Translate');
    expect(details).toContain('Google disclaims warranties');
  });

  it('attributes Korean Basic Dictionary text to its copyright holder', () => {
    const result: DictionaryResult = {
      ...base,
      kind: 'dictionary',
      providerId: 'koreanBasicDictionary',
      sourceText: '나무',
      headword: '나무',
      entries: [{ meaning: 'tree' }]
    };

    const details = resultDetails(result);
    expect(details).toContain('Basic Korean Dictionary, National Institute of Korean Language');
    expect(details).toContain('CC BY-SA');
  });
});
