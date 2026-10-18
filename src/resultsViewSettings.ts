import { randomUUID } from 'node:crypto';
import { renderLanguageModelUsage } from './resultViewHtml.js';
import { renderProviderSwitchSettings } from './resultViewHtml.js';
import { languageModelUsageToday } from './languageModelUsage.js';
import { scheduleTutorConversationHintPrefetch } from './resultsViewHints.js';
import { cancelTutorTakeHome, stopTutorTakeHomeSpeech } from './resultsViewTakeHome.js';
import { TUTOR_DEFAULTS } from './tutor/defaults.js';
import { tutorConversationPreferencesOf } from './tutor/state.js';
import type { KrenResultsViewPanel, KrenResultsViewProvider } from './resultsView.js';
import { regeneratePreparedPrompt } from './resultsViewLesson.js';
import { cancelTutorConversationPicture, ensureTutorConversationPicture, tutorLanguageModelRoute } from './resultsViewConversation.js';
import { cancelTutorSessionDictation } from './resultsViewDictation.js';
import { releaseTutorConversationResources } from './resultsViewLive.js';
import * as vscode from 'vscode';
import { validatedPanelSetting } from './panelSettings.js';
import type { KrenPanelSettingKey } from './panelSettings.js';
import { EDGE_SPEECH_LOCALES } from '@kren/core/edge-speech';
import type { TutorLanguageModelRoute } from './operations.js';
import { TUTOR_CONVERSATION_ENGLISH_ONLY_INSTRUCTION, tutorLiveSessionCredential, tutorLiveSessionCredentialRequest } from './tutor/generation.js';
import { resetTutorSession, resetTutorGeneratedWork, tutorResetBusy, tutorLessonResetBusy, tutorQuestionOnlySelection, normalizedTutorLiveVoice, TUTOR_LIVE_VOICES, type TutorViewState } from './tutor/state.js';
import { TutorLiveSession, TutorLiveSessionError } from './tutor/liveSession.js';
import { findTrainingMapNode } from '@kren/core/tutor';
import { pcmSampleRate, type WindowsWaveOutSession } from './windowsWaveOutPlayer.js';
import { configuredTutorLiveModel, tutorModelForRoute } from './resultsViewConfiguration.js';
import { type ResultsViewCommand } from './resultsViewCommands.js';
import { broadcastPanelTheme } from './resultsViewTheme.js';
import { cancelTutorReviewBatch } from './resultsViewPractice.js';
import type { PanelTheme } from './panelThemes.js';
import { tutorLessonConversationRemaining, TUTOR_LESSON_UNAVAILABLE } from './tutor/lessonConversation.js';

export async function showTutorLessonUnavailable(view: KrenResultsViewProvider): Promise<string | undefined> {
  const choice = await view.showWarningMessage(TUTOR_LESSON_UNAVAILABLE,
    { modal: true, detail: tutorLessonConversationRemaining(view.tutorState) }, 'OK');
  return choice;
}

export async function updatePanelTheme(view: KrenResultsViewProvider, rawValue: string | number | boolean): Promise<void> {
  const value = validatedPanelSetting('display.panelTheme', rawValue);
  if (value === undefined) return;
  await view.actions.updateSetting('display.panelTheme', value);
  broadcastPanelTheme(view.actions.settings().panelTheme as PanelTheme);
}

/** Both Usage controls have a validated write path and patch only their mounted settings. */
export async function updateProviderSwitchSetting(view: KrenResultsViewProvider, key: 'llm.providerSwitch' | 'llm.providerOrder', value: string | number | boolean): Promise<void> {
  if (validatedPanelSetting(key, value) === undefined) return;
  await view.actions.updateSetting(key, value);
  postProviderSwitchSettings(view);
}
export function postProviderSwitchSettings(panel: KrenResultsViewPanel): void {
  const view = panel as KrenResultsViewProvider;
  void view.view?.webview.postMessage({ command: 'providerSwitchSettings', html: renderProviderSwitchSettings(view.actions.settings()) });
}

