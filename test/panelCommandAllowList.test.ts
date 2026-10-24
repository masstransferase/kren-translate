import { readFileSync } from 'node:fs';
import { hostSource } from './support/hostSource.js';
import { describe, expect, it } from 'vitest';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import type { KrenPanelSettings } from '../src/resultViewHtml.js';
import { PANEL_COMMANDS } from '../src/panelCommands.js';
import { createTutorViewState } from '../src/tutor/state.js';
import {
  PANEL_SETTING_KEYS,
  validatedPanelSetting,
  type KrenPanelSettingKey
} from '../src/panelSettings.js';
import { userDictionaryEntry } from './userDictionaryFixtures.js';

// The settings webview declares each button's command in a data-action attribute.
// resultsView.ts validates that string against PANEL_COMMANDS before dispatching, and
// drops anything absent without an error.
//
// PANEL_COMMANDS and the KrenPanelCommand type union are two lists of the same thing.
// A command added to the union alone type-checks, renders a normal-looking button, and
// then does nothing when clicked, because the runtime check rejects it and the caller
// swallows the rejection. That is exactly what happened to the Medical Dictionary Set
// and Remove buttons: correct rendering, dead click, no error anywhere.
//
// This test closes the whole class rather than the one instance. Every action the
// settings page renders must be dispatchable.

const baseSettings: KrenPanelSettings = {
  userDictionaryEnabled: false,
  userDictionaryCaptureMode: 'llmOnly',
  userDictionaryFallbackOnMerriamWebsterNoMatch: false,
  userDictionaryProvider: 'gemini',
  userDictionaryModel: 'gemini-3.5-flash',
  userDictionaryAlternateModel: 'gemini-3.1-pro-preview',
  userDictionaryThinkingOrEffort: 'low',
  userDictionaryProfile: 'standard',
  userDictionaryFallbackEnabled: false,
  userDictionaryFallbackModel: 'gemini-3.5-flash',
  userDictionaryFallbackThinkingOrEffort: 'low',
  userDictionaryEntryLanguage: 'auto',
  userDictionaryIncludePronunciation: true,
  userDictionaryIncludeSynonyms: true,
  userDictionaryIncludeUsageNotes: true,
  userDictionaryNumberOfExamples: 2,
  userDictionaryIncludeTechnicalMeanings: true,
  userDictionarySmartWordCapture: true,
  openResultsAtStartup: false,
  translationProvider: 'googleCloudTranslation',
  translationSourceLanguage: 'auto',
  translationTargetLanguage: 'ko',
  translationRoutingProvider: 'gemini',
  translationModel: 'gemini-3.6-flash',
  translationAlternateModel: 'gemini-3.1-pro-preview',
  translationThinkingOrEffort: 'auto',
  translationProfile: 'standard',
  translationFallbackEnabled: false,
  translationFallbackModel: 'gemini-3.5-flash',
  translationFallbackThinkingOrEffort: 'low',
  grammarDialect: 'american',
  grammarSmart: false,
  grammarAutoCheck: false,
  grammarAutoCheckDelayMs: 900,
  grammarCustomWordCount: 0,
  grammarIgnoredFindingCount: 0,
  explanationOutputLanguage: 'sameAsSource',
  explanationProvider: 'gemini',
  explanationModel: 'gemini-3.5-flash',
  explanationAlternateModel: 'gemini-3.1-pro-preview',
  explanationThinkingOrEffort: 'auto',
  explanationProfile: 'standard',
  explanationFallbackEnabled: true,
  explanationFallbackModel: 'gemini-3.5-flash',
  explanationFallbackThinkingOrEffort: 'low',
  rewriteProvider: 'gemini',
  rewriteModel: 'gemini-3.5-flash',
  rewriteAlternateModel: 'gemini-3.1-pro-preview',
  rewriteThinkingOrEffort: 'auto',
  rewriteFallbackEnabled: true,
  rewriteFallbackModel: 'gemini-3.5-flash',
  rewriteFallbackThinkingOrEffort: 'low',
  rewriteSourceLanguage: 'auto',
  rewriteEnglishVariety: 'sameAsSource',
  rewriteOtherOutputLanguage: 'ko',
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
  alternateFallbackModel: 'gemini-3.5-flash',
  alternateFallbackThinkingLevel: 'low',
  tutorProvider: 'gemini',
  tutorModel: 'gemini-3.5-flash',
  tutorAlternateModel: 'gemini-3.1-pro-preview',
  tutorThinkingOrEffort: 'medium',
  tutorProfile: 'standard',
  tutorFallbackEnabled: false,
  tutorFallbackModel: 'gemini-3.5-flash',
  tutorFallbackThinkingOrEffort: 'low',
  tutorReadAloudProvider: 'edgeOnline',
  tutorEdgeReadAloudLocale: 'en-US',
  tutorEdgeReadAloudVoice: 'en-US-ChristopherNeural',
  tutorEdgeReadAloudRatePercent: 0,
  tutorReadAloudVoice: 'Microsoft David Desktop',
  tutorReadAloudRate: 0,
  tutorReadAloudVolume: 100,
  // 2026-10-21: V286 requires the tutor sentence pause default.
  tutorSentencePauseMilliseconds: 0,
  quickMenuRewriteVariant: 'all',
  rewriteModality: 'written',
  rewriteFunction: 'general',
  rewriteDomain: 'technical',
  rewriteFormality: 'preserve',
  rewriteVoice: 'preserve',
  rewriteStance: 'preserve',
  rewriteLength: 'preserve',
  rewritePerspective: 'preserve',
  rewriteRhetoricalMode: 'recommend',
  preserveFormatting: true,
  includeChangeNotes: false,
  rewriteCopyToClipboard: false,
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
  edgeReadAloudLocale: 'auto',
  edgeReadAloudVoice: 'en-US-ChristopherNeural',
  edgeReadAloudRatePercent: 0,
  edgeReadAloudPythonCommand: 'python',
  translationDomain: 'general',
  explanationDomain: 'general',
  displayMode: 'hover',
  requestTimeoutMs: 45000,
  translationMaxCharacters: 5000,
  userDictionaryMaxImportEntries: 5000,
  extensionVersion: '1.0.0'
};

