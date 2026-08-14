import * as vscode from 'vscode';
import { PANEL_COMMANDS, type KrenPanelCommand } from './panelCommands.js';
import { isRewriteVariantId } from './rewriteVariants.js';
import { readFile, stat } from 'node:fs/promises';
import { isAllowedPronunciationUrl } from './pronunciation.js';
import {
  isRewriteSettingsGroup,
  renderKrenResultViewHtml,
  type KrenPanelSettings,
  type RewriteSettingsGroup
} from './resultViewHtml.js';
import type { GrammarChoice, KrenResult, RewriteVariantId } from './types.js';
import { REWRITE_MODALITIES, type RewriteModality } from './rewriteAxes.js';
import {
  isRewriteModeId,
  rewriteModeSettingEntries,
  type RewriteModeId
} from './rewriteModes.js';
import {
  DEFAULT_PRO_MODELS,
  type GeminiModelOption
} from './providers/geminiModels.js';
import { WindowsPronunciationPlayer } from './windowsPronunciation.js';
import type { EdgeAudioPlayback, EdgeReadAloudResult } from './windowsEdgeReadAloud.js';
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

interface ResultState {
  result: KrenResult;
  sourceText: string;
  allowReplace: boolean;
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

interface ResultsViewActions {
  notify(kind: 'information' | 'warning' | 'error', message: string): void;
  copy(): Promise<void>;
  details(): void;
  replace(): Promise<void>;
  copyText(text: string): Promise<void>;
  replaceText(text: string): Promise<void>;
  applyGrammarChoices(choices: readonly GrammarChoice[], replace: boolean): Promise<void>;
  manageGrammarIssue(issueId: string, action: 'addWord' | 'ignore'): Promise<void>;
  readAloudText(text: string): Promise<void>;
  stopReadAloud(): void;
  clear(): void;
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
  updateSetting(key: KrenPanelSettingKey, value: string | number | boolean): Promise<void>;
  runCommand(command: KrenPanelCommand): Promise<void>;
  log(message: string): void;
  settings(): KrenPanelSettings;
  refreshProModels(): Promise<GeminiModelOption[]>;
  refreshOpenAIModels(): Promise<GeminiModelOption[]>;
  refreshAnthropicModels(): Promise<GeminiModelOption[]>;
  refreshReadAloudVoices(): Promise<void>;
}

export type KrenPanelSettingKey =
  | 'results.openAtStartup'
  | 'translationProvider'
  | 'translation.targetLanguage'
  | 'grammar.dialect'
  | 'grammar.autoCheck'
  | 'grammar.autoCheckDelayMs'
  | 'explanation.outputLanguage'
  | 'explanation.provider'
  | 'explanation.geminiProfile'
  | 'rewrite.provider'
  | 'rewrite.sourceLanguage'
  | 'rewrite.modality'
  | 'rewrite.function'
  | 'rewrite.englishVariety'
  | 'gemini.model'
  | 'gemini.thinkingLevel'
  | 'gemini.retry.enabled'
  | 'gemini.retry.maxAttempts'
  | 'openai.model'
  | 'openai.reasoningEffort'
  | 'anthropic.model'
  | 'anthropic.effort'
  | 'languageModel.retry.enabled'
  | 'languageModel.retry.maxAttempts'
  | 'rewrite.geminiProfile'
  | 'gemini.alternateModel'
  | 'gemini.alternateThinkingLevel'
  | 'gemini.alternateFallbackEnabled'
  | 'gemini.alternateFallbackModel'
  | 'gemini.alternateFallbackThinkingLevel'
  | 'rewrite.preferredVariant'
  | 'rewrite.quickMenuVariant'
  | 'rewrite.domain'
  | 'rewrite.formality'
  | 'rewrite.voice'
  | 'rewrite.stance'
  | 'rewrite.length'
  | 'rewrite.perspective'
  | 'rewrite.rhetoricalMode'
  | 'rewrite.preserveFormatting'
  | 'rewrite.includeChangeNotes'
  | 'rewrite.tts.enabled'
  | 'readAloud.voice'
  | 'readAloud.rate'
  | 'readAloud.volume'
  | 'readAloud.provider'
  | 'readAloud.edgeVoice'
  | 'readAloud.edgeRatePercent'
  | 'readAloud.edgePythonCommand'
  | 'dictionary.multiWordTranslationFallback'
  | 'pronunciation.windowsNativePlayback'
  | 'userDictionary.enabled'
  | 'userDictionary.defaultCaptureMode'
  | 'userDictionary.fallbackOnMerriamWebsterNoMatch'
  | 'userDictionary.provider'
  | 'userDictionary.model'
  | 'userDictionary.thinkingOrEffort'
  | 'userDictionary.entryLanguage'
  | 'userDictionary.includePronunciation'
  | 'userDictionary.includeSynonyms'
  | 'userDictionary.includeUsageNotes'
  | 'userDictionary.numberOfExamples'
  | 'userDictionary.includeTechnicalMeanings';

export type { KrenPanelCommand } from './panelCommands.js';

export class KrenResultsViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewId = 'kren.resultsView';
  public static readonly enabledContext = 'kren.resultsEnabled';

