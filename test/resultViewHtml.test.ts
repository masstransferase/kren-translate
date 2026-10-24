// 2026-10-10: V216 renames reader-facing Gemini profiles Free Tier and Paid; exact expectations follow the brief.
import { load } from 'cheerio';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MERRIAM_WEBSTER_KEY_LIMIT, MERRIAM_WEBSTER_KEY_LIMIT_MESSAGE } from '../src/operations.js';
import { REWRITE_RHETORICAL_MODES } from '@kren/core/rewrite-axes';
import { ICON_PATHS, type IconName } from '@kren/core/icons';
import {
  exportUserDictionaryMarkdown,
  importUserDictionaryMarkdown
} from '@kren/core/user-dictionary';
import { applyGrammarChoices as applyCoreGrammarChoices } from '@kren/core/grammar';

// The settings groups in the order the owner asked for on 2026-08-13. Order is a
// requirement here, not an accident of where each block was appended, and it is the kind
// of thing a later edit reshuffles without anyone noticing.
const SETTINGS_GROUP_ORDER = [
  'Startup and Panel',
  'Translation',
  'Grammar Check',
  'Explain Meaning or Nuance',
  'Rewrite Text',
  // Changed 2026-10-21 (owner, canvas): The Settings section is named Read Aloud.
  'Read Aloud',
  'Dictionary',
  'User Dictionary',
  // 2026-10-04: The remembered theme choice has its own Display section.
  'Display',
  // 2026-10-10: V217 moves credentials to their own screen and retains Usage here.
  'Usage'
];
import {
  capabilityAvailability,
  krenCreditLine,
  LLM_ROUTING_CONTROL_TITLES,
  preselectedGrammarChoices,
  REWRITE_SETTINGS_GROUPS,
  renderKrenResultViewHtml
} from '../src/resultViewHtml.js';
import type {
  DictionaryResult,
  GrammarIssue,
  GrammarResult,
  RewriteResult,
  TranslationResult
} from '../src/types.js';
import type { KrenPanelSettings } from '../src/resultViewHtml.js';
import { REWRITE_OTHER_LANGUAGES } from '@kren/core/rewrite-axes';
import { EDGE_SPEECH_AUTO_LOCALE, EDGE_SPEECH_LOCALES } from '@kren/core/edge-speech';
import { userDictionaryEntry } from './userDictionaryFixtures.js';

const base = {
  sourceLanguage: 'en',
  targetLanguage: 'ko',
  createdAt: '1970-01-01T00:00:00.000Z'
};

const settings: KrenPanelSettings = {
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

const brandImageUri = 'vscode-webview://test/media/kren-panel-logo.png';
const googleAttributionImageUri = 'vscode-webview://test/media/google-translate-attribution.png';

const proModels = [
  { id: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro Preview' },
  { id: 'gemini-3.5-flash', displayName: 'Gemini 3.5 Flash' }
];

const PANEL_ICONS = [
  ['speaker', 'data-command="readVariant"'],
  ['stop', 'data-command="stopReadAloud"'],
  ['edit', 'data-command="editUserDictionaryEntry"'],
  ['delete', 'data-command="deleteUserDictionaryEntry"'],
  ['clear', 'data-command="clear"'],
  ['menu', 'data-menu-toggle'],
  ['copy', 'data-command="copyVariant"'],
  ['replace', 'data-command="replaceVariant"'],
  ['settings', 'data-command="editRewriteSettings"'],
  ['save', 'data-action="kren.setGeminiApiKey"']
] as const satisfies ReadonlyArray<readonly [IconName, string]>;

function renderIconFixture(): string {
  const entry = userDictionaryEntry();
  const result: RewriteResult = {
    ...base,
    sourceLanguage: 'en',
    targetLanguage: 'en',
    kind: 'rewrite',
    providerId: 'gemini',
    modelId: 'gemini-3.6-flash',
    sourceText: 'Leverage synergies.',
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
    variants: [
      { id: 'minimal', label: 'Minimal Rewrite', text: 'Work together more effectively.' }
    ]
  };
  return renderKrenResultViewHtml({
    cspSource: 'vscode-webview://test',
    nonce: 'test-nonce',
    settings: { ...settings, userDictionaryEnabled: true },
    result,
    sourceText: result.sourceText,
    allowReplace: true,
    userDictionary: { entries: [entry], selectedId: entry.id },
    proModels
  });
}

function renderedIconButtons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*class="[^"]*icon-button[^"]*"[^>]*>[\s\S]*?<\/button>/gu)]
    .map((match) => match[0]);
}

function grammarResult(sourceText: string, issues: GrammarIssue[]): GrammarResult {
  return {
    ...base,
    kind: 'grammar',
    providerId: 'harper',
    sourceText,
    dialect: 'american',
    issues
  };
}

function renderGrammarResult(result: GrammarResult): string {
  return renderKrenResultViewHtml({
    cspSource: 'vscode-webview://test',
    nonce: 'test-nonce',
    brandImageUri,
    result,
    sourceText: result.sourceText,
    allowReplace: true,
    settings,
    proModels
  });
}

function checkedGrammarChoices(html: string): Array<{ issueId: string; suggestionIndex: number }> {
  return [...html.matchAll(/<input type="radio"[^>]*data-grammar-choice="-?\d+"[^>]*>/gu)]
    .map((match) => match[0])
    .filter((input) => /\schecked(?:\s|>)/u.test(input))
    .map((input) => ({
      issueId: input.match(/data-grammar-issue="([^"]+)"/u)?.[1] ?? '',
      suggestionIndex: Number(input.match(/data-grammar-choice="(-?\d+)"/u)?.[1])
    }));
}

function grammarActionDisabledStates(html: string): boolean[] {
  return [...html.matchAll(/<button[^>]*data-grammar-action[^>]*>/gu)]
    .map((match) => /\sdisabled(?:\s|>)/u.test(match[0]));
}

