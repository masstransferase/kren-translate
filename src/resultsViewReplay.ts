import { tutorLanguageModelRoute, advanceTutorConversationOpening } from './resultsViewConversation.js';
import { stopTutorTakeHomeSpeech } from './resultsViewTakeHome.js';
import { tutorLiveReplayAvailable, failTutorLiveAudio, stopTutorLiveAudio, playTutorLiveAudio, postTutorLiveSpeakerState, logTutorLiveAudioError, tutorConversationReplayAvailable } from './resultsViewLive.js';
import type { KrenResultsViewProvider, TutorConversationSpeechItem } from './resultsView.js';
import { TUTOR_DEFAULTS } from './tutor/defaults.js';
import { sentencePause, splitSpeechSentences } from './speech/sentencePause.js';
import { tutorSpeechPlaybackBarriers, type SpeechPlaybackBarrier } from './speech/speechAdapter.js';
import {
  TUTOR_CONVERSATION_ENGLISH_ONLY_INSTRUCTION,
  tutorLiveSessionCredential,
  tutorLiveSessionCredentialRequest
} from './tutor/generation.js';
import {
  normalizedTutorLiveVoice,
  TUTOR_LIVE_VOICES,
  tutorConversationReply
} from './tutor/state.js';
import { TutorLiveSession, type TutorLiveAudioChunk } from './tutor/liveSession.js';
import { tutorConversationVoicePlan, tutorCharacterVoicesAt, tutorVoiceForSource, tutorConversationSpeechVoice, type TutorCharacterVoices } from './speech/voiceSelection.js';
import { tutorConversationAnswersMatch, tutorConversationVisibleReply, tutorConversationQuestionRepeatsReply } from './resultViewHtml.js';
import { tutorLearnerTurnNotShown } from './tutor/learnerLanguage.js';
import { configuredTutorLiveModel } from './resultsViewConfiguration.js';
import { closeTutorDemoResources, openTutorDemoLiveSessions, speakTutorDemoText } from './resultsViewDemo.js';

export function replayTutorQuestion(view: KrenResultsViewProvider): void {
    const conversation = view.tutorState.conversation;
    if (conversation.replayAllSpeaking) {
      cancelTutorConversationReplayAll(view);
      return;
    }
    if (conversation.status === 'stopped') {
      replayTutorConversation(view);
      return;
    }
    if (!conversation.speakerOn) return;
    if (conversation.replies === 'liveGemini' && !view.tutorLiveFailed) {
      if (!tutorLiveReplayAvailable(view)) return;
      speakTutorConversationSequence(view,
        [{ kind: 'liveAudio', chunks: view.tutorLiveReplyAudio.map((chunk) => ({ ...chunk })) }],
        'The question could not be replayed. Try Replay again.',
        true
      );
      return;
    }
    const latestTurn = [...conversation.transcript].reverse().find((turn) => !turn.skipped);
    const question = conversation.status === 'active' ? conversation.currentQuestion
      : latestTurn ? tutorConversationReply(latestTurn) : undefined;
    if (!question) return;
    speakTutorConversationSequence(view,
      [question],
      'The question could not be read aloud. Try Replay again.',
      true
    );
  }

export async function startTutorLiveReplyReplay(view: KrenResultsViewProvider): Promise<void> {
    const conversation = view.tutorState.conversation;
    if (conversation.status !== 'active' || conversation.replies !== 'liveGemini' ||
        !conversation.speakerOn || !tutorLiveReplayAvailable(view)) return;
    const generation = ++view.tutorLiveAudioGeneration;
    try {
      const player = await view.waveOutPlayer.start((error) => failTutorLiveAudio(view, error, generation));
      if (generation !== view.tutorLiveAudioGeneration ||
          view.tutorState.conversation.status !== 'active') {
        player.close();
        return;
      }
      view.tutorLiveAudioPlayer = player;
      view.tutorLiveReplayOwnsAudioPlayer = false;
      stopTutorLiveAudio(view);
      for (const chunk of view.tutorLiveReplyAudio) playTutorLiveAudio(view, chunk);
      postTutorLiveSpeakerState(view);
    } catch (error) {
      if (generation === view.tutorLiveAudioGeneration) logTutorLiveAudioError(view, error);
    }
  }

export function postTutorReplayAllState(view: KrenResultsViewProvider, pressed: boolean): void {
    if (!view.view) return;
    void view.view.webview.postMessage({ command: 'tutorReplayAllState', pressed });
  }

