// Changed 2026-10-22 (V293, owner I61/D22 A): one missing-key message with Open Credentials.
import { readFileSync } from 'node:fs';
import { PanelNoticeQueue, showNativePanelNotice } from '../src/panelNotices.js';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { validatedPanelSetting } from '../src/panelSettings.js';
import { krenResetPlan } from '../src/resetKren.js';
import { FileCloudTranslationUsage } from '../src/fileCloudTranslationUsage.js';
import { routedModel } from '../src/providers/openAICompatible.js';
import { ProviderError } from '../src/errors.js';
import { runAdaptiveThinking, modeEffort } from '../src/tutor/thinkingMode.js';
import { missingCredentialsOf, showMissingCredentialNotice, runFeatureRequest, providerCredentialAction, requestFailure, recordedRequestOutcome, centeredProviderError, CURRENT_REQUEST_POLICIES, presentRequestFailure } from '../src/requestCenter.js';
import { withProviderSwitch } from '../src/languageModelSwitching.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Execute the actual host functions with VS Code and transport boundaries replaced. */
function host(names: string[], overrides: Record<string, unknown> = {}) {
  const source = ts.createSourceFile('extension.ts', readFileSync('src/extension.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  // Changed 2026-10-23 (V301, verification R28): execute the shared progress router with clipboard and grammar callers.
  const functions = [...new Set([...names, 'withKrenProgress'])].map((name) => {
    const node = source.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name);
    if (!node && name === 'runGrammarOperation') return ''; // Optional on HEAD, where clipboard skips Smart.
    if (!node) throw new Error(`Missing host function ${name}`);
    return node.getText(source);
  }).join('\n');
  const values: Record<string, unknown> = {};
  const config = { get: (key: string, fallback: unknown) => values[key] ?? fallback,
    inspect: vi.fn((): Record<string, unknown> => ({})), update: vi.fn(async (key: string, value: unknown, _target?: number) => { values[key] = value; }) };
  const document = { uri: { toString: () => 'test-document' }, version: 1, getText: () => 'hello' };
  const selection = { isEmpty: false, start: 0, end: 5 };
  const panel = { setResult: vi.fn(), showResult: vi.fn(async (..._args: unknown[]) => undefined), refresh: vi.fn(), clear: vi.fn() };
  const scope = {
    console, setTimeout, clearTimeout, AbortController, Error, Promise, fetch,
    lastResult: undefined, resultRequestGeneration: 0, resultsView: panel,
    vscode: {
      workspace: { getConfiguration: () => config }, ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
      ProgressLocation: { Window: 1 }, Range: class { constructor(..._args: unknown[]) {} },
      env: { clipboard: { readText: async () => 'hello' } },
      window: { activeTextEditor: { document, selections: [selection] },
        showQuickPick: vi.fn(async () => ({ operation: 'rewrite' })),
        setStatusBarMessage: vi.fn(), withProgress: vi.fn(async (_options, run) => run({}, { onCancellationRequested: () => ({ dispose() {} }) })) },
      commands: { executeCommand: vi.fn() }
    },
    runOperationWithProgress: vi.fn(async () => result('initial')),
    runKrenOperation: vi.fn(async () => result('initial')),
    extensionRuntime: () => ({ getSecret: async () => 'test-key', getSetting: config.get }), explicitTextSubmission: (text: string) => ({ text }),
    notify: vi.fn(), reportAbort: () => false, showLookupError: vi.fn(),
    shouldCopyRewriteToClipboard: () => false, describeClipboardDecision: () => 'decision',
    outputChannel: { appendLine: vi.fn() }, progressTitle: () => 'KREN',
    clipboardPreview: (text: string) => text, ALL_REWRITE_VARIANTS_ID: 'all', REWRITE_VARIANT_LIST: [],
    GRAMMAR_SMART_DEFAULT: true, DEFAULT_GEMINI_MODEL: 'default-model',
    ensureLanguageModelConsent: async () => undefined, languageModelCredentialSlot: () => 'gemini', KREN_SECRET_KEYS: { gemini: 'key' },
    smartGrammarIssues: vi.fn(async () => ({ status: 'completed', model: 'smart', issues: [] })),
    mergeSmartGrammarIssues: (local: unknown[], remote: unknown[]) => [...local, ...remote],
    isProFallbackError: (error: { retryable?: boolean }) => error.retryable,
    displayResult: vi.fn(), readPanelSettings: () => ({ panelTheme: 'light' }),
    grammarCodeActions: { setResult: vi.fn(() => ({ result: { kind: 'grammar', issues: [] } })) },
    // 2026-10-11: Execute the actual model resolver's new provider dependency in this host harness.
    // 2026-10-11: execute V221's actual host routing helpers in the VM harness.
    validatedPanelSetting, routedModel, ProviderError, runAdaptiveThinking, modeEffort, withProviderSwitch,
    missingCredentialsOf, showMissingCredentialNotice, runFeatureRequest, providerCredentialAction, requestFailure, recordedRequestOutcome, centeredProviderError, CURRENT_REQUEST_POLICIES, presentRequestFailure,
    configuredUserDictionaryModel: () => String(values['userDictionary.geminiProfile'] === 'pro' ? values['userDictionary.alternateModel'] : values['userDictionary.model']),
    ...overrides
  };
  // Changed 2026-10-22 (V292, owner I59/D20 A): popup instead of notification.
  const unavailablePanelNotices = new PanelNoticeQueue(() => false, () => undefined,
    (kind, message, options, choices) => showNativePanelNotice(scope.vscode.window as never, kind, message, options, choices));
  const context = vm.createContext({ ...scope, unavailablePanelNotices });
  const routingSource = ts.createSourceFile('operations.ts', readFileSync('src/operations.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const resolver = routingSource.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'featureModel')!.getText(routingSource).replace(/^export /u, '');
  vm.runInContext(ts.transpile(functions + '\n' + resolver, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }), context);
  return { scope: context as any, panel, values, config, document };
}

function result(text: string) { return { kind: 'translation', sourceText: 'hello', translatedText: text }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

describe('R14 finding 2: Gemini fallback consent covers both profiles', () => {
  it.each(['standard', 'pro'] as const)('shows the fallback explanation in the %s consent popup', async profile => {
    const popup = vi.fn(async () => 'I Am 18+ and Confirm');
    const runtime = host(['ensureGeminiConsent'], { GEMINI_CONSENT: 'test-consent', showKrenWarningMessage: popup });
    const context = { globalState: { get: () => false, update: vi.fn(async () => {}) } };
    await runtime.scope.ensureGeminiConsent(context, profile);
    expect(popup).toHaveBeenCalledOnce();
    const [message, options, confirm, terms] = popup.mock.calls[0] as unknown as [string, unknown, string, string];
    expect(message).toMatch(/fallback.*enabled.*same text.*configured fallback model/iu);
    expect(message).not.toMatch(/Paid/iu);
    expect(options).toEqual({ modal: true });
    expect(confirm).toMatch(/confirm/iu);
    expect(terms).toMatch(/Gemini API Terms/u);
    expect(context.globalState.update).toHaveBeenCalledWith('test-consent', true);
  });

  it('describes the configured Gemini fallback model for both profiles', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
    const description = manifest.contributes.configuration.properties['kren.gemini.alternateFallbackModel'].description;
    expect(description).toMatch(/fallback model.*Gemini.*Free Tier.*Paid/iu);
    expect(description).not.toMatch(/Paid.profile|Paid.only|requires Paid/iu);
  });
});

describe('R5a finding 4: latest action owns result publication', () => {
  it('discards A when B completes first in the unchanged editor', async () => {
    const a = deferred<ReturnType<typeof result>>(), b = deferred<ReturnType<typeof result>>();
    const runtime = host(['executeLookup'], { runOperationWithProgress: vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise) });
    const hover = { set: vi.fn() };
    const first = runtime.scope.executeLookup({}, hover, 'translate');
    const second = runtime.scope.executeLookup({}, hover, 'translate');
    b.resolve(result('B')); await second;
    a.resolve(result('A')); await first;
    expect(runtime.scope.lastResult).toMatchObject({ result: { translatedText: 'B' } });
    expect(runtime.panel.setResult).toHaveBeenCalledTimes(1);
  });
  it.each(['Clear', 'Home'])('discards a pending editor result after %s invalidates publication', async () => {
    const pending = deferred<ReturnType<typeof result>>();
    const runtime = host(['executeLookup'], { runOperationWithProgress: () => pending.promise });
    const lookup = runtime.scope.executeLookup({}, { set: vi.fn() }, 'translate');
    runtime.scope.resultRequestGeneration += 1;
    pending.resolve(result('stale')); await lookup;
    expect(runtime.panel.setResult).not.toHaveBeenCalled();
    expect(runtime.scope.lastResult).toBeUndefined();
  });
});

describe('R5a finding 19: Reset KREN clears the active ledger', () => {
  it('clears accumulated file usage after both reset confirmations', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'kren-r5a-reset-'));
    try {
      const usage = new FileCloudTranslationUsage(path.join(directory, 'usage.json'));
      await usage.initialize(); await usage.reserve(123);
      // 2026-10-12: V227 also clears in-memory provider exhaustion during the full reset.
      const resetProviderExhaustion = vi.fn(async () => {});
      // 2026-10-12: Reset uses the shared warning wrapper, including the hidden-panel fallback.
      const runtime = host(['resetKren', 'showKrenWarningMessage'], { cloudTranslationUsage: usage, krenResetPlan,
        restoreDefaultConfiguration: async () => 0, storedSecretKeys: new Set(), configureHarperGrammar: vi.fn(), resetProviderExhaustion });
      Object.assign(runtime.scope.vscode.window, { showWarningMessage: vi.fn().mockResolvedValueOnce('Continue').mockResolvedValueOnce('Reset KREN') });
      await runtime.scope.resetKren({ secrets: { get: async () => undefined, delete: async () => undefined }, globalState: { update: async () => undefined } });
      expect(await usage.get()).toMatchObject({ characters: 0 });
      expect(resetProviderExhaustion).toHaveBeenCalledOnce();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe('R5a finding 18: overriding theme scope', () => {
  it('writes the overriding workspace value so navigation keeps the chosen theme', async () => {
    const runtime = host(['updatePanelSetting']);
    runtime.values['display.panelTheme'] = 'dark';
    runtime.config.inspect.mockReturnValue({ workspaceValue: 'dark' });
    runtime.config.update.mockImplementation(async (key, value, target) => {
      if (target === 2) runtime.values[key] = value;
    });
    await runtime.scope.updatePanelSetting('display.panelTheme', 'light');
    expect(runtime.values['display.panelTheme']).toBe('light');
    expect(runtime.config.update).toHaveBeenCalledWith('display.panelTheme', 'light', 2);
  });
});

describe('R5a finding 14: promised panel destinations', () => {
  it('reveals KREN when Immediate result is Open this panel', async () => {
    const showDetails = vi.fn();
    const runtime = host(['displayResult'], { showDetails });
    runtime.values['display.mode'] = 'details';
    runtime.scope.lastResult = { selectedText: 'hello', result: result('translated') };
    await runtime.scope.displayResult(result('translated'));
    expect(runtime.panel.showResult).toHaveBeenCalledOnce();
    expect(showDetails).not.toHaveBeenCalled();
  });
  it('reveals KREN after an explicit editor Grammar Check', async () => {
    const runtime = host(['checkGrammarRange'], { runGrammarOperation: vi.fn(async () => ({ kind: 'grammar', issues: [] })) });
    const editor = runtime.scope.vscode.window.activeTextEditor;
    await runtime.scope.checkGrammarRange({}, editor, {}, true, true);
    expect(runtime.panel.showResult).toHaveBeenCalledOnce();
  });
});

describe('R5a finding 9: Smart Grammar recovery controls', () => {
  it('passes the bounded retry setting and retries through Alternate fallback on failure', async () => {
    // Changed 2026-10-16: V257, F4 run 3, exercise the center with the transport's typed failure instead of a feature-only mock predicate.
    const calls = vi.fn().mockRejectedValueOnce(new ProviderError('Temporary failure', undefined, true, 504))
      .mockResolvedValueOnce({ status: 'completed', model: 'fallback-choice', issues: [] });
    const runtime = host(['runSmartGrammarPass'], { smartGrammarIssues: calls });
    Object.assign(runtime.values, { 'userDictionary.geminiProfile': 'pro', 'userDictionary.alternateModel': 'primary-choice',
      'userDictionary.fallbackEnabled': true, 'userDictionary.fallbackModel': 'fallback-choice',
      'gemini.retry.enabled': true, 'gemini.retry.maxAttempts': 2, 'llm.providerSwitch': false });
    const outcome = await runtime.scope.runSmartGrammarPass({}, 'hello', [], new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'completed', model: 'fallback-choice' });
    expect(calls.mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({ model: 'primary-choice', maxAttempts: 2, throwProviderErrors: true }),
      expect.objectContaining({ model: 'fallback-choice', maxAttempts: 2, throwProviderErrors: true })
    ]);
  });
  it('uses the switched provider attempt count for Smart Grammar', async () => {
    const calls = vi.fn().mockRejectedValueOnce(new ProviderError('Busy', undefined, true, 503, 'overloaded'))
      .mockResolvedValueOnce({ status: 'completed', model: 'switched', issues: [] });
    const runtime = host(['runSmartGrammarPass'], { smartGrammarIssues: calls });
    Object.assign(runtime.values, { 'userDictionary.model': 'gemini-primary',
      'gemini.retry.maxAttempts': 1, 'languageModel.retry.maxAttempts': 4 });
    expect(await runtime.scope.runSmartGrammarPass({}, 'hello', [], new AbortController().signal)).toMatchObject({ status: 'completed' });
    expect(calls.mock.calls.map(call => call[1])).toEqual([
      expect.objectContaining({ provider: 'gemini', maxAttempts: 1 }),
      expect.objectContaining({ provider: 'groq', maxAttempts: 4 })
    ]);
  });

  it('keeps Smart Grammar fallback after thinking and uses its configured effort', async () => {
    const calls = vi.fn().mockRejectedValueOnce(new ProviderError('Busy', undefined, true, 503, 'overloaded'))
      .mockRejectedValueOnce(new ProviderError('Unreadable', undefined, false, undefined, 'structuredOutput'));
    const runtime = host(['runSmartGrammarPass'], { smartGrammarIssues: calls });
    Object.assign(runtime.values, { 'userDictionary.geminiProfile': 'pro', 'userDictionary.alternateModel': 'gemini-primary',
      'userDictionary.fallbackEnabled': true, 'userDictionary.fallbackModel': 'gemini-fallback',
      'userDictionary.fallbackThinkingOrEffort': 'high', 'llm.providerSwitch': false });
    const outcome = await runtime.scope.runSmartGrammarPass({}, 'hello', [], new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'failed', reason: expect.stringMatching(/unreadable.*local findings/iu) });
    expect(calls).toHaveBeenCalledTimes(2);
    expect(calls.mock.calls[1]?.[1]).toMatchObject({ model: 'gemini-fallback', geminiProfile: 'pro', thinkingOrEffort: 'high' });
  });

});

