import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import type { TutorLiveAudioChunk } from './tutor/liveSession.js';

export type SpawnWaveOutProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcessWithoutNullStreams;

export interface WindowsWaveOutSession {
  play(chunk: TutorLiveAudioChunk): void;
  stop(): void;
  close(): void;
}

export interface WindowsWaveOutPlayerOptions {
  platform?: NodeJS.Platform;
  spawnProcess?: SpawnWaveOutProcess;
}

const READY_SIGNAL = 'KREN_WAVEOUT_READY';
const PROGRESS_SIGNAL = 'KREN_WAVEOUT_PROGRESS';
export const WAVE_OUT_BUFFER_MS = 40;

/**
 * Builds the one in-memory PowerShell program that owns waveOut for a Gemini Live session.
 * The program accepts `play<TAB>rate<TAB>base64`, `stop`, and `close` lines. It never opens
 * a file, and the unmanaged PCM buffers live only until waveOut reports them complete.
 */
export function buildWaveOutPowerShellScript(): string {
  // Progress records go to stderr as CLIXML when the streams are redirected, which a probe on
  // the owner's machine showed on 2026-09-19. Silencing them keeps a real error line readable.
  return `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public sealed class KrenWaveOutPlayer : IDisposable {
  [StructLayout(LayoutKind.Sequential)]
  private struct WaveFormatEx {
    public ushort wFormatTag;
    public ushort nChannels;
    public uint nSamplesPerSec;
    public uint nAvgBytesPerSec;
    public ushort nBlockAlign;
    public ushort wBitsPerSample;
    public ushort cbSize;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct WaveHeader {
    public IntPtr lpData;
    public uint dwBufferLength;
    public uint dwBytesRecorded;
    public IntPtr dwUser;
    public uint dwFlags;
    public uint dwLoops;
    public IntPtr lpNext;
    public IntPtr reserved;
  }

  private sealed class BufferSlot {
    public IntPtr Data;
    public IntPtr Header;
  }

  [DllImport("winmm.dll")]
  private static extern uint waveOutOpen(out IntPtr handle, uint deviceId,
    ref WaveFormatEx format, IntPtr callback, IntPtr instance, uint flags);
  [DllImport("winmm.dll")]
  private static extern uint waveOutPrepareHeader(IntPtr handle, IntPtr header, uint size);
  [DllImport("winmm.dll")]
  private static extern uint waveOutWrite(IntPtr handle, IntPtr header, uint size);
  [DllImport("winmm.dll")]
  private static extern uint waveOutUnprepareHeader(IntPtr handle, IntPtr header, uint size);
  [DllImport("winmm.dll")]
  private static extern uint waveOutReset(IntPtr handle);
  [DllImport("winmm.dll")]
  private static extern uint waveOutClose(IntPtr handle);

  private const uint WaveMapper = 0xFFFFFFFF;
  private const uint HeaderDone = 0x00000001;
  private readonly List<BufferSlot> buffers = new List<BufferSlot>();
  private readonly object sync = new object();
  private readonly System.Threading.Timer completionTimer;
  private readonly uint headerSize = (uint)Marshal.SizeOf(typeof(WaveHeader));
  private IntPtr handle = IntPtr.Zero;
  private int sampleRate;
  private bool disposed;

  public KrenWaveOutPlayer() {
    completionTimer = new System.Threading.Timer(_ => PollCompleted(), null, 10, 10);
  }

  private static void Check(uint code, string operation) {
    if (code != 0) throw new InvalidOperationException(operation + " failed with code " + code + ".");
  }

  private void Open(int rate) {
    WaveFormatEx format = new WaveFormatEx();
    format.wFormatTag = 1;
    format.nChannels = 1;
    format.nSamplesPerSec = (uint)rate;
    format.wBitsPerSample = 16;
    format.nBlockAlign = 2;
    format.nAvgBytesPerSec = (uint)(rate * 2);
    format.cbSize = 0;
    Check(waveOutOpen(out handle, WaveMapper, ref format, IntPtr.Zero, IntPtr.Zero, 0), "waveOutOpen");
    sampleRate = rate;
  }

  private void Free(BufferSlot slot) {
    if (slot.Header != IntPtr.Zero) {
      Check(waveOutUnprepareHeader(handle, slot.Header, headerSize), "waveOutUnprepareHeader");
      Marshal.FreeHGlobal(slot.Header);
      slot.Header = IntPtr.Zero;
    }
    if (slot.Data != IntPtr.Zero) {
      Marshal.FreeHGlobal(slot.Data);
      slot.Data = IntPtr.Zero;
    }
  }

  private int ReapCompleted() {
    int completed = 0;
    for (int index = buffers.Count - 1; index >= 0; index--) {
      WaveHeader header = (WaveHeader)Marshal.PtrToStructure(buffers[index].Header, typeof(WaveHeader));
      if ((header.dwFlags & HeaderDone) == 0) continue;
      Free(buffers[index]);
      buffers.RemoveAt(index);
      completed++;
    }
    return completed;
  }

  private void PollCompleted() {
    try {
      lock (sync) {
        if (disposed || handle == IntPtr.Zero) return;
        int completed = ReapCompleted();
        if (completed > 0) {
          Console.Out.WriteLine("${PROGRESS_SIGNAL}\\t" + completed + "\\t" + buffers.Count);
        }
      }
    } catch (Exception error) {
      Console.Error.WriteLine("KREN waveOut failed: " + error.Message.Replace("\\r", " ").Replace("\\n", " "));
    }
  }

  private void ResetBuffers() {
    if (handle == IntPtr.Zero) return;
    Check(waveOutReset(handle), "waveOutReset");
    for (int index = buffers.Count - 1; index >= 0; index--) {
      Free(buffers[index]);
    }
    buffers.Clear();
  }

  private void Reopen(int rate) {
    ResetBuffers();
    Check(waveOutClose(handle), "waveOutClose");
    handle = IntPtr.Zero;
    sampleRate = 0;
    Open(rate);
  }

  public void Play(byte[] pcm, int rate) {
    lock (sync) {
      if (disposed) throw new ObjectDisposedException("KrenWaveOutPlayer");
      if (pcm == null || pcm.Length == 0) return;
      if ((pcm.Length & 1) != 0) throw new InvalidOperationException("PCM chunk has an incomplete 16-bit sample.");
      if (rate < 8000 || rate > 192000) throw new InvalidOperationException("PCM sample rate is outside the supported range.");
      if (handle == IntPtr.Zero) Open(rate);
      else if (rate != sampleRate) Reopen(rate);

      BufferSlot slot = new BufferSlot();
      try {
        slot.Data = Marshal.AllocHGlobal(pcm.Length);
        Marshal.Copy(pcm, 0, slot.Data, pcm.Length);
        WaveHeader header = new WaveHeader();
        header.lpData = slot.Data;
        header.dwBufferLength = (uint)pcm.Length;
        slot.Header = Marshal.AllocHGlobal((int)headerSize);
        Marshal.StructureToPtr(header, slot.Header, false);
        Check(waveOutPrepareHeader(handle, slot.Header, headerSize), "waveOutPrepareHeader");
        buffers.Add(slot);
        Check(waveOutWrite(handle, slot.Header, headerSize), "waveOutWrite");
      } catch {
        if (!buffers.Contains(slot)) {
          if (slot.Header != IntPtr.Zero) Marshal.FreeHGlobal(slot.Header);
          if (slot.Data != IntPtr.Zero) Marshal.FreeHGlobal(slot.Data);
        }
        throw;
      }
    }
  }

  public void Stop() {
    lock (sync) {
      if (!disposed) ResetBuffers();
    }
  }

  public void Dispose() {
    lock (sync) {
      if (disposed) return;
      disposed = true;
      completionTimer.Dispose();
      if (handle != IntPtr.Zero) {
        ResetBuffers();
        Check(waveOutClose(handle), "waveOutClose");
        handle = IntPtr.Zero;
      }
    }
  }
}
'@
$player = $null
$failed = $false
try {
  $player = New-Object KrenWaveOutPlayer
  [Console]::Out.WriteLine('${READY_SIGNAL}')
  while (($line = [Console]::In.ReadLine()) -ne $null) {
    if ($line -eq 'stop') {
      $player.Stop()
      continue
    }
    if ($line -eq 'close') { break }
    $parts = $line.Split([char]9, 3)
    if ($parts.Length -ne 3 -or $parts[0] -ne 'play') { throw 'Unrecognized waveOut command.' }
    $rate = 0
    if (-not [Int32]::TryParse($parts[1], [ref]$rate)) { throw 'Invalid PCM sample rate.' }
    $pcm = [Convert]::FromBase64String($parts[2])
    $player.Play($pcm, $rate)
  }
} catch {
  $message = ('KREN waveOut failed: ' + $_.Exception.Message) -replace '[\r\n]+', ' '
  [Console]::Error.WriteLine($message)
  $failed = $true
} finally {
  if ($player -ne $null) {
    try { $player.Dispose() } catch {
      if (-not $failed) {
        $message = ('KREN waveOut failed: ' + $_.Exception.Message) -replace '[\r\n]+', ' '
        [Console]::Error.WriteLine($message)
        $failed = $true
      }
    }
  }
}
if ($failed) { exit 1 }`;
}

