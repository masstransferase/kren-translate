// Changed 2026-10-22 (V298, owner I70/D33 B): Fast covers fallback.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KREN_SECRET_KEYS,
  runTutorStructuredRequest,
  type KrenRuntime,
  type TutorLanguageModelRoute
} from '../src/operations.js';
import type { TutorStructuredGenerationRequest } from '../src/tutor/generation.js';
import { ProviderExhaustionState } from '../src/languageModelSwitching.js';

// Added 2026-09-18. The reader uses the Default Gemini profile, turned on Automatic fallback in
// LLM ROUTING, and still saw "This model is currently experiencing high demand" as a 503: the
// tutor fell back only on the Alternate profile, so on Default the toggle did nothing.

function runtime(): KrenRuntime {
  return {
    // Changed 2026-10-16: V257, R13 finding 3, each test owns its newly remembered quota pools.
    providerExhaustion: new ProviderExhaustionState(),
    getSecret: vi.fn(async () => 'credential'),
    // One attempt, so a 503 reaches the fallback without the retry backoff slowing the test.
    getSetting: vi.fn((key: string, fallback: unknown) =>
      // 2026-10-11: these probes exercise legacy model fallback with provider switching off.
      key === 'gemini.retry.enabled' || key === 'llm.providerSwitch' ? false : fallback) as never,
    reserveCloudCharacters: vi.fn(),
    beforeGeminiRequest: vi.fn(),
    beforeLanguageModelRequest: vi.fn()
  };
}

function route(overrides: Partial<TutorLanguageModelRoute> = {}): TutorLanguageModelRoute {
  return {
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    thinkingOrEffort: 'auto',
    geminiProfile: 'standard',
    fallbackEnabled: true,
    fastModel: 'gemini-3.5-flash-lite',
    fallbackModel: 'gemini-3.6-flash',
    fallbackThinkingOrEffort: 'auto',
    ...overrides
  } as TutorLanguageModelRoute;
}

const request: TutorStructuredGenerationRequest = {
  // 2026-10-11: use a Thorough transport probe; Fast conversation replies require their feature schema.
  kind: 'lesson',
  instruction: 'Return one JSON object with a string field "value".',
  input: '{}',
  schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
  schemaName: 'fallback_probe'
} as TutorStructuredGenerationRequest;

const busy = () => new Response(JSON.stringify({
  error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' }
}), { status: 503, headers: { 'Content-Type': 'application/json' } });

const answered = () => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text: JSON.stringify({ value: 'from the fallback' }) }] } }]
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

const exhaustedQuota = () => new Response(JSON.stringify({
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
    }]
  }
}), { status: 429, headers: { 'Content-Type': 'application/json' } });

function stubFetch(primaryModel: string) {
  const requests: Array<{ model: string; thinkingOrEffort: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const model = decodeURIComponent(/models\/([^:]+):/u.exec(url)?.[1] ?? '');
    const body = JSON.parse(String(init?.body)) as {
      generationConfig?: { thinkingConfig?: { thinkingLevel?: string } };
    };
    requests.push({
      model,
      thinkingOrEffort: body.generationConfig?.thinkingConfig?.thinkingLevel ?? 'auto'
    });
    return model === primaryModel ? busy() : answered();
  }));
  return requests;
}

afterEach(() => vi.unstubAllGlobals());

