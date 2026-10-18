import { afterEach, describe, expect, it, vi } from 'vitest';
import { load } from 'cheerio';
vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn() }, window: {},
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { tutorConversationTurn, tutorConversationTurnRequest, tutorConversationCorrectionsRequest,
  tutorConversationCoachingRequest, type TutorStructuredGenerationRequest } from '../src/tutor/generation.js';
import { tutorSpokenAnswerForDisplay } from '../src/tutor/learnerLanguage.js';
import { applyTutorConversationHandoff, completeStandardTutorTurn, submitTutorConversationTurn,
  stopTutorConversation, retryTutorTurnCheck, postTutorLiveTurnCoaching, tutorConversationAnswerForDisplay } from '../src/resultsViewTurns.js';
import { ensureTutorConversationPicture, refreshTutorConversationPicture, startTutorConversation } from '../src/resultsViewConversation.js';
import { tutorConversationVoicePlan, tutorCharacterVoicesAt, tutorHandoffVoices,
  tutorVoiceForSource, TUTOR_CONVERSATION_VOICE_PRESETS } from '../src/speech/voiceSelection.js';
import { renderKrenResultViewHtml, type KrenPanelSettings } from '../src/resultViewHtml.js';
import { readTutorConversationText, replayTutorConversation, tutorReplayLearnerLiveVoice } from '../src/resultsViewReplay.js';
import { beginTutorLiveSpokenReply, completeTutorLiveSpokenTurn } from '../src/resultsViewLive.js';
import { GoogleChirpSpeech, SpeechCenter, type SpeechAdapter, type SpeechProvider } from '../src/speech/speechCenter.js';
import { punctuateSpokenAnswerForDisplay } from '../src/tutor/spokenAnswer.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

const ownerAnswer = 'That is very nice of you happy to get your help.';
const precedingReply = 'I found your order and can help you pick it up.';
const previousAnswer = 'I cannot find my order. Can you help me?';
const corrected = "That's very nice of you. I'm happy to get your help.";
const response = { move: 'reaction', reply: 'You are welcome.', replyQuote: '', targetId: '',
  correction: corrected, explanation: 'Add the subject and separate the sentences.',
  rephrase: "That's kind of you. I'm glad to have your help.", rephraseWhy: 'This thanks the helper.' };
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

function harness() {
  vi.useFakeTimers();
  const settings: KrenPanelSettings = { ...PANEL_SETTINGS_FIXTURE, tutorReadAloudProvider: 'edgeOnline',
    tutorEdgeReadAloudVoice: 'en-US-ChristopherNeural', tutorEdgeReadAloudFemaleVoice: 'en-US-AvaNeural',
    tutorEdgeReadAloudMaleVoice: 'en-US-ChristopherNeural', tutorLiveFemaleVoice: 'Callirrhoe',
    tutorLiveMaleVoice: 'Enceladus', tutorConversationTakeHome: false };
  const requests: TutorStructuredGenerationRequest[] = [];
  const actions = { settings: () => settings, log: vi.fn(), notify: vi.fn(), stopReadAloud: vi.fn(),
    writeTutorPreferences: vi.fn(), refreshReadAloudVoices: vi.fn(async () => {}),
    readAloudText: vi.fn(async (_text: string, _language?: string, _feature?: string, _voice?: string) => {}),
    generateSituationPicture: vi.fn(async (_scene: string, _signal: AbortSignal) => 'data:image/png;base64,TkVX'),
    generateTutor: vi.fn(async (request: TutorStructuredGenerationRequest): Promise<unknown> => {
      requests.push(request);
      return request.kind === 'conversationCorrections' && request.schemaName !== 'kren_tutor_conversation_coaching'
        ? { corrections: [{ ...response }] } : { ...response };
    }) };
  const view = new KrenResultsViewProvider(actions as never, {} as never);
  const internals = view as unknown as { activeScreen: string; tutorSpeechHolds: number;
    handleMessage(message: unknown): Promise<void> };
  internals.activeScreen = 'tutor';
  Object.assign(view.tutorState.conversation, { status: 'active', replies: 'standard', from: 'anything',
    coaching: 'inline', speakerOn: false, situationPicture: 'none', tutorRole: 'store clerk',
    learnerRole: 'customer', currentQuestion: precedingReply, liveVoice: 'Enceladus' });
  view.tutorConversationScene = 'A customer and a store clerk are at the pickup counter.';
  let panel!: ReturnType<typeof mountedPanel>;
  view.view = { visible: true, webview: { cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }),
    set html(value: string) { panel = mountedPanel(value, () => {}); },
    postMessage: async (message: Record<string, unknown>) => { panel.message(message); return true; } } } as never;
  view.render();
  internals.tutorSpeechHolds = 1;
  return { view, actions, settings, requests, internals, panel: () => panel };
}

