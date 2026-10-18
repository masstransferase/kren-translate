import { submitTutorConversationTurn } from './resultsViewTurns.js';
import type { TutorDictationTarget } from './resultsView.js';
import { StandardConversationTurnTiming } from './tutor/conversationTiming.js';
import { resolveTutorSpeechRoute, tutorExerciseById } from './tutor/state.js';
import { configuredTutorSpeechProvider } from './resultsViewConfiguration.js';
import { toggleTutorLiveMicrophone } from './resultsViewLive.js';
import { postTutorConversationStopState } from './resultsViewStop.js';
import { safePanelErrorMessage } from './resultsViewErrors.js';
import type { KrenResultsViewProvider } from './resultsView.js';
import { CloudflareAiError } from './providers/cloudflare.js';

export async function refreshTutorSpeechAvailability(view: KrenResultsViewProvider): Promise<void> {
    const detection = ++view.handyDetection;
    if (view.tutorState.speech.handyStatus !== 'checking') {
      view.tutorState = {
        ...view.tutorState,
        speech: { ...view.tutorState.speech, handyStatus: 'checking' }
      };
      view.render();
    }
    let executable: string | undefined;
    try {
      executable = await view.handy.detect();
    } catch (error: unknown) {
      view.actions.log(`[Handy detection failed] ${safePanelErrorMessage(error)}`);
    }
    if (detection !== view.handyDetection) return;
    view.handyExecutable = executable;
    view.tutorState = {
      ...view.tutorState,
      speech: {
        ...view.tutorState.speech,
        handyStatus: executable ? 'available' : 'notFound'
      }
    };
    view.render();
  }

/** Only capture paths with a complete late-start cleanup guard may bypass the panel queue. */
export function tutorDictationHasCancellationGuard(view: KrenResultsViewProvider,
    command: 'dictateTutorExercise' | 'dictateTutorConversation'
  ): boolean {
    const conversationTarget = command === 'dictateTutorConversation';
    if (conversationTarget && view.tutorState.conversation.status === 'active' &&
        view.tutorState.conversation.replies === 'liveGemini' && view.tutorLiveSession &&
        !view.tutorLiveFailed) return true;
    if (view.geminiRecording || view.geminiDictationStart ||
        (view.tutorState.speech.dictationProvider === 'gemini' || view.tutorState.speech.dictationProvider === 'cloudflare' || view.tutorState.speech.dictationProvider === 'groq')) return true;
    if (view.tutorState.speech.dictationProvider === 'handy') return false;
    const settings = view.actions.settings();
    const route = resolveTutorSpeechRoute(
      configuredTutorSpeechProvider(),
      view.tutorState.speech.handyStatus,
      Boolean(settings.credentialPresence?.geminiDefault),
      Boolean(settings.credentialPresence?.cloudflareAccountId && settings.credentialPresence?.cloudflareApiToken),
      Boolean(settings.credentialPresence?.groq)
    );
    return route.provider === 'gemini' || route.provider === 'cloudflare' || route.provider === 'groq';
  }

