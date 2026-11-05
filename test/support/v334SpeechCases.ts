import { vi } from 'vitest';
import { splitSpeechSentences, sentencePause, speechSsml } from '../../src/speech/sentencePause.js';
import { READ_ALOUD_CHIRP_VOICES, READ_ALOUD_CHIRP_DEFAULT, READ_ALOUD_CHIRP_LOCALES, isReadAloudChirpVoice, normalizedReadAloudChirpVoice, resolveReadAloudChirpLocale } from '../../src/readAloudChirp.js';
import { TUTOR_LIVE_VOICES, isTutorLiveVoice, normalizedTutorLiveVoice } from '../../src/tutor/state.js';
import {
  situationPictureScene, SITUATION_PICTURE_STYLE, SITUATION_PICTURE_ILLUSTRATED_STYLE, CLOUDFLARE_PICTURE_PROMPT_LIMIT,
  buildCloudflarePictureRequest, buildSituationPictureRequest, situationPictureFromResponse,
  generateCloudflareSituationPicture, generateSituationPicture, type SituationPictureReference
} from '../../src/providers/situationPicture.js';
import { transcribeGroqAudio } from '../../src/providers/openAICompatible.js';
import { transcribeCloudflareAudio } from '../../src/providers/cloudflare.js';
import { GoogleChirpSpeech, SpeechCenter, type SpeechAdapter, type SpeechProvider, type SpeechResult, type SpeechHost } from '../../src/speech/speechCenter.js';

/*
 * V334 pins, recorded on the unchanged tree before the speech, picture and dictation rules moved
 * into core 0.43.0. Every value is plain JSON so the expected file compares character for character.
 */
export type Case = { name: string; run(): unknown | Promise<unknown> };
const outcome = (run: () => unknown) => {
  try { return { value: run() ?? null }; } catch (error) { return { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }; }
};

const sentenceInputs = [
  'Hello there. How are you? Fine!',
  'Dr. Smith met Mr. Jones at St. Paul. They talked.',
  'Prof. Lee is here. Jr. and Sr. came too. Cats vs. dogs, etc. Done.',
  'It costs 3.50 dollars. Really? Yes.',
  'J. R. R. Tolkien wrote it. A. B. went home.',
  '', '   ', 'No ending punctuation', 'One.  Two.\n\nThree.',
  'He said "Stop." Then left. “Why?” she asked.',
  'a\u0000b. c\u000Bd\uD800e. f￾g￿. h&i <j> "k" \'l\'.'
];

function sentenceCases(): Case[] {
  const cases: Case[] = [];
  sentenceInputs.forEach((text, index) => {
    cases.push({ name: `sentences ${index} retained`, run: () => splitSpeechSentences(text) });
    cases.push({ name: `sentences ${index} plain`, run: () => splitSpeechSentences(text, false) });
    for (const ms of [0, 250, 1000]) {
      cases.push({ name: `ssml ${index} ${ms}`, run: () => speechSsml(text, ms) });
      cases.push({ name: `ssml ${index} ${ms} trailing`, run: () => speechSsml(text, ms, true) });
    }
  });
  cases.push({ name: 'sentence pauses', run: () => [0, 250, 500, 750, 1000, 100, -1, 1250, '500', null, undefined, NaN, {}].map(v => sentencePause(v)) });
  return cases;
}

function chirpCases(): Case[] {
  const locales = ['en', 'en-US', 'en-NZ', 'zh', 'zh-CN', 'zh-SG', 'zh-TW', 'zh-HK', 'es', 'es-MX', 'es-US', 'fr', 'fr-BE', 'pt', 'pt-PT', 'nl', 'nl-SR',
    'de', 'de-AT', 'ar', 'ar-EG', 'bn', 'hi', 'hi-IN', 'ja', 'ko', 'tr', 'sv', 'xx', 'xx-YY', '', 'yue', 'cmn-CN', 'nb', 'no', 'ur', 'sw-TZ'];
  return [
    { name: 'read aloud chirp catalog', run: () => ({ voices: READ_ALOUD_CHIRP_VOICES, defaultVoice: READ_ALOUD_CHIRP_DEFAULT, locales: READ_ALOUD_CHIRP_LOCALES }) },
    { name: 'read aloud chirp voice choice', run: () => ['Kore', 'Callirrhoe', 'kore', '', 'Nobody', 'Zubenelgenubi', undefined, 3, null].map(v => ({ is: isReadAloudChirpVoice(v), normalized: normalizedReadAloudChirpVoice(v) })) },
    { name: 'read aloud chirp locale resolution', run: () => locales.map(locale => [locale, resolveReadAloudChirpLocale(locale) ?? null]) },
    { name: 'tutor chirp voice list', run: () => ({ voices: TUTOR_LIVE_VOICES, empty: isTutorLiveVoice(''), kore: isTutorLiveVoice('Kore'), nobody: isTutorLiveVoice('Nobody'),
      normalized: ['Zephyr', 'Sulafat', '', 'Nobody', 'zephyr'].map(v => normalizedTutorLiveVoice(v)) }) }
  ];
}

