import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import {
  TRAINING_REVIEW_CORRECTION_CATEGORIES,
  TUTOR_MAP,
  type TrainingReview
} from '@kren/core/tutor';
import { renderTutorExercises } from '../src/resultViewHtml.js';
import { tutorReviewGenerationRequest, TUTOR_REVIEW_SCHEMA } from '../src/tutor/generation.js';
import { createTutorViewState, type TutorViewState } from '../src/tutor/state.js';

const target = TUTOR_MAP.find((node) => node.kind === 'microTarget')!;

function practiceState(review: TrainingReview): TutorViewState {
  const state = createTutorViewState();
  state.exerciseSet = {
    schemaVersion: 1,
    mapVersion: '1.0.0',
    channel: 'written',
    exercises: [{
      id: 'exercise-1',
      channel: 'written',
      prompt: 'Write one sentence about yesterday.',
      targetIds: [target.id]
    }]
  };
  state.answers = { 'exercise-1': review.learnerText };
  state.reviews = { 'exercise-1': review };
  state.practiceReviewAll = true;
  return state;
}

function requestInstruction(): string {
  return tutorReviewGenerationRequest({
    learnerAnswer: 'I recieved mail yesterday.',
    exercise: {
      id: 'exercise-1',
      channel: 'written',
      prompt: 'Write one sentence about yesterday.',
      targetIds: [target.id]
    },
    activeTargets: [target.id]
  }).instruction;
}

function namedFieldList(instruction: string, owner: 'review' | 'incorrect item'): string[] {
  const match = instruction.match(new RegExp(`The ${owner} fields are exactly: ([^.]+)\\.`));
  expect(match, `${owner} field list`).toBeTruthy();
  return match![1]!.split(', ');
}

