// Changed 2026-10-18: V263, owner item I43, the in-chat microphone owns state and replaces the lower control.
// 2026-10-11: Opening speech, mounted controls, Handy focus, and concrete roles.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { load } from 'cheerio';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
  Uri: { joinPath: (...parts: unknown[]) => parts }, commands: { executeCommand: vi.fn() } }));
import { completeTutorConversationOpening } from '../src/resultsViewConversation.js';
import { cancelTutorConversationReplayAll } from '../src/resultsViewReplay.js';
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { GoogleChirpSpeech } from '../src/speech/speechCenter.js';
import { createTutorViewState } from '../src/tutor/state.js';
import { renderKrenResultViewHtml, renderTutorConversation } from '../src/resultViewHtml.js';
import { mountedPanel } from './support/mountedPanel.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { tutorConversationOpening, tutorConversationOpeningRequest, tutorConversationTurnRequest,
  tutorConversationRequestControls, tutorConversationCorrectionsRequest, tutorConversationCoachingRequest,
  tutorConversationHintRequest, tutorConversationDemoCastRequest, tutorConversationDemoBatchRequest,
  tutorConversationLiveSystemInstruction, tutorConversationDiagnosisRequest, TUTOR_SITUATION_ROLES } from '../src/tutor/generation.js';
import { tutorConversationStopRequest, tutorConversationTakeHomeRequest } from '../src/tutor/takeHome.js';
import { TUTOR_THINKING_MODES } from '../src/tutor/thinkingMode.js';

const roles = { tutorRole: 'store clerk', learnerRole: 'customer' };
const concrete = 'You are the store clerk. The learner is the customer. Speak only as the store clerk; never speak as the customer.';
const result = { ...roles, scene: 'A customer meets a store clerk.', opening: 'How can I help you?' };
// Changed 2026-10-15: V242, owner item I14, use a cooperative slant in the typed opening fixture.
const openingContext = { kind: 'situation' as const, setting: 'You are buying groceries from a store clerk.',
  register: 'neutral' as const, sceneSlant: 'the counterpart is strong, competent, well prepared' as const };
afterEach(() => vi.useRealTimers());

it.each([false, true])('opening schema and validation require both roles with learnerStarts=%s', learnerStarts => {
  const request = tutorConversationOpeningRequest({ ...openingContext, learnerStarts, rolesSwapped: true });
  expect(request.schema.required).toEqual(expect.arrayContaining(['scene', 'tutorRole', 'learnerRole']));
  expect(request.schema.properties).toMatchObject({ tutorRole: { type: 'string' }, learnerRole: { type: 'string' } });
  expect(request.instruction).toMatch(/roles are swapped/u);
  expect(request.instruction).toMatch(/tutorRole.*learnerRole.*six words/u);
  expect(JSON.parse(request.input).rolesSwapped).toBe(true);
  expect(TUTOR_THINKING_MODES.conversationOpening).toBe('thorough');
  const value = learnerStarts ? { ...roles, scene: result.scene } : result;
  expect(tutorConversationOpening(value, !learnerStarts)).toEqual(value);
  for (const invalid of [{ tutorRole: '' }, { learnerRole: ' ' }, { learnerRole: ' STORE  CLERK ' },
    { tutorRole: 'one two three four five six seven' }, { learnerRole: 'one two three four five six seven' }]) {
    expect(() => tutorConversationOpening({ ...value, ...invalid }, !learnerStarts)).toThrow(/roles/u);
  }
  expect(() => tutorConversationOpening({ scene: result.scene, ...(learnerStarts ? {} : { opening: result.opening }) }, !learnerStarts)).toThrow();
});

