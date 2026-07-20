import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareTextForSpeech } from './windowsReadAloud.js';

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

interface TemporaryAudio {
  directory: string;
  file: string;
}

type CreateTemporaryAudio = () => Promise<TemporaryAudio>;
type RemoveTemporaryAudio = (audio: TemporaryAudio) => Promise<void>;
type VerifyAudio = (file: string) => Promise<boolean>;

export interface EdgeReadAloudOptions {
  pythonCommand?: string;
  voice?: string;
  ratePercent?: number;
  volume?: number;
  playback?: EdgeAudioPlayback;
}

export type EdgeReadAloudResult =
  | 'completed'
  | 'stopped'
  | 'dependencyMissing'
  | 'failed';

export interface EdgeAudioPlayback {
  play(file: string): Promise<EdgeReadAloudResult>;
  stop(): boolean;
}

interface ActiveSpeech {
  processes: Set<ChildProcess>;
  audio: TemporaryAudio;
  generation: number;
  stopExternal?: () => boolean;
}

const EDGE_TTS_SCRIPT = String.raw`
import asyncio
import os
import sys

try:
    import edge_tts
except ModuleNotFoundError:
    raise SystemExit(3)

text = sys.stdin.read()
if not text.strip():
    raise SystemExit(2)

async def main():
    communicate = edge_tts.Communicate(
        text,
        os.environ['KREN_EDGE_VOICE'],
        rate=os.environ['KREN_EDGE_RATE'],
        volume=os.environ['KREN_EDGE_VOLUME']
    )
    partial = os.environ['KREN_EDGE_AUDIO_PART']
    await communicate.save(partial)
    os.replace(partial, os.environ['KREN_EDGE_AUDIO_FILE'])

asyncio.run(main())
`.trim();

