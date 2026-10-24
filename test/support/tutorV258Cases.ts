import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { TUTOR_MAP, type TutorLesson } from '@kren/core/tutor';
import { createTutorViewState, tutorRecipeFromState } from '../../src/tutor/state.js';
import { reviewTutorExercise, reviewUnreviewedTutorExercises, cancelTutorReview } from '../../src/resultsViewPractice.js';
import { startTutorLessonGeneration, cancelTutorLesson } from '../../src/resultsViewLesson.js';
import { finalizeTutorTakeHome } from '../../src/resultsViewTakeHome.js';
import { writeTutorConversationHint } from '../../src/resultsViewHints.js';
import { submitStandardTutorTurn, stopTutorConversation } from '../../src/resultsViewTurns.js';
import { requestTutorDemoBatch } from '../../src/resultsViewDemo.js';
import { renderKrenResultViewHtml, renderTutorExercises } from '../../src/resultViewHtml.js';
import { ProviderError } from '../../src/errors.js';
import { CURRENT_REQUEST_POLICIES, recordedRequestOutcome, runTutorContentRequest, runFeatureRequest,
  runTutorGeneration, requestWithRetry, unwrapRequestOutcome, type RequestEvent, type TransportAttemptEvent } from '../../src/requestCenter.js';
import { LanguageModelUsageRecorder, configureLanguageModelUsage } from '../../src/languageModelUsage.js';
import { ProviderExhaustionState } from '../../src/languageModelSwitching.js';
import { runKrenOperation, runTutorStructuredRequest, type KrenRuntime, type TutorLanguageModelRoute } from '../../src/operations.js';
import type { TutorStructuredGenerationRequest } from '../../src/tutor/generation.js';
import { KrenResultsViewProvider } from '../../src/resultsView.js';
import { PANEL_SETTINGS_FIXTURE } from './panelSettingsFixture.js';

const target = TUTOR_MAP.find(node => !TUTOR_MAP.some(child => child.parentId === node.id))!;
const route: TutorLanguageModelRoute = { provider: 'gemini', model: 'gemini-3.6-flash', geminiProfile: 'standard',
  thinkingOrEffort: 'auto', fallbackEnabled: false, fallbackModel: 'gemini-fallback', fallbackThinkingOrEffort: 'low' };
const request: TutorStructuredGenerationRequest = { kind: 'lesson', instruction: 'Return a lesson.', input: 'private-input-marker', schema: {}, schemaName: 'probe' };
const turn = { question: 'When?', learnerAnswer: 'I reviewed it yesterday.', correction: '', explanation: '' };
const goodCard = { naturally: [{ turnIndex: 0, quote: turn.learnerAnswer, alternatives: ['I checked it yesterday.'], why: 'Use a past form.' }],
  doneWell: [], tryNext: 'I checked the plan yesterday.' };
