import { afterEach, describe, expect, it, vi } from 'vitest';
import { load } from 'cheerio';

vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn() }, window: {},
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));

import { KrenResultsViewProvider } from '../src/resultsView.js';
import { renderKrenResultViewHtml, type KrenPanelSettings } from '../src/resultViewHtml.js';
import { tutorConversationTurn, tutorConversationTurnRequest, tutorConversationCorrectionsRequest,
  tutorConversationCoachingRequest, TUTOR_SPOKEN_PUNCTUATION_INSTRUCTION,
  type TutorStructuredGenerationRequest } from '../src/tutor/generation.js';
import { tutorSpokenAnswerForDisplay } from '../src/tutor/learnerLanguage.js';
import { submitTutorConversationTurn, stopTutorConversation, retryTutorTurnCheck,
  tutorConversationAnswerForDisplay } from '../src/resultsViewTurns.js';
import { beginTutorLiveSpokenReply, completeTutorLiveSpokenTurn } from '../src/resultsViewLive.js';
import { replayTutorConversation } from '../src/resultsViewReplay.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

const recognized = "i'd love to but i cannot afford it is there a way";
const punctuated = "I'd love to, but I cannot afford it. Is there a way?";
const changedWords = "I'd love to, but I cannot afford it. Is there another way?";
const response = { move: 'reaction', reply: 'We can find a cheaper option.', replyQuote: '',
  correction: changedWords, targetId: '', explanation: 'Ask about another option.',
  rephrase: 'Could you suggest a cheaper option?', rephraseWhy: 'This asks for an alternative.',
  spokenPunctuated: punctuated };
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

function harness() {
  vi.useFakeTimers();
  const settings: KrenPanelSettings = { ...PANEL_SETTINGS_FIXTURE, tutorReadAloudProvider: 'edgeOnline',
    tutorConversationTakeHome: false };
  const requests: TutorStructuredGenerationRequest[] = [];
  const actions = { settings: () => settings, log: vi.fn(), notify: vi.fn(), stopReadAloud: vi.fn(),
    refreshReadAloudVoices: vi.fn(async () => {}),
    readAloudText: vi.fn(async (_text: string, _language?: string, _feature?: string, _voice?: string) => {}),
    generateTutor: vi.fn(async (request: TutorStructuredGenerationRequest): Promise<unknown> => {
      requests.push(request);
      return request.schemaName === 'kren_tutor_conversation_corrections'
        ? { corrections: [response] } : response;
    }) };
  const view = new KrenResultsViewProvider(actions as never, {} as never);
  const internals = view as any;
  internals.activeScreen = 'tutor';
  Object.assign(view.tutorState.conversation, { status: 'active', replies: 'standard', from: 'anything',
    coaching: 'inline', speakerOn: false, situationPicture: 'none', currentQuestion: 'Would you like to join us?' });
  let panel!: ReturnType<typeof mountedPanel>;
  const messages: Record<string, unknown>[] = [];
  view.view = { visible: true, webview: { cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }),
    set html(value: string) { panel = mountedPanel(value, () => {}); },
    postMessage: async (message: Record<string, unknown>) => { messages.push(message); panel.message(message); return true; } } } as never;
  view.render();
  return { view, internals, settings, actions, requests, messages, panel: () => panel };
}