describe('KREN rich result view', () => {
  it('renders the same complete routing control set for all six features', () => {
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings,
      activeScreen: 'tutor',
      proModels
    });
    // Changed 2026-10-03: tutor titles name their purpose; completeness is the storage contract.
    const $ = load(html);
    const suffixes = ['provider', 'geminiProfile', 'model', 'alternateModel', 'thinkingOrEffort',
      'fallbackEnabled', 'fallbackModel', 'fallbackThinkingOrEffort'];
    for (const feature of ['translation', 'grammar', 'explain', 'rewrite', 'userDictionary', 'tutor']) {
      const group = $(`[data-llm-routing="${feature}"]`);
      const prefix = feature === 'grammar' ? 'userDictionary' : feature === 'explain' ? 'explanation' : feature;
      // Changed 2026-10-22 (V298, owner I70/D33 B): Fast covers fallback.
      const featureSuffixes = feature === 'tutor'
        ? [...suffixes.filter(suffix => suffix !== 'fallbackModel' && suffix !== 'fallbackThinkingOrEffort'), 'hintModel', 'hintThinkingOrEffort']
        : suffixes;
      expect(group, `${feature} routing group`).toHaveLength(1);
      const keys = group.find('.setting').filter((_, row) => !$(row).is('[data-model-identifier]'))
        .map((_, row) => {
          const control = $(row).find('select,input').first();
          return control.attr('data-setting') ?? control.attr('data-model-preset') ?? '';
        }).get().filter((key) => featureSuffixes.some((suffix) => key === `${prefix}.${suffix}`));
      expect(keys, feature).toEqual(featureSuffixes.map((suffix) => `${prefix}.${suffix}`));
      if (feature === 'tutor') expect(group.find('[data-setting="tutor.fallbackModel"], [data-setting="tutor.fallbackThinkingOrEffort"]')).toHaveLength(0);
      for (const key of keys) {
        const title = group.find(`[data-setting="${key}"], [data-model-preset="${key}"]`).first()
          .closest('.setting').find('.setting-title').text();
        expect(title.length, `${key} accessible title`).toBeGreaterThan(0);
        if (/model$/i.test(key)) expect(title).toMatch(/model/i);
      }
    }
  });

  it('enables shared Grammar routing with Smart Grammar Check and dims it when off', () => {
    const render = (grammarSmart: boolean) => renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: { ...settings, grammarSmart },
      activeScreen: 'settings',
      proModels
    });
    const openingTag = (html: string) => html.match(
      /<details class="[^"]*" data-llm-routing="grammar"[^>]*>/u
    )?.[0] ?? '';

    expect(openingTag(render(true))).not.toContain('setting-inactive');
    expect(openingTag(render(false))).toContain('setting-inactive');
    expect(render(false)).toContain(
      'data-enabled-for="grammar.smart" data-enabled-value="true"'
    );
    expect(render(false)).toContain('control.disabled = !active;');
  });

  // Icon-only buttons carry no text, so their accessible name comes entirely from the
  // attributes. Dropping one turns the control into an unlabelled square for anyone using
  // a screen reader or hovering for a hint, and nothing else in the suite would notice.
  it('gives every icon-only button a title and an aria-label', () => {
    const spoken: RewriteResult = {
      ...base,
      sourceLanguage: 'en',
      targetLanguage: 'en',
      kind: 'rewrite',
      providerId: 'gemini',
      modelId: 'gemini-3.6-flash',
      sourceText: 'Leverage synergies.',
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
      variants: [
        { id: 'minimal', label: 'Minimal Rewrite', text: 'Work together more effectively.' }
      ]
    };
    const rewriteHtml = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings,
      result: spoken,
      sourceText: spoken.sourceText,
      proModels
    });

    const buttons = [...rewriteHtml.matchAll(/<button[^>]*class="[^"]*icon-button[^"]*"[^>]*>/g)]
      .map((match) => match[0]);
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button, `icon button without a title: ${button}`).toMatch(/title="[^"]+"/);
      expect(button, `icon button without an aria-label: ${button}`).toMatch(/aria-label="[^"]+"/);
    }
  });

  it('offers no controls at all when a check found nothing', () => {
    const clean = renderGrammarResult(grammarResult('All correct here.', []));

    expect(clean).toContain('No spelling or grammar issues found.');
    // There is nothing to open in full details beyond the sentence already on screen, and
    // the text a Copy control would copy is the text the reader still has selected.
    expect(clean).not.toContain('>Copy checked text</button>');
    expect(clean).not.toContain('data-command="details"');
  });

  it('offers no Ignore control on a finding, because Keep original is the answer', () => {
    const html = renderGrammarResult(grammarResult('I has apple.', [{
      id: 'issue-1',
      start: 2,
      end: 5,
      original: 'has',
      category: 'Agreement',
      message: 'Agreement.',
      ignoreHash: 'hash-1',
      suggestions: [{ kind: 'replace', replacement: 'have', label: 'have' }]
    }]));

    // Scoped to the finding itself. The manual still describes Ignore this finding, because
    // the editor's Quick Fix menu still offers it and that is where a persistent ignore now
    // lives; only the panel control is gone.
    const fieldset = html.slice(
      html.indexOf('<fieldset class="grammar-issue">'),
      html.indexOf('</fieldset>')
    );
    expect(fieldset).not.toBe('');
    expect(fieldset).toContain('Keep original');
    expect(fieldset).not.toContain('data-command="ignoreGrammarIssue"');
    expect(fieldset).not.toContain('Ignore this finding');
  });

  it('sizes the capability grid the way the Office action grid is sized', () => {
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings,
      brandImageUri,
      proModels
    });

    // Revised 2026-08-23. Two columns beside the numbered steps truncated every label to
    // "English ...", because that column is the narrow half of the row. One column there,
    // two once the layout stacks and the grid has the full width, one again below 380px.
    expect(html).toContain('.capability-grid { display: grid; grid-template-columns: 1fr;');
    expect(html).toContain('min-height: 44px');
    // Changed 2026-10-17: V261, F5 owner canvas edit, capability labels are 14px.
    expect(html).toContain('.capability-label { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 14px; }');

    const stacked = html.split('@media (max-width: 520px)')[1] ?? '';
    expect(stacked.length, 'the 520px breakpoint is gone').toBeGreaterThan(0);
    expect(stacked.split('\n')[0])
      .toContain('.capability-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }');
    expect(html).toContain('@media (max-width: 380px) { .capability-grid { grid-template-columns: 1fr; } }');
  });

  it('offers the way back to a held result, between the eraser and Home', () => {
    // The panel keeps a result until it is cleared or replaced, and before this control the
    // only way back from Settings or the Start page was to run the operation again.
    const held = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings,
      proModels,
      activeScreen: 'settings',
      sourceText: 'ledger',
      result: {
        ...base,
        kind: 'translation',
        operation: 'translate' as const,
        providerId: 'googleCloudTranslation',
        sourceText: 'ledger',
        translatedText: '원장'
      } satisfies TranslationResult
    });
    expect(held).toMatch(/data-command="showResult"[^>]*aria-label="Back to the KREN result"/u);

    // Scoped to the one header that carries it. Every screen renders into the same document
    // and each has its own header, so a document-wide indexOf compares controls that sit in
    // different bars. The eraser and this control never share a header by design: the eraser
    // appears only on the result screen, which is the one screen with nothing to go back to.
    const back = held.indexOf('aria-label="Back to the KREN result"');
    const bar = held.slice(held.lastIndexOf('<div class="top-actions">', back), held.indexOf('</header>', back));
    expect(bar.indexOf('aria-label="Back to the KREN result"'))
      .toBeLessThan(bar.indexOf('aria-label="Go to the KREN Start page"'));
    expect(bar).not.toContain('data-command="clear"');

    // No control when there is nothing to go back to, rather than one that does nothing.
    const empty = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings,
      proModels
    });
    // 2026-10-04: manual and dictionary always offer Back; empty results still do not.
    expect(load(empty)('#result-screen [data-command="showResult"]')).toHaveLength(0);
  });

  it('offers a Home control beside the menu on every screen', () => {
    const html = renderIconFixture();
    expect(html).toMatch(/data-command="showStartPage"[^>]*aria-label="Go to the KREN Start page"/u);
    // The menu entry is not a substitute: it takes two presses and hides the destination
    // behind a popover.
    expect(html).toContain('data-menu-toggle');
  });

  it('covers the panel with a named wait while an action is running', () => {
    const idle = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings,
      proModels
    });
    expect(idle).not.toContain('class="busy-overlay"');
    expect(idle).not.toContain('<body data-active-screen="result" data-busy');

    const busy = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings,
      proModels,
      busyNotice: 'Rewriting the selected text. Please wait.'
    });
    expect(busy).toContain('class="busy-overlay"');
    expect(busy).toContain('Rewriting the selected text. Please wait.');
    // The overlay is what makes it a freeze rather than a caption: it is fixed, covers the
    // viewport, and therefore takes every pointer event aimed at the controls beneath it.
    expect(busy).toMatch(/\.busy-overlay \{[^}]*position: fixed;[^}]*inset: 0;/u);
  });

  it('puts the apply bar inside the Rewrite Text group, not above the whole page', () => {
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings,
      activeScreen: 'settings',
      proModels,
      rewriteReplay: { armed: true, changed: false, running: false, subject: 'rewrite' }
    });
    // Bounded on both sides. "After the Rewrite marker" alone is satisfied by putting the
    // bar at the very bottom of the page, below Credentials, which is where a mutation
    // moved it while this test stayed green.
    const rewriteSection = html.indexOf('data-settings-section="rewrite"');
    // 2026-10-04: restrict the boundary to markup because CSS now names this section.
    const nextSection = html.indexOf('<details class="settings-group" data-settings-section="readAloud"');
    const bar = html.indexOf('class="apply-bar"');
    expect(rewriteSection).toBeGreaterThan(-1);
    expect(nextSection).toBeGreaterThan(rewriteSection);
    expect(bar).toBeGreaterThan(rewriteSection);
    expect(bar).toBeLessThan(nextSection);
  });

  it('scrolls Settings to the section a gear asked for', () => {
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings,
      activeScreen: 'settings',
      proModels,
      focusSettingsSection: 'rewrite'
    });
    expect(html).toContain('data-focus-section="rewrite"');
    expect(html).toContain("document.body.getAttribute('data-focus-section')");
    expect(html).toContain("'[data-settings-section=\"' + focusSection + '\"]'");
    // Finding the element is not showing it. Without this the whole scroll could be
    // deleted and every other assertion here would still pass.
    expect(html).toContain("target.scrollIntoView({ block: 'start' })");
  });

  it('keeps folded sections folded and the scroll where it was across a render', () => {
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings,
      activeScreen: 'settings',
      proModels
    });
    // Every top-level settings section is addressable, otherwise the reader's fold state
    // has nothing stable to be stored against.
    for (const section of ['startup', 'translation', 'grammar', 'explain', 'rewrite',
      'readAloud', 'dictionary', 'userDictionary', 'usage']) {
      expect(html, `${section} section`).toContain(`data-persist-id="settings-${section}"`);
    }
    // The document is replaced on every render, so this has to be webview state rather than
    // anything held in the document. Changing one setting used to reopen every section the
    // reader had folded and throw them back to the top of the page.
    expect(html).toContain('vscode.getState()');
    expect(html).toContain('vscode.setState(');
    expect(html).toContain("document.addEventListener('toggle'");
    // Recording the fold is half of it. Applying the recorded value on the next render is
    // the half the reader sees, and it could be deleted without failing anything else.
    expect(html).toContain("if (typeof stored === 'boolean') section.open = stored;");
    expect(html).toContain('window.scrollTo(0, restored.scroll.top)');
    // Restoring on the result screen would open a new result part way down, because a
    // render there is usually a different result rather than the same document again.
    expect(html).toContain('const scrollIsStable =');
    // 2026-10-10: V217 adds Credentials to the screens that retain their scroll position.
    const stableScreens = html.match(/const scrollIsStable = ([\s\S]*?);/u)![1]!;
    for (const screen of ['settings', 'credentials', 'manual']) expect(stableScreens).toContain(`activeScreen === '${screen}'`);
    expect(html).toContain('} else if (scrollIsStable && restored.scroll');
  });

  it('names the Smart Grammar model beside Harper when both ran', () => {
    const local = renderGrammarResult(grammarResult('I has apple.', [{
      id: 'issue-1',
      start: 2,
      end: 5,
      original: 'has',
      category: 'Agreement',
      message: 'Agreement.',
      suggestions: [{ kind: 'replace', replacement: 'have', label: 'have' }]
    }]));
    expect(local).toContain('Harper (offline)');
    expect(local).not.toContain('Harper (offline) + ');

    const smart = renderGrammarResult({
      ...grammarResult('I has apple.', [{
        id: 'issue-1',
        start: 2,
        end: 5,
        original: 'has',
        category: 'Agreement',
        message: 'Agreement.',
        suggestions: [{ kind: 'replace', replacement: 'have', label: 'have' }]
      }]),
      smartModelId: 'gemini-3.6-flash'
    });
    expect(smart).toContain('Harper (offline) + gemini-3.6-flash');
    expect(smart).toContain('found by Harper and gemini-3.6-flash');
  });

  it('gives the rewrite variant icon controls for copy, replace, and settings', () => {
    const html = renderIconFixture();
    const actions = html.slice(
      html.indexOf('<div class="variant-actions">'),
      html.indexOf('</article>', html.indexOf('<div class="variant-actions">'))
    );
    // The slice is asserted non-empty first. A slice built on a marker that moved is the
    // empty string, and every negative assertion below would then pass against nothing.
    expect(actions).not.toBe('');
    expect(actions).toContain('data-command="copyVariant"');
    expect(actions).toContain('data-command="replaceVariant"');
    expect(actions).toContain('data-command="editRewriteSettings"');
    // The accessible names still say Copy Minimal Rewrite, which is the point of an icon
    // control. What must be gone is the visible label, so this looks for text sitting
    // between a tag close and the button close rather than for the words anywhere.
    for (const button of actions.match(/<button[\s\S]*?<\/button>/gu) ?? []) {
      expect(button, `rewrite control is not an icon button: ${button}`)
        .toContain('class="secondary icon-button"');
      expect(button.replace(/<svg[\s\S]*?<\/svg>/gu, '').replace(/<[^>]*>/gu, '').trim())
        .toBe('');
    }
    // Confirmation still has to reach the icon, otherwise pressing Copy does nothing
    // visible at all.
    expect(actions).toMatch(/data-command="copyVariant"[^>]*data-copy-confirm/u);
  });

  it('confirms a copy on an icon button without erasing the icon', () => {
    const html = renderIconFixture();
    const script = html.slice(html.indexOf('function confirmCopyOn(target)'));
    expect(script).not.toBe('');
    // The text swap writes textContent, which deletes the SVG child of an icon button and
    // restores an empty label. The icon branch has to be reached before that runs.
    expect(script).toContain("target.classList.contains('icon-button')");
    expect(script.indexOf("classList.contains('icon-button')"))
      .toBeLessThan(script.indexOf("target.textContent = 'Result copied'"));
  });

  it('hides the Settings apply bar until a gear armed it and a setting moved', () => {
    const base = {
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings,
      activeScreen: 'settings',
      proModels
    } as const;
    const unarmed = renderKrenResultViewHtml(base);
    expect(unarmed).not.toContain('class="apply-bar"');
    expect(unarmed).not.toContain('data-command="regenerateResult"');

    const armed = renderKrenResultViewHtml({
      ...base,
      rewriteReplay: { armed: true, changed: false, running: false, subject: 'rewrite' }
    });
    expect(armed).toContain('class="apply-bar"');
    expect(armed).toContain('Change a setting below, then regenerate the rewrite.');
    expect(armed).toMatch(/data-command="regenerateResult"[^>]*disabled>/u);

    const changed = renderKrenResultViewHtml({
      ...base,
      rewriteReplay: { armed: true, changed: true, running: false, subject: 'rewrite' }
    });
    expect(changed).toContain('Regenerate the rewrite with these settings.');
    expect(changed).not.toMatch(/data-command="regenerateResult"[^>]*disabled>/u);

    const running = renderKrenResultViewHtml({
      ...base,
      rewriteReplay: { armed: true, changed: true, running: true, subject: 'rewrite' }
    });
    expect(running).toContain('Producing the rewrite again.');
    expect(running).toMatch(/data-command="regenerateResult"[^>]*disabled>/u);
  });

  it('renders every icon-only button as SVG without numeric HTML entity glyphs', () => {
    const buttons = renderedIconButtons(renderIconFixture());

    expect({
      buttonCount: buttons.length,
      everyButtonContainsSvg: buttons.every((button) => button.includes('<svg')),
      numericEntities: buttons.flatMap((button) => button.match(/&#\d+;/gu) ?? [])
    }).toEqual({
      buttonCount: buttons.length,
      everyButtonContainsSvg: true,
      numericEntities: []
    });
  });

  it('uses the shared path data for every panel icon', () => {
    const buttons = renderedIconButtons(renderIconFixture());
    const actualPaths = Object.fromEntries(PANEL_ICONS.map(([name, marker]) => {
      const button = buttons.find((candidate) => candidate.includes(marker)) ?? '';
      return [name, [...button.matchAll(/<path d="([^"]+)"\/>/gu)].map((match) => match[1])];
    }));
    const expectedPaths = Object.fromEntries(PANEL_ICONS.map(([name]) => [
      name,
      [...ICON_PATHS[name]]
    ]));

    expect(actualPaths).toEqual(expectedPaths);
  });

  it('styles shared icon SVGs as unfilled theme-colour strokes', () => {
    const html = renderIconFixture();
    // Changed 2026-10-16: V250, owner item I32, header and bridge gears share one stroke declaration.
    const iconRule = html.match(/\.icon-button svg, \.tutor-settings-bridge svg \{([^}]*)\}/u)?.[1] ?? '';

    expect({
      fill: /(?:^|;)\s*fill:\s*none\s*(?:;|$)/u.test(iconRule),
      stroke: /(?:^|;)\s*stroke:\s*currentColor\s*(?:;|$)/u.test(iconRule)
    }).toEqual({ fill: true, stroke: true });
  });

  it('labels every icon button rendered by settings and User Dictionary screens', () => {
    const entry = userDictionaryEntry();
    const settingsHtml = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: {
        ...settings,
        userDictionaryEnabled: true,
        credentialPresence: {
          geminiDefault: true,
          geminiAlternate: true,
          googleCloudTranslation: true,
          openai: true,
          anthropic: true,
          merriamWebsterCollegiate: true,
          merriamWebsterMedical: true,
          merriamWebsterThesaurus: true,
          koreanDictionary: true
        }
      },
      activeScreen: 'settings',
      proModels
    });
    const dictionaryHtml = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: { ...settings, userDictionaryEnabled: true },
      activeScreen: 'userDictionary',
      userDictionary: {
        entries: [entry],
        status: 'ready',
        selectedId: entry.id,
        selectedIds: [entry.id],
        purgePreview: {
          selection: 'olderThan3Months',
          cutoff: '2026-05-13T00:00:00.000Z',
          count: 1,
          entryIds: [entry.id],
          terms: [entry.term]
        }
      },
      proModels
    });
    const buttons = [settingsHtml, dictionaryHtml]
      .flatMap((html) => [...html.matchAll(/<button[^>]*class="[^"]*icon-button[^"]*"[^>]*>/g)])
      .map((match) => match[0]);

    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button, `icon button without a title: ${button}`).toMatch(/title="[^"]+"/);
      expect(button, `icon button without an aria-label: ${button}`).toMatch(/aria-label="[^"]+"/);
    }
  });

  it('renders every settings group foldable, in the required order', () => {
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: { ...settings, userDictionaryEnabled: true },
      activeScreen: 'settings',
      proModels
    });

    const titles = [...html.matchAll(/<details class="settings-group"[^>]*>\s*<summary><h3>([^<]+)<\/h3><\/summary>/g)]
      .map((match) => match[1]);
    expect(titles).toEqual(SETTINGS_GROUP_ORDER);

    // Every group folds, and none is left as a plain section. A single missed conversion
    // is invisible in a screenshot of an expanded panel.
    expect(html).not.toContain('<section class="settings-group">');
    expect((html.match(/<details class="settings-group"/g) ?? []).length)
      .toBe(SETTINGS_GROUP_ORDER.length);
  });

  it('keeps combined capture visible with its key reason and enables only the selected keyed work', () => {
    const missingKeyHtml = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: { ...settings, userDictionaryEnabled: true },
      activeScreen: 'settings',
      proModels
    });
    expect(missingKeyHtml).toContain(
      '<option value="merriamWebsterAndLlm" disabled>Merriam-Webster + LLM</option>'
    );
    expect(missingKeyHtml).toContain('unavailable until the Collegiate key is set');
    expect(missingKeyHtml).toContain('data-action="kren.setMerriamWebsterCollegiateApiKey"');

    const collegiateHtml = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: {
        ...settings,
        userDictionaryEnabled: true,
        credentialPresence: { merriamWebsterCollegiate: true }
      },
      activeScreen: 'settings',
      proModels
    });
    expect(collegiateHtml).toContain(
      '<option value="merriamWebsterAndLlm">Merriam-Webster + LLM</option>'
    );

  });

  it('renders empty, loading, generation-failed, and storage-error dictionary states explicitly', () => {
    const renderState = (userDictionary: Parameters<typeof renderKrenResultViewHtml>[0]['userDictionary']) =>
      renderKrenResultViewHtml({
        cspSource: 'vscode-webview://test',
        nonce: 'test-nonce',
        settings: {
          ...settings,
          userDictionaryEnabled: true,
          userDictionaryStoragePath: '/profile/globalStorage/kren/user-dictionary/entries.json'
        },
        activeScreen: 'userDictionary',
        userDictionary,
        proModels
      });

    expect(renderState({ entries: [], status: 'ready' })).toContain(
      'Your User Dictionary is empty.'
    );
    expect(renderState({ entries: [], status: 'loading' })).toContain(
      'Loading User Dictionary...'
    );
    expect(renderState({ entries: [], status: 'generationFailed' })).toContain(
      'User Dictionary generation failed'
    );
    const storageError = renderState({ entries: [], status: 'storageError' });
    expect(storageError).toContain('User Dictionary storage error');
    expect(storageError).toContain('/profile/globalStorage/kren/user-dictionary/entries.json');
    expect(storageError).toContain('did not replace it with an empty store');
    expect(storageError).not.toContain('Your User Dictionary is empty.');
  });

  it('renders lifecycle filters, selection-only actions, and preview disclosures', () => {
    const entry = userDictionaryEntry();
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: { ...settings, userDictionaryEnabled: true },
      activeScreen: 'userDictionary',
      userDictionary: {
        entries: [entry],
        status: 'ready',
        selectedIds: [entry.id],
        purgePreview: {
          selection: 'olderThan3Months',
          cutoff: '2026-05-13T00:00:00.000Z',
          count: 1,
          entryIds: [entry.id],
          terms: [entry.term]
        },
        importPreview: {
          currentEntryCount: 1,
          entryCount: 2,
          validEntryCount: 1,
          duplicateCount: 1,
          invalidRecordCount: 1,
          proposedAddCount: 1,
          storeDuplicateCount: 1,
          duplicates: [],
          invalidRecords: [{ recordIndex: 1 }],
          entries: [entry]
        }
      },
      proModels
    });

    for (const filter of ['language', 'collection', 'entryType', 'captureMode', 'source']) {
      expect(html).toContain(`data-dictionary-filter="${filter}"`);
    }
    expect(html).toContain('Search term, aliases, meanings, tags, and collections');
    expect(html).toContain('Delete selected (1)');
    expect(html).toContain('Export selected JSON');
    expect(html).toContain('Export selected Markdown');
    expect(html).toContain('2 records:</strong> 1 valid, 1 duplicates, 1 invalid');
    expect(html).toContain('Import cannot be applied');
    expect(html).toContain('Proposed changes:');
    expect(html).toContain('1 entry will be deleted');
    expect(html).toContain(`<li>${entry.term}</li>`);
    expect(html).toContain('exactly these previewed identifiers');
  });

  it('discloses the exact storage path and the lossless recovery route in settings', () => {
    const storagePath = '/profile/globalStorage/kren/user-dictionary/entries.json';
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: {
        ...settings,
        userDictionaryEnabled: true,
        userDictionaryStoragePath: storagePath,
        userDictionaryEntryCount: 38
      },
      activeScreen: 'settings',
      proModels
    });

    expect(html).toContain(`<strong>Location:</strong> <code>${storagePath}</code>`);
    expect(html).toContain('<strong>Entries:</strong> 38');
    // 2026-10-04: owner shortened recovery wording; guard preservation and recovery meaning.
    // Changed 2026-10-17: V261, F5 owner canvas edit, recovery copy still says to stop and preserve the store.
    expect(load(html)('[data-settings-section="userDictionary"]').text()).toMatch(/corrupt.*stops.*keeps.*entries\.json/u);
    expect(html).toContain('JSON is lossless');
    expect(load(html)('[data-settings-section="userDictionary"]').text()).toMatch(/Markdown.*lossy/u);
    expect(html).toContain('data-command="previewUserDictionaryImport"');
    expect(html).toContain('data-command="previewUserDictionaryPurge"');
  });

  it('renders a manual-mode entry without claiming a provider or model', () => {
    const entry = userDictionaryEntry({
      capture: {
        mode: 'manual',
        generatedAt: '1970-01-01T00:00:00.000Z',
        userEdited: true
      }
    });
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: { ...settings, userDictionaryEnabled: true },
      activeScreen: 'userDictionary',
      userDictionary: { entries: [entry], selectedId: entry.id },
      proModels
    });

    expect(html).toContain('Source: written or imported by you.');
    expect(html).not.toContain('Generated by');
  });

  it('repeats the part of speech on a sense only when the senses disagree', () => {
    function meaningsFor(parts: Array<string | undefined>): string {
      const entry = userDictionaryEntry({
        senses: parts.map((partOfSpeech, index) => ({
          id: `sense-${index + 1}`,
          ...(partOfSpeech ? { partOfSpeech } : {}),
          definition: `Definition ${index + 1}.`,
          synonyms: [],
          antonyms: [],
          relatedTerms: [],
          examples: []
        }))
      });
      const html = renderKrenResultViewHtml({
        cspSource: 'vscode-webview://test',
        nonce: 'test-nonce',
        settings: { ...settings, userDictionaryEnabled: true },
        activeScreen: 'userDictionary',
        userDictionary: { entries: [entry], selectedId: entry.id },
        proModels
      });
      const start = html.indexOf('<h3>Meanings</h3>');
      expect(start).toBeGreaterThan(-1);
      return html.slice(start, html.indexOf('<p class="dictionary-meta">Source:', start));
    }

    // Three senses all reading "adjective", under a filing line that already says
    // adjective, is three copies of one fact.
    const same = meaningsFor(['adjective', 'adjective', 'adjective']);
    expect(same).not.toBe('');
    expect(same).toContain('<strong>1.</strong>');
    expect(same).not.toContain('adjective</em>');

    // Where they differ it is the thing that separates them, so it has to stay.
    const differing = meaningsFor(['noun', 'verb']);
    expect(differing).toContain('<em class="sense-part-of-speech">noun</em>');
    expect(differing).toContain('<em class="sense-part-of-speech">verb</em>');
  });

  it('sets the number, the part of speech, and the definition on one line', () => {
    // Revised 2026-08-23. The number sat on its own line above the definition, costing a
    // line break per meaning and saying nothing the definition beside it does not.
    const entry = userDictionaryEntry({
      senses: [
        {
          id: 'sense-noun',
          partOfSpeech: 'noun',
          definition: 'The first meal of the day.',
          synonyms: [],
          antonyms: [],
          relatedTerms: [],
          examples: []
        },
        {
          id: 'sense-verb',
          partOfSpeech: 'verb',
          definition: 'To eat the first meal of the day.',
          synonyms: [],
          antonyms: [],
          relatedTerms: [],
          examples: []
        }
      ]
    });
    const html = detailHtml(entry);

    expect(html).toContain(
      '<p class="sense-definition"><strong>1.</strong>' +
      ' <em class="sense-part-of-speech">noun</em> The first meal of the day.</p>'
    );
    expect(html).toContain('.sense-definition { margin: 0; }');
  });

  it('shows a heteronym its own pronunciation, under the sense it belongs to', () => {
    const entry = userDictionaryEntry({
      term: 'record',
      pronunciation: { display: '/ˈrɛk.ɚd/', audioAvailable: false },
      senses: [
        {
          id: 'sense-1',
          partOfSpeech: 'noun',
          definition: 'A lasting account.',
          synonyms: [],
          antonyms: [],
          relatedTerms: [],
          examples: []
        },
        {
          id: 'sense-2',
          partOfSpeech: 'verb',
          pronunciation: '/rɪˈkɔːrd/',
          definition: 'To set down for later reference.',
          synonyms: [],
          antonyms: [],
          relatedTerms: [],
          examples: []
        }
      ]
    });
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: { ...settings, userDictionaryEnabled: true },
      activeScreen: 'userDictionary',
      userDictionary: { entries: [entry], selectedId: entry.id },
      proModels
    });

    expect(html).toContain('/ˈrɛk.ɚd/');
    expect(html).toContain('<p class="sense-pronunciation">/rɪˈkɔːrd/</p>');
    // The sense that takes the entry pronunciation carries none of its own, so the entry
    // one is not repeated down every sense of every ordinary word.
    const first = html.indexOf('<strong>1. noun</strong>');
    const second = html.indexOf('<strong>2. verb</strong>');
    expect(html.slice(first, second)).not.toContain('sense-pronunciation');
  });

  it('puts the entry controls directly under the term, above the meanings', () => {
    const entry = userDictionaryEntry();
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: { ...settings, userDictionaryEnabled: true },
      activeScreen: 'userDictionary',
      userDictionary: { entries: [entry], selectedId: entry.id },
      proModels
    });
    const term = html.indexOf('<h2>ledger</h2>');
    const actions = html.indexOf('class="settings-buttons entry-actions"');
    const meanings = html.indexOf('<h3>Meanings</h3>');
    expect(term).toBeGreaterThan(-1);
    expect(actions).toBeGreaterThan(term);
    expect(actions).toBeLessThan(meanings);
  });

  function detailHtml(entry: ReturnType<typeof userDictionaryEntry>): string {
    return renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: { ...settings, userDictionaryEnabled: true },
      activeScreen: 'userDictionary',
      userDictionary: { entries: [entry], selectedId: entry.id },
      proModels
    });
  }

  function turnUpEntry(senseId: string | undefined) {
    return userDictionaryEntry({
      id: 'entry-turn-up',
      term: 'turn up',
      entryType: 'phrasal verb',
      pronunciation: undefined,
      senses: [
        {
          id: 'sense-appear',
          partOfSpeech: 'verb',
          definition: 'To arrive or appear, especially unexpectedly.',
          synonyms: ['appear', 'show up'],
          antonyms: [],
          relatedTerms: [],
          examples: []
        },
        {
          id: 'sense-increase',
          partOfSpeech: 'verb',
          definition: 'To increase the volume, heat, or intensity of something.',
          synonyms: ['raise'],
          antonyms: [],
          relatedTerms: [],
          examples: []
        }
      ],
      capturedContext: {
        sentence: 'He turned up to the party without invitation.',
        ...(senseId ? { senseId } : {})
      }
    });
  }

  // "turn up" means appear in one sentence and increase in another, and the reader saved it
  // because of the sentence they met it in. The box answers that; the list below still has
  // to answer "what does this word mean", which is why the matched sense stays in it.
  it('leads with the meaning the captured sentence uses and keeps every other meaning', () => {
    const entry = turnUpEntry('sense-appear');
    // Changed 2026-10-06: V211 also names All meanings in the manual; assert the displayed dictionary only.
    const html = load(detailHtml(entry))('#user-dictionary-screen').html()!;

    const box = html.slice(
      html.indexOf('class="captured-context"'),
      html.indexOf('All meanings')
    );
    expect(box).toContain('In the captured text');
    expect(box).toContain('To arrive or appear, especially unexpectedly.');
    expect(box).toContain('He turned up to the party without invitation.');
    expect(box).not.toContain('To increase the volume');

    // Order inside the box: meaning, then synonyms, then the sentence that supports them.
    expect(box.indexOf('To arrive or appear')).toBeLessThan(box.indexOf('Synonyms:'));
    expect(box.indexOf('Synonyms:'))
      .toBeLessThan(box.indexOf('He turned up to the party'));

    // The box is above the list, and the list is still complete.
    expect(html.indexOf('captured-context')).toBeLessThan(html.indexOf('All meanings'));
    const list = html.slice(html.indexOf('All meanings'));
    expect(list).toContain('To arrive or appear, especially unexpectedly.');
    expect(list).toContain('To increase the volume, heat, or intensity of something.');
  });

  it('says the sentence settled nothing rather than showing an empty box', () => {
    // Changed 2026-10-06: Scope the context assertions to the entry rather than hidden manual text.
    const html = load(detailHtml(turnUpEntry(undefined)))('#user-dictionary-screen').html()!;
    const box = html.slice(
      html.indexOf('class="captured-context"'),
      html.indexOf('All meanings')
    );

    expect(box).toContain('This text did not single out one meaning.');
    expect(box).toContain('He turned up to the party without invitation.');
    expect(box).not.toContain('To arrive or appear');
  });

  it('renders the ordinary entry unchanged when nothing was captured', () => {
    // Changed 2026-10-06: The manual describes contextual entries; this assertion concerns this ordinary entry.
    const html = load(detailHtml(userDictionaryEntry()))('#user-dictionary-screen').html()!;

    // The class name, not the bare word: the stylesheet carries the rule on every render,
    // so a substring check on "captured-context" passes whether the box exists or not.
    expect(html).not.toContain('class="captured-context"');
    expect(html).toContain('<h3>Meanings</h3>');
    expect(html).not.toContain('All meanings');
  });

  it('sets the captured text and the examples as the meaning, italic and unfilled', () => {
    // Revised 2026-08-23. They were .88rem and the owner asked for parity with the
    // definition instead, with no fill and no indent: an example is the same content shown
    // in use, so setting it apart by size and colour said it was a different kind of thing.
    const html = detailHtml(turnUpEntry('sense-appear'));

    expect(html).toMatch(/\.captured-sentence \{[^}]*font-size: inherit/u);
    expect(html).toMatch(/\.captured-sentence \{[^}]*font-style: italic/u);
    expect(html).toMatch(/\.dictionary-sense blockquote \{[^}]*font-size: inherit/u);
    expect(html).toMatch(/\.dictionary-sense blockquote \{[^}]*font-style: italic/u);
    // Left-aligned with the definition above it, and carrying no fill of its own.
    expect(html).toMatch(/\.dictionary-sense blockquote \{[^}]*margin-left: 0/u);
    expect(html).toMatch(/\.dictionary-sense blockquote \{[^}]*background: none/u);
    // An empty line above the captured text, which the owner asked for by name.
    expect(html).toMatch(/\.captured-sentence \{[^}]*margin: 16px 0 0/u);
  });

  it('names Merriam-Webster in the source line whenever it was queried', () => {
    function sourceLineFor(overrides: Parameters<typeof userDictionaryEntry>[0]): string {
      const entry = userDictionaryEntry(overrides);
      const html = renderKrenResultViewHtml({
        cspSource: 'vscode-webview://test',
        nonce: 'test-nonce',
        settings: { ...settings, userDictionaryEnabled: true },
        activeScreen: 'userDictionary',
        userDictionary: { entries: [entry], selectedId: entry.id },
        proModels
      });
      const start = html.indexOf('Source:');
      expect(start).toBeGreaterThan(-1);
      return html.slice(start, html.indexOf('</p>', start));
    }

    // The line is keyed on the stored citation record rather than on the capture mode,
    // because the record is what says a query actually happened.
    const llmOnly = sourceLineFor({
      capture: {
        mode: 'llmOnly',
        provider: 'gemini',
        model: 'gemini-3.6-flash',
        generatedAt: '2026-08-01T00:00:00.000Z',
        userEdited: false
      },
      merriamWebsterReference: undefined
    });
    expect(llmOnly).toContain('Source: drafted by gemini / gemini-3.6-flash.');
    expect(llmOnly).toContain('No dictionary publisher was consulted.');
    expect(llmOnly).not.toContain('Merriam-Webster');

    const matched = sourceLineFor({
      capture: {
        mode: 'merriamWebsterAndLlm',
        provider: 'gemini',
        model: 'gemini-3.6-flash',
        generatedAt: '2026-08-01T00:00:00.000Z',
        userEdited: false
      },
      merriamWebsterReference: {
        referenceWork: 'collegiate',
        lookupTerm: 'ledger',
        entryId: 'ledger',
        matchStatus: 'matched'
      }
    });
    // The panel escapes the apostrophe and the quotes, which is what the reader's browser
    // turns back into punctuation, so the assertion matches the escaped form.
    expect(matched).toContain('Merriam-Webster&#39;s Collegiate® Dictionary was consulted for review under &quot;ledger&quot;');
    // The saved entry holds none of the publisher's wording, so the line must not read as
    // an attribution of text it does not contain.
    expect(matched).toContain('its wording is not stored in this entry');

    const noMatch = sourceLineFor({
      capture: {
        mode: 'merriamWebsterAndLlm',
        provider: 'gemini',
        model: 'gemini-3.6-flash',
        generatedAt: '2026-08-01T00:00:00.000Z',
        userEdited: true
      },
      merriamWebsterReference: {
        referenceWork: 'collegiate',
        lookupTerm: 'ledger',
        matchStatus: 'noMatch'
      }
    });
    expect(noMatch).toContain('Merriam-Webster&#39;s Collegiate® Dictionary returned no match for &quot;ledger&quot;');
    expect(noMatch).toContain('Edited by you after generation.');
  });

  it('renders a Markdown-imported entry with truthful manual provenance', () => {
    const markdown = exportUserDictionaryMarkdown({
      schemaVersion: 1,
      entries: [userDictionaryEntry()]
    });
    const imported = importUserDictionaryMarkdown(markdown).entries[0];
    expect(imported?.capture.mode).toBe('manual');
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: { ...settings, userDictionaryEnabled: true },
      activeScreen: 'userDictionary',
      userDictionary: { entries: imported ? [imported] : [] },
      proModels
    });

    expect(html).toContain('Source: written or imported by you.');
    expect(html).not.toContain('markdown-import');
    expect(html).not.toContain('Generated by');
  });

  it('visibly separates attributed live reference content from the personal draft', () => {
    const draft = userDictionaryEntry({
      capture: {
        mode: 'merriamWebsterAndLlm',
        provider: 'gemini',
        model: 'synthetic-model',
        generatedAt: '2026-08-12T01:00:00.000Z',
        userEdited: true
      }
    });
    const liveReference: DictionaryResult = {
      ...base,
      kind: 'dictionary',
      providerId: 'merriamWebsterCollegiate',
      sourceText: 'ledger',
      headword: 'ledger',
      entries: [{ meaning: 'A live provider definition.' }]
    };
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      // 2026-10-05: the host supplies bundled logo URIs rather than remote defaults.
      merriamWebsterLogoUris: { light: 'vscode-webview://test/mw-light.png', dark: 'vscode-webview://test/mw-dark.png' },
      settings: {
        ...settings,
        userDictionaryEnabled: true,
        credentialPresence: { merriamWebsterCollegiate: true }
      },
      activeScreen: 'userDictionary',
      userDictionary: {
        entries: [],
        draft,
        capture: {
          expression: 'ledger',
          captureMode: 'merriamWebsterAndLlm',
          draft,
          merriamWebster: {
            referenceWork: 'collegiate',
            lookupTerm: 'ledger',
            entryId: 'ledger:1',
            result: liveReference
          },
          fallbackUsed: false
        }
      },
      proModels
    });

    expect(html.indexOf('MERRIAM-WEBSTER LIVE REFERENCE'))
      .toBeLessThan(html.indexOf('PERSONAL KREN ENTRY'));
    expect(html).toContain('A live provider definition.');
    expect(html).toContain('A record used to organize transactions.');
    // 2026-10-04: Assert the attributed artwork, independent of theme classes.
    expect(load(html)('img.provider-logo[alt="Merriam-Webster logo"]')).toHaveLength(2);
    expect(html).toContain('.provider-logo { width: 50px; height: 50px;');
    expect(html).toContain('Live content is not stored with the personal entry.');
    expect(html).toContain('Save personal entry');
  });

  it('labels a genuine no-match fallback visibly', () => {
    const draft = userDictionaryEntry({
      capture: {
        mode: 'merriamWebsterAndLlm',
        provider: 'gemini',
        model: 'synthetic-model',
        generatedAt: '2026-08-12T01:00:00.000Z',
        userEdited: true
      },
      merriamWebsterReference: {
        referenceWork: 'collegiate',
        lookupTerm: 'ledger',
        matchStatus: 'noMatch'
      }
    });
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: {
        ...settings,
        userDictionaryEnabled: true,
        userDictionaryFallbackOnMerriamWebsterNoMatch: true,
        credentialPresence: { merriamWebsterCollegiate: true }
      },
      activeScreen: 'userDictionary',
      userDictionary: {
        entries: [],
        draft,
        capture: {
          expression: 'ledger',
          captureMode: 'merriamWebsterAndLlm',
          draft,
          merriamWebster: {
            referenceWork: 'collegiate',
            lookupTerm: 'ledger',
            noMatch: true
          },
          fallbackUsed: true
        }
      },
      proModels
    });

    expect(html).toContain('<strong>No match</strong> for ledger.');
    expect(html).toContain('<strong>LLM-only fallback shown.</strong>');
    expect(html).toContain('PERSONAL KREN ENTRY');
  });

  it('enables only valid credential actions for the current storage state', () => {
    const emptyHtml = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings,
      activeScreen: 'settings',
      proModels
    });

    // 2026-10-04: enabled actions communicate state after badge removal.
    expect(load(emptyHtml)(`[data-action="kren.setGeminiApiKey"]`).closest('.credential-row').text()).toContain('Gemini Free Tier');
    expect(load(emptyHtml)(`[data-action="kren.setGeminiApiKey"]`).is('[disabled]')).toBe(false);
    expect(emptyHtml).toContain('data-action="kren.setGeminiApiKey" title="Set Gemini Free Tier key" aria-label="Set the Gemini Free Tier API key">');
    expect(emptyHtml).toContain('aria-label="Remove the Gemini Free Tier API key" disabled>');
    expect(emptyHtml).toContain('data-action="kren.deleteAllApiKeys" disabled>Delete all API keys</button>');

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

    // 2026-10-04: enabled actions communicate state after badge removal.
    expect(load(storedHtml)(`[data-action="kren.deleteGeminiApiKey"]`).closest('.credential-row').text()).toContain('Gemini Free Tier');
    expect(load(storedHtml)(`[data-action="kren.deleteGeminiApiKey"]`).is('[disabled]')).toBe(false);
    expect(storedHtml).toContain('aria-label="Set the Gemini Free Tier API key" disabled>');
    expect(storedHtml).toContain('data-action="kren.deleteGeminiApiKey" title="Remove the Gemini Free Tier API key" aria-label="Remove the Gemini Free Tier API key">');
    expect(storedHtml).toContain('data-action="kren.deleteAllApiKeys">Delete all API keys</button>');

    const medicalHtml = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: {
        ...settings,
        credentialPresence: { merriamWebsterMedical: true }
      },
      activeScreen: 'settings',
      proModels
    });
    // 2026-10-04: enabled actions communicate state after badge removal.
    expect(load(medicalHtml)(`[data-action="kren.deleteMerriamWebsterMedicalApiKey"]`).closest('.credential-row').text()).toContain('Merriam-Webster Medical');
    expect(load(medicalHtml)(`[data-action="kren.deleteMerriamWebsterMedicalApiKey"]`).is('[disabled]')).toBe(false);
    expect(medicalHtml).toContain('aria-label="Set the Merriam-Webster Medical API key" disabled>');
    expect(medicalHtml).toContain('data-action="kren.deleteMerriamWebsterMedicalApiKey" title="Remove the Merriam-Webster Medical API key" aria-label="Remove the Merriam-Webster Medical API key">');

    // Fills exactly MERRIAM_WEBSTER_KEY_LIMIT slots rather than a hard-coded count, and
    // checks both sides of the boundary. The panel once printed one limit while
    // disabling the button at another, because the message came from the constant and
    // the disabled state from a literal. One rule, two copies.
    const presenceOrder = [
      'merriamWebsterCollegiate',
      'merriamWebsterThesaurus',
      'merriamWebsterMedical'
    ] as const;
    const atLimit = Object.fromEntries(
      presenceOrder.slice(0, MERRIAM_WEBSTER_KEY_LIMIT).map((name) => [name, true])
    );
    const belowLimit = Object.fromEntries(
      presenceOrder.slice(0, MERRIAM_WEBSTER_KEY_LIMIT - 1).map((name) => [name, true])
    );
    const renderWith = (credentialPresence: Record<string, boolean>) => renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: { ...settings, credentialPresence },
      activeScreen: 'settings',
      proModels
    });

    // One below the limit: no warning yet.
    expect(renderWith(belowLimit)).not.toContain(MERRIAM_WEBSTER_KEY_LIMIT_MESSAGE);

    const limitHtml = renderWith(atLimit);
    // Widened: presenceOrder is a three-element tuple and the limit is a literal type, so
    // a direct index is a compile error at 3 and legal at 2. That would typecheck in the
    // published tree and fail in the private one, from one shared file.
    const spare = (presenceOrder as readonly string[])[MERRIAM_WEBSTER_KEY_LIMIT];

    if (spare) {
      // Published behaviour, limit 2 of 3. A reference work is left unconfigured, so the
      // warning has somewhere to appear and its Set key button is disabled.
      const action = `kren.set${spare[0]?.toUpperCase()}${spare.slice(1)}ApiKey`;
      expect(limitHtml).toContain(MERRIAM_WEBSTER_KEY_LIMIT_MESSAGE);
      /*
       * The Set control is a floppy-disk icon, not the words "Set key". It became one on
       * 2026-08-22 and this assertion kept the old markup until 2026-08-28. Only a build
       * whose limit is below the number of reference works reaches this branch at all,
       * which is why it went unnoticed. Read the button rather than a label, and assert
       * the state that matters.
       */
      const at = limitHtml.indexOf(`data-action="${action}"`);
      expect(at, `${action} has no Set control`).toBeGreaterThan(-1);
      const setButton = limitHtml.slice(limitHtml.lastIndexOf('<button', at), limitHtml.indexOf('</button>', at));
      expect(setButton, 'the Set control is not disabled at the limit').toContain('disabled');
      expect(setButton).toContain('aria-label="Set the');
      // The row says why, rather than presenting an inert control with no explanation.
      expect(limitHtml).toContain('class="credential-reason"');
    } else {
      // Private development behaviour, limit 3 of 3. Every reference work is configured,
      // so no row is unset and the warning is unreachable by construction. That is
      // correct, not a missing message: the limit and the number of reference works
      // coincide, so there is nothing left to refuse.
      expect(limitHtml).not.toContain(MERRIAM_WEBSTER_KEY_LIMIT_MESSAGE);
      // 2026-10-04: stored keys retain enabled Remove and disabled Set after badge removal.
      for (const name of presenceOrder) {
        const label = name === 'merriamWebsterCollegiate' ? 'Merriam-Webster Collegiate'
          : name === 'merriamWebsterThesaurus' ? 'Merriam-Webster Thesaurus'
            : 'Merriam-Webster Medical';
        const row = load(limitHtml)(`[aria-label="Remove the ${label} API key"]`).closest('.credential-row');
        expect(row.text()).toContain(label);
        expect(row.find('[aria-label^="Remove"]').is('[disabled]')).toBe(false);
        expect(row.find('[aria-label^="Set"]').is('[disabled]')).toBe(true);
      }
    }

    const startHtml = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings,
      activeScreen: 'start',
      proModels
    });
    // Buttons since 2026-08-22, disabled rather than absent when the key is missing, so
    // the reader can see KREN has the feature and why it cannot run.
    for (const label of ['English Dictionary', 'Synonyms', 'Medical Dictionary']) {
      expect(startHtml, `${label} is offered but disabled`)
        .toMatch(new RegExp(
          `<button class="capability unavailable has-reason"[^>]*disabled><span class="capability-label">${label}`,
          'u'
        ));
    }
    // 2026-10-03: Reasons name the missing credential; assert the purpose, not wording.
    const reasons = load(startHtml)('.capability:disabled .capability-reason');
    expect(reasons.length).toBeGreaterThanOrEqual(3);
    reasons.each((_index, reason) => {
      // Changed 2026-10-22 (V293, owner I61/D22 A): one missing-key message with Open Credentials.
      expect(load(reason).text()).toMatch(/(?:API key.*KREN menu, Credentials|disabled)/iu);
    });
  });

  it('shows and escapes the complete input with a translation result', () => {
    const result: TranslationResult = {
      ...base,
      kind: 'translation',
      operation: 'translate' as const,
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
      // 2026-10-05: the host supplies bundled logo URIs rather than remote defaults.
      merriamWebsterLogoUris: { light: 'vscode-webview://test/mw-light.png', dark: 'vscode-webview://test/mw-dark.png' },
      brandImageUri,
      result,
      sourceText: result.sourceText,
      allowReplace: true,
      autoplayAudio: { url: audioUrl, headword: 'deliberate' },
      settings,
      proModels
    });

    expect(html).toContain(`data-audio-url="${audioUrl}"`);
    // 2026-10-05: pronunciation starts through the allowlisted script path; rendered src attributes stay local.
    expect(html).toContain(`void playPronunciation(${JSON.stringify(audioUrl)}, false);`);
    expect(html).not.toContain(`src="${audioUrl}"`);
    // 2026-10-24: CodeQL found the '<' escape replaced '<' with itself; a URL can no longer close the script.
    const hostile = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test', nonce: 'test-nonce', brandImageUri, result, sourceText: result.sourceText,
      allowReplace: true, autoplayAudio: { url: audioUrl + '?a=</script>', headword: 'deliberate' }, settings, proModels
    });
    expect(hostile).toContain('?a=\\u003c/script>');
    expect(hostile).not.toContain('?a=</script>');
    expect(html).toContain("message.command === 'playPronunciation'");
    expect(html).toContain("command: 'pronunciationStarted'");
    expect(html).toContain("command: 'pronunciationFailed'");
    expect(html).not.toContain('data-command="replace"');
    // Changed 2026-10-04: V198 names replacement in the manual; pronunciation must still have no replacement control.
    expect(html).not.toMatch(/<button\b[^>]*(?:aria-label|title)="Replace selection"/u);
    expect(html).toContain('media-src https://media.merriam-webster.com');
    for (const providerId of [
      'merriamWebsterCollegiate',
      'merriamWebsterMedical',
      'merriamWebsterThesaurus'
    ]) {
      const referenceHtml = renderKrenResultViewHtml({
        cspSource: 'vscode-webview://test',
        nonce: 'test-nonce',
      // 2026-10-05: the host supplies bundled logo URIs rather than remote defaults.
      merriamWebsterLogoUris: { light: 'vscode-webview://test/mw-light.png', dark: 'vscode-webview://test/mw-dark.png' },
        result: { ...result, providerId },
        sourceText: result.sourceText,
        allowReplace: false,
        settings,
        proModels
      });
      // 2026-10-04: Both official variants retain the attribution and approved size.
      expect(load(referenceHtml)('img.provider-logo[alt="Merriam-Webster logo"]')).toHaveLength(2);
      expect(referenceHtml).toContain('.provider-logo { width: 50px; height: 50px;');
    }
  });

  // Changed 2026-10-20: owner decision 12 A. The manual names the version alone and mentions the
  // User Dictionary only when it is turned off, which is when its missing commands need explaining.
  // 2026-10-20 (owner, canvas): header shortcuts to the tutor and Credentials, on every page.
  it('puts AI English Tutor and Credentials between Settings and the theme switch in every header', () => {
    for (const activeScreen of ['start', 'settings', 'credentials', 'manual', 'tutor', 'result'] as const) {
      const $ = load(renderKrenResultViewHtml({ cspSource: 'vscode-webview://test', nonce: 'test-nonce', settings, proModels, activeScreen }));
      const header = $('header.top').first();
      const commands = header.find('.top-actions > .icon-button').map((_, el) => $(el).attr('data-command') ?? 'menu').get();
      const at = commands.indexOf('showSettings');
      expect(commands.slice(at, at + 4), activeScreen).toEqual(['showSettings', 'showTutor', 'showCredentials', 'toggleTheme']);
      expect(header.find('[data-command="showTutor"]').attr('aria-label')).toBe('Open the AI English Tutor');
      // A chat bubble with a sparkle (owner choice B, 2026-10-20), not the Ask sparkles.
      expect(header.find('[data-command="showTutor"] path').first().attr('d')).toBe('M4 5.5h16v10.5H10l-4.5 3.5V16H4z');
      expect(header.find('[data-command="showCredentials"]').attr('aria-label')).toBe('Open KREN Credentials');
    }
    const html = renderKrenResultViewHtml({ cspSource: 'vscode-webview://test', nonce: 'test-nonce', settings, proModels });
    expect(html).toContain('.top-actions .icon-button { padding-left: 4px; padding-right: 4px; }');
    // 2026-10-20 (owner, canvas): no gap between header buttons, 4px around the menu, 30px Start page name.
    expect(html).toContain('.top-actions { display: flex; flex-shrink: 0; align-items: center; gap: 0; }');
    expect(html).toContain('.top-actions > .menu-wrap { padding-left: 4px; padding-right: 4px; }');
    expect(html).toContain('.intro-header .brand-name { font-size: 30px; }');
    expect(html).toContain('.provider { padding-top: 10px; padding-bottom: 10px; }');
  });

  // Changed 2026-10-21 (owner, canvas): The heading carries the version, with a separate notice only when off.
  it('puts the version in the manual heading and notes only a turned-off User Dictionary', () => {
    const render = (userDictionaryEnabled: boolean) => renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test', nonce: 'test-nonce', settings: { ...settings, userDictionaryEnabled }, proModels
    });
    const on = render(true);
    for (const enabled of [true, false]) {
      const $ = load(render(enabled));
      const manual = $('#manual-screen');
      expect(manual.children('h2').text()).toBe(`KREN ${settings.extensionVersion} User Manual`);
      expect(manual.find('p').filter((_, el) => /^Version\b/u.test($(el).text())).length).toBe(0);
      expect(manual.children('h2').next('p').text()).toBe(enabled ? '' : 'User Dictionary is turned off in Settings, so its commands are hidden.');
    }
    expect(on).not.toContain('User Dictionary is enabled');
    expect(on).not.toContain('User Dictionary is turned off');
    expect(render(false)).toContain('<p>User Dictionary is turned off in Settings, so its commands are hidden.</p>');
  });

  it('renders per-variant copy and editor-only replace actions', () => {
    const result: RewriteResult = {
      ...base,
      sourceLanguage: 'en',
      targetLanguage: 'en',
      kind: 'rewrite',
      providerId: 'gemini',
      modelId: 'gemini-3.5-flash',
      fallbackFromModel: 'gemini-3.1-pro-preview',
      sourceText: 'Leverage synergies.',
      englishVariety: 'british',
      domain: 'technical',
      modality: 'written',
      function: 'general',
      formality: 'preserve',
      voice: 'preserve',
      stance: 'preserve',
      length: 'preserve',
      perspective: 'preserve',
      rhetoricalMode: 'recommend',
      variants: [
        { id: 'minimal', label: 'Minimal Rewrite', text: 'Make better use of our combined strengths.' },
        { id: 'full', label: 'Full Rewrite', text: 'Work together more effectively.' }
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

    expect(html).toContain('data-command="copyVariant" data-variant-id="minimal"');
    expect(html).toContain('data-command="replaceVariant" data-variant-id="full"');
    expect(html).toContain('Open full details');
    expect(html).not.toContain('data-command="copy">Copy result');
    // Both variants render at once, minimal then full. They were tabs until 2026-08-22,
    // and comparing the two is the reason for asking for both, which a tab prevents.
    expect(html).not.toContain('data-variant-tab');
    expect(html).toContain('data-variant-panel="minimal"');
    expect(html).toContain('data-variant-panel="full"');
    // Read the class attribute of each variant article rather than assuming the attribute
    // order. The first version of this assertion expected data-variant-panel before class
    // and did not fire when a hidden class was reintroduced.
    const panelClasses = [...html.matchAll(/<article class="([^"]*)"[^>]*data-variant-panel=/gu)]
      .map((match) => match[1] ?? '');
    expect(panelClasses).toHaveLength(2);
    for (const className of panelClasses) {
      expect(className, `variant panel is visible, got "${className}"`).not.toContain('hidden');
    }
    expect(html.indexOf('data-variant-panel="minimal"'))
      .toBeLessThan(html.indexOf('data-variant-panel="full"'));
    expect(html).toContain('data-command="clear"');
    expect(html).toContain('KREN Settings');
    expect(html).toContain('data-setting="results.openAtStartup"');
    expect(html).toContain('data-setting="gemini.retry.enabled"');
    expect(html).toContain('data-setting="rewrite.fallbackModel"');
    expect(html).toContain('data-setting="rewrite.fallbackThinkingOrEffort"');
    expect(html).toContain('data-setting="explanation.geminiProfile"');
    expect(html).toContain('data-setting="rewrite.quickMenuVariant"');
    expect(html).toContain('data-setting="rewrite.sourceLanguage"');
    expect(html).toContain('data-setting="rewrite.englishVariety"');
    expect(html).toContain('Output language');
    expect(html).toContain('data-setting="rewrite.modality"');
    expect(html).toContain('data-setting="rewrite.function"');
    expect(html).toContain('data-setting="rewrite.domain"');
    expect(html).toContain('data-setting="rewrite.formality"');
    expect(html).toContain('data-setting="rewrite.voice"');
    expect(html).toContain('data-setting="rewrite.stance"');
    expect(html).toContain('data-setting="rewrite.length"');
    expect(html).toContain('data-setting="rewrite.perspective"');
    expect(html).not.toContain('data-setting="rewrite.tone"');
    expect(html).toContain('data-setting="rewrite.rhetoricalMode"');
    expect(html).toContain('data-setting="readAloud.voice"');
    expect(html).toContain('data-setting="readAloud.provider"');
    expect(html).toContain('data-provider-for="readAloud.provider" data-provider-value="edgeOnline"');
    // V102, 2026-09-15. This used to pass by matching the webview script's hard-coded
    // selector even while Auto-detect rendered no editable control. The preset handler is
    // now generic, so assert the real control in the state where it is reachable.
    const chosenVoiceHtml = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: { ...settings, edgeReadAloudLocale: 'en-US' },
      proModels
    });
    expect(chosenVoiceHtml).toContain('data-setting="readAloud.edgeVoice"');
    // The default speech source is Edge Online as of 2026-08-24, and its default locale is
    // Auto-detect, so the identifier field is the disabled one rather than an editable field
    // holding a stale voice.
    expect(html).toContain('Auto-selected by KREN');
    // The "(experimental)" label went on 2026-08-24 and Edge Online became the default: it
    // reads twenty languages, where Local Windows reads whichever voices the machine has.
    expect(html).toContain('Microsoft Edge Online');
    expect(html).not.toContain('(experimental)');
    // Changed 2026-10-17: V261, F5 owner canvas edit, the speech note still identifies the cleaned copy and recipient.
    expect(load(html)('[data-settings-section="readAloud"]').text()).toMatch(/only KREN's cleaned speech copy.*Microsoft/u);
    expect(html).toContain('Microsoft Zira Desktop');
    expect(html).toContain('data-action="kren.previewReadAloud"');
    expect(html).toContain('data-setting="pronunciation.windowsNativePlayback"');
    // The axis line moved out of the card title and under both panels on 2026-08-22.
    expect(html).toContain('<p class="result-meta rewrite-meta">Language: <strong>English</strong> | English: <strong>British</strong> | Modality: <strong>Written</strong> | Function: <strong>General</strong> | Domain: <strong>Technical</strong> | Formality: <strong>Preserve</strong> | Voice: <strong>Preserve</strong> | Stance: <strong>Preserve</strong> | Length: <strong>Preserve</strong> | Perspective: <strong>Preserve</strong> | Intent: <strong>Recommend</strong></p>');
    expect(html).toContain('<h2 class="card-title">Result</h2>');
    // Last, under both variants, not above them.
    expect(html.indexOf('data-variant-panel="full"'))
      .toBeLessThan(html.indexOf('class="result-meta rewrite-meta"'));
    expect(html).toContain('data-command="refreshProModels"');
    // The two Gemini preset toggles were removed on 2026-08-24. Each set a provider the
    // select directly below it already sets, and each carried its own copy of the regional
    // eligibility sentence, which now appears once under Credentials and Usage.
    expect(html).not.toContain('data-preset=');
    expect(html).not.toContain('Free API');
    expect(html).not.toContain('Paid Gemini');
    expect(html).toContain('data-provider-for="explanation.provider" data-provider-value="gemini"');
    expect(html).toContain('data-setting="rewrite.provider"');
    expect(html).toContain('data-command="readVariant" data-variant-id="minimal"');
    // All five language-model features present the same foldable, so a reader looking for
    // where a request is routed finds one heading rather than five that nearly match.
    expect(html.match(/<span class="rewrite-group-name">LLM ROUTING<\/span>/gu)).toHaveLength(5);
    for (const feature of ['translation', 'grammar', 'explain', 'rewrite', 'userDictionary']) {
      expect(html).toContain(`data-llm-routing="${feature}"`);
    }
    // Smart Grammar Check and User Dictionary render one stored profile in two editable
    // places. Grammar owns no parallel keys that could drift away from that profile.
    // Changed 2026-10-17: V261, F5 owner canvas edit, both features still share a model profile.
    expect(load(html)('[data-llm-routing="grammar"]').text()).toMatch(/Grammar Check and User Dictionary share.*model profile/u);
    expect(html).not.toContain('data-setting="grammar.provider"');
    expect(html).not.toContain('data-setting="grammar.model"');
    expect(html).not.toContain('data-setting="grammar.thinkingOrEffort"');
    // Match the markup, not the class name on its own: setting-inactive appears in the
    // stylesheet and the webview script on every render, so a bare token proves nothing.
    expect(html).toContain('data-llm-routing="grammar" data-persist-id="settings-grammar-routing" data-enabled-for="grammar.smart" data-enabled-value="true"');
    expect(html).toContain('data-llm-routing="translation" data-persist-id="settings-translation-routing" data-enabled-for="translationProvider" data-enabled-value="gemini"');
    expect(html.match(/data-always-disabled/gu)).toHaveLength(1);
    expect(html).toContain('data-command="stopReadAloud"');
    expect(html).not.toContain('speechSynthesis');
    // Revised 2026-08-24. The six hand-written presets are gone, along with
    // en-US-ChristopherMultilingualNeural, which the runtime does not have and never had.
    // The Language/Region control renders always; the Voice list follows from it.
    expect(html).toContain('data-setting="readAloud.edgeLocale"');
    expect(html).toContain('data-edge-voice-preset');
    expect(html).toContain('Editable Edge TTS voice ID');
    expect(html).not.toContain('en-US-ChristopherMultilingualNeural');
    expect(html).toContain('25%');
    expect(html).toContain('0% (normal)');
    expect(html).toContain('Fallback used after <strong>gemini-3.1-pro-preview</strong>');
    expect(html).toContain('<div class="provider"><span>gemini-3.5-flash</span></div>');
    expect(html).not.toContain('Model: <strong>gemini-3.5-flash</strong>');
    expect(html).not.toContain('<span>Gemini<br>');
    // Renamed on the owner's instruction, 2026-08-28, and joined by Default Setting
    // between it and Delete all API keys.
    expect(html).toContain('>Default Setting</button>');
    expect(html).toContain('>Reset KREN</button>');
    expect(html).not.toContain('All KREN settings');
    expect(html).toContain('data-command="showManual"');
    expect(html).toContain('data-menu-toggle');
    expect(html).toContain('data-command="showStartPage"');
    expect(html).toContain('>Start Page</button>');
    expect(html).toContain("target.closest('.menu-wrap')");
    expect(html).not.toContain('&#9432;');
    // Changed 2026-10-21 (owner, canvas): The manual heading includes the version.
    expect(load(html)('#manual-screen > h2').text()).toBe('KREN 1.0.0 User Manual');
    expect(html).toContain(krenCreditLine('1.0.0'));
    // Changed 2026-10-06: V211 moves requirements into setup and Reference without losing the facts.
    expect(html).toContain('<h3>Set up</h3>');
    expect(html).toContain('VS Code Desktop 1.106 or later');
    expect(html).toContain('Delete all API keys');
    expect(html).toContain('data-action="kren.deleteGeminiApiKey"');
    expect(html).toMatch(/Offline grammar[^.]*no API key, account, Python, Node.js, GPU, or network/u);
    // Changed 2026-10-04: V198 documents the reference choice and public limit without claiming private enforcement.
    expect(html).toMatch(/configure two of the three Merriam-Webster references/u);
    expect(html).toMatch(/public build[^.]*third stored reference key/iu);
    expect(html).toContain('Windows-native speech is unavailable in WSL');
    expect(html).toMatch(/API users[^.]*at least 18/u);
    expect(html).toContain('professional or business purposes');
    expect(html).toMatch(/No document change occurs until you choose replacement/u);
    expect(html).toContain('<h4>What leaves the machine</h4>');
    expect(html).toContain('<h4>Limits and requirements</h4>');
    expect(html).toContain(`src="${brandImageUri}"`);
    expect(html).not.toContain('data-tts-text');
    const script = html.match(/<script nonce="test-nonce">([\s\S]*?)<\/script>/u)?.[1];
    expect(script).toBeDefined();
    expect(() => new Function(script ?? '')).not.toThrow();
  });

  it('checks suggestion zero instead of Keep original when a suggestion exists', () => {
    const result = grammarResult('I has apple.', [{
        id: 'issue-1',
        start: 2,
        end: 5,
        original: 'has',
        category: 'Agreement',
        message: 'The verb must agree with the pronoun.',
        suggestions: [{ kind: 'replace', replacement: 'have', label: 'Replace with “have”' }]
      }]);
    const html = renderGrammarResult(result);

    expect(checkedGrammarChoices(html)).toEqual([
      { issueId: 'issue-1', suggestionIndex: 0 }
    ]);
    // These five predate the preselection change and have nothing to do with it. They are
    // restored here because the test that carried them was rewritten around the new
    // default, and dropping an unrelated assertion during a rewrite is how coverage
    // quietly leaves.
    expect(html).toContain('Harper (offline)');
    expect(html).toContain('Keep original');
    expect(html).toContain('Replace with “have”');
    expect(html).toContain('data-command="applyGrammar"');
    expect(html).toContain('data-command="copyGrammar"');
    expect(html).toContain("command === 'applyGrammar' || command === 'copyGrammar'");
  });

  it('keeps Keep original checked when a finding has no suggestions', () => {
    const result = grammarResult('Unclear.', [{
      id: 'issue-empty',
      start: 0,
      end: 7,
      original: 'Unclear',
      category: 'Style',
      message: 'Review this wording.',
      suggestions: []
    }]);

    expect(checkedGrammarChoices(renderGrammarResult(result))).toEqual([
      { issueId: 'issue-empty', suggestionIndex: -1 }
    ]);
  });

  it('keeps the later finding on Keep original when first suggestions overlap', () => {
    const result = grammarResult('abcdef', [
      {
        id: 'issue-first',
        start: 1,
        end: 4,
        original: 'bcd',
        category: 'Grammar',
        message: 'First finding.',
        suggestions: [{ kind: 'replace', replacement: 'B', label: 'Use B' }]
      },
      {
        id: 'issue-second',
        start: 3,
        end: 5,
        original: 'de',
        category: 'Grammar',
        message: 'Second finding.',
        suggestions: [{ kind: 'replace', replacement: 'D', label: 'Use D' }]
      }
    ]);

    expect(checkedGrammarChoices(renderGrammarResult(result))).toEqual([
      { issueId: 'issue-first', suggestionIndex: 0 },
      { issueId: 'issue-second', suggestionIndex: -1 }
    ]);
  });

  it('preselects same-offset insertAfter suggestions independently', () => {
    const issues: GrammarIssue[] = [
      {
        id: 'insert-first',
        start: 0,
        end: 1,
        original: 'a',
        category: 'Punctuation',
        message: 'First insertion.',
        suggestions: [{ kind: 'insertAfter', replacement: '!', label: 'Insert !' }]
      },
      {
        id: 'insert-second',
        start: 0,
        end: 1,
        original: 'a',
        category: 'Punctuation',
        message: 'Second insertion.',
        suggestions: [{ kind: 'insertAfter', replacement: '?', label: 'Insert ?' }]
      }
    ];

    expect([...preselectedGrammarChoices(grammarResult('ab', issues))])
      .toEqual(['insert-first', 'insert-second']);
  });

  it('produces preselected choices that core can apply when findings overlap', () => {
    const result = grammarResult('abcdef', [
      {
        id: 'issue-first',
        start: 1,
        end: 4,
        original: 'bcd',
        category: 'Grammar',
        message: 'First finding.',
        suggestions: [{ kind: 'replace', replacement: 'B', label: 'Use B' }]
      },
      {
        id: 'issue-second',
        start: 3,
        end: 5,
        original: 'de',
        category: 'Grammar',
        message: 'Second finding.',
        suggestions: [{ kind: 'replace', replacement: 'D', label: 'Use D' }]
      }
    ]);
    const choices = [...preselectedGrammarChoices(result)]
      .map((issueId) => ({ issueId, suggestionIndex: 0 }));

    expect(() => applyCoreGrammarChoices(result, choices)).not.toThrow();
  });

  it('ships the correction buttons enabled, and omits them when nothing can be applied', () => {
    const suggested = grammarResult('bad', [{
      id: 'issue-suggested',
      start: 0,
      end: 3,
      original: 'bad',
      category: 'Grammar',
      message: 'Use a correction.',
      suggestions: [{ kind: 'replace', replacement: 'good', label: 'Use good' }]
    }]);
    const withoutSuggestions = grammarResult('unclear', [{
      id: 'issue-empty',
      start: 0,
      end: 7,
      original: 'unclear',
      category: 'Style',
      message: 'Review this wording.',
      suggestions: []
    }]);

    const withoutSuggestionsHtml = renderGrammarResult(withoutSuggestions);

    const suggestedHtml = renderGrammarResult(suggested);
    // The corrected passage is the artifact, so Replace and Copy sit on it as icons and act
    // on exactly what the box holds. A result with nothing to correct produces no box, so
    // it keeps the plain control that copies the passage that was checked.
    expect(suggestedHtml).toContain('data-grammar-draft');
    expect(suggestedHtml).toContain('>good</textarea>');
    expect(suggestedHtml).toMatch(/data-command="applyGrammar"[^>]*data-grammar-draft-action/u);
    expect(suggestedHtml).toMatch(/data-command="copyGrammar"[^>]*data-grammar-draft-action/u);
    expect(suggestedHtml).toContain('data-command="resetGrammarDraft"');
    // Matched on the element, not the attribute name: the panel script contains a
    // querySelector for that attribute, so the bare name is present on every screen and a
    // negative assertion on it would pass for the wrong reason.
    expect(withoutSuggestionsHtml).not.toContain('<textarea id="grammar-draft-text"');
    // A finding with no suggestion still lists the finding, so it keeps Open full details.
    expect(withoutSuggestionsHtml).toContain('data-command="details"');
    /*
     * Ignore all, added 1.7.12. It sits after Open full details on any result that has
     * findings, and is absent from a clean one, which has nothing to ignore. What pressing
     * it does is covered in grammarIgnoreAll.test.ts.
     */
    expect(suggestedHtml).toContain('data-command="ignoreGrammarResult"');
    expect(suggestedHtml).toContain('>Ignore all</button>');
    expect(suggestedHtml.indexOf('data-command="details"'))
      .toBeLessThan(suggestedHtml.indexOf('data-command="ignoreGrammarResult"'));
    expect(renderGrammarResult(grammarResult('good', []))).not.toContain('ignoreGrammarResult');
    expect(withoutSuggestionsHtml).not.toContain('>Copy checked text</button>');
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

    expect(html).toContain('KREN is a privacy-conscious language copilot');
    expect(html).toContain('1. Select or copy');
    expect(html).toContain('2. Choose an action');
    // 2026-10-03: Readers need an inline replica of the status bar item in the visible step.
    const $ = load(html);
    // Changed 2026-10-19: V282 (2.0.1 page text) names the tutor in the visible introduction.
    const lead = $('.welcome-lead');
    expect(lead.text()).toBe('KREN is a privacy-conscious language copilot for dictionaries, smart grammar checking, translation, nuance, rewriting, and read-aloud, with multilingual and auto-detect support, plus an LLM-based AI English Tutor, inside VS Code.');
    expect(lead.parents('details, [hidden]')).toHaveLength(0);
    const step = $('.welcome-step').filter((_, element) =>
      $(element).children('strong').text().includes('Choose an action'));
    expect(step).toHaveLength(1);
    expect(step.parents('details, [hidden]')).toHaveLength(0);
    const item = step.find('span[aria-label="KREN status bar item"]');
    expect(item).toHaveLength(1);
    expect(item.text().trim()).toBe('KREN');
    expect(item.find('svg path')).toHaveLength(1);
    expect(item.find('svg').attr('viewBox')).toBe('0 0 16 16');
    expect(item.find('svg').attr('fill')).toBe('currentColor');
    expect(item.closest('button, a')).toHaveLength(0);
    expect(item.attr('data-command')).toBeUndefined();
    expect(item.attr('style')).toBeUndefined();
    expect(html).toMatch(/\.welcome-step > span\s*\{[^}]*display: block/);
    expect(html).toMatch(/\.welcome-step \.welcome-status-item\s*\{[^}]*display: inline-flex;[^}]*font-size: inherit; font-weight: normal;/);
    expect(html).toMatch(/\.welcome-status-item svg\s*\{[^}]*width: 1em; height: 1em;/);
    expect(step.find('span strong')).toHaveLength(0);
    expect(step.text()).toMatch(/Right-click the selection, or click\s*KREN\s*in the status bar for clipboard text\./);
    expect(html).toContain('class="welcome-layout"');
    // Changed 2026-10-17: V261, F5 owner canvas edit, the welcome lead is 14px.
    expect(html).toContain('.welcome-lead { margin: 0 0 24px; font-size: 14px;');
    expect(html).toContain('.privacy-note { margin: 24px 5px 0; color: var(--vscode-descriptionForeground); font-size: .95rem;');
    expect(html).toContain('font-size: .74rem; text-align: left;');
    expect(html).toContain('English Dictionary');
    expect(html).toContain('Read Aloud');
    expect(html.indexOf('English Dictionary')).toBeLessThan(html.indexOf('Synonyms'));
    expect(html.indexOf('Synonyms')).toBeLessThan(html.indexOf('Medical Dictionary'));
    expect(html.indexOf('Medical Dictionary')).toBeLessThan(html.indexOf('Korean Dictionary'));
    expect(html).toContain(krenCreditLine('1.0.0'));
  });

  it('renders Start Page as the introduction without discarding a stored result', () => {
    const result: TranslationResult = {
      ...base,
      kind: 'translation',
      operation: 'translate' as const,
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

    expect(html).toContain('KREN is a privacy-conscious language copilot');
    expect(html).not.toContain('안녕하세요');
    expect(html).toContain('id="result-screen" class="result-screen"');
  });

  it('names every setting and its value on every rewrite group summary', () => {
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      brandImageUri,
      activeScreen: 'settings',
      settings: {
        ...settings,
        rewriteDomain: 'general',
        rewriteRhetoricalMode: 'preserve'
      },
      proModels
    });

    for (const group of REWRITE_SETTINGS_GROUPS) {
      const summary = html.match(
        new RegExp(`<summary data-rewrite-group-summary="${group}">([\\s\\S]*?)</summary>`, 'u')
      )?.[1];
      // Every group states its settings, whether or not they are on their default. A
      // summary reading "Defaults" said nothing about what the group even controls, so the
      // only way to find that out was to open all eight of them.
      expect(summary, `${group} summary`).toBeDefined();
      expect(summary, `${group} summary`).not.toContain('Defaults');
      expect(summary, `${group} summary`).toMatch(/[A-Za-z]+: [A-Za-z]/u);
    }
    const channel = html.match(
      /<summary data-rewrite-group-summary="channel">([\s\S]*?)<\/summary>/u
    )?.[1];
    expect(channel).toContain('Modality: Written');
    expect(channel).toContain('Function: General');
  });

  it('summarises only non-default values and opens only the edited group', () => {
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      brandImageUri,
      activeScreen: 'settings',
      activeRewriteSettingsGroup: 'register',
      settings,
      proModels
    });
    const subjectSummary = html.match(
      /<summary data-rewrite-group-summary="subject">([\s\S]*?)<\/summary>/u
    )?.[1];
    const intentSummary = html.match(
      /<summary data-rewrite-group-summary="intent">([\s\S]*?)<\/summary>/u
    )?.[1];

    expect(subjectSummary).toContain('Domain: Technical');
    expect(intentSummary).toContain('Rhetorical mode: Recommend');
    expect(html).toContain('data-rewrite-group="register" open');
    expect(html.match(/<details class="rewrite-settings-group"[^>]* open/gu)).toHaveLength(1);
  });

  it('computes the displayed mode from axes set by hand', () => {
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      brandImageUri,
      activeScreen: 'settings',
      settings: {
        ...settings,
        rewriteModality: 'written',
        rewriteFunction: 'manuscript',
        rewriteDomain: 'scientific',
        rewriteFormality: 'formal',
        rewriteVoice: 'objective',
        rewriteStance: 'neutral',
        rewriteLength: 'compress',
        rewritePerspective: 'impersonal'
      },
      proModels
    });

    expect(html).toContain('<option value="manuscript" selected>Manuscript</option>');
    expect(html).toContain('<option value="custom" disabled>Custom</option>');
    expect(html).toContain("command: 'applyRewriteMode'");
  });

  // The panel names the safest rhetorical mode twice in prose, in the Rewrite help
  // paragraph and in the setting description. Neither is generated from the axis array,
  // so when `preserveOriginal` was renamed to `preserve` in 1.3.0 both kept advertising
  // "Preserve Original", a value that no longer existed under that name. The same defect
  // as always: one rule, two copies, agreeing with each other and with nothing else.
  //
  // Asserted against the label rather than a literal, so renaming it again fails here
  // until the prose is updated too.
  it('names the current rhetorical-mode default in prose, not a retired label', () => {
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      brandImageUri,
      activeScreen: 'settings',
      settings,
      proModels
    });
    const defaultLabel = REWRITE_RHETORICAL_MODES[0].label;

    expect(html).toContain(`<option value="${REWRITE_RHETORICAL_MODES[0].id}" selected>${defaultLabel}</option>`);
    expect(html).toContain(`Controls what the rewrite is trying to accomplish. ${defaultLabel} is the safest default.`);
    for (const option of REWRITE_RHETORICAL_MODES.slice(1)) {
      expect(html).not.toContain(`${defaultLabel} ${option.label}`);
    }
  });
});

