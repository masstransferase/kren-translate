import { showMissingCredentialNotice, type MissingCredentials } from './requestCenter.js';
import { tutorConversationRequestControls, tutorConversationHandoffInstruction, tutorConversationHandoff } from './tutor/generation.js';
import { tutorPlainText } from './tutor/plainText.js';
import { cancelTutorTakeHome } from './resultsViewTakeHome.js';
import { TUTOR_LESSON_TARGET_INSTRUCTION, tutorLiveTargetMarks, tutorTargetRanges } from './tutor/lessonConversation.js';
import { tutorLearnerTurnNotShown, tutorLearnerTurnText } from './tutor/learnerLanguage.js';
import { cancelTutorConversationPicture, ensureTutorConversationPicture } from './resultsViewConversation.js';
import { invalidateTutorConversationReport } from './resultsViewLesson.js';
import { tutorConversationFailureMessage } from './resultsViewConversation.js';
import { postTutorLiveTurnCoaching } from './resultsViewTurns.js';
import { tutorConversationAnswerForDisplay } from './resultsViewTurns.js';
import { applyTutorConversationHandoff } from './resultsViewTurns.js';
import { postTutorLiveTurnCommitted } from './resultsViewTurns.js';
import { tutorLiveCoaching } from './resultsViewConversation.js';
import { tutorConversationTranscriptForModel } from './resultsViewTurns.js';
import { advanceTutorConversationTurn } from './resultsViewConversation.js';
import { findTutorSituation } from '@kren/core/tutor';
import { resolveTutorSpeechRoute, type TutorViewState } from './tutor/state.js';
import type { TutorLiveAudioChunk } from './tutor/liveSession.js';
import type { TutorLiveSpokenTurn } from './resultsView.js';
import { TutorLiveSession, TutorLiveSessionError } from './tutor/liveSession.js';
import { pcmSampleRate } from './windowsWaveOutPlayer.js';
import { TutorMicrophoneGate } from './tutorMicrophoneGate.js';
import { LiveConversationTurnTiming } from './tutor/conversationTiming.js';
import { punctuateSpokenAnswerForDisplay } from './tutor/spokenAnswer.js';
import { TUTOR_LIVE_TEACHING_INSTRUCTION, tutorConversationLiveReplyQuote, tutorConversationTurnRequest } from './tutor/generation.js';
import { configuredTutorMicrophoneCloseWait, configuredTutorSpeechProvider, configuredTutorLiveTranscriptionLanguage } from './resultsViewConfiguration.js';
import { closeTutorDemoResources } from './resultsViewDemo.js';
import { cancelTutorConversationReplayAll, cancelTutorLiveReplayWait, cancelTutorIntroCompletion } from './resultsViewReplay.js';
import { safePanelErrorMessage } from './resultsViewErrors.js';
import { cancelTutorConversationDictation } from './resultsViewDictation.js';
import { postTutorConversationStopState } from './resultsViewStop.js';
import type { KrenResultsViewProvider } from './resultsView.js';

/**
 * The setting text each turn plays against. Only a predefined situation's setting is sent: that
 * text ships with KREN. The reader's own situation text goes with the opening alone, as V106's
 * privacy test requires, and is not repeated on every turn.
 */
export function tutorConversationSetting(conversation: TutorViewState['conversation']): string | undefined {
  const id = conversation.resolvedSituationId ?? conversation.situationId;
  if (conversation.from === 'anything' || conversation.from === 'speakAndRephrase' || id === 'custom') return undefined;
  return findTutorSituation(id)?.setting;
}

/** How many recent completed turns a conversation reply carries as context. */
export const TUTOR_CONVERSATION_CONTEXT_TURNS = 10;

export const TUTOR_LIVE_FILLER_SOUNDS = ['uh', 'um', 'hm', 'hmm', 'mm', 'er', 'ah'] as const;

export function tutorLiveDiscardableInput(text: string): boolean {
    if (tutorLearnerTurnNotShown(text)) return false;
    const token = text.trim().replace(/^\p{P}+|\p{P}+$/gu, '').toLowerCase();
    return /^[a-z]$/u.test(token) || TUTOR_LIVE_FILLER_SOUNDS.some((filler) => filler === token);
  }

/** Clears a reply awaiting final input, which has no archived spoken turn to clean up. */
export function cancelTutorLivePendingInputReply(view: KrenResultsViewProvider): boolean {
    if (!view.tutorLiveInputReplyPending) return false;
    view.tutorLiveInputReplyPending = false;
    const answer = tutorLearnerTurnText(view.tutorLiveInputText.trim());
    view.tutorLiveInputText = '';
    view.tutorLiveInputFirstFragment = true;
    view.tutorState = { ...view.tutorState, conversation: {
      ...view.tutorState.conversation, busy: false,
      ...(answer && !tutorLiveDiscardableInput(answer) ? { draftAnswer: answer, draftAnswerSpoken: true } : {})
    } };
    if (view.view) void view.view.webview.postMessage(answer && !tutorLiveDiscardableInput(answer)
      ? { command: 'tutorLiveTurnCancelled', answer }
      : { command: 'tutorLiveInputDiscarded' });
    postTutorConversationStopState(view);
    return true;
  }

/**
 * Gemini Live transcribes speech in pieces, and a piece that starts a new sentence can arrive
 * without the space before it: 1.64.0 showed "today?Is it a slow drip". Adds that space when
 * the text so far ends a sentence or clause and the piece starts a word.
 */
