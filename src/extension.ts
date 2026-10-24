import { PanelNoticeQueue, showNativePanelNotice } from './panelNotices.js';
import { type CredentialProvider, missingCredentialMessage, missingCredentialError, missingCredentialsOf, showMissingCredentialNotice, runFeatureRequest, CURRENT_REQUEST_POLICIES, recordedRequestOutcome, presentRequestFailure } from './requestCenter.js';
import { EnvironmentChecks, availabilityNames, listEnvironmentGeminiModels } from './environmentCheck.js';
import { postProviderSwitchSettings } from './resultsViewSettings.js';
import { GoogleChirpSpeech, SpeechCenter, type TutorSpeechFallback } from './speech/speechCenter.js';
import { EdgeOnlineSpeechAdapter, LocalWindowsSpeechAdapter } from './speech/windowsSpeechAdapters.js';
import { WindowsNativeAudioPlayer } from './speech/speechCenter.js';
import { tutorSpeechPlaybackBarriers } from './speech/speechAdapter.js';
import { normalizedReadAloudChirpVoice } from './readAloudChirp.js';
import { configureLanguageModelUsage, languageModelUsageToday, LanguageModelUsageRecorder } from './languageModelUsage.js';
import { configureProviderExhaustion, ProviderExhaustionState, DEFAULT_PROVIDER_ORDER, clearProviderExhaustionForCredential, resetProviderExhaustion } from './languageModelSwitching.js';
import { modeEffort } from './tutor/thinkingMode.js';
import { normalizeModelSetting } from './providers/geminiModels.js';
import { listGroqModels, listGroqModelsUnfiltered, GROQ_MODELS, routedModel, type GroqRequestLimits } from './providers/openAICompatible.js';
import { testCloudflareCredentials } from './providers/cloudflare.js';
import { GoogleCloudTranslationProvider } from './providers/googleCloudTranslation.js';
import { MerriamWebsterProvider, type MerriamWebsterReference } from './providers/merriamWebster.js';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import * as vscode from 'vscode';
import { registerKrenChatTools } from './chatTools.js';
import {
  GOOGLE_CLOUD_FREE_TIER_CHARACTERS,
  type CloudTranslationUsageState
} from './cloudTranslationUsage.js';
import { errorMessage, ProviderError } from './errors.js';
import { FileCloudTranslationUsage } from './fileCloudTranslationUsage.js';
import { HoverStore } from './hoverStore.js';
import { TUTOR_DEFAULTS } from './tutor/defaults.js';
import { effectivePictureSettings } from './tutor/pictureSettings.js';
import { generateCloudflareSituationPicture, generateSituationPicture } from './providers/situationPicture.js';
import {
  isPlausibleLanguageCode,
  KREN_LANGUAGES,
  languageName
} from './languages.js';
import {
  canStoreMerriamWebsterKey,
  isMerriamWebsterSecretKey,
  KREN_SECRET_KEYS,
  MERRIAM_WEBSTER_KEY_LIMIT_MESSAGE,
  featureModel,
  runKrenOperation,
  runTutorAudioTranscription,
  runTutorStructuredRequest,
  runTutorTranslation,
  runUserDictionaryCapture,
  storeMerriamWebsterKey,
  REPLAY_SUBJECTS,
  type KrenOperation,
  type KrenRuntime
} from './operations.js';
import {
  geminiRefreshTarget,
  type GeminiRefreshProfile
} from './geminiProfileRefresh.js';
import {
  DEFAULT_TRANSLATION_TARGET,
  EXPLANATION_SAME_AS_SOURCE,
  TRANSLATION_AUTO_SOURCE
} from './types.js';
import { krenConfigurationKeys, krenResetPlan } from './resetKren.js';
import { resultDetails, resultText } from './render.js';
import {
  describeClipboardDecision,
  rewriteClipboardText,
  shouldCopyRewriteToClipboard
} from './rewriteClipboard.js';
import {
  mergeSmartGrammarIssues,
  smartGrammarIssues,
  type SmartGrammarOutcome
} from './smartGrammar.js';
import { explicitTextSubmission } from './submission.js';
import {
  KrenResultsViewProvider,
  type KrenResultsViewPanel,
  type KrenPanelCommand,
  type KrenPanelSettingKey,
  type TutorVoiceDefaultSettingKey
} from './resultsView.js';
import type { KrenPanelSettings } from './resultViewHtml.js';
import { globalRoutingPlan, globalRoutingSettings } from './panelSettings.js';
import { postLanguageModelUsage, postTutorHintPrefetchSetting, postTutorPictureStyleSetting, reconcileTutorPictureProviderChange } from './resultsViewSettings.js';
import {
  ALL_REWRITE_VARIANTS_ID,
  isRewriteVariantId,
  migrateRetiredRewriteVariantSettings,
  REWRITE_VARIANT_LIST,
  type QuickMenuRewriteVariantId
} from './rewriteVariants.js';
import {
  isRewriteAxisSetting,
  isRewriteOtherLanguage,
  migrateLegacyRewriteSettings,
  REWRITE_AXIS_DEFAULTS,
  REWRITE_DOMAINS,
  type RewriteConfigurationTarget
} from '@kren/core/rewrite-axes';
import { KoreanDictionaryProvider } from './providers/koreanDictionary.js';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_PRO_MODELS,
  geminiModelCatalog,
  listGeminiImageModels,
  listGeminiLiveModels,
  listGeminiProModels,
  type GeminiModelCatalogProtections,
  type GeminiModelOption
} from './providers/geminiModels.js';
import { listOpenAIModels, listOpenAIModelsUnfiltered } from './providers/openai.js';
import { listAnthropicModels, listAnthropicModelsUnfiltered } from './providers/anthropic.js';
import type {
  DictionaryRequest,
  GrammarChoice,
  KrenResult,
  TranslationProviderId
} from './types.js';
import {
  listWindowsSpeechVoices,
  prepareTextForSpeech,
  WindowsReadAloudPlayer
} from './windowsReadAloud.js';
import { WindowsEdgeReadAloudPlayer } from './speech/speechCenter.js';
import {
  addHarperWord,
  applyGrammarChoices,
  clearHarperIgnoredLints,
  clearHarperWords,
  configureHarperGrammar,
  disposeHarperGrammar,
  ignoreHarperLint,
  normalizeCustomWord
} from './providers/harperGrammar.js';
import { GrammarCodeActions, type GrammarDiagnosticState } from './grammarCodeActions.js';
import {
  customModelIdentifiers,
  KNOWN_TUTOR_LIVE_MODEL_IDS,
  migratedTutorLiveCustomModels,
  READ_ALOUD_PROVIDER_DEFAULT,
  READ_ALOUD_EDGE_VOICE_DEFAULT,
  RESULTS_OPEN_AT_STARTUP_DEFAULT,
  TUTOR_LIVE_MODEL_DEFAULT,
  validatedPanelSetting
} from './panelSettings.js';
import { languageModelCredentialSlot, TRANSLATION_ROUTING_DEFAULTS } from './languageModelRouting.js';
import {
  EDGE_SPEECH_AUTO_LOCALE,
  resolveEdgeSpeechVoice
} from '@kren/core/edge-speech';
import type { GrammarIssue } from '@kren/core/contracts';
import { TUTOR_ROUTING_DEFAULTS } from './tutor/state.js';
import {
  sentenceAroundSelection,
  USER_DICTIONARY_MAX_IMPORT_ENTRIES
} from './userDictionary/providerContract.js';
import {
  normalizeUserDictionaryTerm,
  exportUserDictionaryJson,
  exportUserDictionaryMarkdown,
  requiresRemoveAllConfirmation,
  UserDictionaryService,
  UserDictionaryStorage,
  type UserDictionaryCaptureMode,
  type UserDictionaryCaptureResult,
  type UserDictionaryEntryV1,
  type UserDictionaryExportFormat,
  type UserDictionaryImportDecision,
  type UserDictionaryImportPreview,
  type UserDictionaryPurgePreview,
  type UserDictionaryPurgeSelection,
  type UserDictionaryProviderCaptureMode
} from './userDictionary/index.js';

const GEMINI_KEY = KREN_SECRET_KEYS.gemini;
const GEMINI_PRO_KEY = KREN_SECRET_KEYS.geminiPro;
const GROQ_KEY = KREN_SECRET_KEYS.groq;
const OPENAI_KEY = KREN_SECRET_KEYS.openai;
const ANTHROPIC_KEY = KREN_SECRET_KEYS.anthropic;
const GOOGLE_CLOUD_TEXT_TO_SPEECH_KEY = KREN_SECRET_KEYS.googleCloudTextToSpeech;
const GOOGLE_CLOUD_TRANSLATION_KEY = KREN_SECRET_KEYS.googleCloudTranslation;
const DICTIONARY_KEY = KREN_SECRET_KEYS.koreanDictionary;
const MW_COLLEGIATE_KEY = KREN_SECRET_KEYS.merriamWebsterCollegiate;
const MW_MEDICAL_KEY = KREN_SECRET_KEYS.merriamWebsterMedical;
const MW_THESAURUS_KEY = KREN_SECRET_KEYS.merriamWebsterThesaurus;
const GEMINI_CONSENT = 'kren.gemini.termsConsent.v4';
const OPENAI_CONSENT = 'kren.openai.paidConsent.v2';
const ANTHROPIC_CONSENT = 'kren.anthropic.paidConsent.v2';
const CLOUD_DEFAULT_MIGRATION = 'kren.migration.cloudTranslationDefault.v1';
const GEMINI_FALLBACK_MODEL_MIGRATION = 'kren.migration.geminiFallbackModel.v1';
const KOREAN_TRANSLATION_TARGET_MIGRATION = 'kren.migration.koreanTranslationTarget.v1';
const BILINGUAL_EXPLANATION_MIGRATION = 'kren.migration.bilingualExplanation.v1';
const LEGACY_CLOUD_USAGE_KEY = 'kren.googleCloudTranslation.usage.v1';
const EDGE_TTS_CONSENT = 'kren.edgeTts.onlineConsent.v1';
/**
 * The reader's AI English Tutor conversation choices. Held here rather than in VS Code
 * settings because they are panel controls rather than configuration, and the panel validates
 * every value on the way back in, so a stale entry selects the current default instead.
 */
const TUTOR_CONVERSATION_PREFERENCES = 'kren.tutor.conversationPreferences.v1';
const GRAMMAR_CUSTOM_WORDS = 'kren.grammar.customWords.v1';
const GRAMMAR_IGNORED_LINTS = 'kren.grammar.ignoredLints.v1';

interface LastResult {
  uri?: string;
  range?: vscode.Range;
  selectedText: string;
  result: KrenResult;
}

let lastResult: LastResult | undefined;
let outputChannel: vscode.OutputChannel;
let resultRequestGeneration = 0;
let cloudTranslationUsage: FileCloudTranslationUsage;
let resultsView: KrenResultsViewPanel;
let readAloudPlayer: WindowsReadAloudPlayer;
let edgeReadAloudPlayer: WindowsEdgeReadAloudPlayer;
let chirpSpeech: GoogleChirpSpeech;
let nativeAudioPlayer: WindowsNativeAudioPlayer;
let readAloudChirpSpeech: GoogleChirpSpeech;
let grammarCodeActions: GrammarCodeActions;
let readAloudVoices: string[] = [];
let readAloudVoicesPromise: Promise<void> | undefined;
let extensionVersion = '0.0.0';
let speechCenter: SpeechCenter;
let automaticGrammarTimer: NodeJS.Timeout | undefined;
let activeExtensionContext: vscode.ExtensionContext;
let storedSecretKeys = new Set<string>();
let userDictionaryService: UserDictionaryService;
let userDictionaryStoragePath = '';

type NotificationKind = 'information' | 'warning' | 'error';

// Before the results view is available, the same queue policy chooses a native modal.
const unavailablePanelNotices = new PanelNoticeQueue(() => false, () => undefined,
  (kind, message, options, choices) => showNativePanelNotice(vscode.window, kind, message, options, choices));

function showKrenInformationMessage(message: string, optionsOrChoice?: vscode.MessageOptions | string, ...choices: string[]): Thenable<string | undefined> {
  return resultsView?.showInformationMessage
    ? resultsView.showInformationMessage(message, optionsOrChoice, ...choices)
    : unavailablePanelNotices.show('information', message, optionsOrChoice, ...choices);
}

function withKrenProgress<T>(options: { title: string; cancellable?: boolean }, task: (token?: vscode.CancellationToken) => Thenable<T>): Thenable<T> {
  if (resultsView?.panelVisible) {
    if (!options.cancellable) return resultsView.withPanelProgress(options.title, () => task());
    const cancellation = new vscode.CancellationTokenSource();
    return resultsView.withPanelProgress(options.title, () => task(cancellation.token), () => cancellation.cancel())
      .finally(() => cancellation.dispose());
  }
  return vscode.window.withProgress({ ...options, location: vscode.ProgressLocation.Window }, (_progress, token) => task(token));
}

function krenSpeechProgress(provider: string): { dispose(): void } {
  const title = provider === 'edgeOnline'
    ? 'KREN: Generating and reading Edge voice...'
    : 'KREN: Reading aloud...';
  if (!resultsView?.panelVisible) return vscode.window.setStatusBarMessage(title);
  return { dispose() {} };
}

function showKrenWarningMessage(message: string, optionsOrChoice?: vscode.MessageOptions | string, ...choices: string[]): Thenable<string | undefined> {
  if (resultsView?.showWarningMessage) return resultsView.showWarningMessage(message, optionsOrChoice, ...choices);
  return unavailablePanelNotices.show('warning', message, optionsOrChoice, ...choices);
}
function showKrenErrorMessage(message: string, optionsOrChoice?: vscode.MessageOptions | string, ...choices: string[]): Thenable<string | undefined> {
  if (resultsView?.showErrorMessage) return resultsView.showErrorMessage(message, optionsOrChoice, ...choices);
  return unavailablePanelNotices.show('error', message, optionsOrChoice, ...choices);
}

export function notify(kind: NotificationKind, message: string): void {
  const notification = kind === 'information'
    ? showKrenInformationMessage(message)
    : kind === 'warning'
      ? showKrenWarningMessage(message)
      : showKrenErrorMessage(message);
  void Promise.resolve(notification).catch(() => undefined);
}

