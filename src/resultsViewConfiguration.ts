import { normalizeGeminiModel } from './providers/geminiModels.js';
import { routedModel } from './providers/openAICompatible.js';
import { TUTOR_DEFAULTS } from './tutor/defaults.js';
import * as vscode from 'vscode';
import { TUTOR_LIVE_MODEL_DEFAULT, validatedPanelSetting } from './panelSettings.js';
import type { KrenPanelSettings } from './resultViewHtml.js';
import type { TutorLanguageModelRoute } from './operations.js';
import { TUTOR_ROUTING_DEFAULTS, type TutorSpeechProvider } from './tutor/state.js';
import { isTutorMicrophoneSensitivity, isTutorPauseBeforeReply, isTutorSpeechDetection, type TutorSpeechDetection, type TutorMicrophoneSensitivity, type TutorPauseBeforeReply } from './tutorMicrophoneGate.js';

export const TUTOR_HINT_MODEL_DEFAULT = TUTOR_DEFAULTS.configuration['tutor.hintModel'];

function configuredTutorSpeechProvider(): TutorSpeechProvider {
  const value = vscode.workspace?.getConfiguration?.('kren')
    .get<unknown>('tutor.speechProvider', TUTOR_DEFAULTS.configuration['tutor.speechProvider']);
  return value === 'handy' || value === 'cloudflare' || value === 'groq' || value === 'gemini' || value === 'off' ? value : 'auto';
}

function configuredTutorLiveModel(): string {
  const configured = vscode.workspace?.getConfiguration?.('kren')
    .get<unknown>('tutor.liveModel', TUTOR_DEFAULTS.configuration['tutor.liveModel']);
  const validated = validatedPanelSetting('tutor.liveModel', String(configured));
  return typeof validated === 'string' ? validated : TUTOR_LIVE_MODEL_DEFAULT;
}

function configuredTutorHintModel(): string {
  const configured = vscode.workspace?.getConfiguration?.('kren')
    .get<unknown>('tutor.hintModel', TUTOR_DEFAULTS.configuration['tutor.hintModel']);
  const validated = validatedPanelSetting('tutor.hintModel', String(configured));
  return typeof validated === 'string' ? normalizeGeminiModel(validated) : TUTOR_HINT_MODEL_DEFAULT;
}

function configuredTutorLiveTranscriptionLanguage(): 'english' | 'automatic' {
  const configured = vscode.workspace?.getConfiguration?.('kren')
    .get<unknown>('tutor.conversation.liveTranscriptionLanguage', TUTOR_DEFAULTS.configuration['tutor.conversation.liveTranscriptionLanguage']);
  return configured === 'automatic' ? 'automatic' : 'english';
}

/** The ordinary tutor model slot belonging to the provider and Gemini profile in force. */
function tutorModelForRoute(
  settings: KrenPanelSettings,
  provider: TutorLanguageModelRoute['provider'] = settings.tutorProvider,
  profile: TutorLanguageModelRoute['geminiProfile'] = settings.tutorProfile
): string {
  const alternate = provider === 'gemini' && profile === 'pro';
  const model = alternate ? settings.tutorAlternateModel : settings.tutorModel;
  return routedModel(provider, (model ?? (alternate ? TUTOR_DEFAULTS.configuration['tutor.alternateModel'] : TUTOR_ROUTING_DEFAULTS.model)).trim());
}

function configuredTutorPressToTalk(): boolean {
  return vscode.workspace?.getConfiguration?.('kren')
    .get<unknown>('tutor.conversation.pressToTalk', TUTOR_DEFAULTS.configuration['tutor.conversation.pressToTalk']) === true;
}

function configuredTutorMicrophoneSensitivity(): TutorMicrophoneSensitivity {
  const value = vscode.workspace?.getConfiguration?.('kren')
    .get<unknown>('tutor.conversation.microphoneSensitivity', TUTOR_DEFAULTS.configuration['tutor.conversation.microphoneSensitivity']);
  return isTutorMicrophoneSensitivity(value) ? value : TUTOR_DEFAULTS.configuration['tutor.conversation.microphoneSensitivity'];
}

function configuredTutorMicrophoneCloseWait(): number {
  const value = vscode.workspace?.getConfiguration?.('kren')
    .get<unknown>('tutor.conversation.microphoneCloseWait', TUTOR_DEFAULTS.configuration['tutor.conversation.microphoneCloseWait']);
  return value === 2 || value === 4 || value === 6 || value === 8
    ? value
    : TUTOR_DEFAULTS.configuration['tutor.conversation.microphoneCloseWait'];
}

function configuredTutorPauseBeforeReply(): TutorPauseBeforeReply {
  const value = vscode.workspace?.getConfiguration?.('kren')
    .get<unknown>('tutor.conversation.pauseBeforeReply', TUTOR_DEFAULTS.configuration['tutor.conversation.pauseBeforeReply']);
  return isTutorPauseBeforeReply(value) ? value : TUTOR_DEFAULTS.configuration['tutor.conversation.pauseBeforeReply'];
}


function configuredTutorSpeechDetection(): TutorSpeechDetection {
  const value = vscode.workspace?.getConfiguration?.('kren')
    .get<unknown>('tutor.conversation.speechDetection', TUTOR_DEFAULTS.configuration['tutor.conversation.speechDetection']);
  return isTutorSpeechDetection(value) ? value : TUTOR_DEFAULTS.configuration['tutor.conversation.speechDetection'];
}

export { configuredTutorSpeechDetection, configuredTutorSpeechProvider, configuredTutorLiveModel, configuredTutorHintModel, configuredTutorLiveTranscriptionLanguage, tutorModelForRoute, configuredTutorPressToTalk, configuredTutorMicrophoneSensitivity, configuredTutorMicrophoneCloseWait, configuredTutorPauseBeforeReply };
