import { TUTOR_DEFAULTS } from './tutor/defaults.js';
import { isReadAloudChirpVoice } from './readAloudChirp.js';
import { validProviderOrder } from './languageModelSwitching.js';
import { ALL_REWRITE_VARIANTS_ID, isRewriteVariantId } from './rewriteVariants.js';
import { isTutorPauseBeforeReply, isTutorSpeechDetection } from './tutorMicrophoneGate.js';
import {
  isRewriteAxisSetting,
  isRewriteOtherLanguage,
  REWRITE_DOMAINS
} from '@kren/core/rewrite-axes';
import {
  isTutorAnnotationLevel,
  isTutorExplanationDepth,
  isTutorLearnerLevel,
  isTutorLessonMode
} from '@kren/core/tutor';
import { isGrammarInputLanguage } from '@kren/core/contracts';
import { EDGE_SPEECH_LOCALES, isEdgeSpeechLocale } from '@kren/core/edge-speech';
import { isPlausibleLanguageCode } from './languages.js';
import {
  isLanguageModelIdentifier,
  isLanguageModelRoutingEffort,
  isLanguageModelRoutingProvider
} from './languageModelRouting.js';
import { isTutorSentenceBandId } from './tutor/state.js';
import { EXPLANATION_SAME_AS_SOURCE } from './types.js';

