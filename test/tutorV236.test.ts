import { expect, it, vi } from 'vitest';
import { load } from 'cheerio';
import { runInNewContext } from 'node:vm';

vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) }, env: {} }));

import { TUTOR_MAP, type TutorLesson, type TrainingReview } from '@kren/core/tutor';
import { createTutorViewState, tutorRecipeFromState } from '../src/tutor/state.js';
import { startTutorLessonGeneration, regenerateTutorExample, cancelTutorLesson } from '../src/resultsViewLesson.js';
import { mountedPanel } from './support/mountedPanel.js';
import { tutorLessonConversationReadiness } from '../src/tutor/lessonConversation.js';
import { renderTutorExercises, renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { tutorExerciseGenerationRequest, tutorLessonGenerationRequest, validateTutorExamplePracticeSet, type TutorStructuredGenerationRequest, type TutorExamplePracticeSet } from '../src/tutor/generation.js';
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { routedModel } from '../src/providers/openAICompatible.js';
import { PanelNoticeQueue, panelNoticeScript, type PanelNotice } from '../src/panelNotices.js';

const target = TUTOR_MAP.find(node => !TUTOR_MAP.some(child => child.parentId === node.id))!;
function fixture() {
  const state = createTutorViewState();
  state.selection = [{ nodeId: target.id, role: 'primary' }];
  const recipe = tutorRecipeFromState(state);
  const lesson: TutorLesson = {
    schemaVersion: 1, mapVersion: recipe.mapVersion, level: 'B2', lessonTitle: 'Pattern',
    primaryTarget: { ...target, nodeId: target.id, role: 'primary' }, supportingTargets: [],
    conceptExplanation: 'Concept.', interactionExplanation: 'Interaction.',
    rules: [{ statement: 'Use this pattern.', status: 'rule' }], commonErrors: [], generationNotes: [],
    examples: Array.from({ length: recipe.output.exampleCount }, (_, index) => ({
      id: `example-${index}`, sentence: `Today the careful team applies this useful English pattern in example number ${index}.`,
      targetIds: [target.id], annotations: [{ targetId: target.id, excerpt: `example number ${index}`, explanation: 'Why it fits.' }]
    }))
  };
  state.lesson = { recipe, lesson, findings: [] };
  state.viewedExampleIds = lesson.examples.map(example => example.id);
  state.lessonRevision = 4;
  state.practiceLessonRevision = 4;
  state.exerciseSet = { schemaVersion: 1, mapVersion: recipe.mapVersion, channel: 'written', exercises: [
    { id: 'exercise', channel: 'written', targetIds: [target.id], prompt: 'The deadline was tight, ___ the team finished on time.' }
  ] };
  state.answers = { exercise: 'and' };
  return { state, recipe, lesson };
}
function viewFor(state: ReturnType<typeof createTutorViewState>, generateTutor: ReturnType<typeof vi.fn>) {
  const testNotices = new PanelNoticeQueue(() => true, async () => true, async () => undefined);
  return {
    // Changed 2026-10-22 (V293, owner I61/D22 A): one missing-key message with Open Credentials.
    showMissingCredentialError: KrenResultsViewProvider.prototype.showMissingCredentialError,
    tutorState: state, tutorGeneration: 0, tutorExampleControllers: new Map(), render: vi.fn(), testNotices,
    actions: { generateTutor, settings: () => ({ tutorModel: 'gemini-current' }), log: vi.fn(),
      notify: vi.fn((_kind: string, message: string) => { void testNotices.show('error', message); }) }
  } as unknown as KrenResultsViewProvider & { testNotices: PanelNoticeQueue };
}
async function settle(view: KrenResultsViewProvider) {
  await vi.waitFor(() => expect(view.tutorState.lessonBusy || view.tutorState.exampleBusyIds.length > 0).toBeFalsy());
}
function review(overrides: Partial<TrainingReview> = {}): TrainingReview {
  return { schemaVersion: 1, exerciseId: 'exercise', learnerText: 'and', correct: [],
    incorrect: [{ excerpt: 'and', corrected: 'but', reason: 'This expresses contrast.', status: 'rule' }], ...overrides };
}

it('V239 R1 reviews a whole-sentence blank answer once, fills a phrase, and omits an uncertain answer', () => {
  const { state } = fixture();
  const learnerText = 'The deadline was tight, and the team finished on time.';
  const correctedText = 'The deadline was tight, but the team finished on time.';
  for (const supplied of [false, true]) {
    state.reviews.exercise = review({ learnerText, ...(supplied ? { correctedText } : {}) });
    const page = load(renderTutorExercises(state));
    expect.soft(page('.tutor-review-correction').text()).toBe(correctedText);
    expect.soft(page('.tutor-review-correction .tutor-review-corrected').text()).toBe('but');
  }
  state.reviews.exercise = review({ learnerText: learnerText.toLowerCase().slice(0, -1) });
  expect(load(renderTutorExercises(state))('.tutor-review-correction').text()).toBe(correctedText.toLowerCase().slice(0, -1));
  state.reviews.exercise = review({ learnerText: 'even if', incorrect: [
    { excerpt: 'even if', corrected: 'even though', reason: 'Contrast.', status: 'rule' }
  ] });
  expect(load(renderTutorExercises(state))('.tutor-review-correction').text())
    .toBe('The deadline was tight, even though the team finished on time.');
  state.reviews.exercise = review({ learnerText: 'The team finishes', incorrect: [
    { excerpt: 'finishes', corrected: 'finished', reason: 'Past.', status: 'rule' }
  ] });
  expect(load(renderTutorExercises(state))('.tutor-review-correction').text()).toBe('finished');
  state.reviews.exercise = review({ learnerText: 'they finish', incorrect: [
    { excerpt: 'finish', corrected: 'finished', reason: 'Past.', status: 'rule' }
  ] });
  expect(load(renderTutorExercises(state))('.tutor-review-correction').text()).toBe('finished');
});

it('V239 R5 keeps a supplied complete correction of two blanks and omits reconstruction without it', () => {
  const { state } = fixture();
  state.exerciseSet!.exercises[0]!.prompt = 'If I ___ earlier, I ___ you.';
  const learnerText = 'knew, helped';
  const incorrect: TrainingReview['incorrect'] = [
    { excerpt: 'knew', corrected: 'had known', reason: 'Earlier condition.', status: 'rule' },
    { excerpt: 'helped', corrected: 'would have helped', reason: 'Past result.', status: 'rule' }
  ];
  state.reviews.exercise = review({ learnerText, incorrect,
    correctedText: 'If I had known earlier, I would have helped you.' });
  const page = load(renderTutorExercises(state));
  expect.soft(page('.tutor-review-correction').text()).toBe('If I had known earlier, I would have helped you.');
  expect.soft(page('.tutor-review-correction .tutor-review-corrected').map((_i, element) => page(element).text()).get())
    .toEqual(['had known', 'would have helped']);
  delete state.reviews.exercise!.correctedText;
  expect(load(renderTutorExercises(state))('.tutor-review-correction').text()).toBe('had knownwould have helped');
});

it('V239 R2 serializes Redraft and Regenerate so failed or canceled Redraft cannot restore viewed replacement examples', async () => {
  for (const canceled of [false, true]) {
    const { state, lesson } = fixture();
    state.reviews.exercise = review();
    expect(tutorLessonConversationReadiness(state).ready).toBe(true);
    const before = structuredClone(state);
    let reject!: (reason: Error) => void;
    const generate = vi.fn().mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }))
      .mockResolvedValue({ example: { ...lesson.examples[1]!, sentence: 'A replacement uses this useful English pattern in example number 1.' } });
    const view = viewFor(state, generate);
    startTutorLessonGeneration(view);
    const output = () => renderKrenResultViewHtml({ nonce: 'test', cspSource: '', settings: PANEL_SETTINGS_FIXTURE,
      proModels: [], tutor: view.tutorState, activeScreen: 'tutor' });
    const page = load(output());
    const control = page('[data-command="regenerateTutorExample"]');
    expect.soft(control.is(':disabled')).toBe(true);
    expect.soft(control.attr('aria-description')).toMatch(/lesson|draft/iu);
    expect.soft(control.parents('details').length).toBe(0);
    expect.soft(control.closest('[data-tutor-example-tools]').length).toBe(1);
    regenerateTutorExample(view, 'example-1');
    expect.soft(generate).toHaveBeenCalledTimes(1);
    view.tutorState.currentExampleIndex = 2;
    if (canceled) cancelTutorLesson(view); else reject(new Error('Redraft failed.'));
    await settle(view);
    expect.soft(view.tutorState.lesson).toEqual(before.lesson);
    expect.soft(view.tutorState.viewedExampleIds).toEqual(before.viewedExampleIds);
    expect.soft(view.tutorState.practiceLessonRevision).toBe(before.practiceLessonRevision);
    // A pending replacement also refuses a Redraft from a stale page or direct command.
    let resolve!: (value: unknown) => void;
    generate.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    regenerateTutorExample(view, 'example-1');
    const calls = generate.mock.calls.length;
    const reader = mountedPanel(output(), () => {});
    expect.soft(reader.query('[data-command="generateTutorLesson"]')!.disabled).toBe(true);
    expect.soft(reader.query('[data-command="generateTutorLesson"]')!.getAttribute('aria-description')).toMatch(/example|regenerat/iu);
    startTutorLessonGeneration(view);
    expect.soft(generate).toHaveBeenCalledTimes(calls);
    resolve({ example: lesson.examples[1] });
    await settle(view);
    expect.soft(view.tutorState.viewedExampleIds).not.toContain('example-1');
    expect.soft(tutorLessonConversationReadiness(view.tutorState).ready).toBe(false);
  }
});

