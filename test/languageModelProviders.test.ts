import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider, buildAnthropicRequestBody } from '../src/providers/anthropic.js';
import {
  buildOpenAIRequestBody,
  explanationSchema,
  OpenAIProvider,
  rewriteSchema
} from '../src/providers/openai.js';
import type { RewriteRequest, TranslationRequest } from '../src/types.js';
import { REWRITE_VARIANT_IDS } from '@kren/core/rewrite-variants';

afterEach(() => vi.restoreAllMocks());

const selectedText = 'Only this selected text.\nNo surrounding document.';
const instructions = 'Fixed KREN instructions for the requested operation.';

describe('language-model request privacy', () => {
  it('places only submitted text in the OpenAI user input and disables storage', () => {
    const body = buildOpenAIRequestBody(
      'gpt-5.4',
      instructions,
      selectedText,
      'kren_explanation',
      explanationSchema(),
      'low'
    );

    expect(body.instructions).toBe(instructions);
    expect(body.input).toEqual([{
      role: 'user',
      content: [{ type: 'input_text', text: selectedText }]
    }]);
    expect(body.store).toBe(false);
    expect(JSON.stringify(body)).not.toContain('workspace');
    expect(body.text).toMatchObject({ format: { type: 'json_schema', strict: true } });
  });

  it('places only submitted text in the Anthropic user message', () => {
    const body = buildAnthropicRequestBody(
      'claude-sonnet-4-6',
      instructions,
      selectedText,
      explanationSchema(),
      'low'
    );

    expect(body.system).toBe(instructions);
    expect(body.messages).toEqual([{
      role: 'user',
      content: [{ type: 'text', text: selectedText }]
    }]);
    expect(JSON.stringify(body)).not.toContain('clipboard history');
    expect(body.output_config).toMatchObject({
      effort: 'low',
      format: { type: 'json_schema' }
    });
  });

  it('requires the requested rewrite variants in structured output', () => {
    const request: RewriteRequest = {
      text: selectedText,
      sourceLanguage: 'en',
      targetLanguage: 'en',
      kind: 'translation',
      operation: 'rewrite',
      englishVariety: 'american',
      domain: 'technical',
      modality: 'written',
      function: 'general',
      formality: 'preserve',
      voice: 'preserve',
      stance: 'preserve',
      length: 'preserve',
      perspective: 'preserve',
      rhetoricalMode: 'preserve',
      preserveFormatting: true,
      includeChangeNotes: true
    };
    const schema = rewriteSchema(request) as {
      properties: { variants: { minItems: number; maxItems: number; items: {
        required: string[]
      } } };
    };
    expect(schema.properties.variants.minItems).toBe(REWRITE_VARIANT_IDS.length);
    expect(schema.properties.variants.maxItems).toBe(REWRITE_VARIANT_IDS.length);
    expect(schema.properties.variants.items.required).toContain('changeNote');
  });
});

describe('language-model provider contracts', () => {
  const explanationRequest: TranslationRequest = {
    text: selectedText,
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    kind: 'translation',
    operation: 'explain',
    explanationLanguage: 'bilingual'
  };

  it('normalizes an OpenAI structured explanation response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ content: [{
        type: 'output_text',
        text: JSON.stringify({
          kind: 'translation', translatedText: '설명', alternatives: ['해설'], note: 'Nuance'
        })
      }] }]
    }), { status: 200 }));
    const result = await new OpenAIProvider('test-key', 'gpt-5.4', 'low', 1)
      .explain(explanationRequest, new AbortController().signal);
    expect(result).toMatchObject({
      kind: 'translation', providerId: 'openai', sourceText: selectedText,
      translatedText: '설명'
    });
  });

  it('normalizes an Anthropic structured explanation response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      content: [{
        type: 'text',
        text: JSON.stringify({
          kind: 'translation', translatedText: '설명', alternatives: [], note: 'Nuance'
        })
      }]
    }), { status: 200 }));
    const result = await new AnthropicProvider('test-key', 'claude-sonnet-4-6', 'low', 1)
      .explain(explanationRequest, new AbortController().signal);
    expect(result).toMatchObject({
      kind: 'translation', providerId: 'anthropic', sourceText: selectedText,
      translatedText: '설명'
    });
  });

  it('surfaces OpenAI refusals without treating them as output', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ content: [{ type: 'refusal', refusal: 'Cannot comply.' }] }]
    }), { status: 200 }));
    await expect(new OpenAIProvider('test-key', 'gpt-5.4', 'low', 1)
      .explain(explanationRequest, new AbortController().signal))
      .rejects.toThrow('OpenAI declined the request');
  });

  it('rejects malformed Anthropic structured output', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: '{not-json' }]
    }), { status: 200 }));
    await expect(new AnthropicProvider('test-key', 'claude-sonnet-4-6', 'low', 1)
      .explain(explanationRequest, new AbortController().signal))
      .rejects.toThrow('Anthropic returned malformed structured output');
  });

  it('maps authentication errors to the correct provider key action', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      error: { message: 'invalid key' }
    }), { status: 401 }));
    await expect(new OpenAIProvider('bad', 'gpt-5.4', 'low', 1)
      .explain(explanationRequest, new AbortController().signal))
      .rejects.toMatchObject({ action: 'setOpenAIKey', status: 401 });
  });

  it('maps unsupported OpenAI models to model configuration', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      error: { message: 'model not found' }
    }), { status: 404 }));
    await expect(new OpenAIProvider('test-key', 'retired-model', 'low', 1)
      .explain(explanationRequest, new AbortController().signal))
      .rejects.toMatchObject({ action: 'configureOpenAIModel', status: 404 });
  });

  it('retries an Anthropic rate limit only within Anthropic', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
        status: 429,
        headers: { 'retry-after': '0' }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: [{
        type: 'text',
        text: JSON.stringify({
          kind: 'translation', translatedText: 'Explanation', alternatives: [], note: ''
        })
      }] }), { status: 200 }));
    await new AnthropicProvider('test-key', 'claude-sonnet-4-6', 'low', 2)
      .explain(explanationRequest, new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(
      (call) => new URL(String(call[0])).hostname === 'api.anthropic.com'
    ))
      .toBe(true);
  });

  it.each([
    ['OpenAI', () => new OpenAIProvider('test-key', 'gpt-5.4', 'low', 1), 429],
    ['Anthropic', () => new AnthropicProvider('test-key', 'claude-sonnet-4-6', 'low', 1), 503]
  ] as const)('normalizes exhausted temporary %s errors as retryable', async (
    _name,
    createProvider,
    status
  ) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ error: { message: 'temporarily unavailable' } }),
      { status }
    ));
    await expect(createProvider().explain(explanationRequest, new AbortController().signal))
      .rejects.toMatchObject({ retryable: true, status });
  });

  it('normalizes a final OpenAI network failure as retryable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'));
    await expect(new OpenAIProvider('test-key', 'gpt-5.4', 'low', 1)
      .explain(explanationRequest, new AbortController().signal))
      .rejects.toMatchObject({ retryable: true, action: 'configureOpenAIModel' });
  });
});
