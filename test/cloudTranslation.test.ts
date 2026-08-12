import { describe, expect, it } from 'vitest';
import {
  CloudTranslationUsage,
  countCloudTranslationCharacters,
  googleBillingMonth,
  type UsageStateStore
} from '../src/cloudTranslationUsage.js';
import {
  buildGoogleCloudTranslationRequestBody,
  decodeGoogleTranslationHtmlEntities
} from '../src/providers/googleCloudTranslation.js';
import type { TranslationRequest } from '../src/types.js';

class MemoryStore implements UsageStateStore {
  private readonly values = new Map<string, unknown>();

  public get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  public update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

describe('Google Cloud Translation safety boundary', () => {
  it('sends only the exact selection and language metadata', () => {
    const request: TranslationRequest = {
      text: 'Only this selected sentence.',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      kind: 'translation',
      operation: 'translate'
    };

    expect(buildGoogleCloudTranslationRequestBody(request)).toEqual({
      q: 'Only this selected sentence.',
      source: 'en',
      target: 'ko',
      format: 'text'
    });
  });

  it('omits the source code for automatic detection and supports multilingual targets', () => {
    const request: TranslationRequest = {
      text: 'Where is the station?',
      sourceLanguage: 'auto',
      targetLanguage: 'ja',
      kind: 'translation',
      operation: 'translate'
    };

    expect(buildGoogleCloudTranslationRequestBody(request)).toEqual({
      q: 'Where is the station?',
      target: 'ja',
      format: 'text'
    });
  });

  it('counts Unicode code points and whitespace', () => {
    expect(countCloudTranslationCharacters('A 한 😀')).toBe(5);
  });

  it('reserves usage and refuses a request that would cross the limit', async () => {
    const usage = new CloudTranslationUsage(
      new MemoryStore(),
      10,
      () => new Date('2026-07-13T00:00:00Z')
    );

    await expect(usage.reserve(7)).resolves.toMatchObject({ characters: 7 });
    await expect(usage.reserve(3)).resolves.toMatchObject({ characters: 10 });
    await expect(usage.reserve(1)).rejects.toThrow('was not called');
    expect(usage.get().characters).toBe(10);
  });

  it('uses Pacific Time for the monthly reset boundary', () => {
    expect(googleBillingMonth(new Date('2026-08-01T06:59:59Z'))).toBe('2026-07');
    expect(googleBillingMonth(new Date('2026-08-01T07:00:00Z'))).toBe('2026-08');
  });

  it('decodes valid entities and preserves invalid Unicode numeric entities literally', () => {
    expect(decodeGoogleTranslationHtmlEntities('a &amp; b &#65; &#x1F642;')).toBe('a & b A 🙂');
    expect(decodeGoogleTranslationHtmlEntities('x &#999999999; &#xD800; y'))
      .toBe('x &#999999999; &#xD800; y');
  });
});
