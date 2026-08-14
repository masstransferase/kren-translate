import { randomUUID } from 'node:crypto';
import { parseStructuredJson } from '@kren/core/structured-json';
import {
  isRetryableLanguageModelStatus,
  retryDelayMs,
  waitForRetry
} from '@kren/core/retry';
import { ProviderError } from '../errors.js';
import { isPlausibleLanguageCode } from '../languages.js';
import type { DictionaryResult } from '../types.js';
import type {
  MerriamWebsterReferenceWork,
  UserDictionaryCaptureMode,
  UserDictionaryEntryV1,
  UserDictionaryProvider
} from './contract.js';
import { normalizeUserDictionaryTerm } from './normalization.js';
import type {
  UserDictionaryCaptureSettings,
  UserDictionaryThinkingOrEffort
} from './settings.js';
import { validateUserDictionaryEntry } from './validation.js';

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

export class UserDictionaryMalformedOutputError extends Error {
  public constructor() {
    super('The selected language-model provider returned malformed User Dictionary output. No entry was saved.');
    this.name = 'UserDictionaryMalformedOutputError';
  }
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

interface GeneratedDictionaryContent {
  language: string;
  entryType: string;
  domains: string[];
  tags: string[];
  pronunciation: string;
  senses: GeneratedSense[];
  aliases: string[];
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

export const USER_DICTIONARY_GENERATION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'language', 'entryType', 'domains', 'tags', 'pronunciation', 'senses', 'aliases'
  ],
  properties: {
    language: { type: 'string' },
    entryType: { type: 'string' },
    domains: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    pronunciation: { type: 'string' },
    senses: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'partOfSpeech', 'definition', 'usageNote', 'synonyms', 'antonyms',
          'relatedTerms', 'examples'
        ],
        properties: {
          partOfSpeech: { type: 'string' },
          definition: { type: 'string' },
          usageNote: { type: 'string' },
          synonyms: { type: 'array', items: { type: 'string' }, maxItems: 20 },
          antonyms: { type: 'array', items: { type: 'string' }, maxItems: 20 },
          relatedTerms: { type: 'array', items: { type: 'string' }, maxItems: 20 },
          examples: { type: 'array', items: { type: 'string' }, maxItems: 3 }
        }
      }
    },
    aliases: { type: 'array', items: { type: 'string' }, maxItems: 20 }
  }
};

export function userDictionaryGenerationInstruction(
  settings: UserDictionaryCaptureSettings
): string {
  const language = settings.entryLanguage === 'auto'
    ? 'Detect the expression language and return its BCP-47 language tag.'
    : `Use the BCP-47 entry language ${settings.entryLanguage}.`;
  return [
    'Create a concise personal dictionary draft for exactly the expression supplied by the user.',
    'No surrounding document context exists. Do not infer a file, workspace, author, audience, or unstated context.',
    language,
    // Stated literally rather than by reference. OpenAI and Anthropic receive
    // USER_DICTIONARY_GENERATION_SCHEMA, but Gemini cannot, so an instruction that says
    // "follow the supplied schema" is simply false on that path. The shape is repeated
    // here because a prompt that describes a schema nobody sent produces malformed output
    // and a bounded retry loop that never converges.
    'Return JSON only, with exactly this shape and no other keys:',
    '{"language":"BCP-47 tag","entryType":"short label","domains":[],"tags":[],' +
      '"pronunciation":"","senses":[{"partOfSpeech":"","definition":"","usageNote":"",' +
      '"synonyms":[],"antonyms":[],"relatedTerms":[],"examples":[]}],"aliases":[]}',
    'Use at least one sense with a non-empty definition. Keep every claim within ordinary lexical knowledge.',
    settings.includePronunciation
      ? 'Include a readable pronunciation when appropriate; otherwise return an empty pronunciation string.'
      : 'Return an empty pronunciation string.',
    settings.includeSynonyms
      ? 'Include relevant synonyms, antonyms, and related expressions.'
      : 'Return empty synonyms, antonyms, and relatedTerms arrays.',
    settings.includeUsageNotes
      ? 'Include a short usage note only when it prevents misunderstanding.'
      : 'Return an empty usageNote string for every sense.',
    `Return no more than ${settings.numberOfExamples} example${settings.numberOfExamples === 1 ? '' : 's'} per sense.`,
    settings.includeTechnicalMeanings
      ? 'Include established technical meanings when they are genuinely applicable.'
      : 'Do not add a technical sense solely because one might exist.'
  ].join('\n');
}