describe('V253 I34 verified spoken punctuation', () => {
  it('requests the shared exact-words rule and required field in turn, deferred, and Live coaching schemas', () => {
    const turn = tutorConversationTurnRequest({ register: 'neutral', recipeTargets: { supportingTargets: [] },
      transcript: [], question: 'Would you like to join us?', learnerAnswer: recognized, spoken: true });
    const deferred = tutorConversationCorrectionsRequest({ register: 'neutral', recipeTargets: { supportingTargets: [] },
      turns: [{ question: 'Would you like to join us?', learnerAnswer: recognized, spoken: true }] });
    const coaching = tutorConversationCoachingRequest(turn);
    for (const request of [turn, deferred, coaching]) {
      expect(request.instruction.split(TUTOR_SPOKEN_PUNCTUATION_INSTRUCTION)).toHaveLength(2);
      const schema = request === deferred
        ? (request.schema.properties as any).corrections.items : request.schema;
      expect(schema.properties.spokenPunctuated).toEqual({ type: 'string' });
      // 2026-10-16: optional on purpose; a provider that omits it gets the local fallback, not a failed turn.
      expect(schema.required).not.toContain('spokenPunctuated');
    }
    expect(JSON.parse(turn.input).learnerAnswer).toBe(recognized);
    expect(JSON.parse(deferred.input).turns[0].learnerAnswer).toBe(recognized);
  });

  it.each([punctuated, "I’d love to, but I cannot afford it. Is there a way?"])(
    'accepts only capitalization and punctuation changes: %s', candidate => {
      const h = harness();
      expect(tutorConversationAnswerForDisplay(h.view, recognized, candidate, true)).toBe(candidate);
      expect(h.actions.log).not.toHaveBeenCalled();
    });

  it.each([changedWords, undefined, '', 'I would love to, but I cannot afford it. Is there a way?',
    "I'd love to but cannot afford it. Is there a way?", "I'd love to but I cannot afford it. There is a way?",
    "I'd love to, but I can not afford it. Is there a way?"])(
    'rejects a missing field or changed word sequence: %s', candidate => {
      const h = harness();
      expect(tutorConversationAnswerForDisplay(h.view, recognized, candidate, true))
        .toBe(tutorSpokenAnswerForDisplay(recognized));
      expect(h.actions.log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/spoken punctuation word-equality check failed/u));
      expect(h.actions.log.mock.calls[0]![0]).not.toContain(recognized);
      if (candidate) expect(h.actions.log.mock.calls[0]![0]).not.toContain(candidate);
    });

  it.each([punctuated, changedWords, undefined])('leaves a typed answer unchanged: %s', candidate => {
    const h = harness();
    expect(tutorConversationAnswerForDisplay(h.view, recognized, candidate, false)).toBe(recognized);
    expect(h.actions.log).not.toHaveBeenCalled();
  });

  it.each([true, false])('shows and replays the verified spoken words with a real word correction, spoken=%s', async spoken => {
    const h = harness();
    h.view.tutorState.conversation.draftAnswer = recognized;
    h.view.tutorState.conversation.draftAnswerSpoken = spoken;
    submitTutorConversationTurn(h.view); await flush();
    const shown = spoken ? punctuated : recognized;
    expect(h.requests.filter(request => request.kind === 'conversationTurn')).toHaveLength(1);
    expect(JSON.parse(h.requests[0]!.input).learnerAnswer).toBe(recognized);
    expect(h.view.tutorConversationRawAnswers.get(0)).toBe(recognized);
    expect(h.view.tutorState.conversation.transcript[0]).toMatchObject({ learnerAnswer: shown, correction: changedWords });
    expect(h.panel().query('[data-tutor-learner-answer]')?.textContent).toBe(shown);
    await stopTutorConversation(h.view);
    h.view.tutorState.conversation.speakerOn = true;
    h.actions.readAloudText.mockClear();
    replayTutorConversation(h.view); await flush();
    expect(h.actions.readAloudText.mock.calls.map(call => call[0])).toContain(spoken ? punctuated : changedWords);
    if (spoken) expect(h.actions.readAloudText.mock.calls.map(call => call[0])).not.toContain(changedWords);
  });

  it.each([changedWords, undefined])('falls back in a real turn when the model adds another or omits the field: %s', async candidate => {
    const h = harness();
    h.actions.generateTutor.mockResolvedValueOnce({ ...response, spokenPunctuated: candidate });
    submitTutorConversationTurn(h.view, recognized); await flush();
    expect(h.view.tutorState.conversation.transcript[0]!.learnerAnswer).toBe(tutorSpokenAnswerForDisplay(recognized));
    expect(h.panel().query('[data-tutor-learner-answer]')?.textContent).toBe(tutorSpokenAnswerForDisplay(recognized));
    expect(h.actions.log.mock.calls.filter(call => /word-equality check/u.test(call[0]))).toHaveLength(1);
  });

  it('reads the verified learner balloon between retained Live audio clips', async () => {
    const h = harness();
    h.settings.tutorReadAloudProvider = 'googleChirp';
    submitTutorConversationTurn(h.view, recognized); await flush();
    await stopTutorConversation(h.view);
    Object.assign(h.view.tutorState.conversation, { replies: 'liveGemini', speakerOn: true });
    h.view.tutorLiveConversationAudio.set(0, [{ data: 'AQI=', mimeType: 'audio/pcm;rate=24000' }]);
    h.view.tutorLiveConversationAudio.set(1, [{ data: 'AwQ=', mimeType: 'audio/pcm;rate=24000' }]);
    const events: string[] = [];
    h.view.tutorLiveAudioPlayer = { play: (chunk: { data: string }) => { events.push(chunk.data); },
      stop() {}, close() {} } as never;
    h.actions.readAloudText.mockImplementation(async text => { events.push(text); });
    replayTutorConversation(h.view); await flush();
    await vi.advanceTimersByTimeAsync(100);
    expect(events).toEqual(['AQI=', punctuated, 'AwQ=']);
    expect(h.view.tutorState.conversation.replayAllSpeaking).toBe(false);
    expect(h.requests).toHaveLength(1);
  });

  it('patches verified display text when a submitted spoken draft uses Live replies', async () => {
    const h = harness();
    h.view.tutorState.conversation.replies = 'liveGemini';
    h.internals.tutorSpeechHolds = 1;
    h.view.tutorLiveSession = { sendTurn: async () => {
      h.view.tutorLiveReplyText = response.reply;
      h.panel().message({ command: 'tutorLiveReplyFragment', text: response.reply, reset: true });
    }, sendNote() {}, takeHandoff: () => undefined } as never;
    const panel = h.panel();
    submitTutorConversationTurn(h.view, recognized); await flush();
    expect(h.panel()).toBe(panel);
    expect(panel.query('[data-tutor-learner-answer]')?.textContent).toBe(punctuated);
    expect(h.messages).toContainEqual(expect.objectContaining({
      command: 'tutorLiveTurnCommitted', learnerAnswer: punctuated }));
  });

  it('checks the cleaned recognized words after misheard-segment removal', async () => {
    const h = harness();
    submitTutorConversationTurn(h.view, `${recognized} 잘못 들린 말`); await flush();
    expect(JSON.parse(h.requests[0]!.input).learnerAnswer).toBe(recognized);
    expect(h.view.tutorState.conversation.transcript[0]).toMatchObject({ learnerAnswer: punctuated, partiallyHeard: true });
  });

  it('accepts punctuation even when no words need correction', async () => {
    const h = harness();
    h.actions.generateTutor.mockResolvedValueOnce({ ...response, correction: recognized });
    submitTutorConversationTurn(h.view, recognized); await flush();
    expect(h.panel().query('[data-tutor-learner-answer]')?.textContent).toBe(punctuated);
    expect(h.panel().query('[data-tutor-turn-feedback]')).toBeNull();
  });

  it.each(['inline', 'afterwards'] as const)('updates a Live balloon in place when %s coaching arrives', async coaching => {
    const h = harness();
    Object.assign(h.view.tutorState.conversation, { replies: 'liveGemini', coaching });
    h.view.tutorLiveSession = { sendNote() {}, takeHandoff: () => undefined, close() {} } as never;
    let finish!: (value: unknown) => void;
    h.actions.generateTutor.mockImplementationOnce(request => {
      h.requests.push(request);
      return new Promise(resolve => { finish = resolve; });
    });
    const initialPanel = h.panel();
    h.view.tutorLiveInputText = recognized;
    initialPanel.message({ command: 'tutorLiveInputFragment', text: recognized, reset: true });
    beginTutorLiveSpokenReply(h.view, true);
    h.view.tutorLiveReplyText = response.reply;
    await completeTutorLiveSpokenTurn(h.view, h.view.tutorLiveSpokenTurn!); await flush();
    expect(h.panel().query('[data-tutor-learner-answer]')?.textContent).toBe(tutorSpokenAnswerForDisplay(recognized));
    let stopping: Promise<void> | undefined;
    if (coaching === 'afterwards') {
      expect(h.actions.generateTutor).not.toHaveBeenCalled();
      stopping = stopTutorConversation(h.view); await flush();
      expect(h.view.tutorState.conversation.status).toBe('stopped');
    }
    const panel = h.panel();
    const balloon = panel.query('[data-tutor-learner-answer]');
    const composer = panel.query('[data-tutor-conversation-answer]');
    expect(balloon?.textContent).toBe(tutorSpokenAnswerForDisplay(recognized));
    finish(coaching === 'afterwards' ? { corrections: [response] } : response);
    await stopping; await flush();
    expect(h.panel()).toBe(panel);
    expect(panel.query('[data-tutor-learner-answer]')).toBe(balloon);
    expect(panel.query('[data-tutor-conversation-answer]')).toBe(composer);
    expect(balloon?.textContent).toBe(punctuated);
    expect(h.view.tutorState.conversation.transcript[0]!.learnerAnswer).toBe(punctuated);
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]!.schemaName).toBe(coaching === 'afterwards'
      ? 'kren_tutor_conversation_corrections' : 'kren_tutor_conversation_coaching');
    const input = JSON.parse(h.requests[0]!.input);
    expect(coaching === 'afterwards' ? input.turns[0].learnerAnswer : input.learnerAnswer).toBe(recognized);
    if (coaching === 'afterwards') {
      expect(h.view.tutorState.conversation.busy).toBe(false);
      expect(h.messages).toContainEqual(expect.objectContaining({ command: 'tutorConversationReviewReady' }));
    }
    else expect(panel).toBe(initialPanel);
  });

  it('uses the new field on a failed spoken check retry', async () => {
    const h = harness();
    h.view.tutorState.conversation.transcript = [{ question: 'Would you like to join us?',
      learnerAnswer: tutorSpokenAnswerForDisplay(recognized), spoken: true,
      correction: '', explanation: '', coachingFailed: true }];
    h.view.tutorConversationRawAnswers.set(0, recognized);
    h.view.render();
    const panel = h.panel(), balloon = panel.query('[data-tutor-learner-answer]');
    await retryTutorTurnCheck(h.view, 0); await flush();
    expect(h.panel()).toBe(panel);
    expect(balloon?.textContent).toBe(punctuated);
    expect(JSON.parse(h.requests[0]!.input).learnerAnswer).toBe(recognized);
  });

  it('preserves the new field in parsing and treats malformed punctuation as missing', () => {
    expect(tutorConversationTurn(response).spokenPunctuated).toBe(punctuated);
    expect(tutorConversationTurn({ ...response, spokenPunctuated: 42 }).spokenPunctuated).toBeUndefined();
  });
});

