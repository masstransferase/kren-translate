// 2026-10-14: V233 failures remain visible and carry only safe diagnostics.
import { afterEach, expect, it, vi } from 'vitest';
import { configureLanguageModelUsage, LanguageModelUsageRecorder } from '../src/languageModelUsage.js';
import { runKrenOperation, KREN_SECRET_KEYS, type KrenRuntime, type TutorLanguageModelRoute } from '../src/operations.js';
import { ProviderExhaustionState, withProviderSwitch } from '../src/languageModelSwitching.js';
import { PanelNoticeQueue } from '../src/panelNotices.js';
import { requestStructuredJson } from '../src/providers/structuredJsonTransport.js';
import { ProviderError } from '../src/errors.js';
import { explicitTextSubmission } from '../src/submission.js';
import { smartGrammarIssues } from '../src/smartGrammar.js';
import { captureUserDictionaryDraft, HttpUserDictionaryProviderTransport } from '../src/userDictionary/capture.js';
import { USER_DICTIONARY_CAPTURE_DEFAULTS } from '../src/userDictionary/settings.js';
import { requestTutorStructuredJson } from '../src/tutor/generation.js';

const signal = () => new AbortController().signal;
const route: TutorLanguageModelRoute = { provider: 'gemini', model: 'gemini-3.6-flash', geminiProfile: 'standard', thinkingOrEffort: 'auto', fallbackEnabled: false, fallbackModel: '', fallbackThinkingOrEffort: 'auto' };
function runtime(settings: Record<string, unknown> = {}, stored = true): KrenRuntime {
  return { getSetting: <T>(key: string, fallback: T) => (settings[key] ?? (key.endsWith('.enabled') ? false : fallback)) as T,
    getSecret: async key => stored || key === KREN_SECRET_KEYS.gemini ? ['fixture', 'credential'].join('-') : undefined,
    reserveCloudCharacters: vi.fn(), beforeGeminiRequest: vi.fn(async () => {}), beforeLanguageModelRequest: vi.fn(async () => {}),
    providerExhaustion: new ProviderExhaustionState(), providerSwitchNotice: vi.fn(), log: vi.fn() };
}
function logs() {
  const log = vi.fn();
  configureLanguageModelUsage(new LanguageModelUsageRecorder({ get: (_key, fallback) => fallback, update: async () => {} }, log));
  return log;
}
afterEach(() => { configureLanguageModelUsage(undefined); vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each([
  ['gemini', 429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'private provider prose', details: [{ reason: 'RATE_LIMIT_EXCEEDED', '@type': 'google.rpc.QuotaFailure', violations: [{ quotaId: 'RequestsPerDay' }] }] } }, 'quotaExhausted'],
  ['gemini', 503, { error: { status: 'UNAVAILABLE', message: 'private provider prose' } }, 'UNAVAILABLE'],
  ['groq', 429, { error: { code: 'rate_limit_exceeded', message: 'private provider prose' } }, 'rate_limit_exceeded'],
  ['cloudflare', 429, { errors: [{ code: 3036, message: 'private provider prose' }] }, '3036']
] as const)('logs one safe failure after usage: %s HTTP %s', async (provider, status, body, reason) => {
  const log = logs();
  await requestStructuredJson({ provider, model: 'unit-model', apiKey: ['fixture', 'credential'].join('-'), accountId: 'unit-account', thinkingOrEffort: 'auto', schema: {}, schemaName: 'kren_rewrite' },
    { instruction: 'Rewrite', input: 'private request prose' }, signal(), async () => new Response(JSON.stringify(body), { status })).catch(() => {});
  expect(log.mock.calls).toHaveLength(2);
  expect(log.mock.calls[0]![0]).toMatch(/^\[usage\] rewrite /u);
  expect(log.mock.calls[1]![0]).toContain(`[provider failure] rewrite ${provider} unit-model HTTP ${status}`);
  expect(log.mock.calls[1]![0]).toContain(reason);
  expect(log.mock.calls[1]![0]).not.toMatch(/private|prose|credential/u);
});

it('two malformed gemini-3.8-flash Rewrite attempts show their cause even if panel delivery rejects', async () => {
  const log = logs();
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] } }] })));
  vi.stubGlobal('fetch', fetcher);
  const fallback = vi.fn(async () => undefined);
  const queue = new PanelNoticeQueue(() => true, () => Promise.reject(new Error('panel unavailable')), fallback);
  let failure: unknown;
  try { await runKrenOperation(runtime({ 'rewrite.model': 'gemini-3.8-flash' }), 'rewrite', explicitTextSubmission('A short sentence.'), signal()); }
  catch (error) { failure = error; }
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(failure).toBeInstanceOf(ProviderError);
  await queue.show('error', (failure as Error).message, 'Retry Now');
  // Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
  // Changed 2026-10-22 (V292, owner I59/D20 A): popup instead of notification.
  expect(fallback).toHaveBeenCalledWith('error', expect.stringMatching(/Gemini.*unsupported rewrite result/u), { modal: true }, ['Retry Now']);
  expect(log.mock.calls.filter(([line]) => line.includes('[provider failure]'))).toHaveLength(2);
});

it.each([503, 500])('Gemini overload switches once without exhausting its pool (HTTP %s)', async status => {
  const rt = runtime(); const seen: string[] = [];
  // HTTP 500 with UNAVAILABLE is normalized by the transport to the overload reason.
  const error = new ProviderError('Gemini is overloaded.', undefined, true, status);
  if (status === 500) Object.assign(error, { reason: 'overloaded' });
  const run = async (selected: TutorLanguageModelRoute) => { seen.push(selected.provider); if (selected.provider === 'gemini') throw error; return 'answer'; };
  await expect(withProviderSwitch(rt, route, 'fast', signal(), run)).resolves.toBe('answer');
  expect(seen).toEqual(['gemini', 'groq']);
  expect(rt.providerExhaustion!.isExhausted(route)).toBe(false);
  expect(rt.providerSwitchNotice).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/Gemini.*overloaded.*Groq.*this request/u));
  seen.splice(0);
  await withProviderSwitch(rt, route, 'fast', signal(), run);
  expect(seen).toEqual(['gemini', 'groq']);
});