export function cancelTutorLiveReplayWait(view: KrenResultsViewProvider): void {
    const wait = view.tutorLiveReplayWait;
    view.tutorLiveReplayWait = undefined;
    if (!wait) return;
    clearTimeout(wait.timer);
    wait.resolve();
  }

export function closeTutorReplayAudioPlayer(view: KrenResultsViewProvider): void {
    if (!view.tutorLiveReplayOwnsAudioPlayer) return;
    cancelTutorLiveReplayWait(view);
    view.tutorLiveAudioPlayer?.stop();
    view.tutorLiveAudioPlayer?.close();
    view.tutorLiveAudioPlayer = undefined;
    view.tutorLiveReplayOwnsAudioPlayer = false;
    view.tutorLivePlaybackQueuedUntil = 0;
    view.tutorLivePlaybackBlockedUntil = 0;
    view.tutorLiveAudioGeneration += 1;
  }

const tutorIntroMuteCompletions = new WeakMap<object, () => void>();

export function cancelTutorConversationReplayAll(view: KrenResultsViewProvider, stopSpeech = true): void {
    // Muting stops sound but releases the opening. Stop, navigation and abort still cancel it.
    const mutedIntro = !stopSpeech && !view.tutorState.conversation.speakerOn && view.tutorIntroCompletionWait;
    const release = mutedIntro && tutorIntroMuteCompletions.get(mutedIntro);
    if (release) release();
    else cancelTutorIntroCompletion(view);
    if (!view.tutorConversationSpeechSequenceRunning &&
        !view.tutorState.conversation.replayAllSpeaking) return;
    view.tutorReplayAllGeneration += 1;
    if (view.tutorConversationOpeningWait) {
      clearTimeout(view.tutorConversationOpeningWait.timer);
      view.tutorConversationOpeningWait.resolve();
      view.tutorConversationOpeningWait = undefined;
    }
    view.tutorConversationSpeechSequenceRunning = false;
    view.tutorConversationIntroSpeaking = false;
    view.tutorConversationSpeechStarted = undefined;
    advanceTutorConversationOpening(view, 'ready');
    if (view.tutorState.conversation.speechReveal) {
      view.tutorState.conversation.speechReveal = undefined;
      view.render();
    }
    const replayAllWasSpeaking = view.tutorState.conversation.replayAllSpeaking;
    view.tutorState = { ...view.tutorState, conversation: {
      ...view.tutorState.conversation, replayAllSpeaking: false
    } };
    view.tutorLiveReplayController?.abort();
    view.tutorLiveReplayController = undefined;
    view.tutorLiveReplayLearnerSession?.close();
    view.tutorLiveReplayLearnerSession = undefined;
    stopTutorLiveAudio(view);
    closeTutorReplayAudioPlayer(view);
    if (stopSpeech) view.actions.stopReadAloud();
    if (replayAllWasSpeaking) postTutorReplayAllState(view, false);
    view.postTutorConversationStopState();
  }

export function cancelTutorIntroCompletion(view: KrenResultsViewProvider): void {
    view.tutorIntroCompletionWait?.cancel();
  }

/** The caller has finished reading the real intro. Live also needs native buffer completion. */
export async function waitForTutorIntroCompletion(view: KrenResultsViewProvider,
    isCurrent: () => boolean, signal?: AbortSignal, livePlayback = false, onPlaybackComplete?: () => void): Promise<boolean> {
    if (signal?.aborted || !isCurrent()) return false;
    cancelTutorIntroCompletion(view);
    let canceled = false;
    await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stopReadAloud = view.actions.stopReadAloud;
      const stopOpening = () => {
        cancelTutorIntroCompletion(view);
        cancelTutorConversationReplayAll(view, false);
        stopReadAloud.call(view.actions);
      };
      const finish = () => {
        if (timer !== undefined) clearTimeout(timer);
        if (view.actions.stopReadAloud === stopOpening) view.actions.stopReadAloud = stopReadAloud;
        signal?.removeEventListener('abort', cancel);
        if (view.tutorIntroCompletionWait === wait) view.tutorIntroCompletionWait = undefined;
        tutorIntroMuteCompletions.delete(wait);
        resolve();
      };
      const cancel = () => { canceled = true; finish(); };
      const playbackComplete = () => {
        const completedAt = livePlayback && view.tutorLivePlaybackQueuedUntil > 0
          ? view.tutorLivePlaybackQueuedUntil : Date.now();
        if (timer === undefined) {
          timer = setTimeout(finish, Math.max(0, completedAt + 1_000 - Date.now()));
          onPlaybackComplete?.();
        }
      };
      const wait = { cancel, playbackComplete };
      tutorIntroMuteCompletions.set(wait, finish);
      view.tutorIntroCompletionWait = wait;
      // The host Stop action also owns a silent opening pause, when no reader is active.
      view.actions.stopReadAloud = stopOpening;
      signal?.addEventListener('abort', cancel, { once: true });
      if (!livePlayback || view.tutorLivePlaybackBlockedUntil !== Number.POSITIVE_INFINITY) playbackComplete();
    });
    return !canceled && !signal?.aborted && isCurrent();
  }

