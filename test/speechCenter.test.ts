import { expect, it, vi } from 'vitest';
import { GoogleChirpSpeech, SpeechCenter, type SpeechAdapter, type SpeechProvider, type SpeechResult, type SpeechHost } from '../src/speech/speechCenter.js';

const completed: SpeechResult = { status: 'completed' };
const failed: SpeechResult = { status: 'failed', cause: 'synthesis or playback failed', message: 'Google Cloud Text-to-Speech failed (HTTP 403).', remainingText: 'Unread sentence.' };
const features = ['tutor', 'shared'] as const;
function fixture(feature: typeof features[number], provider: SpeechProvider = 'googleChirp') {
  const notify = vi.fn(), log = vi.fn(), started = vi.fn(), release = vi.fn();
  let conversation: unknown = {};
  const voice = { voice: 'Tutor Windows', chirp: 'Kore', edge: 'en-US-JennyNeural', rate: 3, edgeRate: -15, volume: 65 };
  const sharedVoice = { voice: 'Shared Windows', chirp: 'Aoede', edge: 'ko-KR-SunHiNeural', rate: 2, edgeRate: 25, volume: 35 };
  const values: Record<string, unknown> = {
    'tutor.readAloud.provider': feature === 'tutor' ? provider : 'windowsLocal',
    'tutor.readAloud.voice': voice.voice, 'tutor.readAloud.rate': voice.rate, 'tutor.readAloud.volume': voice.volume,
    'tutor.readAloud.edgeLocale': 'en-US', 'tutor.readAloud.edgeVoice': voice.edge,
    'tutor.readAloud.edgeRatePercent': voice.edgeRate, 'tutor.readAloud.edgeFemaleVoice': voice.edge,
    'tutor.readAloud.edgeMaleVoice': 'en-US-GuyNeural', 'tutor.liveFemaleVoice': voice.chirp, 'tutor.liveMaleVoice': 'Puck',
    'readAloud.provider': feature === 'shared' ? provider : 'windowsLocal',
    'readAloud.voice': sharedVoice.voice, 'readAloud.rate': sharedVoice.rate, 'readAloud.volume': sharedVoice.volume,
    'readAloud.chirpVoice': sharedVoice.chirp, 'readAloud.edgeLocale': 'ko-KR', 'readAloud.edgeVoice': sharedVoice.edge,
    'readAloud.edgeRatePercent': sharedVoice.edgeRate, 'readAloud.edgePythonCommand': 'my-python'
  };
  const get = vi.fn((key: string, fallback: unknown) => values[key] ?? fallback);
  const calls: SpeechProvider[] = [];
  const tutor = new GoogleChirpSpeech(async () => undefined, { play: async () => 'completed', stop: () => false }, notify);
  const shared = new GoogleChirpSpeech(async () => undefined, { play: async () => 'completed', stop: () => false }, notify);
  const chirp = vi.spyOn((feature === 'tutor' ? tutor : shared).adapter, 'speak').mockImplementation(async (_text, _voice, _rate, _volume, onStarted) => {
    calls.push('googleChirp'); onStarted?.(); return completed;
  });
  const player = (provider: SpeechProvider) => ({ stop: vi.fn(() => false), speak: vi.fn<SpeechAdapter['speak']>(async (_text, _voice, _rate, _volume, onStarted) => {
    calls.push(provider); onStarted?.(); return completed;
  }) });
  const edge = player('edgeOnline'), windows = player('windowsLocal');
  const host: SpeechHost = { configuration: () => ({ get: get as never }), trusted: () => true, consent: async () => true,
    active: vi.fn(async () => {}), status: vi.fn(() => ({ dispose: vi.fn() })), hold: vi.fn(() => release), started,
    liveSpeaking: () => false, conversation: () => conversation, speakerVoice: () => 'Kore', playback: () => undefined, notify, log };
  const center = new SpeechCenter(tutor, shared, edge, windows, host);
  const fail = (provider: SpeechProvider) => {
    const mock = provider === 'googleChirp' ? chirp : provider === 'edgeOnline' ? edge.speak : windows.speak;
    mock.mockImplementation(async () => { calls.push(provider); return failed; });
  };
  return { center, tutor, shared, chirp, edge, windows, host, calls, notify, log, started, release, get,
    voice: feature === 'tutor' ? voice : sharedVoice, fail,
    newConversation: () => { conversation = {}; },
    speak: () => center.speak('Original sentence.', feature === 'shared' ? 'ko' : 'en', feature) };
}

const table: Array<{ provider: SpeechProvider; failures: SpeechProvider[]; expected: SpeechProvider[] }> = [
  { provider: 'googleChirp', failures: [], expected: ['googleChirp'] },
  { provider: 'googleChirp', failures: ['googleChirp'], expected: ['googleChirp', 'edgeOnline'] },
  { provider: 'googleChirp', failures: ['googleChirp', 'edgeOnline'], expected: ['googleChirp', 'edgeOnline', 'windowsLocal'] },
  { provider: 'googleChirp', failures: ['googleChirp', 'edgeOnline', 'windowsLocal'], expected: ['googleChirp', 'edgeOnline', 'windowsLocal'] },
  { provider: 'edgeOnline', failures: [], expected: ['edgeOnline'] },
  { provider: 'edgeOnline', failures: ['edgeOnline'], expected: ['edgeOnline', 'windowsLocal'] },
  { provider: 'edgeOnline', failures: ['edgeOnline', 'windowsLocal'], expected: ['edgeOnline', 'windowsLocal'] },
  { provider: 'windowsLocal', failures: [], expected: ['windowsLocal'] }
];
it.each(features.flatMap(feature => table.map(row => ({ feature, ...row }))))(
  '$feature uses the shared fallback table from $provider with failures $failures', async ({ feature, provider, failures, expected }) => {
    const f = fixture(feature, provider);
    failures.forEach(f.fail);
    await f.speak();
    expect(f.calls).toEqual(expected);
    expect(f.notify).toHaveBeenCalledTimes(failures.length ? 1 : 0);
    if (failures.includes('googleChirp')) {
      for (const mock of [f.edge.speak, f.windows.speak]) {
        if (mock.mock.calls.length) expect(mock.mock.calls[0]![0]).toBe('Unread sentence.');
      }
    }
    if (failures.includes('edgeOnline')) expect(f.notify.mock.calls[0]![0]).toContain('Edge Online');
  }
);

