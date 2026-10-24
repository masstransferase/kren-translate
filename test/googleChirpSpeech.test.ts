// 2026-10-11: V222 exercises transport, cancellation, fallback and the reader's controls.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { load } from 'cheerio';
import { afterEach, expect, it, vi } from 'vitest';
import { GoogleChirpSpeech, SpeechCenter, GOOGLE_CHIRP_ENDPOINT, chirpSpeakingRate, tutorChirpVoices } from '../src/speech/speechCenter.js';
import { EdgeOnlineSpeechAdapter, LocalWindowsSpeechAdapter } from '../src/speech/windowsSpeechAdapters.js';
import { KREN_SECRET_KEYS } from '../src/operations.js';
import { configureLanguageModelUsage, LanguageModelUsageRecorder } from '../src/languageModelUsage.js';
import { PANEL_SETTING_KEYS, validatedPanelSetting } from '../src/panelSettings.js';
import { renderKrenResultViewHtml, renderLanguageModelUsage } from '../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { createTutorViewState } from '../src/tutor/state.js';

const credential = ['mock', 'only', 'credential'].join('-');
const options = { voice: 'Enceladus', ratePercent: -25, volume: 50 };
const audio = Buffer.from('mock audio').toString('base64');
const response = () => new Response(JSON.stringify({ audioContent: audio }));
function fixture(fetcher = vi.fn(async (): Promise<Response> => response()), dedicated = true, translation = true) {
  const getSecret = vi.fn(async (slot: string) => slot === KREN_SECRET_KEYS.googleCloudTextToSpeech && dedicated || slot === KREN_SECRET_KEYS.googleCloudTranslation && translation ? credential : undefined);
  const player = { play: vi.fn(async (): Promise<'completed' | 'stopped' | 'failed'> => 'completed'), stop: vi.fn(() => false) };
  const log = vi.fn();
  const notify = vi.fn(), fallback = vi.fn(async () => {});
  const speech = new GoogleChirpSpeech(getSecret, player, notify, fetcher as typeof fetch, log);
  return { speech, getSecret, player, notify, fallback, fetcher, log };
}
afterEach(() => { configureLanguageModelUsage(undefined); vi.useRealTimers(); });

it('V232 starts the native player before synthesis and overlaps its readiness with the request', async () => {
  const beginSession = vi.fn(), f = fixture();
  const speech = new GoogleChirpSpeech(f.getSecret, { ...f.player, beginSession }, f.notify, f.fetcher);
  await speech.speak('Hello.', options, f.fallback);
  expect(beginSession).toHaveBeenCalledOnce();
  expect(beginSession.mock.invocationCallOrder[0]).toBeLessThan(f.fetcher.mock.invocationCallOrder[0]!);
});
it('V232 native playback failure never re-synthesizes and names the cause once', async () => {
  const f = fixture(); f.player.play.mockResolvedValue('failed');
  const speech = new GoogleChirpSpeech(f.getSecret, { ...f.player, failureCause: () => 'mediaFailed' }, f.notify, f.fetcher);
  const fallback = vi.fn(async () => ({ provider: 'windowsLocal' as const }));
  await speech.speak('Hello.', options, fallback); await speech.speak('Again.', options, fallback);
  expect(f.fetcher).toHaveBeenCalledTimes(2); expect(f.player.play).toHaveBeenCalledTimes(2);
  expect(fallback).toHaveBeenNthCalledWith(1, 'Hello.'); expect(fallback).toHaveBeenNthCalledWith(2, 'Again.');
  expect(f.notify).toHaveBeenCalledOnce();
  expect(f.notify.mock.calls[0]![0]).toMatch(/audio could not play.*native player: mediaFailed.*Windows voice/u);
});

