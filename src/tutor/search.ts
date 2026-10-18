import { TUTOR_MAP, type TrainingMapNode } from '@kren/core/tutor';

const MAXIMUM_TUTOR_SEARCH_RESULTS = 3;
const SEARCH_SEPARATOR = /\b(?:vs\.?|versus)\b/giu;
const HAS_SEARCH_SEPARATOR = /\b(?:vs\.?|versus)\b/iu;
const SEARCH_WORD = /[\p{L}\p{N}]+(?:['\u2019][\p{L}\p{N}]+)*/gu;

/*
 * These are shared grammatical subjects, not synonyms for the words. A comparison such
 * as "what vs. that" names two clause markers while the map labels the teachable subjects
 * they share. Intersecting the local relations for both sides adds only subjects that
 * explain the comparison as a whole. Ordinary queries receive no expansion.
 */
const COMPARISON_SUBJECTS: Readonly<Record<string, readonly string[]>> = {
  what: ['noun clause', 'relative clause'],
  that: ['noun clause', 'relative clause'],
  // The relative pronouns, added 2026-09-02 after `which vs. that` returned nothing. They
  // are a real grammatical set rather than another single entry for a single query, which
  // is what the two above were: they served `what vs. that` and the next comparison the
  // owner tried fell straight through. The table still cannot grow to cover English, and
  // it is not meant to. It is a stopgap until a model reads the question.
  which: ['relative clause'],
  who: ['relative clause'],
  whom: ['relative clause'],
  whose: ['relative clause']
};

interface RankedTutorTarget {
  node: TrainingMapNode;
  mapIndex: number;
  highestField: number;
  matchedTerms: number;
  weightedHits: number;
}

/**
 * Finds the three strongest local learning-map matches for one deliberate query.
 *
 * Keeping this as one query-in, candidates-out seam lets a later implementation replace
 * the local ranker without changing the controller or its candidate queue.
 */
export function findTutorTargets(query: string): TrainingMapNode[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];

  return TUTOR_MAP
    .map((node, mapIndex) => rankNode(node, mapIndex, terms))
    .filter((candidate): candidate is RankedTutorTarget => candidate !== undefined)
    .sort(compareRankedTargets)
    .slice(0, MAXIMUM_TUTOR_SEARCH_RESULTS)
    .map((candidate) => candidate.node);
}

function searchTerms(query: string): string[] {
  const normalized = query.normalize('NFKC').toLocaleLowerCase();
  const words = normalized
    .replace(SEARCH_SEPARATOR, ' ')
    .match(SEARCH_WORD) ?? [];
  const distinct = [...new Set(words)];
  if (!HAS_SEARCH_SEPARATOR.test(normalized) || distinct.length < 2) return distinct;
  // Intersect the sides that are known and ignore the rest, rather than abandoning the
  // expansion the moment one word is unrecognised. The owner's query was
  // `which vs. that usages`, and requiring every term to be a known comparison subject let
  // the trailing `usages` suppress a contrast both of whose sides were understood.
  const related = distinct
    .map((term) => COMPARISON_SUBJECTS[term])
    .filter((subjects): subjects is readonly string[] => subjects !== undefined);
  if (related.length < 2) return distinct;
  const shared = related[0]!.filter((subject) =>
    related.slice(1).every((subjects) => subjects.includes(subject))
  );
  return [...distinct, ...shared];
}

/*
 * A term matches a field as a substring, or as its singular form.
 *
 * Substring alone is one-directional: a singular query finds a plural field because the
 * shorter string sits inside the longer one, and a plural query finds nothing. The map is
 * written in the singular, so `articles` returned no result at all while the node labelled
 * `A/an, the, and zero article` sat in it. That is the ordinary way a reader names a
 * grammar subject, and it was the one shape the search could not answer.
 *
 * Only trailing `s` and `es` are stripped, and only from a term of four letters or more, so
 * `as` does not become `a` and match everything. This is deliberately not a stemmer: a real
 * one would also fold `running` to `run` and is a dependency this does not need.
 */
/*
 * The words a grammar learner asks about are the words every description is written in.
 *
 * Measured on 2026-09-02, after the owner asked about `which vs. that usages` and was given
 * three targets about tense, clause linking, and conditionals. All three came from the bare
 * word `that`, which appears in the prose of 28 of the 123 nodes. `which vs. that`, `that`
 * alone, and the owner's full question all returned the same three nodes, so every other
 * word in the question changed nothing.
 *
 * These words therefore match a node's label only, where their presence means the node is
 * about the word, and never its description or example, where their presence means the
 * sentence happened to be written in English. This is the smallest change that stops the
 * search answering confidently and wrongly; it does not make it answer correctly, because
 * knowing that `which vs. that` is about relative clauses is meaning rather than spelling.
 */
const STRUCTURAL_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'by', 'for',
  'with', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'have',
  'has', 'had', 'it', 'its', 'this', 'these', 'those', 'i', 'you', 'we', 'they', 'he',
  'she', 'not', 'no', 'so', 'than', 'then', 'when', 'where', 'why', 'how', 'use', 'used',
  'using', 'usage', 'usages', 'that', 'which', 'what', 'who', 'whom', 'whose'
]);

