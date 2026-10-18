import { runTutorContentRequest, recordedRequestOutcome } from './requestCenter.js';
import { ProviderError } from './errors.js';
import { tutorProviderSwitchMessage } from './languageModelSwitching.js';
import type { KrenResultsViewProvider } from './resultsView.js';
import { cancelTutorSessionDictation } from './resultsViewDictation.js';
import { tutorLanguageModelRoute } from './resultsViewConversation.js';
import { tutorFailureMessage } from './resultsViewErrors.js';
import { tutorExampleQuestionRequest, tutorConversationDiagnosisRequest, tutorPracticeQuestionRequest, tutorDiagnosticReport, tutorProseAnswer, tutorReviewGenerationRequest, tutorReviewBatchGenerationRequest, type TutorReviewRequestBody } from './tutor/generation.js';
import { activeTutorTargetIds, tutorExerciseById, tutorPracticeResults, tutorFindingMessage, tutorPracticeReviewEligibility, tutorPracticeReviewBusy, type TutorPracticeReview } from './tutor/state.js';
import { validateTrainingReview, type TrainingReview } from '@kren/core/tutor';

export function cancelTutorPracticeDiagnosis(view: KrenResultsViewProvider): void {
    view.tutorPracticeDiagnosisController?.abort();
    view.tutorPracticeDiagnosisController = undefined;
    view.tutorState = {
      ...view.tutorState, practiceDiagnosisBusy: false,
      practiceDiagnosisMessage: 'Practice diagnosis was canceled. Your results are still available.'
    };
  }

export function invalidateTutorPracticeReport(view: KrenResultsViewProvider): void {
    if (view.tutorPracticeDiagnosisController) cancelTutorPracticeDiagnosis(view);
    view.tutorState = {
      ...view.tutorState, practiceDiagnosisRequested: false, practiceDiagnosisMessage: undefined,
      ...(view.tutorState.diagnosticReportSource?.kind === 'practice' ? {
        diagnosticReport: undefined, diagnosticReportSource: undefined,
        diagnosticReportDrawerOpen: false, diagnosticReportMessage: undefined
      } : {})
    };
  }

export async function diagnoseTutorPractice(view: KrenResultsViewProvider): Promise<void> {
    const results = tutorPracticeResults(view.tutorState);
    if (!results || view.tutorState.practiceDiagnosisBusy) return;
    if (view.tutorState.diagnosticReportSource?.kind === 'practice' && view.tutorState.diagnosticReport) {
      view.tutorState = { ...view.tutorState, diagnosticReportDrawerOpen: true,
        preparedPromptDrawerOpen: false };
      view.render();
      return;
    }
    const exerciseSet = view.tutorState.exerciseSet!;
    const reviews = view.tutorState.reviews;
    // Keep exact correction pairs because spans have no offsets and can overlap or repeat.
    // The existing diagnosis transport takes strings; no second report contract is needed.
    const turns = exerciseSet.exercises.map((exercise) => {
      const review = reviews[exercise.id]!;
      return {
        question: JSON.stringify({ id: exercise.id, channel: exercise.channel, prompt: exercise.prompt, targetIds: exercise.targetIds }),
        learnerAnswer: review.learnerText,
        correction: review.incorrect.length
          ? JSON.stringify(review.incorrect.map(({ excerpt, corrected }) => ({ excerpt, corrected })))
          : review.learnerText,
        explanation: '', nextQuestion: ''
      };
    });
    const request = tutorConversationDiagnosisRequest(turns, view.tutorState.settings);
    request.instruction += '\nThis written exchange is a completed practice set. Each question holds the exercise prompt and its named targetIds. Each correction is either the unchanged correct answer or exact excerpt/corrected pairs from its review. Count practice items as turns. Diagnose patterns across those named targets.';
    const controller = new AbortController();
    view.tutorPracticeDiagnosisController = controller;
    const learnerLevel = view.tutorState.settings.learnerLevel;
    view.tutorState = {
      ...view.tutorState, practiceDiagnosisRequested: true, practiceDiagnosisBusy: true,
      practiceDiagnosisMessage: undefined
    };
    view.render();
    try {
      const response = await runTutorContentRequest({ request, route: tutorLanguageModelRoute(view), signal: controller.signal,
        generate: view.actions.generateTutor.bind(view.actions), contentRetry: { allowance: 0 }, log: line => view.actions.log(line),
        validate: value => { tutorDiagnosticReport(value, turns.map(turn => turn.learnerAnswer), learnerLevel); return { type: 'accepted', value }; }
      });
      if (controller.signal.aborted || view.tutorPracticeDiagnosisController !== controller ||
          view.tutorState.exerciseSet !== exerciseSet || view.tutorState.reviews !== reviews) return;
      const report = tutorDiagnosticReport(response, turns.map((turn) => turn.learnerAnswer), learnerLevel);
      view.tutorState = {
        ...view.tutorState, diagnosticReport: report,
        diagnosticReportSource: { kind: 'practice', itemCount: results.attempted },
        diagnosticReportDrawerOpen: true, preparedPromptDrawerOpen: false,
        diagnosticReportMessage: undefined
      };
    } catch (error) {
      if (controller.signal.aborted) return;
      view.actions.log(`Tutor practice diagnosis failed: ${tutorFailureMessage(error)}`);
      view.tutorState = {
        ...view.tutorState,
        practiceDiagnosisMessage: 'The practice analysis failed. Your score, target results and missed items are still available.'
      };
    } finally {
      if (view.tutorPracticeDiagnosisController === controller) {
        view.tutorPracticeDiagnosisController = undefined;
        view.tutorState = { ...view.tutorState, practiceDiagnosisBusy: false };
        view.render();
      }
    }
  }