it.each(['unreadable audio', 'invalid JSON', 'playback failed', 'playback rejected'] as const)(
  'V232 retries synthesis but sends %s playback failure straight to fallback', async stage => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => response());
    if (stage === 'unreadable audio') fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ audioContent: 'invalid!' })));
    if (stage === 'invalid JSON') fetcher.mockResolvedValueOnce(new Response('unreadable'));
    const f = fixture(fetcher);
    if (stage === 'playback failed') f.player.play.mockResolvedValueOnce('failed');
    if (stage === 'playback rejected') f.player.play.mockRejectedValueOnce(new Error('Private playback detail.'));
    const pending = f.speech.speak('Hello.', options, f.fallback);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(999);
    expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); await pending;
    // 2026-10-14: V232 retries synthesis only; playback cannot be repaired by another request.
    expect(fetcher).toHaveBeenCalledTimes(stage.startsWith('playback') ? 1 : 2);
    expect(f.player.play).toHaveBeenCalledTimes(1);
    expect(f.fallback).toHaveBeenCalledTimes(stage.startsWith('playback') ? 1 : 0);
    expect(f.log).toHaveBeenCalledWith(`[speech] Google Cloud Text-to-Speech failed (${stage.startsWith('playback') ? 'playback' : 'unreadable audio'}); ${stage.startsWith('playback') ? 'using Edge.' : 'retrying once.'}`);
  });
it.each([400, 401, 403])('V225 does not retry configuration error HTTP %s', async status => {
  const f = fixture(vi.fn(async () => new Response('{}', { status })));
  await f.speech.speak('Hello.', options, f.fallback);
  expect(f.fetcher).toHaveBeenCalledOnce();
  expect(f.fallback).toHaveBeenCalledOnce();
  expect(f.log.mock.calls.some(([line]) => line.includes('retrying'))).toBe(false);
});
it('V225 allows only one retry across different failure stages and logs both stages', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => response()).mockRejectedValueOnce(new Error('Private network detail.'));
  const f = fixture(fetcher);
  f.player.play.mockResolvedValue('failed');
  const pending = f.speech.speak('Hello.', options, f.fallback);
  await vi.advanceTimersByTimeAsync(1000); await pending;
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(f.fallback).toHaveBeenCalledOnce();
  expect(f.log.mock.calls.map(([line]) => line)).toEqual([
    '[speech] Google Cloud Text-to-Speech failed (no response); retrying once.',
    '[speech] Google Cloud Text-to-Speech failed (playback); using Edge.'
  ]);
});

