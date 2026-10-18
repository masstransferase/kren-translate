import { createTutorViewState } from '../src/tutor/state.js';
import { expect, it, vi } from 'vitest';

// A changed shared export must reach both producers, so a local copy cannot pass.
vi.mock('@kren/core/tutor', async (importOriginal) => {
  const core = await importOriginal<typeof import('@kren/core/tutor')>();
  return { ...core, TUTOR_DIAGNOSTIC_PROTOCOL:
    `${core.TUTOR_DIAGNOSTIC_PROTOCOL}\nShared protocol dependency marker.` };
});

import { TUTOR_DIAGNOSTIC_PROTOCOL } from '@kren/core/tutor';
import {
  tutorConversationDiagnosisRequest,
  tutorPassageDiagnosisRequest
} from '../src/tutor/generation.js';

it('V76 R2 diagnosis requests inherit polish from the shared core constant exactly once', () => {
  // Bounded by the next paragraph rather than by its closing sentence, which moved when
  // polish gained permission to propose a primary target in core 0.28.0.
  const polish = TUTOR_DIAGNOSTIC_PROTOCOL.match(/Return separately[\s\S]*?(?=Each finding carries)/u)![0];
  expect(polish).toContain('zero to three polish suggestions');
  const turns = Array.from({ length: 5 }, () => ({ question: 'What happened?',
    learnerAnswer: 'We arrived.', correction: 'We arrived.', explanation: 'Correct.', nextQuestion: 'And then?' }));
  for (const request of [tutorPassageDiagnosisRequest('We arrived.', 'Weakness analysis', createTutorViewState().settings),
    tutorPassageDiagnosisRequest('We arrived.', 'Text analysis', createTutorViewState().settings), tutorConversationDiagnosisRequest(turns, createTutorViewState().settings)]) {
    expect(request.instruction.split(TUTOR_DIAGNOSTIC_PROTOCOL)).toHaveLength(2);
    expect(request.instruction.split(polish)).toHaveLength(2);
  }
});
