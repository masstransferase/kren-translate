import { vi } from 'vitest';
import { SMART_GRAMMAR_INSTRUCTION } from '@kren/core/grammar';
import { TUTOR_MAP, TUTOR_SITUATIONS, type TutorLesson, type TutorRecipe } from '@kren/core/tutor';
import * as generation from '../../src/tutor/generation.js';
import * as takeHome from '../../src/tutor/takeHome.js';
import { tutorTargetMarks, type TutorLessonConversationContext } from '../../src/tutor/lessonConversation.js';
import { cleanTutorModelText, tutorPlainText } from '../../src/tutor/plainText.js';
import { tutorFastEffort } from '../../src/tutor/thinkingMode.js';
import { createTutorViewState, tutorRecipeFromState, type TutorConversationTurn, type TutorWritingSettings } from '../../src/tutor/state.js';
import type { TutorStructuredGenerationRequest } from '../../src/tutor/generation.js';
import { ProviderExhaustionState } from '../../src/languageModelSwitching.js';
import { runTutorStructuredRequest, type KrenRuntime, type TutorLanguageModelRoute } from '../../src/operations.js';
import { TUTOR_MODELS } from '../../src/tutor/models.js';
import { KrenResultsViewProvider } from '../../src/resultsView.js';
import { startTutorConversation } from '../../src/resultsViewConversation.js';
import { submitTutorConversationTurn, stopTutorConversation } from '../../src/resultsViewTurns.js';
import { writeTutorConversationHint } from '../../src/resultsViewHints.js';
import { reviewTutorExercise, reviewUnreviewedTutorExercises } from '../../src/resultsViewPractice.js';
import { startTutorLessonGeneration, generateTutorExercises, diagnoseTutorConversation } from '../../src/resultsViewLesson.js';
import { finalizeTutorTakeHome } from '../../src/resultsViewTakeHome.js';
import { PANEL_SETTINGS_FIXTURE } from './panelSettingsFixture.js';

/*
 * V312 pins, recorded on the unchanged 2.0.1 tree before the tutor builders moved into core.
 * Every value is plain JSON so the expected file can be compared character for character.
 */

type Case = { name: string; run(): unknown | Promise<unknown> };
const outcome = (run: () => unknown) => {
  try { return { value: run() ?? null }; } catch (error) { return { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }; }
};
const plain = (value: unknown) => JSON.parse(JSON.stringify(value ?? null));

const leaves = TUTOR_MAP.filter(node => !TUTOR_MAP.some(child => child.parentId === node.id));
const leaf = leaves[0]!, leafTwo = leaves[1]!, leafThree = leaves[2]!;
const hub = TUTOR_MAP.find(node => node.kind === 'hub')!;
const cluster = TUTOR_MAP.find(node => node.kind === 'cluster')!;
const situation = TUTOR_SITUATIONS[0]!;

function baseRecipe(): TutorRecipe {
  const state = createTutorViewState();
  state.selection = [{ nodeId: leaf.id, role: 'primary' }, { nodeId: leafTwo.id, role: 'support' }];
  return tutorRecipeFromState(state);
}
const recipe = baseRecipe();
const recipes: Record<string, TutorRecipe> = {
  exact: recipe,
  exactWithQuestion: { ...recipe, question: 'When do I use this form?' },
  hub: { ...recipe, primaryTargets: [hub.id] },
  cluster: { ...recipe, primaryTargets: [cluster.id], supportingTargets: [] },
  multiple: { ...recipe, primaryTargets: [leaf.id, leafThree.id] },
  questionWithSupports: { ...recipe, primaryTargets: [], question: 'Why does this sound odd?' },
  questionOnly: { ...recipe, primaryTargets: [], supportingTargets: [], question: 'How do I sound polite?' },
  nothing: { ...recipe, primaryTargets: [], supportingTargets: [], question: undefined }
} as Record<string, TutorRecipe>;

const writing: Record<string, TutorWritingSettings> = {
  general: { axes: { domain: 'general', function: 'general', modality: 'written', formality: 'preserve' }, learnerLevel: 'auto' },
  specific: { axes: { domain: 'business', function: 'persuade', modality: 'spoken', formality: 'formal' }, learnerLevel: 'B2' }
} as unknown as Record<string, TutorWritingSettings>;

const lessonContext: TutorLessonConversationContext = {
  subject: 'Polite requests',
  targets: [{ targetId: leaf.id, role: 'primary', label: leaf.label, description: 'Primary description.' },
    { targetId: leafTwo.id, role: 'support', label: leafTwo.label, description: 'Support description.' }],
  examples: [{ sentence: 'Could you send the report today?', targetIds: [leaf.id], annotations: [{ targetId: leaf.id, excerpt: 'Could you send' }] }],
  missedPractice: [{ exerciseId: 'item-0', prompt: 'Ask for help.', targetIds: [leaf.id], learnerText: 'Give me help.' }]
};

const turns: TutorConversationTurn[] = [
  { question: 'How can I help?', learnerAnswer: 'I want return this shirt.', reply: 'Of course. What was wrong with it?', correction: 'I want to return this shirt.',
    explanation: 'Use to after want.', rephrase: 'I would like to return this shirt.', rephraseWhy: 'More polite.', spoken: true },
  { question: 'What was wrong?', learnerAnswer: 'It too small.', reply: 'I see.', correction: 'It is too small.', explanation: 'Add is.', rephrase: "It's too small.", rephraseWhy: 'Natural.' },
  { question: 'Skip me.', learnerAnswer: '', correction: '', explanation: '', skipped: true },
  { question: 'Hidden.', learnerAnswer: '안녕하세요', correction: '', explanation: '', learnerNotShown: true }
];

const named = { tutorRole: 'shop assistant', learnerRole: 'customer' };
const controlsVariants: Record<string, generation.TutorConversationControls> = {
  none: {},
  named: { ...named, rolesSwapped: false, learnerStarts: false, replyLength: 'short', coaching: 'inline' },
  abstract: { rolesSwapped: false, learnerStarts: true, replyLength: 'medium', coaching: 'afterwards' },
  abstractSwapped: { rolesSwapped: true, learnerStarts: false, replyLength: 'long', coaching: 'teaching' },
  coach: { coach: true }
};

