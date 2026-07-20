import { ProviderError } from '../errors.js';
import type {
  DictionaryEntry,
  DictionaryDiscussion,
  DictionaryDiscussionBlock,
  DictionaryProvider,
  DictionaryRequest,
  DictionaryResult,
  DictionarySection
} from '../types.js';

export class MerriamWebsterProvider implements DictionaryProvider {
  public readonly id = 'merriamWebsterCollegiate';

  public constructor(private readonly apiKey: string) {}

  public async lookup(
    request: DictionaryRequest,
    signal: AbortSignal
  ): Promise<DictionaryResult | undefined> {
    return this.fetchAndNormalize(request.text, request, signal, true);
  }

  private async fetchAndNormalize(
    query: string,
    request: DictionaryRequest,
    signal: AbortSignal,
    followSuggestion: boolean
  ): Promise<DictionaryResult | undefined> {
    const url = new URL(
      `https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(query)}`
    );
    url.searchParams.set('key', this.apiKey);

    let response: Response;
    try {
      response = await fetch(url, { signal });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ProviderError('Merriam-Webster could not be reached.');
    }

    const payload = (await response.json().catch(() => undefined)) as unknown;
    if (!response.ok) {
      throw new ProviderError(
        `Merriam-Webster request failed (${response.status}).`,
        'setMerriamWebsterCollegiateKey'
      );
    }

    const result = parseMerriamWebsterResponse(payload, request, this.id);
    if (result) return result;

    const suggestion = followSuggestion ? firstSuggestion(payload, request.text) : undefined;
    if (!suggestion) return undefined;
    const suggested = await this.fetchAndNormalize(suggestion, request, signal, false);
    if (!suggested) return undefined;
    return {
      ...suggested,
      sourceText: request.text,
      note: `No exact entry was returned for “${request.text}”; showing Merriam-Webster's suggestion “${suggestion}”.`
    };
  }
}

export function parseMerriamWebsterResponse(
  payload: unknown,
  request: DictionaryRequest,
  providerId: string,
  createdAt = new Date().toISOString()
): DictionaryResult | undefined {
  if (!Array.isArray(payload)) return undefined;
  const allRecords = payload.filter(isRecord);
  const matchingRecords = allRecords.filter((record) => recordMatchesQuery(record, request.text));
  const records = matchingRecords.length > 0 ? matchingRecords : allRecords;
  if (records.length === 0) return undefined;

  const sections = records
    .map(normalizeSection)
    .filter((section): section is DictionarySection => section !== undefined);
  const entries = sections.flatMap((section) => section.entries);
  if (entries.length === 0) return undefined;

  const primary = sections[0]!;
  const result: DictionaryResult = {
    kind: 'dictionary',
    providerId,
    sourceText: request.text,
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    createdAt,
    headword: primary.headword,
    entries,
    sections
  };
  if (primary.pronunciation) result.pronunciation = primary.pronunciation;
  return result;
}

function normalizeSection(record: Record<string, unknown>): DictionarySection | undefined {
  const headwordInfo = recordValue(record.hwi);
  const rawHeadword = stringValue(headwordInfo?.hw) ?? stringValue(recordValue(record.meta)?.id);
  const entries = senseEntries(record);
  if (!rawHeadword || entries.length === 0) return undefined;

  const section: DictionarySection = {
    headword: cleanHeadword(rawHeadword),
    entries
  };
  const homograph = numberValue(record.hom);
  const partOfSpeech = stringValue(record.fl);
  const pronunciation = firstPronunciation(headwordInfo);
  const audioUrl = firstAudioUrl(headwordInfo);
  const inflections = collectInflections(record);
  const synonymDiscussions = collectSynonymDiscussions(record);
  if (homograph !== undefined) section.homograph = homograph;
  if (partOfSpeech) section.partOfSpeech = partOfSpeech;
  if (pronunciation) section.pronunciation = pronunciation;
  if (audioUrl) section.audioUrl = audioUrl;
  if (inflections.length > 0) section.inflections = inflections;
  if (synonymDiscussions.length > 0) section.synonymDiscussions = synonymDiscussions;
  return section;
}