const TUTOR_PREPARED_PROMPT_SETTING_KEYS = new Set<KrenPanelSettingKey>([
  'tutor.questionOnly',
  'tutor.exampleCount',
  'tutor.sentenceLengthBand',
  'tutor.tolerance',
  'tutor.learnerLevel',
  'tutor.lessonMode',
  'tutor.explanationDepth',
  'tutor.annotationLevel',
  'tutor.includeCommonErrors',
  'tutor.axis.modality',
  'tutor.axis.function',
  'tutor.axis.englishVariety',
  'tutor.axis.otherOutputLanguage',
  'tutor.axis.domain',
  'tutor.axis.formality',
  'tutor.axis.voice',
  'tutor.axis.stance',
  'tutor.axis.perspective',
  'tutor.axis.rhetoricalMode'
]);



/** Restore declared tutor settings only; credentials and other features are outside this object. */
export async function resetTutorOwnedSettings(): Promise<void> {
  const config = vscode.workspace.getConfiguration('kren');
  for (const key of Object.keys(TUTOR_DEFAULTS.configuration)) {
    await config.update(key, undefined, vscode.ConfigurationTarget.Global);
  }
}

const tutorResetsInProgress = new WeakSet<KrenResultsViewProvider>();

export async function confirmTutorReset(view: KrenResultsViewProvider): Promise<void> {
    const state = view.tutorState;
    if (tutorResetsInProgress.has(view) || tutorResetBusy(state)) {
      // Changed 2026-10-18: V265, owner item I45, notify owns ignored results and
      // routes warnings through the same panel notice API without holding the queue.
      view.actions.notify('warning', tutorResetsInProgress.has(view)
        ? 'A tutor reset is already waiting for your choice or finishing. Finish that reset first.'
        : 'The tutor is finishing work. Try Reset again when it finishes.');
      return;
    }
    tutorResetsInProgress.add(view);
    try {
      const choice = await view.showWarningMessage(
        'Reset the AI English Tutor to its defaults?',
        { modal: true, detail: 'Reset panel keeps your model, microphone and voice settings. Reset everything also returns them to the defaults.' },
        'Reset panel',
        'Reset everything'
      );
      if (choice !== 'Reset panel' && choice !== 'Reset everything') return;
      // A batch may have started while the reset confirmation was open.
      cancelTutorReviewBatch(view);
      await releaseTutorConversationResources(view, true);
      cancelTutorSessionDictation(view);
      view.tutorConversationRawAnswers.clear();
      view.tutorPracticeDiagnosisController?.abort();
      view.tutorPracticeDiagnosisController = undefined;
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
      view.pendingTutorAnnouncement = 'AI English Tutor was reset.';
      // 2026-10-14: Reset owns focus, so an earlier result cannot fold the map again.
      view.pendingTutorResultFocus = undefined;
      view.pendingTutorTargetFocus = undefined;
      view.pendingTutorConversationFocus = false;
      view.tutorState = resetTutorSession(view.tutorState);
      // 2026-10-15: Configuration and availability redraws must carry the same reset.
      view.tutorResetDisclosure = { id: randomUUID(), all: choice === 'Reset everything' };
      if (choice === 'Reset everything') await resetTutorOwnedSettings();
      view.actions.writeTutorPreferences?.(tutorConversationPreferencesOf(view.tutorState.conversation));
      view.pendingTutorResetDisclosures = true;
      view.pendingTutorResetAllDisclosures = choice === 'Reset everything';
      if (choice === 'Reset everything') view.refresh();
      else view.render();
      view.actions.notify('information', 'AI English Tutor was reset.');
    } finally {
      tutorResetsInProgress.delete(view);
    }
  }

export async function confirmTutorLessonReset(view: KrenResultsViewProvider): Promise<void> {
  if (tutorLessonResetBusy(view.tutorState) || !view.tutorState.lesson) return;
  const choice = await view.showWarningMessage(
    'Reset the lesson? This clears the drafted lesson and its practice set, with your answers and reviews. Your learning-map targets, lesson question and conversation are kept.',
    { modal: true },
    'Reset'
  );
  if (choice !== 'Reset' || tutorLessonResetBusy(view.tutorState) || !view.tutorState.lesson) return;
  view.tutorPracticeDiagnosisController?.abort();
  view.tutorPracticeDiagnosisController = undefined;
  // Changed 2026-10-01: lesson Reset reuses Apply's generated-work clearing, keeping chat.
  const conversation = view.tutorState.conversation;
  view.tutorState = { ...resetTutorGeneratedWork(view.tutorState), conversation };
  view.pendingTutorAnnouncement = 'The lesson and practice were reset.';
  view.render();
  view.actions.notify('information', 'The lesson and practice were reset.');
}

