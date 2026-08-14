import { createHash } from 'node:crypto';
import type { UserDictionaryEntryV1, UserDictionaryStoreV1 } from './contract.js';
import type { UserDictionaryExportFormat } from './lifecycle.js';
import {
  normalizeUserDictionaryTerm,
  userDictionaryDuplicateKey
} from './normalization.js';
import {
  canonicalUserDictionaryStore,
  validateUserDictionaryEntry,
  validateUserDictionaryStore,
  UserDictionaryValidationError
} from './validation.js';

export class UserDictionaryImportError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'UserDictionaryImportError';
  }
}

export interface UserDictionaryInvalidImportRecord {
  recordIndex: number;
  entryId?: string;
  field?: string;
}

export const USER_DICTIONARY_IMPORT_DUPLICATE_SOURCES = ['import', 'store'] as const;

export type UserDictionaryImportDuplicateSource =
  typeof USER_DICTIONARY_IMPORT_DUPLICATE_SOURCES[number];

export interface UserDictionaryImportDuplicate {
  recordIndex: number;
  entryId: string;
  duplicateEntryId: string;
  source: UserDictionaryImportDuplicateSource;
}

export interface UserDictionaryImportPreview {
  currentEntryCount: number;
  entryCount: number;
  validEntryCount: number;
  duplicateCount: number;
  invalidRecordCount: number;
  proposedAddCount: number;
  storeDuplicateCount: number;
  duplicates: UserDictionaryImportDuplicate[];
  invalidRecords: UserDictionaryInvalidImportRecord[];
  entries: UserDictionaryEntryV1[];
}

export const USER_DICTIONARY_IMPORT_DECISION_MODES = ['cancel', 'replace', 'merge'] as const;
export type UserDictionaryImportDecisionMode =
  typeof USER_DICTIONARY_IMPORT_DECISION_MODES[number];

export const USER_DICTIONARY_IMPORT_DUPLICATE_STRATEGIES = [
  'keepExisting',
  'replaceExisting'
] as const;
export type UserDictionaryImportDuplicateStrategy =
  typeof USER_DICTIONARY_IMPORT_DUPLICATE_STRATEGIES[number];

export type UserDictionaryImportDecision =
  | { mode: typeof USER_DICTIONARY_IMPORT_DECISION_MODES[0] }
  | { mode: typeof USER_DICTIONARY_IMPORT_DECISION_MODES[1] }
  | {
    mode: typeof USER_DICTIONARY_IMPORT_DECISION_MODES[2];
    duplicateStrategy: UserDictionaryImportDuplicateStrategy;
  };

export function exportUserDictionaryJson(store: UserDictionaryStoreV1): string {
  return `${JSON.stringify(canonicalUserDictionaryStore(store), null, 2)}\n`;
}

export function exportUserDictionaryMarkdown(store: UserDictionaryStoreV1): string {
  const canonical = canonicalUserDictionaryStore(store);
  const entries = canonical.entries.map((entry, entryIndex) => {
    const senses = entry.senses.map((sense, senseIndex) => [
      `### Meaning ${senseIndex + 1}`,
      markdownField('Part of speech', sense.partOfSpeech ?? ''),
      markdownField('Definition', sense.definition),
      markdownField('Usage note', sense.usageNote ?? ''),
      markdownField('Synonyms', sense.synonyms),
      markdownField('Antonyms', sense.antonyms),
      markdownField('Related terms', sense.relatedTerms),
      markdownField('Examples', sense.examples)
    ].join('\n')).join('\n\n');
    return [
      `## Entry ${entryIndex + 1}`,
      markdownField('Term', entry.term),
      markdownField('Language', entry.language),
      markdownField('Entry type', entry.entryType),
      markdownField('Collection', entry.collection),
      markdownField('Domains', entry.domains),
      markdownField('Tags', entry.tags),
      markdownField('Aliases', entry.aliases),
      senses
    ].join('\n');
  }).join('\n\n');
  return [
    '# KREN User Dictionary',
    '',
    '> Human-readable export. This Markdown is lossy by design. Use JSON for lossless backup and restore.',
    '',
    entries,
    ''
  ].join('\n');
}

export function previewUserDictionaryImportDocument(
  content: string,
  format: UserDictionaryExportFormat,
  currentStore: UserDictionaryStoreV1
): UserDictionaryImportPreview {
  return format === 'json'
    ? previewUserDictionaryImport(content, currentStore)
    : previewUserDictionaryMarkdownImport(content, currentStore);
}

