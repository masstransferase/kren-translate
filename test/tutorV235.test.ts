// Changed 2026-10-18: V263, owner item I43, preserve the transcript in place because conversations have no answer box.
// 2026-10-14: Reproduce provider dialogue placement and consecutive recognized turns.
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn() }, window: {},
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { completeStandardTutorTurn } from '../src/resultsViewTurns.js';
import { replayTutorConversation } from '../src/resultsViewReplay.js';
import { TUTOR_MAP } from '@kren/core/tutor';
import { stopGeminiDictation } from '../src/resultsViewDictation.js';
import { tutorConversationTurn, type TutorStructuredGenerationRequest } from '../src/tutor/generation.js';
import { mountedPanel } from './support/mountedPanel.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const reply = 'All of them are pasteurized, including the oat milk.';
const nextQuestion = 'Would you like to see the oat milk aisle?';
const learner = 'Are they all pasteurized?';
const response = () => ({ move: 'reaction', reply, nextQuestion, replyQuote: '',
  correction: learner, targetId: '', explanation: 'This question is already natural.',
  rephrase: learner, rephraseWhy: 'This asks about all the milk.' });
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

function harness() {
  vi.useFakeTimers();
  let panel!: ReturnType<typeof mountedPanel>;
  let documents = 0;
  const requests: TutorStructuredGenerationRequest[] = [];
  const actions = { settings: () => ({ ...PANEL_SETTINGS_FIXTURE, tutorConversationTakeHome: false }),
    log: vi.fn(), notify: vi.fn(), stopReadAloud: vi.fn(), readAloudText: vi.fn(async (_text: string) => {}),
    writeTutorPreferences: vi.fn(), refreshReadAloudVoices: vi.fn(async () => {}),
    generateTutor: vi.fn(async (request: TutorStructuredGenerationRequest): Promise<unknown> => {
      requests.push(request); return response();
    }), transcribeTutorAudio: vi.fn(async () => learner) };
  const view = new KrenResultsViewProvider(actions as never, {} as never);
  const internals = view as unknown as { activeScreen: string; tutorSpeechHolds: number; handleMessage(message: unknown): Promise<void> };
  internals.activeScreen = 'tutor';
  Object.assign(view.tutorState.conversation, { status: 'active', busy: false, speakerOn: false,
    replies: 'standard', send: 'stopSpeaking', coaching: 'afterwards', situationPicture: 'none',
    currentQuestion: 'What kind of milk would you like?' });
  view.view = { visible: true, webview: { cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }),
    set html(value: string) { documents++; panel = mountedPanel(value, message => { void internals.handleMessage(message); }); },
    postMessage: vi.fn(async (message: Record<string, unknown>) => { panel.message(message); return true; }) } } as never;
  view.render();
  // Hold the existing document so every state change exercises the real in-place patch.
  internals.tutorSpeechHolds = 1;
  const recognize = async (text: string) => {
    actions.transcribeTutorAudio.mockResolvedValueOnce(text);
    view.geminiRecording = { finish: async (consume: Function) => consume(new Uint8Array([0]),
      { sampleRate: 16000, channels: 1, bitsPerSample: 16 }) } as never;
    await stopGeminiDictation(view, { conversation: true }); await flush();
  };
  return { view, actions, requests, internals, recognize, panel: () => panel, documents: () => documents };
}

it('V239 R3 invalidates a five-turn diagnosis when Back to chat archives a failed spoken answer', async () => {
  const h = harness(); const panel = h.panel();
  for (let index = 0; index < 5; index++) {
    completeStandardTutorTurn(h.view, tutorConversationTurn(response()), h.view.tutorState.conversation.currentQuestion, learner, true);
  }
  await h.internals.handleMessage({ command: 'stopTutorConversation' }); await flush();
  const target = TUTOR_MAP.find(node => !TUTOR_MAP.some(child => child.parentId === node.id))!;
  h.actions.generateTutor.mockResolvedValueOnce({ targets: [{ targetId: target.id, role: 'primary' }],
    summary: 'You ask about milk.', findings: [{ level: 2, observation: 'You ask a clear question.', evidence: learner, targetId: target.id }],
    focus: 'Practice questions.' });
  await h.internals.handleMessage({ command: 'diagnoseTutorConversation' }); await flush();
  expect(h.view.tutorState.diagnosticReportSource).toEqual({ kind: 'conversation', turnCount: 5 });
  expect(h.view.tutorState.diagnosticReport).toBeDefined();
  await h.internals.handleMessage({ command: 'resumeTutorConversation' }); await flush();
  h.actions.generateTutor.mockRejectedValueOnce(new Error('The next reply request failed.'));
  await h.recognize('did you catch my question at all');
  expect(h.view.tutorState.conversation.transcript).toHaveLength(6);
  expect(h.view.tutorState.conversation.transcript[5]).toMatchObject({ spoken: true, coachingFailed: true });
  expect(h.view.tutorConversationRawAnswers.get(5)).toBe('did you catch my question at all');
  expect.soft(h.view.tutorState.diagnosticReport).toBeUndefined();
  expect.soft(h.view.tutorState.diagnosticReportSource).toBeUndefined();
  expect.soft(h.view.tutorState.diagnosticReportDrawerOpen).toBe(false);
  expect.soft(h.view.tutorState.diagnosticReportMessage).toMatch(/conversation changed.*diagnose.*again/iu);
  expect(h.panel()).toBe(panel); expect(h.documents()).toBe(1);
  const calls = h.actions.generateTutor.mock.calls.length;
  await h.internals.handleMessage({ command: 'applyTutorDiagnosticReport' }); await flush();
  expect.soft(h.actions.generateTutor).toHaveBeenCalledTimes(calls);
});