export async function updateTutorSetting(view: KrenResultsViewProvider, 
    key: KrenPanelSettingKey,
    rawValue: string | number | boolean
  ): Promise<void> {
    const value = validatedPanelSetting(key, rawValue);
    if (value === undefined) {
      view.tutorState = {
        ...view.tutorState,
        selectionMessage: `KREN rejected an invalid value for ${key}.`
      };
      view.render();
      return;
    }
    const previousState = view.tutorState;
    const voiceSetting = key.startsWith('tutor.readAloud.') || key === 'tutor.speechProvider';
    const settings: TutorViewState['settings'] = {
      ...previousState.settings,
      axes: { ...previousState.settings.axes },
      routing: { ...previousState.settings.routing }
    };
    let selection = previousState.selection;
    let selectionMessage: string | undefined;
    if (key === 'tutor.questionOnly') {
      settings.questionOnly = Boolean(value);
      if (settings.questionOnly) {
        const converted = tutorQuestionOnlySelection(selection);
        const retainedIds = new Set(converted.map((target) => target.nodeId));
        const omitted = selection.find((target) => !retainedIds.has(target.nodeId));
        selection = converted;
        if (omitted) {
          const omittedLabel = findTrainingMapNode(omitted.nodeId)?.label ?? omitted.nodeId;
          selectionMessage = `${omittedLabel} was removed because a question-led lesson can use at most three Support targets.`;
        }
      }
    }
    if (key === 'tutor.exampleCount') settings.exampleCount = Number(value);
    if (key === 'tutor.sentenceLengthBand') {
      settings.sentenceBand = value as TutorViewState['settings']['sentenceBand'];
    }
    if (key === 'tutor.tolerance') settings.tolerance = Number(value);
    if (key === 'tutor.learnerLevel') {
      settings.learnerLevel = value as TutorViewState['settings']['learnerLevel'];
    }
    if (key === 'tutor.lessonMode') {
      settings.lessonMode = value as TutorViewState['settings']['lessonMode'];
    }
    if (key === 'tutor.explanationDepth') {
      settings.explanationDepth = value as TutorViewState['settings']['explanationDepth'];
    }
    if (key === 'tutor.annotationLevel') {
      settings.annotationLevel = value as TutorViewState['settings']['annotationLevel'];
    }
    if (key === 'tutor.includeCommonErrors') settings.includeCommonErrors = Boolean(value);
    if (key === 'tutor.exerciseCount') settings.exerciseCount = Number(value);
    const panelSettings = view.actions.settings();
    const previousPictureProvider = panelSettings.tutorPictureProvider;
    if (key === 'tutor.provider') {
      settings.routing.provider = value as TutorViewState['settings']['routing']['provider'];
      settings.routing.model = tutorModelForRoute(panelSettings, settings.routing.provider);
    }
    if (key === 'tutor.model' &&
        (settings.routing.provider !== 'gemini' || panelSettings.tutorProfile !== 'pro')) {
      settings.routing.model = String(value);
    }
    if (key === 'tutor.alternateModel' && settings.routing.provider === 'gemini' &&
        panelSettings.tutorProfile === 'pro') {
      settings.routing.model = String(value);
    }
    if (key === 'tutor.geminiProfile') {
      settings.routing.model = tutorModelForRoute(
        panelSettings,
        settings.routing.provider,
        value as TutorLanguageModelRoute['geminiProfile']
      );
    }
    if (key === 'tutor.thinkingOrEffort') {
      settings.routing.thinkingOrEffort = value as TutorViewState['settings']['routing']['thinkingOrEffort'];
    }
    // V140 moved the microphone controls into ADVANCED and they were left out of this list,
    // so choosing a sensitivity wrote nothing and the next render snapped it back to Balanced
    // while folding MODE. V146 added the third control, and V148 adds the Live language
    // control under Live model on 2026-09-24. A setting the panel draws must be storable.
    if (key === 'tutor.speechProvider' || key === 'tutor.provider' || key === 'tutor.model' || key === 'tutor.hintModel' ||
        key === 'tutor.alternateModel' ||
        key === 'tutor.liveModel' || key === 'tutor.pictureProvider' || key === 'tutor.imageModel' || key === 'tutor.cloudflareImageModel' ||
        key === 'tutor.thinkingOrEffort' || key === 'tutor.geminiProfile' ||
        key === 'tutor.fallbackEnabled' || key === 'tutor.fallbackModel' ||
        key === 'tutor.fallbackThinkingOrEffort' ||
        key === 'tutor.conversation.microphoneSensitivity' ||
        key === 'tutor.conversation.pauseBeforeReply' ||
        key === 'tutor.conversation.speechDetection' ||
        key === 'tutor.conversation.liveTranscriptionLanguage' ||
        key === 'tutor.conversation.microphoneCloseWait' ||
        key === 'tutor.conversation.hintPrefetch' || key === 'tutor.conversation.pictureStyle' || key === 'tutor.conversation.pressToTalk' || key === 'tutor.conversation.takeHome' || voiceSetting) {
      await view.actions.updateSetting(key, value);
    }
    // 2026-10-11: style applies to the next picture and preserves the active composer.
    if (key === 'tutor.conversation.pictureStyle') {
      postTutorPictureStyleSetting(view);
      return;
    }
    if (key === 'tutor.conversation.hintPrefetch') {
      postTutorHintPrefetchSetting(view, value === true);
      return;
    }
    if (key === 'tutor.conversation.takeHome') {
      if (value === false) {
        if (view.tutorState.conversation.takeHome?.busy) cancelTutorTakeHome(view);
        else stopTutorTakeHomeSpeech(view);
      }
      void view.view?.webview.postMessage({ command: 'tutorConversationTakeHomeSetting', value });
      return;
    }
    if (key === 'tutor.axis.modality') {
      settings.axes.modality = value as TutorViewState['settings']['axes']['modality'];
    }
    if (key === 'tutor.axis.function') {
      settings.axes.function = value as TutorViewState['settings']['axes']['function'];
    }
    if (key === 'tutor.axis.englishVariety') {
      settings.axes.englishVariety = value as TutorViewState['settings']['axes']['englishVariety'];
    }
    if (key === 'tutor.axis.otherOutputLanguage') {
      settings.axes.otherOutputLanguage = value as NonNullable<TutorViewState['settings']['axes']['otherOutputLanguage']>;
    }
    if (key === 'tutor.axis.domain') {
      settings.axes.domain = value as TutorViewState['settings']['axes']['domain'];
    }
    if (key === 'tutor.axis.formality') {
      settings.axes.formality = value as TutorViewState['settings']['axes']['formality'];
    }
    if (key === 'tutor.axis.voice') {
      settings.axes.voice = value as TutorViewState['settings']['axes']['voice'];
    }
    if (key === 'tutor.axis.stance') {
      settings.axes.stance = value as TutorViewState['settings']['axes']['stance'];
    }
    if (key === 'tutor.axis.perspective') {
      settings.axes.perspective = value as TutorViewState['settings']['axes']['perspective'];
    }
    if (key === 'tutor.axis.rhetoricalMode') {
      settings.axes.rhetoricalMode = value as TutorViewState['settings']['axes']['rhetoricalMode'];
    }
    const nextState: TutorViewState = {
      ...previousState,
      selection,
      settings,
      lessonStale: previousState.lessonStale ||
        Boolean(previousState.lesson && key !== 'tutor.exerciseCount' && !voiceSetting),
      selectionMessage
    };
    const promptSettingChanged = TUTOR_PREPARED_PROMPT_SETTING_KEYS.has(key) &&
      JSON.stringify(previousState.settings) !== JSON.stringify(settings);
    view.tutorState = promptSettingChanged
      ? regeneratePreparedPrompt(previousState, nextState)
      : nextState;
    if (key === 'tutor.pictureProvider') reconcileTutorPictureProviderChange(view, previousPictureProvider);
    // 2026-10-02: a next-conversation pause choice must preserve the active answer box.
    if (key === 'tutor.conversation.liveTranscriptionLanguage' && previousState.conversation.status === 'active') {
      if (view.view) void view.view.webview.postMessage({ command: 'tutorConversationLiveTranscriptionLanguage', value });
    } else if (key === 'tutor.conversation.speechDetection' && previousState.conversation.status === 'active') {
      if (view.view) void view.view.webview.postMessage({ command: 'tutorConversationSpeechDetection', value });
    } else if (key === 'tutor.conversation.pauseBeforeReply' && previousState.conversation.status === 'active') {
      if (view.view) void view.view.webview.postMessage({ command: 'tutorConversationPauseBeforeReply', seconds: value });
    } else if (voiceSetting || ['tutor.speechProvider', 'tutor.provider', 'tutor.model', 'tutor.alternateModel', 'tutor.geminiProfile',
        'tutor.hintModel', 'tutor.liveModel', 'tutor.pictureProvider', 'tutor.imageModel', 'tutor.cloudflareImageModel', 'tutor.fallbackEnabled',
        'tutor.fallbackModel', 'tutor.fallbackThinkingOrEffort', 'tutor.thinkingOrEffort'].includes(key)) {
      if (key === 'tutor.speechProvider') view.render(false, true, true);
      else view.render(false, true);
    } else if (previousState.conversation.status !== 'active' || !voiceSetting) view.render();
    if (key === 'tutor.pictureProvider') ensureTutorConversationPicture(view);
  }

