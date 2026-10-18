import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { KrenResultsViewProvider } from '../../src/resultsView.js';
import { renderTutorConversation, renderTutorConversationCoachReply } from '../../src/resultViewHtml.js';
import { createTutorViewState, tutorConversationPreferences } from '../../src/tutor/state.js';
import { tutorConversationTurnRequest, tutorConversationLiveSystemInstruction, tutorConversationCoachOpening,
  TUTOR_CORRECTION_CLAUSE, TUTOR_CONVERSATION_REPHRASE_INSTRUCTION, TUTOR_CONVERSATION_MEANING_INSTRUCTION,
  TUTOR_SPOKEN_PUNCTUATION_INSTRUCTION } from '../../src/tutor/generation.js';
import { submitTutorConversationTurn, postTutorLiveTurnCoaching } from '../../src/resultsViewTurns.js';
import { appendTutorLiveReply, beginTutorLiveSpokenReply, completeTutorLiveSpokenTurn } from '../../src/resultsViewLive.js';
import { replayTutorQuestion } from '../../src/resultsViewReplay.js';
import { PANEL_SETTINGS_FIXTURE } from './panelSettingsFixture.js';
import { mountedPanel } from './mountedPanel.js';
import { assertTutorCoachInstruction } from './tutorCoachChecks.js';

const raw = 'i go there yesterday';
const response = { move: 'reaction', reply: 'You\'d say "I went there yesterday.", because it happened in the past. For the focus on being there, say "I was there yesterday.", or use "I visited yesterday." for a shorter form.',
  correction: 'I went there yesterday.', explanation: 'Use the past tense.', rephrase: 'I was there yesterday.',
  rephraseWhy: 'This focuses on being there.', alternatives: [{ text: 'I visited yesterday.', why: 'This is shorter.' }],
  spokenPunctuated: raw, replyQuote: '', targetId: '' };
const flush = async () => { for (let i = 0; i < 160; i++) await Promise.resolve(); };

export function checkV263Instruction() {
  const request = tutorConversationTurnRequest({ coach: true, register: 'neutral', recipeTargets: { supportingTargets: [] },
    transcript: [], question: '', learnerAnswer: 'How are you?', spoken: true });
  assertTutorCoachInstruction(request.instruction);
  for (const clause of [TUTOR_CORRECTION_CLAUSE, TUTOR_CONVERSATION_REPHRASE_INSTRUCTION,
    TUTOR_CONVERSATION_MEANING_INSTRUCTION, TUTOR_SPOKEN_PUNCTUATION_INSTRUCTION]) assert.ok(request.instruction.includes(clause));
  assert.equal((request.schema.properties as any).alternatives.minItems, 1);
  assert.equal((request.schema.properties as any).alternatives.maxItems, 2);
  assertTutorCoachInstruction(tutorConversationLiveSystemInstruction({ coach: true, kind: 'anything', register: 'neutral', sceneSlant: 'the counterpart is friendly and curious' }, false));
}

export function checkV263Highlights() {
  const paragraph = 'This is natural. Say “Hey, how’s it going”? for a casual opening, or "<b>Rain & wind</b>." for a fuller form.';
  const turn = { learnerAnswer: 'Hello.', correction: 'Hello.', rephrase: "Hey, how's it going?",
    alternatives: [{ text: '<b>Rain & wind</b>.', why: 'A fuller form.' }, { text: 'Absent expression.', why: 'Not said.' }] };
  // Changed 2026-10-18: V265, owner item I46, highlighting depends only on the quoted paragraph.
  const $ = load(renderTutorConversationCoachReply(paragraph));
  assert.equal($.root().text(), paragraph);
  assert.equal($('b').length, 0);
  assert.deepEqual($('.tutor-review-corrected').map((_, node) => $(node).text()).get(), ['Hey, how’s it going', '<b>Rain & wind</b>.']);
  assert.ok(!$.root().text().includes('Absent expression.'));
  const missing = load(renderTutorConversationCoachReply('This is already natural.'));
  assert.equal(missing.root().text(), 'This is already natural.');
  assert.equal(missing('.tutor-review-corrected').length, 0);
}

