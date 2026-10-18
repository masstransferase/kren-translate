import { describe, expect, it } from 'vitest';
import { findTutorTargets } from '../src/tutor/search.js';

/*
 * A reader names a grammar subject in the plural. The map is written in the singular.
 *
 * Matching was a plain substring test, which works in one direction only: a singular query
 * finds a plural field because the shorter string sits inside the longer, and a plural query
 * finds nothing. So `articles` returned no result at all while the node labelled
 * `A/an, the, and zero article` sat in the map. That is the most ordinary query a learner
 * could type, and it was the one shape the search could not answer.
 */
describe('a query written in the plural', () => {
  it('finds a target the map names in the singular', () => {
    const labels = findTutorTargets('articles').map((candidate) => candidate.label);

    expect(labels[0], 'the article node is the first result, not a missing one')
      .toBe('A/an, the, and zero article');
  });

  it('does not stem a short word into a match for everything', () => {
    const short = findTutorTargets('as');

    expect(short.every((candidate) => candidate.label.toLowerCase().includes('as')))
      .toBe(true);
  });

  it('still finds a singular query, which already worked', () => {
    const labels = findTutorTargets('phrasal verb').map((candidate) => candidate.label);

    expect(labels).toContain('Phrasal verbs');
  });
});

describe('local tutor target search', () => {
  it('R2 ranks a label match above a description match and an example match', () => {
    expect(findTutorTargets('focus').map((candidate) => candidate.id)).toEqual([
      'mechanics.structural-assembly.syntactic-manipulation.inversion-clefts-fronting',
      'auditory.prosodic-mapping.contrastive-focus',
      'mechanics.structural-assembly.syntactic-manipulation'
    ]);
    expect(findTutorTargets('phrase').map((candidate) => candidate.id)).toEqual([
      'mechanics.structural-assembly.complementation.verb-adjective-noun-complements',
      'mechanics.structural-assembly.sentence-operators',
      'lexical'
    ]);
  });

  it('R2 treats vs, vs., and versus as separators instead of search terms', () => {
    const expected = [
      'mechanics.structural-assembly.clause-architecture.relative-clauses',
      'mechanics.structural-assembly.clause-architecture.noun-clauses-reported-speech'
    ];

    for (const separator of ['vs', 'vs.', 'versus']) {
      const ids = findTutorTargets(`what ${separator} that`).map((candidate) => candidate.id);
      expect(ids).toEqual(expected);
      expect(ids).not.toContain('mechanics.time-reality.conditional-logic.real-hypothetical-meaning');
      expect(ids).not.toContain('mechanics.structural-assembly.complementation.gerund-infinitive');
    }
  });

  it('R2 returns no more than three positive-scoring candidates and none for no match', () => {
    expect(findTutorTargets('clause')).toHaveLength(3);
    expect(findTutorTargets('xyzzynotinthetutormap')).toEqual([]);
  });

  it('R2 finds the map subject that covers the what and that clause contrast', () => {
    const results = findTutorTargets('what vs. that');

    const ids = results.map((candidate) => candidate.id);
    expect(ids).toEqual([
      'mechanics.structural-assembly.clause-architecture.relative-clauses',
      'mechanics.structural-assembly.clause-architecture.noun-clauses-reported-speech'
    ]);
  });

  it('V49 gives a structural word no weight outside a label', () => {
    // Measured 2026-09-02: `that` appears in the prose of 28 of the 123 nodes, so matching
    // it against descriptions ranked by how the map happens to be written. The owner asked
    // about `which vs. that usages` and got three nodes about tense, clause linking, and
    // conditionals, none of which mentions either word in its label.
    expect(findTutorTargets('that')).toEqual([]);
    expect(findTutorTargets('usages')).toEqual([]);

    // A structural word still names the node that is about it, matched as a whole word.
    // As a substring, `the` also matches `Real vs. hypothetical meaning`.
    expect(findTutorTargets('the').map((node) => node.id))
      .toEqual(['mechanics.entity-management.reference-determination.articles']);

    // A content word is unaffected, so the change removes noise rather than results.
    expect(findTutorTargets('collocations').map((node) => node.id))
      .toEqual(['lexical.combinatorial-lexis.collocations']);
  });

  it('V51 lets one content word outvote every conjunction in the question', () => {
    // Measured 2026-09-03. The owner asked "Which and that difference. When do I use which,
    // and when that?" and got three nodes about tense, because `and` is a whole word in the
    // labels `Time and Reality Engine` and `Present, past, and future reference`. Counting
    // structural words on labels was meant to rescue `the`; it let a conjunction outvote the
    // only content word in the question.
    const question = 'Which and that difference. When do I use which, and when that?';
    const labels = findTutorTargets(question).map((node) => node.label);

    expect(labels).not.toContain('Time and Reality Engine');
    expect(labels).not.toContain('Present, past, and future reference');

    // Still a fallback when the query has nothing else in it.
    expect(findTutorTargets('the').map((node) => node.id))
      .toEqual(['mechanics.entity-management.reference-determination.articles']);
  });

  it('V49 answers the relative-pronoun contrast the owner actually asked', () => {
    const forQuery = (query: string): string[] =>
      findTutorTargets(query).map((candidate) => candidate.id);
    const relativeClauses = 'mechanics.structural-assembly.clause-architecture.relative-clauses';

    expect(forQuery('which vs. that')).toEqual([relativeClauses]);
    expect(forQuery('who vs. whom')).toEqual([relativeClauses]);
    // A word outside the table no longer suppresses a contrast whose two sides are known.
    expect(forQuery('which vs. that usages')).toEqual([relativeClauses]);
  });
});
