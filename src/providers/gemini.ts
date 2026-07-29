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
  const preservation = [
    'Rewrite only the exact text supplied by the user.',
    languageInstruction,
    'Preserve intentional mixed-language terms, names, quotations, code, and necessary domain terminology.',
    'Preserve its factual meaning, claims, qualifications, numbers, citations, and necessary domain terminology.',
    'Correct grammar and awkward phrasing, but do not add facts, evidence, promises, certainty, examples, or document context.',
    'Never intensify a claim beyond the evidence or qualifications present in the supplied text.',
    'Return JSON only. Every variant must be complete and usable on its own.'
  ];
  preservation.push(rewriteDomainInstruction(request.domain));
  preservation.push(`Only when detectedLanguage is English, ${rewriteEnglishVarietyInstruction(request.englishVariety).replace(/^Use/u, 'use')}`);
  preservation.push('When detectedLanguage is not English, ignore the English-variety setting and use natural conventions for the detected language.');
  preservation.push(rewriteToneInstruction(request.tone));
  preservation.push(rewriteRhetoricalModeInstruction(request.rhetoricalMode ?? 'preserveOriginal'));
  if (request.preserveFormatting !== false) {
    preservation.push('Preserve Markdown, LaTeX commands, citations, links, placeholders, code identifiers, filenames, inline code, and fenced code blocks exactly unless grammar inside ordinary prose requires a change.');
  }
  const jargonFree = [
    'Write clear, natural, human-like prose in the detected language.',
    'Remove buzzwords, cliches, corporate jargon, and unnecessary specialist jargon.',
    'Keep precise domain terminology only when it is needed for correctness.',
    'Use no em dashes or en dashes. Use commas, parentheses, colons, semicolons, or separate sentences instead.',
    'Use no metaphors unless removing one would change the intended meaning.'
  ];
  const changeNoteField = request.includeChangeNotes
    ? ',"changeNote":"one concise sentence describing the important edits"'
    : '';
  const changeNoteInstruction = request.includeChangeNotes
    ? 'For each variant, include a concise changeNote describing only the important edits.'
    : 'Do not include commentary or change notes.';
  const singleVariant = rewriteOperationVariant(request.operation);
  if (singleVariant) {
    const variantInstructions: Record<RewriteVariantId, string[]> = {
      natural: ['Write fluent native-level English that follows the configured tone and rhetorical mode while preserving the original level of detail.'],
      concise: ['Write tighter, more direct English while retaining every important point.'],
      jargonFree
    };
    const label = rewriteVariantLabel(singleVariant, request.sourceLanguage);
    return [...preservation, ...variantInstructions[singleVariant],
      changeNoteInstruction,
      'Return exactly this JSON shape:',
      `{"kind":"rewrite","detectedLanguage":"BCP-47 code","variants":[{"id":"${singleVariant}","label":"${label}","text":"rewritten text"${changeNoteField}}]}`
    ].join('\n');
  }
  return [...preservation,
    'Produce exactly three meaning-preserving variants:',
    '1. Natural: fluent, native-level writing in the detected language that follows the configured tone and rhetorical mode while preserving the original level of detail.',
    '2. Concise: tighter and more direct writing in the detected language while retaining every important point.',
    `3. Jargon-Free: ${jargonFree.join(' ')}`,
    changeNoteInstruction,
    'Return exactly this JSON shape and order:',
    `{"kind":"rewrite","detectedLanguage":"BCP-47 code","variants":[{"id":"natural","label":"Natural","text":"rewritten text"${changeNoteField}},{"id":"concise","label":"Concise","text":"rewritten text"${changeNoteField}},{"id":"jargonFree","label":"Jargon-Free","text":"rewritten text"${changeNoteField}}]}`
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
  const expectedIds: RewriteVariantId[] = requestedVariant
    ? [requestedVariant]
    : ['natural', 'concise', 'jargonFree'];
  const byId = new Map<RewriteVariantId, RewriteVariant>();
  for (const item of value.variants) {
    if (!isRecord(item)) continue;
    const id = rewriteVariantId(item.id);
    const text = stringValue(item.text);
    if (!id || !text || !expectedIds.includes(id)) continue;
    const variant: RewriteVariant = { id, label: rewriteVariantLabel(id, sourceLanguage), text };
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
  return {
    kind: 'rewrite',
    providerId,
    sourceText: request.text,
    sourceLanguage,
    targetLanguage: sourceLanguage,
    createdAt,
    englishVariety: request.englishVariety,
    domain: request.domain,
    tone: request.tone,
    rhetoricalMode: request.rhetoricalMode ?? 'preserveOriginal',
    variants: variants as RewriteVariant[]
  };
}

function languageModelProviderName(providerId: string): string {
  if (providerId === 'openai') return 'OpenAI';
  if (providerId === 'anthropic') return 'Anthropic';
  return 'Gemini';
}

function rewriteOperationVariant(operation: RewriteRequest['operation']): RewriteVariantId | undefined {
  if (operation === 'rewriteNatural') return 'natural';
  if (operation === 'rewriteConcise') return 'concise';
  if (operation === 'rewriteJargonFree') return 'jargonFree';
  return undefined;
}

function rewriteDomainInstruction(domain: RewriteRequest['domain']): string {
  if (domain === 'academic') {
    return 'Use disciplined academic prose, field-appropriate terminology, and appropriately qualified claims. Do not make the text more certain than the source.';
  }
  if (domain === 'technical') {
    return 'Use precise technical prose and preserve necessary technical terms, identifiers, units, and distinctions.';
  }
  if (domain === 'business') {
    return 'Use clear, professional business prose that makes actions and decisions easy to understand without adding commitments.';
  }
  if (domain === 'email') {
    return 'Make the wording suitable for a natural professional email. Do not invent a greeting, sign-off, recipient, or relationship that is absent from the source.';
  }
  return 'Use general-purpose prose in the source language without imposing a specialized domain style.';
}

function rewriteEnglishVarietyInstruction(
  variety: RewriteRequest['englishVariety']
): string {
  if (variety === 'british') {
    return 'Use standard British English spelling, punctuation, vocabulary, idiom, and usage consistently.';
  }
  if (variety === 'australian') {
    return 'Use standard Australian English spelling, punctuation, vocabulary, idiom, and usage consistently.';
  }
  if (variety === 'canadian') {
    return 'Use standard Canadian English spelling, punctuation, vocabulary, idiom, and usage consistently.';
  }
  if (variety === 'indian') {
    return 'Use standard Indian English spelling, punctuation, vocabulary, idiom, and usage consistently while avoiding stereotypes or exaggerated regionalisms.';
  }
  if (variety === 'international') {
    return 'Use clear internationally accessible English. Prefer region-neutral wording and avoid culture-specific idioms when a natural neutral alternative exists.';
  }
  return 'Use standard American English spelling, punctuation, vocabulary, idiom, and usage consistently.';
}

function rewriteToneInstruction(tone: RewriteRequest['tone']): string {
  if (tone === 'plainLanguage') {
    return 'Prefer familiar words, direct syntax, and reasonably short sentences. Retain specialized terminology only when replacing it would reduce accuracy.';
  }
  if (tone === 'preserveVoice') {
    return 'Preserve the writer\'s recognizable voice, formality, cadence, emphasis, and personality as far as the requested variant allows.';
  }
  if (tone === 'professional') {
    return 'Use a polished, professional tone that is clear and credible without sounding stiff or promotional.';
  }
  if (tone === 'warm') {
    return 'Use a warm, approachable, and respectful tone without adding sentiment or familiarity absent from the source.';
  }
  if (tone === 'assertive') {
    return 'Use a confident, assertive tone, but do not strengthen claims, certainty, authority, or commitments beyond the source.';
  }
  if (tone === 'cautious') {
    return 'Use a careful, appropriately qualified tone. Preserve uncertainty and avoid implying conclusions stronger than the source supports.';
  }
  if (tone === 'diplomatic') {
    return 'Use a tactful, constructive, and respectful tone while keeping the message and necessary disagreements clear.';
  }
  if (tone === 'formal') {
    return 'Use formal, precise wording and complete sentence structure without becoming ornate or bureaucratic.';
  }
  if (tone === 'direct') {
    return 'Use direct, economical wording that states the point clearly without becoming abrupt or changing the source claim.';
  }
  return 'Use a neutral, natural, professional tone.';
}

function rewriteRhetoricalModeInstruction(
  mode: NonNullable<RewriteRequest['rhetoricalMode']>
): string {
  if (mode === 'explain') {
    return 'Rhetorical mode: explain. Make the supplied point easier to understand using only information already present; do not invent examples or background.';
  }
  if (mode === 'persuade') {
    return 'Rhetorical mode: persuade. Organize the supplied claims persuasively, but introduce no new evidence, benefits, urgency, certainty, or promises.';
  }
  if (mode === 'recommend') {
    return 'Rhetorical mode: recommend. Frame the supplied position as a clear recommendation without inventing reasons, authority, obligations, or implementation details.';
  }
  if (mode === 'constructivelyChallenge') {
    return 'Rhetorical mode: constructively challenge. Express the supplied concern or disagreement clearly, respectfully, and specifically without inventing criticism or becoming combative.';
  }
  return 'Rhetorical mode: preserve the original communicative intent. Do not turn an observation into an explanation, persuasion, recommendation, or challenge.';
}

function rewriteVariantId(value: unknown): RewriteVariantId | undefined {
  return value === 'natural' || value === 'concise' || value === 'jargonFree'
    ? value
    : undefined;
}

function rewriteVariantLabel(id: RewriteVariantId, sourceLanguage = 'en'): string {
  if (id === 'natural') return isEnglishLanguageCode(sourceLanguage) ? 'Natural English' : 'Natural';
  if (id === 'concise') return 'Concise';
  return 'Jargon-Free';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
