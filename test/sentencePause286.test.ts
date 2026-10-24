import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { load } from 'cheerio';
import { afterEach, expect, it, vi } from 'vitest';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { createTutorViewState } from '../src/tutor/state.js';
import { TUTOR_DEFAULTS } from '../src/tutor/defaults.js';
import { validatedPanelSetting, PANEL_SETTING_KEYS } from '../src/panelSettings.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { WindowsReadAloudPlayer } from '../src/windowsReadAloud.js';
import { WindowsEdgeReadAloudPlayer, SpeechCenter, GoogleChirpSpeech, type SpeechHost, type SpeechResult } from '../src/speech/speechCenter.js';
import { GoogleChirpPlayer, chirpSentences } from '../src/googleChirpSpeech.js';
import { splitSpeechSentences } from '../src/speech/sentencePause.js';
import { LocalWindowsSpeechAdapter, EdgeOnlineSpeechAdapter } from '../src/speech/windowsSpeechAdapters.js';

const setting = 'tutor.readAloud.sentencePauseMilliseconds';
afterEach(() => { vi.useRealTimers(); });

function page(pause = 0, live = false, provider: 'windowsLocal' | 'edgeOnline' | 'googleChirp' = 'edgeOnline') {
  const tutor = createTutorViewState();
  tutor.conversation.replies = live ? 'liveGemini' : 'standard';
  return renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'tutor', tutor,
    settings: { ...PANEL_SETTINGS_FIXTURE, tutorSentencePauseMilliseconds: pause, tutorReadAloudProvider: provider }, proModels: [] });
}

it.each(['windowsLocal', 'edgeOnline', 'googleChirp'] as const)('offers the ordered pause choices outside %s visibility rules and within keyboard reachable TUTOR VOICE', provider => {
  const $ = load(page(0, false, provider));
  const control = $(`[data-setting="${setting}"]`);
  expect(control).toHaveLength(1);
  expect(control.closest('label').find('.setting-title').text()).toBe('Sentence pause');
  expect(control.find('option').map((_i, element) => [[$(element).val(), $(element).text()]]).get()).toEqual([
    ['0', 'Engine default'], ['250', '0.25 s'], ['500', '0.5 s'], ['750', '0.75 s'], ['1000', '1.0 s']
  ]);
  expect(control.find('option:selected').val()).toBe('0');
  expect(control.closest('.conditional-group, [data-tutor-voice-group], [hidden]')).toHaveLength(0);
  // The two existing disclosures are reachable by their native summary controls.
  expect(control.parents('details').map((_i, element) => $(element).attr('data-persist-id')).get()).toEqual(['tutor-voice', 'tutor-setting']);
  for (const disclosure of control.parents('details').toArray()) {
    expect($(disclosure).children('summary')).toHaveLength(1);
    expect($(disclosure).children('summary').attr('tabindex')).not.toBe('-1');
  }
  expect(control.attr('tabindex')).not.toBe('-1');
  expect(control.attr('disabled')).toBeUndefined();
});

it('declares and validates only the five pause values, including dropdown strings', () => {
  const properties = JSON.parse(readFileSync('package.json', 'utf8')).contributes.configuration.properties;
  expect(properties[`kren.${setting}`]).toMatchObject({ type: 'number', default: 0, enum: [0, 250, 500, 750, 1000] });
  expect(TUTOR_DEFAULTS.configuration[setting]).toBe(0);
  expect(PANEL_SETTING_KEYS.has(setting)).toBe(true);
  for (const value of [0, 250, 500, 750, 1000]) {
    expect(validatedPanelSetting(setting, value)).toBe(value);
    expect(validatedPanelSetting(setting, String(value))).toBe(value);
  }
  for (const value of [-1, 1, 499, 500.1, 1001, NaN, Infinity, '', ' ', '0500', '5e2', '500ms', true, null, undefined]) {
    expect(validatedPanelSetting(setting, value as string | number | boolean)).toBeUndefined();
  }
});

