import { load } from 'cheerio';
import { parse as parseCss } from 'postcss';
import { describe, expect, it } from 'vitest';
import { TUTOR_MAP, type TutorLesson } from '@kren/core/tutor';
import { renderKrenResultViewHtml, renderTutorExercises, tutorWaitingNotice } from '../src/resultViewHtml.js';
import { tutorExerciseGenerationRequest } from '../src/tutor/generation.js';
import { createTutorViewState, tutorRecipeFromState, type TutorViewState } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

/*
 * The reader's list of 2026-09-15, checked against the rendered page. Every item was also
 * confirmed in a screenshot of this same render before these guards were written, because
 * the disclosure triangles had already shown that layout guessed from source does not converge.
 */

const leaves = TUTOR_MAP.filter((node) => !TUTOR_MAP.some((candidate) => candidate.parentId === node.id));
const primary = leaves[0]!;

function lesson(): TutorLesson {
  return {
    schemaVersion: 1, mapVersion: '1.0.0', lessonTitle: 'Reference', level: 'B2',
    primaryTarget: { nodeId: primary.id, label: primary.label, kind: primary.kind, role: 'primary', description: primary.description },
    supportingTargets: [],
    conceptExplanation: 'Concept.', patternStatement: 'Pattern.', interactionExplanation: 'Interaction.',
    rules: [{ statement: 'Rule.', status: 'rule' }],
    examples: [{ id: 'example-1', sentence: 'This initiative was approved.', targetIds: [primary.id],
      annotations: [{ targetId: primary.id, excerpt: 'This initiative', explanation: 'Refers back.' }] }],
    commonErrors: [{ id: 'error-1', incorrect: 'It initiative.', corrected: 'This initiative.', explanation: 'Needs a noun.', status: 'rule' }],
    practice: [], answerKey: [], generationNotes: []
  };
}

function withPractice(state: TutorViewState, reviewed: boolean): TutorViewState {
  state.exerciseSet = {
    schemaVersion: 1, mapVersion: '1.0.0', channel: 'written',
    exercises: [
      { id: 'practice-1', channel: 'written', prompt: 'Refer back.', targetIds: [primary.id] },
      { id: 'practice-2', channel: 'written', prompt: 'Refer again.', targetIds: [primary.id] }
    ]
  };
  state.answers = { 'practice-1': 'This initiative.' };
  if (reviewed) {
    state.reviews = { 'practice-1': {
      schemaVersion: 1, exerciseId: 'practice-1', learnerText: 'This initiative.',
      correct: [{ excerpt: 'This initiative', reason: 'Clear.' }], incorrect: []
    } };
  }
  return state;
}

function render(state: TutorViewState): string {
  return renderKrenResultViewHtml({
    cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
    activeScreen: 'tutor', tutor: state, proModels: []
  });
}

function declarations(markup: string, selector: string): Record<string, string> {
  const values: Record<string, string> = {};
  parseCss(load(markup)('style').text()).walkRules((rule) => {
    if (rule.selectors.includes(selector)) {
      rule.walkDecls((declaration) => { values[declaration.prop] = declaration.value; });
    }
  });
  return values;
}

// Changed 2026-09-30: V175b checks all margin rules matching the actual element,
// including more specific overrides and shorthand declarations.
function topMarginsFor(markup: string, elementSelector: string): string[] {
  const $ = load(markup);
  const element = $(elementSelector);
  expect(element).toHaveLength(1);
  const values: string[] = [];
  parseCss($('style').text()).walkRules((rule) => {
    rule.walkDecls(/^(?:margin|margin-top)$/u, (declaration) => {
      if (rule.selectors.some((selector) => element.is(selector))) {
        values.push(declaration.value.split(/\s+/u)[0]!);
      }
    });
  });
  return values;
}

function lessonState(): TutorViewState {
  const state = createTutorViewState();
  state.selection = [{ nodeId: primary.id, role: 'primary' }];
  state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(), findings: [] };
  return state;
}

function diagnosticReportState(): TutorViewState {
  const state = createTutorViewState();
  state.diagnosticReport = {
    summary: 'A short summary.',
    findings: [{
      level: 2, observation: 'Use a past form.', evidence: 'I go', correction: 'I went', targetId: primary.id
    }],
    polish: [{
      evidence: 'a good result', suggestion: 'a strong result', reason: 'Strong is more precise.', targetId: primary.id
    }],
    targets: [{ nodeId: primary.id, role: 'primary' }],
    focus: 'Practise completed events.'
  };
  state.diagnosticReportSource = { kind: 'conversation', turnCount: 4 };
  state.diagnosticReportDrawerOpen = true;
  return state;
}

