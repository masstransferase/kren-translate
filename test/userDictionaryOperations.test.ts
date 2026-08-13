import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KREN_SECRET_KEYS,
  runUserDictionaryCapture,
  type KrenRuntime
} from '../src/operations.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function runtime(settings: Record<string, unknown> = {}): KrenRuntime {
  return {
    getSecret: async (key) => key === KREN_SECRET_KEYS.gemini ? 'configured' : undefined,
    getSetting: <T>(key: string, fallback: T): T =>
      (settings[key] ?? fallback) as T,
    reserveCloudCharacters: async () => undefined,
    beforeGeminiRequest: async () => undefined
  };
}

describe('User Dictionary operation gate', () => {
  it('makes provider requests impossible while User Dictionary is disabled', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(runUserDictionaryCapture(
      runtime({ 'userDictionary.enabled': false }),
      'ledger',
      new AbortController().signal
    )).rejects.toThrow('Enable User Dictionary');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an oversized expression before reading a credential or using the network', async () => {
    const getSecret = vi.fn(async () => 'configured');
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const operationRuntime = {
      ...runtime({
        'userDictionary.enabled': true,
        'translation.maxCharacters': 4
      }),
      getSecret
    };

    await expect(runUserDictionaryCapture(
      operationRuntime,
      'ledger',
      new AbortController().signal
    )).rejects.toThrow('configured maximum is 4');

    expect(getSecret).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('names the selected missing credential without making a request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const operationRuntime: KrenRuntime = {
      ...runtime({
        'userDictionary.enabled': true,
        'userDictionary.provider': 'openai'
      }),
      getSecret: async () => undefined
    };

    await expect(runUserDictionaryCapture(
      operationRuntime,
      'ledger',
      new AbortController().signal
    )).rejects.toMatchObject({ action: 'setOpenAIKey' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
