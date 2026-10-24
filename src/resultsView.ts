import { credentialHelpFor } from './credentialHelp.js';
import { systemUpdatesAvailable, type EnvironmentChecks } from './environmentCheck.js';
import { PanelNoticeQueue, showNativePanelNotice, type PanelNoticeKind, type PanelNoticeOptions } from './panelNotices.js';
import { GROQ_RETIRED_MODELS } from './tutor/models.js';
import { GROQ_MODELS } from './providers/openAICompatible.js';
import { missingCredentialsOf, showMissingCredentialNotice, runTutorGeneration, unwrapRequestOutcome, CURRENT_REQUEST_POLICIES } from './requestCenter.js';
import { tutorLessonConversationReadiness } from './tutor/lessonConversation.js';
import { regeneratePreparedPrompt, askTutorQuestion, applyTutorDiagnosticReport, confirmTutorDiagnosticReportDeletion, diagnoseTutorConversation, findTutorTargets, generateTutorExercises, cancelTutorExercises, cancelTutorLesson, regenerateTutorExample, cancelTutorExample, startTutorLessonGeneration, updateTutorTarget } from './resultsViewLesson.js';
import { updateProviderSwitchSetting, confirmTutorReset, confirmTutorLessonReset, updateTutorSetting, previewTutorEdgeVoice, previewTutorGeminiVoice, updateTutorVoiceDefault, updatePanelTheme } from './resultsViewSettings.js';
import { TUTOR_DEFAULTS } from './tutor/defaults.js';
import { currentPanelThemeKind, registerPanelTheme, shownPanelTheme } from './resultsViewTheme.js';
import { cancelTutorAsk, cancelTutorPracticeDiagnosis, cancelTutorPracticeHint, cancelTutorReview, cancelTutorReviewBatch, reviewUnreviewedTutorExercises, closeTutorTool, diagnoseTutorPractice, openTutorPracticeAsk, openTutorTool, restoreTutorDictionaryContext, reviewTutorExercise, submitTutorTool } from './resultsViewPractice.js';
export { TUTOR_REPORT_DELETE_AND_RESET, TUTOR_REPORT_DELETE_ONLY } from './resultsViewLesson.js';
export { TUTOR_CONVERSATION_EFFORT, isThinkingLevelRefusal } from './resultsViewConversation.js';
export { TUTOR_CONVERSATION_HINT_IDLE_MS } from './resultsViewHints.js';
import { writeTutorPracticeHint, writeTutorConversationHint, clearTutorConversationHintPrefetchTimer, tutorConversationReaderIsAnswering, scheduleTutorConversationHintPrefetch, postTutorConversationHintState } from './resultsViewHints.js';
import { advanceTutorConversationTurn, generateTutorConversation, tutorLiveCoaching, tutorConversationFailureMessage, tutorLanguageModelRoute, tutorConversationHintLanguageModelRoute, startTutorConversation, retryTutorConversationOpening, startStandardTutorOpening, completeTutorConversationOpening, tutorConversationVoiceGender, showTutorConversationScene, ensureTutorConversationPicture, cancelTutorConversationPicture, failTutorConversationOpening, openTutorLiveSession, startNewTutorConversation, resetStoppedTutorConversation } from './resultsViewConversation.js';
import { retryTutorTurnCheck, startLiveTutorOpening, submitTutorConversationTurn, tutorConversationTranscriptForModel, tutorConversationAnswerForDisplay, verifiedTutorReplyQuote, submitStandardTutorTurn, completeStandardTutorTurn, submitLiveTutorTurn, postTutorLiveTurnCommitted, postTutorLiveTurnCoaching, skipTutorConversationTurn, skipLiveTutorTurn, commitSkippedTutorTurn, stopTutorConversation, resumeTutorConversation, reopenLiveTutorSession } from './resultsViewTurns.js';
import { liveTranscriptFragment, TUTOR_CONVERSATION_CONTEXT_TURNS, tutorConversationSetting } from './resultsViewLive.js';
export { liveTranscriptFragment, TUTOR_CONVERSATION_CONTEXT_TURNS, tutorConversationSetting } from './resultsViewLive.js';
export { TUTOR_CONVERSATION_STOP_SAFETY_TIMEOUT_MS } from './resultsViewStop.js';
import { refreshTutorSpeechAvailability, tutorDictationHasCancellationGuard, toggleTutorDictation, startGeminiDictation, startGeminiDictationGuarded, stopGeminiDictation, postTutorDictationState, cancelGeminiDictation, cancelTutorSessionDictation, cancelTutorConversationDictation } from './resultsViewDictation.js';
import { clearTutorConversationStopSafetyTimer, tutorConversationReaderSpeaking, tutorConversationTurnInProgress, tutorConversationStopState as computeTutorConversationStopState, postTutorConversationStopState } from './resultsViewStop.js';
import { stopTutorLiveAudio, playTutorLiveAudio, tutorLivePlaybackProgress, finishTutorLiveTurnTiming, closeTutorLiveMicrophone, clearTutorLiveActivityEndTimer, scheduleTutorLiveActivityEnd, postTutorLiveTalkState, toggleTutorLiveMicrophone, tutorLiveChoiceNote, closeTutorLiveSession, cancelTutorLiveCoachingRequests, releaseTutorConversationResources, beginTutorLiveReply, appendTutorLiveReply, appendTutorLiveInput, beginTutorLiveSpokenReply, finishTutorLiveSpokenTurn, completeTutorLiveSpokenTurn, attachTutorLiveCoaching, failTutorLiveSpokenTurn, cancelTutorLiveSpokenTurn, interruptTutorLiveReply, postTutorLiveAudio, tutorLiveReplayAvailable, tutorConversationReplayAvailable, postTutorConversationReplayState, completeTutorLiveReply, rememberTutorLiveQuestionAudio, failTutorLiveAudio, logTutorLiveAudioError, postTutorLiveSpeakerState, disableTutorLive } from './resultsViewLive.js';
import { safePanelErrorMessage, tutorFailureMessage } from './resultsViewErrors.js';
import { findTutorSituation, tutorCustomSituation } from '@kren/core/tutor';
import { KNOWN_TUTOR_LIVE_MODEL_IDS } from './panelSettings.js';
import * as vscode from 'vscode';
import {
  customModelIdentifiers,
  PANEL_SETTING_KEYS,
  TUTOR_LIVE_MODEL_DEFAULT,
  validatedPanelSetting
} from './panelSettings.js';
import type { KrenPanelSettingKey } from './panelSettings.js';
import {
  PANEL_COMMANDS,
  panelCommandBusyNotice,
  type KrenPanelCommand
} from './panelCommands.js';
import { isRewriteVariantId } from './rewriteVariants.js';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { win32 } from 'node:path';
import { isAllowedPronunciationUrl } from './pronunciation.js';
import {
  isRewriteSettingsGroup,
  renderKrenResultViewHtml,
  tutorConversationAnswersMatch,
  type KrenPanelSettings,
  type RewriteReplayState,
  type RewriteSettingsGroup
} from './resultViewHtml.js';
import { preselectedGrammarChoices } from '@kren/core/grammar';
import { EDGE_SPEECH_LOCALES } from '@kren/core/edge-speech';
import { isGrammarIssueId, PANEL_TEXT_MAX_LENGTH } from './grammarIssueId.js';
import { isPlausibleLanguageCode } from './languages.js';
import { REPLAY_SUBJECTS } from './operations.js';
import type { KrenOperation, TutorLanguageModelRoute } from './operations.js';
import { ProviderError } from './errors.js';
import type { LanguageModelRoutingEffort } from './languageModelRouting.js';
import {
  tutorExampleQuestionRequest,
  tutorConversationOpening,
  tutorConversationOpeningRequest,
  tutorConversationDemoBatch,
  tutorConversationDemoBatchRequest,
  tutorConversationDemoCast,
  tutorConversationDemoCastRequest,
  tutorConversationSceneSlant,
  tutorConversationCorrections,
  tutorConversationCorrectionsRequest,
  tutorConversationHintRequest,
  tutorConversationLiveSystemInstruction,
  tutorConversationLiveResumeInstruction,
  TUTOR_CONVERSATION_ENGLISH_ONLY_INSTRUCTION,
  TUTOR_CONVERSATION_LIVE_SKIP_NOTE,
  TUTOR_DEMO_BATCH_EXCHANGES,
  TUTOR_DEMO_MAX_EXCHANGES,
  TUTOR_LIVE_TEACHING_INSTRUCTION,
  tutorLiveSessionCredential,
  tutorLiveSessionCredentialRequest,
  tutorConversationTurn,
  tutorConversationTurnRequest,
  tutorConversationLiveReplyQuote,
  tutorConversationDiagnosisRequest,
  tutorExerciseGenerationRequest,
  tutorLessonGenerationRequest,
  tutorPracticeQuestionRequest,
  tutorPassageDiagnosisRequest,
  tutorDiagnosticReport,
  tutorTailoredPromptRequest,
  tutorPracticeHintRequest,
  tutorWrittenHint,
  tutorWrittenPrompt,
  tutorProseAnswer,
  tutorReviewGenerationRequest,
  tutorTargetSearchSelection,
  tutorTargetSearchRequest,
  TUTOR_PASSAGE_ANALYSIS_CHOICES,
  type TutorReviewRequestBody,
  type TutorConversationOpening,
  type TutorConversationDemoCastRequestBody,
  type TutorStructuredGenerationRequest
} from './tutor/generation.js';
import { findTutorTargets as rankTutorTargets } from './tutor/search.js';
import { punctuateSpokenAnswerForDisplay } from './tutor/spokenAnswer.js';
import {
  activeTutorTargetIds,
  changeTutorMapSelection,
  changeTutorTarget,
  createTutorViewState,
  isTutorMapLevel,
  moveTutorConversationTurn,
  tutorConversationReply,
  moveTutorExercise,
  moveTutorExample,
  markTutorExampleViewed,
  replaceTutorExample,
  replaceTutorExerciseSet,
  resetTutorGeneratedWork,
  resetTutorSession,
  resetTutorConversationDefaults,
  resolveTutorSpeechRoute,
  tutorExerciseById,
  tutorPracticeResults,
  tutorVisibleExercises,
  tutorPracticeReviewBusy,
  tutorFindingMessage,
  tutorPreparedPrompt,
  tutorTailoredPrompt,
  tutorQuestionOnlySelection,
  tutorRecipeFromState,
  tutorSessionHasContent,
  tutorSelectionReadiness,
  tutorTargetPathLabel,
  TUTOR_ROUTING_DEFAULTS,
  TUTOR_CONVERSATION_COACHING,
  TUTOR_CONVERSATION_REPLY_LENGTHS,
  isTutorLiveVoice,
  normalizedTutorLiveVoice,
  TUTOR_LIVE_VOICES,
  type TutorConversationReplyLength,
  TUTOR_CONVERSATION_REPLIES,
  type TutorConversationReplies,
  TUTOR_CONVERSATION_STARTS,
  type TutorConversationStarts,
  TUTOR_CONVERSATION_SEND,
  tutorConversationPreferences,
  tutorConversationPreferencesOf,
  type TutorConversationPreferences,
  type TutorConversationCoaching,
  type TutorConversationSend,
  type TutorConversationDemoCast,
  type TutorConversationDemoLine,
  type TutorConversationDemoSpeaker,
  type TutorLiveVoiceGender,
  type TutorMapLevel,
  type TutorSpeechProvider,
  type TutorViewState
} from './tutor/state.js';
import {
  TutorLiveSession,
  TutorLiveSessionError,
  defaultTutorLiveSocketFactory,
  type TutorLiveAudioChunk,
  type TutorLiveSocketFactory
} from './tutor/liveSession.js';
import {
  LiveConversationTurnTiming,
  StandardConversationTurnTiming
} from './tutor/conversationTiming.js';
import {
  findTrainingMapNode,
  validateTrainingReview,
  validateTutorExerciseSet,
  validateTutorLesson,
  tutorLessonIsValid,
  TUTOR_SITUATIONS,
  type TrainingReview,
  type TrainingTargetRole,
  type TrainingTargetSelection,
  type TutorExerciseRequest,
  type TutorExerciseSet,
  type TutorLesson,
  type TutorRecipe
} from '@kren/core/tutor';
import type { GrammarChoice, KrenResult, RewriteVariantId } from './types.js';
import { REWRITE_MODALITIES, type RewriteModality } from '@kren/core/rewrite-axes';
import {
  isRewriteModeId,
  rewriteModeSettingEntries,
  type RewriteModeId
} from '@kren/core/rewrite-modes';
import {
  DEFAULT_PRO_MODELS,
  isKnownGeminiLiveOnlyModel,
  type GeminiModelOption
} from './providers/geminiModels.js';
import { WindowsPronunciationPlayer } from './windowsPronunciation.js';
import {
  edgeSpeechVoiceGender,
  otherGenderEdgeVoice,
  type EdgeAudioPlayback,
  type EdgeReadAloudResult
} from './windowsEdgeReadAloud.js';
import {
  WindowsMemoryRecorder,
  type MemoryRecording
} from './windowsMemoryRecorder.js';
import {
  WindowsWaveOutPlayer,
  pcmSampleRate,
  type WindowsWaveOutSession
} from './windowsWaveOutPlayer.js';
import {
  WAVEIN_STOP_TIMEOUT_MS,
  WindowsWaveInRecorder,
  type WindowsWaveInSession
} from './windowsWaveInRecorder.js';
import {
  MICROPHONE_SENSITIVITY_PROFILES,
  TutorMicrophoneGate,
  isTutorMicrophoneSensitivity,
  type TutorMicrophoneSensitivity,
  type TutorPauseBeforeReply
} from './tutorMicrophoneGate.js';
import {
  priorityWebviewCommand,
  type PriorityWebviewCommand
} from './webviewMessagePriority.js';
import {
  applyUserDictionaryDraftEdits,
  isUserDictionaryExportFormat,
  isUserDictionaryCaptureMode,
  isUserDictionaryPurgeSelection,
  isUserDictionarySourceFilter,
  type UserDictionaryCaptureMode,
  type UserDictionaryCaptureResult,
  type UserDictionaryEntryV1,
  type UserDictionaryExportFormat,
  type UserDictionaryImportDecision,
  type UserDictionaryImportPreview,
  type UserDictionaryListQuery,
  type UserDictionaryPurgePreview,
  type UserDictionaryPurgeSelection,
  type UserDictionaryViewStatus,
  type UserDictionarySaveResult
} from './userDictionary/index.js';

import { DEFAULT_HANDY_INTEGRATION, type HandyIntegration } from './resultsViewHandy.js';
import { closeTutorDemoResources, startTutorConversationDemo, tutorDemoLiveVoice, speakTutorDemoText } from './resultsViewDemo.js';
import { cancelTutorConversationReplayAll, cancelTutorLiveReplayWait, replayTutorQuestion, speakTutorConversationSequence } from './resultsViewReplay.js';
import { cancelTutorTakeHome, finalizeTutorTakeHome, stopTutorTakeHomeSpeech, reconcileTutorTakeHomeSetting } from './resultsViewTakeHome.js';
import { showTutorLessonUnavailable } from './resultsViewSettings.js';
import { pauseTutorPictures } from './resultsViewConversation.js';
import { configuredTutorSpeechProvider, configuredTutorLiveModel, configuredTutorHintModel, configuredTutorLiveTranscriptionLanguage, tutorModelForRoute, configuredTutorPressToTalk, configuredTutorPauseBeforeReply, configuredTutorSpeechDetection, configuredTutorMicrophoneSensitivity, configuredTutorMicrophoneCloseWait } from './resultsViewConfiguration.js';
import { isCommandMessage, isGrammarChoices, isPanelCommand, type ResultsViewCommand, type CustomModelProvider } from './resultsViewCommands.js';
export { findHandyExecutable, toggleHandyTranscription } from './resultsViewHandy.js';
export type { HandyDetectionOptions, HandyIntegration } from './resultsViewHandy.js';
export { TUTOR_HINT_MODEL_DEFAULT } from './resultsViewConfiguration.js';

export type TutorDictationTarget = { exerciseId: string } | { conversation: true };

export type TutorLiveCoachingResult =
  | { ok: true; response: ReturnType<typeof tutorConversationTurn> }
  | { ok: false; error: unknown };

export interface TutorLiveSpokenTurn {
  controller: AbortController;
  generation: number;
  question: string;
  learnerAnswer: string;
  learnerNotShown?: boolean;
  partiallyHeard?: true;
  coachingRequest: TutorStructuredGenerationRequest;
  coaching?: Promise<TutorLiveCoachingResult>;
  timing?: LiveConversationTurnTiming;
  finishing?: boolean;
}

export type TutorConversationSpeechItem =
  | { kind: 'text'; text: string; speaker: 'tutor' | 'learner'; voices?: import('./speech/voiceSelection.js').TutorCharacterVoices }
  | { kind: 'liveAudio'; chunks: readonly TutorLiveAudioChunk[] };

export interface TutorConversationStopState {
  disabled: boolean;
  title: 'Stop conversation' | 'Stop is available when you finish speaking' |
    'Stop is available when this turn finishes';
}

