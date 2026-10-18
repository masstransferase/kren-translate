import { describe, expect, it } from 'vitest';
import { requestTutorStructuredJson } from '../src/tutor/generation.js';
import { schemaInstruction, schemaOutline } from '../src/providers/structuredJsonShape.js';
import { structuredJsonRequestInit } from '../src/providers/structuredJsonTransport.js';
import {
  TUTOR_LESSON_SCHEMA,
  tutorExerciseGenerationRequest,
  tutorLessonGenerationRequest
} from '../src/tutor/generation.js';
import { createTutorViewState, tutorRecipeFromState } from '../src/tutor/state.js';
import { TUTOR_MAP } from '@kren/core/tutor';

/*
 * The owner could not generate a single lesson or exercise set. Every attempt returned a
 * wall of `lesson.requiredFieldMissing`, and the exercises came back with a mapVersion and
 * a channel that matched nothing.
 *
 * The cause was that Gemini received neither the schema nor the shape. The transport
 * deliberately sent no schema, because Gemini rejects `additionalProperties` and every
 * schema here sets it for OpenAI's strict mode, and its comment said the instruction stated
 * the shape instead. The tutor's instruction named no field at all: it said "matching the
 * KREN TutorLesson contract", which the model has never seen. So the model invented field
 * names and validation refused every one.
 *
 * These tests hold both halves of the fix, and the last one holds the property that matters
 * more than either: the shape a provider is told about is derived from the schema, so it
 * cannot drift when the schema changes.
 */

/*
 * There were four tests here for a `geminiResponseSchema` that stripped `additionalProperties`
 * so the schema could be sent to Gemini. Both the function and the tests are gone, because the
 * sanitised schema was still rejected: Gemini accepts `enum` only on a string, and expressing
 * `{ type: 'number', const: 1 }` at all requires one. Two live attempts returned 400.
 *
 * The test below replaces all four. It asserts the decision rather than the mechanism, which
 * is what a future reader needs: they will be tempted to send a schema again.
 */
const request = (): ReturnType<typeof tutorLessonGenerationRequest> => {
  const state = createTutorViewState();
  state.selection = [{
    nodeId: TUTOR_MAP.find((node) => node.kind === 'microTarget')!.id,
    role: 'primary'
  }];
  return tutorLessonGenerationRequest(tutorRecipeFromState(state));
};

const geminiBody = (): Record<string, unknown> => {
  const init = structuredJsonRequestInit(
    {
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      thinkingOrEffort: 'auto',
      apiKey: 'test-key',
      schema: request().schema,
      schemaName: request().schemaName
    },
    { instruction: request().instruction, input: request().input },
    new AbortController().signal
  );
  return JSON.parse(String(init.body)) as Record<string, unknown>;
};


/*
 * "Gemini AI English Tutor request failed (400)." is what the owner saw twice, while the
 * cause was one unsupported keyword in a request they could not see. A status alone cannot
 * tell a rejected schema from a rejected key, and the provider's own body says which.
 */
describe('what a rejected request reports', () => {
  const settings = {
    provider: 'gemini' as const,
    model: 'gemini-3.6-flash',
    thinkingOrEffort: 'auto' as const,
    apiKey: 'test-key',
    maxAttempts: 1,
    geminiProfile: 'standard' as const,
    fallbackEnabled: false,
    fallbackModel: '',
    fallbackThinkingOrEffort: 'auto' as const
  };

  const rejectWith = async (body: string): Promise<Error> => {
    const fetcher = (async () => new Response(body, { status: 400 })) as unknown as typeof fetch;
    try {
      await requestTutorStructuredJson(
        settings as never,
        {
          kind: 'lesson',
          instruction: 'i',
          input: '{}',
          schema: TUTOR_LESSON_SCHEMA,
          schemaName: 'kren_tutor_lesson'
        },
        new AbortController().signal,
        fetcher
      );
    } catch (error) {
      return error as Error;
    }
    throw new Error('the request did not fail');
  };

  it('keeps the status and drops provider free text', async () => {
    const error = await rejectWith('{"error":{"message":"Invalid JSON payload: enum"}}');

    expect(error.message, 'the status is still there').toContain('(400)');
    // 2026-10-05: provider free text can quote credentials and must never reach the reader.
    expect(error.message).not.toContain('Invalid JSON payload: enum');
  });

  it('drops a very long provider body entirely', async () => {
    const error = await rejectWith('x'.repeat(2000));

    // Changed 2026-09-22: V138 allows one KiB so Google's quotaId and retryDelay survive,
    // while retaining this test's original requirement that multi-kilobyte bodies are bounded.
    expect(error.message.length, 'a provider can return kilobytes').toBeLessThan(1200);
    // 2026-10-05: suppress the entire body rather than displaying a truncated excerpt.
    expect(error.message).not.toContain('x'.repeat(20));
  });

  it('still reports the status when the body cannot be read', async () => {
    const fetcher = (async () => ({
      ok: false,
      status: 400,
      headers: new Headers(),
      text: () => Promise.reject(new Error('stream already consumed'))
    })) as unknown as typeof fetch;
    let message = '';
    try {
      await requestTutorStructuredJson(
        settings as never,
        {
          kind: 'lesson', instruction: 'i', input: '{}',
          schema: TUTOR_LESSON_SCHEMA, schemaName: 'kren_tutor_lesson'
        },
        new AbortController().signal,
        fetcher
      );
    } catch (error) { message = (error as Error).message; }

    expect(message, 'an unreadable body must not lose the status').toContain('(400)');
  });
});

