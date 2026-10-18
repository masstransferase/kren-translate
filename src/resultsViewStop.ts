/**
 * Provider timing lines have measured a correction at 8.4 seconds. Thirty seconds is over
 * three times that observed maximum, so it is a stranded-turn safety net, not a normal path.
 */
export const TUTOR_CONVERSATION_STOP_SAFETY_TIMEOUT_MS = 30_000;

import type { TutorConversationStopState } from './resultsView.js';
import type { KrenResultsViewProvider } from './resultsView.js';
import { tutorResetAvailability } from './tutor/state.js';

export function clearTutorConversationStopSafetyTimer(view: KrenResultsViewProvider, resetRelease = true): void {
    if (view.tutorConversationStopSafetyTimer !== undefined) {
      clearTimeout(view.tutorConversationStopSafetyTimer);
      view.tutorConversationStopSafetyTimer = undefined;
    }
    if (resetRelease) view.tutorConversationStopSafetyReleased = false;
  }

export function tutorConversationReaderSpeaking(view: KrenResultsViewProvider): boolean {
    const pendingStandardStart = view.geminiDictationStart?.target;
    return Boolean(
      view.tutorState.speech.dictatingConversation ||
      (pendingStandardStart && 'conversation' in pendingStandardStart) ||
      (view.tutorLivePressToTalk &&
        (view.tutorLiveMicrophoneStarting || view.tutorLiveMicrophone)) ||
      (!view.tutorLivePressToTalk && view.tutorLiveActivityActive)
    );
  }

export function tutorConversationTurnInProgress(view: KrenResultsViewProvider): boolean {
    const conversation = view.tutorState.conversation;
    const correctionPending = conversation.coaching !== 'afterwards' &&
      conversation.transcript.some((turn) => turn.coachingPending);
    // A finite value is the short echo-gate margin after waveOut reported its last buffer
    // complete. KREN is no longer speaking then, so only the in-flight sentinel holds Stop.
    const livePlayback = view.tutorLivePlaybackBlockedUntil === Number.POSITIVE_INFINITY;
    return Boolean(
      conversation.busy || correctionPending || conversation.hintBusy ||
      view.tutorConversationHintRequest || view.tutorState.speech.transcribingConversation ||
      view.tutorConversationSpeechSequenceRunning || conversation.replayAllSpeaking ||
      livePlayback
    );
  }

export function tutorConversationStopState(view: KrenResultsViewProvider): TutorConversationStopState {
    const conversation = view.tutorState.conversation;
    if (conversation.status !== 'active' || conversation.demoMode) {
      clearTutorConversationStopSafetyTimer(view);
      return { disabled: false, title: 'Stop conversation' };
    }
    const readerSpeaking = tutorConversationReaderSpeaking(view);
    if ((view.tutorConversationIntroSpeaking || view.tutorLiveOpeningNarration) && !readerSpeaking) {
      clearTutorConversationStopSafetyTimer(view);
      return { disabled: false, title: 'Stop conversation' };
    }
    const turnInProgress = tutorConversationTurnInProgress(view);
    if (!turnInProgress) {
      clearTutorConversationStopSafetyTimer(view);
    } else if (!view.tutorConversationStopSafetyReleased &&
        view.tutorConversationStopSafetyTimer === undefined) {
      view.tutorConversationStopSafetyTimer = setTimeout(() => {
        view.tutorConversationStopSafetyTimer = undefined;
        if (view.tutorState.conversation.status !== 'active' ||
            view.tutorState.conversation.demoMode || !tutorConversationTurnInProgress(view)) return;
        view.tutorConversationStopSafetyReleased = true;
        view.actions.log(
          `[conversation Stop safety timeout] Re-enabled Stop after ${TUTOR_CONVERSATION_STOP_SAFETY_TIMEOUT_MS} ms.`
        );
        postTutorConversationStopState(view);
      }, TUTOR_CONVERSATION_STOP_SAFETY_TIMEOUT_MS);
    }
    if (readerSpeaking) {
      return { disabled: true, title: 'Stop is available when you finish speaking' };
    }
    if (turnInProgress && !view.tutorConversationStopSafetyReleased) {
      return { disabled: true, title: 'Stop is available when this turn finishes' };
    }
    return { disabled: false, title: 'Stop conversation' };
  }

export function postTutorConversationStopState(view: KrenResultsViewProvider): void {
    const state = tutorConversationStopState(view);
    if (!view.view) return;
    void view.view.webview.postMessage({
      command: 'tutorResetAvailability', resetAvailability: tutorResetAvailability(view.tutorState)
    });
    void view.view.webview.postMessage({ command: 'tutorConversationStopState', ...state });
    // 2026-10-02: Only mounted failed checks need this independent availability update.
    if (view.tutorState.conversation.transcript.some((turn) => turn.coachingFailed)) {
      void view.view.webview.postMessage({ command: 'tutorTurnCheckAvailability', replyInProgress: view.tutorState.conversation.busy });
    }
  }