function validatedTutorReview(value: unknown, exerciseId: string, answer: string, prompt: string, log: (line: string) => void): TutorPracticeReview {
  let review = value as TutorPracticeReview;
  // 2026-10-15: V240 accepts sentence context only where it identifies the inserted answer.
  const parts = prompt.split(/_{3,}/u);
  if (parts.length === 2 && review && review.learnerText === answer &&
      Array.isArray(review.correct) && Array.isArray(review.incorrect)) {
    const start = parts[0]!.length;
    const end = start + answer.length;
    const sentence = parts[0]! + answer + parts[1]!;
    const project = <T extends { excerpt: string }>(span: T): T => {
      if (!span || typeof span.excerpt !== 'string' || !span.excerpt || answer.includes(span.excerpt)) return span;
      const at = sentence.indexOf(span.excerpt);
      if (at < 0 || sentence.indexOf(span.excerpt, at + 1) >= 0) return span;
      const left = Math.max(start, at);
      const right = Math.min(end, at + span.excerpt.length);
      if (left >= right) return span;
      const projected = { ...span, excerpt: sentence.slice(left, right) };
      if ('corrected' in span && typeof span.corrected === 'string') {
        const before = sentence.slice(at, left);
        const after = sentence.slice(right, at + span.excerpt.length);
        if (span.corrected.startsWith(before) && span.corrected.endsWith(after) &&
            span.corrected.length > before.length + after.length) {
          return { ...projected, corrected: span.corrected.slice(before.length, span.corrected.length - after.length) };
        }
      }
      return projected;
    };
    review = { ...review, correct: review.correct.map(project), incorrect: review.incorrect.map(project) };
  }
  const findings = validateTrainingReview(review);
  if (review.exerciseId !== exerciseId || review.learnerText !== answer) {
    throw new Error('The review did not match this exercise and answer.');
  }
  if (findings.length > 0) throw new Error([...new Set(findings.map(finding => tutorFindingMessage(finding, { log })))].join(' '));
  const { focusPhrase, ...contract } = review;
  return typeof focusPhrase === 'string' && focusPhrase.trim() && review.correctedText?.includes(focusPhrase.trim())
    ? { ...contract, focusPhrase: focusPhrase.trim() } : contract;
}