// The extension identity is publisher-dependent: "local.kren-translate" when sideloaded,
// "masstransferase.kren-translate" once published. Hard-coding it
// means the settings filter below silently matches nothing in whichever channel was not
// the one it was written for, and a settings page that opens empty looks like a bug in
// VS Code rather than in KREN. Read it from the running extension instead.
let extensionId = 'local.kren-translate';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extensionId = context.extension.id;
  // kren.results.openAtStartup is the one record of whether KREN's Secondary Sidebar is
  // shown. reveal() turns it on and hide() turns it off, so this line restores whichever
  // the owner last chose rather than always starting hidden.
  //
  // What this line does NOT do, stated because an earlier version of this comment claimed
  // it did and the claim was wrong: it has no effect on whether KREN's tab stays in the
  // Secondary Sidebar when another tab is selected. That is the workbench's own per-tab
  // pin, stored under workbench.auxiliarybar.pinnedPanels and changed only by the tab
  // context menu, whose entry reads Keep when unpinned and Hide when pinned. A view's
  // when clause can empty a container, and emptying a container never touches its pin.
  // Verified against the installed workbench bundle on 2026-08-22: the context menu
  // action toggles between compositeBar.pin and compositeBar.unpin, and nothing an
  // extension contributes reaches it.
  //
  // This does not build the webview either. VS Code calls resolveWebviewView only when
  // the view first becomes visible, so nothing behind the tab runs until it is opened.
  await vscode.commands.executeCommand(
    'setContext',
    KrenResultsViewProvider.enabledContext,
    vscode.workspace.getConfiguration('kren').get<boolean>('results.openAtStartup', RESULTS_OPEN_AT_STARTUP_DEFAULT)
  );
  activeExtensionContext = context;
  extensionVersion = String(context.extension.packageJSON.version ?? '0.0.0');
  await refreshStoredSecretKeys(context);
  outputChannel = vscode.window.createOutputChannel('KREN Translate');
  cloudTranslationUsage = new FileCloudTranslationUsage(
    path.join(context.globalStorageUri.fsPath, 'cloud-translation-usage.json')
  );
  const userDictionaryStorage = new UserDictionaryStorage(
    path.join(context.globalStorageUri.fsPath, 'user-dictionary')
  );
  userDictionaryStoragePath = userDictionaryStorage.filePath;
  userDictionaryService = new UserDictionaryService(userDictionaryStorage);
  try {
    await cloudTranslationUsage.initialize(
      context.globalState.get<CloudTranslationUsageState>(LEGACY_CLOUD_USAGE_KEY)
    );
  } catch (error) {
    notify('warning', errorMessage(error));
  }
  const hoverStore = new HoverStore(vscode.Uri.joinPath(context.extensionUri, 'media'));
  readAloudPlayer = new WindowsReadAloudPlayer();
  edgeReadAloudPlayer = new WindowsEdgeReadAloudPlayer();
  nativeAudioPlayer = new WindowsNativeAudioPlayer(new WindowsEdgeReadAloudPlayer(), {
    log: line => outputChannel.appendLine(line)
  });
  chirpSpeech = new GoogleChirpSpeech(slot => context.secrets.get(slot), {
    beginSession: () => nativeAudioPlayer.beginSession(),
    play: (audio, volume, onStarted) => nativeAudioPlayer.play(audio, volume, onStarted),
    stop: () => nativeAudioPlayer.stop(),
    failureCause: () => nativeAudioPlayer.failureCause()
  }, (message, missing) => { if (missing) void showMissingCredentialNotice(missing, resultsView, message.slice(missingCredentialMessage(missing).length).trim(), true); else notify('warning', message); }, fetch, line => outputChannel.appendLine(line));
  readAloudChirpSpeech = new GoogleChirpSpeech(slot => context.secrets.get(slot), {
    beginSession: () => nativeAudioPlayer.beginSession(),
    play: (audio, volume, onStarted) => nativeAudioPlayer.play(audio, volume, onStarted),
    stop: () => nativeAudioPlayer.stop(),
    failureCause: () => nativeAudioPlayer.failureCause()
  }, (message, missing) => { if (missing) void showMissingCredentialNotice(missing, resultsView, message.slice(missingCredentialMessage(missing).length).trim(), true); else notify('warning', message); }, fetch, line => outputChannel.appendLine(line));
  speechCenter = new SpeechCenter(chirpSpeech, readAloudChirpSpeech,
    new EdgeOnlineSpeechAdapter(edgeReadAloudPlayer), new LocalWindowsSpeechAdapter(readAloudPlayer), {
      configuration: () => vscode.workspace.getConfiguration('kren'),
      trusted: () => vscode.workspace.isTrusted,
      consent: () => ensureEdgeTtsConsent(context),
      active: value => vscode.commands.executeCommand('setContext', 'kren.readAloudActive', value),
      status: provider => krenSpeechProgress(provider),
      hold: () => resultsView.holdTutorSpeech(),
      started: () => resultsView.tutorSpeechPlaybackStarted(),
      liveSpeaking: () => resultsView.tutorLiveSpeaking(),
      conversation: () => resultsView.tutorSpeechConversationIdentity(),
      speakerVoice: () => resultsView.tutorSpeechVoice(),
      playback: () => resultsView.edgeAudioPlayback(),
      notify, showKrenErrorMessage, copyText: text => vscode.env.clipboard.writeText(text),
      log: line => outputChannel.appendLine(line)
    });

  grammarCodeActions = new GrammarCodeActions();
  configureHarperGrammar({
    customWords: context.globalState.get<string[]>(GRAMMAR_CUSTOM_WORDS, []),
    ignoredLints: context.globalState.get<string>(GRAMMAR_IGNORED_LINTS, '')
  });
  await migrateTranslationProviderToCloud(context);
  await migrateDeprecatedGeminiFallback(context);
  await migrateAutoTranslationTargetToKorean(context);
  await migrateBilingualExplanation(context);
  await migrateTutorLiveGeminiProfile();
  await migrateTutorLiveCustomModels();
  await migrateTutorFastSettings();
  await migrateRewriteAxes();
  registerKrenChatTools(context, extensionRuntime(context));
  const panelReadAloudText = (text: string, language?: string, settingsSource: 'shared' | 'tutor' = 'shared', edgeVoice?: string) =>
    speechCenter.speak(text, language, settingsSource, edgeVoice,
      tutorSpeechPlaybackBarriers.get(panelReadAloudText)).then(() => {});
  resultsView = new KrenResultsViewProvider({
    notify,
    invalidateResultRequests: () => { resultRequestGeneration += 1; },
    copy: copyLastResult,
    details: showDetails,
    replace: replaceLastResult,
    copyText: copyTextResult,
    replaceText: replaceLastResultWith,
    applyGrammarChoices: (choices, replace) => applySelectedGrammarChoices(choices, replace),
    manageGrammarIssue: (issueId, action) => managePanelGrammarIssue(context, issueId, action),
    readAloudText: panelReadAloudText,
    stopReadAloud: () => { stopReadAloud(false); },
    clear: () => {
      lastResult = undefined;
      hoverStore.clear();
      grammarCodeActions.clear();
      resultsView.clear();
    },
    loadUserDictionary: () => userDictionaryService.list(),
    saveUserDictionaryEntry: (entry, replaceId) =>
      userDictionaryService.save(entry, replaceId),
    deleteUserDictionaryEntry: (id) => deleteUserDictionaryEntry(id),
    deleteUserDictionaryEntries: (ids) => deleteUserDictionaryEntries(ids),
    previewUserDictionaryPurge: (selection) => userDictionaryService.previewPurge(selection),
    confirmUserDictionaryPurge: (preview) => confirmUserDictionaryPurge(preview),
    previewUserDictionaryImport: () => previewUserDictionaryImport(),
    applyUserDictionaryImport: (preview, decision) =>
      userDictionaryService.applyImport(preview, decision),
    exportUserDictionary: (format, entryIds) =>
      exportUserDictionary(format, entryIds),
    regenerateUserDictionaryEntry: (expression, captureMode) =>
      regenerateUserDictionaryDraft(context, expression, captureMode),
    readSelectedEditorPassage,
    generateTutor: (request, route, signal) =>
      runTutorStructuredRequest(extensionRuntime(context), route, request, signal),
    generateSituationPicture: async (scene, signal, reference) => {
      const runtime = extensionRuntime(context);
      const settings = readPanelSettings();
      const style = settings.tutorConversationPictureStyle ?? TUTOR_DEFAULTS.configuration['tutor.conversation.pictureStyle'];
      if (settings.tutorPictureProvider === 'cloudflare') {
        const accountId = await runtime.getSecret(KREN_SECRET_KEYS.cloudflareAccountId);
        const token = await runtime.getSecret(KREN_SECRET_KEYS.cloudflareApiToken);
        const model = settings.tutorCloudflareImageModel;
        return generateCloudflareSituationPicture(scene, accountId ?? '', token ?? '', signal, reference, model, style);
      }
      const key = await runtime.getSecret(KREN_SECRET_KEYS.geminiPro);
      if (!key) throw missingCredentialError('gemini', 'pro');
      await runtime.beforeGeminiRequest('pro');
      return generateSituationPicture(scene, key, signal, reference, vscode.workspace.getConfiguration('kren').get('tutor.imageModel', TUTOR_DEFAULTS.configuration['tutor.imageModel']), style);
    },
    transcribeTutorAudio: (audio, signal, provider) =>
      runTutorAudioTranscription(extensionRuntime(context), audio, signal, undefined, provider),
    runTutorTool: (operation, text, signal, targetLanguage, retry) => {
      const settings = readPanelSettings();
      return operation === 'translate'
        ? runTutorTranslation(extensionRuntime(context), { provider: settings.tutorProvider,
          model: settings.tutorProvider === 'gemini' && settings.tutorProfile === 'pro' ? settings.tutorAlternateModel : settings.tutorModel,
          fastModel: settings.tutorHintModel, fastThinkingOrEffort: settings.tutorHintThinkingOrEffort,
          thinkingOrEffort: settings.tutorThinkingOrEffort, geminiProfile: settings.tutorProfile,
          fallbackEnabled: false, fallbackModel: '', fallbackThinkingOrEffort: 'auto' }, text, signal, targetLanguage, retry)
        : runKrenOperation(extensionRuntime(context), operation, { text, targetLanguage }, signal);
    },
    updateSetting: updatePanelSetting,
    updateTutorVoiceSetting,
    runCommand: runPanelCommand,
    rerunOperation: (operation, sourceText) =>
      rerunOperation(context, hoverStore, operation, sourceText),
    log: (message) => outputChannel.appendLine(message),
    readTutorPreferences: () => context.globalState.get<unknown>(TUTOR_CONVERSATION_PREFERENCES),
    writeTutorPreferences: (preferences) => {
      void context.globalState.update(TUTOR_CONVERSATION_PREFERENCES, preferences);
    },
    settings: readPanelSettings,
    refreshGeminiImageModels: () => refreshGeminiImageModels(context),
    refreshGeminiModels: () => refreshGeminiProfileModels(context, 'default'),
    refreshGeminiLiveModels: () => refreshGeminiLiveProfileModels(context),
    refreshProModels: () => refreshGeminiProfileModels(context, 'alternate'),
    refreshGroqModels: () => refreshGroqModels(context),
    refreshOpenAIModels: () => refreshOpenAIModels(context),
    refreshAnthropicModels: () => refreshAnthropicModels(context),
    refreshReadAloudVoices
  }, context.extensionUri);
  resultsView.environmentChecks = new EnvironmentChecks({
    pythonCommand: () => vscode.workspace.getConfiguration('kren').get<string>('readAloud.edgePythonCommand', 'python'),
    trusted: () => vscode.workspace.isTrusted,
    vscodeVersion: vscode.version,
    vscodeMinimum: context.extension.packageJSON.engines.vscode,
    detectHandy: () => resultsView.handy.detect(),
    dailyEnabled: () => vscode.workspace.getConfiguration('kren').get<boolean>('updates.dailyCheck', true),
    store: context.globalState,
    manual: {
      getKey: provider => provider === 'googleChirp'
        ? context.secrets.get(KREN_SECRET_KEYS.googleCloudTextToSpeech).then(key => key || context.secrets.get(KREN_SECRET_KEYS.googleCloudTranslation))
        : context.secrets.get(KREN_SECRET_KEYS[provider === 'cloudflare' ? 'cloudflareApiToken' : provider]),
      models: () => updateAvailabilityNames().models,
      edgeVoices: () => updateAvailabilityNames().edgeVoices,
      chirpVoices: () => updateAvailabilityNames().chirpVoices,
      listers: { gemini: listEnvironmentGeminiModels, geminiPro: listEnvironmentGeminiModels,
        openai: listOpenAIModelsUnfiltered, anthropic: listAnthropicModelsUnfiltered, groq: listGroqModelsUnfiltered }
    },
    changed: () => resultsView.environmentChecksChanged(),
    confirm: async command => {
      const choice = await showKrenWarningMessage(`Run ${command}?`, { modal: true }, 'Update');
      return choice === 'Update';
    },
    progress: async task => withKrenProgress({
      title: 'Updating edge-tts. Please wait.' }, task),
    report: message => notify('warning', message),
    log: line => outputChannel.appendLine(line)
  });
  function updateAvailabilityNames() {
    const config = vscode.workspace.getConfiguration('kren');
    const properties = context.extension.packageJSON.contributes.configuration.properties;
    return availabilityNames((key, fallback) => config.get<string>(key, properties[`kren.${key}`]?.default ?? fallback),
      (key, fallback) => properties[`kren.${key}`]?.default ?? fallback);
  }
  // Defer the silent daily check so activation and panel registration never wait for it.
  const environmentTimer = setTimeout(() => {
    void resultsView.environmentChecks?.daily().catch(() => undefined);
  }, 0);
  context.subscriptions.push({ dispose: () => clearTimeout(environmentTimer) });
  configureLanguageModelUsage(new LanguageModelUsageRecorder(context.globalState,
    line => outputChannel.appendLine(line), () => {
      postLanguageModelUsage(resultsView);
    }));
  configureProviderExhaustion(new ProviderExhaustionState(context.globalState, undefined, () => postLanguageModelUsage(resultsView)));
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.text = '$(book) KREN';
  statusItem.tooltip = 'KREN actions, clipboard tools, and Secondary Sidebar';
  statusItem.command = 'kren.useClipboard';
  statusItem.show();

  let previousPictureProvider = readPanelSettings().tutorPictureProvider;
  context.subscriptions.push(
    outputChannel,
    statusItem,
    resultsView,
    readAloudPlayer,
    edgeReadAloudPlayer,
    chirpSpeech,
    nativeAudioPlayer,
    readAloudChirpSpeech,
    speechCenter,
    grammarCodeActions,
    vscode.languages.registerCodeActionsProvider(
      { scheme: '*' },
      grammarCodeActions,
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    ),
    vscode.window.registerWebviewViewProvider(
      KrenResultsViewProvider.viewId,
      resultsView,
      { webviewOptions: { retainContextWhenHidden: true } }
    ),
    vscode.languages.registerHoverProvider({ scheme: '*' }, hoverStore),
    vscode.commands.registerCommand('kren.translateSelection', () =>
      executeLookup(context, hoverStore, 'translate')
    ),
    vscode.commands.registerCommand('kren.explainSelection', () =>
      executeLookup(context, hoverStore, 'explain')
    ),
    vscode.commands.registerCommand('kren.dictionarySearchSelection', () =>
      executeLookup(context, hoverStore, 'englishDictionary')
    ),
    vscode.commands.registerCommand('kren.koreanDictionarySearchSelection', () =>
      executeLookup(context, hoverStore, 'koreanDictionary')
    ),
    vscode.commands.registerCommand('kren.lookupMedicalSelection', () =>
      executeLookup(context, hoverStore, 'medical')
    ),
    vscode.commands.registerCommand('kren.synonymsSearchSelection', () =>
      executeLookup(context, hoverStore, 'synonyms')
    ),
    vscode.commands.registerCommand('kren.grammarCheckSelection', () =>
      executeGrammarCheck(context)
    ),
    vscode.commands.registerCommand(
      'kren.applyGrammarSuggestion',
      (uri: unknown, generation: unknown, issueId: unknown, suggestionIndex: unknown) =>
        applyGrammarQuickFix(context, uri, generation, issueId, suggestionIndex)
    ),
    vscode.commands.registerCommand(
      'kren.showGrammarDetails',
      (uri: unknown, generation: unknown) => showGrammarDetails(uri, generation)
    ),
    vscode.commands.registerCommand(
      'kren.addGrammarWord',
      (uri: unknown, generation: unknown, issueId: unknown) =>
        manageGrammarFinding(context, uri, generation, issueId, 'addWord')
    ),
    vscode.commands.registerCommand(
      'kren.ignoreGrammarFinding',
      (uri: unknown, generation: unknown, issueId: unknown) =>
        manageGrammarFinding(context, uri, generation, issueId, 'ignore')
    ),
    vscode.commands.registerCommand('kren.clearGrammarFindings', () => {
      grammarCodeActions.clear();
      notify('information', 'KREN grammar findings cleared.');
    }),
    vscode.commands.registerCommand('kren.clearGrammarCustomDictionary', () =>
      clearGrammarCustomDictionary(context)
    ),
    vscode.commands.registerCommand('kren.clearIgnoredGrammarFindings', () =>
      clearIgnoredGrammarFindings(context)
    ),
    vscode.commands.registerCommand('kren.rewriteEnglishSelection', () =>
      executeLookup(context, hoverStore, 'rewrite')
    ),
    vscode.commands.registerCommand('kren.rewriteMinimalSelection', () =>
      executeLookup(context, hoverStore, 'rewriteMinimal')
    ),
    vscode.commands.registerCommand('kren.rewriteFullSelection', () =>
      executeLookup(context, hoverStore, 'rewriteFull')
    ),
    vscode.commands.registerCommand('kren.readAloudSelection', () =>
      executeReadAloudSelection(context)
    ),
    vscode.commands.registerCommand('kren.stopReadAloud', () => {
      stopReadAloud(true);
    }),
    vscode.commands.registerCommand('kren.previewReadAloud', () =>
      readAloudText(
        context,
        'KREN voice preview.'
      )
    ),
    vscode.commands.registerCommand('kren.useClipboard', () => executeClipboardLookup(context)),
    vscode.commands.registerCommand('kren.copyLastResult', copyLastResult),
    vscode.commands.registerCommand('kren.replaceLastResult', replaceLastResult),
    vscode.commands.registerCommand('kren.showDetails', showDetails),
    vscode.commands.registerCommand('kren.showResults', () => resultsView.reveal()),
    vscode.commands.registerCommand('kren.addToUserDictionary', () =>
      executeAddToUserDictionary(context)
    ),
    vscode.commands.registerCommand('kren.openUserDictionary', () =>
      openUserDictionary()
    ),
    vscode.commands.registerCommand('kren.openTutor', () => resultsView.showTutor()),
    vscode.commands.registerCommand('kren.hideResults', () => resultsView.hide()),
    // Deprecated alias for the identifier used before 1.3.3, kept registered but no
    // longer contributed in package.json, so it stays out of the Command Palette while a
    // hand-written keybinding on the old name keeps working. It runs the new behaviour
    // deliberately: someone who bound the old command wanted to put KREN away, not to
    // close the Secondary Sidebar and take Chat and Codex with it.
    vscode.commands.registerCommand('kren.hideSecondarySidebar', () => resultsView.hide()),
    vscode.commands.registerCommand('kren.openPanelSettings', () => resultsView.showSettings()),
    vscode.commands.registerCommand('kren.clearResults', () => {
      lastResult = undefined;
      hoverStore.clear();
      grammarCodeActions.clear();
      resultsView.clear();
    }),
    vscode.commands.registerCommand('kren.configureProvider', () => configureProvider(context)),
    vscode.commands.registerCommand('kren.configureLanguages', configureLanguages),
    vscode.commands.registerCommand('kren.configureRewriteGeminiProfile', () =>
      configureRewriteGeminiProfile(context)
    ),
    vscode.commands.registerCommand('kren.playPronunciation', (audioUrl: unknown, headword: unknown) =>
      resultsView.playPronunciation(audioUrl, headword)
    ),
    vscode.commands.registerCommand('kren.setGeminiApiKey', () =>
      setSecret(context, GEMINI_KEY, 'Enter your Gemini Free Tier API key')
    ),
    vscode.commands.registerCommand('kren.deleteGeminiApiKey', () =>
      deleteSecret(context, GEMINI_KEY, 'Gemini Free Tier API key deleted.')
    ),
    vscode.commands.registerCommand('kren.setGeminiProApiKey', () =>
      setSecret(context, GEMINI_PRO_KEY, 'Enter your Gemini Paid API key')
    ),
    vscode.commands.registerCommand('kren.deleteGeminiProApiKey', () =>
      deleteSecret(context, GEMINI_PRO_KEY, 'Gemini Paid API key deleted.')
    ),
    vscode.commands.registerCommand('kren.setGroqApiKey', () => setSecret(context, GROQ_KEY, 'Enter your Groq API key')),
    vscode.commands.registerCommand('kren.deleteGroqApiKey', () => deleteSecret(context, GROQ_KEY, 'Groq API key deleted.')),
    vscode.commands.registerCommand('kren.testGroqConnection', () => {
      const limits: GroqRequestLimits = {};
      return testLanguageModelConnection(context, 'Groq', GROQ_KEY, 'kren.setGroqApiKey',
        (key, signal) => listGroqModels(key, signal, limits), limits);
    }),
    vscode.commands.registerCommand('kren.testGeminiConnection', () => testGeminiConnection(context, 'default')),
    vscode.commands.registerCommand('kren.testGeminiProConnection', () => testGeminiConnection(context, 'alternate')),
    // Fixed destination, like credential help. No webview-supplied URL is accepted.
    vscode.commands.registerCommand('kren.openGeminiUsage', () => vscode.env.openExternal(vscode.Uri.parse('https://ai.dev/rate-limit'))),
    vscode.commands.registerCommand('kren.testCloudflareConnection', () => testCredentialConnection(context, 'Cloudflare', [
      [KREN_SECRET_KEYS.cloudflareAccountId, 'kren.setCloudflareAccountId'],
      [KREN_SECRET_KEYS.cloudflareApiToken, 'kren.setCloudflareApiToken']
    ], async ([accountId, token], signal) => {
      await testCloudflareCredentials(accountId!, token!, signal);
      return 'account ID and API token checked; no neurons used';
    })),
    vscode.commands.registerCommand('kren.testGoogleCloudTranslation', () => testCredentialConnection(context, 'Google Cloud Translation', [
      [GOOGLE_CLOUD_TRANSLATION_KEY, 'kren.setGoogleCloudTranslationApiKey']
    ], async ([key], signal) => {
      await new GoogleCloudTranslationProvider(key!, characters => cloudTranslationUsage.reserve(characters)).translate({
        text: 'test', sourceLanguage: 'en', targetLanguage: 'ko', kind: 'translation', operation: 'translate'
      }, signal);
      return '4 characters used and counted in the local monthly ledger';
    })),
    vscode.commands.registerCommand('kren.testMerriamWebsterCollegiate', () => testMerriamWebsterConnection(context, 'collegiate', MW_COLLEGIATE_KEY, 'kren.setMerriamWebsterCollegiateApiKey')),
    vscode.commands.registerCommand('kren.testMerriamWebsterThesaurus', () => testMerriamWebsterConnection(context, 'thesaurus', MW_THESAURUS_KEY, 'kren.setMerriamWebsterThesaurusApiKey')),
    vscode.commands.registerCommand('kren.testMerriamWebsterMedical', () => testMerriamWebsterConnection(context, 'medical', MW_MEDICAL_KEY, 'kren.setMerriamWebsterMedicalApiKey')),
    vscode.commands.registerCommand('kren.setOpenAIApiKey', () =>
      setSecret(context, OPENAI_KEY, 'Enter your OpenAI API key')
    ),
    vscode.commands.registerCommand('kren.deleteOpenAIApiKey', () =>
      deleteSecret(context, OPENAI_KEY, 'OpenAI API key deleted.')
    ),
    vscode.commands.registerCommand('kren.testOpenAIConnection', () =>
      testLanguageModelConnection(context, 'OpenAI', OPENAI_KEY, 'kren.setOpenAIApiKey', listOpenAIModels)
    ),
    vscode.commands.registerCommand('kren.setCloudflareAccountId', () =>
      setSecret(context, KREN_SECRET_KEYS.cloudflareAccountId, 'Enter your Cloudflare account ID')
    ),
    vscode.commands.registerCommand('kren.deleteCloudflareAccountId', () =>
      deleteSecret(context, KREN_SECRET_KEYS.cloudflareAccountId, 'Cloudflare account ID deleted.')
    ),
    vscode.commands.registerCommand('kren.setCloudflareApiToken', () =>
      setSecret(context, KREN_SECRET_KEYS.cloudflareApiToken, 'Enter your Cloudflare API token')
    ),
    vscode.commands.registerCommand('kren.deleteCloudflareApiToken', () =>
      deleteSecret(context, KREN_SECRET_KEYS.cloudflareApiToken, 'Cloudflare API token deleted.')
    ),
    vscode.commands.registerCommand('kren.setAnthropicApiKey', () =>
      setSecret(context, ANTHROPIC_KEY, 'Enter your Anthropic API key')
    ),
    vscode.commands.registerCommand('kren.deleteAnthropicApiKey', () =>
      deleteSecret(context, ANTHROPIC_KEY, 'Anthropic API key deleted.')
    ),
    vscode.commands.registerCommand('kren.testAnthropicConnection', () =>
      testLanguageModelConnection(
        context,
        'Anthropic',
        ANTHROPIC_KEY,
        'kren.setAnthropicApiKey',
        listAnthropicModels
      )
    ),
    vscode.commands.registerCommand('kren.testGoogleCloudTextToSpeech', async () => {
      if (!await context.secrets.get(GOOGLE_CLOUD_TEXT_TO_SPEECH_KEY) && !await context.secrets.get(GOOGLE_CLOUD_TRANSLATION_KEY)) {
        await showLookupError(missingCredentialError('googleCloudTextToSpeech')); return;
      }
      const config = vscode.workspace.getConfiguration('kren');
      const message = await chirpSpeech.test({
        voice: config.get<string>('tutor.liveFemaleVoice', 'Callirrhoe'),
        ratePercent: config.get<number>('tutor.readAloud.edgeRatePercent', 0),
        volume: config.get<number>('tutor.readAloud.volume', 100)
      });
      notify(message === 'Google Cloud Text-to-Speech works.' ? 'information' : 'warning', message);
    }),
    vscode.commands.registerCommand('kren.setGoogleCloudTextToSpeechApiKey', () =>
      setSecret(context, GOOGLE_CLOUD_TEXT_TO_SPEECH_KEY, 'Enter your Google Cloud Text-to-Speech API key')
    ),
    vscode.commands.registerCommand('kren.deleteGoogleCloudTextToSpeechApiKey', () =>
      deleteSecret(context, GOOGLE_CLOUD_TEXT_TO_SPEECH_KEY, 'Google Cloud Text-to-Speech API key deleted.')
    ),
    vscode.commands.registerCommand('kren.setGoogleCloudTranslationApiKey', () =>
      setGoogleCloudTranslationKey(context)
    ),
    vscode.commands.registerCommand('kren.deleteGoogleCloudTranslationApiKey', () =>
      deleteSecret(
        context,
        GOOGLE_CLOUD_TRANSLATION_KEY,
        'Google Cloud Translation API key deleted.'
      )
    ),
    vscode.commands.registerCommand('kren.showGoogleCloudTranslationUsage', () =>
      showGoogleCloudTranslationUsage()
    ),
    vscode.commands.registerCommand('kren.setMerriamWebsterCollegiateApiKey', () =>
      setSecret(
        context,
        MW_COLLEGIATE_KEY,
        'Enter your Merriam-Webster Collegiate API key'
      )
    ),
    vscode.commands.registerCommand('kren.deleteMerriamWebsterCollegiateApiKey', () =>
      deleteSecret(context, MW_COLLEGIATE_KEY, 'Merriam-Webster Collegiate API key deleted.')
    ),
    vscode.commands.registerCommand('kren.setMerriamWebsterMedicalApiKey', () =>
      setSecret(context, MW_MEDICAL_KEY, 'Enter your Merriam-Webster Medical API key')
    ),
    vscode.commands.registerCommand('kren.deleteMerriamWebsterMedicalApiKey', () =>
      deleteSecret(context, MW_MEDICAL_KEY, 'Merriam-Webster Medical API key deleted.')
    ),
    vscode.commands.registerCommand('kren.setMerriamWebsterThesaurusApiKey', () =>
      setSecret(
        context,
        MW_THESAURUS_KEY,
        'Enter your Merriam-Webster Collegiate Thesaurus API key'
      )
    ),
    vscode.commands.registerCommand('kren.deleteMerriamWebsterThesaurusApiKey', () =>
      deleteSecret(context, MW_THESAURUS_KEY, 'Merriam-Webster Thesaurus API key deleted.')
    ),
    vscode.commands.registerCommand('kren.setKoreanDictionaryApiKey', async () => {
      const stored = await setSecret(
        context,
        DICTIONARY_KEY,
        'Enter your Korean Basic Dictionary API key'
      );
      if (stored) await testKoreanDictionary(context);
    }),
    vscode.commands.registerCommand('kren.deleteKoreanDictionaryApiKey', () =>
      deleteSecret(context, DICTIONARY_KEY, 'Korean Dictionary API key deleted.')
    ),
    vscode.commands.registerCommand('kren.deleteAllApiKeys', () =>
      deleteAllApiKeys(context)
    ),
    vscode.commands.registerCommand('kren.restoreDefaultSettings', () =>
      restoreDefaultSettings(context)
    ),
    vscode.commands.registerCommand('kren.applyGlobalRouting', () => applyGlobalRouting()),
    vscode.commands.registerCommand('kren.resetKren', () => resetKren(context)),
    vscode.commands.registerCommand('kren.testKoreanDictionary', () =>
      testKoreanDictionary(context)
    ),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (lastResult?.uri === event.document.uri.toString()) hoverStore.clear();
      grammarCodeActions.clear(event.document.uri);
      scheduleAutomaticGrammarCheck(context, event.document);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('kren.llm')) postProviderSwitchSettings(resultsView);
      // 2026-10-11: pass style changes to the mounted control without rebuilding the conversation.
      if (event.affectsConfiguration('kren.tutor.conversation.pictureStyle')) {
        postTutorPictureStyleSetting(resultsView);
      }
      // 2026-10-10: The take-home switch patches the mounted conversation and preserves its answer box.
      if (event.affectsConfiguration('kren.tutor.conversation.hintPrefetch')) postTutorHintPrefetchSetting(resultsView);
      if (event.affectsConfiguration('kren.tutor.conversation.takeHome')) {
        resultsView.refreshTutorTakeHomeSetting();
      }
      // 2026-10-04: Theme changes patch each mounted webview and preserve active input.
      if (event.affectsConfiguration('kren.tutor.pictureProvider')) {
        reconcileTutorPictureProviderChange(resultsView, previousPictureProvider);
        previousPictureProvider = readPanelSettings().tutorPictureProvider;
      }
      if (event.affectsConfiguration('kren') && !event.affectsConfiguration('kren.display.panelTheme') &&
          !event.affectsConfiguration('kren.tutor.conversation.pictureStyle') &&
          !event.affectsConfiguration('kren.tutor.conversation.takeHome') &&
          !event.affectsConfiguration('kren.tutor.conversation.hintPrefetch') &&
          !event.affectsConfiguration('kren.llm')) resultsView.refresh();
    }),
    context.secrets.onDidChange((event) => {
      if (!Object.values(KREN_SECRET_KEYS).includes(event.key as typeof GEMINI_KEY)) return;
      clearProviderExhaustionForCredential(event.key);
      void context.secrets.get(event.key).then((value) => {
        if (value) storedSecretKeys.add(event.key);
        else storedSecretKeys.delete(event.key);
        reconcileTutorPictureProviderChange(resultsView, previousPictureProvider);
        previousPictureProvider = readPanelSettings().tutorPictureProvider;
        resultsView.refresh();
      });
    })
  );

  if (vscode.workspace.getConfiguration('kren').get<boolean>('results.openAtStartup', RESULTS_OPEN_AT_STARTUP_DEFAULT)) {
    const startupRevealTimer = setTimeout(() => {
      void resultsView.reveal().catch((error: unknown) => {
        outputChannel.appendLine(
          `KREN startup sidebar could not be opened: ${error instanceof Error ? error.message : String(error)}`
        );
      });
    }, 750);
    context.subscriptions.push({
      dispose: () => clearTimeout(startupRevealTimer)
    });
  }
}

