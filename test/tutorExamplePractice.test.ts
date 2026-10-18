import { describe, expect, it } from 'vitest';
import { TUTOR_MAP } from '@kren/core/tutor';
import {
  tutorExerciseGenerationRequest, tutorPracticeHintRequest, validateTutorExamplePracticeSet,
  type TutorExamplePracticeRequest, type TutorExamplePracticeSet
} from '../src/tutor/generation.js';
import { createTutorViewState, tutorRecipeFromState, tutorFindingMessage } from '../src/tutor/state.js';

function request(questionOnly = false): TutorExamplePracticeRequest {
  const state = createTutorViewState();
  state.settings.questionOnly = questionOnly;
  state.question = questionOnly ? 'How do polite requests work?' : '';
  state.selection = questionOnly ? [] : [{ nodeId: TUTOR_MAP.find((node) => node.kind === 'microTarget')!.id, role: 'primary' }];
  return {
    schemaVersion: 1, recipe: tutorRecipeFromState(state), count: 1, channel: 'written',
    examples: [
      { sentence: 'Could you please close the window before leaving?', targetIds: state.selection.map((target) => target.nodeId), annotations: [] },
      { sentence: 'Would you kindly bring a chair for our guest?', targetIds: [], annotations: [] }
    ]
  };
}

function set(input: TutorExamplePracticeRequest): TutorExamplePracticeSet {
  return {
    schemaVersion: 1, mapVersion: input.recipe.mapVersion, channel: 'written',
    exercises: [{ id: 'request', channel: 'written', prompt: 'Politely ask a colleague to send a report.',
      targetIds: input.examples[0]!.targetIds, exampleIndex: 0, expectedAnswer: 'Could you send me the report?' }]
  };
}

describe('V206 practice built on lesson examples', () => {
  it.each([false, true])('carries only the example sentence, target identifiers, and annotations, question-only %s', (questionOnly) => {
    const input = request(questionOnly);
    input.examples[0]!.annotations = [{ targetId: input.examples[0]!.targetIds[0] ?? '', excerpt: 'Could you', explanation: 'A polite request.' }];
    expect(JSON.parse(tutorExerciseGenerationRequest(input).input)).toEqual(input);
    expect(validateTutorExamplePracticeSet(set(input), input)).toEqual([]);
  });

  it('instructs transfer, new words, the index convention, and checking the expected answer', () => {
    const built = tutorExerciseGenerationRequest(request(true));
    expect(built.instruction).toMatch(/Every exercise must practice a pattern shown in one supplied lesson example/);
    expect(built.instruction).toContain('in a new context with different words');
    expect(built.instruction).toContain('A learner who studied that example must be able to answer by applying its pattern');
    expect(built.instruction).toContain('Never repeat an example word by word');
    expect(built.instruction).toContain('zero-based index');
    expect(built.instruction).toContain('expectedAnswer');
    expect(built.instruction).toContain('five or more consecutive words');
    expect(built.instruction).toContain('Every exercise must practice that question and nothing else');
    expect(built.instruction).toContain('no multiple choice');
    const schema = built.schema as any;
    expect(schema.properties.exercises.items.required).toEqual(expect.arrayContaining(['exampleIndex', 'expectedAnswer']));
  });

  it.each([0, 1])('accepts valid zero-based index %s', (index) => {
    const input = request();
    const response = set(input);
    response.exercises[0]!.exampleIndex = index;
    expect(validateTutorExamplePracticeSet(response, input)).toEqual([]);
  });

  it.each([undefined, -1, 2, 0.5, '0', null])('rejects invalid or missing index %s', (index) => {
    const input = request();
    const response = set(input);
    (response.exercises[0] as any).exampleIndex = index;
    const findings = validateTutorExamplePracticeSet(response, input);
    expect(findings).toContainEqual({ code: 'exercise.exampleIndexInvalid', severity: 'error', subjects: ['request'] });
    expect(tutorFindingMessage(findings[0])).toMatch(/lesson example index/);
  });

  it.each(['prompt', 'expectedAnswer'] as const)('rejects five-word copying in %s, including from a different example', (field) => {
    const input = request();
    const response = set(input);
    response.exercises[0]![field] = 'WOULD you, kindly bring a! package tomorrow.';
    const findings = validateTutorExamplePracticeSet(response, input);
    expect(findings).toContainEqual({ code: 'exercise.exampleCopied', severity: 'error', subjects: ['request'] });
    expect(tutorFindingMessage(findings[0])).toMatch(/copied five consecutive words/);
  });

  it('rejects a prompt copying the example sentence', () => {
    const input = request();
    const response = set(input);
    response.exercises[0]!.prompt = input.examples[0]!.sentence;
    expect(validateTutorExamplePracticeSet(response, input).map((finding) => finding.code)).toContain('exercise.exampleCopied');
  });

  it('accepts four consecutive shared words in a prompt and expected answer', () => {
    const input = request();
    const response = set(input);
    response.exercises[0]!.prompt = 'Could you please close another door?';
    response.exercises[0]!.expectedAnswer = 'Would you kindly bring some tea?';
    expect(validateTutorExamplePracticeSet(response, input)).toEqual([]);
  });

  it('ignores punctuation between words even without spaces', () => {
    const input = request();
    const response = set(input);
    response.exercises[0]!.prompt = 'Would,you;kindly-bring:a gift?';
    expect(validateTutorExamplePracticeSet(response, input).map((finding) => finding.code)).toContain('exercise.exampleCopied');
  });

  it.each([undefined, '', 3])('rejects missing or unreadable expected answer %s', (answer) => {
    const input = request();
    const response = set(input);
    (response.exercises[0] as any).expectedAnswer = answer;
    expect(validateTutorExamplePracticeSet(response, input).map((finding) => finding.code)).toContain('exercise.expectedAnswerInvalid');
  });

  it('preserves core echoed-value validation', () => {
    const input = request();
    const response = set(input);
    response.mapVersion = 'wrong';
    response.channel = 'spokenTyped';
    input.count = 2;
    expect(validateTutorExamplePracticeSet(response, input).map((finding) => finding.code)).toEqual(expect.arrayContaining([
      'exercise.mapVersionMismatch', 'exercise.setChannelMismatch', 'exercise.countMismatch'
    ]));
  });

  it('asks Hint to explain how the numbered example applies without answering', () => {
    const state = createTutorViewState();
    const built = tutorPracticeHintRequest('Ask for a report.', [], state.settings, undefined,
      { exampleIndex: 1, sentence: request().examples[1]!.sentence });
    expect(JSON.parse(built.input)).toEqual({ question: 'Ask for a report.', lessonExample: {
      exampleIndex: 1, sentence: request().examples[1]!.sentence
    } });
    expect(built.instruction).toContain('In explanation, refer back to lesson example 2');
    expect(built.instruction).toContain('Never write the answer');
  });
});
