import {
  USER_DICTIONARY_CAPTURE_MODES,
  USER_DICTIONARY_PROVIDERS,
  type UserDictionaryCaptureMode,
  type UserDictionaryProvider
} from './contract.js';

interface UserDictionaryOption<T extends string | number> {
  id: T;
  label: string;
}

export const USER_DICTIONARY_THINKING_OR_EFFORTS = [
  { id: 'auto', label: 'Auto' },
  { id: 'none', label: 'None' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' }
] as const satisfies readonly UserDictionaryOption<string>[];

export type UserDictionaryThinkingOrEffort =
  typeof USER_DICTIONARY_THINKING_OR_EFFORTS[number]['id'];

export const USER_DICTIONARY_EXAMPLE_COUNTS = [
  { id: 0, label: '0' },
  { id: 1, label: '1' },
  { id: 2, label: '2' },
  { id: 3, label: '3' }
] as const satisfies readonly UserDictionaryOption<number>[];

export type UserDictionaryExampleCount =
  typeof USER_DICTIONARY_EXAMPLE_COUNTS[number]['id'];

export interface UserDictionaryCaptureSettings {
  captureMode: UserDictionaryCaptureMode;
  fallbackOnMerriamWebsterNoMatch: boolean;
  provider: UserDictionaryProvider;
  model: string;
  thinkingOrEffort: UserDictionaryThinkingOrEffort;
  entryLanguage: string;
  includePronunciation: boolean;
  includeSynonyms: boolean;
  includeUsageNotes: boolean;
  numberOfExamples: UserDictionaryExampleCount;
  includeTechnicalMeanings: boolean;
}

export const USER_DICTIONARY_CAPTURE_DEFAULTS = {
  captureMode: USER_DICTIONARY_CAPTURE_MODES[0],
  fallbackOnMerriamWebsterNoMatch: false,
  provider: USER_DICTIONARY_PROVIDERS[0],
  model: 'gemini-3.6-flash',
  thinkingOrEffort: 'low',
  entryLanguage: 'auto',
  includePronunciation: true,
  includeSynonyms: true,
  includeUsageNotes: true,
  numberOfExamples: 2,
  includeTechnicalMeanings: true
} as const satisfies UserDictionaryCaptureSettings;

export function isUserDictionaryThinkingOrEffort(
  value: unknown
): value is UserDictionaryThinkingOrEffort {
  return typeof value === 'string' &&
    USER_DICTIONARY_THINKING_OR_EFFORTS.some((option) => option.id === value);
}

export function isUserDictionaryExampleCount(
  value: unknown
): value is UserDictionaryExampleCount {
  return typeof value === 'number' &&
    USER_DICTIONARY_EXAMPLE_COUNTS.some((option) => option.id === value);
}

export function userDictionaryThinkingOrEffortOptions(): Array<[
  UserDictionaryThinkingOrEffort,
  string
]> {
  return USER_DICTIONARY_THINKING_OR_EFFORTS.map((option) => [option.id, option.label]);
}

export function userDictionaryExampleCountOptions(): Array<[
  UserDictionaryExampleCount,
  string
]> {
  return USER_DICTIONARY_EXAMPLE_COUNTS.map((option) => [option.id, option.label]);
}

export function userDictionaryCaptureModeOptions(): Array<[
  UserDictionaryCaptureMode,
  string
]> {
  return USER_DICTIONARY_CAPTURE_MODES.map((id) => [
    id,
    id === 'llmOnly' ? 'LLM Only' : 'Merriam-Webster + LLM'
  ]);
}

export function userDictionaryProviderOptions(): Array<[UserDictionaryProvider, string]> {
  return USER_DICTIONARY_PROVIDERS.map((id) => [
    id,
    id === 'gemini' ? 'Google Gemini' : id === 'openai' ? 'OpenAI API' : 'Anthropic Claude API'
  ]);
}