function readPanelSettings(): KrenPanelSettings {
  const configuration = vscode.workspace.getConfiguration('kren');
  const pictureConfiguration = vscode.workspace.getConfiguration('kren',
    vscode.window.activeTextEditor?.document ?? vscode.workspace.workspaceFolders?.[0]?.uri);
  const config = { get: <T>(key: string, fallback: T): T => normalizeModelSetting(key, configuration.get<T>(key, fallback)) };
  return {
    languageModelUsageToday: languageModelUsageToday(),
    globalRouting: globalRoutingSettings(configuration) as KrenPanelSettings['globalRouting'],
    llmProviderSwitch: config.get('llm.providerSwitch', true),
    llmProviderOrder: config.get('llm.providerOrder', [...DEFAULT_PROVIDER_ORDER]),
    userDictionaryEnabled: config.get<boolean>('userDictionary.enabled', false),
    userDictionaryCaptureMode: config.get<KrenPanelSettings['userDictionaryCaptureMode']>(
      'userDictionary.defaultCaptureMode',
      'llmOnly'
    ),
    userDictionaryFallbackOnMerriamWebsterNoMatch: config.get<boolean>(
      'userDictionary.fallbackOnMerriamWebsterNoMatch',
      false
    ),
    userDictionaryProvider: config.get<KrenPanelSettings['userDictionaryProvider']>(
      'userDictionary.provider',
      'gemini'
    ),
    userDictionaryModel: routedModel(config.get<string>('userDictionary.provider', 'gemini'), config.get<string>(
      'userDictionary.model',
      DEFAULT_GEMINI_MODEL
    )),
    userDictionaryAlternateModel: config.get<string>(
      'userDictionary.alternateModel',
      'gemini-3.1-pro-preview'
    ),
    userDictionaryThinkingOrEffort: config.get<KrenPanelSettings['userDictionaryThinkingOrEffort']>(
      'userDictionary.thinkingOrEffort',
      'low'
    ),
    userDictionarySmartWordCapture: config.get<boolean>(
      'userDictionary.smartWordCapture',
      true
    ),
    userDictionaryEntryLanguage: config.get<string>('userDictionary.entryLanguage', 'auto'),
    userDictionaryIncludePronunciation: config.get<boolean>(
      'userDictionary.includePronunciation',
      true
    ),
    userDictionaryIncludeSynonyms: config.get<boolean>(
      'userDictionary.includeSynonyms',
      true
    ),
    userDictionaryIncludeUsageNotes: config.get<boolean>(
      'userDictionary.includeUsageNotes',
      true
    ),
    userDictionaryNumberOfExamples: config.get<KrenPanelSettings['userDictionaryNumberOfExamples']>(
      'userDictionary.numberOfExamples',
      2
    ),
    userDictionaryIncludeTechnicalMeanings: config.get<boolean>(
      'userDictionary.includeTechnicalMeanings',
      true
    ),
    userDictionaryStoragePath,
    openResultsAtStartup: config.get<boolean>('results.openAtStartup', RESULTS_OPEN_AT_STARTUP_DEFAULT),
    translationProvider: config.get<'googleCloudTranslation' | 'gemini'>(
      'translationProvider',
      'googleCloudTranslation'
    ),
    translationSourceLanguage: config.get<string>('translation.sourceLanguage', TRANSLATION_AUTO_SOURCE),
    translationTargetLanguage: config.get<string>(
      'translation.targetLanguage',
      DEFAULT_TRANSLATION_TARGET
    ),
    translationRoutingProvider: config.get<KrenPanelSettings['translationRoutingProvider']>(
      'translation.provider',
      TRANSLATION_ROUTING_DEFAULTS.provider
    ),
    translationModel: routedModel(config.get<string>('translation.provider', 'gemini'), config.get<string>(
      'translation.model',
      TRANSLATION_ROUTING_DEFAULTS.model
    )),
    translationAlternateModel: config.get<string>(
      'translation.alternateModel',
      'gemini-3.1-pro-preview'
    ),
    translationThinkingOrEffort: config.get<KrenPanelSettings['translationThinkingOrEffort']>(
      'translation.thinkingOrEffort',
      TRANSLATION_ROUTING_DEFAULTS.thinkingOrEffort
    ),
    translationProfile: config.get<KrenPanelSettings['translationProfile']>(
      'translation.geminiProfile',
      'standard'
    ),
    translationFallbackEnabled: config.get<boolean>('translation.fallbackEnabled', false),
    translationFallbackModel: config.get<string>(
      'translation.fallbackModel',
      DEFAULT_GEMINI_MODEL
    ),
    translationFallbackThinkingOrEffort:
      config.get<KrenPanelSettings['translationFallbackThinkingOrEffort']>(
        'translation.fallbackThinkingOrEffort',
        'low'
      ),
    grammarDialect: config.get<KrenPanelSettings['grammarDialect']>(
      'grammar.dialect',
      'american'
    ),
    grammarSmart: config.get<boolean>('grammar.smart', GRAMMAR_SMART_DEFAULT),
    grammarAutoCheck: config.get<boolean>('grammar.autoCheck', false),
    grammarAutoCheckDelayMs: config.get<number>('grammar.autoCheckDelayMs', 900),
    grammarCustomWordCount: activeExtensionContext.globalState.get<string[]>(GRAMMAR_CUSTOM_WORDS, []).length,
    grammarIgnoredFindingCount: ignoredLintCount(
      activeExtensionContext.globalState.get<string>(GRAMMAR_IGNORED_LINTS, '')
    ),
    explanationOutputLanguage: config.get<string>(
      'explanation.outputLanguage',
      EXPLANATION_SAME_AS_SOURCE
    ),
    explanationProvider: config.get<KrenPanelSettings['explanationProvider']>(
      'explanation.provider',
      'gemini'
    ),
    explanationModel: routedModel(config.get<string>('explanation.provider', 'gemini'), config.get<string>('explanation.model', DEFAULT_GEMINI_MODEL)),
    explanationAlternateModel: config.get<string>('explanation.alternateModel', 'gemini-3.1-pro-preview'),
    explanationThinkingOrEffort:
      config.get<KrenPanelSettings['explanationThinkingOrEffort']>(
        'explanation.thinkingOrEffort',
        'auto'
      ),
    explanationProfile: config.get<'standard' | 'pro'>(
      'explanation.geminiProfile',
      'standard'
    ),
    explanationFallbackEnabled: config.get<boolean>('explanation.fallbackEnabled', true),
    explanationFallbackModel: config.get<string>(
      'explanation.fallbackModel',
      DEFAULT_GEMINI_MODEL
    ),
    explanationFallbackThinkingOrEffort:
      config.get<KrenPanelSettings['explanationFallbackThinkingOrEffort']>(
        'explanation.fallbackThinkingOrEffort',
        'low'
      ),
    rewriteProvider: config.get<KrenPanelSettings['rewriteProvider']>(
      'rewrite.provider',
      'gemini'
    ),
    rewriteModel: routedModel(config.get<string>('rewrite.provider', 'gemini'), config.get<string>('rewrite.model', DEFAULT_GEMINI_MODEL)),
    rewriteAlternateModel: config.get<string>('rewrite.alternateModel', 'gemini-3.1-pro-preview'),
    rewriteThinkingOrEffort: config.get<KrenPanelSettings['rewriteThinkingOrEffort']>(
      'rewrite.thinkingOrEffort',
      'auto'
    ),
    rewriteSourceLanguage: config.get<string>('rewrite.sourceLanguage', 'auto'),
    rewriteModality: config.get<KrenPanelSettings['rewriteModality']>(
      'rewrite.modality',
      REWRITE_AXIS_DEFAULTS.modality
    ),
    rewriteFunction: config.get<KrenPanelSettings['rewriteFunction']>(
      'rewrite.function',
      REWRITE_AXIS_DEFAULTS.function
    ),
    rewriteOtherOutputLanguage: config.get<string>('rewrite.otherOutputLanguage', 'ko'),
    rewriteEnglishVariety: config.get<KrenPanelSettings['rewriteEnglishVariety']>(
      'rewrite.englishVariety',
      REWRITE_AXIS_DEFAULTS.englishVariety
    ),
    geminiModel: config.get<string>('gemini.model', DEFAULT_GEMINI_MODEL),
    geminiThinkingLevel: config.get<KrenPanelSettings['geminiThinkingLevel']>(
      'gemini.thinkingLevel',
      'auto'
    ),
    openAIModel: config.get<string>('openai.model', 'gpt-5.4'),
    openAIReasoningEffort: config.get<KrenPanelSettings['openAIReasoningEffort']>(
      'openai.reasoningEffort',
      'low'
    ),
    anthropicModel: config.get<string>('anthropic.model', 'claude-sonnet-4-6'),
    anthropicEffort: config.get<KrenPanelSettings['anthropicEffort']>(
      'anthropic.effort',
      'low'
    ),
    rewriteProfile: config.get<'standard' | 'pro'>('rewrite.geminiProfile', 'standard'),
    rewriteFallbackEnabled: config.get<boolean>('rewrite.fallbackEnabled', true),
    rewriteFallbackModel: config.get<string>('rewrite.fallbackModel', DEFAULT_GEMINI_MODEL),
    rewriteFallbackThinkingOrEffort:
      config.get<KrenPanelSettings['rewriteFallbackThinkingOrEffort']>(
        'rewrite.fallbackThinkingOrEffort',
        'low'
      ),
    alternateModel: config.get<string>('gemini.alternateModel', 'gemini-3.1-pro-preview'),
    alternateThinkingLevel: config.get<'low' | 'medium' | 'high'>(
      'gemini.alternateThinkingLevel',
      'low'
    ),
    alternateFallbackEnabled: config.get<boolean>('gemini.alternateFallbackEnabled', true),
    alternateFallbackModel: config.get<string>(
      'gemini.alternateFallbackModel',
      DEFAULT_GEMINI_MODEL
    ),
    alternateFallbackThinkingLevel: config.get<KrenPanelSettings['alternateFallbackThinkingLevel']>(
      'gemini.alternateFallbackThinkingLevel',
      'low'
    ),
    tutorConversationPictureStyle: validatedPanelSetting('tutor.conversation.pictureStyle', config.get('tutor.conversation.pictureStyle', TUTOR_DEFAULTS.configuration['tutor.conversation.pictureStyle'])) as KrenPanelSettings['tutorConversationPictureStyle'] ?? TUTOR_DEFAULTS.configuration['tutor.conversation.pictureStyle'],
    tutorConversationHintPrefetch: config.get<boolean>('tutor.conversation.hintPrefetch', TUTOR_DEFAULTS.configuration['tutor.conversation.hintPrefetch']),
    tutorConversationTakeHome: config.get<boolean>('tutor.conversation.takeHome', TUTOR_DEFAULTS.configuration['tutor.conversation.takeHome']),
    userDictionaryProfile: config.get<KrenPanelSettings['userDictionaryProfile']>(
      'userDictionary.geminiProfile',
      'standard'
    ),
    userDictionaryFallbackEnabled:
      config.get<boolean>('userDictionary.fallbackEnabled', false),
    userDictionaryFallbackModel: config.get<string>(
      'userDictionary.fallbackModel',
      DEFAULT_GEMINI_MODEL
    ),
    userDictionaryFallbackThinkingOrEffort:
      config.get<KrenPanelSettings['userDictionaryFallbackThinkingOrEffort']>(
        'userDictionary.fallbackThinkingOrEffort',
        'low'
      ),
    tutorProvider: config.get<KrenPanelSettings['tutorProvider']>(
      'tutor.provider',
      TUTOR_DEFAULTS.configuration['tutor.provider']
    ),
    ...effectivePictureSettings(
      pictureConfiguration.inspect<'gemini' | 'cloudflare'>('tutor.pictureProvider'),
      pictureConfiguration.inspect<string>('tutor.cloudflareImageModel'),
      { cloudflareAccountId: storedSecretKeys.has(KREN_SECRET_KEYS.cloudflareAccountId),
        cloudflareApiToken: storedSecretKeys.has(KREN_SECRET_KEYS.cloudflareApiToken) }
    ),
    tutorImageModel: config.get<string>('tutor.imageModel', TUTOR_DEFAULTS.configuration['tutor.imageModel']),
    tutorModel: routedModel(config.get<string>('tutor.provider', 'gemini'), config.get<string>('tutor.model', TUTOR_DEFAULTS.configuration['tutor.model'])),
    tutorHintModel: config.get<string>('tutor.hintModel', TUTOR_DEFAULTS.configuration['tutor.hintModel']),
    tutorHintThinkingOrEffort: config.get<KrenPanelSettings['tutorHintThinkingOrEffort']>('tutor.hintThinkingOrEffort', TUTOR_DEFAULTS.configuration['tutor.hintThinkingOrEffort']),
    tutorAlternateModel: config.get<string>('tutor.alternateModel', TUTOR_DEFAULTS.configuration['tutor.alternateModel']),
    tutorThinkingOrEffort: config.get<KrenPanelSettings['tutorThinkingOrEffort']>(
      'tutor.thinkingOrEffort',
      TUTOR_DEFAULTS.configuration['tutor.thinkingOrEffort']
    ),
    tutorLiveProfile: config.get<KrenPanelSettings['tutorProfile']>('tutor.liveGeminiProfile', TUTOR_DEFAULTS.configuration['tutor.liveGeminiProfile']),
    tutorProfile: config.get<KrenPanelSettings['tutorProfile']>(
      'tutor.geminiProfile',
      TUTOR_DEFAULTS.configuration['tutor.geminiProfile']
    ),
    tutorFallbackEnabled: config.get<boolean>('tutor.fallbackEnabled', TUTOR_DEFAULTS.configuration['tutor.fallbackEnabled']),
    // Derived route fields keep the panel bridge compatible without reading retired settings.
    tutorFallbackModel: config.get<string>('tutor.hintModel', TUTOR_DEFAULTS.configuration['tutor.hintModel']),
    tutorFallbackThinkingOrEffort:
      config.get<KrenPanelSettings['tutorFallbackThinkingOrEffort']>(
        'tutor.hintThinkingOrEffort',
        TUTOR_DEFAULTS.configuration['tutor.hintThinkingOrEffort']
      ),
    tutorReadAloudProvider: config.get<KrenPanelSettings['tutorReadAloudProvider']>(
      'tutor.readAloud.provider',
      TUTOR_DEFAULTS.configuration['tutor.readAloud.provider']
    ),
    tutorEdgeReadAloudLocale: config.get<string>('tutor.readAloud.edgeLocale', TUTOR_DEFAULTS.configuration['tutor.readAloud.edgeLocale']),
    tutorEdgeReadAloudVoice: config.get<string>(
      'tutor.readAloud.edgeVoice',
      TUTOR_DEFAULTS.configuration['tutor.readAloud.edgeVoice']
    ),
    tutorEdgeReadAloudFemaleVoice: config.get<string>(
      'tutor.readAloud.edgeFemaleVoice',
      TUTOR_DEFAULTS.configuration['tutor.readAloud.edgeFemaleVoice']
    ),
    tutorEdgeReadAloudMaleVoice: config.get<string>(
      'tutor.readAloud.edgeMaleVoice',
      TUTOR_DEFAULTS.configuration['tutor.readAloud.edgeMaleVoice']
    ),
    tutorEdgeReadAloudRatePercent: config.get<number>('tutor.readAloud.edgeRatePercent', TUTOR_DEFAULTS.configuration['tutor.readAloud.edgeRatePercent']),
    tutorLiveFemaleVoice: config.get<string>('tutor.liveFemaleVoice', TUTOR_DEFAULTS.configuration['tutor.liveFemaleVoice']),
    tutorLiveMaleVoice: config.get<string>('tutor.liveMaleVoice', TUTOR_DEFAULTS.configuration['tutor.liveMaleVoice']),
    tutorReadAloudVoice: config.get<string>(
      'tutor.readAloud.voice',
      TUTOR_DEFAULTS.configuration['tutor.readAloud.voice']
    ),
    tutorReadAloudRate: config.get<number>('tutor.readAloud.rate', TUTOR_DEFAULTS.configuration['tutor.readAloud.rate']),
    tutorReadAloudVolume: config.get<number>('tutor.readAloud.volume', TUTOR_DEFAULTS.configuration['tutor.readAloud.volume']),
    tutorSentencePauseMilliseconds: config.get<number>('tutor.readAloud.sentencePauseMilliseconds', TUTOR_DEFAULTS.configuration['tutor.readAloud.sentencePauseMilliseconds']),
    quickMenuRewriteVariant: config.get<KrenPanelSettings['quickMenuRewriteVariant']>(
      'rewrite.quickMenuVariant',
      ALL_REWRITE_VARIANTS_ID
    ),
    rewriteDomain: config.get<KrenPanelSettings['rewriteDomain']>(
      'rewrite.domain',
      REWRITE_AXIS_DEFAULTS.domain
    ),
    rewriteFormality: config.get<KrenPanelSettings['rewriteFormality']>(
      'rewrite.formality',
      REWRITE_AXIS_DEFAULTS.formality
    ),
    rewriteVoice: config.get<KrenPanelSettings['rewriteVoice']>(
      'rewrite.voice',
      REWRITE_AXIS_DEFAULTS.voice
    ),
    rewriteStance: config.get<KrenPanelSettings['rewriteStance']>(
      'rewrite.stance',
      REWRITE_AXIS_DEFAULTS.stance
    ),
    rewriteLength: config.get<KrenPanelSettings['rewriteLength']>(
      'rewrite.length',
      REWRITE_AXIS_DEFAULTS.length
    ),
    rewritePerspective: config.get<KrenPanelSettings['rewritePerspective']>(
      'rewrite.perspective',
      REWRITE_AXIS_DEFAULTS.perspective
    ),
    rewriteRhetoricalMode: config.get<KrenPanelSettings['rewriteRhetoricalMode']>(
      'rewrite.rhetoricalMode',
      REWRITE_AXIS_DEFAULTS.rhetoricalMode
    ),
    preserveFormatting: config.get<boolean>('rewrite.preserveFormatting', true),
    includeChangeNotes: config.get<boolean>('rewrite.includeChangeNotes', false),
    rewriteCopyToClipboard: config.get<boolean>('rewrite.copyToClipboard', false),
    multiWordTranslationFallback: config.get<boolean>(
      'dictionary.multiWordTranslationFallback',
      true
    ),
    windowsNativePronunciation: config.get<boolean>(
      'pronunciation.windowsNativePlayback',
      true
    ),
    geminiRetryEnabled: config.get<boolean>('gemini.retry.enabled', true),
    geminiRetryMaxAttempts: Math.max(
      1,
      Math.min(5, config.get<number>('gemini.retry.maxAttempts', 4))
    ),
    languageModelRetryEnabled: config.get<boolean>('languageModel.retry.enabled', true),
    languageModelRetryMaxAttempts: Math.max(
      1,
      Math.min(5, config.get<number>('languageModel.retry.maxAttempts', 3))
    ),
    ttsEnabled: config.get<boolean>('rewrite.tts.enabled', true),
    readAloudVoice: config.get<string>('readAloud.voice', ''),
    readAloudRate: config.get<number>('readAloud.rate', 0),
    readAloudVolume: config.get<number>('readAloud.volume', 100),
    readAloudVoices,
    readAloudProvider: config.get<KrenPanelSettings['readAloudProvider']>(
      'readAloud.provider',
      READ_ALOUD_PROVIDER_DEFAULT
    ),
    edgeReadAloudLocale: config.get<string>('readAloud.edgeLocale', 'auto'),
    readAloudChirpVoice: normalizedReadAloudChirpVoice(config.get<string>('readAloud.chirpVoice', 'Callirrhoe')),
    edgeReadAloudVoice: config.get<string>(
      'readAloud.edgeVoice',
      READ_ALOUD_EDGE_VOICE_DEFAULT
    ),
    edgeReadAloudRatePercent: config.get<number>('readAloud.edgeRatePercent', 0),
    edgeReadAloudPythonCommand: config.get<string>('readAloud.edgePythonCommand', 'python'),
    credentialPresence: {
      geminiDefault: storedSecretKeys.has(GEMINI_KEY),
      geminiAlternate: storedSecretKeys.has(GEMINI_PRO_KEY),
      googleCloudTranslation: storedSecretKeys.has(GOOGLE_CLOUD_TRANSLATION_KEY),
      googleCloudTextToSpeech: storedSecretKeys.has(GOOGLE_CLOUD_TEXT_TO_SPEECH_KEY),
      openai: storedSecretKeys.has(OPENAI_KEY),
      anthropic: storedSecretKeys.has(ANTHROPIC_KEY),
      groq: storedSecretKeys.has(GROQ_KEY),
      cloudflareAccountId: storedSecretKeys.has(KREN_SECRET_KEYS.cloudflareAccountId),
      cloudflareApiToken: storedSecretKeys.has(KREN_SECRET_KEYS.cloudflareApiToken),
      merriamWebsterCollegiate: storedSecretKeys.has(MW_COLLEGIATE_KEY),
      merriamWebsterMedical: storedSecretKeys.has(MW_MEDICAL_KEY),
      merriamWebsterThesaurus: storedSecretKeys.has(MW_THESAURUS_KEY),
      koreanDictionary: storedSecretKeys.has(DICTIONARY_KEY)
    },
    translationDomain: config.get<KrenPanelSettings['translationDomain']>(
      'translation.domain',
      REWRITE_DOMAINS[0].id
    ),
    explanationDomain: config.get<KrenPanelSettings['explanationDomain']>(
      'explanation.domain',
      REWRITE_DOMAINS[0].id
    ),
    displayMode: config.get<string>('display.mode', 'hover'),
    panelTheme: validatedPanelSetting('display.panelTheme', config.get<string>('display.panelTheme', 'followVSCode')) as KrenPanelSettings['panelTheme'] ?? 'followVSCode',
    requestTimeoutMs: config.get<number>('request.timeoutMs', 45000),
    translationMaxCharacters: config.get<number>('translation.maxCharacters', 5000),
    userDictionaryMaxImportEntries: config.get<number>('userDictionary.maxImportEntries', 5000),
    extensionVersion
  };
}

