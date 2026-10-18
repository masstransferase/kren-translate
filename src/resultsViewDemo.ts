import { tutorConversationRequestControls } from './tutor/generation.js';
import { cancelTutorTakeHome, finalizeTutorTakeHome } from './resultsViewTakeHome.js';
import { TUTOR_DEFAULTS } from './tutor/defaults.js';
import { tutorDemoAvailable } from './tutor/demoAvailability.js';
import { showTutorLessonUnavailable } from './resultsViewSettings.js';
import { createTutorReadOnlySession } from './tutor/readOnlySpeech.js';
import { tutorLessonConversationReadiness, tutorLessonConversationContext, resolveTutorConversationSituation, tutorLiveTargetMarks, tutorTargetRanges } from './tutor/lessonConversation.js';
import { cancelTutorConversationPicture, ensureTutorConversationPicture, showTutorConversationScene } from './resultsViewConversation.js';
import { generateTutorConversation } from './resultsViewConversation.js';
import { tutorLanguageModelRoute } from './resultsViewConversation.js';
import { stopTutorLiveAudio, failTutorLiveAudio, playTutorLiveAudio } from './resultsViewLive.js';
import { tutorFailureMessage } from './resultsViewErrors.js';
import type { KrenResultsViewProvider } from './resultsView.js';
import { findTutorSituation, tutorCustomSituation, findTrainingMapNode } from '@kren/core/tutor';
import type { TutorRecipe } from '@kren/core/tutor';
import {
  tutorConversationDemoBatch,
  tutorConversationDemoBatchRequest,
  tutorConversationDemoCast,
  tutorConversationDemoCastRequest,
  tutorConversationSceneSlant,
  TUTOR_CONVERSATION_ENGLISH_ONLY_INSTRUCTION,
  TUTOR_DEMO_BATCH_EXCHANGES,
  TUTOR_DEMO_MAX_EXCHANGES,
  tutorLiveSessionCredential,
  tutorLiveSessionCredentialRequest,
  type TutorConversationDemoCastRequestBody
} from './tutor/generation.js';
import {
  normalizedTutorLiveVoice,
  tutorRecipeFromState,
  type TutorConversationDemoCast,
  type TutorConversationDemoLine,
  type TutorConversationDemoSpeaker
} from './tutor/state.js';
import { TutorLiveSession } from './tutor/liveSession.js';
import { configuredTutorLiveModel } from './resultsViewConfiguration.js';
import { cancelTutorConversationReplayAll, closeTutorReplayAudioPlayer, readTutorConversationText } from './resultsViewReplay.js';

export const TUTOR_DEMO_EXCHANGE_GAP_MS = 1_000;

export function tutorDemoEdgeVoice(view: KrenResultsViewProvider, speaker: TutorConversationDemoSpeaker): string {
    const settings = view.actions.settings();
    return speaker === 'female'
      ? settings.tutorEdgeReadAloudFemaleVoice ?? 'en-US-AvaNeural'
      : settings.tutorEdgeReadAloudMaleVoice ?? 'en-US-ChristopherNeural';
  }

export function tutorDemoLiveVoice(view: KrenResultsViewProvider, speaker: TutorConversationDemoSpeaker): string {
    const settings = view.actions.settings();
    return normalizedTutorLiveVoice(speaker === 'female'
      ? settings.tutorLiveFemaleVoice ?? TUTOR_DEFAULTS.configuration['tutor.liveFemaleVoice']
      : settings.tutorLiveMaleVoice ?? TUTOR_DEFAULTS.configuration['tutor.liveMaleVoice']);
  }

export function closeTutorDemoResources(view: KrenResultsViewProvider, stopSpeech = true): void {
    view.tutorDemoGeneration += 1;
    view.tutorDemoController?.abort();
    view.tutorDemoController = undefined;
    for (const session of Object.values(view.tutorDemoLiveSessions)) session?.close();
    view.tutorDemoLiveSessions = {};
    stopTutorLiveAudio(view);
    closeTutorReplayAudioPlayer(view);
    if (stopSpeech) view.actions.stopReadAloud();
  }

export async function waitForTutorDemoAudio(view: KrenResultsViewProvider, generation: number): Promise<boolean> {
    while (generation === view.tutorDemoGeneration &&
        Date.now() < view.tutorLivePlaybackQueuedUntil) {
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(
        50, Math.max(1, Math.ceil(view.tutorLivePlaybackQueuedUntil - Date.now()))
      )));
    }
    return generation === view.tutorDemoGeneration;
  }

