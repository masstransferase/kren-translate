// 2026-10-11: V218 migrates card assertions to teaching fields and keeps evidence validation.
// 2026-10-10: V216 renames reader-facing Gemini profiles Free Tier and Paid; exact expectations follow the brief.
import { describe, expect, it, vi } from 'vitest';
const warning = vi.hoisted(() => vi.fn(async () => 'OK'));
vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn() }, env: {},
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback }) },
  // Changed 2026-10-23 (V300, verification R28): missing-picture actions now use the shared modal popup.
  window: { showWarningMessage: warning, showErrorMessage: vi.fn(async () => undefined) } }));
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { renderTutorConversation } from '../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import type { TutorStructuredGenerationRequest } from '../src/tutor/generation.js';
import { tutorConversationTakeHome, tutorConversationTakeHomeRequest, type TutorTakeHomeInput } from '../src/tutor/takeHome.js';
import { cancelTutorTakeHome, finalizeTutorTakeHome, speakTutorTakeHome, stopTutorTakeHomeSpeech, tutorTakeHomeInput } from '../src/resultsViewTakeHome.js';
import { ensureTutorConversationPicture } from '../src/resultsViewConversation.js';
import { tutorLessonConversationRemaining } from '../src/tutor/lessonConversation.js';
import { load } from 'cheerio';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import type { TutorLiveSocketEvent } from '../src/tutor/liveSession.js';
import { TutorLiveSessionError } from '../src/tutor/liveSession.js';
import { TUTOR_MAP } from '@kren/core/tutor';
import { releaseTutorConversationResources, disableTutorLive } from '../src/resultsViewLive.js';
import { applyTutorDiagnosticReport } from '../src/resultsViewLesson.js';
import { tutorDemoLiveVoice } from '../src/resultsViewDemo.js';
import { tutorReplayLearnerLiveVoice } from '../src/resultsViewReplay.js';

class ReadingSocket {
  readyState = 0;
  sent: string[] = [];
  listeners = new Map<string, Set<(event: TutorLiveSocketEvent) => void>>();
  send(data: string) { this.sent.push(data); }
  close = vi.fn(() => { this.readyState = 3; });
  addEventListener(type: string, listener: (event: TutorLiveSocketEvent) => void) {
    const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: (event: TutorLiveSocketEvent) => void) { this.listeners.get(type)?.delete(listener); }
  emit(type: string, value?: unknown) {
    if (type === 'open') this.readyState = 1;
    for (const listener of this.listeners.get(type) ?? []) listener({ data: JSON.stringify(value) });
  }
}