export async function toggleTutorDictation(view: KrenResultsViewProvider, target: TutorDictationTarget): Promise<void> {
    const conversationTarget = 'conversation' in target;
    const exerciseId = 'exerciseId' in target ? target.exerciseId : undefined;
    if (exerciseId && view.tutorState.practiceReviewBatch) return;
    if (conversationTarget && view.tutorState.conversation.replies === 'liveGemini' &&
        view.tutorLiveSession && !view.tutorLiveFailed) {
      await toggleTutorLiveMicrophone(view);
      return;
    }
    if (conversationTarget
      ? view.tutorState.conversation.status !== 'active' || view.tutorState.conversation.busy || view.tutorState.conversation.openingReveal
      : !exerciseId || !tutorExerciseById(view.tutorState, exerciseId)) return;
    if (view.tutorState.speech.transcribingExerciseId ||
        view.tutorState.speech.transcribingConversation) return;
    if ((view.tutorState.speech.dictationProvider === 'gemini' || view.tutorState.speech.dictationProvider === 'cloudflare' || view.tutorState.speech.dictationProvider === 'groq') && view.geminiRecording) {
      const activeTarget: TutorDictationTarget = view.tutorState.speech.dictatingConversation
        ? { conversation: true }
        : { exerciseId: view.tutorState.speech.dictatingExerciseId ?? exerciseId ?? '' };
      if ('exerciseId' in activeTarget && !activeTarget.exerciseId) return;
      await stopGeminiDictation(view, activeTarget);
      return;
    }
    const settings = view.actions.settings();
    const activeProvider = view.tutorState.speech.dictationProvider;
    const route = activeProvider
      ? { provider: activeProvider, reason: undefined }
      : resolveTutorSpeechRoute(
          configuredTutorSpeechProvider(),
          view.tutorState.speech.handyStatus,
          Boolean(settings.credentialPresence?.geminiDefault),
          Boolean(settings.credentialPresence?.cloudflareAccountId && settings.credentialPresence?.cloudflareApiToken),
      Boolean(settings.credentialPresence?.groq)
        );
    if (!route.provider) {
      view.actions.notify('error', `KREN: ${route.reason ?? 'Speech input is unavailable.'}`);
      return;
    }
    if (route.provider === 'gemini' || route.provider === 'cloudflare' || route.provider === 'groq') {
      await startGeminiDictation(view, target, route.provider);
      return;
    }
    const executable = view.handyExecutable;
    if (!executable || view.tutorState.speech.handyStatus !== 'available') return;
    const activeTarget: TutorDictationTarget | undefined =
      view.tutorState.speech.dictatingConversation
        ? { conversation: true }
        : view.tutorState.speech.dictatingExerciseId
          ? { exerciseId: view.tutorState.speech.dictatingExerciseId }
          : undefined;
    try {
      await view.handy.toggle(executable);
      const nextTarget = activeTarget ? undefined : target;
      view.tutorState = {
        ...view.tutorState,
        speech: {
          ...view.tutorState.speech,
          dictatingExerciseId: nextTarget && 'exerciseId' in nextTarget
            ? nextTarget.exerciseId : undefined,
          dictatingConversation: nextTarget && 'conversation' in nextTarget
            ? true : undefined,
          dictationProvider: nextTarget ? 'handy' : undefined
        }
      };
      if (nextTarget && 'conversation' in nextTarget) {
        view.tutorStandardTurnTiming = new StandardConversationTurnTiming(
          (line) => view.actions.log(line), Date.now
        );
        view.tutorStandardTurnTiming.dictationStarted('handy');
      }
      // Replacing the webview here destroys the textarea Handy is about to paste into.
      // Patch only the microphone state so the focused answer survives start and stop.
      postTutorDictationState(view,
        nextTarget ? 'recording' : 'idle',
        'handy',
        nextTarget ?? activeTarget
      );
    } catch (error: unknown) {
      const detail = safePanelErrorMessage(error);
      view.actions.log(`[Handy dictation launch failed] ${detail}`);
      view.actions.notify('error', `KREN: Handy could not start. ${detail}`);
    }
  }

export async function startGeminiDictation(view: KrenResultsViewProvider, target: TutorDictationTarget, provider: 'gemini' | 'cloudflare' | 'groq' = 'gemini'): Promise<void> {
    const task = startGeminiDictationGuarded(view, target, provider);
    view.geminiDictationStartTask = task;
    try {
      await task;
    } finally {
      if (view.geminiDictationStartTask === task) view.geminiDictationStartTask = undefined;
    }
  }