function builderCases(): Case[] {
  const out: Case[] = [];
  const add = (name: string, run: () => unknown) => out.push({ name: `builder:${name}`, run: () => plain(outcome(run)) });
  // Constants and schemas, exported or reachable through a request.
  add('constants', () => ({
    TUTOR_CORRECTION_CLAUSE: generation.TUTOR_CORRECTION_CLAUSE, TUTOR_PASSAGE_ANALYSIS_CHOICES: generation.TUTOR_PASSAGE_ANALYSIS_CHOICES,
    TUTOR_WEAKNESS_ANALYSIS_INSTRUCTION: generation.TUTOR_WEAKNESS_ANALYSIS_INSTRUCTION, TUTOR_TEXT_ANALYSIS_INSTRUCTION: generation.TUTOR_TEXT_ANALYSIS_INSTRUCTION,
    TUTOR_PRIVACY_INSTRUCTION: generation.TUTOR_PRIVACY_INSTRUCTION, TUTOR_PLAIN_TEXT_INSTRUCTION: generation.TUTOR_PLAIN_TEXT_INSTRUCTION,
    TUTOR_SPOKEN_PUNCTUATION_INSTRUCTION: generation.TUTOR_SPOKEN_PUNCTUATION_INSTRUCTION, TUTOR_CONVERSATION_MEANING_INSTRUCTION: generation.TUTOR_CONVERSATION_MEANING_INSTRUCTION,
    TUTOR_CONVERSATION_REPHRASE_INSTRUCTION: generation.TUTOR_CONVERSATION_REPHRASE_INSTRUCTION, TUTOR_CONVERSATION_COACH_INSTRUCTION: generation.TUTOR_CONVERSATION_COACH_INSTRUCTION,
    TUTOR_LIVE_TEACHING_INSTRUCTION: generation.TUTOR_LIVE_TEACHING_INSTRUCTION, TUTOR_CONVERSATION_ENGLISH_ONLY_INSTRUCTION: generation.TUTOR_CONVERSATION_ENGLISH_ONLY_INSTRUCTION,
    TUTOR_CONVERSATION_LIVE_ENGLISH_ONLY_INSTRUCTION: generation.TUTOR_CONVERSATION_LIVE_ENGLISH_ONLY_INSTRUCTION, TUTOR_SITUATION_ROLES: generation.TUTOR_SITUATION_ROLES,
    TUTOR_SITUATION_ROLES_SWAPPED: generation.TUTOR_SITUATION_ROLES_SWAPPED, TUTOR_CONVERSATION_LIVE_SKIP_NOTE: generation.TUTOR_CONVERSATION_LIVE_SKIP_NOTE,
    TUTOR_DEMO_BATCH_EXCHANGES: generation.TUTOR_DEMO_BATCH_EXCHANGES, TUTOR_DEMO_MAX_EXCHANGES: generation.TUTOR_DEMO_MAX_EXCHANGES,
    TUTOR_CONVERSATION_SCENE_SLANT_WEIGHTS: generation.TUTOR_CONVERSATION_SCENE_SLANT_WEIGHTS, TUTOR_CONVERSATION_SCENE_SLANTS: generation.TUTOR_CONVERSATION_SCENE_SLANTS,
    TUTOR_HANDOFF_REQUEST_PATTERNS: generation.TUTOR_HANDOFF_REQUEST_PATTERNS.map(pattern => `${pattern.source}/${pattern.flags}`),
    createTutorInstructionSource: [generation.createTutorInstructionSource(), generation.createTutorInstructionSource('Custom privacy.')]
  }));
  add('schemas', () => ({
    TUTOR_TARGET_SEARCH_SCHEMA: generation.TUTOR_TARGET_SEARCH_SCHEMA, TUTOR_DIAGNOSTIC_REPORT_SCHEMA: generation.TUTOR_DIAGNOSTIC_REPORT_SCHEMA,
    TUTOR_LESSON_SCHEMA: generation.TUTOR_LESSON_SCHEMA, TUTOR_EXAMPLE_SCHEMA: generation.TUTOR_EXAMPLE_SCHEMA, TUTOR_EXERCISE_SCHEMA: generation.TUTOR_EXERCISE_SCHEMA,
    TUTOR_REVIEW_SCHEMA: generation.TUTOR_REVIEW_SCHEMA, TUTOR_PROSE_ANSWER_SCHEMA: generation.TUTOR_PROSE_ANSWER_SCHEMA,
    TUTOR_CONVERSATION_TURN_SCHEMA: generation.TUTOR_CONVERSATION_TURN_SCHEMA, TUTOR_CONVERSATION_CORRECTIONS_SCHEMA: generation.TUTOR_CONVERSATION_CORRECTIONS_SCHEMA,
    TUTOR_CONVERSATION_OPENING_SCHEMA: generation.TUTOR_CONVERSATION_OPENING_SCHEMA, TUTOR_CONVERSATION_SCENE_SCHEMA: generation.TUTOR_CONVERSATION_SCENE_SCHEMA,
    TUTOR_CONVERSATION_DEMO_CAST_SCHEMA: generation.TUTOR_CONVERSATION_DEMO_CAST_SCHEMA, TUTOR_CONVERSATION_DEMO_BATCH_SCHEMA: generation.TUTOR_CONVERSATION_DEMO_BATCH_SCHEMA,
    TUTOR_CONVERSATION_HANDOFF_SCHEMA: generation.TUTOR_CONVERSATION_HANDOFF_SCHEMA
  }));
  add('liveSessionCredentialRequest', () => generation.tutorLiveSessionCredentialRequest());
  add('targetSearch', () => generation.tutorTargetSearchRequest('polite requests at work'));
  add('targetSearch:custom', () => generation.tutorTargetSearchRequest('x', generation.createTutorInstructionSource('Custom privacy.'), { ...named, register: 'casual' }));
  for (const [name, controls] of Object.entries(controlsVariants)) {
    add(`conversationDiagnosis:${name}`, () => generation.tutorConversationDiagnosisRequest(turns, writing.specific!, undefined, name === 'none' ? undefined : { ...controls, register: 'neutral' }));
  }
  add('conversationDiagnosis:general', () => generation.tutorConversationDiagnosisRequest(turns, writing.general!));
  add('practiceHint', () => generation.tutorPracticeHintRequest('Ask your manager for a day off.', [leaf.label, leafTwo.label], writing.specific!));
  add('practiceHint:lessonExample', () => generation.tutorPracticeHintRequest('Ask for help.', [], writing.general!, undefined, { exampleIndex: 1, sentence: 'Could you help me?' }));
  const hintBody = (extra: Partial<generation.TutorConversationHintRequestBody>): generation.TutorConversationHintRequestBody => ({
    question: 'How can I help?', setting: situation.setting, register: 'neutral',
    recentTurns: [{ question: 'Hello?', learnerAnswer: 'Hi there.' }], ...extra });
  for (const [name, controls] of Object.entries(controlsVariants)) add(`conversationHint:${name}`, () => generation.tutorConversationHintRequest(hintBody(controls)));
  add('conversationHint:opening', () => generation.tutorConversationHintRequest(hintBody({ opening: true, question: '', ...controlsVariants.named })));
  add('conversationHint:lesson', () => generation.tutorConversationHintRequest(hintBody({ lessonContext, ...controlsVariants.abstract })));
  for (const analysis of generation.TUTOR_PASSAGE_ANALYSIS_CHOICES) {
    add(`passageDiagnosis:${analysis}`, () => generation.tutorPassageDiagnosisRequest('The team have went home early.', analysis, writing.specific!));
  }
  const report = { summary: 'Summary.', findings: [{ level: 1, observation: 'Observation.', evidence: 'Evidence.', targetId: leaf.id }], focus: 'Focus.', targets: [], polish: [] };
  add('tailoredPrompt', () => generation.tutorTailoredPromptRequest(report as never, [{ nodeId: leaf.id, role: 'primary' }, { nodeId: leafTwo.id, role: 'support' }], 'Upper-intermediate'));
  add('serializeRecipe', () => generation.serializeTutorRecipe(recipe));
  for (const [name, value] of Object.entries(recipes)) {
    add(`lesson:${name}`, () => generation.tutorLessonGenerationRequest(value));
    add(`example:${name}`, () => generation.tutorLessonGenerationRequest(value, 'example-2'));
  }
  const practiceRequest = (level: string, question?: string, primary = true): generation.TutorExamplePracticeRequest => ({
    recipe: { ...recipe, ...(primary ? {} : { primaryTargets: [] }), question, output: { ...recipe.output, learnerLevel: level } },
    count: 3, channel: 'written', activeTargets: [leaf.id],
    examples: [{ sentence: 'Could you send the report today?', targetIds: [leaf.id], annotations: [{ targetId: leaf.id, excerpt: 'Could you', explanation: 'Polite.' }] }]
  }) as never;
  for (const level of ['A1', 'A2', 'B1', 'C2', 'auto']) add(`exercises:${level}`, () => generation.tutorExerciseGenerationRequest(practiceRequest(level)));
  add('exercises:question', () => generation.tutorExerciseGenerationRequest(practiceRequest('B2', 'Why could?')));
  add('exercises:questionNoPrimary', () => generation.tutorExerciseGenerationRequest(practiceRequest('B2', 'Why could?', false)));
  add('exercises:questionOnly', () => generation.tutorExerciseGenerationRequest({ ...practiceRequest('B2', 'Why could?', false),
    recipe: { ...practiceRequest('B2', 'Why could?', false).recipe, supportingTargets: [] } }));
  const review = (index: number): generation.TutorReviewRequestBody => ({ learnerAnswer: `Answer ${index}.`,
    exercise: { id: `item-${index}`, channel: 'written', prompt: 'Write ___ sentence.', targetIds: [leaf.id] }, activeTargets: [leaf.id] });
  add('review', () => generation.tutorReviewGenerationRequest(review(0)));
  add('reviewBatch:1', () => generation.tutorReviewBatchGenerationRequest([review(0)]));
  add('reviewBatch:3', () => generation.tutorReviewBatchGenerationRequest([review(0), review(1), review(2)]));
  add('reviewInstruction', () => generation.buildTutorReviewInstruction(SMART_GRAMMAR_INSTRUCTION));
  add('reviewInstruction:missing', () => generation.buildTutorReviewInstruction('No standard here.'));
  add('exampleQuestion', () => generation.tutorExampleQuestionRequest({ sentence: 'Could you help?', question: 'Why could?' }));
  add('practiceQuestion', () => generation.tutorPracticeQuestionRequest({ exercisePrompt: 'Ask ___ help.', learnerAnswer: 'for', question: 'Why for?' }));
  for (const answer of ['Can I speak to your manager?', 'Is there a supervisor?', "Who's in charge here?", 'Manager, please.', 'I like this shirt.']) {
    add(`handoffInstruction:${answer}`, () => generation.tutorConversationHandoffInstruction(answer));
  }
  const turnBody = (extra: Partial<generation.TutorConversationTurnRequestBody>): generation.TutorConversationTurnRequestBody => ({
    register: 'neutral', recipeTargets: { primaryTarget: leaf.id, supportingTargets: [leafTwo.id] },
    transcript: turns.slice(0, 2), question: 'What size do you need?', learnerAnswer: 'I need more big one.', ...extra });
  const turnVariants: Record<string, Partial<generation.TutorConversationTurnRequestBody>> = {
    plain: {},
    named: { ...controlsVariants.named },
    namedTeachingSpoken: { ...controlsVariants.named, teaching: true, spoken: true, voiceGender: 'female', replyLength: 'brief' },
    abstractSetting: { ...controlsVariants.abstract, setting: situation.setting },
    abstractSwappedSetting: { ...controlsVariants.abstractSwapped, setting: situation.setting, voiceGender: 'male' },
    lesson: { ...controlsVariants.named, lessonContext },
    handoff: { ...controlsVariants.named, learnerAnswer: 'Can I talk to your manager please?' },
    notShown: { ...controlsVariants.named, learnerAnswer: '안녕하세요 감사합니다', voiceGender: 'female', replyLength: 'long' },
    notShownAbstract: { ...controlsVariants.abstract, setting: situation.setting, learnerAnswer: 'Bonjour, je voudrais un café.' },
    coachTyped: { coach: true },
    coachSpoken: { coach: true, spoken: true }
  };
  for (const [name, extra] of Object.entries(turnVariants)) add(`conversationTurn:${name}`, () => generation.tutorConversationTurnRequest(turnBody(extra)));
  add('conversationTurn:customSource', () => generation.tutorConversationTurnRequest(turnBody(controlsVariants.named!), generation.createTutorInstructionSource('Custom privacy.')));
  const corrections = (extra: Partial<generation.TutorConversationCorrectionsRequestBody>): generation.TutorConversationCorrectionsRequestBody => ({
    register: 'casual', recipeTargets: { supportingTargets: [] },
    turns: [{ question: 'Hello?', learnerAnswer: 'Hi I am fine.', spoken: true, previousTurn: { question: 'Hi?', learnerAnswer: 'Hello.', reply: 'How are you?' } },
      { question: 'And you?', learnerAnswer: 'Good good.' }], ...extra });
  for (const [name, controls] of Object.entries(controlsVariants)) add(`conversationCorrections:${name}`, () => generation.tutorConversationCorrectionsRequest(corrections(controls)));
  add('conversationCorrections:settingLesson', () => generation.tutorConversationCorrectionsRequest(corrections({ ...controlsVariants.abstractSwapped, setting: situation.setting, lessonContext })));
  add('conversationStop', () => takeHome.tutorConversationStopRequest(corrections(controlsVariants.named!)));
  for (const name of ['named', 'namedTeachingSpoken', 'abstractSwappedSetting', 'lesson', 'coachTyped']) {
    add(`conversationCoaching:${name}`, () => generation.tutorConversationCoachingRequest(generation.tutorConversationTurnRequest(turnBody(turnVariants[name]!))));
  }
  add('teachingInstruction', () => [generation.tutorConversationTeachingInstruction(true), generation.tutorConversationTeachingInstruction(false)]);
  add('liveTeachingInstruction', () => [generation.tutorConversationLiveTeachingInstruction(true), generation.tutorConversationLiveTeachingInstruction(false)]);
  add('replyLength', () => [undefined, 'brief', 'short', 'medium', 'long'].map(length => generation.tutorConversationReplyLengthInstruction(length as never)));
  add('coachOpening', () => (['casual', 'neutral', 'professional', 'formal'] as const).flatMap(register =>
    [0, 0.34, 0.67, 0.999, 1].map(draw => generation.tutorConversationCoachOpening(register, () => draw))));
  add('sceneSlant', () => [-1, 0, 0.1, 0.2, 0.3, 0.55, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99, 1, 2].map(draw => generation.tutorConversationSceneSlant(() => draw)));
  const roleRequests: Record<string, Parameters<typeof generation.tutorConversationRoleInstruction>[0]> = {
    empty: {}, named, swapped: { rolesSwapped: true }, unswapped: { rolesSwapped: false }, setting: { setting: 'A shop.' },
    lessonContext: { lessonContext }, situationKind: { kind: 'situation' }, lessonKind: { kind: 'lesson' }, anythingKind: { kind: 'anything' }
  };
  for (const [name, request] of Object.entries(roleRequests)) for (const mode of ['dialogue', 'coaching', 'demo'] as const) {
    add(`roleInstruction:${name}:${mode}`, () => generation.tutorConversationRoleInstruction(request, mode));
  }
  const openings: Record<string, generation.TutorConversationOpeningRequestBody> = {
    situation: { kind: 'situation', setting: situation.setting, register: 'neutral', sceneSlant: generation.TUTOR_CONVERSATION_SCENE_SLANTS[0], rolesSwapped: false, learnerStarts: false, replyLength: 'short', coaching: 'inline' },
    situationSwappedLearner: { kind: 'situation', setting: situation.setting, register: 'formal', sceneSlant: generation.TUTOR_CONVERSATION_SCENE_SLANTS[4], rolesSwapped: true, learnerStarts: true, voiceGender: 'male', replyLength: 'brief', coaching: 'teaching' },
    lesson: { kind: 'lesson', register: 'casual', primaryTargetLabel: leaf.label, supportingTargetLabels: [leafTwo.label], lessonContext, setting: situation.setting, rolesSwapped: false,
      sceneSlant: generation.TUTOR_CONVERSATION_SCENE_SLANTS[7], learnerStarts: false, voiceGender: 'female', replyLength: 'medium', coaching: 'afterwards' },
    lessonNoSetting: { kind: 'lesson', register: 'professional', primaryTargetLabel: leaf.label, supportingTargetLabels: [], lessonContext,
      sceneSlant: generation.TUTOR_CONVERSATION_SCENE_SLANTS[2], learnerStarts: true },
    anything: { kind: 'anything', register: 'neutral', sceneSlant: generation.TUTOR_CONVERSATION_SCENE_SLANTS[1], learnerStarts: false, replyLength: 'long', coaching: 'inline' },
    namedResume: { ...named, kind: 'situation', setting: situation.setting, register: 'neutral', sceneSlant: generation.TUTOR_CONVERSATION_SCENE_SLANTS[3], rolesSwapped: false, learnerStarts: false },
    coach: { coach: true, kind: 'anything', register: 'casual', sceneSlant: generation.TUTOR_CONVERSATION_SCENE_SLANTS[0] }
  } as Record<string, generation.TutorConversationOpeningRequestBody>;
  for (const [name, request] of Object.entries(openings)) {
    add(`conversationOpening:${name}`, () => generation.tutorConversationOpeningRequest(request));
    add(`liveSystem:${name}:plain`, () => generation.tutorConversationLiveSystemInstruction(request, false));
    add(`liveSystem:${name}:teachingScene`, () => generation.tutorConversationLiveSystemInstruction(request, true, undefined, 'A busy shop. The assistant is tired.'));
  }
  add('liveResume', () => [generation.tutorConversationLiveResumeInstruction([{ speaker: 'KREN', text: 'Hi.' }, { speaker: 'learner', text: 'Hello.' }]),
    generation.tutorConversationLiveResumeInstruction([], 'brief')]);
  const demoCast: Record<string, generation.TutorConversationDemoCastRequestBody> = {
    situation: { kind: 'situation', setting: situation.setting, register: 'neutral', sceneSlant: generation.TUTOR_CONVERSATION_SCENE_SLANTS[0], counterpartGender: 'male', readerSideGender: 'female' },
    lesson: { kind: 'lesson', primaryTargetLabel: leaf.label, supportingTargetLabels: [leafTwo.label], setting: situation.setting, rolesSwapped: true, lessonContext,
      register: 'casual', sceneSlant: generation.TUTOR_CONVERSATION_SCENE_SLANTS[5], counterpartGender: 'female', readerSideGender: 'male' },
    anythingNamed: { ...named, kind: 'anything', register: 'formal', sceneSlant: generation.TUTOR_CONVERSATION_SCENE_SLANTS[6], counterpartGender: 'female', readerSideGender: 'female' }
  } as Record<string, generation.TutorConversationDemoCastRequestBody>;
  for (const [name, request] of Object.entries(demoCast)) add(`demoCast:${name}`, () => generation.tutorConversationDemoCastRequest(request));
  const cast = { scene: 'A shop.', male: { name: 'Sam', role: 'assistant', description: 'Calm.' }, female: { name: 'Ana', role: 'customer', description: 'Busy.' } };
  add('demoBatch', () => generation.tutorConversationDemoBatchRequest({ ...cast, register: 'neutral', transcript: [{ speaker: 'male', text: 'Hi.' }], exchanges: 4 }));
  add('demoBatch:lessonRoles', () => generation.tutorConversationDemoBatchRequest({ ...cast, ...named, lessonContext, register: 'casual', transcript: [], exchanges: 2 }));
  const takeHomeInput = (extra: Partial<takeHome.TutorTakeHomeInput>): takeHome.TutorTakeHomeInput => ({
    source: 'situation', demo: false, register: 'neutral',
    turns: [{ turnIndex: 0, question: 'Hello?', learnerAnswer: 'I want return this.', reply: 'Sure.', spoken: true, correction: 'I want to return this.' },
      { turnIndex: 1, learnerAnswer: 'It too small.', correction: 'It is too small.', rephrase: "It's too small.", rephraseWhy: 'Natural.' }],
    demoLines: [], ...extra });
  add('takeHome:situationNamed', () => takeHome.tutorConversationTakeHomeRequest(takeHomeInput({ ...controlsVariants.named })));
  add('takeHome:situationAbstract', () => takeHome.tutorConversationTakeHomeRequest(takeHomeInput({ ...controlsVariants.abstractSwapped })));
  add('takeHome:lesson', () => takeHome.tutorConversationTakeHomeRequest(takeHomeInput({ source: 'lesson', lessonContext, ...controlsVariants.named })));
  add('takeHome:coach', () => takeHome.tutorConversationTakeHomeRequest(takeHomeInput({ source: 'speakAndRephrase', coach: true })));
  add('takeHome:demoTyped', () => takeHome.tutorConversationTakeHomeRequest(takeHomeInput({ source: 'anything', demo: true,
    turns: [{ turnIndex: 0, learnerAnswer: 'Hi.' }], demoLines: [{ speaker: 'male', text: 'Hi.' }] })));
  return out;
}

