import { missingCredentialError, missingCredentialMessage, missingCredentialsOf, runTutorContentRequest, type ContentValidation, type RequestIdentity, recordedRequestOutcome, requestFailure, presentRequestFailure } from './requestCenter.js';
import * as vscode from 'vscode';
import { tutorConversationRequestControls, tutorConversationCoachOpening } from './tutor/generation.js';
import { tutorConversationCoachingRequest, tutorConversationCoaching } from './tutor/generation.js';
import { CloudflareAiError, cloudflareMissingCredentialError, CLOUDFLARE_AUTHENTICATION, CLOUDFLARE_PICTURE_ALLOWANCE } from './providers/cloudflare.js';
import { cancelTutorTakeHome } from './resultsViewTakeHome.js';
import { showTutorLessonUnavailable } from './resultsViewSettings.js';
import { tutorLessonConversationReadiness, tutorLessonConversationContext, resolveTutorConversationSituation, tutorTargetRanges, tutorLiveTargetMarks } from './tutor/lessonConversation.js';
import { tutorLearnerTurnNotShown, tutorLearnerTurnText } from './tutor/learnerLanguage.js';
import { tutorConversationVisibleReply, tutorConversationQuestionRepeatsReply } from './resultViewHtml.js';
import { invalidateTutorConversationReport } from './resultsViewLesson.js';
import type { LanguageModelRoutingEffort } from './languageModelRouting.js';
import type { TutorLiveCoachingResult } from './resultsView.js';
import type { KrenResultsViewProvider } from './resultsView.js';
import { postTutorConversationStopState } from './resultsViewStop.js';
import { beginTutorLiveReply, rememberTutorLiveQuestionAudio, playTutorLiveAudio, tutorLivePlaybackProgress, closeTutorLiveMicrophone, closeTutorLiveSession, appendTutorLiveReply, appendTutorLiveInput, beginTutorLiveSpokenReply, finishTutorLiveSpokenTurn, interruptTutorLiveReply, postTutorLiveAudio, tutorLiveReplayAvailable, failTutorLiveAudio, logTutorLiveAudioError, postTutorLiveSpeakerState, disableTutorLive } from './resultsViewLive.js';
import { safePanelErrorMessage, tutorFailureMessage } from './resultsViewErrors.js';
import { findTutorSituation, tutorCustomSituation, findTrainingMapNode } from '@kren/core/tutor';
import type { TutorLanguageModelRoute } from './operations.js';
import { ProviderError } from './errors.js';
import type { GeminiQuotaCategory } from './providers/gemini.js';
import { tutorConversationOpening, tutorConversationOpeningRequest, tutorConversationSceneSlant, tutorConversationHintRequest, tutorLiveSessionCredential, tutorLiveSessionCredentialRequest, tutorConversationTurn } from './tutor/generation.js';
import type { TutorConversationOpening, TutorStructuredGenerationRequest } from './tutor/generation.js';
import { tutorRecipeFromState, tutorResetAvailability, normalizedTutorLiveVoice } from './tutor/state.js';
import type { TutorLiveVoiceGender } from './tutor/state.js';
import { TutorLiveSession, TutorLiveSessionError } from './tutor/liveSession.js';
import { LiveConversationTurnTiming, StandardConversationTurnTiming } from './tutor/conversationTiming.js';
import type { TutorRecipe } from '@kren/core/tutor';
import { isKnownGeminiLiveOnlyModel } from './providers/geminiModels.js';
import { closeTutorDemoResources } from './resultsViewDemo.js';
import { cancelTutorConversationReplayAll, speakTutorConversationSequence } from './resultsViewReplay.js';
import { configuredTutorLiveModel, configuredTutorHintModel, configuredTutorLiveTranscriptionLanguage, tutorModelForRoute, configuredTutorPressToTalk, configuredTutorPauseBeforeReply, configuredTutorSpeechDetection, configuredTutorMicrophoneSensitivity } from './resultsViewConfiguration.js';
import { clearTutorConversationHintPrefetchTimer } from './resultsViewHints.js';
import { scheduleTutorConversationHintPrefetch } from './resultsViewHints.js';
import { postTutorConversationHintState } from './resultsViewHints.js';
import { startLiveTutorOpening, reopenLiveTutorSession } from './resultsViewTurns.js';
import { situationPictureScene } from './providers/situationPicture.js';
import { tutorConversationVoicePlan } from './speech/voiceSelection.js';

class TutorOrdinaryLiveModelError extends Error {}


/**
 * The thinking level a conversation reply asks for first. A chat reply is answered, not
 * deliberated. It was 'minimal' until 1.56.1, which gemini-3.8-flash refuses outright with
 * "Thinking level MINIMAL is not supported for this model", so every conversation turn failed
 * the moment the reader switched to that model. 'low' is accepted more widely, and a model that
 * refuses it anyway falls back to the reader's own level through `isThinkingLevelRefusal`.
 */
export const TUTOR_CONVERSATION_EFFORT: LanguageModelRoutingEffort = 'low';

/** The last known Flash entry is the lower-latency Hint default, not a recalled model name. */
/** True when a provider rejected the request because of the thinking level or effort it named. */
export function isThinkingLevelRefusal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(thinking[ _]?level|reasoning[ _]?effort|effort)[^.]{0,80}(not supported|unsupported|invalid)/iu.test(message) ||
    /unsupported value[^.]{0,80}(thinking|reasoning|effort)/iu.test(message);
}

export function advanceTutorConversationTurn(view: KrenResultsViewProvider): void {
    clearTutorConversationHintPrefetchTimer(view);
    view.tutorConversationTurnGeneration += 1;
    view.tutorConversationHintController?.abort();
    view.tutorConversationHintController = undefined;
    view.tutorConversationHintRequest = undefined;
    view.tutorConversationPrefetchedHint = undefined;
    view.tutorConversationHintPrefetchAttemptedGeneration = undefined;
    view.tutorState = { ...view.tutorState, conversation: {
      ...view.tutorState.conversation,
      hint: undefined,
      hintBusy: false,
      hintFailure: undefined
    } };
    postTutorConversationHintState(view, {
      clear: true, turnGeneration: view.tutorConversationTurnGeneration
    });
  }