export async function reviewTutorExercise(view: KrenResultsViewProvider, exerciseId: string,
    batchOwner?: AbortController, initial?: { value: unknown; source?: unknown }): Promise<'success' | 'failed' | 'canceled'> {
    const exercise = tutorExerciseById(view.tutorState, exerciseId);
    const exerciseSet = view.tutorState.exerciseSet;
    const answer = view.tutorState.answers[exerciseId]?.trim();
    if (!exercise || !answer || view.tutorReviewControllers.has(exerciseId) ||
        (view.tutorReviewBatchController && view.tutorReviewBatchController !== batchOwner)) return 'canceled';
    const body: TutorReviewRequestBody = {
      learnerAnswer: answer,
      exercise,
      activeTargets: activeTutorTargetIds(view.tutorState)
    };
    const controller = new AbortController();
    view.tutorReviewControllers.set(exerciseId, controller);
    view.tutorState = {
      ...view.tutorState,
      reviewBusyIds: [...view.tutorState.reviewBusyIds, exerciseId]
    };
    view.render();
    const current = () => !controller.signal.aborted &&
      view.tutorReviewControllers.get(exerciseId) === controller &&
      view.tutorState.exerciseSet === exerciseSet && view.tutorState.answers[exerciseId]?.trim() === answer;
    const route = tutorLanguageModelRoute(view);
    let response: unknown;
    let onAbort: (() => void) | undefined;
    try {
      // Settle cancellation even if a provider ignores its AbortSignal; ignore its late reply.
      const canceled = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new Error('Review canceled.'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      const review = await Promise.race([runTutorContentRequest({
        request: tutorReviewGenerationRequest(body), route, signal: controller.signal,
        generate: view.actions.generateTutor.bind(view.actions), initial,
        contentRetry: { allowance: initial ? 1 : 0 }, log: line => view.actions.log(line),
        validate: value => {
          response = value;
          try { return { type: 'accepted', value: validatedTutorReview(value, exerciseId, answer, exercise.prompt, line => view.actions.log(line)) }; }
          catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            view.actions.log(`Tutor review validation threw: ${detail}`);
            return { type: 'rejected', cause: 'contentRejected', codes: ['contentRejected'],
              error: new Error(`AI English Tutor could not read the review it received. ${detail}`) };
          }
        }
      }), canceled]);
      if (!current()) return 'canceled';
      invalidateTutorPracticeReport(view);
      view.tutorState = {
        ...view.tutorState,
        reviews: { ...view.tutorState.reviews, [exerciseId]: review },
        reviewFailures: { ...view.tutorState.reviewFailures, [exerciseId]: '' }
      };
      if (!batchOwner && view.tutorState.practiceReviewBatchMessage) {
        const items = exerciseSet!.exercises;
        const saved = items.filter(item => view.tutorState.reviews[item.id] &&
          view.tutorState.reviews[item.id]!.learnerText === view.tutorState.answers[item.id]?.trim()).length;
        const failed = items.flatMap((item, index) => view.tutorState.reviewFailures[item.id] ? [index + 1] : []);
        view.tutorState = { ...view.tutorState,
          practiceReviewBatchMessage: `${saved} review${saved === 1 ? '' : 's'} saved.${failed.length ? ` Retry item${failed.length === 1 ? '' : 's'} ${failed.join(', ')}.` : ''}` };
      }
      return 'success';
    } catch (error: unknown) {
      if (!current()) return 'canceled';
      view.tutorState = {
        ...view.tutorState,
        reviewFailures: {
          ...view.tutorState.reviewFailures,
          [exerciseId]: tutorProviderSwitchMessage(response ?? error, route.provider, 'review', tutorFailureMessage(error))
        }
      };
      return 'failed';
    } finally {
      if (onAbort) controller.signal.removeEventListener('abort', onAbort);
      if (view.tutorReviewControllers.get(exerciseId) === controller) {
        view.tutorReviewControllers.delete(exerciseId);
        view.tutorState = { ...view.tutorState,
          reviewBusyIds: view.tutorState.reviewBusyIds.filter((id) => id !== exerciseId) };
        view.render();
      }
    }
  }