export function previewUserDictionaryMarkdownImport(
  content: string,
  currentStore: UserDictionaryStoreV1
): UserDictionaryImportPreview {
  rejectUnexpectedImportContent(content);
  const sections = content.split(/^## Entry \d+\s*$/gmu).slice(1);
  if (sections.length === 0) {
    if (/^# KREN User Dictionary\s*$/mu.test(content)) {
      return previewUserDictionaryImport(
        JSON.stringify({ schemaVersion: 1, entries: [] }),
        currentStore
      );
    }
    throw new UserDictionaryImportError('Markdown import contains no KREN entry sections.');
  }
  const entries = sections.map((section, index) => markdownEntry(section, index));
  return previewUserDictionaryImport(JSON.stringify({ schemaVersion: 1, entries }), currentStore);
}

export function previewUserDictionaryImport(
  content: string,
  currentStore: UserDictionaryStoreV1
): UserDictionaryImportPreview {
  validateUserDictionaryStore(currentStore);
  const parsed = parseImportDocument(content);
  rejectUnexpectedImportContent(parsed);
  if (!isRecord(parsed)) throw new UserDictionaryImportError('Import has invalid top-level data.');
  rejectUnknownTopLevelFields(parsed);
  if (parsed.schemaVersion !== 1) {
    const version = typeof parsed.schemaVersion === 'number'
      ? String(parsed.schemaVersion)
      : 'invalid';
    throw new UserDictionaryImportError(
      `Import schemaVersion ${version} is not supported by this version of KREN. Nothing was imported.`
    );
  }
  if (!Array.isArray(parsed.entries)) {
    throw new UserDictionaryImportError('Import has invalid field "entries".');
  }

  const entries: UserDictionaryEntryV1[] = [];
  const invalidRecords: UserDictionaryInvalidImportRecord[] = [];
  for (const [recordIndex, candidate] of parsed.entries.entries()) {
    try {
      entries.push(validateUserDictionaryEntry(candidate, recordIndex));
    } catch (error) {
      if (!(error instanceof UserDictionaryValidationError)) throw error;
      invalidRecords.push({
        recordIndex,
        ...(error.entryId ? { entryId: error.entryId } : {}),
        ...(error.field ? { field: error.field } : {})
      });
    }
  }

  const duplicates: UserDictionaryImportDuplicate[] = [];
  const importedKeys = new Map<string, { entryId: string; recordIndex: number }>();
  const existingKeys = new Map(
    currentStore.entries.map((entry) => [entryDuplicateKey(entry), entry.id] as const)
  );
  // Built once rather than calling parsed.entries.indexOf(entry) inside the loop, which
  // made duplicate detection quadratic. A 20,000-entry import is a realistic backup
  // restore, not an adversarial case, and the user picks the file so there is no attacker
  // here; it was simply slow for no reason. Keyed by object identity because
  // validateUserDictionaryEntry returns the original reference.
  const recordIndexes = new Map<unknown, number>();
  parsed.entries.forEach((record, index) => {
    if (!recordIndexes.has(record)) recordIndexes.set(record, index);
  });
  for (const entry of entries) {
    const recordIndex = recordIndexes.get(entry) ?? -1;
    const duplicateKey = entryDuplicateKey(entry);
    const imported = importedKeys.get(duplicateKey);
    if (imported) {
      duplicates.push({
        recordIndex,
        entryId: entry.id,
        duplicateEntryId: imported.entryId,
        source: 'import'
      });
    } else {
      importedKeys.set(duplicateKey, { entryId: entry.id, recordIndex });
    }
    const existingEntryId = existingKeys.get(duplicateKey);
    if (existingEntryId !== undefined) {
      duplicates.push({
        recordIndex,
        entryId: entry.id,
        duplicateEntryId: existingEntryId,
        source: 'store'
      });
    }
  }

  return {
    currentEntryCount: currentStore.entries.length,
    entryCount: parsed.entries.length,
    validEntryCount: entries.length,
    duplicateCount: duplicates.length,
    invalidRecordCount: invalidRecords.length,
    proposedAddCount: new Set(entries
      .filter((entry) => !existingKeys.has(entryDuplicateKey(entry)))
      .map((entry) => entryDuplicateKey(entry))).size,
    storeDuplicateCount: duplicates.filter((duplicate) => duplicate.source === 'store').length,
    duplicates,
    invalidRecords,
    entries
  };
}

export function applyUserDictionaryImport(
  currentStore: UserDictionaryStoreV1,
  preview: UserDictionaryImportPreview,
  decision: UserDictionaryImportDecision
): UserDictionaryStoreV1 {
  const current = canonicalUserDictionaryStore(currentStore);
  if (decision.mode === 'cancel') return current;
  if (preview.invalidRecordCount > 0) {
    throw new UserDictionaryImportError(
      `Import was not applied because ${preview.invalidRecordCount} records are invalid.`
    );
  }
  const importDuplicates = preview.duplicates.filter((duplicate) => duplicate.source === 'import');
  if (importDuplicates.length > 0) {
    throw new UserDictionaryImportError(
      `Import was not applied because ${importDuplicates.length} duplicate records occur in the import.`
    );
  }
  const incoming = preview.entries.map((entry, index) =>
    validateUserDictionaryEntry(entry, index)
  );

  if (decision.mode === 'replace') {
    return canonicalUserDictionaryStore({ schemaVersion: 1, entries: incoming });
  }

  const byKey = new Map(
    current.entries.map((entry) => [entryDuplicateKey(entry), entry] as const)
  );
  for (const entry of incoming) {
    const duplicateKey = entryDuplicateKey(entry);
    if (!byKey.has(duplicateKey) || decision.duplicateStrategy === 'replaceExisting') {
      byKey.set(duplicateKey, entry);
    }
  }
  return canonicalUserDictionaryStore({ schemaVersion: 1, entries: [...byKey.values()] });
}

function entryDuplicateKey(entry: UserDictionaryEntryV1): string {
  return userDictionaryDuplicateKey(entry.language, entry.normalizedTerm);
}

export function importUserDictionaryJson(content: string): UserDictionaryStoreV1 {
  const preview = previewUserDictionaryImport(content, { schemaVersion: 1, entries: [] });
  return applyUserDictionaryImport(
    { schemaVersion: 1, entries: [] },
    preview,
    { mode: 'replace' }
  );
}

export function importUserDictionaryMarkdown(content: string): UserDictionaryStoreV1 {
  const preview = previewUserDictionaryMarkdownImport(
    content,
    { schemaVersion: 1, entries: [] }
  );
  return applyUserDictionaryImport(
    { schemaVersion: 1, entries: [] },
    preview,
    { mode: 'replace' }
  );
}

function markdownField(label: string, value: string | readonly string[]): string {
  return `- ${label}: ${JSON.stringify(value)}`;
}

function markdownEntry(section: string, index: number): unknown {
  const parts = section.split(/^### Meaning \d+\s*$/gmu);
  const fields = parts.shift() ?? '';
  const term = markdownStringField(fields, 'Term');
  const digest = createHash('sha256')
    .update(`${index}\u0000${term}\u0000${section}`)
    .digest('hex')
    .slice(0, 24);
  return {
    schemaVersion: 1,
    id: `markdown-${digest}`,
    term,
    normalizedTerm: normalizeUserDictionaryTerm(term),
    language: markdownStringField(fields, 'Language'),
    entryType: markdownStringField(fields, 'Entry type'),
    collection: markdownStringField(fields, 'Collection'),
    domains: markdownStringArrayField(fields, 'Domains'),
    tags: markdownStringArrayField(fields, 'Tags'),
    senses: parts.map((sense, senseIndex) => ({
      id: `markdown-${digest}-sense-${senseIndex + 1}`,
      ...(markdownStringField(sense, 'Part of speech')
        ? { partOfSpeech: markdownStringField(sense, 'Part of speech') }
        : {}),
      definition: markdownStringField(sense, 'Definition'),
      ...(markdownStringField(sense, 'Usage note')
        ? { usageNote: markdownStringField(sense, 'Usage note') }
        : {}),
      synonyms: markdownStringArrayField(sense, 'Synonyms'),
      antonyms: markdownStringArrayField(sense, 'Antonyms'),
      relatedTerms: markdownStringArrayField(sense, 'Related terms'),
      examples: markdownStringArrayField(sense, 'Examples')
    })),
    aliases: markdownStringArrayField(fields, 'Aliases'),
    capture: {
      mode: 'llmOnly',
      provider: 'gemini',
      model: 'markdown-import',
      generatedAt: '1970-01-01T00:00:00.000Z',
      userEdited: true
    },
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z'
  };
}

function markdownStringField(section: string, label: string): string {
  const value = markdownFieldValue(section, label);
  if (value === undefined) return '';
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'string' ? parsed : '';
  } catch {
    return '';
  }
}

function markdownStringArrayField(section: string, label: string): string[] {
  const value = markdownFieldValue(section, label);
  if (value === undefined) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function markdownFieldValue(section: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return section.match(new RegExp(`^- ${escaped}: (.+)$`, 'mu'))?.[1];
}

function parseImportDocument(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new UserDictionaryImportError('Import contains invalid JSON.');
  }
}

function rejectUnknownTopLevelFields(value: Record<string, unknown>): void {
  for (const field of Object.keys(value)) {
    if (field !== 'schemaVersion' && field !== 'entries') {
      throw new UserDictionaryImportError(`Import has unknown field "${field}".`);
    }
  }
}

function rejectUnexpectedImportContent(value: unknown): void {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (typeof candidate === 'string' && hasExecutableOrHtmlContent(candidate)) {
      throw new UserDictionaryImportError('Import contains unexpected executable or HTML content.');
    }
    if (Array.isArray(candidate)) {
      pending.push(...candidate);
    } else if (isRecord(candidate)) {
      pending.push(...Object.keys(candidate), ...Object.values(candidate));
    }
  }
}

function hasExecutableOrHtmlContent(value: string): boolean {
  return /<\/?(?:script|iframe|html|body|img|svg|object|embed|link|meta|style|form|input|button|div|span|a)(?:\s|>|\/)/iu.test(value) ||
    /(?:javascript|vbscript)\s*:/iu.test(value) ||
    /data\s*:\s*text\/html/iu.test(value) ||
    /\bon(?:error|load|click|mouseover|focus)\s*=/iu.test(value) ||
    /^\s*#!/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