/** Guard ordinary model routes, then submit feature validation to the center. */
export async function generateTutorConversation(view: KrenResultsViewProvider,
    request: TutorStructuredGenerationRequest,
    signal: AbortSignal,
    timing?: LiveConversationTurnTiming | StandardConversationTurnTiming,
    selectedRoute: TutorLanguageModelRoute = tutorLanguageModelRoute(view),
    validate?: (value: unknown) => ContentValidation<unknown>,
    trigger: RequestIdentity['trigger'] = 'explicitAction'
  ): Promise<unknown> {
    const route: TutorLanguageModelRoute = timing ? {
      ...selectedRoute,
      onProviderAttempt: () => timing.providerAttempt(),
      onProviderBackoff: (milliseconds) => timing.providerBackoff(milliseconds)
    } : selectedRoute;
    const knownModels = [...view.proModels, ...view.liveModels];
    const fastModel = route.fastModel ?? configuredTutorHintModel();
    const liveOnlyModel = route.provider === 'gemini' &&
      isKnownGeminiLiveOnlyModel(route.model, knownModels)
      ? {
          model: route.model,
          setting: route.geminiProfile === 'pro'
            ? 'kren.tutor.alternateModel'
            : 'kren.tutor.model'
        }
      : route.provider === 'gemini' &&
          isKnownGeminiLiveOnlyModel(fastModel, knownModels)
        ? { model: fastModel, setting: 'kren.tutor.hintModel' }
        : undefined;
    if (liveOnlyModel) {
      throw new TutorOrdinaryLiveModelError(
        `Gemini Live model ${liveOnlyModel.model} cannot answer ordinary requests. Change ${liveOnlyModel.setting} in LLM ROUTING.`
      );
    }
    const data = JSON.parse(request.input);
    const check = validate ?? (request.kind === 'conversationTurn' || request.kind === 'conversationOpening' ||
      request.schemaName === 'kren_tutor_conversation_coaching' ? (value: unknown): ContentValidation<unknown> => {
        if (data.coach) {
          const { nextQuestion: _question, handoff: _handoff, ...coached } = value as Record<string, unknown>;
          const turn = tutorConversationTurn(coached);
          if (!turn.reply?.trim()) throw new Error('AI English Tutor received no readable coach reply.');
          if (!turn.alternatives?.length) {
            view.actions.log('[conversation coach alternatives check failed] No readable alternatives.');
          }
          return { type: 'accepted', value: coached };
        }
        const targets = data.lessonContext?.targets?.map((target: { targetId: string }) => target.targetId);
        if (request.kind === 'conversationOpening') tutorConversationOpening(value, Array.isArray(request.schema.required) && request.schema.required.includes('opening'), targets);
        else if (request.schemaName === 'kren_tutor_conversation_coaching') tutorConversationCoaching(value, data.learnerAnswer ?? '');
        else tutorConversationTurn(value, tutorLearnerTurnNotShown(data.learnerAnswer ?? ''), targets);
        return { type: 'accepted', value };
      } : undefined);
    return check ? runTutorContentRequest({ request, route, signal, generate: view.actions.generateTutor.bind(view.actions),
      contentRetry: { allowance: 0 }, validate: check, trigger, log: line => view.actions.log(line) })
      : view.actions.generateTutor(request, route, signal);
  }


export function tutorLiveCoaching(view: KrenResultsViewProvider,
    request: TutorStructuredGenerationRequest,
    controller: AbortController,
    learnerAnswer: string,
    timing = view.tutorLiveTurnTiming
  ): Promise<TutorLiveCoachingResult> {
    if (tutorLearnerTurnNotShown(learnerAnswer)) {
      return Promise.resolve({ ok: true, response: {
        move: 'reaction', reply: '', correction: '', explanation: '', rephrase: '', rephraseWhy: ''
      } });
    }
    const coach = view.tutorState.conversation.from === 'speakAndRephrase';
    if (!coach && view.tutorState.conversation.coaching === 'afterwards') {
      return Promise.resolve({
        ok: true,
        response: {
          move: 'reaction',
          reply: learnerAnswer,
          replyQuote: '',
          correction: learnerAnswer,
          explanation: 'This turn will be checked when the conversation stops.'
        }
      });
    }
    timing?.coachingRequestSent();
    return generateTutorConversation(view,
      tutorConversationCoachingRequest(request), controller.signal, timing
    ).then(
      (value): TutorLiveCoachingResult => {
        timing?.coachingRequestReturned();
        return { ok: true, response: coach
          ? tutorConversationTurn(value) : tutorConversationCoaching(value, learnerAnswer) };
      },
      (error: unknown): TutorLiveCoachingResult => {
        timing?.coachingRequestReturned();
        return { ok: false, error };
      }
    ).catch((error: unknown): TutorLiveCoachingResult => ({ ok: false, error }));
  }


  /**
   * Provider bodies belong in the output channel, never in the conversation panel. The panel
   * receives one actionable sentence, with more specific guidance for capacity and model errors.
   */
export function tutorConversationFailureMessage(view: KrenResultsViewProvider, error: unknown, opening = false): string {
    if (error instanceof Error && error.name === 'AbortError') return 'The request was canceled.';
    if (error instanceof TutorOrdinaryLiveModelError) return error.message;
    const detail = safePanelErrorMessage(error);
    view.actions.log(`[conversation provider failure] ${detail}`);
    const configuredRoute = tutorLanguageModelRoute(view);
    const route = error instanceof ProviderError && error.attemptedRoute
      ? { ...configuredRoute, ...error.attemptedRoute } : configuredRoute;
    const status = error instanceof ProviderError
      ? error.status
      : Number(/\((\d{3})\)/u.exec(detail)?.[1]);
    const recorded = recordedRequestOutcome(error);
    const outcome = recorded?.type === 'failed' ? recorded : requestFailure(error,
      { ...route, mode: 'thorough', effort: route.thinkingOrEffort });
    // Legacy host adapters can still return an untyped HTTP error. Keep their literal conversation contract.
    if (!recorded && !(error instanceof ProviderError)) outcome.cause = 'noResponse';
    const quotaCategory = /"quotaCategory"\s*:\s*"(perDay|perMinute|perHour|other)"/u.exec(detail)?.[1] as GeminiQuotaCategory | undefined;
    return presentRequestFailure(outcome, { conversation: true, opening, quotaCategory,
      rejectedModel: status === 400 && /\bmodel\b/iu.test(detail) }).message;
  }


export function tutorLanguageModelRoute(view: KrenResultsViewProvider): TutorLanguageModelRoute {
    const settings = view.actions.settings();
    const provider = view.tutorState.settings.routing.provider;
    return {
      ...view.tutorState.settings.routing,
      model: tutorModelForRoute(settings, provider),
      geminiProfile: settings.tutorProfile ?? 'standard',
      fallbackEnabled: settings.tutorFallbackEnabled,
      fallbackModel: settings.tutorFallbackModel,
      fallbackThinkingOrEffort: settings.tutorFallbackThinkingOrEffort
    };
  }


export function tutorConversationHintLanguageModelRoute(view: KrenResultsViewProvider): TutorLanguageModelRoute {
    const route = tutorLanguageModelRoute(view);
    const hintModel = configuredTutorHintModel();
    return { ...route, fastModel: hintModel };
  }


const pendingLiveStarts = new WeakSet<KrenResultsViewProvider>();

