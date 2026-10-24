import { REWRITE_AXIS_DEFAULTS } from '@kren/core/rewrite-axes';
import { TUTOR_SITUATIONS } from '@kren/core/tutor';

/** Current tutor defaults, shared by initialization, preference fallback and reset. */
export const TUTOR_DEFAULTS = {
  configuration: {
    "tutor.provider": "gemini",
    "tutor.speechProvider": "auto",
    "tutor.conversation.pressToTalk": false,
    "tutor.conversation.pictureStyle": "realistic",
    "tutor.conversation.takeHome": true,
    "tutor.conversation.hintPrefetch": false,
    "tutor.conversation.microphoneSensitivity": "balanced",
    "tutor.conversation.speechDetection": "geminiKren",
    "tutor.conversation.pauseBeforeReply": 2,
    "tutor.conversation.microphoneCloseWait": 4,
    "tutor.readAloud.provider": "googleChirp",
    "tutor.readAloud.edgeLocale": "en-US",
    "tutor.readAloud.edgeVoice": "en-US-ChristopherNeural",
    "tutor.readAloud.edgeFemaleVoice": "en-US-AvaNeural",
    "tutor.readAloud.edgeMaleVoice": "en-US-ChristopherNeural",
    "tutor.readAloud.edgeRatePercent": 0,
    "tutor.readAloud.voice": "Microsoft David Desktop",
    "tutor.readAloud.rate": 0,
    "tutor.readAloud.volume": 100,
    "tutor.readAloud.sentencePauseMilliseconds": 0,
    "tutor.model": "gemini-3.8-flash",
    "tutor.hintModel": "gemini-3.5-flash-lite",
    "tutor.hintThinkingOrEffort": "auto",
    "tutor.liveGeminiProfile": "standard",
    "tutor.liveModel": "gemini-3.8-live",
    "tutor.conversation.liveTranscriptionLanguage": "english",
    "tutor.liveCustomModels": "[]",
    "tutor.liveFemaleVoice": "Callirrhoe",
    "tutor.liveMaleVoice": "Enceladus",
    "tutor.alternateModel": "gemini-3.8-flash",
    "tutor.thinkingOrEffort": "auto",
    "tutor.geminiProfile": "standard",
    "tutor.fallbackEnabled": true,
    "tutor.pictureProvider": "gemini",
    "tutor.imageModel": "gemini-3.1-flash-lite-image",
    "tutor.cloudflareImageModel": "@cf/black-forest-labs/flux-2-klein-4b",
    "tutor.imageCustomModels": "[]"
  },
  lesson: {
    "questionOnly": false,
    "exampleCount": 6,
    "sentenceBand": "medium",
    "tolerance": 0,
    "learnerLevel": "B2",
    "lessonMode": "explainAndExamples",
    "explanationDepth": "standard",
    "annotationLevel": "explainEach",
    "includeCommonErrors": true,
    "exerciseCount": 6
  },
  axes: {
    modality: REWRITE_AXIS_DEFAULTS.modality, function: REWRITE_AXIS_DEFAULTS.function,
    englishVariety: REWRITE_AXIS_DEFAULTS.englishVariety, domain: REWRITE_AXIS_DEFAULTS.domain,
    formality: REWRITE_AXIS_DEFAULTS.formality, voice: 'instructional', stance: REWRITE_AXIS_DEFAULTS.stance,
    perspective: REWRITE_AXIS_DEFAULTS.perspective, rhetoricalMode: 'explain'
  },
  otherOutputLanguage: 'ko',
  conversation: {
    situationId: TUTOR_SITUATIONS[0]!.id, rolesSwapped: false, starts: 'kren',
    register: TUTOR_SITUATIONS[0]!.register, registerChosenByReader: false,
    from: 'situation', customSituation: '', coachOpen: false, speakerOn: true,
    coaching: 'afterwards', send: 'stopSpeaking', replies: 'liveGemini', liveVoice: 'Aoede',
    replyLength: 'short', situationPicture: 'graduallyEntering',
    pictureTransparency: '40', balloonTransparency: '20'
  }
} as const;
