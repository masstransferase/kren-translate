import type { UserDictionaryProvider } from '@kren/core/user-dictionary';
import type { UserDictionaryThinkingOrEffort } from '../userDictionary/settings.js';

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
  provider: UserDictionaryProvider;
  model: string;
  thinkingOrEffort: UserDictionaryThinkingOrEffort;
  apiKey: string;
  /**
   * Sent to OpenAI and Anthropic only. Gemini rejects it, so its shape has to be stated
   * in the instruction; see the comment on the Gemini branch below.
   */
  schema: Record<string, unknown>;
  /** OpenAI requires a name for the schema. Lower case with underscores. */
  schemaName: string;
}

export function structuredJsonUrl(provider: UserDictionaryProvider, model: string): string {
  if (provider === 'gemini') {
    const modelId = model.replace(/^models\//u, '');
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
  }
  return provider === 'openai'
    ? 'https://api.openai.com/v1/responses'
    : 'https://api.anthropic.com/v1/messages';
}

export function structuredJsonRequestInit(
  call: StructuredJsonCall,
  request: StructuredJsonRequest,
  signal: AbortSignal
): RequestInit {
  const { provider, model, thinkingOrEffort, apiKey, schema, schemaName } = call;
  if (provider === 'gemini') {
    const thinking = thinkingOrEffort === 'auto' || thinkingOrEffort === 'none'
      ? {}
      : { thinkingConfig: { thinkingLevel: thinkingOrEffort } };
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.instruction }] },
        contents: [{ role: 'user', parts: [{ text: request.input }] }],
        // No schema field. Gemini's structured-output schema is an OpenAPI subset and
        // rejects `additionalProperties`, which the schemas here set to false because
        // OpenAI's strict mode requires it. Sending the schema to Gemini returns 400 on
        // every model, which is what "failed (400)" meant in testing.
        //
        // The instruction states the required shape instead, exactly as the rewrite
        // provider in src/providers/gemini.ts does, and KREN validates the parsed result
        // afterwards. Validation is the real gate in either case: a provider-declared
        // schema is a hint, and a malformed response still has to be caught locally.
        generationConfig: {
          temperature: 0.2,
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
  return provider === 'gemini' ? 'Gemini' : provider === 'openai' ? 'OpenAI' : 'Anthropic';
}

export function structuredJsonConfigureAction(provider: UserDictionaryProvider):
  'configureGeminiModel' | 'configureOpenAIModel' | 'configureAnthropicModel' {
  return provider === 'gemini'
    ? 'configureGeminiModel'
    : provider === 'openai'
      ? 'configureOpenAIModel'
      : 'configureAnthropicModel';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
