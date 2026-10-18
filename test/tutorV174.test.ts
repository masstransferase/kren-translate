import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import { TUTOR_MAP, type TrainingReview } from '@kren/core/tutor';
import { renderKrenResultViewHtml, renderTutorExercises } from '../src/resultViewHtml.js';
import { createTutorViewState } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const targetId = TUTOR_MAP.find((node) => node.kind === 'microTarget')!.id;

function practiceState() {
  const state = createTutorViewState();
  state.exerciseSet = {
    schemaVersion: 1, mapVersion: '1.0.0', channel: 'written',
    exercises: [
      { id: 'first', channel: 'written', prompt: 'Write the first answer.', targetIds: [targetId] },
      { id: 'second', channel: 'written', prompt: 'Write the second answer.', targetIds: [targetId] }
    ]
  };
  return state;
}

function review(exerciseId: string, correctedText: string, wrong: boolean): TrainingReview {
  return {
    schemaVersion: 1, exerciseId, learnerText: wrong ? 'I goed.' : correctedText,
    correctedText: wrong ? correctedText : undefined,
    correct: wrong ? [] : [{ excerpt: correctedText, reason: 'The form is correct.' }],
    incorrect: wrong ? [{ excerpt: 'goed', reason: 'Use the past form.', corrected: 'went', status: 'rule' }] : []
  };
}

