import { WindowsEdgeReadAloudTransport, type EdgeReadAloudOptions, type EdgeTemporaryAudio, type EdgeActiveSpeech } from '../windowsEdgeReadAloud.js';
import { writeFile } from 'node:fs/promises';
import { WindowsNativeAudioTransport, createAudio, removeAudio, type OneShotPlayer, type PlayerOptions, type NativeProcess, type TemporaryAudio } from '../windowsNativeAudioPlayer.js';
export { WINDOWS_NATIVE_AUDIO_SCRIPT } from '../windowsNativeAudioPlayer.js';
import { tutorChirpVoices, tutorWindowsVoice } from './voiceSelection.js';
export { tutorChirpVoices, tutorConversationSpeechVoice, tutorLearnerEdgeVoice, tutorLearnerLiveVoice } from './voiceSelection.js';
import { GoogleChirpPlayer, type ChirpPlayback } from '../googleChirpSpeech.js';
import { recordLanguageModelUsage } from '../languageModelUsage.js';
import { normalizedTutorLiveVoice } from '../tutor/state.js';
import { TUTOR_DEFAULTS } from '../tutor/defaults.js';
import { READ_ALOUD_PROVIDER_DEFAULT, READ_ALOUD_EDGE_VOICE_DEFAULT } from '../panelSettings.js';
import { normalizedReadAloudChirpVoice, resolveReadAloudChirpLocale } from '../readAloudChirp.js';
import { prepareTextForSpeech } from '../windowsReadAloud.js';
import { type EdgeAudioPlayback, type EdgeReadAloudResult } from '../windowsEdgeReadAloud.js';
import { EDGE_SPEECH_AUTO_LOCALE, resolveEdgeSpeechLocale, resolveEdgeSpeechVoice } from '@kren/core/edge-speech';
import { edgeSpeechFailureMessage, edgeSpeechRetryNotice } from '../edgeSpeechMessages.js';
import type { SpeechAdapter, SpeechProvider, SpeechResult, SpeechVoice } from './speechAdapter.js';

export type { SpeechAdapter, SpeechProvider, SpeechResult, SpeechVoice } from './speechAdapter.js';
export { GOOGLE_CHIRP_ENDPOINT, chirpSpeakingRate, chirpSentences } from '../googleChirpSpeech.js';

interface ChirpSpeechOptions {
  voice: string; ratePercent: number; volume: number;
  languageCode?: string;
  feature?: 'tutorSpeech' | 'readAloud';
}
export interface TutorSpeechFallback {
  provider: 'edgeOnline' | 'windowsLocal';
  edgeUnavailable?: boolean;
  edgeCause?: string;
  unavailable?: boolean;
}

/** Notice identity belongs to a conversation, or to the extension's Read Aloud session. */
class SpeechNotice {
  private noticeShown = false;
  private conversation: unknown;
  constructor(private readonly notify: (message: string) => void) {}
  public beginConversation(identity: unknown): boolean {
    if (this.conversation === identity) return false;
    this.conversation = identity;
    this.noticeShown = false;
    return true;
  }
  public reportSpeechFailure(message: string): void {
    if (this.noticeShown) return;
    this.noticeShown = true;
    this.notify(message);
  }
  public reportFallback(message: string, result?: TutorSpeechFallback): void {
    if (result?.unavailable) {
      this.reportSpeechFailure(`${message} Edge Online and Local Windows speech are unavailable.`);
      return;
    }
    this.reportSpeechFailure(`${message}${result?.edgeUnavailable ? ` Edge Online is unavailable too (${result.edgeCause ?? 'synthesis failed'}).` : ''} KREN is using the ${result?.provider === 'windowsLocal' ? 'Windows' : 'Edge'} voice.`);
  }
}

function recordSpeechUsage(feature: 'tutorSpeech' | 'readAloud', characters: number): void {
  recordLanguageModelUsage({ feature, provider: 'google-tts', model: 'chirp3-hd' }, { characters });
}