function grammarFixture() {
  return {
    kind: 'grammar',
    providerId: 'harper',
    sourceText: 'Their going to the libary.',
    sourceLanguage: 'en',
    targetLanguage: 'en',
    dialect: 'american',
    issues: [{
      id: 'issue-1',
      category: 'Spelling',
      original: 'libary',
      start: 19,
      end: 25,
      message: 'Misspelling.',
      ignoreHash: 'abc',
      suggestions: [{ kind: 'replace', replacement: 'library', label: 'library' }]
    }]
  } as never;
}

function rewriteFixture() {
  return {
    kind: 'rewrite',
    providerId: 'gemini',
    modelId: 'gemini-3.6-flash',
    sourceText: 'Leverage synergies.',
    sourceLanguage: 'en',
    targetLanguage: 'en',
    englishVariety: 'american',
    domain: 'general',
    modality: 'written',
    function: 'general',
    formality: 'preserve',
    voice: 'preserve',
    stance: 'preserve',
    length: 'preserve',
    perspective: 'preserve',
    rhetoricalMode: 'preserve',
    variants: [{ id: 'minimal', label: 'Minimal Rewrite', text: 'Work together.' }]
  } as never;
}

function screenHtml(
  credentialPresence: KrenPanelSettings['credentialPresence'],
  activeScreen: 'settings' | 'start' | 'manual' | 'result' | 'userDictionary' | 'tutor' = 'settings'
): string {
  const settings: KrenPanelSettings = { ...baseSettings, credentialPresence };
  return renderKrenResultViewHtml({
    cspSource: 'vscode-webview://test',
    nonce: 'test-nonce',
    settings,
    activeScreen,
    proModels: []
  });
}