it('shows the Live limitation beside the enabled choice only in Live mode', () => {
  const live = load(page(500, true));
  const row = live(`[data-setting="${setting}"]`).closest('label');
  expect(row.text()).toContain('Gemini Live sets its own pauses.');
  expect(row.find('select').attr('disabled')).toBeUndefined();
  const standard = load(page(500));
  expect(standard(`[data-setting="${setting}"]`).closest('label').text()).not.toContain('Gemini Live sets its own pauses.');
});

it('patches a saved pause in place while retaining disclosure state and the draft answer', () => {
  const $ = load(page());
  const selector = 'details[data-persist-id="tutor-setting"]';
  const group = $(selector);
  group.find('[data-persist-id="tutor-voice"]').attr('open', '');
  const sections = () => group.find('details[data-persist-id]').toArray().map(element => ({
    getAttribute: (key: string) => $(element).attr(key),
    get open() { return $(element).attr('open') !== undefined; },
    set open(value: boolean) { if (value) $(element).attr('open', ''); else $(element).removeAttr('open'); }
  }));
  const current = { querySelectorAll: sections, get innerHTML() { return group.html(); }, set innerHTML(value: string | null) { group.html(value ?? ''); } };
  class Parser { parseFromString(markup: string) { return { querySelector: () => ({ innerHTML: load(markup)(selector).html() }) }; } }
  const answer = { value: 'My unsent answer', selectionStart: 3 };
  const script = $('script').text();
  const patch = script.slice(script.indexOf('function patchTutorVoiceModel(message)'), script.indexOf('function patchTutorConversationSpeechDetection'));
  runInNewContext(patch + '\npatchTutorVoiceModel(message);', { document: { querySelector: () => current, activeElement: answer }, DOMParser: Parser,
    message: { html: page(500, true) }, applyConditionalSettings: vi.fn() });
  expect(group.find(`[data-setting="${setting}"] option:selected`).val()).toBe('500');
  expect(group.find(`[data-setting="${setting}"]`).closest('label').text()).toContain('Gemini Live sets its own pauses.');
  expect(group.find('[data-persist-id="tutor-voice"]').attr('open')).toBeDefined();
  expect(answer).toEqual({ value: 'My unsent answer', selectionStart: 3 });
});

it('keeps titles and decimals inside sentences with one shared splitter', () => {
  expect(splitSpeechSentences('Mr. Smith paid 3.5 dollars. Dr. Jones agreed! Next?')).toEqual([
    'Mr. Smith paid 3.5 dollars.', 'Dr. Jones agreed!', 'Next?'
  ]);
});

function child() {
  const process = new EventEmitter() as ChildProcess;
  const input = new PassThrough();
  Object.defineProperty(process, 'stdin', { value: input });
  process.kill = vi.fn(() => { process.emit('exit', null); return true; });
  let text = '';
  input.on('data', chunk => { text += chunk.toString(); });
  return { process, text: () => text };
}

async function windowsRequest(pause?: number) {
  const fake = child();
  const spawn = vi.fn((_command: string, _args: readonly string[], _options: SpawnOptions) => fake.process);
  const player = new WindowsReadAloudPlayer('win32', spawn);
  const pending = player.speak('Mr. Smith has 3.5. Tom & Jane agree.', { voice: 'Microsoft David Desktop', rate: 2, volume: 75, sentencePauseMilliseconds: pause });
  fake.process.emit('exit', 0);
  expect(await pending).toBe(true);
  return { calls: spawn.mock.calls, text: fake.text() };
}

it('leaves the Windows zero request byte identical to the existing plain text request', async () => {
  expect(await windowsRequest(0)).toEqual(await windowsRequest());
  const result = await windowsRequest(0);
  expect(result.text).toBe('Mr. Smith has 3.5. Tom & Jane agree.');
  expect(result.calls[0]![1].at(-1)).toContain('$speaker.Speak($text)');
  expect(result.calls[0]![1].at(-1)).not.toContain('SpeakSsml');
});