it('every conversation request kind carries the stored concrete roles, including both turn branches', () => {
  const state = createTutorViewState();
  Object.assign(state.conversation, roles);
  const controls = tutorConversationRequestControls(state.conversation);
  expect(controls).toMatchObject(roles);
  const turn = { ...controls, register: 'neutral' as const, recipeTargets: { supportingTargets: [] },
    transcript: [], question: result.opening, learnerAnswer: 'I need milk.' };
  const corrections = { ...controls, register: turn.register, recipeTargets: turn.recipeTargets,
    turns: [{ question: turn.question, learnerAnswer: turn.learnerAnswer }] };
  const card = { ...controls, source: 'situation' as const, demo: false, register: turn.register,
    turns: [{ turnIndex: 0, question: turn.question, learnerAnswer: turn.learnerAnswer, reply: 'Of course.' }], demoLines: [] };
  const character = { name: 'Alex', role: 'store clerk', description: 'A clerk.' };
  const requests = [tutorConversationTurnRequest(turn), tutorConversationTurnRequest({ ...turn, learnerAnswer: '?????' }),
    tutorConversationCoachingRequest(tutorConversationTurnRequest(turn)), tutorConversationCorrectionsRequest(corrections),
    tutorConversationHintRequest({ ...controls, question: turn.question, setting: '', register: turn.register, recentTurns: [] }),
    tutorConversationDemoCastRequest({ ...openingContext, ...controls, counterpartGender: 'male', readerSideGender: 'female' }),
    tutorConversationDemoBatchRequest({ ...controls, scene: result.scene, male: character,
      female: { ...character, role: 'customer', name: 'Sam' }, register: turn.register, transcript: [], exchanges: 2 }),
    tutorConversationStopRequest(corrections, card), tutorConversationTakeHomeRequest(card),
    tutorConversationDiagnosisRequest([], state.settings, undefined, { ...controls, register: turn.register })];
  // 2026-10-13: Coaching suggests the customer's lines; Demo scripts both roles.
  for (const request of requests) {
    expect(request.instruction, request.kind).toContain(roles.tutorRole);
    expect(request.instruction, request.kind).toContain(roles.learnerRole);
    if (request.kind === 'conversationTurn') expect(request.instruction).toContain(concrete);
    else if (request.kind.startsWith('conversationDemo')) expect(request.instruction).toMatch(/both.*roles/u);
    else expect(request.instruction).toMatch(/now coaching the learner.*customer says, never the store clerk/u);
  }
  expect(tutorConversationLiveSystemInstruction({ ...openingContext, ...controls }, true, undefined, result.scene)).toContain(concrete);
  expect(tutorConversationTurnRequest({ ...turn, tutorRole: undefined, learnerRole: undefined }).instruction).toContain(TUTOR_SITUATION_ROLES);
});

it.each([true, false])('Handy focuses the answer without scrolling from the in-chat=%s microphone', inChat => {
  // Changed 2026-10-18: V263, owner item I43, test the mounted microphone and private Handy capture instead of a text box.
  const state = createTutorViewState();
  Object.assign(state.conversation, { status: 'active', replies: 'standard', from: 'anything', currentQuestion: 'A ready turn.' });
  state.speech.handyStatus = 'available';
  const mounted = mountedPanel(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'tutor', proModels: [],
    settings: PANEL_SETTINGS_FIXTURE, tutor: state, tutorSpeechProvider: 'handy' }), () => {});
  const control = mounted.query('[data-tutor-chat-mic-control]')!;
  mounted.click(control);
  const capture = mounted.query('[data-tutor-handy-capture]')!;
  expect(mounted.document.activeElement).toBe(capture);
  expect(capture.getAttribute('tabindex')).toBe('-1');
  expect(capture.getAttribute('aria-hidden')).toBe('true');
  expect(control.closest('details, [hidden]')).toBeNull();
  expect(mounted.query('[data-tutor-conversation-answer]')).toBeNull();
  expect(mounted.query('[data-tutor-chat-mic-control]')).toBe(control);
});