describe('what Gemini is deliberately not sent', () => {
  it('carries no response schema, because two attempts at one returned 400', () => {
    const config = geminiBody()['generationConfig'] as Record<string, unknown>;

    expect(config['responseSchema'], 'Gemini rejects these schemas; the outline carries the shape')
      .toBeUndefined();
    expect(config['responseMimeType'], 'JSON is still requested').toBe('application/json');
  });
});

describe('the shape stated in words', () => {
  it('names every top-level field the schema requires', () => {
    const outline = schemaOutline(TUTOR_LESSON_SCHEMA);

    for (const field of TUTOR_LESSON_SCHEMA['required'] as string[]) {
      expect(outline, `${field} is named`).toContain(field);
    }
  });

  it('marks optional fields so a model knows it may omit them', () => {
    const outline = schemaOutline({
      type: 'object',
      properties: { kept: { type: 'string' }, spare: { type: 'string' } },
      required: ['kept']
    });

    expect(outline).toMatch(/kept: string(?! \(optional\))/u);
    expect(outline).toContain('spare: string (optional)');
  });

  it('tells the model to use these names and no others', () => {
    expect(schemaInstruction(TUTOR_LESSON_SCHEMA))
      .toContain('using these field names and no others');
  });
});

/*
 * The owner's third failure: one `lesson.exploreChoiceUnexpected` and one
 * `lesson.primaryTargetMissing` per example.
 *
 * The instruction carried both branches, Explore and Exact, and asked the model to tell them
 * apart from the supplied identifier. It cannot. The recipe holds `primaryTarget: "mechanics"`
 * and nothing saying whether that is a Hub or a Skill, and the identifiers do not announce
 * their level. So it guessed Explore for an exact target, invented a child, and every example
 * named something the recipe never asked for.
 *
 * KREN has the map, so KREN decides. These tests hold that only the applicable branch is sent,
 * which is what makes the guess impossible rather than merely discouraged.
 */
describe('which branch the lesson instruction states', () => {
  const instructionFor = (nodeId: string): string => {
    const state = createTutorViewState();
    state.selection = [{ nodeId, role: 'primary' }];
    return tutorLessonGenerationRequest(tutorRecipeFromState(state)).instruction;
  };

  const exact = TUTOR_MAP.find((node) => node.kind === 'microTarget')!;
  const hub = TUTOR_MAP.find((node) => node.kind === 'hub')!;

  it('tells an exact target to omit the choice, and never mentions choosing one', () => {
    const instruction = instructionFor(exact.id);

    expect(instruction).toContain(`exactly "${exact.id}"`);
    expect(instruction).toContain('omit chosenUnder entirely');
    expect(instruction, 'the branch that does not apply is absent, not merely deprioritised')
      .not.toContain('choose exactly one child');
  });

  it('names the example identifier for an exact target, so it cannot be invented', () => {
    expect(instructionFor(exact.id))
      .toContain(`make every example's targetIds include "${exact.id}"`);
  });

  it('tells a Hub to choose, and lists the identifiers it may choose from', () => {
    const instruction = instructionFor(hub.id);
    const children = TUTOR_MAP.filter((node) => node.parentId === hub.id);

    expect(children.length, 'the fixture hub has children to offer').toBeGreaterThan(0);
    expect(instruction).toContain('choose exactly one child beneath it');
    expect(instruction).toContain(`chosenUnder to "${hub.id}"`);
    for (const child of children) {
      expect(instruction, `${child.id} is offered by identifier`).toContain(`"${child.id}"`);
    }
    /*
     * Listing the children is only useful if it excludes everything else. Asserting only
     * that each child appears passes just as well when all 123 nodes are offered, which is
     * the mutation that survived this test's first version.
     */
    const outsider = TUTOR_MAP.find((node) =>
      node.parentId !== undefined && node.parentId !== hub.id && node.id !== hub.id
    )!;
    expect(instruction, `${outsider.id} sits elsewhere and must not be offered`)
      .not.toContain(`"${outsider.id}"`);
    expect(instruction, 'the branch that does not apply is absent')
      .not.toContain('omit chosenUnder entirely');
  });
});

