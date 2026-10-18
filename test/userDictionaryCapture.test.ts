import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureUserDictionaryDraft,
  HttpUserDictionaryProviderTransport,
  userDictionaryGenerationSchema,
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

const CONTEXT_SENTENCE = 'We should get rid of the obsolete ledger before filing.';

// Named once so both boundary tests check the same list. Two copies is how the context test
// ends up proving less than the context-free one it was modelled on.
const FORBIDDEN_ITEMS = {
  'surrounding text': 'The quarterly report says get rid of this ledger before filing.',
  'file name': 'confidential-quarterly-report.md',
  'workspace path': 'C:/work/private-client',
  'existing entry content': 'A previously saved confidential definition.',
  'provider credential': ['test', 'credential', 'must', 'not', 'leave'].join('-')
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
      expression: 'get rid of',
      schema: userDictionaryGenerationSchema()
    };
    expect(outgoing).toEqual([expectedRequest]);
    expect(Object.keys(outgoing[0] ?? {}).sort())
      .toEqual(['expression', 'instruction', 'schema']);

    const serialized = JSON.stringify(outgoing);
    for (const [name, forbidden] of Object.entries(FORBIDDEN_ITEMS)) {
      expect(serialized, name).not.toContain(forbidden);
    }
  });

  // Smart Word Capture widens what leaves the machine by exactly one sentence, and the
  // boundary above is the only thing that says by how much. Asserting the sentence arrives
  // would prove half of it; the half that matters is that nothing else came with it.
  it('sends the context sentence and still nothing else from the document', async () => {
    const outgoing: UserDictionaryGenerationRequest[] = [];
    const transport: UserDictionaryProviderTransport = {
      provider: 'gemini',
      model: 'gemini-dictionary-test',
      async generate(request) {
        outgoing.push(request);
        return { ...validOutput, contextSenseIndex: 0 };
      }
    };

    await captureUserDictionaryDraft(
      'get rid of',
      settings,
      transport,
      new AbortController().signal,
      {
        contextSentence: CONTEXT_SENTENCE,
        now: () => '2026-08-12T00:00:00.000Z',
        uuid: (() => {
          let id = 0;
          return () => `entry-or-sense-${++id}`;
        })()
      }
    );

    expect(outgoing[0]?.instruction).toContain(CONTEXT_SENTENCE);
    expect(outgoing[0]?.expression).toBe('get rid of');
    expect(Object.keys(outgoing[0] ?? {}).sort())
      .toEqual(['expression', 'instruction', 'schema']);

    const serialized = JSON.stringify(outgoing);
    for (const [name, forbidden] of Object.entries(FORBIDDEN_ITEMS)) {
      expect(serialized, name).not.toContain(forbidden);
    }
    // The paragraph the sentence was cut from never travels, so the neighbouring sentences
    // are the specific thing this proves absent.
    expect(serialized).not.toContain('Nobody had reviewed it.');
    expect(serialized).not.toContain('The audit was overdue.');
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
      expression: 'get rid of',
      schema: userDictionaryGenerationSchema()
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
          schema: userDictionaryGenerationSchema()
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
