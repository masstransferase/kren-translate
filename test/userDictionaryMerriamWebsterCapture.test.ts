import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KREN_SECRET_KEYS,
  runUserDictionaryCapture,
  type KrenRuntime
} from '../src/operations.js';
import {
  USER_DICTIONARY_GENERATION_SCHEMA,
  userDictionaryGenerationInstruction,
  type UserDictionaryCaptureResult
} from '../src/userDictionary/capture.js';
import {
  USER_DICTIONARY_CAPTURE_DEFAULTS,
  type UserDictionaryCaptureSettings
} from '../src/userDictionary/settings.js';
import { UserDictionaryService } from '../src/userDictionary/service.js';
import { UserDictionaryStorage } from '../src/userDictionary/storage.js';

// Matches the Merriam-Webster host by parsing the URL and comparing the hostname, rather
// than asking whether the string contains "dictionaryapi.com" anywhere. CodeQL flagged the
// substring form as incomplete URL sanitization, four times, and it was right about the
// shape even though these are test mocks that sanitize nothing: "dictionaryapi.com" can
// sit in a path or a query string of an entirely different host. Parsing is also simply
// the correct way to ask which service a request went to.
function isMerriamWebsterUrl(value: string): boolean {
  try {
    return new URL(value).hostname === 'www.dictionaryapi.com';
  } catch {
    return false;
  }
}


const expression = 'ledger';
const referenceDefinition = 'A provider-authored record of transactions.';
const modelDefinition = 'A personal record used to organize transactions.';
const llmCredential = ['configured', 'language-model'].join('-');
const referenceCredential = ['configured', 'reference'].join('-');

const validModelOutput = {
  language: 'en',
  entryType: 'noun',
  domains: ['business'],
  tags: ['accounting'],
  pronunciation: '',
  senses: [{
    partOfSpeech: 'noun',
    definition: modelDefinition,
    usageNote: '',
    synonyms: ['record'],
    antonyms: [],
    relatedTerms: ['journal'],
    examples: ['The ledger was reconciled.']
  }],
  aliases: []
};

const referencePayload = [{
  meta: { id: 'ledger:1', stems: ['ledger'] },
  hwi: { hw: 'ledger' },
  fl: 'noun',
  shortdef: [referenceDefinition]
}];

const captureSettings: UserDictionaryCaptureSettings = {
  ...USER_DICTIONARY_CAPTURE_DEFAULTS,
  captureMode: 'merriamWebsterAndLlm',
  provider: 'openai',
  model: 'gpt-capture-test',
  entryLanguage: 'en',
  numberOfExamples: 1
};

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

