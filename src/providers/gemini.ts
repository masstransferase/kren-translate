import { ProviderError } from '../errors.js';
import { languageName } from '../languages.js';
import { parseStructuredJson } from '@kren/core/structured-json';
import { isEnglishLanguageCode } from '@kren/core/languages';
import { normalizeLanguageCode } from '@kren/core/validation';
import {
  isRetryableLanguageModelStatus,
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

interface GeminiPayload {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown }> };
  }>;
  error?: { message?: unknown };
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
      signal
    );
    return {
      ...normalizeGeminiResult(value, request, this.id),
      modelId: this.model.replace(/^models\//u, '')
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
      signal
    );
    return {
      ...normalizeGeminiRewriteResult(value, request, this.id),
      modelId: this.model.replace(/^models\//u, '')
    };
  }

  private async generate(
    requestBody: ReturnType<typeof buildGeminiRequestBody>,
    signal: AbortSignal
  ): Promise<unknown> {
    const modelId = this.model.replace(/^models\//u, '');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
    const body = JSON.stringify(requestBody);

    const requestedAttempts = Number.isFinite(this.maxAttempts) ? this.maxAttempts : 4;
    const attempts = Math.max(1, Math.min(5, Math.floor(requestedAttempts)));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey
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
          `Gemini could not be reached after ${attempts} ${attempts === 1 ? 'attempt' : 'attempts'}.`,
          this.modelAction,
          true
        );
      }

      const payload = (await response.json().catch(() => ({}))) as GeminiPayload;
      if (!response.ok) {
        const detail = typeof payload.error?.message === 'string' ? ` ${payload.error.message}` : '';
        if (response.status === 404) {
          throw new ProviderError(
            `Gemini model ${this.model} is unavailable.${detail}`,
            this.modelAction,
            false,
            response.status
          );
        }
        if (isRetryableGeminiStatus(response.status) && attempt < attempts - 1) {
          await waitForRetry(retryDelayMs(attempt, response.headers.get('retry-after')), signal);
          continue;
        }
        if (response.status === 503) {
          throw new ProviderError(
            `Gemini model ${this.model} is temporarily overloaded after ${attempts} ${attempts === 1 ? 'attempt' : 'attempts'}. KREN ${attempts > 1 ? 'retried automatically. ' : ''}Try again shortly or choose another Gemini model.`,
            this.modelAction,
            true,
            response.status
          );
        }
        if (isRetryableGeminiStatus(response.status)) {
          throw new ProviderError(
            `Gemini returned a temporary ${response.status} response after ${attempts} ${attempts === 1 ? 'attempt' : 'attempts'}. Try again shortly or choose another Gemini model.`,
            this.modelAction,
            true,
            response.status
          );
        }
        throw new ProviderError(`Gemini request failed (${response.status}).${detail}`);
      }

      const rawText = payload.candidates?.[0]?.content?.parts
        ?.map((part) => (typeof part.text === 'string' ? part.text : ''))
        .join('')
        .trim();
      if (!rawText) {
        throw new ProviderError('Gemini returned no result.');
      }

      return parseJson(rawText, 'Gemini');
    }

    throw new ProviderError(`Gemini request failed after ${attempts} attempts.`);
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
      temperature: 0.2,
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
    temperature: number;
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
      temperature: 0.2,
      responseMimeType: 'application/json',
      ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {})
    }
  };
}

export function thinkingLevelForModel(model: string): GeminiThinkingLevel | undefined {
  const normalized = model.replace(/^models\//u, '').toLocaleLowerCase('en-US');
  if (/^gemini-(?:3(?:\.\d+)?-.*pro|2\.5-)/u.test(normalized)) return 'low';
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
  if (configured === 'minimal' && /^gemini-(?:3(?:\.\d+)?-.*pro|2\.5-)/u.test(normalized)) {
    return 'low';
  }
  return configured;
}

export function isRetryableGeminiStatus(status: number): boolean {
  return isRetryableLanguageModelStatus(status);
}

function retryDelayMs(attempt: number, retryAfter: string | null = null): number {
  return coreRetryDelayMs(attempt, retryAfter, {
    baseDelayMs: 1_250,
    jitterMs: 500,
    parseHttpDate: true
  });
}

export function systemInstruction(request: TranslationRequest): string {
  const source = request.sourceLanguage === 'auto'
    ? 'automatically detected source language'
    : languageName(request.sourceLanguage);
  const target = languageName(request.targetLanguage);
  if (request.operation === 'explain') {
    const explanationLanguage = request.explanationLanguage === 'bilingual'
      ? 'both English and Korean'
      : `${languageName(request.explanationLanguage ?? 'en')} only`;
    return [
      `Explain the selected ${source} text and give a natural ${target} equivalent.`,
      'Return JSON only with this shape:',
      '{"kind":"translation","translatedText":"natural equivalent","alternatives":["optional alternative"],"note":"meaning and nuance explanation"}',
      `Write the note in ${explanationLanguage}.`,
      'Explain contextual meaning, nuance, register, connotation, ambiguity, and relevant technical usage.',
      'Do not infer or mention any document context because none is provided.'
    ].join('\n');
  }

  return [
    `Translate the selected ${source} text into natural ${target}.`,
    'Preserve Markdown, code identifiers, placeholders, citations, filenames, and technical terminology.',
    'Return JSON only with this shape:',
    '{"kind":"translation","translatedText":"string","alternatives":["optional string"],"note":"optional concise nuance explanation"}',
    'Include a note only when needed to prevent misunderstanding.'
  ].join('\n');
}

export function rewriteSystemInstruction(request: RewriteRequest): string {
  const languageInstruction = request.sourceLanguage === 'auto'
    ? 'Detect the dominant natural language of the supplied text. Return its BCP-47 language code in detectedLanguage. Rewrite in that same language and never translate it.'
    : `The source language is ${languageName(request.sourceLanguage)} (${request.sourceLanguage}). Return "${request.sourceLanguage}" in detectedLanguage and rewrite in that same language. Never translate it.`;
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
  if (englishVarietyInstruction) {
    fullRewriteInstructions.push(`Only when detectedLanguage is English, ${englishVarietyInstruction.replace(/^Use/u, 'use')}`);
  }
  fullRewriteInstructions.push('When detectedLanguage is not English, ignore the English-variety setting and use natural conventions for the detected language.');
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
    return parseStructuredJson(raw);
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
    ? normalizeLanguageCode(value.detectedLanguage)
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
    const variant: RewriteVariant = { id, label: rewriteVariantLabel(id), text };
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
    targetLanguage: sourceLanguage,
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