function popupReader(notices: PanelNotice[]) {
  // Changed 2026-10-18: V266, owner item I49, exercise real notice visibility and focus through the mounted page.
  const panel = mountedPanel(renderKrenResultViewHtml({ nonce: 'test', cspSource: '',
    settings: PANEL_SETTINGS_FIXTURE, proModels: [], panelNotices: notices }), () => {});
  return { active: () => ({ tag: panel.document.activeElement!.tagName.toLowerCase(), textContent: panel.document.activeElement!.textContent }),
    elements: panel.document.querySelectorAll('[data-kren-notice], [data-kren-notice] *').map(element => ({
      attributes: new Map([['role', element.getAttribute('role')]]), textContent: element.textContent
    })) };
}

it('1.6 retries unusable excerpts once for every provider and for Regenerate, then warns', async () => {
  for (const provider of ['groq', 'gemini', 'openai', 'anthropic', 'cloudflare'] as const) {
    for (const replacement of [false, true]) {
      for (const secondGood of [false, true]) {
        const { state, recipe, lesson } = fixture();
        state.settings.routing.provider = provider;
        const bad = structuredClone(lesson);
        bad.examples[0]!.annotations[0]!.excerpt = bad.examples[0]!.sentence;
        const generate = vi.fn().mockResolvedValueOnce(replacement ? { example: bad.examples[0] } : bad)
          .mockResolvedValueOnce(replacement ? { example: (secondGood ? lesson : bad).examples[0] } : secondGood ? lesson : bad);
        const view = viewFor(state, generate);
        if (replacement) regenerateTutorExample(view, 'example-0'); else startTutorLessonGeneration(view);
        await settle(view);
        expect(generate).toHaveBeenCalledTimes(2);
        expect(generate.mock.calls[1]![0].instruction).toMatch(/few words|short span/iu);
        expect(view.tutorState.lesson).toBeDefined();
        const markup = renderKrenResultViewHtml({ nonce: 'test', cspSource: '', settings: PANEL_SETTINGS_FIXTURE, proModels: [], tutor: view.tutorState, activeScreen: 'tutor' });
        expect(load(markup)('.tutor-warning').text()).toMatch(secondGood ? /^$/u : /excerpt|highlight/iu);
        expect(tutorLessonGenerationRequest(recipe).instruction).toMatch(/without repeating the sentence/iu);
      }
    }
  }
});