describe('Tutor layout, 2026-09-15', () => {
  it('Lesson 1 gives the explanation list a selector that outranks the lesson list reset', () => {
    const markup = render(lessonState());
    // .tutor-lesson ul sets padding-left to 0 at specificity 0,1,1. A bare class loses to it,
    // which is what put the bullets outside the panel. The qualified selector wins at 0,2,0.
    expect(declarations(markup, '.tutor-lesson ul')).toMatchObject({ 'padding-left': '0' });
    expect(declarations(markup, '.tutor-lesson .tutor-annotation-list')).toMatchObject({
      'padding-left': '1.55em',
      'list-style': 'none'
    });
  });

  it('Lesson 1 and 2 draw a set-size disc starting between the badge E and X, on the first line', () => {
    const disc = declarations(render(lessonState()), '.tutor-annotation-list > li::before');
    expect(disc).toMatchObject({
      content: "''",
      position: 'absolute',
      left: '-0.73em',
      top: 'calc(0.5lh - 0.18em)',
      'border-radius': '50%',
      background: 'currentColor'
    });
    expect(disc.width).toBe(disc.height);
    // Changed 2026-09-15: the badge adds .45em horizontal padding, so the disc moves with E.
    // Its left edge lands 1.55 - 0.73 = 0.82em from the row edge, while text stays at 1.55em.
    expect(1.55 + Number.parseFloat(disc.left!)).toBeCloseTo(0.82, 5);
  });

  it('Other 1 centres a wrapped summary title beside its triangle in both foldable kinds', () => {
    const markup = render(createTutorViewState());
    // Changed 2026-09-16: every nested foldable uses the element-qualified shared rule.
    expect(declarations(markup, 'details.rewrite-settings-group > summary')['align-items']).toBe('center');
    expect(declarations(markup, '.settings-group > summary')['align-items']).toBe('center');
  });

  it('Practice 1 disables Hint once the item is reviewed, and not before', () => {
    const hint = (reviewed: boolean) =>
      load(renderTutorExercises(withPractice(createTutorViewState(), reviewed)))('button[data-command="hintTutorExercise"]');
    expect(hint(false).is('[disabled]')).toBe(false);
    expect(hint(true).is('[disabled]')).toBe(true);
  });

  it('Practice 2 puts REVIEW at the head and the explanation before the review', () => {
    // Changed 2026-10-14: V236, owner item 1.9, layout checks use a supplied task line instead of generic filler.
    const state = withPractice(createTutorViewState(), true);
    state.exerciseSet!.exercises[0]!.taskLine = 'Refer back to the subject with a noun phrase.';
    const reviewed = renderTutorExercises(state);
    const $ = load(reviewed);
    // Changed 2026-09-15: the real heading now sits in the badge-and-divider row.
    const row = $('[aria-label^="Review of exercise"] > .tutor-section-heading');
    const heading = row.children('h4.tutor-review-details-heading');
    // Changed 2026-09-30: the reviewed panel names its purpose and ends with the explanation.
    expect(heading.text()).toBe('REVIEW');
    expect($('[aria-label^="Review of exercise"]').children().first().is(row)).toBe(true);
    // Changed 2026-10-04: V202 moves the hint/explanation out of the review, directly before it.
    expect($('[aria-label^="Review of exercise"] .tutor-question-explanation')).toHaveLength(0);
    expect($('[aria-label^="Review of exercise"]').prev().is('.tutor-question-explanation')).toBe(true);
    expect(load(renderTutorExercises(withPractice(createTutorViewState(), false)))('.tutor-review-details-heading')).toHaveLength(0);
    expect(declarations(render(createTutorViewState()), '.tutor-section-heading').margin).toMatch(/^1\.45em/u);
  });

  it('Other 2 puts LESSON SETTING above the lesson and general SETTING after the conversation, reached from the title gear', () => {
    const markup = render(withPractice(lessonState(), false));
    const $ = load(markup);
    const page = markup.slice(markup.indexOf('class="tutor-page"'));
    const conversation = page.indexOf('data-tutor-conversation');
    expect(conversation).toBeGreaterThan(-1);
    // Changed 2026-09-30: V175 moves only Lesson settings before the lesson output.
    expect(page.indexOf('>LESSON SETTING</span>')).toBeLessThan(conversation);
    // Changed 2026-10-03: locate the group by its persistent identity after the rename.
    expect(page.indexOf('data-persist-id="tutor-setting"')).toBeGreaterThan(conversation);
    // Changed 2026-10-03: V190 names the voice/model group without the redundant Setting suffix.
    expect($('[data-persist-id="tutor-setting"] > summary').text()).toMatch(/voice.*model/iu);
    expect($('.tutor-lesson-section > [data-persist-id="tutor-lesson"]')).toHaveLength(1);
    expect($('[data-tutor-configuration] > [data-persist-id="tutor-setting"]')).toHaveLength(1);

    const jump = $('.tutor-heading-title > button[data-tutor-jump-configuration]');
    expect(jump).toHaveLength(1);
    expect($('.tutor-heading-title > h1').text()).toBe('AI English Tutor');
    // Page navigation carries no data-command, since every data-command is posted to the host.
    expect(jump.attr('data-command')).toBeUndefined();
    const script = $('script').text();
    const handler = script.slice(script.indexOf("target.hasAttribute('data-tutor-jump-configuration')"));
    expect(handler.slice(0, 400)).toContain("document.querySelector('[data-tutor-configuration]')");
    expect(handler.slice(0, 400)).toContain('scrollIntoView');
  });

  it('Other 4 offers practice before Common errors when a lesson exists, and nowhere else', () => {
    const $ = load(render(lessonState()));
    expect($('[data-tutor-heading-actions] [data-command="generateTutorExercises"]')).toHaveLength(0);
    const action = $('.tutor-lesson [data-tutor-lesson-practice-action] > [data-command="generateTutorExercises"]');
    expect(action).toHaveLength(1);
    // Changed 2026-09-30: V175 puts the practice action immediately before Common errors.
    expect($('.tutor-lesson [data-persist-id="tutor-lesson-errors"]').prev().is('[data-tutor-lesson-practice-action]')).toBe(true);

    // Not in the heading even with no lesson, at the reader's direction on 2026-09-15.
    const bare = load(render(createTutorViewState()));
    expect(bare('[data-command="generateTutorExercises"]')).toHaveLength(0);
    expect(bare('[data-tutor-lesson-practice-action]')).toHaveLength(0);
  });
});

