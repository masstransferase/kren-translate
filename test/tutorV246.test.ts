// Changed 2026-10-18: V263, owner item I43, preserve the transcript in place because conversations have no answer box.
import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import { load } from 'cheerio';
vi.mock('vscode', () => ({ commands: { executeCommand: async () => undefined }, window: {},
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { tutorConversationHandoff, tutorConversationHandoffInstruction, tutorConversationTurn,
  tutorConversationTurnRequest, type TutorStructuredGenerationRequest } from '../src/tutor/generation.js';
import { tutorLearnerTurnText } from '../src/tutor/learnerLanguage.js';
import { createTutorViewState } from '../src/tutor/state.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { completeStandardTutorTurn, submitTutorConversationTurn, postTutorLiveTurnCommitted,
  postTutorLiveTurnCoaching, tutorConversationTranscriptForModel, submitLiveTutorTurn } from '../src/resultsViewTurns.js';
import { beginTutorLiveSpokenReply, completeTutorLiveSpokenTurn, closeTutorLiveSession } from '../src/resultsViewLive.js';
import { readTutorConversationText } from '../src/resultsViewReplay.js';
import { tutorConversationVoicePlan } from '../src/speech/voiceSelection.js';
import { tutorTakeHomeInput } from '../src/resultsViewTakeHome.js';
import { TutorLiveSession, type TutorLiveSocket, type TutorLiveSocketEvent } from '../src/tutor/liveSession.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

const manager = 'By the way can i talk to your manager i want to give a positive feedback about your help.';
const english = 'Your employee was very polite and kind and I would like to give a positive feedback.';
const misheard = `はい、せら、ナイス トゥ ミー チュウ。${english}`;
const handoff = { role: 'Sarah, the store manager', gender: 'female' as const };
const reply = { move: 'reaction', reply: 'I am Sarah, the store manager. How can I help?', replyQuote: '',
  correction: 'I need help.', targetId: '', explanation: 'This is clear.', rephrase: 'Could you help me?', rephraseWhy: 'A polite request.' };
const request = { register: 'neutral' as const, recipeTargets: { supportingTargets: [] }, transcript: [],
  question: 'How can I help?', tutorRole: 'store clerk', learnerRole: 'customer', learnerAnswer: manager };
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const page = (state = createTutorViewState()) => renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test',
  settings: PANEL_SETTINGS_FIXTURE, activeScreen: 'tutor', tutor: state, proModels: [] });

class Socket implements TutorLiveSocket {
  readyState = 0;
  sent: Array<Record<string, any>> = [];
  closed = false;
  listeners = new Map<string, Set<(event: TutorLiveSocketEvent) => void>>();
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.closed = true; this.readyState = 3; }
  addEventListener(type: string, listener: (event: TutorLiveSocketEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (event: TutorLiveSocketEvent) => void) { this.listeners.get(type)?.delete(listener); }
  emit(type: string, data?: unknown) { for (const listener of this.listeners.get(type) ?? []) listener({ data }); }
  frame(data: unknown) { this.emit('message', JSON.stringify(data)); }
  open() { this.readyState = 1; this.emit('open'); this.frame({ setupComplete: {} }); }
}

function harness() {
  const messages: Array<Record<string, any>> = [], requests: TutorStructuredGenerationRequest[] = [], voices: Array<string | undefined> = [];
  const sockets: Socket[] = [];
  const settings = { ...PANEL_SETTINGS_FIXTURE, tutorReadAloudProvider: 'edgeOnline',
    tutorLiveFemaleVoice: 'Callirrhoe', tutorLiveMaleVoice: 'Enceladus',
    tutorEdgeReadAloudFemaleVoice: 'en-US-JennyNeural', tutorEdgeReadAloudMaleVoice: 'en-US-GuyNeural' };
  const view = new KrenResultsViewProvider({ settings: () => settings, log: () => {},
    generateTutor: async (input: TutorStructuredGenerationRequest) => {
      requests.push(input);
      if (input.kind === 'liveSessionCredential') return { apiKey: ['unit', 'test', 'credential'].join('-') };
      if (input.kind === 'conversationTurn') return { ...reply, handoff };
      return { correction: english, targetId: '', explanation: 'Clear.', rephrase: english, rephraseWhy: 'Natural.' };
    }, readAloudText: async (_text: string, _language?: string, _feature?: string, voice?: string) => { voices.push(voice); },
    stopReadAloud: () => {}, writeTutorPreferences: async () => {}, refreshReadAloudVoices: async () => {}
  } as never, {} as never, undefined, undefined, () => { const socket = new Socket(); sockets.push(socket); return socket; });
  (view as unknown as { activeScreen: string }).activeScreen = 'tutor';
  Object.assign(view.tutorState.conversation, { status: 'active', from: 'anything', replies: 'standard', coaching: 'inline',
    tutorRole: 'store clerk', learnerRole: 'customer', currentQuestion: 'How can I help?',
    speakerOn: false, situationPicture: 'none', liveVoice: 'Enceladus' });
  view.tutorLiveOpeningContext = { kind: 'anything', register: 'neutral', tutorRole: 'store clerk', learnerRole: 'customer',
    sceneSlant: 'the counterpart is strong, competent, well prepared', voiceGender: 'male' };
  view.tutorConversationScene = 'A customer is speaking with a store clerk.';
  let panel = mountedPanel(page(view.tutorState), () => {});
  view.view = { visible: true, webview: { cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }),
    set html(value: string) { panel = mountedPanel(value, () => {}); },
    postMessage: async (message: Record<string, any>) => { messages.push(message); panel.message(message); return true; } } } as never;
  return { view, get panel() { return panel; }, settings, messages, requests, voices, sockets };
}