function readerCases(): Case[] {
  const out: Case[] = [];
  const add = (name: string, run: () => unknown) => out.push({ name: `reader:${name}`, run: () => plain(outcome(run)) });
  const finish = { candidates: [{ finishReason: 'MAX_TOKENS' }] };
  add('liveCredential', () => [outcome(() => generation.tutorLiveSessionCredential({ apiKey: 'fixture' })), outcome(() => generation.tutorLiveSessionCredential({}))]);
  add('targetSearchSelection', () => [generation.tutorTargetSearchSelection({ targets: [{ targetId: leaf.id, role: 'primary' }, { targetId: 'unknown', role: 'support' }] })]);
  add('writtenHint', () => [{ explanation: ' Name it. ', example: ' I did. ' }, { explanation: '', example: 'x' }, null, 'x'].map(value => generation.tutorWrittenHint(value) ?? null));
  add('writtenPrompt', () => [{ prompt: ' Practice this. ' }, { prompt: 'x', extra: 1 }, { prompt: ' ' }, null].map(value => generation.tutorWrittenPrompt(value) ?? null));
  const example = (sentence: string, excerpt: string) => ({ id: excerpt || 'empty', sentence, targetIds: [leaf.id], annotations: [{ targetId: leaf.id, excerpt, explanation: 'x' }] });
  add('lessonExcerptFindings', () => generation.tutorLessonExcerptFindings([example('Could you help me today?', 'Could you'), example('Short.', 'Short.'),
    example('A sentence.', ''), { id: 'none', sentence: 'x', targetIds: [], annotations: [] } as never, null as never]));
  const practiceRequest = { recipe, count: 2, channel: 'written', activeTargets: [leaf.id],
    examples: [{ sentence: 'Could you send the report to me today please?', targetIds: [leaf.id], annotations: [] }] } as never;
  const set = (exercises: unknown[], answerKey?: unknown[]) => ({ schemaVersion: 1, mapVersion: recipe.mapVersion, channel: 'written', exercises, ...(answerKey ? { answerKey } : {}) }) as never;
  const exercise = (id: string, extra: Record<string, unknown>) => ({ id, channel: 'written', prompt: 'Ask ___ to help.', targetIds: [leaf.id], exampleIndex: 0, expectedAnswer: 'someone', ...extra });
  add('examplePracticeSet:valid', () => generation.validateTutorExamplePracticeSet(set([exercise('a', {}), exercise('b', { taskLine: 'Choose.' })]), practiceRequest));
  add('examplePracticeSet:invalid', () => generation.validateTutorExamplePracticeSet(set([exercise('a', { taskLine: ' ', exampleIndex: 3 }),
    exercise('b', { expectedAnswer: '', prompt: 'Could you send the report to me?' }), exercise('c', { exampleIndex: 1.5 })],
  [{ id: 'k', exerciseId: 'c', answer: 'send the report to me today', explanation: 'x' }]), practiceRequest));
  add('handoff', () => [{ role: ' Jo, manager ', gender: 'female' }, { role: 'x'.repeat(121), gender: 'male' }, { role: 'a<b', gender: 'male' },
    { role: 'Jo', gender: 'other' }, { role: '', gender: 'male' }, null].map(value => generation.tutorConversationHandoff(value) ?? null));
  add('liveReplyQuote', () => ['Actually, you would say: I went home. Then what?', 'actually you would say I went home', 'Actually you would say all of a sudden! Wow.',
    'No marker here.'].map(generation.tutorConversationLiveReplyQuote));
  const opening = { scene: ' A shop. ', opening: ' **Hi**, how can I help? ', tutorRole: ' shop assistant ', learnerRole: 'customer' };
  const openingCases: Record<string, [unknown, boolean?, string[]?]> = {
    valid: [opening], validMarks: [{ ...opening, targetMarks: [{ field: 'opening', targetId: leaf.id, quote: 'help', occurrence: 0 }, { field: 'opening', targetId: 'x', quote: 'Hi', occurrence: 0 }] }, true, [leaf.id]],
    targetIdsNoMarks: [opening, true, [leaf.id]], sceneOnly: [{ scene: 'A shop.', tutorRole: 'assistant', learnerRole: 'customer' }, false],
    sceneOnlyWithOpening: [opening, false], finish: [finish], noScene: [{ opening: 'Hi' }], extraField: [{ ...opening, extra: 1 }],
    emptyOpening: [{ ...opening, opening: ' ' }], sameRoles: [{ ...opening, learnerRole: 'Shop  Assistant' }], longRole: [{ ...opening, tutorRole: 'one two three four five six seven' }],
    unknownFinish: [{ finishReason: 'NEW_REASON' }]
  };
  for (const [name, args] of Object.entries(openingCases)) add(`opening:${name}`, () => generation.tutorConversationOpening(...args));
  const demoCast = { scene: ' A shop. ', male: { name: ' Sam ', role: 'assistant', description: 'Calm.' }, female: { name: 'Ana', role: 'customer', description: 'Busy.' } };
  for (const [name, value] of Object.entries({ valid: demoCast, finish, badScene: { ...demoCast, scene: '' }, extra: { ...demoCast, x: 1 },
    badMale: { ...demoCast, male: { name: 'Sam', role: 'x' } }, badFemale: { ...demoCast, female: null } })) add(`demoCast:${name}`, () => generation.tutorConversationDemoCast(value));
  const lines = [{ speaker: 'male', text: ' **Hi**. ' }, { speaker: 'female', text: 'Hello.' }];
  for (const [name, value] of Object.entries({ valid: { lines }, count: { lines: [lines[0]] }, finish, alternate: { lines: [lines[0], lines[0]] },
    badLine: { lines: [lines[0], { speaker: 'robot', text: 'x' }] }, extra: { lines, x: 1 } })) add(`demoBatch:${name}`, () => generation.tutorConversationDemoBatch(value, 1));
  const turn = { move: 'recast', reply: ' Right, **aisle** twelve. ', replyQuote: 'aisle twelve', correction: ' You told me aisle twelve. ', targetId: leaf.id,
    explanation: ' Aisle. ', rephrase: ' You said aisle twelve. ', rephraseWhy: ' Natural. ', spokenPunctuated: 'You told me, ale twelve.' };
  const turnCases: Record<string, [unknown, boolean?, string[]?]> = {
    valid: [turn], nextQuestion: [{ ...turn, reply: 'Right.', nextQuestion: ' Anything else? ' }], repeatedQuestion: [{ ...turn, reply: 'Right. Anything else', nextQuestion: 'Anything else?' }],
    replyAsks: [{ ...turn, reply: 'Which size?', nextQuestion: 'Anything else?' }], quotedQuestion: [{ ...turn, reply: 'Say "Which size?" next.', replyQuote: '"Which size?"', nextQuestion: 'Anything else?' }],
    unknownMove: [{ ...turn, move: 'dance' }], noMoveNoReply: [{ ...turn, move: undefined, reply: '' }], emptyReply: [{ ...turn, reply: ' ' }],
    emptyCorrection: [{ ...turn, correction: '' }], notShown: [{ ...turn, correction: '', explanation: '', rephrase: '', rephraseWhy: '' }, true],
    badTarget: [{ ...turn, targetId: 'unknown' }], emptyNext: [{ ...turn, nextQuestion: '' }], handoff: [{ ...turn, handoff: { role: 'Jo, manager', gender: 'female' } }],
    alternatives: [{ ...turn, alternatives: [{ text: ' A ', why: ' B ' }, { text: '', why: 'x' }, { text: 'C', why: 'D' }, { text: 'E', why: 'F' }] }],
    marks: [{ ...turn, targetMarks: [{ field: 'reply', targetId: leaf.id, quote: 'twelve', occurrence: 0 }] }, false, [leaf.id]],
    finish: [finish], notObject: ['x'], noSpokenPunctuated: [{ ...turn, spokenPunctuated: undefined }]
  };
  for (const [name, args] of Object.entries(turnCases)) add(`turn:${name}`, () => generation.tutorConversationTurn(...args));
  const correction = { correction: ' Hi, I am fine. ', targetId: leaf.id, explanation: ' Comma. ', rephrase: " Hi, I'm fine. ", rephraseWhy: ' Natural. ', spokenPunctuated: 'Hi, I am fine.' };
  for (const [name, value] of Object.entries({ valid: { corrections: [correction, { ...correction, targetId: 'unknown', spokenPunctuated: undefined }] },
    count: { corrections: [correction] }, finish, empty: { corrections: [correction, { ...correction, rephraseWhy: '' }] } })) {
    add(`corrections:${name}`, () => generation.tutorConversationCorrections(value, 2));
  }
  add('coaching', () => generation.tutorConversationCoaching(correction, 'Hi I am fine.'));
  add('coaching:invalid', () => generation.tutorConversationCoaching({}, 'Hi.'));
  for (const [name, value] of Object.entries({ valid: { directAnswer: ' Yes. ', explanation: ' Because. ', examples: [' One. '] }, short: { directAnswer: 'Yes.' },
    finish, notObject: 'x', missing: {}, empty: { directAnswer: ' ' }, badExplanation: { directAnswer: 'Yes', explanation: '' },
    badExamples: { directAnswer: 'Yes', examples: ['', 'x'] }, notArray: { directAnswer: 'Yes', examples: 'x' }, refusal: { stop_reason: 'refusal' },
    nested: { error: { content: [{ finish_reason: 'content_filter' }] } } })) add(`proseAnswer:${name}`, () => generation.tutorProseAnswer(value));
  add('targetMarks', () => [tutorTargetMarks([{ field: 'reply', targetId: leaf.id, quote: 'ab', occurrence: 1 }, { field: 'reply', targetId: leaf.id, quote: 'ab', occurrence: 1 },
    { field: 'nextQuestion', targetId: leaf.id, quote: 'x', occurrence: 0 }, { field: 'reply', targetId: leaf.id, quote: 'zz', occurrence: 0 }, null], { reply: 'ab ab ab' }, [leaf.id]),
  tutorTargetMarks('x', {}, [])]);
  add('plainText', () => [tutorPlainText('**Bold** and __under__ and *it* and _em_ and snake_case_name'),
    cleanTutorModelText({ prompt: 'Fill ___ ___ here.', targetIds: [], nested: ['**x**'], n: 1 }), cleanTutorModelText({ prompt: 'Fill ___ ___ here.' }, true),
    cleanTutorModelText({ prompt: 'Fill ___ ___ here.' })]);
  const takeHomeInput: takeHome.TutorTakeHomeInput = { source: 'situation', demo: false, register: 'neutral', demoLines: [],
    turns: [{ turnIndex: 0, learnerAnswer: 'I want return this shirt.', spoken: true }, { turnIndex: 1, learnerAnswer: 'It too small.' }] };
  const cards: Record<string, unknown> = {
    valid: { naturally: [{ turnIndex: 1, quote: 'too small', alternatives: ['It is too small.'], why: 'Add the verb.' }],
      learningTargets: [{ targetId: leaf.id, why: 'Practice requests.' }, { targetId: leaf.id, why: 'Dup.' }, { targetId: 'nope', why: 'x' }],
      pattern: { name: 'want to', examples: ['I want to go.', 'I want to eat.'] }, doneWell: [{ turnIndex: 0, quote: 'WANT RETURN', note: 'Clear goal.' }], tryNext: 'I would like to return this shirt.' },
    trimmed: { naturally: [{ turnIndex: 1, quote: 'It too small.', alternatives: ['a'.repeat(81), 'Fine.', 'b', 'c'], why: `${'word '.repeat(25)}end.` }], doneWell: [], tryNext: 'Two. Sentences.', extra: 1 },
    invalid: { naturally: 'x', doneWell: [{ turnIndex: 9, quote: 'x', note: 'y' }], tryNext: '' }, notObject: [],
    unknownKeys: { naturally: [{ turnIndex: 1, quote: 'too small', alternatives: ['x'], why: 'y.', extra: 1 }], pattern: { name: 'x', examples: ['a'] }, tryNext: 'Say it.' }
  };
  for (const [name, value] of Object.entries(cards)) add(`takeHome:${name}`, () => { const lines: string[] = []; return { result: outcome(() => takeHome.tutorConversationTakeHome(value, takeHomeInput, line => lines.push(line))), lines }; });
  add('takeHome:demo', () => { const lines: string[] = []; return { result: outcome(() => takeHome.tutorConversationTakeHome(cards.valid, { ...takeHomeInput, demo: true }, line => lines.push(line))), lines }; });
  add('fastEffort', () => (['gemini', 'openai', 'anthropic', 'groq', 'cloudflare'] as const).flatMap(provider => [TUTOR_MODELS[provider].fast, TUTOR_MODELS[provider].thorough].flatMap(model =>
    (['auto', 'low', 'medium', 'high', 'minimal'] as const).map(effort => `${provider}:${model}:${effort}=${tutorFastEffort(provider, model, effort as never)}`))));
  return out;
}

