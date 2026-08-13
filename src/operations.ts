import { analyzeSelection } from './classifier.js';
import {
  isEnglishDictionaryQuery as coreIsEnglishDictionaryQuery,
  isMultiWordEnglishQuery as coreIsMultiWordEnglishQuery
} from '@kren/core/validation';
import { ProviderError } from './errors.js';
import { AUTO_ENGLISH_KOREAN_TARGET, isPlausibleLanguageCode } from './languages.js';
import {
  configuredThinkingLevel,
  GeminiProvider,
  type GeminiThinkingLevel
} from './providers/gemini.js';
import { GoogleCloudTranslationProvider } from './providers/googleCloudTranslation.js';
import { KoreanDictionaryProvider } from './providers/koreanDictionary.js';
import { AnthropicProvider, type AnthropicEffort } from './providers/anthropic.js';
import { OpenAIProvider, type OpenAIReasoningEffort } from './providers/openai.js';
import {
  MerriamWebsterProvider,
  type MerriamWebsterReference
} from './providers/merriamWebster.js';
import { checkGrammarWithHarper } from './providers/harperGrammar.js';
import type {
  DictionaryRequest,
  ExplanationOutputLanguage,
  GrammarDialect,
  KrenResult,
  LanguageModelProvider,
  LanguageModelProviderId,
  RewriteDomain,
  RewriteEnglishVariety,
  RewriteEnglishVarietySetting,
  RewriteFormality,
  RewriteFunction,
  RewriteLength,
  RewriteModality,
  RewriteOperation,
  RewritePerspective,
  RewriteRequest,
  RewriteRhetoricalMode,
  RewriteStance,
  RewriteVoice,
  SelectionAnalysis,
  TranslationProvider,
  TranslationProviderId,
  TranslationRequest
} from './types.js';
import { REWRITE_AXIS_DEFAULTS } from './rewriteAxes.js';
import {
  attachUserDictionaryMerriamWebsterReference,
  captureUserDictionaryDraft,
  HttpUserDictionaryProviderTransport,
  type UserDictionaryCaptureResult
} from './userDictionary/capture.js';
import {
  isUserDictionaryCaptureMode,
  isUserDictionaryProvider,
  type UserDictionaryEntryV1,
  type UserDictionaryProvider
} from './userDictionary/contract.js';
import {
  isUserDictionaryExampleCount,
  isUserDictionaryThinkingOrEffort,
  USER_DICTIONARY_CAPTURE_DEFAULTS,
  type UserDictionaryCaptureSettings
} from './userDictionary/settings.js';

export const KREN_SECRET_KEYS = {
  gemini: 'kren.gemini.apiKey',
  geminiPro: 'kren.gemini.proApiKey',
  openai: 'kren.openai.apiKey',
  anthropic: 'kren.anthropic.apiKey',
  googleCloudTranslation: 'kren.googleCloudTranslation.apiKey',
  koreanDictionary: 'kren.koreanDictionary.apiKey',
  merriamWebsterCollegiate: 'kren.merriamWebster.collegiateApiKey',
  merriamWebsterMedical: 'kren.merriamWebster.medicalApiKey',
  merriamWebsterThesaurus: 'kren.merriamWebster.thesaurusApiKey'
} as const;

export const MERRIAM_WEBSTER_SECRET_KEYS = [
  KREN_SECRET_KEYS.merriamWebsterCollegiate,
  KREN_SECRET_KEYS.merriamWebsterMedical,
  KREN_SECRET_KEYS.merriamWebsterThesaurus
] as const;

export type MerriamWebsterSecretKey = typeof MERRIAM_WEBSTER_SECRET_KEYS[number];

// How many Merriam-Webster keys may be stored at once.
//
// **The published value is 2. This 3 is a private development build only**, decided by
// the owner on 2026-08-13, and the publish transform in tools/public-tree-rules.json
// rewrites it to 2 for the public tree. A test on the produced tree asserts that, so the
// two channels cannot silently converge on the wrong number.
//
// Two is what Merriam-Webster's terms allow. Section 2 requires that you do not use more
// than two reference works, and the registration page issues at most two keys per
// account, so a third key implies a second account. Raising the limit does not make
// three reference works compliant; it only lets a developer exercise all three code
// paths on one machine without swapping credentials between runs.
//
// Consequences, stated so nobody has to rediscover them:
//   - A private build configured with three keys is outside the terms. Do not use it to
//     serve real lookups beyond development.
//   - The same enablement is planned for the KREN Office private build, and carries the
//     same restriction.
//   - This must never reach a public channel. That is what the transform and its test
//     exist for.
export const MERRIAM_WEBSTER_KEY_LIMIT = 2;

export const MERRIAM_WEBSTER_KEY_LIMIT_MESSAGE =
  `Merriam-Webster issues two API keys per account. KREN stores at most ${MERRIAM_WEBSTER_KEY_LIMIT}. Remove one before adding another.`;