function requestContent(request: CapturedRequest | undefined): Record<string, unknown> {
  return {
    url: request?.url,
    method: request?.init.method ?? 'GET',
    headers: request?.init.headers ?? {},
    body: request?.init.body ?? null,
    initKeys: Object.keys(request?.init ?? {}).sort()
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function runtime(
  overrides: Record<string, unknown> = {},
  secrets: Partial<Record<string, string | undefined>> = {}
): KrenRuntime {
  const values: Record<string, unknown> = {
    'userDictionary.enabled': true,
    'userDictionary.defaultCaptureMode': 'merriamWebsterAndLlm',
    'userDictionary.fallbackOnMerriamWebsterNoMatch': false,
    'userDictionary.provider': 'openai',
    'userDictionary.model': 'gpt-capture-test',
    'userDictionary.entryLanguage': 'en',
    'userDictionary.numberOfExamples': 1,
    'languageModel.retry.enabled': false,
    ...overrides
  };
  return {
    getSecret: async (key) => {
      if (Object.hasOwn(secrets, key)) return secrets[key];
      if (key === KREN_SECRET_KEYS.openai) return llmCredential;
      if (key === KREN_SECRET_KEYS.merriamWebsterCollegiate) return referenceCredential;
      return undefined;
    },
    getSetting: <T>(key: string, fallback: T): T => (values[key] ?? fallback) as T,
    reserveCloudCharacters: async () => undefined,
    beforeGeminiRequest: async () => undefined
  };
}

function openAIResponse(): Response {
  return new Response(JSON.stringify({
    output: [{ content: [{ type: 'output_text', text: JSON.stringify(validModelOutput) }] }]
  }), { status: 200 });
}

function captureFetch(referenceResponse: () => Response): {
  requests: CapturedRequest[];
  fetchMock: ReturnType<typeof vi.fn>;
} {
  const requests: CapturedRequest[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    requests.push({ url, init });
    return isMerriamWebsterUrl(url) ? referenceResponse() : openAIResponse();
  });
  vi.stubGlobal('fetch', fetchMock);
  return { requests, fetchMock };
}

function requireCombinedCapture(
  value: Awaited<ReturnType<typeof runUserDictionaryCapture>>
): asserts value is UserDictionaryCaptureResult {
  expect('captureMode' in value).toBe(true);
  if (!('captureMode' in value)) throw new Error('Expected combined capture result.');
}

describe('User Dictionary Merriam-Webster + LLM capture', () => {
  it('sends byte-identical LLM requests in both modes and neither response to the other provider', async () => {
    const llmOnlyCapture = captureFetch(() => new Response(JSON.stringify(referencePayload)));
    const llmOnlyResult = await runUserDictionaryCapture(
      runtime({ 'userDictionary.defaultCaptureMode': 'llmOnly' }),
      expression,
      new AbortController().signal
    );
    const llmOnlyRequest = llmOnlyCapture.requests.find((request) =>
      request.url === 'https://api.openai.com/v1/responses'
    );
    expect(llmOnlyResult).toMatchObject({
      schemaVersion: 1,
      term: expression,
      capture: { mode: 'llmOnly' }
    });

    vi.restoreAllMocks();
    const combinedCapture = captureFetch(() => new Response(JSON.stringify(referencePayload)));
    const result = await runUserDictionaryCapture(
      runtime(),
      expression,
      new AbortController().signal
    );
    requireCombinedCapture(result);
    const combinedLlmRequest = combinedCapture.requests.find((request) =>
      request.url === 'https://api.openai.com/v1/responses'
    );
    const merriamWebsterRequest = combinedCapture.requests.find((request) =>
      isMerriamWebsterUrl(request.url)
    );

    const expectedLlmBody = {
      model: 'gpt-capture-test',
      instructions: userDictionaryGenerationInstruction(captureSettings),
      input: [{ role: 'user', content: [{ type: 'input_text', text: expression }] }],
      store: false,
      max_output_tokens: 4096,
      text: {
        format: {
          type: 'json_schema',
          name: 'kren_user_dictionary_entry',
          strict: true,
          schema: USER_DICTIONARY_GENERATION_SCHEMA
        }
      },
      reasoning: { effort: 'low' }
    };
    const expectedLlmRequest = {
      url: 'https://api.openai.com/v1/responses',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llmCredential}`
      },
      body: JSON.stringify(expectedLlmBody),
      initKeys: ['body', 'headers', 'method', 'signal']
    };
    expect(requestContent(combinedLlmRequest)).toEqual(requestContent(llmOnlyRequest));
    expect(requestContent(combinedLlmRequest)).toEqual(expectedLlmRequest);
    expect(String(combinedLlmRequest?.init.body)).toBe(JSON.stringify(expectedLlmBody));
    expect(String(combinedLlmRequest?.init.body)).not.toContain(referenceDefinition);
    expect(requestContent(merriamWebsterRequest)).toEqual({
      url: `https://www.dictionaryapi.com/api/v3/references/collegiate/json/${expression}?key=${referenceCredential}`,
      method: 'GET',
      headers: {},
      body: null,
      initKeys: ['signal']
    });
    expect(result.draft?.merriamWebsterReference).toEqual({
      referenceWork: 'collegiate',
      lookupTerm: expression,
      entryId: 'ledger:1',
      matchStatus: 'matched'
    });
    expect(JSON.stringify(merriamWebsterRequest)).not.toContain(modelDefinition);
  });

  it('distinguishes a genuine no-match from authentication failure', async () => {
    captureFetch(() => new Response(JSON.stringify([]), { status: 200 }));
    const noMatch = await runUserDictionaryCapture(
      runtime({ 'userDictionary.fallbackOnMerriamWebsterNoMatch': true }),
      expression,
      new AbortController().signal
    );

    vi.restoreAllMocks();
    captureFetch(() => new Response(JSON.stringify({ message: 'rejected' }), { status: 401 }));
    const authenticationFailure = await runUserDictionaryCapture(
      runtime({ 'userDictionary.fallbackOnMerriamWebsterNoMatch': true }),
      expression,
      new AbortController().signal
    );
    requireCombinedCapture(noMatch);
    requireCombinedCapture(authenticationFailure);

    expect(noMatch.merriamWebster).toMatchObject({ noMatch: true });
    expect(noMatch.merriamWebster?.failure).toBeUndefined();
    expect(authenticationFailure.merriamWebster?.noMatch).toBeUndefined();
    expect(authenticationFailure.merriamWebster?.failure).toContain('authentication failure');
    expect(authenticationFailure.fallbackUsed).toBe(false);
  });

  it('stores only the four minimal reference metadata fields', async () => {
    captureFetch(() => new Response(JSON.stringify(referencePayload), { status: 200 }));
    const capture = await runUserDictionaryCapture(
      runtime(),
      expression,
      new AbortController().signal
    );
    requireCombinedCapture(capture);
    expect(capture.draft).toBeDefined();

    const directory = await mkdtemp(path.join(tmpdir(), 'kren-d9-storage-'));
    try {
      const storage = new UserDictionaryStorage(directory);
      const service = new UserDictionaryService(storage, () => '2026-08-13T00:00:00.000Z');
      await service.save(capture.draft!);
      const stored = await storage.read();
      const reference = stored.entries[0]?.merriamWebsterReference;

      expect(reference).toEqual({
        referenceWork: 'collegiate',
        lookupTerm: expression,
        entryId: 'ledger:1',
        matchStatus: 'matched'
      });
      expect(Object.keys(reference ?? {}).sort()).toEqual([
        'entryId', 'lookupTerm', 'matchStatus', 'referenceWork'
      ]);
      expect(JSON.stringify(stored)).not.toContain(referenceDefinition);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('attempts no lookup or language-model request without the selected reference key', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(runUserDictionaryCapture(
      runtime({}, { [KREN_SECRET_KEYS.merriamWebsterCollegiate]: undefined }),
      expression,
      new AbortController().signal
    )).rejects.toMatchObject({ action: 'setMerriamWebsterCollegiateKey' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows fallback only for a genuine no-match when enabled', async () => {
    captureFetch(() => new Response(JSON.stringify([]), { status: 200 }));
    const enabled = await runUserDictionaryCapture(
      runtime({ 'userDictionary.fallbackOnMerriamWebsterNoMatch': true }),
      expression,
      new AbortController().signal
    );

    vi.restoreAllMocks();
    const disabledCapture = captureFetch(
      () => new Response(JSON.stringify([]), { status: 200 })
    );
    const disabled = await runUserDictionaryCapture(
      runtime({ 'userDictionary.fallbackOnMerriamWebsterNoMatch': false }),
      expression,
      new AbortController().signal
    );
    requireCombinedCapture(enabled);
    requireCombinedCapture(disabled);

    expect(enabled).toMatchObject({ fallbackUsed: true });
    expect(enabled.draft?.capture.mode).toBe('merriamWebsterAndLlm');
    expect(enabled.draft?.merriamWebsterReference?.matchStatus).toBe('noMatch');
    expect(disabled).toMatchObject({ fallbackUsed: false });
    expect(disabled.draft).toBeUndefined();
    expect(disabledCapture.requests).toHaveLength(2);
  });

  it('does not label network failure as no-match or expose submitted content', async () => {
    const privateExpression = 'private expression for failure classification';
    const requests: CapturedRequest[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      requests.push({ url, init });
      if (isMerriamWebsterUrl(url)) throw new Error('offline');
      return openAIResponse();
    }));

    const result = await runUserDictionaryCapture(
      runtime({ 'userDictionary.fallbackOnMerriamWebsterNoMatch': true }),
      privateExpression,
      new AbortController().signal
    );
    requireCombinedCapture(result);

    expect(result.merriamWebster?.failure).toContain('network failure');
    expect(result.merriamWebster?.failure).not.toContain(privateExpression);
    expect(result.merriamWebster?.failure).not.toContain(referenceCredential);
    expect(result.merriamWebster?.noMatch).toBeUndefined();
    expect(result.fallbackUsed).toBe(false);
    expect(requests).toHaveLength(2);
  });

  it('reports quota failure as operational failure without no-match fallback', async () => {
    captureFetch(() => new Response(JSON.stringify({ message: 'limit' }), { status: 429 }));

    const result = await runUserDictionaryCapture(
      runtime({ 'userDictionary.fallbackOnMerriamWebsterNoMatch': true }),
      expression,
      new AbortController().signal
    );
    requireCombinedCapture(result);

    expect(result.merriamWebster?.failure).toContain('quota failure');
    expect(result.merriamWebster?.noMatch).toBeUndefined();
    expect(result.fallbackUsed).toBe(false);
    expect(result.draft).toBeDefined();
  });

  it('reports an independent language-model failure without entry or reference content', async () => {
    const privateExpression = 'private expression for model failure';
    const requests: CapturedRequest[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      requests.push({ url, init });
      return isMerriamWebsterUrl(url)
        ? new Response(JSON.stringify(referencePayload), { status: 200 })
        : new Response(JSON.stringify({ message: 'rejected' }), { status: 401 });
    }));

    const error = await runUserDictionaryCapture(
      runtime(),
      privateExpression,
      new AbortController().signal
    ).catch((caught: unknown) => caught);

    expect(String(error)).toContain('OpenAI User Dictionary request failed (401)');
    expect(String(error)).not.toContain(privateExpression);
    expect(String(error)).not.toContain(referenceDefinition);
    expect(String(error)).not.toContain(llmCredential);
    expect(requests).toHaveLength(2);
  });
});
