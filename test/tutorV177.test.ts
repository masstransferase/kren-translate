import { load } from 'cheerio';
import { parse as parseCss } from 'postcss';
import { describe, expect, it, vi } from 'vitest';
import { TUTOR_MAP, type TutorLesson } from '@kren/core/tutor';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { createTutorViewState, markTutorExampleViewed, moveTutorExample, resetTutorGeneratedWork, tutorAllExamplesViewed, tutorRecipeFromState, type TutorViewState } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const target = TUTOR_MAP.find((node) => node.kind === 'microTarget')!;
function drafted(): TutorViewState {
  const state = createTutorViewState();
  state.selection = [{ nodeId: target.id, role: 'primary' }];
  const lesson: TutorLesson = {
    schemaVersion: 1, mapVersion: '1.0.0', lessonTitle: 'Examples', level: 'B2',
    primaryTarget: { ...target, nodeId: target.id, role: 'primary' }, supportingTargets: [],
    conceptExplanation: 'Concept.', interactionExplanation: 'Interaction.', rules: [],
    examples: [1, 2, 3].map((index) => ({ id: `example-${index}`, sentence: `Example ${index}.`, targetIds: [target.id], annotations: [] })),
    commonErrors: [], practice: [], answerKey: [], generationNotes: []
  };
  state.lesson = { lesson, recipe: tutorRecipeFromState(state), findings: [] };
  return markTutorExampleViewed(state);
}
function render(state = createTutorViewState(), reset = false): string {
  return renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE, activeScreen: 'tutor', tutor: state, tutorResetDisclosures: reset, proModels: [] });
}
function declarations(markup: string, selector: string): Record<string, string> {
  const values: Record<string, string> = {};
  parseCss(load(markup)('style').text()).walkRules((rule) => {
    if (rule.selectors.includes(selector)) rule.walkDecls((decl) => { values[decl.prop] = decl.value; });
  });
  return values;
}

describe('The owner spacing above the Hub dropdown', () => {
  it('pads the Hub panel 20px above, below the last listed target, and leaves the order alone', () => {
    const markup = render();
    expect(declarations(markup, '.tutor-map-level[data-tutor-map-control="hub"]')['padding-top']).toBe('20px');
    const $ = load(markup);
    const hub = $('.tutor-map-cascade .tutor-map-level').first();
    expect(hub.attr('data-tutor-map-control')).toBe('hub');
    expect($('[data-tutor-search-results]').nextAll('.tutor-map-cascade').length).toBe(1);
  });
});

