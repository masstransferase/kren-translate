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
import {
  AUTO_ENGLISH_KOREAN_TARGET,
  isPlausibleLanguageCode,
  KREN_LANGUAGES,
  languageName
} from './languages.js';
import {
  canStoreMerriamWebsterKey,
  isMerriamWebsterSecretKey,
  KREN_SECRET_KEYS,
  MERRIAM_WEBSTER_KEY_LIMIT_MESSAGE,
  runKrenOperation,
  runUserDictionaryCapture,
  storeMerriamWebsterKey,
  type KrenOperation,
  type KrenRuntime
} from './operations.js';
import { resultDetails, resultText } from './render.js';
import { explicitTextSubmission } from './submission.js';
import {
  KrenResultsViewProvider,
  type KrenPanelCommand,
  type KrenPanelSettingKey
} from './resultsView.js';
import type { KrenPanelSettings } from './resultViewHtml.js';
import {
  ALL_REWRITE_VARIANTS_ID,
  isRewriteVariantId,
  REWRITE_VARIANT_LIST,
  type QuickMenuRewriteVariantId
} from './rewriteVariants.js';
import {
  isRewriteAxisSetting,
  migrateLegacyRewriteSettings,
  REWRITE_AXIS_DEFAULTS,
  type RewriteConfigurationTarget
} from './rewriteAxes.js';
import { KoreanDictionaryProvider } from './providers/koreanDictionary.js';
import {
  DEFAULT_PRO_MODELS,
  listGeminiProModels,
  type GeminiModelOption
} from './providers/geminiModels.js';
import { listOpenAIModels } from './providers/openai.js';
import { listAnthropicModels } from './providers/anthropic.js';
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
import { WindowsEdgeReadAloudPlayer } from './windowsEdgeReadAloud.js';
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
import { USER_DICTIONARY_MAX_IMPORT_ENTRIES } from './userDictionary/importExport.js';
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
  type UserDictionaryPurgeSelection
} from './userDictionary/index.js';

const GEMINI_KEY = KREN_SECRET_KEYS.gemini;
const GEMINI_PRO_KEY = KREN_SECRET_KEYS.geminiPro;
const OPENAI_KEY = KREN_SECRET_KEYS.openai;
const ANTHROPIC_KEY = KREN_SECRET_KEYS.anthropic;
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
const AUTO_TRANSLATION_TARGET_MIGRATION = 'kren.migration.autoTranslationTarget.v1';
const LEGACY_CLOUD_USAGE_KEY = 'kren.googleCloudTranslation.usage.v1';
const EDGE_TTS_CONSENT = 'kren.edgeTts.onlineConsent.v1';
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
let cloudTranslationUsage: FileCloudTranslationUsage;
let resultsView: KrenResultsViewProvider;
let readAloudPlayer: WindowsReadAloudPlayer;
let edgeReadAloudPlayer: WindowsEdgeReadAloudPlayer;
let grammarCodeActions: GrammarCodeActions;
let readAloudVoices: string[] = [];
let readAloudVoicesPromise: Promise<void> | undefined;
let extensionVersion = '0.0.0';
let readAloudSession = 0;
let automaticGrammarTimer: NodeJS.Timeout | undefined;
let activeExtensionContext: vscode.ExtensionContext;
let storedSecretKeys = new Set<string>();
let userDictionaryService: UserDictionaryService;
let userDictionaryStoragePath = '';

type NotificationKind = 'information' | 'warning' | 'error';