// 2026-10-11: keep access to panel internals in this host module, as with provider changes.
export function postTutorPictureStyleSetting(panel: KrenResultsViewPanel): void {
  const view = panel as KrenResultsViewProvider;
  void view.view?.webview.postMessage({ command: 'tutorConversationPictureStyleSetting',
    value: view.actions.settings().tutorConversationPictureStyle ?? TUTOR_DEFAULTS.configuration['tutor.conversation.pictureStyle'] });
}

// 2026-10-10: one save can invoke both the configuration event and the panel handler.
const reconciledPictureProviders = new WeakMap<KrenResultsViewProvider, 'gemini' | 'cloudflare' | undefined>();

/** A replacement provider keeps the conversation's picture budget, but not the old failure lock. */
export function reconcileTutorPictureProviderChange(panel: KrenResultsViewPanel, previousProvider: 'gemini' | 'cloudflare' | undefined): void {
  // Only this host module reaches the internals of the panel created by activate().
  const view = panel as KrenResultsViewProvider;
  const currentProvider = view.actions.settings().tutorPictureProvider;
  const previous = reconciledPictureProviders.has(view) ? reconciledPictureProviders.get(view) : previousProvider;
  reconciledPictureProviders.set(view, currentProvider);
  if (previous === currentProvider) return;
  cancelTutorConversationPicture(view);
  view.tutorConversationPictureFailures = 0;
  view.tutorConversationPictureStopped = false;
  view.tutorState.conversation.picturePaused = undefined;
  void view.view?.webview.postMessage({ command: 'tutorPicturePaused', text: '' });
}


