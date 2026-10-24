import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { load } from 'cheerio';

vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) }, env: {} }));

import { TUTOR_MAP, TUTOR_LESSON_CODES, TUTOR_EXERCISE_CODES, TRAINING_REVIEW_CODES, validateTutorLesson, type TutorLesson } from '@kren/core/tutor';
import { tutorConversationTakeHome, type TutorTakeHomeInput } from '../src/tutor/takeHome.js';
import { createTutorViewState, tutorFindingMessage, tutorRecipeFromState } from '../src/tutor/state.js';
import { startTutorLessonGeneration, generateTutorExercises, regenerateTutorExample } from '../src/resultsViewLesson.js';
import { reviewTutorExercise } from '../src/resultsViewPractice.js';
import { finalizeTutorTakeHome } from '../src/resultsViewTakeHome.js';
import { ProviderExhaustionState, withProviderSwitch } from '../src/languageModelSwitching.js';
import { ProviderError } from '../src/errors.js';
import { renderKrenResultViewHtml, renderTutorTakeHome } from '../src/resultViewHtml.js';
import { KrenResultsViewProvider } from '../src/resultsView.js';
import type { KrenRuntime, TutorLanguageModelRoute } from '../src/operations.js';
import type { TutorStructuredGenerationRequest } from '../src/tutor/generation.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const input: TutorTakeHomeInput = { source: 'anything', demo: false, register: 'neutral', demoLines: [],
  turns: [{ turnIndex: 3, question: 'When?', learnerAnswer: 'I reviewed it yesterday.', reply: 'Thanks.' }] };
const naturally = { turnIndex: 3, quote: 'I reviewed it yesterday.', alternatives: ['I checked it yesterday.'], why: 'Use the past form.' };
const card = { naturally: [naturally], doneWell: [], tryNext: 'I checked the plan yesterday.' };
const codePattern = /\b[a-z]+\.[a-zA-Z]+\b/u;

it('salvages a bad naturally entry and patches the visible card while logging only its field and check', async () => {
  const state = createTutorViewState(); state.conversation.status = 'stopped'; state.conversation.speakerOn = false;
  const postMessage = vi.fn();
  const log = vi.fn();
  // Changed 2026-10-22 (V293, owner I61/D22 A): one missing-key message with Open Credentials.
  const view = { showMissingCredentialError: KrenResultsViewProvider.prototype.showMissingCredentialError, tutorState: state, actions: { settings: () => PANEL_SETTINGS_FIXTURE, log },
    view: { webview: { postMessage } } } as unknown as KrenResultsViewProvider;
  const badQuote = 'Invented private quote.';
  finalizeTutorTakeHome(view, false, { input, value: { ...card, naturally: [naturally, { ...naturally, quote: badQuote }] } });
  // Changed 2026-10-16: V258, F4 run 4, prepared-card validation now completes through the center.
  await vi.waitFor(() => expect(view.tutorState.conversation.takeHome?.card?.naturally).toEqual([naturally]));
  expect(log).toHaveBeenCalledWith('[conversation take-home] dropped naturally[1]: quote not in turn 3');
  expect(log.mock.calls.flat().join(' ')).not.toContain(badQuote);
  const patch = postMessage.mock.calls.filter(([message]) => message.command === 'tutorTakeHomeReady').at(-1)![0];
  const page = load(patch.html);
  expect(page('.tutor-take-home').text()).toContain(card.tryNext);
  expect(page('.tutor-take-home').text()).not.toContain(badQuote);
  expect(page('.tutor-take-home').parents('details')).toHaveLength(0);
});

it('accepts case and punctuation changes only for spoken evidence', () => {
  const value = { ...card, naturally: [{ ...naturally, quote: 'i reviewed it yesterday!' }] };
  expect(tutorConversationTakeHome(value, { ...input, turns: input.turns.map(turn => ({ ...turn, spoken: true })) }).naturally).toHaveLength(1);
  expect(tutorConversationTakeHome(value, input).naturally).toEqual([]);
});

