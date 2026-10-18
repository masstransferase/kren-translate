// 2026-10-15: V244 covers owner items I18 and I17 without browser or provider calls.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { load } from 'cheerio';
import { GROQ_MODELS, listGroqModels, routedModel } from '../src/providers/openAICompatible.js';
import { TUTOR_MODELS, tutorModeModel } from '../src/tutor/models.js';
import { tutorFastModel } from '../src/tutor/thinkingMode.js';
import { tutorConversationTurn, tutorConversationTurnRequest } from '../src/tutor/generation.js';
import { ProviderExhaustionState, withProviderSwitch } from '../src/languageModelSwitching.js';
import { ProviderError } from '../src/errors.js';
import { KREN_SECRET_KEYS, type KrenRuntime, type TutorLanguageModelRoute } from '../src/operations.js';
import { renderKrenResultViewHtml, type KrenPanelSettings } from '../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const retired = 'openai/gpt-oss-20b';
const replacement = 'openai/gpt-oss-120b';
const route: TutorLanguageModelRoute = { provider: 'gemini', model: 'gemini-3.8-flash',
  geminiProfile: 'standard', thinkingOrEffort: 'low', fallbackEnabled: false,
  fallbackModel: '', fallbackThinkingOrEffort: 'auto' };
const turn = { register: 'neutral' as const, recipeTargets: { supportingTargets: [] }, transcript: [],
  tutorRole: 'store clerk', learnerRole: 'customer', question: 'Can I help?',
  learnerAnswer: 'You told me ale twelve so i can find my way to that aisle.' };
afterEach(() => { vi.unstubAllGlobals(); });

describe('V244 Groq choices', () => {
  it('excludes the retired 20b model and keeps both supported choices', () => {
    expect(GROQ_MODELS).not.toContain(retired);
    expect(GROQ_MODELS).toEqual([replacement, 'qwen/qwen3.8-27b']);
  });
  it.each(['fast', 'thorough'] as const)('uses 120b for %s and migrates stored 20b', mode => {
    expect(TUTOR_MODELS.groq[mode]).toBe(replacement);
    expect(tutorModeModel('groq', mode, retired)).toBe(replacement);
    expect(tutorModeModel('groq', mode, 'qwen/qwen3.8-27b')).toBe('qwen/qwen3.8-27b');
  });
  it('migrates feature routing and the explicitly configured tutor Fast choice', () => {
    expect(routedModel('groq', retired)).toBe(replacement);
    expect(tutorFastModel('groq', retired, retired)).toBe(replacement);
  });
  it('filters retired and smaller discovered models while keeping supported choices', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data:
      [retired, replacement, 'qwen/qwen3.8-27b', 'llama-3.1-8b-instant'].map(id => ({ id }))
    }))));
    expect(await listGroqModels(randomUUID(), new AbortController().signal))
      .toEqual(GROQ_MODELS.map(id => ({ id, displayName: id })));
  });
  it.each(['translation', 'explanation', 'rewrite', 'userDictionary', 'tutor'] as const)(
    'shows the migrated %s choice without a stale option', feature => {
      const providerKey = feature === 'translation' ? 'translationRoutingProvider' : `${feature}Provider`;
      const settings: KrenPanelSettings = { ...PANEL_SETTINGS_FIXTURE, [providerKey]: 'groq',
        [`${feature}Model`]: retired,
        tutorHintModel: retired };
      const $ = load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [],
        settings, activeScreen: feature === 'tutor' ? 'tutor' : 'settings' }));
      const control = $(`[data-model-preset="${feature}.model"]`);
      expect(control.length).toBeGreaterThan(0);
      expect(control.find('option[selected]').first().attr('value')).toBe(replacement);
      expect(control.find(`option[value="${retired}"]`)).toHaveLength(0);
      if (feature === 'tutor') expect($('[data-model-preset="tutor.hintModel"] option[selected]').attr('value')).toBe(replacement);
    });
});

describe('V244 conversation instruction', () => {
  it('recasts from the character side and retains verbatim replyQuote and target instructions', () => {
    const { instruction } = tutorConversationTurnRequest(turn);
    expect(instruction).toMatch(/recast rewords the learner's meaning from the character's own side/u);
    expect(instruction).toContain("in the character's voice");
    expect(instruction).toContain("never repeats the learner's sentence as the character's own words");
    expect(instruction).toContain('Right, aisle twelve, just head straight down that way.');
    expect(instruction).toMatch(/replyQuote.*exact words within reply.*copied character for character/u);
    expect(instruction).toContain('Do not use replyQuote for target marks');
  });
  it.each([turn.learnerAnswer, '안녕하세요'])('uses specific names even for learner turn %s', learnerAnswer => {
    const { instruction } = tutorConversationTurnRequest({ ...turn, learnerAnswer });
    expect(instruction).toMatch(/plausible specific names and details.*brands, products, and places/u);
    expect(instruction).toContain('never placeholders such as "brand X", "Product A", or "[name]"');
  });
  it('preserves a verbatim recast quote and an independent reply target mark', () => {
    const reply = 'Right, aisle twelve, just head straight down that way.';
    const mark = { field: 'reply', targetId: 'primary', quote: 'head straight down', occurrence: 0 };
    const result = tutorConversationTurn({ move: 'recast', reply, replyQuote: 'aisle twelve',
      correction: 'You told me aisle twelve so I can find my way to that aisle.', targetId: 'primary',
      explanation: 'Use aisle for a passage between shelves.', rephrase: 'Which way is aisle twelve?',
      rephraseWhy: 'This asks for directions.', targetMarks: [mark] }, false, ['primary']);
    expect(result.reply).toBe(reply);
    expect(reply).toContain(result.replyQuote);
    expect(result.replyQuote).toBe('aisle twelve');
    expect(result.targetMarks).toEqual([mark]);
  });
});

