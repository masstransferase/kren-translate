export class ProviderError extends Error {
  public constructor(
    message: string,
    public readonly action?:
      | 'setGeminiKey'
      | 'setGeminiProKey'
      | 'setOpenAIKey'
      | 'setAnthropicKey'
      | 'setGoogleCloudTranslationKey'
      | 'setMerriamWebsterCollegiateKey'
      | 'setMerriamWebsterMedicalKey'
      | 'setMerriamWebsterThesaurusKey'
      | 'setDictionaryKey'
      | 'configureGeminiModel'
      | 'configureGeminiProModel'
      | 'configureOpenAIModel'
      | 'configureAnthropicModel',
    public readonly retryable = false,
    public readonly status?: number,
    public readonly reason?: 'structuredOutput'
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