export async function captureUserDictionaryDraft(
  expression: string,
  settings: UserDictionaryCaptureSettings,
  transport: UserDictionaryProviderTransport,
  signal: AbortSignal,
  options: {
    maxMalformedAttempts?: number;
    now?: () => string;
    uuid?: () => string;
  } = {}
): Promise<UserDictionaryEntryV1> {
  const request: UserDictionaryGenerationRequest = {
    instruction: userDictionaryGenerationInstruction(settings),
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
        options.uuid
      );
    } catch (error) {
      if (!(error instanceof UserDictionaryMalformedOutputError) || attempt >= attempts - 1) {
        throw error;
      }
    }
  }
  throw new UserDictionaryMalformedOutputError();
}

export function assembleUserDictionaryDraft(
  expression: string,
  settings: UserDictionaryCaptureSettings,
  provider: UserDictionaryProvider,
  model: string,
  value: unknown,
  now: () => string = () => new Date().toISOString(),
  uuid: () => string = randomUUID
): UserDictionaryEntryV1 {
  const content = validateGeneratedContent(value);
  const timestamp = now();
  const entry: UserDictionaryEntryV1 = {
    schemaVersion: 1,
    id: uuid(),
    term: expression,
    normalizedTerm: normalizeUserDictionaryTerm(expression),
    language: settings.entryLanguage === 'auto' ? content.language : settings.entryLanguage,
    entryType: content.entryType,
    collection: 'Other',
    domains: content.domains,
    tags: content.tags,
    ...(settings.includePronunciation && content.pronunciation
      ? { pronunciation: { display: content.pronunciation, audioAvailable: false } }
      : {}),
    senses: content.senses.map((sense) => ({
      id: uuid(),
      ...(sense.partOfSpeech ? { partOfSpeech: sense.partOfSpeech } : {}),
      definition: sense.definition,
      ...(settings.includeUsageNotes && sense.usageNote
        ? { usageNote: sense.usageNote }
        : {}),
      synonyms: settings.includeSynonyms ? sense.synonyms : [],
      antonyms: settings.includeSynonyms ? sense.antonyms : [],
      relatedTerms: settings.includeSynonyms ? sense.relatedTerms : [],
      examples: sense.examples.slice(0, settings.numberOfExamples)
    })),
    aliases: content.aliases,
    capture: {
      mode: settings.captureMode,
      provider,
      model,
      generatedAt: timestamp,
      userEdited: false
    },
    createdAt: timestamp,
    updatedAt: timestamp
  };
  try {
    return validateUserDictionaryEntry(entry);
  } catch {
    throw new UserDictionaryMalformedOutputError();
  }
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

function validateGeneratedContent(value: unknown): GeneratedDictionaryContent {
  if (!isRecord(value) || !hasExactFields(value, [
    'language', 'entryType', 'domains', 'tags', 'pronunciation', 'senses', 'aliases'
  ])) throw new UserDictionaryMalformedOutputError();
  if (typeof value.language !== 'string' || !isPlausibleLanguageCode(value.language) ||
      typeof value.entryType !== 'string' || !value.entryType.trim() ||
      typeof value.pronunciation !== 'string' ||
      !isStringArray(value.domains, 12) || !isStringArray(value.tags, 20) ||
      !isStringArray(value.aliases, 20) || !Array.isArray(value.senses) ||
      value.senses.length < 1 || value.senses.length > 12) {
    throw new UserDictionaryMalformedOutputError();
  }
  const senses = value.senses.map((sense) => validateGeneratedSense(sense));
  return {
    language: value.language,
    entryType: value.entryType.trim(),
    domains: cleanStrings(value.domains),
    tags: cleanStrings(value.tags),
    pronunciation: value.pronunciation.trim(),
    senses,
    aliases: cleanStrings(value.aliases)
  };
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

function providerUrl(provider: UserDictionaryProvider, model: string): string {
  if (provider === 'gemini') {
    const modelId = model.replace(/^models\//u, '');
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
  }
  return provider === 'openai'
    ? 'https://api.openai.com/v1/responses'
    : 'https://api.anthropic.com/v1/messages';
}

function providerRequestInit(
  provider: UserDictionaryProvider,
  apiKey: string,
  model: string,
  thinkingOrEffort: UserDictionaryThinkingOrEffort,
  request: UserDictionaryGenerationRequest,
  signal: AbortSignal
): RequestInit {
  if (provider === 'gemini') {
    const thinking = thinkingOrEffort === 'auto' || thinkingOrEffort === 'none'
      ? {}
      : { thinkingConfig: { thinkingLevel: thinkingOrEffort } };
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.instruction }] },
        contents: [{ role: 'user', parts: [{ text: request.expression }] }],
        // No schema field. Gemini's structured-output schema is an OpenAPI subset and
        // rejects `additionalProperties`, which USER_DICTIONARY_GENERATION_SCHEMA sets to
        // false because OpenAI's strict mode requires it. Sending the schema to Gemini
        // returns 400 on every model, which is what "failed (400)" meant in testing.
        //
        // The instruction states the required shape, exactly as the rewrite provider in
        // src/providers/gemini.ts does, and KREN validates the parsed result afterwards.
        // Validation is the real gate in either case: a provider-declared schema is a
        // hint, and a malformed response still has to be caught locally.
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          ...thinking
        }
      }),
      signal
    };
  }
  if (provider === 'openai') {
    const effort = thinkingOrEffort === 'minimal' ? 'low' : thinkingOrEffort;
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        instructions: request.instruction,
        input: [{ role: 'user', content: [{ type: 'input_text', text: request.expression }] }],
        store: false,
        max_output_tokens: 4096,
        text: {
          format: {
            type: 'json_schema',
            name: 'kren_user_dictionary_entry',
            strict: true,
            schema: USER_DICTIONARY_GENERATION_SCHEMA
          }
        },
        ...(effort === 'auto' ? {} : { reasoning: { effort } })
      }),
      signal
    };
  }
  const effort = thinkingOrEffort === 'auto'
    ? {}
    : { effort: thinkingOrEffort === 'none' || thinkingOrEffort === 'minimal'
      ? 'low'
      : thinkingOrEffort };
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: request.instruction,
      messages: [{ role: 'user', content: [{ type: 'text', text: request.expression }] }],
      output_config: {
        format: { type: 'json_schema', schema: USER_DICTIONARY_GENERATION_SCHEMA },
        ...effort
      }
    }),
    signal
  };
}