it.each([false, true])('switching disabled or no other credential retains today\'s overload error (%s)', async enabled => {
  const rt = runtime({ 'llm.providerSwitch': enabled }, !enabled);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { status: 'UNAVAILABLE' } }), { status: 503 })));
  await expect(runKrenOperation(rt, 'rewrite', explicitTextSubmission('A short sentence.'), signal())).rejects.toMatchObject({
    status: 503, action: 'configureGeminiModel', retryable: true, message: expect.stringMatching(/temporarily overloaded.*Try again shortly/u)
  });
  expect(fetch).toHaveBeenCalledOnce(); expect(rt.providerSwitchNotice).not.toHaveBeenCalled();
});

it.each(['translate', 'explain'] as const)('the same two-attempt %s validation failure reaches a visible fallback', async operation => {
  const log = logs(); const fallback = vi.fn(async () => undefined);
  const queue = new PanelNoticeQueue(() => false, vi.fn(), fallback);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }))));
  const rt = runtime({ translationProvider: 'gemini' }); rt.allowExternalTranslation = true;
  try { await runKrenOperation(rt, operation, explicitTextSubmission('A short sentence.'), signal()); }
  catch (error) { await queue.show('error', (error as Error).message); }
  expect(fetch).toHaveBeenCalledTimes(2);
  // Changed 2026-10-22 (V292, owner I59/D20 A): popup instead of notification.
  expect(fallback).toHaveBeenCalledWith('error', expect.stringMatching(/Gemini.*no translation/u), { modal: true }, ['OK']);
  expect(log.mock.calls.filter(([line]) => line.includes('unreadable output'))).toHaveLength(2);
});

it('Smart Grammar preserves local findings and names malformed output, with a failure log', async () => {
  const log = logs();
  const outcome = await smartGrammarIssues('He arrived.', { provider: 'gemini', model: 'gemini-3.8-flash', thinkingOrEffort: 'auto', apiKey: ['fixture', 'credential'].join('-') }, signal(),
    async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] } }] })));
  expect(outcome).toMatchObject({ status: 'failed', reason: expect.stringMatching(/unreadable output.*Gemini.*local findings/u) });
  expect(log.mock.calls.at(-1)![0]).toContain('unreadable output');
});

it('User Dictionary logs a valid JSON response that fails draft validation and preserves no partial entry', async () => {
  const log = logs();
  const transport = new HttpUserDictionaryProviderTransport({ provider: 'gemini', model: 'gemini-3.8-flash', thinkingOrEffort: 'auto', apiKey: ['fixture', 'credential'].join('-'), maxAttempts: 1,
    fetch: async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] } }] })) });
  await expect(captureUserDictionaryDraft('arrive', USER_DICTIONARY_CAPTURE_DEFAULTS, transport, signal(), { maxMalformedAttempts: 1 })).rejects.toThrow(/malformed/u);
  expect(log.mock.calls.at(-1)![0]).toBe('[provider failure] userDictionary gemini gemini-3.8-flash unreadable output');
});

it('a null tutor result is unreadable output and logs its failure before reaching feature validation', async () => {
  const log = logs();
  await expect(requestTutorStructuredJson({ provider: 'gemini', model: 'unit-model', geminiProfile: 'standard', thinkingOrEffort: 'auto', apiKey: ['fixture', 'credential'].join('-'), maxAttempts: 1 },
    { kind: 'practiceHint', input: '{}', instruction: 'Write a hint.', schema: {}, schemaName: 'hint' }, signal(),
    async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'null' }] } }] })))).rejects.toMatchObject({ reason: 'structuredOutput' });
  expect(log.mock.calls.at(-1)![0]).toBe('[provider failure] practiceHint gemini unit-model unreadable output');
});

it.each([503, 400])('Gemini finishes automatic overload retries before switching, including UNAVAILABLE (HTTP %s)', async status => {
  vi.useFakeTimers(); const log = logs();
  const rt = runtime({ 'gemini.retry.enabled': true, 'gemini.retry.maxAttempts': 4 });
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('googleapis')
    ? { error: { status: 'UNAVAILABLE', message: 'private provider prose' } }
    : { choices: [{ message: { content: JSON.stringify({ kind: 'rewrite', detectedLanguage: 'en', variants: [{ id: 'minimal', label: 'Minimal Rewrite', text: 'A short sentence.' }, { id: 'full', label: 'Full Rewrite', text: 'This is a short sentence.' }] }) } }] }), { status: url.includes('googleapis') ? status : 200 }));
  vi.stubGlobal('fetch', fetcher);
  const pending = runKrenOperation(rt, 'rewrite', explicitTextSubmission('A short sentence.'), signal());
  const assertion = expect(pending).resolves.toMatchObject({ kind: 'rewrite', providerId: 'groq' });
  await vi.runAllTimersAsync(); await assertion;
  expect(fetcher).toHaveBeenCalledTimes(5);
  expect(rt.providerSwitchNotice).toHaveBeenCalledOnce();
  expect(rt.providerExhaustion!.isExhausted(route)).toBe(false);
  expect(log.mock.calls.filter(([line]) => line.includes('[provider failure]'))).toHaveLength(4);
});