/** Compatibility entry for existing Chirp callers; source policy lives here, not in the player. */
export class GoogleChirpSpeech {
  public readonly adapter: SpeechAdapter;
  private readonly notice: SpeechNotice;
  private generation = 0;
  private pending?: number;
  private onStarted?: () => void;
  constructor(getSecret: (slot: string) => PromiseLike<string | undefined>, playback: ChirpPlayback,
    notify: (message: string) => void, fetcher: typeof fetch = fetch,
    private readonly log: (line: string) => void = () => {},
    private readonly onFallback: () => void = () => {}) {
    this.adapter = new GoogleChirpPlayer(getSecret, playback, fetcher, log, recordSpeechUsage);
    this.notice = new SpeechNotice(notify);
  }
  public beginConversation(identity: unknown): void {
    if (this.notice.beginConversation(identity)) this.stop();
  }
  public stop(): boolean {
    this.generation++;
    const pending = this.pending !== undefined;
    this.pending = undefined;
    return this.adapter.stop() || pending;
  }
  public playbackStarted(callback: () => void): void { this.onStarted = callback; }
  public cancellationGeneration(): number { return this.generation; }
  public dispose(): void { this.stop(); }
  public warnMissingKey(): void {
    this.reportSpeechFailure('Google Cloud Text-to-Speech needs a key. Open KREN menu, Credentials. KREN is using the Edge voice.');
  }
  public reportSpeechFailure(message: string): void { this.notice.reportSpeechFailure(message); }
  public reportFallback(message: string, result?: TutorSpeechFallback): void { this.notice.reportFallback(message, result); }
  public async speak(text: string, options: ChirpSpeechOptions,
    fallback: (text?: string) => Promise<void | TutorSpeechFallback>): Promise<void> {
    const generation = ++this.generation;
    this.pending = generation;
    try {
      const result = await this.read(text, options);
      if (generation !== this.generation || result.status !== 'failed') return;
      this.log(`[speech] Google Cloud Text-to-Speech failed (${result.cause}); using Edge.`);
      onFallbackSafe(this.onFallback);
      const used = await fallback(result.remainingText ?? text);
      if (generation === this.generation) this.reportFallback(chirpNotice(result), used || undefined);
    } finally { if (this.pending === generation) this.pending = undefined; }
  }
  public async test(options: ChirpSpeechOptions): Promise<string> {
    const generation = ++this.generation;
    this.pending = generation;
    try {
      const result = await this.read('Hello, I am KREN, your English practice partner.', options);
      if (result.status === 'failed') {
        this.log(`[speech] Google Cloud Text-to-Speech failed (${result.cause}).`);
        return result.message!;
      }
      return result.status === 'completed' ? 'Google Cloud Text-to-Speech works.' : 'Google Cloud Text-to-Speech test was canceled.';
    } finally { if (this.pending === generation) this.pending = undefined; }
  }
  private read(text: string, options: ChirpSpeechOptions): Promise<SpeechResult> {
    return this.adapter.speak(text, { ...options, voice: options.feature === 'readAloud'
      ? normalizedReadAloudChirpVoice(options.voice) : normalizedTutorLiveVoice(options.voice) }, options.ratePercent, options.volume, this.onStarted);
  }
}

function chirpNotice(result: Extract<SpeechResult, { status: 'failed' }>): string {
  return result.missingKey ? 'Google Cloud Text-to-Speech needs a key. Open KREN menu, Credentials.' : result.message!;
}
function onFallbackSafe(notify: () => void): void {
  // 2026-10-11: A reveal observer cannot prevent the selected speech fallback.
  try { notify(); } catch { /* Keep the fallback available. */ }
}

export interface SpeechConfiguration { get<T>(key: string, fallback: T): T }
export interface SpeechHost {
  configuration(): SpeechConfiguration;
  trusted(): boolean;
  consent(): Promise<boolean>;
  active(value: boolean): PromiseLike<unknown>;
  status(provider: SpeechProvider): { dispose(): void };
  hold(): () => void;
  started(): void;
  liveSpeaking(): boolean;
  conversation(): unknown;
  speakerVoice(): string;
  playback(): EdgeAudioPlayback | undefined;
  notify(kind: 'warning' | 'error' | 'information', message: string): void;
  showKrenErrorMessage?(message: string, action: string): PromiseLike<string | undefined>;
  copyText?(text: string): PromiseLike<unknown>;
  log(line: string): void;
}
interface SpeechSettings {
  provider: SpeechProvider; edgeLocale: string; edgeVoice: string; edgeRatePercent: number;
  voice: string; rate: number; volume: number; pythonCommand: string;
  chirpVoice: string; female: string; male: string; edgeFemale: string; edgeMale: string;
}