const providers = ['gemini', 'openai', 'anthropic', 'groq', 'cloudflare'] as const;
const envelope = (provider: string, value: unknown) => {
  const text = JSON.stringify(value);
  return provider === 'gemini' ? { candidates: [{ content: { parts: [{ text }] } }] }
    : provider === 'openai' ? { output: [{ content: [{ type: 'output_text', text }] }] }
      : provider === 'anthropic' ? { content: [{ type: 'text', text }] } : { choices: [{ message: { content: text } }] };
};
function runtime(settings: Record<string, unknown> = {}): KrenRuntime {
  return { getSetting: <T>(key: string, fallback: T) => ({ 'llm.providerSwitch': false, 'gemini.retry.maxAttempts': 1, 'languageModel.retry.maxAttempts': 1, ...settings }[key] ?? fallback) as T,
    getSecret: async () => 'fixture-secret', beforeGeminiRequest: async () => {}, reserveCloudCharacters: async () => {},
    providerExhaustion: new ProviderExhaustionState(), log: () => {} };
}
/** Sends are recorded with the request's own instruction and input replaced by markers, which also proves each appears exactly once. */
async function transport(request: TutorStructuredGenerationRequest, route: TutorLanguageModelRoute, answers: (index: number, provider: string) => Response,
  settings: Record<string, unknown> = {}) {
  const original = globalThis.fetch, sends: unknown[] = [];
  const marker = (body: string) => {
    let text = body, counts: Record<string, number> = {};
    for (const [name, value] of [['instruction', request.instruction], ['input', request.input]] as const) {
      const escaped = JSON.stringify(value).slice(1, -1);
      counts[name] = escaped ? text.split(escaped).length - 1 : 0;
      if (escaped) text = text.split(escaped).join(`[[${name}]]`);
    }
    return { body: JSON.parse(text), counts };
  };
  globalThis.fetch = (async (url, init) => {
    sends.push({ url: String(url), ...marker(String(init?.body ?? '')) });
    return answers(sends.length - 1, route.provider);
  }) as typeof fetch;
  try {
    const result = await runTutorStructuredRequest(runtime(settings), route, request, new AbortController().signal).then(value => ({ value }),
      (error: unknown) => ({ error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }));
    return plain({ sends, result });
  } finally { globalThis.fetch = original; }
}
const routeFor = (provider: typeof providers[number], extra: Partial<TutorLanguageModelRoute> = {}): TutorLanguageModelRoute => ({
  provider, model: TUTOR_MODELS[provider].thorough, geminiProfile: 'standard', thinkingOrEffort: 'auto',
  fallbackEnabled: false, fallbackModel: 'retired-fallback-model', fallbackThinkingOrEffort: 'low', ...extra });
