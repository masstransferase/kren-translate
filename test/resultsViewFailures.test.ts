import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  executeCommand, showErrorMessage, showInformationMessage, showWarningMessage, writeText
} = vi.hoisted(() => ({
  executeCommand: vi.fn(async (..._args: unknown[]) => undefined),
  showErrorMessage: vi.fn(async (_message: string) => undefined),
  showInformationMessage: vi.fn(async (_message: string) => undefined),
  showWarningMessage: vi.fn(async (_message: string) => undefined),
  writeText: vi.fn(async (_text: string) => undefined)
}));

vi.mock('vscode', () => ({
  commands: { executeCommand },
  env: { clipboard: { writeText }, remoteName: undefined },
  Uri: {
    joinPath: (base: { path?: string }, ...parts: string[]) => ({
      path: [base.path ?? '', ...parts].join('/'),
      toString() { return this.path; }
    })
  },
  window: { showErrorMessage, showInformationMessage, showWarningMessage }
}));

import { copyTextResult, notify } from '../src/extension.js';
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { REWRITE_MODES, rewriteModeSettingEntries } from '../src/rewriteModes.js';
import { userDictionaryEntry } from './userDictionaryFixtures.js';

type MessageListener = (message: unknown) => void;

function createHarness(overrides: Record<string, unknown> = {}) {
  let receiveMessage: MessageListener | undefined;
  const actions = {
    notify: vi.fn((kind: 'information' | 'warning' | 'error', message: string) => {
      if (kind === 'information') void showInformationMessage(message);
      if (kind === 'warning') void showWarningMessage(message);
      if (kind === 'error') void showErrorMessage(message);
    }),
    copy: vi.fn(async () => undefined),
    details: vi.fn(),
    replace: vi.fn(async () => undefined),
    copyText: vi.fn(async () => undefined),
    replaceText: vi.fn(async () => undefined),
    applyGrammarChoices: vi.fn(async () => undefined),
    manageGrammarIssue: vi.fn(async () => undefined),
    readAloudText: vi.fn(async () => undefined),
    stopReadAloud: vi.fn(),
    clear: vi.fn(),
    loadUserDictionary: vi.fn(async () => []),
    saveUserDictionaryEntry: vi.fn(),
    deleteUserDictionaryEntry: vi.fn(async () => []),
    deleteUserDictionaryEntries: vi.fn(async () => []),
    previewUserDictionaryPurge: vi.fn(),
    confirmUserDictionaryPurge: vi.fn(),
    previewUserDictionaryImport: vi.fn(),
    applyUserDictionaryImport: vi.fn(async () => []),
    exportUserDictionary: vi.fn(async () => undefined),
    regenerateUserDictionaryEntry: vi.fn(),
    updateSetting: vi.fn(async () => undefined),
    runCommand: vi.fn(async () => undefined),
    log: vi.fn(),
    settings: vi.fn(() => ({
      userDictionaryEnabled: true,
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
      rewriteDomain: 'general',
      rewriteFormality: 'preserve',
      rewriteVoice: 'preserve',
      rewriteStance: 'preserve',
      rewriteLength: 'preserve',
      rewritePerspective: 'preserve',
      rewriteRhetoricalMode: 'preserve',
      preserveFormatting: true,
      includeChangeNotes: false,
      multiWordTranslationFallback: true,
      windowsNativePronunciation: true,
      geminiRetryEnabled: true,
      geminiRetryMaxAttempts: 4,
      languageModelRetryEnabled: true,
      languageModelRetryMaxAttempts: 3,
      ttsEnabled: true,
      readAloudVoice: '',
      readAloudRate: 0,
      readAloudVolume: 100,
      readAloudVoices: [],
      readAloudProvider: 'windowsLocal',
      edgeReadAloudVoice: 'en-US-ChristopherNeural',
      edgeReadAloudRatePercent: 0,
      edgeReadAloudPythonCommand: 'python',
      credentialPresence: {},
      extensionVersion: '1.0.4'
    })),
    refreshProModels: vi.fn(async () => []),
    refreshOpenAIModels: vi.fn(async () => []),
    refreshAnthropicModels: vi.fn(async () => []),
    refreshReadAloudVoices: vi.fn(async () => undefined),
    ...overrides
  };
  const webview = {
    options: {},
    cspSource: 'vscode-webview://test',
    html: '',
    asWebviewUri: (uri: unknown) => uri,
    postMessage: vi.fn(async () => true),
    onDidReceiveMessage: vi.fn((listener: MessageListener) => {
      receiveMessage = listener;
      return { dispose: vi.fn() };
    })
  };
  const view = {
    webview,
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() }))
  };
  const provider = new KrenResultsViewProvider(actions as never, { path: '/extension' } as never);
  provider.resolveWebviewView(view as never);
  return {
    actions,
    provider,
    webview,
    dispatch(message: unknown) {
      if (!receiveMessage) throw new Error('The real webview message handler was not registered.');
      receiveMessage(message);
    }
  };
}

