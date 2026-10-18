import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { WindowsNativeAudioPlayer } from '../src/speech/speechCenter.js';
import { WindowsEdgeReadAloudPlayer } from '../src/speech/speechCenter.js';
import { CHIRP_24K_MONO_MP3_BASE64 } from './support/chirp24kMonoMp3.js';

it.skipIf(process.platform !== 'win32' || process.env.KREN_REAL_AUDIO !== '1')('real native audio: readiness, warm order, Stop, cleanup and QUIT', async () => {
  const files: string[] = [], replies: string[] = [], timings: string[] = [];
  let child: ChildProcess | undefined, exited: Promise<number | null> | undefined;
  const player = new WindowsNativeAudioPlayer(new WindowsEdgeReadAloudPlayer(), {
    spawn: (command, args, options) => {
      child = spawn(command, args, options);
      exited = new Promise(resolve => child!.once('exit', resolve));
      let buffer = '';
      child.stdout!.on('data', chunk => {
        buffer += chunk.toString();
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          replies.push(buffer.slice(0, newline).trim()); buffer = buffer.slice(newline + 1);
        }
      });
      return child;
    },
    createAudio: async () => {
      const directory = await mkdtemp(join(tmpdir(), 'kren-real-audio-'));
      const file = join(directory, 'speech.mp3'); files.push(file); return { directory, file };
    },
    log: line => { timings.push(line); console.log(line); }
  });
  try {
    player.beginSession();
    for (let clip = 1; clip <= 3; clip++) {
      let started!: () => void;
      const start = new Promise<void>(resolve => { started = resolve; });
      const completion = player.play(CHIRP_24K_MONO_MP3_BASE64, 20, started);
      await start;
      if (clip === 3) {
        const stoppedAt = Date.now(); player.stop(); expect(await completion).toBe('stopped');
        expect(Date.now() - stoppedAt).toBeLessThanOrEqual(500);
      } else expect(await completion).toBe('completed');
    }
    expect(replies[0]).toBe('READY');
    expect(replies.slice(1)).toEqual(['STARTED 1', 'ENDED 1', 'STARTED 2', 'ENDED 2', 'STARTED 3', 'ENDED 3']);
    for (const id of [2, 3]) {
      const line = timings.find(value => value.startsWith(`[speech] clip ${id} started`))!;
      expect(Number(/after (\d+) ms/u.exec(line)![1])).toBeLessThanOrEqual(500);
    }
    for (const file of files) await expect(access(file)).rejects.toThrow();
    player.dispose(); expect(await exited).toBe(0);
  } finally { player.dispose(); child?.kill(); }
}, 120_000);
