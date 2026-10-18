import { tutorConversationRequestControls, tutorConversationHandoff, tutorConversationHandoffInstruction } from './tutor/generation.js';
import { handoffTutorConversationVoices } from './speech/voiceSelection.js';
import { tutorConversationCoachingRequest, tutorConversationCoaching } from './tutor/generation.js';
import { ProviderError } from './errors.js';
import { tutorLiveTargetMarks, tutorTargetRanges, type TutorTargetMark } from './tutor/lessonConversation.js';
import { tutorLearnerTurnNotShown, tutorLearnerTurnText, tutorSpokenAnswerForDisplay } from './tutor/learnerLanguage.js';
import { cancelTutorConversationPicture, ensureTutorConversationPicture, refreshTutorConversationPicture } from './resultsViewConversation.js';
import { cancelTutorTakeHome, reconcileTutorStoppedTakeHome, postTutorTakeHome } from './resultsViewTakeHome.js';
import { invalidateTutorConversationReport } from './resultsViewLesson.js';
import type { TutorLiveCoachingResult } from './resultsView.js';
import type { KrenResultsViewProvider } from './resultsView.js';
import { TUTOR_CONVERSATION_CONTEXT_TURNS, tutorConversationSetting, finishTutorLiveTurnTiming, closeTutorLiveMicrophone, postTutorLiveTalkState, tutorLiveChoiceNote, closeTutorLiveSession, releaseTutorConversationResources, beginTutorLiveReply, tutorLiveReplayAvailable, completeTutorLiveReply, rememberTutorLiveQuestionAudio, disableTutorLive } from './resultsViewLive.js';
import { postTutorConversationStopState } from './resultsViewStop.js';
import { safePanelErrorMessage } from './resultsViewErrors.js';
import { tutorConversationAnswersMatch, tutorConversationCoachHighlights } from './resultViewHtml.js';
import { tutorConversationOpening, tutorConversationCorrections, tutorConversationCorrectionsRequest, tutorConversationLiveSystemInstruction, tutorConversationLiveResumeInstruction, TUTOR_CONVERSATION_LIVE_SKIP_NOTE, tutorConversationTurn, tutorConversationTurnRequest, tutorConversationLiveReplyQuote } from './tutor/generation.js';
import type { TutorConversationOpening, TutorStructuredGenerationRequest } from './tutor/generation.js';
import { tutorConversationReply, tutorConversationHandoffNote } from './tutor/state.js';
import { TutorLiveSession, TutorLiveSessionError } from './tutor/liveSession.js';
import { LiveConversationTurnTiming, StandardConversationTurnTiming } from './tutor/conversationTiming.js';
import { closeTutorDemoResources } from './resultsViewDemo.js';
import { cancelTutorConversationReplayAll, speakTutorConversationSequence } from './resultsViewReplay.js';
import { configuredTutorPressToTalk, configuredTutorPauseBeforeReply, configuredTutorSpeechDetection, configuredTutorMicrophoneSensitivity } from './resultsViewConfiguration.js';
import { scheduleTutorConversationHintPrefetch } from './resultsViewHints.js';
import { advanceTutorConversationTurn } from './resultsViewConversation.js';
import { generateTutorConversation } from './resultsViewConversation.js';
import { tutorLiveCoaching } from './resultsViewConversation.js';
import { tutorConversationFailureMessage } from './resultsViewConversation.js';
import { tutorLanguageModelRoute } from './resultsViewConversation.js';
import { startStandardTutorOpening } from './resultsViewConversation.js';
import { completeTutorConversationOpening } from './resultsViewConversation.js';
import { showTutorConversationScene } from './resultsViewConversation.js';
import { failTutorConversationOpening } from './resultsViewConversation.js';
import { openTutorLiveSession } from './resultsViewConversation.js';

/** Commit only a validated signal, after archiving the reply and before selecting speech. */
export function applyTutorConversationHandoff(view: KrenResultsViewProvider, value: unknown): boolean {
  const handoff = tutorConversationHandoff(value);
  if (!handoff) return false;
  const conversation = view.tutorState.conversation;
  if (conversation.tutorRole === handoff.role) return false;
  const voices = handoffTutorConversationVoices(view, handoff.gender);
  view.tutorState = { ...view.tutorState, conversation: {
    ...conversation, tutorRole: handoff.role, liveVoice: voices.liveVoice
  } };
  if (view.tutorLiveOpeningContext) view.tutorLiveOpeningContext = {
    ...view.tutorLiveOpeningContext, tutorRole: handoff.role, voiceGender: handoff.gender
  };
  if (view.view) void view.view.webview.postMessage({ command: 'tutorConversationHandoff',
    index: conversation.transcript.length - 1, note: tutorConversationHandoffNote(handoff.role) });
  if (conversation.replies === 'liveGemini' && !view.tutorLiveFailed) {
    // Reuse the bounded history, cancellation, and microphone gates of Back to chat.
    closeTutorLiveSession(view, false, true);
    if (view.view) void view.view.webview.postMessage({ command: 'tutorConversationHandoff',
      reconnecting: true, note: "Connecting the new character's voice..." });
    refreshTutorConversationPicture(view, true);
    void reopenLiveTutorSession(view);
  } else refreshTutorConversationPicture(view);
  return true;
}