/** Ask before any opening request, and save the chosen route before continuing. */
export function guardTutorLiveStart(view: KrenResultsViewProvider, start: () => void): boolean {
  if (pendingLiveStarts.has(view)) return false;
  if (view.tutorState.conversation.replies !== 'liveGemini') return true;
  const settings = view.actions.settings();
  const profile = settings.tutorLiveProfile ?? 'standard';
  const keys = settings.credentialPresence;
  if (profile === 'pro' ? keys?.geminiAlternate : keys?.geminiDefault) return true;
  const label = profile === 'pro' ? 'Paid' : 'Free Tier';
  const other = profile === 'pro' ? 'standard' : 'pro';
  const otherLabel = other === 'pro' ? 'Paid' : 'Free Tier';
  const otherStored = other === 'pro' ? keys?.geminiAlternate : keys?.geminiDefault;
  const useOther = `Use Gemini ${otherLabel}`;
  const choices = [...(otherStored ? [useOther] : []), 'Switch to Standard'];
  pendingLiveStarts.add(view);
  void (async () => {
    try {
      const choice = await view.showInformationMessage(
        `Live replies need the Gemini ${label} key. Set it in Credentials, choose the other profile for Live, or switch Replies to Standard.`,
        { modal: true }, ...choices);
      if (choice === useOther && otherStored) {
        const config = vscode.workspace.getConfiguration('kren');
        const scope = config.inspect<string>('tutor.liveGeminiProfile');
        // Replace the effective override because a Global write cannot change it.
        const target = scope?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
          : scope?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : undefined;
        if (target !== undefined) await config.update('tutor.liveGeminiProfile', other, target);
        else await view.actions.updateSetting('tutor.liveGeminiProfile', other);
      } else if (choice === 'Switch to Standard') {
        view.tutorState = { ...view.tutorState, conversation: { ...view.tutorState.conversation, replies: 'standard' } };
        view.persistTutorPreferences();
      } else return;
      pendingLiveStarts.delete(view);
      start();
    } catch {
      view.actions.notify('error', 'KREN could not save the Live reply choice. Try Start again.');
    } finally {
      pendingLiveStarts.delete(view);
    }
  })();
  return false;
}

export function startTutorConversation(view: KrenResultsViewProvider): void {
    if (view.tutorState.conversation.status === 'active') {
      if (!view.tutorState.conversation.busy &&
          !view.tutorState.conversation.currentQuestion.trim() &&
          view.tutorState.conversation.transcript.length === 0 &&
          view.tutorState.conversation.failure) {
        retryTutorConversationOpening(view);
      }
      return;
    }
    if (view.tutorState.conversation.from === 'lesson' && !tutorLessonConversationReadiness(view.tutorState).ready) {
      void showTutorLessonUnavailable(view);
      return;
    }
    if (!guardTutorLiveStart(view, () => startTutorConversation(view))) return;
    cancelTutorConversationReplayAll(view);
    view.tutorLiveConversationAudio.clear();
    view.tutorConversationRawAnswers.clear();
    if (view.tutorState.conversation.status === 'stopped') {
      const wasDemo = resetStoppedTutorConversation(view);
      if (!wasDemo) return;
    }
    const liveVoice = normalizedTutorLiveVoice(view.tutorState.conversation.liveVoice);
    if (liveVoice !== view.tutorState.conversation.liveVoice) {
      view.tutorState = { ...view.tutorState, conversation: {
        ...view.tutorState.conversation, liveVoice
      } };
    }
    let recipe: TutorRecipe | undefined;
    try {
      if (view.tutorState.conversation.from === 'lesson') recipe = view.tutorState.lesson!.recipe;
    } catch (error) {
      view.tutorState = {
        ...view.tutorState,
        conversation: {
          ...view.tutorState.conversation,
          failure: tutorFailureMessage(error)
        }
      };
      view.render();
      return;
    }
    const setup = { ...view.tutorState.conversation, picturePaused: undefined, tutorRole: undefined, learnerRole: undefined, openingReveal: undefined };
    const lessonContext = setup.from === 'lesson' ? tutorLessonConversationContext(view.tutorState) : undefined;
    const resolvedSituationId = resolveTutorConversationSituation(setup.situationId);
    cancelTutorConversationPicture(view);
    view.tutorConversationPictureLastTriggeredTurn = -1;
    view.tutorConversationScene = undefined;
    view.tutorConversationPictureController?.abort();
    view.tutorConversationPictureController = undefined;
    view.tutorConversationPicture = undefined;
    view.tutorConversationPictures = [];
    view.tutorConversationPictureTurns = [];
    view.tutorConversationPictureCount = 0;
    view.tutorConversationPictureAccepted.clear();
    view.tutorConversationPictureFailures = 0;
    view.tutorConversationPictureStopped = false;
    view.tutorState.conversation.picturePaused = undefined;
    const situation = resolvedSituationId === 'custom'
      ? tutorCustomSituation(setup.customSituation) : findTutorSituation(resolvedSituationId);
    if (setup.from !== 'anything' && setup.from !== 'speakAndRephrase' && !situation) return;
    const primaryTargetLabel = recipe?.primaryTargets?.[0] === undefined
      ? undefined : findTrainingMapNode(recipe.primaryTargets[0])?.label;
    const supportingTargetLabels = (recipe?.supportingTargets ?? []).flatMap((targetId) => {
      const label = findTrainingMapNode(targetId)?.label;
      return label ? [label] : [];
    });
    view.tutorSpeechConversation = {};
    setup.liveVoice = tutorConversationVoicePlan(view, true).current.liveVoice;
    const openingContext = setup.from === 'situation'
      ? {
          ...tutorConversationRequestControls(setup), kind: 'situation', setting: situation!.setting, register: setup.register,
          sceneSlant: tutorConversationSceneSlant(), rolesSwapped: setup.rolesSwapped,
          learnerStarts: setup.starts === 'learner',
          voiceGender: tutorConversationVoiceGender(view, setup), replyLength: setup.replyLength
        } as const
      : setup.from === 'lesson'
        ? {
            ...tutorConversationRequestControls(setup), kind: 'lesson', register: setup.register, primaryTargetLabel: primaryTargetLabel ?? lessonContext!.subject,
            lessonContext, setting: situation!.setting, rolesSwapped: setup.rolesSwapped,
            supportingTargetLabels, sceneSlant: tutorConversationSceneSlant(),
            learnerStarts: setup.starts === 'learner',
            voiceGender: tutorConversationVoiceGender(view, setup), replyLength: setup.replyLength
          } as const
        : {
            ...tutorConversationRequestControls(setup), kind: 'anything', register: setup.register,
            sceneSlant: tutorConversationSceneSlant(), learnerStarts: setup.starts === 'learner',
            voiceGender: tutorConversationVoiceGender(view, setup), replyLength: setup.replyLength
          } as const;
    const openingRequest = tutorConversationOpeningRequest(openingContext);
    const controller = new AbortController();
    view.tutorConversationController = controller;
    closeTutorLiveSession(view);
    view.tutorLivePressToTalk = configuredTutorPressToTalk();
    view.tutorLiveMicrophoneSensitivity = configuredTutorMicrophoneSensitivity();
    view.tutorLivePauseBeforeReply = configuredTutorPauseBeforeReply();
    view.tutorLiveSpeechDetection = configuredTutorSpeechDetection();
    view.tutorLiveFailed = false;
    invalidateTutorConversationReport(view);
    view.tutorState = {
      ...view.tutorState,
      conversation: {
        ...setup, lessonContext, resolvedSituationId, currentQuestionTargetMarks: undefined, coachOpen: false, hint: undefined, hintBusy: false,
        hintFailure: undefined, failure: undefined, openModeAfterRender: false,
        status: 'active',
        recipeTargets: {
          ...(recipe?.primaryTargets?.[0] === undefined
            ? {}
            : { primaryTarget: recipe?.primaryTargets?.[0] }),
          supportingTargets: [...(recipe?.supportingTargets ?? [])]
        },
        transcript: [],
        unansweredReplies: undefined,
        currentTurnIndex: 0,
        currentQuestion: '',
        draftAnswer: '',
        draftAnswerSpoken: false,
        pendingAnswer: undefined,
        busy: true
      }
    };
    advanceTutorConversationTurn(view);
    view.pendingTutorConversationFocus = true;
    view.render();
    view.tutorState = { ...view.tutorState, conversation: {
      ...view.tutorState.conversation, openModeAfterRender: undefined
    } };
    // Kept for both modes since 1.71.0: a reader who switches to Live mid-conversation needs
    // the same context Back to chat uses, and a Standard start used to leave it unset.
    view.tutorLiveOpeningContext = openingContext;
    if (setup.from === 'speakAndRephrase') {
      completeTutorConversationOpening(view, { scene: '', tutorRole: '', learnerRole: '',
        opening: tutorConversationCoachOpening(setup.register) }, controller, false);
      if (view.tutorConversationController === controller) view.tutorConversationController = undefined;
      // Live setup obtains a credential and opens the socket, but asks for no generated opening.
      if (setup.replies === 'liveGemini' && !setup.speakerOn) void reopenLiveTutorSession(view);
      return;
    }
    if (setup.replies === 'standard') {
      startStandardTutorOpening(view, openingRequest, controller);
      return;
    }
    void startLiveTutorOpening(view, openingContext, openingRequest, controller);
  }