it('uses Windows SpeakSsml with escaped text and a 500 ms break, retaining voice, rate and volume', async () => {
  const result = await windowsRequest(500);
  expect(result.text).toContain('Mr. Smith has 3.5.<break time="500ms"/>Tom &amp; Jane agree.');
  expect(result.text.match(/<break /gu)).toHaveLength(1);
  expect(result.calls[0]![1].at(-1)).toContain('$speaker.SpeakSsml($ssml.OuterXml)');
  expect(result.calls[0]![1].at(-1)).toContain("$voice.SetAttribute('name', $speaker.Voice.Name)");
  expect(result.calls[0]![1].at(-1)).toContain("$root.SetAttribute('xml:lang', $speaker.Voice.Culture.Name)");
  expect(result.calls[0]![2].env).toMatchObject({ KREN_SPEECH_VOICE: 'Microsoft David Desktop', KREN_SPEECH_RATE: '2', KREN_SPEECH_VOLUME: '75' });
});

it('allows Windows speech time for the inserted pauses before its watchdog expires', async () => {
  vi.useFakeTimers();
  const fake = child();
  const player = new WindowsReadAloudPlayer('win32', () => fake.process);
  const pending = player.speak('Hi. '.repeat(40), { sentencePauseMilliseconds: 1000 });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(fake.process.kill).not.toHaveBeenCalled();
  fake.process.emit('exit', 0);
  expect(await pending).toBe(true);
});

function chirpFixture(responses: number[] = []) {
  const bodies: string[] = [];
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(String(init?.body));
    const status = responses.shift() ?? 200;
    return new Response(JSON.stringify(status === 200 ? { audioContent: 'YQ==' } : {}), { status });
  });
  const playback = { play: vi.fn(async () => 'completed' as const), stop: () => false };
  const log = vi.fn();
  const player = new GoogleChirpPlayer(async () => 'test-placeholder', playback, fetcher, log);
  return { player, bodies, fetcher, playback, log };
}

const chirpText = 'Mr. Smith paid 3.5. Tom & Jane say "yes" <today>.';
it('leaves each Chirp zero group request byte identical to the original plain text body', async () => {
  const f = chirpFixture();
  await f.player.speak(chirpText, { voice: 'Enceladus', sentencePauseMilliseconds: 0 }, -25, 75);
  const legacy = chirpFixture();
  await legacy.player.speak(chirpText, { voice: 'Enceladus' }, -25, 75);
  expect(f.bodies).toEqual(legacy.bodies);
  expect(f.bodies).toEqual(chirpSentences(chirpText).map(text => JSON.stringify({ input: { text },
    voice: { languageCode: 'en-US', name: 'en-US-Chirp3-HD-Enceladus' }, audioConfig: { audioEncoding: 'MP3', speakingRate: 0.75 } })));
});

it('sends Chirp 500 ms SSML breaks between escaped sentences', async () => {
  const f = chirpFixture();
  await expect(f.player.speak(chirpText, { voice: 'Enceladus', sentencePauseMilliseconds: 500 }, -25, 75)).resolves.toEqual({ status: 'completed' });
  expect(f.bodies).toHaveLength(1);
  const body = JSON.parse(f.bodies[0]!);
  expect(body.input.ssml).toContain('Mr. Smith paid 3.5.<break time="500ms"/>Tom &amp; Jane say &quot;yes&quot; &lt;today&gt;.');
  expect(body.input).not.toHaveProperty('text');
  expect(body.audioConfig.speakingRate).toBe(0.75);
  expect(f.playback.play).toHaveBeenCalledWith('YQ==', 75, expect.any(Function));
});

it('retains ordered Chirp groups and inserts a break at group boundaries', async () => {
  const f = chirpFixture();
  const text = 'This first sentence is long enough to be a group. This second sentence is also long enough to be its own group.';
  await f.player.speak(text, { voice: 'Enceladus', sentencePauseMilliseconds: 500 }, 0, 100);
  expect(f.bodies).toHaveLength(2);
  expect(JSON.parse(f.bodies[0]!).input.ssml).toContain('group.<break time="500ms"/></speak>');
  expect(JSON.parse(f.bodies[1]!).input.ssml).not.toContain('<break');
  expect(f.playback.play).toHaveBeenCalledTimes(2);
});