async function updatePanelSetting(
  key: KrenPanelSettingKey,
  rawValue: string | number | boolean
): Promise<void> {
  const value = validatedPanelSetting(key, rawValue);
  if (value === undefined) {
    notify('error', `KREN rejected an invalid value for ${key}.`);
    resultsView.refresh();
    return;
  }
  const configuration = vscode.workspace.getConfiguration('kren');
  const themeScope = key === 'display.panelTheme' ? configuration.inspect(key) : undefined;
  const target = themeScope?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
    : themeScope?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  await configuration.update(key, key === 'llm.providerOrder' ? JSON.parse(String(value)) : value, target);

  // Changing the language must change the voice with it. Leaving the stored identifier
  // behind is what the owner saw: pick Korean, and the Voice list falls to "Custom voice ID"
  // showing whatever English voice was last typed. The two controls describe one choice, so
  // one of them moving moves the other.
  if (key === 'readAloud.edgeLocale') {
    const follower = resolveEdgeSpeechVoice(
      String(value),
      configuration.get<string>('readAloud.edgeVoice', READ_ALOUD_EDGE_VOICE_DEFAULT)
    );
    if (follower && follower !== configuration.get<string>('readAloud.edgeVoice', READ_ALOUD_EDGE_VOICE_DEFAULT)) {
      await configuration.update(
        'readAloud.edgeVoice',
        follower,
        vscode.ConfigurationTarget.Global
      );
    }
  }
}

async function updateTutorVoiceSetting(
  key: TutorVoiceDefaultSettingKey,
  value: string
): Promise<void> {
  // The controller validates the catalog value, and these literal keys keep tutor voice
  // defaults out of the shared panel-setting write path.
  await vscode.workspace.getConfiguration('kren').update(
    key, value, vscode.ConfigurationTarget.Global
  );
}

/**
 * Retrieve the models one Gemini profile's key can reach.
 *
 * Both profiles now have their own Refresh button and both write the one shared suggestion
 * list. Until 1.7.7 there was one command and it always read the alternate key, so a reader
 * on the Default profile pressing Refresh was asked for an alternate key they did not have,
 * got DEFAULT_PRO_MODELS back, and saw a notification naming the alternate profile beside a
 * list that had not changed.
 */
function missingSecretCredential(secretKey: string): ProviderError {
  const slot = Object.entries(KREN_SECRET_KEYS).find(([, value]) => value === secretKey)?.[0];
  if (slot === 'gemini' || slot === 'geminiPro') return missingCredentialError('gemini', slot === 'geminiPro' ? 'pro' : 'standard');
  if (slot === 'cloudflareAccountId' || slot === 'cloudflareApiToken') return missingCredentialError('cloudflare');
  return missingCredentialError(slot as CredentialProvider);
}

async function refreshGeminiImageModels(context: vscode.ExtensionContext) {
  const key = await extensionRuntime(context).getSecret(KREN_SECRET_KEYS.geminiPro);
  if (!key) { await showLookupError(missingCredentialError('gemini', 'pro')); return []; }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try { return await listGeminiImageModels(key, controller.signal, 'setGeminiProKey'); }
  catch (error) { await showLookupError(error); return []; }
  finally { clearTimeout(timeout); }
}

async function refreshGeminiProfileModels(
  context: vscode.ExtensionContext,
  profile: GeminiRefreshProfile
): Promise<GeminiModelOption[]> {
  const { secretKey, setKeyCommand, keyHint, label } = geminiRefreshTarget(profile);

  const key = await context.secrets.get(secretKey);
  if (!key) await showLookupError(missingSecretCredential(secretKey), undefined, false, true);
  if (!key) return DEFAULT_PRO_MODELS;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const models = await withKrenProgress(
      {
        title: `KREN: retrieving models for the Gemini ${label} profile...`,
        cancellable: false
      },
      () => listGeminiProModels(
        key, controller.signal, keyHint, geminiModelDiscoveryProtections()
      )
    );
    notify('information',
      `KREN found ${models.length} Gemini text models available or recommended for the ${label} profile. Open the Model list to see them.`
    );
    return models;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      notify('error', 'KREN: Gemini model discovery timed out.');
    } else {
      await showLookupError(error);
    }
    return DEFAULT_PRO_MODELS;
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshGroqModels(context: vscode.ExtensionContext) {
  return refreshLanguageModels(context, GROQ_KEY, 'kren.setGroqApiKey', 'Groq', listGroqModels, GROQ_MODELS.map(id => ({ id, displayName: id })));
}

async function refreshOpenAIModels(context: vscode.ExtensionContext) {
  return refreshLanguageModels(
    context,
    OPENAI_KEY,
    'kren.setOpenAIApiKey',
    'OpenAI',
    listOpenAIModels,
    [{ id: 'gpt-5.4', displayName: 'GPT-5.4' }]
  );
}

