import { runTutorContentRequest } from './requestCenter.js';
import { tutorConversationRequestControls } from './tutor/generation.js';
import type { KrenResultsViewProvider } from './resultsView.js';
import { tutorResetAvailability } from './tutor/state.js';
import { TUTOR_CONVERSATION_CONTEXT_TURNS } from './resultsViewLive.js';
import { postTutorConversationStopState } from './resultsViewStop.js';
import { safePanelErrorMessage } from './resultsViewErrors.js';
import { findTutorSituation, tutorCustomSituation, findTrainingMapNode } from '@kren/core/tutor';
import { tutorConversationHintRequest, tutorPracticeHintRequest, tutorWrittenHint } from './tutor/generation.js';
import { generateTutorConversation } from './resultsViewConversation.js';
import { tutorLanguageModelRoute } from './resultsViewConversation.js';
import { tutorConversationHintLanguageModelRoute } from './resultsViewConversation.js';
import { tutorConversationTranscriptForModel } from './resultsViewTurns.js';


/** Delay after the latest answering signal before one in-memory Hint prefetch may start. */
export const TUTOR_CONVERSATION_HINT_IDLE_MS = 1_500;

  /* An answer-free explanation of what a practice question asks the reader to do. */
export async function writeTutorPracticeHint(view: KrenResultsViewProvider, exerciseId: string): Promise<void> {
    const exerciseSet = view.tutorState.exerciseSet;
    const retry = Boolean(view.tutorState.exerciseHints[exerciseId] || view.tutorState.exerciseHintFailures[exerciseId]);
    const item = view.tutorState.exerciseSet?.exercises.find(
      (candidate) => candidate.id === exerciseId
    );
    // A reviewed item already shows its explanation and answer, so a hint there is refused
    // here as well as disabled in the page, which may be showing a stale render.
    if (!item || view.tutorState.reviews[exerciseId] ||
        view.tutorState.exerciseHintBusyIds.includes(exerciseId)) return;
    view.tutorState = {
      ...view.tutorState,
      exerciseHintBusyIds: [...view.tutorState.exerciseHintBusyIds, exerciseId],
      exerciseHintFailures: { ...view.tutorState.exerciseHintFailures, [exerciseId]: '' }
    };
    const controller = new AbortController();
    view.tutorHintControllers.set(exerciseId, controller);
    view.render();
    const labels = item.targetIds
      .map((nodeId) => findTrainingMapNode(nodeId)?.label)
      .filter((label): label is string => label !== undefined);
    const lessonExample = view.tutorState.practiceExamples?.[exerciseId];
    try {
      const explanation = await runTutorContentRequest({ request:
        { ...tutorPracticeHintRequest(item.prompt, labels, {
          axes: view.tutorState.settings.axes,
          learnerLevel: view.tutorState.settings.learnerLevel
        }, undefined, lessonExample), retry }, route: tutorLanguageModelRoute(view), signal: controller.signal,
        generate: view.actions.generateTutor.bind(view.actions), contentRetry: { allowance: 0 }, log: line => view.actions.log(line),
        validate: value => {
          const hint = tutorWrittenHint(value);
          if (!hint) throw new Error('The provider returned no readable hint fields.');
          return { type: 'accepted', value: hint };
        }
      });
      if (controller.signal.aborted || view.tutorState.exerciseSet !== exerciseSet) return;
      view.tutorState = {
        ...view.tutorState,
        exerciseHints: { ...view.tutorState.exerciseHints, [exerciseId]: {
          ...explanation,
          explanation: lessonExample
            ? `Apply the pattern from lesson example ${lessonExample.exampleIndex + 1}. ${explanation.explanation}`
            : explanation.explanation
        } },
        exerciseHintFailures: { ...view.tutorState.exerciseHintFailures, [exerciseId]: '' }
      };
    } catch (error: unknown) {
      if (controller.signal.aborted || view.tutorState.exerciseSet !== exerciseSet) return;
      view.showMissingCredentialError(error, true);
      view.actions.log(`[practice hint failed] ${safePanelErrorMessage(error)}`);
      view.tutorState = {
        ...view.tutorState,
        exerciseHintFailures: {
          ...view.tutorState.exerciseHintFailures,
          [exerciseId]: 'The hint could not be written.'
        }
      };
    } finally {
      if (view.tutorHintControllers.get(exerciseId) === controller) view.tutorHintControllers.delete(exerciseId);
      if (view.tutorState.exerciseSet !== exerciseSet) return;
      view.tutorState = {
        ...view.tutorState,
        exerciseHintBusyIds: view.tutorState.exerciseHintBusyIds.filter((id) => id !== exerciseId)
      };
      view.render();
    }
  }


  /** Writes, prefetches, or reveals one answer-free Hint without replacing the composer DOM. */