it('trims a reason at a word boundary, drops unknown targets and surplus alternatives, and keeps tryNext alone', () => {
  const log = vi.fn();
  const reason = 'Practice describing past events with a clear subject and a past tense verb before adding more details.';
  const result = tutorConversationTakeHome({ ...card,
    naturally: [{ ...naturally, why: reason, alternatives: ['One.', 'Two.', 'Three.', 'Four.'] }],
    learningTargets: [{ targetId: 'unknown', why: 'Practice this.' }, { targetId: TUTOR_MAP[0]!.id, why: 'Practice this.' }] }, input, log);
  const trimmed = result.naturally[0]!.why;
  expect(trimmed.length).toBeLessThanOrEqual(90);
  expect(reason.startsWith(`${trimmed} `)).toBe(true);
  expect(result.naturally[0]!.alternatives).toEqual(['One.', 'Two.', 'Three.']);
  expect(result.learningTargets).toEqual([{ targetId: TUTOR_MAP[0]!.id, why: 'Practice this.' }]);
  expect(log.mock.calls.flat().join(' ')).toMatch(/learningTargets\[0\].targetId.*unknown identifier/u);
  expect(log.mock.calls.flat().join(' ')).toMatch(/alternatives\[3\].*exceeds 3/u);
  const alone = tutorConversationTakeHome({ tryNext: card.tryNext }, input);
  expect(alone).toEqual({ naturally: [], doneWell: [], tryNext: card.tryNext });
  const state = createTutorViewState(); state.conversation.takeHome = { identity: 'test', card: alone };
  expect(load(renderTutorTakeHome(state.conversation))('.tutor-take-home').text()).toContain(card.tryNext);
});

it.each([null, [], {}, { naturally: [{ ...naturally, quote: 'invented' }] }])('logs a specific whole-card failure %#', value => {
  const log = vi.fn();
  expect(() => tutorConversationTakeHome(value, input, log)).toThrow(/take-home/u);
  expect(log).toHaveBeenCalledWith(expect.stringMatching(/failed card: (response is not an object|no valid sections)/u));
});

it.each([...Object.values(TUTOR_LESSON_CODES), ...Object.values(TUTOR_EXERCISE_CODES), ...Object.values(TRAINING_REVIEW_CODES),
  'exercise.exampleIndexInvalid', 'exercise.expectedAnswerInvalid', 'exercise.exampleCopied', 'exercise.taskLineInvalid'])('explains %s as a sentence without an internal code', code => {
  const log = vi.fn();
  const message = tutorFindingMessage({ code, severity: 'error', subjects: [], detail: { actual: 1, requested: 2, field: 'rules' } },
    { minimumWords: 11, maximumWords: 18, log });
  expect(message).not.toMatch(codePattern);
  expect(message).toMatch(/[.!?]$/u);
  expect(log).not.toHaveBeenCalled();
});

it('uses the actual word band and logs an unknown code behind a plain fallback', () => {
  const log = vi.fn();
  expect(tutorFindingMessage({ code: 'lesson.wordCountBelowMinimum', severity: 'error', subjects: [] },
    { minimumWords: 19, maximumWords: 28 })).toBe('Some examples were shorter than your setting (19 to 28 words).');
  expect(tutorFindingMessage({ code: 'lesson.futureCheck', severity: 'error', subjects: [] }, { log }))
    .toBe("The lesson did not meet KREN's checks.");
  expect(log).toHaveBeenCalledWith('[tutor finding] unknown code: lesson.futureCheck');
});