describe('Tutor layout, 2026-09-15, second round', () => {
  it('Interface 1 draws the gear with no button background', () => {
    const markup = render(createTutorViewState());
    expect(declarations(markup, '.tutor-content .icon-button.tutor-configuration-jump')).toMatchObject({
      color: 'var(--vscode-foreground)',
      background: 'transparent',
      'border-color': 'transparent'
    });
    expect(load(markup)('.tutor-heading-title > button.tutor-configuration-jump')).toHaveLength(1);
  });

  it('Interface 2 never offers practice in the heading, with or without a lesson', () => {
    for (const state of [createTutorViewState(), lessonState()]) {
      expect(load(render(state))('[data-tutor-heading-actions] [data-command="generateTutorExercises"]')).toHaveLength(0);
    }
  });

  it('Interface 3 moves both report lists a quarter em right, under the numbers', () => {
    const markup = render(createTutorViewState());
    expect(declarations(markup, '.tutor-report-details')['margin-left']).toBe('-0.95em');
    expect(declarations(markup, '.tutor-report-targets')['margin-left']).toBe('.25em');
  });

  it('Lesson 1 capitalises COMMON ERRORS', () => {
    const markup = render(lessonState());
    expect(markup).toContain('<span class="rewrite-group-name">COMMON ERRORS</span>');
    expect(markup).not.toContain('>Common errors</span>');
  });

  it('Practice 1 forbids choice items above Elementary and allows them at Beginner and Elementary', () => {
    const request = (level: 'A2' | 'B2') => {
      const state = lessonState();
      state.settings.learnerLevel = level;
      return tutorExerciseGenerationRequest({ examples: [], schemaVersion: 1, recipe: tutorRecipeFromState(state), count: 3, channel: 'written' }).instruction;
    };
    expect(request('B2')).toContain('Pitch every exercise at Upper-intermediate (B2) level.');
    expect(request('B2')).toContain('Never write an item the learner can answer by choosing between supplied options');
    expect(request('A2')).toContain('Pitch every exercise at Elementary (A2) level.');
    expect(request('A2')).not.toContain('Never write an item the learner can answer by choosing');
  });

  it('Practice 2 holds Practice again until every item is reviewed, and shows that it is held', () => {
    const button = (reviewed: boolean) => {
      const state = withPractice(lessonState(), reviewed);
      if (reviewed) {
        state.reviews['practice-2'] = { ...state.reviews['practice-1']!, exerciseId: 'practice-2' };
      }
      return load(render(state))('[data-tutor-lesson-practice-action] > [data-command="generateTutorExercises"]');
    };
    expect(button(false).attr('aria-disabled')).toBe('true');
    expect(button(false).attr('aria-description')).toBe('Finish every question in this practice set first.');
    expect(button(true).attr('aria-disabled')).toBeUndefined();
    // 2026-10-04: V203 restores the owner's disabled Practice fade.
    expect(declarations(render(lessonState()), '[data-tutor-lesson-practice-action] > button[aria-disabled="true"]').opacity).toBe('.45');
  });

  it('Practice 3 shows the waiting overlay for a Hint, with a Cancel that names it', () => {
    const state = withPractice(lessonState(), false);
    state.exerciseHintBusyIds = ['practice-2'];
    expect(tutorWaitingNotice(state)).toBe('Explaining what this question asks. Please wait.');
    const overlay = load(render(state))('.busy-overlay');
    expect(overlay).toHaveLength(1);
    expect(overlay.find('button[data-command="cancelTutorPracticeHint"][data-tutor-exercise="practice-2"]')).toHaveLength(1);
  });
});

