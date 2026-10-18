// 2026-10-13: V231 tests the shipped Read Aloud entry and mounted source switches.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
import { load } from 'cheerio';
import { EDGE_SPEECH_AUTO_LOCALE, resolveEdgeSpeechLocale, resolveEdgeSpeechVoice } from '@kren/core/edge-speech';
import { GoogleChirpSpeech, SpeechCenter, tutorChirpVoices } from '../src/speech/speechCenter.js';
import { READ_ALOUD_CHIRP_LOCALES, READ_ALOUD_CHIRP_VOICES, normalizedReadAloudChirpVoice, resolveReadAloudChirpLocale } from '../src/readAloudChirp.js';
import { prepareTextForSpeech } from '../src/windowsReadAloud.js';
import { WindowsEdgeReadAloudPlayer } from '../src/speech/speechCenter.js';
import { edgeSpeechFailureMessage, edgeSpeechRetryNotice } from '../src/edgeSpeechMessages.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { PANEL_SETTING_KEYS, validatedPanelSetting } from '../src/panelSettings.js';
import { isCommandMessage } from '../src/resultsViewCommands.js';
import { configureLanguageModelUsage, LanguageModelUsageRecorder } from '../src/languageModelUsage.js';
import { KREN_SECRET_KEYS } from '../src/operations.js';
import { TUTOR_DEFAULTS } from '../src/tutor/defaults.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { EdgeOnlineSpeechAdapter, LocalWindowsSpeechAdapter } from '../src/speech/windowsSpeechAdapters.js';
import { mountSpeechCenter } from './support/speechCenterHarness.js';
import { mountedPanel } from './support/mountedPanel.js';

const source = readFileSync('src/extension.ts', 'utf8');
const entry = source.slice(source.indexOf('async function readAloudText('), source.indexOf('\nasync function ', source.indexOf('async function readAloudText(') + 1));
const construction = source.slice(source.indexOf('  chirpSpeech = new GoogleChirpSpeech'), source.indexOf('\n  grammarCodeActions ='));
const transpile = (text: string) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const credential = ['mock', 'speech', 'only'].join('-');
const audio = 'AQIDBA==';
const ok = () => new Response(JSON.stringify({ audioContent: audio }));
afterEach(() => { vi.useRealTimers(); configureLanguageModelUsage(undefined); });

