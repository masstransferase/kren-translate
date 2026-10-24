import * as gemini from '../../src/providers/gemini.js';
import * as openai from '../../src/providers/openai.js';
import * as anthropic from '../../src/providers/anthropic.js';
import * as compatible from '../../src/providers/openAICompatible.js';
import * as structured from '../../src/providers/structuredJsonTransport.js';
import { providerHttpError } from '../../src/providers/httpError.js';
import type { RewriteRequest, TranslationRequest } from '../../src/types.js';

export const translation: TranslationRequest = { kind: 'translation', operation: 'translate', text: 'Only this selected text.\n`code`', sourceLanguage: 'auto', targetLanguage: 'ko' };
export const rewrite: RewriteRequest = { ...translation, operation: 'rewrite', kind: 'translation', modality: 'written', function: 'general', englishVariety: 'american', domain: 'general', formality: 'preserve', voice: 'preserve', stance: 'preserve', length: 'preserve', perspective: 'preserve', rhetoricalMode: 'preserve', preserveFormatting: true, includeChangeNotes: false };
export const optionalSchema = { type: 'object', additionalProperties: false, required: ['answer'], properties: { answer: { type: 'string' }, note: { type: 'string', enum: ['one', 'two'] }, nested: { type: 'object', required: ['count'], properties: { count: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } } } }, choice: { anyOf: [{ const: 1 }, { type: 'string' }] } } };
export const providers = ['gemini', 'openai', 'anthropic', 'groq', 'cloudflare'] as const;
export const models = { gemini: 'gemini-3.8-flash', openai: 'gpt-5.1-mini', anthropic: 'claude-sonnet-4-6', groq: 'openai/gpt-oss-120b', cloudflare: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' };

function outcome(run: () => unknown): unknown {
  try {
    const result = run();
    if (result && typeof result === 'object' && 'createdAt' in result) return { ...result, createdAt: '<ISO timestamp>' };
    return result;
  } catch (error) {
    const e = error as Error & { action?: string; retryable?: boolean; status?: number; reason?: string };
    return { name: e.name, message: e.message, action: e.action, retryable: e.retryable, status: e.status, reason: e.reason };
  }
}

export function requestOutputs(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const signal = new AbortController().signal;
  const requests: Array<TranslationRequest | RewriteRequest> = [translation,
    { ...translation, operation: 'explain' },
    { ...translation, operation: 'explain', sourceLanguage: 'en-US', targetLanguage: 'en', explanationLanguage: 'sameAsSource', domain: 'scientific' },
    { ...translation, operation: 'explain', sourceLanguage: 'ko', explanationLanguage: 'en-GB' },
    rewrite, { ...rewrite, operation: 'rewriteMinimal', includeChangeNotes: true },
    { ...rewrite, operation: 'rewriteFull', preserveFormatting: false, sourceLanguage: 'ko', englishVariety: 'sameAsSource', modality: 'spoken', domain: 'scientific', length: 'shorter' as RewriteRequest['length'] }];
  for (const [index, request] of requests.entries()) {
    const isRewrite = request.operation.startsWith('rewrite');
    const instruction = isRewrite ? gemini.rewriteSystemInstruction(request as RewriteRequest) : gemini.systemInstruction(request as TranslationRequest);
    const schema = isRewrite ? openai.rewriteSchema(request as RewriteRequest) : openai.explanationSchema();
    out[`instruction:${index}`] = instruction;
    for (const provider of providers) {
      const body = provider === 'gemini' ? (isRewrite ? gemini.buildGeminiRewriteRequestBody(request as RewriteRequest) : gemini.buildGeminiRequestBody(request as TranslationRequest))
        : provider === 'openai' ? openai.buildOpenAIRequestBody(models[provider], instruction, request.text, 'kren_feature', schema)
        : provider === 'anthropic' ? anthropic.buildAnthropicRequestBody(models[provider], instruction, request.text, schema)
        : JSON.parse(compatible.compatibleRequestInit({ provider, model: models[provider], apiKey: '', thinkingOrEffort: 'auto', schema, schemaName: 'kren_feature' }, instruction, request.text, signal).body as string);
      out[`body:${provider}:${index}`] = JSON.stringify(body);
    }
  }
  for (const provider of providers) for (const thinkingOrEffort of ['auto', 'none', 'minimal', 'low', 'medium', 'high'] as const) {
    const call = { provider, model: models[provider], apiKey: '', thinkingOrEffort, schema: optionalSchema, schemaName: 'kren_optional' };
    out[`structured:${provider}:${thinkingOrEffort}`] = structured.structuredJsonRequestInit(call, { instruction: 'Fixed instruction.', input: 'Selected input.' }, signal).body;
  }
  for (const model of ['qwen/qwen3.8-27b', 'unknown-model']) out[`compatible:${model}`] = compatible.compatibleRequestInit({ provider: 'groq', model, apiKey: '', thinkingOrEffort: 'high', schema: optionalSchema, schemaName: 'kren_optional' }, 'Fixed.', 'Input.', signal).body;
  const text = '{"answer":"yes"}';
  const envelopes: Record<string, unknown> = { gemini: { candidates: [{ content: { parts: [{ text: '  ' }, { text }, { text: '\n' }] } }] }, openai: { output: [{ content: [{ type: 'output_text', text: ` ${text} ` }] }] }, anthropic: { content: [{ type: 'text', text: ` ${text} ` }] }, groq: { choices: [{ message: { content: text } }] }, cloudflare: { choices: [{ message: { content: text } }] } };
  for (const provider of providers) {
    for (const [name, envelope] of Object.entries({ valid: envelopes[provider], empty: {}, null: null, wrong: { content: 'wrong', candidates: [], output: [], choices: [] } })) out[`text:${provider}:${name}`] = structured.structuredJsonOutputText(provider, envelope) ?? null;
    for (const status of [400, 401, 403, 404, 429, 500, 503]) out[`http:${provider}:${status}`] = providerHttpError(structured.structuredJsonProviderName(provider), status);
    for (const [name, value] of Object.entries({ valid: { translatedText: ' Answer ', alternatives: [' one ', '', 4, 'two', 'three', 'four'], note: ' Note ' }, missing: {}, malformed: null })) out[`translation:${provider}:${name}`] = outcome(() => gemini.normalizeGeminiResult(value, translation, provider));
    for (const [name, value] of Object.entries({ valid: { detectedLanguage: 'en', variants: [{ id: 'full', text: 'Full.' }, { id: 'minimal', text: 'Minimal.', changeNote: ' Changed. ' }] }, missing: {}, invalidLanguage: { detectedLanguage: '?', variants: [] }, missingVariant: { detectedLanguage: 'en', variants: [{ id: 'minimal', text: 'Minimal.' }] } })) out[`rewrite:${provider}:${name}`] = outcome(() => gemini.normalizeGeminiRewriteResult(value, rewrite, provider, '<ISO timestamp>'));
  }
  for (const provider of ['groq', 'cloudflare'] as const) for (const [name, content] of Object.entries({ valid: '{"answer":"yes"}', optionalNull: '{"answer":"yes","note":null}', missing: '{}', malformed: '{', extra: '{"answer":"yes","extra":true}' })) out[`validation:${provider}:${name}`] = outcome(() => compatible.validatedCompatibleText({ provider, model: models[provider], schema: optionalSchema }, { choices: [{ message: { content } }] }));
  for (const provider of ['groq', 'cloudflare'] as const) {
    out[`refusal:${provider}`] = outcome(() => compatible.validatedCompatibleText({ provider, model: models[provider], schema: optionalSchema }, { choices: [{ message: { refusal: 'Private free text.' } }] }));
    out[`envelope:${provider}`] = outcome(() => compatible.validatedCompatibleText({ provider, model: models[provider], schema: optionalSchema }, {}));
  }
  for (const raw of ['{}', '```json\n{"translatedText":"Yes"}\n```', '{', '[]', 'null']) out[`parse:${raw}`] = outcome(() => gemini.parseJson(raw));
  // JSON serialization fixes absent optional error fields just as the recorded fixtures do.
  return JSON.parse(JSON.stringify(out));
}

/** Exercise the real provider transport callbacks as well as the exported pure helpers. */
export async function answerOutputs(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const originalFetch = globalThis.fetch;
  try {
    for (const provider of providers) for (const scenario of ['valid', 'refused', 'malformedEnvelope', 'missingRequired', 'malformedJson'] as const) {
      const value = scenario === 'missingRequired' ? {} : { kind: 'translation', translatedText: ' Yes ', alternatives: [], note: '' };
      const text = scenario === 'malformedJson' ? '{' : JSON.stringify(value);
      const envelope = scenario === 'malformedEnvelope' ? {} : provider === 'gemini' ? (scenario === 'refused' ? { promptFeedback: { blockReason: 'SAFETY' } } : { candidates: [{ content: { parts: [{ text }] } }] })
        : provider === 'openai' ? { output: [{ content: [scenario === 'refused' ? { type: 'refusal', refusal: 'Private.' } : { type: 'output_text', text }] }] }
        : provider === 'anthropic' ? { ...(scenario === 'refused' ? { stop_reason: 'refusal' } : {}), content: [{ type: 'text', text }] }
        : { choices: [{ message: scenario === 'refused' ? { refusal: 'Private.' } : { content: text } }] };
      let count = 0;
      globalThis.fetch = async (_url, init) => { out[`sent:${provider}:${scenario}`] = init?.body; count++; return new Response(JSON.stringify(envelope)); };
      const instance = provider === 'gemini' ? new gemini.GeminiProvider('', models[provider], 'configureGeminiModel', undefined, 1)
        : provider === 'openai' ? new openai.OpenAIProvider('', models[provider], 'auto', 1)
        : provider === 'anthropic' ? new anthropic.AnthropicProvider('', models[provider], 'low', 1)
        : new openai.CompatibleLanguageModelProvider(provider, '', models[provider], 'auto', 1, 'test-account');
      try { const result = await instance.explain({ ...translation, operation: 'explain' }, new AbortController().signal); out[`answer:${provider}:${scenario}`] = { ...result, createdAt: '<ISO timestamp>' }; }
      catch (error) { out[`answer:${provider}:${scenario}`] = outcome(() => { throw error; }); }
      out[`count:${provider}:${scenario}`] = count;
    }
  } finally { globalThis.fetch = originalFetch; }
  return JSON.parse(JSON.stringify(out));
}
