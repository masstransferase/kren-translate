import { customModelIdentifiers, PANEL_SETTING_KEYS } from './panelSettings.js';
import type { KrenPanelSettingKey } from './panelSettings.js';
import { PANEL_COMMANDS, type KrenPanelCommand } from './panelCommands.js';
import { isRewriteVariantId } from './rewriteVariants.js';
import { isRewriteSettingsGroup, type RewriteSettingsGroup } from './resultViewHtml.js';
import { isGrammarIssueId, PANEL_TEXT_MAX_LENGTH } from './grammarIssueId.js';
import { isPlausibleLanguageCode } from './languages.js';
import { isRewriteModeId, type RewriteModeId } from '@kren/core/rewrite-modes';
import { isTutorMapLevel, type TutorMapLevel } from './tutor/state.js';
import type { TrainingTargetRole } from '@kren/core/tutor';
import type { GrammarChoice, RewriteVariantId } from './types.js';
import { isUserDictionaryCaptureMode, isUserDictionaryExportFormat, isUserDictionaryPurgeSelection, isUserDictionarySourceFilter, type UserDictionaryCaptureMode, type UserDictionaryExportFormat, type UserDictionaryImportDecision, type UserDictionaryListQuery, type UserDictionaryPurgeSelection } from './userDictionary/index.js';

type CustomModelProvider = 'gemini' | 'geminiLive' | 'geminiImage' | 'openai' | 'anthropic' | 'groq' | 'cloudflare';

