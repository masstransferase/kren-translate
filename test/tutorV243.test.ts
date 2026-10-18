import { expect, it, vi } from 'vitest';
import { load } from 'cheerio';
import { runInNewContext } from 'node:vm';

const update = vi.hoisted(() => vi.fn());
vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn() }, env: {},
  ConfigurationTarget: { Global: 1 }, Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback, update }) },
  window: { showWarningMessage: vi.fn(async () => undefined), showInformationMessage: vi.fn(async () => undefined), showErrorMessage: vi.fn(async () => undefined) } }));

import { TUTOR_MAP } from '@kren/core/tutor';
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { reviewTutorExercise, reviewUnreviewedTutorExercises } from '../src/resultsViewPractice.js';
import { renderKrenResultViewHtml, renderTutorExercises } from '../src/resultViewHtml.js';
import { createTutorViewState, tutorConversationReviewProgress, type TutorPracticeReview } from '../src/tutor/state.js';
import { tutorReviewBatchGenerationRequest, tutorReviewGenerationRequest } from '../src/tutor/generation.js';
import { TUTOR_DEFAULTS } from '../src/tutor/defaults.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function harness() {
  const actions = { settings: () => PANEL_SETTINGS_FIXTURE, generateTutor: vi.fn(), log: vi.fn(), notify: vi.fn(),
    writeTutorPreferences: vi.fn(), stopReadAloud: vi.fn() };
  const view = new KrenResultsViewProvider(actions as never, {} as never);
  const internals = view as any;
  internals.activeScreen = 'tutor';
  internals.handy = { detect: vi.fn(async () => undefined) };
  let html = '';
  const renders: string[] = [];
  view.view = { visible: true, webview: { cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }),
    set html(value: string) { html = value; renders.push(value); }, postMessage: vi.fn(async () => true) } } as never;
  return { view, internals, actions, renders, html: () => html };
}

it.each([3, 4, 5])('the stopped message explains the remaining answers for %i answered turns', async answered => {
  const h = harness();
  Object.assign(h.view.tutorState.conversation, { status: 'active', from: 'anything', speakerOn: false,
    transcript: [
      ...Array.from({ length: answered }, () => ({ question: 'What next?', learnerAnswer: 'A walk.', correction: '', explanation: '' })),
      { question: 'Skipped?', learnerAnswer: '', correction: '', explanation: '', skipped: true },
      { question: 'Hidden?', learnerAnswer: '', correction: '', explanation: '', learnerNotShown: true }
    ] });
  await h.internals.handleMessage({ command: 'stopTutorConversation' });
  const page = load(h.html());
  const actions = page('[data-tutor-stopped-actions]');
  const message = actions.prev('p').text();
  expect(message).toContain(`kept all ${answered + 2} turns`);
  const { remaining } = tutorConversationReviewProgress(h.view.tutorState.conversation);
  if (remaining) expect(message).toContain(`Answer ${remaining} more turn${remaining === 1 ? '' : 's'} to see the diagnostic report (More details).`);
  else expect(message).not.toMatch(/more turns?|diagnostic report/iu);
  const panel = mountedPanel(h.html(), () => {});
  // The shipped in-place setting patch changes the action without hiding it in a disclosure.
  panel.message({ command: 'tutorConversationTakeHomeSetting', value: false });
  const button = panel.query('[data-tutor-review-action]')!;
  expect(button.disabled).toBe(remaining > 0);
  expect(button.textContent).toMatch(/More details/u);
  expect(button.closest('details')).toBeNull();
  expect(button.getAttribute('tabindex')).not.toBe('-1');
  if (remaining) expect(button.title).toMatch(/answered turns/iu);
});

// Execute the actual disclosure restoration script, retaining VS Code's webview state.
function disclosureReader() {
  let saved: Record<string, any> = { openSections: { 'tutor-map': false, 'tutor-lesson': true } };
  class Details {
    open = false;
    constructor(readonly id: string) {}
    getAttribute(name: string) { return name === 'data-persist-id' ? this.id : null; }
    scrollIntoView() {}
  }
  const sections = ['tutor-map', 'tutor-lesson', 'tutor-setting'].map(id => new Details(id));
  return { saved: () => saved, sections, read(html: string) {
    const script = load(html)('script').text();
    runInNewContext(script.slice(0, script.indexOf('const focusTutorTarget =')), {
      acquireVsCodeApi: () => ({ getState: () => saved, setState: (value: typeof saved) => { saved = value; } }),
      document: { querySelectorAll: (selector: string) => selector.includes('details') ? sections : [],
        querySelector: (selector: string) => sections.find(section => selector.includes(section.id)) ?? null,
        addEventListener() {}, fonts: { ready: Promise.resolve() }, body: { getAttribute: () => 'tutor' } },
      HTMLDetailsElement: Details, HTMLElement: Details, window: { addEventListener() {}, scrollTo() {} }
    });
  } };
}

it.each(['Reset panel', 'Reset everything'])('%s unfolds the map after real reset and configuration redraws', async choice => {
  const h = harness();
  h.internals.showWarningMessage = vi.fn(async () => choice);
  h.internals.pendingTutorResultFocus = 'lesson';
  update.mockReset().mockImplementation(async () => { h.view.refresh(); await Promise.resolve(); });
  await h.internals.handleMessage({ command: 'resetTutorSession' });
  await flush();
  expect(update).toHaveBeenCalledTimes(choice === 'Reset everything' ? Object.keys(TUTOR_DEFAULTS.configuration).length : 0);
  if (choice === 'Reset everything') expect(h.renders.length).toBeGreaterThan(2);
  h.view.render(); // A replacement can arrive before the reset document ever executes.
  expect(h.view.pendingTutorResetDisclosures).toBe(false);
  const reader = disclosureReader();
  reader.read(h.html());
  expect(reader.sections[0]!.open).toBe(true);
  expect(reader.saved().openSections['tutor-map']).toBe(true);
  expect(load(h.html())('[data-tutor-map-search]')).toHaveLength(1);
  // A later redraw preserves a reader's deliberate closure after the reset was applied.
  reader.saved().openSections['tutor-map'] = false;
  h.view.render(); reader.read(h.html());
  expect(reader.sections[0]!.open).toBe(false);
  // The next reset is a fresh action and must unfold it again.
  await h.internals.handleMessage({ command: 'resetTutorSession' }); await flush();
  h.view.render(); reader.read(h.html());
  expect(reader.sections[0]!.open).toBe(true);
});

