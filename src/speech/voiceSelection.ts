import { edgeSpeechVoiceGender, otherGenderEdgeVoice } from '../windowsEdgeReadAloud.js';
import { normalizedTutorLiveVoice, TUTOR_LIVE_VOICES } from '../tutor/state.js';
import { TUTOR_DEFAULTS } from '../tutor/defaults.js';
import type { KrenPanelSettings } from '../resultViewHtml.js';

type Gender = 'female' | 'male';
const livePresets = {
  female: TUTOR_LIVE_VOICES.filter((voice) => voice[2] === 'female').map(([name]) => name),
  male: TUTOR_LIVE_VOICES.filter((voice) => voice[2] === 'male').map(([name]) => name)
};

/** All newcomer choices live here. Windows has only one voice for each gender. */
export const TUTOR_CONVERSATION_VOICE_PRESETS = {
  edgeOnline: {
    female: ['en-US-AvaNeural', 'en-US-JennyNeural', 'en-US-AriaNeural', 'en-US-EmmaNeural'],
    male: ['en-US-ChristopherNeural', 'en-US-AndrewNeural', 'en-US-GuyNeural', 'en-US-BrianNeural']
  },
  googleChirp: livePresets,
  liveGemini: livePresets,
  windowsLocal: { female: ['Microsoft Zira Desktop'], male: ['Microsoft David Desktop'] }
} as const;

export interface TutorCharacterVoices { edgeVoice: string; liveVoice: string; windowsVoice: string }
interface TutorConversationVoicePlan {
  tutorGender: Gender;
  learnerGender: Gender;
  initial: TutorCharacterVoices;
  current: TutorCharacterVoices;
  learner: TutorCharacterVoices;
  handoffs: Array<{ turn: number; voices: TutorCharacterVoices }>;
}
const conversationVoices = new WeakMap<object, TutorConversationVoicePlan>();

/** Only the conversation data needed to plan voices crosses the speech boundary. */
interface TutorVoiceContext {
  tutorSpeechConversation?: unknown;
  actions: { settings(): TutorVoiceSettings };
  tutorState: { conversation: { replies: string; liveVoice: string; transcript: readonly unknown[] } };
}

function conversationVoiceIdentity(identity: unknown): object | undefined {
  return identity !== null && (typeof identity === 'object' || typeof identity === 'function') ? identity : undefined;
}

function defaultVoices(settings: TutorVoiceSettings, gender: Gender): TutorCharacterVoices {
  return {
    liveVoice: normalizedTutorLiveVoice(gender === 'male'
      ? settings.tutorLiveMaleVoice ?? TUTOR_DEFAULTS.configuration['tutor.liveMaleVoice']
      : settings.tutorLiveFemaleVoice ?? TUTOR_DEFAULTS.configuration['tutor.liveFemaleVoice']),
    edgeVoice: gender === 'male' ? settings.tutorEdgeReadAloudMaleVoice ?? 'en-US-ChristopherNeural'
      : settings.tutorEdgeReadAloudFemaleVoice ?? 'en-US-AvaNeural',
    windowsVoice: TUTOR_CONVERSATION_VOICE_PRESETS.windowsLocal[gender][0]
  };
}