it('V239 R4 replays the stopped visible dialogue including intermediate replies and the trailing question once', async () => {
  for (const move of ['reaction', undefined, 'unknown-move']) {
    const h = harness(); const panel = h.panel();
    const firstQuestion = h.view.tutorState.conversation.currentQuestion;
    completeStandardTutorTurn(h.view, tutorConversationTurn({ ...response(), move }), firstQuestion, learner, false);
    const secondAnswer = 'Yes, please.';
    const lastReply = 'Here is the oat milk aisle.';
    const trailing = 'Would you like anything else?';
    completeStandardTutorTurn(h.view, tutorConversationTurn({ ...response(), move, reply: lastReply,
      correction: secondAnswer, nextQuestion: trailing }), nextQuestion, secondAnswer, false);
    await h.internals.handleMessage({ command: 'stopTutorConversation' }); await flush();
    h.view.tutorState.conversation.speakerOn = true;
    h.actions.readAloudText.mockClear();
    replayTutorConversation(h.view); await flush();
    const expected = [firstQuestion, learner, reply, nextQuestion, secondAnswer, lastReply, trailing];
    const transcript = panel.query('[data-tutor-transcript]')!;
    const dialogue = transcript.querySelectorAll('[data-tutor-kren-bubble] p, [data-tutor-learner-answer]').map(element => element.textContent);
    expect.soft(dialogue).toEqual(expected);
    expect.soft(h.actions.readAloudText.mock.calls.map(call => call[0])).toEqual(expected);
    // A reply reused as the next question is one balloon and one reading.
    h.view.tutorState.conversation.transcript[1]!.question = reply;
    h.view.tutorState.conversation.transcript[1]!.reply = 'Yes, I would.';
    h.view.tutorState.conversation.transcript[1]!.correction = 'Yes, I would.';
    h.view.render(); await flush();
    h.actions.readAloudText.mockClear();
    replayTutorConversation(h.view); await flush();
    // The learner hears the corrected version of their answer, as Replay did before V239.
    expect.soft(h.actions.readAloudText.mock.calls.map(call => call[0])).toEqual([firstQuestion, learner, reply, 'Yes, I would.', trailing]);
    expect(h.panel()).toBe(panel); expect(h.documents()).toBe(1);
  }
});

it('V235 1.1 keeps a provider reply before its next question as reachable KREN dialogue, including after Stop', async () => {
  // Changed 2026-10-14: The owner retains the correction-text exception and preserves replies for either missing or unknown moves.
  for (const shape of [response(), { ...response(), move: undefined },
    { ...response(), move: 'unrecognised-fifth-move' }]) {
    const h = harness(); const panel = h.panel();
    const answer = panel.query('[data-tutor-transcript]');
    completeStandardTutorTurn(h.view, tutorConversationTurn(shape), h.view.tutorState.conversation.currentQuestion, learner, true);
    h.view.render(); await flush();
    for (const status of ['active', 'stopped'] as const) {
      h.view.tutorState.conversation.status = status; h.view.render(); await flush();
      const transcript = panel.query('[data-tutor-transcript]')!;
      const replyBubbles = transcript.querySelectorAll('[data-tutor-kren-bubble]').filter(b => b.textContent.includes(reply));
      expect.soft(replyBubbles).toHaveLength(1);
      expect.soft(replyBubbles[0]?.getAttribute('aria-label')).toBe('KREN');
      expect.soft(replyBubbles[0]?.closest('details')).toBeNull();
      expect.soft(replyBubbles[0]?.hidden).toBe(false);
      expect.soft(transcript.querySelector('[data-tutor-learner-turn="0"]')!.textContent).not.toContain(reply);
      expect.soft(transcript.textContent.indexOf(reply)).toBeGreaterThan(transcript.textContent.indexOf(learner));
      expect.soft(transcript.textContent.indexOf(nextQuestion)).toBeGreaterThan(transcript.textContent.indexOf(reply));
      // 2026-10-14: Stop removes the composer; preserve its identity only while active.
      if (status === 'active') expect(panel.query('[data-tutor-transcript]')).toBe(answer);
    }
    expect(h.panel()).toBe(panel); expect(h.documents()).toBe(1);
    expect(h.view.tutorState.conversation.currentQuestion).toBe(nextQuestion);
  }
});

