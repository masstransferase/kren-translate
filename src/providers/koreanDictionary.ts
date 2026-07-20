import { XMLParser } from 'fast-xml-parser';
import { ProviderError } from '../errors.js';
import type {
  DictionaryEntry,
  DictionaryProvider,
  DictionaryRequest,
  DictionaryResult
} from '../types.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true
});

export class KoreanDictionaryProvider implements DictionaryProvider {
  public readonly id = 'koreanBasicDictionary';

  public constructor(private readonly apiKey: string) {}

  public async lookup(
    request: DictionaryRequest,
    signal: AbortSignal
  ): Promise<DictionaryResult | undefined> {
    const url = new URL('https://krdict.korean.go.kr/api/search');
    url.search = new URLSearchParams({
      key: this.apiKey,
      q: request.text,
      part: 'word',
      translated: 'y',
      trans_lang: '1',
      sort: 'popular',
      num: '10'
    }).toString();

    const response = await fetch(url, { signal });
    const xml = await response.text();
    if (!response.ok) {
      throw new ProviderError(`Korean Basic Dictionary request failed (${response.status}).`);
    }

    const document = parser.parse(xml) as unknown;
    if (!isRecord(document)) {
      throw new ProviderError('Korean Basic Dictionary returned malformed XML.');
    }
    const error = recordValue(document.error);
    if (error) {
      const code = stringValue(error.error_code);
      const message = stringValue(error.message) ?? 'Dictionary request failed.';
      if (code === '020' || code === '021') {
        throw new ProviderError(message, 'setDictionaryKey');
      }
      throw new ProviderError(message);
    }

    const channel = recordValue(document.channel);
    const items = toArray(channel?.item).filter(isRecord);
    if (items.length === 0) return undefined;

    return normalizeItems(items, request, new Date().toISOString());
  }
}

export function parseKoreanDictionaryXml(xml: string, request: DictionaryRequest): DictionaryResult | undefined {
  const document = parser.parse(xml) as unknown;
  if (!isRecord(document)) return undefined;
  const channel = recordValue(document.channel);
  const items = toArray(channel?.item).filter(isRecord);
  return normalizeItems(items, request, new Date(0).toISOString());
}

function normalizeItems(
  items: Array<Record<string, unknown>>,
  request: DictionaryRequest,
  createdAt: string
): DictionaryResult | undefined {
  const exactItem = items.find((item) => stringValue(item.word) === request.text) ?? items[0];
  if (!exactItem) return undefined;
  const entries = normalizeKoreanSenses(exactItem).slice(0, 3);
  if (entries.length === 0) return undefined;
  const result: DictionaryResult = {
    kind: 'dictionary',
    providerId: 'koreanBasicDictionary',
    sourceText: request.text,
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    createdAt,
    headword: stringValue(exactItem.word) ?? request.text,
    entries
  };
  const pronunciation = stringValue(exactItem.pronunciation);
  if (pronunciation) result.pronunciation = pronunciation;
  return result;
}

function normalizeKoreanSenses(item: Record<string, unknown>): DictionaryEntry[] {
  const partOfSpeech = stringValue(item.pos);
  return toArray(item.sense)
    .filter(isRecord)
    .flatMap((sense): DictionaryEntry[] => {
      const translations = toArray(sense.translation).filter(isRecord);
      const translation = translations.find((candidate) => {
        const language = stringValue(candidate.trans_lang);
        return !language || language === '영어' || language.toLowerCase() === 'english';
      }) ?? translations[0];
      const meaning = stringValue(translation?.trans_word);
      const translatedDefinition = stringValue(translation?.trans_dfn);
      const koreanDefinition = stringValue(sense.definition);
      if (!meaning && !translatedDefinition) return [];
      const entry: DictionaryEntry = {
        meaning: meaning ?? translatedDefinition ?? ''
      };
      if (partOfSpeech) entry.partOfSpeech = partOfSpeech;
      const definition = translatedDefinition ?? koreanDefinition;
      if (definition && definition !== entry.meaning) entry.definition = definition;
      return [entry];
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return undefined;
}
