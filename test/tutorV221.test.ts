// 2026-10-12: The switch notice names daily and monthly exhaustion.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { TUTOR_THINKING_MODES, TUTOR_MODELS, runTutorThinking, modeEffort, adaptiveEffort, tutorFastModel } from '../src/tutor/thinkingMode.js';
import { ProviderExhaustionState, isProviderQuotaExhausted, withProviderSwitch, configureProviderExhaustion } from '../src/languageModelSwitching.js';
import { KREN_SECRET_KEYS, runTutorStructuredRequest, runTutorTranslation, runKrenOperation, type KrenRuntime, type TutorLanguageModelRoute } from '../src/operations.js';
import { type TutorStructuredGenerationRequest } from '../src/tutor/generation.js';
import { ProviderError } from '../src/errors.js';
import { renderKrenResultViewHtml, renderLanguageModelUsage } from '../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { validatedPanelSetting } from '../src/panelSettings.js';
import { generateSituationPicture } from '../src/providers/situationPicture.js';

const route: TutorLanguageModelRoute = { provider: 'gemini', model: TUTOR_MODELS.gemini.thorough, fastModel: TUTOR_MODELS.gemini.fast,
  thinkingOrEffort: 'high', geminiProfile: 'standard', fallbackEnabled: false, fallbackModel: '', fallbackThinkingOrEffort: 'auto' };
const signal = () => new AbortController().signal;
const hint: TutorStructuredGenerationRequest = { kind: 'practiceHint', instruction: 'Write a hint.', input: '{}', schema: {}, schemaName: 'hint' };
const validHint = { explanation: 'Use a complete sentence.', example: 'The train leaves at noon.' };
const quota = { error: { message: 'daily limit reached', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'RequestsPerDay', quotaValue: '10' }] }] } };
const minute = { error: { message: 'quota exceeded', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'RequestsPerMinute', quotaValue: '10' }] }] } };
function runtime(overrides: Record<string, unknown> = {}, credentials: string[] = ['gemini', 'groq']): KrenRuntime {
  return { getSetting: <T>(key: string, fallback: T): T => (overrides[key] ?? (key.endsWith('.enabled') ? false : fallback)) as T,
    getSecret: vi.fn(async key => credentials.some(provider => key === KREN_SECRET_KEYS[provider as keyof typeof KREN_SECRET_KEYS]) ? 'fixture-credential' : undefined),
    reserveCloudCharacters: vi.fn(), beforeGeminiRequest: vi.fn(async () => {}), beforeLanguageModelRequest: vi.fn(async () => {}),
    providerExhaustion: new ProviderExhaustionState(), providerSwitchNotice: vi.fn(), log: vi.fn() };
}
const response = (provider: 'gemini' | 'groq', value: unknown) => new Response(JSON.stringify(provider === 'gemini'
  ? { candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }
  : { choices: [{ message: { content: JSON.stringify(value) } }] }), { status: 200 });
afterEach(() => { vi.unstubAllGlobals(); configureProviderExhaustion(new ProviderExhaustionState()); });

