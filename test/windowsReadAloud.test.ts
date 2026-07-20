import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
  prepareTextForSpeech,
  WindowsReadAloudPlayer
} from '../src/windowsReadAloud.js';

function fakeChild(): { child: ChildProcess; input: PassThrough } {
  const child = new EventEmitter() as ChildProcess;
  const input = new PassThrough();
  Object.defineProperty(child, 'stdin', { value: input });
  child.kill = vi.fn(() => true);
  return { child, input };
}

describe('Windows local Read Aloud', () => {
  it('removes common non-sentence Markdown artifacts without changing the source', () => {
    const source = [
      '## Tasks',
      '- [x] **Review** the [proposal](https://example.com) [1].',
      '> 설명은 그대로 읽습니다.',
      '```ts',
      'const hidden = true;',
      '```'
    ].join('\n');

    expect(prepareTextForSpeech(source)).toBe(
      'Tasks Review the proposal. 설명은 그대로 읽습니다.'
    );
    expect(source).toContain('[x]');
  });

  it('pipes only cleaned text through standard input to a hidden fixed command', async () => {
    const { child, input } = fakeChild();
    let piped = '';
    input.on('data', (chunk: Buffer) => { piped += chunk.toString('utf8'); });
    const spawnProcess = vi.fn((
      _command: string,
      _args: readonly string[],
      _options: SpawnOptions
    ) => child);
    const player = new WindowsReadAloudPlayer('win32', spawnProcess);

    const speaking = player.speak('- [x] **Hello** world [1].', {
      voice: 'Microsoft David Desktop',
      rate: 0,
      volume: 75
    });
    await new Promise<void>((resolve) => input.once('end', resolve));
    child.emit('exit', 0);

    await expect(speaking).resolves.toBe(true);
    expect(piped).toBe('Hello world.');
    const [command, args, options] = spawnProcess.mock.calls[0] ?? [];
    expect(command).toBe('powershell.exe');
    expect(args).toContain('Hidden');
    expect(args?.join(' ')).not.toContain('Hello world');
    expect(options).toMatchObject({
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'ignore'],
      env: {
        KREN_SPEECH_VOICE: 'Microsoft David Desktop',
        KREN_SPEECH_RATE: '0',
        KREN_SPEECH_VOLUME: '75'
      }
    });
    expect(options?.env).not.toHaveProperty('OPENAI_API_KEY');
    expect(options?.env).not.toHaveProperty('GEMINI_API_KEY');
  });

  it('does not spawn outside Windows and stops active speech on request', async () => {
    const nonWindowsSpawn = vi.fn(() => fakeChild().child);
    await expect(new WindowsReadAloudPlayer('linux', nonWindowsSpawn).speak('Hello.'))
      .resolves.toBe(false);
    expect(nonWindowsSpawn).not.toHaveBeenCalled();

    const { child } = fakeChild();
    const player = new WindowsReadAloudPlayer('win32', () => child);
    const speaking = player.speak('This sentence is being read.');
    expect(player.stop()).toBe(true);
    child.emit('exit', null);
    await expect(speaking).resolves.toBe(true);
    expect(child.kill).toHaveBeenCalledOnce();
  });
});