async function refreshAnthropicModels(context: vscode.ExtensionContext) {
  return refreshLanguageModels(
    context,
    ANTHROPIC_KEY,
    'kren.setAnthropicApiKey',
    'Anthropic',
    listAnthropicModels,
    [{ id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' }]
  );
}

async function refreshLanguageModels(
  context: vscode.ExtensionContext,
  secretKey: string,
  setKeyCommand: string,
  providerName: string,
  listModels: (key: string, signal: AbortSignal) => Promise<GeminiModelOption[]>,
  fallback: GeminiModelOption[]
): Promise<GeminiModelOption[]> {
  const key = await context.secrets.get(secretKey);
  if (!key) await showLookupError(missingSecretCredential(secretKey));
  if (!key) return fallback;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const models = await withKrenProgress(
      {
        title: `KREN: retrieving ${providerName} models...`,
        cancellable: false
      },
      () => listModels(key, controller.signal)
    );
    notify('information', `KREN found ${models.length} ${providerName} models. Open the Model list to see them.`);
    return models;
  } catch (error) {
    await showLookupError(error);
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

async function testLanguageModelConnection(
  context: vscode.ExtensionContext,
  providerName: string,
  secretKey: string,
  setKeyCommand: string,
  listModels: (key: string, signal: AbortSignal) => Promise<GeminiModelOption[]>,
  limits?: GroqRequestLimits
): Promise<void> {
  const key = await context.secrets.get(secretKey);
  if (!key) await showLookupError(missingSecretCredential(secretKey));
  if (!key) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const models = await listModels(key, controller.signal);
    notify('information',
      `KREN: ${providerName} connection succeeded (${models.length} compatible models found).` +
      (limits?.limit !== undefined && limits.remaining !== undefined ? ` (${limits.remaining} of ${limits.limit} requests left today)` : '')
    );
  } catch (error) {
    await showLookupError(error instanceof ProviderError ? error : new ProviderError(`${providerName} connection test failed. Try again.`));
  } finally {
    clearTimeout(timeout);
  }
}

async function testGeminiConnection(context: vscode.ExtensionContext, profile: GeminiRefreshProfile): Promise<void> {
  const { secretKey, setKeyCommand, keyHint, label } = geminiRefreshTarget(profile);
  await testLanguageModelConnection(context, `Gemini ${label}`, secretKey, setKeyCommand,
    (key, signal) => listGeminiProModels(key, signal, keyHint, geminiModelDiscoveryProtections()));
}

async function testCredentialConnection(
  context: vscode.ExtensionContext,
  providerName: string,
  credentials: ReadonlyArray<readonly [string, string]>,
  request: (keys: string[], signal: AbortSignal) => Promise<string>
): Promise<void> {
  const keys: string[] = [];
  for (const [secretKey, setKeyCommand] of credentials) {
    const key = await context.secrets.get(secretKey);
    if (!key) {
      const error = secretKey === KREN_SECRET_KEYS.cloudflareAccountId || secretKey === KREN_SECRET_KEYS.cloudflareApiToken
        ? missingCredentialError('cloudflare', 'standard', [
          ...(!await context.secrets.get(KREN_SECRET_KEYS.cloudflareAccountId) ? ['account ID'] : []),
          ...(!await context.secrets.get(KREN_SECRET_KEYS.cloudflareApiToken) ? ['API token'] : [])])
        : missingSecretCredential(secretKey);
      await showLookupError(error); return;
    }
    keys.push(key);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const detail = await request(keys, controller.signal);
    notify('information', `KREN: ${providerName} connection succeeded (${detail}).`);
  } catch (error) {
    await showLookupError(error instanceof ProviderError ? error : new ProviderError(`${providerName} connection test failed. Try again.`));
  } finally {
    clearTimeout(timeout);
  }
}

async function testMerriamWebsterConnection(
  context: vscode.ExtensionContext, reference: MerriamWebsterReference, secretKey: string, setKeyCommand: string
): Promise<void> {
  const label = reference === 'collegiate' ? 'Collegiate' : reference === 'thesaurus' ? 'Thesaurus' : 'Medical';
  await testCredentialConnection(context, `Merriam-Webster ${label}`, [[secretKey, setKeyCommand]], async ([key], signal) => {
    await new MerriamWebsterProvider(key!, reference).lookup({
      text: 'test', sourceLanguage: 'en', targetLanguage: 'en', kind: 'dictionary', operation: 'translate'
    }, signal);
    return 'one lookup used';
  });
}

async function runPanelCommand(command: KrenPanelCommand): Promise<void> {
  if (command === 'workbench.action.openSettings') {
    await vscode.commands.executeCommand(command, `@ext:${extensionId}`);
    return;
  }
  await vscode.commands.executeCommand(command);
}

async function migrateTranslationProviderToCloud(
  context: vscode.ExtensionContext
): Promise<void> {
  if (context.globalState.get<boolean>(CLOUD_DEFAULT_MIGRATION, false)) return;
  const cloudKey = await context.secrets.get(GOOGLE_CLOUD_TRANSLATION_KEY);
  if (!cloudKey) return;

  const config = vscode.workspace.getConfiguration('kren');
  const inspected = config.inspect<TranslationProviderId>('translationProvider');
  if (inspected?.workspaceValue === undefined && inspected?.workspaceFolderValue === undefined &&
      inspected?.globalValue === 'gemini') {
    await config.update(
      'translationProvider',
      'googleCloudTranslation',
      vscode.ConfigurationTarget.Global
    );
  }
  await context.globalState.update(CLOUD_DEFAULT_MIGRATION, true);
}

async function migrateRewriteAxes(): Promise<void> {
  const config = vscode.workspace.getConfiguration('kren');
  const targets: Record<RewriteConfigurationTarget, vscode.ConfigurationTarget> = {
    global: vscode.ConfigurationTarget.Global,
    workspace: vscode.ConfigurationTarget.Workspace,
    workspaceFolder: vscode.ConfigurationTarget.WorkspaceFolder
  };
  await migrateLegacyRewriteSettings({
    inspect: <T>(key: string) => config.inspect<T>(key),
    update: (key, value, target) => config.update(key, value, targets[target])
  });
  await migrateRetiredRewriteVariantSettings({
    inspect: <T>(key: string) => config.inspect<T>(key),
    update: (key, value, target) => config.update(key, value, targets[target])
  });
}

function refreshReadAloudVoices(): Promise<void> {
  if (readAloudVoices.length > 0) return Promise.resolve();
  if (readAloudVoicesPromise) return readAloudVoicesPromise;
  readAloudVoicesPromise = listWindowsSpeechVoices()
    .then((voices) => {
      readAloudVoices = voices;
    })
    .catch(() => {
      readAloudVoices = [];
    })
    .finally(() => {
      readAloudVoicesPromise = undefined;
    });
  return readAloudVoicesPromise;
}

async function migrateDeprecatedGeminiFallback(
  context: vscode.ExtensionContext
): Promise<void> {
  if (context.globalState.get<boolean>(GEMINI_FALLBACK_MODEL_MIGRATION, false)) return;
  const config = vscode.workspace.getConfiguration('kren');
  const inspected = config.inspect<string>('gemini.alternateFallbackModel');
  const deprecatedModel = ['gemini', '2.5', 'pro'].join('-');
  const replacementModel = DEFAULT_GEMINI_MODEL;
  if (inspected?.globalValue === deprecatedModel) {
    await config.update(
      'gemini.alternateFallbackModel',
      replacementModel,
      vscode.ConfigurationTarget.Global
    );
  }
  if (inspected?.workspaceValue === deprecatedModel) {
    await config.update(
      'gemini.alternateFallbackModel',
      replacementModel,
      vscode.ConfigurationTarget.Workspace
    );
  }
  if (inspected?.workspaceFolderValue === deprecatedModel) {
    await config.update(
      'gemini.alternateFallbackModel',
      replacementModel,
      vscode.ConfigurationTarget.WorkspaceFolder
    );
  }
  await context.globalState.update(GEMINI_FALLBACK_MODEL_MIGRATION, true);
}

/**
 * Move a stored `bilingual` explanation language to Same as source, once.
 *
 * The owner removed Bilingual on 2026-08-28. Leaving the value stored would show an empty
 * Explanation language control, because the list no longer carries it, and would keep
 * sending an instruction the prompt no longer understands. Same as source is the closest
 * behaviour: it writes the note in the language of the selected text, which for the owner's
 * English and Korean material is one of the two languages Bilingual produced.
 */
async function migrateBilingualExplanation(
  context: vscode.ExtensionContext
): Promise<void> {
  if (context.globalState.get<boolean>(BILINGUAL_EXPLANATION_MIGRATION, false)) return;
  const config = vscode.workspace.getConfiguration('kren');
  const inspected = config.inspect<string>('explanation.outputLanguage');
  const targets: Array<[unknown, vscode.ConfigurationTarget]> = [
    [inspected?.globalValue, vscode.ConfigurationTarget.Global],
    [inspected?.workspaceValue, vscode.ConfigurationTarget.Workspace],
    [inspected?.workspaceFolderValue, vscode.ConfigurationTarget.WorkspaceFolder]
  ];
  for (const [stored, scope] of targets) {
    if (stored === 'bilingual') {
      await config.update('explanation.outputLanguage', EXPLANATION_SAME_AS_SOURCE, scope);
    }
  }
  await context.globalState.update(BILINGUAL_EXPLANATION_MIGRATION, true);
}

/** Retrieve only models whose API metadata advertises Gemini bidirectional streaming. */
async function refreshGeminiLiveProfileModels(
  context: vscode.ExtensionContext
): Promise<GeminiModelOption[]> {
  const protections = geminiModelDiscoveryProtections();
  const fallback = geminiModelCatalog([], protections).live.map((model) =>
    (KNOWN_TUTOR_LIVE_MODEL_IDS as readonly string[]).includes(model.id)
      ? { ...model, liveOnly: true as const }
      : model
  );
  const { secretKey, setKeyCommand, keyHint, label } = geminiRefreshTarget(
    readPanelSettings().tutorLiveProfile === 'pro' ? 'alternate' : 'default');
  const key = await context.secrets.get(secretKey);
  if (!key) await showLookupError(missingSecretCredential(secretKey), undefined, false, true);
  if (!key) return fallback;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const models = await withKrenProgress(
      {
        title: `KREN: retrieving models for Gemini Live (${label})...`,
        cancellable: false
      },
      () => listGeminiLiveModels(key, controller.signal, keyHint, protections)
    );
    notify('information',
      `KREN found ${models.length} Gemini Live models available or retained for the ${label} profile. Open the Live model list to see them.`
    );
    return models;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      notify('error', 'KREN: Gemini Live model discovery timed out.');
    } else {
      await showLookupError(error);
    }
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

function geminiModelDiscoveryProtections(): GeminiModelCatalogProtections {
  const config = vscode.workspace.getConfiguration('kren');
  const textSettingKeys = [
    'gemini.model', 'gemini.alternateModel', 'gemini.alternateFallbackModel',
    'translation.model', 'translation.alternateModel', 'translation.fallbackModel',
    'explanation.model', 'explanation.alternateModel', 'explanation.fallbackModel',
    'rewrite.model', 'rewrite.alternateModel', 'rewrite.fallbackModel',
    'userDictionary.model', 'userDictionary.alternateModel', 'userDictionary.fallbackModel',
    'tutor.model', 'tutor.alternateModel', 'tutor.hintModel'
  ] as const;
  const textStoredIds = textSettingKeys.map((key) => config.get<string>(key, ''))
    .filter((id): id is string => Boolean(id));
  return {
    textStoredIds,
    textCustomIds: customModelIdentifiers(config.get<string>('gemini.customModels', '[]')),
    liveStoredIds: [config.get<string>('tutor.liveModel', TUTOR_DEFAULTS.configuration['tutor.liveModel'])],
    liveCustomIds: customModelIdentifiers(config.get<string>('tutor.liveCustomModels', TUTOR_DEFAULTS.configuration['tutor.liveCustomModels']))
  };
}

/**
 * Seed the new Live-only custom-model list from the old shared Gemini list at each stored
 * scope. A stored Live value, including an empty list after the reader removes everything,
 * is never overwritten, so the two lists stay independent after this one-way migration.
 */
async function migrateTutorLiveCustomModels(): Promise<void> {
  const config = vscode.workspace.getConfiguration('kren');
  const existing = config.inspect<string>('gemini.customModels');
  const live = config.inspect<string>('tutor.liveCustomModels');
  const targets: Array<[string | undefined, string | undefined, vscode.ConfigurationTarget]> = [
    [existing?.globalValue, live?.globalValue, vscode.ConfigurationTarget.Global],
    [existing?.workspaceValue, live?.workspaceValue, vscode.ConfigurationTarget.Workspace],
    [
      existing?.workspaceFolderValue,
      live?.workspaceFolderValue,
      vscode.ConfigurationTarget.WorkspaceFolder
    ]
  ];
  for (const [stored, liveStored, scope] of targets) {
    const migrated = migratedTutorLiveCustomModels(stored, liveStored);
    if (migrated !== undefined) {
      await config.update('tutor.liveCustomModels', migrated, scope);
    }
  }
}

/** Seed Live once from the tutor profile, because existing readers must keep their route. */
async function migrateTutorLiveGeminiProfile(): Promise<void> {
  const configs = vscode.workspace.workspaceFolders?.length
    ? vscode.workspace.workspaceFolders.map(folder => vscode.workspace.getConfiguration('kren', folder.uri))
    : [vscode.workspace.getConfiguration('kren')];
  const fields = ['globalValue', 'workspaceValue', 'workspaceFolderValue',
    'globalLanguageValue', 'workspaceLanguageValue', 'workspaceFolderLanguageValue'] as const;
  if (configs.some(config => {
    const stored = config.inspect<string>('tutor.liveGeminiProfile');
    return fields.some(field => stored?.[field] !== undefined);
  })) return;
  const config = vscode.workspace.getConfiguration('kren');
  const tutor = config.inspect<'standard' | 'pro'>('tutor.geminiProfile');
  const profile = tutor?.workspaceFolderLanguageValue ?? tutor?.workspaceFolderValue ??
    tutor?.workspaceLanguageValue ?? tutor?.workspaceValue ?? tutor?.globalLanguageValue ?? tutor?.globalValue ??
    config.get<'standard' | 'pro'>('tutor.geminiProfile', 'standard');
  await config.update('tutor.liveGeminiProfile', profile, vscode.ConfigurationTarget.Global);
}

/** Preserve explicit Fast thinking, copy legacy thinking with its scope, then retire both old keys. */
async function migrateTutorFastSettings(): Promise<void> {
  const configs = vscode.workspace.workspaceFolders?.length
    ? vscode.workspace.workspaceFolders.map(folder => vscode.workspace.getConfiguration('kren', folder.uri))
    : [vscode.workspace.getConfiguration('kren')];
  const scopes = [
    ['globalValue', vscode.ConfigurationTarget.Global],
    ['workspaceValue', vscode.ConfigurationTarget.Workspace],
    ['workspaceFolderValue', vscode.ConfigurationTarget.WorkspaceFolder]
  ] as const;
  const snapshots = configs.map(config => ({ config,
    thinking: config.inspect<string>('tutor.fallbackThinkingOrEffort'),
    model: config.inspect<string>('tutor.fallbackModel'),
    fast: config.inspect<string>('tutor.hintThinkingOrEffort') }));
  for (const [index, { config, thinking, model, fast }] of snapshots.entries()) {
    for (const [field, target] of scopes) {
      // Global and workspace values are shared by every folder, so update each only once.
      if (index > 0 && target !== vscode.ConfigurationTarget.WorkspaceFolder) continue;
      if (fast?.[field] === undefined && thinking?.[field] !== undefined) {
        await config.update('tutor.hintThinkingOrEffort', thinking[field], target);
      }
      if (thinking?.[field] !== undefined) await config.update('tutor.fallbackThinkingOrEffort', undefined, target);
      if (model?.[field] !== undefined) await config.update('tutor.fallbackModel', undefined, target);
    }
  }
}

/**
 * Move a stored `auto-en-ko` translation target to Korean, once.
 *
 * This replaces `migrateTranslationTargetToAutomatic`, which ran the other way and moved a
 * stored `ko` to `auto-en-ko` on 2026-08-20. That function is deleted rather than left
 * dormant: it is keyed on a global-state marker, so on a fresh install it would still fire
 * and write a value the Output language control no longer offers and the validator no
 * longer accepts.
 *
 * Korean is the replacement because it is what `auto-en-ko` produced for the owner's English
 * material, and it is the new default.
 */
async function migrateAutoTranslationTargetToKorean(
  context: vscode.ExtensionContext
): Promise<void> {
  if (context.globalState.get<boolean>(KOREAN_TRANSLATION_TARGET_MIGRATION, false)) return;
  const config = vscode.workspace.getConfiguration('kren');
  const inspected = config.inspect<string>('translation.targetLanguage');
  const targets: Array<[unknown, vscode.ConfigurationTarget]> = [
    [inspected?.globalValue, vscode.ConfigurationTarget.Global],
    [inspected?.workspaceValue, vscode.ConfigurationTarget.Workspace],
    [inspected?.workspaceFolderValue, vscode.ConfigurationTarget.WorkspaceFolder]
  ];
  for (const [stored, scope] of targets) {
    if (stored === 'auto-en-ko') {
      await config.update('translation.targetLanguage', DEFAULT_TRANSLATION_TARGET, scope);
    }
  }
  await context.globalState.update(KOREAN_TRANSLATION_TARGET_MIGRATION, true);
}

async function setGoogleCloudTranslationKey(context: vscode.ExtensionContext): Promise<void> {
  const stored = await setSecret(
    context,
    GOOGLE_CLOUD_TRANSLATION_KEY,
    'Enter your Google Cloud Translation API key'
  );
  if (!stored) return;
  await vscode.workspace
    .getConfiguration('kren')
    .update('translationProvider', 'googleCloudTranslation', vscode.ConfigurationTarget.Global);
  await context.globalState.update(CLOUD_DEFAULT_MIGRATION, true);
  notify('information',
    'Google Cloud Translation is now the Translate Selection provider.'
  );
}

export function deactivate(): void {
  lastResult = undefined;
  if (automaticGrammarTimer) clearTimeout(automaticGrammarTimer);
  automaticGrammarTimer = undefined;
  void disposeHarperGrammar();
}

export function readSelectedEditorPassage(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const selections = editor.selections.filter((selection) => !selection.isEmpty);
  if (selections.length !== 1 || !selections[0]) return undefined;
  const passage = editor.document.getText(selections[0]);
  return passage.trim() ? passage : undefined;
}

async function executeReadAloudSelection(context: vscode.ExtensionContext): Promise<void> {
  if (process.platform !== 'win32' || vscode.env.remoteName) {
    notify('information',
      'KREN Read Aloud currently requires a local Windows VS Code session.'
    );
    return;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    notify('information', 'Open an editor and select text first.');
    return;
  }
  const selections = editor.selections.filter((selection) => !selection.isEmpty);
  if (selections.length !== 1 || !selections[0]) {
    notify('information', 'Select one passage to read aloud.');
    return;
  }
  const rawText = editor.document.getText(selections[0]);
  const spokenText = prepareTextForSpeech(rawText);
  if (!spokenText) {
    notify('information',
      'KREN found no speakable sentence text after removing formatting markers.'
    );
    return;
  }
  await readAloudText(context, spokenText);
}

/**
 * `resultLanguage` is the language KREN already knows the text is in, when it knows it: a
 * rewrite reports the language it detected and the language it was asked to write in. It is
 * passed rather than re-derived, because detecting a language that is already recorded is
 * guessing at a known fact.
 */
async function readAloudText(
  _context: vscode.ExtensionContext,
  text: string,
  resultLanguage?: string,
  settingsSource: 'shared' | 'tutor' = 'shared',
  /** A voice for this one reading, such as the learner's in Replay all; settings are untouched. */
  edgeVoice?: string
): Promise<void | TutorSpeechFallback> {
  return speechCenter.speak(text, resultLanguage, settingsSource, edgeVoice);
}

function stopReadAloud(showStatus: boolean): boolean {
  const stoppedSpeech = speechCenter.stop();
  const stoppedWebview = resultsView.stopGeneratedAudio();
  const stopped = stoppedSpeech || stoppedWebview;
  if (stopped && showStatus) {
    void vscode.window.setStatusBarMessage('KREN: Read Aloud stopped.', 2500);
  }
  void vscode.commands.executeCommand('setContext', 'kren.readAloudActive', false);
  return stopped;
}

async function ensureEdgeTtsConsent(context: vscode.ExtensionContext): Promise<boolean> {
  if (context.globalState.get<boolean>(EDGE_TTS_CONSENT, false)) return true;
  const choice = await showKrenWarningMessage(
    'KREN Edge Online speech sends only the cleaned selected text to Microsoft\'s online Edge speech service through the unofficial edge-tts package. It uses no API key, but it is not an offline or Microsoft-supported extension API.',
    { modal: true },
    'Continue'
  );
  if (choice !== 'Continue') return false;
  await context.globalState.update(EDGE_TTS_CONSENT, true);
  return true;
}

async function executeGrammarCheck(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    notify('information', 'Open an editor and select English text first.');
    return;
  }
  const selections = editor.selections.filter((selection) => !selection.isEmpty);
  if (selections.length !== 1 || !selections[0]) {
    notify('information', 'Select one English passage to check.');
    return;
  }
  await checkGrammarRange(context, editor, new vscode.Range(
    selections[0].start,
    selections[0].end
  ), true, true);
}

/**
 * Runs the language-model pass beside Harper, or returns undefined when the user has not
 * turned it on or has no key for the chosen provider. It never throws: losing Harper's
 * local findings to a remote problem would be worse than the feature being unavailable.
 */
async function runSmartGrammarPass(
  context: vscode.ExtensionContext,
  selectedText: string,
  harperIssues: readonly GrammarIssue[],
  signal: AbortSignal
): Promise<(SmartGrammarOutcome & { credentialMissing?: boolean }) | undefined> {
  const config = vscode.workspace.getConfiguration('kren');
  if (!config.get<boolean>('grammar.smart', GRAMMAR_SMART_DEFAULT)) return undefined;
  const provider = config.get<KrenPanelSettings['userDictionaryProvider']>(
    'userDictionary.provider',
    'gemini'
  );
  if (provider !== 'gemini' && provider !== 'openai' && provider !== 'anthropic' && provider !== 'groq' && provider !== 'cloudflare') return undefined;
  const thinkingOrEffort = config.get<KrenPanelSettings['userDictionaryThinkingOrEffort']>(
    'userDictionary.thinkingOrEffort',
    'low'
  );
  const geminiProfile = config.get<KrenPanelSettings['userDictionaryProfile']>(
    'userDictionary.geminiProfile',
    'standard'
  );
  const model = featureModel(extensionRuntime(context), 'userDictionary', provider, geminiProfile, DEFAULT_GEMINI_MODEL);
  if (!model) return undefined;
  const secretKey = KREN_SECRET_KEYS[languageModelCredentialSlot(provider, geminiProfile)];
  const apiKey = await extensionRuntime(context).getSecret(secretKey);
  const accountId = provider === 'cloudflare' ? await extensionRuntime(context).getSecret(KREN_SECRET_KEYS.cloudflareAccountId) : undefined;
  if (!apiKey || provider === 'cloudflare' && !accountId) {
    const error = missingCredentialError(provider, geminiProfile, provider === 'cloudflare'
      ? [...(!accountId ? ['account ID'] : []), ...(!apiKey ? ['API token'] : [])] : undefined);
    await showLookupError(error, undefined, true);
    return { status: 'failed', reason: `${error.message} Only local findings are shown.`, credentialMissing: true };
  }
  // Credentials come first because an unavailable provider needs no consent yet.
  try {
    await ensureLanguageModelConsent(context, provider);
  } catch {
    return {
      status: 'failed',
      reason: 'Smart Grammar Check needs the provider terms accepted, so only local findings are shown.'
    };
  }
  const outcome = await runFeatureRequest({ runtime: extensionRuntime(context),
    route: { provider, model, thinkingOrEffort, geminiProfile,
      fallbackEnabled: config.get<boolean>('userDictionary.fallbackEnabled', false),
      fallbackModel: config.get<string>('userDictionary.fallbackModel', DEFAULT_GEMINI_MODEL).trim(),
      fallbackThinkingOrEffort: config.get<KrenPanelSettings['userDictionaryFallbackThinkingOrEffort']>('userDictionary.fallbackThinkingOrEffort', 'low') },
    signal, policy: CURRENT_REQUEST_POLICIES.grammar, thinking: { kind: 'grammar', text: selectedText }, geminiDefaultAttempts: 4,
    execute: async (route, mode, selectedSignal, _request, maxAttempts) => {
      await ensureLanguageModelConsent(context, route.provider, route.geminiProfile);
      const runtime = extensionRuntime(context);
      const key = route.provider === provider ? apiKey : await runtime.getSecret(KREN_SECRET_KEYS[languageModelCredentialSlot(route.provider, route.geminiProfile)]);
      const account = route.provider === 'cloudflare' ? route.provider === provider ? accountId : await runtime.getSecret(KREN_SECRET_KEYS.cloudflareAccountId) : undefined;
      if (!key || route.provider === 'cloudflare' && !account) throw missingCredentialError(route.provider, route.geminiProfile, route.provider === 'cloudflare'
        ? [...(!account ? ['account ID'] : []), ...(!key ? ['API token'] : [])] : undefined);
      return smartGrammarIssues(selectedText, { provider: route.provider, model: route.model, geminiProfile: route.geminiProfile,
        thinkingOrEffort: modeEffort(route.provider, route.model, mode, route.thinkingOrEffort), apiKey: key,
        accountId: account, maxAttempts, throwProviderErrors: true }, selectedSignal, fetch, harperIssues);
    }
  });
  if (outcome.type === 'accepted') return outcome.value;
  if (outcome.type === 'failed' && outcome.missingCredentials) {
    await showMissingCredentialNotice(outcome.missingCredentials, resultsView, '', true);
    return { status: 'failed', reason: presentRequestFailure(outcome).message, credentialMissing: true };
  }
  return { status: 'failed', reason: outcome.type === 'canceled'
    ? 'Smart Grammar Check was canceled or timed out, so only local findings are shown.'
    : `${presentRequestFailure(outcome).message} Only local findings are shown.` };

}

async function runGrammarOperation(
  context: vscode.ExtensionContext,
  selectedText: string,
  signal: AbortSignal,
  allowSmartGrammar: boolean
): Promise<KrenResult> {
  const result = await runKrenOperation(extensionRuntime(context), 'grammar', explicitTextSubmission(selectedText), signal);
  if (result.kind !== 'grammar') throw new Error('KREN received an invalid grammar result.');
  const smart = allowSmartGrammar
    ? await runSmartGrammarPass(context, selectedText, result.issues, signal)
    : undefined;
  signal.throwIfAborted();
  if (smart?.status === 'completed') {
    result.issues = mergeSmartGrammarIssues(result.issues, smart.issues, selectedText);
    result.smartModelId = smart.model;
  } else if (smart && !smart.credentialMissing) {
    // Without this the reason is computed and discarded, so a missing key, a timeout, a
    // provider failure, or a discarded rewrite all look like a clean local-only pass and
    // the user believes the model agreed with Harper.
    notify('information', smart.reason);
  }
  return result;
}

async function checkGrammarRange(
  context: vscode.ExtensionContext,
  editor: vscode.TextEditor,
  range: vscode.Range,
  /**
   * True only where the user started the check. It has no default, so a new caller has to
   * decide rather than inherit one. The automatic paragraph checker passes false and must
   * keep passing false: it runs while the user types, so a remote call there would send
   * the document continuously with nobody asking for it.
   */
  allowSmartGrammar: boolean,
  announce: boolean,
  showProgress = announce,
  publishPanel = true
): Promise<GrammarDiagnosticState | undefined> {
  const requestGeneration = publishPanel ? ++resultRequestGeneration : resultRequestGeneration;
  const selectedText = editor.document.getText(range);
  const config = vscode.workspace.getConfiguration('kren');
  const maxCharacters = config.get<number>('translation.maxCharacters', 5000);
  if (selectedText.length > maxCharacters) {
    notify('warning',
      `The selection has ${selectedText.length} characters; the configured maximum is ${maxCharacters}.`
    );
    return undefined;
  }
  const snapshot = {
    uri: editor.document.uri.toString(),
    version: editor.document.version,
    range,
    selectedText
  };
  let abortReason: 'cancelled' | 'timedOut' | undefined;
  try {
    const runCheck = async (token?: vscode.CancellationToken) => {
        const controller = new AbortController();
        const cancellation = token?.onCancellationRequested(() => {
          abortReason = 'cancelled';
          controller.abort();
        });
        const timeout = setTimeout(() => {
          abortReason = 'timedOut';
          controller.abort();
        }, config.get<number>('request.timeoutMs', 45000));
        try {
          return await runGrammarOperation(context, selectedText, controller.signal, allowSmartGrammar);
        } finally {
          clearTimeout(timeout);
          cancellation?.dispose();
        }
      };
    const result = showProgress
      ? await withKrenProgress(
        {
          title: 'KREN: checking grammar and spelling locally...',
          cancellable: true
        },
        token => runCheck(token)
      )
      : await runCheck();
    if (result.kind !== 'grammar') throw new Error('KREN received an invalid grammar result.');
    if ((publishPanel && requestGeneration !== resultRequestGeneration) ||
        editor.document.uri.toString() !== snapshot.uri ||
        editor.document.version !== snapshot.version ||
        editor.document.getText(snapshot.range) !== snapshot.selectedText) {
      notify('warning',
        'The checked selection changed before Grammar Check finished, so KREN discarded the findings.'
      );
      return undefined;
    }
    if (publishPanel) {
      lastResult = {
        uri: snapshot.uri,
        range: snapshot.range,
        selectedText: snapshot.selectedText,
        result
      };
      if (allowSmartGrammar) await resultsView.showResult(result, snapshot.selectedText, true);
      else resultsView.setResult(result, snapshot.selectedText, true);
    }
    const state = grammarCodeActions.setResult(
      editor.document,
      snapshot.range,
      snapshot.selectedText,
      result
    );
    // A found-issues notification was raised here until 2026-08-22. The owner asked for it
    // to go: the findings are already underlined in the editor and listed in the panel, so
    // the toast repeated what two surfaces were showing and had to be dismissed. The
    // clean-result notice stays, because nothing else on screen changes when a check finds
    // nothing, and silence there is indistinguishable from a check that never ran.
    if (announce && !result.issues.length) {
      notify('information', 'KREN: Harper found no spelling or grammar issues.');
    }
    return state;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      notify('information',
        abortReason === 'timedOut'
          ? 'KREN Grammar Check timed out while running locally.'
          : 'KREN Grammar Check was canceled.'
      );
      return undefined;
    }
    await showLookupError(error, () => executeGrammarCheck(context), true);
    return undefined;
  }
}

async function applyGrammarQuickFix(
  context: vscode.ExtensionContext,
  rawUri: unknown,
  rawGeneration: unknown,
  rawIssueId: unknown,
  rawSuggestionIndex: unknown
): Promise<void> {
  if (typeof rawUri !== 'string' || typeof rawGeneration !== 'number' ||
      typeof rawIssueId !== 'string' || typeof rawSuggestionIndex !== 'number' ||
      !Number.isInteger(rawGeneration) || !Number.isInteger(rawSuggestionIndex)) return;
  const state = grammarCodeActions.getState(rawUri, rawGeneration);
  const editor = vscode.window.activeTextEditor;
  if (!state || !editor || editor.document.uri.toString() !== rawUri) {
    notify('information', 'That KREN grammar finding is no longer current.');
    return;
  }
  if (editor.document.version !== state.documentVersion ||
      editor.document.getText(state.range) !== state.selectedText) {
    grammarCodeActions.clear(editor.document.uri);
    notify('warning',
      'The checked text changed, so KREN did not apply the correction. Run Grammar Check again.'
    );
    return;
  }
  const issue = state.result.issues.find((candidate) => candidate.id === rawIssueId);
  if (!issue?.suggestions[rawSuggestionIndex]) return;
  const corrected = applyGrammarChoices(state.result, [{
    issueId: rawIssueId,
    suggestionIndex: rawSuggestionIndex
  }]);
  const startOffset = editor.document.offsetAt(state.range.start);
  const applied = await editor.edit((editBuilder) => {
    editBuilder.replace(state.range, corrected);
  });
  if (!applied) {
    notify('error', 'VS Code could not apply the KREN grammar correction.');
    return;
  }
  const updatedRange = new vscode.Range(
    editor.document.positionAt(startOffset),
    editor.document.positionAt(startOffset + corrected.length)
  );
  editor.selection = new vscode.Selection(updatedRange.start, updatedRange.end);
  const refreshed = await checkGrammarRange(context, editor, updatedRange, false, false);
  if (!refreshed) return;
  const remaining = refreshed.result.issues.length;
  notify('information',
    remaining
      ? `KREN: Correction applied · ${remaining} possible issue${remaining === 1 ? '' : 's'} remaining.`
      : 'KREN: Correction applied · no remaining issues found.'
  );
}

