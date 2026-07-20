import { describe, expect, it } from 'vitest';
import {
  addHarperWord,
  applyGrammarChoices,
  checkGrammarWithHarper,
  clearHarperIgnoredLints,
  clearHarperWords,
  configureHarperGrammar,
  disposeHarperGrammar,
  ignoreHarperLint
} from '../src/providers/harperGrammar.js';
import type { GrammarResult } from '../src/types.js';

describe('Harper grammar checking', () => {
  it('finds an English agreement issue locally', async () => {
    const result = await checkGrammarWithHarper(
      '  I has an apple.  ',
      'american',
      new AbortController().signal
    );
    expect(result.providerId).toBe('harper');
    expect(result.sourceText).toBe('  I has an apple.  ');
    expect(result.issues.some((issue) =>
      issue.original === 'has' && issue.suggestions.some((suggestion) =>
        suggestion.replacement === 'have'
      )
    )).toBe(true);
  }, 30_000);

  it('applies only the corrections the user selected', () => {
    const result: GrammarResult = {
      kind: 'grammar',
      providerId: 'harper',
      sourceText: 'However I has apple.',
      sourceLanguage: 'en',
      targetLanguage: 'en',
      createdAt: '1970-01-01T00:00:00.000Z',
      dialect: 'american',
      issues: [
        {
          id: 'issue-1',
          start: 0,
          end: 7,
          original: 'However',
          category: 'Punctuation',
          message: 'Add a comma.',
          suggestions: [{
            kind: 'insertAfter',
            replacement: ',',
            label: 'Add “,” after “However”'
          }]
        },
        {
          id: 'issue-2',
          start: 10,
          end: 13,
          original: 'has',
          category: 'Agreement',
          message: 'Use have.',
          suggestions: [{
            kind: 'replace',
            replacement: 'have',
            label: 'Replace with “have”'
          }]
        }
      ]
    };

    expect(applyGrammarChoices(result, [
      { issueId: 'issue-1', suggestionIndex: -1 },
      { issueId: 'issue-2', suggestionIndex: 0 }
    ])).toBe('However I have apple.');
    expect(applyGrammarChoices(result, [
      { issueId: 'issue-1', suggestionIndex: 0 },
      { issueId: 'issue-2', suggestionIndex: 0 }
    ])).toBe('However, I have apple.');
  });

  it('keeps custom words and ignored findings local to the worker configuration', async () => {
    configureHarperGrammar({ customWords: [], ignoredLints: '' });
    const signal = new AbortController().signal;
    const spelling = await checkGrammarWithHarper('Krenwordzz is useful.', 'american', signal);
    expect(spelling.issues.some((issue) => issue.original === 'Krenwordzz')).toBe(true);
    await addHarperWord('Krenwordzz');
    const afterWord = await checkGrammarWithHarper('Krenwordzz is useful.', 'american', signal);
    expect(afterWord.issues.some((issue) => issue.original === 'Krenwordzz')).toBe(false);

    const agreement = await checkGrammarWithHarper('I has an apple.', 'american', signal);
    const issue = agreement.issues.find((candidate) => candidate.original === 'has');
    expect(issue?.ignoreHash).toMatch(/^\d+$/u);
    await ignoreHarperLint(issue!.ignoreHash!);
    const afterIgnore = await checkGrammarWithHarper('I has an apple.', 'american', signal);
    expect(afterIgnore.issues.some((candidate) => candidate.original === 'has')).toBe(false);

    await clearHarperWords();
    await clearHarperIgnoredLints();
    configureHarperGrammar({ customWords: [], ignoredLints: '' });
    await disposeHarperGrammar();
  }, 30_000);
});