const failed: SpeechResult = { status: 'failed', cause: 'synthesis or playback failed', message: 'Google Cloud Text-to-Speech failed (HTTP 403).', remainingText: 'Unread sentence.' };
const failedWholly: SpeechResult = { status: 'failed', cause: 'synthesis or playback failed', message: 'Google Cloud Text-to-Speech failed (HTTP 403).' };
const sources = ['googleChirp', 'edgeOnline', 'windowsLocal'] as const;
const features = ['tutor', 'shared'] as const;

/** Drives the real SpeechCenter with stand-in adapters and records source order, spoken text and messages. */
async function speechRun(feature: typeof features[number], provider: SpeechProvider, failing: readonly SpeechProvider[], partial: boolean, edgeVoice?: string) {
  const messages: string[] = [], logs: string[] = [], calls: unknown[] = [];
  const values: Record<string, unknown> = {
    'tutor.readAloud.provider': feature === 'tutor' ? provider : 'windowsLocal', 'tutor.readAloud.voice': 'Tutor Windows',
    'tutor.readAloud.edgeLocale': 'en-US', 'tutor.readAloud.edgeVoice': 'en-US-JennyNeural',
    'tutor.readAloud.edgeFemaleVoice': 'en-US-JennyNeural', 'tutor.readAloud.edgeMaleVoice': 'en-US-GuyNeural',
    'tutor.liveFemaleVoice': 'Kore', 'tutor.liveMaleVoice': 'Puck',
    'readAloud.provider': feature === 'shared' ? provider : 'windowsLocal', 'readAloud.voice': 'Shared Windows',
    'readAloud.chirpVoice': 'Aoede', 'readAloud.edgeLocale': 'ko-KR', 'readAloud.edgeVoice': 'ko-KR-SunHiNeural'
  };
  const notify = (message: string) => { messages.push(message); };
  const tutor = new GoogleChirpSpeech(async () => undefined, { play: async () => 'completed', stop: () => false }, notify);
  const shared = new GoogleChirpSpeech(async () => undefined, { play: async () => 'completed', stop: () => false }, notify);
  const run = (source: SpeechProvider) => async (text: string, options: Record<string, unknown>): Promise<SpeechResult> => {
    calls.push({ source, text, voice: options.voice, languageCode: options.languageCode ?? null, feature: options.feature ?? null });
    return failing.includes(source) ? (partial ? failed : failedWholly) : { status: 'completed' };
  };
  vi.spyOn((feature === 'tutor' ? tutor : shared).adapter, 'speak').mockImplementation(run('googleChirp') as never);
  const edge: SpeechAdapter = { speak: run('edgeOnline') as never, stop: () => false };
  const windows: SpeechAdapter = { speak: run('windowsLocal') as never, stop: () => false };
  const host: SpeechHost = { configuration: () => ({ get: <T>(key: string, fallback: T): T => (values[key] ?? fallback) as T }),
    trusted: () => true, consent: async () => true, active: async () => {}, status: () => ({ dispose() {} }),
    hold: () => () => {}, started() {}, liveSpeaking: () => false, conversation: () => ({}), speakerVoice: () => 'Kore',
    playback: () => undefined, notify: (_kind, message) => { messages.push(message); }, log: line => { logs.push(line); } };
  const result = await new SpeechCenter(tutor, shared, edge, windows, host).speak('Original sentence.', feature === 'shared' ? 'ko' : 'en', feature, edgeVoice);
  vi.restoreAllMocks();
  return { calls, messages, logs, result: result ?? null };
}

function fallbackCases(): Case[] {
  const cases: Case[] = [];
  for (const feature of features) for (const provider of sources) {
    for (let mask = 0; mask < 8; mask++) {
      const failing = sources.filter((_, bit) => mask & (1 << bit));
      for (const partial of [true, false]) {
        cases.push({ name: `speech ${feature} ${provider} failing ${failing.join('+') || 'none'} ${partial ? 'partial' : 'whole'}`,
          run: () => speechRun(feature, provider, failing, partial) });
      }
    }
  }
  cases.push({ name: 'speech tutor edge voice overrides windows', run: () => speechRun('tutor', 'windowsLocal', ['windowsLocal'], true, 'en-US-GuyNeural') });
  cases.push({ name: 'speech tutor edge voice overrides edge', run: () => speechRun('tutor', 'edgeOnline', ['edgeOnline'], true, 'en-US-GuyNeural') });
  return cases;
}

