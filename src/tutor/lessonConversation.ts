import { TUTOR_SITUATIONS, tutorTargetMarks, type TutorLessonConversationContext, type TutorTargetMark, type TutorTargetRange } from '@kren/core/tutor';
import { tutorAllExamplesViewed, tutorPracticeResults, type TutorViewState } from './state.js';

// The context type, the target-mark reader and the lesson-target instruction moved into core 0.42.0 (V312).
export { TUTOR_LESSON_TARGET_INSTRUCTION, tutorTargetRanges, tutorTargetMarks } from '@kren/core/tutor';
export type { TutorLessonConversationContext, TutorTargetMark, TutorTargetRange } from '@kren/core/tutor';

export const TUTOR_LESSON_UNAVAILABLE = 'Finish the lesson and its practice first.';

export function tutorLessonConversationRemaining(state: TutorViewState): string {
  if (!state.lesson) return 'No lesson drafted yet.';
  const examples = state.lesson.lesson.examples;
  const unseen = examples.filter((example) => !state.viewedExampleIds.includes(example.id)).length;
  const practice = state.practiceLessonRevision === state.lessonRevision ? state.exerciseSet?.exercises : undefined;
  const unreviewed = practice?.filter((item) => !state.reviews[item.id]).length;
  const parts = [unseen ? `${unseen} of ${examples.length} examples not viewed` : '',
    !practice?.length ? 'No current practice reviewed yet' : unreviewed ? `${unreviewed} of ${practice.length} practice items not reviewed` : ''].filter(Boolean);
  return parts.length ? parts.join('; ') : 'Lesson or practice work is still in progress.';
}

/** A stale set remains readable, but cannot block practice for the current lesson. */
export function tutorPracticeBelongsToLesson(state: TutorViewState): boolean {
  return Boolean(state.exerciseSet && state.practiceLessonRevision === state.lessonRevision);
}

export function tutorLessonConversationReadiness(state: TutorViewState): { ready: boolean; reason?: string } {
  const ready = Boolean(state.lesson && state.lessonRevision !== undefined &&
    state.practiceLessonRevision === state.lessonRevision && !state.lessonBusy && !state.exerciseBusy &&
    !state.exampleBusyIds.length && !state.reviewBusyIds.length && !state.practiceReviewBatch &&
    tutorAllExamplesViewed(state) && tutorPracticeResults(state));
  return ready ? { ready } : { ready, reason: TUTOR_LESSON_UNAVAILABLE };
}

/** Only this projection leaves the session. Reviewed text, never the editable answer, is used. */
export function tutorLessonConversationContext(state: TutorViewState): TutorLessonConversationContext {
  if (!tutorLessonConversationReadiness(state).ready) throw new Error(TUTOR_LESSON_UNAVAILABLE);
  const lesson = state.lesson!.lesson;
  const target = (item: NonNullable<typeof lesson.primaryTarget>, role: 'primary' | 'support') => ({
    targetId: item.nodeId, role, label: item.label, description: item.description
  });
  const targets = [
    ...(lesson.primaryTarget ? [target(lesson.primaryTarget, 'primary')] : []),
    ...lesson.supportingTargets.map((item) => target(item, 'support'))
  ];
  const ids = new Set(targets.map((item) => item.targetId));
  const context = {
    subject: lesson.lessonTitle,
    targets,
    examples: lesson.examples.map(({ sentence, targetIds, annotations }) => ({
      sentence, targetIds: targetIds.filter((id) => ids.has(id)),
      annotations: annotations.filter(({ targetId }) => ids.has(targetId))
        .map(({ targetId, excerpt }) => ({ targetId, excerpt }))
    })),
    missedPractice: tutorPracticeResults(state)!.missed.map(({ id, prompt, targetIds }) => ({
      exerciseId: id, prompt, targetIds: [...targetIds], learnerText: state.reviews[id]!.learnerText
    }))
  };
  return freezeLessonContext(context);
}

function freezeLessonContext<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeLessonContext);
    Object.freeze(value);
  }
  return value;
}

/** Resolve once at Start. The setup choice remains visible while the resolution is session-only. */
export function resolveTutorConversationSituation(id: string, random = Math.random): string {
  return id === 'auto' ? TUTOR_SITUATIONS[Math.min(TUTOR_SITUATIONS.length - 1,
    Math.max(0, Math.floor(random() * TUTOR_SITUATIONS.length)))]!.id : id;
}

/** Shared segmentation lets correction and target marks overlap without either erasing the other. */
export function tutorMarkedSegments(text: string, ranges: readonly TutorTargetRange[] = [], quote = '') {
  const correctionStart = quote ? text.indexOf(quote) : -1;
  const correctionEnd = correctionStart < 0 ? -1 : correctionStart + quote.length;
  const valid = ranges.filter((range) => Number.isInteger(range.start) && Number.isInteger(range.end) &&
    range.start >= 0 && range.end <= text.length && range.start < range.end);
  const boundaries = [...new Set([0, text.length, ...valid.flatMap((range) => [range.start, range.end]),
    ...(correctionStart < 0 ? [] : [correctionStart, correctionEnd])])].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1]!;
    return { text: text.slice(start, end), target: valid.some((range) => range.start <= start && range.end >= end),
      correction: correctionStart >= 0 && correctionStart <= start && correctionEnd >= end };
  });
}

/** Literal excerpts only. Live cannot reliably detect abstract grammar or inflected variants. */
export function tutorLiveTargetMarks(text: string, field: TutorTargetMark['field'], context?: TutorLessonConversationContext): TutorTargetMark[] {
  const marks: TutorTargetMark[] = [];
  for (const annotation of context?.examples.flatMap((example) => example.annotations) ?? []) {
    if (!annotation.excerpt) continue;
    let start = -1;
    let occurrence = 0;
    while ((start = text.indexOf(annotation.excerpt, start + 1)) >= 0) {
      marks.push({ field, targetId: annotation.targetId, quote: annotation.excerpt, occurrence: occurrence++ });
    }
  }
  return tutorTargetMarks(marks, { [field]: text }, context?.targets.map((target) => target.targetId) ?? []);
}
