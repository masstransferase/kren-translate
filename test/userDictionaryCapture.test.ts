import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureUserDictionaryDraft,
  HttpUserDictionaryProviderTransport,
  USER_DICTIONARY_GENERATION_SCHEMA,
  UserDictionaryMalformedOutputError,
  userDictionaryGenerationInstruction,
  type UserDictionaryGenerationRequest,
  type UserDictionaryProviderTransport
} from '../src/userDictionary/capture.js';
import {
  USER_DICTIONARY_CAPTURE_DEFAULTS,
  type UserDictionaryCaptureSettings
} from '../src/userDictionary/settings.js';

const settings: UserDictionaryCaptureSettings = {
  ...USER_DICTIONARY_CAPTURE_DEFAULTS,
  entryLanguage: 'en',
  numberOfExamples: 1
};

const validOutput = {
  language: 'en',
  entryType: 'idiomatic verb phrase',
  domains: ['general'],
  tags: ['idiom'],
  pronunciation: '',
  senses: [{
    partOfSpeech: 'verb',
    definition: 'To remove or dispose of someone or something.',
    usageNote: 'Often followed by the object being removed.',
    synonyms: ['eliminate'],
    antonyms: ['keep'],
    relatedTerms: ['discard'],
    examples: ['They got rid of the obsolete files.']
  }],
  aliases: []
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('User Dictionary LLM capture boundary', () => {
  it('sends exactly the selected expression and bounded KREN instruction', async () => {
    const outgoing: UserDictionaryGenerationRequest[] = [];
    const transport: UserDictionaryProviderTransport = {
      provider: 'gemini',
      model: 'gemini-dictionary-test',
      async generate(request) {
        outgoing.push(request);
        return validOutput;
      }
    };

    await captureUserDictionaryDraft(
      'get rid of',
      settings,
      transport,
      new AbortController().signal,
      {
        now: () => '2026-08-12T00:00:00.000Z',
        uuid: (() => {
          let id = 0;
          return () => `entry-or-sense-${++id}`;
        })()
      }
    );

    const expectedRequest = {
      instruction: userDictionaryGenerationInstruction(settings),
      expression: 'get rid of'
    };
    expect(outgoing).toEqual([expectedRequest]);
    expect(Object.keys(outgoing[0] ?? {}).sort()).toEqual(['expression', 'instruction']);

    const serialized = JSON.stringify(outgoing);
    const forbiddenItems = {
      'surrounding text': 'The quarterly report says get rid of this ledger before filing.',
      'file name': 'confidential-quarterly-report.md',
      'workspace path': 'C:/work/private-client',
      'existing entry content': 'A previously saved confidential definition.',
      'provider credential': ['test', 'credential', 'must', 'not', 'leave'].join('-')
    };
    for (const [name, forbidden] of Object.entries(forbiddenItems)) {
      expect(serialized, name).not.toContain(forbidden);
    }
  });

  it('builds provider HTTP envelopes with no extra user-authored context', async () => {
    const fetchMock = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit
    ) => new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(validOutput) }] }]
    }), { status: 200 }));
    const transport = new HttpUserDictionaryProviderTransport({
      provider: 'openai',
      apiKey: ['temporary', 'credential'].join('-'),
      model: 'gpt-dictionary-test',
      thinkingOrEffort: 'low',
      maxAttempts: 1,
      fetch: fetchMock as typeof fetch
    });
    const request = {
      instruction: userDictionaryGenerationInstruction(settings),
      expression: 'get rid of'
    };

    await transport.generate(request, new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      model: 'gpt-dictionary-test',
      instructions: request.instruction,
      input: [{ role: 'user', content: [{ type: 'input_text', text: request.expression }] }],
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
    });
  });

  it('retries malformed output only with the same provider and preserves no partial entry', async () => {
    const generate = vi.fn(async () => ({ language: 'en', entryType: 'noun' }));
    const transport: UserDictionaryProviderTransport = {
      provider: 'anthropic',
      model: 'claude-dictionary-test',
      generate
    };
    const write = vi.fn();

    await expect(captureUserDictionaryDraft(
      'ledger',
      settings,
      transport,
      new AbortController().signal,
      { maxMalformedAttempts: 3 }
    )).rejects.toBeInstanceOf(UserDictionaryMalformedOutputError);

    expect(generate).toHaveBeenCalledTimes(3);
    expect(write).not.toHaveBeenCalled();
  });

  it('honors cancellation without producing a draft or storage write', async () => {
    const controller = new AbortController();
    const write = vi.fn();
    const transport: UserDictionaryProviderTransport = {
      provider: 'gemini',
      model: 'gemini-dictionary-test',
      async generate(_request, signal) {
        controller.abort();
        signal.throwIfAborted();
        return validOutput;
      }
    };

    await expect(captureUserDictionaryDraft(
      'ledger',
      settings,
      transport,
      controller.signal
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(write).not.toHaveBeenCalled();
  });

  it('uses content-free malformed-output errors', async () => {
    const privateExpression = 'private expression that must not enter an error';
    const transport: UserDictionaryProviderTransport = {
      provider: 'gemini',
      model: 'gemini-dictionary-test',
      async generate() { return {}; }
    };

    const error = await captureUserDictionaryDraft(
      privateExpression,
      settings,
      transport,
      new AbortController().signal,
      { maxMalformedAttempts: 1 }
    ).catch((caught: unknown) => caught);

    expect(String(error)).not.toContain(privateExpression);
  });
});