function collectSynonymDiscussions(record: Record<string, unknown>): DictionaryDiscussion[] {
  return arrayValue(record.syns)
    .filter(isRecord)
    .map((discussion) => {
      const textParts: string[] = [];
      const examples: string[] = [];
      const blocks: DictionaryDiscussionBlock[] = [];
      for (const item of arrayValue(discussion.pt)) {
        if (!Array.isArray(item)) continue;
        if (item[0] === 'text' && typeof item[1] === 'string') {
          for (const rawParagraph of item[1].split(/\{p_br\}/giu)) {
            const text = cleanSynonymDiscussionText(rawParagraph);
            if (!text) continue;
            textParts.push(text);
            blocks.push({ kind: 'text', text });
          }
        }
        if (item[0] === 'vis') {
          for (const example of arrayValue(item[1]).filter(isRecord)) {
            const value = stringValue(example.t);
            if (!value) continue;
            const text = cleanMerriamWebsterMarkup(value);
            examples.push(text);
            blocks.push({ kind: 'example', text });
          }
        }
      }
      const result: DictionaryDiscussion = { text: textParts.join(' ').trim() };
      const label = stringValue(discussion.pl);
      const seeAlso = stringArray(discussion.sarefs)
        .map(cleanMerriamWebsterMarkup)
        .filter(Boolean);
      if (label) result.label = cleanMerriamWebsterMarkup(label);
      if (examples.length > 0) result.examples = examples;
      if (seeAlso.length > 0) result.seeAlso = seeAlso;
      if (blocks.length > 0) result.blocks = blocks;
      return result;
    })
    .filter((discussion) => discussion.text.length > 0);
}

function cleanSynonymDiscussionText(value: string): string {
  const leadingTerms = value.match(/^(?:\s*\{sc\}[^{}]+\{\/?sc\}){2,}/iu)?.[0];
  if (!leadingTerms) return cleanMerriamWebsterMarkup(value);
  const terms = [...leadingTerms.matchAll(/\{sc\}([^{}]+)\{\/?sc\}/giu)]
    .map((match) => match[1]?.trim())
    .filter((term): term is string => Boolean(term));
  if (terms.length < 2) return cleanMerriamWebsterMarkup(value);
  const readableTerms = terms.length === 2
    ? `${terms[0]} and ${terms[1]}`
    : `${terms.slice(0, -1).join(', ')}, and ${terms.at(-1)}`;
  const remainder = cleanMerriamWebsterMarkup(value.slice(leadingTerms.length));
  return `${readableTerms} ${remainder}`.trim();
}

function senseEntries(record: Record<string, unknown>): DictionaryEntry[] {
  const entries: DictionaryEntry[] = [];
  for (const definition of arrayValue(record.def).filter(isRecord)) {
    const verbDivider = stringValue(definition.vd);
    const senses: Array<Record<string, unknown>> = [];
    collectSenseRecords(definition.sseq, senses);
    for (const sense of senses) {
      const dt = arrayValue(sense.dt);
      const meaning = definitionText(dt);
      if (!meaning) continue;
      const entry: DictionaryEntry = { meaning };
      const senseNumber = stringValue(sense.sn);
      const labels = [verbDivider, ...stringArray(sense.sls), ...stringArray(sense.lbs)]
        .filter((value): value is string => Boolean(value));
      const examples = examplesFromDefiningText(dt);
      if (senseNumber) entry.senseNumber = senseNumber;
      if (labels.length > 0) entry.grammaticalLabel = labels.join(' · ');
      if (examples.length > 0) entry.examples = examples;
      entries.push(entry);

      const divided = recordValue(sense.sdsense);
      const dividedMeaning = definitionText(arrayValue(divided?.dt));
      if (dividedMeaning) {
        const dividedEntry: DictionaryEntry = { meaning: dividedMeaning };
        const dividedLabel = stringValue(divided?.sd);
        const dividedExamples = examplesFromDefiningText(arrayValue(divided?.dt));
        if (senseNumber) dividedEntry.senseNumber = senseNumber;
        if (dividedLabel) dividedEntry.grammaticalLabel = dividedLabel;
        if (dividedExamples.length > 0) dividedEntry.examples = dividedExamples;
        entries.push(dividedEntry);
      }
    }
  }

  if (entries.length === 0) {
    const partOfSpeech = stringValue(record.fl);
    for (const rawDefinition of stringArray(record.shortdef)) {
      const meaning = cleanMerriamWebsterMarkup(rawDefinition);
      if (!meaning) continue;
      const entry: DictionaryEntry = { meaning };
      if (partOfSpeech) entry.partOfSpeech = partOfSpeech;
      entries.push(entry);
    }
  }

  const supplemental = collectExamples(record);
  supplemental.forEach((example, index) => {
    const target = entries[index];
    if (target && !target.examples?.includes(example)) {
      target.examples = [...(target.examples ?? []), example];
    }
  });
  return deduplicateEntries(entries);
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
  for (const item of dt) {
    if (Array.isArray(item) && item[0] === 'text' && typeof item[1] === 'string') {
      const cleaned = cleanMerriamWebsterMarkup(item[1]);
      if (cleaned) return cleaned;
    }
  }
  return undefined;
}

