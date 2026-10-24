import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const native = vi.hoisted(() => vi.fn(async (..._args: any[]) => undefined as string | undefined));
vi.mock('vscode', () => ({
  window: { showInformationMessage: native, showWarningMessage: native, showErrorMessage: native },
  commands: { executeCommand: async () => {} }, Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) }
}));
import { PanelNoticeQueue, showNativePanelNotice } from '../src/panelNotices.js';
import { ProviderError } from '../src/errors.js';
import { queueHostV265, flushV265 } from './support/v265QueueChecks.js';

beforeEach(() => native.mockClear());
afterEach(() => vi.useRealTimers());

function source(file: string) {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
}

it('guards src against corner messages and notification progress; the sole native boundary is panelNotices.ts::showNativePanelNotice', () => {
  const violations: string[] = [];
  const scan = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) { scan(file); continue; }
      if (!file.endsWith('.ts')) continue;
      const tree = source(file);
      const visit = (node: ts.Node) => {
        if (ts.isPropertyAccessExpression(node) && node.name.text === 'Notification' &&
            /ProgressLocation$/u.test(node.expression.getText(tree))) violations.push(`${file}: notification progress`);
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
            /^show(?:Information|Warning|Error)Message$/u.test(node.expression.name.text)) {
          // These three adapters call the real queue methods, which have the same names as VS Code.
          const adapter = file.endsWith('extension.ts') && node.expression.expression.getText(tree) === 'resultsView';
          const options = node.arguments[1];
          const modal = options && ts.isObjectLiteralExpression(options) && options.properties.some(property =>
            ts.isPropertyAssignment(property) && property.name.getText(tree) === 'modal' && property.initializer.kind === ts.SyntaxKind.TrueKeyword);
          if (!adapter && !modal) violations.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}: non-modal message`);
          if (!adapter && !file.endsWith('panelNotices.ts')) {
            // Direct modal questions are permitted; native status fallback stays in the named helper.
            expect(modal).toBe(true);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }
  };
  scan('src');
  expect(violations).toEqual([]);
});

/** Execute shipped adapters and command callbacks without activating unrelated services. */
function extension(view?: unknown, extra: Record<string, unknown> = {}) {
  const tree = source('src/extension.ts');
  const names = ['notify', 'showKrenInformationMessage', 'showKrenWarningMessage', 'showKrenErrorMessage', 'withKrenProgress',
    'testLanguageModelConnection', 'testGeminiConnection', 'testCredentialConnection', 'testMerriamWebsterConnection',
    'testKoreanDictionary', 'refreshLanguageModels'];
  const functions = tree.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ''));
  const commands: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'registerCommand' &&
        node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text.startsWith('kren.test')) {
      commands.push(`${JSON.stringify(node.arguments[0].text)}: ${node.arguments[1]!.getText(tree)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  const fallback = tree.statements.find(node => ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(declaration => declaration.name.getText(tree) === 'unavailablePanelNotices'))!;
  const code = [fallback.getText(tree), ...functions.map(node => node.getText(tree).replace(/^export /u, '')),
    `({ ${names.join(', ')}, commands: { ${commands.join(',\n')} } });`].join('\n');
  const modelList = async () => [{ id: 'example-model', displayName: 'Example' }];
  class Provider {
    async lookup() { return { entries: [{ meaning: 'tree' }] }; }
    async translate() {}
  }
  return runInNewContext(ts.transpileModule(code, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None
  } }).outputText, {
    PanelNoticeQueue, showNativePanelNotice, resultsView: view, ProviderError, AbortController, setTimeout, clearTimeout,
    context: { secrets: { get: async () => 'present' } },
    vscode: { window: { showInformationMessage: native, showWarningMessage: native, showErrorMessage: native,
      withProgress: vi.fn(async (_options, task) => task()) },
      ProgressLocation: { Window: 10 }, commands: { executeCommand: async () => {} },
      workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } },
    geminiRefreshTarget: (profile: string) => ({ secretKey: 'gemini', setKeyCommand: 'set', keyHint: 'key', label: profile }),
    geminiModelDiscoveryProtections: () => ({}), listGeminiProModels: modelList, listGroqModels: modelList, listOpenAIModels: modelList, listAnthropicModels: modelList,
    testCloudflareCredentials: async () => {}, GoogleCloudTranslationProvider: Provider, MerriamWebsterProvider: Provider,
    KoreanDictionaryProvider: Provider, cloudTranslationUsage: { reserve: () => {} },
    chirpSpeech: { test: async () => 'Google Cloud Text-to-Speech works.' },
    KREN_SECRET_KEYS: {}, GROQ_KEY: 'groq', OPENAI_KEY: 'openai', ANTHROPIC_KEY: 'anthropic',
    // Changed 2026-10-22 (V293, owner I61/D22 A): one missing-key message with Open Credentials.
    GOOGLE_CLOUD_TEXT_TO_SPEECH_KEY: 'speech', GOOGLE_CLOUD_TRANSLATION_KEY: 'translation', DICTIONARY_KEY: 'dictionary',
    MW_COLLEGIATE_KEY: 'collegiate', MW_THESAURUS_KEY: 'thesaurus', MW_MEDICAL_KEY: 'medical',
    showLookupError: (error: unknown) => { throw error; }, ...extra
  });
}