function archivePrevious(view: KrenResultsViewProvider) {
  completeStandardTutorTurn(view, tutorConversationTurn({ ...response, reply: precedingReply,
    correction: previousAnswer, rephrase: previousAnswer }), 'What do you need?', previousAnswer, false);
}

/** Drive the actual center through the same four-argument action as the extension. */
function connectSpeechCenter(h: ReturnType<typeof harness>) {
  const calls: Array<{ source: SpeechProvider; text: string; voice: string }> = [];
  const speak = (source: SpeechProvider) => vi.fn<SpeechAdapter['speak']>(async (text, voice, _rate, _volume, onStarted) => {
    calls.push({ source, text, voice: voice.voice });
    onStarted?.();
    return { status: 'completed' };
  });
  const tutor = new GoogleChirpSpeech(async () => undefined, { play: async () => 'completed', stop: () => false }, () => {});
  const shared = new GoogleChirpSpeech(async () => undefined, { play: async () => 'completed', stop: () => false }, () => {});
  vi.spyOn(tutor.adapter, 'speak').mockImplementation(speak('googleChirp'));
  const edge = { speak: speak('edgeOnline'), stop: () => false };
  const windows = { speak: speak('windowsLocal'), stop: () => false };
  const center = new SpeechCenter(tutor, shared, edge, windows, {
    configuration: () => ({ get: ((key: string, fallback: unknown) => ({
      'tutor.readAloud.provider': h.settings.tutorReadAloudProvider,
      'tutor.readAloud.voice': h.settings.tutorReadAloudVoice,
      'tutor.readAloud.edgeLocale': 'en-US', 'tutor.readAloud.edgeVoice': h.settings.tutorEdgeReadAloudVoice,
      'tutor.readAloud.edgeFemaleVoice': h.settings.tutorEdgeReadAloudFemaleVoice,
      'tutor.readAloud.edgeMaleVoice': h.settings.tutorEdgeReadAloudMaleVoice,
      'tutor.liveFemaleVoice': h.settings.tutorLiveFemaleVoice, 'tutor.liveMaleVoice': h.settings.tutorLiveMaleVoice
    } as Record<string, unknown>)[key] ?? fallback) as never }),
    trusted: () => true, consent: async () => true, active: async () => {}, status: () => ({ dispose() {} }),
    hold: () => () => {}, started: () => h.view.tutorSpeechPlaybackStarted(), liveSpeaking: () => false,
    conversation: () => h.view.tutorSpeechConversationIdentity(), speakerVoice: () => h.view.tutorSpeechVoice(),
    playback: () => undefined, notify: h.actions.notify, log: h.actions.log
  });
  h.actions.readAloudText.mockImplementation(async (text, language, feature, voice) => {
    await center.speak(text, language, feature as 'tutor' | 'shared' | undefined, voice);
  });
  return { calls, center, edge, windows };
}

function expectPerspective(request: TutorStructuredGenerationRequest) {
  // The exact sentence is the model-facing rule and is also the red-probe target.
  expect(request.instruction).toContain("Corrections and rephrases must preserve the learner's meaning, speaker perspective, and who does what to whom; never swap the roles of the learner and the character.");
  expect(request.instruction).toMatch(/Corrections fix form only/u);
}