const examples = [
  { correct: true, sentence: 'Local health authorities voiced strong concern regarding the outbreak.', focus: 'strong concern',
    answer: 'strong concern', corrected: 'strong concern' },
  { correct: false, sentence: 'Invasive plant species pose a serious threat to local ecosystems.', focus: 'pose a serious threat',
    answer: 'poses', corrected: 'pose' }
];
function practice(correct: boolean, sentence: string, answer: string, corrected: string, focusPhrase: unknown) {
  const state = createTutorViewState();
  const target = TUTOR_MAP.find(node => node.kind === 'microTarget')!.id;
  state.exerciseSet = { schemaVersion: 1, mapVersion: '1.0.0', channel: 'written', exercises: [
    { id: 'exercise', channel: 'written', targetIds: [target], prompt: correct
      ? 'Local health authorities voiced ___ regarding the outbreak.' : 'Invasive plant species ___ a serious threat to local ecosystems.' }
  ] };
  state.answers.exercise = answer;
  const review = { schemaVersion: 1, exerciseId: 'exercise', learnerText: answer, correctedText: sentence, focusPhrase,
    correct: correct ? [{ excerpt: answer, reason: 'The phrase fits.' }] : [],
    incorrect: correct ? [] : [{ excerpt: answer, corrected, reason: 'Use the plural verb.', status: 'rule' }] } as TutorPracticeReview;
  return { state, review };
}

it.each(examples)('keeps the whole learning phrase for correct=$correct through single and batch reviews', async example => {
  for (const batch of [false, true]) {
    const h = harness();
    const { state, review } = practice(example.correct, example.sentence, example.answer, example.corrected, example.focus);
    h.view.tutorState = state;
    h.actions.generateTutor.mockResolvedValue(batch ? { reviews: [review] } : review);
    if (batch) await reviewUnreviewedTutorExercises(h.view);
    else expect(await reviewTutorExercise(h.view, 'exercise')).toBe('success');
    await flush();
    expect(h.view.tutorState.reviews.exercise?.focusPhrase).toBe(example.focus);
    const page = load(renderTutorExercises(h.view.tutorState));
    const sentence = page('.tutor-review-correction').last();
    expect(sentence.text()).toBe(example.sentence);
    expect(sentence.find(example.correct ? '.tutor-review-correct' : '.tutor-review-wrong').text()).toBe(example.focus);
    expect(sentence.find('.tutor-review-corrected')).toHaveLength(0);
  }
});

it.each([undefined, '', 'absent phrase', 42, '<script>'])('an invalid focus %s preserves the existing corrected-word highlight', async focus => {
  const h = harness();
  const example = examples[1]!;
  const { state, review } = practice(false, example.sentence, example.answer, example.corrected, focus);
  h.view.tutorState = state;
  h.actions.generateTutor.mockResolvedValue(review);
  expect(await reviewTutorExercise(h.view, 'exercise')).toBe('success');
  expect(h.view.tutorState.reviews.exercise).not.toHaveProperty('focusPhrase');
  const page = load(renderTutorExercises(h.view.tutorState));
  expect(page('.tutor-review-correction').last().text()).toBe(example.sentence);
  expect(page('.tutor-review-correction .tutor-review-corrected').text()).toBe('pose');
  // Also guard the renderer against invalid hints in restored or gallery state.
  h.view.tutorState.reviews.exercise = review;
  expect(load(renderTutorExercises(h.view.tutorState))('.tutor-review-corrected').text()).toBe('pose');
});

it('requests an optional verbatim focus phrase in both practice review schemas', () => {
  const { state } = practice(true, examples[0]!.sentence, 'strong concern', 'strong concern', undefined);
  const body = { learnerAnswer: 'strong concern', exercise: state.exerciseSet!.exercises[0]!, activeTargets: [] };
  const single = tutorReviewGenerationRequest(body);
  const batch = tutorReviewBatchGenerationRequest([body]);
  expect(single.instruction).toMatch(/optional short focusPhrase.*quote verbatim.*whole phrase/iu);
  expect(single.schema.properties).toHaveProperty('focusPhrase');
  expect(single.schema.required).not.toContain('focusPhrase');
  expect((batch.schema.properties as any).reviews.items).toEqual(single.schema);
});

// 2026-10-15: headless Edge prints nothing on the owner's PC, so the size check reads the panel's own rules.
it('keeps the review action slot at the size of Start new and Back to chat', () => {
  const html = renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [], settings: PANEL_SETTINGS_FIXTURE });
  const css = load(html)('style').text().replace(/\s+/gu, ' ');
  expect(css).toContain('.tutor-conversation-actions > span { margin-top: 1px; font-size: 11px; }');
  expect(css).toContain('.tutor-conversation-actions > [data-tutor-review-action-slot] { margin-top: 0; font-size: inherit; }');
  expect(css.indexOf('[data-tutor-review-action-slot] { margin-top: 0; font-size: inherit; }'))
    .toBeGreaterThan(css.indexOf('.tutor-conversation-actions > span { margin-top: 1px; font-size: 11px; }'));
});
