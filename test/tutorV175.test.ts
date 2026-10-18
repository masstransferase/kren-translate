// 2026-10-11: V220 keeps Next local on every item and reviews only on the last item.
import { load, type CheerioAPI } from 'cheerio';
import { parse as parseCss } from 'postcss';
import { describe, expect, it, vi } from 'vitest';
import { TUTOR_MAP, type TutorLesson } from '@kren/core/tutor';
import { renderKrenResultViewHtml, renderTutorExercises } from '../src/resultViewHtml.js';
import { createTutorViewState, tutorRecipeFromState, type TutorViewState } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const target = TUTOR_MAP.find((node) => node.kind === 'microTarget')!;
function stateWithLesson(): TutorViewState {
  const state = createTutorViewState();
  state.selection = [{ nodeId: target.id, role: 'primary' }];
  const lesson: TutorLesson = {
    schemaVersion: 1, mapVersion: '1.0.0', lessonTitle: 'Hidden generated title', level: 'B2',
    primaryTarget: { nodeId: target.id, label: target.label, kind: target.kind, role: 'primary', description: target.description },
    supportingTargets: [], conceptExplanation: 'Concept.', interactionExplanation: 'Interaction.',
    rules: [], examples: [1, 2].map((index) => ({ id: `example-${index}`, sentence: `Example ${index}.`, targetIds: [target.id], annotations: [] })),
    commonErrors: [{ id: 'error', incorrect: 'Wrong.', corrected: 'Correct.', explanation: 'Reason.', status: 'rule' }],
    practice: [], answerKey: [], generationNotes: []
  };
  state.lesson = { recipe: tutorRecipeFromState(state), lesson, findings: [] };
  return state;
}
function practiceState(): TutorViewState {
  const state = createTutorViewState();
  state.exerciseSet = { schemaVersion: 1, mapVersion: '1.0.0', channel: 'written', exercises: [1, 2].map((index) => ({
    id: `question-${index}`, channel: 'written', prompt: `Question ${index}.`, targetIds: [target.id]
  })) };
  return state;
}
function render(state = createTutorViewState()): string {
  return renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE, activeScreen: 'tutor', tutor: state, proModels: [] });
}
function declarations(markup: string, selector: string): Record<string, string> {
  const values: Record<string, string> = {};
  parseCss(load(markup)('style').text()).walkRules((rule) => {
    if (rule.selectors.includes(selector)) rule.walkDecls((decl) => { values[decl.prop] = decl.value; });
  });
  return values;
}

// Exercise the shipped handlers against selectors resolved from the rendered tree.
// Identity is preserved so a global lookup that targets question 1 fails the question 2 checks.
function dom(markup: string) {
  const $ = load(markup);
  const cache = new Map<unknown, Element>();
  class Element {
    value: string;
    disabled: boolean;
    open: boolean;
    focus = vi.fn();
    scrollIntoView = vi.fn();
    constructor(public node: ReturnType<CheerioAPI>) {
      this.value = node.text();
      this.disabled = node.is('[disabled]');
      this.open = node.is('[open]');
    }
    closest(selector: string) { return wrap(this.node.closest(selector)); }
    querySelector(selector: string) { return wrap(this.node.find(selector).first()); }
    getAttribute(name: string) { return this.node.attr(name) ?? null; }
    setAttribute(name: string, value: string) { this.node.attr(name, value); }
    hasAttribute(name: string) { return this.node.attr(name) !== undefined; }
  }
  class TextArea extends Element {}
  class Button extends Element {}
  class Details extends Element {}
  function wrap(node: ReturnType<CheerioAPI>): Element | null {
    const key = node.get(0);
    if (!key) return null;
    if (!cache.has(key)) {
      const Type = node.is('textarea') ? TextArea : node.is('button') ? Button : node.is('details') ? Details : Element;
      cache.set(key, new Type(node));
    }
    return cache.get(key)!;
  }
  return { querySelector: (selector: string) => wrap($(selector).first()), TextArea, Button, Details };
}
function branch(script: string, start: string, end: string): string {
  const begin = script.indexOf(start);
  const finish = script.indexOf(end, begin);
  expect(begin).toBeGreaterThanOrEqual(0);
  expect(finish).toBeGreaterThan(begin);
  return script.slice(begin, finish);
}
function twoQuestions() {
  const state = practiceState();
  const first = renderTutorExercises(state);
  // Changed 2026-10-04: reaching page two requires a nonblank first answer.
  state.answers['question-1'] = 'First answer.';
  state.currentExerciseIndex = 1;
  return dom(first + renderTutorExercises(state));
}
const script = () => load(render())('script').text();