describe('V248 I27 meaning and perspective', () => {
  it('shares the perspective rule across turn, deferred, and Live coaching requests', () => {
    const turn = tutorConversationTurnRequest({ register: 'neutral', recipeTargets: { supportingTargets: [] },
      tutorRole: 'store clerk', learnerRole: 'customer', question: precedingReply, learnerAnswer: ownerAnswer,
      transcript: [{ question: 'What do you need?', learnerAnswer: previousAnswer, reply: precedingReply,
        correction: previousAnswer, explanation: 'Natural.' }] });
    expectPerspective(turn);
    expect(JSON.parse(turn.input)).toMatchObject({ tutorRole: 'store clerk', learnerRole: 'customer',
      question: precedingReply, learnerAnswer: ownerAnswer, transcript: [{ learnerAnswer: previousAnswer, reply: precedingReply }] });
    expectPerspective(tutorConversationCorrectionsRequest({ register: 'neutral', recipeTargets: { supportingTargets: [] },
      tutorRole: 'store clerk', learnerRole: 'customer', turns: [{ question: precedingReply, learnerAnswer: ownerAnswer,
        previousTurn: { question: 'What do you need?', learnerAnswer: previousAnswer, reply: precedingReply } }] }));
    const coaching = tutorConversationCoachingRequest(turn);
    expectPerspective(coaching);
    expect(JSON.parse(coaching.input).transcript[0].learnerAnswer).toBe(previousAnswer);
  });

  it('sends both roles and the helping exchange for the owner sentence on a real Standard submission', async () => {
    const h = harness(); archivePrevious(h.view);
    h.view.tutorState.conversation.draftAnswer = ownerAnswer;
    submitTutorConversationTurn(h.view); await flush();
    const request = h.requests.find((input) => input.kind === 'conversationTurn')!;
    expectPerspective(request);
    expect(JSON.parse(request.input)).toMatchObject({ tutorRole: 'store clerk', learnerRole: 'customer',
      learnerAnswer: ownerAnswer, question: precedingReply, transcript: [{ learnerAnswer: previousAnswer, reply: precedingReply }] });
  });

  it('retains the preceding checked turn when only the later Live turn is deferred', async () => {
    const h = harness(); archivePrevious(h.view);
    Object.assign(h.view.tutorState.conversation, { replies: 'liveGemini', coaching: 'afterwards' });
    completeStandardTutorTurn(h.view, tutorConversationTurn(response), precedingReply, ownerAnswer, true);
    h.view.tutorState.conversation.transcript[1]!.coachingPending = true;
    await stopTutorConversation(h.view); await flush();
    const request = h.requests.find((input) => input.kind === 'conversationCorrections')!;
    expectPerspective(request);
    expect(JSON.parse(request.input)).toMatchObject({ tutorRole: 'store clerk', learnerRole: 'customer',
      turns: [{ learnerAnswer: ownerAnswer, question: precedingReply, previousTurn: {
        learnerAnswer: previousAnswer, reply: precedingReply } }] });
  });

  it('keeps the same preceding exchange in a deferred check retry', async () => {
    const h = harness(); archivePrevious(h.view);
    completeStandardTutorTurn(h.view, tutorConversationTurn(response), precedingReply, ownerAnswer, true);
    h.view.tutorState.conversation.coaching = 'afterwards';
    h.view.tutorState.conversation.transcript[1]!.coachingFailed = true;
    await retryTutorTurnCheck(h.view, 1);
    const request = h.requests[0]!;
    expectPerspective(request);
    expect(JSON.parse(request.input).turns[0]).toMatchObject({ learnerAnswer: ownerAnswer, question: precedingReply,
      previousTurn: { learnerAnswer: previousAnswer, reply: precedingReply } });
  });
});