function providerOutputText(provider: UserDictionaryProvider, value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (provider === 'gemini') {
    const candidates = value.candidates;
    if (!Array.isArray(candidates)) return undefined;
    const candidate = candidates[0];
    if (!isRecord(candidate) || !isRecord(candidate.content) ||
        !Array.isArray(candidate.content.parts)) return undefined;
    const text = candidate.content.parts
      .flatMap((part) => isRecord(part) && typeof part.text === 'string' ? [part.text] : [])
      .join('')
      .trim();
    return text || undefined;
  }
  if (provider === 'openai') {
    if (!Array.isArray(value.output)) return undefined;
    for (const output of value.output) {
      if (!isRecord(output) || !Array.isArray(output.content)) continue;
      for (const content of output.content) {
        if (isRecord(content) && content.type === 'output_text' &&
            typeof content.text === 'string' && content.text.trim()) return content.text.trim();
      }
    }
    return undefined;
  }
  if (!Array.isArray(value.content)) return undefined;
  const block = value.content.find((item) =>
    isRecord(item) && item.type === 'text' && typeof item.text === 'string'
  );
  return isRecord(block) && typeof block.text === 'string' && block.text.trim()
    ? block.text.trim()
    : undefined;
}

function providerFailure(
  provider: UserDictionaryProvider,
  status: number | undefined,
  retryable: boolean
): ProviderError {
  const label = provider === 'gemini' ? 'Gemini' : provider === 'openai' ? 'OpenAI' : 'Anthropic';
  const action = provider === 'gemini'
    ? 'configureGeminiModel' as const
    : provider === 'openai'
      ? 'configureOpenAIModel' as const
      : 'configureAnthropicModel' as const;
  return new ProviderError(
    `${label} User Dictionary request failed${status === undefined ? '' : ` (${status})`}. No entry was saved.`,
    action,
    retryable,
    status
  );
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
