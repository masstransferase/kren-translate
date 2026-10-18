import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawnSync, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
  WindowsWaveOutPlayer,
  buildWaveOutPowerShellScript,
  type SpawnWaveOutProcess
} from '../src/windowsWaveOutPlayer.js';

type FakeChild = ChildProcessWithoutNullStreams & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
};

function fakeChild(): FakeChild {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdio: []
  }) as unknown as FakeChild;
}

function spawnedPlayer() {
  const child = fakeChild();
  const calls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = [];
  const spawnProcess: SpawnWaveOutProcess = (command, args, options) => {
    calls.push({ command, args, options });
    queueMicrotask(() => child.stdout.write('KREN_WAVEOUT_READY\n'));
    return child;
  };
  const player = new WindowsWaveOutPlayer({ platform: 'win32', spawnProcess });
  return { child, calls, player };
}

describe('Windows waveOut Live audio player', () => {
  it('uses the four required waveOut operations and has no file path or file write', () => {
    const script = buildWaveOutPowerShellScript();
    for (const operation of ['waveOutOpen', 'waveOutWrite', 'waveOutReset', 'waveOutClose']) {
      expect(script).toContain(operation);
    }
    expect(script).not.toMatch(/System\.IO|WriteAllBytes|Out-File|Set-Content|FileStream|temporary/iu);
  });

  it.runIf(process.platform === 'win32')(
    'compiles and closes the generated PowerShell helper without opening an audio device',
    () => {
      const encoded = Buffer.from(buildWaveOutPowerShellScript(), 'utf16le').toString('base64');
      const result = spawnSync('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', encoded
      ], { encoding: 'utf8', input: 'close\n', windowsHide: true });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('KREN_WAVEOUT_READY');
    }
  );

  it('resets, closes, and reopens waveOut when a chunk changes the sample rate', () => {
    const script = buildWaveOutPowerShellScript();
    expect(script).toContain('else if (rate != sampleRate) Reopen(rate);');
    const reopen = script.slice(script.indexOf('private void Reopen(int rate)'), script.indexOf('public void Play'));
    expect(reopen.indexOf('ResetBuffers()')).toBeLessThan(reopen.indexOf('waveOutClose(handle)'));
    expect(reopen.indexOf('waveOutClose(handle)')).toBeLessThan(reopen.indexOf('Open(rate)'));
  });

  it('writes PCM chunks in order, defaults to 24 kHz, and sends stop then close', async () => {
    const { child, player } = spawnedPlayer();
    let input = '';
    child.stdin.setEncoding('utf8');
    child.stdin.on('data', (chunk: string) => { input += chunk; });
    const session = await player.start(vi.fn());
    session.play({ data: 'AQI=', mimeType: 'audio/pcm;rate=24000' });
    session.play({ data: 'AwQ=', mimeType: 'audio/pcm;rate=22050' });
    session.play({ data: 'BQY=', mimeType: 'audio/pcm' });
    session.stop();
    session.close();
    expect(input.split('\n').filter(Boolean)).toEqual([
      'play\t24000\tAQI=',
      'play\t22050\tAwQ=',
      'play\t24000\tBQY=',
      'stop',
      'close'
    ]);
  });

  it('V139 caps each waveOut buffer at 40 ms of mono 16-bit PCM', async () => {
    const { child, player } = spawnedPlayer();
    let input = '';
    child.stdin.setEncoding('utf8');
    child.stdin.on('data', (chunk: string) => { input += chunk; });
    const session = await player.start(vi.fn());
    session.play({ data: Buffer.alloc(3_200).toString('base64'), mimeType: 'audio/pcm;rate=16000' });

    const buffers = input.split('\n').filter(Boolean).map((line) =>
      Buffer.from(line.split('\t')[2]!, 'base64').byteLength
    );
    expect(buffers).toEqual([1_280, 1_280, 640]);
  });

  it('V139 reports the numeric completed-buffer count and queue-idle progress from waveOut', async () => {
    const { child, player } = spawnedPlayer();
    const onProgress = vi.fn();
    await player.start(vi.fn(), onProgress);
    child.stdout.write('KREN_WAVEOUT_PROGRESS\t2\t1\n');
    child.stdout.write('KREN_WAVEOUT_PROGRESS\t1\t0\n');
    expect(onProgress.mock.calls).toEqual([[2, 1], [1, 0]]);

    const script = buildWaveOutPowerShellScript();
    expect(script).toContain('KREN_WAVEOUT_PROGRESS');
    expect(script).toContain('HeaderDone');
  });

  it('passes no provider credential through arguments, environment, or stdin', async () => {
    const credential = ['never', 'forward', 'this'].join('-');
    const { child, calls, player } = spawnedPlayer();
    let input = '';
    child.stdin.setEncoding('utf8');
    child.stdin.on('data', (chunk: string) => { input += chunk; });
    const session = await player.start(vi.fn());
    session.play({ data: Buffer.from([1, 2]).toString('base64'), mimeType: 'audio/pcm' });
    const boundary = JSON.stringify({ calls, input });
    expect(boundary).not.toContain(credential);
    expect(Object.keys(calls[0]!.options.env ?? {}).every((key) =>
      ['systemroot', 'windir', 'comspec', 'pathext', 'psmodulepath'].includes(key.toLocaleLowerCase())
    )).toBe(true);
    expect(Object.keys(calls[0]!.options.env ?? {}).some((key) => /gemini|google|key|credential/iu.test(key)))
      .toBe(false);
  });

  it('reports the helper stderr line after startup', async () => {
    const { child, player } = spawnedPlayer();
    const onError = vi.fn();
    await player.start(onError);
    child.stderr.write('KREN waveOut failed: waveOutWrite failed with code 4.\n');
    child.emit('exit', 1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'KREN waveOut failed: waveOutWrite failed with code 4.'
    }));
  });
});