export function notify(kind: NotificationKind, message: string): void {
  const notification = kind === 'information'
    ? vscode.window.showInformationMessage(message)
    : kind === 'warning'
      ? vscode.window.showWarningMessage(message)
      : vscode.window.showErrorMessage(message);
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
  // The rich view is unavailable until an explicit KREN action calls reveal(),
  // unless the user has deliberately enabled the opt-in startup-sidebar setting.
  await vscode.commands.executeCommand(
    'setContext',
    KrenResultsViewProvider.enabledContext,
    false
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
  grammarCodeActions = new GrammarCodeActions();
  configureHarperGrammar({
    customWords: context.globalState.get<string[]>(GRAMMAR_CUSTOM_WORDS, []),
    ignoredLints: context.globalState.get<string>(GRAMMAR_IGNORED_LINTS, '')
  });
  await migrateTranslationProviderToCloud(context);
  await migrateDeprecatedGeminiFallback(context);
  await migrateTranslationTargetToAutomatic(context);
  await migrateRewriteAxes();
  registerKrenChatTools(context, extensionRuntime(context));
  resultsView = new KrenResultsViewProvider({
    notify,
    copy: copyLastResult,
    details: showDetails,
    replace: replaceLastResult,
    copyText: copyTextResult,
    replaceText: replaceLastResultWith,
    applyGrammarChoices: (choices, replace) => applySelectedGrammarChoices(choices, replace),
    manageGrammarIssue: (issueId, action) => managePanelGrammarIssue(context, issueId, action),
    readAloudText: (text) => readAloudText(context, text),
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
    updateSetting: updatePanelSetting,
    runCommand: runPanelCommand,
    log: (message) => outputChannel.appendLine(message),
    settings: readPanelSettings,
    refreshProModels: () => refreshProModels(context),
    refreshOpenAIModels: () => refreshOpenAIModels(context),
    refreshAnthropicModels: () => refreshAnthropicModels(context),
    refreshReadAloudVoices
  }, context.extensionUri);
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.text = '$(book) KREN';
  statusItem.tooltip = 'KREN actions, clipboard tools, and Secondary Sidebar';
  statusItem.command = 'kren.useClipboard';
  statusItem.show();

  context.subscriptions.push(
    outputChannel,
    statusItem,
    resultsView,
    readAloudPlayer,
    edgeReadAloudPlayer,
    grammarCodeActions,
    vscode.languages.registerCodeActionsProvider(
      { scheme: '*' },
      grammarCodeActions,
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    ),
    vscode.window.registerWebviewViewProvider(
      KrenResultsViewProvider.viewId,
      resultsView
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
    vscode.commands.registerCommand('kren.rewriteNaturalSelection', () =>
      executeLookup(context, hoverStore, 'rewriteNatural')
    ),
    vscode.commands.registerCommand('kren.rewriteConciseSelection', () =>
      executeLookup(context, hoverStore, 'rewriteConcise')
    ),
    vscode.commands.registerCommand('kren.rewriteJargonFreeSelection', () =>
      executeLookup(context, hoverStore, 'rewriteJargonFree')
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
    vscode.commands.registerCommand('kren.hideSecondarySidebar', () =>
      vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar')
    ),
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
      setSecret(context, GEMINI_KEY, 'Enter your default Gemini API key')
    ),
    vscode.commands.registerCommand('kren.deleteGeminiApiKey', () =>
      deleteSecret(context, GEMINI_KEY, 'Default Gemini API key deleted.')
    ),
    vscode.commands.registerCommand('kren.setGeminiProApiKey', () =>
      setSecret(context, GEMINI_PRO_KEY, 'Enter your alternate Gemini API key')
    ),
    vscode.commands.registerCommand('kren.deleteGeminiProApiKey', () =>
      deleteSecret(context, GEMINI_PRO_KEY, 'Alternate Gemini API key deleted.')
    ),
    vscode.commands.registerCommand('kren.setOpenAIApiKey', () =>
      setSecret(context, OPENAI_KEY, 'Enter your OpenAI API key')
    ),
    vscode.commands.registerCommand('kren.deleteOpenAIApiKey', () =>
      deleteSecret(context, OPENAI_KEY, 'OpenAI API key deleted.')
    ),
    vscode.commands.registerCommand('kren.testOpenAIConnection', () =>
      testLanguageModelConnection(context, 'OpenAI', OPENAI_KEY, 'kren.setOpenAIApiKey', listOpenAIModels)
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
    vscode.commands.registerCommand('kren.testKoreanDictionary', () =>
      testKoreanDictionary(context)
    ),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (lastResult?.uri === event.document.uri.toString()) hoverStore.clear();
      grammarCodeActions.clear(event.document.uri);
      scheduleAutomaticGrammarCheck(context, event.document);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('kren')) resultsView.refresh();
    }),
    context.secrets.onDidChange((event) => {
      if (!Object.values(KREN_SECRET_KEYS).includes(event.key as typeof GEMINI_KEY)) return;
      void context.secrets.get(event.key).then((value) => {
        if (value) storedSecretKeys.add(event.key);
        else storedSecretKeys.delete(event.key);
        resultsView.refresh();
      });
    })
  );

  if (vscode.workspace.getConfiguration('kren').get<boolean>('results.openAtStartup', false)) {
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
  const config = vscode.workspace.getConfiguration('kren');
  return {
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
    userDictionaryModel: config.get<string>(
      'userDictionary.model',
      'gemini-3.5-flash'
    ),
    userDictionaryThinkingOrEffort: config.get<KrenPanelSettings['userDictionaryThinkingOrEffort']>(
      'userDictionary.thinkingOrEffort',
      'low'
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
    openResultsAtStartup: config.get<boolean>('results.openAtStartup', false),
    translationProvider: config.get<'googleCloudTranslation' | 'gemini'>(
      'translationProvider',
      'googleCloudTranslation'
    ),
    translationTargetLanguage: config.get<string>(
      'translation.targetLanguage',
      AUTO_ENGLISH_KOREAN_TARGET
    ),
    grammarDialect: config.get<KrenPanelSettings['grammarDialect']>(
      'grammar.dialect',
      'american'
    ),
    grammarAutoCheck: config.get<boolean>('grammar.autoCheck', false),
    grammarAutoCheckDelayMs: config.get<number>('grammar.autoCheckDelayMs', 900),
    grammarCustomWordCount: activeExtensionContext.globalState.get<string[]>(GRAMMAR_CUSTOM_WORDS, []).length,
    grammarIgnoredFindingCount: ignoredLintCount(
      activeExtensionContext.globalState.get<string>(GRAMMAR_IGNORED_LINTS, '')
    ),
    explanationOutputLanguage: config.get<string>('explanation.outputLanguage', 'bilingual'),
    explanationProvider: config.get<KrenPanelSettings['explanationProvider']>(
      'explanation.provider',
      'gemini'
    ),
    explanationProfile: config.get<'standard' | 'pro'>(
      'explanation.geminiProfile',
      'standard'
    ),
    rewriteProvider: config.get<KrenPanelSettings['rewriteProvider']>(
      'rewrite.provider',
      'gemini'
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
    rewriteEnglishVariety: config.get<KrenPanelSettings['rewriteEnglishVariety']>(
      'rewrite.englishVariety',
      REWRITE_AXIS_DEFAULTS.englishVariety
    ),
    geminiModel: config.get<string>('gemini.model', 'gemini-3.5-flash'),
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
    alternateModel: config.get<string>('gemini.alternateModel', 'gemini-3.1-pro-preview'),
    alternateThinkingLevel: config.get<'low' | 'medium' | 'high'>(
      'gemini.alternateThinkingLevel',
      'low'
    ),
    alternateFallbackEnabled: config.get<boolean>('gemini.alternateFallbackEnabled', true),
    alternateFallbackModel: config.get<string>(
      'gemini.alternateFallbackModel',
      'gemini-3.5-flash'
    ),
    alternateFallbackThinkingLevel: config.get<KrenPanelSettings['alternateFallbackThinkingLevel']>(
      'gemini.alternateFallbackThinkingLevel',
      'low'
    ),
    preferredRewriteVariant: config.get<KrenPanelSettings['preferredRewriteVariant']>(
      'rewrite.preferredVariant',
      REWRITE_VARIANT_LIST[0].id
    ),
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
      'windowsLocal'
    ),
    edgeReadAloudVoice: config.get<string>(
      'readAloud.edgeVoice',
      'en-US-ChristopherNeural'
    ),
    edgeReadAloudRatePercent: config.get<number>('readAloud.edgeRatePercent', 0),
    edgeReadAloudPythonCommand: config.get<string>('readAloud.edgePythonCommand', 'python'),
    credentialPresence: {
      geminiDefault: storedSecretKeys.has(GEMINI_KEY),
      geminiAlternate: storedSecretKeys.has(GEMINI_PRO_KEY),
      googleCloudTranslation: storedSecretKeys.has(GOOGLE_CLOUD_TRANSLATION_KEY),
      openai: storedSecretKeys.has(OPENAI_KEY),
      anthropic: storedSecretKeys.has(ANTHROPIC_KEY),
      merriamWebsterCollegiate: storedSecretKeys.has(MW_COLLEGIATE_KEY),
      merriamWebsterMedical: storedSecretKeys.has(MW_MEDICAL_KEY),
      merriamWebsterThesaurus: storedSecretKeys.has(MW_THESAURUS_KEY),
      koreanDictionary: storedSecretKeys.has(DICTIONARY_KEY)
    },
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
  await vscode.workspace.getConfiguration('kren').update(
    key,
    value,
    vscode.ConfigurationTarget.Global
  );
}

function validatedPanelSetting(
  key: KrenPanelSettingKey,
  value: string | number | boolean
): string | number | boolean | undefined {
  if (key === 'userDictionary.defaultCaptureMode') {
    return value === 'llmOnly' || value === 'merriamWebsterAndLlm' ? value : undefined;
  }
  if (key === 'userDictionary.provider') {
    return value === 'gemini' || value === 'openai' || value === 'anthropic'
      ? value
      : undefined;
  }
  if (key === 'userDictionary.thinkingOrEffort') {
    return typeof value === 'string' &&
      ['auto', 'none', 'minimal', 'low', 'medium', 'high'].includes(value)
      ? value
      : undefined;
  }
  if (key === 'userDictionary.numberOfExamples') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return [0, 1, 2, 3].includes(numeric) ? numeric : undefined;
  }
  if (key === 'userDictionary.entryLanguage') {
    return typeof value === 'string' &&
      (value.trim() === 'auto' || isPlausibleLanguageCode(value.trim()))
      ? value.trim()
      : undefined;
  }
  if (key === 'userDictionary.model') {
    return typeof value === 'string' && /^models\/[\w.:-]+$|^[\w.:-]+$/u.test(value.trim())
      ? value.trim()
      : undefined;
  }
  if (key === 'translationProvider') {
    return value === 'googleCloudTranslation' || value === 'gemini' ? value : undefined;
  }
  if (key === 'translation.targetLanguage') {
    return typeof value === 'string' &&
      (value.trim() === AUTO_ENGLISH_KOREAN_TARGET || isPlausibleLanguageCode(value.trim()))
      ? value.trim()
      : undefined;
  }
  if (key === 'explanation.outputLanguage') {
    return typeof value === 'string' &&
      (value.trim() === 'bilingual' || isPlausibleLanguageCode(value.trim()))
      ? value.trim()
      : undefined;
  }
  if (key === 'grammar.dialect') {
    return typeof value === 'string' && [
      'american', 'british', 'australian', 'canadian', 'indian'
    ].includes(value) ? value : undefined;
  }
  if (key === 'grammar.autoCheckDelayMs') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return [500, 900, 1500, 2500].includes(numeric) ? numeric : undefined;
  }
  if (key === 'explanation.provider' || key === 'rewrite.provider') {
    return value === 'gemini' || value === 'openai' || value === 'anthropic'
      ? value
      : undefined;
  }
  if (key === 'gemini.model' || key === 'gemini.alternateModel' ||
      key === 'gemini.alternateFallbackModel' || key === 'openai.model' ||
      key === 'anthropic.model') {
    return typeof value === 'string' && /^models\/[\w.:-]+$|^[\w.:-]+$/u.test(value.trim())
      ? value.trim()
      : undefined;
  }
  if (key === 'gemini.thinkingLevel') {
    return typeof value === 'string' &&
      ['auto', 'minimal', 'low', 'medium', 'high'].includes(value)
      ? value
      : undefined;
  }
  if (key === 'openai.reasoningEffort') {
    return typeof value === 'string' &&
      ['auto', 'none', 'low', 'medium', 'high'].includes(value)
      ? value
      : undefined;
  }
  if (key === 'anthropic.effort') {
    return typeof value === 'string' && ['auto', 'low', 'medium', 'high'].includes(value)
      ? value
      : undefined;
  }
  if (key === 'explanation.geminiProfile' || key === 'rewrite.geminiProfile') {
    return value === 'standard' || value === 'pro' ? value : undefined;
  }
  if (key === 'gemini.alternateThinkingLevel') {
    return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
  }
  if (key === 'gemini.alternateFallbackThinkingLevel') {
    return typeof value === 'string' &&
      ['auto', 'minimal', 'low', 'medium', 'high'].includes(value)
      ? value
      : undefined;
  }
  if (key === 'rewrite.preferredVariant') {
    return isRewriteVariantId(value) ? value : undefined;
  }
  if (key === 'rewrite.quickMenuVariant') {
    return value === ALL_REWRITE_VARIANTS_ID || isRewriteVariantId(value) ? value : undefined;
  }
  if (key.startsWith('rewrite.') && isRewriteAxisSetting(key, value)) return value;
  if (key === 'rewrite.sourceLanguage') {
    return typeof value === 'string' &&
      (value.trim() === 'auto' || isPlausibleLanguageCode(value.trim()))
      ? value.trim()
      : undefined;
  }
  if (key === 'gemini.retry.maxAttempts' || key === 'languageModel.retry.maxAttempts') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(numeric) && numeric >= 1 && numeric <= 5 ? numeric : undefined;
  }
  if (key === 'readAloud.voice') {
    return typeof value === 'string' && value.length <= 200 ? value : undefined;
  }
  if (key === 'readAloud.provider') {
    return value === 'windowsLocal' || value === 'edgeOnline' ? value : undefined;
  }
  if (key === 'readAloud.edgeVoice') {
    return typeof value === 'string' && /^[A-Za-z0-9-]{3,100}$/u.test(value.trim())
      ? value.trim()
      : undefined;
  }
  if (key === 'readAloud.edgeRatePercent') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(numeric) && numeric >= -50 && numeric <= 100
      ? numeric
      : undefined;
  }
  if (key === 'readAloud.edgePythonCommand') {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 500 &&
      !/[\r\n\0]/u.test(value) ? value.trim() : undefined;
  }
  if (key === 'readAloud.rate') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(numeric) && numeric >= -10 && numeric <= 10 ? numeric : undefined;
  }
  if (key === 'readAloud.volume') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 100 ? numeric : undefined;
  }
  return typeof value === 'boolean' ? value : undefined;
}

