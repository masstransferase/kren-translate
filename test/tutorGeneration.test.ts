import { tutorConversationCoachingRequest, tutorConversationCoaching } from '../src/tutor/generation.js';
import { describe, expect, it, vi } from 'vitest';
import {
  TUTOR_SITUATION_ROLES,
  TUTOR_SITUATION_ROLES_SWAPPED,
  buildTutorReviewInstruction,
  createTutorInstructionSource,
  requestTutorStructuredJson,
  TUTOR_CONVERSATION_OPENING_SCHEMA,
  TUTOR_CONVERSATION_TURN_SCHEMA,
  TUTOR_CONVERSATION_SCENE_SLANTS,
  TUTOR_CONVERSATION_SCENE_SLANT_WEIGHTS,
  TUTOR_CORRECTION_CLAUSE,
  TUTOR_PROSE_ANSWER_SCHEMA,
  TUTOR_TARGET_SEARCH_SCHEMA,
  TUTOR_PRIVACY_INSTRUCTION,
  tutorExampleQuestionRequest,
  tutorConversationOpening,
  tutorConversationOpeningRequest,
  tutorConversationCorrectionsRequest,
  tutorConversationHintRequest,
  tutorConversationSceneSlant,
  tutorConversationLiveSystemInstruction,
  tutorConversationLiveTeachingInstruction,
  tutorConversationTeachingInstruction,
  tutorConversationTurn,
  tutorConversationTurnRequest,
  tutorExerciseGenerationRequest,
  tutorLessonGenerationRequest,
  tutorPassageDiagnosisRequest,
  tutorDiagnosticReport,
  tutorTailoredPromptRequest,
  tutorWrittenPrompt,
  TUTOR_DIAGNOSTIC_REPORT_SCHEMA,
  tutorPracticeQuestionRequest,
  tutorProseAnswer,
  tutorReviewGenerationRequest,
  tutorTargetSearchSelection,
  tutorTargetSearchRequest
} from '../src/tutor/generation.js';
import { schemaInstruction } from '../src/providers/structuredJsonShape.js';
import { SMART_GRAMMAR_INSTRUCTION } from '@kren/core/grammar';
import { createTutorViewState, tutorRecipeFromState } from '../src/tutor/state.js';
import { TUTOR_MAP } from '@kren/core/tutor';

const leaf = TUTOR_MAP.find((node) =>
  !TUTOR_MAP.some((candidate) => candidate.parentId === node.id)
)!;
const supportLeaves = TUTOR_MAP.filter((node) =>
  node.id !== leaf.id && !TUTOR_MAP.some((candidate) => candidate.parentId === node.id)
).slice(0, 3);

function questionOnlyRecipe(question: string) {
  const state = createTutorViewState();
  state.settings.questionOnly = true;
  state.question = question;
  return tutorRecipeFromState(state);
}

function recipe(supportIds: readonly string[] = []) {
  const state = createTutorViewState();
  state.selection = [
    { nodeId: leaf.id, role: 'primary' },
    ...supportIds.map((nodeId) => ({ nodeId, role: 'support' as const }))
  ];
  return tutorRecipeFromState(state);
}

const diagnosisExampleInstruction = 'Where the lesson comes from a diagnosis, phrases quoted in the recipe question or ' +
  'prepared prompt are evidence of a gap, not the subject to teach. Teach the underlying ' +
  'rule or natural expression pattern through different words. At most 1 example in the ' +
  'whole lesson may reuse any phrase quoted by the diagnosis, including its corrected ' +
  'version; count examples across all quoted phrases together, not separately per phrase. ' +
  'The other examples must teach other cases of the same rule, not synonyms or small ' +
  'rewrites of the quoted phrases. When replacing one example, reuse 0 of those phrases ' +
  'or their corrected versions, because the other examples are not supplied for counting.';

