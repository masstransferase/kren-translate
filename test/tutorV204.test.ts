import type { TrainingReview } from '@kren/core/tutor';
import { describe, expect, it } from 'vitest';
import { createTutorViewState } from '../src/tutor/state.js';
import { tutorLessonConversationContext, tutorLessonConversationReadiness, tutorTargetMarks, tutorTargetRanges, tutorLiveTargetMarks, tutorMarkedSegments, TUTOR_LESSON_UNAVAILABLE } from '../src/tutor/lessonConversation.js';
import { tutorConversationOpening, tutorConversationTurn, tutorConversationOpeningRequest, tutorConversationTurnRequest, tutorConversationHintRequest, tutorConversationCorrectionsRequest, tutorConversationDemoCastRequest, tutorConversationDemoBatchRequest, tutorConversationLiveSystemInstruction, TUTOR_PRIVACY_INSTRUCTION, TUTOR_CONVERSATION_SCENE_SLANTS } from '../src/tutor/generation.js';

function completed() {
  const state = createTutorViewState();
  // A projection fixture deliberately contains unrelated fields that must never be forwarded.
  state.lesson = { recipe: {}, findings: [], lesson: {
    lessonTitle: 'Requests', primaryTarget: { nodeId: 'primary', label: 'Polite requests', description: 'Use could.' },
    supportingTargets: [{ nodeId: 'support', label: 'Reasons', description: 'Use because.' }],
    examples: [{ id: 'e', sentence: 'Could you help because I am late?', targetIds: ['primary', 'support'],
      annotations: [{ targetId: 'primary', excerpt: 'Could you', explanation: 'UNRELATED' }] }],
    editorText: 'EDITOR', filePath: 'PATH', dictionaryResponse: 'DICTIONARY', credential: 'CREDENTIAL', history: 'HISTORY'
  } } as never;
  state.lessonRevision = 2;
  state.practiceLessonRevision = 2;
  state.viewedExampleIds = ['e'];
  state.exerciseSet = { exercises: [{ id: 'p', prompt: 'Request help.', targetIds: ['primary'] }] } as never;
  state.reviews = { p: { learnerText: 'Help me.', correct: [], incorrect: [{ text: 'Help' }], explanation: 'UNRELATED' } } as never;
  state.answers.p = 'EDITED';
  return state;
}