const unavailable = () => new Response('{}', { status: 503 });

function transportCases(): Case[] {
  const out: Case[] = [];
  const hint = generation.tutorConversationHintRequest({ question: 'How can I help?', setting: situation.setting, register: 'neutral', recentTurns: [], ...named });
  const turn = generation.tutorConversationTurnRequest({ register: 'neutral', recipeTargets: { supportingTargets: [] }, transcript: [],
    question: 'How can I help?', learnerAnswer: 'I want return this.', ...named, setting: situation.setting });
  const requests: Record<string, TutorStructuredGenerationRequest> = {
    lesson: generation.tutorLessonGenerationRequest(recipe),
    exercises: generation.tutorExerciseGenerationRequest({ recipe, count: 2, channel: 'written', activeTargets: [leaf.id], examples: [] } as never),
    review: generation.tutorReviewGenerationRequest({ learnerAnswer: 'Answer.', exercise: { id: 'a', channel: 'written', prompt: 'Write.', targetIds: [leaf.id] }, activeTargets: [leaf.id] }),
    reviewBatch: generation.tutorReviewBatchGenerationRequest([{ learnerAnswer: 'A.', exercise: { id: 'a', channel: 'written', prompt: 'Write.', targetIds: [] }, activeTargets: [] },
      { learnerAnswer: 'B.', exercise: { id: 'b', channel: 'written', prompt: 'Write.', targetIds: [] }, activeTargets: [] }]),
    opening: generation.tutorConversationOpeningRequest({ kind: 'situation', setting: situation.setting, register: 'neutral', sceneSlant: generation.TUTOR_CONVERSATION_SCENE_SLANTS[0] }),
    turn, hint,
    coaching: generation.tutorConversationCoachingRequest(turn),
    corrections: generation.tutorConversationCorrectionsRequest({ register: 'neutral', recipeTargets: { supportingTargets: [] }, turns: [{ question: 'Q?', learnerAnswer: 'A.' }], ...named }),
    takeHome: takeHome.tutorConversationTakeHomeRequest({ source: 'situation', demo: false, register: 'neutral', turns: [{ turnIndex: 0, learnerAnswer: 'A.' }], demoLines: [], ...named }),
    diagnosis: generation.tutorConversationDiagnosisRequest(turns, writing.general!),
    exampleQuestion: generation.tutorExampleQuestionRequest({ sentence: 'S.', question: 'Q?' })
  };
  // One body per provider and kind: a 503 ends each request after its single configured attempt.
  for (const provider of providers) for (const [name, request] of Object.entries(requests)) {
    out.push({ name: `transport:${provider}:${name}`, run: () => transport(request, routeFor(provider), unavailable) });
  }
  // Fast kinds validate their answer and escalate once to Thorough on an unreadable one.
  out.push({ name: 'transport:gemini:hint:escalation', run: () => transport(hint, routeFor('gemini'), index => new Response(JSON.stringify(envelope('gemini',
    index === 0 ? { explanation: '' , example: '' } : { explanation: 'Name a size.', example: 'I need a medium.' })))) });
  out.push({ name: 'transport:gemini:turn:accepted', run: () => transport(turn, routeFor('gemini'), () => new Response(JSON.stringify(envelope('gemini',
    { move: 'recast', reply: 'Sure, you want to return it.', replyQuote: '', correction: 'I want to return this.', targetId: '', explanation: 'Add to.', rephrase: "I'd like to return this.", rephraseWhy: 'Polite.', spokenPunctuated: '' })))) });
  // B9 (V298, V300): Thorough falls back to the Fast model and Fast thinking; a Fast request never falls back.
  for (const provider of providers) {
    out.push({ name: `fallback:${provider}:thorough`, run: () => transport(requests.lesson!, routeFor(provider, { fallbackEnabled: true, fastModel: TUTOR_MODELS[provider].fast, fastThinkingOrEffort: 'auto' }),
      index => index === 0 ? unavailable() : new Response(JSON.stringify(envelope(provider, { ready: true })))) });
    out.push({ name: `fallback:${provider}:thoroughExplicitFastEffort`, run: () => transport(requests.review!, routeFor(provider, { fallbackEnabled: true, fastModel: TUTOR_MODELS[provider].fast, fastThinkingOrEffort: 'high' }),
      index => index === 0 ? unavailable() : new Response(JSON.stringify(envelope(provider, { ready: true })))) });
    out.push({ name: `fallback:${provider}:fast`, run: () => transport(hint, routeFor(provider, { fallbackEnabled: true, fastModel: TUTOR_MODELS[provider].fast }),
      index => index === 0 ? unavailable() : new Response(JSON.stringify(envelope(provider, { explanation: 'x', example: 'y' })))) });
  }
  out.push({ name: 'fallback:gemini:disabled', run: () => transport(requests.lesson!, routeFor('gemini', { fallbackEnabled: false, fastModel: TUTOR_MODELS.gemini.fast }),
    index => index === 0 ? unavailable() : new Response(JSON.stringify(envelope('gemini', { ready: true })))) });
  out.push({ name: 'fallback:gemini:settingsFastModel', run: () => transport(requests.lesson!, routeFor('gemini', { fallbackEnabled: true }),
    index => index === 0 ? unavailable() : new Response(JSON.stringify(envelope('gemini', { ready: true }))), { 'tutor.hintModel': 'gemini-3.6-flash-lite', 'tutor.hintThinkingOrEffort': 'medium' }) });
  out.push({ name: 'fallback:gemini:fastSameModel', run: () => transport(requests.lesson!, routeFor('gemini', { fallbackEnabled: true, fastModel: TUTOR_MODELS.gemini.thorough }),
    index => index === 0 ? unavailable() : new Response(JSON.stringify(envelope('gemini', { ready: true })))) });
  return out;
}