export interface MerriamWebsterSecretStorage {
  get(key: MerriamWebsterSecretKey): PromiseLike<string | undefined>;
  store(key: MerriamWebsterSecretKey, value: string): PromiseLike<void>;
}

let merriamWebsterStoreQueue = Promise.resolve();

export function isMerriamWebsterSecretKey(key: string): key is MerriamWebsterSecretKey {
  return MERRIAM_WEBSTER_SECRET_KEYS.includes(key as MerriamWebsterSecretKey);
}

export async function canStoreMerriamWebsterKey(
  storage: Pick<MerriamWebsterSecretStorage, 'get'>,
  key: MerriamWebsterSecretKey
): Promise<boolean> {
  const stored = await Promise.all(
    MERRIAM_WEBSTER_SECRET_KEYS.map((candidate) => storage.get(candidate))
  );
  const targetIndex = MERRIAM_WEBSTER_SECRET_KEYS.indexOf(key);
  return Boolean(stored[targetIndex]) || stored.filter(Boolean).length < MERRIAM_WEBSTER_KEY_LIMIT;
}

export function storeMerriamWebsterKey(
  storage: MerriamWebsterSecretStorage,
  key: MerriamWebsterSecretKey,
  value: string
): Promise<boolean> {
  const attempt = merriamWebsterStoreQueue.then(async () => {
    if (!await canStoreMerriamWebsterKey(storage, key)) return false;
    await storage.store(key, value);
    return true;
  });
  merriamWebsterStoreQueue = attempt.then(() => undefined, () => undefined);
  return attempt;
}

export type KrenSecretKey = typeof KREN_SECRET_KEYS[keyof typeof KREN_SECRET_KEYS];
export type KrenOperation =
  | 'translate'
  | 'explain'
  | 'englishDictionary'
  | 'koreanDictionary'
  | 'medical'
  | 'synonyms'
  | 'grammar'
  | 'rewrite'
  | 'rewriteNatural'
  | 'rewriteConcise'
  | 'rewriteJargonFree';

type MerriamWebsterOperation = Extract<
  KrenOperation,
  'englishDictionary' | 'medical' | 'synonyms'
>;

const MERRIAM_WEBSTER_OPERATIONS: Record<MerriamWebsterOperation, {
  reference: MerriamWebsterReference;
  secretKey: MerriamWebsterSecretKey;
  label: string;
  missingKeyMessage: string;
  missingKeyAction: 'setMerriamWebsterCollegiateKey' |
    'setMerriamWebsterMedicalKey' |
    'setMerriamWebsterThesaurusKey';
  noEntryMessage: (text: string) => string;
}> = {
  englishDictionary: {
    reference: 'collegiate',
    secretKey: KREN_SECRET_KEYS.merriamWebsterCollegiate,
    label: 'English Dictionary Search',
    missingKeyMessage: 'Set your Merriam-Webster Collegiate API key before searching.',
    missingKeyAction: 'setMerriamWebsterCollegiateKey',
    noEntryMessage: (text) => `Merriam-Webster Collegiate returned no entry for “${text}”.`
  },
  medical: {
    reference: 'medical',
    secretKey: KREN_SECRET_KEYS.merriamWebsterMedical,
    label: 'Medical Dictionary Search',
    missingKeyMessage: 'Set your Merriam-Webster Medical API key before searching.',
    missingKeyAction: 'setMerriamWebsterMedicalKey',
    noEntryMessage: (text) =>
      `Merriam-Webster Medical Dictionary returned no entry for “${text}”.`
  },
  synonyms: {
    reference: 'thesaurus',
    secretKey: KREN_SECRET_KEYS.merriamWebsterThesaurus,
    label: 'Synonyms Search',
    missingKeyMessage: 'Set your Merriam-Webster Collegiate Thesaurus API key before searching.',
    missingKeyAction: 'setMerriamWebsterThesaurusKey',
    noEntryMessage: (text) =>
      `Merriam-Webster Collegiate Thesaurus returned no entry for “${text}”.`
  }
};

export type GeminiProfile = 'standard' | 'pro';

export interface KrenOperationInput {
  text: string;
  targetLanguage?: string;
  outputLanguage?: ExplanationOutputLanguage;
}

export interface KrenRuntime {
  getSecret(key: KrenSecretKey): Promise<string | undefined>;
  getSetting<T>(key: string, fallback: T): T;
  reserveCloudCharacters(characters: number): Promise<unknown>;
  beforeGeminiRequest(profile?: GeminiProfile): Promise<void>;
  beforeLanguageModelRequest?(
    provider: LanguageModelProviderId,
    profile?: GeminiProfile
  ): Promise<void>;
}

