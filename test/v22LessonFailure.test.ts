import { expect, it, vi } from 'vitest';
import { load } from 'cheerio';

vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) }, env: {} }));

import { TUTOR_MAP, type TutorLesson } from '@kren/core/tutor';
import { createTutorViewState, tutorRecipeFromState } from '../src/tutor/state.js';
import { startTutorLessonGeneration } from '../src/resultsViewLesson.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

// V22, owner decision F3: a rejected lesson shows one calm sentence and a collapsed "Show reasons" control.
const CALM = 'KREN could not prepare this lesson. Please try again.';
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
  const view = { showMissingCredentialError: KrenResultsViewProvider.prototype.showMissingCredentialError, tutorState: state, tutorGeneration: 0,
    tutorExampleControllers: new Map(), tutorReviewControllers: new Map(), tutorHintControllers: new Map(), render: vi.fn(),
    actions: { settings: () => PANEL_SETTINGS_FIXTURE, log: vi.fn(), notify: vi.fn(), generateTutor: vi.fn() } } as unknown as KrenResultsViewProvider;
  return { view, lesson };
}
const pageFor = (view: KrenResultsViewProvider) => load(renderKrenResultViewHtml({ nonce: 'test', cspSource: '', settings: PANEL_SETTINGS_FIXTURE,
  proModels: [], tutor: view.tutorState, activeScreen: 'tutor' }));
const settle = (view: KrenResultsViewProvider) => vi.waitFor(() => expect(view.tutorState.lessonBusy).toBeFalsy());

it('shows the calm sentence and a collapsed Show reasons control holding the reason sentences for a rejected lesson', async () => {
  const { view, lesson } = fixture();
  view.actions.generateTutor = vi.fn(async () => ({ ...lesson, examples: lesson.examples.slice(0, 1) }));
  startTutorLessonGeneration(view); await settle(view);
  const reasons = view.tutorState.lessonFailureReasons!;
  expect(view.tutorState.lessonFailure).toBe(CALM);
  expect(reasons).toMatch(/1 example instead of/u);
  expect(view.tutorState.lessonFailure).not.toContain(reasons);

  const $ = pageFor(view);
  const block = $('[data-tutor-action-status] [data-tutor-lesson-failure]');
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
  // The Draft button stays where it was, outside the failure block.
  const draft = $('[data-command="generateTutorLesson"]');
  expect(draft.length).toBeGreaterThan(0);
  expect(draft.closest('[data-tutor-lesson-failure]')).toHaveLength(0);
});

it('keeps a provider failure as the whole message with no Show reasons control', async () => {
  const { view } = fixture();
  view.actions.generateTutor = vi.fn(async () => { throw new Error('The lesson request failed. Try again.'); });
  startTutorLessonGeneration(view); await settle(view);
  expect(view.tutorState.lessonFailure).toBe('The lesson request failed. Try again.');
  expect(view.tutorState.lessonFailureReasons).toBeUndefined();
  const $ = pageFor(view);
  expect($('[data-tutor-action-status] .tutor-failure').text()).toBe('The lesson request failed. Try again.');
  expect($('[data-tutor-lesson-failure], [data-tutor-lesson-failure-reasons]')).toHaveLength(0);
  expect($('[data-tutor-action-status] summary:contains("Show reasons")')).toHaveLength(0);
});

it('clears the reasons when the next draft starts', async () => {
  const { view, lesson } = fixture();
  view.actions.generateTutor = vi.fn(async () => ({ ...lesson, examples: [] }));
  startTutorLessonGeneration(view); await settle(view);
  expect(view.tutorState.lessonFailureReasons).toBeTruthy();
  view.actions.generateTutor = vi.fn(async () => { throw new Error('The lesson request failed. Try again.'); });
  startTutorLessonGeneration(view); await settle(view);
  expect(view.tutorState.lessonFailureReasons).toBeUndefined();
  expect(pageFor(view)('[data-tutor-lesson-failure]')).toHaveLength(0);
});