export async function startGeminiDictationGuarded(view: KrenResultsViewProvider, target: TutorDictationTarget, provider: 'gemini' | 'cloudflare' | 'groq' = 'gemini'): Promise<void> {
    if (view.geminiRecording || view.tutorState.speech.transcribingExerciseId ||
        view.tutorState.speech.transcribingConversation) return;
    const generation = ++view.geminiDictationStartGeneration;
    view.geminiDictationStart = { generation, target };
    if ('conversation' in target) postTutorConversationStopState(view);
    try {
      const recording = await view.recorder.start();
      if (view.geminiDictationStart?.generation !== generation ||
          ('conversation' in target && view.tutorState.conversation.status !== 'active')) {
        await recording.cancel().catch((error: unknown) => {
          view.actions.log(`[KREN microphone cleanup failed] ${safePanelErrorMessage(error)}`);
        });
        return;
      }
      view.geminiDictationStart = undefined;
      view.geminiRecording = recording;
      view.geminiRecordingTarget = target;
      if ('conversation' in target) {
        view.tutorStandardTurnTiming = new StandardConversationTurnTiming(
          (line) => view.actions.log(line), Date.now
        );
        view.tutorStandardTurnTiming.dictationStarted(provider);
      }
      view.tutorState = {
        ...view.tutorState,
        speech: {
          ...view.tutorState.speech,
          dictatingExerciseId: 'exerciseId' in target ? target.exerciseId : undefined,
          dictatingConversation: 'conversation' in target ? true : undefined,
          dictationProvider: provider,
          transcribingExerciseId: undefined,
          transcribingConversation: undefined
        }
      };
      postTutorDictationState(view, 'recording', provider, target);
    } catch (error: unknown) {
      if (view.geminiDictationStart?.generation !== generation) return;
      const detail = safePanelErrorMessage(error);
      view.actions.log(`[KREN microphone start failed] ${detail}`);
      view.actions.notify('error', `KREN: The microphone could not start. ${detail}`);
    } finally {
      if (view.geminiDictationStart?.generation === generation) {
        view.geminiDictationStart = undefined;
      }
      if ('conversation' in target) postTutorConversationStopState(view);
    }
  }