function harness(values: Record<string, unknown> = {}, panelOpen = true) {
  const settings: Record<string, unknown> = { 'readAloud.provider': 'googleChirp', 'readAloud.chirpVoice': 'Aoede',
    'readAloud.edgeLocale': 'ko-KR', 'readAloud.edgeVoice': 'ko-KR-SunHiNeural',
    'readAloud.edgeRatePercent': -25, 'readAloud.volume': 50, 'readAloud.voice': 'Shared Windows', 'readAloud.rate': 2,
    'tutor.readAloud.provider': 'googleChirp', 'tutor.liveFemaleVoice': 'Kore', 'tutor.liveMaleVoice': 'Puck',
    'tutor.readAloud.edgeRatePercent': 10, 'tutor.readAloud.volume': 75, ...values };
  const get = vi.fn((key: string, fallback: unknown) => settings[key] ?? fallback);
  const fetcher = vi.fn(async () => ok());
  const getSecret = vi.fn(async (_slot: string): Promise<string | undefined> => credential);
  const notify = vi.fn(), log = vi.fn();
  const edge = { speak: vi.fn(async (_text: string, _options: any): Promise<string> => 'completed'),
    stop: vi.fn(() => false), playBase64: vi.fn(async (): Promise<'completed' | 'failed' | 'stopped'> => 'completed') };
  const native = { beginSession: vi.fn(), play: vi.fn(async (_audio: string, _volume: number, started?: () => void): Promise<'completed' | 'failed' | 'stopped'> => { started?.(); return 'completed'; }), stop: vi.fn(() => false), failureCause: () => 'mediaFailed' };
  const windows = { speak: vi.fn(async (_text: string, _options: any) => true), stop: vi.fn(() => false) };
  const panel = { edgeAudioPlayback: () => panelOpen ? {} : undefined,
    playGeneratedAudioBase64: vi.fn(async (): Promise<'completed' | 'failed' | 'stopped'> => 'completed'),
    stopGeneratedAudio: vi.fn(() => false), generatedAudioFailureCause: () => undefined,
    tutorSpeechPlaybackStarted: vi.fn(), holdTutorSpeech: vi.fn(() => vi.fn()), tutorSpeechConversationIdentity: () => 'conversation', tutorLiveSpeaking: () => false };
  const context: any = { context: { secrets: { get: getSecret } }, GoogleChirpSpeech, SpeechCenter, EdgeOnlineSpeechAdapter, LocalWindowsSpeechAdapter, fetch: fetcher,
    nativeAudioPlayer: native, readAloudSession: 0, resultsView: panel, edgeReadAloudPlayer: edge, readAloudPlayer: windows,
    outputChannel: { appendLine: log }, notify, normalizedReadAloudChirpVoice, resolveReadAloudChirpLocale, prepareTextForSpeech,
    resolveEdgeSpeechLocale, resolveEdgeSpeechVoice, EDGE_SPEECH_AUTO_LOCALE, tutorChirpVoices, TUTOR_DEFAULTS,
    edgeSpeechFailureMessage, edgeSpeechRetryNotice, READ_ALOUD_PROVIDER_DEFAULT: 'edgeOnline',
    ensureEdgeTtsConsent: vi.fn(async () => true), showKrenErrorMessage: vi.fn(),
    vscode: { workspace: { isTrusted: true, getConfiguration: () => ({ get }) },
      commands: { executeCommand: vi.fn(async () => {}) }, window: { setStatusBarMessage: () => ({ dispose() {} }) } } };
  // 2026-10-14: Keep production construction and forwarding; the center owns the Stop generation.
  runInNewContext(transpile(construction + '\n' + entry), context);
  mountSpeechCenter(context);
  return { context, edge, windows, native, panel, tutor: context.chirpSpeech as GoogleChirpSpeech, fetcher, getSecret, notify, log, get,
    speak: (text = '**안녕하세요** [1].', language?: string) => context.readAloudText(context.context, text, language) as Promise<void> };
}

it.each(READ_ALOUD_CHIRP_LOCALES)('keeps exact Chirp locale %s', locale => {
  expect(resolveReadAloudChirpLocale(locale)).toBe(locale);
});
it.each([
  ['zh-CN', 'cmn-CN'], ['zh-SG', 'cmn-CN'], ['zh', 'cmn-CN'], ['zh-HK', 'yue-HK'],
  ['en-CA', 'en-US'], ['en', 'en-US'], ['es-MX', 'es-ES'], ['fr-BE', 'fr-FR'],
  ['pt-PT', 'pt-BR'], ['nl-SR', 'nl-NL'], ['ko', 'ko-KR'], ['de-AT', 'de-DE'],
  ['ja-JP-extra', 'ja-JP'], ['xx-XX', undefined], ['zh-TW', undefined]
])('maps resolved Edge locale %s to %s', (locale, expected) => {
  expect(resolveReadAloudChirpLocale(locale)).toBe(expected);
});
it('validates all 30 voices, rejects unknown writes, and defaults an unknown stored voice', () => {
  expect(READ_ALOUD_CHIRP_VOICES).toHaveLength(30);
  expect(READ_ALOUD_CHIRP_LOCALES).toHaveLength(53);
  expect(PANEL_SETTING_KEYS.has('readAloud.chirpVoice')).toBe(true);
  for (const [voice] of READ_ALOUD_CHIRP_VOICES) expect(validatedPanelSetting('readAloud.chirpVoice', voice)).toBe(voice);
  expect(validatedPanelSetting('readAloud.chirpVoice', 'Unknown')).toBeUndefined();
  expect(normalizedReadAloudChirpVoice('Unknown')).toBe('Callirrhoe');
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')).contributes.configuration.properties;
  expect(manifest['kren.readAloud.provider'].enum).toContain('googleChirp');
  expect(manifest['kren.readAloud.chirpVoice'].enum).toEqual(READ_ALOUD_CHIRP_VOICES.map(([voice]) => voice));
  expect(manifest['kren.readAloud.chirpVoice'].default).toBe('Callirrhoe');
});

