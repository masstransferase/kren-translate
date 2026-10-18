import { createTutorViewState } from '../src/tutor/state.js';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TUTOR_MAP } from '@kren/core/tutor';
import {
  TUTOR_CORRECTION_CLAUSE, TUTOR_DIAGNOSTIC_PROTOCOL,
  tutorConversationDiagnosisRequest, tutorConversationTurnRequest,
  tutorDiagnosticReport, tutorPassageDiagnosisRequest
} from '../src/tutor/generation.js';

const turns = Array.from({ length: 5 }, (_, index) => ({
  question: `Question marker ${index}?`, learnerAnswer: `Answer marker ${index}.`,
  correction: index === 0 ? 'Answer marker 0.' : `Correction marker ${index}.`,
  explanation: `EXCLUDED explanation marker ${index}.`, nextQuestion: `EXCLUDED next ${index}?`
}));
const targetId = TUTOR_MAP[0]!.id;
const finding = (level: number, turnCount?: number) => ({
  level, observation: `Pattern at level ${level}.`, evidence: 'Answer', targetId,
  ...(turnCount === undefined ? {} : { turnCount })
});

describe('V68 diagnostic protocol', () => {
  // 2026-10-04: These governing documents are excluded from generated public trees.
  // Keep their assertions in private, and keep the product protocol checks in both.
  for (const filename of ['TUTOR_DIAGNOSTIC_PROTOCOL.md', 'TUTOR_INTERFACE_DECISIONS.md']) {
    it.skipIf(!existsSync(`docs/tutor/${filename}`))(
      `V78 R3 keeps retired finding levels out of governing prose in ${filename}`, () => {
      const document = readFileSync(`docs/tutor/${filename}`, 'utf8');
      expect(document.match(/level\s+4|1\s+to\s+4|fourth\s+(?:finding\s+)?level/giu) ?? []).toEqual([]);
    });
  }

  it('V72 R6 requests corrections only for evidence that needs correcting', () => {
    expect(TUTOR_DIAGNOSTIC_PROTOCOL).toContain('An optional correction rewrites the quoted evidence as it should be.');
    // Level 4 left findings in core 0.22.0, so a correction has nothing to be omitted
    // for there. Naturalness is now its own request with its own rules.
    expect(TUTOR_DIAGNOSTIC_PROTOCOL).toContain('Omit it for correct Text analysis demonstrations.\nNever invent a correction to fill the field.');
    expect(TUTOR_DIAGNOSTIC_PROTOCOL).toContain('zero to three polish suggestions');
    expect(TUTOR_DIAGNOSTIC_PROTOCOL).not.toContain('level 4');
  });

  it('V72 R6 drops unusable corrections independently', () => {
    const original = finding(2);
    for (const correction of [undefined, null, 12, {}, [], '', '   ', ' Answer ']) {
      expect(tutorDiagnosticReport({ findings: [{ ...original, correction }] }, 'Answer.').findings).toEqual([original]);
    }
    expect(tutorDiagnosticReport({ findings: [{ ...original, correction: '  Corrected answer  ' }] }, 'Answer.').findings)
      .toEqual([{ ...original, correction: 'Corrected answer' }]);
    expect(tutorDiagnosticReport({ findings: [original] }, 'Answer.', 'B2', 'Text analysis').findings).toEqual([original]);
  });

  /*
   * The request names the fields, and a field it does not name does not arrive. `polish` was
   * described in the protocol and absent from that list for three releases, so the reader
   * never saw one naturalness suggestion. The level range drifted the same way, staying at
   * 1 to 4 through every change to how many levels exist, because nothing compared the two.
   *
   * Both halves read from the protocol constant rather than from a number typed here, so
   * changing the protocol without changing the request fails this.
   */
  it('names every field the validator reads and a level range the protocol offers', () => {
    for (const request of [tutorPassageDiagnosisRequest('Answer.', 'Weakness analysis', createTutorViewState().settings),
      tutorPassageDiagnosisRequest('Answer.', 'Text analysis', createTutorViewState().settings), tutorConversationDiagnosisRequest(turns, createTutorViewState().settings)]) {
      /*
       * Scoped to the enumeration sentence on purpose. Checking the whole instruction passed
       * while `polish` was deleted from the field list, because the sentence describing its
       * shape mentions it too, so the guard was measuring something adjacent to what breaks.
       */
      const enumerated = request.instruction.match(/fields ([^.]+)\./u)?.[1] ?? '';
      for (const field of ['targets', 'summary', 'findings', 'polish', 'focus']) {
        expect(enumerated).toContain(`"${field}"`);
      }
      const offered = [...TUTOR_DIAGNOSTIC_PROTOCOL.matchAll(/(\d), [a-z]/gu)]
        .map((match) => Number(match[1]));
      expect(offered.length).toBeGreaterThan(0);
      expect(request.instruction).toContain(`integer level from 1 to ${Math.max(...offered)}`);
    }
  });

  // 2026-10-04: The private source document is deliberately absent from public output.
  it.skipIf(!existsSync('docs/tutor/TUTOR_DIAGNOSTIC_PROTOCOL.md'))('R1 R2 copies both document blocks verbatim', () => {
    const document = readFileSync('docs/tutor/TUTOR_DIAGNOSTIC_PROTOCOL.md', 'utf8').replace(/\r\n/gu, '\n');
    const blocks = [...document.matchAll(/```\n([\s\S]*?)\n```/gu)].map((match) => match[1]);
    expect(TUTOR_DIAGNOSTIC_PROTOCOL).toBe(blocks[0]);
    expect(TUTOR_CORRECTION_CLAUSE).toBe(blocks[1]);
  });

  it('R1 R2 shares exactly one protocol per diagnosis and keeps the full protocol out of turns', () => {
    for (const request of [tutorPassageDiagnosisRequest('Answer.', 'Weakness analysis', createTutorViewState().settings),
      tutorPassageDiagnosisRequest('Answer.', 'Text analysis', createTutorViewState().settings), tutorConversationDiagnosisRequest(turns, createTutorViewState().settings)]) {
      expect(request.instruction.split(TUTOR_DIAGNOSTIC_PROTOCOL)).toHaveLength(2);
    }
    const request = tutorConversationTurnRequest({ register: 'neutral', recipeTargets: { supportingTargets: [] },
      transcript: [], question: 'What happened?', learnerAnswer: 'Answer.' });
    expect(request.instruction.split(TUTOR_CORRECTION_CLAUSE)).toHaveLength(2);
    expect(JSON.stringify(request)).not.toContain(JSON.stringify(TUTOR_DIAGNOSTIC_PROTOCOL).slice(1, -1));
  });

  it('R4 sends every question answer and correction and excludes every explanation', () => {
    const request = tutorConversationDiagnosisRequest(turns, createTutorViewState().settings);
    expect(JSON.parse(request.input)).toEqual(turns.map(({ question, learnerAnswer, correction }) => ({ question, learnerAnswer, correction })));
    for (const turn of turns) {
      expect(JSON.stringify(request)).not.toContain(turn.explanation);
      expect(JSON.stringify(request)).not.toContain(turn.nextQuestion);
    }
  });

  /*
   * Replaced on 2026-09-07, when level 4 left findings for the polish list.
   *
   * The cap, the below-Intermediate gate, the ordering and the primary exclusion all still
   * exist and are all still tested; they govern polish now, in core, where naturalness has
   * its own slots and cannot be crowded out by accuracy. What this host must still see is
   * that a fourth level never reaches a report, because a model answering an older protocol
   * would otherwise put the two back in competition for five slots.
   */
  it('R3 drops a level-4 finding whatever the learner level', () => {
    for (const level of ['A1', 'B2', 'C1', 'Auto']) {
      expect(tutorDiagnosticReport({ findings: [finding(4), finding(2)] }, 'Answer.', level).findings)
        .toEqual([finding(2)]);
    }
  });

  it.each(['A1', 'A2', 'Beginner', 'Elementary'])('R3 drops level 4 for %s', (level) => {
    expect(tutorDiagnosticReport({ findings: [finding(4)] }, 'Answer.', level).findings).toEqual([]);
  });

  it.each(['B1', 'B2', 'Upper-intermediate', 'Auto'])('R3 drops level 4 for %s too', (level) => {
    expect(tutorDiagnosticReport({ findings: [finding(4)] }, 'Answer.', level).findings).toEqual([]);
  });

  /*
   * A primary is no longer withdrawn for being supported only by a level-4 finding, because
   * a level-4 finding never arrives. What replaces that rule lives in the protocol: a polish
   * suggestion never supplies a primary target, since the primary is what a lesson teaches
   * and naturalness is not a deficit.
   */
  it('R3 keeps a primary supported by a real finding, and drops one supported by nothing', () => {
    expect(tutorDiagnosticReport({ targets: [{ targetId, role: 'primary' }],
      findings: [finding(2)] }, 'Answer.', 'B2').targets).toEqual([{ nodeId: targetId, role: 'primary' }]);
    expect(tutorDiagnosticReport({ targets: [{ targetId, role: 'primary' }],
      findings: [finding(4)] }, 'Answer.', 'B2').findings).toEqual([]);
  });

  it('R3 drops missing fractional string and out of range levels independently', () => {
    const { level, ...missing } = finding(1);
    expect(tutorDiagnosticReport({ findings: [missing, finding(0), finding(5), finding(1.5),
      { ...finding(1), level: '1' }, finding(2)] }, 'Answer.').findings).toEqual([finding(2)]);
  });

  it('R4 ranks recurrence before severity', () => {
    expect(tutorDiagnosticReport({ findings: [finding(1, 1), finding(2, 5), finding(1, 3)] },
      turns.map((turn) => turn.learnerAnswer), 'B2').findings).toEqual([finding(2, 5), finding(1, 3), finding(1, 1)]);
  });

  it('R4 drops invented evidence and quotations crossing learner answer boundaries', () => {
    expect(tutorDiagnosticReport({ findings: [
      { ...finding(1), evidence: turns[0]!.question },
      { ...finding(1), evidence: turns[1]!.correction },
      { ...finding(1), evidence: '0. Answer marker 1.' }, finding(2)
    ] }, turns.map((turn) => turn.learnerAnswer)).findings).toEqual([finding(2)]);
  });

  it('R4 drops invalid optional turn counts while preserving findings', () => {
    for (const turnCount of [0, 6, 1.5, '2']) {
      expect(tutorDiagnosticReport({ findings: [{ ...finding(2), turnCount }] },
        turns.map((turn) => turn.learnerAnswer)).findings).toEqual([finding(2)]);
    }
  });

  it('R1 preserves Text analysis prominence order', () => {
    expect(tutorDiagnosticReport({ findings: [finding(2), finding(1), finding(2)] },
      'Answer.', 'B2', 'Text analysis').findings).toEqual([finding(2), finding(1), finding(2)]);
  });
});