describe('V100 tutor layout corrections, 2026-09-15', () => {
  it('Item 1 leaves one body-text line around question-only and after Micro-target', () => {
    const markup = render(createTutorViewState());
    const $ = load(markup);
    const map = $('[data-persist-id="tutor-map"]');

    expect(map.find('> .rewrite-group-fields > .tutor-question-only-setting > label.setting')).toHaveLength(1);
    expect(declarations(markup, '.tutor-question-only-setting').margin).toBe('1.2em 0');
    expect(declarations(markup, '.tutor-map-level[data-tutor-map-control="microTarget"]')['margin-bottom']).toBe('1.2em');
  });

  it('Item 2 puts Lesson and its fixed introduction before settings, actions and the lesson box', () => {
    const $ = load(render(lessonState()));
    const box = $('article.tutor-lesson[data-tutor-result="lesson"]');
    // Changed 2026-09-30: V175 removes the generated title and keeps the fixed introduction.
    const title = box.parent().children('.tutor-lesson-introduction');
    const heading = title.prev();

    expect(box).toHaveLength(1);
    expect(box.children('h2')).toHaveLength(0);
    expect(title.is('p')).toBe(true);
    expect(title.text()).toMatch(/draft a short lesson.*worked examples and practice/iu);
    expect(heading.is('h2')).toBe(true);
    // Changed 2026-09-16: the literal heading is uppercase for sighted and screen-reader users.
    expect(heading.text()).toBe('LESSON');
    expect(heading.parent().is('.tutor-lesson-section')).toBe(true);
  });

  it('Item 3 puts Conversation before its white box and keeps Speaker inside', () => {
    const $ = load(render(createTutorViewState()));
    const box = $('section.tutor-conversation[data-tutor-result="conversation"]');
    const introduction = box.prev();
    const heading = introduction.prev();

    expect(box).toHaveLength(1);
    expect(box.find('h2')).toHaveLength(0);
    expect(heading.is('h2#tutor-conversation-heading')).toBe(true);
    // Changed 2026-09-16: the literal heading is uppercase for sighted and screen-reader users.
    expect(heading.text()).toBe('CONVERSATION');
    // Changed 2026-09-16: V106 places the ordinary introduction between the heading and box.
    expect(introduction.is('p.tutor-conversation-intro')).toBe(true);
    // Changed 2026-09-17: the audio controls belong to a conversation that exists. Before the
    // first one is started there is nothing to replay and nowhere to dictate, so the row is
    // absent here and returns once a conversation is running or has been stopped.
    expect(box.children('[data-tutor-composer-controls]')).toHaveLength(0);
    expect(box.find('[data-tutor-composer-audio]')).toHaveLength(0);
  });

  it('Item 4 keeps both real headings as blue badges with centred dividers in one row', () => {
    const lessonMarkup = render(lessonState());
    const practiceMarkup = renderTutorExercises(withPractice(createTutorViewState(), true));
    for (const [markup, text] of [[lessonMarkup, 'EXPLANATION'], [practiceMarkup, 'REVIEW']] as const) {
      const $ = load(markup);
      const heading = $('h4.tutor-section-badge').filter((_, element) => $(element).text() === text);
      const row = heading.parent('.tutor-section-heading');
      expect(heading).toHaveLength(1);
      expect(row).toHaveLength(1);
      expect(row.children().last().is('.tutor-section-divider[aria-hidden="true"]')).toBe(true);
    }

    expect(declarations(lessonMarkup, '.tutor-section-heading')).toMatchObject({
      display: 'flex',
      'align-items': 'center'
    });
    expect(declarations(lessonMarkup, '.tutor-section-badge')).toMatchObject({
      padding: '.25em .45em',
      'border-radius': '4px',
      // 2026-10-04: Link foreground meets body-text contrast on the card surface.
      color: 'var(--vscode-textLink-foreground)',
      background: 'transparent'
    });
    expect(declarations(lessonMarkup, '.tutor-section-divider')).toMatchObject({
      'align-self': 'center',
      'border-top': '1px solid var(--vscode-widget-border, var(--vscode-panel-border))'
    });
  });
});