export async function startLiveTutorOpening(view: KrenResultsViewProvider,
    openingContext: Parameters<typeof tutorConversationLiveSystemInstruction>[0],
    openingRequest: TutorStructuredGenerationRequest,
    controller: AbortController
  ): Promise<void> {
    let generatedOpening: TutorConversationOpening | undefined;
    try {
      generatedOpening = tutorConversationOpening(
        await generateTutorConversation(view, openingRequest, controller.signal),
        openingContext.learnerStarts !== true
      );
      if (controller.signal.aborted || view.tutorConversationController !== controller ||
          view.tutorState.conversation.replies !== 'liveGemini') return;
      // The scene is useful before the socket is ready, and publishing it does not enable the
      // composer. Gemini's own first turn remains the only event that finishes a Live opening.
      showTutorConversationScene(view, generatedOpening.scene);
      openingContext = { ...openingContext, tutorRole: generatedOpening.tutorRole, learnerRole: generatedOpening.learnerRole };
      view.tutorLiveOpeningContext = openingContext;
      view.tutorState = { ...view.tutorState, conversation: { ...view.tutorState.conversation,
        tutorRole: generatedOpening.tutorRole, learnerRole: generatedOpening.learnerRole } };
      const session = await openTutorLiveSession(view,
        tutorConversationLiveSystemInstruction(
          openingContext,
          view.tutorState.conversation.coaching === 'teaching',
          undefined,
          generatedOpening.scene
        ),
        controller.signal,
        () => !controller.signal.aborted && view.tutorConversationController === controller &&
          view.tutorState.conversation.replies === 'liveGemini'
      );
      // The mode clause is deliberate redundancy, confirmed by mutation on 2026-09-20:
      // deleting it leaves all 1489 tests passing, because leaving Live during an opening
      // also aborts this controller. It is kept because the abort depends on recognising a
      // pending opening from the conversation's shape, and this does not. The reopen path
      // has its own mode check, which a test does cover. Do not thin this out for a score.
      if (controller.signal.aborted || view.tutorConversationController !== controller ||
          view.tutorState.conversation.replies !== 'liveGemini') {
        session.close();
        return;
      }
      beginTutorLiveReply(view);
      view.tutorLiveOpeningNarration = true;
      postTutorConversationStopState(view);
      try {
        await session.sendTurn(openingContext.learnerStarts
          ? 'Read the established scene aloud as neutral third-person narration, then wait silently for the learner to begin. Do not speak in character.'
          : `Read the established scene aloud as neutral third-person narration. Then switch into character and say exactly this opening: ${JSON.stringify(generatedOpening.opening)}`);
      } finally {
        view.tutorLiveOpeningNarration = false;
      }
      const spokenOpening = view.tutorLiveReplyText.trim();
      if (!spokenOpening) throw new TutorLiveSessionError('protocol');
      completeTutorLiveReply(view);
      if (controller.signal.aborted || view.tutorConversationController !== controller ||
          view.tutorState.conversation.status !== 'active' ||
          view.tutorState.conversation.replies !== 'liveGemini') return;
      completeTutorConversationOpening(view, generatedOpening, controller, true);
      if (view.tutorConversationController === controller) {
        view.tutorConversationController = undefined;
      }
    } catch (error) {
      if (controller.signal.aborted || view.tutorConversationController !== controller) return;
      if (view.tutorState.conversation.replies !== 'liveGemini') {
        startStandardTutorOpening(view, openingRequest, controller);
        return;
      }
      if (generatedOpening) {
        const safeError = error instanceof TutorLiveSessionError
          ? error : new TutorLiveSessionError('socketOpen');
        disableTutorLive(view, safeError, 'opening', error instanceof ProviderError &&
          (error.action === 'setGeminiKey' || error.action === 'setGeminiProKey'));
        completeTutorConversationOpening(view, generatedOpening, controller, false);
        if (view.tutorConversationController === controller) {
          view.tutorConversationController = undefined;
        }
      } else {
        failTutorConversationOpening(view, error, controller);
        if (view.tutorConversationController === controller) {
          view.tutorConversationController = undefined;
        }
      }
    }
  }


/** Rechecks only the archived answer; never sends a new conversational turn. */
export async function retryTutorTurnCheck(view: KrenResultsViewProvider, index: number): Promise<void> {
    const conversation = view.tutorState.conversation;
    const owned = conversation.transcript[index];
    if (!Number.isInteger(index) || !owned || owned.skipped || owned.learnerNotShown || !owned.coachingFailed ||
        owned.coachingPending || conversation.busy || view.tutorLiveSpokenTurn) return;
    const generation = owned.generation ?? -(index + 1);
    if (view.tutorLiveCoachingControllers.has(generation)) return;
    const controller = new AbortController();
    view.tutorLiveCoachingControllers.set(generation, controller);
    const pending = { ...owned, coachingPending: true as const };
    const transcript = [...conversation.transcript];
    transcript[index] = pending;
    view.tutorState = { ...view.tutorState, conversation: { ...conversation, transcript } };
    postTutorLiveTurnCoaching(view, pending, index, owned.generation);
    postTutorConversationStopState(view);
    const learnerAnswer = view.tutorConversationRawAnswers.get(index) ?? owned.learnerAnswer;
    const deferred = conversation.from !== 'speakAndRephrase' && conversation.coaching === 'afterwards';
    const request = deferred
      ? tutorConversationCorrectionsRequest({
          register: conversation.register, recipeTargets: conversation.recipeTargets, lessonContext: conversation.lessonContext,
          turns: [{ question: owned.question, learnerAnswer, spoken: owned.spoken === true,
            previousTurn: tutorCorrectionPreviousTurn(view, index) }],
          ...tutorConversationRequestControls(conversation),
          setting: tutorConversationSetting(conversation)
        })
      : tutorConversationTurnRequest({
          register: conversation.register, recipeTargets: conversation.recipeTargets, lessonContext: conversation.lessonContext,
          transcript: tutorConversationTranscriptForModel(view, conversation).slice(0, index)
            .filter((turn) => !turn.skipped).slice(-TUTOR_CONVERSATION_CONTEXT_TURNS),
          question: owned.question, learnerAnswer, spoken: owned.spoken === true,
          teaching: conversation.coaching === 'teaching', replyLength: conversation.replyLength,
          voiceGender: view.tutorLiveOpeningContext?.voiceGender,
          ...tutorConversationRequestControls(conversation),
          setting: tutorConversationSetting(conversation)
        });
    let patched = { ...pending, coachingPending: undefined as true | undefined };
    try {
      const value = await generateTutorConversation(view, { ...(deferred ? request : tutorConversationCoachingRequest(request)), retry: true }, controller.signal, undefined, undefined, conversation.from === 'speakAndRephrase' ? undefined : value => {
        if (deferred) tutorConversationCorrections(value, 1);
        else tutorConversationCoaching(value, learnerAnswer);
        return { type: 'accepted', value };
      });
      const response = conversation.from === 'speakAndRephrase' ? tutorConversationTurn(value) : deferred
        ? tutorConversationCorrections(value, 1)[0] : tutorConversationCoaching(value, learnerAnswer);
      if (!response) throw new Error('No turn check was returned.');
      patched = { ...patched,
        ...(conversation.from === 'speakAndRephrase' && !owned.reply?.trim() && 'reply' in response && typeof response.reply === 'string'
          ? { move: 'reaction' as const, reply: response.reply } : {}),
        learnerAnswer: tutorConversationAnswerForDisplay(view, learnerAnswer, response.spokenPunctuated, owned.spoken === true),
        spokenPunctuated: response.spokenPunctuated,
        correction: response.correction, explanation: response.explanation,
        rephrase: response.rephrase, rephraseWhy: response.rephraseWhy, alternatives: 'alternatives' in response ? response.alternatives as typeof owned.alternatives : undefined, targetId: response.targetId || undefined, coachingFailed: undefined };
    } catch (error) {
      if (!controller.signal.aborted) view.actions.log(
        `[conversation check retry failed] ${safePanelErrorMessage(error)}`
      );
    }
    if (controller.signal.aborted || view.tutorLiveCoachingControllers.get(generation) !== controller) return;
    view.tutorLiveCoachingControllers.delete(generation);
    const current = view.tutorState.conversation;
    if (current.transcript[index] !== pending) return;
    if (!patched.coachingFailed) invalidateTutorConversationReport(view, false);
    const checked = [...current.transcript];
    checked[index] = patched;
    view.tutorState = { ...view.tutorState, conversation: { ...current, transcript: checked,
      ...(conversation.from === 'speakAndRephrase' && index === checked.length - 1 && !owned.reply?.trim() && patched.reply
        ? { currentQuestion: patched.reply } : {}) } };
    postTutorLiveTurnCoaching(view, patched, index, owned.generation);
    postTutorConversationStopState(view);
  }