// Panel actions: the number, order and complete content of the requests each reader action sends.
const target = leaf;
function lessonFor(view: { tutorState: ReturnType<typeof createTutorViewState> }): TutorLesson {
  const current = tutorRecipeFromState(view.tutorState);
  return { schemaVersion: 1, mapVersion: current.mapVersion, level: 'B2', lessonTitle: 'Pattern',
    primaryTarget: { ...target, nodeId: target.id, role: 'primary' }, supportingTargets: [], conceptExplanation: 'Concept.',
    patternStatement: 'Each example uses this pattern.', interactionExplanation: 'Interaction.', rules: [{ statement: 'Use this pattern.', status: 'rule' }],
    commonErrors: [], generationNotes: [], examples: Array.from({ length: current.output.exampleCount }, (_, index) => ({
      id: `example-${index}`, sentence: `Today the careful team applies this useful English pattern in example number ${index}.`, targetIds: [target.id],
      annotations: [{ targetId: target.id, excerpt: `example number ${index}`, explanation: 'Why it fits.' }] })) } as TutorLesson;
}
function answerFor(request: TutorStructuredGenerationRequest, view?: { tutorState: ReturnType<typeof createTutorViewState> }): unknown {
  const body = (() => { try { return JSON.parse(request.input); } catch { return {}; } })();
  switch (request.kind) {
    case 'lesson': return lessonFor(view!);
    case 'exercises': return { schemaVersion: 1, mapVersion: body.recipe.mapVersion, channel: 'written', exercises: Array.from({ length: body.count }, (_, index) => ({
      id: `item-${index}`, channel: 'written', prompt: `Ask a colleague ___ help with task ${index}.`, targetIds: [target.id], exampleIndex: 0, expectedAnswer: 'for' })) };
    case 'review': return { schemaVersion: 1, exerciseId: body.exercise.id, learnerText: body.learnerAnswer, correct: [{ excerpt: body.learnerAnswer, reason: 'Natural.' }], incorrect: [] };
    case 'reviewBatch': return { reviews: body.items.map((item: { exercise: { id: string }; learnerAnswer: string }) => ({ schemaVersion: 1, exerciseId: item.exercise.id,
      learnerText: item.learnerAnswer, correct: [{ excerpt: item.learnerAnswer, reason: 'Natural.' }], incorrect: [] })) };
    case 'conversationOpening': return { scene: 'A busy shop on Saturday.', opening: 'Hi, how can I help you today?', tutorRole: 'shop assistant', learnerRole: 'customer' };
    case 'conversationTurn': return { move: 'reaction', reply: 'Sure, I can help with that.', replyQuote: '', correction: 'I want to return this shirt.', targetId: '',
      explanation: 'Add to after want.', rephrase: "I'd like to return this shirt.", rephraseWhy: 'More polite.', spokenPunctuated: '', nextQuestion: 'Do you have the receipt?' };
    case 'conversationHint': return { explanation: 'Say what you want to do.', example: 'I would like to exchange these shoes.' };
    case 'conversationCorrections': return { corrections: body.turns.map((turn: { learnerAnswer: string }) => ({ correction: turn.learnerAnswer, targetId: '',
      explanation: 'Already natural.', rephrase: turn.learnerAnswer, rephraseWhy: 'Already natural.', spokenPunctuated: '' })) };
    case 'conversationTakeHome': return { naturally: [], doneWell: [], tryNext: 'I would like to return this shirt, please.' };
    case 'conversationDiagnosis': return { targets: [{ targetId: target.id, role: 'primary' }], summary: 'Good.', findings: [], polish: [], focus: 'Requests.' };
    default: return {};
  }
}
const settle = async () => { for (let index = 0; index < 40; index++) await new Promise<void>(resolve => setImmediate(resolve)); };
function strip(request: TutorStructuredGenerationRequest) { return plain(request); }