export async function previewTutorEdgeVoice(view: KrenResultsViewProvider): Promise<void> {
    const voice = view.actions.settings().tutorEdgeReadAloudVoice;
    try {
      await view.actions.readAloudText(
        'Hello, I am KREN, your English practice partner.', 'en', 'tutor', voice
      );
    } catch (error) {
      view.reportActionFailure('Preview tutor Edge voice', error, 'tutor Edge voice preview failed');
    }
  }

export async function updateTutorVoiceDefault(view: KrenResultsViewProvider, 
    command: Extract<ResultsViewCommand,
      'updateTutorEdgeFemaleVoice' | 'updateTutorEdgeMaleVoice' |
      'updateTutorGeminiFemaleVoice' | 'updateTutorGeminiMaleVoice'>,
    value: string
  ): Promise<void> {
    const definitions = {
      updateTutorEdgeFemaleVoice: ['tutor.readAloud.edgeFemaleVoice', 'edge', 'female'],
      updateTutorEdgeMaleVoice: ['tutor.readAloud.edgeMaleVoice', 'edge', 'male'],
      updateTutorGeminiFemaleVoice: ['tutor.liveFemaleVoice', 'gemini', 'female'],
      updateTutorGeminiMaleVoice: ['tutor.liveMaleVoice', 'gemini', 'male']
    } as const;
    const [key, source, gender] = definitions[command];
    const valid = source === 'edge'
      ? EDGE_SPEECH_LOCALES.filter((locale) => locale.id.startsWith('en-'))
        .some((locale) => locale.voices.some((voice) =>
          voice.id === value && voice.label.endsWith(
            `(${gender === 'female' ? 'Female' : 'Male'})`
          )))
      : TUTOR_LIVE_VOICES.some(([name, , voiceGender]) =>
        name === value && voiceGender === gender);
    if (!valid) {
      view.tutorState = {
        ...view.tutorState,
        selectionMessage: `KREN rejected an invalid value for ${key}.`
      };
      view.render();
      return;
    }
    // These four package-declared settings are deliberately reached only through these
    // bounded tutor commands. They never enter the shared panel-setting allowlist.
    await view.actions.updateTutorVoiceSetting(key, value);
    if (view.tutorState.conversation.status === 'active') view.render(false, true);
    else view.render();
  }