export function liveTranscriptFragment(previous: string, fragment: string): string {
  return /[.?!,;:]$/u.test(previous) && /^[\p{L}"'(]/u.test(fragment)
    ? ` ${fragment}`
    : fragment;
}

const TUTOR_LIVE_ECHO_MARGIN_MS = 120;


const tutorLiveOpeningAudio = new WeakMap<KrenResultsViewProvider, TutorLiveAudioChunk[]>();

/** Keep native playback idle while the opening turn is requested during the intro pause. */
export function holdTutorLiveOpeningAudio(view: KrenResultsViewProvider, ready: Promise<boolean>): void {
    const chunks: TutorLiveAudioChunk[] = [];
    tutorLiveOpeningAudio.set(view, chunks);
    void ready.then(released => {
      if (tutorLiveOpeningAudio.get(view) !== chunks) return;
      tutorLiveOpeningAudio.delete(view);
      if (!released || !view.tutorState.conversation.speakerOn) return;
      try { for (const chunk of chunks) playTutorLiveAudio(view, chunk); }
      catch (error) { failTutorLiveAudio(view, error); }
    });
  }

export function stopTutorLiveAudio(view: KrenResultsViewProvider): void {
    tutorLiveOpeningAudio.delete(view);
    const wasPlaying = view.tutorLivePlaybackBlockedUntil === Number.POSITIVE_INFINITY;
    view.tutorLiveAudioPlayer?.stop();
    view.tutorLivePlaybackQueuedUntil = 0;
    view.tutorLivePlaybackBlockedUntil = 0;
    if (wasPlaying) postTutorConversationStopState(view);
  }

export function playTutorLiveAudio(view: KrenResultsViewProvider, chunk: TutorLiveAudioChunk): void {
    const held = tutorLiveOpeningAudio.get(view);
    if (held) { held.push({ ...chunk }); return; }
    const player = view.tutorLiveAudioPlayer;
    if (!player) return;
    player.play(chunk);
    const bytes = Buffer.from(chunk.data, 'base64').byteLength;
    const rate = pcmSampleRate(chunk.mimeType);
    const durationMs = bytes / (rate * 2) * 1000;
    view.tutorLivePlaybackQueuedUntil = Math.max(Date.now(), view.tutorLivePlaybackQueuedUntil) + durationMs;
    // The byte duration remains useful for sequencing Replay, but it is not the microphone
    // deadline. Only waveOut's WHDR_DONE progress below can say when the speaker went quiet.
    view.tutorLivePlaybackBlockedUntil = Number.POSITIVE_INFINITY;
    view.tutorLiveTurnTiming?.echoGateBlocked();
    postTutorConversationStopState(view);
  }

export function tutorLivePlaybackProgress(view: KrenResultsViewProvider,
    completedBuffers: number,
    queuedBuffers: number,
    generation: number
  ): void {
    if (generation !== view.tutorLiveAudioGeneration || completedBuffers < 1 || queuedBuffers !== 0) return;
    const releasedAt = Date.now() + TUTOR_LIVE_ECHO_MARGIN_MS;
    view.tutorLivePlaybackQueuedUntil = Date.now();
    view.tutorLivePlaybackBlockedUntil = releasedAt;
    view.tutorIntroCompletionWait?.playbackComplete();
    view.tutorLiveTurnTiming?.echoGateReleased(releasedAt);
    view.tutorLiveCompletedTiming?.echoGateReleased(releasedAt);
    view.tutorLiveCompletedTiming?.write();
    view.tutorLiveCompletedTiming = undefined;
    postTutorConversationStopState(view);
  }

export function finishTutorLiveTurnTiming(view: KrenResultsViewProvider, timing = view.tutorLiveTurnTiming): void {
    if (!timing) return;
    if (view.tutorLiveTurnTiming === timing) view.tutorLiveTurnTiming = undefined;
    if (view.tutorLivePlaybackBlockedUntil === Number.POSITIVE_INFINITY) {
      view.tutorLiveCompletedTiming = timing;
      return;
    }
    timing.write();
  }

function tutorLiveHybridDetection(view: KrenResultsViewProvider): boolean {
  return view.tutorLiveSpeechDetection === 'geminiKren' && !view.tutorLivePressToTalk;
}

export function closeTutorLiveMicrophone(view: KrenResultsViewProvider, sendStreamEnd = true): void {
    view.tutorLiveMicrophoneGeneration += 1;
    view.tutorLiveMicrophoneStarting = false;
    if (view.tutorLiveActivityEndTimer !== undefined) {
      clearTimeout(view.tutorLiveActivityEndTimer);
      view.tutorLiveActivityEndTimer = undefined;
    }
    const microphone = view.tutorLiveMicrophone;
    view.tutorLiveMicrophone = undefined;
    view.tutorLiveMicrophoneGate = undefined;
    if (microphone && sendStreamEnd) {
      if (view.tutorLivePressToTalk) view.tutorLiveSession?.activityEnd();
      else if (view.tutorLiveActivityActive) {
        if (tutorLiveHybridDetection(view)) view.tutorLiveSession?.endAudioStream();
        else view.tutorLiveSession?.activityEnd();
      }
    }
    view.tutorLiveActivityActive = false;
    microphone?.stop();
  }

export function clearTutorLiveActivityEndTimer(view: KrenResultsViewProvider): void {
    if (view.tutorLiveActivityEndTimer === undefined) return;
    clearTimeout(view.tutorLiveActivityEndTimer);
    view.tutorLiveActivityEndTimer = undefined;
  }

export function scheduleTutorLiveActivityEnd(view: KrenResultsViewProvider, session: TutorLiveSession, generation: number): void {
    clearTutorLiveActivityEndTimer(view);
    if (!view.tutorLiveActivityActive) return;
    const lastLoudChunkAt = view.tutorLiveMicrophoneGate?.lastLoudChunkAt;
    if (lastLoudChunkAt === undefined) return;
    // 2026-10-02: the pause includes hangover and any delay before the first closed chunk.
    const silenceDurationMs = Math.max(0, lastLoudChunkAt + view.tutorLivePauseBeforeReply * 1000 - Date.now());
    view.tutorLiveActivityEndTimer = setTimeout(() => {
      view.tutorLiveActivityEndTimer = undefined;
      if (generation !== view.tutorLiveMicrophoneGeneration ||
          view.tutorLiveSession !== session || view.tutorLivePressToTalk ||
          !view.tutorLiveMicrophone || !view.tutorLiveActivityActive) return;
      view.tutorLiveActivityActive = false;
      if (tutorLiveHybridDetection(view)) session.endAudioStream();
      else session.activityEnd();
      postTutorConversationStopState(view);
    }, silenceDurationMs);
  }

export function postTutorLiveTalkState(view: KrenResultsViewProvider, available = view.tutorLiveSession !== undefined): void {
    const fallback = !available && !view.tutorLiveResumeController &&
      view.tutorState.conversation.status === 'active' &&
      view.tutorState.conversation.replies === 'liveGemini';
    const route = fallback ? resolveTutorSpeechRoute(configuredTutorSpeechProvider(),
      view.tutorState.speech.handyStatus, Boolean(view.actions.settings().credentialPresence?.geminiDefault),
      Boolean(view.actions.settings().credentialPresence?.cloudflareAccountId && view.actions.settings().credentialPresence?.cloudflareApiToken), Boolean(view.actions.settings().credentialPresence?.groq)) : undefined;
    if (view.view) {
      void view.view.webview.postMessage({
        command: 'tutorLiveTalkState',
        available,
        listening: view.tutorLiveMicrophone !== undefined,
        pressToTalk: view.tutorLivePressToTalk,
        ...(fallback ? { standardFallback: true, dictationProvider: route?.provider,
          dictationUnavailable: !route?.provider } : {})
      });
    }
    postTutorConversationStopState(view);
  }

export async function toggleTutorLiveMicrophone(view: KrenResultsViewProvider): Promise<void> {
    if (view.tutorLiveMicrophone || view.tutorLiveMicrophoneStarting) {
      closeTutorLiveMicrophone(view);
      postTutorLiveTalkState(view, true);
      return;
    }
    const session = view.tutorLiveSession;
    const refuse = (condition: string): void => {
      view.actions.log(`[conversation Live microphone refused: ${condition}]`);
      postTutorLiveTalkState(view, false);
    };
    if (!session) {
      refuse('no session');
      return;
    }
    if (view.tutorLiveFailed) {
      refuse('session failed');
      return;
    }
    if (view.tutorState.conversation.status !== 'active') {
      refuse('conversation not active');
      return;
    }
    if (view.tutorState.conversation.replies !== 'liveGemini') {
      refuse('replies not Live');
      return;
    }
    const generation = ++view.tutorLiveMicrophoneGeneration;
    const gate = new TutorMicrophoneGate(
      Date.now, view.tutorLiveMicrophoneSensitivity, view.tutorLivePressToTalk ? 1 : undefined
    );
    view.tutorLiveMicrophoneStarting = true;
    postTutorConversationStopState(view);
    try {
      const microphone = await view.waveInRecorder.start(
        (base64Pcm) => {
          if (generation !== view.tutorLiveMicrophoneGeneration ||
              view.tutorLiveSession !== session || !view.tutorLiveMicrophone ||
              view.tutorLiveMicrophoneGate !== gate) return;
          if (Date.now() < view.tutorLivePlaybackBlockedUntil) return;
          if (!view.tutorLiveTurnTiming) {
            view.tutorLiveTurnTiming = new LiveConversationTurnTiming(
              (line) => view.actions.log(line), Date.now
            );
            // The capture is continuous after the first turn. At the next turn boundary it
            // is already open, so offset zero records when this turn first observed it.
            view.tutorLiveTurnTiming.microphoneOpened();
          }
          const decision = gate.acceptWithReport(base64Pcm);
          if (decision.opened) {
            view.tutorLiveTurnTiming.gateOpened();
            if (!view.tutorLivePressToTalk) {
              clearTutorLiveActivityEndTimer(view);
              if (!view.tutorLiveActivityActive) {
                view.tutorLiveActivityActive = true;
                if (!tutorLiveHybridDetection(view)) session.activityStart();
                postTutorConversationStopState(view);
              }
            }
          }
          if (decision.closed) {
            view.tutorLiveTurnTiming.gateClosed();
            if (!view.tutorLivePressToTalk) {
              scheduleTutorLiveActivityEnd(view, session, generation);
            }
          }
          if (decision.reason) {
            view.tutorLiveTurnTiming.gateHeld(decision.reason, decision.heldChunks);
          }
          const acceptedChunks = decision.chunks;
          if (acceptedChunks.length > 0 &&
              view.tutorLiveInputLatency.firstMicrophoneForwardedAt === undefined) {
            view.tutorLiveInputLatency.firstMicrophoneForwardedAt = Date.now();
            view.tutorLiveTurnTiming.firstChunkForwarded();
            if (view.view) void view.view.webview.postMessage({ command: 'tutorLiveInputStarted' });
          }
          // V145, 2026-09-23: manual activity markers make synthetic silence pure wire cost.
          // Send only gate-accepted speech, including its held pre-roll, in both input modes.
          if (tutorLiveHybridDetection(view)) session.sendAudio(base64Pcm);
          else for (const accepted of acceptedChunks) session.sendAudio(accepted);
        },
        (error) => {
          if (generation !== view.tutorLiveMicrophoneGeneration) return;
          view.actions.log(`[conversation Live microphone] ${safePanelErrorMessage(error)}`);
          closeTutorLiveMicrophone(view, false);
          postTutorLiveTalkState(view, view.tutorLiveSession === session);
        },
        configuredTutorMicrophoneCloseWait() * 1000
      );
      if (generation !== view.tutorLiveMicrophoneGeneration || view.tutorLiveSession !== session ||
          view.tutorState.conversation.status !== 'active' ||
          view.tutorState.conversation.replies !== 'liveGemini') {
        microphone.stop();
        return;
      }
      view.tutorLiveMicrophoneStarting = false;
      view.tutorLiveMicrophone = microphone;
      view.tutorLiveMicrophoneGate = gate;
      view.tutorLiveActivityActive = false;
      view.tutorLiveTurnTiming = new LiveConversationTurnTiming(
        (line) => view.actions.log(line), Date.now
      );
      view.tutorLiveTurnTiming.microphoneOpened();
      if (view.tutorLivePressToTalk) session.activityStart();
      postTutorLiveTalkState(view, true);
    } catch (error) {
      if (generation !== view.tutorLiveMicrophoneGeneration) return;
      view.tutorLiveMicrophoneStarting = false;
      const detail = safePanelErrorMessage(error);
      view.actions.log(`[conversation Live microphone] ${detail}`);
      view.actions.notify('error', `KREN: The Live microphone could not start. ${detail}`);
      postTutorLiveTalkState(view, true);
    }
  }

/**
 * V121: the session's instructions are fixed when it opens, so a Register or Correction change
 * made mid-conversation reached the corrections and not the voice. The change now travels with
 * the next turn as a note the model reads before the learner's words.
 */
export function tutorLiveChoiceNote(view: KrenResultsViewProvider): string | undefined {
    const previous = view.tutorLiveSessionChoices;
    if (view.tutorState.conversation.from === 'speakAndRephrase') {
      const { register } = view.tutorState.conversation;
      view.tutorLiveSessionChoices = { register, teaching: false };
      return previous?.register === register ? undefined
        : `Note from KREN, not said by the learner: Keep coaching expressions in the ${register} register.`;
    }
    if (!previous && !view.tutorState.conversation.lessonContext) return undefined;
    const conversation = view.tutorState.conversation;
    const teaching = conversation.coaching === 'teaching';
    const notes: string[] = conversation.lessonContext
      ? [TUTOR_LESSON_TARGET_INSTRUCTION + `Lesson context: ${JSON.stringify(conversation.lessonContext)}.`] : [];
    if (conversation.register !== previous?.register) {
      notes.push(`From now on, use a ${conversation.register} register.`);
    }
    if (teaching !== previous?.teaching) {
      notes.push(teaching
        ? `From now on: ${TUTOR_LIVE_TEACHING_INSTRUCTION.trim()}`
        : 'From now on, do not correct the learner out loud; reply to what they meant.');
    }
    view.tutorLiveSessionChoices = { register: conversation.register, teaching };
    return notes.length
      ? `Note from KREN, not said by the learner: ${notes.join(' ')}`
      : undefined;
  }

export function closeTutorLiveSession(view: KrenResultsViewProvider, reconcilePicture = true, preserveCoaching = false): void {
    if (view.tutorLiveOpeningNarration) cancelTutorIntroCompletion(view);
    cancelTutorLivePendingInputReply(view);
    cancelTutorConversationPicture(view);
    view.tutorLiveResumeController?.abort();
    view.tutorLiveResumeController = undefined;
    view.tutorLiveOpeningNarration = false;
    closeTutorLiveMicrophone(view);
    view.tutorLiveSession?.close();
    view.tutorLiveSession = undefined;
    if (!preserveCoaching) view.tutorLiveSpokenTurn?.controller.abort();
    view.tutorLiveSpokenTurn = undefined;
    if (!preserveCoaching) cancelTutorLiveCoachingRequests(view);
    view.tutorLiveInputText = '';
    view.tutorLiveInputFirstFragment = true;
    view.tutorLiveTurnTiming = undefined;
    view.tutorLiveReplyTiming = undefined;
    view.tutorLiveCompletedTiming = undefined;
    stopTutorLiveAudio(view);
    view.tutorLiveAudioPlayer?.close();
    view.tutorLiveAudioPlayer = undefined;
    view.tutorLiveReplayOwnsAudioPlayer = false;
    cancelTutorLiveReplayWait(view);
    view.tutorLiveAudioGeneration += 1;
    view.tutorLiveReplyAudio = [];
    view.tutorLiveReplyAudioComplete = false;
    postTutorLiveTalkState(view, false);
    if (reconcilePicture) ensureTutorConversationPicture(view);
  }

export function cancelTutorLiveCoachingRequests(view: KrenResultsViewProvider): boolean {
    if (view.tutorLiveCoachingControllers.size === 0) return false;
    const generations = new Set(view.tutorLiveCoachingControllers.keys());
    for (const controller of view.tutorLiveCoachingControllers.values()) controller.abort();
    view.tutorLiveCoachingControllers.clear();
    const conversation = view.tutorState.conversation;
    let changed = false;
    const transcript = conversation.transcript.map((turn, index) => {
      if (!generations.has(turn.generation ?? -(index + 1)) ||
          !turn.coachingPending) return turn;
      changed = true;
      return {
        ...turn, correction: '', explanation: '',
        coachingPending: undefined, coachingFailed: true as const
      };
    });
    if (changed) {
      view.tutorState = { ...view.tutorState, conversation: { ...conversation, transcript } };
    }
    postTutorConversationStopState(view);
    return changed;
  }

/** Releases only speech and requests owned by the current conversation. */
export async function releaseTutorConversationResources(view: KrenResultsViewProvider, clearArchivedAudio = false, reconcilePicture = true): Promise<void> {
    if (clearArchivedAudio) cancelTutorTakeHome(view);
    // 2026-10-02: Reset and replacement retire the scene before cleanup can reconcile pictures.
    if (clearArchivedAudio) view.tutorConversationScene = undefined;
    if (view.tutorState.conversation.demoMode || view.tutorDemoController) {
      closeTutorDemoResources(view);
    }
    cancelTutorConversationReplayAll(view);
    closeTutorLiveSession(view, reconcilePicture);
    view.tutorConversationController?.abort();
    view.tutorConversationController = undefined;
    view.tutorConversationHintController?.abort();
    view.tutorConversationHintController = undefined;
    await cancelTutorConversationDictation(view);
    view.tutorStandardTurnTiming = undefined;
    if (clearArchivedAudio) view.tutorLiveConversationAudio.clear();
  }

export function beginTutorLiveReply(view: KrenResultsViewProvider, afterIntro = false): void {
    // 2026-10-11: A Live reply takes priority over an in-flight Chirp preview or reading.
    if (!afterIntro && view.actions.settings().tutorReadAloudProvider === 'googleChirp') view.actions.stopReadAloud();
    stopTutorLiveAudio(view);
    view.tutorLiveReplyText = '';
    view.tutorLiveReplyRawText = '';
    view.tutorLiveFirstFragment = true;
    view.tutorLiveReplyAdvancedTurn = false;
    view.tutorLiveReplyAudio = [];
    view.tutorLiveReplyAudioComplete = false;
    view.tutorLiveInputLatency = {};
    view.tutorLiveReplyTiming = view.tutorLiveTurnTiming;
    postTutorLiveSpeakerState(view);
  }

export function appendTutorLiveReply(view: KrenResultsViewProvider, fragment: string): void {
    if (!fragment || view.tutorLiveSpokenTurn?.learnerNotShown) return;
    if (view.tutorLiveFirstFragment &&
        (view.tutorState.conversation.pendingAnswer !== undefined || view.tutorLiveSpokenTurn)) {
      // Live text is patched before its turn commits. End the old Hint-owned turn before
      // posting the first new KREN fragment, not after that fragment is already visible.
      advanceTutorConversationTurn(view);
      view.tutorLiveReplyAdvancedTurn = true;
    }
    const previousText = view.tutorLiveReplyText;
    const previous = previousText.trim();
    view.tutorLiveReplyRawText = (view.tutorLiveReplyRawText ?? view.tutorLiveReplyText) +
      liveTranscriptFragment(view.tutorLiveReplyRawText ?? view.tutorLiveReplyText, fragment);
    view.tutorLiveReplyText = tutorPlainText(view.tutorLiveReplyRawText);
    const reset = view.tutorLiveFirstFragment;
    view.tutorLiveFirstFragment = false;
    // 2026-10-13: Output transcription can finish after turnComplete. Retain the text in
    // the committed turn as well as its existing bubble, until the next reply begins.
    const conversation = view.tutorState.conversation;
    const index = conversation.transcript.length - 1;
    const committed = view.tutorLiveReplyAudioComplete && !view.tutorLiveOpeningNarration &&
      index >= 0 && conversation.transcript[index]?.reply === previous;
    if (committed) {
      const transcript = [...conversation.transcript];
      transcript[index] = { ...transcript[index]!, reply: view.tutorLiveReplyText.trim(),
        targetMarks: tutorLiveTargetMarks(view.tutorLiveReplyText.trim(), 'reply', conversation.lessonContext) };
      view.tutorState = { ...view.tutorState, conversation: { ...conversation, transcript,
        ...(conversation.currentQuestion === previous ? { currentQuestion: view.tutorLiveReplyText.trim(),
          currentQuestionTargetMarks: transcript[index]!.targetMarks } : {}) } };
    }
    const replace = committed || !view.tutorLiveReplyText.startsWith(previousText);
    if (view.view && !view.tutorLiveOpeningNarration) void view.view.webview.postMessage({
      command: 'tutorLiveReplyFragment', text: replace ? view.tutorLiveReplyText : view.tutorLiveReplyText.slice(previousText.length), reset,
      ...(replace ? { replace: true } : {}),
      ...(committed ? { index, replyQuote: conversation.transcript[index]?.replyQuote } : {}),
      targetRanges: tutorTargetRanges(view.tutorLiveReplyText, 'reply', tutorLiveTargetMarks(view.tutorLiveReplyText, 'reply', view.tutorState.conversation.lessonContext))
    });
  }

export function appendTutorLiveInput(view: KrenResultsViewProvider, fragment: string): void {
    if (!fragment || view.tutorState.conversation.status !== 'active') return;
    // 2026-10-02: Once the bounded hold releases, late final fragments belong to that
    // accepted turn, rather than becoming the next learner's accumulated input.
    if (view.tutorLiveSpokenTurn) return;
    view.tutorLiveTurnTiming?.inputTranscriptionFragment();
    if (view.tutorLiveInputLatency.firstInputFragmentAt === undefined) {
      view.tutorLiveInputLatency.firstInputFragmentAt = Date.now();
    }
    const text = liveTranscriptFragment(view.tutorLiveInputText, fragment);
    view.tutorLiveInputText += text;
    // 2026-10-02: Hold a possible click or filler until the final transcript can decide it.
    if (tutorLiveDiscardableInput(view.tutorLiveInputText)) return;
    const reset = view.tutorLiveInputFirstFragment;
    view.tutorLiveInputFirstFragment = false;
    if (view.view) void view.view.webview.postMessage({
      command: 'tutorLiveInputFragment', text: reset ? view.tutorLiveInputText : text, reset
    });
  }

export function beginTutorLiveSpokenReply(view: KrenResultsViewProvider, inputFinal = false): true | void {
    const conversation = view.tutorState.conversation;
    const rawAnswer = view.tutorLiveInputText.trim();
    const learnerAnswer = configuredTutorLiveTranscriptionLanguage() === 'english' ? tutorLearnerTurnText(rawAnswer) : rawAnswer;
    const partiallyHeard = learnerAnswer !== rawAnswer;
    const learnerNotShown = tutorLearnerTurnNotShown(learnerAnswer);
    const pendingInputReply = view.tutorLiveInputReplyPending;
    if (!learnerAnswer || conversation.status !== 'active' || (conversation.busy && !pendingInputReply) ||
        conversation.replies !== 'liveGemini' || !view.tutorLiveSession ||
        view.tutorLiveSpokenTurn) return;
    if (!inputFinal && tutorLiveDiscardableInput(learnerAnswer)) {
      cancelTutorConversationReplayAll(view);
      rememberTutorLiveQuestionAudio(view, conversation.transcript.length);
      beginTutorLiveReply(view);
      view.tutorLiveInputReplyPending = true;
      view.tutorState = { ...view.tutorState, conversation: { ...conversation, busy: true } };
      postTutorConversationStopState(view);
      return true;
    }
    view.tutorLiveInputReplyPending = false;
    view.tutorLiveInputText = '';
    view.tutorLiveInputFirstFragment = true;
    if (tutorLiveDiscardableInput(learnerAnswer)) {
      cancelTutorConversationReplayAll(view);
      if (!pendingInputReply) beginTutorLiveReply(view);
      view.tutorState = { ...view.tutorState, conversation: { ...conversation, busy: true } };
      if (view.view) void view.view.webview.postMessage({ command: 'tutorLiveInputDiscarded' });
      postTutorConversationStopState(view);
      return true;
    }
    const lessonNote = [tutorLiveChoiceNote(view), ...(conversation.from === 'speakAndRephrase' ? [] : [tutorConversationHandoffInstruction(learnerAnswer)])].filter(Boolean).join(' ');
    if (lessonNote) view.tutorLiveSession.sendNote(lessonNote);
    cancelTutorConversationReplayAll(view);
    if (!pendingInputReply) {
      rememberTutorLiveQuestionAudio(view, conversation.transcript.length);
      beginTutorLiveReply(view);
    }
    const question = conversation.currentQuestion;
    const generation = view.tutorConversationTurnGeneration;
    const controller = new AbortController();
    view.tutorConversationController = controller;
    const displayedAnswer = punctuateSpokenAnswerForDisplay(learnerAnswer);
    view.tutorState = { ...view.tutorState, conversation: {
      ...conversation,
      pendingAnswer: displayedAnswer,
      busy: true,
      failure: undefined
    } };
    postTutorConversationStopState(view);
    if (view.view) void view.view.webview.postMessage({
      command: 'tutorLiveInputCommitted',
      learnerNotShown,
      partiallyHeard,
      text: displayedAnswer,
      index: conversation.transcript.length
    });
    const timing = view.tutorLiveReplyTiming;
    timing?.turnCommitted();
    const request = tutorConversationTurnRequest({
      register: conversation.register,
      recipeTargets: conversation.recipeTargets, lessonContext: conversation.lessonContext,
      transcript: tutorConversationTranscriptForModel(view, conversation)
        .filter((turn) => !turn.skipped)
        .slice(-TUTOR_CONVERSATION_CONTEXT_TURNS),
      question,
      learnerAnswer,
      teaching: conversation.coaching === 'teaching',
      spoken: true,
      replyLength: conversation.replyLength,
      voiceGender: view.tutorLiveOpeningContext?.voiceGender,
      ...tutorConversationRequestControls(conversation),
      setting: tutorConversationSetting(conversation)
    });
    const turn: TutorLiveSpokenTurn = {
      controller, generation, question, learnerAnswer, learnerNotShown,
      ...(partiallyHeard ? { partiallyHeard: true as const } : {}), coachingRequest: request, timing
    };
    view.tutorLiveSpokenTurn = turn;
    if (!learnerNotShown && (conversation.from === 'speakAndRephrase' || conversation.coaching !== 'afterwards')) {
      view.tutorLiveCoachingControllers.set(generation, controller);
      turn.coaching = tutorLiveCoaching(view, request, controller, learnerAnswer, timing);
    }
  }

export function finishTutorLiveSpokenTurn(view: KrenResultsViewProvider): void {
    const turn = view.tutorLiveSpokenTurn;
    if (!turn || turn.finishing) return;
    turn.finishing = true;
    void completeTutorLiveSpokenTurn(view, turn);
  }

export async function completeTutorLiveSpokenTurn(view: KrenResultsViewProvider, turn: TutorLiveSpokenTurn): Promise<void> {
    const liveReply = view.tutorLiveReplyText.trim();
    const learnerNotShown = turn.learnerNotShown ?? tutorLearnerTurnNotShown(turn.learnerAnswer);
    if (!liveReply && !learnerNotShown) {
      const error = new TutorLiveSessionError('protocol');
      disableTutorLive(view, error, 'spoken turn');
      return;
    }
    completeTutorLiveReply(view);
    if (turn.controller.signal.aborted || view.tutorLiveSpokenTurn !== turn ||
        view.tutorConversationController !== turn.controller ||
        view.tutorState.conversation.status !== 'active') return;
    invalidateTutorConversationReport(view);
    const current = view.tutorState.conversation;
    view.tutorConversationRawAnswers.set(current.transcript.length, turn.learnerAnswer);

    const handoff = current.from === 'speakAndRephrase' ? undefined : tutorConversationHandoff(view.tutorLiveSession?.takeHandoff?.());
    const liveTurn = {
      ...(handoff ? { handoff } : {}),
      ...(turn.partiallyHeard ? { partiallyHeard: true as const } : {}),
      ...(learnerNotShown ? { learnerNotShown: true as const } : {}),
      generation: turn.generation,
      question: turn.question, questionTargetMarks: current.currentQuestionTargetMarks,
      targetMarks: tutorLiveTargetMarks(liveReply, 'reply', current.lessonContext),
      learnerAnswer: punctuateSpokenAnswerForDisplay(turn.learnerAnswer),
      spoken: true,
      move: 'reaction' as const,
      reply: learnerNotShown ? '' : liveReply,
      correction: '',
      explanation: '',
      ...(!learnerNotShown ? { coachingPending: true as const } : {})
    };
    const index = current.transcript.length;
    view.tutorState = { ...view.tutorState, conversation: {
      ...current,
      transcript: [...current.transcript, liveTurn],
      currentTurnIndex: index,
      currentQuestionTargetMarks: learnerNotShown ? current.currentQuestionTargetMarks : tutorLiveTargetMarks(liveReply, 'reply', current.lessonContext),
      currentQuestion: learnerNotShown ? current.currentQuestion : liveReply,
      hint: undefined,
      draftAnswer: current.draftAnswer,
      draftAnswerSpoken: current.draftAnswerSpoken,
      pendingAnswer: undefined,
      busy: false,
      failure: undefined
    } };
    postTutorConversationStopState(view);
    if (!view.tutorLiveReplyAdvancedTurn) advanceTutorConversationTurn(view);
    if (!learnerNotShown) view.scheduleTutorConversationHintPrefetch();
    postTutorLiveTurnCommitted(view, liveTurn, index);
    if (view.tutorConversationController === turn.controller) {
      view.tutorConversationController = undefined;
    }
    if (view.tutorLiveSpokenTurn === turn) view.tutorLiveSpokenTurn = undefined;
    finishTutorLiveTurnTiming(view, turn.timing);
    if (turn.coaching) void attachTutorLiveCoaching(view, turn, index);
    if (!learnerNotShown) applyTutorConversationHandoff(view, handoff);
  }

/** Applies the separate structured check to the generation that requested it, never the current turn. */
export async function attachTutorLiveCoaching(view: KrenResultsViewProvider, turn: TutorLiveSpokenTurn, index: number): Promise<void> {
    const coachingResult = await turn.coaching!;
    if (turn.controller.signal.aborted ||
        view.tutorLiveCoachingControllers.get(turn.generation) !== turn.controller) return;
    view.tutorLiveCoachingControllers.delete(turn.generation);
    const conversation = view.tutorState.conversation;
    const owned = conversation.transcript[index];
    if (conversation.status !== 'active' || owned?.generation !== turn.generation ||
        !owned.coachingPending) return;
    let patched: typeof owned;
    if (coachingResult.ok) {
      const response = coachingResult.response;
      const replyQuote = conversation.from !== 'speakAndRephrase' && conversation.coaching === 'teaching'
        ? tutorConversationLiveReplyQuote(owned.reply ?? '') : '';
      if (conversation.from !== 'speakAndRephrase' && conversation.coaching === 'teaching' && !replyQuote) {
        view.actions.log(
          '[conversation Live highlight missing] The spoken reply did not contain "Actually, you would say".'
        );
      }
      patched = {
        ...owned,
        move: response.move,
        learnerAnswer: tutorConversationAnswerForDisplay(view, turn.learnerAnswer, response.spokenPunctuated, true),
        correction: response.correction,
        replyQuote,
        explanation: response.explanation,
        rephrase: response.rephrase,
        rephraseWhy: response.rephraseWhy,
        spokenPunctuated: response.spokenPunctuated,
        alternatives: response.alternatives,
        coachingPending: undefined,
        coachingFailed: undefined,
        ...(response.targetId ? { targetId: response.targetId } : { targetId: undefined })
      };
    } else {
      view.actions.log(
        `[conversation Live coaching failed] ${safePanelErrorMessage(coachingResult.error)}`
      );
      patched = {
        ...owned, correction: '', explanation: '', rephrase: undefined, rephraseWhy: undefined,
        coachingPending: undefined, coachingFailed: true
      };
    }
    const transcript = [...conversation.transcript];
    transcript[index] = patched;
    view.tutorState = { ...view.tutorState, conversation: { ...conversation, transcript } };
    postTutorLiveTurnCoaching(view, patched, index, turn.generation);
    postTutorConversationStopState(view);
  }

/** Ends one spoken turn exactly once when its Live session can no longer finish it. */
export function failTutorLiveSpokenTurn(view: KrenResultsViewProvider, error: TutorLiveSessionError): boolean {
    const turn = view.tutorLiveSpokenTurn;
    if (!turn) return false;
    view.tutorLiveSpokenTurn = undefined;
    turn.controller.abort();
    if (view.tutorConversationController === turn.controller) {
      view.tutorConversationController = undefined;
    }
    const conversation = view.tutorState.conversation;
    if (conversation.status !== 'active' || !conversation.busy) return false;
    view.tutorState = { ...view.tutorState, conversation: {
      ...conversation,
      draftAnswer: turn.learnerAnswer,
      draftAnswerSpoken: true,
      pendingAnswer: undefined,
      busy: false,
      failure: tutorConversationFailureMessage(view, error)
    } };
    postTutorConversationStopState(view);
    return true;
  }

/** Restores one spoken answer when the reader deliberately leaves Live mid-reply. */
export function cancelTutorLiveSpokenTurn(view: KrenResultsViewProvider): boolean {
    const turn = view.tutorLiveSpokenTurn;
    if (!turn) return false;
    view.tutorLiveSpokenTurn = undefined;
    turn.controller.abort();
    if (view.tutorConversationController === turn.controller) {
      view.tutorConversationController = undefined;
    }
    const conversation = view.tutorState.conversation;
    if (conversation.status !== 'active' || !conversation.busy) return false;
    view.tutorState = { ...view.tutorState, conversation: {
      ...conversation,
      draftAnswer: turn.learnerAnswer,
      draftAnswerSpoken: true,
      pendingAnswer: undefined,
      busy: false,
      failure: undefined
    } };
    if (view.view) void view.view.webview.postMessage({
      command: 'tutorLiveTurnCancelled', answer: turn.learnerAnswer
    });
    postTutorConversationStopState(view);
    return true;
  }

export function interruptTutorLiveReply(view: KrenResultsViewProvider): void {
    if (view.tutorLiveOpeningNarration) {
      view.tutorConversationController?.abort();
      cancelTutorIntroCompletion(view);
      stopTutorLiveAudio(view);
      return;
    }
    stopTutorLiveAudio(view);
    view.tutorLiveReplyAudio = [];
    view.tutorLiveReplyAudioComplete = false;
    if (cancelTutorLivePendingInputReply(view)) {
      // 2026-10-02: Retain partial replies just as an interrupted normal spoken turn does.
      const text = view.tutorLiveReplyText.trim();
      const conversation = view.tutorState.conversation;
      view.tutorState = { ...view.tutorState, conversation: {
        ...conversation,
        currentQuestion: text || conversation.currentQuestion,
        unansweredReplies: text ? [
          ...(conversation.unansweredReplies ?? []),
          // With no learner turn yet, no transcript entry has retained the opening.
          ...(!conversation.transcript.length && !conversation.unansweredReplies?.length && conversation.currentQuestion.trim()
            ? [{ beforeTurn: 0, text: conversation.currentQuestion }] : []),
          { beforeTurn: conversation.transcript.length, text }
        ] : conversation.unansweredReplies
      } };
      if (view.view) void view.view.webview.postMessage({
        command: 'tutorLiveIgnoredTurnComplete', talkAvailable: true,
        listening: view.tutorLiveMicrophone !== undefined, pressToTalk: view.tutorLivePressToTalk,
        replayAvailable: false
      });
    } else finishTutorLiveSpokenTurn(view);
    postTutorLiveSpeakerState(view);
  }

export function postTutorLiveAudio(view: KrenResultsViewProvider, chunk: TutorLiveAudioChunk): void {
    if (view.tutorLiveSpokenTurn?.learnerNotShown) return;
    view.tutorLiveReplyTiming?.replyAudioFirstByte();
    if (!view.tutorLiveAudioLogged) {
      view.tutorLiveAudioLogged = true;
      view.actions.log(`[conversation Live audio] first chunk received, ${chunk.mimeType.slice(0, 60)}`);
    }
    // V139, 2026-09-22: drop speaker-off audio instead of retaining an unbounded reply for
    // a possible later Replay. The reader explicitly chose not to hear it, and bounding host
    // memory is worth Replay becoming available again only after a later audible reply.
    if (!view.tutorState.conversation.speakerOn) return;
    view.tutorLiveReplyAudio.push({ ...chunk });
    if (!view.tutorLiveAudioPlayer) return;
    try {
      playTutorLiveAudio(view, chunk);
    } catch (error) {
      failTutorLiveAudio(view, error);
    }
  }

export function tutorLiveReplayAvailable(view: KrenResultsViewProvider): boolean {
    return view.tutorLiveReplyAudioComplete && view.tutorLiveReplyAudio.length > 0;
  }

export function tutorConversationReplayAvailable(view: KrenResultsViewProvider): boolean {
    const conversation = view.tutorState.conversation;
    const answered = conversation.transcript
      .map((turn, index) => ({ turn, index }))
      .filter(({ turn }) => !turn.skipped);
    if (conversation.status !== 'stopped') return false;
    if (conversation.replies !== 'liveGemini' || view.tutorLiveFailed) return answered.length > 0 || Boolean(conversation.currentQuestion.trim());
    // 2026-10-02: Missing earlier clips must not disable retained playable replies.
    return answered.some(({ index }) => (view.tutorLiveConversationAudio.get(index)?.length ?? 0) > 0) ||
      (view.tutorLiveConversationAudio.get(conversation.transcript.length)?.length ?? 0) > 0;
  }

export function postTutorConversationReplayState(view: KrenResultsViewProvider): void {
    if (!view.view) return;
    // The panel cannot infer whether every stopped Live reply still has retained audio.
    void view.view.webview.postMessage({
      command: 'tutorConversationReplayState',
      available: tutorConversationReplayAvailable(view)
    });
  }

export function completeTutorLiveReply(view: KrenResultsViewProvider): void {
    view.tutorLiveReplyAudioComplete = true;
  }

export function rememberTutorLiveQuestionAudio(view: KrenResultsViewProvider, index: number): void {
    view.tutorLiveConversationAudio.set(
      index,
      view.tutorLiveReplyAudioComplete
        ? view.tutorLiveReplyAudio.map((chunk) => ({ ...chunk }))
        : []
    );
  }

export function failTutorLiveAudio(view: KrenResultsViewProvider, error: unknown, generation = view.tutorLiveAudioGeneration): void {
    if (generation !== view.tutorLiveAudioGeneration || !view.tutorLiveAudioPlayer) return;
    logTutorLiveAudioError(view, error);
    view.tutorLiveAudioPlayer.close();
    view.tutorLiveAudioPlayer = undefined;
    view.tutorLiveReplayOwnsAudioPlayer = false;
    cancelTutorLiveReplayWait(view);
    view.tutorLivePlaybackQueuedUntil = 0;
    view.tutorLivePlaybackBlockedUntil = 0;
    // A failed player has no remaining audible buffers to hold the opening forever.
    view.tutorIntroCompletionWait?.playbackComplete();
    postTutorLiveSpeakerState(view);
    postTutorConversationStopState(view);
  }

export function logTutorLiveAudioError(view: KrenResultsViewProvider, error: unknown): void {
    const line = safePanelErrorMessage(error).split(/\r?\n/u)[0]!.slice(0, 400);
    view.actions.log(`[conversation Live audio] ${line}`);
  }

export function postTutorLiveSpeakerState(view: KrenResultsViewProvider): void {
    if (!view.view) return;
    void view.view.webview.postMessage({
      command: 'tutorLiveSpeakerState',
      speakerOn: view.tutorState.conversation.speakerOn,
      replayAvailable: tutorLiveReplayAvailable(view)
    });
  }

export function disableTutorLive(view: KrenResultsViewProvider, error: TutorLiveSessionError, context: string, missing?: MissingCredentials): void {
    // V121: view used to drop the reference without closing the socket, so a failed session
    // stayed open and a late fragment from it could land in the next conversation's opening.
    const pendingInputFailed = cancelTutorLivePendingInputReply(view);
    const spokenTurnFailed = failTutorLiveSpokenTurn(view, error);
    closeTutorLiveSession(view);
    if (!view.tutorLiveFailed) {
      view.actions.log(`[conversation Live fallback: ${context}] ${error.message}.`);
      if (missing) void showMissingCredentialNotice(missing, view, 'KREN continues with Standard replies.');
      else view.actions.notify('warning', 'The Live session stopped. KREN continues with Standard replies.');
    }
    view.tutorLiveFailed = true;
    postTutorLiveTalkState(view, false);
    postTutorConversationStopState(view);
    if (spokenTurnFailed || pendingInputFailed) view.render();
  }
