import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  requestTutorStructuredJson,
  type TutorStructuredGenerationRequest,
  type TutorTransportSettings
} from '../src/tutor/generation.js';
import { classifyGeminiRateLimit, geminiErrorMetadata, isRetryableGeminiStatus, transcribeGeminiAudio } from '../src/providers/gemini.js';

const settings: TutorTransportSettings = {
  provider: 'gemini',
  model: 'gemini-3.8-flash',
  thinkingOrEffort: 'auto',
  apiKey: 'credential',
  maxAttempts: 3
};

const request: TutorStructuredGenerationRequest = {
  kind: 'conversationOpening',
  instruction: 'Return one opening.',
  input: '{}',
  schema: {
    type: 'object',
    properties: { opening: { type: 'string' } },
    required: ['opening']
  },
  schemaName: 'kren_tutor_conversation_opening'
};

// These fixtures follow Google's documented google.rpc Status, QuotaFailure, and RetryInfo
// shapes. No provider call is made by these tests.
const exhaustedDailyQuota = {
  error: {
    code: 429,
    message: 'You exceeded your current quota. Please check your plan and billing details.',
    status: 'RESOURCE_EXHAUSTED',
    details: [{
      '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
      violations: [{
        quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
        quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
        quotaDimensions: { location: 'global', model: 'gemini-3.8-flash' },
        quotaValue: '0'
      }]
    }, {
      '@type': 'type.googleapis.com/google.rpc.RetryInfo',
      retryDelay: '47s'
    }]
  }
};

const temporaryMinuteLimit = {
  error: {
    code: 429,
    message: 'You exceeded your current quota. Please check your plan and billing details.',
    status: 'RESOURCE_EXHAUSTED',
    details: [{
      '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
      violations: [{
        quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
        quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier',
        quotaDimensions: { location: 'global', model: 'gemini-3.8-flash' },
        quotaValue: '15'
      }]
    }, {
      '@type': 'type.googleapis.com/google.rpc.RetryInfo',
      retryDelay: '30s'
    }]
  }
};

function failure(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 429,
    headers: { 'Content-Type': 'application/json' }
  });
}

function success(): Response {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ opening: 'Hello?' }) }] } }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Gemini 429 classification', () => {
  it.each([
    ['PrivateAnswerRequestsPerDay', '0', 'perDay', 'quotaExhausted', false],
    ['PrivateAnswerRequestsPerDay', '10', 'perDay', 'quotaExhausted', false],
    ['GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '15', 'perMinute', 'rateLimit', true],
    ['PrivateAnswerTokensPerHour', '10', 'perHour', 'unknown', true],
    ['unrecognizable-name', '10', 'other', 'unknown', true],
    [123, '10', 'other', 'unknown', true]
  ] as const)('keeps only the category for quota name %s with limit %s', (quotaId, quotaValue, quotaCategory, kind, retryable) => {
    const payload = { error: { details: [{ '@type': 'google.rpc.QuotaFailure', violations: [{ quotaId, quotaValue }] }] } };
    expect(JSON.stringify({ metadata: geminiErrorMetadata(payload), classification: classifyGeminiRateLimit(payload) })).not.toContain('PrivateAnswer');
    expect(classifyGeminiRateLimit(payload)).toEqual({ quotaCategory, quotaLimit: quotaValue, kind, retryable });
    const metadata = JSON.parse(geminiErrorMetadata(payload));
    expect(metadata).toEqual({ quotaCategory, limit: quotaValue });
  });

  it('V138 classifies the two real-shaped Google bodies by quota window, not status alone', () => {
    expect(isRetryableGeminiStatus(429, temporaryMinuteLimit)).toBe(true);
    expect(isRetryableGeminiStatus(429, exhaustedDailyQuota)).toBe(false);
  });

  it('V138 does not retry a real-shaped exhausted daily quota', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => failure(exhaustedDailyQuota));

    const pending = requestTutorStructuredJson(
      settings, request, new AbortController().signal, fetcher
    );
    const rejected = expect(pending).rejects.toMatchObject({ status: 429, retryable: false });
    await vi.runAllTimersAsync();

    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  // Added 2026-09-22: the brief asked for the quota identifier to reach the output channel,
  // because the owner's own log was truncated at "Quota ex..." exactly where the name was.
  // Mutation on 2026-09-22 showed nothing pinned it: removing the identifier from the message
  // left every test passing.
  // Changed 2026-10-17: V259, R14 finding 1, quota diagnostics expose only the window category.
  it('V138 reports the exhausted quota category in the error the output channel receives', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => failure(exhaustedDailyQuota));

    const pending = requestTutorStructuredJson(
      settings, request, new AbortController().signal, fetcher
    );
    const rejected = expect(pending).rejects.toThrow(
      /"quotaCategory":"perDay"/u
    );
    await vi.runAllTimersAsync();
    await rejected;
  });

  it('V138 retries a real-shaped per-minute limit and honours google.rpc RetryInfo', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(failure(temporaryMinuteLimit))
      .mockResolvedValueOnce(success());

    const pending = requestTutorStructuredJson(
      settings, request, new AbortController().signal, fetcher
    );
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toEqual({ opening: 'Hello?' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('V138 applies the same exhausted-quota stop to Gemini transcription', async () => {
    const fetcher = vi.fn(async () => failure(exhaustedDailyQuota));
    await expect(transcribeGeminiAudio(
      'credential', Uint8Array.from([1]), new AbortController().signal, 3, fetcher
    )).rejects.toMatchObject({ status: 429, retryable: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