async function refreshProModels(
  context: vscode.ExtensionContext
): Promise<GeminiModelOption[]> {
  let key = await context.secrets.get(GEMINI_PRO_KEY);
  if (!key) {
    await vscode.commands.executeCommand('kren.setGeminiProApiKey');
    key = await context.secrets.get(GEMINI_PRO_KEY);
  }
  if (!key) return DEFAULT_PRO_MODELS;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const models = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'KREN: retrieving models for the alternate Gemini profile...',
        cancellable: false
      },
      () => listGeminiProModels(key, controller.signal)
    );
    notify('information',
      `KREN found ${models.length} Gemini text models available or recommended for the alternate profile.`
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
  let key = await context.secrets.get(secretKey);
  if (!key) {
    await vscode.commands.executeCommand(setKeyCommand);
    key = await context.secrets.get(secretKey);
  }
  if (!key) return fallback;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `KREN: retrieving ${providerName} models...`,
        cancellable: false
      },
      () => listModels(key, controller.signal)
    );
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
  listModels: (key: string, signal: AbortSignal) => Promise<GeminiModelOption[]>
): Promise<void> {
  let key = await context.secrets.get(secretKey);
  if (!key) {
    await vscode.commands.executeCommand(setKeyCommand);
    key = await context.secrets.get(secretKey);
  }
  if (!key) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const models = await listModels(key, controller.signal);
    notify('information',
      `KREN: ${providerName} connection succeeded (${models.length} compatible models found).`
    );
  } catch (error) {
    await showLookupError(error);
  } finally {
    clearTimeout(timeout);
  }
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
  const replacementModel = 'gemini-3.5-flash';
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

