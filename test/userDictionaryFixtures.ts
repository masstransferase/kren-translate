import type {
  UserDictionaryEntryV1,
  UserDictionaryStoreV1
} from '../src/userDictionary/contract.js';
import { normalizeUserDictionaryTerm } from '../src/userDictionary/normalization.js';

export function userDictionaryEntry(
  overrides: Partial<UserDictionaryEntryV1> = {}
): UserDictionaryEntryV1 {
  const term = overrides.term ?? 'ledger';
  return {
    schemaVersion: 1,
    id: 'entry-ledger',
    term,
    normalizedTerm: normalizeUserDictionaryTerm(term),
    language: 'en',
    entryType: 'noun',
    collection: 'General',
    domains: ['business'],
    tags: ['accounting'],
    pronunciation: {
      display: '/ˈledʒər/',
      audioAvailable: false
    },
    senses: [{
      id: 'sense-1',
      partOfSpeech: 'noun',
      definition: 'A record used to organize transactions.',
      usageNote: 'Used in accounting and distributed systems.',
      synonyms: ['record'],
      antonyms: [],
      relatedTerms: ['journal'],
      examples: ['The transaction was committed to the ledger.']
    }],
    aliases: [],
    capture: {
      mode: 'llmOnly',
      provider: 'gemini',
      model: 'synthetic-model',
      generatedAt: '2026-08-12T01:00:00.000Z',
      userEdited: true
    },
    merriamWebsterReference: {
      referenceWork: 'collegiate',
      lookupTerm: term,
      entryId: 'ledger-1',
      matchStatus: 'matched'
    },
    createdAt: '2026-08-12T01:00:00.000Z',
    updatedAt: '2026-08-12T02:00:00.000Z',
    ...overrides
  };
}

export function representativeUserDictionaryStore(): UserDictionaryStoreV1 {
  return {
    schemaVersion: 1,
    entries: [
      userDictionaryEntry({
        id: 'entry-korean',
        term: '사전',
        normalizedTerm: normalizeUserDictionaryTerm('사전'),
        language: 'ko',
        entryType: '명사',
        senses: [{
          id: 'sense-korean',
          definition: '낱말을 모아 뜻을 설명한 책이나 자료.',
          synonyms: [],
          antonyms: [],
          relatedTerms: ['어휘'],
          examples: ['사전에서 낱말을 찾았다.']
        }]
      }),
      userDictionaryEntry({
        id: 'entry-accented',
        term: 'Café',
        normalizedTerm: normalizeUserDictionaryTerm('Café'),
        language: 'fr',
        entryType: 'noun'
      }),
      userDictionaryEntry({
        id: 'entry-idiom',
        term: 'get   rid\tof',
        normalizedTerm: normalizeUserDictionaryTerm('get   rid\tof'),
        entryType: 'idiom'
      }),
      userDictionaryEntry({
        id: 'entry-technical',
        term: 'compare-and-swap',
        normalizedTerm: normalizeUserDictionaryTerm('compare-and-swap'),
        entryType: 'technical expression',
        domains: ['computer science']
      })
    ]
  };
}