export async function waitForTutorDemoExchange(view: KrenResultsViewProvider,
    generation: number, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted || generation !== view.tutorDemoGeneration) return false;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, TUTOR_DEMO_EXCHANGE_GAP_MS);
      signal.addEventListener('abort', finish, { once: true });
    });
    return !signal.aborted && generation === view.tutorDemoGeneration;
  }

export async function openTutorDemoLiveSessions(view: KrenResultsViewProvider,
    generation: number,
    controller: AbortController
  ): Promise<void> {
    if (view.actions.settings().tutorReadAloudProvider === 'googleChirp') return;
    const credential = await view.actions.generateTutor(
      tutorLiveSessionCredentialRequest(), tutorLanguageModelRoute(view), controller.signal
    );
    if (controller.signal.aborted || generation !== view.tutorDemoGeneration) return;
    const apiKey = tutorLiveSessionCredential(credential);
    if (!view.tutorLiveAudioPlayer) {
      const audioGeneration = ++view.tutorLiveAudioGeneration;
      const player = await view.waveOutPlayer.start((error) => {
        failTutorLiveAudio(view, error, audioGeneration);
      });
      if (controller.signal.aborted || generation !== view.tutorDemoGeneration) {
        player.close();
        return;
      }
      view.tutorLiveAudioPlayer = player;
      view.tutorLiveReplayOwnsAudioPlayer = true;
    }
    const sessions = Object.fromEntries((['male', 'female'] as const).map((speaker) => {
      const session = createTutorReadOnlySession({
        apiKey,
        model: configuredTutorLiveModel(),
        voiceName: tutorDemoLiveVoice(view, speaker),
        socketFactory: view.tutorLiveSocketFactory,
        onAudio: (chunk) => {
          if (!controller.signal.aborted && generation === view.tutorDemoGeneration) {
            playTutorLiveAudio(view, chunk);
          }
        }
      });
      return [speaker, session];
    })) as Record<TutorConversationDemoSpeaker, TutorLiveSession>;
    view.tutorDemoLiveSessions = sessions;
    await Promise.all([sessions.male.connect(), sessions.female.connect()]);
  }

export async function speakTutorDemoText(view: KrenResultsViewProvider,
    text: string,
    speaker: TutorConversationDemoSpeaker | undefined,
    generation: number
  ): Promise<boolean> {
    if (generation !== view.tutorDemoGeneration) return false;
    if (view.tutorState.conversation.replies === 'liveGemini' && view.actions.settings().tutorReadAloudProvider !== 'googleChirp') {
      const chosen = speaker ?? view.tutorDemoCounterpartGender;
      const session = view.tutorDemoLiveSessions[chosen];
      if (!session) return false;
      stopTutorLiveAudio(view);
      await session.sendTurn(`Read exactly this sentence: ${JSON.stringify(text)}`);
      return waitForTutorDemoAudio(view, generation);
    }
    await readTutorConversationText(view, text, view.actions.settings().tutorReadAloudProvider === 'googleChirp'
      ? tutorDemoLiveVoice(view, speaker ?? view.tutorDemoCounterpartGender)
      : speaker && view.actions.settings().tutorReadAloudProvider === 'edgeOnline' ? tutorDemoEdgeVoice(view, speaker) : undefined);
    return generation === view.tutorDemoGeneration;
  }

