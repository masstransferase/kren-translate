import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KREN_SECRET_KEYS,
  runKrenOperation,
  type KrenRuntime
} from '../src/operations.js';
import { geminiRefreshTarget } from '../src/geminiProfileRefresh.js';
import { readFileSync } from 'node:fs';

afterEach(() => vi.restoreAllMocks());

/*
 * The behaviour behind the owner's report on 2026-08-28: "when I change the model for
 * default, it changes the model of alternate same as the model I changed; also, vice
 * versa." The panel tests show that two controls write two settings. These show that the
 * request actually sent carries the model belonging to the profile in force, which is the
 * half a panel test cannot see.
 */

const DEFAULT_SLOT_MODEL = 'gemini-default-slot-model';
const ALTERNATE_SLOT_MODEL = 'gemini-alternate-slot-model';

function geminiResponse(text: string): Response {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function runtimeFor(settings: Record<string, unknown>): KrenRuntime {
  return {
    getSecret: async (key) => (
      key === KREN_SECRET_KEYS.gemini ? 'default-key'
        : key === KREN_SECRET_KEYS.geminiPro ? 'alternate-key'
          : undefined
    ),
    getSetting: <T>(key: string, fallback: T): T => (
      key in settings ? settings[key] as T : fallback
    ),
    reserveCloudCharacters: async () => undefined,
    beforeGeminiRequest: async () => undefined
  } as KrenRuntime;
}

async function modelUsedByExplain(profile: 'standard' | 'pro'): Promise<string> {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    geminiResponse(JSON.stringify({
      kind: 'translation',
      translatedText: 'equivalent',
      note: 'note'
    }))
  );
  const runtime = runtimeFor({
    'explanation.provider': 'gemini',
    'explanation.geminiProfile': profile,
    'explanation.model': DEFAULT_SLOT_MODEL,
    'explanation.alternateModel': ALTERNATE_SLOT_MODEL,
    'explanation.outputLanguage': 'ko',
    'gemini.retry.enabled': false,
    'gemini.retry.maxAttempts': 1
  });
  await runKrenOperation(
    runtime,
    'explain',
    { text: 'a sentence to explain' },
    new AbortController().signal
  );
  const url = String(fetchMock.mock.calls[0]?.[0]);
  const match = /\/models\/([^:]+):generateContent/u.exec(url);
  expect(match, `no Gemini generateContent call was made: ${url}`).not.toBeNull();
  return decodeURIComponent(match?.[1] ?? '');
}

describe('a feature sends the model belonging to the profile in force', () => {
  it('sends the Default slot model while the Default Gemini profile is chosen', async () => {
    expect(await modelUsedByExplain('standard')).toBe(DEFAULT_SLOT_MODEL);
  });

  /*
   * The regression this file exists for. Reading `<feature>.model` under both profiles
   * passes every panel test and every structural check, and sends the wrong model.
   */
  it('sends the Alternate slot model while the Alternate Gemini profile is chosen', async () => {
    expect(await modelUsedByExplain('pro')).toBe(ALTERNATE_SLOT_MODEL);
  });

  it('uses each profile\'s own credential, so the two are independent end to end', async () => {
    const keyUsed = async (profile: 'standard' | 'pro'): Promise<string> => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        geminiResponse(JSON.stringify({
          kind: 'translation', translatedText: 'x', note: 'y'
        }))
      );
      await runKrenOperation(
        runtimeFor({
          'explanation.provider': 'gemini',
          'explanation.geminiProfile': profile,
          'explanation.model': DEFAULT_SLOT_MODEL,
          'explanation.alternateModel': ALTERNATE_SLOT_MODEL,
          'explanation.outputLanguage': 'ko'
        }),
        'explain',
        { text: 'a sentence to explain' },
        new AbortController().signal
      );
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      const headers = init?.headers as Record<string, string> | undefined;
      const key = headers?.['x-goog-api-key'] ?? '';
      vi.restoreAllMocks();
      return key;
    };
    expect(await keyUsed('standard')).toBe('default-key');
    expect(await keyUsed('pro')).toBe('alternate-key');
  });
});

/*
 * The other half of the same report: "the list of model is not refreshed". One refresh
 * command read the alternate key whichever profile was on screen, so pressing Refresh on
 * the Default profile asked for a key the reader did not have and returned the built-in
 * list unchanged.
 */
describe('a Model Refresh reads the credential of the profile it belongs to', () => {
  it('reads the default Gemini key for the Default profile', () => {
    const target = geminiRefreshTarget('default');
    expect(target.secretKey).toBe(KREN_SECRET_KEYS.gemini);
    expect(target.setKeyCommand).toBe('kren.setGeminiApiKey');
    expect(target.keyHint).toBe('setGeminiKey');
    // 2026-10-10: V216 renames the reader-facing label; the stored refresh profile stays default.
    expect(target.label).toBe('Free Tier');
  });

  it('reads the alternate Gemini key for the Alternate profile', () => {
    const target = geminiRefreshTarget('alternate');
    expect(target.secretKey).toBe(KREN_SECRET_KEYS.geminiPro);
    expect(target.setKeyCommand).toBe('kren.setGeminiProApiKey');
    expect(target.keyHint).toBe('setGeminiProKey');
    // 2026-10-10: V216 renames the reader-facing label; the stored refresh profile stays alternate.
    expect(target.label).toBe('Paid');
  });

  it('never returns the same credential for both profiles', () => {
    expect(geminiRefreshTarget('default').secretKey)
      .not.toBe(geminiRefreshTarget('alternate').secretKey);
    expect(geminiRefreshTarget('default').setKeyCommand)
      .not.toBe(geminiRefreshTarget('alternate').setKeyCommand);
  });

  it('names the profile it queried, so the notification cannot contradict the button', () => {
    const source = readFileSync('src/extension.ts', 'utf8');
    expect(source).toContain('for the ${label} profile');
    expect(source).toContain('geminiRefreshTarget(profile)');
    // The literal that made every refresh report the alternate profile.
    expect(source).not.toContain('for the alternate profile.`');
  });
});
