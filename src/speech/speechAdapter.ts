import type { EdgeAudioPlayback } from '../windowsEdgeReadAloud.js';

export type SpeechProvider = 'googleChirp' | 'edgeOnline' | 'windowsLocal';
/** Resolve at the intro mark, then recheck cancellation and the speaker before playback. */
export type SpeechPlaybackBarrier = () => Promise<boolean>;
// The host captures this only for the synchronous invocation of the first tutor line.
export const tutorSpeechPlaybackBarriers = new WeakMap<object, SpeechPlaybackBarrier>();
export interface SpeechVoice {
  voice: string;
  playbackBarrier?: SpeechPlaybackBarrier;
  sentencePauseMilliseconds?: number;
  languageCode?: string;
  feature?: 'tutorSpeech' | 'readAloud';
  pythonCommand?: string;
  playback?: EdgeAudioPlayback;
}
export type SpeechResult =
  | { status: 'completed' }
  | { status: 'stopped' }
  | { status: 'failed'; cause: string; message?: string; missingKey?: boolean; remainingText?: string };

/** Adapters report outcomes; the center decides what happens after a failure. */
export interface SpeechAdapter {
  speak(text: string, voice: SpeechVoice, rate: number, volume: number, onStarted?: () => void): Promise<SpeechResult>;
  stop(): boolean;
}