function examplesFromDefiningText(dt: unknown[]): string[] {
  const examples: string[] = [];
  for (const item of dt) {
    if (!Array.isArray(item) || item[0] !== 'vis') continue;
    for (const example of arrayValue(item[1]).filter(isRecord)) {
      const text = stringValue(example.t);
      if (text) examples.push(cleanMerriamWebsterMarkup(text));
    }
  }
  return examples;
}

function collectInflections(record: Record<string, unknown>): string[] {
  const values: string[] = [];
  for (const inflection of arrayValue(record.ins).filter(isRecord)) {
    const label = stringValue(inflection.il);
    const form = stringValue(inflection.if);
    if (form) values.push(cleanHeadword(cleanMerriamWebsterMarkup(label ? `${label} ${form}` : form)));
  }
  for (const runOn of arrayValue(record.uros).filter(isRecord)) {
    const form = stringValue(runOn.ure);
    const label = stringValue(runOn.fl);
    if (form) values.push(cleanHeadword(cleanMerriamWebsterMarkup(label ? `${form} (${label})` : form)));
  }
  return [...new Set(values)];
}

function deduplicateEntries(entries: DictionaryEntry[]): DictionaryEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.senseNumber ?? ''}|${entry.grammaticalLabel ?? ''}|${entry.meaning}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function recordMatchesQuery(record: Record<string, unknown>, query: string): boolean {
  const normalizedQuery = query.toLocaleLowerCase('en-US');
  const meta = recordValue(record.meta);
  const id = stringValue(meta?.id)?.replace(/:\d+$/u, '').toLocaleLowerCase('en-US');
  const headword = stringValue(recordValue(record.hwi)?.hw)
    ?.replace(/\*/gu, '')
    .toLocaleLowerCase('en-US');
  const stems = stringArray(meta?.stems).map((stem) => stem.toLocaleLowerCase('en-US'));
  return id === normalizedQuery || headword === normalizedQuery || stems.includes(normalizedQuery);
}

export function cleanMerriamWebsterMarkup(value: string): string {
  return value
    .replace(/\{bc\}/giu, ': ')
    .replace(/\{(?:a_link|d_link|i_link|et_link|mat|sx)\|([^|}]+)(?:\|[^}]*)?\}/giu, '$1')
    .replace(/\{ldquo\}/giu, '“')
    .replace(/\{rdquo\}/giu, '”')
    .replace(/\{mdash\}/giu, '—')
    .replace(/\{ndash\}/giu, '–')
    .replace(/\{\/?[\w-]+(?:\|[^}]*)?\}/gu, '')
    .replace(/\s+/gu, ' ')
    .replace(/^\s*:\s*/u, '')
    .trim();
}

function firstSuggestion(payload: unknown, original: string): string | undefined {
  if (!Array.isArray(payload)) return undefined;
  return payload
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .find((value) => value.length > 0 && value.toLocaleLowerCase('en-US') !== original.toLocaleLowerCase('en-US'));
}

function firstPronunciation(headwordInfo: Record<string, unknown> | undefined): string | undefined {
  const pronunciations = arrayValue(headwordInfo?.prs).filter(isRecord);
  return pronunciations.map((item) => stringValue(item.mw)).find(Boolean);
}

function firstAudioUrl(headwordInfo: Record<string, unknown> | undefined): string | undefined {
  const pronunciations = arrayValue(headwordInfo?.prs).filter(isRecord);
  const audio = pronunciations
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

function collectExamples(record: Record<string, unknown>): string[] {
  const examples: string[] = [];
  const visit = (value: unknown, inExampleContainer = false): void => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, inExampleContainer));
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      const exampleContainer = inExampleContainer || key === 'vis' || key === 'examples';
      if (key === 't' && exampleContainer && typeof child === 'string') {
        const cleaned = cleanMerriamWebsterMarkup(child);
        if (cleaned && !examples.includes(cleaned)) examples.push(cleaned);
      } else {
        visit(child, exampleContainer);
      }
    }
  };
  visit(record);
  return examples;
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
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