const png = 'data:image/png;base64,iVBORw0KGgo=';
const reference = (count: number, textLength = 20, picture = png): SituationPictureReference => ({
  turns: Array.from({ length: count }, (_, i) => ({ speaker: i % 2 ? 'tutor' as const : 'learner' as const, text: `Turn ${i + 1} ` + 'w'.repeat(textLength) })), picture });

function pictureCases(): Case[] {
  const scene = 'A busy cafe at noon. Two people are queuing at the counter.';
  const longScene = 'Scene sentence that keeps going. '.repeat(120);
  const cast = { tutorRole: 'barista', learnerRole: 'customer', tutorGender: 'female' as const, learnerGender: 'male' as const };
  const cases: Case[] = [
    { name: 'picture constants', run: () => ({ realistic: SITUATION_PICTURE_STYLE, illustrated: SITUATION_PICTURE_ILLUSTRATED_STYLE, limit: CLOUDFLARE_PICTURE_PROMPT_LIMIT }) },
    { name: 'picture scene', run: () => [situationPictureScene(scene, cast), situationPictureScene(scene, cast, true),
      situationPictureScene(scene, { tutorGender: 'male', learnerGender: 'female' }), situationPictureScene('', { tutorGender: 'male', learnerGender: 'female' }, true)] }
  ];
  for (const style of ['realistic', 'illustrated'] as const) {
    cases.push({ name: `gemini picture ${style} intro`, run: () => buildSituationPictureRequest(scene, undefined, style) });
    cases.push({ name: `gemini picture ${style} reference 3`, run: () => buildSituationPictureRequest(scene, reference(3), style) });
    cases.push({ name: `gemini picture ${style} reference 9`, run: () => buildSituationPictureRequest(scene, reference(9, 5, 'data:image/webp;base64,UklGRg=='), style) });
    cases.push({ name: `cloudflare picture ${style} intro`, run: () => buildCloudflarePictureRequest(scene, undefined, style) });
    cases.push({ name: `cloudflare picture ${style} reference 3`, run: () => buildCloudflarePictureRequest(scene, reference(3), style) });
    cases.push({ name: `cloudflare picture ${style} reference 9`, run: () => buildCloudflarePictureRequest(scene, reference(9), style) });
    cases.push({ name: `cloudflare picture ${style} long scene intro`, run: () => { const r = buildCloudflarePictureRequest(longScene, undefined, style); return { length: r.prompt.length, ...r }; } });
    cases.push({ name: `cloudflare picture ${style} long scene reference`, run: () => { const r = buildCloudflarePictureRequest(longScene, reference(6, 300), style); return { length: r.prompt.length, ...r }; } });
    cases.push({ name: `cloudflare picture ${style} long turn`, run: () => { const r = buildCloudflarePictureRequest(scene, reference(2, 5000), style); return { length: r.prompt.length, ...r }; } });
    cases.push({ name: `cloudflare picture ${style} one huge turn`, run: () => { const r = buildCloudflarePictureRequest(longScene, reference(1, 9000), style); return { length: r.prompt.length, ...r }; } });
  }
  cases.push({ name: 'cloudflare picture default style', run: () => buildCloudflarePictureRequest(scene, reference(2)) });
  cases.push({ name: 'cloudflare picture does not change the reference', run: () => { const r = reference(2, 5000); buildCloudflarePictureRequest(scene, r); return r; } });
  cases.push({ name: 'gemini picture default style', run: () => buildSituationPictureRequest(scene) });
  for (const bad of ['', 'not a picture', 'data:image/gif;base64,AAAA', 'data:image/png;base64,@@@', 'data:image/png;base64,AAAA\n'])
    cases.push({ name: `gemini picture bad reference ${JSON.stringify(bad)}`, run: () => outcome(() => buildSituationPictureRequest(scene, reference(1, 20, bad))) });
  const response = (mime: unknown, data: unknown, key: 'inlineData' | 'inline_data' = 'inlineData', mimeKey = 'mimeType') =>
    ({ candidates: [{ content: { parts: [{ [key]: { [mimeKey]: mime, data } }] } }] });
  cases.push({ name: 'picture response reading', run: () => [
    response('image/png', 'AAAA'), response('image/jpeg', 'AA=='), response('image/webp', 'A+/='), response('image/gif', 'AAAA'), response('image/png', 'A A'),
    response('image/png', 5), response('image/png', ''), response('image/png', 'AAAA', 'inline_data'), response('image/png', 'AAAA', 'inline_data', 'mime_type'),
    { candidates: [{ content: { parts: [{ text: 'x' }, { inlineData: { mimeType: 'image/png', data: 'QQ==' } }] } }] },
    { candidates: [{}, { content: {} }] }, {}, null, undefined, 'text', []
  ].map(payload => situationPictureFromResponse(payload) ?? null) });
  cases.push({ name: 'gemini picture over the wire', run: () => wire(async () => generateSituationPicture(scene, 'fake-key', new AbortController().signal, reference(2), undefined, 'illustrated'),
    () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }] })) });
  cases.push({ name: 'gemini picture over the wire without image', run: () => wire(async () => generateSituationPicture(scene, 'fake-key', new AbortController().signal), () => ({ candidates: [] })) });
  for (const model of ['@cf/black-forest-labs/flux-1-schnell', '@cf/black-forest-labs/flux-2-klein-4b', 'not a model', 7]) {
    cases.push({ name: `cloudflare picture over the wire ${String(model)}`, run: () => wire(
      async () => generateCloudflareSituationPicture(scene, 'acct', 'fake-token', new AbortController().signal, reference(2), model, 'illustrated'),
      () => ({ success: true, result: { image: 'AAAA' } })) });
  }
  return cases;
}

