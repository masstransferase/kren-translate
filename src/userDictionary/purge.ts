import type { UserDictionaryEntryV1, UserDictionaryStoreV1 } from './contract.js';

export const USER_DICTIONARY_PURGE_SELECTIONS = [
  { id: 'olderThan1Month', months: 1, label: 'Not updated for more than 1 month', strongConfirmation: false },
  { id: 'olderThan3Months', months: 3, label: 'Not updated for more than 3 months', strongConfirmation: false },
  { id: 'olderThan6Months', months: 6, label: 'Not updated for more than 6 months', strongConfirmation: false },
  { id: 'olderThan1Year', months: 12, label: 'Not updated for more than 1 year', strongConfirmation: false },
  { id: 'all', months: undefined, label: 'Remove all entries', strongConfirmation: true }
] as const;

export type UserDictionaryPurgeSelection =
  typeof USER_DICTIONARY_PURGE_SELECTIONS[number]['id'];

export interface UserDictionaryPurgePreview {
  selection: UserDictionaryPurgeSelection;
  cutoff?: string;
  count: number;
  entryIds: string[];
  terms: string[];
}

export function isUserDictionaryPurgeSelection(
  value: unknown
): value is UserDictionaryPurgeSelection {
  return typeof value === 'string' &&
    USER_DICTIONARY_PURGE_SELECTIONS.some((selection) => selection.id === value);
}

export function userDictionaryPurgeSelectionOptions(): Array<[
  UserDictionaryPurgeSelection,
  string
]> {
  return USER_DICTIONARY_PURGE_SELECTIONS.map((selection) => [
    selection.id,
    selection.label
  ]);
}

export function requiresRemoveAllConfirmation(
  selection: UserDictionaryPurgeSelection
): boolean {
  return USER_DICTIONARY_PURGE_SELECTIONS.find((candidate) => candidate.id === selection)
    ?.strongConfirmation ?? false;
}

export function previewUserDictionaryPurge(
  store: UserDictionaryStoreV1,
  selection: UserDictionaryPurgeSelection,
  now: Date = new Date()
): UserDictionaryPurgePreview {
  const definition = USER_DICTIONARY_PURGE_SELECTIONS.find(
    (candidate) => candidate.id === selection
  );
  if (!definition) throw new Error('Invalid User Dictionary purge selection.');

  const cutoff = definition.months === undefined
    ? undefined
    : subtractUtcMonths(now, definition.months);
  const affected = cutoff === undefined
    ? [...store.entries]
    : store.entries.filter((entry) => Date.parse(entry.updatedAt) < cutoff.getTime());
  return {
    selection,
    ...(cutoff ? { cutoff: cutoff.toISOString() } : {}),
    count: affected.length,
    entryIds: affected.map((entry) => entry.id),
    terms: affected.map((entry) => entry.term)
  };
}

export function entriesRemainingAfterPurge(
  store: UserDictionaryStoreV1,
  preview: UserDictionaryPurgePreview
): UserDictionaryEntryV1[] {
  const removed = new Set(preview.entryIds);
  return store.entries.filter((entry) => !removed.has(entry.id));
}

function subtractUtcMonths(value: Date, months: number): Date {
  const targetMonth = value.getUTCFullYear() * 12 + value.getUTCMonth() - months;
  const year = Math.floor(targetMonth / 12);
  const month = targetMonth - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    year,
    month,
    Math.min(value.getUTCDate(), lastDay),
    value.getUTCHours(),
    value.getUTCMinutes(),
    value.getUTCSeconds(),
    value.getUTCMilliseconds()
  ));
}
