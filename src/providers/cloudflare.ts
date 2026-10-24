import { missingCredentialError, missingCredentialDetails, missingCredentialMessage } from '../requestCenter.js';
import { usageTrackedFetch } from '../languageModelUsage.js';
import { ProviderError } from '../errors.js';

/** Presence flags name only absent slots and never carry credential values. */
export function cloudflareMissingCredentialError(accountIdPresent: boolean, tokenPresent: boolean) {
  return missingCredentialError('cloudflare', 'standard',
    [...(!accountIdPresent ? ['account ID'] : []), ...(!tokenPresent ? ['API token'] : [])]);
}

/** An account-scoped model search checks both credentials without running inference. */
export async function testCloudflareCredentials(accountId: string, token: string, signal: AbortSignal): Promise<void> {
  if (!accountId || !token) throw cloudflareMissingCredentialError(Boolean(accountId), Boolean(token));
  let response: Response;
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/models/search?per_page=1`, {
      headers: { Authorization: `Bearer ${token}` }, signal
    });
  } catch {
    throw new ProviderError('Cloudflare model discovery could not be reached.');
  }
  if (!response.ok) throw new ProviderError(`Cloudflare model discovery failed (${response.status}). Check the account ID and API token.`, 'setCloudflareCredentials');
  const payload = await response.json().catch(() => undefined) as { success?: unknown; result?: unknown } | undefined;
  if (payload?.success !== true || !Array.isArray(payload.result)) {
    throw new ProviderError('Cloudflare model discovery returned an invalid response. Check the account ID and API token.', 'setCloudflareCredentials');
  }
}
/** Host-only Workers AI boundary. Neither credentials nor remote error text escape it. */
export const CLOUDFLARE_PICTURE_ALLOWANCE = 'Pictures paused: the Cloudflare daily free allowance is used up. The conversation continues without pictures.';
export const CLOUDFLARE_PICTURE_CREDENTIALS = missingCredentialMessage(missingCredentialDetails('cloudflare'));
export const CLOUDFLARE_AUTHENTICATION = 'authentication failed. Check the Cloudflare credentials in KREN menu, Credentials.';

export class CloudflareAiError extends Error {
  public readonly codes: readonly number[];
  public constructor(message: string, public readonly allowance = false, public readonly authentication = false,
    public readonly status?: number, codes: readonly number[] = []) {
    const numericCodes = codes.filter(code => typeof code === 'number' && Number.isFinite(code));
    // 2026-10-10: existing dictation logs use this safe message, so retain only numeric diagnostics.
    super(message + (status === undefined ? '' : ` Cloudflare HTTP ${status}, codes ${numericCodes.join(', ') || 'none'}.`));
    this.codes = numericCodes;
  }
}

export interface CloudflareAiResponseMetadata {
  status?: number;
  codes?: readonly number[];
}

export async function runCloudflareAi(
  accountId: string, token: string, model: string, body: object | FormData, signal: AbortSignal,
  purpose: 'picture' | 'dictation', metadata?: CloudflareAiResponseMetadata
): Promise<unknown> {
  const picture = purpose === 'picture';
  if (!accountId || !token) throw cloudflareMissingCredentialError(Boolean(accountId), Boolean(token));
  let response: Response;
  const multipart = body instanceof FormData;
  try {
    response = await usageTrackedFetch({ feature: purpose, provider: 'cloudflare', model })(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`, {
      method: 'POST', headers: multipart ? { Authorization: `Bearer ${token}` }
        : { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: multipart ? body : JSON.stringify(body), signal
    });
  } catch {
    throw new CloudflareAiError(signal.aborted
      ? `Cloudflare ${purpose} request timed out or was canceled.`
      : `Cloudflare ${purpose} service could not be reached.`);
  }
  const payload = await response.json().catch(() => undefined) as {
    success?: boolean; errors?: Array<{ code?: unknown }>; result?: unknown
  } | undefined;
  const codes = Array.isArray(payload?.errors)
    ? payload.errors.flatMap(error => typeof error?.code === 'number' && Number.isFinite(error.code) ? [error.code] : []) : [];
  if (metadata) { metadata.status = response.status; metadata.codes = codes; }
  // 2026-10-10: recognize only the documented allocation code, never remote message text.
  const allowance = codes.includes(3036);
  if (allowance) throw new CloudflareAiError(picture ? CLOUDFLARE_PICTURE_ALLOWANCE
    : 'Cloudflare dictation paused: the daily free allowance is used up.', true, false, response.status, codes);
  if (response.status === 429) throw new CloudflareAiError('Cloudflare temporarily rate-limited this request. Try again later.', false, false, response.status, codes);
  if (!response.ok || payload?.success === false) {
    const authentication = response.status === 401 || response.status === 403;
    const detail = authentication
      ? CLOUDFLARE_AUTHENTICATION
      : response.status === 400 ? 'request was rejected.'
        : response.status >= 500 ? 'service is unavailable.' : 'request failed.';
    throw new CloudflareAiError(`Cloudflare ${purpose} ${detail}`, false, authentication, response.status, codes);
  }
  return payload?.result;
}

export async function transcribeCloudflareAudio(accountId: string, token: string, audio: Uint8Array, signal: AbortSignal): Promise<string> {
  const metadata: CloudflareAiResponseMetadata = {};
  const result = await runCloudflareAi(accountId, token, '@cf/openai/whisper-large-v3-turbo',
    { audio: Buffer.from(audio).toString('base64') }, signal, 'dictation', metadata) as { text?: unknown } | undefined;
  if (typeof result?.text !== 'string' || !result.text.trim()) throw new CloudflareAiError('Cloudflare returned an empty transcript.', false, false, metadata.status, metadata.codes);
  return result.text.trim();
}
