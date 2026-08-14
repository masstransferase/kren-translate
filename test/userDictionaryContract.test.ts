import { describe, expect, it } from 'vitest';
import {
  isMerriamWebsterMatchStatus,
  isMerriamWebsterReferenceWork,
  isUserDictionaryCaptureMode,
  isUserDictionaryProvider,
  MERRIAM_WEBSTER_MATCH_STATUSES,
  MERRIAM_WEBSTER_REFERENCE_WORKS,
  USER_DICTIONARY_CAPTURE_MODES,
  USER_DICTIONARY_ENTRY_V1_FIELDS,
  USER_DICTIONARY_PROVIDERS
} from '../src/userDictionary/contract.js';
import {
  findUserDictionaryDuplicate,
  normalizeUserDictionaryTerm,
  sortUserDictionaryEntries,
  userDictionaryDuplicateKey
} from '../src/userDictionary/normalization.js';
import {
  canonicalUserDictionaryStore,
  validateUserDictionaryEntry,
  UserDictionaryValidationError
} from '../src/userDictionary/validation.js';
import { userDictionaryEntry } from './userDictionaryFixtures.js';

describe('User Dictionary version 1 contract', () => {
  it('matches every Section 5 entry field name exactly', () => {
    expect(Object.keys(userDictionaryEntry()).sort()).toEqual(
      [...USER_DICTIONARY_ENTRY_V1_FIELDS].sort()
    );
    expect(USER_DICTIONARY_ENTRY_V1_FIELDS).toEqual([
      'schemaVersion', 'id', 'term', 'normalizedTerm', 'language', 'entryType',
      'collection', 'domains', 'tags', 'pronunciation', 'senses', 'aliases',
      'capture', 'merriamWebsterReference', 'createdAt', 'updatedAt'
    ]);
  });

  it('derives every closed-set guard from its single source array', () => {
    for (const value of USER_DICTIONARY_CAPTURE_MODES) {
      expect(isUserDictionaryCaptureMode(value)).toBe(true);
    }
    for (const value of USER_DICTIONARY_PROVIDERS) {
      expect(isUserDictionaryProvider(value)).toBe(true);
    }
    for (const value of MERRIAM_WEBSTER_REFERENCE_WORKS) {
      expect(isMerriamWebsterReferenceWork(value)).toBe(true);
    }
    for (const value of MERRIAM_WEBSTER_MATCH_STATUSES) {
      expect(isMerriamWebsterMatchStatus(value)).toBe(true);
    }
    expect(isUserDictionaryCaptureMode('recording')).toBe(false);
    expect(isUserDictionaryProvider('unknown')).toBe(false);
    expect(isMerriamWebsterReferenceWork('medical')).toBe(false);
    expect(isMerriamWebsterMatchStatus('failed')).toBe(false);
  });

  it('accepts the complete blueprint entry shape', () => {
    expect(validateUserDictionaryEntry(userDictionaryEntry())).toEqual(userDictionaryEntry());
  });

  it('rejects an unknown entry field by name without echoing its value', () => {
    const unsafeValue = 'private definition that must not be echoed';
    const candidate = { ...userDictionaryEntry(), rawModelResponse: unsafeValue };
    let failure: unknown;
    try {
      validateUserDictionaryEntry(candidate);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(UserDictionaryValidationError);
    expect((failure as Error).message).toContain('rawModelResponse');
    expect((failure as Error).message).not.toContain(unsafeValue);
  });

  it('rejects unknown nested fields as well as top-level fields', () => {
    const candidate = userDictionaryEntry({
      capture: {
        ...userDictionaryEntry().capture,
        completePrompt: 'content that must not be persisted'
      } as never
    });
    expect(() => validateUserDictionaryEntry(candidate)).toThrow('capture.completePrompt');
  });

  it.each([
    'apiKey',
    'completePrompt',
    'rawMerriamWebsterResponse',
    'rawModelResponse',
    'surroundingDocumentText',
    'fileName',
    'workspacePath',
    'documentIdentifier',
    'selectionLocation',
    'hiddenContextEntries'
  ])('rejects forbidden persisted field %s', (field) => {
    expect(() => validateUserDictionaryEntry({
      ...userDictionaryEntry(),
      [field]: 'not persisted'
    })).toThrow(field);
  });

  it('rejects a normalizedTerm that was not derived from term', () => {
    expect(() => validateUserDictionaryEntry(userDictionaryEntry({
      normalizedTerm: 'different'
    }))).toThrow('normalizedTerm');
  });

  it('rejects duplicate normalized terms in the same language in a store', () => {
    expect(() => canonicalUserDictionaryStore({
      schemaVersion: 1,
      entries: [
        userDictionaryEntry({ id: 'first' }),
        userDictionaryEntry({ id: 'second' })
      ]
    })).toThrow('duplicate normalizedTerm');
  });

  it('allows the same normalized term in distinct full language tags', () => {
    expect(canonicalUserDictionaryStore({
      schemaVersion: 1,
      entries: [
        userDictionaryEntry({ id: 'english', language: 'en' }),
        userDictionaryEntry({ id: 'american-english', language: 'en-US' })
      ]
    }).entries.map((entry) => entry.id)).toEqual(['american-english', 'english']);
  });

  it('rejects duplicate entry identifiers even when terms differ', () => {
    expect(() => canonicalUserDictionaryStore({
      schemaVersion: 1,
      entries: [
        userDictionaryEntry({ id: 'same-id' }),
        userDictionaryEntry({
          id: 'same-id',
          term: 'different',
          normalizedTerm: 'different'
        })
      ]
    })).toThrow('duplicate entry identifier');
  });
});

describe('User Dictionary normalization and duplicates', () => {
  it('preserves Korean while normalizing surrounding whitespace', () => {
    expect(normalizeUserDictionaryTerm('  사전\u3000')).toBe('사전');
  });

  it('detects terms that differ only by case', () => {
    const entry = userDictionaryEntry({ term: 'Ledger', normalizedTerm: 'ledger' });
    expect(findUserDictionaryDuplicate([entry], 'en', 'LEDGER')?.id).toBe(entry.id);
  });

  it('detects idioms that differ only by irregular Unicode spacing', () => {
    const entry = userDictionaryEntry({
      term: 'get   rid\tof',
      normalizedTerm: 'get rid of'
    });
    expect(findUserDictionaryDuplicate([entry], 'en', ' get\u00a0rid  of ')?.id).toBe(entry.id);
  });

  it('detects accented terms that differ by Unicode normalization form', () => {
    const entry = userDictionaryEntry({
      term: 'Café',
      normalizedTerm: 'café',
      language: 'fr'
    });
    expect(findUserDictionaryDuplicate([entry], 'fr', 'CAFE\u0301')?.id).toBe(entry.id);
  });

  it('uses the full lowercased language tag in the duplicate key', () => {
    expect(userDictionaryDuplicateKey('EN-us', 'Ledger')).toBe('en-us\u0000ledger');
    expect(userDictionaryDuplicateKey('en', 'Ledger')).not.toBe(
      userDictionaryDuplicateKey('en-US', 'Ledger')
    );
  });

  it('does not merge the same spelling in different languages', () => {
    const entry = userDictionaryEntry({ language: 'en' });
    expect(findUserDictionaryDuplicate([entry], 'fr', 'ledger')).toBeUndefined();
  });

  it('sorts by normalized term without mutating the input', () => {
    const later = userDictionaryEntry({ id: 'later', term: 'Zulu', normalizedTerm: 'zulu' });
    const earlier = userDictionaryEntry({ id: 'earlier', term: 'Alpha', normalizedTerm: 'alpha' });
    const input = [later, earlier];
    expect(sortUserDictionaryEntries(input).map((entry) => entry.id)).toEqual(['earlier', 'later']);
    expect(input.map((entry) => entry.id)).toEqual(['later', 'earlier']);
  });
});