export function tutorReplayLearnerEdgeVoice(view: KrenResultsViewProvider): string | undefined {
    return view.actions.settings().tutorReadAloudProvider === 'edgeOnline'
      ? tutorConversationVoicePlan(view).learner.edgeVoice : undefined;
  }

export function tutorReplayLearnerLiveVoice(view: KrenResultsViewProvider): string {
    return tutorConversationVoicePlan(view).learner.liveVoice;
  }

  // The learner's voice is passed for this one Standard replay reading. The first V124 version
  // wrote it into settings and restored them afterwards, which a stopped replay could leave changed.
export async function readTutorConversationText(view: KrenResultsViewProvider, text: string, utteranceVoice?: string, playbackBarrier?: SpeechPlaybackBarrier): Promise<void> {
    const settings = view.actions.settings();
    const voice = utteranceVoice ?? tutorVoiceForSource(settings, tutorConversationVoicePlan(view).current);
    const legacyVoice = tutorConversationSpeechVoice(settings, view.tutorState.conversation.liveVoice);
    const defaultVoice = settings.tutorReadAloudProvider === 'windowsLocal'
      ? settings.tutorReadAloudVoice ?? TUTOR_DEFAULTS.configuration['tutor.readAloud.voice']
      : settings.tutorReadAloudProvider === 'googleChirp' ? legacyVoice
      : settings.tutorEdgeReadAloudVoice ?? TUTOR_DEFAULTS.configuration['tutor.readAloud.edgeVoice'];
    const override = voice !== defaultVoice ? voice : undefined;
    const forwardedVoice = settings.tutorReadAloudProvider === 'windowsLocal' ? undefined : override ?? legacyVoice;
    // Windows uses the existing speaker callback, so its voice never forces Edge Online.
    const reading = settings.tutorReadAloudProvider === 'windowsLocal' && override
      ? { voice: override, conversation: view.tutorSpeechConversation } : undefined;
    view.tutorSpeechUtteranceVoice = reading;
    try {
      if (playbackBarrier) tutorSpeechPlaybackBarriers.set(view.actions.readAloudText, playbackBarrier);
      let pending: Promise<void>;
      try {
        pending = view.actions.readAloudText(text, 'en', 'tutor', ...(forwardedVoice ? [forwardedVoice] as const : [] as const));
      } finally { tutorSpeechPlaybackBarriers.delete(view.actions.readAloudText); }
      await pending;
    } finally {
      if (reading && view.tutorSpeechUtteranceVoice === reading) view.tutorSpeechUtteranceVoice = undefined;
    }
  }

export async function waitForTutorLiveReplayAudio(view: KrenResultsViewProvider, generation: number): Promise<boolean> {
    while (generation === view.tutorReplayAllGeneration &&
        Date.now() < view.tutorLivePlaybackQueuedUntil) {
      const delay = Math.max(1, Math.ceil(view.tutorLivePlaybackQueuedUntil - Date.now()));
      await new Promise<void>((resolve) => {
        const finish = (): void => {
          if (view.tutorLiveReplayWait?.resolve === finish) view.tutorLiveReplayWait = undefined;
          resolve();
        };
        const timer = setTimeout(finish, delay);
        view.tutorLiveReplayWait = { timer, resolve: finish };
      });
    }
    return generation === view.tutorReplayAllGeneration;
  }

