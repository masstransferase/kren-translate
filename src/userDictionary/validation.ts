import {
  isMerriamWebsterMatchStatus,
  isMerriamWebsterReferenceWork,
  isUserDictionaryCaptureMode,
  isUserDictionaryProvider,
  USER_DICTIONARY_ENTRY_V1_FIELDS,
  type UserDictionaryEntryV1,
  type UserDictionaryStoreV1
} from './contract.js';
import {
  normalizeUserDictionaryTerm,
  sortUserDictionaryEntries,
  userDictionaryDuplicateKey
} from './normalization.js';

export class UserDictionaryValidationError extends Error {
  public constructor(
    message: string,
    public readonly field?: string,
    public readonly entryId?: string
  ) {
    super(message);
    this.name = 'UserDictionaryValidationError';
  }
}

const ENTRY_FIELDS: ReadonlySet<string> = new Set(USER_DICTIONARY_ENTRY_V1_FIELDS);
const PRONUNCIATION_FIELDS = new Set(['display', 'audioAvailable']);
const SENSE_FIELDS = new Set([
  'id', 'partOfSpeech', 'definition', 'usageNote', 'synonyms', 'antonyms',
  'relatedTerms', 'examples'
]);
const CAPTURE_FIELDS = new Set(['mode', 'provider', 'model', 'generatedAt', 'userEdited']);
const MERRIAM_WEBSTER_FIELDS = new Set([
  'referenceWork', 'lookupTerm', 'entryId', 'matchStatus'
]);
const STORE_FIELDS = new Set(['schemaVersion', 'entries']);