it('uses the confirmed endpoint, a header-only key, selected voice, MP3, mapped rate and Volume', async () => {
  const f = fixture();
  await f.speech.speak('One utterance.', options, f.fallback);
  const [url, init] = (f.fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0]!;
  expect(url).toBe(GOOGLE_CHIRP_ENDPOINT);
  expect(new URL(url).search).toBe('');
  expect(url).not.toContain(credential);
  expect(init.method).toBe('POST');
  expect(new Headers(init.headers).get('X-Goog-Api-Key')).toBe(credential);
  const body = JSON.parse(String(init.body));
  expect(body).toEqual({ input: { text: 'One utterance.' }, voice: { languageCode: 'en-US', name: 'en-US-Chirp3-HD-Enceladus' }, audioConfig: { audioEncoding: 'MP3', speakingRate: 0.75 } });
  expect(String(init.body)).not.toContain(credential);
  // 2026-10-12: The player also reports when audio starts for the sentence lookahead.
  expect(f.player.play).toHaveBeenCalledWith(audio, 50, expect.any(Function));
  expect(f.fallback).not.toHaveBeenCalled();
});
it.each([[-100, 0.25], [-25, 0.75], [0, 1], [25, 1.25], [200, 2]])('maps speed %s to %s', (percent, rate) => {
  expect(chirpSpeakingRate(percent)).toBe(rate);
});
it('uses the Translation key only when the dedicated slot is empty', async () => {
  const f = fixture(undefined, false);
  await f.speech.speak('Hello.', options, f.fallback);
  expect(f.getSecret.mock.calls.map(([slot]) => slot)).toEqual([KREN_SECRET_KEYS.googleCloudTextToSpeech, KREN_SECRET_KEYS.googleCloudTranslation]);
  expect(new Headers((f.fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0]![1].headers).get('X-Goog-Api-Key')).toBe(credential);
  const dedicated = fixture();
  await dedicated.speech.speak('Hello.', options, dedicated.fallback);
  expect(dedicated.getSecret).toHaveBeenCalledTimes(1);
});
it('Stop aborts pending synthesis and stops playback, rejecting a late response', async () => {
  let complete!: (value: Response) => void;
  const f = fixture(vi.fn(() => new Promise<Response>(resolve => { complete = resolve; })));
  const pending = f.speech.speak('Hello.', options, f.fallback);
  await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce());
  const signal = (f.fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0]![1].signal!;
  expect(f.speech.stop()).toBe(true);
  expect(signal.aborted).toBe(true);
  complete(response()); await pending;
  expect(f.player.stop).toHaveBeenCalled(); expect(f.player.play).not.toHaveBeenCalled();
  expect(f.fallback).not.toHaveBeenCalled(); expect(f.notify).not.toHaveBeenCalled();
});
it('Stop ends an in-memory playback already in progress', async () => {
  const f = fixture(); let complete!: (result: 'stopped') => void;
  f.player.play.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  f.player.stop.mockImplementation(() => { complete?.('stopped'); return true; });
  const pending = f.speech.speak('Hello.', options, f.fallback);
  await vi.waitFor(() => expect(f.player.play).toHaveBeenCalledOnce());
  f.speech.stop(); await pending;
  expect(f.fallback).not.toHaveBeenCalled();
});
it('a new utterance cancels the earlier synthesis and only plays the new response', async () => {
  let old!: (response: Response) => void;
  const fetcher = vi.fn(async (): Promise<Response> => response()).mockImplementationOnce(() => new Promise(resolve => { old = resolve; }));
  const f = fixture(fetcher);
  const first = f.speech.speak('Old.', options, f.fallback);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  await f.speech.speak('New.', options, f.fallback);
  old(response()); await first;
  expect(f.player.play).toHaveBeenCalledOnce(); expect(f.fallback).not.toHaveBeenCalled();
});
it.each([403, 429])('HTTP %s falls back per utterance with one notice and no Google text', async status => {
  const f = fixture(vi.fn(async () => new Response('Google error detail that must stay private', { status })));
  await f.speech.speak('First.', options, f.fallback);
  await f.speech.speak('Second.', options, f.fallback);
  expect(f.fallback).toHaveBeenCalledTimes(2); expect(f.notify).toHaveBeenCalledOnce();
  const notice = f.notify.mock.calls[0]![0];
  expect(notice).toContain(`HTTP ${status}`); expect(notice).toMatch(/using the Edge voice/u);
  if (status === 403) expect(notice).toMatch(/Enable.*Text-to-Speech API/u);
  expect(notice).not.toContain('Google error detail'); expect(notice).not.toContain(credential);
});
it('a network exception falls back without exposing its message', async () => {
  const f = fixture(vi.fn(async () => { throw new Error(credential); }));
  await f.speech.speak('Hello.', options, f.fallback);
  expect(f.fallback).toHaveBeenCalledOnce(); expect(f.notify.mock.calls[0]![0]).not.toContain(credential);
});
it('missing credentials point to Credentials and fall back without making a request', async () => {
  const f = fixture(undefined, false, false);
  f.speech.warnMissingKey();
  await f.speech.speak('Hello.', options, f.fallback);
  expect(f.fetcher).not.toHaveBeenCalled(); expect(f.fallback).toHaveBeenCalledOnce();
  expect(f.notify).toHaveBeenCalledOnce(); expect(f.notify.mock.calls[0]![0]).toContain('Credentials');
});
it('the V220 tally stores counts, never text or audio, and Credentials lists characters', async () => {
  const update = vi.fn(async () => {});
  const recorder = new LanguageModelUsageRecorder({ get: (_key, fallback) => fallback, update }, vi.fn());
  configureLanguageModelUsage(recorder);
  const f = fixture();
  await f.speech.speak('Hello.', options, f.fallback); await recorder.flush();
  expect(recorder.today()).toEqual([expect.objectContaining({ provider: 'google-tts', model: 'chirp3-hd', requests: 1, characters: 6 })]);
  expect(JSON.stringify(update.mock.calls)).not.toContain('Hello.'); expect(JSON.stringify(update.mock.calls)).not.toContain(audio);
  expect(renderLanguageModelUsage(recorder.today())).toMatch(/google-tts chirp3-hd.*characters: 6/su);
});
function panel(presence = { googleCloudTranslation: true, googleCloudTextToSpeech: false }) {
  return renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'tutor', proModels: [],
    settings: { ...PANEL_SETTINGS_FIXTURE, tutorReadAloudProvider: 'googleChirp', credentialPresence: presence },
    tutor: createTutorViewState() });
}
it('the reader can select Chirp under VOICE & MODEL, TUTOR VOICE with stored voices, speed and Volume', () => {
  const $ = load(panel());
  const source = $('[data-setting="tutor.readAloud.provider"]');
  expect(source.find('option[value="googleChirp"]').text()).toBe('Google Cloud Chirp 3 HD');
  expect(source.closest('details').find('summary').first().text()).toContain('TUTOR VOICE');
  expect(source.closest('details').parent().closest('details').find('summary').first().text()).toContain('VOICE & MODEL');
  expect(source.attr('disabled')).toBeUndefined();
  expect($('[data-tutor-voice-command="updateTutorGeminiFemaleVoice"]')).toHaveLength(1);
  expect($('[data-tutor-voice-command="updateTutorGeminiMaleVoice"]')).toHaveLength(1);
  expect($('[data-provider-value="googleChirp"] [data-setting="tutor.readAloud.edgeRatePercent"]')).toHaveLength(1);
  expect($('[data-setting="tutor.readAloud.volume"]')).toHaveLength(1);
  expect($('[data-provider-value="googleChirp"]').text()).toMatch(/Credentials.*Cloud Translation/su);
  expect(PANEL_SETTING_KEYS.has('tutor.readAloud.provider')).toBe(true);
  expect(validatedPanelSetting('tutor.readAloud.provider', 'googleChirp')).toBe('googleChirp');
  // 2026-10-13: V231 adds Chirp to Read Aloud with its own voice setting.
  expect(validatedPanelSetting('readAloud.provider', 'googleChirp')).toBe('googleChirp');
});
it('Credentials shows only presence, Set and Remove, with the Translation-key note', () => {
  const $ = load(panel());
  expect($('[data-action="kren.setGoogleCloudTextToSpeechApiKey"]')).toHaveLength(1);
  expect($('[data-action="kren.deleteGoogleCloudTextToSpeechApiKey"]')).toHaveLength(1);
  expect($('#credentials-screen').text()).toContain('Using the Cloud Translation key.');
  expect(load(panel({ googleCloudTranslation: true, googleCloudTextToSpeech: true }))('#credentials-screen').text()).not.toContain('Using the Cloud Translation key.');
  expect(panel()).not.toContain(credential);
});
it('the in-place source patch hides Edge-only rows and exposes Chirp speed without replacing the draft', () => {
  const source = readFileSync('src/resultViewHtml.ts', 'utf8');
  // Changed 2026-10-24 (V308, owner I77/I78/I79): isolate the provider loop because tutor summary updates now follow it.
  const patch = source.split("document.querySelectorAll('[data-provider-for]').forEach((group) => {")[1]!.split('});')[0]! + '});';
  const states = new Map<string, boolean>();
  const groups = ['edgeOnline', 'googleChirp', 'windowsLocal'].map(expected => ({ hasAttribute: () => false,
    getAttribute: (name: string) => name === 'data-provider-for' ? 'tutor.readAloud.provider' : expected,
    classList: { toggle: (_name: string, hidden: boolean) => states.set(expected, hidden) } }));
  const answer = { value: 'Keep my draft.' };
  for (const value of ['googleChirp', 'edgeOnline']) {
    runInNewContext(`groups.forEach((group) => {${patch}`, { groups, settingValue: () => value });
    expect(states.get(value)).toBe(false);
    expect(states.get(value === 'googleChirp' ? 'edgeOnline' : 'googleChirp')).toBe(true);
    expect(answer.value).toBe('Keep my draft.');
  }
  const speedPatch = source.split('// 2026-10-11: Edge and Chirp share one stored speed, so switching sources keeps it current.')[1]!.split('const value = target instanceof HTMLInputElement')[0]!;
  const edge = { value: '0' }, chirp = { value: '25' };
  for (const target of [chirp, edge]) {
    target.value = target === chirp ? '25' : '-25';
    runInNewContext(speedPatch, { key: 'tutor.readAloud.edgeRatePercent', target, document: { querySelectorAll: () => [edge, chirp] } });
    expect(edge.value).toBe(target.value); expect(chirp.value).toBe(target.value);
    expect(answer.value).toBe('Keep my draft.');
  }
});