describe('V257 centered lookup actions', () => {
  const route = { provider: 'gemini' as const, model: 'gemini-primary', geminiProfile: 'standard' as const,
    thinkingOrEffort: 'auto' as const, fallbackEnabled: false, fallbackModel: '', fallbackThinkingOrEffort: 'auto' as const };
  const names = ['showLookupError', 'handleLookupErrorSelection', 'isCredentialSetupAction', 'actionLabel'];

  // Changed 2026-10-22 (V296, owner I66/I71/I72): the quota action must reach Credentials, which contains the tally.
  it('shows the quota action and opens Credentials containing Requests today', async () => {
    const popup = vi.fn(async () => 'Check Quota and Billing');
    const runtime = host(names, { showKrenErrorMessage: popup, errorMessage: (error: Error) => error.message });
    const showCredentials = vi.fn(async () => {}); runtime.scope.resultsView.showCredentials = showCredentials;
    const error = centeredProviderError(new ProviderError('private diagnostic', 'configureGeminiModel', false, 429, 'quotaExhausted'), route);
    await runtime.scope.showLookupError(error, vi.fn());
    await vi.waitFor(() => expect(showCredentials).toHaveBeenCalledOnce());
    expect(popup.mock.calls[0]).toEqual([expect.stringMatching(/quota.*check.*billing/iu), expect.stringMatching(/check.*quota/iu)]);
    expect(popup.mock.calls[0]).not.toContain('Retry Now');
  });

  it('shows the selected provider set-key action for rejected credentials', async () => {
    const popup = vi.fn(async (..._args: unknown[]) => undefined);
    const runtime = host(names, { showKrenErrorMessage: popup, errorMessage: (error: Error) => error.message });
    const error = centeredProviderError(new ProviderError('private diagnostic', 'configureGeminiModel', false, 401), route);
    await runtime.scope.showLookupError(error, vi.fn());
    expect(popup.mock.calls[0]).toEqual([expect.stringMatching(/set.*Gemini.*key/iu), expect.objectContaining({ modal: true }),
      expect.stringMatching(/set.*Gemini.*key/iu)]);
    expect(popup.mock.calls[0]).not.toContain('Retry Now');
  });

  it('keeps Retry Now available for a retryable centered failure', async () => {
    const popup = vi.fn(async (..._args: unknown[]) => undefined);
    const runtime = host(names, { showKrenErrorMessage: popup, errorMessage: (error: Error) => error.message });
    const retry = vi.fn();
    const error = centeredProviderError(new ProviderError('busy', undefined, true, 503, 'overloaded'), route);
    await runtime.scope.showLookupError(error, retry);
    expect(popup.mock.calls[0]).toContain('Retry Now');
    expect(retry).not.toHaveBeenCalled();
  });
});