it('the open Read Aloud section exposes keyboard controls, saves Chirp rows, and patches source switches in place', () => {
  const html = renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'settings', proModels: [],
    settings: { ...PANEL_SETTINGS_FIXTURE, readAloudProvider: 'googleChirp', readAloudChirpVoice: 'Unknown' } });
  const $ = load(html), section = $('details[data-settings-section="readAloud"]');
  expect(section.attr('open')).toBeDefined();
  const sourceControl = section.find('[data-setting="readAloud.provider"]');
  expect(sourceControl.find('option').map((_, node) => $(node).attr('value')).get()).toEqual(['edgeOnline', 'googleChirp', 'windowsLocal']);
  expect(section.find('[data-setting="readAloud.chirpVoice"] option:selected').text()).toBe('Callirrhoe (female)');
  expect(section.find('[data-action="kren.previewReadAloud"]')).toHaveLength(1);
  expect(section.find('[data-action="kren.stopReadAloud"]')).toHaveLength(1);
  const saved: Record<string, unknown> = {};
  const panel = mountedPanel(html, message => {
    if (message.command === 'updateSetting') {
      // 2026-10-13: Only setting writes enter this validator; audio readiness is a priority message.
      expect(isCommandMessage(message)).toBe(true);
      const key = message.key as any;
      const value = validatedPanelSetting(key, message.value as any);
      expect(value).toBeDefined(); saved[key] = value;
    }
  });
  const group = (provider: string) => panel.query('[data-provider-for="readAloud.provider"][data-provider-value="' + provider + '"]')!;
  const sourceNode = panel.query('[data-setting="readAloud.provider"]')!;
  expect(group('googleChirp').className).not.toContain('hidden');
  expect(group('edgeOnline').className).toContain('hidden');
  expect(group('edgeOnline').textContent).toMatch(/Edge TTS Voice.*Editable Edge TTS voice ID.*Python command.*Edge TTS:/su);
  for (const [key, value] of [['readAloud.chirpVoice', 'Aoede'], ['readAloud.edgeLocale', 'fr-FR'], ['readAloud.edgeRatePercent', '25']]) {
    const control = group('googleChirp').querySelector('[data-setting="' + key + '"]')!;
    expect(control.disabled).toBe(false); expect(control.getAttribute('tabindex')).not.toBe('-1');
    control.value = value!; panel.change(control);
  }
  expect(saved).toEqual({ 'readAloud.chirpVoice': 'Aoede', 'readAloud.edgeLocale': 'fr-FR', 'readAloud.edgeRatePercent': 25 });
  expect(group('googleChirp').textContent).toMatch(/Reading speed.*cleaned speech copy.*Google Cloud Text-to-Speech/su);
  sourceNode.value = 'edgeOnline'; panel.change(sourceNode);
  expect(group('googleChirp').className).toContain('hidden'); expect(group('edgeOnline').className).not.toContain('hidden');
  expect(group('edgeOnline').querySelector('[data-setting="readAloud.edgeLocale"]')!.value).toBe('fr-FR');
  expect(group('edgeOnline').querySelector('[data-setting="readAloud.edgeRatePercent"]')!.value).toBe('25');
  sourceNode.value = 'googleChirp'; panel.change(sourceNode);
  expect(saved['readAloud.provider']).toBe('googleChirp');
  expect(panel.query('[data-setting="readAloud.provider"]')).toBe(sourceNode);
  expect(group('googleChirp').querySelector('[data-setting="readAloud.chirpVoice"]')!.value).toBe('Aoede');
});

