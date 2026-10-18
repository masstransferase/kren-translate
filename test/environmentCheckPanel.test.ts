import { expect, it, vi } from 'vitest';
import { load } from 'cheerio';
vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn() }, env: {},
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
  window: { showWarningMessage: vi.fn(async () => undefined) } }));
import { commands } from 'vscode';
import { isCommandMessage } from '../src/resultsViewCommands.js';
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { systemUpdatesAvailable, type EnvironmentChecks, type EnvironmentItem } from '../src/environmentCheck.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

const edge: EnvironmentItem = { name: 'edge-tts', status: 'update', found: '7.2.8', expected: '7.3.1',
  explanation: 'A newer edge-tts version is available on PyPI.', fix: 'updateEdgeTts' };
function html(extra: Partial<Parameters<typeof renderKrenResultViewHtml>[0]> = {}) {
  return renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [], settings: PANEL_SETTINGS_FIXTURE,
    activeScreen: 'start', ...extra });
}
function harness() {
  const actions = { settings: () => PANEL_SETTINGS_FIXTURE, log: vi.fn(), notify: vi.fn(), stopReadAloud: vi.fn() };
  const view = new KrenResultsViewProvider(actions as never, {} as never);
  const internals = view as any;
  internals.activeScreen = 'start';
  const post = vi.fn(async () => true);
  let markup = '';
  view.view = { visible: true, webview: { cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }),
    set html(value: string) { markup = value; }, postMessage: post } } as never;
  const checks = { items: [edge], busy: false, statuses: { 'edge-tts': 'update' }, check: vi.fn(async () => [edge]), updateEdgeTts: vi.fn(async () => {}) };
  view.environmentChecks = checks as unknown as EnvironmentChecks;
  return { view, internals, actions, post, checks, markup: () => markup,
    message: (command: string) => internals.handleMessage({ command }) as Promise<void> };
}

it('places the keyboard-reachable update command last, after Settings, in every menu', () => {
  const $ = load(html());
  $('[data-menu-popover]').each((_, menu) => {
    const buttons = $(menu).children('button');
    expect(buttons.last().text()).toMatch(/check for updates/iu);
    expect(buttons.last().attr('data-command')).toBe('checkForUpdates');
    expect(buttons.last().is('[role="menuitem"]:not([disabled])')).toBe(true);
    expect(buttons.eq(-2).attr('data-command')).toBe('showSettings');
  });
});
it('shows the notice next to Home on Start for required updates, with an ordinary button outside disclosures', () => {
  const $ = load(html({ systemUpdatesAvailable: systemUpdatesAvailable({ 'edge-tts': 'update' }) }));
  const button = $('#result-screen [data-system-updates]');
  // Changed 2026-10-17: V261, F5 owner canvas edit, the shorter label still names available updates.
  expect(button.text()).toMatch(/updates available/iu);
  expect(button.prev().attr('data-command')).toBe('showStartPage');
  expect(button.is('button:not([disabled])')).toBe(true);
  expect(button.parents('details, .hidden')).toHaveLength(0);
  expect(button.attr('data-command')).toBe('checkForUpdates');
  const optional = load(html({ systemUpdatesAvailable: systemUpdatesAvailable({ Handy: 'missing' }) }));
  expect(optional('#result-screen [data-system-updates]').hasClass('hidden')).toBe(true);
});
it('patches a mounted Start notice on and off without replacing the page', () => {
  const panel = mountedPanel(html(), () => {});
  const button = panel.query('#result-screen [data-system-updates]')!;
  const home = panel.query('#result-screen [data-command="showStartPage"]');
  expect(button.classList.contains('hidden')).toBe(true);
  panel.message({ command: 'systemUpdatesStatus', available: true });
  expect(button.classList.contains('hidden')).toBe(false);
  panel.message({ command: 'systemUpdatesStatus', available: false });
  expect(button.classList.contains('hidden')).toBe(true);
  expect(panel.query('#result-screen [data-command="showStartPage"]')).toBe(home);
});
it('lists every result on a visible card screen with Update and Check again outside collapsed sections', () => {
  const items: EnvironmentItem[] = [edge, { name: 'Python', status: 'missing', found: 'Not found', expected: 'An interpreter',
    explanation: 'Set the configured Python interpreter.', fix: 'pythonSetting' },
  { name: 'Handy', status: 'missing', found: 'Not found', expected: 'Optional installation', explanation: 'Handy is optional for local tutor dictation.' },
  { name: 'VS Code', status: 'ok', found: 'Meets minimum', expected: 'Manifest minimum', explanation: 'VS Code meets the extension minimum.' }];
  const $ = load(html({ activeScreen: 'updates', environmentItems: items }));
  const screen = $('#updates-screen');
  expect(screen.hasClass('hidden')).toBe(false); expect($('#result-screen').hasClass('hidden')).toBe(true);
  expect(screen.find('.card')).toHaveLength(4);
  for (const name of items.map(item => item.name)) expect(screen.text()).toContain(name);
  const update = screen.find('[data-command="updateEdgeTts"]');
  expect(update.text()).toBe('Update'); expect(update.is('button:not([disabled])')).toBe(true);
  expect(update.parents('details, .hidden')).toHaveLength(0);
  expect(screen.find('[data-command="checkForUpdates"]').last().text()).toBe('Check again');
  expect(screen.text()).toMatch(/found:.*expected:/iu);
  expect(screen.text()).toMatch(/Handy is optional/iu);
});
it('disables repeat actions and explains the wait while a check is running', () => {
  const $ = load(html({ activeScreen: 'updates', environmentItems: [edge], environmentBusy: true }));
  expect($('#updates-screen [data-command="updateEdgeTts"]').prop('disabled')).toBe(true);
  expect($('#updates-screen [data-command="checkForUpdates"]').last().prop('disabled')).toBe(true);
  expect($('#updates-screen [role="status"]').text()).toMatch(/checking.*please wait/iu);
});
it('menu and notice navigation open the results and run the injected check', async () => {
  // Changed 2026-10-16: V249, F12a, exercise the shared validator for every updates action before dispatch.
  for (const command of ['checkForUpdates', 'updateEdgeTts', 'openUpdatesPythonSetting']) {
    expect(isCommandMessage({ command })).toBe(true);
  }
  const h = harness(); await h.message('checkForUpdates');
  expect(h.actions.stopReadAloud).toHaveBeenCalled(); expect(h.checks.check).toHaveBeenCalledOnce();
  expect(load(h.markup())('#updates-screen').hasClass('hidden')).toBe(false);
  await h.message('updateEdgeTts'); expect(h.checks.updateEdgeTts).toHaveBeenCalledOnce();
  await h.message('openUpdatesPythonSetting');
  expect(commands.executeCommand).toHaveBeenCalledWith('workbench.action.openSettings', 'kren.readAloud.edgePythonCommand');
});
it('daily completion posts the notice without rendering over an active conversation', () => {
  const h = harness(); h.internals.activeScreen = 'tutor';
  const render = vi.spyOn(h.view, 'render');
  h.view.environmentChecksChanged();
  expect(render).not.toHaveBeenCalled();
  expect(h.post).toHaveBeenCalledWith({ command: 'systemUpdatesStatus', available: true });
});