describe('V101 practice panels, 2026-09-15', () => {
  it('Item 7 nests only the question and answer in an inner panel aligned like a lesson example', () => {
    // Changed 2026-10-14: V236, owner item 1.9, the explanation block requires a specific supplied task.
    const state = withPractice(lessonState(), true);
    state.exerciseSet!.exercises[0]!.taskLine = 'Refer back to the subject with a noun phrase.';
    const markup = render(state);
    const $ = load(markup);
    const outer = $('article.tutor-lesson.tutor-practice-panel');
    const inner = outer.children('.tutor-exercise');

    expect(outer).toHaveLength(1);
    expect(inner).toHaveLength(1);
    expect(outer.children().first().is('.tutor-exercise')).toBe(true);
    expect(inner.children('.tutor-item-heading')).toHaveLength(1);
    expect(inner.children('.tutor-answer')).toHaveLength(1);
    // Changed 2026-09-30: V175 places controls immediately after the inner question card.
    expect(inner.next('.tutor-exercise-controls')).toHaveLength(1);
    expect(inner.find('.tutor-question-explanation, [aria-label^="Review of exercise"]')).toHaveLength(0);
    // Changed 2026-10-04: V202 places the explanation under the controls, outside and before the review.
    expect(outer.children('.tutor-exercise-controls').next().is('.tutor-question-explanation')).toBe(true);
    expect(outer.children('[aria-label^="Review of exercise"]').children('.tutor-question-explanation')).toHaveLength(0);
    expect(outer.children('[aria-label^="Review of exercise"]')).toHaveLength(1);
    expect(declarations(markup, '.tutor-lesson')).toMatchObject({
      padding: '12px',
      border: '1px solid var(--vscode-panel-border)',
      'border-radius': '6px'
    });
    expect(declarations(markup, '.tutor-exercise')).toMatchObject({
      padding: '10px',
      border: '1px solid var(--vscode-widget-border, var(--vscode-panel-border))',
      'border-radius': '5px'
    });
    expect($('.tutor-lesson > .tutor-example').length).toBeGreaterThan(0);
    expect(outer.children('.tutor-exercise')).toHaveLength(1);
    expect(declarations(markup, '.tutor-exercise-navigation')['margin-right'])
      .toBe(declarations(markup, '.tutor-example-navigation')['margin-right']);
  });

  it('Item 8 renders compact results in the white panel with plain spaced missed items and inline Q numbering', () => {
    const state = withPractice(lessonState(), true);
    state.reviews['practice-1']!.incorrect = [{
      excerpt: 'This', corrected: 'That', reason: 'Use the requested reference.', status: 'rule'
    }];
    state.answers['practice-2'] = 'This refers again.';
    state.reviews['practice-2'] = {
      schemaVersion: 1, exerciseId: 'practice-2', learnerText: 'This refers again.', correct: [],
      incorrect: [{ excerpt: 'This', corrected: 'That', reason: 'Use the requested reference.', status: 'rule' }]
    };
    state.practiceResultsOpened = true;
    const markup = render(state);
    const $ = load(markup);
    const results = $('[data-tutor-practice-results]');
    const missed = results.children('[data-tutor-missed-items]');
    const firstItem = missed.find('[data-tutor-missed-item]').first();

    expect(results.is('.tutor-lesson')).toBe(true);
    expect(missed.is('section')).toBe(true);
    expect(missed.is('details')).toBe(false);
    expect(missed.children('h4').text()).toBe('Missed items');
    expect(firstItem.html()).toMatch(/^<strong>Q:<\/strong> Refer back\./u);
    expect(firstItem.children().first().is('p, div, section, article, header, h1, h2, h3, h4, h5, h6')).toBe(false);
    expect(declarations(markup, '[data-tutor-target-result] > p').margin).toBe('0');
    expect(declarations(markup, '[data-tutor-missed-items] ol > li + li')['margin-top']).toBe('1em');
  });

  it('Item 6 keeps the single results control beside Practice again before COMMON ERRORS', () => {
    const state = withPractice(lessonState(), true);
    state.reviews['practice-2'] = { ...state.reviews['practice-1']!, exerciseId: 'practice-2' };
    const $ = load(render(state));
    const row = $('[data-tutor-lesson-practice-action]');

    // Changed 2026-09-30: V175 keeps results beside practice while moving the row before Common errors.
    expect($('[data-persist-id="tutor-lesson-errors"]').prev().is(row)).toBe(true);
    expect(row.parent().is('.tutor-lesson')).toBe(true);
    expect(row.children().map((_, element) => $(element).text()).get())
      .toEqual(['Practice again', 'Show results']);
  });
});

function completedPracticeState(): TutorViewState {
  const state = withPractice(lessonState(), true);
  state.reviews['practice-1']!.incorrect = [{
    excerpt: 'This', corrected: 'That', reason: 'Use the requested reference.', status: 'rule'
  }];
  state.answers['practice-2'] = 'This refers again.';
  state.reviews['practice-2'] = {
    schemaVersion: 1,
    exerciseId: 'practice-2',
    learnerText: 'This refers again.',
    correct: [{ excerpt: 'This', reason: 'Clear.' }],
    incorrect: []
  };
  state.practiceResultsOpened = true;
  return state;
}

