import { beforeEach, describe, expect, it, vi } from 'vitest';

const { showErrorMessage } = vi.hoisted(() => ({
  showErrorMessage: vi.fn(async () => undefined)
}));

vi.mock('vscode', () => ({
  commands: { executeCommand: vi.fn(async () => undefined) },
  env: { remoteName: undefined },
  Uri: {
    joinPath: (base: { path?: string }, ...parts: string[]) => ({
      path: [base.path ?? '', ...parts].join('/'),
      toString() { return this.path; }
    })
  },
  window: { showErrorMessage }
}));

import { KrenResultsViewProvider } from '../src/resultsView.js';

type MessageListener = (message: unknown) => void;

function createHarness(overrides: Record<string, unknown> = {}) {
  let receiveMessage: MessageListener | undefined;
  const actions = {
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
    updateSetting: vi.fn(async () => undefined),
    runCommand: vi.fn(async () => undefined),
    log: vi.fn(),
    settings: vi.fn(() => ({
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
      rewriteDomain: 'general',
      rewriteTone: 'preserveVoice',
      rewriteRhetoricalMode: 'preserveOriginal',
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
    showErrorMessage.mockClear();
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
      tone: 'neutral',
      rhetoricalMode: 'preserveOriginal',
      variants: [{ id: 'natural', label: 'Natural', text: 'Spoken text.' }]
    }, 'Source text.', false);

    harness.dispatch({ command: 'readVariant', variantId: 'natural' });
    await settleMessages();

    expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining(failure.message));
    expect(harness.actions.log).toHaveBeenCalledWith(
      expect.stringContaining('[panel read aloud failed]')
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
});