describe('V246 explicit handoff', () => {
  it('adds the owner manager instruction for this answer only', () => {
    assert.match(tutorConversationTurnRequest(request).instruction, /For this turn only:.*Hand over now.*overriding any scene slant/u);
    assert.doesNotMatch(tutorConversationTurnRequest({ ...request, learnerAnswer: 'Thank you.' }).instruction, /KREN detected/u);
  });
  it.each(['Could I speak with your supervisor?', 'May I see the boss?', 'Can you get a colleague?',
    'Please transfer me to someone in charge.', 'I would like to talk with someone else who can help.',
    'LET ME TALK TO YOUR MANAGER.', 'Could someone else help me?', 'Is there anyone else who could help?',
    'Your manager, please.', 'Who is in charge?', "I'd like to speak to your boss.", 'I need your supervisor.'])('detects %s', text => assert.ok(tutorConversationHandoffInstruction(text)));
  it.each(['My manager is kind.', 'I talked to my boss yesterday.', 'Thanks for your help.',
    'I can help your manager.', 'I need to give feedback about your manager.'])('does not request a handoff for %s', text => {
    assert.equal(tutorConversationHandoffInstruction(text), '');
  });
  it.each([undefined, null, {}, { role: '', gender: 'female' }, { role: 'Sarah', gender: 'other' },
    { role: 1, gender: 'male' }, { role: '<b>Sarah</b>', gender: 'female' }])('ignores malformed signal %j', value => {
    assert.equal(tutorConversationHandoff(value), undefined);
    assert.equal(tutorConversationTurn({ ...reply, handoff: value }).handoff, undefined);
  });
  it('commits a Standard handoff, renders its note, and sends the new role and gender later', async () => {
    const h = harness();
    h.view.tutorState.conversation.draftAnswer = manager;
    submitTutorConversationTurn(h.view); await flush();
    assert.equal(h.view.tutorState.conversation.tutorRole, handoff.role);
    // Changed 2026-10-16: V248, owner item I25, the newcomer uses a preset that excludes the learner's voice.
    assert.equal(h.view.tutorState.conversation.liveVoice, tutorConversationVoicePlan(h.view).current.liveVoice);
    assert.notEqual(h.view.tutorState.conversation.liveVoice, h.settings.tutorLiveFemaleVoice);
    assert.equal(h.panel.query('[data-tutor-handoff]')?.textContent, 'Sarah, the store manager, joins the conversation.');
    assert.equal(load(page(h.view.tutorState))('[data-tutor-handoff]').text(), 'Sarah, the store manager, joins the conversation.');
    await readTutorConversationText(h.view, 'Hello.');
    // Changed 2026-10-16: V248, owner item I25, the newcomer has a different preset Edge voice.
    assert.equal(h.voices.at(-1), tutorConversationVoicePlan(h.view).current.edgeVoice);
    h.view.tutorState.conversation.draftAnswer = 'Thank you.';
    submitTutorConversationTurn(h.view); await flush();
    const later = h.requests.filter(input => input.kind === 'conversationTurn').at(-1)!;
    assert.equal(JSON.parse(later.input).tutorRole, handoff.role);
    assert.equal(JSON.parse(later.input).voiceGender, 'female');
    assert.doesNotMatch(later.instruction, /KREN detected/u);
  });
  it('leaves the role and voice alone without a handoff', () => {
    const h = harness();
    completeStandardTutorTurn(h.view, tutorConversationTurn(reply), 'Hello.', 'I need help.', false);
    assert.equal(h.view.tutorState.conversation.tutorRole, 'store clerk');
    assert.equal(h.view.tutorState.conversation.liveVoice, 'Enceladus');
    assert.equal(h.panel.query('[data-tutor-handoff]'), null);
  });
  it.each(['female', 'male'] as const)('uses planned %s presets for Edge and Chirp after a handoff', async gender => {
    const h = harness();
    completeStandardTutorTurn(h.view, tutorConversationTurn({ ...reply, handoff: { role: 'Alex, the supervisor', gender } }),
      'Hello.', 'I need help.', false);
    await readTutorConversationText(h.view, 'Hello.');
    // Changed 2026-10-16: V248, owner item I25, handoff Edge speech follows the planned preset.
    assert.equal(h.voices.at(-1), tutorConversationVoicePlan(h.view).current.edgeVoice);
    h.settings.tutorReadAloudProvider = 'googleChirp';
    await readTutorConversationText(h.view, 'Hello.');
    // Changed 2026-10-16: V248, owner item I25, Chirp receives the character's preset without remapping it to a stored default.
    assert.equal(h.voices.at(-1), tutorConversationVoicePlan(h.view).current.liveVoice);
  });
  it('sends a turn-only instruction with a typed Live answer', async () => {
    const h = harness(), sent: Array<{ text: string; note?: string }> = [];
    h.view.tutorState.conversation.replies = 'liveGemini';
    const controller = new AbortController(); h.view.tutorConversationController = controller;
    h.view.tutorLiveSession = { sendTurn: async (text: string, note?: string) => {
      sent.push({ text, note }); h.view.tutorLiveReplyText = reply.reply;
    }, takeHandoff: () => undefined } as never;
    await submitLiveTutorTurn(h.view, tutorConversationTurnRequest(request), controller, manager, request.question, manager, false);
    assert.equal(sent[0]!.text, manager); assert.match(sent[0]!.note!, /For this turn only:.*Hand over now/u);
  });
  it('accepts the Live tool signal, requests the new voice and resumes history without replacing the composer', async () => {
    const h = harness(), socket = new Socket();
    const session = new TutorLiveSession({ apiKey: ['unit', 'test', 'credential'].join('-'), model: 'test-model',
      systemInstruction: 'Practice English.', handoffEnabled: true, socketFactory: () => socket, onText: () => {}, onAudio: () => {} });
    const connecting = session.connect(); socket.open(); await connecting;
    assert.equal(socket.sent[0]!.setup.tools[0].functionDeclarations[0].name, 'handoff');
    h.view.tutorLiveSession = session;
    h.view.tutorState.conversation.replies = 'liveGemini';
    h.view.tutorLiveInputText = manager;
    h.panel.message({ command: 'tutorLiveInputFragment', text: manager, reset: true });
    beginTutorLiveSpokenReply(h.view, true);
    assert.ok(socket.sent.some(message => JSON.stringify(message.clientContent ?? {}).includes('Hand over now')));
    socket.frame({ toolCall: { functionCalls: [{ id: 'handoff-turn', name: 'handoff', args: handoff }] } });
    assert.equal(socket.sent.at(-1)!.toolResponse.functionResponses[0].id, 'handoff-turn');
    h.view.tutorLiveReplyText = reply.reply;
    const composer = h.panel.query('[data-tutor-transcript]');
    assert.ok(composer);
    await completeTutorLiveSpokenTurn(h.view, h.view.tutorLiveSpokenTurn!); await flush();
    assert.equal(socket.closed, true);
    assert.equal(h.view.tutorState.conversation.tutorRole, handoff.role);
    assert.equal(h.panel.query('[data-tutor-handoff]')?.textContent, 'Sarah, the store manager, joins the conversation.');
    assert.ok(h.panel.query('[data-tutor-handoff-connecting]'));
    const replacement = h.sockets[0]!; replacement.open(); await flush();
    // Changed 2026-10-16: V248, owner item I25, the replacement Live session speaks in its planned preset.
    assert.equal(replacement.sent[0]!.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
      tutorConversationVoicePlan(h.view).current.liveVoice);
    const system = replacement.sent[0]!.setup.systemInstruction.parts[0].text;
    assert.ok(system.includes(handoff.role)); assert.ok(system.includes(manager)); assert.ok(system.includes(reply.reply));
    assert.equal(h.panel.query('[data-tutor-handoff-connecting]'), null);
    assert.equal(h.panel.query('[data-tutor-transcript]'), composer);
    closeTutorLiveSession(h.view);
  });
});

