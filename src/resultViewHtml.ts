import { languageName } from './languages.js';
import { isEnglishLanguageCode } from '@kren/core/languages';
import { isAllowedPronunciationUrl } from './pronunciation.js';
import type { GeminiModelOption } from './providers/geminiModels.js';
import type {
  DictionaryResult,
  DictionarySection,
  GrammarResult,
  KrenResult,
  RewriteResult,
  ThesaurusResult,
  ThesaurusWord
} from './types.js';

export interface ResultViewHtmlOptions {
  cspSource: string;
  nonce: string;
  brandImageUri?: string;
  googleAttributionImageUri?: string;
  result?: KrenResult;
  sourceText?: string;
  allowReplace?: boolean;
  autoplayAudio?: { url: string; headword: string };
  settings: KrenPanelSettings;
  activeScreen?: 'result' | 'start' | 'settings' | 'manual';
  proModels: GeminiModelOption[];
  openAIModels?: GeminiModelOption[];
  anthropicModels?: GeminiModelOption[];
}

export interface KrenPanelSettings {
  translationProvider: 'googleCloudTranslation' | 'gemini';
  translationTargetLanguage: string;
  grammarDialect: 'american' | 'british' | 'australian' | 'canadian' | 'indian';
  grammarAutoCheck: boolean;
  grammarAutoCheckDelayMs: number;
  grammarCustomWordCount: number;
  grammarIgnoredFindingCount: number;
  explanationOutputLanguage: string;
  explanationProvider: 'gemini' | 'openai' | 'anthropic';
  explanationProfile: 'standard' | 'pro';
  rewriteProvider: 'gemini' | 'openai' | 'anthropic';
  rewriteSourceLanguage: string;
  rewriteEnglishVariety:
    | 'followGrammar'
    | 'american'
    | 'british'
    | 'australian'
    | 'canadian'
    | 'indian'
    | 'international';
  geminiModel: string;
  geminiThinkingLevel: 'auto' | 'minimal' | 'low' | 'medium' | 'high';
  openAIModel: string;
  openAIReasoningEffort: 'auto' | 'none' | 'low' | 'medium' | 'high';
  anthropicModel: string;
  anthropicEffort: 'auto' | 'low' | 'medium' | 'high';
  rewriteProfile: 'standard' | 'pro';
  alternateModel: string;
  alternateThinkingLevel: 'low' | 'medium' | 'high';
  alternateFallbackEnabled: boolean;
  alternateFallbackModel: string;
  alternateFallbackThinkingLevel: 'auto' | 'minimal' | 'low' | 'medium' | 'high';
  preferredRewriteVariant: 'natural' | 'concise' | 'jargonFree';
  quickMenuRewriteVariant: 'all' | 'natural' | 'concise' | 'jargonFree';
  rewriteDomain: 'general' | 'academic' | 'technical' | 'business' | 'email';
  rewriteTone:
    | 'preserveVoice'
    | 'neutral'
    | 'professional'
    | 'warm'
    | 'assertive'
    | 'cautious'
    | 'diplomatic'
    | 'formal'
    | 'direct'
    | 'plainLanguage';
  rewriteRhetoricalMode:
    | 'preserveOriginal'
    | 'explain'
    | 'persuade'
    | 'recommend'
    | 'constructivelyChallenge';
  preserveFormatting: boolean;
  includeChangeNotes: boolean;
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
  readAloudProvider: 'windowsLocal' | 'edgeOnline';
  edgeReadAloudVoice: string;
  edgeReadAloudRatePercent: number;
  edgeReadAloudPythonCommand: string;
  credentialPresence?: Partial<Record<KrenCredentialId, boolean>>;
  extensionVersion: string;
}

export type KrenCredentialId =
  | 'geminiDefault'
  | 'geminiAlternate'
  | 'googleCloudTranslation'
  | 'openai'
  | 'anthropic'
  | 'merriamWebsterCollegiate'
  | 'merriamWebsterThesaurus'
  | 'koreanDictionary';

const providerNames: Record<string, string> = {
  harper: 'Harper (offline)',
  gemini: 'Gemini',
  googleCloudTranslation: 'Google Cloud Translation',
  koreanBasicDictionary: 'Korean Basic Dictionary',
  merriamWebsterCollegiate: "Merriam-Webster's Collegiate® Dictionary",
  merriamWebsterThesaurus: "Merriam-Webster's Collegiate® Thesaurus"
};

