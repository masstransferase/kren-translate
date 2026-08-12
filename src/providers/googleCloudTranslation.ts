import { countCloudTranslationCharacters } from '../cloudTranslationUsage.js';
import { ProviderError } from '../errors.js';
import type { TranslationProvider, TranslationRequest, TranslationResult } from '../types.js';

interface GoogleTranslationPayload {
  data?: { translations?: Array<{ translatedText?: unknown; detectedSourceLanguage?: unknown }> };
  error?: { message?: unknown };
}

export class GoogleCloudTranslationProvider implements TranslationProvider {
  public readonly id = 'googleCloudTranslation' as const;

  public constructor(
    private readonly apiKey: string,
    private readonly reserveUsage: (characters: number) => Promise<unknown>
  ) {}

  public async translate(
    request: TranslationRequest,
    signal: AbortSignal
  ): Promise<TranslationResult> {
    signal.throwIfAborted();
    // Reserve before the request. A failed/ambiguous request remains counted so
    // the local safety limit can never undercount what Google may have processed.
    await this.reserveUsage(countCloudTranslationCharacters(request.text));

    const url = new URL('https://translation.googleapis.com/language/translate/v2');
    url.searchParams.set('key', this.apiKey);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildGoogleCloudTranslationRequestBody(request)),
        signal
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ProviderError('Google Cloud Translation could not be reached.');
    }

    const payload = (await response.json().catch(() => ({}))) as GoogleTranslationPayload;
    if (!response.ok) {
      const detail = typeof payload.error?.message === 'string' ? ` ${payload.error.message}` : '';
      const action = response.status === 401 || response.status === 403
        ? 'setGoogleCloudTranslationKey'
        : undefined;
      throw new ProviderError(`Google Cloud Translation request failed (${response.status}).${detail}`, action);
    }

    const translated = payload.data?.translations?.[0]?.translatedText;
    if (typeof translated !== 'string' || !translated.trim()) {
      throw new ProviderError('Google Cloud Translation returned no translation.');
    }

    const detectedSourceLanguage = payload.data?.translations?.[0]?.detectedSourceLanguage;
    return {
      kind: 'translation',
      providerId: this.id,
      sourceText: request.text,
      sourceLanguage: typeof detectedSourceLanguage === 'string'
        ? detectedSourceLanguage
        : request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      translatedText: decodeGoogleTranslationHtmlEntities(translated.trim()),
      createdAt: new Date().toISOString()
    };
  }
}

export function buildGoogleCloudTranslationRequestBody(request: TranslationRequest): {
  q: string;
  source?: string;
  target: string;
  format: 'text';
} {
  const body: {
    q: string;
    source?: string;
    target: string;
    format: 'text';
  } = {
    // The exact selected text is the only editor content in this request.
    q: request.text,
    target: request.targetLanguage,
    format: 'text'
  };
  if (request.sourceLanguage !== 'auto') body.source = request.sourceLanguage;
  return body;
}

export function decodeGoogleTranslationHtmlEntities(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|amp|lt|gt|quot|#39);/giu, (match, decimal, hex) => {
    if (decimal || hex) {
      const codePoint = Number.parseInt(decimal ?? hex, decimal ? 10 : 16);
      return isValidUnicodeScalar(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    const named: Record<string, string> = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'"
    };
    return named[match.toLowerCase()] ?? match;
  });
}

function isValidUnicodeScalar(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 0x10FFFF &&
    (value < 0xD800 || value > 0xDFFF);
}