/** Explicit last-page action; validates and commits a batch in exercise order. */
export async function reviewUnreviewedTutorExercises(view: KrenResultsViewProvider): Promise<void> {
  const eligibility = tutorPracticeReviewEligibility(view.tutorState);
  if (tutorPracticeReviewBusy(view.tutorState) || view.tutorReviewBatchController ||
      eligibility.firstUnansweredIndex >= 0 || !eligibility.pending.length) return;
  const exerciseSet = view.tutorState.exerciseSet;
  const queue = eligibility.pending.map((item) => ({ id: item.id, answer: view.tutorState.answers[item.id]! }));
  const owner = new AbortController();
  if (view.tutorState.speech.dictatingExerciseId || view.tutorState.speech.transcribingExerciseId ||
      (view.geminiDictationStart && 'exerciseId' in view.geminiDictationStart.target)) {
    cancelTutorSessionDictation(view);
  }
  view.tutorReviewBatchController = owner;
  view.tutorState = { ...view.tutorState, practiceReviewBatch: { completed: 0, total: queue.length },
    practiceReviewBatchMessage: undefined };
  view.render();
  const failed: number[] = [];
  let completed = 0;
  let succeeded = 0;
  let refusal: string | undefined;
  try {
    const current = () => !owner.signal.aborted && view.tutorReviewBatchController === owner &&
      view.tutorState.exerciseSet === exerciseSet;
    let onAbort: (() => void) | undefined;
    let values: unknown[] = [];
    let batchResponse: unknown;
    for (const item of queue) view.tutorReviewControllers.set(item.id, owner);
    view.tutorState = { ...view.tutorState, reviewBusyIds: queue.map((item) => item.id) };
    view.render();
    try {
      const canceled = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new Error('Review canceled.'));
        owner.signal.addEventListener('abort', onAbort, { once: true });
      });
      const result = await Promise.race([runTutorContentRequest({ request:
        tutorReviewBatchGenerationRequest(queue.map((item) => ({
          exercise: tutorExerciseById(view.tutorState, item.id)!, learnerAnswer: item.answer.trim(),
          activeTargets: activeTutorTargetIds(view.tutorState)
        }))), route: tutorLanguageModelRoute(view), signal: owner.signal,
        generate: view.actions.generateTutor.bind(view.actions), contentRetry: { allowance: 0 }, log: line => view.actions.log(line),
        validate: value => value && typeof value === 'object' && Array.isArray((value as { reviews?: unknown }).reviews)
          ? { type: 'accepted', value }
          : { type: 'rejected', cause: 'contentRejected', codes: ['requiredField'] }
      }), canceled]);
      batchResponse = result;
      if (result && typeof result === 'object' && Array.isArray((result as { reviews?: unknown }).reviews)) {
        values = (result as { reviews: unknown[] }).reviews;
      }
    } catch (error) {
      if (current()) view.actions.log(`Tutor batch review failed: ${tutorFailureMessage(error)}`);
      const outcome = recordedRequestOutcome(error);
      if (error instanceof ProviderError && error.reason === 'refused' || outcome?.type === 'failed' && outcome.cause === 'refused') {
        refusal = tutorFailureMessage(error);
        return;
      }
    } finally {
      if (onAbort) owner.signal.removeEventListener('abort', onAbort);
      for (const item of queue) {
        if (view.tutorReviewControllers.get(item.id) === owner) view.tutorReviewControllers.delete(item.id);
      }
      view.tutorState = { ...view.tutorState, reviewBusyIds: view.tutorState.reviewBusyIds.filter((id) =>
        !queue.some((item) => item.id === id) || view.tutorReviewControllers.has(id)) };
    }
    for (const item of queue) {
      if (!current() || view.tutorState.answers[item.id] !== item.answer) break;
      if (view.tutorState.reviews[item.id]?.learnerText === item.answer.trim()) continue;
      const matching = values.filter((value) => value && typeof value === 'object' &&
        (value as TrainingReview).exerciseId === item.id);
      const outcome = await reviewTutorExercise(view, item.id, owner, { value: matching.length === 1 ? matching[0] : undefined, source: batchResponse });
      if (outcome === 'canceled') break;
      completed++;
      if (outcome === 'success') succeeded++;
      else failed.push(exerciseSet!.exercises.findIndex((exercise) => exercise.id === item.id) + 1);
      if (!current()) break;
      view.tutorState = { ...view.tutorState, practiceReviewBatch: { completed, total: queue.length } };
    }
  } finally {
    if (view.tutorReviewBatchController === owner) {
      view.tutorReviewBatchController = undefined;
      if (view.tutorState.exerciseSet === exerciseSet) {
        view.tutorState = { ...view.tutorState, practiceReviewBatch: undefined,
          practiceReviewBatchMessage: refusal ?? `${owner.signal.aborted ? 'Review canceled. ' : ''}${succeeded} new review${succeeded === 1 ? '' : 's'} saved.${failed.length ? ` Retry item${failed.length === 1 ? '' : 's'} ${failed.join(', ')}.` : ''}`,
          currentExerciseIndex: 0, practiceMissedOnly: false, practiceReviewAll: true, practiceResultsOpened: false };
        view.render();
      }
    }
  }
}

