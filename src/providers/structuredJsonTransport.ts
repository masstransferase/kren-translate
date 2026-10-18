import { normalizeGeminiModel } from './geminiModels.js';
import { requestWithRetry } from '../requestCenter.js';
import { configuredThinkingLevel } from './gemini.js';
import type { LanguageModelRoutingProvider as UserDictionaryProvider } from '../languageModelRouting.js';
import { compatibleBaseUrl, compatibleRequestInit, compatibleFailure, validatedCompatibleText } from './openAICompatible.js';
import type { UserDictionaryThinkingOrEffort } from '../userDictionary/settings.js';
import { ProviderError, attributeProviderError } from '../errors.js';
import { providerHttpError } from './httpError.js';

/** Bounded HTTP recovery finishes before callers convert the final failure to an outcome. */
export async function requestStructuredJson(
  call: StructuredJsonCall, request: StructuredJsonRequest, signal: AbortSignal,
  fetcher: typeof fetch = fetch, maxAttempts = 1, decode?: (text: string) => unknown
): Promise<unknown> {
  try { return await requestStructuredJsonOnce(call, request, signal, fetcher, maxAttempts, decode); }
  catch (error) { throw attributeProviderError(error, { ...call, geminiProfile: call.geminiProfile ?? 'standard' }); }
}

async function requestStructuredJsonOnce(
  call: StructuredJsonCall, request: StructuredJsonRequest, signal: AbortSignal,
  fetcher: typeof fetch = fetch, maxAttempts = 1, decode?: (text: string) => unknown
): Promise<unknown> {
  return requestWithRetry({
    request: { feature: call.feature ?? call.schemaName.replace(/^kren_/u, ''), provider: call.provider,
      model: call.model, geminiProfile: call.geminiProfile },
    signal, maxAttempts,
    send: () => fetcher(structuredJsonUrl(call.provider, call.model, call.accountId), structuredJsonRequestInit(call, request, signal)),
    failure: ({ status, retryable }) => new ProviderError(status === undefined
      ? `${structuredJsonProviderName(call.provider)} could not be reached.`
      : providerHttpError(structuredJsonProviderName(call.provider), status), structuredJsonConfigureAction(call.provider), retryable, status),
    refused: () => call.provider === 'groq' || call.provider === 'cloudflare' ? compatibleFailure(call.provider, 'refused')
      : new ProviderError('The provider returned no structured result.', undefined, false, undefined, 'refused'),
    decode: envelope => {
      const text = call.provider === 'groq' || call.provider === 'cloudflare'
        ? validatedCompatibleText({ provider: call.provider, model: call.model, schema: call.schema }, envelope) : structuredJsonOutputText(call.provider, envelope);
      if (!text) throw new ProviderError('The provider returned no structured result.', undefined, false, undefined, 'structuredOutput');
      return decode ? decode(text) : text;
    }
  });
}

/**
 * The three-provider plumbing for asking a language model for one JSON object: where to
 * post, what the body looks like, and where the text sits in each provider's reply.
 *
 * It lives here rather than beside the User Dictionary because Smart Grammar Check needs
 * exactly the same three shapes. Two copies of a request body is the condition that lets
 * one provider quietly stop working in one feature and keep working in the other.
 */

export interface StructuredJsonRequest {
  /** The system instruction. It must state the required response shape in words. */
  instruction: string;
  /** The user content. Nothing else about the document is ever sent. */
  input: string;
}

export interface StructuredJsonCall {
  geminiProfile?: 'standard' | 'pro';
  feature?: string;
  provider: UserDictionaryProvider;
  model: string;
  thinkingOrEffort: UserDictionaryThinkingOrEffort;
  apiKey: string;
  accountId?: string;
  /**
   * Sent to OpenAI and Anthropic only. Gemini rejects it, so its shape has to be stated
   * in the instruction; see the comment on the Gemini branch below.
   */
  schema: Record<string, unknown>;
  /** OpenAI requires a name for the schema. Lower case with underscores. */
  schemaName: string;
}

