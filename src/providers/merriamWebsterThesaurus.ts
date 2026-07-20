import { ProviderError } from '../errors.js';
import { cleanMerriamWebsterMarkup } from './merriamWebster.js';
import type {
  DictionaryRequest,
  ThesaurusResult,
  ThesaurusSection,
  ThesaurusSense,
  ThesaurusWord
} from '../types.js';

export class MerriamWebsterThesaurusProvider {
  public readonly id = 'merriamWebsterThesaurus';

  public constructor(private readonly apiKey: string) {}

  public async lookup(
    request: DictionaryRequest,
    signal: AbortSignal
  ): Promise<ThesaurusResult | undefined> {
    return this.fetchAndNormalize(request.text, request, signal, true);
  }

  private async fetchAndNormalize(
    query: string,
    request: DictionaryRequest,
    signal: AbortSignal,
    followSuggestion: boolean
  ): Promise<ThesaurusResult | undefined> {
    const url = new URL(
      `https://www.dictionaryapi.com/api/v3/references/thesaurus/json/${encodeURIComponent(query)}`
    );
    url.searchParams.set('key', this.apiKey);

    let response: Response;
    try {
      response = await fetch(url, { signal });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ProviderError('Merriam-Webster Thesaurus could not be reached.');
    }
    const payload = (await response.json().catch(() => undefined)) as unknown;
    if (!response.ok) {
      throw new ProviderError(
        `Merriam-Webster Thesaurus request failed (${response.status}).`,
        'setMerriamWebsterThesaurusKey'
      );
    }

    const result = parseMerriamWebsterThesaurusResponse(payload, request);
    if (result) return result;
    const suggestion = followSuggestion ? firstSuggestion(payload, request.text) : undefined;
    if (!suggestion) return undefined;
    const suggested = await this.fetchAndNormalize(suggestion, request, signal, false);
    if (!suggested) return undefined;
    return {
      ...suggested,
      sourceText: request.text,
      note: `No exact thesaurus entry was returned for “${request.text}”; showing Merriam-Webster's suggestion “${suggestion}”.`
    };
  }
}

export function parseMerriamWebsterThesaurusResponse(
  payload: unknown,
  request: DictionaryRequest,
  createdAt = new Date().toISOString()
): ThesaurusResult | undefined {
  if (!Array.isArray(payload)) return undefined;
  const records = payload.filter(isRecord);
  if (records.length === 0) return undefined;
  const matching = records.filter((record) => recordMatchesQuery(record, request.text));
  const selected = matching.length > 0 ? matching : records;
  const sections = selected
    .map(normalizeSection)
    .filter((section): section is ThesaurusSection => section !== undefined);
  if (sections.length === 0) return undefined;
  return {
    kind: 'thesaurus',
    providerId: 'merriamWebsterThesaurus',
    sourceText: request.text,
    sourceLanguage: 'en',
    targetLanguage: 'en',
    createdAt,
    headword: sections[0]!.headword,
    sections
  };
}

function normalizeSection(record: Record<string, unknown>): ThesaurusSection | undefined {
  const headwordInfo = recordValue(record.hwi);
  const rawHeadword = stringValue(headwordInfo?.hw) ?? stringValue(recordValue(record.meta)?.id);
  if (!rawHeadword) return undefined;
  const senses: ThesaurusSense[] = [];
  for (const definition of arrayValue(record.def).filter(isRecord)) {
    const records: Array<Record<string, unknown>> = [];
    collectSenseRecords(definition.sseq, records);
    records.forEach((sense) => {
      const normalized = normalizeSense(sense);
      if (normalized) senses.push(normalized);
    });
  }
  if (senses.length === 0) {
    const meta = recordValue(record.meta);
    const synonyms = metadataWords(meta?.syns);
    const antonyms = metadataWords(meta?.ants);
    if (synonyms.length > 0 || antonyms.length > 0) {
      const sense: ThesaurusSense = { synonyms };
      if (antonyms.length > 0) sense.antonyms = antonyms;
      senses.push(sense);
    }
  }
  if (senses.length === 0) return undefined;

  const section: ThesaurusSection = {
    headword: cleanHeadword(rawHeadword),
    senses
  };
  const partOfSpeech = stringValue(record.fl);
  const pronunciation = firstPronunciation(headwordInfo);
  const audioUrl = firstAudioUrl(headwordInfo);
  if (partOfSpeech) section.partOfSpeech = partOfSpeech;
  if (pronunciation) section.pronunciation = pronunciation;
  if (audioUrl) section.audioUrl = audioUrl;
  return section;
}

