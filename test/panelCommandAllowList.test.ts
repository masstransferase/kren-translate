import { describe, expect, it } from 'vitest';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import type { KrenPanelSettings } from '../src/resultViewHtml.js';
import { PANEL_COMMANDS } from '../src/panelCommands.js';

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
  openResultsAtStartup: false,
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
  rewriteSourceLanguage: 'auto',
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
  alternateFallbackModel: 'gemini-3.5-flash',
  alternateFallbackThinkingLevel: 'low',
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
  extensionVersion: '1.0.0'
};

function settingsHtml(credentialPresence: KrenPanelSettings['credentialPresence']): string {
  const settings: KrenPanelSettings = { ...baseSettings, credentialPresence };
  return renderKrenResultViewHtml({
    cspSource: 'vscode-webview://test',
    nonce: 'test-nonce',
    settings,
    activeScreen: 'settings',
    proModels: []
  });
}

function renderedActions(html: string): string[] {
  return [...html.matchAll(/data-command="runCommand" data-action="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((action): action is string => typeof action === 'string');
}

describe('settings panel command allow list', () => {
  it('can dispatch every action the settings page renders when no key is stored', () => {
    const actions = renderedActions(settingsHtml({}));
    expect(actions.length).toBeGreaterThan(0);
    const missing = actions.filter((action) => !PANEL_COMMANDS.has(action as never));
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
    const missing = actions.filter((action) => !PANEL_COMMANDS.has(action as never));
    expect(missing).toEqual([]);
  });

  it('allows both the set and the delete command for all three Merriam-Webster references', () => {
    for (const reference of ['Collegiate', 'Medical', 'Thesaurus']) {
      expect(PANEL_COMMANDS.has(`kren.setMerriamWebster${reference}ApiKey` as never)).toBe(true);
      expect(PANEL_COMMANDS.has(`kren.deleteMerriamWebster${reference}ApiKey` as never)).toBe(true);
    }
  });
});