const credentialCommands = ['GeminiConnection', 'GeminiProConnection', 'GroqConnection', 'OpenAIConnection', 'AnthropicConnection',
  'CloudflareConnection', 'GoogleCloudTranslation', 'GoogleCloudTextToSpeech', 'MerriamWebsterCollegiate',
  'MerriamWebsterThesaurus', 'MerriamWebsterMedical', 'KoreanDictionary'];

it.each(credentialCommands)('Credentials Test %s produces an information card with reachable OK', async name => {
  const h = queueHostV265();
  try {
    await extension(h.view).commands[`kren.test${name}`](); await flushV265();
    const card = h.panel().query('[role="alertdialog"]')!;
    expect(card?.getAttribute('aria-label')).toBe('Information');
    expect(card.closest('details:not([open]), [hidden]')).toBeNull();
    const ok = card.querySelector('button')!;
    expect(ok.textContent).toBe('OK');
    expect(h.panel().evaluate('document.activeElement.textContent')).toBe('OK');
    h.panel().key('Tab');
    expect(h.panel().evaluate('document.activeElement.textContent')).toBe('OK');
    expect(native).not.toHaveBeenCalled();
    h.panel().click(ok); await flushV265();
    expect(h.panel().query('[role="alertdialog"]')).toBeNull();
  } finally { h.view.dispose(); }
});

it.each(credentialCommands)('hidden-panel Credentials Test %s uses modal true and OK', async name => {
  const h = queueHostV265();
  try {
    (h.view as any).view.visible = false;
    await extension(h.view).commands[`kren.test${name}`](); await flushV265();
    expect(native).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ modal: true }), 'OK');
    expect(h.messages.some(message => message.command === 'panelNotice')).toBe(false);
  } finally { h.view.dispose(); }
});

it('Groq Test preserves requests left in the information popup', async () => {
  const h = queueHostV265();
  try {
    await extension(h.view).testLanguageModelConnection({ secrets: { get: async () => 'present' } }, 'Groq', 'groq', 'set',
      async () => [], { limit: 100, remaining: 97 }); await flushV265();
    expect(h.panel().query('[role="alertdialog"]')?.textContent).toContain('97 of 100 requests left today');
  } finally { h.view.dispose(); }
});

it('a question enforces modal true and preserves choices, detail, and cancellation', async () => {
  const fallback = vi.fn(async () => undefined);
  const post = vi.fn();
  const queue = new PanelNoticeQueue(() => true, post, fallback);
  await expect(queue.show('error', 'Try again?', { detail: 'Request failed', modal: false }, 'Retry', 'Configure')).resolves.toBeUndefined();
  expect(fallback).toHaveBeenCalledWith('error', 'Try again?', { detail: 'Request failed', modal: true }, ['Retry', 'Configure']);
  expect(post).not.toHaveBeenCalled();
});