it('1.7 retains the lesson and owned practice after a switched-provider Redraft failure and shows its cause beside the actions', async () => {
  for (const provider of ['gemini', 'groq'] as const) {
    for (const invalid of [false, true]) {
      const { state, lesson } = fixture();
      state.settings.routing.provider = provider;
      const before = structuredClone(state);
      const generate = invalid ? vi.fn(async () => ({ ...lesson, examples: [] }))
        : vi.fn(async () => { throw new Error('Provider unavailable after switch.'); });
      const view = viewFor(state, generate);
      startTutorLessonGeneration(view);
      await settle(view);
      for (const key of ['lesson', 'exerciseSet', 'answers', 'reviews', 'viewedExampleIds', 'lessonRevision', 'practiceLessonRevision', 'currentExampleIndex'] as const) {
        expect(view.tutorState[key], key).toEqual(before[key]);
      }
      const calls = generate.mock.calls as unknown as Array<[TutorStructuredGenerationRequest, { provider: string; model: string }]>;
      expect(calls[0]![1]).toMatchObject({ provider, model: routedModel(provider, 'gemini-current') });
      // Changed 2026-10-23 (V305, owner I74/D41 A): preserve the failure and recovery checks beside the actions instead of in a duplicate card.
      expect(view.actions.notify).not.toHaveBeenCalled();
      const page = load(renderKrenResultViewHtml({ nonce: 'test', cspSource: '', settings: PANEL_SETTINGS_FIXTURE, proModels: [],
        panelNotices: view.testNotices.snapshot(), tutor: view.tutorState, activeScreen: 'tutor' }));
      expect(page('[data-command="generateTutorLesson"]').text()).toMatch(/redraft/iu);
      const popup = popupReader(view.testNotices.snapshot());
      expect(popup.elements.find(element => element.attributes.get('role') === 'alertdialog')).toBeUndefined();
      expect(page('[data-tutor-action-status] .tutor-failure').text()).toMatch(invalid ? /examples/iu : /unavailable after switch/iu);
      expect(page('[data-tutor-action-status]').parents('details, [hidden], .hidden')).toHaveLength(0);
      const reader = mountedPanel(page.html(), () => {});
      const redraft = reader.query('[data-command="generateTutorLesson"]')!;
      expect(redraft.disabled).toBe(false);
      expect(redraft.closest('details, [hidden], .hidden')).toBeNull();
      redraft.focus();
      expect(reader.document.activeElement?.tagName).toBe('BUTTON');
      expect(reader.document.activeElement?.textContent).toBe('Redraft');
    }
  }
});