function harness(model = response) {
  const logs: string[] = [], spoken: string[] = [], messages: any[] = [], commands: any[] = [];
  const settings = { ...PANEL_SETTINGS_FIXTURE, tutorReadAloudProvider: 'edgeOnline' as const,
    tutorConversationTakeHome: false, tutorConversationHintPrefetch: false };
  const actions = { settings: () => settings, log: (line: string) => logs.push(line), notify: () => {},
    stopReadAloud: () => {}, refreshReadAloudVoices: async () => {},
    readAloudText: async (text: string) => { spoken.push(text); }, generateTutor: async () => model };
  const view = new KrenResultsViewProvider(actions as never, {} as never);
  (view as any).activeScreen = 'tutor';
  Object.assign(view.tutorState.conversation, { status: 'active', from: 'speakAndRephrase', replies: 'standard',
    speakerOn: false, currentQuestion: 'Say anything in English.', situationPicture: 'none' });
  let panel!: ReturnType<typeof mountedPanel>;
  view.view = { visible: true, webview: { cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }),
    set html(value: string) { panel = mountedPanel(value, message => commands.push(message)); },
    postMessage: async (message: any) => { messages.push(message); panel.message(message); return true; } } } as never;
  view.render();
  return { view, logs, spoken, messages, commands, panel: () => panel };
}

export async function checkV263Spoken(path: 'standard' | 'liveGemini') {
  const h = harness();
  const panel = h.panel();
  h.view.tutorState.conversation.replies = path;
  if (path === 'standard') {
    h.view.tutorState.conversation.speakerOn = true;
    submitTutorConversationTurn(h.view, raw); await flush();
    assert.deepEqual(h.spoken, [response.reply]);
    h.spoken.length = 0; replayTutorQuestion(h.view); await flush();
    assert.deepEqual(h.spoken, [response.reply]);
  } else {
    h.view.tutorLiveSession = { sendNote: () => {}, takeHandoff: () => undefined, close: () => {} } as never;
    h.view.tutorLiveInputText = raw;
    panel.message({ command: 'tutorLiveInputFragment', text: raw, reset: true });
    beginTutorLiveSpokenReply(h.view, true);
    const turn = h.view.tutorLiveSpokenTurn!;
    h.view.tutorLiveReplyText = response.reply;
    panel.message({ command: 'tutorLiveReplyFragment', text: response.reply, reset: true });
    await completeTutorLiveSpokenTurn(h.view, turn); await flush();
    assert.equal(h.panel(), panel, 'Live must patch the mounted panel');
    panel.message({ command: 'tutorLiveReplyFragment', index: 0, text: ' Keep the same meaning.' });
    assert.equal(panel.document.querySelectorAll('[data-tutor-reply-bubble] .tutor-review-corrected').length, 3,
      'A late Live transcript fragment must retain the coaching highlights');
  }
  const stored = h.view.tutorState.conversation.transcript[0]!;
  assert.equal(stored.learnerAnswer, 'I go there yesterday.');
  assert.equal(stored.spokenPunctuated, raw);
  const mounted = h.panel();
  assert.equal(mounted.query('[data-tutor-learner-answer]')?.textContent, 'I go there yesterday.');
  assert.equal(mounted.query('[data-tutor-turn-feedback]'), null);
  assert.equal(mounted.document.querySelectorAll('[data-tutor-reply-bubble] .tutor-review-corrected').length, 3);
  h.view.render();
  assert.equal(h.panel().document.querySelectorAll('[data-tutor-reply-bubble] .tutor-review-corrected').length, 3);
  assert.equal(h.panel().query('[data-tutor-turn-feedback]'), null);
}