describe('V103 reader interface edits, 2026-09-16', () => {
  it('uses literal uppercase for all four section headings', () => {
    const $ = load(render(completedPracticeState()));

    // Changed 2026-09-30: V175 nests the Lesson heading in its own section.
    expect($('.tutor-lesson-section > h2, .tutor-page > h2').map((_, element) => $(element).text()).get())
      .toEqual(['LESSON', 'CONVERSATION']);
    expect($('.tutor-exercises > h2').text()).toBe('PRACTICE');
    expect($('article[data-tutor-result="lesson"] > h3').text()).toBe('EXAMPLES');
  });

  it('guards all six generalized spacing groups through their shared rules', () => {
    const markup = render(completedPracticeState());

    expect(declarations(markup, 'details.rewrite-settings-group > summary')).toMatchObject({
      'margin-top': '5px',
      'margin-bottom': '5px'
    });
    for (const selector of ['.rewrite-group-name', '.rewrite-group-summary']) {
      expect(declarations(markup, selector)['margin-top'], selector).toBe('3px');
    }
    expect(declarations(markup, '.tutor-annotation-list > li')).toMatchObject({
      'margin-top': '10px',
      'margin-bottom': '0',
      'margin-left': '-5px'
    });
    expect(declarations(markup, '.tutor-missed-details > li')['margin-left']).toBe('3px');
    expect(declarations(markup, '.tutor-missed-details > li:first-child')['margin-top']).toBe('7px');
    expect(declarations(markup, '[data-tutor-practice-results] > .tutor-item-actions > button')['margin-top']).toBe('16px');
    // Changed 2026-09-16: V107 removes the facts list and all five selectors that styled it.
    for (const selector of [
      '.tutor-conversation-facts',
      '.tutor-conversation-facts > div',
      '.tutor-conversation-facts > div:first-child',
      '.tutor-conversation-facts dt',
      '.tutor-conversation-facts dd'
    ]) expect(declarations(markup, selector), selector).toEqual({});
  });

  it('centres triangle text on the Settings screen as well as nested tutor foldables', () => {
    const markup = renderKrenResultViewHtml({
      cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
      activeScreen: 'settings', proModels: []
    });
    const $ = load(markup);

    expect($('.settings-group > summary > h3').length).toBeGreaterThan(0);
    expect($('.rewrite-settings-group > summary > .rewrite-group-name').length).toBeGreaterThan(0);
    expect(declarations(markup, '.settings-group > summary')['align-items']).toBe('center');
    expect(declarations(markup, '.settings-group > summary > h3')['margin-top']).toBe('3px');
    expect(declarations(markup, '.settings-group > summary::before')['align-self']).toBe('center');
    expect(declarations(markup, 'details.rewrite-settings-group > summary')).toMatchObject({
      'align-items': 'center',
      'margin-top': '5px',
      'margin-bottom': '5px'
    });
    expect(declarations(markup, '.rewrite-group-name')['margin-top']).toBe('3px');
    expect(declarations(markup, '.rewrite-group-summary')['margin-top']).toBe('3px');
  });

  it('guards the required single-instance spacing edits', () => {
    const markup = render(completedPracticeState());

    expect(declarations(markup, 'article.tutor-example > div > div.tutor-section-heading')['margin-top']).toBe('24.85px');
    // Changed 2026-09-30: V175 puts the 35px margin on the practice action row only.
    expect(declarations(markup, '.tutor-lesson-practice-action').margin).toBe('35px 0 2px 11px');
    // Changed 2026-09-30: V175b guards the button itself against an extra top margin.
    for (const margin of topMarginsFor(markup, '.tutor-lesson-practice-action > .tutor-generate-practice')) {
      expect(Number.parseFloat(margin), `practice button top margin: ${margin}`).toBe(0);
    }
    expect(declarations(markup, '.tutor-exercises > section.tutor-lesson[aria-label="Practice results"]')).toMatchObject({
      'margin-top': '15px',
      'margin-left': '1px'
    });
    // Changed 2026-09-30: V175 restores normal article flow while keeping EXAMPLES spacing.
    expect(declarations(markup, '.tutor-lesson').margin).toBe('10px 0');
    // Changed 2026-09-30: V175b rejects negative top margins on the drafted lesson article.
    for (const margin of topMarginsFor(markup, 'article.tutor-lesson[data-tutor-result="lesson"]')) {
      expect(Number.parseFloat(margin), `lesson article top margin: ${margin}`).toBeGreaterThanOrEqual(0);
    }
    expect(declarations(markup, 'article.tutor-lesson > h3')['margin-top']).toBe('16px');
    expect(declarations(markup, 'article.tutor-lesson > details[data-persist-id="tutor-lesson-errors"]')['margin-top']).toBe('18px');
    expect(declarations(markup, 'section[aria-label="Practice results"] > h3')).toMatchObject({
      'margin-top': '10px',
      'margin-bottom': '10px'
    });
    expect(declarations(markup, '.tutor-action-status-region > p.tutor-action-status')).toMatchObject({
      'margin-top': '15px',
      'margin-bottom': '30px'
    });
  });

  it('guards the remaining lesson, practice, results and gear measurements', () => {
    const markup = render(completedPracticeState());

    expect(declarations(markup, '.tutor-page > h2')['margin-top']).toBe('20px');
    // Changed 2026-09-16: V105 keeps both sides of the measured LESSON-to-title gap.
    // Changed 2026-09-30: the Lesson heading now has the owner's complete margin rule.
    expect(declarations(markup, '.tutor-page > h2:not(#tutor-conversation-heading)').margin).toBe('30px 0 6px');
    expect(declarations(markup, '.tutor-page > p')['margin-top']).toBe('-9px');
    expect(declarations(markup, 'article.tutor-lesson[data-tutor-result="lesson"] > p')).toMatchObject({
      'margin-top': '5px',
      'margin-bottom': '10px'
    });
    // Changed 2026-09-30: V175 aligns adjacent map and recipe disclosure borders.
    expect(declarations(markup, '.tutor-map-recipe > details + details')['margin-top']).toBe('-1px');
    // Changed 2026-10-04: owner set the practice title's top padding to 0.
    expect(declarations(markup, '.tutor-exercises > h2')).toMatchObject({
      'margin-top': '20px',
      'margin-bottom': '15px',
      'padding-top': '0'
    });
    expect(declarations(markup, '.tutor-exercises > p')['margin-top']).toBe('0');
    expect(declarations(markup, '.tutor-configuration-jump > svg')).toMatchObject({
      'margin-top': '4px',
      'margin-left': '-8px'
    });
    expect(load(markup)('[data-tutor-practice-results] > .tutor-item-actions > button')).toHaveLength(3);
  });

  it('pins the conversation measurements after the V106 settings-row retune', () => {
    const markup = render(completedPracticeState());

    expect(declarations(markup, '.tutor-page > h2#tutor-conversation-heading')['margin-top']).toBe('22.18px');
    // Changed 2026-09-16: V105 removes the provisional negative conversation margin.
    expect(declarations(markup, '.tutor-page > section.tutor-conversation')['margin-top']).toBe('0');
    expect(declarations(markup, '.tutor-conversation-setup')).toMatchObject({
      'margin-top': '8px',
      'margin-left': '0'
    });
    // Changed 2026-09-16: the ad hoc label and select offsets are gone. The shared setting
    // grid owns the rows, with a restored divider above its first row.
    expect(declarations(markup, '.tutor-conversation-setup label').margin).toBeUndefined();
    expect(declarations(markup, '.tutor-conversation-setup > label > select').margin).toBeUndefined();
    expect(declarations(markup, '.tutor-conversation-settings > .setting:first-of-type')).toMatchObject({
      'padding-top': '9px',
      'border-top': '1px solid var(--vscode-widget-border, var(--vscode-panel-border))'
    });
    expect(declarations(markup, '.tutor-conversation-actions')['margin-left']).toBe('-1px');
    expect(declarations(markup, '.tutor-conversation-actions > span')).toMatchObject({
      'margin-top': '1px',
      'font-size': '11px'
    });
    // Changed 2026-09-16: V107 removes the disclosure and its CSS rule together.
    expect(declarations(markup, '.tutor-conversation-disclosure')).toEqual({});
  });
});