export function tutorDemoCastRequest(view: KrenResultsViewProvider): TutorConversationDemoCastRequestBody | undefined {
    const conversation = view.tutorState.conversation;
    let recipe: TutorRecipe | undefined;
    try {
      if (conversation.from === 'lesson') {
        if (!tutorLessonConversationReadiness(view.tutorState).ready) return undefined;
        recipe = view.tutorState.lesson!.recipe;
      }
    } catch {
      return undefined;
    }
    view.tutorState = { ...view.tutorState, conversation: { ...conversation, resolvedSituationId: resolveTutorConversationSituation(conversation.situationId) } };
    const counterpartGender: TutorConversationDemoSpeaker = Math.random() < 0.5 ? 'female' : 'male';
    view.tutorDemoCounterpartGender = counterpartGender;
    const readerSideGender: TutorConversationDemoSpeaker = counterpartGender === 'female' ? 'male' : 'female';
    const resolvedSituationId = view.tutorState.conversation.resolvedSituationId!;
    const situation = resolvedSituationId === 'custom' ? tutorCustomSituation(conversation.customSituation) : findTutorSituation(resolvedSituationId);
    const common = {
      ...tutorConversationRequestControls(conversation),
      register: conversation.register,
      sceneSlant: tutorConversationSceneSlant(),
      counterpartGender,
      readerSideGender
    } as const;
    if (conversation.from === 'situation') {
      return situation ? { ...common, kind: 'situation', setting: situation.setting } : undefined;
    }
    if (conversation.from === 'lesson') {
      const primaryTargetLabel = recipe?.primaryTargets?.[0] === undefined
        ? undefined : findTrainingMapNode(recipe.primaryTargets[0])?.label;
      if (!situation) return undefined;
      return {
        ...common,
        kind: 'lesson',
        primaryTargetLabel: primaryTargetLabel ?? view.tutorState.lesson!.lesson.lessonTitle,
        setting: situation.setting, rolesSwapped: conversation.rolesSwapped,
        lessonContext: tutorLessonConversationContext(view.tutorState),
        supportingTargetLabels: (recipe?.supportingTargets ?? []).flatMap((targetId) => {
          const label = findTrainingMapNode(targetId)?.label;
          return label ? [label] : [];
        })
      };
    }
    return { ...common, kind: 'anything' };
  }

export function postTutorDemoLine(view: KrenResultsViewProvider, line: TutorConversationDemoLine, cast: TutorConversationDemoCast): void {
    const conversation = view.tutorState.conversation;
    view.tutorState = { ...view.tutorState, conversation: {
      ...conversation, demoLines: [...conversation.demoLines, line]
    } };
    view.tutorConversationPictureEligibleTurn = view.tutorState.conversation.demoLines.length - 1;
    view.tutorConversationPictureContinuationTurn = view.tutorConversationPictureEligibleTurn;
    ensureTutorConversationPicture(view);
    if (view.view) void view.view.webview.postMessage({
      command: 'tutorConversationDemoLine',
      targetRanges: tutorTargetRanges(line.text, 'reply', tutorLiveTargetMarks(line.text, 'reply', conversation.lessonContext)),
      speaker: line.speaker,
      name: cast[line.speaker].name,
      text: line.text
    });
  }

export async function requestTutorDemoBatch(view: KrenResultsViewProvider,
    cast: TutorConversationDemoCast,
    transcript: TutorConversationDemoLine[],
    exchanges: number,
    controller: AbortController
  ): Promise<TutorConversationDemoLine[]> {
    const value = await generateTutorConversation(view, tutorConversationDemoBatchRequest({
      ...tutorConversationRequestControls(view.tutorState.conversation),
      lessonContext: view.tutorState.conversation.lessonContext,
      scene: cast.scene,
      male: cast.male,
      female: cast.female,
      register: view.tutorState.conversation.register,
      transcript,
      exchanges
    }), controller.signal, undefined, undefined, value => {
      tutorConversationDemoBatch(value, exchanges);
      return { type: 'accepted', value };
    });
    return tutorConversationDemoBatch(value, exchanges);
  }