const target = TUTOR_MAP.find(node => !TUTOR_MAP.some(child => child.parentId === node.id))!;
function fixture() {
  const state = createTutorViewState(); state.settings.sentenceBand = 'medium'; state.settings.routing.provider = 'gemini';
  state.selection = [{ nodeId: target.id, role: 'primary' }];
  const recipe = tutorRecipeFromState(state);
  const lesson: TutorLesson = { schemaVersion: 1, mapVersion: recipe.mapVersion, level: 'B2', lessonTitle: 'Pattern',
    primaryTarget: { ...target, nodeId: target.id, role: 'primary' }, supportingTargets: [],
    conceptExplanation: 'Concept.', patternStatement: 'Each example uses this pattern.', interactionExplanation: 'Interaction.', rules: [{ statement: 'Use this pattern.', status: 'rule' }],
    commonErrors: [], generationNotes: [], examples: Array.from({ length: recipe.output.exampleCount }, (_, index) => ({
      id: `example-${index}`, sentence: `Today the careful team applies this useful English pattern in example number ${index}.`,
      targetIds: [target.id], annotations: [{ targetId: target.id, excerpt: `example number ${index}`, explanation: 'Why it fits.' }] })) };
  state.lesson = { recipe, lesson, findings: [] }; state.viewedExampleIds = lesson.examples.map(example => example.id);
  // Changed 2026-10-22 (V293, owner I61/D22 A): one missing-key message with Open Credentials.
  const view = { showMissingCredentialError: KrenResultsViewProvider.prototype.showMissingCredentialError, tutorState: state, tutorGeneration: 0, tutorExampleControllers: new Map(), tutorReviewControllers: new Map(),
    tutorHintControllers: new Map(), render: vi.fn(), actions: { settings: () => PANEL_SETTINGS_FIXTURE, log: vi.fn(), notify: vi.fn(), generateTutor: vi.fn() } } as unknown as KrenResultsViewProvider;
  return { view, lesson, recipe };
}
const pageFor = (view: KrenResultsViewProvider) => load(renderKrenResultViewHtml({ nonce: 'test', cspSource: '', settings: PANEL_SETTINGS_FIXTURE,
  proModels: [], tutor: view.tutorState, activeScreen: 'tutor' }));
const settle = async (view: KrenResultsViewProvider) => vi.waitFor(() => expect(view.tutorState.lessonBusy || view.tutorState.exerciseBusy || view.tutorState.exampleBusyIds.length > 0).toBeFalsy());
function switchingRuntime() {
  return { getSetting: <T>(_key: string, fallback: T) => fallback, getSecret: async () => randomUUID(),
    providerExhaustion: new ProviderExhaustionState(), log: vi.fn() } as unknown as KrenRuntime;
}

it.each(['short', 'long', 'repaired'] as const)('retries word counts once, then retains a %s lesson with accurate visible feedback', async mode => {
  const { view, lesson, recipe } = fixture();
  const bad = structuredClone(lesson);
  bad.examples.forEach((example, index) => {
    example.sentence = mode === 'long' ? `${Array(30).fill('word').join(' ')} example ${index}.` : `An example ${index}.`;
    example.annotations[0]!.excerpt = `${index}`;
  });
  expect(validateTutorLesson(bad, recipe).every(finding => /wordCount/u.test(finding.code))).toBe(true);
  const generate = vi.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce(mode === 'repaired' ? lesson : bad);
  view.actions.generateTutor = generate;
  startTutorLessonGeneration(view); await settle(view);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(generate.mock.calls[1]![0]).toMatchObject({ retry: true, instruction: expect.stringMatching(/11 to 18 words/u) });
  expect(view.tutorState.lessonFailure).toBeUndefined();
  expect(view.tutorState.lesson?.lesson).toEqual(mode === 'repaired' ? lesson : bad);
  const warnings = pageFor(view)('.tutor-warning');
  expect(warnings.text()).not.toMatch(codePattern);
  expect(warnings.text()).not.toMatch(/inside.*tolerance/u);
  if (mode === 'repaired') expect(warnings).toHaveLength(0);
  else {
    expect(warnings).toHaveLength(1);
    expect(warnings.text()).toMatch(mode === 'long' ? /longer.*11 to 18 words/u : /shorter.*11 to 18 words/u);
    expect(warnings.parents('details')).toHaveLength(0);
  }
});