// 2026-10-14: This is the only provider order, shared by the two features.
const FALLBACK_ORDER: readonly SpeechProvider[] = ['edgeOnline', 'windowsLocal'];

export class SpeechCenter {
  private generation = 0;
  constructor(private readonly tutor: GoogleChirpSpeech, private readonly shared: GoogleChirpSpeech,
    private readonly edge: SpeechAdapter, private readonly windows: SpeechAdapter, private readonly host: SpeechHost) {
    this.tutor.playbackStarted(() => this.host.started());
  }
  public stop(): boolean {
    this.generation++;
    const tutor = this.tutor.stop(), shared = this.shared.stop(), edge = this.edge.stop(), windows = this.windows.stop();
    return tutor || shared || edge || windows;
  }
  public dispose(): void { this.stop(); }
  public async speak(text: string, resultLanguage?: string, settingsSource: 'shared' | 'tutor' = 'shared', edgeVoice?: string): Promise<void | TutorSpeechFallback> {
    const session = ++this.generation;
    const settings = this.settings(settingsSource);
    const utteranceVoice = settingsSource === 'tutor' && settings.provider === 'windowsLocal'
      ? tutorWindowsVoice(this.host.speakerVoice()) : undefined;
    if (settingsSource === 'tutor' && this.host.liveSpeaking() && settings.provider === 'googleChirp') return;
    const speechNotice = settingsSource === 'tutor' ? this.tutor : this.shared;
    if (settingsSource === 'tutor') this.tutor.beginConversation(this.host.conversation());
    this.tutor.stop(); this.shared.stop(); this.edge.stop(); this.windows.stop();
    const cancellation = speechNotice.cancellationGeneration();
    const current = () => session === this.generation && cancellation === speechNotice.cancellationGeneration();
    const provider = edgeVoice && settings.provider !== 'googleChirp' ? 'edgeOnline' : settings.provider;
    const chirpReadAloud = settingsSource === 'shared' && settings.provider === 'googleChirp';
    const voices = settingsSource === 'tutor' ? tutorChirpVoices(edgeVoice, settings) : undefined;
    const order = [provider, ...FALLBACK_ORDER.filter(candidate => candidate !== provider)];
    // A selected Windows voice only falls through for the tutor, as before V234.
    if (provider === 'windowsLocal' && settingsSource === 'shared') order.splice(1);
    let remaining = chirpReadAloud ? prepareTextForSpeech(text) : text;
    if (chirpReadAloud && !remaining) return;
    const releaseSpeech = settingsSource === 'tutor' || chirpReadAloud ? this.host.hold() : undefined;
    let status: { dispose(): void } | undefined;
    let message: string | undefined, edgeCause: string | undefined;
    let used: TutorSpeechFallback | undefined;
    try {
      for (const source of order) {
        if (!current()) return;
        let outcome: SpeechResult;
        let block: string | undefined;
        if (source === 'edgeOnline') {
          if (!this.host.trusted()) block = 'Restricted Mode';
          else if (!await this.host.consent()) block = 'consent declined';
          if (!current()) return;
        }
        if (!block) {
          await this.host.active(true);
          if (!current()) return;
          status?.dispose(); status = this.host.status(source);
        }
        const onStarted = () => { if (current() && settingsSource === 'tutor') this.host.started(); };
        if (source === 'googleChirp') {
          const resolved = resolveEdgeSpeechLocale({ configured: settings.edgeLocale, resultLanguage, text: remaining, fallback: 'en-US' }).locale;
          const languageCode = chirpReadAloud ? resolveReadAloudChirpLocale(resolved) : 'en-US';
          if (!languageCode) outcome = { status: 'failed', cause: 'unsupported locale', message: `Google Cloud Text-to-Speech does not support ${resolved}.` };
          else outcome = await speechNotice.adapter.speak(remaining, { voice: voices?.voice ?? settings.chirpVoice, languageCode,
            feature: chirpReadAloud ? 'readAloud' : 'tutorSpeech' }, settings.edgeRatePercent, settings.volume, onStarted);
        } else if (source === 'edgeOnline') {
          const storedVoice = provider === 'googleChirp' ? voices?.edgeVoice ?? settings.edgeVoice
            : provider === 'windowsLocal' && settingsSource === 'tutor'
            ? tutorChirpVoices(edgeVoice ?? this.host.speakerVoice(), settings).edgeVoice : edgeVoice ?? settings.edgeVoice;
          outcome = block ? { status: 'failed', cause: block } : await this.speakEdge(remaining, resultLanguage, settings, storedVoice, onStarted, current, chirpReadAloud);
        } else {
          outcome = await this.windows.speak(remaining, { voice: utteranceVoice ?? settings.voice }, settings.rate, settings.volume, onStarted);
        }
        if (!current() || outcome.status === 'stopped') return;
        if (outcome.status === 'completed') {
          if (source !== 'googleChirp') used = { provider: source, ...(edgeCause ? { edgeUnavailable: true, edgeCause } : {}) };
          if (message) speechNotice.reportFallback(message, provider === 'edgeOnline' && used ? { ...used, edgeUnavailable: false } : used);
          return used;
        }
        if (source === 'googleChirp') {
          remaining = outcome.remainingText ?? remaining;
          message = chirpNotice(outcome);
          if (outcome.cause !== 'unsupported locale') this.host.log(`[speech] Google Cloud Text-to-Speech failed (${outcome.cause}); using Edge.`);
        } else if (source === 'edgeOnline') {
          edgeCause = outcome.cause;
          if (!message) message = `Edge Online is unavailable (${edgeCause}).`;
          if (order.includes('windowsLocal') && provider !== 'windowsLocal') this.host.log(`[speech] Edge Online unavailable (${edgeCause}); using Windows.`);
          else {
            // 2026-10-14: Retain the terminal Edge diagnostics and prompt from the old entry.
            // The shared fallback table normally resolves a shared failure through Windows.
            if (settingsSource === 'shared') {
              if (block === 'Restricted Mode') this.host.notify('warning',
                'KREN Edge Online speech is disabled in Restricted Mode because it launches the configured Python executable. Trust this workspace to use Edge Online speech, or choose Local Windows speech.');
              else if (!block && edgeCause === 'edge-tts package missing') {
                const action = await this.host.showKrenErrorMessage?.(
                  'KREN Edge Online speech requires the optional edge-tts Python package.', 'Copy install command');
                if (action === 'Copy install command') await this.host.copyText?.('python -m pip install edge-tts');
              } else if (!block) this.host.notify('error', outcome.message!);
              return;
            }
            if (block) speechNotice.reportSpeechFailure(block === 'Restricted Mode'
              ? 'Local Windows speech failed, and Edge Online is unavailable in Restricted Mode. Choose another tutor Windows voice or verify that Windows speech is installed.'
              : 'Local Windows speech failed, and Edge Online speech was declined. Choose another tutor Windows voice or verify that Windows speech is installed.');
            else {
              this.host.log(`[speech] Edge Online unavailable (${edgeCause === 'edge-tts package missing' ? 'dependencyMissing' : 'failed'}); Local Windows already failed.`);
              speechNotice.reportSpeechFailure('Local Windows and Edge Online speech are unavailable. Choose another tutor Windows voice or verify that Windows speech is installed.');
            }
            return;
          }
        } else {
          if (order.at(-1) !== source) {
            message = 'Local Windows speech failed.';
            this.host.log('[speech] Local Windows failed; using Edge Online.');
          } else if (message) {
            speechNotice.reportFallback(message, { provider: source, unavailable: true });
            return { provider: source, unavailable: true, edgeUnavailable: true };
          } else {
            this.host.notify('error', 'KREN could not use the selected Windows voice. Choose another voice in KREN Settings or verify that Windows speech is installed.');
          }
        }
      }
    } finally {
      releaseSpeech?.(); status?.dispose();
      if (current()) await this.host.active(false);
    }
  }