const card = { doneWell: [{ turnIndex: 0, quote: 'I like tea.', note: 'A complete sentence.' }], naturally: [], tryNext: 'I like tea.' };
function harness(generate = vi.fn(async (_request: TutorStructuredGenerationRequest, _route: unknown, _signal: AbortSignal): Promise<unknown> => card)) {
  const postMessage = vi.fn(async (_: unknown) => true);
  const actions = { generateTutor: generate, settings: vi.fn(() => ({ ...PANEL_SETTINGS_FIXTURE,
    credentialPresence: { geminiDefault: true, geminiAlternate: true } })), generateSituationPicture: vi.fn(async () => 'data:image/png;base64,AAAA'),
    log: vi.fn(), stopReadAloud: vi.fn(), readAloudText: vi.fn(async () => undefined),
    writeTutorPreferences: vi.fn(), notify: vi.fn() };
  const view = new KrenResultsViewProvider(actions as never, {} as never);
  view.tutorState.conversation = { ...view.tutorState.conversation,
    from: 'anything', replies: 'standard', status: 'active', speakerOn: false,
    transcript: [{ question: 'What do you like?', learnerAnswer: 'I like tea.', correction: 'I like tea.', explanation: 'Correct.' }] };
  view.view = { webview: { html: '', cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }), postMessage } } as never;
  const message = (command: string, input?: string) => (view as any).handleMessage({ command, input });
  return { view, actions, postMessage, generate, message };
}
describe('V205 closing and notices', () => {
  it('V212: Demo and Replay use Callirrhoe and Enceladus when voice settings are absent', () => {
    const h = harness();
    h.actions.settings.mockReturnValue({ ...h.actions.settings(), tutorLiveFemaleVoice: undefined, tutorLiveMaleVoice: undefined });
    expect(tutorDemoLiveVoice(h.view, 'female')).toBe('Callirrhoe');
    expect(tutorDemoLiveVoice(h.view, 'male')).toBe('Enceladus');
    h.view.tutorState.conversation.liveVoice = 'Kore';
    expect(tutorReplayLearnerLiveVoice(h.view)).toBe('Enceladus');
    h.view.tutorState.conversation.liveVoice = 'Puck';
    expect(tutorReplayLearnerLiveVoice(h.view)).toBe('Callirrhoe');
  });
  it('V212: FreeTier zero-quota pictures explain that billing is required', async () => {
    const h = harness(); h.view.tutorConversationScene = 'Cafe.';
    h.view.tutorState.conversation.situationPicture = 'intro';
    // Changed 2026-10-17: V259, R14 finding 1, quota diagnostics expose only the window category.
    h.actions.generateSituationPicture.mockRejectedValue(new Error(
      'Gemini HTTP 429 {"quotaCategory":"perDay","limit":"0"}'));
    ensureTutorConversationPicture(h.view);
    await vi.waitFor(() => expect(h.view.tutorConversationPictureStopped).toBe(true));
    const notice = 'Pictures paused: situation pictures need a Gemini Paid API key with billing enabled. The conversation continues without pictures.';
    expect(h.view.tutorState.conversation.picturePaused).toBe(notice);
    expect(h.postMessage).toHaveBeenCalledWith({ command: 'tutorPicturePaused', text: notice });
    expect(h.view.tutorState.conversation.status).toBe('active');
  });
  // Changed 2026-10-15: V241, owner item I6, Stop is quiet and Review now requests the card.
  it('probe A: one-turn Anything Review now requests exactly one card and renders it without diagnosis', async () => {
    const h = harness();
    await h.message('stopTutorConversation');
    expect(h.generate).not.toHaveBeenCalled();
    await h.message('reviewTutorConversation');
    await vi.waitFor(() => expect(h.generate).toHaveBeenCalledOnce());
    expect(h.generate.mock.calls[0]?.[0]).toMatchObject({ kind: 'conversationTakeHome' });
    await vi.waitFor(() => expect(renderTutorConversation(h.view.tutorState)).toContain('TAKE-HOME'));
    expect(renderTutorConversation(h.view.tutorState)).toContain('I like tea.');
    await h.message('stopTutorConversation');
    expect(h.generate).toHaveBeenCalledOnce();
    expect(h.actions.readAloudText).not.toHaveBeenCalled();
  });
  it('probe B: unfinished Source selection opens the modal and reverts without replacing the open MODE', async () => {
    const h = harness(); h.view.tutorState.conversation.status = 'idle';
    const render = vi.spyOn(h.view, 'render');
    await h.message('updateTutorConversationFrom', 'lesson');
    expect(warning).toHaveBeenLastCalledWith('Finish the lesson and its practice first.',
      { modal: true, detail: 'No lesson drafted yet.' }, 'OK');
    expect(h.view.tutorState.conversation.from).toBe('anything');
    expect(h.postMessage).toHaveBeenCalledWith({ command: 'tutorLessonSourceReverted', source: 'anything' });
    expect(render).not.toHaveBeenCalled();
    expect(load(renderTutorConversation(h.view.tutorState))('option[value="lesson"]').is('[disabled]')).toBe(false);
  });
  it('probe C: two quota failures pause pictures with the quota explanation and preserve the conversation', async () => {
    const h = harness(); h.view.tutorConversationScene = 'Cafe.';
    h.view.tutorState.conversation.situationPicture = 'intro';
    h.actions.generateSituationPicture.mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED'));
    ensureTutorConversationPicture(h.view);
    await vi.waitFor(() => expect(h.view.tutorConversationPictureStopped).toBe(true));
    expect(h.actions.generateSituationPicture).toHaveBeenCalledTimes(2);
    // Changed 2026-10-10: V212 explains Google's refusal and the possible billing requirement.
    expect(h.view.tutorState.conversation.picturePaused).toMatch(/Google refused.*quota.*billing enabled.*continues without pictures/u);
    expect(h.view.tutorState.conversation.status).toBe('active');
    expect(renderTutorConversation(h.view.tutorState)).toMatch(/Google refused.*quota/u);
  });
  it.each(['lesson', 'situation', 'anything'] as const)('makes a distinct schema for %s with zero-to-two evidence entries', (source) => {
    const input: TutorTakeHomeInput = { source, demo: false, register: 'neutral', turns: [], demoLines: [] };
    const request = tutorConversationTakeHomeRequest(input);
    expect(request.kind).toBe('conversationTakeHome');
    expect(request.schemaName).toBe('kren_tutor_conversation_take_home');
    expect(request.schema).toMatchObject({ properties: { doneWell: { minItems: 0, maxItems: 1 }, naturally: { minItems: 0, maxItems: 2 } } });
    expect(tutorConversationTakeHome({ doneWell: [], naturally: [], tryNext: 'Try a question.' }, input).doneWell).toEqual([]);
  });
  it.each([
    { doneWell: [{ turnIndex: 1, quote: 'I like tea.' }] },
    { doneWell: [{ turnIndex: 0, quote: 'Invented praise.' }] },
    { doneWell: [card.doneWell[0], card.doneWell[0], card.doneWell[0]] },
    // 2026-10-14: Better ways are one list, so an empty list replaces the empty native-version probe.
    { naturally: [{ turnIndex: 0, quote: 'I like tea.', alternatives: [], why: 'Use a natural verb.' }] },
    { tryNext: '' }, { tryNext: 1 }, { tryNext: 'I like tea. Could you help?' }, { doneWell: null }, { naturally: [null] }, { extra: 'field' }
  ])('logs invalid evidence or fields while retaining valid sections %#', (patch) => {
    const h = harness();
    // Changed 2026-10-15: V245, owner item I22, invalid evidence no longer discards other sections.
    const log = vi.fn();
    const result = tutorConversationTakeHome({ ...card, ...patch }, tutorTakeHomeInput(h.view), log);
    expect(log).toHaveBeenCalled();
    expect(result).toMatchObject('tryNext' in patch ? { naturally: card.naturally, doneWell: card.doneWell } : { tryNext: card.tryNext });
    if ('doneWell' in patch) expect(result.doneWell).toEqual(Array.isArray(patch.doneWell) && patch.doneWell.length > 1 ? card.doneWell : []);
    if ('naturally' in patch) expect(result.naturally).toEqual([]);
    if ('tryNext' in patch) expect(result.tryNext).toBe('');
    if ('extra' in patch) expect(result).not.toHaveProperty('extra');
  });
  it('accepts a correction beside an exact learner quote and escapes its markup in rendering', () => {
    const h = harness();
    // 2026-10-14: Escape the first better way in the list, preserving the markup assertion.
    const result = tutorConversationTakeHome({ ...card, naturally: [{ turnIndex: 0, quote: 'like tea', alternatives: ['<b>I enjoy tea.</b>', 'Tea is my favorite.'], why: 'Enjoy also expresses a preference.' }] }, tutorTakeHomeInput(h.view));
    h.view.tutorState.conversation.takeHome = { identity: 'x', card: result };
    const html = renderTutorConversation(h.view.tutorState);
    expect(html).toContain('&lt;b&gt;I enjoy tea.&lt;/b&gt;');
    expect(html).not.toMatch(/style=/);
  });
  it('uses original committed submissions and excludes drafts, skips and withheld turns', () => {
    const h = harness();
    h.view.tutorConversationRawAnswers.set(0, 'original submission');
    h.view.tutorState.conversation.draftAnswer = 'UNSENT';
    const turn = h.view.tutorState.conversation.transcript[0]!;
    h.view.tutorState.conversation.transcript.push({ ...turn, skipped: true }, { ...turn, learnerNotShown: true });
    const input = tutorTakeHomeInput(h.view);
    expect(input.turns).toEqual([{ turnIndex: 0, question: turn.question, learnerAnswer: 'original submission', reply: '' }]);
    expect(JSON.stringify(input)).not.toContain('UNSENT');
  });
  it('Demo uses scripted context but cannot attribute it to the learner', () => {
    const h = harness(); h.view.tutorState.conversation.demoMode = true;
    h.view.tutorState.conversation.demoLines = [{ speaker: 'male', text: 'Scripted.' }];
    const input = tutorTakeHomeInput(h.view);
    expect(input.turns).toEqual([]); expect(input.demoLines).toHaveLength(1);
    // Changed 2026-10-15: V245, owner item I22, demos drop learner evidence and keep scripted teaching.
    expect(tutorConversationTakeHome(card, input)).toMatchObject({ naturally: [], doneWell: [], tryNext: card.tryNext });
    h.view.tutorState.conversation.takeHome = { identity: 'demo', card: tutorConversationTakeHome({ doneWell: [], naturally: [], tryNext: 'Scripted.' }, input) };
    expect(renderTutorConversation(h.view.tutorState)).toContain('scripted examples, not your own speech');
  });
  // Changed 2026-10-15: V241, owner item I6, request the card explicitly after Stop.
  it('failure stays card-local, Retry makes a fresh request and succeeds', async () => {
    const h = harness(); h.generate.mockRejectedValueOnce(new Error('failure'));
    await h.message('stopTutorConversation'); await h.message('reviewTutorConversation');
    await vi.waitFor(() => expect(h.view.tutorState.conversation.takeHome?.failure).toContain('Try again'));
    expect(h.view.tutorState.conversation.failure).toBeUndefined();
    expect(renderTutorConversation(h.view.tutorState)).toContain('data-command="retryTutorTakeHome"');
    await h.message('retryTutorTakeHome');
    await vi.waitFor(() => expect(h.view.tutorState.conversation.takeHome?.card).toEqual(card));
    expect(h.generate).toHaveBeenCalledTimes(2);
  });
  // Changed 2026-10-15: V241, owner item I6, request the card explicitly after Stop.
  it.each(['cancelTutorTakeHome', 'startNewTutorConversation'] as const)('%s aborts a pending card and drops late results', async (command) => {
    let finish!: (value: unknown) => void;
    const h = harness(vi.fn((_r, _route, _signal) => new Promise((resolve) => { finish = resolve; })));
    await h.message('stopTutorConversation'); await h.message('reviewTutorConversation');
    const signal = h.generate.mock.calls[0]![2];
    await h.message(command);
    expect(signal.aborted).toBe(true);
    finish(card); await Promise.resolve(); await Promise.resolve();
    expect(h.view.tutorState.conversation.takeHome?.card).toBeUndefined();
  });
  // Changed 2026-10-15: V241, owner item I6, request the card explicitly after Stop.
  it('Back to chat hides the card and a later Stop only regenerates for new committed turns', async () => {
    const h = harness(); await h.message('stopTutorConversation'); await h.message('reviewTutorConversation');
    await vi.waitFor(() => expect(h.view.tutorState.conversation.takeHome?.card).toEqual(card));
    await h.message('resumeTutorConversation');
    expect(h.view.tutorState.conversation.takeHome?.hidden).toBe(true);
    await h.message('stopTutorConversation'); expect(h.generate).toHaveBeenCalledOnce();
    await h.message('resumeTutorConversation');
    h.view.tutorState.conversation.transcript.push({ ...h.view.tutorState.conversation.transcript[0]! });
    await h.message('stopTutorConversation'); expect(h.generate).toHaveBeenCalledOnce();
    await h.message('reviewTutorConversation'); expect(h.generate).toHaveBeenCalledTimes(2);
  });
  // Changed 2026-10-15: V241, owner item I6, request the card explicitly after Stop.
  it.each(['windowsLocal', 'edgeOnline'] as const)('reads through the tutor route with %s and stops when speaker turns off', async (voice) => {
    const h = harness(); h.view.tutorState.conversation.speakerOn = true;
    h.actions.settings.mockReturnValue({ ...h.actions.settings(), tutorReadAloudProvider: voice });
    await h.message('stopTutorConversation'); await h.message('reviewTutorConversation');
    await vi.waitFor(() => expect(h.actions.readAloudText).toHaveBeenCalledWith(expect.stringMatching(/Try next time:.*I like tea/u), 'en', 'tutor'));
    await h.message('toggleTutorConversationSpeaker');
    expect(h.view.tutorTakeHomeSpeechController).toBeUndefined();
    expect(h.actions.stopReadAloud).toHaveBeenCalled();
  });
  // Changed 2026-10-15: V241, owner item I6, request the card explicitly after Stop.
  it('speech failure keeps the text readable', async () => {
    const h = harness(); h.view.tutorState.conversation.speakerOn = true;
    h.actions.readAloudText.mockRejectedValue(new Error('speech failure'));
    await h.message('stopTutorConversation'); await h.message('reviewTutorConversation');
    await vi.waitFor(() => expect(h.view.tutorState.conversation.takeHome?.speechFailure).toContain('still available'));
    expect(h.view.tutorState.conversation.takeHome?.card).toEqual(card);
  });
  it('rendering and an active Live socket end do not initiate a card', () => {
    const h = harness(); renderTutorConversation(h.view.tutorState);
    finalizeTutorTakeHome(h.view);
    expect(h.generate).not.toHaveBeenCalled();
  });
  it.each(['missing', 'other'] as const)('picture pause explains %s without exposing response contents and clears on Start new', async (reason) => {
    const h = harness(); h.view.tutorConversationScene = 'Cafe.';
    h.view.tutorState.conversation.situationPicture = 'switching';
    if (reason === 'missing') h.actions.settings.mockReturnValue({ ...h.actions.settings(), credentialPresence: { geminiDefault: false, geminiAlternate: false } });
    else h.actions.generateSituationPicture.mockRejectedValue(new Error('RAW RESPONSE https://example.invalid/query'));
    ensureTutorConversationPicture(h.view);
    await vi.waitFor(() => expect(h.view.tutorState.conversation.picturePaused).toBeDefined());
    expect(h.view.tutorConversationPictureStopped).toBe(reason !== 'missing');
    // Changed 2026-10-22 (V294, owner I60/I64): deferred V293 wording identifies Paid and Credentials.
    expect(h.view.tutorState.conversation.picturePaused).toMatch(reason === 'missing' ? /Gemini Paid.*KREN menu, Credentials/u : /usable picture/u);
    expect(JSON.stringify(h.postMessage.mock.calls)).not.toMatch(/RAW RESPONSE|example.invalid/);
    h.view.tutorState.conversation.status = 'stopped';
    await h.message('startNewTutorConversation');
    expect(h.view.tutorState.conversation.picturePaused).toBeUndefined();
  });
  it('modal detail names current unviewed examples and unreviewed practice', () => {
    const h = harness(); const state = h.view.tutorState;
    state.lesson = { lesson: { examples: [{ id: 'a' }, { id: 'b' }] } } as never;
    state.lessonRevision = state.practiceLessonRevision = 1;
    state.viewedExampleIds = ['a'];
    state.exerciseSet = { exercises: [{ id: 'p' }, { id: 'q' }] } as never;
    state.reviews = { p: {} } as never;
    expect(tutorLessonConversationRemaining(state)).toBe('1 of 2 examples not viewed; 1 of 2 practice items not reviewed');
    state.practiceLessonRevision = 0;
    expect(tutorLessonConversationRemaining(state)).toContain('No current practice');
  });
  it.each(['startTutorConversation', 'startTutorConversationDemo'])('stale lesson %s opens the same modal and starts nothing', async (command) => {
    const h = harness(); h.view.tutorState.conversation.status = 'idle'; h.view.tutorState.conversation.from = 'lesson';
    await h.message(command); await vi.waitFor(() => expect(warning).toHaveBeenLastCalledWith(
      'Finish the lesson and its practice first.', { modal: true, detail: 'No lesson drafted yet.' }, 'OK'));
    expect(h.generate).not.toHaveBeenCalled(); expect(h.view.tutorState.conversation.status).toBe('idle');
  });
  it('card patch leaves the active answer box and transcript in place', () => {
    const source = readFileSync('src/resultViewHtml.ts', 'utf8');
    const body = source.match(/    function patchTutorTakeHome\(message\) \{([\s\S]*?)\n    \}/)![1];
    const cardNode = { innerHTML: '' }, answer = { value: 'Unsent answer.' }, transcript = {};
    class Element {}
    Object.setPrototypeOf(cardNode, Element.prototype);
    const nodes = new Map([['[data-tutor-take-home]', cardNode], ['[data-tutor-conversation-answer]', answer], ['[data-tutor-transcript]', transcript]]);
    runInNewContext(`function patchTutorTakeHome(message) {${body}}; patchTutorTakeHome({html: '<h2>TAKE-HOME</h2>'});`,
      { HTMLElement: Element, document: { querySelector: (selector: string) => nodes.get(selector) } });
    expect(cardNode.innerHTML).toContain('TAKE-HOME'); expect(answer.value).toBe('Unsent answer.'); expect(nodes.get('[data-tutor-transcript]')).toBe(transcript);
  });
  // Changed 2026-10-15: V241, owner item I6, request the card explicitly after Stop.
  it.each(['cancelTutorTakeHome', 'startNewTutorConversation', 'resetTutorSession'])('%s stops card speech and aborts its independent controller', async (command) => {
    const h = harness(); h.view.tutorState.conversation.speakerOn = true;
    h.actions.readAloudText.mockImplementation(() => new Promise(() => {}));
    await h.message('stopTutorConversation'); await h.message('reviewTutorConversation');
    await vi.waitFor(() => expect(h.view.tutorTakeHomeSpeaking).toBe(true));
    const controller = h.view.tutorTakeHomeSpeechController!;
    if (command === 'resetTutorSession') warning.mockResolvedValueOnce('Reset panel');
    await h.message(command);
    expect(controller.signal.aborted).toBe(true); expect(h.actions.stopReadAloud).toHaveBeenCalled();
    expect(h.view.tutorTakeHomeSpeaking).toBe(false);
  });
  // Changed 2026-10-15: V241, owner item I6, request the card explicitly after Stop.
  it('master Reset drops pending text, late results and the picture notice', async () => {
    let finish!: (value: unknown) => void;
    const h = harness(vi.fn((_r, _route, _signal) => new Promise((resolve) => { finish = resolve; })));
    h.view.tutorState.conversation.picturePaused = 'Pictures paused.';
    await h.message('stopTutorConversation'); await h.message('reviewTutorConversation'); const controller = h.view.tutorTakeHomeController!;
    warning.mockResolvedValueOnce('Reset panel'); await h.message('resetTutorSession');
    expect(controller.signal.aborted).toBe(true);
    finish(card); await Promise.resolve(); await Promise.resolve();
    expect(h.view.tutorState.conversation.takeHome).toBeUndefined();
    expect(h.view.tutorState.conversation.picturePaused).toBeUndefined();
  });
  // Changed 2026-10-15: V241, owner item I6, request the card explicitly after Stop.
  it('Apply discards a pending card and drops late results independently of prompt writing', async () => {
    let finish!: (value: unknown) => void;
    const generate = vi.fn((request: TutorStructuredGenerationRequest, _route: unknown, _signal: AbortSignal): Promise<unknown> =>
      request.kind === 'conversationTakeHome' ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({ prompt: 'Practice requests.' }));
    const h = harness(generate); await h.message('stopTutorConversation'); await h.message('reviewTutorConversation');
    const controller = h.view.tutorTakeHomeController!;
    h.view.tutorState.diagnosticReport = { summary: 'Practice requests.',
      targets: [{ nodeId: TUTOR_MAP.find((node) => !TUTOR_MAP.some((child) => child.parentId === node.id))!.id, role: 'primary' }],
      findings: [], focus: 'Requests.' } as never;
    await applyTutorDiagnosticReport(h.view);
    expect(controller.signal.aborted).toBe(true);
    finish(card); await Promise.resolve(); await Promise.resolve();
    expect(h.view.tutorState.conversation.takeHome).toBeUndefined();
  });
  it('Lesson Reset preserves an active conversation and creates no card', async () => {
    const h = harness(); h.view.tutorState.lesson = { lesson: { examples: [] } } as never;
    warning.mockResolvedValueOnce('Reset'); await h.message('resetTutorLesson');
    expect(h.view.tutorState.conversation.status).toBe('active'); expect(h.generate).not.toHaveBeenCalled();
  });
  // Changed 2026-10-15: V241, owner item I6, request the card explicitly after Stop.
  it('disposal aborts pending generation and preserves a completed card for this host session', async () => {
    const h = harness(); await h.message('stopTutorConversation'); await h.message('reviewTutorConversation');
    await vi.waitFor(() => expect(h.view.tutorState.conversation.takeHome?.card).toEqual(card));
    (h.view as any).abortTutorRequests();
    expect(h.view.tutorState.conversation.takeHome?.card).toEqual(card);
    expect(renderTutorConversation(h.view.tutorState)).toContain('TAKE-HOME');
    let finish!: (value: unknown) => void;
    h.generate.mockImplementationOnce((_r, _route, _signal) => new Promise((resolve) => { finish = resolve; }));
    finalizeTutorTakeHome(h.view, true); const controller = h.view.tutorTakeHomeController!;
    (h.view as any).abortTutorRequests();
    expect(controller.signal.aborted).toBe(true);
    finish(card); await Promise.resolve(); await Promise.resolve(); expect(h.view.tutorState.conversation.takeHome).toBeUndefined();
  });
  it('Live socket fallback does not stop the conversation or generate a card', () => {
    const h = harness(); h.view.tutorState.conversation.replies = 'liveGemini';
    disableTutorLive(h.view, new TutorLiveSessionError('socketClosed'), 'test');
    expect(h.view.tutorState.conversation.status).toBe('active'); expect(h.generate).not.toHaveBeenCalled();
  });
  // Changed 2026-10-15: V241, owner item I6, request the card explicitly after Stop.
  it('Live card reading uses the selected tutor voice without a Live session or microphone', async () => {
    const h = harness(); const socket = new ReadingSocket();
    const factory = vi.fn(() => socket);
    Object.defineProperty(h.view, 'tutorLiveSocketFactory', { value: factory });
    const player = { play: vi.fn(), close: vi.fn(), stop: vi.fn() };
    const start = vi.spyOn(h.view.waveOutPlayer, 'start').mockResolvedValue(player);
    h.generate.mockImplementation(async (request) => request.kind === 'liveSessionCredential'
      ? { apiKey: ['unit', 'test', 'credential'].join('-') } : card);
    Object.assign(h.view.tutorState.conversation, { replies: 'liveGemini', liveVoice: 'Kore', speakerOn: true });
    await h.message('stopTutorConversation'); await h.message('reviewTutorConversation');
    // Changed 2026-10-15: V240, owner item I4, the card is read by the selected tutor voice.
    await vi.waitFor(() => expect(h.actions.readAloudText).toHaveBeenCalledWith(expect.stringContaining('I like tea.'), 'en', 'tutor'));
    expect(factory).not.toHaveBeenCalled();
    expect(h.view.tutorLiveSession).toBeUndefined(); expect(h.view.tutorLiveMicrophone).toBeUndefined();
    expect(h.generate.mock.calls.map(([request]) => request.kind)).toEqual(['conversationTakeHome']);
    expect(socket.sent).toEqual([]); expect(start).not.toHaveBeenCalled(); expect(player.play).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(h.view.tutorTakeHomeSpeaking).toBe(false));
    expect(h.view.tutorTakeHomeSession).toBeUndefined(); expect(h.view.tutorTakeHomePlayer).toBeUndefined();
  });
  // Changed 2026-10-15: V241, owner item I6, request the card explicitly after Stop.
  it('speaker off while Live card narration is pending stops reading and retains the card', async () => {
    let finish!: () => void;
    const h = harness(); Object.assign(h.view.tutorState.conversation, { replies: 'liveGemini', speakerOn: true });
    // Changed 2026-10-15: V240, owner item I4, the card is read by the selected tutor voice.
    h.actions.readAloudText.mockImplementation(() => new Promise<undefined>((resolve) => { finish = () => resolve(undefined); }));
    const start = vi.spyOn(h.view.waveOutPlayer, 'start');
    await h.message('stopTutorConversation'); await h.message('reviewTutorConversation');
    await vi.waitFor(() => expect(h.actions.readAloudText).toHaveBeenCalledOnce());
    const signal = h.view.tutorTakeHomeSpeechController!.signal; await h.message('toggleTutorConversationSpeaker');
    expect(signal.aborted).toBe(true); expect(h.actions.stopReadAloud).toHaveBeenCalled();
    finish(); await Promise.resolve(); await Promise.resolve();
    expect(start).not.toHaveBeenCalled(); expect(h.view.tutorState.conversation.takeHome?.card).toEqual(card);
  });
  it.each(['windowsLocal', 'edgeOnline', 'googleChirp'] as const)('Live card uses the selected %s speech source without Live tokens', async (source) => {
    const h = harness();
    h.actions.settings.mockReturnValue({ ...h.actions.settings(), tutorReadAloudProvider: source });
    Object.assign(h.view.tutorState.conversation, { status: 'stopped', replies: 'liveGemini',
      liveVoice: 'Enceladus', speakerOn: true, takeHome: { identity: 'test', card } });
    const factory = vi.fn(); Object.defineProperty(h.view, 'tutorLiveSocketFactory', { value: factory });
    const start = vi.spyOn(h.view.waveOutPlayer, 'start');
    await speakTutorTakeHome(h.view);
    const calls = h.actions.readAloudText.mock.calls as unknown as unknown[][];
    expect(calls[0]?.slice(1)).toEqual(source === 'googleChirp' ? ['en', 'tutor', 'Puck'] : ['en', 'tutor']);
    expect(h.actions.readAloudText).toHaveBeenCalledOnce();
    expect(calls[0]?.[0]).toMatch(/Take-home.*I like tea/iu);
    expect(h.generate).not.toHaveBeenCalled(); expect(factory).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
    expect(h.view.tutorTakeHomeSpeaking).toBe(false);
  });
  it('Live card speech failure preserves the card, and Stop ignores a late speech rejection', async () => {
    const h = harness();
    Object.assign(h.view.tutorState.conversation, { status: 'stopped', replies: 'liveGemini', speakerOn: true, takeHome: { identity: 'test', card } });
    h.actions.readAloudText.mockRejectedValueOnce(new Error('Speech failed.'));
    await speakTutorTakeHome(h.view);
    expect(h.view.tutorState.conversation.takeHome?.speechFailure).toMatch(/could not be read aloud.*still available/iu);
    expect(h.view.tutorState.conversation.takeHome?.card).toEqual(card);
    let reject!: (error: Error) => void;
    h.view.tutorState.conversation.takeHome = { identity: 'test', card };
    h.actions.readAloudText.mockImplementationOnce(() => new Promise<undefined>((_resolve, fail) => { reject = fail; }));
    const reading = speakTutorTakeHome(h.view);
    const controller = h.view.tutorTakeHomeSpeechController!;
    stopTutorTakeHomeSpeech(h.view);
    expect(controller.signal.aborted).toBe(true); expect(h.actions.stopReadAloud).toHaveBeenCalled();
    reject(new Error('Late failure.')); await reading;
    expect(h.view.tutorState.conversation.takeHome?.speechFailure).toBeUndefined();
  });
  it('Demo failure does not create a card without learner evidence', async () => {
    const h = harness(); Object.assign(h.view.tutorState.conversation, { status: 'idle', speakerOn: true });
    h.actions.settings.mockReturnValue({ ...h.actions.settings(), tutorReadAloudProvider: 'edgeOnline' });
    h.generate.mockImplementation(async (request) => {
      if (request.kind === 'conversationDemoCast') throw new Error('Cast failed.');
      return { doneWell: [], naturally: [], tryNext: 'Try a polite question.' };
    });
    await h.message('startTutorConversationDemo');
    // Changed 2026-10-10: V212 suppresses every card state when the learner never answered.
    expect(h.generate.mock.calls.map(([request]) => request.kind)).toEqual(['conversationDemoCast']);
    expect(h.view.tutorState.conversation.takeHome).toBeUndefined();
    // 2026-10-10: V217 mentions TAKE-HOME in the switch help even when no card section exists.
    expect(load(renderTutorConversation(h.view.tutorState))('.tutor-take-home')).toHaveLength(0);
    expect(h.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      command: 'tutorTakeHomeReady', html: expect.stringContaining('TAKE-HOME') }));
  });
  // Changed 2026-10-15: V241, owner item I6, request the card explicitly after Stop.
  it('Demo Review now requests a scripted take-home card', async () => {
    const h = harness(); h.view.tutorState.conversation.demoMode = true;
    h.view.tutorState.conversation.demoLines = [{ speaker: 'male', text: 'Could you help?' }];
    h.generate.mockResolvedValue({ doneWell: [], naturally: [], tryNext: 'Could you help?' });
    await h.message('stopTutorConversation'); await h.message('reviewTutorConversation');
    // 2026-10-12: V227 accepts non-empty Demo lines without requiring a learner answer.
    await vi.waitFor(() => expect(h.view.tutorState.conversation.takeHome?.card).toBeDefined());
    expect(h.generate).toHaveBeenCalledOnce();
    expect(load(renderTutorConversation(h.view.tutorState))('.tutor-take-home')).toHaveLength(1);
  });
  it.each(['empty', 'skipped', 'withheld'] as const)('V212: Stop with only %s turns makes no request or card state', async (kind) => {
    const h = harness();
    h.view.tutorState.conversation.transcript = kind === 'empty' ? [] : [{
      ...h.view.tutorState.conversation.transcript[0]!,
      ...(kind === 'skipped' ? { skipped: true } : { learnerNotShown: true }) }];
    h.generate.mockResolvedValue({ doneWell: [], naturally: [], tryNext: 'Try a simple question.' });
    await h.message('stopTutorConversation');
    // Changed 2026-10-10: V212 requires no request, pending, failure, or card without a committed answer.
    expect(h.view.tutorState.conversation.takeHome).toBeUndefined();
    expect(h.generate).not.toHaveBeenCalled();
    // 2026-10-10: V217 mentions TAKE-HOME in the switch help even when no card section exists.
    expect(load(renderTutorConversation(h.view.tutorState))('.tutor-take-home')).toHaveLength(0);
    expect(h.postMessage.mock.calls.filter(([message]) => (message as any).command === 'tutorTakeHomeReady'))
      .toSatisfy((calls: Array<[any]>) => calls.every(([message]) => message.html === ''));
  });
  it('two quoted sentences remain valid and lesson context belongs to the conversation snapshot', () => {
    const h = harness();
    const c = h.view.tutorState.conversation;
    c.from = 'lesson'; c.transcript.push({ ...c.transcript[0]!, learnerAnswer: 'Could you help?' });
    c.lessonContext = { subject: 'Requests', targets: [], examples: [], missedPractice: [] };
    h.view.tutorState.preparedPrompt = 'UNRELATED';
    const input = tutorTakeHomeInput(h.view);
    expect(input.lessonContext).toBe(c.lessonContext);
    expect(JSON.stringify(input)).not.toContain('UNRELATED');
    // 2026-10-14: Keep both quoted entries while moving the first better way into the list.
    expect(tutorConversationTakeHome({ ...card, naturally: [0, 1].map((turnIndex) => ({ turnIndex, quote: turnIndex ? 'Could you help?' : 'I like tea.', alternatives: [turnIndex ? 'Could you give me a hand?' : 'I enjoy tea.', 'Would you help me?'], why: 'Use a natural expression.' })) }, input).naturally).toHaveLength(2);
  });
  it('the Source revert patch restores the selected choice without closing MODE or changing its fields', () => {
    const source = readFileSync('src/resultViewHtml.ts', 'utf8');
    const block = source.split("if (message.command === 'tutorLessonSourceReverted') {")[1]!.split("if (message.command === 'tutorPicturePaused')")[0]!;
    class Select { value = 'lesson'; }
    const select = new Select(), mode = { open: true }, register = { value: 'formal' }, sync = vi.fn();
    const query = vi.fn((selector: string) => selector === '[data-tutor-conversation-from]' ? select : undefined);
    runInNewContext(`if (true) {${block}`, { message: { source: 'anything' }, document: { querySelector: query },
      HTMLSelectElement: Select, syncTutorConversationMode: sync });
    expect(select.value).toBe('anything'); expect(mode.open).toBe(true); expect(register.value).toBe('formal');
    expect(sync).toHaveBeenCalledWith(select); expect(query).toHaveBeenCalledOnce();
  });
  it('the picture notice patches safe text in place without replacing the transcript', () => {
    const source = readFileSync('src/resultViewHtml.ts', 'utf8');
    const block = source.split("if (message.command === 'tutorPicturePaused') {")[1]!.split("if (message.command === 'tutorVoiceModelReady')")[0]!;
    class Element { textContent = ''; hidden = true; }
    const notice = new Element(), transcript = { textContent: 'Existing transcript.' };
    const query = vi.fn((selector: string) => selector === '[data-tutor-picture-paused]' ? notice : transcript);
    runInNewContext(`if (true) {${block}`, { message: { text: 'Pictures paused: no Gemini Paid key is set.' },
      HTMLElement: Element, document: { querySelector: query } });
    expect(notice.textContent).toContain('no Gemini Paid key'); expect(notice.hidden).toBe(false);
    expect(transcript.textContent).toBe('Existing transcript.'); expect(query).toHaveBeenCalledOnce();
  });
  it('two decode failures also show a plain picture pause message', async () => {
    const h = harness(); h.view.tutorConversationScene = 'Cafe.';
    h.view.tutorState.conversation.situationPicture = 'intro';
    ensureTutorConversationPicture(h.view);
    for (let index = 0; index < 2; index++) {
      await vi.waitFor(() => expect(h.view.tutorConversationPicturePending).toBeDefined());
      const pending = h.view.tutorConversationPicturePending!;
      await (h.view as any).handleMessage({ command: 'tutorConversationPictureFailed', requestId: pending.requestId, input: pending.image });
    }
    expect(h.view.tutorState.conversation.picturePaused).toContain('usable picture');
    expect(h.view.tutorState.conversation.status).toBe('active');
  });
  it('Start new during Stop cleanup prevents an obsolete closing request from beginning', async () => {
    for (const ending of ['startNew', 'disposal']) {
      const h = harness(); const stopping = h.message('stopTutorConversation');
      if (ending === 'startNew') await h.message('startNewTutorConversation');
      else { h.view.view = undefined; (h.view as any).abortTutorRequests(); }
      await stopping;
      expect(h.view.tutorState.conversation.status).toBe(ending === 'startNew' ? 'idle' : 'stopped');
      expect(h.generate).not.toHaveBeenCalled(); expect(h.view.tutorState.conversation.takeHome).toBeUndefined();
    }
  });
});
