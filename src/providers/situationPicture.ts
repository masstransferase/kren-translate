import { usageTrackedFetch } from '../languageModelUsage.js';
import { providerHttpError } from './httpError.js';
import { geminiErrorMetadata } from './gemini.js';
import { runCloudflareAi, CloudflareAiError, type CloudflareAiResponseMetadata } from './cloudflare.js';
import { TUTOR_DEFAULTS } from '../tutor/defaults.js';
import { CLOUDFLARE_IMAGE_MODEL_DEFAULT, validatedPanelSetting } from '../panelSettings.js';
import {
  buildCloudflarePictureRequest, buildSituationPictureRequest, situationPictureFromResponse, type SituationPictureReference, type SituationPictureStyle
} from '@kren/core/pictures';
/**
 * Intro pictures send only the scene; continuations send the bounded references. The request
 * bodies and the answer reading live in @kren/core; this file makes the calls.
 *
 * `generateContent` takes image options in `generationConfig.imageConfig`. The 1.99.18 build
 * sent them as `responseFormat`, the Interactions API's name, and every request failed with
 * 400 on the owner's machine while a test pinned the wrong shape.
 */
export {
  situationPictureScene, SITUATION_PICTURE_STYLE, SITUATION_PICTURE_ILLUSTRATED_STYLE, CLOUDFLARE_PICTURE_PROMPT_LIMIT,
  buildCloudflarePictureRequest, buildSituationPictureRequest, situationPictureFromResponse
} from '@kren/core/pictures';
export type { SituationPictureReference, SituationPictureStyle } from '@kren/core/pictures';

export async function generateCloudflareSituationPicture(scene: string, accountId: string, token: string, signal: AbortSignal, reference?: SituationPictureReference, configuredModel: unknown = CLOUDFLARE_IMAGE_MODEL_DEFAULT, style: SituationPictureStyle = 'realistic'): Promise<string> {
  const model = typeof configuredModel === 'string'
    ? validatedPanelSetting('tutor.cloudflareImageModel', configuredModel) ?? CLOUDFLARE_IMAGE_MODEL_DEFAULT
    : CLOUDFLARE_IMAGE_MODEL_DEFAULT;
  const request = buildCloudflarePictureRequest(scene, reference, style);
  let body: object | FormData = request;
  if (model === '@cf/black-forest-labs/flux-2-klein-4b') {
    const form = new FormData();
    form.set('prompt', request.prompt);
    form.set('width', '1024');
    form.set('height', '1024');
    body = form;
  }
  const metadata: CloudflareAiResponseMetadata = {};
  const result = await runCloudflareAi(accountId, token, String(model),
    body, signal, 'picture', metadata) as { image?: unknown } | undefined;
  // Reuse the existing image envelope validation and webview decode acknowledgement.
  const image = situationPictureFromResponse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: result?.image } }] } }] });
  if (!image) throw new CloudflareAiError('Cloudflare situation picture response had no usable image.', false, false, metadata.status, metadata.codes);
  return image;
}

/**
 * 2026-11-04 (V16, VS4TUTOR): a Gemini picture request had no time limit of its own, so a picture the panel no
 * longer wanted could run until the server gave up. It now stops after 120,000 ms, combined with the caller's signal.
 */
export const SITUATION_PICTURE_GEMINI_LIMIT_MS = 120_000;

export async function generateSituationPicture(scene: string, apiKey: string, signal: AbortSignal, reference?: SituationPictureReference, configuredModel: unknown = TUTOR_DEFAULTS.configuration['tutor.imageModel'], style: SituationPictureStyle = 'realistic'): Promise<string> {
  const validated = typeof configuredModel === 'string'
    ? validatedPanelSetting('tutor.imageModel', configuredModel) : undefined;
  const model = (typeof validated === 'string'
    ? validated : TUTOR_DEFAULTS.configuration['tutor.imageModel']).replace(/^models\//u, '');
  const limited = new AbortController();
  let timedOut = false;
  const cancel = () => limited.abort();
  if (signal.aborted) limited.abort(); else signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; limited.abort(); }, SITUATION_PICTURE_GEMINI_LIMIT_MS);
  try {
    const response = await usageTrackedFetch({ feature: 'picture', provider: 'gemini', model, geminiProfile: 'pro' })(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(buildSituationPictureRequest(scene, reference, style)),
        signal: limited.signal
      }
    );
    if (!response.ok) {
      // 2026-10-10: attach Google's validated quota identifiers (never its message text) so a 429
      // says which limit refused the picture.
      const payload = await response.json().catch(() => undefined);
      throw new Error(providerHttpError('Gemini', response.status) + geminiErrorMetadata(payload));
    }
    const image = situationPictureFromResponse(await response.json());
    if (!image) throw new Error('Gemini situation picture response had no usable image.');
    return image;
  } catch (error) {
    // Only the limit is rewritten; the caller's own cancellation keeps the abort error it always had.
    if (timedOut && !signal.aborted) throw new Error(`Gemini situation picture request timed out after ${SITUATION_PICTURE_GEMINI_LIMIT_MS / 1000} seconds.`);
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}