describe('V246 misheard English', () => {
  it.each([misheard, `${english} はい。`, `Your employee はい、せら。 was very polite and kind and I would like to give a positive feedback.`])(
    'removes a segment anywhere: %s', text => assert.equal(tutorLearnerTurnText(text), english));
  it('preserves the existing English request exception', () => {
    const text = 'How do I say 안녕하세요 in English?'; assert.equal(tutorLearnerTurnText(text), text);
  });
  it('commits only English to the balloon, coaching and model history, with a persistent note', async () => {
    const h = harness();
    h.view.tutorState.conversation.replies = 'liveGemini';
    h.view.tutorLiveSession = { sendNote: () => {}, takeHandoff: () => undefined } as never;
    h.view.tutorLiveInputText = misheard;
    h.panel.message({ command: 'tutorLiveInputFragment', text: misheard, reset: true });
    beginTutorLiveSpokenReply(h.view, true);
    const turn = h.view.tutorLiveSpokenTurn!;
    assert.equal(turn.learnerAnswer, english);
    assert.equal(JSON.parse(turn.coachingRequest.input).learnerAnswer, english);
    h.view.tutorLiveReplyText = 'Thank you for the feedback.';
    await completeTutorLiveSpokenTurn(h.view, turn); await flush();
    const shown = h.panel.query('[data-tutor-learner-answer]')?.textContent;
    assert.equal(shown, english);
    assert.equal(h.panel.query('[data-tutor-partially-heard]')?.textContent, 'Part of this turn could not be heard as English.');
    assert.equal(h.view.tutorConversationRawAnswers.get(0), english);
    assert.equal(tutorConversationTranscriptForModel(h.view)[0]!.learnerAnswer, english);
    assert.equal(tutorTakeHomeInput(h.view).turns[0]!.learnerAnswer, english);
    const $ = load(page(h.view.tutorState));
    assert.equal($('[data-tutor-partially-heard]').length, 1);
    assert.ok(!JSON.stringify(h.requests).includes('はい'));
  });
  it('preserves a non-Latin name in typed input', async () => {
    const h = harness(), text = 'I met 나 yesterday and we talked.';
    h.view.tutorState.conversation.draftAnswer = text;
    submitTutorConversationTurn(h.view); await flush();
    assert.equal(JSON.parse(h.requests.find(input => input.kind === 'conversationTurn')!.input).learnerAnswer, text);
    assert.equal(h.view.tutorState.conversation.transcript[0]!.learnerAnswer, text);
    assert.equal(h.view.tutorState.conversation.transcript[0]!.partiallyHeard, undefined);
  });
});