it('the tutor speech entry leaves Chirp idle while Gemini Live is speaking', () => {
  const source = readFileSync('src/speech/speechCenter.ts', 'utf8');
  // 2026-10-14: The same Live guard moved to the speech center.
  const guard = source.slice(source.indexOf("if (settingsSource === 'tutor' && this.host.liveSpeaking()"), source.indexOf('const speechNotice ='));
  const started = vi.fn();
  for (const speaking of [true, false]) {
    runInNewContext(`(function() {${guard} started();}).call({host})`, { settingsSource: 'tutor',
      settings: { provider: 'googleChirp' }, host: { liveSpeaking: () => speaking }, started });
    expect(started).toHaveBeenCalledTimes(speaking ? 0 : 1);
  }
});

it('the existing browser audio path plays in-memory MP3 at the selected Volume', () => {
  const source = readFileSync('src/resultViewHtml.ts', 'utf8');
  const patch = source.split("if (message.command === 'playGeneratedAudio' &&")[1]!.split("if (message.command === 'stopGeneratedAudio'")[0]!;
  class Player {
    src = ''; volume = 1;
    classList = { add: vi.fn() };
    pause = vi.fn(); play = vi.fn(async () => {});
  }
  const player = new Player();
  runInNewContext(`if (true && ${patch}`, { player, HTMLAudioElement: Player, message: { audioBase64: audio, volume: 25 }, vscode: { postMessage: vi.fn() }, playerMode: 'idle', generatedAudioGeneration: 0 });
  expect(player.src).toBe(`data:audio/mpeg;base64,${audio}`);
  expect(player.volume).toBe(0.25); expect(player.play).toHaveBeenCalledOnce();
});

