import { randomUUID } from 'node:crypto';
import { parseStructuredJson } from '@kren/core/structured-json';
import {
  isRetryableLanguageModelStatus,
  retryDelayMs,
  waitForRetry
} from '@kren/core/retry';
import { ProviderError } from '../errors.js';
import {
  structuredJsonConfigureAction,
  structuredJsonOutputText,
  structuredJsonProviderName,
  structuredJsonRequestInit,
  structuredJsonUrl
} from '../providers/structuredJsonTransport.js';
import { isPlausibleLanguageCode } from '../languages.js';
import type { DictionaryResult } from '../types.js';
import type {
  MerriamWebsterReferenceWork,
  UserDictionaryCaptureMode,
  UserDictionaryEntryV1,
  UserDictionaryGenerationOptions,
  UserDictionaryProvider
} from '@kren/core/user-dictionary';
import {
  USER_DICTIONARY_GENERATION_SCHEMA,
  UserDictionaryMalformedOutputError,
  assembleUserDictionaryDraft,
  normalizeUserDictionaryTerm,
  userDictionaryGenerationInstruction
} from '@kren/core/user-dictionary';
import type {
  UserDictionaryCaptureSettings,
  UserDictionaryThinkingOrEffort
} from './settings.js';
import { validateUserDictionaryEntry } from '@kren/core/user-dictionary';

export {
  USER_DICTIONARY_GENERATION_SCHEMA,
  UserDictionaryMalformedOutputError,
  assembleUserDictionaryDraft,
  userDictionaryGenerationInstruction
};
export type { UserDictionaryGenerationOptions };

export interface UserDictionaryGenerationRequest {
  instruction: string;
  expression: string;
}

export interface UserDictionaryProviderTransport {
  readonly provider: UserDictionaryProvider;
  readonly model: string;
  generate(request: UserDictionaryGenerationRequest, signal: AbortSignal): Promise<unknown>;
}

export interface UserDictionaryProviderTransportOptions {
  provider: UserDictionaryProvider;
  apiKey: string;
  model: string;
  thinkingOrEffort: UserDictionaryThinkingOrEffort;
  maxAttempts: number;
  fetch?: typeof fetch;
}

export interface UserDictionaryMerriamWebsterReview {
  referenceWork: MerriamWebsterReferenceWork;
  lookupTerm: string;
  result?: DictionaryResult;
  entryId?: string;
  noMatch?: boolean;
  failure?: string;
}

export interface UserDictionaryCaptureResult {
  expression: string;
  captureMode: UserDictionaryCaptureMode;
  draft?: UserDictionaryEntryV1;
  merriamWebster?: UserDictionaryMerriamWebsterReview;
  fallbackUsed: boolean;
}

interface GeneratedSense {
  partOfSpeech: string;
  definition: string;
  usageNote: string;
  synonyms: string[];
  antonyms: string[];
  relatedTerms: string[];
  examples: string[];
}

export interface UserDictionaryEditableFields {
  term: string;
  language: string;
  entryType: string;
  collection: string;
  domains: string[];
  tags: string[];
  pronunciation: string;
  senses: GeneratedSense[];
  aliases: string[];
}

export async function captureUserDictionaryDraft(
  expression: string,
  settings: UserDictionaryCaptureSettings,
  transport: UserDictionaryProviderTransport,
  signal: AbortSignal,
  options: UserDictionaryGenerationOptions & {
    maxMalformedAttempts?: number;
    now?: () => string;
    uuid?: () => string;
  } = {}
): Promise<UserDictionaryEntryV1> {
  const generation: UserDictionaryGenerationOptions = {
    termSuppliedByUser: options.termSuppliedByUser === true
  };
  const request: UserDictionaryGenerationRequest = {
    instruction: userDictionaryGenerationInstruction(settings, generation),
    expression
  };
  const attempts = boundedAttempts(options.maxMalformedAttempts ?? 3, 3);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await transport.generate(request, signal);
      return assembleUserDictionaryDraft(
        expression,
        settings,
        transport.provider,
        transport.model,
        value,
        options.now,
        options.uuid,
        generation
      );
    } catch (error) {
      if (!(error instanceof UserDictionaryMalformedOutputError) || attempt >= attempts - 1) {
        throw error;
      }
    }
  }
  throw new UserDictionaryMalformedOutputError();
}