it('1.8 finishes a review on the corrected sentence, reconstructs missing text, and omits an impossible reconstruction', () => {
  const { state } = fixture();
  const lastLine = () => load(renderTutorExercises(state))('[aria-label="Review of exercise 1"] > p').last().text();
  state.reviews.exercise = review();
  expect(lastLine()).toBe('The deadline was tight, but the team finished on time.');
  state.reviews.exercise = review({ correctedText: 'but' });
  expect(lastLine()).toBe('The deadline was tight, but the team finished on time.');
  state.reviews.exercise = review({ learnerText: 'but', incorrect: [], correct: [{ excerpt: 'but', reason: 'Contrast fits.' }] });
  expect(lastLine()).toBe('The deadline was tight, but the team finished on time.');
  state.exerciseSet!.exercises[0]!.prompt = 'Rewrite the sentence.';
  state.reviews.exercise = review({ learnerText: 'I goes home.', incorrect: [{ excerpt: 'goes', corrected: 'go', reason: 'Agreement.', status: 'rule' }] });
  expect(lastLine()).toBe('I go home.');
  expect(load(renderTutorExercises(state))('.tutor-review-correction span.tutor-review-corrected').text()).toBe('go');
  state.reviews.exercise = review({ learnerText: 'I goed and they goed.', incorrect: [
    { excerpt: 'I goed', corrected: 'I went', reason: 'Past.', status: 'rule' },
    { excerpt: 'they goed', corrected: 'I went', reason: 'Past.', status: 'rule' }
  ] });
  expect(lastLine()).toBe('I went and I went.');
  expect(load(renderTutorExercises(state))('.tutor-review-correction span.tutor-review-corrected')).toHaveLength(2);
  state.reviews.exercise = review({ learnerText: 'I goed.', correctedText: 'I went.',
    incorrect: [{ excerpt: 'goed', corrected: 'have gone', reason: 'Use this aspect.', status: 'rule' }] });
  expect(load(renderTutorExercises(state))('.tutor-review-correction').map((_index, element) => load(element).text()).get()).toEqual(['have gone', 'I went.']);
  // Changed 2026-10-14: V236, owner item 1.8, no incorrect spans mean the answer is correct; an unplaceable correction tests omission instead.
  state.reviews.exercise = review({ incorrect: [{ excerpt: 'missing', corrected: 'but', reason: 'Contrast.', status: 'rule' }] });
  expect(load(renderTutorExercises(state))('.tutor-review-correction').text()).toBe('but');
  state.reviews.exercise = review({ learnerText: 'I go and I go.', incorrect: [{ excerpt: 'go', corrected: 'went', reason: 'Past.', status: 'rule' }] });
  expect(load(renderTutorExercises(state))('.tutor-review-correction').text()).not.toContain('I went');
});