export async function writeTutorConversationHint(view: KrenResultsViewProvider, readerRequested = true): Promise<void> {
    const conversation = view.tutorState.conversation;
    if (conversation.from === 'speakAndRephrase') return;
    const turnGeneration = view.tutorConversationTurnGeneration;
    if (conversation.status !== 'active' || conversation.busy) return;
    clearTutorConversationHintPrefetchTimer(view);
    if (readerRequested && conversation.hint) {
      postTutorConversationHintState(view, {
        busy: false, hint: conversation.hint, turnGeneration
      });
      return;
    }
    const prefetched = view.tutorConversationPrefetchedHint;
    if (readerRequested && prefetched?.turnGeneration === turnGeneration) {
      view.tutorConversationPrefetchedHint = undefined;
      view.tutorState = { ...view.tutorState, conversation: {
        ...conversation, hint: prefetched.hint, hintBusy: false, hintFailure: undefined
      } };
      postTutorConversationHintState(view, {
        busy: false, hint: prefetched.hint, turnGeneration
      });
      return;
    }
    const activeRequest = view.tutorConversationHintRequest;
    if (activeRequest?.turnGeneration === turnGeneration) {
      if (readerRequested && !activeRequest.readerRequested) {
        activeRequest.readerRequested = true;
        view.tutorState = { ...view.tutorState, conversation: {
          ...conversation, hint: undefined, hintBusy: true, hintFailure: undefined
        } };
        postTutorConversationHintState(view, { busy: true, turnGeneration });
      }
      return;
    }
    if (conversation.hintBusy || (!readerRequested &&
        view.tutorConversationHintPrefetchAttemptedGeneration === turnGeneration)) return;
    const controller = new AbortController();
    const requestState = { controller, turnGeneration, readerRequested };
    view.tutorConversationHintController = controller;
    view.tutorConversationHintRequest = requestState;
    view.tutorConversationHintPrefetchAttemptedGeneration = turnGeneration;
    postTutorConversationStopState(view);
    if (readerRequested) {
      view.tutorState = { ...view.tutorState, conversation: {
        ...conversation, hint: undefined, hintBusy: true, hintFailure: undefined
      } };
      postTutorConversationHintState(view, { busy: true, turnGeneration });
    }
    const situation = conversation.situationId === 'custom'
      ? tutorCustomSituation(conversation.customSituation)
      : findTutorSituation(conversation.resolvedSituationId ?? conversation.situationId);
    const setting = conversation.from !== 'anything'
      ? conversation.situationId === 'custom' ? 'The situation established at opening.' : situation?.setting ?? 'No situation is stated.'
      : 'The conversation has no fixed situation.';
    try {
      const response = await generateTutorConversation(view, { ...tutorConversationHintRequest({
        lessonContext: conversation.lessonContext,
        question: conversation.currentQuestion,
        setting,
        register: conversation.register,
        opening: conversation.starts === 'learner' && conversation.transcript.length === 0 &&
          !conversation.currentQuestion.trim(),
        ...tutorConversationRequestControls(conversation),
        recentTurns: tutorConversationTranscriptForModel(view, conversation)
          .filter((turn) => !turn.skipped)
          .slice(-TUTOR_CONVERSATION_CONTEXT_TURNS)
          .map(({ question, learnerAnswer }) => ({ question, learnerAnswer }))
      }), retry: Boolean(conversation.hintFailure) }, controller.signal, undefined, tutorConversationHintLanguageModelRoute(view), value => {
        if (!tutorWrittenHint(value)) throw new Error('The provider returned no readable hint fields.');
        return { type: 'accepted', value };
      }, readerRequested ? 'explicitAction' : 'existingPrefetch');
      if (controller.signal.aborted || view.tutorConversationHintRequest !== requestState ||
          view.tutorConversationTurnGeneration !== turnGeneration) return;
      const hint = tutorWrittenHint(response);
      if (!hint) throw new Error('The provider returned no readable hint fields.');
      if (requestState.readerRequested) {
        view.tutorState = { ...view.tutorState, conversation: {
          ...view.tutorState.conversation, hint, hintBusy: false, hintFailure: undefined
        } };
        postTutorConversationHintState(view, { busy: false, hint, turnGeneration });
      } else {
        view.tutorConversationPrefetchedHint = { turnGeneration, hint };
      }
    } catch (error: unknown) {
      if (controller.signal.aborted || view.tutorConversationHintRequest !== requestState ||
          view.tutorConversationTurnGeneration !== turnGeneration) return;
      view.actions.log(`[conversation hint${requestState.readerRequested ? '' : ' prefetch'} failed] ${safePanelErrorMessage(error)}`);
      if (!requestState.readerRequested) return;
      view.showMissingCredentialError(error, true);
      const failure = 'The hint could not be written.';
      view.tutorState = { ...view.tutorState, conversation: {
        ...view.tutorState.conversation, hintBusy: false, hintFailure: failure
      } };
      postTutorConversationHintState(view, { busy: false, failure, turnGeneration });
    } finally {
      if (view.tutorConversationHintRequest === requestState) {
        view.tutorConversationHintRequest = undefined;
        view.tutorConversationHintController = undefined;
      }
      postTutorConversationStopState(view);
    }
  }