export async function replayTutorLiveAudioLine(view: KrenResultsViewProvider,
    chunks: readonly TutorLiveAudioChunk[],
    replayGeneration: number
  ): Promise<boolean> {
    if (!view.tutorLiveAudioPlayer) {
      const audioGeneration = ++view.tutorLiveAudioGeneration;
      const player = await view.waveOutPlayer.start((error) => {
        failTutorLiveAudio(view, error, audioGeneration);
      });
      if (replayGeneration !== view.tutorReplayAllGeneration) {
        player.close();
        return false;
      }
      view.tutorLiveAudioPlayer = player;
      view.tutorLiveReplayOwnsAudioPlayer = true;
    }
    stopTutorLiveAudio(view);
    for (const chunk of chunks) playTutorLiveAudio(view, chunk);
    return waitForTutorLiveReplayAudio(view, replayGeneration);
  }

export async function openTutorReplayLearnerSession(view: KrenResultsViewProvider,
    replayGeneration: number,
    controller: AbortController
  ): Promise<TutorLiveSession | undefined> {
    let stage = 'credential request';
    try {
      const geminiProfile = view.actions.settings().tutorLiveProfile ?? 'standard';
      const credential = await view.actions.generateTutor(
        tutorLiveSessionCredentialRequest(), tutorLanguageModelRoute(view), controller.signal
      );
      if (controller.signal.aborted || replayGeneration !== view.tutorReplayAllGeneration) return undefined;
      const apiKey = tutorLiveSessionCredential(credential);
      stage = 'session open';
      const session = new TutorLiveSession({
        geminiProfile,
        apiKey,
        model: configuredTutorLiveModel(),
        voiceName: tutorReplayLearnerLiveVoice(view),
        systemInstruction: TUTOR_CONVERSATION_ENGLISH_ONLY_INSTRUCTION +
          'For conversation replay, read exactly the sentence in each turn. Add no words.',
        socketFactory: view.tutorLiveSocketFactory,
        onText: () => undefined,
        onAudio: (chunk) => {
          if (controller.signal.aborted || replayGeneration !== view.tutorReplayAllGeneration) return;
          playTutorLiveAudio(view, chunk);
        }
      });
      view.tutorLiveReplayLearnerSession = session;
      await session.connect();
      return session;
    } catch (error) {
      if (!controller.signal.aborted && replayGeneration === view.tutorReplayAllGeneration) {
        view.showMissingCredentialError(error, true);
        view.actions.log(`[conversation Live replay learner voice failed] ${stage} failed; learner lines skipped.`);
      }
      view.tutorLiveReplayLearnerSession?.close();
      view.tutorLiveReplayLearnerSession = undefined;
      return undefined;
    }
  }

