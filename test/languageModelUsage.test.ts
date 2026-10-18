// 2026-10-11: V220 stores reported counts locally and never response content.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureLanguageModelUsage, LanguageModelUsageRecorder, LANGUAGE_MODEL_USAGE_KEY, reportedLanguageModelUsage, usageTrackedFetch } from '../src/languageModelUsage.js';
import { requestStructuredJson } from '../src/providers/structuredJsonTransport.js';
import { requestTutorStructuredJson } from '../src/tutor/generation.js';
import { GeminiProvider } from '../src/providers/gemini.js';
import { OpenAIProvider } from '../src/providers/openai.js';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import { renderLanguageModelUsage } from '../src/resultViewHtml.js';
const credentials = ['unit', 'test', 'credential'].join('-');
afterEach(() => { configureLanguageModelUsage(undefined); vi.unstubAllGlobals(); });
function fixture(now: () => Date = () => new Date(2026, 9, 11, 12)) {
  const values = new Map<string, unknown>();
  const log = vi.fn();
  const changed = vi.fn();
  const storage = { get: <T>(key: string, fallback: T): T => (values.get(key) ?? fallback) as T,
    update: vi.fn(async (key: string, value: unknown) => { values.set(key, value); }) };
  const recorder = new LanguageModelUsageRecorder(storage, log, changed, now);
  configureLanguageModelUsage(recorder);
  return { recorder, storage, log, changed, values };
}
const usageCases = [
  ['gemini', { usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7, thoughtsTokenCount: 3 } }, { input: 11, output: 7, thinking: 3 }],
  ['openai', { usage: { prompt_tokens: 12, completion_tokens: 8 } }, { input: 12, output: 8, thinking: 0 }],
  ['openai', { usage: { input_tokens: 13, output_tokens: 9 } }, { input: 13, output: 9, thinking: 0 }],
  ['anthropic', { usage: { input_tokens: 14, output_tokens: 10 } }, { input: 14, output: 10, thinking: 0 }],
  ['groq', { usage: { prompt_tokens: 15, completion_tokens: 11 } }, { input: 15, output: 11, thinking: 0 }],
  ['cloudflare', { usage: { prompt_tokens: 16, completion_tokens: 12 } }, { input: 16, output: 12, thinking: 0 }]
] as const;
it.each(usageCases)('reads only reported token fields for %s', (provider, envelope, tokens) => {
  expect(reportedLanguageModelUsage(provider, { ...envelope, content: 'private prose' })).toEqual(tokens);
});
it('counts concurrent responses and failures once, logs metadata, and persists no content', async () => {
  const { recorder, values, log, changed } = fixture();
  const request = { feature: 'reviewBatch', provider: 'gemini', model: 'gemini-3.6-flash' };
  const tracked = usageTrackedFetch(request, vi.fn(async () => new Response(JSON.stringify({
    usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, thoughtsTokenCount: 1 }, content: 'private prose' }))) as typeof fetch);
  await Promise.all(Array.from({ length: 6 }, async () => (await tracked('https://example.invalid')).json()));
  const failed = usageTrackedFetch(request, vi.fn(async () => new Response('{"content":"private error"}', { status: 429 })) as typeof fetch);
  await (await failed('https://example.invalid')).json();
  const unreachable = usageTrackedFetch(request, vi.fn(async () => { throw new Error('private network error'); }) as typeof fetch);
  await expect(unreachable('https://example.invalid')).rejects.toThrow();
  await recorder.flush();
  // 2026-10-12: V227 stores the quota profile alongside Gemini model counts.
  expect(recorder.today()).toEqual([{ provider: 'gemini', model: request.model, geminiProfile: 'standard', requests: 8, input: 24, output: 12, thinking: 6 }]);
  // 2026-10-14: V233 adds one safe diagnostic after each failed attempt's usage.
  expect(log).toHaveBeenCalledTimes(10);
  expect(log.mock.calls[0]![0]).toBe('[usage] reviewBatch gemini gemini-3.6-flash in=4 out=2 think=1');
  expect(log.mock.calls.at(-2)![0]).toBe('[usage] reviewBatch gemini gemini-3.6-flash in=0 out=0 think=0');
  expect(log.mock.calls.at(-1)![0]).toBe('[provider failure] reviewBatch gemini gemini-3.6-flash no response');
  expect(changed).toHaveBeenCalledTimes(8);
  expect(JSON.stringify(values.get(LANGUAGE_MODEL_USAGE_KEY))).not.toMatch(/private|content|credential|feature/iu);
});
it('resets at local midnight, keeps seven calendar days, and reloads local state', async () => {
  let date = new Date(2026, 9, 11, 23, 59);
  const { recorder, storage, values } = fixture(() => date);
  for (let day = 11; day <= 18; day++) {
    date = new Date(2026, 9, day, 23, 59);
    expect(recorder.today()).toEqual([]);
    recorder.record({ feature: 'lesson', provider: 'gemini', model: 'gemini-3.5-flash' });
  }
  await recorder.flush();
  const state = values.get(LANGUAGE_MODEL_USAGE_KEY) as { days: Record<string, unknown> };
  expect(Object.keys(state.days)).toHaveLength(7);
  expect(state.days['2026-10-11']).toBeUndefined();
  const reloaded = new LanguageModelUsageRecorder(storage, () => {}, () => {}, () => date);
  expect(reloaded.today()[0]).toMatchObject({ requests: 1, model: 'gemini-3.6-flash' });
  date = new Date(2026, 9, 19, 0, 0);
  expect(reloaded.today()).toEqual([]);
});
it.each(['gemini', 'openai', 'anthropic', 'groq', 'cloudflare'] as const)('records actual structured tutor responses from %s', async provider => {
  const { recorder } = fixture();
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
    usage: { input_tokens: 5, output_tokens: 2, prompt_tokens: 5, completion_tokens: 2 },
    candidates: [{ content: { parts: [{ text: '{}' }] } }], output: [{ content: [{ type: 'output_text', text: '{}' }] }],
    content: [{ type: 'text', text: '{}' }], choices: [{ message: { content: '{}' } }] }))) as typeof fetch;
  await requestTutorStructuredJson({ provider, model: 'unit-model', apiKey: credentials, accountId: 'test-account', thinkingOrEffort: 'auto', maxAttempts: 1 },
    { kind: 'reviewBatch', schema: { type: 'object', properties: {}, required: [], additionalProperties: false }, schemaName: 'unit', instruction: 'Review', input: '{}' }, new AbortController().signal, fetcher);
  expect(recorder.today()[0]).toMatchObject({ provider, requests: 1, input: 5, output: 2 });
});
it.each(['groq', 'cloudflare'] as const)('covers the OpenAI-compatible transport path for %s', async provider => {
  const { recorder } = fixture();
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ usage: { prompt_tokens: 9, completion_tokens: 4 }, choices: [{ message: { content: '{}' } }] }))) as typeof fetch;
  await requestStructuredJson({ provider, model: 'unit-model', apiKey: credentials, accountId: 'test-account', thinkingOrEffort: 'auto', schema: { type: 'object', properties: {}, additionalProperties: false }, schemaName: 'kren_explanation' },
    { instruction: 'Explain', input: '{}' }, new AbortController().signal, fetcher);
  expect(recorder.today()[0]).toMatchObject({ provider, requests: 1, input: 9, output: 4 });
});
it.each(['gemini', 'openai', 'anthropic'] as const)('covers ordinary provider responses from %s even if content validation fails', async provider => {
  const { recorder, log } = fixture();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 3 }, usage: { input_tokens: 6, output_tokens: 3 } }))));
  const transport = provider === 'gemini' ? new GeminiProvider(credentials, 'gemini-3.5-flash') : provider === 'openai' ? new OpenAIProvider(credentials, 'unit-model') : new AnthropicProvider(credentials, 'unit-model');
  await transport.explain({ kind: 'translation', operation: 'explain', text: 'Unit sentence.', sourceLanguage: 'en', targetLanguage: 'ko' } as never, new AbortController().signal).catch(() => {});
  expect(recorder.today()[0]).toMatchObject({ provider, requests: 1, input: 6, output: 3 });
  expect(log.mock.calls.filter(([line]) => line.includes('[provider failure]'))).toEqual([
    [expect.stringMatching(new RegExp(`^\\[provider failure\\] explanation ${provider} .* unreadable output$`, 'u'))]
  ]);
  if (provider === 'gemini') expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain('gemini-3.6-flash');
});
it('renders per-provider/model request and token totals, escaping model names', () => {
  const html = renderLanguageModelUsage([{ provider: 'gemini', model: '<model>', requests: 2, input: 7, output: 4, thinking: 3 }]);
  expect(html).toContain('Requests today'); expect(html).toContain('&lt;model&gt;');
  // 2026-10-11: totals wrap as a list in a narrow sidebar, keeping each labeled count.
  for (const [label, n] of [['Requests', 2], ['input tokens', 7], ['output tokens', 4], ['thinking tokens', 3]]) expect(html).toContain(`${label}: ${n}`);
  expect(html).toMatch(/limits.*provider.*console/iu);
});