  private view: vscode.WebviewView | undefined;
  private viewDisposables: vscode.Disposable[] = [];
  private state: ResultState | undefined;
  private userDictionaryState: UserDictionaryState = { entries: [] };
  private autoplayAudio: { url: string; headword: string } | undefined;
  private audioPlaybackResolver: ((started: boolean) => void) | undefined;
  private generatedAudioResolver: ((result: EdgeReadAloudResult) => void) | undefined;
  private activeScreen: 'result' | 'start' | 'settings' | 'manual' | 'userDictionary' = 'result';
  private messageQueue: Promise<void> = Promise.resolve();
  private proModels: GeminiModelOption[] = DEFAULT_PRO_MODELS;
  private openAIModels: GeminiModelOption[] = [{ id: 'gpt-5.4', displayName: 'GPT-5.4' }];
  private anthropicModels: GeminiModelOption[] = [
    { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' }
  ];
  private proModelRefresh = 0;
  private openAIModelRefresh = 0;
  private anthropicModelRefresh = 0;
  private inferredRewriteModality: RewriteModality | undefined;
  private activeRewriteSettingsGroup: RewriteSettingsGroup | undefined;
  private readonly windowsPronunciation = new WindowsPronunciationPlayer();

  public constructor(
    private readonly actions: ResultsViewActions,
    private readonly extensionUri: vscode.Uri
  ) {}

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.disposeViewDisposables();
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
    };
    this.viewDisposables = [
      view.webview.onDidReceiveMessage((message: unknown) => {
        const priorityCommand = priorityWebviewCommand(message);
        if (priorityCommand) {
          this.handlePriorityMessage(priorityCommand);
          return;
        }
        this.messageQueue = this.messageQueue
          .then(() => this.handleMessage(message))
          .catch(() => undefined);
      }),
      view.onDidDispose(() => {
        if (this.view !== view) return;
        this.view = undefined;
        this.audioPlaybackResolver?.(false);
        this.audioPlaybackResolver = undefined;
        this.generatedAudioResolver?.('stopped');
        this.generatedAudioResolver = undefined;
        this.disposeViewDisposables();
      })
    ];
    this.render();
  }

  public setResult(result: KrenResult, sourceText: string, allowReplace: boolean): void {
    this.state = { result, sourceText, allowReplace };
    this.inferredRewriteModality = undefined;
    this.autoplayAudio = undefined;
    this.activeScreen = 'result';
    this.render();
  }

  public clear(): void {
    this.state = undefined;
    this.inferredRewriteModality = undefined;
    this.autoplayAudio = undefined;
    this.activeScreen = 'result';
    this.render();
  }

  public refresh(): void {
    this.render();
  }

  public async showResult(
    result: KrenResult,
    sourceText: string,
    allowReplace: boolean
  ): Promise<void> {
    this.setResult(result, sourceText, allowReplace);
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
    await vscode.commands.executeCommand(
      'setContext',
      KrenResultsViewProvider.enabledContext,
      false
    );
  }

  public async reveal(): Promise<void> {
    await vscode.commands.executeCommand(
      'setContext',
      KrenResultsViewProvider.enabledContext,
      true
    );
    await vscode.commands.executeCommand(`${KrenResultsViewProvider.viewId}.focus`);
  }

  public edgeAudioPlayback(): EdgeAudioPlayback | undefined {
    if (!this.view) return undefined;
    return {
      play: (file) => this.playGeneratedAudio(file),
      stop: () => this.stopGeneratedAudio()
    };
  }

  public stopGeneratedAudio(): boolean {
    const active = Boolean(this.generatedAudioResolver);
    if (this.view) void this.view.webview.postMessage({ command: 'stopGeneratedAudio' });
    this.generatedAudioResolver?.('stopped');
    this.generatedAudioResolver = undefined;
    return active;
  }

  public async showSettings(): Promise<void> {
    this.activeScreen = 'settings';
    this.render();
    await this.reveal();
    this.refreshReadAloudVoicesInBackground();
  }

  public async showUserDictionary(selectedId?: string): Promise<void> {
    this.activeScreen = 'userDictionary';
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
    this.activeScreen = 'userDictionary';
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
    this.activeScreen = 'userDictionary';
    this.render();
    await this.reveal();
  }

  public dispose(): void {
    this.proModelRefresh += 1;
    this.openAIModelRefresh += 1;
    this.anthropicModelRefresh += 1;
    this.view = undefined;
    this.disposeViewDisposables();
    this.stopGeneratedAudio();
    this.audioPlaybackResolver?.(false);
    this.audioPlaybackResolver = undefined;
    this.windowsPronunciation.dispose();
    void vscode.commands.executeCommand(
      'setContext',
      KrenResultsViewProvider.enabledContext,
      false
    );
  }

  private disposeViewDisposables(): void {
    const disposables = this.viewDisposables;
    this.viewDisposables = [];
    for (const disposable of disposables) disposable.dispose();
  }

  private async playGeneratedAudio(file: string): Promise<EdgeReadAloudResult> {
    const view = this.view;
    if (!view) return 'failed';
    this.stopGeneratedAudio();
    try {
      const information = await stat(file);
      if (!information.isFile() || information.size <= 0 || information.size > 25_000_000) {
        return 'failed';
      }
      const audioBase64 = (await readFile(file)).toString('base64');
      return await new Promise<EdgeReadAloudResult>((resolve) => {
        let settled = false;
        const finish = (result: EdgeReadAloudResult): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (this.generatedAudioResolver === finish) this.generatedAudioResolver = undefined;
          resolve(result);
        };
        const timeout = setTimeout(() => finish('failed'), 610_000);
        this.generatedAudioResolver = finish;
        void view.webview.postMessage({
          command: 'playGeneratedAudio',
          audioBase64
        }).then((delivered) => {
          if (!delivered) finish('failed');
        });
      });
    } catch {
      return 'failed';
    }
  }

  private render(): void {
    if (!this.view) return;
    const nonce = createNonce();
    const settings = {
      ...this.actions.settings(),
      ...(this.userDictionaryState.status === 'ready'
        ? { userDictionaryEntryCount: this.userDictionaryState.entries.length }
        : {})
    };
    const brandImageUri = this.view.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'kren-panel-logo.png')
    ).toString();
    const googleAttributionImageUri = this.view.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'google-translate-attribution.png')
    ).toString();
    this.view.webview.html = renderKrenResultViewHtml({
      cspSource: this.view.webview.cspSource,
      nonce,
      brandImageUri,
      googleAttributionImageUri,
      result: this.state?.result,
      sourceText: this.state?.sourceText,
      allowReplace: this.state?.allowReplace,
      autoplayAudio: this.autoplayAudio,
      settings,
      activeScreen: this.activeScreen,
      userDictionary: this.userDictionaryState,
      proModels: this.proModels,
      openAIModels: this.openAIModels,
      anthropicModels: this.anthropicModels,
      inferredRewriteModality: this.inferredRewriteModality,
      activeRewriteSettingsGroup: this.activeRewriteSettingsGroup
    });
    this.autoplayAudio = undefined;
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isCommandMessage(message)) return;
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
    if (message.command === 'applyGrammar' || message.command === 'copyGrammar') {
      await this.actions.applyGrammarChoices(
        message.grammarChoices ?? [],
        message.command === 'applyGrammar' && Boolean(this.state?.allowReplace)
      );
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
        void this.actions.readAloudText(text).catch((error: unknown) => {
          this.reportActionFailure('Read Aloud', error, 'panel read aloud failed');
        });
      }
    }
    if (message.command === 'clear') {
      this.actions.clear();
    }
    if (message.command === 'updateSetting' && message.key !== undefined &&
        message.value !== undefined) {
      await this.actions.updateSetting(message.key, message.value);
      if (message.key === 'rewrite.modality') this.inferredRewriteModality = undefined;
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
    if (message.command === 'pinInferredModality' && this.inferredRewriteModality) {
      await this.actions.updateSetting('rewrite.modality', this.inferredRewriteModality);
      this.inferredRewriteModality = undefined;
      this.render();
    }
    if (message.command === 'runCommand' && message.action) {
      // Do not hold the serialized settings queue while a long-running audio command
      // waits for its webview playback acknowledgement. Earlier setting updates have
      // already completed by the time this branch starts.
      const action = message.action;
      if (!isPanelCommand(action)) {
        const text = `KREN programming error: command "${action}" is not available in this build.`;
        this.actions.log(`[panel command unavailable] ${action}`);
        this.actions.notify('error', text);
      } else {
        void this.actions.runCommand(action).catch((error: unknown) => {
          this.reportActionFailure(
            action,
            error,
            'panel command failed'
          );
        });
      }
    }
    if (message.command === 'showSettings') {
      this.activeScreen = 'settings';
      this.render();
      this.refreshReadAloudVoicesInBackground();
    }
    if (message.command === 'showManual') {
      this.activeScreen = 'manual';
      this.render();
    }
    if (message.command === 'showStartPage') {
      this.activeScreen = 'start';
      this.render();
    }
    if (message.command === 'showResult') {
      this.activeScreen = 'result';
      this.render();
    }
    if (message.command === 'showUserDictionary') {
      try {
        await this.showUserDictionary();
      } catch (error) {
        this.reportActionFailure('Open User Dictionary', error, 'user dictionary open failed');
      }
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
        void this.actions.readAloudText(entry.term).catch((error: unknown) => {
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
          this.activeScreen = 'userDictionary';
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
        this.activeScreen = 'userDictionary';
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
        this.userDictionaryState = {
          entries: this.userDictionaryState.entries,
          status: 'generationFailed'
        };
        this.render();
        this.reportActionFailure(
          'Regenerate User Dictionary draft',
          error,
          'user dictionary regenerate failed'
        );
      }
    }
    if (message.command === 'refreshProModels') {
      this.refreshProModelsInBackground();
    }
    if (message.command === 'refreshOpenAIModels') {
      this.refreshOpenAIModelsInBackground();
    }
    if (message.command === 'refreshAnthropicModels') {
      this.refreshAnthropicModelsInBackground();
    }
  }

  private handlePriorityMessage(command: PriorityWebviewCommand): void {
    if (command === 'stopReadAloud') this.actions.stopReadAloud();
    if (command === 'pronunciationStarted') this.audioPlaybackResolver?.(true);
    if (command === 'pronunciationFailed') this.audioPlaybackResolver?.(false);
    if (command === 'generatedAudioEnded') this.generatedAudioResolver?.('completed');
    if (command === 'generatedAudioFailed') this.generatedAudioResolver?.('failed');
  }

  private refreshReadAloudVoicesInBackground(): void {
    void this.actions.refreshReadAloudVoices()
      .then(() => {
        if (this.activeScreen === 'settings') this.render();
      })
      .catch(() => {
        this.actions.log('[settings background refresh failed] Read Aloud voices.');
      });
  }

  private refreshProModelsInBackground(): void {
    const generation = ++this.proModelRefresh;
    void this.actions.refreshProModels()
      .then((models) => {
        if (generation !== this.proModelRefresh) return;
        this.proModels = models;
        if (this.activeScreen === 'settings') this.render();
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
        if (this.activeScreen === 'settings') this.render();
      })
      .catch(() => {
        this.actions.log('[settings background refresh failed] OpenAI models.');
      });
  }

  private refreshAnthropicModelsInBackground(): void {
    const generation = ++this.anthropicModelRefresh;
    void this.actions.refreshAnthropicModels()
      .then((models) => {
        if (generation !== this.anthropicModelRefresh) return;
        this.anthropicModels = models;
        if (this.activeScreen === 'settings') this.render();
      })
      .catch(() => {
        this.actions.log('[settings background refresh failed] Anthropic models.');
      });
  }

  private reportActionFailure(action: string, error: unknown, logKind: string): void {
    const message = safePanelErrorMessage(error);
    this.actions.log(`[${logKind}] ${action}: ${message}`);
    this.actions.notify('error', `KREN: ${message}`);
  }

  private rewriteVariantText(id: RewriteVariantId | undefined): string | undefined {
    if (!id || this.state?.result.kind !== 'rewrite') return undefined;
    return this.state.result.variants.find((variant) => variant.id === id)?.text;
  }
}