it.each([200, 400, 503])('retries a rejected Chirp SSML group once as plain text, then stops retrying for HTTP %s', async secondStatus => {
  const f = chirpFixture([400, secondStatus]);
  const result = await f.player.speak(chirpText, { voice: 'Enceladus', sentencePauseMilliseconds: 500 }, 0, 100);
  expect(result.status).toBe(secondStatus === 200 ? 'completed' : 'failed');
  expect(f.bodies).toHaveLength(2);
  expect(JSON.parse(f.bodies[0]!).input).toHaveProperty('ssml');
  expect(JSON.parse(f.bodies[1]!).input).toEqual({ text: chirpText });
  expect(f.log).toHaveBeenCalledWith('[speech] Google Cloud Text-to-Speech rejected SSML (HTTP 400); retrying group once as plain text.');
  expect(JSON.stringify(f.log.mock.calls)).not.toContain(chirpText);
});

function edgeFixture() {
  const texts: string[] = [];
  const spawn = vi.fn((_command: string, _args: readonly string[], _options: SpawnOptions) => {
    const fake = child();
    fake.process.stdin!.on('finish', () => { texts.push(fake.text()); queueMicrotask(() => fake.process.emit('exit', 0)); });
    return fake.process;
  });
  let index = 0;
  const playback = { play: vi.fn(async (): Promise<'completed' | 'stopped' | 'failed' | 'dependencyMissing'> => 'completed'), stop: vi.fn(() => true) };
  const player = new WindowsEdgeReadAloudPlayer('win32', spawn,
    async () => ({ directory: 'temporary', file: `clip-${++index}.mp3` }), vi.fn(async () => {}), async () => true);
  return { player, spawn, texts, playback };
}

it('leaves the Edge zero request byte identical to the original single plain text request', async () => {
  const zero = edgeFixture(), legacy = edgeFixture();
  await zero.player.speak('One sentence. Another sentence.', { sentencePauseMilliseconds: 0, playback: zero.playback });
  await legacy.player.speak('One sentence. Another sentence.', { playback: legacy.playback });
  expect(zero.texts).toEqual(['One sentence. Another sentence.']);
  expect(zero.texts).toEqual(legacy.texts);
  expect(zero.spawn.mock.calls).toEqual(legacy.spawn.mock.calls);
});

it('plays Edge sentence clips in order with exactly 500 ms of silence between clips', async () => {
  vi.useFakeTimers();
  const f = edgeFixture();
  const pending = f.player.speak('Mr. Smith has 3.5. Another sentence.', { sentencePauseMilliseconds: 500, playback: f.playback, voice: 'en-US-AvaNeural', ratePercent: 10, volume: 75 });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.texts).toEqual(['Mr. Smith has 3.5.', 'Another sentence.']);
  expect(f.playback.play.mock.calls).toEqual([['clip-1.mp3']]);
  await vi.advanceTimersByTimeAsync(499);
  expect(f.playback.play).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toBe('completed');
  expect(f.texts).toEqual(['Mr. Smith has 3.5.', 'Another sentence.']);
  expect(f.playback.play.mock.calls).toEqual([['clip-1.mp3'], ['clip-2.mp3']]);
  expect(f.spawn.mock.calls.every(([, , options]) => options.env?.KREN_EDGE_VOICE === 'en-US-AvaNeural' && options.env.KREN_EDGE_RATE === '+10%' && options.env.KREN_EDGE_VOLUME === '-25%')).toBe(true);
});

it('Stop cancels Edge silence immediately and prevents later clips', async () => {
  vi.useFakeTimers();
  const f = edgeFixture();
  const pending = f.player.speak('First sentence. Second sentence. Third sentence.', { sentencePauseMilliseconds: 500, playback: f.playback });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.playback.play).toHaveBeenCalledOnce();
  expect(f.player.stop()).toBe(true);
  expect(await pending).toBe('stopped');
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.spawn).toHaveBeenCalledTimes(2);
  expect(f.playback.play).toHaveBeenCalledOnce();
});