type ResultsViewCommand =
  | 'copy'
  | 'details'
  | 'replace'
  | 'copyVariant'
  | 'replaceVariant'
  | 'applyGrammar'
  | 'copyGrammar'
  | 'updateGrammarChoice'
  | 'resetGrammarDraft'
  | 'addGrammarWord'
  | 'ignoreGrammarIssue'
  | 'readVariant'
  | 'pinInferredModality'
  | 'stopReadAloud'
  | 'clear'
  | 'updateSetting'
  | 'applyRewriteMode'
  | 'editRewriteGroup'
  | 'editRewriteSettings'
  | 'regenerateResult'
  | 'runCommand'
  | 'showSettings'
  | 'toggleTheme'
  | 'showManual'
  | 'showCredentials'
  | 'openCredentialHelp'
  | 'showStartPage'
  | 'checkForUpdates'
  | 'updateEdgeTts'
  | 'openUpdatesPythonSetting'
  | 'ignoreGrammarResult'
  | 'showTutor'
  | 'showResult'
  | 'showUserDictionary'
  | 'openUserDictionaryEntry'
  | 'readUserDictionaryEntry'
  | 'editUserDictionaryEntry'
  | 'cancelUserDictionaryDraft'
  | 'saveUserDictionaryDraft'
  | 'openExistingUserDictionaryEntry'
  | 'updateExistingUserDictionaryEntry'
  | 'deleteUserDictionaryEntry'
  | 'updateUserDictionaryList'
  | 'selectUserDictionaryEntries'
  | 'deleteSelectedUserDictionaryEntries'
  | 'exportUserDictionary'
  | 'previewUserDictionaryImport'
  | 'cancelUserDictionaryImport'
  | 'applyUserDictionaryImport'
  | 'previewUserDictionaryPurge'
  | 'cancelUserDictionaryPurge'
  | 'confirmUserDictionaryPurge'
  | 'regenerateUserDictionaryDraft'
  | 'changeUserDictionaryDraftCaptureMode'
  | 'refreshGeminiImageModels'
  | 'refreshGeminiModels'
  | 'refreshGeminiLiveModels'
  | 'refreshProModels'
  | 'refreshOpenAIModels'
  | 'refreshGroqModels'
  | 'refreshAnthropicModels'
  | 'addCustomModel'
  | 'removeCustomModel'
  | 'updateTutorMapPath'
  | 'updateTutorTarget'
  | 'clearTutorTargets'
  | 'resetTutorSession'
  | 'resetTutorLesson'
  | 'resetTutorConversationDefaults'
  | 'updateTutorSearch'
  | 'clearTutorSearch'
  | 'findTutorTargets'
  | 'askTutorQuestion'
  | 'cancelTutorAsk'
  | 'openTutorPreparedPrompt'
  | 'openTutorDiagnosticReport'
  | 'closeTutorDiagnosticReport'
  | 'cancelTutorDiagnosticReport'
  | 'cancelTutorPracticeHint'
  | 'applyTutorDiagnosticReport'
  | 'closeTutorPreparedPrompt'
  | 'updateTutorPreparedPrompt'
  | 'generateTutorLesson'
  | 'cancelTutorLesson'
  | 'playTutorExample'
  | 'playTutorExercise'
  | 'dictateTutorExercise'
  | 'dictateTutorConversation'
  | 'hintTutorExercise'
  | 'copyTutorExample'
  | 'regenerateTutorExample'
  | 'cancelTutorExample'
  | 'openTutorTool'
  | 'openTutorPracticeAsk'
  | 'updateTutorToolInput'
  | 'updateTutorToolTargetLanguage'
  | 'submitTutorTool'
  | 'restoreTutorDictionaryContext'
  | 'closeTutorTool'
  | 'generateTutorExercises'
  | 'cancelTutorExercises'
  | 'toggleTutorCoach'
  | 'toggleTutorConversationSpeaker'
  | 'replayTutorQuestion'
  | 'retryTutorTurnCheck'
  | 'hintTutorConversation'
  | 'skipTutorConversationTurn'
  | 'askTutorConversationTurn'
  | 'showTutorConversationRephrase'
  | 'updateTutorConversationFrom'
  | 'updateTutorConversationSituation'
  | 'updateTutorConversationRoleSwapped'
  | 'updateTutorConversationStarts'
  | 'updateTutorConversationRegister'
  | 'updateTutorConversationCoaching'
  | 'updateTutorConversationSend'
  | 'updateTutorConversationReplies'
  | 'updateTutorConversationReplyLength'
  | 'requestNextTutorConversationPicture'
  | 'updateTutorConversationSituationPicture'
  | 'updateTutorConversationPictureTransparency'
  | 'updateTutorConversationBalloonTransparency'
  | 'tutorConversationPictureDecoded'
  | 'tutorConversationPictureFailed'
  | 'updateTutorConversationLiveVoice'
  | 'updateTutorConversationCustom'
  | 'previewTutorEdgeVoice'
  | 'previewTutorGeminiVoice'
  | 'updateTutorEdgeFemaleVoice'
  | 'updateTutorEdgeMaleVoice'
  | 'updateTutorGeminiFemaleVoice'
  | 'updateTutorGeminiMaleVoice'
  | 'startTutorConversation'
  | 'startNewTutorConversation'
  | 'startTutorConversationDemo'
  | 'diagnoseTutorConversation'
  | 'reviewTutorConversation'
  | 'stopTutorConversation'
  | 'retryTutorTakeHome'
  | 'cancelTutorTakeHome'
  | 'resumeTutorConversation'
  | 'updateTutorConversationAnswer'
  | 'submitTutorConversationTurn'
  | 'showPreviousTutorConversationTurn'
  | 'showNextTutorConversationTurn'
  | 'showPreviousTutorExercise'
  | 'showPreviousTutorExample'
  | 'showNextTutorExample'
  | 'showNextTutorExercise'
  | 'updateTutorAnswer'
  | 'reviewTutorExercise'
  | 'walkTutorMissedExercises'
  | 'reviewAllTutorExercises'
  | 'reviewUnreviewedTutorExercises'
  | 'cancelTutorReviewBatch'
  | 'diagnoseTutorPractice'
  | 'showTutorPracticeResults'
  | 'cancelTutorPracticeDiagnosis'
  | 'cancelTutorReview'
  | 'showTutorAnswers'
  | 'pronunciationStarted'
  | 'pronunciationFailed'
  | 'generatedAudioEnded'
  | 'generatedAudioStarted'
  | 'generatedAudioFailed'
  | 'tutorLiveInputBubblePatched'
  | 'tutorHandyTranscriptReceived'
  | 'tutorHandyQuietPeriodStarted'
  | 'tutorHandyQuietPeriodElapsed';

