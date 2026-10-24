import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { PanelNoticeQueue } from '../src/panelNotices.js';
import { globalRoutingPlan } from '../src/panelSettings.js';
import { missingCredentialError } from '../src/requestCenter.js';
import { queueHostV265, flushV265, deferredV265 } from './support/v265QueueChecks.js';

const native = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined));
vi.mock('vscode', () => ({
  window: { showInformationMessage: native, showWarningMessage: native, showErrorMessage: native },
  commands: { executeCommand: async () => {} }, Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) }
}));

afterEach(() => { vi.useRealTimers(); native.mockClear(); });

function functions(file: string, names: string[], dependencies: Record<string, unknown>, preamble = ''): any {
  const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const code = names.map(name => {
    const node = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    if (!node) throw new Error(`Missing function ${name}`);
    return node.getText(tree).replace(/^export /u, '');
  }).join('\n');
  return runInNewContext(ts.transpileModule(`${preamble}\n${code}\n({${names.join(',')}})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText, dependencies);
}
const targets = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };

it('R28a 1: mounted Refresh progress preserves scroll and focus without replacing the document', async () => {
  const h = queueHostV265();
  try {
    (h.view as any).activeScreen = 'settings'; h.view.refresh(); await flushV265();
    const panel = h.panel();
    const button = panel.query('#settings-screen [data-command="refreshGeminiModels"]')!;
    expect(button).toBeTruthy();
    for (const details of panel.document.querySelectorAll('details')) details.open = true;
    expect(button.closest('[hidden], .hidden, details:not([open])')).toBeNull();
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('tabindex')).not.toBe('-1');
    button.focus(); panel.evaluate('window.scrollY = 731');
    const webview = (h.view as any).view.webview;
    const original = Object.getOwnPropertyDescriptor(webview, 'html')!;
    const replace = vi.fn((html: string) => { original.set!.call(webview, html); panel.evaluate('window.scrollY = 0'); });
    Object.defineProperty(webview, 'html', { ...original, set: replace });
    const held = deferredV265();
    const refreshing = h.view.withPanelProgress('Refreshing models...', () => held.promise);
    expect(panel.query('.busy-overlay:not([data-kren-notice]) .popup-message')?.textContent).toBe('Refreshing models...');
    expect(panel.query('.busy-overlay')?.closest('details, [hidden]')).toBeNull();
    expect(panel.evaluate('window.scrollY')).toBe(731);
    expect(panel.document.activeElement).toBe(button);
    held.resolve(); await refreshing; await flushV265();
    expect(replace).not.toHaveBeenCalled();
    expect(panel.evaluate('window.scrollY') - 731).toBe(0);
    expect(panel.document.activeElement).toBe(button);
    expect(panel.document.body.hasAttribute('data-busy')).toBe(false);
    const errorWait = deferredV265();
    const retry = h.view.withPanelProgress('Retrying...', () => errorWait.promise);
    const error = h.view.showErrorMessage('Discovery failed.'); await flushV265();
    expect(panel.query('[role="alertdialog"]')?.textContent).toContain('Discovery failed.');
    errorWait.resolve(); await retry;
    panel.click(panel.query('[role="alertdialog"] button')!); await error; panel.mutate();
    expect(panel.query('.busy-spinner')).toBeNull();
    expect(panel.document.body.hasAttribute('data-busy')).toBe(false);
  } finally { h.view.dispose(); }
});

it('R28a 1: discovery completion does not redraw a page reached during the wait', async () => {
  const h = queueHostV265();
  try {
    const held = deferredV265();
    const pending = h.view.withPanelProgress('Discovering...', () => held.promise);
    h.view.showCredentials(); await flushV265();
    const webview = (h.view as any).view.webview;
    const original = Object.getOwnPropertyDescriptor(webview, 'html')!;
    const replace = vi.fn(original.set!.bind(webview));
    Object.defineProperty(webview, 'html', { ...original, set: replace });
    held.resolve(); await pending;
    expect(replace).not.toHaveBeenCalled();
    expect(h.panel().document.body.getAttribute('data-active-screen')).toBe('credentials');
    expect(h.panel().document.body.hasAttribute('data-busy')).toBe(false);
  } finally { h.view.dispose(); }
});

it('R28a 4: reading the first notice for three seconds never escalates the queued notice', async () => {
  vi.useFakeTimers();
  const fallback = vi.fn(async () => undefined);
  const post = vi.fn(async () => true);
  const queue = new PanelNoticeQueue(() => true, post, fallback);
  const first = queue.show('information', 'First result');
  const second = queue.show('information', 'Second result');
  const [a, b] = queue.snapshot();
  queue.acknowledge({ id: a!.id, visible: true });
  queue.notShown({ id: b!.id, reason: 'already showing another card' });
  await vi.advanceTimersByTimeAsync(3_000);
  expect(fallback).not.toHaveBeenCalled();
  expect(queue.snapshot()).toHaveLength(2);
  queue.respond({ id: a!.id }); await first;
  await vi.advanceTimersByTimeAsync(1_499);
  expect(fallback).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); await second;
  expect(fallback).toHaveBeenCalledExactlyOnceWith('information', 'Second result', { modal: true }, ['OK']);
});

it.each(['runTutorTransport', 'createExternalLanguageModelProvider'])('R28a 5: %s requires the account ID before consent', async name => {
  const consent = vi.fn(async () => {}), request = vi.fn();
  const runtime = { getSecret: async (slot: string) => slot === 'token-slot' ? 'stored-test-value' : undefined };
  const host = functions('src/operations.ts', [name, 'requireCloudflareAccount', 'missingCloudflareCredentials'], {
    KREN_SECRET_KEYS: { cloudflareApiToken: 'token-slot', cloudflareAccountId: 'account-slot' },
    languageModelCredentialSlot: () => 'cloudflareApiToken', beforeLanguageModelRequest: consent,
    missingCredentialError, requestTutorStructuredJson: request, languageModelRetries: () => 1,
    routedModel: (_provider: unknown, model: unknown) => model, compatibleDefaultModel: () => 'test-model',
    CompatibleLanguageModelProvider: class { constructor() { request(); } }
  });
  const action = name === 'runTutorTransport'
    ? host[name](runtime, { provider: 'cloudflare', model: 'test-model', geminiProfile: 'standard' }, { kind: 'lesson' }, new AbortController().signal)
    : host[name](runtime, 'cloudflare');
  await expect(action).rejects.toThrow(/account ID/u);
  expect(consent).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

it.each([true, false])('R28a 6: editor Translate progress and grammar confirmations follow panel visibility (%s)', async visible => {
  const h = queueHostV265();
  try {
    (h.view as any).view.visible = visible;
    const held = deferredV265();
    const status = vi.fn(async (_options, task) => task(undefined, { onCancellationRequested: () => ({ dispose() {} }) }));
    const dependencies = {
      resultsView: h.view, AbortController, setTimeout, clearTimeout,
      vscode: { window: { withProgress: status, setStatusBarMessage: vi.fn(() => ({ dispose() {} })) }, ProgressLocation: { Window: 10 },
        // Changed 2026-10-23 (V307, verification R30): visible cancellable progress now owns a VS Code cancellation source.
        CancellationTokenSource: class {
          token = { onCancellationRequested: () => ({ dispose() {} }) };
          cancel() {}
          dispose() {}
        },
        workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } },
      progressTitle: () => 'KREN: Translating...', extensionRuntime: () => ({}),
      explicitTextSubmission: (text: string) => ({ text }), runKrenOperation: () => held.promise,
      addHarperWord: async () => ['sample'], normalizeCustomWord: (word: string) => word,
      GRAMMAR_CUSTOM_WORDS: 'words', notify: (_kind: string, message: string) => { void h.view.showInformationMessage(message); }
    };
    const host = functions('src/extension.ts', ['withKrenProgress', 'krenSpeechProgress', 'runOperationWithProgress', 'persistGrammarPreference'], dependencies);
    const pending = host.runOperationWithProgress({}, 'translate', 'Hello.', {});
    await flushV265();
    if (visible) {
      expect(h.panel().query('.busy-overlay .popup-message')?.textContent).toBe('KREN: Translating...');
      expect(status).not.toHaveBeenCalled();
    } else expect(status).toHaveBeenCalledOnce();
    held.resolve(); await pending;
    await host.persistGrammarPreference({ globalState: { update: async () => {} } }, { original: 'sample' }, 'addWord');
    await flushV265();
    if (visible) {
      const card = h.panel().query('[role="alertdialog"]')!;
      expect(card?.getAttribute('aria-label')).toBe('Information');
      expect(card?.textContent).toMatch(/Added.*sample.*dictionary/u);
      expect(card.closest('details, [hidden]')).toBeNull();
      expect(h.panel().document.activeElement?.textContent).toBe('OK');
      h.panel().key('Tab'); expect(h.panel().document.activeElement?.textContent).toBe('OK');
      h.panel().key('Escape'); await flushV265();
      expect(h.panel().query('[role="alertdialog"]')).toBeNull();
      expect(native).not.toHaveBeenCalled();
    } else expect(native).toHaveBeenCalledWith(expect.stringMatching(/Added.*sample.*dictionary/u), { modal: true }, 'OK');
    const speech = host.krenSpeechProgress('edgeOnline');
    // Changed 2026-10-23 (V305, owner I74/D41 A): speech no longer opens a panel busy popup.
    if (visible) expect(h.panel().query('.busy-overlay')).toBeNull();
    else expect(dependencies.vscode.window.setStatusBarMessage).toHaveBeenCalledWith(expect.stringMatching(/Generating and reading Edge voice/u));
    speech.dispose(); await flushV265();
    expect(h.panel().query('.busy-spinner')).toBeNull();
  } finally { h.view.dispose(); }
});

it('R28b 2: a failed third Apply write restores the first two explicit Global values and reports the key', async () => {
  const values: Record<string, unknown> = { 'global.provider': 'groq', 'global.model': 'test-new-model',
    'translation.provider': 'gemini' };
  const before = { ...values };
  const writes: Array<[string, unknown]> = [];
  let failed = '';
  const config = { get: (key: string, fallback: unknown) => values[key] ?? fallback,
    inspect: (key: string) => ({ globalValue: values[key] }),
    update: vi.fn(async (key: string, value: unknown) => {
      writes.push([key, value]);
      if (writes.length === 3) { failed = key; throw new Error('Write denied'); }
      if (value === undefined) delete values[key]; else values[key] = value;
    }) };
  const error = vi.fn(), refresh = vi.fn();
  const host = functions('src/extension.ts', ['applyGlobalRouting'], {
    vscode: { workspace: { getConfiguration: () => config }, ConfigurationTarget: targets }, globalRoutingPlan,
    showKrenWarningMessage: async () => 'Apply', notify: (_kind: string, message: string) => error(message), resultsView: { refresh }
  }, 'let globalRoutingApplyPending = false;');
  await host.applyGlobalRouting();
  expect(values).toEqual(before);
  expect(writes).toHaveLength(5);
  expect(writes.slice(3).map(([key]) => key)).toEqual(writes.slice(0, 2).reverse().map(([key]) => key));
  expect(error).toHaveBeenCalledWith(expect.stringContaining(failed));
  expect(refresh).not.toHaveBeenCalled();
});

it('R28b 3: migrates Global, Workspace and two folders independently, preserves explicit Auto, then does nothing', async () => {
  const legacy = 'tutor.fallbackThinkingOrEffort', retired = 'tutor.fallbackModel', fast = 'tutor.hintThinkingOrEffort';
  const global: Record<string, unknown> = { [legacy]: 'high', [retired]: 'global-old' };
  const workspace: Record<string, unknown> = { [legacy]: 'medium', [retired]: 'workspace-old', [fast]: 'auto' };
  const folders: Array<Record<string, unknown>> = [ { [legacy]: 'low', [retired]: 'folder-old' },
    { [legacy]: 'high', [retired]: 'folder-two-old', [fast]: 'low' } ];
  const writes: Array<[number, string, unknown, number]> = [];
  const configs = folders.map((folder, index) => ({ inspect: (key: string) => ({ globalValue: global[key],
    workspaceValue: workspace[key], workspaceFolderValue: folder[key] }),
    update: async (key: string, value: unknown, target: number) => {
      writes.push([index, key, value, target]);
      const scope = [global, workspace, folder][target - 1]!;
      if (value === undefined) delete scope[key]; else scope[key] = value;
    } }));
  const { migrateTutorFastSettings } = functions('src/extension.ts', ['migrateTutorFastSettings'], {
    vscode: { ConfigurationTarget: targets, workspace: { workspaceFolders: [{ uri: 0 }, { uri: 1 }],
      getConfiguration: (_section: string, uri: number) => configs[uri] } }
  });
  await migrateTutorFastSettings();
  expect(global).toEqual({ [fast]: 'high' });
  expect(workspace).toEqual({ [fast]: 'auto' });
  expect(folders).toEqual([{ [fast]: 'low' }, { [fast]: 'low' }]);
  expect(writes.filter(([, key]) => key === fast)).toEqual([[0, fast, 'high', 1], [0, fast, 'low', 3]]);
  const count = writes.length;
  await migrateTutorFastSettings(); expect(writes).toHaveLength(count);
});
