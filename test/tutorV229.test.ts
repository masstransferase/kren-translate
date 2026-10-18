// 2026-10-13: Owner regressions exercise prompts, returned text, and the mounted Live panel.
import { randomUUID } from 'node:crypto';
import { load } from 'cheerio';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
  window: {}, Uri: { joinPath: (...parts: unknown[]) => parts }, commands: { executeCommand: vi.fn() } }));
import * as generation from '../src/tutor/generation.js';
import { tutorConversationTakeHomeRequest } from '../src/tutor/takeHome.js';
import { createTutorViewState, tutorRecipeFromState } from '../src/tutor/state.js';
import { TUTOR_MAP, type TutorLesson } from '@kren/core/tutor';
import { renderKrenResultViewHtml, renderTutorExercises } from '../src/resultViewHtml.js';
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { openTutorLiveSession } from '../src/resultsViewConversation.js';
import { closeTutorLiveSession } from '../src/resultsViewLive.js';
import { beginTutorLiveReply } from '../src/resultsViewLive.js';
import { submitLiveTutorTurn } from '../src/resultsViewTurns.js';
import { mountedPanel } from './support/mountedPanel.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const roles = { tutorRole: 'store clerk', learnerRole: 'customer' };
const dialogue = 'You are the store clerk. The learner is the customer. Speak only as the store clerk; never speak as the customer.';
const coaching = "In this conversation you played the store clerk and the learner played the customer. You are now coaching the learner: every line you suggest, correct or quote as the learner's must be something the customer says, never the store clerk.";
const opening = { ...roles, kind: 'situation' as const, setting: 'You are buying groceries.', register: 'neutral' as const,
  sceneSlant: generation.TUTOR_CONVERSATION_SCENE_SLANTS[0] };
const turn = { ...roles, register: 'neutral' as const, recipeTargets: { supportingTargets: [] }, transcript: [],
  question: 'What would you like?', learnerAnswer: 'I need milk.' };
const card = { ...roles, source: 'situation' as const, demo: false, register: 'neutral', turns: [], demoLines: [] };
const state = createTutorViewState();
state.selection = [{ nodeId: TUTOR_MAP.find(node => node.kind === 'microTarget')!.id, role: 'primary' }];
const character = { name: 'Alex', role: 'store clerk', description: 'A clerk.' };
const requests = [
  ['opening', () => generation.tutorConversationOpeningRequest(opening), dialogue],
  ['turn', () => generation.tutorConversationTurnRequest(turn), dialogue],
  ['hint', () => generation.tutorConversationHintRequest({ ...roles, question: turn.question, setting: '', register: turn.register, recentTurns: [] }), coaching],
  ['corrections', () => generation.tutorConversationCorrectionsRequest({ ...turn, turns: [] }), coaching],
  ['Live coaching', () => generation.tutorConversationCoachingRequest(generation.tutorConversationTurnRequest(turn)), coaching],
  ['diagnosis', () => generation.tutorConversationDiagnosisRequest([], state.settings, undefined, { ...roles, register: turn.register }), coaching],
  ['take-home', () => tutorConversationTakeHomeRequest(card), coaching],
  ['Demo cast', () => generation.tutorConversationDemoCastRequest({ ...opening, counterpartGender: 'male', readerSideGender: 'female' }), 'The tutor role is store clerk and the learner role is customer.'],
  ['Demo batch', () => generation.tutorConversationDemoBatchRequest({ ...roles, scene: 'A store.', male: character,
    female: { ...character, role: 'customer', name: 'Sam' }, register: turn.register, transcript: [], exchanges: 2 }), 'The tutor role is store clerk and the learner role is customer.']
] as const;