export function attachUserDictionaryMerriamWebsterReference(
  draft: UserDictionaryEntryV1,
  reference: {
    referenceWork: MerriamWebsterReferenceWork;
    lookupTerm: string;
    entryId?: string;
    matchStatus: 'matched' | 'noMatch';
  }
): UserDictionaryEntryV1 {
  return validateUserDictionaryEntry({
    ...draft,
    merriamWebsterReference: {
      referenceWork: reference.referenceWork,
      lookupTerm: reference.lookupTerm,
      ...(reference.entryId ? { entryId: reference.entryId } : {}),
      matchStatus: reference.matchStatus
    }
  });
}

export function applyUserDictionaryDraftEdits(
  base: UserDictionaryEntryV1,
  value: unknown,
  now: () => string = () => new Date().toISOString(),
  uuid: () => string = randomUUID
): UserDictionaryEntryV1 {
  if (!isRecord(value) || !hasExactFields(value, [
    'term', 'language', 'entryType', 'collection', 'domains', 'tags',
    'pronunciation', 'senses', 'aliases'
  ]) || typeof value.term !== 'string' || !value.term.trim() ||
      typeof value.language !== 'string' || !isPlausibleLanguageCode(value.language.trim()) ||
      typeof value.entryType !== 'string' || !value.entryType.trim() ||
      typeof value.collection !== 'string' || !value.collection.trim() ||
      typeof value.pronunciation !== 'string' || !isStringArray(value.domains, 12) ||
      !isStringArray(value.tags, 20) || !isStringArray(value.aliases, 20) ||
      !Array.isArray(value.senses) || value.senses.length < 1 || value.senses.length > 12) {
    throw new Error('KREN rejected invalid User Dictionary draft fields. Nothing was saved.');
  }
  const senses = value.senses.map((sense) => validateGeneratedSense(sense));
  try {
    return validateUserDictionaryEntry({
      ...base,
      term: value.term.trim(),
      normalizedTerm: normalizeUserDictionaryTerm(value.term),
      language: value.language.trim(),
      entryType: value.entryType.trim(),
      collection: value.collection.trim(),
      domains: cleanStrings(value.domains),
      tags: cleanStrings(value.tags),
      ...(value.pronunciation.trim()
        ? { pronunciation: { display: value.pronunciation.trim(), audioAvailable: false } }
        : { pronunciation: undefined }),
      senses: senses.map((sense, index) => ({
        id: base.senses[index]?.id ?? uuid(),
        ...(sense.partOfSpeech ? { partOfSpeech: sense.partOfSpeech } : {}),
        definition: sense.definition,
        ...(sense.usageNote ? { usageNote: sense.usageNote } : {}),
        synonyms: sense.synonyms,
        antonyms: sense.antonyms,
        relatedTerms: sense.relatedTerms,
        examples: sense.examples
      })),
      aliases: cleanStrings(value.aliases),
      capture: { ...base.capture, userEdited: true },
      updatedAt: now()
    });
  } catch {
    throw new Error('KREN rejected invalid User Dictionary draft fields. Nothing was saved.');
  }
}

export class HttpUserDictionaryProviderTransport implements UserDictionaryProviderTransport {
  public readonly provider: UserDictionaryProvider;
  public readonly model: string;
  private readonly apiKey: string;
  private readonly thinkingOrEffort: UserDictionaryThinkingOrEffort;
  private readonly maxAttempts: number;
  private readonly request: typeof fetch;

  public constructor(options: UserDictionaryProviderTransportOptions) {
    this.provider = options.provider;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.thinkingOrEffort = options.thinkingOrEffort;
    this.maxAttempts = boundedAttempts(options.maxAttempts, 3);
    this.request = options.fetch ?? fetch;
  }

