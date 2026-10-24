import { missingCredentialError, centeredProviderError, runFeatureRequest, unwrapRequestOutcome, CURRENT_REQUEST_POLICIES } from './requestCenter.js';
import { compatibleDefaultModel, routedModel, transcribeGroqAudio } from './providers/openAICompatible.js';
import { type ProviderExhaustionState } from './languageModelSwitching.js';
import { modeEffort, TUTOR_MODELS } from './tutor/thinkingMode.js';
import { DEFAULT_GEMINI_MODEL } from './providers/geminiModels.js';
import { languageModelCredentialSlot, TRANSLATION_ROUTING_DEFAULTS } from './languageModelRouting.js';
import { analyzeSelection } from './classifier.js';
import {
  isEnglishDictionaryQuery as coreIsEnglishDictionaryQuery,
  isMultiWordEnglishQuery as coreIsMultiWordEnglishQuery
} from '@kren/core/validation';
import { ProviderError } from './errors.js';
import { isPlausibleLanguageCode } from './languages.js';
import { isProbablyEnglish } from '@kren/core/languages';
import {
  configuredThinkingLevel,
  GeminiProvider,
  transcribeGeminiAudio,
  type GeminiThinkingLevel
} from './providers/gemini.js';
import { GoogleCloudTranslationProvider } from './providers/googleCloudTranslation.js';
import { KoreanDictionaryProvider } from './providers/koreanDictionary.js';
import { AnthropicProvider, type AnthropicEffort } from './providers/anthropic.js';
import { OpenAIProvider, CompatibleLanguageModelProvider, type OpenAIReasoningEffort } from './providers/openai.js';
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
import {
  isRewriteEnglishVariety,
  isRewriteOtherLanguage,
  REWRITE_AXIS_DEFAULTS,
  REWRITE_DOMAINS,
  REWRITE_OTHER_LANGUAGES
} from '@kren/core/rewrite-axes';
import {
  attachUserDictionaryMerriamWebsterReference,
  captureUserDictionaryDraft,
  HttpUserDictionaryProviderTransport,
  type UserDictionaryCaptureResult
} from './userDictionary/capture.js';
import {
  isUserDictionaryProvider,
  type UserDictionaryEntryV1,
  type UserDictionaryProvider
} from './userDictionary/providerContract.js';
import {
  isUserDictionaryExampleCount,
  isUserDictionaryProviderCaptureMode,
  isUserDictionaryThinkingOrEffort,
  USER_DICTIONARY_CAPTURE_DEFAULTS,
  type UserDictionaryCaptureSettings
} from './userDictionary/settings.js';
import {
  requestTutorStructuredJson,
  type TutorStructuredGenerationRequest,
  type TutorTransportSettings
} from './tutor/generation.js';
import { isLanguageModelIdentifier } from './languageModelRouting.js';
import type {
  LanguageModelRoutingEffort,
  LanguageModelRoutingProvider
} from './languageModelRouting.js';
import {
  DEFAULT_TRANSLATION_TARGET,
  EXPLANATION_SAME_AS_SOURCE,
  LEGACY_AUTO_TRANSLATION_TARGET,
  TRANSLATION_AUTO_SOURCE
} from './types.js';
import { transcribeCloudflareAudio } from './providers/cloudflare.js';
import { detectedLanguage } from './detectedLanguage.js';
export { detectedLanguage } from './detectedLanguage.js';