async function migrateTranslationTargetToAutomatic(
  context: vscode.ExtensionContext
): Promise<void> {
  if (context.globalState.get<boolean>(AUTO_TRANSLATION_TARGET_MIGRATION, false)) return;
  const config = vscode.workspace.getConfiguration('kren');
  const inspected = config.inspect<string>('translation.targetLanguage');
  if (
    inspected?.workspaceValue === undefined &&
    inspected?.workspaceFolderValue === undefined &&
    inspected?.globalValue === 'ko'
  ) {
    await config.update(
      'translation.targetLanguage',
      AUTO_ENGLISH_KOREAN_TARGET,
      vscode.ConfigurationTarget.Global
    );
  }
  await context.globalState.update(AUTO_TRANSLATION_TARGET_MIGRATION, true);
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

async function readAloudText(
  context: vscode.ExtensionContext,
  text: string
): Promise<void> {
  const session = ++readAloudSession;
  const config = vscode.workspace.getConfiguration('kren');
  const provider = config.get<'windowsLocal' | 'edgeOnline'>(
    'readAloud.provider',
    'windowsLocal'
  );
  readAloudPlayer.stop();
  edgeReadAloudPlayer.stop();
  if (provider === 'edgeOnline' && !vscode.workspace.isTrusted) {
    await vscode.commands.executeCommand('setContext', 'kren.readAloudActive', false);
    notify('warning',
      'KREN Edge Online speech is disabled in Restricted Mode because it launches the configured Python executable. Trust this workspace to use Edge Online speech, or choose Local Windows speech.'
    );
    return;
  }
  if (provider === 'edgeOnline' && !await ensureEdgeTtsConsent(context)) {
    await vscode.commands.executeCommand('setContext', 'kren.readAloudActive', false);
    return;
  }
  await vscode.commands.executeCommand('setContext', 'kren.readAloudActive', true);
  const status = vscode.window.setStatusBarMessage(
    provider === 'edgeOnline'
      ? '$(cloud-download) KREN: Generating and reading Edge voice...'
      : '$(unmute) KREN: Reading aloud...'
  );
  try {
    if (provider === 'edgeOnline') {
      const result = await edgeReadAloudPlayer.speak(text, {
        pythonCommand: config.get<string>('readAloud.edgePythonCommand', 'python'),
        voice: config.get<string>('readAloud.edgeVoice', 'en-US-ChristopherNeural'),
        ratePercent: config.get<number>('readAloud.edgeRatePercent', 0),
        volume: config.get<number>('readAloud.volume', 100),
        playback: resultsView.edgeAudioPlayback()
      });
      if (result === 'dependencyMissing') {
        const action = await vscode.window.showErrorMessage(
          'KREN Edge Online speech requires the optional edge-tts Python package.',
          'Copy install command'
        );
        if (action === 'Copy install command') {
          await vscode.env.clipboard.writeText('python -m pip install edge-tts');
        }
      } else if (result === 'failed') {
        notify('error',
          'KREN could not generate or play the selected Edge online voice. Check the Python command, edge-tts installation, voice ID, and network connection.'
        );
      }
      return;
    }

    const completed = await readAloudPlayer.speak(text, {
      voice: config.get<string>('readAloud.voice', ''),
      rate: config.get<number>('readAloud.rate', 0),
      volume: config.get<number>('readAloud.volume', 100)
    });
    if (!completed) {
      notify('error',
        'KREN could not use the selected Windows voice. Choose another voice in KREN Settings or verify that Windows speech is installed.'
      );
    }
  } finally {
    status.dispose();
    if (session === readAloudSession) {
      await vscode.commands.executeCommand('setContext', 'kren.readAloudActive', false);
    }
  }
}

function stopReadAloud(showStatus: boolean): boolean {
  readAloudSession += 1;
  const stoppedLocal = readAloudPlayer.stop();
  const stoppedEdge = edgeReadAloudPlayer.stop();
  const stoppedWebview = resultsView.stopGeneratedAudio();
  const stopped = stoppedLocal || stoppedEdge || stoppedWebview;
  if (stopped && showStatus) {
    void vscode.window.setStatusBarMessage('KREN: Read Aloud stopped.', 2500);
  }
  void vscode.commands.executeCommand('setContext', 'kren.readAloudActive', false);
  return stopped;
}

async function ensureEdgeTtsConsent(context: vscode.ExtensionContext): Promise<boolean> {
  if (context.globalState.get<boolean>(EDGE_TTS_CONSENT, false)) return true;
  const choice = await vscode.window.showWarningMessage(
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
  ), true);
}