it.each(features.flatMap(feature => (['googleChirp', 'edgeOnline', 'windowsLocal'] as const).map(stage => ({ feature, stage }))))(
  '$feature Stop at $stage suppresses every later fallback and notice', async ({ feature, stage }) => {
    const f = fixture(feature);
    if (stage !== 'googleChirp') f.fail('googleChirp');
    if (stage === 'windowsLocal') f.fail('edgeOnline');
    let finish!: (result: SpeechResult) => void;
    const mock = stage === 'googleChirp' ? f.chirp : stage === 'edgeOnline' ? f.edge.speak : f.windows.speak;
    mock.mockImplementation(async () => { f.calls.push(stage); return new Promise(resolve => { finish = resolve; }); });
    const pending = f.speak();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    f.center.stop(); finish(failed); await pending;
    expect(f.calls.at(-1)).toBe(stage);
    expect(f.calls).toHaveLength(stage === 'googleChirp' ? 1 : stage === 'edgeOnline' ? 2 : 3);
    expect(f.notify).not.toHaveBeenCalled(); expect(f.release).toHaveBeenCalledOnce();
  }
);

it.each(features)('%s shows one cause notice across utterances, with independent feature identity', async feature => {
  const f = fixture(feature); f.fail('googleChirp'); f.fail('edgeOnline');
  await f.speak(); await f.speak();
  expect(f.notify).toHaveBeenCalledOnce();
  expect(f.notify.mock.calls[0]![0]).toMatch(/HTTP 403.*Edge Online.*unavailable.*Windows voice/u);
  if (feature === 'tutor') {
    f.newConversation(); await f.speak(); expect(f.notify).toHaveBeenCalledTimes(2);
    f.shared.reportFallback('Other feature failed.', { provider: 'edgeOnline' });
  } else f.tutor.reportFallback('Other feature failed.', { provider: 'edgeOnline' });
  expect(f.notify).toHaveBeenCalledTimes(feature === 'tutor' ? 3 : 2);
});

it.each(features.flatMap(feature => (['googleChirp', 'edgeOnline', 'windowsLocal'] as const).map(provider => ({ feature, provider }))))(
  '$feature uses its own $provider voice, speed and volume', async ({ feature, provider }) => {
    const f = fixture(feature, provider); await f.speak();
    const mock = provider === 'googleChirp' ? f.chirp : provider === 'edgeOnline' ? f.edge.speak : f.windows.speak;
    expect(mock).toHaveBeenCalledWith('Original sentence.', expect.objectContaining({ voice: provider === 'googleChirp' ? f.voice.chirp
      : provider === 'edgeOnline' ? f.voice.edge : f.voice.voice }), provider === 'windowsLocal' ? f.voice.rate : f.voice.edgeRate,
    f.voice.volume, expect.any(Function));
    const forbidden = feature === 'tutor' ? ['readAloud.chirpVoice', 'readAloud.edgeLocale', 'readAloud.voice', 'readAloud.volume'] : ['tutor.'];
    expect(f.get.mock.calls.some(([key]) => forbidden.some(prefix => key.startsWith(prefix)))).toBe(false);
    expect(f.started).toHaveBeenCalledTimes(feature === 'tutor' ? 1 : 0);
  }
);

it.each(features)('%s Stop during Edge consent suppresses every player and notice', async feature => {
  const f = fixture(feature, 'edgeOnline'); let consent!: (value: boolean) => void;
  f.host.consent = () => new Promise(resolve => { consent = resolve; });
  const pending = f.speak(); await vi.waitFor(() => expect(consent).toBeTypeOf('function'));
  f.center.stop(); consent(false); await pending;
  expect(f.calls).toEqual([]); expect(f.notify).not.toHaveBeenCalled();
});

it('the selected tutor Windows failure tries Edge once, while selected shared Windows stays terminal', async () => {
  const tutor = fixture('tutor', 'windowsLocal'); tutor.fail('windowsLocal'); tutor.fail('edgeOnline'); await tutor.speak();
  expect(tutor.calls).toEqual(['windowsLocal', 'edgeOnline']); expect(tutor.notify).toHaveBeenCalledOnce();
  const shared = fixture('shared', 'windowsLocal'); shared.fail('windowsLocal'); await shared.speak();
  expect(shared.calls).toEqual(['windowsLocal']); expect(shared.notify).toHaveBeenCalledOnce();
});

it('Credentials Test replaces a pending compatibility fallback without a stale notice', async () => {
  const f = fixture('tutor'); f.fail('googleChirp');
  const options = { voice: 'Kore', ratePercent: 0, volume: 50 };
  let finish!: (result: { provider: 'edgeOnline' }) => void;
  const pending = f.tutor.speak('Original sentence.', options, () => new Promise(resolve => { finish = resolve; }));
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  f.chirp.mockResolvedValue(completed);
  expect(await f.tutor.test(options)).toBe('Google Cloud Text-to-Speech works.');
  finish({ provider: 'edgeOnline' }); await pending;
  expect(f.notify).not.toHaveBeenCalled();
});