export async function checkV263Missing() {
  const h = harness({ ...response, reply: 'This needs a past tense. Say "I went there yesterday." to show when it happened.' });
  submitTutorConversationTurn(h.view, raw); await flush();
  const turn = h.view.tutorState.conversation.transcript[0]!;
  postTutorLiveTurnCoaching(h.view, turn, 0, undefined);
  postTutorLiveTurnCoaching(h.view, turn, 0, undefined);
  const lines = h.logs.filter(line => line.includes('coach quoted-expression check failed'));
  // Changed 2026-10-18: V265, owner item I46, differences from structured review fields are no longer errors.
  assert.equal(lines.length, 0);
  assert.ok(!h.logs.some(line => line.includes(turn.rephrase!)));
  assert.equal(h.panel().document.querySelectorAll('.tutor-review-corrected').length, 1);
  assert.ok(!h.panel().query('[data-tutor-reply-bubble]')?.textContent.includes(response.rephrase));
}

export async function checkV265Quotes(path: 'standard' | 'liveGemini') {
  const paragraph = 'The fixed form is "It is raining heavily here in Seoul". For a natural version, say \u201cIt is raining really hard here in Seoul\u201d, or use "It\'s pouring in Seoul," for an idiom. This fixes heavy to heavily. A single "word" stays plain. <b> & stays text.';
  const expected = ['It is raining heavily here in Seoul', 'It is raining really hard here in Seoul', "It's pouring in Seoul,"];
  const model = { ...response, reply: paragraph,
    correction: 'What are you doing today? It is raining heavily here in Seoul.',
    rephrase: "What are you up to today? It's pouring in Seoul.",
    alternatives: [{ text: 'How is your day going? It is raining hard in Seoul.', why: 'A casual opening.' }] };
  const h = harness(model);
  let panel = h.panel();
  h.view.tutorState.conversation.replies = path;
  const assertParagraph = (mounted = h.panel(), highlights = expected) => {
    const bubble = mounted.query('[data-tutor-reply-bubble]')!;
    assert.ok(bubble, 'The reader must have a visible KREN balloon');
    assert.equal(bubble.closest('[hidden], .hidden'), null);
    assert.deepEqual(bubble.querySelectorAll('.tutor-review-corrected').map(node => node.textContent), highlights);
    assert.equal(bubble.querySelector('b'), null, 'Model HTML must remain literal text');
    assert.ok(bubble.textContent.includes('<b> & stays text.'));
  };
  if (path === 'standard') {
    submitTutorConversationTurn(h.view, 'What are you doing today? It was heavy raining here in Seoul.');
    await flush();
    panel = h.panel();
  } else {
    h.view.tutorLiveSession = { sendNote: () => {}, takeHandoff: () => undefined, close: () => {} } as never;
    h.view.tutorLiveInputText = 'What are you doing today? It was heavy raining here in Seoul.';
    beginTutorLiveSpokenReply(h.view, true);
    appendTutorLiveReply(h.view, paragraph);
    assertParagraph(panel); // First fragments precede both commit and the structured check.
    await completeTutorLiveSpokenTurn(h.view, h.view.tutorLiveSpokenTurn!); await flush();
  }
  assertParagraph();
  assert.equal(h.panel(), panel, 'The active answer document must be patched in place');
  if (path === 'liveGemini') {
    appendTutorLiveReply(h.view, ' Another suggestion is "Rain is');
    assertParagraph(panel);
    appendTutorLiveReply(h.view, ' falling hard."');
    expected.push('Rain is falling hard.');
    assertParagraph(panel);
  }
  const turn = h.view.tutorState.conversation.transcript[0]!;
  postTutorLiveTurnCoaching(h.view, turn, 0, turn.generation);
  assertParagraph();
  assert.equal(h.panel(), panel, 'Coaching patches must retain the active answer document');
  await (h.view as any).handleMessage({ command: 'showSettings' });
  await (h.view as any).handleMessage({ command: 'showTutor' });
  assertParagraph(); // Back to chat uses the stored paragraph, including late fragments.
  h.view.tutorState.conversation.speakerOn = true;
  const replayed: unknown[] = [];
  if (path === 'liveGemini') {
    h.view.tutorLiveReplyAudio = [{ data: 'AAAA', mimeType: 'audio/pcm;rate=24000' }];
    h.view.tutorLiveReplyAudioComplete = true;
    (h.view as any).waveOutPlayer = { start: async () => ({ play: (chunk: unknown) => replayed.push(chunk), stop() {}, close() {} }) };
  }
  replayTutorQuestion(h.view); await flush();
  if (path === 'standard') assert.equal(h.spoken.at(-1), turn.reply);
  else assert.equal(replayed.length, 1, 'Replay uses the retained Live audio while keeping the quoted paragraph');
  assertParagraph();
  const restored = harness(model);
  restored.view.tutorState.conversation = structuredClone(h.view.tutorState.conversation);
  restored.view.render(); assertParagraph(restored.panel());
  for (const text of ['Say "heavy".', 'Say \u201cheavily\u201d.', 'Say "hello-world".']) {
    assert.equal(load(renderTutorConversationCoachReply(text))('.tutor-review-corrected').length, 0);
  }
  const escaped = load(renderTutorConversationCoachReply('Say "<b>Rain & wind</b>."'));
  assert.equal(escaped('b').length, 0);
  assert.equal(escaped('.tutor-review-corrected').text(), '<b>Rain & wind</b>.');
}

