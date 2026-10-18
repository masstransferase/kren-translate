import { WindowsWaveInRecorder, type WindowsWaveInSession } from './windowsWaveInRecorder.js';

export interface MemoryRecording {
  finish<T>(consume: (audio: Uint8Array, format: { sampleRate: number; channels: number; bitsPerSample: number }) => Promise<T>): Promise<T>;
  cancel(): Promise<void>;
}

/** Collects waveIn PCM locally and sends one WAV only when dictation stops. */
export class WindowsMemoryRecorder {
  public constructor(private readonly capture: Pick<WindowsWaveInRecorder, 'start'> = new WindowsWaveInRecorder()) {}

  public async start(): Promise<MemoryRecording> {
    let chunks: Buffer[] = [];
    let failure: Error | undefined;
    let closed = false;
    const session: WindowsWaveInSession = await this.capture.start(
      (chunk) => { if (!closed) chunks.push(Buffer.from(chunk, 'base64')); },
      (error) => { failure = error; }
    );
    const stop = async () => {
      session.stop();
      await session.closed;
      closed = true;
    };
    return {
      async finish(consume) {
        try {
          await stop();
          if (failure) throw failure;
          const pcm = Buffer.concat(chunks);
          const header = Buffer.alloc(44);
          header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4);
          header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
          header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
          header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28);
          header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
          header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
          return await consume(Buffer.concat([header, pcm]), { sampleRate: 16000, channels: 1, bitsPerSample: 16 });
        } finally {
          chunks = [];
        }
      },
      async cancel() {
        closed = true;
        chunks = [];
        await stop();
      }
    };
  }
}
