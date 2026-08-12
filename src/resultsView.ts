import * as vscode from 'vscode';
import { PANEL_COMMANDS, type KrenPanelCommand } from './panelCommands.js';
import { isRewriteVariantId } from './rewriteVariants.js';
import { readFile, stat } from 'node:fs/promises';
import { isAllowedPronunciationUrl } from './pronunciation.js';
import {
  renderKrenResultViewHtml,
  type KrenPanelSettings
} from './resultViewHtml.js';
import type { GrammarChoice, KrenResult, RewriteVariantId } from './types.js';
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

interface ResultState {
  result: KrenResult;
  sourceText: string;
  allowReplace: boolean;
}

interface ResultsViewActions {
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
  | 'rewrite.tone'
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
  | 'pronunciation.windowsNativePlayback';

export type { KrenPanelCommand } from './panelCommands.js';

export class KrenResultsViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewId = 'kren.resultsView';
  public static readonly enabledContext = 'kren.resultsEnabled';

  private view: vscode.WebviewView | undefined;
  private viewDisposables: vscode.Disposable[] = [];
  private state: ResultState | undefined;
  private autoplayAudio: { url: string; headword: string } | undefined;
  private audioPlaybackResolver: ((started: boolean) => void) | undefined;
  private generatedAudioResolver: ((result: EdgeReadAloudResult) => void) | undefined;
  private activeScreen: 'result' | 'start' | 'settings' | 'manual' = 'result';
  private messageQueue: Promise<void> = Promise.resolve();
  private proModels: GeminiModelOption[] = DEFAULT_PRO_MODELS;
  private openAIModels: GeminiModelOption[] = [{ id: 'gpt-5.4', displayName: 'GPT-5.4' }];
  private anthropicModels: GeminiModelOption[] = [
    { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' }
  ];
  private proModelRefresh = 0;
  private openAIModelRefresh = 0;
  private anthropicModelRefresh = 0;
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
    this.autoplayAudio = undefined;
    this.activeScreen = 'result';
    this.render();
  }

  public clear(): void {
    this.state = undefined;
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
      await vscode.window.showErrorMessage('KREN blocked an invalid pronunciation audio URL.');
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
      settings: this.actions.settings(),
      activeScreen: this.activeScreen,
      proModels: this.proModels,
      openAIModels: this.openAIModels,
      anthropicModels: this.anthropicModels
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
    }
    if (message.command === 'runCommand' && message.action) {
      // Do not hold the serialized settings queue while a long-running audio command
      // waits for its webview playback acknowledgement. Earlier setting updates have
      // already completed by the time this branch starts.
      const action = message.action;
      if (!isPanelCommand(action)) {
        const text = `KREN programming error: command "${action}" is not available in this build.`;
        this.actions.log(`[panel command unavailable] ${action}`);
        void vscode.window.showErrorMessage(text);
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
    void vscode.window.showErrorMessage(`KREN: ${message}`);
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
  | 'stopReadAloud'
  | 'clear'
  | 'updateSetting'
  | 'runCommand'
  | 'showSettings'
  | 'showManual'
  | 'showStartPage'
  | 'showResult'
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
  };
  const command = candidate.command;
  if (command !== 'copy' && command !== 'details' && command !== 'replace' &&
      command !== 'copyVariant' && command !== 'replaceVariant' &&
      command !== 'applyGrammar' && command !== 'copyGrammar' &&
      command !== 'addGrammarWord' && command !== 'ignoreGrammarIssue' &&
      command !== 'readVariant' && command !== 'stopReadAloud' && command !== 'clear' &&
      command !== 'updateSetting' && command !== 'runCommand' &&
      command !== 'showSettings' && command !== 'showManual' && command !== 'showStartPage' &&
      command !== 'showResult' &&
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
  if (command === 'runCommand') return isPanelCommandName(candidate.action);
  return true;
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
  'rewrite.tone',
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
]);



function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