export type KrenPanelSettingKey =
  | 'llm.providerSwitch'
  | 'llm.providerOrder'
  | 'results.openAtStartup'
  | 'translationProvider'
  | 'translation.domain'
  | 'explanation.domain'
  | 'display.mode'
  | 'display.panelTheme'
  | 'request.timeoutMs'
  | 'translation.maxCharacters'
  | 'userDictionary.maxImportEntries'
  | 'translation.sourceLanguage'
  | 'translation.targetLanguage'
  | 'translation.provider'
  | 'translation.model'
  | 'translation.alternateModel'
  | 'translation.thinkingOrEffort'
  | 'translation.geminiProfile'
  | 'translation.fallbackEnabled'
  | 'translation.fallbackModel'
  | 'translation.fallbackThinkingOrEffort'
  | 'grammar.dialect'
  | 'grammar.smart'
  | 'grammar.autoCheck'
  | 'grammar.autoCheckDelayMs'
  | 'explanation.outputLanguage'
  | 'explanation.provider'
  | 'explanation.geminiProfile'
  | 'explanation.model'
  | 'explanation.alternateModel'
  | 'explanation.thinkingOrEffort'
  | 'explanation.fallbackEnabled'
  | 'explanation.fallbackModel'
  | 'explanation.fallbackThinkingOrEffort'
  | 'rewrite.provider'
  | 'rewrite.model'
  | 'rewrite.alternateModel'
  | 'rewrite.thinkingOrEffort'
  | 'rewrite.fallbackEnabled'
  | 'rewrite.fallbackModel'
  | 'rewrite.fallbackThinkingOrEffort'
  | 'rewrite.sourceLanguage'
  | 'rewrite.modality'
  | 'rewrite.function'
  | 'rewrite.englishVariety'
  | 'gemini.model'
  | 'gemini.customModels'
  | 'tutor.liveCustomModels'
  | 'gemini.thinkingLevel'
  | 'gemini.retry.enabled'
  | 'gemini.retry.maxAttempts'
  | 'openai.model'
  | 'groq.customModels'
  | 'cloudflare.customModels'
  | 'openai.customModels'
  | 'openai.reasoningEffort'
  | 'anthropic.model'
  | 'anthropic.customModels'
  | 'anthropic.effort'
  | 'languageModel.retry.enabled'
  | 'languageModel.retry.maxAttempts'
  | 'rewrite.geminiProfile'
  | 'gemini.alternateModel'
  | 'gemini.alternateThinkingLevel'
  | 'gemini.alternateFallbackEnabled'
  | 'gemini.alternateFallbackModel'
  | 'gemini.alternateFallbackThinkingLevel'
  | 'rewrite.quickMenuVariant'
  | 'rewrite.domain'
  | 'rewrite.formality'
  | 'rewrite.voice'
  | 'rewrite.stance'
  | 'rewrite.length'
  | 'rewrite.perspective'
  | 'rewrite.rhetoricalMode'
  | 'rewrite.preserveFormatting'
  | 'rewrite.includeChangeNotes'
  | 'rewrite.copyToClipboard'
  | 'rewrite.tts.enabled'
  | 'readAloud.voice'
  | 'readAloud.rate'
  | 'readAloud.volume'
  | 'readAloud.provider'
  | 'readAloud.chirpVoice'
  | 'readAloud.edgeLocale'
  | 'readAloud.edgeVoice'
  | 'readAloud.edgeRatePercent'
  | 'readAloud.edgePythonCommand'
  | 'dictionary.multiWordTranslationFallback'
  | 'pronunciation.windowsNativePlayback'
  | 'userDictionary.enabled'
  | 'userDictionary.defaultCaptureMode'
  | 'userDictionary.fallbackOnMerriamWebsterNoMatch'
  | 'userDictionary.provider'
  | 'userDictionary.model'
  | 'userDictionary.alternateModel'
  | 'userDictionary.thinkingOrEffort'
  | 'userDictionary.geminiProfile'
  | 'userDictionary.fallbackEnabled'
  | 'userDictionary.fallbackModel'
  | 'userDictionary.fallbackThinkingOrEffort'
  | 'userDictionary.entryLanguage'
  | 'userDictionary.includePronunciation'
  | 'userDictionary.includeSynonyms'
  | 'userDictionary.includeUsageNotes'
  | 'userDictionary.numberOfExamples'
  | 'userDictionary.includeTechnicalMeanings'
  | 'userDictionary.smartWordCapture'
  | 'rewrite.otherOutputLanguage'
  | 'tutor.questionOnly'
  | 'tutor.exampleCount'
  | 'tutor.sentenceLengthBand'
  | 'tutor.tolerance'
  | 'tutor.learnerLevel'
  | 'tutor.lessonMode'
  | 'tutor.explanationDepth'
  | 'tutor.annotationLevel'
  | 'tutor.includeCommonErrors'
  | 'tutor.exerciseCount'
  | 'tutor.axis.modality'
  | 'tutor.axis.function'
  | 'tutor.axis.englishVariety'
  | 'tutor.axis.otherOutputLanguage'
  | 'tutor.axis.domain'
  | 'tutor.axis.formality'
  | 'tutor.axis.voice'
  | 'tutor.axis.stance'
  | 'tutor.axis.perspective'
  | 'tutor.axis.rhetoricalMode'
  | 'tutor.provider'
  | 'tutor.model'
  | 'tutor.speechProvider'
  | 'tutor.hintModel'
  | 'tutor.pictureProvider'
  | 'tutor.cloudflareImageModel'
  | 'tutor.imageModel'
  | 'tutor.imageCustomModels'
  | 'tutor.liveModel'
  | 'tutor.alternateModel'
  | 'tutor.thinkingOrEffort'
  | 'tutor.geminiProfile'
  | 'tutor.fallbackEnabled'
  | 'tutor.fallbackModel'
  | 'tutor.fallbackThinkingOrEffort'
  | 'tutor.readAloud.provider'
  | 'tutor.readAloud.edgeLocale'
  | 'tutor.readAloud.edgeVoice'
  | 'tutor.readAloud.edgeRatePercent'
  | 'tutor.readAloud.voice'
  | 'tutor.readAloud.rate'
  | 'tutor.readAloud.volume'
  | 'tutor.conversation.microphoneSensitivity'
  | 'tutor.conversation.pauseBeforeReply'
  | 'tutor.conversation.speechDetection'
  | 'tutor.conversation.liveTranscriptionLanguage'
  | 'tutor.conversation.microphoneCloseWait'
  | 'tutor.conversation.pictureStyle'
  | 'tutor.conversation.pressToTalk'
  | 'tutor.conversation.takeHome'
  | 'tutor.conversation.hintPrefetch';