describe('V175 Lesson canvas layout and local controls', () => {
  it.each([false, true])('keeps the Lesson canvas order with drafted=%s and actions outside the disclosure', (drafted) => {
    const state = drafted ? stateWithLesson() : createTutorViewState();
    const markup = render(state);
    const $ = load(markup);
    const section = $('.tutor-lesson-section');
    expect(section.children().map((_index, node) => node.tagName).get())
      .toEqual(drafted ? ['h2', 'p', 'details', 'div', 'article'] : ['h2', 'p', 'details', 'p', 'div']);
    expect(section.children().first().text()).toBe('LESSON');
    expect(section.children().eq(1).text()).toBe('Draft a short lesson on the targets you selected, with worked examples and practice.');
    expect(section.children().eq(2).attr('data-persist-id')).toBe('tutor-lesson');
    expect(section.find('[data-persist-id="tutor-lesson"] > summary .rewrite-group-name').text()).toBe('LESSON SETTING');
    expect(section.children('.tutor-lesson-instruction')).toHaveLength(drafted ? 0 : 1);
    if (!drafted) expect(section.children('.tutor-lesson-instruction').text()).toBe('Check your lesson settings, then draft the lesson.');
    const actions = section.children('[data-tutor-heading-actions]');
    // Changed 2026-10-16: V247, owner item I28, the Voice and Model bridge buttons follow the row.
    expect(actions.find('button').map((_index, node) => $(node).text()).get()).toEqual(['Setting', drafted ? 'Redraft' : 'Draft', 'Reset', 'Voice', 'Model']);
    expect(actions.parents('details')).toHaveLength(0);
    // Changed 2026-10-01: empty Draft and lesson Reset are disabled; enabled controls remain reachable.
    expect(actions.find('button[tabindex="-1"], [data-tutor-shared-action]')).toHaveLength(0);
    expect(actions.find('button[disabled]')).toHaveLength(drafted ? 0 : 2);
    expect(actions.find('[data-command="resetTutorLesson"]').hasClass('secondary')).toBe(true);
    expect(actions.find('[data-tutor-open-lesson-settings], [data-command="generateTutorLesson"]').filter('.secondary')).toHaveLength(0);
    expect($('.tutor-heading-row [data-tutor-heading-actions]')).toHaveLength(0);
    // Changed 2026-10-01: the title row now contains the gear and master Reset.
    expect($('.tutor-heading-row button')).toHaveLength(2);
    expect(section.text()).not.toContain('Hidden generated title');
    expect(declarations(markup, '.tutor-heading-actions > button')).toMatchObject({ width: '60px', 'padding-left': '6px', 'padding-right': '6px' });
    expect(declarations(markup, '.tutor-heading-actions')).toMatchObject({ display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'center', 'justify-content': 'flex-start', gap: '6px', 'padding-top': '6px', 'padding-bottom': '12px' });
    expect(declarations(markup, '.tutor-lesson-section[data-tutor-lesson-drafted] > .tutor-heading-actions').margin).toBe('16px 0 18px');
  });

  it('has one lesson settings disclosure and keeps general settings below Conversation', () => {
    const $ = load(render(stateWithLesson()));
    expect($('[data-persist-id="tutor-lesson"]')).toHaveLength(1);
    expect($('[data-tutor-configuration] [data-persist-id="tutor-lesson"]')).toHaveLength(0);
    expect($('[data-tutor-configuration] > [data-persist-id="tutor-setting"]')).toHaveLength(1);
    expect($('[data-tutor-configuration]').prev().is('[data-tutor-result="conversation"]')).toBe(true);
  });

  it('opens closed lesson settings before scrolling and focusing the summary without a lesson command', () => {
    const tree = dom(render());
    const settings = tree.querySelector('details[data-persist-id="tutor-lesson"]')!;
    const target = tree.querySelector('[data-tutor-open-lesson-settings]')!;
    expect(settings.open).toBe(false);
    expect(target.getAttribute('data-command')).toBeNull();
    expect(target.getAttribute('title')).toBe('Open the lesson settings above');
    settings.scrollIntoView.mockImplementation(() => { expect(settings.open).toBe(true); });
    const postMessage = vi.fn();
    const handler = new Function('target', 'document', 'HTMLDetailsElement', 'vscode', branch(script(),
      "if (target.hasAttribute('data-tutor-open-lesson-settings'))", "if (target.hasAttribute('data-tutor-jump-configuration'))"));
    handler(target, tree, tree.Details, { postMessage });
    expect(settings.open).toBe(true);
    expect(settings.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(settings.querySelector('summary')!.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(postMessage).not.toHaveBeenCalled();
    handler(target, tree, tree.Details, { postMessage });
    expect(settings.open).toBe(true);
  });

  it('puts each example controls row outside the card, then practice before Common errors', () => {
    for (let index = 0; index < 2; index++) {
      const state = stateWithLesson();
      state.currentExampleIndex = index;
      const markup = render(state);
      const $ = load(markup);
      const card = $('[data-tutor-example-card]');
      expect(card.find('.tutor-example-controls, button')).toHaveLength(0);
      expect(card.children()).toHaveLength(2);
      const controls = card.next('.tutor-example-controls');
      expect(controls).toHaveLength(1);
      expect(controls.parent().is('article[data-tutor-result="lesson"]')).toBe(true);
      expect(controls.next().is('[data-tutor-lesson-practice-action]')).toBe(true);
      expect(controls.next().next().is('[data-persist-id="tutor-lesson-errors"]')).toBe(true);
      expect(declarations(markup, '.tutor-example-controls')).toMatchObject({ 'margin-top': '1.5em', 'padding-left': '7px' });
      expect(declarations(markup, '.tutor-lesson-practice-action').margin).toBe('35px 0 2px 11px');
    }
  });

  it('puts every practice controls row outside the prompt and answer card', () => {
    const state = practiceState();
    for (let index = 0; index < 2; index++) {
      state.currentExerciseIndex = index;
      const $ = load(renderTutorExercises(state));
      const card = $('.tutor-exercise');
      expect(card.children().map((_index, node) => node.tagName).get()).toEqual(['h3', 'textarea']);
      expect(card.next().is('.tutor-exercise-controls')).toBe(true);
      expect(card.next().parent().is('.tutor-practice-panel')).toBe(true);
      // Changed 2026-10-04: the final item offers Review all until all reviews exist.
      expect(card.next().find('[data-command="reviewTutorExercise"]')).toHaveLength(0);
      expect(card.next().find('[data-command="reviewUnreviewedTutorExercises"]')).toHaveLength(index === 1 ? 1 : 0);
    }
    expect(declarations(render(state), '.tutor-exercise-controls')).toMatchObject({ 'margin-top': '20px', 'padding-left': '7px', 'margin-bottom': '6px' });
  });

  it('enables Review all on typing in question 2 in place and leaves question 1 without Review', () => {
    const tree = twoQuestions();
    const answer = tree.querySelector('textarea[data-tutor-exercise="question-2"]')!;
    const first = tree.querySelector('[data-command="reviewTutorExercise"][data-tutor-exercise="question-1"]')!;
    const second = tree.querySelector('[data-command="reviewUnreviewedTutorExercises"][data-tutor-exercise="question-2"]')!;
    const source = script();
    const sync = branch(source, 'function syncTutorReviewState(', "document.addEventListener('keydown'");
    const input = branch(source, "if (target instanceof HTMLTextAreaElement && target.hasAttribute('data-tutor-answer'))", "\n      if (target instanceof HTMLTextAreaElement &&\n");
    const postMessage = vi.fn();
    const handler = new Function('target', 'HTMLTextAreaElement', 'HTMLButtonElement', 'vscode', sync + input);
    answer.value = 'An answer.';
    handler(answer, tree.TextArea, tree.Button, { postMessage });
    expect(second.disabled).toBe(false);
    expect(first).toBeNull();
    expect(postMessage).toHaveBeenLastCalledWith({ command: 'updateTutorAnswer', exerciseId: 'question-2', answer: 'An answer.' });
    answer.value = '   ';
    handler(answer, tree.TextArea, tree.Button, { postMessage });
    expect(second.disabled).toBe(true);
    expect(first).toBeNull();
    expect(tree.querySelector('textarea[data-tutor-exercise="question-2"]')).toBe(answer);
  });

  it('focuses question 2 for its microphone and enables its Review after a transcript', () => {
    const tree = twoQuestions();
    const answer = tree.querySelector('textarea[data-tutor-exercise="question-2"]')!;
    const microphone = tree.querySelector('[data-command="dictateTutorExercise"][data-tutor-exercise="question-2"]')!;
    new Function('target', 'command', 'HTMLTextAreaElement', branch(script(),
      "if (command === 'dictateTutorExercise')", "if (command === 'dictateTutorConversation')"))(microphone, 'dictateTutorExercise', tree.TextArea);
    expect(answer.focus).toHaveBeenCalledOnce();
    expect(tree.querySelector('textarea[data-tutor-exercise="question-1"]')!.focus).not.toHaveBeenCalled();
    const source = script();
    const sync = branch(source, 'function syncTutorReviewState(', "document.addEventListener('keydown'");
    const transcript = branch(source, "const answer = document.querySelector(\n            'textarea[data-tutor-exercise=", "\n        }\n      }\n      if (message.command === 'tutorReplayAllState')");
    const postMessage = vi.fn();
    new Function('document', 'activeExerciseId', 'message', 'HTMLTextAreaElement', 'HTMLButtonElement', 'vscode', sync + transcript)
      (tree, 'question-2', { transcript: 'Spoken answer.' }, tree.TextArea, tree.Button, { postMessage });
    expect(answer.value).toBe('Spoken answer.');
    // Changed 2026-10-04: dictation enables the last-page Review all in place.
    expect(tree.querySelector('[data-command="reviewUnreviewedTutorExercises"][data-tutor-exercise="question-2"]')!.disabled).toBe(false);
    expect(tree.querySelector('[data-command="reviewTutorExercise"][data-tutor-exercise="question-1"]')).toBeNull();
    expect(postMessage).toHaveBeenCalledWith({ command: 'updateTutorAnswer', exerciseId: 'question-2', answer: 'Spoken answer.' });
  });

  it('typing enables Next without replacing the first answer box, and clearing disables it', () => {
    const tree = dom(renderTutorExercises(practiceState()));
    const answer = tree.querySelector('textarea[data-tutor-answer]')!;
    const review = tree.querySelector('[data-command="reviewTutorExercise"]')!;
    const next = tree.querySelector('[data-command="showNextTutorExercise"]')!;
    const source = script();
    const sync = branch(source, 'function syncTutorReviewState(', "document.addEventListener('keydown'");
    const input = branch(source, "if (target instanceof HTMLTextAreaElement && target.hasAttribute('data-tutor-answer'))", "\n      if (target instanceof HTMLTextAreaElement &&\n");
    const handler = new Function('target', 'HTMLTextAreaElement', 'HTMLButtonElement', 'vscode', sync + input);
    const postMessage = vi.fn();
    for (const text of ['', ' \n ', 'My answer.', '']) {
      answer.value = text;
      handler(answer, tree.TextArea, tree.Button, { postMessage });
      expect(review).toBeNull();
      for (const button of [next]) {
        expect(button.disabled).toBe(!text.trim());
        expect(button.getAttribute('aria-disabled')).toBe(String(!text.trim()));
      }
      expect(tree.querySelector('textarea[data-tutor-answer]')).toBe(answer);
      expect(postMessage).toHaveBeenLastCalledWith({ command: 'updateTutorAnswer', exerciseId: 'question-1', answer: text });
    }
  });

  it('typing patches Retry availability and its empty-answer message without replacing the answer box', () => {
    const state = practiceState();
    state.reviewFailures['question-1'] = 'The review failed.';
    const markup = renderTutorExercises(state);
    expect(load(markup)('[data-tutor-review-retry-empty]').text()).toMatch(/enter.*answer.*retry/iu);
    const tree = dom(markup);
    const answer = tree.querySelector('textarea[data-tutor-answer]')!;
    const retry = tree.querySelector('[data-tutor-review-retry]')!;
    const empty = tree.querySelector('[data-tutor-review-retry-empty]')!;
    const source = script();
    const sync = branch(source, 'function syncTutorReviewState(', "document.addEventListener('keydown'");
    const input = branch(source, "if (target instanceof HTMLTextAreaElement && target.hasAttribute('data-tutor-answer'))", "\n      if (target instanceof HTMLTextAreaElement &&\n");
    const handler = new Function('target', 'HTMLTextAreaElement', 'HTMLButtonElement', 'vscode', sync + input);
    for (const text of ['', 'need to make', '   ']) {
      answer.value = text;
      handler(answer, tree.TextArea, tree.Button, { postMessage: vi.fn() });
      expect(retry.disabled).toBe(!text.trim());
      expect(retry.getAttribute('aria-disabled')).toBe(String(!text.trim()));
      expect((empty as unknown as { hidden: boolean }).hidden).toBe(Boolean(text.trim()));
      expect(tree.querySelector('textarea[data-tutor-answer]')).toBe(answer);
    }
  });

  it('dictation enables Next on the first page with the same textarea', () => {
    const tree = dom(renderTutorExercises(practiceState()));
    const answer = tree.querySelector('textarea[data-tutor-answer]')!;
    const source = script();
    const sync = branch(source, 'function syncTutorReviewState(', "document.addEventListener('keydown'");
    const transcript = branch(source, "const answer = document.querySelector(\n            'textarea[data-tutor-exercise=", "\n        }\n      }\n      if (message.command === 'tutorReplayAllState')");
    const postMessage = vi.fn();
    new Function('document', 'activeExerciseId', 'message', 'HTMLTextAreaElement', 'HTMLButtonElement', 'vscode', sync + transcript)
      (tree, 'question-1', { transcript: 'Spoken answer.' }, tree.TextArea, tree.Button, { postMessage });
    expect(tree.querySelector('[data-command="reviewTutorExercise"]')).toBeNull();
    for (const command of ['showNextTutorExercise']) {
      const button = tree.querySelector(`[data-command="${command}"]`)!;
      expect(button.disabled).toBe(false);
      expect(button.getAttribute('aria-disabled')).toBe('false');
    }
    expect(tree.querySelector('textarea[data-tutor-answer]')).toBe(answer);
    expect(postMessage).toHaveBeenLastCalledWith({ command: 'updateTutorAnswer', exerciseId: 'question-1', answer: 'Spoken answer.' });
  });

  it('last-page typing keeps Review all disabled and names the first unanswered earlier item', () => {
    const state = practiceState();
    state.currentExerciseIndex = 1;
    const tree = dom(renderTutorExercises(state));
    const answer = tree.querySelector('textarea[data-tutor-answer]')!;
    const review = tree.querySelector('[data-command="reviewUnreviewedTutorExercises"]')!;
    const source = script();
    const sync = branch(source, 'function syncTutorReviewState(', "document.addEventListener('keydown'");
    const input = branch(source, "if (target instanceof HTMLTextAreaElement && target.hasAttribute('data-tutor-answer'))", "\n      if (target instanceof HTMLTextAreaElement &&\n");
    const handler = new Function('target', 'HTMLTextAreaElement', 'HTMLButtonElement', 'vscode', sync + input);
    for (const text of ['Last answer.', '   ']) {
      answer.value = text;
      handler(answer, tree.TextArea, tree.Button, { postMessage: vi.fn() });
      expect(review.disabled).toBe(true);
      expect(review.getAttribute('aria-disabled')).toBe('true');
      expect(review.getAttribute('title')).toBe('Answer item 1 first');
      expect(review.node.text()).toMatch(/review all/iu);
      expect(tree.querySelector('[data-command="showPreviousTutorExercise"]')!.disabled).toBe(false);
      expect(tree.querySelector('textarea[data-tutor-answer]')).toBe(answer);
    }
  });

  it('offers Review all when the last item is already reviewed, then disables it when all are reviewed', () => {
    const state = practiceState();
    state.answers = { 'question-1': 'First answer.', 'question-2': 'Last answer.' };
    state.currentExerciseIndex = 1;
    state.reviews['question-2'] = { schemaVersion: 1, exerciseId: 'question-2', learnerText: 'Last answer.', correct: [], incorrect: [] };
    let $ = load(renderTutorExercises(state));
    expect($('[data-command="reviewUnreviewedTutorExercises"]:not([disabled])')).toHaveLength(1);
    expect($('[data-command="showNextTutorExercise"][disabled]')).toHaveLength(1);
    state.reviews['question-1'] = { schemaVersion: 1, exerciseId: 'question-1', learnerText: 'First answer.', correct: [], incorrect: [] };
    $ = load(renderTutorExercises(state));
    expect($('[data-command="reviewUnreviewedTutorExercises"][disabled][aria-disabled="true"]')).toHaveLength(1);
    expect($('[data-command="reviewTutorExercise"]')).toHaveLength(0);
    expect($('[data-command="showNextTutorExercise"]:not([disabled])')).toHaveLength(1);
  });

  it('uses normal flow for the lesson article and an adjacent map and recipe stack', () => {
    const markup = render(stateWithLesson());
    const $ = load(markup);
    expect($('.tutor-map-recipe').children('details').map((_index, node) => $(node).attr('data-persist-id')).get()).toEqual(['tutor-map', 'tutor-recipe']);
    expect(declarations(markup, '.tutor-map-recipe')['margin-top']).toBe('14px');
    expect(declarations(markup, '.tutor-page .rewrite-settings-group').margin).toBe('0');
    expect(declarations(markup, '.tutor-map-recipe > details + details')['margin-top']).toBe('-1px');
    expect(declarations(markup, '.tutor-lesson-section').display).toBeUndefined();
    expect(declarations(markup, '.tutor-lesson').margin).toBe('10px 0');
    expect(declarations(markup, '.tutor-lesson-introduction')).toMatchObject({ margin: '0 0 12px', font: 'inherit', 'line-height': '1.5', color: 'var(--vscode-foreground)' });
    expect(declarations(markup, '.tutor-lesson-instruction')).toMatchObject({ margin: '18px 0 10px', font: 'inherit', 'line-height': '1.5', color: 'var(--vscode-foreground)' });
    expect($('[data-tutor-action-status]').text()).not.toMatch(/ready to draft/iu);
  });
});