describe('the attribution line', () => {
  // One definition, rendered in two places. Every assertion elsewhere derives from the
  // function, which is right for keeping the two renders in step and means nothing would
  // notice if the attribution itself were reverted or mangled. This is the only test that
  // reads the words.
  it('names the author, and still credits both agents', () => {
    expect(krenCreditLine('9.9.9'))
      .toBe('Designed &amp; Developed by T.H. YANG using CLAUDE CODE and CODEX · Version 9.9.9');
    // The ampersand is escaped because this string goes into markup unescaped.
    expect(krenCreditLine('9.9.9')).not.toMatch(/&(?!amp;)/u);
  });

  it('escapes the version, which is the only part that varies', () => {
    expect(krenCreditLine('<script>')).toContain('&lt;script&gt;');
    expect(krenCreditLine('<script>')).not.toContain('<script>');
  });
});

describe('the welcome capability grid and the quick pick', () => {
  const extension = readFileSync('src/extension.ts', 'utf8');
  const variants = readFileSync('src/rewriteVariants.ts', 'utf8');
  const renderStart = (panelSettings: KrenPanelSettings): string => renderKrenResultViewHtml({
    cspSource: 'vscode-webview://test',
    nonce: 'test-nonce',
    settings: panelSettings,
    activeScreen: 'start',
    proModels: []
  });
  const baseSettings = settings;

  it('names Grammar Check for what it will actually do', () => {
    // Smart Grammar Check ships on, and with it on the check is not local. Showing the
    // same label either way told the reader nothing about where their text was going.
    // Scoped to the capability grid: the settings screen carries a toggle with the same
    // words and is rendered into the same document, so an unscoped search always matches.
    const grid = (html: string): string => {
      const at = html.indexOf('class="capability-grid"');
      expect(at, 'the welcome screen has a capability grid').toBeGreaterThan(-1);
      return html.slice(at, html.indexOf('</div>', html.indexOf('Read Aloud', at)));
    };
    // 2026-10-03: Smart runs only with its routed key; without it Harper still runs.
    const on = grid(renderStart({ ...baseSettings, grammarSmart: true, credentialPresence: { geminiDefault: true } }));
    const off = grid(renderStart({ ...baseSettings, grammarSmart: false }));
    expect(on).toContain('>Smart Grammar Check<');
    expect(off).toContain('>Grammar Check<');
    expect(off).not.toContain('>Smart Grammar Check<');
  });

  const defaults = { ...settings, grammarSmart: true, credentialPresence: {} };
  const byCommand = (panelSettings: KrenPanelSettings, command: string) =>
    capabilityAvailability(panelSettings).find((action) => action.command === command)!;

  it('with no keys enables only local Grammar Check and keyless Read Aloud', () => {
    const actions = capabilityAvailability(defaults);
    expect(actions).toHaveLength(10);
    expect(actions.filter((action) => action.available).map((action) => action.command)).toEqual([
      'kren.grammarCheckSelection', 'kren.readAloudSelection'
    ]);
    expect(byCommand(defaults, 'kren.grammarCheckSelection').label).toBe('Grammar Check');
    for (const provider of ['edgeOnline', 'windowsLocal'] as const) {
      expect(byCommand({ ...defaults, readAloudProvider: provider }, 'kren.readAloudSelection').available).toBe(true);
    }
  });

  it('adding Gemini enables exactly the Gemini-routed actions and upgrades the grammar label', () => {
    const routed = { ...defaults, translationProvider: 'gemini' as const, userDictionaryEnabled: true };
    const before = capabilityAvailability(routed);
    const after = capabilityAvailability({ ...routed, credentialPresence: { geminiDefault: true } });
    expect(after.filter((action, index) => action.available && !before[index]!.available)
      .map((action) => action.command)).toEqual([
      'kren.translateSelection', 'kren.explainSelection', 'kren.rewriteEnglishSelection', 'kren.addToUserDictionary'
    ]);
    expect(after.find((action) => action.command === 'kren.grammarCheckSelection')?.label).toBe('Smart Grammar Check');
  });

  it('Translation requires the currently selected provider key', () => {
    const panel = { ...defaults, translationProvider: 'gemini' as const, credentialPresence: { geminiDefault: true } };
    expect(byCommand(panel, 'kren.translateSelection').available).toBe(true);
    expect(byCommand({ ...panel, translationProvider: 'googleCloudTranslation' }, 'kren.translateSelection').available).toBe(false);
    expect(byCommand({ ...panel, credentialPresence: {} }, 'kren.translateSelection').available).toBe(false);
    expect(byCommand({ ...panel, translationProfile: 'pro' }, 'kren.translateSelection').available).toBe(false);
    expect(byCommand({ ...panel, translationRoutingProvider: 'openai' }, 'kren.translateSelection').available).toBe(false);
    expect(byCommand({ ...defaults, credentialPresence: { googleCloudTranslation: true } }, 'kren.translateSelection').available).toBe(true);
  });

  it.each(['openai', 'anthropic', 'gemini'] as const)('uses the selected %s route and Gemini profile for model actions', (provider) => {
    const panel = { ...defaults, userDictionaryEnabled: true, explanationProvider: provider, rewriteProvider: provider,
      userDictionaryProvider: provider, explanationProfile: 'pro' as const, rewriteProfile: 'pro' as const,
      userDictionaryProfile: 'pro' as const };
    const credential = provider === 'gemini' ? 'geminiAlternate' : provider;
    const present = { ...panel, credentialPresence: { [credential]: true } };
    for (const command of ['kren.explainSelection', 'kren.rewriteEnglishSelection', 'kren.addToUserDictionary']) {
      expect(byCommand(panel, command).available).toBe(false);
      expect(byCommand(present, command).available).toBe(true);
    }
    expect(byCommand(panel, 'kren.grammarCheckSelection').label).toBe('Grammar Check');
    expect(byCommand(present, 'kren.grammarCheckSelection').label).toBe('Smart Grammar Check');
    expect(byCommand({ ...present, userDictionaryModel: '' }, 'kren.grammarCheckSelection').label).toBe('Grammar Check');
  });

  it('requires both credentials for combined capture and respects the dictionary enable setting', () => {
    const panel = { ...defaults, userDictionaryEnabled: true, userDictionaryCaptureMode: 'merriamWebsterAndLlm' as const,
      credentialPresence: { geminiDefault: true } };
    expect(byCommand(panel, 'kren.addToUserDictionary').available).toBe(false);
    const present = { ...panel, credentialPresence: { ...panel.credentialPresence, merriamWebsterCollegiate: true } };
    expect(byCommand(present, 'kren.addToUserDictionary').available).toBe(true);
    expect(byCommand({ ...present, userDictionaryEnabled: false }, 'kren.addToUserDictionary').reason).toMatch(/disabled/iu);
    expect(byCommand({ ...present, credentialPresence: { merriamWebsterCollegiate: true } }, 'kren.addToUserDictionary').available).toBe(false);
  });

  it('renders every grid button from the exported availability function', () => {
    for (const panel of [defaults, { ...defaults, credentialPresence: { geminiDefault: true, koreanDictionary: true } }]) {
      const $ = load(renderStart(panel));
      expect($('.capability-grid button')).toHaveLength(10);
      for (const action of capabilityAvailability(panel)) {
        const button = $(`.capability-grid [data-action="${action.command}"]`);
        expect(button.attr('disabled') !== undefined).toBe(!action.available);
        expect(button.find('.capability-label').text()).toBe(action.label);
        if (!action.available) expect(button.find('.capability-reason').text()).toBe(action.reason);
      }
    }
  });

  it('drops the offline claim from the clipboard menu when the model pass is on', () => {
    // The label read "Grammar Check (offline)" unconditionally while kren.grammar.smart
    // defaults to true, so by default it advertised the opposite of what it did.
    expect(extension).toContain("? '$(checklist) Grammar Check (Harper and Smart Grammar Check)'");
    expect(extension).toContain(": '$(checklist) Grammar Check (offline)'");
    expect(extension).not.toContain("{ label: '$(checklist) Grammar Check (offline)', operation");
  });

  it('uses one icon for both rewrite variants, because they are one action at two strengths', () => {
    const icons = [...variants.matchAll(/quickPickIcon: '([^']+)'/gu)].map((match) => match[1]);
    expect(icons).toHaveLength(2);
    expect(new Set(icons).size, `both variants share an icon, got ${icons.join(' and ')}`).toBe(1);
    expect(icons[0]).toBe('$(edit)');
  });
});

