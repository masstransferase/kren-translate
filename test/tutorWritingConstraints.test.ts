import { describe, expect, it } from 'vitest';
import { TUTOR_MAP } from '@kren/core/tutor';
import {
  createTutorViewState, tutorWritingConstraints, TUTOR_WRITING_CONSTRAINT_LABELS
} from '../src/tutor/state.js';
import {
  tutorConversationDiagnosisRequest, tutorPassageDiagnosisRequest
} from '../src/tutor/generation.js';

/*
 * The reader stated the objective as constrained optimisation on 2026-09-10: natural
 * expression subject to situation and purpose. Unconstrained, "more natural" has no unique
 * answer, so a model asked for improvements always finds one and the result reads as taste.
 *
 * These guard the constraints actually reaching the model, which is the half that makes the
 * protocol's wording mean anything. The protocol itself is core's and guarded there.
 */

const turns = Array.from({ length: 5 }, (_, index) => ({
  question: `Question ${index}?`, learnerAnswer: `Answer ${index}.`,
  correction: `Correction ${index}.`, explanation: `Explanation ${index}.`,
  nextQuestion: `Next ${index}?`
}));

function chosenState() {
  const state = createTutorViewState();
  state.selection = [{ nodeId: TUTOR_MAP[0]!.id, role: 'primary' }];
  Object.assign(state.settings.axes, {
    domain: 'scientific', function: 'report', modality: 'written', formality: 'formal'
  });
  state.settings.learnerLevel = 'B2';
  return state;
}

const bothRequests = (state: ReturnType<typeof chosenState>) => [
  ['passage', tutorPassageDiagnosisRequest('Some words.', 'Weakness analysis',
    { axes: state.settings.axes, learnerLevel: state.settings.learnerLevel })],
  ['conversation', tutorConversationDiagnosisRequest(turns,
    { axes: state.settings.axes, learnerLevel: state.settings.learnerLevel })]
] as const;

describe('the writing constraints a diagnosis is judged against', () => {
  it('V88 R1 R3 sends all five chosen constraints to both diagnosis producers', () => {
    const state = chosenState();
    const expected = tutorWritingConstraints(
      { axes: state.settings.axes, learnerLevel: state.settings.learnerLevel });
    expect(Object.keys(expected).sort())
      .toEqual(['domain', 'formality', 'function', 'learnerLevel', 'modality']);

    for (const [kind, request] of bothRequests(state)) {
      const serialised = JSON.stringify(request);
      for (const [field, label] of Object.entries(expected)) {
        expect(serialised, `${kind} carries ${field}`).toContain(String(label));
      }
    }
  });

  /*
   * Absence has to be absence. A fabricated purpose is worse than a missing one, because
   * suggestions tuned to something the reader never asked for still look authoritative.
   */
  it('V88 R4 omits every constraint that means no preference', () => {
    const state = createTutorViewState();
    state.selection = [{ nodeId: TUTOR_MAP[0]!.id, role: 'primary' }];
    Object.assign(state.settings.axes, {
      domain: 'general', function: 'general', formality: 'preserve'
    });
    state.settings.learnerLevel = 'auto';
    const constraints = tutorWritingConstraints(
      { axes: state.settings.axes, learnerLevel: state.settings.learnerLevel });

    expect(Object.keys(constraints)).toEqual(['modality']);
    for (const absent of ['domain', 'function', 'formality', 'learnerLevel']) {
      expect(constraints).not.toHaveProperty(absent);
    }
  });

  /*
   * Modality has no unset value, so omitting it would express nothing rather than "no
   * preference", and whether the reader is writing or speaking is never neutral about their
   * English. It is the one constraint that is always sent.
   */
  it('V88 R4 always sends modality, whichever it is', () => {
    for (const modality of ['written', 'spoken'] as const) {
      const state = createTutorViewState();
      Object.assign(state.settings.axes, {
        domain: 'general', function: 'general', formality: 'preserve', modality
      });
      state.settings.learnerLevel = 'auto';
      const constraints = tutorWritingConstraints(
        { axes: state.settings.axes, learnerLevel: state.settings.learnerLevel });
      expect(constraints.modality).toBe(TUTOR_WRITING_CONSTRAINT_LABELS.modality[modality]);
    }
  });

  /*
   * One source of labels, checked by changing it rather than by comparing two literals.
   * Typing the same string twice passes an equality check and is exactly what drifts.
   */
  it('V88 R1 takes every label from one source, so the two requests cannot disagree', () => {
    const state = chosenState();
    const labels = TUTOR_WRITING_CONSTRAINT_LABELS;
    const original = labels.domain.scientific;
    try {
      (labels.domain as Record<string, string>).scientific = 'A DISTINCTIVE MARKER';
      for (const [kind, request] of bothRequests(state)) {
        expect(JSON.stringify(request), `${kind} reads the shared label source`)
          .toContain('A DISTINCTIVE MARKER');
      }
    } finally {
      (labels.domain as Record<string, string>).scientific = original;
    }
  });

  it('V88 R2 sends the learner level to the model, not only to the validator', () => {
    const state = chosenState();
    state.settings.learnerLevel = 'A2';
    const [, passage] = bothRequests(state)[0];
    expect(JSON.stringify(passage))
      .toContain(TUTOR_WRITING_CONSTRAINT_LABELS.learnerLevel.A2);
  });

  it('V88 R4 tells the model that an absent field is not a decision', () => {
    const state = chosenState();
    for (const [kind, request] of bothRequests(state)) {
      expect(request.instruction, `${kind} explains absence`)
        .toContain('An omitted field expresses no preference');
    }
  });
});
