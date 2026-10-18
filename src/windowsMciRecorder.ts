import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface WavFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

export interface MciNativeSession {
  stop(): Promise<void>;
  cancel(): Promise<void>;
}

export type StartMciBoundary = (filePath: string) => Promise<MciNativeSession>;

export interface WindowsMciRecorderOptions {
  platform?: NodeJS.Platform;
  temporaryRoot?: string;
  startNative?: StartMciBoundary;
}

export interface WindowsMciRecording {
  /** Exposed for lifecycle reporting and tests. Audio consumers receive bytes, never this path. */
  readonly filePath: string;
  finish<T>(consume: (audio: Uint8Array, format: WavFormat) => Promise<T>): Promise<T>;
  cancel(): Promise<void>;
}

const RECORDING_FILE_NAME = 'dictation.wav';

function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

/**
 * Builds the one in-memory PowerShell program that owns the MCI alias from start through
 * stop. PowerShell 5.1 cannot safely drive the asynchronous WinRT recorder, while this
 * synchronous winmm.dll boundary has no package or service dependency.
 */
export function buildMciPowerShellScript(filePath: string): string {
  return `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class KrenMciRecorder {
  [DllImport("winmm.dll", CharSet = CharSet.Auto)]
  public static extern uint mciSendString(string command, StringBuilder result, int length, IntPtr callback);
  [DllImport("winmm.dll", CharSet = CharSet.Auto)]
  public static extern bool mciGetErrorString(uint code, StringBuilder text, int length);
}
'@
function Invoke-Mci([string]$command) {
  $result = New-Object System.Text.StringBuilder 256
  $code = [KrenMciRecorder]::mciSendString($command, $result, $result.Capacity, [IntPtr]::Zero)
  if ($code -ne 0) {
    $message = New-Object System.Text.StringBuilder 256
    [void][KrenMciRecorder]::mciGetErrorString($code, $message, $message.Capacity)
    throw "MCI command failed: $message"
  }
}
function Try-Mci([string]$command) {
  $result = New-Object System.Text.StringBuilder 256
  return [KrenMciRecorder]::mciSendString($command, $result, $result.Capacity, [IntPtr]::Zero) -eq 0
}
$recordingPath = ${quotePowerShellLiteral(filePath)}
$opened = $false
try {
  Invoke-Mci 'open new type waveaudio alias krenrecorder'
  $opened = $true
  Invoke-Mci 'set krenrecorder format tag pcm'
  [void](Try-Mci 'set krenrecorder samplespersecond 16000')
  Invoke-Mci 'set krenrecorder channels 1'
  Invoke-Mci 'set krenrecorder bitspersample 16'
  Invoke-Mci 'set krenrecorder alignment 2'
  Invoke-Mci 'record krenrecorder'
  [Console]::Out.WriteLine('KREN_RECORDING_READY')
  $signal = [Console]::In.ReadLine()
  if ($signal -eq 'stop') {
    Invoke-Mci 'stop krenrecorder'
    Invoke-Mci ('save krenrecorder ' + [char]34 + $recordingPath + [char]34)
  }
} finally {
  if ($opened) {
    [void](Try-Mci 'close krenrecorder')
  }
}`;
}

function nativeProcess(filePath: string): Promise<MciNativeSession> {
  const encoded = Buffer.from(buildMciPowerShellScript(filePath), 'utf16le').toString('base64');
  const child = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
  );
  return waitUntilRecording(child);
}

function waitUntilRecording(child: ChildProcessWithoutNullStreams): Promise<MciNativeSession> {
  let standardOutput = '';
  let standardError = '';
  let ready = false;
  let completed = false;
  const completion = new Promise<void>((resolve, reject) => {
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      standardError = `${standardError}${chunk}`.slice(-4096);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      completed = true;
      if (code === 0) resolve();
      else reject(new Error(
        standardError.trim() || `The Windows microphone process stopped with code ${code}.`
      ));
    });
  });
  // A failure while the reader is still recording must be observed even before Stop is pressed.
  void completion.catch(() => undefined);

  return new Promise((resolve, reject) => {
    const failBeforeReady = (error: Error): void => {
      if (!ready) reject(error);
    };
    child.once('error', failBeforeReady);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      standardOutput += chunk;
      if (ready || !standardOutput.includes('KREN_RECORDING_READY')) return;
      ready = true;
      resolve({
        async stop() {
          if (!completed) child.stdin.end('stop\n');
          await completion;
        },
        async cancel() {
          if (!completed) child.stdin.end('cancel\n');
          await completion.catch(() => undefined);
        }
      });
    });
    void completion.then(() => {
      if (!ready) reject(new Error('The microphone stopped before recording began.'));
    }, (error: unknown) => {
      if (!ready) reject(error instanceof Error ? error : new Error('The microphone could not start.'));
    });
  });
}

function wavFormat(bytes: Uint8Array): WavFormat {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' ||
      buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('The microphone produced an invalid WAV recording.');
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunk = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    if (chunk === 'fmt ' && length >= 16 && offset + 8 + length <= buffer.length) {
      return {
        channels: buffer.readUInt16LE(offset + 10),
        sampleRate: buffer.readUInt32LE(offset + 12),
        bitsPerSample: buffer.readUInt16LE(offset + 22)
      };
    }
    offset += 8 + length + (length % 2);
  }
  throw new Error('The microphone WAV recording has no format information.');
}

async function deleteRecording(filePath: string, directory: string): Promise<void> {
  try {
    await rm(filePath, { force: true });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

class OwnedWindowsMciRecording implements WindowsMciRecording {
  private settled = false;

  public constructor(
    public readonly filePath: string,
    private readonly directory: string,
    private readonly native: MciNativeSession
  ) {}

  public async finish<T>(
    consume: (audio: Uint8Array, format: WavFormat) => Promise<T>
  ): Promise<T> {
    if (this.settled) throw new Error('This microphone recording has already ended.');
    this.settled = true;
    try {
      await this.native.stop();
      const audio = await readFile(this.filePath);
      if (audio.length <= 44) throw new Error('The microphone recording was empty.');
      return await consume(audio, wavFormat(audio));
    } finally {
      await this.native.cancel().catch(() => undefined);
      await deleteRecording(this.filePath, this.directory);
    }
  }

  public async cancel(): Promise<void> {
    if (this.settled) return;
    this.settled = true;
    try {
      await this.native.cancel();
    } finally {
      await deleteRecording(this.filePath, this.directory);
    }
  }
}

/** Creates one temporary WAV per explicit dictation and owns every cleanup path. */
export class WindowsMciRecorder {
  private readonly platform: NodeJS.Platform;
  private readonly temporaryRoot: string;
  private readonly startNative: StartMciBoundary;

  public constructor(options: WindowsMciRecorderOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.temporaryRoot = options.temporaryRoot ?? tmpdir();
    this.startNative = options.startNative ?? nativeProcess;
  }

  public async start(): Promise<WindowsMciRecording> {
    if (this.platform !== 'win32') {
      throw new Error('Microphone recording is available only on Windows.');
    }
    const directory = await mkdtemp(join(this.temporaryRoot, 'kren-dictation-'));
    const filePath = join(directory, RECORDING_FILE_NAME);
    try {
      const native = await this.startNative(filePath);
      return new OwnedWindowsMciRecording(filePath, directory, native);
    } catch (error) {
      await deleteRecording(filePath, directory);
      throw error;
    }
  }
}
