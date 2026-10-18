/** HTTP failures use only KREN wording. Provider bodies can contain credentials. */
export function providerHttpError(provider: string, status: number): string {
  if (status === 401 || status === 403) return `The ${provider} API key was rejected (${status}). Set a valid key.`;
  if (status === 429 && (provider === 'Groq' || provider === 'Cloudflare')) return `${provider} request failed (${status}). The free daily or per-minute limit was reached. Try again later.`;
  if (status === 429) return `${provider} request failed (${status}). The usage limit was reached. Try again later or check your quota.`;
  if (status >= 500) return `${provider} request failed (${status}). The service is temporarily unavailable. Try again later.`;
  return `${provider} request failed (${status}). Check the provider settings.`;
}

/** Only bounded structured identifiers may supplement fixed error wording. */
export function providerIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,160}$/u.test(value) ? value : undefined;
}

export function isGeminiOverloaded(status: number, payload?: unknown): boolean {
  return status === 503 || (payload as { error?: { status?: unknown } } | undefined)?.error?.status === 'UNAVAILABLE';
}
