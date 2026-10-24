import { createHash } from 'node:crypto';
import * as routing from '../../src/languageModelRouting.js';
import { DEFAULT_GEMINI_MODEL, DEFAULT_PRO_MODELS, normalizeGeminiModel, normalizeModelSetting } from '../../src/providers/geminiModels.js';
import { geminiRefreshTarget } from '../../src/geminiProfileRefresh.js';
import { KREN_LANGUAGES, languageName, isSameLanguage, isPlausibleLanguageCode } from '../../src/languages.js';
import { detectedLanguage } from '../../src/detectedLanguage.js';
import { EDGE_SPEECH_LOCALES } from '@kren/core/edge-speech';
import * as dictionary from '../../src/userDictionary/providerContract.js';

/** Capture fixed inputs before extraction. Hashes pin complete dictionary outputs, including order and whitespace. */
export function foundationOutputs(): Record<string, unknown> {
  const outputs: Record<string, unknown> = {};
  const record = (key: string, run: () => unknown): void => {
    try { outputs[key] = run() ?? null; }
    catch (error) { outputs[key] = { error: (error as Error).name, message: (error as Error).message }; }
  };
  const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex');
  outputs.providers = routing.LANGUAGE_MODEL_ROUTING_PROVIDERS;
  outputs.efforts = routing.LANGUAGE_MODEL_ROUTING_EFFORTS;
  outputs.providerOptions = routing.languageModelRoutingProviderOptions();
  outputs.effortOptions = routing.languageModelRoutingEffortOptions();
  outputs.translationDefaults = routing.TRANSLATION_ROUTING_DEFAULTS;
  for (const provider of routing.LANGUAGE_MODEL_ROUTING_PROVIDERS) {
    outputs[`provider:${provider}`] = [routing.isLanguageModelRoutingProvider(provider), routing.languageModelRoutingProviderLabel(provider),
      routing.languageModelCredentialSlot(provider, 'standard'), routing.languageModelCredentialSlot(provider, 'pro')];
  }
  for (const { id } of routing.LANGUAGE_MODEL_ROUTING_EFFORTS) {
    outputs[`effort:${id}`] = [routing.isLanguageModelRoutingEffort(id), routing.languageModelRoutingEffortLabel(id)];
  }
  for (const value of [undefined, null, 0, {}, '', 'Gemini', 'googleCloudTranslation', 'maximal', 'auto ', 'groq', 'auto']) {
    outputs[`guards:${JSON.stringify(value)}`] = [routing.isLanguageModelRoutingProvider(value), routing.isLanguageModelRoutingEffort(value), routing.isLanguageModelIdentifier(value), dictionary.isUserDictionaryProvider(value)];
  }
  outputs.defaultModel = DEFAULT_GEMINI_MODEL;
  outputs.proModels = DEFAULT_PRO_MODELS;
  for (const model of ['gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3.5-flash', 'models/gemini-3.5-flash',
    ' gemini-3.5-flash ', ' models/gemini-3.5-flash ', 'GEMINI-3.5-FLASH', 'gemini-3.5-flash-lite',
    'gemini-3.8-flash', 'gemini-3.8-live', 'gemini-3.1-flash-lite-image', 'gemini-3.5-transcribe',
    'gpt-5.1-mini', '@cf/meta/llama-4', 'two words', '', 'models/', '../escape', 'a?b', 'model:latest']) {
    outputs[`model:${model}`] = [normalizeGeminiModel(model), normalizeModelSetting('translation.model', model),
      normalizeModelSetting('MODEL', model), normalizeModelSetting('translation.provider', model), routing.isLanguageModelIdentifier(model)];
  }
  outputs.nonStringSetting = normalizeModelSetting('translation.model', 17);
  outputs.profiles = [geminiRefreshTarget('default'), geminiRefreshTarget('alternate')];
  outputs.languages = KREN_LANGUAGES;
  outputs.locales = EDGE_SPEECH_LOCALES.map(({ id, label }) => ({ id, label }));
  const codes = [...KREN_LANGUAGES.map(({ code }) => code), ...EDGE_SPEECH_LOCALES.map(({ id }) => id),
    'auto', 'auto-en-ko', 'bilingual', 'de-AT', 'zz-ZZ', '', ' EN-us ', 'EN-US', ' en ', ' auto '];
  for (const code of codes) {
    outputs[`language:${code}`] = [languageName(code), isPlausibleLanguageCode(code)];
    outputs[`same:${code}`] = codes.map(other => isSameLanguage(code, other));
  }
  for (const text of ['', '123 !', 'Hello, this is the document we will read today.', '\uD55C\uAD6D\uC5B4 \uBB38\uC7A5',
    '\u65E5\u672C\u8A9E\u306E\u6587\u7AE0', '\u4E2D\u6587\u6587\u7AE0', '\u041F\u0440\u0438\u0432\u0435\u0442 \u043C\u0438\u0440',
    '\u0645\u0631\u062D\u0628\u0627', '\u05E9\u05DC\u05D5\u05DD', '\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22',
    'Das ist ein Text und wir haben die Sprache erkannt.', 'Ceci est une phrase avec des mots et une langue.',
    'Esta es una frase con las palabras de una lengua.', 'xyzzy', '\uD55C\uAD6D\uC5B4 and the words in English']) {
    record(`detect:${text}`, () => detectedLanguage(text));
  }
  outputs.dictionaryProviders = dictionary.USER_DICTIONARY_PROVIDERS;
  const timestamp = '2026-10-19T00:00:00.000Z';
  const entries = (['gemini', 'openai', 'anthropic', 'groq', 'cloudflare'] as const).map(provider => ({
    schemaVersion: 1 as const, id: `entry-${provider}`, term: `term-${provider}`, normalizedTerm: `term-${provider}`,
    language: 'en', entryType: 'word', collection: 'Other', domains: [], tags: [],
    senses: [{ id: `sense-${provider}`, definition: 'A definition.', synonyms: [], antonyms: [], relatedTerms: [], examples: ['An example.'] }],
    aliases: [], capture: { mode: 'llmOnly' as const, provider, model: 'test-model', generatedAt: timestamp, userEdited: false },
    createdAt: timestamp, updatedAt: timestamp
  }));
  const store = { schemaVersion: 1 as const, entries };
  const empty = { schemaVersion: 1 as const, entries: [] };
  for (const entry of entries) {
    record(`entry:${entry.capture.provider}`, () => dictionary.validateUserDictionaryEntry(entry));
    record(`source:${entry.capture.provider}`, () => dictionary.userDictionarySourceLine(entry));
    for (const patch of [{ provider: 'unknown' }, { provider: null }, { model: '' }, { mode: 'manual' }, { extra: true }]) {
      record(`reject:${entry.capture.provider}:${JSON.stringify(patch)}`, () => dictionary.validateUserDictionaryEntry({ ...entry, capture: { ...entry.capture, ...patch } }));
    }
  }
  const json = dictionary.exportUserDictionaryJson(store);
  const markdown = dictionary.exportUserDictionaryMarkdown(store);
  const preview = dictionary.previewUserDictionaryImport(json, empty);
  const purge = dictionary.previewUserDictionaryPurge(store, 'all', new Date(timestamp));
  const operations: Record<string, () => unknown> = {
    validateStore: () => dictionary.validateUserDictionaryStore(store), canonical: () => dictionary.canonicalUserDictionaryStore(store),
    exportJson: () => json, importJson: () => dictionary.importUserDictionaryJson(json), exportMarkdown: () => markdown,
    preview: () => preview, previewDocument: () => dictionary.previewUserDictionaryImportDocument(json, 'json', empty),
    previewMarkdown: () => dictionary.previewUserDictionaryMarkdownImport(markdown, empty),
    apply: () => dictionary.applyUserDictionaryImport(empty, preview, { mode: 'merge', duplicateStrategy: 'keepExisting' }),
    purge: () => purge, remaining: () => dictionary.entriesRemainingAfterPurge(store, purge),
    filter: () => dictionary.filterUserDictionaryEntries(entries, { search: 'term' }), filters: () => dictionary.userDictionaryFilterValues(entries),
    invalidJson: () => dictionary.importUserDictionaryJson('{'), invalidStore: () => dictionary.validateUserDictionaryStore({ schemaVersion: 2, entries }),
    manual: () => dictionary.validateUserDictionaryEntry({ ...entries[0], capture: { mode: 'manual', generatedAt: timestamp, userEdited: true } })
  };
  for (const provider of ['gemini', 'openai', 'anthropic', 'groq', 'cloudflare'] as const) {
    operations[`draft:${provider}`] = () => dictionary.assembleUserDictionaryDraft('term', {
      entryLanguage: 'en', includePronunciation: true, includeSynonyms: true, includeUsageNotes: true,
      numberOfExamples: 1, includeTechnicalMeanings: true
    }, provider, 'test-model', { language: 'en', entryType: 'word', pronunciation: '', domains: [], tags: [], aliases: [],
      senses: [{ partOfSpeech: 'noun', pronunciation: '', definition: 'A definition.', usageNote: '', synonyms: [], antonyms: [], relatedTerms: [], examples: ['An example.'] }] },
    () => timestamp, () => 'fixed-id');
  }
  for (const [name, run] of Object.entries(operations)) record(`dictionary:${name}`, () => digest(run()));
  return outputs;
}