export function renderKrenResultViewHtml(options: ResultViewHtmlOptions): string {
  const audio = options.autoplayAudio && isAllowedPronunciationUrl(options.autoplayAudio.url)
    ? options.autoplayAudio
    : undefined;
  const body = options.activeScreen !== 'start' && options.result && options.sourceText !== undefined
    ? renderPopulatedView(
      options.result,
      options.sourceText,
      Boolean(options.allowReplace),
      options.settings,
      options.brandImageUri,
      options.googleAttributionImageUri
    )
    : renderEmptyView(options.settings, options.brandImageUri);
  const settingsView = renderSettings(
    options.settings,
    options.proModels,
    options.openAIModels ?? [{ id: options.settings.openAIModel, displayName: options.settings.openAIModel }],
    options.anthropicModels ?? [
      { id: options.settings.anthropicModel, displayName: options.settings.anthropicModel }
    ],
    options.brandImageUri
  );
  const manualView = renderManual(options.settings.extensionVersion, options.brandImageUri);
  const initialAudio = audio
    ? `src="${escapeHtml(audio.url)}" autoplay data-headword="${escapeHtml(audio.headword)}"`
    : '';
  const audioClass = audio ? 'audio-player' : 'audio-player hidden';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${options.cspSource} https://dictionaryapi.com; media-src https://media.merriam-webster.com data:; style-src ${options.cspSource} 'nonce-${options.nonce}'; script-src 'nonce-${options.nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style nonce="${options.nonce}">
    :root { color-scheme: light dark; }
    body { margin: 0; padding: 18px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-family: var(--vscode-font-family); line-height: 1.5; }
    .shell { max-width: 980px; margin: 0 auto; }
    .top { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .top-main { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex: 1; min-width: 0; }
    .top-actions { display: flex; align-items: center; gap: 5px; }
    .icon-button { display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0; border-color: transparent; color: var(--vscode-foreground); background: transparent; font-size: 1rem; }
    .icon-button:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
    .brand { display: flex; align-items: center; gap: 10px; min-width: 0; font-size: 1.05rem; font-weight: 800; letter-spacing: .05em; }
    .brand-logo { width: 36px; height: 36px; flex: 0 0 auto; border-radius: 8px; object-fit: cover; }
    .intro-header { margin-bottom: 28px; }
    .intro-header .brand { gap: 15px; font-size: clamp(2.2rem, 9vw, 4.2rem); color: var(--vscode-descriptionForeground); letter-spacing: -.03em; }
    .intro-header .brand-logo { width: clamp(68px, 18vw, 104px); height: clamp(68px, 18vw, 104px); border-radius: 13px; }
    .menu-wrap { position: relative; }
    .menu-button { font-size: 1.35rem; line-height: 1; }
    .menu-popover { position: absolute; z-index: 20; top: 36px; right: 0; min-width: 170px; padding: 6px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 7px; background: var(--vscode-menu-background, var(--vscode-editor-background)); box-shadow: 0 5px 18px var(--vscode-widget-shadow, rgba(0,0,0,.25)); }
    .menu-item { display: block; width: 100%; border: 0; padding: 8px 10px; text-align: left; color: var(--vscode-menu-foreground, var(--vscode-foreground)); background: transparent; }
    .menu-item:hover { color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground)); background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground)); }
    .provider { display: flex; align-items: center; justify-content: flex-end; gap: 7px; color: var(--vscode-descriptionForeground); font-size: .82rem; text-align: right; }
    .provider-logo { width: 50px; height: 50px; object-fit: contain; background: white; border-radius: 3px; }
    .provider-attribution { margin: 14px 0 0; color: var(--vscode-descriptionForeground); font-size: .78rem; }
    .google-attribution { display: block; width: 176px; height: 16px; margin-bottom: 7px; }
    .provider-disclaimer { margin-top: 6px; }
    .card { border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 8px; background: var(--vscode-editor-background); margin: 0 0 14px; overflow: hidden; }
    .card-title { margin: 0; padding: 9px 13px; font-size: .78rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--vscode-descriptionForeground); background: var(--vscode-sideBarSectionHeader-background); border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
    .card-body { padding: 14px; }
    .source { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--vscode-font-family); font-size: .95rem; }
    .translation { font-size: 1.15rem; white-space: pre-wrap; overflow-wrap: anywhere; }
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
    .variant-tabs { display: flex; gap: 4px; margin-bottom: 12px; padding: 3px; border-radius: 6px; background: var(--vscode-sideBarSectionHeader-background); overflow-x: auto; }
    .variant-tab { flex: 1 0 auto; color: var(--vscode-foreground); background: transparent; border-color: transparent; }
    .variant-tab.active { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    .rewrite-variant { margin: 0; padding: 13px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 7px; background: var(--vscode-editor-background); }
    .rewrite-variant h3 { margin: 0 0 8px; color: var(--vscode-textLink-foreground); }
    .rewrite-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .change-note { margin: 12px 0 0; padding: 9px 10px; border-left: 3px solid var(--vscode-textLink-foreground); color: var(--vscode-descriptionForeground); background: var(--vscode-textBlockQuote-background); }
    .model-note { margin: 0 0 12px; padding: 9px 10px; border-radius: 6px; color: var(--vscode-descriptionForeground); background: var(--vscode-textBlockQuote-background); font-size: .82rem; }
    .grammar-summary { margin: 0 0 12px; color: var(--vscode-descriptionForeground); }
    .grammar-issue { margin: 0 0 12px; padding: 12px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 7px; }
    .grammar-issue:last-child { margin-bottom: 0; }
    .grammar-issue legend { padding: 0 6px; color: var(--vscode-textLink-foreground); font-weight: 700; }
    .grammar-problem { display: inline-block; margin: 4px 0 9px; padding: 2px 6px; border-radius: 3px; background: var(--vscode-textCodeBlock-background); font-family: var(--vscode-editor-font-family); }
    .grammar-options { display: grid; gap: 6px; }
    .grammar-option { display: flex; align-items: flex-start; gap: 7px; padding: 6px 8px; border-radius: 5px; background: var(--vscode-sideBarSectionHeader-background); cursor: pointer; }
    .grammar-option:has(input:checked) { outline: 1px solid var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .result-meta { color: var(--vscode-descriptionForeground); font-size: .78rem; font-weight: 400; letter-spacing: 0; text-transform: none; }
    .variant-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 11px; }
    .tts-status { align-self: center; color: var(--vscode-descriptionForeground); font-size: .78rem; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; position: sticky; bottom: 0; padding: 10px 0 2px; background: var(--vscode-sideBar-background); }
    button { border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px; padding: 6px 11px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; font: inherit; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button:disabled, button:disabled:hover { opacity: 0.45; cursor: default; background: var(--vscode-button-secondaryBackground); }
    button.audio { padding: 2px 7px; margin-left: 5px; vertical-align: middle; }
    .audio-player { width: 100%; margin: 0 0 14px; }
    .hidden { display: none; }
    .empty { padding: 28px 18px; text-align: center; color: var(--vscode-descriptionForeground); }
    .settings-screen h2 { margin: 0 0 4px; font-size: 1.2rem; }
    .settings-intro { margin: 0 0 16px; color: var(--vscode-descriptionForeground); }
    .settings-group { margin-bottom: 14px; padding: 13px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 8px; background: var(--vscode-editor-background); }
    .settings-group h3 { margin: 0 0 11px; font-size: .9rem; }
    .setting { display: grid; grid-template-columns: minmax(0, 1fr) minmax(120px, 42%); align-items: center; gap: 12px; padding: 9px 0; border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
    .setting:first-of-type { border-top: 0; padding-top: 0; }
    .setting:last-child { padding-bottom: 0; }
    .setting-title { display: block; font-weight: 600; }
    .setting-description { display: block; margin-top: 2px; color: var(--vscode-descriptionForeground); font-size: .78rem; }
    select, input[type='text'], input[type='number'] { width: 100%; min-width: 0; box-sizing: border-box; padding: 5px 7px; border: 1px solid var(--vscode-input-border, transparent); color: var(--vscode-input-foreground); background: var(--vscode-input-background); font: inherit; }
    .switch { position: relative; justify-self: end; width: 38px; height: 22px; }
    .switch input { position: absolute; opacity: 0; }
    .slider { position: absolute; inset: 0; border-radius: 999px; background: var(--vscode-input-background); border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); cursor: pointer; transition: .15s; }
    .slider::before { content: ''; position: absolute; width: 16px; height: 16px; left: 2px; top: 2px; border-radius: 50%; background: var(--vscode-descriptionForeground); transition: .15s; }
    .switch input:checked + .slider { background: var(--vscode-button-background); }
    .switch input:checked + .slider::before { transform: translateX(16px); background: var(--vscode-button-foreground); }
    .settings-buttons { display: flex; flex-wrap: wrap; gap: 7px; }
    .credential-row { display: grid; grid-template-columns: minmax(145px, 1fr) 2fr; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
    .credential-row:last-of-type { border-bottom: 0; }
    .credential-status { margin-left: 5px; color: var(--vscode-descriptionForeground); font-size: 0.82em; font-weight: 400; }
    .credential-label { font-weight: 650; }
    .setting-control { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .setting-control input { flex: 1; }
    .setting-control button { flex: 0 0 auto; padding: 5px 8px; }
    .conditional-group { margin-top: 4px; }
    .conditional-group.hidden { display: none; }
    .welcome { padding: clamp(16px, 4vw, 28px); text-align: left; }
    .welcome-lead { margin: 0 0 24px; font-size: .95rem; line-height: 1.5; }
    .welcome-layout { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(150px, .8fr); gap: clamp(18px, 5vw, 42px); align-items: start; }
    .welcome-flow { display: grid; gap: 14px; }
    .welcome-step { padding: 16px 18px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 22px; background: var(--vscode-textBlockQuote-background, var(--vscode-editor-background)); }
    .welcome-step strong { display: block; margin-bottom: 8px; color: var(--vscode-textLink-foreground); font-size: 1.15rem; }
    .welcome-step span { display: block; line-height: 1.45; }
    .capability-grid { display: grid; gap: 10px; }
    .capability { padding: 8px 12px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); font-size: .95rem; }
    .privacy-note { margin: 24px 5px 0; color: var(--vscode-descriptionForeground); font-size: .95rem; line-height: 1.5; }
    .credits { margin: 16px 0 0; padding-top: 10px; border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); color: var(--vscode-descriptionForeground); font-size: .74rem; text-align: left; }
    .manual-screen { line-height: 1.55; }
    .manual-screen h2 { margin: 14px 0 5px; }
    .manual-screen h3 { margin: 18px 0 5px; color: var(--vscode-textLink-foreground); }
    .manual-screen .manual-nav { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
    .manual-screen code { padding: 1px 4px; border-radius: 3px; background: var(--vscode-textCodeBlock-background); }
    ul { margin-top: 7px; }
    @media (max-width: 520px) { body { padding: 10px; } .top:not(.intro-header) { align-items: flex-start; flex-direction: column; } .intro-header { align-items: center; } .provider { text-align: left; } .welcome-layout { grid-template-columns: 1fr; } .capability-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  </style>
</head>
<body>
  <main class="shell">
    <section id="result-screen" class="result-screen${options.activeScreen === 'settings' || options.activeScreen === 'manual' ? ' hidden' : ''}">${body}</section>
    <section id="settings-screen" class="settings-screen${options.activeScreen === 'settings' ? '' : ' hidden'}">${settingsView}</section>
    <section id="manual-screen" class="manual-screen${options.activeScreen === 'manual' ? '' : ' hidden'}">${manualView}</section>
    <audio id="kren-audio" class="${audioClass}" controls ${initialAudio}></audio>
  </main>
  <script nonce="${options.nonce}">
    const vscode = acquireVsCodeApi();
    const player = document.getElementById('kren-audio');
    let playerMode = 'idle';
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
    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('button') : null;
      const menus = Array.from(document.querySelectorAll('[data-menu-popover]'));
      if (!target) {
        menus.forEach((menu) => menu.classList.add('hidden'));
        return;
      }
      if (target.hasAttribute('data-menu-toggle')) {
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
      if (command === 'applyGrammar' || command === 'copyGrammar') {
        const grammarChoices = Array.from(document.querySelectorAll('[data-grammar-choice]:checked'))
          .map((choice) => ({
            issueId: choice.getAttribute('data-grammar-issue') || '',
            suggestionIndex: Number(choice.getAttribute('data-grammar-choice'))
          }));
        vscode.postMessage({ command, grammarChoices });
        return;
      }
      if (command) vscode.postMessage({
        command,
        variantId: target.getAttribute('data-variant-id') || undefined,
        action: target.getAttribute('data-action') || undefined
      });
      const variantId = target.getAttribute('data-variant-tab');
      if (variantId) {
        document.querySelectorAll('[data-variant-tab]').forEach((tab) => tab.classList.toggle('active', tab === target));
        document.querySelectorAll('[data-variant-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.getAttribute('data-variant-panel') !== variantId));
      }
      const audioUrl = target.getAttribute('data-audio-url');
      if (audioUrl) void playPronunciation(audioUrl, false);
    });
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message) return;
      if (message.command === 'playPronunciation' && typeof message.url === 'string') {
        void playPronunciation(message.url, true);
      }
      if (message.command === 'playGeneratedAudio' &&
          typeof message.audioBase64 === 'string' && player instanceof HTMLAudioElement) {
        player.pause();
        playerMode = 'generated';
        player.classList.add('hidden');
        player.src = 'data:audio/mpeg;base64,' + message.audioBase64;
        player.volume = 1;
        void player.play().catch(() => {
          playerMode = 'idle';
          vscode.postMessage({ command: 'generatedAudioFailed' });
        });
      }
      if (message.command === 'stopGeneratedAudio' &&
          player instanceof HTMLAudioElement && playerMode === 'generated') {
        player.pause();
        player.removeAttribute('src');
        player.load();
        playerMode = 'idle';
      }
    });
    if (player instanceof HTMLAudioElement) {
      player.addEventListener('ended', () => {
        if (playerMode !== 'generated') return;
        playerMode = 'idle';
        vscode.postMessage({ command: 'generatedAudioEnded' });
      });
      player.addEventListener('error', () => {
        if (playerMode !== 'generated') return;
        playerMode = 'idle';
        vscode.postMessage({ command: 'generatedAudioFailed' });
      });
    }
    document.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
      if (target.hasAttribute('data-grammar-choice')) {
        const hasCorrection = Array.from(document.querySelectorAll('[data-grammar-choice]:checked'))
          .some((choice) => Number(choice.getAttribute('data-grammar-choice')) >= 0);
        document.querySelectorAll('[data-grammar-action]').forEach((button) => {
          if (button instanceof HTMLButtonElement) button.disabled = !hasCorrection;
        });
        return;
      }
      if (target instanceof HTMLSelectElement && target.hasAttribute('data-edge-voice-preset')) {
        if (target.value === '__custom__') return;
        const input = document.querySelector('[data-setting="readAloud.edgeVoice"]');
        if (input instanceof HTMLInputElement) input.value = target.value;
        vscode.postMessage({ command: 'updateSetting', key: 'readAloud.edgeVoice', value: target.value });
        return;
      }
      const preset = target.getAttribute('data-preset');
      if (preset && target instanceof HTMLInputElement && target.type === 'checkbox' && target.checked) {
        if (preset === 'explain-gemini') {
          vscode.postMessage({ command: 'updateSetting', key: 'explanation.provider', value: 'gemini' });
        }
        if (preset === 'rewrite-gemini-default') {
          vscode.postMessage({ command: 'updateSetting', key: 'rewrite.provider', value: 'gemini' });
          vscode.postMessage({ command: 'updateSetting', key: 'rewrite.geminiProfile', value: 'standard' });
        }
        applyConditionalSettings();
        return;
      }
      const key = target.getAttribute('data-setting');
      if (!key) return;
      const value = target instanceof HTMLInputElement && target.type === 'checkbox'
        ? target.checked
        : target instanceof HTMLInputElement && target.type === 'number'
          ? Number(target.value)
          : target.value;
      vscode.postMessage({ command: 'updateSetting', key, value });
      applyConditionalSettings();
    });
    function settingValue(key) {
      const input = document.querySelector('[data-setting="' + key + '"]');
      return input instanceof HTMLInputElement && input.type === 'checkbox'
        ? input.checked
        : input instanceof HTMLInputElement || input instanceof HTMLSelectElement
          ? input.value
          : undefined;
    }
    function applyConditionalSettings() {
      document.querySelectorAll('[data-provider-for]').forEach((group) => {
        const key = group.getAttribute('data-provider-for');
        const expected = group.getAttribute('data-provider-value');
        group.classList.toggle('hidden', !key || !expected || settingValue(key) !== expected);
      });
      document.querySelectorAll('[data-gemini-profile-for]').forEach((group) => {
        const key = group.getAttribute('data-gemini-profile-for');
        const expected = group.getAttribute('data-gemini-profile-value');
        group.classList.toggle('hidden', !key || !expected || settingValue(key) !== expected);
      });
    }
    applyConditionalSettings();
  </script>
