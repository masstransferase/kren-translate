import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { missingCredentialError, missingCredentialsOf, showMissingCredentialNotice } from '../src/requestCenter.js';
import { geminiRefreshTarget } from '../src/geminiProfileRefresh.js';
import { PanelNoticeQueue } from '../src/panelNotices.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { queueHostV265, flushV265, deferredV265 } from './support/v265QueueChecks.js';

class CancellationSource {
  private readonly controller = new AbortController();
  readonly token = {
    isCancellationRequested: false,
    onCancellationRequested: (callback: () => void) => {
      this.controller.signal.addEventListener('abort', callback);
      return { dispose: () => this.controller.signal.removeEventListener('abort', callback) };
    }
  };
  cancel() { this.token.isCancellationRequested = true; this.controller.abort(); }
  dispose() {}
}

vi.mock('vscode', async () => {
  const { nativeDialogV267, nativeErrorDialogV267 } = await import('./support/v267NativeDialogs.js');
  return { window: { showInformationMessage: async () => undefined, showWarningMessage: nativeDialogV267, showErrorMessage: nativeErrorDialogV267 },
    commands: { executeCommand: async () => {} }, Uri: { joinPath: (...parts: unknown[]) => parts },
    workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } };
});
afterEach(() => vi.useRealTimers());