async function checkGrammarRange(
  context: vscode.ExtensionContext,
  editor: vscode.TextEditor,
  range: vscode.Range,
  announce: boolean,
  showProgress = announce,
  publishPanel = true
): Promise<GrammarDiagnosticState | undefined> {
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
          return await runKrenOperation(
            extensionRuntime(context),
            'grammar',
            explicitTextSubmission(selectedText),
            controller.signal
          );
        } finally {
          clearTimeout(timeout);
          cancellation?.dispose();
        }
      };
    const result = showProgress
      ? await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: 'KREN: checking grammar and spelling locally...',
          cancellable: true
        },
        (_progress, token) => runCheck(token)
      )
      : await runCheck();
    if (result.kind !== 'grammar') throw new Error('KREN received an invalid grammar result.');
    if (editor.document.uri.toString() !== snapshot.uri ||
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
      resultsView.setResult(result, snapshot.selectedText, true);
    }
    const state = grammarCodeActions.setResult(
      editor.document,
      snapshot.range,
      snapshot.selectedText,
      result
    );
    if (announce) {
      if (!result.issues.length) {
        notify('information', 'KREN: Harper found no spelling or grammar issues.');
      } else {
        notify('information',
          `KREN found ${result.issues.length} possible issue${result.issues.length === 1 ? '' : 's'}. Right-click an underlined issue and choose Quick Fix.`
        );
      }
    }
    return state;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      notify('information',
        abortReason === 'timedOut'
          ? 'KREN Grammar Check timed out while running locally.'
          : 'KREN Grammar Check was cancelled.'
      );
      return undefined;
    }
    await showLookupError(error, () => executeGrammarCheck(context));
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
  const refreshed = await checkGrammarRange(context, editor, updatedRange, false);
  if (!refreshed) return;
  const remaining = refreshed.result.issues.length;
  void vscode.window.setStatusBarMessage(
    remaining
      ? `KREN: Correction applied · ${remaining} possible issue${remaining === 1 ? '' : 's'} remaining.`
      : 'KREN: Correction applied · no remaining issues found.',
    4000
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
  await checkGrammarRange(context, editor, state.range, false, false);
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
    await checkGrammarRange(context, editor, lastResult.range, false, false);
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
    void vscode.window.setStatusBarMessage(`KREN: Added “${word}” to the local dictionary.`, 3500);
  } else {
    if (!issue.ignoreHash) throw new Error('That finding cannot be ignored.');
    const ignored = await ignoreHarperLint(issue.ignoreHash);
    await context.globalState.update(GRAMMAR_IGNORED_LINTS, ignored);
    void vscode.window.setStatusBarMessage('KREN: This finding will be ignored locally.', 3500);
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
    void checkGrammarRange(context, currentEditor, range, false, false, false);
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
  let abortReason: 'cancelled' | 'timedOut' | undefined;

  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: progressTitle(operation),
        cancellable: true
      },
      async (_progress, token) => {
        const timeoutMs = config.get<number>('request.timeoutMs', 45000);
        const controller = new AbortController();
        const cancellation = token.onCancellationRequested(() => {
          if (!abortReason) abortReason = 'cancelled';
          controller.abort();
        });
        const timeout = setTimeout(() => {
          if (!abortReason) abortReason = 'timedOut';
          controller.abort();
        }, timeoutMs);
        try {
          return await runKrenOperation(
            extensionRuntime(context),
            operation,
            explicitTextSubmission(rawText),
            controller.signal
          );
        } finally {
          clearTimeout(timeout);
          cancellation.dispose();
        }
      }
    );

    if (
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
    resultsView.setResult(result, snapshot.selectedText, true);

    hoverStore.set(editor.document, snapshot.range, result);
    if (result.kind === 'rewrite' || result.kind === 'grammar') {
      await resultsView.showResult(result, snapshot.selectedText, true);
    } else {
      await displayResult(result);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      const message = operation === 'grammar'
        ? abortReason === 'timedOut'
          ? 'KREN Grammar Check timed out while running locally.'
          : 'KREN Grammar Check was cancelled.'
        : abortReason === 'timedOut'
          ? 'KREN translation timed out. Try again, choose Gemini 3.1 Flash-Lite, or increase kren.request.timeoutMs.'
          : 'KREN translation was cancelled.';
      notify('information', message);
      return;
    }
    await showLookupError(error, () => executeLookup(context, hoverStore, operation));
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
    const selected = await vscode.window.showInformationMessage(
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
      const choice = await vscode.window.showInformationMessage(
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
    const draft = await generateUserDictionaryDraft(context, expression);
    await resultsView.showUserDictionaryDraft(draft);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      notify('information',
        'User Dictionary generation was cancelled. Nothing was saved.'
      );
      return;
    }
    await resultsView.showUserDictionaryGenerationFailure();
    await showLookupError(error, () => executeAddToUserDictionary(context));
  }
}

