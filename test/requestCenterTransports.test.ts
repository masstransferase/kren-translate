import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestWithRetry, type TransportAttemptEvent } from '../src/requestCenter.js';
import { ProviderError } from '../src/errors.js';
import { GeminiProvider } from '../src/providers/gemini.js';
import { OpenAIProvider, CompatibleLanguageModelProvider } from '../src/providers/openai.js';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import { requestStructuredJson } from '../src/providers/structuredJsonTransport.js';
import { requestTutorStructuredJson } from '../src/tutor/generation.js';
import { HttpUserDictionaryProviderTransport } from '../src/userDictionary/capture.js';
import { runAdaptiveThinking } from '../src/tutor/thinkingMode.js';
import { configureLanguageModelUsage, LanguageModelUsageRecorder, validateLanguageModelOutput } from '../src/languageModelUsage.js';
import type { LanguageModelRoutingProvider } from '../src/languageModelRouting.js';

const providers = ['gemini', 'openai', 'anthropic', 'groq', 'cloudflare'] as const;
const families = ['structured', 'tutor', 'dictionary', 'direct'] as const;
type Family = typeof families[number];
const cases = providers.flatMap(provider => families.map(family => [family, provider] as const));
const instruction = 'Return the requested object.';
const input = 'private-input-marker';
const content = { kind: 'translation', translatedText: 'Accepted.', alternatives: [], note: '' };
const retryInfo = { error: { details: [{ '@type': 'google.rpc.RetryInfo', retryDelay: '2s' }] } };
const response = (status: number, body: unknown, retryAfter?: string) => new Response(JSON.stringify(body), {
  status, headers: retryAfter === undefined ? {} : { 'retry-after': retryAfter }
});
function envelope(provider: LanguageModelRoutingProvider, value: unknown = content): unknown {
  const text = JSON.stringify(value);
  if (provider === 'gemini') return { candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 } };
  if (provider === 'openai') return { output: [{ content: [{ type: 'output_text', text }] }], usage: { input_tokens: 7, output_tokens: 3 } };
  if (provider === 'anthropic') return { content: [{ type: 'text', text }], usage: { input_tokens: 7, output_tokens: 3 } };
  return { choices: [{ message: { content: text } }], usage: { prompt_tokens: 7, completion_tokens: 3 } };
}
function invoke(family: Family, provider: LanguageModelRoutingProvider, maxAttempts = 3,
  signal = new AbortController().signal, opening = false): Promise<unknown> {
  const settings = { provider, model: 'unit-model', apiKey: ['fixture', 'credential'].join('-'),
    accountId: 'unit-account', thinkingOrEffort: 'auto' as const, maxAttempts };
  if (family === 'structured') return requestStructuredJson({ ...settings, schema: {}, schemaName: 'kren_rewrite' },
    { instruction, input }, signal, fetch, maxAttempts);
  if (family === 'tutor') return requestTutorStructuredJson(settings,
    { kind: opening ? 'conversationOpening' : 'lesson', instruction, input, schema: {}, schemaName: 'kren_lesson' }, signal, fetch);
  if (family === 'dictionary') return new HttpUserDictionaryProviderTransport(settings).generate({ instruction, expression: input, schema: {} }, signal);
  const adapter = provider === 'gemini' ? new GeminiProvider(settings.apiKey, settings.model, 'configureGeminiModel', undefined, maxAttempts)
    : provider === 'openai' ? new OpenAIProvider(settings.apiKey, settings.model, 'auto', maxAttempts)
      : provider === 'anthropic' ? new AnthropicProvider(settings.apiKey, settings.model, 'auto', maxAttempts)
        : new CompatibleLanguageModelProvider(provider, settings.apiKey, settings.model, 'auto', maxAttempts, settings.accountId);
  return adapter.explain({ text: input, sourceLanguage: 'en', targetLanguage: 'ko', kind: 'translation', operation: 'explain' }, signal);
}
function recording() {
  const lines: string[] = [];
  const recorder = new LanguageModelUsageRecorder({ get: (_key, fallback) => fallback, update: async () => {} }, line => lines.push(line));
  configureLanguageModelUsage(recorder);
  return { lines, recorder };
}
async function settle(pending: Promise<unknown>) {
  const result = pending.then(value => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
  await vi.runAllTimersAsync();
  return result;
}
afterEach(() => { configureLanguageModelUsage(undefined); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('migrated transport request counts and events', () => {
  it.each(families)('%s Gemini 404 UNAVAILABLE stops after one of four configured attempts', async family => {
    const { lines } = recording();
    const fetcher = vi.fn(async () => response(404, { error: { status: 'UNAVAILABLE' } })); vi.stubGlobal('fetch', fetcher);
    const failure = await invoke(family, 'gemini', 4).catch(error => error);
    expect(failure).toBeInstanceOf(ProviderError);
    if (!(failure instanceof ProviderError)) throw new Error('Expected a provider failure.');
    expect(failure).toMatchObject({ status: 404, retryable: false });
    expect(failure.reason).not.toBe('overloaded');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(lines.filter(line => line.startsWith('[usage]'))).toHaveLength(1);
    expect(lines.filter(line => line.startsWith('[provider failure]'))).toHaveLength(1);
  });
  it.each(cases)('%s %s shares transient and short-window recovery and logs each attempt once', async (family, provider) => {
    vi.useFakeTimers();
    const { lines, recorder } = recording();
    const fetcher = vi.fn().mockResolvedValueOnce(response(503, {})).mockResolvedValueOnce(response(429, {}))
      .mockResolvedValueOnce(response(200, envelope(provider)));
    vi.stubGlobal('fetch', fetcher);
    const result = await settle(invoke(family, provider));
    expect(result.error).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(lines.filter(line => line.startsWith('[usage]'))).toHaveLength(3);
    expect(lines.filter(line => line.startsWith('[provider failure]'))).toHaveLength(2);
    expect(recorder.today()).toMatchObject([{ requests: 3, input: 7, output: 3 }]);
    const bodies = fetcher.mock.calls.map(([, init]) => init.body);
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.stringify(bodies)).toContain(input);
  });
  it.each(cases)('%s %s stops after its configured attempt count', async (family, provider) => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => response(503, {}));
    vi.stubGlobal('fetch', fetcher);
    expect((await settle(invoke(family, provider, 2))).error).toMatchObject({ status: 503, retryable: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(cases)('%s %s cancels before sending without usage or failure lines', async (family, provider) => {
    const { lines } = recording(), controller = new AbortController(), fetcher = vi.fn();
    controller.abort(); vi.stubGlobal('fetch', fetcher);
    await expect(invoke(family, provider, 3, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled(); expect(lines).toEqual([]);
  });
  it.each(cases)('%s %s uses RetryInfo for Gemini and shared Retry-After for other providers', async (family, provider) => {
    vi.useFakeTimers();
    const started = Date.now(), times: number[] = [];
    const fetcher = vi.fn(async () => {
      times.push(Date.now() - started);
      return times.length === 1 ? response(503, retryInfo, '9') : response(200, envelope(provider));
    });
    vi.stubGlobal('fetch', fetcher);
    expect((await settle(invoke(family, provider, 2))).error).toBeUndefined();
    expect(times).toEqual([0, provider === 'gemini' ? 2000 : 9000]);
  });
  it.each(cases)('%s %s stops a hard quota after one attempt', async (family, provider) => {
    vi.useFakeTimers();
    const body = provider === 'gemini' ? { error: { details: [{ '@type': 'google.rpc.QuotaFailure', violations: [{ quotaId: 'RequestsPerDay' }] }] } }
      : provider === 'cloudflare' ? { errors: [{ code: 3036 }] }
        : provider === 'groq' ? { error: { message: 'Requests per day exhausted.' } } : { error: { code: 'insufficient_quota' } };
    const fetcher = vi.fn(async () => response(429, body));
    vi.stubGlobal('fetch', fetcher);
    expect((await settle(invoke(family, provider))).error).toMatchObject({ reason: 'quotaExhausted', retryable: false, status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('shared transport classification, clock and privacy', () => {
  // Changed 2026-10-17: V259, R14 finding 1, quota diagnostics expose only the window category.
  it('direct Gemini quota names become categories before errors or logs', async () => {
    const { lines } = recording();
    const fetcher = vi.fn(async () => response(429, { error: { details: [{ '@type': 'google.rpc.QuotaFailure',
      violations: [{ quotaId: 'PrivateAnswerRequestsPerDay', quotaValue: '0' }] }] } })); vi.stubGlobal('fetch', fetcher);
    const failure = await invoke('direct', 'gemini', 4).catch(error => error);
    expect(failure).toBeInstanceOf(ProviderError);
    if (!(failure instanceof ProviderError)) throw new Error('Expected a provider failure.');
    expect(failure).toMatchObject({ reason: 'quotaExhausted' });
    expect(JSON.stringify({ error: failure.message, lines })).not.toContain('PrivateAnswer');
    expect(failure.message).toContain('"quotaCategory":"perDay"');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each(providers)('%s classifies credentials, network failure, unreadable output and cancellation', async provider => {
    let clock = Date.UTC(2026, 9, 16), calls = 0;
    const events: TransportAttemptEvent[] = [], observed: TransportAttemptEvent[] = [], delays: number[] = [];
    const request = { feature: 'rewrite', provider, model: 'unit-model' };
    const run = (send: () => Promise<Response>, signal = new AbortController().signal) => requestWithRetry({
      request, signal, maxAttempts: 2, send, decode: () => { throw new ProviderError('Fixed output error.', undefined, false, undefined, 'structuredOutput'); },
      failure: ({ status, retryable }) => new ProviderError('Fixed request error.', undefined, retryable, status)
    }, { now: () => clock, event: event => { events.push(event); observed.push(event); }, delay: async ms => { delays.push(ms); clock += ms; } });
    await expect(run(async () => response(401, { error: { message: 'private-exception-marker' } }))).rejects.toMatchObject({ status: 401 });
    expect(events.map(event => event.type === 'failure' ? event.cause : event.type)).toEqual(['usage', 'authenticationRejected']);
    events.length = 0;
    await expect(run(async () => { calls++; throw new Error('private-exception-marker'); })).rejects.toMatchObject({ retryable: true });
    expect(calls).toBe(2); expect(delays).toEqual([1000]);
    expect(events.map(event => event.type === 'failure' ? event.cause : event.type)).toEqual(['usage', 'noResponse', 'usage', 'noResponse']);
    events.length = 0;
    await expect(run(async () => response(200, { 'private-property-marker': input }))).rejects.toMatchObject({ reason: 'structuredOutput' });
    expect(events.map(event => event.type === 'failure' ? event.cause : event.type)).toEqual(['usage', 'unreadableOutput']);
    const controller = new AbortController(); events.length = 0;
    await expect(run(async () => { controller.abort(); throw new Error('private-exception-marker'); }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(events.map(event => event.type)).toEqual(['usage']);
    expect(JSON.stringify(observed)).not.toMatch(/private-/u);
  });
  it.each(providers)('%s honors an HTTP-date Retry-After with the injected clock', async provider => {
    const clock = Date.UTC(2026, 9, 16), delays: number[] = [];
    let calls = 0;
    const result = await requestWithRetry({ request: { feature: 'rewrite', provider, model: 'unit-model' },
      signal: new AbortController().signal, maxAttempts: 2,
      send: async () => ++calls === 1 ? response(429, {}, new Date(clock + 4000).toUTCString()) : response(200, {}),
      decode: () => 'accepted', failure: () => new ProviderError('Fixed failure.')
    }, { now: () => clock, delay: async ms => { delays.push(ms); } });
    expect(result).toBe('accepted'); expect(calls).toBe(2); expect(delays).toEqual([4000]);
  });
  it.each(providers)('%s opening stops at three even when five attempts are configured', async provider => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => response(500, {})); vi.stubGlobal('fetch', fetcher);
    expect((await settle(invoke('tutor', provider, 5, undefined, true))).error).toMatchObject({ status: 500 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it.each(['gemini', 'openai', 'anthropic'] as const)('empty %s output takes the existing Fast to Thorough recovery', async provider => {
    const { lines } = recording();
    const fetcher = vi.fn().mockResolvedValueOnce(response(200, {})).mockResolvedValueOnce(response(200, envelope(provider)));
    vi.stubGlobal('fetch', fetcher);
    const modes: string[] = [], signal = new AbortController().signal;
    await runAdaptiveThinking('explain', input, signal, mode => { modes.push(mode); return invoke('direct', provider, 3, signal); });
    expect(modes).toEqual(['fast', 'thorough']); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(lines.filter(line => line.startsWith('[usage]'))).toHaveLength(2);
    expect(lines.filter(line => line.startsWith('[provider failure]'))).toHaveLength(1);
    expect(lines.find(line => line.startsWith('[provider failure]'))).toContain('unreadable output');
  });
  it.each(providers)('%s refusal is terminal and contains no remote refusal text', async provider => {
    const body = provider === 'gemini' ? { promptFeedback: { blockReason: 'SAFETY' } }
      : provider === 'openai' ? { output: [{ content: [{ type: 'refusal', refusal: 'private-refusal-marker' }] }] }
        : provider === 'anthropic' ? { stop_reason: 'refusal' } : { choices: [{ message: { refusal: 'private-refusal-marker' } }] };
    const { lines } = recording(), fetcher = vi.fn(async () => response(200, body)); vi.stubGlobal('fetch', fetcher);
    const error = await runAdaptiveThinking('explain', input, new AbortController().signal, () => invoke('direct', provider)).catch(error => error);
    expect(error).toMatchObject({ reason: 'refused', retryable: false });
    if (!(error instanceof ProviderError)) throw error;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(lines.filter(line => line.startsWith('[provider failure]'))).toHaveLength(1);
    expect(JSON.stringify({ lines, message: error.message })).not.toMatch(/private-/u);
  });
  it('later feature validation uses the same once-only center failure event', async () => {
    const { lines } = recording();
    const events: TransportAttemptEvent[] = [];
    const value = await requestWithRetry({ request: { feature: 'rewrite', provider: 'gemini', model: 'unit-model' },
      signal: new AbortController().signal, maxAttempts: 3, send: async () => response(200, {}),
      decode: () => ({}), failure: () => new ProviderError('Fixed failure.') }, { event: event => events.push(event) });
    for (let index = 0; index < 2; index++) expect(() => validateLanguageModelOutput(value, () => { throw new Error(input); })).toThrow();
    expect(events.map(event => event.type)).toEqual(['usage', 'failure']);
    expect(lines.filter(line => line.startsWith('[provider failure]'))).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain(input);
  });
  it('an unspecified Gemini block reason does not turn usable output into a refusal', async () => {
    const fetcher = vi.fn(async () => response(200, { ...envelope('gemini') as object,
      promptFeedback: { blockReason: 'BLOCK_REASON_UNSPECIFIED' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(invoke('direct', 'gemini')).resolves.toMatchObject({ translatedText: content.translatedText });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
