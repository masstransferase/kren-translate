import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareTextForSpeech } from './windowsReadAloud.js';
import { EDGE_SPEECH_LOCALES } from '@kren/core/edge-speech';

export type SpeechVoiceGender = 'female' | 'male';

/** Reads the catalog's own `(Female)` or `(Male)` label instead of guessing from a name. */
export function edgeSpeechVoiceGender(voiceId: string): SpeechVoiceGender | undefined {
  const voice = EDGE_SPEECH_LOCALES.flatMap((locale) => locale.voices)
    .find((candidate) => candidate.id === voiceId);
  if (/\(Female\)$/u.test(voice?.label ?? '')) return 'female';
  if (/\(Male\)$/u.test(voice?.label ?? '')) return 'male';
  return undefined;
}

// Ava, not Ana: en-US-AnaNeural is Microsoft's child voice, although the catalog labels it only
// "(Female)", and the owner heard a four-year-old reading their answers (2026-09-19).
export function otherGenderEdgeVoice(
  gender: SpeechVoiceGender | undefined,
  defaults: { female: string; male: string }
): string {
  return gender === 'male' ? defaults.female : defaults.male;
}

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

export interface EdgeTemporaryAudio {
  directory: string;
  file: string;
}

type CreateEdgeTemporaryAudio = () => Promise<EdgeTemporaryAudio>;
type RemoveEdgeTemporaryAudio = (audio: EdgeTemporaryAudio) => Promise<void>;
type VerifyAudio = (file: string) => Promise<boolean>;

export interface EdgeReadAloudOptions {
  pythonCommand?: string;
  voice?: string;
  ratePercent?: number;
  volume?: number;
  playback?: EdgeAudioPlayback;
  onStarted?: () => void;
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

export interface EdgeActiveSpeech {
  processes: Set<ChildProcess>;
  audio: EdgeTemporaryAudio;
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
  [Console]::Out.WriteLine('KREN_SPEECH_STARTED')
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

export class WindowsEdgeReadAloudTransport {
  private active: EdgeActiveSpeech | undefined;
  protected generation = 0;

  public constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly spawnProcess: SpawnProcess = (command, args, options) =>
      spawn(command, args, options),
    private readonly createTemporaryAudio: CreateEdgeTemporaryAudio = createEdgeTemporaryAudio,
    private readonly removeTemporaryAudio: RemoveEdgeTemporaryAudio = removeEdgeTemporaryAudio,
    private readonly verifyAudio: VerifyAudio = verifyEdgeAudio,
    private readonly writeAudio: (file: string, audio: Buffer) => Promise<void> = writeFile
  ) {}

  // 2026-10-13: Cloud Read Aloud uses the existing hidden player when the panel is closed.
  public async playBase64(audioBase64: string, volume: number, onStarted?: () => void): Promise<EdgeReadAloudResult> {
    if (this.platform !== 'win32') return 'failed';
    this.stop();
    const generation = ++this.generation;
    let audio: EdgeTemporaryAudio;
    try { audio = await this.createTemporaryAudio(); } catch { return 'failed'; }
    if (generation !== this.generation) {
      await this.removeTemporaryAudio(audio).catch(() => undefined);
      return 'stopped';
    }
    const active: EdgeActiveSpeech = { generation, audio, processes: new Set<ChildProcess>() };
    this.active = active;
    try {
      await this.writeAudio(audio.file, Buffer.from(audioBase64, 'base64'));
      if (generation !== this.generation) return 'stopped';
      if (!await this.verifyAudio(audio.file)) return 'failed';
      if (generation !== this.generation) return 'stopped';
      const playback = this.startAudioPlayback(audio.file, volume, active, onStarted);
      return playback ? await playback.completion : 'failed';
    } catch { return generation === this.generation ? 'failed' : 'stopped'; }
    finally { await this.finish(active); }
  }

  public async speak(
    text: string,
    options: EdgeReadAloudOptions = {}
  ): Promise<EdgeReadAloudResult> {
    const spokenText = prepareTextForSpeech(text);
    if (this.platform !== 'win32' || !spokenText) return 'failed';

    this.stop();
    const generation = ++this.generation;
    let audio: EdgeTemporaryAudio;
    try {
      audio = await this.createTemporaryAudio();
    } catch {
      return 'failed';
    }
    if (this.generation !== generation) {
      await this.removeTemporaryAudio(audio).catch(() => undefined);
      return 'stopped';
    }

    const active: EdgeActiveSpeech = { generation, audio, processes: new Set<ChildProcess>() };
    this.active = active;
    const useExternalPlayback = Boolean(options.playback);
    const playback = useExternalPlayback
      ? undefined
      : this.startAudioPlayback(audio.file, 100, active, options.onStarted);
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
      playbackResult = await this.playExternalAudio(options, audio, active);
      active.stopExternal = undefined;
    } else {
      playbackResult = await playback?.completion ?? 'failed';
    }
    await this.finish(active);
    return playbackResult;
  }

  protected playExternalAudio(options: EdgeReadAloudOptions, audio: EdgeTemporaryAudio, _active: EdgeActiveSpeech): Promise<EdgeReadAloudResult> {
    return options.playback!.play(audio.file);
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
    audio: EdgeTemporaryAudio,
    options: EdgeReadAloudOptions,
    active: EdgeActiveSpeech
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

  protected startAudioPlayback(
    audioFile: string,
    volume: number | undefined,
    active: EdgeActiveSpeech,
    onStarted?: () => void
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
          stdio: ['ignore', 'pipe', 'ignore'],
          env: edgePlaybackEnvironment(audioFile, volume)
        }
      );
    } catch {
      return undefined;
    }
    active.processes.add(child);
    let started = false;
    let output = '';
    child.stdout?.on('data', (chunk: Buffer | string) => {
      output = (output + chunk.toString()).slice(-64);
      if (!started && this.generation === active.generation && output.includes('KREN_SPEECH_STARTED')) {
        started = true;
        onStarted?.();
      }
    });
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

  private async finish(active: EdgeActiveSpeech): Promise<void> {
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

async function createEdgeTemporaryAudio(): Promise<EdgeTemporaryAudio> {
  const directory = await mkdtemp(join(tmpdir(), 'kren-edge-tts-'));
  return { directory, file: join(directory, 'speech.mp3') };
}

async function removeEdgeTemporaryAudio(audio: EdgeTemporaryAudio): Promise<void> {
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