export function retryTutorConversationOpening(view: KrenResultsViewProvider): void {
    const openingContext = view.tutorLiveOpeningContext;
    if (!openingContext) return;
    view.tutorConversationController?.abort();
    const controller = new AbortController();
    view.tutorConversationController = controller;
    view.tutorState = { ...view.tutorState, conversation: {
      ...view.tutorState.conversation, currentQuestion: '', failure: undefined, busy: true
    } };
    view.render();
    const request = { ...tutorConversationOpeningRequest(openingContext), retry: true };
    if (view.tutorState.conversation.replies === 'liveGemini') {
      void startLiveTutorOpening(view, openingContext, request, controller);
      return;
    }
    startStandardTutorOpening(view, request, controller);
  }


export function startStandardTutorOpening(view: KrenResultsViewProvider,
    openingRequest: TutorStructuredGenerationRequest,
    controller: AbortController
  ): void {
    void generateTutorConversation(view, openingRequest, controller.signal).then((value) => {
      completeTutorConversationOpening(view,
        tutorConversationOpening(value, view.tutorState.conversation.starts === 'kren', view.tutorState.conversation.lessonContext?.targets.map((target) => target.targetId)),
        controller,
        false
      );
    }).catch((error: unknown) => {
      failTutorConversationOpening(view, error, controller);
    }).finally(() => {
      if (view.tutorConversationController === controller) {
        view.tutorConversationController = undefined;
      }
    });
  }


export function completeTutorConversationOpening(view: KrenResultsViewProvider,
    result: TutorConversationOpening,
    controller: AbortController,
    live: boolean
  ): void {
    if (controller.signal.aborted || view.tutorConversationController !== controller ||
        view.tutorState.conversation.status !== 'active') return;
    const current = view.tutorState.conversation;
    view.tutorConversationScene = result.scene;
    view.tutorState = { ...view.tutorState, conversation: {
      ...current, tutorRole: result.tutorRole, learnerRole: result.learnerRole,
      openingReveal: !live && current.speakerOn ? 'scene' : undefined,
      currentQuestion: result.opening ?? '', currentQuestionTargetMarks: result.targetMarks, busy: false
    } };
    if (view.tutorLiveOpeningContext) view.tutorLiveOpeningContext = {
      ...view.tutorLiveOpeningContext, tutorRole: result.tutorRole, learnerRole: result.learnerRole
    };
    if (view.view) void view.view.webview.postMessage({
      command: 'tutorConversationOpeningReady',
      resetAvailability: tutorResetAvailability(view.tutorState),
      targetRanges: tutorTargetRanges(result.opening ?? '', 'opening', result.targetMarks),
      scene: result.scene,
      ...(result.opening && (live || !current.speakerOn) ? { opening: result.opening } : {}),
      reveal: view.tutorState.conversation.openingReveal ?? 'ready',
      talkAvailable: live,
      replayAvailable: live && tutorLiveReplayAvailable(view),
      pressToTalk: view.tutorLivePressToTalk
    });
    ensureTutorConversationPicture(view);
    scheduleTutorConversationHintPrefetch(view);
    if (!live && current.speakerOn) {
      const coach = current.from === 'speakAndRephrase';
      speakTutorConversationSequence(view,
        [...(result.scene ? [result.scene] : []), ...(result.opening ? [result.opening] : [])],
        'The scene or opening could not be read aloud. Try Replay again.', false, Boolean(result.scene),
        (completed) => advanceTutorConversationOpening(view, !coach && completed === 1 && Boolean(result.opening) ? 'waiting' : 'ready'),
        (index) => { if (index === (coach ? 0 : 1)) advanceTutorConversationOpening(view, 'opening'); }
      );
    }
    postTutorConversationStopState(view);
  }