export async function previewTutorGeminiVoice(view: KrenResultsViewProvider): Promise<void> {
    if (view.actions.settings().tutorReadAloudProvider === 'googleChirp') {
      await view.actions.readAloudText('Hello, I am KREN, your English practice partner.', 'en', 'tutor',
        normalizedTutorLiveVoice(view.tutorState.conversation.liveVoice));
      return;
    }
    const controller = new AbortController();
    let stage = 'requesting a Live credential';
    let session: TutorLiveSession | undefined;
    let player: WindowsWaveOutSession | undefined;
    let failed = false;
    let audioDurationMs = 0;
    const fail = (reason: string): void => {
      if (failed) return;
      failed = true;
      // The reason names only KREN's stage or TutorLiveSessionError's fixed code. Provider
      // response text and the authenticated socket URL never cross this boundary.
      view.actions.log(`[tutor Gemini voice preview failed] ${reason}.`);
      view.actions.notify('error', 'KREN: The Gemini voice preview failed.');
    };
    try {
      const credential = await view.actions.generateTutor(
        tutorLiveSessionCredentialRequest(), tutorLanguageModelRoute(view), controller.signal
      );
      const apiKey = tutorLiveSessionCredential(credential);
      stage = 'starting the audio player';
      player = await view.waveOutPlayer.start(() => {
        fail('the audio player stopped');
        session?.close();
      });
      if (failed) return;
      stage = 'opening the Live session';
      session = new TutorLiveSession({
        apiKey,
        model: configuredTutorLiveModel(),
        voiceName: normalizedTutorLiveVoice(view.tutorState.conversation.liveVoice),
        systemInstruction: TUTOR_CONVERSATION_ENGLISH_ONLY_INSTRUCTION +
          'For this voice preview, say exactly the one short sentence the next turn requests.',
        socketFactory: view.tutorLiveSocketFactory,
        onText: () => undefined,
        onAudio: (chunk) => {
          if (failed || !player) return;
          try {
            player.play(chunk);
            audioDurationMs += Buffer.from(chunk.data, 'base64').byteLength /
              (pcmSampleRate(chunk.mimeType) * 2) * 1000;
          } catch {
            fail('the audio player rejected a chunk');
            session?.close();
          }
        }
      });
      await session.connect();
      stage = 'asking for the preview sentence';
      await session.sendTurn('Say exactly: "Hello, I am KREN, your English practice partner."');
      if (!failed && audioDurationMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(15_000, audioDurationMs)));
      }
    } catch (error) {
      const reason = error instanceof TutorLiveSessionError ? error.message : `${stage} failed`;
      fail(reason);
    } finally {
      controller.abort();
      session?.close();
      player?.close();
    }
  }


export function postTutorHintPrefetchSetting(panel: KrenResultsViewPanel, savedValue?: boolean): void {
  const view = panel as KrenResultsViewProvider;
  scheduleTutorConversationHintPrefetch(view);
  void view.view?.webview.postMessage({ command: 'tutorConversationHintPrefetchSetting',
    value: savedValue ?? view.actions.settings().tutorConversationHintPrefetch === true });
}

export function postLanguageModelUsage(panel: KrenResultsViewPanel): void {
  const view = panel as KrenResultsViewProvider;
  void view.view?.webview.postMessage({ command: 'languageModelUsage', html: renderLanguageModelUsage(languageModelUsageToday()) });
}
