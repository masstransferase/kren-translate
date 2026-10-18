import type { WindowsReadAloudPlayer } from '../windowsReadAloud.js';
import type { WindowsEdgeReadAloudTransport } from '../windowsEdgeReadAloud.js';
import type { SpeechAdapter, SpeechResult, SpeechVoice } from './speechAdapter.js';

export class LocalWindowsSpeechAdapter implements SpeechAdapter {
  private generation = 0;
  constructor(private readonly player: Pick<WindowsReadAloudPlayer, 'speak' | 'stop'>) {}
  public stop(): boolean { this.generation++; return this.player.stop(); }
  public async speak(text: string, voice: SpeechVoice, rate: number, volume: number, onStarted?: () => void): Promise<SpeechResult> {
    const generation = this.generation;
    const completed = await this.player.speak(text, { voice: voice.voice, rate, volume, onStarted });
    if (generation !== this.generation) return { status: 'stopped' };
    return completed ? { status: 'completed' } : { status: 'failed', cause: 'Local Windows speech failed' };
  }
}

export class EdgeOnlineSpeechAdapter implements SpeechAdapter {
  constructor(private readonly player: Pick<WindowsEdgeReadAloudTransport, 'speak' | 'stop'>) {}
  public stop(): boolean { return this.player.stop(); }
  public async speak(text: string, voice: SpeechVoice, rate: number, volume: number, onStarted?: () => void): Promise<SpeechResult> {
    const result = await this.player.speak(text, { ...voice, ratePercent: rate, volume, onStarted });
    return result === 'failed' || result === 'dependencyMissing'
      ? { status: 'failed', cause: result === 'dependencyMissing' ? 'edge-tts package missing' : 'synthesis or playback failed' }
      : { status: result };
  }
}