  private async speakEdge(text: string, resultLanguage: string | undefined, speechSettings: SpeechSettings,
    storedVoice: string, onStarted: () => void, current: () => boolean, chirpReadAloud: boolean): Promise<SpeechResult> {
    const configuredLocale = speechSettings.edgeLocale;
    const speakIn = async (chosen: string): Promise<EdgeReadAloudResult> => {
      const outcome = await this.edge.speak(text, {
        pythonCommand: speechSettings.pythonCommand,
        voice: resolveEdgeSpeechVoice(chosen, storedVoice) ?? '',
        playback: this.host.playback()
      }, speechSettings.edgeRatePercent, speechSettings.volume, onStarted).catch(() => ({ status: 'failed' as const, cause: 'synthesis or playback failed' }));
      return outcome.status === 'failed' && outcome.cause === 'edge-tts package missing' ? 'dependencyMissing' : outcome.status;
    };
    const { locale } = resolveEdgeSpeechLocale({ configured: configuredLocale, resultLanguage, text, fallback: 'en-US' });
    let result = await speakIn(locale);
    if (!current() || result === 'stopped') return { status: 'stopped' };
    let retriedLocale: string | undefined;
    if (result === 'failed' && configuredLocale !== EDGE_SPEECH_AUTO_LOCALE) {
      const auto = resolveEdgeSpeechLocale({ configured: EDGE_SPEECH_AUTO_LOCALE, resultLanguage, text, fallback: 'en-US' }).locale;
      if (auto !== locale) {
        retriedLocale = auto;
        result = await speakIn(auto);
      }
    }
    if (!current() || result === 'stopped') return { status: 'stopped' };
    if (result === 'dependencyMissing') return { status: 'failed', cause: 'edge-tts package missing' };
    if (result === 'failed') return { status: 'failed', cause: 'synthesis or playback failed', message: edgeSpeechFailureMessage(locale, retriedLocale, storedVoice) };
    if (retriedLocale && !chirpReadAloud) this.host.notify('information', edgeSpeechRetryNotice(locale, retriedLocale));
    return { status: 'completed' };
  }