describe('tutor fallback across Gemini profiles', () => {
  // Changed 2026-09-21: V135 pinned the opposite, that the tutor reads no retry setting,
  // because its LLM ROUTING group draws no retry control. The owner has the shared Gemini
  // retry switched on, so that made every tutor request single-attempt and would have made
  // the provider-busy message they reported more frequent. The tutor honours the setting.
  it('V135 honours the shared Gemini retry control the tutor does not draw', async () => {
    const host = runtime();
    const requests = stubFetch('gemini-3.8-flash');

    await runTutorStructuredRequest(host, route(), request, new AbortController().signal);

    expect(host.getSetting).toHaveBeenCalledWith('gemini.retry.enabled', true);
    expect(requests.map(({ model }) => model)).toEqual([
      'gemini-3.8-flash', 'gemini-3.5-flash-lite'
    ]);
  });

  it.each([
    ['standard', KREN_SECRET_KEYS.gemini],
    ['pro', KREN_SECRET_KEYS.geminiPro]
  ] as const)('V134 selects the %s profile key for a Live session', async (geminiProfile, secretKey) => {
    const host = runtime();
    // Changed 2026-10-23 (V304, owner I75): Live keys use the independent setting.
    vi.mocked(host.getSetting).mockImplementation((key: string, fallback: unknown) => key === 'tutor.liveGeminiProfile' ? geminiProfile : fallback as never);
    await runTutorStructuredRequest(
      host,
      route({ geminiProfile }),
      { ...request, kind: 'liveSessionCredential' },
      new AbortController().signal
    );

    expect(host.getSecret).toHaveBeenCalledWith(secretKey);
  });

  // 2026-10-11: Gemini Live credentials are independent of the text provider.
  it.each(['standard', 'pro'] as const)('V222 retrieves the %s Gemini key with Groq routing', async geminiProfile => {
    const host = runtime();
    // Changed 2026-10-23 (V304, owner I75): text provider and Live profile are independent.
    vi.mocked(host.getSetting).mockImplementation((key: string, fallback: unknown) => key === 'tutor.liveGeminiProfile' ? geminiProfile : fallback as never);
    const result = await runTutorStructuredRequest(host, route({ provider: 'groq', geminiProfile }),
      { ...request, kind: 'liveSessionCredential' }, new AbortController().signal);
    expect(host.getSecret).toHaveBeenCalledWith(geminiProfile === 'pro' ? KREN_SECRET_KEYS.geminiPro : KREN_SECRET_KEYS.gemini);
    expect(host.getSecret).not.toHaveBeenCalledWith(KREN_SECRET_KEYS.groq);
    expect(result).toHaveProperty('apiKey');
  });

  it.each(['standard', 'pro'] as const)(
    'V298 sends the Fast model and Fast thinking on the %s profile',
    async (geminiProfile) => {
      const requests = stubFetch('gemini-3.8-flash');
      const value = await runTutorStructuredRequest(runtime(), route({
        geminiProfile,
        fastThinkingOrEffort: 'high'
      }), request, new AbortController().signal);

      expect(requests).toEqual([
        // 2026-10-11: Auto now sends the model's lowest supported thinking.
        { model: 'gemini-3.8-flash', thinkingOrEffort: 'low' },
        { model: 'gemini-3.5-flash-lite', thinkingOrEffort: 'high' }
      ]);
      expect(value).toEqual({ value: 'from the fallback' });
    }
  );

  it('does not fall back when the reader turned fallback off', async () => {
    const requests = stubFetch('gemini-3.8-flash');
    await expect(runTutorStructuredRequest(
      runtime(), route({ fallbackEnabled: false }), request, new AbortController().signal
    )).rejects.toThrow('503');
    expect(requests.map(({ model }) => model)).toEqual(['gemini-3.8-flash']);
  });

  it('does not fall back to the same model it just failed on', async () => {
    const requests = stubFetch('gemini-3.8-flash');
    await expect(runTutorStructuredRequest(
      runtime(), route({ fastModel: 'gemini-3.8-flash' }), request, new AbortController().signal
    )).rejects.toThrow('503');
    expect(requests.map(({ model }) => model)).toEqual(['gemini-3.8-flash']);
  });

  it('V138 sends an exhausted primary quota straight to Automatic fallback', async () => {
    const host = runtime();
    host.getSetting = vi.fn((key: string, fallback: unknown) => {
      if (key === 'gemini.retry.enabled') return true;
      if (key === 'gemini.retry.maxAttempts') return 5;
      if (key === 'llm.providerSwitch') return false; // 2026-10-11: preserve the switching-off fallback probe.
      return fallback;
    }) as never;
    const models: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const model = decodeURIComponent(/models\/([^:]+):/u.exec(String(input))?.[1] ?? '');
      models.push(model);
      return model === 'gemini-3.8-flash' ? exhaustedQuota() : answered();
    }));

    await expect(runTutorStructuredRequest(
      host, route(), request, new AbortController().signal
    )).resolves.toEqual({ value: 'from the fallback' });

    expect(models).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
  });

  it('V138 caps a retryable conversation opening at three primary attempts', async () => {
    vi.useFakeTimers();
    try {
      const host = runtime();
      host.getSetting = vi.fn((key: string, fallback: unknown) => {
        if (key === 'gemini.retry.enabled') return true;
        if (key === 'gemini.retry.maxAttempts') return 5;
        if (key === 'llm.providerSwitch') return false; // 2026-10-11: isolate HTTP retry from provider switching.
        return fallback;
      }) as never;
      const models: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
        const model = decodeURIComponent(/models\/([^:]+):/u.exec(String(input))?.[1] ?? '');
        models.push(model);
        return busy();
      }));
      const opening = { ...request, kind: 'conversationOpening' as const };
      const pending = runTutorStructuredRequest(
        host, route({ fallbackEnabled: false }), opening, new AbortController().signal
      );
      const rejected = expect(pending).rejects.toMatchObject({ status: 503 });
      await vi.runAllTimersAsync();
      await rejected;
      expect(models).toEqual([
        // 2026-10-11: V225 resolves named roles with the Thorough profile on every attempt.
        'gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.8-flash'
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('V139 reaches Automatic fallback only after retryable primary attempts are exhausted', async () => {
    vi.useFakeTimers();
    try {
      const host = runtime();
      host.getSetting = vi.fn((key: string, fallback: unknown) => {
        if (key === 'gemini.retry.enabled') return true;
        if (key === 'gemini.retry.maxAttempts') return 2;
        if (key === 'llm.providerSwitch') return false; // 2026-10-11: this tests model fallback, not daily switching.
        return fallback;
      }) as never;
      const attempts = vi.fn();
      const backoffs = vi.fn();
      const models: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
        const model = decodeURIComponent(/models\/([^:]+):/u.exec(String(input))?.[1] ?? '');
        models.push(model);
        return model === 'gemini-3.8-flash'
          ? new Response(JSON.stringify({
              error: { code: 429, message: 'Temporarily rate limited.', status: 'RESOURCE_EXHAUSTED' }
            }), { status: 429, headers: { 'Content-Type': 'application/json' } })
          : answered();
      }));
      const pending = runTutorStructuredRequest(host, route({
        onProviderAttempt: attempts,
        onProviderBackoff: backoffs
      }), request, new AbortController().signal);

      await vi.runAllTimersAsync();
      await expect(pending).resolves.toEqual({ value: 'from the fallback' });
      expect(models).toEqual([
        'gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'
      ]);
      expect(attempts).toHaveBeenCalledTimes(3);
      expect(backoffs.mock.calls).toEqual([[1_000]]);
    } finally {
      vi.useRealTimers();
    }
  });
});
