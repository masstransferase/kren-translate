import { expect, it, vi } from 'vitest';
import { load } from 'cheerio';
vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn() }, env: {},
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback }) },
  window: { showWarningMessage: vi.fn(async () => 'Proceed') } }));
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { completeStandardTutorTurn } from '../src/resultsViewTurns.js';
import { tutorConversationTurn, type TutorStructuredGenerationRequest } from '../src/tutor/generation.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

const card = { naturally: [], doneWell: [], tryNext: 'Ask a follow-up question.' };
const report = { targets: [], summary: 'You ask clear questions.', findings: [], focus: 'Practice questions.' };
const correction = { correction: 'I like tea.', targetId: '', explanation: 'A complete sentence.', rephrase: 'I enjoy tea.', rephraseWhy: 'A natural alternative.' };
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function harness(count = 5, enabled = true) {
  const settings = { ...PANEL_SETTINGS_FIXTURE, tutorConversationTakeHome: enabled };
  const generateTutor = vi.fn(async (request: TutorStructuredGenerationRequest): Promise<unknown> =>
    request.kind === 'conversationCorrections' ? { corrections: [correction] }
      : request.kind === 'conversationDiagnosis' ? report : card);
  const actions = { settings: () => settings, generateTutor, log: vi.fn(), notify: vi.fn(),
    writeTutorPreferences: vi.fn(), stopReadAloud: vi.fn(), readAloudText: vi.fn(async () => {}) };
  const view = new KrenResultsViewProvider(actions as never, {} as never);
  Object.assign(view.tutorState.conversation, { status: 'active', from: 'anything', replies: 'standard', speakerOn: false,
    currentQuestion: 'Anything else?', transcript: Array.from({ length: count }, () => ({ question: 'What do you like?',
      learnerAnswer: 'I like tea.', correction: '', explanation: '' })) });
  let panel!: ReturnType<typeof mountedPanel>;
  const internals = view as any;
  internals.activeScreen = 'tutor';
  const message = async (command: string) => { await internals.handleMessage({ command }); await flush(); };
  const postMessage = vi.fn(async (value: Record<string, unknown>) => { panel?.message(value); return true; });
  view.view = { visible: true, webview: { cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }),
    set html(value: string) { panel = mountedPanel(value, value => { void internals.handleMessage(value); }); }, postMessage } } as never;
  const buttons = () => load(panel.query('[data-tutor-stopped-actions]')!.outerHTML)('button');
  // Changed 2026-10-16: V253, owner item I35, Voice and Model now follow the review action, so it is no longer the last button.
  const review = () => buttons().not('.tutor-settings-bridge').last();
  return { view, message, generateTutor, actions, settings, buttons, review, panel: () => panel, postMessage };
}

it('Stop requests only the unchanged corrections contract and no card or speech', async () => {
  const h = harness(1);
  Object.assign(h.view.tutorState.conversation, { replies: 'liveGemini', coaching: 'afterwards', speakerOn: true });
  h.view.tutorState.conversation.transcript[0]!.coachingPending = true;
  await h.message('stopTutorConversation');
  expect(h.generateTutor.mock.calls.map(([r]) => r.kind)).toEqual(['conversationCorrections']);
  const request = h.generateTutor.mock.calls[0]![0];
  expect(JSON.parse(request.input).turns).toEqual([{ question: 'What do you like?', learnerAnswer: 'I like tea.' }]);
  expect(JSON.stringify(request)).not.toMatch(/takeHome|take-home/u);
  expect(h.view.tutorState.conversation.transcript[0]).toMatchObject({ correction: correction.correction, coachingPending: undefined });
  expect(h.view.tutorState.conversation.takeHome).toBeUndefined();
  expect(h.actions.readAloudText).not.toHaveBeenCalled();
});