describe('tutor structured generation boundary', () => {
  it('V135 requires the separate correction while constraining only non-teaching reply text', () => {
    const standard = tutorConversationTeachingInstruction(false);
    expect(standard).toContain('correction field');
    expect(standard).toContain('complete corrected sentence in full');
    expect(standard).toContain('reply field only');
    expect(standard).toContain('Do not quote or restate the learner');

    const live = tutorConversationLiveTeachingInstruction(false);
    expect(live).toContain('spoken reply only');
    expect(live).toContain('complete corrected sentence separately');
    expect(live).toContain('Do not quote or restate the learner');
    const teaching = tutorConversationTeachingInstruction(true);
    expect(teaching).toContain('corrected clause');
    expect(teaching).toContain('Do not silently pass a clear error');
    const liveTeaching = tutorConversationLiveTeachingInstruction(true);
    expect(liveTeaching).toContain('begin your reply by saying the corrected version');
    expect(liveTeaching).toContain('Do not silently pass a clear error');
    // Added 2026-09-23: stronger compliance must not turn KREN into a style pedant.
    expect(liveTeaching).toContain('acceptable variants');
  });

  it('V152 keeps Standard model-provided reply quotes unchanged', () => {
    const request = tutorConversationTurnRequest({
      register: 'neutral', recipeTargets: { supportingTargets: [] }, transcript: [],
      question: 'Where are you from?', learnerAnswer: 'I am from United States.', teaching: true
    });
    expect(request.instruction).toContain('"replyQuote"');
    expect(request.instruction).toContain('copied character for character from reply');
    expect(TUTOR_CONVERSATION_TURN_SCHEMA.required).toContain('replyQuote');
    expect(tutorConversationTurn({
      move: 'recast', reply: 'Actually, you would say: from the United States.',
      replyQuote: 'from the United States', correction: 'I am from the United States.',
      targetId: '', explanation: 'Use the definite article.',
      rephrase: 'I am from the United States.', rephraseWhy: 'This is the natural corrected form.'
    })).toMatchObject({ replyQuote: 'from the United States' });
  });

  it('V153 tells every character-writing request which gender its speaking voice has', () => {
    const opening = tutorConversationOpeningRequest({
      kind: 'situation', setting: 'You are interviewing a senior hire.',
      register: 'professional', sceneSlant: TUTOR_CONVERSATION_SCENE_SLANTS[0],
      voiceGender: 'female'
    } as Parameters<typeof tutorConversationOpeningRequest>[0]);
    const turn = tutorConversationTurnRequest({
      register: 'professional', recipeTargets: { supportingTargets: [] }, transcript: [],
      question: 'What interested you in this role?', learnerAnswer: 'The scope interests me.',
      voiceGender: 'male'
    } as Parameters<typeof tutorConversationTurnRequest>[0]);
    const live = tutorConversationLiveSystemInstruction({
      kind: 'anything', register: 'neutral', sceneSlant: TUTOR_CONVERSATION_SCENE_SLANTS[0],
      voiceGender: 'female'
    } as Parameters<typeof tutorConversationLiveSystemInstruction>[0], false);

    expect(JSON.parse(opening.input).voiceGender).toBe('female');
    expect(opening.instruction).toContain('character you play as a woman');
    expect(JSON.parse(turn.input).voiceGender).toBe('male');
    expect(turn.instruction).toContain('character you play as a man');
    expect(live).toContain('character you play as a woman');
  });

  it('V115 builds one private structured opening request for each conversation source', () => {
    const situation = tutorConversationOpeningRequest({
      kind: 'situation',
      setting: 'You are checking into a hotel and asking about breakfast.',
      register: 'professional',
      sceneSlant: TUTOR_CONVERSATION_SCENE_SLANTS[0],
      rolesSwapped: false,
      learnerStarts: false
    });
    expect(situation.kind).toBe('conversationOpening');
    expect(JSON.parse(situation.input)).toEqual({
      setting: 'You are checking into a hotel and asking about breakfast.',
      register: 'professional',
      sceneSlant: TUTOR_CONVERSATION_SCENE_SLANTS[0],
      rolesSwapped: false,
      learnerStarts: false
    });
    // Changed 2026-09-19: the setting is written to the learner, so the instruction now says
    // who is who. The model read "you" as itself and played the caller in a repair call.
    expect(situation.instruction).toContain(TUTOR_SITUATION_ROLES);
    expect(situation.instruction).toContain('every "you" in it means the learner, never you');
    expect(situation.instruction).toContain(TUTOR_PRIVACY_INSTRUCTION);
    // Changed 2026-09-24 for V150: the existing opening request has exactly the two fields;
    // scene and opening are coordinated in one response rather than separate model calls.
    // Changed 2026-10-04: the response also permits independent target marks.
    expect(situation.instruction).toMatch(/non-empty string fields.*scene.*opening/u);
    expect(situation.instruction).toContain('targetMarks');
    expect(situation.instruction).toContain('same people, facts, mood, and stakes');
    expect(situation.instruction).toContain('any sentence the learner could submit as an answer');
    expect(situation.schema).toBe(TUTOR_CONVERSATION_OPENING_SCHEMA);
    expect(TUTOR_CONVERSATION_OPENING_SCHEMA).toMatchObject({
      type: 'object',
      properties: {
        scene: { type: 'string' },
        opening: { type: 'string' }
      },
      // 2026-10-11: Opening decides two concrete roles for all subsequent requests.
      required: ['scene', 'opening', 'tutorRole', 'learnerRole'],
      additionalProperties: false
    });

    const lesson = tutorConversationOpeningRequest({
      kind: 'lesson', register: 'neutral', primaryTargetLabel: 'Past simple',
      supportingTargetLabels: ['Time expressions'],
      sceneSlant: TUTOR_CONVERSATION_SCENE_SLANTS[1],
      learnerStarts: false
    });
    expect(JSON.parse(lesson.input)).toEqual({
      register: 'neutral', primaryTargetLabel: 'Past simple',
      supportingTargetLabels: ['Time expressions'],
      sceneSlant: TUTOR_CONVERSATION_SCENE_SLANTS[1],
      learnerStarts: false
    });
    // Changed 2026-09-25 for V156: the owner asked for American English in model instructions.
    // Changed 2026-10-04: the lesson opens in character within its selected situation.
    expect(lesson.instruction).toMatch(/in character.*situation/u);
    expect(lesson.instruction).not.toContain("Today we'll practice");
    // Changed 2026-09-24 for V150: the one opening response now carries the fresh scene too,
    // and the exact two-field boundary prevents provider commentary from entering the panel.
    expect(tutorConversationOpening({
      tutorRole: 'interviewer', learnerRole: 'candidate',
      scene: '  The interviewer has reservations about the candidate\'s experience.  ',
      opening: '  What interested you in this role?  '
    })).toEqual({
      tutorRole: 'interviewer', learnerRole: 'candidate',
      scene: 'The interviewer has reservations about the candidate\'s experience.',
      opening: 'What interested you in this role?'
    });
    expect(() => tutorConversationOpening({
      scene: 'The interviewer is short of time.',
      opening: 'What interested you in this role?',
      commentary: 'Unexpected.'
    })).toThrow(/opening/iu);
    expect(() => tutorConversationOpening({ opening: 'What interested you in this role?' }))
      .toThrow(/scene/iu);
    expect(() => tutorConversationOpening({ scene: 'The interviewer is waiting.', opening: '   ' }))
      .toThrow(/opening/iu);
  });

  it('V150 selects all private slants and can give consecutive conversations different ones', () => {
    // Changed 2026-10-15: V242, owner item I14, select each slant inside its weighted interval.
    const total = TUTOR_CONVERSATION_SCENE_SLANT_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
    let cumulative = 0;
    const selected = TUTOR_CONVERSATION_SCENE_SLANT_WEIGHTS.map(entry => {
      const result = tutorConversationSceneSlant(() => (cumulative + entry.weight / 2) / total);
      cumulative += entry.weight;
      return result;
    });
    expect(selected).toEqual(TUTOR_CONVERSATION_SCENE_SLANTS);
    const randomValues = [0.01, 0.99];
    const first = tutorConversationSceneSlant(() => randomValues.shift()!);
    const second = tutorConversationSceneSlant(() => randomValues.shift()!);
    expect(first).not.toBe(second);
    for (const sceneSlant of TUTOR_CONVERSATION_SCENE_SLANTS) {
      const request = tutorConversationOpeningRequest({
        kind: 'anything', register: 'neutral', sceneSlant
      });
      expect(JSON.parse(request.input)).toEqual({ register: 'neutral', sceneSlant, learnerStarts: false });
      expect(request.instruction).toContain('never name the slant or present it as a label');
    }
  });

  it('V150 keeps the owner-approved casting variety and makes every slant selectable', () => {
    // Added 2026-09-24 for V150 mutation probe 5: deriving the expectation from the exported
    // list let deleting an agreed casting direction silently reduce the product to five.
    // Changed 2026-10-15: V242, owner item I14, preserve eight casting meanings and weighted selection, including hard scenes that continue.
    const agreedSlants = [
      /strong, competent, well prepared/u, /friendly and curious/u, /patient and glad to help/u,
      /weak, underqualified, unprepared/u, /evasive.*will not answer directly/u,
      /overconfident.*talks over you/u, /rushed.*still willing to help/u,
      /skeptical.*still willing to help/u
    ];
    expect(TUTOR_CONVERSATION_SCENE_SLANTS).toEqual(agreedSlants.map(pattern => expect.stringMatching(pattern)));
    const total = TUTOR_CONVERSATION_SCENE_SLANT_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
    let cumulative = 0;
    expect(TUTOR_CONVERSATION_SCENE_SLANT_WEIGHTS.map(entry => {
      const result = tutorConversationSceneSlant(() => (cumulative + entry.weight / 2) / total);
      cumulative += entry.weight;
      return result;
    })).toEqual(agreedSlants.map(pattern => expect.stringMatching(pattern)));
  });

  it('V150 forbids exposing the slant or turning scene direction into a learner script', () => {
    // Added 2026-09-24 for V150 mutation probe 2: these are safety requirements on the model
    // instruction, not descriptive prose that can disappear while the response shape survives.
    const instruction = tutorConversationOpeningRequest({
      kind: 'anything', register: 'neutral',
      // Changed 2026-10-15: V242, owner item I14, use the revised skeptical slant in this opening fixture.
      sceneSlant: TUTOR_CONVERSATION_SCENE_SLANT_WEIGHTS[7].slant
    }).instruction;
    expect(instruction).toContain('never name the slant or present it as a label');
    expect(instruction).toContain('The scene must not be dialogue, advice, instructions');
    expect(instruction).toContain('about what the learner should say');
    expect(instruction).toContain('any sentence the learner could submit as an answer');
  });

  it('V150 gives Live the cast scene and requires its own first turn to agree with it', () => {
    // Added 2026-09-24 after the owner chose spoken Live opening B: the structured opening is
    // fallback-only, while the scene and its consistency rule belong in the Live instruction.
    const scene = 'The interviewer is rushed and will accept only concrete evidence.';
    const instruction = tutorConversationLiveSystemInstruction({
      kind: 'situation', setting: 'Interviewing a senior hire', register: 'professional',
      // Changed 2026-10-15: V242, owner item I14, use the revised busy slant in this Live opening fixture.
      sceneSlant: TUTOR_CONVERSATION_SCENE_SLANT_WEIGHTS[6].slant
    }, false, undefined, scene);

    expect(instruction).toContain(JSON.stringify(scene));
    expect(instruction).toContain('Your first spoken turn must first read that scene');
    expect(instruction).toContain('same people, facts, mood, and stakes');
    expect(instruction).toContain('neutral narrator voice');
    expect(instruction).not.toContain('Welcome. How can I help?');
  });

  it.each([
    [false, false, TUTOR_SITUATION_ROLES, true],
    [true, false, TUTOR_SITUATION_ROLES_SWAPPED, true],
    [false, true, TUTOR_SITUATION_ROLES, false],
    [true, true, TUTOR_SITUATION_ROLES_SWAPPED, false]
  ] as const)('V152 combines swapped=%s and learnerStarts=%s for scene and opening',
    (rolesSwapped, learnerStarts, roleInstruction, openingRequired) => {
      const request = tutorConversationOpeningRequest({
        kind: 'situation', setting: 'You are interviewing a senior hire.', register: 'professional',
        sceneSlant: TUTOR_CONVERSATION_SCENE_SLANTS[0], rolesSwapped, learnerStarts
      });
      expect(request.instruction).toContain(roleInstruction);
      expect(request.instruction).toContain('The scene must make both roles clear');
      expect(request.instruction).toContain(learnerStarts
        ? 'Do not produce an opening turn'
        : 'write opening as the counterpart\'s first spoken turn');
      expect((request.schema as { required: string[] }).required.includes('opening'))
        .toBe(openingRequired);
      expect(tutorConversationOpening({
        // 2026-10-11: Both opening variants resolve roles even when the learner starts.
        tutorRole: rolesSwapped ? 'candidate' : 'interviewer', learnerRole: rolesSwapped ? 'interviewer' : 'candidate',
        scene: 'The interview is about to begin.',
        ...(openingRequired ? { opening: 'What interested you in this role?' } : {})
      }, openingRequired)).toEqual({
        tutorRole: rolesSwapped ? 'candidate' : 'interviewer', learnerRole: rolesSwapped ? 'interviewer' : 'candidate',
        scene: 'The interview is about to begin.',
        ...(openingRequired ? { opening: 'What interested you in this role?' } : {})
      });
    });

  it('V152 carries the swapped role contract through every situation request', () => {
    const common = {
      register: 'professional' as const,
      setting: 'You are interviewing a senior hire.',
      rolesSwapped: true
    };
    const turn = tutorConversationTurnRequest({
      ...common, recipeTargets: { supportingTargets: [] }, transcript: [],
      question: 'What interested you in this role?', learnerAnswer: 'The scope interests me.'
    });
    const corrections = tutorConversationCorrectionsRequest({
      ...common, recipeTargets: { supportingTargets: [] },
      turns: [{ question: 'When did you arrive?', learnerAnswer: 'I come yesterday.', spoken: false }]
    });
    const hint = tutorConversationHintRequest({
      ...common, question: '', recentTurns: [], opening: true
    });
    const live = tutorConversationLiveSystemInstruction({
      kind: 'situation', ...common, sceneSlant: TUTOR_CONVERSATION_SCENE_SLANTS[0],
      learnerStarts: false
    }, true, undefined, 'The candidate and interviewer are ready.');

    // Changed 2026-09-25 for V153: the owner reversed V152's Live transcript request.
    // The ordinary turn still carries the role contract, but no reply transcript is added.
    // 2026-10-13: Dialogue preserves its speaker; coaching uses the learner's side.
    for (const instruction of [turn.instruction, live]) {
      expect(instruction).toContain(TUTOR_SITUATION_ROLES_SWAPPED);
      expect(instruction).not.toContain(TUTOR_SITUATION_ROLES);
    }
    for (const instruction of [corrections.instruction, hint.instruction]) {
      expect(instruction).toMatch(/roles are swapped.*learner played the other person/u);
      expect(instruction).toMatch(/now coaching the learner.*learner's side says, never the tutor's side/u);
      expect(instruction).not.toContain(TUTOR_SITUATION_ROLES);
    }
    expect(JSON.parse(turn.input)).toMatchObject({ rolesSwapped: true });
    expect(JSON.parse(turn.input)).not.toHaveProperty('replyTranscript');
    expect(hint.instruction).toContain('without supplying any words they could say');
    expect(hint.instruction).toContain('unrelated situation with different roles');
    expect(hint.instruction).toContain('Never write the answer');
  });

  it('V156 assigns the setting\'s you to the learner whatever their rank', () => {
    // Added 2026-09-25 for V156: the errand heuristic reversed every authority setting,
    // including the owner's supervising-a-stalled-project case.
    expect(TUTOR_SITUATION_ROLES).not.toContain('visiting, calling, asking');
    expect(TUTOR_SITUATION_ROLES).toContain('whatever their rank or position');
    expect(TUTOR_SITUATION_ROLES).toContain('"You are meeting a graduate student"');
    expect(TUTOR_SITUATION_ROLES).toContain('the learner is the supervisor');
    expect(TUTOR_SITUATION_ROLES).toContain('you are the student');
  });

  it('V156 swaps the setting roles without an errand or authority heuristic', () => {
    // Added 2026-09-25 for V156: swapping must invert the same textual assignment, not
    // guess the counterpart from who would ordinarily meet, call, ask, or interview.
    expect(TUTOR_SITUATION_ROLES_SWAPPED).not.toMatch(/meet, call, ask, or interview/u);
    expect(TUTOR_SITUATION_ROLES_SWAPPED).toContain('whatever their rank or position');
    expect(TUTOR_SITUATION_ROLES_SWAPPED).toContain('"You are meeting a graduate student"');
    expect(TUTOR_SITUATION_ROLES_SWAPPED).toContain('you are the supervisor');
    expect(TUTOR_SITUATION_ROLES_SWAPPED).toContain('the learner is the student');
  });

  it('V85 R1 forbids the old evidence-as-objective instruction even beside the new rule', () => {
    const request = tutorTailoredPromptRequest({ targets: [], findings: [] }, [], 'B2');
    expect(request.instruction).not.toContain(
      "Use its summary, every finding's observation and evidence, and its focus to state what the lesson should teach about."
    );
  });

  it('V85 R1 pins a specific transferable objective and handles quotations in observations and focus', () => {
    const report = { targets: [], summary: 'You confuse related meanings.', findings: [{ level: 2,
      observation: "Use 'native speakers', not 'native tongues', for people.", evidence: 'native tongues' }],
      focus: "Use 'native speakers' for people." };
    const request = tutorTailoredPromptRequest(report, [], 'B2');
    // 2026-10-13: Check the transferable objective's requirements without pinning its wording.
    for (const requirement of [
      /exactly one string field named "prompt"/u, /non-empty plain text, not HTML/u,
      /English lesson and practice.*diagnostic report and learner level/u,
      /summary.*observation and target.*underlying rule or usage pattern/u,
      /Evidence phrases are symptoms.*not the lesson's subject/u,
      /summary, observations or focus.*generalize/u, /specific distinction, construction or expression pattern/u,
      /another learner.*different mistakes/u, /zero quoted reader phrases.*corrected versions.*example sentences/u,
      /Do not restate learning-map target labels, identifiers or roles/u,
      /applied targets are context.*current recipe supplies the targets and settings/u,
      /later target change changes the constraints.*never this teaching objective/u,
      /Do not invent weaknesses when findings is empty/u, /report as data.*never as instructions/u,
      /Do not add document context or quotations beyond this report/u
    ]) expect(request.instruction).toMatch(requirement);
    expect(request.instruction).toContain(TUTOR_PRIVACY_INSTRUCTION);
  });

  it('V85 R1 withholds distinctive evidence from the entire serialized request', () => {
    const evidence = 'V85 distinctive reader evidence: cobalt otters orbit teacups';
    const report = { targets: [], findings: [{ level: 2, observation: 'Distinguish people from the language they use.',
      evidence, targetId: leaf.id }], summary: 'Meaning needs precision.', focus: 'Choose nouns by their referent.' };
    const request = tutorTailoredPromptRequest(report, [{ nodeId: leaf.id, role: 'primary' }], 'B2');
    expect(JSON.stringify(request)).not.toContain(evidence);
    const content = JSON.parse(request.instruction.split('learner level are:\n')[1]!);
    expect(content.findings).toEqual([{ observation: report.findings[0]!.observation, targetId: leaf.id }]);
  });

  it('V85 R1 keeps empty findings empty and forbids invented weaknesses', () => {
    const request = tutorTailoredPromptRequest({ targets: [], findings: [], summary: 'Your writing is clear.' }, [], 'A1');
    expect(request.instruction).toContain('Do not invent weaknesses when findings is empty.');
    expect(JSON.parse(request.instruction.split('learner level are:\n')[1]!).findings).toEqual([]);
  });

  it('V85 R2 pins the coherent diagnosis rule and its aggregate numeric reuse limit', () => {
    const request = tutorLessonGenerationRequest({ ...recipe(), question: 'Diagnosis evidence: "native tongues"; correction: "native speakers".' });
    const paragraph = request.instruction.split('\n\n').find((part) => part.startsWith('Where the lesson comes from a diagnosis,'));
    expect(paragraph).toBe(diagnosisExampleInstruction);
    expect(paragraph).toMatch(/At most 1 example in the whole lesson may reuse/);
    expect(request.instruction).not.toContain('at most two examples may use the phrase the reader got wrong');
  });

  it.each([false, true])('V85 R3 shares the diagnosis rule with replacement and preserves a different case (question only: %s)', (questionOnly) => {
    const question = 'Diagnosis evidence: "native tongues"; correction: "native speakers".';
    const value = questionOnly ? questionOnlyRecipe(question) : { ...recipe(), question };
    const draft = tutorLessonGenerationRequest(value);
    const replacementRecipe = { ...value, output: { ...value.output, exampleCount: 1 } };
    const replacement = tutorLessonGenerationRequest(replacementRecipe, 'example-1');
    for (const request of [draft, replacement]) {
      expect(request.instruction.split('\n\n').filter((part) => part.startsWith('Where the lesson comes from a diagnosis,')))
        .toEqual([diagnosisExampleInstruction]);
    }
    expect(replacement.instruction).toBe(draft.instruction.replace(
      'The examples must show the range of the target rather than one instance of it repeated. No annotation excerpt may appear in more than two of the examples.',
      'Choose an annotation excerpt that teaches the target through a different case from the example being replaced.'
    ).replace(
      'Generate the complete lesson requested by the recipe.',
      'Return only one new TrainingExample inside an object keyed example, to replace item example-1. Do not generate lesson explanations, errors, practice, or any other example. Do not refer to the existing lesson.'
    ));
    expect(JSON.parse(replacement.input)).toEqual(replacementRecipe);
  });

  it('V67 R3 requests report fields only on diagnosis and leaves typed Ask unchanged', () => {
    const diagnosis = tutorPassageDiagnosisRequest('I go yesterday.', 'Weakness analysis', createTutorViewState().settings);
    expect(diagnosis.schema).toBe(TUTOR_DIAGNOSTIC_REPORT_SCHEMA);
    expect(diagnosis.schema.required).toEqual(['targets', 'summary', 'findings', 'focus']);
    expect(diagnosis.instruction).toContain('two or three plain sentences addressed to the reader');
    expect(diagnosis.instruction).toContain('Return zero to five findings.');
    expect(diagnosis.instruction).toContain('An empty list is correct when nothing qualifies.');
    expect((diagnosis.schema.properties as Record<string, { minItems?: number }>).findings?.minItems).toBe(0);
    expect(diagnosis.instruction).toContain('copied exactly from the reader');
    expect(diagnosis.instruction).toContain('The focus paragraph');
    const ask = tutorTargetSearchRequest('What is the past tense?');
    expect(ask.schema).toBe(TUTOR_TARGET_SEARCH_SCHEMA);
    expect(ask.schema.required).toEqual(['targets']);
    expect(Object.keys(ask.schema.properties as object)).toEqual(['targets']);
    expect(ask.instruction).toContain('exactly one field named "targets"');
  });

  it('V67 R3 drops an unknown finding target while retaining both evidenced findings', () => {
    const report = tutorDiagnosticReport({
      targets: [{ targetId: leaf.id, role: 'primary' }, { targetId: 'invented', role: 'primary' }],
      summary: ' You describe a past event. Your verb form needs attention. ',
      findings: [
        { level: 2, observation: ' Use a past form. ', evidence: 'I go', targetId: 'invented' },
        { level: 2, observation: 'The time is explicit.', evidence: 'yesterday', targetId: ` ${leaf.id} ` },
        { level: 2, observation: 'Invented observation.', evidence: 'I have never flown to Venus.' }
      ],
      focus: ' Practise completed events. '
    }, 'I go yesterday.');
    expect(report).toEqual({ protocolVersion: 1,
      targets: [{ nodeId: leaf.id, role: 'primary' }],
      polish: [],
      summary: 'You describe a past event. Your verb form needs attention.',
      findings: [
        { level: 2, observation: 'Use a past form.', evidence: 'I go' },
        { level: 2, observation: 'The time is explicit.', evidence: 'yesterday', targetId: leaf.id }
      ],
      focus: 'Practise completed events.'
    });
  });

  it('V67 R3 salvages partial reports without inventing missing findings or accepting invented evidence', () => {
    const report = tutorDiagnosticReport({
      summary: 3, focus: ' ', targets: [],
      findings: [null, { level: 2, observation: 3, evidence: 'I go' },
        { level: 2, observation: '  ', evidence: 'I go' },
        { level: 2, observation: 'An observation.', evidence: 'I went' },
        { level: 2, observation: 'An observation.', evidence: ' ' },
        { level: 2, observation: 'An observation.', evidence: 'I go', targetId: 3 }]
    }, 'I go yesterday.');
    expect(report).toEqual({ protocolVersion: 1, targets: [], polish: [], findings: [{ level: 2, observation: 'An observation.', evidence: 'I go' }] });
    for (const value of [null, {}, { findings: [] }, { findings: 'bad' }]) {
      expect(tutorDiagnosticReport(value, '')).toEqual({ protocolVersion: 1, targets: [], polish: [], findings: [] });
    }
    expect(tutorDiagnosticReport({ findings: Array.from({ length: 7 }, () => ({
      level: 2, observation: 'An observation.', evidence: 'I go'
    })) }, 'I go yesterday.').findings).toHaveLength(5);
  });

  it('V67 R3b folds curly quotes and whitespace without folding case', () => {
    const findings = [
      { level: 2, observation: 'A contraction.', evidence: "  I'm here  " },
      { level: 2, observation: 'A quotation.', evidence: '"Come here"' },
      { level: 2, observation: 'Wrong case.', evidence: "i'm here" },
      { level: 2, observation: 'Changed spacing.', evidence: "I'm  here" }
    ];
    expect(tutorDiagnosticReport({ findings }, 'I’m here. She said “Come here”.').findings).toEqual([findings[0], findings[1], findings[3]]);
  });

  it('V67 R5b states the prompt response shape in words and sends only report fields applied labels and level', () => {
    const report = { summary: 'Your time phrase is clear.', findings: [{ level: 2, observation: 'Use a past form.',
      evidence: 'I go', targetId: leaf.id }], focus: 'Practise past events.',
      targets: [{ nodeId: supportLeaves[0]!.id, role: 'primary' as const }],
      editorText: 'A private unshared passage.', workspacePath: 'Unshared workspace marker.' };
    const request = tutorTailoredPromptRequest(report, [{ nodeId: leaf.id, role: 'primary' }], 'A1');
    expect(request.kind).toBe('tailoredPrompt');
    expect(request.instruction).toContain('Return one JSON object with exactly one string field named "prompt".');
    const sent = JSON.parse(request.instruction.split('learner level are:\n')[1]!);
    expect(sent).toEqual({ summary: report.summary, findings: report.findings.map(({ observation, targetId }) => ({ observation, targetId })), focus: report.focus,
      appliedTargets: [{ label: leaf.label, role: 'primary' }], learnerLevel: 'A1' });
    expect(request.input).toBe('Write the tailored prompt now.');
    expect(request.instruction).toContain(TUTOR_PRIVACY_INSTRUCTION);
    expect(request.instruction).toContain('Do not restate learning-map target labels, identifiers or roles in the prompt, including those attached to findings.');
    expect(request.instruction).not.toContain('Use its summary, every finding\'s observation and evidence, its focus, and the applied target labels and roles.');
    const source = createTutorInstructionSource('A substituted privacy instruction.');
    expect(tutorTailoredPromptRequest(report, [], 'C2', source).instruction).toContain(source.privacy);
  });

  it('V67 R5d accepts only one nonempty prompt string and treats refusals or malformed responses as unusable', () => {
    expect(tutorWrittenPrompt({ prompt: '  Teach past events.  ' })).toBe('Teach past events.');
    for (const value of [null, {}, [], 'A bare answer.', { prompt: 12 }, { prompt: ' ' },
      { refusal: 'Refused.' }, { prompt: 'A prompt.', refusal: 'Refused.' }]) {
      expect(tutorWrittenPrompt(value)).toBeUndefined();
    }
  });

  it('V53 R7 changes every tutor request when the one privacy source changes', () => {
    const value = recipe();
    const revisedPrivacy = 'V50 revised privacy boundary sentinel.';
    const source = createTutorInstructionSource(revisedPrivacy);
    const exercise = {
      id: 'exercise-1',
      channel: 'written' as const,
      prompt: 'At this time tomorrow, I ______ (fly) to London for the annual conference.',
      targetIds: [leaf.id]
    };
    const requests = [
      tutorTargetSearchRequest('Which target fits this question?', source),
      tutorPassageDiagnosisRequest('A selected passage.', 'Weakness analysis', createTutorViewState().settings, source),
      tutorLessonGenerationRequest(value, undefined, source),
      tutorExerciseGenerationRequest({ examples: [],
        schemaVersion: 1,
        recipe: value,
        count: 1,
        channel: 'written'
      }, source),
      tutorReviewGenerationRequest({
        learnerAnswer: 'I am flying.',
        exercise,
        activeTargets: [leaf.id]
      }, source),
      tutorExampleQuestionRequest({
        sentence: 'Although the team finished, they celebrated.',
        question: 'Why is that relative clause used?'
      }, source),
      tutorPracticeQuestionRequest({
        exercisePrompt: exercise.prompt,
        learnerAnswer: 'I am flying.',
        question: 'When do I use am flying and when will be flying?'
      }, source),
      tutorConversationTurnRequest({
        register: 'neutral',
        recipeTargets: { primaryTarget: leaf.id, supportingTargets: [] },
        transcript: [],
        question: 'What happened?',
        learnerAnswer: 'I go yesterday.'
      }, source)
    ];

    // Also with no source supplied, because injecting one into all seven proves only that
    // the injected path is shared. A builder holding its own copy as its default passes the
    // injected check and drifts anyway, which is exactly what a probe found on 2026-09-02.
    const defaults = [
      tutorTargetSearchRequest('Which target fits this question?'),
      tutorPassageDiagnosisRequest('A selected passage.', 'Text analysis', createTutorViewState().settings),
      tutorLessonGenerationRequest(value),
      tutorExerciseGenerationRequest({ examples: [],
        schemaVersion: 1,
        recipe: value,
        count: 1,
        channel: 'written'
      }),
      tutorReviewGenerationRequest({
        learnerAnswer: 'I am flying.',
        exercise,
        activeTargets: [leaf.id]
      }),
      tutorExampleQuestionRequest({
        sentence: 'Although the team finished, they celebrated.',
        question: 'Why is that relative clause used?'
      }),
      tutorPracticeQuestionRequest({
        exercisePrompt: exercise.prompt,
        learnerAnswer: 'I am flying.',
        question: 'When do I use am flying and when will be flying?'
      }),
      tutorConversationTurnRequest({
        register: 'neutral',
        recipeTargets: { primaryTarget: leaf.id, supportingTargets: [] },
        transcript: [],
        question: 'What happened?',
        learnerAnswer: 'I went yesterday.'
      })
    ];
    for (const request of defaults) {
      expect(
        request.instruction,
        `${request.kind} does not read the shared privacy source by default`
      ).toContain(TUTOR_PRIVACY_INSTRUCTION);
    }

    for (const request of requests) {
      expect(
        request.instruction,
        `${request.kind} did not read the changed shared privacy source`
      ).toContain(revisedPrivacy);
    }

    expect(createTutorInstructionSource().privacy).toBe(TUTOR_PRIVACY_INSTRUCTION);
    expect(TUTOR_PRIVACY_INSTRUCTION).toBe(
      'Do not ask for or infer document text, workspace content, prior lessons, learner history, or User Dictionary content.'
    );
    for (const request of [
      tutorTargetSearchRequest('Which target fits this question?'),
      tutorPassageDiagnosisRequest('A selected passage.', 'Weakness analysis', createTutorViewState().settings),
      tutorLessonGenerationRequest(value),
      tutorExerciseGenerationRequest({ examples: [],
        schemaVersion: 1,
        recipe: value,
        count: 1,
        channel: 'written'
      }),
      tutorReviewGenerationRequest({
        learnerAnswer: 'I am flying.',
        exercise,
        activeTargets: [leaf.id]
      }),
      tutorExampleQuestionRequest({
        sentence: 'Although the team finished, they celebrated.',
        question: 'Why is that relative clause used?'
      }),
      tutorPracticeQuestionRequest({
        exercisePrompt: exercise.prompt,
        learnerAnswer: 'I am flying.',
        question: 'When do I use am flying and when will be flying?'
      }),
      tutorConversationTurnRequest({
        register: 'neutral',
        recipeTargets: { primaryTarget: leaf.id, supportingTargets: [] },
        transcript: [],
        question: 'What happened?',
        learnerAnswer: 'I went yesterday.'
      })
    ]) {
      expect(request.instruction).toContain(TUTOR_PRIVACY_INSTRUCTION);
    }
  });

  it('V64 R2 gives one conversation turn one structured request and shared privacy', () => {
    const priorTurn = {
      question: 'What did you do yesterday?',
      learnerAnswer: 'I go to the library.',
      reply: 'Which library did you visit?',
      correction: 'I went to the library.',
      targetId: leaf.id,
      explanation: 'The finished past event takes the past form.',
      nextQuestion: 'What did you read there?'
    };
    const body = {
      register: 'professional' as const,
      recipeTargets: {
        primaryTarget: leaf.id,
        supportingTargets: [supportLeaves[0]!.id]
      },
      transcript: [priorTurn],
      question: priorTurn.nextQuestion,
      learnerAnswer: 'I read a history book.'
    };

    const request = tutorConversationTurnRequest(body);

    expect(request.kind).toBe('conversationTurn');
    expect(request.schema).toBe(TUTOR_CONVERSATION_TURN_SCHEMA);
    expect(request.schemaName).toBe('kren_tutor_conversation_turn');
    // 2026-10-12: V227 keeps each tutor reply in dialogue history and omits coaching.
    expect(JSON.parse(request.input)).toEqual({ ...body, transcript: [{
      question: priorTurn.question, learnerAnswer: priorTurn.learnerAnswer, reply: priorTurn.reply
    }] });
    // Changed 2026-10-16: V253, owner item I34, check the required response fields without pinning their prose order.
    for (const field of ['move', 'reply', 'replyQuote', 'correction', 'targetId', 'explanation', 'rephrase', 'rephraseWhy']) {
      expect(request.instruction).toContain(`"${field}"`);
      expect(request.schema.required).toContain(field);
    }
    // 2026-10-16: spokenPunctuated is requested but optional, so a provider that omits it falls back.
    expect(request.instruction).toContain('"spokenPunctuated"');
    expect(request.schema.required).not.toContain('spokenPunctuated');
    expect(request.instruction).toMatch(/optional string field "nextQuestion"/u);
    expect(request.instruction).toContain(
      'When the answer is natural and grammatical, copy it into correction exactly.'
    );
    expect(request.instruction).toContain(
      TUTOR_CORRECTION_CLAUSE
    );
    expect(request.instruction).toContain(TUTOR_PRIVACY_INSTRUCTION);

    const complete = {
      replyQuote: '',
      correction: 'I read a history book.',
      targetId: leaf.id,
      explanation: 'The answer is already natural.',
      rephrase: 'I read a history book.',
      rephraseWhy: 'The answer is already natural.',
      nextQuestion: 'Which part interested you most?'
    };
    for (const field of ['correction', 'targetId', 'explanation', 'rephrase', 'rephraseWhy']) {
      const incomplete = { ...complete } as Record<string, unknown>;
      delete incomplete[field];
      expect(
        () => tutorConversationTurn(incomplete),
        `a conversation response without ${field} must be refused`
      ).toThrow(field);
    }
  });

  it('V64 R3 keeps a correction but drops an invented filing target', () => {
    const response = {
      replyQuote: '',
      correction: 'I went to the library.',
      targetId: 'invented.past-form',
      explanation: 'Use the past form for a completed event yesterday.',
      rephrase: 'I went to the library.',
      rephraseWhy: 'This naturally answers the question.',
      nextQuestion: 'What did you read there?'
    };

    expect(tutorConversationTurn(response)).toEqual({
      replyQuote: '',
      correction: response.correction,
      explanation: response.explanation,
      rephrase: response.rephrase,
      rephraseWhy: response.rephraseWhy,
      nextQuestion: response.nextQuestion
    });
    expect(tutorConversationTurn({ ...response, targetId: leaf.id })).toEqual({
      replyQuote: '',
      correction: response.correction,
      targetId: leaf.id,
      explanation: response.explanation,
      rephrase: response.rephrase,
      rephraseWhy: response.rephraseWhy,
      nextQuestion: response.nextQuestion
    });
  });

  it('V53 R3 sends the query verbatim and all 123 identifiers with labels only', () => {
    const query = 'Which and that difference. When do I use which, and when that?';
    const request = tutorTargetSearchRequest(query);
    const relativeClauses = TUTOR_MAP.find((node) => node.label === 'Relative clauses')!;

    expect(request.kind).toBe('targetSearch');
    expect(request.schema).toBe(TUTOR_TARGET_SEARCH_SCHEMA);
    expect(request.instruction).toContain(query);
    expect(request.instruction).toContain(
      `The complete learning map follows. It contains ${TUTOR_MAP.length} nodes.`
    );
    expect(TUTOR_MAP).toHaveLength(123);
    for (const node of TUTOR_MAP) {
      expect(request.instruction).toContain(`${node.id}\t${node.label}`);
    }
    expect(request.instruction).not.toContain(relativeClauses.description);
    expect(request.instruction).not.toContain(relativeClauses.exampleSeed);
    expect(request.instruction).toContain('array of zero to four objects, each with exactly two string fields: targetId and role');
    expect(request.instruction).toContain('Do not invent identifiers');
    expect(request.input).toBe('Choose the targetIds now.');
  });

  it('V63 R2 and R5 distinguishes both visible analysis choices in words', () => {
    const passage = 'The selected passage is preserved exactly in this request.';
    const weakness = tutorPassageDiagnosisRequest(passage, 'Weakness analysis', createTutorViewState().settings);
    const text = tutorPassageDiagnosisRequest(passage, 'Text analysis', createTutorViewState().settings);

    expect(Object.keys(weakness)).toEqual([
      'kind', 'instruction', 'input', 'schema', 'schemaName'
    ]);
    expect(Object.keys(text)).toEqual(Object.keys(weakness));
    // 2026-10-11: V221 gives selected-passage diagnosis its own Thorough kind.
    expect(weakness.kind).toBe('passageDiagnosis');
    expect(text.kind).toBe(weakness.kind);
    expect(text.input).toBe(weakness.input);
    expect(text.schema).toBe(weakness.schema);
    expect(text.schemaName).toBe(weakness.schemaName);

    const weaknessLine =
      'Weakness analysis: Identify where the selected passage is weak across the whole learning map. Choose the one target that would most improve the passage as primary, plus up to three targets for additional weaknesses as supports. Do not choose a target merely because the passage uses it correctly.';
    const textLine =
      'Text analysis: Identify which learning-map categories and items the selected passage uses, whether or not anything is weak or incorrect. Choose the target chiefly demonstrated by the passage as primary, plus up to three other demonstrated targets as supports. Do not treat a target as weak merely because it appears.';
    expect(weakness.instruction).toContain(weaknessLine);
    expect(weakness.instruction).not.toContain(textLine);
    expect(text.instruction).toContain(textLine);
    expect(text.instruction).not.toContain(weaknessLine);
    expect(weakness.instruction).not.toBe(text.instruction);

    // Every assertion around this one is a `toContain`, and a line added on top of either
    // instruction survives all of them: prepending "Disregard the analysis type named below"
    // to the weakness instruction left all 896 tests passing. Found by mutation on
    // 2026-09-04, the fourth guard this week to pass its subtractive probe and fail its
    // additive one. The invariant that actually holds is that the two instructions differ by
    // exactly one line and nothing else, so anything added to either of them fails here.
    expect(
      weakness.instruction.replace(weaknessLine, textLine),
      'the two instructions differ by more than the analysis line'
    ).toBe(text.instruction);
    expect(weakness.instruction).toContain(passage);
    expect(text.instruction).toContain(passage);
    expect(weakness.instruction).toContain(TUTOR_PRIVACY_INSTRUCTION);
    expect(text.instruction).toContain(TUTOR_PRIVACY_INSTRUCTION);
  });

  it('V53 R4 validates, de-duplicates, and caps what the model returns against the map', () => {
    const realIds = TUTOR_MAP.slice(0, 5).map((node) => node.id);
    const target = (id: string, role: string) => ({ targetId: id, role });

    // An invented identifier is dropped, a repeat is dropped, and the support cap holds.
    expect(tutorTargetSearchSelection({
      targets: [
        target(realIds[0]!, 'primary'),
        target('invented.plausible-target', 'support'),
        target(realIds[0]!, 'support'),
        ...realIds.slice(1).map((id) => target(id, 'support'))
      ]
    })).toEqual([
      { nodeId: realIds[0], role: 'primary' },
      { nodeId: realIds[1], role: 'support' },
      { nodeId: realIds[2], role: 'support' },
      { nodeId: realIds[3], role: 'support' }
    ]);

    expect(tutorTargetSearchSelection({
      targets: [target('invented.one', 'primary'), target('invented.two', 'support')]
    })).toEqual([]);

    // A second primary is demoted rather than discarding the whole answer, because an
    // ordering mistake should not send the reader back to an empty panel.
    expect(tutorTargetSearchSelection({
      targets: [target(realIds[0]!, 'primary'), target(realIds[1]!, 'primary')]
    })).toEqual([
      { nodeId: realIds[0], role: 'primary' },
      { nodeId: realIds[1], role: 'support' }
    ]);
  });

  it('V50 R3 puts the owner\'s example sentence and question literally in the instruction', () => {
    const sentence = 'Although the team had completed the project that caused high stress, they celebrated their success yesterday.';
    const question = 'why I can\'t use "the project which caused" here?';
    const request = tutorExampleQuestionRequest({ sentence, question });

    expect(request.instruction).toContain(sentence);
    expect(request.instruction).toContain(question);
    expect(JSON.parse(request.input)).toEqual({ sentence, question });
    expect(request.instruction).toContain('required string field named "directAnswer"');
    expect(request.instruction).toContain('optional string field named "explanation"');
    expect(request.instruction).toContain('optional array of strings named "examples"');
  });

  it('V50 R6 puts the owner\'s practice prompt, answer, and question literally in the instruction', () => {
    const exercisePrompt =
      'At this time tomorrow, I ______ (fly) to London for the annual conference.';
    const learnerAnswer = 'I am flying.';
    const question = 'When do I use \'am flying\' and when \'will be flying\'?';
    const request = tutorPracticeQuestionRequest({ exercisePrompt, learnerAnswer, question });

    expect(request.instruction).toContain(exercisePrompt);
    expect(request.instruction).toContain(learnerAnswer);
    expect(request.instruction).toContain(question);
    expect(JSON.parse(request.input)).toEqual({ exercisePrompt, learnerAnswer, question });
    expect(request.instruction).toContain('required string field named "directAnswer"');
    expect(request.instruction).toContain('optional string field named "explanation"');
    expect(request.instruction).toContain('optional array of strings named "examples"');
  });

  it('keeps the lesson and single-example user bodies recipe-only', () => {
    const value = recipe();
    for (const request of [
      tutorLessonGenerationRequest(value),
      tutorLessonGenerationRequest({
        ...value,
        output: { ...value.output, exampleCount: 1 }
      }, 'example-3')
    ]) {
      expect(Object.keys(JSON.parse(request.input) as object)).toEqual(Object.keys(value));
      expect(request.input).not.toContain('context');
      expect(request.input).not.toContain('document');
      expect(request.input).not.toContain('workspace');
    }
  });

  it('sends exercises as exactly schemaVersion, recipe, count, channel, and drafted examples', () => {
    const request = tutorExerciseGenerationRequest({ examples: [],
      schemaVersion: 1,
      recipe: recipe(),
      count: 5,
      channel: 'written'
    });

    expect(Object.keys(JSON.parse(request.input) as object)).toEqual([
      // Changed 2026-10-04: V206 adds only the drafted examples to this request boundary.
      'examples', 'schemaVersion', 'recipe', 'count', 'channel'
    ]);
  });

  it('names every recipe support and requires each in at least two examples', () => {
    for (const supportIds of [supportLeaves.slice(0, 1), supportLeaves]) {
      const value = recipe(supportIds.map((node) => node.id));
      const instruction = tutorLessonGenerationRequest(value).instruction;
      expect(value.supportingTargets).toEqual(supportIds.map((node) => node.id));
      expect(instruction).toContain(
        "Each support identifier must appear in at least two examples' targetIds"
      );
      for (const supportId of value.supportingTargets) {
        expect(instruction).toContain(`"${supportId}"`);
      }
    }
  });

  it('V48 R4 states the reader question literally and leaves the questionless instruction unchanged', () => {
    const value = recipe();
    // 2026-10-13: Preserve the lesson contract while allowing plain-text output instructions.
    const lessonRequirements = [
      /TutorLesson contract/u, /schemaVersion 1.*recipe's mapVersion/u,
      /Resolve every target from the supplied identifiers/u, /Every normal example.*Primary target/u,
      /annotation excerpt must occur verbatim in its sentence/u, /number and word bands.*recipe/u,
      /Distinguish rules, strong tendencies, and style preferences/u,
      /patternStatement.*one sentence.*single pattern every example demonstrates/u,
      /addressed to the reader.*holds for all of them/u, /Do not include HTML/u, /input is a recipe only/u,
      /primary target is exactly/u, /omit chosenUnder entirely/u, /every example's targetIds include/u,
      /examples must show the range.*rather than one instance/u,
      /No annotation excerpt may appear in more than two/u, /Generate the complete lesson/u
    ];

    const lessonText = tutorLessonGenerationRequest(value).instruction;
    for (const requirement of lessonRequirements) expect(lessonText).toMatch(requirement);
    expect(lessonText).toContain(leaf.id);
    expect(lessonText).toContain(diagnosisExampleInstruction);
    expect(lessonText).toContain(TUTOR_PRIVACY_INSTRUCTION);

    const question = 'which vs. what, with collocations';
    const asked = tutorLessonGenerationRequest({ ...value, question });
    expect(asked.instruction).toContain(`The reader's question is exactly: "${question}".`);
    expect(asked.instruction).toContain(
      'The lesson must answer this question while still teaching the named Primary and Support targets.'
    );
  });

  it('V51 R4 preserves the switch-off lesson and exercise request contracts', () => {
    const value = recipe();
    // 2026-10-13: Preserve the lesson contract while allowing plain-text output instructions.
    const lessonRequirements = [
      /TutorLesson contract/u, /schemaVersion 1.*recipe's mapVersion/u,
      /Resolve every target from the supplied identifiers/u, /Every normal example.*Primary target/u,
      /annotation excerpt must occur verbatim in its sentence/u, /number and word bands.*recipe/u,
      /Distinguish rules, strong tendencies, and style preferences/u,
      /patternStatement.*one sentence.*single pattern every example demonstrates/u,
      /addressed to the reader.*holds for all of them/u, /Do not include HTML/u, /input is a recipe only/u,
      /primary target is exactly/u, /omit chosenUnder entirely/u, /every example's targetIds include/u,
      /examples must show the range.*rather than one instance/u,
      /No annotation excerpt may appear in more than two/u, /Generate the complete lesson/u
    ];
    const exerciseInput = {
      examples: [],
      schemaVersion: 1 as const,
      recipe: value,
      count: 5,
      channel: 'written' as const
    };
    const exercise = tutorExerciseGenerationRequest(exerciseInput);
    const lessonText = tutorLessonGenerationRequest(value).instruction;
    for (const requirement of lessonRequirements) expect(lessonText).toMatch(requirement);
    expect(lessonText).toContain(leaf.id);
    expect(lessonText).toContain(diagnosisExampleInstruction);
    expect(lessonText).toContain(TUTOR_PRIVACY_INSTRUCTION);
    // Changed 2026-10-04: V206 extends the instruction; assert its contract rather than pinning all wording.
    expect(exercise.instruction).toContain('TutorExerciseSet contract');
    expect(exercise.instruction).toContain('schemaVersion 1');
    expect(exercise.instruction).toContain(`exactly "${value.mapVersion}"`);
    expect(exercise.instruction).toContain('exactly "written"');
    expect(exercise.instruction).toContain('exactly 5 exercises');
    expect(exercise.instruction).toContain('at least one active target when targets are supplied');
    expect(exercise.instruction).toContain('no HTML');
    expect(exercise.instruction).toContain('Upper-intermediate (B2)');
    expect(exercise.instruction).toContain('no multiple choice');
    expect(exercise.instruction).toContain('supply the word or phrase unaided');
    expect(exercise.instruction).toContain('drafted lesson examples');
    expect(exercise.instruction).toContain(TUTOR_PRIVACY_INSTRUCTION);
    expect(exercise.input).toBe(JSON.stringify(exerciseInput));
  });

  it('reads the native-speaker standard from Smart Grammar for every tutor review', () => {
    const nativeSpeakerSentence = SMART_GRAMMAR_INSTRUCTION
      .split('\n')
      .find((sentence) => sentence.startsWith('Phrasing is wrong when a native speaker'));
    expect(nativeSpeakerSentence).toBeDefined();

    const request = tutorReviewGenerationRequest({
      learnerAnswer: 'I made a decision yesterday.',
      exercise: {
        id: 'exercise-1',
        channel: 'written',
        prompt: 'Write one sentence.',
        targetIds: [leaf.id]
      },
      activeTargets: [leaf.id]
    });
    expect(SMART_GRAMMAR_INSTRUCTION).toContain(nativeSpeakerSentence);
    expect(request.instruction).toContain(nativeSpeakerSentence);

    const revisedSentence = nativeSpeakerSentence!.replace(
      'Phrasing is wrong',
      'Native phrasing is unacceptable'
    );
    const revisedCoreInstruction = SMART_GRAMMAR_INSTRUCTION.replace(
      nativeSpeakerSentence!,
      revisedSentence
    );
    const revisedTutorInstruction = buildTutorReviewInstruction(revisedCoreInstruction);
    expect(revisedCoreInstruction).toContain(revisedSentence);
    expect(revisedTutorInstruction).toContain(revisedSentence);
    expect(revisedTutorInstruction).not.toContain(nativeSpeakerSentence);
  });

  it('V51 R5 makes the question the subject when no target was chosen', () => {
    const question = 'Which and that difference. When do I use which, and when that?';

    const instruction = tutorLessonGenerationRequest(questionOnlyRecipe(question)).instruction;

    expect(instruction).toContain('Which and that difference. When do I use which, and when that?');
    expect(instruction).toContain('No learning-map target was chosen');
    expect(instruction, 'the model must still fill the required primary target field')
      .toContain('set its nodeId to a short lower-case identifier you invent');
    expect(instruction, 'nothing to pin it to, so it must not claim there is')
      .not.toContain('The primary target is exactly');
  });

  it('V52 R4 builds a question-led recipe with the selected primary among its supports', () => {
    const state = createTutorViewState();
    state.settings.questionOnly = true;
    state.question = 'How do these forms support the distinction in my question?';
    state.selection = [
      { nodeId: leaf.id, role: 'primary' },
      { nodeId: supportLeaves[0]!.id, role: 'support' }
    ];

    const value = tutorRecipeFromState(state);

    expect('primaryTarget' in value).toBe(false);
    expect(value.supportingTargets).toEqual([leaf.id, supportLeaves[0]!.id]);
  });

  it('V52 R4 keeps the former primary and the two earliest supports when the cap is reached', () => {
    const state = createTutorViewState();
    state.settings.questionOnly = true;
    state.question = 'How do these targets help answer the question?';
    state.selection = [
      { nodeId: leaf.id, role: 'primary' },
      ...supportLeaves.map((node) => ({ nodeId: node.id, role: 'support' as const }))
    ];

    const value = tutorRecipeFromState(state);

    expect(value.supportingTargets).toEqual([
      leaf.id,
      supportLeaves[0]!.id,
      supportLeaves[1]!.id
    ]);
    expect(value.supportingTargets).not.toContain(supportLeaves[2]!.id);
  });

  it('V52 R4 makes the question the subject and names every selected Support', () => {
    const question = 'How do these forms support the distinction in my question?';
    const state = createTutorViewState();
    state.settings.questionOnly = true;
    state.question = question;
    state.selection = [
      { nodeId: leaf.id, role: 'primary' },
      { nodeId: supportLeaves[0]!.id, role: 'support' }
    ];

    const instruction = tutorLessonGenerationRequest(tutorRecipeFromState(state)).instruction;

    expect(instruction).toContain('The question below is the subject of this lesson');
    expect(instruction).toContain('as supporting material');
    expect(instruction).toContain(`"${leaf.id}"`);
    expect(instruction).toContain(`"${supportLeaves[0]!.id}"`);
    expect(instruction).not.toContain('No learning-map target was chosen');
  });

  it('V52 R5 validates a shaped Ask answer while allowing optional fields to be absent', () => {
    expect(tutorProseAnswer({ directAnswer: 'Use that here.' })).toEqual({
      directAnswer: 'Use that here.'
    });
    expect(tutorProseAnswer({
      directAnswer: 'Use that here.',
      explanation: 'The clause identifies which project is meant.',
      examples: ['The project that caused the delay was cancelled.']
    })).toEqual({
      directAnswer: 'Use that here.',
      explanation: 'The clause identifies which project is meant.',
      examples: ['The project that caused the delay was cancelled.']
    });
    expect(() => tutorProseAnswer({
      directAnswer: 'Use that here.',
      examples: 'not a list'
    })).toThrow(/examples field was not a list/u);
  });

  it('V52 R5 gives schema-less Gemini the shaped Ask contract as words', () => {
    const request = tutorExampleQuestionRequest({
      sentence: 'The project that caused the delay was cancelled.',
      question: 'Why is that used here?'
    });
    const instruction = schemaInstruction(request.schema);

    expect(request.schema).toBe(TUTOR_PROSE_ANSWER_SCHEMA);
    expect(instruction).toContain('directAnswer: string');
    expect(instruction).toContain('explanation: string (optional)');
    expect(instruction).toContain('examples: array of string (optional)');
  });

  it('V51 R6 makes practice follow the question rather than the targets', () => {
    // The owner's report: the lesson answered their question and "practice was all about
    // present, past, and future reference only", because the exercise request names target
    // identifiers and nothing else.
    const question = 'Which and that difference. When do I use which, and when that?';

    const instruction = tutorExerciseGenerationRequest({ examples: [],
      schemaVersion: 1,
      recipe: questionOnlyRecipe(question),
      count: 4,
      channel: 'written'
    }).instruction;

    expect(instruction).toContain('Which and that difference. When do I use which, and when that?');
    // Changed 2026-09-25 for V156: the owner asked for American English in model instructions.
    expect(instruction).toContain('Every exercise must practice that question');
  });

  it('never retries after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const cancelled = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const fetcher = vi.fn(async () => { throw cancelled; });

    await expect(requestTutorStructuredJson(
      {
        provider: 'gemini',
        model: 'gemini-3.6-flash',
        thinkingOrEffort: 'medium',
        apiKey: 'x',
        maxAttempts: 5
      },
      tutorLessonGenerationRequest(recipe()),
      controller.signal,
      fetcher
    // Changed 2026-10-16: V256, F4 run 2, pre-send cancellation sends nothing and returns cancellation directly.
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('V50 R4 reports an unreachable provider without quoting transport details', async () => {
    // Without this the message is only "AI English Tutor request failed.", which cannot tell
    // a wrong host from a dead network from a blocked proxy. Found by an independent reading
    // run on 2026-09-02; the delivering run's own failure test did not reach this path.
    const fetcher = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND generativelanguage.googleapis.com');
    });

    await expect(requestTutorStructuredJson(
      {
        provider: 'gemini',
        model: 'gemini-3.6-flash',
        thinkingOrEffort: 'medium',
        apiKey: 'x',
        maxAttempts: 1
      },
      tutorExampleQuestionRequest({ sentence: 'A sentence.', question: 'Why?' }),
      new AbortController().signal,
      fetcher
    // 2026-10-05: fixed KREN wording replaces external error details, which can contain credentials.
    )).rejects.toThrow(/Gemini.*could not be reached/u);
  });

  it('V50 R4 names the provider reason when the JSON it returned cannot be parsed', async () => {
    // A provider that truncates its own output says why beside the text rather than instead
    // of it, so a reason read only when the text is missing never reaches a truncation.
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"answer": "part' }] } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(requestTutorStructuredJson(
      {
        provider: 'gemini',
        model: 'gemini-3.6-flash',
        thinkingOrEffort: 'medium',
        apiKey: 'x',
        maxAttempts: 1
      },
      tutorExampleQuestionRequest({ sentence: 'A sentence.', question: 'Why?' }),
      new AbortController().signal,
      fetcher as unknown as typeof fetch
    // 2026-10-05: retain the validated finish identifier while suppressing provider free text.
    )).rejects.toThrow(/malformed structured JSON[\s\S]*MAX_TOKENS/u);
  });

  it('V50 R3 and R6 keep a question intact through the instruction and the payload', () => {
    // Newlines and braces, not only the quotes in the owner's own example. A probe stripped
    // both on 2026-09-02 and every literal-interpolation test still passed.
    const question = 'Why not "which"?\nCompare {a} and {b}.';
    const example = tutorExampleQuestionRequest({ sentence: 'A sentence.', question });
    const practice = tutorPracticeQuestionRequest({
      exercisePrompt: 'At this time tomorrow, I ______ (fly) to London.',
      learnerAnswer: 'I am flying.',
      question
    });

    for (const request of [example, practice]) {
      expect(request.instruction, `${request.kind} lost part of the question`)
        .toContain(question);
      expect(JSON.parse(request.input).question, `${request.kind} payload lost it`)
        .toBe(question);
    }
  });
});