type Sent = { url: string; method: unknown; headers: unknown; body: unknown };
const describeBody = async (body: unknown): Promise<unknown> => {
  if (typeof body === 'string' || body === undefined) return body ?? null;
  if (body instanceof FormData) {
    const fields: unknown[] = [];
    for (const [name, value] of (body as unknown as { entries(): Iterable<[string, string | File]> }).entries()) {
      fields.push(typeof value === 'string' ? [name, value]
        : [name, { fileName: value.name, type: value.type, size: value.size, bytes: Buffer.from(await value.arrayBuffer()).toString('base64') }]);
    }
    return { formData: fields };
  }
  return String(body);
};
/** Runs a request function against a stand-in fetch and returns what was sent plus the result or error. */
async function wire(run: () => Promise<unknown>, reply: () => unknown): Promise<unknown> {
  const sent: Sent[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    sent.push({ url: String(url), method: init?.method ?? null, headers: init?.headers ?? null, body: await describeBody(init?.body) });
    return new Response(JSON.stringify(reply()), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const result = await run().then(value => ({ value: value ?? null }), error => ({ error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }));
    return { sent, result };
  } finally { globalThis.fetch = original; }
}

function dictationCases(): Case[] {
  const audio = (length: number) => Uint8Array.from({ length }, (_, i) => (i * 37 + 11) % 256);
  const everyByte = Uint8Array.from({ length: 256 }, (_, i) => i);
  const cases: Case[] = [];
  for (const [label, bytes] of [['empty', new Uint8Array(0)], ['small', audio(10)], ['every byte', everyByte], ['large', audio(200_001)]] as const) {
    cases.push({ name: `groq dictation ${label}`, run: () => wire(() => transcribeGroqAudio('fake-key', bytes, new AbortController().signal), () => ({ text: ' hello ' })) });
    cases.push({ name: `cloudflare dictation ${label}`, run: () => wire(() => transcribeCloudflareAudio('acct', 'fake-token', bytes, new AbortController().signal), () => ({ success: true, result: { text: ' hello ' } })) });
  }
  cases.push({ name: 'groq dictation empty transcript', run: () => wire(() => transcribeGroqAudio('fake-key', audio(3), new AbortController().signal), () => ({ text: '  ' })) });
  cases.push({ name: 'groq dictation missing key', run: () => wire(() => transcribeGroqAudio('', audio(3), new AbortController().signal), () => ({ text: 'x' })) });
  cases.push({ name: 'cloudflare dictation empty transcript', run: () => wire(() => transcribeCloudflareAudio('acct', 'fake-token', audio(3), new AbortController().signal), () => ({ success: true, result: { text: '' } })) });
  cases.push({ name: 'cloudflare dictation missing credentials', run: () => wire(() => transcribeCloudflareAudio('', 'fake-token', audio(3), new AbortController().signal), () => ({})) });
  return cases;
}

export const v334Cases: Case[] = [...sentenceCases(), ...chirpCases(), ...fallbackCases(), ...pictureCases(), ...dictationCases()];
