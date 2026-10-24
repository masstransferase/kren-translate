import { afterEach, describe, expect, it, vi } from 'vitest';
import { load } from 'cheerio';

vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn() }, window: {}, env: {},
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));

import { KrenResultsViewProvider } from '../src/resultsView.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { tutorConversationCoachOpening, tutorConversationTurnRequest, tutorConversationCoachingRequest,
  tutorConversationLiveSystemInstruction, tutorConversationTurn, TUTOR_CORRECTION_CLAUSE,
  TUTOR_CONVERSATION_MEANING_INSTRUCTION, TUTOR_CONVERSATION_REPHRASE_INSTRUCTION,
  TUTOR_SPOKEN_PUNCTUATION_INSTRUCTION, type TutorStructuredGenerationRequest } from '../src/tutor/generation.js';
import { createTutorViewState, tutorConversationPreferences, tutorConversationPreferencesOf } from '../src/tutor/state.js';
import { startTutorConversation } from '../src/resultsViewConversation.js';
import { submitTutorConversationTurn, stopTutorConversation, retryTutorTurnCheck } from '../src/resultsViewTurns.js';
import { beginTutorLiveSpokenReply, completeTutorLiveSpokenTurn, tutorConversationSetting } from '../src/resultsViewLive.js';
import { replayTutorQuestion, replayTutorConversation } from '../src/resultsViewReplay.js';
import { writeTutorConversationHint, scheduleTutorConversationHintPrefetch } from '../src/resultsViewHints.js';
import { tutorTakeHomeInput } from '../src/resultsViewTakeHome.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';
import { assertTutorCoachInstruction } from './support/tutorCoachChecks.js';

const learnerAnswer = 'i go there yesterday';
// Changed 2026-10-18: V263, owner item I40, the fixture speaks a complete coaching paragraph.
const response = { move: 'reaction', reply: 'You\'d say "I went there yesterday.", because it happened in the past. For the focus on being there, say "I was there yesterday.", or use "I visited yesterday." for a shorter form.',
  replyQuote: '', correction: 'I went there yesterday.', targetId: '', explanation: 'Use the past tense for yesterday.',
  rephrase: 'I was there yesterday.', rephraseWhy: 'This puts the focus on being there.', spokenPunctuated: 'I go there yesterday.',
  alternatives: [{ text: 'I went there yesterday.', why: 'This emphasizes the trip.' },
    { text: 'I visited yesterday.', why: 'This is shorter when the place is understood.' }] };
const flush = async () => { for (let i = 0; i < 120; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

function harness(stored: unknown = { from: 'speakAndRephrase' }) {
  vi.useFakeTimers();
  const settings = { ...PANEL_SETTINGS_FIXTURE, tutorReadAloudProvider: 'edgeOnline' as const,
    tutorConversationTakeHome: true, tutorConversationHintPrefetch: true };
  const requests: TutorStructuredGenerationRequest[] = [];
  const actions = { settings: () => settings, log: vi.fn(), notify: vi.fn(), stopReadAloud: vi.fn(),
    updateSetting: vi.fn(async () => {}),
    refreshReadAloudVoices: vi.fn(async () => {}), readTutorPreferences: () => stored,
    writeTutorPreferences: vi.fn(), readAloudText: vi.fn(async (_text: string) => {}),
    generateTutor: vi.fn(async (request: TutorStructuredGenerationRequest): Promise<unknown> => {
      requests.push(request);
      if (request.kind === 'conversationTakeHome') return { naturally: [], doneWell: [], tryNext: 'Try describing a plan for tomorrow.' };
      if (request.kind === 'conversationDiagnosis') return { summary: 'Your meaning is clear.', findings: [], targets: [], focus: 'Keep practicing spoken phrasing.' };
      if (request.kind === 'liveSessionCredential') throw new Error('Live credential unavailable in this test.');
      return response;
    }) };
  const view = new KrenResultsViewProvider(actions as never, {} as never);
  const internals = view as any;
  internals.activeScreen = 'tutor';
  Object.assign(view.tutorState.conversation, { status: 'idle', replies: 'standard', speakerOn: false,
    situationId: 'custom', customSituation: '', starts: 'learner', rolesSwapped: true,
    coaching: 'afterwards', replyLength: 'long', situationPicture: 'intro', openModeAfterRender: true });
  let panel!: ReturnType<typeof mountedPanel>;
  const messages: Record<string, unknown>[] = [];
  view.view = { visible: true, webview: { cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }),
    set html(value: string) { panel = mountedPanel(value, () => {}); },
    postMessage: async (message: Record<string, unknown>) => { messages.push(message); panel.message(message); return true; } } } as never;
  view.render();
  return { view, internals, actions, settings, requests, messages, panel: () => panel };
}