/**
 * Exported so a test can walk it. Every key here must have a matching branch in
 * validatedPanelSetting, and twice now one has not: grammar.dialect rejected Auto-detect,
 * and rewrite.otherOutputLanguage rejected every language, because a string key with no
 * branch falls through to the boolean fallback and is refused. The allow-list and the
 * validator are two lists of the same keys, so a test compares them.
 */
export const PANEL_SETTING_KEYS = new Set<KrenPanelSettingKey>([
  'llm.providerSwitch', 'llm.providerOrder',
  'results.openAtStartup',
  'translationProvider',
  'translation.domain',
  'explanation.domain',
  'display.mode',
  'display.panelTheme',
  'request.timeoutMs',
  'translation.maxCharacters',
  'userDictionary.maxImportEntries',
  'translation.sourceLanguage',
  'translation.targetLanguage',
  'translation.provider',
  'translation.model',
  'translation.alternateModel',
  'translation.thinkingOrEffort',
  'translation.geminiProfile',
  'translation.fallbackEnabled',
  'translation.fallbackModel',
  'translation.fallbackThinkingOrEffort',
  'grammar.dialect',
  'grammar.smart',
  'grammar.autoCheck',
  'grammar.autoCheckDelayMs',
  'explanation.outputLanguage',
  'explanation.provider',
  'explanation.geminiProfile',
  'explanation.model',
  'explanation.alternateModel',
  'explanation.thinkingOrEffort',
  'explanation.fallbackEnabled',
  'explanation.fallbackModel',
  'explanation.fallbackThinkingOrEffort',
  'rewrite.provider',
  'rewrite.model',
  'rewrite.alternateModel',
  'rewrite.thinkingOrEffort',
  'rewrite.fallbackEnabled',
  'rewrite.fallbackModel',
  'rewrite.fallbackThinkingOrEffort',
  'rewrite.sourceLanguage',
  'rewrite.modality',
  'rewrite.function',
  'rewrite.englishVariety',
  'gemini.model',
  'gemini.customModels',
  'tutor.liveCustomModels',
  'gemini.thinkingLevel',
  'gemini.retry.enabled',
  'gemini.retry.maxAttempts',
  'openai.model',
  'groq.customModels',
  'cloudflare.customModels',
  'openai.customModels',
  'openai.reasoningEffort',
  'anthropic.model',
  'anthropic.customModels',
  'anthropic.effort',
  'languageModel.retry.enabled',
  'languageModel.retry.maxAttempts',
  'rewrite.geminiProfile',
  'gemini.alternateModel',
  'gemini.alternateThinkingLevel',
  'gemini.alternateFallbackEnabled',
  'gemini.alternateFallbackModel',
  'gemini.alternateFallbackThinkingLevel',
  'rewrite.quickMenuVariant',
  'rewrite.domain',
  'rewrite.formality',
  'rewrite.voice',
  'rewrite.stance',
  'rewrite.length',
  'rewrite.perspective',
  'rewrite.rhetoricalMode',
  'rewrite.preserveFormatting',
  'rewrite.includeChangeNotes',
  'rewrite.copyToClipboard',
  'rewrite.tts.enabled',
  'readAloud.voice',
  'readAloud.rate',
  'readAloud.volume',
  'readAloud.provider',
  'readAloud.chirpVoice',
  'readAloud.edgeLocale',
  'readAloud.edgeVoice',
  'readAloud.edgeRatePercent',
  'readAloud.edgePythonCommand',
  'dictionary.multiWordTranslationFallback',
  'pronunciation.windowsNativePlayback'
  ,'userDictionary.enabled'
  ,'userDictionary.defaultCaptureMode'
  ,'userDictionary.fallbackOnMerriamWebsterNoMatch'
  ,'userDictionary.provider'
  ,'userDictionary.model'
  ,'userDictionary.alternateModel'
  ,'userDictionary.thinkingOrEffort'
  ,'userDictionary.geminiProfile'
  ,'userDictionary.fallbackEnabled'
  ,'userDictionary.fallbackModel'
  ,'userDictionary.fallbackThinkingOrEffort'
  ,'userDictionary.entryLanguage'
  ,'userDictionary.includePronunciation'
  ,'userDictionary.includeSynonyms'
  ,'userDictionary.includeUsageNotes'
  ,'userDictionary.numberOfExamples'
  ,'userDictionary.includeTechnicalMeanings'
  ,'userDictionary.smartWordCapture'
  ,'rewrite.otherOutputLanguage'
  ,'tutor.questionOnly'
  ,'tutor.exampleCount'
  ,'tutor.sentenceLengthBand'
  ,'tutor.tolerance'
  ,'tutor.learnerLevel'
  ,'tutor.lessonMode'
  ,'tutor.explanationDepth'
  ,'tutor.annotationLevel'
  ,'tutor.includeCommonErrors'
  ,'tutor.exerciseCount'
  ,'tutor.axis.modality'
  ,'tutor.axis.function'
  ,'tutor.axis.englishVariety'
  ,'tutor.axis.otherOutputLanguage'
  ,'tutor.axis.domain'
  ,'tutor.axis.formality'
  ,'tutor.axis.voice'
  ,'tutor.axis.stance'
  ,'tutor.axis.perspective'
  ,'tutor.axis.rhetoricalMode'
  ,'tutor.provider'
  ,'tutor.model'
  ,'tutor.speechProvider'
  ,'tutor.hintModel'
  ,'tutor.pictureProvider'
  ,'tutor.cloudflareImageModel'
  ,'tutor.imageModel'
  ,'tutor.imageCustomModels'
  ,'tutor.liveModel'
  ,'tutor.alternateModel'
  ,'tutor.thinkingOrEffort'
  ,'tutor.geminiProfile'
  ,'tutor.fallbackEnabled'
  ,'tutor.fallbackModel'
  ,'tutor.fallbackThinkingOrEffort'
  ,'tutor.readAloud.provider'
  ,'tutor.readAloud.edgeLocale'
  ,'tutor.readAloud.edgeVoice'
  ,'tutor.readAloud.edgeRatePercent'
  ,'tutor.readAloud.voice'
  ,'tutor.readAloud.rate'
  ,'tutor.readAloud.volume'
  ,'tutor.conversation.microphoneSensitivity'
  ,'tutor.conversation.pauseBeforeReply'
  ,'tutor.conversation.speechDetection'
  ,'tutor.conversation.liveTranscriptionLanguage'
  ,'tutor.conversation.microphoneCloseWait'
  ,'tutor.conversation.pictureStyle'
  ,'tutor.conversation.pressToTalk'
  ,'tutor.conversation.takeHome'
  ,'tutor.conversation.hintPrefetch'
]);

