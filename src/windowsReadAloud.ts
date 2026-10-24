import { execFile, spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { prepareTextForSpeech } from '@kren/core/speech';

import { sentencePause, speechSsml, splitSpeechSentences } from './speech/sentencePause.js';

export { prepareTextForSpeech } from '@kren/core/speech';

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

export interface ReadAloudOptions {
  voice?: string;
  rate?: number;
  volume?: number;
  sentencePauseMilliseconds?: number;
  onStarted?: () => void;
}

const WINDOWS_SPEECH_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Speech
$text = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($text)) { exit 2 }
$speaker = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
  if (-not [string]::IsNullOrWhiteSpace($env:KREN_SPEECH_VOICE)) {
    $speaker.SelectVoice($env:KREN_SPEECH_VOICE)
  }
  $speaker.Rate = [Math]::Max(-10, [Math]::Min(10, [int]$env:KREN_SPEECH_RATE))
  $speaker.Volume = [Math]::Max(0, [Math]::Min(100, [int]$env:KREN_SPEECH_VOLUME))
  [Console]::Out.WriteLine('KREN_SPEECH_STARTED')
  $speaker.Speak($text)
} finally {
  $speaker.Dispose()
}
exit 0
`.trim();

// 2026-10-21: Explicitly retain the selected voice, including its regional culture.
const WINDOWS_SSML_SPEECH_SCRIPT = WINDOWS_SPEECH_SCRIPT.replace('$speaker.Speak($text)', String.raw`
  $ssml = [xml]$text
  $root = $ssml.DocumentElement
  $root.SetAttribute('xml:lang', $speaker.Voice.Culture.Name)
  $voice = $ssml.CreateElement('voice', $root.NamespaceURI)
  $voice.SetAttribute('name', $speaker.Voice.Name)
  while ($root.HasChildNodes) { [void]$voice.AppendChild($root.FirstChild) }
  [void]$root.AppendChild($voice)
  $speaker.SpeakSsml($ssml.OuterXml)
`.trim());

const WINDOWS_VOICE_LIST_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Speech
$speaker = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
  $voices = @($speaker.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name })
  ConvertTo-Json -InputObject $voices -Compress
} finally {
  $speaker.Dispose()
}
`.trim();

export class WindowsReadAloudPlayer {
  private active: ChildProcess | undefined;
  private generation = 0;

  public constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly spawnProcess: SpawnProcess = (command, args, options) =>
      spawn(command, args, options)
  ) {}

  public async speak(text: string, options: ReadAloudOptions = {}): Promise<boolean> {
    const spokenText = prepareTextForSpeech(text);
    if (this.platform !== 'win32' || !spokenText) return false;

    const pause = sentencePause(options.sentencePauseMilliseconds);
    const generation = ++this.generation;
    this.active?.kill();

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
          pause > 0 ? WINDOWS_SSML_SPEECH_SCRIPT : WINDOWS_SPEECH_SCRIPT
        ],
        {
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'ignore'],
          env: windowsSpeechEnvironment(options)
        }
      );
    } catch {
      return false;
    }
    this.active = child;
    // 2026-10-12: Report the player start, after voice setup, rather than process launch.
    let started = false;
    let output = '';
    child.stdout?.on('data', (chunk: Buffer | string) => {
      output = (output + chunk.toString()).slice(-64);
      if (!started && this.generation === generation && output.includes('KREN_SPEECH_STARTED')) {
        started = true;
        options.onStarted?.();
      }
    });

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (completed: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (this.active === child) this.active = undefined;
        resolve(this.generation === generation ? completed : true);
      };
      const pauseDuration = pause > 0 ? Math.max(0, splitSpeechSentences(spokenText).length - 1) * pause : 0;
      const timeoutMs = Math.min(600_000, Math.max(30_000, spokenText.length * 180) + pauseDuration);
      const timeout = setTimeout(() => {
        child.kill();
        finish(false);
      }, timeoutMs);
      child.once('error', () => finish(false));
      child.once('exit', (code) => finish(code === 0));
      if (!child.stdin) {
        child.kill();
        finish(false);
        return;
      }
      child.stdin.once('error', () => finish(false));
      child.stdin.end(pause > 0 ? speechSsml(spokenText, pause) : spokenText, 'utf8');
    });
  }

  public stop(): boolean {
    this.generation += 1;
    const active = this.active;
    this.active = undefined;
    return active?.kill() ?? false;
  }

  public dispose(): void {
    this.stop();
  }
}

export async function listWindowsSpeechVoices(
  platform: NodeJS.Platform = process.platform
): Promise<string[]> {
  if (platform !== 'win32') return [];
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-Command',
        WINDOWS_VOICE_LIST_SCRIPT
      ],
      {
        windowsHide: true,
        timeout: 10_000,
        encoding: 'utf8',
        env: restrictedWindowsEnvironment()
      },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        try {
          const parsed: unknown = JSON.parse(stdout.trim() || '[]');
          const voices = (Array.isArray(parsed) ? parsed : [parsed])
            .filter((voice): voice is string => typeof voice === 'string' && Boolean(voice.trim()))
            .map((voice) => voice.trim());
          resolve([...new Set(voices)].sort((left, right) => left.localeCompare(right)));
        } catch {
          resolve([]);
        }
      }
    );
  });
}

function windowsSpeechEnvironment(options: ReadAloudOptions): NodeJS.ProcessEnv {
  return {
    ...restrictedWindowsEnvironment(),
    KREN_SPEECH_VOICE: options.voice?.trim() ?? '',
    KREN_SPEECH_RATE: String(clampInteger(options.rate, -10, 10, 0)),
    KREN_SPEECH_VOLUME: String(clampInteger(options.volume, 0, 100, 100))
  };
}

function restrictedWindowsEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ['SystemRoot', 'WINDIR', 'Path', 'PATH', 'PATHEXT', 'TEMP', 'TMP']) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
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
