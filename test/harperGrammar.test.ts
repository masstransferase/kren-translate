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

// Harper carries English rules and an English dictionary. Run on French it reports every
// word as a misspelling, because every word is outside its dictionary, and a page of wrong
// findings is worse than none. Grammar Check decides; this is the switch it throws.
describe('skipping the offline checker on text it cannot read', () => {
  it('returns a grammar result with no findings and never starts the worker', async () => {
    const signal = new AbortController().signal;
    const skipped = await checkGrammarWithHarper(
      'Il est arrive a la fete sans avoir ete invite par personne.',
      'american',
      signal,
      false
    );

    expect(skipped.kind).toBe('grammar');
    expect(skipped.issues).toEqual([]);
    // The shape is unchanged, because Smart Grammar Check merges its findings into it.
    expect(skipped.sourceText).toBe('Il est arrive a la fete sans avoir ete invite par personne.');
    expect(skipped.providerId).toBe('harper');
  });

  it('still runs by default, so an existing caller is unaffected', async () => {
    const signal = new AbortController().signal;
    const checked = await checkGrammarWithHarper('I has an apple.', 'american', signal);
    expect(checked.issues.length).toBeGreaterThan(0);
  }, 30_000);
});
