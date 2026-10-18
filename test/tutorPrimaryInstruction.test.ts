import { describe, expect, it } from 'vitest';
import { tutorLessonGenerationRequest } from '../src/tutor/generation.js';
import { createTutorViewState, tutorRecipeFromState } from '../src/tutor/state.js';
import {
  TUTOR_LESSON_CODES, TUTOR_MAP, validateTutorLesson, type TutorLesson, type TutorRecipe
} from '@kren/core/tutor';

const primaries = [
  'mechanics.time-reality.tense-aspect.present-past-future-reference',
  'mechanics.time-reality.tense-aspect.simple-progressive-perfect-perfect-progressive',
  'mechanics.time-reality.tense-aspect.time-markers-event-sequence'
];

function recipeFor(ids: string[] = primaries): TutorRecipe {
  const state = createTutorViewState();
  if (ids.length === 0) {
    state.settings.questionOnly = true;
    state.question = 'How do time expressions shape a sentence?';
  }
  state.selection = ids.map((nodeId) => ({ nodeId, role: 'primary' }));
  return tutorRecipeFromState(state);
}

function targetInstruction(recipe: TutorRecipe): string {
  return tutorLessonGenerationRequest(recipe).instruction.split('\n\n')[1]!;
}

function lessonFor(recipe: TutorRecipe, targetIds: string[]): TutorLesson {
  const node = TUTOR_MAP.find((candidate) => candidate.id === primaries[0])!;
  const sentences = [
    'By yesterday evening, our team had already finished the report for the next meeting.',
    'While she was reviewing the draft yesterday, her colleague was checking the final figures.',
    'By tomorrow evening, we will have completed the first stage of our research project.',
    'Since Monday, the researchers have been comparing the results from their two latest experiments.',
    'After the visitors had left yesterday, we carefully checked every room in the building.',
    'At this time tomorrow, our team will be presenting the findings to the committee.'
  ];
  return {
    schemaVersion: 1, mapVersion: recipe.mapVersion, lessonTitle: 'Time, aspect, and sequence',
    level: 'B2', primaryTarget: { ...node, nodeId: node.id, role: 'primary' },
    supportingTargets: [], conceptExplanation: 'Connect verb forms with time and sequence.',
    patternStatement: 'A time expression fixes when the event happens, and aspect shows its progress.',
    interactionExplanation: 'Time expressions locate the event and aspect presents its progress.',
    rules: [{ statement: 'Use the past perfect for an event before a past reference point.', status: 'rule' }],
    examples: sentences.map((sentence, index) => ({
      id: `example-${index + 1}`, sentence, targetIds: [...targetIds],
      annotations: targetIds.map((targetId) => ({
        targetId, excerpt: sentence,
        explanation: 'The verb form and time expression together locate the event and its progress.'
      }))
    })),
    commonErrors: [], answerKey: [], generationNotes: []
  };
}

describe('V75 Primary instruction and the installed validator', () => {
  it.each([2, 3])('names each of %i exact Primaries once in the list and requires all in every example', (count) => {
    const ids = primaries.slice(0, count);
    expect(targetInstruction(recipeFor(ids))).toBe(
      `The Primary targets are exactly: ${ids.map((id) => `"${id}"`).join(', ')}. ` +
      `Teach all of these targets together. Set the returned primary target's nodeId to ` +
      `"${ids[0]}", the first Primary, and omit chosenUnder entirely. ` +
      `Every example's targetIds must include every Primary identifier listed above.`
    );
  });

  it.each(['skill', 'microTarget'] as const)('keeps the single %s instruction unchanged', (kind) => {
    const id = TUTOR_MAP.find((node) => node.kind === kind)!.id;
    expect(targetInstruction(recipeFor([id]))).toBe(
      `The primary target is exactly "${id}". Teach that target, ` +
      `set the returned primary target's nodeId to "${id}", omit ` +
      `chosenUnder entirely, and make every example's targetIds include "${id}".`
    );
  });

  it.each(['hub', 'cluster'] as const)('keeps the lone %s Explore instruction unchanged', (kind) => {
    const id = TUTOR_MAP.find((node) => node.kind === kind)!.id;
    const children = TUTOR_MAP.filter((node) => node.parentId === id).map((node) => `"${node.id}"`);
    expect(targetInstruction(recipeFor([id]))).toBe(
      `The primary target "${id}" is a ${kind}, so choose exactly ` +
      `one child beneath it and teach that child. Choose from exactly these identifiers: ` +
      `${children.join(', ')}. Set the returned primary target's nodeId to the one you chose, ` +
      `set its chosenUnder to "${id}", and make every example's targetIds ` +
      `include the identifier you chose rather than "${id}".`
    );
  });

  it.each([false, true])('keeps question-only wording unchanged with Supports: %s', (withSupports) => {
    const recipe = recipeFor([]);
    recipe.supportingTargets = withSupports ? [primaries[0]!] : [];
    expect(targetInstruction(recipe)).toBe(withSupports
      ? 'The question below is the subject of this lesson, and no learning-map target ' +
        'is Primary. Name the question\'s subject yourself in the returned primary target: ' +
        'set its nodeId to a short lower-case identifier you invent for the subject, set ' +
        'its label to the subject in plain English, omit chosenUnder, and make the targetIds ' +
        'of every example include that same nodeId as the taught target. The ' +
        'learning-map identifiers named below remain Supports only.'
      : 'No learning-map target was chosen. The subject of this lesson is the question ' +
        'below. Name that subject yourself in the returned primary target: set its nodeId to ' +
        'a short lower-case identifier you invent for the subject, set its label to the ' +
        'subject in plain English, omit chosenUnder, and make the targetIds of every example ' +
        'contain exactly that same nodeId.');
  });

  it('validates six examples carrying the exact identifiers named by the instruction', () => {
    const recipe = recipeFor();
    // Read the actual instruction, not the recipe: the old instruction names only one.
    const named = [...new Set(Array.from(targetInstruction(recipe).matchAll(/"([^"]+)"/gu),
      (match) => match[1]!))];
    const findings = validateTutorLesson(lessonFor(recipe, named), recipe);
    const missing = findings.filter((finding) => finding.code === TUTOR_LESSON_CODES.primaryTargetMissing);
    expect(missing, `${missing.length} primaryTargetMissing findings`).toHaveLength(0);
    expect(findings).toEqual([]);
  });

  it('accepts all three and reports exactly twelve missing-target findings for first-only examples', () => {
    const recipe = recipeFor();
    expect(validateTutorLesson(lessonFor(recipe, primaries), recipe)).toEqual([]);
    expect(validateTutorLesson(lessonFor(recipe, primaries.slice(0, 1)), recipe)).toEqual(
      Array.from({ length: 6 }, (_, index) => primaries.slice(1).map((targetId) => ({
        code: TUTOR_LESSON_CODES.primaryTargetMissing, severity: 'error',
        subjects: [`example-${index + 1}`, targetId]
      }))).flat()
    );
  });
});