it('V242 shows and speaks the reply question once through the in-place patch and stopped Replay', async () => {
  for (const move of ['reaction', undefined, 'unknown-move']) {
    const h = harness(); const panel = h.panel();
    const answer = panel.query('[data-tutor-transcript]');
    const firstQuestion = h.view.tutorState.conversation.currentQuestion;
    const replyQuestion = 'Do you have a preferred brand or just need any organic oat milk?';
    const duplicate = 'DO YOU HAVE A PREFERRED BRAND OR JUST NEED ANY ORGANIC OAT MILK?';
    h.view.tutorState.conversation.speakerOn = true;
    completeStandardTutorTurn(h.view, tutorConversationTurn({ ...response(), move,
      reply: replyQuestion, nextQuestion: duplicate }), firstQuestion, learner, false);
    await flush();
    expect(h.view.tutorState.conversation.currentQuestion).toBe(replyQuestion);
    expect(h.view.tutorState.conversation.transcript[0]).not.toHaveProperty('nextQuestion');
    expect(h.actions.readAloudText.mock.calls.map(call => call[0])).toEqual([replyQuestion]);
    const expected = [firstQuestion, learner, replyQuestion];
    const dialogue = () => panel.query('[data-tutor-transcript]')!
      .querySelectorAll('[data-tutor-kren-bubble] p, [data-tutor-learner-answer]').map(element => element.textContent);
    expect(dialogue()).toEqual(expected);
    const bubble = panel.query('[data-tutor-transcript]')!.querySelectorAll('[data-tutor-kren-bubble]')
      .find(element => element.textContent.includes(replyQuestion))!;
    expect(bubble.closest('details')).toBeNull();
    expect(bubble.hidden).toBe(false);
    expect(panel.query('[data-tutor-transcript]')).toBe(answer);
    await h.internals.handleMessage({ command: 'stopTutorConversation' }); await flush();
    expect(dialogue()).toEqual(expected);
    h.actions.readAloudText.mockClear();
    replayTutorConversation(h.view); await flush();
    expect(h.actions.readAloudText.mock.calls.map(call => call[0])).toEqual(expected);
    expect(h.panel()).toBe(panel); expect(h.documents()).toBe(1);
  }
});

it('V235 1.2 keeps two recognized answers as separate learner turns when the first reply request fails', async () => {
  const h = harness(); const panel = h.panel(); const answer = panel.query('[data-tutor-transcript]')!;
  const first = 'did you catch my question at all';
  const second = 'are they all pasteurized';
  let reject!: (reason: Error) => void;
  h.actions.generateTutor.mockImplementationOnce(async request => {
    h.requests.push(request); return new Promise((_resolve, fail) => { reject = fail; });
  });
  await h.recognize(first);
  expect(panel.query('[data-tutor-pending] [data-tutor-learner-answer]')!.textContent).toBe('Did you catch my question at all?');
  reject(new Error('The conversation request failed.')); await flush();
  expect.soft(panel.query('[data-tutor-learner-turn="0"] [data-tutor-learner-answer]')?.textContent).toBe('Did you catch my question at all?');
  expect.soft(h.view.tutorState.conversation.draftAnswer).toBe('');
  expect.soft(panel.query('[data-tutor-conversation-answer]')).toBeNull();
  await h.recognize(second);
  expect.soft(h.requests.map(request => JSON.parse(request.input).learnerAnswer)).toEqual([first, second]);
  expect.soft(panel.query('[data-tutor-transcript]')!.querySelectorAll('[data-tutor-learner-answer]').map(b => b.textContent))
    .toEqual(['Did you catch my question at all?', 'Are they all pasteurized?']);
  expect.soft(h.view.tutorState.conversation.transcript.map(turn => turn.spoken)).toEqual([true, true]);
  h.view.render(); await flush();
  expect.soft(panel.query('[data-tutor-transcript]')!.querySelectorAll('[data-tutor-learner-answer]')).toHaveLength(2);
  expect(h.panel()).toBe(panel); expect(h.documents()).toBe(1);
  expect(panel.query('[data-tutor-transcript]')).toBe(answer);
  // Two successful recognized turns also stay separate, even when their words repeat.
  await h.recognize(second);
  expect(h.requests.map(request => JSON.parse(request.input).learnerAnswer)).toEqual([first, second, second]);
  expect(panel.query('[data-tutor-transcript]')!.querySelectorAll('[data-tutor-learner-answer]').map(b => b.textContent))
    .toEqual(['Did you catch my question at all?', 'Are they all pasteurized?', 'Are they all pasteurized?']);
  // Typed failures still restore the editable draft for retry.
  h.actions.generateTutor.mockRejectedValueOnce(new Error('The typed request failed.'));
  await h.internals.handleMessage({ command: 'updateTutorConversationAnswer', answer: 'Typed answer.', spoken: false });
  await h.internals.handleMessage({ command: 'submitTutorConversationTurn' }); await flush();
  expect(h.view.tutorState.conversation.draftAnswer).toBe('Typed answer.');
  expect(h.view.tutorState.conversation.draftAnswerSpoken).toBe(false);
});
