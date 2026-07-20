import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isAllowedPronunciationUrl } from './pronunciation.js';

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

interface DownloadedAudio {
  directory: string;
  file: string;
}

type DownloadAudio = (audioUrl: string) => Promise<DownloadedAudio>;
type RemoveAudio = (audio: DownloadedAudio) => Promise<void>;

const WINDOWS_PLAYER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
$script:krenFailed = $false
$script:krenTimedOut = $false
$script:krenFrame = New-Object System.Windows.Threading.DispatcherFrame
$player = New-Object System.Windows.Media.MediaPlayer
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds(10)
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
  $player.Open([Uri]::new($env:KREN_AUDIO_FILE, [UriKind]::Absolute))
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

export class WindowsPronunciationPlayer {
  private active: ChildProcess | undefined;
  private generation = 0;

  public constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly spawnProcess: SpawnProcess = (command, args, options) =>
      spawn(command, args, options),
    private readonly downloadAudio: DownloadAudio = downloadPronunciationAudio,
    private readonly removeAudio: RemoveAudio = removePronunciationAudio
  ) {}

  public async play(audioUrl: string): Promise<boolean> {
    if (this.platform !== 'win32' || !isAllowedPronunciationUrl(audioUrl)) return false;
    const generation = ++this.generation;
    this.active?.kill();

    let audio: DownloadedAudio;
    try {
      audio = await this.downloadAudio(audioUrl);
    } catch {
      return false;
    }
    if (this.generation !== generation) {
      await this.removeAudio(audio).catch(() => undefined);
      return true;
    }

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
          WINDOWS_PLAYER_SCRIPT
        ],
        {
          shell: false,
          windowsHide: true,
          stdio: 'ignore',
          env: windowsPlayerEnvironment(audio.file)
        }
      );
    } catch {
      await this.removeAudio(audio).catch(() => undefined);
      return false;
    }
    this.active = child;

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (played: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (this.active === child) this.active = undefined;
        // A newer pronunciation deliberately superseded this one; do not reveal the webview.
        void this.removeAudio(audio)
          .catch(() => undefined)
          .then(() => resolve(this.generation === generation ? played : true));
      };
      const timeout = setTimeout(() => {
        child.kill();
        finish(false);
      }, 12000);
      child.once('error', () => finish(false));
      child.once('exit', (code) => finish(code === 0));
    });
  }

  public dispose(): void {
    this.generation += 1;
    this.active?.kill();
    this.active = undefined;
  }
}

function windowsPlayerEnvironment(audioFile: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { KREN_AUDIO_FILE: audioFile };
  // Keep unrelated extension-host secrets out of the pronunciation subprocess.
  for (const key of ['SystemRoot', 'WINDIR', 'Path', 'PATH', 'PATHEXT', 'TEMP', 'TMP']) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

export async function downloadPronunciationAudio(audioUrl: string): Promise<DownloadedAudio> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  let directory: string | undefined;
  try {
    const response = await fetch(audioUrl, {
      redirect: 'error',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Pronunciation download failed (${response.status}).`);
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > 2_000_000) {
      throw new Error('Pronunciation audio exceeded the size limit.');
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 2_000_000) {
      throw new Error('Pronunciation audio was empty or exceeded the size limit.');
    }
    directory = await mkdtemp(join(tmpdir(), 'kren-pronunciation-'));
    const file = join(directory, 'pronunciation.mp3');
    await writeFile(file, bytes, { flag: 'wx' });
    return { directory, file };
  } catch (error) {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function removePronunciationAudio(audio: DownloadedAudio): Promise<void> {
  await rm(audio.directory, { recursive: true, force: true });
}