describe('R5a finding 7: explicit clipboard grammar includes Smart', () => {
  it('merges the remote pass into the clipboard grammar result', async () => {
    const runtime = host(['executeClipboardLookup', 'runGrammarOperation'], {
      runKrenOperation: vi.fn(async () => ({ kind: 'grammar', issues: [] })),
      runSmartGrammarPass: vi.fn(async () => ({ status: 'completed', model: 'smart-model', issues: [{ id: 'smart-1' }] }))
    });
    runtime.scope.vscode.window.showQuickPick.mockResolvedValue({ operation: 'grammar' });
    await runtime.scope.executeClipboardLookup({});
    expect(runtime.scope.runSmartGrammarPass).toHaveBeenCalledOnce();
    expect(runtime.panel.showResult.mock.calls[0]![0]).toMatchObject({ issues: [{ id: 'smart-1' }], smartModelId: 'smart-model' });
  });
});

describe('R5a finding 8: Smart Grammar Alternate model', () => {
  it('sends the model selected for the Alternate credential profile', async () => {
    const runtime = host(['runSmartGrammarPass']);
    Object.assign(runtime.values, { 'userDictionary.provider': 'gemini', 'userDictionary.geminiProfile': 'pro',
      'userDictionary.model': 'default-choice', 'userDictionary.alternateModel': 'alternate-choice' });
    await runtime.scope.runSmartGrammarPass({}, 'hello', [], new AbortController().signal);
    expect(runtime.scope.smartGrammarIssues).toHaveBeenCalledWith('hello', expect.objectContaining({ model: 'alternate-choice' }), expect.anything(), expect.anything(), []);
  });
});

