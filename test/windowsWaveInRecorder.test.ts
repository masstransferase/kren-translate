import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawnSync, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
  WAVEIN_STOP_TIMEOUT_MS,
  WindowsWaveInRecorder,
  buildWaveInPowerShellScript,
  type SpawnWaveInProcess
} from '../src/windowsWaveInRecorder.js';

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

function spawnedRecorder() {
  const child = fakeChild();
  const calls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = [];
  const spawnProcess: SpawnWaveInProcess = (command, args, options) => {
    calls.push({ command, args, options });
    queueMicrotask(() => child.stdout.write('KREN_WAVEIN_READY\n'));
    return child;
  };
  const recorder = new WindowsWaveInRecorder({ platform: 'win32', spawnProcess });
  return { child, calls, recorder };
}

describe('Windows waveIn Live microphone recorder', () => {
  it('keeps the exported stop timeout as the eight-second default', () => {
    expect(WAVEIN_STOP_TIMEOUT_MS).toBe(8_000);
  });

  it('uses every required waveIn operation, suppresses progress, and writes no file', () => {
    const script = buildWaveInPowerShellScript();
    for (const operation of [
      'waveInOpen', 'waveInPrepareHeader', 'waveInAddBuffer', 'waveInStart',
      'waveInStop', 'waveInReset', 'waveInClose'
    ]) {
      expect(script).toContain(operation);
    }
    expect(script).toContain("$ProgressPreference = 'SilentlyContinue'");
    expect(script).toContain('private const int BufferBytes = 3200;');
    expect(script).not.toMatch(/System\.IO|WriteAllBytes|Out-File|Set-Content|FileStream|\.wav/iu);
  });

  it.runIf(process.platform === 'win32')(
    'compiles the generated PowerShell type without opening an audio device',
    () => {
      const script = buildWaveInPowerShellScript();
      const typeEnd = script.indexOf("\n'@\n") + 4;
      expect(typeEnd).toBeGreaterThan(4);
      const compileOnly = `${script.slice(0, typeEnd)}\n[Console]::Out.WriteLine('compiled')`;
      const encoded = Buffer.from(compileOnly, 'utf16le').toString('base64');
      const result = spawnSync('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', encoded
      ], { encoding: 'utf8', windowsHide: true });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('compiled');
    },
    // 2026-09-19: compiling takes about 1 s alone and passed 5 s under the full suite's load.
    30000
  );

  it('delivers complete stdout lines in order and stops through stdin', async () => {
    const { child, recorder } = spawnedRecorder();
    const chunks: string[] = [];
    let input = '';
    child.stdin.setEncoding('utf8');
    child.stdin.on('data', (chunk: string) => { input += chunk; });
    const session = await recorder.start((chunk) => chunks.push(chunk), vi.fn());
    child.stdout.write('AQ');
    child.stdout.write('I=\nAwQ=\nBQ');
    child.stdout.write('Y=\n');
    session.stop();
    expect(chunks).toEqual(['AQI=', 'AwQ=', 'BQY=']);
    expect(input).toBe('stop\n');
  });

  // Changed 2026-09-24 for V146: the reader chooses the deadline, but every choice retains
  // the V123 hard end so a hung helper cannot leave the microphone open indefinitely.
  it.each([2_000, 8_000])(
    'waits the configured %i ms before ending a helper that has not exited',
    async (stopTimeoutMs) => {
      const { child, recorder } = spawnedRecorder();
      const kill = vi.fn();
      Object.assign(child, { kill });
      const session = await recorder.start(vi.fn(), vi.fn(), stopTimeoutMs);
      vi.useFakeTimers();
      try {
        session.stop();
        vi.advanceTimersByTime(stopTimeoutMs - 1);
        expect(kill).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(kill).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it('never ends a helper that exits promptly during the configured wait', async () => {
    const { child, recorder } = spawnedRecorder();
    const kill = vi.fn();
    Object.assign(child, { kill });
    const session = await recorder.start(vi.fn(), vi.fn(), 8_000);
    vi.useFakeTimers();
    try {
      session.stop();
      child.emit('exit', 0);
      vi.advanceTimersByTime(WAVEIN_STOP_TIMEOUT_MS * 2);
      expect(kill).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads filled buffers oldest first and clears the filled mark before requeueing', () => {
    const script = buildWaveInPowerShellScript();
    expect(script).toContain('BufferSlot slot = buffers[nextSlot];');
    expect(script).toContain('nextSlot = (nextSlot + 1) % buffers.Count;');
    expect(script).toContain('header.dwFlags &= ~HeaderDone;');
    expect(script).not.toContain('foreach (BufferSlot slot in buffers) {\n      WaveHeader');
  });

  it('passes no provider credential through arguments, environment, or stdin', async () => {
    const credential = ['never', 'send', 'provider', 'credential'].join('-');
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = credential;
    try {
      const { child, calls, recorder } = spawnedRecorder();
      let input = '';
      child.stdin.setEncoding('utf8');
      child.stdin.on('data', (chunk: string) => { input += chunk; });
      const session = await recorder.start(vi.fn(), vi.fn());
      session.stop();
      expect(JSON.stringify({ calls, input })).not.toContain(credential);
      expect(Object.keys(calls[0]!.options.env ?? {}).every((key) =>
        ['systemroot', 'windir', 'comspec', 'pathext', 'psmodulepath'].includes(key.toLocaleLowerCase())
      )).toBe(true);
      expect(input).toBe('stop\n');
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
    }
  });

  it('reports a non-zero helper exit after startup from one stderr line', async () => {
    const { child, recorder } = spawnedRecorder();
    const onError = vi.fn();
    await recorder.start(vi.fn(), onError);
    child.stderr.write('KREN waveIn failed: waveInStart failed with code 4.\n');
    child.emit('exit', 1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'KREN waveIn failed: waveInStart failed with code 4.'
    }));
  });
});