interface ResultState {
  result: KrenResult;
  sourceText: string;
  allowReplace: boolean;
  // The operation that produced this result, kept so the Settings apply bar can run the
  // same one again. Optional because the grammar and clipboard paths set a result without
  // one, and a result with no recorded operation simply cannot arm the bar.
  operation?: KrenOperation;
  // Which correction is selected for each grammar finding. Held here rather than read back
  // out of the document, because every render replaces the document and a radio state left
  // in the markup would reset on the next one.
  grammarChoices?: GrammarChoice[];
}

interface UserDictionaryState {
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

export type TutorVoiceDefaultSettingKey =
  | 'tutor.readAloud.edgeFemaleVoice'
  | 'tutor.readAloud.edgeMaleVoice'
  | 'tutor.liveFemaleVoice'
  | 'tutor.liveMaleVoice';

interface ResultsViewActions {
  notify(kind: 'information' | 'warning' | 'error', message: string): void;
  copy(): Promise<void>;
  details(): void;
  replace(): Promise<void>;
  copyText(text: string): Promise<void>;
  replaceText(text: string): Promise<void>;
  applyGrammarChoices(choices: readonly GrammarChoice[], replace: boolean): Promise<void>;
  manageGrammarIssue(issueId: string, action: 'addWord' | 'ignore'): Promise<void>;
  /**
   * `language` is passed whenever the panel already knows what language the text is in, so
   * Read Aloud does not have to work out something KREN recorded. A rewrite variant is in
   * the result's target language by construction, and a dictionary entry is in its own.
   */
  readAloudText(
    text: string,
    language?: string,
    settingsSource?: 'shared' | 'tutor',
    edgeVoice?: string
  ): Promise<void>;
  stopReadAloud(): void;
  clear(): void;
  invalidateResultRequests?(): void;
  loadUserDictionary(): Promise<UserDictionaryEntryV1[]>;
  saveUserDictionaryEntry(
    entry: UserDictionaryEntryV1,
    replaceId?: string
  ): Promise<UserDictionarySaveResult>;
  deleteUserDictionaryEntry(id: string): Promise<UserDictionaryEntryV1[]>;
  deleteUserDictionaryEntries(ids: readonly string[]): Promise<UserDictionaryEntryV1[] | undefined>;
  previewUserDictionaryPurge(
    selection: UserDictionaryPurgeSelection
  ): Promise<UserDictionaryPurgePreview>;
  confirmUserDictionaryPurge(
    preview: UserDictionaryPurgePreview
  ): Promise<UserDictionaryEntryV1[] | undefined>;
  previewUserDictionaryImport(): Promise<UserDictionaryImportPreview | undefined>;
  applyUserDictionaryImport(
    preview: UserDictionaryImportPreview,
    decision: UserDictionaryImportDecision
  ): Promise<UserDictionaryEntryV1[]>;
  exportUserDictionary(
    format: UserDictionaryExportFormat,
    entryIds?: readonly string[]
  ): Promise<void>;
  regenerateUserDictionaryEntry(
    expression: string,
    captureMode: UserDictionaryCaptureMode
  ): Promise<UserDictionaryCaptureResult | UserDictionaryEntryV1 | undefined>;
  readSelectedEditorPassage(): string | undefined;
  generateTutor(
    request: TutorStructuredGenerationRequest,
    route: TutorLanguageModelRoute,
    signal: AbortSignal
  ): Promise<unknown>;
  generateSituationPicture?(scene: string, signal: AbortSignal, reference?: import('./providers/situationPicture.js').SituationPictureReference): Promise<string>;
  transcribeTutorAudio(audio: Uint8Array, signal: AbortSignal, provider?: 'gemini' | 'cloudflare' | 'groq'): Promise<string>;
  runTutorTool(
    operation: 'englishDictionary' | 'translate',
    text: string,
    signal: AbortSignal,
    targetLanguage?: string,
    retry?: boolean
  ): Promise<KrenResult>;
  updateSetting(key: KrenPanelSettingKey, value: string | number | boolean): Promise<void>;
  updateTutorVoiceSetting(key: TutorVoiceDefaultSettingKey, value: string): Promise<void>;
  runCommand(command: KrenPanelCommand): Promise<void>;
  rerunOperation(operation: KrenOperation, sourceText: string): Promise<void>;
  log(message: string): void;
  /**
   * The reader's conversation choices, kept by the host between windows. Both are optional so
   * that a harness which does not care about persistence can leave them out, in which case the
   * conversation simply starts from its defaults as it did before 1.71.0.
   */
  readTutorPreferences?(): unknown;
  writeTutorPreferences?(preferences: TutorConversationPreferences): void;
  settings(): KrenPanelSettings;
  refreshGeminiImageModels?(): Promise<GeminiModelOption[]>;
  refreshGeminiModels(): Promise<GeminiModelOption[]>;
  refreshGeminiLiveModels(): Promise<GeminiModelOption[]>;
  refreshProModels(): Promise<GeminiModelOption[]>;
  refreshGroqModels?(): Promise<GeminiModelOption[]>;
  refreshOpenAIModels(): Promise<GeminiModelOption[]>;
  refreshAnthropicModels(): Promise<GeminiModelOption[]>;
  refreshReadAloudVoices(): Promise<void>;
}

export type { KrenPanelSettingKey } from './panelSettings.js';

export type { KrenPanelCommand } from './panelCommands.js';

// Supplied by the host rather than chosen by the reader, and refreshed while the Settings
// screen is open. Comparing them would arm Regenerate for a change nobody made.
const VOLATILE_SETTINGS_FIELDS = [
  'readAloudVoices',
  'credentialPresence',
  'userDictionaryEntryCount',
  'extensionVersion'
] as const;

const CUSTOM_MODEL_SETTING_KEYS: Record<CustomModelProvider, KrenPanelSettingKey> = {
  gemini: 'gemini.customModels',
  geminiLive: 'tutor.liveCustomModels',
  geminiImage: 'tutor.imageCustomModels',
  openai: 'openai.customModels',
  groq: 'groq.customModels',
  cloudflare: 'cloudflare.customModels',
  anthropic: 'anthropic.customModels'
};

function configuredCustomModels(provider: CustomModelProvider): string[] {
  return customModelIdentifiers(
    vscode.workspace.getConfiguration('kren').get<string>(CUSTOM_MODEL_SETTING_KEYS[provider], '[]')
  );
}



export type KrenResultsViewPanel = Pick<KrenResultsViewProvider,
  'showMissingCredentialError' | 'environmentChecks' | 'environmentChecksChanged' | 'handy' | 'showInformationMessage' | 'panelVisible' | 'withPanelProgress' | 'showWarningMessage' | 'showErrorMessage' | 'showProviderSwitchNotice' | 'clear' | 'reveal' | 'showTutor' | 'hide' | 'showSettings' | 'showCredentials' | 'refreshTutorTakeHomeSetting' | 'playPronunciation' | 'refresh' | 'edgeAudioPlayback' | 'playGeneratedAudioBase64' | 'generatedAudioFailureCause' | 'holdTutorSpeech' | 'tutorLiveSpeaking' | 'tutorSpeechVoice' | 'tutorSpeechConversationIdentity' | 'tutorOpeningSpeechFallback' | 'tutorSpeechPlaybackStarted' | 'stopGeneratedAudio' | 'setResult' | 'showResult' | 'showUserDictionaryDraft' | 'showUserDictionaryGenerationFailure' | 'showUserDictionary' | 'dispose' | 'resolveWebviewView'>;
export class KrenResultsViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewId = 'kren.resultsView';
  public static readonly enabledContext = 'kren.resultsEnabled';
  scheduleTutorConversationHintPrefetch(): void {
    scheduleTutorConversationHintPrefetch(this);
  }