it('sends only cleaned speech, Read Aloud voice, locale, speed and header key, with Read Aloud usage', async () => {
  const usageLog = vi.fn(); configureLanguageModelUsage(new LanguageModelUsageRecorder({ get: (_key, fallback) => fallback, update: async () => {} }, usageLog));
  const h = harness(); await h.speak();
  const [url, init] = h.fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://texttospeech.googleapis.com/v1/text:synthesize'); expect(new URL(url).search).toBe('');
  expect(url).not.toContain(credential); expect(new Headers(init.headers).get('X-Goog-Api-Key')).toBe(credential);
  expect(JSON.parse(String(init.body))).toEqual({ input: { text: '안녕하세요.' }, voice: { languageCode: 'ko-KR', name: 'ko-KR-Chirp3-HD-Aoede' }, audioConfig: { audioEncoding: 'MP3', speakingRate: 0.75 } });
  expect(h.get.mock.calls.some(([key]) => key.startsWith('tutor.'))).toBe(false);
  // 2026-10-14: Chirp always uses the shared native player, independent of panel visibility.
  expect(h.native.play).toHaveBeenCalledWith(audio, 50, expect.any(Function));
  expect(h.native.beginSession).toHaveBeenCalledOnce();
  expect(h.panel.playGeneratedAudioBase64).not.toHaveBeenCalled();
  expect(h.edge.playBase64).not.toHaveBeenCalled(); expect(h.notify).not.toHaveBeenCalled();
  expect(usageLog.mock.calls.some(([line]) => line.includes('[usage] readAloud google-tts'))).toBe(true);
});
it.each([['auto', '안녕하세요.', undefined, 'ko-KR'], ['auto', 'Bonjour.', 'fr', 'fr-FR'], ['zh-SG', '你好。', undefined, 'cmn-CN'], ['pt-PT', 'Bom dia.', undefined, 'pt-BR']])(
  'uses existing locale resolution for %s and maps its result', async (configured, text, language, locale) => {
    const h = harness({ 'readAloud.edgeLocale': configured }); await h.speak(text, language);
    const init = (h.fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body)).voice.languageCode).toBe(locale);
  });