function settingsHtml(credentialPresence: KrenPanelSettings['credentialPresence']): string {
  return screenHtml(credentialPresence, 'settings');
}

function renderedActions(html: string): string[] {
  return [...html.matchAll(/data-command="runCommand" data-action="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((action): action is string => typeof action === 'string');
}

// Changed 2026-10-22 (V299, owner I69): this bounded host command stays behind draft saves.
function dispatchableAction(action: string): boolean {
  if (action === 'kren.applyGlobalRouting') {
    expect(readFileSync('src/resultsView.ts', 'utf8')).toContain("await vscode.commands.executeCommand('kren.applyGlobalRouting')");
    expect(readFileSync('src/extension.ts', 'utf8')).toContain("vscode.commands.registerCommand('kren.applyGlobalRouting'");
    return true;
  }
  return PANEL_COMMANDS.has(action as never);
}

describe('settings panel command allow list', () => {
  it('can dispatch every action the settings page renders when no key is stored', () => {
    const actions = renderedActions(settingsHtml({}));
    expect(actions.length).toBeGreaterThan(0);
    const missing = actions.filter((action) => !dispatchableAction(action));
    expect(missing).toEqual([]);
  });

  it('can dispatch every action the settings page renders when keys are stored', () => {
    // Stored keys change which buttons render and which are enabled, so the
    // no-key pass alone would miss a Remove action that only appears once stored.
    const actions = renderedActions(
      settingsHtml({
        merriamWebsterCollegiate: true,
        merriamWebsterMedical: true,
        merriamWebsterThesaurus: true,
        geminiDefault: true,
        geminiAlternate: true,
        googleCloudTranslation: true,
        openai: true,
        anthropic: true,
        koreanDictionary: true
      })
    );
    const missing = actions.filter((action) => !dispatchableAction(action));
    expect(missing).toEqual([]);
  });


  // The scan covered the settings screen alone until 2026-08-22, when the welcome screen
  // gained nine capability buttons. panelCommands.ts exists because a command in the type
  // union but not the runtime set renders a normal-looking button that silently does
  // nothing, and that has shipped here once. A scan that reads one screen cannot catch it
  // on another.
  it('can dispatch every action any screen renders, not only the settings page', () => {
    for (const screen of ['start', 'settings', 'manual', 'tutor'] as const) {
      for (const presence of [{}, { merriamWebsterCollegiate: true, merriamWebsterThesaurus: true, merriamWebsterMedical: true }]) {
        const actions = renderedActions(screenHtml(presence, screen));
        const missing = actions.filter((action) => !dispatchableAction(action));
        expect(missing, `${screen} renders only dispatchable actions`).toEqual([]);
      }
    }
  });

  it('offers every welcome capability as a button that runs something', () => {
    const html = screenHtml({ merriamWebsterCollegiate: true, merriamWebsterThesaurus: true, merriamWebsterMedical: true }, 'start');
    const capabilities = [...html.matchAll(/<button class="capability[^"]*"([^>]*)>/gu)].map((m) => m[1] ?? '');
    // Ten, and every one of them wired. They were spans that looked like buttons and did
    // nothing at all, which is what the owner reported. Add to User Dictionary joined the
    // grid on 2026-08-23.
    expect(capabilities).toHaveLength(10);
    for (const attributes of capabilities) {
      expect(attributes, `capability button is wired: ${attributes}`)
        .toMatch(/data-command="runCommand" data-action="kren\.[A-Za-z]+"/u);
    }
    // The regression this catches is a capability rendered as a decorative span rather than
    // a control. Matched on the class ending there, because the label inside each button is
    // legitimately a span whose class starts with the same word.
    expect(html).not.toMatch(/<span class="capability["\s]/u);
  });
  // The allow list above covers only `runCommand`, which is one of the two ways a control
  // in this panel can be dead. The other is a `data-command` the extension never handles or
  // never accepts, and that shipped in 1.3.7: Apply and Copy on a grammar result rendered
  // enabled, posted their message, and were dropped by the validator in silence. This scans
  // the produced markup rather than the source, so a control added through any helper is
  // covered without the helper being listed here.
  it('handles and accepts every data-command any screen renders', () => {
    const view = hostSource();
    const handled = new Set(
      [...view.matchAll(/message\.command === '([a-zA-Z]+)'/gu)].map((match) => match[1])
    );
    const accepted = new Set(
      [...view.matchAll(/command !== '([a-zA-Z]+)'/gu)].map((match) => match[1])
    );
    // Changed 2026-10-23 (V307, verification R30): Cancel is accepted and handled directly by the receiver before the ordered queue.
    const receiver = readFileSync('src/resultsView.ts', 'utf8').split('view.webview.onDidReceiveMessage')[1]!.split("if (command === 'panelNoticeResponse')")[0]!;
    const immediate = [...receiver.matchAll(/if \(command === '([a-zA-Z]+)'\)/gu)].map(match => match[1]);
    for (const command of immediate) { handled.add(command); accepted.add(command); }
    const priority = new Set(
      [...readFileSync('src/webviewMessagePriority.ts', 'utf8')
        .matchAll(/^\s*\| '([a-zA-Z]+)'/gmu)].map((match) => match[1])
    );

    const rendered = new Set<string>();
    const collect = (html: string): void => {
      for (const command of html.matchAll(/data-command="([a-zA-Z]+)"/gu)) {
        if (command[1]) rendered.add(command[1]);
      }
    };
    for (const screen of ['result', 'start', 'settings', 'manual', 'userDictionary', 'tutor'] as const) {
      for (const presence of [{}, {
        merriamWebsterCollegiate: true,
        merriamWebsterThesaurus: true,
        merriamWebsterMedical: true,
        geminiDefault: true
      }]) {
        collect(screenHtml(presence, screen));
      }
    }
    // An empty panel renders about a dozen controls. The ones this test exists for live on
    // a populated result, so the two result kinds with their own control rows are rendered
    // explicitly. Without these the scan passes while covering none of the controls that
    // were dead.
    for (const result of [grammarFixture(), rewriteFixture()]) {
      collect(renderKrenResultViewHtml({
        cspSource: 'vscode-webview://test',
        nonce: 'test-nonce',
        settings: { ...baseSettings, credentialPresence: {} },
        result,
        sourceText: 'Their going to the libary.',
        allowReplace: true,
        proModels: []
      }));
    }
    collect(renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: { ...baseSettings, credentialPresence: {}, userDictionaryEnabled: true },
      activeScreen: 'userDictionary',
      userDictionary: { entries: [userDictionaryEntry()], selectedId: 'entry-ledger' },
      proModels: []
    }));
    const tutor = createTutorViewState();
    tutor.conversation.status = 'active';
    collect(renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: { ...baseSettings, credentialPresence: { geminiDefault: true } },
      activeScreen: 'tutor',
      tutor,
      tutorSpeechProvider: 'gemini',
      proModels: []
    }));
    // Added 2026-09-18: V114's stopped-only resume command must be scanned too.
    tutor.conversation.status = 'stopped';
    tutor.conversation.transcript = Array.from({ length: 5 }, (_, index) => ({
      question: `Question ${index}?`, learnerAnswer: 'I went.', correction: 'I went.',
      explanation: 'Already correct.'
    }));
    collect(renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: { ...baseSettings, credentialPresence: { geminiDefault: true } },
      activeScreen: 'tutor',
      tutor,
      tutorSpeechProvider: 'gemini',
      proModels: []
    }));

    expect(rendered.size).toBeGreaterThan(20);
    expect(rendered.has('dictateTutorConversation'), 'conversation dictation is scanned').toBe(true);
    expect(rendered.has('resumeTutorConversation'), 'stopped conversation resume is scanned').toBe(true);
    expect([...rendered].filter((command) =>
      !handled.has(command) && !priority.has(command))).toEqual([]);
    expect([...rendered].filter((command) =>
      !accepted.has(command) && !priority.has(command))).toEqual([]);
  });

  it('allows both the set and the delete command for all three Merriam-Webster references', () => {
    for (const reference of ['Collegiate', 'Medical', 'Thesaurus']) {
      expect(PANEL_COMMANDS.has(`kren.setMerriamWebster${reference}ApiKey` as never)).toBe(true);
      expect(PANEL_COMMANDS.has(`kren.deleteMerriamWebster${reference}ApiKey` as never)).toBe(true);
    }
  });
});