export function replayTutorLiveConversation(view: KrenResultsViewProvider): void {
    const conversation = view.tutorState.conversation;
    const turns = conversation.transcript.map((turn, index) => ({
      turn,
      chunks: view.tutorLiveConversationAudio.get(index) ?? [],
      learner: conversation.from === 'speakAndRephrase' || turn.spoken
        ? turn.learnerAnswer : turn.correction.trim() || turn.learnerAnswer
    })).filter(({ turn, chunks, learner }) => !turn.skipped && !turn.learnerNotShown &&
      (chunks.length > 0 || learner.trim()));
    const trailingChunks = view.tutorLiveConversationAudio.get(conversation.transcript.length) ?? [];
    if (conversation.status !== 'stopped' || !conversation.speakerOn ||
        !tutorConversationReplayAvailable(view)) return;
    stopTutorTakeHomeSpeech(view);
    cancelTutorConversationReplayAll(view);
    const generation = ++view.tutorReplayAllGeneration;
    const controller = new AbortController();
    view.tutorLiveReplayController = controller;
    view.tutorConversationSpeechSequenceRunning = true;
    view.tutorState = { ...view.tutorState, conversation: {
      ...conversation, replayAllSpeaking: true, failure: undefined
    } };
    postTutorReplayAllState(view, true);
    view.postTutorConversationStopState();
    void (async () => {
      let learnerSession: TutorLiveSession | undefined;
      try {
        if (!view.tutorLiveAudioPlayer) {
          const audioGeneration = ++view.tutorLiveAudioGeneration;
          const player = await view.waveOutPlayer.start((error) => {
            failTutorLiveAudio(view, error, audioGeneration);
          });
          if (controller.signal.aborted || generation !== view.tutorReplayAllGeneration) {
            player.close();
            return;
          }
          view.tutorLiveAudioPlayer = player;
          view.tutorLiveReplayOwnsAudioPlayer = true;
        }
        // 2026-10-02: Partial replay uses retained Gemini clips only, with no synthesized learner voice.
        const completeArchive = turns.every(({ chunks }) => chunks.length > 0) && trailingChunks.length > 0;
        const chirp = view.actions.settings().tutorReadAloudProvider === 'googleChirp';
        learnerSession = completeArchive && !chirp ? await openTutorReplayLearnerSession(view, generation, controller) : undefined;
        for (const { chunks, learner } of turns) {
          if (controller.signal.aborted || generation !== view.tutorReplayAllGeneration) return;
          if (chunks.length > 0 && !await replayTutorLiveAudioLine(view, chunks, generation)) return;
          if (chirp && completeArchive && learner.trim()) {
            await readTutorConversationText(view, learner, tutorReplayLearnerLiveVoice(view));
            continue;
          }
          if (!learnerSession || !learner.trim()) continue;
          try {
            stopTutorLiveAudio(view);
            await learnerSession.sendTurn(`Read exactly this sentence: ${JSON.stringify(learner)}`);
            if (!await waitForTutorLiveReplayAudio(view, generation)) return;
          } catch {
            if (!controller.signal.aborted && generation === view.tutorReplayAllGeneration) {
              view.actions.log(
                '[conversation Live replay learner voice failed] sentence turn failed; remaining learner lines skipped.'
              );
            }
            learnerSession.close();
            learnerSession = undefined;
            view.tutorLiveReplayLearnerSession = undefined;
          }
        }
        if (trailingChunks.length > 0 &&
            !await replayTutorLiveAudioLine(view, trailingChunks, generation)) return;
      } catch {
        if (!controller.signal.aborted && generation === view.tutorReplayAllGeneration) {
          view.actions.log('[conversation Live replay failed] stored Gemini audio playback failed.');
        }
      } finally {
        learnerSession?.close();
        if (view.tutorLiveReplayLearnerSession === learnerSession) {
          view.tutorLiveReplayLearnerSession = undefined;
        }
        if (view.tutorLiveReplayController === controller) view.tutorLiveReplayController = undefined;
        if (generation !== view.tutorReplayAllGeneration) return;
        closeTutorReplayAudioPlayer(view);
        view.tutorConversationSpeechSequenceRunning = false;
        view.tutorState = { ...view.tutorState, conversation: {
          ...view.tutorState.conversation, replayAllSpeaking: false
        } };
        postTutorReplayAllState(view, false);
        view.postTutorConversationStopState();
      }
    })();
  }

