import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';

export type SpawnWaveInProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcessWithoutNullStreams;

export interface WindowsWaveInSession {
  stop(): void;
  /** Resolves after the helper releases the microphone and delivers its final PCM. */
  readonly closed?: Promise<void>;
}

export interface WindowsWaveInRecorderOptions {
  platform?: NodeJS.Platform;
  spawnProcess?: SpawnWaveInProcess;
}

const READY_SIGNAL = 'KREN_WAVEIN_READY';
/** How long a stopped helper may take to close the microphone before it is ended. */
export const WAVEIN_STOP_TIMEOUT_MS = 8000;

/**
 * Builds the in-memory PowerShell program that owns waveIn for one Live microphone stream.
 * Four 100 ms buffers are reused in place. Each completed buffer is written as one base64
 * line, and no recording or temporary file is created.
 */
export function buildWaveInPowerShellScript(): string {
  // Redirected PowerShell progress records can arrive as CLIXML on stderr. V122 found this
  // on the owner's machine, so the capture helper applies the same suppression as playback.
  return `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

public sealed class KrenWaveInRecorder : IDisposable {
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
  private static extern uint waveInOpen(out IntPtr handle, uint deviceId,
    ref WaveFormatEx format, IntPtr callback, IntPtr instance, uint flags);
  [DllImport("winmm.dll")]
  private static extern uint waveInPrepareHeader(IntPtr handle, IntPtr header, uint size);
  [DllImport("winmm.dll")]
  private static extern uint waveInAddBuffer(IntPtr handle, IntPtr header, uint size);
  [DllImport("winmm.dll")]
  private static extern uint waveInStart(IntPtr handle);
  [DllImport("winmm.dll")]
  private static extern uint waveInStop(IntPtr handle);
  [DllImport("winmm.dll")]
  private static extern uint waveInReset(IntPtr handle);
  [DllImport("winmm.dll")]
  private static extern uint waveInUnprepareHeader(IntPtr handle, IntPtr header, uint size);
  [DllImport("winmm.dll")]
  private static extern uint waveInClose(IntPtr handle);

  private const uint WaveMapper = 0xFFFFFFFF;
  private const uint HeaderDone = 0x00000001;
  private const int BufferBytes = 3200;
  private const int BufferCount = 4;
  private readonly List<BufferSlot> buffers = new List<BufferSlot>();
  private readonly uint headerSize = (uint)Marshal.SizeOf(typeof(WaveHeader));
  private IntPtr handle = IntPtr.Zero;
  private int nextSlot;
  private volatile bool stopRequested;
  private volatile string inputError;
  private bool disposed;

  private static void Check(uint code, string operation) {
    if (code != 0) throw new InvalidOperationException(operation + " failed with code " + code + ".");
  }

  private void Open() {
    WaveFormatEx format = new WaveFormatEx();
    format.wFormatTag = 1;
    format.nChannels = 1;
    format.nSamplesPerSec = 16000;
    format.nAvgBytesPerSec = 32000;
    format.nBlockAlign = 2;
    format.wBitsPerSample = 16;
    format.cbSize = 0;
    Check(waveInOpen(out handle, WaveMapper, ref format, IntPtr.Zero, IntPtr.Zero, 0), "waveInOpen");
  }

  private void AllocateBuffers() {
    for (int index = 0; index < BufferCount; index++) {
      BufferSlot slot = new BufferSlot();
      slot.Data = Marshal.AllocHGlobal(BufferBytes);
      WaveHeader header = new WaveHeader();
      header.lpData = slot.Data;
      header.dwBufferLength = BufferBytes;
      slot.Header = Marshal.AllocHGlobal((int)headerSize);
      Marshal.StructureToPtr(header, slot.Header, false);
      Check(waveInPrepareHeader(handle, slot.Header, headerSize), "waveInPrepareHeader");
      buffers.Add(slot);
      Check(waveInAddBuffer(handle, slot.Header, headerSize), "waveInAddBuffer");
    }
  }

  private void StartInputReader() {
    Thread input = new Thread(() => {
      try {
        string line = Console.In.ReadLine();
        if (line != null && line != "stop") inputError = "Unrecognized waveIn command.";
      } catch (Exception error) {
        inputError = error.Message;
      } finally {
        stopRequested = true;
      }
    });
    input.IsBackground = true;
    input.Start();
  }

  // Buffers fill in the order they were queued, so read them from the oldest one onwards and
  // stop at the first unfilled buffer: a fixed slot order sent audio out of order whenever two
  // buffers filled between polls across the wrap from the last slot to the first.
  private void WriteCompletedBuffers() {
    while (true) {
      BufferSlot slot = buffers[nextSlot];
      WaveHeader header = (WaveHeader)Marshal.PtrToStructure(slot.Header, typeof(WaveHeader));
      if ((header.dwFlags & HeaderDone) == 0) return;
      if (header.dwBytesRecorded > 0) {
        byte[] pcm = new byte[header.dwBytesRecorded];
        Marshal.Copy(slot.Data, pcm, 0, pcm.Length);
        Console.Out.WriteLine(Convert.ToBase64String(pcm));
        Console.Out.Flush();
      }
      // Clear the filled mark before requeueing, so a slow driver cannot make the next poll
      // send the same audio twice.
      header.dwBytesRecorded = 0;
      header.dwFlags &= ~HeaderDone;
      Marshal.StructureToPtr(header, slot.Header, false);
      Check(waveInAddBuffer(handle, slot.Header, headerSize), "waveInAddBuffer");
      nextSlot = (nextSlot + 1) % buffers.Count;
    }
  }

  public void Run() {
    if (disposed) throw new ObjectDisposedException("KrenWaveInRecorder");
    Open();
    AllocateBuffers();
    Check(waveInStart(handle), "waveInStart");
    Console.Out.WriteLine("${READY_SIGNAL}");
    Console.Out.Flush();
    StartInputReader();
    while (!stopRequested) {
      WriteCompletedBuffers();
      if (inputError != null) throw new InvalidOperationException(inputError);
      Thread.Sleep(5);
    }
    if (inputError != null) throw new InvalidOperationException(inputError);
  }

  public void Dispose() {
    if (disposed) return;
    disposed = true;
    if (handle != IntPtr.Zero) {
      Check(waveInStop(handle), "waveInStop");
      Check(waveInReset(handle), "waveInReset");
      for (int offset = 0; offset < buffers.Count; offset++) {
        BufferSlot slot = buffers[(nextSlot + offset) % buffers.Count];
        WaveHeader header = (WaveHeader)Marshal.PtrToStructure(slot.Header, typeof(WaveHeader));
        if (header.dwBytesRecorded > 0) {
          byte[] pcm = new byte[header.dwBytesRecorded];
          Marshal.Copy(slot.Data, pcm, 0, pcm.Length);
          Console.Out.WriteLine(Convert.ToBase64String(pcm));
          Console.Out.Flush();
        }
        Check(waveInUnprepareHeader(handle, slot.Header, headerSize), "waveInUnprepareHeader");
        Marshal.FreeHGlobal(slot.Header);
        Marshal.FreeHGlobal(slot.Data);
      }
      buffers.Clear();
      Check(waveInClose(handle), "waveInClose");
      handle = IntPtr.Zero;
    }
  }
}
'@
$recorder = $null
$failed = $false
try {
  $recorder = New-Object KrenWaveInRecorder
  $recorder.Run()
} catch {
  $message = ('KREN waveIn failed: ' + $_.Exception.Message) -replace '[\r\n]+', ' '
  [Console]::Error.WriteLine($message)
  $failed = $true
} finally {
  if ($recorder -ne $null) {
    try { $recorder.Dispose() } catch {
      if (-not $failed) {
        $message = ('KREN waveIn failed: ' + $_.Exception.Message) -replace '[\r\n]+', ' '
        [Console]::Error.WriteLine($message)
        $failed = $true
      }
    }
  }
}
if ($failed) { exit 1 }`;
}

function childEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'PSModulePath']) {
    const entry = Object.entries(process.env).find(([key]) =>
      key.toLocaleLowerCase() === name.toLocaleLowerCase()
    );
    if (entry?.[1] !== undefined) environment[entry[0]] = entry[1];
  }
  return environment;
}

function errorLine(standardError: string, code: number | null): string {
  return standardError.split(/\r?\n/u).find((line) => line.trim())?.trim() ||
    `The Windows Live microphone process stopped with code ${code ?? 'unknown'}.`;
}

class OwnedWindowsWaveInSession implements WindowsWaveInSession {
  private stopped = false;

  public constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly stopTimeoutMs: number,
    public readonly closed: Promise<void>
  ) {}

  public stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    // The reader's microphone must not stay open because the helper hung while closing it.
    const deadline = setTimeout(() => this.child.kill(), this.stopTimeoutMs);
    deadline.unref?.();
    this.child.once('exit', () => clearTimeout(deadline));
    this.child.stdin.end('stop\n');
  }
}

/** Starts one dependency-free waveIn helper after an explicit Talk button press. */
export class WindowsWaveInRecorder {
  private readonly platform: NodeJS.Platform;
  private readonly spawnProcess: SpawnWaveInProcess;

  public constructor(options: WindowsWaveInRecorderOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.spawnProcess = options.spawnProcess ?? ((command, args, spawnOptions) =>
      spawn(command, args, spawnOptions) as ChildProcessWithoutNullStreams);
  }