it('Review now makes one card and patches the reachable third button to More details', async () => {
  const h = harness(1); await h.message('stopTutorConversation');
  const panel = h.panel();
  expect(h.generateTutor).not.toHaveBeenCalled();
  // Changed 2026-10-16: V247, owner item I28, the stopped row also exposes voice and model settings.
  // Changed 2026-10-16: V253, owner item I35, Voice and Model follow Review now in the stopped row.
  expect(h.buttons().map((_, button) => load(button).text()).get()).toEqual(['Start new', 'Back to chat', 'Review now', 'Voice', 'Model']);
  const review = panel.query('[data-tutor-stopped-actions] [data-command="reviewTutorConversation"]')!;
  expect(review.closest('details')).toBeNull();
  expect(review.tagName).toBe('BUTTON'); expect(review.disabled).toBe(false);
  h.view.tutorState.conversation.speakerOn = true;
  await h.message('reviewTutorConversation'); await h.message('reviewTutorConversation');
  expect(h.panel()).toBe(panel);
  expect(h.generateTutor.mock.calls.map(([r]) => r.kind)).toEqual(['conversationTakeHome']);
  expect(h.actions.readAloudText).toHaveBeenCalledOnce();
  const details = panel.query('[data-tutor-stopped-actions] [data-command="diagnoseTutorConversation"]')!;
  expect(details.textContent).toBe('More details'); expect(details.disabled).toBe(true);
  expect(details.title).toBe('Needs five answered turns.');
  expect(panel.query('.tutor-take-home')?.textContent).toContain(card.tryNext);
});

it('More details generates once and reopens the cached report across Back to chat and Stop', async () => {
  const h = harness(); await h.message('stopTutorConversation'); await h.message('reviewTutorConversation');
  await h.message('diagnoseTutorConversation');
  const saved = h.view.tutorState.diagnosticReport;
  expect(saved).toBeDefined();
  h.view.tutorState.diagnosticReportDrawerOpen = false;
  await h.message('diagnoseTutorConversation');
  expect(h.view.tutorState.diagnosticReportDrawerOpen).toBe(true);
  await h.message('resumeTutorConversation'); await h.message('stopTutorConversation');
  expect(h.view.tutorState.conversation.takeHome?.hidden).toBe(false);
  expect(h.view.tutorState.diagnosticReport).toBe(saved);
  await h.message('diagnoseTutorConversation');
  expect(h.generateTutor.mock.calls.map(([r]) => r.kind)).toEqual(['conversationTakeHome', 'conversationDiagnosis']);
});

it('a committed new answer drops stale results and the next Review covers all turns', async () => {
  const h = harness(); await h.message('stopTutorConversation'); await h.message('reviewTutorConversation');
  await h.message('diagnoseTutorConversation'); await h.message('resumeTutorConversation');
  completeStandardTutorTurn(h.view, tutorConversationTurn({ ...correction, replyQuote: '', reply: 'Thank you.', nextQuestion: 'What else?' }), 'Anything else?', 'I like coffee.', false);
  expect(h.view.tutorState.conversation.takeHome).toBeUndefined();
  expect(h.view.tutorState.diagnosticReport).toBeUndefined();
  await h.message('stopTutorConversation');
  expect(h.review().text()).toBe('Review now');
  expect(h.generateTutor).toHaveBeenCalledTimes(2);
  await h.message('reviewTutorConversation');
  expect(JSON.parse(h.generateTutor.mock.calls[2]![0].input).turns).toHaveLength(6);
});

it.each([1, 4, 5])('the switch off goes directly to More details with %i answers', async count => {
  const h = harness(count, false); await h.message('stopTutorConversation');
  expect(h.review().text()).toBe('More details');
  expect(h.review().is(':disabled')).toBe(count < 5);
  if (count < 5) expect(h.review().attr('title')).toBe('Needs five answered turns.');
  await h.message('diagnoseTutorConversation');
  expect(h.generateTutor.mock.calls.map(([r]) => r.kind)).toEqual(count < 5 ? [] : ['conversationDiagnosis']);
});

it('canceling a pending card returns to Review now and ignores its late response', async () => {
  const h = harness(); await h.message('stopTutorConversation');
  let finish!: (value: unknown) => void;
  h.generateTutor.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await h.message('reviewTutorConversation');
  const controller = h.view.tutorTakeHomeController!;
  await h.message('cancelTutorTakeHome');
  expect(controller.signal.aborted).toBe(true);
  finish(card); await flush();
  expect(h.review().text()).toBe('Review now');
  await h.message('resumeTutorConversation'); await h.message('stopTutorConversation');
  expect(h.generateTutor).toHaveBeenCalledOnce();
  await h.message('reviewTutorConversation');
  expect(h.view.tutorState.conversation.takeHome?.card).toEqual(card);
  expect(h.generateTutor).toHaveBeenCalledTimes(2);
});