// 2026-10-11: slimmer history preserves ordinary and empty current answer fields.
describe('V220 turn history', () => {
  it.each(['I went home.', ''])('omits past explanatory prose for current answer %s', (learnerAnswer) => {
    const request = tutorConversationTurnRequest({ register: 'neutral', recipeTargets: { supportingTargets: [] },
      question: 'What happened next?', learnerAnswer,
      transcript: [{ question: 'Where did you go?', learnerAnswer: 'I go home.', correction: 'I went home.',
        explanation: 'Past explanation that must not be sent.', nextQuestion: 'Past follow-up prose.',
        rephrase: 'Past rephrasing.', rephraseWhy: 'Past teaching prose.' }] });
    // 2026-10-12: V227 keeps tutor speech and omits coaching fields from turn history.
    expect(JSON.parse(request.input).transcript).toEqual([{ question: 'Where did you go?', learnerAnswer: 'I go home.' }]);
    expect(JSON.parse(request.input).question).toBe('What happened next?');
    expect(JSON.parse(request.input).learnerAnswer).toBe(learnerAnswer);
    expect(request.input).not.toMatch(/Past /u);
  });
});

it('V220 Live coaching requests no second reply and validates correction fields', () => {
  const request = tutorConversationTurnRequest({ question: 'How was today?', learnerAnswer: 'It was good.', register: 'neutral', recipeTargets: { supportingTargets: [] }, transcript: [] });
  const coaching = tutorConversationCoachingRequest(request);
  expect(coaching.schemaName).toBe('kren_tutor_conversation_coaching');
  // Changed 2026-10-16: V253, owner item I34, coaching also requests the learner's punctuated exact words.
  // 2026-10-16: spokenPunctuated is an optional property, so a missing form falls back instead of failing.
  expect(coaching.schema.required).toEqual(['correction', 'targetId', 'explanation', 'rephrase', 'rephraseWhy']);
  expect(coaching.schema.properties).toHaveProperty('spokenPunctuated');
  for (const key of ['reply', 'replyQuote', 'nextQuestion']) expect(coaching.schema.properties).not.toHaveProperty(key);
  expect(JSON.parse(coaching.input)).toEqual(JSON.parse(request.input));
  const value = { correction: 'It was good.', targetId: '', explanation: 'Natural wording.', rephrase: 'I had a good day.', rephraseWhy: 'A complete alternative.' };
  expect(tutorConversationCoaching(value, 'It was good.')).toMatchObject({ correction: value.correction, replyQuote: '' });
  expect(() => tutorConversationCoaching({ ...value, rephrase: '' }, 'It was good.')).toThrow();
});