export function speakTutorConversationSequence(view: KrenResultsViewProvider,
    utterances: readonly (string | TutorConversationSpeechItem)[],
    failure: string,
    replayAll = false,
    introScene = false,
    onAdvance?: (completed: number) => void,
    onStart?: (index: number) => void
  ): void {
    const spoken = utterances.map((utterance): TutorConversationSpeechItem =>
      typeof utterance === 'string'
        ? { kind: 'text', text: utterance, speaker: 'tutor', voices: tutorConversationVoicePlan(view).current }
        : utterance
    ).filter((utterance) => utterance.kind === 'liveAudio'
      ? utterance.chunks.length > 0
      : Boolean(utterance.text.trim()));
    // 2026-10-11: Only an active Live session mutes ordinary reply speech. After failure,
    // the selected Speech Source reads the Standard opening and subsequent replies.
    if (view.tutorLiveSession && !view.tutorLiveFailed && view.tutorState.conversation.replies === 'liveGemini' && spoken.some(
      (utterance) => utterance.kind === 'text' && utterance.speaker !== 'learner'
    )) return;
    if (spoken.length === 0) return;
    if (replayAll) stopTutorTakeHomeSpeech(view);
    cancelTutorConversationReplayAll(view);
    const generation = ++view.tutorReplayAllGeneration;
    view.tutorConversationSpeechSequenceRunning = true;
    view.tutorConversationIntroSpeaking = introScene;
    view.postTutorConversationStopState();
    if (replayAll) {
      view.tutorState = { ...view.tutorState, conversation: {
        ...view.tutorState.conversation, replayAllSpeaking: true, failure: undefined
      } };
      postTutorReplayAllState(view, true);
    }
    void (async () => {
      let introReady: Promise<boolean> | undefined;
      let introReleased = false;
      try {
        for (const [index, utterance] of spoken.entries()) {
          if (generation !== view.tutorReplayAllGeneration) return;
          if (index > 0 && introScene && !introReady) {
            view.tutorConversationIntroSpeaking = false;
            view.postTutorConversationStopState();
          }
          if (utterance.kind === 'liveAudio') {
            if (!await replayTutorLiveAudioLine(view, utterance.chunks, generation)) return;
            continue;
          }
          // 2026-10-12: Synthesis gets its own allowance. Playback starts the reading
          // deadline, so a slow first request cannot consume the scene's speech time.
          let timer: ReturnType<typeof setTimeout> | undefined;
          let started = false;
          const safety = new Promise<void>(resolve => {
            const arm = (ms: number) => {
              if (timer) clearTimeout(timer);
              timer = setTimeout(() => {
                if (generation === view.tutorReplayAllGeneration) view.actions.stopReadAloud();
                resolve();
              }, ms);
              view.tutorConversationOpeningWait = { timer, resolve };
            };
            arm(120_000);
            view.tutorConversationSpeechStarted = () => {
              if (generation !== view.tutorReplayAllGeneration) return;
              const pauseDuration = Math.max(0, splitSpeechSentences(utterance.text).length - 1) *
                sentencePause(view.actions.settings().tutorSentencePauseMilliseconds);
              arm(Math.min(600_000, Math.max(120_000, utterance.text.length * 180 + 30_000) + pauseDuration));
              if (started) return;
              started = true;
              // A compatibility fallback can report readiness before playback is released.
              if (index === 1 && introReady && !introReleased) {
                void introReady.then(ready => {
                  if (ready && generation === view.tutorReplayAllGeneration) onStart?.(index);
                });
              } else onStart?.(index);
            };
          });
          try {
            const plan = tutorConversationVoicePlan(view);
            const voices = utterance.voices ?? (utterance.speaker === 'learner' ? plan.learner : plan.current);
            await Promise.race([readTutorConversationText(view, utterance.text,
              tutorVoiceForSource(view.actions.settings(), voices), index === 1 && introReady
                ? async () => Boolean(await introReady) && generation === view.tutorReplayAllGeneration && view.tutorState.conversation.speakerOn
                : undefined), safety]);
            if (introReady && !await introReady) return;
            // Failure, cancellation or a source without a start signal still releases text.
            if (!started && generation === view.tutorReplayAllGeneration) onStart?.(index);
          } finally {
            if (timer) clearTimeout(timer);
            if (generation === view.tutorReplayAllGeneration) view.tutorConversationSpeechStarted = undefined;
            if (view.tutorConversationOpeningWait?.timer === timer) view.tutorConversationOpeningWait = undefined;
          }
          if (generation !== view.tutorReplayAllGeneration) return;
          if (index === 0 && introScene) {
            introReady = waitForTutorIntroCompletion(view, () => generation === view.tutorReplayAllGeneration);
            if (spoken.length === 1) { if (!await introReady) return; }
            else {
              void introReady.then(ready => {
                if (!ready || generation !== view.tutorReplayAllGeneration) return;
                introReleased = true;
                view.tutorConversationIntroSpeaking = false;
                view.postTutorConversationStopState();
                onAdvance?.(1);
              });
              continue;
            }
          }
          onAdvance?.(index + 1);
        }
      } catch {
        if (generation !== view.tutorReplayAllGeneration) return;
        view.tutorState = { ...view.tutorState, conversation: {
          ...view.tutorState.conversation, failure
        } };
        if (!onAdvance) view.render();
      } finally {
        if (generation !== view.tutorReplayAllGeneration) return;
        closeTutorReplayAudioPlayer(view);
        view.tutorConversationSpeechSequenceRunning = false;
        view.tutorConversationIntroSpeaking = false;
        view.tutorConversationSpeechStarted = undefined;
        onAdvance?.(spoken.length);
        if (replayAll) {
          view.tutorState = { ...view.tutorState, conversation: {
            ...view.tutorState.conversation, replayAllSpeaking: false
          } };
          postTutorReplayAllState(view, false);
        }
        view.postTutorConversationStopState();
        view.flushSpeechRender?.();
      }
    })();
  }

