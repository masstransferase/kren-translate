import type { UserDictionaryEntryV1 } from './contract.js';

/**
 * Duplicate keys use Unicode NFKC normalization, trim leading and trailing Unicode
 * whitespace, collapse every internal Unicode whitespace run to one ASCII space,
 * then apply locale-independent Unicode lowercasing. The display term is unchanged.
 */
export function normalizeUserDictionaryTerm(term: string): string {
  return term.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('und');
}

export function userDictionaryDuplicateKey(language: string, term: string): string {
  return `${language.toLowerCase()}\u0000${normalizeUserDictionaryTerm(term)}`;
}

export function findUserDictionaryDuplicate(
  entries: readonly UserDictionaryEntryV1[],
  language: string,
  term: string,
  excludedEntryId?: string
): UserDictionaryEntryV1 | undefined {
  const key = userDictionaryDuplicateKey(language, term);
  return entries.find((entry) =>
    entry.id !== excludedEntryId &&
    userDictionaryDuplicateKey(entry.language, entry.normalizedTerm) === key
  );
}

export function compareUserDictionaryEntries(
  left: UserDictionaryEntryV1,
  right: UserDictionaryEntryV1
): number {
  if (left.normalizedTerm < right.normalizedTerm) return -1;
  if (left.normalizedTerm > right.normalizedTerm) return 1;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

export function sortUserDictionaryEntries(
  entries: readonly UserDictionaryEntryV1[]
): UserDictionaryEntryV1[] {
  return [...entries].sort(compareUserDictionaryEntries);
}