async function showGrammarDetails(rawUri: unknown, rawGeneration: unknown): Promise<void> {
  if (typeof rawUri !== 'string' || typeof rawGeneration !== 'number' ||
      !Number.isInteger(rawGeneration)) return;
  const state = grammarCodeActions.getState(rawUri, rawGeneration);
  if (!state) {
    notify('information', 'That KREN grammar result is no longer current.');
    return;
  }
  lastResult = {
    uri: state.uri,
    range: state.range,
    selectedText: state.selectedText,
    result: state.result
  };
  await resultsView.showResult(state.result, state.selectedText, true);
}

async function manageGrammarFinding(
  context: vscode.ExtensionContext,
  rawUri: unknown,
  rawGeneration: unknown,
  rawIssueId: unknown,
  action: 'addWord' | 'ignore'
): Promise<void> {
  if (typeof rawUri !== 'string' || typeof rawGeneration !== 'number' ||
      typeof rawIssueId !== 'string' || !Number.isInteger(rawGeneration)) return;
  const state = grammarCodeActions.getState(rawUri, rawGeneration);
  const editor = vscode.window.activeTextEditor;
  if (!state || !editor || editor.document.uri.toString() !== rawUri ||
      editor.document.version !== state.documentVersion ||
      editor.document.getText(state.range) !== state.selectedText) {
    notify('information', 'That KREN grammar finding is no longer current.');
    return;
  }
  const issue = state.result.issues.find((candidate) => candidate.id === rawIssueId);
  if (!issue) return;
  try {
    await persistGrammarPreference(context, issue, action);
  } catch (error) {
    notify('error', `KREN could not update local grammar data: ${errorMessage(error)}`);
    return;
  }
  await checkGrammarRange(context, editor, state.range, false, false, false);
}

async function managePanelGrammarIssue(
  context: vscode.ExtensionContext,
  issueId: string,
  action: 'addWord' | 'ignore'
): Promise<void> {
  if (lastResult?.result.kind !== 'grammar') return;
  const issue = lastResult.result.issues.find((candidate) => candidate.id === issueId);
  if (!issue) return;
  try {
    await persistGrammarPreference(context, issue, action);
  } catch (error) {
    notify('error', `KREN could not update local grammar data: ${errorMessage(error)}`);
    return;
  }
  const editor = vscode.window.activeTextEditor;
  if (lastResult.uri && lastResult.range && editor &&
      editor.document.uri.toString() === lastResult.uri &&
      editor.document.getText(lastResult.range) === lastResult.selectedText) {
    await checkGrammarRange(context, editor, lastResult.range, false, false, false);
    return;
  }
  const controller = new AbortController();
  const result = await runKrenOperation(
    extensionRuntime(context),
    'grammar',
    explicitTextSubmission(lastResult.selectedText),
    controller.signal
  );
  if (result.kind !== 'grammar') return;
  lastResult = { selectedText: result.sourceText, result };
  resultsView.setResult(result, result.sourceText, false);
}

async function persistGrammarPreference(
  context: vscode.ExtensionContext,
  issue: Extract<KrenResult, { kind: 'grammar' }>['issues'][number],
  action: 'addWord' | 'ignore'
): Promise<void> {
  if (action === 'addWord') {
    const word = normalizeCustomWord(issue.original);
    if (!word) throw new Error('That finding is not a single dictionary word.');
    const words = await addHarperWord(word);
    await context.globalState.update(GRAMMAR_CUSTOM_WORDS, words);
    notify('information', `KREN: Added “${word}” to the local dictionary.`);
  } else {
    if (!issue.ignoreHash) throw new Error('That finding cannot be ignored.');
    const ignored = await ignoreHarperLint(issue.ignoreHash);
    await context.globalState.update(GRAMMAR_IGNORED_LINTS, ignored);
    notify('information', 'KREN: This finding will be ignored locally.');
  }
  resultsView.refresh();
}

async function clearGrammarCustomDictionary(context: vscode.ExtensionContext): Promise<void> {
  await clearHarperWords();
  await context.globalState.update(GRAMMAR_CUSTOM_WORDS, []);
  resultsView.refresh();
  notify('information', 'KREN local grammar dictionary cleared.');
}

async function clearIgnoredGrammarFindings(context: vscode.ExtensionContext): Promise<void> {
  await clearHarperIgnoredLints();
  await context.globalState.update(GRAMMAR_IGNORED_LINTS, '');
  resultsView.refresh();
  notify('information', 'KREN ignored grammar findings cleared.');
}

function ignoredLintCount(serialized: string): number {
  try {
    const parsed: unknown = JSON.parse(serialized || '[]');
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function scheduleAutomaticGrammarCheck(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument
): void {
  if (automaticGrammarTimer) clearTimeout(automaticGrammarTimer);
  const config = vscode.workspace.getConfiguration('kren');
  if (!config.get<boolean>('grammar.autoCheck', false)) return;
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document !== document || document.uri.scheme === 'output') return;
  const version = document.version;
  const delay = config.get<number>('grammar.autoCheckDelayMs', 900);
  automaticGrammarTimer = setTimeout(() => {
    automaticGrammarTimer = undefined;
    const currentEditor = vscode.window.activeTextEditor;
    if (!currentEditor || currentEditor.document !== document || document.version !== version) return;
    const range = currentParagraphRange(document, currentEditor.selection.active);
    if (range.isEmpty || !/\p{Script=Latin}/u.test(document.getText(range))) return;
    void checkGrammarRange(context, currentEditor, range, false, false, false, false);
  }, delay);
}

function currentParagraphRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range {
  let startLine = position.line;
  let endLine = position.line;
  while (startLine > 0 && document.lineAt(startLine - 1).text.trim()) startLine -= 1;
  while (endLine + 1 < document.lineCount && document.lineAt(endLine + 1).text.trim()) endLine += 1;
  const full = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
  const maximum = vscode.workspace.getConfiguration('kren').get<number>('translation.maxCharacters', 5000);
  if (document.getText(full).length <= maximum) return full;
  return document.lineAt(position.line).range;
}

async function executeLookup(
  context: vscode.ExtensionContext,
  hoverStore: HoverStore,
  operation: KrenOperation
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    notify('information', 'Open an editor and select text first.');
    return;
  }
  const nonEmptySelections = editor.selections.filter((selection) => !selection.isEmpty);
  if (nonEmptySelections.length !== 1) {
    notify('information', 'Select one word, phrase, or sentence first.');
    return;
  }

  const selection = nonEmptySelections[0];
  if (!selection) return;
  const rawText = editor.document.getText(selection);
  const config = vscode.workspace.getConfiguration('kren');
  const maxCharacters = config.get<number>('translation.maxCharacters', 5000);
  if (rawText.length > maxCharacters) {
    notify('warning',
      `The selection has ${rawText.length} characters; the configured maximum is ${maxCharacters}.`
    );
    return;
  }

  const snapshot = {
    uri: editor.document.uri.toString(),
    version: editor.document.version,
    range: new vscode.Range(selection.start, selection.end),
    selectedText: rawText
  };
  const requestGeneration = ++resultRequestGeneration;
  const abort: AbortReasonBox = {};

  try {
    const result = await runOperationWithProgress(context, operation, rawText, abort);

    if (
      requestGeneration !== resultRequestGeneration ||
      editor.document.uri.toString() !== snapshot.uri ||
      editor.document.version !== snapshot.version ||
      editor.document.getText(snapshot.range) !== snapshot.selectedText
    ) {
      return;
    }

    lastResult = {
      uri: snapshot.uri,
      range: snapshot.range,
      selectedText: snapshot.selectedText,
      result
    };
    hoverStore.set(editor.document, snapshot.range, result);

    /*
     * The clipboard route exists so a Minimal or Full Rewrite can be pasted without the panel
     * taking the reader's attention. It returns before setResult, which sets the active screen
     * and re-renders, and before showResult, which reveals the view: either would pull the
     * reader out of whatever they were looking at, which is the thing this option avoids.
     * lastResult and the hover are set above, so Copy, Replace, and the hover card still work.
     *
     * If the copy yields nothing the route is abandoned rather than reported as done, because
     * an empty clipboard and a silent panel together would lose the result entirely.
     */
    const copyToClipboardEnabled = config.get<boolean>('rewrite.copyToClipboard', false);
    if (result.kind === 'rewrite') {
      outputChannel.appendLine(
        describeClipboardDecision(operation, copyToClipboardEnabled, result)
      );
    }
    if (shouldCopyRewriteToClipboard(operation, copyToClipboardEnabled)) {
      const clipboardText = rewriteClipboardText(result, operation);
      if (clipboardText) {
        await copyTextResult(clipboardText);
        /*
         * setResult and not showResult. setResult renders, so the panel holds the current
         * result and cannot show a stale one; showResult also reveals, which is what pulled
         * the reader out of whatever they were working in. Silently updated, never surfaced.
         */
        resultsView.setResult(result, snapshot.selectedText, true, operation);
        notify('information', `KREN: ${REPLAY_SUBJECTS[operation]} copied. Paste with Ctrl+V.`);
        return;
      }
    }

    resultsView.setResult(result, snapshot.selectedText, true, operation);

    if (result.kind === 'rewrite' || result.kind === 'grammar') {
      await resultsView.showResult(result, snapshot.selectedText, true, operation);
    } else {
      await displayResult(result);
    }
  } catch (error) {
    if (reportAbort(error, operation, abort.reason)) return;
    await showLookupError(error, () => executeLookup(context, hoverStore, operation), true);
  }
}

interface AbortReasonBox {
  reason?: 'cancelled' | 'timedOut';
}

/**
 * One run of one operation, with the progress notice, the cancel token, and the timeout.
 *
 * Extracted on 2026-08-22 when the Settings apply bar needed a second caller. The timeout
 * and the abort reason were written out once inside `executeLookup`, and a second copy is
 * how one path silently acquires a different timeout from the one the setting names.
 */
async function runOperationWithProgress(
  context: vscode.ExtensionContext,
  operation: KrenOperation,
  text: string,
  abort: AbortReasonBox,
  retry = false
): Promise<KrenResult> {
  return withKrenProgress(
    {
      title: progressTitle(operation),
      cancellable: true
    },
    async token => {
      const timeoutMs = vscode.workspace.getConfiguration('kren')
        .get<number>('request.timeoutMs', 45000);
      const controller = new AbortController();
      const cancellation = token?.onCancellationRequested(() => {
        abort.reason ??= 'cancelled';
        controller.abort();
      });
      const timeout = setTimeout(() => {
        abort.reason ??= 'timedOut';
        controller.abort();
      }, timeoutMs);
      try {
        return await runKrenOperation(
          extensionRuntime(context),
          operation,
          { ...explicitTextSubmission(text), retry },
          controller.signal
        );
      } finally {
        clearTimeout(timeout);
        cancellation?.dispose();
      }
    }
  );
}

function reportAbort(
  error: unknown,
  operation: KrenOperation,
  reason: 'cancelled' | 'timedOut' | undefined
): boolean {
  if (!(error instanceof Error) || error.name !== 'AbortError') return false;
  notify('information', operation === 'grammar'
    ? reason === 'timedOut'
      ? 'KREN Grammar Check timed out while running locally.'
      : 'KREN Grammar Check was canceled.'
    : reason === 'timedOut'
      ? 'KREN translation timed out. Try again, choose Gemini 3.1 Flash-Lite, or increase kren.request.timeoutMs.'
      : 'KREN translation was canceled.');
  return true;
}

/**
 * Produces the result on screen again, with the settings as they now stand.
 *
 * The text comes from the panel's own record of what was submitted, not from the editor, so
 * this works after the selection has been lost. Replacement is offered again only when the
 * recorded range still holds exactly the text that was submitted, which is the same test
 * `executeLookup` applies before it stores a result at all.
 */
async function rerunOperation(
  context: vscode.ExtensionContext,
  hoverStore: HoverStore,
  operation: KrenOperation,
  sourceText: string
): Promise<void> {
  const requestGeneration = ++resultRequestGeneration;
  const abort: AbortReasonBox = {};
  try {
    const result = await runOperationWithProgress(context, operation, sourceText, abort, true);
    if (requestGeneration !== resultRequestGeneration) return;
    // A clipboard lookup records no range, so `range` and `uri` are both optional here and
    // an undefined range must not be read as an intact one.
    const previous = lastResult;
    const range = previous?.range;
    const editor = vscode.window.activeTextEditor;
    const intact = previous !== undefined && range !== undefined && editor !== undefined &&
      editor.document.uri.toString() === previous.uri &&
      previous.selectedText === sourceText &&
      editor.document.getText(range) === sourceText;
    if (intact && previous && range && editor) {
      lastResult = { ...previous, result };
      hoverStore.set(editor.document, range, result);
    } else {
      lastResult = { selectedText: sourceText, result };
    }
    await resultsView.showResult(result, sourceText, intact, operation);
  } catch (error) {
    if (reportAbort(error, operation, abort.reason)) return;
    await showLookupError(error, () => rerunOperation(context, hoverStore, operation, sourceText), true);
  }
}

async function executeAddToUserDictionary(context: vscode.ExtensionContext): Promise<void> {
  if (!vscode.workspace.getConfiguration('kren').get<boolean>('userDictionary.enabled', false)) {
    notify('information',
      'Enable User Dictionary in KREN Settings before adding an entry.'
    );
    return;
  }
  const editor = vscode.window.activeTextEditor;
  const selections = editor?.selections.filter((selection) => !selection.isEmpty) ?? [];
  if (!editor || selections.length !== 1 || !selections[0]) {
    const selected = await showKrenInformationMessage(
      'Select one word or phrase to add to User Dictionary.',
      'Open User Dictionary'
    );
    if (selected === 'Open User Dictionary') await openUserDictionary();
    return;
  }
  const expression = editor.document.getText(selections[0]);
  const maximum = vscode.workspace.getConfiguration('kren').get<number>(
    'translation.maxCharacters',
    5000
  );
  if (expression.length > maximum) {
    notify('warning',
      `The selected expression has ${expression.length} characters; the configured maximum is ${maximum}.`
    );
    return;
  }
  // Pre-flight duplicate check, before any provider request. The save path already
  // refuses a duplicate, but only after a generation has been paid for and waited on.
  //
  // Matched on the normalized term alone, deliberately. The authoritative key is language
  // plus term, and the language is auto-detected during generation, so it does not exist
  // yet. That makes this a warning rather than a refusal: the same spelling in another
  // language is a legitimate separate entry, so Add anyway has to remain available.
  try {
    const existing = (await userDictionaryService.list()).filter(
      (entry) => entry.normalizedTerm === normalizeUserDictionaryTerm(expression)
    );
    if (existing.length > 0) {
      const choice = await showKrenInformationMessage(
        'This expression is already in your User Dictionary.',
        'Open existing',
        'Add anyway'
      );
      if (choice === 'Open existing') {
        await openUserDictionary();
        return;
      }
      if (choice !== 'Add anyway') return;
    }
  } catch {
    // A dictionary that cannot be read is reported by the save path, which fails closed
    // and preserves the file. Blocking the capture here would turn a readable-store
    // problem into an unusable feature, so fall through and let the real gate speak.
  }

  try {
    const draft = await generateUserDictionaryDraft(
      context,
      expression,
      false,
      undefined,
      smartWordCaptureSentence(editor, selections[0])
    );
    await resultsView.showUserDictionaryDraft(draft);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      notify('information',
        'User Dictionary generation was canceled. Nothing was saved.'
      );
      return;
    }
    await resultsView.showUserDictionaryGenerationFailure();
    await showLookupError(error, () => executeAddToUserDictionary(context), true);
  }
}

/**
 * The sentence around a selection, when Smart Word Capture is on and a model will actually
 * run. Both switches are checked here rather than only downstream: with User Dictionary off
 * no model is asked anything, and reading a line of the reader's document to send it nowhere
 * is the wrong trade at any price. VS Code has no manual capture mode, so the two switches
 * above are the whole gate; the Office task pane does have one and needs a third check.
 *
 * The paragraph is assembled from the editor and the sentence is cut from it by core, so
 * Word and PowerPoint reach the same answer from their own paragraph text rather than from
 * a second copy of the rule written here.
 */
function smartWordCaptureSentence(
  editor: vscode.TextEditor,
  selection: vscode.Selection
): string | undefined {
  const config = vscode.workspace.getConfiguration('kren');
  if (!config.get<boolean>('userDictionary.enabled', false)) return undefined;
  if (!config.get<boolean>('userDictionary.smartWordCapture', true)) return undefined;

  const document = editor.document;
  let startLine = selection.start.line;
  let endLine = selection.end.line;
  while (startLine > 0 && document.lineAt(startLine - 1).text.trim()) startLine -= 1;
  while (endLine + 1 < document.lineCount && document.lineAt(endLine + 1).text.trim()) {
    endLine += 1;
  }
  const block = new vscode.Range(
    startLine,
    0,
    endLine,
    document.lineAt(endLine).text.length
  );
  const offset = document.offsetAt(selection.start) - document.offsetAt(block.start);
  return sentenceAroundSelection(document.getText(block), offset);
}

async function generateUserDictionaryDraft(
  context: vscode.ExtensionContext,
  expression: string,
  termSuppliedByUser: boolean,
  captureMode?: UserDictionaryProviderCaptureMode,
  contextSentence?: string,
  retry = false
): Promise<UserDictionaryCaptureResult | UserDictionaryEntryV1> {
  return withKrenProgress(
    {
      title: 'KREN: generating an editable User Dictionary draft…',
      cancellable: true
    },
    async token => {
      const controller = new AbortController();
      const timeoutMs = vscode.workspace.getConfiguration('kren').get<number>(
        'request.timeoutMs',
        45000
      );
      const cancellation = token?.onCancellationRequested(() => controller.abort());
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await runUserDictionaryCapture(
          extensionRuntime(context),
          expression,
          controller.signal,
          captureMode,
          termSuppliedByUser,
          contextSentence,
          retry
        );
      } finally {
        clearTimeout(timeout);
        cancellation?.dispose();
      }
    }
  );
}

async function regenerateUserDictionaryDraft(
  context: vscode.ExtensionContext,
  expression: string,
  captureMode: UserDictionaryCaptureMode
): Promise<UserDictionaryCaptureResult | UserDictionaryEntryV1 | undefined> {
  if (captureMode === 'manual') {
    notify('information',
      'Manual or imported entries cannot be regenerated until a language-model capture mode is selected.'
    );
    return undefined;
  }
  const confirmed = await showKrenWarningMessage(
    'Regenerate this User Dictionary draft and discard its unsaved edits?',
    { modal: true },
    'Regenerate'
  );
  return confirmed === 'Regenerate'
    ? generateUserDictionaryDraft(context, expression, true, captureMode, undefined, true)
    : undefined;
}

async function openUserDictionary(): Promise<void> {
  if (!vscode.workspace.getConfiguration('kren').get<boolean>('userDictionary.enabled', false)) {
    notify('information',
      'Enable User Dictionary in KREN Settings before opening it.'
    );
    return;
  }
  try {
    await resultsView.showUserDictionary();
  } catch (error) {
    await showLookupError(error);
  }
}

async function deleteUserDictionaryEntry(id: string): Promise<UserDictionaryEntryV1[]> {
  const confirmed = await showKrenWarningMessage(
    'Delete this User Dictionary entry?',
    { modal: true },
    'Delete'
  );
  if (confirmed !== 'Delete') return userDictionaryService.list();
  return userDictionaryService.delete(id);
}

async function deleteUserDictionaryEntries(
  ids: readonly string[]
): Promise<UserDictionaryEntryV1[] | undefined> {
  if (ids.length === 0) return userDictionaryService.list();
  const confirmed = await showKrenWarningMessage(
    `Delete the ${ids.length} selected User Dictionary entries?`,
    { modal: true },
    'Delete selected entries'
  );
  return confirmed === 'Delete selected entries'
    ? userDictionaryService.deleteMany(ids)
    : undefined;
}

async function confirmUserDictionaryPurge(
  preview: UserDictionaryPurgePreview
): Promise<UserDictionaryEntryV1[] | undefined> {
  if (preview.count === 0) return undefined;
  if (requiresRemoveAllConfirmation(preview.selection)) {
    const typed = await vscode.window.showInputBox({
      title: 'Remove every User Dictionary entry',
      prompt: `This removes all ${preview.count} previewed entries. Type REMOVE ALL to continue.`,
      placeHolder: 'REMOVE ALL',
      ignoreFocusOut: true,
      validateInput: (value) => value === 'REMOVE ALL'
        ? undefined
        : 'Type REMOVE ALL exactly. Age-based purge confirmation cannot satisfy this step.'
    });
    if (typed !== 'REMOVE ALL') return undefined;
  } else {
    const confirmed = await showKrenWarningMessage(
      `Delete exactly the ${preview.count} entries listed in the purge preview?`,
      { modal: true },
      'Delete previewed entries'
    );
    if (confirmed !== 'Delete previewed entries') return undefined;
  }
  return userDictionaryService.confirmPurge(preview);
}

async function previewUserDictionaryImport(): Promise<UserDictionaryImportPreview | undefined> {
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    title: 'Preview User Dictionary import',
    filters: {
      'User Dictionary backups': ['json', 'md', 'markdown']
    }
  });
  const source = selected?.[0];
  if (!source) return undefined;
  const extension = path.extname(source.fsPath).toLocaleLowerCase('und');
  const format: UserDictionaryExportFormat = extension === '.md' || extension === '.markdown'
    ? 'markdown'
    : 'json';
  const content = await readFile(source.fsPath, 'utf8');
  return userDictionaryService.previewImport(
    content,
    format,
    vscode.workspace.getConfiguration('kren').get<number>(
      'userDictionary.maxImportEntries',
      USER_DICTIONARY_MAX_IMPORT_ENTRIES
    )
  );
}