describe('V204 lesson conversation', () => {
  it('availability probe: a Primary without a drafted lesson remains unavailable', () => {
    const state = createTutorViewState();
    state.selection = [{ nodeId: 'primary', role: 'primary' }];
    expect(tutorLessonConversationReadiness(state)).toEqual({ ready: false, reason: TUTOR_LESSON_UNAVAILABLE });
  });
  it('requires all current examples and reviews with matching revision, including busy/failure invalidation', () => {
    const state = completed();
    expect(tutorLessonConversationReadiness(state).ready).toBe(true);
    for (const patch of [ { lesson: undefined }, { viewedExampleIds: [] }, { exerciseSet: undefined }, { reviews: {} },
      { practiceLessonRevision: 1 }, { practiceLessonRevision: undefined }, { lessonBusy: true }, { exerciseBusy: true } ]) {
      expect(tutorLessonConversationReadiness({ ...state, ...patch }).ready).toBe(false);
    }
    state.reviews.p = { ...state.reviews.p!, correct: [{ text: 'Help' }], incorrect: [] } as never;
    expect(tutorLessonConversationReadiness(state).ready).toBe(true);
    expect(tutorLessonConversationContext(state).missedPractice).toEqual([]);
    state.lesson!.lesson.examples.push({ ...state.lesson!.lesson.examples[0]!, id: 'second' });
    expect(tutorLessonConversationReadiness(state).ready).toBe(false);
    state.viewedExampleIds.push('second');
    state.exerciseSet!.exercises.push({ ...state.exerciseSet!.exercises[0]!, id: 'second' });
    expect(tutorLessonConversationReadiness(state).ready).toBe(false);
    state.reviews.second = { ...(state.reviews.p as TrainingReview), exerciseId: 'second' };
    expect(tutorLessonConversationReadiness(state).ready).toBe(true);
  });
  it('freezes exactly the lesson projection and uses the reviewed answer', () => {
    const state = completed();
    const context = tutorLessonConversationContext(state);
    expect(context).toEqual({ subject: 'Requests', targets: [
      { targetId: 'primary', role: 'primary', label: 'Polite requests', description: 'Use could.' },
      { targetId: 'support', role: 'support', label: 'Reasons', description: 'Use because.' }
    ], examples: [{ sentence: 'Could you help because I am late?', targetIds: ['primary', 'support'],
      annotations: [{ targetId: 'primary', excerpt: 'Could you' }] }],
    missedPractice: [{ exerciseId: 'p', prompt: 'Request help.', targetIds: ['primary'], learnerText: 'Help me.' }] });
    expect(Object.isFrozen(context.examples[0]!.annotations)).toBe(true);
    state.answers.p = 'Changed again';
    state.selection = [];
    expect(context.missedPractice[0]!.learnerText).toBe('Help me.');
  });
  it('pictures probe: opening carries lesson and selected cafe setting together', () => {
    const lessonContext = tutorLessonConversationContext(completed());
    // Changed 2026-10-15: V242, owner item I14, use the revised busy slant in this opening fixture.
    const request = tutorConversationOpeningRequest({ kind: 'lesson', register: 'neutral', sceneSlant: TUTOR_CONVERSATION_SCENE_SLANTS[6],
      primaryTargetLabel: 'Polite requests', supportingTargetLabels: ['Reasons'], setting: 'At a cafe.', rolesSwapped: true, lessonContext });
    expect(JSON.parse(request.input)).toMatchObject({ setting: 'At a cafe.', rolesSwapped: true, lessonContext });
    expect(request.instruction).not.toContain('Today we');
  });
  it('targets probe: every builder and Live setup carries exactly the same projection', () => {
    const lessonContext = tutorLessonConversationContext(completed());
    const common = { lessonContext, register: 'neutral' as const };
    // Changed 2026-10-15: V242, owner item I14, use the revised busy slant in this shared opening fixture.
    const opening = { ...common, kind: 'lesson' as const, primaryTargetLabel: 'Polite requests', supportingTargetLabels: ['Reasons'],
      setting: 'At a cafe.', sceneSlant: TUTOR_CONVERSATION_SCENE_SLANTS[6] };
    const cast = { scene: 'Cafe.', male: { name: 'M', role: 'guest', description: 'Guest.' }, female: { name: 'F', role: 'server', description: 'Server.' } };
    const requests = [tutorConversationOpeningRequest(opening),
      tutorConversationTurnRequest({ ...common, recipeTargets: { supportingTargets: ['support'] }, question: 'Hello?', learnerAnswer: 'Hi.', transcript: [] }),
      tutorConversationHintRequest({ ...common, question: 'Hello?', setting: 'Cafe.', recentTurns: [] }),
      tutorConversationCorrectionsRequest({ ...common, recipeTargets: { supportingTargets: ['support'] }, turns: [] }),
      tutorConversationDemoCastRequest({ ...opening, counterpartGender: 'male', readerSideGender: 'female' }),
      tutorConversationDemoBatchRequest({ ...common, ...cast, transcript: [], exchanges: 1 })];
    for (const request of requests) {
      expect(JSON.parse(request.input).lessonContext).toEqual(lessonContext);
      expect(request.instruction).toContain(TUTOR_PRIVACY_INSTRUCTION);
      expect(request.instruction).toContain('avoiding a target is not itself an error');
      expect(request.input).not.toMatch(/EDITOR|PATH|DICTIONARY|CREDENTIAL|HISTORY|UNRELATED|EDITED/);
    }
    expect(tutorConversationLiveSystemInstruction(opening, false)).toContain(JSON.stringify(lessonContext));
  });
  it('resolves exact Unicode occurrences, rejects invalid/overlapping marks and locally matches Live excerpts', () => {
    const text = '😀 <could> <could>';
    const marks = tutorTargetMarks([
      { field: 'reply', targetId: 'primary', quote: '<could>', occurrence: 1 },
      { field: 'reply', targetId: 'primary', quote: 'could', occurrence: 1 },
      { field: 'reply', targetId: 'other', quote: '😀', occurrence: 0 },
      { field: 'reply', targetId: 'primary', quote: 'missing', occurrence: 0 },
      { field: 'reply', targetId: 'primary', quote: '😀', occurrence: -1 }
    ], { reply: text }, ['primary']);
    expect(marks).toHaveLength(1);
    expect(tutorTargetRanges(text, 'reply', marks)).toEqual([{ start: 11, end: 18 }]);
    const context = tutorLessonConversationContext(completed());
    expect(tutorLiveTargetMarks('Could you wait?', 'reply', context)).toEqual([
      { field: 'reply', targetId: 'primary', quote: 'Could you', occurrence: 0 }
    ]);
  });
  it('parses opening/current-question marks independently from correction quotes and keeps replies with invalid marks', () => {
    const mark = { field: 'opening', targetId: 'primary', quote: 'Could you', occurrence: 0 };
    // 2026-10-11: Target marks accompany the opening's required concrete roles.
    expect(tutorConversationOpening({ tutorRole: 'server', learnerRole: 'customer', scene: 'Cafe.', opening: 'Could you help?', targetMarks: [mark] }, true, ['primary']).targetMarks).toEqual([mark]);
    const response = { move: 'reaction', reply: 'Could you help?', replyQuote: 'help', correction: 'I need help.', targetId: '',
      explanation: 'Natural.', rephrase: 'I need help.', rephraseWhy: 'Natural.', nextQuestion: 'Could you wait?',
      targetMarks: [{ ...mark, field: 'reply' }, { ...mark, field: 'nextQuestion' }, { ...mark, targetId: 'unrelated' }] };
    const turn = tutorConversationTurn(response, false, ['primary']);
    expect(turn.replyQuote).toBe('help');
    // Changed 2026-10-15: V242, owner item I10, marks survive only for text shown after the second question is dropped.
    expect(turn.targetMarks).toHaveLength(1);
    expect(turn.targetMarks?.map((item) => item.field)).toEqual(['reply']);
    expect(tutorConversationTurn({ ...response, targetMarks: [{ ...mark, occurrence: 99 }] }, false, ['primary']).reply).toBe('Could you help?');
  });
  it('composes a correction overlapping a target while preserving all original text', () => {
    const segments = tutorMarkedSegments('😀 Could you help?', [{ start: 3, end: 12 }], 'you help');
    expect(segments.map((item) => item.text).join('')).toBe('😀 Could you help?');
    expect(segments.filter((item) => item.target).map((item) => item.text).join('')).toBe('Could you');
    expect(segments.filter((item) => item.correction).map((item) => item.text).join('')).toBe('you help');
    expect(segments.some((item) => item.target && item.correction)).toBe(true);
  });
});
