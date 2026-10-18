import { describe, expect, it } from 'vitest';
import { createTutorViewState, tutorRecipeFromState } from '../src/tutor/state.js';
import {
  TUTOR_MAP,
  validateTutorExerciseSet,
  validateTutorLesson
} from '@kren/core/tutor';
import type {
  TutorExerciseRequest,
  TutorExerciseSet,
  TutorLesson
} from '@kren/core/tutor';

/*
 * Can KREN's own prompt be answered?
 *
 * The owner could not generate a lesson or an exercise set for three rounds, and each round
 * left one question unanswerable from the tests: whether the prompt was askable at all, or
 * whether KREN was demanding something its own validator would refuse however well a model
 * behaved. Nothing in the suite covered the whole contract, because every other test either
 * builds a reply by hand and checks the validator, or builds a request and checks the words.
 *
 * These two do both ends at once. Each reply below was written by reading the exact prompt
 * KREN sends and obeying it, as an obedient responder would, and is then put through the same
 * validator a real reply faces. They cost no request and they are the only thing here that
 * fails when the prompt and the validator disagree with each other.
 *
 * They are deliberately strict. Every constraint in the recipe is honoured: six examples,
 * eleven to eighteen words at zero tolerance, an annotation excerpt occurring verbatim, the
 * primary target named in every example, and no chosenUnder because the target is exact.
 * If a future change makes any of that impossible to satisfy, this fails rather than the
 * owner discovering it against a live key.
 */


const TARGET = 'mechanics.time-reality.tense-aspect.present-past-future-reference';

describe('a lesson written by hand against KREN own prompt', () => {
  it('passes the validator a real reply would face', () => {
    const state = createTutorViewState();
    state.selection = [{ nodeId: TARGET, role: 'primary' }];
    const recipe = tutorRecipeFromState(state);
    const node = TUTOR_MAP.find((candidate) => candidate.id === TARGET)!;

    const sentences: Array<[string, string]> = [
      ['The team met yesterday, works together today, and will report the findings tomorrow morning.',
        'met yesterday'],
      ['Our supervisor reviews the drafts every Monday and returns them with comments before the deadline.',
        'reviews the drafts'],
      ['Last spring the laboratory ordered new equipment, and the shipment arrived three weeks later.',
        'ordered new equipment'],
      ['Next quarter the department will publish the results that the committee approved this month.',
        'will publish'],
      ['She writes her notes each evening, wrote them by hand last year, and will type them soon.',
        'wrote them by hand'],
      ['The train leaves at six tomorrow, so we finished the packing earlier this evening.',
        'leaves at six tomorrow']
    ];

    const lesson = {
      schemaVersion: 1,
      mapVersion: recipe.mapVersion,
      lessonTitle: 'Placing events before, around, and after now',
      level: 'B2',
      primaryTarget: {
        nodeId: TARGET,
        label: node.label,
        kind: node.kind,
        role: 'primary',
        description: node.description
      },
      supportingTargets: [],
      conceptExplanation:
        'English places a situation in time with the verb form and with time expressions together. ' +
        'The verb carries the grammatical signal and the expression fixes the point being referred to.',
      patternStatement:
        'A finished past action takes the past simple when its time is already fixed.',
      interactionExplanation:
        'Each example below moves one situation relative to the moment of speaking, so the same ' +
        'sentence pattern is read against a different point in time.',
      rules: [
        { statement: 'A past reference pairs a past form with a past time expression.', status: 'rule' },
        { statement: 'Future reference is commonly carried by will plus the base form.', status: 'strongTendency' },
        { statement: 'A present form can carry a scheduled future when a time expression fixes it.', status: 'stylePreference' }
      ],
      examples: sentences.map(([sentence, excerpt], index) => ({
        id: `example-${index + 1}`,
        sentence,
        targetIds: [TARGET],
        annotations: [{
          targetId: TARGET,
          excerpt,
          explanation: 'The verb form and the time expression agree on when this happens.'
        }]
      })),
      commonErrors: [
        {
          id: 'error-1',
          incorrect: 'Yesterday I go to the office and finish the report.',
          corrected: 'Yesterday I went to the office and finished the report.',
          explanation: 'A past time expression requires past verb forms.',
          status: 'rule'
        },
        {
          id: 'error-2',
          incorrect: 'I will call you when I will arrive.',
          corrected: 'I will call you when I arrive.',
          explanation: 'A time clause takes a present form even for future reference.',
          status: 'rule'
        }
      ],
      generationNotes: []
    } as unknown as TutorLesson;

    const findings = validateTutorLesson(lesson, recipe);
    if (findings.length > 0) {
      console.log('FINDINGS:', findings.map((finding) => finding.code).join(' | '));
      console.log(JSON.stringify(findings, null, 1));
    } else {
      console.log('ACCEPTED with zero findings.');
    }
    expect(findings).toEqual([]);
  });
});

describe('an exercise set written by hand against KREN own prompt', () => {
  /*
   * Swept over the settings, not checked at one point.
   *
   * This file was written after three rounds of KREN demanding something its own validator
   * would refuse. It fixed the idea and not the coverage: it called `createTutorViewState()`
   * and never varied it, so it evaluated the contract at a single point in a settings space
   * with several dimensions. Every bug it was meant to catch has since lived somewhere else
   * in that space. `includeAnswerKey` is false by default, so an answer-key rule rejecting
   * every practice set went unseen until the reader turned the setting on.
   *
   * A reply built from the request's own schema must be acceptable under every combination
   * of the settings that change what the validator demands.
   */
  it.each([false, true].flatMap((includeAnswerKey) =>
    [false, true].flatMap((includePractice) =>
      [false, true].map((includeCommonErrors) =>
        ({ includeAnswerKey, includePractice, includeCommonErrors })))))(
    'passes the validator a real reply would face with $includeAnswerKey $includePractice $includeCommonErrors',
    ({ includeAnswerKey, includePractice, includeCommonErrors }) => {
    const state = createTutorViewState();
    state.selection = [{ nodeId: TARGET, role: 'primary' }];
    // Changed 2026-09-26: legacy practice flags are ignored by the lesson recipe.
    Object.assign(state.settings, { includeAnswerKey, includePractice });
    state.settings.includeCommonErrors = includeCommonErrors;
    const recipe = tutorRecipeFromState(state);
    expect(recipe.output.includePractice).toBe(false);
    expect(recipe.output.includeAnswerKey).toBe(false);
    const request: TutorExerciseRequest = {
      schemaVersion: 1, recipe, count: 5, channel: 'written'
    };

    const prompts = [
      'Rewrite this sentence so it refers to last week: The committee reviews the budget.',
      'Complete the sentence with a future reference: Next month the team ( ) the results.',
      'Choose the correct form: Yesterday she ( writes | wrote ) the summary before lunch.',
      'Correct the error: I will send the file when I will finish the edits.',
      'Write one sentence placing the same event yesterday, today, and tomorrow.'
    ];

    const set = {
      schemaVersion: 1,
      mapVersion: recipe.mapVersion,
      channel: 'written',
      exercises: prompts.map((prompt, index) => ({
        id: `exercise-${index + 1}`,
        channel: 'written',
        prompt,
        targetIds: [TARGET]
      }))
    } as unknown as TutorExerciseSet;

    const findings = validateTutorExerciseSet(set, request);
    if (findings.length > 0) {
      console.log('FINDINGS:', findings.map((finding) => finding.code).join(' | '));
    } else {
      console.log('ACCEPTED with zero findings.');
    }
    expect(findings).toEqual([]);
  });
});