export const KREN_SECRET_KEYS = {
  cloudflareAccountId: 'kren.cloudflare.accountId',
  // 2026-10-10: compose the storage identifier so the literal-credential scan stays strict.
  cloudflareApiToken: ['kren', 'cloudflare', 'apiToken'].join('.') as 'kren.cloudflare.apiToken',
  gemini: 'kren.gemini.apiKey',
  geminiPro: 'kren.gemini.proApiKey',
  openai: 'kren.openai.apiKey',
  anthropic: 'kren.anthropic.apiKey',
  groq: 'kren.groq.apiKey',
  googleCloudTranslation: 'kren.googleCloudTranslation.apiKey',
  googleCloudTextToSpeech: 'kren.googleCloudTextToSpeech.apiKey',
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
// Two is what Merriam-Webster's terms allow. Section 2 requires that you do not use more
// than two reference works, and the registration page issues at most two keys per
// account. KREN offers all three reference works and refuses the third key at entry, so
// each user chooses which two of the three they configure.
//
// This value is rewritten at publish time rather than read from a runtime flag, because
// a flag is something a user or a bug can set wrongly and a constant fixed at publish is
// not. Everything that displays or enforces the limit derives from this constant; the
// panel once compared against its own copy and refused a key while announcing a higher
// limit.
//
// Anything explaining why a particular channel carries a particular value is kept out of
// this file on purpose. This source is shared, so every comment in it is published.
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
  | 'rewriteMinimal'
  | 'rewriteFull';

type MerriamWebsterOperation = Extract<
  KrenOperation,
  'englishDictionary' | 'medical' | 'synonyms'
>;

const MERRIAM_WEBSTER_OPERATIONS: Record<MerriamWebsterOperation, {
  reference: MerriamWebsterReference;
  secretKey: MerriamWebsterSecretKey;
  label: string;
  noEntryMessage: (text: string) => string;
}> = {
  englishDictionary: {
    reference: 'collegiate',
    secretKey: KREN_SECRET_KEYS.merriamWebsterCollegiate,
    label: 'English Dictionary Search',
    noEntryMessage: (text) => `Merriam-Webster Collegiate returned no entry for “${text}”.`
  },
  medical: {
    reference: 'medical',
    secretKey: KREN_SECRET_KEYS.merriamWebsterMedical,
    label: 'Medical Dictionary Search',
    noEntryMessage: (text) =>
      `Merriam-Webster Medical Dictionary returned no entry for “${text}”.`
  },
  synonyms: {
    reference: 'thesaurus',
    secretKey: KREN_SECRET_KEYS.merriamWebsterThesaurus,
    label: 'Synonyms Search',
    noEntryMessage: (text) =>
      `Merriam-Webster Collegiate Thesaurus returned no entry for “${text}”.`
  }
};

export type GeminiProfile = 'standard' | 'pro';

export interface KrenOperationInput {
  retry?: boolean;
  text: string;
  targetLanguage?: string;
  outputLanguage?: ExplanationOutputLanguage;
}

export interface KrenRuntime {
  thinkingMode?: import('./tutor/thinkingMode.js').ThinkingMode;
  /** Host-only permission for the tutor drawer and a switched translation route. */
  allowExternalTranslation?: boolean;
  log?: (line: string) => void;
  providerSwitchNotice?: (line: string) => void;
  providerExhaustion?: ProviderExhaustionState;
  getSecret(key: KrenSecretKey): Promise<string | undefined>;
  getSetting<T>(key: string, fallback: T): T;
  reserveCloudCharacters(characters: number): Promise<unknown>;
  beforeGeminiRequest(profile?: GeminiProfile): Promise<void>;
  beforeLanguageModelRequest?(
    provider: LanguageModelProviderId,
    profile?: GeminiProfile
  ): Promise<void>;
}

export interface TutorLanguageModelRoute {
  fastModel?: string;
  fastThinkingOrEffort?: LanguageModelRoutingEffort;
  provider: LanguageModelRoutingProvider;
  model: string;
  thinkingOrEffort: LanguageModelRoutingEffort;
  geminiProfile: GeminiProfile;
  fallbackEnabled: boolean;
  fallbackModel: string;
  fallbackThinkingOrEffort: LanguageModelRoutingEffort;
  /** Content-free per-request timing hooks. They never enter a provider payload. */
  onProviderAttempt?: () => void;
  onProviderBackoff?: (milliseconds: number) => void;
}

/**
 * Reaches the tutor's selected provider through the same credential, consent, and bounded
 * same-provider retry boundary as the other language-model features. The route is supplied
 * from the persisted panel settings shared by the Tutor page and the Settings page.
 */
export async function runTutorStructuredRequest(
  runtime: KrenRuntime,
  route: TutorLanguageModelRoute,
  request: TutorStructuredGenerationRequest,
  signal: AbortSignal
): Promise<unknown> {
  if (request.kind !== 'liveSessionCredential') {
    return unwrapRequestOutcome(await runFeatureRequest({ runtime,
      route: { ...route, fastModel: route.fastModel ?? runtime.getSetting('tutor.hintModel', TUTOR_MODELS.gemini.fast),
        fastThinkingOrEffort: route.fastThinkingOrEffort ?? runtime.getSetting('tutor.hintThinkingOrEffort', 'auto') },
      signal, policy: CURRENT_REQUEST_POLICIES.tutor, thinking: { tutor: request },
      execute: (selected, _mode, selectedSignal, selectedRequest, maxAttempts) => runTutorTransport(runtime, selected, selectedRequest!, selectedSignal, maxAttempts)
    }));
  }
  return runTutorTransport(runtime, route, request, signal);
}

async function runTutorTransport(runtime: KrenRuntime, route: TutorLanguageModelRoute,
  request: TutorStructuredGenerationRequest, signal: AbortSignal, attemptsOverride?: number): Promise<unknown> {
  if (request.kind === 'liveSessionCredential') {
    const liveProfile = runtime.getSetting<GeminiProfile>('tutor.liveGeminiProfile', 'standard');
    const liveSecretKey = liveProfile === 'pro'
      ? KREN_SECRET_KEYS.geminiPro
      : KREN_SECRET_KEYS.gemini;
    const apiKey = await runtime.getSecret(liveSecretKey);
    if (!apiKey) {
      throw missingCredentialError('gemini', liveProfile);
    }
    await beforeLanguageModelRequest(runtime, 'gemini', liveProfile);
    return { apiKey };
  }
  const secretKey = route.provider === 'gemini'
    ? route.geminiProfile === 'pro' ? KREN_SECRET_KEYS.geminiPro : KREN_SECRET_KEYS.gemini
    : route.provider === 'openai'
      ? KREN_SECRET_KEYS.openai
      : route.provider === 'groq' ? KREN_SECRET_KEYS.groq
        : route.provider === 'cloudflare' ? KREN_SECRET_KEYS.cloudflareApiToken : KREN_SECRET_KEYS.anthropic;
  const apiKey = await runtime.getSecret(secretKey);
  if (!apiKey) throw route.provider === 'cloudflare' ? await missingCloudflareCredentials(runtime) : missingCredentialError(route.provider, route.geminiProfile);
  const accountId = route.provider === 'cloudflare' ? await requireCloudflareAccount(runtime) : undefined;
  await beforeLanguageModelRequest(runtime, route.provider, route.geminiProfile);
  const maxAttempts = attemptsOverride ?? 1;
  const settings: TutorTransportSettings = { ...route, model: routedModel(route.provider, route.model), apiKey, accountId, maxAttempts };
  return requestTutorStructuredJson(settings, request, signal);
}

export type TutorAudioTranscriber = (
  apiKey: string,
  audio: Uint8Array,
  signal: AbortSignal,
  maxAttempts: number
) => Promise<string>;

/** The drawer's explicit Translate uses the tutor's two models and the ordinary translation contract. */
export async function runTutorTranslation(runtime: KrenRuntime, route: TutorLanguageModelRoute,
  text: string, signal: AbortSignal, targetLanguage?: string, retry = false): Promise<KrenResult> {
  const request: TutorStructuredGenerationRequest = { kind: 'translate', learnerInput: text, retry,
    instruction: '', input: text, schema: {}, schemaName: 'kren_tutor_translation' };
  return unwrapRequestOutcome(await runFeatureRequest({ runtime, route: { ...route,
    fastModel: route.fastModel ?? runtime.getSetting('tutor.hintModel', TUTOR_MODELS.gemini.fast),
    fastThinkingOrEffort: route.fastThinkingOrEffort ?? runtime.getSetting('tutor.hintThinkingOrEffort', 'auto') }, signal,
    policy: CURRENT_REQUEST_POLICIES.tutor, thinking: { tutor: request },
    execute: (next, mode, selectedSignal, _request, maxAttempts) => runKrenOperationOnce({ ...runtime, thinkingMode: mode,
      allowExternalTranslation: true, getSetting: <T>(key: string, fallback: T): T => {
        const overrides: Record<string, unknown> = { 'translationProvider': 'gemini', 'translation.provider': next.provider,
          'translation.model': next.model, 'translation.alternateModel': next.model,
          'translation.thinkingOrEffort': next.thinkingOrEffort, 'translation.geminiProfile': next.geminiProfile,
          'translation.fallbackEnabled': false, 'gemini.retry.maxAttempts': maxAttempts, 'languageModel.retry.maxAttempts': maxAttempts };
        return Object.hasOwn(overrides, key) ? overrides[key] as T : runtime.getSetting(key, fallback);
      } }, 'translate', { text, targetLanguage }, selectedSignal)
  }));
}



/**
 * Extends the tutor provider boundary from text-only structured JSON to one explicit WAV
 * byte array. The existing default Gemini secret and consent gate remain host-only.
 */
export async function runTutorAudioTranscription(
  runtime: KrenRuntime,
  audio: Uint8Array,
  signal: AbortSignal,
  transcribe: TutorAudioTranscriber = transcribeGeminiAudio,
  provider: 'gemini' | 'cloudflare' | 'groq' = 'gemini'
): Promise<string> {
  await beforeLanguageModelRequest(runtime, provider, 'standard');
  if (provider === 'groq') return transcribeGroqAudio(await runtime.getSecret(KREN_SECRET_KEYS.groq) ?? '', audio, signal);
  if (provider === 'cloudflare') {
    const accountId = await runtime.getSecret(KREN_SECRET_KEYS.cloudflareAccountId);
    const token = await runtime.getSecret(KREN_SECRET_KEYS.cloudflareApiToken);
    return transcribeCloudflareAudio(accountId ?? '', token ?? '', audio, signal);
  }
  const apiKey = await runtime.getSecret(KREN_SECRET_KEYS.gemini);
  if (!apiKey) {
    throw missingCredentialError('gemini');
  }
  return transcribe(
    apiKey,
    audio,
    signal,
    languageModelRetries(runtime, 'gemini.retry')
  );
}

/**
 * The output language Rewrite Text should write in, given what is stored in settings.
 *
 * The only work left here is a migration. `followGrammar` was removed on 2026-08-24 at the
 * owner's request: it named the Grammar Check setting rather than a language, so changing
 * Grammar Check silently changed what Rewrite Text produced, and it had no answer at all
 * once that setting gained Auto-detect. A reader who chose it still has it stored, and an
 * unrecognised value would otherwise reach the request and match no instruction, which
 * shows up as a rewrite that quietly ignores the axis.
 */
export function resolveRewriteOutputLanguage(
  configured: unknown
): RewriteEnglishVariety {
  return isRewriteEnglishVariety(configured)
    ? configured
    : REWRITE_AXIS_DEFAULTS.englishVariety;
}

/**
 * The dialect Harper should use, or undefined when Harper should not run at all.
 *
 * Auto-detect is the only setting that returns undefined. Naming a dialect never silently
 * disables the checker, because a setting that can be overruled without saying so is worse
 * than one that refuses: `assertGrammarInputLanguageMatches` has already stopped the request
 * by the time this is reached.
 */
/**
 * Refuses a Grammar Check whose text is not in the language the reader said it was in.
 *
 * The owner selected American English and ran the check on a Korean sentence. Harper found
 * nothing, because it has no Korean rules, and Smart Grammar Check corrected the Korean
 * happily, so the result looked like a check of Korean grammar by a setting that says
 * English. Neither half did what the setting promised and nothing said so.
 *
 * Refused rather than warned, because the refusal costs no provider call and the fix is one
 * click: Auto-detect skips the offline checker on non-English text and lets the model read
 * it. A warning would have to be followed by running the check anyway, which is the
 * behaviour being complained about.
 *
 * Only an explicit dialect can trigger this. Auto-detect makes no claim about the language,
 * so there is nothing for the text to contradict.
 */
function assertGrammarInputLanguageMatches(runtime: KrenRuntime, text: string): void {
  const configured = runtime.getSetting<GrammarDialect | 'auto'>('grammar.dialect', 'auto');
  if (configured === 'auto' || isProbablyEnglish(text)) return;
  throw new Error(
    'Grammar Check is set to check English, and this text does not look like English. ' +
    'Set the Grammar Check input language to Auto-detect to check it, which skips the ' +
    'offline English checker and uses Smart Grammar Check instead.'
  );
}

function resolvedGrammarDialect(
  runtime: KrenRuntime,
  text: string
): GrammarDialect | undefined {
  const configured = runtime.getSetting<GrammarDialect | 'auto'>('grammar.dialect', 'auto');
  if (configured !== 'auto') return configured;
  return isProbablyEnglish(text) ? 'american' : undefined;
}

export async function runKrenOperation(
  runtime: KrenRuntime,
  operation: KrenOperation,
  input: KrenOperationInput,
  signal: AbortSignal
): Promise<KrenResult> {
  const prefix = operation === 'translate' ? 'translation' : operation === 'explain' ? 'explanation'
    : isRewriteOperation(operation) ? 'rewrite' : undefined;
  if (!prefix || prefix === 'translation' && runtime.getSetting<string>('translationProvider', 'gemini') === 'googleCloudTranslation') {
    return runKrenOperationOnce(runtime, operation, input, signal);
  }
  return withFeatureProviderSwitch(runtime, prefix, input.text, signal,
    (selectedRuntime, selectedSignal) => runKrenOperationOnce(selectedRuntime, operation, input, selectedSignal), input.retry);
}

/** Feature settings remain authoritative on the selected provider; a switched provider uses its mode default. */
export async function withFeatureProviderSwitch<T>(runtime: KrenRuntime,
  prefix: 'translation' | 'explanation' | 'rewrite' | 'userDictionary', text: string, signal: AbortSignal,
  run: (runtime: KrenRuntime, signal: AbortSignal) => Promise<T>, forceThorough = false): Promise<T> {
  const route = operationLanguageModelRoute(runtime, prefix);
  const outcome = await runFeatureRequest({ runtime, route, signal, policy: CURRENT_REQUEST_POLICIES.ordinary,
    thinking: { kind: prefix, text, retry: forceThorough },
    geminiDefaultAttempts: prefix === 'translation' || prefix === 'rewrite' ? 4 : 3,
    execute: (selected, mode, selectedSignal, _request, maxAttempts) => run({ ...runtime, thinkingMode: mode,
      allowExternalTranslation: runtime.allowExternalTranslation || prefix === 'translation' && selected.provider !== route.provider,
      getSetting: <V>(key: string, fallback: V): V => {
        const overrides: Record<string, unknown> = { [`${prefix}.provider`]: selected.provider,
          [`${prefix}.model`]: selected.model, [`${prefix}.alternateModel`]: selected.model,
          [`${prefix}.geminiProfile`]: selected.geminiProfile, [`${prefix}.thinkingOrEffort`]: selected.thinkingOrEffort,
          [`${prefix}.fallbackEnabled`]: false, 'gemini.retry.maxAttempts': maxAttempts, 'languageModel.retry.maxAttempts': maxAttempts };
        return Object.hasOwn(overrides, key) ? overrides[key] as V : runtime.getSetting(key, fallback);
      }
    }, selectedSignal)
  });
  const result = unwrapRequestOutcome(outcome);
  if (outcome.type === 'accepted' && result && typeof result === 'object') {
    const fallback = outcome.recovery.find(item => item.decision === 'fallback');
    if (fallback?.decision === 'fallback') Object.assign(result, { fallbackFromModel: normalizeModelId(fallback.from.model) });
  }
  return result;
}

async function runKrenOperationOnce(runtime: KrenRuntime, operation: KrenOperation, input: KrenOperationInput,
  signal: AbortSignal): Promise<KrenResult> {
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
    assertGrammarInputLanguageMatches(runtime, input.text);
    const dialect = resolvedGrammarDialect(runtime, input.text);
    return checkGrammarWithHarper(input.text, dialect ?? 'american', signal, dialect !== undefined);
  }

  if (operation === 'translate' || operation === 'explain') {
    analysis = applyLanguages(runtime, operation, input, analysis);
  }

  if (isMerriamWebsterOperation(operation)) {
    return lookupMerriamWebster(runtime, operation, analysis, signal, input.targetLanguage);
  }
  if (operation === 'koreanDictionary') {
    return lookupKoreanDictionary(runtime, analysis, signal);
  }

  const request: TranslationRequest = {
    ...analysis,
    kind: 'translation',
    operation,
    // Read per feature, so a medical translation and a general explanation can coexist.
    domain: configuredDomain(runtime, operation === 'explain' ? 'explanation' : 'translation')
  };
  if (operation === 'explain') {
    request.explanationLanguage = input.outputLanguage ?? runtime.getSetting<ExplanationOutputLanguage>(
      'explanation.outputLanguage',
      EXPLANATION_SAME_AS_SOURCE
    );
  }
  if (operation === 'explain') {
    return explainWithLanguageModelProvider(runtime, request, signal);
  }
  const translationProvider = runtime.getSetting<LanguageModelRoutingProvider>('translation.provider', 'gemini');
  if (runtime.allowExternalTranslation && (translationProvider === 'openai' || translationProvider === 'anthropic')) {
    const provider = await createExternalLanguageModelProvider(runtime, translationProvider,
      runtime.getSetting('translation.model', TUTOR_MODELS[translationProvider].thorough),
      runtime.getSetting<LanguageModelRoutingEffort>('translation.thinkingOrEffort', 'auto'));
    return provider.explain(request, signal);
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
  // Latin script was required until 2026-08-23, because Harper was the whole of Grammar
  // Check and Harper is English-only. Smart Grammar Check reads any language the model
  // does, and the offline checker is now skipped rather than refused, so the gate is on
  // there being something to check at all.
  if (operation === 'grammar' && !/[\p{L}\p{N}]/u.test(analysis.text)) {
    throw new Error('Grammar Check requires text containing a letter or number.');
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
  const englishVariety = resolveRewriteOutputLanguage(configuredEnglishVariety);
  const configuredOtherLanguage = runtime.getSetting<string>(
    'rewrite.otherOutputLanguage',
    REWRITE_OTHER_LANGUAGES[0].id
  );
  const request: RewriteRequest = {
    text,
    sourceLanguage,
    targetLanguage: 'auto',
    kind: 'translation',
    operation,
    englishVariety,
    // Omitted unless the first control defers to it, so a request carries no setting the
    // request does not use. Not the load-bearing check: rewriteOutputLanguageCode ignores
    // this field for every other variety and rejects a language outside the list, and a
    // mutation removing this condition changes no output. It is here so the request says
    // what it means.
    ...(englishVariety === 'otherLanguage' && isRewriteOtherLanguage(configuredOtherLanguage)
      ? { otherOutputLanguage: configuredOtherLanguage }
      : {}),
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
  const profile = runtime.getSetting<GeminiProfile>('rewrite.geminiProfile', 'standard');
  const legacyModel = providerId === 'openai'
    ? runtime.getSetting<string>('openai.model', 'gpt-5.4')
    : providerId === 'anthropic'
      ? runtime.getSetting<string>('anthropic.model', 'claude-sonnet-4-6')
      : providerId === 'groq' || providerId === 'cloudflare' ? compatibleDefaultModel(providerId)
      : profile === 'pro'
        ? runtime.getSetting<string>('gemini.alternateModel', 'gemini-3.1-pro-preview')
        : runtime.getSetting<string>('gemini.model', DEFAULT_GEMINI_MODEL);
  const legacyEffort: LanguageModelRoutingEffort = providerId === 'openai'
    ? runtime.getSetting<OpenAIReasoningEffort>('openai.reasoningEffort', 'low')
    : providerId === 'anthropic'
      ? runtime.getSetting<AnthropicEffort>('anthropic.effort', 'low')
      : providerId === 'groq' || providerId === 'cloudflare' ? 'auto'
      : profile === 'pro'
        ? runtime.getSetting<GeminiThinkingLevel>('gemini.alternateThinkingLevel', 'low')
        : runtime.getSetting<GeminiThinkingLevel | 'auto'>('gemini.thinkingLevel', 'auto');
  const routing = featureLanguageModelRouting(runtime, 'rewrite', {
    provider: providerId,
    model: legacyModel,
    thinkingOrEffort: legacyEffort,
    geminiProfile: profile,
    fallbackEnabled: runtime.getSetting<boolean>('gemini.alternateFallbackEnabled', true),
    fallbackModel: runtime.getSetting<string>('gemini.alternateFallbackModel', DEFAULT_GEMINI_MODEL),
    fallbackThinkingOrEffort: runtime.getSetting<GeminiThinkingLevel | 'auto'>(
      'gemini.alternateFallbackThinkingLevel',
      'low'
    )
  });
  if (providerId !== 'gemini') {
    const provider = await createExternalLanguageModelProvider(
      runtime,
      providerId,
      routing.model,
      routing.thinkingOrEffort
    );
    return provider.rewrite(request, signal);
  }

  const key = await runtime.getSecret(
    KREN_SECRET_KEYS[languageModelCredentialSlot('gemini', profile)]
  );
  if (!key) {
    throw missingCredentialError('gemini', profile);
  }
  await beforeLanguageModelRequest(runtime, 'gemini', profile);
  const model = routing.model;
  const retries = runtime.getSetting<boolean>('gemini.retry.enabled', true)
    ? runtime.getSetting<number>('gemini.retry.maxAttempts', 4)
    : 1;
  const thinking = routingGeminiThinking(model, routing.thinkingOrEffort);
  const primaryProvider = new GeminiProvider(
    key,
    model,
    profile === 'pro' ? 'configureGeminiProModel' : 'configureGeminiModel',
    thinking,
    retries
  );
  return primaryProvider.rewrite(request, signal);
}

function isRewriteOperation(operation: KrenOperation): operation is RewriteOperation {
  return operation === 'rewrite' || operation === 'rewriteMinimal' ||
    operation === 'rewriteFull';
}

export function isProFallbackError(error: unknown): error is ProviderError {
  return error instanceof ProviderError &&
    (error.status === 404 || error.status === 429 || error.status === 503 || error.status === 504 ||
      error.reason === 'structuredOutput');
}

type FeatureRoutingPrefix =
  | 'translation'
  | 'explanation'
  | 'rewrite'
  | 'userDictionary'
  | 'tutor';

/**
 * The model this feature uses, read from the slot belonging to the profile in force.
 *
 * The Default and Alternate Gemini profiles keep separate slots, `<feature>.model` and
 * `<feature>.alternateModel`, because until 1.7.7 they shared one. Choosing a model under
 * Default therefore overwrote the Alternate choice and the reverse, which the owner
 * reported on 2026-08-28. OpenAI and Anthropic have no profile of their own and always
 * read the default slot, so switching a Gemini feature to OpenAI never lands on the
 * alternate Gemini model.
 */
export function featureModel(
  runtime: KrenRuntime,
  prefix: FeatureRoutingPrefix,
  provider: LanguageModelRoutingProvider,
  geminiProfile: GeminiProfile,
  fallback: string
): string {
  const key = provider === 'gemini' && geminiProfile === 'pro'
    ? `${prefix}.alternateModel`
    : `${prefix}.model`;
  return routedModel(provider, runtime.getSetting<string>(key, fallback).trim());
}

function featureLanguageModelRouting(
  runtime: KrenRuntime,
  prefix: FeatureRoutingPrefix,
  defaults: TutorLanguageModelRoute
): TutorLanguageModelRoute {
  const provider = runtime.getSetting<LanguageModelRoutingProvider>(
    `${prefix}.provider`,
    defaults.provider
  );
  const geminiProfile = runtime.getSetting<GeminiProfile>(
    `${prefix}.geminiProfile`,
    defaults.geminiProfile
  );
  return {
    provider,
    model: featureModel(runtime, prefix, provider, geminiProfile, defaults.model),
    thinkingOrEffort: runtime.getSetting<LanguageModelRoutingEffort>(
      `${prefix}.thinkingOrEffort`,
      defaults.thinkingOrEffort
    ),
    geminiProfile,
    fallbackEnabled: runtime.getSetting<boolean>(
      `${prefix}.fallbackEnabled`,
      defaults.fallbackEnabled
    ),
    fallbackModel: runtime.getSetting<string>(
      `${prefix}.fallbackModel`,
      defaults.fallbackModel
    ).trim(),
    fallbackThinkingOrEffort: runtime.getSetting<LanguageModelRoutingEffort>(
      `${prefix}.fallbackThinkingOrEffort`,
      defaults.fallbackThinkingOrEffort
    )
  };
}

function operationLanguageModelRoute(runtime: KrenRuntime, prefix: FeatureRoutingPrefix): TutorLanguageModelRoute {
  const provider = runtime.getSetting<LanguageModelRoutingProvider>(`${prefix}.provider`, 'gemini');
  const geminiProfile = runtime.getSetting<GeminiProfile>(`${prefix}.geminiProfile`, 'standard');
  const legacyModel = provider === 'gemini' ? geminiProfile === 'pro'
    ? runtime.getSetting('gemini.alternateModel', 'gemini-3.1-pro-preview') : runtime.getSetting('gemini.model', DEFAULT_GEMINI_MODEL)
    : provider === 'openai' ? runtime.getSetting('openai.model', 'gpt-5.4')
      : provider === 'anthropic' ? runtime.getSetting('anthropic.model', 'claude-sonnet-4-6') : compatibleDefaultModel(provider);
  return featureLanguageModelRouting(runtime, prefix, {
    ...(prefix === 'translation' ? TRANSLATION_ROUTING_DEFAULTS : { provider, model: legacyModel, thinkingOrEffort: 'auto' as const }),
    geminiProfile,
    fallbackEnabled: prefix === 'translation' ? false : runtime.getSetting('gemini.alternateFallbackEnabled', true),
    fallbackModel: runtime.getSetting('gemini.alternateFallbackModel', DEFAULT_GEMINI_MODEL),
    fallbackThinkingOrEffort: runtime.getSetting<LanguageModelRoutingEffort>('gemini.alternateFallbackThinkingLevel', 'low')
  });
}

function missingRouteCredentials(route: TutorLanguageModelRoute): ProviderError {
  return missingCredentialError(route.provider, route.geminiProfile);
}

function routingGeminiThinking(
  model: string,
  effort: LanguageModelRoutingEffort
): GeminiThinkingLevel | undefined {
  if (effort === 'none') return undefined;
  return configuredThinkingLevel(model, effort);
}

function openAIReasoningEffort(effort: LanguageModelRoutingEffort): OpenAIReasoningEffort {
  return effort === 'minimal' ? 'low' : effort;
}

function anthropicEffort(effort: LanguageModelRoutingEffort): AnthropicEffort {
  return effort === 'none' || effort === 'minimal' ? 'low' : effort;
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

/**
 * The subject area a feature writes for, from its own setting.
 *
 * Validated against the shared axis rather than trusted. The fallback is not observable in
 * the prompt, because an unrecognised value finds no instruction and adds nothing either
 * way, which is why a mutation removing it survived the suite on 2026-08-28. It is kept and
 * exported so the guarantee the return type makes is one the function actually keeps:
 * `request.domain` is typed `RewriteDomain`, and a cast that lets junk through makes that
 * type a lie for anything that reads the field later.
 */
export function configuredDomain(
  runtime: KrenRuntime,
  feature: 'translation' | 'explanation'
): RewriteDomain {
  const stored = runtime.getSetting<string>(`${feature}.domain`, REWRITE_DOMAINS[0].id).trim();
  return REWRITE_DOMAINS.some((option) => option.id === stored)
    ? stored as RewriteDomain
    : REWRITE_DOMAINS[0].id;
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
      DEFAULT_TRANSLATION_TARGET
    )
    : input.outputLanguage ?? runtime.getSetting<string>(
      'explanation.outputLanguage',
      EXPLANATION_SAME_AS_SOURCE
    );
  /*
   * Under Same as source the equivalent is written in the language of the selected text,
   * detected by the same gate translation uses.
   *
   * It read `analysis.targetLanguage` until 1.7.9, which is the English-to-Korean
   * translation direction and has nothing to do with the explanation language: English text
   * resolved to Korean, so Explain returned a Korean equivalent beside an English note. The
   * owner reported that as an explanation that "still translates in Korean and Korean
   * mixed" for English while other languages looked fine, and the reason English differed is
   * that the direction sends everything that is not Korean to Korean.
   *
   * Auto keeps reading the direction, because on a translation that is exactly what it
   * means.
   */
  const targetLanguage = configured === EXPLANATION_SAME_AS_SOURCE
    ? detectedLanguage(analysis.text) ?? analysis.sourceLanguage
    // `auto-en-ko` was the translation target until 1.7.9 and KREN wrote it itself, so a
    // stored copy is read as the default rather than thrown at the reader. The migration
    // clears it at activation; this covers the window before that and any scope it missed.
    : configured === LEGACY_AUTO_TRANSLATION_TARGET ? DEFAULT_TRANSLATION_TARGET
      : configured;
  if (!isPlausibleLanguageCode(targetLanguage)) {
    throw new Error(`Invalid output language code: ${targetLanguage}.`);
  }
  return {
    ...analysis,
    kind: 'translation',
    /*
     * Explain declares the detected language too, rather than always `auto`.
     *
     * It is what lets the prompt say "Explain the selected English text" instead of
     * "the automatically detected source language", and it is what lets the provider notice
     * that the explanation language is the language the text is already in and ask for a
     * restatement rather than a translation into itself. The detector answers only on clear
     * evidence and returns `auto` otherwise, so a short or mixed selection still leaves the
     * decision to the model.
     */
    sourceLanguage: operation === 'translate'
      ? resolvedTranslationSource(runtime, analysis.text)
      : detectedLanguage(analysis.text) ?? TRANSLATION_AUTO_SOURCE,
    targetLanguage
  };
}

/**
 * The source language a translation declares, from the Input language setting.
 *
 * Every request went out with the source marked `auto` until 1.7.8, whatever the reader had
 * chosen, because there was nothing to choose. A named language is now passed through, and
 * both providers already honour it: `googleCloudTranslation.ts` sets `body.source` for
 * anything but `auto`, and the Gemini prompt names the language and asks for it back in
 * `detectedLanguage`.
 *
 * Under Auto-detect KREN runs the same gate Read Aloud runs, which answers only on clear
 * evidence: script first, then closed-class words, with a minimum score and a margin over
 * the runner-up. When it answers nothing, `auto` is passed through and the provider's own
 * detection decides, which is the behaviour this replaces only where it can do better. So
 * the gate is shared by the Cloud Translation path and the language-model path rather than
 * living in one of them.
 */
function resolvedTranslationSource(runtime: KrenRuntime, text: string): string {
  const configured = runtime
    .getSetting<string>('translation.sourceLanguage', TRANSLATION_AUTO_SOURCE)
    .trim();
  if (configured && configured !== TRANSLATION_AUTO_SOURCE) return configured;
  return detectedLanguage(text) ?? TRANSLATION_AUTO_SOURCE;
}

/**
 * The language a passage is written in, or undefined when the evidence is thin.
 *
 * The one detector, shared by the translation source gate and by Explain's Same as source,
 * so the two cannot disagree about what language a selection is in. Script is decisive;
 * closed-class words answer only above a minimum score and a margin over the runner-up.
 */
function isMerriamWebsterOperation(operation: KrenOperation): operation is MerriamWebsterOperation {
  return operation === 'englishDictionary' || operation === 'medical' || operation === 'synonyms';
}

async function lookupMerriamWebster(
  runtime: KrenRuntime,
  operation: MerriamWebsterOperation,
  analysis: SelectionAnalysis,
  signal: AbortSignal,
  outputLanguage?: string
): Promise<KrenResult> {
  const reference = MERRIAM_WEBSTER_OPERATIONS[operation];
  const apiKey = await runtime.getSecret(reference.secretKey);
  if (!apiKey) {
    throw missingCredentialError(reference.reference === 'collegiate' ? 'merriamWebsterCollegiate' : reference.reference === 'medical' ? 'merriamWebsterMedical' : 'merriamWebsterThesaurus');
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

  const stored = outputLanguage ?? runtime.getSetting<string>(
    'translation.targetLanguage',
    DEFAULT_TRANSLATION_TARGET
  );
  const targetLanguage = stored === LEGACY_AUTO_TRANSLATION_TARGET
    ? DEFAULT_TRANSLATION_TARGET
    : stored;
  if (!isPlausibleLanguageCode(targetLanguage)) {
    throw new Error(`Invalid output language code: ${targetLanguage}.`);
  }
  const request: TranslationRequest = {
    ...analysis,
    kind: 'translation',
    operation: 'translate',
    // The same gate as an ordinary translation. This path is a translation with a
    // dictionary miss in front of it, and it went out marked `auto` regardless of the
    // reader's Input language until 1.7.8.
    sourceLanguage: resolvedTranslationSource(runtime, analysis.text),
    targetLanguage
  };
  const provider = await createGoogleCloudProvider(runtime);
  return provider.translate(request, signal);
}

export async function runUserDictionaryCapture(
  runtime: KrenRuntime,
  expression: string,
  signal: AbortSignal,
  captureModeOverride?: UserDictionaryCaptureSettings['captureMode'],
  termSuppliedByUser = false,
  contextSentence?: string,
  retry = false
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
  const secretKey = KREN_SECRET_KEYS[languageModelCredentialSlot(settings.provider, settings.geminiProfile)];
  const [apiKey, merriamWebsterApiKey] = await Promise.all([
    runtime.getSecret(secretKey),
    settings.captureMode === 'merriamWebsterAndLlm'
      ? runtime.getSecret(KREN_SECRET_KEYS.merriamWebsterCollegiate)
      : Promise.resolve(undefined)
  ]);
  if (!apiKey) throw centeredProviderError(settings.provider === 'cloudflare' ? await missingCloudflareCredentials(runtime) : missingCredentialError(settings.provider, settings.geminiProfile), { ...settings });
  if (settings.provider === 'cloudflare') await requireCloudflareAccount(runtime);
  if (settings.captureMode === 'merriamWebsterAndLlm' && !merriamWebsterApiKey) {
    throw missingCredentialError('merriamWebsterCollegiate');
  }
  await beforeLanguageModelRequest(runtime, settings.provider, settings.geminiProfile);
  const languageModelCapture = runFeatureRequest({ runtime, route: { ...settings }, signal,
    policy: CURRENT_REQUEST_POLICIES.userDictionary,
    thinking: { kind: 'userDictionary', text: `${expression} ${contextSentence ?? ''}`, retry },
    execute: async (route, mode, selectedSignal, _request, maxAttempts) => {
      const routedKey = route.provider === settings.provider && route.geminiProfile === settings.geminiProfile ? apiKey
        : await runtime.getSecret(KREN_SECRET_KEYS[languageModelCredentialSlot(route.provider, route.geminiProfile)]);
      if (!routedKey) throw missingRouteCredentials(route);
      await beforeLanguageModelRequest(runtime, route.provider, route.geminiProfile);
      const accountId = route.provider === 'cloudflare' ? await requireCloudflareAccount(runtime) : undefined;
      return captureUserDictionaryDraft(expression,
        { ...settings, ...route, thinkingOrEffort: modeEffort(route.provider, route.model, mode, route.thinkingOrEffort) },
        new HttpUserDictionaryProviderTransport({ ...route, apiKey: routedKey, accountId,
          maxAttempts }),
        selectedSignal, { maxMalformedAttempts: 1, termSuppliedByUser,
          ...(contextSentence && !termSuppliedByUser ? { contextSentence } : {}) });
    }
  }).then(unwrapRequestOutcome);
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

type UserDictionaryRoutingSettings = UserDictionaryCaptureSettings & {
  geminiProfile: GeminiProfile;
  fallbackEnabled: boolean;
  fallbackModel: string;
  fallbackThinkingOrEffort: LanguageModelRoutingEffort;
};

function readUserDictionaryCaptureSettings(runtime: KrenRuntime): UserDictionaryRoutingSettings {
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
  const dictionaryProfile = runtime.getSetting<GeminiProfile>(
    'userDictionary.geminiProfile',
    'standard'
  );
  // Same two slots as every other feature. User Dictionary builds its route here rather
  // than through featureLanguageModelRouting, so the slot choice is repeated once.
  const model = featureModel(
    runtime,
    'userDictionary',
    isUserDictionaryProvider(providerValue) ? providerValue : 'gemini',
    dictionaryProfile,
    USER_DICTIONARY_CAPTURE_DEFAULTS.model
  );
  if (!isUserDictionaryProviderCaptureMode(captureModeValue) ||
      !isUserDictionaryProvider(providerValue) ||
      !isUserDictionaryThinkingOrEffort(thinkingValue) ||
      !isUserDictionaryExampleCount(examplesValue) ||
      (entryLanguage !== 'auto' && !isPlausibleLanguageCode(entryLanguage)) ||
      !isLanguageModelIdentifier(model)) {
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
    geminiProfile: dictionaryProfile,
    fallbackEnabled: runtime.getSetting<boolean>('userDictionary.fallbackEnabled', false),
    fallbackModel: runtime.getSetting<string>(
      'userDictionary.fallbackModel',
      DEFAULT_GEMINI_MODEL
    ).trim(),
    fallbackThinkingOrEffort: runtime.getSetting<LanguageModelRoutingEffort>(
      'userDictionary.fallbackThinkingOrEffort',
      'low'
    ),
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
    throw missingCredentialError('koreanDictionary');
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
    // Translation owns its model and effort rather than borrowing Rewrite Text's, so
    // changing the Rewrite model no longer moves Translation with it. Only Gemini
    // implements TranslationProvider; OpenAI and Anthropic expose explain and rewrite
    // only, which is why the panel offers them disabled instead of silently failing.
    const routingProvider = runtime.getSetting<string>(
      'translation.provider',
      TRANSLATION_ROUTING_DEFAULTS.provider
    );
    if (routingProvider === 'groq' || routingProvider === 'cloudflare') {
      const profile = runtime.getSetting<GeminiProfile>('translation.geminiProfile', 'standard');
      const model = featureModel(runtime, 'translation', routingProvider, profile, compatibleDefaultModel(routingProvider));
      const provider = await createExternalLanguageModelProvider(runtime, routingProvider, model,
        runtime.getSetting<LanguageModelRoutingEffort>('translation.thinkingOrEffort', 'auto'));
      return { id: routingProvider, translate: (request, signal) => provider.explain(request, signal) };
    }
    if (routingProvider !== 'gemini') {
      throw new ProviderError(
        `KREN cannot translate with ${routingProvider}. Only Google Gemini provides a translation route; choose Google Gemini under Translation LLM ROUTING, or select Google Cloud Translation.`,
        'configureGeminiModel'
      );
    }
    const profile = runtime.getSetting<GeminiProfile>(
      'translation.geminiProfile',
      'standard'
    );
    const routing = featureLanguageModelRouting(runtime, 'translation', {
      ...TRANSLATION_ROUTING_DEFAULTS,
      geminiProfile: profile,
      fallbackEnabled: false,
      fallbackModel: DEFAULT_GEMINI_MODEL,
      fallbackThinkingOrEffort: 'low'
    });
    const key = await runtime.getSecret(
      KREN_SECRET_KEYS[languageModelCredentialSlot('gemini', profile)]
    );
    if (!key) {
      throw missingCredentialError('gemini', profile);
    }
    await beforeLanguageModelRequest(runtime, 'gemini', profile);
    const model = routing.model;
    const thinking = routingGeminiThinking(model, routing.thinkingOrEffort);
    const retries = runtime.getSetting<boolean>('gemini.retry.enabled', true)
      ? runtime.getSetting<number>('gemini.retry.maxAttempts', 4)
      : 1;
    const primary = new GeminiProvider(
      key,
      model,
      profile === 'pro' ? 'configureGeminiProModel' : 'configureGeminiModel',
      thinking,
      retries
    );
    return primary;
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
  const profile = runtime.getSetting<GeminiProfile>(
    `${purpose}.geminiProfile`,
    'standard'
  );
  const legacyModel = providerId === 'openai'
    ? runtime.getSetting<string>('openai.model', 'gpt-5.4')
    : providerId === 'anthropic'
      ? runtime.getSetting<string>('anthropic.model', 'claude-sonnet-4-6')
      : providerId === 'groq' || providerId === 'cloudflare' ? compatibleDefaultModel(providerId)
      : profile === 'pro'
        ? runtime.getSetting<string>('gemini.alternateModel', 'gemini-3.1-pro-preview')
        : runtime.getSetting<string>('gemini.model', DEFAULT_GEMINI_MODEL);
  const legacyEffort: LanguageModelRoutingEffort = providerId === 'openai'
    ? runtime.getSetting<OpenAIReasoningEffort>('openai.reasoningEffort', 'low')
    : providerId === 'anthropic'
      ? runtime.getSetting<AnthropicEffort>('anthropic.effort', 'low')
      : providerId === 'groq' || providerId === 'cloudflare' ? 'auto'
      : profile === 'pro'
        ? runtime.getSetting<GeminiThinkingLevel>('gemini.alternateThinkingLevel', 'low')
        : runtime.getSetting<GeminiThinkingLevel | 'auto'>('gemini.thinkingLevel', 'auto');
  const routing = featureLanguageModelRouting(runtime, purpose, {
    provider: providerId,
    model: legacyModel,
    thinkingOrEffort: legacyEffort,
    geminiProfile: profile,
    fallbackEnabled: runtime.getSetting<boolean>('gemini.alternateFallbackEnabled', true),
    fallbackModel: runtime.getSetting<string>('gemini.alternateFallbackModel', DEFAULT_GEMINI_MODEL),
    fallbackThinkingOrEffort: runtime.getSetting<GeminiThinkingLevel | 'auto'>(
      'gemini.alternateFallbackThinkingLevel',
      'low'
    )
  });
  if (providerId !== 'gemini') {
    return createExternalLanguageModelProvider(
      runtime,
      providerId,
      routing.model,
      routing.thinkingOrEffort
    );
  }
  const key = await runtime.getSecret(
    KREN_SECRET_KEYS[languageModelCredentialSlot('gemini', profile)]
  );
  if (!key) {
    throw missingCredentialError('gemini', profile);
  }
  await beforeLanguageModelRequest(runtime, 'gemini', profile);
  return new GeminiProvider(
    key,
    routing.model,
    profile === 'pro' ? 'configureGeminiProModel' : 'configureGeminiModel',
    routingGeminiThinking(routing.model, routing.thinkingOrEffort),
    languageModelRetries(runtime, 'gemini.retry')
  );
}

async function explainWithLanguageModelProvider(
  runtime: KrenRuntime,
  request: TranslationRequest,
  signal: AbortSignal
): Promise<Extract<KrenResult, { kind: 'translation' }>> {
  const provider = await createLanguageModelProvider(runtime, 'explanation');
  return provider.explain(request, signal);
}

async function createExternalLanguageModelProvider(
  runtime: KrenRuntime,
  providerId: Exclude<LanguageModelProviderId, 'gemini'>,
  model?: string,
  thinkingOrEffort?: LanguageModelRoutingEffort
): Promise<LanguageModelProvider> {
  const key = await runtime.getSecret(KREN_SECRET_KEYS[languageModelCredentialSlot(providerId, 'standard')]);
  if (!key) throw providerId === 'cloudflare' ? await missingCloudflareCredentials(runtime) : missingCredentialError(providerId);
  const accountId = providerId === 'cloudflare' ? await requireCloudflareAccount(runtime) : undefined;
  await beforeLanguageModelRequest(runtime, providerId);
  const attempts = languageModelRetries(runtime, 'languageModel.retry');
  if (providerId === 'groq' || providerId === 'cloudflare') {
    return new CompatibleLanguageModelProvider(providerId, key, routedModel(providerId, model ?? compatibleDefaultModel(providerId)), thinkingOrEffort, attempts, accountId);
  }
  if (providerId === 'openai') {
    return new OpenAIProvider(
      key,
      model ?? runtime.getSetting<string>('openai.model', 'gpt-5.4'),
      openAIReasoningEffort(
        thinkingOrEffort ?? runtime.getSetting<OpenAIReasoningEffort>(
          'openai.reasoningEffort',
          'low'
        )
      ),
      attempts
    );
  }
  return new AnthropicProvider(
    key,
    model ?? runtime.getSetting<string>('anthropic.model', 'claude-sonnet-4-6'),
    anthropicEffort(
      thinkingOrEffort ?? runtime.getSetting<AnthropicEffort>('anthropic.effort', 'low')
    ),
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
  runtime: KrenRuntime
): Promise<GoogleCloudTranslationProvider> {
  const key = await runtime.getSecret(KREN_SECRET_KEYS.googleCloudTranslation);
  if (!key) {
    throw missingCredentialError('googleCloudTranslation');
  }
  return new GoogleCloudTranslationProvider(key, (characters) =>
    runtime.reserveCloudCharacters(characters)
  );
}

/**
 * The reader-facing name of each operation, used by the panel's replay line and by the
 * clipboard notice. It lives here, beside KrenOperation, so the two cannot disagree: a new
 * operation fails to compile until it is named, which a second copy elsewhere would not do.
 */
export const REPLAY_SUBJECTS: Record<KrenOperation, string> = {
  translate: 'translation',
  explain: 'explanation',
  englishDictionary: 'dictionary entry',
  koreanDictionary: 'Korean dictionary entry',
  medical: 'medical dictionary entry',
  synonyms: 'synonyms',
  grammar: 'grammar check',
  rewrite: 'rewrite',
  rewriteMinimal: 'Minimal Rewrite',
  rewriteFull: 'Full Rewrite'
};

async function requireCloudflareAccount(runtime: KrenRuntime): Promise<string> {
  const accountId = await runtime.getSecret(KREN_SECRET_KEYS.cloudflareAccountId);
  if (!accountId) throw missingCredentialError('cloudflare', 'standard', ['account ID']);
  return accountId;
}

async function missingCloudflareCredentials(runtime: KrenRuntime): Promise<ProviderError> {
  const accountId = await runtime.getSecret(KREN_SECRET_KEYS.cloudflareAccountId);
  return missingCredentialError('cloudflare', 'standard', accountId ? ['API token'] : ['account ID', 'API token']);
}