/** The session identity is replaced at Start, so no preferences or archived text are mutated. */
export function tutorConversationVoicePlan(view: TutorVoiceContext, initialize = false): TutorConversationVoicePlan {
  const identity = conversationVoiceIdentity(view.tutorSpeechConversation);
  const saved = identity ? conversationVoices.get(identity) : undefined;
  if (saved && !initialize) return saved;
  const settings = view.actions.settings();
  const conversation = view.tutorState.conversation;
  const provider = settings.tutorReadAloudProvider ?? TUTOR_DEFAULTS.configuration['tutor.readAloud.provider'];
  const selectedEdgeVoice = settings.tutorEdgeReadAloudVoice ?? TUTOR_DEFAULTS.configuration['tutor.readAloud.edgeVoice'];
  const tutorGender: Gender = conversation.replies === 'liveGemini' || provider === 'googleChirp'
    ? TUTOR_LIVE_VOICES.find(([name]) => name === normalizedTutorLiveVoice(conversation.liveVoice))?.[2] ?? 'female'
    : provider === 'windowsLocal'
      ? (/Zira/iu.test(settings.tutorReadAloudVoice ?? '') ? 'female' : 'male')
      : edgeSpeechVoiceGender(selectedEdgeVoice) ?? 'female';
  const learnerGender = tutorGender === 'female' ? 'male' : 'female';
  const initial = defaultVoices(settings, tutorGender);
  const learner = defaultVoices(settings, learnerGender);
  // A failed Live session still uses the Speech Source's original voice until a handoff.
  if (conversation.replies === 'liveGemini') {
    initial.edgeVoice = selectedEdgeVoice;
    initial.windowsVoice = settings.tutorReadAloudVoice ?? TUTOR_DEFAULTS.configuration['tutor.readAloud.voice'];
  }
  // Existing or demo conversations have no Start plan. Preserve their selected voices,
  // including the legacy Replay defaults, instead of freezing a plan during a read.
  if (!initialize) {
    initial.edgeVoice = selectedEdgeVoice;
    initial.liveVoice = tutorConversationSpeechVoice({ ...settings, tutorReadAloudProvider: 'googleChirp' }, conversation.liveVoice)!;
    initial.windowsVoice = settings.tutorReadAloudVoice ?? TUTOR_DEFAULTS.configuration['tutor.readAloud.voice'];
    learner.edgeVoice = tutorLearnerEdgeVoice({ ...settings, tutorReadAloudProvider: 'edgeOnline' }, conversation) ?? learner.edgeVoice;
    learner.liveVoice = tutorLearnerLiveVoice(settings, conversation.liveVoice);
  }
  const plan: TutorConversationVoicePlan = { tutorGender, learnerGender, initial, current: initial,
    learner, handoffs: [] };
  if (identity && initialize) conversationVoices.set(identity, plan);
  return plan;
}

export function handoffTutorConversationVoices(view: TutorVoiceContext, gender: Gender): TutorCharacterVoices {
  const plan = tutorConversationVoicePlan(view);
  const voices = tutorHandoffVoices(view.actions.settings(), gender, [plan.current, plan.learner, plan.initial]);
  plan.current = voices;
  plan.tutorGender = gender;
  plan.handoffs.push({ turn: view.tutorState.conversation.transcript.length - 1, voices });
  const identity = conversationVoiceIdentity(view.tutorSpeechConversation);
  if (identity) conversationVoices.set(identity, plan);
  return voices;
}

export function tutorCharacterVoicesAt(view: TutorVoiceContext, turn: number): TutorCharacterVoices {
  const plan = tutorConversationVoicePlan(view);
  return [...plan.handoffs].reverse().find((handoff) => handoff.turn <= turn)?.voices ?? plan.initial;
}

export function tutorVoiceForSource(settings: TutorVoiceSettings, voices: TutorCharacterVoices): string {
  return settings.tutorReadAloudProvider === 'windowsLocal' ? voices.windowsVoice
    : settings.tutorReadAloudProvider === 'googleChirp' ? voices.liveVoice : voices.edgeVoice;
}

export function tutorWindowsVoice(speakerVoice: string | undefined): string | undefined {
  return Object.values(TUTOR_CONVERSATION_VOICE_PRESETS.windowsLocal).some((voices) => voices[0] === speakerVoice)
    ? speakerVoice : undefined;
}

