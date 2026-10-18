import { normalizeGeminiModel } from './geminiModels.js';
import { requestWithRetry, classifyRequestStatus } from '../requestCenter.js';
import { usageTrackedFetch, validateLanguageModelOutput } from '../languageModelUsage.js';
import { providerHttpError, providerIdentifier } from './httpError.js';
import { ProviderError, attributeProviderError } from '../errors.js';
import { isSameLanguage, languageName } from '../languages.js';
import { parseStructuredJson } from '@kren/core/structured-json';
import { isEnglishLanguageCode } from '@kren/core/languages';
import { normalizeLanguageCode } from '@kren/core/validation';
import {
  retryDelayMs as coreRetryDelayMs,
  waitForRetry
} from '@kren/core/retry';
import type {
  RewriteRequest,
  RewriteResult,
  RewriteVariant,
  RewriteVariantId,
  LanguageModelProvider,
  TranslationProvider,
  TranslationRequest,
  TranslationResult
} from '../types.js';
import {
  isRewriteVariantId,
  REWRITE_OUTPUT_RULES,
  REWRITE_PRIORITY_RULE,
  REWRITE_WORKED_EXAMPLE,
  REWRITE_VARIANT_IDS,
  REWRITE_VARIANT_LIST,
  REWRITE_VARIANTS,
  rewriteVariantLabel
} from '../rewriteVariants.js';
import {
  REWRITE_DOMAINS,
  REWRITE_ENGLISH_VARIETIES,
  rewriteOutputLanguageCode,
  REWRITE_FORMALITIES,
  REWRITE_FUNCTIONS,
  REWRITE_LENGTHS,
  REWRITE_MODALITIES,
  REWRITE_PERSPECTIVES,
  REWRITE_RHETORICAL_MODES,
  REWRITE_STANCES,
  REWRITE_VOICES,
  rewriteAxisInstruction
} from '@kren/core/rewrite-axes';
import { EXPLANATION_SAME_AS_SOURCE } from '../types.js';

interface GeminiPayload {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown }> };
  }>;
  error?: { message?: unknown; details?: unknown; status?: unknown };
}

export type GeminiQuotaCategory = 'perDay' | 'perMinute' | 'perHour' | 'other';

export interface GeminiRateLimitClassification {
  kind: 'rateLimit' | 'quotaExhausted' | 'unknown';
  retryable: boolean;
  quotaCategory?: GeminiQuotaCategory;
  /** Google's quota limit for the violated quota, digits only (0 means the tier has none). */
  quotaLimit?: string;
  retryDelayMs?: number;
}

export const GEMINI_TRANSCRIPTION_MODEL = 'gemini-3.5-transcribe';

export interface GeminiTranscriptionRequestBody {
  contents: Array<{
    role: 'user';
    parts: Array<{ inlineData: { mimeType: 'audio/wav'; data: string } }>;
  }>;
}

/**
 * The complete transcription request body. It contains the explicit recording and no
 * editor, workspace, tutor, credential, or other provider context.
 */
export function buildGeminiTranscriptionRequestBody(
  audio: Uint8Array
): GeminiTranscriptionRequestBody {
  return {
    contents: [{
      role: 'user',
      parts: [{
        inlineData: {
          mimeType: 'audio/wav',
          data: Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength).toString('base64')
        }
      }]
    }]
  };
}

/**
 * Sends one WAV inline to Google's non-live transcription model and returns only text.
 * Inline media avoids creating a second audio file through Google's Files API.
 */