function panelHarness(settings: Record<string, unknown> = {}) {
  const state = createTutorViewState();
  state.settings.routing = { ...state.settings.routing, provider: 'gemini', model: 'gemini-3.6-flash', thinkingOrEffort: 'auto' };
  state.settings.sentenceBand = 'medium'; state.selection = [{ nodeId: target.id, role: 'primary' }];
  const requests: unknown[] = [], lines: string[] = [];
  const view = { showMissingCredentialError: KrenResultsViewProvider.prototype.showMissingCredentialError, tutorState: state, tutorGeneration: 0,
    tutorConversationTurnGeneration: 0, proModels: [], liveModels: [], tutorReviewControllers: new Map(), tutorHintControllers: new Map(),
    tutorExampleControllers: new Map(), tutorConversationRawAnswers: new Map(), render: () => {},
    view: { webview: { html: '', postMessage: () => Promise.resolve(true) } },
    actions: { settings: () => ({ ...PANEL_SETTINGS_FIXTURE, tutorConversationTakeHome: true, tutorProfile: 'standard', tutorModel: 'gemini-3.6-flash', tutorFallbackEnabled: false, ...settings }),
      log: (line: string) => lines.push(line), notify: () => {}, stopReadAloud: () => {},
      generateTutor: async (selected: TutorStructuredGenerationRequest, route: TutorLanguageModelRoute) => {
        requests.push({ request: strip(selected), route: plain(route) }); return answerFor(selected, view as never);
      } }
  } as unknown as KrenResultsViewProvider;
  return { view, requests, lines };
}
function practice(view: KrenResultsViewProvider, count: number) {
  view.tutorState.exerciseSet = { schemaVersion: 1, mapVersion: '1.0.0', channel: 'written', exercises:
    Array.from({ length: count }, (_, index) => ({ id: `item-${index}`, channel: 'written', prompt: 'Write a sentence.', targetIds: [target.id] })) };
  view.tutorState.answers = Object.fromEntries(view.tutorState.exerciseSet.exercises.map(item => [item.id, `Answer ${item.id}.`]));
}