function isCommandMessage(value: unknown): value is {
  command: ResultsViewCommand;
  credentialId?: string;
  variantId?: RewriteVariantId;
  grammarChoices?: GrammarChoice[];
  issueId?: string;
  suggestionIndex?: number;
  draftText?: string;
  key?: KrenPanelSettingKey;
  value?: string | number | boolean;
  action?: string;
  modeId?: RewriteModeId;
  group?: RewriteSettingsGroup | '';
  entryId?: string;
  entry?: unknown;
  captureMode?: UserDictionaryCaptureMode;
  query?: UserDictionaryListQuery;
  entryIds?: string[];
  format?: UserDictionaryExportFormat;
  selectedOnly?: boolean;
  purgeSelection?: UserDictionaryPurgeSelection;
  importDecision?: UserDictionaryImportDecision;
  targetId?: string;
  keyboardFocus?: boolean;
  mapLevel?: TutorMapLevel;
  role?: TrainingTargetRole | 'off';
  exampleId?: string;
  exerciseId?: string;
  tool?: 'dictionary' | 'translate' | 'ask';
  search?: string;
  prompt?: string;
  answer?: string;
  spoken?: boolean;
  input?: string;
  targetLanguage?: string;
  requestId?: number;
  modelProvider?: CustomModelProvider;
  modelId?: string;
  modelKey?: KrenPanelSettingKey;
  /** The text the reader highlighted in a drawer's box, for a Dictionary lookup. */
  selection?: string;
} {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as {
    command?: unknown;
    credentialId?: unknown;
    variantId?: unknown;
    grammarChoices?: unknown;
    issueId?: unknown;
    suggestionIndex?: unknown;
    draftText?: unknown;
    key?: unknown;
    value?: unknown;
    action?: unknown;
    modeId?: unknown;
    group?: unknown;
    entryId?: unknown;
    entry?: unknown;
    captureMode?: unknown;
    query?: unknown;
    entryIds?: unknown;
    format?: unknown;
    selectedOnly?: unknown;
    purgeSelection?: unknown;
    importDecision?: unknown;
    targetId?: unknown;
    keyboardFocus?: unknown;
    mapLevel?: unknown;
    role?: unknown;
    exampleId?: unknown;
    exerciseId?: unknown;
    tool?: unknown;
    search?: unknown;
    prompt?: unknown;
    answer?: unknown;
    spoken?: unknown;
    input?: unknown;
    targetLanguage?: unknown;
    requestId?: unknown;
    modelProvider?: unknown;
    modelId?: unknown;
    modelKey?: unknown;
  };
  const command = candidate.command;
  if (command !== 'copy' && command !== 'details' && command !== 'replace' &&
      command !== 'copyVariant' && command !== 'replaceVariant' &&
      command !== 'applyGrammar' && command !== 'copyGrammar' &&
      command !== 'updateGrammarChoice' && command !== 'resetGrammarDraft' &&
      command !== 'addGrammarWord' && command !== 'ignoreGrammarIssue' &&
      command !== 'readVariant' && command !== 'pinInferredModality' &&
      command !== 'stopReadAloud' && command !== 'clear' &&
      command !== 'updateSetting' && command !== 'applyRewriteMode' &&
      command !== 'editRewriteGroup' && command !== 'editRewriteSettings' &&
      command !== 'regenerateResult' && command !== 'runCommand' &&
      command !== 'showSettings' && command !== 'toggleTheme' && command !== 'showManual' && command !== 'showCredentials' && command !== 'openCredentialHelp' && command !== 'showStartPage' &&
      command !== 'checkForUpdates' && command !== 'updateEdgeTts' && command !== 'openUpdatesPythonSetting' &&
      command !== 'ignoreGrammarResult' &&
      command !== 'showTutor' && command !== 'showResult' &&
      command !== 'showUserDictionary' && command !== 'openUserDictionaryEntry' &&
      command !== 'readUserDictionaryEntry' &&
      command !== 'editUserDictionaryEntry' && command !== 'cancelUserDictionaryDraft' &&
      command !== 'saveUserDictionaryDraft' &&
      command !== 'openExistingUserDictionaryEntry' &&
      command !== 'updateExistingUserDictionaryEntry' &&
      command !== 'deleteUserDictionaryEntry' &&
      command !== 'updateUserDictionaryList' && command !== 'selectUserDictionaryEntries' &&
      command !== 'deleteSelectedUserDictionaryEntries' &&
      command !== 'exportUserDictionary' &&
      command !== 'previewUserDictionaryImport' && command !== 'cancelUserDictionaryImport' &&
      command !== 'applyUserDictionaryImport' &&
      command !== 'previewUserDictionaryPurge' && command !== 'cancelUserDictionaryPurge' &&
      command !== 'confirmUserDictionaryPurge' &&
      command !== 'regenerateUserDictionaryDraft' &&
      command !== 'changeUserDictionaryDraftCaptureMode' &&
      command !== 'refreshGeminiImageModels' && command !== 'refreshGeminiModels' && command !== 'refreshGeminiLiveModels' &&
      command !== 'refreshProModels' &&
      command !== 'refreshOpenAIModels' &&
      command !== 'refreshGroqModels' &&
      command !== 'refreshAnthropicModels' &&
      command !== 'addCustomModel' && command !== 'removeCustomModel' &&
      command !== 'updateTutorMapPath' &&
      command !== 'updateTutorTarget' && command !== 'clearTutorTargets' &&
      command !== 'resetTutorSession' &&
      command !== 'resetTutorLesson' &&
      command !== 'resetTutorConversationDefaults' &&
      command !== 'updateTutorSearch' && command !== 'clearTutorSearch' &&
      command !== 'findTutorTargets' &&
      command !== 'askTutorQuestion' &&
      command !== 'cancelTutorAsk' &&
      command !== 'openTutorPreparedPrompt' &&
      command !== 'openTutorDiagnosticReport' &&
      command !== 'closeTutorDiagnosticReport' &&
      command !== 'cancelTutorDiagnosticReport' &&
      command !== 'cancelTutorPracticeHint' &&
      command !== 'applyTutorDiagnosticReport' &&
      command !== 'closeTutorPreparedPrompt' &&
      command !== 'updateTutorPreparedPrompt' &&
      command !== 'generateTutorLesson' &&
      command !== 'cancelTutorLesson' && command !== 'playTutorExample' &&
      command !== 'playTutorExercise' && command !== 'hintTutorExercise' &&
      command !== 'dictateTutorExercise' && command !== 'dictateTutorConversation' &&
      command !== 'copyTutorExample' && command !== 'regenerateTutorExample' &&
      command !== 'cancelTutorExample' && command !== 'openTutorTool' &&
      command !== 'openTutorPracticeAsk' &&
      command !== 'updateTutorToolInput' &&
      command !== 'updateTutorToolTargetLanguage' && command !== 'submitTutorTool' &&
      command !== 'restoreTutorDictionaryContext' &&
      command !== 'closeTutorTool' && command !== 'generateTutorExercises' &&
      command !== 'cancelTutorExercises' && command !== 'showPreviousTutorExercise' &&
      command !== 'showPreviousTutorExample' && command !== 'showNextTutorExample' &&
      command !== 'startTutorConversation' && command !== 'startNewTutorConversation' &&
      command !== 'startTutorConversationDemo' &&
      command !== 'stopTutorConversation' &&
      command !== 'retryTutorTakeHome' &&
      command !== 'cancelTutorTakeHome' &&
      command !== 'toggleTutorCoach' &&
      command !== 'toggleTutorConversationSpeaker' &&
      command !== 'replayTutorQuestion' &&
      command !== 'retryTutorTurnCheck' &&
      command !== 'hintTutorConversation' &&
      command !== 'skipTutorConversationTurn' &&
      command !== 'askTutorConversationTurn' &&
      command !== 'showTutorConversationRephrase' &&
      command !== 'updateTutorConversationFrom' &&
      command !== 'updateTutorConversationSituation' &&
      command !== 'updateTutorConversationRoleSwapped' &&
      command !== 'updateTutorConversationStarts' &&
      command !== 'updateTutorConversationRegister' &&
      command !== 'updateTutorConversationCoaching' &&
      command !== 'updateTutorConversationSend' &&
      command !== 'updateTutorConversationReplies' &&
      command !== 'updateTutorConversationReplyLength' &&
      command !== 'requestNextTutorConversationPicture' &&
      command !== 'updateTutorConversationSituationPicture' &&
      command !== 'updateTutorConversationPictureTransparency' &&
      command !== 'updateTutorConversationBalloonTransparency' &&
      command !== 'tutorConversationPictureDecoded' &&
      command !== 'tutorConversationPictureFailed' &&
      command !== 'updateTutorConversationLiveVoice' &&
      command !== 'updateTutorConversationCustom' &&
      command !== 'previewTutorEdgeVoice' &&
      command !== 'previewTutorGeminiVoice' &&
      command !== 'updateTutorEdgeFemaleVoice' &&
      command !== 'updateTutorEdgeMaleVoice' &&
      command !== 'updateTutorGeminiFemaleVoice' &&
      command !== 'updateTutorGeminiMaleVoice' &&
      command !== 'diagnoseTutorConversation' &&
      command !== 'reviewTutorConversation' &&
      command !== 'resumeTutorConversation' &&
      command !== 'updateTutorConversationAnswer' &&
      command !== 'submitTutorConversationTurn' &&
      command !== 'showPreviousTutorConversationTurn' &&
      command !== 'showNextTutorConversationTurn' &&
      command !== 'showNextTutorExercise' && command !== 'updateTutorAnswer' &&
      command !== 'reviewTutorExercise' && command !== 'cancelTutorReview' &&
      command !== 'walkTutorMissedExercises' && command !== 'showTutorPracticeResults' &&
      command !== 'reviewAllTutorExercises' && command !== 'diagnoseTutorPractice' &&
      command !== 'reviewUnreviewedTutorExercises' && command !== 'cancelTutorReviewBatch' &&
      command !== 'cancelTutorPracticeDiagnosis' &&
      command !== 'showTutorAnswers' &&
      command !== 'pronunciationStarted' &&
      command !== 'pronunciationFailed' && command !== 'generatedAudioEnded' && command !== 'generatedAudioStarted' &&
      command !== 'generatedAudioFailed' && command !== 'tutorLiveInputBubblePatched' &&
      command !== 'tutorHandyTranscriptReceived' &&
      command !== 'tutorHandyQuietPeriodStarted' &&
      command !== 'tutorHandyQuietPeriodElapsed') return false;
  if (command === 'openCredentialHelp') {
    return typeof candidate.credentialId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/u.test(candidate.credentialId);
  }
  if (candidate.variantId !== undefined && !isRewriteVariantId(candidate.variantId)) return false;
  if (command === 'applyGrammar' || command === 'copyGrammar') {
    // The panel sends the contents of an editable box. It is bounded here for the same
    // reason every other inbound string is: the webview is a separate process and its
    // messages are input, not facts.
    return typeof candidate.draftText === 'string' &&
      candidate.draftText.length <= PANEL_TEXT_MAX_LENGTH;
  }
  if (command === 'updateGrammarChoice') {
    return isGrammarIssueId(candidate.issueId) &&
      typeof candidate.suggestionIndex === 'number' &&
      Number.isInteger(candidate.suggestionIndex) &&
      candidate.suggestionIndex >= -1 && candidate.suggestionIndex <= 100;
  }
  if ((command === 'addGrammarWord' || command === 'ignoreGrammarIssue') &&
      !isGrammarIssueId(candidate.issueId)) return false;
  if (command === 'updateSetting') {
    return isPanelSettingKey(candidate.key) &&
      (typeof candidate.value === 'string' || typeof candidate.value === 'number' ||
        typeof candidate.value === 'boolean');
  }
  if (command === 'addCustomModel' || command === 'removeCustomModel') {
    if (candidate.modelProvider !== 'gemini' && candidate.modelProvider !== 'geminiLive' && candidate.modelProvider !== 'geminiImage' &&
        candidate.modelProvider !== 'openai' &&
        candidate.modelProvider !== 'groq' && candidate.modelProvider !== 'cloudflare' &&
        candidate.modelProvider !== 'anthropic') return false;
    if (typeof candidate.modelId !== 'string' || candidate.modelId.length > 200) return false;
    if (candidate.modelKey !== undefined && (!isPanelSettingKey(candidate.modelKey) ||
        !/\.(?:model|alternateModel|fallbackModel|hintModel|liveModel|imageModel)$/u.test(candidate.modelKey))) return false;
    const model = candidate.modelId.trim();
    return customModelIdentifiers(JSON.stringify([model])).length === 1;
  }
  if (command === 'applyRewriteMode') return isRewriteModeId(candidate.modeId);
  if (command === 'editRewriteGroup') {
    return candidate.group === '' || isRewriteSettingsGroup(candidate.group);
  }
  if (command === 'runCommand') return isPanelCommandName(candidate.action);
  if (command === 'changeUserDictionaryDraftCaptureMode') {
    return isUserDictionaryCaptureMode(candidate.captureMode);
  }
  if (command === 'updateUserDictionaryList') {
    return isUserDictionaryListQuery(candidate.query);
  }
  if (command === 'selectUserDictionaryEntries') {
    return isEntryIdList(candidate.entryIds);
  }
  if (command === 'exportUserDictionary') {
    return isUserDictionaryExportFormat(candidate.format) &&
      typeof candidate.selectedOnly === 'boolean';
  }
  if (command === 'previewUserDictionaryPurge') {
    return isUserDictionaryPurgeSelection(candidate.purgeSelection);
  }
  if (command === 'applyUserDictionaryImport') {
    return isUserDictionaryImportDecision(candidate.importDecision);
  }
  if (command === 'updateTutorTarget') {
    return typeof candidate.targetId === 'string' && candidate.targetId.length <= 300 &&
      (candidate.keyboardFocus === undefined || typeof candidate.keyboardFocus === 'boolean') &&
      (candidate.role === 'off' || candidate.role === 'primary' || candidate.role === 'support');
  }
  if (command === 'updateTutorMapPath') {
    return isTutorMapLevel(candidate.mapLevel) && typeof candidate.targetId === 'string' &&
      candidate.targetId.length <= 300;
  }
  if (command === 'updateTutorSearch' || command === 'findTutorTargets' ||
      command === 'askTutorQuestion') {
    return typeof candidate.search === 'string' && candidate.search.length <= 500;
  }
  if (command === 'updateTutorPreparedPrompt') {
    return typeof candidate.prompt === 'string' &&
      candidate.prompt.length <= PANEL_TEXT_MAX_LENGTH;
  }
  if (command === 'retryTutorTurnCheck') {
    return typeof candidate.input === 'string' && /^\d{1,6}$/u.test(candidate.input);
  }
  if ((command === 'askTutorConversationTurn' || command === 'showTutorConversationRephrase') &&
      candidate.input !== undefined) {
    return typeof candidate.input === 'string' && /^\d{1,6}$/u.test(candidate.input);
  }
  if (command === 'openTutorTool') {
    return isTutorItemId(candidate.exampleId) &&
      (candidate.tool === 'dictionary' || candidate.tool === 'translate' ||
        candidate.tool === 'ask');
  }
  if (command === 'openTutorPracticeAsk') {
    return isTutorItemId(candidate.exerciseId);
  }
  if (command === 'updateTutorToolInput') {
    return typeof candidate.input === 'string' && candidate.input.length <= PANEL_TEXT_MAX_LENGTH;
  }
  if (command === 'updateTutorToolTargetLanguage') {
    return typeof candidate.targetLanguage === 'string' &&
      isPlausibleLanguageCode(candidate.targetLanguage);
  }
  if (command === 'playTutorExample' || command === 'copyTutorExample' ||
      command === 'regenerateTutorExample' || command === 'cancelTutorExample') {
    return isTutorItemId(candidate.exampleId);
  }
  if (command === 'playTutorExercise' || command === 'hintTutorExercise' ||
      command === 'dictateTutorExercise') {
    return isTutorItemId(candidate.exerciseId);
  }
  if (command === 'updateTutorAnswer') {
    return isTutorItemId(candidate.exerciseId) && typeof candidate.answer === 'string' &&
      candidate.answer.length <= PANEL_TEXT_MAX_LENGTH;
  }
  if (command === 'requestNextTutorConversationPicture') {
    return typeof candidate.input === 'string' && /^(?:0|[1-9][0-9]{0,8})$/u.test(candidate.input);
  }
  if (command === 'updateTutorConversationSituationPicture') {
    return typeof candidate.input === 'string' && ['none', 'intro', 'switching', 'graduallyEntering'].includes(candidate.input);
  }
  if (command === 'tutorConversationPictureDecoded' || command === 'tutorConversationPictureFailed') {
    return typeof candidate.requestId === 'number' && Number.isSafeInteger(candidate.requestId) && candidate.requestId > 0 &&
      typeof candidate.input === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(candidate.input);
  }
  if (command === 'updateTutorConversationBalloonTransparency') {
    return typeof candidate.input === 'string' && ['0', '10', '20', '30', '40', '50'].includes(candidate.input);
  }
  if (command === 'updateTutorConversationPictureTransparency') {
    return typeof candidate.input === 'string' && ['0', '20', '40', '60', '80'].includes(candidate.input);
  }
  if (command === 'updateTutorConversationFrom' || command === 'updateTutorConversationSituation' ||
      command === 'updateTutorConversationRoleSwapped' ||
      command === 'updateTutorConversationStarts' ||
      command === 'updateTutorConversationRegister' || command === 'updateTutorConversationCoaching' ||
      command === 'updateTutorConversationSend' ||
      command === 'updateTutorConversationReplyLength' ||
      command === 'updateTutorConversationLiveVoice' ||
      command === 'updateTutorConversationCustom') {
    return typeof candidate.input === 'string' && candidate.input.length <= PANEL_TEXT_MAX_LENGTH;
  }
  if (command === 'updateTutorEdgeFemaleVoice' || command === 'updateTutorEdgeMaleVoice' ||
      command === 'updateTutorGeminiFemaleVoice' || command === 'updateTutorGeminiMaleVoice') {
    return typeof candidate.input === 'string' && candidate.input.length <= 100;
  }
  if (command === 'updateTutorConversationAnswer') {
    return typeof candidate.answer === 'string' &&
      candidate.answer.length <= PANEL_TEXT_MAX_LENGTH &&
      (candidate.spoken === undefined || typeof candidate.spoken === 'boolean');
  }
  if (command === 'reviewTutorExercise' || command === 'cancelTutorReview') {
    return isTutorItemId(candidate.exerciseId);
  }
  if (command === 'openUserDictionaryEntry' || command === 'readUserDictionaryEntry' ||
      command === 'editUserDictionaryEntry' ||
      command === 'deleteUserDictionaryEntry') {
    return typeof candidate.entryId === 'string' && candidate.entryId.length <= 100;
  }
  if (command === 'saveUserDictionaryDraft') return isDictionaryDraftMessage(candidate.entry);
  return true;
}