export function submitTutorConversationTurn(view: KrenResultsViewProvider, spokenTranscript?: string): void {
    const conversation = view.tutorState.conversation;
    const submittedDraft = spokenTranscript ?? conversation.draftAnswer;
    const answerWasSpoken = spokenTranscript !== undefined || conversation.draftAnswerSpoken;
    view.tutorHandyConversationTranscriptPending = false;
    const learnerAnswer = tutorLearnerTurnText(submittedDraft.trim(), answerWasSpoken ? 'all' : 'tail');
    if (conversation.status !== 'active' || conversation.busy || conversation.openingReveal || !learnerAnswer) return;
    if (tutorLearnerTurnNotShown(learnerAnswer)) {
      completeStandardTutorTurn(view, { move: 'reaction', reply: '', correction: '', explanation: '' },
        conversation.currentQuestion, learnerAnswer, answerWasSpoken);
      view.render();
      return;
    }
    cancelTutorConversationReplayAll(view);
    if (conversation.replies === 'liveGemini') {
      rememberTutorLiveQuestionAudio(view, conversation.transcript.length);
    }
    beginTutorLiveReply(view);
    const question = conversation.currentQuestion;
    const controller = new AbortController();
    view.tutorConversationController = controller;
    view.tutorState = {
      ...view.tutorState,
      conversation: {
        ...conversation,
        draftAnswer: '',
        // Keep the pending turn's input kind until it commits so Stop can restore it.
        draftAnswerSpoken: answerWasSpoken,
        pendingAnswer: answerWasSpoken
          ? tutorSpokenAnswerForDisplay(learnerAnswer)
          : learnerAnswer,
        busy: true,
        failure: undefined
      }
    };
    view.render();
    const turnRequest = tutorConversationTurnRequest({
      register: conversation.register,
      recipeTargets: conversation.recipeTargets, lessonContext: conversation.lessonContext,
      // Only the recent exchange is sent. The Live session holds its own conversation, while
      // the structured coaching request keeps the same bounded context as Standard replies.
      transcript: tutorConversationTranscriptForModel(view, conversation)
        .filter((turn) => !turn.skipped)
        .slice(-TUTOR_CONVERSATION_CONTEXT_TURNS),
      question,
      learnerAnswer,
      teaching: conversation.coaching === 'teaching',
      spoken: answerWasSpoken,
      replyLength: conversation.replyLength,
      voiceGender: view.tutorLiveOpeningContext?.voiceGender,
      ...tutorConversationRequestControls(conversation),
      setting: tutorConversationSetting(conversation)
    });
    if (conversation.replies === 'liveGemini' &&
        !view.tutorLiveFailed && view.tutorLiveSession) {
      void submitLiveTutorTurn(view,
        turnRequest, controller, submittedDraft, question, learnerAnswer, answerWasSpoken
      );
      return;
    }
    if (conversation.replies !== 'standard' && view.tutorLiveFailed) {
      view.actions.log('[conversation Live fallback] The Live session failed earlier in this conversation.');
    } else if (conversation.replies !== 'standard') {
      view.actions.log('[conversation Live fallback] No Live session is available.');
    }
    submitStandardTutorTurn(view,
      turnRequest, controller, submittedDraft, question, learnerAnswer, answerWasSpoken
    );
  }


export function tutorConversationTranscriptForModel(view: KrenResultsViewProvider,
    conversation = view.tutorState.conversation
  ): typeof conversation.transcript {
    return conversation.transcript.map((turn, index) => ({
      ...turn,
      learnerAnswer: view.tutorConversationRawAnswers.get(index) ?? turn.learnerAnswer
    }));
  }

/** Keep the immediate exchange, including an answer whose check was not deferred. */
function tutorCorrectionPreviousTurn(view: KrenResultsViewProvider, index: number) {
  const turn = tutorConversationTranscriptForModel(view)[index - 1];
  return turn ? { question: turn.question, learnerAnswer: turn.learnerAnswer, reply: turn.reply } : undefined;
}


function tutorCoachHighlightPatch(view: KrenResultsViewProvider, index: number) {
  const turn = view.tutorState.conversation.transcript[index];
  if (!turn) return { coach: true, coachReplyRanges: [] };
  const { ranges } = tutorConversationCoachHighlights(turn.reply ?? '');
  return { coach: true, coachReply: turn.reply ?? '', coachReplyRanges: ranges };
}