async function exportUserDictionary(
  format: UserDictionaryExportFormat,
  entryIds?: readonly string[]
): Promise<void> {
  const entries = await userDictionaryService.list();
  const requested = entryIds ? new Set(entryIds) : undefined;
  const selected = entryIds
    ? entries.filter((entry) => requested?.has(entry.id))
    : entries;
  const extension = format === 'json' ? 'json' : 'md';
  const destination = await vscode.window.showSaveDialog({
    title: format === 'json'
      ? 'Export lossless User Dictionary JSON'
      : 'Export human-readable, lossy User Dictionary Markdown',
    saveLabel: 'Export',
    filters: format === 'json'
      ? { 'JSON backup': ['json'] }
      : { 'Markdown document': ['md'] },
    defaultUri: vscode.Uri.file(`kren-user-dictionary.${extension}`)
  });
  if (!destination) return;
  const store = { schemaVersion: 1 as const, entries: selected };
  const content = format === 'json'
    ? exportUserDictionaryJson(store)
    : exportUserDictionaryMarkdown(store);
  await writeFile(destination.fsPath, content, 'utf8');
  notify('information',
    `Exported ${selected.length} User Dictionary entr${selected.length === 1 ? 'y' : 'ies'} as ${format === 'json' ? 'lossless JSON' : 'lossy Markdown'}.`
  );
}

// package.json declares kren.grammar.smart with a default of true, so VS Code returns
// true when the setting is unset and this fallback only fires if the contribution is
// missing. Three call sites passed false, which contradicted the manifest and told every
// reader the feature was off by default when it is on.
const GRAMMAR_SMART_DEFAULT = true;

async function executeClipboardLookup(context: vscode.ExtensionContext): Promise<void> {
  const rawText = await vscode.env.clipboard.readText();
  const config = vscode.workspace.getConfiguration('kren');
  const maxCharacters = config.get<number>('translation.maxCharacters', 5000);

  const preferredRewrite = config.get<QuickMenuRewriteVariantId>(
    'rewrite.quickMenuVariant',
    ALL_REWRITE_VARIANTS_ID
  );
  const rewriteItems: Array<{ label: string; operation: KrenOperation; id: string }> = [
    {
      label: '$(edit) Rewrite Text: Both Variants',
      operation: 'rewrite',
      id: ALL_REWRITE_VARIANTS_ID
    },
    ...REWRITE_VARIANT_LIST.map(({ id, label, operation, quickPickIcon }) => ({
      label: `${quickPickIcon} Rewrite Text: ${label}`,
      operation,
      id
    }))
  ];
  rewriteItems.sort((left, right) =>
    left.id === preferredRewrite ? -1 : right.id === preferredRewrite ? 1 : 0
  );
  const pickerItems: Array<
    { label: string; operation: KrenOperation } |
    { label: string; command: string } |
    { label: string; userDictionaryCapture: true }
  > = [
      { label: '$(book) English Dictionary Search', operation: 'englishDictionary' as const },
      { label: '$(symbol-keyword) Synonyms Search', operation: 'synonyms' as const },
      { label: '$(heart) Medical Dictionary Search', operation: 'medical' as const },
      { label: '$(book) Korean Dictionary Search', operation: 'koreanDictionary' as const },
      { label: '$(globe) Translate', operation: 'translate' as const },
      { label: '$(comment-discussion) Explain Meaning or Nuance', operation: 'explain' as const },
      {
        // Only offline when Smart Grammar Check is off. With it on the checked text goes to
        // the configured provider, so the label said the opposite of what the action did.
        label: config.get<boolean>('grammar.smart', GRAMMAR_SMART_DEFAULT)
          ? '$(checklist) Grammar Check (Harper and Smart Grammar Check)'
          : '$(checklist) Grammar Check (offline)',
        operation: 'grammar' as const
      },
      ...(config.get<boolean>('userDictionary.enabled', false)
        ? [{
          label: '$(notebook) Add Clipboard Expression to User Dictionary',
          userDictionaryCapture: true as const
        }]
        : []),
      ...rewriteItems,
      { label: '$(settings-gear) Configure Rewrite Gemini Profile', command: 'kren.configureRewriteGeminiProfile' as const },
      { label: '$(settings-gear) Configure Languages', command: 'kren.configureLanguages' as const },
      { label: '$(layout-sidebar-right) Show KREN Secondary Sidebar', command: 'kren.showResults' as const },
      { label: '$(close) Close KREN Panel', command: 'kren.hideResults' as const },
      { label: '$(gear) Open KREN Settings', command: 'kren.openPanelSettings' as const }
    ];
  const selected = await vscode.window.showQuickPick(
    pickerItems,
    {
      title: `KREN: clipboard: ${clipboardPreview(rawText)}`,
      placeHolder: 'Choose a clipboard action or manage the KREN Secondary Sidebar'
    }
  );
  if (!selected) return;
  if ('userDictionaryCapture' in selected) {
    if (!rawText.trim()) {
      notify('information', 'Copy a word or phrase first.');
      return;
    }
    if (rawText.length > maxCharacters) {
      notify('warning',
        `The clipboard has ${rawText.length} characters; the configured maximum is ${maxCharacters}.`
      );
      return;
    }
    try {
      const draft = await generateUserDictionaryDraft(context, rawText, false);
      await resultsView.showUserDictionaryDraft(draft);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        notify('information',
          'User Dictionary generation was canceled. Nothing was saved.'
        );
        return;
      }
      await showLookupError(error, () => executeClipboardLookup(context), true);
    }
    return;
  }
  if (!('operation' in selected)) {
    await vscode.commands.executeCommand(selected.command);
    return;
  }
  const selectedOperation = selected.operation;
  if (!rawText.trim()) {
    notify('information', 'Copy a word, phrase, or sentence first.');
    return;
  }
  if (rawText.length > maxCharacters) {
    notify('warning',
      `The clipboard has ${rawText.length} characters; the configured maximum is ${maxCharacters}.`
    );
    return;
  }

  const requestGeneration = ++resultRequestGeneration;
  let abortReason: 'cancelled' | 'timedOut' | undefined;
  try {
    const result = await withKrenProgress(
      {
        title: progressTitle(selectedOperation),
        cancellable: true
      },
      async token => {
        const controller = new AbortController();
        const cancellation = token?.onCancellationRequested(() => {
          if (!abortReason) abortReason = 'cancelled';
          controller.abort();
        });
        const timeout = setTimeout(() => {
          if (!abortReason) abortReason = 'timedOut';
          controller.abort();
        }, config.get<number>('request.timeoutMs', 45000));
        try {
          if (selectedOperation === 'grammar') return await runGrammarOperation(context, rawText, controller.signal, true);
          return await runKrenOperation(
            extensionRuntime(context),
            selectedOperation,
            explicitTextSubmission(rawText),
            controller.signal
          );
        } finally {
          clearTimeout(timeout);
          cancellation?.dispose();
        }
      }
    );
    if (requestGeneration !== resultRequestGeneration) return;
    lastResult = { selectedText: rawText, result };

    /*
     * The same clipboard route as the editor path in executeLookup. It is repeated here rather
     * than shared because the two functions differ in everything around it, and it is four
     * lines; what must not differ is the decision, which both take from shouldCopyRewriteToClipboard.
     *
     * This is the path the owner actually uses. Four rounds of this feature were fixed in the
     * editor path only, because the status bar Quick Pick reaches runKrenOperation directly and
     * never touches executeLookup.
     */
    const clipboardEnabled = config.get<boolean>('rewrite.copyToClipboard', false);
    if (result.kind === 'rewrite') {
      outputChannel.appendLine(
        describeClipboardDecision(selectedOperation, clipboardEnabled, result)
      );
    }
    if (shouldCopyRewriteToClipboard(selectedOperation, clipboardEnabled)) {
      const clipboardText = rewriteClipboardText(result, selectedOperation);
      if (clipboardText) {
        await copyTextResult(clipboardText);
        // setResult renders without revealing, so the panel is current and stays where it is.
        resultsView.setResult(result, rawText, false, selectedOperation);
        notify('information', `KREN: ${REPLAY_SUBJECTS[selectedOperation]} copied. Paste with Ctrl+V.`);
        return;
      }
    }

    await resultsView.showResult(result, rawText, false, selectedOperation);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      notify('information',
        abortReason === 'timedOut' ? 'KREN request timed out.' : 'KREN request was canceled.'
      );
      return;
    }
    await showLookupError(error, () => executeClipboardLookup(context), true);
  }
}

function clipboardPreview(text: string): string {
  const compact = text.trim().replace(/\s+/gu, ' ');
  return compact.length > 70 ? `${compact.slice(0, 67)}…` : compact;
}

function extensionRuntime(context: vscode.ExtensionContext): KrenRuntime {
  return {
    log: line => outputChannel.appendLine(line),
    providerSwitchNotice: line => resultsView.showProviderSwitchNotice(line),
    getSecret: async (key) => context.secrets.get(key),
    getSetting: <T>(key: string, fallback: T): T =>
      normalizeModelSetting(key, vscode.workspace.getConfiguration('kren').get<T>(key, fallback)),
    reserveCloudCharacters: (characters) => cloudTranslationUsage.reserve(characters),
    beforeGeminiRequest: (profile) => ensureGeminiConsent(context, profile),
    beforeLanguageModelRequest: (provider, profile) =>
      ensureLanguageModelConsent(context, provider, profile)
  };
}

async function ensureLanguageModelConsent(
  context: vscode.ExtensionContext,
  provider: 'gemini' | 'openai' | 'anthropic' | 'groq' | 'cloudflare',
  profile: 'standard' | 'pro' = 'standard'
): Promise<void> {
  if (provider === 'gemini') return ensureGeminiConsent(context, profile);
  if (provider === 'groq' || provider === 'cloudflare') {
    const consentKey = `kren.${provider}.consent.v1`;
    if (context.globalState.get<boolean>(consentKey, false)) return;
    const name = provider === 'groq' ? 'Groq' : 'Cloudflare Workers AI';
    const accepted = await showKrenWarningMessage(
      `${name} receives the text you explicitly submit and KREN instructions for the selected feature. Tutor requests include the lesson, practice answer, or displayed conversation needed for that action. Recordings you send for transcription are sent as audio. Free daily or per-minute limits apply; paid usage can incur charges. Review KREN menu, Manual and the provider terms before submitting sensitive material.`,
      { modal: true }, 'I Understand');
    if (accepted !== 'I Understand') throw new Error(`${name} request canceled.`);
    await context.globalState.update(consentKey, true);
    return;
  }
  const consentKey = provider === 'openai' ? OPENAI_CONSENT : ANTHROPIC_CONSENT;
  if (context.globalState.get<boolean>(consentKey, false)) return;
  const providerName = provider === 'openai' ? 'OpenAI' : 'Anthropic';
  const retention = provider === 'openai'
    ? 'OpenAI states that API data is not used for training by default, but standard abuse-monitoring logs may be retained for 30 days. KREN sets store to false; that is not a zero-retention guarantee.'
    : 'Anthropic states that standard API inputs and outputs are normally deleted within 30 days, with longer retention possible for policy enforcement or law. Zero data retention requires a separate approved agreement.';
  const accepted = await showKrenWarningMessage(
    `${providerName} API use can incur charges. ${retention} KREN sends only the text you explicitly submit plus fixed instructions and selected KREN settings. KREN does not send the surrounding file, workspace, clipboard history, or previous results, and it does not track or cap provider spending.`,
    { modal: true },
    'I Understand'
  );
  if (accepted !== 'I Understand') throw new Error(`${providerName} request canceled.`);
  await context.globalState.update(consentKey, true);
}

async function ensureGeminiConsent(
  context: vscode.ExtensionContext,
  profile: 'standard' | 'pro' = 'standard'
): Promise<void> {
  if (context.globalState.get<boolean>(GEMINI_CONSENT, false)) return;
  const fallbackNotice = ' If model fallback is enabled, the same text may be resubmitted to the configured fallback model after exhausted 429, 503, or 504 retries or an unusable structured response.';
  const accepted = await showKrenWarningMessage(
    `Google's current Gemini API Terms require API users to be at least 18 and use Gemini for professional or business purposes. Gemini is available only in regions listed by Google, with additional regional restrictions. Model access, quotas, pricing, data use, and permitted use vary by Google project and region. By continuing, you confirm that you are at least 18 and will use your own eligible Google project in compliance with the current terms. KREN sends only the text you explicitly submit plus fixed instructions and selected settings.${fallbackNotice} Do not submit secrets, personal data, confidential source code, or unpublished documents unless Google's current terms and controls are acceptable.`,
    { modal: true },
    'I Am 18+ and Confirm',
    'Open Gemini API Terms'
  );
  if (accepted === 'Open Gemini API Terms') {
    await vscode.env.openExternal(vscode.Uri.parse('https://ai.google.dev/gemini-api/terms'));
    return ensureGeminiConsent(context, profile);
  }
  if (accepted !== 'I Am 18+ and Confirm') throw new Error('Gemini request canceled.');
  await context.globalState.update(GEMINI_CONSENT, true);
}

async function configureRewriteGeminiProfile(
  context: vscode.ExtensionContext
): Promise<void> {
  const selected = await vscode.window.showQuickPick(
    [
      {
        label: '$(sparkle) Gemini Free Tier profile',
        description: 'Uses the user-supplied Free Tier key and kren.gemini.model',
        profile: 'standard' as const
      },
      {
        label: '$(star-full) Gemini Paid profile',
        description: 'Uses an optional user-supplied Gemini Paid key and kren.gemini.alternateModel',
        profile: 'pro' as const
      }
    ],
    {
      title: 'Choose the Gemini profile used by Rewrite Text',
      placeHolder: 'Access and billing are determined by the Google project associated with each key'
    }
  );
  if (!selected) return;
  if (selected.profile === 'pro') {
    const thinking = await vscode.window.showQuickPick(
      [
        {
          label: 'Low (Recommended)',
          description: 'Lowest latency and thinking-token use; suitable for rewriting',
          level: 'low' as const
        },
        {
          label: 'Medium',
          description: 'More reasoning with additional latency and cost',
          level: 'medium' as const
        },
        {
          label: 'High',
          description: 'Maximum reasoning depth, latency, and potential cost',
          level: 'high' as const
        }
      ],
      {
        title: 'Choose the Gemini Paid profile thinking level',
        placeHolder: 'Supported levels depend on the configured model'
      }
    );
    if (!thinking) return;
    await vscode.workspace.getConfiguration('kren').update(
      'gemini.alternateThinkingLevel',
      thinking.level,
      vscode.ConfigurationTarget.Global
    );
  }
  await vscode.workspace.getConfiguration('kren').update(
    'rewrite.geminiProfile',
    selected.profile,
    vscode.ConfigurationTarget.Global
  );
  const secretKey = selected.profile === 'pro' ? GEMINI_PRO_KEY : GEMINI_KEY;
  const existingKey = await context.secrets.get(secretKey);
  if (!existingKey) {
    await vscode.commands.executeCommand(
      selected.profile === 'pro' ? 'kren.setGeminiProApiKey' : 'kren.setGeminiApiKey'
    );
  }
  notify('information',
    `Rewrite Text now uses the Gemini ${selected.profile === 'pro' ? 'Paid' : 'Free Tier'} profile.`
  );
}

async function displayResult(result: KrenResult): Promise<void> {
  const mode = vscode.workspace.getConfiguration('kren').get<string>('display.mode', 'hover');
  if (mode === 'details') {
    await resultsView.showResult(result, lastResult?.selectedText ?? result.sourceText, Boolean(lastResult?.range));
    return;
  }
  if (mode === 'quickPick') {
    await showResultQuickPick(result);
    return;
  }
  await vscode.commands.executeCommand('editor.action.showHover');
}

async function showResultQuickPick(result: KrenResult): Promise<void> {
  const summary = resultText(result);
  const actions: Array<{ label: string; action: 'copy' | 'replace' | 'details' }> = [
    { label: '$(copy) Copy result', action: 'copy' }
  ];
  if (result.kind !== 'dictionary' && result.kind !== 'thesaurus') {
    actions.push({ label: '$(replace) Replace selection', action: 'replace' });
  }
  actions.push({ label: '$(output) Open details', action: 'details' });
  const action = await vscode.window.showQuickPick(
    actions,
    {
      title: `KREN · ${summary}`,
      placeHolder: `Provider: ${providerLabel(result.providerId)}`
    }
  );
  if (action?.action === 'copy') await copyLastResult();
  if (action?.action === 'replace') await replaceLastResult();
  if (action?.action === 'details') showDetails();
}

async function copyLastResult(): Promise<void> {
  if (!lastResult) {
    notify('information', 'KREN has no result to copy yet.');
    return;
  }
  await copyTextResult(resultText(lastResult.result));
}

// No confirmation is raised here. The panel's copy buttons confirm themselves by changing
// their own label, which puts the feedback on the control the user just pressed. The
// notification this replaces was awaited inside the serial webview message queue, so
// leaving it on screen froze the entire panel until it was dismissed.
export async function copyTextResult(text: string): Promise<void> {
  await vscode.env.clipboard.writeText(text);
}

async function replaceLastResult(): Promise<void> {
  if (!lastResult) {
    notify('information', 'KREN has no result to replace with yet.');
    return;
  }
  await replaceLastResultWith(resultText(lastResult.result));
}

async function replaceLastResultWith(replacement: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!lastResult?.uri || !lastResult.range || !editor ||
      editor.document.uri.toString() !== lastResult.uri) {
    notify('information', 'The original KREN selection is no longer active.');
    return;
  }
  const range = lastResult.range;
  if (editor.document.getText(range) !== lastResult.selectedText) {
    notify('warning', 'The original selection changed, so KREN did not replace it.');
    return;
  }
  await editor.edit((editBuilder) => {
    editBuilder.replace(range, replacement);
  });
}

async function applySelectedGrammarChoices(
  choices: readonly GrammarChoice[],
  replace: boolean
): Promise<void> {
  if (!lastResult || lastResult.result.kind !== 'grammar') {
    notify('information', 'KREN has no grammar result to apply.');
    return;
  }
  const selected = choices.filter((choice) => choice.suggestionIndex >= 0);
  if (!selected.length) {
    notify('information', 'Choose at least one grammar correction first.');
    return;
  }
  let corrected: string;
  try {
    corrected = applyGrammarChoices(lastResult.result, selected);
  } catch (error) {
    notify('error', `KREN could not apply those corrections: ${errorMessage(error)}`);
    return;
  }
  if (replace) {
    await replaceLastResultWith(corrected);
  } else {
    await copyTextResult(corrected);
  }
}

function showDetails(): void {
  if (!lastResult) {
    notify('information', 'KREN has no result to show yet.');
    return;
  }
  outputChannel.clear();
  outputChannel.appendLine(resultDetails(lastResult.result));
  outputChannel.show(true);
}

async function configureProvider(context: vscode.ExtensionContext): Promise<void> {
  const selected = await vscode.window.showQuickPick(
    [
      {
        label: 'Google Cloud Translation (NMT)',
        description: 'Direct translation with a local 500,000-character monthly safety limit',
        id: 'googleCloudTranslation' as const
      },
      {
        label: 'Gemini Developer API',
        description: 'Contextual translation and meaning/nuance explanations',
        id: 'gemini' as const
      }
    ],
    { title: 'Choose the KREN translation provider' }
  );
  if (!selected) return;
  await vscode.workspace
    .getConfiguration('kren')
    .update('translationProvider', selected.id, vscode.ConfigurationTarget.Global);
  if (selected.id === 'gemini') {
    const existingKey = await context.secrets.get(GEMINI_KEY);
    if (!existingKey) await vscode.commands.executeCommand('kren.setGeminiApiKey');
  } else if (selected.id === 'googleCloudTranslation') {
    const existingKey = await context.secrets.get(GOOGLE_CLOUD_TRANSLATION_KEY);
    if (!existingKey) {
      await vscode.commands.executeCommand('kren.setGoogleCloudTranslationApiKey');
    }
  }
}

async function configureLanguages(): Promise<void> {
  const translation = await pickOutputLanguage(
    'KREN: choose the Translate Selection output language',
    false
  );
  if (!translation) return;

  const explanation = await pickOutputLanguage(
    'KREN: choose the explanation output language',
    true
  );
  if (!explanation) return;

  const config = vscode.workspace.getConfiguration('kren');
  await config.update(
    'translation.targetLanguage',
    translation.code,
    vscode.ConfigurationTarget.Global
  );
  await config.update(
    'explanation.outputLanguage',
    explanation.code,
    vscode.ConfigurationTarget.Global
  );
  notify('information',
    `KREN languages updated: translations to ${translation.name}; explanations in ${explanation.name}. Input is detected automatically.`
  );
}