const settle = async () => { for (let index = 0; index < 35; index++) await new Promise<void>(resolve => setImmediate(resolve)); };
function harness(generate: (request: TutorStructuredGenerationRequest, route: TutorLanguageModelRoute, signal: AbortSignal) => Promise<unknown>) {
  const state = createTutorViewState(); state.settings.routing = { ...state.settings.routing, ...route };
  state.settings.sentenceBand = 'medium'; state.selection = [{ nodeId: target.id, role: 'primary' }];
  const requests: TutorStructuredGenerationRequest[] = [], lines: string[] = [], patches: any[] = [];
  let renders = 0;
  // Changed 2026-10-22 (V293, owner I61/D22 A): one missing-key message with Open Credentials.
  const view = { showMissingCredentialError: KrenResultsViewProvider.prototype.showMissingCredentialError, tutorState: state, tutorGeneration: 0, tutorConversationTurnGeneration: 0, proModels: [], liveModels: [],
    tutorReviewControllers: new Map(), tutorHintControllers: new Map(), tutorExampleControllers: new Map(), tutorConversationRawAnswers: new Map(),
    render: () => { renders++; }, view: { webview: { html: 'Retained answer box', postMessage: (patch: unknown) => { patches.push(patch); return Promise.resolve(true); } } },
    actions: { settings: () => ({ ...PANEL_SETTINGS_FIXTURE, tutorConversationTakeHome: true, tutorProfile: 'standard',
      tutorModel: route.model, tutorFallbackEnabled: false }), log: (line: string) => lines.push(line), notify: () => {},
      stopReadAloud: () => {}, generateTutor: async (selected: TutorStructuredGenerationRequest, next: TutorLanguageModelRoute, signal: AbortSignal) => {
        requests.push(selected); return generate(selected, next, signal);
      } }
  } as unknown as KrenResultsViewProvider;
  return { view, requests, lines, patches, renders: () => renders };
}
function practice(view: KrenResultsViewProvider, count: number) {
  view.tutorState.exerciseSet = { schemaVersion: 1, mapVersion: '1.0.0', channel: 'written', exercises:
    Array.from({ length: count }, (_, index) => ({ id: `item-${index}`, channel: 'written', prompt: 'Write a sentence.', targetIds: [target.id] })) };
  view.tutorState.answers = Object.fromEntries(view.tutorState.exerciseSet.exercises.map(item => [item.id, `Answer ${item.id}.`]));
}
function validReview(selected: TutorStructuredGenerationRequest) {
  const body = JSON.parse(selected.input);
  return { schemaVersion: 1, exerciseId: body.exercise.id, learnerText: body.learnerAnswer,
    correct: [{ excerpt: body.learnerAnswer, reason: 'Natural wording.' }], incorrect: [] };
}
function lesson(view: KrenResultsViewProvider) {
  const recipe = tutorRecipeFromState(view.tutorState);
  const value: TutorLesson = { schemaVersion: 1, mapVersion: recipe.mapVersion, level: 'B2', lessonTitle: 'Pattern',
    primaryTarget: { ...target, nodeId: target.id, role: 'primary' }, supportingTargets: [], conceptExplanation: 'Concept.',
    patternStatement: 'Each example uses this pattern.', interactionExplanation: 'Interaction.', rules: [{ statement: 'Use this pattern.', status: 'rule' }],
    commonErrors: [], generationNotes: [], examples: Array.from({ length: recipe.output.exampleCount }, (_, index) => ({
      id: `example-${index}`, sentence: `Today the careful team applies this useful English pattern in example number ${index}.`, targetIds: [target.id],
      annotations: [{ targetId: target.id, excerpt: `example number ${index}`, explanation: 'Why it fits.' }] })) };
  return value;
}
function runtime(settings: Record<string, unknown> = {}): KrenRuntime {
  return { getSetting: <T>(key: string, fallback: T) => ({ 'llm.providerSwitch': false, 'gemini.retry.maxAttempts': 1, ...settings }[key] ?? fallback) as T,
    getSecret: async () => 'configured', beforeGeminiRequest: async () => {}, reserveCloudCharacters: async () => {},
    providerExhaustion: new ProviderExhaustionState(), log: () => {} };
}
async function withFetch(run: (sends: Array<{ url: string; body: string }>) => Promise<void>, response: (index: number) => Response) {
  const original = globalThis.fetch, sends: Array<{ url: string; body: string }> = [];
  globalThis.fetch = (async (url, init) => { sends.push({ url: String(url), body: String(init?.body ?? '') }); return response(sends.length - 1); }) as typeof fetch;
  try { await run(sends); } finally { globalThis.fetch = original; }
}
const gemini = (value: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }));
const page = (view?: KrenResultsViewProvider) => load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [],
  activeScreen: 'tutor', settings: PANEL_SETTINGS_FIXTURE, ...(view ? { tutor: view.tutorState } : {}) }));
