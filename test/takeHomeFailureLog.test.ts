// 2026-10-10: a failed take-home card names its cause in the KREN log, and its two buttons do not touch.
import { describe, expect, it, vi } from 'vitest';
import { load } from 'cheerio';
vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn() }, env: {},
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback }) },
  window: { showWarningMessage: vi.fn(async () => 'OK') } }));
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { renderKrenResultViewHtml, renderTutorConversation } from '../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import type { TutorStructuredGenerationRequest } from '../src/tutor/generation.js';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function failingHarness(error: Error) {
  const settings = { ...PANEL_SETTINGS_FIXTURE, tutorConversationTakeHome: true,
    credentialPresence: { geminiDefault: true, geminiAlternate: true } };
  const generateTutor = vi.fn(async (request: TutorStructuredGenerationRequest): Promise<unknown> => {
    if (request.kind === 'conversationTakeHome') throw error;
    return {};
  });
  const actions = { settings: () => settings, generateTutor, writeTutorPreferences: vi.fn(), updateSetting: vi.fn(),
    log: vi.fn(), notify: vi.fn(), stopReadAloud: vi.fn(), readAloudText: vi.fn(async () => undefined) };
  const view = new KrenResultsViewProvider(actions as never, {} as never);
  view.tutorState.conversation = { ...view.tutorState.conversation, from: 'anything', replies: 'standard',
    status: 'active', speakerOn: true, draftAnswer: '',
    transcript: [{ question: 'What do you like?', learnerAnswer: 'I like tea.', correction: '', explanation: '' }] };
  view.view = { webview: { html: '', cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }), postMessage: vi.fn(async () => true) } } as never;
  return { view, actions, generateTutor, stop: () => (view as any).handleMessage({ command: 'stopTutorConversation' }) };
}

describe('take-home failure log and button spacing', () => {
  it('logs the cause of a failed card, redacted, while the reader sees the fixed sentence', async () => {
    const h = failingHarness(new Error('Gemini request failed (HTTP 503) key=AIzaSyDUMMYDUMMYDUMMY'));
    // Changed 2026-10-15: V241, owner item I6, card failure follows explicit Review now.
    await h.stop();
    await (h.view as any).handleMessage({ command: 'reviewTutorConversation' });
    for (let i = 0; i < 5; i++) await flush();
    expect(h.generateTutor.mock.calls.some(([request]) => request.kind === 'conversationTakeHome')).toBe(true);
    const lines = h.actions.log.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith('[conversation take-home failed]'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('HTTP 503');
    expect(lines[0]).not.toContain('AIzaSyDUMMY');
    expect(load(renderTutorConversation(h.view.tutorState))('.tutor-take-home').text())
      .toContain('The take-home card could not be prepared. Try again.');
  });

  it('separates consecutive take-home buttons by 6px', () => {
    const css = load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [], activeScreen: 'tutor', settings: PANEL_SETTINGS_FIXTURE }))('style').text();
    expect(css).toContain('.tutor-take-home > button + button { margin-left: 6px; }');
  });
});