function host(speakerOn = true, learnerStarts = false, reader?: () => Promise<void>) {
  const state = createTutorViewState();
  Object.assign(state.conversation, { status: 'active', busy: true, speakerOn, starts: learnerStarts ? 'learner' : 'kren',
    replies: 'standard', situationPicture: 'none' });
  const pending: Array<{ resolve(): void; reject(): void }> = [];
  const speech = vi.fn(reader ?? (() => new Promise<void>((resolve, reject) => pending.push({ resolve, reject: () => reject(new Error('Speech failed.')) }))));
  const messages: Array<Record<string, unknown>> = [];
  const controller = new AbortController();
  const view = { tutorState: state, tutorReplayAllGeneration: 0, tutorConversationController: controller,
    view: { webview: { postMessage: vi.fn((message: Record<string, unknown>) => { messages.push(message); return Promise.resolve(true); }) } },
    actions: { readAloudText: speech, stopReadAloud: vi.fn(), settings: () => PANEL_SETTINGS_FIXTURE },
    postTutorConversationStopState: vi.fn(), render: vi.fn() } as unknown as KrenResultsViewProvider;
  completeTutorConversationOpening(view, learnerStarts ? { ...roles, scene: result.scene } : result, controller, false);
  return { view, speech, pending, messages };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

it('Chirp fallback keeps the scene until Edge finishes and releases opening text on fallback', async () => {
  let f!: ReturnType<typeof host>;
  const fallbackEnds: Array<() => void> = [];
  const chirp = new GoogleChirpSpeech(async () => undefined,
    { play: vi.fn(), stop: () => false }, vi.fn(), vi.fn(), vi.fn(),
    () => KrenResultsViewProvider.prototype.tutorOpeningSpeechFallback.call(f.view));
  f = host(true, false, () => chirp.speak('One utterance.', { voice: 'Kore', ratePercent: 0, volume: 50 },
    () => new Promise<void>(resolve => fallbackEnds.push(resolve))));
  await flush();
  expect(fallbackEnds).toHaveLength(1);
  // 2026-10-12: A fallback start is not the end of the scene narration.
  expect(f.view.tutorState.conversation.openingReveal).toBe('scene');
  fallbackEnds[0]!(); await flush();
  expect(fallbackEnds).toHaveLength(2);
  expect(f.view.tutorState.conversation.openingReveal).toBe('opening');
  fallbackEnds[1]!(); await flush();
  expect(f.view.tutorState.conversation.openingReveal).toBeUndefined();
  expect(f.view.render).not.toHaveBeenCalled();
});

it('Standard reveals the scene, then the first line, then reachable learner controls as speech ends', async () => {
  const f = host();
  expect(f.view.tutorState.conversation).toMatchObject({ ...roles, openingReveal: 'scene' });
  expect(f.speech.mock.calls).toEqual([[result.scene, 'en', 'tutor']]);
  const html = () => load(renderTutorConversation(f.view.tutorState));
  expect(html()('[data-tutor-kren-bubble]').text()).not.toContain(result.opening);
  expect(html()('[data-tutor-chat-mic-control]').is('[hidden]')).toBe(true);
  expect(html()('[data-tutor-composer-stop]').is('[hidden]')).toBe(true);
  f.pending[0]!.resolve(); await flush();
  // 2026-10-12: Wait for the player's start, separately from the scene's completion.
  expect(f.view.tutorState.conversation.openingReveal).toBe('waiting');
  expect(html()('[data-tutor-kren-bubble]').text()).not.toContain(result.opening);
  f.view.tutorConversationSpeechStarted?.();
  expect(f.view.tutorState.conversation.openingReveal).toBe('opening');
  expect(html()('[data-tutor-kren-bubble]').text()).toContain(result.opening);
  expect(html()('[data-tutor-composer-stop]').is('[hidden]')).toBe(true);
  f.pending[1]!.resolve(); await flush();
  expect(f.view.tutorState.conversation.openingReveal).toBeUndefined();
  expect(html()('[data-tutor-chat-mic-control]').is('[hidden]')).toBe(false);
  expect(html()('[data-tutor-composer-stop]').closest('details')).toHaveLength(0);
  // Changed 2026-10-18: V263, owner item I43, readiness exposes the microphone only.
  expect(html()('[data-tutor-conversation-answer]')).toHaveLength(0);
  expect(f.view.render).not.toHaveBeenCalled();
  expect(f.messages.filter(m => m.command === 'tutorConversationOpeningReady').map(m => m.reveal)).toEqual(['scene', 'waiting', 'opening', 'ready']);
});

it('speaker off reveals the first line and controls at once without speech', () => {
  const f = host(false);
  const $ = load(renderTutorConversation(f.view.tutorState));
  expect(f.speech).not.toHaveBeenCalled();
  expect($('[data-tutor-kren-bubble]').text()).toContain(result.opening);
  expect($('[data-tutor-chat-mic-control], [data-tutor-composer-stop]').filter('[hidden]')).toHaveLength(0);
  expect(f.messages.find(m => m.command === 'tutorConversationOpeningReady')).toMatchObject({ opening: result.opening, reveal: 'ready' });
});
it('learner starts after the scene ends without a tutor utterance', async () => {
  const f = host(true, true);
  expect(f.view.tutorState.conversation.openingReveal).toBe('scene');
  f.pending[0]!.resolve(); await flush();
  expect(f.speech).toHaveBeenCalledOnce();
  expect(f.view.tutorState.conversation.openingReveal).toBeUndefined();
});
it.each(['failure', 'canceled', 'timeout'] as const)('a %s advances the opening without replacing the mounted draft', async event => {
  vi.useFakeTimers();
  const f = host();
  if (event === 'failure') f.pending[0]!.reject();
  if (event === 'canceled') cancelTutorConversationReplayAll(f.view);
  // 2026-10-12: Synthesis has a separate two-minute safety deadline.
  if (event === 'timeout') await vi.advanceTimersByTimeAsync(120_000);
  await flush();
  if (event === 'timeout') { expect(f.view.tutorState.conversation.openingReveal).toBe('waiting'); f.pending[1]!.resolve(); await flush(); }
  expect(f.view.tutorState.conversation.openingReveal).toBeUndefined();
  expect(f.view.tutorConversationOpeningWait).toBeUndefined();
  expect(f.view.render).not.toHaveBeenCalled();
});

// Minimal mounted DOM adapter: execute the shipped patch, keeping the same answer object.
it('opening patches hide the mirrored in-chat controls until speech finishes and preserve the draft', () => {
  const tutor = createTutorViewState();
  Object.assign(tutor.conversation, { status: 'active', busy: true, replies: 'standard' });
  const $ = load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'tutor', proModels: [],
    settings: PANEL_SETTINGS_FIXTURE, tutor }));
  const cache = new Map<unknown, Element>();
  class Element {
    value = 'My draft';
    constructor(public node: ReturnType<typeof $>) {}
    get disabled() { return this.node.is('[disabled]'); }
    set disabled(value: boolean) { if (value) this.node.attr('disabled', ''); else this.node.removeAttr('disabled'); }
    set hidden(value: boolean) { if (value) this.node.attr('hidden', ''); else this.node.removeAttr('hidden'); }
    set className(value: string) { this.node.attr('class', value); }
    get className() { return this.node.attr('class') ?? ''; }
    set textContent(value: string) { this.node.text(value); }
    set innerHTML(value: string) { this.node.html(value); }
    get innerHTML() { return this.node.html() ?? ''; }
    getAttribute(name: string) { return this.node.attr(name) ?? null; }
    hasAttribute(name: string) { return this.node.is('[' + name + ']'); }
    setAttribute(name: string, value: string) { this.node.attr(name, value); }
    removeAttribute(name: string) { this.node.removeAttr(name); }
    querySelector(selector: string) { return wrap(this.node.find(selector).first()); }
    querySelectorAll(selector: string) { return this.node.find(selector).toArray().map(node => wrap($(node))!); }
    cloneNode() { return wrap(this.node.clone())!; }
    appendChild(child: Element) { this.node.append(child.node); }
    replaceWith(child: Element) { this.node.replaceWith(child.node); }
    remove() { this.node.remove(); }
    title = '';
  }
  const wrap = (node: ReturnType<typeof $>): Element | null => {
    if (!node.length) return null;
    if (!cache.has(node[0])) cache.set(node[0], new Element(node));
    return cache.get(node[0])!;
  };
  const document = { querySelector: (selector: string) => wrap($(selector).first()),
    querySelectorAll: (selector: string) => $(selector).toArray().map(node => wrap($(node))!),
    createElement: (tag: string) => wrap($('<' + tag + '>'))! };
  const script = $('script').text();
  const patch = script.slice(script.indexOf('    function patchTutorConversationOpening('), script.indexOf('    function updateTutorConversationDiagnosis('));
  const microphone = script.slice(script.indexOf('    function tutorPictureMicrophoneMode('), script.indexOf('    function initializeTutorConversationPicture('));
  const answer = document.querySelector('[data-tutor-conversation-answer]')!;
  const context = { document, HTMLElement: Element, HTMLTextAreaElement: Element, HTMLButtonElement: Element, HTMLSelectElement: Element,
    patchTutorConversationScene: vi.fn(() => true), syncTutorResetAvailability: vi.fn(),
    patchTutorMarkedText: (paragraph: Element, text: string) => { paragraph.textContent = text; },
    updateTutorLiveReplay: vi.fn(), updateTutorLiveTalk: vi.fn(), message: {} };
  const apply = (message: Record<string, unknown>) => { context.message = message; runInNewContext(microphone + patch + '\npatchTutorConversationOpening(message);', context); };
  apply({ reveal: 'scene' });
  // Changed 2026-10-18: V263, owner item I43, opening phases hide the persistent microphone.
  expect($('[data-tutor-chat-microphone]').is('[hidden]')).toBe(true);
  expect($('[data-tutor-kren-bubble]').text()).not.toContain(result.opening);
  apply({ reveal: 'opening', opening: result.opening });
  expect($('[data-tutor-kren-bubble]').text()).toContain(result.opening);
  // Changed 2026-10-18: V263, owner item I43, opening phases hide the persistent microphone.
  expect($('[data-tutor-chat-microphone]').is('[hidden]')).toBe(true);
  apply({ reveal: 'ready' });
  expect($('[data-tutor-chat-microphone] [data-command="dictateTutorConversation"]')).toHaveLength(1);
  expect($('[data-tutor-chat-stop]').closest('details')).toHaveLength(0);
  expect($('[data-tutor-chat-stop]').is('[hidden]')).toBe(false);
  expect(document.querySelector('[data-tutor-conversation-answer]')).toBe(answer);
  // Changed 2026-10-18: V263, owner item I43, no answer element survives an opening because no answer box is drawn.
  expect(answer).toBeNull();
});