export function isStructuralWord(term: string): boolean {
  return STRUCTURAL_WORDS.has(term);
}

/*
 * Whether a field contains the term as a whole word.
 *
 * Only structural words use this. `the` names the node `A/an, the, and zero article` and
 * says nothing about `Real vs. hypothetical meaning`, yet a substring test cannot tell the
 * two apart because `hypothetical` contains `the`.
 */
function containsWord(field: string, term: string): boolean {
  let from = field.indexOf(term);
  while (from !== -1) {
    const before = from === 0 ? '' : field[from - 1]!;
    const after = field[from + term.length] ?? '';
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
    from = field.indexOf(term, from + 1);
  }
  return false;
}

function matchesField(field: string, term: string): boolean {
  if (field.includes(term)) return true;
  if (term.length < 4) return false;
  if (term.endsWith('es') && field.includes(term.slice(0, -2))) return true;
  return term.endsWith('s') && field.includes(term.slice(0, -1));
}

function rankNode(
  node: TrainingMapNode,
  mapIndex: number,
  terms: readonly string[]
): RankedTutorTarget | undefined {
  const fields = [node.label, node.description, node.exampleSeed ?? '']
    .map((value) => value.normalize('NFKC').toLocaleLowerCase());
  // Index 0 is the label. A structural word counts there and nowhere else, and only as a
  // whole word: as a substring, `the` matches `hypothetical` and the noise comes straight
  // back in through the one field that was supposed to be reliable.
  /*
   * A structural word counts only when the query is nothing but structural words.
   *
   * Letting them count on a label alongside content words was a regression, measured on
   * 2026-09-03: the owner asked "Which and that difference. When do I use which, and when
   * that?" and got three nodes about tense, because `and` is a whole word in the labels
   * `Time and Reality Engine` and `Present, past, and future reference`. The one content
   * word in the question, `difference`, was outvoted by a conjunction.
   *
   * So they are a fallback, not a contribution: `the` alone still finds the articles node,
   * and `which vs. that` still resolves, because its expansion adds `relative clause`,
   * which is not structural and carries the query on its own.
   */
  const structuralOnly = terms.every((term) => isStructuralWord(term));
  const hits = fields.map((field, fieldIndex) => terms.filter((term) => {
    if (!isStructuralWord(term)) return matchesField(field, term);
    return structuralOnly && fieldIndex === 0 && containsWord(field, term);
  }));
  const highestField = hits[0]!.length > 0 ? 3 : hits[1]!.length > 0 ? 2 : hits[2]!.length > 0 ? 1 : 0;
  if (highestField === 0) return undefined;
  const matchedTerms = new Set(hits.flat()).size;
  const weightedHits = hits[0]!.length * 100 + hits[1]!.length * 10 + hits[2]!.length;
  return { node, mapIndex, highestField, matchedTerms, weightedHits };
}

function compareRankedTargets(first: RankedTutorTarget, second: RankedTutorTarget): number {
  return second.highestField - first.highestField ||
    second.matchedTerms - first.matchedTerms ||
    second.weightedHits - first.weightedHits ||
    first.mapIndex - second.mapIndex;
}