function conversationFixture(settings: Record<string, unknown> = {}, conversation: Record<string, unknown> = {}) {
  const requests: unknown[] = [];
  const actions = {
    settings: () => ({ ...PANEL_SETTINGS_FIXTURE, tutorProfile: 'standard', tutorConversationTakeHome: false, tutorFallbackEnabled: false, ...settings }),
    notify: vi.fn(), log: vi.fn(), stopReadAloud: vi.fn(), writeTutorPreferences: vi.fn(), updateSetting: vi.fn(async () => {}), readAloudText: vi.fn(async () => {}),
    generateTutor: vi.fn(async (request: TutorStructuredGenerationRequest, route: TutorLanguageModelRoute) => {
      requests.push({ request: strip(request), route: plain(route) }); return answerFor(request);
    })
  };
  const view = new KrenResultsViewProvider(actions as never, {} as never);
  (view as unknown as { activeScreen: string }).activeScreen = 'tutor';
  Object.assign(view.tutorState.conversation, { from: 'situation', situationId: situation.id, replies: 'standard', starts: 'kren', speakerOn: false,
    situationPicture: 'none', coaching: 'inline', register: 'neutral', replyLength: 'short', ...conversation });
  view.view = { webview: { cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }), html: '', postMessage: async () => true } } as never;
  return { view, requests, actions };
}
async function answer(view: KrenResultsViewProvider, text: string) {
  view.tutorState.conversation.draftAnswer = text; view.tutorState.conversation.draftAnswerSpoken = false;
  submitTutorConversationTurn(view); await settle();
}

function panelCases(): Case[] {
  const out: Case[] = [];
  const add = (name: string, run: () => Promise<unknown>) => out.push({ name: `panel:${name}`, run: async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.25);
    try { return plain(await run()); } finally { random.mockRestore(); }
  } });
  add('startLesson', async () => { const h = panelHarness(); startTutorLessonGeneration(h.view); await settle(); return { requests: h.requests }; });
  add('generateExercises', async () => {
    const h = panelHarness(); startTutorLessonGeneration(h.view); await settle();
    h.view.tutorState.viewedExampleIds = h.view.tutorState.lesson!.lesson.examples.map(item => item.id);
    const before = h.requests.length; generateTutorExercises(h.view); await settle(); return { requests: h.requests.slice(before) };
  });
  add('checkPracticeAnswer', async () => { const h = panelHarness(); practice(h.view, 1); const status = await reviewTutorExercise(h.view, 'item-0'); return { status, requests: h.requests }; });
  add('batchReview', async () => { const h = panelHarness(); practice(h.view, 3); await reviewUnreviewedTutorExercises(h.view); return { requests: h.requests, reviewed: Object.keys(h.view.tutorState.reviews) }; });
  const conversationRun = async (settings: Record<string, unknown>, conversation: Record<string, unknown>, steps: (view: KrenResultsViewProvider) => Promise<void>) => {
    vi.useFakeTimers({ now: 10_000, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const f = conversationFixture(settings, conversation);
    try {
      startTutorConversation(f.view); await settle();
      const opening = f.requests.length;
      await steps(f.view);
      return { opening, requests: f.requests, status: f.view.tutorState.conversation.status, transcript: f.view.tutorState.conversation.transcript.length };
    } finally { f.view.dispose(); vi.useRealTimers(); }
  };
  add('conversation:situationNamedTurns', () => conversationRun({}, {}, async view => { await answer(view, 'I want return this shirt.'); await answer(view, 'Yes I have it here.'); }));
  add('conversation:swappedLearnerStartsTeaching', () => conversationRun({}, { rolesSwapped: true, starts: 'learner', coaching: 'teaching', replyLength: 'brief', register: 'formal' },
    async view => { await answer(view, 'Good morning, I need help with a return.'); }));
  add('conversation:anything', () => conversationRun({}, { from: 'anything', replyLength: 'long' }, async view => { await answer(view, 'I went to the park yesterday.'); }));
  add('conversation:notShownTurn', () => conversationRun({}, {}, async view => { await answer(view, '안녕하세요 감사합니다'); await answer(view, 'Can I talk to your manager?'); }));
  add('conversation:hintOnDemand', () => conversationRun({ tutorConversationHintPrefetch: false }, {}, async view => {
    await vi.advanceTimersByTimeAsync(120_000); await writeTutorConversationHint(view); await settle(); await writeTutorConversationHint(view); await settle(); }));
  add('conversation:hintPrefetch', () => conversationRun({ tutorConversationHintPrefetch: true }, {}, async view => {
    await vi.advanceTimersByTimeAsync(120_000); await settle(); await writeTutorConversationHint(view); await settle(); }));
  add('conversation:standardStop', () => conversationRun({}, {}, async view => { await answer(view, 'I want return this shirt.'); await stopTutorConversation(view); await settle(); }));
  add('conversation:standardStopTakeHome', () => conversationRun({ tutorConversationTakeHome: true }, {}, async view => {
    await answer(view, 'I want return this shirt.'); await stopTutorConversation(view); await settle(); }));
  add('stop:liveAfterwardsDeferred', async () => {
    const f = conversationFixture({}, { status: 'active', replies: 'liveGemini', coaching: 'afterwards', tutorRole: 'shop assistant', learnerRole: 'customer',
      recipeTargets: { supportingTargets: [] }, currentQuestion: 'Anything else?', transcript: [
        { question: 'How can I help?', learnerAnswer: 'I want return this.', reply: 'Sure.', correction: '', explanation: '', coachingPending: true, spoken: true },
        { question: 'Skip.', learnerAnswer: '', correction: '', explanation: '', skipped: true },
        { question: 'Why?', learnerAnswer: 'It too small.', reply: 'I see.', correction: '', explanation: '', coachingPending: true }] });
    try { await stopTutorConversation(f.view); await settle(); return { requests: f.requests, transcript: f.view.tutorState.conversation.transcript.map(turn => turn.correction) }; }
    finally { f.view.dispose(); }
  });
  add('takeHome', async () => {
    const h = panelHarness();
    Object.assign(h.view.tutorState.conversation, { status: 'stopped', from: 'situation', situationId: situation.id, speakerOn: false, tutorRole: 'shop assistant', learnerRole: 'customer',
      transcript: [{ question: 'How can I help?', learnerAnswer: 'I want return this shirt.', correction: 'I want to return this shirt.', explanation: 'x', reply: 'Sure.' }] });
    finalizeTutorTakeHome(h.view); await settle(); return { requests: h.requests };
  });
  add('diagnosticReport', async () => {
    const f = conversationFixture({}, { status: 'stopped', tutorRole: 'shop assistant', learnerRole: 'customer', recipeTargets: { supportingTargets: [] },
      transcript: Array.from({ length: 6 }, (_, index) => ({ question: `Question ${index}?`, learnerAnswer: `Answer number ${index}.`, reply: 'Okay.',
        correction: `Answer number ${index}.`, explanation: 'Natural.', rephrase: `Answer ${index}.`, rephraseWhy: 'Short.', ...(index === 2 ? { skipped: true } : {}) })) });
    try { await diagnoseTutorConversation(f.view); await settle(); return { requests: f.requests }; } finally { f.view.dispose(); }
  });
  return out;
}

export const v312Cases: Case[] = [...builderCases(), ...readerCases(), ...transportCases(), ...panelCases()];