async function pickOutputLanguage(
  title: string,
  explanationPicker: boolean
): Promise<{ code: string; name: string } | undefined> {
  const items = [
    ...(explanationPicker
      ? [{
          label: '$(arrow-down) Same as source',
          description: 'Write the explanation in the language of the selected text',
          code: EXPLANATION_SAME_AS_SOURCE,
          name: 'Same as source'
        }]
      : []),
    ...KREN_LANGUAGES.map((language) => ({
      label: language.name,
      description: language.code,
      code: language.code,
      name: language.name
    })),
    {
      label: '$(edit) Enter another language code…',
      description: 'Use another supported ISO/BCP-47 code',
      code: '__custom__',
      name: 'Custom'
    }
  ];
  const selected = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: 'Type to search languages'
  });
  if (!selected) return undefined;
  if (selected.code !== '__custom__') return selected;

  const code = await vscode.window.showInputBox({
    title: 'Enter an ISO/BCP-47 language code',
    prompt: 'Examples: ca, zh-HK, pt-BR',
    validateInput: (value) => isPlausibleLanguageCode(value)
      ? undefined
      : 'Enter a language code such as es, ja, de, or pt-BR.'
  });
  if (!code) return undefined;
  const normalized = code.trim();
  return { code: normalized, name: languageName(normalized) };
}

async function setSecret(
  context: vscode.ExtensionContext,
  key: string,
  prompt: string
): Promise<boolean> {
  if (await context.secrets.get(key)) {
    notify('information',
      `KREN already has ${credentialLabel(key)} stored. Remove it before setting a new key.`
    );
    return false;
  }
  if (isMerriamWebsterSecretKey(key) && !await canStoreMerriamWebsterKey(context.secrets, key)) {
    notify('warning', MERRIAM_WEBSTER_KEY_LIMIT_MESSAGE);
    return false;
  }
  const value = await vscode.window.showInputBox({
    title: prompt,
    prompt: 'The key is encrypted by VS Code Secret Storage and is not synced.',
    password: true,
    ignoreFocusOut: true
  });
  if (!value?.trim()) return false;
  if (isMerriamWebsterSecretKey(key)) {
    const stored = await storeMerriamWebsterKey(context.secrets, key, value.trim());
    if (!stored) {
      notify('warning', MERRIAM_WEBSTER_KEY_LIMIT_MESSAGE);
      return false;
    }
  } else {
    await context.secrets.store(key, value.trim());
  }
  storedSecretKeys.add(key);
  resultsView.refresh();
  notify('information', 'KREN API key saved securely.');
  return true;
}

async function deleteSecret(
  context: vscode.ExtensionContext,
  key: string,
  confirmation: string
): Promise<void> {
  if (!await context.secrets.get(key)) {
    storedSecretKeys.delete(key);
    resultsView.refresh();
    notify('information', 'KREN found no stored API key for that provider.');
    return;
  }
  await context.secrets.delete(key);
  storedSecretKeys.delete(key);
  resultsView.refresh();
  notify('information', confirmation);
}

/**
 * Return every `kren.*` setting to the value the manifest declares, in every scope.
 *
 * `update(key, undefined, scope)` removes the stored override rather than writing a copy of
 * the default, so a later change to a default reaches a reader who has reset. Writing the
 * default value instead would pin today's default forever, which is the same trap as a
 * second copy of a rule.
 */
async function restoreDefaultConfiguration(
  context: vscode.ExtensionContext
): Promise<number> {
  const config = vscode.workspace.getConfiguration('kren');
  // The running extension's own manifest, so the key list cannot disagree with the
  // settings this build actually declares.
  const manifest = { contributes: context.extension.packageJSON.contributes } as unknown;
  let cleared = 0;
  for (const key of krenConfigurationKeys(manifest)) {
    const inspected = config.inspect(key);
    for (const [stored, scope] of [
      [inspected?.globalValue, vscode.ConfigurationTarget.Global],
      [inspected?.workspaceValue, vscode.ConfigurationTarget.Workspace],
      [inspected?.workspaceFolderValue, vscode.ConfigurationTarget.WorkspaceFolder]
    ] as Array<[unknown, vscode.ConfigurationTarget]>) {
      if (stored === undefined) continue;
      try {
        await config.update(key, undefined, scope);
        cleared += 1;
      } catch {
        // A workspace scope is unavailable with no folder open. Nothing to report: the
        // setting has no stored value there either.
      }
    }
  }
  return cleared;
}

/**
 * How many KREN settings currently hold a value other than the declared default.
 *
 * Counted before the second confirmation so the reader is told the size of what they are
 * about to lose rather than asked the same question twice. A confirmation that repeats the
 * first one is a click, not a check.
 */
async function changedSettingCount(context: vscode.ExtensionContext): Promise<number> {
  const config = vscode.workspace.getConfiguration('kren');
  const manifest = { contributes: context.extension.packageJSON.contributes } as unknown;
  let changed = 0;
  for (const key of krenConfigurationKeys(manifest)) {
    const inspected = config.inspect(key);
    if (inspected?.globalValue !== undefined ||
        inspected?.workspaceValue !== undefined ||
        inspected?.workspaceFolderValue !== undefined) changed += 1;
  }
  return changed;
}

let globalRoutingApplyPending = false;

async function applyGlobalRouting(): Promise<void> {
  if (globalRoutingApplyPending) return;
  globalRoutingApplyPending = true;
  try {
    const config = vscode.workspace.getConfiguration('kren');
    const folders = (vscode.workspace.workspaceFolders ?? []).map(folder => ({
      name: folder.name, config: vscode.workspace.getConfiguration('kren', folder.uri)
    }));
    const plan = globalRoutingPlan(config, folders);
    const selected = await showKrenWarningMessage('Apply Global LLM setting to all KREN features?',
      { modal: true, detail: plan.preview }, 'Apply', 'Cancel');
    if (selected !== 'Apply') return;
    const previous = new Map<string, unknown>(plan.writes.map(({ key }) => [key, config.inspect(key)?.globalValue]));
    const written: string[] = [];
    for (const { key, value } of plan.writes) {
      try {
        await config.update(key, value, vscode.ConfigurationTarget.Global);
        written.push(key);
      } catch {
        const unrestored: string[] = [];
        for (const changed of written.reverse()) {
          try { await config.update(changed, previous.get(changed), vscode.ConfigurationTarget.Global); }
          catch { unrestored.push(changed); }
        }
        notify('error', `KREN could not change ${key}. ${unrestored.length
          ? `Could not restore: ${unrestored.join(', ')}. Check these settings before trying again.`
          : 'Earlier changes from this Apply were restored.'}`);
        return;
      }
    }
    resultsView.refresh();
  } finally {
    globalRoutingApplyPending = false;
  }
}

/**
 * Default Setting: every setting back to its default, credentials untouched.
 *
 * One confirmation. The action is recoverable by choosing the settings again, and it never
 * removes anything a provider would have to reissue.
 */
async function restoreDefaultSettings(context: vscode.ExtensionContext): Promise<void> {
  const plan = krenResetPlan('settings');
  const first = await showKrenWarningMessage(
    'Return every KREN setting to its default? Your stored API keys, User Dictionary, and local grammar vocabulary are not touched.',
    { modal: true },
    'Continue'
  );
  if (first !== 'Continue') return;
  const changed = await changedSettingCount(context);
  const second = await showKrenWarningMessage(
    `Last check. KREN will return ${changed} setting${changed === 1 ? '' : 's'} you have changed to the value the extension declares, including translation and explanation languages, every LLM routing choice, and every rewrite style axis. Your API keys are not touched.`,
    { modal: true },
    'Restore Defaults'
  );
  if (second !== 'Restore Defaults') return;
  if (!plan.configuration) return;
  const cleared = await restoreDefaultConfiguration(context);
  resultsView.refresh();
  notify('information',
    cleared === 0
      ? 'KREN settings were already at their defaults.'
      : `KREN returned ${cleared} setting${cleared === 1 ? '' : 's'} to its default. Stored API keys are unchanged.`
  );
}

/**
 * Reset KREN: settings back to default, every credential deleted, and the state that only
 * exists because a credential was used cleared with them.
 *
 * Two confirmations, which the owner asked for on 2026-08-28: "when this button pressed, one
 * more confirmation required before executing the reset". The second is not a repeat of the
 * first. It names what cannot be recovered, because a deleted key has to be fetched from the
 * provider again while a default setting can simply be chosen again.
 */
async function resetKren(context: vscode.ExtensionContext): Promise<void> {
  const plan = krenResetPlan('everything');
  const first = await showKrenWarningMessage(
    'Reset KREN? This returns every setting to its default and deletes every API key stored on this VS Code profile.',
    { modal: true },
    'Continue'
  );
  if (first !== 'Continue') return;

  const keys = Object.values(KREN_SECRET_KEYS);
  const storedNow = (await Promise.all(keys.map((key) => context.secrets.get(key))))
    .filter(Boolean).length;
  const second = await showKrenWarningMessage(
    `Last check. KREN will delete ${storedNow} stored API key${storedNow === 1 ? '' : 's'}, clear provider consent and the Cloud Translation usage ledger, and empty your local grammar vocabulary. A deleted key cannot be recovered from KREN; you would fetch it from the provider again. Your User Dictionary entries are kept.`,
    { modal: true },
    'Reset KREN'
  );
  if (second !== 'Reset KREN') return;

  const cleared = await restoreDefaultConfiguration(context);
  if (plan.credentials) {
    await Promise.all(keys.map((key) => context.secrets.delete(key)));
    storedSecretKeys.clear();
  }
  await resetProviderExhaustion();
  for (const key of plan.globalStateKeys) {
    await context.globalState.update(key, undefined);
  }
  await cloudTranslationUsage.reset();
  configureHarperGrammar({ customWords: [], ignoredLints: '' });
  resultsView.refresh();
  notify('information',
    `KREN was reset: ${cleared} setting${cleared === 1 ? '' : 's'} returned to default and ${storedNow} API key${storedNow === 1 ? '' : 's'} deleted.`
  );
}

async function deleteAllApiKeys(context: vscode.ExtensionContext): Promise<void> {
  const confirmed = await showKrenWarningMessage(
    'Delete every API key stored by KREN on this VS Code profile? This cannot be undone.',
    { modal: true },
    'Delete All API Keys'
  );
  if (confirmed !== 'Delete All API Keys') return;

  const keys = Object.values(KREN_SECRET_KEYS);
  const stored = await Promise.all(keys.map((key) => context.secrets.get(key)));
  await Promise.all(keys.map((key) => context.secrets.delete(key)));
  storedSecretKeys.clear();
  resultsView.refresh();
  const removed = stored.filter((value) => Boolean(value)).length;
  notify('information',
    removed === 0
      ? 'KREN found no stored API keys in this VS Code profile.'
      : `KREN deleted ${removed} stored API key${removed === 1 ? '' : 's'} from this VS Code profile.`
  );
}

async function showLookupError(
  error: unknown,
  retry?: () => Promise<void>,
  offerProviderChoice = false,
  offerOtherGeminiProfile = offerProviderChoice
): Promise<void> {
  const missing = missingCredentialsOf(error);
  if (missing) { await showMissingCredentialNotice(missing, resultsView, '', offerProviderChoice, offerOtherGeminiProfile); return; }
  const outcome = recordedRequestOutcome(error);
  const presentation = error instanceof ProviderError && outcome?.type === 'failed' ? presentRequestFailure(outcome) : undefined;
  const message = presentation?.message ?? errorMessage(error);
  if (!(error instanceof ProviderError)) {
    notify('error', `KREN: ${message}`);
    return;
  }
  const retryLabel = error.retryable && retry ? 'Retry Now' : undefined;
  const action = presentation?.credentialAction ?? error.action;
  const checkQuota = outcome?.type === 'failed' && outcome.actions.includes('checkQuota');
  const actionButton = presentation?.quotaActionLabel ?? (action ? actionLabel(action) : undefined);
  if (!retryLabel && !actionButton) {
    notify('error', `KREN: ${message}`);
    return;
  }
  const buttons = [retryLabel, actionButton].filter((item): item is string => Boolean(item));
  if (!isCredentialSetupAction(action)) {
    void Promise.resolve(showKrenErrorMessage(`KREN: ${message}`, ...buttons))
      .then(async (selected) => {
        if (checkQuota && selected === actionButton) { await resultsView.showCredentials(); return; }
        await handleLookupErrorSelection(
          selected,
          retryLabel,
          actionButton,
          action,
          retry
        );
      })
      .catch(() => undefined);
    return;
  }
  const selected = await showKrenErrorMessage(
      `KREN: ${message}`,
      {
        modal: true,
        detail: outcome?.history.length
          ? 'The provider rejected its credential. Dismiss with X or Esc; KREN will ask again on the next attempt.'
          : 'No selected text was sent. Dismiss with X or Esc; KREN will ask again on the next attempt.'
      },
      ...buttons
    );
  await handleLookupErrorSelection(selected, retryLabel, actionButton, action, retry);
}

async function handleLookupErrorSelection(
  selected: string | undefined,
  retryLabel: string | undefined,
  actionButton: string | undefined,
  action: ProviderError['action'],
  retry: (() => Promise<void>) | undefined
): Promise<void> {
  if (selected === retryLabel && retry) {
    await retry();
    return;
  }
  if (selected !== actionButton || !action) return;
  await runProviderErrorAction(action);
}

function isCredentialSetupAction(
  action: ProviderError['action']
): boolean {
  return action === 'setGeminiKey' || action === 'setGeminiProKey' ||
    action === 'setOpenAIKey' || action === 'setAnthropicKey' || action === 'setGroqKey' || action === 'setCloudflareCredentials' ||
    action === 'setGoogleCloudTranslationKey' ||
    action === 'setMerriamWebsterCollegiateKey' ||
    action === 'setMerriamWebsterMedicalKey' ||
    action === 'setMerriamWebsterThesaurusKey' || action === 'setDictionaryKey';
}

async function refreshStoredSecretKeys(context: vscode.ExtensionContext): Promise<void> {
  const keys = Object.values(KREN_SECRET_KEYS);
  const values = await Promise.all(keys.map((key) => context.secrets.get(key)));
  storedSecretKeys = new Set(keys.filter((_key, index) => Boolean(values[index])));
}

function credentialLabel(key: string): string {
  if (key === GEMINI_KEY) return 'a Gemini Free Tier API key';
  if (key === GEMINI_PRO_KEY) return 'a Gemini Paid API key';
  if (key === GROQ_KEY) return 'a Groq API key';
  if (key === OPENAI_KEY) return 'an OpenAI API key';
  if (key === KREN_SECRET_KEYS.cloudflareAccountId) return 'a Cloudflare account ID';
  if (key === KREN_SECRET_KEYS.cloudflareApiToken) return 'a Cloudflare API token';
  if (key === ANTHROPIC_KEY) return 'an Anthropic API key';
  if (key === GOOGLE_CLOUD_TEXT_TO_SPEECH_KEY) return 'a Google Cloud Text-to-Speech API key';
  if (key === GOOGLE_CLOUD_TRANSLATION_KEY) return 'a Google Cloud Translation API key';
  if (key === DICTIONARY_KEY) return 'a Korean Dictionary API key';
  if (key === MW_COLLEGIATE_KEY) return 'a Merriam-Webster Collegiate API key';
  if (key === MW_MEDICAL_KEY) return 'a Merriam-Webster Medical API key';
  if (key === MW_THESAURUS_KEY) return 'a Merriam-Webster Thesaurus API key';
  return 'an API key';
}

async function runProviderErrorAction(
  action: NonNullable<ProviderError['action']>
): Promise<void> {
  if (action === 'setGeminiKey') await vscode.commands.executeCommand('kren.setGeminiApiKey');
  if (action === 'setGeminiProKey') {
    await vscode.commands.executeCommand('kren.setGeminiProApiKey');
  }
  if (action === 'setGroqKey' || action === 'setCloudflareCredentials') { await resultsView.showCredentials(); return; }
  if (action === 'setOpenAIKey') await vscode.commands.executeCommand('kren.setOpenAIApiKey');
  if (action === 'setAnthropicKey') {
    await vscode.commands.executeCommand('kren.setAnthropicApiKey');
  }
  if (action === 'setGoogleCloudTranslationKey') {
    await vscode.commands.executeCommand('kren.setGoogleCloudTranslationApiKey');
  }
  if (action === 'setMerriamWebsterCollegiateKey') {
    await vscode.commands.executeCommand('kren.setMerriamWebsterCollegiateApiKey');
  }
  if (action === 'setMerriamWebsterMedicalKey') {
    await vscode.commands.executeCommand('kren.setMerriamWebsterMedicalApiKey');
  }
  if (action === 'setMerriamWebsterThesaurusKey') {
    await vscode.commands.executeCommand('kren.setMerriamWebsterThesaurusApiKey');
  }
  if (action === 'setDictionaryKey') {
    await vscode.commands.executeCommand('kren.setKoreanDictionaryApiKey');
  }
  if (action === 'configureGeminiModel') {
    await resultsView.showSettings();
  }
  if (action === 'configureGeminiProModel') {
    await resultsView.showSettings();
  }
  if (action === 'configureOpenAIModel' || action === 'configureAnthropicModel' || action === 'configureGroqModel' || action === 'configureCloudflareModel') {
    await resultsView.showSettings();
  }
}

function actionLabel(action: NonNullable<ProviderError['action']>): string {
  if (action === 'setGeminiKey') return 'Set Gemini Free Tier API Key';
  if (action === 'setGeminiProKey') return 'Set Gemini Paid API Key';
  if (action === 'setGroqKey' || action === 'setCloudflareCredentials') return 'Credentials';
  if (action === 'configureGroqModel') return 'Configure Groq Model';
  if (action === 'configureCloudflareModel') return 'Configure Cloudflare Model';
  if (action === 'setOpenAIKey') return 'Set OpenAI API Key';
  if (action === 'setAnthropicKey') return 'Set Anthropic API Key';
  if (action === 'setGoogleCloudTranslationKey') return 'Set Google Cloud Translation API Key';
  if (action === 'setMerriamWebsterCollegiateKey') return 'Set Collegiate API Key';
  if (action === 'setMerriamWebsterMedicalKey') return 'Set Medical API Key';
  if (action === 'setMerriamWebsterThesaurusKey') return 'Set Thesaurus API Key';
  if (action === 'setDictionaryKey') return 'Set Dictionary API Key';
  if (action === 'configureGeminiModel') return 'Configure Gemini Model';
  if (action === 'configureGeminiProModel') return 'Configure Gemini Paid Model';
  if (action === 'configureOpenAIModel') return 'Configure OpenAI Model';
  if (action === 'configureAnthropicModel') return 'Configure Anthropic Model';
  return 'Configure Gemini Model';
}

function providerLabel(providerId: string): string {
  if (providerId === 'groq') return 'Groq';
  if (providerId === 'cloudflare') return 'Cloudflare Workers AI';
  if (providerId === 'harper') return 'Harper (offline)';
  if (providerId === 'gemini') return 'Gemini';
  if (providerId === 'googleCloudTranslation') return 'Google Cloud Translation';
  if (providerId === 'koreanBasicDictionary') return 'Korean Basic Dictionary';
  if (providerId === 'merriamWebsterCollegiate') return "Merriam-Webster's Collegiate Dictionary";
  if (providerId === 'merriamWebsterMedical') return "Merriam-Webster's Medical Dictionary";
  if (providerId === 'merriamWebsterThesaurus') return "Merriam-Webster's Collegiate Thesaurus";
  return providerId;
}

function progressTitle(operation: KrenOperation): string {
  if (operation === 'grammar') return 'KREN: checking grammar and spelling locally...';
  if (operation === 'explain') return 'KREN: explaining selection…';
  if (operation === 'medical') return 'KREN: searching the medical dictionary…';
  if (operation === 'englishDictionary') return 'KREN: searching the English dictionary…';
  if (operation === 'koreanDictionary') return 'KREN: searching the Korean dictionary…';
  if (operation === 'synonyms') return 'KREN: searching the thesaurus…';
  if (operation === 'rewrite') return 'KREN: producing both rewrite variants…';
  if (operation === 'rewriteMinimal') return 'KREN: producing a Minimal Rewrite…';
  if (operation === 'rewriteFull') return 'KREN: producing a Full Rewrite…';
  return 'KREN: translating selection…';
}

async function showGoogleCloudTranslationUsage(): Promise<void> {
  const usage = await cloudTranslationUsage.get();
  const remaining = GOOGLE_CLOUD_FREE_TIER_CHARACTERS - usage.characters;
  notify('information',
    `KREN Google Cloud Translation usage for ${usage.month}: ${usage.characters.toLocaleString()} / ${GOOGLE_CLOUD_FREE_TIER_CHARACTERS.toLocaleString()} characters (${remaining.toLocaleString()} remaining). This local count does not include requests made outside this VS Code profile.`
  );
}

async function testKoreanDictionary(context: vscode.ExtensionContext): Promise<void> {
  const key = await context.secrets.get(DICTIONARY_KEY);
  if (!key) {
    await showLookupError(missingCredentialError('koreanDictionary'));
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const request: DictionaryRequest = {
      text: '나무',
      sourceLanguage: 'ko',
      targetLanguage: 'en',
      kind: 'dictionary',
      operation: 'translate'
    };
    const result = await withKrenProgress(
      {
        title: 'Testing Korean Basic Dictionary with “나무”…',
        cancellable: false
      },
      () => new KoreanDictionaryProvider(key).lookup(request, controller.signal)
    );
    if (!result) {
      notify('error',
        'KREN reached the Korean Basic Dictionary, but its response contained no usable entry for “나무”.'
      );
      return;
    }
    const meanings = result.entries.map((entry) => entry.meaning).join(', ');
    notify('information',
      `Korean Basic Dictionary connection succeeded: 나무 → ${meanings}`
    );
  } catch (error) {
    await showLookupError(error);
  } finally {
    clearTimeout(timeout);
  }
}