export const cases: Array<{ name: string; run(): void | Promise<void> }> = [
  { name: 'refused batch sends one request for three pending reviews', run: async () => {
    const h = harness(async () => { throw new ProviderError('The provider declined this request.', undefined, false, undefined, 'refused'); });
    practice(h.view, 3);
    await reviewUnreviewedTutorExercises(h.view);
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0]!.kind, 'reviewBatch');
    assert.equal(Object.keys(h.view.tutorState.reviews).length, 0);
    assert.match(h.view.tutorState.practiceReviewBatchMessage!, /declined/u);
    const rendered = load(renderTutorExercises(h.view.tutorState));
    assert.match(rendered.text(), /declined/u); assert.equal(rendered('button[data-command="reviewUnreviewedTutorExercises"]').is(':disabled'), false);
  } },
  { name: 'failed batch falls back to three individual items', run: async () => {
    const h = harness(async selected => { if (selected.kind === 'reviewBatch') throw new ProviderError('Unavailable.', undefined, false, 503); return validReview(selected); });
    practice(h.view, 3); await reviewUnreviewedTutorExercises(h.view);
    assert.deepEqual(h.requests.map(item => item.kind), ['reviewBatch', 'review', 'review', 'review']);
    assert.equal(Object.keys(h.view.tutorState.reviews).length, 3);
    assert.equal(h.lines.filter(line => line === '[request recovery] review contentRetry').length, 3);
  } },
  { name: 'a partial batch retries only its missing item', run: async () => {
    const h = harness(async selected => selected.kind === 'reviewBatch' ? { reviews: [
      validReview({ ...selected, input: JSON.stringify({ exercise: { id: 'item-0' }, learnerAnswer: 'Answer item-0.' }) })] } : validReview(selected));
    practice(h.view, 2); await reviewUnreviewedTutorExercises(h.view);
    assert.deepEqual(h.requests.map(item => item.kind), ['reviewBatch', 'review']);
    assert.equal(JSON.parse(h.requests[1]!.input).exercise.id, 'item-1'); assert.equal(Object.keys(h.view.tutorState.reviews).length, 2);
  } },
  { name: 'single review rejects once and manual Retry sends one new request', run: async () => {
    let count = 0; const h = harness(async selected => ++count === 1 ? {} : validReview(selected)); practice(h.view, 1);
    assert.equal(await reviewTutorExercise(h.view, 'item-0'), 'failed'); assert.equal(h.requests.length, 1);
    const rendered = load(renderTutorExercises(h.view.tutorState)), retry = rendered('[data-tutor-review-retry]');
    assert.equal(retry.length, 1); assert.equal(retry.is(':disabled'), false); assert.equal(retry.closest('details, [hidden]').length, 0);
    assert.match(retry.text(), /retry/iu); assert.equal(retry.attr('data-command'), 'reviewTutorExercise');
    assert.equal(await reviewTutorExercise(h.view, 'item-0'), 'success'); assert.equal(h.requests.length, 2);
    assert.equal(h.view.tutorState.reviewFailures['item-0'], '');
  } },
  { name: 'lesson word-count recovery sends two requests then shows its warning', run: async () => {
    let answer: TutorLesson; const h = harness(async () => answer); answer = lesson(h.view);
    answer.examples.forEach((item, index) => { item.sentence = `Private example ${index}.`; item.annotations[0]!.excerpt = `${index}`; });
    startTutorLessonGeneration(h.view); await settle();
    assert.equal(h.requests.length, 2); assert.equal(h.requests[1]!.retry, true); assert.match(h.requests[1]!.instruction, /11 to 18 words/u);
    assert.ok(!h.requests[1]!.instruction.includes('Private example'));
    assert.equal(h.view.tutorState.lessonFailure, undefined);
    const warning = page(h.view)('.tutor-warning'); assert.equal(warning.length, 1); assert.match(warning.text(), /shorter.*11 to 18 words/u);
    assert.equal(warning.parents('details').length, 0);
    assert.deepEqual(recordedRequestOutcome(answer)?.recovery.map(item => item.decision), ['contentRetry']);
  } },
  { name: 'other lesson findings remain terminal without a content retry', run: async () => {
    const h = harness(async () => ({ ...lesson(h.view), rules: [] })); startTutorLessonGeneration(h.view); await settle();
    assert.equal(h.requests.length, 1); assert.ok(h.view.tutorState.lessonFailure);
  } },
  { name: 'Cancel ignores a late lesson and sends no quality retry', run: async () => {
    let resolve!: (value: unknown) => void;
    const h = harness(() => new Promise(done => { resolve = done; })); const prior = lesson(h.view);
    h.view.tutorState.lesson = { recipe: tutorRecipeFromState(h.view.tutorState), lesson: prior, findings: [] };
    startTutorLessonGeneration(h.view); cancelTutorLesson(h.view);
    resolve(prior); await settle(); assert.equal(h.requests.length, 1); assert.equal(h.view.tutorState.lesson?.lesson, prior);
    assert.match(h.view.tutorState.lessonFailure!, /canceled/u);
  } },
  { name: 'Cancel ignores a late review response', run: async () => {
    let resolve!: (value: unknown) => void; const h = harness(() => new Promise(done => { resolve = done; })); practice(h.view, 1);
    const pending = reviewTutorExercise(h.view, 'item-0'); cancelTutorReview(h.view, 'item-0');
    assert.equal(await pending, 'canceled'); resolve(validReview(h.requests[0]!)); await settle();
    assert.equal(h.requests.length, 1); assert.equal(h.view.tutorState.reviews['item-0'], undefined);
  } },
  { name: 'Stop ignores a late conversation response without another request', run: async () => {
    let resolve!: (value: unknown) => void, sends = 0;
    const actions = { settings: () => ({ ...PANEL_SETTINGS_FIXTURE, tutorConversationTakeHome: false }),
      generateTutor: async () => { sends++; return new Promise(done => { resolve = done; }); },
      log: () => {}, notify: () => {}, writeTutorPreferences: () => {}, updateSetting: () => {}, stopReadAloud: () => {} };
    const view = new KrenResultsViewProvider(actions as never, {} as never);
    Object.assign(view.tutorState.conversation, { status: 'active', replies: 'standard', speakerOn: false, busy: true });
    const controller = new AbortController(); view.tutorConversationController = controller;
    submitStandardTutorTurn(view, { ...request, input: JSON.stringify({ learnerAnswer: 'I went home.' }), kind: 'conversationTurn' },
      controller, 'I went home.', 'What happened?', 'I went home.', false);
    await stopTutorConversation(view); resolve({}); await settle();
    assert.equal(sends, 1); assert.equal(view.tutorState.conversation.status, 'stopped');
    assert.equal(view.tutorState.conversation.transcript.length, 0); assert.equal(view.tutorState.conversation.failure, undefined);
  } },
  { name: 'take-home salvage uses one request and patches the visible card', run: async () => {
    const h = harness(async () => ({ ...goodCard, naturally: [...goodCard.naturally, { ...goodCard.naturally[0], quote: 'private-answer-marker' }] }));
    Object.assign(h.view.tutorState.conversation, { status: 'stopped', from: 'anything', speakerOn: false, transcript: [turn] });
    finalizeTutorTakeHome(h.view); await settle(); assert.equal(h.requests.length, 1);
    const card = h.view.tutorState.conversation.takeHome?.card; assert.deepEqual(card?.naturally, goodCard.naturally);
    assert.deepEqual(recordedRequestOutcome(card)?.recovery.map(item => item.decision), ['salvage']);
    assert.ok(!h.lines.join(' ').includes('private-answer-marker'));
    const rendered = load(h.patches.filter(item => item.command === 'tutorTakeHomeReady').at(-1).html);
    assert.match(rendered('.tutor-take-home').text(), /checked the plan/u); assert.equal(rendered('.tutor-take-home').parents('details').length, 0);
    assert.equal(h.view.view!.webview.html, 'Retained answer box');
  } },
  { name: 'take-home manual Retry sends one request after a terminal failure', run: async () => {
    let count = 0; const h = harness(async () => ++count === 1 ? {} : goodCard);
    Object.assign(h.view.tutorState.conversation, { status: 'stopped', from: 'anything', speakerOn: false, transcript: [turn] });
    finalizeTutorTakeHome(h.view); await settle(); assert.equal(h.requests.length, 1); assert.ok(h.view.tutorState.conversation.takeHome?.failure);
    finalizeTutorTakeHome(h.view, true); await settle(); assert.equal(h.requests.length, 2); assert.ok(h.view.tutorState.conversation.takeHome?.card);
  } },
  { name: 'hint manual Retry patches success and clears failure without replacing the answer box', run: async () => {
    let count = 0; const h = harness(async () => ++count === 1 ? {} : { explanation: 'Name one event.', example: 'I arrived early.' });
    Object.assign(h.view.tutorState.conversation, { status: 'active', busy: false, currentQuestion: 'What happened?' });
    await writeTutorConversationHint(h.view); assert.equal(h.requests.length, 1); assert.ok(h.view.tutorState.conversation.hintFailure);
    await writeTutorConversationHint(h.view); assert.equal(h.requests.length, 2);
    assert.equal(h.view.tutorState.conversation.hintFailure, undefined);
    assert.equal(h.patches.filter(item => item.command === 'tutorConversationHintState').at(-1).hint.explanation, 'Name one event.');
    assert.equal(h.renders(), 0); assert.equal(h.view.view!.webview.html, 'Retained answer box');
  } },
  { name: 'Thorough Gemini review rejection logs one usage and one provider failure', run: async () => {
    const lines: string[] = [], recorder = new LanguageModelUsageRecorder({ get: (_key, fallback) => fallback, update: async () => {} }, line => lines.push(line));
    configureLanguageModelUsage(recorder);
    try {
      await withFetch(async sends => {
        const rt = runtime();
        const h = harness((selected, next, signal) => runTutorGeneration({ request: selected, route: next, signal, policy: CURRENT_REQUEST_POLICIES.tutor,
          generate: (request, route, signal) => runTutorStructuredRequest(rt, route, request, signal), log: () => {} }).then(unwrapRequestOutcome));
        practice(h.view, 1); assert.equal(await reviewTutorExercise(h.view, 'item-0'), 'failed'); assert.equal(sends.length, 1);
        assert.equal(lines.filter(line => line.startsWith('[usage]')).length, 1); assert.equal(lines.filter(line => line.startsWith('[provider failure]')).length, 1);
        assert.ok(!lines.join(' ').includes('Answer item-0.'));
      }, () => gemini({}));
    } finally { configureLanguageModelUsage(undefined); }
  } },
  { name: 'Free Tier Translate retries with the configured Gemini fallback', run: async () => {
    await withFetch(async sends => {
      const rt = runtime({ translationProvider: 'gemini', 'translation.provider': 'gemini', 'translation.geminiProfile': 'standard',
        'translation.model': 'gemini-3.6-flash', 'translation.fallbackEnabled': true, 'translation.fallbackModel': 'gemini-2.5-flash' });
      const result = await runKrenOperation(rt, 'translate', { text: 'Hello.' }, new AbortController().signal);
      assert.equal(sends.length, 2); assert.match(sends[0]!.url, /gemini-3.6-flash/u); assert.match(sends[1]!.url, /gemini-2.5-flash/u);
      assert.equal(result.kind, 'translation'); assert.deepEqual(recordedRequestOutcome(result)?.recovery.map(item => item.decision), ['fallback']);
    }, index => index === 0 ? new Response('{}', { status: 404 }) : gemini({ kind: 'translation', translatedText: 'Good morning.', alternatives: [], note: '' }));
  } },
  { name: 'content retry shares the transport request budget and safe event sink', run: async () => {
    const events: Array<RequestEvent | TransportAttemptEvent> = [], rt = runtime(); let sends = 0;
    const execute = (selected: TutorStructuredGenerationRequest, next: TutorLanguageModelRoute, signal: AbortSignal) =>
      runFeatureRequest({ runtime: rt, route: next, signal, policy: CURRENT_REQUEST_POLICIES.lesson, thinking: { tutor: selected },
        execute: async (route, _mode, signal) => requestWithRetry({ request: { feature: 'tutor', ...route }, signal, maxAttempts: 1,
          send: async () => { sends++; return new Response('{"answer":"private-answer-marker"}'); }, decode: envelope => envelope,
          failure: () => new ProviderError('Unavailable.') }, { event: event => events.push(event) }) }).then(unwrapRequestOutcome);
    let failure: unknown;
    try {
      await runTutorContentRequest({ request, route, signal: new AbortController().signal, generate: execute, totalRequests: 1,
        contentRetry: { allowance: 1 }, log: () => {}, event: event => events.push(event),
        validate: () => ({ type: 'rejected', cause: 'contentRejected', codes: ['contentRejected'] }) });
    } catch (error) { failure = error; }
    assert.equal(sends, 1); assert.equal(recordedRequestOutcome(failure)?.type, 'failed');
    assert.equal((recordedRequestOutcome(failure) as { cause?: string }).cause, 'budget');
    assert.equal(events.filter(event => event.type === 'usage').length, 1); assert.equal(events.filter(event => event.type === 'failure').length, 1);
    const diagnostics = JSON.stringify({ events, outcome: recordedRequestOutcome(failure) });
    for (const marker of ['private-input-marker', 'private-answer-marker']) assert.ok(!diagnostics.includes(marker));
    assert.ok(events.some(event => event.type === 'recovery' && event.recovery.decision === 'contentRetry'));
  } },
  { name: 'content recovery returns to the original route and forwards only its fixed repair instruction', run: async () => {
    const events: Array<RequestEvent | TransportAttemptEvent> = [], sent: Array<{ provider: string; instruction: string; input: string }> = [];
    const rt = runtime({ 'llm.providerSwitch': true }); let sends = 0;
    const result = await runTutorContentRequest({ request, route, signal: new AbortController().signal,
      contentRetry: { allowance: 1, on: ['wordCount'] }, log: () => {}, event: event => events.push(event),
      generate: (selected, next, signal) => runFeatureRequest({ runtime: rt, route: next, signal,
        policy: CURRENT_REQUEST_POLICIES.lesson, thinking: { tutor: selected }, execute: (actual, _mode, signal) =>
          requestWithRetry({ request: { feature: 'tutor', ...actual }, signal, maxAttempts: 1,
            send: async () => { sent.push({ provider: actual.provider, instruction: selected.instruction, input: selected.input });
              return ++sends === 1 ? new Response('{}', { status: 503 }) : new Response('{}'); },
            decode: () => ({ answer: sends === 2 ? 'private-answer-marker' : 'ready' }),
            failure: () => new ProviderError('Busy.', undefined, true, 503, 'overloaded')
          }, { event: event => events.push(event) }) }).then(unwrapRequestOutcome),
      validate: (value, attempt) => attempt === 0 ? { type: 'rejected', cause: 'contentRejected', codes: ['wordCount'],
        correctiveInstruction: 'Use the requested word band.' } : { type: 'accepted', value }
    });
    assert.deepEqual(sent.map(item => item.provider), ['gemini', 'groq', 'gemini']);
    assert.deepEqual(sent.map(item => item.input), [request.input, request.input, request.input]);
    assert.equal(sent[2]!.instruction, `${request.instruction}\n\nUse the requested word band.`);
    assert.deepEqual(recordedRequestOutcome(result)?.recovery.map(item => item.decision), ['switch', 'contentRetry']);
    assert.equal(recordedRequestOutcome(result)?.history.length, 3);
    assert.ok(!JSON.stringify(sent).includes('private-answer-marker'));
    for (const marker of ['private-input-marker', 'private-answer-marker']) assert.ok(!JSON.stringify(events).includes(marker));
  } },
  { name: 'primitive deferred content rejection uses the same once-only failure gate', run: async () => {
    const events: TransportAttemptEvent[] = [], rt = runtime();
    await assert.rejects(runTutorContentRequest({ request, route, signal: new AbortController().signal,
      contentRetry: { allowance: 0 }, log: () => {}, validate: () => { throw new Error('Private validator detail.'); },
      generate: (selected, next, signal) => runFeatureRequest({ runtime: rt, route: next, signal,
        policy: CURRENT_REQUEST_POLICIES.lesson, thinking: { tutor: selected }, execute: (actual, _mode, signal) =>
          requestWithRetry({ request: { feature: 'tutor', ...actual }, signal, maxAttempts: 1, send: async () => new Response('{}'),
            decode: () => 'private-answer-marker', failure: () => new ProviderError('Unavailable.') }, { event: event => events.push(event) })
      }).then(unwrapRequestOutcome) }));
    assert.deepEqual(events.map(event => event.type), ['usage', 'failure']);
    assert.ok(!JSON.stringify(events).includes('Private validator detail.')); assert.ok(!JSON.stringify(events).includes('private-answer-marker'));
  } },
  { name: 'Demo keeps one Fast escalation and has no additional content retry', run: async () => {
    const modes: unknown[] = [];
    const h = harness((selected, next, signal) => runTutorGeneration({ request: selected, route: next, signal,
      policy: CURRENT_REQUEST_POLICIES.tutor, log: () => {}, generate: async request => { modes.push(request.thinkingMode); return {}; } }).then(unwrapRequestOutcome));
    await assert.rejects(requestTutorDemoBatch(h.view, { scene: 'A store.', male: {}, female: {} } as never, [], 1, new AbortController()));
    assert.deepEqual(modes, ['fast', 'thorough']); assert.equal(h.requests.length, 1);
  } },
  { name: 'deferred Thorough corrections reject once and preserve the stopped transcript', run: async () => {
    const lines: string[] = [], rt = runtime();
    configureLanguageModelUsage(new LanguageModelUsageRecorder({ get: (_key, fallback) => fallback, update: async () => {} }, line => lines.push(line)));
    try {
      await withFetch(async sends => {
        const actions = { settings: () => ({ ...PANEL_SETTINGS_FIXTURE, tutorConversationTakeHome: false }),
          generateTutor: (request: TutorStructuredGenerationRequest, route: TutorLanguageModelRoute, signal: AbortSignal) => runTutorStructuredRequest(rt, route, request, signal),
          log: () => {}, notify: () => {}, writeTutorPreferences: () => {}, updateSetting: () => {}, stopReadAloud: () => {} };
        const view = new KrenResultsViewProvider(actions as never, {} as never);
        Object.assign(view.tutorState.conversation, { status: 'active', replies: 'liveGemini', coaching: 'afterwards', speakerOn: false,
          transcript: [{ ...turn, coachingPending: true }] });
        await stopTutorConversation(view); assert.equal(sends.length, 1); assert.equal(view.tutorState.conversation.status, 'stopped');
        assert.equal(view.tutorState.conversation.transcript[0]!.learnerAnswer, turn.learnerAnswer);
        assert.equal(view.tutorState.conversation.transcript[0]!.coachingFailed, true);
        assert.equal(lines.filter(line => line.startsWith('[usage]')).length, 1); assert.equal(lines.filter(line => line.startsWith('[provider failure]')).length, 1);
      }, () => gemini({}));
    } finally { configureLanguageModelUsage(undefined); }
  } },
  { name: 'rendered microphone pulse uses 2 seconds and retains reduced motion', run: () => {
    const css = page()('style').text();
    // Changed 2026-10-17: V261, F5 owner canvas edit, the listening pulse now takes two seconds per cycle.
    assert.match(css, /\.icon-button\.tutor-microphone-pulsing\s*\{\s*animation:\s*kren-tutor-microphone-pulse 2s ease-in-out infinite;/u);
    assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?\.icon-button\.tutor-microphone-pulsing\s*\{\s*animation: none;/u);
  } },
  { name: 'fallback controls are reachable on Free Tier for every Gemini feature', run: () => {
    const rendered = page();
    for (const prefix of ['translation', 'explanation', 'rewrite', 'userDictionary', 'tutor']) {
      const control = rendered(`[data-setting="${prefix}.fallbackEnabled"]`);
      assert.ok(control.length >= 1, prefix); assert.equal(control.closest('[data-gemini-profile-value="pro"]').length, 0, prefix);
      // Changed 2026-10-22 (V298, owner I70/D33 B): Fast covers fallback.
      assert.match(control.closest('label').text(), prefix === 'tutor' ? /Use Fast when Thorough is unavailable/u : /fallback/iu);
    }
    assert.match(rendered('#manual-screen').text(), /fallback supports Free Tier and Paid/u);
  } }
];