// 2026-10-11: Patch the mounted draft as each Standard opening utterance finishes.
export function advanceTutorConversationOpening(view: KrenResultsViewProvider, reveal: 'waiting' | 'opening' | 'ready'): void {
  const conversation = view.tutorState.conversation;
  if (!conversation.openingReveal) return;
  const showOpening = reveal === 'opening' || (reveal === 'ready' && conversation.openingReveal !== 'opening');
  view.tutorState = { ...view.tutorState, conversation: {
    ...conversation, openingReveal: reveal === 'ready' ? undefined : reveal
  } };
  if (view.view) void view.view.webview.postMessage({
    command: 'tutorConversationOpeningReady', reveal, scene: view.tutorConversationScene,
    resetAvailability: tutorResetAvailability(view.tutorState),
    talkAvailable: false, replayAvailable: false, pressToTalk: view.tutorLivePressToTalk,
    ...(showOpening && conversation.currentQuestion ? { opening: conversation.currentQuestion } : {}),
    targetRanges: tutorTargetRanges(conversation.currentQuestion, 'opening', conversation.currentQuestionTargetMarks)
  });
  if (reveal === 'ready' && conversation.from === 'speakAndRephrase' && conversation.status === 'active' &&
      conversation.replies === 'liveGemini' && !view.tutorLiveFailed && !view.tutorLiveSession && !view.tutorLiveResumeController) {
    void reopenLiveTutorSession(view);
  }
}

export function tutorConversationVoiceGender(view: KrenResultsViewProvider,
    conversation = view.tutorState.conversation
  ): TutorLiveVoiceGender | undefined {
    return tutorConversationVoicePlan(view).tutorGender;
  }


export function showTutorConversationScene(view: KrenResultsViewProvider, scene: string): void {
    view.tutorConversationScene = scene;
    if (view.view) void view.view.webview.postMessage({
      command: 'tutorConversationSceneReady', scene
    });
    ensureTutorConversationPicture(view);
  }

export function cancelTutorConversationPicture(view: KrenResultsViewProvider): void {
  const pending = view.tutorConversationPicturePending;
  view.tutorConversationPictureEpoch += 1;
  view.tutorConversationPictureController?.abort();
  view.tutorConversationPictureController = undefined;
  view.tutorConversationPicturePending = undefined;
  view.tutorConversationPictureEligibleTurn = undefined;
  view.tutorConversationPictureContinuationTurn = undefined;
  view.tutorConversationPictureCommitPending = false;
  // 2026-10-02: Cancel decoding in the current document as well as host bookkeeping.
  if (pending) void view.view?.webview.postMessage({
    command: 'tutorConversationPictureCancelled', requestId: pending.requestId
  });
  void view.view?.webview.postMessage({ command: 'tutorConversationPictureRequestFinished' });
}

const tutorPictureCredentialNotices = new WeakSet<object>();
const tutorPictureCredentialPauses = new WeakSet<object>();

/** Reconcile current host state; callers never decide whether to request an intro or continuation. */
export function pauseTutorPictures(view: KrenResultsViewProvider, reason: 'paidKey' | 'quota' | 'missing' | 'authentication' | 'timeout' | 'other', cloudflare = view.actions.settings().tutorPictureProvider === 'cloudflare', credentialError?: unknown): void {
  // A newly saved key can reconcile the pending intro; repeated failures stay stopped.
  view.tutorConversationPictureStopped = reason !== 'missing';
  const presence = view.actions.settings().credentialPresence;
  const missing = reason === 'missing' ? missingCredentialsOf(credentialError) ? credentialError : cloudflare
    ? cloudflareMissingCredentialError(Boolean(presence?.cloudflareAccountId), Boolean(presence?.cloudflareApiToken))
    : missingCredentialError('gemini', 'pro') : undefined;
  const details = missingCredentialsOf(missing);
  const text = details ? missingCredentialMessage(details) : cloudflare
    ? reason === 'quota' ? CLOUDFLARE_PICTURE_ALLOWANCE
        : reason === 'authentication' ? `Pictures paused: Cloudflare picture ${CLOUDFLARE_AUTHENTICATION} The conversation continues without pictures.`
        : reason === 'timeout' ? 'Pictures paused: the Cloudflare picture request timed out. The conversation continues without pictures.'
        : 'Pictures paused: Cloudflare could not provide a usable picture. The conversation continues without pictures.'
    : reason === 'paidKey'
    ? 'Pictures paused: situation pictures need a Gemini Paid API key with billing enabled. The conversation continues without pictures.'
    : reason === 'quota'
    ? 'Pictures paused: Google refused the picture request for quota. Pictures may need a Gemini Paid API key with billing enabled. The conversation continues without pictures.'
    : 'Pictures paused: Gemini could not provide a usable picture. The conversation continues without pictures.';
  view.tutorState.conversation.picturePaused = text;
  void view.view?.webview.postMessage({ command: 'tutorPicturePaused', text });
  if (missing) {
    const identity = view.tutorSpeechConversation;
    tutorPictureCredentialPauses.add(identity);
    if (!tutorPictureCredentialNotices.has(identity)) {
      tutorPictureCredentialNotices.add(identity);
      view.showMissingCredentialError(missing, true);
    }
  }
}

const tutorPictureReplacements = new WeakSet<object>();

/** A handoff is one explicit turn action and requests one replacement, even for Intro Only. */
export function refreshTutorConversationPicture(view: KrenResultsViewProvider, defer = false): void {
  if (view.tutorState.conversation.situationPicture === 'none') return;
  cancelTutorConversationPicture(view);
  const identity = view.tutorSpeechConversation;
  if (identity !== null && (typeof identity === 'object' || typeof identity === 'function')) tutorPictureReplacements.add(identity);
  if (!defer) ensureTutorConversationPicture(view);
}