describe('V253 I35 stopped button order', () => {
  it.each([true, false])('keeps Voice and Model reachable after the review action, take-home=%s', takeHome => {
    const h = harness();
    h.view.tutorState.conversation.status = 'stopped';
    h.view.tutorState.conversation.transcript = Array.from({ length: 5 }, () => ({
      question: 'Would you like to join us?', learnerAnswer: 'Yes, please.', correction: 'Yes, please.', explanation: 'Natural.' }));
    const html = renderKrenResultViewHtml({ nonce: 'test', cspSource: 'test', activeScreen: 'tutor',
      tutor: h.view.tutorState, settings: { ...h.settings, tutorConversationTakeHome: takeHome }, proModels: [] });
    const panel = mountedPanel(html, () => {}), page = load(html);
    const stopped = panel.query('[data-tutor-stopped-actions]')!;
    const review = stopped.querySelector('[data-tutor-review-action]')!;
    expect(review.textContent).toMatch(takeHome ? /Review now/u : /More details/u);
    expect(page('[data-tutor-stopped-actions] > [data-tutor-review-action-slot]').nextAll('button').map((_, button) => page(button).text()).get())
      .toEqual(['Voice', 'Model']);
    const lesson = page('[data-tutor-heading-actions]');
    expect(lesson.find('[data-tutor-settings-section]').map((_, button) => page(button).text()).get()).toEqual(['Voice', 'Model']);
    for (const section of ['tutor-voice', 'tutor-routing']) {
      const button = stopped.querySelector(`[data-tutor-settings-section="${section}"]`)!;
      expect(button.closest('details:not([open]), [hidden]')).toBeNull();
      expect(button.getAttribute('tabindex')).not.toBe('-1');
      expect(button.disabled).toBe(false);
      panel.click(button);
      expect(panel.query(`details[data-persist-id="${section}"]`)?.open).toBe(true);
      expect(panel.document.activeElement).toBe(panel.query(`details[data-persist-id="${section}"] summary`));
    }
    const row = panel.query('[data-tutor-stopped-actions]');
    panel.message({ command: 'tutorConversationTakeHomeSetting', value: !takeHome });
    expect(panel.query('[data-tutor-stopped-actions]')).toBe(row);
    const updated = load(row!.outerHTML);
    expect(updated('[data-tutor-review-action-slot] + button').text()).toBe('Voice');
  });
});