it('Stop ends Edge playback immediately and discards the prefetched clip', async () => {
  vi.useFakeTimers();
  const f = edgeFixture();
  let finish!: (result: 'stopped') => void;
  f.playback.play.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  f.playback.stop.mockImplementation(() => { finish('stopped'); return true; });
  const pending = f.player.speak('First sentence. Second sentence.', { sentencePauseMilliseconds: 500, playback: f.playback });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.player.stop()).toBe(true);
  expect(await pending).toBe('stopped');
  expect(f.playback.stop).toHaveBeenCalledOnce();
  expect(f.playback.play).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('uses the existing hidden native Edge player for ordered sentence clips', async () => {
  vi.useFakeTimers();
  const played: Array<{ file: string; time: number }> = [];
  const spawn = vi.fn((_command: string, _args: readonly string[], options: SpawnOptions) => {
    const fake = child();
    if (options.env?.KREN_AUDIO_FILE) {
      played.push({ file: options.env.KREN_AUDIO_FILE, time: Date.now() });
      queueMicrotask(() => fake.process.emit('exit', 0));
    } else fake.process.stdin!.on('finish', () => { queueMicrotask(() => fake.process.emit('exit', 0)); });
    return fake.process;
  });
  let index = 0;
  const player = new WindowsEdgeReadAloudPlayer('win32', spawn,
    async () => ({ directory: 'temporary', file: `native-${++index}.mp3` }), vi.fn(async () => {}), async () => true);
  const pending = player.speak('First sentence. Second sentence.', { sentencePauseMilliseconds: 500 });
  await vi.advanceTimersByTimeAsync(0);
  expect(played).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(500);
  expect(await pending).toBe('completed');
  expect(played.map(clip => clip.file)).toEqual(['native-1.mp3', 'native-2.mp3']);
  expect(played[1]!.time - played[0]!.time).toBe(500);
  for (const [, args, options] of spawn.mock.calls.filter(([, , options]) => options.env?.KREN_AUDIO_FILE)) {
    expect(args).toContain('Hidden');
    expect(options.windowsHide).toBe(true);
  }
});

it('passes the pause through both Windows adapters', async () => {
  const local = { speak: vi.fn(async () => true), stop: () => false };
  await new LocalWindowsSpeechAdapter(local).speak('First. Second.', { voice: 'local', sentencePauseMilliseconds: 500 }, 2, 75);
  expect(local.speak).toHaveBeenCalledWith('First. Second.', expect.objectContaining({ sentencePauseMilliseconds: 500, rate: 2, volume: 75 }));
  const edge = { speak: vi.fn(async () => 'completed' as const), stop: () => false };
  await new EdgeOnlineSpeechAdapter(edge).speak('First. Second.', { voice: 'edge', sentencePauseMilliseconds: 500 }, 10, 75);
  expect(edge.speak).toHaveBeenCalledWith('First. Second.', expect.objectContaining({ sentencePauseMilliseconds: 500, ratePercent: 10, volume: 75 }));
});

it.each(['tutor', 'shared'] as const)('applies pauses through tutor fallback only for %s settings', async source => {
  const playback = { play: vi.fn(async () => 'completed' as const), stop: () => false };
  const tutor = new GoogleChirpSpeech(async () => undefined, playback, vi.fn());
  const shared = new GoogleChirpSpeech(async () => undefined, playback, vi.fn());
  const failed: SpeechResult = { status: 'failed', cause: 'test' };
  const chirp = vi.spyOn(source === 'tutor' ? tutor.adapter : shared.adapter, 'speak').mockResolvedValue(failed);
  const edge = { speak: vi.fn(async () => failed), stop: () => false };
  const windows = { speak: vi.fn(async (): Promise<SpeechResult> => ({ status: 'completed' })), stop: () => false };
  const host: SpeechHost = { configuration: () => ({ get: <T>(key: string, fallback: T): T =>
    (key === setting ? 500 : key.endsWith('.provider') ? 'googleChirp' : fallback) as T }),
    trusted: () => true, consent: async () => true, active: async () => {}, status: () => ({ dispose() {} }),
    hold: () => () => {}, started() {}, liveSpeaking: () => false, conversation: () => ({}), speakerVoice: () => 'Callirrhoe',
    playback: () => undefined, notify() {}, log() {} };
  await new SpeechCenter(tutor, shared, edge, windows, host).speak('Hello. Again.', 'en', source);
  for (const speak of [chirp, edge.speak, windows.speak]) {
    expect(speak).toHaveBeenCalledOnce();
    if (source === 'tutor') expect(speak.mock.calls[0]![1]).toHaveProperty('sentencePauseMilliseconds', 500);
    else expect(speak.mock.calls[0]![1]).not.toHaveProperty('sentencePauseMilliseconds');
  }
});