export function replayTutorConversation(view: KrenResultsViewProvider): void {
    const conversation = view.tutorState.conversation;
    if (conversation.demoMode) {
      if (conversation.replayAllSpeaking) {
        closeTutorDemoResources(view);
        view.tutorState = { ...view.tutorState, conversation: {
          ...view.tutorState.conversation, replayAllSpeaking: false
        } };
        postTutorReplayAllState(view, false);
        return;
      }
      if (conversation.status !== 'stopped' || !conversation.speakerOn ||
          conversation.demoLines.length === 0) return;
      stopTutorTakeHomeSpeech(view);
      closeTutorDemoResources(view, false);
      const generation = view.tutorDemoGeneration;
      const controller = new AbortController();
      view.tutorDemoController = controller;
      view.tutorState = { ...view.tutorState, conversation: {
        ...conversation, replayAllSpeaking: true
      } };
      postTutorReplayAllState(view, true);
      void (async () => {
        try {
          if (conversation.replies === 'liveGemini') {
            await openTutorDemoLiveSessions(view, generation, controller);
          }
          for (const line of conversation.demoLines) {
            if (controller.signal.aborted || generation !== view.tutorDemoGeneration) return;
            if (!await speakTutorDemoText(view, line.text, line.speaker, generation)) return;
          }
        } catch {
          if (!controller.signal.aborted && generation === view.tutorDemoGeneration) {
            view.actions.log('[conversation demo replay failed] playback failed.');
          }
        } finally {
          if (view.tutorDemoController !== controller) return;
          closeTutorDemoResources(view, false);
          view.tutorState = { ...view.tutorState, conversation: {
            ...view.tutorState.conversation, replayAllSpeaking: false
          } };
          postTutorReplayAllState(view, false);
        }
      })();
      return;
    }
    if (conversation.replayAllSpeaking) {
      cancelTutorConversationReplayAll(view);
      return;
    }
    if (conversation.replies === 'liveGemini' && !view.tutorLiveFailed) {
      replayTutorLiveConversation(view);
      return;
    }
    const utterances: TutorConversationSpeechItem[] = [];
    const append = (text: string, speaker: 'tutor' | 'learner', voices: TutorCharacterVoices) => {
      const previous = utterances.at(-1);
      if (!text.trim() || (previous?.kind === 'text' &&
          tutorConversationAnswersMatch(previous.text, text, 'typed'))) return;
      utterances.push({ kind: 'text', text, speaker, voices });
    };
    for (const [index, turn] of conversation.transcript.entries()) {
      for (const reply of conversation.unansweredReplies ?? []) {
        if (reply.beforeTurn === index) append(reply.text, 'tutor', tutorCharacterVoicesAt(view, index - 1));
      }
      if (!tutorConversationQuestionRepeatsReply(turn.question, conversation.transcript[index - 1], true)) {
        append(turn.question, 'tutor', tutorCharacterVoicesAt(view, index - 1));
      }
      if (turn.skipped || turn.learnerNotShown || tutorLearnerTurnNotShown(turn.learnerAnswer)) continue;
      // Coach Replay keeps the written coaching silent and reads the learner's balloon.
      append(conversation.from === 'speakAndRephrase' || turn.spoken
        ? turn.learnerAnswer : turn.correction.trim() || turn.learnerAnswer,
        'learner', tutorConversationVoicePlan(view).learner);
      append(tutorConversationVisibleReply(turn, true), 'tutor', tutorCharacterVoicesAt(view, index));
    }
    for (const reply of conversation.unansweredReplies ?? []) {
      if (reply.beforeTurn === conversation.transcript.length) append(reply.text, 'tutor', tutorCharacterVoicesAt(view, conversation.transcript.length - 1));
    }
    const finalTurn = conversation.transcript.at(-1);
    if (finalTurn && !finalTurn.skipped && !finalTurn.learnerNotShown) {
      const question = finalTurn.nextQuestion ?? '';
      if (!tutorConversationQuestionRepeatsReply(question, finalTurn, true)) append(question, 'tutor', tutorCharacterVoicesAt(view, conversation.transcript.length - 1));
    } else if (!finalTurn) {
      append(conversation.currentQuestion, 'tutor', tutorConversationVoicePlan(view).current);
    }
    if (conversation.status !== 'stopped' || !conversation.speakerOn || utterances.length === 0) return;
    speakTutorConversationSequence(view,
      utterances,
      'The conversation could not be replayed. Try Replay again.',
      true
    );
  }