export function ensureTutorConversationPicture(view: KrenResultsViewProvider): void {
    if (view.tutorState.conversation.from === 'speakAndRephrase') return;
    const replaceCharacter = tutorPictureReplacements.has(view.tutorSpeechConversation);
    const conversation = view.tutorState.conversation;
    const originalScene = view.tutorConversationScene;
    const voices = tutorConversationVoicePlan(view);
    const tutorGender = voices.tutorGender;
    const scene = originalScene && situationPictureScene(originalScene, {
      tutorRole: conversation.tutorRole, learnerRole: conversation.learnerRole, tutorGender,
      learnerGender: voices.learnerGender
    }, replaceCharacter);
    const settings = view.actions.settings();
    const cloudflare = settings.tutorPictureProvider === 'cloudflare';
    const credentialsPresent = cloudflare
      ? Boolean(settings.credentialPresence?.cloudflareAccountId && settings.credentialPresence?.cloudflareApiToken)
      : settings.credentialPresence?.geminiAlternate === true;
    const developing = ['switching', 'graduallyEntering'].includes(conversation.situationPicture);
    if (credentialsPresent && !view.tutorConversationPictureStopped &&
        tutorPictureCredentialPauses.has(view.tutorSpeechConversation)) {
      tutorPictureCredentialPauses.delete(view.tutorSpeechConversation);
      conversation.picturePaused = undefined;
      void view.view?.webview.postMessage({ command: 'tutorPicturePaused', text: '' });
    }
    if (view.view && scene && conversation.status === 'active' && conversation.situationPicture !== 'none' &&
        !view.tutorConversationPictureStopped && !credentialsPresent) {
      pauseTutorPictures(view, 'missing');
    }
    if (!view.view || !scene || conversation.status !== 'active' || conversation.situationPicture === 'none' ||
        !credentialsPresent || view.tutorLiveResumeController || view.tutorLiveSession?.isReconnecting() ||
        view.tutorConversationPictureController || view.tutorConversationPicturePending ||
        (!replaceCharacter && (view.tutorConversationPictureCount >= 10 || view.tutorConversationPictureFailures >= 2 || view.tutorConversationPictureStopped)) ||
        !view.actions.generateSituationPicture) return;
    const next = view.tutorConversationPictures.length > 0;
    const committedTurn = replaceCharacter ? conversation.transcript.length - 1 : view.tutorConversationPictureContinuationTurn;
    if (next && !replaceCharacter) {
      if (!developing || committedTurn === undefined || committedTurn !== view.tutorConversationPictureEligibleTurn ||
          committedTurn !== (conversation.demoMode ? conversation.demoLines.length - 1 : conversation.transcript.length - 1) || committedTurn <= view.tutorConversationPictureLastTriggeredTurn) return;
    }
    if (replaceCharacter) {
      tutorPictureReplacements.delete(view.tutorSpeechConversation);
      view.tutorConversationPictureFailures = 0;
    }
    if (committedTurn !== undefined) {
      view.tutorConversationPictureLastTriggeredTurn = committedTurn;
      view.tutorConversationPictureEligibleTurn = undefined;
      view.tutorConversationPictureContinuationTurn = undefined;
    }
    const epoch = view.tutorConversationPictureEpoch;
    const requestId = ++view.tutorConversationPictureRequestId;
    const latest = view.tutorConversationPictures.at(-1);
    const reference = !replaceCharacter && next && latest ? { turns: situationPictureTurns(conversation), picture: latest } : undefined;
    const controller = new AbortController();
    view.tutorConversationPictureController = controller;
    // 2026-10-10: Cloudflare's deadline includes body consumption; reader cancellation stays silent.
    let timedOut = false;
    const timeout = cloudflare ? setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.max(settings.requestTimeoutMs ?? 30_000, 60_000)) : undefined;
    const clearDeadline = () => clearTimeout(timeout);
    controller.signal.addEventListener('abort', clearDeadline, { once: true });
    // This promise is independent of opening, speech, and turns.
    const request = reference
      ? view.actions.generateSituationPicture(scene, controller.signal, reference)
      : view.actions.generateSituationPicture(scene, controller.signal);
    let temporarilyRateLimited = false;
    let credentialMissing = false;
    void request.then((image) => {
      if (controller.signal.aborted || view.tutorConversationPictureController !== controller ||
          view.tutorState.conversation.status !== 'active' || view.tutorConversationPictureEpoch !== epoch ||
          view.tutorState.conversation.situationPicture === 'none') return;
      // 2026-10-02: Host render state contains only pictures acknowledged as decoded.
      view.tutorConversationPicturePending = { requestId, image, turn: next ? committedTurn : -1 };
      void view.view?.webview.postMessage({ command: 'tutorConversationPictureReady', image, requestId,
        ...(replaceCharacter ? { replaceCharacter: true } : {}),
        images: [...view.tutorConversationPictures, image],
        turns: [...view.tutorConversationPictureTurns, next ? committedTurn : -1], mode: view.tutorState.conversation.situationPicture });
    }).catch((error: unknown) => {
      if ((!controller.signal.aborted || timedOut) && view.tutorConversationPictureController === controller &&
          view.tutorState.conversation.status === 'active' && view.tutorConversationPictureEpoch === epoch) {
        if (missingCredentialsOf(error)) {
          credentialMissing = true;
          pauseTutorPictures(view, 'missing', cloudflare, error);
          return;
        }
        // 2026-10-12: a temporary Cloudflare 429 neither consumes the conversation's
        // picture failure budget nor triggers an immediate retry of the same request.
        temporarilyRateLimited = cloudflare && error instanceof CloudflareAiError && error.status === 429 && !error.allowance;
        if (!temporarilyRateLimited) view.tutorConversationPictureFailures += 1;
        const quota429 = /\b429\b/iu.test(error instanceof Error ? error.message : '') ||
          (typeof error === 'object' && error !== null && 'status' in error && error.status === 429);
        const quota = cloudflare ? error instanceof CloudflareAiError && error.allowance
          : quota429 || /RESOURCE_EXHAUSTED/iu.test(error instanceof Error ? error.message : '');
        const detail = cloudflare ? undefined : /\s(\{"[^}]*\})$/u.exec(error instanceof Error ? error.message : '')?.[1];
        let paidKey = false;
        if (quota429 && detail) {
          try {
            const metadata = JSON.parse(detail) as { limit?: unknown };
            paidKey = metadata.limit === '0';
          } catch { /* An unrecognized error detail keeps the ordinary quota notice. */ }
        }
        const cloudflareDetail = cloudflare && error instanceof CloudflareAiError ? ` ${error.message}` : '';
        view.actions.log(`[conversation situation picture failed] ${quota ? (cloudflare ? 'Cloudflare allowance exhausted.' : 'Gemini quota exhausted.') : 'No usable picture.'}${detail ? ` ${detail}` : ''}${cloudflareDetail}`);
        if (!replaceCharacter && view.tutorConversationPictureFailures >= 2) {
          const authentication = cloudflare && error instanceof CloudflareAiError && error.authentication;
          pauseTutorPictures(view, paidKey ? 'paidKey' : quota ? 'quota' : authentication ? 'authentication' : timedOut ? 'timeout' : 'other', cloudflare);
          view.actions.log('[conversation situation picture stopped] Two consecutive failures.');
        }
      }
    }).finally(() => {
      clearDeadline();
      controller.signal.removeEventListener('abort', clearDeadline);
      if (view.tutorConversationPictureController === controller) {
        view.tutorConversationPictureController = undefined;
        if (!view.tutorConversationPicturePending) {
          void view.view?.webview.postMessage({ command: 'tutorConversationPictureRequestFinished' });
        }
        // Credential presence can be stale, so a missing-key response waits for a later action or update.
        if (!replaceCharacter && !temporarilyRateLimited && !credentialMissing) ensureTutorConversationPicture(view);
      }
    });
  }

/** Only dialogue is eligible as picture reference. Coaching and panel settings stay local. */
export function situationPictureTurns(conversation: import('./tutor/state.js').TutorConversationState) {
  if (conversation.demoMode) return conversation.demoLines.slice(-6).map((line) => ({
    speaker: 'tutor' as const, text: `${conversation.demoCast?.[line.speaker].name ?? line.speaker}: ${line.text}`
  }));
  const turns: Array<{ speaker: 'learner' | 'tutor'; text: string }> = [];
  const tutor = (text: string | undefined) => {
    if (text?.trim()) {
      turns.push({ speaker: 'tutor', text });
    }
  };
  for (const [index, turn] of conversation.transcript.entries()) {
    if (!tutorConversationQuestionRepeatsReply(turn.question, conversation.transcript[index - 1])) tutor(turn.question);
    if (!turn.skipped && turn.learnerAnswer.trim()) turns.push({ speaker: 'learner', text: turn.learnerAnswer });
    tutor(tutorConversationVisibleReply(turn));
  }
  if (!tutorConversationQuestionRepeatsReply(conversation.currentQuestion, conversation.transcript.at(-1))) {
    tutor(conversation.currentQuestion);
  }
  return turns.slice(-6);
}


export function failTutorConversationOpening(view: KrenResultsViewProvider, error: unknown, controller: AbortController): void {
    if (controller.signal.aborted || view.tutorConversationController !== controller ||
        view.tutorState.conversation.status !== 'active') return;
    cancelTutorConversationPicture(view);
    const current = view.tutorState.conversation;
    view.tutorState = { ...view.tutorState, conversation: {
      ...current, currentQuestion: '', busy: false,
      failure: tutorConversationFailureMessage(view, error, true)
    } };
    view.showMissingCredentialError(error, true);
    view.render();
  }


  /**
   * Opens one Live session with its audio player, for the opening and for Back to chat. The
   * caller's `isCurrent` says whether the conversation that asked for it is still the one on
   * screen; audio for a conversation that has moved on is closed, not played.
   */
export async function openTutorLiveSession(view: KrenResultsViewProvider,
    systemInstruction: string,
    signal: AbortSignal,
    isCurrent: () => boolean
  ): Promise<TutorLiveSession> {
    const credential = await view.actions.generateTutor(
      tutorLiveSessionCredentialRequest(), tutorLanguageModelRoute(view), signal
    );
    const apiKey = tutorLiveSessionCredential(credential);
    if (!isCurrent()) throw new TutorLiveSessionError('socketClosed');
    const pressToTalk = view.tutorLivePressToTalk;
    const audioGeneration = ++view.tutorLiveAudioGeneration;
    let session!: TutorLiveSession;
    view.tutorLiveOpeningAudioReady = view.waveOutPlayer.start(
      (error) => failTutorLiveAudio(view, error, audioGeneration),
      (completedBuffers, queuedBuffers) =>
        tutorLivePlaybackProgress(view, completedBuffers, queuedBuffers, audioGeneration)
    ).then(
      (player) => {
        // The player belongs to this Live session. Back to chat clears the short-lived
        // reopen controller as soon as the socket is ready, which can happen before the
        // PowerShell helper starts. The session and generation outlive that controller.
        if (view.tutorLiveSession !== session || view.tutorState.conversation.status !== 'active' ||
            audioGeneration !== view.tutorLiveAudioGeneration) {
          player.close();
          return;
        }
        view.tutorLiveAudioPlayer = player;
        view.tutorLiveReplayOwnsAudioPlayer = false;
        if (view.tutorState.conversation.speakerOn) {
          try {
            for (const chunk of view.tutorLiveReplyAudio) playTutorLiveAudio(view, chunk);
          } catch (error) {
            failTutorLiveAudio(view, error, audioGeneration);
          }
        }
        postTutorLiveSpeakerState(view);
      },
      (error: unknown) => {
        if (view.tutorLiveSession !== session || view.tutorState.conversation.status !== 'active' ||
            audioGeneration !== view.tutorLiveAudioGeneration) return;
        logTutorLiveAudioError(view, error);
      }
    );
    let replyRequested = false;
    let lateReplyText = false;
    let inputAcceptedLate = false;
    session = new TutorLiveSession({
      geminiProfile: view.actions.settings().tutorLiveProfile ?? 'standard',
      handoffEnabled: view.tutorState.conversation.from !== 'speakAndRephrase',
      apiKey,
      model: configuredTutorLiveModel(),
      voiceName: normalizedTutorLiveVoice(view.tutorState.conversation.liveVoice),
      pressToTalk,
      microphoneSensitivity: view.tutorLiveMicrophoneSensitivity,
      speechDetection: view.tutorLiveSpeechDetection,
      pauseBeforeReply: view.tutorLivePauseBeforeReply,
      holdInputReply: true,
      isInputEnglish: () => !!view.tutorLiveInputText.trim() &&
        !tutorLearnerTurnNotShown(configuredTutorLiveTranscriptionLanguage() === 'english'
          ? tutorLearnerTurnText(view.tutorLiveInputText) : view.tutorLiveInputText),
      transcriptionLanguage: configuredTutorLiveTranscriptionLanguage(),
      systemInstruction,
      socketFactory: view.tutorLiveSocketFactory,
      requestApiKey: async (reconnectSignal) => {
        cancelTutorConversationPicture(view);
        ensureTutorConversationPicture(view);
        try {
          return tutorLiveSessionCredential(
            await view.actions.generateTutor(
              tutorLiveSessionCredentialRequest(), tutorLanguageModelRoute(view), reconnectSignal
            )
          );
        } finally {
          ensureTutorConversationPicture(view);
        }
      },
      onReconnected: () => {
        if (view.tutorLiveSession === session) ensureTutorConversationPicture(view);
      },
      // Only the current session may reach the panel; an old one is ignored even if it
      // still delivers something after being replaced.
      onText: (text) => {
        if (view.tutorLiveSession === session && (replyRequested || lateReplyText)) appendTutorLiveReply(view, text);
      },
      onAudio: (chunk) => {
        if (view.tutorLiveSession === session && replyRequested) postTutorLiveAudio(view, chunk);
      },
      onInputText: (text) => {
        lateReplyText = false;
        if (view.tutorLiveSession === session && !inputAcceptedLate) appendTutorLiveInput(view, text);
      },
      onReplyPending: () => {
        if (view.tutorLiveSession !== session || !view.tutorLiveInputText.trim()) return;
        cancelTutorConversationReplayAll(view);
        rememberTutorLiveQuestionAudio(view, view.tutorState.conversation.transcript.length);
        beginTutorLiveReply(view);
        view.tutorLiveInputReplyPending = true;
        view.tutorState = { ...view.tutorState, conversation: { ...view.tutorState.conversation, busy: true } };
        postTutorConversationStopState(view);
      },
      onReplyStart: (classificationLate) => {
        if (view.tutorLiveSession !== session) return;
        // 2026-10-13: A late output transcript is still part of the completed reply.
        // It has no new learner input or text request, so do not reset its accumulator.
        const conversation = view.tutorState.conversation;
        lateReplyText = view.tutorLiveReplyAudioComplete && !view.tutorLiveOpeningNarration &&
          conversation.status === 'active' &&
          (conversation.pendingAnswer !== undefined || conversation.transcript.at(-1)?.reply === view.tutorLiveReplyText.trim()) &&
          view.tutorLiveInputLatency.firstMicrophoneForwardedAt === undefined &&
          !session.hasPendingTextTurn() && !view.tutorLiveInputText.trim() && !view.tutorLiveSpokenTurn;
        if (lateReplyText) return;
        if (classificationLate && !view.tutorLiveInputText.trim() && view.tutorLiveMicrophone) {
          // 2026-10-02: The fallback is final for this exchange. A late transcript cannot
          // hide a learner turn after its already accepted reply has started playing.
          inputAcceptedLate = true;
          beginTutorLiveReply(view);
          view.tutorLiveInputReplyPending = true;
          view.tutorState = { ...view.tutorState, conversation: { ...view.tutorState.conversation, busy: true } };
        }
        const awaitingFinalInput = beginTutorLiveSpokenReply(view) === true;
        // A noise-only activity can make Live answer without a learner turn. Only a
        // pending KREN text turn or transcribed spoken turn may reach the panel or speaker.
        replyRequested = awaitingFinalInput || session.hasPendingTextTurn() ||
          (classificationLate === true && view.tutorLiveInputReplyPending && !view.tutorLiveInputText.trim()) ||
          (view.tutorLiveSpokenTurn !== undefined && !view.tutorLiveSpokenTurn.learnerNotShown);
        // One line when a reply is held back, so a reader who spoke and heard nothing can see
        // why in the output channel rather than taking the silence for a freeze.
        if (!replyRequested) {
          view.actions.log('[conversation Live] Held back a reply that no learner turn asked for.');
        }
      },
      onTurnComplete: () => {
        if (view.tutorLiveSession === session) {
          if (lateReplyText) { lateReplyText = false; return; }
          inputAcceptedLate = false;
          // Turn completion is the final boundary even when transcription follows the first audio.
          const missingInput = !view.tutorLiveInputText.trim();
          const ignoredShortInput = view.tutorLiveInputReplyPending &&
            (beginTutorLiveSpokenReply(view, true) === true || missingInput);
          if (ignoredShortInput) {
            session.takeHandoff();
            view.tutorLiveInputReplyPending = false;
            view.tutorLiveInputText = '';
            view.tutorLiveInputFirstFragment = true;
          }
          replyRequested = false;
          const timing = view.tutorLiveReplyTiming;
          timing?.replyAudioComplete();
          if (view.tutorLiveReplyTiming === timing) view.tutorLiveReplyTiming = undefined;
          if (ignoredShortInput) {
            view.tutorLiveReplyAudioComplete = true;
            view.tutorState = { ...view.tutorState, conversation: {
              ...view.tutorState.conversation, busy: false,
              currentQuestionTargetMarks: tutorLiveTargetMarks(view.tutorLiveReplyText.trim(), 'reply', view.tutorState.conversation.lessonContext),
              currentQuestion: view.tutorLiveReplyText.trim() || view.tutorState.conversation.currentQuestion,
              unansweredReplies: view.tutorLiveReplyText.trim() ? [
                ...(view.tutorState.conversation.unansweredReplies ?? []),
                { beforeTurn: view.tutorState.conversation.transcript.length, text: view.tutorLiveReplyText.trim() }
              ] : view.tutorState.conversation.unansweredReplies
            } };
            postTutorConversationStopState(view);
            if (view.view) void view.view.webview.postMessage({
              command: 'tutorLiveIgnoredTurnComplete', talkAvailable: true,
              listening: view.tutorLiveMicrophone !== undefined,
              replayAvailable: tutorLiveReplayAvailable(view), pressToTalk: view.tutorLivePressToTalk
            });
          } else finishTutorLiveSpokenTurn(view);
        }
      },
      onInterrupted: () => {
        if (view.tutorLiveSession === session) {
          inputAcceptedLate = false;
          replyRequested = false;
          interruptTutorLiveReply(view);
        }
      },
      onEnded: (error) => {
        if (view.tutorLiveSession === session) disableTutorLive(view, error, 'session ended');
      }
    });
    view.tutorLiveSession = session;
    view.tutorLivePressToTalk = pressToTalk;
    view.tutorLiveAudioLogged = false;
    view.tutorLiveSessionChoices = {
      register: view.tutorState.conversation.register,
      teaching: view.tutorState.conversation.coaching === 'teaching'
    };
    await session.connect();
    ensureTutorConversationPicture(view);
    return session;
  }


export function startNewTutorConversation(view: KrenResultsViewProvider): void {
    if (view.tutorState.conversation.status !== 'stopped') return;
    cancelTutorConversationReplayAll(view);
    view.tutorLiveConversationAudio.clear();
    view.tutorConversationRawAnswers.clear();
    resetStoppedTutorConversation(view);
  }


  /** Returns whether the stopped state was a Demo, which lets Start now continue immediately. */
export function resetStoppedTutorConversation(view: KrenResultsViewProvider): boolean {
    cancelTutorTakeHome(view);
    const stopped = view.tutorState.conversation;
    const wasDemo = stopped.demoMode;
    closeTutorDemoResources(view);
    closeTutorLiveMicrophone(view);
    closeTutorLiveSession(view);
    invalidateTutorConversationReport(view);
    view.tutorLiveOpeningContext = undefined;
    cancelTutorConversationPicture(view);
    view.tutorConversationPictureLastTriggeredTurn = -1;
    view.tutorConversationScene = undefined;
    view.tutorConversationPictureController?.abort();
    view.tutorConversationPictureController = undefined;
    view.tutorConversationPicture = undefined;
    view.tutorConversationPictures = [];
    view.tutorConversationPictureTurns = [];
    view.tutorConversationPictureCount = 0;
    view.tutorConversationPictureAccepted.clear();
    view.tutorConversationPictureFailures = 0;
    view.tutorConversationPictureStopped = false;
    view.tutorState.conversation.picturePaused = undefined;
    view.tutorState = { ...view.tutorState, conversation: {
      ...stopped, lessonContext: undefined, resolvedSituationId: undefined, currentQuestionTargetMarks: undefined,
      coachOpen: false,
      hint: undefined,
      hintBusy: false,
      hintFailure: undefined,
      failure: undefined,
      openModeAfterRender: true,
      status: 'idle',
      demoMode: false,
      demoCast: undefined,
      demoLines: [],
      demoEndedAtCap: undefined,
      recipeTargets: { supportingTargets: [] },
      transcript: [],
      unansweredReplies: undefined,
      currentTurnIndex: 0,
      currentQuestion: '',
      draftAnswer: '',
      draftAnswerSpoken: false,
      pendingAnswer: undefined,
      busy: false
    } };
    view.render();
    view.tutorState = { ...view.tutorState, conversation: {
      ...view.tutorState.conversation, openModeAfterRender: undefined
    } };
    return wasDemo;
  }