describe('V104 diagnostic report measurements, 2026-09-16', () => {
  it('shares one rule between all four section headings in both markup shapes', () => {
    const markup = render(diagnosticReportState());
    const $ = load(markup);
    const expectedSelectors = [
      '.tutor-diagnostic-report-drawer > h3',
      '.tutor-diagnostic-report-drawer > section > h3'
    ];
    const matchingRules: string[][] = [];
    parseCss($('style').text()).walkRules((rule) => {
      if (expectedSelectors.some((selector) => rule.selectors.includes(selector))) matchingRules.push(rule.selectors);
    });

    expect(matchingRules).toEqual([expectedSelectors]);
    for (const selector of expectedSelectors) {
      expect(declarations(markup, selector), selector).toMatchObject({
        'font-size': '18px',
        'margin-top': '20px',
        'margin-bottom': '10px'
      });
    }
    const headings = $('.tutor-diagnostic-report-drawer h3');
    expect(headings.map((_, element) => $(element).text()).get())
      .toEqual(['Findings', 'Naturalness suggestions', 'Proposed targets', 'Next lesson focus']);
    expect(headings.filter((_, element) => {
      const parent = $(element).parent();
      return parent.is('.tutor-diagnostic-report-drawer') || parent.is('.tutor-diagnostic-report-drawer > section');
    })).toHaveLength(4);
  });

  it('pins the visible title while preserving the dialog label', () => {
    const markup = render(diagnosticReportState());
    const drawer = load(markup)('.tutor-diagnostic-report-drawer');

    expect(drawer.attr('aria-label')).toBe('Diagnostic report');
    expect(drawer.children('h2').text()).toBe('Diagnostic Report');
    expect(declarations(markup, '.tutor-diagnostic-report-drawer > h2')).toMatchObject({
      'font-size': '25px',
      'margin-top': '10px',
      'margin-bottom': '10px'
    });
  });

  it('keeps the source and summary top margins together and their bottom margins different', () => {
    const markup = render(diagnosticReportState());
    const paragraphs = load(markup)('.tutor-diagnostic-report-drawer > h2').nextAll('p').slice(0, 2);

    expect(paragraphs.eq(0).text()).toBe('Source: Conversation, 4 completed turns.');
    expect(paragraphs.eq(1).text()).toBe('A short summary.');
    expect(declarations(markup, '.tutor-diagnostic-report-drawer > h2 + p')).toMatchObject({
      'margin-top': '5px',
      'margin-bottom': '5px'
    });
    expect(declarations(markup, '.tutor-diagnostic-report-drawer > h2 + p + p')).toMatchObject({
      'margin-top': '5px',
      'margin-bottom': '10px'
    });
  });

  it('moves only detail labels and the report action row, without changing list alignment', () => {
    const markup = render(diagnosticReportState());

    expect(declarations(markup, '.tutor-diagnostic-report-drawer .tutor-report-details > li > strong')['margin-left']).toBe('-2px');
    expect(declarations(markup, '.tutor-diagnostic-report-drawer > .settings-buttons')['margin-top']).toBe('20px');
    expect(declarations(markup, '.settings-buttons')['margin-top']).toBeUndefined();
    expect(declarations(markup, '.tutor-report-details')['margin-left']).toBe('-0.95em');
    expect(declarations(markup, '.tutor-report-targets')['margin-left']).toBe('.25em');
  });
});