export function clearTutorConversationHintPrefetchTimer(view: KrenResultsViewProvider): void {
    if (view.tutorConversationHintPrefetchTimer !== undefined) {
      clearTimeout(view.tutorConversationHintPrefetchTimer);
      view.tutorConversationHintPrefetchTimer = undefined;
    }
  }


export function tutorConversationReaderIsAnswering(view: KrenResultsViewProvider): boolean {
    const speech = view.tutorState.speech;
    return Boolean(
      view.tutorState.conversation.draftAnswer.trim() ||
      speech.dictatingConversation || speech.transcribingConversation ||
      view.tutorLiveMicrophoneStarting || view.tutorLiveMicrophone
    );
  }


export function scheduleTutorConversationHintPrefetch(view: KrenResultsViewProvider): void {
    clearTutorConversationHintPrefetchTimer(view);
    const conversation = view.tutorState.conversation;
    const generation = view.tutorConversationTurnGeneration;
    if (conversation.from === 'speakAndRephrase' || view.actions.settings().tutorConversationHintPrefetch !== true ||
        conversation.status !== 'active' || conversation.busy || !conversation.currentQuestion.trim() ||
        conversation.hint || conversation.hintBusy || tutorConversationReaderIsAnswering(view) ||
        view.tutorConversationHintRequest?.turnGeneration === generation ||
        view.tutorConversationPrefetchedHint?.turnGeneration === generation ||
        view.tutorConversationHintPrefetchAttemptedGeneration === generation) return;
    view.tutorConversationHintPrefetchTimer = setTimeout(() => {
      view.tutorConversationHintPrefetchTimer = undefined;
      if (view.actions.settings().tutorConversationHintPrefetch !== true ||
          view.tutorConversationTurnGeneration !== generation ||
          tutorConversationReaderIsAnswering(view)) return;
      void writeTutorConversationHint(view, false);
    }, TUTOR_CONVERSATION_HINT_IDLE_MS);
  }


export function postTutorConversationHintState(view: KrenResultsViewProvider, message: {
    busy?: boolean;
    hint?: { explanation: string; example: string };
    failure?: string;
    clear?: boolean;
    turnGeneration: number;
  }): void {
    if (view.view) void view.view.webview.postMessage({
      command: 'tutorResetAvailability', resetAvailability: tutorResetAvailability(view.tutorState)
    });
    if (view.view) void view.view.webview.postMessage({
      command: 'tutorConversationHintState', ...message
    });
  }