// 2026-10-11: Run the actual extension Chirp branch with transport and playback fakes.
// Changed 2026-10-16: V248, owner item I25, explicit Chirp presets retain identity while fallback retains gender.
it.each([['en-US-ChristopherNeural', 'Enceladus', 'en-US-ChristopherNeural'],
  ['en-US-AvaNeural', 'Callirrhoe', 'en-US-AvaNeural'], ['Puck', 'Puck', 'en-US-ChristopherNeural'],
  ['Kore', 'Kore', 'en-US-AvaNeural']])('Chirp reads speaker %s using %s and preserves gender on fallback', async (speaker, expected, edge) => {
  // 2026-10-14: Exercise voice choice and fallback through the actual shared center.
  const f = fixture();
  const readAloudText = vi.fn(async (..._args: unknown[]) => {});
  const context = { context: {}, text: 'One tutor line.' };
  const center = new SpeechCenter(f.speech, fixture().speech,
    new EdgeOnlineSpeechAdapter({ stop: () => false, speak: async (text, options) => {
      await readAloudText(context.context, text, 'en', 'tutor', options?.voice, 'edgeOnline');
      return 'completed';
    } }), new LocalWindowsSpeechAdapter({ stop: () => false, speak: async () => true }), {
      configuration: () => ({ get: (key, fallback) => key === 'tutor.readAloud.provider' ? 'googleChirp' as any : fallback }),
      trusted: () => true, consent: async () => true, active: async () => {}, status: () => ({ dispose() {} }),
      hold: () => () => {}, started: () => {}, liveSpeaking: () => false, conversation: () => 'same-conversation',
      speakerVoice: () => speaker, playback: () => undefined, notify: () => {}, log: () => {}
    });
  await center.speak(context.text, 'en', 'tutor', speaker);
  let request = JSON.parse(String((f.fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0]![1].body));
  expect(request.voice.name).toBe(`en-US-Chirp3-HD-${expected}`);
  expect(request.voice.name).not.toMatch(/Neural/u);
  f.fetcher.mockImplementation(async () => new Response('', { status: 403 }));
  await center.speak(context.text, 'en', 'tutor', speaker);
  expect(readAloudText).toHaveBeenCalledWith(context.context, context.text, 'en', 'tutor', edge, 'edgeOnline');
});
it('logs every failure while showing one notice per conversation, including Back to chat', async () => {
  const f = fixture(vi.fn(async () => new Response('', { status: 403 })));
  const first = {};
  f.speech.beginConversation(first);
  await f.speech.speak('First.', options, f.fallback);
  f.speech.beginConversation(first);
  await f.speech.speak('Second.', options, f.fallback);
  expect(f.notify).toHaveBeenCalledOnce();
  expect(f.log).toHaveBeenCalledTimes(2);
  expect(f.log).toHaveBeenLastCalledWith('[speech] Google Cloud Text-to-Speech failed (HTTP 403); using Edge.');
  f.speech.beginConversation({});
  await f.speech.speak('New conversation.', options, f.fallback);
  expect(f.notify).toHaveBeenCalledTimes(2); expect(f.log).toHaveBeenCalledTimes(3);
});
it.each(['network', 'playback'] as const)('logs the fixed %s failure reason without text or credentials', async reason => {
  const f = fixture(reason === 'network' ? vi.fn(async () => { throw new Error(credential); }) : undefined);
  if (reason === 'playback') f.player.play.mockResolvedValue('failed');
  await f.speech.speak('Private speech.', options, f.fallback);
  expect(f.log).toHaveBeenCalledWith(`[speech] Google Cloud Text-to-Speech failed (${reason === 'network' ? 'no response' : 'playback'}); using Edge.`);
  expect(JSON.stringify(f.log.mock.calls)).not.toContain(credential);
  expect(JSON.stringify(f.log.mock.calls)).not.toContain('Private speech.');
});
it('Credentials Test synthesizes and plays a short sentence with the female choice', async () => {
  const f = fixture();
  expect(await f.speech.test({ ...options, voice: 'Callirrhoe' })).toBe('Google Cloud Text-to-Speech works.');
  const request = JSON.parse(String((f.fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0]![1].body));
  expect(request.voice.name).toBe('en-US-Chirp3-HD-Callirrhoe');
  expect(request.input.text.length).toBeLessThan(80); expect(f.player.play).toHaveBeenCalledOnce();
  expect(f.fallback).not.toHaveBeenCalled();
});
it.each([403, 429])('Credentials Test reports HTTP %s and never substitutes Edge', async status => {
  const f = fixture(vi.fn(async () => new Response(credential, { status })));
  const message = await f.speech.test({ ...options, voice: 'Callirrhoe' });
  expect(message).toContain(`Google Cloud Text-to-Speech failed (HTTP ${status}).`);
  if (status === 403) expect(message).toContain('Enable the Text-to-Speech API and billing in your Google Cloud project, and allow this key to use it.');
  expect(message).not.toContain(credential); expect(f.fallback).not.toHaveBeenCalled();
  expect(f.player.play).not.toHaveBeenCalled(); expect(f.notify).not.toHaveBeenCalled();
});

