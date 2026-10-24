export { providerHttpError, providerIdentifier } from '@kren/core/provider-requests';

export function isGeminiOverloaded(status: number, payload?: unknown): boolean {
  return status === 503 || (payload as { error?: { status?: unknown } } | undefined)?.error?.status === 'UNAVAILABLE';
}