/**
 * The speech source a fresh install uses.
 *
 * Microsoft Edge Online as of 2026-08-24. It reads twenty languages where Local Windows
 * reads whichever voices the machine happens to have installed, which on most machines is
 * English alone. Stated once here rather than as a literal at each reader, because the
 * manifest default and the two code defaults were three copies of one decision.
 */
export const READ_ALOUD_PROVIDER_DEFAULT = 'edgeOnline';
export const READ_ALOUD_EDGE_VOICE_DEFAULT = 'en-US-ChristopherNeural';
export const RESULTS_OPEN_AT_STARTUP_DEFAULT = true;

export const CLOUDFLARE_IMAGE_MODEL_DEFAULT = '@cf/black-forest-labs/flux-1-schnell';
export const CLOUDFLARE_IMAGE_MODELS: Array<[string, string]> = [
  [CLOUDFLARE_IMAGE_MODEL_DEFAULT, 'FLUX.1 schnell'],
  ['@cf/black-forest-labs/flux-2-klein-4b', 'FLUX.2 klein 4B']
];

export const TUTOR_LIVE_MODEL_DEFAULT = TUTOR_DEFAULTS.configuration['tutor.liveModel'];

/**
 * Live identifiers known on 2026-09-21. Discovery intentionally excludes streaming models
 * from ordinary Gemini lists, so this named list is the safe seed for the separate Live picker.
 */
export const KNOWN_TUTOR_LIVE_MODEL_IDS = [TUTOR_LIVE_MODEL_DEFAULT] as const;

export function isTutorLiveModelIdentifier(value: string): boolean {
  return KNOWN_TUTOR_LIVE_MODEL_IDS.some((id) => id === value) ||
    /(?:^|[-_.])live(?:$|[-_.])/iu.test(value);
}