it('hidden-panel fallback itself supplies modal true with OK', async () => {
  const fallback = vi.fn(async () => undefined);
  const queue = new PanelNoticeQueue(() => false, () => undefined, fallback);
  await queue.show('information', 'Test succeeded');
  expect(fallback).toHaveBeenCalledWith('information', 'Test succeeded', { modal: true }, ['OK']);
});

it('unavailable adapters and closed queues use modal OK, and reopening restores cards', async () => {
  extension().notify('information', 'Test succeeded'); await flushV265();
  expect(native).toHaveBeenCalledWith('Test succeeded', { modal: true }, 'OK');
  const fallback = vi.fn(async () => undefined), post = vi.fn(async () => true);
  const queue = new PanelNoticeQueue(() => true, post, fallback);
  const pending = queue.show('information', 'Pending'); queue.close(); await pending;
  await queue.show('warning', 'Closed');
  expect(fallback).toHaveBeenCalledWith('information', 'Pending', { detail: undefined, modal: true }, ['OK']);
  expect(fallback).toHaveBeenCalledWith('warning', 'Closed', { modal: true }, ['OK']);
  queue.open(); const reopened = queue.show('information', 'Reopened');
  expect(queue.snapshot()).toHaveLength(1);
  queue.respond({ id: queue.snapshot()[0]!.id }); await reopened;
});

it('an unacknowledged information card escalates at 1500 ms to modal OK', async () => {
  vi.useFakeTimers();
  const fallback = vi.fn(async () => undefined), withdraw = vi.fn();
  const queue = new PanelNoticeQueue(() => true, async () => true, fallback, withdraw);
  const pending = queue.show('information', 'Test succeeded');
  await vi.advanceTimersByTimeAsync(1499); expect(fallback).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); await pending;
  expect(fallback).toHaveBeenCalledWith('information', 'Test succeeded', { modal: true }, ['OK']);
  expect(withdraw).toHaveBeenCalledWith(1);
});

it('model Refresh shows the existing long-busy popup and then its information OK card', async () => {
  const h = queueHostV265();
  let finish!: (models: unknown[]) => void;
  try {
    const pending = extension(h.view).refreshLanguageModels({ secrets: { get: async () => 'present' } }, 'openai', 'set', 'OpenAI',
      () => new Promise(resolve => { finish = resolve; }), []);
    await flushV265();
    expect(h.panel().query('.busy-overlay .busy-card .popup-message')?.textContent).toContain('retrieving OpenAI models');
    expect(h.panel().query('.busy-overlay')?.closest('details:not([open]), [hidden]')).toBeNull();
    expect(native).not.toHaveBeenCalled();
    finish([]); await pending; await flushV265();
    expect(h.panel().query('[role="alertdialog"]')?.textContent).toContain('KREN found 0 OpenAI models');
    expect(h.panel().query('.busy-spinner')).toBeNull();
    expect(h.panel().evaluate('document.activeElement.textContent')).toBe('OK');
    h.panel().click(h.panel().query('[role="alertdialog"] button')!);
  } finally { h.view.dispose(); }
});

it('hidden-panel pending progress uses the status bar and completion uses modal OK', async () => {
  const window = { withProgress: vi.fn(async (_options, task) => task()), showInformationMessage: native };
  const ext = extension(undefined, { vscode: { window, ProgressLocation: { Window: 10 } } });
  await ext.withKrenProgress({ title: 'Retrieving models', cancellable: false }, async () => {});
  expect(window.withProgress).toHaveBeenCalledWith({ title: 'Retrieving models', cancellable: false, location: 10 }, expect.any(Function));
  ext.notify('information', 'Refresh complete'); await flushV265();
  expect(native).toHaveBeenCalledWith('Refresh complete', { modal: true }, 'OK');
});