it('uses Callirrhoe when the stored Read Aloud voice is unknown', async () => {
  const h = harness({ 'readAloud.chirpVoice': 'Unknown' }); await h.speak();
  expect(JSON.parse(String((h.fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body)).voice.name).toBe('ko-KR-Chirp3-HD-Callirrhoe');
});
it('the tutor still sends en-US and its own selected voice and speed', async () => {
  const h = harness(); await h.context.readAloudText(h.context.context, 'Tutor sentence.', 'ko', 'tutor', 'Puck');
  const init = (h.fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
  expect(JSON.parse(String(init.body)).voice).toEqual({ languageCode: 'en-US', name: 'en-US-Chirp3-HD-Puck' });
  expect(JSON.parse(String(init.body)).audioConfig.speakingRate).toBe(1.1);
  expect(h.get.mock.calls.some(([key]) => key === 'readAloud.chirpVoice' || key === 'readAloud.edgeLocale')).toBe(false);
  // 2026-10-14: The production native adapter, rather than panel audio, reveals the tutor line.
  expect(h.native.beginSession).toHaveBeenCalledOnce();
  expect(h.native.play).toHaveBeenCalledWith(audio, 75, expect.any(Function));
  expect(h.panel.tutorSpeechPlaybackStarted).toHaveBeenCalledOnce();
  expect(h.panel.playGeneratedAudioBase64).not.toHaveBeenCalled();
});
it('plays through the native MP3 adapter with the panel closed, without opening it', async () => {
  const h = harness({}, false); await h.speak();
  expect(h.native.play).toHaveBeenCalledWith(audio, 50, expect.any(Function));
  expect(h.panel.playGeneratedAudioBase64).not.toHaveBeenCalled(); expect(h.edge.speak).not.toHaveBeenCalled();
});
it('uses the Translation credential only when the speech slot is empty', async () => {
  const h = harness(); h.getSecret.mockImplementation(async slot => slot === KREN_SECRET_KEYS.googleCloudTranslation ? credential : undefined);
  await h.speak(); expect(h.getSecret.mock.calls.map(([slot]) => slot)).toEqual([KREN_SECRET_KEYS.googleCloudTextToSpeech, KREN_SECRET_KEYS.googleCloudTranslation]);
  expect(new Headers((h.fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].headers).get('X-Goog-Api-Key')).toBe(credential);
});

it.each(['no key', 'unsupported locale', 'voice unavailable', 'network failure', 'playback failure'])('falls back for %s, Edge then Windows, with one session notice', async cause => {
  vi.useFakeTimers(); const h = harness({ 'readAloud.chirpVoice': 'Callirrhoe', ...(cause === 'unsupported locale' ? { 'readAloud.edgeLocale': 'zh-TW' } : {}) });
  if (cause === 'no key') h.getSecret.mockResolvedValue(undefined);
  if (cause === 'voice unavailable') h.fetcher.mockImplementation(async () => new Response('{}', { status: 400 }));
  if (cause === 'network failure') h.fetcher.mockRejectedValue(new Error('Private transport detail'));
  if (cause === 'playback failure') h.native.play.mockResolvedValue('failed');
  h.edge.speak.mockResolvedValue('failed');
  for (let i = 0; i < 2; i++) {
    const pending = h.speak(); await vi.advanceTimersByTimeAsync(1000); await pending;
  }
  expect(h.edge.speak).toHaveBeenCalledTimes(cause === 'unsupported locale' ? 4 : 2); expect(h.windows.speak).toHaveBeenCalledTimes(2);
  expect(h.edge.speak.mock.invocationCallOrder[0]).toBeLessThan(h.windows.speak.mock.invocationCallOrder[0]!);
  expect(h.windows.speak).toHaveBeenCalledWith('안녕하세요.', expect.objectContaining({ voice: 'Shared Windows', rate: 2, volume: 50 }));
  expect(h.notify).toHaveBeenCalledOnce();
  const message = h.notify.mock.calls[0]![1];
  expect(message).toMatch(/Google Cloud Text-to-Speech.*Windows voice/su);
  expect(message).toMatch(cause === 'no key' ? /needs a key.*Credentials/su : cause === 'unsupported locale' ? /does not support zh-TW/u : cause === 'voice unavailable' ? /no Korean voice named Callirrhoe/u : cause === 'playback failure' ? /audio could not play.*native player: mediaFailed/u : /failed/u);
  expect(message).not.toContain('Private transport detail');
  expect(h.fetcher).toHaveBeenCalledTimes(cause === 'no key' || cause === 'unsupported locale' ? 0 : cause === 'voice unavailable' || cause === 'playback failure' ? 2 : 4);
});
it('names Edge when no key falls back successfully and keeps the notice separate from the tutor', async () => {
  const h = harness(); h.getSecret.mockResolvedValue(undefined); await h.speak(); await h.speak();
  expect(h.windows.speak).not.toHaveBeenCalled(); expect(h.notify).toHaveBeenCalledOnce(); expect(h.notify.mock.calls[0]![1]).toMatch(/needs a key.*Edge voice/su);
  h.tutor.reportFallback('Tutor speech failed.', { provider: 'edgeOnline' }); expect(h.notify).toHaveBeenCalledTimes(2);
});
it.each(['restricted', 'declined'])('continues to Windows when fallback Edge is %s', async cause => {
  const h = harness(); h.getSecret.mockResolvedValue(undefined);
  if (cause === 'restricted') h.context.vscode.workspace.isTrusted = false;
  else h.context.ensureEdgeTtsConsent.mockResolvedValue(false);
  await h.speak(); expect(h.edge.speak).not.toHaveBeenCalled(); expect(h.windows.speak).toHaveBeenCalledOnce();
  expect(h.notify).toHaveBeenCalledOnce(); expect(h.notify.mock.calls[0]![1]).toMatch(/needs a key.*Windows voice/su);
});
it('reports all sources unavailable once when Windows also fails', async () => {
  const h = harness(); h.getSecret.mockResolvedValue(undefined); h.edge.speak.mockResolvedValue('failed'); h.windows.speak.mockResolvedValue(false);
  await h.speak(); expect(h.notify).toHaveBeenCalledOnce(); expect(h.notify.mock.calls[0]![1]).toMatch(/needs a key.*Edge Online and Local Windows speech are unavailable/su);
});
it('Stop during synthesis prevents fallback and notices', async () => {
  const h = harness(); let finish!: (value: Response) => void;
  h.fetcher.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.speak(); await flush(); h.context.readAloudSession++; h.context.readAloudChirpSpeech.stop();
  finish(new Response('{}', { status: 400 })); await pending;
  expect(h.edge.speak).not.toHaveBeenCalled(); expect(h.windows.speak).not.toHaveBeenCalled(); expect(h.notify).not.toHaveBeenCalled();
});

it.each(['failed', 'dependencyMissing', 'throw', 'restricted', 'declined'])('selected shared Edge %s uses shared Windows and one cause card per session', async cause => {
  const h = harness({ 'readAloud.provider': 'edgeOnline', 'readAloud.edgeLocale': 'auto' });
  if (cause === 'throw') h.edge.speak.mockRejectedValue(new Error('private detail'));
  else if (cause === 'restricted') h.context.vscode.workspace.isTrusted = false;
  else if (cause === 'declined') h.context.ensureEdgeTtsConsent.mockResolvedValue(false);
  else h.edge.speak.mockResolvedValue(cause);
  await h.speak('Selected Edge text.'); await h.speak('Selected Edge text.');
  expect(h.windows.speak).toHaveBeenCalledTimes(2);
  expect(h.windows.speak).toHaveBeenCalledWith('Selected Edge text.', expect.objectContaining({ voice: 'Shared Windows', rate: 2, volume: 50 }));
  expect(h.notify).toHaveBeenCalledOnce();
  expect(h.notify.mock.calls[0]![1]).toMatch(/Edge Online.*unavailable.*Windows voice/u);
  expect(h.notify.mock.calls[0]![1]).toMatch(cause === 'dependencyMissing' ? /package missing/u : cause === 'restricted' ? /Restricted Mode/u : cause === 'declined' ? /consent declined/u : /synthesis or playback failed/u);
  expect(h.context.showKrenErrorMessage).not.toHaveBeenCalled();
  expect(h.get.mock.calls.some(([key]) => key.startsWith('tutor.'))).toBe(false);
});
it('selected shared Edge Stop suppresses Windows and its failure card', async () => {
  const h = harness({ 'readAloud.provider': 'edgeOnline' }); let finish!: (result: string) => void;
  h.edge.speak.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.speak(); await flush(); h.context.readAloudSession++; finish('failed'); await pending;
  expect(h.windows.speak).not.toHaveBeenCalled(); expect(h.notify).not.toHaveBeenCalled();
});
it('selected shared Edge and failed Windows never loop back or show duplicate cards', async () => {
  const h = harness({ 'readAloud.provider': 'edgeOnline', 'readAloud.edgeLocale': 'auto' });
  h.edge.speak.mockResolvedValue('failed'); h.windows.speak.mockResolvedValue(false);
  await h.speak(); expect(h.edge.speak).toHaveBeenCalledOnce(); expect(h.windows.speak).toHaveBeenCalledOnce();
  expect(h.notify).toHaveBeenCalledOnce(); expect(h.notify.mock.calls[0]![1]).toMatch(/Edge Online.*synthesis or playback failed.*Local Windows speech are unavailable/u);
});
it('keeps sentence order and falls back with only the unread remainder', async () => {
  const h = harness({ 'readAloud.edgeLocale': 'en-US' });
  const first = 'This first sentence is long enough to be synthesized on its own.';
  const second = 'This second sentence should be spoken by the Windows fallback.';
  h.fetcher.mockResolvedValueOnce(ok()).mockImplementation(async () => new Response('{}', { status: 400 }));
  h.edge.speak.mockResolvedValue('failed');
  await h.speak(first + ' ' + second);
  expect(h.fetcher).toHaveBeenCalledTimes(2);
  expect(h.native.play).toHaveBeenCalledOnce();
  expect(h.edge.speak).toHaveBeenCalledWith(second, expect.any(Object));
  expect(h.windows.speak).toHaveBeenCalledWith(second, expect.any(Object));
});
it('Stop during the retry delay or Edge fallback prevents later synthesis and Windows playback', async () => {
  vi.useFakeTimers(); const retry = harness(); retry.fetcher.mockRejectedValue(new Error('transport failed'));
  const pendingRetry = retry.speak(); await flush(); retry.context.readAloudSession++; retry.context.readAloudChirpSpeech.stop();
  await vi.advanceTimersByTimeAsync(1000); await pendingRetry;
  expect(retry.fetcher).toHaveBeenCalledOnce(); expect(retry.edge.speak).not.toHaveBeenCalled(); expect(retry.notify).not.toHaveBeenCalled();
  const fallback = harness(); fallback.getSecret.mockResolvedValue(undefined);
  let finish!: (result: string) => void;
  fallback.edge.speak.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pendingFallback = fallback.speak(); await flush(); fallback.context.readAloudSession++; fallback.context.readAloudChirpSpeech.stop();
  finish('failed'); await pendingFallback;
  expect(fallback.windows.speak).not.toHaveBeenCalled(); expect(fallback.notify).not.toHaveBeenCalled();
});

it.each(['completed', 'failed', 'stopped', 'write failed'])('native cloud playback deletes its temporary MP3 after %s', async outcome => {
  const child = new EventEmitter() as ChildProcess; child.kill = vi.fn(() => { child.emit('exit', 1); return true; });
  const stdout = new PassThrough(); Object.defineProperty(child, 'stdout', { value: stdout });
  const spawn = vi.fn(() => child), remove = vi.fn(async () => {}), write = vi.fn(async (_file: string, _audio: Buffer) => {}), started = vi.fn();
  if (outcome === 'write failed') write.mockRejectedValue(new Error('disk failure'));
  const temporary = { directory: 'C:\\Temp\\kren-chirp-test', file: 'C:\\Temp\\kren-chirp-test\\speech.mp3' };
  const player = new WindowsEdgeReadAloudPlayer('win32', spawn, async () => temporary, remove, async () => true, write);
  const pending = player.playBase64(audio, 50, started); await flush();
  expect(write).toHaveBeenCalledWith(temporary.file, Buffer.from(audio, 'base64'));
  if (outcome !== 'write failed') {
    const [command, args, options] = spawn.mock.calls[0] as unknown as [string, string[], any];
    expect(command).toBe('powershell.exe'); expect(args).toContain('Hidden'); expect(options.windowsHide).toBe(true);
    expect(options.env.KREN_AUDIO_VOLUME).toBe('50'); expect(options.env.KREN_AUDIO_FILE).toBe(temporary.file);
    stdout.write('KREN_SPEECH_STARTED\n'); expect(started).toHaveBeenCalledOnce();
    if (outcome === 'stopped') player.stop(); else child.emit('exit', outcome === 'completed' ? 0 : 1);
  }
  expect(await pending).toBe(outcome === 'write failed' ? 'failed' : outcome);
  expect(remove).toHaveBeenCalledWith(temporary);
});
