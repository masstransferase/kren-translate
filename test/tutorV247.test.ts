import { expect, it, vi } from 'vitest';
import { load } from 'cheerio';

vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn() }, env: {},
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback }) },
  window: { showWarningMessage: vi.fn(async () => undefined) } }));

import { KrenResultsViewProvider } from '../src/resultsView.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { createTutorViewState } from '../src/tutor/state.js';
import type { PanelNotice } from '../src/panelNotices.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const report = { summary: 'Your questions are clear.', findings: [], targets: [], focus: 'Practice follow-up questions.' };
function stoppedTutor() {
  const state = createTutorViewState();
  Object.assign(state.conversation, { status: 'stopped', from: 'anything', speakerOn: false,
    transcript: Array.from({ length: 5 }, () => ({ question: 'What do you like?', learnerAnswer: 'I like tea.', correction: '', explanation: '' })) });
  return state;
}
function html(extra: Partial<Parameters<typeof renderKrenResultViewHtml>[0]> = {}) {
  return renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [], settings: PANEL_SETTINGS_FIXTURE,
    activeScreen: 'tutor', tutor: stoppedTutor(), ...extra });
}
function harness() {
  let speaking = false;
  let finishSpeech: (() => void) | undefined;
  const actions = { settings: () => PANEL_SETTINGS_FIXTURE, log: vi.fn(), notify: vi.fn(),
    refreshReadAloudVoices: vi.fn(async () => {}), loadUserDictionary: vi.fn(async () => []),
    readAloudText: vi.fn(() => { speaking = true; return new Promise<void>(resolve => { finishSpeech = resolve; }); }),
    stopReadAloud: vi.fn(() => { speaking = false; finishSpeech?.(); }),
    generateTutor: vi.fn(async () => report) };
  const view = new KrenResultsViewProvider(actions as never, {} as never);
  const internals = view as any;
  internals.activeScreen = 'start';
  let markup = '';
  view.view = { visible: true, webview: { cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }),
    set html(value: string) { markup = value; }, postMessage: vi.fn(async () => true) } } as never;
  return { view, actions, internals, speaking: () => speaking, markup: () => markup,
    message: async (command: string) => { await internals.handleMessage({ command }); await flush(); } };
}

const navigation = ['showStartPage', 'showSettings', 'showTutor', 'showUserDictionary', 'showManual', 'showResult', 'showCredentials'];
it.each(navigation)('%s stops the shared Read Aloud path from the Start page, editor, and result', async command => {
  for (const source of ['start', 'editor', 'result']) {
    const h = harness();
    h.internals.activeScreen = source === 'result' ? 'result' : 'start';
    // All three entry points own the same Read Aloud action and Stop path.
    const playback = h.actions.readAloudText();
    expect(h.speaking()).toBe(true);
    await h.message(command);
    expect(h.actions.stopReadAloud).toHaveBeenCalledOnce();
    expect(h.speaking()).toBe(false);
    await playback;
  }
});

it.each(['showSettings', 'showTutor', 'showUserDictionary', 'showCredentials'] as const)('%s also stops speech through the host entry point', async method => {
  const h = harness();
  h.view.reveal = vi.fn(async () => {});
  const playback = h.actions.readAloudText();
  await h.view[method]();
  expect(h.actions.stopReadAloud).toHaveBeenCalledOnce();
  expect(h.speaking()).toBe(false);
  await playback;
});

it('opening the KREN menu alone sends Stop before an item is chosen', async () => {
  const h = harness();
  const playback = h.actions.readAloudText();
  const panel = mountedPanel(html({ activeScreen: 'start' }), message => {
    if (message.command === 'stopReadAloud') h.internals.handlePriorityMessage('stopReadAloud', message);
    else void h.internals.handleMessage(message);
  });
  const menu = panel.query('#result-screen [data-menu-toggle]')!;
  panel.click(menu);
  await flush();
  expect(h.actions.stopReadAloud).toHaveBeenCalledOnce();
  expect(h.speaking()).toBe(false);
  // Changed 2026-10-16: V247, owner item I24, the Cheerio toggle returns an object, so visibility below establishes the open state.
  expect(menu.hasAttribute('aria-expanded')).toBe(true);
  expect(menu.closest('.menu-wrap')!.querySelector('[data-menu-popover]')!.classList.contains('hidden')).toBe(false);
  await playback;
});

it.each([false, true])('More details stops card narration before opening a report, cached=%s', async cached => {
  const h = harness();
  h.internals.activeScreen = 'tutor';
  h.view.tutorState = stoppedTutor();
  if (cached) {
    h.view.tutorState.diagnosticReport = report;
    h.view.tutorState.diagnosticReportSource = { kind: 'conversation', turnCount: 5 };
  }
  const speech = new AbortController();
  const session = { close: vi.fn() };
  const player = { close: vi.fn() };
  h.view.tutorTakeHomeSpeechController = speech;
  h.view.tutorTakeHomeSession = session as never;
  h.view.tutorTakeHomePlayer = player as never;
  h.view.tutorTakeHomeSpeaking = true;
  h.actions.generateTutor.mockImplementation(async () => {
    expect(speech.signal.aborted).toBe(true);
    expect(h.view.tutorTakeHomeSpeaking).toBe(false);
    return report;
  });
  await h.message('diagnoseTutorConversation');
  expect(speech.signal.aborted).toBe(true);
  expect(session.close).toHaveBeenCalledOnce();
  expect(player.close).toHaveBeenCalledOnce();
  expect(h.actions.stopReadAloud).toHaveBeenCalledOnce();
  expect(h.view.tutorState.diagnosticReportDrawerOpen).toBe(true);
  expect(h.actions.generateTutor).toHaveBeenCalledTimes(cached ? 0 : 1);
});