function isTutorItemId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function isEntryIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 10_000 &&
    value.every((item) => typeof item === 'string' && item.length <= 100);
}

function isUserDictionaryListQuery(value: unknown): value is UserDictionaryListQuery {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const query = value as Record<string, unknown>;
  const textFields = ['search', 'language', 'collection', 'entryType'];
  if (!textFields.every((field) => query[field] === undefined ||
      (typeof query[field] === 'string' && String(query[field]).length <= 500))) return false;
  if (query.captureMode !== undefined && !isUserDictionaryCaptureMode(query.captureMode)) {
    return false;
  }
  return query.source === undefined || isUserDictionarySourceFilter(query.source);
}

function isUserDictionaryImportDecision(value: unknown): value is UserDictionaryImportDecision {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const decision = value as { mode?: unknown; duplicateStrategy?: unknown };
  if (decision.mode === 'cancel' || decision.mode === 'replace') return true;
  return decision.mode === 'merge' &&
    (decision.duplicateStrategy === 'keepExisting' ||
      decision.duplicateStrategy === 'replaceExisting');
}

function isDictionaryDraftMessage(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    return JSON.stringify(value).length <= 200_000;
  } catch {
    return false;
  }
}

function isGrammarChoices(value: unknown): value is GrammarChoice[] {
  return Array.isArray(value) && value.length <= 500 && value.every((choice) => {
    if (typeof choice !== 'object' || choice === null) return false;
    const candidate = choice as { issueId?: unknown; suggestionIndex?: unknown };
    return isGrammarIssueId(candidate.issueId) &&
      typeof candidate.suggestionIndex === 'number' &&
      Number.isInteger(candidate.suggestionIndex) &&
      candidate.suggestionIndex >= -1 && candidate.suggestionIndex <= 100;
  });
}

function isPanelSettingKey(value: unknown): value is KrenPanelSettingKey {
  return typeof value === 'string' && PANEL_SETTING_KEYS.has(value as KrenPanelSettingKey);
}

function isPanelCommand(value: unknown): value is KrenPanelCommand {
  return typeof value === 'string' && PANEL_COMMANDS.has(value as KrenPanelCommand);
}

function isPanelCommandName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 &&
    /^(?:kren|workbench)\.[A-Za-z][A-Za-z0-9.]*$/u.test(value);
}


export { isCommandMessage, isGrammarChoices, isPanelCommand };
export type { CustomModelProvider, ResultsViewCommand };