export function cancelTutorReviewBatch(view: KrenResultsViewProvider): void {
  if (!view.tutorReviewBatchController) return;
  view.tutorReviewBatchController.abort();
  for (const [id, controller] of view.tutorReviewControllers) {
    controller.abort();
    view.tutorState = { ...view.tutorState, reviewFailures: {
      ...view.tutorState.reviewFailures, [id]: 'This review was canceled. Retry Review.'
    } };
  }
}

export function cancelTutorPracticeHint(view: KrenResultsViewProvider, exerciseId: string): void {
    view.tutorHintControllers.get(exerciseId)?.abort();
    view.tutorHintControllers.delete(exerciseId);
    view.tutorState = {
      ...view.tutorState,
      exerciseHintBusyIds: view.tutorState.exerciseHintBusyIds.filter((id) => id !== exerciseId)
    };
    view.render();
  }

export function cancelTutorReview(view: KrenResultsViewProvider, exerciseId: string): void {
    view.tutorReviewControllers.get(exerciseId)?.abort();
    view.tutorReviewControllers.delete(exerciseId);
    view.tutorState = {
      ...view.tutorState,
      reviewBusyIds: view.tutorState.reviewBusyIds.filter((id) => id !== exerciseId),
      reviewFailures: {
        ...view.tutorState.reviewFailures,
        [exerciseId]: 'This review was canceled.'
      }
    };
    view.render();
  }

export function openTutorTool(view: KrenResultsViewProvider, exampleId: string, tool: 'dictionary' | 'translate' | 'ask'): void {
    const example = view.tutorState.lesson?.lesson.examples.find((item) => item.id === exampleId);
    if (!example) return;
    view.tutorToolController?.abort();
    view.tutorToolController = undefined;
    view.tutorState = {
      ...view.tutorState,
      toolDrawer: {
        tool,
        // Dictionary teaches the annotated expression while retaining the sentence that
        // gives it meaning. Translate still takes the complete sentence. Ask holds that
        // sentence as fixed context and starts with an empty question.
        ...(tool === 'ask' || tool === 'dictionary'
          ? { context: example.sentence }
          : {}),
        /*
         * Dictionary opens with the whole sentence so the reader can highlight a word in it.
         * It opened with the annotation excerpt until 2026-09-03, which is the phrase the
         * example teaches and is often a clause, so every lookup asked a dictionary for
         * something no dictionary holds.
         */
        input: tool === 'ask' ? '' : example.sentence,
        ...(tool === 'translate' || tool === 'dictionary'
          ? { targetLanguage: view.actions.settings().translationTargetLanguage }
          : {}),
        status: 'editing'
      }
    };
    view.render();
  }

export function openTutorPracticeAsk(view: KrenResultsViewProvider, exerciseId: string): void {
    const exercise = tutorExerciseById(view.tutorState, exerciseId);
    const review = view.tutorState.reviews[exerciseId];
    if (!exercise || !review) return;
    view.tutorToolController?.abort();
    view.tutorToolController = undefined;
    view.tutorState = {
      ...view.tutorState,
      toolDrawer: {
        tool: 'ask',
        context: exercise.prompt,
        // The review's learnerText is the answer the provider actually reviewed. Reading
        // the textarea here could pair a later edit with an earlier review.
        learnerAnswer: review.learnerText,
        input: '',
        status: 'editing'
      }
    };
    view.render();
  }

