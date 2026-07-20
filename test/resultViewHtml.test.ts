import { describe, expect, it } from 'vitest';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import type { DictionaryResult, GrammarResult, RewriteResult, TranslationResult } from '../src/types.js';
import type { KrenPanelSettings } from '../src/resultViewHtml.js';

const base = {
  sourceLanguage: 'en',
  targetLanguage: 'ko',
  createdAt: '1970-01-01T00:00:00.000Z'
};

const settings: KrenPanelSettings = {
  translationProvider: 'googleCloudTranslation',
  translationTargetLanguage: 'ko',
  grammarDialect: 'american',
  grammarAutoCheck: false,
  grammarAutoCheckDelayMs: 900,
  grammarCustomWordCount: 0,
  grammarIgnoredFindingCount: 0,
  explanationOutputLanguage: 'bilingual',
  explanationProvider: 'gemini',
  explanationProfile: 'standard',
  rewriteProvider: 'gemini',
  rewriteEnglishVariety: 'followGrammar',
  geminiModel: 'gemini-3.5-flash',
  geminiThinkingLevel: 'auto',
  openAIModel: 'gpt-5.4',
  openAIReasoningEffort: 'low',
  anthropicModel: 'claude-sonnet-4-6',
  anthropicEffort: 'low',
  rewriteProfile: 'standard',
  alternateModel: 'gemini-3.1-pro-preview',
  alternateThinkingLevel: 'low',
  alternateFallbackEnabled: true,
  alternateFallbackModel: 'gemini-2.5-pro',
  preferredRewriteVariant: 'natural',
  quickMenuRewriteVariant: 'all',
  rewriteDomain: 'technical',
  rewriteTone: 'preserveVoice',
  rewriteRhetoricalMode: 'recommend',
  preserveFormatting: true,
  includeChangeNotes: false,
  multiWordTranslationFallback: true,
  windowsNativePronunciation: true,
  geminiRetryEnabled: true,
  geminiRetryMaxAttempts: 4,
  languageModelRetryEnabled: true,
  languageModelRetryMaxAttempts: 3,
  ttsEnabled: true,
  readAloudVoice: 'Microsoft David Desktop',
  readAloudRate: 0,
  readAloudVolume: 100,
  readAloudVoices: ['Microsoft David Desktop', 'Microsoft Zira Desktop'],
  readAloudProvider: 'edgeOnline',
  edgeReadAloudVoice: 'en-US-ChristopherNeural',
  edgeReadAloudRatePercent: 0,
  edgeReadAloudPythonCommand: 'python',
  extensionVersion: '0.14.1'
};

const brandImageUri = 'vscode-webview://test/media/kren-panel-logo.png';
const googleAttributionImageUri = 'vscode-webview://test/media/google-translate-attribution.png';