export function pcmSampleRate(mimeType: string): number {
  const match = /(?:^|;)\s*rate=(\d+)(?:;|$)/iu.exec(mimeType);
  const rate = match ? Number(match[1]) : 24_000;
  if (!Number.isInteger(rate) || rate < 8000 || rate > 192_000) {
    throw new Error(`The Live audio sample rate is invalid: ${mimeType.slice(0, 80)}`);
  }
  return rate;
}

function childEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'PSModulePath']) {
    const entry = Object.entries(process.env).find(([key]) => key.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (entry?.[1] !== undefined) environment[entry[0]] = entry[1];
  }
  return environment;
}

function errorLine(standardError: string, code: number | null): string {
  return standardError.split(/\r?\n/u).find((line) => line.trim())?.trim() ||
    `The Windows Live audio process stopped with code ${code ?? 'unknown'}.`;
}

class OwnedWindowsWaveOutSession implements WindowsWaveOutSession {
  private closed = false;

  public constructor(private readonly child: ChildProcessWithoutNullStreams) {}

  public play(chunk: TutorLiveAudioChunk): void {
    if (this.closed) return;
    const rate = pcmSampleRate(chunk.mimeType);
    const pcm = Buffer.from(chunk.data, 'base64');
    const maxBufferBytes = Math.floor(rate * 2 * WAVE_OUT_BUFFER_MS / 1_000 / 2) * 2;
    for (let offset = 0; offset < pcm.byteLength; offset += maxBufferBytes) {
      this.child.stdin.write(
        `play\t${rate}\t${pcm.subarray(offset, offset + maxBufferBytes).toString('base64')}\n`
      );
    }
  }

