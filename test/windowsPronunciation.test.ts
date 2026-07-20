import { EventEmitter } from 'node:events';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WindowsPronunciationPlayer } from '../src/windowsPronunciation.js';

afterEach(() => vi.restoreAllMocks());

const audioUrl =
  'https://media.merriam-webster.com/audio/prons/en/us/mp3/d/delibe01.mp3';
const downloaded = {
  directory: 'C:\\Temp\\kren-pronunciation-test',
  file: 'C:\\Temp\\kren-pronunciation-test\\pronunciation.mp3'
};

function fakeChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.kill = vi.fn(() => true);
  return child;
}

describe('Windows native pronunciation', () => {
  it('starts a hidden shell-free player and keeps the URL out of command text', async () => {
    const child = fakeChild();
    const spawnProcess = vi.fn((
      _command: string,
      _args: readonly string[],
      _options: SpawnOptions
    ) => child);
    const removeAudio = vi.fn(async () => undefined);
    const player = new WindowsPronunciationPlayer(
      'win32',
      spawnProcess,
      async () => downloaded,
      removeAudio
    );
    const playback = player.play(audioUrl);
    await Promise.resolve();
    child.emit('exit', 0);

    await expect(playback).resolves.toBe(true);
    expect(spawnProcess).toHaveBeenCalledOnce();
    const [command, args, options] = spawnProcess.mock.calls[0] ?? [];
    expect(command).toBe('powershell.exe');
    expect(args).toContain('-WindowStyle');
    expect(args).toContain('Hidden');
    expect(args).toContain('-STA');
    expect(args?.join(' ')).not.toContain(audioUrl);
    expect(options).toMatchObject({
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
      env: { KREN_AUDIO_FILE: downloaded.file }
    });
    expect(options?.env).not.toHaveProperty('OPENAI_API_KEY');
    expect(options?.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(removeAudio).toHaveBeenCalledWith(downloaded);
  });

  it('does not spawn on a non-Windows platform or for an unapproved URL', async () => {
    const spawnProcess = vi.fn(() => fakeChild());
    const downloadAudio = vi.fn(async () => downloaded);
    await expect(new WindowsPronunciationPlayer('linux', spawnProcess, downloadAudio).play(audioUrl))
      .resolves.toBe(false);
    await expect(new WindowsPronunciationPlayer('win32', spawnProcess, downloadAudio)
      .play('https://example.com/audio.mp3')).resolves.toBe(false);
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(downloadAudio).not.toHaveBeenCalled();
  });

  it('falls back when the native process fails', async () => {
    const child = fakeChild();
    const removeAudio = vi.fn(async () => undefined);
    const player = new WindowsPronunciationPlayer(
      'win32',
      () => child,
      async () => downloaded,
      removeAudio
    );
    const playback = player.play(audioUrl);
    await Promise.resolve();
    child.emit('exit', 1);
    await expect(playback).resolves.toBe(false);
    expect(removeAudio).toHaveBeenCalledWith(downloaded);
  });

  it('stops active playback when disposed', async () => {
    const child = fakeChild();
    const player = new WindowsPronunciationPlayer(
      'win32',
      () => child,
      async () => downloaded,
      async () => undefined
    );
    const playback = player.play(audioUrl);
    await Promise.resolve();
    player.dispose();
    child.emit('exit', null);
    await expect(playback).resolves.toBe(true);
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('downloads without redirects, passes only the temporary path, and removes it', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]),
      { status: 200, headers: { 'content-length': '6', 'content-type': 'audio/mpeg' } }
    ));
    const child = fakeChild();
    let temporaryFile = '';
    const spawnProcess = vi.fn((
      _command: string,
      _args: readonly string[],
      options: SpawnOptions
    ) => {
      temporaryFile = options.env?.KREN_AUDIO_FILE ?? '';
      expect(existsSync(temporaryFile)).toBe(true);
      return child;
    });
    const player = new WindowsPronunciationPlayer('win32', spawnProcess);
    const playback = player.play(audioUrl);
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce());
    child.emit('exit', 0);

    await expect(playback).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(audioUrl, expect.objectContaining({
      redirect: 'error'
    }));
    expect(existsSync(temporaryFile)).toBe(false);
  });
});