const proModels = [
  { id: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro Preview' },
  { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' }
];

describe('KREN rich result view', () => {
  it('enables only valid credential actions for the current storage state', () => {
    const emptyHtml = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings,
      activeScreen: 'settings',
      proModels
    });

    expect(emptyHtml).toContain('Default Gemini <span class="credential-status">Not set</span>');
    expect(emptyHtml).toContain('data-action="kren.setGeminiApiKey">Set key</button>');
    expect(emptyHtml).toContain('data-action="kren.deleteGeminiApiKey" disabled>Remove key</button>');
    expect(emptyHtml).toContain('data-action="kren.deleteAllApiKeys" disabled>');

    const storedHtml = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: {
        ...settings,
        credentialPresence: { geminiDefault: true }
      },
      activeScreen: 'settings',
      proModels
    });

    expect(storedHtml).toContain('Default Gemini <span class="credential-status">Stored</span>');
    expect(storedHtml).toContain('data-action="kren.setGeminiApiKey" disabled>Set key</button>');
    expect(storedHtml).toContain('data-action="kren.deleteGeminiApiKey">Remove key</button>');
    expect(storedHtml).toContain('data-action="kren.deleteAllApiKeys">');
  });

  it('shows and escapes the complete input with a translation result', () => {
    const result: TranslationResult = {
      ...base,
      kind: 'translation',
      providerId: 'googleCloudTranslation',
      sourceText: '<private input>\nsecond line',
      translatedText: '번역 결과'
    };
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      brandImageUri,
      googleAttributionImageUri,
      result,
      sourceText: result.sourceText,
      allowReplace: false,
      settings,
      proModels
    });

    expect(html).toContain('<h2 class="card-title">Input</h2>');
    expect(html).toContain('&lt;private input&gt;\nsecond line');
    expect(html).toContain('번역 결과');
    expect(html).not.toContain('<private input>');
    expect(html).not.toContain('data-command="replace"');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-test-nonce'");
    expect(html).toContain(`src="${googleAttributionImageUri}"`);
    expect(html).toContain('https://translate.google.com');
    expect(html).toContain('Translation disclaimer');
  });

  it('renders approved pronunciation audio in the same view', () => {
    const audioUrl = 'https://media.merriam-webster.com/audio/prons/en/us/mp3/d/delibe01.mp3';
    const result: DictionaryResult = {
      ...base,
      kind: 'dictionary',
      providerId: 'merriamWebsterCollegiate',
      sourceText: 'deliberate',
      headword: 'deliberate',
      entries: [],
      sections: [{
        headword: 'deliberate',
        pronunciation: 'di-ˈli-bə-rət',
        audioUrl,
        entries: [{ meaning: 'to think about carefully' }]
      }]
    };
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      brandImageUri,
      result,
      sourceText: result.sourceText,
      allowReplace: true,
      autoplayAudio: { url: audioUrl, headword: 'deliberate' },
      settings,
      proModels
    });

    expect(html).toContain(`data-audio-url="${audioUrl}"`);
    expect(html).toContain(`src="${audioUrl}" autoplay`);
    expect(html).toContain("message.command === 'playPronunciation'");
    expect(html).toContain("command: 'pronunciationStarted'");
    expect(html).toContain("command: 'pronunciationFailed'");
    expect(html).not.toContain('data-command="replace"');
    expect(html).not.toContain('Replace selection');
    expect(html).toContain('media-src https://media.merriam-webster.com');
  });

  it('renders per-variant copy and editor-only replace actions', () => {
    const result: RewriteResult = {
      ...base,
      sourceLanguage: 'en',
      targetLanguage: 'en',
      kind: 'rewrite',
      providerId: 'gemini',
      modelId: 'gemini-2.5-pro',
      fallbackFromModel: 'gemini-3.1-pro-preview',
      sourceText: 'Leverage synergies.',
      englishVariety: 'british',
      domain: 'technical',
      tone: 'preserveVoice',
      rhetoricalMode: 'recommend',
      variants: [
        { id: 'natural', label: 'Natural English', text: 'Make better use of our combined strengths.' },
        { id: 'concise', label: 'Concise', text: 'Combine our strengths.' },
        { id: 'jargonFree', label: 'Jargon-Free', text: 'Work together more effectively.' }
      ]
    };
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      brandImageUri,
      result,
      sourceText: result.sourceText,
      allowReplace: true,
      settings,
      proModels
    });

    expect(html).toContain('data-command="copyVariant" data-variant-id="natural"');
    expect(html).toContain('data-command="replaceVariant" data-variant-id="jargonFree"');
    expect(html).toContain('Open full details');
    expect(html).not.toContain('data-command="copy">Copy result');
    expect(html).toContain('data-variant-tab="natural"');
    expect(html).toContain('data-variant-tab="jargonFree"');
    expect(html).toContain('data-command="clear"');
    expect(html).toContain('KREN Settings');
    expect(html).toContain('data-setting="gemini.retry.enabled"');
    expect(html).toContain('data-setting="gemini.alternateFallbackModel"');
    expect(html).toContain('data-setting="explanation.geminiProfile"');
    expect(html).toContain('data-setting="rewrite.quickMenuVariant"');
    expect(html).toContain('data-setting="rewrite.englishVariety"');
    expect(html).toContain('English dialect or variety');
    expect(html).toContain('data-setting="rewrite.domain"');
    expect(html).toContain('data-setting="rewrite.tone"');
    expect(html).toContain('data-setting="rewrite.rhetoricalMode"');
    expect(html).toContain('data-setting="readAloud.voice"');
    expect(html).toContain('data-setting="readAloud.provider"');
    expect(html).toContain('data-provider-for="readAloud.provider" data-provider-value="edgeOnline"');
    expect(html).toContain('data-setting="readAloud.edgeVoice"');
    expect(html).toContain('en-US-ChristopherNeural');
    expect(html).toContain('Microsoft Edge Online (experimental)');
    expect(html).toContain('only KREN\'s cleaned speech copy is sent');
    expect(html).toContain('Microsoft Zira Desktop');
    expect(html).toContain('data-action="kren.previewReadAloud"');
    expect(html).toContain('data-setting="pronunciation.windowsNativePlayback"');
    expect(html).toContain('Result <span class="result-meta">| English: <strong>British</strong> | Domain: <strong>Technical</strong> | Tone: <strong>Preserve My Voice</strong> | Mode: <strong>Recommend</strong> |</span>');
    expect(html).toContain('data-command="refreshProModels"');
    expect(html).toContain('data-preset="explain-gemini"');
    expect(html).toContain('data-preset="rewrite-gemini-default"');
    expect(html).not.toContain('Free API');
    expect(html).not.toContain('Paid Gemini');
    expect(html).toContain('data-provider-for="explanation.provider" data-provider-value="gemini"');
    expect(html).toContain('data-provider-for="rewrite.provider" data-provider-value="openai"');
    expect(html).toContain('data-command="readVariant" data-variant-id="natural"');
    expect(html).toContain('data-command="stopReadAloud"');
    expect(html).not.toContain('speechSynthesis');
    expect(html).toContain('en-US-AvaNeural');
    expect(html).toContain('Ava Natural (US English)');
    expect(html).toContain('data-edge-voice-preset');
    expect(html).toContain('Editable Edge voice ID');
    expect(html).toContain('25%');
    expect(html).toContain('0% (normal)');
    expect(html).toContain('Fallback used after <strong>gemini-3.1-pro-preview</strong>');
    expect(html).toContain('<div class="provider"><span>gemini-2.5-pro</span></div>');
    expect(html).not.toContain('Model: <strong>gemini-2.5-pro</strong>');
    expect(html).not.toContain('<span>Gemini<br>');
    expect(html).toContain('All KREN settings');
    expect(html).toContain('data-command="showManual"');
    expect(html).toContain('data-menu-toggle');
    expect(html).toContain('&#9776;');
    expect(html).toContain('data-command="showStartPage"');
    expect(html).toContain('>Start Page</button>');
    expect(html).toContain("target.closest('.menu-wrap')");
    expect(html).not.toContain('&#9432;');
    expect(html).toContain('KREN User Manual');
    expect(html).toContain('Designed by Masstransferase &amp; developed using CODEX · Version 0.14.1');
    expect(html).toContain('<h3>Requirements</h3>');
    expect(html).toContain('VS Code Desktop 1.106 or later');
    expect(html).toContain('Delete all stored API keys');
    expect(html).toContain('data-action="kren.deleteGeminiApiKey"');
    expect(html).toContain('no API key, account, Python, Node.js, GPU, or network connection is required');
    expect(html).toContain('obtain and enter your own Merriam-Webster Collegiate Dictionary and Collegiate Thesaurus API keys');
    expect(html).toContain('Windows-native speech is unavailable in WSL');
    expect(html).toContain('API users to be at least 18');
    expect(html).toContain('professional or business purposes');
    expect(html).toContain('Copy and replacement safety');
    expect(html).toContain('Privacy, storage, limits, and cost');
    expect(html).toContain('Known limitations');
    expect(html).toContain(`src="${brandImageUri}"`);
    expect(html).not.toContain('data-tts-text');
    const script = html.match(/<script nonce="test-nonce">([\s\S]*?)<\/script>/u)?.[1];
    expect(script).toBeDefined();
    expect(() => new Function(script ?? '')).not.toThrow();
  });

  it('renders grammar corrections as opt-in choices', () => {
    const result: GrammarResult = {
      ...base,
      kind: 'grammar',
      providerId: 'harper',
      sourceText: 'I has apple.',
      dialect: 'american',
      issues: [{
        id: 'issue-1',
        start: 2,
        end: 5,
        original: 'has',
        category: 'Agreement',
        message: 'The verb must agree with the pronoun.',
        suggestions: [{ kind: 'replace', replacement: 'have', label: 'Replace with “have”' }]
      }]
    };
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      brandImageUri,
      result,
      sourceText: result.sourceText,
      allowReplace: true,
      settings,
      proModels
    });

    expect(html).toContain('Harper (offline)');
    expect(html).toContain('Keep original');
    expect(html).toContain('Replace with “have”');
    expect(html).toContain('data-command="applyGrammar"');
    expect(html).toContain('data-command="copyGrammar"');
    expect(html).toContain('data-grammar-choice="-1" checked');
    expect(html).toContain("command === 'applyGrammar' || command === 'copyGrammar'");
  });

  it('renders private grammar vocabulary and automatic-check controls', () => {
    const html = renderKrenResultViewHtml({
      cspSource: 'test',
      nonce: 'nonce',
      settings: {
        ...settings,
        grammarAutoCheck: true,
        grammarCustomWordCount: 2,
        grammarIgnoredFindingCount: 1
      },
      activeScreen: 'settings',
      proModels: []
    });
    expect(html).toContain('data-setting="grammar.autoCheck" checked');
    expect(html).toContain('2</strong> custom words');
    expect(html).toContain('1</strong> ignored finding hash');
    expect(html).toContain('kren.clearGrammarCustomDictionary');
    expect(html).toContain('kren.clearIgnoredGrammarFindings');
  });

  it('renders a concise modern introduction when no result exists', () => {
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      brandImageUri,
      settings,
      proModels
    });

    expect(html).toContain('KREN is a privacy-conscious language workbench');
    expect(html).toContain('1. Select or copy');
    expect(html).toContain('2. Choose an action');
    expect(html).toContain('class="welcome-layout"');
    expect(html).toContain('.welcome-lead { margin: 0 0 24px; font-size: .95rem;');
    expect(html).toContain('.privacy-note { margin: 24px 5px 0; color: var(--vscode-descriptionForeground); font-size: .95rem;');
    expect(html).toContain('font-size: .74rem; text-align: left;');
    expect(html).toContain('English Dictionary');
    expect(html).toContain('Read Aloud');
    expect(html.indexOf('English Dictionary')).toBeLessThan(html.indexOf('Synonyms'));
    expect(html.indexOf('Synonyms')).toBeLessThan(html.indexOf('Korean Dictionary'));
    expect(html).not.toContain('Medical Dictionary');
    expect(html).toContain('Designed by Masstransferase &amp; developed using CODEX · Version 0.14.1');
  });

  it('renders Start Page as the introduction without discarding a stored result', () => {
    const result: TranslationResult = {
      ...base,
      kind: 'translation',
      providerId: 'googleCloudTranslation',
      sourceText: 'hello',
      translatedText: '안녕하세요'
    };
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      brandImageUri,
      result,
      sourceText: result.sourceText,
      activeScreen: 'start',
      settings,
      proModels
    });

    expect(html).toContain('KREN is a privacy-conscious language workbench');
    expect(html).not.toContain('안녕하세요');
    expect(html).toContain('id="result-screen" class="result-screen"');
  });
});