it('failed cards retain Retry and Cancel, and Retry succeeds', async () => {
  const h = harness(); await h.message('stopTutorConversation');
  h.generateTutor.mockRejectedValueOnce(new Error('Failed request.'));
  await h.message('reviewTutorConversation');
  expect(h.panel().query('[data-command="retryTutorTakeHome"]')).toBeDefined();
  expect(h.panel().query('[data-command="cancelTutorTakeHome"]')).toBeDefined();
  await h.message('retryTutorTakeHome');
  expect(h.view.tutorState.conversation.takeHome?.card).toEqual(card);
});

it('duplicate Review and More details presses share their pending requests', async () => {
  const h = harness(); await h.message('stopTutorConversation');
  let finish!: (value: unknown) => void;
  h.generateTutor.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await h.message('reviewTutorConversation'); await h.message('reviewTutorConversation');
  expect(h.generateTutor).toHaveBeenCalledOnce();
  finish(card); await flush();
  h.generateTutor.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await h.message('diagnoseTutorConversation'); await h.message('diagnoseTutorConversation');
  expect(h.generateTutor).toHaveBeenCalledTimes(2);
  finish(report); await flush();
  expect(h.view.tutorState.diagnosticReport).toBeDefined();
});

it('Cancel hides a completed card and Review restores it without another request', async () => {
  const h = harness(); await h.message('stopTutorConversation'); await h.message('reviewTutorConversation');
  await h.message('diagnoseTutorConversation');
  const saved = h.view.tutorState.diagnosticReport;
  await h.message('cancelTutorTakeHome');
  expect(h.review().text()).toBe('Review now');
  await h.message('resumeTutorConversation'); await h.message('stopTutorConversation');
  expect(h.review().text()).toBe('Review now');
  await h.message('reviewTutorConversation');
  expect(h.view.tutorState.conversation.takeHome?.card).toEqual(card);
  expect(h.view.tutorState.diagnosticReport).toBe(saved);
  expect(h.generateTutor).toHaveBeenCalledTimes(2);
});

it.each(['empty', 'skipped', 'hidden'] as const)('Review needs learner evidence, excluding %s turns', async kind => {
  const h = harness(kind === 'empty' ? 0 : 5);
  for (const turn of h.view.tutorState.conversation.transcript) {
    if (kind === 'skipped') turn.skipped = true;
    if (kind === 'hidden') turn.learnerNotShown = true;
  }
  await h.message('stopTutorConversation');
  // Changed 2026-10-16: V247, owner item I28, both settings bridges remain available without learner evidence.
  expect(h.buttons().filter(':not([hidden])')).toHaveLength(4);
  await h.message('reviewTutorConversation');
  expect(h.generateTutor).not.toHaveBeenCalled();
});

it('take-home setting changes patch the stopped action in both directions', async () => {
  const h = harness(1); await h.message('stopTutorConversation'); const panel = h.panel();
  h.settings.tutorConversationTakeHome = false; h.view.refreshTutorTakeHomeSetting();
  expect(h.review().text()).toBe('More details');
  expect(h.review().attr('title')).toBe('Needs five answered turns.');
  h.settings.tutorConversationTakeHome = true; h.view.refreshTutorTakeHomeSetting();
  expect(h.review().text()).toBe('Review now');
  expect(h.review().is(':disabled')).toBe(false);
  expect(h.panel()).toBe(panel); expect(h.generateTutor).not.toHaveBeenCalled();
});

it('a failed report keeps the existing failure notice and can be retried', async () => {
  const h = harness(); await h.message('stopTutorConversation'); await h.message('reviewTutorConversation');
  h.generateTutor.mockRejectedValueOnce(new Error('Report failed.'));
  await h.message('diagnoseTutorConversation');
  expect(h.view.tutorState.diagnosticReportMessage).toMatch(/conversation analysis failed.*again/iu);
  expect(h.actions.log).toHaveBeenCalledWith(expect.stringMatching(/conversation diagnosis failed/iu));
  await h.message('diagnoseTutorConversation');
  expect(h.view.tutorState.diagnosticReport).toBeDefined();
  expect(h.generateTutor).toHaveBeenCalledTimes(3);
});

it('active in-place turn patches never add a diagnosis button', async () => {
  const h = harness(4); h.view.render(); const panel = h.panel();
  completeStandardTutorTurn(h.view, tutorConversationTurn({ ...correction, replyQuote: '', reply: 'Thank you.', nextQuestion: 'What else?' }), 'Anything else?', 'I like coffee.', false);
  await flush();
  expect(h.panel()).toBe(panel);
  expect(panel.query('[data-command="diagnoseTutorConversation"]')).toBeNull();
  expect(panel.query('[data-command="reviewTutorConversation"]')).toBeNull();
});