</body>
</html>`;
}

function renderPopulatedView(
  result: KrenResult,
  sourceText: string,
  allowReplace: boolean,
  settings: KrenPanelSettings,
  brandImageUri: string | undefined,
  googleAttributionImageUri: string | undefined
): string {
  const provider = escapeHtml(providerNames[result.providerId] ?? result.providerId);
  const modelId = result.kind === 'rewrite' || result.kind === 'translation'
    ? result.modelId
    : undefined;
  const model = modelId
    ? `<span>${escapeHtml(modelId)}</span>`
    : `<span>${provider}</span>`;
  const resultHtml = result.kind === 'translation'
    ? renderTranslation(result)
    : result.kind === 'dictionary'
      ? renderDictionary(result)
      : result.kind === 'thesaurus'
        ? renderThesaurus(result)
        : result.kind === 'grammar'
          ? renderGrammar(result)
          : renderRewrite(result, allowReplace, settings);
  const actions = result.kind === 'rewrite'
    ? '<button class="secondary" data-command="details">Open full details</button>'
    : result.kind === 'grammar'
      ? grammarActions(result, allowReplace)
    : `<button data-command="copy">Copy result</button>
       <button class="secondary" data-command="details">Open full details</button>
       ${allowReplace && result.kind === 'translation' ? '<button class="secondary" data-command="replace">Replace selection</button>' : ''}`;
  const resultTitle = result.kind === 'rewrite'
    ? `Result <span class="result-meta">| Language: <strong>${escapeHtml(languageName(result.sourceLanguage))}</strong> | ${isEnglishLanguageCode(result.sourceLanguage) ? `English: <strong>${escapeHtml(rewriteEnglishVarietyLabel(result.englishVariety))}</strong> | ` : ''}Domain: <strong>${escapeHtml(rewriteDomainLabel(result.domain))}</strong> | Tone: <strong>${escapeHtml(rewriteToneLabel(result.tone))}</strong> | Mode: <strong>${escapeHtml(rewriteRhetoricalModeLabel(result.rhetoricalMode))}</strong> |</span>`
    : 'Result';
  const attribution = renderProviderAttribution(result.providerId, googleAttributionImageUri);
  return `${renderHeader(`<div class="provider">${renderProviderLogo(result.providerId)}${model}</div>`, true, brandImageUri)}
  <section class="card">
    <h2 class="card-title">Input</h2>
    <div class="card-body"><pre class="source">${escapeHtml(sourceText)}</pre></div>
  </section>
  <section class="card">
    <h2 class="card-title">${resultTitle}</h2>
    <div class="card-body">${resultHtml}${attribution}</div>
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

function renderProviderLogo(providerId: string): string {
  if (!providerId.startsWith('merriamWebster')) return '';
  return '<img class="provider-logo" src="https://dictionaryapi.com/images/info/branding-guidelines/MWLogo_LightBG_120x120_2x.png" alt="Merriam-Webster logo">';
}

function renderEmptyView(
  settings: KrenPanelSettings,
  brandImageUri: string | undefined
): string {
  return `${renderHeader('', false, brandImageUri, true)}
  <section class="card welcome">
    <p class="welcome-lead"><strong>KREN is a privacy-conscious language workbench for dictionaries, offline grammar checking, translation, nuance, multilingual rewriting, and read-aloud inside VS Code.</strong></p>
    <div class="welcome-layout">
      <div class="welcome-flow">
        <div class="welcome-step"><strong>1. Select or copy</strong><span>Select editor text, or copy text from chat, terminals, and other panels.</span></div>
        <div class="welcome-step"><strong>2. Choose an action</strong><span>Right-click the selection, or click <strong>KREN</strong> in the status bar for clipboard text.</span></div>
        <div class="welcome-step"><strong>3. Use the result</strong><span>Read, compare, copy, replace eligible text, hear pronunciation, or open full details.</span></div>
      </div>
      <div class="capability-grid" aria-label="KREN capabilities">
        <span class="capability">English Dictionary</span><span class="capability">Synonyms</span><span class="capability">Korean Dictionary</span><span class="capability">Translation</span><span class="capability">Explain Nuance</span><span class="capability">Grammar Check</span><span class="capability">Rewrite</span><span class="capability">Read Aloud</span>
      </div>
    </div>
    <p class="privacy-note">Passive hovering sends nothing. Remote services receive only text you explicitly submit. Use the menu above for the User Manual and Settings.</p>
    <p class="credits">Designed by Masstransferase &amp; developed using CODEX · Version ${escapeHtml(settings.extensionVersion)}</p>
  </section>`;
}