// Two settings have now shipped broken in the same way: a string key added to
// PANEL_SETTING_KEYS with no matching branch in validatedPanelSetting falls through to the
// boolean fallback at the bottom and is refused, so the panel reports "KREN rejected an
// invalid value for <key>" and snaps the control back. grammar.dialect did it with
// Auto-detect in 1.3.13, and rewrite.otherOutputLanguage did it with every language in
// 1.3.15. Neither had a test, because the validator lived in a module that imports vscode.
//
// It is now its own module, and this walks every key the panel is allowed to write. The
// sample table is deliberately hand-maintained: adding a key without adding a legal value
// for it fails here, which is the moment to notice the validator needs a branch too.
describe('every panel setting the page can write', () => {
  const newRoutingKeys = [
    'translation.geminiProfile',
    'translation.fallbackEnabled',
    'translation.fallbackModel',
    'translation.fallbackThinkingOrEffort',
    'explanation.model',
    'explanation.thinkingOrEffort',
    'explanation.fallbackEnabled',
    'explanation.fallbackModel',
    'explanation.fallbackThinkingOrEffort',
    'rewrite.model',
    'rewrite.thinkingOrEffort',
    'rewrite.fallbackEnabled',
    'rewrite.fallbackModel',
    'rewrite.fallbackThinkingOrEffort',
    'userDictionary.geminiProfile',
    'userDictionary.fallbackEnabled',
    'userDictionary.fallbackModel',
    'userDictionary.fallbackThinkingOrEffort',
    'tutor.geminiProfile',
    'tutor.fallbackEnabled',
    // Changed 2026-10-22 (V298, owner I70/D33 B): Fast covers fallback.
    'tutor.hintThinkingOrEffort',
    'tutor.provider',
    'tutor.model',
    'tutor.hintModel',
    'tutor.liveModel',
    'tutor.thinkingOrEffort'
  ] as const satisfies readonly KrenPanelSettingKey[];

  const legalValues: Record<KrenPanelSettingKey, string | number | boolean> = {
    // Changed 2026-10-22 (V299, owner I69): saved global draft uses the same validated route values.
    'global.provider': 'gemini',
    'global.geminiProfile': 'standard',
    'global.model': 'gemini-3.6-flash',
    'global.alternateModel': 'gemini-3.1-pro-preview',
    'global.thinkingOrEffort': 'auto',
    'global.fallbackEnabled': false,
    'global.fallbackModel': 'gemini-3.6-flash',
    'global.fallbackThinkingOrEffort': 'low',
    'results.openAtStartup': true,
    // 2026-10-11: V221 validates and stores the provider switch controls.
    'llm.providerSwitch': true,
    'llm.providerOrder': '["gemini","groq","cloudflare"]',
    'translationProvider': 'gemini',
    'translation.domain': 'medical',
    'explanation.domain': 'legal',
    'display.mode': 'quickPick',
    // 2026-10-04: The display control is persisted through the shared allowlist.
    'display.panelTheme': 'followVSCode',
    'request.timeoutMs': 30000,
    'translation.maxCharacters': 4000,
    'userDictionary.maxImportEntries': 2500,
    'translation.sourceLanguage': 'ja-JP',
    'translation.targetLanguage': 'ko',
    'translation.provider': 'anthropic',
    'translation.model': 'gemini-3.6-flash',
    'translation.alternateModel': 'gemini-3.1-pro-preview',
    'translation.thinkingOrEffort': 'high',
    'translation.geminiProfile': 'standard',
    'translation.fallbackEnabled': false,
    'translation.fallbackModel': 'gemini-3.6-flash',
    'translation.fallbackThinkingOrEffort': 'low',
    'grammar.dialect': 'auto',
    'grammar.smart': true,
    'grammar.autoCheck': false,
    'grammar.autoCheckDelayMs': 900,
    'explanation.outputLanguage': 'sameAsSource',
    'explanation.provider': 'gemini',
    'explanation.geminiProfile': 'standard',
    'explanation.model': 'gemini-3.6-flash',
    'explanation.alternateModel': 'gemini-3.1-pro-preview',
    'explanation.thinkingOrEffort': 'auto',
    'explanation.fallbackEnabled': true,
    'explanation.fallbackModel': 'gemini-3.6-flash',
    'explanation.fallbackThinkingOrEffort': 'low',
    'rewrite.provider': 'gemini',
    'rewrite.model': 'gemini-3.6-flash',
    'rewrite.alternateModel': 'gemini-3.1-pro-preview',
    'rewrite.thinkingOrEffort': 'auto',
    'rewrite.fallbackEnabled': true,
    'rewrite.fallbackModel': 'gemini-3.6-flash',
    'rewrite.fallbackThinkingOrEffort': 'low',
    'rewrite.sourceLanguage': 'auto',
    'rewrite.modality': 'written',
    'rewrite.function': 'general',
    'rewrite.englishVariety': 'sameAsSource',
    'rewrite.otherOutputLanguage': 'ko',
    'gemini.model': 'gemini-3.6-flash',
    'gemini.customModels': '["gemini-reader-model"]',
    // Added 2026-09-21: Live custom identifiers have their own setting and validator path.
    'tutor.liveCustomModels': '["gemini-reader-live"]',
    'gemini.thinkingLevel': 'auto',
    'gemini.retry.enabled': true,
    'gemini.retry.maxAttempts': 3,
    'openai.model': 'gpt-5',
    // 2026-10-11: both new provider lists use the same validated panel storage path.
    'groq.customModels': '[]',
    'cloudflare.customModels': '[]',
    'openai.customModels': '["gpt-reader-model"]',
    'openai.reasoningEffort': 'low',
    'anthropic.model': 'claude-sonnet-5',
    'anthropic.customModels': '["claude-reader-model"]',
    'anthropic.effort': 'low',
    'languageModel.retry.enabled': true,
    'languageModel.retry.maxAttempts': 3,
    'rewrite.geminiProfile': 'standard',
    'gemini.alternateModel': 'gemini-3.1-pro-preview',
    'gemini.alternateThinkingLevel': 'high',
    'gemini.alternateFallbackEnabled': true,
    'gemini.alternateFallbackModel': 'gemini-3.6-flash',
    'gemini.alternateFallbackThinkingLevel': 'low',
    'rewrite.quickMenuVariant': 'all',
    'rewrite.domain': 'general',
    'rewrite.formality': 'preserve',
    'rewrite.voice': 'preserve',
    'rewrite.stance': 'preserve',
    'rewrite.length': 'preserve',
    'rewrite.perspective': 'preserve',
    'rewrite.rhetoricalMode': 'preserve',
    'rewrite.preserveFormatting': true,
    'rewrite.includeChangeNotes': false,
  'rewrite.copyToClipboard': false,
    'rewrite.tts.enabled': true,
    'readAloud.voice': 'Microsoft David Desktop',
    'readAloud.rate': 0,
    'readAloud.volume': 100,
    'readAloud.provider': 'windowsLocal',
    // 2026-10-13: V231 adds a separately stored Read Aloud Chirp voice.
    'readAloud.chirpVoice': 'Callirrhoe',
    'readAloud.edgeLocale': 'ko-KR',
    'readAloud.edgeVoice': 'en-US-ChristopherNeural',
    'readAloud.edgeRatePercent': 0,
    'readAloud.edgePythonCommand': 'python',
    'dictionary.multiWordTranslationFallback': false,
    'pronunciation.windowsNativePlayback': true,
    'userDictionary.enabled': true,
    'userDictionary.defaultCaptureMode': 'llmOnly',
    'userDictionary.fallbackOnMerriamWebsterNoMatch': false,
    'userDictionary.provider': 'gemini',
    'userDictionary.model': 'gemini-3.6-flash',
    'userDictionary.alternateModel': 'gemini-3.1-pro-preview',
    'userDictionary.thinkingOrEffort': 'low',
    'userDictionary.geminiProfile': 'standard',
    'userDictionary.fallbackEnabled': false,
    'userDictionary.fallbackModel': 'gemini-3.6-flash',
    'userDictionary.fallbackThinkingOrEffort': 'low',
    'userDictionary.entryLanguage': 'auto',
    'userDictionary.includePronunciation': true,
    'userDictionary.includeSynonyms': true,
    'userDictionary.includeUsageNotes': true,
    'userDictionary.numberOfExamples': 2,
    'userDictionary.includeTechnicalMeanings': true,
    'userDictionary.smartWordCapture': true,
    'tutor.questionOnly': true,
    'tutor.exampleCount': 6,
    'tutor.sentenceLengthBand': 'medium',
    'tutor.tolerance': 0,
    'tutor.learnerLevel': 'B2',
    'tutor.lessonMode': 'explainAndExamples',
    'tutor.explanationDepth': 'standard',
    'tutor.annotationLevel': 'explainEach',
    'tutor.includeCommonErrors': true,
    'tutor.exerciseCount': 5,
    'tutor.axis.modality': 'written',
    'tutor.axis.function': 'general',
    'tutor.axis.englishVariety': 'american',
    'tutor.axis.otherOutputLanguage': 'ko',
    'tutor.axis.domain': 'business',
    'tutor.axis.formality': 'neutral',
    'tutor.axis.voice': 'instructional',
    'tutor.axis.stance': 'diplomatic',
    'tutor.axis.perspective': 'preserve',
    'tutor.axis.rhetoricalMode': 'explain',
    'tutor.provider': 'gemini',
    'tutor.model': 'gemini-3.6-flash',
    // 2026-10-12: Speech provider is now writable from VOICE & MODEL.
    'tutor.speechProvider': 'groq',
    'tutor.hintModel': 'gemini-3.5-flash',
    // Changed 2026-10-03: Image Model has the same validated storage path as tutor models.
    // 2026-10-10: the picture provider control must have a validated writable value.
    'tutor.pictureProvider': 'cloudflare',
    // 2026-10-10: Cloudflare Image Model has its own closed writable choice.
    'tutor.cloudflareImageModel': '@cf/black-forest-labs/flux-1-schnell',
    'tutor.imageModel': 'gemini-3.1-flash-lite-image',
    'tutor.imageCustomModels': '[]',
    'tutor.liveModel': 'gemini-3.8-live',
    'tutor.conversation.liveTranscriptionLanguage': 'english',
    // Changed 2026-09-24: every conversation-owned microphone control must be writable.
    'tutor.conversation.microphoneSensitivity': 'balanced',
    // Added 2026-10-02: every rendered pause choice must have a storable key.
    'tutor.conversation.pauseBeforeReply': 2,
    'tutor.conversation.speechDetection': 'kren',
    'tutor.conversation.microphoneCloseWait': 4,
    'tutor.conversation.takeHome': true,
      'tutor.conversation.hintPrefetch': false,
    // 2026-10-11: V218 adds a writable picture style.
    'tutor.conversation.pictureStyle': 'realistic',
    'tutor.conversation.pressToTalk': false,
    'tutor.alternateModel': 'gemini-3.1-pro-preview',
    'tutor.thinkingOrEffort': 'medium',
    'tutor.geminiProfile': 'standard',
    // Changed 2026-10-23 (V304, owner I75): Live has its own stored profile.
    'tutor.liveGeminiProfile': 'standard',
    'tutor.fallbackEnabled': false,
    // Changed 2026-10-22 (V298, owner I70/D33 B): Fast covers fallback.
    'tutor.hintThinkingOrEffort': 'low',
    'tutor.readAloud.provider': 'edgeOnline',
    'tutor.readAloud.edgeLocale': 'en-US',
    'tutor.readAloud.edgeVoice': 'en-US-ChristopherNeural',
    'tutor.readAloud.edgeRatePercent': 0,
    'tutor.readAloud.voice': 'Microsoft David Desktop',
    'tutor.readAloud.rate': 0,
    'tutor.readAloud.volume': 100,
    // 2026-10-21: V286 adds a legal sample without reducing key coverage.
    'tutor.readAloud.sentencePauseMilliseconds': 500
  };

  it('has a legal sample value listed for it', () => {
    const missing = [...PANEL_SETTING_KEYS].filter((key) => !(key in legalValues));
    expect(missing, 'add a legal value above, then check the validator has a branch for it')
      .toEqual([]);
    const extra = Object.keys(legalValues)
      .filter((key) => !PANEL_SETTING_KEYS.has(key as KrenPanelSettingKey));
    expect(extra, 'these keys are no longer writable from the panel').toEqual([]);
  });

  it('V165 rejects removed lesson practice switches but keeps the practice count writable', () => {
    // Changed 2026-09-26: removed controls must not remain writable panel settings.
    for (const key of ['tutor.includePractice', 'tutor.includeAnswerKey']) {
      expect(PANEL_SETTING_KEYS.has(key as KrenPanelSettingKey)).toBe(false);
      expect(validatedPanelSetting(key as KrenPanelSettingKey, true)).toBeUndefined();
    }
    expect(PANEL_SETTING_KEYS.has('tutor.exerciseCount')).toBe(true);
    expect(validatedPanelSetting('tutor.exerciseCount', '7')).toBe(7);
    expect(validatedPanelSetting('tutor.exerciseCount', '21')).toBeUndefined();
  });

  it('is accepted by the validator, rather than refused and snapped back', () => {
    for (const key of PANEL_SETTING_KEYS) {
      const value = legalValues[key];
      expect(validatedPanelSetting(key, value), `${key} rejected its own legal value ${String(value)}`)
        .toBe(value);
    }
  });

  it('still refuses a value outside each closed list', () => {
    // Otherwise the test above passes on a validator that accepts everything.
    expect(validatedPanelSetting('grammar.dialect', 'klingon')).toBeUndefined();
    expect(validatedPanelSetting('rewrite.otherOutputLanguage', 'klingon')).toBeUndefined();
    expect(validatedPanelSetting('rewrite.englishVariety', 'followGrammar')).toBeUndefined();
    expect(validatedPanelSetting('userDictionary.numberOfExamples', 9)).toBeUndefined();
    for (const value of [0, 3, 5, 10]) {
      expect(validatedPanelSetting(
        'tutor.conversation.microphoneCloseWait' as KrenPanelSettingKey, value
      )).toBeUndefined();
    }
    for (const key of PANEL_SETTING_KEYS) {
      // V102, 2026-09-15. A Windows voice name is an installed free-form name, just like
      // readAloud.voice. Every closed tutor choice still refuses the sentinel.
      if (key.startsWith('tutor.') && key !== 'tutor.readAloud.voice') {
        expect(validatedPanelSetting(key, 'nonsense'), `${key} accepted nonsense`)
          .toBeUndefined();
      }
    }
    expect(validatedPanelSetting('tutor.readAloud.voice', 'x'.repeat(201))).toBeUndefined();
  });

  it('accepts a legal value and refuses nonsense for every key added to complete routing', () => {
    for (const key of newRoutingKeys) {
      expect(validatedPanelSetting(key, legalValues[key]), `${key} rejected its legal sample`)
        .toBe(legalValues[key]);
      expect(validatedPanelSetting(key, 'nonsense'), `${key} accepted nonsense`)
        .toBeUndefined();
    }
  });
});