export async function stopGeminiDictation(view: KrenResultsViewProvider, target: TutorDictationTarget): Promise<void> {
    const provider = view.tutorState.speech.dictationProvider === 'groq' ? 'groq' : view.tutorState.speech.dictationProvider === 'cloudflare' ? 'cloudflare' : 'gemini';
    const providerName = provider === 'groq' ? 'Groq' : provider === 'cloudflare' ? 'Cloudflare' : 'Gemini';
    const recording = view.geminiRecording;
    if (!recording) return;
    view.geminiRecording = undefined;
    view.geminiRecordingTarget = undefined;
    const controller = new AbortController();
    const exerciseSet = view.tutorState.exerciseSet;
    view.geminiTranscriptionController = controller;
    const timeoutMs = Math.max(1_000, view.actions.settings().requestTimeoutMs ?? 45_000);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    view.tutorState = {
      ...view.tutorState,
      speech: {
        ...view.tutorState.speech,
        dictatingExerciseId: undefined,
        dictatingConversation: undefined,
        dictationProvider: provider,
        transcribingExerciseId: 'exerciseId' in target ? target.exerciseId : undefined,
        transcribingConversation: 'conversation' in target ? true : undefined
      }
    };
    postTutorDictationState(view, 'transcribing', provider, target);
    try {
      const transcript = (await recording.finish(async (audio, format) => {
        if (controller.signal.aborted) return '';
        view.actions.log(
          `[KREN dictation] Recorded WAV: ${format.sampleRate} Hz, ${format.channels} ${format.channels === 1 ? 'channel' : 'channels'}, ${format.bitsPerSample} bit.`
        );
        return provider === 'cloudflare' || provider === 'groq'
          ? view.actions.transcribeTutorAudio(audio, controller.signal, provider)
          : view.actions.transcribeTutorAudio(audio, controller.signal);
      })).trim();
      if (controller.signal.aborted || view.geminiTranscriptionController !== controller) return;
      if ('exerciseId' in target && view.tutorState.exerciseSet !== exerciseSet) return;
      if (!transcript) throw new Error(`${providerName} returned an empty transcript.`);
      const sendConversationNow = 'conversation' in target &&
        (view.tutorState.conversation.send === 'stopSpeaking' || view.tutorState.conversation.replies === 'liveGemini');
      if ('conversation' in target) {
        view.tutorStandardTurnTiming?.transcriptReceived();
        if (!sendConversationNow) {
          const conversation = view.tutorState.conversation;
          const separator = conversation.draftAnswer && !/\s$/u.test(conversation.draftAnswer)
            ? ' ' : '';
          view.tutorState = {
            ...view.tutorState,
            conversation: {
              ...conversation,
              draftAnswer: conversation.draftAnswer + separator + transcript,
              draftAnswerSpoken: true
            }
          };
        }
      } else {
        const answer = view.tutorState.answers[target.exerciseId] ?? '';
        const separator = answer && !/\s$/u.test(answer) ? ' ' : '';
        view.tutorState = { ...view.tutorState, answers: {
          ...view.tutorState.answers, [target.exerciseId]: answer + separator + transcript
        } };
      }
      view.tutorState = {
        ...view.tutorState,
        speech: {
          ...view.tutorState.speech,
          dictationProvider: undefined,
          transcribingExerciseId: undefined,
          transcribingConversation: undefined
        }
      };
      postTutorDictationState(view,
        'idle', provider, target, sendConversationNow ? undefined : transcript
      );
      if (sendConversationNow) {
        const draft = view.tutorState.conversation.draftAnswer;
        submitTutorConversationTurn(view, draft + (draft && !/\s$/u.test(draft) ? ' ' : '') + transcript);
      }
    } catch (error: unknown) {
      const detail = provider === 'cloudflare'
        ? error instanceof CloudflareAiError ? error.message : 'Cloudflare could not transcribe the recording.'
        : safePanelErrorMessage(error);
      view.actions.log(`[${providerName} transcription failed] ${detail}`);
      const message = /empty transcript/iu.test(detail)
        ? `KREN: ${providerName} returned an empty transcript.`
        : controller.signal.aborted
          ? `KREN: ${providerName} transcription timed out or was canceled.`
          : `KREN: ${providerName} transcription failed. ${detail}`;
      view.actions.notify('error', message);
    } finally {
      clearTimeout(timeout);
      if (view.geminiTranscriptionController === controller) {
        view.geminiTranscriptionController = undefined;
      }
      const targetStillTranscribing = 'conversation' in target
        ? view.tutorState.speech.transcribingConversation === true
        : view.tutorState.speech.transcribingExerciseId === target.exerciseId;
      if (targetStillTranscribing) {
        view.tutorState = {
          ...view.tutorState,
          speech: {
            ...view.tutorState.speech,
            dictationProvider: undefined,
            transcribingExerciseId: undefined,
            transcribingConversation: undefined
          }
        };
        postTutorDictationState(view, 'idle', provider, target);
      }
    }
  }

export function postTutorDictationState(view: KrenResultsViewProvider,
    state: 'idle' | 'recording' | 'transcribing',
    provider: 'handy' | 'gemini' | 'cloudflare' | 'groq',
    target?: TutorDictationTarget,
    transcript?: string
  ): void {
    if (view.view) {
      void view.view.webview.postMessage({
        command: 'tutorDictationState',
        ...(target && 'exerciseId' in target ? { exerciseId: target.exerciseId } : {}),
        ...(target && 'conversation' in target ? { conversation: true } : {}),
        state,
        provider,
        ...(transcript === undefined ? {} : { transcript })
      });
    }
    if (target && 'conversation' in target) postTutorConversationStopState(view);
  }

export function cancelGeminiDictation(view: KrenResultsViewProvider): void {
    view.geminiDictationStartGeneration += 1;
    view.geminiDictationStart = undefined;
    view.geminiTranscriptionController?.abort();
    view.geminiTranscriptionController = undefined;
    const recording = view.geminiRecording;
    view.geminiRecording = undefined;
    view.geminiRecordingTarget = undefined;
    view.tutorState = {
      ...view.tutorState,
      speech: {
        ...view.tutorState.speech,
        dictatingExerciseId: undefined,
        dictatingConversation: undefined,
        dictationProvider: undefined,
        transcribingExerciseId: undefined,
        transcribingConversation: undefined
      }
    };
    if (recording) void recording.cancel().catch((error: unknown) => {
      view.actions.log(`[KREN microphone cleanup failed] ${safePanelErrorMessage(error)}`);
    });
  }