function renderHeader(
  provider: string,
  canClear: boolean,
  brandImageUri: string | undefined,
  prominent = false
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
      ${canClear ? '<button class="icon-button" data-command="clear" title="Clear KREN result" aria-label="Clear KREN result">&#10005;</button>' : ''}
      <div class="menu-wrap">
        <button class="icon-button menu-button" data-menu-toggle title="KREN menu" aria-label="Open KREN menu" aria-haspopup="true" aria-expanded="false">&#9776;</button>
        <div class="menu-popover hidden" data-menu-popover role="menu">
          <button class="menu-item" data-command="showStartPage" role="menuitem">Start Page</button>
          <button class="menu-item" data-command="showManual" role="menuitem">User Manual</button>
          <button class="menu-item" data-command="showSettings" role="menuitem">Settings</button>
        </div>
      </div>
    </div>
  </header>`;
}

function renderManual(version: string, brandImageUri: string | undefined): string {
  return `${renderHeader('', false, brandImageUri)}
    <button class="secondary" data-command="showResult" aria-label="Back to KREN result">&#8592; Back to KREN</button>
    <h2>KREN User Manual</h2>
    <p class="settings-intro">Version ${escapeHtml(version)} · KREN works only with text you explicitly select, copy, or submit.</p>

    <h3>Requirements</h3>
    <ul>
      <li><strong>Base:</strong> VS Code Desktop 1.106 or later and an installed KREN extension. KREN is not a browser-only <code>vscode.dev</code> extension.</li>
      <li><strong>Offline Grammar Check:</strong> no API key, account, Python, Node.js, GPU, or network connection is required. Node.js and npm are development requirements only.</li>
      <li><strong>Dictionaries:</strong> obtain and enter your own Merriam-Webster Collegiate Dictionary and Collegiate Thesaurus API keys; Korean Dictionary requires your own Korean Basic Dictionary Open API key. KREN includes no shared API keys.</li>
      <li><strong>Translation:</strong> a Google Cloud Translation Basic v2 key is required by default, or a Gemini key when Gemini translation is selected.</li>
      <li><strong>Explain and Rewrite:</strong> a key for the selected Gemini, OpenAI API, or Anthropic API provider. Consumer ChatGPT, Claude, Gemini app, or Google One subscriptions do not automatically include API credits.</li>
      <li><strong>Network:</strong> outbound HTTPS from the extension host is required for online providers, Merriam-Webster audio, and Edge Online speech. Proxies, VPNs, firewalls, and provider quotas can affect access.</li>
      <li><strong>Windows audio:</strong> Read Aloud requires a local Windows extension host, PowerShell, Windows System.Speech, and an installed voice. Edge Online additionally requires working Python, <code>edge-tts</code>, network access, and first-use consent.</li>
      <li><strong>Remote workspaces:</strong> Windows-native speech is unavailable in WSL, SSH, Dev Containers, Codespaces, and other remote extension hosts. Online calls originate from that remote host.</li>
    </ul>
    <p>Configure only the keys for features you use. KREN stores keys in VS Code Secret Storage, never in project files or this panel. Merriam-Webster's free developer terms limit reference APIs and daily queries. Third-party API billing and terms remain authoritative.</p>

    <h3>Quick start</h3>
    <ol>
      <li>Select text in an editor and right-click a KREN action.</li>
      <li>For text in chat, Claude Code, Codex, terminals, or output panels, copy it and click <strong>KREN</strong> in the status bar.</li>
      <li>Review the rich result, then Copy, explicitly Replace where eligible, hear audio, or open full details.</li>
    </ol>
    <p>KREN reads the clipboard only after you click the status item. It does not monitor clipboard changes or inspect another extension's private view.</p>

    <h3>Available actions</h3>
    <ul>
      <li><strong>English Dictionary Search:</strong> structured Merriam-Webster Collegiate entries, forms, examples, pronunciation, and usage discussions.</li>
      <li><strong>Synonyms Search:</strong> sense-grouped synonyms, near synonyms, related words, phrases, and antonyms.</li>
      <li><strong>Korean Dictionary Search:</strong> Basic Korean Dictionary definitions and English explanations, attributed to the National Institute of Korean Language under CC BY-SA.</li>
      <li><strong>Translate:</strong> automatic input detection and your selected output language.</li>
      <li><strong>Explain Meaning or Nuance:</strong> contextual meaning, connotation, register, ambiguity, and technical usage.</li>
      <li><strong>Grammar Check:</strong> private, offline English spelling and grammar review in a background worker, with user-selected corrections, a local custom dictionary, privacy-preserving ignored findings, and optional current-paragraph auto-check.</li>
      <li><strong>Rewrite Text:</strong> Detects and preserves the source language. Natural, Concise, and Jargon-Free variants use the selected domain, tone, and rhetorical mode; English variety applies only to English.</li>
      <li><strong>Read Aloud:</strong> speak a cleaned copy of selected text without changing the document.</li>
    </ul>

    <h3>Dictionaries</h3>
    <p>Dictionary Search is ordered English, Synonyms, then Korean. Each user must obtain and enter their own separate Merriam-Webster Collegiate Dictionary and Collegiate Thesaurus keys. English Dictionary preserves provider hierarchy rather than reducing entries to three meanings. For a multi-word expression only, KREN can use Google Cloud Translation after Merriam-Webster returns no entry; provider errors never trigger that fallback. Dictionary results are lookup-only and cannot replace editor text.</p>

    <h3>Grammar Check workflow</h3>
    <p>Select English text and run Grammar Check. KREN underlines findings without forcing this panel open. Right-click an underline and choose <strong>Quick Fix...</strong> for corrections, Add to local dictionary, Ignore this finding, or More details. Every edit revalidates the unchanged checked range and then rechecks it. The panel starts each finding at Keep original; clipboard checks can copy corrections but cannot replace an editor range.</p>
    <p>Automatic paragraph checking is off by default and remains local. Added words and privacy-preserving ignored hashes are stored in VS Code global storage; checked passages are not stored. Harper is rule-based, so review every suggestion.</p>

    <h3>Translation and explanation</h3>
    <p>Translation detects input automatically. The default Auto English-Korean target sends English to Korean and Korean to English; a fixed output language remains available. Google Translate powers Cloud Translation API results, which display the required linked attribution and an available disclaimer. Explanation can use a selected language or English/Korean bilingual output. Gemini, OpenAI, and Anthropic are selected independently for Explain and Rewrite. Gemini also offers independently selected Default or Alternate profiles for Explain and Rewrite. KREN never silently sends text to a different company, and model discovery or connection tests send no selected document text.</p>

    <h3>Rewrite Text</h3>
    <p>Rewrite Text detects and preserves the source language; it does not translate. For short or mixed-language text, select the source language manually in Settings. Choose Natural, Concise, Jargon-Free, or all three. Domain, tone, and rhetorical mode apply across languages. English variety applies only to English. <strong>Preserve My Voice</strong> and <strong>Preserve Original</strong> are the safest defaults. Formatting protection covers Markdown, LaTeX, citations, links, placeholders, filenames, and code. AI output can still be wrong; verify facts, numbers, citations, terminology, language, and intended tone before replacement.</p>
    <p>Rewrite and Explain depend on remote model availability. Repeating a request often resolves a temporary provider or network failure. High thinking or effort settings can take substantially longer; Auto or Low is usually sufficient for routine editing.</p>

    <h3>Copy and replacement safety</h3>
    <ul>
      <li>Translation and rewrite results from an editor can replace only the original unchanged selection; clipboard results can only be copied.</li>
      <li>Rewrite variants have separate Copy and guarded Replace controls.</li>
      <li>Grammar changes are opt-in per issue and rejected when the checked text is stale.</li>
      <li>Dictionary, thesaurus, Korean dictionary, and explanation results are not replaceable.</li>
    </ul>

    <h3>Read Aloud and pronunciation</h3>
    <ul>
      <li><strong>Local Windows:</strong> offline System.Speech voices; selected text stays on this PC.</li>
      <li><strong>Microsoft Edge Online:</strong> optional experimental natural voices such as Christopher and Ava. Install with <code>python -m pip install edge-tts</code>. Only KREN's cleaned speech copy is sent to Microsoft through the unofficial package. It is disabled in Restricted Mode because it launches the configured machine-scoped Python executable.</li>
      <li>KREN removes common Markdown, task-checkbox, URL, HTML, code-fence, and citation artifacts from the speech copy.</li>
      <li>Press <code>Esc</code> while KREN speech is active, or use a Stop control in the panel. Edge audio uses a temporary MP3 that is deleted after playback.</li>
      <li>Dictionary pronunciation audio comes from Merriam-Webster and normally plays through a hidden Windows player. Other platforms, remote hosts, and native failures use the constrained panel player when possible.</li>
    </ul>

    <h3>Providers and credentials</h3>
    <p>Store keys through KREN commands or Settings; VS Code Secret Storage keeps them outside the webview and project files. KREN shows only Stored or Not set, never a key value. Remove an existing key before setting its replacement. Settings provides individual Remove key controls and a confirmed Delete all stored API keys action. Settings are grouped by Translation, Grammar, Explain, Rewrite, Read Aloud, Dictionary, and Credentials. They control languages, providers, editable models, thinking/effort, retries, Gemini profiles/fallback, rewrite style, grammar, speech, and phrase fallback.</p>
    <p>KREN also registers five confirmed VS Code language-model tools: English Dictionary, Korean Dictionary, Synonyms, Translate, and Explain. Tools receive only their explicit text argument. KREN does not bundle an MCP server.</p>
    <p>Current provider disclosures: Google's current <a href="https://ai.google.dev/gemini-api/terms">Gemini API Terms</a> require API users to be at least 18, use it for professional or business purposes, and comply with regional restrictions. Gemini is available only in <a href="https://ai.google.dev/gemini-api/docs/available-regions">regions listed by Google</a>. KREN asks for confirmation before first Gemini use. OpenAI standard abuse-monitoring logs may be retained for 30 days even with <code>store: false</code>. Anthropic standard API inputs and outputs are normally deleted within 30 days, with policy and legal exceptions. Provider terms remain authoritative.</p>

    <h3>Privacy, storage, limits, and cost</h3>
    <ul>
      <li>KREN never sends passive hover text, surrounding document content, filenames, workspace data, open tabs, source-control data, or chat history.</li>
      <li>Remote operations send only the explicitly submitted text, fixed KREN instructions, and chosen settings.</li>
      <li>KREN collects no telemetry and keeps no operation history. The latest result remains in memory until cleared, replaced, or the extension host stops. Open Full Details writes a copy to the KREN Output channel, which VS Code may preserve in session logs.</li>
      <li>Custom grammar words, ignored hashes, consent flags, and Cloud usage are the relevant global-storage data.</li>
      <li>The shared submitted-text limit defaults to 5,000 characters and can be set from 1 to 20,000. The timeout defaults to 45 seconds and can be set from 1 to 120 seconds.</li>
      <li>Google Cloud Translation has KREN's conservative local 500,000-character monthly ceiling, but provider-side quotas and billing are authoritative.</li>
      <li>Retries can repeat billable requests. Same-provider fallback is explicit and identified; KREN never falls back across companies.</li>
    </ul>

    <h3>Panel placement and troubleshooting</h3>
    <p>Use the hamburger menu for Start Page, User Manual, and Settings; Clear removes the current in-memory result and grammar findings. For online failures, verify the matching key, API enablement, model, network path from the extension host, quota/billing, retries, and timeout.</p>
    <p>To uninstall cleanly, use Settings to remove individual keys or Delete all stored API keys, clear optional grammar data, uninstall, and remove <code>masstransferase.kren-translate</code> global storage if you also want consent flags and the Cloud usage ledger removed. Uninstalling alone is not KREN's credential-removal workflow.</p>

    <h3>Known limitations</h3>
    <ul>
      <li>Grammar Check is English-focused and rule-based. Rewrite Text supports multilingual input and does not translate it.</li>
      <li>Korean Dictionary accepts one Korean headword; the other dictionary products are English-specific.</li>
      <li>Read Aloud is limited to a local Windows extension host, and Edge Online relies on an unofficial service interface.</li>
      <li>Models, access, quotas, pricing, permitted use, and retention can change. AI output is informational, not professional advice.</li>
    </ul>
    <p>KREN opens in the Secondary Sidebar by default. Click KREN in the status bar to show KREN or hide the Secondary Sidebar. If an online provider fails, verify its key, model, network connection, retry settings, and provider quota. For Christopher or Ava, verify <code>python -m pip install edge-tts</code> and use Preview in Settings.</p>

    <p class="credits">Designed by Masstransferase &amp; developed using CODEX · Version ${escapeHtml(version)}</p>`;
}

function renderTranslation(result: Extract<KrenResult, { kind: 'translation' }>): string {
  const alternatives = result.alternatives?.length
    ? `<h3>Alternatives</h3><ul>${result.alternatives.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '';
  const note = result.note ? `<p class="note">${escapeHtml(result.note)}</p>` : '';
  const fallbackNote = result.fallbackFromModel
    ? `<div class="model-note">Fallback used after <strong>${escapeHtml(result.fallbackFromModel)}</strong> could not produce a usable result.</div>`
    : '';
  return `<div class="direction">${escapeHtml(languageName(result.sourceLanguage))} → ${escapeHtml(languageName(result.targetLanguage))}</div>
    ${fallbackNote}<p class="translation">${escapeHtml(result.translatedText)}</p>${alternatives}${note}`;
}

function renderGrammar(result: GrammarResult): string {
  if (!result.issues.length) {
    return '<p><strong>No spelling or grammar issues found.</strong></p><p class="muted">Harper is a local rule-based checker; a clean result is not a guarantee that every possible issue was detected.</p>';
  }
  return `<p class="grammar-summary"><strong>${result.issues.length}</strong> possible issue${result.issues.length === 1 ? '' : 's'} found. Keep original is selected by default; KREN changes nothing until you choose corrections below.</p>
    ${result.issues.map((issue, issueIndex) => `<fieldset class="grammar-issue">
      <legend>${issueIndex + 1}. ${escapeHtml(issue.category)}</legend>
      <div>${escapeHtml(issue.message)}</div>
      <div class="grammar-problem">${escapeHtml(issue.original || '(insertion point)')}</div>
      <div class="grammar-options">
        <label class="grammar-option"><input type="radio" name="grammar-${escapeHtml(issue.id)}" data-grammar-issue="${escapeHtml(issue.id)}" data-grammar-choice="-1" checked> <span>Keep original</span></label>
        ${issue.suggestions.map((suggestion, suggestionIndex) => `<label class="grammar-option"><input type="radio" name="grammar-${escapeHtml(issue.id)}" data-grammar-issue="${escapeHtml(issue.id)}" data-grammar-choice="${suggestionIndex}"> <span>${escapeHtml(suggestion.label)}</span></label>`).join('')}
      </div>
      <div class="settings-buttons">
        ${/spell/iu.test(issue.category) && /^[\p{L}][\p{L}\p{M}'’-]*$/u.test(issue.original.trim()) ? `<button class="secondary" data-command="addGrammarWord" data-grammar-issue="${escapeHtml(issue.id)}">Add to local dictionary</button>` : ''}
        ${issue.ignoreHash ? `<button class="secondary" data-command="ignoreGrammarIssue" data-grammar-issue="${escapeHtml(issue.id)}">Ignore this finding</button>` : ''}
      </div>
    </fieldset>`).join('')}`;
}

function grammarActions(result: GrammarResult, allowReplace: boolean): string {
  if (!result.issues.some((issue) => issue.suggestions.length > 0)) {
    return '<button data-command="copy">Copy checked text</button><button class="secondary" data-command="details">Open full details</button>';
  }
  return `${allowReplace ? '<button data-command="applyGrammar" data-grammar-action disabled>Apply selected corrections</button>' : ''}
    <button class="secondary" data-command="copyGrammar" data-grammar-action disabled>Copy selected corrections</button>
    <button class="secondary" data-command="details">Open full details</button>`;
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
  const preferred = settings.preferredRewriteVariant;
  const selected = result.variants.some((variant) => variant.id === preferred)
    ? preferred
    : result.variants[0]?.id;
  const tabs = result.variants.length > 1
    ? `<div class="variant-tabs" role="tablist" aria-label="Rewrite style">${result.variants.map((variant) => `<button class="variant-tab${variant.id === selected ? ' active' : ''}" data-variant-tab="${variant.id}" role="tab" aria-selected="${variant.id === selected}">${escapeHtml(variant.label)}</button>`).join('')}</div>`
    : '';
  const panels = result.variants.map((variant) => `<article class="rewrite-variant${variant.id === selected ? '' : ' hidden'}" data-variant-panel="${variant.id}" role="tabpanel">
    <h3>${escapeHtml(variant.label)}</h3>
    <p class="rewrite-text">${escapeHtml(variant.text)}</p>
    ${variant.changeNote ? `<p class="change-note"><strong>What changed:</strong> ${escapeHtml(variant.changeNote)}</p>` : ''}
    <div class="variant-actions">
      <button data-command="copyVariant" data-variant-id="${variant.id}">Copy ${escapeHtml(variant.label)}</button>
      ${allowReplace ? `<button class="secondary" data-command="replaceVariant" data-variant-id="${variant.id}">Replace with ${escapeHtml(variant.label)}</button>` : ''}
      ${settings.ttsEnabled ? `<button class="secondary" data-command="readVariant" data-variant-id="${variant.id}">&#128266; Read aloud</button><button class="secondary" data-command="stopReadAloud">Stop</button>` : ''}
    </div>
  </article>`).join('');
  const fallbackNote = result.fallbackFromModel
    ? `<div class="model-note">Fallback used after <strong>${escapeHtml(result.fallbackFromModel)}</strong> could not produce a usable result.</div>`
    : '';
  return `${fallbackNote}${tabs}${panels}`;
}

function renderSettings(
  settings: KrenPanelSettings,
  proModels: GeminiModelOption[],
  openAIModels: GeminiModelOption[],
  anthropicModels: GeminiModelOption[],
  brandImageUri: string | undefined
): string {
  return `${renderHeader('', false, brandImageUri)}
    <button class="secondary" data-command="showResult" aria-label="Back to KREN result">&#8592; Back to result</button>
    <h2>KREN Settings</h2>
    <p class="settings-intro">Changes are saved globally in this VS Code profile. API keys remain in VS Code Secret Storage. ChatGPT and Claude subscriptions do not include OpenAI or Anthropic API usage.</p>
    <section class="settings-group">
      <h3>Translation</h3>
      ${selectSetting('Translation provider', 'Dictionary providers are configured separately.', 'translationProvider', settings.translationProvider, [
        ['googleCloudTranslation', 'Google Cloud Translation'], ['gemini', 'Gemini']
      ])}
      ${textSetting('Translation language', 'Use auto-en-ko, or an ISO/BCP-47 fixed target such as ko, ja, es, or de.', 'translation.targetLanguage', settings.translationTargetLanguage)}
    </section>
    <section class="settings-group">
      <h3>Grammar Check</h3>
      <p class="settings-intro">Harper checks submitted English text entirely on this computer. It uses no API key, network request, or language-model prompt.</p>
      ${selectSetting('English dialect', 'Controls regional spelling and grammar conventions.', 'grammar.dialect', settings.grammarDialect, [
        ['american', 'American English'], ['british', 'British English'],
        ['australian', 'Australian English'], ['canadian', 'Canadian English'],
        ['indian', 'Indian English']
      ])}
      ${toggleSetting('Automatic paragraph checking', 'After typing pauses, check only the current paragraph locally. Off by default.', 'grammar.autoCheck', settings.grammarAutoCheck)}
      ${selectSetting('Automatic-check delay', 'Wait after the last edit before checking the current paragraph.', 'grammar.autoCheckDelayMs', String(settings.grammarAutoCheckDelayMs), [
        ['500', '0.5 seconds'], ['900', '0.9 seconds (recommended)'], ['1500', '1.5 seconds'], ['2500', '2.5 seconds']
      ])}
      <p class="settings-intro">Local vocabulary: <strong>${settings.grammarCustomWordCount}</strong> custom word${settings.grammarCustomWordCount === 1 ? '' : 's'} and <strong>${settings.grammarIgnoredFindingCount}</strong> ignored finding hash${settings.grammarIgnoredFindingCount === 1 ? '' : 'es'}. Checked text and document history are never stored.</p>
      <div class="settings-buttons"><button class="secondary" data-command="runCommand" data-action="kren.clearGrammarFindings">Clear findings</button><button class="secondary" data-command="runCommand" data-action="kren.clearGrammarCustomDictionary">Clear custom dictionary</button><button class="secondary" data-command="runCommand" data-action="kren.clearIgnoredGrammarFindings">Clear ignored findings</button></div>
    </section>
    <section class="settings-group">
      <h3>Explain Meaning or Nuance</h3>
      ${presetToggleSetting('Google Gemini', 'Use a key from your own eligible Google project. Availability, access, pricing, data use, and permitted use vary by project and region.', 'explain-gemini', settings.explanationProvider === 'gemini')}
      ${selectSetting('Provider', 'Choose which language-model API explains meaning and nuance.', 'explanation.provider', settings.explanationProvider, [
        ['gemini', 'Gemini'], ['openai', 'OpenAI API'], ['anthropic', 'Anthropic Claude API']
      ])}
      ${textSetting('Explanation language', 'Use bilingual or a language code.', 'explanation.outputLanguage', settings.explanationOutputLanguage)}
      ${providerSettings('explanation.provider', 'explanation.geminiProfile', settings.explanationProfile, settings, proModels, openAIModels, anthropicModels, true)}
    </section>
    <section class="settings-group">
      <h3>Rewrite Text</h3>
      ${selectSetting('Source language', 'Auto-detect preserves the detected language. Choose a language when short or mixed text is ambiguous.', 'rewrite.sourceLanguage', settings.rewriteSourceLanguage, [
        ['auto', 'Auto-detect (recommended)'], ['en', 'English'], ['ko', 'Korean'],
        ['ja', 'Japanese'], ['zh-CN', 'Chinese (Simplified)'], ['zh-TW', 'Chinese (Traditional)'],
        ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'],
        ['pt', 'Portuguese'], ['hi', 'Hindi'], ['ar', 'Arabic'], ['ru', 'Russian']
      ])}
      ${selectSetting('English dialect or variety', 'Follow Grammar Check uses its currently selected dialect. International English favors region-neutral wording.', 'rewrite.englishVariety', settings.rewriteEnglishVariety, [
        ['followGrammar', 'Follow Grammar Check (recommended)'], ['american', 'American English'],
        ['british', 'British English'], ['australian', 'Australian English'],
        ['canadian', 'Canadian English'], ['indian', 'Indian English'],
        ['international', 'International English']
      ])}
      ${presetToggleSetting('Gemini default profile', 'Use the default Gemini key and model from your own eligible Google project.', 'rewrite-gemini-default', settings.rewriteProvider === 'gemini' && settings.rewriteProfile === 'standard')}
      ${selectSetting('Provider', 'Gemini offers default and optional alternate profiles; OpenAI and Anthropic use their own model settings.', 'rewrite.provider', settings.rewriteProvider, [
        ['gemini', 'Gemini'], ['openai', 'OpenAI API'], ['anthropic', 'Anthropic Claude API']
      ])}
      ${providerSettings('rewrite.provider', 'rewrite.geminiProfile', settings.rewriteProfile, settings, proModels, openAIModels, anthropicModels, true)}
      ${selectSetting('Preferred rewrite style', 'The style shown first; switch styles from tabs in each result.', 'rewrite.preferredVariant', settings.preferredRewriteVariant, [
        ['natural', 'Natural'], ['concise', 'Concise'], ['jargonFree', 'Jargon-Free']
      ])}
      ${selectSetting('Quick-menu rewrite', 'This choice is listed first; All 3, Natural, Concise, and Jargon-Free remain available.', 'rewrite.quickMenuVariant', settings.quickMenuRewriteVariant, [
        ['all', 'All 3 Variants'], ['natural', 'Natural'], ['concise', 'Concise'], ['jargonFree', 'Jargon-Free']
      ])}
      ${selectSetting('Domain preset', 'Guides terminology and conventions without sending document or workspace context.', 'rewrite.domain', settings.rewriteDomain, [
        ['general', 'General'], ['academic', 'Academic'], ['technical', 'Technical'], ['business', 'Business'], ['email', 'Email']
      ])}
      ${selectSetting('Tone preset', 'Controls how the rewrite sounds without changing its factual strength.', 'rewrite.tone', settings.rewriteTone, [
        ['preserveVoice', 'Preserve My Voice'], ['neutral', 'Neutral'], ['professional', 'Professional'],
        ['warm', 'Warm'], ['assertive', 'Assertive'], ['cautious', 'Cautious'],
        ['diplomatic', 'Diplomatic'], ['formal', 'Formal'], ['direct', 'Direct'],
        ['plainLanguage', 'Plain Language']
      ])}
      ${selectSetting('Rhetorical mode', 'Controls what the rewrite is trying to accomplish. Preserve Original is the safest default.', 'rewrite.rhetoricalMode', settings.rewriteRhetoricalMode, [
        ['preserveOriginal', 'Preserve Original'], ['explain', 'Explain'], ['persuade', 'Persuade'],
        ['recommend', 'Recommend'], ['constructivelyChallenge', 'Constructively Challenge']
      ])}
      ${toggleSetting('Protect formatting', 'Preserve Markdown, LaTeX, links, citations, placeholders, and code.', 'rewrite.preserveFormatting', settings.preserveFormatting)}
      ${toggleSetting('Explain important edits', 'Ask the selected language model for one concise change note per rewrite variant.', 'rewrite.includeChangeNotes', settings.includeChangeNotes)}
      ${toggleSetting('Show Read Aloud controls', 'Use the shared Read Aloud source, voice, speed, and volume configured below for every rewrite variant.', 'rewrite.tts.enabled', settings.ttsEnabled)}
    </section>
    <section class="settings-group">
      <h3>Read Aloud (Windows)</h3>
      ${selectSetting('Speech source', 'Local is private and offline. Edge Online provides natural neural voices but sends the cleaned selection to Microsoft.', 'readAloud.provider', settings.readAloudProvider, [
        ['windowsLocal', 'Local Windows (offline)'], ['edgeOnline', 'Microsoft Edge Online (experimental)']
      ])}
      <div class="conditional-group" data-provider-for="readAloud.provider" data-provider-value="windowsLocal">
        ${nativeVoiceSetting(settings.readAloudVoice, settings.readAloudVoices)}
        ${selectSetting('Reading rate', 'Windows speech rate. Zero is the normal voice rate.', 'readAloud.rate', String(settings.readAloudRate), [
          ['-4', '-4 (slower)'], ['-2', '-2'], ['0', '0 (normal)'], ['2', '+2'], ['4', '+4 (faster)']
        ])}
        <p class="model-note">Offline: selected text remains on this PC and is passed to Windows System.Speech only.</p>
      </div>
      <div class="conditional-group" data-provider-for="readAloud.provider" data-provider-value="edgeOnline">
        ${edgeVoiceSetting(settings.edgeReadAloudVoice)}
        ${selectSetting('Edge reading speed', 'Zero percent is the natural voice speed.', 'readAloud.edgeRatePercent', String(settings.edgeReadAloudRatePercent), [
          ['-25', '-25% slower'], ['-10', '-10% slower'], ['0', '0% (normal)'], ['10', '+10% faster'], ['25', '+25% faster']
        ])}
        ${textSetting('Python command', 'Python interpreter containing edge-tts. The default works after: python -m pip install edge-tts', 'readAloud.edgePythonCommand', settings.edgeReadAloudPythonCommand)}
        <p class="model-note">Online: only KREN's cleaned speech copy is sent to Microsoft's Edge speech service through the unofficial edge-tts package. Audio is downloaded to a unique temporary MP3, played invisibly, and deleted.</p>
      </div>
      ${selectSetting('Volume', 'Local playback volume or Edge synthesis volume.', 'readAloud.volume', String(settings.readAloudVolume), [
        ['25', '25%'], ['50', '50%'], ['75', '75%'], ['100', '100%']
      ])}
      <div class="settings-buttons"><button class="secondary" data-command="runCommand" data-action="kren.previewReadAloud">Preview voice</button><button class="secondary" data-command="runCommand" data-action="kren.stopReadAloud">Stop reading</button></div>
      <p class="settings-intro">The editor command always removes common Markdown and citation markers from a temporary in-memory copy. It never modifies the document.</p>
    </section>
    <section class="settings-group">
      <h3>Dictionary</h3>
      <p class="settings-intro"><strong>Merriam-Webster keys:</strong> every user must obtain and enter their own Collegiate Dictionary and Collegiate Thesaurus keys. KREN provides no shared keys. Merriam-Webster's standard free terms limit use to noncommercial applications, two reference works, and 1,000 queries per day per reference.</p>
      ${toggleSetting('Translate unmatched phrases', 'If Merriam-Webster has no multi-word entry, use Google Cloud Translation.', 'dictionary.multiWordTranslationFallback', settings.multiWordTranslationFallback)}
      ${toggleSetting('Windows background pronunciation', 'On local Windows, play Merriam-Webster audio through a hidden native process without opening KREN. Failures fall back to the KREN player.', 'pronunciation.windowsNativePlayback', settings.windowsNativePronunciation)}
    </section>
    <section class="settings-group">
      <h3>Credentials and usage</h3>
      <p class="settings-intro">Keys are encrypted by VS Code Secret Storage for this extension profile. Remove them here before uninstalling or retiring a test profile.</p>
      ${credentialRow('Default Gemini', 'kren.setGeminiApiKey', 'kren.deleteGeminiApiKey', Boolean(settings.credentialPresence?.geminiDefault))}
      ${credentialRow('Alternate Gemini', 'kren.setGeminiProApiKey', 'kren.deleteGeminiProApiKey', Boolean(settings.credentialPresence?.geminiAlternate))}
      ${credentialRow('Google Cloud Translation', 'kren.setGoogleCloudTranslationApiKey', 'kren.deleteGoogleCloudTranslationApiKey', Boolean(settings.credentialPresence?.googleCloudTranslation), 'kren.showGoogleCloudTranslationUsage', 'Usage', false)}
      ${credentialRow('OpenAI', 'kren.setOpenAIApiKey', 'kren.deleteOpenAIApiKey', Boolean(settings.credentialPresence?.openai), 'kren.testOpenAIConnection', 'Test')}
      ${credentialRow('Anthropic', 'kren.setAnthropicApiKey', 'kren.deleteAnthropicApiKey', Boolean(settings.credentialPresence?.anthropic), 'kren.testAnthropicConnection', 'Test')}
      ${credentialRow('Merriam-Webster Collegiate', 'kren.setMerriamWebsterCollegiateApiKey', 'kren.deleteMerriamWebsterCollegiateApiKey', Boolean(settings.credentialPresence?.merriamWebsterCollegiate))}
      ${credentialRow('Merriam-Webster Thesaurus', 'kren.setMerriamWebsterThesaurusApiKey', 'kren.deleteMerriamWebsterThesaurusApiKey', Boolean(settings.credentialPresence?.merriamWebsterThesaurus))}
      ${credentialRow('Korean Dictionary', 'kren.setKoreanDictionaryApiKey', 'kren.deleteKoreanDictionaryApiKey', Boolean(settings.credentialPresence?.koreanDictionary), 'kren.testKoreanDictionary', 'Test')}
      <div class="settings-buttons">
        <button class="secondary" data-command="runCommand" data-action="kren.deleteAllApiKeys"${Object.values(settings.credentialPresence ?? {}).some(Boolean) ? '' : ' disabled'}>Delete all stored API keys</button>
        <button class="secondary" data-command="runCommand" data-action="workbench.action.openSettings">All KREN settings</button>
      </div>
    </section>`;
}

function credentialRow(
  label: string,
  setAction: string,
  deleteAction: string,
  stored: boolean,
  extraAction?: string,
  extraLabel?: string,
  extraRequiresKey = true
): string {
  const extra = extraAction && extraLabel
    ? `<button class="secondary" data-command="runCommand" data-action="${escapeHtml(extraAction)}"${extraRequiresKey && !stored ? ' disabled' : ''}>${escapeHtml(extraLabel)}</button>`
    : '';
  return `<div class="credential-row"><span class="credential-label">${escapeHtml(label)} <span class="credential-status">${stored ? 'Stored' : 'Not set'}</span></span><span class="settings-buttons"><button class="secondary" data-command="runCommand" data-action="${escapeHtml(setAction)}"${stored ? ' disabled' : ''}>Set key</button><button class="secondary" data-command="runCommand" data-action="${escapeHtml(deleteAction)}"${stored ? '' : ' disabled'}>Remove key</button>${extra}</span></div>`;
}

function providerSettings(
  providerKey: 'explanation.provider' | 'rewrite.provider',
  geminiProfileKey: 'explanation.geminiProfile' | 'rewrite.geminiProfile',
  geminiProfileValue: 'standard' | 'pro',
  settings: KrenPanelSettings,
  proModels: GeminiModelOption[],
  openAIModels: GeminiModelOption[],
  anthropicModels: GeminiModelOption[],
  includeAlternateFallback: boolean
): string {
  const alternateFallback = includeAlternateFallback
    ? `${toggleSetting('Automatic fallback', 'For Explain and Rewrite, use the same-provider fallback when the alternate model is unavailable, remains temporarily unavailable, or returns unusable structured output.', 'gemini.alternateFallbackEnabled', settings.alternateFallbackEnabled)}
      ${modelSetting('Fallback model', 'The result identifies both models whenever fallback is used.', 'gemini.alternateFallbackModel', settings.alternateFallbackModel, proModels)}
      ${selectSetting('Fallback model thinking level', 'Applied independently when the fallback model is used.', 'gemini.alternateFallbackThinkingLevel', settings.alternateFallbackThinkingLevel, [
        ['auto', 'Auto'], ['minimal', 'Minimal'], ['low', 'Low (recommended)'], ['medium', 'Medium'], ['high', 'High']
      ])}`
    : '';
  const geminiProfile = `${selectSetting('Gemini profile', 'Default and Alternate use their separately stored keys and model settings.', geminiProfileKey, geminiProfileValue, [
      ['standard', 'Default Gemini profile'], ['pro', 'Alternate Gemini profile']
    ])}
    <div class="conditional-group" data-gemini-profile-for="${geminiProfileKey}" data-gemini-profile-value="standard">
      ${textSetting('Model', 'Model used by the default Gemini profile.', 'gemini.model', settings.geminiModel)}
      ${geminiStandardControls(settings)}
    </div>
    <div class="conditional-group" data-gemini-profile-for="${geminiProfileKey}" data-gemini-profile-value="pro">
      ${modelSetting('Model', 'Choose a discovered model or enter a future model ID for the alternate profile.', 'gemini.alternateModel', settings.alternateModel, proModels, 'refreshProModels')}
      ${selectSetting('Thinking level', 'Higher levels can increase latency and cost.', 'gemini.alternateThinkingLevel', settings.alternateThinkingLevel, [
        ['low', 'Low (recommended)'], ['medium', 'Medium'], ['high', 'High']
      ])}
      ${alternateFallback}
    </div>`;

  return `<div class="conditional-group" data-provider-for="${providerKey}" data-provider-value="gemini">
      ${geminiProfile}
    </div>
    <div class="conditional-group" data-provider-for="${providerKey}" data-provider-value="openai">
      ${modelSetting('Model', 'Choose a discovered model or enter a future model ID.', 'openai.model', settings.openAIModel, openAIModels, 'refreshOpenAIModels')}
      ${selectSetting('Thinking/effort level', 'Lower effort is usually sufficient for rewriting and nuance explanations.', 'openai.reasoningEffort', settings.openAIReasoningEffort, [
        ['auto', 'Auto'], ['none', 'None'], ['low', 'Low (recommended)'], ['medium', 'Medium'], ['high', 'High']
      ])}
      ${languageModelRetryControls(settings)}
    </div>
    <div class="conditional-group" data-provider-for="${providerKey}" data-provider-value="anthropic">
      ${modelSetting('Model', 'Choose a discovered model or enter a future model ID.', 'anthropic.model', settings.anthropicModel, anthropicModels, 'refreshAnthropicModels')}
      ${selectSetting('Thinking/effort level', 'Lower effort is usually sufficient for rewriting and nuance explanations.', 'anthropic.effort', settings.anthropicEffort, [
        ['auto', 'Auto'], ['low', 'Low (recommended)'], ['medium', 'Medium'], ['high', 'High']
      ])}
      ${languageModelRetryControls(settings)}
    </div>`;
}

function geminiStandardControls(settings: KrenPanelSettings): string {
  return `${selectSetting('Thinking/effort level', 'Auto selects a compatible level for the model.', 'gemini.thinkingLevel', settings.geminiThinkingLevel, [
      ['auto', 'Auto (recommended)'], ['minimal', 'Minimal'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']
    ])}
    ${toggleSetting('Automatic retry', 'Retries transient 408, 429, and 5xx responses with backoff.', 'gemini.retry.enabled', settings.geminiRetryEnabled)}
    ${selectSetting('Maximum attempts', 'Includes the initial request. Higher values may take longer.', 'gemini.retry.maxAttempts', String(settings.geminiRetryMaxAttempts), [
      ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4 (recommended)'], ['5', '5']
    ])}`;
}

function languageModelRetryControls(settings: KrenPanelSettings): string {
  return `${toggleSetting('Automatic retry', 'Retries transient failures only with the selected provider; KREN never silently sends text to another company.', 'languageModel.retry.enabled', settings.languageModelRetryEnabled)}
    ${selectSetting('Maximum attempts', 'Includes the initial request.', 'languageModel.retry.maxAttempts', String(settings.languageModelRetryMaxAttempts), [
      ['1', '1'], ['2', '2'], ['3', '3 (recommended)'], ['4', '4'], ['5', '5']
    ])}`;
}

function presetToggleSetting(
  title: string,
  description: string,
  preset: 'explain-gemini' | 'rewrite-gemini-default',
  checked: boolean
): string {
  return `<label class="setting"><span><span class="setting-title">${escapeHtml(title)}</span><span class="setting-description">${escapeHtml(description)}</span></span><span class="switch"><input type="checkbox" data-preset="${preset}"${checked ? ' checked' : ''}><span class="slider"></span></span></label>`;
}

function selectSetting(
  title: string,
  description: string,
  key: string,
  value: string,
  options: Array<[string, string]>
): string {
  return `<label class="setting"><span><span class="setting-title">${escapeHtml(title)}</span><span class="setting-description">${escapeHtml(description)}</span></span><select data-setting="${escapeHtml(key)}">${options.map(([optionValue, label]) => `<option value="${escapeHtml(optionValue)}"${optionValue === value ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label>`;
}

function textSetting(title: string, description: string, key: string, value: string): string {
  return `<label class="setting"><span><span class="setting-title">${escapeHtml(title)}</span><span class="setting-description">${escapeHtml(description)}</span></span><input type="text" data-setting="${escapeHtml(key)}" value="${escapeHtml(value)}"></label>`;
}

function modelSetting(
  title: string,
  description: string,
  key: string,
  value: string,
  models: GeminiModelOption[],
  refreshCommand?: 'refreshProModels' | 'refreshOpenAIModels' | 'refreshAnthropicModels'
): string {
  const listId = `models-${key.replace(/[^a-z0-9]+/giu, '-')}`;
  const refresh = refreshCommand
    ? `<button type="button" class="secondary" data-command="${refreshCommand}" title="Retrieve models available to this API key">Refresh</button>`
    : '';
  return `<label class="setting"><span><span class="setting-title">${escapeHtml(title)}</span><span class="setting-description">${escapeHtml(description)}</span></span><span class="setting-control"><input type="text" list="${listId}" data-setting="${escapeHtml(key)}" value="${escapeHtml(value)}"><datalist id="${listId}">${models.map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.displayName)}</option>`).join('')}</datalist>${refresh}</span></label>`;
}

function nativeVoiceSetting(value: string, voices: string[]): string {
  const options = voices.map((voice) => `<option value="${escapeHtml(voice)}"${voice === value ? ' selected' : ''}>${escapeHtml(voice)}</option>`).join('');
  const unavailable = value && !voices.includes(value)
    ? `<option value="${escapeHtml(value)}" selected>${escapeHtml(value)} (not currently detected)</option>`
    : '';
  return `<label class="setting"><span><span class="setting-title">Windows voice</span><span class="setting-description">Installed System.Speech voices detected on this Windows host.</span></span><select data-setting="readAloud.voice"><option value="">Automatic local voice</option>${unavailable}${options}</select></label>`;
}

function edgeVoiceOptions(): GeminiModelOption[] {
  return [
    { id: 'en-US-AvaNeural', displayName: 'Ava Natural (US English)' },
    { id: 'en-US-ChristopherNeural', displayName: 'Christopher Natural (US English)' },
    { id: 'en-US-ChristopherMultilingualNeural', displayName: 'Christopher Multilingual Natural' },
    { id: 'en-US-EricNeural', displayName: 'Eric Natural (US English)' },
    { id: 'en-US-GuyNeural', displayName: 'Guy Natural (US English)' },
    { id: 'en-US-JennyNeural', displayName: 'Jenny Natural (US English)' }
  ];
}

function edgeVoiceSetting(value: string): string {
  const voices = edgeVoiceOptions();
  const selectedPreset = voices.some((voice) => voice.id === value) ? value : '__custom__';
  return `<label class="setting"><span><span class="setting-title">Edge voice preset</span><span class="setting-description">Choose a visible preset, including Ava Natural. The editable voice ID below remains authoritative.</span></span><select data-edge-voice-preset>${voices.map((voice) => `<option value="${escapeHtml(voice.id)}"${voice.id === selectedPreset ? ' selected' : ''}>${escapeHtml(voice.displayName)}</option>`).join('')}<option value="__custom__"${selectedPreset === '__custom__' ? ' selected' : ''}>Custom voice ID</option></select></label>
    ${textSetting('Editable Edge voice ID', 'Enter a current Microsoft Edge voice ID if it is not listed above.', 'readAloud.edgeVoice', value)}`;
}

function rewriteDomainLabel(value: RewriteResult['domain']): string {
  if (value === 'academic') return 'Academic';
  if (value === 'technical') return 'Technical';
  if (value === 'business') return 'Business';
  if (value === 'email') return 'Email';
  return 'General';
}

function rewriteEnglishVarietyLabel(value: RewriteResult['englishVariety']): string {
  if (value === 'british') return 'British';
  if (value === 'australian') return 'Australian';
  if (value === 'canadian') return 'Canadian';
  if (value === 'indian') return 'Indian';
  if (value === 'international') return 'International';
  return 'American';
}

function rewriteToneLabel(value: RewriteResult['tone']): string {
  if (value === 'plainLanguage') return 'Plain Language';
  if (value === 'preserveVoice') return 'Preserve My Voice';
  if (value === 'professional') return 'Professional';
  if (value === 'warm') return 'Warm';
  if (value === 'assertive') return 'Assertive';
  if (value === 'cautious') return 'Cautious';
  if (value === 'diplomatic') return 'Diplomatic';
  if (value === 'formal') return 'Formal';
  if (value === 'direct') return 'Direct';
  return 'Neutral';
}

function rewriteRhetoricalModeLabel(value: RewriteResult['rhetoricalMode']): string {
  if (value === 'explain') return 'Explain';
  if (value === 'persuade') return 'Persuade';
  if (value === 'recommend') return 'Recommend';
  if (value === 'constructivelyChallenge') return 'Constructively Challenge';
  return 'Preserve Original';
}

function toggleSetting(
  title: string,
  description: string,
  key: string,
  checked: boolean
): string {
  return `<label class="setting"><span><span class="setting-title">${escapeHtml(title)}</span><span class="setting-description">${escapeHtml(description)}</span></span><span class="switch"><input type="checkbox" data-setting="${escapeHtml(key)}"${checked ? ' checked' : ''}><span class="slider"></span></span></label>`;
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
  return `<button class="audio secondary" data-audio-url="${escapeHtml(audioUrl)}" aria-label="Play pronunciation of ${escapeHtml(headword)}" title="Play pronunciation">▶</button>`;
}

function renderNote(note: string | undefined): string {
  return note ? `<p class="note">${escapeHtml(note)}</p>` : '';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}