it('1.9 carries an optional task line through practice generation and displays it after review only when supplied', () => {
  const { state, recipe, lesson } = fixture();
  const request = tutorExerciseGenerationRequest({ schemaVersion: 1, recipe, channel: 'written', count: 1, examples: lesson.examples });
  expect(request.instruction).toMatch(/optional.*taskLine/iu);
  const schema = request.schema as { properties: { exercises: { items: { properties: { taskLine: unknown }; required: string[] } } } };
  expect(schema.properties.exercises.items.properties.taskLine).toEqual({ type: 'string' });
  expect(schema.properties.exercises.items.required).not.toContain('taskLine');
  state.reviews.exercise = review();
  state.exerciseSet!.exercises[0]!.taskLine = 'Choose the conjunction that fits the meaning.';
  const set: TutorExamplePracticeSet = { ...state.exerciseSet!, exercises: [{ ...state.exerciseSet!.exercises[0]!, exampleIndex: 0, expectedAnswer: 'but' }] };
  const input = { schemaVersion: 1 as const, recipe, channel: 'written' as const, count: 1, examples: lesson.examples };
  expect(validateTutorExamplePracticeSet(set, input)).toEqual([]);
  expect(validateTutorExamplePracticeSet({ ...set, exercises: [{ ...set.exercises[0]!, taskLine: '' }] }, input)).toContainEqual(expect.objectContaining({ code: 'exercise.taskLineInvalid' }));
  expect(load(renderTutorExercises(state))('.tutor-question-explanation').text()).toBe('Choose the conjunction that fits the meaning.');
  delete state.exerciseSet!.exercises[0]!.taskLine;
  expect(load(renderTutorExercises(state))('.tutor-question-explanation')).toHaveLength(0);
});

it('1.5 Reset makes the learning map reachable despite saved closure and pending lesson focus', () => {
  for (const everything of [false, true]) {
    const output = renderKrenResultViewHtml({ nonce: 'test', cspSource: '', settings: PANEL_SETTINGS_FIXTURE, proModels: [], tutor: createTutorViewState(), activeScreen: 'tutor',
      tutorResetDisclosures: true, tutorResetAllDisclosures: everything, focusTutorResult: 'lesson' });
    class Details {
      open = false;
      constructor(readonly id: string) {}
      getAttribute(name: string) { return name === 'data-persist-id' ? this.id : null; }
      scrollIntoView() {}
    }
    const sections = ['map', 'lesson', 'recipe', 'setting'].map(id => new Details(`tutor-${id}`));
    let saved = { openSections: Object.fromEntries(sections.map(section => [section.id, false])) };
    const script = output.match(/<script nonce="test">([\s\S]*?)<\/script>/u)![1]!;
    const document = {
      querySelectorAll: (selector: string) => selector.includes('details') ? sections : [],
      querySelector: (selector: string) => sections.find(section => selector.includes(section.id)) ?? null,
      addEventListener() {}, fonts: { ready: Promise.resolve() },
      body: { getAttribute: (name: string) => name === 'data-active-screen' ? 'tutor' : name === 'data-focus-tutor-result' ? 'lesson' : null }
    };
    runInNewContext(script.slice(0, script.indexOf('const focusTutorTarget =')), {
      acquireVsCodeApi: () => ({ getState: () => saved, setState: (value: typeof saved) => { saved = value; } }),
      document, HTMLDetailsElement: Details, HTMLElement: Details, window: { addEventListener() {}, scrollTo() {} }
    });
    expect(sections[0]!.open).toBe(true);
    expect(saved.openSections['tutor-map']).toBe(true);
    expect(load(output)('[data-command="askTutorQuestion"]').parents('details').length).toBe(1);
  }
});