describe('V99 corrected practice reviews', () => {
  it('R1 shows the whole corrected sentence and marks every reliably located correction', () => {
    const review: TrainingReview = {
      schemaVersion: 1,
      exerciseId: 'exercise-1',
      learnerText: 'I definately recieved mails yesterday.',
      correctedText: 'I definitely received mail yesterday.',
      correct: [],
      incorrect: [
        { excerpt: 'definately', reason: 'This word is misspelled.', corrected: 'definitely', status: 'rule', category: 'spelling' },
        { excerpt: 'mails', reason: 'Mail is uncountable here.', corrected: 'mail', status: 'strongTendency', category: 'wording' },
        { excerpt: 'recieved', reason: 'The letters are reversed.', corrected: 'received', status: 'rule', category: 'spelling' }
      ]
    };
    const $ = load(renderTutorExercises(practiceState(review)));
    const correction = $('.tutor-review-correction').first();
    expect(correction.text()).toContain('I definitely received mail yesterday.');
    expect(correction.find('.tutor-review-corrected').map((_index, element) => $(element).text()).get())
      .toEqual(['definitely', 'received', 'mail']);
    expect(correction.html()).toContain('I <strong class="tutor-review-corrected">definitely</strong>');
    expect(correction.html()).toContain('</strong> yesterday.');
  });

  it('R1 renders the complete sentence plainly when a corrected span is ambiguous', () => {
    const review: TrainingReview = {
      schemaVersion: 1,
      exerciseId: 'exercise-1',
      learnerText: 'A werd follows another werd.',
      correctedText: 'A word follows another word.',
      correct: [],
      incorrect: [
        { excerpt: 'werd', reason: 'This word is misspelled.', corrected: 'word', status: 'rule', category: 'spelling' }
      ]
    };
    const $ = load(renderTutorExercises(practiceState(review)));
    expect($('.tutor-review-correction').text()).toContain(review.correctedText);
    expect($('.tutor-review-correction .tutor-review-corrected')).toHaveLength(0);
  });

  it('R2 shows the answer once in a correction row, with the explanation before the review', () => {
    // Changed 2026-10-14: V236, owner item 1.9, a supplied task line preserves the explanation placement check.
    const review: TrainingReview = {
      schemaVersion: 1,
      exerciseId: 'exercise-1',
      learnerText: 'I recieved mail yesterday.',
      correctedText: 'I received mail yesterday.',
      correct: [],
      incorrect: [
        { excerpt: 'recieved', reason: 'This word is misspelled.', corrected: 'received', status: 'rule', category: 'spelling' }
      ]
    };
    const state = practiceState(review);
    state.exerciseSet!.exercises[0]!.taskLine = 'Write a sentence about yesterday.';
    const $ = load(renderTutorExercises(state));
    const explanation = $('.tutor-question-explanation');
    expect(explanation).toHaveLength(1);
    // Changed 2026-09-30: the answer uses the correction row and is shown once.
    expect($('.tutor-question-answer')).toHaveLength(0);
    expect($('.tutor-review-correction')).toHaveLength(1);
    expect($('.tutor-review-correction').text()).toBe('I received mail yesterday.');
    // Changed 2026-10-04: V202 renders the explanation before the review, not after its correction row.
    expect($('.tutor-review-correction').next()).toHaveLength(0);
    expect(explanation.next().is('[aria-label^="Review of exercise"]')).toBe(true);
  });

  it('R3 groups every spelling mistake once and leaves other categories separate', () => {
    const review: TrainingReview = {
      schemaVersion: 1,
      exerciseId: 'exercise-1',
      learnerText: 'I definately recieved mails yesterday.',
      correctedText: 'I definitely received mail yesterday.',
      correct: [],
      incorrect: [
        { excerpt: 'definately', reason: 'This word is misspelled.', corrected: 'definitely', status: 'rule', category: 'spelling' },
        { excerpt: 'mails', reason: 'Mail is uncountable here.', corrected: 'mail', status: 'strongTendency', category: 'wording' },
        { excerpt: 'recieved', reason: 'The letters are reversed.', corrected: 'received', status: 'rule', category: 'spelling' }
      ]
    };
    const $ = load(renderTutorExercises(practiceState(review)));
    const wrong = $('.tutor-review-mark.incorrect');
    expect(wrong).toHaveLength(2);
    expect(wrong.eq(0).find('.tutor-review-wrong').map((_index, element) => $(element).text()).get())
      .toEqual(['definately', 'recieved']);
    expect(wrong.eq(1).find('.tutor-review-wrong').map((_index, element) => $(element).text()).get())
      .toEqual(['mails']);
    // Changed 2026-09-30: one whole corrected sentence follows all wrong-part reasons.
    expect($('.tutor-review-correction')).toHaveLength(1);
  });

  it('R3 keeps one spelling mistake in the existing single-entry shape', () => {
    const review: TrainingReview = {
      schemaVersion: 1,
      exerciseId: 'exercise-1',
      learnerText: 'I recieved mail yesterday.',
      correctedText: 'I received mail yesterday.',
      correct: [],
      incorrect: [
        { excerpt: 'recieved', reason: 'This word is misspelled.', corrected: 'received', status: 'rule', category: 'spelling' }
      ]
    };
    const $ = load(renderTutorExercises(practiceState(review)));
    expect($('.tutor-review-mark.incorrect')).toHaveLength(1);
    expect($('.tutor-review-mark.incorrect .tutor-review-wrong')).toHaveLength(1);
    // Changed 2026-09-30: the verdict and excerpt are separate, with the reason retained.
    expect($('.tutor-review-mark.incorrect strong').text()).toBe('Not quite.');
    expect($('.tutor-review-mark.incorrect .tutor-review-wrong').text()).toBe('recieved');
    expect($('.tutor-review-mark.incorrect').text()).toContain('This word is misspelled.');
    expect($('.tutor-review-mark.incorrect').find('ul, ol, li')).toHaveLength(0);
    expect($('.tutor-review-correction')).toHaveLength(1);
  });

  it('R4 names correctedText in the exact review field list and defines it', () => {
    const instruction = requestInstruction();
    // Changed 2026-10-15: V243, owner item I16, the instruction names the schema fields including KREN's optional focus phrase.
    expect(namedFieldList(instruction, 'review').sort()).toEqual(Object.keys(TUTOR_REVIEW_SCHEMA.properties as object).sort());
    expect(instruction).toContain(
      'correctedText is the learner\'s sentence with every correction applied.'
    );
  });

  it('R4 names category in the exact correction field list and gives its closed set', () => {
    const instruction = requestInstruction();
    expect(namedFieldList(instruction, 'incorrect item')).toEqual([
      'excerpt', 'reason', 'corrected', 'status', 'category'
    ]);
    expect(TRAINING_REVIEW_CORRECTION_CATEGORIES).toEqual([
      'grammar', 'spelling', 'punctuation', 'wording'
    ]);
    expect(instruction).toContain(
      'category is exactly one of grammar, spelling, punctuation, wording.'
    );
  });

  it('R6 retains each legacy correction with neither optional field', () => {
    // Changed 2026-10-14: V236, owner item 1.8, corrections form one highlighted corrected sentence instead of ending on the wrong answer.
    const review: TrainingReview = {
      schemaVersion: 1,
      exerciseId: 'exercise-1',
      learnerText: 'My answer are one setence.',
      correct: [],
      incorrect: [
        { excerpt: 'are', reason: 'Use singular agreement.', corrected: 'is', status: 'rule' },
        { excerpt: 'setence', reason: 'This word is misspelled.', corrected: 'sentence', status: 'strongTendency' }
      ]
    };
    const $ = load(renderTutorExercises(practiceState(review)));
    expect($('.tutor-review-mark.incorrect')).toHaveLength(2);
    // Changed 2026-09-30: legacy corrections keep their text without a prefix or status.
    expect($('.tutor-review-correction').map((_index, element) => $(element).text()).get())
      .toEqual(['My answer is one sentence.']);
    expect($('.tutor-review-correction span.tutor-review-corrected').map((_index, element) => $(element).text()).get())
      .toEqual(['is', 'sentence']);
    expect($('.tutor-question-answer')).toHaveLength(0);
  });
});