describe('V248 I26 spoken display', () => {
  it('keeps legacy display callers on the one formatter', () => {
    expect(punctuateSpokenAnswerForDisplay).toBe(tutorSpokenAnswerForDisplay);
  });
  it('retains proper-name normalization without replacing a learner grammar error', () => {
    const h = harness();
    expect(tutorConversationAnswerForDisplay(h.view, 'i live in seoul.', 'I live in Seoul.', true)).toBe('I live in Seoul.');
    expect(tutorConversationAnswerForDisplay(h.view, 'i has two ticket', 'I have two tickets.', true)).toBe('I has two ticket.');
    expect(tutorConversationAnswerForDisplay(h.view, 'i live in seoul.', 'I live in Seoul.', false)).toBe('i live in seoul.');
  });
  it.each([
    ['i think so can i pay by card', 'I think so can I pay by card?'],
    ["i'm here. i'll wait! i've paid? i'd like tea", "I'm here. I'll wait! I've paid? I'd like tea."],
    ['i went there yesterday.', 'I went there yesterday.'],
    ['could you help me', 'Could you help me?'],
    ['i has two ticket', 'I has two ticket.'],
    ['i’m here and i’ll wait', 'I’m here and I’ll wait.']
  ])('formats only capitalization and punctuation: %s', (recognized, shown) => {
    expect(tutorSpokenAnswerForDisplay(recognized)).toBe(shown);
  });

  it.each([true, false])('keeps recognized coaching input and patches display in place, spoken=%s', async spoken => {
    const h = harness(), panel = h.panel();
    const raw = 'i think so can i pay by card';
    h.view.tutorState.conversation.draftAnswer = raw;
    h.view.tutorState.conversation.draftAnswerSpoken = spoken;
    h.actions.generateTutor.mockImplementationOnce(async request => {
      h.requests.push(request);
      return { ...response, correction: 'I think so, can I pay by card?' };
    });
    submitTutorConversationTurn(h.view); await flush();
    // Changed 2026-10-16: V253, owner item I34, a missing punctuated field uses the local form even with a spoken-equivalent correction.
    const shown = spoken ? 'I think so can I pay by card?' : raw;
    expect(JSON.parse(h.requests[0]!.input).learnerAnswer).toBe(raw);
    expect(h.view.tutorConversationRawAnswers.get(0)).toBe(raw);
    expect(h.view.tutorState.conversation.transcript[0]!.learnerAnswer).toBe(shown);
    expect(h.panel()).toBe(panel);
    expect(panel.query('[data-tutor-learner-answer]')?.textContent).toBe(shown);
    postTutorLiveTurnCoaching(h.view, h.view.tutorState.conversation.transcript[0]!, 0, undefined);
    expect(panel.query('[data-tutor-learner-answer]')?.textContent).toBe(shown);
    const html = load(renderKrenResultViewHtml({ nonce: 'test', cspSource: 'test', settings: h.settings,
      activeScreen: 'tutor', tutor: h.view.tutorState, proModels: [] }));
    expect(html('[data-tutor-learner-answer]').text()).toBe(shown);
    const replay = html('[data-command="replayTutorQuestion"]');
    expect(replay).toHaveLength(1);
    expect(replay.closest('details').length).toBe(0);
  });

  it('formats the Live balloon in place and keeps the recognized words through coaching', async () => {
    const h = harness(), panel = h.panel(), raw = 'i think so can i pay by card';
    h.view.tutorState.conversation.replies = 'liveGemini';
    h.view.tutorLiveSession = { sendNote() {}, takeHandoff: () => undefined } as never;
    h.actions.generateTutor.mockImplementationOnce(async request => {
      h.requests.push(request);
      return { ...response, correction: 'I think so. Can I pay by card?' };
    });
    h.view.tutorLiveInputText = raw;
    panel.message({ command: 'tutorLiveInputFragment', text: raw, reset: true });
    beginTutorLiveSpokenReply(h.view, true);
    const turn = h.view.tutorLiveSpokenTurn!;
    expect(turn.learnerAnswer).toBe(raw);
    expect(JSON.parse(turn.coachingRequest.input).learnerAnswer).toBe(raw);
    expect(panel.query('[data-tutor-learner-answer]')?.textContent).toBe('I think so can I pay by card?');
    h.view.tutorLiveReplyText = 'Yes, you can pay by card.';
    await completeTutorLiveSpokenTurn(h.view, turn); await flush();
    expect(h.panel()).toBe(panel);
    expect(h.view.tutorConversationRawAnswers.get(0)).toBe(raw);
    // Changed 2026-10-16: V253, owner item I34, missing model punctuation keeps the local display while retaining the correction.
    expect(h.view.tutorState.conversation.transcript[0]!.learnerAnswer).toBe('I think so can I pay by card?');
    expect(h.view.tutorState.conversation.transcript[0]!.correction).toBe('I think so. Can I pay by card?');
    expect(panel.query('[data-tutor-learner-answer]')?.textContent).toBe('I think so can I pay by card?');
    expect(JSON.parse(h.requests[0]!.input).learnerAnswer).toBe(raw);
  });
});

