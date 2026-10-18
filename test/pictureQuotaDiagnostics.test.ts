import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateSituationPicture } from '../src/providers/situationPicture.js';

/*
 * 2026-10-10: the owner's default Gemini key returned 429 for every situation picture, and the
 * log said only "Gemini quota exhausted." The picture error now carries Google's validated quota
 * identifier, limit and retry delay, never Google's free-text message.
 */
afterEach(() => vi.unstubAllGlobals());

describe('situation picture quota diagnostics', () => {
  // Changed 2026-10-17: V259, R14 finding 1, quota diagnostics expose only the window category.
  it('attaches quota category, limit and retryDelay from a 429 and drops the provider message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message: 'Quota exceeded for this key sk-proj-****abcd. See https://ai.google.dev/quota',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{
            quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
            quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
            quotaValue: '0'
          }] },
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '17s' }
        ]
      }
    }), { status: 429 })));
    const error = await generateSituationPicture('a room', 'test-key', new AbortController().signal)
      .catch((value: Error) => value);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('(429)');
    expect(message).toContain('"quotaCategory":"perDay"');
    expect(message).toContain('"limit":"0"');
    expect(message).toContain('"retryDelay":"17s"');
    expect(message).not.toMatch(/Quota exceeded|abcd|https:/u);
  });

  it('adds nothing when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 429 })));
    const error = await generateSituationPicture('a room', 'test-key', new AbortController().signal)
      .catch((value: Error) => value);
    expect((error as Error).message).toMatch(/\(429\)\. The usage limit was reached\. Try again later or check your quota\.$/u);
  });
});