async function generateUserDictionaryDraft(
  context: vscode.ExtensionContext,
  expression: string,
  captureMode?: UserDictionaryCaptureMode
): Promise<UserDictionaryCaptureResult | UserDictionaryEntryV1> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: 'KREN: generating an editable User Dictionary draft…',
      cancellable: true
    },
    async (_progress, token) => {
      const controller = new AbortController();
      const timeoutMs = vscode.workspace.getConfiguration('kren').get<number>(
        'request.timeoutMs',
        45000
      );
      const cancellation = token.onCancellationRequested(() => controller.abort());
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await runUserDictionaryCapture(
          extensionRuntime(context),
          expression,
          controller.signal,
          captureMode
        );
      } finally {
        clearTimeout(timeout);
        cancellation.dispose();
      }
    }
  );
}

async function regenerateUserDictionaryDraft(
  context: vscode.ExtensionContext,
  expression: string,
  captureMode: UserDictionaryCaptureMode
): Promise<UserDictionaryCaptureResult | UserDictionaryEntryV1 | undefined> {
  const confirmed = await vscode.window.showWarningMessage(
    'Regenerate this User Dictionary draft and discard its unsaved edits?',
    { modal: true },
    'Regenerate'
  );
  return confirmed === 'Regenerate'
    ? generateUserDictionaryDraft(context, expression, captureMode)
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
  const confirmed = await vscode.window.showWarningMessage(
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
  const confirmed = await vscode.window.showWarningMessage(
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
    const confirmed = await vscode.window.showWarningMessage(
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
      label: '$(edit) Rewrite Text: All 3 Variants',
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
      { label: '$(checklist) Grammar Check (offline)', operation: 'grammar' as const },
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
      { label: '$(close) Hide Secondary Sidebar', command: 'kren.hideSecondarySidebar' as const },
      { label: '$(gear) Open KREN Settings', command: 'kren.openPanelSettings' as const }
    ];
  const selected = await vscode.window.showQuickPick(
    pickerItems,
    {
      title: `KREN — clipboard: ${clipboardPreview(rawText)}`,
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
      const draft = await generateUserDictionaryDraft(context, rawText);
      await resultsView.showUserDictionaryDraft(draft);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        notify('information',
          'User Dictionary generation was cancelled. Nothing was saved.'
        );
        return;
      }
      await showLookupError(error, () => executeClipboardLookup(context));
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

  let abortReason: 'cancelled' | 'timedOut' | undefined;
  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: progressTitle(selectedOperation),
        cancellable: true
      },
      async (_progress, token) => {
        const controller = new AbortController();
        const cancellation = token.onCancellationRequested(() => {
          if (!abortReason) abortReason = 'cancelled';
          controller.abort();
        });
        const timeout = setTimeout(() => {
          if (!abortReason) abortReason = 'timedOut';
          controller.abort();
        }, config.get<number>('request.timeoutMs', 45000));
        try {
          return await runKrenOperation(
            extensionRuntime(context),
            selectedOperation,
            explicitTextSubmission(rawText),
            controller.signal
          );
        } finally {
          clearTimeout(timeout);
          cancellation.dispose();
        }
      }
    );
    lastResult = { selectedText: rawText, result };
    await resultsView.showResult(result, rawText, false);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      notify('information',
        abortReason === 'timedOut' ? 'KREN request timed out.' : 'KREN request was cancelled.'
      );
      return;
    }
    await showLookupError(error, () => executeClipboardLookup(context));
  }
}

