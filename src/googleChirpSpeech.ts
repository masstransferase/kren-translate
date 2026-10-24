import { missingCredentialDetails, missingCredentialMessage } from './requestCenter.js';
import type { SpeechAdapter, SpeechResult, SpeechVoice } from './speech/speechAdapter.js';
import type { EdgeReadAloudResult } from './windowsEdgeReadAloud.js';
import { sentencePause, speechSsml, splitSpeechSentences } from './speech/sentencePause.js';
import { KREN_SECRET_KEYS } from './operations.js';

export const GOOGLE_CHIRP_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';
export const chirpSpeakingRate = (percent: number): number => Math.max(0.25, Math.min(2, 1 + percent / 100));
const GOOGLE_ERROR_STATUSES = new Set(['OK', 'CANCELLED', 'UNKNOWN', 'INVALID_ARGUMENT', 'DEADLINE_EXCEEDED',
  'NOT_FOUND', 'ALREADY_EXISTS', 'PERMISSION_DENIED', 'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION',
  'ABORTED', 'OUT_OF_RANGE', 'UNIMPLEMENTED', 'INTERNAL', 'UNAVAILABLE', 'DATA_LOSS', 'UNAUTHENTICATED']);
const GOOGLE_ERROR_REASONS = new Set(['SERVICE_DISABLED', 'API_KEY_SERVICE_BLOCKED', 'API_KEY_INVALID',
  'API_KEY_HTTP_REFERRER_BLOCKED', 'API_KEY_IP_ADDRESS_BLOCKED', 'API_KEY_ANDROID_APP_BLOCKED',
  'API_KEY_IOS_APP_BLOCKED', 'API_KEY_EXPIRED', 'CONSUMER_INVALID', 'BILLING_DISABLED', 'BILLING_NOT_ACTIVE',
  'PROJECT_DELETED', 'PROJECT_INVALID', 'RATE_LIMIT_EXCEEDED', 'QUOTA_EXCEEDED', 'ACCESS_TOKEN_EXPIRED',
  'ACCESS_TOKEN_TYPE_UNSUPPORTED', 'IAM_PERMISSION_DENIED', 'SECURITY_POLICY_VIOLATED']);
function googleErrorCodes(value: unknown): string {
  const error = (value as { error?: { status?: unknown; details?: Array<{ reason?: unknown }> } } | null)?.error;
  const codes: string[] = [];
  if (typeof error?.status === 'string' && GOOGLE_ERROR_STATUSES.has(error.status)) codes.push(error.status);
  if (Array.isArray(error?.details)) for (const detail of error.details) {
    if (typeof detail?.reason === 'string' && GOOGLE_ERROR_REASONS.has(detail.reason) && !codes.includes(detail.reason)) codes.push(detail.reason);
  }
  return codes.join(' ');
}
export function chirpFailureMessage(status?: number, reason = 'no response', codes = ''): string {
  return `Google Cloud Text-to-Speech failed (${status ? `HTTP ${status}${codes ? ` ${codes}` : ''}` : reason}).` +
    (status === 403 ? ' Enable the Text-to-Speech API and billing in your Google Cloud project, and allow this key to use it.' : '');
}
export interface ChirpPlayback {
  beginSession?(): void;
  play(audioBase64: string, volume: number, onStarted?: () => void): Promise<EdgeReadAloudResult>;
  stop(): boolean;
  failureCause?(): string | undefined;
}
// 2026-10-12: Sentence order is retained, and small fragments share a request.
export function chirpSentences(text: string, retainAbbreviations = false): string[] {
  // 2026-10-21: Preserve the original grouping byte for byte when pauses are disabled.
  const sentences = splitSpeechSentences(text, retainAbbreviations);
  const chunks: string[] = [];
  let pending = '';
  for (const sentence of sentences) {
    pending += (pending ? ' ' : '') + sentence;
    if (pending.length >= 40) { chunks.push(pending); pending = ''; }
  }
  if (pending) {
    if (chunks.length) chunks[chunks.length - 1] += ' ' + pending;
    else chunks.push(pending);
  }
  return chunks;
}
class ChirpFailure extends Error {
  constructor(public readonly status?: number, public readonly missingKey = false,
    public readonly reason = 'no response', public readonly codes = '', public readonly playbackCause?: string) { super('Chirp unavailable'); }
  public stage(): string { return this.status ? `HTTP ${this.status}${this.codes ? ` ${this.codes}` : ''}` :
    this.reason + (this.playbackCause ? `: ${this.playbackCause}` : ''); }
  public retryable(): boolean { return this.reason !== 'playback' && !this.missingKey && ![400, 401, 403].includes(this.status ?? 0); }
}
// 2026-10-11: Stop cancels the one retry delay as well as the request and playback.
function waitForChirpRetry(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, 1000);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

