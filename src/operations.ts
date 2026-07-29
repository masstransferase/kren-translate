import { analyzeSelection } from './classifier.js';
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
import { MerriamWebsterProvider } from './providers/merriamWebster.js';
import { MerriamWebsterThesaurusProvider } from './providers/merriamWebsterThesaurus.js';
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
  RewriteOperation,
  RewriteRequest,
  RewriteRhetoricalMode,
  RewriteTone,
  SelectionAnalysis,
  TranslationProvider,
  TranslationProviderId,
  TranslationRequest
} from './types.js';

export const KREN_SECRET_KEYS = {
  gemini: 'kren.gemini.apiKey',
  geminiPro: 'kren.gemini.proApiKey',
  openai: 'kren.openai.apiKey',
  anthropic: 'kren.anthropic.apiKey',
  googleCloudTranslation: 'kren.googleCloudTranslation.apiKey',
  koreanDictionary: 'kren.koreanDictionary.apiKey',
  merriamWebsterCollegiate: 'kren.merriamWebster.collegiateApiKey',
  merriamWebsterThesaurus: 'kren.merriamWebster.thesaurusApiKey'
} as const;

export type KrenSecretKey = typeof KREN_SECRET_KEYS[keyof typeof KREN_SECRET_KEYS];
export type KrenOperation =
  | 'translate'
  | 'explain'
  | 'englishDictionary'
  | 'koreanDictionary'
  | 'synonyms'
  | 'grammar'
  | 'rewrite'
  | 'rewriteNatural'
  | 'rewriteConcise'
  | 'rewriteJargonFree';

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
    return rewriteEnglish(runtime, operation, analysis.text, signal);
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

  if (operation === 'englishDictionary') {
    return lookupEnglishDictionary(runtime, analysis, signal);
  }
  if (operation === 'synonyms') {
    return lookupMerriamWebsterThesaurus(runtime, analysis, signal);
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
  if ((operation === 'englishDictionary' || operation === 'synonyms') &&
      !isEnglishDictionaryQuery(analysis.text)) {
    const label = operation === 'synonyms' ? 'Synonyms Search' : 'English Dictionary Search';
    throw new Error(`${label} requires an English word or short expression.`);
  }
  if (operation === 'koreanDictionary' &&
      (analysis.kind !== 'dictionary' || analysis.sourceLanguage !== 'ko')) {
    throw new Error('Korean Dictionary Search requires one Korean word.');
  }
  if (isRewriteOperation(operation) &&
      !/\p{Script=Latin}/u.test(analysis.text)) {
    throw new Error('Rewrite English requires English text.');
  }
  if (operation === 'grammar' && !/\p{Script=Latin}/u.test(analysis.text)) {
    throw new Error('Grammar Check currently requires English text.');
  }
}

async function rewriteEnglish(
  runtime: KrenRuntime,
  operation: RewriteOperation,
  text: string,
  signal: AbortSignal
): Promise<KrenResult> {
  const configuredEnglishVariety = runtime.getSetting<RewriteEnglishVarietySetting>(
    'rewrite.englishVariety',
    'followGrammar'
  );
  const englishVariety: RewriteEnglishVariety = configuredEnglishVariety === 'followGrammar'
    ? runtime.getSetting<GrammarDialect>('grammar.dialect', 'american')
    : configuredEnglishVariety;
  const request: RewriteRequest = {
    text,
    sourceLanguage: 'en',
    targetLanguage: 'en',
    kind: 'translation',
    operation,
    englishVariety,
    domain: runtime.getSetting<RewriteDomain>('rewrite.domain', 'general'),
    tone: runtime.getSetting<RewriteTone>('rewrite.tone', 'preserveVoice'),
    rhetoricalMode: runtime.getSetting<RewriteRhetoricalMode>(
      'rewrite.rhetoricalMode',
      'preserveOriginal'
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

async function lookupMerriamWebsterThesaurus(
  runtime: KrenRuntime,
  analysis: SelectionAnalysis,
  signal: AbortSignal
): Promise<KrenResult> {
  const apiKey = await runtime.getSecret(KREN_SECRET_KEYS.merriamWebsterThesaurus);
  if (!apiKey) {
    throw new ProviderError(
      'Set your Merriam-Webster Collegiate Thesaurus API key before searching.',
      'setMerriamWebsterThesaurusKey'
    );
  }
  const result = await new MerriamWebsterThesaurusProvider(apiKey).lookup(
    dictionaryRequest(analysis),
    signal
  );
  if (!result) {
    throw new ProviderError(
      `Merriam-Webster Collegiate Thesaurus returned no entry for “${analysis.text}”.`
    );
  }
  return result;
}

const ENGLISH_EXPRESSION_TOKEN = "[\\p{Script=Latin}\\p{M}][\\p{Script=Latin}\\p{M}'’.-]*";
const ENGLISH_EXPRESSION_PATTERN = new RegExp(
  `^${ENGLISH_EXPRESSION_TOKEN}(?:\\s+${ENGLISH_EXPRESSION_TOKEN}){0,7}$`,
  'u'
);

export function isEnglishDictionaryQuery(text: string): boolean {
  return ENGLISH_EXPRESSION_PATTERN.test(text.trim());
}

function isMultiWordEnglishQuery(text: string): boolean {
  return isEnglishDictionaryQuery(text) && text.trim().split(/\s+/u).length > 1;
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

async function lookupEnglishDictionary(
  runtime: KrenRuntime,
  analysis: SelectionAnalysis,
  signal: AbortSignal
): Promise<KrenResult> {
  const apiKey = await runtime.getSecret(KREN_SECRET_KEYS.merriamWebsterCollegiate);
  if (!apiKey) {
    throw new ProviderError(
      'Set your Merriam-Webster Collegiate API key before searching.',
      'setMerriamWebsterCollegiateKey'
    );
  }
  const result = await new MerriamWebsterProvider(apiKey).lookup(
    dictionaryRequest(analysis),
    signal
  );
  if (result) return result;
  if (!runtime.getSetting<boolean>('dictionary.multiWordTranslationFallback', true)) {
    throw new ProviderError(
      `Merriam-Webster Collegiate returned no entry for “${analysis.text}”. The multi-word translation fallback is disabled in KREN Settings.`
    );
  }
  if (!isMultiWordEnglishQuery(analysis.text)) {
    throw new ProviderError(
      `Merriam-Webster Collegiate returned no entry for “${analysis.text}”.`
    );
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