export function submitTutorTool(view: KrenResultsViewProvider, highlight?: string): void {
    const drawer = view.tutorState.toolDrawer;
    if (!drawer || !drawer.input.trim() || view.tutorToolController) return;
    const tool = drawer.tool;
    /*
     * Dictionary looks up what the reader highlighted, not what the box holds.
     *
     * The box holds the whole sentence so they can see it and pick a word from it with the
     * mouse. Sending the box was the fault behind three rounds of wrong answers: a clause is
     * not a headword, so the API missed, and a miss used to be answered with something else.
     * Ask and Translate take the whole box, because a question and a sentence are what they
     * are for.
     */
    const highlighted = tool === 'dictionary' ? highlight?.trim() : undefined;
    // Ask sends the reader's question literally. Whitespace is used only to decide whether
    // there is a question; it is not rewritten before the request is built.
    const input = highlighted || (tool === 'ask' ? drawer.input : drawer.input.trim());
    const targetLanguage = drawer.targetLanguage;
    const controller = new AbortController();
    view.tutorToolController = controller;
    view.tutorState = {
      ...view.tutorState,
      ...(tool === 'ask'
        ? { askBusy: drawer.learnerAnswer === undefined ? 'exampleQuestion' : 'practiceQuestion' }
        : {}),
      toolDrawer: {
        ...drawer,
        input,
        status: 'loading',
        result: undefined,
        answer: undefined,
        message: undefined
      }
    };
    view.render();
    const pending = tool === 'ask'
      ? runTutorContentRequest({ request:
          { ...(drawer.learnerAnswer === undefined
            ? tutorExampleQuestionRequest({
                sentence: drawer.context ?? '',
                question: input
              })
            : tutorPracticeQuestionRequest({
                exercisePrompt: drawer.context ?? '',
                learnerAnswer: drawer.learnerAnswer,
                question: input
              })), retry: Boolean(drawer.answer || drawer.message) || drawer.status === 'ready' || drawer.status === 'failed' },
          route: tutorLanguageModelRoute(view), signal: controller.signal,
          generate: view.actions.generateTutor.bind(view.actions), contentRetry: { allowance: 0 }, log: line => view.actions.log(line),
          validate: value => ({ type: 'accepted', value: tutorProseAnswer(value) })
        }).then(answer => ({ answer }))
      : view.actions.runTutorTool(
          tool === 'dictionary' ? 'englishDictionary' : 'translate',
          input,
          controller.signal,
          targetLanguage,
          ...((Boolean(drawer.result || drawer.message) || drawer.status === 'ready' || drawer.status === 'failed') && tool === 'translate' ? [true] : [])
        ).then((result) => ({ result }));
    void pending.then((outcome) => {
      if (controller.signal.aborted || view.tutorToolController !== controller) return;
      view.tutorState = {
        ...view.tutorState,
        ...(tool === 'ask' ? { askBusy: undefined } : {}),
        toolDrawer: {
          ...view.tutorState.toolDrawer!,
          status: 'ready',
          ...outcome
        }
      };
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      view.tutorState = {
        ...view.tutorState,
        toolDrawer: {
          ...view.tutorState.toolDrawer!,
          status: 'failed',
          message: tutorFailureMessage(error)
        }
      };
    }).finally(() => {
      if (view.tutorToolController === controller) {
        view.tutorToolController = undefined;
        view.tutorState = { ...view.tutorState, askBusy: undefined };
      }
      view.render();
    });
  }

export function restoreTutorDictionaryContext(view: KrenResultsViewProvider): void {
    const drawer = view.tutorState.toolDrawer;
    if (drawer?.tool !== 'dictionary' || drawer.context === undefined) return;
    view.tutorState = {
      ...view.tutorState,
      toolDrawer: { ...drawer, input: drawer.context }
    };
    view.render();
  }

export function closeTutorTool(view: KrenResultsViewProvider): void {
    view.tutorToolController?.abort();
    view.tutorToolController = undefined;
    view.tutorState = { ...view.tutorState, askBusy: undefined, toolDrawer: undefined };
    view.render();
  }

export function cancelTutorAsk(view: KrenResultsViewProvider): void {
    if (view.tutorState.askBusy === undefined) return;
    if (view.tutorState.askBusy === 'conversationDiagnosis') {
      view.tutorTargetSearchController?.abort();
      view.tutorTargetSearchController = undefined;
      view.tutorState = {
        ...view.tutorState, askBusy: undefined,
        diagnosticReportMessage: 'Conversation diagnosis was canceled.'
      };
      view.render();
      return;
    }
    if (view.tutorState.askBusy === 'tailoredPrompt') {
      view.tutorTailoredPromptController?.abort();
      view.tutorTailoredPromptController = undefined;
      view.tutorState = {
        ...view.tutorState, askBusy: undefined,
        diagnosticReportMessage: 'Prompt writing was canceled. The applied targets remain; your prepared prompt was not changed.'
      };
      view.render();
      return;
    }
    view.tutorTargetSearchController?.abort();
    view.tutorTargetSearchController = undefined;
    view.tutorToolController?.abort();
    view.tutorToolController = undefined;
    const drawer = view.tutorState.toolDrawer;
    view.tutorState = {
      ...view.tutorState,
      askBusy: undefined,
      ...(drawer?.tool === 'ask' && drawer.status === 'loading'
        ? {
            toolDrawer: {
              ...drawer,
              status: 'failed' as const,
              message: 'The question request was canceled.'
            }
          }
        : { selectionMessage: 'The question request was canceled.' })
    };
    view.render();
  }