export function validateUserDictionaryEntry(
  value: unknown,
  recordIndex?: number
): UserDictionaryEntryV1 {
  if (!isRecord(value)) throw invalidEntry(undefined, recordIndex);
  const entryId = typeof value.id === 'string' && value.id ? value.id : undefined;
  rejectUnknownFields(value, ENTRY_FIELDS, '', entryId, recordIndex);

  requireLiteralOne(value.schemaVersion, 'schemaVersion', entryId, recordIndex);
  requireNonEmptyString(value.id, 'id', entryId, recordIndex);
  requireNonEmptyString(value.term, 'term', entryId, recordIndex);
  requireNonEmptyString(value.normalizedTerm, 'normalizedTerm', entryId, recordIndex);
  if (typeof value.term === 'string' && typeof value.normalizedTerm === 'string' &&
      value.normalizedTerm !== normalizeUserDictionaryTerm(value.term)) {
    throw invalidField('normalizedTerm', entryId, recordIndex);
  }
  requireNonEmptyString(value.language, 'language', entryId, recordIndex);
  requireNonEmptyString(value.entryType, 'entryType', entryId, recordIndex);
  requireNonEmptyString(value.collection, 'collection', entryId, recordIndex);
  requireStringArray(value.domains, 'domains', entryId, recordIndex);
  requireStringArray(value.tags, 'tags', entryId, recordIndex);

  if (value.pronunciation !== undefined) {
    requireRecord(value.pronunciation, 'pronunciation', entryId, recordIndex);
    rejectUnknownFields(
      value.pronunciation,
      PRONUNCIATION_FIELDS,
      'pronunciation',
      entryId,
      recordIndex
    );
    requireOptionalString(value.pronunciation.display, 'pronunciation.display', entryId, recordIndex);
    requireOptionalBoolean(
      value.pronunciation.audioAvailable,
      'pronunciation.audioAvailable',
      entryId,
      recordIndex
    );
  }

  if (!Array.isArray(value.senses)) throw invalidField('senses', entryId, recordIndex);
  for (const [index, sense] of value.senses.entries()) {
    const field = `senses[${index}]`;
    requireRecord(sense, field, entryId, recordIndex);
    rejectUnknownFields(sense, SENSE_FIELDS, field, entryId, recordIndex);
    requireNonEmptyString(sense.id, `${field}.id`, entryId, recordIndex);
    requireOptionalString(sense.partOfSpeech, `${field}.partOfSpeech`, entryId, recordIndex);
    requireString(sense.definition, `${field}.definition`, entryId, recordIndex);
    requireOptionalString(sense.usageNote, `${field}.usageNote`, entryId, recordIndex);
    requireStringArray(sense.synonyms, `${field}.synonyms`, entryId, recordIndex);
    requireStringArray(sense.antonyms, `${field}.antonyms`, entryId, recordIndex);
    requireStringArray(sense.relatedTerms, `${field}.relatedTerms`, entryId, recordIndex);
    requireStringArray(sense.examples, `${field}.examples`, entryId, recordIndex);
  }

  requireStringArray(value.aliases, 'aliases', entryId, recordIndex);
  requireRecord(value.capture, 'capture', entryId, recordIndex);
  rejectUnknownFields(value.capture, CAPTURE_FIELDS, 'capture', entryId, recordIndex);
  if (!isUserDictionaryCaptureMode(value.capture.mode)) {
    throw invalidField('capture.mode', entryId, recordIndex);
  }
  if (!isUserDictionaryProvider(value.capture.provider)) {
    throw invalidField('capture.provider', entryId, recordIndex);
  }
  requireNonEmptyString(value.capture.model, 'capture.model', entryId, recordIndex);
  requireTimestamp(value.capture.generatedAt, 'capture.generatedAt', entryId, recordIndex);
  requireBoolean(value.capture.userEdited, 'capture.userEdited', entryId, recordIndex);

  if (value.merriamWebsterReference !== undefined) {
    requireRecord(
      value.merriamWebsterReference,
      'merriamWebsterReference',
      entryId,
      recordIndex
    );
    rejectUnknownFields(
      value.merriamWebsterReference,
      MERRIAM_WEBSTER_FIELDS,
      'merriamWebsterReference',
      entryId,
      recordIndex
    );
    if (!isMerriamWebsterReferenceWork(value.merriamWebsterReference.referenceWork)) {
      throw invalidField('merriamWebsterReference.referenceWork', entryId, recordIndex);
    }
    requireNonEmptyString(
      value.merriamWebsterReference.lookupTerm,
      'merriamWebsterReference.lookupTerm',
      entryId,
      recordIndex
    );
    requireOptionalString(
      value.merriamWebsterReference.entryId,
      'merriamWebsterReference.entryId',
      entryId,
      recordIndex
    );
    if (!isMerriamWebsterMatchStatus(value.merriamWebsterReference.matchStatus)) {
      throw invalidField('merriamWebsterReference.matchStatus', entryId, recordIndex);
    }
  }

  requireTimestamp(value.createdAt, 'createdAt', entryId, recordIndex);
  requireTimestamp(value.updatedAt, 'updatedAt', entryId, recordIndex);
  return value as unknown as UserDictionaryEntryV1;
}

export function validateUserDictionaryStore(value: unknown): UserDictionaryStoreV1 {
  if (!isRecord(value)) {
    throw new UserDictionaryValidationError('User Dictionary store has invalid data.');
  }
  rejectUnknownStoreFields(value);
  if (value.schemaVersion !== 1) {
    throw new UserDictionaryValidationError(
      'User Dictionary store has an unsupported schemaVersion.',
      'schemaVersion'
    );
  }
  if (!Array.isArray(value.entries)) {
    throw new UserDictionaryValidationError(
      'User Dictionary store has invalid field "entries".',
      'entries'
    );
  }
  const entries = value.entries.map((entry, index) => validateUserDictionaryEntry(entry, index));
  const keys = new Map<string, string>();
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      throw new UserDictionaryValidationError(
        `User Dictionary store has duplicate entry identifier ${entry.id}.`,
        'id',
        entry.id
      );
    }
    ids.add(entry.id);
    const duplicateKey = userDictionaryDuplicateKey(entry.language, entry.normalizedTerm);
    const previous = keys.get(duplicateKey);
    if (previous !== undefined) {
      throw new UserDictionaryValidationError(
        `User Dictionary entries ${previous} and ${entry.id} have duplicate normalizedTerm fields.`,
        'normalizedTerm',
        entry.id
      );
    }
    keys.set(duplicateKey, entry.id);
  }
  return { schemaVersion: 1, entries };
}

