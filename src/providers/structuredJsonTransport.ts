import { buildStructuredJsonBody, structuredJsonOutputText } from '@kren/core/provider-requests';
export { structuredJsonOutputText };
import { normalizeGeminiModel } from './geminiModels.js';
import { requestWithRetry } from '../requestCenter.js';

import type { LanguageModelRoutingProvider as UserDictionaryProvider } from '../languageModelRouting.js';
import { compatibleBaseUrl, compatibleFailure, validatedCompatibleText } from './openAICompatible.js';
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

export function structuredJsonRequestInit(call: StructuredJsonCall, request: StructuredJsonRequest, signal: AbortSignal): RequestInit {
 const { provider, model, thinkingOrEffort, schema, schemaName } = call;
 const headers: Record<string, string> = provider === 'gemini' ? { 'Content-Type': 'application/json', 'x-goog-api-key': call.apiKey }
  : provider === 'anthropic' ? { 'Content-Type': 'application/json', 'x-api-key': call.apiKey, 'anthropic-version': '2023-06-01' }
  : { 'Content-Type': 'application/json', Authorization: `Bearer ${call.apiKey}` };
 return { method: 'POST', headers, body: JSON.stringify(buildStructuredJsonBody({ provider, model, thinkingOrEffort, schema, schemaName }, request)), signal };
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