/** One utterance at a time. Playback owns temporary audio; credentials and text are never stored or logged. */
export class GoogleChirpPlayer implements SpeechAdapter {
  private controller?: AbortController;
  constructor(private readonly getSecret: (slot: string) => PromiseLike<string | undefined>,
    private readonly playback: ChirpPlayback,
    private readonly fetcher: typeof fetch = fetch,
    private readonly log: (line: string) => void = () => {},
    private readonly recordUsage: (feature: 'tutorSpeech' | 'readAloud', characters: number) => void = () => {}) {}

  public stop(): boolean {
    const pending = Boolean(this.controller);
    this.controller?.abort();
    this.controller = undefined;
    return this.playback.stop() || pending;
  }
  public dispose(): void { this.stop(); }
  public speak(text: string, voice: SpeechVoice, rate: number, volume: number, onStarted?: () => void): Promise<SpeechResult> {
    return this.run(text, voice, rate, volume, onStarted);
  }
  private async run(text: string, options: SpeechVoice, rate: number, volume: number, onStarted?: () => void): Promise<SpeechResult> {
    this.stop();
    const controller = new AbortController();
    this.controller = controller;
    this.playback.beginSession?.();
    const current = () => !controller.signal.aborted && this.controller === controller;
    const began = Date.now();
    const pause = options.feature === 'readAloud' ? 0 : sentencePause(options.sentencePauseMilliseconds);
    const sentences = chirpSentences(text, pause > 0);
    const attempts = sentences.map(() => 0);
    let sentenceIndex = 0;
    let logged = false;
    const languageCode = options.languageCode ?? 'en-US';
    const voice = options.voice;
    try {
      const key = await this.getSecret(KREN_SECRET_KEYS.googleCloudTextToSpeech) ||
        await this.getSecret(KREN_SECRET_KEYS.googleCloudTranslation);
      if (!current()) return { status: 'stopped' };
      if (!key) throw new ChirpFailure(undefined, true, 'needs a key');
      const retry = async (error: unknown, index: number): Promise<void> => {
        const failure = error instanceof ChirpFailure ? error : new ChirpFailure();
        if (attempts[index] !== 0 || !failure.retryable()) throw failure;
        attempts[index] = 1;
        this.log(`[speech] Google Cloud Text-to-Speech failed (${failure.stage()}); retrying once.`);
        await waitForChirpRetry(controller.signal);
      };
      const synthesize = async (index: number): Promise<string | undefined> => {
        let useSsml = pause > 0;
        let plainTextRetry = false;
        while (current()) {
          try {
            this.recordUsage(options.feature ?? 'tutorSpeech', Array.from(sentences[index]!).length);
            const response = await this.fetcher(GOOGLE_CHIRP_ENDPOINT, {
              method: 'POST', signal: controller.signal,
              headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
              body: JSON.stringify({ input: useSsml ? { ssml: speechSsml(sentences[index]!, pause, index < sentences.length - 1) } : { text: sentences[index] },
                voice: { languageCode, name: `${languageCode}-Chirp3-HD-${voice}` },
                audioConfig: { audioEncoding: 'MP3', speakingRate: chirpSpeakingRate(rate) } })
            });
            if (!current()) return;
            if (response.status === 400 && useSsml) {
              useSsml = false;
              plainTextRetry = true;
              this.log('[speech] Google Cloud Text-to-Speech rejected SSML (HTTP 400); retrying group once as plain text.');
              continue;
            }
            if (!response.ok) throw new ChirpFailure(response.status, false, 'no response',
              googleErrorCodes(await response.json().catch(() => undefined)));
            const value: unknown = await response.json().catch(() => { throw new ChirpFailure(undefined, false, 'unreadable audio'); });
            if (!current()) return;
            const content = (value as { audioContent?: unknown } | null)?.audioContent;
            if (typeof content !== 'string' || !content.length || content.length > 34_000_000 ||
                !/^[A-Za-z0-9+/]+={0,2}$/u.test(content) || content.length % 4 === 1) {
              throw new ChirpFailure(undefined, false, 'unreadable audio');
            }
            return content;
          } catch (error) {
            if (!current()) return;
            if (plainTextRetry) throw error;
            await retry(error, index);
          }
        }
      };
      // A prefetched failure is held until its sentence reaches the player.
      type AudioResult = { audio?: string; error?: unknown };
      const request = (index: number): Promise<AudioResult> => synthesize(index).then(audio => ({ audio }), error => ({ error }));
      let prepared = request(0);
      for (sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex++) {
        let content = await prepared;
        let next: Promise<AudioResult> | undefined;
        while (current()) {
          if (content.error) throw content.error;
          if (!content.audio) return { status: 'stopped' };
          const started = () => {
            if (!current()) return { status: 'stopped' };
            onStarted?.();
            if (!logged) { logged = true; this.log(`[speech] Chirp first audio after ${Date.now() - began} ms`); }
            if (!next && sentenceIndex + 1 < sentences.length) next = request(sentenceIndex + 1);
          };
          try {
            if (options.playbackBarrier && !await options.playbackBarrier()) return { status: 'stopped' };
            if (!current()) return { status: 'stopped' };
            const result = await this.playback.play(content.audio, volume, started)
              .catch(() => { throw new ChirpFailure(undefined, false, 'playback', '', this.playback.failureCause?.()); });
            if (!current() || result === 'stopped') return { status: 'stopped' };
            if (result === 'failed') throw new ChirpFailure(undefined, false, 'playback', '', this.playback.failureCause?.());
            // An older playback adapter can still continue in order without a start event.
            // 2026-10-12: Only the actual start callback records first-audio latency.
            if (!next && sentenceIndex + 1 < sentences.length) next = request(sentenceIndex + 1);
            break;
          } catch (error) {
            if (!current()) return { status: 'stopped' };
            await retry(error, sentenceIndex);
            if (!current()) return { status: 'stopped' };
            content = await request(sentenceIndex);
          }
        }
        if (!current()) return { status: 'stopped' };
        if (next) prepared = next;
      }
      return { status: 'completed' };
    } catch (error) {
      if (!current()) return { status: 'stopped' };
      const failure = error instanceof ChirpFailure ? error : new ChirpFailure();
      const cause = failure.stage();
      const message = failure.reason === 'playback'
        ? `Google Cloud Text-to-Speech audio could not play (native player: ${failure.playbackCause ?? 'unknown'}).`
        : options.feature === 'readAloud' && failure.status === 400
        ? `Google Cloud Text-to-Speech has no ${new Intl.DisplayNames(['en'], { type: 'language' }).of(languageCode.split('-')[0]!)} voice named ${voice}.`
        : failure.missingKey ? missingCredentialMessage(missingCredentialDetails('googleCloudTextToSpeech'))
        : chirpFailureMessage(failure.status, failure.reason, failure.codes);
      controller.abort();
      return { status: 'failed', cause, message, missingKey: failure.missingKey,
        remainingText: sentenceIndex > 0 ? sentences.slice(sentenceIndex).join(' ') : text };

    } finally {
      if (this.controller === controller) this.controller = undefined;
    }
  }
}
