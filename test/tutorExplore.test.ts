import { describe, expect, it } from 'vitest';
import { tutorLessonGenerationRequest } from '../src/tutor/generation.js';
import { createTutorViewState, tutorRecipeFromState } from '../src/tutor/state.js';
import {
  TUTOR_LESSON_CODES,
  TUTOR_MAP,
  validateTutorLesson,
  type ResolvedTrainingTarget,
  type TutorLesson,
  type TutorRecipe
} from '@kren/core/tutor';

/*
 * Explore, blueprint section 2.1: selecting a Hub or a Cluster means KREN chooses an
 * eligible child beneath it and teaches that child, naming the child it chose.
 *
 * The load-bearing test here is the first one. It does not check that the schema has a
 * field or that the instruction contains a word; it builds the response an obedient model
 * would return under this instruction and runs it through the validator core actually uses.
 * A schema and an instruction can each look right and still produce a lesson core rejects,
 * which is the state this feature was in before: selection accepted a Hub and nothing
 * downstream knew what to do with it.
 */

const hub = TUTOR_MAP.find((node) => node.kind === 'hub')!;
const childOfHub = TUTOR_MAP.find((node) =>
  node.parentId === hub.id && TUTOR_MAP.some((leaf) => leaf.parentId === node.id) === false
) ?? TUTOR_MAP.find((node) => node.parentId === hub.id)!;
const otherHub = TUTOR_MAP.find((node) => node.kind === 'hub' && node.id !== hub.id)!;
const outsider = TUTOR_MAP.find((node) => node.parentId === otherHub.id)!;

function exploreRecipe(): TutorRecipe {
  const state = createTutorViewState();
  state.selection = [{ nodeId: hub.id, role: 'primary' }];
  return tutorRecipeFromState(state);
}

function resolved(overrides: Partial<ResolvedTrainingTarget> = {}): ResolvedTrainingTarget {
  return {
    nodeId: childOfHub.id,
    label: childOfHub.label,
    kind: childOfHub.kind,
    role: 'primary',
    description: childOfHub.description,
    chosenUnder: hub.id,
    ...overrides
  };
}

/*
 * A response of exactly the shape the instruction asks for. The sentence and its annotation
 * excerpt have to agree, and the word count has to sit inside the recipe's band, or the
 * findings that come back are about those rather than about Explore.
 */
function exploreLesson(
  recipeUsed: TutorRecipe,
  primaryTarget: ResolvedTrainingTarget = resolved(),
  exampleTargetIds: string[] = [childOfHub.id]
): TutorLesson {
  // Fifteen words, inside the default sentence band, and carrying the annotation excerpt
  // verbatim. A sentence outside the band returns word-count findings that have nothing
  // to do with Explore and hide the ones that do.
  const sentence =
    'We have made steady progress on the quarterly report during this week of careful work.';
  return {
    schemaVersion: 1,
    mapVersion: recipeUsed.mapVersion,
    lessonTitle: 'A chosen skill beneath the hub',
    level: 'B1',
    primaryTarget,
    supportingTargets: [],
    conceptExplanation: 'What the chosen target does and when it applies.',
    patternStatement: 'Every example shows the chosen target in one steady pattern.',
    interactionExplanation: 'How the chosen target shapes each example.',
    rules: [{
      statement: 'Use the form that connects the event to now.',
      status: 'rule',
      targetId: primaryTarget.nodeId
    }],
    examples: Array.from(
      { length: recipeUsed.output.exampleCount },
      (_value, index): TutorLesson['examples'][number] => ({
        id: `example-${index + 1}`,
        sentence,
        targetIds: exampleTargetIds,
        annotations: [{
          targetId: primaryTarget.nodeId,
          /*
           * Varied per example because core 0.26.0 refuses a lesson whose examples annotate
           * one phrase more than twice. Every phrase here occurs verbatim in the sentence
           * above, which the annotation-excerpt check requires, and the sentence itself is
           * unchanged so the word bands still hold.
           */
          excerpt: ['have made', 'steady progress', 'the quarterly report',
            'this week', 'careful work', 'on the'][index % 6]!,
          explanation: 'The completed work matters now.'
        }]
      })
    ),
    commonErrors: [],
    generationNotes: []
  } as unknown as TutorLesson;
}

