import { readFileSync } from 'node:fs';
import { hostSource } from './support/hostSource.js';
import { load } from 'cheerio';
import { parse as parseCss } from 'postcss';
import { describe, expect, it } from 'vitest';
import { TUTOR_MAP } from '@kren/core/tutor';
import { renderKrenResultViewHtml, renderTutorExercises } from '../src/resultViewHtml.js';
import { tutorPracticeHintRequest } from '../src/tutor/generation.js';
import { createTutorViewState } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

function practiceState() {
  const state = createTutorViewState();
  const target = TUTOR_MAP.find((node) => node.kind === 'microTarget')!;
  state.exerciseSet = {
    schemaVersion: 1,
    mapVersion: '1.0.0',
    channel: 'written',
    exercises: [
      {
        id: 'exercise-1',
        channel: 'written',
        prompt: 'Compose a sentence using the requested structure.',
        targetIds: [target.id]
      },
      {
        id: 'exercise-2',
        channel: 'written',
        prompt: 'Complete another response.',
        targetIds: [target.id]
      }
    ]
  };
  state.answers = { 'exercise-1': 'My answer.' };
  return state;
}

function page() {
  return load(renderKrenResultViewHtml({
    cspSource: 'test',
    nonce: 'test',
    settings: PANEL_SETTINGS_FIXTURE,
    activeScreen: 'tutor',
    tutor: practiceState(),
    proModels: []
  }));
}

function declarations($: ReturnType<typeof page>, selector: string) {
  const values: Record<string, string> = {};
  parseCss($('style').text()).walkRules((rule) => {
    if (rule.selectors.includes(selector)) {
      rule.walkDecls((declaration) => { values[declaration.prop] = declaration.value; });
    }
  });
  return values;
}

function resultsViewCommands(kind: 'accepted' | 'handled') {
  const source = hostSource();
  const pattern = kind === 'accepted'
    ? /command !== '([a-zA-Z]+)'/gu
    : /message\.command === '([a-zA-Z]+)'/gu;
  return new Set([...source.matchAll(pattern)].map((match) => match[1]));
}

describe('V91 practice explanation and layout corrections', () => {
  it('R1 gives both disclosure glyphs a zero line box so they centre on the label text', () => {
    const $ = page();
    for (const selector of [
      '.settings-group > summary::before',
      '.rewrite-settings-group > summary::before'
    ]) {
      expect(declarations($, selector)).toMatchObject({
        'align-self': 'center',
        'line-height': '0'
      });
    }
  });

  it('R2 moves annotation markers about 2 mm right and hangs wrapped text', () => {
    expect(declarations(page(), '.tutor-annotation-list')).toMatchObject({
      'padding-left': '1.55em',
      'list-style': 'none'
    });
  });

  it('R3 gives lesson navigation the same flex spacing as practice navigation', () => {
    const $ = page();
    const lesson = declarations($, '.tutor-example-navigation');
    const practice = declarations($, '.tutor-exercise-navigation');
    for (const property of ['display', 'align-items', 'gap', 'margin-left', 'margin-right']) {
      expect(lesson[property], property).toBe(practice[property]);
    }
    expect(lesson).not.toHaveProperty('grid-template-columns');
  });

  it('R4 shows an answer-free explanation above a wrong review with the literal black bar', () => {
    // Changed 2026-10-14: V236, owner item 1.9, show the exercise's task instead of a generic target sentence.
    const state = practiceState();
    state.exerciseSet!.exercises[0]!.taskLine = 'Compose a sentence using the requested structure.';
    state.reviews['exercise-1'] = {
      schemaVersion: 1,
      exerciseId: 'exercise-1',
      learnerText: 'My answer.',
      correct: [],
      incorrect: [{ excerpt: 'answer', reason: 'Wrong form.', corrected: 'response', status: 'rule' }]
    };
    const markup = renderTutorExercises(state);
    const $ = load(markup);
    const explanation = $('.tutor-question-explanation');
    expect(explanation).toHaveLength(1);
    expect(explanation.text()).toMatch(/compose.*sentence.*structure/iu);
    // Changed 2026-10-04: V202 keeps the explanation outside and before review feedback.
    const feedbackAt = markup.indexOf('Not quite.');
    const explanationAt = markup.indexOf('tutor-question-explanation');
    expect(feedbackAt).toBeGreaterThanOrEqual(0);
    expect(explanationAt).toBeGreaterThanOrEqual(0);
    expect(explanationAt).toBeLessThan(feedbackAt);
    expect(explanation.parent().is('.tutor-practice-panel')).toBe(true);
    // 2026-10-04: Owner edits 8 and 9 remove the question block's inset and border.
    expect(page()('style').text()).toContain(
      '.tutor-question-explanation { margin: 1.45em 0 5px; padding-left: 0; border-style: none; }'
    );
  });

  it('R5 puts Hint output in the explanation block and never in the answer box', () => {
    const state = practiceState();
    // Changed 2026-09-20: V126 adds a separately rendered different-subject example.
    state.exerciseHints['exercise-1'] = {
      explanation: 'The current practice question asks you to compose a sentence with the target structure.',
      example: 'For a train, you could say: "It arrived at noon."'
    };
    const $ = load(renderTutorExercises(state));
    expect($('[data-tutor-hint-explanation]').text()).toBe(
      state.exerciseHints['exercise-1']?.explanation
    );
    expect($('[data-tutor-hint-example]').text()).toContain(
      `Example: ${state.exerciseHints['exercise-1']?.example}`
    );
    expect($('.tutor-answer').attr('placeholder')).toBeUndefined();

    state.exerciseHintBusyIds = ['exercise-1'];
    const busy = load(renderTutorExercises(state));
    expect(busy('.tutor-question-explanation[role="status"]').text())
      .toBe('Explaining what this question asks. Please wait.');
  });

  it('R5 asks the provider only for a task explanation and explicitly forbids an answer', () => {
    const request = tutorPracticeHintRequest(
      'Compose a sentence using the requested structure.',
      ['Target structure'],
      { axes: practiceState().settings.axes, learnerLevel: 'B2' }
    );
    expect(request.instruction).toContain('Explain what the practice question is asking');
    expect(request.instruction).not.toContain('Begin with');
    expect(request.instruction).not.toContain('The current practice question asks');
    expect(request.instruction).toContain('Never write the answer');
    expect(request.instruction).toContain('different subject');
    expect(request.instruction).toContain('must not be a sentence the reader could submit');
    expect(request.schema).toMatchObject({ required: ['explanation', 'example'] });
    expect(request.input).not.toContain('My answer.');
  });

  it('R5 accepts and handles the Hint command emitted by the practice control', () => {
    expect(resultsViewCommands('accepted')).toContain('hintTutorExercise');
    expect(resultsViewCommands('handled')).toContain('hintTutorExercise');
    expect(renderTutorExercises(practiceState())).toContain('data-command="hintTutorExercise"');
  });

  it('R7 accepts and handles the speaker command emitted by the practice control', () => {
    expect(resultsViewCommands('accepted')).toContain('playTutorExercise');
    expect(resultsViewCommands('handled')).toContain('playTutorExercise');
    expect(renderTutorExercises(practiceState())).toContain('data-command="playTutorExercise"');
  });
});