export function startTutorConversationDemo(view: KrenResultsViewProvider): void {
    const setup = view.tutorState.conversation;
    if (setup.status !== 'idle') return;
    if (setup.from === 'lesson' && !tutorLessonConversationReadiness(view.tutorState).ready) {
      void showTutorLessonUnavailable(view); return;
    }
    if (!setup.speakerOn) return;
    cancelTutorTakeHome(view);
    if (!tutorDemoAvailable(setup.replies, view.actions.settings())) return;
    const castInput = tutorDemoCastRequest(view);
    if (!castInput) return;
    cancelTutorConversationReplayAll(view);
    closeTutorDemoResources(view, false);
    const generation = view.tutorDemoGeneration;
    const controller = new AbortController();
    view.tutorDemoController = controller;
    cancelTutorConversationPicture(view);
    view.tutorConversationPicture = undefined;
    view.tutorConversationPictures = [];
    view.tutorConversationPictureTurns = [];
    view.tutorConversationPictureCount = 0;
    view.tutorConversationPictureFailures = 0;
    view.tutorConversationPictureStopped = false;
    view.tutorState.conversation.picturePaused = undefined;
    view.tutorConversationPictureAccepted.clear();
    view.tutorConversationPictureLastTriggeredTurn = -1;
    view.tutorConversationScene = undefined;
    view.tutorSpeechConversation = {};
    view.tutorState = { ...view.tutorState, conversation: {
      ...view.tutorState.conversation,
      lessonContext: castInput.lessonContext,
      status: 'active', busy: true, demoMode: true, demoCast: undefined, picturePaused: undefined,
      tutorRole: undefined, learnerRole: undefined, openingReveal: undefined,
      demoLines: [], demoEndedAtCap: undefined, transcript: [], currentQuestion: '',
      draftAnswer: '', pendingAnswer: undefined, failure: undefined
    } };
    view.pendingTutorConversationFocus = true;
    view.render();
    void (async () => {
      try {
        const castValue = await generateTutorConversation(view,
          tutorConversationDemoCastRequest(castInput), controller.signal, undefined, undefined, value => {
            tutorConversationDemoCast(value);
            return { type: 'accepted', value };
          }
        );
        if (controller.signal.aborted || generation !== view.tutorDemoGeneration) return;
        const cast = tutorConversationDemoCast(castValue);
        view.tutorConversationScene = cast.scene;
        view.tutorState = { ...view.tutorState, conversation: {
          ...view.tutorState.conversation, busy: false, demoCast: cast,
          tutorRole: cast[castInput.counterpartGender].role, learnerRole: cast[castInput.readerSideGender].role
        } };
        showTutorConversationScene(view, cast.scene);
        if (setup.replies === 'liveGemini') {
          await openTutorDemoLiveSessions(view, generation, controller);
          if (controller.signal.aborted || generation !== view.tutorDemoGeneration) return;
        }
        let transcript: TutorConversationDemoLine[] = [];
        let exchanges = Math.min(TUTOR_DEMO_BATCH_EXCHANGES, TUTOR_DEMO_MAX_EXCHANGES);
        let pendingBatch = requestTutorDemoBatch(view, cast, transcript, exchanges, controller);
        void pendingBatch.catch(() => undefined);
        if (!await speakTutorDemoText(view, cast.scene, undefined, generation)) return;
        while (!controller.signal.aborted && generation === view.tutorDemoGeneration) {
          const lines = await pendingBatch;
          if (controller.signal.aborted || generation !== view.tutorDemoGeneration) return;
          const continuedTranscript = [...transcript, ...lines];
          const completedExchanges = continuedTranscript.length / 2;
          const remaining = TUTOR_DEMO_MAX_EXCHANGES - completedExchanges;
          const nextExchanges = Math.min(TUTOR_DEMO_BATCH_EXCHANGES, remaining);
          const nextBatch = nextExchanges > 0
            ? requestTutorDemoBatch(view, cast, continuedTranscript, nextExchanges, controller)
            : undefined;
          if (nextBatch) void nextBatch.catch(() => undefined);
          for (const line of lines) {
            if (controller.signal.aborted || generation !== view.tutorDemoGeneration) return;
            if (!await waitForTutorDemoExchange(view, generation, controller.signal)) return;
            postTutorDemoLine(view, line, cast);
            if (!await speakTutorDemoText(view, line.text, line.speaker, generation)) return;
          }
          transcript = continuedTranscript;
          if (!nextBatch) break;
          pendingBatch = nextBatch;
          exchanges = nextExchanges;
        }
        if (controller.signal.aborted || generation !== view.tutorDemoGeneration) return;
        cancelTutorConversationPicture(view);
        closeTutorDemoResources(view, false);
        view.tutorState = { ...view.tutorState, conversation: {
          ...view.tutorState.conversation,
          status: 'stopped', busy: false, demoEndedAtCap: true
        } };
        view.render();
        finalizeTutorTakeHome(view);
      } catch (error) {
        if (controller.signal.aborted || generation !== view.tutorDemoGeneration) return;
        view.actions.log(`[conversation demo failed] ${tutorFailureMessage(error)}`);
        cancelTutorConversationPicture(view);
        closeTutorDemoResources(view, false);
        view.tutorState = { ...view.tutorState, conversation: {
          ...view.tutorState.conversation,
          status: 'stopped', busy: false,
          failure: 'The example conversation stopped because KREN could not continue it.'
        } };
        view.render();
        finalizeTutorTakeHome(view);
      }
    })();
  }
