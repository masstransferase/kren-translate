import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { load } from 'cheerio';
vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) }, env: {}, commands: {} }));
import { KREN_SECRET_KEYS, runKrenOperation, runTutorAudioTranscription, runTutorStructuredRequest, type KrenRuntime } from '../src/operations.js';
import { GROQ_MODELS, CLOUDFLARE_TEXT_MODELS, compatibleDefaultModel, strictSchema, listGroqModels, type CompatibleProvider } from '../src/providers/openAICompatible.js';
import { requestStructuredJson } from '../src/providers/structuredJsonTransport.js';
import { smartGrammarIssues } from '../src/smartGrammar.js';
import { TUTOR_PROSE_ANSWER_SCHEMA, type TutorStructuredGenerationRequest } from '../src/tutor/generation.js';
import { createTutorViewState, resolveTutorSpeechRoute } from '../src/tutor/state.js';
import { renderKrenResultViewHtml, capabilityAvailability } from '../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { validatedPanelSetting } from '../src/panelSettings.js';
import { isCommandMessage } from '../src/resultsViewCommands.js';
import { startGeminiDictation, stopGeminiDictation } from '../src/resultsViewDictation.js';
import type { KrenResultsViewProvider } from '../src/resultsView.js';
import { captureUserDictionaryDraft, HttpUserDictionaryProviderTransport } from '../src/userDictionary/capture.js';
import { USER_DICTIONARY_CAPTURE_DEFAULTS } from '../src/userDictionary/settings.js';
import { UserDictionaryService } from '../src/userDictionary/service.js';
import { UserDictionaryStorage } from '../src/userDictionary/storage.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const signal = () => new AbortController().signal;
const providers = ['groq', 'cloudflare'] as const;
const groqSecret = randomUUID();
const cloudflareSecret = randomUUID();
const account = 'account';
const tutorRequest: TutorStructuredGenerationRequest = { kind: 'exampleQuestion', instruction: 'Answer the explicit question.', input: 'How do I begin?', schema: TUTOR_PROSE_ANSWER_SCHEMA, schemaName: 'kren_hint' };
function envelope(value: unknown): object { return { choices: [{ message: { content: JSON.stringify(value) } }] }; }
function fetchResult(value: unknown, status = 200) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(value), { status }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
function runtime(provider: CompatibleProvider, extra: Record<string, unknown> = {}): KrenRuntime {
  const settings: Record<string, unknown> = { translationProvider: 'gemini', 'translation.provider': provider,
    'explanation.provider': provider, 'rewrite.provider': provider, 'userDictionary.provider': provider,
    'userDictionary.enabled': true, 'languageModel.retry.enabled': false, ...extra };
  return { getSecret: async key => key === KREN_SECRET_KEYS.groq ? groqSecret : key === KREN_SECRET_KEYS.cloudflareApiToken ? cloudflareSecret
    : key === KREN_SECRET_KEYS.cloudflareAccountId ? account : undefined,
    getSetting: <T>(key: string, fallback: T) => (settings[key] ?? fallback) as T,
    beforeGeminiRequest: async () => undefined, reserveCloudCharacters: async () => undefined } as KrenRuntime;
}
function assertRequest(fetcher: ReturnType<typeof fetchResult>, provider: CompatibleProvider, input: string, fast = false) {
  expect(fetcher).toHaveBeenCalledOnce();
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe(provider === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions'
    : 'https://api.cloudflare.com/client/v4/accounts/account/ai/v1/chat/completions');
  expect(init?.method).toBe('POST');
  expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${provider === 'groq' ? groqSecret : cloudflareSecret}`);
  const body = JSON.parse(String(init?.body));
  // 2026-10-11: V221 adds low effort to short requests without changing other body fields.
  expect(Object.keys(body).filter(key => key !== 'reasoning_effort').sort()).toEqual(['max_tokens', 'messages', 'model', 'response_format', 'stream']);
  if (body.reasoning_effort !== undefined) expect(body.reasoning_effort).toBe('low');
  // Changed 2026-10-15: V244, owner item I18, Groq Fast uses the 120b model.
  expect(body.model).toBe(fast ? provider === 'groq' ? 'openai/gpt-oss-120b' : '@cf/meta/llama-3.1-8b-instruct' : compatibleDefaultModel(provider));
  expect(body.stream).toBe(false);
  expect(body.messages[1]).toEqual({ role: 'user', content: input });
  expect(body.messages[0].content).not.toContain(groqSecret);
  expect(body.messages[0].content).not.toContain(cloudflareSecret);
  expect(body.response_format.type).toBe('json_schema');
  if (provider === 'groq') expect(body.response_format.json_schema.strict).toBe(true);
  else expect(body.response_format.json_schema.type).toBe('object');
  return body;
}

describe('V219 text routes and credential boundaries', () => {
  it.each(providers)('%s Translation uses its own host and credential', async provider => {
    const fetcher = fetchResult(envelope({ kind: 'translation', translatedText: 'Translation.', alternatives: [], note: '' }));
    const result = await runKrenOperation(runtime(provider), 'translate', { text: 'Explicit sentence.' }, signal());
    expect(result).toMatchObject({ kind: 'translation', providerId: provider, translatedText: 'Translation.' });
    assertRequest(fetcher, provider, 'Explicit sentence.');
  });
  it.each(providers)('%s tutor requests keep local validation and their credential', async provider => {
    const fetcher = fetchResult(envelope({ directAnswer: 'Begin with the subject.' }));
    expect(await runTutorStructuredRequest(runtime(provider), {
      provider, model: compatibleDefaultModel(provider), thinkingOrEffort: 'auto', geminiProfile: 'standard',
      fallbackEnabled: false, fallbackModel: '', fallbackThinkingOrEffort: 'low'
    }, tutorRequest, signal())).toEqual({ directAnswer: 'Begin with the subject.' });
    assertRequest(fetcher, provider, tutorRequest.input, true);
  });
  it.each(providers)('%s Smart Grammar sends the selected passage in JSON mode', async provider => {
    const fetcher = fetchResult(envelope({ correctedText: 'I am ready.' }));
    const outcome = await smartGrammarIssues('I is ready.', { provider, model: compatibleDefaultModel(provider), apiKey: provider === 'groq' ? groqSecret : cloudflareSecret,
      accountId: provider === 'cloudflare' ? account : undefined, thinkingOrEffort: 'auto' }, signal());
    expect(outcome.status).toBe('completed');
    assertRequest(fetcher, provider, 'I is ready.');
  });
  it.each(providers)('%s rejects a schema mismatch using fixed KREN wording', async provider => {
    for (const value of [{ directAnswer: 42, leaked: groqSecret },
      provider === 'cloudflare' ? { directAnswer: 'Begin.', explanation: null } : { directAnswer: 'Begin.', unknown: null }]) {
      fetchResult(envelope(value));
      await expect(requestStructuredJson({ provider, model: compatibleDefaultModel(provider), apiKey: provider === 'groq' ? groqSecret : cloudflareSecret,
        accountId: account, thinkingOrEffort: 'auto', schema: TUTOR_PROSE_ANSWER_SCHEMA, schemaName: 'kren_hint' }, tutorRequest, signal()))
        .rejects.toThrow(`${provider === 'groq' ? 'Groq' : 'Cloudflare'} returned invalid structured output. Try again.`);
    }
    // 2026-10-11: An unreadable response envelope must not expose parser text or credentials.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`unreadable ${cloudflareSecret}`)));
    await expect(runTutorStructuredRequest(runtime(provider), {
      provider, model: compatibleDefaultModel(provider), thinkingOrEffort: 'auto', geminiProfile: 'standard',
      fallbackEnabled: false, fallbackModel: '', fallbackThinkingOrEffort: 'low'
    }, tutorRequest, signal())).rejects.toThrow(
      `${provider === 'groq' ? 'Groq' : 'Cloudflare'} returned invalid structured output. Try again.`);
  });
  it.each(providers)('%s HTTP 429 reports the free daily or per-minute limit', async provider => {
    fetchResult({ error: { message: `REMOTE FAILURE ${groqSecret} ${cloudflareSecret}` } }, 429);
    const error = await runKrenOperation(runtime(provider), 'translate', { text: 'Explicit sentence.' }, signal()).catch(error => error as Error);
    expect((error as Error).message).toMatch(/\(429\).*free daily or per-minute limit/u);
    expect((error as Error).message).not.toMatch(/REMOTE FAILURE/u);
    expect((error as Error).message).not.toContain(groqSecret);
    expect((error as Error).message).not.toContain(cloudflareSecret);
  });
  it('Cloudflare JSON-mode failure never quotes its remote error', async () => {
    fetchResult({ error: { message: `JSON Mode couldn't be met ${cloudflareSecret}` } }, 400);
    await expect(runKrenOperation(runtime('cloudflare'), 'translate', { text: 'Explicit sentence.' }, signal()))
      .rejects.toThrow('Cloudflare request failed (400). Check the provider settings.');
  });
  it.each(providers)('%s missing credentials direct the reader to Credentials', async provider => {
    const host = runtime(provider); host.getSecret = async () => undefined;
    const fetcher = fetchResult({});
    await expect(runKrenOperation(host, 'translate', { text: 'Explicit sentence.' }, signal())).rejects.toThrow(/KREN menu, Credentials/u);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(GROQ_MODELS)('%s uses a recursively strict schema', async model => {
    const fetcher = fetchResult(envelope({ directAnswer: 'Begin.', explanation: null, examples: null }));
    const value = await requestStructuredJson({ provider: 'groq', model, apiKey: groqSecret, thinkingOrEffort: 'auto',
      schema: TUTOR_PROSE_ANSWER_SCHEMA, schemaName: 'kren_hint' }, tutorRequest, signal());
    expect(JSON.parse(value as string)).toEqual({ directAnswer: 'Begin.' });
    const format = JSON.parse(String(fetcher.mock.calls[0]![1]?.body)).response_format;
    expect(format).toMatchObject({ type: 'json_schema', json_schema: { name: 'kren_hint', strict: true } });
    expect(format.json_schema.schema.required).toEqual(['directAnswer', 'explanation', 'examples']);
    expect(format.json_schema.schema.additionalProperties).toBe(false);
  });
  it('other Groq models use json_object with the schema in the prompt and no reasoning', async () => {
    const fetcher = fetchResult(envelope({ directAnswer: 'Begin.' }));
    await requestStructuredJson({ provider: 'groq', model: 'another-model', apiKey: groqSecret, thinkingOrEffort: 'high', schema: TUTOR_PROSE_ANSWER_SCHEMA, schemaName: 'kren_hint' }, tutorRequest, signal());
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].content).toContain('directAnswer');
    expect(body).not.toHaveProperty('reasoning_effort');
  });
  it.each(['none', 'minimal', 'low', 'medium', 'high', 'auto'] as const)('Groq GPT-OSS maps effort %s', async effort => {
    const fetcher = fetchResult(envelope({ directAnswer: 'Begin.' }));
    await requestStructuredJson({ provider: 'groq', model: GROQ_MODELS[0]!, apiKey: groqSecret, thinkingOrEffort: effort, schema: TUTOR_PROSE_ANSWER_SCHEMA, schemaName: 'kren_hint' }, tutorRequest, signal());
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body)).reasoning_effort).toBe(effort === 'auto' ? undefined : effort === 'minimal' || effort === 'none' ? 'low' : effort);
  });
  it('strict projection recursively closes nested objects without changing feature schemas', () => {
    const schema = { type: 'object', properties: { list: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } } }, required: ['list'] };
    const before = JSON.stringify(schema);
    const projected = strictSchema(schema) as any;
    expect(projected.properties.list.items).toMatchObject({ additionalProperties: false, required: ['name'] });
    expect(JSON.stringify(schema)).toBe(before);
    expect(strictSchema({ type: 'object' })).toEqual({ type: 'object', required: [], additionalProperties: false });
  });
  it('Groq Refresh uses /models and its own Authorization header', async () => {
    const fetcher = fetchResult({ data: GROQ_MODELS.map(id => ({ id })) });
    // Changed 2026-10-15: V244, owner item I18, discovery retains the supported Groq model choices.
    expect(await listGroqModels(groqSecret, signal())).toEqual(GROQ_MODELS.map(id => ({ id, displayName: id })));
    expect(fetcher.mock.calls[0]![0]).toBe('https://api.groq.com/openai/v1/models');
    expect(new Headers(fetcher.mock.calls[0]![1]?.headers).get('Authorization')).toBe(`Bearer ${groqSecret}`);
    fetcher.mockRejectedValueOnce(new Error(groqSecret));
    await expect(listGroqModels(groqSecret, signal())).rejects.toThrow('Groq model discovery could not be reached.');
  });
});

