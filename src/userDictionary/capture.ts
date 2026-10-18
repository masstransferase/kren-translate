import { validateLanguageModelOutput } from '../languageModelUsage.js';
import { compatibleFailure, validatedCompatibleText } from '../providers/openAICompatible.js';
import { providerHttpError } from '../providers/httpError.js';
import { randomUUID } from 'node:crypto';
import { parseStructuredJson } from '@kren/core/structured-json';
import { requestWithRetry } from '../requestCenter.js';
import { ProviderError, attributeProviderError } from '../errors.js';
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
} from './providerContract.js';
import {
  userDictionaryGenerationSchema,
  UserDictionaryMalformedOutputError,
  assembleUserDictionaryDraft,
  normalizeUserDictionaryTerm,
  userDictionaryGenerationInstruction
} from './providerContract.js';
import type {
  UserDictionaryCaptureSettings,
  UserDictionaryThinkingOrEffort
} from './settings.js';
import { validateUserDictionaryEntry } from './providerContract.js';

export {
  userDictionaryGenerationSchema,
  UserDictionaryMalformedOutputError,
  assembleUserDictionaryDraft,
  userDictionaryGenerationInstruction
};
export type { UserDictionaryGenerationOptions };

export interface UserDictionaryGenerationRequest {
  instruction: string;
  expression: string;
  /**
   * Carried on the request rather than read from a constant by the transport, because the
   * schema now depends on whether a context sentence was supplied and the transport is the
   * one place that never knows. A transport reaching for the constant would send a provider
   * a schema that forbids the very field the instruction asks for.
   */
  schema: Record<string, unknown>;
}

export interface UserDictionaryProviderTransport {
  readonly provider: UserDictionaryProvider;
  readonly model: string;
  generate(request: UserDictionaryGenerationRequest, signal: AbortSignal): Promise<unknown>;
}

export interface UserDictionaryProviderTransportOptions {
  geminiProfile?: 'standard' | 'pro';
  provider: UserDictionaryProvider;
  apiKey: string;
  accountId?: string;
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
  pronunciation: string;
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
    termSuppliedByUser: options.termSuppliedByUser === true,
    ...(options.contextSentence ? { contextSentence: options.contextSentence } : {})
  };
  const request: UserDictionaryGenerationRequest = {
    instruction: userDictionaryGenerationInstruction(settings, generation),
    expression,
    schema: userDictionaryGenerationSchema(generation)
  };
  const attempts = boundedAttempts(options.maxMalformedAttempts ?? 3, 3);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await transport.generate(request, signal);
      return validateLanguageModelOutput(value, () => assembleUserDictionaryDraft(
        expression,
        settings,
        transport.provider,
        transport.model,
        value,
        options.now,
        options.uuid,
        generation
      ));
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
        ...(sense.pronunciation ? { pronunciation: sense.pronunciation } : {}),
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
  private readonly accountId?: string;
  private readonly geminiProfile: 'standard' | 'pro';
  private readonly thinkingOrEffort: UserDictionaryThinkingOrEffort;
  private readonly maxAttempts: number;
  private readonly request: typeof fetch;

  public constructor(options: UserDictionaryProviderTransportOptions) {
    this.provider = options.provider;
    this.apiKey = options.apiKey;
    this.accountId = options.accountId;
    this.geminiProfile = options.geminiProfile ?? 'standard';
    this.model = options.model;
    this.thinkingOrEffort = options.thinkingOrEffort;
    this.maxAttempts = boundedAttempts(options.maxAttempts, 3);
    this.request = options.fetch ?? fetch;
  }

  public async generate(
    request: UserDictionaryGenerationRequest, signal: AbortSignal
  ): Promise<unknown> {
    try { return await this.generateOnce(request, signal); }
    catch (error) { throw attributeProviderError(error, { provider: this.provider, model: this.model, geminiProfile: this.geminiProfile }); }
  }

  private async generateOnce(
    request: UserDictionaryGenerationRequest,
    signal: AbortSignal
  ): Promise<unknown> {
    return requestWithRetry({
      request: { feature: 'userDictionary', provider: this.provider, model: this.model, geminiProfile: this.geminiProfile },
      signal, maxAttempts: this.maxAttempts,
      send: () => this.request(structuredJsonUrl(this.provider, this.model, this.accountId),
        providerRequestInit(this.provider, this.apiKey, this.model, this.thinkingOrEffort, request, signal, this.accountId)),
      failure: ({ cause, status, retryable }) => cause === 'quotaExhausted'
        ? new ProviderError(`${this.provider} returned ${status}. Check provider quota and billing before retrying.`, undefined, false, status, 'quotaExhausted')
        : providerFailure(this.provider, status, retryable),
      refused: () => this.provider === 'groq' || this.provider === 'cloudflare' ? compatibleFailure(this.provider, 'refused')
        : new ProviderError(new UserDictionaryMalformedOutputError().message, undefined, false, undefined, 'refused'),
      decode: envelope => {
        const raw = this.provider === 'groq' || this.provider === 'cloudflare'
          ? validatedCompatibleText({ provider: this.provider, model: this.model, schema: request.schema }, envelope)
          : providerOutputText(this.provider, envelope);
        if (!raw) throw new UserDictionaryMalformedOutputError();
        try {
          const value = parseStructuredJson(raw);
          if (!isRecord(value)) throw new UserDictionaryMalformedOutputError();
          return value;
        } catch {
          throw new UserDictionaryMalformedOutputError();
        }
      }
    });
  }
}

function validateGeneratedSense(value: unknown): GeneratedSense {
  // The draft editor gained a per-sense pronunciation field for heteronyms. A draft that
  // predates it, or one whose field the host did not render, arrives without the key.
  const sense = isRecord(value) && !Object.hasOwn(value, 'pronunciation')
    ? { ...value, pronunciation: '' }
    : value;
  if (!isRecord(sense) || !hasExactFields(sense, [
    'partOfSpeech', 'pronunciation', 'definition', 'usageNote', 'synonyms', 'antonyms',
    'relatedTerms', 'examples'
  ]) || typeof sense.partOfSpeech !== 'string' || typeof sense.definition !== 'string' ||
      !sense.definition.trim() || typeof sense.usageNote !== 'string' ||
      !isStringArray(sense.synonyms, 20) || !isStringArray(sense.antonyms, 20) ||
      !isStringArray(sense.relatedTerms, 20) || !isStringArray(sense.examples, 3)) {
    throw new UserDictionaryMalformedOutputError();
  }
  return {
    partOfSpeech: sense.partOfSpeech.trim(),
    pronunciation: typeof sense.pronunciation === 'string' ? sense.pronunciation.trim() : '',
    definition: sense.definition.trim(),
    usageNote: sense.usageNote.trim(),
    synonyms: cleanStrings(sense.synonyms),
    antonyms: cleanStrings(sense.antonyms),
    relatedTerms: cleanStrings(sense.relatedTerms),
    examples: cleanStrings(sense.examples)
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
  signal: AbortSignal,
  accountId?: string
): RequestInit {
  return structuredJsonRequestInit(
    {
      provider,
      model,
      thinkingOrEffort,
      apiKey,
      accountId,
      schema: request.schema,
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
    (provider === 'groq' || provider === 'cloudflare') && status !== undefined
      ? providerHttpError(structuredJsonProviderName(provider), status) + ' No entry was saved.'
      : `${structuredJsonProviderName(provider)} User Dictionary request failed${status === undefined ? '' : ` (${status})`}. No entry was saved.`,
    structuredJsonConfigureAction(provider),
    retryable,
    status
  );
}