function requestForCoach() {
  return tutorConversationTurnRequest({ coach: true, register: 'neutral', recipeTargets: { supportingTargets: [] },
    transcript: [{ ...tutorConversationTurn(response), question: 'Try a sentence.', learnerAnswer: 'I go there yesterday.' }],
    question: 'An invitation, not a role-play question.', learnerAnswer, spoken: true,
    setting: 'Ignored stored situation.', tutorRole: 'Manager', learnerRole: 'Customer', rolesSwapped: true,
    learnerStarts: true, teaching: true, coaching: 'afterwards', replyLength: 'long' });
}

describe('V262 Speak and rephrase', () => {
  it('stores and validates Source with the conversation preferences', () => {
    expect(tutorConversationPreferences({ from: 'speakAndRephrase' })).toEqual({ from: 'speakAndRephrase' });
    for (const from of ['', 'coach', 1, null]) expect(tutorConversationPreferences({ from })).toEqual({});
    const h = harness();
    expect(h.view.tutorState.conversation.from).toBe('speakAndRephrase');
    expect(tutorConversationPreferencesOf(h.view.tutorState.conversation).from).toBe('speakAndRephrase');
  });

  it('offers the Source and explains exactly eight disabled MODE controls without hiding Start', () => {
    const h = harness();
    const panel = h.panel();
    const source = panel.query('[data-tutor-conversation-from]')!;
    expect(source.querySelector('option[value="speakAndRephrase"]')?.textContent).toBe('Speak and rephrase');
    // Changed 2026-10-17: V262, owner item I39, first open folds MODE; verify its native disclosure makes Source reachable.
    const mode = source.closest('details')!;
    const summary = mode.querySelector('summary')!;
    expect(summary.textContent).toContain('MODE');
    expect(summary.closest('[hidden]')).toBeNull();
    expect(summary.getAttribute('tabindex')).not.toBe('-1');
    mode.open = true;
    panel.event(mode, 'toggle');
    expect(source.closest('details')?.open).toBe(true);
    expect(source.closest('details:not([open]), [hidden]')).toBeNull();
    expect(source.disabled).toBe(false);
    expect(source.getAttribute('tabindex')).not.toBe('-1');
    const unused = panel.document.querySelectorAll('[data-tutor-coach-unused]');
    expect(unused).toHaveLength(8);
    expect([...unused].map(row => row.querySelector('.setting-title')?.textContent)).toEqual([
      // Changed 2026-10-24 (V309, owner I80): Situation picture now sits in MODE, before ADVANCED's Reply length.
      'Situation', 'Swap roles', 'Who starts', 'Correction', 'Situation picture', 'Reply length', 'Picture style', 'Picture transparency'
    ]);
    for (const row of unused) {
      expect(row.querySelector('select, input')?.disabled).toBe(true);
      expect(row.querySelector('.setting-description')?.textContent).toBe('Not used in Speak and rephrase.');
    }
    for (const selector of ['[data-tutor-conversation-register]', '[data-tutor-conversation-replies]']) {
      expect(panel.query(selector)?.disabled).toBe(false);
    }
    // Changed 2026-10-18: V263, owner item I43, automatic submission removes the Send row.
    expect(panel.query('[data-tutor-conversation-send]')).toBeNull();
    const start = panel.query('[data-command="startTutorConversation"]')!;
    expect(start.closest('details:not([open]), [hidden]')).toBeNull();
    expect(start.disabled).toBe(false);
    expect(panel.query('[data-command="startTutorConversationDemo"]')).toBeNull();
    expect(panel.query('[data-setting="tutor.conversation.hintPrefetch"]')?.closest('[hidden]')).not.toBeNull();
  });

  it('selects Source through its command and restores all unused choices after switching back', async () => {
    const h = harness({ from: 'anything' });
    // Changed 2026-10-17: V262, owner item I39, Demo returns only when the saved situation is valid.
    h.view.tutorState.conversation.customSituation = 'Two coworkers plan a meeting.';
    const before = { ...h.view.tutorState.conversation };
    await h.internals.handleMessage({ command: 'updateTutorConversationFrom', input: 'speakAndRephrase' });
    expect(h.view.tutorState.conversation.from).toBe('speakAndRephrase');
    expect(h.actions.writeTutorPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ from: 'speakAndRephrase' }));
    expect(h.panel().query('[data-tutor-conversation-starts]')?.disabled).toBe(true);
    await h.internals.handleMessage({ command: 'updateTutorConversationFrom', input: 'situation' });
    for (const key of ['situationId', 'customSituation', 'rolesSwapped', 'starts', 'coaching', 'replyLength', 'situationPicture', 'pictureTransparency'] as const) {
      expect(h.view.tutorState.conversation[key]).toEqual(before[key]);
    }
    expect(h.panel().query('[data-tutor-conversation-starts]')?.disabled).toBe(false);
    expect(h.panel().query('[data-tutor-conversation-coaching]')?.disabled).toBe(false);
    expect(h.panel().query('[data-command="startTutorConversationDemo"]')).not.toBeNull();
  });

  it.each(['casual', 'neutral', 'professional', 'formal'] as const)('has three local invitations in the %s register', register => {
    const invitations = [0, 0.4, 0.99].map(draw => tutorConversationCoachOpening(register, () => draw));
    expect(new Set(invitations).size).toBe(3);
    for (const invitation of invitations) expect(invitation).toMatch(/English/u);
    if (register === 'formal') for (const invitation of invitations) expect(invitation).not.toMatch(/I'll|let's|Hey/u);
  });

  it('ignores commands for unavailable coach controls and keeps their stored values', async () => {
    const h = harness();
    const before = { ...h.view.tutorState.conversation };
    for (const [command, input] of [
      ['updateTutorConversationSituation', 'auto'], ['updateTutorConversationCustom', 'A different scene.'],
      ['updateTutorConversationRoleSwapped', 'false'], ['updateTutorConversationStarts', 'kren'],
      ['updateTutorConversationCoaching', 'inline'], ['updateTutorConversationReplyLength', 'brief'],
      ['updateTutorConversationSituationPicture', 'none'], ['updateTutorConversationPictureTransparency', '20'],
      ['hintTutorConversation', ''], ['startTutorConversationDemo', ''], ['skipTutorConversationTurn', '']
    ]) await h.internals.handleMessage({ command, input });
    await h.internals.handleMessage({ command: 'updateSetting', key: 'tutor.conversation.pictureStyle', value: 'illustrated' });
    await h.internals.handleMessage({ command: 'updateSetting', key: 'tutor.conversation.hintPrefetch', value: false });
    expect(h.view.tutorState.conversation).toEqual(before);
    expect(h.actions.updateSetting).not.toHaveBeenCalled();
    expect(h.actions.generateTutor).not.toHaveBeenCalled();
    expect(h.actions.writeTutorPreferences).not.toHaveBeenCalled();
  });

  it('always opens locally even when the saved situation is empty and the learner used to start', async () => {
    const h = harness();
    startTutorConversation(h.view); await flush();
    expect(h.view.tutorState.conversation).toMatchObject({ status: 'active', busy: false, starts: 'learner' });
    expect(h.view.tutorState.conversation.currentQuestion).toMatch(/English/u);
    expect(h.actions.generateTutor).not.toHaveBeenCalled();
    expect(h.panel().query('[data-tutor-kren-bubble]')?.textContent).toMatch(/English/u);
    expect(h.panel().query('[data-command="hintTutorConversation"]')).toBeNull();
    expect(h.panel().query('[data-tutor-conversation-register]')?.disabled).toBe(false);
    expect(h.panel().query('[data-tutor-conversation-replies]')?.disabled).toBe(false);
  });

  it('opens Live with a local invitation and only the existing credential setup request', async () => {
    const h = harness();
    // Changed 2026-10-23 (V304, owner I75): the invitation test starts with a stored Live key.
    Object.assign(h.settings, { credentialPresence: { geminiDefault: true } });
    h.view.tutorState.conversation.replies = 'liveGemini';
    startTutorConversation(h.view); await flush();
    expect(h.view.tutorState.conversation.currentQuestion).toMatch(/English/u);
    expect(h.requests.map(request => request.kind)).toEqual(['liveSessionCredential']);
    expect(h.view.tutorState.conversation.busy).toBe(false);
  });

  it('requests conversational coaching and the shared rules once, without role-play input', () => {
    const request = requestForCoach();
    assertTutorCoachInstruction(request.instruction);
    for (const clause of [TUTOR_CORRECTION_CLAUSE, TUTOR_CONVERSATION_MEANING_INSTRUCTION,
      TUTOR_CONVERSATION_REPHRASE_INSTRUCTION, TUTOR_SPOKEN_PUNCTUATION_INSTRUCTION]) {
      expect(request.instruction.split(clause)).toHaveLength(2);
    }
    const input = JSON.parse(request.input);
    expect(input).toMatchObject({ coach: true, learnerAnswer, register: 'neutral', spoken: true });
    expect(input.transcript).toEqual([{ learnerAnswer: 'I go there yesterday.' }]);
    for (const field of ['setting', 'question', 'tutorRole', 'learnerRole', 'rolesSwapped', 'learnerStarts', 'replyLength', 'coaching', 'lessonContext']) {
      expect(input).not.toHaveProperty(field);
    }
    // Changed 2026-10-18: V263, owner item I40, one or two usable expressions fit a paragraph.
    expect((request.schema.properties as any).alternatives).toMatchObject({ type: 'array', minItems: 1, maxItems: 2 });
  });

  it('shares the coach instruction with Live and keeps its per-turn coaching request', () => {
    const request = requestForCoach();
    expect(tutorConversationCoachingRequest(request)).toBe(request);
    const instruction = tutorConversationLiveSystemInstruction({ coach: true, kind: 'anything', register: 'formal',
      sceneSlant: 'the counterpart is friendly and curious', learnerStarts: true, replyLength: 'long' }, true);
    assertTutorCoachInstruction(instruction);
    expect(instruction).toContain(TUTOR_CONVERSATION_REPHRASE_INSTRUCTION);
    expect(instruction).toContain('The selected register is formal');
    expect(instruction).not.toContain('answer each learner turn naturally in character');
  });

  it.each([false, true])('sends one turn request, highlights the coaching paragraph, and speaks it in full, spoken=%s', async spoken => {
    const h = harness(); startTutorConversation(h.view); await flush();
    h.view.tutorState.conversation.speakerOn = true;
    h.view.tutorState.conversation.draftAnswer = learnerAnswer;
    submitTutorConversationTurn(h.view, spoken ? learnerAnswer : undefined); await flush();
    expect(h.requests.filter(request => request.kind === 'conversationTurn')).toHaveLength(1);
    expect(h.view.tutorState.conversation.transcript[0]).toMatchObject({ correction: response.correction,
      rephrase: response.rephrase, alternatives: response.alternatives,
      learnerAnswer: spoken ? response.spokenPunctuated : learnerAnswer });
    // Changed 2026-10-18: V263, owner items I40 and I41, the paragraph replaces the learner feedback block.
    const paragraph = h.panel().query('[data-tutor-reply-bubble]')!;
    expect(paragraph.closest('[hidden], details:not([open])')).toBeNull();
    expect(paragraph.textContent).toContain(response.correction);
    expect(paragraph.textContent).toContain(response.rephrase);
    expect(h.view.tutorState.conversation.transcript[0]?.rephraseWhy).toBe(response.rephraseWhy);
    expect(paragraph.querySelectorAll('.tutor-review-corrected')).toHaveLength(3);
    expect(h.panel().document.querySelectorAll('[data-tutor-turn-feedback]')).toHaveLength(0);
    expect(h.actions.readAloudText.mock.calls.map(call => call[0])).toEqual([response.reply]);
    h.actions.readAloudText.mockClear(); replayTutorQuestion(h.view); await flush();
    expect(h.actions.readAloudText.mock.calls.map(call => call[0])).toEqual([response.reply]);
  });

  // Changed 2026-10-17: V262, owner item I39, wrap each array so Vitest passes it as one alternatives value.
  it.each([
    { name: 'missing', alternatives: undefined },
    { name: 'empty', alternatives: [] },
    { name: 'one', alternatives: response.alternatives.slice(0, 1) },
    { name: 'one readable', alternatives: [{ text: 'Readable', why: '' }, response.alternatives[0]] }
  ])('salvages structured details and logs only when no usable expressions remain: $name', async ({ alternatives }) => {
      const h = harness(); startTutorConversation(h.view); await flush();
      // Changed 2026-10-17: V262, owner item I39, keep request capture when replacing the provider response.
      h.actions.generateTutor.mockImplementationOnce(async request => {
        h.requests.push(request);
        return { ...response, alternatives };
      });
      submitTutorConversationTurn(h.view, learnerAnswer); await flush();
      expect(h.view.tutorState.conversation.transcript).toHaveLength(1);
      // Changed 2026-10-18: V263, owner item I40, retain structured details with no feedback block, accepting one usable item.
      expect(h.view.tutorState.conversation.transcript[0]?.correction).toBe(response.correction);
      expect(h.view.tutorState.conversation.transcript[0]?.rephrase).toBe(response.rephrase);
      expect(h.panel().query('[data-tutor-turn-feedback]')).toBeNull();
      const lines = h.actions.log.mock.calls.map(([line]) => String(line)).filter(line => line.includes('coach alternatives check failed'));
      expect(lines).toHaveLength(alternatives?.length ? 0 : 1);
      for (const text of [learnerAnswer, response.correction, response.rephrase, response.reply]) expect(lines.join(' ')).not.toContain(text);
      expect(h.requests).toHaveLength(1);
    });

  it('runs per-turn Live coaching despite the stored When you stop value and patches the mounted composer', async () => {
    const h = harness(); startTutorConversation(h.view); await flush();
    Object.assign(h.view.tutorState.conversation, { replies: 'liveGemini', coaching: 'afterwards' });
    h.view.tutorLiveSession = { sendNote: vi.fn(), takeHandoff: () => undefined } as never;
    h.view.tutorLiveInputText = learnerAnswer;
    // Changed 2026-10-18: V263, owner item I43, in-place updates retain the transcript rather than a text box.
    const transcript = h.panel().query('[data-tutor-transcript]');
    h.panel().message({ command: 'tutorLiveInputFragment', text: learnerAnswer, reset: true });
    beginTutorLiveSpokenReply(h.view, true);
    const turn = h.view.tutorLiveSpokenTurn!;
    expect(turn.coaching).toBeDefined();
    h.view.tutorLiveReplyText = response.reply;
    h.panel().message({ command: 'tutorLiveReplyFragment', text: response.reply, reset: true });
    await completeTutorLiveSpokenTurn(h.view, turn); await flush();
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]!.schemaName).toBe('kren_tutor_conversation_coach');
    expect(h.view.tutorState.conversation.transcript[0]).toMatchObject({ reply: response.reply, alternatives: response.alternatives,
      learnerAnswer: response.spokenPunctuated, coachingPending: undefined });
    // Changed 2026-10-18: V263, owner items I40 and I41, Live posts safe highlight ranges instead of feedback markup.
    expect(h.messages.some(message => message.command === 'tutorLiveTurnCoaching' && Array.isArray(message.coachReplyRanges))).toBe(true);
    expect(h.panel().query('[data-tutor-transcript]')).toBe(transcript);
    expect(h.panel().query('[data-tutor-reply-bubble]')?.textContent).toContain(response.rephrase);
    expect(h.panel().document.querySelectorAll('.tutor-review-corrected')).toHaveLength(3);
    expect(h.actions.readAloudText).not.toHaveBeenCalled();
  });

  it('uses one per-turn coaching request for a typed Live turn too', async () => {
    const h = harness(); startTutorConversation(h.view); await flush();
    h.view.tutorState.conversation.replies = 'liveGemini';
    h.view.tutorState.conversation.draftAnswer = learnerAnswer;
    h.view.tutorLiveSession = { takeHandoff: () => undefined, sendTurn: vi.fn(async () => {
      h.view.tutorLiveReplyText = response.reply;
      h.panel().message({ command: 'tutorLiveReplyFragment', text: response.reply, reset: true });
    }) } as never;
    submitTutorConversationTurn(h.view); await flush();
    expect(h.requests).toHaveLength(1);
    expect(h.view.tutorState.conversation.transcript[0]).toMatchObject({ reply: response.reply, alternatives: response.alternatives });
    // Changed 2026-10-18: V263, owner item I40, internal Live submissions show only the coaching paragraph.
    expect(h.panel().query('[data-tutor-reply-bubble]')?.textContent).toContain(response.rephrase);
  });

  it('offers no hint request or prefetch even if the stored prefetch preference is on', async () => {
    const h = harness(); startTutorConversation(h.view); await flush();
    scheduleTutorConversationHintPrefetch(h.view);
    await writeTutorConversationHint(h.view);
    await vi.advanceTimersByTimeAsync(10000);
    expect(h.actions.generateTutor).not.toHaveBeenCalled();
    expect(h.view.tutorConversationHintPrefetchTimer).toBeUndefined();
  });

  it('retries a failed coach check through the same validator and restores alternatives', async () => {
    const h = harness(); startTutorConversation(h.view); await flush();
    h.view.tutorState.conversation.transcript = [{ question: h.view.tutorState.conversation.currentQuestion,
      learnerAnswer, correction: '', explanation: '', coachingFailed: true, spoken: true }];
    h.view.render();
    await retryTutorTurnCheck(h.view, 0); await flush();
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]!.retry).toBe(true);
    expect(h.view.tutorState.conversation.transcript[0]).toMatchObject({ correction: response.correction, alternatives: response.alternatives });
    // Changed 2026-10-18: V263, owner item I40, Retry preserves structured expressions for review.
    expect(h.view.tutorState.conversation.transcript[0]?.alternatives).toEqual(response.alternatives);
    expect(h.panel().query('[data-tutor-reply-bubble]')?.textContent).toBe(response.reply);
  });

  it('keeps Review now and More details after Stop with corrections, rephrases, and no situation', async () => {
    const h = harness(); startTutorConversation(h.view); await flush();
    for (let i = 0; i < 5; i++) { submitTutorConversationTurn(h.view, learnerAnswer); await flush(); }
    await stopTutorConversation(h.view); await flush();
    const review = h.panel().query('[data-command="reviewTutorConversation"]')!;
    expect(review.disabled).toBe(false);
    expect(review.closest('[hidden], details:not([open])')).toBeNull();
    const input = tutorTakeHomeInput(h.view);
    expect(input.turns[0]).toMatchObject({ learnerAnswer, correction: response.correction, rephrase: response.rephrase });
    expect(input.source).toBe('speakAndRephrase');
    expect(input.turns[0]).not.toHaveProperty('question');
    expect(input.turns[0]).not.toHaveProperty('reply');
    expect(input).not.toHaveProperty('setting');
    expect(input).not.toHaveProperty('lessonContext');
    expect(tutorConversationSetting(h.view.tutorState.conversation)).toBeUndefined();
    await h.internals.handleMessage({ command: 'reviewTutorConversation' }); await flush();
    expect(h.requests.filter(request => request.kind === 'conversationTakeHome')).toHaveLength(1);
    expect(h.panel().query('[data-command="diagnoseTutorConversation"]')?.disabled).toBe(false);
    await h.internals.handleMessage({ command: 'diagnoseTutorConversation' }); await flush();
    const diagnostic = h.requests.find(request => request.kind === 'conversationDiagnosis')!;
    expect(JSON.parse(diagnostic.input)[0]).toMatchObject({ learnerAnswer, correction: response.correction, rephrase: response.rephrase });
    expect(JSON.parse(diagnostic.input)[0]).not.toHaveProperty('question');
    expect(h.view.tutorState.diagnosticReport).toMatchObject({ summary: 'Your meaning is clear.' });
  });

  it('keeps the five-turn diagnostic threshold', async () => {
    const h = harness(); startTutorConversation(h.view); await flush();
    submitTutorConversationTurn(h.view, learnerAnswer); await flush();
    await stopTutorConversation(h.view); await flush();
    await h.internals.handleMessage({ command: 'reviewTutorConversation' }); await flush();
    expect(h.panel().query('[data-command="diagnoseTutorConversation"]')?.disabled).toBe(true);
  });

  it('replays learner words and KREN replies without reading the written details', async () => {
    const h = harness(); startTutorConversation(h.view); await flush();
    h.view.tutorState.conversation.draftAnswer = learnerAnswer;
    submitTutorConversationTurn(h.view); await flush();
    await stopTutorConversation(h.view); await flush();
    h.view.tutorState.conversation.speakerOn = true;
    replayTutorConversation(h.view); await flush();
    const spoken = h.actions.readAloudText.mock.calls.map(call => call[0]);
    expect(spoken).toContain(learnerAnswer);
    expect(spoken).toContain(response.reply);
    for (const text of [response.correction, response.rephrase, response.rephraseWhy, response.alternatives[1]!.text]) expect(spoken).not.toContain(text);
  });

  it('quotes a natural expression without a learner feedback block and escapes model markup', () => {
    const state = createTutorViewState();
    Object.assign(state.conversation, { from: 'speakAndRephrase', status: 'active', coaching: 'afterwards',
      transcript: [{ question: 'Try a sentence.', learnerAnswer: 'I was there yesterday.', ...tutorConversationTurn({ ...response,
        correction: 'I was there yesterday.', reply: 'This is already natural. Say "<script>bad()</script>" with <b>plain text</b> as its reason.', alternatives: [{ text: '<script>bad()</script>', why: '<b>plain text</b>' }, response.alternatives[1]] }) }] });
    const page = load(renderKrenResultViewHtml({ nonce: 'test', cspSource: 'test', activeScreen: 'tutor', tutor: state, settings: PANEL_SETTINGS_FIXTURE, proModels: [] }));
    expect(page('[data-tutor-correction]')).toHaveLength(0);
    // Changed 2026-10-18: V263, owner items I40 and I41, a natural version appears only when quoted in the paragraph.
    expect(page('[data-tutor-reply-bubble]').text()).toContain('<b>plain text</b>');
    expect(page('[data-tutor-reply-bubble] script, [data-tutor-reply-bubble] b')).toHaveLength(0);
    expect(page('[data-tutor-reply-bubble] .tutor-review-corrected').first().text()).toBe('<script>bad()</script>');
  });

});