export function canonicalUserDictionaryStore(value: unknown): UserDictionaryStoreV1 {
  const store = validateUserDictionaryStore(value);
  return { schemaVersion: 1, entries: sortUserDictionaryEntries(store.entries) };
}

export function emptyUserDictionaryStore(): UserDictionaryStoreV1 {
  return { schemaVersion: 1, entries: [] };
}

function rejectUnknownStoreFields(value: Record<string, unknown>): void {
  for (const field of Object.keys(value)) {
    if (!STORE_FIELDS.has(field)) {
      throw new UserDictionaryValidationError(
        `User Dictionary store has unknown field "${field}".`,
        field
      );
    }
  }
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  parent: string,
  entryId?: string,
  recordIndex?: number
): void {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      const path = parent ? `${parent}.${field}` : field;
      throw new UserDictionaryValidationError(
        `${entryLabel(entryId, recordIndex)} has unknown field "${path}".`,
        path,
        entryId
      );
    }
  }
}

function requireRecord(
  value: unknown,
  field: string,
  entryId?: string,
  recordIndex?: number
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw invalidField(field, entryId, recordIndex);
}

function requireString(
  value: unknown,
  field: string,
  entryId?: string,
  recordIndex?: number
): asserts value is string {
  if (typeof value !== 'string') throw invalidField(field, entryId, recordIndex);
}

function requireNonEmptyString(
  value: unknown,
  field: string,
  entryId?: string,
  recordIndex?: number
): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw invalidField(field, entryId, recordIndex);
  }
}

function requireOptionalString(
  value: unknown,
  field: string,
  entryId?: string,
  recordIndex?: number
): asserts value is string | undefined {
  if (value !== undefined && typeof value !== 'string') {
    throw invalidField(field, entryId, recordIndex);
  }
}

function requireBoolean(
  value: unknown,
  field: string,
  entryId?: string,
  recordIndex?: number
): asserts value is boolean {
  if (typeof value !== 'boolean') throw invalidField(field, entryId, recordIndex);
}

function requireOptionalBoolean(
  value: unknown,
  field: string,
  entryId?: string,
  recordIndex?: number
): asserts value is boolean | undefined {
  if (value !== undefined && typeof value !== 'boolean') {
    throw invalidField(field, entryId, recordIndex);
  }
}

function requireStringArray(
  value: unknown,
  field: string,
  entryId?: string,
  recordIndex?: number
): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw invalidField(field, entryId, recordIndex);
  }
}

function requireLiteralOne(
  value: unknown,
  field: string,
  entryId?: string,
  recordIndex?: number
): asserts value is 1 {
  if (value !== 1) throw invalidField(field, entryId, recordIndex);
}

function requireTimestamp(
  value: unknown,
  field: string,
  entryId?: string,
  recordIndex?: number
): asserts value is string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw invalidField(field, entryId, recordIndex);
  }
}

function invalidEntry(entryId?: string, recordIndex?: number): UserDictionaryValidationError {
  return new UserDictionaryValidationError(
    `${entryLabel(entryId, recordIndex)} has invalid data.`,
    undefined,
    entryId
  );
}

function invalidField(
  field: string,
  entryId?: string,
  recordIndex?: number
): UserDictionaryValidationError {
  return new UserDictionaryValidationError(
    `${entryLabel(entryId, recordIndex)} has invalid field "${field}".`,
    field,
    entryId
  );
}

function entryLabel(entryId?: string, recordIndex?: number): string {
  if (entryId) return `User Dictionary entry ${entryId}`;
  if (recordIndex !== undefined) return `User Dictionary record ${recordIndex}`;
  return 'User Dictionary entry';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
