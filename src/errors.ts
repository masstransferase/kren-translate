import type { LanguageModelRoutingProvider } from './languageModelRouting.js';

export interface ProviderAttempt {
  provider: LanguageModelRoutingProvider;
  model: string;
  geminiProfile: 'standard' | 'pro';
}

export class ProviderError extends Error {
  // 2026-10-12: host-only attribution identifies the actual failed quota pool.
  public attemptedRoute?: ProviderAttempt;
  public constructor(
    message: string,
    public readonly action?:
      | 'setGeminiKey'
      | 'setGeminiProKey'
      | 'setOpenAIKey'
      | 'setAnthropicKey'
      | 'setGroqKey'
      | 'setCloudflareCredentials'
      | 'setGoogleCloudTranslationKey'
      | 'setMerriamWebsterCollegiateKey'
      | 'setMerriamWebsterMedicalKey'
      | 'setMerriamWebsterThesaurusKey'
      | 'setDictionaryKey'
      | 'configureGeminiModel'
      | 'configureGeminiProModel'
      | 'configureOpenAIModel'
      | 'configureAnthropicModel'
      | 'configureGroqModel'
      | 'configureCloudflareModel',
    public readonly retryable = false,
    public readonly status?: number,
    public readonly reason?: 'structuredOutput' | 'quotaExhausted' | 'overloaded' | 'refused'
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

const synthesizedAttempts = new WeakSet<ProviderError>();
export function attributeProviderError(error: unknown, route: ProviderAttempt, synthesized = false): unknown {
  if (error instanceof ProviderError && (!error.attemptedRoute || synthesizedAttempts.has(error))) {
    error.attemptedRoute = { provider: route.provider, model: route.model, geminiProfile: route.geminiProfile };
    if (synthesized) synthesizedAttempts.add(error);
    else synthesizedAttempts.delete(error);
  }
  return error;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