async function settleMessages(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('results webview failure reporting', () => {
  beforeEach(() => {
    showErrorMessage.mockReset().mockResolvedValue(undefined);
    showInformationMessage.mockReset().mockResolvedValue(undefined);
    showWarningMessage.mockReset().mockResolvedValue(undefined);
    writeText.mockReset().mockResolvedValue(undefined);
  });

  // The copy path no longer notifies at all: the panel button confirms itself. The
  // property this test exists for is unchanged and still load-bearing for the other 59
  // call sites, so it is exercised through a handler that does notify. A stub that
  // resolves immediately could never reproduce the freeze, which is why it needs one
  // that never resolves.
  it('handles the next queued message while a notification raised by a handler stays open', async () => {
    showInformationMessage.mockReturnValueOnce(new Promise(() => undefined));
    const harness = createHarness({
      copyText: async (text: string) => {
        await copyTextResult(text);
        notify('information', 'A notice the user never dismisses.');
      }
    });
    harness.provider.setResult({
      kind: 'rewrite',
      providerId: 'gemini',
      sourceText: 'Source text.',
      sourceLanguage: 'en',
      targetLanguage: 'en',
      createdAt: '1970-01-01T00:00:00.000Z',
      englishVariety: 'american',
      domain: 'general',
      modality: 'written',
      function: 'general',
      formality: 'neutral',
      voice: 'preserve',
      stance: 'neutral',
      length: 'preserve',
      perspective: 'preserve',
      rhetoricalMode: 'preserve',
      variants: [{ id: 'natural', label: 'Natural', text: 'Copied result.' }]
    }, 'Source text.', false);

    harness.dispatch({ command: 'copyVariant', variantId: 'natural' });
    harness.dispatch({ command: 'details' });

    await vi.waitFor(() => expect(harness.actions.details).toHaveBeenCalledOnce());
    expect(writeText).toHaveBeenCalledWith('Copied result.');
    expect(showInformationMessage).toHaveBeenCalledWith('A notice the user never dismisses.');
  });

  it('keeps an operation successful when its notification rejects', async () => {
    showInformationMessage.mockRejectedValueOnce(new Error('Notification host failed.'));

    expect(() => notify('information', 'A notice whose host fails.')).not.toThrow();
    await expect(copyTextResult('Copied anyway.')).resolves.toBeUndefined();
    expect(writeText).toHaveBeenCalledWith('Copied anyway.');
  });

  // The copy confirmation moved onto the button itself, so copying must raise nothing.
  // Asserted rather than assumed, because the notification that used to be here is what
  // froze the panel, and a future change that quietly restores it would restore that too.
  it('raises no notification when copying, because the button confirms itself', async () => {
    await copyTextResult('Silently copied.');

    expect(writeText).toHaveBeenCalledWith('Silently copied.');
    expect(showInformationMessage).not.toHaveBeenCalled();
    expect(showWarningMessage).not.toHaveBeenCalled();
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  // Redaction has to be judged in both directions. A leaked key is the obvious
  // failure; a message flattened to "[redacted]" is the quieter one, and it defeats
  // the whole reason this reporting exists. The catch-all therefore requires a digit
  // and a letter together, so an ordinary long word survives and an opaque token
  // does not.
  it('redacts opaque tokens without redacting ordinary long words', async () => {
    // Assembled from parts on purpose. A literal key shape here is caught by
    // scan-secrets, correctly: this file is copied into the public tree, and the
    // scanner cannot tell a test fixture from a real credential. Nor should it try.
    const fakeGoogleKey = ['AIza', 'SyC1234567890abcdefghijklmnopqrstuvw'].join('');
    const fakeBearerToken = ['abcdefghijklmnop', 'qrstuvwxyz012345'].join('');

    const cases: Array<{ thrown: string; redacted: string[]; kept: string[] }> = [
      {
        thrown: `Request failed with key ${fakeGoogleKey}`,
        redacted: [fakeGoogleKey],
        kept: ['Request failed']
      },
      {
        thrown: 'No entry for internationalization or contradistinction',
        redacted: [],
        kept: ['internationalization', 'contradistinction']
      },
      {
        // Assembled for the same reason as the key above. A literal bearer token in a
        // file that is copied into the public tree reads as a credential to anyone
        // scanning the repository, whether or not it ever was one.
        thrown: `Authorization: Bearer ${fakeBearerToken} rejected`,
        redacted: [fakeBearerToken],
        kept: ['Bearer', 'rejected']
      }
    ];

    for (const { thrown, redacted, kept } of cases) {
      showErrorMessage.mockClear();
      const harness = createHarness({
        runCommand: vi.fn(async () => { throw new Error(thrown); })
      });
      harness.dispatch({ command: 'runCommand', action: 'kren.deleteAllApiKeys' });
      await settleMessages();

      const lastCall = showErrorMessage.mock.calls.at(-1) as unknown[] | undefined;
      const shown = String(lastCall?.[0] ?? '');
      for (const secret of redacted) {
        expect(shown, `leaked: ${secret}`).not.toContain(secret);
      }
      for (const word of kept) {
        expect(shown, `over-redacted: ${word}`).toContain(word);
      }
    }
  });

  it('reports a rendered command that is unavailable in this build', async () => {
    const harness = createHarness();

    harness.dispatch({ command: 'runCommand', action: 'kren.commandMissingFromBuild' });
    await settleMessages();

    expect(showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('kren.commandMissingFromBuild')
    );
    expect(showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('not available in this build')
    );
    expect(harness.actions.log).toHaveBeenCalledWith(
      expect.stringContaining('[panel command unavailable]')
    );
  });

  it('reports the original error from a command that ran', async () => {
    const failure = new Error('OpenAI connection failed before a response arrived.');
    const harness = createHarness({ runCommand: vi.fn(async () => { throw failure; }) });

    harness.dispatch({ command: 'runCommand', action: 'kren.testOpenAIConnection' });
    await settleMessages();

    expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining(failure.message));
    expect(harness.actions.log).toHaveBeenCalledWith(
      expect.stringContaining('[panel command failed]')
    );
  });

  it('reports a Read Aloud failure with its original message', async () => {
    const failure = new Error('The selected speech voice could not start.');
    const harness = createHarness({ readAloudText: vi.fn(async () => { throw failure; }) });
    harness.provider.setResult({
      kind: 'rewrite',
      providerId: 'gemini',
      sourceText: 'Source text.',
      sourceLanguage: 'en',
      targetLanguage: 'en',
      createdAt: '1970-01-01T00:00:00.000Z',
      englishVariety: 'american',
      domain: 'general',
      modality: 'written',
      function: 'general',
      formality: 'neutral',
      voice: 'preserve',
      stance: 'neutral',
      length: 'preserve',
      perspective: 'preserve',
      rhetoricalMode: 'preserve',
      variants: [{ id: 'natural', label: 'Natural', text: 'Spoken text.' }]
    }, 'Source text.', false);

    harness.dispatch({ command: 'readVariant', variantId: 'natural' });
    await settleMessages();

    expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining(failure.message));
    expect(harness.actions.log).toHaveBeenCalledWith(
      expect.stringContaining('[panel read aloud failed]')
    );
  });

  it('marks Read Aloud modality as inferred and lets the user pin it', async () => {
    const harness = createHarness();
    harness.provider.setResult({
      kind: 'rewrite',
      providerId: 'gemini',
      sourceText: 'Source text.',
      sourceLanguage: 'en',
      targetLanguage: 'en',
      createdAt: '1970-01-01T00:00:00.000Z',
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
      variants: [{ id: 'natural', label: 'Natural', text: 'Spoken text.' }]
    }, 'Source text.', false);

    harness.dispatch({ command: 'readVariant', variantId: 'natural' });
    await settleMessages();
    expect(harness.webview.html).toContain('Modality (inferred)');
    expect(harness.webview.html).toContain('data-command="pinInferredModality"');
    expect(harness.webview.html).toContain(
      'data-setting="rewrite.preserveFormatting" checked disabled'
    );
    expect(harness.actions.readAloudText).toHaveBeenCalledWith('Spoken text.');

    harness.dispatch({ command: 'pinInferredModality' });
    await settleMessages();
    expect(harness.actions.updateSetting).toHaveBeenCalledWith('rewrite.modality', 'spoken');
    expect(harness.webview.html).not.toContain('Modality (inferred)');
  });

  it.each(REWRITE_MODES)('applies every $label axis through the existing setting path', async (mode) => {
    const harness = createHarness();

    harness.dispatch({ command: 'applyRewriteMode', modeId: mode.id });
    await vi.waitFor(() => expect(harness.actions.updateSetting).toHaveBeenCalledTimes(8));

    expect(harness.actions.updateSetting.mock.calls).toEqual(
      rewriteModeSettingEntries(mode.id).map(({ key, value }) => [key, value])
    );
  });

  it('does not notify for any background settings refresh failure', async () => {
    const backgroundFailure = () => Promise.reject(new Error('Background refresh failed.'));
    const harness = createHarness({
      refreshProModels: vi.fn(backgroundFailure),
      refreshOpenAIModels: vi.fn(backgroundFailure),
      refreshAnthropicModels: vi.fn(backgroundFailure),
      refreshReadAloudVoices: vi.fn(backgroundFailure)
    });

    harness.dispatch({ command: 'showSettings' });
    harness.dispatch({ command: 'refreshProModels' });
    harness.dispatch({ command: 'refreshOpenAIModels' });
    harness.dispatch({ command: 'refreshAnthropicModels' });
    await vi.waitFor(() => expect(harness.actions.log).toHaveBeenCalledTimes(4));

    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  it('opens User Dictionary without clearing the most recent ordinary result', async () => {
    const harness = createHarness();
    harness.provider.setResult({
      kind: 'translation',
      providerId: 'gemini',
      sourceText: 'ordinary source',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      createdAt: '1970-01-01T00:00:00.000Z',
      translatedText: 'ordinary result'
    }, 'ordinary source', false);

    await harness.provider.showUserDictionary();
    expect(harness.webview.html).toContain('User Dictionary');

    harness.dispatch({ command: 'showResult' });
    await settleMessages();
    expect(harness.webview.html).toContain('ordinary source');
    expect(harness.webview.html).toContain('ordinary result');
  });

  it('renders a storage failure as an error and never as an empty dictionary', async () => {
    const harness = createHarness({
      loadUserDictionary: vi.fn(async () => {
        throw new Error('The local store could not be read.');
      })
    });

    await expect(harness.provider.showUserDictionary()).rejects.toThrow(
      'The local store could not be read.'
    );
    expect(harness.webview.html).toContain('User Dictionary storage error');
    expect(harness.webview.html).not.toContain('Your User Dictionary is empty.');
  });

  it('uses multi-select only for deletion and export', async () => {
    const first = userDictionaryEntry({ id: 'first' });
    const second = userDictionaryEntry({
      id: 'second',
      term: 'second',
      normalizedTerm: 'second'
    });
    const deleteUserDictionaryEntries = vi.fn(async () => [second]);
    const exportUserDictionary = vi.fn(async () => undefined);
    const regenerateUserDictionaryEntry = vi.fn();
    const harness = createHarness({
      loadUserDictionary: vi.fn(async () => [first, second]),
      deleteUserDictionaryEntries,
      exportUserDictionary,
      regenerateUserDictionaryEntry
    });
    await harness.provider.showUserDictionary();

    harness.dispatch({ command: 'selectUserDictionaryEntries', entryIds: ['first'] });
    await settleMessages();
    harness.dispatch({ command: 'exportUserDictionary', format: 'json', selectedOnly: true });
    await settleMessages();
    expect(exportUserDictionary).toHaveBeenCalledWith('json', ['first']);

    harness.dispatch({ command: 'deleteSelectedUserDictionaryEntries' });
    await settleMessages();
    expect(deleteUserDictionaryEntries).toHaveBeenCalledWith(['first']);
    expect(regenerateUserDictionaryEntry).not.toHaveBeenCalled();
  });

  it('previews imports before passing an explicit duplicate decision to storage', async () => {
    const entry = userDictionaryEntry();
    const preview = {
      currentEntryCount: 1,
      entryCount: 1,
      validEntryCount: 1,
      duplicateCount: 1,
      invalidRecordCount: 0,
      proposedAddCount: 0,
      storeDuplicateCount: 1,
      duplicates: [{
        recordIndex: 0,
        entryId: 'incoming',
        duplicateEntryId: entry.id,
        source: 'store' as const
      }],
      invalidRecords: [],
      entries: [entry]
    };
    const applyUserDictionaryImport = vi.fn(async () => [entry]);
    const harness = createHarness({
      loadUserDictionary: vi.fn(async () => [entry]),
      previewUserDictionaryImport: vi.fn(async () => preview),
      applyUserDictionaryImport
    });

    harness.dispatch({ command: 'previewUserDictionaryImport' });
    await settleMessages();
    expect(harness.webview.html).toContain('Import preview');
    expect(applyUserDictionaryImport).not.toHaveBeenCalled();

    const decision = { mode: 'merge' as const, duplicateStrategy: 'keepExisting' as const };
    harness.dispatch({ command: 'applyUserDictionaryImport', importDecision: decision });
    await settleMessages();
    expect(applyUserDictionaryImport).toHaveBeenCalledWith(preview, decision);
  });

  it('cancels an editable draft without calling storage', async () => {
    const harness = createHarness();
    await harness.provider.showUserDictionaryDraft(userDictionaryEntry({
      id: 'unsaved-draft',
      merriamWebsterReference: undefined
    }));
    expect(harness.webview.html).toContain('Nothing is stored until Save');

    harness.dispatch({ command: 'cancelUserDictionaryDraft' });
    await settleMessages();

    expect(harness.actions.saveUserDictionaryEntry).not.toHaveBeenCalled();
    expect(harness.webview.html).not.toContain('Nothing is stored until Save');
  });

  it('offers Open existing and Update existing after an explicit duplicate save', async () => {
    const existing = userDictionaryEntry({ id: 'existing-entry' });
    const draft = userDictionaryEntry({ id: 'duplicate-draft', merriamWebsterReference: undefined });
    const saveUserDictionaryEntry = vi.fn(async () => ({
      kind: 'duplicate' as const,
      existing,
      entries: [existing]
    }));
    const harness = createHarness({ saveUserDictionaryEntry });
    await harness.provider.showUserDictionaryDraft(draft);

    harness.dispatch({ command: 'saveUserDictionaryDraft', entry: editableDraft(draft) });
    await settleMessages();

    expect(saveUserDictionaryEntry).toHaveBeenCalledTimes(1);
    expect(harness.webview.html).toContain('Open existing');
    expect(harness.webview.html).toContain('Update existing');
    expect(harness.webview.html).toContain('This expression is already in your User Dictionary');
  });
});

function editableDraft(entry: ReturnType<typeof userDictionaryEntry>) {
  return {
    term: entry.term,
    language: entry.language,
    entryType: entry.entryType,
    collection: entry.collection,
    domains: entry.domains,
    tags: entry.tags,
    pronunciation: entry.pronunciation?.display ?? '',
    senses: entry.senses.map((sense) => ({
      partOfSpeech: sense.partOfSpeech ?? '',
      definition: sense.definition,
      usageNote: sense.usageNote ?? '',
      synonyms: sense.synonyms,
      antonyms: sense.antonyms,
      relatedTerms: sense.relatedTerms,
      examples: sense.examples
    })),
    aliases: entry.aliases
  };
}

// The hide command used to run workbench.action.closeAuxiliaryBar, which closes the whole
// Secondary Sidebar. Chat, Claude Code, and Codex live there too, so hiding KREN took all
// of them down, and reopening the panel from one of those brought KREN back because it had
// never been hidden. Reported by the owner on 2026-08-14.
//
// Asserted in both directions: the context is cleared, and the workbench command is not
// called. Only the first half would still pass if someone added the close back alongside
// it, which is exactly the shape of an accidental restoration.
describe('hiding KREN', () => {
  it('clears its own context and leaves the Secondary Sidebar alone', async () => {
    executeCommand.mockClear();
    const harness = createHarness();

    await harness.provider.hide();

    expect(executeCommand).toHaveBeenCalledWith('setContext', 'kren.resultsEnabled', false);
    const commandNames = executeCommand.mock.calls.map((call) => call[0]);
    expect(commandNames).not.toContain('workbench.action.closeAuxiliaryBar');
  });

  it('reveals by setting the same context true, so the two are symmetric', async () => {
    executeCommand.mockClear();
    const harness = createHarness();

    await harness.provider.reveal();

    expect(executeCommand).toHaveBeenCalledWith('setContext', 'kren.resultsEnabled', true);
  });
});