describe('V177 Lesson inputs and reset controls', () => {
  it('places the master Reset at the title row right edge, alongside the heading and existing gear', () => {
    const markup = render(drafted());
    const $ = load(markup);
    const row = $('[data-tutor-heading-row]');
    const reset = row.children('button[data-command="resetTutorSession"]');
    expect(reset).toHaveLength(1);
    expect(row.children().last().is(reset)).toBe(true);
    expect(row.find('h1').text()).toBe('AI English Tutor');
    expect(row.find('[data-tutor-jump-configuration]')).toHaveLength(1);
    expect(reset.parents('details')).toHaveLength(0);
    expect(reset.hasClass('secondary')).toBe(true);
    expect(reset.attr('disabled')).toBeUndefined();
    expect(reset.attr('tabindex')).not.toBe('-1');
    expect(reset.attr('title')).toBe('Reset the learning map, lesson, practice and conversation');
    expect(declarations(markup, '.tutor-heading-row')).toMatchObject({ 'align-items': 'center', 'justify-content': 'space-between', 'flex-wrap': 'nowrap' });
    expect(declarations(markup, '.tutor-master-reset')).toMatchObject({ width: '60px', 'padding-left': '6px', 'padding-right': '6px' });
    expect($('.tutor-heading-actions [data-command="resetTutorLesson"]').attr('title')).toBe('Reset the lesson and practice');
  });

  it.each(['empty', 'busy'] as const)('enables empty-session master reset and disables resets when busy (%s)', (kind) => {
    const state = kind === 'empty' ? createTutorViewState() : drafted();
    if (kind === 'busy') state.conversation.busy = true;
    const $ = load(render(state));
    for (const command of ['resetTutorSession', 'resetTutorLesson']) {
      const action = $(`[data-command="${command}"]`);
      // Changed 2026-10-03: empty-session master reset can restore settings.
      if (kind === 'empty' && command === 'resetTutorSession') {
        expect(action.attr('disabled')).toBeUndefined();
        expect(action.attr('aria-disabled')).toBeUndefined();
      } else {
        expect(action.attr('disabled')).toBeDefined();
        expect(action.attr('aria-disabled')).toBe('true');
      }
    }
  });

  it('folds and persists the three disclosures after master reset, including after reload', () => {
    let stored = { openSections: { 'tutor-lesson': true, 'tutor-conversation-mode': true, 'tutor-setting': true, 'tutor-map': true, 'tutor-recipe': true } };
    for (const reset of [true, false]) {
      const markup = render(createTutorViewState(), reset);
      const $ = load(markup);
      class Details {
        open: boolean;
        constructor(public node: ReturnType<typeof $>) { this.open = node.is('[open]'); }
        getAttribute(key: string) { return this.node.attr(key) ?? null; }
      }
      const sections = $('details[data-persist-id]').toArray().map((node) => new Details($(node)));
      const document = {
        body: { hasAttribute: (key: string) => $('body').attr(key) !== undefined },
        querySelectorAll: () => sections,
        querySelector: (selector: string) => sections.find((section) => section.node.is(selector))
      };
      const script = $('script').text();
      const code = script.slice(script.indexOf('    const restored = panelState();'), script.indexOf('    // The toggle event'));
      new Function('document', 'HTMLDetailsElement', 'panelState', 'savePanelState', code)(
        document, Details, () => stored, (patch: typeof stored) => { stored = { ...stored, ...patch }; }
      );
      for (const id of ['tutor-lesson', 'tutor-conversation-mode', 'tutor-setting'] as const) {
        expect(sections.find((section) => section.getAttribute('data-persist-id') === id)?.open).toBe(false);
        expect(stored.openSections[id]).toBe(false);
      }
      expect(stored.openSections['tutor-map']).toBe(true);
      expect(stored.openSections['tutor-recipe']).toBe(true);
    }
  });

  it('V177b restores cascade, lesson question, then selected targets in both selection states', () => {
    // Changed 2026-10-01: the owner withdrew the spacing change and chose baseline ordering.
    for (const populated of [false, true]) {
      const state = populated ? drafted() : createTutorViewState();
      state.question = 'Which pattern should I use?';
      const markup = render(state);
      const $ = load(markup);
      const cascade = $('.tutor-map-cascade');
      expect(cascade.children().first().attr('data-tutor-map-control')).toBe('hub');
      expect(cascade.next().text()).toContain(state.question);
      expect(cascade.next().next().hasClass('tutor-tray')).toBe(true);
      expect($('.tutor-tray-row')).toHaveLength(populated ? 1 : 0);
      expect(cascade.attr('data-tutor-selected-targets')).toBeUndefined();
      expect(declarations(markup, '.tutor-map-cascade[data-tutor-selected-targets]')['margin-top']).toBeUndefined();
    }
  });

  it.each(['empty', 'target', 'question', 'typed question'] as const)('sets Draft availability for %s input', (input) => {
    const state = createTutorViewState();
    state.question = '   ';
    if (input === 'target') state.selection = [{ nodeId: target.id, role: 'support' }];
    // Changed 2026-10-01: V177b requires the existing switch for either question input.
    if (input === 'question' || input === 'typed question') state.settings.questionOnly = true;
    if (input === 'question') state.question = 'How do I use this?';
    if (input === 'typed question') state.mapSearch = 'How do I use this?';
    const action = load(render(state))('[data-command="generateTutorLesson"]');
    expect(action.attr('disabled') !== undefined).toBe(input === 'empty');
    expect(action.attr('aria-disabled') === 'true').toBe(input === 'empty');
    if (input === 'empty') expect(action.attr('title')).toBe('Choose a learning-map target, or turn on "Use question without learning-map targets" to draft from your question.');
  });

  it('patches Draft as the learner types and deletes, preserving the input and focus', () => {
    const markup = render();
    const $ = load(markup);
    class Button {
      disabled = true;
      // Changed 2026-10-01: typing alone enables Draft when question-only mode is on.
      attrs = new Map([['data-tutor-has-target', 'false'], ['data-tutor-has-question', 'false'], ['data-tutor-question-only', 'true']]);
      hasAttribute(key: string) { return this.attrs.has(key); }
      getAttribute(key: string) { return this.attrs.get(key) ?? null; }
      setAttribute(key: string, value: string) { this.attrs.set(key, value); }
      removeAttribute(key: string) { this.attrs.delete(key); }
    }
    class TextArea {
      value = '';
      hasAttribute(key: string) { return key === 'data-tutor-map-search'; }
    }
    const action = new Button();
    const input = new TextArea();
    const document = { querySelector: vi.fn(() => action), activeElement: input };
    const script = $('script').text();
    const sync = script.slice(script.indexOf('    function syncTutorDraftAvailability('), script.indexOf('    const tutorSearch ='));
    const listener = script.slice(script.indexOf("      if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&\n          target.hasAttribute('data-tutor-map-search')) {", script.indexOf("document.addEventListener('input'")), script.indexOf("      if (target instanceof HTMLTextAreaElement && target.hasAttribute('data-tutor-answer'))"));
    const vscode = { postMessage: vi.fn() };
    const patch = new Function('document', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'vscode', 'filterTutorMap', 'target', sync + listener);
    for (const value of ['A lesson question?', '  ']) {
      input.value = value;
      patch(document, Button, TextArea, TextArea, vscode, vi.fn(), input);
      expect(action.disabled).toBe(!value.trim());
      expect(action.getAttribute('aria-disabled')).toBe(value.trim() ? null : 'true');
      expect(input.value).toBe(value);
      expect(document.activeElement).toBe(input);
    }
    expect(vscode.postMessage).toHaveBeenLastCalledWith({ command: 'updateTutorSearch', search: '  ' });
  });

  it('keeps Practice now disabled until the final unviewed example is shown, then disables it after redraft', () => {
    let state = drafted();
    const action = () => load(render(state))('[data-command="generateTutorExercises"]');
    expect(state.viewedExampleIds).toEqual(['example-1']);
    expect(action().attr('disabled')).toBeDefined();
    expect(action().attr('title')).toBe('Go through every example first.');
    state = moveTutorExample(state, 1);
    expect(action().attr('disabled')).toBeDefined();
    state = moveTutorExample(state, -1);
    expect(action().attr('disabled')).toBeDefined();
    state = moveTutorExample(moveTutorExample(state, 1), 1);
    expect(tutorAllExamplesViewed(state)).toBe(true);
    expect(action().attr('disabled')).toBeUndefined();
    expect(action().attr('aria-disabled')).toBeUndefined();
    state = resetTutorGeneratedWork(state);
    state.lesson = drafted().lesson;
    state = markTutorExampleViewed(state);
    expect(state.viewedExampleIds).toEqual(['example-1']);
    expect(action().attr('disabled')).toBeDefined();
  });
});