export function structuredJsonUrl(provider: UserDictionaryProvider, model: string, accountId?: string): string {
  if (provider === 'groq' || provider === 'cloudflare') return `${compatibleBaseUrl(provider, accountId)}/chat/completions`;
  if (provider === 'gemini') {
    const modelId = normalizeGeminiModel(model).replace(/^models\//u, '');
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
  }
  return provider === 'openai'
    ? 'https://api.openai.com/v1/responses'
    : 'https://api.anthropic.com/v1/messages';
}

import { schemaInstruction } from './structuredJsonShape.js';

export function structuredJsonRequestInit(
  call: StructuredJsonCall,
  request: StructuredJsonRequest,
  signal: AbortSignal
): RequestInit {
  const { provider, model, thinkingOrEffort, apiKey, schema, schemaName } = call;
  if (provider === 'groq' || provider === 'cloudflare') return compatibleRequestInit({ ...call, provider }, request.instruction, request.input, signal);
  if (provider === 'gemini') {
    const level = thinkingOrEffort === 'none' ? undefined : configuredThinkingLevel(model, thinkingOrEffort);
    const thinking = level === undefined
      ? {}
      : { thinkingConfig: { thinkingLevel: level } };
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        /*
         * Gemini is told the shape in words, and is sent no schema at all.
         *
         * Two attempts have now been made at sending one, and both failed with 400 in the
         * owner's hands. Gemini's structured-output schema is an OpenAPI subset with two
         * separate incompatibilities here: it rejects `additionalProperties`, which every
         * schema sets to false because OpenAI's strict mode requires it, and it accepts
         * `enum` only on a string, while `schemaVersion` is `{ type: 'number', const: 1 }`
         * and a const has to become an enum to be expressed at all. Removing the first left
         * the second, which is what "failed (400)" meant on 2026-09-01.
         *
         * The original defect was never the missing schema. It was that the instruction
         * claimed to state the shape and did not: the tutor's said "matching the KREN
         * TutorLesson contract" and named no field, so Gemini invented plausible names and
         * every generation came back as a wall of requiredFieldMissing. `schemaInstruction`
         * fixes that, is derived from the same schema object so it cannot drift from it, and
         * cannot be rejected by a provider because it is prose.
         *
         * Validation remains the real gate either way. A provider-declared schema is a hint,
         * and a malformed response still has to be caught locally.
         */
        systemInstruction: {
          parts: [{ text: `${request.instruction}\n\n${schemaInstruction(schema)}` }]
        },
        contents: [{ role: 'user', parts: [{ text: request.input }] }],
        generationConfig: {
          // 2026-10-10: Google deprecates temperature, top_p and top_k; upcoming models reject them.
          responseMimeType: 'application/json',
          ...thinking
        }
      }),
      signal
    };
  }
  if (provider === 'openai') {
    const effort = thinkingOrEffort === 'minimal' ? 'low' : thinkingOrEffort;
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        instructions: request.instruction,
        input: [{ role: 'user', content: [{ type: 'input_text', text: request.input }] }],
        store: false,
        max_output_tokens: 4096,
        text: {
          format: {
            type: 'json_schema',
            name: schemaName,
            strict: true,
            schema
          }
        },
        ...(effort === 'auto' ? {} : { reasoning: { effort } })
      }),
      signal
    };
  }
  const effort = thinkingOrEffort === 'auto'
    ? {}
    : { effort: thinkingOrEffort === 'none' || thinkingOrEffort === 'minimal'
      ? 'low'
      : thinkingOrEffort };
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: request.instruction,
      messages: [{ role: 'user', content: [{ type: 'text', text: request.input }] }],
      output_config: {
        format: { type: 'json_schema', schema },
        ...effort
      }
    }),
    signal
  };
}

export function structuredJsonOutputText(
  provider: UserDictionaryProvider,
  value: unknown
): string | undefined {
  if (!isRecord(value)) return undefined;
  if (provider === 'groq' || provider === 'cloudflare') {
    const choices = value.choices;
    if (!Array.isArray(choices) || !isRecord(choices[0]) || !isRecord(choices[0].message)) return undefined;
    const content = choices[0].message.content;
    return typeof content === 'string' ? content : undefined;
  }
  if (provider === 'gemini') {
    const candidates = value.candidates;
    if (!Array.isArray(candidates)) return undefined;
    const candidate = candidates[0];
    if (!isRecord(candidate) || !isRecord(candidate.content) ||
        !Array.isArray(candidate.content.parts)) return undefined;
    const text = candidate.content.parts
      .flatMap((part) => isRecord(part) && typeof part.text === 'string' ? [part.text] : [])
      .join('')
      .trim();
    return text || undefined;
  }
  if (provider === 'openai') {
    if (!Array.isArray(value.output)) return undefined;
    for (const output of value.output) {
      if (!isRecord(output) || !Array.isArray(output.content)) continue;
      for (const content of output.content) {
        if (isRecord(content) && content.type === 'output_text' &&
            typeof content.text === 'string' && content.text.trim()) return content.text.trim();
      }
    }
    return undefined;
  }
  if (!Array.isArray(value.content)) return undefined;
  const block = value.content.find((item) =>
    isRecord(item) && item.type === 'text' && typeof item.text === 'string'
  );
  return isRecord(block) && typeof block.text === 'string' && block.text.trim()
    ? block.text.trim()
    : undefined;
}

export function structuredJsonProviderName(provider: UserDictionaryProvider): string {
  return provider === 'gemini' ? 'Gemini' : provider === 'openai' ? 'OpenAI' : provider === 'groq' ? 'Groq' : provider === 'cloudflare' ? 'Cloudflare' : 'Anthropic';
}

export function structuredJsonConfigureAction(provider: UserDictionaryProvider):
  'configureGeminiModel' | 'configureOpenAIModel' | 'configureAnthropicModel' | 'configureGroqModel' | 'configureCloudflareModel' {
  if (provider === 'groq') return 'configureGroqModel';
  if (provider === 'cloudflare') return 'configureCloudflareModel';
  return provider === 'gemini'
    ? 'configureGeminiModel'
    : provider === 'openai'
      ? 'configureOpenAIModel'
      : 'configureAnthropicModel';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