  // Members without private are shared with the src/resultsView*.ts modules.
  view: vscode.WebviewView | undefined;
  private viewDisposables: vscode.Disposable[] = [];
  private state: ResultState | undefined;
  private userDictionaryState: UserDictionaryState = { entries: [] };
  tutorState: TutorViewState = createTutorViewState();
  private autoplayAudio: { url: string; headword: string } | undefined;
  private audioPlaybackResolver: ((started: boolean) => void) | undefined;
  private generatedAudioResolver: ((result: EdgeReadAloudResult) => void) | undefined;
  private generatedAudioId = 0;
  private generatedAudioStartedCallback: (() => void) | undefined;
  private generatedAudioReadyCallback: (() => void) | undefined;
  private generatedAudioCause: string | undefined;
  private tutorSpeechHolds = 0;
  private deferredSpeechRender = false;
  tutorSpeechConversation: object = {};
  tutorSpeechUtteranceVoice: { voice: string; conversation: object } | undefined;
  private renderedScreen: string | undefined;
  tutorConversationSpeechStarted: (() => void) | undefined;
  private activeScreen: 'result' | 'start' | 'settings' | 'credentials' | 'manual' | 'userDictionary' | 'tutor' | 'updates' = 'result';
  tutorGeneration = 0;
  tutorTargetSearchController: AbortController | undefined;
  tutorPracticeDiagnosisController: AbortController | undefined;
  tutorTailoredPromptController: AbortController | undefined;
  tutorLessonController: AbortController | undefined;
  readonly tutorExampleControllers = new Map<string, AbortController>();
  tutorExerciseController: AbortController | undefined;
  readonly tutorReviewControllers = new Map<string, AbortController>();
  tutorReviewBatchController?: AbortController;
   readonly tutorHintControllers = new Map<string, AbortController>();
  tutorToolController: AbortController | undefined;
  tutorConversationController: AbortController | undefined;
  /** Fresh stage direction for the current conversation, retained through Stop and Back to chat. */
  tutorConversationScene: string | undefined;
  tutorConversationPicture: string | undefined;
  tutorConversationPictureController: AbortController | undefined;
  /** The webview's viewport condition for the current committed turn. */
  tutorConversationPictureContinuationTurn: number | undefined;
  tutorConversationPictures: string[] = [];
  tutorConversationPictureTurns: number[] = [];
  tutorConversationPictureCount = 0;
  tutorConversationPictureFailures = 0;
  tutorConversationPictureStopped = false;
  tutorTakeHomeController?: AbortController;
  tutorTakeHomeSpeechController?: AbortController;
  tutorTakeHomeSession?: TutorLiveSession;
  tutorTakeHomePlayer?: import('./windowsWaveOutPlayer.js').WindowsWaveOutSession;
  tutorTakeHomeSpeaking = false;
  tutorConversationPictureEpoch = 0;
  tutorConversationPictureRequestId = 0;
  tutorConversationPicturePending: { requestId: number; image: string; turn?: number } | undefined;
  readonly tutorConversationPictureAccepted = new Map<number, string>();
  tutorConversationPictureEligibleTurn: number | undefined;
  tutorConversationPictureCommitPending = false;
  tutorConversationPictureLastTriggeredTurn = -1;
  tutorConversationHintController: AbortController | undefined;
  tutorConversationHintRequest: {
    controller: AbortController;
    turnGeneration: number;
    readerRequested: boolean;
  } | undefined;
   tutorConversationHintPrefetchTimer: ReturnType<typeof setTimeout> | undefined;
   tutorConversationPrefetchedHint: {
    turnGeneration: number;
    hint: { explanation: string; example: string };
  } | undefined;
   tutorConversationHintPrefetchAttemptedGeneration: number | undefined;
  /** Raw speech-recognition text by transcript index. Display punctuation never crosses this boundary. */
  readonly tutorConversationRawAnswers = new Map<number, string>();
  /** Changes whenever the question a conversation Hint belongs to changes. */
  tutorConversationTurnGeneration = 0;
  /** Typed Live turns whose socket KREN closed because the reader selected Standard. */
   readonly tutorLiveDeliberateClosures = new WeakSet<AbortController>();
  tutorLiveSession: TutorLiveSession | undefined;
  tutorLiveFailed = false;
  tutorLiveAudioGeneration = 0;
  tutorLiveAudioPlayer: WindowsWaveOutSession | undefined;
  tutorLiveReplyAudio: TutorLiveAudioChunk[] = [];
  tutorLiveReplyAudioComplete = false;
  /** Completed Gemini question audio, indexed like the transcript and held only in memory. */
  readonly tutorLiveConversationAudio = new Map<number, TutorLiveAudioChunk[]>();
  tutorLiveReplyText = '';
  tutorLiveReplyRawText = '';
  /** Suppresses narration transcript fragments while Gemini reads the separately shown scene. */
  tutorLiveOpeningNarration = false;
  tutorLiveFirstFragment = true;
  /** Whether the first visible reply fragment already ended the Hint-owned turn. */
  tutorLiveReplyAdvancedTurn = false;
  tutorLiveMicrophone: WindowsWaveInSession | undefined;
  tutorLiveMicrophoneGate: TutorMicrophoneGate | undefined;
  tutorLiveMicrophoneStarting = false;
  tutorLiveMicrophoneGeneration = 0;
  tutorLiveActivityEndTimer: ReturnType<typeof setTimeout> | undefined;
  tutorLiveActivityActive = false;
  /** Snapshotted by Start or Back to chat for the next active conversation. */
  tutorLivePressToTalk = false;
  /** Snapshotted beside Press to talk so Live and Standard use one frozen profile. */
  tutorLiveMicrophoneSensitivity: TutorMicrophoneSensitivity = 'balanced';
  /** Seconds captured at Start or Back to chat, independently of speech sensitivity. */
  tutorLivePauseBeforeReply: TutorPauseBeforeReply = 2;
  tutorLiveSpeechDetection: import('./tutorMicrophoneGate.js').TutorSpeechDetection = 'kren';
  tutorLiveInputText = '';
  tutorLiveInputReplyPending = false;
  tutorLiveInputFirstFragment = true;
  tutorLiveInputLatency: {
    firstMicrophoneForwardedAt?: number;
    firstInputFragmentAt?: number;
    learnerBubblePatchedAt?: number;
  } = {};
  tutorLiveTurnTiming: LiveConversationTurnTiming | undefined;
  /** The timing record captured when the current Gemini reply began. */
  tutorLiveReplyTiming: LiveConversationTurnTiming | undefined;
  /** A completed turn whose timing line waits for waveOut's actual final WHDR_DONE. */
  tutorLiveCompletedTiming: LiveConversationTurnTiming | undefined;
  tutorStandardTurnTiming: StandardConversationTurnTiming | undefined;
  tutorLiveSpokenTurn: TutorLiveSpokenTurn | undefined;
  /** In-flight corrections keyed by the V131 generation of the turn they own. */
  readonly tutorLiveCoachingControllers = new Map<number, AbortController>();
  tutorConversationStopSafetyTimer: ReturnType<typeof setTimeout> | undefined;
  tutorConversationStopSafetyReleased = false;
  tutorLivePlaybackQueuedUntil = 0;
  tutorLivePlaybackBlockedUntil = 0;
  tutorReplayAllGeneration = 0;
  tutorConversationSpeechSequenceRunning = false;
  tutorConversationIntroSpeaking = false;
  tutorIntroCompletionWait: { cancel(): void; playbackComplete(): void } | undefined;
  tutorLiveOpeningAudioReady: Promise<void> | undefined;
  tutorConversationOpeningWait: { timer: ReturnType<typeof setTimeout>; resolve(): void } | undefined;
  tutorLiveReplayWait:
    { timer: ReturnType<typeof setTimeout>; resolve: () => void } | undefined;
  tutorLiveReplayOwnsAudioPlayer = false;
  tutorLiveReplayLearnerSession: TutorLiveSession | undefined;
  tutorLiveReplayController: AbortController | undefined;
  tutorDemoController: AbortController | undefined;
  tutorDemoGeneration = 0;
  /** One Gemini session per voice stays open, avoiding a reconnect pause before every line. */
  tutorDemoLiveSessions: Partial<Record<TutorConversationDemoSpeaker, TutorLiveSession>> = {};
  tutorDemoCounterpartGender: TutorConversationDemoSpeaker = 'female';
  handyExecutable: string | undefined;
  handyDetection = 0;
  /** Carries Handy's paste classification across the generic answer update that follows it. */
   tutorHandyConversationTranscriptPending = false;
  geminiRecording: MemoryRecording | undefined;
  geminiRecordingTarget: TutorDictationTarget | undefined;
  geminiDictationStart:
    { generation: number; target: TutorDictationTarget } | undefined;
  geminiDictationStartTask: Promise<void> | undefined;
  geminiDictationStartGeneration = 0;
  geminiTranscriptionController: AbortController | undefined;
  private messageQueue: Promise<void> = Promise.resolve();
  tutorFindController: AbortController | undefined;
  private readonly panelScriptErrors = new Set<string>();
  private runningPanelCommand: string | undefined;
  private readonly panelQueueTimers = new Set<ReturnType<typeof setTimeout>>();
   proModels: GeminiModelOption[] = DEFAULT_PRO_MODELS;
   liveModels: GeminiModelOption[] = [{
    id: TUTOR_LIVE_MODEL_DEFAULT,
    displayName: TUTOR_LIVE_MODEL_DEFAULT,
    liveOnly: true
  }];
  private openAIModels: GeminiModelOption[] = [{ id: 'gpt-5.4', displayName: 'GPT-5.4' }];
  private anthropicModels: GeminiModelOption[] = [
    { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' }
  ];
  private imageModels: GeminiModelOption[] = [];
  private imageModelRefresh = 0;
  private customModels: Record<CustomModelProvider, string[]> = {
    gemini: configuredCustomModels('gemini'),
    geminiLive: configuredCustomModels('geminiLive'),
    geminiImage: configuredCustomModels('geminiImage'),
    openai: configuredCustomModels('openai'),
    groq: configuredCustomModels('groq'),
    cloudflare: configuredCustomModels('cloudflare'),
    anthropic: configuredCustomModels('anthropic')
  };
  private proModelRefresh = 0;
  private liveModelRefresh = 0;
  private openAIModelRefresh = 0;
  private groqModelRefresh = 0;
  private groqModels: GeminiModelOption[] = GROQ_MODELS.map(id => ({ id, displayName: id }));
  private anthropicModelRefresh = 0;
  private inferredRewriteModality: RewriteModality | undefined;
  private activeRewriteSettingsGroup: RewriteSettingsGroup | undefined;
  // Set when the gear on a result opened Settings, cleared when the reader leaves or the
  // replay finishes. Its presence is half of what arms the apply bar; a recorded operation
  // to replay is the other half.
  private settingsBaseline: string | undefined;
  private regeneratingResult = false;
  // What the panel is waiting for, or undefined when it is idle. While set, the panel
  // covers itself with an overlay naming the wait, because a language action takes seconds
  // and an unchanged screen reads as a control that did nothing.
  //
  // Kept as a stack rather than one string. It was one string, cleared by whichever
  // completion found its own text still in place, and two overlapping commands then
  // uncovered the panel while work was still running: two Rewrites share a notice, so the
  // first to finish cleared it for both, and Translate followed by Rewrite uncovered the
  // panel the moment Rewrite returned. The overlay now lifts when the last one finishes.
  private readonly busyOperations: Array<{ id: number; notice: string; cancel?: () => void }> = [];
  private nextBusyOperationId = 0;
  // Carried by the gear's render and cleared by the reader's next message, so Settings
  // opens at Rewrite once without dragging later edits back to that section.
  private pendingSettingsFocus: string | undefined;
  // A target click replaces the whole webview document. These two values let that one
  // replacement put keyboard focus back on the acted-on row and announce its new role.
  pendingTutorTargetFocus: string | undefined;
  pendingTutorAnnouncement: string | undefined;
  pendingTutorResetDisclosures = false;
  pendingTutorResetAllDisclosures = false;
  tutorResetDisclosure?: { id: string; all: boolean };
  // A successful lesson or practice request gets one result-focused webview render. The
  // value is cleared immediately after that render, so later state updates restore the
  // reader's own scroll position instead of pulling them back to an older result.
  pendingTutorResultFocus: 'lesson' | 'exercises' | undefined;
  /** Start owns one render before normal tutor scroll restoration resumes. */
  pendingTutorConversationFocus = false;
  private readonly windowsPronunciation = new WindowsPronunciationPlayer();

  environmentChecks: EnvironmentChecks | undefined;

  /** Daily results patch the Start header without replacing an active conversation. */
  public environmentChecksChanged(): void {
    if (this.activeScreen === 'updates') this.render();
    else void this.view?.webview.postMessage({ command: 'systemUpdatesStatus',
      available: systemUpdatesAvailable(this.environmentChecks?.statuses ?? {}) });
  }

  public constructor(
    readonly actions: ResultsViewActions,
    private readonly extensionUri: vscode.Uri,
    readonly handy: HandyIntegration = DEFAULT_HANDY_INTEGRATION,
    readonly recorder: Pick<WindowsMemoryRecorder, 'start'> = new WindowsMemoryRecorder(),
    readonly tutorLiveSocketFactory: TutorLiveSocketFactory = defaultTutorLiveSocketFactory,
    readonly waveOutPlayer: Pick<WindowsWaveOutPlayer, 'start'> = new WindowsWaveOutPlayer(),
    readonly waveInRecorder: Pick<WindowsWaveInRecorder, 'start'> = new WindowsWaveInRecorder()
  ) {
    const generate: ResultsViewActions['generateTutor'] = (request, route, signal) => runTutorGeneration({ request: { ...request,
      transcriptTurns: request.kind.startsWith('conversation') && !request.kind.startsWith('conversationDemo')
        ? this.tutorState.conversation.transcript.length : request.transcriptTurns
    }, route: { ...route, fastModel: configuredTutorHintModel(),
      fastThinkingOrEffort: route.fastThinkingOrEffort ?? actions.settings().tutorHintThinkingOrEffort ?? TUTOR_DEFAULTS.configuration['tutor.hintThinkingOrEffort'] }, signal, policy: CURRENT_REQUEST_POLICIES.tutor,
      generate: actions.generateTutor.bind(actions), log: actions.log.bind(actions) }).then(unwrapRequestOutcome);
    this.actions = new Proxy(actions, { get: (target, key) => key === 'generateTutor' ? generate : Reflect.get(target, key) });
    this.applyStoredTutorPreferences();
    this.syncTutorRoutingSettings();
  }

  private readonly notices = new PanelNoticeQueue(
    () => this.view?.visible === true,
    notice => this.view?.webview.postMessage({ command: 'panelNotice', notice }),
    (kind, message, options, choices) => showNativePanelNotice(vscode.window, kind, message, options, choices),
    id => this.view?.webview.postMessage({ command: 'panelNoticeWithdraw', id }),
    line => this.actions.log(line)
  );
  public showInformationMessage(message: string, optionsOrChoice?: PanelNoticeOptions | string, ...choices: string[]): Promise<string | undefined> {
    return this.showPanelNotice('information', message, optionsOrChoice, ...choices);
  }
  public showWarningMessage(message: string, optionsOrChoice?: PanelNoticeOptions | string, ...choices: string[]): Promise<string | undefined> {
    return this.showPanelNotice('warning', message, optionsOrChoice, ...choices);
  }
  public showErrorMessage(message: string, optionsOrChoice?: vscode.MessageOptions | string, ...choices: string[]): Promise<string | undefined> {
    return this.showPanelNotice('error', message, optionsOrChoice, ...choices);
  }

  public credentialPresence() {
    return this.actions.settings().credentialPresence;
  }

  public showMissingCredentialError(error: unknown, offerProviderChoice = false): boolean {
    const missing = missingCredentialsOf(error);
    if (!missing) return false;
    void showMissingCredentialNotice(missing, this, '', offerProviderChoice);
    return true;
  }

  private showPanelNotice(kind: PanelNoticeKind, message: string, optionsOrChoice?: PanelNoticeOptions | string, ...choices: string[]): Promise<string | undefined> {
    return this.notices.show(kind, message, optionsOrChoice, ...choices);
  }
  private closePanelNotices(): void {
    this.cancelTutorFind();
    this.notices.close();
    void this.view?.webview.postMessage({ command: 'panelNoticesClosed' });
  }

  public cancelTutorFind(): void {
    this.tutorFindController?.abort();
    this.tutorFindController = undefined;
  }

  public showProviderSwitchNotice(text: string): void {
    this.actions.notify('warning', text);
  }

  /**
   * Restores the reader's conversation choices, and nothing about a conversation. Before this,
   * every window reload put a reader who had chosen Standard back into Live (Gemini), which
   * opens a paid streaming session and takes over the microphone without saying so.
   */
  private applyStoredTutorPreferences(): void {
    const stored = tutorConversationPreferences(this.actions.readTutorPreferences?.());
    if (Object.keys(stored).length === 0) return;
    this.tutorState = { ...this.tutorState, conversation: {
      ...this.tutorState.conversation, ...stored
    } };
  }

  /** Called wherever one of those choices changes, and nowhere else. */
  public persistTutorPreferences(): void {
    this.actions.writeTutorPreferences?.(
      tutorConversationPreferencesOf(this.tutorState.conversation)
    );
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    if (this.view && this.view !== view) this.closePanelNotices();
    this.disposeViewDisposables();
    this.view = view;
    this.renderedScreen = undefined;
    this.notices.open();
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
    };
    this.viewDisposables = [
      registerPanelTheme(view.webview, () => this.actions.settings().panelTheme ?? 'followVSCode'),
      view.webview.onDidReceiveMessage((message: unknown) => {
        const command = typeof message === 'object' && message !== null
          ? (message as { command?: unknown }).command : undefined;
        if (command === 'cancelPanelProgress') {
          const id = (message as { operationId?: unknown }).operationId;
          const operation = this.busyOperations.at(-1);
          if (operation && operation.id === id) operation.cancel?.();
          return;
        }
        if (command === 'panelNoticeResponse') {
          this.notices.respond(message);
          return;
        }
        if (command === 'panelNoticeShown') {
          this.notices.acknowledge(message);
          return;
        }
        if (command === 'panelNoticeNotShown') {
          this.notices.notShown(message);
          return;
        }
        if (command === 'panelScriptError') {
          const { message: text, line, column } = message as { message?: unknown; line?: unknown; column?: unknown };
          if (typeof text !== 'string' || !text || typeof line !== 'number' || typeof column !== 'number' ||
              !Number.isSafeInteger(line) || line < 0 || !Number.isSafeInteger(column) || column < 0) return;
          const key = JSON.stringify([text, line, column]);
          if (!this.panelScriptErrors.has(key)) {
            this.panelScriptErrors.add(key);
            this.actions.log(`[panel error] ${text} @${line}:${column}`);
          }
          return;
        }
        if (isCommandMessage(message) && (
          (message.command === 'runCommand' && message.action !== 'kren.applyGlobalRouting') || message.command === 'resetTutorSession' ||
          message.command === 'resetTutorLesson' || message.command === 'showSettings' ||
          message.command === 'showCredentials' || message.command === 'showStartPage' ||
          message.command === 'previewTutorEdgeVoice' || message.command === 'previewTutorGeminiVoice' ||
          message.command === 'retryTutorTurnCheck' || message.command === 'findTutorTargets'
        )) {
          // 2026-10-18: V265 I45. Choices and navigation start while the panel is visible.
          // Speech and generation own their lifetimes, not the serialized settings queue.
          void this.handleMessage(message).catch(() => undefined);
          return;
        }
        if (command === 'toggleTheme' || (command === 'updateSetting' &&
            (message as { key?: unknown }).key === 'display.panelTheme')) {
          // 2026-10-04: Theme changes stay responsive during a queued provider request.
          void this.handleMessage(message).catch(() => undefined);
          return;
        }
        if ((command === 'dictateTutorExercise' || command === 'dictateTutorConversation') &&
            tutorDictationHasCancellationGuard(this, command)) {
          // Gemini recorder and Live microphone starts carry generations that reject and clean
          // up a late completion. Handy has no cancellation API, so its toggle and ownership
          // update stay together in the queue. Stop may wait for that one helper spawn.
          void this.handleMessage(message).catch(() => undefined);
          return;
        }
        const priorityCommand = priorityWebviewCommand(message);
        if (priorityCommand) {
          this.handlePriorityMessage(priorityCommand, message);
          return;
        }
        this.enqueuePanelMessage(message);
      }),
      view.onDidChangeVisibility(() => {
        if (this.view !== view) return;
        if (!view.visible) { this.closePanelNotices(); return; }
        this.notices.open();
        if (this.generatedAudioReadyCallback) void view.webview.postMessage({ command: 'requestGeneratedAudioReady' });
        ensureTutorConversationPicture(this);
        postTutorLiveTalkState(this);
        postTutorLiveSpeakerState(this);
        postTutorConversationReplayState(this);
        const conversation = this.tutorState.conversation;
        postTutorConversationHintState(this, {
          busy: conversation.hintBusy,
          ...(conversation.hint ? { hint: conversation.hint } : {}),
          ...(conversation.hintFailure ? { failure: conversation.hintFailure } : {}),
          ...(!conversation.hintBusy && !conversation.hint && !conversation.hintFailure
            ? { clear: true } : {}),
          turnGeneration: this.tutorConversationTurnGeneration
        });
      }),
      view.onDidDispose(() => {
        if (this.view !== view) return;
        this.closePanelNotices();
        this.view = undefined;
        this.audioPlaybackResolver?.(false);
        this.audioPlaybackResolver = undefined;
        this.generatedAudioResolver?.('stopped');
        this.generatedAudioResolver = undefined;
        cancelGeminiDictation(this);
        closeTutorLiveSession(this);
        clearTutorConversationStopSafetyTimer(this);
        this.tutorLiveConversationAudio.clear();
        this.abortTutorRequests();
        this.tutorConversationPictureController?.abort();
        this.tutorConversationPicture = undefined;
        this.tutorConversationPictures = [];
        this.tutorConversationPictureTurns = [];
        this.tutorConversationPictureCount = 0;
        this.tutorConversationPictureAccepted.clear();
        this.tutorConversationPictureFailures = 0;
        this.tutorConversationPictureStopped = false;
        this.disposeViewDisposables();
      })
    ];
    this.render();
    void refreshTutorSpeechAvailability(this);
  }

  private enqueuePanelMessage(message: unknown): void {
    // Never derive a diagnostic label from unvalidated message data.
    const command = isCommandMessage(message) ? message.command : 'invalidMessage';
    const received = Date.now();
    let logged = false;
    const schedule = (milliseconds: number, callback: () => void) => {
      const timer = setTimeout(() => {
        this.panelQueueTimers.delete(timer);
        callback();
      }, milliseconds);
      timer.unref?.();
      this.panelQueueTimers.add(timer);
      return timer;
    };
    const clear = (timer: ReturnType<typeof setTimeout>) => {
      clearTimeout(timer);
      this.panelQueueTimers.delete(timer);
    };
    const logWait = () => {
      if (logged) return;
      logged = true;
      this.actions.log(`[panel queue] ${command} waited ${Math.floor((Date.now() - received) / 1000)} s${this.runningPanelCommand ? ` behind ${this.runningPanelCommand}` : ''}`);
    };
    const waiting = schedule(5_001, logWait);
    this.messageQueue = this.messageQueue.then(async () => {
      if (Date.now() - received > 5_000) logWait();
      clear(waiting);
      this.runningPanelCommand = command;
      const started = Date.now();
      const logRun = () => {
        if (logged) return;
        logged = true;
        this.actions.log(`[panel queue] ${command} ran ${Math.floor((Date.now() - started) / 1000)} s`);
      };
      const running = schedule(30_001, logRun);
      try {
        const task = this.handleMessage(message);
        // Changed 2026-10-18: V265, owner item I45, Stop starts after queued Handy
        // toggles finish. Its synchronous ownership retirement then makes later presses
        // safe, so cleanup and deferred review need not hold the queue.
        if (command === 'stopTutorConversation') void task.catch(() => undefined);
        else await task;
      }
      finally {
        if (Date.now() - started > 30_000) logRun();
        clear(running);
        this.runningPanelCommand = undefined;
      }
    }).catch(() => undefined);
  }

  public setResult(
    result: KrenResult,
    sourceText: string,
    allowReplace: boolean,
    operation?: KrenOperation
  ): void {
    this.state = {
      result,
      sourceText,
      allowReplace,
      ...(operation ? { operation } : {}),
      ...(result.kind === 'grammar'
        ? { grammarChoices: [...preselectedGrammarChoices(result)] }
        : {})
    };
    this.inferredRewriteModality = undefined;
    this.autoplayAudio = undefined;
    this.setActiveScreen('result', false);
    this.settingsBaseline = undefined;
    this.render();
  }

  public clear(): void {
    this.actions.invalidateResultRequests?.();
    this.state = undefined;
    this.settingsBaseline = undefined;
    this.inferredRewriteModality = undefined;
    this.autoplayAudio = undefined;
    this.setActiveScreen('result');
    this.render();
  }

  public refreshTutorTakeHomeSetting(): void {
    reconcileTutorTakeHomeSetting(this);
    void this.view?.webview.postMessage({ command: 'tutorConversationTakeHomeSetting',
      value: this.actions.settings().tutorConversationTakeHome ?? TUTOR_DEFAULTS.configuration['tutor.conversation.takeHome'] });
  }

  public refresh(): void {
    void this.view?.webview.postMessage({ command: 'credentialPresenceReady', presence: this.actions.settings().credentialPresence ?? {} });
    reconcileTutorTakeHomeSetting(this);
    this.syncTutorRoutingSettings();
    this.customModels = {
      gemini: configuredCustomModels('gemini'),
      geminiLive: configuredCustomModels('geminiLive'),
      geminiImage: configuredCustomModels('geminiImage'),
      openai: configuredCustomModels('openai'),
      groq: configuredCustomModels('groq'),
      cloudflare: configuredCustomModels('cloudflare'),
      anthropic: configuredCustomModels('anthropic')
    };
    this.render();
    if (this.view) void refreshTutorSpeechAvailability(this);
  }

  public async showResult(
    result: KrenResult,
    sourceText: string,
    allowReplace: boolean,
    operation?: KrenOperation
  ): Promise<void> {
    this.setResult(result, sourceText, allowReplace, operation);
    await this.reveal();
  }