it.each(['overloaded', 'quotaExhausted'] as const)('names both providers once for %s lesson, practice and review validation failures', async reason => {
  for (const kind of ['lesson', 'practice', 'review'] as const) {
    const { view, lesson } = fixture(); const runtime = switchingRuntime();
    const invalid = kind === 'lesson' ? { ...lesson, examples: [] } : kind === 'practice'
      ? { schemaVersion: 1, mapVersion: lesson.mapVersion, channel: 'written', exercises: [] }
      : { schemaVersion: 1, exerciseId: 'exercise', learnerText: 'answer', correct: [], incorrect: [] };
    view.actions.generateTutor = vi.fn((request: TutorStructuredGenerationRequest, route: TutorLanguageModelRoute, signal: AbortSignal) =>
      withProviderSwitch(runtime, route, 'thorough', signal, async selected => {
        if (selected.provider === 'gemini') throw new ProviderError('Unavailable.', undefined, false, reason === 'overloaded' ? 503 : 429, reason);
        return invalid;
      }));
    if (kind === 'lesson') startTutorLessonGeneration(view);
    else if (kind === 'practice') generateTutorExercises(view);
    else {
      view.tutorState.exerciseSet = { schemaVersion: 1, mapVersion: lesson.mapVersion, channel: 'written', exercises: [
        { id: 'exercise', channel: 'written', targetIds: [target.id], prompt: 'Write an answer.' }] };
      view.tutorState.answers = { exercise: 'answer' };
      expect(await reviewTutorExercise(view, 'exercise')).toBe('failed');
    }
    await settle(view);
    const message = kind === 'lesson' ? view.tutorState.lessonFailure : kind === 'practice' ? view.tutorState.exerciseFailure : view.tutorState.reviewFailures.exercise;
    expect(message).toMatch(/Gemini was unavailable, so Groq drafted this/u);
    expect(message?.match(/Gemini/gu)).toHaveLength(1); expect(message?.match(/Groq/gu)).toHaveLength(1);
    expect(message).not.toMatch(codePattern);
  }
});

it('names a cached quota switch once in the retained word-count warning, including after Regenerate', async () => {
  for (const replacement of [false, true]) {
    const { view, lesson } = fixture(); const runtime = switchingRuntime();
    const generate = vi.fn((request: TutorStructuredGenerationRequest, route: TutorLanguageModelRoute, signal: AbortSignal) =>
      withProviderSwitch(runtime, route, 'thorough', signal, async selected => {
        if (selected.provider === 'gemini') throw new ProviderError('Unavailable.', undefined, false, 429, 'quotaExhausted');
        const bad = structuredClone(lesson);
        bad.examples.forEach((example, index) => { example.sentence = `A short example ${index}.`; example.annotations[0]!.excerpt = `short example ${index}`; });
        return replacement ? { example: bad.examples[0] } : bad;
      }));
    view.actions.generateTutor = generate;
    if (replacement) regenerateTutorExample(view, 'example-0'); else startTutorLessonGeneration(view);
    await settle(view);
    expect(generate).toHaveBeenCalledTimes(2);
    const warning = pageFor(view)('.tutor-warning').text();
    expect(warning).toMatch(/Gemini.*Groq.*shorter.*11 to 18 words/u);
    expect(warning.match(/Gemini/gu)).toHaveLength(1); expect(warning.match(/Groq/gu)).toHaveLength(1);
    expect(view.tutorState.lessonFailure).toBeUndefined();
  }
});

it('does not soften or retry a lesson with another validation failure', async () => {
  const { view, lesson } = fixture();
  const bad = { ...lesson, rules: [], examples: lesson.examples.map(example => ({ ...example, sentence: 'Short.', annotations: [] })) };
  const generate = vi.fn(async () => bad); view.actions.generateTutor = generate;
  startTutorLessonGeneration(view); await settle(view);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(view.tutorState.lessonFailure).toMatch(/rules|pattern/u);
  expect(view.tutorState.lesson?.lesson).toBe(lesson);
});