export function checkV263Microphone(from: 'anything' | 'situation' | 'lesson' | 'speakAndRephrase', replies: 'standard' | 'liveGemini') {
  const state = createTutorViewState();
  Object.assign(state.conversation, { from, replies, status: 'active', currentQuestion: 'A ready turn.', situationPicture: 'none' });
  const $ = load(renderTutorConversation(state, 'handy'));
  assert.equal($('[data-command="dictateTutorConversation"]').length, 1);
  assert.equal($('[data-tutor-chat-microphone] [data-command="dictateTutorConversation"]').length, 1);
  assert.equal($('[data-tutor-composer] [data-command="dictateTutorConversation"]').length, 0);
  assert.equal($('[data-command="submitTutorConversationTurn"], [data-tutor-conversation-answer], [data-tutor-conversation-send]').length, 0);
  const h = harness();
  Object.assign(h.view.tutorState.conversation, { from, replies }); h.view.tutorState.speech.handyStatus = 'available'; h.view.render();
  const panel = h.panel(), microphone = panel.query('[data-tutor-chat-mic-control]')!;
  assert.equal(microphone.closest('details, [hidden]'), null);
  assert.equal(microphone.getAttribute('tabindex'), null);
  assert.equal(microphone.disabled, false);
  if (replies === 'liveGemini') panel.message({ command: 'tutorLiveTalkState', available: true, listening: false, pressToTalk: true });
  panel.click(microphone);
  assert.equal(h.commands.at(-1)?.command, 'dictateTutorConversation');
  panel.message(replies === 'standard' ? { command: 'tutorDictationState', conversation: true, provider: 'handy', state: 'recording' }
    : { command: 'tutorLiveTalkState', available: true, listening: true, pressToTalk: true });
  assert.equal(panel.query('[data-tutor-chat-mic-control]'), microphone);
  assert.equal(microphone.getAttribute('aria-pressed'), 'true');
  assert.ok(microphone.classList.contains('tutor-microphone-pulsing'));
  if (replies === 'liveGemini') {
    panel.message({ command: 'tutorLiveInputFragment', text: 'My words are arriving', reset: true });
    assert.equal(microphone.closest('[hidden]'), null, 'Live must leave its only finish control reachable while transcribing');
  }
  panel.click(microphone);
  assert.equal(h.commands.filter(command => command.command === 'dictateTutorConversation').length, 2);
  panel.message(replies === 'standard' ? { command: 'tutorDictationState', conversation: true, provider: 'handy', state: 'idle' }
    : { command: 'tutorLiveTalkState', available: true, listening: false, pressToTalk: true });
  assert.equal(microphone.getAttribute('aria-pressed'), 'false');
}

export function checkV263PreferencesAndOpenings() {
  assert.deepEqual(tutorConversationPreferences({ send: 'button' }), { send: 'stopSpeaking' });
  for (const register of ['casual', 'neutral', 'professional', 'formal'] as const) for (const draw of [0, 0.4, 0.99]) {
    const opening = tutorConversationCoachOpening(register, () => draw);
    assert.match(opening, /English/u);
    assert.match(opening, /natural|wording|refine/u);
    assert.doesNotMatch(opening, /\?|your day|how are you|mood/iu);
  }
}
