import { missingCredentialDetails, missingCredentialMessage, missingCredentialSelectionMessage, otherGeminiProfileMessage, type CredentialProvider } from './requestCenter.js';
import { CREDENTIAL_HELP, type CredentialHelpId } from './credentialHelp.js';
import type { EnvironmentItem, UpdateFixTarget } from './environmentCheck.js';
import { panelNoticeScript, panelPopupCardClass, panelScriptErrorScript, type PanelNotice } from './panelNotices.js';
import { GROQ_RETIRED_MODELS } from './tutor/models.js';
import { READ_ALOUD_CHIRP_VOICES, normalizedReadAloudChirpVoice } from './readAloudChirp.js';
import type { LanguageModelUsage } from './languageModelUsage.js';
import { GLOBAL_ROUTING_DEFAULTS } from './panelSettings.js';
import { DEFAULT_PROVIDER_ORDER, isQuotaPoolExhaustedToday, validProviderOrder } from './languageModelSwitching.js';
import { tutorDemoAvailable } from './tutor/demoAvailability.js';
import { tutorFastModel } from './tutor/thinkingMode.js';
import { GROQ_MODELS, CLOUDFLARE_TEXT_MODELS, routedModel } from './providers/openAICompatible.js';
import { tutorLessonConversationReadiness, tutorPracticeBelongsToLesson, TUTOR_LESSON_UNAVAILABLE, tutorLiveTargetMarks, tutorTargetRanges, tutorMarkedSegments, type TutorTargetMark } from './tutor/lessonConversation.js';
import { TUTOR_DEFAULTS } from './tutor/defaults.js';
import { tutorLearnerTurnNotShown } from './tutor/learnerLanguage.js';
import { TUTOR_SITUATIONS, tutorSituationGroups, findTutorSituation, tutorCustomSituation } from '@kren/core/tutor';
import { languageName } from './languages.js';
import { resolveTutorSpeechRoute, tutorConversationReply, tutorConversationReviewProgress, tutorConversationHandoffNote, type TutorPracticeReview } from './tutor/state.js';
import type {
  LanguageModelRoutingEffort,
  LanguageModelRoutingProvider
} from './languageModelRouting.js';
import { tutorExcerptShowsPattern } from './tutor/state.js';
import {
  isLanguageModelRoutingProvider,
  languageModelRoutingEffortLabel,
  languageModelCredentialSlot,
  languageModelRoutingEffortOptions,
  languageModelRoutingProviderLabel,
  languageModelRoutingProviderOptions
} from './languageModelRouting.js';
import type { KrenPanelCommand } from './panelCommands.js';
import { isEnglishLanguageCode } from '@kren/core/languages';
import { iconSvgMarkup, type IconName } from '@kren/core/icons';
import { PANEL_THEME_CSS, effectivePanelTheme, type PanelTheme, type PanelThemeKind } from './panelThemes.js';
import {
  applyGrammarChoices as coreApplyGrammarChoices,
  preselectedGrammarChoices as corePreselectedGrammarChoices
} from '@kren/core/grammar';
import { isAllowedPronunciationUrl } from './pronunciation.js';
import { PANEL_TEXT_MAX_LENGTH } from './grammarIssueId.js';
import {
  KNOWN_TUTOR_LIVE_MODEL_IDS,
  CLOUDFLARE_IMAGE_MODEL_DEFAULT,
  CLOUDFLARE_IMAGE_MODELS,
  TUTOR_LIVE_MODEL_DEFAULT
} from './panelSettings.js';
import { MERRIAM_WEBSTER_KEY_LIMIT, MERRIAM_WEBSTER_KEY_LIMIT_MESSAGE } from './operations.js';
import {
  ALL_REWRITE_VARIANTS_ID,
  REWRITE_VARIANT_LIST,
  type QuickMenuRewriteVariantId,
  type RewriteVariantListId
} from './rewriteVariants.js';
import {
  isKnownGeminiLiveOnlyModel,
  type GeminiModelOption
} from './providers/geminiModels.js';
import type {
  DictionaryResult,
  DictionarySection,
  GrammarIssue,
  GrammarResult,
  KrenResult,
  RewriteResult,
  ThesaurusResult,
  ThesaurusWord
} from './types.js';
import {
  REWRITE_DOMAINS,
  REWRITE_ENGLISH_VARIETIES,
  REWRITE_OTHER_LANGUAGES,
  rewriteOtherLanguageLabel,
  REWRITE_FORMALITIES,
  REWRITE_FUNCTIONS,
  REWRITE_LENGTHS,
  REWRITE_MODALITIES,
  REWRITE_PERSPECTIVES,
  REWRITE_RHETORICAL_MODES,
  REWRITE_AXIS_SETTINGS,
  REWRITE_STANCES,
  REWRITE_VOICES,
  rewriteAxisLabel,
  rewriteAxisOptions,
  type RewriteDomain,
  type RewriteEnglishVarietySetting,
  type RewriteFormality,
  type RewriteFunction,
  type RewriteLength,
  type RewriteModality,
  type RewritePerspective,
  type RewriteRhetoricalMode,
  type RewriteStance,
  type RewriteVoice
} from '@kren/core/rewrite-axes';
import {
  TUTOR_ANNOTATION_LEVELS,
  TUTOR_EXPLANATION_DEPTHS,
  TUTOR_LEARNER_LEVELS,
  TUTOR_LESSON_MODES,
  TUTOR_MAP,
  assessTutorCompatibility,
  findTrainingMapNode,
  isTrainingReviewCorrectionCategory,
  type ResolvedTrainingTarget,
  type TrainingMapNode,
  type TrainingReview,
  type TrainingReviewCorrection,
  type TutorFinding
} from '@kren/core/tutor';
import {
  CUSTOM_REWRITE_MODE_LABEL,
  matchingRewriteMode,
  rewriteModeOptions,
  type RewriteModeAxes,
  type RewriteModeId
} from '@kren/core/rewrite-modes';
import { userDictionarySourceLine } from './userDictionary/providerContract.js';
import {
  EDGE_SPEECH_AUTO_LOCALE,
  EDGE_SPEECH_LOCALES
} from '@kren/core/edge-speech';
import type { UserDictionaryEntryV1 } from './userDictionary/providerContract.js';
import type { UserDictionaryCaptureResult } from './userDictionary/capture.js';
import type { UserDictionaryImportPreview } from './userDictionary/providerContract.js';
import type { UserDictionaryPurgePreview } from './userDictionary/providerContract.js';
import {
  userDictionaryCaptureFilterOptions,
  userDictionaryCaptureModeOptions,
  userDictionaryExampleCountOptions,
  type UserDictionaryExampleCount,
  type UserDictionaryThinkingOrEffort
} from './userDictionary/settings.js';
import {
  filterUserDictionaryEntries,
  userDictionaryFilterValues,
  userDictionarySourceFilterOptions,
  type UserDictionaryListQuery,
  type UserDictionaryViewStatus
} from './userDictionary/providerContract.js';
import { userDictionaryPurgeSelectionOptions } from './userDictionary/providerContract.js';
import {
  TUTOR_SENTENCE_BANDS,
  createTutorViewState,
  deepestTutorMapNode,
  tutorMapPathForNode,
  tutorFindingMessage,
  tutorPracticeResults,
  tutorPracticeReviewEligibility,
  tutorPracticeReviewBusy,
  tutorVisibleExercises,
  tutorQuestionOnlySelection,
  tutorPreparedPrompt,
  tutorSelectionReadiness,
  tutorSentenceBand,
  tutorResetBusy,
  tutorLessonResetBusy,
  tutorAllExamplesViewed,
  tutorHasLessonInput,
  tutorTargetActionReason,
  tutorTargetPathLabel,
  type TutorSpeechProvider,
  type TutorAskAnswer,
  type TutorAskBusyKind,
  type TutorMapLevel,
  type TutorViewState,
  TUTOR_LIVE_VOICES,
  normalizedTutorLiveVoice
} from './tutor/state.js';
import { EXPLANATION_SAME_AS_SOURCE, TRANSLATION_AUTO_SOURCE } from './types.js';
import { isSameLanguage } from './languages.js';
import { isTutorPauseBeforeReply, isTutorSpeechDetection, type TutorSpeechDetection, type TutorMicrophoneSensitivity, type TutorPauseBeforeReply } from './tutorMicrophoneGate.js';

/** The heading on all six routing groups. One string, so they cannot drift apart. */
export const LLM_ROUTING_LABEL = 'LLM ROUTING';

const TUTOR_EDGE_SPEECH_LOCALES = EDGE_SPEECH_LOCALES.filter(
  (locale) => locale.id.startsWith('en-')
);

export const LLM_ROUTING_CONTROL_TITLES = {
  provider: 'Provider',
  geminiProfile: 'Gemini profile',
  model: 'Model',
  thinkingOrEffort: 'Thinking level',
  fallbackEnabled: 'Automatic fallback',
  fallbackModel: 'Fallback model',
  fallbackThinkingOrEffort: 'Fallback model thinking level'
} as const;

const TUTOR_LLM_ROUTING_CONTROL_TITLES = {
  ...LLM_ROUTING_CONTROL_TITLES, geminiProfile: 'Gemini Profile', model: 'Thorough model',
  thinkingOrEffort: 'Thinking Level', fallbackEnabled: 'Use Fast when Thorough is unavailable'
};

export type GeminiRoutingProfile = 'standard' | 'pro';

export interface LanguageModelRoutingPanelSettings {
  provider: LanguageModelRoutingProvider;
  model: string;
  /**
   * The model used while the Gemini profile is Alternate, stored in its own setting.
   *
   * Until 1.7.7 both profiles read one `<feature>.model` slot, so choosing a model under
   * Default overwrote the Alternate choice and the reverse, and the Refresh button beside
   * that one control always queried the alternate key whichever profile was showing. The
   * owner reported both on 2026-08-28 as separate faults; they are one.
   */
  alternateModel: string;
  thinkingOrEffort: LanguageModelRoutingEffort;
  geminiProfile: GeminiRoutingProfile;
  fallbackEnabled: boolean;
  fallbackModel: string;
  fallbackThinkingOrEffort: LanguageModelRoutingEffort;
}

export const REWRITE_SETTINGS_GROUPS = [
  'routing',
  'channel',
  'subject',
  'register',
  'shape',
  'intent',
  'variants',
  'output'
] as const;

export type RewriteSettingsGroup = typeof REWRITE_SETTINGS_GROUPS[number];

export function isRewriteSettingsGroup(value: unknown): value is RewriteSettingsGroup {
  return typeof value === 'string' &&
    REWRITE_SETTINGS_GROUPS.some((group) => group === value);
}

export interface ResultViewHtmlOptions {
  /** Initial disclosure for static previews; ordinary panel renders start closed. */
  credentialHelpOpen?: CredentialHelpId;
  cspSource: string;
  nonce: string;
  brandImageUri?: string;
  googleAttributionImageUri?: string;
  merriamWebsterLogoUris?: { light: string; dark: string };
  result?: KrenResult;
  sourceText?: string;
  allowReplace?: boolean;
  autoplayAudio?: { url: string; headword: string };
  settings: KrenPanelSettings;
  themeKind?: PanelThemeKind;
  activeScreen?: 'result' | 'start' | 'settings' | 'credentials' | 'manual' | 'userDictionary' | 'tutor' | 'updates';
  environmentItems?: EnvironmentItem[];
  environmentBusy?: boolean;
  systemUpdatesAvailable?: boolean;
  userDictionary?: UserDictionaryViewState;
  tutor?: TutorViewState;
  proModels: GeminiModelOption[];
  liveModels?: GeminiModelOption[];
  openAIModels?: GeminiModelOption[];
  anthropicModels?: GeminiModelOption[];
  inferredRewriteModality?: RewriteModality;
  activeRewriteSettingsGroup?: RewriteSettingsGroup;
  rewriteReplay?: RewriteReplayState;
  grammarChoices?: ReadonlyArray<{ issueId: string; suggestionIndex: number }>;
  busyNotice?: string;
  busyCancelId?: number;
  panelNotices?: PanelNotice[];
  focusSettingsSection?: string;
  focusTutorTargetId?: string;
  tutorAnnouncement?: string;
  tutorResetDisclosures?: boolean;
  tutorResetAllDisclosures?: boolean;
  tutorResetDisclosure?: { id: string; all: boolean };
  focusTutorResult?: 'lesson' | 'exercises';
  focusTutorConversation?: boolean;
  tutorSpeechProvider?: TutorSpeechProvider;
  tutorLiveReplayAvailable?: boolean;
  tutorLiveFailed?: boolean;
  tutorConversationReplayAvailable?: boolean;
  tutorLiveTalkAvailable?: boolean;
  tutorLiveTalkListening?: boolean;
  tutorLivePressToTalk?: boolean;
  tutorConversationStopDisabled?: boolean;
  tutorConversationStopTitle?: string;
  tutorScrollToStoppedActions?: boolean;
  tutorStandardQuietPeriodMs?: number;
  tutorConversationHintTurnGeneration?: number;
  /** Session-only stage direction returned beside the opening, never a transcript turn. */
  tutorConversationScene?: string;
  tutorConversationPicture?: string;
  tutorConversationPictures?: string[];
  tutorConversationPictureTurns?: number[];
  tutorConversationPictureCommittedTurn?: number;
  tutorConversationPicturePending?: { requestId: number; image: string; turn?: number };
}

/**
 * The state of the Settings apply bar, which exists only for a result you arrived from.
 *
 * `armed` is true when the reader reached Settings from the gear on a rewrite result, so
 * there is a result to produce again. `changed` is true when a setting has actually moved
 * since then. Both are required, at the owner's request on 2026-08-21: a button that
 * repeats identical work and a button with nothing to repeat are the same useless control
 * for different reasons.
 */
/**
 * The whole checked passage with the selected corrections in it, ready to edit.
 *
 * The panel used to offer Apply and Copy over a set of radio buttons with no way to see
 * what the result would be, which is not how the Word task pane works and not what the
 * owner wanted here. `text` is the corrected passage. `error` is set instead when the
 * selected corrections overlap, which `applyGrammarChoices` refuses rather than guessing.
 */
export interface GrammarDraftState {
  text?: string;
  error?: string;
}

export interface RewriteReplayState {
  armed: boolean;
  changed: boolean;
  running: boolean;
  subject: string;
}

export interface KrenPanelSettings {
  globalRouting?: LanguageModelRoutingPanelSettings;
  llmProviderSwitch?: boolean;
  llmProviderOrder?: LanguageModelRoutingProvider[];
  languageModelUsageToday?: readonly LanguageModelUsage[];
  userDictionaryEnabled: boolean;
  userDictionaryCaptureMode: 'llmOnly' | 'merriamWebsterAndLlm';
  userDictionaryFallbackOnMerriamWebsterNoMatch: boolean;
  userDictionaryProvider: LanguageModelRoutingProvider;
  userDictionaryModel: string;
  userDictionaryAlternateModel: string;
  userDictionaryThinkingOrEffort: UserDictionaryThinkingOrEffort;
  userDictionaryEntryLanguage: string;
  userDictionaryIncludePronunciation: boolean;
  userDictionaryIncludeSynonyms: boolean;
  userDictionaryIncludeUsageNotes: boolean;
  userDictionaryNumberOfExamples: UserDictionaryExampleCount;
  userDictionaryIncludeTechnicalMeanings: boolean;
  userDictionarySmartWordCapture: boolean;
  rewriteOtherOutputLanguage: string;
  userDictionaryStoragePath?: string;
  displayMode: string;
  panelTheme?: PanelTheme;
  requestTimeoutMs: number;
  translationMaxCharacters: number;
  userDictionaryMaxImportEntries: number;
  userDictionaryEntryCount?: number;
  openResultsAtStartup: boolean;
  translationProvider: 'googleCloudTranslation' | 'gemini';
  translationSourceLanguage: string;
  translationDomain: RewriteDomain;
  translationTargetLanguage: string;
  translationRoutingProvider: LanguageModelRoutingProvider;
  translationModel: string;
  translationAlternateModel: string;
  translationThinkingOrEffort: LanguageModelRoutingEffort;
  translationProfile: GeminiRoutingProfile;
  translationFallbackEnabled: boolean;
  translationFallbackModel: string;
  translationFallbackThinkingOrEffort: LanguageModelRoutingEffort;
  grammarDialect: 'auto' | 'american' | 'british' | 'australian' | 'canadian' | 'indian';
  grammarSmart: boolean;
  grammarAutoCheck: boolean;
  grammarAutoCheckDelayMs: number;
  grammarCustomWordCount: number;
  grammarIgnoredFindingCount: number;
  explanationOutputLanguage: string;
  explanationDomain: RewriteDomain;
  explanationProvider: LanguageModelRoutingProvider;
  explanationModel: string;
  explanationAlternateModel: string;
  explanationThinkingOrEffort: LanguageModelRoutingEffort;
  explanationProfile: GeminiRoutingProfile;
  explanationFallbackEnabled: boolean;
  explanationFallbackModel: string;
  explanationFallbackThinkingOrEffort: LanguageModelRoutingEffort;
  rewriteProvider: LanguageModelRoutingProvider;
  rewriteModel: string;
  rewriteAlternateModel: string;
  rewriteThinkingOrEffort: LanguageModelRoutingEffort;
  rewriteSourceLanguage: string;
  rewriteModality: RewriteModality;
  rewriteFunction: RewriteFunction;
  rewriteEnglishVariety: RewriteEnglishVarietySetting;
  geminiModel: string;
  geminiThinkingLevel: 'auto' | 'minimal' | 'low' | 'medium' | 'high';
  openAIModel: string;
  openAIReasoningEffort: 'auto' | 'none' | 'low' | 'medium' | 'high';
  groqModels?: GeminiModelOption[];
  customGroqModels?: string[];
  customCloudflareModels?: string[];
  anthropicModel: string;
  anthropicEffort: 'auto' | 'low' | 'medium' | 'high';
  customGeminiModels?: string[];
  customTutorLiveModels?: string[];
  customOpenAIModels?: string[];
  customAnthropicModels?: string[];
  rewriteProfile: GeminiRoutingProfile;
  rewriteFallbackEnabled: boolean;
  rewriteFallbackModel: string;
  rewriteFallbackThinkingOrEffort: LanguageModelRoutingEffort;
  alternateModel: string;
  alternateThinkingLevel: 'low' | 'medium' | 'high';
  alternateFallbackEnabled: boolean;
  alternateFallbackModel: string;
  alternateFallbackThinkingLevel: 'auto' | 'minimal' | 'low' | 'medium' | 'high';
  userDictionaryProfile: GeminiRoutingProfile;
  userDictionaryFallbackEnabled: boolean;
  userDictionaryFallbackModel: string;
  userDictionaryFallbackThinkingOrEffort: LanguageModelRoutingEffort;
  tutorProvider: LanguageModelRoutingProvider;
  tutorModel: string;
  tutorPictureProvider?: 'gemini' | 'cloudflare';
  tutorPictureProviderAutomatic?: boolean;
  tutorCloudflareImageModel?: string;
  tutorImageModel?: string;
  tutorImageModels?: GeminiModelOption[];
  customTutorImageModels?: string[];
  tutorHintModel?: string;
  tutorHintThinkingOrEffort?: LanguageModelRoutingEffort;
  tutorLiveModel?: string;
  tutorLiveProfile?: GeminiRoutingProfile;
  tutorConversationLiveTranscriptionLanguage?: 'english' | 'automatic';
  tutorConversationMicrophoneSensitivity?: TutorMicrophoneSensitivity;
  tutorConversationPauseBeforeReply?: TutorPauseBeforeReply;
  tutorConversationSpeechDetection?: TutorSpeechDetection;
  tutorConversationMicrophoneCloseWait?: number;
  tutorConversationPressToTalk?: boolean;
  tutorConversationPictureStyle?: 'realistic' | 'illustrated';
  tutorConversationTakeHome?: boolean;
  tutorConversationHintPrefetch?: boolean;
  tutorAlternateModel: string;
  tutorThinkingOrEffort: LanguageModelRoutingEffort;
  tutorProfile: GeminiRoutingProfile;
  tutorFallbackEnabled: boolean;
  tutorFallbackModel: string;
  tutorFallbackThinkingOrEffort: LanguageModelRoutingEffort;
  tutorReadAloudProvider: 'windowsLocal' | 'edgeOnline' | 'googleChirp';
  tutorEdgeReadAloudLocale: string;
  tutorEdgeReadAloudVoice: string;
  tutorEdgeReadAloudFemaleVoice?: string;
  tutorEdgeReadAloudMaleVoice?: string;
  tutorEdgeReadAloudRatePercent: number;
  tutorLiveFemaleVoice?: string;
  tutorLiveMaleVoice?: string;
  tutorReadAloudVoice: string;
  tutorReadAloudRate: number;
  tutorReadAloudVolume: number;
  tutorSentencePauseMilliseconds: number;
  quickMenuRewriteVariant: QuickMenuRewriteVariantId;
  rewriteDomain: RewriteDomain;
  rewriteFormality: RewriteFormality;
  rewriteVoice: RewriteVoice;
  rewriteStance: RewriteStance;
  rewriteLength: RewriteLength;
  rewritePerspective: RewritePerspective;
  rewriteRhetoricalMode: RewriteRhetoricalMode;
  preserveFormatting: boolean;
  includeChangeNotes: boolean;
  rewriteCopyToClipboard: boolean;
  multiWordTranslationFallback: boolean;
  windowsNativePronunciation: boolean;
  geminiRetryEnabled: boolean;
  geminiRetryMaxAttempts: number;
  languageModelRetryEnabled: boolean;
  languageModelRetryMaxAttempts: number;
  ttsEnabled: boolean;
  readAloudVoice: string;
  readAloudRate: number;
  readAloudVolume: number;
  readAloudVoices: string[];
  readAloudProvider: 'windowsLocal' | 'edgeOnline' | 'googleChirp';
  readAloudChirpVoice?: string;
  edgeReadAloudLocale: string;
  edgeReadAloudVoice: string;
  edgeReadAloudRatePercent: number;
  edgeReadAloudPythonCommand: string;
  credentialPresence?: Partial<Record<KrenCredentialId, boolean>>;
  extensionVersion: string;
}

export interface UserDictionaryViewState {
  entries: UserDictionaryEntryV1[];
  status?: UserDictionaryViewStatus;
  selectedId?: string;
  selectedIds?: string[];
  query?: UserDictionaryListQuery;
  purgePreview?: UserDictionaryPurgePreview;
  importPreview?: UserDictionaryImportPreview;
  draft?: UserDictionaryEntryV1;
  editingId?: string;
  duplicateId?: string;
  capture?: UserDictionaryCaptureResult;
}

export type KrenCredentialId =
  | 'cloudflareAccountId'
  | 'cloudflareApiToken'
  | 'geminiDefault'
  | 'geminiAlternate'
  | 'googleCloudTranslation'
  | 'googleCloudTextToSpeech'
  | 'openai'
  | 'anthropic'
  | 'groq'
  | 'merriamWebsterCollegiate'
  | 'merriamWebsterMedical'
  | 'merriamWebsterThesaurus'
  | 'koreanDictionary';

const providerNames: Record<string, string> = {
  harper: 'Harper (offline)',
  groq: 'Groq',
  cloudflare: 'Cloudflare Workers AI',
  gemini: 'Gemini',
  googleCloudTranslation: 'Google Cloud Translation',
  koreanBasicDictionary: 'Korean Basic Dictionary',
  merriamWebsterCollegiate: "Merriam-Webster's Collegiate® Dictionary",
  merriamWebsterMedical: "Merriam-Webster's Medical Dictionary",
  merriamWebsterThesaurus: "Merriam-Webster's Collegiate® Thesaurus"
};

export function renderKrenResultViewHtml(options: ResultViewHtmlOptions): string {
  const audio = options.autoplayAudio && isAllowedPronunciationUrl(options.autoplayAudio.url)
    ? options.autoplayAudio
    : undefined;
  const tutorState = options.tutor ?? createTutorViewState();
  const tutorStandardQuietPeriodMs = options.tutorStandardQuietPeriodMs ?? 800;
  const busyNotice = options.busyNotice ?? (options.activeScreen === 'tutor'
    ? tutorWaitingNotice(tutorState)
    : undefined);
  /*
   * The overlay covers the page, so whatever it is waiting for has to be stoppable from
   * inside it. It was not: a generation that hung left the reader looking at a spinner with
   * every control underneath it unreachable, and the Cancel button that already existed was
   * one of the things being covered.
   *
   * Tutor waits keep their own cancel commands. Other waits carry an operation identifier
   * only when the caller supplied a cancellation action.
   */
  const busyCancel = options.busyCancelId !== undefined
    ? { command: 'cancelPanelProgress', attribute: ` data-operation-id="${options.busyCancelId}"`, label: 'Cancel' }
    : options.busyNotice === undefined && options.activeScreen === 'tutor'
      ? tutorWaitingCancel(tutorState)
      : undefined;
  // A result is held whenever one exists, whichever screen is showing. That is what decides
  // the way back, and it is deliberately not the same condition as the one below, which asks
  // whether the result screen is the one being drawn right now.
  const hasHeldResult = Boolean(options.result && options.sourceText !== undefined);
  const proModels = options.proModels;
  const liveModels = options.liveModels ?? KNOWN_TUTOR_LIVE_MODEL_IDS.map((id) => ({
    id,
    displayName: id
  }));
  const openAIModels = options.openAIModels ?? [
    { id: options.settings.openAIModel, displayName: options.settings.openAIModel }
  ];
  const anthropicModels = options.anthropicModels ?? [
    { id: options.settings.anthropicModel, displayName: options.settings.anthropicModel }
  ];
  const body = options.activeScreen !== 'start' && options.result && options.sourceText !== undefined
    ? renderPopulatedView(
      options.result,
      options.sourceText,
      Boolean(options.allowReplace),
      options.settings,
      options.brandImageUri,
      options.googleAttributionImageUri,
      options.grammarChoices,
      options.merriamWebsterLogoUris
    )
    : renderEmptyView(options.settings, options.brandImageUri, hasHeldResult,
      options.activeScreen !== 'start' ? 'empty'
        : !hasHeldResult && !options.busyNotice && !Object.values(options.settings.credentialPresence ?? {}).some(Boolean)
          ? 'firstRun' : 'default', options.systemUpdatesAvailable === true);
  const settingsView = renderSettings(
    options.settings,
    proModels,
    openAIModels,
    anthropicModels,
    options.brandImageUri,
    options.inferredRewriteModality,
    options.activeRewriteSettingsGroup,
    options.rewriteReplay,
    hasHeldResult
  );
  const manualView = renderManual(
    options.settings.extensionVersion,
    options.brandImageUri,
    options.settings.userDictionaryEnabled,
    hasHeldResult
  );
  const userDictionaryView = renderUserDictionary(
    options.userDictionary ?? { entries: [] },
    options.settings,
    options.brandImageUri,
    hasHeldResult,
    options.merriamWebsterLogoUris
  );
  const tutorView = options.activeScreen === 'tutor'
    ? renderTutor(tutorState, options.settings, options.brandImageUri, hasHeldResult,
        proModels, liveModels, openAIModels, anthropicModels,
        options.tutorSpeechProvider ?? 'auto',
        options.tutorLiveReplayAvailable === true,
        options.tutorLiveTalkAvailable === true,
        options.tutorLiveTalkListening === true,
        options.tutorLivePressToTalk === true,
        options.tutorConversationReplayAvailable === true,
        options.tutorConversationHintTurnGeneration,
        options.tutorConversationScene,
        options.tutorConversationPictures ?? options.tutorConversationPicture,
        options.tutorConversationStopDisabled,
        options.tutorConversationStopTitle, options.tutorConversationPictureTurns, options.tutorLiveFailed === true)
    : '';
  const initialAudio = audio
    ? `data-headword="${escapeHtml(audio.headword)}"`
    : '';
  const audioClass = audio ? 'audio-player' : 'audio-player hidden';

  return `<!doctype html>
<html lang="en" data-kren-kind="${effectivePanelTheme(options.settings.panelTheme ?? 'followVSCode', options.themeKind ?? 'light')}"${options.settings.panelTheme && options.settings.panelTheme !== 'followVSCode' ? ` data-kren-theme="${options.settings.panelTheme}"` : ''}>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${options.cspSource} data:; media-src https://media.merriam-webster.com data:; style-src ${options.cspSource} 'nonce-${options.nonce}'; script-src 'nonce-${options.nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style nonce="${options.nonce}">
    :root { color-scheme: light dark; }
    ${PANEL_THEME_CSS}
    [data-kren-kind="light"] { color-scheme: light; }
    [data-kren-kind="dark"] { color-scheme: dark; }
    body { margin: 0; padding: 18px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-family: var(--vscode-font-family); line-height: 1.5; }
    .shell { max-width: 980px; margin: 0 auto; }
    /* Wraps only when the row genuinely does not fit. It used to be forced into a column
       below 520px, which is a width the secondary sidebar sits at all the time, so three
       icon buttons dropped to their own line with most of the row still empty. */
    .top { position: relative; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .top-main { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex: 1 1 0; min-width: 0; }
    .top-actions { display: flex; flex-shrink: 0; align-items: center; gap: 0; }
    .icon-button { display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0; border-color: transparent; color: var(--vscode-foreground); background: transparent; font-size: 1rem; }
    [data-tutor-chat-mic-control][hidden], [data-tutor-composer-stop][hidden] { display: none; }
    .icon-button svg { width: 18px; height: 18px; }
    .icon-button svg, .tutor-settings-bridge svg { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    /* Shared core marks the icons it means to be solid. The stroke stays on and matches the
       fill, so a filled glyph keeps the same optical weight as the outlines beside it. */
    .icon-button svg.kren-icon-filled { fill: currentColor; stroke: currentColor; }
    .setting[hidden] { display: none; }
    .icon-button.model-icon-button:hover:where(:not(:disabled):not([aria-disabled="true"])) { background: transparent; }
    .icon-button:hover:where(:not(:disabled):not([aria-disabled="true"])) { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
    /*
     * Stated rather than left to the browser's default fading, which can drop a disabled
     * control far enough that its position cannot be judged. It must read as unavailable and
     * still hold a visible place, which is the whole point of rendering it at all.
     */
    .icon-button:disabled { opacity: .55; }
    .icon-button.tutor-action-icon { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border-color: var(--vscode-button-border, transparent); }
    .icon-button.tutor-action-icon:hover:where(:not(:disabled):not([aria-disabled="true"])) { color: var(--vscode-button-foreground); background: var(--vscode-button-hoverBackground); }
    .icon-button.tutor-dictation-active { color: var(--vscode-editor-background); background: var(--vscode-charts-red, var(--vscode-errorForeground)); }
    .icon-button.tutor-microphone-pulsing { animation: kren-tutor-microphone-pulse 2s ease-in-out infinite; }
    @keyframes kren-tutor-microphone-pulse {
      0%, 100% { box-shadow: 0 0 0 0 var(--vscode-charts-red, var(--vscode-errorForeground)); }
      50% { box-shadow: 0 0 0 6px transparent; }
    }
    @media (prefers-reduced-motion: reduce) {
      .icon-button.tutor-microphone-pulsing { animation: none; box-shadow: 0 0 0 2px var(--vscode-charts-red, var(--vscode-errorForeground)); }
    }
    .tutor-conversation-scene { margin: 12px 0; padding: 10px 12px; border-left: 3px solid var(--vscode-descriptionForeground); color: var(--vscode-foreground); font-weight: 400; }
    .tutor-conversation-scene p { margin: 0; }
    .icon-button[data-copied] { color: var(--vscode-charts-green, var(--vscode-testing-iconPassed, currentColor)); background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
    .entry-actions { margin: 4px 0 10px; }
    body[data-busy], body[data-notice] { overflow: hidden; }
    .busy-overlay { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; padding: 18px; background: color-mix(in srgb, var(--vscode-sideBar-background) 78%, transparent); backdrop-filter: blur(1px); }
    .busy-card { display: flex; align-items: center; gap: 10px; max-width: 320px; padding: 12px 16px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 6px; background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background)); box-shadow: 0 2px 10px var(--vscode-widget-shadow); font-size: .92rem; }
    [data-active-screen="tutor"] .busy-card { max-width: min(480px, calc(100vw - 64px)); }
    [data-active-screen="tutor"] .busy-card > button { white-space: nowrap; flex: 0 0 auto; }
    .notice-card { flex-wrap: wrap; max-height: calc(100vh - 36px); overflow: auto; }
    .popup-message { flex: 1; min-width: 0; text-align: left; overflow-wrap: anywhere; }
    .busy-overlay > .busy-card.popup-long-message { font-size: 12px; max-width: min(360px, calc(100vw - 64px)); }
    .popup-long-message > .popup-message { max-width: 354px; }
    .notice-card > #kren-notice-message { flex: 1; min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .notice-icon { width: 14px; height: 14px; flex: none; color: var(--vscode-foreground); }
    .notice-actions { display: flex; flex-wrap: wrap; gap: 8px; flex-basis: 100%; justify-content: flex-end; }
    .busy-spinner { width: 14px; height: 14px; flex: none; border: 2px solid var(--vscode-descriptionForeground); border-top-color: transparent; border-radius: 50%; animation: kren-spin 900ms linear infinite; }
    @keyframes kren-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .busy-spinner { animation-duration: 3s; } }
    .sense-pronunciation { margin: 3px 0 0; color: var(--vscode-descriptionForeground); font-size: .9rem; }
    /* The number and the part of speech lead the definition on one line, the way a printed
       dictionary sets an entry. On their own line they cost a line break per meaning and
       said nothing the definition beside them does not. */
    .setting-inactive { opacity: .5; }
    .sense-definition { margin: 0; }
    .sense-part-of-speech { color: var(--vscode-descriptionForeground); }
    .grammar-draft { margin: 0 0 14px; padding: 10px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 5px; background: var(--vscode-editorWidget-background, transparent); }
    .grammar-draft-label { display: block; margin-bottom: 5px; font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; color: var(--vscode-descriptionForeground); }
    .grammar-draft textarea { width: 100%; box-sizing: border-box; resize: vertical; font-family: var(--vscode-editor-font-family, monospace); color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--kren-field-border); }
    .credentials-actions { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
    .apply-bar { display: flex; align-items: center; gap: 8px; margin: 8px 0; padding: 6px 8px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
    .apply-note { margin: 0; flex: 1; font-size: .85rem; color: var(--vscode-descriptionForeground); }
    .brand { display: flex; align-items: center; gap: 10px; min-width: 0; font-size: 1.05rem; font-weight: 800; letter-spacing: .05em; }
    .brand-logo { width: 36px; height: 36px; flex: 0 0 auto; border-radius: 8px; object-fit: cover; }
    .intro-header { margin-bottom: 28px; }
    .intro-header .top-main, .intro-header .top-actions { flex-wrap: wrap; }
    .intro-header .top-actions { max-width: 100%; }
    [data-system-updates] { max-width: 140px; white-space: normal; line-height: 1.2; padding: 4px 6px; font-size: 10px; font-weight: bold; }
    .system-updates-row { display: flex; justify-content: flex-end; position: relative; top: -50px; }
    .intro-header .brand { gap: 15px; font-size: clamp(2.2rem, 9vw, 4.2rem); color: var(--vscode-descriptionForeground); letter-spacing: -.03em; }
    /* 2026-10-20 (owner, canvas): the Start page's KREN name is 30px. */
    .intro-header .brand-name { font-size: 30px; }
    .intro-header .brand-logo { width: clamp(68px, 18vw, 104px); height: clamp(68px, 18vw, 104px); border-radius: 13px; }
    .menu-wrap { position: relative; }
    .menu-button { font-size: 1.35rem; line-height: 1; }
    .menu-popover { position: absolute; z-index: 20; top: 36px; right: 0; min-width: 170px; padding: 6px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 7px; background: var(--vscode-menu-background, var(--vscode-editor-background)); box-shadow: 0 5px 18px var(--vscode-widget-shadow); }
    .menu-item { display: block; width: 100%; border: 0; padding: 8px 10px; text-align: left; color: var(--vscode-menu-foreground, var(--vscode-foreground)); background: transparent; }
    .menu-item:hover:where(:not(:disabled):not([aria-disabled="true"])) { color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground)); background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground)); }
    .provider { display: flex; align-items: center; justify-content: flex-end; gap: 7px; min-width: 0; color: var(--vscode-descriptionForeground); font-size: .82rem; text-align: right; }
    .provider span { min-width: 0; overflow-wrap: anywhere; }
    .provider-logo { width: 50px; height: 50px; flex-shrink: 0; object-fit: contain; }
    /* 2026-10-20 (owner, canvas): 10px above and below every result's provider line (Merriam-Webster, Google Cloud Translation, model names). */
    .provider { padding-top: 10px; padding-bottom: 10px; }
    [data-kren-kind="light"] .provider-logo-dark, [data-kren-kind="dark"] .provider-logo-light { display: none; }
    .theme-icon-light, [data-kren-kind="dark"] .theme-icon-dark { display: none; }
    [data-kren-kind="dark"] .theme-icon-light { display: block; }
    .provider-attribution { margin: 14px 0 0; color: var(--vscode-descriptionForeground); font-size: .78rem; }
    .google-attribution { display: block; width: 176px; height: 16px; margin-bottom: 7px; }
    [data-kren-kind="dark"] .google-attribution { background: var(--kren-brand-background); padding: 3px 6px; border-radius: 3px; }
    .translation-alternatives { padding-left: 16px; }
    .provider-disclaimer { margin-top: 6px; }
    .card { border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 8px; background: var(--vscode-editor-background); margin: 0 0 14px; overflow: hidden; }
    .card-title { margin: 0; padding: 9px 13px; font-size: .78rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--vscode-descriptionForeground); background: var(--vscode-sideBarSectionHeader-background); border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
    .card-body { padding: 14px; }
    .card-body > p:has(+ p) { margin-bottom: 0; }
    .card-body > p + p { margin-top: 6px; }
    #updates-screen > [role="status"] { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    section[data-update-group] > h3 { text-transform: uppercase; padding-left: 6px; }
    .source { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--vscode-font-family); font-size: .95rem; }
    .translation { font-size: .95rem; white-space: pre-wrap; overflow-wrap: anywhere; } /* Matches .source above. The two are read against each other, and a result set larger
       than its input made the comparison harder rather than easier. */
    .direction, .note, .muted { color: var(--vscode-descriptionForeground); }
    .entry { padding: 10px 0; border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
    .entry:first-child { border-top: 0; padding-top: 0; }
    .entry:last-child { padding-bottom: 0; }
    .headword { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 1.7rem; line-height: 1.2; }
    .part { color: var(--vscode-textLink-foreground); font-family: var(--vscode-font-family); font-size: .95rem; font-style: italic; }
    .pronunciation { color: var(--vscode-descriptionForeground); margin: 5px 0 8px; }
    .forms { font-weight: 600; }
    .sense { margin: 10px 0 0; }
    .sense-number { display: inline-block; min-width: 2em; font-weight: 700; color: var(--vscode-textLink-foreground); }
    blockquote { margin: 6px 0 6px 2em; padding-left: 10px; border-left: 2px solid var(--vscode-textBlockQuote-border); color: var(--vscode-descriptionForeground); }
    .relation { margin: 7px 0; }
    .relation strong { color: var(--vscode-textLink-foreground); }
    .word { display: inline-block; margin: 2px 4px 2px 0; padding: 1px 7px; border-radius: 999px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .word-label { opacity: .8; font-size: .85em; }
    .discussion { margin-top: 14px; padding: 12px; border-left: 3px solid var(--vscode-textLink-foreground); background: var(--vscode-textBlockQuote-background); }
    .rewrite-variant { margin: 0; padding: 13px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 7px; background: var(--vscode-editor-background); }
    .rewrite-variant + .rewrite-variant { margin-top: 14px; }
    .rewrite-variant h3 { margin: 0 0 8px; color: var(--vscode-textLink-foreground); }
    .rewrite-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .change-note { margin: 12px 0 0; padding: 9px 10px; border-left: 3px solid var(--vscode-textLink-foreground); color: var(--vscode-descriptionForeground); background: var(--vscode-textBlockQuote-background); }
    .provider-switch-order { display: grid; grid-template-columns: max-content auto auto; justify-content: start; align-items: center; row-gap: 6px; counter-reset: prov; padding-left: 25px; }
    .provider-switch-order > li { display: contents; }
    .provider-switch-order > li > span { counter-increment: prov; }
    .provider-switch-order > li > span::before { content: counter(prov) ". "; }
    .provider-switch-order button { margin-left: 6px; }
    .provider-switch-order .icon-button[data-provider-move] { position: relative; top: 6px; background-color: transparent; border-color: transparent; color: var(--vscode-foreground); }
    .model-note { margin: 0 0 12px; color: var(--vscode-descriptionForeground); font-size: .82rem; }
    .setting-unit { color: var(--vscode-descriptionForeground); font-size: .85rem; }
    .same-language-warning { margin: 0 0 12px; padding: 8px 10px; border-left: 3px solid var(--vscode-editorWarning-foreground); background: var(--vscode-inputValidation-warningBackground, transparent); font-size: .85rem; }
    .grammar-summary { margin: 0 0 12px; color: var(--vscode-descriptionForeground); }
    .grammar-issue { margin: 0 0 12px; padding: 12px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 7px; }
    .grammar-issue:last-child { margin-bottom: 0; }
    .grammar-issue legend { padding: 0 6px; color: var(--vscode-textLink-foreground); font-weight: 700; }
    /* Separated from the last option above it. Flush against the radio list, Add to local
       dictionary read as a fourth choice rather than as a different kind of action. */
    .grammar-issue .settings-buttons:not(:empty) { margin-top: 12px; }
    .grammar-problem { display: inline-block; margin: 4px 0 9px; padding: 2px 6px; border-radius: 3px; background: var(--vscode-textCodeBlock-background); font-family: var(--vscode-editor-font-family); }
    .grammar-options { display: grid; gap: 6px; }
    .grammar-option { display: flex; align-items: flex-start; gap: 7px; padding: 6px 8px; border-radius: 5px; background: var(--vscode-sideBarSectionHeader-background); cursor: pointer; }
    .grammar-option:has(input:checked) { outline: 1px solid var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .result-meta { color: var(--vscode-descriptionForeground); font-size: .78rem; font-weight: 400; letter-spacing: 0; text-transform: none; }
    .variant-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 11px; }
    .tts-status { align-self: center; color: var(--vscode-descriptionForeground); font-size: .78rem; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; position: sticky; bottom: 0; padding: 10px 0 2px; background: var(--vscode-sideBar-background); }
    button { border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px; padding: 6px 11px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; font: inherit; }
    button:hover:where(:not(:disabled):not([aria-disabled="true"])) { color: var(--vscode-button-foreground); background: var(--vscode-button-hoverBackground); }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button.secondary:hover:where(:not(:disabled):not([aria-disabled="true"])) { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryHoverBackground); }
    /* The disabled treatment swaps in the secondary background and has to swap in the
       foreground that belongs with it. It did not, so a disabled button kept
       --vscode-button-foreground, which is near white in every light theme, on a light
       grey. Review is rendered disabled until an answer is typed, and its label was
       unreadable for exactly as long. */
    /* 2026-10-04: Hover must not raise disabled-rule specificity above a solid tutor icon. */
    button:disabled, button:disabled:where(:hover) { opacity: 0.45; cursor: default; color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); background: var(--vscode-button-secondaryBackground); }
    button.audio { padding: 2px 7px; margin-left: 5px; vertical-align: middle; }
    button.audio.icon-button, button.audio.icon-button:hover { padding: 0; background: transparent; border-color: transparent; color: var(--vscode-foreground); }
    .audio-player { width: 100%; margin: 0 0 14px; }
    .hidden { display: none; }
    .empty { padding: 28px 18px; text-align: center; color: var(--vscode-descriptionForeground); }
    .settings-screen h2 { margin: 0 0 4px; font-size: 1.2rem; }
    .settings-intro { margin: 0 0 16px; color: var(--vscode-descriptionForeground); }
    /* Icon-only controls. A square target keeps the drawing from being squeezed by the
       text padding the other buttons need. */
    .icon-button { min-width: 32px; padding: 4px 8px; font-size: 1rem; line-height: 1.2; }
    /* 2026-10-20 (owner, canvas): six header buttons fit narrow panels with 4px side padding. */
    .top-actions .icon-button { padding-left: 4px; padding-right: 4px; }
    /* 2026-10-20 (owner, canvas): no gap between header buttons; the menu keeps 4px on each side. */
    .top-actions > .menu-wrap { padding-left: 4px; padding-right: 4px; }
    .settings-group { margin-bottom: 14px; padding: 13px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 8px; background: var(--vscode-editor-background); }
    .settings-group h3 { margin: 0; font-size: .9rem; }
    /* Every settings group is a details element, so the heading is the fold control.
       The disclosure marker is drawn here rather than left to the browser default,
       because the native marker sits outside the padding and reads as misaligned. */
    .settings-group > summary { display: flex; gap: 7px; align-items: center; cursor: pointer; list-style: none; }
    .settings-group > summary > h3 { margin-top: 3px; }
    .settings-group > summary::-webkit-details-marker { display: none; }
    .settings-group > summary::before { content: '▸'; width: 20px; font-size: 2em; line-height: 0; align-self: center;  flex: none; color: var(--vscode-descriptionForeground); }
    .settings-group[open] > summary::before { content: '▾'; }
    .settings-group[open] > summary { margin-bottom: 11px; }
    .settings-group > summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    .rewrite-settings-group { border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
    .rewrite-settings-group:last-child { border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
    details.rewrite-settings-group > summary { display: grid; grid-template-columns: 20px minmax(78px, auto) minmax(0, 1fr); gap: 7px; align-items: center; margin-top: 5px; margin-bottom: 5px; padding: 9px 2px; cursor: pointer; list-style: none; }
    .rewrite-settings-group > summary::-webkit-details-marker { display: none; }
    .rewrite-settings-group > summary::before { content: '▸'; width: 20px; font-size: 2em; line-height: 0; align-self: center;  color: var(--vscode-descriptionForeground); }
    .rewrite-settings-group[open] > summary::before { content: '▾'; }
    .rewrite-group-name { margin-top: 3px; font-size: .76rem; font-weight: 750; letter-spacing: .06em; }
    .rewrite-group-summary { min-width: 0; color: var(--vscode-descriptionForeground); font-size: .78rem; overflow-wrap: anywhere; margin-top: 3px; }
    .rewrite-group-fields { padding: 2px 0 11px 17px; }
    .setting { display: grid; grid-template-columns: minmax(0, 1fr) minmax(120px, 42%); align-items: center; gap: 12px; padding: 9px 0; border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
    .setting:has(> [data-purge-selection]) { grid-template-columns: 1fr; }
    .setting:first-of-type { border-top: 0; padding-top: 0; }
    .setting:last-child { padding-bottom: 0; }
    .setting-title { display: block; font-weight: 600; }
    .setting-description { display: block; margin-top: 2px; color: var(--vscode-descriptionForeground); font-size: .78rem; }
    select, input[type='text'], input[type='search'], input[type='number'] { width: 100%; min-width: 0; box-sizing: border-box; padding: 5px 7px; border: 1px solid var(--kren-field-border); color: var(--vscode-input-foreground); background: var(--vscode-input-background); font: inherit; }
    .switch { position: relative; justify-self: end; width: 38px; height: 22px; }
    .switch input { position: absolute; opacity: 0; }
    .slider { position: absolute; inset: 0; border-radius: 999px; background: var(--vscode-input-background); border: 1px solid var(--kren-toggle-border); cursor: pointer; transition: .15s; }
    .switch input:focus-visible + .slider { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
    .slider::before { content: ''; position: absolute; width: 16px; height: 16px; left: 2px; top: 2px; border-radius: 50%; background: var(--vscode-descriptionForeground); transition: .15s; }
    .switch input:checked + .slider { background: var(--vscode-button-background); }
    .switch input:checked + .slider::before { transform: translateX(16px); background: var(--vscode-button-foreground); }
    .settings-buttons { display: flex; flex-wrap: wrap; gap: 7px; }
    .dictionary-layout { display: grid; grid-template-columns: minmax(150px, .7fr) minmax(0, 1.3fr); gap: 14px; }
    .dictionary-list { display: grid; gap: 4px; align-content: start; }
    .dictionary-list button { width: 100%; text-align: left; color: var(--vscode-foreground); background: transparent; border-color: transparent; }
    .dictionary-list-row { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 5px; }
    .dictionary-filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: 7px; margin: 12px 0; }
    .dictionary-filters input, .dictionary-filters select { min-width: 0; box-sizing: border-box; padding: 6px 7px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--kren-field-border); }
    .dictionary-filters input { grid-column: 1 / -1; }
    .storage-error { border-color: var(--vscode-errorForeground); }
    .dictionary-list button:hover:where(:not(:disabled):not([aria-disabled="true"])), .dictionary-list button.active { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); }
    .dictionary-meta { color: var(--vscode-descriptionForeground); font-size: .78rem; }
    .dictionary-detail h2 { margin: 0 0 3px; overflow-wrap: anywhere; }
    .dictionary-detail .card-body h3 { margin: 15px 0 4px; color: var(--vscode-textLink-foreground); font-size: .9rem; }
    .dictionary-detail p { overflow-wrap: anywhere; }
    .dictionary-sense { margin: 10px 0; padding: 10px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 6px; }
    /* The captured meaning is the answer, so it is bordered in the link colour and the list
       below it is not. Its own heading sits inside the box rather than above it, which is
       what makes the box read as one thing instead of a heading and a stray panel. */
    .captured-context { margin: 12px 0; padding: 10px 12px; border: 1px solid var(--vscode-textLink-foreground); border-radius: 6px; background: var(--vscode-textBlockQuote-background); }
    .captured-context h3 { margin: 0 0 6px; font-size: .82rem; text-transform: uppercase; letter-spacing: .04em; color: var(--vscode-textLink-foreground); }
    .captured-context p { margin: 4px 0; }
    .captured-part-of-speech { color: var(--vscode-descriptionForeground); font-size: .9rem; font-style: italic; }
    /* Sentences and examples read smaller than the meaning they illustrate, because the
       meaning is what the reader came for and the sentence is the evidence under it. */
    /* An empty line above it, so the captured text reads as evidence set below the meaning
       rather than as another line of it. Same treatment as an example, for the same reason. */
    .captured-sentence { margin: 16px 0 0; font-size: inherit; font-style: italic; color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
    /* Left-aligned with the definition above them rather than indented under it, at the same
       size, italic, and with no fill. The owner asked for all four: an example set apart by
       colour and indentation reads as a different kind of content than the meaning it
       illustrates, when it is the same content shown in use. */
    .dictionary-sense blockquote { margin-left: 0; padding-left: 0; border-left: none; background: none; font-size: inherit; font-style: italic; }
    .dictionary-draft textarea { width: 100%; min-height: 58px; box-sizing: border-box; padding: 6px 7px; resize: vertical; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--kren-field-border); font: inherit; }
    .dictionary-draft .setting { grid-template-columns: minmax(0, 1fr); gap: 5px; }
    .duplicate-notice { margin: 0 0 12px; padding: 11px; border-left: 3px solid var(--vscode-editorWarning-foreground); background: var(--vscode-textBlockQuote-background); }
    .credential-row { display: grid; grid-template-columns: minmax(145px, 1fr) 2fr; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
    .credential-row.unavailable { color: var(--vscode-descriptionForeground); }
    .credential-missing { color: var(--vscode-descriptionForeground); }
    .setting:has(input.credential-missing) .setting-title { color: var(--vscode-descriptionForeground); }
    select.credential-missing option:not(.credential-missing):not(:disabled) { color: var(--vscode-input-foreground); }
    .credential-row:last-of-type { border-bottom: 0; }
    .credential-status { margin-left: 5px; color: var(--vscode-descriptionForeground); font-size: 0.82em; font-weight: 400; }
    .credential-reason { display: block; margin-top: 3px; color: var(--vscode-descriptionForeground); font-size: .75rem; font-weight: 400; line-height: 1.25; }
    .credential-label { font-weight: 650; }
    .setting-control { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .setting-control input { flex: 1; }
    .setting-control button { flex: 0 0 auto; padding: 5px 8px; }
    .conditional-group { margin-top: 4px; }
    .conditional-group.hidden { display: none; }
    .welcome { padding: clamp(16px, 4vw, 28px); text-align: left; }
    .welcome-lead { margin: 0 0 24px; font-size: 14px; line-height: 1.5; }
    .welcome-layout { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(170px, .8fr); gap: clamp(18px, 5vw, 42px); align-items: start; }
    .welcome-flow { display: grid; gap: 14px; }
    .welcome-step { padding: 16px 18px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 22px; background: var(--vscode-textBlockQuote-background, var(--vscode-editor-background)); }
    .welcome-step strong { display: block; margin-bottom: 8px; color: var(--vscode-textLink-foreground); font-size: 18px; }
    .welcome-step > span { display: block; line-height: 1.45; }
    .welcome-step .welcome-status-item { display: inline-flex; align-items: center; gap: .25em; padding: 0 .3em; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 3px; background: var(--vscode-editor-background); color: var(--vscode-foreground); font-size: inherit; font-weight: normal; vertical-align: baseline; white-space: nowrap; }
    .welcome-status-item svg { width: 1em; height: 1em; flex: none; }
    /* One column while the grid sits beside the numbered steps, because the column it shares
       the row with is narrow and two of them truncated every label to "English ...". Once the
       layout stacks, the grid has the full width and takes two columns until that is narrow
       too. The breakpoints below own the change; this is the side-by-side case. */
    .capability-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
    .capability-item > .capability { width: 100%; }
    .capability { display: flex; align-items: center; justify-content: center; min-width: 0; min-height: 44px; padding: 8px; overflow: hidden; color: var(--vscode-button-foreground); background: var(--vscode-button-background); font-size: .95rem; text-align: center; }
    .capability > span:first-child, .capability.has-reason { display: block; }
    .capability-label { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 14px; }
    .capability.unavailable { color: var(--vscode-descriptionForeground); background: var(--vscode-sideBarSectionHeader-background); }
    .capability-reason { display: block; margin-top: 3px; font-size: .72rem; line-height: 1.25; }
    .privacy-note { margin: 24px 5px 0; color: var(--vscode-descriptionForeground); font-size: .95rem; line-height: 1.5; }
    .credits { margin: 16px 0 0; padding-top: 10px; border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); color: var(--vscode-descriptionForeground); font-size: .74rem; text-align: left; }
    .manual-screen { line-height: 1.55; }
    .manual-screen h2 { margin: 14px 0 5px; }
    .manual-screen h3 { margin: 18px 0 5px; color: var(--vscode-textLink-foreground); text-transform: uppercase; }
    #manual-screen ol, #manual-screen ul { padding-left: 15px; }
    .manual-screen .manual-nav { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
    .manual-screen code { padding: 1px 4px; border-radius: 3px; background: var(--vscode-textCodeBlock-background); }
    .tutor-page { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
    .tutor-page .rewrite-settings-group { margin: 0; }
    .tutor-page > h2 { margin-top: 20px; }
    .tutor-page > h2:not(#tutor-conversation-heading) { font-size: 1.2rem; font-weight: 700; margin: 30px 0 6px; }
    .tutor-page > p { margin-top: -9px; }
    .tutor-map-recipe { margin-top: 14px; }
    .tutor-map-recipe > details + details { margin-top: -1px; }
    .tutor-lesson-section > h2 { font-size: 1.2rem; font-weight: 700; margin: 30px 0 6px; }
    .tutor-take-home > h2 { font-size: 1.2rem; font-weight: 700; margin: 30px 0 6px; }
    .tutor-take-home-natural p { margin: 4px 0; }
    .tutor-take-home ul { padding-left: 16px; }
    .tutor-take-home-explanation { font-size: 13px; }
    .tutor-take-home > button + button { margin-left: 6px; }
    .tutor-picture-paused { position: relative; z-index: 1; color: var(--vscode-descriptionForeground); }
    .tutor-lesson-introduction { margin: 0 0 12px; font: inherit; line-height: 1.5; color: var(--vscode-foreground); }
    .tutor-lesson-instruction { margin: 18px 0 10px; font: inherit; line-height: 1.5; color: var(--vscode-foreground); }
    .tutor-foldable-summary { display: flex; align-items: center; min-width: 0; }
    .tutor-heading-row { display: flex; flex-wrap: nowrap; align-items: center; justify-content: space-between; gap: 8px 12px; margin: 0 0 14px; }
    .tutor-heading-row h1 { margin: 0; }
    .tutor-master-reset { box-sizing: border-box; width: 60px; padding-left: 6px; padding-right: 6px; flex-shrink: 0; }
    .tutor-heading-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-start; gap: 6px; margin: 0; padding-top: 6px; padding-bottom: 12px; }
    .tutor-lesson-section[data-tutor-lesson-drafted] > .tutor-heading-actions { margin: 16px 0 18px; }
    .tutor-heading-actions > button, .tutor-conversation-front-actions > button { box-sizing: border-box; width: 60px; padding-left: 6px; padding-right: 6px; }
    .tutor-action-status-region { margin: 0 0 10px; }
    [data-tutor-shared-action] { box-sizing: border-box; inline-size: var(--tutor-shared-action-width, max-content); }
    .tutor-action-status { margin: 7px 0 0; color: var(--vscode-descriptionForeground); }
    .tutor-action-status-region > p.tutor-action-status { margin-top: 15px; margin-bottom: 30px; }
    .tutor-map-search-row { display: grid; grid-template-columns: minmax(0, 1fr) ${renderTutorMapSearchControls(tutorState).map(() => 'max-content').join(' ')}; gap: 6px; margin-bottom: 8px; }
    .tutor-map-search { min-width: 0; min-height: 32px; resize: vertical; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--kren-field-border); }
    .tutor-map-search::placeholder, .tutor-conversation-answer::placeholder { color: var(--vscode-descriptionForeground); opacity: 1; }
    .tutor-map-search-results { display: grid; gap: 6px; }
    .tutor-map-search-result { width: 100%; text-align: left; }
    .tutor-question-only-setting { margin: 1.2em 0; }
    .tutor-map-level[data-tutor-map-control="microTarget"] { margin-bottom: 1.2em; }
    /* The owner's spacing between the last listed target and the Hub dropdown, 2026-10-01. */
    .tutor-map-level[data-tutor-map-control="hub"] { padding-top: 20px; }
    .information-heading, .tutor-map-level-heading { display: flex; align-items: center; gap: 4px; }
    .information-heading .icon-button, .tutor-map-level-heading .icon-button { width: 21px; min-width: 21px; height: 21px; padding: 1px; }
    .tutor-tray-row .icon-button { width: 24px; min-width: 24px; height: 24px; padding: 2px; }
    .information-heading .icon-button svg, .tutor-map-level-heading .icon-button svg, .tutor-tray-row .icon-button svg { width: 18px; height: 18px; }
    .tutor-map-information:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    .tutor-map-level select { width: 100%; min-width: 0; }
    [aria-disabled="true"] { cursor: not-allowed; }
    .tutor-map-level select[aria-disabled="true"], .tutor-map-action[aria-disabled="true"] { color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground)); opacity: .72; }
    .tutor-map-action[aria-disabled="true"] { color: var(--vscode-button-foreground); }
    .tutor-map-reason { grid-column: 1 / -1; margin: 0; color: var(--vscode-descriptionForeground); font-size: .76rem; }
    .tutor-target-info { grid-column: 1 / -1; margin: 2px 0 6px; padding: 8px; border-left: 2px solid var(--vscode-panel-border); }
    .tutor-target-info dt { margin-top: 4px; font-weight: 700; }
    .tutor-target-info dd { margin-left: 0; }
    .tutor-tray { margin-top: 10px; padding: 8px; border: 1px solid var(--vscode-panel-border); border-radius: 5px; }
    .tutor-tray-heading { display: flex; flex-wrap: nowrap; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
    .tutor-tray-heading > strong { margin-top: 6px; }
    .tutor-tray-row { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin: 4px 0; }
    .tutor-target-path { flex: 1 1 220px; }
    .tutor-tray-actions { display: flex; justify-content: flex-end; }
    .tutor-tray-actions { flex: 1 1 auto; flex-wrap: nowrap; align-items: flex-start; gap: 6px; }
    .tutor-tray-actions > span { display: flex; flex-direction: column; align-items: flex-end; }
    .tutor-message, .tutor-failure, .tutor-warning { margin: 7px 0; padding: 7px 9px; border-left: 3px solid var(--vscode-editorWarning-foreground); background: var(--vscode-textBlockQuote-background); }
    .tutor-screen-reader-status { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    .tutor-selection-footnote { margin: 7px 0; padding: 0; font-size: 0.9em; color: var(--vscode-descriptionForeground); border: none; background: none; }
    .tutor-failure { border-left-color: var(--vscode-notificationsErrorIcon-foreground, currentColor); }
    .tutor-lesson { margin: 10px 0; padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editor-background); }
    .tutor-lesson h2, .tutor-lesson h3 { margin-top: 8px; }
    [data-tutor-lesson-explanation] { border-width: .52px 0; border-style: solid; border-color: var(--vscode-widget-border, var(--vscode-panel-border)); }
    article.tutor-lesson[data-tutor-result="lesson"] > h3 { padding-top: 10px; }
    article.tutor-lesson[data-tutor-result="lesson"] > p { margin-top: 5px; margin-bottom: 10px; }
    article.tutor-lesson > h3 { margin-top: 16px; }
    article.tutor-lesson > details[data-persist-id="tutor-lesson-errors"] { margin-top: 18px; }
    /* Markers sit on the left edge of the list, level with the heading above it, rather
       than indented by the browser's default list padding. */
    .tutor-lesson ul, .tutor-lesson ol { margin-left: 0; padding-left: 0; list-style-position: inside; }
    .tutor-lesson li { margin: 3px 0; }
    /* A numbered example or practice item reads as the sentence itself, so its heading
       carries the heading's structure and the surrounding text's weight and size. */
    .tutor-example .tutor-item-heading, .tutor-exercise .tutor-item-heading { margin: 0 0 5px; font-size: inherit; font-weight: 400; line-height: 1.45; }
    .tutor-example, .tutor-exercise { margin: 10px 0; padding: 10px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 5px; }
    article.tutor-lesson > article.tutor-example { margin-top: 20px; }
    .tutor-exercise > .tutor-item-heading { margin-bottom: 1.1em; }
    .tutor-practice-panel > [aria-label^="Review of exercise"] { display: block; margin-top: 1.1em; }
    .tutor-section-heading { display: flex; align-items: center; gap: 8px; margin: 1.45em 0 .5em; }
    .tutor-practice-panel > [aria-label^="Review of exercise"] > .tutor-section-heading { margin-top: 25px; }
    .tutor-practice-panel > [aria-label^="Review of exercise"] > .tutor-section-heading + p.tutor-review-mark { margin-top: 10px; }
    article.tutor-example > div > div.tutor-section-heading { margin-top: 24.85px; }
    .tutor-section-badge { flex: none; margin: 0; padding: .25em .45em; border-radius: 4px; color: var(--vscode-textLink-foreground); background: transparent; font-size: .76rem; letter-spacing: .06em; }
    .tutor-section-divider { flex: 1 1 auto; align-self: center; min-width: 0; border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
    .tutor-heading-title { display: flex; align-items: center; gap: 6px; }
    .tutor-lesson-practice-action { display: flex; flex-wrap: wrap; gap: 7px; margin: 35px 0 2px 11px; }
    /* Unavailable until the set is finished, and it has to look it: aria-disabled alone only
       changes the cursor. Dimmed to match a disabled button such as Hint. */
    [data-tutor-lesson-practice-action] > button[aria-disabled="true"] { opacity: .45; }
    .tutor-exercise-controls { display: flex; flex-wrap: nowrap; align-items: center; gap: 10px 12px; margin-top: 20px; padding-left: 7px; margin-bottom: 6px; }
    .tutor-exercise-controls > .tutor-item-actions { margin-top: 0; flex-wrap: nowrap; min-width: 0; }
    .tutor-exercise-navigation { display: flex; align-items: center; gap: 4px; margin-left: auto; margin-right: 4px; }
    .tutor-exercise-position { min-width: 42px; text-align: center; font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground); }
    .tutor-item-busy { opacity: .72; }
    .tutor-item-actions { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
    .tutor-item-actions > .tutor-action-status { margin: 0; align-self: center; }
    .tutor-item-actions button { padding: 4px 7px; }
    .tutor-item-actions .icon-button { padding: 0; }
    .tutor-example-controls { display: flex; flex-wrap: nowrap; align-items: center; gap: 10px 12px; margin-top: 1.5em; padding-left: 7px; }
    .tutor-example-controls > .tutor-item-actions { margin-top: 0; flex-wrap: nowrap; min-width: 0; }
    .tutor-example-navigation { display: flex; align-items: center; gap: 4px; margin-left: auto; margin-right: 4px; flex-shrink: 0; }
    .tutor-example-navigation > span { white-space: nowrap; }
    /* .tutor-lesson ul resets list padding at specificity 0,1,1, which silently beat a bare
       .tutor-annotation-list at 0,1,0: the indent became zero and the absolutely placed
       marker landed outside the panel. Qualifying the selector is the fix. */
    .tutor-lesson .tutor-annotation-list, .tutor-annotation-list { margin-block: 0; padding-left: 1.55em; list-style: none; }
    .tutor-annotation-list > li { position: relative; margin-top: 10px; margin-bottom: 0; margin-left: -5px; text-align: left; }
    /* A drawn disc rather than a bullet character, so its size is set here instead of
       inherited from a glyph. Its left edge sits between the E and the X inside the padded
       EXPLANATION badge, and it centres on the first line whatever the line height. */
    .tutor-annotation-list > li::before { content: ''; position: absolute; left: -0.73em; top: calc(0.5lh - 0.18em); width: .36em; height: .36em; border-radius: 50%; background: currentColor; }
    .tutor-annotation { margin: 2px 0; color: var(--vscode-descriptionForeground); }
    .tutor-annotation-excerpt { font-weight: 700; }
    .tutor-taught { font-weight: 700; }
    .tutor-review-correct { color: var(--vscode-charts-green, var(--vscode-testing-iconPassed)); }
    .tutor-review-correction { margin: 6px 0 5px; padding-left: 8px; border-left: 3px solid var(--vscode-charts-blue, var(--vscode-textLink-foreground)); }
    .tutor-question-explanation { margin: 1.45em 0 5px; padding-left: 0; border-style: none; }
    .tutor-review-corrected { font-weight: 700; color: var(--vscode-charts-blue, var(--vscode-textLink-foreground)); }
    .tutor-review-wrong { color: var(--vscode-charts-red, var(--vscode-errorForeground)); }
    .tutor-answer { width: 100%; box-sizing: border-box; min-height: 72px; resize: vertical; border: 1px solid var(--kren-field-border); background: var(--vscode-sideBar-background, var(--vscode-editorWidget-background)); color: var(--vscode-foreground); font: inherit; }
    .tutor-review-mark { margin: 5px 0; padding-left: 8px; border-left: 3px solid var(--vscode-testing-iconPassed, currentColor); }
    .tutor-review-mark.incorrect { border-left-color: var(--vscode-testing-iconFailed, currentColor); }
    .tutor-conversation { margin: 10px 0; padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editor-background); }
    .tutor-lesson-section > article.tutor-lesson[data-tutor-result="lesson"],
    .tutor-exercises > article.tutor-practice-panel,
    .tutor-page > section.tutor-conversation { margin-bottom: 25px; }
    .tutor-page > h2#tutor-conversation-heading { margin-top: 22.18px; }
    .tutor-page > section.tutor-conversation { margin-top: 0; }
    .tutor-conversation-answer { width: 100%; box-sizing: border-box; min-height: 72px; margin-top: 30px; resize: vertical; font: inherit; border: 1px solid var(--kren-field-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
    .tutor-answer-offscreen { position: absolute; left: -10000px; top: auto; width: 1px; height: 1px; min-height: 0; margin: 0; overflow: hidden; opacity: 0; pointer-events: none; }
    .tutor-drawer { position: fixed; z-index: 35; inset: 10px; overflow: auto; padding: 14px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 6px; background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background)); box-shadow: 0 4px 18px var(--vscode-widget-shadow); }
    .tutor-prepared-prompt-text { width: 100%; min-height: 18em; box-sizing: border-box; resize: vertical; font-family: var(--vscode-editor-font-family, monospace); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--kren-field-border); }
    .tutor-conversation-setup { margin-top: 8px; margin-left: 0; overflow-wrap: anywhere; }
    .tutor-conversation-settings > details[data-tutor-conversation-advanced] { margin-top: 8px; }
    .tutor-conversation-settings > .setting:first-of-type { padding-top: 9px; border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
    .tutor-conversation-custom { display: grid; gap: 5px; margin-top: 10px; }
    .tutor-conversation-custom textarea { width: 100%; min-height: 58px; box-sizing: border-box; padding: 6px 7px; resize: vertical; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--kren-field-border); font: inherit; }
    @media (max-width: 600px) {
      [data-persist-id="tutor-voice"] .setting:has([data-tutor-conversation-live-voice]),
      [data-persist-id="tutor-voice"] .setting:has([data-setting="tutor.readAloud.voice"]),
      [data-llm-routing="tutor"] .setting:has([data-model-preset]) { grid-template-columns: minmax(0, 1fr); }
    }
    .tutor-chat-viewport { position: relative; isolation: isolate; min-width: 0; }
    .tutor-chat-viewport-picture { width: 100%; aspect-ratio: 9 / 16; }
    .tutor-chat-viewport > [data-tutor-picture] { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; pointer-events: none; z-index: 0; }
    [data-tutor-picture][data-tutor-picture-transparency="0"] { opacity: 1; }
    [data-tutor-picture][data-tutor-picture-transparency="20"] { opacity: 0.8; }
    [data-tutor-picture][data-tutor-picture-transparency="40"] { opacity: 0.6; }
    [data-tutor-picture][data-tutor-picture-transparency="60"] { opacity: 0.4; }
    [data-tutor-picture][data-tutor-picture-transparency="80"] { opacity: 0.2; }
    [data-tutor-picture-column] { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
    .tutor-picture-frames { position: absolute; inset: 0; }
    .tutor-picture-frames > [data-tutor-picture] { position: absolute; inset: 0; width: 100%; height: 100%; aspect-ratio: 9 / 16; object-fit: cover; }
    .tutor-picture-stack { position: static; display: flex; flex-direction: column; gap: 20px; }
    .tutor-picture-stack > [data-tutor-picture] { position: static; flex: none; height: auto; }
    .tutor-chat-transcript { position: relative; z-index: 1; min-width: 0; min-height: 60px; max-height: min(65vh, 640px); overflow-y: auto; overflow-x: hidden; }
    .tutor-chat-viewport-picture > .tutor-chat-transcript { position: absolute; inset: 0; min-height: 0; max-height: none; }
    .tutor-chat-kren, .tutor-chat-learner, .tutor-chat-demo { box-sizing: border-box; width: fit-content; max-width: 78%; padding: 8px; margin-right: 0; margin-bottom: 8px; margin-left: 0; border-radius: 16px; overflow-wrap: anywhere; }
    .tutor-chat-kren { margin-top: 30px; margin-right: auto; margin-left: 6px; border-top-left-radius: 0; background: var(--vscode-textBlockQuote-background); }
    .tutor-chat-typing { display: flex; align-items: center; gap: 3px; min-width: 34px; }
    .tutor-typing-dot { opacity: .35; animation: kren-tutor-typing 600ms ease-in-out infinite alternate; }
    .tutor-typing-dot:nth-child(2) { animation-delay: 200ms; }
    .tutor-typing-dot:nth-child(3) { animation-delay: 400ms; }
    @keyframes kren-tutor-typing { from { opacity: .35; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .tutor-typing-dot { animation: none; } }
    .tutor-target-use { color: var(--vscode-textLink-foreground); text-decoration: underline; background: none; }
    .tutor-reply-quote { color: var(--vscode-textLink-foreground); font-weight: 700; }
    .tutor-chat-learner-turn { width: fit-content; max-width: 78%; margin-top: 0; margin-right: 6px; margin-bottom: 12px; margin-left: auto; }
    .tutor-chat-learner-turn[data-tutor-chat-microphone] { margin-top: 20px; }
    .tutor-chat-learner { max-width: 100%; margin-top: 20px; margin-left: auto; border-top-right-radius: 0; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    .tutor-chat-viewport-picture[data-tutor-balloon-transparency] .tutor-chat-kren,
    .tutor-chat-viewport-picture[data-tutor-balloon-transparency] .tutor-chat-learner { position: relative; isolation: isolate; background: transparent; }
    .tutor-chat-viewport-picture[data-tutor-balloon-transparency] .tutor-chat-kren::before,
    .tutor-chat-viewport-picture[data-tutor-balloon-transparency] .tutor-chat-learner::before { content: ''; position: absolute; inset: 0; z-index: -1; border-radius: inherit; }
    .tutor-chat-kren::before { background: linear-gradient(var(--vscode-textBlockQuote-background), var(--vscode-textBlockQuote-background)), var(--vscode-editor-background); }
    .tutor-chat-learner::before { background: linear-gradient(var(--vscode-button-background), var(--vscode-button-background)), var(--vscode-editor-background); }
    .tutor-chat-viewport-picture[data-tutor-balloon-transparency="0"] .tutor-chat-kren::before,
    .tutor-chat-viewport-picture[data-tutor-balloon-transparency="0"] .tutor-chat-learner::before { opacity: 1; }
    .tutor-chat-viewport-picture[data-tutor-balloon-transparency="10"] .tutor-chat-kren::before,
    .tutor-chat-viewport-picture[data-tutor-balloon-transparency="10"] .tutor-chat-learner::before { opacity: 0.9; }
    .tutor-chat-viewport-picture[data-tutor-balloon-transparency="20"] .tutor-chat-kren::before,
    .tutor-chat-viewport-picture[data-tutor-balloon-transparency="20"] .tutor-chat-learner::before { opacity: 0.8; }
    .tutor-chat-viewport-picture[data-tutor-balloon-transparency="30"] .tutor-chat-kren::before,
    .tutor-chat-viewport-picture[data-tutor-balloon-transparency="30"] .tutor-chat-learner::before { opacity: 0.7; }
    .tutor-chat-viewport-picture[data-tutor-balloon-transparency="40"] .tutor-chat-kren::before,
    .tutor-chat-viewport-picture[data-tutor-balloon-transparency="40"] .tutor-chat-learner::before { opacity: 0.6; }
    .tutor-chat-viewport-picture[data-tutor-balloon-transparency="50"] .tutor-chat-kren::before,
    .tutor-chat-viewport-picture[data-tutor-balloon-transparency="50"] .tutor-chat-learner::before { opacity: 0.5; }
    .tutor-rephrase-action { display: block; margin: 5px 0 0; padding: 0; border: 0; color: inherit; background: transparent; font: inherit; text-decoration: underline; cursor: pointer; }
    .tutor-chat-demo { margin-top: 20px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background)); }
    .tutor-chat-demo-female { margin-right: auto; border-top-left-radius: 0; }
    .tutor-chat-demo-male { margin-left: auto; border-top-right-radius: 0; }
    .tutor-chat-demo-name { display: block; margin-bottom: 2px; color: var(--vscode-descriptionForeground); font-size: .78rem; }
    .tutor-chat-kren > p, .tutor-chat-learner > p, .tutor-chat-demo > p { margin: 0; }
    .tutor-turn-feedback { margin-top: 8px; padding-left: 8px; border-left: 3px solid var(--vscode-textLink-foreground); color: var(--vscode-foreground); }
    .tutor-turn-feedback > p { margin: 4px 0; }
    .tutor-turn-check-failed { display: flex; align-items: center; gap: 6px; margin: 6px 0 0; color: var(--vscode-descriptionForeground); }
    .tutor-turn-explanation { margin-top: 5px; }
    .tutor-turn-explanation > summary { cursor: pointer; }
    .tutor-conversation-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-left: -1px; overflow-wrap: anywhere; }
    [data-tutor-conversation-active="true"] .tutor-chat-viewport-picture + .tutor-conversation-actions { padding-top: 10px; }
    .tutor-chat-learner-turn[data-tutor-chat-microphone] { display: flex; gap: 8px; }
    .tutor-chat-learner-turn[data-tutor-chat-microphone][hidden] { display: none; }
    .tutor-conversation-actions > span { margin-top: 1px; font-size: 11px; }
    /* 2026-10-15: V243, the review button slot keeps the size of Start new and Back to chat. */
    .tutor-conversation-actions > [data-tutor-review-action-slot] { margin-top: 0; font-size: inherit; }
    .tutor-conversation-composer { min-width: 0; overflow-wrap: anywhere; }
    .tutor-composer-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 15px; margin-bottom: 10px; }
    .tutor-composer-actions, .tutor-composer-audio { display: flex; align-items: center; gap: 5px; }
    .tutor-composer-audio { margin-left: auto; }
    .tutor-conversation-start > .tutor-conversation-invitation { margin-top: -20px; margin-left: 0; }
    .tutor-conversation-start > .tutor-conversation-actions { margin-top: 10px; margin-bottom: 10px; }
    .tutor-drawer-input { white-space: pre-wrap; }
    .tutor-tool-output-language { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .tutor-tool-output-language strong { flex-shrink: 0; }
    .tutor-tool-output-language select { flex: 0 1 auto; min-width: 0; width: auto; max-width: 100%; }
    .tutor-drawer-result { margin-top: 12px; }
    .tutor-diagnostic-report-drawer :where(ol, ul) { margin-block: 6px; padding-left: 1.2em; }
    .tutor-diagnostic-report-drawer { overflow-y: auto; overscroll-behavior: contain; }
    body[data-active-screen="tutor"]:has(.tutor-diagnostic-report-drawer) { overflow: hidden; }
    .tutor-settings-bridge { display: inline-flex; align-items: center; gap: 4px; background: transparent; color: var(--vscode-foreground); border-color: transparent; }
    .tutor-settings-bridge svg { width: 14px; height: 14px; }
    .tutor-heading-actions > .tutor-settings-bridge { width: auto; }
    .tutor-diagnostic-report-drawer > h2 { margin-top: 10px; margin-bottom: 10px; font-size: 25px; }
    .tutor-diagnostic-report-drawer > h2 + p,
    .tutor-diagnostic-report-drawer > h2 + p + p { margin-top: 5px; }
    .tutor-diagnostic-report-drawer > h2 + p { margin-bottom: 5px; }
    .tutor-diagnostic-report-drawer > h2 + p + p { margin-bottom: 10px; }
    .tutor-diagnostic-report-drawer > h3,
    .tutor-diagnostic-report-drawer > section > h3 { margin-top: 20px; margin-bottom: 10px; font-size: 18px; }
    .tutor-diagnostic-report-drawer .tutor-report-details > li > strong { margin-left: -2px; }
    .tutor-diagnostic-report-drawer > .settings-buttons { margin-top: 20px; }
    [data-tutor-practice-results] { --tutor-score-bar-width: clamp(4rem, 30vw, 10rem); }
    [data-tutor-target-result] { display: flex; align-items: center; gap: 12px; }
    [data-tutor-target-result] > p { min-width: 0; margin: 0; overflow-wrap: anywhere; }
    [data-tutor-target-result] meter { width: var(--tutor-score-bar-width); height: 1em; margin-left: auto; flex-shrink: 0; }
    [data-tutor-missed-items] { margin-top: 1em; }
    [data-tutor-missed-items] ol { margin-bottom: 0; padding-left: 0; list-style-position: inside; }
    [data-tutor-missed-items] ol > li + li { margin-top: 1em; }
    section[aria-label="Practice results"] > h3 { margin-top: 10px; margin-bottom: 10px; }
    [data-tutor-practice-results] > .tutor-item-actions > button { margin-top: 16px; }
    .tutor-exercises { margin-top: 16px; }
    .tutor-exercises > h2 { margin-top: 20px; margin-bottom: 15px; padding-top: 0; font-size: 1.2rem; }
    .tutor-exercises > p { margin-top: 0; }
    .tutor-exercises > section.tutor-lesson[aria-label="Practice results"] { margin-top: 15px; margin-left: 1px; }
    [data-tutor-target-result] meter::-webkit-meter-bar { background: var(--vscode-input-background); border-color: var(--vscode-panel-border); }
    [data-tutor-target-result] meter::-webkit-meter-optimum-value { background: var(--vscode-button-background); }
    /*
     * Report and missed-item lists put their marker at the drawer's own left edge, by construction.
     *
     * The details list is nested inside the numbered findings, so it cancels that list's
     * indent; the targets list is a direct child, so it simply has none. Stating them as one
     * rule is what stops them drifting apart, which is what the reader saw when only the
     * nested one was adjusted.
     */
    .tutor-report-details, .tutor-report-targets, .tutor-missed-details { margin-block: 0; padding-left: 0; list-style: disc inside; }
    /* A quarter em short of cancelling the numbered indent, so each disc sits under its
       number rather than 3px to its left. Measured in a rendered report on 2026-09-15. */
    .tutor-report-details { margin-left: -0.95em; }
    .tutor-report-targets { margin-left: .25em; }
    .tutor-report-details > li { margin: 0; padding: 0; }
    .tutor-missed-details > li { margin: 0; margin-left: 3px; padding: 0; }
    .tutor-missed-details > li:first-child { margin-top: 7px; }
    .tutor-content .icon-button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border-color: var(--vscode-button-border, transparent); }
    .tutor-content .icon-button:hover:where(:not(:disabled):not([aria-disabled="true"])) { color: var(--vscode-button-foreground); background: var(--vscode-button-hoverBackground); }
    .model-icon-button, .model-icon-button:hover:where(:not(:disabled):not([aria-disabled="true"])), .model-icon-button:active, .model-icon-button:focus, .tutor-content .model-icon-button, .tutor-content .model-icon-button:hover:where(:not(:disabled):not([aria-disabled="true"])), .tutor-content .model-icon-button:active, .tutor-content .model-icon-button:focus { color: var(--vscode-foreground); background: transparent; border-color: transparent; }
    .tutor-content .tutor-example-controls > .tutor-item-actions .icon-button, .tutor-content .tutor-exercise-controls > .tutor-item-actions .icon-button { color: var(--vscode-foreground); background: transparent; border-color: transparent; }
    .tutor-content .tutor-example-controls > .tutor-item-actions .icon-button:hover:where(:not(:disabled):not([aria-disabled="true"])), .tutor-content .tutor-exercise-controls > .tutor-item-actions .icon-button:hover:where(:not(:disabled):not([aria-disabled="true"])) { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
    .tutor-content .tutor-example-controls > .tutor-item-actions .icon-button:disabled:hover, .tutor-content .tutor-exercise-controls > .tutor-item-actions .icon-button:disabled:hover { background: transparent; }
    .tutor-content .tutor-exercise-controls > .tutor-item-actions .icon-button.tutor-dictation-active, .tutor-content .tutor-exercise-controls > .tutor-item-actions .icon-button.tutor-dictation-active:hover, .tutor-content .tutor-exercise-controls > .tutor-item-actions .icon-button.tutor-dictation-active:disabled:hover { color: var(--vscode-editor-background); background: var(--vscode-charts-red, var(--vscode-errorForeground)); }
    .tutor-content .icon-button.tutor-configuration-jump, .tutor-content .icon-button.tutor-configuration-jump:hover { color: var(--vscode-foreground); background: transparent; border-color: transparent; }
    .tutor-configuration-jump > svg { margin-top: 4px; margin-left: -8px; }
    .tutor-next-icon svg { transform: rotate(180deg); }
    .tutor-recipe { white-space: normal; }
    .tutor-recipe dt { margin-top: 6px; font-weight: 700; }
    .tutor-recipe dd { margin-left: 0; }
    ul { margin-top: 7px; }
    /* 2026-10-04: owner canvas spacing and typography, under the webview CSP. */
    .provider, .model-note, .captured-context h3, .credential-status { font-size: 13px; }
    .secondary.icon-button:where(:not(.tutor-content *)) { background-color: transparent; }
    textarea { padding: 4px !important; font-family: "Segoe WPC", "Segoe UI", sans-serif !important; }
    .dictionary-draft textarea, .tutor-conversation-custom textarea { padding: 6px 7px !important; }
    .welcome .privacy-note { font-size: 13px; }
    .welcome .credits { padding-left: 5px; }
    .welcome-step .welcome-status-item { background-color: transparent; border-color: transparent; position: relative; left: 0; top: 2px; }
    .welcome-first-run .welcome-status-item { top: 3px; }
    .same-language-warning { position: relative; left: 0; top: 10px; }
    .same-language-warning ~ .translation { position: relative; left: 0; top: 6px; }
    [data-settings-section="readAloud"] > .settings-intro { position: static; padding-top: 6px; }
    .dictionary-key-description { font-size: 13px; padding-bottom: 0; }
    .dictionary-key-note [data-action="kren.setMerriamWebsterCollegiateApiKey"] { position: relative; top: 8px; left: 0; }
    .settings-screen[data-settings-focus="all"] .dictionary-key-note .settings-buttons { padding-top: 6px; }
    .settings-screen[data-settings-focus="userDictionary"] .dictionary-key-note button { padding-top: 6px; }
    .credentials-screen > .settings-intro { font-size: 13px; }
    [data-language-model-usage] { overflow-wrap: anywhere; overflow-y: auto; border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 12px; margin-top: 16px; box-sizing: border-box; }
    [data-language-model-usage]:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
    [data-language-model-usage] > h3 { margin-top: 0; }
    .credential-label { color: var(--vscode-descriptionForeground); }
    .tutor-drawer > [data-command="closeTutorTool"] { position: absolute; top: 28px; right: 14px; margin: 0; }
    .tutor-tray { background: var(--vscode-editor-background); box-sizing: border-box; }
    .rewrite-group-fields > .tutor-tray { margin-left: -17px; }
    .tutor-tray-heading { padding-top: 12px; padding-bottom: 6px; }
    .tutor-tray-heading > strong, .tutor-tray > .tutor-tray-row, .tutor-tray > p { padding-left: 15px; padding-right: 6px; }
    .tutor-conversation-actions:not(.tutor-conversation-front-actions):has(> [data-command="startTutorConversationDemo"]) > button { width: 54px; box-sizing: border-box; padding-left: 6px !important; padding-right: 6px !important; }
    .tutor-conversation-front-actions { flex-wrap: nowrap; }
    .tutor-tray-actions button { width: 69px !important; height: 34px; padding: 6px 4px; white-space: nowrap; box-sizing: border-box; }
    .tutor-map-information { border-radius: 50% !important; }
    .credentials-screen .credential-row .tutor-map-information { background: var(--vscode-button-secondaryBackground); border: 0; }
    .credentials-screen .credential-row .tutor-map-information:hover:where(:not(:disabled):not([aria-disabled="true"])) { background: var(--vscode-button-secondaryHoverBackground); }
    .credentials-screen .credential-row .tutor-map-information:not(:focus-visible) { outline: none; }
    .icon-button[data-command="dictateTutorConversation"] { width: 32px; height: 32px; min-width: 32px; padding: 0; border-radius: 50% !important; }
    .icon-button[data-tutor-chat-stop] { width: 32px; height: 32px; min-width: 32px; padding: 0; border-radius: 50%; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    .tutor-tray-row .icon-button { background-color: transparent; border-color: transparent; color: var(--vscode-foreground); }
    .tutor-content .tutor-tray-row .icon-button:hover:where(:not(:disabled):not([aria-disabled="true"])) { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
    .tutor-drawer-input { padding-top: 4px; position: relative; top: 12px; }
    .tutor-drawer > .tutor-item-actions { padding-top: 16px; padding-bottom: 16px; }
    .tutor-ask-answer ul { padding-left: 16px; }
    .tutor-tool-output-language { position: relative; left: 0; top: 12px; }
    .tutor-output-language-note { font-weight: normal; }
    .tutor-tray-actions [data-tutor-no-target][data-tutor-role="primary"] { padding-top: 6px; }
    [data-draft-capture-mode] { position: relative; top: 8px; }
    .dictionary-draft > .model-note, .user-dictionary-screen > p.model-note { padding-top: 10px; padding-bottom: 10px; }
    .dictionary-draft .duplicate-notice { padding-bottom: 22px; }
    .dictionary-draft .duplicate-notice button { position: relative; top: 10px; }
    .dictionary-draft .duplicate-notice [data-command="openExistingUserDictionaryEntry"], .dictionary-draft .duplicate-notice [data-command="cancelUserDictionaryDraft"] { padding-top: 6px; }
    .user-dictionary-screen > .settings-buttons [data-command="exportUserDictionary"], .user-dictionary-screen > .settings-buttons [data-command="previewUserDictionaryImport"] { padding-bottom: 6px; padding-left: 11px; position: relative; left: 62px; }
    .user-dictionary-screen [data-command="previewUserDictionaryPurge"] { width: 120px; position: relative; left: 10px; }
    .dictionary-filter-empty-note { position: relative; }
    @media (max-width: 520px) { body { padding: 10px; } .intro-header { align-items: center; } .provider { text-align: left; } .welcome-layout, .dictionary-layout { grid-template-columns: 1fr; } .capability-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 380px) { .capability-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body data-active-screen="${escapeHtml(options.activeScreen ?? 'result')}"${busyNotice ? ' data-busy' : ''}${options.focusSettingsSection ? ` data-focus-section="${escapeHtml(options.focusSettingsSection)}"` : ''}${options.focusTutorTargetId ? ` data-focus-tutor-target="${escapeHtml(options.focusTutorTargetId)}"` : ''}${options.focusTutorResult ? ` data-focus-tutor-result="${escapeHtml(options.focusTutorResult)}"` : ''}${options.focusTutorConversation ? ' data-focus-tutor-conversation="true"' : ''}${options.tutorResetDisclosures ? ' data-tutor-reset-disclosures="true"' : ''}${options.tutorAnnouncement ? ` data-tutor-announcement="${escapeHtml(options.tutorAnnouncement)}"` : ''}>
  ${busyNotice ? `<div class="busy-overlay" role="alert" aria-live="assertive"><div class="${panelPopupCardClass(busyNotice)}"><span class="busy-spinner" aria-hidden="true"></span><span class="popup-message">${escapeHtml(busyNotice)}</span>${busyCancel ? `<button type="button" class="secondary" data-command="${escapeHtml(busyCancel.command)}"${busyCancel.attribute}>${escapeHtml(busyCancel.label ?? 'Cancel')}</button>` : ''}</div></div>` : ''}
  <main class="shell">
    <section id="result-screen" class="result-screen${options.activeScreen === 'settings' || options.activeScreen === 'credentials' || options.activeScreen === 'manual' || options.activeScreen === 'userDictionary' || options.activeScreen === 'tutor' || options.activeScreen === 'updates' ? ' hidden' : ''}">${body}</section>
    <section id="updates-screen" class="settings-screen${options.activeScreen === 'updates' ? '' : ' hidden'}">${renderHeader('', false, options.brandImageUri, false, hasHeldResult)}${renderEnvironmentChecks(options.environmentItems ?? [], options.environmentBusy === true)}</section>
    <section id="settings-screen" class="settings-screen${options.activeScreen === 'settings' ? '' : ' hidden'}" data-settings-focus="${escapeHtml(options.focusSettingsSection ?? 'all')}">${grayCredentialRoutingMarkup(settingsView, options.settings.credentialPresence ?? {})}</section>
    <section id="credentials-screen" class="settings-screen credentials-screen${options.activeScreen === 'credentials' ? '' : ' hidden'}">${renderCredentials(options.settings, options.brandImageUri, hasHeldResult, options.credentialHelpOpen)}</section>
    <section id="manual-screen" class="manual-screen${options.activeScreen === 'manual' ? '' : ' hidden'}">${manualView}</section>
    <section id="user-dictionary-screen" class="user-dictionary-screen${options.activeScreen === 'userDictionary' ? '' : ' hidden'}">${userDictionaryView}</section>
    <section id="tutor-screen" class="tutor-screen${options.activeScreen === 'tutor' ? '' : ' hidden'}">${grayCredentialRoutingMarkup(tutorView, options.settings.credentialPresence ?? {})}${options.tutorAnnouncement ? '<p class="tutor-screen-reader-status" data-tutor-live role="status" aria-live="polite"></p>' : ''}</section>
    <audio id="kren-audio" class="${audioClass}" controls ${initialAudio}></audio>
  </main>
  <script data-kren-errors nonce="${options.nonce}">
    ${panelScriptErrorScript()}
  </script>
  <script nonce="${options.nonce}">
    function applyPanelTheme(message) {
      if (!['followVSCode', 'light', 'dark'].includes(message.theme) ||
          !['light', 'dark'].includes(message.kind)) return;
      const root = document.documentElement;
      if (message.theme === 'followVSCode') root.removeAttribute('data-kren-theme');
      else root.setAttribute('data-kren-theme', message.theme);
      const kind = message.theme === 'followVSCode' ? message.kind : message.theme;
      root.setAttribute('data-kren-kind', kind);
      const label = kind === 'light' ? 'Switch to dark view' : 'Switch to light view';
      document.querySelectorAll('[data-command="toggleTheme"]').forEach(button => {
        button.setAttribute('title', label);
        button.setAttribute('aria-label', label);
      });
      document.querySelectorAll('[data-setting="display.panelTheme"]').forEach(control => {
        control.value = message.theme;
      });
    }
    const vscode = acquireVsCodeApi();
    function sizeLanguageModelUsage() {
      const box = document.querySelector('[data-language-model-usage]');
      if (!box) return;
      const rows = box.querySelectorAll('ul > li');
      if (rows.length <= 8) {
        box.style.maxHeight = '';
        return;
      }
      const style = getComputedStyle(box);
      const height = rows[7].getBoundingClientRect().bottom - box.getBoundingClientRect().top + box.scrollTop
        + (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.borderBottomWidth) || 0);
      if (height > 0) box.style.maxHeight = Math.ceil(height) + 'px';
    }
    function tutorConversationAdvancedSummary(values) {
      return (${tutorConversationAdvancedSummary.toString().replace(/\n/g, '\n      ')})(values);
    }
    // The extension replaces this document wholesale on every render, so anything the
    // reader adjusted here is gone unless it is written to webview state, which survives
    // the replacement. Two things were being lost on every setting change: which top-level
    // sections were folded, so a section the reader had closed sprang back open, and the
    // scroll position, so changing one setting threw them back to the top of the page.
    function panelState() {
      const stored = vscode.getState();
      return stored && typeof stored === 'object' ? stored : {};
    }
    function savePanelState(patch) {
      vscode.setState({ ...panelState(), ...patch });
    }
    const restored = panelState();
    const focusUpdateDestination = ${focusEnvironmentFix.toString()};
    const openSections = restored.openSections && typeof restored.openSections === 'object'
      ? restored.openSections
      : {};
    function tutorReportKeepsMapOpen(section) {
      return ${Boolean(tutorState?.diagnosticReport)} && section.getAttribute('data-persist-id') === 'tutor-map';
    }
    // Several tutor sections may have been open in an earlier saved state. Independent
    // disclosures retain those choices, except that a held report must stay reachable.
    let forcedSectionState = false;
    document.querySelectorAll('details[data-persist-id]').forEach((section) => {
      const id = section.getAttribute('data-persist-id');
      const stored = openSections[id];
      if (section.getAttribute('data-force-open') === 'true') {
        section.open = true;
        openSections[id] = true;
        forcedSectionState = true;
      } else if (section.getAttribute('data-force-closed') === 'true') {
        section.open = false;
        openSections[id] = false;
        forcedSectionState = true;
      } else if (tutorReportKeepsMapOpen(section)) {
        section.open = true;
        openSections[id] = true;
      } else if (typeof stored === 'boolean') section.open = stored;
    });
    // 2026-10-10: First open shares Reset everything's sole unfolded section.
    const initialTutorDisclosures = !restored.openSections;
    // 2026-10-15: A reset survives document replacements until the panel has saved it.
    const tutorResetDisclosure = ${JSON.stringify(options.tutorResetDisclosure ?? null)};
    const newTutorResetDisclosure = tutorResetDisclosure && restored.tutorResetDisclosureId !== tutorResetDisclosure.id;
    const resetTutorDisclosures = ${Boolean(options.tutorResetDisclosures)} || newTutorResetDisclosure;
    const resetAllTutorDisclosures = ${Boolean(options.tutorResetAllDisclosures)} || (newTutorResetDisclosure && tutorResetDisclosure.all);
    if (resetAllTutorDisclosures || initialTutorDisclosures) {
      Object.keys(openSections).filter((id) => id.startsWith('tutor-')).forEach((id) => { openSections[id] = false; });
      document.querySelectorAll('.tutor-content details').forEach((section) => {
        section.open = false;
        const id = section.getAttribute('data-persist-id');
        if (id) openSections[id] = false;
      });
      forcedSectionState = true;
    } else if (resetTutorDisclosures) {
      ['tutor-lesson', 'tutor-channel', 'tutor-subject', 'tutor-register', 'tutor-shape', 'tutor-intent', 'tutor-conversation-mode', 'tutor-conversation-advanced', 'tutor-setting'].forEach((id) => {
        const section = document.querySelector('details[data-persist-id="' + id + '"]');
        if (section instanceof HTMLDetailsElement) section.open = false;
        openSections[id] = false;
      });
      forcedSectionState = true;
    }
    if (resetTutorDisclosures || resetAllTutorDisclosures || initialTutorDisclosures) {
      // Changed 2026-10-03: both resets return the reader to the open learning map.
      const map = document.querySelector('details[data-persist-id="tutor-map"]');
      if (map instanceof HTMLDetailsElement) map.open = true;
      openSections['tutor-map'] = true;
    }
    if (forcedSectionState) savePanelState({ openSections: { ...openSections },
      ...(newTutorResetDisclosure ? { tutorResetDisclosureId: tutorResetDisclosure.id } : {}) });
    function syncTutorConversationFrontActions() {
      const mode = document.querySelector('details[data-persist-id="tutor-conversation-mode"]');
      const row = document.querySelector('[data-tutor-conversation-entry-actions]');
      if (!(mode instanceof HTMLDetailsElement) || !row) return;
      row.classList.toggle('tutor-conversation-front-actions', !mode.open);
      row.querySelector('[data-tutor-open-conversation-settings]').hidden = mode.open;
      row.querySelector('[data-command="resetTutorConversationDefaults"]').hidden = !mode.open;
    }
    syncTutorConversationFrontActions();
    // The toggle event does not bubble, so this listens in the capture phase, where a
    // non-bubbling event still reaches an ancestor.
    document.addEventListener('toggle', (event) => {
      const section = event.target;
      if (!(section instanceof HTMLDetailsElement)) return;
      const id = section.getAttribute('data-persist-id');
      if (!id) return;
      if (id === 'tutor-conversation-mode') syncTutorConversationFrontActions();
      savePanelState({ openSections: { ...openSections, [id]: section.open } });
      openSections[id] = section.open;
    }, true);
    const activeScreen = document.body.getAttribute('data-active-screen') || '';
    window.addEventListener('message', event => {
      if (event.data?.command === 'systemUpdatesStatus') {
        document.querySelector('[data-system-updates]')?.classList.toggle('hidden', event.data.available !== true);
      }
    });
    let tutorPictureRequestPending = false;
    let tutorPictureCheckedTurn = -1;
    const scrollingTranscript = document.querySelector('[data-tutor-transcript]');
    if (scrollingTranscript instanceof HTMLElement) {
      let followLatestTurn = true;
      scrollingTranscript.addEventListener('scroll', () => {
        followLatestTurn = scrollingTranscript.scrollHeight - scrollingTranscript.scrollTop -
          scrollingTranscript.clientHeight <= 32;
        syncTutorStoryboardScroll();
      }, { passive: true });
      const showLatestTurn = () => {
        if (followLatestTurn) scrollingTranscript.scrollTop = scrollingTranscript.scrollHeight;
        syncTutorStoryboardScroll();
      };
      new MutationObserver(showLatestTurn).observe(scrollingTranscript, {
        childList: true, characterData: true, subtree: true
      });
      showLatestTurn();
    }
    window.addEventListener('resize', () => {
      syncTutorStoryboardScroll();
    });
    function syncTutorActionWidth() {
      const actions = Array.from(document.querySelectorAll('[data-tutor-shared-action]'));
      if (actions.length === 0) return;
      document.documentElement.style.removeProperty('--tutor-shared-action-width');
      const widest = Math.ceil(Math.max(...actions.map((action) =>
        action instanceof HTMLElement ? action.getBoundingClientRect().width : 0
      )));
      if (widest > 0) {
        document.documentElement.style.setProperty('--tutor-shared-action-width', widest + 'px');
      }
    }
    if (activeScreen === 'tutor') {
      syncTutorActionWidth();
      void document.fonts.ready.then(syncTutorActionWidth);
    }
    // Restored only on the screens whose content is the same document from one render to
    // the next. The result screen is not one of them: a render there is usually a new
    // result, and restoring the previous scroll would open it part way down with its own
    // first lines above the fold.
    const scrollIsStable = activeScreen === 'settings' || activeScreen === 'credentials' || activeScreen === 'manual' ||
      activeScreen === 'userDictionary' || activeScreen === 'tutor';
    // 2026-10-24: V310. A routing dropdown makes the host replace this document and patch the
    // settings block. The position was saved only by the debounced scroll event below, so a
    // change inside that window restored an older one, and the patch moved it unseen. A change
    // now saves the position before any handler posts, and a patch runs inside holdScroll.
    // 2026-10-24: V311. A change also records where its control sits on screen, for restoreScroll.
    function saveScrollNow(event) {
      if (!scrollIsStable) return;
      const control = event?.target;
      const attribute = control instanceof HTMLElement
        ? ['data-model-preset', 'data-setting'].find((name) => control.hasAttribute(name)) : undefined;
      const selector = attribute ? control.tagName.toLowerCase() + '[' + attribute + '=' + JSON.stringify(control.getAttribute(attribute)) + ']' : '';
      const anchor = selector ? { selector, index: Array.from(document.querySelectorAll(selector)).indexOf(control),
        offset: control.getBoundingClientRect().top } : undefined;
      savePanelState({ scroll: { screen: activeScreen, top: window.scrollY, ...(anchor ? { anchor } : {}) } });
    }
    function holdScroll(update) {
      const left = window.scrollX;
      const top = window.scrollY;
      update();
      if (window.scrollX !== left || window.scrollY !== top) window.scrollTo(left, top);
    }
    window.addEventListener('change', saveScrollNow, true);
    let scrollTimer = 0;
    let scrollRestorePending = false;
    if (scrollIsStable) {
      window.addEventListener('scroll', () => {
        window.clearTimeout(scrollTimer);
        scrollTimer = window.setTimeout(() => {
          savePanelState({ scroll: { screen: activeScreen, top: window.scrollY } });
        }, 120);
      }, { passive: true });
    }
    const focusSection = document.body.getAttribute('data-focus-section');
    const focusTutorResult = document.body.getAttribute('data-focus-tutor-result');
    const focusTutorConversation = document.body.getAttribute('data-focus-tutor-conversation');
    const focusTutorConversationSetup = document.querySelector(
      '[data-tutor-conversation-setup][data-focus-after-render="true"]'
    );
    const updateTarget = restored.updateFixTarget;
    if (typeof updateTarget === 'string' && activeScreen === (updateTarget === 'tutor' || updateTarget === 'tutorVoice' ? 'tutor' : 'settings') &&
        focusUpdateDestination(document, updateTarget)) {
      savePanelState({ updateFixTarget: undefined });
    } else if (focusSection) {
      // A gear beside a result asked for one section. Showing it beats restoring wherever
      // the reader happened to be last time, so this wins over the scroll restore.
      const target = document.querySelector('[data-settings-section="' + focusSection + '"]');
      if (target instanceof HTMLElement) {
        if (target instanceof HTMLDetailsElement) target.open = true;
        target.scrollIntoView({ block: 'start' });
      }
    } else if (activeScreen === 'tutor' && focusTutorResult && !resetTutorDisclosures && !resetAllTutorDisclosures) {
      // A successful generation owns exactly one render. Close the configuration parents
      // except the map while it holds the only report opener,
      // persist that new disclosure state, and bring only the new result into view. Later
      // renders carry no focus attribute, so a reader who scrolls away is left alone.
      document.querySelectorAll('details[data-tutor-parent]').forEach((section) => {
        if (!(section instanceof HTMLDetailsElement)) return;
        if (tutorReportKeepsMapOpen(section)) return;
        section.open = false;
        const id = section.getAttribute('data-persist-id');
        if (id) openSections[id] = false;
      });
      savePanelState({ openSections: { ...openSections } });
      const target = document.querySelector('[data-tutor-result="' + focusTutorResult + '"]');
      if (target instanceof HTMLElement) target.scrollIntoView({ block: 'start' });
    } else if (activeScreen === 'tutor' && focusTutorConversation === 'true') {
      // Starting replaces the setup button with the conversation. Give that one render its
      // own destination so saved scroll cannot land in unfolded configuration below it.
      const target = document.querySelector('[data-tutor-result="conversation"]');
      if (target instanceof HTMLElement) target.scrollIntoView({ block: 'start' });
    } else if (activeScreen === 'tutor' && focusTutorConversationSetup instanceof HTMLElement) {
      focusTutorConversationSetup.scrollIntoView({ block: 'start' });
    } else if (scrollIsStable && restored.scroll && restored.scroll.screen === activeScreen &&
        typeof restored.scroll.top === 'number') {
      scrollRestorePending = true;
    }
    // 2026-10-24: V311. Measured in Edge, the restore ran here, before applyConditionalSettings at
    // the end of the script hid 191 px of rows above the Live rows, so scroll anchoring pulled the
    // view up towards Provider; and Provider, which shortens the summary above it, restored 19 px
    // off. So restoreScroll runs on the final layout and puts a just-changed control back in place.
    function restoreScroll() {
      window.scrollTo(0, restored.scroll.top);
      const anchor = restored.scroll.anchor;
      if (!anchor) return;
      const control = typeof anchor.selector === 'string' ? document.querySelectorAll(anchor.selector)[anchor.index] : undefined;
      const box = control instanceof HTMLElement ? control.getBoundingClientRect() : undefined;
      if (box && (box.width > 0 || box.height > 0) && typeof anchor.offset === 'number') {
        const shift = box.top - anchor.offset;
        if (Math.abs(shift) >= 1) window.scrollTo(0, Math.round(window.scrollY + shift));
      }
      // Used once: a later document restores the position this one settled on.
      savePanelState({ scroll: { screen: activeScreen, top: window.scrollY } });
    }
    const focusTutorTarget = document.body.getAttribute('data-focus-tutor-target');
    if (activeScreen === 'tutor' && focusTutorTarget) {
      const target = Array.from(document.querySelectorAll('[data-tutor-target-row]'))
        .find((candidate) => candidate.getAttribute('data-tutor-target-row') === focusTutorTarget);
      if (target instanceof HTMLElement) target.focus({ preventScroll: true });
    }
    if (activeScreen === 'tutor') document.querySelector('.tutor-diagnostic-report-drawer')?.focus({ preventScroll: true });
    const tutorAnnouncement = document.body.getAttribute('data-tutor-announcement');
    const tutorLiveRegion = document.querySelector('[data-tutor-live]');
    if (tutorAnnouncement && tutorLiveRegion instanceof HTMLElement) {
      window.setTimeout(() => { tutorLiveRegion.textContent = tutorAnnouncement; }, 0);
    }
    const player = document.getElementById('kren-audio');
    let playerMode = 'idle';
    let generatedAudioGeneration = 0;
    let generatedAudioPlaybackId;
    function allowedPronunciationUrl(value) {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' &&
          url.hostname === 'media.merriam-webster.com' &&
          url.pathname.startsWith('/audio/prons/en/us/mp3/') &&
          url.pathname.endsWith('.mp3');
      } catch {
        return false;
      }
    }
    async function playPronunciation(audioUrl, reportPlayback) {
      if (!(player instanceof HTMLAudioElement) || !allowedPronunciationUrl(audioUrl)) {
        if (reportPlayback) vscode.postMessage({ command: 'pronunciationFailed' });
        return;
      }
      generatedAudioGeneration++;
      player.src = audioUrl;
      player.volume = 1;
      playerMode = 'pronunciation';
      player.classList.remove('hidden');
      try {
        await player.play();
        if (reportPlayback) vscode.postMessage({ command: 'pronunciationStarted' });
      } catch {
        if (reportPlayback) vscode.postMessage({ command: 'pronunciationFailed' });
      }
    }
    const tutorTextSegments = ${tutorMarkedSegments.toString()};
    const tutorCoachHighlights = ${tutorConversationCoachHighlights.toString()};
    function patchTutorCoachText(paragraph, text) {
      let end = 0;
      const nodes = [];
      for (const range of tutorCoachHighlights(text).ranges) {
        nodes.push(document.createTextNode(text.slice(end, range.start)));
        const expression = document.createElement('strong');
        expression.className = 'tutor-review-corrected';
        expression.textContent = text.slice(range.start, range.end);
        nodes.push(expression);
        end = range.end;
      }
      nodes.push(document.createTextNode(text.slice(end)));
      paragraph.replaceChildren(...nodes);
    }
    function patchTutorMarkedText(paragraph, text, ranges, quote) {
      if (!(paragraph instanceof HTMLParagraphElement)) return;
      if (paragraph.hasAttribute('data-tutor-coach-reply') ||
          document.querySelector('[data-tutor-conversation-from]')?.value === 'speakAndRephrase') {
        paragraph.setAttribute('data-tutor-coach-reply', '');
        patchTutorCoachText(paragraph, text);
        return;
      }
      paragraph.setAttribute('data-tutor-target-ranges', JSON.stringify(ranges || []));
      paragraph.replaceChildren(...tutorTextSegments(text, ranges || [], quote || '').map((segment) => {
        let node = document.createTextNode(segment.text);
        if (segment.target) {
          const target = document.createElement('span');
          target.className = 'tutor-target-use';
          target.setAttribute('data-tutor-target-use', '');
          target.appendChild(node);
          node = target;
        }
        if (segment.correction) {
          const correction = document.createElement('strong');
          correction.className = 'tutor-reply-quote';
          correction.setAttribute('data-tutor-reply-quote', '');
          correction.appendChild(node);
          node = correction;
        }
        return node;
      }));
    }
    function appendTutorLiveReply(message) {
      if (typeof message.text !== 'string') return;
      const transcript = document.querySelector('[data-tutor-transcript]');
      if (!(transcript instanceof HTMLElement)) return;
      const committed = Number.isInteger(message.index);
      if (!committed) {
        hideTutorChatMicrophone();
        transcript.setAttribute('data-tutor-live-reply-pending', 'true');
      }
      // A new reply retires every earlier live bubble. 1.64.0 kept the mark on the opening, and
      // querySelector returns the first match, so each reply's later sentences landed there.
      const liveBubbles = transcript.querySelectorAll('[data-tutor-live-reply]');
      if (message.reset === true) {
        for (const old of liveBubbles) old.removeAttribute('data-tutor-live-reply');
      }
      let bubble = committed ? transcript.querySelector('[data-tutor-reply-turn="' + message.index + '"]')
        : message.reset === true ? undefined : liveBubbles[liveBubbles.length - 1];
      if (committed && !(bubble instanceof HTMLElement)) return;
      if (!(bubble instanceof HTMLElement)) {
        const replacement = document.createElement('div');
        replacement.className = 'tutor-chat-kren';
        replacement.setAttribute('data-tutor-kren-bubble', '');
        replacement.setAttribute('data-tutor-live-reply', '');
        replacement.setAttribute('data-tutor-reply-bubble', '');
        replacement.setAttribute('role', 'group');
        replacement.setAttribute('aria-label', 'KREN');
        replacement.appendChild(document.createElement('p'));
        const typing = transcript.querySelector('[data-tutor-typing]');
        // 2026-10-02: A reply belongs to its learner, even if the next input starts before commit.
        const learner = transcript.querySelector('[data-tutor-pending]');
        if (learner instanceof HTMLElement) {
          replacement.setAttribute('data-tutor-reply-turn', learner.getAttribute('data-tutor-learner-turn') || 'pending');
        }
        if (typing) typing.replaceWith(replacement);
        else if (learner instanceof HTMLElement) {
          const next = Array.from(transcript.children)[Array.from(transcript.children).indexOf(learner) + 1];
          if (next) transcript.insertBefore(replacement, next);
          else transcript.appendChild(replacement);
        } else transcript.appendChild(replacement);
        bubble = replacement;
      }
      const paragraph = bubble.querySelector('p');
      if (!(paragraph instanceof HTMLParagraphElement)) return;
      paragraph.textContent = message.replace === true
        ? message.text
        : (paragraph.textContent || '') + message.text;
      bubble.setAttribute('data-tutor-reply-text', paragraph.textContent || '');
      patchTutorMarkedText(paragraph, paragraph.textContent || '', message.targetRanges, message.replyQuote || '');
    }
    function appendTutorConversationDemoLine(message) {
      if ((message?.speaker !== 'male' && message?.speaker !== 'female') ||
          typeof message?.name !== 'string' || typeof message?.text !== 'string') return;
      const transcript = document.querySelector('[data-tutor-transcript]');
      if (!(transcript instanceof HTMLElement)) return;
      const bubble = document.createElement('div');
      bubble.className = 'tutor-chat-demo tutor-chat-demo-' + message.speaker;
      bubble.setAttribute('data-tutor-demo-bubble', '');
      bubble.setAttribute('data-tutor-demo-speaker', message.speaker);
      bubble.setAttribute('role', 'group');
      bubble.setAttribute('aria-label', message.name);
      const name = document.createElement('strong');
      name.className = 'tutor-chat-demo-name';
      name.textContent = message.name;
      const paragraph = document.createElement('p');
      patchTutorMarkedText(paragraph, message.text, message.targetRanges, '');
      bubble.append(name, paragraph);
      transcript.appendChild(bubble);
    }
    function appendTutorLiveInput(message) {
      if (typeof message.text !== 'string') return;
      const transcript = document.querySelector('[data-tutor-transcript]');
      if (!(transcript instanceof HTMLElement)) return;
      // 2026-10-01: Remember first audio even while picture mode hides its hearing dots.
      // The picture can disappear before the first transcription fragment arrives.
      if (message.started === true) transcript.setAttribute('data-tutor-live-input-awaiting-text', 'true');
      else if (message.text) transcript.removeAttribute('data-tutor-live-input-awaiting-text');
      // 2026-10-01: In the shown Live picture, keep the microphone until words arrive.
      // First audio alone must not replace it with the hearing dots.
      if (tutorPictureMicrophoneMode() && message.started === true) return;
      const liveTurns = transcript.querySelectorAll('[data-tutor-live-input]');
      const startedTurn = liveTurns[liveTurns.length - 1];
      const reusesStartedTurn = message.reset === true && message.started !== true &&
        startedTurn instanceof HTMLElement &&
        startedTurn.getAttribute('data-tutor-live-input-started') === 'true';
      if (message.reset === true && !reusesStartedTurn) {
        for (const old of liveTurns) old.removeAttribute('data-tutor-live-input');
      }
      let turn = message.reset === true && !reusesStartedTurn ? undefined : startedTurn;
      if (reusesStartedTurn && turn instanceof HTMLElement) {
        turn.removeAttribute('data-tutor-live-input-started');
      }
      let created = false;
      if (!(turn instanceof HTMLElement)) {
        const replacement = document.createElement('div');
        replacement.className = 'tutor-chat-learner-turn';
        replacement.setAttribute('data-tutor-pending', '');
        replacement.setAttribute('data-tutor-live-input', '');
        if (message.started === true) {
          replacement.setAttribute('data-tutor-live-input-started', 'true');
        }
        replacement.setAttribute('aria-busy', 'true');
        const bubble = document.createElement('div');
        bubble.className = 'tutor-chat-learner';
        bubble.setAttribute('role', 'group');
        bubble.setAttribute('aria-label', 'You, speaking');
        const paragraph = document.createElement('p');
        paragraph.setAttribute('data-tutor-learner-answer', '');
        if (message.started === true) {
          paragraph.className = 'tutor-chat-typing';
          for (let index = 0; index < 3; index += 1) {
            const dot = document.createElement('span');
            dot.className = 'tutor-typing-dot';
            dot.setAttribute('aria-hidden', 'true');
            dot.textContent = '.';
            paragraph.appendChild(dot);
          }
        }
        bubble.appendChild(paragraph);
        replacement.appendChild(bubble);
        const reply = transcript.querySelector('[data-tutor-live-reply]');
        // 2026-10-02: Only a reply awaiting its own input is an insertion anchor.
        if (reply instanceof HTMLElement && !reply.hasAttribute('data-tutor-reply-turn')) transcript.insertBefore(replacement, reply);
        else {
          const control = transcript.querySelector('[data-tutor-chat-microphone]');
          if (control) transcript.insertBefore(replacement, control);
          else transcript.appendChild(replacement);
        }
        turn = replacement;
        created = true;
      }
      const paragraph = turn.querySelector('[data-tutor-learner-answer]');
      if (paragraph instanceof HTMLParagraphElement) {
        if (message.started !== true) {
          if (paragraph.classList.contains('tutor-chat-typing')) {
            paragraph.classList.remove('tutor-chat-typing');
            paragraph.textContent = '';
          }
          paragraph.textContent = (paragraph.textContent || '') + message.text;
        }
      }
      syncTutorPictureMicrophone();
      if (created) vscode.postMessage({ command: 'tutorLiveInputBubblePatched' });
    }
    function patchTutorPartialHearing(turn, message) {
      if (message.partiallyHeard !== true || turn.querySelector('[data-tutor-partially-heard]')) return;
      const note = document.createElement('p');
      note.className = 'tutor-turn-check-failed';
      note.setAttribute('data-tutor-partially-heard', '');
      note.textContent = 'Part of this turn could not be heard as English.';
      turn.appendChild(note);
    }
    function commitTutorLiveInput(message) {
      document.querySelector('[data-tutor-transcript]')?.removeAttribute('data-tutor-live-input-awaiting-text');
      const turn = document.querySelector('[data-tutor-learner-turn="' + message.index + '"]') ||
        document.querySelector('[data-tutor-live-input]');
      if (!(turn instanceof HTMLElement)) return;
      const paragraph = turn.querySelector('[data-tutor-learner-answer]');
      if (paragraph instanceof HTMLParagraphElement && typeof message.text === 'string') {
        paragraph.textContent = message.text;
      }
      turn.removeAttribute('data-tutor-live-input');
      turn.removeAttribute('aria-busy');
      if (Number.isInteger(message.index)) {
        turn.setAttribute('data-tutor-learner-turn', String(message.index));
        const reply = document.querySelector('[data-tutor-live-reply]');
        if (reply instanceof HTMLElement && (!reply.hasAttribute('data-tutor-reply-turn') ||
            reply.getAttribute('data-tutor-reply-turn') === 'pending')) {
          reply.setAttribute('data-tutor-reply-turn', String(message.index));
        }
      }
      turn.querySelector('.tutor-chat-learner')?.setAttribute('aria-label', 'You');
      if (message.partiallyHeard === true) patchTutorPartialHearing(turn, message);
      if (message.learnerNotShown === true) {
        document.querySelector('[data-tutor-reply-turn="' + message.index + '"]')?.remove();
        document.querySelector('[data-tutor-typing]')?.remove();
        turn.replaceChildren();
        const note = document.createElement('p');
        note.className = 'tutor-turn-check-failed';
        note.setAttribute('data-tutor-learner-not-shown', '');
        note.textContent = 'Not in English, so not shown.';
        turn.appendChild(note);
      }
    }
    function discardTutorLiveInput() {
      document.querySelector('[data-tutor-live-input]')?.remove();
      document.querySelector('[data-tutor-transcript]')?.removeAttribute('data-tutor-live-input-awaiting-text');
    }
    function cancelTutorLiveTurn(message) {
      document.querySelector('[data-tutor-transcript]')?.removeAttribute('data-tutor-live-input-awaiting-text');
      const pending = document.querySelector('[data-tutor-pending]');
      if (pending instanceof HTMLElement) pending.remove();
      const unfinishedReply = document.querySelector('[data-tutor-live-reply]') ??
        document.querySelector('[data-tutor-typing]');
      if (unfinishedReply instanceof HTMLElement) unfinishedReply.remove();
      const answer = document.querySelector('[data-tutor-conversation-answer]');
      if (answer instanceof HTMLTextAreaElement && typeof message?.answer === 'string') {
        answer.value = message.answer;
        answer.disabled = false;
      }
      markTutorLiveConversationReady({ talkAvailable: false, replayAvailable: false });
    }
    function updateTutorLiveTalk(message) {
      const replay = document.querySelector('[data-command="replayTutorQuestion"]');
      if (replay instanceof HTMLButtonElement && (message?.standardFallback === true || message?.available === true)) {
        replay.setAttribute('data-tutor-standard-fallback', String(message?.standardFallback === true));
        updateTutorReplayMode();
      }
      const microphone = document.querySelector('[data-tutor-chat-mic-control]') ??
        document.querySelector('[data-command="dictateTutorConversation"]');
      if (!(microphone instanceof HTMLButtonElement)) return;
      const available = message?.available === true;
      const listening = available && message?.listening === true;
      if (available) {
        microphone.innerHTML = ${JSON.stringify(iconSvgMarkup('microphone'))};
        const pressToTalk = message?.pressToTalk === true ||
          microphone.getAttribute('data-tutor-press-to-talk') === 'true';
        microphone.setAttribute('data-tutor-live-talk', 'true');
        microphone.setAttribute('data-tutor-dictation-route-unavailable', 'false');
        microphone.setAttribute('data-tutor-press-to-talk', String(pressToTalk));
        microphone.setAttribute('data-tutor-dictation-provider', 'live');
        const label = pressToTalk
          ? listening ? 'Press when you finish' : 'Press to talk'
          : listening ? 'Stop talking' : 'Talk to KREN';
        microphone.setAttribute('aria-pressed', String(listening));
        microphone.setAttribute('aria-label', label);
        microphone.title = label;
        microphone.disabled = false;
        microphone.classList.toggle('tutor-dictation-active', listening);
        microphone.classList.toggle('tutor-microphone-pulsing', listening);
        syncTutorPictureMicrophone();
        return;
      }
      if (message?.standardFallback === true) {
        microphone.setAttribute('data-tutor-dictation-route-unavailable', String(message.dictationUnavailable === true));
        microphone.setAttribute('data-tutor-dictation-provider', message.dictationProvider ?? '');
      }
      const replies = document.querySelector('[data-tutor-conversation-replies]');
      const liveUnavailable = replies instanceof HTMLSelectElement && replies.value === 'liveGemini' && message?.standardFallback !== true;
      if (microphone.getAttribute('data-tutor-live-talk') === 'true' || liveUnavailable) {
        microphone.innerHTML = ${JSON.stringify(iconSvgMarkup('microphone'))};
        microphone.setAttribute('data-tutor-live-talk', 'false');
        microphone.setAttribute('aria-pressed', 'false');
        const label = liveUnavailable
          ? 'Live microphone is unavailable'
          : message?.dictationUnavailable === true ? 'Speech input is unavailable' : 'Speak your conversation answer';
        microphone.setAttribute('aria-label', label);
        microphone.title = label;
        microphone.classList.remove('tutor-dictation-active');
        microphone.classList.remove('tutor-microphone-pulsing');
        if (liveUnavailable) {
          microphone.setAttribute('data-tutor-dictation-route-unavailable', 'true');
          microphone.disabled = true;
        } else {
          microphone.disabled = microphone.getAttribute('data-tutor-dictation-route-unavailable') === 'true';
        }
        microphone.setAttribute('data-tutor-dictation-disabled', String(microphone.disabled));
      }
      syncTutorPictureMicrophone();
    }
    function syncTutorResetAvailability(message) {
      const availability = message?.resetAvailability;
      if (!availability) return;
      for (const [command, available] of [
        ['resetTutorSession', availability.master], ['resetTutorLesson', availability.lesson]
      ]) {
        if (typeof available !== 'boolean') continue;
        const control = document.querySelector('[data-command="' + command + '"]');
        if (!(control instanceof HTMLButtonElement)) continue;
        control.disabled = !available;
        if (available) {
          control.removeAttribute('aria-disabled');
          control.removeAttribute('aria-description');
        } else {
          control.setAttribute('aria-disabled', 'true');
          control.setAttribute('aria-description', command === 'resetTutorLesson'
            ? 'There is no lesson to reset, or a request is in progress.'
            : 'A request is in progress.');
        }
      }
    }
    function updateTutorConversationStop(message) {
      if (message?.resetAvailability) syncTutorResetAvailability(message);
      const stop = document.querySelector('[data-tutor-composer-stop]') ??
        document.querySelector('[data-command="stopTutorConversation"]');
      if (!(stop instanceof HTMLButtonElement)) return;
      const title = typeof message?.title === 'string' && message.title
        ? message.title : 'Stop conversation';
      stop.disabled = message?.disabled === true;
      stop.setAttribute('aria-label', title);
      stop.title = title;
      const mirror = document.querySelector('[data-tutor-chat-stop]');
      if (mirror instanceof HTMLButtonElement) {
        mirror.disabled = stop.disabled;
        mirror.title = title;
        mirror.setAttribute('aria-label', title);
      }
    }
    function updateTutorTurnCheckAvailability(message) {
      for (const retry of document.querySelectorAll('[data-command="retryTutorTurnCheck"]')) {
        retry.disabled = message?.replyInProgress === true || retry.getAttribute('data-tutor-check-running') === 'true';
      }
    }
    function updateTutorConversationHint(message) {
      if (message?.resetAvailability) syncTutorResetAvailability(message);
      const block = document.querySelector('[data-tutor-hint]');
      const explanation = block?.querySelector('[data-tutor-hint-explanation]');
      const example = block?.querySelector('[data-tutor-hint-example]');
      const exampleText = block?.querySelector('[data-tutor-hint-example-text]');
      const control = document.querySelector('[data-command="hintTutorConversation"]');
      if (!(block instanceof HTMLElement) || !(explanation instanceof HTMLParagraphElement) ||
          !(example instanceof HTMLParagraphElement) || !(exampleText instanceof HTMLElement)) return;
      if (message?.clear === true) {
        block.hidden = true;
        block.removeAttribute('data-tutor-hint-turn');
        block.setAttribute('role', 'group');
        explanation.textContent = '';
        explanation.classList.remove('tutor-failure');
        exampleText.textContent = '';
        example.hidden = true;
        if (control instanceof HTMLButtonElement) control.disabled = false;
        return;
      }
      const busy = message?.busy === true;
      const turnGeneration = Number.isInteger(message?.turnGeneration)
        ? String(message.turnGeneration) : '';
      if (!busy && turnGeneration && block.getAttribute('data-tutor-hint-turn') !== turnGeneration) return;
      if (control instanceof HTMLButtonElement) control.disabled = busy;
      if (busy && turnGeneration) block.setAttribute('data-tutor-hint-turn', turnGeneration);
      block.hidden = false;
      block.setAttribute('role', busy ? 'status' : 'group');
      explanation.classList.toggle('tutor-failure', !busy && typeof message?.failure === 'string');
      if (busy) {
        explanation.textContent = 'Writing a hint. Please wait.';
        example.hidden = true;
        return;
      }
      if (typeof message?.failure === 'string') {
        explanation.textContent = message.failure;
        example.hidden = true;
        return;
      }
      if (typeof message?.hint?.explanation === 'string' &&
          typeof message?.hint?.example === 'string') {
        explanation.textContent = message.hint.explanation;
        exampleText.textContent = message.hint.example;
        example.hidden = false;
      }
    }
    function updateTutorLiveReplay(replayAvailable) {
      const replay = document.querySelector('[data-command="replayTutorQuestion"]');
      if (!(replay instanceof HTMLButtonElement)) return;
      const available = replayAvailable === true;
      replay.setAttribute('data-tutor-live-audio-available', String(available));
      updateTutorReplayMode();
    }
    function updateTutorPracticeTranscription(control, transcribing) {
      const actions = control.closest('.tutor-item-actions');
      if (!(actions instanceof HTMLElement)) return;
      let status = actions.querySelector('[data-tutor-transcription-status]');
      if (!transcribing) {
        status?.remove();
        return;
      }
      if (!(status instanceof HTMLElement)) {
        status = document.createElement('span');
        status.className = 'tutor-action-status';
        status.setAttribute('data-tutor-transcription-status', '');
        status.setAttribute('role', 'status');
        control.after(status);
      }
      status.textContent = (control.getAttribute('data-tutor-dictation-provider') === 'cloudflare' ? 'Cloudflare' : 'Gemini') + ' is transcribing the recording.';
    }
    function updateTutorConversationReplay(replayAvailable) {
      const replay = document.querySelector('[data-command="replayTutorQuestion"]');
      if (!(replay instanceof HTMLButtonElement)) return;
      replay.setAttribute('data-tutor-replay-conversation-available',
        String(replayAvailable === true));
      updateTutorReplayMode();
    }
    function updateTutorReplayMode() {
      const replay = document.querySelector('[data-command="replayTutorQuestion"]');
      if (!(replay instanceof HTMLButtonElement)) return;
      const speaker = document.querySelector('[data-command="toggleTutorConversationSpeaker"]');
      const replies = document.querySelector('[data-tutor-conversation-replies]');
      const live = replies instanceof HTMLSelectElement && replies.value === 'liveGemini' &&
        replay.getAttribute('data-tutor-standard-fallback') !== 'true';
      const conversation = replay.getAttribute('data-tutor-replay-mode') === 'conversation';
      const playing = replay.getAttribute('aria-pressed') === 'true';
      const available = replay.getAttribute('data-tutor-live-audio-available') === 'true';
      const standardAvailable = replay.getAttribute('data-tutor-standard-replay-available') === 'true';
      const conversationAvailable =
        replay.getAttribute('data-tutor-replay-conversation-available') === 'true';
      const title = playing ? 'Stop replaying'
        : conversation ? 'Replay the conversation' : 'Replay the last thing KREN said';
      replay.setAttribute('aria-label', title);
      replay.disabled = !(conversation ? conversationAvailable : live ? available : standardAvailable) ||
        !(speaker instanceof HTMLElement && speaker.getAttribute('aria-pressed') === 'true');
      replay.title = conversation && !(speaker instanceof HTMLElement && speaker.getAttribute('aria-pressed') === 'true')
        ? 'Turn the speaker on to replay.'
        : conversation && replay.disabled ? live ? 'No retained Live audio is available to replay.' : 'KREN has not said anything to replay.'
        : title;
    }
    function patchTutorConversationScene(message) {
      if (typeof message?.scene !== 'string') return false;
      const scene = document.querySelector('[data-tutor-scene]');
      const sceneText = scene?.querySelector('[data-tutor-scene-text]');
      if (!(scene instanceof HTMLElement) || !(sceneText instanceof HTMLParagraphElement)) return false;
      sceneText.textContent = message.scene;
      scene.hidden = false;
      return true;
    }
    function syncTutorConversationPictureSettings() {
      const coach = document.querySelector('[data-tutor-conversation-from]')?.value === 'speakAndRephrase';
      const transparency = document.querySelector('[data-tutor-conversation-picture-transparency]');
      const enabled = document.querySelector('[data-tutor-conversation-situation-picture]');
      const style = document.querySelector('[data-setting="tutor.conversation.pictureStyle"]');
      if (style instanceof HTMLSelectElement) {
        style.disabled = coach || !(enabled instanceof HTMLSelectElement) || enabled.value === 'none';
        if (style.disabled) style.setAttribute('title', coach ? 'Not used in Speak and rephrase.' : 'Choose a Situation picture mode to enable Picture style');
        else style.removeAttribute('title');
      }
      const balloon = document.querySelector('[data-tutor-conversation-balloon-transparency]');
      const viewport = document.querySelector('[data-tutor-picture-viewport]');
      if (balloon instanceof HTMLSelectElement) {
        balloon.disabled = !(enabled instanceof HTMLSelectElement) || enabled.value === 'none';
        const value = ['0', '10', '20', '30', '40', '50'].includes(balloon.value) ? balloon.value : '0';
        if (viewport instanceof HTMLElement) viewport.setAttribute('data-tutor-balloon-transparency', value);
      }
      if (!(transparency instanceof HTMLSelectElement)) return;
      transparency.disabled = coach || !(enabled instanceof HTMLSelectElement) || enabled.value === 'none';
      for (const picture of document.querySelectorAll('[data-tutor-picture]')) {
        const value = ['0', '20', '40', '60', '80'].includes(transparency.value) ? transparency.value : '80';
        picture.setAttribute('data-tutor-picture-transparency', value);
      }
    }
    function patchTutorConversationPictureTransparency(message) {
      const transparency = document.querySelector('[data-tutor-conversation-picture-transparency]');
      if (!(transparency instanceof HTMLSelectElement) ||
          !['0', '20', '40', '60', '80'].includes(message?.transparency)) return;
      transparency.value = message.transparency;
      syncTutorConversationPictureSettings();
    }
    function patchTutorConversationBalloonTransparency(message) {
      const transparency = document.querySelector('[data-tutor-conversation-balloon-transparency]');
      if (!(transparency instanceof HTMLSelectElement) ||
          !['0', '10', '20', '30', '40', '50'].includes(message?.transparency)) return;
      transparency.value = message.transparency;
      syncTutorConversationPictureSettings();
    }
    function tutorPictureMicrophoneMode() {
      const conversation = document.querySelector('[data-tutor-result="conversation"]');
      return conversation?.getAttribute('data-tutor-conversation-active') === 'true';
    }
    function syncTutorPictureMicrophone() {
      const transcript = document.querySelector('[data-tutor-transcript]');
      if (!(transcript instanceof HTMLElement)) return;
      const slot = transcript.querySelector('[data-tutor-chat-microphone]');
      if (!(slot instanceof HTMLElement)) return;
      const microphone = slot.querySelector('[data-tutor-chat-mic-control]');
      const listening = microphone?.getAttribute('aria-pressed') === 'true';
      const pending = transcript.getAttribute('data-tutor-opening-pending') === 'true' ||
        transcript.querySelector('[data-tutor-typing]') ||
        transcript.getAttribute('data-tutor-live-reply-pending') === 'true' ||
        (!listening && transcript.querySelector('[data-tutor-pending]'));
      slot.hidden = !tutorPictureMicrophoneMode() || Boolean(pending);
      if (!slot.hidden) transcript.appendChild(slot);
      const stop = document.querySelector('[data-tutor-composer-stop]');
      const chatStop = slot.querySelector('[data-tutor-chat-stop]');
      if (stop instanceof HTMLButtonElement && chatStop instanceof HTMLButtonElement) {
        chatStop.disabled = stop.disabled;
        chatStop.title = stop.title;
        chatStop.setAttribute('aria-label', stop.getAttribute('aria-label') || 'Stop conversation');
      }
    }
    function hideTutorChatMicrophone() {
      const slot = document.querySelector('[data-tutor-chat-microphone]');
      if (slot instanceof HTMLElement) slot.hidden = true;
    }
    function syncTutorStoryboardScroll() {
      const column = document.querySelector('[data-tutor-picture-column]');
      const transcript = document.querySelector('[data-tutor-transcript]');
      if (!(column instanceof HTMLElement) || !(transcript instanceof HTMLElement)) return;
      const pictures = Array.from(document.querySelectorAll('[data-tutor-picture]'));
      const decoded = pictures.filter((picture) => picture.hasAttribute('src') && picture.complete && picture.naturalWidth > 0);
      const mode = document.querySelector('[data-tutor-conversation-situation-picture]');
      if (mode?.value === 'graduallyEntering') {
        for (const picture of pictures) picture.hidden = !decoded.includes(picture);
        const sheet = document.querySelector('style[nonce]')?.sheet;
        const rule = Array.from(sheet?.cssRules || []).find((rule) => rule.selectorText === '.tutor-picture-stack');
        if (rule) rule.style.setProperty('transform', 'translateY(-' + transcript.scrollTop + 'px)');
        return;
      }
      let selected = decoded[0];
      const atBottom = transcript.scrollTop + transcript.clientHeight >= transcript.scrollHeight - 2;
      if (atBottom) selected = decoded.at(-1);
      else {
        const bounds = transcript.getBoundingClientRect();
        const middle = bounds.top + bounds.height / 2;
        for (const picture of decoded.slice(1)) {
          const turn = Number(picture.getAttribute('data-picture-turn'));
          if (!Number.isInteger(turn) || turn < 0) continue;
          const anchor = transcript.querySelector('[data-tutor-learner-turn="' + turn + '"]');
          const balloon = anchor?.querySelector('.tutor-chat-learner') || anchor;
          if (balloon instanceof HTMLElement && balloon.getBoundingClientRect().top <= middle) selected = picture;
        }
      }
      for (const picture of pictures) picture.hidden = picture !== selected;
    }
    function checkTutorDevelopingPicture(committedTurn) {
      // Only a host-confirmed commit can spend this turn's one opportunity.
      if (!Number.isInteger(committedTurn) || committedTurn < 0 || committedTurn <= tutorPictureCheckedTurn) return;
      tutorPictureCheckedTurn = committedTurn;
      const mode = document.querySelector('[data-tutor-conversation-situation-picture]');
      const conversation = document.querySelector('[data-tutor-result="conversation"]');
      const transcript = document.querySelector('[data-tutor-transcript]');
      const pictures = Array.from(document.querySelectorAll('[data-tutor-picture]'));
      if (!(mode instanceof HTMLSelectElement) || !['switching', 'graduallyEntering'].includes(mode.value) || tutorPictureRequestPending ||
          conversation?.getAttribute('data-tutor-conversation-active') !== 'true' ||
          !(transcript instanceof HTMLElement) || !pictures.length || pictures.length >= 10) return;
      const balloons = Array.from(transcript.querySelectorAll('.tutor-chat-kren, .tutor-chat-learner, .tutor-chat-demo'))
        .filter((balloon) => !balloon.closest('[data-tutor-chat-microphone]'));
      const newest = balloons.at(-1);
      if (!(newest instanceof HTMLElement)) return;
      const last = pictures.at(-1);
      if (last.hidden && (!last.complete || last.naturalWidth === 0 || !last.hasAttribute('src'))) {
        if (last.hasAttribute('src')) return;
        if (pictures.some((picture) => !picture.hidden)) return;
        tutorPictureRequestPending = true;
        vscode.postMessage({ command: 'requestNextTutorConversationPicture', input: String(committedTurn) });
        return;
      }
      const balloon = newest.getBoundingClientRect();
      const bottom = mode.value === 'graduallyEntering'
        ? last.getBoundingClientRect().bottom
        : document.querySelector('[data-tutor-picture-viewport]').getBoundingClientRect().bottom;
      if (balloon.bottom < bottom - Math.max(balloon.height, 1)) return;
      tutorPictureRequestPending = true;
      vscode.postMessage({ command: 'requestNextTutorConversationPicture', input: String(committedTurn) });
    }
    function syncTutorConversationPictureViewport() {
      const viewport = document.querySelector('[data-tutor-picture-viewport]');
      let loaded = false;
      for (const picture of document.querySelectorAll('[data-tutor-picture]')) {
        const decoded = picture.hasAttribute('src') && picture.complete && picture.naturalWidth > 0;
        loaded = loaded || decoded;
      }
      if (viewport instanceof HTMLElement) viewport.classList.toggle('tutor-chat-viewport-picture', loaded);
      syncTutorPictureMicrophone();
      syncTutorStoryboardScroll();
    }
    function initializeTutorConversationPicture() {
      for (const picture of document.querySelectorAll('[data-tutor-picture]')) {
        if (picture.getAttribute('data-picture-initialized') === 'true') continue;
        picture.setAttribute('data-picture-initialized', 'true');
        const acknowledgeDecoded = () => {
          if (!picture.complete || picture.naturalWidth === 0 || !picture.hasAttribute('src')) return;
          const source = picture.getAttribute('src');
          const requestId = Number(picture.getAttribute('data-picture-request-id'));
          if (picture.getAttribute('data-picture-decoded-source') !== source ||
              picture.getAttribute('data-picture-decoded-request-id') !== String(requestId)) {
            picture.setAttribute('data-picture-decoded-source', source);
            picture.setAttribute('data-picture-decoded-request-id', String(requestId));
            vscode.postMessage({ command: 'tutorConversationPictureDecoded', input: source,
              requestId });
          }
          syncTutorConversationPictureViewport();
        };
        picture.addEventListener('load', acknowledgeDecoded);
        picture.addEventListener('error', () => {
          vscode.postMessage({ command: 'tutorConversationPictureFailed', input: picture.getAttribute('src'),
            requestId: Number(picture.getAttribute('data-picture-request-id')) });
          picture.removeAttribute('src');
          syncTutorConversationPictureViewport();
        });
        acknowledgeDecoded();
      }
      syncTutorConversationPictureViewport();
    }
    function cancelTutorConversationPictureDecode(message) {
      const column = document.querySelector('[data-tutor-picture-column]');
      if (!(column instanceof HTMLElement)) return;
      // 2026-10-02: Invalidate detached load/error callbacks before they can insert a frame.
      if (column.getAttribute('data-picture-pending-request-id') === String(message.requestId)) {
        column.setAttribute('data-picture-generation', String(Number(column.getAttribute('data-picture-generation') || '0') + 1));
        column.removeAttribute('data-picture-pending-request-id');
        tutorPictureRequestPending = false;
      }
      const pictures = Array.from(document.querySelectorAll('[data-tutor-picture]'));
      for (const picture of pictures) {
        if (picture.getAttribute('data-picture-request-id') !== String(message.requestId)) continue;
        picture.removeAttribute('src');
        picture.hidden = true;
        // Keep the empty first-frame placeholder; later cancelled frames leave the stack.
        if (pictures.indexOf(picture) > 0) picture.remove();
      }
      syncTutorConversationPictureViewport();
    }
    function patchTutorConversationPicture(message) {
      const viewport = document.querySelector('[data-tutor-picture-viewport]');
      const column = document.querySelector('[data-tutor-picture-column]');
      const mode = document.querySelector('[data-tutor-conversation-situation-picture]');
      if (!(viewport instanceof HTMLElement) || !(column instanceof HTMLElement)) return;
      // 2026-10-02: Retain decoded frames and pending load callbacks when only layout changes.
      if (message?.layoutOnly === true && ['switching', 'graduallyEntering'].includes(message.mode) &&
          mode instanceof HTMLSelectElement) {
        mode.value = message.mode;
        column.querySelector('.tutor-picture-frames').className = 'tutor-picture-frames' +
          (mode.value === 'graduallyEntering' ? ' tutor-picture-stack' : '');
        syncTutorConversationPictureViewport();
        syncTutorConversationPictureSettings();
        return;
      }
      if (mode instanceof HTMLSelectElement && ['none', 'intro', 'switching', 'graduallyEntering'].includes(message?.mode)) {
        mode.value = message.mode;
        tutorPictureRequestPending = Number.isSafeInteger(message?.requestId) && message.requestId > 0;
      }
      const developing = mode instanceof HTMLSelectElement && ['switching', 'graduallyEntering'].includes(mode.value);
      column.querySelector('.tutor-picture-frames').className = 'tutor-picture-frames' +
        (mode?.value === 'graduallyEntering' ? ' tutor-picture-stack' : '');
      const images = (Array.isArray(message?.images) ? message.images : [message?.image]).filter((image) =>
        typeof image === 'string' && new RegExp('^data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$', 'u').test(image));
      const shown = mode?.value === 'none' ? [] : developing ? images : images.slice(-1);
      const previousPictures = Array.from(document.querySelectorAll('[data-tutor-picture]'));
      const replacingIntro = message?.replaceCharacter === true && !developing;
      const existing = replacingIntro ? [] : previousPictures;
      const generation = String(Number(column.getAttribute('data-picture-generation') || '0') + 1);
      column.setAttribute('data-picture-generation', generation);
      if (Number.isSafeInteger(message?.requestId)) {
        column.setAttribute('data-picture-pending-request-id', String(message.requestId));
      }
      for (let index = 0; index < Math.max(shown.length, 1); index += 1) {
        const picture = existing[index] || document.createElement('img');
        picture.setAttribute('data-tutor-picture', '');
        const pictureTurn = developing ? message?.turns?.[index] : message?.turns?.[images.length - 1];
        if (Number.isInteger(pictureTurn)) {
          picture.setAttribute('data-picture-turn', String(pictureTurn));
        }
        picture.setAttribute('alt', '');
        picture.setAttribute('aria-hidden', 'true');
        if ((!developing || index === images.length - 1) && shown[index] === message?.image && Number.isSafeInteger(message?.requestId)) {
          picture.setAttribute('data-picture-request-id', String(message.requestId));
        }
        if (shown[index] && !existing[index]) {
          // 2026-10-02: Load new storyboard frames off-screen so they paint in one step.
          picture.hidden = true;
          picture.addEventListener('load', () => {
            if (column.getAttribute('data-picture-generation') !== generation) return;
            if (!picture.complete || picture.naturalWidth === 0) return;
            picture.hidden = false;
            if (developing) {
              const stack = column.querySelector('.tutor-picture-frames');
              if (stack.children[index]) stack.insertBefore(picture, stack.children[index]);
              else stack.appendChild(picture);
            } else {
              viewport.insertBefore(picture, column);
              if (replacingIntro) previousPictures.forEach((previous) => previous.remove());
            }
            picture.setAttribute('data-picture-decoded-source', picture.getAttribute('src'));
            picture.setAttribute('data-picture-decoded-request-id', String(Number(picture.getAttribute('data-picture-request-id'))));
            vscode.postMessage({ command: 'tutorConversationPictureDecoded', input: picture.getAttribute('src'),
              requestId: Number(picture.getAttribute('data-picture-request-id')) });
            initializeTutorConversationPicture();
            syncTutorConversationPictureSettings();
          });
          picture.addEventListener('error', () => {
            if (column.getAttribute('data-picture-generation') !== generation) return;
            vscode.postMessage({ command: 'tutorConversationPictureFailed', input: picture.getAttribute('src'),
              requestId: Number(picture.getAttribute('data-picture-request-id')) });
          });
          picture.src = shown[index];
          continue;
        }
        if (shown[index]) {
          if (picture.getAttribute('src') !== shown[index]) {
            picture.hidden = true;
            picture.src = shown[index];
          }
        } else {
          picture.removeAttribute('src');
          picture.removeAttribute('data-picture-decoded-source');
        }
        if (developing) column.querySelector('.tutor-picture-frames').appendChild(picture);
        else viewport.insertBefore(picture, column);
      }
      existing.slice(Math.max(shown.length, 1)).forEach((picture) => picture.remove());
      column.hidden = !developing;
      initializeTutorConversationPicture();
      syncTutorConversationPictureSettings();
    }
    function patchTutorConversationOpening(message) {
      if (message?.resetAvailability) syncTutorResetAvailability(message);
      if (!patchTutorConversationScene(message)) return;
      const transcript = document.querySelector('[data-tutor-transcript]');
      if (!(transcript instanceof HTMLElement)) return;
      const openingPending = ['scene', 'waiting', 'opening'].includes(message?.reveal);
      if (openingPending) transcript.setAttribute('data-tutor-opening-pending', 'true');
      else transcript.removeAttribute('data-tutor-opening-pending');
      for (const control of document.querySelectorAll('[data-tutor-chat-mic-control], [data-tutor-composer-stop]')) {
        control.hidden = openingPending;
      }
      if (openingPending) {
        const answer = document.querySelector('[data-tutor-conversation-answer]');
        if (answer instanceof HTMLTextAreaElement) answer.disabled = true;
        hideTutorChatMicrophone();
      }
      for (const unfinished of transcript.querySelectorAll('[data-tutor-live-reply]')) {
        unfinished.remove();
      }
      const typing = transcript.querySelector('[data-tutor-typing]');
      if (typeof message?.opening === 'string' && message.opening) {
        const bubble = document.createElement('div');
        bubble.className = 'tutor-chat-kren';
        bubble.setAttribute('data-tutor-kren-bubble', '');
        bubble.setAttribute('role', 'group');
        bubble.setAttribute('aria-label', 'KREN');
        const paragraph = document.createElement('p');
        patchTutorMarkedText(paragraph, message.opening, message.targetRanges, '');
        bubble.appendChild(paragraph);
        if (typing) typing.replaceWith(bubble);
        else transcript.appendChild(bubble);
      } else if (message?.reveal === 'waiting' && !typing) {
        const bubble = document.createElement('div');
        bubble.className = 'tutor-chat-kren tutor-chat-typing';
        bubble.setAttribute('data-tutor-kren-bubble', '');
        bubble.setAttribute('data-tutor-typing', '');
        bubble.setAttribute('role', 'status');
        bubble.setAttribute('aria-label', 'KREN is typing');
        bubble.innerHTML = '<span class="tutor-typing-dot" aria-hidden="true">.</span>'.repeat(3);
        transcript.appendChild(bubble);
      } else if (typing && message?.reveal !== 'waiting') {
        typing.remove();
      }
      const replay = document.querySelector('[data-command="replayTutorQuestion"]');
      if (replay instanceof HTMLButtonElement) {
        replay.setAttribute('data-tutor-standard-replay-available', 'true');
      }
      if (!openingPending) markTutorLiveConversationReady(message);
    }
    function patchTutorConversationRender(message) {
      if (typeof message.html !== 'string') return;
      const nextDocument = new DOMParser().parseFromString(message.html, 'text/html');
      const current = document.querySelector('[data-tutor-result="conversation"]');
      const next = nextDocument.querySelector('[data-tutor-result="conversation"]');
      if (!(current instanceof HTMLElement) || !(next instanceof HTMLElement)) return;
      const answer = current.querySelector('[data-tutor-conversation-answer]');
      const nextAnswer = next.querySelector('[data-tutor-conversation-answer]');
      const answerFocused = document.activeElement === answer;
      for (const section of current.querySelectorAll('details[data-persist-id]')) {
        const id = section.getAttribute('data-persist-id');
        const replacement = next.querySelector('details[data-persist-id="' + id + '"]');
        if (replacement instanceof HTMLDetailsElement) replacement.open = section.open;
      }
      if (answer instanceof HTMLTextAreaElement && nextAnswer instanceof HTMLTextAreaElement) {
        answer.disabled = nextAnswer.disabled;
        answer.className = nextAnswer.className;
        answer.value = nextAnswer.value;
        nextAnswer.replaceWith(answer);
      }
      const viewport = current.querySelector('[data-tutor-picture-viewport]');
      const nextViewport = next.querySelector('[data-tutor-picture-viewport]');
      const transcript = viewport?.querySelector('[data-tutor-transcript]');
      const nextTranscript = nextViewport?.querySelector('[data-tutor-transcript]');
      if (viewport && nextViewport && transcript && nextTranscript) {
        transcript.innerHTML = nextTranscript.innerHTML;
        if (nextTranscript.hasAttribute('data-tutor-opening-pending')) transcript.setAttribute('data-tutor-opening-pending', 'true');
        else transcript.removeAttribute('data-tutor-opening-pending');
        nextViewport.replaceWith(viewport);
      }
      current.replaceWith(next);
      syncTutorConversationFrontActions();
      if (answerFocused && answer instanceof HTMLTextAreaElement) answer.focus({ preventScroll: true });
      patchTutorVoiceModel(message);
      initializeTutorConversationPicture();
      checkTutorDevelopingPicture(message.committedTurn);
    }
    function markTutorLiveConversationReady(message) {
      const transcript = document.querySelector('[data-tutor-transcript]');
      if (transcript instanceof HTMLElement) transcript.removeAttribute('data-tutor-live-reply-pending');
      document.querySelector('[data-tutor-live-reply]')?.removeAttribute('data-tutor-live-reply');
      if (message?.resetAvailability) syncTutorResetAvailability(message);
      const answer = document.querySelector('[data-tutor-conversation-answer]');
      if (answer instanceof HTMLTextAreaElement) answer.disabled = false;
      const submit = document.querySelector('[data-command="submitTutorConversationTurn"]');
      if (submit instanceof HTMLButtonElement) submit.disabled = !answer?.value.trim();
      for (const command of ['hintTutorConversation', 'skipTutorConversationTurn']) {
        const control = document.querySelector('[data-command="' + command + '"]');
        if (control instanceof HTMLButtonElement) control.disabled = false;
      }
      if (message?.talkAvailable === true) updateTutorLiveTalk({
        available: true, listening: message?.listening === true, pressToTalk: message?.pressToTalk === true
      });
      else {
        const microphone = document.querySelector('[data-tutor-chat-mic-control]') ??
          document.querySelector('[data-command="dictateTutorConversation"]');
        if (microphone instanceof HTMLButtonElement) {
          microphone.disabled = microphone.getAttribute('data-tutor-dictation-route-unavailable') === 'true';
          microphone.setAttribute('data-tutor-dictation-disabled', String(microphone.disabled));
        }
      }
      updateTutorLiveReplay(message?.replayAvailable === true);
      syncTutorPictureMicrophone();
    }
    function updateTutorConversationDiagnosis(answeredTurnCount, skippedTurnCount) {
      const actions = document.querySelector('[data-tutor-conversation-actions]');
      if (!(actions instanceof HTMLElement)) return;
      const answered = Number.isInteger(answeredTurnCount) ? answeredTurnCount : 0;
      const skipped = Number.isInteger(skippedTurnCount) ? skippedTurnCount : 0;
      actions.setAttribute('data-tutor-answered-turns', String(answered));
      actions.setAttribute('data-tutor-skipped-turns', String(skipped));
      // Review actions belong to the stopped state, never the active composer.
      actions.hidden = true;
    }
    function patchTutorLiveCoaching(turn, reply, message) {
      if (turn?.querySelector('[data-tutor-learner-not-shown]')) return;
      if (!(turn instanceof HTMLElement)) return;
      if (message.partiallyHeard === true) patchTutorPartialHearing(turn, message);
      const normalizedAnswer = typeof message.learnerAnswer === 'string' ? message.learnerAnswer : undefined;
      if (typeof normalizedAnswer === 'string') {
        const learnerAnswer = turn.querySelector('[data-tutor-learner-answer]');
        if (learnerAnswer instanceof HTMLParagraphElement) {
          learnerAnswer.textContent = normalizedAnswer;
        }
      }
      turn.querySelector('[data-tutor-coaching-failed]')?.remove();
      turn.querySelector('[data-tutor-turn-feedback]')?.remove();
      turn.querySelector('[data-command="showTutorConversationRephrase"]')?.remove();
      if (message.coach === true) {
        if (!(reply instanceof HTMLElement) && typeof message.coachReply === 'string' && message.coachReply) {
          const transcript = document.querySelector('[data-tutor-transcript]');
          if (transcript instanceof HTMLElement) {
            reply = document.createElement('div');
            reply.className = 'tutor-chat-kren';
            reply.setAttribute('data-tutor-kren-bubble', '');
            reply.setAttribute('data-tutor-reply-bubble', '');
            reply.setAttribute('data-tutor-reply-turn', String(message.index));
            reply.setAttribute('role', 'group');
            reply.setAttribute('aria-label', 'KREN');
            const paragraph = document.createElement('p');
            paragraph.textContent = message.coachReply;
            reply.appendChild(paragraph);
            const next = Array.from(transcript.children)[Array.from(transcript.children).indexOf(turn) + 1];
            if (next) transcript.insertBefore(reply, next);
            else transcript.appendChild(reply);
          }
        }
        const paragraph = reply?.querySelector('p');
        if (paragraph instanceof HTMLParagraphElement) {
          const text = paragraph.textContent || '';
          paragraph.setAttribute('data-tutor-coach-reply', '');
          patchTutorCoachText(paragraph, text);
        }
        if (message.coachingFailed !== true) return;
      }
      if (message.coachingFailed === true) {
        const failure = document.createElement('p');
        failure.className = 'tutor-turn-check-failed';
        failure.setAttribute('data-tutor-coaching-failed', '');
        const notice = document.createElement('span');
        notice.textContent = 'KREN could not check this turn.';
        failure.appendChild(notice);
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'secondary icon-button';
        retry.setAttribute('data-command', 'retryTutorTurnCheck');
        retry.setAttribute('data-tutor-turn', String(message.index));
        retry.setAttribute('aria-label', 'Check this turn again');
        retry.title = 'Check this turn again';
        retry.setAttribute('data-tutor-check-running', String(message.coachingPending === true));
        retry.disabled = message.coachingPending === true ||
          document.querySelector('[data-tutor-transcript]')?.getAttribute('data-tutor-live-reply-pending') === 'true';
        retry.innerHTML = ${JSON.stringify(iconSvgMarkup('regenerate'))};
        failure.appendChild(retry);
        turn.appendChild(failure);
      } else if (message.feedbackEligible === true && typeof message.correction === 'string' &&
          typeof message.explanation === 'string') {
        if (reply instanceof HTMLElement) {
          const paragraph = reply.querySelector('p');
          const stored = paragraph?.getAttribute('data-tutor-target-ranges');
          let ranges = message.targetRanges;
          if (!Array.isArray(ranges)) {
            try { ranges = JSON.parse(stored || '[]'); } catch { ranges = []; }
          }
          patchTutorMarkedText(paragraph, paragraph?.textContent || '', ranges, message.replyQuote);
        }
        const feedback = document.createElement('div');
        feedback.className = 'tutor-turn-feedback';
        feedback.setAttribute('data-tutor-turn-feedback', '');
        feedback.setAttribute('data-tutor-spoken-equivalent',
          String(message.spokenEquivalent === true));
        feedback.hidden = message.showFeedback !== true;
        const correction = document.createElement('p');
        correction.setAttribute('data-tutor-correction', '');
        correction.textContent = message.correction;
        const details = document.createElement('details');
        details.className = 'tutor-turn-explanation';
        details.setAttribute('data-tutor-turn-explanation', '');
        const summary = document.createElement('summary');
        summary.textContent = 'Why?';
        const explanation = document.createElement('p');
        explanation.textContent = message.explanation;
        const ask = document.createElement('button');
        ask.type = 'button';
        ask.className = 'secondary';
        ask.setAttribute('data-command', 'askTutorConversationTurn');
        ask.setAttribute('data-tutor-turn', String(message.index));
        ask.textContent = 'Ask about this';
        details.append(summary, explanation, ask);
        feedback.append(correction, details);
        turn.appendChild(feedback);
      }
      if (message.showRephrase === true && message.rephraseEligible === true &&
          typeof message.rephrase === 'string' && typeof message.rephraseWhy === 'string') {
        const bubble = turn.querySelector('.tutor-chat-learner');
        if (bubble instanceof HTMLElement) {
          const rephrase = document.createElement('button');
          rephrase.type = 'button';
          rephrase.className = 'tutor-rephrase-action';
          rephrase.setAttribute('data-command', 'showTutorConversationRephrase');
          rephrase.setAttribute('data-tutor-rephrase', message.rephrase);
          rephrase.setAttribute('data-tutor-rephrase-why', message.rephraseWhy);
          rephrase.textContent = 'Rephrase?';
          bubble.appendChild(rephrase);
        }
      }
    }
    function showTutorConversationRephrase(control) {
      if (!(control instanceof HTMLButtonElement)) return;
      const turn = control.closest('[data-tutor-learner-turn]');
      const rephrase = control.getAttribute('data-tutor-rephrase');
      const why = control.getAttribute('data-tutor-rephrase-why');
      if (!(turn instanceof HTMLElement) || !rephrase || !why) return;
      const learnerWords = turn.querySelector('[data-tutor-learner-answer]')?.textContent || '';
      const comparable = (value) => value.trim().replace(/\\s+/gu, ' ')
        .replace(/[.?!]$/u, '').trim().toLocaleLowerCase('en-US');
      const unchanged = comparable(rephrase) === comparable(learnerWords);
      let feedback = turn.querySelector('[data-tutor-turn-feedback]');
      if (!(feedback instanceof HTMLElement)) {
        feedback = document.createElement('div');
        feedback.className = 'tutor-turn-feedback';
        feedback.setAttribute('data-tutor-turn-feedback', '');
        turn.appendChild(feedback);
      }
      feedback.hidden = false;
      feedback.setAttribute('data-tutor-feedback-kind', 'rephrase');
      const text = document.createElement('p');
      text.setAttribute('data-tutor-rephrase', '');
      text.textContent = unchanged ? 'Nothing to rephrase for this chat.' : rephrase;
      if (unchanged) {
        feedback.replaceChildren(text);
      } else {
        const details = document.createElement('details');
        details.className = 'tutor-turn-explanation';
        details.setAttribute('data-tutor-turn-explanation', '');
        const summary = document.createElement('summary');
        summary.textContent = 'Why?';
        const explanation = document.createElement('p');
        explanation.textContent = why;
        details.append(summary, explanation);
        feedback.replaceChildren(text, details);
      }
      control.remove();
      vscode.postMessage({
        command: 'showTutorConversationRephrase',
        input: turn.getAttribute('data-tutor-learner-turn') || ''
      });
    }
    function commitTutorLiveTurn(message) {
      const liveBubble = document.querySelector('[data-tutor-reply-turn="' + message.index + '"]') ||
        document.querySelector('[data-tutor-live-reply]');
      if (liveBubble instanceof HTMLElement) liveBubble.setAttribute('data-tutor-reply-turn', String(message.index));
      if (liveBubble instanceof HTMLElement && Number.isInteger(message.completedTurnGeneration)) {
        liveBubble.setAttribute('data-tutor-reply-generation', String(message.completedTurnGeneration));
      }
      const pending = document.querySelector('[data-tutor-learner-turn="' + message.index + '"]') ||
        document.querySelector('[data-tutor-pending]');
      if (pending instanceof HTMLElement) {
        pending.removeAttribute('data-tutor-pending');
        pending.removeAttribute('aria-busy');
        pending.setAttribute('data-tutor-learner-turn', String(message.index));
        if (Number.isInteger(message.completedTurnGeneration)) {
          pending.setAttribute('data-tutor-turn-generation', String(message.completedTurnGeneration));
        }
        const learner = pending.querySelector('.tutor-chat-learner');
        learner?.setAttribute('aria-label', 'You');
        if (message.learnerNotShown === true || message.partiallyHeard === true) {
          commitTutorLiveInput({ ...message, text: message.learnerNotShown === true ? '' : message.text });
        }
        if (message.learnerNotShown !== true) patchTutorLiveCoaching(pending, liveBubble, message);
      }
      liveBubble?.removeAttribute('data-tutor-live-reply');
      updateTutorConversationHint({ clear: true, turnGeneration: message.turnGeneration });
      updateTutorConversationDiagnosis(message.answeredTurnCount, message.skippedTurnCount);
      markTutorLiveConversationReady(message);
      checkTutorDevelopingPicture(message.index);
    }
    function patchLateTutorLiveCoaching(message) {
      if (!Number.isInteger(message.index) && !Number.isInteger(message.turnGeneration)) return;
      const generation = String(message.turnGeneration);
      const turn = Number.isInteger(message.turnGeneration)
        ? document.querySelector('[data-tutor-turn-generation="' + generation + '"]')
        : document.querySelector('[data-tutor-learner-turn="' + message.index + '"]');
      const reply = Number.isInteger(message.turnGeneration)
        ? document.querySelector('[data-tutor-reply-generation="' + generation + '"]')
        : document.querySelector('[data-tutor-reply-turn="' + message.index + '"]');
      patchTutorLiveCoaching(turn, reply, message);
    }
    // Extracted so a handler that returns early can still confirm on the control the
    // reader pressed. The grammar Copy control posts and returns before reaching the
    // generic path below, and without this it copied with no acknowledgement at all.
    function confirmCopyOn(target) {
        window.clearTimeout(Number(target.getAttribute('data-copy-timer')) || 0);
        if (target.classList.contains('icon-button')) {
          // An icon button holds an SVG and no text, so the text swap below would delete the
          // drawing and restore an empty label. Confirming on the accessible name instead
          // keeps the control drawn and still announces the copy to a screen reader.
          const title = target.getAttribute('data-copy-title') ?? target.getAttribute('title') ?? '';
          const aria = target.getAttribute('data-copy-aria') ?? target.getAttribute('aria-label') ?? '';
          target.setAttribute('data-copy-title', title);
          target.setAttribute('data-copy-aria', aria);
          target.setAttribute('title', 'Result copied');
          target.setAttribute('aria-label', 'Result copied');
          target.setAttribute('data-copied', 'true');
          target.setAttribute('data-copy-timer', String(window.setTimeout(() => {
            target.setAttribute('title', target.getAttribute('data-copy-title') ?? title);
            target.setAttribute('aria-label', target.getAttribute('data-copy-aria') ?? aria);
            target.removeAttribute('data-copied');
          }, 1800)));
        } else {
          // Both getAttribute and textContent are nullable, and setAttribute stringifies
          // null to the literal "null", so a button whose label failed to read would restore
          // itself as the word null rather than its own text. Coalesced to an empty string
          // and restored from the stored attribute, which is written before the swap.
          const original = target.getAttribute('data-copy-label') ?? target.textContent ?? '';
          target.setAttribute('data-copy-label', original);
          target.textContent = 'Result copied';
          target.setAttribute('data-copy-timer', String(window.setTimeout(() => {
            target.textContent = target.getAttribute('data-copy-label') ?? original;
          }, 1800)));
        }
    }
    let cancelTutorHandyAutoSend = () => {};
    function armTutorHandyAutoSend(answer) {
      cancelTutorHandyAutoSend();
      const read = () => answer instanceof HTMLTextAreaElement ? answer.value : answer.textContent || '';
      const initialValue = read();
      let quietTimer;
      let deadlineTimer;
      let finished = false;
      const stopWatching = () => {
        if (finished) return;
        finished = true;
        answer.removeEventListener('input', onInput);
        if (quietTimer !== undefined) window.clearTimeout(quietTimer);
        if (deadlineTimer !== undefined) window.clearTimeout(deadlineTimer);
        if (cancelTutorHandyAutoSend === stopWatching) cancelTutorHandyAutoSend = () => {};
      };
      const submitAfterQuiet = () => {
        if (!answer.isConnected || read() === initialValue || !read().trim()) {
          stopWatching();
          return;
        }
        vscode.postMessage({ command: 'tutorHandyQuietPeriodElapsed' });
        vscode.postMessage({
          command: 'updateTutorConversationAnswer', answer: read(), spoken: true
        });
        vscode.postMessage({ command: 'submitTutorConversationTurn' });
        stopWatching();
        answer.remove();
        document.querySelector('[data-tutor-chat-mic-control]')?.focus({ preventScroll: true });
      };
      const onInput = (event) => {
        if (!(event instanceof InputEvent) || event.inputType !== 'insertFromPaste') {
          stopWatching();
          return;
        }
        if (read() === initialValue) return;
        if (deadlineTimer !== undefined) {
          window.clearTimeout(deadlineTimer);
          deadlineTimer = undefined;
        }
        if (quietTimer !== undefined) window.clearTimeout(quietTimer);
        vscode.postMessage({ command: 'tutorHandyTranscriptReceived' });
        vscode.postMessage({ command: 'tutorHandyQuietPeriodStarted' });
        quietTimer = window.setTimeout(submitAfterQuiet, ${tutorStandardQuietPeriodMs});
      };
      answer.addEventListener('input', onInput);
      deadlineTimer = window.setTimeout(stopWatching, 15000);
      cancelTutorHandyAutoSend = stopWatching;
    }
    document.addEventListener('click', (event) => {
      const eventElement = event.target instanceof Element ? event.target : null;
      const credentialsLink = eventElement?.closest('a[data-command="showCredentials"]');
      if (credentialsLink) {
        event.preventDefault();
        vscode.postMessage({ command: 'showCredentials' });
        return;
      }
      const move = eventElement?.closest('[data-provider-move]');
      if (move instanceof HTMLButtonElement && !move.disabled) {
        const list = move.closest('[data-provider-order]');
        const item = move.closest('[data-provider]');
        if (!list || !item) return;
        const order = Array.from(list.querySelectorAll('[data-provider]')).map(row => row.getAttribute('data-provider'));
        const index = order.indexOf(item.getAttribute('data-provider'));
        const destination = index + Number(move.getAttribute('data-provider-move'));
        if (destination < 0 || destination >= order.length) return;
        [order[index], order[destination]] = [order[destination], order[index]];
        const rows = Array.from(list.children);
        order.forEach(provider => { const row = rows.find(candidate => candidate.getAttribute('data-provider') === provider); if (row) list.appendChild(row); });
        Array.from(list.children).forEach((row, position) => { row.querySelector('[data-provider-move="-1"]').disabled = position === 0; row.querySelector('[data-provider-move="1"]').disabled = position === order.length - 1; });
        if (move.disabled) item.querySelector('[data-provider-move="' + (move.getAttribute('data-provider-move') === '-1' ? '1' : '-1') + '"]')?.focus();
        vscode.postMessage({ command: 'updateSetting', key: 'llm.providerOrder', value: JSON.stringify(order) });
        return;
      }
      const rewriteSummary = eventElement?.closest('summary[data-rewrite-group-summary]');
      if (rewriteSummary) {
        event.preventDefault();
        const group = rewriteSummary.getAttribute('data-rewrite-group-summary') || '';
        const details = rewriteSummary.closest('details');
        const willOpen = details instanceof HTMLDetailsElement && !details.open;
        document.querySelectorAll('details[data-rewrite-group]').forEach((candidate) => {
          if (candidate instanceof HTMLDetailsElement) candidate.open = false;
        });
        if (willOpen && details instanceof HTMLDetailsElement) details.open = true;
        vscode.postMessage({ command: 'editRewriteGroup', group: willOpen ? group : '' });
        return;
      }
      const credentialHelpLink = eventElement?.closest('[data-credential-help]');
      if (credentialHelpLink) {
        event.preventDefault();
        vscode.postMessage({ command: 'openCredentialHelp', credentialId: credentialHelpLink.getAttribute('data-credential-help') });
        return;
      }
      const target = eventElement?.closest('button') ?? null;
      const menus = Array.from(document.querySelectorAll('[data-menu-popover]'));
      if (!target) {
        menus.forEach((menu) => menu.classList.add('hidden'));
        return;
      }
      if (target.getAttribute('data-command') === 'cancelPanelProgress') {
        vscode.postMessage({ command: 'cancelPanelProgress', operationId: Number(target.getAttribute('data-operation-id')) });
        return;
      }
      if (target.getAttribute('aria-disabled') === 'true') return;
      if (target.hasAttribute('data-update-fix-target')) {
        const destination = target.getAttribute('data-update-fix-target');
        savePanelState({ updateFixTarget: destination });
        vscode.postMessage({ command: destination === 'tutor' || destination === 'tutorVoice' ? 'showTutor' : 'showSettings' });
        return;
      }
      if (target.hasAttribute('data-tutor-open-conversation-settings')) {
        const settings = document.querySelector('details[data-persist-id="tutor-conversation-mode"]');
        if (settings instanceof HTMLDetailsElement) settings.open = true;
        syncTutorConversationFrontActions();
        settings?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        settings?.querySelector('summary')?.focus({ preventScroll: true });
        return;
      }
      if (target.hasAttribute('data-tutor-open-lesson-settings')) {
        const settings = document.querySelector('details[data-persist-id="tutor-lesson"]');
        if (settings instanceof HTMLDetailsElement) settings.open = true;
        settings?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        settings?.querySelector('summary')?.focus({ preventScroll: true });
        return;
      }
      if (target.hasAttribute('data-tutor-settings-section')) {
        const id = target.getAttribute('data-tutor-settings-section');
        if (id !== 'tutor-voice' && id !== 'tutor-routing') return;
        const section = document.querySelector('details[data-persist-id="' + id + '"]');
        let parent = section;
        while (parent instanceof HTMLElement) {
          if (parent instanceof HTMLDetailsElement) parent.open = true;
          parent = parent.parentElement;
        }
        section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        section?.querySelector('summary')?.focus({ preventScroll: true });
        vscode.postMessage({ command: 'stopReadAloud' });
        return;
      }
      if (target.hasAttribute('data-tutor-jump-configuration')) {
        // Page navigation only. It carries no data-command, because every data-command is
        // posted to the extension host and must be handled there.
        const configuration = document.querySelector('[data-tutor-configuration]');
        configuration?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        configuration?.querySelector('summary')?.focus({ preventScroll: true });
        return;
      }
      if (target.hasAttribute('data-tutor-find-targets')) {
        postTutorFind();
        return;
      }
      if (target.hasAttribute('data-tutor-ask')) {
        postTutorAsk();
        return;
      }
      if (target.hasAttribute('data-tutor-info-toggle')) {
        const id = target.getAttribute('aria-controls') || '';
        const information = id ? document.getElementById(id) : null;
        if (!(information instanceof HTMLElement)) return;
        const willShow = information.hidden;
        information.hidden = !willShow;
        target.setAttribute('aria-expanded', String(willShow));
        return;
      }
      if (target.hasAttribute('data-tutor-search-result')) {
        const results = document.querySelector('[data-tutor-search-results]');
        if (results instanceof HTMLElement) results.classList.add('hidden');
        const search = document.querySelector('[data-tutor-map-search]');
        if (search instanceof HTMLInputElement || search instanceof HTMLTextAreaElement) {
          search.value = '';
        }
      }
      if (target.hasAttribute('data-menu-toggle')) {
        vscode.postMessage({ command: 'stopReadAloud' });
        const menu = target.closest('.menu-wrap')?.querySelector('[data-menu-popover]');
        menus.forEach((candidate) => {
          if (candidate !== menu) candidate.classList.add('hidden');
        });
        const isHidden = menu?.classList.toggle('hidden') ?? true;
        target.setAttribute('aria-expanded', String(!isHidden));
        return;
      }
      menus.forEach((menu) => menu.classList.add('hidden'));
      const command = target.getAttribute('data-command');
      if (command === 'stopTutorConversation' && target.disabled) return;
      if (command === 'retryTutorTurnCheck') {
        if (target.disabled || target.getAttribute('data-tutor-check-running') === 'true') return;
        target.disabled = true;
        target.setAttribute('data-tutor-check-running', 'true');
        vscode.postMessage({ command, input: target.getAttribute('data-tutor-turn') });
        return;
      }
      if (command === 'askTutorConversationTurn') {
        vscode.postMessage({ command, input: target.getAttribute('data-tutor-turn') });
        return;
      }
      if (command === 'showTutorConversationRephrase') {
        showTutorConversationRephrase(target);
        return;
      }
      if (command === 'submitTutorTool') {
        postTutorSubmit();
        return;
      }
      if (command === 'addCustomModel') {
        const modelKey = target.getAttribute('data-model-key') || '';
        const provider = target.getAttribute('data-model-provider') || '';
        const field = target.closest('.setting')?.querySelector('[data-setting="' + modelKey + '"]');
        if (field instanceof HTMLInputElement) {
          if (modelKey === 'tutor.hintModel' && !field.value.trim()) {
            vscode.postMessage({ command: 'updateSetting', key: modelKey, value: '' });
            return;
          }
          vscode.postMessage({ command, modelProvider: provider, modelId: field.value, modelKey });
        }
        return;
      }
      if (command === 'removeCustomModel') {
        vscode.postMessage({
          command,
          modelProvider: target.getAttribute('data-model-provider') || '',
          modelId: target.getAttribute('data-model-id') || ''
        });
        return;
      }
      if (command === 'saveUserDictionaryDraft' || command === 'regenerateUserDictionaryDraft') {
        postUserDictionaryDraft(command, undefined, target);
        return;
      }
      if (command === 'previewUserDictionaryPurge') {
        const selection = target.closest('.dictionary-filters')?.querySelector('[data-purge-selection]');
        if (selection instanceof HTMLSelectElement) {
          vscode.postMessage({ command, purgeSelection: selection.value });
        }
        return;
      }
      if (command === 'applyUserDictionaryImport') {
        const mode = target.getAttribute('data-import-mode');
        const duplicateStrategy = target.getAttribute('data-duplicate-strategy');
        vscode.postMessage({
          command,
          importDecision: mode === 'merge' ? { mode, duplicateStrategy } : { mode }
        });
        return;
      }
      if (command === 'applyGrammar' || command === 'copyGrammar') {
        // The box is the artifact. Recomputing from the radio buttons here would silently
        // discard whatever the reader typed into it, which is the one thing the box is for.
        const box = document.querySelector('[data-grammar-draft]');
        if (!(box instanceof HTMLTextAreaElement)) return;
        vscode.postMessage({ command, draftText: box.value });
        if (command === 'copyGrammar') confirmCopyOn(target);
        return;
      }
      // A copy button confirms itself by changing its own label, rather than raising a
      // notification. The notification it replaces was worse than noisy: it was awaited
      // inside the serial message queue, so leaving it on screen froze the whole panel.
      // Confirming on the control the user just pressed also puts the feedback where they
      // are already looking, instead of in the corner of the window.
      if (target.hasAttribute('data-copy-confirm')) confirmCopyOn(target);
      if (command === 'dictateTutorExercise') {
        // Handy types into the control that already owns keyboard focus. Focus the answer
        // before the message reaches the extension host and starts Handy.
        const answer = target.closest('.tutor-practice-panel')?.querySelector('.tutor-answer');
        if (answer instanceof HTMLTextAreaElement) answer.focus();
      }
      if (command === 'dictateTutorConversation') {
        const replies = document.querySelector('[data-tutor-conversation-replies]');
        const liveTalk = target.getAttribute('data-tutor-live-talk') === 'true' &&
          replies instanceof HTMLSelectElement && replies.value === 'liveGemini';
        if (liveTalk) {
          cancelTutorHandyAutoSend();
          if (tutorPictureMicrophoneMode()) updateTutorLiveTalk({
            available: true, listening: target.getAttribute('aria-pressed') !== 'true',
            pressToTalk: target.getAttribute('data-tutor-press-to-talk') === 'true'
          });
        } else if (target.getAttribute('data-tutor-dictation-provider') === 'handy') {
          // 2026-10-18: V263 I43, Handy pastes into a temporary capture sink, not a conversation text box.
          let capture = document.querySelector('[data-tutor-handy-capture]');
          if (!(capture instanceof HTMLElement)) {
            capture = document.createElement('div');
            capture.className = 'tutor-answer-offscreen';
            capture.setAttribute('data-tutor-handy-capture', '');
            capture.setAttribute('contenteditable', 'true');
            capture.setAttribute('aria-hidden', 'true');
            capture.setAttribute('tabindex', '-1');
            document.querySelector('[data-tutor-composer]')?.appendChild(capture);
          }
          if (target.getAttribute('aria-pressed') === 'true') armTutorHandyAutoSend(capture);
          else { cancelTutorHandyAutoSend(); capture.textContent = ''; }
          capture.focus({ preventScroll: true });
        }
      }
      if (command && activeScreen === 'tutor') {
        savePanelState({ scroll: { screen: activeScreen, top: window.scrollY } });
      }
      if (command) vscode.postMessage({
        command,
        variantId: target.getAttribute('data-variant-id') || undefined,
        action: target.getAttribute('data-action') || undefined,
        entryId: target.getAttribute('data-entry-id') || undefined,
        issueId: target.getAttribute('data-grammar-issue') || undefined,
        format: target.getAttribute('data-export-format') || undefined,
        selectedOnly: target.getAttribute('data-selected-only') === 'true',
        targetId: target.getAttribute('data-tutor-target') || undefined,
        ...(command === 'updateTutorTarget' ? { keyboardFocus: event.detail === 0 } : {}),
        mapLevel: target.getAttribute('data-tutor-map-level') || undefined,
        role: target.getAttribute('data-tutor-role') || undefined,
        exampleId: target.getAttribute('data-tutor-example') || undefined,
        exerciseId: target.getAttribute('data-tutor-exercise') || undefined,
        tool: target.getAttribute('data-tutor-tool') || undefined
      });
      const audioUrl = target.getAttribute('data-audio-url');
      if (audioUrl) void playPronunciation(audioUrl, false);
    });
    // Keep the mounted document, viewport and focused Refresh button during discovery.
    let panelProgressOverlay = ${options.busyNotice ? "document.querySelector('.busy-overlay:not([data-kren-notice])')" : 'null'};
    function patchPanelProgress(notice, cancelId) {
      if (typeof notice === 'string' && notice) {
        if (!panelProgressOverlay) {
          panelProgressOverlay = document.createElement('div');
          panelProgressOverlay.className = 'busy-overlay';
          panelProgressOverlay.setAttribute('role', 'alert');
          panelProgressOverlay.setAttribute('aria-live', 'assertive');
          const card = document.createElement('div');
          card.className = 'busy-card';
          const spinner = document.createElement('span');
          spinner.className = 'busy-spinner';
          spinner.setAttribute('aria-hidden', 'true');
          const text = document.createElement('span');
          text.className = 'popup-message';
          card.append(spinner, text);
          panelProgressOverlay.append(card);
          document.body.append(panelProgressOverlay);
        }
        panelProgressOverlay.querySelector('.busy-card').classList.toggle('popup-long-message', notice.length > 120);
        panelProgressOverlay.querySelector('.popup-message').textContent = notice;
        const card = panelProgressOverlay.querySelector('.busy-card');
        let cancel = card.querySelector('[data-command="cancelPanelProgress"]');
        if (typeof cancelId === 'number') {
          const created = !cancel;
          if (!cancel) {
            cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'secondary';
            cancel.setAttribute('data-command', 'cancelPanelProgress');
            cancel.textContent = 'Cancel';
            card.append(cancel);
          }
          cancel.setAttribute('data-operation-id', String(cancelId));
          if (created) cancel.focus({ preventScroll: true });
        } else cancel?.remove();
        panelProgressOverlay.style.display = '';
        document.body.setAttribute('data-busy', '');
      } else {
        // A notice can temporarily detach this card. Mark it retired so the notice
        // script cannot restore a completed wait when the reader dismisses that notice.
        if (panelProgressOverlay) {
          panelProgressOverlay.setAttribute('data-panel-progress-retired', '');
          panelProgressOverlay.remove();
          panelProgressOverlay = null;
        }
        const otherBusy = Array.from(document.querySelectorAll('.busy-overlay:not([data-kren-notice])'))
          .some(card => card !== panelProgressOverlay && card.style.display !== 'none');
        if (!otherBusy) document.body.removeAttribute('data-busy');
      }
    }
    window.addEventListener('message', (event) => {
      const message = event.data;
      void Promise.resolve().then(linkCredentialReasons);
      if (!message) return;
      if (message.command === 'panelProgress') patchPanelProgress(message.notice, message.cancelId);
      if (message.command === 'panelThemeChanged') applyPanelTheme(message);
      if (message.resetAvailability) syncTutorResetAvailability(message);
      if (message.command === 'playPronunciation' && typeof message.url === 'string') {
        void playPronunciation(message.url, true);
      }
      if (message.command === 'playGeneratedAudio' &&
          typeof message.audioBase64 === 'string' && player instanceof HTMLAudioElement) {
        // 2026-10-11: A canceled play promise belongs to its old clip, never its replacement.
        const generation = ++generatedAudioGeneration;
        generatedAudioPlaybackId = message.playbackId;
        player.pause();
        playerMode = 'generated';
        player.classList.add('hidden');
        player.src = 'data:audio/mpeg;base64,' + message.audioBase64;
        player.volume = typeof message.volume === 'number' ? Math.max(0, Math.min(1, message.volume / 100)) : 1;
        void player.play().catch((error) => {
          if (generation !== generatedAudioGeneration || playerMode !== 'generated') return;
          playerMode = 'idle';
          vscode.postMessage({ command: 'generatedAudioFailed', playbackId: generatedAudioPlaybackId, cause: error?.name });
        });
      }
      if (message.command === 'stopGeneratedAudio' &&
          player instanceof HTMLAudioElement && playerMode === 'generated') {
        generatedAudioGeneration++;
        playerMode = 'idle';
        player.pause();
        player.removeAttribute('src');
        player.load();
      }
      if (message.command === 'requestGeneratedAudioReady') vscode.postMessage({ command: 'generatedAudioReady' });
      if (message.command === 'tutorLiveReplyFragment') appendTutorLiveReply(message);
      if (message.command === 'tutorConversationDemoLine') appendTutorConversationDemoLine(message);
      if (message.command === 'tutorLiveInputStarted') {
        appendTutorLiveInput({ text: '', reset: true, started: true });
      }
      if (message.command === 'tutorLiveInputFragment') appendTutorLiveInput(message);
      if (message.command === 'tutorLiveInputCommitted') commitTutorLiveInput(message);
      if (message.command === 'tutorConversationPictureStyleSetting') {
        const control = document.querySelector('[data-setting="tutor.conversation.pictureStyle"]');
        if (control instanceof HTMLSelectElement && ['realistic', 'illustrated'].includes(message.value)) control.value = message.value;
        syncTutorConversationPictureSettings();
        syncTutorConversationAdvancedSummary();
      }
      if (message.command === 'languageModelUsage') {
        const usage = document.querySelector('[data-language-model-usage]');
        if (usage && typeof message.html === 'string') {
          usage.innerHTML = message.html;
          sizeLanguageModelUsage();
        }
        return;
      }
      if (message.command === 'tutorConversationHandoff') {
        if (typeof message.reconnecting === 'boolean') {
          const chat = document.querySelector('[data-tutor-transcript]');
          chat?.querySelector('[data-tutor-handoff-connecting]')?.remove();
          if (message.reconnecting && chat instanceof HTMLElement) {
            const note = document.createElement('p');
            note.setAttribute('data-tutor-handoff-connecting', '');
            note.setAttribute('role', 'status');
            note.textContent = message.note;
            chat.appendChild(note);
          }
        } else {
          const turn = document.querySelector('[data-tutor-learner-turn="' + message.index + '"]');
          if (turn instanceof HTMLElement && !turn.querySelector('[data-tutor-handoff]')) {
            const note = document.createElement('p');
            note.setAttribute('data-tutor-handoff', '');
            note.setAttribute('role', 'status');
            note.textContent = message.note;
            turn.appendChild(note);
          }
        }
      }
      if (message.command === 'providerSwitchSettings') {
        const region = document.querySelector('[data-provider-switch-settings]');
        if (region instanceof HTMLElement) {
          const active = document.activeElement;
          const provider = active?.closest('[data-provider]')?.getAttribute('data-provider');
          const move = active?.getAttribute('data-provider-move');
          const setting = active?.getAttribute('data-setting');
          region.innerHTML = message.html;
          if (provider && move) {
            const selected = region.querySelector('[data-provider="' + provider + '"] [data-provider-move="' + move + '"]');
            const enabled = selected instanceof HTMLButtonElement && selected.disabled
              ? region.querySelector('[data-provider="' + provider + '"] [data-provider-move="' + (move === '-1' ? '1' : '-1') + '"]') : selected;
            enabled?.focus();
          } else if (setting === 'llm.providerSwitch') region.querySelector('[data-setting="llm.providerSwitch"]')?.focus();
        }
      }
      if (message.command === 'tutorConversationHintPrefetchSetting') {
        const control = document.querySelector('[data-setting="tutor.conversation.hintPrefetch"]');
        if (control instanceof HTMLInputElement) control.checked = message.value === true;
      }
      if (message.command === 'tutorConversationTakeHomeSetting') {
        const control = document.querySelector('[data-setting="tutor.conversation.takeHome"]');
        if (control instanceof HTMLInputElement) control.checked = message.value === true;
        syncTutorConversationAdvancedSummary();
        syncTutorConversationReviewSetting(message.value === true);
      }
      if (message.command === 'tutorTakeHomeReady') patchTutorTakeHome(message);
      if (message.command === 'tutorConversationReviewReady') {
        const slot = document.querySelector('[data-tutor-review-action-slot]');
        if (slot instanceof HTMLElement) slot.innerHTML = message.html;
      }
      if (message.command === 'tutorLessonSourceReverted') {
        const source = document.querySelector('[data-tutor-conversation-from]');
        if (source instanceof HTMLSelectElement) { source.value = message.source; syncTutorConversationMode(source); }
      }
      if (message.command === 'tutorPicturePaused') {
        const notice = document.querySelector('[data-tutor-picture-paused]');
        if (notice instanceof HTMLElement) {
          notice.textContent = message.text;
          if (message.text?.includes('KREN menu, Credentials')) {
            const link = document.createElement('a');
            link.href = '#'; link.dataset.command = 'showCredentials'; link.textContent = 'Open Credentials';
            notice.append(' ', link);
          }
          notice.hidden = !message.text;
        }
      }
      if (message.command === 'credentialPresenceReady') {
        credentialPresence = message.presence;
        applyConditionalSettings();
      }
      if (message.command === 'modelCatalogReady') patchModelCatalog(message);
      if (message.command === 'tutorVoiceModelReady') holdScroll(() => patchTutorVoiceModel(message));
      if (message.command === 'tutorConversationRender') patchTutorConversationRender(message);
      if (message.command === 'tutorConversationSceneReady') patchTutorConversationScene(message);
      if (message.command === 'tutorConversationPictureRequestFinished') tutorPictureRequestPending = false;
      if (message.command === 'tutorConversationPictureCancelled') cancelTutorConversationPictureDecode(message);
      if (message.command === 'tutorConversationPictureReady') patchTutorConversationPicture(message);
      if (message.command === 'tutorConversationPictureTransparencyReady') patchTutorConversationPictureTransparency(message);
      if (message.command === 'tutorConversationBalloonTransparencyReady') patchTutorConversationBalloonTransparency(message);
      if (message.command === 'tutorConversationOpeningReady') patchTutorConversationOpening(message);
      if (message.command === 'tutorLiveConversationReady') markTutorLiveConversationReady(message);
      if (message.command === 'tutorLiveTurnCommitted') commitTutorLiveTurn(message);
      if (message.command === 'tutorLiveTurnCoaching') patchLateTutorLiveCoaching(message);
      if (message.command === 'tutorLiveTurnCancelled') cancelTutorLiveTurn(message);
      if (message.command === 'tutorLiveTalkState') updateTutorLiveTalk(message);
      if (message.command === 'tutorLiveInputDiscarded') discardTutorLiveInput();
      if (message.command === 'tutorLiveIgnoredTurnComplete') markTutorLiveConversationReady(message);
      if (message.command === 'tutorTurnCheckAvailability') updateTutorTurnCheckAvailability(message);
      if (message.command === 'tutorConversationLiveTranscriptionLanguage') {
        const control = document.querySelector('[data-setting="tutor.conversation.liveTranscriptionLanguage"]');
        if (control instanceof HTMLSelectElement) control.value = message.value;
        syncTutorConversationAdvancedSummary();
      }
      if (message.command === 'tutorConversationSpeechDetection') patchTutorConversationSpeechDetection(message);
      if (message.command === 'tutorConversationPauseBeforeReply') patchTutorConversationPauseBeforeReply(message);
      if (message.command === 'tutorConversationStopState') updateTutorConversationStop(message);
      if (message.command === 'tutorConversationHintState') updateTutorConversationHint(message);
      if (message.command === 'tutorConversationReplayState') {
        updateTutorConversationReplay(message.available === true);
      }
      if (message.command === 'tutorLiveSpeakerState') {
        const control = document.querySelector('[data-command="toggleTutorConversationSpeaker"]');
        if (control instanceof HTMLButtonElement) {
          const speakerOn = message.speakerOn === true;
          const label = speakerOn ? 'Turn speaker off' : 'Turn speaker on';
          control.setAttribute('aria-pressed', String(speakerOn));
          control.setAttribute('aria-label', label);
          control.title = label;
          control.innerHTML = speakerOn
            ? ${JSON.stringify(iconSvgMarkup('speaker'))}
            : ${JSON.stringify(iconSvgMarkup('speakerOff'))};
        }
        updateTutorLiveReplay(message.replayAvailable === true);
        updateTutorReplayMode();
      }
      if (message.command === 'tutorDictationState') {
        const conversationTarget = message.conversation === true;
        const activeExerciseId = typeof message.exerciseId === 'string'
          ? message.exerciseId
          : undefined;
        const state = message.state === 'transcribing' || message.state === 'idle'
          ? message.state
          : activeExerciseId || conversationTarget ? 'recording' : 'idle';
        const provider = message.provider === 'gemini' ? 'Gemini' : message.provider === 'cloudflare' ? 'Cloudflare' : message.provider === 'groq' ? 'Groq' : 'Handy';
        for (const control of document.querySelectorAll(
          'button[data-command="dictateTutorExercise"], button[data-command="dictateTutorConversation"]'
        )) {
          if (!(control instanceof HTMLButtonElement)) continue;
          const conversationControl = control.getAttribute('data-command') === 'dictateTutorConversation';
          if (conversationControl && control.getAttribute('data-tutor-live-talk') === 'true') continue;
          const ownsState = conversationTarget
            ? conversationControl
            : !conversationControl && control.getAttribute('data-tutor-exercise') === activeExerciseId;
          const dictating = ownsState && state === 'recording';
          const transcribing = ownsState && state === 'transcribing';
          const subject = conversationControl ? 'your conversation answer' : 'your answer';
          const handyLabel = (dictating ? 'Pause' : 'Start') + ' Handy' +
            (conversationControl ? ' conversation' : '') + ' dictation';
          const label = transcribing
            ? provider + ' is transcribing ' + subject
            : provider === 'Handy' ? handyLabel : dictating
              ? 'Stop speaking ' + subject + ' with ' + provider
              : 'Speak ' + subject + ' with ' + provider;
          control.setAttribute('aria-pressed', String(dictating));
          control.setAttribute('aria-label', label);
          control.title = provider === 'Handy' && !transcribing ? handyLabel : dictating
            ? 'Press again to stop ' + provider + (conversationControl ? ' conversation' : '') + ' dictation'
            : label;
          control.disabled = transcribing || (!dictating &&
            control.getAttribute('data-tutor-dictation-disabled') === 'true');
          control.classList.toggle('tutor-dictation-active', dictating);
          control.classList.toggle('tutor-microphone-pulsing', dictating);
          control.innerHTML = dictating && provider === 'Handy'
            ? ${JSON.stringify(panelIconSvgMarkup('pause'))}
            : ${JSON.stringify(iconSvgMarkup('microphone'))};
          if (ownsState) {
            control.setAttribute(
              'data-tutor-dictation-provider', message.provider === 'gemini' ? 'gemini' : message.provider === 'cloudflare' ? 'cloudflare' : message.provider === 'groq' ? 'groq' : 'handy'
            );
          }
          if (!conversationControl) updateTutorPracticeTranscription(
            control, transcribing && typeof message.transcript !== 'string'
          );
        }
        if (conversationTarget && typeof message.transcript === 'string') {
          vscode.postMessage({ command: 'updateTutorConversationAnswer', answer: message.transcript, spoken: true });
          vscode.postMessage({ command: 'submitTutorConversationTurn' });
        } else if (activeExerciseId && typeof message.transcript === 'string') {
          const answer = document.querySelector(
            'textarea[data-tutor-exercise="' + activeExerciseId + '"]'
          );
          if (answer instanceof HTMLTextAreaElement) {
            const separator = answer.value && !/\s$/u.test(answer.value) ? ' ' : '';
            answer.value = answer.value + separator + message.transcript;
            const exercise = answer.closest('.tutor-practice-panel');
            const batchAction = exercise?.querySelector('[data-command="reviewUnreviewedTutorExercises"]');
            syncTutorReviewState(answer.value, answer.closest('.tutor-practice-panel'));
            if (batchAction instanceof HTMLButtonElement) syncTutorReviewAvailability(answer.value, batchAction);
            vscode.postMessage({
              command: 'updateTutorAnswer',
              exerciseId: activeExerciseId,
              answer: answer.value
            });
          }
        }
      }
      if (message.command === 'tutorReplayAllState') {
        const control = document.querySelector('[data-command="replayTutorQuestion"]');
        if (control instanceof HTMLButtonElement) {
          const pressed = message.pressed === true;
          control.setAttribute('aria-pressed', String(pressed));
          control.innerHTML = pressed
            ? ${JSON.stringify(iconSvgMarkup('stop'))}
            : ${JSON.stringify(iconSvgMarkup('replay'))};
          updateTutorReplayMode();
        }
      }
    });
    document.querySelector('.busy-overlay [data-command="cancelPanelProgress"]')?.focus({ preventScroll: true });
    if (player instanceof HTMLAudioElement) {
      player.addEventListener('playing', () => {
        if (playerMode === 'generated') vscode.postMessage({ command: 'generatedAudioStarted', playbackId: generatedAudioPlaybackId });
      });
      player.addEventListener('ended', () => {
        if (playerMode !== 'generated' || !player.ended) return;
        playerMode = 'idle';
        vscode.postMessage({ command: 'generatedAudioEnded', playbackId: generatedAudioPlaybackId });
      });
      player.addEventListener('error', () => {
        if (playerMode !== 'generated' || !player.error) return;
        playerMode = 'idle';
        vscode.postMessage({ command: 'generatedAudioFailed', playbackId: generatedAudioPlaybackId, cause: player.error.code });
      });
    }
    document.addEventListener('change', (event) => {
      const conversationControl = event.target;
      if (conversationControl instanceof HTMLSelectElement || conversationControl instanceof HTMLTextAreaElement ||
          conversationControl instanceof HTMLInputElement) {
        for (const [attribute, command] of [
          ['data-tutor-conversation-from', 'updateTutorConversationFrom'],
          ['data-tutor-conversation-situation', 'updateTutorConversationSituation'],
          ['data-tutor-conversation-role-swapped', 'updateTutorConversationRoleSwapped'],
          ['data-tutor-conversation-starts', 'updateTutorConversationStarts'],
          ['data-tutor-conversation-register', 'updateTutorConversationRegister'],
          ['data-tutor-conversation-coaching', 'updateTutorConversationCoaching'],
          ['data-tutor-conversation-send', 'updateTutorConversationSend'],
          ['data-tutor-conversation-replies', 'updateTutorConversationReplies'],
          ['data-tutor-conversation-reply-length', 'updateTutorConversationReplyLength'],
          ['data-tutor-conversation-situation-picture', 'updateTutorConversationSituationPicture'],
          ['data-tutor-conversation-picture-transparency', 'updateTutorConversationPictureTransparency'],
          ['data-tutor-conversation-balloon-transparency', 'updateTutorConversationBalloonTransparency'],
          ['data-tutor-conversation-live-voice', 'updateTutorConversationLiveVoice'],
          ['data-tutor-conversation-custom', 'updateTutorConversationCustom']
        ]) {
          if (conversationControl.hasAttribute(attribute)) {
            syncTutorConversationMode(conversationControl);
            vscode.postMessage({
              command,
              input: conversationControl instanceof HTMLInputElement &&
                conversationControl.type === 'checkbox'
                ? String(conversationControl.checked)
                : conversationControl.value
            });
            return;
          }
        }
      }
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
      if (target.hasAttribute('data-grammar-choice')) {
        // Recomputing replaces the box, so an edit made in it is about to be lost. Losing it
        // in silence is the defect; the reader is asked first and the radio is put back if
        // they decline. confirm() is available in a webview and blocks only this document.
        const box = document.querySelector('[data-grammar-draft]');
        if (box instanceof HTMLTextAreaElement &&
            box.value !== box.defaultValue &&
            !window.confirm(
              'Changing a correction rebuilds the corrected text and discards your edits to it. Continue?'
            )) {
          const previous = document.querySelector(
            '[data-grammar-issue="' + (target.getAttribute('data-grammar-issue') || '') +
            '"][data-grammar-choice="' + (target.getAttribute('data-was-checked') || '') + '"]'
          );
          if (previous instanceof HTMLInputElement) previous.checked = true;
          else target.checked = false;
          return;
        }
        // The corrected text is produced by core from the full choice set, so a click has
        // to go back to the extension rather than being patched into the box here. A second
        // implementation of that assembly in the webview is the copy that drifts.
        vscode.postMessage({
          command: 'updateGrammarChoice',
          issueId: target.getAttribute('data-grammar-issue') || '',
          suggestionIndex: Number(target.getAttribute('data-grammar-choice'))
        });
        return;
      }
      if (target instanceof HTMLSelectElement && target.hasAttribute('data-model-preset')) {
        // Custom is not a model. Selecting it leaves the stored value alone and hands the
        // reader to the field below, which is where a model outside the list is entered.
        const modelKey = target.getAttribute('data-model-preset') || '';
        if (!modelKey) return;
        const row = target.closest('[data-llm-routing]')?.querySelector('[data-model-identifier="' + modelKey + '"]');
        const field = row?.querySelector('input');
        if (row instanceof HTMLElement) row.hidden = target.value !== '__custom__';
        if (target.value === '__custom__') {
          if (field instanceof HTMLInputElement) field.focus();
          return;
        }
        if (field instanceof HTMLInputElement) field.value = '';
        vscode.postMessage({ command: 'updateSetting', key: modelKey, value: target.value });
        return;
      }
      if (target instanceof HTMLSelectElement && target.hasAttribute('data-edge-voice-preset')) {
        if (target.value === '__custom__') return;
        const voiceKey = target.getAttribute('data-edge-voice-preset') || '';
        if (!voiceKey) return;
        const input = document.querySelector('[data-setting="' + voiceKey + '"]');
        if (input instanceof HTMLInputElement) input.value = target.value;
        vscode.postMessage({ command: 'updateSetting', key: voiceKey, value: target.value });
        return;
      }
      if (target instanceof HTMLSelectElement && target.hasAttribute('data-rewrite-mode')) {
        if (target.value !== 'custom') {
          vscode.postMessage({ command: 'applyRewriteMode', modeId: target.value });
        }
        return;
      }
      if (target.hasAttribute('data-dictionary-select')) {
        const entryIds = Array.from(document.querySelectorAll('[data-dictionary-select]:checked'))
          .map((input) => input.getAttribute('data-entry-id') || '').filter(Boolean);
        vscode.postMessage({ command: 'selectUserDictionaryEntries', entryIds });
        return;
      }
      if (target.hasAttribute('data-dictionary-filter')) {
        postUserDictionaryQuery();
        return;
      }
      if (target instanceof HTMLSelectElement && target.hasAttribute('data-draft-capture-mode')) {
        postUserDictionaryDraft('changeUserDictionaryDraftCaptureMode', target.value, target);
        return;
      }
      if (target instanceof HTMLSelectElement && target.hasAttribute('data-tutor-voice-command')) {
        vscode.postMessage({
          command: target.getAttribute('data-tutor-voice-command') || '',
          input: target.value
        });
        return;
      }
      if (target instanceof HTMLSelectElement && target.hasAttribute('data-tutor-map-level')) {
        if (target.getAttribute('aria-disabled') === 'true') return;
        syncTutorTargetActions(target);
        vscode.postMessage({
          command: 'updateTutorMapPath',
          mapLevel: target.getAttribute('data-tutor-map-level') || '',
          targetId: target.value
        });
        return;
      }
      if (target instanceof HTMLSelectElement &&
          target.hasAttribute('data-tutor-tool-target-language')) {
        vscode.postMessage({
          command: 'updateTutorToolTargetLanguage',
          targetLanguage: target.value
        });
        return;
      }
      if (target.closest('[data-model-identifier]')) return;
      const key = target.getAttribute('data-setting');
      if (!key) return;
      // 2026-10-11: Edge and Chirp share one stored speed, so switching sources keeps it current.
      if (key === 'tutor.readAloud.edgeRatePercent') document.querySelectorAll('[data-setting="tutor.readAloud.edgeRatePercent"]').forEach((control) => { control.value = target.value; });
      // 2026-10-13: Read Aloud keeps its own locale and speed current across source switches.
      if (key === 'readAloud.edgeRatePercent' || key === 'readAloud.edgeLocale') document.querySelectorAll('[data-setting="' + key + '"]').forEach((control) => { control.value = target.value; });
      const value = target instanceof HTMLInputElement && target.type === 'checkbox'
        ? target.checked
        : target instanceof HTMLInputElement && target.type === 'number'
          // Shown in seconds, stored in milliseconds. The multiplication lives here, beside
          // the division in secondsSetting, so the two cannot drift apart.
          ? Number(target.value) * (target.hasAttribute('data-seconds') ? 1000 : 1)
          : target.value;
      vscode.postMessage({ command: 'updateSetting', key, value });
      applyConditionalSettings();
    });
    function patchModelCatalog(message) {
      const focused = document.activeElement;
      const left = window.scrollX;
      const top = window.scrollY;
      document.querySelectorAll('select[data-model-catalog]').forEach(select => {
        if (select.getAttribute('data-model-catalog') !== message.catalog) return;
        const selected = select.value;
        const selectedLabel = select.selectedOptions[0]?.textContent || selected;
        const custom = JSON.parse(select.getAttribute('data-model-customs') || '[]');
        const models = [...custom.map(id => ({ id, displayName: id })),
          ...message.models.filter(model => !custom.includes(model.id))];
        // A catalog never writes a setting, including when discovery omits its current model.
        if (selected !== '__custom__' && !models.some(model => model.id === selected)) {
          models.push({ id: selected, displayName: selectedLabel });
        }
        const options = models.map(model => {
          const option = document.createElement('option');
          option.setAttribute('value', model.id);
          option.textContent = model.displayName;
          return option;
        });
        const other = document.createElement('option');
        other.setAttribute('value', '__custom__');
        other.textContent = 'Custom model identifier';
        select.replaceChildren(...options, other);
        select.value = selected;
      });
      applyCredentialGray();
      if (focused instanceof HTMLElement && focused.isConnected) focused.focus({ preventScroll: true });
      if (window.scrollX !== left || window.scrollY !== top) window.scrollTo(left, top);
    }

    function patchTutorVoiceModel(message) {
      const selector = 'details[data-persist-id="tutor-setting"]';
      const current = document.querySelector(selector);
      const nextPage = new DOMParser().parseFromString(message.html, 'text/html');
      const next = nextPage.querySelector(selector);
      if (!current || !next) return;
      const disclosures = new Map();
      current.querySelectorAll('details[data-persist-id]').forEach((section) => {
        disclosures.set(section.getAttribute('data-persist-id'), section.open);
      });
      current.innerHTML = next.innerHTML;
      current.querySelectorAll('details[data-persist-id]').forEach((section) => {
        const id = section.getAttribute('data-persist-id');
        if (disclosures.has(id)) section.open = disclosures.get(id);
      });
      if (message.speechProviderChanged) {
        for (const command of ['dictateTutorExercise', 'dictateTutorConversation']) {
          const selector = '[data-command="' + command + '"]';
          const microphone = nextPage.querySelector(selector);
          if (!(microphone instanceof HTMLButtonElement)) continue;
          document.querySelectorAll(selector).forEach(control => {
            if (!(control instanceof HTMLButtonElement)) return;
            for (const name of ['aria-pressed', 'aria-label', 'data-tutor-live-talk',
              'data-tutor-press-to-talk', 'data-tutor-dictation-disabled',
              'data-tutor-dictation-route-unavailable', 'data-tutor-dictation-provider']) {
              control.setAttribute(name, microphone.getAttribute(name) || '');
            }
            control.className = microphone.className;
            control.title = microphone.title;
            control.disabled = microphone.disabled;
            control.innerHTML = microphone.innerHTML;
          });
        }
      }
      applyConditionalSettings();
    }

    function patchTutorConversationSpeechDetection(message) {
      const control = document.querySelector('[data-setting="tutor.conversation.speechDetection"]');
      if (control && ['kren', 'geminiKren'].includes(message.value)) control.value = message.value;
      syncTutorConversationAdvancedSummary();
    }
    function patchTutorConversationPauseBeforeReply(message) {
      if (![1, 2, 3, 4, 5].includes(message.seconds)) return;
      const control = document.querySelector('[data-setting="tutor.conversation.pauseBeforeReply"]');
      if (!control) return;
      control.value = String(message.seconds);
      syncTutorConversationAdvancedSummary();
    }
    function syncTutorConversationAdvancedSummary() {
      const summary = document.querySelector('[data-tutor-conversation-advanced] > summary .rewrite-group-summary');
      if (!(summary instanceof HTMLElement)) return;
      const selectedText = (selector) => {
        const control = document.querySelector(selector);
        return control instanceof HTMLSelectElement ? control.selectedOptions[0]?.textContent || '' : '';
      };
      summary.textContent = tutorConversationAdvancedSummary({
        send: 'When I stop speaking',
        replies: selectedText('[data-tutor-conversation-replies]'),
        pictureStyle: selectedText('[data-setting="tutor.conversation.pictureStyle"]'),
        pictureTransparency: selectedText('[data-tutor-conversation-picture-transparency]'),
        balloonTransparency: selectedText('[data-tutor-conversation-balloon-transparency]'),
        microphoneSensitivity: selectedText('[data-setting="tutor.conversation.microphoneSensitivity"]'),
        pauseBeforeReply: selectedText('[data-setting="tutor.conversation.pauseBeforeReply"]'),
        speechDetection: selectedText('[data-setting="tutor.conversation.speechDetection"]'),
        microphoneCloseWait: selectedText('[data-setting="tutor.conversation.microphoneCloseWait"]'),
        liveTranscriptionLanguage: selectedText('[data-setting="tutor.conversation.liveTranscriptionLanguage"]'),
        pressToTalk: document.querySelector('[data-setting="tutor.conversation.pressToTalk"]')?.checked ? 'On' : 'Off',
        takeHome: document.querySelector('[data-setting="tutor.conversation.takeHome"]')?.checked ? 'On' : 'Off'
      });
    }
    function syncTutorConversationReviewSetting(enabled) {
      const button = document.querySelector('[data-tutor-review-action]');
      if (!(button instanceof HTMLButtonElement)) return;
      const review = enabled && button.getAttribute('data-review-ready') !== 'true';
      const available = button.getAttribute('data-review-available') === 'true';
      const busy = button.getAttribute('data-review-busy') === 'true';
      const answered = Number(button.getAttribute('data-review-answered'));
      button.hidden = review && !available;
      button.setAttribute('data-command', review ? 'reviewTutorConversation' : 'diagnoseTutorConversation');
      button.textContent = review ? 'Review now' : 'More details';
      button.disabled = busy || (!review && answered < 5);
      button.title = !review && answered < 5 ? 'Needs five answered turns.' : busy ? 'Wait for the current request to finish.' : '';
    }
    function patchTutorTakeHome(message) {
      const card = document.querySelector('[data-tutor-take-home]');
      if (card instanceof HTMLElement) card.innerHTML = message.html;
    }
    function syncTutorConversationMode(control) {
      syncTutorConversationPictureSettings();
      syncTutorPictureMicrophone();
      const source = document.querySelector('[data-tutor-conversation-from]');
      const situation = document.querySelector('[data-tutor-conversation-situation]');
      const roleSwapped = document.querySelector('[data-tutor-conversation-role-swapped]');
      const starts = document.querySelector('[data-tutor-conversation-starts]');
      const register = document.querySelector('[data-tutor-conversation-register]');
      const coaching = document.querySelector('[data-tutor-conversation-coaching]');
      const send = document.querySelector('[data-tutor-conversation-send]');
      const replies = document.querySelector('[data-tutor-conversation-replies]');
      const replyLength = document.querySelector('[data-tutor-conversation-reply-length]');
      const situationPicture = document.querySelector('[data-tutor-conversation-situation-picture]');
      const sourceDescription = source?.closest('label')?.querySelector('.setting-description');
      if (source instanceof HTMLSelectElement && sourceDescription instanceof HTMLElement) {
        sourceDescription.textContent = source.value === 'lesson' && source.getAttribute('data-tutor-lesson-ready') === 'false'
          ? ${JSON.stringify(TUTOR_LESSON_UNAVAILABLE)} : 'Where the conversation takes its subject.';
      }
      const pauseDescription = document.querySelector('[data-setting="tutor.readAloud.sentencePauseMilliseconds"]')
        ?.closest('label')?.querySelector('.setting-description');
      if (replies instanceof HTMLSelectElement && pauseDescription instanceof HTMLElement) {
        pauseDescription.textContent = replies.value === 'liveGemini'
          ? 'Gemini Live sets its own pauses.' : 'Pause between sentences in tutor speech.';
      }
      const summary = document.querySelector(
        '[data-persist-id="tutor-conversation-mode"] > summary .rewrite-group-summary'
      );
      const selectedText = (select) => select instanceof HTMLSelectElement
        ? select.selectedOptions[0]?.textContent || '' : '';
      if (summary instanceof HTMLElement && source instanceof HTMLSelectElement &&
          situation instanceof HTMLSelectElement && roleSwapped instanceof HTMLInputElement &&
          starts instanceof HTMLSelectElement && register instanceof HTMLSelectElement &&
          coaching instanceof HTMLSelectElement &&
          replies instanceof HTMLSelectElement &&
          situationPicture instanceof HTMLSelectElement &&
          replyLength instanceof HTMLSelectElement) {
        summary.textContent = 'Source: ' + selectedText(source) + ' | Situation: ' +
          (source.value !== 'anything' ? selectedText(situation) : 'Not used') +
          ' | Roles: ' + (roleSwapped.checked ? 'Swapped' : 'Usual') +
          ' | Who starts: ' + selectedText(starts) +
          ' | Register: ' + selectedText(register) + ' | Correction: ' + selectedText(coaching) +
          ' | Sends when you stop' +
          ' | Reply: ' + selectedText(replies) + ' | Picture: ' + selectedText(situationPicture) +
          (replyLength.value === 'short' ? '' : ' | Reply length: ' + selectedText(replyLength));
      }
      syncTutorConversationAdvancedSummary();
      const replay = document.querySelector('[data-command="replayTutorQuestion"]');
      applyConditionalSettings();
      updateTutorLiveReplay(
        replay instanceof HTMLElement &&
          replay.getAttribute('data-tutor-live-audio-available') === 'true'
      );
      updateTutorReplayMode();
      if (!control.hasAttribute('data-tutor-conversation-coaching') ||
          !(coaching instanceof HTMLSelectElement) ||
          !document.querySelector('[data-tutor-composer]')) return;
      document.querySelectorAll('[data-tutor-turn-feedback]').forEach((feedback) => {
        if (feedback instanceof HTMLElement) feedback.hidden = coaching.value === 'afterwards';
      });
    }
    function syncTutorReviewState(answer, panel) {
      if (!panel) return;
      const retry = panel.querySelector('[data-tutor-review-retry]');
      if (retry) {
        retry.disabled = panel.getAttribute('data-review-busy') === 'true' || !String(answer).trim();
        retry.setAttribute('aria-disabled', String(retry.disabled));
      }
      const retryEmpty = panel.querySelector('[data-tutor-review-retry-empty]');
      if (retryEmpty) retryEmpty.hidden = Boolean(String(answer).trim());
      const next = panel.querySelector('[data-command="showNextTutorExercise"]');
      if (next) {
        next.disabled = panel.getAttribute('data-review-busy') === 'true' || (!String(answer).trim() && panel.getAttribute('data-item-reviewed') !== 'true') || panel.getAttribute('data-next-destination') !== 'true';
        next.setAttribute('aria-disabled', String(next.disabled));
      }
      const stale = panel.querySelector('[data-tutor-review-outdated]');
      if (stale) stale.classList.toggle('hidden', panel.getAttribute('data-item-reviewed') !== 'true' || String(answer).trim() === panel.getAttribute('data-reviewed-answer'));
    }
    function syncTutorReviewAvailability(answer, control) {
      const panel = control.closest('.tutor-practice-panel');
      syncTutorReviewState(answer, panel);
      const answered = Boolean(String(answer).trim());
      const busy = panel.getAttribute('data-review-busy') === 'true';
      const batch = control.getAttribute('data-review-all') === 'true';
      const firstOther = Number(control.getAttribute('data-first-unanswered-other') || '-1');
      const itemNumber = Number(panel.getAttribute('data-item-number'));
      const firstUnanswered = answered ? firstOther : (firstOther < 0 ? itemNumber : Math.min(firstOther, itemNumber));
      const pending = control.getAttribute('data-pending-other') === 'true' || String(answer).trim() !== control.getAttribute('data-reviewed-answer');
      control.disabled = busy || (batch ? firstUnanswered >= 0 || !pending : !answered);
      control.setAttribute('aria-disabled', String(control.disabled));
      if (batch) control.setAttribute('title', firstUnanswered >= 0 ? 'Answer item ' + firstUnanswered + ' first' : !pending ? 'All current answers are reviewed. Edit an answer to enable Review all' : 'Review all answered items without reviews');
      const next = panel.querySelector('[data-command="showNextTutorExercise"]');
      if (next) {
        next.disabled = busy || (!answered && panel.getAttribute('data-item-reviewed') !== 'true') || panel.getAttribute('data-next-destination') !== 'true';
        next.setAttribute('aria-disabled', String(next.disabled));
      }
    }
    document.addEventListener('keydown', (event) => {
      const target = event.target;
      if (event.key !== 'Enter' ||
          !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) ||
          !target.hasAttribute('data-tutor-map-search')) return;
      event.preventDefault();
      postTutorFind();
    });
    document.addEventListener('input', (event) => {
      const target = event.target;
      if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
          target.hasAttribute('data-tutor-map-search')) {
        filterTutorMap(target.value);
        syncTutorDraftAvailability(target.value);
        vscode.postMessage({ command: 'updateTutorSearch', search: target.value });
        return;
      }
      if (target instanceof HTMLTextAreaElement && target.hasAttribute('data-tutor-answer')) {
        const exercise = target.closest('.tutor-practice-panel');
        syncTutorReviewState(target.value, exercise);
        const batchAction = exercise?.querySelector('[data-command="reviewUnreviewedTutorExercises"]');
        if (batchAction instanceof HTMLButtonElement) syncTutorReviewAvailability(target.value, batchAction);
        vscode.postMessage({
          command: 'updateTutorAnswer',
          exerciseId: target.getAttribute('data-tutor-exercise') || '',
          answer: target.value
        });
        return;
      }
      if (target instanceof HTMLTextAreaElement &&
          target.hasAttribute('data-tutor-conversation-answer')) {
        if (event instanceof InputEvent && event.inputType !== 'insertFromPaste') {
          target.removeAttribute('data-tutor-dictated-answer');
        }
        const submit = document.querySelector('[data-command="submitTutorConversationTurn"]');
        if (submit instanceof HTMLButtonElement) submit.disabled = !target.value.trim();
        vscode.postMessage({
          command: 'updateTutorConversationAnswer',
          answer: target.value,
          spoken: target.getAttribute('data-tutor-dictated-answer') === 'true'
        });
        return;
      }
      if (target instanceof HTMLTextAreaElement &&
          target.hasAttribute('data-tutor-prepared-prompt')) {
        vscode.postMessage({ command: 'updateTutorPreparedPrompt', prompt: target.value });
        return;
      }
      if ((target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) &&
          target.hasAttribute('data-tutor-tool-input')) {
        tutorToolHighlight = '';
        // Enable the submit control here, not by re-rendering. Typing updates the held
        // input but does not redraw the panel, and the control's disabled state is decided
        // at render, so Ask opened with an empty box and its button never came back to
        // life. Dictionary and Translate hid this for two versions because their box opens
        // holding the sentence. Re-rendering on every keystroke would fix it and move the
        // reader's cursor, which is why the practice review control is synced the same way.
        const submit = document.querySelector('[data-command="submitTutorTool"]');
        if (submit instanceof HTMLButtonElement) {
          submit.disabled = !String(target.value).trim();
        }
        vscode.postMessage({ command: 'updateTutorToolInput', input: target.value });
        return;
      }
      if (target instanceof HTMLInputElement && target.hasAttribute('data-dictionary-search')) {
        postUserDictionaryQuery();
      }
    });
    function filterTutorMap(rawSearch) {
      const search = String(rawSearch || '').trim().toLocaleLowerCase();
      const results = document.querySelector('[data-tutor-search-results]');
      if (results instanceof HTMLElement) results.classList.toggle('hidden', !search);
      document.querySelectorAll('[data-tutor-search-result]').forEach((result) => {
        const name = (result.getAttribute('data-tutor-search-text') || '').toLocaleLowerCase();
        result.classList.toggle('hidden', !search || !name.includes(search));
      });
    }
    /*
     * The word the reader highlighted in the drawer's box.
     *
     * The Dictionary box holds the whole sentence so the reader can see it and pick from it
     * with the mouse, which is what the owner asked for on 2026-09-03. Look up then sends
     * the highlight rather than the box, because a dictionary takes a word and the box holds
     * a sentence. Recorded as the selection changes rather than read when the button is
     * clicked, since clicking moves focus away from the box.
     */
    let tutorToolHighlight = '';
    document.addEventListener('selectionchange', () => {
      const active = document.activeElement;
      if (!(active instanceof HTMLTextAreaElement) ||
          !active.hasAttribute('data-tutor-tool-input')) {
        return;
      }
      tutorToolHighlight = active.value.slice(active.selectionStart, active.selectionEnd);
    });

    function postTutorSubmit() {
      vscode.postMessage({
        command: 'submitTutorTool',
        ...(tutorToolHighlight.trim() ? { selection: tutorToolHighlight } : {})
      });
      tutorToolHighlight = '';
    }

    function postTutorFind() {
      const search = document.querySelector('[data-tutor-map-search]');
      const action = document.querySelector('[data-tutor-find-targets]');
      if (!(search instanceof HTMLInputElement || search instanceof HTMLTextAreaElement)) return;
      if (action?.getAttribute('aria-disabled') === 'true') return;
      vscode.postMessage({ command: 'findTutorTargets', search: search.value });
    }
    function postTutorAsk() {
      const search = document.querySelector('[data-tutor-map-search]');
      if (!(search instanceof HTMLInputElement || search instanceof HTMLTextAreaElement)) return;
      vscode.postMessage({ command: 'askTutorQuestion', search: search.value });
    }
    // A select changes in this document before the extension can replace the document with
    // the new cascade. Keep the two action buttons pointed at what the reader can already
    // see, so a quick press cannot act on the previous dropdown value.
    function syncTutorTargetActions(changedControl) {
      const controls = Array.from(document.querySelectorAll('[data-tutor-map-level]'));
      const changedIndex = controls.indexOf(changedControl);
      const selected = controls.slice(0, changedIndex + 1)
        .filter((control) => control instanceof HTMLSelectElement && control.value)
        .at(-1);
      const targetId = selected instanceof HTMLSelectElement ? selected.value : '';
      document.querySelectorAll('[data-tutor-role]').forEach((action) => {
        if (!(action instanceof HTMLButtonElement) || action.getAttribute('data-tutor-role') === 'off') {
          return;
        }
        action.setAttribute('data-tutor-target', targetId);
        if (targetId && action.hasAttribute('data-tutor-no-target')) {
          action.removeAttribute('aria-disabled');
          action.removeAttribute('aria-description');
          action.removeAttribute('data-tutor-no-target');
        }
      });
    }
    function syncTutorDraftAvailability(question) {
      const action = document.querySelector('[data-command="generateTutorLesson"]');
      if (!(action instanceof HTMLButtonElement) || action.hasAttribute('data-tutor-draft-busy')) return;
      const questionOnly = action.getAttribute('data-tutor-question-only') === 'true';
      const ready = action.getAttribute('data-tutor-has-target') === 'true' ||
        (questionOnly && (action.getAttribute('data-tutor-has-question') === 'true' || question.trim().length > 0));
      action.disabled = !ready;
      if (ready) {
        action.removeAttribute('aria-disabled');
        action.removeAttribute('aria-description');
        action.removeAttribute('title');
      } else {
        const reason = questionOnly
          ? 'Choose a learning-map target or write a lesson question first.'
          : 'Choose a learning-map target, or turn on "Use question without learning-map targets" to draft from your question.';
        action.setAttribute('aria-disabled', 'true');
        action.setAttribute('aria-description', reason);
        action.setAttribute('title', reason);
      }
    }
    const tutorSearch = document.querySelector('[data-tutor-map-search]');
    if ((tutorSearch instanceof HTMLInputElement || tutorSearch instanceof HTMLTextAreaElement) &&
        tutorSearch.value) {
      filterTutorMap(tutorSearch.value);
    }
    function postUserDictionaryDraft(command, captureMode, target) {
        const form = target.closest('form') ?? document.querySelector('.personal-draft form');
        if (!(form instanceof HTMLFormElement)) {
          vscode.postMessage({ command, captureMode });
          return;
        }
        const data = new FormData(form);
        const parseLines = (name) => String(data.get(name) || '').split(/\\r?\\n/u)
          .map((value) => value.trim()).filter(Boolean);
        const senses = Array.from(form.querySelectorAll('[data-dictionary-sense]')).map((sense) => {
          const field = (name) => {
            const input = sense.querySelector('[name="' + name + '"]');
            return input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement
              ? input.value : '';
          };
          return {
            partOfSpeech: field('partOfSpeech'),
            pronunciation: field('pronunciation'),
            definition: field('definition'),
            usageNote: field('usageNote'),
            synonyms: field('synonyms').split(/\\r?\\n|,/u).map((value) => value.trim()).filter(Boolean),
            antonyms: field('antonyms').split(/\\r?\\n|,/u).map((value) => value.trim()).filter(Boolean),
            relatedTerms: field('relatedTerms').split(/\\r?\\n|,/u).map((value) => value.trim()).filter(Boolean),
            examples: field('examples').split(/\\r?\\n/u).map((value) => value.trim()).filter(Boolean)
          };
        });
        vscode.postMessage({ command, captureMode, entry: {
          term: String(data.get('term') || ''),
          language: String(data.get('language') || ''),
          entryType: String(data.get('entryType') || ''),
          collection: String(data.get('collection') || ''),
          domains: parseLines('domains'),
          tags: parseLines('tags'),
          pronunciation: String(data.get('pronunciation') || ''),
          senses,
          aliases: parseLines('aliases')
        } });
    }
    function postUserDictionaryQuery() {
      const value = (name) => {
        const input = document.querySelector('[data-dictionary-filter="' + name + '"]');
        return input instanceof HTMLSelectElement ? input.value : '';
      };
      const search = document.querySelector('[data-dictionary-search]');
      vscode.postMessage({ command: 'updateUserDictionaryList', query: {
        search: search instanceof HTMLInputElement ? search.value : '',
        language: value('language') || undefined,
        collection: value('collection') || undefined,
        entryType: value('entryType') || undefined,
        captureMode: value('captureMode') || undefined,
        source: value('source') || undefined
      } });
    }
    function settingValue(key) {
      const input = document.querySelector('[data-setting="' + key + '"]');
      return input instanceof HTMLInputElement && input.type === 'checkbox'
        ? input.checked
        : input instanceof HTMLInputElement || input instanceof HTMLSelectElement
          ? input.value
          : undefined;
    }
    function syncTutorSpeechDetection() {
      const speechDetection = document.querySelector('[data-setting="tutor.conversation.speechDetection"]');
      if (speechDetection instanceof HTMLSelectElement) {
        speechDetection.disabled = document.querySelector('[data-setting="tutor.conversation.pressToTalk"]')?.checked === true;
        speechDetection.title = speechDetection.disabled ? 'Press to talk uses KREN detection.' : '';
      }
      syncTutorConversationAdvancedSummary();
    }
    function linkCredentialReasons() {
      document.querySelectorAll('.tutor-failure, .tutor-picture-paused, .tutor-action-status, .tutor-drawer-result p, [role="status"]').forEach(reason => {
        if (!reason.textContent?.includes('KREN menu, Credentials') || reason.querySelector('[data-command="showCredentials"]')) return;
        const link = document.createElement('a');
        link.href = '#'; link.dataset.command = 'showCredentials'; link.textContent = 'Open Credentials';
        reason.append(' ', link);
      });
    }
    let credentialPresence = ${JSON.stringify(options.settings.credentialPresence ?? {})};
    const credentialMissing = ${credentialMissing.toString()};
    const otherGeminiProfileMessage = ${otherGeminiProfileMessage.toString()};
    const credentialControlState = ${credentialControlState.toString()};
    function applyCredentialGray() {
      const gray = (element, missing) => {
        element.classList.toggle('credential-missing', missing);
        if (missing) element.setAttribute('aria-description', 'No key stored');
        else element.removeAttribute('aria-description');
      };
      document.querySelectorAll('select[data-setting], select[data-model-preset], input[data-setting]').forEach(control => {
        const key = control.getAttribute('data-model-preset') || control.getAttribute('data-setting');
        const state = credentialControlState(key, credentialPresence, settingValue, credentialMissing);
        if (!state) return;
        gray(control, state.missing);
        control.querySelectorAll('option').forEach(option => gray(option, state.options ? Boolean(state.options[option.value]) : state.missing));
      });
    }
    function updateCredentialNotes() {
      document.querySelectorAll('[data-credential-setting]').forEach(note => {
        const key = note.getAttribute('data-credential-setting');
        const selected = settingValue(key);
        const provider = key === 'tutor.liveGeminiProfile' ? 'gemini' : selected === 'googleChirp' ? 'googleCloudTextToSpeech'
          : key === 'translationProvider' && selected === 'gemini' ? '' : selected;
        const profileKey = note.getAttribute('data-credential-profile-setting');
        const profile = (profileKey && settingValue(profileKey)) || note.getAttribute('data-credential-profile');
        const base = credentialMissing(credentialPresence, provider, profile)
          ? JSON.parse(note.getAttribute('data-credential-notes') || '{}')[provider + ':' + profile] || '' : '';
        const text = base + (base && profileKey ? otherGeminiProfileMessage(provider, profile, credentialPresence) : '');
        note.hidden = !text;
        note.querySelector('span').textContent = text;
      });
    }
    function applyConditionalSettings() {
      applyCredentialGray();
      linkCredentialReasons();
      updateCredentialNotes();
      syncTutorSpeechDetection();
      document.querySelectorAll('[data-provider-for]').forEach((group) => {
        if (group.hasAttribute('data-model-slot')) return;
        const key = group.getAttribute('data-provider-for');
        const expected = group.getAttribute('data-provider-value');
        group.classList.toggle('hidden', !key || !expected || settingValue(key) !== expected);
      });
      const tutorRoutingSummary = document.querySelector('[data-llm-routing="tutor"] > summary .rewrite-group-summary');
      if (tutorRoutingSummary instanceof HTMLElement) {
        const entries = tutorRoutingSummary.textContent.split(' | ')
          .filter(entry => !entry.startsWith('Gemini Profile: '));
        if (settingValue('tutor.provider') === 'gemini') entries.splice(1, 0,
          'Gemini Profile: ' + (settingValue('tutor.geminiProfile') === 'pro' ? 'Paid' : 'Free Tier'));
        tutorRoutingSummary.textContent = entries.join(' | ');
      }
      document.querySelectorAll('[data-gemini-profile-for]').forEach((group) => {
        if (group.hasAttribute('data-model-slot')) return;
        const key = group.getAttribute('data-gemini-profile-for');
        const expected = group.getAttribute('data-gemini-profile-value');
        group.classList.toggle('hidden', !key || !expected || settingValue(key) !== expected);
      });
      // The Model control is drawn twice, one control per stored slot, and exactly one is
      // shown. The condition is a conjunction rather than an equality, which is why these
      // are handled here instead of by the two loops above: the default slot serves every
      // non-Gemini provider as well as the Default Gemini profile, so it cannot be
      // expressed as "this setting equals that value".
      document.querySelectorAll('[data-model-slot]').forEach((group) => {
        const providerKey = group.getAttribute('data-provider-for');
        const profileKey = group.getAttribute('data-gemini-profile-for');
        const alternate = Boolean(providerKey) && Boolean(profileKey) &&
          settingValue(providerKey) === 'gemini' && settingValue(profileKey) === 'pro';
        group.classList.toggle(
          'hidden',
          group.getAttribute('data-model-slot') === 'alternate' ? !alternate : alternate
        );
      });
      // Dimmed and disabled rather than hidden. A control that vanishes leaves the reader
      // wondering where the languages went; one that is visibly inert says what to change.
      document.querySelectorAll('[data-enabled-for]').forEach((group) => {
        const key = group.getAttribute('data-enabled-for');
        const expected = group.getAttribute('data-enabled-value');
        // String() because settingValue returns a boolean for a checkbox and the expected
        // value arrives as an attribute, so grammar.smart would otherwise compare true to
        // 'true' and read as inactive whatever the toggle says.
        const active = Boolean(key) && Boolean(expected) &&
          String(settingValue(key)) === expected;
        group.classList.toggle('setting-inactive', !active);
        group.querySelectorAll('select, input, textarea').forEach((control) => {
          // A control that mirrors another feature's setting stays disabled in both states.
          // Re-enabling it would offer an edit that is written nowhere.
          if (control.hasAttribute('data-always-disabled')) return;
          control.disabled = !active;
        });
      });
    }
    function scrollTutorStoppedActions() {
      document.querySelector('[data-tutor-stopped-actions]')?.scrollIntoView({ block: 'end' });
    }
    initializeTutorConversationPicture();
    ${options.tutorConversationPicturePending ? `patchTutorConversationPicture(${JSON.stringify({
      image: options.tutorConversationPicturePending.image,
      requestId: options.tutorConversationPicturePending.requestId,
      images: [...(options.tutorConversationPictures ?? []), options.tutorConversationPicturePending.image],
      turns: [...(options.tutorConversationPictureTurns ?? []), options.tutorConversationPicturePending.turn ?? -1],
      mode: options.tutor?.conversation.situationPicture
    })});` : ''}
    checkTutorDevelopingPicture(${JSON.stringify(options.tutorConversationPictureCommittedTurn ?? null)});
    ${audio ? `void playPronunciation(${JSON.stringify(audio.url).replace(/</gu, '\u003c')}, false);` : ''}
    requestAnimationFrame(sizeLanguageModelUsage);
    const usageBox = document.querySelector('[data-language-model-usage]');
    if (usageBox) new ResizeObserver(sizeLanguageModelUsage).observe(usageBox);
    window.addEventListener('resize', sizeLanguageModelUsage);
    document.fonts.ready.then(sizeLanguageModelUsage);
    applyConditionalSettings();
    // The layout is final here. The stopped actions still win, as they did when they came later.
    if (scrollRestorePending) restoreScroll();
    ${options.tutorScrollToStoppedActions ? 'scrollTutorStoppedActions();' : ''}
    ${panelNoticeScript(options.panelNotices ?? [])}
    vscode.postMessage({ command: 'generatedAudioReady' });
  </script>
</body>
</html>`.replaceAll('__KREN_THEME_ACTION__', effectivePanelTheme(options.settings.panelTheme ?? 'followVSCode', options.themeKind ?? 'light') === 'light' ? 'Switch to dark view' : 'Switch to light view');
}

function renderPopulatedView(
  result: KrenResult,
  sourceText: string,
  allowReplace: boolean,
  settings: KrenPanelSettings,
  brandImageUri: string | undefined,
  googleAttributionImageUri: string | undefined,
  grammarChoices: ReadonlyArray<{ issueId: string; suggestionIndex: number }> | undefined,
  logoUris?: { light: string; dark: string }
): string {
  const provider = escapeHtml(providerNames[result.providerId] ?? result.providerId);
  const modelId = result.kind === 'rewrite' || result.kind === 'translation'
    ? result.modelId
    : undefined;
  // A Smart Grammar check ran two things over the passage. Naming only Harper understated
  // what had been sent and to whom, so both are named whenever both ran.
  const model = modelId
    ? `<span>${escapeHtml(modelId)}</span>`
    : result.kind === 'grammar' && result.smartModelId
      ? `<span>${provider} + ${escapeHtml(result.smartModelId)}</span>`
      : `<span>${provider}</span>`;
  const resultHtml = result.kind === 'translation'
    ? renderTranslation(result)
    : result.kind === 'dictionary'
      ? renderDictionary(result)
      : result.kind === 'thesaurus'
        ? renderThesaurus(result)
        : result.kind === 'grammar'
          ? renderGrammar(result, grammarChoices, allowReplace)
          : renderRewrite(result, allowReplace, settings);
  /*
   * Copy, then Replace, then Open full details, with the first two as the icons a rewrite
   * variant already uses. The owner asked for both on 2026-08-28: the order matches what
   * they reach for, and one Copy control should not look like two different things
   * depending on which result produced it.
   *
   * 2026-10-04: the owner canvas uses the same Copy icon for every result kind.
   */
  const actions = result.kind === 'rewrite'
    ? '<button class="secondary" data-command="details">Open full details</button>'
    : result.kind === 'grammar'
      ? grammarActions(result)
      : result.kind === 'translation'
        ? `${copyIconButton('copy', '', 'the result')}
       ${allowReplace ? replaceIconButton('replace', '', 'the result') : ''}
       <button class="secondary" data-command="details">Open full details</button>`
        : `${copyIconButton('copy', '', 'the result')}
       <button class="secondary" data-command="details">Open full details</button>`;
  // The axis line moved out of the card title on 2026-08-22, at the owner's request. It
  // describes Full Rewrite and none of it reaches Minimal Rewrite, so above both panels it
  // described a variant the reader had not got to yet, and it pushed the heading over
  // three lines before any result was visible. It now runs last, under both panels.
  const rewriteMeta = result.kind === 'rewrite'
    ? `<p class="result-meta rewrite-meta">Language: <strong>${escapeHtml(languageName(result.sourceLanguage))}</strong> | ${isEnglishLanguageCode(result.sourceLanguage) ? `English: <strong>${escapeHtml(rewriteEnglishVarietyLabel(result.englishVariety))}</strong> | ` : ''}Modality: <strong>${escapeHtml(rewriteAxisLabel(REWRITE_MODALITIES, result.modality))}</strong> | Function: <strong>${escapeHtml(rewriteAxisLabel(REWRITE_FUNCTIONS, result.function))}</strong> | Domain: <strong>${escapeHtml(rewriteDomainLabel(result.domain))}</strong> | Formality: <strong>${escapeHtml(rewriteAxisLabel(REWRITE_FORMALITIES, result.formality))}</strong> | Voice: <strong>${escapeHtml(rewriteAxisLabel(REWRITE_VOICES, result.voice))}</strong> | Stance: <strong>${escapeHtml(rewriteAxisLabel(REWRITE_STANCES, result.stance))}</strong> | Length: <strong>${escapeHtml(rewriteAxisLabel(REWRITE_LENGTHS, result.length))}</strong> | Perspective: <strong>${escapeHtml(rewriteAxisLabel(REWRITE_PERSPECTIVES, result.perspective))}</strong> | Intent: <strong>${escapeHtml(rewriteRhetoricalModeLabel(result.rhetoricalMode))}</strong></p>`
    : '';
  const attribution = renderProviderAttribution(result.providerId, googleAttributionImageUri);
  // 2026-10-20 (owner, canvas): the provider line sits on its own row under the header, above the cards.
  return `${renderHeader('', true, brandImageUri)}
  <div class="provider">${renderProviderLogo(result.providerId, logoUris)}${model}</div>
  <section class="card">
    <h2 class="card-title">Input</h2>
    <div class="card-body"><pre class="source">${escapeHtml(sourceText)}</pre></div>
  </section>
  <section class="card">
    <h2 class="card-title">Result</h2>
    <div class="card-body">${resultHtml}${rewriteMeta}${attribution}</div>
  </section>
  <div class="actions">
    ${actions}
  </div>`;
}

function renderProviderAttribution(
  providerId: string,
  googleAttributionImageUri: string | undefined
): string {
  if (providerId === 'googleCloudTranslation') {
    const badge = googleAttributionImageUri
      ? `<img class="google-attribution" src="${escapeHtml(googleAttributionImageUri)}" alt="Powered by Google Translate">`
      : 'Powered by Google Translate';
    return `<div class="provider-attribution"><a href="https://translate.google.com" title="Open Google Translate">${badge}</a><details class="provider-disclaimer"><summary>Translation disclaimer</summary><p>This service may contain translations powered by Google. Google disclaims all warranties related to the translations, including accuracy, reliability, merchantability, fitness for a particular purpose, and noninfringement.</p></details></div>`;
  }
  if (providerId === 'koreanBasicDictionary') {
    return '<p class="provider-attribution">Source: <a href="https://krdict.korean.go.kr/eng/">Basic Korean Dictionary</a>, National Institute of Korean Language. Text is provided under CC BY-SA.</p>';
  }
  return '';
}

function renderProviderLogo(providerId: string, logoUris?: { light: string; dark: string }): string {
  if (!providerId.startsWith('merriamWebster') || !logoUris) return '';
  return `<img class="provider-logo provider-logo-light" src="${escapeHtml(logoUris.light)}" alt="Merriam-Webster logo"><img class="provider-logo provider-logo-dark" src="${escapeHtml(logoUris.dark)}" alt="Merriam-Webster logo">`;
}

export interface CapabilityAvailability {
  label: string;
  command: KrenPanelCommand;
  available: boolean;
  reason?: string;
}

/** Uses the action's configured route; fallback models still require the primary key. */
export function capabilityAvailability(settings: KrenPanelSettings): CapabilityAvailability[] {
  const keyed = (credential: KrenCredentialId, name: string) => ({
    available: Boolean(settings.credentialPresence?.[credential]),
    reason: missingCredentialMessage(missingCredentialDetails(credential === 'geminiDefault' || credential === 'geminiAlternate' ? 'gemini' : credential === 'cloudflareAccountId' || credential === 'cloudflareApiToken' ? 'cloudflare' : credential, credential === 'geminiAlternate' ? 'pro' : 'standard'), settings.credentialPresence)
  });
  const model = (provider: LanguageModelRoutingProvider, profile: GeminiRoutingProfile) => {
    if (provider === 'groq') return { available: Boolean(settings.credentialPresence?.groq), reason: missingCredentialMessage(missingCredentialDetails('groq')) };
    if (provider === 'cloudflare') return { available: Boolean(settings.credentialPresence?.cloudflareAccountId && settings.credentialPresence?.cloudflareApiToken), reason: missingCredentialMessage(missingCredentialDetails('cloudflare', 'standard', [...(!settings.credentialPresence?.cloudflareAccountId ? ['account ID'] : []), ...(!settings.credentialPresence?.cloudflareApiToken ? ['API token'] : [])])) };
    const slot = languageModelCredentialSlot(provider, profile);
    return keyed(
      slot === 'gemini' ? 'geminiDefault' : slot === 'geminiPro' ? 'geminiAlternate' : slot,
      slot === 'gemini' ? 'Gemini Free Tier' : slot === 'geminiPro' ? 'Gemini Paid'
        : slot === 'openai' ? 'OpenAI' : slot === 'groq' ? 'Groq' : 'Anthropic'
    );
  };
  // Smart Grammar and capture share the User Dictionary routing settings at execution.
  const capture = model(settings.userDictionaryProvider, settings.userDictionaryProfile);
  const smart = settings.grammarSmart && capture.available &&
    Boolean(settings.userDictionaryModel.trim());
  const dictionary = !settings.userDictionaryEnabled
    ? { available: false, reason: 'Unavailable because User Dictionary is disabled.' }
    : !capture.available ? capture
      : settings.userDictionaryCaptureMode === 'merriamWebsterAndLlm'
        ? keyed('merriamWebsterCollegiate', 'Merriam-Webster Collegiate') : capture;
  const translation = settings.translationProvider === 'googleCloudTranslation'
    ? keyed('googleCloudTranslation', 'Google Cloud Translation')
    : settings.translationRoutingProvider === 'openai' || settings.translationRoutingProvider === 'anthropic'
      ? { available: false, reason: 'Unavailable because Translation requires Gemini routing.' }
      : model(settings.translationRoutingProvider, settings.translationProfile);
  return [
    { label: 'English Dictionary', command: 'kren.dictionarySearchSelection', ...keyed('merriamWebsterCollegiate', 'Merriam-Webster Collegiate') },
    { label: 'Synonyms', command: 'kren.synonymsSearchSelection', ...keyed('merriamWebsterThesaurus', 'Merriam-Webster Thesaurus') },
    { label: 'Medical Dictionary', command: 'kren.lookupMedicalSelection', ...keyed('merriamWebsterMedical', 'Merriam-Webster Medical') },
    { label: 'Korean Dictionary', command: 'kren.koreanDictionarySearchSelection', ...keyed('koreanDictionary', 'Korean Dictionary') },
    { label: 'Translation', command: 'kren.translateSelection', ...translation },
    { label: 'Explain Nuance', command: 'kren.explainSelection', ...model(settings.explanationProvider, settings.explanationProfile) },
    { label: smart ? 'Smart Grammar Check' : 'Grammar Check', command: 'kren.grammarCheckSelection', available: true },
    { label: 'Rewrite', command: 'kren.rewriteEnglishSelection', ...model(settings.rewriteProvider, settings.rewriteProfile) },
    { label: 'Add to User Dictionary', command: 'kren.addToUserDictionary', ...dictionary },
    { label: 'Read Aloud', command: 'kren.readAloudSelection', available: true }
  ];
}

function renderEmptyView(
  settings: KrenPanelSettings,
  brandImageUri: string | undefined,
  hasHeldResult = false,
  statusLayout: 'empty' | 'firstRun' | 'default' = 'default',
  updatesAvailable = false
): string {
  return `${renderHeader('', false, brandImageUri, true, hasHeldResult, updatesAvailable)}
  <section class="card welcome${statusLayout === 'firstRun' ? ' welcome-first-run' : ''}">
    <p class="welcome-lead"><strong>KREN is a privacy-conscious language copilot for dictionaries, smart grammar checking, translation, nuance, rewriting, and read-aloud, with multilingual and auto-detect support, plus an LLM-based AI English Tutor, inside VS Code.</strong></p>
    <div class="welcome-layout">
      <div class="welcome-flow">
        <div class="welcome-step"><strong>1. Select or copy</strong><span>Select editor text, or copy text from chat, terminals, and other panels.</span></div>
        <div class="welcome-step"><strong>2. Choose an action</strong><span>${statusLayout === 'empty' ? '<span>Right-click the selection, or click</span>' : 'Right-click the selection, or click'} <span class="welcome-status-item" aria-label="KREN status bar item"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2.5 2A1.5 1.5 0 0 0 1 3.5v9A1.5 1.5 0 0 0 2.5 14H6c.818 0 1.544-.393 2-1c.456.607 1.182 1 2 1h3.5a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 13.5 2H10c-.818 0-1.544.393-2 1a2.5 2.5 0 0 0-2-1zm5 2.5v7A1.5 1.5 0 0 1 6 13H2.5a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5H6a1.5 1.5 0 0 1 1.5 1.5m1 7v-7A1.5 1.5 0 0 1 10 3h3.5a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5H10a1.5 1.5 0 0 1-1.5-1.5"/></svg>${statusLayout === 'firstRun' ? '<span>KREN</span>' : 'KREN'}</span> ${statusLayout === 'empty' ? '<span>in the status bar for clipboard text.</span>' : 'in the status bar for clipboard text.'}</span></div>
        <div class="welcome-step"><strong>3. Use the result</strong><span>Read, compare, copy, replace eligible text, hear pronunciation, or open full details.</span></div>
      </div>
      <div class="capability-grid" aria-label="KREN capabilities">
        ${capabilityAvailability(settings).map(capabilityButton).join('\n')}
      </div>
    </div>
    <p class="privacy-note">KREN sends text only when you choose an action above. Nothing leaves this machine while you type, select, or hover.</p>
    <p class="credits">${krenCreditLine(settings.extensionVersion)}</p>
  </section>`;
}

/**
 * One capability on the welcome screen, as a button that runs its action.
 *
 * These were `<span>` elements styled to look like buttons and did nothing when clicked.
 * The owner asked on 2026-08-22 for the Office behaviour, where the equivalent grid is
 * the primary way to start an action.
 *
 * Each runs the same `*Selection` command as the editor context menu, so the action is
 * defined in exactly one place and the button cannot drift from the menu entry. A
 * capability with no key still renders, disabled, saying why: hiding it would leave the
 * reader wondering whether KREN has the feature at all.
 */
/**
 * One capability control, sized the way the Office task pane sizes its action grid.
 *
 * Two columns that collapse to one, a uniform 44 pixel height, and a label that clips with
 * an ellipsis rather than wrapping. The owner asked for the two panes to match here; the
 * grid used to be one column at full width and two only when narrow, which is backwards,
 * and a long label such as Add to User Dictionary grew its own button taller than the rest.
 *
 * A control that cannot run says why, and that sentence has to wrap, so the row it sits in
 * opts out of the single-line clipping rather than the whole grid doing so.
 */
function capabilityButton({ label, command, available, reason: unavailableReason }: CapabilityAvailability): string {
  const reason = available
    ? ''
    : `<span class="capability-reason">${escapeHtml(unavailableReason ?? 'Unavailable because no API key is configured.')}</span>`;
  return `<div class="capability-item"><button class="capability${available ? '' : ' unavailable has-reason'}" data-command="runCommand" data-action="${escapeHtml(command)}"${available ? '' : ' disabled'}><span class="capability-label">${escapeHtml(label)}</span>${reason}</button>${!available && unavailableReason?.includes('KREN menu, Credentials') ? '<a href="#" data-command="showCredentials">Open Credentials</a>' : ''}</div>`;
}

/**
 * `canClear` marks the result header, the one screen already showing the result.
 * `hasHeldResult` marks every other screen while a result is still held, which is when the
 * way back is worth offering. The panel keeps a result until it is cleared or replaced, so
 * before this control the only way back from Settings or the Start page was to run the
 * operation again and pay for it a second time.
 */
function renderHeader(
  provider: string,
  canClear: boolean,
  brandImageUri: string | undefined,
  prominent = false,
  hasHeldResult = false,
  updatesAvailable = false
): string {
  const logo = brandImageUri
    ? `<img class="brand-logo" src="${escapeHtml(brandImageUri)}" alt="KREN logo">`
    : '';
  return `<header class="top${prominent ? ' intro-header' : ''}">
    <div class="top-main">
      <div class="brand">${logo}<span class="brand-name">KREN</span></div>
      ${provider}
    </div>
    <div class="top-actions">
      ${canClear ? iconButton('clear', '', 'Clear KREN result', 'Clear KREN result', 'clear', false, false, 'icon-button') : ''}
      ${hasHeldResult ? iconButton('showResult', '', 'Back to result', 'Back to the KREN result', 'back', false, false, 'icon-button') : ''}
      ${iconButton('showStartPage', '', 'Start page', 'Go to the KREN Start page', 'home', false, false, 'icon-button')}
      ${iconButton('showSettings', '', 'Settings', 'Open KREN Settings', 'settings', false, false, 'icon-button')}
      ${iconButton('showTutor', '', 'AI English Tutor', 'Open the AI English Tutor', 'tutor', false, false, 'icon-button')}
      ${iconButton('showCredentials', '', 'Credentials', 'Open KREN Credentials', 'key', false, false, 'icon-button')}
      <button class="icon-button" data-command="toggleTheme" title="__KREN_THEME_ACTION__" aria-label="__KREN_THEME_ACTION__"><svg class="theme-icon-dark" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"></path></svg><svg class="theme-icon-light" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"></path></svg></button>
      <div class="menu-wrap">
        ${iconButton(undefined, 'data-menu-toggle', 'KREN menu', 'Open KREN menu', 'menu', false, false, 'icon-button menu-button', ' aria-haspopup="true" aria-expanded="false"')}
        <div class="menu-popover hidden" data-menu-popover role="menu">
          <button class="menu-item" data-command="showStartPage" role="menuitem">Start Page</button>
          <button class="menu-item" data-command="showTutor" role="menuitem">AI English Tutor</button>
          <button class="menu-item" data-command="showUserDictionary" role="menuitem">User Dictionary</button>
          <button class="menu-item" data-command="showManual" role="menuitem">User Manual</button>
          <button class="menu-item" data-command="showCredentials" role="menuitem">Credentials</button>
          <button class="menu-item" data-command="showSettings" role="menuitem">Settings</button>
          <button class="menu-item" data-command="checkForUpdates" role="menuitem">Check for updates</button>
        </div>
      </div>
    </div>
  </header>
  <!-- Changed 2026-10-21 (owner, canvas): Updates available follows the header. -->
  ${prominent ? `<div class="system-updates-row"><button class="${updatesAvailable ? '' : 'hidden'}" data-system-updates data-command="checkForUpdates">Updates available</button></div>` : ''}`;
}

export function renderEnvironmentChecks(items: readonly EnvironmentItem[], busy = false): string {
  return `<h2>Check for updates</h2><p class="settings-intro">System checks need no key. Providers with stored keys are asked only for model lists, Google for voices. No text is sent. Edge uses the configured Python.</p>
    <p role="status">${busy ? 'Checking system dependencies. Please wait.' : items.length ? 'Latest check results' : 'No check results yet.'}<button data-command="checkForUpdates"${busy ? ' disabled' : ''}>Check again</button></p>
    ${(['System', 'Models', 'Voices'] as const).map(group => `<section data-update-group="${group}"><h3>${group}</h3>${items.filter(item => (item.group ?? 'System') === group).map(item => `<section class="card"><h4 class="card-title">${escapeHtml(item.name)}: ${escapeHtml(item.status)}</h4><div class="card-body"><p>Found: ${escapeHtml(item.found)}. Expected: ${escapeHtml(item.expected)}.</p><p>${escapeHtml(item.explanation)}</p>${item.fixTarget ? `<button type="button" class="secondary" data-update-fix-target="${escapeHtml(item.fixTarget)}"${busy ? ' disabled' : ''}>Open ${item.fixTarget === 'tutorVoice' ? 'TUTOR VOICE' : item.fixTarget === 'readAloud' ? 'READ ALOUD voice settings' : 'LLM ROUTING'}</button>` : item.fix === 'updateEdgeTts' ? `<button class="secondary" data-command="updateEdgeTts"${busy ? ' disabled' : ''}>Update</button>` : item.fix === 'pythonSetting' ? '<button class="secondary" data-command="openUpdatesPythonSetting">Python setting</button>' : item.fix === 'vscodeUpdate' ? '<p>Use VS Code Help to check for an editor update.</p>' : ''}</div></section>`).join('')}</section>`).join('')}`;
}

/** Shared by update fixes and the panel script; open every ancestor before scrolling. */
export function focusEnvironmentFix(doc: Document, destination: UpdateFixTarget): boolean {
  const selectors: Record<UpdateFixTarget, string> = {
    translation: '[data-llm-routing="translation"]', grammar: '[data-llm-routing="grammar"]',
    explanation: '[data-llm-routing="explain"]', rewrite: '[data-llm-routing="rewrite"]',
    userDictionary: '[data-llm-routing="userDictionary"]', tutor: '[data-persist-id="tutor-routing"]',
    tutorVoice: '[data-persist-id="tutor-voice"]', readAloud: '[data-settings-section="readAloud"]'
  };
  if (!Object.prototype.hasOwnProperty.call(selectors, destination)) return false;
  const section = doc.querySelector<HTMLElement>(selectors[destination]);
  if (!section) return false;
  let parent: HTMLElement | null = section;
  while (parent) {
    if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true;
    parent = parent.parentElement;
  }
  section.scrollIntoView({ block: 'start' });
  section.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
  return true;
}

function renderManual(
  version: string,
  brandImageUri: string | undefined,
  userDictionaryEnabled: boolean,
  hasHeldResult = false
): string {
  return `${renderHeader('', false, brandImageUri, false, true)}
    <h2>KREN ${escapeHtml(version)} User Manual</h2>
    ${userDictionaryEnabled ? '' : '<p>User Dictionary is turned off in Settings, so its commands are hidden.</p>'}
    <h3>Set up</h3><p>Unlock the features you need.</p>
    <ol><li>Install on VS Code Desktop 1.106 or later; run KREN: Show KREN Secondary Sidebar.</li><li>Open KREN menu, <strong>Credentials</strong>; Set key. Each row's information icon explains where to get keys.</li><li>Choose feature languages and LLM ROUTING. Select editor text and right-click an action, or copy text, click KREN in the status bar, review the preview, and choose.</li></ol>
    <p>Harper, stored glossary management, and local reading need no key. Dictionaries/Cloud need their keys; Models support Gemini, OpenAI, Anthropic, Groq, and Cloudflare. Translation supports Gemini, Groq, and Cloudflare; Live needs Gemini. Dictation/pictures also support Cloudflare. Set account ID/token; choose Picture Provider in VOICE &amp; MODEL and Speech provider in VOICE &amp; MODEL. You can configure two of the three Merriam-Webster references: Collegiate Dictionary, Collegiate Thesaurus, Medical Dictionary. The public build refuses a third stored reference key.</p>
    <h3>Check for updates</h3><p>Check system dependencies, models, and voices.</p>
    <ol><li>Open KREN menu, Check for updates, after Settings.</li><li>Read System, Models, and Voices. Check again refreshes them.</li><li>Choose Update for edge-tts and confirm Python with -m pip install -U edge-tts. Failures show and log pip's last error line, redacted and capped at 200 characters.</li><li>Set missing Python with kren.readAloud.edgePythonCommand in VS Code Settings. Restricted Mode runs no configured Python and offers no Update. Update VS Code through Help; Handy is optional.</li></ol>
    <p>Read System, Models, and Voices. Only the menu check asks providers with stored keys for model and voice lists, sending the key in the authentication header and no text; providers without a key are skipped, and Cloudflare is not checked. A missing name shows the feature; open its settings to choose another. KREN never replaces a choice automatically.</p>
    <p>Updates available beside Home on Start opens results. Daily and post-Update checks retain model and voice cards until restart; then Choose Check again for details. Daily checks send at most one anonymous request to pypi.org, never check models or voices, and save only date and statuses. Disable them with kren.updates.dailyCheck in VS Code Settings.</p>
    <h3>Look up a word</h3><p>Find definitions or related words.</p>
    <ol><li>Select an English expression or Korean headword.</li><li>Choose English Dictionary, Synonyms, Medical Dictionary, or Korean Dictionary; read senses and use the pronunciation speaker or Open full details.</li></ol><p>Lookups cannot replace text; Medical defines terminology without diagnosis.</p>
    <h3>Translate</h3><p>Change the output language.</p>
    <ol><li>Set Translation provider and Output language in Settings, Translation.</li><li>Select text; run KREN: Translate Selection, then copy or replace the eligible selection.</li></ol><p>Cloud detects input; LLM uses the selected LLM route.</p>
    <h3>Explain Nuance</h3><p>Clarify meaning and usage.</p>
    <ol><li>Set Explanation language and route in Settings, Explain Meaning or Nuance.</li><li>Select text, choose Explain Nuance, and read or open full details.</li></ol><p>Include desired context in your selection.</p>
    <h3>Smart Grammar Check</h3><p>Choose corrections.</p>
    <ol><li>In Settings, Grammar Check, set Input language and Smart Grammar Check, or turn it off for Harper only.</li><li>Select text; run KREN: Grammar Check. Choose suggestions or Keep original, edit the passage, then replace or copy. Quick Fix... handles an underline; Ignore all dismisses the check.</li></ol><p>No document change occurs until you choose replacement.</p>
    <h3>Rewrite</h3><p>Correct wording or apply style.</p>
    <ol><li>Set languages/style in Settings, Rewrite Text.</li><li>Select text; run KREN: Rewrite Text: Minimal Rewrite, KREN: Rewrite Text: Full Rewrite, or KREN: Rewrite Text: Both Variants.</li><li>Turn Copy result to clipboard off to show a single variant; read, copy, or replace.</li></ol><p>Both Variants always opens the panel; Minimal keeps the source language.</p>
    <h3>Read Aloud</h3><p>Hear a cleaned copy. Edge defaults to en-US-ChristopherNeural with Auto-detect.</p>
    <ol><li>On local Windows, choose Speech source, voice, speed, and Volume in Settings, Read Aloud. Edge needs Python and <code>python -m pip install edge-tts</code>. Google Cloud Chirp 3 HD needs the Google Cloud Text-to-Speech key in KREN menu, Credentials, or uses the Cloud Translation key when that slot is empty. Choose Language/Region and Chirp voice, then Reading speed, where zero percent is the natural rate, 1.0.</li><li>Select text, run KREN: Read Aloud, accept Edge consent if prompted; KREN: Stop Read Aloud stops it. A missing key, unavailable voice or locale, or Chirp failure uses Edge Online, then Local Windows. Synthesis retries once; playback falls back immediately without requesting Google again. Selected Edge failure also uses Windows. One notice per VS Code session names the cause and voice.</li></ol><p>The document stays unchanged. Chirp sends only the cleaned speech copy to Google. A hidden native Windows player works with the panel open or closed, reuses its process for sentences, and exits after two minutes idle. Each temporary MP3 is deleted after playback or Stop. Read Aloud settings are separate from the tutor's voice settings.</p>
    <h3>User Dictionary</h3><p>Keep a local glossary.</p>
    <h4>Add an entry</h4><p>Draft an expression.</p><ol><li>Enable User Dictionary; choose Default capture mode, LLM Only or Merriam-Webster + LLM, requiring the Collegiate key.</li><li>Select an expression; run KREN: Add to User Dictionary. Edit, then Save personal entry, Regenerate, or Cancel.</li></ol><p>Only saving stores it.</p>
    <h4>Use Smart Word Capture</h4><p>Identify the encountered meaning.</p><ol><li>Leave Smart Word Capture on in Settings, User Dictionary; add an editor expression.</li><li>Review In the captured text and All meanings, then save.</li></ol><p>All meanings remain available.</p>
    <h4>Edit an entry</h4><p>Correct stored fields.</p><ol><li>Open KREN menu, User Dictionary; choose a term and its pencil icon.</li><li>Edit, then Save personal entry or Cancel.</li></ol><p>Regenerate is a separate request.</p>
    <h4>Search and filter</h4><p>Find saved terms.</p><ol><li>Type in the search field.</li><li>Filter by language, collection, entry type, capture mode, or source; choose a term.</li></ol><p>No provider request occurs.</p>
    <h4>Export and import</h4><p>Back up or restore.</p><ol><li>In Settings use Export JSON or Export Markdown; list checkboxes select subsets.</li><li>Import and review the preview; choose Merge, keep existing; Merge, replace duplicates; or Replace all.</li></ol><p>JSON is lossless; Markdown is lossy. Invalid/internal duplicates block import.</p>
    <h4>Purge entries</h4><p>Delete a reviewed set.</p><ol><li>In Settings, User Dictionary, choose Entries to purge, then Preview purge.</li><li>Review terms, use the trash icon, and confirm; Remove all entries requires typing.</li></ol><p>Only previewed entries are deleted.</p>
    <h3>AI English Tutor</h3><p>Learn and use a pattern.</p>
    <h4>Build a lesson</h4><p>Choose targets or a question.</p><ol><li>In AI English Tutor, open LEARNING MAP; use Primary or Support beside Selected targets.</li><li>For a question, enable Use question without learning-map targets, type, and choose Ask or analyze text.</li><li>In LESSON choose Setting, adjust LESSON SETTING, then Draft below it.</li></ol><p>Rules/examples appear; missing input explains unavailable Draft.</p>
    <h4>Read the lesson</h4><p>View every example.</p><ol><li>Read with Next and Back; use Play, Dictionary, Translate, or Ask.</li><li>Choose Practice now below example controls and before COMMON ERRORS after viewing all examples.</li></ol><p>Conversation target words are underlined in the theme's link color; Live may miss abstract grammar or inflected forms.</p>
    <h4>Practice</h4><p>Answer and review.</p><ol><li>Type or dictate; press the microphone again to stop. Handy's pulsing Pause stops listening and restores the microphone, including in chat. Use Hint and Next; Back revisits.</li><li>On the last item, answer every item and choose Review all for one batched request. Invalid reviews retry alone once. Read corrections; Next after all reviews opens results.</li></ol><p>Review all stays disabled after review; editing an answer enables review of changed items. Cancel review keeps saved work; Ask explains reviewed items.</p>
    <p>Answers and reviews remain between items. Review all completes practice; errors include unnatural phrasing.</p><h4>Hold a conversation</h4><p>Practice a situation or lesson.</p><ol><li>Open CONVERSATION. A situation is the default source; your saved source choice is kept. Start uses current MODE options; Demo reads both roles without recording you. Setting opens MODE without changing any option. Open MODE shows Start, Demo, Reset; closed shows Setting, Start, Demo. Set Source/Situation, including Let KREN choose. For The lesson, view every lesson example and review every practice item first.</li><li>In MODE choose roles, Who starts, Register, Correction, Replies (Standard/Live), Situation picture (None/Intro Only/Switching/Gradually Entering). In ADVANCED choose Picture style (Realistic/Illustrated). With Gemini chosen, situation pictures need a Gemini Paid API key with billing enabled; the default image model costs about US$0.03 per picture and a conversation makes at most 10.</li><li>Choose Cloudflare free models in Picture Provider and FLUX.1 schnell or FLUX.2 klein 4B in Image Model. Both send scene and recent turns to Cloudflare, never the previous picture. With Standard replies and the speaker on, the situation intro appears and is read to the end first. Then dots appear in the chat until the first KREN line starts playing, when its text appears. The in-chat microphone and Stop appear when that line finishes, so you can answer. After you send a turn, dots remain until the reply's voice starts, its text appears with its voice, and the controls return when speech ends. If you start first, the controls appear after the intro. When muted, text/controls appear once the opening is ready. Failed or fallback speech reveals the affected line, and canceled or stalled speech releases the controls. Situation pictures appear when ready without advancing speech. Chirp requests speech by sentence, joining short sentences so a request has about 40 characters or more when the line permits it. It starts the first sentence and requests the next while that sentence plays, keeping their order. Each sentence retries synthesis once after about one second for no response, unreadable audio, or an HTTP error other than 400, 401, and 403, then uses Edge Online for the remaining text. Native playback failure uses Edge Online immediately and never re-synthesizes. If Edge Online is unavailable, Local Windows reads that same remaining text with the tutor voice settings. At most one speech notice appears per conversation; later failures go to the speech log. Missing credentials and HTTP 400, 401, and 403 go directly to the fallback. Stop cancels pending requests and playback. The speech log reports the time to the first Chirp audio once per line. Edge Online and Local Windows read the whole line. Conversation openings resolve named roles, including Roles swapped, and later requests keep those assignments. Live uses Talk to KREN; Press the microphone once to start a Live turn and again to finish it, from the next conversation. Hint guides a reply on demand. ADVANCED, Prepare hints in advance is off; on uses one extra request per turn. Each Source uses one in-chat microphone; stopping sends the turn. No text box or Send remains. Speaker, Hint, Skip, Replay and Stop stay below where offered.</li><li>Live defaults to When you stop: corrections arrive at Stop; As you go costs one request per turn. Stop sends corrections; Review now shows TAKE-HOME. Review now needs one sent or spoken answer. Back to chat resumes with microphone closed; Start new clears it. After five turns, More details opens the report; Apply prepares a lesson prompt.</li><li>Choose Source, Speak and rephrase. Say anything. KREN speaks two to four coaching sentences with bold blue quoted expressions. It coaches questions without answering or asking back. Replay speaks the whole paragraph; no learner feedback block appears. Register, Replies and VOICE &amp; MODEL remain available. Unused controls are disabled; Hint and Demo are unavailable.</li></ol><p>For an unfinished lesson source, Start and Demo are disabled with the tooltip "Finish the lesson and its practice first." Setting stays available. Choosing an unfinished lesson shows the completion reminder and restores the previous Source. TAKE-HOME teaches with Say it naturally, Learning targets, Pattern to keep, Done well, and Try next time: better ways to say your sentence, learning-map areas to practice next, and no advice on capitalization or punctuation for spoken turns; diagnosis is separate. No committed learner answer, including Demo or only skipped or withheld turns, means no take-home request or card.</p>
    <h4>Change voice and model</h4><p>Speech Source defaults to Google Cloud Chirp 3 HD.</p><ol><li>Open VOICE &amp; MODEL, TUTOR VOICE; choose Speech Source, voice, speed, Volume, Sentence pause, and preview.</li><li>In LLM ROUTING choose Provider, Gemini Profile, Thorough model, Fast model/thinking, Live Model, and Image Model. Fast covers eligible Thorough failures with the same Gemini key/profile; Auto uses lowest thinking. Fast cannot fall back to itself.</li></ol><p>Live needs the Live Gemini Profile's key and a live-capable Live Model in VOICE &amp; MODEL; the tutor text Provider can stay as it is. Gemini Live and Chirp 3 HD Voice defaults are Callirrhoe for female and Enceladus for male. Gemini Live sets its own sentence pauses. Voice/microphone changes apply from Start or Back to chat.</p>
    <p>For stronger replies, leave Fast model empty in LLM ROUTING; every fast step then uses the Thorough model.</p><h3>Light and dark view</h3><p>Choose a palette.</p><ol><li>Press the theme switch beside Settings and KREN menu.</li><li>Or set Panel theme in Settings, Display: Follow VS Code, Light, Dark.</li></ol><p>The choice is remembered.</p>
    <h3>Reset</h3><p>Clear the intended scope.</p><ol><li>In Settings, Usage choose Default Setting, then Continue/Restore Defaults; keys remain. Reset KREN also clears keys/consent/usage/grammar vocabulary; glossary entries remain.</li><li>Use tutor title-row Reset: Reset panel keeps model/microphone/voice; Reset everything restores all tutor settings. LESSON Reset clears lesson/practice; MODE Reset restores conversation preferences. Confirm; the panel announces the reset.</li></ol><p>Questions with choices and modal confirmations appear in VS Code's own dialog. Escape cancels a confirmation. Speech has no busy popup. Busy popups, failures, and provider-switch notices stay in the KREN panel. Master Reset clears session work; Cancel keeps it. First open and Reset everything leave LEARNING MAP unfolded and every other tutor section folded.</p>
    <h3>Troubleshooting</h3><p>Follow the symptom.</p>
    <h4>No key</h4><p>Restore access.</p><ol><li>Read the reason; use KREN menu, Credentials, Set key.</li><li>Check route/Profile.</li></ol><p>Offline grammar stays available.</p>
    <h4>Quota used up</h4><p>Gemini model fallback supports Free Tier and Paid in every feature. Fast steps cover hints, replies and Ask; Thorough covers lessons, reviews and diagnosis. Fast escalates once after validation failure, over 40 learner words, over 10 turns, or retry. Settings, Usage can send the same text to the next credentialed provider after daily/monthly exhaustion until midnight. Live and pictures stay on their provider.</p><ol><li>Use Cloud's Usage button.</li><li>Check provider quota/billing before retrying.</li></ol><p>Local resets do not change billing.</p>
    <h4>Pictures paused</h4><p>Continue chatting.</p><ol><li>Read the reason; check Picture provider and Gemini/Image Model or both Cloudflare credentials and daily allowance; or select None.</li><li>Start new after resolving access.</li></ol><p>Two failures pause pictures. With Gemini chosen, situation pictures need a Gemini Paid API key with billing enabled; the default image model costs about US$0.03 per picture and a conversation makes at most 10.</p>
    <h4>Microphone unavailable</h4><p>Restore capture or type.</p><ol><li>Check tooltip, permissions, device, Gemini key/Live Model or both Cloudflare credentials and daily allowance.</li><li>Choose Standard to type; leave/return before restarting capture.</li></ol><p>Leaving retains drafts.</p>
    <h3>Reference</h3><h4>What leaves the machine</h4>
    <p>Groq and Cloudflare receive submitted text and KREN instructions for Translation, Explain, Rewrite, Smart Grammar, and User Dictionary (with the selected word's sentence when Smart Word Capture is on). Tutor actions send lesson targets, practice answers, displayed conversation, hints, take-home, and diagnosis inputs needed for that action. Groq dictation sends one in-memory WAV clip at Stop. Auto chooses Handy, Cloudflare, Groq, then Gemini Free Tier. Get a Groq key at console.groq.com, API Keys; use Credentials. Limits checked 2026-10-11: Groq, 1,000 requests and 200,000 tokens daily per model, 8,000 tokens per minute; Cloudflare, 10,000 daily neurons shared with pictures and Whisper.</p>
    <ul><li>Lookups send exact expressions to dictionary APIs; Korean sends one headword. Multi-word English no-match alone can use Cloud, which sends text/target/format. Model actions send explicit text/instruction/settings; Harper/automatic checks stay local. Combined capture never stores or forwards raw Merriam-Webster wording.</li><li>Smart Word Capture sends the single sentence containing the selected word, up to 500 characters, by default; it is stored/exported and named on Source. Turn it off for expression only. No paragraph/neighboring sentence/file/workspace is added.</li><li>Gemini dictation stays in memory; stopping sends one WAV clip to Google, with no audio file. Live separately streams microphone audio. Cloudflare dictation sends one in-memory WAV clip at stop to Cloudflare Workers AI Whisper (whisper-large-v3-turbo). Auto chooses Handy, Cloudflare, Groq, then Gemini Free Tier.</li><li>Tutor sends question/recipe/exercise/answer. Empty Ask confirms passage analysis; passage is not retained separately. Lesson conversation snapshots subject, target identifiers/roles/labels/descriptions, example sentences/annotation excerpts, and missed prompts/identifiers/saved reviewed answers. Opening, turns, Live setup/notes, Skip, Hint including prefetched Hint, deferred and retry coaching, Demo casting and batches reuse it, possibly with another provider. Custom situations go only at opening/casting. No document, dictionary response, credential, path, workspace, or unrelated history is added.</li><li>Diagnosis sends completed unskipped prompts/answers/corrections/map labels. With CONVERSATION, ADVANCED, Take-home card on, Stop after at least one committed learner answer makes one TAKE-HOME request with committed transcript/lesson context, excluding drafts/skipped/withheld turns. Edge card reading sends text to Microsoft; Live uses a separate Gemini speech session without microphone unless Chirp is chosen. Gemini pictures send intro, then last six displayed turns/previous picture; Cloudflare pictures send scene text and recent turns only, excluding hidden coaching/settings/document/workspace. Tutor content stays in memory.</li><li>Local reading sends cleaned text to System.Speech; Edge sends cleaned text/voice/rate/volume to Microsoft and deletes temporary audio. Open full details writes to Output, which VS Code may log. Keys stay in Secret Storage; no telemetry/history/clipboard watching.</li></ul>
    <p>Cloudflare pictures and Whisper share 10,000 free neurons a day. A FLUX.1 schnell picture used about 173 neurons in a test on 2026-10-10, roughly 57 pictures a day before other use; Cloudflare does not report FLUX.2 klein 4B's usage. Continuation pictures from FLUX may not keep the same people. Both Cloudflare credentials stay in SecretStorage, never panel HTML, logs, settings, or files.</p>
    <p>Google Cloud Chirp 3 HD under VOICE &amp; MODEL, TUTOR VOICE sends spoken text to Google Cloud Text-to-Speech. It uses Gemini female/male defaults plus Reading Speed and Volume. Set its key in Credentials, or use the stored Cloud Translation key. Test checks playback. Enable Cloud Text-to-Speech API; usage is billed to your project after any free allowance. Temporary MP3 files play natively and are deleted after playback or Stop. Synthesis retries once except HTTP 400, 401, and 403; playback never re-synthesizes. Edge failure uses the tutor Windows voice for the remaining text. One notice per conversation names the cause and voice. Live replies use a stored Gemini key with any text provider; Chirp reads take-home, learner Replay, Demo and previews without extra Live sessions. Without Live, the chosen Speech Source speaks Standard replies.</p>
    <h4>Limits and requirements</h4><p>Offline grammar needs no API key, account, Python, Node.js, GPU, or network. Windows-native speech is unavailable in WSL, SSH, Dev Containers, Codespaces. Merriam-Webster: non-commercial, two references, 1000 daily queries each. Cloud: 500,000 characters per Pacific-Time billing month; default text limit 5,000, timeout 30 seconds. Tutor: three Primary/three Support, 1 to 20 examples/items, five turns for diagnosis, ten pictures, twenty Demo exchanges. Provider terms govern costs/retention; Gemini API users must be at least 18, use it for professional or business purposes, and meet regional eligibility. KREN makes no service-tier claim.</p>
    <p>When provider switching is on, a used-up daily or monthly free limit can send the same submitted text to the next provider with stored credentials, until local midnight. A Gemini overload after automatic retries can also switch providers for that request; it does not exhaust the Gemini pool until midnight. Live, pictures and dictation keep their selected provider.</p><p>Request timeout: How long KREN waits for a provider. Cloudflare pictures wait at least 60 seconds; Google Cloud speech ignores this.</p><p>Usage has provider-order Move up and Move down; Credentials has Requests today.</p><h4>Settings list</h4><p>Settings: Startup and Panel, Translation, Grammar Check, Explain Meaning or Nuance, Rewrite Text, Read Aloud, Dictionary, User Dictionary, Display, Usage. KREN menu, Credentials: keys. Tutor: LESSON SETTING, MODE, ADVANCED, VOICE &amp; MODEL. Preferences: Open Settings filtered for kren lists all settings.</p>
    <p class="credits">${krenCreditLine(version)}</p>`;
}
/**
 * The warning shown when a translation was asked to write in the language it was given.
 *
 * The owner asked for it on 2026-08-28, in the same message that removed the Auto output
 * mode. Auto had been hiding this case by silently swapping the target, so removing it makes
 * the case reachable and the reader has to be told rather than left wondering why the result
 * looks like the selection.
 *
 * Derived from the result's own two language fields rather than from a flag set upstream, so
 * it cannot disagree with the direction line printed beside it, and an explanation asked to
 * restate in its own language is covered by the same rule without anything being wired.
 */
function sameLanguageWarning(
  operation: 'translate' | 'explain',
  sourceLanguage: string,
  targetLanguage: string
): string {
  if (!isSameLanguage(sourceLanguage, targetLanguage)) return '';
  /*
   * Never on an explanation. Explanation language defaults to Same as source, so the two
   * agreeing is the normal case there and a warning would fire on every default run. It did
   * in 1.7.9, because the result carried no operation and the renderer could not tell a
   * translation from an explanation.
   */
  if (operation !== 'translate') return '';
  return '<p class="same-language-warning">Input and output languages are identical.</p>';
}

function renderTranslation(result: Extract<KrenResult, { kind: 'translation' }>): string {
  const alternatives = result.alternatives?.length
    ? `<h3>Alternatives</h3><ul class="translation-alternatives">${result.alternatives.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '';
  const note = result.note ? `<p class="note">${escapeHtml(result.note)}</p>` : '';
  const fallbackNote = result.fallbackFromModel
    ? `<div class="model-note">Fallback used after <strong>${escapeHtml(result.fallbackFromModel)}</strong> could not produce a usable result.</div>`
    : '';
  const sameLanguage = sameLanguageWarning(
    result.operation,
    result.sourceLanguage,
    result.targetLanguage
  );
  return `<div class="direction">${escapeHtml(languageName(result.sourceLanguage))} → ${escapeHtml(languageName(result.targetLanguage))}</div>
    ${sameLanguage}${fallbackNote}<p class="translation">${escapeHtml(result.translatedText)}</p>${alternatives}${note}`;
}

/**
 * Which findings this panel opens on, as a set of issue ids.
 *
 * The rule is core's, not this panel's. The Word task pane opens on the same choices, and
 * the collision rule that keeps the set applicable has to read the same insertion
 * convention as `applyGrammarChoices`, which is in the same core file. This wrapper exists
 * only because the markup asks `has(id)` per radio while core answers in the shape its own
 * apply function takes. It is given the whole result rather than the issues alone because
 * core checks each finding against the text it was found in.
 */
export function preselectedGrammarChoices(result: GrammarResult): Set<string> {
  return new Set(corePreselectedGrammarChoices(result).map((choice) => choice.issueId));
}

// Lifted out of the markup template, where these were inline literals inside a nested
// template string. A character class written there has to survive two levels of escaping.
const GRAMMAR_SPELLING_CATEGORY = /spell/iu;
const GRAMMAR_SINGLE_WORD = /^[\p{L}][\p{L}\p{M}'’-]*$/u;

function renderGrammar(
  result: GrammarResult,
  choices: ReadonlyArray<{ issueId: string; suggestionIndex: number }> | undefined,
  allowReplace: boolean
): string {
  if (!result.issues.length) {
    return '<p><strong>No spelling or grammar issues found.</strong></p><p class="muted">Harper is a local rule-based checker; a clean result is not a guarantee that every possible issue was detected.</p>';
  }
  // The selection comes from the extension, which owns it across renders. Deriving it here
  // would reset every radio to its preselected state each time one of them was clicked,
  // because a click re-renders the whole document.
  // Falls back to the preselection when no caller supplied a set, so the renderer is
  // correct on its own. A renderer that showed nothing checked whenever the argument was
  // missing would look right in every test that passed one and be wrong everywhere else.
  const selected = new Map((choices ?? corePreselectedGrammarChoices(result))
    .map(({ issueId, suggestionIndex }) => [issueId, suggestionIndex] as const));
  // An absent entry means Keep original, not "nothing selected". A finding with no
  // suggestions never appears in a choice set, and leaving all of its radios unchecked
  // would show a fieldset with no answer in it at all.
  const chosen = (issueId: string, suggestionIndex: number): boolean =>
    (selected.get(issueId) ?? -1) === suggestionIndex;
  const found = `<strong>${result.issues.length}</strong> possible issue${result.issues.length === 1 ? '' : 's'} found${result.smartModelId ? ` by Harper and ${escapeHtml(result.smartModelId)}` : ''}.`;
  return `<p class="grammar-summary">${found} Choose a correction for each finding, edit the corrected text below if you want to, then Replace or Copy it. KREN changes nothing in your document until you press Replace.</p>
    ${grammarDraftPanel(grammarDraft(result, [...selected].map(([issueId, suggestionIndex]) => ({ issueId, suggestionIndex }))), allowReplace)}
    ${result.issues.map((issue, issueIndex) => `<fieldset class="grammar-issue">
      <legend>${issueIndex + 1}. ${escapeHtml(issue.category)}</legend>
      <div>${escapeHtml(issue.message)}</div>
      <div class="grammar-problem">${escapeHtml(issue.original || '(insertion point)')}</div>
      <div class="grammar-options">
        <label class="grammar-option"><input type="radio" name="grammar-${escapeHtml(issue.id)}" data-grammar-issue="${escapeHtml(issue.id)}" data-grammar-choice="-1"${chosen(issue.id, -1) ? ' checked data-was-checked="-1"' : ''}> <span>Keep original</span></label>
        ${issue.suggestions.map((suggestion, suggestionIndex) => `<label class="grammar-option"><input type="radio" name="grammar-${escapeHtml(issue.id)}" data-grammar-issue="${escapeHtml(issue.id)}" data-grammar-choice="${suggestionIndex}"${chosen(issue.id, suggestionIndex) ? ` checked data-was-checked="${suggestionIndex}"` : ''}> <span>${escapeHtml(suggestion.label)}</span></label>`).join('')}
      </div>
      <div class="settings-buttons">
        ${GRAMMAR_SPELLING_CATEGORY.test(issue.category) && GRAMMAR_SINGLE_WORD.test(issue.original.trim()) ? `<button class="secondary" data-command="addGrammarWord" data-grammar-issue="${escapeHtml(issue.id)}">Add to local dictionary</button>` : ''}
      </div>
    </fieldset>`).join('')}`;
}

/**
 * The checked passage with the selected corrections in it, or the reason there isn't one.
 *
 * `applyGrammarChoices` throws when two selected corrections overlap, which it does rather
 * than guessing which one wins. The reader can reach that state with two clicks, so it is a
 * message in the panel and not an exception out of a render.
 */
function grammarDraft(
  result: GrammarResult,
  choices: ReadonlyArray<{ issueId: string; suggestionIndex: number }>
): GrammarDraftState {
  if (!result.issues.some((issue) => issue.suggestions.length > 0)) return {};
  try {
    return { text: coreApplyGrammarChoices(result, choices) };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The corrected passage, editable, with the two controls that act on exactly what it holds.
 *
 * Replace and Copy read this box rather than recomputing from the radio buttons, so an edit
 * made here is what reaches the document or the clipboard. That is the point of the box:
 * the owner asked for the Word task pane's behaviour, where the draft you can see and
 * change is the draft that gets used. Before this the panel offered Apply and Copy over a
 * set of radios with no way to see what either would produce.
 */
function grammarDraftPanel(
  draft: GrammarDraftState | undefined,
  allowReplace: boolean
): string {
  if (draft?.error) {
    return `<div class="grammar-draft"><p class="storage-error"><strong>These corrections cannot be combined.</strong> ${escapeHtml(draft.error)}</p><p class="muted">Set one of the overlapping findings back to Keep original.</p></div>`;
  }
  if (draft?.text === undefined) return '';
  return `<div class="grammar-draft">
    <label class="grammar-draft-label" for="grammar-draft-text">Corrected text</label>
    <textarea id="grammar-draft-text" data-grammar-draft rows="6" spellcheck="false" maxlength="${PANEL_TEXT_MAX_LENGTH}">${escapeHtml(draft.text)}</textarea>
    <div class="variant-actions">
      ${allowReplace ? iconButton('applyGrammar', 'data-grammar-draft-action', 'Replace selection', 'Replace the selection with the corrected text', 'replace') : ''}
      ${iconButton('copyGrammar', 'data-grammar-draft-action data-copy-confirm', 'Copy', 'Copy the corrected text', 'copy')}
      ${iconButton('resetGrammarDraft', '', 'Reset', 'Reset the corrected text to the selected corrections', 'reset')}
    </div>
  </div>`;
}

function grammarActions(result: GrammarResult): string {
  // Replace and Copy moved next to the corrected text they act on, so the footer keeps only
  // what is not about that text.
  //
  // A clean result gets no controls at all, at the owner's request on 2026-08-23. There is
  // nothing to open in full details beyond the sentence already on screen, and the text the
  // Copy control would have copied is the text the reader selected a moment ago and still
  // has selected.
  /*
    * Ignore all sits beside Open full details at the owner's request on 2026-08-29. It is
    * the whole-result counterpart of the per-issue ignore already on each row: it drops
    * every suggestion at once, clears the stored result, the hover, and the editor's code
    * actions, and leaves the panel on the Start page rather than on an empty result.
    */
  return result.issues.length === 0
    ? ''
    : `<button class="secondary" data-command="details">Open full details</button>
       <button class="secondary" data-command="ignoreGrammarResult">Ignore all</button>`;
}

function renderDictionary(result: DictionaryResult): string {
  if (result.sections?.length) {
    return result.sections.map(renderDictionarySection).join('');
  }
  const headword = result.pronunciation
    ? `${escapeHtml(result.headword)} <span class="pronunciation">[${escapeHtml(result.pronunciation)}]</span>`
    : escapeHtml(result.headword);
  return `<h2 class="headword">${headword}</h2>${result.entries.map((entry, index) => `
    <div class="entry"><div><span class="sense-number">${index + 1}.</span><strong>${escapeHtml(entry.meaning)}</strong>${entry.partOfSpeech ? ` <span class="part">${escapeHtml(entry.partOfSpeech)}</span>` : ''}</div>
    ${entry.definition ? `<div>${escapeHtml(entry.definition)}</div>` : ''}${renderExamples(entry.examples)}</div>`).join('')}${renderNote(result.note)}`;
}

function renderDictionarySection(section: DictionarySection): string {
  const audio = renderAudioButton(section.audioUrl, section.headword);
  const pronunciation = section.pronunciation
    ? `<div class="pronunciation">${escapeHtml(section.pronunciation)}${audio}</div>`
    : audio;
  const forms = section.inflections?.length
    ? `<div class="forms">${section.inflections.map(escapeHtml).join('; ')}</div>`
    : '';
  const entries = section.entries.map((entry, index) => `<div class="sense">
    <span class="sense-number">${escapeHtml(entry.senseNumber ?? String(index + 1))}</span>
    ${entry.grammaticalLabel ? `<span class="part">${escapeHtml(entry.grammaticalLabel)}</span> ` : ''}${escapeHtml(entry.meaning)}
    ${renderExamples(entry.examples)}</div>`).join('');
  const discussions = section.synonymDiscussions?.map((discussion) => `<div class="discussion">
    <strong>${escapeHtml(synonymDiscussionTitle(section.headword, discussion.label))}</strong>
    <div class="muted">Merriam-Webster editorial comparison for this sense; not Cloud Translation.</div>
    ${discussion.blocks?.length
      ? discussion.blocks.map((block) => block.kind === 'example'
        ? `<blockquote>${escapeHtml(block.text)}</blockquote>`
        : `<p>${escapeHtml(block.text)}</p>`).join('')
      : `<p>${escapeHtml(discussion.text)}</p>${renderExamples(discussion.examples)}`}
    ${discussion.seeAlso?.length ? `<div class="muted">See also: ${discussion.seeAlso.map(escapeHtml).join(', ')}</div>` : ''}
  </div>`).join('') ?? '';
  return `<article class="entry"><h2 class="headword">${escapeHtml(section.headword)} ${section.partOfSpeech ? `<span class="part">${escapeHtml(section.partOfSpeech)}</span>` : ''}</h2>${pronunciation}${forms}${entries}${discussions}</article>`;
}

function synonymDiscussionTitle(headword: string, label: string | undefined): string {
  return !label || /^synonyms?$/iu.test(label.trim())
    ? `Choose the Right Synonym for ${headword}`
    : label;
}

function renderThesaurus(result: ThesaurusResult): string {
  return `${result.sections.map((section) => `<article class="entry">
    <h2 class="headword">${escapeHtml(section.headword)} ${section.partOfSpeech ? `<span class="part">${escapeHtml(section.partOfSpeech)}</span>` : ''}</h2>
    ${section.pronunciation ? `<div class="pronunciation">${escapeHtml(section.pronunciation)}${renderAudioButton(section.audioUrl, section.headword)}</div>` : renderAudioButton(section.audioUrl, section.headword)}
    ${section.senses.map((sense, index) => `<div class="sense">
      ${sense.definition ? `<div><span class="sense-number">${escapeHtml(sense.senseNumber ?? String(index + 1))}</span>${escapeHtml(sense.definition)}</div>` : ''}
      ${renderRelation('Synonyms', sense.synonyms)}
      ${renderRelation('Near synonyms', sense.nearSynonyms)}
      ${renderRelation('Related words', sense.relatedWords)}
      ${renderRelation('Synonymous phrases', sense.synonymousPhrases)}
      ${renderRelation('Antonyms', sense.antonyms)}
      ${renderRelation('Near antonyms', sense.nearAntonyms)}
    </div>`).join('')}
  </article>`).join('')}${renderNote(result.note)}`;
}

function renderRewrite(
  result: RewriteResult,
  allowReplace: boolean,
  settings: KrenPanelSettings
): string {
  // Both variants are shown, one after the other, in the order core produces them:
  // Minimal Rewrite then Full Rewrite. They were tabs until 2026-08-22, and the owner
  // asked for both at once, because comparing the two is the point of asking for both and
  // a tab hides exactly the half you are comparing against.
  const panels = result.variants.map((variant) => `<article class="rewrite-variant" data-variant-panel="${variant.id}">
    <h3>${escapeHtml(variant.label)}</h3>
    <p class="rewrite-text">${escapeHtml(variant.text)}</p>
    ${variant.changeNote ? `<p class="change-note"><strong>What changed:</strong> ${escapeHtml(variant.changeNote)}</p>` : ''}
    <div class="variant-actions">
      ${copyIconButton('copyVariant', `data-variant-id="${variant.id}"`, variant.label)}
      ${allowReplace ? replaceIconButton('replaceVariant', `data-variant-id="${variant.id}"`, variant.label) : ''}
      ${settings.ttsEnabled ? `${readAloudIconButton('readVariant', `data-variant-id="${variant.id}"`, variant.label)}${stopSpeechIconButton()}` : ''}
      ${settingsIconButton('editRewriteSettings', '', variant.label)}
    </div>
  </article>`).join('');
  const fallbackNote = result.fallbackFromModel
    ? `<div class="model-note">Fallback used after <strong>${escapeHtml(result.fallbackFromModel)}</strong> could not produce a usable result.</div>`
    : '';
  return `${fallbackNote}${panels}`;
}

function renderSettings(
  settings: KrenPanelSettings,
  proModels: GeminiModelOption[],
  openAIModels: GeminiModelOption[],
  anthropicModels: GeminiModelOption[],
  brandImageUri: string | undefined,
  inferredRewriteModality: RewriteModality | undefined,
  activeRewriteSettingsGroup: RewriteSettingsGroup | undefined,
  rewriteReplay: RewriteReplayState | undefined,
  hasHeldResult = false
): string {
  const effectiveModality = inferredRewriteModality ?? settings.rewriteModality;
  const formattingInactiveReason = effectiveModality === REWRITE_MODALITIES[1].id
    ? 'Inactive while modality is Spoken, because Markdown and LaTeX are not audible. The stored setting is unchanged.'
    : undefined;
  const modeAxes: RewriteModeAxes = {
    modality: effectiveModality,
    function: settings.rewriteFunction,
    domain: settings.rewriteDomain,
    formality: settings.rewriteFormality,
    voice: settings.rewriteVoice,
    stance: settings.rewriteStance,
    length: settings.rewriteLength,
    perspective: settings.rewritePerspective
  };
  const activeMode = matchingRewriteMode(modeAxes);
  return `${renderHeader('', false, brandImageUri, false, hasHeldResult)}

    <h2>KREN Settings</h2>
    <p class="settings-intro">Settings save to this VS Code profile; API keys stay in Secret Storage. ChatGPT and Claude subscriptions don\'t include API usage.</p>
    <details class="settings-group" data-settings-section="startup" data-persist-id="settings-startup" open>
      <summary><h3>Startup and Panel</h3></summary>
      ${toggleSetting(
        'Reopen KREN at startup',
        'When on, KREN reopens in the Secondary Sidebar after VS Code starts. Show KREN turns this on; Close KREN Panel turns it off.',
        'results.openAtStartup',
        settings.openResultsAtStartup
      )}
    </details>
    <details class="settings-group" data-settings-section="translation" data-persist-id="settings-translation" open>
      <summary><h3>Translation</h3></summary>
      ${selectSetting('Translation provider', 'Dictionary providers are configured separately.', 'translationProvider', settings.translationProvider, [
        ['googleCloudTranslation', 'Google Cloud Translation'], ['gemini', 'LLM']
      ])}${credentialSettingNote(settings, 'translationProvider', settings.translationProvider === 'googleCloudTranslation' ? 'googleCloudTranslation' : '')}
      ${translationLanguageSettings(settings.translationSourceLanguage, settings.translationTargetLanguage)}
      ${numberSetting('Maximum characters', 'Longest selection per request. Longer selections are refused with their length, not truncated.', 'translation.maxCharacters', settings.translationMaxCharacters, 1, 20000)}
      ${inactiveWhen(
        settings.translationProvider === 'googleCloudTranslation',
        'Inactive while Translation provider is Google Cloud Translation, whose API takes no subject area. The stored value is kept and applies again with a language model.',
        selectSetting('Domain', 'Subject area for the translation. Guides terminology without sending document or workspace context.', 'translation.domain', settings.translationDomain, rewriteAxisOptions(REWRITE_DOMAINS))
      )}
      ${llmRoutingGroup(
        'translation',
        routingSettingsSummary({
          provider: settings.translationRoutingProvider,
          model: settings.translationModel,
          alternateModel: settings.translationAlternateModel,
          thinkingOrEffort: settings.translationThinkingOrEffort,
          geminiProfile: settings.translationProfile,
          fallbackEnabled: settings.translationFallbackEnabled,
          fallbackModel: settings.translationFallbackModel,
          fallbackThinkingOrEffort: settings.translationFallbackThinkingOrEffort
        }),
        providerSettings('translation', {
          provider: settings.translationRoutingProvider,
          model: settings.translationModel,
          alternateModel: settings.translationAlternateModel,
          thinkingOrEffort: settings.translationThinkingOrEffort,
          geminiProfile: settings.translationProfile,
          fallbackEnabled: settings.translationFallbackEnabled,
          fallbackModel: settings.translationFallbackModel,
          fallbackThinkingOrEffort: settings.translationFallbackThinkingOrEffort
        }, settings, proModels, openAIModels, anthropicModels, true),
        {
          key: 'translationProvider',
          value: 'gemini',
          active: settings.translationProvider === 'gemini',
          reason: 'Inactive while Translation provider is Google Cloud Translation (no language model). Stored values are kept.'
        }
      )}
    </details>
    <details class="settings-group" data-settings-section="grammar" data-persist-id="settings-grammar" open>
      <summary><h3>Grammar Check</h3></summary>
      <p class="settings-intro">Harper checks English grammar and spelling offline: no API key, network, or language model. Smart Grammar Check adds an online pass with a model you choose.</p>
      ${selectSetting('Input language', 'Harper checks English only and skips other languages. Choosing a dialect sets its regional spelling.', 'grammar.dialect', settings.grammarDialect, [
        ['auto', 'Auto-detect'],
        ['american', 'American English'], ['british', 'British English'],
        ['australian', 'Australian English'], ['canadian', 'Canadian English'],
        ['indian', 'Indian English']
      ])}
      ${toggleSetting('Smart Grammar Check', 'Adds a language-model pass to Grammar Check that catches what rules miss, like correct but unnatural phrasing.', 'grammar.smart', settings.grammarSmart)}
      ${llmRoutingGroup(
        'grammar',
        routingSettingsSummary({
          provider: settings.userDictionaryProvider,
          model: settings.userDictionaryModel,
          alternateModel: settings.userDictionaryAlternateModel,
          thinkingOrEffort: settings.userDictionaryThinkingOrEffort,
          geminiProfile: settings.userDictionaryProfile,
          fallbackEnabled: settings.userDictionaryFallbackEnabled,
          fallbackModel: settings.userDictionaryFallbackModel,
          fallbackThinkingOrEffort: settings.userDictionaryFallbackThinkingOrEffort
        }),
        `<p class="model-note">Grammar Check and User Dictionary share this model profile; changes in either apply to both.</p>
        ${providerSettings('userDictionary', {
          provider: settings.userDictionaryProvider,
          model: settings.userDictionaryModel,
          alternateModel: settings.userDictionaryAlternateModel,
          thinkingOrEffort: settings.userDictionaryThinkingOrEffort,
          geminiProfile: settings.userDictionaryProfile,
          fallbackEnabled: settings.userDictionaryFallbackEnabled,
          fallbackModel: settings.userDictionaryFallbackModel,
          fallbackThinkingOrEffort: settings.userDictionaryFallbackThinkingOrEffort
        }, settings, proModels, openAIModels, anthropicModels)}`,
        {
          key: 'grammar.smart',
          value: 'true',
          active: settings.grammarSmart,
          reason: 'Inactive while Smart Grammar Check is off. Grammar Check then runs entirely on this computer and calls no language model.'
        }
      )}
      ${toggleSetting('Automatic paragraph checking', 'After typing pauses, check only the current paragraph locally. Off by default.', 'grammar.autoCheck', settings.grammarAutoCheck)}
      ${selectSetting('Automatic-check delay', 'Wait after the last edit before checking the current paragraph.', 'grammar.autoCheckDelayMs', String(settings.grammarAutoCheckDelayMs), [
        ['500', '0.5 seconds'], ['900', '0.9 seconds (recommended)'], ['1500', '1.5 seconds'], ['2500', '2.5 seconds']
      ])}
      <p class="settings-intro">Local vocabulary: <strong>${settings.grammarCustomWordCount}</strong> custom word${settings.grammarCustomWordCount === 1 ? '' : 's'} and <strong>${settings.grammarIgnoredFindingCount}</strong> ignored finding hash${settings.grammarIgnoredFindingCount === 1 ? '' : 'es'}. Checked text and document history are never stored.</p>
      <div class="settings-buttons"><button class="secondary" data-command="runCommand" data-action="kren.clearGrammarFindings">Clear findings</button><button class="secondary" data-command="runCommand" data-action="kren.clearGrammarCustomDictionary">Clear custom dictionary</button><button class="secondary" data-command="runCommand" data-action="kren.clearIgnoredGrammarFindings">Clear ignored findings</button></div>
    </details>
    <details class="settings-group" data-settings-section="explain" data-persist-id="settings-explain" open>
      <summary><h3>Explain Meaning or Nuance</h3></summary>
      ${explanationLanguageSetting(settings.explanationOutputLanguage)}
      ${selectSetting('Domain', 'Subject area for the explanation. Guides terminology without sending document or workspace context.', 'explanation.domain', settings.explanationDomain, rewriteAxisOptions(REWRITE_DOMAINS))}
      ${llmRoutingGroup(
        'explain',
        routingSettingsSummary({
          provider: settings.explanationProvider,
          model: settings.explanationModel,
          alternateModel: settings.explanationAlternateModel,
          thinkingOrEffort: settings.explanationThinkingOrEffort,
          geminiProfile: settings.explanationProfile,
          fallbackEnabled: settings.explanationFallbackEnabled,
          fallbackModel: settings.explanationFallbackModel,
          fallbackThinkingOrEffort: settings.explanationFallbackThinkingOrEffort
        }),
        providerSettings('explanation', {
          provider: settings.explanationProvider,
          model: settings.explanationModel,
          alternateModel: settings.explanationAlternateModel,
          thinkingOrEffort: settings.explanationThinkingOrEffort,
          geminiProfile: settings.explanationProfile,
          fallbackEnabled: settings.explanationFallbackEnabled,
          fallbackModel: settings.explanationFallbackModel,
          fallbackThinkingOrEffort: settings.explanationFallbackThinkingOrEffort
        }, settings, proModels, openAIModels, anthropicModels)
      )}
    </details>
    <details class="settings-group" data-settings-section="rewrite" data-persist-id="settings-rewrite" open>
      <summary><h3>Rewrite Text</h3></summary>
      ${rewriteApplyBar(rewriteReplay)}
      ${rewriteModeSetting(activeMode?.id)}
      ${rewriteSettingsGroup(
        'routing',
        LLM_ROUTING_LABEL,
        settingsSummary([
          ['Provider', languageModelRoutingProviderLabel(settings.rewriteProvider), settings.rewriteProvider === 'gemini'],
          ['Gemini profile', settings.rewriteProfile === 'standard' ? 'Free Tier' : 'Paid', settings.rewriteProfile === 'standard'],
          ['Model', settings.rewriteModel, false],
          ['Thinking level', languageModelRoutingEffortLabel(settings.rewriteThinkingOrEffort), false],
          ['Automatic fallback', settings.rewriteFallbackEnabled ? 'On' : 'Off', !settings.rewriteFallbackEnabled],
          ['Fallback model', settings.rewriteFallbackModel, false],
          ['Fallback thinking', languageModelRoutingEffortLabel(settings.rewriteFallbackThinkingOrEffort), false],
          ['Source language', settings.rewriteSourceLanguage === 'auto' ? 'Auto-detect' : settings.rewriteSourceLanguage, settings.rewriteSourceLanguage === 'auto']
        ]),
        `${providerSettings('rewrite', {
          provider: settings.rewriteProvider,
          model: settings.rewriteModel,
          alternateModel: settings.rewriteAlternateModel,
          thinkingOrEffort: settings.rewriteThinkingOrEffort,
          geminiProfile: settings.rewriteProfile,
          fallbackEnabled: settings.rewriteFallbackEnabled,
          fallbackModel: settings.rewriteFallbackModel,
          fallbackThinkingOrEffort: settings.rewriteFallbackThinkingOrEffort
        }, settings, proModels, openAIModels, anthropicModels)}
        ${selectSetting('Source language', 'Auto-detect preserves the detected language. Choose a language when short or mixed text is ambiguous.', 'rewrite.sourceLanguage', settings.rewriteSourceLanguage, [
          ['auto', 'Auto-detect (recommended)'], ['en', 'English'], ['ko', 'Korean'],
          ['ja', 'Japanese'], ['zh-CN', 'Chinese (Simplified)'], ['zh-TW', 'Chinese (Traditional)'],
          ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'],
          ['pt', 'Portuguese'], ['hi', 'Hindi'], ['ar', 'Arabic'], ['ru', 'Russian']
        ])}`,
        activeRewriteSettingsGroup
      )}
      ${rewriteSettingsGroup(
        'channel',
        'CHANNEL',
        settingsSummary([
          ['Modality', rewriteAxisLabel(REWRITE_MODALITIES, effectiveModality), effectiveModality === REWRITE_MODALITIES[0].id],
          ['Function', rewriteAxisLabel(REWRITE_FUNCTIONS, settings.rewriteFunction), settings.rewriteFunction === REWRITE_FUNCTIONS[0].id],
          ['Output language', settings.rewriteEnglishVariety === 'otherLanguage'
            ? rewriteOtherLanguageLabel(settings.rewriteOtherOutputLanguage)
            : rewriteAxisLabel(REWRITE_ENGLISH_VARIETIES, settings.rewriteEnglishVariety), settings.rewriteEnglishVariety === REWRITE_ENGLISH_VARIETIES[0].id]
        ]),
        `${selectSetting(inferredRewriteModality ? 'Modality (inferred)' : 'Modality', inferredRewriteModality ? 'Read Aloud inferred Spoken for this result. Pin it to make Spoken the saved default.' : 'Choose Written for text read on a page or Spoken for text delivered aloud.', 'rewrite.modality', effectiveModality, rewriteAxisOptions(REWRITE_MODALITIES))}
        ${inferredRewriteModality ? '<div class="settings-buttons"><button class="secondary" data-command="pinInferredModality">Pin inferred Spoken modality</button></div>' : ''}
        ${selectSetting('Function', 'Identifies what kind of document or channel the selected text belongs to.', 'rewrite.function', settings.rewriteFunction, rewriteAxisOptions(REWRITE_FUNCTIONS))}
        ${selectSetting('Output language', 'Same as source keeps your language. An English option writes the result in English, translating if needed. International English uses region-neutral wording.', 'rewrite.englishVariety', settings.rewriteEnglishVariety, rewriteAxisOptions(REWRITE_ENGLISH_VARIETIES))}
        <div data-enabled-for="rewrite.englishVariety" data-enabled-value="otherLanguage">
          ${selectSetting('Other output language', 'Read only when Output language is Other languages. These are the languages KREN offers beyond English.', 'rewrite.otherOutputLanguage', settings.rewriteOtherOutputLanguage, REWRITE_OTHER_LANGUAGES.map((language) => [language.id, language.label]))}
        </div>`,
        activeRewriteSettingsGroup
      )}
      ${rewriteSettingsGroup(
        'subject',
        'SUBJECT',
        settingsSummary([
          ['Domain', rewriteAxisLabel(REWRITE_DOMAINS, settings.rewriteDomain), settings.rewriteDomain === REWRITE_DOMAINS[0].id]
        ]),
        selectSetting('Domain', 'Guides terminology and conventions without sending document or workspace context.', 'rewrite.domain', settings.rewriteDomain, rewriteAxisOptions(REWRITE_DOMAINS)),
        activeRewriteSettingsGroup
      )}
      ${rewriteSettingsGroup(
        'register',
        'REGISTER',
        settingsSummary([
          ['Formality', rewriteAxisLabel(REWRITE_FORMALITIES, settings.rewriteFormality), settings.rewriteFormality === REWRITE_FORMALITIES[0].id],
          ['Voice', rewriteAxisLabel(REWRITE_VOICES, settings.rewriteVoice), settings.rewriteVoice === REWRITE_VOICES[0].id],
          ['Stance', rewriteAxisLabel(REWRITE_STANCES, settings.rewriteStance), settings.rewriteStance === REWRITE_STANCES[0].id]
        ]),
        `${selectSetting('Formality', 'Controls the level of formality independently from voice and stance.', 'rewrite.formality', settings.rewriteFormality, rewriteAxisOptions(REWRITE_FORMALITIES))}
        ${selectSetting('Voice', 'Controls the writer\'s rhetorical character.', 'rewrite.voice', settings.rewriteVoice, rewriteAxisOptions(REWRITE_VOICES))}
        ${selectSetting('Stance', 'Controls the writer\'s interpersonal posture toward the reader.', 'rewrite.stance', settings.rewriteStance, rewriteAxisOptions(REWRITE_STANCES))}`,
        activeRewriteSettingsGroup
      )}
      ${rewriteSettingsGroup(
        'shape',
        'SHAPE',
        settingsSummary([
          ['Length', rewriteAxisLabel(REWRITE_LENGTHS, settings.rewriteLength), settings.rewriteLength === REWRITE_LENGTHS[0].id],
          ['Perspective', rewriteAxisLabel(REWRITE_PERSPECTIVES, settings.rewritePerspective), settings.rewritePerspective === REWRITE_PERSPECTIVES[0].id]
        ]),
        `${selectSetting('Length', 'Preserve, compress, or expand the finished rewrite without changing its claims.', 'rewrite.length', settings.rewriteLength, rewriteAxisOptions(REWRITE_LENGTHS))}
        ${selectSetting('Perspective', 'Preserve perspective or request first-person or impersonal wording.', 'rewrite.perspective', settings.rewritePerspective, rewriteAxisOptions(REWRITE_PERSPECTIVES))}`,
        activeRewriteSettingsGroup
      )}
      ${rewriteSettingsGroup(
        'intent',
        'INTENT',
        settingsSummary([
          ['Rhetorical mode', rewriteAxisLabel(REWRITE_RHETORICAL_MODES, settings.rewriteRhetoricalMode), settings.rewriteRhetoricalMode === REWRITE_RHETORICAL_MODES[0].id]
        ]),
        selectSetting('Rhetorical mode', 'Controls what the rewrite is trying to accomplish. Preserve is the safest default.', 'rewrite.rhetoricalMode', settings.rewriteRhetoricalMode, rewriteAxisOptions(REWRITE_RHETORICAL_MODES)),
        activeRewriteSettingsGroup
      )}
      ${rewriteSettingsGroup(
        'variants',
        'VARIANTS',
        settingsSummary([
          ['Quick menu', settings.quickMenuRewriteVariant === ALL_REWRITE_VARIANTS_ID ? 'Both Variants' : rewriteVariantLabel(settings.quickMenuRewriteVariant), settings.quickMenuRewriteVariant === ALL_REWRITE_VARIANTS_ID]
        ]),
        `${selectSetting('Quick-menu rewrite', 'This choice is listed first; Both Variants, Minimal Rewrite, and Full Rewrite remain available.', 'rewrite.quickMenuVariant', settings.quickMenuRewriteVariant, [
          [ALL_REWRITE_VARIANTS_ID, 'Both Variants'], ...rewriteVariantOptions()
        ])}`,
        activeRewriteSettingsGroup
      )}
      ${rewriteSettingsGroup(
        'output',
        'OUTPUT',
        settingsSummary([
          ['Protect formatting', settings.preserveFormatting ? 'On' : 'Off', settings.preserveFormatting],
          ['Change notes', settings.includeChangeNotes ? 'On' : 'Off', !settings.includeChangeNotes],
          ['Read Aloud controls', settings.ttsEnabled ? 'On' : 'Off', settings.ttsEnabled]
        ]),
        `${toggleSetting('Protect formatting', 'Preserve Markdown, LaTeX, links, citations, placeholders, and code.', 'rewrite.preserveFormatting', settings.preserveFormatting, formattingInactiveReason)}
        ${toggleSetting('Explain important edits', 'Ask the selected language model for one concise change note per rewrite variant.', 'rewrite.includeChangeNotes', settings.includeChangeNotes)}
        ${toggleSetting('Show Read Aloud controls', 'Use the shared Read Aloud source, voice, speed, and volume configured below for every rewrite variant.', 'rewrite.tts.enabled', settings.ttsEnabled)}`,
        activeRewriteSettingsGroup
      )}
      ${toggleSetting('Copy result to clipboard', 'Minimal or Full Rewrite only: copies the result to the clipboard and leaves this panel as is.', 'rewrite.copyToClipboard', settings.rewriteCopyToClipboard)}
    </details>
    <details class="settings-group" data-settings-section="readAloud" data-persist-id="settings-readAloud" open>
      <summary><h3>Read Aloud</h3></summary>
      ${selectSetting('Speech source', 'Local is private and offline. Edge Online and Chirp 3 HD sound natural but send the cleaned text to Microsoft or Google.', 'readAloud.provider', settings.readAloudProvider, [
        ['edgeOnline', 'Microsoft Edge Online'], ['googleChirp', 'Google Cloud Chirp 3 HD'], ['windowsLocal', 'Local Windows (offline)']
      ])}${credentialSettingNote(settings, 'readAloud.provider', settings.readAloudProvider)}
      <div class="conditional-group" data-provider-for="readAloud.provider" data-provider-value="windowsLocal">
        ${nativeVoiceSetting(settings.readAloudVoice, settings.readAloudVoices)}
        ${selectSetting('Reading rate', 'Windows speech rate. Zero is the normal voice rate.', 'readAloud.rate', String(settings.readAloudRate), [
          ['-4', '-4 (slower)'], ['-2', '-2'], ['0', '0 (normal)'], ['2', '+2'], ['4', '+4 (faster)']
        ])}
        <p class="model-note">Offline: selected text remains on this PC and is passed to Windows System.Speech only.</p>
      </div>
      <div class="conditional-group" data-provider-for="readAloud.provider" data-provider-value="edgeOnline">
        ${edgeVoiceSetting(settings.edgeReadAloudLocale, settings.edgeReadAloudVoice)}
        ${selectSetting('Edge reading speed', 'Zero percent is the natural voice speed.', 'readAloud.edgeRatePercent', String(settings.edgeReadAloudRatePercent), [
          ['-25', '-25% slower'], ['-10', '-10% slower'], ['0', '0% (normal)'], ['10', '+10% faster'], ['25', '+25% faster']
        ])}
        ${textSetting('Python command', 'Python interpreter containing edge-tts. The default works after: python -m pip install edge-tts', 'readAloud.edgePythonCommand', settings.edgeReadAloudPythonCommand)}
        <p class="model-note">Edge TTS: only KREN\'s cleaned speech copy goes to Microsoft via the unofficial edge-tts package. Audio plays from a temporary MP3, then is deleted.</p>
      </div>
      <div class="conditional-group" data-provider-for="readAloud.provider" data-provider-value="googleChirp">
        ${selectSetting('Language/Region', 'Auto-detect uses a KREN result\'s language when it is clearly known, otherwise your preferred locale.', 'readAloud.edgeLocale', settings.edgeReadAloudLocale, [
          [EDGE_SPEECH_AUTO_LOCALE, 'Auto-detect'], ...EDGE_SPEECH_LOCALES.map((entry): [string, string] => [entry.id, entry.label])
        ])}
        ${selectSetting('Chirp voice', 'Read Aloud voice, independent of the tutor voice. Availability depends on Language/Region.', 'readAloud.chirpVoice', normalizedReadAloudChirpVoice(settings.readAloudChirpVoice), READ_ALOUD_CHIRP_VOICES.map(([voice, gender]) => [voice, `${voice} (${gender})`]))}
        ${selectSetting('Reading speed', 'Zero percent maps to the natural speaking rate, 1.0. The rate is limited to 0.25 through 2.0.', 'readAloud.edgeRatePercent', String(settings.edgeReadAloudRatePercent), [
          ['-25', '-25% slower'], ['-10', '-10% slower'], ['0', '0% (normal)'], ['10', '+10% faster'], ['25', '+25% faster']
        ])}
        <p class="model-note">Chirp 3 HD: only KREN\'s cleaned speech copy goes to Google Cloud Text-to-Speech with your key. Audio plays here and isn\'t stored.</p>
      </div>
      ${selectSetting('Volume', 'Local and Google Cloud Chirp 3 HD playback volume or Edge synthesis volume.', 'readAloud.volume', String(settings.readAloudVolume), [
        ['25', '25%'], ['50', '50%'], ['75', '75%'], ['100', '100%']
      ])}
      <div class="settings-buttons">${readAloudIconButton('runCommand', 'data-action="kren.previewReadAloud"', 'voice preview')}${stopSpeechIconButton('runCommand', 'data-action="kren.stopReadAloud"')}</div>
      <p class="settings-intro">The editor command strips Markdown and citation markers from a temporary copy; the document is never changed.</p>
    </details>
    <details class="settings-group" data-settings-section="dictionary" data-persist-id="settings-dictionary" open>
      <summary><h3>Dictionary</h3></summary>
      <p class="settings-intro"><strong>Merriam-Webster keys:</strong> Collegiate Dictionary, Collegiate Thesaurus, and Medical Dictionary are supported. Each account gets two keys; remove one to choose another. No shared keys; provider terms apply.</p>
      ${toggleSetting('Translate unmatched phrases', 'If Merriam-Webster has no multi-word entry, use Google Cloud Translation.', 'dictionary.multiWordTranslationFallback', settings.multiWordTranslationFallback)}
      ${toggleSetting('Windows background pronunciation', 'On local Windows, plays Merriam-Webster audio in the background; falls back to the KREN player.', 'pronunciation.windowsNativePlayback', settings.windowsNativePronunciation)}
    </details>
    <details class="settings-group" data-settings-section="userDictionary" data-persist-id="settings-userDictionary" open>
      <summary><h3>User Dictionary</h3></summary>
      <p class="settings-intro">KREN sends the selected expression and its fixed instruction, plus the surrounding sentence when Smart Word Capture is on. Nothing is stored until you review and save.</p>
      ${toggleSetting('Enable User Dictionary', 'Makes Add to User Dictionary and Open User Dictionary available.', 'userDictionary.enabled', settings.userDictionaryEnabled)}
      ${toggleSetting('Smart Word Capture', 'Sends the sentence so the model picks the meaning used there; the entry keeps all meanings.', 'userDictionary.smartWordCapture', settings.userDictionarySmartWordCapture, settings.userDictionaryEnabled ? undefined : 'Needs User Dictionary. Off: no model runs.')}
      ${selectSetting('Default capture mode', 'The combined mode runs a live Merriam-Webster lookup and an independent language-model generation.', 'userDictionary.defaultCaptureMode', settings.userDictionaryCaptureMode, userDictionaryCaptureModeOptions().map(([id, label]) => [id, label, id === 'merriamWebsterAndLlm' && !hasSelectedUserDictionaryMerriamWebsterKey(settings)]))}
      ${!hasSelectedUserDictionaryMerriamWebsterKey(settings) ? '<div class="model-note dictionary-key-note"><span class="dictionary-key-description">Merriam-Webster + LLM is unavailable until the Collegiate key is set. The mode remains visible and KREN will not select it for you.</span><div class="settings-buttons"><button class="secondary" data-command="runCommand" data-action="kren.setMerriamWebsterCollegiateApiKey">Set key</button></div></div>' : ''}
      ${toggleSetting('Fall back after a genuine no-match', 'Shows the LLM-only draft only when Merriam-Webster finds no match. Errors and outages never trigger it.', 'userDictionary.fallbackOnMerriamWebsterNoMatch', settings.userDictionaryFallbackOnMerriamWebsterNoMatch)}
      ${llmRoutingGroup(
        'userDictionary',
        routingSettingsSummary({
          provider: settings.userDictionaryProvider,
          model: settings.userDictionaryModel,
          alternateModel: settings.userDictionaryAlternateModel,
          thinkingOrEffort: settings.userDictionaryThinkingOrEffort,
          geminiProfile: settings.userDictionaryProfile,
          fallbackEnabled: settings.userDictionaryFallbackEnabled,
          fallbackModel: settings.userDictionaryFallbackModel,
          fallbackThinkingOrEffort: settings.userDictionaryFallbackThinkingOrEffort
        }),
        `${providerSettings('userDictionary', {
          provider: settings.userDictionaryProvider,
          model: settings.userDictionaryModel,
          alternateModel: settings.userDictionaryAlternateModel,
          thinkingOrEffort: settings.userDictionaryThinkingOrEffort,
          geminiProfile: settings.userDictionaryProfile,
          fallbackEnabled: settings.userDictionaryFallbackEnabled,
          fallbackModel: settings.userDictionaryFallbackModel,
          fallbackThinkingOrEffort: settings.userDictionaryFallbackThinkingOrEffort
        }, settings, proModels, openAIModels, anthropicModels)}
        <p class="model-note">User Dictionary and Grammar Check share this model profile; changes in either apply to both.</p>`
      )}
      ${textSetting('Entry language', 'Use auto, or a BCP-47 language tag such as en, ko, or en-US.', 'userDictionary.entryLanguage', settings.userDictionaryEntryLanguage)}
      ${toggleSetting('Include pronunciation when appropriate', 'Adds a pronunciation field when the model can supply one responsibly.', 'userDictionary.includePronunciation', settings.userDictionaryIncludePronunciation)}
      ${toggleSetting('Include synonyms and related expressions', 'Adds synonyms, antonyms, and related expressions.', 'userDictionary.includeSynonyms', settings.userDictionaryIncludeSynonyms)}
      ${toggleSetting('Include usage notes', 'Adds a usage note only when it prevents misunderstanding.', 'userDictionary.includeUsageNotes', settings.userDictionaryIncludeUsageNotes)}
      ${selectSetting('Number of examples', 'Maximum examples retained for each sense.', 'userDictionary.numberOfExamples', String(settings.userDictionaryNumberOfExamples), userDictionaryExampleCountOptions().map(([id, label]) => [String(id), label]))}
      ${toggleSetting('Include technical meanings when applicable', 'Allows established technical senses when genuinely relevant.', 'userDictionary.includeTechnicalMeanings', settings.userDictionaryIncludeTechnicalMeanings)}
      <h4>Storage</h4>
      <p class="settings-intro"><strong>Entries:</strong> ${settings.userDictionaryEntryCount ?? 'Open User Dictionary to load the count'}<br><strong>Location:</strong> <code>${escapeHtml(settings.userDictionaryStoragePath ?? 'Unavailable')}</code></p>
      ${numberSetting('Maximum entries per import', 'The most entries one import file may hold. Larger files are refused with their entry count.', 'userDictionary.maxImportEntries', settings.userDictionaryMaxImportEntries, 1, 100000)}
      <p class="model-note">If the store is corrupt, KREN stops and keeps <code>entries.json</code> above. Copy it, fix it as a valid version 1 JSON backup, then Import it. JSON is lossless; Markdown is lossy.</p>
      <div class="settings-buttons"><button class="secondary" data-command="exportUserDictionary" data-export-format="json" data-selected-only="false">Export JSON</button><button class="secondary" data-command="exportUserDictionary" data-export-format="markdown" data-selected-only="false">Export Markdown</button><button class="secondary" data-command="previewUserDictionaryImport">Import</button></div>
      <h4>Purge</h4>
      <label class="setting"><span><span class="setting-title">Entries to purge</span><span class="setting-description">Age is based on updatedAt. Viewing an entry never refreshes it.</span></span><select data-purge-selection>${userDictionaryPurgeSelectionOptions().map(([id, label]) => `<option value="${escapeHtml(id)}"${id === 'olderThan3Months' ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label>
      <div class="settings-buttons"><button class="secondary" data-command="previewUserDictionaryPurge">Preview purge</button></div>
    </details>
    <details class="settings-group" data-settings-section="display" data-persist-id="settings-display" open>
      <summary><h3>Display</h3></summary>
      ${selectSetting('Panel theme', 'Use a fixed light or dark view, or follow VS Code. The header switch remembers your choice.', 'display.panelTheme', settings.panelTheme ?? 'followVSCode', [
        ['followVSCode', 'Follow VS Code'], ['light', 'Light'], ['dark', 'Dark']
      ])}
    </details>
    <details class="settings-group" data-settings-section="usage" data-persist-id="settings-usage" open>
      <summary><h3>Usage</h3></summary>
      <div data-provider-switch-settings>${renderProviderSwitchSettings(settings)}</div>
      ${selectSetting('Immediate result', 'Where Dictionary, Synonyms, Translation, and Explain results appear. Rewrite Text and Grammar Check always open here.', 'display.mode', settings.displayMode, [
        ['hover', 'Hover over the selection'],
        ['quickPick', 'Quick pick list'],
        ['details', 'Open this panel']
      ])}
      ${secondsSetting('Request timeout', 'How long KREN waits for a provider. Cloudflare pictures wait at least 60 seconds; Google Cloud speech ignores this.', 'request.timeoutMs', settings.requestTimeoutMs, 1000, 120000)}
      <section aria-labelledby="global-routing-heading" data-global-routing data-llm-routing="global">
        <h4 id="global-routing-heading">Global LLM setting</h4>
        <p class="model-note">Saved separately. Apply to All previews changes and skipped features before you confirm. Missing keys can be added in Credentials.</p>
        ${providerSettings('global', settings.globalRouting ?? GLOBAL_ROUTING_DEFAULTS, settings, proModels, openAIModels, anthropicModels)}
      </section>
      <div class="settings-buttons credentials-actions">
        <button class="secondary" data-command="runCommand" data-action="kren.applyGlobalRouting">Apply to All</button>
        <button class="secondary" data-command="runCommand" data-action="kren.restoreDefaultSettings">Default Setting</button>
        <button class="secondary" data-command="runCommand" data-action="kren.resetKren">Reset KREN</button>
      </div>
    </details>`;
}

export function renderProviderSwitchSettings(settings: KrenPanelSettings): string {
  const providerOrder = validProviderOrder(settings.llmProviderOrder) ? settings.llmProviderOrder : [...DEFAULT_PROVIDER_ORDER];
  return `${toggleSetting('When a free limit runs out', 'Switch to the next provider', 'llm.providerSwitch', settings.llmProviderSwitch ?? true)}
      <ol class="provider-switch-order" data-provider-order>${providerOrder.map((provider, index, order) => `<li data-provider="${provider}"><span>${escapeHtml(languageModelRoutingProviderLabel(provider))}</span><button type="button" class="secondary icon-button" data-provider-move="-1" aria-label="Move ${provider} up" title="Move up"${index === 0 ? ' disabled' : ''}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 7l6 9H6z" fill="currentColor" stroke="none"></path></svg></button><button type="button" class="secondary icon-button" data-provider-move="1" aria-label="Move ${provider} down" title="Move down"${index === order.length - 1 ? ' disabled' : ''}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 17l-6-9h12z" fill="currentColor" stroke="none"></path></svg></button></li>`).join('')}</ol>
      <p class="model-note">Only providers with stored credentials take part.</p>`;
}

export function renderLanguageModelUsage(rows: readonly LanguageModelUsage[]): string {
  return `<h3 id="language-model-usage-heading">Requests today</h3>${rows.length
    ? `<ul>${rows.map(row => `<li><strong>${row.provider === 'gemini' ? `Gemini ${row.geminiProfile === 'pro' ? 'Paid' : 'Free Tier'}` : escapeHtml(row.provider)} ${escapeHtml(row.model)}</strong>${isLanguageModelRoutingProvider(row.provider) && (row.provider !== 'gemini' || row.geminiProfile !== undefined) && isQuotaPoolExhaustedToday({ provider: row.provider, model: row.model, geminiProfile: row.geminiProfile ?? 'standard' }) ? ' <span>limit reached</span>' : ''}<p>Requests: ${row.requests}; ${row.provider === 'google-tts' ? `characters: ${row.characters ?? 0}.` : `input tokens: ${row.input}; output tokens: ${row.output}; thinking tokens: ${row.thinking}.`}</p></li>`).join('')}</ul>`
    : '<p>No language-model requests today.</p>'}<p class="model-note">Limits are shown in each provider's console.</p>`;
}

function renderCredentials(settings: KrenPanelSettings, brandImageUri: string | undefined, hasHeldResult: boolean, openHelp?: CredentialHelpId): string {
  const merriamWebsterKeyCount = [
    settings.credentialPresence?.merriamWebsterCollegiate,
    settings.credentialPresence?.merriamWebsterMedical,
    settings.credentialPresence?.merriamWebsterThesaurus
  ].filter(Boolean).length;
  // Compared against MERRIAM_WEBSTER_KEY_LIMIT, not a literal. This once held a literal
  // of its own, so the sentence the panel printed came from the constant while the
  // disabled state came from the literal, and the two disagreed in the same row. One
  // rule, two copies, which is the defect this codebase keeps producing: the visible
  // half and the enforcing half drifted apart. The number lives in the constant only,
  // which is also what keeps it out of source that is shared between channels.
  const merriamWebsterLimitReason = merriamWebsterKeyCount >= MERRIAM_WEBSTER_KEY_LIMIT
    ? MERRIAM_WEBSTER_KEY_LIMIT_MESSAGE
    : undefined;
  return `${renderHeader('', false, brandImageUri, false, hasHeldResult)}
    <h2>KREN Credentials</h2>
      <p class="settings-intro">Secret Storage encrypts keys for this profile. Remove them here before uninstalling or retiring a test profile.</p>
      <p class="model-note">Google AI Studio keys aren\'t offered everywhere. Access, pricing, and data use vary by project and region for all providers. Gemini serves Translation, Grammar Check, Explain, Rewrite, and User Dictionary.</p>
      ${credentialRow('cloudflareAccountId', openHelp, 'kren.setCloudflareAccountId', 'kren.deleteCloudflareAccountId', Boolean(settings.credentialPresence?.cloudflareAccountId), 'kren.testCloudflareConnection', 'Test', true)}
      ${credentialRow('cloudflareApiToken', openHelp, 'kren.setCloudflareApiToken', 'kren.deleteCloudflareApiToken', Boolean(settings.credentialPresence?.cloudflareApiToken), 'kren.testCloudflareConnection', 'Test', true)}
      ${credentialRow('geminiDefault', openHelp, 'kren.setGeminiApiKey', 'kren.deleteGeminiApiKey', Boolean(settings.credentialPresence?.geminiDefault), 'kren.testGeminiConnection', 'Test', true)}
      ${credentialRow('geminiAlternate', openHelp, 'kren.setGeminiProApiKey', 'kren.deleteGeminiProApiKey', Boolean(settings.credentialPresence?.geminiAlternate), 'kren.testGeminiProConnection', 'Test', true)}
      ${credentialRow('googleCloudTextToSpeech', openHelp, 'kren.setGoogleCloudTextToSpeechApiKey', 'kren.deleteGoogleCloudTextToSpeechApiKey', Boolean(settings.credentialPresence?.googleCloudTextToSpeech), 'kren.testGoogleCloudTextToSpeech', 'Test', !settings.credentialPresence?.googleCloudTranslation)}
      ${!settings.credentialPresence?.googleCloudTextToSpeech && settings.credentialPresence?.googleCloudTranslation ? '<p class="model-note">Using the Cloud Translation key.</p>' : ''}
      ${credentialRow('googleCloudTranslation', openHelp, 'kren.setGoogleCloudTranslationApiKey', 'kren.deleteGoogleCloudTranslationApiKey', Boolean(settings.credentialPresence?.googleCloudTranslation), 'kren.testGoogleCloudTranslation', 'Test', true)}
      ${credentialRow('openai', openHelp, 'kren.setOpenAIApiKey', 'kren.deleteOpenAIApiKey', Boolean(settings.credentialPresence?.openai), 'kren.testOpenAIConnection', 'Test', true)}
      ${credentialRow('groq', openHelp, 'kren.setGroqApiKey', 'kren.deleteGroqApiKey', Boolean(settings.credentialPresence?.groq), 'kren.testGroqConnection', 'Test', true)}
      ${credentialRow('anthropic', openHelp, 'kren.setAnthropicApiKey', 'kren.deleteAnthropicApiKey', Boolean(settings.credentialPresence?.anthropic), 'kren.testAnthropicConnection', 'Test', true)}
      ${credentialRow('merriamWebsterCollegiate', openHelp, 'kren.setMerriamWebsterCollegiateApiKey', 'kren.deleteMerriamWebsterCollegiateApiKey', Boolean(settings.credentialPresence?.merriamWebsterCollegiate), 'kren.testMerriamWebsterCollegiate', 'Test', true, merriamWebsterLimitReason)}
      ${credentialRow('merriamWebsterThesaurus', openHelp, 'kren.setMerriamWebsterThesaurusApiKey', 'kren.deleteMerriamWebsterThesaurusApiKey', Boolean(settings.credentialPresence?.merriamWebsterThesaurus), 'kren.testMerriamWebsterThesaurus', 'Test', true, merriamWebsterLimitReason)}
      ${credentialRow('merriamWebsterMedical', openHelp, 'kren.setMerriamWebsterMedicalApiKey', 'kren.deleteMerriamWebsterMedicalApiKey', Boolean(settings.credentialPresence?.merriamWebsterMedical), 'kren.testMerriamWebsterMedical', 'Test', true, merriamWebsterLimitReason)}
      ${credentialRow('koreanDictionary', openHelp, 'kren.setKoreanDictionaryApiKey', 'kren.deleteKoreanDictionaryApiKey', Boolean(settings.credentialPresence?.koreanDictionary), 'kren.testKoreanDictionary', 'Test', true)}
      <div class="settings-buttons credentials-actions">
        <button class="secondary" data-command="runCommand" data-action="kren.deleteAllApiKeys"${!Object.values(settings.credentialPresence ?? {}).some(Boolean) ? ' disabled' : ''}>Delete all API keys</button>
      </div>
      <section data-language-model-usage aria-labelledby="language-model-usage-heading" tabindex="0">${renderLanguageModelUsage(settings.languageModelUsageToday ?? [])}</section>`;
}

function renderTutor(
  suppliedState: TutorViewState | undefined,
  settings: KrenPanelSettings,
  brandImageUri: string | undefined,
  hasHeldResult: boolean,
  proModels: GeminiModelOption[],
  liveModels: GeminiModelOption[],
  openAIModels: GeminiModelOption[],
  anthropicModels: GeminiModelOption[],
  speechProvider: TutorSpeechProvider,
  tutorLiveReplayAvailable: boolean,
  tutorLiveTalkAvailable: boolean,
  tutorLiveTalkListening: boolean,
  tutorLivePressToTalk: boolean,
  tutorConversationReplayAvailable: boolean,
  tutorConversationHintTurnGeneration: number | undefined,
  tutorConversationScene: string | undefined,
  tutorConversationPicture: string | string[] | undefined,
  tutorConversationStopDisabled: boolean | undefined,
  tutorConversationStopTitle: string | undefined,
  tutorConversationPictureTurns: number[] | undefined,
  tutorLiveFailed: boolean
): string {
  const state = suppliedState ?? createTutorViewState();
  const readiness = tutorSelectionReadiness(state);
  const compatibility = assessTutorCompatibility(state.selection);
  const primary = state.selection.find((target) => target.role === 'primary');
  const supports = state.selection.filter((target) => target.role === 'support');
  const primaryLabel = primary ? findTrainingMapNode(primary.nodeId)?.label ?? primary.nodeId : 'None';
  const mapSummary = state.settings.questionOnly
    ? 'Learning map optional | Lesson follows the question'
    : `Primary: ${primaryLabel} | Support: ${supports.length}`;
  const band = tutorSentenceBand(state.settings.sentenceBand);
  const lessonSummary = `${state.settings.exampleCount} examples | ${band.minimumWords}-${band.maximumWords} words | ${tutorValueLabel(state.settings.learnerLevel)} | ${tutorValueLabel(state.settings.lessonMode)}`;
  const routing = {
    provider: settings.tutorProvider,
    model: settings.tutorModel,
    alternateModel: settings.tutorAlternateModel,
    thinkingOrEffort: settings.tutorThinkingOrEffort,
    geminiProfile: settings.tutorProfile,
    fallbackEnabled: settings.tutorFallbackEnabled,
    fallbackModel: settings.tutorHintModel ?? TUTOR_DEFAULTS.configuration['tutor.hintModel'],
    fallbackThinkingOrEffort: settings.tutorHintThinkingOrEffort ?? 'auto'
  };
  const tutorLiveModel = settings.tutorLiveModel ?? TUTOR_LIVE_MODEL_DEFAULT;
  const storedHintModel = settings.tutorHintModel ?? '';
  const tutorHintModel = storedHintModel ? tutorFastModel(routing.provider, storedHintModel, routing.model) : '';
  const tutorLiveModels = [
    ...KNOWN_TUTOR_LIVE_MODEL_IDS.map((id) => ({ id, displayName: id })),
    ...liveModels.filter((model) => !KNOWN_TUTOR_LIVE_MODEL_IDS.some((id) => id === model.id))
  ];
  const customTutorLiveModels = settings.customTutorLiveModels ?? [];
  const hintModels = routing.provider === 'openai' ? openAIModels
    : routing.provider === 'anthropic' ? anthropicModels
      : routing.provider === 'groq' ? settings.groqModels ?? GROQ_MODELS.map(id => ({ id, displayName: id }))
        : routing.provider === 'cloudflare' ? CLOUDFLARE_TEXT_MODELS.map(id => ({ id, displayName: id })) : proModels;
  const customHintModels = routing.provider === 'openai' ? settings.customOpenAIModels ?? []
    : routing.provider === 'anthropic' ? settings.customAnthropicModels ?? []
      : routing.provider === 'groq' ? settings.customGroqModels ?? []
        : routing.provider === 'cloudflare' ? settings.customCloudflareModels ?? []
      : settings.customGeminiModels ?? [];
  const settingSummary = [
    routing.provider === 'gemini' && routing.geminiProfile === 'pro' ? routing.alternateModel : routing.model,
    ...(routing.fallbackEnabled ? [routing.fallbackModel] : []),
    tutorLiveModel,
    settings.tutorPictureProvider === 'cloudflare'
      ? `Cloudflare ${CLOUDFLARE_IMAGE_MODELS.find(([id]) => id === settings.tutorCloudflareImageModel)?.[1] ?? 'FLUX.2 klein 4B'}`
      : settings.tutorImageModel ?? TUTOR_DEFAULTS.configuration['tutor.imageModel'],
    tutorReadAloudSettingsSummary(settings),
    tutorGeminiVoiceSummary(settings, state.conversation.liveVoice)
  ].join(' | ');
  const tutorVoiceSummary = tutorReadAloudSummary(settings, state.conversation.liveVoice);
  const lessonFields = `${renderTutorLessonSettings(state)}${renderTutorAxisGroups(state)}`;
  const settingFields = `${selectSetting('Speech provider', 'Speech-to-text provider for practice answers and Standard conversation.', 'tutor.speechProvider', speechProvider, [['auto', 'Auto'], ['handy', 'Handy'], ['cloudflare', 'Cloudflare'], ['groq', 'Groq'], ['gemini', 'Gemini'], ['off', 'Off']])}${credentialSettingNote(settings, 'tutor.speechProvider', speechProvider)}${tutorFoldable(
    'voice',
    'TUTOR VOICE',
    tutorVoiceSummary,
    tutorReadAloudSettings(settings, state.conversation.liveVoice, state.conversation.replies === 'liveGemini'),
    false,
    'child'
  )}${llmRoutingGroup(
    'tutor',
    `${settingsSummary([
      ['Provider', languageModelRoutingProviderLabel(routing.provider), false],
      ...(routing.provider === 'gemini' ? [
        ['Gemini Profile', routing.geminiProfile === 'pro' ? 'Paid' : 'Free Tier', false] as [string, string, boolean]
      ] : []),
      ['Thorough model', routing.provider === 'gemini' && routing.geminiProfile === 'pro' ? routing.alternateModel : routing.model, false],
      ['Thinking Level', languageModelRoutingEffortLabel(routing.thinkingOrEffort), false],
      [TUTOR_LLM_ROUTING_CONTROL_TITLES.fallbackEnabled, routing.fallbackEnabled ? 'On' : 'Off', !routing.fallbackEnabled]
    ])} | Fast model: ${tutorHintModel || 'Thorough model'} | Fast thinking: ${languageModelRoutingEffortLabel(settings.tutorHintThinkingOrEffort ?? 'auto')} | Live Model: ${tutorLiveModel}`,
    `${providerSettings(
      'tutor', routing, settings, proModels, openAIModels, anthropicModels, false, liveModels
    )}${modelSetting(
      'Fast model',
      'Routine, frequent steps: hints, conversation replies, Ask. KREN moves a step to the Thorough model when a fast answer fails its checks.',
      'tutor.hintModel',
      tutorHintModel,
      hintModels,
      customHintModels,
      routing.provider,
      undefined,
      liveModels
    )}${selectSetting(
      'Fast thinking level', 'Auto uses the model\'s lowest supported level for Fast steps and fallback.',
      'tutor.hintThinkingOrEffort', settings.tutorHintThinkingOrEffort ?? 'auto', languageModelRoutingEffortOptions()
    )}${selectSetting(
      'Live Gemini Profile', 'Free Tier and Paid use their separately stored Gemini credentials.',
      'tutor.liveGeminiProfile', settings.tutorLiveProfile ?? 'standard', [['standard', 'Free Tier'], ['pro', 'Paid']]
    )}${credentialSettingNote(settings, 'tutor.liveGeminiProfile', 'gemini', settings.tutorLiveProfile ?? 'standard', 'tutor.liveGeminiProfile')}${modelSetting(
      'Live Model',
      'The Gemini Live API needs a live model for streaming conversation replies.',
      'tutor.liveModel',
      tutorLiveModel,
      tutorLiveModels,
      customTutorLiveModels,
      'geminiLive',
      'refreshGeminiLiveModels'
    )}${selectSetting('Picture Provider', 'Provider used for situation pictures.', 'tutor.pictureProvider', settings.tutorPictureProvider ?? 'gemini', [
      ['gemini', 'Gemini Paid profile'],
      ['cloudflare', 'Cloudflare free models']
    ])}${settings.tutorPictureProviderAutomatic ? `<p class="model-note" data-picture-provider-automatic>${settings.tutorPictureProvider === 'cloudflare' ? 'Chosen automatically: Cloudflare (both Cloudflare keys are stored).' : 'Chosen automatically: Gemini Paid.'}</p>` : ''}${credentialSettingNote(settings, 'tutor.pictureProvider', settings.tutorPictureProvider ?? 'gemini', 'pro')}${settings.tutorPictureProvider === 'cloudflare' ? selectSetting(
      'Image Model', "Cloudflare model used for situation pictures. Both draw on the account's free daily allowance. FLUX.2 klein 4B takes about 25 seconds a picture.",
      'tutor.cloudflareImageModel', settings.tutorCloudflareImageModel ?? CLOUDFLARE_IMAGE_MODEL_DEFAULT, CLOUDFLARE_IMAGE_MODELS
    ) : modelSetting(
      'Image Model', 'Gemini model used for situation pictures with the Gemini Paid profile\'s key. With Gemini chosen, situation pictures need a Gemini Paid API key with billing enabled; the default image model costs about US$0.03 per picture and a conversation makes at most 10.', 'tutor.imageModel',
      settings.tutorImageModel ?? TUTOR_DEFAULTS.configuration['tutor.imageModel'],
      settings.tutorImageModels ?? [{ id: TUTOR_DEFAULTS.configuration['tutor.imageModel'], displayName: TUTOR_DEFAULTS.configuration['tutor.imageModel'] }],
      settings.customTutorImageModels ?? [], 'geminiImage', 'refreshGeminiImageModels'
    )}`,
    undefined,
    true
  )}`;
  const actions = renderTutorActions(state);
  const prompt = state.preparedPrompt ??
    (state.questionPrepared ? tutorPreparedPrompt(state) : undefined);

  return `${renderHeader('<span>AI English Tutor</span>', false, brandImageUri, false, hasHeldResult)}
  <div class="tutor-content">
  <div class="tutor-heading-row" data-tutor-heading-row><div class="tutor-heading-title"><h1 id="tutor-page-heading">AI English Tutor</h1>${iconButton(undefined, 'data-tutor-jump-configuration', 'Lesson and Setting', 'Go to the Lesson and Setting panels', 'settings', false, false, 'icon-button tutor-configuration-jump')}</div>${renderTutorMasterReset(state)}</div>
  ${actions.statusRegion}
  ${state.diagnosticReportMessage ? `<p class="tutor-action-status" role="status">${escapeHtml(state.diagnosticReportMessage)}</p>` : ''}
  <div class="tutor-page">
    <div class="tutor-map-recipe">
    ${tutorFoldable('map', 'LEARNING MAP', mapSummary, renderTutorMap(state, compatibility.status), Boolean(state.diagnosticReport) || !hasTutorOutput(state))}
    ${tutorFoldable('recipe', 'REVIEW RECIPE', readiness.summary, renderTutorRecipe(state))}
    </div>
    <section class="tutor-lesson-section" aria-labelledby="tutor-lesson-heading"${state.lesson ? ' data-tutor-lesson-drafted' : ''}>
      <h2 id="tutor-lesson-heading">LESSON</h2>
      <p class="tutor-lesson-introduction">Draft a short lesson on the targets you selected, with worked examples and practice.</p>
      ${tutorFoldable('lesson', 'LESSON SETTING', lessonSummary, lessonFields)}
      ${state.lesson ? '' : '<p class="tutor-lesson-instruction">Check your lesson settings, then draft the lesson.</p>'}
      ${actions.buttons}
      ${renderTutorLessonOutput(state, actions.exerciseAction)}
    </section>
    ${renderTutorExercises(
      state,
      speechProvider,
      Boolean(settings.credentialPresence?.geminiDefault),
      Boolean(settings.credentialPresence?.cloudflareAccountId && settings.credentialPresence?.cloudflareApiToken),
      Boolean(settings.credentialPresence?.groq)
    )}
    ${renderTutorConversation(
      state,
      speechProvider,
      Boolean(settings.credentialPresence?.geminiDefault),
      tutorLiveReplayAvailable,
      tutorLiveTalkAvailable,
      tutorLiveTalkListening,
      tutorLivePressToTalk,
      tutorConversationReplayAvailable,
      tutorConversationHintTurnGeneration,
      settings.tutorConversationMicrophoneSensitivity ?? TUTOR_DEFAULTS.configuration['tutor.conversation.microphoneSensitivity'],
      settings.tutorConversationPressToTalk ?? TUTOR_DEFAULTS.configuration['tutor.conversation.pressToTalk'],
      settings.tutorConversationMicrophoneCloseWait ?? TUTOR_DEFAULTS.configuration['tutor.conversation.microphoneCloseWait'],
      tutorConversationScene,
      tutorConversationPicture,
      state.conversation.replies === 'liveGemini' || tutorDemoAvailable(state.conversation.replies, settings),
      tutorConversationStopDisabled,
      tutorConversationStopTitle,
      tutorConversationPictureTurns,
      settings.tutorConversationPauseBeforeReply,
      settings.tutorConversationSpeechDetection,
      settings.tutorConversationLiveTranscriptionLanguage,
      Boolean(settings.credentialPresence?.cloudflareAccountId && settings.credentialPresence?.cloudflareApiToken),
      settings.tutorConversationTakeHome ?? TUTOR_DEFAULTS.configuration['tutor.conversation.takeHome'],
      settings.tutorConversationPictureStyle ?? TUTOR_DEFAULTS.configuration['tutor.conversation.pictureStyle'],
      Boolean(settings.credentialPresence?.groq),
      settings.tutorConversationHintPrefetch ?? TUTOR_DEFAULTS.configuration['tutor.conversation.hintPrefetch'],
      tutorLiveFailed,
      settings.tutorReadAloudProvider === 'googleChirp' ? 'Set the Google Cloud Text-to-Speech key or Cloud Translation key to run Demo.' : settings.tutorLiveProfile === 'pro' ? 'Set the Gemini Paid key to run Demo.' : 'Set the Gemini Free Tier key to run Demo.'
    )}
    <div class="tutor-configuration" data-tutor-configuration>
    ${tutorFoldable('setting', 'VOICE & MODEL', settingSummary, settingFields)}
    </div>
  </div>
  ${renderTutorPreparedPromptDrawer(state, prompt)}
  ${renderTutorDiagnosticReportDrawer(state)}
  ${renderTutorToolDrawer(state, settings.translationTargetLanguage)}
  </div>`;
}

function renderTutorDiagnosticReportDrawer(state: TutorViewState): string {
  const report = state.diagnosticReport;
  if (!state.diagnosticReportDrawerOpen || !report) return '';
  const findingLabels: Record<number, string> = {
    1: 'Blocks meaning',
    2: 'Incorrect but understandable'
  };
  const findings = report.findings.map((finding) => {
    const label = finding.targetId ? findTrainingMapNode(finding.targetId)?.label : undefined;
    return `<li><p>${escapeHtml(finding.observation)}</p><ul class="tutor-report-details"><li><strong>Evidence from your words:</strong> <q>${escapeHtml(finding.evidence)}</q> (${findingLabels[finding.level] ?? ''}${finding.turnCount === undefined ? '' : `; appeared in ${finding.turnCount} ${state.diagnosticReportSource?.kind === 'practice' ? 'item' : 'turn'}${finding.turnCount === 1 ? '' : 's'}`})</li>${finding.correction ? `<li><strong>Correction:</strong> ${escapeHtml(finding.correction)}</li>` : ''}${label ? `<li><strong>Target:</strong> ${escapeHtml(label)}</li>` : ''}</ul></li>`;
  }).join('');
  const polish = (report.polish ?? []).map((suggestion) => {
    const label = suggestion.targetId ? findTrainingMapNode(suggestion.targetId)?.label : undefined;
    return `<li><p><strong>Evidence from your words:</strong> <q>${escapeHtml(suggestion.evidence)}</q></p><ul class="tutor-report-details"><li><strong>Suggestion:</strong> ${escapeHtml(suggestion.suggestion)}</li><li><strong>Why:</strong> ${escapeHtml(suggestion.reason)}</li>${label ? `<li><strong>Target:</strong> ${escapeHtml(label)}</li>` : ''}</ul></li>`;
  }).join('');
  const source = state.diagnosticReportSource;
  const sourceLabel = source?.kind === 'conversation'
    ? `Source: Conversation, ${source.turnCount} completed turns.`
    : source?.kind === 'practice' ? `Source: Practice, ${source.itemCount} reviewed items.` : 'Source: Passage.';
  const targets = report.targets.map((target) =>
    `<li><strong>${target.role === 'primary' ? 'Primary' : 'Support'}:</strong> ${escapeHtml(findTrainingMapNode(target.nodeId)?.label ?? target.nodeId)}</li>`
  ).join('');
  return `<aside class="tutor-drawer tutor-diagnostic-report-drawer" tabindex="0" role="dialog" aria-modal="true" aria-label="Diagnostic report"><h2>Diagnostic Report</h2><p>${sourceLabel}</p><p>${escapeHtml(report.summary ?? 'No summary was returned.')}</p><section aria-label="Findings"><h3>Findings</h3>${findings ? `<ol>${findings}</ol>` : '<p>The analysis found nothing specific to correct.</p>'}</section>${polish ? `<section aria-label="Naturalness suggestions"><h3>Naturalness suggestions</h3><p>Your English here is already correct. These are optional ways to make it more natural.</p><ol>${polish}</ol></section>` : ''}<h3>Proposed targets</h3><p>These are proposed targets. Selected targets and your prepared prompt stay unchanged until you choose Apply. Delete asks you to confirm before discarding this report. Back to tutor keeps it so you can reopen it.</p>${targets ? `<ul class="tutor-report-targets">${targets}</ul>` : '<p>No learning-map targets were proposed.</p>'}<h3>Next lesson focus</h3><p>${escapeHtml(report.focus ?? 'No focus was returned.')}</p><div class="settings-buttons">${report.targets.length > 0 ? '<button type="button" data-command="applyTutorDiagnosticReport">Apply</button>' : ''}<button type="button" class="secondary" data-command="cancelTutorDiagnosticReport">Delete</button><button type="button" class="secondary" data-command="closeTutorDiagnosticReport">Back to tutor</button></div></aside>`;
}

function renderTutorPreparedPromptDrawer(
  state: TutorViewState,
  prompt: string | undefined
): string {
  if (!state.preparedPromptDrawerOpen || prompt === undefined) return '';
  const notice = state.preparedPromptNotice
    ? `<p class="tutor-message" role="status">${escapeHtml(state.preparedPromptNotice)}</p>`
    : '';
  return `<aside class="tutor-drawer tutor-prepared-prompt-drawer" role="dialog" aria-modal="true" aria-label="Prepared lesson prompt"><button type="button" class="secondary" data-command="closeTutorPreparedPrompt">Back to tutor</button><h2>Prepared lesson prompt</h2>${notice}<textarea class="tutor-prepared-prompt-text" data-tutor-prepared-prompt aria-label="Prepared lesson prompt text">${escapeHtml(prompt)}</textarea></aside>`;
}

/*
 * Whether the reader has a result to read, which is what folds the panels above it.
 *
 * Learning map is the only one of the four that opens by default, so it is the only one
 * that needs closing. The other three are already closed and stay that way. Nothing is
 * cleared and every panel still opens on a click, so this changes what is in front of the
 * reader and nothing about what KREN holds.
 */
function hasTutorOutput(state: TutorViewState): boolean {
  return state.lesson !== undefined || state.exerciseSet !== undefined;
}

function tutorReadAloudSettingsSummary(settings: KrenPanelSettings): string {
  const volume = `Volume: ${settings.tutorReadAloudVolume}%`;
  if (settings.tutorReadAloudProvider === 'googleChirp') return `Google Cloud Chirp 3 HD | Female: ${settings.tutorLiveFemaleVoice ?? 'Callirrhoe'} | Male: ${settings.tutorLiveMaleVoice ?? 'Enceladus'} | Speed: ${settings.tutorEdgeReadAloudRatePercent}% | ${volume}`;
  if (settings.tutorReadAloudProvider === 'windowsLocal') {
    const rates: Record<number, string> = {
      [-4]: '-4 (slower)', [-2]: '-2', 0: '0 (normal)', 2: '+2', 4: '+4 (faster)'
    };
    return `Local Windows (offline) | Speed: ${rates[settings.tutorReadAloudRate] ?? settings.tutorReadAloudRate} | ${volume}`;
  }
  const voiceName = (id: string, gender: 'female' | 'male'): string => {
    const locale = TUTOR_EDGE_SPEECH_LOCALES.find((candidate) => candidate.voices.some(
      (voice) => voice.id === id && voice.label.endsWith(`(${gender === 'female' ? 'Female' : 'Male'})`)
    ));
    const voice = locale?.voices.find((candidate) => candidate.id === id);
    return voice ? `${locale!.id}: ${voice.label}` : `${id} (stored)`;
  };
  const speeds: Record<number, string> = {
    [-25]: '-25% slower', [-10]: '-10% slower', 0: '0% (normal)', 10: '+10% faster', 25: '+25% faster'
  };
  return [
    'Microsoft Edge Online',
    `Female: ${voiceName(settings.tutorEdgeReadAloudFemaleVoice ?? TUTOR_DEFAULTS.configuration['tutor.readAloud.edgeFemaleVoice'], 'female')}`,
    `Male: ${voiceName(settings.tutorEdgeReadAloudMaleVoice ?? TUTOR_DEFAULTS.configuration['tutor.readAloud.edgeMaleVoice'], 'male')}`,
    `Speed: ${speeds[settings.tutorEdgeReadAloudRatePercent] ?? settings.tutorEdgeReadAloudRatePercent}`,
    volume
  ].join(' | ');
}

function tutorGeminiVoiceSummary(settings: KrenPanelSettings, liveVoice: string): string {
  return `Live Voice: ${tutorLiveVoiceLabel(normalizedTutorLiveVoice(liveVoice))} | Live Female: ${tutorLiveVoiceLabel(settings.tutorLiveFemaleVoice ?? TUTOR_DEFAULTS.configuration['tutor.liveFemaleVoice'])} | Live Male: ${tutorLiveVoiceLabel(settings.tutorLiveMaleVoice ?? TUTOR_DEFAULTS.configuration['tutor.liveMaleVoice'])}`;
}

function tutorReadAloudSummary(settings: KrenPanelSettings, liveVoice: string): string {
  const gemini = tutorGeminiVoiceSummary(settings, liveVoice);
  if (settings.tutorReadAloudProvider === 'googleChirp') return `${tutorReadAloudSettingsSummary(settings)} | ${gemini}`;
  if (settings.tutorReadAloudProvider === 'windowsLocal') {
    const voice = settings.tutorReadAloudVoice || 'Automatic local voice';
    return `Local Windows | ${voice} | ${settings.tutorReadAloudRate} | ${settings.tutorReadAloudVolume} | ${gemini}`;
  }
  const locale = TUTOR_EDGE_SPEECH_LOCALES.find(
    (candidate) => candidate.id === settings.tutorEdgeReadAloudLocale
  ) ?? TUTOR_EDGE_SPEECH_LOCALES[0]!;
  const voice = locale.voices.find(
    (candidate) => candidate.id === settings.tutorEdgeReadAloudVoice
  );
  const voiceLabel = voice
    ? `${voice.label.replace(/\s+\([^)]*\)$/u, '')} Natural`
    : settings.tutorEdgeReadAloudVoice;
  return `Edge Online | ${locale.id} ${voiceLabel} | ${settings.tutorEdgeReadAloudRatePercent}% | ${settings.tutorReadAloudVolume} | ${gemini}`;
}

function tutorReadAloudSettings(settings: KrenPanelSettings, liveVoice: string, live: boolean): string {
  const edgeVoices = TUTOR_EDGE_SPEECH_LOCALES.flatMap((locale) => locale.voices.map(
    (voice): [string, string] => [voice.id, `${locale.id}: ${voice.label}`]
  ));
  const edgeDefault = (
    gender: 'female' | 'male', value: string, fallback: string
  ): Array<[string, string]> => {
    const selected = value || fallback;
    const matchingVoices = edgeVoices.filter(([, label]) =>
      label.endsWith(`(${gender === 'female' ? 'Female' : 'Male'})`));
    return matchingVoices.some(([id]) => id === selected)
      ? matchingVoices
      : [[selected, `${selected} (stored)`], ...matchingVoices];
  };
  const liveDefault = (gender: 'female' | 'male', value: string): Array<[string, string]> =>
    TUTOR_LIVE_VOICES.filter(([, , candidateGender]) => candidateGender === gender)
      .map(([name]): [string, string] => [name, tutorLiveVoiceLabel(name)])
      .concat(TUTOR_LIVE_VOICES.some(([name]) => name === value)
        ? [] : [[value, `${value} (stored)`]]);
  const selectedLiveVoice = normalizedTutorLiveVoice(liveVoice);
  return `${selectSetting('Speech Source', 'Local is private and offline. Edge sends playback text to Microsoft; Chirp sends it to Google Cloud Text-to-Speech.', 'tutor.readAloud.provider', settings.tutorReadAloudProvider, [
    ['edgeOnline', 'Microsoft Edge Online'], ['windowsLocal', 'Local Windows (offline)'], ['googleChirp', 'Google Cloud Chirp 3 HD']
  ])}${credentialSettingNote(settings, 'tutor.readAloud.provider', settings.tutorReadAloudProvider)}
    ${selectSetting('Sentence pause', live ? 'Gemini Live sets its own pauses.' : 'Pause between sentences in tutor speech.', 'tutor.readAloud.sentencePauseMilliseconds', String(settings.tutorSentencePauseMilliseconds ?? 0), [
      ['0', 'Engine default'], ['250', '0.25 s'], ['500', '0.5 s'], ['750', '0.75 s'], ['1000', '1.0 s']
    ])}
    <section class="tutor-voice-group" data-tutor-voice-group="edge"><h4>Microsoft Edge Online</h4>
    <div class="conditional-group" data-provider-for="tutor.readAloud.provider" data-provider-value="edgeOnline">
      ${edgeVoiceSetting(
        settings.tutorEdgeReadAloudLocale,
        settings.tutorEdgeReadAloudVoice,
        {
          localeKey: 'tutor.readAloud.edgeLocale',
          voiceKey: 'tutor.readAloud.edgeVoice',
          locales: TUTOR_EDGE_SPEECH_LOCALES,
          allowAuto: false,
          localeDescription: 'Choose the English language and region used for every tutor playback.',
          voiceDescription: 'Authoritative. Enter a current Microsoft Edge English voice ID, including one not listed above.',
          previewCommand: 'previewTutorEdgeVoice'
        }
      )}
      ${tutorVoiceDefaultSetting('Female Default', 'Female Edge voice used when Standard conversation replay needs the other gender.', 'tutor.readAloud.edgeFemaleVoice', 'updateTutorEdgeFemaleVoice', settings.tutorEdgeReadAloudFemaleVoice ?? TUTOR_DEFAULTS.configuration['tutor.readAloud.edgeFemaleVoice'], edgeDefault('female', settings.tutorEdgeReadAloudFemaleVoice ?? '', 'en-US-AvaNeural'))}
      ${tutorVoiceDefaultSetting('Male Default', 'Male Edge voice used when Standard conversation replay needs the other gender.', 'tutor.readAloud.edgeMaleVoice', 'updateTutorEdgeMaleVoice', settings.tutorEdgeReadAloudMaleVoice ?? TUTOR_DEFAULTS.configuration['tutor.readAloud.edgeMaleVoice'], edgeDefault('male', settings.tutorEdgeReadAloudMaleVoice ?? '', 'en-US-ChristopherNeural'))}
      ${selectSetting('Edge Reading Speed', 'Zero percent is the natural voice speed.', 'tutor.readAloud.edgeRatePercent', String(settings.tutorEdgeReadAloudRatePercent), [
        ['-25', '-25% slower'], ['-10', '-10% slower'], ['0', '0% (normal)'], ['10', '+10% faster'], ['25', '+25% faster']
      ])}
      <p class="model-note">Edge TTS uses Python on this machine. Only tutor playback text is sent to Microsoft's Edge speech service.</p>
    </div></section>
    <section class="tutor-voice-group" data-tutor-voice-group="gemini"><h4>Gemini Live and Chirp 3 HD Voice</h4>
      <label class="setting"><span><span class="setting-title">Live Voice</span><span class="setting-description">The same voices serve Gemini Live and Chirp 3 HD. A change applies from the next Start or Back to chat.</span></span><span class="setting-control"><select data-tutor-conversation-live-voice>${TUTOR_LIVE_VOICES.map(([name]) => `<option value="${escapeHtml(name)}"${name === selectedLiveVoice ? ' selected' : ''}>${escapeHtml(tutorLiveVoiceLabel(name))}</option>`).join('')}</select><button type="button" class="secondary" data-command="previewTutorGeminiVoice"${settings.tutorReadAloudProvider === 'googleChirp' || Boolean(settings.tutorLiveProfile === 'pro' ? settings.credentialPresence?.geminiAlternate : settings.credentialPresence?.geminiDefault) ? '' : ' disabled'}>Preview</button></span></label>
      ${tutorVoiceDefaultSetting('Female Default', 'Female Gemini voice kept for gender-based voice choices.', 'tutor.liveFemaleVoice', 'updateTutorGeminiFemaleVoice', settings.tutorLiveFemaleVoice ?? TUTOR_DEFAULTS.configuration['tutor.liveFemaleVoice'], liveDefault('female', settings.tutorLiveFemaleVoice ?? TUTOR_DEFAULTS.configuration['tutor.liveFemaleVoice']))}
      ${tutorVoiceDefaultSetting('Male Default', 'Male Gemini voice kept for gender-based voice choices.', 'tutor.liveMaleVoice', 'updateTutorGeminiMaleVoice', settings.tutorLiveMaleVoice ?? TUTOR_DEFAULTS.configuration['tutor.liveMaleVoice'], liveDefault('male', settings.tutorLiveMaleVoice ?? TUTOR_DEFAULTS.configuration['tutor.liveMaleVoice']))}
      <p class="model-note">Live replies use Gemini with a stored Gemini key, whatever the text provider. Chirp uses these female and male defaults for Standard speech and read-only Live playback.</p>
    </section>
    <div class="conditional-group" data-provider-for="tutor.readAloud.provider" data-provider-value="googleChirp">
      ${selectSetting('Reading Speed', 'Zero percent maps to the natural speaking rate, 1.0.', 'tutor.readAloud.edgeRatePercent', String(settings.tutorEdgeReadAloudRatePercent), [
        ['-25', '-25% slower'], ['-10', '-10% slower'], ['0', '0% (normal)'], ['10', '+10% faster'], ['25', '+25% faster']
      ])}
      <p class="model-note">Usage is billed to your Google Cloud project after any free allowance. Enable the Cloud Text-to-Speech API. Set a key in Credentials; the Cloud Translation key is used when no separate key is stored.</p>
    </div>
    <section class="tutor-voice-group" data-tutor-voice-group="local"><h4>Local Windows</h4>
    <div class="conditional-group" data-provider-for="tutor.readAloud.provider" data-provider-value="windowsLocal">
      ${nativeVoiceSetting(
        settings.tutorReadAloudVoice,
        settings.readAloudVoices,
        'tutor.readAloud.voice',
        'Installed System.Speech voices. Choose an English voice for tutor playback.'
      )}
      ${selectSetting('Reading Rate', 'Windows speech rate. Zero is the normal voice rate.', 'tutor.readAloud.rate', String(settings.tutorReadAloudRate), [
        ['-4', '-4 (slower)'], ['-2', '-2'], ['0', '0 (normal)'], ['2', '+2'], ['4', '+4 (faster)']
      ])}
      <p class="model-note">Offline: tutor text remains on this PC and is passed to Windows System.Speech only.</p>
    </div></section>
    ${selectSetting('Volume', 'Local playback volume or Edge synthesis volume.', 'tutor.readAloud.volume', String(settings.tutorReadAloudVolume), [
      ['25', '25%'], ['50', '50%'], ['75', '75%'], ['100', '100%']
    ])}`;
}

function tutorFoldable(
  id: string,
  label: string,
  summary: string,
  fields: string,
  open = false,
  level: 'parent' | 'child' = 'parent'
): string {
  return settingsFoldable({
    label,
    summary,
    fields,
    detailsAttributes: `data-tutor-foldable data-tutor-${level} data-persist-id="tutor-${escapeHtml(id)}"`,
    open
  });
}

/*
 * Paired with tutorWaitingNotice above it deliberately: the notice says what is being waited
 * for and this says how to stop that same thing, so a wait can never be described by one and
 * left unstoppable by the other. They are read in the same order for the same reason.
 */
function tutorWaitingCancel(
  state: TutorViewState
): { command: string; attribute: string; label?: string } | undefined {
  // The same order as tutorWaitingNotice, so the notice and the cancel always name one wait.
  if (state.askBusy !== undefined) return { command: 'cancelTutorAsk', attribute: '' };
  const hint = state.exerciseHintBusyIds[0];
  if (hint !== undefined) {
    return { command: 'cancelTutorPracticeHint', attribute: ` data-tutor-exercise="${escapeHtml(hint)}"` };
  }
  const review = state.reviewBusyIds[0];
  if (review !== undefined) {
    return {
      command: 'cancelTutorReview',
      attribute: ` data-tutor-exercise="${escapeHtml(review)}"`
    };
  }
  const example = state.exampleBusyIds[0];
  if (example !== undefined) {
    return { command: 'cancelTutorExample', attribute: ` data-tutor-example="${escapeHtml(example)}"`, label: 'Cancel regeneration' };
  }
  if (state.exerciseBusy) return { command: 'cancelTutorExercises', attribute: '' };
  if (state.lessonBusy) return { command: 'cancelTutorLesson', attribute: '' };
  return undefined;
}

const TUTOR_ASK_WAITING_NOTICES: Record<TutorAskBusyKind, string> = {
  targetSearch: 'Drafting a prompt from your question. Please wait.',
  passageDiagnosis: 'Analyzing your selected text. Please wait.',
  conversationDiagnosis: 'Diagnosing your conversation. Please wait.',
  tailoredPrompt: 'Writing your tailored prompt. Please wait.',
  exampleQuestion: 'Answering your question about this example. Please wait.',
  practiceQuestion: 'Answering your question about this practice item. Please wait.'
};

export function tutorWaitingNotice(state: TutorViewState): string | undefined {

  if (state.askBusy !== undefined) return TUTOR_ASK_WAITING_NOTICES[state.askBusy];
  if (state.exerciseHintBusyIds.length > 0) return 'Explaining what this question asks. Please wait.';
  if (state.reviewBusyIds.length > 0) return 'Preparing a review. Please wait.';
  if (state.exampleBusyIds.length > 0) return 'Regenerating an example. Please wait.';
  if (state.exerciseBusy) {
    return state.exerciseSet
      ? 'Preparing new practice. Please wait.'
      : 'Preparing practice. Please wait.';
  }
  if (state.lessonBusy) {
    return state.lesson
      ? 'Redrafting the lesson. Please wait.'
      : 'Drafting a lesson. Please wait.';
  }
  return undefined;
}

function renderTutorSettingsBridges(): string {
  return (['Voice', 'Model'] as const).map(label => `<button type="button" class="tutor-settings-bridge" data-tutor-settings-section="${label === 'Voice' ? 'tutor-voice' : 'tutor-routing'}" aria-label="Open ${label.toLowerCase()} settings">${panelIconSvgMarkup('settings')}${label}</button>`).join('');
}

function renderTutorMasterReset(state: TutorViewState): string {
  const unavailable = tutorResetBusy(state);
  return `<button type="button" class="secondary tutor-master-reset" data-command="resetTutorSession" title="Reset the learning map, lesson, practice and conversation"${unavailable ? ' disabled aria-disabled="true" aria-description="A request is in progress."' : ''}>Reset</button>`;
}

function renderTutorActions(
  state: TutorViewState
): { buttons: string; statusRegion: string; exerciseAction: string } {
  const readiness = tutorSelectionReadiness(state);
  const primary = state.selection.some((target) => target.role === 'primary');
  const unavailableReason = state.settings.questionOnly
    ? state.question?.trim()
      /*
       * Available. This said "Question-only lesson generation requires shared Core support"
       * and was true for about an hour: core refused a recipe with no primary target until
       * 0.17.0 gave it one. Unblocking core replaced the throw that produced the message and
       * left the message, so Draft lesson and Practice stayed disabled behind a reason that
       * had stopped being true. Ask drafts directly, which is why it went unnoticed: the one
       * route the reader takes first does not pass through these controls.
       */
      ? undefined
      : 'Ask a lesson question'
    : !primary
      ? 'Open the learning map, select or search learning map targets. Alternatively, type a question or select text from the editor to initiate a model-based lesson and practice.'
      : readiness.ready ? undefined : `${readiness.summary}. Adjust the target selection first.`;
  const inputReason = state.settings.questionOnly
    ? 'Choose a learning-map target or write a lesson question first.'
    : 'Choose a learning-map target, or turn on "Use question without learning-map targets" to draft from your question.';
  const lessonReason = state.lessonBusy
    ? 'Lesson drafting is in progress.'
    : state.exampleBusyIds.length > 0
      ? 'Example regeneration is in progress.'
      : tutorHasLessonInput(state) ? undefined : inputReason;
  const lessonUnavailableAttributes = lessonReason
    ? ` disabled aria-disabled="true" aria-description="${escapeHtml(lessonReason)}" title="${escapeHtml(lessonReason)}"`
    : '';
  // 2026-10-04: stale practice cannot block fresh practice for a redrafted lesson.
  const currentPractice = tutorPracticeBelongsToLesson(state);
  const practiceUnfinished = currentPractice && !tutorPracticeResults(state);
  const exerciseReason = state.exerciseBusy
    ? 'Practice preparation is in progress.'
    : !currentPractice && !tutorAllExamplesViewed(state)
      ? 'Go through every example first.'
      : (state.lesson ? undefined : unavailableReason) ?? (practiceUnfinished ? 'Finish every question in this practice set first.' : undefined);
  const exerciseUnavailableAttributes = exerciseReason
    ? ` disabled aria-disabled="true" aria-description="${escapeHtml(exerciseReason)}" title="${escapeHtml(exerciseReason)}"${state.exerciseBusy ? ' aria-describedby="tutor-action-exercise-busy"' : ''}`
    : '';
  /*
   * One control per action, whose own label says what pressing it will do. A second
   * Redraft lesson button beside Draft lesson offered the reader two controls that sent
   * the identical command, so the pair could only ever be read as two different things.
   * Practice already worked this way, changing to Practice again once a set existed.
   */
  const lessonActions = `<button type="button" data-tutor-open-lesson-settings title="Open the lesson settings above">Setting</button><button type="button" data-command="generateTutorLesson" data-tutor-has-target="${state.selection.length > 0}" data-tutor-has-question="${Boolean(state.question?.trim())}" data-tutor-question-only="${state.settings.questionOnly}"${state.lessonBusy || state.exampleBusyIds.length > 0 ? ' data-tutor-draft-busy' : ''}${lessonUnavailableAttributes}>${state.lesson ? 'Redraft' : 'Draft'}</button>`;
  const exerciseAction = `<button type="button" class="${state.exerciseSet ? 'secondary ' : ''}tutor-generate-practice" data-tutor-shared-action data-command="generateTutorExercises"${exerciseUnavailableAttributes}>${state.exerciseSet ? 'Practice again' : 'Practice now'}</button>`;
  const results = tutorPracticeResults(state);
  const resultsVisible = Boolean(results && state.practiceResultsOpened &&
    !state.practiceMissedOnly && !state.practiceReviewAll);
  const resultsAction = results && !resultsVisible
    ? `<button type="button" class="secondary" data-command="showTutorPracticeResults">${state.practiceResultsOpened ? 'Back to results' : 'Show results'}</button>`
    : '';
  const resetUnavailable = tutorLessonResetBusy(state) || !state.lesson;
  const resetAction = `<button type="button" class="secondary" data-command="resetTutorLesson" title="Reset the lesson and practice"${resetUnavailable ? ' disabled aria-disabled="true" aria-description="There is no lesson to reset, or a request is in progress."' : ''}>Reset</button>`;
  const messages = [
    unavailableReason
      ? `<p id="tutor-action-readiness" class="tutor-action-status">${escapeHtml(unavailableReason)}</p>`
      : '',
    state.lessonBusy
      ? '<p id="tutor-action-lesson-busy" class="tutor-action-status">Drafting the lesson.</p>'
      : '',
    state.exerciseBusy
      ? '<p id="tutor-action-exercise-busy" class="tutor-action-status">Preparing practice.</p>'
      : '',
    state.lessonFailure ? `<p class="tutor-failure">${escapeHtml(state.lessonFailure)}</p>` : '',
    state.exerciseFailure ? `<p class="tutor-failure">${escapeHtml(state.exerciseFailure)}</p>` : ''
  ].join('');
  return {
    // Changed 2026-09-30: drafting actions follow Lesson settings; practice precedes Common errors.
    buttons: `<div class="settings-buttons tutor-heading-actions" data-tutor-heading-actions aria-label="Tutor actions">${lessonActions}${resetAction}${renderTutorSettingsBridges()}</div>`,
    exerciseAction: `${exerciseAction}${resultsAction}`,
    statusRegion: `<section class="tutor-action-status-region" data-tutor-action-status aria-labelledby="tutor-page-heading" role="status" aria-live="polite">${messages}</section>`
  };
}

function renderTutorMap(state: TutorViewState, compatibilityStatus: string): string {
  const trayRows = state.selection.map((target) => {
    const node = findTrainingMapNode(target.nodeId);
    const role = state.settings.questionOnly || target.role === 'support'
      ? 'Support'
      : 'Primary';
    const path = tutorTargetPathLabel(target.nodeId) || node?.label || target.nodeId;
    const clear = deleteIconButton(
      'updateTutorTarget',
      `data-tutor-target="${escapeHtml(target.nodeId)}" data-tutor-target-row="${escapeHtml(target.nodeId)}" data-tutor-role="off"`,
      `Clear ${path}`
    );
    const makePrimary = !state.settings.questionOnly && target.role === 'support' &&
      !tutorTargetActionReason(state.selection, target.nodeId, 'primary')
      ? iconButton(
        'updateTutorTarget',
        `data-tutor-target="${escapeHtml(target.nodeId)}" data-tutor-role="primary"`,
        'Make primary',
        `Make ${path} the primary target`,
        'primary'
      )
      : '';
    const makeSupport = !state.settings.questionOnly && target.role === 'primary' &&
      !tutorTargetActionReason(state.selection, target.nodeId, 'support')
      ? iconButton(
        'updateTutorTarget',
        `data-tutor-target="${escapeHtml(target.nodeId)}" data-tutor-role="support"`,
        'Make support',
        `Make ${path} a support target`,
        'support'
      )
      : '';
    return `<div class="tutor-tray-row"><strong>${role}</strong><span class="tutor-target-path">${escapeHtml(path)}</span>${makePrimary}${makeSupport}${clear}</div>`;
  }).join('');
  const compatibility = compatibilityStatus === 'compatible'
    ? 'Compatible'
    : compatibilityStatus === 'warning' ? 'Compatible with warnings' : 'Conflict';
  const search = state.mapSearch.trim().toLocaleLowerCase();
  const searchResults = TUTOR_MAP.map((node) => {
    const hidden = !search || !node.label.toLocaleLowerCase().includes(search);
    return `<button type="button" class="secondary tutor-map-search-result${hidden ? ' hidden' : ''}" data-command="updateTutorMapPath" data-tutor-map-level="${escapeHtml(node.kind)}" data-tutor-target="${escapeHtml(node.id)}" data-tutor-search-result data-tutor-search-text="${escapeHtml(node.label)}">${escapeHtml(tutorTargetPathLabel(node.id))}</button>`;
  }).join('');
  const deepest = deepestTutorMapNode(state);
  /*
   * Selected targets shows what is selected and the controls that change it, and carries no
   * explanation of the mode it is in. This said "Question-led lessons use learning-map
   * targets as Supports." whenever the switch was on, which is a sentence about how KREN
   * works rather than about the reader's selection, sitting where their selection is.
   */
  const primaryReason = tutorTargetActionReason(state.selection, deepest?.id, 'primary');
  const supportReason = tutorTargetActionReason(state.selection, deepest?.id, 'support');
  const targetActions = `${tutorTargetActionButton('Primary', 'Set a target as primary', deepest?.id, 'primary', primaryReason)}${tutorTargetActionButton('Support', 'Add a target as support', deepest?.id, 'support', supportReason)}`;
  const clearUnavailable = state.selection.length === 0;
  const selectedTargets = `<div class="tutor-tray" aria-label="Selected targets"><div class="tutor-tray-heading"><strong>Selected targets</strong><div class="tutor-tray-actions">${targetActions}<button type="button" class="secondary" data-command="clearTutorTargets"${clearUnavailable ? ' aria-disabled="true" aria-description="There are no selected targets."' : ''}>Clear all</button></div></div>${trayRows || '<p>No targets selected.</p>'}<p><strong>Compatibility:</strong> ${escapeHtml(compatibility)}</p><p class="tutor-target-limits">Up to three Primary targets and three Support targets.</p>${[...new Set([state.preparedPromptSource === 'tailored' ? state.tailoredPromptSelectionMessage : undefined, state.selectionMessage])].filter(Boolean).map((message) => `<p class="tutor-selection-footnote" role="status">${escapeHtml(message!)}</p>`).join('')}</div>`;
  const cascade = `<div class="tutor-map-cascade">${TUTOR_MAP_LEVEL_CONTROLS.map((level, index) => renderTutorMapLevel(state, level, index)).join('')}</div>`;
  return `<div class="tutor-map-search-row"><textarea class="tutor-map-search" data-tutor-map-search rows="1" placeholder="Search target names or type a question" aria-label="Search learning map targets" aria-description="Type a question here before choosing Ask." autocomplete="off">${escapeHtml(state.mapSearch)}</textarea>${renderTutorMapSearchControls(state).join('')}</div>
    <div class="tutor-question-only-setting">${toggleSetting('Use question without learning-map targets', 'Draft and practice from the lesson question alone. The learning map stays available to browse.', 'tutor.questionOnly', state.settings.questionOnly)}</div>
    <div class="tutor-map-search-results${search ? '' : ' hidden'}" data-tutor-search-results aria-label="Learning map search results">${searchResults}</div>
    ${cascade}
    ${state.question === undefined ? '' : `<p class="tutor-message"><strong>Lesson question:</strong> ${escapeHtml(state.question)}</p>`}
    ${selectedTargets}`;
}

// The row and its declared grid tracks use the same list, including optional controls.
function renderTutorMapSearchControls(state: TutorViewState): string[] {
  const ask = iconButton(
    'askTutorQuestion',
    'data-tutor-ask',
    'Ask or analyze text',
    'Ask or analyze text',
    'ask',
    false,
    false,
    'icon-button tutor-action-icon'
  );
  const preparedPromptAvailable = state.preparedPrompt !== undefined ||
    Boolean(state.questionPrepared && tutorPreparedPrompt(state) !== undefined);
  const preparedPrompt = iconButton(
    'openTutorPreparedPrompt',
    'data-tutor-prepared-prompt-action',
    'Edit prepared prompt',
    'Edit the prepared lesson prompt',
    'edit',
    false,
    false,
    `icon-button tutor-action-icon${preparedPromptAvailable ? '' : ' setting-inactive'}`,
    preparedPromptAvailable
      ? ''
      : ' aria-disabled="true" aria-description="Ask a question or apply a diagnostic report to prepare a prompt."'
  );
  // A magnifier rather than the words "Find targets", because it sat beside an icon button
  // for the other half of the same action and the pair read as two kinds of control.
  const find = iconButton(
    'findTutorTargets',
    `data-tutor-find-targets${state.settings.questionOnly
      ? ' aria-disabled="true" aria-description="Turn off Use question without learning-map targets to find map targets."'
      : ''}`,
    'Find targets',
    'Find learning map targets',
    'search',
    false,
    false,
    'icon-button tutor-action-icon'
  );
  const clear = iconButton(
    'clearTutorSearch',
    'data-tutor-clear-search',
    'Clear',
    'Clear the search or question text',
    'clear',
    false,
    false,
    'icon-button tutor-action-icon'
  );
  const report = state.diagnosticReport ? iconButton(
    'openTutorDiagnosticReport',
    'data-tutor-diagnostic-report-action',
    'View diagnostic report',
    'View diagnostic report',
    'document',
    false,
    false,
    'icon-button tutor-action-icon'
  ) : '';
  return [find, ask, preparedPrompt, report, clear].filter(Boolean);
}

const TUTOR_MAP_LEVEL_CONTROLS: ReadonlyArray<{
  level: TutorMapLevel;
  label: string;
  description: string;
}> = [
  { level: 'hub', label: 'Hub', description: 'A broad system of English knowledge and use.' },
  { level: 'cluster', label: 'Cluster', description: 'A related family of capabilities within a Hub.' },
  { level: 'skill', label: 'Skill', description: 'A teachable capability within a Cluster.' },
  { level: 'microTarget', label: 'Micro-target', description: 'An exact contrast or rule within a Skill.' }
];

function renderTutorMapLevel(
  state: TutorViewState,
  control: { level: TutorMapLevel; label: string; description: string },
  index: number
): string {
  const previous = TUTOR_MAP_LEVEL_CONTROLS[index - 1];
  const parentId = previous ? state.mapPath[previous.level] : undefined;
  const options = TUTOR_MAP.filter((node) =>
    node.kind === control.level && (control.level === 'hub' || node.parentId === parentId)
  );
  const unavailableDescription = previous && !parentId
    ? `${control.label} is available after choosing a ${previous.label}.`
    : previous && options.length === 0
      ? `This branch ends at ${previous.label}.`
      : undefined;
  const selectedId = state.mapPath[control.level] ?? '';
  const selectedNode = selectedId ? findTrainingMapNode(selectedId) : undefined;
  const controlId = `tutor-map-${control.level}`;
  const descriptionId = `${controlId}-description`;
  const informationId = `${controlId}-information`;
  const informationUnavailable = selectedNode
    ? undefined
    : `${control.label} information is available after choosing a ${control.label}.`;
  const informationButton = iconButton(
    undefined,
    'data-tutor-info-toggle',
    `Information about ${control.label}`,
    `Information about ${control.label}`,
    'information',
    false,
    false,
    'secondary icon-button tutor-map-information',
    ` aria-controls="${escapeHtml(informationId)}" aria-expanded="false"${informationUnavailable ? ` aria-disabled="true" aria-description="${escapeHtml(informationUnavailable)}"` : ''}`
  );
  return `<div class="setting tutor-map-level" data-tutor-map-control="${escapeHtml(control.level)}"><span><span class="tutor-map-level-heading">${informationButton}<label id="${escapeHtml(controlId)}-label" class="setting-title" for="${escapeHtml(controlId)}">${escapeHtml(control.label)}</label></span><span id="${escapeHtml(descriptionId)}" class="setting-description">${escapeHtml(control.description)}</span></span><select id="${escapeHtml(controlId)}" data-tutor-map-level="${escapeHtml(control.level)}" aria-describedby="${escapeHtml(descriptionId)}"${unavailableDescription ? ` aria-disabled="true" aria-description="${escapeHtml(unavailableDescription)}"` : ''}><option value=""${selectedId ? '' : ' selected'}>Select an option</option>${options.map((node) => `<option value="${escapeHtml(node.id)}"${node.id === selectedId ? ' selected' : ''}>${escapeHtml(node.label)}</option>`).join('')}</select>${selectedNode ? renderTutorTargetInformation(selectedNode, informationId) : ''}</div>`;
}

/*
 * Blueprint 5.2 requires a usage status on every target, not only on the ones carrying an
 * optional field. `currency` and `regionalScope` are both optional in `TrainingMapNode`, so
 * a node with neither showed no status at all and the reader could not tell whether that
 * meant contemporary or unknown. Absent currency means contemporary, which is what the
 * blueprint's own list makes the unmarked case.
 */
function tutorUsageStatus(node: TrainingMapNode): string {
  const currency = node.currency ?? 'contemporary';
  // "regional to global" is not English. A scope of global is the unmarked case and adds
  // nothing, so only a narrower scope is named.
  const narrower = (node.regionalScope ?? []).filter((scope) => scope !== 'global');
  const regional = narrower.length ? `, ${narrower.join(', ')}` : '';
  return `${currency.charAt(0).toUpperCase()}${currency.slice(1)}${regional}`;
}

function renderTutorTargetInformation(node: TrainingMapNode, id: string): string {
  const related = (nodeIds: readonly string[]): string => nodeIds.length
    ? nodeIds.map((nodeId) => findTrainingMapNode(nodeId)?.label ?? nodeId).join(', ')
    : 'None';
  const modalities = node.modalities.length === 2
    ? 'both'
    : node.modalities[0] ?? 'None';
  const example = node.exampleSeed
    ? `<dt>Example</dt><dd>${escapeHtml(node.exampleSeed)}</dd>`
    : '';
  const usage = `<dt>Usage status</dt><dd>${escapeHtml(tutorUsageStatus(node))}</dd>`;
  return `<aside id="${escapeHtml(id)}" class="tutor-target-info" aria-label="Information about ${escapeHtml(node.label)}" hidden><dl><dt>Description</dt><dd>${escapeHtml(node.description)}</dd>${example}<dt>Suggested level</dt><dd>${escapeHtml(node.levelRange.minimum)}-${escapeHtml(node.levelRange.maximum)}</dd><dt>Modalities</dt><dd>${escapeHtml(modalities)}</dd><dt>Prerequisites</dt><dd>${escapeHtml(related(node.prerequisites))}</dd><dt>Commonly paired targets</dt><dd>${escapeHtml(related(node.recommendedSupports))}</dd><dt>Conflicts</dt><dd>${escapeHtml(related(node.conflicts))}</dd>${usage}</dl></aside>`;
}

function tutorTargetActionButton(
  label: string,
  title: string,
  nodeId: string | undefined,
  role: 'primary' | 'support',
  reason: string | undefined
): string {
  if (reason) return '';
  const noTarget = !nodeId;
  return `<span><button type="button" class="tutor-map-action" data-tutor-shared-action data-command="updateTutorTarget" data-tutor-target="${escapeHtml(nodeId ?? '')}" data-tutor-role="${role}" title="${escapeHtml(title)}"${noTarget ? ' data-tutor-no-target aria-disabled="true" aria-description="Choose a learning-map option to make this action available."' : ''}>${escapeHtml(label)}</button></span>`;
}

function renderTutorLessonSettings(state: TutorViewState): string {
  const settings = state.settings;
  return `${numberSetting('Number of examples', 'Core accepts 1 to 20.', 'tutor.exampleCount', settings.exampleCount, 1, 20)}
    ${selectSetting('Sentence length band', 'Target word count for every lesson example.', 'tutor.sentenceLengthBand', settings.sentenceBand, TUTOR_SENTENCE_BANDS.map((band) => [band.id, `${band.label}, ${band.minimumWords}-${band.maximumWords} words`]))}
    ${numberSetting('Tolerance', 'Allowed words outside the selected band. Core requires a whole number of zero or more.', 'tutor.tolerance', settings.tolerance, 0)}
    ${selectSetting('Learner level', 'Common European Framework level for the explanation and examples.', 'tutor.learnerLevel', settings.learnerLevel, TUTOR_LEARNER_LEVELS.map((value) => [value, tutorValueLabel(value)]))}
    ${selectSetting('Lesson mode', 'Controls the lesson structure.', 'tutor.lessonMode', settings.lessonMode, TUTOR_LESSON_MODES.map((value) => [value, tutorValueLabel(value)]))}
    ${selectSetting('Explanation depth', 'Controls how much explanation accompanies the examples.', 'tutor.explanationDepth', settings.explanationDepth, TUTOR_EXPLANATION_DEPTHS.map((value) => [value, tutorValueLabel(value)]))}
    ${selectSetting('Annotation level', 'Controls how explicitly target spans are explained.', 'tutor.annotationLevel', settings.annotationLevel, TUTOR_ANNOTATION_LEVELS.map((value) => [value, tutorValueLabel(value)]))}
    ${toggleSetting('Include common errors', 'Ask for clearly labeled error contrasts.', 'tutor.includeCommonErrors', settings.includeCommonErrors)}
    ${numberSetting('Practice item count', 'Prepare 1 to 20 written practice items after Practice now.', 'tutor.exerciseCount', settings.exerciseCount, 1, 20)}`;
}

function renderTutorAxisGroups(state: TutorViewState): string {
  const axes = state.settings.axes;
  const channel = tutorFoldable('channel', 'CHANNEL', settingsSummary([
    ['Modality', tutorAxisLabel('rewrite.modality', axes.modality), false],
    ['Function', tutorAxisLabel('rewrite.function', axes.function), false],
    ['Output language', tutorAxisLabel('rewrite.englishVariety', axes.englishVariety), false]
  ]), `${selectSetting('Modality', 'Written or spoken language style. Spoken exercise channels arrive in V33.', 'tutor.axis.modality', axes.modality, tutorAxisOptions('rewrite.modality'))}
    ${selectSetting('Function', 'The channel or document function used in examples.', 'tutor.axis.function', axes.function, tutorAxisOptions('rewrite.function'))}
    ${selectSetting('Output language', 'The Tutor teaches English and reuses Rewrite Text\'s current output-language axis.', 'tutor.axis.englishVariety', axes.englishVariety, tutorAxisOptions('rewrite.englishVariety'))}
    <div data-enabled-for="tutor.axis.englishVariety" data-enabled-value="otherLanguage">${selectSetting('Other output language', 'Read only when Other languages is selected.', 'tutor.axis.otherOutputLanguage', axes.otherOutputLanguage ?? TUTOR_DEFAULTS.otherOutputLanguage, REWRITE_OTHER_LANGUAGES.map((language) => [language.id, language.label]))}</div>`, false, 'child');
  const subject = tutorFoldable('subject', 'SUBJECT', `Domain: ${tutorAxisLabel('rewrite.domain', axes.domain)}`, selectSetting('Domain', 'Shapes terminology without sending workspace context.', 'tutor.axis.domain', axes.domain, tutorAxisOptions('rewrite.domain')), false, 'child');
  const register = tutorFoldable('register', 'REGISTER', settingsSummary([
    ['Formality', tutorAxisLabel('rewrite.formality', axes.formality), false],
    ['Voice', tutorAxisLabel('rewrite.voice', axes.voice), false],
    ['Stance', tutorAxisLabel('rewrite.stance', axes.stance), false]
  ]), `${selectSetting('Formality', 'Controls formality independently.', 'tutor.axis.formality', axes.formality, tutorAxisOptions('rewrite.formality'))}
    ${selectSetting('Voice', 'Controls rhetorical character.', 'tutor.axis.voice', axes.voice, tutorAxisOptions('rewrite.voice'))}
    ${selectSetting('Stance', 'Controls interpersonal posture.', 'tutor.axis.stance', axes.stance, tutorAxisOptions('rewrite.stance'))}`, false, 'child');
  const shape = tutorFoldable('shape', 'SHAPE', `Perspective: ${tutorAxisLabel('rewrite.perspective', axes.perspective)}`, selectSetting('Perspective', 'The Rewrite Text length axis is omitted because the tutor has no source text.', 'tutor.axis.perspective', axes.perspective, tutorAxisOptions('rewrite.perspective')), false, 'child');
  const intent = tutorFoldable('intent', 'INTENT', `Rhetorical mode: ${tutorAxisLabel('rewrite.rhetoricalMode', axes.rhetoricalMode)}`, selectSetting('Rhetorical mode', 'Controls what the examples are trying to accomplish.', 'tutor.axis.rhetoricalMode', axes.rhetoricalMode, tutorAxisOptions('rewrite.rhetoricalMode')), false, 'child');
  return `${channel}${subject}${register}${shape}${intent}`;
}

function renderTutorRecipe(state: TutorViewState): string {
  const primary = state.selection.find((target) => target.role === 'primary');
  const supports = state.selection.filter((target) => target.role === 'support');
  const questionOnlySupports = tutorQuestionOnlySelection(state.selection);
  const band = tutorSentenceBand(state.settings.sentenceBand);
  const include = [
    state.settings.lessonMode !== 'examples' ? 'rule and interaction explanations' : undefined,
    'annotated examples',
    state.settings.includeCommonErrors ? 'common errors' : undefined
  ].filter((value): value is string => value !== undefined).join(', ');
  const question = state.question === undefined
    ? ''
    : `<dt>Answer</dt><dd>${escapeHtml(state.question)}</dd>`;
  const subject = state.settings.questionOnly
    ? 'The subject stated in the lesson question'
    : primary ? findTrainingMapNode(primary.nodeId)?.label ?? primary.nodeId : 'No Primary target selected';
  const practiceSubject = state.settings.questionOnly
    ? questionOnlySupports.length > 0
      ? `The lesson question, supported by ${questionOnlySupports.map((target) => findTrainingMapNode(target.nodeId)?.label ?? target.nodeId).join(', ')}`
      : 'The lesson question, without learning-map targets'
    : supports.length
      ? supports.map((target) => findTrainingMapNode(target.nodeId)?.label ?? target.nodeId).join(', ')
      : 'No Support targets';
  return `<dl class="tutor-recipe">${question}<dt>Teach</dt><dd>${escapeHtml(subject)}</dd><dt>Practice it with</dt><dd>${escapeHtml(practiceSubject)}</dd><dt>Draft</dt><dd>${state.settings.exampleCount} ${escapeHtml(tutorValueLabel(state.settings.sentenceBand).toLocaleLowerCase())} examples, ${band.minimumWords} to ${band.maximumWords} words each, level ${escapeHtml(tutorValueLabel(state.settings.learnerLevel))}.</dd><dt>Style</dt><dd>${escapeHtml(tutorAxisLabel('rewrite.modality', state.settings.axes.modality))}, ${escapeHtml(tutorAxisLabel('rewrite.domain', state.settings.axes.domain))}, ${escapeHtml(tutorAxisLabel('rewrite.voice', state.settings.axes.voice))}, ${escapeHtml(tutorAxisLabel('rewrite.rhetoricalMode', state.settings.axes.rhetoricalMode))}.</dd><dt>Include</dt><dd>${escapeHtml(include)}.</dd><dt>Privacy</dt><dd>KREN sends this visible recipe and its fixed structured-output instruction. No editor selection, document text, file name, workspace path, User Dictionary entry, previous lesson, or earlier answer is included.</dd></dl>`;
}

/*
 * Blueprint 2.1 says KREN chooses an eligible child and names it. Naming it is half the
 * requirement and the half a reader notices: a lesson that silently taught something other
 * than what they picked would read as the wrong lesson rather than as Explore working.
 *
 * Escaping happens here rather than at the call site, because this returns markup.
 */
function tutorTaughtTargetLabel(target: ResolvedTrainingTarget): string {
  const label = escapeHtml(target.label);
  if (!target.chosenUnder) return label;
  const parent = findTrainingMapNode(target.chosenUnder)?.label ?? target.chosenUnder;
  return `${label} <span class="tutor-chosen-under">chosen for you under ${escapeHtml(parent)}</span>`;
}

function renderTutorLessonOutput(state: TutorViewState, practiceAction = ''): string {
  if (!state.lesson) return state.lessonBusy
    ? '<article class="tutor-lesson" aria-live="polite"><p>Drafting this lesson.</p></article>'
    : '';
  const { lesson, findings, recipe } = state.lesson;
  /*
   * A question-only lesson names the question, not a map target.
   *
   * Read from the recipe this lesson was drafted with, never from the current settings: a
   * reader can turn the switch off while a question-only lesson is still on screen, and the
   * header must keep describing the lesson in front of them rather than the panel's state.
   */
  const subjectLine = recipe?.question && recipe.primaryTargets?.[0] === undefined
    ? `<p>Question: ${escapeHtml(recipe.question)}${lesson.supportingTargets.length ? ` | <strong>Support:</strong> ${lesson.supportingTargets.map(tutorTaughtTargetLabel).join(', ')}` : ''}</p>`
    : `<p><strong>Primary:</strong> ${tutorTaughtTargetLabel(lesson.primaryTarget)}${lesson.supportingTargets.length ? ` | <strong>Support:</strong> ${lesson.supportingTargets.map(tutorTaughtTargetLabel).join(', ')}` : ''}</p>`;
  const rules = lesson.rules.map((rule) => `<li><strong>${escapeHtml(tutorValueLabel(rule.status))}:</strong> ${escapeHtml(rule.statement)}</li>`).join('');
  const count = lesson.examples.length;
  const index = Math.min(Math.max(state.currentExampleIndex, 0), Math.max(count - 1, 0));
  const example = lesson.examples[index];
  const pattern = lesson.patternStatement?.trim()
    ? `<p data-tutor-lesson-pattern><strong>Pattern:</strong> ${escapeHtml(lesson.patternStatement)}</p>`
    : '';
  const examples = example ? (() => {
    const busy = state.exampleBusyIds.includes(example.id);
    /*
     * Every warning stays visible, not only the showing example's.
     *
     * The all-listed layout put each warning beside its own sentence, so a warning on example
     * three was seen while reading example one. Paging hides five of six, and a warning the
     * reader cannot reach is a warning that does not exist, so the others are listed here with
     * the example they belong to named.
     */
    const warnings = findings.filter((finding) => finding.severity === 'warning' && finding.subjects.includes(example.id));
    const elsewhere = lesson.examples.flatMap((other, otherIndex) => otherIndex === index ? [] :
      findings
        .filter((finding) => finding.severity === 'warning' && finding.subjects.includes(other.id))
        .map((finding) => `<p class="tutor-warning">Example ${otherIndex + 1}: ${escapeHtml(tutorLessonFindingMessage(finding))}</p>`));
    const attributes = `data-tutor-example="${escapeHtml(example.id)}"`;
    const regenerateAttributes = state.lessonBusy
      ? `${attributes} aria-disabled="true" aria-description="Lesson drafting is in progress."`
      : attributes;
    const toolbar = busy ? '' : `<div class="tutor-item-actions" data-tutor-example-tools>${iconButton('playTutorExample', attributes, 'Play', 'Play this example', 'speaker')}${copyIconButton('copyTutorExample', attributes, 'this example')}${iconButton('openTutorTool', `${attributes} data-tutor-tool="dictionary"`, 'Dictionary', 'Look up this example in the dictionary', 'dictionary')}${iconButton('openTutorTool', `${attributes} data-tutor-tool="translate"`, 'Translate', 'Translate this example', 'translate')}${iconButton('openTutorTool', `${attributes} data-tutor-tool="ask"`, 'Ask', 'Ask about this example', 'ask')}${iconButton('regenerateTutorExample', regenerateAttributes, 'Regenerate this example', 'Regenerate this example', 'regenerate', state.lessonBusy)}</div>`;
     const navigation = `<div class="tutor-example-navigation" aria-label="Lesson example navigation">${iconButton('showPreviousTutorExample', '', 'Back', 'Go to the previous lesson example', 'back', index === 0, false, 'icon-button tutor-action-icon', index === 0 ? ' aria-disabled="true"' : '')}<span class="tutor-exercise-position" aria-live="polite">${index + 1} / ${count}</span>${iconButton('showNextTutorExample', '', 'Next', 'Go to the next lesson example', 'back', index === count - 1, false, 'icon-button tutor-action-icon tutor-next-icon', index === count - 1 ? ' aria-disabled="true"' : '')}</div>`;
    return `<article class="tutor-example${busy ? ' tutor-item-busy' : ''}" data-tutor-example-card="${escapeHtml(example.id)}"${busy ? ' aria-busy="true"' : ''}><h3 class="tutor-item-heading">${index + 1}. ${tutorSentenceMarkup(example.sentence, example.annotations.map((annotation) => annotation.excerpt))}${example.intentionalError ? ' (Intentional error)' : ''}</h3><div data-tutor-example-explanation><div class="tutor-section-heading"><h4 class="tutor-section-badge">EXPLANATION</h4><span class="tutor-section-divider" aria-hidden="true"></span></div>${renderTutorAnnotations(example.annotations)}</div></article><div class="tutor-example-controls">${toolbar}${navigation}</div>${warnings.map((finding) => `<p class="tutor-warning">${escapeHtml(tutorLessonFindingMessage(finding))}</p>`).join('')}${elsewhere.join('')}${state.exampleFailures[example.id] ? `<p class="tutor-failure">${escapeHtml(state.exampleFailures[example.id]!)}</p>` : ''}`;
  })() : '';
  const commonErrors = lesson.commonErrors.length
    ? settingsFoldable({
      label: 'COMMON ERRORS',
      summary: `${lesson.commonErrors.length} ${lesson.commonErrors.length === 1 ? 'error' : 'errors'}`,
      fields: lesson.commonErrors.map((error) => `<div class="tutor-example"><p><strong>Intentional error:</strong> ${escapeHtml(error.incorrect)}</p><p><strong>Correction:</strong> ${escapeHtml(error.corrected)}</p><p>${escapeHtml(error.explanation)} (${escapeHtml(tutorValueLabel(error.status))})</p></div>`).join(''),
      detailsAttributes: 'data-persist-id="tutor-lesson-errors"',
      open: false
    }) : '';
  const answerKey = state.lessonAnswersVisible
    ? `<div data-tutor-lesson-answers>${lesson.answerKey?.length ? `<ol>${lesson.answerKey.map((answer) => `<li><strong>${escapeHtml(answer.answer)}</strong> ${escapeHtml(answer.explanation)}</li>`).join('')}</ol>` : '<p>No answers were returned for this lesson.</p>'}</div>`
    : '<div class="tutor-item-actions"><button type="button" data-command="showTutorAnswers">Show answers</button></div>';
  const practice = lesson.practice?.length
    ? settingsFoldable({
      label: 'Lesson practice',
      summary: `${lesson.practice.length} ${lesson.practice.length === 1 ? 'exercise' : 'exercises'}`,
      fields: `<ol>${lesson.practice.map((exercise) => `<li>${escapeHtml(exercise.prompt)}</li>`).join('')}</ol>${answerKey}`,
      detailsAttributes: 'data-persist-id="tutor-lesson-practice"',
      open: false
    }) : '';
  const stale = state.lessonStale
    ? '<div class="tutor-warning"><strong>This lesson was drafted from earlier settings.</strong> Redraft lesson uses the current recipe. Regenerating one example uses this lesson\'s earlier recipe.</div>'
    : '';
  const explanation = settingsFoldable({
    label: 'CONCEPT AND RULES',
    summary: 'Concept, interaction, rules and tendencies',
    fields: `<h3>Concept</h3><p>${escapeHtml(lesson.conceptExplanation)}</p><h3>How the combination works</h3><p>${escapeHtml(lesson.interactionExplanation)}</p><h3>Rules and tendencies</h3><ul>${rules}</ul>`,
    detailsAttributes: 'data-tutor-lesson-explanation data-persist-id="tutor-lesson-explanation"',
    open: false
  });
  return `<article class="tutor-lesson" data-tutor-result="lesson" aria-label="Drafted lesson">${stale}${subjectLine}${explanation}<h3>EXAMPLES</h3>${pattern}${examples}${practiceAction ? `<div class="tutor-lesson-practice-action" data-tutor-lesson-practice-action>${practiceAction}</div>` : ''}${commonErrors}${practice}</article>`;
}

function renderTutorPracticeResults(state: TutorViewState, results: NonNullable<ReturnType<typeof tutorPracticeResults>>): string {
  const bars = results.targets.map(({ targetId, right, attempted }) => {
    const label = findTrainingMapNode(targetId)?.label ?? targetId;
    return `<div data-tutor-target-result="${escapeHtml(targetId)}"><p>${escapeHtml(label)}: ${right} / ${attempted} right</p><meter min="0" max="${attempted}" value="${right}" aria-label="${escapeHtml(label)}: ${right} right over ${attempted} attempted">${right} / ${attempted}</meter></div>`;
  }).join('');
  const missed = results.missed.map((exercise) => {
    const review = state.reviews[exercise.id]!;
    return `<li data-tutor-missed-item="${escapeHtml(exercise.id)}"><strong>Q:</strong> ${escapeHtml(exercise.prompt)}<ul class="tutor-missed-details"><li><strong>You wrote:</strong> ${escapeHtml(review.learnerText)}</li>${review.incorrect.map((span) => `<li><strong>Correction:</strong> ${escapeHtml(span.excerpt)} → ${escapeHtml(span.corrected)}</li>`).join('') || '<li>No correction was returned.</li>'}</ul></li>`;
  }).join('');
  const missedItems = `<section data-tutor-missed-items><h4>Missed items</h4>${missed ? `<ol>${missed}</ol>` : '<p>No missed items.</p>'}</section>`;
  return `<section class="tutor-lesson" data-tutor-practice-results aria-label="Practice results"><h3>Score: ${results.right} / ${results.attempted} right</h3><div aria-label="Results by target">${bars}</div>${missedItems}<div class="tutor-item-actions"><button type="button" data-command="reviewAllTutorExercises">Review again (${results.attempted} ${results.attempted === 1 ? 'item' : 'items'})</button>${results.missed.length ? `<button type="button" data-command="walkTutorMissedExercises">Review ${results.missed.length} missed ${results.missed.length === 1 ? 'item' : 'items'}</button>` : ''}${!state.practiceDiagnosisBusy ? `<button type="button" data-command="diagnoseTutorPractice">Show diagnostics (${results.attempted} ${results.attempted === 1 ? 'item' : 'items'})</button>` : ''}</div></section>`;
}

function tutorReviewCorrectionGroups(
  corrections: readonly TrainingReviewCorrection[]
): TrainingReviewCorrection[][] {
  const spelling = corrections.filter((correction) =>
    isTrainingReviewCorrectionCategory(correction.category) &&
    correction.category === 'spelling'
  );
  let spellingAdded = false;
  const groups: TrainingReviewCorrection[][] = [];
  for (const correction of corrections) {
    if (correction.category === 'spelling') {
      if (!spellingAdded) groups.push(spelling);
      spellingAdded = true;
    } else {
      groups.push([correction]);
    }
  }
  return groups;
}

/**
 * Marks replacements only when the correction objects identify unambiguous ranges.
 * correctedText is never diffed against learnerText. A missing, repeated, or overlapping
 * replacement makes the whole sentence plain because choosing one occurrence would guess.
 */
export function tutorCorrectedSentenceMarkup(
  review: TrainingReview,
  tag: 'strong' | 'span' = 'strong',
  knownRanges?: readonly { start: number; end: number }[]
): string {
  if (!review.correctedText) return '';
  const ranges: Array<{ start: number; end: number }> = [...(knownRanges ?? [])];
  for (const correction of knownRanges ? [] : review.incorrect) {
    if (!correction.corrected) continue;
    const start = review.correctedText.indexOf(correction.corrected);
    if (start === -1 || review.correctedText.indexOf(correction.corrected, start + 1) !== -1) {
      return escapeHtml(review.correctedText);
    }
    ranges.push({ start, end: start + correction.corrected.length });
  }
  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  if (ranges.some((range, index) => index > 0 && range.start < ranges[index - 1]!.end)) {
    return escapeHtml(review.correctedText);
  }

  let cursor = 0;
  let markup = '';
  for (const range of ranges) {
    markup += escapeHtml(review.correctedText.slice(cursor, range.start));
    markup += `<${tag} class="tutor-review-corrected">${escapeHtml(
      review.correctedText.slice(range.start, range.end)
    )}</${tag}>`;
    cursor = range.end;
  }
  return markup + escapeHtml(review.correctedText.slice(cursor));
}

function tutorReviewWrongMarkup(group: readonly TrainingReviewCorrection[]): string {
  if (group.length === 1) {
    const span = group[0]!;
    return `<p class="tutor-review-mark incorrect"><strong>Not quite.</strong> You wrote: &quot;<span class="tutor-review-wrong">${escapeHtml(span.excerpt)}</span>&quot;. ${escapeHtml(span.reason)}</p>`;
  }
  const details = group.map((span) =>
    `You wrote: &quot;<span class="tutor-review-wrong">${escapeHtml(span.excerpt)}</span>&quot;. ${escapeHtml(span.reason)}`
  ).join('; ');
  return `<p class="tutor-review-mark incorrect"><strong>Not quite.</strong> ${details}</p>`;
}

/** Apply only unambiguous, nonoverlapping corrections against the original answer. */
function tutorReviewCorrectedText(review: TrainingReview, prompt: string): {
  text: string; ranges?: Array<{ start: number; end: number }>;
} | undefined {
  let corrected = review.correctedText?.trim();
  let placed: Array<{ start: number; end: number }> | undefined;
  if (!corrected) {
    const ranges: Array<{ start: number; end: number; corrected: string }> = [];
    for (const correction of review.incorrect) {
      if (!correction.excerpt || !correction.corrected) return undefined;
      const start = review.learnerText.indexOf(correction.excerpt);
      if (start < 0 || review.learnerText.indexOf(correction.excerpt, start + 1) >= 0) return undefined;
      ranges.push({ start, end: start + correction.excerpt.length, corrected: correction.corrected });
    }
    ranges.sort((left, right) => left.start - right.start);
    if (ranges.some((range, index) => index > 0 && range.start < ranges[index - 1]!.end)) return undefined;
    corrected = '';
    placed = [];
    let cursor = 0;
    for (const range of ranges) {
      corrected += review.learnerText.slice(cursor, range.start);
      placed.push({ start: corrected.length, end: corrected.length + range.corrected.length });
      corrected += range.corrected;
      cursor = range.end;
    }
    corrected += review.learnerText.slice(cursor);
  }
  const blanks = prompt.match(/_{3,}/gu);
  if (blanks) {
    // 2026-10-14: V239, classify reconstructed answers as well as supplied corrections.
    const context = prompt.split(/_{3,}/u);
    const before = context[0]!.trim();
    const after = context.at(-1)!.trim();
    const comparable = (text: string) => text.trim().replace(/[.!?]$/u, '').trim().toLocaleLowerCase('en-US');
    const comparableText = comparable(corrected);
    const comparableBefore = comparable(before);
    const comparableAfter = comparable(after);
    const complete = /\s/u.test(corrected) && (/[.!?]$/u.test(corrected) ||
      Boolean((comparableBefore || comparableAfter) && comparableText.startsWith(comparableBefore) && comparableText.endsWith(comparableAfter)));
    if (complete && (blanks.length === 1 || review.correctedText?.trim())) return { text: corrected, ranges: placed };
    if (blanks.length !== 1) return undefined;
    // Capitalized or subject-like clauses, punctuation, or partial context are uncertain.
    if (!corrected.trim() || /[.!?]/u.test(corrected) ||
        (/\s/u.test(corrected) && (/^\p{Lu}/u.test(corrected) ||
          /^(?:i|you|he|she|it|we|they|the|a|an|this|that|these|those)\s/iu.test(corrected) ||
          Boolean(comparableBefore && comparableText.includes(comparableBefore)) ||
          Boolean(comparableAfter && comparableText.includes(comparableAfter))))) return undefined;
    const offset = prompt.indexOf(blanks[0]!);
    return { text: prompt.replace(/_{3,}/u, () => corrected!), ranges: placed?.map(range => ({ start: range.start + offset, end: range.end + offset })) };
  }
  return corrected.trim() && (!review.incorrect.length || /\s/u.test(corrected) || /[.!?]$/u.test(corrected))
    ? { text: corrected, ranges: placed } : undefined;
}

function renderTutorReviewCorrections(review: TutorPracticeReview, prompt: string): string {
  const sentence = tutorReviewCorrectedText(review, prompt);
  const focus = typeof review.focusPhrase === 'string' ? review.focusPhrase.trim() : '';
  const focusAt = focus && sentence ? sentence.text.indexOf(focus) : -1;
  const validFocus = focusAt >= 0;
  const correctedSentence = sentence ? validFocus
    ? `${escapeHtml(sentence.text.slice(0, focusAt))}<strong class="${review.incorrect.length ? 'tutor-review-wrong' : 'tutor-review-correct'}">${escapeHtml(focus)}</strong>${escapeHtml(sentence.text.slice(focusAt + focus.length))}`
    : tutorCorrectedSentenceMarkup({ ...review, correctedText: sentence.text },
      sentence.ranges ? 'span' : 'strong', sentence.ranges) : '';
  const groups = tutorReviewCorrectionGroups(review.incorrect).map((group) => {
    const correction = group.length === 1
      ? `<span class="tutor-review-corrected">${escapeHtml(group[0]!.corrected)}</span>`
      : group.map((span) =>
          `<span class="tutor-review-corrected">${escapeHtml(span.corrected)}</span>`
        ).join(', ');
    const represented = sentence && group.every(span => span.corrected && sentence.text.includes(span.corrected));
    return `${tutorReviewWrongMarkup(group)}${represented ? '' : `<p class="tutor-review-correction">${correction}</p>`}`;
  }).join('');
  const answerAlreadyShown = !review.incorrect.length && sentence &&
    review.correct.some(span => span.excerpt.trim() === sentence.text.trim());
  return groups + (correctedSentence && (validFocus || !answerAlreadyShown) ? `<p class="tutor-review-correction">${correctedSentence}</p>` : '');
}

export function renderTutorExercises(
  state: TutorViewState,
  speechProvider: TutorSpeechProvider = 'auto',
  geminiKeyConfigured = false,
  cloudflareConfigured = false,
  groqConfigured = false
): string {
  if (!state.exerciseSet) return '';
  const results = tutorPracticeResults(state);
  const exercises = tutorVisibleExercises(state);
  const count = exercises.length;
  const index = Math.min(Math.max(state.currentExerciseIndex, 0), Math.max(count - 1, 0));
  const exercise = exercises[index];
  const exerciseMarkup = exercise ? (() => {
    const busy = tutorPracticeReviewBusy(state);
    const eligibility = tutorPracticeReviewEligibility(state);
    const reviewAll = index === count - 1;
    const firstOtherUnanswered = state.exerciseSet!.exercises.findIndex((item) => item.id !== exercise.id && !state.answers[item.id]?.trim());
    const answer = state.answers[exercise.id] ?? '';
    const review = state.reviews[exercise.id];
    const explanationBusy = state.exerciseHintBusyIds.includes(exercise.id);
    const hint = state.exerciseHints[exercise.id];
    const explanation = exercise.taskLine?.trim();
    const hintFailure = state.exerciseHintFailures[exercise.id];
    const explanationMarkup = (review && explanation) || explanationBusy || hint || hintFailure
      ? `<div class="tutor-question-explanation" aria-label="What this question asks"${explanationBusy ? ' role="status"' : ''}>${explanationBusy
          ? 'Explaining what this question asks. Please wait.'
          : hint
            ? `<p data-tutor-hint-explanation>${escapeHtml(hint.explanation)}</p><p data-tutor-hint-example><strong>Example:</strong> ${escapeHtml(hint.example)}</p>`
            : hintFailure
              ? `<p class="tutor-failure">${escapeHtml(hintFailure)}</p>`
               : escapeHtml(explanation!)}</div>`
      : '';
    const reviewMarkup = review ? `<div aria-label="Review of exercise ${index + 1}"><div class="tutor-section-heading"><h4 class="tutor-section-badge tutor-review-details-heading">REVIEW</h4><span class="tutor-section-divider" aria-hidden="true"></span></div>${review.correct.map((span) => `<p class="tutor-review-mark"><strong class="tutor-review-correct">Correct.</strong> &quot;${escapeHtml(span.excerpt)}&quot;. ${escapeHtml(span.reason)}</p>`).join('')}${renderTutorReviewCorrections(review, exercise.prompt)}</div>` : '';
    const reviewDisabled = busy || eligibility.firstUnansweredIndex >= 0 || !eligibility.pending.length;
    const reviewFailure = state.reviewFailures[exercise.id];
    const retryBusy = state.reviewBusyIds.includes(exercise.id);
    const failureMarkup = reviewFailure ? `<p class="tutor-failure">${escapeHtml(reviewFailure)} <button type="button" data-command="reviewTutorExercise" data-tutor-review-retry data-tutor-exercise="${escapeHtml(exercise.id)}" aria-busy="${retryBusy}" aria-disabled="${busy || !answer.trim()}"${busy || !answer.trim() ? ' disabled' : ''}>${retryBusy ? 'Retrying...' : 'Retry'}</button><span data-tutor-review-retry-empty${answer.trim() ? ' hidden' : ''}> Enter an answer to retry.</span></p>` : '';
    const reviewAction = state.practiceReviewBatch
      ? `<button type="button" class="secondary" data-command="cancelTutorReviewBatch">Cancel review</button>`
      : state.reviewBusyIds.includes(exercise.id)
      ? `<button type="button" class="secondary" data-command="cancelTutorReview" data-tutor-exercise="${escapeHtml(exercise.id)}">Cancel review</button>`
      : reviewAll ? `<button type="button" data-command="reviewUnreviewedTutorExercises" data-tutor-exercise="${escapeHtml(exercise.id)}" data-review-all="true" data-pending-other="${eligibility.pending.some((item) => item.id !== exercise.id)}" data-reviewed-answer="${escapeHtml(review?.learnerText ?? '')}" data-first-unanswered-other="${firstOtherUnanswered < 0 ? -1 : firstOtherUnanswered + 1}" aria-disabled="${reviewDisabled}" title="${eligibility.firstUnansweredIndex >= 0 ? `Answer item ${eligibility.firstUnansweredIndex + 1} first` : eligibility.pending.length === 0 ? 'All current answers are reviewed. Edit an answer to enable Review all' : 'Review all answers without current reviews'}"${reviewDisabled ? ' disabled' : ''}>Review all</button>` : '';
    /*
     * Hint sits beside Review and is enabled from the start, which is the point: it is for a
     * reader who cannot begin. It stops at the review, because the explanation and the answer
     * are then already on screen and a hint has nothing left to give. Ask needs something to ask about, so it waits for the review.
     * The microphone remains rendered when unavailable so repeated item rows keep their shape.
     */
    const route = resolveTutorSpeechRoute(
      speechProvider,
      state.speech.handyStatus,
      geminiKeyConfigured, cloudflareConfigured, groqConfigured
    );
    const dictating = state.speech.dictatingExerciseId === exercise.id;
    const transcribing = state.speech.transcribingExerciseId === exercise.id;
    const activeProvider = state.speech.dictationProvider ?? route.provider;
    const providerName = activeProvider === 'gemini' ? 'Gemini' : activeProvider === 'cloudflare' ? 'Cloudflare' : activeProvider === 'groq' ? 'Groq' : 'Handy';
    const handyListening = dictating && activeProvider === 'handy';
    const handyLabel = `${dictating ? 'Pause' : 'Start'} Handy dictation`;
    const speechUnavailable = transcribing ? `${providerName} is transcribing the recording.` : dictating ? undefined : route.reason;
    const microphoneTitle = dictating
      ? handyListening ? handyLabel : `Press again to stop ${providerName} dictation`
      : speechUnavailable ?? (activeProvider === 'handy' ? handyLabel : `Speak your answer with ${providerName}`);
    const microphoneLabel = dictating
      ? handyListening ? handyLabel : `Stop speaking your answer with ${providerName}`
      : speechUnavailable ?? (activeProvider === 'handy' ? handyLabel : `Speak your answer with ${providerName}`);
    const leftActions = `${reviewAction}${iconButton(
      'hintTutorExercise', `data-tutor-exercise="${escapeHtml(exercise.id)}"`, 'Hint', 'Hint', 'hint',
      state.exerciseHintBusyIds.includes(exercise.id) || busy || Boolean(review), false,
      'icon-button tutor-action-icon')}${iconButton(
      'openTutorPracticeAsk', `data-tutor-exercise="${escapeHtml(exercise.id)}"`, 'Ask', 'Ask about this practice item', 'ask',
      !review || busy, false, 'icon-button tutor-action-icon')}${iconButton(
      'playTutorExercise', `data-tutor-exercise="${escapeHtml(exercise.id)}"`, 'Play', 'Read this question aloud', 'speaker',
      busy, false, 'icon-button tutor-action-icon')}${iconButton(
      'dictateTutorExercise', `data-tutor-exercise="${escapeHtml(exercise.id)}" data-tutor-dictation-provider="${activeProvider ?? ''}" aria-pressed="${dictating ? 'true' : 'false'}"`, microphoneTitle, microphoneLabel, handyListening ? 'pause' : 'microphone',
      Boolean(speechUnavailable) || busy || transcribing, false, `icon-button tutor-action-icon${dictating ? ' tutor-dictation-active tutor-microphone-pulsing' : ''}`)}${transcribing ? `<span class="tutor-action-status" data-tutor-transcription-status role="status">${providerName} is transcribing the recording.</span>` : ''}`;
    const navigation = `<div class="tutor-exercise-navigation">${iconButton(
          'showPreviousTutorExercise',
          '',
          'Back',
          'Go to the previous practice item',
          'back',
           busy || index === 0,
           false,
           'icon-button tutor-action-icon',
           busy || index === 0 ? ' aria-disabled="true"' : ''
         )}<span class="tutor-exercise-position" aria-live="polite">${index + 1} / ${count}</span>${iconButton(
          'showNextTutorExercise',
          '',
          'Next',
          'Go to the next practice item',
          'back',
           (!review && !answer.trim()) || busy || (index === count - 1 && !results),
           false,
           'icon-button tutor-action-icon tutor-next-icon',
           (!review && !answer.trim()) || busy || (index === count - 1 && !results) ? ' aria-disabled="true"' : ''
         )}</div>`;
    return `<article class="tutor-lesson tutor-practice-panel" aria-label="Practice item ${index + 1}" data-review-busy="${busy}" data-item-number="${index + 1}" data-item-reviewed="${Boolean(review)}" data-reviewed-answer="${escapeHtml(review?.learnerText ?? '')}" data-next-destination="${index < count - 1 || Boolean(results)}"><div class="tutor-exercise${busy ? ' tutor-item-busy' : ''}"${busy ? ' aria-busy="true"' : ''}><h3 class="tutor-item-heading">${index + 1}. ${escapeHtml(exercise.prompt)}</h3><textarea class="tutor-answer" data-tutor-answer data-tutor-exercise="${escapeHtml(exercise.id)}" aria-label="Answer to exercise ${index + 1}"${state.practiceReviewBatch ? ' disabled' : ''}>${escapeHtml(answer)}</textarea></div><div class="tutor-exercise-controls"><div class="tutor-item-actions">${leftActions}</div>${navigation}</div>${explanationMarkup}${failureMarkup}${reviewMarkup}${review ? `<p class="model-note${review.learnerText === answer.trim() ? ' hidden' : ''}" data-tutor-review-outdated>Review out of date. Review all again after answering every item.</p>` : ''}</article>`;
  })() : '';
  const resultsVisible = Boolean(results && state.practiceResultsOpened &&
    !state.practiceMissedOnly && !state.practiceReviewAll);
  const reviewHeading = state.practiceMissedOnly || state.practiceReviewAll
    ? `<p>${state.practiceMissedOnly ? 'Review missed items' : 'Review again'}: ${count}${state.practiceMissedOnly ? ' missed' : ''} ${count === 1 ? 'item' : 'items'}.</p>`
    : '';
  const output = resultsVisible && results
    ? renderTutorPracticeResults(state, results)
    : `${state.practiceReviewBatch ? `<p role="status">Reviewing item ${state.practiceReviewBatch.completed + 1} of ${state.practiceReviewBatch.total}.</p>` : state.practiceReviewBatchMessage ? `<p role="status">${escapeHtml(state.practiceReviewBatchMessage)}</p>` : ''}${reviewHeading}${exerciseMarkup}`;
  const diagnosis = state.practiceDiagnosisBusy
    ? '<p role="status">Diagnosing your practice. Your results are ready.</p><button type="button" class="secondary" data-command="cancelTutorPracticeDiagnosis">Cancel diagnosis</button>'
    : state.practiceDiagnosisMessage ? `<p role="status">${escapeHtml(state.practiceDiagnosisMessage)}</p>` : '';
  return `<div class="tutor-exercises" data-tutor-result="exercises" role="region" aria-label="Practice exercises"><h2>PRACTICE</h2><p>Fill in a blank, choose the right word, or write a phrase or sentence of your own.</p>${output}${diagnosis}</div>`;
}

export function renderTutorConversationReview(state: TutorViewState, takeHomeEnabled: boolean): string {
  const c = state.conversation;
  if (c.status !== 'stopped') return '';
  const { answered, remaining } = tutorConversationReviewProgress(c);
  const available = c.demoMode ? c.demoLines.some(line => line.text.trim()) : answered > 0;
  const ready = Boolean(c.takeHome?.card && !c.takeHome.canceled);
  const review = takeHomeEnabled && !ready;
  const busy = Boolean(c.busy || c.takeHome?.busy);
  const disabled = busy || (!review && remaining > 0);
  const title = !review && remaining > 0 ? 'Needs five answered turns.' : busy ? 'Wait for the current request to finish.' : '';
  return `<button type="button" data-tutor-review-action data-review-ready="${ready}" data-review-available="${available}" data-review-busy="${busy}" data-review-answered="${answered}" data-command="${review ? 'reviewTutorConversation' : 'diagnoseTutorConversation'}"${review && !available ? ' hidden' : ''}${disabled ? ' disabled' : ''}${title ? ` title="${escapeHtml(title)}"` : ''}>${review ? 'Review now' : 'More details'}</button>`;
}

function tutorConversationSituation(state: TutorViewState): string {
  const conversation = state.conversation;
  if (conversation.situationId === 'auto') return 'Let KREN choose';
  if (conversation.from === 'anything') return 'Anything';
  return conversation.situationId === 'custom' ? conversation.customSituation || 'My own situation'
    : findTutorSituation(conversation.situationId)?.label ?? 'Choose a situation';
}

export function renderTutorTakeHome(conversation: TutorViewState['conversation']): string {
  const state = conversation.takeHome;
  if (!state || state.hidden) return '';
  const card = state.card;
  const targets = (card?.learningTargets ?? []).flatMap(target => {
    const node = findTrainingMapNode(target.targetId);
    return node ? [`<li><strong>${escapeHtml(node.label)}</strong>: ${escapeHtml(target.why)}</li>`] : [];
  });
  const naturally = card?.naturally.length ? `<h3>Say it naturally</h3>${card.naturally.map(entry =>
    `<div class="tutor-take-home-natural"><p class="tutor-take-home-explanation"><q>${escapeHtml(entry.quote)}</q></p><ul>${entry.alternatives.map(text =>
      `<li><q>${escapeHtml(text)}</q></li>`).join('')}</ul><p>${escapeHtml(entry.why)}</p></div>`).join('')}` : '';
  const learningTargets = targets.length ? `<div class="tutor-take-home-learning-targets"><h3>Learning targets</h3><ul>${targets.join('')}</ul></div>` : '';
  return `<section class="tutor-take-home" aria-label="Take-home card"><h2>TAKE-HOME</h2>${conversation.demoMode ? '<p>Demo take-home: these are scripted examples, not your own speech.</p>' : ''}${state.busy ? '<p role="status">Preparing your take-home card.</p>' : ''}${card ? `${naturally}${learningTargets}${card.pattern ? `<h3>Pattern to keep: ${escapeHtml(card.pattern.name)}</h3><p>${card.pattern.examples.map((text) => `<q>${escapeHtml(text)}</q>`).join(' &middot; ')}</p>` : ''}${card.doneWell.length ? `<h3>Done well</h3>${card.doneWell.map((entry) => `<p><q>${escapeHtml(entry.quote)}</q> (${escapeHtml(entry.note)})</p>`).join('')}` : ''}<h3>Try next time</h3><p>${escapeHtml(card.tryNext)}</p>` : ''}${state.failure ? `<p role="status">${escapeHtml(state.failure)}</p><button type="button" data-command="retryTutorTakeHome">Retry</button>` : ''}${state.speechFailure ? `<p role="status">${escapeHtml(state.speechFailure)}</p>` : ''}<button type="button" class="secondary" data-command="cancelTutorTakeHome">Cancel</button></section>`;
}

export function renderTutorConversation(
  state: TutorViewState,
  speechProvider: TutorSpeechProvider = 'auto',
  geminiKeyConfigured = false,
  tutorLiveReplayAvailable = false,
  tutorLiveTalkAvailable = false,
  tutorLiveTalkListening = false,
  tutorLivePressToTalk = false,
  tutorConversationReplayAvailable = false,
  tutorConversationHintTurnGeneration?: number,
  tutorConversationMicrophoneSensitivity: TutorMicrophoneSensitivity = TUTOR_DEFAULTS.configuration['tutor.conversation.microphoneSensitivity'],
  tutorConversationPressToTalkSetting: boolean = TUTOR_DEFAULTS.configuration['tutor.conversation.pressToTalk'],
  tutorConversationMicrophoneCloseWait: number = TUTOR_DEFAULTS.configuration['tutor.conversation.microphoneCloseWait'],
  tutorConversationScene?: string,
  tutorConversationPicture?: string | string[],
  tutorDemoAvailable = true,
  tutorConversationStopDisabled?: boolean,
  tutorConversationStopTitle?: string,
  tutorConversationPictureTurns: number[] = [],
  tutorConversationPauseBeforeReply: TutorPauseBeforeReply = TUTOR_DEFAULTS.configuration['tutor.conversation.pauseBeforeReply'],
  tutorConversationSpeechDetection: TutorSpeechDetection = TUTOR_DEFAULTS.configuration['tutor.conversation.speechDetection'],
  tutorConversationLiveTranscriptionLanguage: 'english' | 'automatic' = TUTOR_DEFAULTS.configuration['tutor.conversation.liveTranscriptionLanguage'],
  cloudflareConfigured = false,
  tutorConversationTakeHome: boolean = TUTOR_DEFAULTS.configuration['tutor.conversation.takeHome'],
  tutorConversationPictureStyle: 'realistic' | 'illustrated' = TUTOR_DEFAULTS.configuration['tutor.conversation.pictureStyle'],
  groqConfigured = false,
  tutorConversationHintPrefetch = false,
  tutorLiveFailed = false,
  tutorDemoMissingKey = 'Set the Gemini Free Tier key to run Demo.'
): string {
  const pauseBeforeReply = isTutorPauseBeforeReply(tutorConversationPauseBeforeReply)
    ? tutorConversationPauseBeforeReply : TUTOR_DEFAULTS.configuration['tutor.conversation.pauseBeforeReply'];
  const speechDetection = isTutorSpeechDetection(tutorConversationSpeechDetection) ? tutorConversationSpeechDetection : TUTOR_DEFAULTS.configuration['tutor.conversation.speechDetection'];
  const speechDetectionLabel = speechDetection === 'geminiKren' ? 'Gemini + KREN' : 'KREN';
  const pauseBeforeReplyLabel = `${pauseBeforeReply} ${pauseBeforeReply === 1 ? 'second' : 'seconds'}`;
  const conversation = state.conversation;
  const count = conversation.transcript.length;
  const coach = conversation.from === 'speakAndRephrase';
  const active = conversation.status === 'active';
  const demo = conversation.demoMode;
  const option = (value: string, label: string, selected: string) => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  const groups = tutorSituationGroups().map((group) => `<optgroup label="${escapeHtml(group)}">${TUTOR_SITUATIONS.filter((entry) => entry.group === group).map((entry) => option(entry.id, entry.label, conversation.situationId)).join('')}</optgroup>`).join('');
  const situation = conversation.situationId === 'custom' ? tutorCustomSituation(conversation.customSituation) : findTutorSituation(conversation.situationId);
  const readiness = tutorLessonConversationReadiness(state);
  const lessonStartBlocked = conversation.status === 'idle' && conversation.from === 'lesson' && !readiness.ready;
  const startReason = lessonStartBlocked ? TUTOR_LESSON_UNAVAILABLE : !coach && conversation.from !== 'anything' && conversation.situationId !== 'auto' && !situation ? 'Write your situation first.' : undefined;
  const disabled = (value: boolean) => value ? ' disabled' : '';
  const settingRow = (title: string, description: string, control: string) => {
    const unused = coach && ['Situation', 'Swap roles', 'Who starts', 'Correction', 'Reply length', 'Situation picture', 'Picture style', 'Picture transparency'].includes(title);
    if (unused) control = control.replace(/\sdisabled\b/gu, '').replace(/<(select|input)\b/u, '<$1 disabled');
    return `<label class="setting"${unused ? ' data-tutor-coach-unused' : ''}><span><span class="setting-title">${escapeHtml(title)}</span><span class="setting-description">${escapeHtml(unused ? 'Not used in Speak and rephrase.' : description)}</span></span>${control}</label>`;
  };
  const sourceLabel = conversation.from === 'situation' ? 'A situation'
    : conversation.from === 'lesson' ? 'The lesson' : coach ? 'Speak and rephrase' : 'Anything';
  const coachingLabels: Record<string, string> = {
    inline: 'As you go', afterwards: 'When you stop', teaching: 'KREN corrects as it replies'
  };
  const replyLengthLabels = {
    brief: 'Brief', short: 'Short', medium: 'Medium', long: 'Long'
  } as const;
  const liveReplies = conversation.replies === 'liveGemini';
  const standardControlsPending = !demo && !liveReplies && Boolean(conversation.busy || conversation.openingReveal || conversation.speechReveal);
  const repliesLabels: Record<string, string> = {
    standard: 'Standard', liveGemini: 'Live (Gemini)'
  };
  const modeSummary = settingsSummary([
    ['Source', sourceLabel, false],
    ['Situation', !coach && conversation.from !== 'anything' ? tutorConversationSituation(state) : 'Not used', false],
    ['Roles', coach ? 'Not used' : conversation.rolesSwapped ? 'Swapped' : 'Usual', false],
    ['Who starts', coach || conversation.starts !== 'learner' ? 'KREN starts' : 'I start', false],
    ['Register', tutorValueLabel(conversation.register), false],
    ['Correction', coach ? 'Every turn' : coachingLabels[conversation.coaching] ?? coachingLabels.inline!, false]
  ]) + ' | Sends when you stop' + settingsSummary([
    ['Reply', repliesLabels[conversation.replies] ?? repliesLabels.standard!, false],
    ['Picture', ({ none: 'None', intro: 'Intro Only', switching: 'Switching', graduallyEntering: 'Gradually Entering' })[conversation.situationPicture], false]
  ]).replace(/^/u, ' | ');
  const microphoneSensitivityLabels: Record<TutorMicrophoneSensitivity, string> = {
    quietRoom: 'Quiet room', balanced: 'Balanced', noisyRoom: 'Noisy room'
  };
  const advancedSummary = tutorConversationAdvancedSummary({
    send: 'When I stop speaking',
    replies: repliesLabels[conversation.replies] ?? repliesLabels.standard!,
    pictureTransparency: `${conversation.pictureTransparency}%`,
    balloonTransparency: `${conversation.balloonTransparency}%`,
    microphoneSensitivity: microphoneSensitivityLabels[tutorConversationMicrophoneSensitivity],
    pauseBeforeReply: pauseBeforeReplyLabel,
    speechDetection: speechDetectionLabel,
    microphoneCloseWait: `${tutorConversationMicrophoneCloseWait} seconds`,
    liveTranscriptionLanguage: tutorConversationLiveTranscriptionLanguage === 'automatic' ? 'Automatic' : 'English',
    pressToTalk: tutorConversationPressToTalkSetting ? 'On' : 'Off',
    pictureStyle: tutorConversationPictureStyle === 'illustrated' ? 'Illustrated' : 'Realistic',
    takeHome: tutorConversationTakeHome ? 'On' : 'Off'
  });
  const customSituationField = !coach && conversation.situationId === 'custom'
    ? `<label class="tutor-conversation-custom"><span class="setting-title">My own situation</span><textarea data-tutor-conversation-custom${disabled(active || conversation.from === 'anything')}>${escapeHtml(conversation.customSituation)}</textarea></label>`
    : '';
  const nextConversationReason = 'A change applies from the next Start or Back to chat.';
  const advancedFields = `${selectSetting(
      'Live transcription language',
      'Which language Live expects to hear. Automatic restores provider language detection.',
      'tutor.conversation.liveTranscriptionLanguage',
      tutorConversationLiveTranscriptionLanguage,
      [['english', 'English'], ['automatic', 'Automatic']]
    )}${settingRow('Reply length', 'How many sentences KREN uses. In Live, a change applies from the next conversation.', `<select data-tutor-conversation-reply-length>${option('brief', replyLengthLabels.brief, conversation.replyLength)}${option('short', replyLengthLabels.short, conversation.replyLength)}${option('medium', replyLengthLabels.medium, conversation.replyLength)}${option('long', replyLengthLabels.long, conversation.replyLength)}</select>`)}${settingRow('Picture style', 'How situation pictures look.', `<select data-setting="tutor.conversation.pictureStyle"${conversation.situationPicture === 'none' ? ' disabled title="Choose a Situation picture mode to enable Picture style"' : ''}>${option('realistic', 'Realistic', tutorConversationPictureStyle)}${option('illustrated', 'Illustrated', tutorConversationPictureStyle)}</select>`)}${settingRow('Picture transparency', 'How much the conversation shows through the picture.', `<select data-tutor-conversation-picture-transparency${disabled(conversation.situationPicture === 'none')}>${['0', '20', '40', '60', '80'].map((value) => option(value, `${value}%`, conversation.pictureTransparency)).join('')}</select>`)}${settingRow('Balloon transparency', 'How much of the picture shows through the chat balloons.', `<select data-tutor-conversation-balloon-transparency${disabled(conversation.situationPicture === 'none')}>${['0', '10', '20', '30', '40', '50'].map((value) => option(value, `${value}%`, conversation.balloonTransparency)).join('')}</select>`)}${selectSetting(
    'Microphone sensitivity',
    `How readily the microphone treats sound as speech, from the next conversation.`,
    'tutor.conversation.microphoneSensitivity',
    tutorConversationMicrophoneSensitivity,
    [['quietRoom', 'Quiet room'], ['balanced', 'Balanced'], ['noisyRoom', 'Noisy room']]
  )}${selectSetting(
    'Pause before reply',
    'How long you can pause before KREN treats your turn as finished, in hands-free Live, from the next conversation.',
    'tutor.conversation.pauseBeforeReply',
    String(pauseBeforeReply),
    [['1', '1 second'], ['2', '2 seconds'], ['3', '3 seconds'], ['4', '4 seconds'], ['5', '5 seconds']]
  )}${settingRow(
    'Speech detection',
    'Who decides when you start speaking in hands-free Live, from the next conversation.',
    `<select data-setting="tutor.conversation.speechDetection"${tutorConversationPressToTalkSetting ? ' disabled title="Press to talk uses KREN detection."' : ''}>${option('kren', 'KREN', speechDetection)}${option('geminiKren', 'Gemini + KREN', speechDetection)}</select>`
  )}${selectSetting(
    'Microphone close wait',
    'How long to wait for Windows to release the microphone after stop; longer waits may keep its light on briefly.',
    'tutor.conversation.microphoneCloseWait',
    String(tutorConversationMicrophoneCloseWait),
    [['2', '2 seconds'], ['4', '4 seconds'], ['6', '6 seconds'], ['8', '8 seconds']]
  )}${toggleSetting(
    'Press to talk',
    `Press the microphone once to start a Live turn and again to finish it, from the next conversation.`,
    'tutor.conversation.pressToTalk',
    tutorConversationPressToTalkSetting
  )}${toggleSetting('Prepare hints in advance', 'Prepares each hint while you think, so it opens instantly. Uses one extra request per turn.', 'tutor.conversation.hintPrefetch', tutorConversationHintPrefetch).replace('<label ', coach ? '<label hidden ' : '<label ')}${toggleSetting('Take-home card', 'Prepare a TAKE-HOME card with Review now.', 'tutor.conversation.takeHome', tutorConversationTakeHome)}`;
  const advanced = settingsFoldable({
    label: 'ADVANCED',
    summary: advancedSummary,
    fields: advancedFields,
    detailsAttributes: 'data-tutor-conversation-advanced data-persist-id="tutor-conversation-advanced"',
    open: false
  });
  const customSituationGroup = `<optgroup label="Your own">${option('custom', 'My own situation', conversation.situationId)}</optgroup>`;
  const roleToggle = settingRow(
    'Swap roles',
    'Play the counterpart while KREN plays the side described as you in the situation.',
    `<span class="switch"><input type="checkbox" data-tutor-conversation-role-swapped${conversation.rolesSwapped ? ' checked' : ''}${disabled(active || conversation.from === 'anything')}><span class="slider"></span></span>`
  );
  const startsSelect = settingRow(
    'Who starts',
    'Who supplies the first in-character turn after KREN reads the scene.',
    `<select data-tutor-conversation-starts${disabled(active)}>${option('kren', 'KREN starts', conversation.starts)}${option('learner', 'I start', conversation.starts)}</select>`
  );
  const modeFields = `<div class="tutor-conversation-settings">${settingRow('Source', conversation.from === 'lesson' && !readiness.ready ? TUTOR_LESSON_UNAVAILABLE : 'Where the conversation takes its subject.', `<select data-tutor-conversation-from data-tutor-lesson-ready="${readiness.ready}"${disabled(active)}>${option('situation', 'A situation', conversation.from)}<option value="lesson"${conversation.from === 'lesson' ? ' selected' : ''}>The lesson</option>${option('anything', 'Anything', conversation.from)}${option('speakAndRephrase', 'Speak and rephrase', conversation.from)}</select>`)}${settingRow('Situation', 'The place or occasion you are practicing for.', `<select data-tutor-conversation-situation${disabled(active || conversation.from === 'anything')}>${option('auto', 'Let KREN choose', conversation.situationId)}${groups}${customSituationGroup}</select>`)}${roleToggle}${startsSelect}${customSituationField}${settingRow('Register', `How formal the exchange should be, from the next conversation.`, `<select data-tutor-conversation-register${disabled(active && !coach)}>${option('casual', 'Casual', conversation.register)}${option('neutral', 'Neutral', conversation.register)}${option('professional', 'Professional', conversation.register)}${option('formal', 'Formal', conversation.register)}</select>`)}${settingRow('Correction', `Corrections arrive at Stop by default. As you go costs one request per Live turn; changes apply from the next conversation.`, `<select data-tutor-conversation-coaching${disabled(active)}>${option('inline', coachingLabels.inline!, conversation.coaching)}${option('afterwards', coachingLabels.afterwards!, conversation.coaching)}${option('teaching', coachingLabels.teaching!, conversation.coaching)}</select>`)}${settingRow('Replies', `Whether Gemini speaks with you live, from the next conversation.`, `<select data-tutor-conversation-replies${disabled(active && !coach)}>${option('standard', repliesLabels.standard!, conversation.replies)}${option('liveGemini', repliesLabels.liveGemini!, conversation.replies)}</select>`)}${settingRow('Situation picture', 'A picture of the scene behind the conversation, made by the chosen picture provider.', `<select data-tutor-conversation-situation-picture>${option('none', 'None', conversation.situationPicture)}${option('intro', 'Intro Only', conversation.situationPicture)}${option('switching', 'Switching', conversation.situationPicture)}${option('graduallyEntering', 'Gradually Entering', conversation.situationPicture)}</select>`)}${advanced}</div>`;
  const setup = `<div class="tutor-conversation-setup" data-tutor-conversation-setup${conversation.openModeAfterRender === true ? ' data-focus-after-render="true"' : ''}>${settingsFoldable({
    label: 'MODE',
    summary: modeSummary,
    fields: modeFields,
    detailsAttributes: `data-persist-id="tutor-conversation-mode"${conversation.openModeAfterRender === true ? ' data-force-open="true"' : conversation.openModeAfterRender === false ? ' data-force-closed="true"' : ''}`,
    open: conversation.openModeAfterRender === true
  })}</div>`;
  const speakerAction = conversation.speakerOn ? 'Turn speaker off' : 'Turn speaker on';
  const speaker = iconButton(
    'toggleTutorConversationSpeaker',
    `aria-pressed="${conversation.speakerOn}"`,
    speakerAction,
    speakerAction,
    conversation.speakerOn ? 'speaker' : 'speakerOff',
    false,
    false,
    'icon-button tutor-action-icon'
  );
  const route = resolveTutorSpeechRoute(
    speechProvider,
    state.speech.handyStatus,
    geminiKeyConfigured, cloudflareConfigured, groqConfigured
  );
  const dictating = state.speech.dictatingConversation === true;
  const transcribing = state.speech.transcribingConversation === true;
  const transcriptionRunning = transcribing ||
    state.speech.transcribingExerciseId !== undefined;
  const activeProvider = state.speech.dictationProvider ?? route.provider;
  const providerName = activeProvider === 'gemini' ? 'Gemini' : activeProvider === 'cloudflare' ? 'Cloudflare' : activeProvider === 'groq' ? 'Groq' : 'Handy';
  const liveTalkMode = conversation.replies === 'liveGemini' && tutorLiveTalkAvailable;
  const handyListening = !liveTalkMode && dictating && activeProvider === 'handy';
  const handyLabel = `${dictating ? 'Pause' : 'Start'} Handy conversation dictation`;
  const speechUnavailable = transcribing
    ? `${providerName} is transcribing your conversation answer.`
    : transcriptionRunning
      ? 'Another answer is already being transcribed.'
      : dictating ? undefined : route.reason;
  const unavailableLabel = speechUnavailable && !transcribing
    ? `Conversation answer dictation is unavailable. ${speechUnavailable}`
    : speechUnavailable;
  const microphoneTitle = liveTalkMode
    ? tutorLivePressToTalk
      ? tutorLiveTalkListening ? 'Press when you finish' : 'Press to talk'
      : tutorLiveTalkListening ? 'Stop talking' : 'Talk to KREN'
    : dictating
      ? handyListening ? handyLabel : `Press again to stop ${providerName} conversation dictation`
      : unavailableLabel ?? (activeProvider === 'handy' ? handyLabel : `Speak your conversation answer with ${providerName}`);
  const microphoneLabel = liveTalkMode
    ? tutorLivePressToTalk
      ? tutorLiveTalkListening ? 'Press when you finish' : 'Press to talk'
      : tutorLiveTalkListening ? 'Stop talking' : 'Talk to KREN'
    : dictating
      ? handyListening ? handyLabel : `Stop speaking your conversation answer with ${providerName}`
      : unavailableLabel ?? (activeProvider === 'handy' ? handyLabel : `Speak your conversation answer with ${providerName}`);
  const microphonePressed = liveTalkMode ? tutorLiveTalkListening : dictating;
  const microphoneDisabled = demo ? true : liveTalkMode
    ? !active
    : !active || Boolean(speechUnavailable) || conversation.busy || transcribing;
  const microphone = iconButton(
    'dictateTutorConversation',
    `data-tutor-chat-mic-control${standardControlsPending ? ' hidden' : ''} aria-pressed="${microphonePressed ? 'true' : 'false'}" data-tutor-live-talk="${liveTalkMode ? 'true' : 'false'}" data-tutor-press-to-talk="${tutorLivePressToTalk ? 'true' : 'false'}" data-tutor-dictation-disabled="${microphoneDisabled ? 'true' : 'false'}" data-tutor-dictation-route-unavailable="${!active || (!liveTalkMode && Boolean(speechUnavailable)) ? 'true' : 'false'}" data-tutor-dictation-provider="${liveTalkMode ? 'live' : activeProvider ?? ''}"`,
    microphoneTitle,
    microphoneLabel,
    handyListening ? 'pause' : 'microphone',
    microphoneDisabled,
    false,
    `icon-button tutor-action-icon${microphonePressed ? ' tutor-dictation-active tutor-microphone-pulsing' : ''}`
  );
  const completedTurns = conversation.transcript.filter((turn) => !turn.skipped);
  const markedMarkup = (text: string, marks: TutorTargetMark[] | undefined = undefined, field?: TutorTargetMark['field'], quote = '') => {
    const applicable = marks ?? (conversation.replies === 'liveGemini'
      ? tutorLiveTargetMarks(text, field ?? 'reply', conversation.lessonContext) : []);
    const ranges = tutorTargetRanges(text, field ?? applicable[0]?.field ?? 'reply', applicable);
    return tutorMarkedSegments(text, ranges, quote).map((segment) => {
      let content = escapeHtml(segment.text);
      if (segment.target) content = `<span class="tutor-target-use" data-tutor-target-use>${content}</span>`;
      if (segment.correction) content = `<strong class="tutor-reply-quote" data-tutor-reply-quote>${content}</strong>`;
      return content;
    }).join('');
  };
  const bubble = (question: string, marks?: TutorTargetMark[]) => `<div class="tutor-chat-kren" data-tutor-kren-bubble role="group" aria-label="KREN"><p${coach ? ' data-tutor-coach-reply' : ''}>${coach ? renderTutorConversationCoachReply(question) : markedMarkup(question, marks)}</p></div>`;
  const typingBubble = `<div class="tutor-chat-kren tutor-chat-typing" data-tutor-kren-bubble data-tutor-typing role="status" aria-label="KREN is typing"><span class="tutor-typing-dot" aria-hidden="true">.</span><span class="tutor-typing-dot" aria-hidden="true">.</span><span class="tutor-typing-dot" aria-hidden="true">.</span></div>`;
  const replyBubble = (reply: string, quote?: string, generation?: number, marks?: TutorTargetMark[], index?: number) =>
    `<div class="tutor-chat-kren" data-tutor-kren-bubble data-tutor-reply-bubble data-tutor-reply-text="${escapeHtml(reply)}"${index === undefined ? '' : ` data-tutor-reply-turn="${index}"`}${generation === undefined ? '' : ` data-tutor-reply-generation="${generation}"`} role="group" aria-label="KREN"><p${coach ? ' data-tutor-coach-reply' : ''}>${coach ? renderTutorConversationCoachReply(reply) : markedMarkup(reply, marks, 'reply', quote)}</p></div>`;
  // 2026-10-14: Only panel dialogue deduplicates explicit replies without a valid move.
  const repeatsReply = (question: string, previous: TutorViewState['conversation']['transcript'][number] | undefined) =>
    tutorConversationQuestionRepeatsReply(question, previous, true);
  const unansweredAt = (position: number) => (conversation.unansweredReplies ?? [])
    .filter((reply) => reply.beforeTurn === position);
  const unansweredBubbles = (position: number) => unansweredAt(position).map((reply) => bubble(reply.text)).join('');
  const completedTranscript = conversation.transcript.map((entry, position) => {
    const question = repeatsReply(entry.question, conversation.transcript[position - 1]) ||
      unansweredAt(position).at(-1)?.text === entry.question ? '' : bubble(entry.question, entry.questionTargetMarks);
    const hidden = entry.learnerNotShown === true || tutorLearnerTurnNotShown(entry.learnerAnswer);
    const answerMode = entry.spoken ? 'spoken' : 'typed';
    const needsCorrection = !entry.skipped && !entry.coachingFailed && !entry.coachingPending &&
      !tutorConversationAnswersMatch(entry.correction, entry.learnerAnswer, answerMode);
    const visibleReply = conversation.speechReveal?.turn === position && conversation.speechReveal.started === 0
      ? '' : tutorConversationVisibleReply(entry, true);
    const reply = visibleReply ? replyBubble(visibleReply, entry.replyQuote, entry.generation, entry.targetMarks, position) : '';
    const spokenEquivalent = tutorConversationAnswersMatch(
      entry.correction, entry.learnerAnswer, 'spoken'
    );
    const checkFailure = entry.coachingFailed
      ? `<p class="tutor-turn-check-failed" data-tutor-coaching-failed>KREN could not check this turn.${iconButton('retryTutorTurnCheck', `data-tutor-turn="${position}" data-tutor-check-running="${entry.coachingPending === true}"`, 'Check this turn again', 'Check this turn again', 'regenerate', conversation.busy || entry.coachingPending === true)}</p>`
      : '';
    const feedbackVisible = coach || conversation.coaching !== 'afterwards' || conversation.status === 'stopped';
    const checked = !entry.skipped && !entry.coachingFailed && !entry.coachingPending &&
      Boolean(entry.rephrase?.trim() && entry.rephraseWhy?.trim());
    const rephraseAction = !coach && checked && !entry.rephraseShown && feedbackVisible
      ? `<button type="button" class="tutor-rephrase-action" data-command="showTutorConversationRephrase" data-tutor-rephrase="${escapeHtml(entry.rephrase!)}" data-tutor-rephrase-why="${escapeHtml(entry.rephraseWhy!)}">Rephrase?</button>`
      : '';
    const unchangedRephrase = entry.rephraseShown && tutorRephraseMatches(entry.rephrase ?? '', entry.learnerAnswer);
    const feedback = coach ? ''
      : entry.rephraseShown
      ? `<div class="tutor-turn-feedback" data-tutor-turn-feedback data-tutor-feedback-kind="rephrase"><p data-tutor-rephrase>${unchangedRephrase ? 'Nothing to rephrase for this chat.' : escapeHtml(entry.rephrase ?? '')}</p>${unchangedRephrase ? '' : `<details class="tutor-turn-explanation" data-tutor-turn-explanation><summary>Why?</summary><p>${escapeHtml(entry.rephraseWhy ?? '')}</p></details>`}</div>`
      : !needsCorrection
        ? ''
        : `<div class="tutor-turn-feedback" data-tutor-turn-feedback data-tutor-spoken-equivalent="${spokenEquivalent ? 'true' : 'false'}"${feedbackVisible ? '' : ' hidden'}><p data-tutor-correction>${escapeHtml(entry.correction)}</p><details class="tutor-turn-explanation" data-tutor-turn-explanation><summary>Why?</summary><p>${escapeHtml(entry.explanation)}</p><button type="button" class="secondary" data-command="askTutorConversationTurn" data-tutor-turn="${position}">Ask about this</button></details></div>`;
    if (hidden) return `${unansweredBubbles(position)}${question}<div class="tutor-chat-learner-turn" data-tutor-learner-turn="${position}"><p class="tutor-turn-check-failed" data-tutor-learner-not-shown>Not in English, so not shown.</p></div>${reply}`;
    return `${unansweredBubbles(position)}${question}<div class="tutor-chat-learner-turn" data-tutor-learner-turn="${position}"${entry.generation === undefined ? '' : ` data-tutor-turn-generation="${entry.generation}"`}><div class="tutor-chat-learner" role="group" aria-label="You"><p data-tutor-learner-answer>${entry.skipped ? 'Skipped this question. It is not evidence.' : escapeHtml(entry.learnerAnswer)}</p>${rephraseAction}</div>${entry.partiallyHeard ? '<p class="tutor-turn-check-failed" data-tutor-partially-heard>Part of this turn could not be heard as English.</p>' : ''}${checkFailure}${feedback}${entry.handoff ? `<p data-tutor-handoff role="status">${escapeHtml(tutorConversationHandoffNote(entry.handoff.role))}</p>` : ''}</div>${reply}`;
  }).join('');
  const demoTranscript = conversation.demoLines.map((line) => {
    const character = conversation.demoCast?.[line.speaker];
    const name = character?.name ?? (line.speaker === 'female' ? 'Woman' : 'Man');
    return `<div class="tutor-chat-demo tutor-chat-demo-${line.speaker}" data-tutor-demo-bubble data-tutor-demo-speaker="${line.speaker}" role="group" aria-label="${escapeHtml(name)}"><strong class="tutor-chat-demo-name">${escapeHtml(name)}</strong><p>${markedMarkup(line.text, tutorLiveTargetMarks(line.text, 'reply', conversation.lessonContext), 'reply')}</p></div>`;
  }).join('');
  const currentQuestion = active && !['scene', 'waiting'].includes(conversation.openingReveal ?? '') &&
      (!conversation.speechReveal || conversation.speechReveal.started >= conversation.speechReveal.texts.length) && conversation.currentQuestion.trim() &&
      !repeatsReply(conversation.currentQuestion, conversation.transcript.at(-1)) &&
      unansweredAt(conversation.transcript.length).at(-1)?.text !== conversation.currentQuestion
    ? bubble(conversation.currentQuestion, conversation.currentQuestionTargetMarks) : '';
  const hintTurn = conversation.hintBusy && Number.isInteger(tutorConversationHintTurnGeneration)
    ? ` data-tutor-hint-turn="${tutorConversationHintTurnGeneration}"` : '';
  const hintMarkup = active && !coach
    ? `<div data-tutor-hint${hintTurn}${conversation.hint || conversation.hintBusy || conversation.hintFailure ? '' : ' hidden'}${conversation.hintBusy ? ' role="status"' : ' role="group"'}><p${!conversation.hintBusy && !conversation.hint && conversation.hintFailure ? ' class="tutor-failure"' : ''} data-tutor-hint-explanation>${conversation.hintBusy
        ? 'Writing a hint. Please wait.'
        : escapeHtml(conversation.hint?.explanation ?? conversation.hintFailure ?? '')}</p><p data-tutor-hint-example${conversation.hint ? '' : ' hidden'}><strong>Example:</strong> <span data-tutor-hint-example-text>${escapeHtml(conversation.hint?.example ?? '')}</span></p></div>`
    : '';
  const pendingAnswer = active && conversation.pendingAnswer !== undefined
    ? tutorLearnerTurnNotShown(conversation.pendingAnswer!)
      ? `<div class="tutor-chat-learner-turn" data-tutor-pending aria-busy="true"><p class="tutor-turn-check-failed" data-tutor-learner-not-shown>Not in English, so not shown.</p></div>`
      : `<div class="tutor-chat-learner-turn" data-tutor-pending aria-busy="true"><div class="tutor-chat-learner" role="group" aria-label="You, sending"><p data-tutor-learner-answer>${escapeHtml(conversation.pendingAnswer)}</p></div></div>`
    : '';
  // 2026-10-14: The final follow-up is dialogue too, and survives Stop with its reply.
  const finalTurn = conversation.transcript.at(-1);
  const stoppedNextQuestion = conversation.status === 'stopped' && conversation.replies === 'standard' &&
    finalTurn && !finalTurn.skipped && !finalTurn.learnerNotShown && finalTurn.nextQuestion?.trim() &&
    !repeatsReply(finalTurn.nextQuestion, finalTurn)
    ? bubble(finalTurn.nextQuestion, finalTurn.targetMarks?.filter(mark => mark.field === 'nextQuestion')) : '';
  const transcript = demo
    ? demoTranscript
    : `${completedTranscript}${unansweredBubbles(conversation.transcript.length)}${currentQuestion}${stoppedNextQuestion}${pendingAnswer}${active && (conversation.busy || conversation.openingReveal === 'waiting' || (conversation.speechReveal && conversation.speechReveal.started < conversation.speechReveal.texts.length)) ? typingBubble : ''}`;
  const scene = `<div class="tutor-conversation-scene" data-tutor-scene role="note"${tutorConversationScene ? '' : ' hidden'}><p data-tutor-scene-text>${escapeHtml(tutorConversationScene ?? '')}</p></div>`;
  const openingFailure = active && !conversation.busy && !conversation.currentQuestion.trim() &&
    conversation.transcript.length === 0 && Boolean(conversation.failure);
  const correctionPending = conversation.coaching !== 'afterwards' &&
    conversation.transcript.some((entry) => entry.coachingPending);
  const readerSpeaking = dictating || (tutorLiveTalkListening && tutorLivePressToTalk);
  const stopDisabled = !demo && (tutorConversationStopDisabled ?? (
    readerSpeaking || transcribing || conversation.busy || conversation.hintBusy || correctionPending
  ));
  const stopTitle = demo ? 'Stop conversation'
    : tutorConversationStopTitle ?? (readerSpeaking
      ? 'Stop is available when you finish speaking'
      : stopDisabled ? 'Stop is available when this turn finishes' : 'Stop conversation');
  const diagnosisControl = renderTutorConversationReview(state, tutorConversationTakeHome);
  const answeredTurnCount = completedTurns.filter((turn) => !turn.learnerNotShown).length;
  const skippedTurnCount = conversation.transcript.filter((turn) => turn.skipped).length;
  const conversationActions = active
    ? `<div class="tutor-conversation-actions" data-tutor-conversation-actions data-tutor-answered-turns="${answeredTurnCount}" data-tutor-skipped-turns="${skippedTurnCount}" hidden></div>` : '';
  const hasKrenMessage = Boolean(conversation.currentQuestion.trim()) ||
    completedTurns.some((turn) => Boolean(tutorConversationReply(turn).trim()));
  const replaying = conversation.replayAllSpeaking === true;
  const replayConversation = conversation.status === 'stopped';
  const liveReplay = liveReplies && !tutorLiveFailed;
  const replayTitle = replaying ? 'Stop replaying'
    : replayConversation ? 'Replay the conversation' : 'Replay the last thing KREN said';
  const replayConversationAvailable = replayConversation && (demo
    ? conversation.demoLines.length > 0
    : liveReplay ? tutorConversationReplayAvailable : completedTurns.length > 0 || hasKrenMessage);
  const replayDisabled = !conversation.speakerOn || (replayConversation
    ? !replayConversationAvailable
    : !hasKrenMessage || (liveReplay && !tutorLiveReplayAvailable));
  const replay = iconButton(
    'replayTutorQuestion',
    `aria-pressed="${replaying}" data-tutor-standard-fallback="${tutorLiveFailed}" data-tutor-replay-mode="${replayConversation ? 'conversation' : 'last'}" data-tutor-replay-conversation-available="${replayConversationAvailable}" data-tutor-live-audio-available="${tutorLiveReplayAvailable}" data-tutor-standard-replay-available="${hasKrenMessage}"`,
    replayConversation && !conversation.speakerOn ? 'Turn the speaker on to replay.'
      : replayConversation && replayDisabled ? liveReplay ? 'No retained Live audio is available to replay.' : 'KREN has not said anything to replay.'
      : replayTitle,
    replayTitle,
    replaying ? 'stop' : 'replay',
    replayDisabled
  );
  // Changed 2026-09-25 for V155: Stop names the event that holds it, while the microphone
  // remains independently available so the reader can close a recording first.
  const activeActions = `${iconButton('toggleTutorConversationSpeaker', `aria-pressed="${conversation.speakerOn}"`, speakerAction, speakerAction, conversation.speakerOn ? 'speaker' : 'speakerOff', demo, false, 'icon-button tutor-action-icon')}${coach ? '' : iconButton('hintTutorConversation', '', 'Hint', 'Hint', 'hint', demo || conversation.busy || conversation.hintBusy || openingFailure)}${coach ? '' : iconButton('skipTutorConversationTurn', '', 'Skip this question', 'Skip this question', 'skip', demo || conversation.busy || openingFailure)}${replay}${iconButton('stopTutorConversation', `data-tutor-composer-stop${standardControlsPending ? ' hidden' : ''}`, stopTitle, stopTitle, 'stop', stopDisabled)}`;
  const { remaining: diagnosticAnswersRemaining } = tutorConversationReviewProgress(conversation);
  const diagnosticProgress = diagnosticAnswersRemaining
    ? ` Answer ${diagnosticAnswersRemaining} more turn${diagnosticAnswersRemaining === 1 ? '' : 's'} to see the diagnostic report (More details).` : '';
  const stoppedMessage = demo
    ? conversation.demoEndedAtCap
      ? `The example ended automatically after ${conversation.demoLines.length / 2} exchanges, the safety limit.`
      : `The example is stopped. ${conversation.demoLines.length} spoken lines remain on screen.`
    : `This conversation is stopped. This tutor session has kept all ${count} turns.${diagnosticProgress}`;
  const stoppedActions = demo
    ? `<button type="button" data-command="startTutorConversation">Start now</button><button type="button" data-command="startNewTutorConversation">Start new</button><span data-tutor-review-action-slot>${diagnosisControl}</span>${renderTutorSettingsBridges()}`
    : `<button type="button" data-command="startNewTutorConversation">Start new</button><button type="button" data-command="resumeTutorConversation">Back to chat</button><span data-tutor-review-action-slot>${diagnosisControl}</span>${renderTutorSettingsBridges()}`;
  const demoStatus = demo && active
    ? '<p data-tutor-demo-status role="status">Demo is running. KREN is speaking for both characters. Press Stop to end it.</p>'
    : '';
  const modeOpen = conversation.openModeAfterRender === true;
  const entryActions = `<div class="tutor-conversation-actions${modeOpen ? '' : ' tutor-conversation-front-actions'}" data-tutor-conversation-entry-actions><button type="button" data-tutor-open-conversation-settings title="Open the conversation mode settings above"${modeOpen ? ' hidden' : ''}>Setting</button><button type="button" data-command="startTutorConversation"${startReason ? ` disabled title="${escapeHtml(startReason)}"` : ''}>Start</button>${coach ? '' : `<button type="button" class="secondary" data-command="startTutorConversationDemo" title="${startReason ? escapeHtml(startReason) : !conversation.speakerOn ? 'Turn the speaker on to run Demo' : !tutorDemoAvailable ? escapeHtml(tutorDemoMissingKey) : 'Hear an example conversation'}"${!startReason && tutorDemoAvailable && conversation.speakerOn ? '' : ' disabled'}>Demo</button>`}<button type="button" class="secondary" data-command="resetTutorConversationDefaults" title="Reset the mode settings to defaults"${modeOpen ? '' : ' hidden'}>Reset</button></div>`;
  const composer = active ? `${demoStatus}<div class="tutor-conversation-composer" data-tutor-composer><div class="tutor-composer-controls" data-tutor-composer-controls><div class="tutor-composer-actions" data-tutor-composer-actions>${activeActions}</div></div></div>` : conversation.status === 'stopped' ? `<div class="tutor-conversation-start"><p>${stoppedMessage}</p><div class="tutor-conversation-actions" data-tutor-conversation-actions data-tutor-stopped-actions>${stoppedActions}</div></div>` : `<div class="tutor-conversation-start"><p class="tutor-conversation-invitation">Start, then speak with the microphone</p>${startReason && !lessonStartBlocked ? `<p>${escapeHtml(startReason)}</p>` : ''}${entryActions}</div>`;
  const standaloneControls = active || conversation.status !== 'stopped' ? ''
    : `<div class="tutor-composer-controls tutor-standalone-controls" data-tutor-composer-controls><div class="tutor-composer-actions" data-tutor-composer-actions>${speaker}${replay}</div><div class="tutor-composer-audio" data-tutor-composer-audio></div></div>`;
  const failure = openingFailure
    ? `<div class="tutor-opening-failure" role="group"><p class="tutor-failure" data-tutor-opening-failure>${escapeHtml(conversation.failure!)}</p><button type="button" data-command="startTutorConversation">Retry</button></div>`
    : conversation.failure ? `<p class="tutor-failure">${escapeHtml(conversation.failure)}</p>` : '';
  const availablePictures = coach || conversation.situationPicture === 'none' ? []
    : Array.isArray(tutorConversationPicture) ? tutorConversationPicture : tutorConversationPicture ? [tutorConversationPicture] : [];
  const pictures = conversation.situationPicture === 'intro' ? availablePictures.slice(-1) : availablePictures;
  const pictureTags = (pictures.length ? pictures : [undefined]).map((image, index) =>
    `<img data-picture-turn="${tutorConversationPictureTurns[conversation.situationPicture === 'intro' ? availablePictures.length - 1 : index] ?? -1}" data-tutor-picture alt="" aria-hidden="true" data-tutor-picture-transparency="${conversation.pictureTransparency}" hidden${image ? ` src="${escapeHtml(image)}"` : ''}>`).join('');
  const developing = ['switching', 'graduallyEntering'].includes(conversation.situationPicture);
  const pictureMarkup = `${developing ? '' : pictureTags}<div data-tutor-picture-column${developing ? '' : ' hidden'}><div class="tutor-picture-frames${conversation.situationPicture === 'graduallyEntering' ? ' tutor-picture-stack' : ''}">${developing ? pictureTags : ''}</div></div>`;
  return `<h2 id="tutor-conversation-heading">CONVERSATION</h2><p class="tutor-conversation-intro">${coach ? 'Say anything in English. KREN coaches your expression and speaks the whole coaching paragraph.' : 'Talk with KREN in English. It answers, shows corrections under your turns, and the transcript stays in this tutor session.'}</p><section class="tutor-conversation" data-tutor-result="conversation" data-tutor-conversation-active="${active && !demo}" role="region" aria-labelledby="tutor-conversation-heading">${setup}${scene}<p class="tutor-picture-paused" data-tutor-picture-paused${conversation.picturePaused ? '' : ' hidden'}>${escapeHtml(conversation.picturePaused ?? '')}</p><div class="tutor-chat-viewport" data-tutor-picture-viewport data-tutor-balloon-transparency="${conversation.balloonTransparency}">${pictureMarkup}<div class="tutor-chat-transcript" data-tutor-transcript${standardControlsPending ? ' data-tutor-opening-pending="true"' : ''} role="log" aria-label="Conversation transcript">${transcript}${active ? `<div class="tutor-chat-learner-turn" data-tutor-chat-microphone${standardControlsPending ? ' hidden' : ''}>${demo ? '' : iconButton('stopTutorConversation', 'data-tutor-chat-stop', stopTitle, stopTitle, 'stop', stopDisabled)}${microphone}</div>` : ''}</div></div>${standaloneControls}${conversationActions}${hintMarkup}${composer}${failure}<div data-tutor-take-home>${renderTutorTakeHome(conversation)}</div></section>`;
}

/** Offsets always refer to the shown paragraph, never to appended structured text. */
export function tutorConversationCoachHighlights(text: string): { ranges: Array<{ start: number; end: number }> } {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(/["\u201c]([^"\u201c\u201d]+)["\u201d]/gu)) {
    const words = match[1]!.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['\u2019-][\p{L}\p{M}\p{N}]+)*/gu) ?? [];
    if (words.length < 2) continue;
    const start = match.index! + 1;
    ranges.push({ start, end: start + match[1]!.length });
  }
  return { ranges };
}

export function renderTutorConversationCoachReply(text: string): string {
  let end = 0;
  let html = '';
  for (const range of tutorConversationCoachHighlights(text).ranges) {
    html += escapeHtml(text.slice(end, range.start)) + `<strong class="tutor-review-corrected">${escapeHtml(text.slice(range.start, range.end))}</strong>`;
    end = range.end;
  }
  return html + escapeHtml(text.slice(end));
}

function tutorRephraseMatches(rephrase: string, learnerWords: string): boolean {
  const comparable = (value: string): string => value.trim().replace(/\s+/gu, ' ')
    .replace(/[.?!]$/u, '').trim().toLocaleLowerCase('en-US');
  return comparable(rephrase) === comparable(learnerWords);
}

/** Shared by the transcript renderer and picture references. Feedback is never dialogue. */
export function tutorConversationVisibleReply(turn: TutorViewState['conversation']['transcript'][number], explicitDialogue = false): string {
  if (turn.learnerNotShown || tutorLearnerTurnNotShown(turn.learnerAnswer)) return '';
  // 2026-10-14: Held turns retain replies without a valid move, except correction text.
  const reply = explicitDialogue && turn.reply?.trim() ? turn.reply : tutorConversationReply(turn);
  return turn.skipped || tutorConversationAnswersMatch(reply, turn.correction, turn.spoken ? 'spoken' : 'typed')
    ? '' : reply;
}

export function tutorConversationQuestionRepeatsReply(
  question: string, previous: TutorViewState['conversation']['transcript'][number] | undefined,
  explicitDialogue = false
): boolean {
  return Boolean(previous && !previous.skipped &&
    ((explicitDialogue && question === previous.reply) || question === tutorConversationReply(previous) ||
      (previous.learnerNotShown && question === previous.question)));
}

export function tutorConversationAnswersMatch(
  left: string,
  right: string,
  answers: 'typed' | 'spoken' = 'typed'
): boolean {
  const normalise = (value: string): string => value
    .trim()
    .replace(/[\u2018\u2019]/gu, "'")
    .replace(/[\u201c\u201d]/gu, '"');
  const comparable = (value: string): string => answers === 'spoken'
    ? normalise(value).toLocaleLowerCase('en-US').replace(/\p{P}+/gu, ' ')
      .replace(/\s+/gu, ' ').trim()
    : normalise(value);
  return comparable(left) === comparable(right);
}

function renderTutorToolDrawer(state: TutorViewState, configuredTargetLanguage: string): string {
  const drawer = state.toolDrawer;
  if (!drawer) return '';
  const content = drawer.status === 'editing'
    ? drawer.tool === 'ask'
      ? '<p>Write a question about the sentence or reviewed practice item shown above.</p>'
      : (drawer.tool === 'dictionary'
      ? '<p>Highlight a word with the mouse, then Look up. Looking up without a highlight uses everything in the box.</p>'
      : '<p>Review or edit this input, then submit it explicitly.</p>')
    : drawer.status === 'loading'
    ? drawer.tool === 'ask'
      ? '<p>Preparing an explanation. The lesson remains available behind this drawer.</p>'
      : '<p>Working on this example. The lesson remains available behind this drawer.</p>'
    : drawer.status === 'failed'
      ? `<p class="tutor-failure">${escapeHtml(drawer.message ?? 'The tool request failed.')}</p>`
      : drawer.tool === 'ask' && drawer.answer
        ? renderTutorAskAnswer(drawer.answer, drawer.learnerAnswer === undefined)
        : drawer.result?.kind === 'translation'
        ? renderTranslation(drawer.result)
        : drawer.result?.kind === 'dictionary'
          ? renderDictionary(drawer.result)
          : drawer.result?.kind === 'thesaurus'
            ? renderThesaurus(drawer.result)
            : '<p>No result was returned.</p>';
  const inputLabel = drawer.tool === 'dictionary'
    ? 'Highlight a word in the sentence, then Look up'
    : drawer.tool === 'translate'
      ? 'Text to translate'
      : 'Your question';
  const targetLanguage = drawer.targetLanguage ?? configuredTargetLanguage;
  const outputLanguage = drawer.tool === 'translate' || drawer.tool === 'dictionary'
    ? `<label class="tutor-tool-output-language"><strong>Output language${drawer.tool === 'dictionary' ? ' <span class="tutor-output-language-note">(when more than one word selected)</span>' : ''}</strong><select data-tutor-tool-target-language>${translationTargetLanguageOptions(configuredTargetLanguage, targetLanguage).map(([value, label]) => `<option value="${escapeHtml(value)}"${value === targetLanguage ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label>`
    : '';
  const drawerContext = drawer.context !== undefined
    ? `<section aria-label="${drawer.tool === 'dictionary' ? 'Dictionary context' : 'Question context'}"><strong>${drawer.learnerAnswer === undefined ? 'Sentence' : 'Exercise prompt'}</strong><p class="tutor-drawer-context">${escapeHtml(drawer.context)}</p>${drawer.learnerAnswer === undefined ? '' : `<strong>Your reviewed answer</strong><p class="tutor-drawer-context">${escapeHtml(drawer.learnerAnswer)}</p>`}</section>`
    : '';
  const heading = drawer.tool === 'dictionary'
    ? 'Dictionary'
    : drawer.tool === 'translate'
      ? 'Translate'
      : drawer.learnerAnswer === undefined
        ? 'Ask about this sentence'
        : 'Ask about this practice item';
  const action = drawer.tool === 'dictionary' ? 'Look up' : drawer.tool === 'translate' ? 'Translate' : 'Ask';
  const restoreSentence = drawer.tool === 'dictionary' && drawer.context !== undefined
    ? '<button type="button" class="secondary" data-command="restoreTutorDictionaryContext">Restore sentence</button>'
    : '';
  return `<aside class="tutor-drawer" role="dialog" aria-modal="true" aria-label="Learning Tools"><button type="button" class="secondary" data-command="closeTutorTool">Back to lesson</button><h2>${heading}</h2>${drawerContext}<label><strong>${inputLabel}</strong><textarea class="tutor-answer tutor-drawer-input" data-tutor-tool-input>${escapeHtml(drawer.input)}</textarea></label>${outputLanguage}<div class="tutor-item-actions"><button type="button" data-command="submitTutorTool"${drawer.status === 'loading' || !drawer.input.trim() ? ' disabled' : ''}>${action}</button>${restoreSentence}</div><div class="tutor-drawer-result">${content}</div></aside>`;
}

function renderTutorAskAnswer(answer: TutorAskAnswer, sentenceContext: boolean): string {
  const explanation = answer.explanation
    ? `<section><h3>Explanation</h3><p>${escapeHtml(answer.explanation)}</p></section>`
    : '';
  const examples = answer.examples?.length
    ? `<section><h3>Examples</h3><ul>${(sentenceContext ? [...answer.examples].reverse() : answer.examples).map((example) => `<li>${escapeHtml(example)}</li>`).join('')}</ul></section>`
    : '';
  return `<div class="tutor-ask-answer" aria-label="Answer"><section><h3>Answer</h3><p>${escapeHtml(answer.directAnswer)}</p></section>${explanation}${examples}</div>`;
}

function tutorAxisOptions(key: string): Array<[string, string]> {
  const axis = REWRITE_AXIS_SETTINGS.find((candidate) => candidate.key === key);
  return axis?.values.map((option) => [option.id, option.label]) ?? [];
}

function tutorAxisLabel(key: string, value: string): string {
  return tutorAxisOptions(key).find(([id]) => id === value)?.[1] ?? value;
}

const TUTOR_VALUE_LABELS: Readonly<Record<string, string>> = {
  A1: 'Beginner',
  A2: 'Elementary',
  B1: 'Intermediate',
  B2: 'Upper-intermediate',
  C1: 'Advanced',
  C2: 'Proficient',
  auto: 'Auto',
  explainAndExamples: 'Explain + Examples',
  explainEach: 'Explain each target',
  fullAnalysis: 'Full grammatical analysis',
  errorClinic: 'Error clinic',
  miniPractice: 'Mini practice',
  strongTendency: 'Strong tendency',
  stylePreference: 'Style preference',
  veryShort: 'Very short'
};

function tutorValueLabel(value: string): string {
  const label = TUTOR_VALUE_LABELS[value];
  if (label !== undefined) return label;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function tutorAnnotationExcerptKey(excerpt: string): string {
  return excerpt.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

function renderTutorAnnotations(
  annotations: ReadonlyArray<{ excerpt: string; explanation: string }>
): string {
  const groups = new Map<string, { excerpt: string; explanations: string[] }>();
  for (const annotation of annotations) {
    const key = tutorAnnotationExcerptKey(annotation.excerpt);
    const group = groups.get(key);
    if (group) {
      group.explanations.push(annotation.explanation);
    } else {
      groups.set(key, {
        excerpt: annotation.excerpt,
        explanations: [annotation.explanation]
      });
    }
  }
  const items = [...groups.values()].map((group) =>
    `<li class="tutor-annotation"><span class="tutor-annotation-excerpt">${escapeHtml(group.excerpt)}</span>: ${escapeHtml(group.explanations.join(' '))}</li>`
  ).join('');
  return items ? `<ul class="tutor-annotation-list">${items}</ul>` : '';
}

/**
 * A number stored in milliseconds and shown in seconds.
 *
 * The owner asked for the request timeout in seconds on 2026-08-28: milliseconds is the unit
 * the provider call takes and not the unit anyone thinks in. The stored setting keeps its
 * milliseconds, so nothing downstream changes; the control divides on the way out and the
 * webview multiplies on the way back, marked by `data-seconds` so the conversion happens in
 * exactly one place rather than being remembered at each end.
 */
function secondsSetting(
  title: string,
  description: string,
  key: string,
  milliseconds: number,
  minimumMs: number,
  maximumMs: number
): string {
  const toSeconds = (value: number): number => Math.round(value / 1000);
  return `<label class="setting"><span><span class="setting-title">${escapeHtml(title)}</span><span class="setting-description">${escapeHtml(description)}</span></span><span class="setting-control"><input type="number" data-setting="${escapeHtml(key)}" data-seconds value="${toSeconds(milliseconds)}" min="${toSeconds(minimumMs)}" max="${toSeconds(maximumMs)}" step="1"><span class="setting-unit">sec</span></span></label>`;
}

/**
 * Wrap a control so it is visibly inert, with the reason beside it, rather than hidden.
 *
 * The same choice KREN makes everywhere else it disables a control: a setting that vanishes
 * leaves the reader wondering where it went, while one that is present and dimmed says what
 * to change to bring it back. The stored value is never touched.
 */
function inactiveWhen(inactive: boolean, reason: string, control: string): string {
  if (!inactive) return control;
  return `<div class="setting-inactive"><p class="credential-reason">${escapeHtml(reason)}</p>${control.replace('<select ', '<select disabled ')}</div>`;
}

function numberSetting(
  title: string,
  description: string,
  key: string,
  value: number,
  minimum: number,
  maximum?: number
): string {
  return `<label class="setting"><span><span class="setting-title">${escapeHtml(title)}</span><span class="setting-description">${escapeHtml(description)}</span></span><input type="number" data-setting="${escapeHtml(key)}" value="${value}" min="${minimum}"${maximum === undefined ? '' : ` max="${maximum}"`} step="1"></label>`;
}

function tutorLessonFindingMessage(finding: TutorFinding): string {
  const actual = finding.detail?.actualWordCount;
  if (finding.code === 'lesson.wordCountBelowMinimum') return `Warning: this example has ${String(actual)} words, below the requested band but inside its tolerance.`;
  if (finding.code === 'lesson.wordCountAboveMaximum') return `Warning: this example has ${String(actual)} words, above the requested band but inside its tolerance.`;
  return tutorFindingMessage(finding);
}

function renderUserDictionary(
  state: UserDictionaryViewState,
  settings: KrenPanelSettings,
  brandImageUri: string | undefined,
  hasHeldResult = false,
  logoUris?: { light: string; dark: string }
): string {
  const header = renderHeader('', false, brandImageUri, false, true);
  if (!settings.userDictionaryEnabled) {
    return `${header}<section class="card"><h2 class="card-title">User Dictionary</h2><div class="card-body"><p>User Dictionary is disabled. Enable it in KREN Settings before opening or adding entries.</p><button class="secondary" data-command="showSettings">Open Settings</button></div></section>`;
  }
  if (state.draft || state.capture) {
    return `${header}${renderUserDictionaryDraft(state, settings, logoUris)}`;
  }
  if (state.status === 'loading') {
    return `${header}<section class="card"><h2 class="card-title">User Dictionary</h2><div class="card-body"><p><strong>Loading User Dictionary...</strong></p><p>KREN is reading the local store.</p></div></section>`;
  }
  if (state.status === 'storageError') {
    return `${header}<section class="card storage-error"><h2 class="card-title">User Dictionary storage error</h2><div class="card-body"><p><strong>KREN could not read the dictionary and did not replace it with an empty store.</strong></p><p>The original <code>entries.json</code> remains at <code>${escapeHtml(settings.userDictionaryStoragePath ?? 'the configured User Dictionary storage location')}</code>. Copy it before repair, recover it into valid version 1 JSON, then use Import.</p><div class="settings-buttons"><button class="secondary" data-command="showSettings">Open recovery settings</button><button class="secondary" data-command="showUserDictionary">Try again</button></div></div></section>`;
  }
  if (state.status === 'generationFailed') {
    return `${header}<section class="card generation-failed"><h2 class="card-title">User Dictionary generation failed</h2><div class="card-body"><p>No draft or partial entry was saved. Return to the editor and explicitly run Add to User Dictionary to try again.</p><div class="settings-buttons"><button class="secondary" data-command="runCommand" data-action="kren.addToUserDictionary">Try Add again</button></div></div></section>`;
  }
  const query = state.query ?? {};
  const visible = filterUserDictionaryEntries(state.entries, query);
  const selected = visible.find((entry) => entry.id === state.selectedId) ?? visible[0];
  const selectedIds = new Set(state.selectedIds ?? []);
  const filterValues = userDictionaryFilterValues(state.entries);
  const list = state.entries.length === 0
    ? '<p class="empty"><strong>Your User Dictionary is empty.</strong> Select an expression in the editor and choose Add to User Dictionary.</p>'
    : visible.length === 0
      ? '<p class="empty"><strong>No entries match this search and filter combination.</strong> Your saved entries have not been changed.</p>'
      : visible.map((entry) => `<div class="dictionary-list-row"><input type="checkbox" data-dictionary-select data-entry-id="${escapeHtml(entry.id)}" aria-label="Select ${escapeHtml(entry.term)} for deletion or export"${selectedIds.has(entry.id) ? ' checked' : ''}><button class="${entry.id === selected?.id ? 'active' : ''}" data-command="openUserDictionaryEntry" data-entry-id="${escapeHtml(entry.id)}">${escapeHtml(entry.term)}</button></div>`).join('');
  const details = selected ? renderUserDictionaryDetails(selected) : '<p class="empty">Choose an entry.</p>';
  const filters = state.entries.length === 0 ? '' : renderUserDictionaryFilters(query, filterValues);
  const selectedCount = selectedIds.size;
  const previews = `${state.importPreview ? renderUserDictionaryImportPreview(state.importPreview) : ''}${state.purgePreview ? renderUserDictionaryPurgePreview(state.purgePreview) : ''}`;
  const deleteSelectedLabel = `Delete selected (${selectedCount}) User Dictionary entr${selectedCount === 1 ? 'y' : 'ies'}`;
  return `${header}<h2>User Dictionary</h2><p class="settings-intro">${state.entries.length} entr${state.entries.length === 1 ? 'y' : 'ies'}, alphabetized case-insensitively by display term. ${visible.length} shown.</p><div class="settings-buttons">${iconButton('runCommand', 'data-action="kren.addToUserDictionary"', 'Add to User Dictionary', 'Add to User Dictionary', 'add')}${deleteIconButton('deleteSelectedUserDictionaryEntries', '', deleteSelectedLabel, selectedCount === 0)}<button class="secondary" data-command="exportUserDictionary" data-export-format="json" data-selected-only="true"${selectedCount === 0 ? ' disabled' : ''}>Export selected JSON</button><button class="secondary" data-command="exportUserDictionary" data-export-format="markdown" data-selected-only="true"${selectedCount === 0 ? ' disabled' : ''}>Export selected Markdown</button><button class="secondary" data-command="previewUserDictionaryImport">Import</button></div><p class="model-note${state.entries.length > 0 && visible.length === 0 ? ' dictionary-filter-empty-note' : ''}">JSON is lossless backup and restore. Markdown is human-readable and lossy by design.</p>${filters}${state.entries.length > 0 ? renderUserDictionaryPurgeControl() : ''}${previews}<div class="dictionary-layout"><section class="card dictionary-list"><h3 class="card-title">Entries</h3><div class="card-body">${list}</div></section><section class="card dictionary-detail"><h3 class="card-title">Details</h3><div class="card-body">${details}</div></section></div>`;
}

function renderUserDictionaryPurgeControl(): string {
  const options = userDictionaryPurgeSelectionOptions().map(([id, label]) =>
    `<option value="${id}"${id === 'olderThan3Months' ? ' selected' : ''}>${escapeHtml(label)}</option>`
  ).join('');
  return `<section class="dictionary-filters" aria-label="Purge controls"><select data-purge-selection aria-label="Purge period">${options}</select><button class="secondary" data-command="previewUserDictionaryPurge">Preview purge</button></section>`;
}

function renderUserDictionaryFilters(
  query: UserDictionaryListQuery,
  values: ReturnType<typeof userDictionaryFilterValues>
): string {
  const options = (items: readonly string[], selected: string | undefined) =>
    items.map((item) => `<option value="${escapeHtml(item)}"${item === selected ? ' selected' : ''}>${escapeHtml(item)}</option>`).join('');
  const sourceOptions = userDictionarySourceFilterOptions().map(([id, label]) =>
    `<option value="${id}"${id === (query.source ?? 'all') ? ' selected' : ''}>${escapeHtml(label)}</option>`
  ).join('');
  const captureOptions = userDictionaryCaptureFilterOptions().map(([id, label]) =>
    `<option value="${id}"${id === query.captureMode ? ' selected' : ''}>${escapeHtml(label)}</option>`
  ).join('');
  return `<section class="dictionary-filters" aria-label="User Dictionary search and filters"><input type="search" data-dictionary-search placeholder="Search term, aliases, meanings, tags, and collections" value="${escapeHtml(query.search ?? '')}"><select data-dictionary-filter="language" aria-label="Filter by language"><option value="">All languages</option>${options(values.languages, query.language)}</select><select data-dictionary-filter="collection" aria-label="Filter by collection"><option value="">All collections</option>${options(values.collections, query.collection)}</select><select data-dictionary-filter="entryType" aria-label="Filter by entry type"><option value="">All entry types</option>${options(values.entryTypes, query.entryType)}</select><select data-dictionary-filter="captureMode" aria-label="Filter by capture mode"><option value="">All capture modes</option>${captureOptions}</select><select data-dictionary-filter="source" aria-label="Filter by source availability">${sourceOptions}</select></section>`;
}

function renderUserDictionaryImportPreview(preview: UserDictionaryImportPreview): string {
  const blocked = preview.invalidRecordCount > 0 ||
    preview.duplicates.some((duplicate) => duplicate.source === 'import');
  return `<section class="card import-preview"><h3 class="card-title">Import preview</h3><div class="card-body"><p><strong>${preview.entryCount} records:</strong> ${preview.validEntryCount} valid, ${preview.duplicateCount} duplicates, ${preview.invalidRecordCount} invalid.</p><p><strong>Proposed changes:</strong> Merge adds ${preview.proposedAddCount} new entries. ${preview.storeDuplicateCount} stored duplicates will be kept or replaced only by the decision below. Replace all removes ${preview.currentEntryCount} current entries and installs the valid imported set.</p><p>No file or stored entry has been changed. Merge keeps existing duplicates unless you explicitly choose Replace duplicates. Replace all overwrites the complete current dictionary.</p>${blocked ? '<p class="storage-error"><strong>Import cannot be applied while invalid or internally duplicated records remain.</strong></p>' : ''}<div class="settings-buttons"><button data-command="applyUserDictionaryImport" data-import-mode="merge" data-duplicate-strategy="keepExisting"${blocked ? ' disabled' : ''}>Merge, keep existing</button><button class="secondary" data-command="applyUserDictionaryImport" data-import-mode="merge" data-duplicate-strategy="replaceExisting"${blocked ? ' disabled' : ''}>Merge, replace duplicates</button><button class="secondary" data-command="applyUserDictionaryImport" data-import-mode="replace"${blocked ? ' disabled' : ''}>Replace all</button><button class="secondary" data-command="cancelUserDictionaryImport">Cancel</button></div></div></section>`;
}

function renderUserDictionaryPurgePreview(preview: UserDictionaryPurgePreview): string {
  const terms = preview.terms.length > 0
    ? `<ul>${preview.terms.map((term) => `<li>${escapeHtml(term)}</li>`).join('')}</ul>`
    : '<p>No entries are affected.</p>';
  const deleteLabel = `Delete ${preview.count} previewed User Dictionary entr${preview.count === 1 ? 'y' : 'ies'}`;
  return `<section class="card purge-preview"><h3 class="card-title">Purge preview</h3><div class="card-body"><p><strong>${preview.count} entr${preview.count === 1 ? 'y' : 'ies'} will be deleted.</strong> Confirmation deletes exactly these previewed identifiers, even if time passes or entry ages change.</p>${terms}<div class="settings-buttons">${deleteIconButton('confirmUserDictionaryPurge', '', deleteLabel, preview.count === 0)}<button class="secondary" data-command="cancelUserDictionaryPurge">Cancel</button></div></div></section>`;
}

function hasSelectedUserDictionaryMerriamWebsterKey(settings: KrenPanelSettings): boolean {
  return Boolean(settings.credentialPresence?.merriamWebsterCollegiate);
}

/**
 * The meaning the captured sentence uses, above the full list and before it.
 *
 * The order inside the box is the reader's: what the word means, then what it is close to,
 * and the sentence itself last. The sentence is evidence for the meaning rather than the
 * answer to "what does this mean", so it reads after the thing it supports.
 *
 * The matched sense is not removed from the list below. A dictionary entry that hid every
 * meaning except the one encountered once would stop being a dictionary entry, and the
 * reader saved the word to learn it rather than to record one sighting of it.
 */
function renderCapturedContext(entry: UserDictionaryEntryV1): string {
  const context = entry.capturedContext;
  if (!context) return '';
  const matched = context.senseId
    ? entry.senses.find((sense) => sense.id === context.senseId)
    : undefined;
  const sentence = `<p class="captured-sentence">${escapeHtml(context.sentence)}</p>`;
  if (!matched) {
    // Stated rather than left blank. A box holding only the captured text looks like a
    // rendering failure, and "it did not settle it" is the honest reading of a -1.
    return `<div class="captured-context"><h3>In the captured text</h3><p class="muted">This text did not single out one meaning.</p>${sentence}</div>`;
  }
  const partOfSpeech = matched.partOfSpeech?.trim();
  return `<div class="captured-context"><h3>In the captured text</h3>${partOfSpeech ? `<p class="captured-part-of-speech">${escapeHtml(partOfSpeech)}</p>` : ''}<p>${escapeHtml(matched.definition)}</p>${matched.usageNote ? `<p class="muted">${escapeHtml(matched.usageNote)}</p>` : ''}${matched.synonyms.length > 0 ? `<p><strong>Synonyms:</strong> ${escapeHtml(matched.synonyms.join(', '))}</p>` : ''}${sentence}</div>`;
}

function renderUserDictionaryDetails(entry: UserDictionaryEntryV1): string {
  // The part of speech is repeated on a sense only when the senses disagree about it. Three
  // senses all reading "adjective" under an entry whose filing line already says adjective
  // is three copies of one fact, and the owner asked for it to stop. Where they do differ,
  // it is the thing that separates them and has to stay.
  const partsOfSpeech = new Set(entry.senses.map((sense) => sense.partOfSpeech?.trim() ?? ''));
  const distinguishByPartOfSpeech = partsOfSpeech.size > 1;
  const senses = entry.senses.map((sense, index) => `<div class="dictionary-sense"><p class="sense-definition"><strong>${index + 1}.</strong>${distinguishByPartOfSpeech && sense.partOfSpeech ? ` <em class="sense-part-of-speech">${escapeHtml(sense.partOfSpeech)}</em>` : ''} ${escapeHtml(sense.definition)}</p>${sense.pronunciation ? `<p class="sense-pronunciation">${escapeHtml(sense.pronunciation)}</p>` : ''}${sense.usageNote ? `<p class="muted">${escapeHtml(sense.usageNote)}</p>` : ''}${sense.synonyms.length > 0 ? `<p><strong>Synonyms:</strong> ${escapeHtml(sense.synonyms.join(', '))}</p>` : ''}${sense.examples.map((example) => `<blockquote>${escapeHtml(example)}</blockquote>`).join('')}</div>`).join('');
  const entryAttribute = `data-entry-id="${escapeHtml(entry.id)}"`;
  const entryLabel = `User Dictionary entry ${entry.term}`;
  const actions = `<div class="settings-buttons entry-actions">${readAloudIconButton('readUserDictionaryEntry', entryAttribute, entry.term)}${stopSpeechIconButton()}${editIconButton('editUserDictionaryEntry', entryAttribute, `Edit ${entryLabel}`)}${deleteIconButton('deleteUserDictionaryEntry', entryAttribute, `Delete ${entryLabel}`)}</div>`;
  return `<h2>${escapeHtml(entry.term)}</h2>${actions}<p class="dictionary-meta">${escapeHtml(entry.entryType)} | ${escapeHtml(entry.language)} | ${escapeHtml(entry.collection)}</p>${entry.pronunciation?.display ? `<p><strong>Pronunciation:</strong> ${escapeHtml(entry.pronunciation.display)}</p>` : ''}${renderCapturedContext(entry)}<h3>${entry.capturedContext ? 'All meanings' : 'Meanings'}</h3>${senses}<p class="dictionary-meta">${escapeHtml(userDictionarySourceLine(entry))} Updated ${escapeHtml(entry.updatedAt)}.</p>`;
}



function renderUserDictionaryDraft(
  state: UserDictionaryViewState,
  settings: KrenPanelSettings,
  logoUris?: { light: string; dark: string }
): string {
  const entry = state.draft;
  const capture = state.capture ?? (entry ? {
    expression: entry.term,
    captureMode: entry.capture.mode,
    draft: entry,
    fallbackUsed: false
  } satisfies UserDictionaryCaptureResult : undefined);
  if (!capture) return '';
  const duplicate = state.duplicateId
    ? `<div class="duplicate-notice"><strong>This expression is already in your User Dictionary.</strong><div class="settings-buttons"><button data-command="openExistingUserDictionaryEntry">Open existing</button><button class="secondary" data-command="updateExistingUserDictionaryEntry">Update existing</button><button class="secondary" data-command="cancelUserDictionaryDraft">Cancel</button></div></div>`
    : '';
  const senses = entry?.senses.map((sense, index) => `<fieldset class="dictionary-sense" data-dictionary-sense><legend>Sense ${index + 1}</legend>${draftField('Part of speech', 'partOfSpeech', sense.partOfSpeech ?? '')}${draftField('Pronunciation, only if this sense sounds different', 'pronunciation', sense.pronunciation ?? '')}${draftArea('Definition', 'definition', sense.definition)}${draftArea('Usage note', 'usageNote', sense.usageNote ?? '')}${draftArea('Synonyms, comma or line separated', 'synonyms', sense.synonyms.join('\n'))}${draftArea('Antonyms, comma or line separated', 'antonyms', sense.antonyms.join('\n'))}${draftArea('Related terms, comma or line separated', 'relatedTerms', sense.relatedTerms.join('\n'))}${draftArea('Examples, one per line', 'examples', sense.examples.join('\n'))}</fieldset>`).join('') ?? '';
  const combinedDisabled = !hasSelectedUserDictionaryMerriamWebsterKey(settings);
  const modeOptions = `${capture.captureMode === 'manual' ? '<option value="manual" selected disabled>Manual or imported</option>' : ''}${userDictionaryCaptureModeOptions().map(([id, label]) =>
    `<option value="${escapeHtml(id)}"${id === capture.captureMode ? ' selected' : ''}${id === 'merriamWebsterAndLlm' && combinedDisabled ? ' disabled' : ''}>${escapeHtml(label)}</option>`
  ).join('')}`;
  const mode = `<label class="setting"><span><span class="setting-title">Capture mode</span><span class="setting-description">Changing mode regenerates the draft after confirmation. Merriam-Webster + LLM requires the Collegiate key.</span></span><select data-draft-capture-mode>${modeOptions}</select></label>`;
  const reference = renderUserDictionaryMerriamWebsterReview(capture, logoUris);
  const fallback = capture.fallbackUsed
    ? '<div class="duplicate-notice"><strong>LLM-only fallback shown.</strong> Merriam-Webster returned a genuine no-match and the fallback setting is enabled.</div>'
    : '';
  const personal = entry
    ? `<section class="card personal-draft"><h3 class="card-title">PERSONAL KREN ENTRY</h3><div class="card-body">${duplicate}<form>${draftField('Expression', 'term', entry.term)}${draftField('Language', 'language', entry.language)}${draftField('Entry type', 'entryType', entry.entryType)}${draftField('Collection', 'collection', entry.collection)}${draftArea('Pronunciation', 'pronunciation', entry.pronunciation?.display ?? '')}${draftArea('Domains, one per line', 'domains', entry.domains.join('\n'))}${draftArea('Tags, one per line', 'tags', entry.tags.join('\n'))}${draftArea('Aliases, one per line', 'aliases', entry.aliases.join('\n'))}${senses}<div class="actions"><button type="button" data-command="saveUserDictionaryDraft">Save personal entry</button><button type="button" class="secondary" data-command="regenerateUserDictionaryDraft"${capture.captureMode === 'manual' ? ' disabled' : ''}>Regenerate</button><button type="button" class="secondary" data-command="cancelUserDictionaryDraft">Cancel</button></div></form></div></section>`
    : `<section class="card personal-draft"><h3 class="card-title">PERSONAL KREN ENTRY</h3><div class="card-body"><p>The independent LLM draft is not shown because Merriam-Webster returned no match and fallback is off.</p><p class="model-note">Enable Fall back after a genuine no-match in User Dictionary settings, then regenerate. Nothing can be saved from this review.</p><div class="actions"><button type="button" class="secondary" data-command="regenerateUserDictionaryDraft">Regenerate</button><button type="button" class="secondary" data-command="cancelUserDictionaryDraft">Cancel</button></div></div></section>`;
  return `<section class="dictionary-draft"><h2>${state.editingId ? 'Edit User Dictionary Entry' : 'Add to User Dictionary'}</h2><p class="settings-intro">Review every personal field. Nothing is stored until Save, and only the personal entry is stored.</p>${mode}${combinedDisabled ? '<p class="model-note">Merriam-Webster + LLM is disabled because the selected reference-work key is not set.</p>' : ''}${reference}${fallback}${personal}</section>`;
}

function renderUserDictionaryMerriamWebsterReview(
  capture: UserDictionaryCaptureResult,
  logoUris?: { light: string; dark: string }
): string {
  const reference = capture.merriamWebster;
  if (!reference) return '';
  const title = "Merriam-Webster's Collegiate® Dictionary";
  let body: string;
  if (reference.result) {
    body = `<div class="provider-attribution">${renderProviderLogo(reference.result.providerId, logoUris)}<p>Live reference from ${escapeHtml(title)}.</p></div>${renderDictionary(reference.result)}`;
  } else if (reference.noMatch) {
    body = `<p><strong>No match</strong> for ${escapeHtml(reference.lookupTerm)}.</p>`;
  } else {
    body = `<p class="duplicate-notice"><strong>Lookup failed.</strong> ${escapeHtml(reference.failure ?? 'Merriam-Webster provider failure.')}</p><p class="model-note">This operational failure did not trigger the no-match fallback. The language-model operation remained independent.</p>`;
  }
  return `<section class="card merriam-webster-live-reference"><h3 class="card-title">MERRIAM-WEBSTER LIVE REFERENCE</h3><div class="card-body"><p class="dictionary-meta">${escapeHtml(title)}. Live content is not stored with the personal entry.</p>${body}</div></section>`;
}

function draftField(label: string, name: string, value: string): string {
  return `<label class="setting"><span class="setting-title">${escapeHtml(label)}</span><input type="text" name="${escapeHtml(name)}" value="${escapeHtml(value)}"></label>`;
}

function draftArea(label: string, name: string, value: string): string {
  return `<label class="setting"><span class="setting-title">${escapeHtml(label)}</span><textarea name="${escapeHtml(name)}">${escapeHtml(value)}</textarea></label>`;
}

function rewriteModeSetting(activeModeId: RewriteModeId | undefined): string {
  const current = activeModeId ?? 'custom';
  const options = rewriteModeOptions().map(([id, label]) =>
    `<option value="${escapeHtml(id)}"${id === current ? ' selected' : ''}>${escapeHtml(label)}</option>`
  ).join('');
  return `<label class="setting"><span><span class="setting-title">Mode</span><span class="setting-description">A mode writes its eight tabled axes. The label is always recomputed from the current axis values.</span></span><select data-rewrite-mode><option value="custom"${current === 'custom' ? ' selected' : ''} disabled>${CUSTOM_REWRITE_MODE_LABEL}</option>${options}</select></label>`;
}

/**
 * The apply bar, shown only after the gear on a rewrite result brought the reader here.
 *
 * The note carries the instruction, because the control beside it is an icon and an icon
 * cannot say what it will do to the thing you are looking at. Both states name the same
 * subject, so the sentence changes only where the meaning changes.
 */
function rewriteApplyBar(replay: RewriteReplayState | undefined): string {
  if (!replay?.armed) return '';
  const note = replay.running
    ? `Producing the ${replay.subject} again.`
    : replay.changed
      ? `Regenerate the ${replay.subject} with these settings.`
      : `Change a setting below, then regenerate the ${replay.subject}.`;
  return `<div class="apply-bar"><p class="apply-note">${escapeHtml(note)}</p>${iconButton(
    'regenerateResult',
    '',
    'Regenerate',
    `Regenerate the ${replay.subject} with these settings`,
    'regenerate',
    !replay.changed || replay.running,
    false,
    'icon-button'
  )}</div>`;
}

/**
 * The one foldable used by every settings group that has a routing or axis section.
 *
 * Rewrite Text opens one group at a time and remembers which, through data-rewrite-group;
 * the other four features have a single group each and remember open or closed through the
 * ordinary data-persist-id mechanism. Both shapes render through here, so the summary line,
 * the disclosure marker, and the field wrapper are defined once.
 */
function settingsFoldable(options: {
  label: string;
  summary: string;
  fields: string;
  detailsAttributes: string;
  summaryAttributes?: string;
  open: boolean;
  inactiveReason?: string;
}): string {
  // The class is rendered from the value KREN read, and data-enabled-for keeps it correct
  // after the reader changes the setting, before the panel next renders.
  const inactive = options.inactiveReason
    ? `<p class="model-note">${escapeHtml(options.inactiveReason)}</p>`
    : '';
  const summaryAttributes = options.summaryAttributes ? ` ${options.summaryAttributes}` : '';
  return `<details class="rewrite-settings-group${options.inactiveReason ? ' setting-inactive' : ''}" ${options.detailsAttributes}${options.open ? ' open' : ''}><summary${summaryAttributes}><span class="rewrite-group-name">${escapeHtml(options.label)}</span><span class="rewrite-group-summary">${escapeHtml(options.summary)}</span></summary><div class="rewrite-group-fields">${inactive}${options.fields}</div></details>`;
}

function rewriteSettingsGroup(
  id: RewriteSettingsGroup,
  label: string,
  summary: string,
  fields: string,
  activeGroup: RewriteSettingsGroup | undefined
): string {
  return settingsFoldable({
    label,
    summary,
    fields,
    detailsAttributes: `${id === 'routing' ? 'data-llm-routing="rewrite" ' : ''}data-rewrite-group="${id}"`,
    summaryAttributes: `data-rewrite-group-summary="${id}"`,
    open: activeGroup === id
  });
}

/**
 * LLM ROUTING for the five features that are not Rewrite Text. The label is the same string
 * in all six places because a reader scanning the settings page is looking for one heading,
 * not six that nearly match.
 */
function llmRoutingGroup(
  feature: 'translation' | 'grammar' | 'explain' | 'userDictionary' | 'tutor',
  summary: string,
  fields: string,
  enabledWhen?: { key: string; value: string; reason: string; active: boolean },
  tutorFoldable?: boolean
): string {
  const condition = enabledWhen
    ? ` data-enabled-for="${escapeHtml(enabledWhen.key)}" data-enabled-value="${escapeHtml(enabledWhen.value)}"`
    : '';
  return settingsFoldable({
    label: LLM_ROUTING_LABEL,
    summary,
    fields,
    detailsAttributes: tutorFoldable
      ? `data-llm-routing="${feature}" data-tutor-foldable data-tutor-child data-persist-id="tutor-routing"${condition}`
      : `data-llm-routing="${feature}" data-persist-id="settings-${feature}-routing"${condition}`,
    open: false,
    inactiveReason: enabledWhen && !enabledWhen.active ? enabledWhen.reason : undefined
  });
}

/**
 * Every setting in the group and its current value, on the collapsed summary line.
 *
 * It listed only the settings that were off their default and printed "Defaults" when none
 * were, at the owner's request on 2026-08-22 to stop doing that. A group whose summary says
 * "Defaults" tells you nothing about what is inside it, so the only way to learn what the
 * group even controls was to open all eight of them. Written, General, and Preserve are
 * answers, and a reader checking their setup needs to read them rather than infer them from
 * an absence. The third element stays in the signature because the callers compute it and
 * the styling may want it later; nothing filters on it now.
 */
function tutorLiveVoiceLabel(name: string): string {
  const voice = TUTOR_LIVE_VOICES.find(
    ([candidate]) => candidate === normalizedTutorLiveVoice(name)
  )!;
  return `${voice[0]} (${voice[1]}, ${voice[2]})`;
}

function tutorConversationAdvancedSummary(values: {
  send: string; replies: string;
  pictureTransparency: string; balloonTransparency: string;
  microphoneSensitivity: string; pauseBeforeReply: string; speechDetection: string; microphoneCloseWait: string;
  pressToTalk: string; liveTranscriptionLanguage: string; takeHome: string; pictureStyle?: string;
}): string {
  const seconds = (value: string) => value.replace(/ seconds?$/u, 'sec');
  return [
    ...(values.replies === 'Live (Gemini)' ? [] : [`Send: ${values.send}`]),
    `Picture: ${[values.pictureStyle ?? 'Realistic', values.pictureTransparency, values.balloonTransparency].join(', ')}`,
    `Microphone: ${[values.microphoneSensitivity, seconds(values.pauseBeforeReply), values.speechDetection, seconds(values.microphoneCloseWait)].join(', ')}`,
    `Press to talk: ${values.pressToTalk}`,
    `Live transcription language: ${values.liveTranscriptionLanguage}`,
    `Take-home card: ${values.takeHome}`
  ].join(' | ');
}

function settingsSummary(
  settings: Array<[label: string, value: string, isDefault: boolean]>
): string {
  return settings.map(([label, value]) => `${label}: ${value}`).join(' | ');
}

function routingSettingsSummary(settings: LanguageModelRoutingPanelSettings, titles: Record<keyof typeof LLM_ROUTING_CONTROL_TITLES, string> = LLM_ROUTING_CONTROL_TITLES): string {
  return settingsSummary([
    [titles.provider,
      languageModelRoutingProviderLabel(settings.provider), settings.provider === 'gemini'],
    [titles.geminiProfile,
      settings.geminiProfile === 'standard' ? 'Free Tier' : 'Paid',
      settings.geminiProfile === 'standard'],
    [titles.model, settings.model, false],
    [titles.thinkingOrEffort,
      languageModelRoutingEffortLabel(settings.thinkingOrEffort), false],
    [titles.fallbackEnabled,
      settings.fallbackEnabled ? 'On' : 'Off', !settings.fallbackEnabled],
    [titles.fallbackModel, settings.fallbackModel, false],
    [titles.fallbackThinkingOrEffort,
      languageModelRoutingEffortLabel(settings.fallbackThinkingOrEffort), false]
  ]);
}

function rewriteVariantLabel(id: RewriteVariantListId): string {
  return REWRITE_VARIANT_LIST.find((variant) => variant.id === id)?.label ?? id;
}

// Icon-only controls are defined once and used by the header, rewrite variants, settings,
// and User Dictionary. An icon button carries no text, so the accessible name has to be
// supplied explicitly: title for the pointer, aria-label for a screen reader. Leaving
// either off turns the control into an unlabelled square for anyone not using a mouse.
function readAloudIconButton(command: string, dataAttribute: string, subject: string): string {
  return iconButton(command, dataAttribute, 'Read aloud', `Read ${subject} aloud`, 'speaker');
}

function stopSpeechIconButton(command = 'stopReadAloud', dataAttribute = ''): string {
  return iconButton(command, dataAttribute, 'Stop reading', 'Stop reading', 'stop');
}

// Copy carries the copy-confirmation attribute wherever it is drawn, because the panel
// confirms on the control the reader just pressed rather than in a corner of the window.
function copyIconButton(command: string, dataAttribute: string, subject: string): string {
  return iconButton(
    command,
    `${dataAttribute} data-copy-confirm`,
    'Copy',
    `Copy ${subject}`,
    'copy'
  );
}

function replaceIconButton(command: string, dataAttribute: string, subject: string): string {
  return iconButton(command, dataAttribute, 'Replace selection', `Replace the selection with ${subject}`, 'replace');
}

// The gear beside a result is what arms the Settings apply bar. Reaching Settings from the
// menu leaves the bar hidden, because there is no result behind it to return to.
function settingsIconButton(command: string, dataAttribute: string, subject: string): string {
  return iconButton(command, dataAttribute, 'Settings', `Open the settings for ${subject}`, 'settings');
}

function editIconButton(command: string, dataAttribute: string, label: string): string {
  return iconButton(command, dataAttribute, label, label, 'edit');
}

function deleteIconButton(
  command: string,
  dataAttribute: string,
  label: string,
  disabled = false,
  accessibleAttributesFirst = false
): string {
  return iconButton(
    command,
    dataAttribute,
    label,
    label,
    'delete',
    disabled,
    accessibleAttributesFirst
  );
}

// 2026-10-04: owner canvas glyphs, confined to panel markup.
function panelIconSvgMarkup(icon: IconName | 'add' | 'pause' | 'key' | 'tutor'): string {
  const svg = (content: string) => `<svg aria-hidden="true" viewBox="0 0 24 24">${content}</svg>`;
  if (icon === 'pause') return svg('<rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/>');
  if (icon === 'add') return svg('<path d="M12 5v14M5 12h14"/>');
  // 2026-10-20 (owner, canvas): header shortcuts. The tutor is a chat bubble with a sparkle (option B);
  // the plain sparkles stay the tutor's Ask mark.
  if (icon === 'tutor') return svg('<path d="M4 5.5h16v10.5H10l-4.5 3.5V16H4z"/><path d="M12 7.6l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z" fill="currentColor" stroke-width="1.2"/>');
  if (icon === 'key') return svg('<circle cx="7.5" cy="12" r="3.5"/><path d="M11 12h9.5M17 12v3M20 12v4"/>');
  if (icon === 'reset') return svg('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>');
  if (icon === 'information') return svg('<circle cx="14.2" cy="5.2" r="1.8" fill="currentColor" stroke="none"/><path d="M9.6 10.4l3.6-.6-2.3 8.6c-.35 1.3.75 1.8 1.65 1l1.25-1.1" stroke-width="2.4"/>');
  if (icon === 'support') return svg('<g stroke-width="3.4"><path d="M15.5 7.4A4 4 0 0 0 12 5.5h-.6A3.4 3.4 0 0 0 8 8.9c0 1.7 1.2 2.6 2.8 3l2.4.6c1.7.4 2.9 1.4 2.9 3.1a3.4 3.4 0 0 1-3.5 2.9h-.8a4 4 0 0 1-3.6-2"/></g>');
  if (icon === 'primary') return iconSvgMarkup(icon).replace('<path ', '<g stroke-width="3.4"><path ').replace('</svg>', '</g></svg>');
  return iconSvgMarkup(icon);
}

function iconButton(
  command: string | undefined,
  dataAttribute: string,
  title: string,
  ariaLabel: string,
  icon: IconName | 'add' | 'pause' | 'key' | 'tutor',
  disabled = false,
  accessibleAttributesFirst = false,
  className = 'secondary icon-button',
  trailingAttributes = ''
): string {
  const accessibleAttributes = ` title="${escapeHtml(title)}" aria-label="${escapeHtml(ariaLabel)}"`;
  const actionAttributes = dataAttribute ? ` ${dataAttribute}` : '';
  const commandAttribute = command === undefined ? '' : ` data-command="${escapeHtml(command)}"`;
  return `<button class="${className}"${commandAttribute}${accessibleAttributesFirst ? accessibleAttributes : actionAttributes}${accessibleAttributesFirst ? actionAttributes : accessibleAttributes}${trailingAttributes}${disabled ? ' disabled' : ''}>${panelIconSvgMarkup(icon)}</button>`;
}

// One definition of the credit line. It was written out twice in this file and pinned
// twice more in tests, so changing the attribution meant editing four places and the
// tests only caught it because they happened to quote the whole string.
export function krenCreditLine(version: string): string {
  return `Designed &amp; Developed by T.H. YANG using CLAUDE CODE and CODEX · Version ${escapeHtml(version)}`;
}

function credentialRow(
  id: CredentialHelpId,
  openHelp: CredentialHelpId | undefined,
  setAction: string,
  deleteAction: string,
  stored: boolean,
  extraAction?: string,
  extraLabel?: string,
  extraRequiresKey = true,
  unavailableReason?: string
): string {
  const { label, sentence, linkText } = CREDENTIAL_HELP[id];
  const informationId = `credential-${id}-information`;
  const expanded = openHelp === id;
  const information = iconButton(
    undefined, 'data-tutor-info-toggle', `Where to get the ${label}`, `Where to get the ${label}`,
    'information', false, false, 'secondary icon-button tutor-map-information',
    ` aria-controls="${informationId}" aria-expanded="${expanded}"`
  );
  const note = `<aside id="${informationId}" class="tutor-target-info" aria-label="Where to get the ${escapeHtml(label)}"${expanded ? '' : ' hidden'}><p>${escapeHtml(sentence)} <a href="#" data-credential-help="${id}">${escapeHtml(linkText)}</a></p></aside>`;
  const blockedReason = stored ? undefined : unavailableReason;
  const usageAction = id === 'geminiDefault' || id === 'geminiAlternate' ? 'kren.openGeminiUsage'
    : id === 'googleCloudTranslation' ? 'kren.showGoogleCloudTranslationUsage' : undefined;
  const usage = usageAction ? `<button class="secondary" data-command="runCommand" data-action="${usageAction}">Usage</button>` : '';
  const extra = extraAction && extraLabel
    ? `<button class="secondary" data-command="runCommand" data-action="${escapeHtml(extraAction)}"${extraRequiresKey && !stored ? ' disabled' : ''}>${escapeHtml(extraLabel)}</button>`
    : '';
  // Set and Remove became a floppy disk and a waste basket on 2026-08-22, at the owner's
  // request. Nine rows of two word-buttons wrapped onto three lines each in the Secondary
  // Sidebar. The accessible name still says which key and which action, because an icon
  // that only means "save" would leave nine identical squares on the screen.
  const set = iconButton(
    'runCommand',
    `data-action="${escapeHtml(setAction)}"`,
    `Set ${label} key`,
    `Set the ${label} API key`,
    'save',
    stored || Boolean(blockedReason)
  );
  const remove = deleteIconButton(
    'runCommand',
    `data-action="${escapeHtml(deleteAction)}"`,
    `Remove the ${label} API key`,
    !stored
  );
  return `<div class="credential-row${blockedReason ? ' unavailable' : ''}"><span class="credential-label"><span class="information-heading">${information}<span class="credential-name">${escapeHtml(label)}</span></span> ${blockedReason ? `<span class="credential-reason">${escapeHtml(blockedReason)}</span>` : ''}</span><span class="settings-buttons">${set}${remove}${extra}${usage}</span>${note}</div>`;
}

function rewriteVariantOptions(): Array<[string, string]> {
  return REWRITE_VARIANT_LIST.map(({ id, label }) => [id, label]);
}

type LanguageModelRoutingSettingPrefix =
  | 'global'
  | 'translation'
  | 'explanation'
  | 'rewrite'
  | 'userDictionary'
  | 'tutor';

function credentialMissing(presence: NonNullable<KrenPanelSettings['credentialPresence']>, provider: string, profile: string): boolean {
  if (provider === 'cloudflare') return !presence.cloudflareAccountId || !presence.cloudflareApiToken;
  if (provider === 'googleCloudTextToSpeech') return !presence.googleCloudTextToSpeech && !presence.googleCloudTranslation;
  const slot = provider === 'gemini' ? profile === 'pro' ? 'geminiAlternate' : 'geminiDefault' : provider;
  return !presence[slot as KrenCredentialId];
}

/** Presence changes presentation only. These rules never write a choice or disable a control. */
function credentialControlState(key: string, presence: NonNullable<KrenPanelSettings['credentialPresence']>,
  value: (key: string) => unknown, isMissing: typeof credentialMissing): { missing: boolean; options?: Record<string, boolean> } | undefined {
  const missing = (provider: string, profile = 'standard') => isMissing(presence, provider, profile);
  const providers = (profile: string) => Object.fromEntries(['gemini', 'openai', 'anthropic', 'groq', 'cloudflare']
    .map(provider => [provider, missing(provider, profile)]));
  if (key === 'tutor.speechProvider' || key === 'tutor.pictureProvider') {
    const profile = key === 'tutor.pictureProvider' ? 'pro' : 'standard';
    const options: Record<string, boolean> = key === 'tutor.pictureProvider'
      ? { gemini: missing('gemini', profile), cloudflare: missing('cloudflare') }
      : { gemini: missing('gemini'), cloudflare: missing('cloudflare'), groq: missing('groq') };
    return { missing: Boolean(options[String(value(key))]), options };
  }
  if (key === 'tutor.imageModel' || key === 'tutor.cloudflareImageModel') {
    return { missing: missing(String(value('tutor.pictureProvider')), 'pro') };
  }
  if (key === 'tutor.liveGeminiProfile') return { missing: missing('gemini', String(value(key))),
    options: { standard: missing('gemini', 'standard'), pro: missing('gemini', 'pro') } };
  if (key === 'tutor.liveModel') return { missing: missing('gemini', String(value('tutor.liveGeminiProfile'))) };
  const match = /^(global|translation|explanation|rewrite|userDictionary|tutor)\.(provider|geminiProfile|model|alternateModel|thinkingOrEffort|fallbackEnabled|fallbackModel|fallbackThinkingOrEffort|hintModel|hintThinkingOrEffort)$/.exec(key);
  if (!match) return undefined;
  const prefix = match[1]!, field = match[2]!;
  const provider = String(value(prefix + '.provider'));
  const profile = String(value(prefix + '.geminiProfile'));
  if (field === 'provider') return { missing: missing(provider, profile), options: providers(profile) };
  if (field === 'geminiProfile') return { missing: missing('gemini', profile),
    options: { standard: missing('gemini', 'standard'), pro: missing('gemini', 'pro') } };
  // Both stored model slots are rendered, even when only one profile is visible.
  return { missing: field === 'alternateModel' ? missing('gemini', 'pro')
    : field === 'model' && provider === 'gemini' ? missing('gemini', 'standard') : missing(provider, profile) };
}

/** Annotate only generated routing controls, using the same state rule as mounted updates. */
function grayCredentialRoutingMarkup(markup: string, presence: NonNullable<KrenPanelSettings['credentialPresence']>): string {
  const selected = new Map<string, string>();
  const selects = /<select\b([^>]*)>([\s\S]*?)<\/select>/g;
  for (const match of markup.matchAll(selects)) {
    const key = /data-setting="([^"]+)"/.exec(match[1]!)?.[1];
    if (key) selected.set(key, /<option\b[^>]*value="([^"]*)"[^>]* selected\b/.exec(match[2]!)?.[1] ?? '');
  }
  const value = (key: string) => selected.get(key);
  const annotate = (tag: string, missing: boolean) => !missing ? tag : tag.replace(/>$/, ' class="credential-missing" aria-description="No key stored">');
  const stateFor = (attributes: string) => {
    const key = /data-(?:setting|model-preset)="([^"]+)"/.exec(attributes)?.[1];
    return key ? credentialControlState(key, presence, value, credentialMissing) : undefined;
  };
  return markup.replace(selects, (whole, attributes: string, options: string) => {
    const state = stateFor(attributes);
    if (!state) return whole;
    return annotate(`<select${attributes}>`, state.missing) + options.replace(/<option\b[^>]*>/g, tag => {
      const id = /value="([^"]*)"/.exec(tag)?.[1] ?? '';
      return annotate(tag, state.options ? Boolean(state.options[id]) : state.missing);
    }) + '</select>';
  }).replace(/<input\b[^>]*>/g, tag => annotate(tag, stateFor(tag)?.missing ?? false));
}

/** Every variant is rendered as presence information so selection can patch without a request. */
function credentialSettingNote(settings: KrenPanelSettings, key: string, selected: string,
  profile: GeminiRoutingProfile = 'standard', profileKey = ''): string {
  const providers: CredentialProvider[] = ['gemini', 'openai', 'anthropic', 'groq', 'cloudflare', 'googleCloudTranslation', 'googleCloudTextToSpeech'];
  const notes: Record<string, string> = {};
  for (const provider of providers) for (const variant of ['standard', 'pro'] as const) {
    notes[provider + ':' + variant] = missingCredentialSelectionMessage(missingCredentialDetails(provider, variant));
  }
  const provider = selected === 'googleChirp' ? 'googleCloudTextToSpeech' : key === 'translationProvider' && selected === 'gemini' ? '' : selected;
  const base = credentialMissing(settings.credentialPresence ?? {}, provider, profile) ? notes[provider + ':' + profile] ?? '' : '';
  const message = base + (base && profileKey ? otherGeminiProfileMessage(provider, profile, settings.credentialPresence) : '');
  return `<p class="model-note" data-credential-setting="${escapeHtml(key)}" data-credential-profile="${profile}" data-credential-profile-setting="${escapeHtml(profileKey)}" data-credential-notes="${escapeHtml(JSON.stringify(notes))}"${message ? '' : ' hidden'}><span>${escapeHtml(message)}</span> <a href="#" data-command="showCredentials">Open Credentials</a></p>`;
}

/** The complete routing control set. Every one of the six groups calls this helper. */
function providerSettings(
  prefix: LanguageModelRoutingSettingPrefix,
  values: LanguageModelRoutingPanelSettings,
  settings: KrenPanelSettings,
  proModels: GeminiModelOption[],
  openAIModels: GeminiModelOption[],
  anthropicModels: GeminiModelOption[],
  translationOnly = false,
  knownLiveModels: readonly GeminiModelOption[] = []
): string {
  const titles = prefix === 'tutor' ? TUTOR_LLM_ROUTING_CONTROL_TITLES : LLM_ROUTING_CONTROL_TITLES;
  const providerKey = `${prefix}.provider`;
  const profileKey = `${prefix}.geminiProfile`;
  const modelKey = `${prefix}.model`;
  const thinkingKey = `${prefix}.thinkingOrEffort`;
  const fallbackEnabledKey = `${prefix}.fallbackEnabled`;
  const fallbackModelKey = `${prefix}.fallbackModel`;
  const fallbackThinkingKey = `${prefix}.fallbackThinkingOrEffort`;
  const providerOptions = languageModelRoutingProviderOptions()
    .map(([id, label]): [string, string, boolean?] => [id, label, translationOnly && (id === 'openai' || id === 'anthropic')]);
  // The Gemini row reads refreshGeminiModels, which queries the default Gemini key. Until
  // 1.7.7 it read refreshProModels, so pressing Refresh on the Default profile queried the
  // alternate key and reported "for the alternate profile": with no alternate key stored,
  // nothing came back and the list did not change, which is what the owner saw.
  const [models, refreshCommand] = values.provider === 'openai'
    ? [openAIModels, 'refreshOpenAIModels' as const]
    : values.provider === 'anthropic'
      ? [anthropicModels, 'refreshAnthropicModels' as const]
      : values.provider === 'groq' ? [settings.groqModels ?? GROQ_MODELS.map(id => ({ id, displayName: id })), 'refreshGroqModels' as const]
        : values.provider === 'cloudflare' ? [CLOUDFLARE_TEXT_MODELS.map(id => ({ id, displayName: id })), undefined]
          : [proModels, 'refreshGeminiModels' as const];
  const retryControls = prefix === 'tutor' || prefix === 'global'
    ? ''
    : values.provider === 'gemini'
      ? `${toggleSetting('Automatic retry', 'Retry temporary failures with the current provider. Provider switching is set separately under Usage.', 'gemini.retry.enabled', settings.geminiRetryEnabled)}
      ${selectSetting('Maximum attempts', 'Includes the initial request. Higher values may take longer.', 'gemini.retry.maxAttempts', String(settings.geminiRetryMaxAttempts), [
        ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4 (recommended)'], ['5', '5']
      ])}`
      : languageModelRetryControls(settings);
  const fallbackControls = prefix === 'tutor' ? toggleSetting(
    TUTOR_LLM_ROUTING_CONTROL_TITLES.fallbackEnabled,
    'After eligible Gemini failures, retry Thorough with Fast using the same profile; Fast cannot fall back to itself.',
    fallbackEnabledKey, values.fallbackEnabled
  ) : `${toggleSetting(
      titles.fallbackEnabled,
      'Use the same-provider Gemini fallback on Free Tier or Paid when the model, retries, or structured output fail.',
      fallbackEnabledKey,
      values.fallbackEnabled
    )}
    ${modelSetting(
      titles.fallbackModel,
      'The result identifies both models whenever the result format supports a fallback notice.',
      fallbackModelKey,
      values.fallbackModel,
      proModels,
      settings.customGeminiModels ?? [],
      'gemini',
      'refreshProModels',
      knownLiveModels
    )}
    ${selectSetting(
      titles.fallbackThinkingOrEffort,
      'Applied independently when the fallback model is used.',
      fallbackThinkingKey,
      values.fallbackThinkingOrEffort,
      languageModelRoutingEffortOptions()
    )}`;
  const fallbackGroup = `<div class="conditional-group" data-provider-for="${providerKey}" data-provider-value="gemini">
    ${fallbackControls}
  </div>`;

  return `${selectSetting(
      titles.provider,
      translationOnly
        ? 'Gemini, Groq, and Cloudflare provide translation routes. OpenAI and Anthropic remain listed and unselectable.'
        : 'Uses the matching credential already stored by KREN.',
      providerKey,
      values.provider,
      providerOptions
    )}
    <div class="conditional-group" data-provider-for="${providerKey}" data-provider-value="gemini">
      ${selectSetting(
        titles.geminiProfile,
        'Free Tier and Paid use their separately stored Gemini credentials.',
        profileKey,
        values.geminiProfile,
        [['standard', 'Free Tier'], ['pro', 'Paid']]
      )}
    </div>
    ${credentialSettingNote(settings, providerKey, values.provider, values.geminiProfile, profileKey)}
    ${modelSlots(
      modelKey,
      `${prefix}.alternateModel`,
      providerKey,
      profileKey,
      values,
      models,
      proModels,
      settings,
      refreshCommand,
      knownLiveModels,
      titles.model
    )}
    ${selectSetting(
      titles.thinkingOrEffort,
      'Sent when supported by the selected provider and model.',
      thinkingKey,
      values.thinkingOrEffort,
      languageModelRoutingEffortOptions()
    )}
    ${fallbackGroup}
    ${retryControls}`;
}

function languageModelRetryControls(settings: KrenPanelSettings): string {
  return `${toggleSetting('Automatic retry', 'Retry temporary failures with the current provider. Provider switching is set separately under Usage.', 'languageModel.retry.enabled', settings.languageModelRetryEnabled)}
    ${selectSetting('Maximum attempts', 'Includes the initial request.', 'languageModel.retry.maxAttempts', String(settings.languageModelRetryMaxAttempts), [
      ['1', '1'], ['2', '2'], ['3', '3 (recommended)'], ['4', '4'], ['5', '5']
    ])}`;
}

function selectSetting(
  title: string,
  description: string,
  key: string,
  value: string,
  options: Array<[string, string, boolean?]>
): string {
  const numeric = Number(value);
  const speechRate = key === 'readAloud.rate' || key === 'readAloud.edgeRatePercent';
  const valid = Number.isInteger(numeric) && (key === 'readAloud.rate'
    ? numeric >= -10 && numeric <= 10 : numeric >= -50 && numeric <= 100);
  if (speechRate && valid && !options.some(([id]) => id === value)) {
    options = [...options, [value, key === 'readAloud.rate' ? value : `${value}%`]];
  }
  return `<label class="setting"><span><span class="setting-title">${escapeHtml(title)}</span><span class="setting-description">${escapeHtml(description)}</span></span><select data-setting="${escapeHtml(key)}">${options.map(([optionValue, label, disabled]) => `<option value="${escapeHtml(optionValue)}"${optionValue === value ? ' selected' : ''}${disabled ? ' disabled' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label>`;
}

function tutorVoiceDefaultSetting(
  title: string,
  description: string,
  key: string,
  command: string,
  value: string,
  options: Array<[string, string, boolean?]>
): string {
  return `<label class="setting"><span><span class="setting-title">${escapeHtml(title)}</span><span class="setting-description">${escapeHtml(description)}</span></span><select data-tutor-voice-setting="${escapeHtml(key)}" data-tutor-voice-command="${escapeHtml(command)}">${options.map(([optionValue, label, disabled]) => `<option value="${escapeHtml(optionValue)}"${optionValue === value ? ' selected' : ''}${disabled ? ' disabled' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label>`;
}

function textSetting(title: string, description: string, key: string, value: string): string {
  return `<label class="setting"><span><span class="setting-title">${escapeHtml(title)}</span><span class="setting-description">${escapeHtml(description)}</span></span><input type="text" data-setting="${escapeHtml(key)}" value="${escapeHtml(value)}"></label>`;
}

/**
 * The Model control, drawn twice: once for the Default Gemini profile and every non-Gemini
 * provider, once for the Alternate Gemini profile. Only one of the two is visible, and the
 * visible one writes to its own setting.
 *
 * One control writing to one `<feature>.model` slot was the defect the owner reported on
 * 2026-08-28 as two: "setting one should not affect the other" for the model, and a Refresh
 * button whose notification named the alternate profile whichever profile was on screen.
 * Both follow from a single slot and a single refresh command, so both are fixed here.
 *
 * The discovered list stays shared, which the owner asked for in the same message: "Model
 * refresh could be a mutual update, but it should not change the model selected for
 * another." Refreshing from either slot updates the suggestions in both and moves no
 * stored value.
 */
/**
 * The language an explanation is written in, offered as a list rather than a typed code.
 *
 * The owner asked on 2026-08-28 for "Same as source" first, then the languages already
 * listed under Read Aloud Language/Region, so the two features name the same twenty
 * languages from one catalog instead of two hand-written lists.
 *
 * Bilingual was removed on the owner's instruction, 2026-08-28: "I do not need that
 * Bilingual (English and Korean). Remove it." Same as source is the default in its place,
 * and a stored `bilingual` is migrated to it once, at activation. A stored value the list
 * does not carry, such as a code typed into the setting before this control existed, is
 * added at the end and kept selected rather than silently replaced.
 */
/**
 * The two languages a translation runs between, each chosen from the same catalog Read Aloud
 * uses.
 *
 * One free-text field held the target until 1.7.8, taking `auto-en-ko` or a bare code, and
 * there was no control for the input language at all: every request went out with the source
 * marked `auto`. The owner asked on 2026-08-28 for "input and output language two dropdown
 * menus, the list there same as read aloud language/region dropdown".
 *
 * The two lists differ by one entry, which is why they are built here rather than from one
 * shared array. The input opens with Auto-detect, meaning "work the language out from the
 * text", on the same gate Read Aloud uses: it answers only on clear evidence and otherwise
 * leaves the provider's own detection to decide. The output has no Auto at all. It carried
 * `auto-en-ko` until 1.7.9, sending English to Korean and Korean to English, and the owner
 * removed it because an output that changes with the input is a second detection the reader
 * cannot see on the control. The case it existed to avoid, translating a language into
 * itself, is now a warning on the result.
 */
function translationLanguageSettings(source: string, target: string): string {
  const catalog = EDGE_SPEECH_LOCALES.map((entry): [string, string] => [entry.id, entry.label]);
  const sourceOptions: Array<[string, string]> = [
    [TRANSLATION_AUTO_SOURCE, 'Auto-detect'],
    ...catalog
  ];
  // No Auto here. The owner removed it on 2026-08-28: an output language that changes with
  // the input is a second detection the reader cannot see, and the panel now warns when the
  // two agree rather than quietly swapping the target.
  const targetOptions = translationTargetLanguageOptions(target);
  if (source && !sourceOptions.some(([id]) => id === source)) {
    sourceOptions.push([source, `${source} (stored)`]);
  }
  return `${selectSetting(
      'Input language',
      'Auto-detect works like Read Aloud and defers to the provider when unsure. A named language is sent as the source.',
      'translation.sourceLanguage',
      source,
      sourceOptions
    )}
    ${selectSetting(
      'Output language',
      'The language to translate into. KREN warns if the text is already in that language.',
      'translation.targetLanguage',
      target,
      targetOptions
    )}`;
}

function translationTargetLanguageOptions(...targets: string[]): Array<[string, string]> {
  const options = EDGE_SPEECH_LOCALES.map(
    (entry): [string, string] => [entry.id, entry.label]
  );
  for (const target of targets) {
    if (target && !options.some(([id]) => id === target)) {
      options.push([target, `${target} (stored)`]);
    }
  }
  return options;
}

function explanationLanguageSetting(value: string): string {
  const options: Array<[string, string]> = [
    [EXPLANATION_SAME_AS_SOURCE, 'Same as source'],
    ...EDGE_SPEECH_LOCALES.map((entry): [string, string] => [entry.id, entry.label])
  ];
  if (value && !options.some(([id]) => id === value)) options.push([value, `${value} (stored)`]);
  return selectSetting(
    'Explanation language',
    'Same as source writes the explanation in the language of the text you selected.',
    'explanation.outputLanguage',
    value,
    options
  );
}

function modelSlots(
  modelKey: string,
  alternateModelKey: string,
  providerKey: string,
  profileKey: string,
  values: LanguageModelRoutingPanelSettings,
  models: GeminiModelOption[],
  proModels: GeminiModelOption[],
  settings: KrenPanelSettings,
  refreshCommand: 'refreshGeminiModels' | 'refreshOpenAIModels' | 'refreshAnthropicModels' | 'refreshGroqModels' | undefined,
  knownLiveModels: readonly GeminiModelOption[] = [],
  modelTitle: string = LLM_ROUTING_CONTROL_TITLES.model
): string {
  const shared = modelKey === 'tutor.model' ? 'Lessons, practice, reviews, corrections, the take-home card and diagnosis.'
    : 'Pick a discovered model or enter a compatible identifier.';
  const customModels = values.provider === 'openai' ? settings.customOpenAIModels ?? []
    : values.provider === 'anthropic' ? settings.customAnthropicModels ?? []
      : values.provider === 'groq' ? settings.customGroqModels ?? []
        : values.provider === 'cloudflare' ? settings.customCloudflareModels ?? []
      : settings.customGeminiModels ?? [];
  return `<div class="conditional-group" data-model-slot="default" data-provider-for="${providerKey}" data-gemini-profile-for="${profileKey}">
      ${modelSetting(
        modelTitle,
        shared,
        modelKey,
        routedModel(values.provider, values.model),
        models,
        customModels,
        values.provider,
        refreshCommand,
        knownLiveModels
      )}
    </div>
    <div class="conditional-group" data-model-slot="alternate" data-provider-for="${providerKey}" data-gemini-profile-for="${profileKey}">
      ${modelSetting(
        modelTitle,
        `${shared} Saved for the Gemini Paid profile only.`,
        alternateModelKey,
        routedModel('gemini', values.alternateModel),
        proModels,
        settings.customGeminiModels ?? [],
        'gemini',
        'refreshProModels',
        knownLiveModels
      )}
    </div>`;
}

/**
 * The Model control: a list of discovered models, plus a field for one the list has not got.
 *
 * It was a text input backed by a `<datalist>` until 1.7.8. A datalist filters its options
 * against whatever is already typed in the field, so with `gemini-3.6-flash` in the box the
 * reader saw exactly one suggestion, and the nine models a Refresh had just discovered were
 * unreachable without first clearing the field. The owner reported it as "Model selection
 * has a dropdown menu, but it doesn't provide the list of that 9 models at all", which is
 * precisely what a filtered datalist looks like from the outside.
 *
 * A `<select>` cannot filter itself away, so every discovered model is visible. The editable
 * field below it appears for Custom model identifier. Add stores and selects the typed
 * identifier, while an unlisted stored value remains visible in that field.
 */
function modelIconButton(command: string, attributes: string, label: string, kind: 'refresh' | 'add' | 'remove'): string {
  const paths = kind === 'refresh' ? '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5"/>'
    : kind === 'add' ? '<path d="M12 5v14M5 12h14"/>' : '<path d="m6 6 12 12M18 6 6 18"/>';
  return `<button type="button" class="icon-button model-icon-button" data-command="${command}" ${attributes} aria-label="${label}" title="${label}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg></button>`;
}

function modelSetting(
  title: string,
  description: string,
  key: string,
  value: string,
  models: GeminiModelOption[],
  customModels: string[],
  provider: LanguageModelRoutingProvider | 'geminiLive' | 'geminiImage',
  refreshCommand?: 'refreshGeminiImageModels' | 'refreshGeminiModels' | 'refreshGeminiLiveModels' | 'refreshProModels' | 'refreshOpenAIModels' |
    'refreshAnthropicModels' | 'refreshGroqModels',
  knownLiveModels: readonly GeminiModelOption[] = []
): string {
  if (provider === 'groq') {
    value = GROQ_RETIRED_MODELS[value.trim()] ?? value;
    customModels = customModels.filter((model) => !GROQ_RETIRED_MODELS[model]);
  }
  const refresh = refreshCommand
    ? modelIconButton(refreshCommand, '', 'Refresh models', 'refresh')
    : '';
  const listedModels = [
    ...customModels.map((id) => ({ id, displayName: id })),
    ...models.filter((model) => !customModels.includes(model.id))
  ];
  const listed = listedModels.some((model) => model.id === value);
  const options = listedModels
    .map((model) => `<option value="${escapeHtml(model.id)}"${model.id === value ? ' selected' : ''}>${escapeHtml(model.displayName)}</option>`)
    .join('');
  // Present whenever the stored value is not one of the discovered models, and selected then,
  // so the control never shows a model the reader is not actually using.
  const custom = listed
    ? '<option value="__custom__">Custom model identifier</option>'
    : '<option value="__custom__" selected>Custom model identifier</option>';
  const owned = customModels.length === 0 ? ''
    : `<ul class="model-owned-list" aria-label="Models you added">${customModels.map((model) => `<li><code>${escapeHtml(model)}</code>${modelIconButton('removeCustomModel', `data-model-provider="${provider}" data-model-id="${escapeHtml(model)}"`, 'Remove model', 'remove')}</li>`).join('')}</ul>`;
  const ordinaryLiveWarning = provider === 'gemini' &&
    isKnownGeminiLiveOnlyModel(value, knownLiveModels)
    ? ' This is a Live-only model and cannot answer ordinary requests. Choose another identifier here, and keep this one in Live model.'
    : '';
  return `<label class="setting"><span><span class="setting-title">${escapeHtml(title)}</span><span class="setting-description">${escapeHtml(description)}${escapeHtml(ordinaryLiveWarning)}</span></span><span class="setting-control"><select data-model-preset="${escapeHtml(key)}" data-model-catalog="${provider}" data-model-customs="${escapeHtml(JSON.stringify(customModels))}">${options}${custom}</select>${refresh}</span></label>
    <label class="setting" data-model-identifier="${escapeHtml(key)}"${listed ? ' hidden' : ''}><span><span class="setting-title">${escapeHtml(title)} ${key.startsWith('tutor.') ? 'Identifier' : 'identifier'}</span><span class="setting-description">Enter a provider-compatible model identifier, then choose Add.</span></span><span class="setting-control"><input type="text" data-setting="${escapeHtml(key)}" value="${escapeHtml(listed ? '' : value)}">${modelIconButton('addCustomModel', `data-model-provider="${provider}" data-model-key="${escapeHtml(key)}"`, 'Add model', 'add')}</span></label>${owned}`;
}

function nativeVoiceSetting(
  value: string,
  voices: string[],
  key = 'readAloud.voice',
  description = 'Installed System.Speech voices detected on this Windows host.'
): string {
  const options = voices.map((voice) => `<option value="${escapeHtml(voice)}"${voice === value ? ' selected' : ''}>${escapeHtml(voice)}</option>`).join('');
  const unavailable = value && !voices.includes(value)
    ? `<option value="${escapeHtml(value)}" selected>${escapeHtml(value)} (not currently detected)</option>`
    : '';
  return `<label class="setting"><span><span class="setting-title">${key.startsWith('tutor.') ? 'Windows Voice' : 'Windows voice'}</span><span class="setting-description">${escapeHtml(description)}</span></span><select data-setting="${escapeHtml(key)}"><option value="">Automatic local voice</option>${unavailable}${options}</select></label>`;
}

/**
 * Language/Region and Voice, the second filtered by the first.
 *
 * This replaced a hand-written list of six presets on 2026-08-24. That list offered
 * en-US-ChristopherMultilingualNeural, which the runtime does not have and has not had:
 * selecting it produced a synthesis failure with no explanation, because nothing checked the
 * name against the catalog. The list here is generated from the runtime's own catalog.
 *
 * The Voice control is disabled under Auto-detect rather than hidden, matching the Rewrite
 * Text output language pair, because the reader needs to see that a voice will be chosen for
 * them rather than wonder where the control went.
 *
 * The editable Voice ID field stays and stays authoritative. It is the escape hatch for a
 * voice this catalog does not carry, such as a Quebec French or Mexican Spanish one, and for
 * anything Microsoft adds after the catalog was generated.
 */
function edgeVoiceSetting(
  locale: string,
  value: string,
  options: {
    localeKey?: string;
    voiceKey?: string;
    locales?: typeof EDGE_SPEECH_LOCALES;
    allowAuto?: boolean;
    localeDescription?: string;
    voiceDescription?: string;
    previewCommand?: string;
  } = {}
): string {
  const localeKey = options.localeKey ?? 'readAloud.edgeLocale';
  const voiceKey = options.voiceKey ?? 'readAloud.edgeVoice';
  const locales = options.locales ?? EDGE_SPEECH_LOCALES;
  const allowAuto = options.allowAuto ?? true;
  const resolved = locales.find((candidate) => candidate.id === locale);
  const voices = resolved?.voices ?? [];
  const localeOptions: Array<[string, string]> = [
    ...(allowAuto ? [[EDGE_SPEECH_AUTO_LOCALE, 'Auto-detect'] as [string, string]] : []),
    ...locales.map((entry): [string, string] => [entry.id, entry.label])
  ];
  const voiceSelect = resolved
    ? `<label class="setting"><span><span class="setting-title">Edge TTS Voice</span><span class="setting-description">Voices Microsoft offers for ${escapeHtml(resolved.label)}.</span></span><span class="setting-control"><select data-edge-voice-preset="${escapeHtml(voiceKey)}">${voices.map((voice) => `<option value="${escapeHtml(voice.id)}"${voice.id === value ? ' selected' : ''}>${escapeHtml(voice.label)}</option>`).join('')}${voices.some((voice) => voice.id === value) ? '' : `<option value="__custom__" selected>Custom voice ID</option>`}</select>${options.previewCommand ? `<button type="button" class="secondary" data-command="${escapeHtml(options.previewCommand)}">Preview</button>` : ''}</span></label>`
    : `<label class="setting setting-inactive"><span><span class="setting-title">Edge TTS Voice</span><span class="setting-description">Available once you choose a Language/Region. Auto-detect uses that language's default voice.</span></span><select disabled><option>Chosen automatically</option></select></label>`;
  // Under Auto-detect the identifier is not the reader's to set: the locale is decided per
  // playback and the voice follows it, so an editable field there would show a value that is
  // ignored. It is replaced by a disabled field saying what will happen instead of a stale
  // identifier from whichever language was chosen last.
  const identifierTitle = voiceKey.startsWith('tutor.') ? 'Editable Edge TTS Voice ID' : 'Editable Edge TTS voice ID';
  const voiceIdentifier = resolved
    ? textSetting(identifierTitle, options.voiceDescription ?? 'Authoritative. Enter any current Microsoft Edge voice ID, including one not listed above.', voiceKey, value)
    : `<label class="setting setting-inactive"><span><span class="setting-title">${identifierTitle}</span><span class="setting-description">Choose a Language/Region above to set this by hand.</span></span><input type="text" value="Auto-selected by KREN" disabled></label>`;
  return `${selectSetting('Language/Region', options.localeDescription ?? 'Auto-detect uses a KREN result\'s language when it is clearly known, otherwise your preferred locale.', localeKey, locale, localeOptions)}
    ${voiceSelect}
    ${voiceIdentifier}`;
}

function rewriteDomainLabel(value: RewriteResult['domain']): string {
  return rewriteAxisLabel(REWRITE_DOMAINS, value);
}

function rewriteEnglishVarietyLabel(value: RewriteResult['englishVariety']): string {
  return rewriteAxisLabel(REWRITE_ENGLISH_VARIETIES, value).replace(/ English$/u, '');
}

function rewriteRhetoricalModeLabel(value: RewriteResult['rhetoricalMode']): string {
  return rewriteAxisLabel(REWRITE_RHETORICAL_MODES, value);
}

function toggleSetting(
  title: string,
  description: string,
  key: string,
  checked: boolean,
  inactiveReason?: string
): string {
  const explanation = inactiveReason ? `${description} ${inactiveReason}` : description;
  return `<label class="setting${inactiveReason ? ' disabled' : ''}"><span><span class="setting-title">${escapeHtml(title)}</span><span class="setting-description">${escapeHtml(explanation)}</span></span><span class="switch"><input type="checkbox" data-setting="${escapeHtml(key)}"${checked ? ' checked' : ''}${inactiveReason ? ' disabled' : ''}><span class="slider"></span></span></label>`;
}

function renderRelation(label: string, words: ThesaurusWord[] | undefined): string {
  if (!words?.length) return '';
  return `<div class="relation"><strong>${escapeHtml(label)}:</strong> ${words.map((item) => `<span class="word">${escapeHtml(item.word)}${item.labels?.length ? ` <span class="word-label">(${item.labels.map(escapeHtml).join(', ')})</span>` : ''}</span>`).join('')}</div>`;
}

function renderExamples(examples: string[] | undefined): string {
  return examples?.map((example) => `<blockquote>${escapeHtml(example)}</blockquote>`).join('') ?? '';
}

function renderAudioButton(audioUrl: string | undefined, headword: string): string {
  if (!audioUrl || !isAllowedPronunciationUrl(audioUrl)) return '';
  return `<button class="audio secondary icon-button" data-audio-url="${escapeHtml(audioUrl)}" aria-label="Play pronunciation of ${escapeHtml(headword)}" title="Play pronunciation"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"></path><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"></path></svg></button>`;
}

function renderNote(note: string | undefined): string {
  return note ? `<p class="note">${escapeHtml(note)}</p>` : '';
}

/*
 * An example sentence with the words it teaches in bold.
 *
 * The excerpts come from the model and the sentence does too, so neither may reach the page
 * unescaped. The safe shape is to locate the excerpts in the raw sentence, cut it into
 * pieces, and escape every piece on its own. Running a replacement over already-escaped
 * HTML is the tempting alternative and it is how unescaped text gets through: the excerpt
 * is matched against escaped text, so an excerpt containing an apostrophe never matches,
 * and any markup built around the match is concatenated rather than escaped.
 *
 * An excerpt occurring more than once is bolded every time, because a reader looking for
 * the taught words wants to see all of them. Overlaps are resolved by taking the earlier
 * match and skipping anything that starts inside it, so no range is wrapped twice.
 */
export function tutorSentenceMarkup(
  sentence: string,
  excerpts: readonly string[]
): string {
  const ranges: Array<{ start: number; end: number }> = [];
  const folded = sentence.toLocaleLowerCase();
  for (const excerpt of excerpts) {
    if (!excerpt) continue;
    /*
     * An excerpt covering nearly the whole sentence marks nothing, because a sentence
     * entirely in bold tells a reader no more than a sentence entirely in plain text. Core
     * requires an excerpt to occur in the sentence and sets no ceiling on its length, so a
     * model returning the sentence back as its own annotation passes validation and arrives
     * here. Nine tenths, so a genuinely long phrase inside a short sentence still marks.
     */
    if (!tutorExcerptShowsPattern(sentence, excerpt)) continue;
    /*
     * Case-insensitive, and the fold is done once for the sentence. A model that annotates
     * `Although` where the sentence opens with it matches either way, but one that writes
     * the excerpt in the case it would take mid-sentence does not, and core's own check is
     * exact so such a lesson never reaches the page at all. This costs nothing and removes
     * a class of near-miss rather than waiting to meet each one.
     */
    const needle = excerpt.toLocaleLowerCase();
    let from = folded.indexOf(needle);
    while (from !== -1) {
      ranges.push({ start: from, end: from + excerpt.length });
      from = folded.indexOf(needle, from + excerpt.length);
    }
  }
  ranges.sort((first, second) => first.start - second.start || second.end - first.end);

  let cursor = 0;
  let markup = '';
  for (const range of ranges) {
    if (range.start < cursor) continue;
    markup += escapeHtml(sentence.slice(cursor, range.start));
    markup += `<strong class="tutor-taught">${escapeHtml(sentence.slice(range.start, range.end))}</strong>`;
    cursor = range.end;
  }
  return markup + escapeHtml(sentence.slice(cursor));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}