  public stop(): void {
    if (!this.closed) this.child.stdin.write('stop\n');
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.child.stdin.end('close\n');
  }
}

/** Starts one long-lived, dependency-free waveOut helper for one Gemini Live session. */
export class WindowsWaveOutPlayer {
  private readonly platform: NodeJS.Platform;
  private readonly spawnProcess: SpawnWaveOutProcess;

  public constructor(options: WindowsWaveOutPlayerOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.spawnProcess = options.spawnProcess ?? ((command, args, spawnOptions) =>
      spawn(command, args, spawnOptions) as ChildProcessWithoutNullStreams);
  }

  public start(
    onError: (error: Error) => void,
    onProgress: (completedBuffers: number, queuedBuffers: number) => void = () => undefined
  ): Promise<WindowsWaveOutSession> {
    if (this.platform !== 'win32') {
      return Promise.reject(new Error('Live audio playback is available only on Windows.'));
    }
    const encoded = Buffer.from(buildWaveOutPowerShellScript(), 'utf16le').toString('base64');
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnProcess(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: childEnvironment() }
      );
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error('The Windows Live audio process could not start.'));
    }

    return new Promise((resolve, reject) => {
      let ready = false;
      let settled = false;
      let standardOutput = '';
      let standardError = '';
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        if (ready) onError(error);
        else reject(error);
      };
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        standardError = `${standardError}${chunk}`.slice(-4096);
      });
      child.stdin.once('error', (error) => fail(error));
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        standardOutput += chunk;
        const lines = standardOutput.split(/\r?\n/u);
        standardOutput = lines.pop() ?? '';
        for (const line of lines) {
          if (!ready && line === READY_SIGNAL) {
            ready = true;
            resolve(new OwnedWindowsWaveOutSession(child));
            continue;
          }
          const progress = new RegExp(`^${PROGRESS_SIGNAL}\\t(\\d+)\\t(\\d+)$`, 'u').exec(line);
          if (ready && progress) onProgress(Number(progress[1]), Number(progress[2]));
        }
      });
      child.once('error', (error) => fail(error));
      child.once('exit', (code) => {
        if (code === 0 && ready) return;
        fail(new Error(errorLine(standardError, code)));
      });
    });
  }
}