describe('V219 reachable panel choices and dictation', () => {
  it('Groq credentials are visible outside collapsed sections, with Set, Remove, and Test', () => {
    const $ = load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [], settings: { ...PANEL_SETTINGS_FIXTURE, credentialPresence: { groq: true } }, activeScreen: 'credentials' }));
    for (const action of ['setGroqApiKey', 'deleteGroqApiKey', 'testGroqConnection']) {
      const control = $(`[data-action="kren.${action}"]`);
      expect(control).toHaveLength(1);
      expect(control.is('button')).toBe(true);
      expect(control.parents('details:not([open]), [hidden]')).toHaveLength(0);
      expect(control.attr('tabindex')).not.toBe('-1');
      // 2026-10-11: the Set action is disabled for a stored key, just like OpenAI.
      expect(control.attr('disabled')).toBe(action === 'setGroqApiKey' ? 'disabled' : undefined);
    }
    expect($.text()).not.toContain(groqSecret);
    expect($.text()).not.toContain(cloudflareSecret);
  });
  it.each(['translation', 'explanation', 'rewrite', 'userDictionary', 'tutor'])('%s offers both providers and writable lists', feature => {
    const $ = load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [], settings: PANEL_SETTINGS_FIXTURE, activeScreen: feature === 'tutor' ? 'tutor' : 'settings' }));
    const select = $(`select[data-setting="${feature}.provider"]`);
    expect(select.length).toBeGreaterThan(0);
    for (const provider of providers) {
      expect(select.first().find(`option[value="${provider}"]`).attr('disabled')).toBeUndefined();
      expect(validatedPanelSetting(`${feature}.provider` as any, provider)).toBe(provider);
      expect(validatedPanelSetting(`${provider}.customModels`, JSON.stringify([compatibleDefaultModel(provider)]))).toBe(JSON.stringify([compatibleDefaultModel(provider)]));
    }
  });
  it.each(providers)('%s shows its model list, and only Groq shows Refresh', provider => {
    const $ = load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [], settings: { ...PANEL_SETTINGS_FIXTURE, tutorProvider: provider, tutorHintModel: 'gemini-3.8-flash' }, activeScreen: 'tutor' }));
    const models = $('[data-model-preset="tutor.model"] option').map((_i, el) => $(el).attr('value')).get();
    expect(models).toEqual(expect.arrayContaining(provider === 'groq' ? GROQ_MODELS : CLOUDFLARE_TEXT_MODELS));
    // Changed 2026-10-15: V244, owner item I18, Groq Fast defaults to the 120b model.
    expect($('[data-model-preset="tutor.hintModel"] option[selected]').attr('value')).toBe(provider === 'groq' ? 'openai/gpt-oss-120b' : '@cf/meta/llama-3.1-8b-instruct');
    expect($('[data-command="refreshGroqModels"]').length).toBe(provider === 'groq' ? 1 : 0);
    expect(isCommandMessage({ command: 'refreshGroqModels' })).toBe(true);
  });
  it.each(providers)('%s availability checks its matching credential presence', provider => {
    const absent = capabilityAvailability({ ...PANEL_SETTINGS_FIXTURE, translationProvider: 'gemini', translationRoutingProvider: provider, credentialPresence: {} }).find(row => row.label === 'Translation');
    expect(absent?.available).toBe(false);
    const presence = provider === 'groq' ? { groq: true } : { cloudflareAccountId: true, cloudflareApiToken: true };
    expect(capabilityAvailability({ ...PANEL_SETTINGS_FIXTURE, translationProvider: 'gemini', translationRoutingProvider: provider, credentialPresence: presence }).find(row => row.label === 'Translation')?.available).toBe(true);
  });
  it('Auto order is Handy, Cloudflare, Groq, Gemini', () => {
    expect(resolveTutorSpeechRoute('auto', 'available', true, true, true).provider).toBe('handy');
    expect(resolveTutorSpeechRoute('auto', 'notFound', true, true, true).provider).toBe('cloudflare');
    expect(resolveTutorSpeechRoute('auto', 'notFound', true, false, true).provider).toBe('groq');
    expect(resolveTutorSpeechRoute('auto', 'notFound', true, false, false).provider).toBe('gemini');
    expect(resolveTutorSpeechRoute('groq', 'notFound', true, false, false).reason).toMatch(/Credentials/u);
  });
  it('Groq dictation sends one multipart request at Stop and keeps credentials out of logs and messages', async () => {
    const fetcher = fetchResult({ text: 'I am ready.' });
    const logs: string[] = []; const messages: unknown[] = [];
    const view = { tutorState: createTutorViewState(), geminiDictationStartGeneration: 0,
      recorder: { start: async () => ({ cancel: async () => undefined, finish: async (send: any) => send(new Uint8Array([82, 73, 70, 70]), { sampleRate: 16000, channels: 1, bitsPerSample: 16 }) }) },
      view: { webview: { postMessage: (message: unknown) => messages.push(message) } },
      actions: { settings: () => PANEL_SETTINGS_FIXTURE, log: (line: string) => logs.push(line), notify: vi.fn(),
        transcribeTutorAudio: (audio: Uint8Array, abort: AbortSignal, provider: CompatibleProvider) => runTutorAudioTranscription(runtime(provider), audio, abort, undefined, provider) }
    } as unknown as KrenResultsViewProvider;
    await startGeminiDictation(view, { exerciseId: 'one' }, 'groq');
    expect(fetcher).not.toHaveBeenCalled();
    await stopGeminiDictation(view, { exerciseId: 'one' });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${groqSecret}`);
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false);
    const form = init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('model')).toBe('whisper-large-v3-turbo');
    expect(form.get('file')).toBeInstanceOf(Blob);
    expect(await (form.get('file') as Blob).arrayBuffer()).toEqual(new Uint8Array([82, 73, 70, 70]).buffer);
    expect(view.tutorState.answers.one).toBe('I am ready.');
    for (const value of [JSON.stringify(messages), logs.join('\n')]) {
      expect(value).not.toContain(groqSecret); expect(value).not.toContain(cloudflareSecret);
    }
  });
  it('Groq in-place dictation patch retains the conversation answer element', () => {
    const html = renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [], settings: PANEL_SETTINGS_FIXTURE });
    const script = load(html)('script').text();
    const start = script.indexOf("if (message.command === 'tutorDictationState')");
    const end = script.indexOf("\n      if (message.command", start + 10);
    class Button {
      disabled = false; title = ''; innerHTML = ''; attributes = new Map([['data-command', 'dictateTutorConversation']]);
      classList = { toggle: vi.fn() }; getAttribute(name: string) { return this.attributes.get(name); }
      setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    }
    class Answer { value = 'Existing answer'; setAttribute = vi.fn(); }
    const button = new Button(); const answer = new Answer();
    const document = { querySelectorAll: () => [button], querySelector: (selector: string) => selector.includes('answer]') ? answer : undefined };
    const patch = `(function(message) { ${script.slice(start, end)} })`;
    // Changed 2026-10-18: V263, owner item I43, the patch sends dictated words directly without writing an answer box.
    const postMessage = vi.fn();
    const update = runInNewContext(patch, { document, HTMLButtonElement: Button, HTMLTextAreaElement: Answer, updateTutorPracticeTranscription: vi.fn(), vscode: { postMessage } });
    update({ command: 'tutorDictationState', provider: 'groq', conversation: true, state: 'recording' });
    expect(button.title).toMatch(/stop Groq conversation dictation/u);
    expect(button.attributes.get('data-tutor-dictation-provider')).toBe('groq');
    update({ command: 'tutorDictationState', provider: 'groq', conversation: true, state: 'idle', transcript: 'New sentence.' });
    expect(document.querySelector('[data-tutor-conversation-answer]')).toBe(answer);
    expect(answer.value).toBe('Existing answer');
    expect(postMessage).toHaveBeenCalledWith({ command: 'updateTutorConversationAnswer', answer: 'New sentence.', spoken: true });
    expect(postMessage).toHaveBeenCalledWith({ command: 'submitTutorConversationTurn' });
  });
});

it.each(providers)('V219 %s User Dictionary validates, saves, and reloads accurate attribution', async provider => {
  const output = { term: 'term', language: 'en', entryType: 'word', domains: [], tags: [], pronunciation: '', senses: [{ partOfSpeech: 'noun', pronunciation: '', definition: 'A test entry.', usageNote: '', synonyms: [], antonyms: [], relatedTerms: [], examples: [] }], aliases: [] };
  fetchResult(envelope(output));
  const settings = { ...USER_DICTIONARY_CAPTURE_DEFAULTS, provider };
  const transport = new HttpUserDictionaryProviderTransport({ provider, model: compatibleDefaultModel(provider), thinkingOrEffort: 'auto', maxAttempts: 1, apiKey: provider === 'groq' ? groqSecret : cloudflareSecret, accountId: account });
  const entry = await captureUserDictionaryDraft('term', settings, transport, signal());
  expect(entry.capture.provider).toBe(provider);
  const directory = await mkdtemp(path.join(tmpdir(), 'kren-v219-'));
  try {
    const service = new UserDictionaryService(new UserDictionaryStorage(directory));
    const saved = await service.save(entry);
    expect(saved.kind).toBe('saved');
    expect((await service.list())[0]?.capture.provider).toBe(provider);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('V219 manifest offers the new dictation provider', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  // 2026-10-11: The version pin broke at every release bump and was re-pinned by each run; the
  // release routine owns the version, so this test checks only the provider list.
  expect(manifest.contributes.configuration.properties['kren.tutor.speechProvider'].enum).toContain('groq');
});