export async function runKrenOperation(
  runtime: KrenRuntime,
  operation: KrenOperation,
  input: KrenOperationInput,
  signal: AbortSignal
): Promise<KrenResult> {
  const maxCharacters = runtime.getSetting<number>('translation.maxCharacters', 5000);
  if (input.text.length > maxCharacters) {
    throw new Error(
      `The submitted text has ${input.text.length} characters; the configured maximum is ${maxCharacters}.`
    );
  }

  let analysis = analyzeSelection(input.text);
  validateDictionaryInput(operation, analysis);

  if (isRewriteOperation(operation)) {
    return rewriteText(runtime, operation, analysis.text, signal);
  }

  if (operation === 'grammar') {
    return checkGrammarWithHarper(
      input.text,
      runtime.getSetting<GrammarDialect>('grammar.dialect', 'american'),
      signal
    );
  }

  if (operation === 'translate' || operation === 'explain') {
    analysis = applyLanguages(runtime, operation, input, analysis);
  }

  if (isMerriamWebsterOperation(operation)) {
    return lookupMerriamWebster(runtime, operation, analysis, signal);
  }
  if (operation === 'koreanDictionary') {
    return lookupKoreanDictionary(runtime, analysis, signal);
  }

  const request: TranslationRequest = {
    ...analysis,
    kind: 'translation',
    operation
  };
  if (operation === 'explain') {
    request.explanationLanguage = input.outputLanguage ?? runtime.getSetting<ExplanationOutputLanguage>(
      'explanation.outputLanguage',
      'bilingual'
    );
  }
  if (operation === 'explain') {
    return explainWithLanguageModelProvider(runtime, request, signal);
  }
  const provider = await createTranslationProvider(runtime);
  return provider.translate(request, signal);
}

function validateDictionaryInput(operation: KrenOperation, analysis: SelectionAnalysis): void {
  if (isMerriamWebsterOperation(operation) && !isEnglishDictionaryQuery(analysis.text)) {
    throw new Error(
      `${MERRIAM_WEBSTER_OPERATIONS[operation].label} requires an English word or short expression.`
    );
  }
  if (operation === 'koreanDictionary' &&
      (analysis.kind !== 'dictionary' || analysis.sourceLanguage !== 'ko')) {
    throw new Error('Korean Dictionary Search requires one Korean word.');
  }
  if (isRewriteOperation(operation) && !/[\p{L}\p{N}]/u.test(analysis.text)) {
    throw new Error('Rewrite Text requires text containing a letter or number.');
  }
  if (operation === 'grammar' && !/\p{Script=Latin}/u.test(analysis.text)) {
    throw new Error('Grammar Check currently requires English text.');
  }
}

async function rewriteText(
  runtime: KrenRuntime,
  operation: RewriteOperation,
  text: string,
  signal: AbortSignal
): Promise<KrenResult> {
  const sourceLanguage = runtime.getSetting<string>('rewrite.sourceLanguage', 'auto').trim();
  if (sourceLanguage !== 'auto' && !isPlausibleLanguageCode(sourceLanguage)) {
    throw new Error(`Invalid rewrite source language code: ${sourceLanguage}.`);
  }
  const configuredEnglishVariety = runtime.getSetting<RewriteEnglishVarietySetting>(
    'rewrite.englishVariety',
    REWRITE_AXIS_DEFAULTS.englishVariety
  );
  const englishVariety: RewriteEnglishVariety =
    configuredEnglishVariety === REWRITE_AXIS_DEFAULTS.englishVariety
    ? runtime.getSetting<GrammarDialect>('grammar.dialect', 'american')
    : configuredEnglishVariety;
  const request: RewriteRequest = {
    text,
    sourceLanguage,
    targetLanguage: 'auto',
    kind: 'translation',
    operation,
    englishVariety,
    modality: runtime.getSetting<RewriteModality>(
      'rewrite.modality',
      REWRITE_AXIS_DEFAULTS.modality
    ),
    function: runtime.getSetting<RewriteFunction>(
      'rewrite.function',
      REWRITE_AXIS_DEFAULTS.function
    ),
    domain: runtime.getSetting<RewriteDomain>(
      'rewrite.domain',
      REWRITE_AXIS_DEFAULTS.domain
    ),
    formality: runtime.getSetting<RewriteFormality>(
      'rewrite.formality',
      REWRITE_AXIS_DEFAULTS.formality
    ),
    voice: runtime.getSetting<RewriteVoice>('rewrite.voice', REWRITE_AXIS_DEFAULTS.voice),
    stance: runtime.getSetting<RewriteStance>('rewrite.stance', REWRITE_AXIS_DEFAULTS.stance),
    length: runtime.getSetting<RewriteLength>('rewrite.length', REWRITE_AXIS_DEFAULTS.length),
    perspective: runtime.getSetting<RewritePerspective>(
      'rewrite.perspective',
      REWRITE_AXIS_DEFAULTS.perspective
    ),
    rhetoricalMode: runtime.getSetting<RewriteRhetoricalMode>(
      'rewrite.rhetoricalMode',
      REWRITE_AXIS_DEFAULTS.rhetoricalMode
    ),
    preserveFormatting: runtime.getSetting<boolean>('rewrite.preserveFormatting', true),
    includeChangeNotes: runtime.getSetting<boolean>('rewrite.includeChangeNotes', false)
  };
  const providerId = runtime.getSetting<LanguageModelProviderId>(
    'rewrite.provider',
    'gemini'
  );
  if (providerId !== 'gemini') {
    const provider = await createExternalLanguageModelProvider(runtime, providerId);
    return provider.rewrite(request, signal);
  }

  const profile = runtime.getSetting<GeminiProfile>('rewrite.geminiProfile', 'standard');
  const key = await runtime.getSecret(
    profile === 'pro' ? KREN_SECRET_KEYS.geminiPro : KREN_SECRET_KEYS.gemini
  );
  if (!key) {
    const message = profile === 'pro'
      ? 'Set your alternate Gemini API key before using the alternate rewrite profile.'
      : 'Set your default Gemini API key before using the default rewrite profile.';
    throw new ProviderError(message, profile === 'pro' ? 'setGeminiProKey' : 'setGeminiKey');
  }
  await beforeLanguageModelRequest(runtime, 'gemini', profile);
  const model = profile === 'pro'
    ? runtime.getSetting<string>('gemini.alternateModel', 'gemini-3.1-pro-preview')
    : runtime.getSetting<string>('gemini.model', 'gemini-3.5-flash');
  const configuredThinking = runtime.getSetting<GeminiThinkingLevel>(
    'gemini.alternateThinkingLevel',
    'low'
  );
  const proThinkingLevel: GeminiThinkingLevel =
    configuredThinking === 'medium' || configuredThinking === 'high'
      ? configuredThinking
      : 'low';
  const retries = runtime.getSetting<boolean>('gemini.retry.enabled', true)
    ? runtime.getSetting<number>('gemini.retry.maxAttempts', 4)
    : 1;
  const standardThinking = configuredThinkingLevel(
    model,
    runtime.getSetting<GeminiThinkingLevel | 'auto'>('gemini.thinkingLevel', 'auto')
  );
  const primaryProvider = new GeminiProvider(
    key,
    model,
    profile === 'pro' ? 'configureGeminiProModel' : 'configureGeminiModel',
    profile === 'pro' ? proThinkingLevel : standardThinking,
    retries
  );
  try {
    return await primaryProvider.rewrite(request, signal);
  } catch (error) {
    const fallbackEnabled = profile === 'pro' &&
      runtime.getSetting<boolean>('gemini.alternateFallbackEnabled', true);
    const fallbackSettings = alternateGeminiFallback(runtime, model);
    if (!fallbackEnabled || !fallbackSettings || !isProFallbackError(error)) {
      throw error;
    }
    const fallback = await new GeminiProvider(
      key,
      fallbackSettings.model,
      'configureGeminiProModel',
      fallbackSettings.thinkingLevel,
      retries
    ).rewrite(request, signal);
    return {
      ...fallback,
      fallbackFromModel: normalizeModelId(model)
    };
  }
}