  private settings(settingsSource: 'shared' | 'tutor'): SpeechSettings {
    const config = this.host.configuration();
    // Each feature reads its own namespace; only the interpreter location is shared.
    return settingsSource === 'tutor' ? {
      provider: config.get<SpeechProvider>('tutor.readAloud.provider', TUTOR_DEFAULTS.configuration['tutor.readAloud.provider']),
      edgeLocale: config.get<string>('tutor.readAloud.edgeLocale', TUTOR_DEFAULTS.configuration['tutor.readAloud.edgeLocale']),
      edgeVoice: config.get<string>('tutor.readAloud.edgeVoice', TUTOR_DEFAULTS.configuration['tutor.readAloud.edgeVoice']),
      edgeRatePercent: config.get<number>('tutor.readAloud.edgeRatePercent', TUTOR_DEFAULTS.configuration['tutor.readAloud.edgeRatePercent']),
      voice: config.get<string>('tutor.readAloud.voice', TUTOR_DEFAULTS.configuration['tutor.readAloud.voice']),
      rate: config.get<number>('tutor.readAloud.rate', TUTOR_DEFAULTS.configuration['tutor.readAloud.rate']),
      volume: config.get<number>('tutor.readAloud.volume', TUTOR_DEFAULTS.configuration['tutor.readAloud.volume']),
      pythonCommand: config.get<string>('readAloud.edgePythonCommand', 'python'),
      chirpVoice: '', female: config.get<string>('tutor.liveFemaleVoice', 'Callirrhoe'), male: config.get<string>('tutor.liveMaleVoice', 'Enceladus'),
      edgeFemale: config.get<string>('tutor.readAloud.edgeFemaleVoice', 'en-US-AvaNeural'), edgeMale: config.get<string>('tutor.readAloud.edgeMaleVoice', 'en-US-ChristopherNeural')
    } : {
      provider: config.get<SpeechProvider>('readAloud.provider', READ_ALOUD_PROVIDER_DEFAULT),
      edgeLocale: config.get<string>('readAloud.edgeLocale', EDGE_SPEECH_AUTO_LOCALE),
      edgeVoice: config.get<string>('readAloud.edgeVoice', READ_ALOUD_EDGE_VOICE_DEFAULT),
      edgeRatePercent: config.get<number>('readAloud.edgeRatePercent', 0),
      voice: config.get<string>('readAloud.voice', ''), rate: config.get<number>('readAloud.rate', 0), volume: config.get<number>('readAloud.volume', 100),
      pythonCommand: config.get<string>('readAloud.edgePythonCommand', 'python'),
      chirpVoice: normalizedReadAloudChirpVoice(config.get<string>('readAloud.chirpVoice', 'Callirrhoe')),
      female: '', male: '', edgeFemale: '', edgeMale: ''
    };
  }
}