describe('V174 Lesson canvas labels, colours and counters', () => {
  it('uses one theme-coloured transparent rule for both section badges', () => {
    const markup = renderKrenResultViewHtml({
      cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
      activeScreen: 'tutor', tutor: createTutorViewState(), proModels: []
    });
    const rule = markup.match(/\.tutor-section-badge \{([^}]+)\}/u)?.[1] ?? '';
    // 2026-10-04: Badge text uses the readable link color, retaining its accent role.
    expect(rule).toContain('color: var(--vscode-textLink-foreground)');
    expect(rule).toContain('background: transparent');
  });

  it('keeps the canvas light-theme hex colours out of src', () => {
    const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? files(path) : [path];
    });
    for (const path of files('src')) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(/#(?:3a6bc800|3a6bc8|1f1f1f|ffffff)\b/iu);
    }
  });

  it('limits transparent tool styling to action groups and keeps navigation arrows primary', () => {
    const markup = renderKrenResultViewHtml({
      cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
      activeScreen: 'tutor', tutor: practiceState(), proModels: []
    });
    const style = load(markup)('style').text();
    expect(style).toContain('.tutor-content .icon-button { color: var(--vscode-button-foreground); background: var(--vscode-button-background);');
    expect(style).toContain('.tutor-content .tutor-example-controls > .tutor-item-actions .icon-button, .tutor-content .tutor-exercise-controls > .tutor-item-actions .icon-button { color: var(--vscode-foreground); background: transparent;');
    const $ = load(renderTutorExercises(practiceState()));
    const arrows = $('.tutor-exercise-navigation button');
    expect(arrows).toHaveLength(2);
    arrows.each((_index, element) => {
      expect($(element).hasClass('tutor-action-icon')).toBe(true);
      expect($(element).is('.tutor-exercise-controls > .tutor-item-actions .icon-button')).toBe(false);
    });
  });

  it('keeps the active microphone red after transparent hover and disabled-hover rules', () => {
    const state = practiceState();
    state.speech.dictatingExerciseId = 'first';
    state.reviewBusyIds.push('first');
    const microphone = load(renderTutorExercises(state))('[data-command="dictateTutorExercise"]');
    expect(microphone).toHaveLength(1);
    expect(microphone.hasClass('tutor-dictation-active')).toBe(true);
    expect(microphone.hasClass('tutor-microphone-pulsing')).toBe(true);
    expect(microphone.is('[disabled]')).toBe(true);

    const style = load(renderKrenResultViewHtml({
      cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
      activeScreen: 'tutor', tutor: state, proModels: []
    }))('style').text();
    const active = '.tutor-content .tutor-exercise-controls > .tutor-item-actions .icon-button.tutor-dictation-active';
    const disabledHover = '.tutor-content .tutor-exercise-controls > .tutor-item-actions .icon-button:disabled:hover { background: transparent; }';
    expect(style.indexOf(disabledHover)).toBeGreaterThanOrEqual(0);
    expect(style.indexOf(`${active}, ${active}:hover, ${active}:disabled:hover { color: var(--vscode-editor-background); background: var(--vscode-charts-red, var(--vscode-errorForeground)); }`))
      .toBeGreaterThan(style.indexOf(disabledHover));
  });

  it('keeps both practice arrows visible and enables valid destinations after answering or review', () => {
    const state = practiceState();
    const navigation = () => load(renderTutorExercises(state))('.tutor-exercise-navigation');
    let nav = navigation();
    expect(nav.find('.tutor-exercise-position[aria-live="polite"]').text()).toBe('1 / 2');
    expect(nav.find('button')).toHaveLength(2);
    expect(nav.find('button[disabled][aria-disabled="true"]')).toHaveLength(2);

    state.reviews.first = review('first', 'I went.', true);
    nav = navigation();
    expect(nav.find('[data-command="showPreviousTutorExercise"][disabled]')).toHaveLength(1);
    expect(nav.find('[data-command="showNextTutorExercise"]:not([disabled])')).toHaveLength(1);

    state.currentExerciseIndex = 1;
    nav = navigation();
    // Changed 2026-10-04: Back can return to skipped reviews before answering this item.
    expect(nav.find('button[disabled]')).toHaveLength(1);
    state.reviews.second = review('second', 'I stayed.', false);
    nav = navigation();
    expect(nav.find('[data-command="showPreviousTutorExercise"]:not([disabled])')).toHaveLength(1);
    expect(nav.find('[data-command="showNextTutorExercise"]:not([disabled])')).toHaveLength(1);
  });

  const answerCases: Array<{ name: string; result: TrainingReview; answer: string; correctionRows: number }> = [
    { name: 'one wrong part with corrected text', result: review('first', 'I went.', true), answer: 'I went.', correctionRows: 1 },
    { name: 'corrected text without feedback', result: {
      schemaVersion: 1, exerciseId: 'first', learnerText: 'I goed.', correctedText: 'I went.', correct: [], incorrect: []
    }, answer: 'I went.', correctionRows: 1 },
    { name: 'two partial correct excerpts', result: {
      schemaVersion: 1, exerciseId: 'first', learnerText: 'I went home.',
      correct: [{ excerpt: 'I', reason: 'The subject is correct.' }, { excerpt: 'went home.', reason: 'The action is correct.' }],
      incorrect: []
    }, answer: 'I went home.', correctionRows: 1 },
    { name: 'three wrong parts with one corrected sentence', result: {
      schemaVersion: 1, exerciseId: 'first', learnerText: 'I definately recieved mails.',
      correctedText: 'I definitely received mail.', correct: [],
      incorrect: [
        { excerpt: 'definately', reason: 'Spelling.', corrected: 'definitely', status: 'rule' },
        { excerpt: 'recieved', reason: 'Spelling.', corrected: 'received', status: 'rule' },
        { excerpt: 'mails', reason: 'Uncountable noun.', corrected: 'mail', status: 'rule' }
      ]
    }, answer: 'I definitely received mail.', correctionRows: 1 },
    { name: 'one whole correct excerpt with surrounding whitespace', result: {
      schemaVersion: 1, exerciseId: 'first', learnerText: 'I went.',
      correct: [{ excerpt: ' I went. ', reason: 'The form is correct.' }], incorrect: []
    }, answer: 'I went.', correctionRows: 0 },
    { name: 'already correct without corrected text or feedback', result: {
      schemaVersion: 1, exerciseId: 'first', learnerText: 'I went.', correct: [], incorrect: []
    }, answer: 'I went.', correctionRows: 1 }
  ];

  it.each(answerCases)('names REVIEW and shows the answer once for $name', ({ result, answer, correctionRows }) => {
    // Changed 2026-10-14: V236, owner item 1.9, the placement fixture supplies a task while retaining every answer-count assertion.
    const state = practiceState();
    state.exerciseSet!.exercises[0]!.taskLine = 'Write a sentence about a past action.';
    state.reviews.first = result;
    const $ = load(renderTutorExercises(state));
    const panel = $('[aria-label="Review of exercise 1"]');
    expect(panel.find('h4.tutor-section-badge').text()).toBe('REVIEW');
    expect(panel.find('.tutor-question-answer')).toHaveLength(0);
    expect(panel.text().split(answer).length - 1).toBe(1);
    expect(panel.find('.tutor-review-correction')).toHaveLength(correctionRows);
    // Changed 2026-10-04: V202 keeps one explanation outside and before the review.
    expect(panel.find('.tutor-question-explanation')).toHaveLength(0);
    expect(panel.prev().is('.tutor-question-explanation')).toBe(true);
  });

  it('keeps legacy correction reasons and shows the reviewed answer once without correctedText', () => {
    // Changed 2026-10-14: V236, owner item 1.8, the review ends on the reconstructed correction rather than the learner's wrong sentence.
    const state = practiceState();
    state.reviews.first = {
      schemaVersion: 1, exerciseId: 'first', learnerText: 'I goed.',
      correct: [],
      incorrect: [{ excerpt: 'goed', reason: 'Use the past form.', corrected: 'went', status: 'rule' }]
    };
    const $ = load(renderTutorExercises(state));
    const panel = $('[aria-label="Review of exercise 1"]');
    expect(panel.find('.tutor-review-mark.incorrect').text()).toContain('Use the past form.');
    expect(panel.find('.tutor-review-correction').map((_index, element) => $(element).text()).get())
      .toEqual(['I went.']);
    expect(panel.text().split('I went.')).toHaveLength(2);
    expect(panel.find('span.tutor-review-corrected').text()).toBe('went');
  });
});