function clipboardPreview(text: string): string {
  const compact = text.trim().replace(/\s+/gu, ' ');
  return compact.length > 70 ? `${compact.slice(0, 67)}…` : compact;
}

function extensionRuntime(context: vscode.ExtensionContext): KrenRuntime {
  return {
    getSecret: async (key) => context.secrets.get(key),
    getSetting: <T>(key: string, fallback: T): T =>
      vscode.workspace.getConfiguration('kren').get<T>(key, fallback),
    reserveCloudCharacters: (characters) => cloudTranslationUsage.reserve(characters),
    beforeGeminiRequest: (profile) => ensureGeminiConsent(context, profile),
    beforeLanguageModelRequest: (provider, profile) =>
      ensureLanguageModelConsent(context, provider, profile)
  };
}

async function ensureLanguageModelConsent(
  context: vscode.ExtensionContext,
  provider: 'gemini' | 'openai' | 'anthropic',
  profile: 'standard' | 'pro' = 'standard'
): Promise<void> {
  if (provider === 'gemini') return ensureGeminiConsent(context, profile);
  const consentKey = provider === 'openai' ? OPENAI_CONSENT : ANTHROPIC_CONSENT;
  if (context.globalState.get<boolean>(consentKey, false)) return;
  const providerName = provider === 'openai' ? 'OpenAI' : 'Anthropic';
  const retention = provider === 'openai'
    ? 'OpenAI states that API data is not used for training by default, but standard abuse-monitoring logs may be retained for 30 days. KREN sets store to false; that is not a zero-retention guarantee.'
    : 'Anthropic states that standard API inputs and outputs are normally deleted within 30 days, with longer retention possible for policy enforcement or law. Zero data retention requires a separate approved agreement.';
  const accepted = await vscode.window.showWarningMessage(
    `${providerName} API use can incur charges. ${retention} KREN sends only the text you explicitly submit plus fixed instructions and selected KREN settings. KREN does not send the surrounding file, workspace, clipboard history, or previous results, and it does not track or cap provider spending.`,
    { modal: true },
    'I Understand'
  );
  if (accepted !== 'I Understand') throw new Error(`${providerName} request cancelled.`);
  await context.globalState.update(consentKey, true);
}

async function ensureGeminiConsent(
  context: vscode.ExtensionContext,
  profile: 'standard' | 'pro' = 'standard'
): Promise<void> {
  if (context.globalState.get<boolean>(GEMINI_CONSENT, false)) return;
  const fallbackNotice = profile === 'pro'
    ? ' If alternate-profile fallback is enabled, the same text may be resubmitted to the configured fallback model after exhausted 429, 503, or 504 retries or an unusable structured response.'
    : '';
  const accepted = await vscode.window.showWarningMessage(
    `Google's current Gemini API Terms require API users to be at least 18 and use Gemini for professional or business purposes. Gemini is available only in regions listed by Google, with additional regional restrictions. Model access, quotas, pricing, data use, and permitted use vary by Google project and region. By continuing, you confirm that you are at least 18 and will use your own eligible Google project in compliance with the current terms. KREN sends only the text you explicitly submit plus fixed instructions and selected settings.${fallbackNotice} Do not submit secrets, personal data, confidential source code, or unpublished documents unless Google's current terms and controls are acceptable.`,
    { modal: true },
    'I Am 18+ and Confirm',
    'Open Gemini API Terms'
  );
  if (accepted === 'Open Gemini API Terms') {
    await vscode.env.openExternal(vscode.Uri.parse('https://ai.google.dev/gemini-api/terms'));
    return ensureGeminiConsent(context, profile);
  }
  if (accepted !== 'I Am 18+ and Confirm') throw new Error('Gemini request cancelled.');
  await context.globalState.update(GEMINI_CONSENT, true);
}