it.each(requests)('%s assigns roles for the work this request does', (_name, build, sentence) => {
  const instruction = build().instruction;
  expect(instruction).toContain(sentence);
  if (sentence !== dialogue) expect(instruction).not.toContain('never speak as');
  expect(instruction).toMatch(/plain text.*without Markdown/u);
});
it('Live dialogue preserves its speaker assignment', () => {
  expect(generation.tutorConversationLiveSystemInstruction(opening, true)).toContain(dialogue);
});
it('take-home tryNext is a line the customer can say', () => {
  expect(tutorConversationTakeHomeRequest(card).instruction).toMatch(/tryNext.*one line.*learner.*customer.*say next time/u);
});
it.each(['dialogue', 'coaching', 'demo'] as const)('older conversations keep the %s role contract', mode => {
  const instruction = generation.tutorConversationRoleInstruction({ setting: opening.setting, rolesSwapped: true }, mode);
  expect(instruction).toMatch(/roles are swapped/u);
  if (mode === 'dialogue') expect(instruction).toContain(generation.TUTOR_SITUATION_ROLES_SWAPPED);
  if (mode === 'coaching') expect(instruction).toMatch(/now coaching the learner.*learner's.*never/u);
  if (mode === 'demo') { expect(instruction).toMatch(/both/u); expect(instruction).not.toMatch(/Speak only|never speak/u); }
});

const exercise = { id: 'gap', channel: 'written' as const, prompt: "There's ___ that the concert will be cancelled due to the storm.", targetIds: [] };
const reviewInput = { learnerAnswer: 'highly likely', exercise, activeTargets: [] };
it.each(['single', 'batch'] as const)('%s review judges the completed sentence', mode => {
  const request = mode === 'single' ? generation.tutorReviewGenerationRequest(reviewInput) : generation.tutorReviewBatchGenerationRequest([reviewInput]);
  expect(request.instruction).toMatch(/Insert.*learnerAnswer.*blank or blanks/u);
  expect(request.instruction).toMatch(/completed sentence.*grammar, naturalness.*target pattern/u);
  expect(request.instruction).toMatch(/correct only when the completed sentence is correct/u);
  expect(request.instruction).toMatch(/explanation.*completed sentence/u);
});
it.each([true, false])('review quotes and separates the answer for correct=%s', correct => {
  const viewState = createTutorViewState();
  viewState.exerciseSet = { schemaVersion: 1, mapVersion: '1.0.0', channel: 'written', exercises: [exercise] };
  viewState.reviews[exercise.id] = { schemaVersion: 1, exerciseId: exercise.id, learnerText: 'highly likely', correctedText: 'a high likelihood',
    correct: correct ? [{ excerpt: 'highly likely', reason: 'The completed sentence is natural.' }] : [],
    incorrect: correct ? [] : [{ excerpt: 'highly likely', corrected: 'a high likelihood', reason: 'The completed sentence needs a noun.', status: 'rule', category: 'grammar' }] };
  const $ = load(renderTutorExercises(viewState));
  expect($('.tutor-review-mark').text()).toMatch(/"highly likely"\. The completed sentence/u);
  expect($('.tutor-review-mark').closest('details').length).toBe(0);
});

const target = TUTOR_MAP.find(node => node.kind === 'microTarget')!;
const lesson: TutorLesson = { schemaVersion: 1, mapVersion: '1.0.0', lessonTitle: '**Likelihood**', level: 'B2',
  primaryTarget: { nodeId: target.id, label: target.label, kind: target.kind, role: 'primary', description: target.description }, supportingTargets: [],
  conceptExplanation: '__Use likelihood.__', patternStatement: '*Describe likelihood.*', interactionExplanation: '_Express a prediction._',
  rules: [{ statement: '**Use a natural pattern.**', status: 'rule' }], commonErrors: [], practice: [], answerKey: [], generationNotes: [],
  examples: [{ id: 'example', sentence: 'Rain is **highly likely** __today__.', targetIds: [target.id],
    annotations: [{ targetId: target.id, excerpt: '**highly likely**', explanation: '__An adverb and adjective.__' }] }] };
async function returned(request: generation.TutorStructuredGenerationRequest, value: unknown, provider: 'groq' | 'openai' | 'gemini' | 'cloudflare' = 'groq') {
  const content = JSON.stringify(value);
  const envelope = provider === 'gemini' ? { candidates: [{ content: { parts: [{ text: content }] } }] }
    : provider === 'openai' ? { output: [{ content: [{ type: 'output_text', text: content }] }] }
    : { choices: [{ message: { content } }] };
  return generation.requestTutorStructuredJson({ provider, model: 'test-model', apiKey: randomUUID(), accountId: 'test-account', thinkingOrEffort: 'auto', maxAttempts: 1 },
    request, new AbortController().signal, vi.fn(async () => new Response(JSON.stringify(envelope))) as typeof fetch);
}
it.each(['groq', 'openai', 'gemini', 'cloudflare'] as const)('%s lesson removes emphasis and retains the highlighted annotation', async provider => {
  const viewState = createTutorViewState(); viewState.selection = [{ nodeId: target.id, role: 'primary' }];
  const recipe = tutorRecipeFromState(viewState);
  const request = generation.tutorLessonGenerationRequest(recipe);
  const cleaned = await returned(request, lesson, provider) as TutorLesson;
  expect(cleaned.examples[0]!.sentence).toBe('Rain is highly likely today.');
  expect(cleaned.examples[0]!.annotations[0]!.excerpt).toBe('highly likely');
  viewState.lesson = { recipe, lesson: cleaned, findings: [] };
  const panel = mountedPanel(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
    activeScreen: 'tutor', tutor: viewState, proModels: [] }), vi.fn());
  expect(panel.query('[data-tutor-example-card]')!.textContent).not.toMatch(/\*|__/u);
  expect(panel.query('[data-tutor-example-card] .tutor-taught')?.textContent).toBe('highly likely');
});
it.each(['___ ___', '___  ___  ___'])('practice collapses %s and keeps separate gaps', async blanks => {
  const recipe = tutorRecipeFromState(state);
  const request = generation.tutorExerciseGenerationRequest({ schemaVersion: 1, recipe, count: 1, channel: 'written', examples: lesson.examples });
  const value = { schemaVersion: 1 as const, mapVersion: recipe.mapVersion, channel: 'written' as const, exercises: [
    { ...exercise, prompt: `**Try** to ${blanks} and stretch, then ___ again.`, exampleIndex: 0, expectedAnswer: '__relax__' }] };
  const cleaned = await returned(request, value) as typeof value;
  expect(cleaned.exercises[0]!.prompt).toBe('Try to ___ and stretch, then ___ again.');
  const practiceState = createTutorViewState(); practiceState.exerciseSet = cleaned;
  expect(load(renderTutorExercises(practiceState))('[data-tutor-exercise-card]').text()).not.toContain('**');
  expect(cleaned.exercises[0]!.expectedAnswer).toBe('relax');
  expect(request.instruction).toMatch(/exactly one ___ per gap.*number of words/u);
});
it('returned review, reply, and target quote are plain text without changing literal underscores or gaps', async () => {
  const request = generation.tutorConversationTurnRequest(turn);
  const value = { move: 'reaction', reply: '**Hello**, _customer_. Keep file_name and ___ gap.', replyQuote: '', correction: '__I need milk.__',
    targetId: '', explanation: '*Natural.*', rephrase: 'I would like **milk**.', rephraseWhy: '__Polite.__',
    targetMarks: [{ field: 'reply', targetId: target.id, quote: '**Hello**', occurrence: 0 }] };
  const cleaned = await returned(request, value) as typeof value;
  expect(cleaned.reply).toBe('Hello, customer. Keep file_name and ___ gap.');
  expect(cleaned.targetMarks[0]!.quote).toBe('Hello');
  expect(cleaned.explanation).toBe('Natural.');
});
it('returned review cleans every visible verdict field before rendering', async () => {
  const value = { schemaVersion: 1, exerciseId: exercise.id, learnerText: 'highly likely', correctedText: '**a high likelihood**', correct: [],
    incorrect: [{ excerpt: '__highly likely__', corrected: '*a high likelihood*', reason: '_The completed sentence needs a noun._', status: 'rule', category: 'grammar' }] };
  const cleaned = await returned(generation.tutorReviewGenerationRequest(reviewInput), value, 'openai') as typeof value;
  expect(cleaned.correctedText).toBe('a high likelihood');
  expect(cleaned.incorrect[0]).toMatchObject({ excerpt: 'highly likely', corrected: 'a high likelihood', reason: 'The completed sentence needs a noun.' });
  const reviewState = createTutorViewState(); reviewState.exerciseSet = { schemaVersion: 1, mapVersion: '1.0.0', channel: 'written', exercises: [exercise] };
  reviewState.reviews[exercise.id] = cleaned as never;
  expect(load(renderTutorExercises(reviewState))('.tutor-review-mark').text()).toContain('"highly likely". The completed sentence needs a noun.');
});

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());
it.each(['spoken', 'keyboard', 'keyboard during coaching'] as const)('Live %s late final sentence stays in its bubble and survives rendering', async mode => {
  vi.useFakeTimers();
  let panel!: ReturnType<typeof mountedPanel>;
  const listeners = new Map<string, Function>();
  const socket = { readyState: 1, send: vi.fn(), close: vi.fn(),
    addEventListener: (type: string, callback: Function) => listeners.set(type, callback), removeEventListener: vi.fn() };
  const frame = async (serverContent: Record<string, unknown>) => {
    listeners.get('message')!({ data: JSON.stringify({ serverContent }) }); await flush();
  };
  let finishCoaching!: (value: unknown) => void;
  const view = new KrenResultsViewProvider({ settings: () => PANEL_SETTINGS_FIXTURE, log: vi.fn(), notify: vi.fn(), stopReadAloud: vi.fn(),
    generateTutor: vi.fn(async (request: generation.TutorStructuredGenerationRequest) => request.kind === 'liveSessionCredential' ? { apiKey: randomUUID() }
      : mode === 'keyboard during coaching' ? new Promise(resolve => { finishCoaching = resolve; }) : {}) } as never, {} as never,
    undefined, undefined, () => socket as never, { start: async () => ({ play: vi.fn(), stop: vi.fn(), close: vi.fn() }) } as never);
  (view as unknown as { activeScreen: string }).activeScreen = 'tutor';
  Object.assign(view.tutorState.conversation, { status: 'active', replies: 'liveGemini', coaching: 'afterwards', speakerOn: true,
    currentQuestion: 'What would you like?', situationPicture: 'none' });
  if (mode === 'keyboard during coaching') view.tutorState.conversation.coaching = 'teaching';
  view.scheduleTutorConversationHintPrefetch = vi.fn();
  view.view = { webview: { cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }),
    set html(value: string) { panel = mountedPanel(value, vi.fn()); },
    postMessage: async (message: Record<string, unknown>) => { panel?.message(message); return true; } } } as never;
  view.render();
  const openingSession = openTutorLiveSession(view, 'Speak as a clerk.', new AbortController().signal, () => true);
  await flush(); listeners.get('open')!({});
  listeners.get('message')!({ data: JSON.stringify({ setupComplete: {} }) }); await openingSession;
  try {
    let submitted: Promise<void> | undefined;
    if (mode === 'spoken') await frame({ inputTranscription: { text: 'I need milk.' } });
    else {
      beginTutorLiveReply(view);
      const controller = new AbortController(); view.tutorConversationController = controller;
      Object.assign(view.tutorState.conversation, { busy: true, pendingAnswer: 'I need milk.' }); view.render();
      submitted = submitLiveTutorTurn(view, generation.tutorConversationTurnRequest(turn), controller, 'I need milk.', turn.question, 'I need milk.', false);
    }
    await frame({ outputTranscription: { text: 'The milk is in aisle two.' } });
    expect(view.tutorState.conversation.speechReveal).toBeUndefined();
    await frame({ turnComplete: true });
    if (mode === 'keyboard during coaching') expect(finishCoaching).toBeTypeOf('function');
    if (mode !== 'keyboard during coaching') expect(view.tutorState.conversation.transcript[0]!.reply).toBe('The milk is in aisle two.');
    await frame({ outputTranscription: { text: 'Please follow me.' } });
    await vi.advanceTimersByTimeAsync(1500); await flush();
    if (mode === 'keyboard during coaching') { finishCoaching({ correction: 'I need milk.', targetId: '', explanation: 'Already natural.', rephrase: 'I need milk.', rephraseWhy: 'Already natural.' }); await flush(); }
    await submitted;
    const full = 'The milk is in aisle two. Please follow me.';
    expect(panel.query('[data-tutor-reply-turn="0"]')!.textContent).toContain(full);
    expect(view.tutorState.conversation.transcript[0]!.reply).toBe(full);
    expect(view.tutorState.conversation.currentQuestion).toBe(full);
    // Changed 2026-10-18: V263, owner item I43, a ready turn exposes the microphone instead of a text box.
    expect(panel.query('[data-tutor-conversation-answer]')).toBeNull();
    view.render();
    expect(panel.query('[data-tutor-reply-turn="0"]')!.textContent).toContain(full);
    // A second late sentence still belongs to this bubble after the in-place/full-render transition.
    await frame({ outputTranscription: { text: 'It is beside the cheese.' } }); await flush();
    expect(panel.query('[data-tutor-reply-turn="0"]')!.textContent).toContain(full + ' It is beside the cheese.');
    expect(view.tutorState.conversation.transcript).toHaveLength(1);
    // A fresh learner turn resets assembly instead of inheriting the completed reply.
    await frame({ turnComplete: true });
    await frame({ inputTranscription: { text: 'Thanks. Where is the bread?' } });
    await frame({ outputTranscription: { text: 'The bread is in aisle three.' } });
    await frame({ turnComplete: true });
    expect(view.tutorState.conversation.transcript[1]!.reply).toBe('The bread is in aisle three.');
    expect(panel.query('[data-tutor-reply-turn="0"]')!.textContent).toContain(full);
    const beforeClose = panel.query('[data-tutor-transcript]')!.textContent;
    closeTutorLiveSession(view, false);
    await frame({ outputTranscription: { text: 'This retired session must stay retired.' } });
    expect(panel.query('[data-tutor-transcript]')!.textContent).toBe(beforeClose);
  } finally { closeTutorLiveSession(view, false); }
});