describe('V105 reader interface edits, 2026-09-16', () => {
  it('shares one 25px bottom-margin rule across all three top-level output blocks', () => {
    const markup = render(withPractice(lessonState(), true));
    // Changed 2026-09-30: V175 moves the lesson article's shared spacing selector into its section.
    const expectedSelectors = [
      '.tutor-lesson-section > article.tutor-lesson[data-tutor-result="lesson"]',
      '.tutor-exercises > article.tutor-practice-panel',
      '.tutor-page > section.tutor-conversation'
    ];
    const sharedValues: string[] = [];
    parseCss(load(markup)('style').text()).walkRules((rule) => {
      if (!expectedSelectors.every((selector) => rule.selectors.includes(selector))) return;
      rule.walkDecls('margin-bottom', (declaration) => { sharedValues.push(declaration.value); });
    });

    expect(sharedValues).toEqual(['25px']);
    for (const selector of expectedSelectors) {
      expect(declarations(markup, selector)['margin-bottom'], selector).toBe('25px');
    }
  });

  it('gives the practice control row 20px above and 6px below', () => {
    const markup = render(withPractice(lessonState(), true));
    const $ = load(markup);

    // Changed 2026-09-30: V175 makes controls a direct child of the practice panel.
    expect($('.tutor-exercises > article.tutor-practice-panel > .tutor-exercise-controls')).toHaveLength(1);
    expect(declarations(markup, '.tutor-exercise-controls')).toMatchObject({
      // Changed 2026-09-30: V175 moves the controls outside the card with a 20px gap.
      'margin-top': '20px',
      'margin-bottom': '6px'
    });
  });

  it('keeps the LESSON heading and fixed introduction spacing together', () => {
    const markup = render(lessonState());
    const $ = load(markup);
    const title = $('.tutor-lesson-section > h2').next('.tutor-lesson-introduction');

    expect(title.text()).toMatch(/draft a short lesson.*worked examples and practice/iu);
    // Changed 2026-09-30: V175 keeps the heading's margin and gives the introduction normal flow.
    expect(declarations(markup, '.tutor-lesson-section > h2').margin).toBe('30px 0 6px');
    expect(declarations(markup, '.tutor-lesson-introduction').margin).toBe('0 0 12px');
  });

  it('scopes the review spacing to a practice panel', () => {
    const markup = render(withPractice(lessonState(), true));
    const $ = load(markup);
    const review = $('.tutor-practice-panel > [aria-label^="Review of exercise"]');

    // Changed 2026-09-30: the verdict is a green label, followed by the reason.
    expect(review.children('.tutor-section-heading').next('p.tutor-review-mark').find('strong.tutor-review-correct').text()).toBe('Correct.');
    expect(declarations(markup, '.tutor-practice-panel > [aria-label^="Review of exercise"] > .tutor-section-heading')['margin-top']).toBe('25px');
    expect(declarations(markup, '.tutor-practice-panel > [aria-label^="Review of exercise"] > .tutor-section-heading + p.tutor-review-mark')['margin-top']).toBe('10px');
  });

  it('guards the remaining heading, lesson, example, action and conversation measurements', () => {
    const state = completedPracticeState();
    state.practiceResultsOpened = false;
    const markup = render(state);
    const $ = load(markup);

    // Changed 2026-09-30: the page title row has the canvas spacing.
    expect(declarations(markup, '.tutor-heading-row').margin).toBe('0 0 14px');
    // Changed 2026-09-30: V175 removes the lesson article's negative top margin.
    expect(declarations(markup, '.tutor-lesson').margin).toBe('10px 0');
    expect(declarations(markup, 'article.tutor-lesson[data-tutor-result="lesson"] > p')['margin-top']).toBe('5px');
    expect(declarations(markup, 'article.tutor-lesson > h3')['margin-top']).toBe('16px');
    expect(declarations(markup, 'article.tutor-lesson > article.tutor-example')['margin-top']).toBe('20px');
    // Changed 2026-09-30: V175 removes extra button top margins from the practice action row.
    expect(declarations(markup, '.tutor-lesson-practice-action > button[data-command="showTutorPracticeResults"]')['margin-top']).toBeUndefined();
    expect(declarations(markup, '.tutor-page > section.tutor-conversation')['margin-top']).toBe('0');
    // Changed 2026-09-23: V144 keeps both idle buttons in the shared spaced action row, so
    // the measured vertical margins move to that row without deleting either assertion.
    expect(declarations(markup, '.tutor-conversation-start > .tutor-conversation-actions')['margin-top']).toBe('10px');
    expect(declarations(markup, '.tutor-conversation-start > .tutor-conversation-actions')['margin-bottom']).toBe('10px');
    // Changed 2026-09-17: only the idle invitation carries the measured negative margin.
    expect(declarations(markup, '.tutor-conversation-start > .tutor-conversation-invitation')['margin-top']).toBe('-20px');
    expect(declarations(markup, '.tutor-composer-audio')['margin-left']).toBe('auto');
    expect(declarations(markup, '.tutor-conversation-start > .tutor-conversation-invitation')['margin-left']).toBe('0');
    // Changed 2026-09-25 for V153: the invitation no longer repeats the retired button label.
    // Changed 2026-10-04: the generic layout fixture needs an available source to test its Start row.
    const available = createTutorViewState();
    available.conversation.from = 'anything';
    const startPage = load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE, activeScreen: 'tutor', tutor: available, proModels: [] }));
    expect(startPage('.tutor-conversation-start > p:first-child').text()).toMatch(/speak.*microphone/iu); // Changed 2026-10-18: V263, owner item I43, the invitation names spoken input.
    expect(startPage('.tutor-conversation-start > .tutor-conversation-actions > button[data-command="startTutorConversation"]')).toHaveLength(1);
  });
});