describe('the Rewrite Text output language controls', () => {
  function settingsHtml(overrides: Partial<typeof settings> = {}): string {
    return renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: { ...settings, ...overrides },
      activeScreen: 'settings',
      proModels
    });
  }

  it('offers Other languages and the fifteen languages behind it', () => {
    const html = settingsHtml();

    expect(html).toContain('data-setting="rewrite.otherOutputLanguage"');
    for (const language of REWRITE_OTHER_LANGUAGES) {
      expect(html, `${language.label} is missing`)
        .toContain(`value="${language.id}"`);
      expect(html, `${language.label} is missing`).toContain(language.label);
    }
  });

  it('disables the second control rather than hiding it', () => {
    // The owner asked for it to deactivate, not disappear. A control that vanishes leaves
    // the reader wondering where the languages went; one that is visibly inert says what to
    // change to reach them.
    const html = settingsHtml();

    expect(html).toContain('data-enabled-for="rewrite.englishVariety"');
    expect(html).toContain('data-enabled-value="otherLanguage"');
    // 2026-10-04: Controls remain disabled without fading text below 4.5:1.
    // 2026-10-04: V203 restores the owner's inactive-setting fade.
    expect(html).toContain('.setting-inactive { opacity: .5; }');
    expect(html).toContain("group.classList.toggle('setting-inactive', !active)");
    expect(html).toContain('control.disabled = !active;');
  });

  it('names the chosen language in the group summary, not the word Other', () => {
    // "Output language: Other languages" tells the reader nothing they did not already know
    // from opening the group.
    const chosen = settingsHtml({
      rewriteEnglishVariety: 'otherLanguage',
      rewriteOtherOutputLanguage: 'pt-BR'
    });
    expect(chosen).toContain('Output language: Portuguese (Brazilian)');

    const english = settingsHtml({ rewriteEnglishVariety: 'british' });
    expect(english).toContain('Output language: British English');
  });
});