describe('V246 consistent Rephrase', () => {
  for (const coaching of ['afterwards', 'inline'] as const) for (const status of ['active', 'stopped'] as const) {
    it(`${coaching} ${status} uses the same timing on natural and corrected turns in initial and patched panels`, () => {
      const h = harness(), state = h.view.tutorState;
      Object.assign(state.conversation, { coaching, status, transcript: [
        { question: 'Hello.', learnerAnswer: 'I need help.', ...tutorConversationTurn(reply) },
        { question: 'Hello.', learnerAnswer: 'I needs help.', ...tutorConversationTurn(reply) }
      ] });
      const visible = coaching !== 'afterwards' || status === 'stopped';
      const initial = load(page(state));
      assert.equal(initial('[data-command="showTutorConversationRephrase"]').length, visible ? 2 : 0);
      const patched = mountedPanel(page({ ...state, conversation: { ...state.conversation,
        transcript: state.conversation.transcript.map(turn => ({ ...turn, coachingPending: true })) } }), () => {});
      const composer = patched.query('[data-tutor-transcript]');
      if (status === 'active') assert.ok(composer);
      for (const [index, turn] of state.conversation.transcript.entries()) {
        postTutorLiveTurnCommitted(h.view, turn, index);
        const committed = h.messages.at(-1)!; assert.equal(committed.showRephrase, visible);
        postTutorLiveTurnCoaching(h.view, turn, index, undefined);
        const message = h.messages.at(-1)!; assert.equal(message.showRephrase, visible);
        patched.message(message);
      }
      const controls = patched.document.querySelectorAll('[data-command="showTutorConversationRephrase"]');
      assert.equal(controls.length, visible ? 2 : 0);
      for (const control of controls) {
        assert.equal(control.tagName, 'BUTTON'); assert.equal(control.disabled, false);
        assert.equal(control.closest('details'), null);
      }
      assert.equal(patched.query('[data-tutor-transcript]'), composer);
    });
  }
});