function normalizeSense(sense: Record<string, unknown>): ThesaurusSense | undefined {
  const synonyms = wordsFromList(sense.syn_list);
  const nearSynonyms = wordsFromList(sense.sim_list);
  const relatedWords = wordsFromList(sense.rel_list);
  const synonymousPhrases = wordsFromList(sense.phrase_list);
  const antonyms = wordsFromList(sense.ant_list);
  const nearAntonyms = uniqueWords([
    ...wordsFromList(sense.near_list),
    ...wordsFromList(sense.opp_list)
  ]);
  if (synonyms.length === 0 && nearSynonyms.length === 0 && relatedWords.length === 0 &&
      synonymousPhrases.length === 0 && antonyms.length === 0 && nearAntonyms.length === 0) {
    return undefined;
  }
  const result: ThesaurusSense = { synonyms };
  const senseNumber = stringValue(sense.sn);
  const definition = definitionText(arrayValue(sense.dt));
  if (senseNumber) result.senseNumber = senseNumber;
  if (definition) result.definition = definition;
  if (nearSynonyms.length > 0) result.nearSynonyms = nearSynonyms;
  if (relatedWords.length > 0) result.relatedWords = relatedWords;
  if (synonymousPhrases.length > 0) result.synonymousPhrases = synonymousPhrases;
  if (antonyms.length > 0) result.antonyms = antonyms;
  if (nearAntonyms.length > 0) result.nearAntonyms = nearAntonyms;
  return result;
}

function wordsFromList(value: unknown): ThesaurusWord[] {
  const words: ThesaurusWord[] = [];
  for (const group of arrayValue(value)) {
    for (const item of arrayValue(group).filter(isRecord)) {
      const rawWord = stringValue(item.wd);
      if (!rawWord) continue;
      const word: ThesaurusWord = { word: cleanMerriamWebsterMarkup(rawWord) };
      const labels = stringArray(recordValue(item.wsls)?.wsl ?? item.wsls)
        .map(cleanMerriamWebsterMarkup)
        .filter(Boolean);
      if (labels.length > 0) word.labels = labels;
      words.push(word);
    }
  }
  return uniqueWords(words);
}

function metadataWords(value: unknown): ThesaurusWord[] {
  const words: ThesaurusWord[] = [];
  for (const group of arrayValue(value)) {
    for (const item of arrayValue(group)) {
      if (typeof item === 'string' && item.trim()) {
        words.push({ word: cleanMerriamWebsterMarkup(item) });
      }
    }
  }
  return uniqueWords(words);
}

function uniqueWords(words: ThesaurusWord[]): ThesaurusWord[] {
  const seen = new Set<string>();
  return words.filter((word) => {
    const key = word.word.toLocaleLowerCase('en-US');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectSenseRecords(value: unknown, output: Array<Record<string, unknown>>): void {
  if (Array.isArray(value)) {
    if ((value[0] === 'sense' || value[0] === 'sen') && isRecord(value[1])) {
      output.push(value[1]);
      return;
    }
    value.forEach((item) => collectSenseRecords(item, output));
    return;
  }
  if (isRecord(value)) Object.values(value).forEach((item) => collectSenseRecords(item, output));
}

function definitionText(dt: unknown[]): string | undefined {
  const text = dt
    .filter((item): item is [string, string] =>
      Array.isArray(item) && item[0] === 'text' && typeof item[1] === 'string'
    )
    .map((item) => cleanMerriamWebsterMarkup(item[1]))
    .filter(Boolean)
    .join(' ');
  return text || undefined;
}

function recordMatchesQuery(record: Record<string, unknown>, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase('en-US');
  const meta = recordValue(record.meta);
  const id = stringValue(meta?.id)?.replace(/:\d+$/u, '').toLocaleLowerCase('en-US');
  const headword = stringValue(recordValue(record.hwi)?.hw)
    ?.replace(/\*/gu, '')
    .toLocaleLowerCase('en-US');
  const stems = stringArray(meta?.stems).map((stem) => stem.toLocaleLowerCase('en-US'));
  return id === normalized || headword === normalized || stems.includes(normalized);
}

function firstSuggestion(payload: unknown, original: string): string | undefined {
  if (!Array.isArray(payload)) return undefined;
  return payload
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .find((value) => value && value.toLocaleLowerCase('en-US') !== original.toLocaleLowerCase('en-US'));
}

function firstPronunciation(headwordInfo: Record<string, unknown> | undefined): string | undefined {
  return arrayValue(headwordInfo?.prs)
    .filter(isRecord)
    .map((item) => stringValue(item.mw))
    .find(Boolean);
}

function firstAudioUrl(headwordInfo: Record<string, unknown> | undefined): string | undefined {
  const audio = arrayValue(headwordInfo?.prs)
    .filter(isRecord)
    .map((item) => stringValue(recordValue(item.sound)?.audio))
    .find(Boolean);
  if (!audio) return undefined;
  const lower = audio.toLocaleLowerCase('en-US');
  const directory = lower.startsWith('bix')
    ? 'bix'
    : lower.startsWith('gg')
      ? 'gg'
      : /^[^a-z]/u.test(lower)
        ? 'number'
        : lower[0];
  return `https://media.merriam-webster.com/audio/prons/en/us/mp3/${directory}/${encodeURIComponent(audio)}.mp3`;
}

function cleanHeadword(value: string): string {
  return value.replace(/\*/gu, '·').replace(/:\d+$/u, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
