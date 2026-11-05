import { expect, it, vi } from 'vitest';
import { load } from 'cheerio';

vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) }, env: {} }));

import { TUTOR_MAP, type TutorLesson } from '@kren/core/tutor';
import { createTutorViewState, tutorRecipeFromState } from '../src/tutor/state.js';
import { generateTutorExercises } from '../src/resultsViewLesson.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

// VS22B, owner decision A: a rejected practice set shows one calm sentence and a collapsed "Show reasons" control, as a rejected lesson does.
const CALM = 'KREN could not prepare this practice set. Please try again.';
const target = TUTOR_MAP.find(node => !TUTOR_MAP.some(child => child.parentId === node.id))!;

function fixture() {
  const state = createTutorViewState(); state.settings.sentenceBand = 'medium'; state.settings.routing.provider = 'gemini';
  state.selection = [{ nodeId: target.id, role: 'primary' }];
  const recipe = tutorRecipeFromState(state);
  const lesson: TutorLesson = { schemaVersion: 1, mapVersion: recipe.mapVersion, level: 'B2', lessonTitle: 'Pattern',
    primaryTarget: { ...target, nodeId: target.id, role: 'primary' }, supportingTargets: [],
    conceptExplanation: 'Concept.', patternStatement: 'Each example uses this pattern.', interactionExplanation: 'Interaction.',
    rules: [{ statement: 'Use this pattern.', status: 'rule' }], commonErrors: [], generationNotes: [],
    examples: Array.from({ length: recipe.output.exampleCount }, (_, index) => ({
      id: `example-${index}`, sentence: `Today the careful team applies this useful English pattern in example number ${index}.`,
      targetIds: [target.id], annotations: [{ targetId: target.id, excerpt: `example number ${index}`, explanation: 'Why it fits.' }] })) };
  state.lesson = { recipe, lesson, findings: [] }; state.viewedExampleIds = lesson.examples.map(example => example.id);
  const view = { showMissingCredentialError: KrenResultsViewProvider.prototype.showMissingCredentialError, tutorState: state, tutorGeneration: 0,
    tutorExampleControllers: new Map(), tutorReviewControllers: new Map(), tutorHintControllers: new Map(), render: vi.fn(),
    actions: { settings: () => PANEL_SETTINGS_FIXTURE, log: vi.fn(), notify: vi.fn(), generateTutor: vi.fn() } } as unknown as KrenResultsViewProvider;
  return { view, lesson };
}
const pageFor = (view: KrenResultsViewProvider) => load(renderKrenResultViewHtml({ nonce: 'test', cspSource: '', settings: PANEL_SETTINGS_FIXTURE,
  proModels: [], tutor: view.tutorState, activeScreen: 'tutor' }));
const settle = (view: KrenResultsViewProvider) => vi.waitFor(() => expect(view.tutorState.exerciseBusy).toBeFalsy());
const emptySet = (lesson: TutorLesson) => ({ schemaVersion: 1, mapVersion: lesson.mapVersion, channel: 'written', exercises: [] });

it('shows the calm sentence and a collapsed Show reasons control holding the reason sentences for a rejected practice set', async () => {
  const { view, lesson } = fixture();
  view.actions.generateTutor = vi.fn(async () => emptySet(lesson));
  generateTutorExercises(view); await settle(view);
  const reasons = view.tutorState.exerciseFailureReasons!;
  expect(view.tutorState.exerciseSet).toBeUndefined();
  expect(view.tutorState.exerciseFailure).toBe(CALM);
  expect(reasons).toBeTruthy();
  expect(view.tutorState.exerciseFailure).not.toContain(reasons);

  const $ = pageFor(view);
  const block = $('[data-tutor-action-status] [data-tutor-practice-failure]');
  expect(block).toHaveLength(1);
  expect(block.hasClass('tutor-failure')).toBe(true);
  expect(block.children('p').first().text()).toBe(CALM);
  // The sentence sits in the live status region and outside every collapsed section.
  expect(block.closest('[role="status"]').attr('aria-live')).toBe('polite');
  expect(block.closest('details, [hidden], .hidden')).toHaveLength(0);
  // The reasons are inside a native details element that is collapsed, so keyboard and screen readers reach it with no script.
  const details = block.find('details');
  expect(details).toHaveLength(1);
  expect(details.attr('open')).toBeUndefined();
  expect(details.children('summary').text()).toBe('Show reasons');
  expect(details.children('summary').attr('tabindex')).not.toBe('-1');
  expect(details.children('summary').closest('[hidden]')).toHaveLength(0);
  expect(details.children('p').text()).toBe(reasons);
  // The reasons are not shown as the whole message anywhere outside the collapsed control.
  expect($('[data-tutor-action-status]').clone().find('details').remove().end().text()).not.toContain(reasons);
});

it('keeps a provider failure as the whole message with no Show reasons control', async () => {
  const { view } = fixture();
  view.actions.generateTutor = vi.fn(async () => { throw new Error('The practice request failed. Try again.'); });
  generateTutorExercises(view); await settle(view);
  expect(view.tutorState.exerciseFailure).toBe('The practice request failed. Try again.');
  expect(view.tutorState.exerciseFailureReasons).toBeUndefined();
  const $ = pageFor(view);
  expect($('[data-tutor-action-status] .tutor-failure').text()).toBe('The practice request failed. Try again.');
  expect($('[data-tutor-practice-failure], [data-tutor-practice-failure-reasons]')).toHaveLength(0);
  expect($('[data-tutor-action-status] summary:contains("Show reasons")')).toHaveLength(0);
});

it('clears the reasons when the next practice request starts', async () => {
  const { view, lesson } = fixture();
  view.actions.generateTutor = vi.fn(async () => emptySet(lesson));
  generateTutorExercises(view); await settle(view);
  expect(view.tutorState.exerciseFailureReasons).toBeTruthy();
  view.actions.generateTutor = vi.fn(async () => { throw new Error('The practice request failed. Try again.'); });
  generateTutorExercises(view); await settle(view);
  expect(view.tutorState.exerciseFailureReasons).toBeUndefined();
  expect(pageFor(view)('[data-tutor-practice-failure]')).toHaveLength(0);
});