const WINDOWS_AUDIO_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
$script:krenFailed = $false
$script:krenTimedOut = $false
$script:krenFrame = New-Object System.Windows.Threading.DispatcherFrame
$player = New-Object System.Windows.Media.MediaPlayer
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMinutes(10)
$timer.add_Tick({
  $script:krenTimedOut = $true
  $script:krenFrame.Continue = $false
})
$player.add_MediaEnded({ $script:krenFrame.Continue = $false })
$player.add_MediaFailed({
  $script:krenFailed = $true
  $script:krenFrame.Continue = $false
})
try {
  $readyDeadline = [DateTime]::UtcNow.AddSeconds(90)
  while (-not [IO.File]::Exists($env:KREN_AUDIO_FILE)) {
    if ([DateTime]::UtcNow -ge $readyDeadline) { throw 'Timed out waiting for Edge audio.' }
    [Threading.Thread]::Sleep(25)
  }
  $player.Open([Uri]::new($env:KREN_AUDIO_FILE, [UriKind]::Absolute))
  $player.Volume = [Math]::Max(0, [Math]::Min(1, ([double]$env:KREN_AUDIO_VOLUME / 100)))
  $timer.Start()
  $player.Play()
  [System.Windows.Threading.Dispatcher]::PushFrame($script:krenFrame)
} catch {
  $script:krenFailed = $true
} finally {
  $timer.Stop()
  $player.Stop()
  $player.Close()
}
if ($script:krenFailed -or $script:krenTimedOut) { exit 1 }
exit 0
`.trim();

export class WindowsEdgeReadAloudPlayer {
  private active: ActiveSpeech | undefined;
  private generation = 0;

  public constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly spawnProcess: SpawnProcess = (command, args, options) =>
      spawn(command, args, options),
    private readonly createTemporaryAudio: CreateTemporaryAudio = createEdgeTemporaryAudio,
    private readonly removeTemporaryAudio: RemoveTemporaryAudio = removeEdgeTemporaryAudio,
    private readonly verifyAudio: VerifyAudio = verifyEdgeAudio
  ) {}

  public async speak(
    text: string,
    options: EdgeReadAloudOptions = {}
  ): Promise<EdgeReadAloudResult> {
    const spokenText = prepareTextForSpeech(text);
    if (this.platform !== 'win32' || !spokenText) return 'failed';

    this.stop();
    const generation = ++this.generation;
    let audio: TemporaryAudio;
    try {
      audio = await this.createTemporaryAudio();
    } catch {
      return 'failed';
    }
    if (this.generation !== generation) {
      await this.removeTemporaryAudio(audio).catch(() => undefined);
      return 'stopped';
    }

    const active: ActiveSpeech = { generation, audio, processes: new Set<ChildProcess>() };
    this.active = active;
    const useExternalPlayback = Boolean(options.playback);
    const playback = useExternalPlayback
      ? undefined
      : this.startAudioPlayback(audio.file, 100, active);
    if (!useExternalPlayback && !playback) {
        await this.finish(active);
        return 'failed';
    }
    const synthesis = await this.synthesize(spokenText, audio, options, active);
    if (synthesis !== 'completed') {
      if (this.generation === generation) playback?.child.kill();
      if (playback) await playback.completion;
      await this.finish(active);
      return synthesis;
    }
    if (this.generation !== generation) {
      await this.finish(active);
      return 'stopped';
    }
    if (!await this.verifyAudio(audio.file)) {
      playback?.child.kill();
      if (playback) await playback.completion;
      await this.finish(active);
      return 'failed';
    }

    let playbackResult: EdgeReadAloudResult;
    if (options.playback) {
      active.stopExternal = () => options.playback?.stop() ?? false;
      playbackResult = await options.playback.play(audio.file);
      active.stopExternal = undefined;
      if (playbackResult === 'failed' && this.generation === generation) {
        const fallback = this.startAudioPlayback(audio.file, 100, active);
        playbackResult = fallback ? await fallback.completion : 'failed';
      }
    } else {
      playbackResult = await playback?.completion ?? 'failed';
    }
    await this.finish(active);
    return playbackResult;
  }

  public stop(): boolean {
    this.generation += 1;
    const active = this.active;
    this.active = undefined;
    let stopped = false;
    for (const child of active?.processes ?? []) stopped = child.kill() || stopped;
    stopped = active?.stopExternal?.() || stopped;
    active?.processes.clear();
    if (active?.audio) void this.removeTemporaryAudio(active.audio).catch(() => undefined);
    return stopped;
  }

  public dispose(): void {
    this.stop();
  }

  private async synthesize(
    text: string,
    audio: TemporaryAudio,
    options: EdgeReadAloudOptions,
    active: ActiveSpeech
  ): Promise<EdgeReadAloudResult> {
    const pythonCommand = safePythonCommand(options.pythonCommand);
    const voice = safeEdgeVoice(options.voice);
    const rate = clampInteger(options.ratePercent, -50, 100, 0);
    let child: ChildProcess;
    try {
      child = this.spawnProcess(
        pythonCommand,
        ['-c', EDGE_TTS_SCRIPT],
        {
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'ignore', 'ignore'],
          env: edgeSynthesisEnvironment(audio.file, voice, rate, options.volume)
        }
      );
    } catch {
      return 'failed';
    }
    active.processes.add(child);
    return new Promise<EdgeReadAloudResult>((resolve) => {
      let settled = false;
      const finish = (result: EdgeReadAloudResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        active.processes.delete(child);
        resolve(this.generation === active.generation ? result : 'stopped');
      };
      const timeout = setTimeout(() => {
        child.kill();
        finish('failed');
      }, 90_000);
      child.once('error', () => finish('failed'));
      child.once('exit', (code) => {
        if (code === 0) finish('completed');
        else if (code === 3) finish('dependencyMissing');
        else finish('failed');
      });
      if (!child.stdin) {
        child.kill();
        finish('failed');
        return;
      }
      child.stdin.once('error', () => finish('failed'));
      child.stdin.end(text, 'utf8');
    });
  }

  private startAudioPlayback(
    audioFile: string,
    volume: number | undefined,
    active: ActiveSpeech
  ): { child: ChildProcess; completion: Promise<EdgeReadAloudResult> } | undefined {
    let child: ChildProcess;
    try {
      child = this.spawnProcess(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-STA',
          '-WindowStyle',
          'Hidden',
          '-Command',
          WINDOWS_AUDIO_SCRIPT
        ],
        {
          shell: false,
          windowsHide: true,
          stdio: 'ignore',
          env: edgePlaybackEnvironment(audioFile, volume)
        }
      );
    } catch {
      return undefined;
    }
    active.processes.add(child);
    const completion = new Promise<EdgeReadAloudResult>((resolve) => {
      let settled = false;
      const finish = (result: EdgeReadAloudResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        active.processes.delete(child);
        resolve(this.generation === active.generation ? result : 'stopped');
      };
      const timeout = setTimeout(() => {
        child.kill();
        finish('failed');
      }, 610_000);
      child.once('error', () => finish('failed'));
      child.once('exit', (code) => finish(code === 0 ? 'completed' : 'failed'));
    });
    return { child, completion };
  }

  private async finish(active: ActiveSpeech): Promise<void> {
    if (this.active?.generation === active.generation) this.active = undefined;
    for (const child of active.processes) child.kill();
    active.processes.clear();
    if (active.audio) await this.removeTemporaryAudio(active.audio).catch(() => undefined);
  }
}

function safePythonCommand(value: string | undefined): string {
  const command = value?.trim();
  if (!command || /[\r\n\0]/u.test(command)) return 'python';
  return command;
}

function safeEdgeVoice(value: string | undefined): string {
  const voice = value?.trim();
  return voice && /^[A-Za-z0-9-]{3,100}$/u.test(voice)
    ? voice
    : 'en-US-ChristopherNeural';
}

function edgeSynthesisEnvironment(
  audioFile: string,
  voice: string,
  ratePercent: number,
  volume: number | undefined
): NodeJS.ProcessEnv {
  const absoluteVolume = clampInteger(volume, 0, 100, 100);
  const relativeVolume = absoluteVolume - 100;
  return {
    ...restrictedWindowsEnvironment(),
    PYTHONUTF8: '1',
    KREN_EDGE_AUDIO_FILE: audioFile,
    KREN_EDGE_AUDIO_PART: `${audioFile}.partial`,
    KREN_EDGE_VOICE: voice,
    KREN_EDGE_RATE: `${ratePercent >= 0 ? '+' : ''}${ratePercent}%`,
    KREN_EDGE_VOLUME: `${relativeVolume >= 0 ? '+' : ''}${relativeVolume}%`
  };
}

function edgePlaybackEnvironment(
  audioFile: string,
  volume: number | undefined
): NodeJS.ProcessEnv {
  return {
    ...restrictedWindowsEnvironment(),
    KREN_AUDIO_FILE: audioFile,
    KREN_AUDIO_VOLUME: String(clampInteger(volume, 0, 100, 100))
  };
}

function restrictedWindowsEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of [
    'SystemRoot', 'WINDIR', 'Path', 'PATH', 'PATHEXT', 'TEMP', 'TMP',
    'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA'
  ]) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

async function createEdgeTemporaryAudio(): Promise<TemporaryAudio> {
  const directory = await mkdtemp(join(tmpdir(), 'kren-edge-tts-'));
  return { directory, file: join(directory, 'speech.mp3') };
}

async function removeEdgeTemporaryAudio(audio: TemporaryAudio): Promise<void> {
  await rm(audio.directory, { recursive: true, force: true });
}

async function verifyEdgeAudio(file: string): Promise<boolean> {
  try {
    const information = await stat(file);
    return information.isFile() && information.size > 0 && information.size <= 25_000_000;
  } catch {
    return false;
  }
}

function clampInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(value ?? fallback)));
}
