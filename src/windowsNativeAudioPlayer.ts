import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EdgeReadAloudResult } from './windowsEdgeReadAloud.js';

// 2026-10-14: The reader thread only dispatches commands. Media events and Stop run on STA.
export const WINDOWS_NATIVE_AUDIO_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -ReferencedAssemblies @([System.Windows.Media.MediaPlayer].Assembly.Location, [System.Windows.Threading.Dispatcher].Assembly.Location) -TypeDefinition @'
using System;
using System.IO;
using System.Collections.Generic;
using System.Threading;
using System.Windows.Media;
using System.Windows.Threading;
public static class KrenNativeAudio {
  class Clip { public string Id; public string Path; public double Volume; }
  static Dispatcher dispatcher;
  static MediaPlayer player;
  static DispatcherTimer idle, deadline;
  static Queue<Clip> clips = new Queue<Clip>();
  static Clip active;
  static void Reply(string line) { Console.Out.WriteLine(line); Console.Out.Flush(); }
  static void Delete(Clip clip) { try { File.Delete(clip.Path); } catch {} }
  static void Finish(string result) {
    if (active == null) return;
    Clip clip = active; active = null;
    deadline.Stop(); player.Stop(); player.Close(); Delete(clip);
    Reply(result + " " + clip.Id + (result == "FAILED" ? " mediaFailed" : ""));
    Next();
  }
  static void Next() {
    if (active != null) return;
    if (clips.Count == 0) { idle.Start(); return; }
    idle.Stop(); active = clips.Dequeue();
    try {
      player.Volume = active.Volume;
      player.Open(new Uri(active.Path, UriKind.Absolute));
      deadline.Start();
    } catch { Finish("FAILED"); }
  }
  static void Stop() {
    while (clips.Count > 0) { Clip clip = clips.Dequeue(); Delete(clip); Reply("ENDED " + clip.Id); }
    Finish("ENDED"); idle.Start();
  }
  static void Command(string line) {
    if (line == "STOP") { Stop(); return; }
    if (line == "QUIT") { Stop(); dispatcher.BeginInvokeShutdown(DispatcherPriority.Normal); return; }
    string[] parts = line.Split(new char[] {' '}, 4);
    int volume;
    if (parts.Length != 4 || parts[0] != "PLAY" || !Int32.TryParse(parts[2], out volume)) return;
    clips.Enqueue(new Clip { Id = parts[1], Path = parts[3], Volume = Math.Max(0, Math.Min(100, volume)) / 100.0 });
    Next();
  }
  public static void Run() {
    dispatcher = Dispatcher.CurrentDispatcher;
    player = new MediaPlayer();
    idle = new DispatcherTimer(); idle.Interval = TimeSpan.FromMinutes(2);
    idle.Tick += delegate { Stop(); dispatcher.BeginInvokeShutdown(DispatcherPriority.Normal); };
    deadline = new DispatcherTimer(); deadline.Interval = TimeSpan.FromMinutes(10);
    deadline.Tick += delegate { Finish("FAILED"); };
    player.MediaOpened += delegate {
      if (active == null) return;
      player.Play(); Reply("STARTED " + active.Id);
    };
    player.MediaEnded += delegate { Finish("ENDED"); };
    player.MediaFailed += delegate { Finish("FAILED"); };
    Thread reader = new Thread(delegate() {
      string line;
      while ((line = Console.In.ReadLine()) != null) {
        string command = line;
        dispatcher.BeginInvoke(new Action(delegate { Command(command); }));
        if (line == "QUIT") return;
      }
      dispatcher.BeginInvoke(new Action(delegate { Command("QUIT"); }));
    });
    reader.IsBackground = true; reader.Start(); idle.Start(); Reply("READY");
    Dispatcher.Run(); player.Close();
  }
}
'@
[KrenNativeAudio]::Run()
`.trim();

export interface TemporaryAudio { directory: string; file: string }
export interface OneShotPlayer {
  playBase64(audio: string, volume: number, onStarted?: () => void): Promise<EdgeReadAloudResult>;
  stop(): boolean;
}
export interface PlayerOptions {
  platform?: NodeJS.Platform;
  spawn?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  createAudio?: () => Promise<TemporaryAudio>;
  writeAudio?: (file: string, audio: Buffer) => Promise<void>;
  removeAudio?: (audio: TemporaryAudio) => Promise<void>;
  log?: (line: string) => void;
}
export interface NativeProcess {
  child: ChildProcess;
  ready: Promise<boolean>;
  finishReady: (ready: boolean) => void;
  startedAt: number;
  buffer: string;
  readyTimer: ReturnType<typeof setTimeout>;
  alive: boolean;
}
interface ActiveClip {
  generation: number;
  id: number;
  process: NativeProcess;
  sentAt: number;
  started: boolean;
  onStarted?: () => void;
  finish: (result: EdgeReadAloudResult) => void;
}

/** One local MP3 player, shared by the two Chirp speech adapters. */
export class WindowsNativeAudioTransport {
  protected process?: NativeProcess;
  protected active?: ActiveClip;
  protected generation = 0;
  protected clipId = 0;
  protected cause?: string;
  protected idleTimer?: ReturnType<typeof setTimeout>;
  protected pending = 0;
  protected disposed = false;
  constructor(protected readonly options: PlayerOptions = {}) {}

  public failureCause(): string | undefined { return this.cause; }
  public stop(): boolean {
    const pending = this.pending > 0;
    this.generation++;
    if (this.process?.alive) this.write(this.process, 'STOP');
    const active = this.active;
    if (active) {
      const timeout = setTimeout(() => {
        if (this.active === active) { this.died(active.process); active.process.child.kill(); }
      }, 1000);
      timeout.unref?.();
    }
    if (!pending) this.armIdle();
    return pending;
  }
  protected startProcess(): NativeProcess | undefined {
    const startedAt = Date.now();
    let child: ChildProcess;
    try {
      const env: NodeJS.ProcessEnv = {};
      for (const key of ['SystemRoot', 'WINDIR', 'Path', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA']) {
        if (process.env[key] !== undefined) env[key] = process.env[key];
      }
      child = (this.options.spawn ?? spawn)('powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden', '-Command', WINDOWS_NATIVE_AUDIO_SCRIPT],
        { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env });
    } catch { this.cause = 'processExited'; return undefined; }
    let finishReady!: (ready: boolean) => void;
    const ready = new Promise<boolean>(resolve => { finishReady = resolve; });
    const native: NativeProcess = { child, ready, finishReady, startedAt, buffer: '', alive: true,
      readyTimer: setTimeout(() => { this.cause = 'startupTimeout'; this.died(native); child.kill(); }, 30_000) };
    this.process = native;
    child.stdout?.on('data', (chunk: Buffer | string) => {
      native.buffer += chunk.toString();
      let newline: number;
      while ((newline = native.buffer.indexOf('\n')) >= 0) {
        const line = native.buffer.slice(0, newline).trim(); native.buffer = native.buffer.slice(newline + 1);
        this.reply(native, line);
      }
      if (native.buffer.length > 1024) native.buffer = '';
    });
    child.once('exit', () => this.died(native));
    child.once('error', () => this.died(native));
    child.stdin?.on('error', () => { this.died(native); child.kill(); });
    if (!child.stdin || !child.stdout) { this.died(native); child.kill(); }
    return native;
  }
  protected died(native: NativeProcess): void {
    if (!native.alive) return;
    native.alive = false;
    clearTimeout(native.readyTimer);
    native.finishReady(false);
    if (this.process === native) this.process = undefined;
    this.cause ??= 'processExited';
    if (this.active?.process === native) this.active.finish('failed');
  }
  protected reply(native: NativeProcess, line: string): void {
    if (!native.alive) return;
    if (line === 'READY') {
      clearTimeout(native.readyTimer); native.finishReady(true);
      this.options.log?.(`[speech] native player ready after ${Date.now() - native.startedAt} ms`);
      return;
    }
    const reply = /^(STARTED|ENDED|FAILED) (\d+)(?: (\S+))?$/u.exec(line);
    const active = this.active;
    if (!reply || !active || active.process !== native || Number(reply[2]) !== active.id) return;
    if (reply[1] === 'STARTED') {
      if (active.started || active.generation !== this.generation) return;
      active.started = true;
      this.options.log?.(`[speech] clip ${active.id} started after ${Date.now() - active.sentAt} ms`);
      active.onStarted?.();
    } else {
      if (reply[1] === 'FAILED') this.cause = reply[3] === 'mediaFailed' ? 'mediaFailed' : 'unknown';
      active.finish(reply[1] === 'ENDED' ? 'completed' : 'failed');
    }
  }
  protected sendClip(native: NativeProcess, file: string, volume: number, onStarted?: () => void): Promise<EdgeReadAloudResult> {
    if (/[\r\n\0]/u.test(file)) { this.cause = 'fileError'; return Promise.resolve('failed'); }
    return new Promise(resolve => {
      const id = ++this.clipId;
      const timeout = setTimeout(() => { this.cause = 'playbackTimeout'; this.died(native); native.child.kill(); }, 610_000);
      const active: ActiveClip = { id, generation: this.generation, process: native, sentAt: Date.now(), started: false, onStarted,
        finish: result => { clearTimeout(timeout); if (this.active === active) this.active = undefined; resolve(result); } };
      this.active = active;
      const safeVolume = Number.isFinite(volume) ? Math.max(0, Math.min(100, Math.round(volume))) : 100;
      this.write(native, `PLAY ${id} ${safeVolume} ${file}`);
    });
  }
  protected write(native: NativeProcess, line: string): void {
    try { native.child.stdin!.write(line + '\n'); } catch { this.died(native); native.child.kill(); }
  }
  protected clearIdle(): void { clearTimeout(this.idleTimer); this.idleTimer = undefined; }
  protected armIdle(): void {
    this.clearIdle();
    if (this.disposed) return;
    this.idleTimer = setTimeout(() => this.quit(), 120_000);
    this.idleTimer.unref?.();
  }
  protected quit(): void {
    this.clearIdle();
    const native = this.process;
    if (!native) return;
    this.write(native, 'QUIT');
    const timeout = setTimeout(() => native.child.kill(), 1000);
    timeout.unref?.();
    native.child.once('exit', () => clearTimeout(timeout));
    this.died(native);
  }
}
export async function createAudio(): Promise<TemporaryAudio> {
  const directory = await mkdtemp(join(tmpdir(), 'kren-chirp-'));
  return { directory, file: join(directory, 'speech.mp3') };
}
export async function removeAudio(audio: TemporaryAudio): Promise<void> {
  await rm(audio.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}
