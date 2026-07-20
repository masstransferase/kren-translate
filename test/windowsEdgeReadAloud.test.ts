import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { WindowsEdgeReadAloudPlayer } from '../src/windowsEdgeReadAloud.js';

const audio = {
  directory: 'C:\\Temp\\kren-edge-tts-test',
  file: 'C:\\Temp\\kren-edge-tts-test\\speech.mp3'
};

function fakeChild(withInput = false): { child: ChildProcess; input?: PassThrough } {
  const child = new EventEmitter() as ChildProcess;
  child.kill = vi.fn(() => true);
  if (!withInput) return { child };
  const input = new PassThrough();
  Object.defineProperty(child, 'stdin', { value: input });
  return { child, input };
}

describe('Microsoft Edge online Read Aloud', () => {
  it('sends only cleaned text through stdin, downloads audio, and plays it invisibly', async () => {
    const synthesis = fakeChild(true);
    const playback = fakeChild();
    let piped = '';
    synthesis.input?.on('data', (chunk: Buffer) => { piped += chunk.toString('utf8'); });
    const spawnProcess = vi.fn((
      _command: string,
      _args: readonly string[],
      _options: SpawnOptions
    ) => spawnProcess.mock.calls.length === 1 ? playback.child : synthesis.child);
    const removeAudio = vi.fn(async () => undefined);
    const player = new WindowsEdgeReadAloudPlayer(
      'win32',
      spawnProcess,
      async () => audio,
      removeAudio,
      async () => true
    );

    const speaking = player.speak('- [x] **Read** [this](https://example.com) [1].', {
      pythonCommand: 'python',
      voice: 'en-US-ChristopherNeural',
      ratePercent: 0,
      volume: 75
    });
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2));
    synthesis.child.emit('exit', 0);
    playback.child.emit('exit', 0);

    await expect(speaking).resolves.toBe('completed');
    expect(piped).toBe('Read this.');
    const [pythonCommand, pythonArgs, pythonOptions] = spawnProcess.mock.calls[1] ?? [];
    expect(pythonCommand).toBe('python');
    expect(pythonArgs?.join(' ')).not.toContain('Read this');
    expect(pythonOptions).toMatchObject({
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'ignore'],
      env: {
        KREN_EDGE_AUDIO_FILE: audio.file,
        KREN_EDGE_AUDIO_PART: `${audio.file}.partial`,
        KREN_EDGE_VOICE: 'en-US-ChristopherNeural',
        KREN_EDGE_RATE: '+0%',
        KREN_EDGE_VOLUME: '-25%'
      }
    });
    expect(pythonOptions?.env).not.toHaveProperty('OPENAI_API_KEY');
    expect(pythonOptions?.env).not.toHaveProperty('GEMINI_API_KEY');

    const [playbackCommand, playbackArgs, playbackOptions] = spawnProcess.mock.calls[0] ?? [];
    expect(playbackCommand).toBe('powershell.exe');
    expect(playbackArgs).toContain('Hidden');
    expect(playbackOptions).toMatchObject({
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
      env: { KREN_AUDIO_FILE: audio.file, KREN_AUDIO_VOLUME: '100' }
    });
    expect(removeAudio).toHaveBeenCalledWith(audio);
  });

  it('uses an already-running panel player without starting WPF', async () => {
    const synthesis = fakeChild(true);
    const spawnProcess = vi.fn((
      _command: string,
      _args: readonly string[],
      _options: SpawnOptions
    ) => synthesis.child);
    const removeAudio = vi.fn(async () => undefined);
    const playback = {
      play: vi.fn(async () => 'completed' as const),
      stop: vi.fn(() => true)
    };
    const player = new WindowsEdgeReadAloudPlayer(
      'win32',
      spawnProcess,
      async () => audio,
      removeAudio,
      async () => true
    );

    const speaking = player.speak('A faster preview.', {
      voice: 'en-US-AvaNeural',
      volume: 25,
      playback
    });
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce());
    synthesis.child.emit('exit', 0);

    await expect(speaking).resolves.toBe('completed');
    expect(spawnProcess.mock.calls[0]?.[0]).toBe('python');
    expect(spawnProcess.mock.calls[0]?.[2]).toMatchObject({
      env: {
        KREN_EDGE_VOICE: 'en-US-AvaNeural',
        KREN_EDGE_VOLUME: '-75%'
      }
    });
    expect(playback.play).toHaveBeenCalledWith(audio.file);
    expect(removeAudio).toHaveBeenCalledWith(audio);
  });

  it('reports a missing edge-tts dependency and closes the waiting player', async () => {
    const synthesis = fakeChild(true);
    const playback = fakeChild();
    const spawnProcess = vi.fn((
      _command: string,
      _args: readonly string[],
      _options: SpawnOptions
    ) => spawnProcess.mock.calls.length === 1 ? playback.child : synthesis.child);
    const removeAudio = vi.fn(async () => undefined);
    const player = new WindowsEdgeReadAloudPlayer(
      'win32',
      spawnProcess,
      async () => audio,
      removeAudio,
      async () => true
    );

    const speaking = player.speak('Hello.');
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2));
    expect(spawnProcess.mock.calls[1]?.[2]).toMatchObject({
      env: { KREN_EDGE_VOLUME: '+0%' }
    });
    synthesis.child.emit('exit', 3);
    playback.child.emit('exit', null);

    await expect(speaking).resolves.toBe('dependencyMissing');
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(removeAudio).toHaveBeenCalledWith(audio);
  });

  it('stops active synthesis and removes temporary audio', async () => {
    const synthesis = fakeChild(true);
    const playback = fakeChild();
    const spawnProcess = vi.fn(() =>
      spawnProcess.mock.calls.length === 1 ? playback.child : synthesis.child
    );
    const removeAudio = vi.fn(async () => undefined);
    const player = new WindowsEdgeReadAloudPlayer(
      'win32',
      spawnProcess,
      async () => audio,
      removeAudio,
      async () => true
    );

    const speaking = player.speak('This should stop.');
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2));
    expect(player.stop()).toBe(true);
    synthesis.child.emit('exit', null);
    playback.child.emit('exit', null);

    await expect(speaking).resolves.toBe('stopped');
    expect(synthesis.child.kill).toHaveBeenCalledOnce();
    expect(playback.child.kill).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(removeAudio).toHaveBeenCalledWith(audio));
  });
});