it.each(['light', 'dark'] as const)('the %s report owns contained scrolling and starts with keyboard focus', theme => {
  const state = stoppedTutor();
  Object.assign(state, { diagnosticReport: report, diagnosticReportDrawerOpen: true,
    diagnosticReportSource: { kind: 'conversation', turnCount: 5 } });
  const markup = html({ tutor: state, settings: { ...PANEL_SETTINGS_FIXTURE, panelTheme: theme } });
  const page = load(markup);
  const drawer = page('.tutor-diagnostic-report-drawer');
  expect(drawer.attr('tabindex')).toBe('0');
  expect(drawer.find('h2').text()).toMatch(/diagnostic report/iu);
  expect(drawer.find('[data-command="closeTutorDiagnosticReport"]')).toHaveLength(1);
  const css = page('style').text();
  const scrolling = css.match(/\.tutor-diagnostic-report-drawer\s*\{([^}]+)\}/u)?.[1];
  expect(scrolling).toMatch(/overflow-y:\s*auto/u);
  expect(scrolling).toMatch(/overscroll-behavior:\s*contain/u);
  expect(css).toMatch(/body\[data-active-screen="tutor"\]:has\(\.tutor-diagnostic-report-drawer\)\s*\{\s*overflow:\s*hidden/u);
  const panel = mountedPanel(markup, () => {});
  expect(panel.document.activeElement).toBe(panel.query('.tutor-diagnostic-report-drawer'));
});

it('all four bridges are reachable beside stopped and lesson actions, and unfold and focus the right sections', () => {
  const sent = vi.fn();
  const markup = html();
  const panel = mountedPanel(markup, sent);
  const page = load(markup);
  expect(page('[data-tutor-settings-section]')).toHaveLength(4);
  for (const row of ['[data-tutor-stopped-actions]', '[data-tutor-heading-actions]']) {
    for (const [label, id] of [['Voice', 'tutor-voice'], ['Model', 'tutor-routing']]) {
      const button = panel.query(`${row} [aria-label="Open ${label!.toLowerCase()} settings"]`)!;
      expect(button.tagName).toBe('BUTTON');
      expect(button.disabled).toBe(false);
      expect(button.closest('details:not([open]), [hidden]')).toBeNull();
      expect(button.getAttribute('tabindex')).not.toBe('-1');
      expect(button.textContent).toBe(label);
      expect(button.querySelector('svg')).not.toBeNull();
      const section = panel.query(`details[data-persist-id="${id}"]`)!;
      const parent = panel.query('details[data-persist-id="tutor-setting"]')!;
      parent.open = false; section.open = false;
      const scroll = vi.spyOn(section, 'scrollIntoView');
      panel.click(button);
      expect(parent.open).toBe(true); expect(section.open).toBe(true);
      expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
      expect(panel.document.activeElement).toBe(section.querySelector('summary'));
      scroll.mockRestore();
    }
  }
  // The setting update patches the existing stopped row without losing either bridge.
  const row = panel.query('[data-tutor-stopped-actions]');
  panel.message({ command: 'tutorConversationTakeHomeSetting', value: false });
  expect(panel.query('[data-tutor-stopped-actions]')).toBe(row);
  expect(row!.querySelectorAll('[data-tutor-settings-section]')).toHaveLength(2);
  expect(row!.querySelector('[data-tutor-review-action]')!.textContent).toMatch(/more details/iu);
  expect(sent).toHaveBeenCalledWith({ command: 'stopReadAloud' });
  // Changed 2026-10-16: V250, owner item I32, bridge outlines are transparent like the header gear.
  expect(page('style').text()).toMatch(/\.tutor-settings-bridge\s*\{[^}]*background:\s*transparent;[^}]*border-color:\s*transparent/u);
});

it.each([120, 121])('notice delivery and busy cards share compact sizing at %i characters', length => {
  const message = 'x'.repeat(length);
  const notice: PanelNotice = { id: 247, kind: 'warning', message, modal: false, choices: [] };
  const busy = load(html({ busyNotice: message }));
  expect(busy('.busy-card').hasClass('popup-long-message')).toBe(length > 120);
  expect(busy('.busy-spinner + .popup-message').text()).toBe(message);
  for (const initial of [false, true]) {
    const panel = mountedPanel(html({ panelNotices: initial ? [notice] : [] }), () => {});
    if (!initial) panel.message({ command: 'panelNotice', notice });
    const card = panel.query('.notice-card')!;
    expect(card.classList.contains('popup-long-message')).toBe(length > 120);
    expect(card.querySelector('.popup-message')!.textContent).toBe(message);
  }
  const css = busy('style').text();
  expect(css).toMatch(/\.popup-message\s*\{[^}]*text-align:\s*left/u);
  expect(css).toMatch(/\.busy-overlay > \.busy-card\.popup-long-message\s*\{[^}]*font-size:\s*12px;[^}]*max-width:/u);
});