describe('V221 thinking and escalation', () => {
  it('covers every generation kind, including diagnosis, with a safe default', () => {
    const source = readFileSync('src/tutor/generation.ts', 'utf8').split('export type TutorGenerationKind =')[1]!.split(';')[0]!;
    const kinds = [...source.matchAll(/'([^']+)'/gu)].map(match => match[1]!);
    expect(kinds.every(kind => Object.hasOwn(TUTOR_THINKING_MODES, kind))).toBe(true);
    expect(TUTOR_THINKING_MODES.passageDiagnosis).toBe('thorough');
    expect(TUTOR_THINKING_MODES.translate).toBe('fast');
    // 2026-10-11: V225 moves opening role resolution to Thorough; pin the remaining Fast kinds.
    const fast = Object.entries(TUTOR_THINKING_MODES).filter(([, mode]) => mode === 'fast').map(([kind]) => kind).sort();
    expect(fast).toEqual(['conversationDemoBatch', 'conversationDemoCast', 'conversationHint',
      'conversationTurn', 'exampleQuestion', 'practiceHint', 'practiceQuestion', 'targetSearch', 'translate']);
  });
  it('sends hints to Fast with minimal thinking', async () => {
    const generate = vi.fn(async (_request: TutorStructuredGenerationRequest, _route: TutorLanguageModelRoute, _signal: AbortSignal) => validHint);
    await runTutorThinking(hint, route, signal(), generate);
    expect(generate.mock.calls[0]).toEqual([expect.objectContaining({ thinkingMode: 'fast' }), expect.objectContaining({ model: TUTOR_MODELS.gemini.fast, thinkingOrEffort: 'minimal' }), expect.any(AbortSignal)]);
  });
  it('sends lessons to Thorough with configured thinking', async () => {
    const generate = vi.fn(async (_request: TutorStructuredGenerationRequest, _route: TutorLanguageModelRoute, _signal: AbortSignal) => ({}));
    await runTutorThinking({ ...hint, kind: 'lesson' }, route, signal(), generate);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ thinkingMode: 'thorough' }), expect.objectContaining({ model: TUTOR_MODELS.gemini.thorough, thinkingOrEffort: 'high' }), expect.any(AbortSignal));
  });
  it('resends a validator failure once as Thorough and returns the valid answer', async () => {
    const generate = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce(validHint), log = vi.fn();
    await expect(runTutorThinking(hint, route, signal(), generate, log)).resolves.toEqual(validHint);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]![1]).toMatchObject({ model: TUTOR_MODELS.gemini.thorough, thinkingOrEffort: 'high' });
    expect(log).toHaveBeenCalledExactlyOnceWith('[thinking] practiceHint fast -> thorough (validation)');
  });
  it('red probe a: stops after two validation failures without escalating twice', async () => {
    const generate = vi.fn(async (_request: TutorStructuredGenerationRequest, _route: TutorLanguageModelRoute, _signal: AbortSignal) => ({})), log = vi.fn();
    await expect(runTutorThinking(hint, route, signal(), generate, log)).rejects.toThrow('readable hint');
    expect(generate).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(1);
  });
  it.each(['long input', 'retry'] as const)('goes directly to Thorough for %s', async reason => {
    const generate = vi.fn(async (_request: TutorStructuredGenerationRequest, _route: TutorLanguageModelRoute, _signal: AbortSignal) => validHint), log = vi.fn();
    await runTutorThinking({ ...hint, ...(reason === 'retry' ? { retry: true } : { learnerInput: Array(60).fill('answer').join(' ') }) }, route, signal(), generate, log);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]![1]).toMatchObject({ model: TUTOR_MODELS.gemini.thorough });
    expect(log).toHaveBeenCalledExactlyOnceWith(`[thinking] practiceHint fast -> thorough (${reason})`);
  });
  it.each([10, 11])('uses the full transcript count %i', async transcriptTurns => {
    const generate = vi.fn(async (_request: TutorStructuredGenerationRequest, _route: TutorLanguageModelRoute, _signal: AbortSignal) => validHint);
    await runTutorThinking({ ...hint, transcriptTurns }, route, signal(), generate);
    expect(generate.mock.calls[0]![1]).toMatchObject({ model: transcriptTurns > 10 ? TUTOR_MODELS.gemini.thorough : TUTOR_MODELS.gemini.fast });
  });
  it('does not turn transport failures or cancellation into validation retries', async () => {
    const generate = vi.fn(async () => { throw new ProviderError('temporary limit', undefined, true, 429); });
    await expect(runTutorThinking(hint, route, signal(), generate)).rejects.toThrow('temporary limit');
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it.each(['gemini', 'groq', 'cloudflare', 'openai', 'anthropic'] as const)('uses adaptive thinking for %s at 40 and 41 words', provider => {
    const model = TUTOR_MODELS[provider].thorough;
    expect(adaptiveEffort(provider, model, Array(40).fill('word').join(' '), 'high')).toBe(modeEffort(provider, model, 'fast', 'high'));
    expect(adaptiveEffort(provider, model, Array(41).fill('word').join(' '), 'high')).toBe('high');
  });
  it('uses the lowest supported effort and omits it for models without a control', () => {
    expect(modeEffort('openai', TUTOR_MODELS.openai.fast, 'fast', 'high')).toBe('none');
    expect(modeEffort('openai', TUTOR_MODELS.openai.thorough, 'thorough', 'high')).toBe('high');
    expect(modeEffort('openai', 'gpt-4.1', 'fast', 'high')).toBe('auto');
    expect(modeEffort('anthropic', 'claude-haiku-4-5', 'fast', 'high')).toBe('auto');
    expect(modeEffort('anthropic', TUTOR_MODELS.anthropic.fast, 'fast', 'high')).toBe('low');
  });
  it('uses low on Gemini 3.8, which rejects minimal, and on Groq GPT-OSS', () => {
    expect(modeEffort('gemini', TUTOR_MODELS.gemini.thorough, 'fast', 'high')).toBe('low');
    expect(modeEffort('groq', TUTOR_MODELS.groq.fast, 'fast', 'high')).toBe('low');
  });
  it('keeps a reader-selected OpenAI or Anthropic main model for Fast unless a Fast model is selected', () => {
    expect(tutorFastModel('openai', TUTOR_MODELS.gemini.fast, 'gpt-5-reader-model')).toBe('gpt-5-reader-model');
    expect(tutorFastModel('anthropic', TUTOR_MODELS.gemini.fast, 'claude-reader-model')).toBe('claude-reader-model');
    expect(tutorFastModel('openai', 'gpt-5-reader-fast', 'gpt-5-reader-model')).toBe('gpt-5-reader-fast');
  });
  it('unknown future kinds are Thorough', async () => {
    const generate = vi.fn();
    await runTutorThinking({ ...hint, kind: 'futureKind' as never }, route, signal(), generate);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ thinkingMode: 'thorough' }), expect.objectContaining({ model: route.model }), expect.any(AbortSignal));
  });
  it.each(['text', 'envelope'])('a malformed Fast %s is resent once with the Thorough model and configured thinking', async malformed => {
    const rt = runtime(), fetcher = vi.fn().mockResolvedValueOnce(new Response(malformed === 'envelope' ? '{bad' : JSON.stringify({ candidates: [{ content: { parts: [{ text: '{bad' }] } }] }), { status: 200 }))
      .mockResolvedValueOnce(response('gemini', validHint));
    vi.stubGlobal('fetch', fetcher);
    await expect(runTutorStructuredRequest(rt, route, hint, signal())).resolves.toEqual(validHint);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]![0]).toContain(TUTOR_MODELS.gemini.fast);
    expect(fetcher.mock.calls[1]![0]).toContain(TUTOR_MODELS.gemini.thorough);
    expect(JSON.parse(fetcher.mock.calls[1]![1].body).generationConfig.thinkingConfig.thinkingLevel).toBe('high');
  });
  it('the drawer Translate uses the tutor Fast model, then Thorough on an explicit retry', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response('gemini', { translatedText: 'A translation.', alternatives: [], note: '' }));
    vi.stubGlobal('fetch', fetcher);
    const rt = runtime();
    await runTutorTranslation(rt, route, 'A sentence.', signal(), 'ko');
    await runTutorTranslation(rt, route, 'A sentence.', signal(), 'ko', true);
    expect(fetcher.mock.calls[0]![0]).toContain(TUTOR_MODELS.gemini.fast);
    expect(fetcher.mock.calls[1]![0]).toContain(TUTOR_MODELS.gemini.thorough);
  });
  it('ordinary Translation retains its model and escalates thinking once after failed validation', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response('gemini', { translatedText: 0 }))
      .mockResolvedValueOnce(response('gemini', { translatedText: 'A translation.', alternatives: [], note: '' }));
    vi.stubGlobal('fetch', fetcher);
    const rt = runtime({ translationProvider: 'gemini', 'translation.model': 'gemini-reader-flash', 'translation.thinkingOrEffort': 'high' });
    await runKrenOperation(rt, 'translate', { text: 'A sentence.' }, signal());
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(call => String(call[0]).includes('gemini-reader-flash'))).toBe(true);
    expect(JSON.parse(fetcher.mock.calls[1]![1].body).generationConfig.thinkingConfig.thinkingLevel).toBe('high');
  });
});