  public async generate(
    request: UserDictionaryGenerationRequest,
    signal: AbortSignal
  ): Promise<unknown> {
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.request(
          providerUrl(this.provider, this.model),
          providerRequestInit(
            this.provider,
            this.apiKey,
            this.model,
            this.thinkingOrEffort,
            request,
            signal
          )
        );
      } catch (error) {
        if (signal.aborted) throw error;
        if (attempt < this.maxAttempts - 1) {
          await waitForRetry(retryDelayMs(attempt), signal);
          continue;
        }
        throw providerFailure(this.provider, undefined, true);
      }
      if (!response.ok) {
        if (isRetryableLanguageModelStatus(response.status) && attempt < this.maxAttempts - 1) {
          await waitForRetry(
            retryDelayMs(attempt, response.headers.get('retry-after')),
            signal
          );
          continue;
        }
        throw providerFailure(
          this.provider,
          response.status,
          isRetryableLanguageModelStatus(response.status)
        );
      }
      const envelope = await response.json().catch(() => undefined);
      const raw = providerOutputText(this.provider, envelope);
      if (!raw) throw new UserDictionaryMalformedOutputError();
      try {
        return parseStructuredJson(raw);
      } catch {
        throw new UserDictionaryMalformedOutputError();
      }
    }
    throw providerFailure(this.provider, undefined, true);
  }
}

function validateGeneratedSense(value: unknown): GeneratedSense {
  if (!isRecord(value) || !hasExactFields(value, [
    'partOfSpeech', 'definition', 'usageNote', 'synonyms', 'antonyms',
    'relatedTerms', 'examples'
  ]) || typeof value.partOfSpeech !== 'string' || typeof value.definition !== 'string' ||
      !value.definition.trim() || typeof value.usageNote !== 'string' ||
      !isStringArray(value.synonyms, 20) || !isStringArray(value.antonyms, 20) ||
      !isStringArray(value.relatedTerms, 20) || !isStringArray(value.examples, 3)) {
    throw new UserDictionaryMalformedOutputError();
  }
  return {
    partOfSpeech: value.partOfSpeech.trim(),
    definition: value.definition.trim(),
    usageNote: value.usageNote.trim(),
    synonyms: cleanStrings(value.synonyms),
    antonyms: cleanStrings(value.antonyms),
    relatedTerms: cleanStrings(value.relatedTerms),
    examples: cleanStrings(value.examples)
  };
}

function boundedAttempts(value: number, fallback: number): number {
  return Math.max(1, Math.min(5, Number.isFinite(value) ? Math.floor(value) : fallback));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const expected = new Set(fields);
  return Object.keys(value).length === expected.size &&
    Object.keys(value).every((field) => expected.has(field));
}

function isStringArray(value: unknown, maximum: number): value is string[] {
  return Array.isArray(value) && value.length <= maximum &&
    value.every((item) => typeof item === 'string');
}

function cleanStrings(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function providerUrl(provider: UserDictionaryProvider, model: string): string {
  return structuredJsonUrl(provider, model);
}

function providerRequestInit(
  provider: UserDictionaryProvider,
  apiKey: string,
  model: string,
  thinkingOrEffort: UserDictionaryThinkingOrEffort,
  request: UserDictionaryGenerationRequest,
  signal: AbortSignal
): RequestInit {
  return structuredJsonRequestInit(
    {
      provider,
      model,
      thinkingOrEffort,
      apiKey,
      schema: USER_DICTIONARY_GENERATION_SCHEMA,
      schemaName: 'kren_user_dictionary_entry'
    },
    { instruction: request.instruction, input: request.expression },
    signal
  );
}

function providerOutputText(provider: UserDictionaryProvider, value: unknown): string | undefined {
  return structuredJsonOutputText(provider, value);
}

// The wording stays here rather than in the shared transport, because it names the User
// Dictionary and promises that no entry was saved. Smart Grammar Check has to say
// something different, and one message covering both would be true of neither.
function providerFailure(
  provider: UserDictionaryProvider,
  status: number | undefined,
  retryable: boolean
): ProviderError {
  return new ProviderError(
    `${structuredJsonProviderName(provider)} User Dictionary request failed${status === undefined ? '' : ` (${status})`}. No entry was saved.`,
    structuredJsonConfigureAction(provider),
    retryable,
    status
  );
}