/** One-way migration decision: an explicitly stored Live list, including `[]`, wins. */
export function migratedTutorLiveCustomModels(
  ordinaryStored: string | undefined,
  liveStored: string | undefined
): string | undefined {
  return liveStored === undefined ? ordinaryStored : undefined;
}

/**
 * The value a panel control may write to a setting, or undefined to refuse it.
 *
 * Lifted out of extension.ts on 2026-08-24, after the same defect shipped twice: a string
 * setting whose key has no branch here falls through to the boolean fallback at the bottom
 * and is refused, so the panel shows "KREN rejected an invalid value" and snaps the control
 * back. grammar.dialect did it with Auto-detect, and rewrite.otherOutputLanguage did it with
 * every language on the list.
 *
 * It lived in a module that imports vscode, so nothing could test it. It is pure, it now
 * lives here, and panelCommandAllowList.test.ts walks every key in PANEL_SETTING_KEYS
 * against it. That closes the class rather than the two instances.
 */
/**
 * A whole number inside the manifest's own range, or undefined.
 *
 * A number control posts whatever was typed, including a fraction or a value past its own
 * `min` and `max`, because those attributes are a hint to the browser rather than a
 * guarantee to the extension. Everything arriving from the webview is input.
 */
function boundedInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) return undefined;
  return numeric >= minimum && numeric <= maximum ? numeric : undefined;
}

export function customModelIdentifiers(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length > 100) return [];
    const models: string[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'string') return [];
      const model = entry.trim();
      if (model === 'nonsense' || model.length > 200 || !isLanguageModelIdentifier(model)) return [];
      if (!models.includes(model)) models.push(model);
    }
    return models;
  } catch {
    return [];
  }
}