describe('Explore, when the reader selects a Hub', () => {
  it('produces a lesson core validates, from a response shaped by this instruction', () => {
    const recipeUsed = exploreRecipe();

    expect(validateTutorLesson(exploreLesson(recipeUsed), recipeUsed)).toEqual([]);
  });

  it('is rejected when the examples name the parent rather than the chosen child', () => {
    const recipeUsed = exploreRecipe();
    const candidate = exploreLesson(recipeUsed, resolved(), [hub.id]);

    expect(validateTutorLesson(candidate, recipeUsed)).toContainEqual(
      expect.objectContaining({ code: TUTOR_LESSON_CODES.primaryTargetMissing })
    );
  });

  it('is rejected when no choice was made', () => {
    const recipeUsed = exploreRecipe();
    const candidate = exploreLesson(recipeUsed, resolved({ chosenUnder: undefined }));

    expect(validateTutorLesson(candidate, recipeUsed)).toContainEqual(
      expect.objectContaining({ code: TUTOR_LESSON_CODES.exploreChoiceMissing })
    );
  });

  it('is rejected when the chosen child sits under a different parent', () => {
    const recipeUsed = exploreRecipe();
    const candidate = exploreLesson(
      recipeUsed,
      resolved({ nodeId: outsider.id, label: outsider.label, kind: outsider.kind }),
      [outsider.id]
    );

    expect(validateTutorLesson(candidate, recipeUsed)).toContainEqual(
      expect.objectContaining({ code: TUTOR_LESSON_CODES.exploreChoiceOutsideParent })
    );
  });

  /*
   * Rewritten 2026-09-01. This asserted a general rule that named both branches and left the
   * model to work out which applied. It cannot: the recipe carries an identifier and nothing
   * that says whether it names a Hub or a Skill. That guess produced the owner's third
   * failure, so the instruction now states only the branch KREN determined from the map.
   *
   * What is asserted here is the same requirement in its new form: an Explore request has to
   * say to choose, say what to record the choice under, and say that the examples name the
   * chosen child. A model given only the first satisfies it and fails validation on the rest.
   */
  it('states all three parts of the Explore rule, for the branch that applies', () => {
    const request = tutorLessonGenerationRequest(exploreRecipe());
    const instruction = request.instruction;

    expect(JSON.stringify(request.schema), 'the response has somewhere to record the choice')
      .toContain('chosenUnder');
    expect(instruction).toContain('choose exactly one child beneath it');
    expect(instruction, 'the identifier the choice is recorded under')
      .toContain(`chosenUnder to "${hub.id}"`);
    expect(instruction, 'without this a model satisfies the first part and fails validation')
      .toContain('include the identifier you chose');
    expect(instruction, 'the Exact branch must not be offered alongside it')
      .not.toContain('omit chosenUnder entirely');
  });
});

describe('Exact, when the reader selects a Skill or a Micro-target', () => {
  it('validates exactly as it did before Explore existed', () => {
    const state = createTutorViewState();
    const exact = TUTOR_MAP.find((node) =>
      !TUTOR_MAP.some((candidate) => candidate.parentId === node.id)
    )!;
    state.selection = [{ nodeId: exact.id, role: 'primary' }];
    const recipeUsed = tutorRecipeFromState(state);
    const lesson = exploreLesson(
      recipeUsed,
      resolved({
        nodeId: exact.id, label: exact.label, kind: exact.kind, chosenUnder: undefined
      }),
      [exact.id]
    );

    expect(validateTutorLesson(lesson, recipeUsed)).toEqual([]);
  });
});