describe('V221 provider exhaustion', () => {
  it('switches a Gemini hard quota to Groq for the same request; later requests go directly there; one notice', async () => {
    const rt = runtime(), fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(quota), { status: 429 }))
      .mockResolvedValueOnce(response('groq', validHint)).mockResolvedValueOnce(response('groq', validHint));
    vi.stubGlobal('fetch', fetcher);
    await runTutorStructuredRequest(rt, route, hint, signal());
    await runTutorStructuredRequest(rt, route, hint, signal());
    expect(fetcher).toHaveBeenCalledTimes(3);
    const bodies = fetcher.mock.calls.map(call => JSON.parse(call[1].body));
    expect(bodies[1].model).toBe(TUTOR_MODELS.groq.fast);
    expect(bodies[1].reasoning_effort).toBe('low');
    expect(bodies[1].messages[1].content).toBe(hint.input);
    expect(fetcher.mock.calls[2]![0]).toContain('groq.com');
    expect(rt.providerExhaustion!.exhausted()).toEqual(['gemini']);
    // 2026-10-11: V223 names the exhausted model and pool; assert the notice's purpose.
    expect(rt.providerSwitchNotice).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(`Gemini ${TUTOR_MODELS.gemini.fast}`));
    expect(rt.providerSwitchNotice).toHaveBeenCalledWith(expect.stringMatching(/Free Tier.*daily or monthly free limit.*Groq.*local midnight/u));
    // 2026-10-12: The owner supplied exact wording for the pool-specific switch notice.
    expect(rt.providerSwitchNotice).toHaveBeenCalledWith(`Gemini ${TUTOR_MODELS.gemini.fast} (Free Tier) reached a daily or monthly free limit. KREN is using Groq for it until local midnight.`);
  });
  it('red probe b: a per-minute 429 never marks exhaustion or switches', async () => {
    const rt = runtime(), fetcher = vi.fn(async () => new Response(JSON.stringify(minute), { status: 429 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(runTutorStructuredRequest(rt, route, hint, signal())).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(rt.providerExhaustion!.exhausted()).toEqual([]);
    expect(rt.providerSwitchNotice).not.toHaveBeenCalled();
  });
  it('red probe c: skips a provider without credentials', async () => {
    const rt = runtime({}, ['gemini', 'cloudflareApiToken', 'cloudflareAccountId']);
    const run = vi.fn().mockRejectedValueOnce(new ProviderError('quota', undefined, false, 429, 'quotaExhausted')).mockResolvedValueOnce('done');
    await expect(withProviderSwitch(rt, route, 'fast', signal(), run)).resolves.toBe('done');
    expect(run.mock.calls[1]![0]).toMatchObject({ provider: 'cloudflare', model: TUTOR_MODELS.cloudflare.fast });
  });
  it('remembers quota and stops the next action before sending with switching off', async () => {
    const rt = runtime({ 'llm.providerSwitch': false }), fetcher = vi.fn(async () => new Response(JSON.stringify(quota), { status: 429 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(runTutorStructuredRequest(rt, route, hint, signal())).rejects.toMatchObject({ reason: 'quotaExhausted' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Changed 2026-10-16: V257, R13 finding 3, quota is remembered with switching off.
    expect(rt.providerExhaustion!.exhausted()).toEqual(['gemini']);
    await expect(runTutorStructuredRequest(rt, route, hint, signal())).rejects.toMatchObject({ reason: 'quotaExhausted' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('shows the original quota failure when all credentialed providers are exhausted', async () => {
    const rt = runtime(), failure = new ProviderError('quota', undefined, false, 429, 'quotaExhausted');
    const run = vi.fn(async () => { throw failure; });
    await expect(withProviderSwitch(rt, route, 'thorough', signal(), run)).rejects.toBe(failure);
    expect(run).toHaveBeenCalledTimes(2);
    expect(rt.providerExhaustion!.exhausted()).toEqual(['gemini', 'groq']);
  });
  it('persists exhaustion until local midnight and keeps notices once per session', async () => {
    let now = new Date(2026, 9, 11, 23, 59), saved: unknown;
    const storage = { get: <T>(_key: string, fallback: T): T => (saved ?? fallback) as T, update: async (_key: string, value: unknown) => { saved = value; } };
    const first = new ProviderExhaustionState(storage, () => now);
    // 2026-10-11: V223 persists the exhausted request pool, including profile and model.
    first.mark(route); expect(first.notifyOnce(route)).toBe(true); await first.flush();
    const restored = new ProviderExhaustionState(storage, () => now);
    // Changed 2026-10-15: V244, owner item I17, a new session can notify again.
    expect(restored.exhausted()).toEqual(['gemini']); expect(restored.notifyOnce(route)).toBe(true);
    now = new Date(2026, 9, 12, 0, 0);
    // Changed 2026-10-15: V244, owner item I17, midnight clears exhaustion but not session notices.
    expect(restored.exhausted()).toEqual([]); expect(restored.notifyOnce(route)).toBe(false);
  });
  it.each(['groq', 'cloudflare'])('recognizes daily/monthly quotas on %s, but not minute limits', provider => {
    expect(isProviderQuotaExhausted(provider, 429, { error: { message: 'Daily token limit reached' } })).toBe(true);
    expect(isProviderQuotaExhausted(provider, 429, { error: { message: 'Monthly allocation exceeded' } })).toBe(true);
    expect(isProviderQuotaExhausted(provider, 429, { error: { message: 'Tokens per minute exceeded' } })).toBe(false);
    expect(isProviderQuotaExhausted(provider, 429, {})).toBe(false);
  });
  it('recognizes Cloudflare allocation 3036', () => {
    expect(isProviderQuotaExhausted('cloudflare', 400, { errors: [{ code: 3036 }] })).toBe(true);
  });
  it('never routes Live credentials through exhaustion or switching', async () => {
    const rt = runtime(); rt.providerExhaustion!.mark(route);
    const credential = await rt.getSecret(KREN_SECRET_KEYS.gemini);
    await expect(runTutorStructuredRequest(rt, route, { ...hint, kind: 'liveSessionCredential' }, signal())).resolves.toEqual({ apiKey: credential });
    expect(rt.providerSwitchNotice).not.toHaveBeenCalled();
  });
  it('a situation picture quota failure stays on Gemini even with Groq credentials', async () => {
    const rt = runtime();
    configureProviderExhaustion(rt.providerExhaustion!);
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(quota), { status: 429 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(generateSituationPicture('A station.', (await rt.getSecret(KREN_SECRET_KEYS.gemini))!, signal())).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0]![0])).toContain('generativelanguage.googleapis.com');
    expect(rt.providerExhaustion!.exhausted()).toEqual([]);
    expect(rt.providerSwitchNotice).not.toHaveBeenCalled();
  });
});

describe('V221 panel controls', () => {
  it('keeps Usage open, makes order buttons keyboard reachable, and explains missing credentials', () => {
    const $ = load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [], settings: PANEL_SETTINGS_FIXTURE }));
    const usage = $('[data-settings-section="usage"]');
    expect(usage.attr('open')).toBeDefined();
    expect(usage.find('[data-setting="llm.providerSwitch"]').length).toBe(1);
    expect(usage.find('[data-provider-order]').text()).toMatch(/Gemini.*Groq.*Cloudflare/su);
    expect(usage.find('[data-provider-move]:not([disabled])').length).toBe(4);
    expect(usage.text()).toContain('Only providers with stored credentials');
    expect(validatedPanelSetting('llm.providerOrder', '["groq","gemini"]')).toBe('["groq","gemini"]');
    expect(validatedPanelSetting('llm.providerOrder', '["groq","groq"]')).toBeUndefined();
  });
  it('marks an exhausted quota pool in Requests today', () => {
    const state = new ProviderExhaustionState(); state.mark(route); configureProviderExhaustion(state);
    // 2026-10-12: V227 marks the matching model and profile rather than the whole provider.
    expect(renderLanguageModelUsage([{ provider: 'gemini', model: route.model, geminiProfile: route.geminiProfile, requests: 1, input: 0, output: 0, thinking: 0 }])).toContain('limit reached');
  });
  it('patches the switching notice without replacing the conversation composer', () => {
    // Changed 2026-10-15: V244, owner item I17, switching uses the shared popup path with OK.
    const source = readFileSync('src/resultsView.ts', 'utf8');
    const patch = source.split('public showProviderSwitchNotice(text: string): void {')[1]!.split('\n  }')[0]!;
    // Changed 2026-10-15: V244, owner item I17, the popup goes through notify, which shows KREN's popup with OK.
    expect(patch).toContain("this.actions.notify('warning', text)");
    expect(patch).not.toContain('innerHTML');
  });
});