function isRewriteOperation(operation: KrenOperation): operation is RewriteOperation {
  return operation === 'rewrite' || operation === 'rewriteNatural' ||
    operation === 'rewriteConcise' || operation === 'rewriteJargonFree';
}

export function isProFallbackError(error: unknown): error is ProviderError {
  return error instanceof ProviderError &&
    (error.status === 404 || error.status === 429 || error.status === 503 || error.status === 504 ||
      error.reason === 'structuredOutput');
}

function alternateGeminiFallback(
  runtime: KrenRuntime,
  primaryModel: string
): { model: string; thinkingLevel: GeminiThinkingLevel | undefined } | undefined {
  const model = runtime.getSetting<string>(
    'gemini.alternateFallbackModel',
    'gemini-3.5-flash'
  ).trim();
  if (!model || normalizeModelId(model) === normalizeModelId(primaryModel)) return undefined;
  return {
    model,
    thinkingLevel: configuredThinkingLevel(
      model,
      runtime.getSetting<GeminiThinkingLevel | 'auto'>(
        'gemini.alternateFallbackThinkingLevel',
        'low'
      )
    )
  };
}

function normalizeModelId(model: string): string {
  return model.replace(/^models\//u, '');
}

export function isEnglishDictionaryQuery(text: string): boolean {
  return coreIsEnglishDictionaryQuery(text);
}

function isMultiWordEnglishQuery(text: string): boolean {
  return coreIsMultiWordEnglishQuery(text);
}

function applyLanguages(
  runtime: KrenRuntime,
  operation: 'translate' | 'explain',
  input: KrenOperationInput,
  analysis: SelectionAnalysis
): SelectionAnalysis {
  const configured = operation === 'translate'
    ? input.targetLanguage ?? runtime.getSetting<string>(
      'translation.targetLanguage',
      AUTO_ENGLISH_KOREAN_TARGET
    )
    : input.outputLanguage ?? runtime.getSetting<string>('explanation.outputLanguage', 'bilingual');
  const targetLanguage = configured === AUTO_ENGLISH_KOREAN_TARGET
    ? analysis.targetLanguage
    : configured === 'bilingual' ? 'ko' : configured;
  if (!isPlausibleLanguageCode(targetLanguage)) {
    throw new Error(`Invalid output language code: ${targetLanguage}.`);
  }
  return {
    ...analysis,
    kind: 'translation',
    sourceLanguage: 'auto',
    targetLanguage
  };
}

function isMerriamWebsterOperation(operation: KrenOperation): operation is MerriamWebsterOperation {
  return operation === 'englishDictionary' || operation === 'medical' || operation === 'synonyms';
}

async function lookupMerriamWebster(
  runtime: KrenRuntime,
  operation: MerriamWebsterOperation,
  analysis: SelectionAnalysis,
  signal: AbortSignal
): Promise<KrenResult> {
  const reference = MERRIAM_WEBSTER_OPERATIONS[operation];
  const apiKey = await runtime.getSecret(reference.secretKey);
  if (!apiKey) {
    throw new ProviderError(reference.missingKeyMessage, reference.missingKeyAction);
  }
  const result = await new MerriamWebsterProvider(apiKey, reference.reference).lookup(
    dictionaryRequest(analysis),
    signal
  );
  if (result) return result;
  if (operation !== 'englishDictionary') {
    throw new ProviderError(reference.noEntryMessage(analysis.text));
  }
  if (!runtime.getSetting<boolean>('dictionary.multiWordTranslationFallback', true)) {
    throw new ProviderError(
      `${reference.noEntryMessage(analysis.text)} The multi-word translation fallback is disabled in KREN Settings.`
    );
  }
  if (!isMultiWordEnglishQuery(analysis.text)) {
    throw new ProviderError(reference.noEntryMessage(analysis.text));
  }

  const configuredTarget = runtime.getSetting<string>(
    'translation.targetLanguage',
    AUTO_ENGLISH_KOREAN_TARGET
  );
  const targetLanguage = configuredTarget === AUTO_ENGLISH_KOREAN_TARGET
    ? analysis.targetLanguage
    : configuredTarget;
  if (!isPlausibleLanguageCode(targetLanguage)) {
    throw new Error(`Invalid output language code: ${targetLanguage}.`);
  }
  const request: TranslationRequest = {
    ...analysis,
    kind: 'translation',
    operation: 'translate',
    sourceLanguage: 'auto',
    targetLanguage
  };
  const provider = await createGoogleCloudProvider(
    runtime,
    'Merriam-Webster returned no entry for this expression. Set your Google Cloud Translation API key to use the multi-word fallback.'
  );
  return provider.translate(request, signal);
}

export async function runUserDictionaryCapture(
  runtime: KrenRuntime,
  expression: string,
  signal: AbortSignal,
  captureModeOverride?: UserDictionaryCaptureSettings['captureMode']
): Promise<UserDictionaryCaptureResult | UserDictionaryEntryV1> {
  if (!runtime.getSetting<boolean>('userDictionary.enabled', false)) {
    throw new Error('Enable User Dictionary in KREN Settings before adding an entry.');
  }
  const maxCharacters = runtime.getSetting<number>('translation.maxCharacters', 5000);
  if (expression.length > maxCharacters) {
    throw new Error(
      `The selected expression has ${expression.length} characters; the configured maximum is ${maxCharacters}.`
    );
  }
  const configuredSettings = readUserDictionaryCaptureSettings(runtime);
  const settings = captureModeOverride
    ? { ...configuredSettings, captureMode: captureModeOverride }
    : configuredSettings;
  const secretKey = KREN_SECRET_KEYS[settings.provider];
  const [apiKey, merriamWebsterApiKey] = await Promise.all([
    runtime.getSecret(secretKey),
    settings.captureMode === 'merriamWebsterAndLlm'
      ? runtime.getSecret(KREN_SECRET_KEYS.merriamWebsterCollegiate)
      : Promise.resolve(undefined)
  ]);
  if (!apiKey) {
    const providerName = settings.provider === 'gemini'
      ? 'Gemini'
      : settings.provider === 'openai' ? 'OpenAI' : 'Anthropic';
    const action = settings.provider === 'gemini'
      ? 'setGeminiKey' as const
      : settings.provider === 'openai'
        ? 'setOpenAIKey' as const
        : 'setAnthropicKey' as const;
    throw new ProviderError(
      `Set your ${providerName} API key before adding a User Dictionary entry.`,
      action
    );
  }
  if (settings.captureMode === 'merriamWebsterAndLlm' && !merriamWebsterApiKey) {
    throw new ProviderError(
      'Set your Merriam-Webster Collegiate API key before using Merriam-Webster + LLM capture.',
      'setMerriamWebsterCollegiateKey'
    );
  }
  await beforeLanguageModelRequest(runtime, settings.provider);
  const attempts = settings.provider === 'gemini'
    ? languageModelRetries(runtime, 'gemini.retry')
    : languageModelRetries(runtime, 'languageModel.retry');
  const languageModelTransport = new HttpUserDictionaryProviderTransport({
    provider: settings.provider,
    apiKey,
    model: settings.model,
    thinkingOrEffort: settings.thinkingOrEffort,
    maxAttempts: attempts
  });
  const generateLanguageModelCapture = (submittedExpression: string) =>
    captureUserDictionaryDraft(
      submittedExpression,
      settings,
      languageModelTransport,
      signal,
      { maxMalformedAttempts: attempts }
    );
  const languageModelCapture = generateLanguageModelCapture(expression);
  if (settings.captureMode === 'llmOnly') {
    return languageModelCapture;
  }

  const referenceWork = 'collegiate' as const;
  const merriamWebsterLookup = new MerriamWebsterProvider(
    merriamWebsterApiKey!,
    referenceWork
  ).lookupWithMetadata({
    text: expression,
    sourceLanguage: 'en',
    targetLanguage: 'en',
    kind: 'dictionary',
    operation: 'translate'
  }, signal);
  const [languageModelOutcome, merriamWebsterOutcome] = await Promise.allSettled([
    languageModelCapture,
    merriamWebsterLookup
  ]);
  const aborted = [languageModelOutcome, merriamWebsterOutcome].find(
    (outcome) => outcome.status === 'rejected' && isAbortError(outcome.reason)
  );
  if (aborted?.status === 'rejected') throw aborted.reason;
  if (languageModelOutcome.status === 'rejected') throw languageModelOutcome.reason;

  if (merriamWebsterOutcome.status === 'rejected') {
    return {
      expression,
      captureMode: 'merriamWebsterAndLlm',
      draft: languageModelOutcome.value,
      merriamWebster: {
        referenceWork,
        lookupTerm: expression,
        failure: merriamWebsterCaptureFailure(merriamWebsterOutcome.reason)
      },
      fallbackUsed: false
    };
  }
  if (!merriamWebsterOutcome.value) {
    const draft = attachUserDictionaryMerriamWebsterReference(
      languageModelOutcome.value,
      { referenceWork, lookupTerm: expression, matchStatus: 'noMatch' }
    );
    return {
      expression,
      captureMode: 'merriamWebsterAndLlm',
      ...(settings.fallbackOnMerriamWebsterNoMatch ? { draft } : {}),
      merriamWebster: { referenceWork, lookupTerm: expression, noMatch: true },
      fallbackUsed: settings.fallbackOnMerriamWebsterNoMatch
    };
  }
  const lookup = merriamWebsterOutcome.value;
  if (lookup.result.kind !== 'dictionary') {
    throw new Error('KREN received an invalid User Dictionary reference result. Nothing was saved.');
  }
  const draft = attachUserDictionaryMerriamWebsterReference(
    languageModelOutcome.value,
    {
      referenceWork,
      lookupTerm: expression,
      ...(lookup.entryId ? { entryId: lookup.entryId } : {}),
      matchStatus: 'matched'
    }
  );
  return {
    expression,
    captureMode: 'merriamWebsterAndLlm',
    draft,
    merriamWebster: {
      referenceWork,
      lookupTerm: expression,
      result: lookup.result,
      ...(lookup.entryId ? { entryId: lookup.entryId } : {})
    },
    fallbackUsed: false
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function merriamWebsterCaptureFailure(error: unknown): string {
  if (!(error instanceof ProviderError)) {
    return 'Merriam-Webster provider failure. The independent personal draft remains available.';
  }
  if (error.status === 401 || error.status === 403) {
    return 'Merriam-Webster authentication failure. Check the selected reference-work key.';
  }
  if (error.status === 429) {
    return 'Merriam-Webster quota failure. The provider rejected the lookup limit.';
  }
  if (error.status === undefined && error.message === 'Merriam-Webster could not be reached.') {
    return 'Merriam-Webster network failure. The provider could not be reached.';
  }
  return `Merriam-Webster provider failure${error.status ? ` (${error.status})` : ''}.`;
}

function readUserDictionaryCaptureSettings(runtime: KrenRuntime): UserDictionaryCaptureSettings {
  const captureModeValue = runtime.getSetting<unknown>(
    'userDictionary.defaultCaptureMode',
    USER_DICTIONARY_CAPTURE_DEFAULTS.captureMode
  );
  const providerValue = runtime.getSetting<unknown>(
    'userDictionary.provider',
    USER_DICTIONARY_CAPTURE_DEFAULTS.provider
  );
  const thinkingValue = runtime.getSetting<unknown>(
    'userDictionary.thinkingOrEffort',
    USER_DICTIONARY_CAPTURE_DEFAULTS.thinkingOrEffort
  );
  const examplesValue = runtime.getSetting<unknown>(
    'userDictionary.numberOfExamples',
    USER_DICTIONARY_CAPTURE_DEFAULTS.numberOfExamples
  );
  const entryLanguage = runtime.getSetting<string>(
    'userDictionary.entryLanguage',
    USER_DICTIONARY_CAPTURE_DEFAULTS.entryLanguage
  ).trim();
  const model = runtime.getSetting<string>(
    'userDictionary.model',
    USER_DICTIONARY_CAPTURE_DEFAULTS.model
  ).trim();
  if (!isUserDictionaryCaptureMode(captureModeValue) ||
      !isUserDictionaryProvider(providerValue) ||
      !isUserDictionaryThinkingOrEffort(thinkingValue) ||
      !isUserDictionaryExampleCount(examplesValue) ||
      (entryLanguage !== 'auto' && !isPlausibleLanguageCode(entryLanguage)) ||
      !/^models\/[\w.:-]+$|^[\w.:-]+$/u.test(model)) {
    throw new Error('KREN User Dictionary settings contain an invalid value.');
  }
  return {
    captureMode: captureModeValue,
    fallbackOnMerriamWebsterNoMatch: runtime.getSetting<boolean>(
      'userDictionary.fallbackOnMerriamWebsterNoMatch',
      USER_DICTIONARY_CAPTURE_DEFAULTS.fallbackOnMerriamWebsterNoMatch
    ),
    provider: providerValue as UserDictionaryProvider,
    model,
    thinkingOrEffort: thinkingValue,
    entryLanguage,
    includePronunciation: runtime.getSetting<boolean>(
      'userDictionary.includePronunciation',
      USER_DICTIONARY_CAPTURE_DEFAULTS.includePronunciation
    ),
    includeSynonyms: runtime.getSetting<boolean>(
      'userDictionary.includeSynonyms',
      USER_DICTIONARY_CAPTURE_DEFAULTS.includeSynonyms
    ),
    includeUsageNotes: runtime.getSetting<boolean>(
      'userDictionary.includeUsageNotes',
      USER_DICTIONARY_CAPTURE_DEFAULTS.includeUsageNotes
    ),
    numberOfExamples: examplesValue,
    includeTechnicalMeanings: runtime.getSetting<boolean>(
      'userDictionary.includeTechnicalMeanings',
      USER_DICTIONARY_CAPTURE_DEFAULTS.includeTechnicalMeanings
    )
  };
}

async function lookupKoreanDictionary(
  runtime: KrenRuntime,
  analysis: SelectionAnalysis,
  signal: AbortSignal
): Promise<KrenResult> {
  const apiKey = await runtime.getSecret(KREN_SECRET_KEYS.koreanDictionary);
  if (!apiKey) {
    throw new ProviderError(
      'Set your Korean Basic Dictionary API key before searching.',
      'setDictionaryKey'
    );
  }
  const result = await new KoreanDictionaryProvider(apiKey).lookup(
    dictionaryRequest(analysis),
    signal
  );
  if (!result) {
    throw new ProviderError(
      `Korean Basic Dictionary returned no matching entry for “${analysis.text}”.`
    );
  }
  return result;
}

function dictionaryRequest(analysis: SelectionAnalysis): DictionaryRequest {
  return {
    ...analysis,
    kind: 'dictionary',
    operation: 'translate'
  };
}

async function createTranslationProvider(
  runtime: KrenRuntime
): Promise<TranslationProvider> {
  const configured = runtime.getSetting<TranslationProviderId>(
    'translationProvider',
    'googleCloudTranslation'
  );
  const providerId: TranslationProviderId = configured;
  if (providerId === 'gemini') {
    const key = await runtime.getSecret(KREN_SECRET_KEYS.gemini);
    if (!key) {
      throw new ProviderError('Set your default Gemini API key before using Gemini.', 'setGeminiKey');
    }
    await beforeLanguageModelRequest(runtime, 'gemini', 'standard');
    const model = runtime.getSetting<string>('gemini.model', 'gemini-3.5-flash');
    const thinking = configuredThinkingLevel(
      model,
      runtime.getSetting<GeminiThinkingLevel | 'auto'>('gemini.thinkingLevel', 'auto')
    );
    const retries = runtime.getSetting<boolean>('gemini.retry.enabled', true)
      ? runtime.getSetting<number>('gemini.retry.maxAttempts', 4)
      : 1;
    return new GeminiProvider(key, model, 'configureGeminiModel', thinking, retries);
  }

  return createGoogleCloudProvider(runtime);
}

async function createLanguageModelProvider(
  runtime: KrenRuntime,
  purpose: 'explanation' | 'rewrite'
): Promise<LanguageModelProvider> {
  const providerId = runtime.getSetting<LanguageModelProviderId>(
    `${purpose}.provider`,
    'gemini'
  );
  if (providerId !== 'gemini') {
    return createExternalLanguageModelProvider(runtime, providerId);
  }

  const profile = runtime.getSetting<GeminiProfile>(
    `${purpose}.geminiProfile`,
    'standard'
  );
  const key = await runtime.getSecret(
    profile === 'pro' ? KREN_SECRET_KEYS.geminiPro : KREN_SECRET_KEYS.gemini
  );
  if (!key) {
    const message = profile === 'pro'
      ? 'Set your alternate Gemini API key before using the alternate Gemini profile.'
      : 'Set your default Gemini API key before using the default Gemini profile.';
    throw new ProviderError(message, profile === 'pro' ? 'setGeminiProKey' : 'setGeminiKey');
  }
  await beforeLanguageModelRequest(runtime, 'gemini', profile);
  const model = profile === 'pro'
    ? runtime.getSetting<string>('gemini.alternateModel', 'gemini-3.1-pro-preview')
    : runtime.getSetting<string>('gemini.model', 'gemini-3.5-flash');
  const configuredAlternateThinking = runtime.getSetting<GeminiThinkingLevel>(
    'gemini.alternateThinkingLevel',
    'low'
  );
  const alternateThinking: GeminiThinkingLevel =
    configuredAlternateThinking === 'medium' || configuredAlternateThinking === 'high'
      ? configuredAlternateThinking
      : 'low';
  const defaultThinking = configuredThinkingLevel(
    model,
    runtime.getSetting<GeminiThinkingLevel | 'auto'>('gemini.thinkingLevel', 'auto')
  );
  return new GeminiProvider(
    key,
    model,
    profile === 'pro' ? 'configureGeminiProModel' : 'configureGeminiModel',
    profile === 'pro' ? alternateThinking : defaultThinking,
    languageModelRetries(runtime, 'gemini.retry')
  );
}

async function explainWithLanguageModelProvider(
  runtime: KrenRuntime,
  request: TranslationRequest,
  signal: AbortSignal
): Promise<Extract<KrenResult, { kind: 'translation' }>> {
  const provider = await createLanguageModelProvider(runtime, 'explanation');
  try {
    return await provider.explain(request, signal);
  } catch (error) {
    const providerId = runtime.getSetting<LanguageModelProviderId>('explanation.provider', 'gemini');
    const profile = runtime.getSetting<GeminiProfile>('explanation.geminiProfile', 'standard');
    const fallbackEnabled = providerId === 'gemini' && profile === 'pro' &&
      runtime.getSetting<boolean>('gemini.alternateFallbackEnabled', true);
    const primaryModel = runtime.getSetting<string>(
      'gemini.alternateModel',
      'gemini-3.1-pro-preview'
    );
    const fallbackSettings = alternateGeminiFallback(runtime, primaryModel);
    if (!fallbackEnabled || !fallbackSettings || !isProFallbackError(error)) throw error;
    const key = await runtime.getSecret(KREN_SECRET_KEYS.geminiPro);
    if (!key) throw error;
    const fallback = await new GeminiProvider(
      key,
      fallbackSettings.model,
      'configureGeminiProModel',
      fallbackSettings.thinkingLevel,
      languageModelRetries(runtime, 'gemini.retry')
    ).explain(request, signal);
    return {
      ...fallback,
      fallbackFromModel: normalizeModelId(primaryModel)
    };
  }
}

async function createExternalLanguageModelProvider(
  runtime: KrenRuntime,
  providerId: Exclude<LanguageModelProviderId, 'gemini'>
): Promise<LanguageModelProvider> {
  const key = await runtime.getSecret(KREN_SECRET_KEYS[providerId]);
  if (!key) {
    const providerName = providerId === 'openai' ? 'OpenAI' : 'Anthropic';
    const action = providerId === 'openai' ? 'setOpenAIKey' : 'setAnthropicKey';
    throw new ProviderError(
      `Set your ${providerName} API key before using ${providerName}.`,
      action
    );
  }
  await beforeLanguageModelRequest(runtime, providerId);
  const attempts = languageModelRetries(runtime, 'languageModel.retry');
  if (providerId === 'openai') {
    return new OpenAIProvider(
      key,
      runtime.getSetting<string>('openai.model', 'gpt-5.4'),
      runtime.getSetting<OpenAIReasoningEffort>('openai.reasoningEffort', 'low'),
      attempts
    );
  }
  return new AnthropicProvider(
    key,
    runtime.getSetting<string>('anthropic.model', 'claude-sonnet-4-6'),
    runtime.getSetting<AnthropicEffort>('anthropic.effort', 'low'),
    attempts
  );
}

function languageModelRetries(runtime: KrenRuntime, prefix: string): number {
  return runtime.getSetting<boolean>(`${prefix}.enabled`, true)
    ? runtime.getSetting<number>(`${prefix}.maxAttempts`, 3)
    : 1;
}

async function beforeLanguageModelRequest(
  runtime: KrenRuntime,
  provider: LanguageModelProviderId,
  profile?: GeminiProfile
): Promise<void> {
  if (runtime.beforeLanguageModelRequest) {
    await runtime.beforeLanguageModelRequest(provider, profile);
    return;
  }
  if (provider === 'gemini') {
    await runtime.beforeGeminiRequest(profile);
  }
}

async function createGoogleCloudProvider(
  runtime: KrenRuntime,
  missingKeyMessage = 'Set your Google Cloud Translation API key before using this provider.'
): Promise<GoogleCloudTranslationProvider> {
  const key = await runtime.getSecret(KREN_SECRET_KEYS.googleCloudTranslation);
  if (!key) {
    throw new ProviderError(missingKeyMessage, 'setGoogleCloudTranslationKey');
  }
  return new GoogleCloudTranslationProvider(key, (characters) =>
    runtime.reserveCloudCharacters(characters)
  );
}