// 2026-10-11: The extra evidence requires stage codes and one bounded, cancelable retry.
// 2026-10-11: Retry every transient failure stage, including HTTP statuses beyond the old list.
it.each([404, 408, 429, 500, 502, 503, 'network'] as const)('retries %s exactly once after one second and plays a successful retry', async reason => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async (): Promise<Response> => response()).mockImplementationOnce(async () => {
    if (reason === 'network') throw new Error(credential);
    return new Response('', { status: reason });
  });
  const f = fixture(fetcher);
  const pending = f.speech.speak('Hello.', options, f.fallback);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(999); expect(fetcher).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1); await pending;
  expect(fetcher).toHaveBeenCalledTimes(2); expect(f.player.play).toHaveBeenCalledOnce();
  expect(f.fallback).not.toHaveBeenCalled(); expect(f.notify).not.toHaveBeenCalled();
  expect(f.log).toHaveBeenCalledWith(`[speech] Google Cloud Text-to-Speech failed (${reason === 'network' ? 'no response' : `HTTP ${reason}`}); retrying once.`);
  for (const [url, init] of fetcher.mock.calls as unknown as Array<[string, RequestInit]>) {
    expect(new URL(url).search).toBe(''); expect(new Headers(init.headers).get('X-Goog-Api-Key')).toBe(credential);
  }
});
it('a second transient failure falls back once and never makes a third request', async () => {
  vi.useFakeTimers();
  const f = fixture(vi.fn(async () => new Response('', { status: 503 })));
  const pending = f.speech.speak('Hello.', options, f.fallback);
  await vi.advanceTimersByTimeAsync(1000); await pending;
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.fetcher).toHaveBeenCalledTimes(2); expect(f.fallback).toHaveBeenCalledOnce(); expect(f.notify).toHaveBeenCalledOnce();
  expect(f.log).toHaveBeenLastCalledWith('[speech] Google Cloud Text-to-Speech failed (HTTP 503); using Edge.');
});
it('Stop during retry delay prevents both retry and Edge fallback', async () => {
  vi.useFakeTimers();
  const f = fixture(vi.fn(async () => { throw new Error(credential); }));
  const pending = f.speech.speak('Hello.', options, f.fallback);
  await vi.advanceTimersByTimeAsync(0); f.speech.stop(); await pending;
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.fetcher).toHaveBeenCalledOnce(); expect(f.fallback).not.toHaveBeenCalled(); expect(f.notify).not.toHaveBeenCalled();
});
// 2026-10-11: Two unreadable attempts still fall back without exposing the payload.
it.each([undefined, 'not base64!', '', 'a', null])('reports unreadable audio %s after one retry without payload disclosure', async content => {
  const f = fixture(vi.fn(async () => new Response(JSON.stringify({ audioContent: content }))));
  await f.speech.speak('Hello.', options, f.fallback);
  // 2026-10-11: Unreadable synthesis retries once before falling back.
  expect(f.fetcher).toHaveBeenCalledTimes(2); expect(f.player.play).not.toHaveBeenCalled();
  expect(f.log).toHaveBeenCalledWith('[speech] Google Cloud Text-to-Speech failed (unreadable audio); using Edge.');
  expect(f.notify.mock.calls[0]![0]).toContain('unreadable audio');
});
it('HTTP errors expose only Google status/reason enums in both logs and Test results', async () => {
  const f = fixture(vi.fn(async () => new Response(JSON.stringify({ error: {
    status: 'PERMISSION_DENIED', message: credential, details: [{ reason: 'SERVICE_DISABLED', metadata: { key: credential } }, { reason: 'API_KEY_SERVICE_BLOCKED' }, { reason: credential }]
  } }), { status: 403 })));
  await f.speech.speak('Hello.', options, f.fallback);
  expect(f.log).toHaveBeenCalledWith('[speech] Google Cloud Text-to-Speech failed (HTTP 403 PERMISSION_DENIED SERVICE_DISABLED API_KEY_SERVICE_BLOCKED); using Edge.');
  const result = await f.speech.test(options);
  expect(result).toContain('HTTP 403 PERMISSION_DENIED SERVICE_DISABLED API_KEY_SERVICE_BLOCKED');
  expect(result).not.toContain(credential); expect(JSON.stringify(f.log.mock.calls)).not.toContain(credential);
  expect(f.fetcher).toHaveBeenCalledTimes(2); // Neither 403 request retries.
});
