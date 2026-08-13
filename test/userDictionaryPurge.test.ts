import { describe, expect, it } from 'vitest';
import {
  isUserDictionaryPurgeSelection,
  previewUserDictionaryPurge,
  USER_DICTIONARY_PURGE_SELECTIONS
} from '../src/userDictionary/purge.js';
import { userDictionaryEntry } from './userDictionaryFixtures.js';

describe('User Dictionary purge preview', () => {
  it('derives the guard from all five blueprint selections', () => {
    expect(USER_DICTIONARY_PURGE_SELECTIONS.map((selection) => selection.id)).toEqual([
      'olderThan1Month', 'olderThan3Months', 'olderThan6Months', 'olderThan1Year', 'all'
    ]);
    for (const selection of USER_DICTIONARY_PURGE_SELECTIONS) {
      expect(isUserDictionaryPurgeSelection(selection.id)).toBe(true);
    }
    expect(isUserDictionaryPurgeSelection('olderThan1Week')).toBe(false);
  });

  it('calculates calendar-month cutoffs from updatedAt without mutating the store', () => {
    const old = userDictionaryEntry({ id: 'old', updatedAt: '2026-04-11T12:00:00.000Z' });
    const boundary = userDictionaryEntry({
      id: 'boundary',
      term: 'boundary',
      normalizedTerm: 'boundary',
      updatedAt: '2026-05-12T12:00:00.000Z'
    });
    const recent = userDictionaryEntry({
      id: 'recent',
      term: 'recent',
      normalizedTerm: 'recent',
      updatedAt: '2026-08-01T12:00:00.000Z'
    });
    const store = { schemaVersion: 1 as const, entries: [old, boundary, recent] };
    const before = JSON.stringify(store);
    expect(previewUserDictionaryPurge(
      store,
      'olderThan3Months',
      new Date('2026-08-12T12:00:00.000Z')
    )).toMatchObject({
      cutoff: '2026-05-12T12:00:00.000Z',
      count: 1,
      entryIds: ['old'],
      terms: ['ledger']
    });
    expect(JSON.stringify(store)).toBe(before);
  });

  it('previews remove-all without removing anything', () => {
    const store = { schemaVersion: 1 as const, entries: [userDictionaryEntry()] };
    expect(previewUserDictionaryPurge(store, 'all')).toMatchObject({
      count: 1,
      entryIds: ['entry-ledger'],
      terms: ['ledger']
    });
    expect(store.entries).toHaveLength(1);
  });
});