// Explicit Chirp presets keep their identity; other speech sources supply gender only.
export function tutorChirpVoices(speakerVoice: string | undefined, choices: {
  female: string; male: string; edgeFemale: string; edgeMale: string;
}): { voice: string; edgeVoice: string } {
  const preset = TUTOR_LIVE_VOICES.find(([name]) => name === speakerVoice);
  const gender = preset?.[2] ?? (tutorWindowsVoice(speakerVoice)
    ? (speakerVoice === TUTOR_CONVERSATION_VOICE_PRESETS.windowsLocal.male[0] ? 'male' : 'female')
    : edgeSpeechVoiceGender(speakerVoice ?? '') ?? 'female');
  return { voice: preset?.[0] ?? normalizedTutorLiveVoice(gender === 'male' ? choices.male : choices.female),
    edgeVoice: gender === 'male' ? choices.edgeMale : choices.edgeFemale };
}

type TutorVoiceSettings = Partial<Pick<KrenPanelSettings, 'tutorReadAloudProvider' | 'tutorReadAloudVoice' | 'tutorEdgeReadAloudVoice' |
  'tutorEdgeReadAloudFemaleVoice' | 'tutorEdgeReadAloudMaleVoice' | 'tutorLiveFemaleVoice' | 'tutorLiveMaleVoice'>>;

export function tutorHandoffVoices(_settings: TutorVoiceSettings, gender: Gender, excluded: readonly TutorCharacterVoices[] = []): TutorCharacterVoices {
  const choose = (presets: readonly string[], key: keyof TutorCharacterVoices) =>
    presets.find((voice) => !excluded.some((other) => other[key] === voice)) ?? presets[0]!;
  return {
    liveVoice: choose(TUTOR_CONVERSATION_VOICE_PRESETS.liveGemini[gender], 'liveVoice'),
    edgeVoice: choose(TUTOR_CONVERSATION_VOICE_PRESETS.edgeOnline[gender], 'edgeVoice'),
    windowsVoice: TUTOR_CONVERSATION_VOICE_PRESETS.windowsLocal[gender][0]
  };
}

// 2026-10-14: Replay passes speaker identity to the center's choices without changing settings.
export function tutorLearnerEdgeVoice(settings: TutorVoiceSettings, conversation: { replies: string; liveVoice: string }): string | undefined {
  if (settings.tutorReadAloudProvider !== 'edgeOnline') return undefined;
  const edgeDefaults = {
    female: settings.tutorEdgeReadAloudFemaleVoice ?? 'en-US-AvaNeural',
    male: settings.tutorEdgeReadAloudMaleVoice ?? 'en-US-ChristopherNeural'
  };
  if (conversation.replies === 'liveGemini') {
    const voice = TUTOR_LIVE_VOICES.find(([name]) => name === normalizedTutorLiveVoice(conversation.liveVoice));
    return otherGenderEdgeVoice(voice?.[2], edgeDefaults);
  }
  return otherGenderEdgeVoice(edgeSpeechVoiceGender(settings.tutorEdgeReadAloudVoice ?? ''), edgeDefaults);
}

export function tutorLearnerLiveVoice(settings: TutorVoiceSettings, liveVoice: string): string {
  const conversationVoice = normalizedTutorLiveVoice(liveVoice);
  const gender = TUTOR_LIVE_VOICES.find(([name]) => name === conversationVoice)?.[2];
  return normalizedTutorLiveVoice(gender === 'male'
    ? settings.tutorLiveFemaleVoice ?? TUTOR_DEFAULTS.configuration['tutor.liveFemaleVoice']
    : settings.tutorLiveMaleVoice ?? TUTOR_DEFAULTS.configuration['tutor.liveMaleVoice']);
}

export function tutorConversationSpeechVoice(settings: TutorVoiceSettings, liveVoice: string, edgeVoice?: string): string | undefined {
  return settings.tutorReadAloudProvider === 'googleChirp'
    ? edgeVoice ?? (TUTOR_LIVE_VOICES.find(([name]) => name === normalizedTutorLiveVoice(liveVoice))?.[2] === 'male'
      ? settings.tutorLiveMaleVoice ?? 'Enceladus' : settings.tutorLiveFemaleVoice ?? 'Callirrhoe')
    : edgeVoice;
}