  public start(
    onChunk: (base64Pcm: string) => void,
    onError: (error: Error) => void,
    stopTimeoutMs = WAVEIN_STOP_TIMEOUT_MS
  ): Promise<WindowsWaveInSession> {
    if (this.platform !== 'win32') {
      return Promise.reject(new Error('Live microphone capture is available only on Windows.'));
    }
    const encoded = Buffer.from(buildWaveInPowerShellScript(), 'utf16le').toString('base64');
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnProcess(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: childEnvironment() }
      );
    } catch (error) {
      return Promise.reject(error instanceof Error
        ? error : new Error('The Windows Live microphone process could not start.'));
    }

    let resolveClosed!: () => void;
    let rejectClosed!: (error: Error) => void;
    const closed = new Promise<void>((resolve, reject) => { resolveClosed = resolve; rejectClosed = reject; });
    void closed.catch(() => undefined);
    return new Promise((resolve, reject) => {
      let ready = false;
      let settled = false;
      let standardOutput = '';
      let standardError = '';
      const fail = (error: Error): void => {
        rejectClosed(error);
        if (settled && !ready) return;
        if (ready) {
          onError(error);
          return;
        }
        settled = true;
        reject(error);
      };
      const processLines = (): void => {
        let newline = standardOutput.indexOf('\n');
        while (newline >= 0) {
          const line = standardOutput.slice(0, newline).replace(/\r$/u, '');
          standardOutput = standardOutput.slice(newline + 1);
          if (!ready) {
            if (line === READY_SIGNAL) {
              ready = true;
              settled = true;
              const closeDeadline = Number.isFinite(stopTimeoutMs) && stopTimeoutMs > 0
                ? stopTimeoutMs
                : WAVEIN_STOP_TIMEOUT_MS;
              resolve(new OwnedWindowsWaveInSession(child, closeDeadline, closed));
            } else if (line.trim()) {
              fail(new Error('The Windows Live microphone process returned an invalid ready signal.'));
            }
          } else if (line) {
            onChunk(line);
          }
          newline = standardOutput.indexOf('\n');
        }
      };
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        standardError = `${standardError}${chunk}`.slice(-4096);
      });
      child.stdin.once('error', (error) => fail(error));
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        standardOutput += chunk;
        processLines();
      });
      child.once('error', (error) => fail(error));
      child.once('exit', (code) => {
        if (code === 0 && ready) return;
        fail(new Error(errorLine(standardError, code)));
      });
      // exit can precede the final stdout data; close follows the drained streams.
      child.once('close', (code) => {
        if (code === 0 && ready) resolveClosed();
      });
    });
  }
}