describe('V248 I25 planned voices and pictures', () => {
  it.each([undefined, null, 'old-conversation', 1, false, Symbol('conversation')])('handles a non-object session identity: %s', identity => {
    const context = { tutorSpeechConversation: identity, actions: { settings: () => PANEL_SETTINGS_FIXTURE },
      tutorState: { conversation: { replies: 'standard', liveVoice: 'Kore', transcript: [] } } };
    expect(() => tutorConversationVoicePlan(context, true)).not.toThrow();
    expect(tutorConversationVoicePlan(context).initial.edgeVoice).toBe(PANEL_SETTINGS_FIXTURE.tutorEdgeReadAloudVoice);
  });

  it('keeps absent-setting Replay defaults dynamic until Start fixes a plan', () => {
    const h = harness();
    h.settings.tutorLiveFemaleVoice = undefined; h.settings.tutorLiveMaleVoice = undefined;
    h.view.tutorState.conversation.liveVoice = 'Kore';
    expect(tutorReplayLearnerLiveVoice(h.view)).toBe('Enceladus');
    h.view.tutorState.conversation.liveVoice = 'Puck';
    expect(tutorReplayLearnerLiveVoice(h.view)).toBe('Callirrhoe');
    tutorConversationVoicePlan(h.view, true);
    h.view.tutorState.conversation.liveVoice = 'Kore';
    expect(tutorReplayLearnerLiveVoice(h.view)).toBe('Callirrhoe');
  });

  for (const source of ['edgeOnline', 'windowsLocal'] as const) {
    it.each(['standard', 'liveGemini'] as const)(`${source} keeps three arguments for an ordinary %s reading`, async replies => {
      const h = harness();
      h.settings.tutorReadAloudProvider = source;
      h.view.tutorState.conversation.replies = replies;
      h.view.tutorState.conversation.liveVoice = 'Kore';
      tutorConversationVoicePlan(h.view, true);
      await readTutorConversationText(h.view, 'The default voice.');
      expect(h.actions.readAloudText.mock.calls).toEqual([['The default voice.', 'en', 'tutor']]);
    });
  }

  it('does not consult the Windows speaker hook when Chirp handles an utterance', async () => {
    const h = harness();
    h.settings.tutorReadAloudProvider = 'googleChirp';
    const speech = connectSpeechCenter(h);
    h.view.tutorSpeechVoice = vi.fn(() => { throw new Error('Windows voice hook must not run.'); });
    await readTutorConversationText(h.view, 'A Chirp line.', 'Puck');
    expect(speech.calls).toEqual([{ source: 'googleChirp', text: 'A Chirp line.', voice: 'Puck' }]);
    expect(h.view.tutorSpeechVoice).not.toHaveBeenCalled();
  });

  it.each(['edgeOnline', 'googleChirp', 'windowsLocal'] as const)('%s fixes the cast and default voices at Start', async source => {
    const h = harness();
    h.settings.tutorReadAloudProvider = source;
    h.settings.tutorEdgeReadAloudMaleVoice = 'en-US-GuyNeural';
    h.view.tutorState.conversation.status = 'idle';
    h.view.tutorState.conversation.situationPicture = 'intro';
    h.settings.credentialPresence = { ...h.settings.credentialPresence, geminiAlternate: true };
    const before = { ...h.settings };
    h.actions.generateTutor.mockImplementationOnce(async request => {
      h.requests.push(request);
      return { tutorRole: 'store clerk', learnerRole: 'customer', scene: h.view.tutorConversationScene ?? 'At a pickup counter.',
        opening: 'How can I help you?' };
    });
    startTutorConversation(h.view); await flush();
    const plan = tutorConversationVoicePlan(h.view);
    expect(plan.tutorGender).toBe('male');
    expect(plan.learnerGender).toBe('female');
    expect(plan.initial.edgeVoice).toBe('en-US-GuyNeural');
    expect(plan.initial.liveVoice).toBe('Enceladus');
    expect(plan.learner.liveVoice).toBe('Callirrhoe');
    expect(JSON.parse(h.requests[0]!.input).voiceGender).toBe('male');
    expect(h.actions.generateSituationPicture).toHaveBeenCalledTimes(1);
    expect(h.actions.generateSituationPicture.mock.calls[0]![0]).toMatch(/AI character .* is male.*learner figure .* is female/su);
    expect(h.settings).toEqual(before);
  });

  for (const source of ['edgeOnline', 'googleChirp', 'windowsLocal'] as const) {
    it.each(['female', 'male'] as const)(`${source} speaks later replies and earlier Replay turns in each %s character's voice`, async gender => {
      const h = harness();
      h.settings.tutorReadAloudProvider = source;
      const savedSettings = { ...h.settings };
      const speech = connectSpeechCenter(h);
      const plan = tutorConversationVoicePlan(h.view, true);
      archivePrevious(h.view);
      h.view.tutorState.conversation.speakerOn = true;
      completeStandardTutorTurn(h.view, tutorConversationTurn({ ...response, handoff: { role: 'Alex, the manager', gender } }),
        precedingReply, ownerAnswer, false);
      await flush();
      const replacementVoice = tutorVoiceForSource(h.settings, plan.current);
      expect(speech.calls.at(-1)).toMatchObject({ source, voice: replacementVoice, text: response.reply });
      h.view.tutorState.conversation.draftAnswer = ownerAnswer;
      submitTutorConversationTurn(h.view); await flush();
      expect(speech.calls.at(-1)).toMatchObject({ source, voice: replacementVoice });
      expect(h.requests.filter(request => request.kind === 'conversationTurn')).toHaveLength(1);
      await stopTutorConversation(h.view);
      speech.calls.length = 0;
      replayTutorConversation(h.view); await flush();
      expect(speech.calls.find(call => call.text === precedingReply)).toMatchObject({ source,
        voice: tutorVoiceForSource(h.settings, plan.initial) });
      const replacementLines = speech.calls.filter(call => call.text === response.reply);
      expect(replacementLines.length).toBeGreaterThan(0);
      expect(replacementLines.every(call => call.source === source && call.voice === replacementVoice)).toBe(true);
      expect(speech.calls.find(call => call.text === corrected)).toMatchObject({ source,
        voice: tutorVoiceForSource(h.settings, plan.learner) });
      expect(h.settings).toEqual(savedSettings);
      expect(h.actions.writeTutorPreferences).not.toHaveBeenCalled();
      expect(h.view.tutorSpeechUtteranceVoice).toBeUndefined();
      if (source === 'windowsLocal') {
        expect(speech.edge.speak).not.toHaveBeenCalled();
        expect(replacementVoice).toBe(gender === 'female' ? 'Microsoft Zira Desktop' : 'Microsoft David Desktop');
        await speech.center.speak('An ordinary reading.', 'en', 'tutor');
        expect(speech.calls.at(-1)!.voice).toBe(h.settings.tutorReadAloudVoice);
      }
    });
  }

  it('keeps the original learner Live voice after the character changes gender', () => {
    const h = harness();
    h.view.tutorState.conversation.replies = 'liveGemini';
    h.view.tutorLiveFailed = true;
    const learnerVoice = tutorReplayLearnerLiveVoice(h.view);
    applyTutorConversationHandoff(h.view, { role: 'Sarah, the manager', gender: 'female' });
    expect(tutorReplayLearnerLiveVoice(h.view)).toBe(learnerVoice);
    expect(h.view.tutorState.conversation.liveVoice).not.toBe(learnerVoice);
  });

  it('releases a failed Windows utterance override without changing the source or settings', async () => {
    const h = harness();
    h.settings.tutorReadAloudProvider = 'windowsLocal';
    const original = { ...h.settings };
    h.actions.readAloudText.mockImplementationOnce(async (_text, _language, _feature, edgeVoice) => {
      expect(edgeVoice).toBeUndefined();
      expect(h.view.tutorSpeechVoice()).toBe('Microsoft Zira Desktop');
      throw new Error('Reading interrupted.');
    });
    await expect(readTutorConversationText(h.view, 'Hello.', 'Microsoft Zira Desktop')).rejects.toThrow('Reading interrupted.');
    expect(h.view.tutorSpeechUtteranceVoice).toBeUndefined();
    expect(h.settings).toEqual(original);
  });

  it.each(['female', 'male'] as const)('chooses a different %s voice for every source and preserves earlier turn identities', gender => {
    const h = harness(), settingsBefore = { ...h.settings };
    const plan = tutorConversationVoicePlan(h.view, true);
    archivePrevious(h.view);
    completeStandardTutorTurn(h.view, tutorConversationTurn({ ...response, handoff: { role: 'Alex, the manager', gender } }),
      precedingReply, ownerAnswer, false);
    const current = plan.current;
    expect(tutorCharacterVoicesAt(h.view, 0)).toEqual(plan.initial);
    expect(tutorCharacterVoicesAt(h.view, 1)).toEqual(current);
    for (const [source, key] of [['edgeOnline', 'edgeVoice'], ['googleChirp', 'liveVoice'], ['liveGemini', 'liveVoice']] as const) {
      expect(TUTOR_CONVERSATION_VOICE_PRESETS[source][gender]).toContain(current[key]);
      expect(current[key]).not.toBe(plan.initial[key]);
      expect(current[key]).not.toBe(plan.learner[key]);
    }
    expect(current.windowsVoice).toBe(gender === 'female' ? 'Microsoft Zira Desktop' : 'Microsoft David Desktop');
    expect(plan.learnerGender).toBe('female');
    expect(h.settings).toEqual(settingsBefore);
    expect(h.actions.writeTutorPreferences).not.toHaveBeenCalled();
    expect(h.actions.generateTutor).not.toHaveBeenCalled();
    expect(tutorHandoffVoices(h.settings, gender, [current, plan.learner]).liveVoice).not.toBe(current.liveVoice);
  });

  it.each(['intro', 'switching', 'graduallyEntering'] as const)('requests one replacement in %s and keeps the learner gender fixed', async mode => {
    const h = harness();
    h.settings.credentialPresence = { ...h.settings.credentialPresence, geminiAlternate: true };
    h.view.tutorState.conversation.situationPicture = mode;
    const old = 'data:image/png;base64,T0xE';
    h.view.tutorConversationPictures = [old]; h.view.tutorConversationPicture = old;
    h.view.tutorConversationPictureTurns = [-1];
    archivePrevious(h.view);
    applyTutorConversationHandoff(h.view, { role: 'Sarah, the manager', gender: 'female' });
    await flush();
    expect(h.actions.generateSituationPicture).toHaveBeenCalledTimes(1);
    const scene = h.actions.generateSituationPicture.mock.calls[0]![0];
    expect(scene).toMatch(/AI character \(Sarah, the manager\) is female/u);
    expect(scene).toMatch(/learner figure \(customer\) is female/u);
    const pending = h.view.tutorConversationPicturePending!;
    await h.internals.handleMessage({ command: 'tutorConversationPictureDecoded', requestId: pending.requestId, input: pending.image });
    expect(h.view.tutorConversationPictures.at(-1)).toBe(pending.image);
    ensureTutorConversationPicture(h.view);
    expect(h.actions.generateSituationPicture).toHaveBeenCalledTimes(1);
  });

  it('holds a handoff picture through Live reconnect and requests it once afterward', async () => {
    const h = harness();
    h.settings.credentialPresence = { ...h.settings.credentialPresence, geminiAlternate: true };
    h.view.tutorState.conversation.situationPicture = 'intro';
    h.view.tutorConversationPictures = ['data:image/png;base64,T0xE'];
    h.view.tutorLiveResumeController = new AbortController();
    // A validated handoff changes the cast before its reconnect starts.
    h.view.tutorLiveFailed = true;
    applyTutorConversationHandoff(h.view, { role: 'Sarah, the manager', gender: 'female' });
    refreshTutorConversationPicture(h.view, true);
    ensureTutorConversationPicture(h.view);
    expect(h.actions.generateSituationPicture).not.toHaveBeenCalled();
    h.view.tutorLiveResumeController = undefined;
    ensureTutorConversationPicture(h.view); await flush();
    ensureTutorConversationPicture(h.view);
    expect(h.actions.generateSituationPicture).toHaveBeenCalledTimes(1);
    expect(h.actions.generateSituationPicture.mock.calls[0]![0]).toMatch(/Sarah, the manager.*female/u);
  });

  it.each(['load', 'error'] as const)('keeps the Intro image until its replacement decodes: %s', event => {
    const h = harness(), oldImage = 'data:image/png;base64,T0xE', newImage = 'data:image/png;base64,TkVX';
    h.view.tutorState.conversation.situationPicture = 'intro';
    h.view.tutorConversationPicture = oldImage;
    h.view.tutorConversationPictures = [oldImage];
    h.view.tutorConversationPictureTurns = [-1];
    h.internals.tutorSpeechHolds = 0; h.view.render(); h.internals.tutorSpeechHolds = 1;
    const panel = h.panel(), composer = panel.query('[data-tutor-conversation-answer]');
    const old = panel.query('[data-tutor-picture]')!;
    expect(old.src).toBe(oldImage);
    old.complete = true; old.naturalWidth = 1; panel.event(old, 'load');
    const created: ReturnType<typeof panel.document.createElement>[] = [];
    const create = panel.document.createElement;
    panel.document.createElement = tag => {
      const element = create(tag);
      if (tag === 'img') created.push(element);
      return element;
    };
    panel.message({ command: 'tutorConversationPictureReady', mode: 'intro', image: newImage,
      images: [oldImage, newImage], turns: [-1, 0], requestId: 1, replaceCharacter: true });
    const incoming = created.find(image => image.src === newImage)!;
    expect(incoming).toBeDefined();
    expect(panel.query('[data-tutor-picture]')?.src).toBe(oldImage);
    if (event === 'load') { incoming.complete = true; incoming.naturalWidth = 1; }
    panel.event(incoming, event);
    expect(panel.query('[data-tutor-picture]')?.src).toBe(event === 'load' ? newImage : oldImage);
    expect(panel.query('[data-tutor-picture]')?.hidden).toBe(false);
    expect(panel.query('[data-tutor-conversation-answer]')).toBe(composer);
  });

  it('keeps the old picture and logs one line when a handoff picture fails', async () => {
    const h = harness();
    h.settings.credentialPresence = { ...h.settings.credentialPresence, geminiAlternate: true };
    h.view.tutorState.conversation.situationPicture = 'intro';
    h.view.tutorConversationPictures = ['data:image/png;base64,T0xE'];
    h.actions.generateSituationPicture.mockRejectedValueOnce(new Error('Unavailable.'));
    applyTutorConversationHandoff(h.view, { role: 'Sarah, the manager', gender: 'female' }); await flush();
    expect(h.view.tutorConversationPictures).toEqual(['data:image/png;base64,T0xE']);
    expect(h.actions.generateSituationPicture).toHaveBeenCalledTimes(1);
    expect(h.actions.log).toHaveBeenCalledTimes(1);
    expect(h.actions.notify).not.toHaveBeenCalled();
  });

  it('does not request a picture for None', () => {
    const h = harness();
    applyTutorConversationHandoff(h.view, { role: 'Sarah, the manager', gender: 'female' });
    expect(h.actions.generateSituationPicture).not.toHaveBeenCalled();
  });
});