function extension(names: string[], dependencies: Record<string, unknown>): any {
  const tree = ts.createSourceFile('extension.ts', readFileSync('src/extension.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const code = names.map(name => {
    const node = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    if (!node) throw new Error(`Missing function ${name}`);
    return node.getText(tree).replace(/^export /u, '');
  }).join('\n');
  return runInNewContext(ts.transpileModule(`${code}\n({${names.join(',')}})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText, dependencies);
}

it('R30a 1: a visible cancellable editor lookup exposes reachable Cancel and aborts its request', async () => {
  const h = queueHostV265(), held = deferredV265();
  let signal!: AbortSignal;
  const abort: { reason?: string } = {};
  try {
    const host = extension(['withKrenProgress', 'runOperationWithProgress'], {
      resultsView: h.view, AbortController, setTimeout, clearTimeout,
      vscode: { CancellationTokenSource: CancellationSource,
        workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } },
      progressTitle: () => 'KREN: Looking up...', extensionRuntime: () => ({}),
      explicitTextSubmission: (text: string) => ({ text }),
      runKrenOperation: (_runtime: unknown, _operation: unknown, _submission: unknown, selectedSignal: AbortSignal) => {
        signal = selectedSignal;
        signal.addEventListener('abort', held.resolve, { once: true });
        return held.promise;
      }
    });
    const pending = host.runOperationWithProgress({}, 'dictionary', 'example', abort);
    await flushV265();
    const panel = h.panel();
    const cancel = panel.query('.busy-overlay button[data-command="cancelPanelProgress"]');
    expect(cancel).toBeTruthy();
    expect(cancel!.textContent).toBe('Cancel');
    expect(cancel!.closest('details:not([open]), [hidden], .hidden')).toBeNull();
    expect(cancel!.disabled).toBe(false);
    expect(cancel!.getAttribute('type')).toBe('button');
    expect(cancel!.getAttribute('tabindex')).not.toBe('-1');
    expect(panel.document.activeElement).toBe(cancel);
    // A native button activates on Enter or Space through the same click dispatch.
    panel.click(cancel!); await pending; await flushV265();
    expect(signal.aborted).toBe(true);
    expect(abort.reason).toBe('cancelled');
    expect(panel.query('.busy-spinner')).toBeNull();
    const done = deferredV265();
    const refresh = h.view.withPanelProgress('Refreshing models...', () => done.promise);
    expect(panel.query('.busy-overlay button')).toBeNull();
    done.resolve(); await refresh;
  } finally { held.resolve(); await flushV265(); h.view.dispose(); }
});

it('R30a 2: questions wait for the mounted card OK and each later question receives its answer', async () => {
  const h = queueHostV265();
  try {
    const card = h.view.showInformationMessage('Read this result first.'); await flushV265();
    const first = h.view.showWarningMessage('First question?', { modal: true }, 'First');
    const second = h.view.showWarningMessage('Second question?', { modal: true }, 'Second');
    await flushV265();
    expect(h.dialogs).toHaveLength(0);
    const ok = h.panel().query('[role="alertdialog"] button')!;
    expect(ok.textContent).toBe('OK');
    expect(ok.closest('details:not([open]), [hidden], .hidden')).toBeNull();
    expect(h.panel().document.activeElement).toBe(ok);
    h.panel().click(ok); await card; await flushV265();
    expect(h.panel().query('[data-kren-notice]')).toBeNull();
    expect(h.dialogs).toHaveLength(2);
    expect(h.dialogs[0]!.message).toBe('First question?');
    expect(h.dialogs[1]!.message).toBe('Second question?');
    h.dialogs[0]!.answer('First'); expect(await first).toBe('First'); await flushV265();
    expect(h.dialogs).toHaveLength(2);
    expect(h.dialogs[1]!.message).toBe('Second question?');
    h.dialogs[1]!.answer('Second'); expect(await second).toBe('Second');
  } finally { for (const dialog of h.dialogs) dialog.answer(); h.view.dispose(); }
});

it('busy Cancel survives a full render and ignores stale or non-cancellable operation identifiers', async () => {
  const h = queueHostV265(), first = deferredV265(), second = deferredV265();
  const cancel = vi.fn();
  try {
    const a = h.view.withPanelProgress('Looking up...', () => first.promise, cancel);
    h.view.refresh(); await flushV265();
    const button = h.panel().query('.busy-overlay [data-command="cancelPanelProgress"]')!;
    expect(button).toBeTruthy();
    expect(button.closest('details:not([open]), [hidden], .hidden')).toBeNull();
    expect(h.panel().document.activeElement).toBe(button);
    const id = Number(button.getAttribute('data-operation-id'));
    const b = h.view.withPanelProgress('Refreshing models...', () => second.promise);
    expect(h.panel().query('.busy-overlay button')).toBeNull();
    h.receive({ command: 'cancelPanelProgress', operationId: id });
    expect(cancel).not.toHaveBeenCalled();
    second.resolve(); await b;
    const restored = h.panel().query('.busy-overlay [data-command="cancelPanelProgress"]')!;
    expect(restored.getAttribute('data-operation-id')).toBe(String(id));
    h.panel().click(restored); expect(cancel).toHaveBeenCalledOnce();
    first.resolve(); await a;
    h.receive({ command: 'cancelPanelProgress', operationId: id });
    expect(cancel).toHaveBeenCalledOnce();
  } finally { first.resolve(); second.resolve(); await flushV265(); h.view.dispose(); }
});

it('a canceled queued question and a failed native dialog do not lose the next question', async () => {
  const native = vi.fn().mockRejectedValueOnce(new Error('Dialog closed')).mockResolvedValueOnce('Continue');
  const queue = new PanelNoticeQueue(() => true, async () => true, native);
  const card = queue.show('information', 'Read first.');
  const id = queue.snapshot()[0]!.id;
  queue.acknowledge({ id, visible: true });
  const abort = new AbortController();
  const canceled = queue.show('warning', 'Canceled question', { signal: abort.signal }, 'Delete');
  const failed = queue.show('warning', 'Failed question', {}, 'Apply');
  const next = queue.show('warning', 'Next question', {}, 'Continue');
  abort.abort(); expect(await canceled).toBeUndefined();
  expect(native).not.toHaveBeenCalled();
  queue.respond({ id }); await card;
  expect(await failed).toBeUndefined();
  expect(await next).toBe('Continue');
  expect(native.mock.calls.map(call => call[1])).toEqual(['Failed question', 'Next question']);
});

it('R30a 3: Smart Grammar missing Cloudflare account ID shows one missing-key message with zero consent calls', async () => {
  const consent = vi.fn(async () => {}), popup = vi.fn(async (..._args: unknown[]) => {}), request = vi.fn();
  const host = extension(['runSmartGrammarPass'], {
    vscode: { workspace: { getConfiguration: () => ({ get: (key: string, fallback: unknown) =>
      ({ 'grammar.smart': true, 'userDictionary.provider': 'cloudflare' }[key] ?? fallback) }) } },
    GRAMMAR_SMART_DEFAULT: true, DEFAULT_GEMINI_MODEL: 'test-model',
    extensionRuntime: () => ({ getSecret: async (slot: string) => slot === 'token-slot' ? 'configured' : undefined }),
    featureModel: () => 'test-model', ensureLanguageModelConsent: consent,
    KREN_SECRET_KEYS: { cloudflareApiToken: 'token-slot', cloudflareAccountId: 'account-slot' },
    languageModelCredentialSlot: () => 'cloudflareApiToken', missingCredentialError,
    showLookupError: popup, runFeatureRequest: request
  });
  const outcome = await host.runSmartGrammarPass({}, 'An example.', [], new AbortController().signal);
  expect(outcome).toMatchObject({ status: 'failed', credentialMissing: true });
  expect(consent).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  expect(popup).toHaveBeenCalledTimes(1);
  expect(missingCredentialsOf(popup.mock.calls[0]![0])).toMatchObject({ provider: 'cloudflare', slots: ['account ID'] });
});

it('R30a 5: Free Tier Refresh with only Paid stored includes its hint without the provider-choice line', async () => {
  const popup = vi.fn(async (..._args: unknown[]) => undefined), discovery = vi.fn();
  const host = extension(['refreshGeminiProfileModels', 'showLookupError'], {
    resultsView: { showErrorMessage: popup, showCredentials: async () => {}, credentialPresence: () => ({ geminiAlternate: true }) },
    geminiRefreshTarget, missingSecretCredential: () => missingCredentialError('gemini'),
    missingCredentialsOf, showMissingCredentialNotice, DEFAULT_PRO_MODELS: [], listGeminiProModels: discovery
  });
  await host.refreshGeminiProfileModels({ secrets: { get: async () => undefined } }, 'default');
  expect(discovery).not.toHaveBeenCalled();
  expect(popup).toHaveBeenCalledTimes(1);
  expect(popup.mock.calls[0]![0]).toContain("Gemini Paid has a key: choose Paid in this feature's settings to use it.");
  expect(popup.mock.calls[0]![0]).not.toContain('Or press Cancel and choose another provider.');
});

it.each(['Live', 'image'] as const)('%s Refresh offers another profile only where the reader can select it', async kind => {
  const popup = vi.fn(async (..._args: unknown[]) => undefined);
  const host = extension(['refreshGeminiLiveProfileModels', 'refreshGeminiImageModels', 'showLookupError'], {
    resultsView: { showErrorMessage: popup, showCredentials: async () => {},
      credentialPresence: () => kind === 'Live' ? { geminiAlternate: true } : { geminiDefault: true } },
    geminiRefreshTarget, readPanelSettings: () => ({ tutorLiveProfile: 'standard' }),
    geminiModelDiscoveryProtections: () => ({}), geminiModelCatalog: () => ({ live: [] }), KNOWN_TUTOR_LIVE_MODEL_IDS: [],
    missingSecretCredential: () => missingCredentialError('gemini'), missingCredentialError,
    missingCredentialsOf, showMissingCredentialNotice, KREN_SECRET_KEYS: { geminiPro: 'paid-slot' },
    extensionRuntime: () => ({ getSecret: async () => undefined })
  });
  if (kind === 'Live') await host.refreshGeminiLiveProfileModels({ secrets: { get: async () => undefined } });
  else await host.refreshGeminiImageModels({});
  expect(popup).toHaveBeenCalledOnce();
  if (kind === 'Live') expect(popup.mock.calls[0]![0]).toContain('Gemini Paid has a key:');
  // Changed 2026-10-23 (V307, verification R30): image models require Paid and have no Free Tier selector.
  else expect(popup.mock.calls[0]![0]).not.toContain('Gemini Free Tier has a key:');
  expect(popup.mock.calls[0]![0]).not.toContain('Or press Cancel and choose another provider.');
});

it('R30a 6: the manual qualifies muted opening readiness', () => {
  const html = renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE, proModels: [], activeScreen: 'manual' });
  expect(html).toContain('When muted, text/controls appear once the opening is ready.');
  expect(html).not.toContain('With the speaker off, text and controls appear immediately.');
  expect('When muted, text/controls appear once the opening is ready.'.split(/\s/u)).toHaveLength(
    'With the speaker off, text and controls appear immediately.'.split(/\s/u).length);
});

it('R30b 5: the popup changelog sentence includes the speech exception and hidden-panel status bar', () => {
  const bullet = readFileSync('CHANGELOG.md', 'utf8').split('\n').find(line => line.startsWith('- **Popups instead'))!;
  expect(bullet).toMatch(/speech progress shows no popup/iu);
  expect(bullet).toMatch(/status bar when the panel is hidden/iu);
  expect(bullet).toMatch(/Results, statuses and warnings.*KREN popup with OK.*questions use VS Code's dialog/u);
  expect(bullet.replace(/^- \*\*.*?\*\* /u, '').match(/\.(?=\s|$)/gu)).toHaveLength(1);
});