type ResultsViewCommand =
  | 'copy'
  | 'details'
  | 'replace'
  | 'copyVariant'
  | 'replaceVariant'
  | 'applyGrammar'
  | 'copyGrammar'
  | 'addGrammarWord'
  | 'ignoreGrammarIssue'
  | 'readVariant'
  | 'pinInferredModality'
  | 'stopReadAloud'
  | 'clear'
  | 'updateSetting'
  | 'applyRewriteMode'
  | 'editRewriteGroup'
  | 'runCommand'
  | 'showSettings'
  | 'showManual'
  | 'showStartPage'
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
  | 'refreshProModels'
  | 'refreshOpenAIModels'
  | 'refreshAnthropicModels'
  | 'pronunciationStarted'
  | 'pronunciationFailed'
  | 'generatedAudioEnded'
  | 'generatedAudioFailed';

function isCommandMessage(value: unknown): value is {
  command: ResultsViewCommand;
  variantId?: RewriteVariantId;
  grammarChoices?: GrammarChoice[];
  issueId?: string;
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
} {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as {
    command?: unknown;
    variantId?: unknown;
    grammarChoices?: unknown;
    issueId?: unknown;
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
  };
  const command = candidate.command;
  if (command !== 'copy' && command !== 'details' && command !== 'replace' &&
      command !== 'copyVariant' && command !== 'replaceVariant' &&
      command !== 'applyGrammar' && command !== 'copyGrammar' &&
      command !== 'addGrammarWord' && command !== 'ignoreGrammarIssue' &&
      command !== 'readVariant' && command !== 'pinInferredModality' &&
      command !== 'stopReadAloud' && command !== 'clear' &&
      command !== 'updateSetting' && command !== 'applyRewriteMode' &&
      command !== 'editRewriteGroup' && command !== 'runCommand' &&
      command !== 'showSettings' && command !== 'showManual' && command !== 'showStartPage' &&
      command !== 'showResult' &&
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
      command !== 'refreshProModels' && command !== 'refreshOpenAIModels' &&
      command !== 'refreshAnthropicModels' && command !== 'pronunciationStarted' &&
      command !== 'pronunciationFailed' && command !== 'generatedAudioEnded' &&
      command !== 'generatedAudioFailed') return false;
  if (candidate.variantId !== undefined && !isRewriteVariantId(candidate.variantId)) return false;
  if ((command === 'applyGrammar' || command === 'copyGrammar') &&
      !isGrammarChoices(candidate.grammarChoices)) return false;
  if ((command === 'addGrammarWord' || command === 'ignoreGrammarIssue') &&
      (typeof candidate.issueId !== 'string' || !/^issue-\d+$/u.test(candidate.issueId))) return false;
  if (command === 'updateSetting') {
    return isPanelSettingKey(candidate.key) &&
      (typeof candidate.value === 'string' || typeof candidate.value === 'number' ||
        typeof candidate.value === 'boolean');
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
  if (command === 'openUserDictionaryEntry' || command === 'readUserDictionaryEntry' ||
      command === 'editUserDictionaryEntry' ||
      command === 'deleteUserDictionaryEntry') {
    return typeof candidate.entryId === 'string' && candidate.entryId.length <= 100;
  }
  if (command === 'saveUserDictionaryDraft') return isDictionaryDraftMessage(candidate.entry);
  return true;
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
    return typeof candidate.issueId === 'string' && /^issue-\d+$/u.test(candidate.issueId) &&
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

function safePanelErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\bBearer\s+\S+/giu, 'Bearer [redacted]')
    .replace(/([?&](?:api[_-]?key|key|token)=)[^\s&#]+/giu, '$1[redacted]')
    .replace(/\b((?:api[_-]?key|key|token|secret)\s*[:=]\s*)[^\s,;]+/giu, '$1[redacted]')
    .replace(/\b(?:AIza[\w-]+|sk-[\w-]+)\b/gu, '[redacted]')
    .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/giu, '[redacted]')
    // Catch-all for opaque tokens the named patterns above do not know about. It requires
    // both a letter and a digit, because a long run of letters alone is a word, not a key.
    // The looser form matched any twenty-character run and so redacted ordinary English,
    // including the dictionary terms and provider messages that make a failure diagnosable.
    // Over-redaction is not the safe direction here: this function exists so that a failure
    // can be read, and a message reduced to "[redacted]" fails at that as surely as a leak.
    .replace(
      /\b(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}\b/gu,
      '[redacted]'
    );
}

const PANEL_SETTING_KEYS = new Set<KrenPanelSettingKey>([
  'results.openAtStartup',
  'translationProvider',
  'translation.targetLanguage',
  'grammar.dialect',
  'grammar.autoCheck',
  'grammar.autoCheckDelayMs',
  'explanation.outputLanguage',
  'explanation.provider',
  'explanation.geminiProfile',
  'rewrite.provider',
  'rewrite.sourceLanguage',
  'rewrite.modality',
  'rewrite.function',
  'rewrite.englishVariety',
  'gemini.model',
  'gemini.thinkingLevel',
  'gemini.retry.enabled',
  'gemini.retry.maxAttempts',
  'openai.model',
  'openai.reasoningEffort',
  'anthropic.model',
  'anthropic.effort',
  'languageModel.retry.enabled',
  'languageModel.retry.maxAttempts',
  'rewrite.geminiProfile',
  'gemini.alternateModel',
  'gemini.alternateThinkingLevel',
  'gemini.alternateFallbackEnabled',
  'gemini.alternateFallbackModel',
  'gemini.alternateFallbackThinkingLevel',
  'rewrite.preferredVariant',
  'rewrite.quickMenuVariant',
  'rewrite.domain',
  'rewrite.formality',
  'rewrite.voice',
  'rewrite.stance',
  'rewrite.length',
  'rewrite.perspective',
  'rewrite.rhetoricalMode',
  'rewrite.preserveFormatting',
  'rewrite.includeChangeNotes',
  'rewrite.tts.enabled',
  'readAloud.voice',
  'readAloud.rate',
  'readAloud.volume',
  'readAloud.provider',
  'readAloud.edgeVoice',
  'readAloud.edgeRatePercent',
  'readAloud.edgePythonCommand',
  'dictionary.multiWordTranslationFallback',
  'pronunciation.windowsNativePlayback'
  ,'userDictionary.enabled'
  ,'userDictionary.defaultCaptureMode'
  ,'userDictionary.fallbackOnMerriamWebsterNoMatch'
  ,'userDictionary.provider'
  ,'userDictionary.model'
  ,'userDictionary.thinkingOrEffort'
  ,'userDictionary.entryLanguage'
  ,'userDictionary.includePronunciation'
  ,'userDictionary.includeSynonyms'
  ,'userDictionary.includeUsageNotes'
  ,'userDictionary.numberOfExamples'
  ,'userDictionary.includeTechnicalMeanings'
]);

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