async function configureRewriteGeminiProfile(
  context: vscode.ExtensionContext
): Promise<void> {
  const selected = await vscode.window.showQuickPick(
    [
      {
        label: '$(sparkle) Default Gemini profile',
        description: 'Uses the user-supplied default key and kren.gemini.model',
        profile: 'standard' as const
      },
      {
        label: '$(star-full) Alternate Gemini profile',
        description: 'Uses an optional alternate user-supplied key and kren.gemini.alternateModel',
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
        title: 'Choose the alternate Gemini profile thinking level',
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
    `Rewrite Text now uses the ${selected.profile === 'pro' ? 'alternate' : 'default'} Gemini profile.`
  );
}

async function displayResult(result: KrenResult): Promise<void> {
  const mode = vscode.workspace.getConfiguration('kren').get<string>('display.mode', 'hover');
  if (mode === 'details') {
    showDetails();
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
  includeBilingual: boolean
): Promise<{ code: string; name: string } | undefined> {
  const items = [
    ...(includeBilingual
      ? [{ label: 'English and Korean', description: 'Bilingual explanation', code: 'bilingual', name: 'English and Korean' }]
      : [{
          label: '$(arrow-swap) Auto: English ↔ Korean',
          description: 'English to Korean; Korean to English',
          code: AUTO_ENGLISH_KOREAN_TARGET,
          name: 'Auto: English ↔ Korean'
        }]),
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

async function deleteAllApiKeys(context: vscode.ExtensionContext): Promise<void> {
  const confirmed = await vscode.window.showWarningMessage(
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
  retry?: () => Promise<void>
): Promise<void> {
  const message = errorMessage(error);
  if (!(error instanceof ProviderError)) {
    notify('error', `KREN: ${message}`);
    return;
  }
  const retryLabel = error.retryable && retry ? 'Retry Now' : undefined;
  const action = error.action;
  const actionButton = action ? actionLabel(action) : undefined;
  if (!retryLabel && !actionButton) {
    notify('error', `KREN: ${message}`);
    return;
  }
  const buttons = [retryLabel, actionButton].filter((item): item is string => Boolean(item));
  if (!isCredentialSetupAction(action)) {
    void Promise.resolve(vscode.window.showErrorMessage(`KREN: ${message}`, ...buttons))
      .then((selected) => handleLookupErrorSelection(
        selected,
        retryLabel,
        actionButton,
        action,
        retry
      ))
      .catch(() => undefined);
    return;
  }
  const selected = await vscode.window.showErrorMessage(
      `KREN: ${message}`,
      {
        modal: true,
        detail: 'No selected text was sent. Dismiss with X or Esc; KREN will ask again on the next attempt.'
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
    action === 'setOpenAIKey' || action === 'setAnthropicKey' ||
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
  if (key === GEMINI_KEY) return 'a default Gemini API key';
  if (key === GEMINI_PRO_KEY) return 'an alternate Gemini API key';
  if (key === OPENAI_KEY) return 'an OpenAI API key';
  if (key === ANTHROPIC_KEY) return 'an Anthropic API key';
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
  if (action === 'configureOpenAIModel' || action === 'configureAnthropicModel') {
    await resultsView.showSettings();
  }
}

function actionLabel(action: NonNullable<ProviderError['action']>): string {
  if (action === 'setGeminiKey') return 'Set Default Gemini API Key';
  if (action === 'setGeminiProKey') return 'Set Alternate Gemini API Key';
  if (action === 'setOpenAIKey') return 'Set OpenAI API Key';
  if (action === 'setAnthropicKey') return 'Set Anthropic API Key';
  if (action === 'setGoogleCloudTranslationKey') return 'Set Google Cloud Translation API Key';
  if (action === 'setMerriamWebsterCollegiateKey') return 'Set Collegiate API Key';
  if (action === 'setMerriamWebsterMedicalKey') return 'Set Medical API Key';
  if (action === 'setMerriamWebsterThesaurusKey') return 'Set Thesaurus API Key';
  if (action === 'setDictionaryKey') return 'Set Dictionary API Key';
  if (action === 'configureGeminiModel') return 'Configure Gemini Model';
  if (action === 'configureGeminiProModel') return 'Configure Alternate Gemini Model';
  if (action === 'configureOpenAIModel') return 'Configure OpenAI Model';
  if (action === 'configureAnthropicModel') return 'Configure Anthropic Model';
  return 'Configure Gemini Model';
}

function providerLabel(providerId: string): string {
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
  if (operation === 'rewrite') return 'KREN: rewriting text in three styles…';
  if (operation === 'rewriteNatural') return 'KREN: producing a natural rewrite…';
  if (operation === 'rewriteConcise') return 'KREN: making the text concise…';
  if (operation === 'rewriteJargonFree') return 'KREN: rewriting text without jargon…';
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
    const selected = await vscode.window.showErrorMessage(
      'KREN: no Korean Basic Dictionary API key is stored in this VS Code profile.',
      'Set Dictionary API Key'
    );
    if (selected === 'Set Dictionary API Key') {
      await vscode.commands.executeCommand('kren.setKoreanDictionaryApiKey');
    }
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
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
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