function runtime(): KrenRuntime {
  const credential = randomUUID();
  return { getSetting: <T>(_key: string, fallback: T): T => fallback,
    getSecret: vi.fn(async key => key === KREN_SECRET_KEYS.groq ? credential : undefined),
    providerExhaustion: new ProviderExhaustionState(), providerSwitchNotice: vi.fn(), log: vi.fn()
  } as unknown as KrenRuntime;
}
async function switchOnce(rt: KrenRuntime, attempted = route, reason: 'overloaded' | 'quotaExhausted' = 'overloaded') {
  const run = vi.fn(async (current: TutorLanguageModelRoute) => {
    if (current.provider === attempted.provider) throw new ProviderError('Provider unavailable.', undefined, false,
      reason === 'overloaded' ? 503 : 429, reason);
    return 'done';
  });
  await expect(withProviderSwitch(rt, attempted, 'fast', new AbortController().signal, run)).resolves.toBe('done');
  expect(run.mock.calls.at(-1)![0]).toMatchObject({ provider: 'groq', model: replacement });
}

describe('V244 session switch notices', () => {
  it('shows an overload once and logs each repeated switch', async () => {
    const rt = runtime();
    await switchOnce(rt); await switchOnce(rt);
    expect(rt.providerSwitchNotice).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/Gemini.*overloaded.*Groq/u));
    expect(rt.log).toHaveBeenCalledTimes(2);
    expect(vi.mocked(rt.log!).mock.calls[1]![0]).toMatch(/provider switch.*overloaded.*Groq/u);
    expect(rt.providerExhaustion!.exhausted()).toEqual([]);
  });
  it('shares suppression across overload, quota and profiles for the same model', async () => {
    const rt = runtime();
    await switchOnce(rt); await switchOnce(rt, { ...route, geminiProfile: 'pro' }, 'quotaExhausted');
    expect(rt.providerSwitchNotice).toHaveBeenCalledOnce();
    expect(rt.log).toHaveBeenCalledTimes(2);
    expect(vi.mocked(rt.log!).mock.calls[1]![0]).toMatch(/daily or monthly free limit/u);
  });
  it('shows a quota notice once, then only logs after exhaustion is reset', async () => {
    const rt = runtime();
    await switchOnce(rt, route, 'quotaExhausted');
    rt.providerExhaustion!.clear();
    await switchOnce(rt, route, 'quotaExhausted');
    expect(rt.providerSwitchNotice).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/daily or monthly free limit/u));
    expect(rt.log).toHaveBeenCalledTimes(2);
  });
  it('allows each model and provider once, ignoring profile differences and the models prefix', () => {
    const state = new ProviderExhaustionState();
    expect(state.notifyOnce(route)).toBe(true);
    expect(state.notifyOnce({ ...route, model: `models/${route.model}`, geminiProfile: 'pro' })).toBe(false);
    expect(state.notifyOnce({ ...route, model: 'gemini-other-model' })).toBe(true);
    expect(state.notifyOnce({ ...route, provider: 'groq' })).toBe(true);
  });
  it('does not persist suppression or reset it at midnight or on credential changes', async () => {
    let now = new Date(2026, 9, 15, 23, 59);
    let saved: unknown = { day: '2026-10-15', exhausted: [], notified: ['gemini:standard:gemini-3.8-flash'] };
    const storage = { get: <T>(_key: string, fallback: T): T => (saved ?? fallback) as T,
      update: vi.fn(async (_key: string, value: unknown) => { saved = value; }) };
    const state = new ProviderExhaustionState(storage, () => now);
    expect(state.notifyOnce(route)).toBe(true);
    state.mark(route); state.clear('gemini');
    now = new Date(2026, 9, 16); state.exhausted();
    expect(state.notifyOnce(route)).toBe(false);
    await state.flush(); expect(saved).not.toHaveProperty('notified');
    expect(new ProviderExhaustionState(storage, () => now).notifyOnce(route)).toBe(true);
  });
  it('uses the shared notice queue without rendering a replacement conversation', () => {
    const source = readFileSync('src/resultsView.ts', 'utf8');
    const method = source.split('public showProviderSwitchNotice(text: string): void {')[1]!.split('\n  }')[0]!;
    expect(method).toContain("this.actions.notify('warning', text)");
    expect(method).not.toMatch(/render|postMessage|innerHTML/u);
  });
});