describe('the panel header row', () => {
  it('lets the controls wrap only when they do not fit, rather than at a fixed width', () => {
    // The secondary sidebar sits below 520px all the time, and the old rule turned the
    // header into a column there, so three icon buttons dropped to their own line with most
    // of the row still empty.
    const html = renderIconFixture();

    expect(html).toMatch(/\.top \{[^}]*flex-wrap: wrap/u);
    expect(html).toMatch(/\.top-actions \{[^}]*flex-shrink: 0/u);
    const narrow = html.split('@media (max-width: 520px)')[1] ?? '';
    expect(narrow.split(String.fromCharCode(10))[0])
      .not.toContain('flex-direction: column');
  });
});

describe('the Edge Online Read Aloud controls', () => {
  function speechHtml(overrides: Partial<typeof settings> = {}): string {
    return renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: { ...settings, readAloudProvider: 'edgeOnline', ...overrides },
      activeScreen: 'settings',
      proModels
    });
  }

  it('offers every catalog locale, and Auto-detect first', () => {
    const html = speechHtml();

    expect(html).toContain(`value="${EDGE_SPEECH_AUTO_LOCALE}"`);
    for (const locale of EDGE_SPEECH_LOCALES) {
      expect(html, `${locale.label} is missing from Language/Region`)
        .toContain(`value="${locale.id}"`);
      expect(html, `${locale.label} is missing from Language/Region`).toContain(locale.label);
    }
  });

  it('lists only that locale voices once a language is chosen', () => {
    const korean = speechHtml({ edgeReadAloudLocale: 'ko-KR' });

    expect(korean).toContain('ko-KR-SunHiNeural');
    expect(korean).toContain('SunHi (Female)');
    // An English voice must not be offered under Korean, or the two menus disagree and the
    // runtime is handed a voice for a language the reader did not select.
    expect(korean).not.toContain('en-US-AvaNeural');
    expect(korean).toContain('Voices Microsoft offers for Korean.');
  });

  it('disables the voice control under Auto-detect rather than hiding it', () => {
    // Matching the Rewrite Text output language pair. A control that vanishes leaves the
    // reader wondering where the voices went; an inert one says a choice will be made.
    const auto = speechHtml({ edgeReadAloudLocale: 'auto' });

    // The markup again, not the class name: the stylesheet defines .setting-inactive on
    // every render, so a bare substring check passes whether the label carries it or not.
    expect(auto).toContain('<label class="setting setting-inactive">');
    expect(auto).toContain('Chosen automatically');
    // The markup, not the bare attribute: the webview script carries the same string in its
    // event handler on every render, so a substring check passes whether the select exists
    // or not.
    expect(auto).not.toContain('<select data-edge-voice-preset>');
  });

  it('keeps the editable voice identifier as the escape hatch', () => {
    // Quebec French and Mexican Spanish have no entry in the twenty, and Microsoft adds
    // voices between catalog regenerations. Typing an identifier must still work.
    const html = speechHtml({ edgeReadAloudLocale: 'fr-FR' });
    expect(html).toContain('data-setting="readAloud.edgeVoice"');
    expect(html).toContain('Editable Edge TTS voice ID');
  });

  it('shows a voice the catalog does not carry rather than dropping it silently', () => {
    const custom = speechHtml({
      edgeReadAloudLocale: 'fr-FR',
      edgeReadAloudVoice: 'fr-CA-SylvieNeural'
    });
    expect(custom).toContain('Custom voice ID');
    expect(custom).toContain('fr-CA-SylvieNeural');
  });
});