  public async playPronunciation(audioUrl: unknown, headword: unknown): Promise<void> {
    if (typeof audioUrl !== 'string' || !isAllowedPronunciationUrl(audioUrl)) {
      this.actions.notify('error', 'KREN blocked an invalid pronunciation audio URL.');
      return;
    }
    const audio = {
      url: audioUrl,
      headword: typeof headword === 'string' && headword.trim()
        ? headword.trim()
        : 'Pronunciation'
    };
    const settings = this.actions.settings();
    if (settings.windowsNativePronunciation && !vscode.env.remoteName &&
        await this.windowsPronunciation.play(audio.url)) return;
    if (await this.tryBackgroundPronunciation(audio)) return;

    this.autoplayAudio = audio;
    const wasResolved = Boolean(this.view);
    await this.reveal();
    if (wasResolved) this.render();
  }

  private async tryBackgroundPronunciation(
    audio: { url: string; headword: string }
  ): Promise<boolean> {
    if (!this.view) return false;
    this.audioPlaybackResolver?.(false);
    const started = new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (this.audioPlaybackResolver === finish) this.audioPlaybackResolver = undefined;
        resolve(value);
      };
      const timeout = setTimeout(() => finish(false), 1500);
      this.audioPlaybackResolver = finish;
    });
    const delivered = await this.view.webview.postMessage({
      command: 'playPronunciation',
      url: audio.url,
      headword: audio.headword
    });
    if (!delivered) this.audioPlaybackResolver?.(false);
    return started;
  }

  // The symmetric partner to reveal(). KREN's view is gated behind kren.resultsEnabled, so
  // clearing that context removes KREN from the Secondary Sidebar and leaves everything
  // else living there, Chat, Claude Code, Codex, exactly as it was.
  //
  // This deliberately does not run workbench.action.closeAuxiliaryBar, which is what the
  // hide command used to do. That closes the entire panel, so hiding KREN took every
  // other extension's view down with it, and reopening the panel from one of those
  // brought KREN straight back because it had never actually been hidden. An extension
  // should hide itself and leave the workbench layout alone.
  public async hide(): Promise<void> {
    this.closePanelNotices();
    closeTutorLiveMicrophone(this);
    cancelTutorConversationReplayAll(this);
    this.tutorLiveConversationAudio.clear();
    await vscode.commands.executeCommand(
      'setContext',
      KrenResultsViewProvider.enabledContext,
      false
    );
    await this.rememberSidebarShown(false);
  }

  public async reveal(): Promise<void> {
    await vscode.commands.executeCommand(
      'setContext',
      KrenResultsViewProvider.enabledContext,
      true
    );
    await vscode.commands.executeCommand(`${KrenResultsViewProvider.viewId}.focus`);
    await this.rememberSidebarShown(true);
  }

  /**
   * Writes the shown state to kren.results.openAtStartup, the one place it is recorded.
   *
   * The setting and the context are the same fact, so hiding KREN and restarting must not
   * bring it back and showing it must not be forgotten. A second remembered flag alongside
   * the setting would be a second copy of one rule, and the two would drift the first time
   * one path was changed without the other.
   *
   * Written only when the value actually differs, because every write lands in the user's
   * settings.json and hiding a sidebar should not churn a file the owner reads.
   */
  private async rememberSidebarShown(shown: boolean): Promise<void> {
    if (this.actions.settings().openResultsAtStartup === shown) return;
    await this.actions.updateSetting('results.openAtStartup', shown);
  }

  public edgeAudioPlayback(): EdgeAudioPlayback | undefined {
    if (!this.view) return undefined;
    return {
      play: (file) => this.playGeneratedAudio(file),
      stop: () => this.stopGeneratedAudio()
    };
  }

  public tutorSpeechConversationIdentity(): unknown {
    return this.tutorSpeechConversation;
  }

  public generatedAudioFailureCause(): string | undefined { return this.generatedAudioCause; }
  public tutorSpeechVoice(): string {
    return this.tutorSpeechUtteranceVoice?.conversation === this.tutorSpeechConversation
      ? this.tutorSpeechUtteranceVoice.voice : this.tutorState.conversation.liveVoice;
  }

  public holdTutorSpeech(): () => void {
    this.tutorSpeechHolds++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.tutorSpeechHolds--;
      this.flushSpeechRender();
    };
  }

  public flushSpeechRender(): void {
    if (!this.deferredSpeechRender || this.tutorSpeechHolds || this.generatedAudioResolver ||
        this.tutorConversationSpeechSequenceRunning) return;
    this.deferredSpeechRender = false;
    this.render();
  }

  public tutorOpeningSpeechFallback(): void {
    // 2026-10-12: A scene fallback still has to finish reading the scene.
    this.tutorConversationSpeechStarted?.();
  }

  public tutorSpeechPlaybackStarted(): void {
    this.tutorConversationSpeechStarted?.();
  }

  public tutorLiveSpeaking(): boolean {
    return Boolean(this.tutorLiveSession && !this.tutorLiveFailed &&
      (this.tutorState.conversation.busy || this.tutorLiveSpokenTurn ||
        this.tutorLiveInputReplyPending || Date.now() < this.tutorLivePlaybackQueuedUntil));
  }

  public stopGeneratedAudio(): boolean {
    const active = Boolean(this.generatedAudioResolver);
    if (this.view) void this.view.webview.postMessage({ command: 'stopGeneratedAudio' });
    this.generatedAudioResolver?.('stopped');
    this.generatedAudioResolver = undefined;
    return active;
  }

  public async showCredentials(): Promise<void> {
    this.setActiveScreen('credentials');
    this.render();
    await this.reveal();
  }

  public async showSettings(): Promise<void> {
    this.setActiveScreen('settings');
    this.render();
    await this.reveal();
    this.refreshReadAloudVoicesInBackground();
  }

  public async showTutor(): Promise<void> {
    this.setActiveScreen('tutor');
    this.render();
    await this.reveal();
  }

  public async showUserDictionary(selectedId?: string): Promise<void> {
    this.setActiveScreen('userDictionary');
    this.userDictionaryState = {
      entries: this.userDictionaryState.entries,
      status: 'loading',
      selectedId
    };
    this.render();
    await this.reveal();
    try {
      const entries = await this.actions.loadUserDictionary();
      this.userDictionaryState = { entries, selectedId, status: 'ready' };
      this.render();
    } catch (error) {
      this.userDictionaryState = {
        entries: this.userDictionaryState.entries,
        status: 'storageError'
      };
      this.render();
      throw error;
    }
  }

  public async showUserDictionaryGenerationFailure(): Promise<void> {
    this.setActiveScreen('userDictionary');
    this.userDictionaryState = {
      entries: this.userDictionaryState.entries,
      status: 'generationFailed'
    };
    this.render();
    await this.reveal();
  }

  public async showUserDictionaryDraft(
    value: UserDictionaryCaptureResult | UserDictionaryEntryV1,
    editingId?: string
  ): Promise<void> {
    const capture = normalizeUserDictionaryCaptureResult(value);
    this.userDictionaryState = {
      ...this.userDictionaryState,
      draft: capture.draft,
      capture,
      editingId,
      duplicateId: undefined
    };
    this.setActiveScreen('userDictionary');
    this.render();
    await this.reveal();
  }

  public dispose(): void {
    for (const timer of this.panelQueueTimers) clearTimeout(timer);
    this.panelQueueTimers.clear();
    this.closePanelNotices();
    this.proModelRefresh += 1;
    this.liveModelRefresh += 1;
    this.openAIModelRefresh += 1;
    this.groqModelRefresh += 1;
    this.anthropicModelRefresh += 1;
    this.view = undefined;
    this.disposeViewDisposables();
    this.stopGeneratedAudio();
    this.audioPlaybackResolver?.(false);
    this.audioPlaybackResolver = undefined;
    this.windowsPronunciation.dispose();
    cancelGeminiDictation(this);
    closeTutorLiveSession(this);
    clearTutorConversationStopSafetyTimer(this);
    this.tutorLiveConversationAudio.clear();
    this.abortTutorRequests();
    this.tutorConversationPictureController?.abort();
    this.tutorConversationPicture = undefined;
    this.tutorConversationPictures = [];
    this.tutorConversationPictureTurns = [];
    this.tutorConversationPictureCount = 0;
    this.tutorConversationPictureAccepted.clear();
    this.tutorConversationPictureFailures = 0;
    this.tutorConversationPictureStopped = false;
    void vscode.commands.executeCommand(
      'setContext',
      KrenResultsViewProvider.enabledContext,
      false
    );
  }

  private abortTutorRequests(): void {
    cancelTutorTakeHome(this, 'retain');
    this.tutorReviewBatchController?.abort();
    this.tutorReviewBatchController = undefined;
    this.tutorState = { ...this.tutorState, practiceReviewBatch: undefined, reviewBusyIds: [] };
    cancelTutorConversationPicture(this);
    ensureTutorConversationPicture(this);
    cancelTutorConversationReplayAll(this);
    this.tutorTailoredPromptController?.abort();
    this.tutorTailoredPromptController = undefined;
    if (this.tutorState.askBusy === 'tailoredPrompt') {
      this.tutorState = { ...this.tutorState, askBusy: undefined };
    }
    this.tutorTargetSearchController?.abort();
    this.tutorTargetSearchController = undefined;
    this.tutorPracticeDiagnosisController?.abort();
    this.tutorPracticeDiagnosisController = undefined;
    this.tutorLessonController?.abort();
    this.tutorLessonController = undefined;
    for (const controller of this.tutorExampleControllers.values()) controller.abort();
    this.tutorExampleControllers.clear();
    this.tutorExerciseController?.abort();
    this.tutorExerciseController = undefined;
    for (const controller of this.tutorReviewControllers.values()) controller.abort();
    this.tutorReviewControllers.clear();
    this.tutorToolController?.abort();
    this.tutorToolController = undefined;
    this.tutorConversationController?.abort();
    this.tutorConversationController = undefined;
    this.tutorConversationHintController?.abort();
    this.tutorConversationHintController = undefined;
    this.tutorConversationHintRequest = undefined;
    clearTutorConversationHintPrefetchTimer(this);
    this.tutorConversationPrefetchedHint = undefined;
  }

  private async toggleTutorLiveMicrophone(): Promise<void> {
    return toggleTutorLiveMicrophone(this);
  }

  private beginTutorLiveReply(): void {
    beginTutorLiveReply(this);
  }

  private cancelTutorLiveCoachingRequests(): boolean {
    return cancelTutorLiveCoachingRequests(this);
  }

  postTutorConversationStopState(): void {
    postTutorConversationStopState(this);
  }

  private async refreshTutorSpeechAvailability(): Promise<void> {
    return refreshTutorSpeechAvailability(this);
  }

  private setActiveScreen(screen: typeof this.activeScreen, navigation = true): void {
    // Publishing a result is not a reader navigation. Leaving Tutor still releases speech.
    if (navigation || (this.activeScreen === 'tutor' && screen !== 'tutor')) this.actions.stopReadAloud();
    if (screen !== 'result') this.actions.invalidateResultRequests?.();
    if (this.activeScreen === 'tutor' && screen !== 'tutor') {
      clearTutorConversationHintPrefetchTimer(this);
      this.tutorConversationHintRequest = undefined;
      cancelTutorSessionDictation(this);
      void releaseTutorConversationResources(this, false, false);
      cancelTutorTakeHome(this, 'retain');
      const conversation = this.tutorState.conversation;
      this.tutorState = { ...this.tutorState, conversation: { ...conversation,
        draftAnswer: conversation.pendingAnswer ?? conversation.draftAnswer,
        pendingAnswer: undefined, busy: false, hintBusy: false
      } };
      this.tutorLiveConversationAudio.clear();
      postTutorConversationReplayState(this);
    }
    this.activeScreen = screen;
  }

  /** The setting the Live opening was built from, kept so Back to chat can reopen the session. */
  tutorLiveOpeningContext: Parameters<typeof tutorConversationLiveSystemInstruction>[0] | undefined;
  tutorLiveResumeController: AbortController | undefined;

  /** The Register and teaching choice the live session was last told about. */
  tutorLiveSessionChoices: { register: string; teaching: boolean } | undefined;

  tutorLiveAudioLogged = false;

  private disposeViewDisposables(): void {
    const disposables = this.viewDisposables;
    this.viewDisposables = [];
    for (const disposable of disposables) disposable.dispose();
  }

  private async playGeneratedAudio(file: string): Promise<EdgeReadAloudResult> {
    const view = this.view;
    if (!view) return 'failed';
    this.stopGeneratedAudio();
    const releaseSpeech = this.holdTutorSpeech();
    try {
      const information = await stat(file);
      if (!information.isFile() || information.size <= 0 || information.size > 25_000_000) {
        return 'failed';
      }
      const audioBase64 = (await readFile(file)).toString('base64');
      return await this.playGeneratedAudioBase64(audioBase64);
    } catch {
      return 'failed';
    } finally {
      releaseSpeech();
    }
  }

  public async playGeneratedAudioBase64(audioBase64: string, volume = 100, onStarted?: () => void): Promise<EdgeReadAloudResult> {
    const view = this.view;
    if (!view) return 'failed';
    this.stopGeneratedAudio();
    this.generatedAudioCause = undefined;
    try {
      return await new Promise<EdgeReadAloudResult>((resolve) => {
        let settled = false;
        const finish = (result: EdgeReadAloudResult): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (this.generatedAudioResolver === finish) {
            this.generatedAudioResolver = undefined;
            this.generatedAudioStartedCallback = undefined;
            this.generatedAudioReadyCallback = undefined;
          }
          resolve(result);
          queueMicrotask(() => this.flushSpeechRender());
        };
        const fail = (cause: string) => {
          if (settled) return;
          this.generatedAudioCause = cause;
          this.actions.log(`[speech] panel playback failed (${cause})`);
          finish('failed');
        };
        const timeout = setTimeout(() => fail('timeout'), 610_000);
        this.generatedAudioResolver = finish;
        this.generatedAudioStartedCallback = onStarted;
        const clip = {
          command: 'playGeneratedAudio',
          audioBase64, volume, playbackId: ++this.generatedAudioId
        };
        const send = async (retried = false): Promise<void> => {
          if (settled) return;
          try {
            const delivered = await view.webview.postMessage(clip);
            if (settled || delivered) return;
            if (retried) { fail('delivery'); return; }
            // 2026-10-13: Wait for the script's acknowledgment before resending once.
            this.generatedAudioReadyCallback = () => { void send(true); };
            await view.webview.postMessage({ command: 'requestGeneratedAudioReady' });
          } catch { fail('delivery'); }
        };
        void send();
      });
    } catch {
      return 'failed';
    }
  }

  /**
   * Everything the reader can change on the Settings screen, as one comparable string.
   *
   * Built from the live settings object with the four host-supplied fields removed, rather
   * than from a written-out list of rewrite keys. A list here would be a second copy of the
   * rewrite axes, and the copy that nobody updates is the one that decides whether the
   * Regenerate button lights up. The removed fields are not settings: the voice roster and
   * the credential presence map are refreshed in the background while this screen is open,
   * and either would report a change the reader never made.
   */
  private settingsSnapshot(): string {
    const settings: Record<string, unknown> = { ...this.actions.settings() };
    for (const volatileField of VOLATILE_SETTINGS_FIELDS) delete settings[volatileField];
    // A saved global draft does not change a feature's result until Apply to All.
    delete settings.globalRouting;
    return JSON.stringify(Object.keys(settings).sort().map((key) => [key, settings[key]]));
  }

  public get panelVisible(): boolean { return this.view?.visible === true; }

  /** Reuse the panel's long-busy popup for extension operations. */
  public async withPanelProgress<T>(title: string, task: () => Thenable<T>, cancel?: () => void): Promise<T> {
    const operation = this.beginBusy(title, cancel);
    try { return await task(); }
    finally { this.endBusy(operation); }
  }

  /**
   * The notice for the overlay: the most recent wait, or nothing when none is running.
   *
   * The newest is shown rather than the oldest, because it names what the reader started
   * last and is therefore what they are watching for.
   */
  private busyNotice(): string | undefined {
    return this.busyOperations.at(-1)?.notice;
  }

  private beginBusy(notice: string, cancel?: () => void): number {
    const id = (this.nextBusyOperationId += 1);
    this.busyOperations.push({ id, notice, cancel });
    this.updateBusyPopup();
    return id;
  }

  private endBusy(id: number): void {
    const index = this.busyOperations.findIndex((operation) => operation.id === id);
    if (index < 0) return;
    this.busyOperations.splice(index, 1);
    this.updateBusyPopup();
  }

  private updateBusyPopup(): void {
    if (this.view && this.renderedScreen !== undefined) {
      const operation = this.busyOperations.at(-1);
      void this.view.webview.postMessage({ command: 'panelProgress', notice: this.busyNotice(),
        cancelId: operation?.cancel ? operation.id : undefined });
    } else this.render();
  }

  private rewriteReplayState(): RewriteReplayState | undefined {
    const operation = this.state?.operation;
    if (this.settingsBaseline === undefined || !operation) return undefined;
    return {
      armed: true,
      changed: this.settingsSnapshot() !== this.settingsBaseline,
      running: this.regeneratingResult,
      subject: REPLAY_SUBJECTS[operation]
    };
  }

  /**
   * Runs the remembered operation again with the settings as they now stand.
   *
   * The Settings screen stays put until the new result is in, because arriving back to find
   * the previous result still sitting where the new one goes reads as the button having
   * done nothing. `rerunOperation` calls `showResult`, which is what returns the panel to
   * the result screen and clears the baseline.
   */
  private async regenerateResult(): Promise<void> {
    const state = this.state;
    if (!state?.operation || this.settingsBaseline === undefined || this.regeneratingResult) {
      return;
    }
    this.regeneratingResult = true;
    const operation = this.beginBusy(
      `Producing the ${REPLAY_SUBJECTS[state.operation]} again. Please wait.`
    );
    try {
      await this.actions.rerunOperation(state.operation, state.sourceText);
    } catch (error: unknown) {
      this.reportActionFailure('Regenerate', error, 'panel regenerate failed');
    } finally {
      this.regeneratingResult = false;
      // 2026-10-05: setResult clears the baseline only when regeneration publishes a result.
      this.endBusy(operation);
    }
  }

  render(scrollToStoppedActions = false, voiceModelOnly = false, speechProviderChanged = false): void {
    // 2026-10-02: The new document resumes decoding with the same pending identity.
    if (this.activeScreen === 'tutor' && !voiceModelOnly) this.tutorState = markTutorExampleViewed(this.tutorState);
    if (!this.view) { ensureTutorConversationPicture(this); return; }
    const nonce = createNonce();
    const settings = {
      ...this.actions.settings(),
      ...(this.userDictionaryState.status === 'ready'
        ? { userDictionaryEntryCount: this.userDictionaryState.entries.length }
        : {}),
      customGeminiModels: this.customModels.gemini,
      customTutorLiveModels: this.customModels.geminiLive,
      customTutorImageModels: this.customModels.geminiImage,
      tutorImageModels: this.imageModels.length ? this.imageModels : undefined,
      customOpenAIModels: this.customModels.openai,
      customAnthropicModels: this.customModels.anthropic,
      // 2026-10-15: Retired stored or newly added custom entries cannot reintroduce the option.
      customGroqModels: this.customModels.groq.filter(model => !GROQ_RETIRED_MODELS[model]),
      customCloudflareModels: this.customModels.cloudflare,
      groqModels: this.groqModels,
      tutorHintModel: configuredTutorHintModel(),
      tutorLiveModel: configuredTutorLiveModel(),
      tutorConversationLiveTranscriptionLanguage: configuredTutorLiveTranscriptionLanguage(),
      tutorConversationMicrophoneSensitivity: configuredTutorMicrophoneSensitivity(),
      tutorConversationPauseBeforeReply: configuredTutorPauseBeforeReply(),
      tutorConversationSpeechDetection: configuredTutorSpeechDetection(),
      tutorConversationMicrophoneCloseWait: configuredTutorMicrophoneCloseWait(),
      tutorConversationPressToTalk: configuredTutorPressToTalk()
    };
    const brandImageUri = this.view.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'kren-panel-logo.png')
    ).toString();
    const googleAttributionImageUri = this.view.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'google-translate-attribution.png')
    ).toString();
    const tutorConversationStopState = computeTutorConversationStopState(this);
    // 2026-10-12: A speech-waiting typing bubble cannot consume the committed picture check.
    const pictureCheckPending = this.tutorState.conversation.speechReveal?.started === 0;
    const committedPictureTurn = this.tutorConversationPictureCommitPending && !pictureCheckPending
      ? this.tutorConversationPictureEligibleTurn : undefined;
    const html = renderKrenResultViewHtml({
      cspSource: this.view.webview.cspSource,
      nonce,
      themeKind: currentPanelThemeKind(),
      brandImageUri,
      googleAttributionImageUri,
      merriamWebsterLogoUris: {
        light: this.view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'mw-logo-lightbg.png')).toString(),
        dark: this.view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'mw-logo-darkbg.png')).toString()
      },
      result: this.state?.result,
      sourceText: this.state?.sourceText,
      allowReplace: this.state?.allowReplace,
      autoplayAudio: this.autoplayAudio,
      settings,
      panelNotices: this.notices.snapshot(),
      activeScreen: this.activeScreen,
      environmentItems: this.environmentChecks?.items,
      environmentBusy: this.environmentChecks?.busy,
      systemUpdatesAvailable: systemUpdatesAvailable(this.environmentChecks?.statuses ?? {}),
      userDictionary: this.userDictionaryState,
      tutor: this.tutorState,
      tutorResetDisclosures: this.pendingTutorResetDisclosures,
      tutorResetAllDisclosures: this.pendingTutorResetAllDisclosures,
      tutorResetDisclosure: this.tutorResetDisclosure,
      proModels: this.proModels,
      liveModels: this.liveModels,
      openAIModels: this.openAIModels,
      anthropicModels: this.anthropicModels,
      inferredRewriteModality: this.inferredRewriteModality,
      activeRewriteSettingsGroup: this.activeRewriteSettingsGroup,
      rewriteReplay: this.rewriteReplayState(),
      ...(this.state?.result.kind === 'grammar'
        ? { grammarChoices: this.state.grammarChoices ?? [] }
        : {}),
      ...(this.busyNotice() ? { busyNotice: this.busyNotice() } : {}),
      busyCancelId: this.busyOperations.at(-1)?.cancel ? this.busyOperations.at(-1)?.id : undefined,
      ...(this.pendingSettingsFocus ? { focusSettingsSection: this.pendingSettingsFocus } : {}),
      ...(this.pendingTutorTargetFocus
        ? { focusTutorTargetId: this.pendingTutorTargetFocus }
        : {}),
      ...(this.pendingTutorAnnouncement
        ? { tutorAnnouncement: this.pendingTutorAnnouncement }
        : {}),
      ...(this.pendingTutorResultFocus
        ? { focusTutorResult: this.pendingTutorResultFocus }
        : {}),
      ...(this.pendingTutorConversationFocus ? { focusTutorConversation: true } : {}),
      tutorSpeechProvider: configuredTutorSpeechProvider(),
      tutorLiveReplayAvailable: tutorLiveReplayAvailable(this),
      tutorLiveFailed: this.tutorLiveFailed,
      tutorConversationReplayAvailable: tutorConversationReplayAvailable(this),
      ...(this.tutorState.conversation.status === 'active' && this.tutorState.conversation.situationPicture !== 'none'
        ? { tutorConversationPicturePending: this.tutorConversationPicturePending } : {}),
      ...(committedPictureTurn !== undefined
        ? { tutorConversationPictureCommittedTurn: committedPictureTurn } : {}),
      ...(this.tutorConversationScene
        ? { tutorConversationScene: this.tutorConversationScene }
        : {}),
      ...(this.tutorConversationPicture && this.tutorState.conversation.situationPicture !== 'none'
        ? { tutorConversationPicture: this.tutorConversationPicture, tutorConversationPictures: this.tutorConversationPictures, tutorConversationPictureTurns: this.tutorConversationPictureTurns }
        : {}),
      ...(this.tutorState.conversation.hintBusy
        ? { tutorConversationHintTurnGeneration: this.tutorConversationTurnGeneration }
        : {}),
      tutorLiveTalkAvailable: this.tutorLiveSession !== undefined && !this.tutorLiveFailed &&
        this.tutorState.conversation.replies === 'liveGemini',
      tutorLiveTalkListening: this.tutorLiveMicrophone !== undefined,
      tutorLivePressToTalk: this.tutorLivePressToTalk,
      tutorConversationStopDisabled: tutorConversationStopState.disabled,
      tutorConversationStopTitle: tutorConversationStopState.title,
      tutorScrollToStoppedActions: scrollToStoppedActions,
      tutorStandardQuietPeriodMs: MICROPHONE_SENSITIVITY_PROFILES[
        this.tutorState.conversation.status === 'active'
          ? this.tutorLiveMicrophoneSensitivity
          : configuredTutorMicrophoneSensitivity()
      ].standardQuietPeriodMs
    });
    if (voiceModelOnly && this.activeScreen === 'tutor') {
      void this.view.webview.postMessage({ command: 'tutorVoiceModelReady', html, ...(speechProviderChanged ? { speechProviderChanged: true } : {}) });
      return;
    }
    // 2026-10-12: Replacing the document stops its audio. Patch the active conversation
    // instead, using the same state gates as the first render and retaining its player.
    if (this.activeScreen === 'tutor' && this.renderedScreen === 'tutor' && this.tutorState.conversation.status !== 'idle' &&
        (this.generatedAudioResolver || this.tutorSpeechHolds || this.tutorConversationSpeechSequenceRunning || this.tutorState.conversation.openingReveal ||
          this.tutorState.conversation.speechReveal)) {
      // Conversation patches do not replace the lesson or execute its reset announcement.
      if (this.pendingTutorAnnouncement) this.deferredSpeechRender = true;
      void this.view.webview.postMessage({ command: 'tutorConversationRender', html,
        ...(committedPictureTurn !== undefined ? { committedTurn: committedPictureTurn } : {}) });
      if (!pictureCheckPending) this.tutorConversationPictureCommitPending = false;
      ensureTutorConversationPicture(this);
      return;
    }
    if (this.generatedAudioResolver || this.tutorSpeechHolds || this.tutorConversationSpeechSequenceRunning) {
      this.deferredSpeechRender = true;
      return;
    }
    this.tutorConversationPictureCommitPending = false;
    this.deferredSpeechRender = false;
    this.renderedScreen = this.activeScreen;
    this.view.webview.html = html;
    ensureTutorConversationPicture(this);
    this.autoplayAudio = undefined;
    this.pendingTutorTargetFocus = undefined;
    this.pendingTutorAnnouncement = undefined;
    this.pendingTutorResetDisclosures = false;
    this.pendingTutorResetAllDisclosures = false;
    this.pendingTutorResultFocus = undefined;
    this.pendingTutorConversationFocus = false;
  }

  private syncTutorRoutingSettings(): void {
    const settings = this.actions.settings();
    this.tutorState.settings.routing = {
      provider: settings.tutorProvider ?? TUTOR_DEFAULTS.configuration['tutor.provider'],
      model: tutorModelForRoute(settings),
      thinkingOrEffort: settings.tutorThinkingOrEffort ?? TUTOR_DEFAULTS.configuration['tutor.thinkingOrEffort']
    };
  }

  /** Models that refused the fast conversation level, mapped to the level that worked instead. */
   readonly tutorConversationEffortByModel = new Map<string, LanguageModelRoutingEffort>();

  private tutorDemoLiveVoice(speaker: TutorConversationDemoSpeaker): string {
    return tutorDemoLiveVoice(this, speaker);
  }

  private speakTutorDemoText(
    text: string,
    speaker: TutorConversationDemoSpeaker | undefined,
    generation: number
  ): Promise<boolean> {
    return speakTutorDemoText(this, text, speaker, generation);
  }

  private speakTutorConversationSequence(
    utterances: readonly (string | TutorConversationSpeechItem)[],
    failure: string,
    replayAll = false
  ): void {
    speakTutorConversationSequence(this, utterances, failure, replayAll);
  }
  private skipTutorConversationTurn(): void {
    skipTutorConversationTurn(this);
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isCommandMessage(message)) return;
    // A newer reader intention retires both the outstanding card and its eventual choice.
    if (['updateTutorMapPath', 'updateTutorTarget', 'clearTutorTargets', 'clearTutorSearch',
      'resetTutorSession', 'resetTutorLesson', 'askTutorQuestion'].includes(message.command) ||
      (message.command === 'updateTutorSearch' && message.search !== this.tutorState.mapSearch)) this.cancelTutorFind();
    if (message.command === 'openCredentialHelp') {
      const id = message.credentialId!;
      const help = credentialHelpFor(id);
      if (!help) {
        this.actions.log(`[credential help unavailable] ${id}`);
        return;
      }
      // Reject URL-bearing messages even when they also name a known credential.
      if ('url' in message) return;
      await vscode.env.openExternal(vscode.Uri.parse(help.url));
      return;
    }
    if (this.tutorState.conversation.from === 'speakAndRephrase' && (
      ['hintTutorConversation', 'startTutorConversationDemo', 'skipTutorConversationTurn',
        'showTutorConversationRephrase', 'updateTutorConversationSituation', 'updateTutorConversationCustom',
        'updateTutorConversationRoleSwapped', 'updateTutorConversationStarts', 'updateTutorConversationCoaching',
        'updateTutorConversationReplyLength', 'updateTutorConversationSituationPicture',
        'updateTutorConversationPictureTransparency'].includes(message.command) ||
      (message.command === 'updateSetting' && (message.key === 'tutor.conversation.pictureStyle' ||
        message.key === 'tutor.conversation.hintPrefetch'))
    )) return;
    if (message.command === 'openUpdatesPythonSetting') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'kren.readAloud.edgePythonCommand');
      return;
    }
    if (message.command === 'checkForUpdates' || message.command === 'updateEdgeTts') {
      this.setActiveScreen('updates');
      this.render();
      if (message.command === 'updateEdgeTts') await this.environmentChecks?.updateEdgeTts();
      else await this.environmentChecks?.check();
      this.environmentChecksChanged();
      return;
    }
    if (message.command === 'toggleTheme') {
      const shown = shownPanelTheme(this.actions.settings().panelTheme ?? 'followVSCode');
      await updatePanelTheme(this, shown === 'light' ? 'dark' : 'light');
      return;
    }
    if (message.command === 'tutorHandyTranscriptReceived' ||
        message.command === 'tutorHandyQuietPeriodStarted' ||
        message.command === 'tutorHandyQuietPeriodElapsed') {
      this.tutorStandardTurnTiming ??= new StandardConversationTurnTiming(
        (line) => this.actions.log(line), Date.now
      );
      this.tutorStandardTurnTiming.dictationProviderRan('handy');
      if (message.command === 'tutorHandyTranscriptReceived') {
        this.tutorStandardTurnTiming.transcriptReceived();
        const speech = this.tutorState.speech;
        if (speech.dictationProvider === 'handy' && speech.dictatingConversation === true) {
          this.tutorHandyConversationTranscriptPending = true;
          this.tutorState = { ...this.tutorState, conversation: {
            ...this.tutorState.conversation, draftAnswerSpoken: true
          } };
        }
      } else if (message.command === 'tutorHandyQuietPeriodStarted') {
        this.tutorStandardTurnTiming.quietPeriodStarted();
      } else {
        this.tutorStandardTurnTiming.quietPeriodElapsed();
      }
    }
    if (message.command === 'tutorLiveInputBubblePatched' &&
        this.tutorLiveInputLatency.learnerBubblePatchedAt === undefined) {
      this.tutorLiveInputLatency.learnerBubblePatchedAt = Date.now();
    }
    // Cleared by the reader's next action rather than by the next render. Clearing it on
    // render looked equivalent and was not: opening Settings through the gear also kicks off
    // a background voice refresh, whose render landed before the webview had run the script
    // that reads this, so the scroll target was gone before anything used it.
    if (message.command !== 'editRewriteSettings') this.pendingSettingsFocus = undefined;
    if (message.command === 'copy') await this.actions.copy();
    if (message.command === 'details') this.actions.details();
    if (message.command === 'replace' && this.state?.allowReplace) {
      await this.actions.replace();
    }
    if (message.command === 'copyVariant') {
      const text = this.rewriteVariantText(message.variantId);
      if (text) await this.actions.copyText(text);
    }
    if (message.command === 'replaceVariant' && this.state?.allowReplace) {
      const text = this.rewriteVariantText(message.variantId);
      if (text) await this.actions.replaceText(text);
    }
    // Replace and Copy act on the text in the box, not on a recomputation from the radios,
    // so an edit the reader made there is what reaches the document or the clipboard.
    if (message.command === 'applyGrammar' && message.draftText !== undefined) {
      if (this.state?.allowReplace) await this.actions.replaceText(message.draftText);
      else this.actions.notify('information', 'This result cannot replace editor text.');
    }
    if (message.command === 'copyGrammar' && message.draftText !== undefined) {
      await this.actions.copyText(message.draftText);
    }
    if (message.command === 'updateGrammarChoice' && message.issueId &&
        message.suggestionIndex !== undefined && this.state?.result.kind === 'grammar') {
      const others = (this.state.grammarChoices ?? [])
        .filter((choice) => choice.issueId !== message.issueId);
      this.state = {
        ...this.state,
        grammarChoices: [
          ...others,
          { issueId: message.issueId, suggestionIndex: message.suggestionIndex }
        ]
      };
      this.render();
    }
    if (message.command === 'resetGrammarDraft' && this.state?.result.kind === 'grammar') {
      this.state = {
        ...this.state,
        grammarChoices: [...preselectedGrammarChoices(this.state.result)]
      };
      this.render();
    }
    if ((message.command === 'addGrammarWord' || message.command === 'ignoreGrammarIssue') &&
        message.issueId) {
      await this.actions.manageGrammarIssue(
        message.issueId,
        message.command === 'addGrammarWord' ? 'addWord' : 'ignore'
      );
    }
    if (message.command === 'readVariant') {
      const text = this.rewriteVariantText(message.variantId);
      if (text) {
        this.inferredRewriteModality = REWRITE_MODALITIES[1].id;
        this.render();
        const result = this.state?.result;
        const language = result?.kind === 'rewrite'
          ? result.variants.find((variant) => variant.id === message.variantId)?.targetLanguage ?? result.targetLanguage
          : result?.targetLanguage;
        void this.actions.readAloudText(text, language)
          .catch((error: unknown) => {
            this.reportActionFailure('Read Aloud', error, 'panel read aloud failed');
          });
      }
    }
    if (message.command === 'clear') {
      this.actions.clear();
    }
    if (message.command === 'updateSetting' && message.key !== undefined &&
        message.value !== undefined) {
      if (message.key === 'display.panelTheme') {
        await updatePanelTheme(this, message.value);
        return;
      }
      if (message.key === 'llm.providerSwitch' || message.key === 'llm.providerOrder') {
        await updateProviderSwitchSetting(this, message.key, message.value);
      } else if (message.key.startsWith('tutor.')) {
        await updateTutorSetting(this, message.key, message.value);
      } else {
        await this.actions.updateSetting(message.key, message.value);
        if (message.key === 'rewrite.modality') this.inferredRewriteModality = undefined;
      }
    }
    if (message.command === 'previewTutorEdgeVoice') await previewTutorEdgeVoice(this);
    if (message.command === 'previewTutorGeminiVoice') await previewTutorGeminiVoice(this);
    if ((message.command === 'updateTutorEdgeFemaleVoice' ||
        message.command === 'updateTutorEdgeMaleVoice' ||
        message.command === 'updateTutorGeminiFemaleVoice' ||
        message.command === 'updateTutorGeminiMaleVoice') && message.input !== undefined) {
      await updateTutorVoiceDefault(this, message.command, message.input);
    }
    if (message.command === 'applyRewriteMode' && message.modeId) {
      this.inferredRewriteModality = undefined;
      for (const { key, value } of rewriteModeSettingEntries(message.modeId)) {
        await this.actions.updateSetting(key, value);
      }
      this.render();
    }
    if (message.command === 'editRewriteGroup') {
      this.activeRewriteSettingsGroup = message.group || undefined;
    }
    if (message.command === 'editRewriteSettings') {
      // Arriving this way is what arms the apply bar. Reaching Settings from the menu or
      // the header leaves it hidden, because there is no result behind it to return to.
      this.settingsBaseline = this.settingsSnapshot();
      this.setActiveScreen('settings');
      // The gear sits on a rewrite result, so it opens the rewrite section rather than
      // the top of a page with nine sections on it.
      this.pendingSettingsFocus = 'rewrite';
      this.render();
      this.refreshReadAloudVoicesInBackground();
    }
    if (message.command === 'regenerateResult') {
      await this.regenerateResult();
    }
    if (message.command === 'pinInferredModality' && this.inferredRewriteModality) {
      await this.actions.updateSetting('rewrite.modality', this.inferredRewriteModality);
      this.inferredRewriteModality = undefined;
      this.render();
    }
    if (message.command === 'runCommand' && message.action) {
      // Commands can ask for consent or await playback. Their receiver bypasses the
      // settings queue, and their completion must not hold it either.
      const action = message.action;
      if (action === 'kren.applyGlobalRouting') {
        // This bounded command waits behind draft saves, so the preview uses the latest choices.
        await vscode.commands.executeCommand('kren.applyGlobalRouting');
        return;
      }
      if (!isPanelCommand(action)) {
        const text = `KREN programming error: command "${action}" is not available in this build.`;
        this.actions.log(`[panel command unavailable] ${action}`);
        this.actions.notify('error', text);
      } else {
        // A language action takes seconds, and until it lands the panel looks exactly as it
        // did before the press. The overlay names the wait and takes the pointer events, so
        // the reader neither wonders whether the control worked nor starts a second one.
        const notice = panelCommandBusyNotice(action);
        const operation = notice === undefined ? undefined : this.beginBusy(notice);
        void this.actions.runCommand(action)
          .catch((error: unknown) => {
            this.reportActionFailure(
              action,
              error,
              'panel command failed'
            );
          })
          .finally(() => {
            if (operation !== undefined) this.endBusy(operation);
          });
      }
    }
    if (message.command === 'showSettings') {
      this.settingsBaseline = undefined;
      this.setActiveScreen('settings');
      this.render();
      this.refreshReadAloudVoicesInBackground();
    }
    if (message.command === 'showCredentials') {
      this.setActiveScreen('credentials');
      this.render();
    }
    if (message.command === 'showManual') {
      this.setActiveScreen('manual');
      this.render();
    }
    /*
     * Ignore all. The order is the whole behaviour: actions.clear() ends by calling this
     * view's own clear(), which sets the screen back to 'result' and renders an empty one.
     * Setting the start screen afterwards is what the reader actually asked for, so a
     * later refactor that moves this line above the clear silently restores the empty
     * result screen.
     */
    if (message.command === 'ignoreGrammarResult') {
      this.actions.clear();
      this.setActiveScreen('start');
      this.render();
    }
    if (message.command === 'showStartPage') {
      this.setActiveScreen('start');
      this.render();
    }
    if (message.command === 'showTutor') {
      this.setActiveScreen('tutor');
      this.render();
    }
    if (message.command === 'showResult') {
      this.setActiveScreen('result');
      this.render();
    }
    if (message.command === 'showUserDictionary') {
      try {
        await this.showUserDictionary();
      } catch (error) {
        this.reportActionFailure('Open User Dictionary', error, 'user dictionary open failed');
      }
    }
    if (message.command === 'updateTutorMapPath' && message.mapLevel !== undefined &&
        message.targetId !== undefined) {
      const changed = changeTutorMapSelection(
        this.tutorState,
        message.mapLevel,
        message.targetId
      );
      this.tutorState = changed === this.tutorState
        ? changed
        : { ...changed, mapSearch: '' };
      this.render();
    }
    if (message.command === 'updateTutorTarget' && message.targetId && message.role) {
      await updateTutorTarget(this, message.targetId, message.role, message.keyboardFocus === true);
    }
    if (message.command === 'clearTutorTargets') {
      /*
       * Clear all rewinds the four dropdowns as well as the tray. It cleared only the
       * tray, which left the cascade still showing the path of a target that was no
       * longer selected, and Primary still offering the target just removed.
       */
      this.pendingTutorAnnouncement =
        'All tutor targets were cleared and the learning map was rewound.';
      const previousState = this.tutorState;
      const nextState: TutorViewState = {
        ...previousState,
        selection: [],
        mapPath: {},
        lessonStale: previousState.lessonStale ||
          Boolean(previousState.lesson && previousState.selection.length > 0),
        selectionMessage: undefined
      };
      this.tutorState = previousState.selection.length > 0
        ? regeneratePreparedPrompt(previousState, nextState)
        : nextState;
      this.render();
    }
    if (message.command === 'resetTutorSession') await confirmTutorReset(this);
    if (message.command === 'resetTutorLesson') await confirmTutorLessonReset(this);
    if (message.command === 'resetTutorConversationDefaults' &&
        this.tutorState.conversation.status !== 'active') {
      this.tutorState = resetTutorConversationDefaults(this.tutorState);
      this.persistTutorPreferences();
      this.render();
      this.tutorState = { ...this.tutorState, conversation: {
        ...this.tutorState.conversation, openModeAfterRender: undefined
      } };
    }
    if (message.command === 'updateTutorSearch' && message.search !== undefined) {
      this.tutorState = { ...this.tutorState, mapSearch: message.search };
    }
    if (message.command === 'clearTutorSearch') {
      this.tutorState = { ...this.tutorState, mapSearch: '' };
      this.render();
    }
    if (message.command === 'findTutorTargets' && message.search !== undefined) {
      await findTutorTargets(this, message.search);
    }
    if (message.command === 'askTutorQuestion' && message.search !== undefined) {
      // 2026-10-05: Ask owns its controller; Cancel must run while its provider is pending.
      void askTutorQuestion(this, message.search).catch((error: unknown) => {
        this.actions.log(`Tutor Ask failed: ${safePanelErrorMessage(error)}`);
      });
    }
    if (message.command === 'cancelTutorAsk') cancelTutorAsk(this);
    if (message.command === 'openTutorDiagnosticReport' && this.tutorState.diagnosticReport) {
      this.tutorState = { ...this.tutorState, diagnosticReportDrawerOpen: true,
        preparedPromptDrawerOpen: false };
      this.render();
    }
    if (message.command === 'closeTutorDiagnosticReport') {
      if (this.tutorState.askBusy === 'tailoredPrompt') cancelTutorAsk(this);
      this.tutorState = { ...this.tutorState, diagnosticReportDrawerOpen: false };
      this.render();
    }
    if (message.command === 'cancelTutorDiagnosticReport') {
      // The modal waits for the reader, so it must not hold the message queue.
      void confirmTutorDiagnosticReportDeletion(this);
    }
    if (message.command === 'applyTutorDiagnosticReport') {
      // Leave the message queue free for Cancel and another Apply while the provider runs.
      void applyTutorDiagnosticReport(this);
    }
    if (message.command === 'openTutorPreparedPrompt' &&
        (this.tutorState.preparedPrompt !== undefined ||
          (this.tutorState.questionPrepared && tutorPreparedPrompt(this.tutorState) !== undefined))) {
      this.tutorState = { ...this.tutorState, preparedPromptDrawerOpen: true, diagnosticReportDrawerOpen: false };
      this.render();
    }
    if (message.command === 'closeTutorPreparedPrompt') {
      this.tutorState = { ...this.tutorState, preparedPromptDrawerOpen: false };
      this.render();
    }
    if (message.command === 'updateTutorPreparedPrompt' && message.prompt !== undefined) {
      this.tutorState = {
        ...this.tutorState,
        preparedPrompt: message.prompt,
        preparedPromptSource: this.tutorState.preparedPromptSource === 'tailored' ? 'tailored' : 'edited',
        preparedPromptNotice: undefined
      };
    }
    if (message.command === 'generateTutorLesson') startTutorLessonGeneration(this);
    if (message.command === 'cancelTutorLesson') cancelTutorLesson(this);
    if (message.command === 'hintTutorExercise' && message.exerciseId) {
      void writeTutorPracticeHint(this, message.exerciseId);
    }
    if (message.command === 'playTutorExercise' && message.exerciseId) {
      const item = this.tutorState.exerciseSet?.exercises.find(
        (candidate) => candidate.id === message.exerciseId
      );
      if (item) {
        void this.actions.readAloudText(item.prompt, 'en', 'tutor').catch((error: unknown) => {
          this.reportActionFailure('Play practice question', error, 'practice question playback failed');
        });
      }
    }
    if (message.command === 'dictateTutorExercise' && message.exerciseId) {
      await toggleTutorDictation(this, { exerciseId: message.exerciseId });
    }
    if (message.command === 'dictateTutorConversation') {
      await toggleTutorDictation(this, { conversation: true });
    }
    if (message.command === 'playTutorExample' && message.exampleId) {
      const example = this.tutorState.lesson?.lesson.examples.find(
        (candidate) => candidate.id === message.exampleId
      );
      if (example) {
        void this.actions.readAloudText(example.sentence, 'en', 'tutor').catch((error: unknown) => {
          this.reportActionFailure('Play tutor example', error, 'tutor example playback failed');
        });
      }
    }
    if (message.command === 'copyTutorExample' && message.exampleId) {
      const example = this.tutorState.lesson?.lesson.examples.find(
        (candidate) => candidate.id === message.exampleId
      );
      if (example) await this.actions.copyText(example.sentence);
    }
    if (message.command === 'regenerateTutorExample' && message.exampleId) {
      regenerateTutorExample(this, message.exampleId);
    }
    if (message.command === 'cancelTutorExample' && message.exampleId) {
      cancelTutorExample(this, message.exampleId);
    }
    if (message.command === 'openTutorTool' && message.exampleId && message.tool) {
      openTutorTool(this, message.exampleId, message.tool);
    }
    if (message.command === 'openTutorPracticeAsk' && message.exerciseId) {
      openTutorPracticeAsk(this, message.exerciseId);
    }
    if (message.command === 'updateTutorToolInput' && message.input !== undefined &&
        this.tutorState.toolDrawer) {
      this.tutorState = {
        ...this.tutorState,
        toolDrawer: { ...this.tutorState.toolDrawer, input: message.input, status: 'editing' }
      };
    }
    if (message.command === 'updateTutorToolTargetLanguage' && message.targetLanguage &&
        (this.tutorState.toolDrawer?.tool === 'translate' || this.tutorState.toolDrawer?.tool === 'dictionary')) {
      this.tutorState = {
        ...this.tutorState,
        toolDrawer: {
          ...this.tutorState.toolDrawer,
          targetLanguage: message.targetLanguage,
          status: 'editing'
        }
      };
    }
    if (message.command === 'submitTutorTool') {
      submitTutorTool(this, typeof message.selection === 'string' ? message.selection : undefined);
    }
    if (message.command === 'restoreTutorDictionaryContext') {
      restoreTutorDictionaryContext(this);
    }
    if (message.command === 'closeTutorTool') closeTutorTool(this);
    if (message.command === 'generateTutorExercises') generateTutorExercises(this);
    if (message.command === 'cancelTutorExercises') cancelTutorExercises(this);
    if (message.command === 'toggleTutorCoach') {
      this.tutorState = { ...this.tutorState, conversation: {
        ...this.tutorState.conversation, coachOpen: !this.tutorState.conversation.coachOpen
      } };
      this.render();
    }
    if (message.command === 'toggleTutorConversationSpeaker') {
      const speakerOn = !this.tutorState.conversation.speakerOn;
      this.tutorState = { ...this.tutorState, conversation: { ...this.tutorState.conversation, speakerOn } };
      if (!speakerOn) {
        stopTutorTakeHomeSpeech(this);
        cancelTutorConversationReplayAll(this, false);
        void this.actions.stopReadAloud();
        stopTutorLiveAudio(this);
      }
      if (this.tutorLiveSession && this.tutorState.conversation.status === 'active') {
        postTutorLiveSpeakerState(this);
      } else {
        this.render();
      }
    }
    if (message.command === 'retryTutorTurnCheck') {
      await retryTutorTurnCheck(this, Number(message.input));
      return;
    }
    if (message.command === 'replayTutorQuestion') {
      replayTutorQuestion(this);
    }
    if (message.command === 'hintTutorConversation') {
      // The request owns its cancellation and stale-result guard. Keeping it outside the
      // serialized queue lets Stop talking and Stop conversation act while the provider waits.
      void writeTutorConversationHint(this);
    }
    if (message.command === 'skipTutorConversationTurn') skipTutorConversationTurn(this);
    if (message.command === 'askTutorConversationTurn') {
      const conversation = this.tutorState.conversation;
      const position = message.input === undefined ? conversation.currentTurnIndex : Number(message.input);
      const turn = Number.isInteger(position) ? conversation.transcript[position] : undefined;
      if (turn && !turn.skipped) {
        this.tutorToolController?.abort();
        this.tutorToolController = undefined;
        this.tutorState = { ...this.tutorState, toolDrawer: {
          tool: 'ask', context: turn.question, learnerAnswer: turn.learnerAnswer,
          input: '', status: 'editing'
        } };
        this.render();
      }
    }
    if (message.command === 'showTutorConversationRephrase') {
      const position = Number(message.input);
      const conversation = this.tutorState.conversation;
      const turn = Number.isInteger(position) ? conversation.transcript[position] : undefined;
      if (turn?.rephrase?.trim() && turn.rephraseWhy?.trim()) {
        const transcript = [...conversation.transcript];
        transcript[position] = { ...turn, rephraseShown: true };
        this.tutorState = { ...this.tutorState, conversation: { ...conversation, transcript } };
      }
    }
    if (message.command === 'updateTutorConversationFrom' ||
        message.command === 'updateTutorConversationSituation' ||
        message.command === 'updateTutorConversationRoleSwapped' ||
        message.command === 'updateTutorConversationStarts' ||
        message.command === 'updateTutorConversationRegister' ||
        message.command === 'updateTutorConversationCoaching' ||
        message.command === 'updateTutorConversationSend' ||
        message.command === 'updateTutorConversationReplies' ||
        message.command === 'updateTutorConversationReplyLength' ||
        message.command === 'updateTutorConversationSituationPicture' ||
        message.command === 'updateTutorConversationPictureTransparency' ||
        message.command === 'updateTutorConversationBalloonTransparency' ||
        message.command === 'updateTutorConversationLiveVoice' ||
        message.command === 'updateTutorConversationCustom') {
      const conversation = this.tutorState.conversation;
      // 2026-09-22: Register, Correction, and Replies are disabled by the active panel. Keep
      // their controller paths and V129 switching machinery intact: Back to chat still uses
      // the same reopen and close operations, and direct controller tests guard those paths.
      const changesWhileActive = message.command === 'updateTutorConversationRegister' ||
        message.command === 'updateTutorConversationCoaching' ||
        message.command === 'updateTutorConversationSend' ||
        message.command === 'updateTutorConversationReplies' ||
        message.command === 'updateTutorConversationReplyLength' ||
        message.command === 'updateTutorConversationSituationPicture' ||
        message.command === 'updateTutorConversationPictureTransparency' ||
        message.command === 'updateTutorConversationBalloonTransparency' ||
        message.command === 'updateTutorConversationLiveVoice';
      if (conversation.status !== 'active' || changesWhileActive) {
        const input = message.input!;
        if (message.command === 'updateTutorConversationFrom' && input === 'lesson' &&
            !tutorLessonConversationReadiness(this.tutorState).ready) {
          // The notice owns its choice; there is no setting write to serialize here.
          void showTutorLessonUnavailable(this);
          void this.view?.webview.postMessage({ command: 'tutorLessonSourceReverted', source: conversation.from });
          return;
        }
        if (message.command === 'updateTutorConversationFrom' &&
            (input === 'situation' || input === 'lesson' || input === 'anything' || input === 'speakAndRephrase') &&
            (input !== 'lesson' || tutorLessonConversationReadiness(this.tutorState).ready)) {
          this.tutorState = { ...this.tutorState, conversation: { ...conversation, from: input } };
        } else if (message.command === 'updateTutorConversationRoleSwapped' &&
            (input === 'true' || input === 'false')) {
          this.tutorState = { ...this.tutorState, conversation: {
            ...conversation, rolesSwapped: input === 'true'
          } };
        } else if (message.command === 'updateTutorConversationStarts' &&
            (TUTOR_CONVERSATION_STARTS as readonly string[]).includes(input)) {
          this.tutorState = { ...this.tutorState, conversation: {
            ...conversation, starts: input as TutorConversationStarts
          } };
        } else if (message.command === 'updateTutorConversationCustom') {
          this.tutorState = { ...this.tutorState, conversation: { ...conversation, customSituation: input } };
        } else if (message.command === 'updateTutorConversationCoaching' &&
            (TUTOR_CONVERSATION_COACHING as readonly string[]).includes(input)) {
          this.tutorState = { ...this.tutorState, conversation: {
            ...conversation, coaching: input as TutorConversationCoaching
          } };
        } else if (message.command === 'updateTutorConversationLiveVoice' && isTutorLiveVoice(input)) {
          // Read when the next Live session opens; a session already open keeps its voice.
          this.tutorState = { ...this.tutorState, conversation: {
            ...conversation, liveVoice: normalizedTutorLiveVoice(input)
          } };
        } else if (message.command === 'updateTutorConversationReplyLength' &&
            (TUTOR_CONVERSATION_REPLY_LENGTHS as readonly string[]).includes(input)) {
          this.tutorState = { ...this.tutorState, conversation: {
            ...conversation, replyLength: input as TutorConversationReplyLength
          } };
        } else if (message.command === 'updateTutorConversationBalloonTransparency') {
          const preference = tutorConversationPreferences({ balloonTransparency: input });
          if (preference.balloonTransparency) {
            this.tutorState = { ...this.tutorState, conversation: {
              ...conversation, balloonTransparency: preference.balloonTransparency
            } };
            void this.view?.webview.postMessage({
              command: 'tutorConversationBalloonTransparencyReady',
              transparency: preference.balloonTransparency
            });
          }
        } else if (message.command === 'updateTutorConversationPictureTransparency') {
          const preference = tutorConversationPreferences({ pictureTransparency: input });
          if (preference.pictureTransparency) {
            this.tutorState = { ...this.tutorState, conversation: {
              ...conversation, pictureTransparency: preference.pictureTransparency
            } };
            void this.view?.webview.postMessage({
              command: 'tutorConversationPictureTransparencyReady',
              transparency: preference.pictureTransparency
            });
          }
        } else if (message.command === 'updateTutorConversationSituationPicture' &&
            ['none', 'intro', 'switching', 'graduallyEntering'].includes(input)) {
          const mode = input as typeof conversation.situationPicture;
          const layoutOnly = ['switching', 'graduallyEntering'].includes(mode) &&
            ['switching', 'graduallyEntering'].includes(conversation.situationPicture);
          this.tutorState = { ...this.tutorState, conversation: { ...conversation, situationPicture: mode } };
          // 2026-10-02: Mode patches replace decode callbacks, so cancel before changing layout.
          if (!layoutOnly) cancelTutorConversationPicture(this);
          if (!['switching', 'graduallyEntering'].includes(mode)) {
            this.tutorConversationPictures = mode === 'none' ? [] : this.tutorConversationPictures.slice(0, 1);
            this.tutorConversationPicture = this.tutorConversationPictures[0];
            this.tutorConversationPictureTurns = mode === 'none' ? [] : this.tutorConversationPictureTurns.slice(0, 1);
          }
          void this.view?.webview.postMessage({ command: 'tutorConversationPictureReady',
            images: this.tutorConversationPictures, turns: this.tutorConversationPictureTurns, mode,
            ...(layoutOnly ? { layoutOnly: true } : {}) });
          if (!layoutOnly) ensureTutorConversationPicture(this);
        } else if (message.command === 'updateTutorConversationReplies' &&
            (TUTOR_CONVERSATION_REPLIES as readonly string[]).includes(input)) {
          if (input === 'liveGemini') {
            // Standard and Live cannot own the same control. Discard any partial Standard
            // dictation and finish its late-start cleanup before Talk can be advertised.
            await cancelTutorConversationDictation(this, true);
          }
          const currentConversation = this.tutorState.conversation;
          this.tutorState = { ...this.tutorState, conversation: {
            ...currentConversation, replies: input as TutorConversationReplies
          } };
          if (input === 'liveGemini') {
            // An explicit selection is a new attempt. A genuine earlier failure keeps using
            // Standard until the reader asks for Live again here.
            this.tutorLiveFailed = false;
            cancelTutorConversationReplayAll(this, false);
            this.actions.stopReadAloud();
            postTutorLiveTalkState(this, this.tutorLiveSession !== undefined && !this.tutorLiveFailed);
            // The select used to change the label alone: replies stayed Standard and silent,
            // and only the output channel said so. A running conversation now gets the
            // session it just asked for, carrying the exchange so far.
            if (this.tutorState.conversation.status === 'active' && !this.tutorLiveSession) {
              void reopenLiveTutorSession(this);
            }
          } else {
            const current = this.tutorState.conversation;
            const controller = this.tutorConversationController;
            const pendingOpening = Boolean(
              controller && current.status === 'active' && current.busy &&
              current.pendingAnswer === undefined && current.currentQuestion === '' &&
              current.transcript.length === 0 && !this.tutorLiveSpokenTurn
            );
            if (pendingOpening && controller) {
              controller.abort();
              if (this.tutorConversationController === controller) {
                this.tutorConversationController = undefined;
              }
            } else if (controller) {
              this.tutorLiveDeliberateClosures.add(controller);
            }
            cancelTutorLiveSpokenTurn(this);
            // Closing the whole session, not just the microphone: an open socket kept costing
            // and kept ageing toward its ten-minute limit while the reader believed they had
            // left Live mode. Choosing Live again reopens it above.
            closeTutorLiveSession(this);
            postTutorLiveTalkState(this, false);
            if (pendingOpening && this.tutorLiveOpeningContext) {
              const standardController = new AbortController();
              this.tutorConversationController = standardController;
              startStandardTutorOpening(this,
                tutorConversationOpeningRequest(this.tutorLiveOpeningContext),
                standardController
              );
            }
          }
        } else if (message.command === 'updateTutorConversationSend' &&
            (TUTOR_CONVERSATION_SEND as readonly string[]).includes(input)) {
          this.tutorState = { ...this.tutorState, conversation: {
            ...conversation, send: input as TutorConversationSend
          } };
        } else if (message.command === 'updateTutorConversationRegister' &&
            (input === 'casual' || input === 'neutral' || input === 'professional' || input === 'formal')) {
          this.tutorState = { ...this.tutorState, conversation: {
            ...conversation, register: input, registerChosenByReader: true
          } };
        } else if (message.command === 'updateTutorConversationSituation') {
          const situation = findTutorSituation(input);
          if (situation || input === 'custom' || input === 'auto') this.tutorState = { ...this.tutorState, conversation: {
            ...conversation,
            situationId: input,
            register: conversation.registerChosenByReader
              ? conversation.register
              : situation?.register ?? 'neutral'
          } };
        }
        if (message.command === 'updateTutorConversationFrom' ||
            message.command === 'updateTutorConversationCoaching' ||
            message.command === 'updateTutorConversationSend' ||
            message.command === 'updateTutorConversationReplies' ||
            message.command === 'updateTutorConversationReplyLength' ||
            message.command === 'updateTutorConversationSituationPicture' ||
            message.command === 'updateTutorConversationPictureTransparency' ||
            message.command === 'updateTutorConversationBalloonTransparency' ||
            message.command === 'updateTutorConversationLiveVoice') {
          this.persistTutorPreferences();
        }
        // A Register or Correction change reaches an open Live session at once, as a note that
        // asks for no reply. It used to wait for the next typed turn, which Talk never sends.
        if ((message.command === 'updateTutorConversationRegister' ||
             message.command === 'updateTutorConversationCoaching') &&
            this.tutorLiveSession && this.tutorState.conversation.status === 'active') {
          const note = tutorLiveChoiceNote(this);
          if (note) this.tutorLiveSession.sendNote(note);
        }
        // The four active MODE choices are patched in the live webview. Replacing the
        // document here would destroy the active answer box and can lose dictated text that
        // has not crossed the process boundary yet.
        // Transparency patches picture styling in every conversation state, including Stop.
        if (message.command === 'updateTutorConversationLiveVoice') this.render(false, true);
        else if (conversation.status !== 'active' &&
            message.command !== 'updateTutorConversationPictureTransparency' &&
            message.command !== 'updateTutorConversationBalloonTransparency') this.render();
        ensureTutorConversationPicture(this);
      }
    }
    if (message.command === 'tutorConversationPictureDecoded' ||
        message.command === 'tutorConversationPictureFailed') {
      // 2026-10-02: A replacement document can acknowledge an already-counted picture again.
      if (message.requestId !== undefined && message.input !== undefined &&
          this.tutorConversationPictureAccepted.get(message.requestId) === message.input) return;
      if (this.tutorState.conversation.status !== 'active' ||
          this.tutorConversationPicturePending?.requestId !== message.requestId ||
          this.tutorConversationPicturePending?.image !== message.input) {
        // 2026-10-02: A replacement document may have missed the original cancellation.
        void this.view?.webview.postMessage({
          command: 'tutorConversationPictureCancelled', requestId: message.requestId
        });
      } else {
        const pending = this.tutorConversationPicturePending!;
        this.tutorConversationPicturePending = undefined;
        if (message.command === 'tutorConversationPictureDecoded') {
          this.tutorConversationPictureAccepted.set(pending.requestId, pending.image);
          this.tutorConversationPictures.push(pending.image);
          this.tutorConversationPictureTurns.push(pending.turn ?? -1);
          this.tutorConversationPicture = this.tutorConversationPictures[0];
          this.tutorConversationPictureCount += 1;
          this.tutorConversationPictureFailures = 0;
        } else {
          this.tutorConversationPictureFailures += 1;
          this.actions.log('[conversation situation picture failed] The picture could not be decoded.');
          if (this.tutorConversationPictureFailures >= 2) {
            pauseTutorPictures(this, 'other');
            this.actions.log('[conversation situation picture stopped] Two consecutive failures.');
          }
        }
      }
      void this.view?.webview.postMessage({ command: 'tutorConversationPictureRequestFinished' });
      ensureTutorConversationPicture(this);
    }
    if (message.command === 'requestNextTutorConversationPicture' &&
        this.tutorState.conversation.status === 'active' && this.tutorConversationScene) {
      const turn = Number(message.input);
      if (!this.tutorConversationPictureController && !this.tutorConversationPicturePending &&
          Number.isInteger(turn) && turn === this.tutorConversationPictureEligibleTurn &&
          turn === (this.tutorState.conversation.demoMode ? this.tutorState.conversation.demoLines.length - 1 : this.tutorState.conversation.transcript.length - 1) &&
          turn > this.tutorConversationPictureLastTriggeredTurn) {
        this.tutorConversationPictureContinuationTurn = turn;
      }
      ensureTutorConversationPicture(this);
    }
    if (message.command === 'startTutorConversation') startTutorConversation(this);
    if (message.command === 'startNewTutorConversation') startNewTutorConversation(this);
    if (message.command === 'startTutorConversationDemo') startTutorConversationDemo(this);
    if (message.command === 'diagnoseTutorConversation') {
      stopTutorTakeHomeSpeech(this);
      void diagnoseTutorConversation(this);
    }
    if (message.command === 'reviewTutorConversation') finalizeTutorTakeHome(this);
    if (message.command === 'stopTutorConversation') await stopTutorConversation(this);
    if (message.command === 'retryTutorTakeHome') finalizeTutorTakeHome(this, true);
    if (message.command === 'cancelTutorTakeHome') cancelTutorTakeHome(this, 'cancel');
    if (message.command === 'resumeTutorConversation') resumeTutorConversation(this);
    if (message.command === 'updateTutorConversationAnswer' &&
        message.answer !== undefined) {
      const handyTranscript = this.tutorHandyConversationTranscriptPending;
      this.tutorHandyConversationTranscriptPending = false;
      this.tutorState = {
        ...this.tutorState,
        conversation: {
          ...this.tutorState.conversation,
          draftAnswer: message.answer,
          draftAnswerSpoken: message.spoken === true || handyTranscript
        }
      };
      scheduleTutorConversationHintPrefetch(this);
    }
    if (message.command === 'submitTutorConversationTurn') {
      submitTutorConversationTurn(this);
    }
    if (message.command === 'showPreviousTutorConversationTurn') {
      this.tutorState = moveTutorConversationTurn(this.tutorState, -1);
      this.render();
    }
    if (message.command === 'showNextTutorConversationTurn') {
      this.tutorState = moveTutorConversationTurn(this.tutorState, 1);
      this.render();
    }
    if (message.command === 'walkTutorMissedExercises' && tutorPracticeResults(this.tutorState)?.missed.length) {
      this.tutorState = { ...this.tutorState, practiceMissedOnly: true, practiceReviewAll: false, currentExerciseIndex: 0 };
      this.render();
    }
    if (message.command === 'reviewAllTutorExercises' && tutorPracticeResults(this.tutorState)) {
      this.tutorState = { ...this.tutorState, practiceMissedOnly: false, practiceReviewAll: true, currentExerciseIndex: 0 };
      this.render();
    }
    if (message.command === 'showTutorPracticeResults') {
      if (tutorPracticeResults(this.tutorState)) {
        this.tutorState = {
          ...this.tutorState,
          practiceMissedOnly: false,
          practiceReviewAll: false,
          practiceResultsOpened: true
        };
        this.render();
      }
    }
    if (message.command === 'diagnoseTutorPractice') void diagnoseTutorPractice(this);
    if (message.command === 'cancelTutorPracticeDiagnosis' && this.tutorState.practiceDiagnosisBusy) {
      cancelTutorPracticeDiagnosis(this);
      this.render();
    }
    if (message.command === 'showPreviousTutorExercise') {
      const currentExercise = tutorVisibleExercises(this.tutorState)[this.tutorState.currentExerciseIndex];
      if (currentExercise && !tutorPracticeReviewBusy(this.tutorState)) {
        this.tutorState = moveTutorExercise(this.tutorState, -1);
        this.render();
      }
    }
    if (message.command === 'showPreviousTutorExample' || message.command === 'showNextTutorExample') {
      this.tutorState = moveTutorExample(this.tutorState, message.command === 'showPreviousTutorExample' ? -1 : 1);
      this.render();
    }
    if (message.command === 'showNextTutorExercise') {
      const visibleExercises = tutorVisibleExercises(this.tutorState);
      const lastIndex = Math.max(visibleExercises.length - 1, 0);
      const currentIndex = Math.min(Math.max(this.tutorState.currentExerciseIndex, 0), lastIndex);
      const currentExercise = visibleExercises[currentIndex];
      if (currentExercise && !tutorPracticeReviewBusy(this.tutorState) &&
          (this.tutorState.reviews[currentExercise.id] || this.tutorState.answers[currentExercise.id]?.trim()) &&
          (currentIndex < lastIndex || tutorPracticeResults(this.tutorState))) {
        this.tutorState = tutorPracticeResults(this.tutorState) && currentIndex === lastIndex
          ? {
              ...this.tutorState,
              practiceMissedOnly: false,
              practiceReviewAll: false,
              practiceResultsOpened: true
            }
          : moveTutorExercise(this.tutorState, 1);
        this.render();
      }
    }
    if (message.command === 'updateTutorAnswer' && message.exerciseId &&
        message.answer !== undefined && !this.tutorState.practiceReviewBatch) {
      this.tutorState = {
        ...this.tutorState,
        answers: { ...this.tutorState.answers, [message.exerciseId]: message.answer }
      };
    }
    if (message.command === 'reviewTutorExercise' && message.exerciseId) {
      void reviewTutorExercise(this, message.exerciseId);
    }
    if (message.command === 'reviewUnreviewedTutorExercises') void reviewUnreviewedTutorExercises(this);
    if (message.command === 'cancelTutorReviewBatch') cancelTutorReviewBatch(this);
    if (message.command === 'cancelTutorPracticeHint' && message.exerciseId) {
      cancelTutorPracticeHint(this, message.exerciseId);
    }
    if (message.command === 'cancelTutorReview' && message.exerciseId) {
      cancelTutorReview(this, message.exerciseId);
    }
    if (message.command === 'showTutorAnswers') {
      this.tutorState = { ...this.tutorState, lessonAnswersVisible: true };
      this.render();
    }
    if (message.command === 'openUserDictionaryEntry' && message.entryId) {
      this.userDictionaryState = {
        ...this.userDictionaryState,
        selectedId: message.entryId
      };
      this.render();
    }
    if (message.command === 'readUserDictionaryEntry' && message.entryId) {
      // Reads the headword only, not the definition. A dictionary entry is consulted for
      // how the term sounds, and reading a paragraph of generated prose aloud is a
      // different feature nobody asked for. Uses the same Read Aloud settings and the
      // same failure reporting as every other speech path in KREN.
      const entry = this.userDictionaryState.entries.find((item) => item.id === message.entryId);
      if (entry) {
        void this.actions.readAloudText(entry.term, entry.language)
          .catch((error: unknown) => {
            this.reportActionFailure('Read Aloud', error, 'user dictionary read aloud failed');
          });
      }
    }
    if (message.command === 'editUserDictionaryEntry' && message.entryId) {
      const entry = this.userDictionaryState.entries.find((item) => item.id === message.entryId);
      if (entry) {
        this.userDictionaryState = {
          ...this.userDictionaryState,
          draft: entry,
          capture: normalizeUserDictionaryCaptureResult(entry),
          editingId: entry.id,
          duplicateId: undefined
        };
        this.render();
      }
    }
    if (message.command === 'cancelUserDictionaryDraft') {
      this.userDictionaryState = {
        entries: this.userDictionaryState.entries,
        selectedId: this.userDictionaryState.editingId
      };
      this.render();
    }
    if (message.command === 'saveUserDictionaryDraft' && message.entry !== undefined &&
        this.userDictionaryState.draft) {
      try {
        const approved = applyUserDictionaryDraftEdits(
          this.userDictionaryState.draft,
          message.entry
        );
        const result = await this.actions.saveUserDictionaryEntry(
          approved,
          this.userDictionaryState.editingId
        );
        if (result.kind === 'duplicate') {
          this.userDictionaryState = {
            ...this.userDictionaryState,
            draft: approved,
            duplicateId: result.existing.id,
            entries: result.entries
          };
        } else {
          this.userDictionaryState = {
            entries: result.entries,
            selectedId: result.entry.id
          };
        }
        this.render();
      } catch (error) {
        this.reportActionFailure('Save User Dictionary entry', error, 'user dictionary save failed');
      }
    }
    if (message.command === 'openExistingUserDictionaryEntry' &&
        this.userDictionaryState.duplicateId) {
      this.userDictionaryState = {
        entries: this.userDictionaryState.entries,
        selectedId: this.userDictionaryState.duplicateId
      };
      this.render();
    }
    if (message.command === 'updateExistingUserDictionaryEntry' &&
        this.userDictionaryState.draft && this.userDictionaryState.duplicateId) {
      try {
        const result = await this.actions.saveUserDictionaryEntry(
          this.userDictionaryState.draft,
          this.userDictionaryState.duplicateId
        );
        if (result.kind === 'saved') {
          this.userDictionaryState = {
            entries: result.entries,
            selectedId: result.entry.id
          };
          this.render();
        }
      } catch (error) {
        this.reportActionFailure('Update User Dictionary entry', error, 'user dictionary update failed');
      }
    }
    if (message.command === 'deleteUserDictionaryEntry' && message.entryId) {
      try {
        const entries = await this.actions.deleteUserDictionaryEntry(message.entryId);
        this.userDictionaryState = { entries };
        this.render();
      } catch (error) {
        this.reportActionFailure('Delete User Dictionary entry', error, 'user dictionary delete failed');
      }
    }
    if (message.command === 'updateUserDictionaryList' && message.query) {
      this.userDictionaryState = { ...this.userDictionaryState, query: message.query };
      this.render();
    }
    if (message.command === 'selectUserDictionaryEntries' && message.entryIds) {
      const available = new Set(this.userDictionaryState.entries.map((entry) => entry.id));
      this.userDictionaryState = {
        ...this.userDictionaryState,
        selectedIds: message.entryIds.filter((id) => available.has(id))
      };
      this.render();
    }
    if (message.command === 'deleteSelectedUserDictionaryEntries') {
      try {
        const ids = this.userDictionaryState.selectedIds ?? [];
        if (ids.length === 0) return;
        const entries = await this.actions.deleteUserDictionaryEntries(ids);
        if (entries) this.userDictionaryState = { entries, status: 'ready' };
        this.render();
      } catch (error) {
        this.reportActionFailure('Delete selected User Dictionary entries', error, 'user dictionary multi-delete failed');
      }
    }
    if (message.command === 'exportUserDictionary' && message.format) {
      try {
        const entryIds = message.selectedOnly
          ? this.userDictionaryState.selectedIds ?? []
          : undefined;
        if (message.selectedOnly && entryIds?.length === 0) return;
        await this.actions.exportUserDictionary(message.format, entryIds);
      } catch (error) {
        this.reportActionFailure('Export User Dictionary', error, 'user dictionary export failed');
      }
    }
    if (message.command === 'previewUserDictionaryImport') {
      try {
        const preview = await this.actions.previewUserDictionaryImport();
        if (preview) {
          const entries = await this.actions.loadUserDictionary();
          this.userDictionaryState = {
            entries,
            status: 'ready',
            importPreview: preview
          };
          this.setActiveScreen('userDictionary');
        }
        this.render();
      } catch (error) {
        this.reportActionFailure('Preview User Dictionary import', error, 'user dictionary import preview failed');
      }
    }
    if (message.command === 'cancelUserDictionaryImport') {
      this.userDictionaryState = { ...this.userDictionaryState, importPreview: undefined };
      this.render();
    }
    if (message.command === 'applyUserDictionaryImport' && message.importDecision &&
        this.userDictionaryState.importPreview) {
      try {
        const entries = await this.actions.applyUserDictionaryImport(
          this.userDictionaryState.importPreview,
          message.importDecision
        );
        this.userDictionaryState = { entries, status: 'ready' };
        this.render();
      } catch (error) {
        this.reportActionFailure('Apply User Dictionary import', error, 'user dictionary import failed');
      }
    }
    if (message.command === 'previewUserDictionaryPurge' && message.purgeSelection) {
      try {
        const purgePreview = await this.actions.previewUserDictionaryPurge(message.purgeSelection);
        const entries = await this.actions.loadUserDictionary();
        this.userDictionaryState = { entries, status: 'ready', purgePreview };
        this.setActiveScreen('userDictionary');
        this.render();
      } catch (error) {
        this.reportActionFailure('Preview User Dictionary purge', error, 'user dictionary purge preview failed');
      }
    }
    if (message.command === 'cancelUserDictionaryPurge') {
      this.userDictionaryState = { ...this.userDictionaryState, purgePreview: undefined };
      this.render();
    }
    if (message.command === 'confirmUserDictionaryPurge' && this.userDictionaryState.purgePreview) {
      try {
        const entries = await this.actions.confirmUserDictionaryPurge(
          this.userDictionaryState.purgePreview
        );
        if (entries) this.userDictionaryState = { entries, status: 'ready' };
        this.render();
      } catch (error) {
        this.reportActionFailure('Purge User Dictionary', error, 'user dictionary purge failed');
      }
    }
    if ((message.command === 'regenerateUserDictionaryDraft' ||
        message.command === 'changeUserDictionaryDraftCaptureMode') &&
        (this.userDictionaryState.draft || this.userDictionaryState.capture)) {
      try {
        if (message.entry !== undefined && this.userDictionaryState.draft) {
          this.userDictionaryState.draft = applyUserDictionaryDraftEdits(this.userDictionaryState.draft, message.entry);
        }
        const expression = this.userDictionaryState.draft?.term ??
          this.userDictionaryState.capture?.expression;
        const captureMode = message.command === 'changeUserDictionaryDraftCaptureMode'
          ? message.captureMode
          : this.userDictionaryState.capture?.captureMode ??
            this.userDictionaryState.draft?.capture.mode;
        if (!expression || !captureMode) return;
        const regenerated = await this.actions.regenerateUserDictionaryEntry(
          expression,
          captureMode
        );
        if (!regenerated) {
          this.render();
          return;
        }
        const capture = normalizeUserDictionaryCaptureResult(regenerated);
        this.userDictionaryState = {
          ...this.userDictionaryState,
          draft: capture.draft,
          capture,
          duplicateId: undefined
        };
        this.render();
      } catch (error) {
        // 2026-10-05: preserve the editable draft after a canceled or failed request.
        this.render();
        this.reportActionFailure(
          'Regenerate User Dictionary draft',
          error,
          'user dictionary regenerate failed'
        );
      }
    }
    if (message.command === 'refreshGeminiImageModels') {
      const generation = ++this.imageModelRefresh;
      void this.actions.refreshGeminiImageModels?.().then((models) => {
        if (generation !== this.imageModelRefresh) return;
        this.imageModels = models;
        this.postModelCatalog('geminiImage', models);
      }).catch(() => this.actions.log('[settings background refresh failed] Gemini image models.'));
    }
    if (message.command === 'refreshGeminiModels') {
      this.refreshGeminiModelsInBackground();
    }
    if (message.command === 'refreshGeminiLiveModels') {
      this.refreshGeminiLiveModelsInBackground();
    }
    if (message.command === 'refreshProModels') {
      this.refreshProModelsInBackground();
    }
    if (message.command === 'refreshOpenAIModels') {
      this.refreshOpenAIModelsInBackground();
    }
    if (message.command === 'refreshGroqModels') this.refreshGroqModelsInBackground();
    if (message.command === 'refreshAnthropicModels') {
      this.refreshAnthropicModelsInBackground();
    }
    if (message.command === 'addCustomModel' || message.command === 'removeCustomModel') {
      const provider = message.modelProvider!;
      const model = message.modelId!.trim();
      const current = this.customModels[provider];
      const next = message.command === 'addCustomModel'
        ? current.includes(model) ? current : [model, ...current]
        : current.filter((entry) => entry !== model);
      if (next !== current) {
        this.customModels = { ...this.customModels, [provider]: next };
        await this.actions.updateSetting(CUSTOM_MODEL_SETTING_KEYS[provider], JSON.stringify(next));
      }
      if (message.command === 'addCustomModel' && message.modelKey) {
        if (message.modelKey.startsWith('tutor.')) await updateTutorSetting(this, message.modelKey, model);
        else await this.actions.updateSetting(message.modelKey, model);
      }
      this.render(false, this.activeScreen === 'tutor');
    }
  }

  private handlePriorityMessage(command: PriorityWebviewCommand, message?: unknown): void {
    if (command === 'generatedAudioReady') {
      const ready = this.generatedAudioReadyCallback;
      this.generatedAudioReadyCallback = undefined;
      ready?.();
      return;
    }
    const playbackId = (message as { playbackId?: unknown } | undefined)?.playbackId;
    if (command.startsWith('generatedAudio') && playbackId !== undefined && playbackId !== this.generatedAudioId) return;
    if (command === 'stopReadAloud') this.actions.stopReadAloud();
    if (command === 'pronunciationStarted') this.audioPlaybackResolver?.(true);
    if (command === 'pronunciationFailed') this.audioPlaybackResolver?.(false);
    if (command === 'generatedAudioEnded') this.generatedAudioResolver?.('completed');
    if (command === 'generatedAudioFailed' && this.generatedAudioResolver) {
      const cause = (message as { cause?: unknown } | undefined)?.cause;
      // Only media codes and known exception names may enter the output log.
      this.generatedAudioCause = typeof cause === 'number' && [1, 2, 3, 4].includes(cause)
        ? `media error ${cause}` : typeof cause === 'string' &&
          ['NotAllowedError', 'AbortError', 'NotSupportedError', 'InvalidStateError', 'SecurityError', 'NetworkError', 'EncodingError'].includes(cause)
          ? cause : 'unknown';
      this.actions.log(`[speech] panel playback failed (${this.generatedAudioCause})`);
      this.generatedAudioResolver('failed');
    }
    if (command === 'generatedAudioStarted' && this.generatedAudioResolver) {
      const started = this.generatedAudioStartedCallback;
      this.generatedAudioStartedCallback = undefined;
      this.tutorSpeechPlaybackStarted();
      started?.();
    }
  }

  private refreshReadAloudVoicesInBackground(): void {
    void this.actions.refreshReadAloudVoices()
      .then(() => {
        // The gear's immediate render already carries the one-shot Rewrite Text target.
        // Replacing it from this background completion can reuse that target just as the
        // reader changes a Read Aloud control, and the resulting scroll event then records
        // the Rewrite Text offset as the reader's position. Leave that document in place;
        // the refreshed roster appears on the next ordinary render, whose message clears
        // pendingSettingsFocus before it changes any setting.
        if (this.activeScreen === 'settings' && this.pendingSettingsFocus === undefined) {
          this.render();
        }
      })
      .catch(() => {
        this.actions.log('[settings background refresh failed] Read Aloud voices.');
      });
  }

  private postModelCatalog(catalog: string, models: GeminiModelOption[]): void {
    if (this.activeScreen === 'settings' || this.activeScreen === 'tutor') {
      void this.view?.webview.postMessage({ command: 'modelCatalogReady', catalog, models });
    }
  }

  /**
   * The Refresh beside a Default-profile Model field, which queries the default Gemini key.
   *
   * Both refreshes write the one shared suggestion list, which is what the owner asked for
   * on 2026-08-28: "Model refresh could be a mutual update, but it should not change the
   * model selected for another." Neither writes a stored model, so refreshing from one
   * profile leaves the other profile's chosen model untouched.
   */
  private refreshGeminiModelsInBackground(): void {
    const generation = ++this.proModelRefresh;
    void this.actions.refreshGeminiModels()
      .then((models) => {
        if (generation !== this.proModelRefresh) return;
        this.proModels = models;
        this.postModelCatalog('gemini', models);
      })
      .catch(() => {
        this.actions.log('[settings background refresh failed] Gemini models.');
      });
  }

  /** The Tutor Live picker has its own capability-filtered catalog and default-profile key. */
  private refreshGeminiLiveModelsInBackground(): void {
    const generation = ++this.liveModelRefresh;
    void this.actions.refreshGeminiLiveModels()
      .then((models) => {
        if (generation !== this.liveModelRefresh) return;
        this.liveModels = models;
        this.postModelCatalog('geminiLive', [
          ...KNOWN_TUTOR_LIVE_MODEL_IDS.map(id => ({ id, displayName: id })),
          ...models.filter(model => !KNOWN_TUTOR_LIVE_MODEL_IDS.some(id => id === model.id))
        ]);
      })
      .catch(() => {
        this.actions.log('[settings background refresh failed] Gemini Live models.');
      });
  }

  private refreshProModelsInBackground(): void {
    const generation = ++this.proModelRefresh;
    void this.actions.refreshProModels()
      .then((models) => {
        if (generation !== this.proModelRefresh) return;
        this.proModels = models;
        this.postModelCatalog('gemini', models);
      })
      .catch(() => {
        this.actions.log('[settings background refresh failed] Gemini models.');
      });
  }

  private refreshOpenAIModelsInBackground(): void {
    const generation = ++this.openAIModelRefresh;
    void this.actions.refreshOpenAIModels()
      .then((models) => {
        if (generation !== this.openAIModelRefresh) return;
        this.openAIModels = models;
        this.postModelCatalog('openai', models);
      })
      .catch(() => {
        this.actions.log('[settings background refresh failed] OpenAI models.');
      });
  }

  private refreshGroqModelsInBackground(): void {
    const generation = ++this.groqModelRefresh;
    void this.actions.refreshGroqModels?.()
      .then((models) => {
        if (generation !== this.groqModelRefresh) return;
        this.groqModels = models;
        this.postModelCatalog('groq', models);
      })
      .catch(() => {
        this.actions.log('[settings background refresh failed] Groq models.');
      });
  }

  private refreshAnthropicModelsInBackground(): void {
    const generation = ++this.anthropicModelRefresh;
    void this.actions.refreshAnthropicModels()
      .then((models) => {
        if (generation !== this.anthropicModelRefresh) return;
        this.anthropicModels = models;
        this.postModelCatalog('anthropic', models);
      })
      .catch(() => {
        this.actions.log('[settings background refresh failed] Anthropic models.');
      });
  }

  reportActionFailure(action: string, error: unknown, logKind: string): void {
    const message = safePanelErrorMessage(error);
    this.actions.log(`[${logKind}] ${action}: ${message}`);
    this.actions.notify('error', `KREN: ${message}`);
  }

  private rewriteVariantText(id: RewriteVariantId | undefined): string | undefined {
    if (!id || this.state?.result.kind !== 'rewrite') return undefined;
    return this.state.result.variants.find((variant) => variant.id === id)?.text;
  }
}


function normalizeUserDictionaryCaptureResult(
  value: UserDictionaryCaptureResult | UserDictionaryEntryV1
): UserDictionaryCaptureResult {
  if ('captureMode' in value) return value;
  return {
    expression: value.term,
    captureMode: value.capture.mode,
    draft: value,
    fallbackUsed: false
  };
}

function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