describe('R5a finding 10: Smart Grammar shares reader cancellation', () => {
  it('keeps the remote pass inside cancellable progress', async () => {
    const runtime = host(['checkGrammarRange', 'runGrammarOperation', 'runSmartGrammarPass']);
    runtime.scope.runKrenOperation.mockResolvedValue({ kind: 'grammar', issues: [] });
    let cancel = () => {}, inProgress = false, remoteInProgress = false, remoteAborted = false;
    runtime.scope.vscode.window.withProgress.mockImplementation(async (_options: unknown, run: any) => {
      inProgress = true;
      try { return await run({}, { onCancellationRequested: (listener: () => void) => { cancel = listener; return { dispose() {} }; } }); }
      finally { inProgress = false; }
    });
    runtime.scope.smartGrammarIssues.mockImplementation(async (_text: string, _settings: unknown, signal: AbortSignal) => {
      remoteInProgress = inProgress;
      cancel();
      remoteAborted = signal.aborted;
      return { status: 'completed', model: 'smart', issues: [] };
    });
    await runtime.scope.checkGrammarRange({}, runtime.scope.vscode.window.activeTextEditor, {}, true, true);
    expect(remoteInProgress).toBe(true);
    expect(remoteAborted).toBe(true);
  });
});

describe('R5a finding 11: clipboard rewrite gear replay', () => {
  it('publishes Both Variants with its operation so settings can regenerate it', async () => {
    const runtime = host(['executeClipboardLookup'], { runKrenOperation: vi.fn(async () => ({ kind: 'rewrite', variants: [] })) });
    await runtime.scope.executeClipboardLookup({});
    expect(runtime.panel.showResult).toHaveBeenCalledWith(expect.objectContaining({ kind: 'rewrite' }), 'hello', false, 'rewrite');
  });
});

describe('R5a finding 12: regeneration updates every result surface', () => {
  it('updates the last result without editor replacement metadata for a clipboard source', async () => {
    const runtime = host(['rerunOperation']);
    runtime.scope.lastResult = { selectedText: 'hello', result: result('old') };
    await runtime.scope.rerunOperation({}, { set: vi.fn() }, 'rewriteFull', 'hello');
    expect(runtime.scope.lastResult).toEqual({ selectedText: 'hello', result: result('initial') });
  });
});
