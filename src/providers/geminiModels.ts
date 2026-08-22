import { ProviderError } from '../errors.js';

interface GeminiModelsPayload {
  models?: unknown;
  nextPageToken?: unknown;
  error?: { message?: unknown };
}

export interface GeminiModelOption {
  id: string;
  displayName: string;
}

/**
 * The one place the default Gemini model is written. It used to be a literal repeated in
 * eight source sites and two package.json settings, so a model upgrade meant ten edits and
 * any one of them could be missed.
 *
 * This is a default, never a constraint: every caller reads a user setting and falls back to
 * this only when the user has not chosen. The model field stays editable everywhere.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

export const DEFAULT_PRO_MODELS: GeminiModelOption[] = [
  { id: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro Preview' },
  { id: 'gemini-3.6-flash', displayName: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.5-flash', displayName: 'Gemini 3.5 Flash' }
];

export async function listGeminiProModels(
  apiKey: string,
  signal: AbortSignal
): Promise<GeminiModelOption[]> {
  const models: GeminiModelOption[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'x-goog-api-key': apiKey },
        signal
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ProviderError('Gemini model discovery could not reach Google.', 'setGeminiProKey');
    }

    const payload = (await response.json().catch(() => ({}))) as GeminiModelsPayload;
    if (!response.ok) {
      const detail = typeof payload.error?.message === 'string'
        ? ` ${payload.error.message}`
        : '';
      throw new ProviderError(
        `Gemini model discovery failed (${response.status}).${detail}`,
        response.status === 401 || response.status === 403 ? 'setGeminiProKey' : undefined
      );
    }

    if (Array.isArray(payload.models)) {
      for (const value of payload.models) {
        const option = normalizeProModel(value);
        if (option) models.push(option);
      }
    }
    pageToken = typeof payload.nextPageToken === 'string' && payload.nextPageToken
      ? payload.nextPageToken
      : undefined;
  } while (pageToken);

  return deduplicateModels([...DEFAULT_PRO_MODELS, ...models]);
}

export function normalizeProModel(value: unknown): GeminiModelOption | undefined {
  if (!isRecord(value)) return undefined;
  const rawName = stringValue(value.name) ?? stringValue(value.baseModelId);
  if (!rawName) return undefined;
  const id = rawName.replace(/^models\//u, '');
  const methods = Array.isArray(value.supportedGenerationMethods)
    ? value.supportedGenerationMethods
    : Array.isArray(value.supportedActions)
      ? value.supportedActions
      : [];
  const supportsGenerate = methods.some((method) =>
    typeof method === 'string' && method.toLocaleLowerCase('en-US') === 'generatecontent'
  );
  if (!supportsGenerate || !/(?:^|-)pro(?:-|$)/iu.test(id)) return undefined;
  if (/(?:tts|live|image|embedding|computer-use)/iu.test(id)) return undefined;
  return {
    id,
    displayName: stringValue(value.displayName) ?? id
  };
}

function deduplicateModels(values: GeminiModelOption[]): GeminiModelOption[] {
  const byId = new Map<string, GeminiModelOption>();
  for (const value of values) byId.set(value.id, value);
  return [...byId.values()].sort((left, right) => {
    const recommended = DEFAULT_PRO_MODELS.findIndex((item) => item.id === left.id) -
      DEFAULT_PRO_MODELS.findIndex((item) => item.id === right.id);
    const leftKnown = DEFAULT_PRO_MODELS.some((item) => item.id === left.id);
    const rightKnown = DEFAULT_PRO_MODELS.some((item) => item.id === right.id);
    if (leftKnown && rightKnown) return recommended;
    if (leftKnown) return -1;
    if (rightKnown) return 1;
    return left.displayName.localeCompare(right.displayName);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