export function validatedPanelSetting(
  key: KrenPanelSettingKey,
  value: string | number | boolean
): string | number | boolean | undefined {
  if (!PANEL_SETTING_KEYS.has(key)) return undefined;
  if (key === 'llm.providerSwitch') return typeof value === 'boolean' ? value : undefined;
  if (key === 'llm.providerOrder') {
    try { const order: unknown = typeof value === 'string' ? JSON.parse(value) : undefined;
      return validProviderOrder(order) ? JSON.stringify(order) : undefined;
    } catch { return undefined; }
  }
  if (key === 'tutor.conversation.liveTranscriptionLanguage') {
    return value === 'english' || value === 'automatic' ? value : undefined;
  }
  if (key === 'tutor.conversation.microphoneSensitivity') {
    return value === 'quietRoom' || value === 'balanced' || value === 'noisyRoom'
      ? value
      : undefined;
  }
  if (key === 'tutor.speechProvider') {
    return typeof value === 'string' && ['auto', 'handy', 'cloudflare', 'groq', 'gemini', 'off'].includes(value) ? value : undefined;
  }
  if (key === 'tutor.conversation.microphoneCloseWait') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return numeric === 2 || numeric === 4 || numeric === 6 || numeric === 8
      ? numeric
      : undefined;
  }
  if (key === 'tutor.conversation.speechDetection') {
    return isTutorSpeechDetection(value) ? value : undefined;
  }
  if (key === 'tutor.conversation.pauseBeforeReply') {
    const numeric = typeof value === 'string' && /^[1-5]$/u.test(value)
      ? Number(value) : value;
    return isTutorPauseBeforeReply(numeric) ? numeric : undefined;
  }
  if (key === 'tutor.conversation.pressToTalk' || key === 'tutor.conversation.takeHome' || key === 'tutor.conversation.hintPrefetch') {
    return typeof value === 'boolean' ? value : undefined;
  }
  if (key === 'tutor.imageCustomModels' || key === 'gemini.customModels' || key === 'tutor.liveCustomModels' ||
      key === 'openai.customModels' || key === 'groq.customModels' || key === 'cloudflare.customModels' ||
      key === 'anthropic.customModels') {
    if (typeof value !== 'string') return undefined;
    const models = customModelIdentifiers(value);
    return value === JSON.stringify(models) ? value : undefined;
  }
  if (key === 'tutor.exampleCount' || key === 'tutor.exerciseCount') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(numeric) && numeric >= 1 && numeric <= 20 ? numeric : undefined;
  }
  if (key === 'tutor.tolerance') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(numeric) && numeric >= 0 ? numeric : undefined;
  }
  if (key === 'tutor.sentenceLengthBand') {
    return isTutorSentenceBandId(value) ? value : undefined;
  }
  if (key === 'tutor.learnerLevel') {
    return isTutorLearnerLevel(value) ? value : undefined;
  }
  if (key === 'tutor.lessonMode') {
    return isTutorLessonMode(value) ? value : undefined;
  }
  if (key === 'tutor.explanationDepth') {
    return isTutorExplanationDepth(value) ? value : undefined;
  }
  if (key === 'tutor.annotationLevel') {
    return isTutorAnnotationLevel(value) ? value : undefined;
  }
  if (key === 'tutor.provider') {
    return isLanguageModelRoutingProvider(value) ? value : undefined;
  }
  if (key === 'tutor.thinkingOrEffort') {
    return isLanguageModelRoutingEffort(value) ? value : undefined;
  }
  if (key === 'tutor.geminiProfile') {
    return value === 'standard' || value === 'pro' ? value : undefined;
  }
  if (key === 'tutor.fallbackThinkingOrEffort') {
    return isLanguageModelRoutingEffort(value) ? value : undefined;
  }
  if (key === 'tutor.hintModel') {
    if (typeof value !== 'string') return undefined;
    return value.trim() === '' || (value !== 'nonsense' && isLanguageModelIdentifier(value))
      ? value.trim()
      : undefined;
  }
  if (key === 'tutor.conversation.pictureStyle') return value === 'realistic' || value === 'illustrated' ? value : undefined;
  if (key === 'tutor.pictureProvider') return value === 'gemini' || value === 'cloudflare' ? value : undefined;
  if (key === 'tutor.cloudflareImageModel') return CLOUDFLARE_IMAGE_MODELS.some(([id]) => value === id) ? value : undefined;
  if (key === 'tutor.model' || key === 'tutor.liveModel' || key === 'tutor.alternateModel' ||
      key === 'tutor.fallbackModel' || key === 'tutor.imageModel') {
    return value !== 'nonsense' && isLanguageModelIdentifier(value)
      ? (value as string).trim()
      : undefined;
  }
  if (key === 'tutor.readAloud.provider') {
    return value === 'windowsLocal' || value === 'edgeOnline' || value === 'googleChirp' ? value : undefined;
  }
  if (key === 'tutor.readAloud.edgeLocale') {
    return typeof value === 'string' && value.startsWith('en-') &&
      EDGE_SPEECH_LOCALES.some((locale) => locale.id === value)
      ? value
      : undefined;
  }
  if (key === 'tutor.readAloud.edgeVoice') {
    return typeof value === 'string' && value.trim().startsWith('en-') &&
      /^[A-Za-z0-9-]{3,100}$/u.test(value.trim())
      ? value.trim()
      : undefined;
  }
  if (key === 'tutor.readAloud.voice') {
    return typeof value === 'string' && value.length <= 200 ? value : undefined;
  }
  if (key === 'tutor.readAloud.edgeRatePercent') {
    return boundedInteger(value, -50, 100);
  }
  if (key === 'tutor.readAloud.rate') return boundedInteger(value, -10, 10);
  if (key === 'tutor.readAloud.volume') return boundedInteger(value, 0, 100);
  if (key.startsWith('tutor.axis.')) {
    const axis = key.slice('tutor.axis.'.length);
    if (axis === 'otherOutputLanguage') {
      return isRewriteOtherLanguage(value) ? value : undefined;
    }
    return isRewriteAxisSetting(`rewrite.${axis}`, value) ? value : undefined;
  }
  if (key === 'userDictionary.defaultCaptureMode') {
    return value === 'llmOnly' || value === 'merriamWebsterAndLlm' ? value : undefined;
  }
  if (key === 'userDictionary.provider' || key === 'translation.provider' ||
      key === 'explanation.provider' || key === 'rewrite.provider') {
    return isLanguageModelRoutingProvider(value) ? value : undefined;
  }
  if (key === 'userDictionary.thinkingOrEffort' || key === 'translation.thinkingOrEffort' ||
      key === 'explanation.thinkingOrEffort' || key === 'rewrite.thinkingOrEffort' ||
      key === 'userDictionary.fallbackThinkingOrEffort' ||
      key === 'translation.fallbackThinkingOrEffort' ||
      key === 'explanation.fallbackThinkingOrEffort' ||
      key === 'rewrite.fallbackThinkingOrEffort') {
    return isLanguageModelRoutingEffort(value) ? value : undefined;
  }
  if (key === 'userDictionary.numberOfExamples') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return [0, 1, 2, 3].includes(numeric) ? numeric : undefined;
  }
  if (key === 'userDictionary.entryLanguage') {
    return typeof value === 'string' &&
      (value.trim() === 'auto' || isPlausibleLanguageCode(value.trim()))
      ? value.trim()
      : undefined;
  }
  if (key === 'userDictionary.model' || key === 'translation.model' ||
      key === 'explanation.model' || key === 'rewrite.model' ||
      key === 'userDictionary.alternateModel' || key === 'translation.alternateModel' ||
      key === 'explanation.alternateModel' || key === 'rewrite.alternateModel' ||
      key === 'userDictionary.fallbackModel' || key === 'translation.fallbackModel' ||
      key === 'explanation.fallbackModel' || key === 'rewrite.fallbackModel') {
    return value !== 'nonsense' && isLanguageModelIdentifier(value)
      ? (value as string).trim()
      : undefined;
  }
  if (key === 'translationProvider') {
    return value === 'googleCloudTranslation' || value === 'gemini' ? value : undefined;
  }
  /*
   * The four settings that had no control until 1.7.11. They were reachable only through
   * VS Code's own settings screen, and the panel's route to that screen went with the
   * button renamed to Reset KREN in 1.7.8, so for three versions they were unreachable
   * from KREN entirely.
   *
   * Every bound is the manifest's own, because a control that offers a value the setting
   * refuses snaps back with an error and looks broken.
   */
  if (key === 'translation.domain' || key === 'explanation.domain') {
    // Against the shared axis, so the three features naming a subject area cannot drift.
    return REWRITE_DOMAINS.some((option) => option.id === value) ? value as string : undefined;
  }
  if (key === 'display.panelTheme') {
    return ['followVSCode', 'light', 'dark'].includes(String(value)) ? String(value) : undefined;
  }
  if (key === 'display.mode') {
    return value === 'hover' || value === 'quickPick' || value === 'details'
      ? value
      : undefined;
  }
  if (key === 'request.timeoutMs') {
    return boundedInteger(value, 1000, 120000);
  }
  if (key === 'translation.maxCharacters') {
    return boundedInteger(value, 1, 20000);
  }
  if (key === 'userDictionary.maxImportEntries') {
    return boundedInteger(value, 1, 100000);
  }
  if (key === 'translation.sourceLanguage') {
    // 'auto' or one of the languages the shared catalog carries. Anything else would be
    // sent to a provider as a source hint it cannot honour.
    return typeof value === 'string' &&
      (value.trim() === 'auto' || isPlausibleLanguageCode(value.trim()))
      ? value.trim()
      : undefined;
  }
  if (key === 'translation.targetLanguage') {
    return typeof value === 'string' &&
      isPlausibleLanguageCode(value.trim())
      ? value.trim()
      : undefined;
  }
  if (key === 'explanation.outputLanguage') {
    return typeof value === 'string' &&
      (value.trim() === EXPLANATION_SAME_AS_SOURCE ||
        isPlausibleLanguageCode(value.trim()))
      ? value.trim()
      : undefined;
  }
  if (key === 'grammar.dialect') {
    // Derived rather than listed. This was a hand-written second copy of the enum, so
    // adding Auto-detect to the setting, the panel select, and the manifest still left the
    // panel rejecting it with "KREN rejected an invalid value for grammar.dialect" and
    // snapping the control back to American English.
    return isGrammarInputLanguage(value) ? value : undefined;
  }
  if (key === 'grammar.autoCheckDelayMs') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return [500, 900, 1500, 2500].includes(numeric) ? numeric : undefined;
  }
  if (key === 'gemini.model' || key === 'gemini.alternateModel' ||
      key === 'gemini.alternateFallbackModel' || key === 'openai.model' ||
      key === 'anthropic.model') {
    return typeof value === 'string' && isLanguageModelIdentifier(value.trim())
      ? value.trim()
      : undefined;
  }
  if (key === 'gemini.thinkingLevel') {
    return typeof value === 'string' &&
      ['auto', 'minimal', 'low', 'medium', 'high'].includes(value)
      ? value
      : undefined;
  }
  if (key === 'openai.reasoningEffort') {
    return typeof value === 'string' &&
      ['auto', 'none', 'low', 'medium', 'high'].includes(value)
      ? value
      : undefined;
  }
  if (key === 'anthropic.effort') {
    return typeof value === 'string' && ['auto', 'low', 'medium', 'high'].includes(value)
      ? value
      : undefined;
  }
  if (key === 'translation.geminiProfile' || key === 'explanation.geminiProfile' ||
      key === 'rewrite.geminiProfile' || key === 'userDictionary.geminiProfile') {
    return value === 'standard' || value === 'pro' ? value : undefined;
  }
  if (key === 'gemini.alternateThinkingLevel') {
    return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
  }
  if (key === 'gemini.alternateFallbackThinkingLevel') {
    return typeof value === 'string' &&
      ['auto', 'minimal', 'low', 'medium', 'high'].includes(value)
      ? value
      : undefined;
  }
  if (key === 'rewrite.quickMenuVariant') {
    return value === ALL_REWRITE_VARIANTS_ID || isRewriteVariantId(value) ? value : undefined;
  }
  if (key.startsWith('rewrite.') && isRewriteAxisSetting(key, value)) return value;
  // Not an axis: it carries no instruction of its own and its default is not the first entry
  // in its list, so REWRITE_AXIS_SETTINGS cannot carry it and the generic branch above never
  // sees it. Without this the panel refused every language with "KREN rejected an invalid
  // value for rewrite.otherOutputLanguage".
  if (key === 'rewrite.otherOutputLanguage') {
    return isRewriteOtherLanguage(value) ? value : undefined;
  }
  if (key === 'rewrite.sourceLanguage') {
    return typeof value === 'string' &&
      (value.trim() === 'auto' || isPlausibleLanguageCode(value.trim()))
      ? value.trim()
      : undefined;
  }
  if (key === 'gemini.retry.maxAttempts' || key === 'languageModel.retry.maxAttempts') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(numeric) && numeric >= 1 && numeric <= 5 ? numeric : undefined;
  }
  if (key === 'readAloud.voice') {
    return typeof value === 'string' && value.length <= 200 ? value : undefined;
  }
  if (key === 'readAloud.provider') {
    return value === 'windowsLocal' || value === 'edgeOnline' || value === 'googleChirp' ? value : undefined;
  }
  if (key === 'readAloud.chirpVoice') return isReadAloudChirpVoice(value) ? value : undefined;
  if (key === 'readAloud.edgeLocale') {
    return isEdgeSpeechLocale(value) ? value : undefined;
  }
  if (key === 'readAloud.edgeVoice') {
    return typeof value === 'string' && /^[A-Za-z0-9-]{3,100}$/u.test(value.trim())
      ? value.trim()
      : undefined;
  }
  if (key === 'readAloud.edgeRatePercent') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(numeric) && numeric >= -50 && numeric <= 100
      ? numeric
      : undefined;
  }
  if (key === 'readAloud.edgePythonCommand') {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 500 &&
      !/[\r\n\0]/u.test(value) ? value.trim() : undefined;
  }
  if (key === 'readAloud.rate') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(numeric) && numeric >= -10 && numeric <= 10 ? numeric : undefined;
  }
  if (key === 'readAloud.volume') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 100 ? numeric : undefined;
  }
  return typeof value === 'boolean' ? value : undefined;
}