/** Native recovery is speech policy; the transport only dispatches and observes media events. */
export class WindowsNativeAudioPlayer extends WindowsNativeAudioTransport {
  private tail: Promise<unknown> = Promise.resolve();
  private restartUsed = false;
  private useOneShot = false;
  private startup?: Promise<NativeProcess | undefined>;
  constructor(private readonly oneShot: OneShotPlayer, options: PlayerOptions = {}) { super(options); }
  public override stop(): boolean {
    const stopped = super.stop();
    const oneShotStopped = this.oneShot.stop();
    return stopped || oneShotStopped;
  }
  public beginSession(): void {
    this.restartUsed = false;
    this.useOneShot = false;
    this.cause = undefined;
    this.clearIdle();
    // Startup overlaps synthesis; play() awaits this same readiness promise.
    void this.ensureProcess();
  }
  public play(audio: string, volume: number, onStarted?: () => void): Promise<EdgeReadAloudResult> {
    const generation = this.generation;
    this.pending++;
    this.clearIdle();
    const completion = this.tail.then(async (): Promise<EdgeReadAloudResult> => {
      if (generation !== this.generation || this.disposed) return 'stopped';
      this.cause = undefined;
      let temporary: TemporaryAudio | undefined;
      try {
        if (this.useOneShot) return await this.playOneShot(audio, volume, onStarted);
        temporary = await (this.options.createAudio ?? createAudio)();
        await (this.options.writeAudio ?? writeFile)(temporary.file, Buffer.from(audio, 'base64'));
        while (generation === this.generation) {
          const process = await this.ensureProcess();
          if (generation !== this.generation) return 'stopped';
          if (!process) break;
          const result = await this.sendClip(process, temporary.file, volume, onStarted);
          if (generation !== this.generation) return 'stopped';
          if (process.alive) return result;
          if (this.restartUsed) { this.useOneShot = true; break; }
          this.restartUsed = true;
        }
        if (generation !== this.generation) return 'stopped';
        return await this.playOneShot(audio, volume, onStarted);
      } catch {
        this.cause = 'fileError';
        return generation === this.generation ? 'failed' : 'stopped';
      } finally {
        if (temporary) await (this.options.removeAudio ?? removeAudio)(temporary).catch(() => {});
      }
    });
    this.tail = completion.finally(() => { this.pending--; if (!this.pending) this.armIdle(); });
    return completion;
  }
  public dispose(): void {
    this.stop();
    this.disposed = true;
    this.quit();
  }
  private async playOneShot(audio: string, volume: number, onStarted?: () => void): Promise<EdgeReadAloudResult> {
    const result = await this.oneShot.playBase64(audio, volume, onStarted);
    if (result === 'failed' || result === 'dependencyMissing') this.cause = 'oneShotFailed';
    return result;
  }
  private async ensureProcess(): Promise<NativeProcess | undefined> {
    if (!this.startup) {
      this.startup = this.prepareProcess().finally(() => { this.startup = undefined; });
    }
    return this.startup;
  }
  private async prepareProcess(): Promise<NativeProcess | undefined> {
    if (this.disposed || (this.options.platform ?? process.platform) !== 'win32' || this.useOneShot) return undefined;
    for (;;) {
      const process = this.process ?? this.startProcess();
      if (process && await process.ready) return process.alive ? process : undefined;
      if (this.restartUsed) { this.useOneShot = true; return undefined; }
      this.restartUsed = true;
    }
  }
}

/** The center owns the existing panel-to-native recovery for Edge audio. */
export class WindowsEdgeReadAloudPlayer extends WindowsEdgeReadAloudTransport {
  protected override async playExternalAudio(options: EdgeReadAloudOptions, audio: EdgeTemporaryAudio, active: EdgeActiveSpeech): Promise<EdgeReadAloudResult> {
    let result = await super.playExternalAudio(options, audio, active);
    active.stopExternal = undefined;
    if (result === 'failed' && this.generation === active.generation) {
      const playback = this.startAudioPlayback(audio.file, 100, active, options.onStarted);
      result = playback ? await playback.completion : 'failed';
    }
    return result;
  }
}
