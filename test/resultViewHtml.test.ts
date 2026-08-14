import { describe, expect, it } from 'vitest';
import { MERRIAM_WEBSTER_KEY_LIMIT, MERRIAM_WEBSTER_KEY_LIMIT_MESSAGE } from '../src/operations.js';
import { REWRITE_RHETORICAL_MODES } from '../src/rewriteAxes.js';

// The settings groups in the order the owner asked for on 2026-08-13. Order is a
// requirement here, not an accident of where each block was appended, and it is the kind
// of thing a later edit reshuffles without anyone noticing.
const SETTINGS_GROUP_ORDER = [
  'Startup and panel',
  'Translation',
  'Grammar Check',
  'Explain Meaning or Nuance',
  'Rewrite Text',
  'Read Aloud (Windows)',
  'Dictionary',
  'User Dictionary',
  'Credentials and usage'
];
import {
  krenCreditLine,
  REWRITE_SETTINGS_GROUPS,
  renderKrenResultViewHtml
} from '../src/resultViewHtml.js';
import type { DictionaryResult, GrammarResult, RewriteResult, TranslationResult } from '../src/types.js';
import type { KrenPanelSettings } from '../src/resultViewHtml.js';
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
  userDictionaryThinkingOrEffort: 'low',
  userDictionaryEntryLanguage: 'auto',
  userDictionaryIncludePronunciation: true,
  userDictionaryIncludeSynonyms: true,
  userDictionaryIncludeUsageNotes: true,
  userDictionaryNumberOfExamples: 2,
  userDictionaryIncludeTechnicalMeanings: true,
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

const brandImageUri = 'vscode-webview://test/media/kren-panel-logo.png';
const googleAttributionImageUri = 'vscode-webview://test/media/google-translate-attribution.png';

