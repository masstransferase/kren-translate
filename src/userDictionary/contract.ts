export const USER_DICTIONARY_CAPTURE_MODES = [
  'llmOnly',
  'merriamWebsterAndLlm'
] as const;

export type UserDictionaryCaptureMode = typeof USER_DICTIONARY_CAPTURE_MODES[number];

export const USER_DICTIONARY_PROVIDERS = [
  'gemini',
  'openai',
  'anthropic'
] as const;

export type UserDictionaryProvider = typeof USER_DICTIONARY_PROVIDERS[number];

export const MERRIAM_WEBSTER_REFERENCE_WORKS = ['collegiate'] as const;

export type MerriamWebsterReferenceWork = typeof MERRIAM_WEBSTER_REFERENCE_WORKS[number];

export const MERRIAM_WEBSTER_MATCH_STATUSES = [
  'matched',
  'noMatch',
  'notQueried'
] as const;

export type MerriamWebsterMatchStatus = typeof MERRIAM_WEBSTER_MATCH_STATUSES[number];

export const USER_DICTIONARY_ENTRY_V1_FIELDS = [
  'schemaVersion',
  'id',
  'term',
  'normalizedTerm',
  'language',
  'entryType',
  'collection',
  'domains',
  'tags',
  'pronunciation',
  'senses',
  'aliases',
  'capture',
  'merriamWebsterReference',
  'createdAt',
  'updatedAt'
] as const;

export interface UserDictionaryEntryV1 {
  schemaVersion: 1;
  id: string;
  term: string;
  normalizedTerm: string;
  language: string;
  entryType: string;
  collection: string;
  domains: string[];
  tags: string[];
  pronunciation?: {
    display?: string;
    audioAvailable?: boolean;
  };
  senses: Array<{
    id: string;
    partOfSpeech?: string;
    definition: string;
    usageNote?: string;
    synonyms: string[];
    antonyms: string[];
    relatedTerms: string[];
    examples: string[];
  }>;
  aliases: string[];
  capture: {
    mode: UserDictionaryCaptureMode;
    provider: UserDictionaryProvider;
    model: string;
    generatedAt: string;
    userEdited: boolean;
  };
  merriamWebsterReference?: {
    referenceWork: MerriamWebsterReferenceWork;
    lookupTerm: string;
    entryId?: string;
    matchStatus: MerriamWebsterMatchStatus;
  };
  createdAt: string;
  updatedAt: string;
}

export interface UserDictionaryStoreV1 {
  schemaVersion: 1;
  entries: UserDictionaryEntryV1[];
}

function isClosedValue<T extends readonly string[]>(
  values: T,
  value: unknown
): value is T[number] {
  return typeof value === 'string' && values.some((candidate) => candidate === value);
}

export const isUserDictionaryCaptureMode = (
  value: unknown
): value is UserDictionaryCaptureMode => isClosedValue(USER_DICTIONARY_CAPTURE_MODES, value);

export const isUserDictionaryProvider = (
  value: unknown
): value is UserDictionaryProvider => isClosedValue(USER_DICTIONARY_PROVIDERS, value);

export const isMerriamWebsterReferenceWork = (
  value: unknown
): value is MerriamWebsterReferenceWork => isClosedValue(MERRIAM_WEBSTER_REFERENCE_WORKS, value);

export const isMerriamWebsterMatchStatus = (
  value: unknown
): value is MerriamWebsterMatchStatus => isClosedValue(MERRIAM_WEBSTER_MATCH_STATUSES, value);