it('V177 applies the same input rule to Redraft after the inputs are cleared', () => {
  const state = drafted();
  state.selection = [];
  state.question = '  ';
  state.mapSearch = '  ';
  const action = load(render(state))('[data-command="generateTutorLesson"]');
  expect(action.text()).toMatch(/redraft/iu);
  expect(action.attr('disabled')).toBeDefined();
  expect(action.attr('aria-disabled')).toBe('true');
  // Changed 2026-10-01: with the switch off, the reason names how to enable question drafting.
  expect(action.attr('title')).toBe('Choose a learning-map target, or turn on "Use question without learning-map targets" to draft from your question.');
});


it.each([[false, false], [false, true], [true, false], [true, true]])(
  'V177b Draft follows the setting with target=%s and questionOnly=%s', (hasTarget, questionOnly) => {
    const state = drafted();
    state.settings.questionOnly = questionOnly!;
    if (!hasTarget) state.selection = [];
    state.mapSearch = 'How do I use this pattern?';
    const available = hasTarget || questionOnly;
    // Check first render and Redraft so both labels keep the same eligibility rule.
    for (const hasLesson of [true, false]) {
      if (!hasLesson) state.lesson = undefined;
      const action = load(render(state))('[data-command="generateTutorLesson"]');
      expect(action.attr('disabled') === undefined).toBe(available);
      expect(action.attr('aria-disabled') !== 'true').toBe(available);
      if (!available) {
        expect(action.attr('title')).toBe('Choose a learning-map target, or turn on "Use question without learning-map targets" to draft from your question.');
        expect(action.attr('aria-description')).toBe(action.attr('title'));
      }
    }
  }
);

it('V177b keeps lesson Reset disabled for every request that can restore its generated work', () => {
  const busyStates: Array<(state: TutorViewState) => void> = [
    (state) => { state.lessonBusy = true; },
    (state) => { state.exampleBusyIds = ['example-1']; },
    (state) => { state.exerciseBusy = true; },
    (state) => { state.reviewBusyIds = ['exercise-1']; },
    (state) => { state.exerciseHintBusyIds = ['exercise-1']; },
    (state) => { state.practiceDiagnosisBusy = true; },
    (state) => { state.askBusy = 'exampleQuestion'; },
    (state) => { state.askBusy = 'practiceQuestion'; },
    (state) => { state.askBusy = 'passageDiagnosis'; },
    (state) => { state.toolDrawer = { tool: 'ask', input: 'Why?', status: 'loading' }; },
    (state) => { state.conversation.hintBusy = true; }
  ];
  for (const busy of busyStates) {
    const state = drafted();
    busy(state);
    const action = load(render(state))('[data-command="resetTutorLesson"]');
    expect(action.attr('disabled')).toBeDefined();
    expect(action.attr('aria-disabled')).toBe('true');
  }
});