export function tutorConversationAnswerForDisplay(view: KrenResultsViewProvider,
    learnerAnswer: string,
    spokenPunctuated: string | undefined,
    spoken: boolean
  ): string {
    if (!spoken) return learnerAnswer;
    const words = (text: string) => text.toLowerCase().replace(/[\u2018\u2019]/gu, "'")
      .match(/[\p{L}\p{M}\p{N}]+(?:'[\p{L}\p{M}\p{N}]+)*/gu) ?? [];
    const recognizedWords = words(learnerAnswer);
    const candidateWords = words(spokenPunctuated ?? '');
    if (spokenPunctuated?.trim() && recognizedWords.length > 0 &&
        recognizedWords.length === candidateWords.length &&
        recognizedWords.every((word, index) => word === candidateWords[index])) {
      // 2026-10-18: V263 I42, word equality alone also accepted unformatted coach echoes.
      return tutorSpokenAnswerForDisplay(spokenPunctuated.trim());
    }
    view.actions.log('[conversation spoken punctuation word-equality check failed] Using local display form.');
    return tutorSpokenAnswerForDisplay(learnerAnswer);
  }


  /** A model hint may decorate a reply, but it can never make the turn fail. */
export function verifiedTutorReplyQuote(view: KrenResultsViewProvider, reply: string, quote: string | undefined): string {
    if (!quote) return '';
    if (reply.includes(quote)) return quote;
    view.actions.log(
      '[conversation reply quote ignored] The model-provided quote did not occur exactly in the reply.'
    );
    return '';
  }


export function submitStandardTutorTurn(view: KrenResultsViewProvider,
    request: TutorStructuredGenerationRequest,
    controller: AbortController,
    submittedDraft: string,
    question: string,
    learnerAnswer: string,
    answerWasSpoken: boolean
  ): void {
    view.tutorStandardTurnTiming ??= new StandardConversationTurnTiming(
      (line) => view.actions.log(line), Date.now
    );
    view.tutorStandardTurnTiming.requestSent();
    let completed = false;
    void generateTutorConversation(view,
      request, controller.signal, view.tutorStandardTurnTiming
    ).then((value) => {
      // Three clauses, and today they always fire together: submitting is gated on `busy`
      // so there is never a second controller, and stopping both aborts and moves the status
      // away from active. Mutation on 2026-09-04 confirmed it: removing any one of them
      // leaves all 905 tests passing, and removing the abort in `stopTutorConversation`
      // fails them. So the redundancy is real and is kept deliberately, because each clause
      // guards a different way this could go wrong later, and a late answer appended to a
      // transcript the reader has closed is the failure this whole guard exists to prevent.
      // Do not thin it out to raise a mutation score.
      if (controller.signal.aborted || view.tutorConversationController !== controller ||
          view.tutorState.conversation.status !== 'active') return;
      view.tutorStandardTurnTiming?.replyReceived();
      completeStandardTutorTurn(view,
        tutorConversationTurn(value, tutorLearnerTurnNotShown(learnerAnswer), view.tutorState.conversation.lessonContext?.targets.map((target) => target.targetId)), question, learnerAnswer, answerWasSpoken,
        answerWasSpoken && submittedDraft.trim() !== learnerAnswer
      );
      completed = true;
    }).catch((error: unknown) => {
      if (controller.signal.aborted || view.tutorConversationController !== controller) return;
      cancelTutorConversationPicture(view);
      let current = view.tutorState.conversation;
      // 2026-10-14: A recognized turn remains evidence even when its reply request fails.
      // Restoring it to an offscreen draft erased the balloon and joined the next utterance.
      const failedSpokenTurn = answerWasSpoken ? {
        question, questionTargetMarks: current.currentQuestionTargetMarks,
        learnerAnswer: tutorConversationAnswerForDisplay(view, learnerAnswer, '', true),
        spoken: true, move: 'reaction' as const, reply: '', correction: '', explanation: '',
        ...(submittedDraft.trim() !== learnerAnswer ? { partiallyHeard: true as const } : {}),
        coachingFailed: true as const
      } : undefined;
      if (failedSpokenTurn) {
        invalidateTutorConversationReport(view);
        current = view.tutorState.conversation;
        view.tutorConversationRawAnswers.set(current.transcript.length, learnerAnswer);
      }
      view.tutorState = {
        ...view.tutorState,
        conversation: {
          ...current,
          ...(failedSpokenTurn ? {
            transcript: [...current.transcript, failedSpokenTurn],
            currentTurnIndex: current.transcript.length
          } : {}),
          draftAnswer: failedSpokenTurn ? '' : submittedDraft,
          draftAnswerSpoken: failedSpokenTurn ? false : answerWasSpoken,
          pendingAnswer: undefined,
          failure: tutorConversationFailureMessage(view, error)
        }
      };
    }).finally(() => {
      if (view.tutorConversationController !== controller) return;
      view.tutorConversationController = undefined;
      view.tutorState = {
        ...view.tutorState,
        conversation: { ...view.tutorState.conversation, busy: false }
      };
      view.render();
      if (completed) {
        scheduleTutorConversationHintPrefetch(view);
        view.tutorStandardTurnTiming?.rendered();
        view.tutorStandardTurnTiming?.write();
      }
      view.tutorStandardTurnTiming = undefined;
    });
  }


export function completeStandardTutorTurn(view: KrenResultsViewProvider,
    response: ReturnType<typeof tutorConversationTurn>,
    question: string,
    learnerAnswer: string,
    answerWasSpoken: boolean,
    partiallyHeard = false
  ): void {
    invalidateTutorConversationReport(view);
    const current = view.tutorState.conversation;
    const index = current.transcript.length;
    view.tutorConversationRawAnswers.set(index, learnerAnswer);
    const learnerNotShown = tutorLearnerTurnNotShown(learnerAnswer);
    if (learnerNotShown) response = { ...response, reply: '', nextQuestion: undefined, correction: '', explanation: '', rephrase: '', rephraseWhy: '', replyQuote: '', targetId: undefined };
    const displayedAnswer = learnerNotShown ? learnerAnswer : tutorConversationAnswerForDisplay(view,
      learnerAnswer, response.spokenPunctuated, answerWasSpoken
    );
    const responseReply = tutorConversationReply(response);
    const replyQuote = verifiedTutorReplyQuote(view, responseReply, response.replyQuote);
    view.tutorState = {
      ...view.tutorState,
      conversation: {
        ...current,
        transcript: [...current.transcript, {
          question, questionTargetMarks: current.currentQuestionTargetMarks, learnerAnswer: displayedAnswer, ...response, replyQuote,
          ...(learnerNotShown ? { learnerNotShown: true as const } : {}),
          ...(answerWasSpoken ? { spoken: true } : {}),
          ...(partiallyHeard ? { partiallyHeard: true as const } : {})
        }],
        currentTurnIndex: index,
        currentQuestionTargetMarks: learnerNotShown ? current.currentQuestionTargetMarks : response.targetMarks?.filter((mark) => mark.field === (response.nextQuestion ? 'nextQuestion' : 'reply')),
        currentQuestion: learnerNotShown ? current.currentQuestion : response.nextQuestion ?? tutorConversationReply(response),
        hint: undefined,
        draftAnswer: '',
        draftAnswerSpoken: false,
        pendingAnswer: undefined,
        failure: undefined
      }
    };
    if (!learnerNotShown) applyTutorConversationHandoff(view, response.handoff);
    view.tutorConversationPictureEligibleTurn = index;
    view.tutorConversationPictureCommitPending = true;
    if (!view.tutorLiveReplyAdvancedTurn) advanceTutorConversationTurn(view);
    if (current.speakerOn && !learnerNotShown) {
      const reply = tutorConversationReply(response);
      const utterances = [
        ...(reply.trim() && (current.from === 'speakAndRephrase' || reply !== response.correction) ? [reply] : []),
        ...(response.nextQuestion?.trim() && response.nextQuestion !== reply ? [response.nextQuestion] : [])
      ];
      if (utterances.length) view.tutorState.conversation.speechReveal = { turn: index, texts: utterances, started: 0 };
      speakTutorConversationSequence(view,
        utterances,
        'The reply could not be read aloud. Try Replay again.', false, false,
        (completed) => {
          if (completed >= utterances.length && view.tutorState.conversation.speechReveal?.turn === index) {
            view.tutorState.conversation.speechReveal = undefined;
            view.render();
          }
        },
        (started) => {
          const reveal = view.tutorState.conversation.speechReveal;
          if (!reveal || reveal.turn !== index) return;
          reveal.started = started + 1;
          view.render();
        }
      );
    }
  }


export async function submitLiveTutorTurn(view: KrenResultsViewProvider,
    request: TutorStructuredGenerationRequest,
    controller: AbortController,
    submittedDraft: string,
    question: string,
    learnerAnswer: string,
    answerWasSpoken: boolean
  ): Promise<void> {
    if (tutorLearnerTurnNotShown(learnerAnswer)) {
      completeStandardTutorTurn(view, { move: 'reaction', reply: '', correction: '', explanation: '' },
        question, learnerAnswer, answerWasSpoken);
      view.tutorConversationController = undefined;
      view.tutorState = { ...view.tutorState, conversation: { ...view.tutorState.conversation, busy: false } };
      view.render();
      return;
    }
    const session = view.tutorLiveSession;
    if (!session) return;
    view.tutorLiveTurnTiming ??= new LiveConversationTurnTiming(
      (line) => view.actions.log(line), Date.now
    );
    const timing = view.tutorLiveTurnTiming;
    view.tutorLiveReplyTiming = timing;
    timing.turnCommitted();
    try {
      await session.sendTurn(learnerAnswer, [tutorLiveChoiceNote(view), ...(view.tutorState.conversation.from === 'speakAndRephrase' ? [] : [tutorConversationHandoffInstruction(learnerAnswer)])].filter(Boolean).join(' ') || undefined);
      let liveReply = view.tutorLiveReplyText.trim();
      if (!liveReply) throw new TutorLiveSessionError('protocol');
      completeTutorLiveReply(view);
      const coachingResult = await tutorLiveCoaching(view,
        request, controller, learnerAnswer, timing
      );
      if (controller.signal.aborted || view.tutorConversationController !== controller ||
          view.tutorState.conversation.status !== 'active') return;
      // 2026-10-13: Coaching can finish after the final output-transcription fragment.
      liveReply = view.tutorLiveReplyText.trim();
      const response = coachingResult.ok ? coachingResult.response : {
        move: 'reaction' as const,
        reply: liveReply,
        correction: '',
        replyQuote: '',
        explanation: '',
        rephrase: '',
        rephraseWhy: ''
      };
      if (!coachingResult.ok) {
        view.actions.log(
          `[conversation Live coaching failed] ${safePanelErrorMessage(coachingResult.error)}`
        );
      }
      invalidateTutorConversationReport(view);
      const current = view.tutorState.conversation;
      view.tutorConversationRawAnswers.set(current.transcript.length, learnerAnswer);
      const displayedAnswer = tutorConversationAnswerForDisplay(view,
        learnerAnswer, response.spokenPunctuated, answerWasSpoken
      );
      const learnerNotShown = tutorLearnerTurnNotShown(learnerAnswer);
      const coach = current.from === 'speakAndRephrase';
      const handoff = coach ? undefined : tutorConversationHandoff(session.takeHandoff?.());
      const liveTurn = {
        ...(handoff ? { handoff } : {}),
        ...(answerWasSpoken && submittedDraft.trim() !== learnerAnswer ? { partiallyHeard: true as const } : {}),
        ...(learnerNotShown ? { learnerNotShown: true as const } : {}),
        question, questionTargetMarks: current.currentQuestionTargetMarks,
        targetMarks: tutorLiveTargetMarks(liveReply, 'reply', current.lessonContext),
        learnerAnswer: displayedAnswer,
        move: response.move,
        reply: liveReply,
        replyQuote: coachingResult.ok && !coach && current.coaching === 'teaching'
          ? tutorConversationLiveReplyQuote(liveReply)
          : '',
        correction: response.correction,
        explanation: response.explanation,
        rephrase: response.rephrase,
        rephraseWhy: response.rephraseWhy,
        spokenPunctuated: response.spokenPunctuated,
        alternatives: 'alternatives' in response ? response.alternatives : undefined,
        ...(!coach && !learnerNotShown && current.coaching === 'afterwards' ? { coachingPending: true as const } : {}),
        ...(!coachingResult.ok ? { coachingFailed: true as const } : {}),
        ...(response.targetId ? { targetId: response.targetId } : {}),
        ...(answerWasSpoken ? { spoken: true as const } : {})
      };
      if (!coach && !learnerNotShown && coachingResult.ok && current.coaching === 'teaching' && !liveTurn.replyQuote) {
        view.actions.log(
          '[conversation Live highlight missing] The spoken reply did not contain "Actually, you would say".'
        );
      }
      view.tutorState = { ...view.tutorState, conversation: {
        ...current,
        transcript: [...current.transcript, liveTurn],
        currentTurnIndex: current.transcript.length,
        currentQuestionTargetMarks: tutorLiveTargetMarks(liveReply, 'reply', current.lessonContext),
        currentQuestion: liveReply,
        hint: undefined,
        draftAnswer: '',
        draftAnswerSpoken: false,
        pendingAnswer: undefined,
        busy: false,
        failure: undefined
      } };
      if (!view.tutorLiveReplyAdvancedTurn) advanceTutorConversationTurn(view);
      scheduleTutorConversationHintPrefetch(view);
      postTutorLiveTurnCommitted(view, liveTurn, current.transcript.length);
      if (view.tutorConversationController === controller) {
        view.tutorConversationController = undefined;
      }
      finishTutorLiveTurnTiming(view, timing);
      applyTutorConversationHandoff(view, handoff);
    } catch (error) {
      if (controller.signal.aborted || view.tutorConversationController !== controller) return;
      const deliberatelyClosed = view.tutorLiveDeliberateClosures.delete(controller);
      const safeError = error instanceof TutorLiveSessionError
        ? error : new TutorLiveSessionError('socketClosed');
      if (!deliberatelyClosed) disableTutorLive(view, safeError, 'turn');
      // A failed Live reply still needs one ordinary request to produce the reply itself.
      // This is not the hidden per-turn correction request removed for When you stop.
      const coachingResult = view.tutorState.conversation.coaching === 'afterwards'
        ? await generateTutorConversation(view,
            request, controller.signal, view.tutorLiveTurnTiming
          ).then(
            (value): TutorLiveCoachingResult => ({
              ok: true, response: tutorConversationTurn(value, tutorLearnerTurnNotShown(learnerAnswer), view.tutorState.conversation.lessonContext?.targets.map((target) => target.targetId))
            }),
            (coachingError: unknown): TutorLiveCoachingResult => ({
              ok: false, error: coachingError
            })
          )
        : await generateTutorConversation(view,
            request, controller.signal, view.tutorLiveTurnTiming
          ).then(
            (value): TutorLiveCoachingResult => ({
              ok: true, response: tutorConversationTurn(value, tutorLearnerTurnNotShown(learnerAnswer), view.tutorState.conversation.lessonContext?.targets.map((target) => target.targetId))
            }),
            (coachingError: unknown): TutorLiveCoachingResult => ({
              ok: false, error: coachingError
            })
          );
      if (controller.signal.aborted || view.tutorConversationController !== controller) return;
      if (coachingResult.ok) {
        completeStandardTutorTurn(view,
          coachingResult.response, question, learnerAnswer, answerWasSpoken,
          answerWasSpoken && submittedDraft.trim() !== learnerAnswer
        );
        view.tutorState = { ...view.tutorState, conversation: {
          ...view.tutorState.conversation, busy: false
        } };
      } else {
        view.tutorState = { ...view.tutorState, conversation: {
          ...view.tutorState.conversation,
          draftAnswer: submittedDraft,
          draftAnswerSpoken: answerWasSpoken,
          pendingAnswer: undefined,
          busy: false,
          failure: tutorConversationFailureMessage(view, coachingResult.error)
        } };
      }
      view.tutorConversationController = undefined;
      view.render();
      if (coachingResult.ok) scheduleTutorConversationHintPrefetch(view);
    }
  }


export function postTutorLiveTurnCommitted(view: KrenResultsViewProvider,
    turn: {
      generation?: number;
      learnerAnswer: string;
      correction: string;
      targetMarks?: TutorTargetMark[];
      replyQuote?: string;
      explanation: string;
      rephrase?: string;
      rephraseWhy?: string;
      alternatives?: Array<{ text: string; why: string }>;
      spoken?: boolean;
      learnerNotShown?: true;
      partiallyHeard?: true;
      coachingFailed?: true;
      coachingPending?: true;
    },
    index: number
  ): void {
    view.tutorConversationPictureEligibleTurn = index;
    if (!view.view) return;
    const conversation = view.tutorState.conversation;
    const answeredTurnCount = conversation.transcript.filter((entry) => !entry.skipped && !entry.learnerNotShown).length;
    const skippedTurnCount = conversation.transcript.filter((entry) => entry.skipped).length;
    const answerMode = turn.spoken ? 'spoken' : 'typed';
    const feedbackEligible = !turn.learnerNotShown && !turn.coachingFailed && !turn.coachingPending && !tutorConversationAnswersMatch(
      turn.correction, turn.learnerAnswer, answerMode
    );
    void view.view.webview.postMessage({
      command: 'tutorLiveTurnCommitted',
      ...(conversation.from === 'speakAndRephrase' ? tutorCoachHighlightPatch(view, index) : {}),
      index,
      correction: turn.correction,
      targetRanges: tutorTargetRanges(conversation.transcript[index]?.reply ?? '', 'reply', turn.targetMarks ?? conversation.transcript[index]?.targetMarks),
      replyQuote: turn.replyQuote ?? '',
      explanation: turn.explanation,
      rephrase: turn.rephrase ?? '',
      rephraseWhy: turn.rephraseWhy ?? '',
      learnerNotShown: turn.learnerNotShown === true,
      partiallyHeard: turn.partiallyHeard === true,
      text: turn.learnerAnswer,
      learnerAnswer: turn.learnerAnswer,
      coachingFailed: turn.coachingFailed === true,
      coachingPending: turn.coachingPending === true,
      teaching: conversation.coaching === 'teaching',
      replayAvailable: tutorLiveReplayAvailable(view),
      feedbackEligible,
      spokenEquivalent: turn.spoken === true && tutorConversationAnswersMatch(
        turn.correction, turn.learnerAnswer, 'spoken'
      ),
      showFeedback: (conversation.coaching !== 'afterwards' || conversation.status === 'stopped') && feedbackEligible,
      rephraseEligible: !turn.learnerNotShown && !turn.coachingFailed && !turn.coachingPending &&
        Boolean(turn.rephrase?.trim() && turn.rephraseWhy?.trim()),
      showRephrase: !turn.learnerNotShown && !turn.coachingFailed && !turn.coachingPending &&
        Boolean(turn.rephrase?.trim() && turn.rephraseWhy?.trim()) &&
        (conversation.coaching !== 'afterwards' || conversation.status === 'stopped'),
      answeredTurnCount,
      skippedTurnCount,
      completedTurnGeneration: turn.generation,
      turnGeneration: view.tutorConversationTurnGeneration
    });
  }


export function postTutorLiveTurnCoaching(view: KrenResultsViewProvider,
    turn: {
      learnerAnswer: string;
      correction: string;
      targetMarks?: TutorTargetMark[];
      replyQuote?: string;
      explanation: string;
      rephrase?: string;
      rephraseWhy?: string;
      alternatives?: Array<{ text: string; why: string }>;
      spoken?: boolean;
      learnerNotShown?: true;
      partiallyHeard?: true;
      coachingFailed?: true;
      coachingPending?: true;
      generation?: number;
    },
    index: number,
    turnGeneration: number | undefined
  ): void {
    if (!view.view) return;
    const conversation = view.tutorState.conversation;
    const answerMode = turn.spoken ? 'spoken' : 'typed';
    const feedbackEligible = !turn.learnerNotShown && !turn.coachingFailed && !turn.coachingPending && !tutorConversationAnswersMatch(
      turn.correction, turn.learnerAnswer, answerMode
    );
    void view.view.webview.postMessage({
      command: 'tutorLiveTurnCoaching',
      ...(conversation.from === 'speakAndRephrase' ? tutorCoachHighlightPatch(view, index) : {}),
      learnerAnswer: turn.learnerAnswer,
      index,
      turnGeneration,
      correction: turn.correction,
      targetRanges: tutorTargetRanges(conversation.transcript[index]?.reply ?? '', 'reply', turn.targetMarks ?? conversation.transcript[index]?.targetMarks),
      replyQuote: turn.replyQuote ?? '',
      explanation: turn.explanation,
      rephrase: turn.rephrase ?? '',
      rephraseWhy: turn.rephraseWhy ?? '',
      learnerNotShown: turn.learnerNotShown === true,
      partiallyHeard: turn.partiallyHeard === true,
      coachingFailed: turn.coachingFailed === true,
      coachingPending: turn.coachingPending === true,
      teaching: conversation.coaching === 'teaching',
      feedbackEligible,
      spokenEquivalent: turn.spoken === true && tutorConversationAnswersMatch(
        turn.correction, turn.learnerAnswer, 'spoken'
      ),
      showFeedback: (conversation.coaching !== 'afterwards' || conversation.status === 'stopped') && feedbackEligible,
      rephraseEligible: !turn.learnerNotShown && !turn.coachingFailed &&
        Boolean(turn.rephrase?.trim() && turn.rephraseWhy?.trim()),
      showRephrase: !turn.learnerNotShown && !turn.coachingFailed &&
        Boolean(turn.rephrase?.trim() && turn.rephraseWhy?.trim()) &&
        (conversation.coaching !== 'afterwards' || conversation.status === 'stopped')
    });
  }


export function skipTutorConversationTurn(view: KrenResultsViewProvider): void {
    const conversation = view.tutorState.conversation;
    if (conversation.status !== 'active' || conversation.busy || conversation.openingReveal) return;
    // 1.64.1 used a fixed question here and then pressed Replay, which in Live mode replays
    // Gemini's audio of the previous message, so the reader heard the old message again.
    if (conversation.replies === 'liveGemini' && view.tutorLiveSession && !view.tutorLiveFailed) {
      void skipLiveTutorTurn(view, view.tutorLiveSession);
      return;
    }
    // This local transition records no answer, including any unsent draft.
    const questions = [
      'What would you like to do next?', 'What matters most to you here?',
      'What would you ask the other person?', 'How would you explain what you need?',
      'What would make this easier for you?', 'What could you suggest instead?'
    ];
    const nextQuestion = questions.find((question, index) =>
      index >= conversation.transcript.length % questions.length && question !== conversation.currentQuestion
    ) ?? questions.find((question) => question !== conversation.currentQuestion)!;
    view.tutorState = { ...view.tutorState, conversation: {
      ...conversation,
      transcript: [...conversation.transcript, {
        question: conversation.currentQuestion, learnerAnswer: '', correction: '',
        explanation: '', nextQuestion, skipped: true
      }],
      currentTurnIndex: conversation.transcript.length,
      currentQuestionTargetMarks: conversation.replies === 'liveGemini' ? tutorLiveTargetMarks(nextQuestion, 'reply', conversation.lessonContext) : undefined,
      currentQuestion: nextQuestion, draftAnswer: '', draftAnswerSpoken: false,
      hint: undefined, failure: undefined
    } };
    advanceTutorConversationTurn(view);
    scheduleTutorConversationHintPrefetch(view);
    if (conversation.speakerOn) {
      speakTutorConversationSequence(view,
        [nextQuestion], 'The question could not be read aloud. Try Replay again.'
      );
    }
    view.render();
  }


export async function skipLiveTutorTurn(view: KrenResultsViewProvider, session: TutorLiveSession): Promise<void> {
    const conversation = view.tutorState.conversation;
    const question = conversation.currentQuestion;
    cancelTutorConversationReplayAll(view);
    beginTutorLiveReply(view);
    const controller = new AbortController();
    view.tutorConversationController = controller;
    const skippedIndex = conversation.transcript.length;
    view.tutorState = { ...view.tutorState, conversation: {
      ...conversation,
      transcript: [...conversation.transcript, {
        question, questionTargetMarks: conversation.currentQuestionTargetMarks, learnerAnswer: '', correction: '', explanation: '', nextQuestion: '', skipped: true
      }],
      currentTurnIndex: skippedIndex,
      currentQuestion: '', draftAnswer: '', draftAnswerSpoken: false,
      hint: undefined, failure: undefined, busy: true
    } };
    advanceTutorConversationTurn(view);
    view.render();
    const isCurrent = () => !controller.signal.aborted &&
      view.tutorConversationController === controller &&
      view.tutorState.conversation.status === 'active';
    try {
      await session.sendTurn(TUTOR_CONVERSATION_LIVE_SKIP_NOTE, tutorLiveChoiceNote(view));
      const reply = view.tutorLiveReplyText.trim();
      if (!reply) throw new TutorLiveSessionError('protocol');
      completeTutorLiveReply(view);
      if (!isCurrent()) return;
      commitSkippedTutorTurn(view, skippedIndex, reply);
      view.tutorConversationController = undefined;
      view.render();
    } catch (error) {
      if (!isCurrent()) return;
      disableTutorLive(view,
        error instanceof TutorLiveSessionError ? error : new TutorLiveSessionError('socketClosed'),
        'skip'
      );
      view.tutorConversationController = undefined;
      commitSkippedTutorTurn(view, skippedIndex, 'What would you like to do next?');
      if (view.tutorState.conversation.speakerOn) {
        speakTutorConversationSequence(view, [view.tutorState.conversation.currentQuestion],
          'The question could not be read aloud. Try Replay again.');
      }
      view.render();
    }
  }


export function commitSkippedTutorTurn(view: KrenResultsViewProvider, index: number, nextQuestion: string): void {
    const current = view.tutorState.conversation;
    view.tutorState = { ...view.tutorState, conversation: {
      ...current,
      transcript: current.transcript.map((turn, position) =>
        position === index ? { ...turn, nextQuestion } : turn
      ),
      currentQuestionTargetMarks: current.replies === 'liveGemini' ? tutorLiveTargetMarks(nextQuestion, 'reply', current.lessonContext) : undefined,
      currentQuestion: nextQuestion,
      busy: false
    } };
    scheduleTutorConversationHintPrefetch(view);
  }


export async function stopTutorConversation(view: KrenResultsViewProvider): Promise<void> {
    const conversation = view.tutorState.conversation;
    if (conversation.status !== 'active') return;
    if (conversation.demoMode) {
      cancelTutorConversationPicture(view);
      closeTutorDemoResources(view);
      view.tutorState = { ...view.tutorState, conversation: {
        ...view.tutorState.conversation,
        status: 'stopped', busy: false, demoEndedAtCap: undefined, failure: undefined
      } };
      reconcileTutorStoppedTakeHome(view);
      view.render(true);
      return;
    }
    if (conversation.replies === 'liveGemini' && tutorLiveReplayAvailable(view)) {
      rememberTutorLiveQuestionAudio(view, conversation.transcript.length);
    }
    // 2026-10-02: Publish the stopped state before asynchronous cleanup can reconcile pictures.
    const closingWebview = view.view;
    view.tutorState = { ...view.tutorState, conversation: { ...conversation, status: 'stopped' } };
    await releaseTutorConversationResources(view);
    // 2026-10-04: Reset or Start new can retire this Stop while capture cleanup is awaited.
    if (view.tutorState.conversation.status !== 'stopped' || view.view !== closingWebview) return;
    const cleanedConversation = view.tutorState.conversation;
    const modelTranscript = tutorConversationTranscriptForModel(view, cleanedConversation);
    const deferredTurns = modelTranscript.filter((turn) =>
      !turn.skipped && !turn.learnerNotShown && turn.coachingPending
    );
    const checkDeferred = cleanedConversation.from !== 'speakAndRephrase' && cleanedConversation.replies === 'liveGemini' &&
      cleanedConversation.coaching === 'afterwards' && deferredTurns.length > 0;
    view.tutorState = {
      ...view.tutorState,
      conversation: {
        ...cleanedConversation,
        status: 'stopped',
        currentQuestion: cleanedConversation.currentQuestion,
        draftAnswer: cleanedConversation.pendingAnswer ?? cleanedConversation.draftAnswer,
        pendingAnswer: undefined,
        busy: checkDeferred,
        hintBusy: false,
        failure: undefined
      }
    };
    reconcileTutorStoppedTakeHome(view);
    view.render(true);
    if (!checkDeferred) return;

    const controller = new AbortController();
    view.tutorConversationController = controller;
    const correctionsRequest = tutorConversationCorrectionsRequest({
          register: cleanedConversation.register,
          recipeTargets: cleanedConversation.recipeTargets, lessonContext: cleanedConversation.lessonContext,
          turns: deferredTurns.map((turn) => ({
            question: turn.question, learnerAnswer: turn.learnerAnswer, ...(turn.spoken ? { spoken: true } : {}),
            previousTurn: tutorCorrectionPreviousTurn(view, modelTranscript.indexOf(turn))
          })),
          ...tutorConversationRequestControls(cleanedConversation),
          setting: tutorConversationSetting(cleanedConversation)
        });
    const current = () => !controller.signal.aborted && view.tutorConversationController === controller &&
      view.tutorState.conversation.status === 'stopped';
    try {
      const value = await generateTutorConversation(view, correctionsRequest, controller.signal, undefined, undefined, value => {
        tutorConversationCorrections(value, deferredTurns.length);
        return { type: 'accepted', value };
      });
      if (!current()) return;
      const corrections = tutorConversationCorrections(value, deferredTurns.length);
      let correctionIndex = 0;
      invalidateTutorConversationReport(view, false);
      view.tutorState = { ...view.tutorState, conversation: {
        ...view.tutorState.conversation,
        transcript: view.tutorState.conversation.transcript.map((turn, position) => {
          if (turn.skipped || !turn.coachingPending) return turn;
          const correction = corrections[correctionIndex++]!;
          const rawAnswer = view.tutorConversationRawAnswers.get(position) ?? turn.learnerAnswer;
          return {
            ...turn,
            learnerAnswer: tutorConversationAnswerForDisplay(view, rawAnswer, correction.spokenPunctuated, turn.spoken === true),
            correction: correction.correction,
            explanation: correction.explanation,
            rephrase: correction.rephrase,
            rephraseWhy: correction.rephraseWhy,
            coachingPending: undefined,
            coachingFailed: undefined,
            ...(correction.targetId ? { targetId: correction.targetId } : { targetId: undefined })
          };
        })
      } };
    } catch (error) {
      if (controller.signal.aborted || view.tutorConversationController !== controller) return;
      view.actions.log(
        `[conversation deferred coaching failed] ${safePanelErrorMessage(error)}`
      );
      view.tutorState = { ...view.tutorState, conversation: {
        ...view.tutorState.conversation,
        transcript: view.tutorState.conversation.transcript.map((turn) =>
          turn.coachingPending
            ? {
                ...turn, correction: '', explanation: '',
                coachingPending: undefined, coachingFailed: true as const
              }
            : turn
        )
      } };
    } finally {
      if (view.tutorConversationController !== controller) return;
      view.tutorConversationController = undefined;
      view.tutorState = { ...view.tutorState, conversation: {
        ...view.tutorState.conversation, busy: false
      } };
      // Patch deferred checks without replacing the stopped balloons or their controls.
      view.tutorState.conversation.transcript.forEach((turn, index) => {
        if (modelTranscript[index]?.coachingPending && !turn.learnerNotShown && !turn.skipped) {
          postTutorLiveTurnCoaching(view, turn, index, turn.generation);
        }
      });
      postTutorConversationStopState(view);
      postTutorTakeHome(view);
    }
  }


export function resumeTutorConversation(view: KrenResultsViewProvider): void {
    const conversation = view.tutorState.conversation;
    if (conversation.status !== 'stopped' || conversation.demoMode) return;
    cancelTutorTakeHome(view, 'hide');
    cancelTutorConversationPicture(view);
    cancelTutorConversationReplayAll(view);
    closeTutorLiveMicrophone(view);
    view.tutorLivePressToTalk = configuredTutorPressToTalk();
    view.tutorLiveMicrophoneSensitivity = configuredTutorMicrophoneSensitivity();
    view.tutorLivePauseBeforeReply = configuredTutorPauseBeforeReply();
    view.tutorLiveSpeechDetection = configuredTutorSpeechDetection();
    const resumed = view.tutorState.conversation;
    view.tutorState = {
      ...view.tutorState,
      conversation: { ...resumed, status: 'active', failure: undefined }
    };
    // Stop closes the Live session, so 1.64.1 came back with no session and the microphone
    // fell back to Handy even with Replies set to Live (Gemini).
    if (resumed.replies === 'liveGemini') void reopenLiveTutorSession(view);
    view.render();
    ensureTutorConversationPicture(view);
    scheduleTutorConversationHintPrefetch(view);
  }


export async function reopenLiveTutorSession(view: KrenResultsViewProvider): Promise<void> {
    const openingContext = view.tutorLiveOpeningContext;
    const conversation = view.tutorState.conversation;
    if (!openingContext || view.tutorLiveFailed || view.tutorLiveSession) {
      view.actions.log('[conversation Live fallback] Back to chat could not reopen the Live session.');
      cancelTutorConversationPicture(view);
      ensureTutorConversationPicture(view);
      return;
    }
    view.tutorLiveResumeController?.abort();
    const controller = new AbortController();
    view.tutorLiveResumeController = controller;
    cancelTutorConversationPicture(view);
    ensureTutorConversationPicture(view);
    postTutorConversationStopState(view);
    const isCurrent = () => !controller.signal.aborted &&
      view.tutorLiveResumeController === controller &&
      view.tutorState.conversation.status === 'active' &&
      // Added 2026-09-20: the reader can choose Standard while this reopen is in flight, and
      // without this the finished session would be adopted under a Standard label.
      view.tutorState.conversation.replies === 'liveGemini';
    const history = tutorConversationTranscriptForModel(view, conversation)
      .slice(-TUTOR_CONVERSATION_CONTEXT_TURNS).flatMap((turn) => [
      { speaker: 'KREN' as const, text: turn.question },
      { speaker: 'learner' as const, text: turn.skipped ? '(skipped this question)' : turn.learnerAnswer }
    ]).concat(conversation.currentQuestion.trim()
      ? [{ speaker: 'KREN' as const, text: conversation.currentQuestion }] : []);
    try {
      const session = await openTutorLiveSession(view,
        tutorConversationLiveSystemInstruction(conversation.from === 'speakAndRephrase'
          ? { ...openingContext, register: conversation.register } : openingContext, conversation.coaching === 'teaching') +
          (conversation.from === 'speakAndRephrase'
            ? ` The coached turns so far are learner data: ${JSON.stringify(history)}. Wait for the learner to speak.`
            : tutorConversationLiveResumeInstruction(history, openingContext.replyLength)),
        controller.signal,
        isCurrent
      );
      if (!isCurrent()) {
        if (view.tutorLiveSession === session) closeTutorLiveSession(view);
        else session.close();
        return;
      }
      postTutorLiveTalkState(view, true);
    } catch (error) {
      if (!isCurrent()) return;
      disableTutorLive(view,
        error instanceof TutorLiveSessionError ? error : new TutorLiveSessionError('socketOpen'),
        'Back to chat'
      );
    } finally {
      if (view.tutorLiveResumeController === controller) {
        view.tutorLiveResumeController = undefined;
        if (view.view) void view.view.webview.postMessage({ command: 'tutorConversationHandoff', reconnecting: false });
      }
      postTutorConversationStopState(view);
      ensureTutorConversationPicture(view);
    }
  }