export async function transcribeGeminiAudio(
  apiKey: string,
  audio: Uint8Array,
  signal: AbortSignal,
  maxAttempts = 4,
  fetcher: typeof fetch = fetch
): Promise<string> {
  if (audio.byteLength === 0) throw new ProviderError('The microphone recording was empty.');
  if (audio.byteLength > 20 * 1024 * 1024) {
    throw new ProviderError('The microphone recording is too large to send inline to Gemini.');
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TRANSCRIPTION_MODEL}:generateContent`;
  const body = JSON.stringify(buildGeminiTranscriptionRequestBody(audio));
  const requestedAttempts = Number.isFinite(maxAttempts) ? maxAttempts : 4;
  const attempts = Math.max(1, Math.min(5, Math.floor(requestedAttempts)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response;
    try {
      response = await usageTrackedFetch({ feature: 'dictation', provider: 'gemini', model: GEMINI_TRANSCRIPTION_MODEL }, fetcher)(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body,
        signal
      });
    } catch (error) {
      if (signal.aborted) throw error;
      if (attempt < attempts - 1) {
        await waitForRetry(retryDelayMs(attempt), signal);
        continue;
      }
      throw new ProviderError(
        `Gemini transcription could not be reached after ${attempts} ${attempts === 1 ? 'attempt' : 'attempts'}.`,
        'configureGeminiModel',
        true
      );
    }
    const payload = (await response.json().catch(() => ({}))) as GeminiPayload;
    if (!response.ok) {
      if (isRetryableGeminiStatus(response.status, payload) && attempt < attempts - 1) {
        await waitForRetry(
          retryDelayMs(attempt, response.headers.get('retry-after'), payload), signal
        );
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError(
          'Gemini transcription authentication failed. Check the Gemini Free Tier API key.',
          'setGeminiKey',
          false,
          response.status
        );
      }
      throw new ProviderError(
        `Gemini transcription request failed (${response.status}).`,
        'configureGeminiModel',
        isRetryableGeminiStatus(response.status, payload),
        response.status
      );
    }
    const transcript = payload.candidates?.[0]?.content?.parts
      ?.map((part) => typeof part.text === 'string' ? part.text : '')
      .join('')
      .trim();
    if (!transcript) throw new ProviderError('Gemini returned an empty transcript.');
    return transcript;
  }
  throw new ProviderError(`Gemini transcription failed after ${attempts} attempts.`);
}

export class GeminiProvider implements TranslationProvider, LanguageModelProvider {
  public readonly id = 'gemini' as const;

  public constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly modelAction: 'configureGeminiModel' | 'configureGeminiProModel' = 'configureGeminiModel',
    private readonly thinkingLevel?: GeminiThinkingLevel,
    private readonly maxAttempts = 4
  ) {}

  public async translate(
    request: TranslationRequest,
    signal: AbortSignal
  ): Promise<TranslationResult> {
    const value = await this.generate(
      buildGeminiRequestBody(request, this.thinkingLevel ?? thinkingLevelForModel(this.model)),
      signal, request.operation === 'translate' ? 'translation' : 'explanation'
    );
    return {
      ...normalizeGeminiResult(value, request, this.id),
      modelId: normalizeGeminiModel(this.model).replace(/^models\//u, '')
    };
  }

  public async explain(
    request: TranslationRequest,
    signal: AbortSignal
  ): Promise<TranslationResult> {
    return this.translate(request, signal);
  }

  public async rewrite(
    request: RewriteRequest,
    signal: AbortSignal
  ): Promise<RewriteResult> {
    const value = await this.generate(
      buildGeminiRewriteRequestBody(
        request,
        this.thinkingLevel ?? thinkingLevelForModel(this.model)
      ),
      signal, 'rewrite'
    );
    return {
      ...normalizeGeminiRewriteResult(value, request, this.id),
      modelId: normalizeGeminiModel(this.model).replace(/^models\//u, '')
    };
  }

  private async generate(
    requestBody: ReturnType<typeof buildGeminiRequestBody>, signal: AbortSignal, feature: string
  ): Promise<unknown> {
    try { return await this.generateOnce(requestBody, signal, feature); }
    catch (error) { throw attributeProviderError(error, { provider: 'gemini', model: this.model,
      geminiProfile: this.modelAction === 'configureGeminiProModel' ? 'pro' : 'standard' }); }
  }

  private async generateOnce(
    requestBody: ReturnType<typeof buildGeminiRequestBody>,
    signal: AbortSignal,
    feature: string
  ): Promise<unknown> {
    const modelId = normalizeGeminiModel(this.model).replace(/^models\//u, '');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
    const body = JSON.stringify(requestBody);

    const attempts = Number.isFinite(this.maxAttempts) ? this.maxAttempts : 4;
    return requestWithRetry({
      request: { feature, provider: this.id, model: this.model,
        geminiProfile: this.modelAction === 'configureGeminiProModel' ? 'pro' : 'standard' },
      signal, maxAttempts: attempts,
      send: () => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey }, body, signal }),
      failure: ({ cause, status, retryable, envelope, attempts: count }) => {
        if (status === undefined) return new ProviderError(
          `Gemini could not be reached after ${count} ${count === 1 ? 'attempt' : 'attempts'}.`, this.modelAction, true);
        if (status === 404) return new ProviderError(`Gemini model ${this.model} is unavailable (404).`, this.modelAction, false, status);
        if (cause === 'overloaded') return new ProviderError(
          `Gemini model ${this.model} is temporarily overloaded after ${count} ${count === 1 ? 'attempt' : 'attempts'}. KREN ${count > 1 ? 'retried automatically. ' : ''}Try again shortly or choose another Gemini model.`,
          this.modelAction, true, status, 'overloaded');
        if (cause === 'quotaExhausted') return new ProviderError(providerHttpError('Gemini', status) + geminiErrorMetadata(envelope), this.modelAction, false, status, 'quotaExhausted');
        if (retryable) return new ProviderError(
          `Gemini returned a temporary ${status} response after ${count} ${count === 1 ? 'attempt' : 'attempts'}. Try again shortly or choose another Gemini model.`, this.modelAction, true, status);
        return new ProviderError(providerHttpError('Gemini', status));
      },
      refused: () => new ProviderError('Gemini returned no result.', this.modelAction, false, undefined, 'refused'),
      decode: envelope => {
        const payload = (envelope ?? {}) as GeminiPayload;
        const rawText = payload.candidates?.[0]?.content?.parts?.map(part => typeof part.text === 'string' ? part.text : '').join('').trim();
        if (!rawText) throw new ProviderError('Gemini returned no result.', this.modelAction, true, undefined, 'structuredOutput');
        return parseJson(rawText, 'Gemini');
      }
    });
  }
}

export function buildGeminiRewriteRequestBody(
  request: RewriteRequest,
  thinkingLevel: GeminiThinkingLevel | undefined = 'minimal'
): ReturnType<typeof buildGeminiRequestBody> {
  return {
    systemInstruction: {
      parts: [{ text: rewriteSystemInstruction(request) }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: request.text }]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {})
    }
  };
}

export type GeminiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export function buildGeminiRequestBody(
  request: TranslationRequest,
  thinkingLevel: GeminiThinkingLevel | undefined = 'minimal'
): {
  systemInstruction: { parts: Array<{ text: string }> };
  contents: Array<{ role: 'user'; parts: Array<{ text: string }> }>;
  generationConfig: {
    responseMimeType: 'application/json';
    thinkingConfig?: { thinkingLevel: GeminiThinkingLevel };
  };
} {
  return {
    // This is static KREN guidance derived only from lookup type and language settings.
    systemInstruction: {
      parts: [{ text: systemInstruction(request) }]
    },
    // The exact selected text is the only user-authored content sent to Gemini.
    contents: [
      {
        role: 'user',
        parts: [{ text: request.text }]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {})
    }
  };
}

export function thinkingLevelForModel(model: string): GeminiThinkingLevel | undefined {
  const normalized = model.replace(/^models\//u, '').toLocaleLowerCase('en-US');
  if (/^gemini-(?:3(?:\.\d+)?-.*pro|2\.5-|3\.8-flash(?:$|-))/u.test(normalized)) return 'low';
  if (/^gemini-3(?:\.\d+)?-.*flash/u.test(normalized)) return 'minimal';
  return undefined;
}

export function configuredThinkingLevel(
  model: string,
  configured: GeminiThinkingLevel | 'auto'
): GeminiThinkingLevel | undefined {
  const automatic = thinkingLevelForModel(model);
  if (configured === 'auto') return automatic;
  const normalized = model.replace(/^models\//u, '').toLocaleLowerCase('en-US');
  if (configured === 'minimal' && /^gemini-(?:3(?:\.\d+)?-.*pro|2\.5-|3\.8-flash(?:$|-))/u.test(normalized)) {
    return 'low';
  }
  return configured;
}

export function isRetryableGeminiStatus(status: number, payload?: unknown): boolean {
  return classifyRequestStatus('gemini', status, payload).retryable;
}

function retryDelayMs(
  attempt: number,
  retryAfter: string | null = null,
  payload?: unknown
): number {
  const googleDelay = payload === undefined
    ? undefined : classifyGeminiRateLimit(payload).retryDelayMs;
  if (googleDelay !== undefined) return googleDelay;
  return coreRetryDelayMs(attempt, retryAfter, {
    baseDelayMs: 1_250,
    jitterMs: 500,
    parseHttpDate: true
  });
}

/** Provider-controlled quota names stay local; only a fixed window token leaves this module. */
function geminiQuotaCategory(value: unknown): GeminiQuotaCategory {
  if (typeof value !== 'string') return 'other';
  if (/per[_ -]?day|daily/iu.test(value)) return 'perDay';
  if (/per[_ -]?minute/iu.test(value)) return 'perMinute';
  if (/per[_ -]?hour/iu.test(value)) return 'perHour';
  return 'other';
}

/**
 * Distinguishes a short Google rate window from a quota that cannot succeed on another
 * immediate attempt. Google reports both as 429 RESOURCE_EXHAUSTED, so the status alone is
 * deliberately insufficient.
 */
export function classifyGeminiRateLimit(payload: unknown): GeminiRateLimitClassification {
  const error = recordValue(payload)?.error;
  const errorRecord = recordValue(error);
  const details = Array.isArray(errorRecord?.details) ? errorRecord.details : [];
  let quotaCategory: GeminiQuotaCategory | undefined;
  let quotaValue: string | undefined;
  let retryDelay: number | undefined;
  const quotaDescriptions: string[] = [];
  for (const detail of details) {
    const item = recordValue(detail);
    if (!item) continue;
    if (String(item['@type'] ?? '').endsWith('google.rpc.RetryInfo')) {
      retryDelay = googleDurationMs(item.retryDelay);
    }
    if (!String(item['@type'] ?? '').endsWith('google.rpc.QuotaFailure') ||
        !Array.isArray(item.violations)) continue;
    for (const violation of item.violations) {
      const entry = recordValue(violation);
      if (!entry) continue;
      if (!quotaCategory && Object.hasOwn(entry, 'quotaId')) quotaCategory = geminiQuotaCategory(entry.quotaId);
      const candidateValue = stringField(entry.quotaValue);
      if (candidateValue !== undefined) quotaValue = candidateValue;
      for (const value of [entry.quotaId, entry.quotaMetric, entry.description]) {
        if (typeof value === 'string') quotaDescriptions.push(value);
      }
    }
  }
  const quotaText = quotaDescriptions.join(' ').toLocaleLowerCase('en-US');
  const message = typeof errorRecord?.message === 'string'
    ? errorRecord.message.toLocaleLowerCase('en-US') : '';
  // Google's generic 429 message can say "current quota" for a per-minute limit too. The
  // QuotaFailure window therefore outranks that wording whenever Google supplied one.
  const shortWindow = /per[_ -]?(?:second|minute)|requests?[_ -]per[_ -](?:second|minute)/u
    .test(quotaText);
  const longWindow = /per[_ -]?(?:day|month)|daily|monthly/u.test(quotaText);
  const limit = quotaValue !== undefined && /^\d{1,12}$/u.test(quotaValue) ? { quotaLimit: quotaValue } : {};
  const hardLimit = quotaValue === '0' || longWindow || (!shortWindow &&
    /exceeded your current quota|check your plan and billing/u.test(message));
  if (hardLimit) {
    return { kind: 'quotaExhausted', retryable: false, ...(quotaCategory ? { quotaCategory } : {}), ...limit, ...(retryDelay === undefined ? {} : { retryDelayMs: retryDelay }) };
  }
  if (shortWindow || retryDelay !== undefined) {
    return {
      kind: 'rateLimit', retryable: true,
      ...(quotaCategory ? { quotaCategory } : {}), ...limit,
      ...(retryDelay === undefined ? {} : { retryDelayMs: retryDelay })
    };
  }
  return { kind: 'unknown', retryable: true, ...(quotaCategory ? { quotaCategory } : {}), ...limit };
}

/** Whitelisted structured diagnostics, never the provider's free-text message or links. */
export function geminiErrorMetadata(payload: unknown): string {
  const { quotaCategory, quotaLimit, retryDelayMs } = classifyGeminiRateLimit(payload);
  const fields = { ...(quotaCategory ? { quotaCategory } : {}), ...(quotaLimit === undefined ? {} : { limit: quotaLimit }), ...(retryDelayMs === undefined ? {} : { retryDelay: `${retryDelayMs / 1000}s` }) };
  return Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : '';
}

function googleDurationMs(value: unknown): number | undefined {
  if (!providerIdentifier(value)) return undefined;
  const match = /^(\d+(?:\.\d+)?)s$/u.exec(value as string);
  if (!match) return undefined;
  const milliseconds = Math.round(Number(match[1]) * 1000);
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0 ? milliseconds : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * The subject-area line, or nothing.
 *
 * `general` and an absent domain both add nothing. The instructions are the ones the
 * Rewrite Text axis already carries, so a subject area means the same thing whichever
 * feature asked for it rather than being described twice in two voices.
 */
function domainInstruction(request: TranslationRequest): string | undefined {
  if (!request.domain || request.domain === REWRITE_DOMAINS[0].id) return undefined;
  return rewriteAxisInstruction(REWRITE_DOMAINS, request.domain);
}

export function systemInstruction(request: TranslationRequest): string {
  const source = request.sourceLanguage === 'auto'
    ? 'automatically detected source language'
    : languageName(request.sourceLanguage);
  const target = languageName(request.targetLanguage);
  if (request.operation === 'explain') {
    const explanationLanguage =
      request.explanationLanguage === EXPLANATION_SAME_AS_SOURCE ||
        request.explanationLanguage === undefined
        ? 'the same language as the selected text, and that language only'
        : `${languageName(request.explanationLanguage)} only`;
    /*
     * When the explanation language is the language the text is already in, there is no
     * equivalent to give: asking for "a natural English equivalent" of English text is a
     * request the model can only answer by translating somewhere or by echoing. Ask for a
     * plain restatement instead, which is what a reader wants beside a note in their own
     * language.
     */
    const sameLanguage = isSameLanguage(request.sourceLanguage, request.targetLanguage);
    const equivalent = sameLanguage
      ? `restate it plainly in ${target}`
      : `give a natural ${target} equivalent`;
    return [
      `Explain the selected ${source} text and ${equivalent}.`,
      ...(domainInstruction(request) ? [domainInstruction(request)!] : []),
      'Return JSON only with this shape:',
      '{"kind":"translation","translatedText":"natural equivalent","alternatives":["optional alternative"],"note":"meaning and nuance explanation"}',
      `Write the note in ${explanationLanguage}.`,
      'Explain contextual meaning, nuance, register, connotation, ambiguity, and relevant technical usage.',
      'Do not infer or mention any document context because none is provided.'
    ].join('\n');
  }

  return [
    `Translate the selected ${source} text into natural ${target}.`,
    ...(domainInstruction(request) ? [domainInstruction(request)!] : []),
    'Preserve Markdown, code identifiers, placeholders, citations, filenames, and technical terminology.',
    'Return JSON only with this shape:',
    '{"kind":"translation","translatedText":"string","alternatives":["optional string"],"note":"optional concise nuance explanation"}',
    'Include a note only when needed to prevent misunderstanding.'
  ].join('\n');
}

export function rewriteSystemInstruction(request: RewriteRequest): string {
  // Rewrite Text never translated, and until 2026-08-24 it could not be asked to. The output
  // language axis existed but this rule said "never translate it" and won, so the owner
  // selected American English on Korean text and got Korean back. detectedLanguage still
  // names what was written, because the reader needs to know what KREN thought it read; the
  // output language is a separate question and is now answered separately.
  const outputLanguage = rewriteOutputLanguageCode(
    request.englishVariety,
    request.otherOutputLanguage
  );
  const detect = request.sourceLanguage === 'auto'
    ? 'Detect the dominant natural language of the supplied text and return its BCP-47 language code in detectedLanguage.'
    : `The source language is ${languageName(request.sourceLanguage)} (${request.sourceLanguage}). Return "${request.sourceLanguage}" in detectedLanguage.`;
  const write = outputLanguage === undefined
    ? 'Write every variant in that same language and never translate it.'
    : `Write every variant in ${languageName(outputLanguage)}, translating the text when it is written in another language. detectedLanguage still reports the language of the supplied text, not the language you wrote in.`;
  const languageInstruction = `${detect} ${write}`;
  const commonInstructions = [
    // First, and deliberately. The owner proved the ranking matters on 2026-08-20: the
    // same model, given this requirement first, changed the sentence, and given it at line
    // eight behind three preservation lines, returned the sentence unchanged.
    REWRITE_PRIORITY_RULE,
    'Rewrite only the exact text supplied by the user.',
    languageInstruction,
    'Preserve its factual meaning, claims, qualifications, numbers, and citations.',
    'Preserve intentional mixed-language terms, names, quotations, code, and necessary domain terminology.',
    // Said outright, because a run of preservation rules otherwise reads as an instruction
    // to keep the words too, and that is the reading that produced the failure.
    'These preservation rules govern meaning, not wording. Choosing different words to carry the same meaning is expected of every variant and is never a violation of them.',
    'Correct grammar and unnatural phrasing. Do not add facts, evidence, promises, certainty, examples, or document context.',
    'Never intensify a claim beyond the evidence or qualifications present in the supplied text.',
    'Return JSON only. Every variant must be complete and usable on its own.'
  ];
  const fullRewriteInstructions: string[] = [];
  pushInstruction(fullRewriteInstructions, rewriteAxisInstruction(REWRITE_FUNCTIONS, request.function));
  pushInstruction(fullRewriteInstructions, rewriteAxisInstruction(REWRITE_DOMAINS, request.domain));
  const englishVarietyInstruction = rewriteAxisInstruction(
    REWRITE_ENGLISH_VARIETIES,
    request.englishVariety
  );
  // Ungated as of 2026-08-24. This used to read "Only when detectedLanguage is English",
  // which meant selecting an English variety on Korean text applied nothing at all: the
  // gate asked about the language read rather than the language asked for. The variety is
  // now a property of the output, and Same as source carries its own instruction saying to
  // keep the source language, so there is no case left where it should be ignored.
  if (englishVarietyInstruction) {
    fullRewriteInstructions.push(englishVarietyInstruction);
  }
  pushInstruction(fullRewriteInstructions, rewriteAxisInstruction(REWRITE_FORMALITIES, request.formality));
  pushInstruction(fullRewriteInstructions, rewriteAxisInstruction(REWRITE_VOICES, request.voice));
  pushInstruction(fullRewriteInstructions, rewriteAxisInstruction(REWRITE_STANCES, request.stance));
  pushInstruction(fullRewriteInstructions, rewriteAxisInstruction(REWRITE_PERSPECTIVES, request.perspective));
  pushInstruction(
    fullRewriteInstructions,
    rewriteAxisInstruction(REWRITE_RHETORICAL_MODES, request.rhetoricalMode)
  );
  pushInstruction(fullRewriteInstructions, rewriteAxisInstruction(REWRITE_MODALITIES, request.modality));
  pushInstruction(fullRewriteInstructions, rewriteAxisInstruction(REWRITE_LENGTHS, request.length));
  const formattingInstruction = 'Preserve Markdown, LaTeX commands, citations, links, placeholders, code identifiers, filenames, inline code, and fenced code blocks exactly unless grammar inside ordinary prose requires a change.';
  const outputRulesInstruction = `The following output rules apply to every requested variant: ${REWRITE_OUTPUT_RULES.join(' ')}`;
  const changeNoteField = request.includeChangeNotes
    ? ',"changeNote":"one concise sentence describing the important edits"'
    : '';
  const changeNoteInstruction = request.includeChangeNotes
    ? 'For each variant, include a concise changeNote describing only the important edits.'
    : 'Do not include commentary or change notes.';
  const singleVariant = rewriteOperationVariant(request.operation);
  const requestedVariants = singleVariant
    ? REWRITE_VARIANTS.filter((variant) => variant.id === singleVariant)
    : REWRITE_VARIANTS;
  const variantInstructions: string[] = [];
  for (const [index, variant] of requestedVariants.entries()) {
    variantInstructions.push(`${index + 1}. ${variant.instruction}`);
    if (variant.id === 'minimal' && request.preserveFormatting !== false) {
      variantInstructions.push(`Minimal Rewrite formatting requirement: ${formattingInstruction}`);
    }
    if (variant.id === 'full') {
      variantInstructions.push('Style settings for Full Rewrite only:');
      variantInstructions.push(...fullRewriteInstructions);
      if (request.preserveFormatting !== false && request.modality === REWRITE_MODALITIES[0].id) {
        variantInstructions.push(`Full Rewrite formatting requirement: ${formattingInstruction}`);
      }
    }
  }
  const schemaVariants = requestedVariants.map((variant) =>
    `{"id":"${variant.id}","label":"${variant.label}","text":"rewritten text"${changeNoteField}}`
  ).join(',');
  return [
    ...commonInstructions,
    outputRulesInstruction,
    `Produce exactly ${requestedVariants.length === 1 ? 'one' : 'two'} variant${requestedVariants.length === 1 ? '' : 's'}:`,
    ...variantInstructions,
    changeNoteInstruction,
    // Last, where it is closest to the answer. Smart Grammar Check carries examples and
    // corrected the owner's sentence on 2026-08-20; the rewrites carried none and did not.
    REWRITE_WORKED_EXAMPLE,
    `Return exactly this JSON shape${requestedVariants.length > 1 ? ' and order' : ''}:`,
    `{"kind":"rewrite","detectedLanguage":"BCP-47 code","variants":[${schemaVariants}]}`
  ].join('\n');
}

export function parseJson(raw: string, providerName = 'Provider'): unknown {
  try {
    const value = parseStructuredJson(raw);
    if (!isRecord(value)) throw new Error();
    return value;
  } catch {
    throw new ProviderError(
      `${providerName} returned malformed structured output. Try again.`,
      undefined,
      true,
      undefined,
      'structuredOutput'
    );
  }
}

export function normalizeGeminiResult(
  value: unknown,
  request: TranslationRequest,
  providerId: string
): TranslationResult {
  return validateLanguageModelOutput(value, () => normalizeGeminiResultOnce(value, request, providerId));
}

function normalizeGeminiResultOnce(value: unknown, request: TranslationRequest, providerId: string): TranslationResult {
  const providerName = languageModelProviderName(providerId);
  if (!isRecord(value)) {
    throw new ProviderError(
      `${providerName} returned an unsupported result.`,
      undefined,
      true,
      undefined,
      'structuredOutput'
    );
  }
  const base = {
    providerId,
    operation: request.operation,
    sourceText: request.text,
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    createdAt: new Date().toISOString()
  };

  const translatedText = stringValue(value.translatedText);
  if (!translatedText) {
    throw new ProviderError(
      `${providerName} returned no translation.`,
      undefined,
      true,
      undefined,
      'structuredOutput'
    );
  }
  const result: TranslationResult = {
    ...base,
    kind: 'translation',
    translatedText
  };
  const alternatives = Array.isArray(value.alternatives)
    ? value.alternatives.map(stringValue).filter((item): item is string => Boolean(item)).slice(0, 3)
    : [];
  const note = stringValue(value.note);
  if (alternatives.length > 0) result.alternatives = alternatives;
  if (note) result.note = note;
  return result;
}

export function normalizeGeminiRewriteResult(
  value: unknown,
  request: RewriteRequest,
  providerId: string,
  createdAt = new Date().toISOString()
): RewriteResult {
  return validateLanguageModelOutput(value, () => normalizeGeminiRewriteResultOnce(value, request, providerId, createdAt));
}

function normalizeGeminiRewriteResultOnce(value: unknown, request: RewriteRequest, providerId: string, createdAt: string): RewriteResult {
  const providerName = languageModelProviderName(providerId);
  if (!isRecord(value) || !Array.isArray(value.variants)) {
    throw new ProviderError(
      `${providerName} returned an unsupported rewrite result.`,
      undefined,
      true,
      undefined,
      'structuredOutput'
    );
  }
  const sourceLanguage = request.sourceLanguage === 'auto'
    ? normalizeLanguageCode(providerIdentifier(value.detectedLanguage))
    : normalizeLanguageCode(request.sourceLanguage);
  if (!sourceLanguage) {
    throw new ProviderError(
      `${providerName} did not return a valid detected language. Try again or select the source language in KREN Settings.`,
      undefined,
      true,
      undefined,
      'structuredOutput'
    );
  }
  const requestedVariant = rewriteOperationVariant(request.operation);
  const targetLanguage = rewriteOutputLanguageCode(request.englishVariety, request.otherOutputLanguage) ?? sourceLanguage;
  const expectedIds: readonly RewriteVariantId[] = requestedVariant
    ? [requestedVariant]
    : REWRITE_VARIANT_IDS;
  if (value.variants.length !== expectedIds.length) {
    throw new ProviderError(
      `${providerName} did not return all requested rewrite variants. Try again.`,
      undefined,
      true,
      undefined,
      'structuredOutput'
    );
  }
  const byId = new Map<RewriteVariantId, RewriteVariant>();
  for (const item of value.variants) {
    if (!isRecord(item)) continue;
    const id = rewriteVariantId(item.id);
    const text = stringValue(item.text);
    if (!id || !text || !expectedIds.includes(id)) continue;
    const variant: RewriteVariant = { id, label: rewriteVariantLabel(id), text, targetLanguage };
    const changeNote = stringValue(item.changeNote);
    if (changeNote) variant.changeNote = changeNote;
    byId.set(id, variant);
  }
  const variants = expectedIds.map((id) => byId.get(id));
  if (variants.some((variant) => !variant)) {
    throw new ProviderError(
      `${providerName} did not return all requested rewrite variants. Try again.`,
      undefined,
      true,
      undefined,
      'structuredOutput'
    );
  }
  for (const variant of variants as RewriteVariant[]) {
    if (variant.id !== 'full') continue;
    const violation = rewriteOutputViolation(variant.text, request, sourceLanguage);
    if (violation) {
      throw new ProviderError(
        `${providerName} returned a rewrite that did not satisfy the requested ${violation}. Try again.`,
        undefined,
        true,
        undefined,
        'structuredOutput'
      );
    }
  }
  return {
    kind: 'rewrite',
    providerId,
    sourceText: request.text,
    sourceLanguage,
    targetLanguage,
    createdAt,
    englishVariety: request.englishVariety,
    modality: request.modality,
    function: request.function,
    domain: request.domain,
    formality: request.formality,
    voice: request.voice,
    stance: request.stance,
    length: request.length,
    perspective: request.perspective,
    rhetoricalMode: request.rhetoricalMode,
    variants: variants as RewriteVariant[]
  };
}

const SPOKEN_ABBREVIATIONS = ['e.g.', 'i.e.', 'Fig.', 'vs.', 'etc.', 'et al.', 'cf.'] as const;
const SPOKEN_VISUAL_DEIXIS = [
  'shown above',
  'shown below',
  'see above',
  'see below',
  'described above',
  'described below',
  'listed above',
  'listed below',
  'the figure above',
  'the table below',
  'as above',
  'the latter'
] as const;

export function rewriteOutputViolation(
  text: string,
  request: RewriteRequest,
  sourceLanguage = request.sourceLanguage
): 'spoken modality' | 'length' | 'perspective' | undefined {
  if (request.modality === REWRITE_MODALITIES[1].id) {
    if (/[();\u2013\u2014]/u.test(text)) return 'spoken modality';
    if (SPOKEN_ABBREVIATIONS.some((abbreviation) => text.includes(abbreviation))) {
      return 'spoken modality';
    }
    if (/\d[%&]/u.test(text)) return 'spoken modality';
    const lower = text.toLocaleLowerCase('en-US');
    if (SPOKEN_VISUAL_DEIXIS.some((phrase) => lower.includes(phrase))) {
      return 'spoken modality';
    }
  }
  if (request.length === REWRITE_LENGTHS[1].id && text.length >= request.text.length) {
    return 'length';
  }
  if (request.length === REWRITE_LENGTHS[2].id && text.length <= request.text.length) {
    return 'length';
  }
  if (isEnglishLanguageCode(sourceLanguage)) {
    const firstPerson = /\b(?:I|me|my|mine|myself|we|us|our|ours|ourselves)\b/iu;
    if (request.perspective === REWRITE_PERSPECTIVES[1].id && !firstPerson.test(text)) {
      return 'perspective';
    }
    if (request.perspective === REWRITE_PERSPECTIVES[2].id && firstPerson.test(text)) {
      return 'perspective';
    }
  }
  return undefined;
}

function pushInstruction(instructions: string[], instruction: string | undefined): void {
  if (instruction) instructions.push(instruction);
}

function languageModelProviderName(providerId: string): string {
  if (providerId === 'openai') return 'OpenAI';
  if (providerId === 'groq') return 'Groq';
  if (providerId === 'cloudflare') return 'Cloudflare';
  if (providerId === 'anthropic') return 'Anthropic';
  return 'Gemini';
}

function rewriteOperationVariant(operation: RewriteRequest['operation']): RewriteVariantId | undefined {
  return REWRITE_VARIANT_LIST.find((variant) => variant.operation === operation)?.id;
}

function rewriteVariantId(value: unknown): RewriteVariantId | undefined {
  return isRewriteVariantId(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