/** Cancels speech owned anywhere in the tutor before a whole-session reset deletes its owner. */
export function cancelTutorSessionDictation(view: KrenResultsViewProvider): void {
    const speech = view.tutorState.speech;
    const ownsHandyRecording = speech.dictationProvider === 'handy' && Boolean(
      speech.dictatingConversation || speech.dictatingExerciseId
    );
    cancelGeminiDictation(view);
    if (ownsHandyRecording && view.handyExecutable) {
      void view.handy.toggle(view.handyExecutable).catch((error: unknown) => {
        view.actions.log(`[Handy dictation stop failed] ${safePanelErrorMessage(error)}`);
      });
    }
  }

/** Cancels Standard speech only when the open conversation owns it. */
export async function cancelTutorConversationDictation(view: KrenResultsViewProvider, waitForPendingStart = false): Promise<void> {
    const pendingConversationStart = view.geminiDictationStart &&
      'conversation' in view.geminiDictationStart.target;
    const pendingConversationStartTask = pendingConversationStart
      ? view.geminiDictationStartTask : undefined;
    if (pendingConversationStart) {
      view.geminiDictationStartGeneration += 1;
      view.geminiDictationStart = undefined;
    }

    const speech = view.tutorState.speech;
    const geminiOwnsRecording = view.geminiRecording &&
      (view.geminiRecordingTarget
        ? 'conversation' in view.geminiRecordingTarget
        : (speech.dictationProvider === 'gemini' || speech.dictationProvider === 'cloudflare' || speech.dictationProvider === 'groq') && speech.dictatingConversation === true);
    const recording = geminiOwnsRecording ? view.geminiRecording : undefined;
    if (recording) {
      view.geminiRecording = undefined;
      view.geminiRecordingTarget = undefined;
    }

    const ownsGeminiTranscription = (speech.dictationProvider === 'gemini' || speech.dictationProvider === 'cloudflare' || speech.dictationProvider === 'groq') &&
      speech.transcribingConversation === true;
    if (ownsGeminiTranscription) {
      view.geminiTranscriptionController?.abort();
      view.geminiTranscriptionController = undefined;
    }

    const ownsHandyRecording = speech.dictationProvider === 'handy' &&
      speech.dictatingConversation === true;
    const ownsConversationSpeech = Boolean(
      pendingConversationStart || recording || ownsGeminiTranscription || ownsHandyRecording ||
      speech.dictatingConversation || speech.transcribingConversation
    );
    if (!ownsConversationSpeech) return;

    view.tutorState = { ...view.tutorState, speech: {
      ...speech,
      dictatingConversation: undefined,
      transcribingConversation: undefined,
      dictationProvider: undefined
    } };
    postTutorDictationState(view,
      'idle', ownsHandyRecording ? 'handy' : speech.dictationProvider === 'groq' ? 'groq' : speech.dictationProvider === 'cloudflare' ? 'cloudflare' : 'gemini', { conversation: true }
    );
    const cleanup: Promise<unknown>[] = [];
    if (waitForPendingStart && pendingConversationStartTask) cleanup.push(pendingConversationStartTask);
    if (recording) cleanup.push(recording.cancel().catch((error: unknown) => {
      view.actions.log(`[KREN microphone cleanup failed] ${safePanelErrorMessage(error)}`);
    }));
    if (ownsHandyRecording && view.handyExecutable) {
      cleanup.push(view.handy.toggle(view.handyExecutable).catch((error: unknown) => {
        view.actions.log(`[Handy dictation stop failed] ${safePanelErrorMessage(error)}`);
      }));
    }
    await Promise.all(cleanup);
  }
