import type {
  UserDictionaryCaptureMode,
  UserDictionaryEntryV1
} from './contract.js';
import { sortUserDictionaryEntries } from './normalization.js';

interface UserDictionaryOption<T extends string> {
  id: T;
  label: string;
}

export const USER_DICTIONARY_SOURCE_FILTERS = [
  { id: 'all', label: 'All sources' },
  { id: 'withMerriamWebster', label: 'With Merriam-Webster source' },
  { id: 'withoutMerriamWebster', label: 'Without Merriam-Webster source' }
] as const satisfies readonly UserDictionaryOption<string>[];

export type UserDictionarySourceFilter =
  typeof USER_DICTIONARY_SOURCE_FILTERS[number]['id'];

export const USER_DICTIONARY_EXPORT_FORMATS = [
  { id: 'json', label: 'JSON (lossless)' },
  { id: 'markdown', label: 'Markdown (human-readable, lossy)' }
] as const satisfies readonly UserDictionaryOption<string>[];

export type UserDictionaryExportFormat =
  typeof USER_DICTIONARY_EXPORT_FORMATS[number]['id'];

export const USER_DICTIONARY_VIEW_STATUSES = [
  { id: 'ready', label: 'Ready' },
  { id: 'loading', label: 'Loading' },
  { id: 'generationFailed', label: 'Generation failed' },
  { id: 'storageError', label: 'Storage error' }
] as const satisfies readonly UserDictionaryOption<string>[];

export type UserDictionaryViewStatus =
  typeof USER_DICTIONARY_VIEW_STATUSES[number]['id'];

export interface UserDictionaryListQuery {
  search?: string;
  language?: string;
  collection?: string;
  entryType?: string;
  captureMode?: UserDictionaryCaptureMode;
  source?: UserDictionarySourceFilter;
}

export function isUserDictionarySourceFilter(
  value: unknown
): value is UserDictionarySourceFilter {
  return typeof value === 'string' &&
    USER_DICTIONARY_SOURCE_FILTERS.some((option) => option.id === value);
}

export function isUserDictionaryExportFormat(
  value: unknown
): value is UserDictionaryExportFormat {
  return typeof value === 'string' &&
    USER_DICTIONARY_EXPORT_FORMATS.some((option) => option.id === value);
}

export function isUserDictionaryViewStatus(
  value: unknown
): value is UserDictionaryViewStatus {
  return typeof value === 'string' &&
    USER_DICTIONARY_VIEW_STATUSES.some((option) => option.id === value);
}

export function userDictionarySourceFilterOptions(): Array<[
  UserDictionarySourceFilter,
  string
]> {
  return USER_DICTIONARY_SOURCE_FILTERS.map((option) => [option.id, option.label]);
}

export function userDictionaryExportFormatOptions(): Array<[
  UserDictionaryExportFormat,
  string
]> {
  return USER_DICTIONARY_EXPORT_FORMATS.map((option) => [option.id, option.label]);
}

export function userDictionaryViewStatusOptions(): Array<[
  UserDictionaryViewStatus,
  string
]> {
  return USER_DICTIONARY_VIEW_STATUSES.map((option) => [option.id, option.label]);
}

export function filterUserDictionaryEntries(
  entries: readonly UserDictionaryEntryV1[],
  query: UserDictionaryListQuery
): UserDictionaryEntryV1[] {
  const search = normalizeSearchValue(query.search ?? '');
  return sortUserDictionaryEntries(entries).filter((entry) => {
    if (query.language && entry.language !== query.language) return false;
    if (query.collection && entry.collection !== query.collection) return false;
    if (query.entryType && entry.entryType !== query.entryType) return false;
    if (query.captureMode && entry.capture.mode !== query.captureMode) return false;
    if (query.source === 'withMerriamWebster' && !entry.merriamWebsterReference) return false;
    if (query.source === 'withoutMerriamWebster' && entry.merriamWebsterReference) return false;
    if (!search) return true;
    return searchableEntryValues(entry).some((value) =>
      normalizeSearchValue(value).includes(search)
    );
  });
}

export function userDictionaryFilterValues(
  entries: readonly UserDictionaryEntryV1[]
): {
  languages: string[];
  collections: string[];
  entryTypes: string[];
} {
  return {
    languages: distinctSorted(entries.map((entry) => entry.language)),
    collections: distinctSorted(entries.map((entry) => entry.collection)),
    entryTypes: distinctSorted(entries.map((entry) => entry.entryType))
  };
}

function searchableEntryValues(entry: UserDictionaryEntryV1): string[] {
  return [
    entry.term,
    ...entry.aliases,
    ...entry.senses.flatMap((sense) => [sense.definition, sense.usageNote ?? '']),
    ...entry.tags,
    entry.collection
  ];
}

function normalizeSearchValue(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('und');
}

function distinctSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: 'base' })
  );
}