describe('the values an exercise set has to echo', () => {
  /*
   * The owner's every attempt returned exercise.mapVersionMismatch and a channel mismatch on
   * each item. The instruction named where to look, "the recipe mapVersion, requested written
   * channel", rather than what to write, so the model guessed and validation caught the guess
   * every time. Stating the literals is not redundant with the check: it removes the guess.
   */
  it('states the literal mapVersion, channel, and count', () => {
    const state = createTutorViewState();
    state.selection = [{
      nodeId: TUTOR_MAP.find((node) => node.kind === 'microTarget')!.id,
      role: 'primary'
    }];
    const recipe = tutorRecipeFromState(state);
    const built = tutorExerciseGenerationRequest({ examples: [],
      schemaVersion: 1, recipe, count: 5, channel: 'written'
    });

    expect(built.instruction).toContain(`exactly "${recipe.mapVersion}"`);
    expect(built.instruction).toContain('exactly "written"');
    expect(built.instruction).toContain('exactly 5 exercises');
  });

  /*
   * The map version is currently 1.0.0, so a hard-coded literal matched the assertion and
   * the mutation replacing the request value with "1.0.0" survived the suite. A version that
   * is not the current one is what makes this an observation rather than a coincidence.
   */
  it('takes the mapVersion from the request rather than a fixed string', () => {
    const state = createTutorViewState();
    state.selection = [{
      nodeId: TUTOR_MAP.find((node) => node.kind === 'microTarget')!.id,
      role: 'primary'
    }];
    const recipe = { ...tutorRecipeFromState(state), mapVersion: '9.9.9-probe' };
    const built = tutorExerciseGenerationRequest({ examples: [],
      schemaVersion: 1, recipe, count: 3, channel: 'written'
    });

    expect(built.instruction).toContain('exactly "9.9.9-probe"');
  });

  it('takes them from the request, so they match what validation compares against', () => {
    const state = createTutorViewState();
    state.selection = [{
      nodeId: TUTOR_MAP.find((node) => node.kind === 'microTarget')!.id,
      role: 'primary'
    }];
    const recipe = tutorRecipeFromState(state);
    const built = tutorExerciseGenerationRequest({ examples: [],
      schemaVersion: 1, recipe, count: 2, channel: 'spokenScripted'
    });

    expect(built.instruction, 'the channel is the requested one, not a fixed word')
      .toContain('exactly "spokenScripted"');
    expect(built.instruction).not.toContain('exactly "written"');
  });
});

describe('what a Gemini tutor request carries', () => {
  it('also states the field names in the system instruction', () => {
    const system = JSON.stringify(geminiBody()['systemInstruction']);

    expect(system, 'the outline is the fallback if a model rejects the schema')
      .toContain('using these field names and no others');
    for (const field of ['lessonTitle', 'conceptExplanation', 'examples']) {
      expect(system, `${field} is named to the model`).toContain(field);
    }
  });

  /*
   * The property that makes the other two safe over time. A hand-written field list would
   * pass every test above on the day it was written and then quietly stop matching the
   * schema, which is the same defect in a different place: the shape said twice.
   */
  it('derives what it tells the model from the schema, so the two cannot disagree', () => {
    const extended = {
      ...TUTOR_LESSON_SCHEMA,
      properties: {
        ...(TUTOR_LESSON_SCHEMA['properties'] as object),
        aFieldAddedLater: { type: 'string' }
      },
      required: [...(TUTOR_LESSON_SCHEMA['required'] as string[]), 'aFieldAddedLater']
    };

    expect(schemaOutline(extended), 'a field added to the schema reaches the instruction')
      .toContain('aFieldAddedLater');
  });
});