const proModels = [
  { id: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro Preview' },
  { id: 'gemini-3.5-flash', displayName: 'Gemini 3.5 Flash' }
];

describe('KREN rich result view', () => {
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
        { id: 'natural', label: 'Natural', text: 'Work together more effectively.' }
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
    expect(html).toContain('leaves the original <code>entries.json</code>');
    expect(html).toContain('JSON is lossless');
    expect(html).toContain('Markdown is human-readable and lossy by design');
    expect(html).toContain('data-command="previewUserDictionaryImport"');
    expect(html).toContain('data-command="previewUserDictionaryPurge"');
  });

  it('visibly separates attributed live reference content from the personal draft', () => {
    const draft = userDictionaryEntry({
      capture: {
        ...userDictionaryEntry().capture,
        mode: 'merriamWebsterAndLlm'
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
    expect(html).toContain('<img class="provider-logo"');
    expect(html).toContain('.provider-logo { width: 50px; height: 50px;');
    expect(html).toContain('Live content is not stored with the personal entry.');
    expect(html).toContain('Save personal entry');
  });

  it('labels a genuine no-match fallback visibly', () => {
    const draft = userDictionaryEntry({
      capture: {
        ...userDictionaryEntry().capture,
        mode: 'merriamWebsterAndLlm'
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
    expect(medicalHtml).toContain('Merriam-Webster Medical <span class="credential-status">Stored</span>');
    expect(medicalHtml).toContain('data-action="kren.setMerriamWebsterMedicalApiKey" disabled>Set key</button>');
    expect(medicalHtml).toContain('data-action="kren.deleteMerriamWebsterMedicalApiKey">Remove key</button>');

    // Fills exactly MERRIAM_WEBSTER_KEY_LIMIT slots rather than a hard-coded two, and
    // checks both sides of the boundary. The panel previously printed "stores at most 3"
    // while disabling the third Set key button, because the message came from the
    // constant and the disabled state from a literal `>= 2`. One rule, two copies.
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
      expect(limitHtml).toContain(`data-action="${action}" disabled>Set key</button>`);
    } else {
      // Private development behaviour, limit 3 of 3. Every reference work is configured,
      // so no row is unset and the warning is unreachable by construction. That is
      // correct, not a missing message: the limit and the number of reference works
      // coincide, so there is nothing left to refuse.
      expect(limitHtml).not.toContain(MERRIAM_WEBSTER_KEY_LIMIT_MESSAGE);
      // All three configured, so all three read Stored. Not asserted by the absence of a
      // disabled Set key button: a stored row disables its own Set key, correctly, so
      // that string appears for every configured credential in the panel.
      for (const name of presenceOrder) {
        const label = name === 'merriamWebsterCollegiate' ? 'Merriam-Webster Collegiate'
          : name === 'merriamWebsterThesaurus' ? 'Merriam-Webster Thesaurus'
            : 'Merriam-Webster Medical';
        expect(limitHtml).toContain(`${label} <span class="credential-status">Stored</span>`);
      }
    }

    const startHtml = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings,
      activeScreen: 'start',
      proModels
    });
    expect(startHtml).toContain('<span class="capability unavailable">English Dictionary');
    expect(startHtml).toContain('<span class="capability unavailable">Synonyms');
    expect(startHtml).toContain('<span class="capability unavailable">Medical Dictionary');
    expect(startHtml).toContain('Unavailable because no API key is configured.');
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
    for (const providerId of [
      'merriamWebsterCollegiate',
      'merriamWebsterMedical',
      'merriamWebsterThesaurus'
    ]) {
      const referenceHtml = renderKrenResultViewHtml({
        cspSource: 'vscode-webview://test',
        nonce: 'test-nonce',
        result: { ...result, providerId },
        sourceText: result.sourceText,
        allowReplace: false,
        settings,
        proModels
      });
      expect(referenceHtml).toContain('<img class="provider-logo"');
      expect(referenceHtml).toContain('.provider-logo { width: 50px; height: 50px;');
    }
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
    expect(html).toContain('data-setting="results.openAtStartup"');
    expect(html).toContain('data-setting="gemini.retry.enabled"');
    expect(html).toContain('data-setting="gemini.alternateFallbackModel"');
    expect(html).toContain('data-setting="gemini.alternateFallbackThinkingLevel"');
    expect(html).toContain('data-setting="explanation.geminiProfile"');
    expect(html).toContain('data-setting="rewrite.quickMenuVariant"');
    expect(html).toContain('data-setting="rewrite.sourceLanguage"');
    expect(html).toContain('data-setting="rewrite.englishVariety"');
    expect(html).toContain('English dialect or variety');
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
    expect(html).toContain('data-setting="readAloud.edgeVoice"');
    expect(html).toContain('en-US-ChristopherNeural');
    expect(html).toContain('Microsoft Edge Online (experimental)');
    expect(html).toContain('only KREN\'s cleaned speech copy is sent');
    expect(html).toContain('Microsoft Zira Desktop');
    expect(html).toContain('data-action="kren.previewReadAloud"');
    expect(html).toContain('data-setting="pronunciation.windowsNativePlayback"');
    expect(html).toContain('Result <span class="result-meta">| Language: <strong>English</strong> | English: <strong>British</strong> | Modality: <strong>Written</strong> | Function: <strong>General</strong> | Domain: <strong>Technical</strong> | Formality: <strong>Preserve</strong> | Voice: <strong>Preserve</strong> | Stance: <strong>Preserve</strong> | Length: <strong>Preserve</strong> | Perspective: <strong>Preserve</strong> | Intent: <strong>Recommend</strong> |</span>');
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
    expect(html).toContain('<div class="provider"><span>gemini-3.5-flash</span></div>');
    expect(html).not.toContain('Model: <strong>gemini-3.5-flash</strong>');
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
    expect(html).toContain(krenCreditLine('1.0.0'));
    expect(html).toContain('<h3>Requirements</h3>');
    expect(html).toContain('VS Code Desktop 1.106 or later');
    expect(html).toContain('Delete all stored API keys');
    expect(html).toContain('data-action="kren.deleteGeminiApiKey"');
    expect(html).toContain('no API key, account, Python, Node.js, GPU, or network connection is required');
    expect(html).toContain('Merriam-Webster issues two API keys per account, so KREN refuses a third');
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
    expect(html.indexOf('Synonyms')).toBeLessThan(html.indexOf('Medical Dictionary'));
    expect(html.indexOf('Medical Dictionary')).toBeLessThan(html.indexOf('Korean Dictionary'));
    expect(html).toContain(krenCreditLine('1.0.0'));
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

  it('renders every rewrite group summary and identifies groups at defaults', () => {
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
      expect(summary, `${group} summary`).toContain('Defaults');
    }
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
    expect(subjectSummary).not.toContain('General');
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
