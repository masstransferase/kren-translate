import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildCloudflarePictureRequest, CLOUDFLARE_PICTURE_PROMPT_LIMIT, generateCloudflareSituationPicture, SITUATION_PICTURE_STYLE } from '../src/providers/situationPicture.js';
import { transcribeCloudflareAudio, CloudflareAiError, CLOUDFLARE_PICTURE_ALLOWANCE, CLOUDFLARE_PICTURE_CREDENTIALS } from '../src/providers/cloudflare.js';
import { KREN_SECRET_KEYS, runTutorAudioTranscription, type KrenRuntime } from '../src/operations.js';
import { resolveTutorSpeechRoute } from '../src/tutor/state.js';
import { validatedPanelSetting, PANEL_SETTING_KEYS } from '../src/panelSettings.js';

afterEach(() => vi.unstubAllGlobals());
const signal = () => new AbortController().signal;
function response(result: unknown, status = 200) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(result), { status }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

describe('Cloudflare Workers AI host boundary', () => {
  it('V215 klein sends multipart with exactly prompt, width and height, without a Content-Type header', async () => {
    const fetcher = response({ success: true, result: { image: 'AQIDBA==' } });
    const reference = { picture: 'previous-picture-must-stay-local', turns: [{ speaker: 'learner' as const, text: 'Newest reply ' + 'x'.repeat(3000) }] };
    await expect(generateCloudflareSituationPicture('Scene '.repeat(1000), 'account', 'credential', signal(), reference,
      '@cf/black-forest-labs/flux-2-klein-4b')).resolves.toBe('data:image/jpeg;base64,AQIDBA==');
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/account/ai/run/@cf/black-forest-labs/flux-2-klein-4b');
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    const fields: Array<[string, FormDataEntryValue]> = [];
    form.forEach((value, key) => fields.push([key, value]));
    expect(fields).toEqual([
      ['prompt', buildCloudflarePictureRequest('Scene '.repeat(1000), reference).prompt], ['width', '1024'], ['height', '1024']
    ]);
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer credential');
    expect(String(form.get('prompt')).length).toBeLessThanOrEqual(CLOUDFLARE_PICTURE_PROMPT_LIMIT);
    expect(form.get('prompt')).not.toContain(reference.picture);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each(['other', 123, null])('V215 invalid host model %s falls back to schnell', async model => {
    const fetcher = response({ result: { image: 'AQID' } });
    await generateCloudflareSituationPicture('Cafe.', 'account', 'credential', signal(), undefined, model);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/flux-1-schnell$/u);
    expect(init.body).toBe(JSON.stringify(buildCloudflarePictureRequest('Cafe.')));
  });
  it('V215 Cloudflare Image Model is a separate closed writable choice with the manifest default', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
    const setting = manifest.contributes.configuration.properties['kren.tutor.cloudflareImageModel'];
    expect(setting.enum).toEqual(['@cf/black-forest-labs/flux-1-schnell', '@cf/black-forest-labs/flux-2-klein-4b']);
    expect(setting.default).toBe(setting.enum[0]);
    expect(setting.enumDescriptions).toHaveLength(2);
    expect(PANEL_SETTING_KEYS.has('tutor.cloudflareImageModel')).toBe(true);
    for (const model of setting.enum) expect(validatedPanelSetting('tutor.cloudflareImageModel', model)).toBe(model);
    for (const invalid of ['other', 'gemini-3.1-flash-lite-image', 4, true]) {
      expect(validatedPanelSetting('tutor.cloudflareImageModel', invalid)).toBeUndefined();
    }
    expect(validatedPanelSetting('tutor.imageModel', 'gemini-3.1-flash-lite-image')).toBe('gemini-3.1-flash-lite-image');
  });
  it.each([400, 429, 503])('V215 HTTP %i carries only numeric codes and no remote message', async status => {
    response({ success: false, errors: [{ code: 1234, message: 'REMOTE-TEXT-MUST-NOT-APPEAR' }, { code: '5678' }, { code: 5678 }, null] }, status);
    const error = await generateCloudflareSituationPicture('Cafe.', 'account', 'credential', signal()).catch(error => error as CloudflareAiError);
    expect(error).toBeInstanceOf(CloudflareAiError);
    expect(error).toMatchObject({ status, codes: [1234, 5678] });
    expect((error as CloudflareAiError).message).toContain(`Cloudflare HTTP ${status}, codes 1234, 5678.`);
    expect((error as CloudflareAiError).message).not.toMatch(/REMOTE-TEXT-MUST-NOT-APPEAR|account|credential|Bearer/u);
  });
  it('V215 unusable success carries response status and a network failure keeps safe no-response wording', async () => {
    response({ result: {} });
    await expect(generateCloudflareSituationPicture('Cafe.', 'account', 'credential', signal())).rejects.toMatchObject({ status: 200, codes: [] });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('REMOTE-TEXT-MUST-NOT-APPEAR'); }));
    await expect(generateCloudflareSituationPicture('Cafe.', 'account', 'credential', signal())).rejects.toMatchObject({ status: undefined, codes: [], message: 'Cloudflare picture service could not be reached.' });
  });
  it('V215 all five allowance passages use the dated measured figures', () => {
    const guide = readFileSync('docs/USER_GUIDE.md', 'utf8');
    const privacy = readFileSync('PRIVACY.md', 'utf8');
    const manual = readFileSync('src/resultViewHtml.ts', 'utf8');
    for (const [text, count] of [[guide, 3], [privacy, 1], [manual, 1]] as const) {
      expect(text.match(/173 neurons in a test on 2026-10-10/gu)).toHaveLength(count);
      expect(text.match(/roughly 57 pictures a day/gu)).toHaveLength(count);
      expect(text.match(/Cloudflare does not report FLUX\.2 klein 4B's usage/gu)).toHaveLength(count);
      expect(text).not.toMatch(/about 58|roughly 170/u);
    }
    expect(guide).toMatch(/Picture Provider.*FLUX\.1 schnell.*FLUX\.2 klein 4B.*Image Model/u);
    // 2026-10-10: V216 names the Picture Provider option Cloudflare free models exactly.
    expect(manual).toContain('Choose Cloudflare free models in Picture Provider and FLUX.1 schnell or FLUX.2 klein 4B in Image Model');
  });
  it('FLUX sends exact prompt/steps keys and no previous picture or extra reference fields', async () => {
    const fetcher = response({ success: true, result: { image: 'AQIDBA==' } });
    const reference = { picture: 'data:image/png;base64,UFJFVklPVVM=', turns: [{ speaker: 'learner' as const, text: 'Two teas, please.' }] };
    await expect(generateCloudflareSituationPicture('Cafe scene.', 'account', 'credential', signal(), reference)).resolves.toBe('data:image/jpeg;base64,AQIDBA==');
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/account/ai/run/@cf/black-forest-labs/flux-1-schnell');
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer credential', 'Content-Type': 'application/json' } });
    const body = JSON.parse(String(init.body));
    expect(Object.keys(body).sort()).toEqual(['prompt', 'steps']);
    expect(body.steps).toBe(4);
    // 2026-10-10: the new model must leave the schnell wire body byte for byte unchanged.
    expect(init.body).toBe(JSON.stringify(buildCloudflarePictureRequest('Cafe scene.', reference)));
    expect(body.prompt).toContain(SITUATION_PICTURE_STYLE);
    expect(body.prompt).toContain('Cafe scene.');
    expect(body.prompt).toContain('Two teas, please.');
    expect(String(init.body)).not.toContain(reference.picture);
    expect(String(init.body)).not.toContain('UFJFVklPVVM=');
    expect(String(init.body)).not.toContain('credential');
  });
  it('Whisper sends only base64 WAV and reads trimmed result.text', async () => {
    const fetcher = response({ success: true, result: { text: '  Spoken answer.  ', segments: [] } });
    const audio = Buffer.from('RIFF-example-WAV');
    await expect(transcribeCloudflareAudio('account', 'credential', audio, signal())).resolves.toBe('Spoken answer.');
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/account/ai/run/@cf/openai/whisper-large-v3-turbo');
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer credential', 'Content-Type': 'application/json' } });
    expect(JSON.parse(String(init.body))).toEqual({ audio: audio.toString('base64') });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([401, 403, 400, 500, 429])('uses fixed wording for HTTP %i without body credentials', async (status) => {
    const fake = 'F'.repeat(40);
    response({ errors: [{ message: fake }] }, status);
    const error = await generateCloudflareSituationPicture('Cafe.', 'account', 'credential', signal()).catch(error => error as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(fake);
    // 2026-10-12: V227 reserves the daily allowance for code 3036; other 429s are temporary.
    if (status === 429) expect((error as Error).message).toContain('Cloudflare temporarily rate-limited this request. Try again later.');
    else expect((error as Error).message).toMatch(/Cloudflare picture (authentication failed|request was rejected|service is unavailable)/u);
    const dictationError = await transcribeCloudflareAudio('account', 'credential', Uint8Array.of(1), signal()).catch(error => error as Error);
    expect((dictationError as Error).message).not.toContain(fake);
    // 2026-10-12: the temporary rate-limit sentence is shared by pictures and dictation.
    expect((dictationError as Error).message).toMatch(status === 429 ? /Cloudflare temporarily rate-limited/u : /Cloudflare dictation/u);
  });
  it('recognizes daily allocation code even on a non-429 envelope', async () => {
    response({ success: false, errors: [{ code: 3036, message: 'do not display' }] }, 400);
    await expect(generateCloudflareSituationPicture('Cafe.', 'account', 'credential', signal())).rejects.toThrow(CLOUDFLARE_PICTURE_ALLOWANCE);
  });
  it.each([{ result: {} }, { result: { image: 'not base64!' } }, null])('rejects unusable pictures with fixed wording', async payload => {
    response(payload);
    await expect(generateCloudflareSituationPicture('Cafe.', 'account', 'credential', signal())).rejects.toThrow('Cloudflare situation picture response had no usable image.');
  });
  it.each([{ result: {} }, { result: { text: ' ' } }, null])('rejects unusable transcripts with fixed wording', async payload => {
    response(payload);
    await expect(transcribeCloudflareAudio('account', 'credential', Uint8Array.of(1), signal())).rejects.toThrow('Cloudflare returned an empty transcript.');
  });
  it.each([['', 'credential'], ['account', ''], ['', '']])('requires both host credentials', async (account, token) => {
    const fetcher = response({});
    await expect(generateCloudflareSituationPicture('Cafe.', account!, token!, signal())).rejects.toThrow(CLOUDFLARE_PICTURE_CREDENTIALS);
    await expect(transcribeCloudflareAudio(account!, token!, Uint8Array.of(1), signal())).rejects.toThrow(/account ID and API token/u);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('loads both SecretStorage slots and bypasses Gemini for Cloudflare dictation', async () => {
    const fetcher = response({ result: { text: 'Answer.' } });
    const runtime = { getSecret: vi.fn(async (key: string) => key === KREN_SECRET_KEYS.cloudflareAccountId ? 'account' : 'credential'), beforeLanguageModelRequest: vi.fn() } as unknown as KrenRuntime;
    await expect(runTutorAudioTranscription(runtime, Uint8Array.of(1), signal(), undefined, 'cloudflare')).resolves.toBe('Answer.');
    expect(runtime.getSecret).toHaveBeenCalledWith(KREN_SECRET_KEYS.cloudflareAccountId);
    expect(runtime.getSecret).toHaveBeenCalledWith(KREN_SECRET_KEYS.cloudflareApiToken);
    expect(runtime.getSecret).not.toHaveBeenCalledWith(KREN_SECRET_KEYS.gemini);
    expect(runtime.beforeLanguageModelRequest).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('auto chooses Handy then configured Cloudflare then configured Gemini', () => {
    expect(resolveTutorSpeechRoute('auto', 'available', true, true).provider).toBe('handy');
    expect(resolveTutorSpeechRoute('auto', 'notFound', true, true).provider).toBe('cloudflare');
    expect(resolveTutorSpeechRoute('auto', 'notFound', true, false).provider).toBe('gemini');
    expect(resolveTutorSpeechRoute('auto', 'notFound', false, true).provider).toBe('cloudflare');
    expect(resolveTutorSpeechRoute('auto', 'notFound', false, false).provider).toBeUndefined();
    expect(resolveTutorSpeechRoute('gemini', 'available', true, true).provider).toBe('gemini');
    expect(resolveTutorSpeechRoute('cloudflare', 'available', true, false).reason).toMatch(/account ID and API token/u);
  });
  it('picture provider is writable, validates its two choices, and rejects unknown values', () => {
    expect(PANEL_SETTING_KEYS.has('tutor.pictureProvider')).toBe(true);
    expect(validatedPanelSetting('tutor.pictureProvider', 'cloudflare')).toBe('cloudflare');
    expect(validatedPanelSetting('tutor.pictureProvider', 'gemini')).toBe('gemini');
    expect(validatedPanelSetting('tutor.pictureProvider', 'other')).toBeUndefined();
  });
  // 2026-10-11: The public tree omits tools/scan-secrets.mjs, so this private-only check skips there.
  it.skipIf(!existsSync('tools/scan-secrets.mjs'))('secret scan catches a Cloudflare token shape without echoing it', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kren-cf-scan-'));
    const fake = 'A'.repeat(40);
    try {
      writeFileSync(path.join(root, 'probe.ts'), `const cloudflareToken = '${fake}';`);
      let output = '';
      try { execFileSync(process.execPath, ['tools/scan-secrets.mjs', '--root', root], { encoding: 'utf8', stdio: 'pipe' }); }
      catch (error) { output = String((error as { stderr: unknown }).stderr); }
      expect(output).toContain('Cloudflare API token');
      expect(output).not.toContain(fake);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('Cloudflare picture prompt limit', () => {
  it('V214 finding 4: keeps the newest turn with a long scene and long newest text', () => {
    const newest = 'Newest reply: ' + '\\"\n'.repeat(2500);
    const { prompt } = buildCloudflarePictureRequest('Long scene '.repeat(600), {
      turns: [{ speaker: 'tutor', text: 'Older turn' }, { speaker: 'learner', text: newest }],
      picture: 'previous-picture-must-stay-local'
    });
    // 2026-10-11: V218 uses labeled plain text, preserving the V214 trimming assertions.
    expect(prompt).not.toContain('Older turn');
    expect(prompt).toContain('Scene: \nLatest moment:\nLearner: ');
    const newestText = prompt.split('\nLatest moment:\nLearner: ')[1]!;
    expect(newestText.length).toBeGreaterThan(0);
    expect(newest.startsWith(newestText)).toBe(true);
    expect(prompt).not.toContain('{');
    expect(prompt.startsWith(SITUATION_PICTURE_STYLE)).toBe(true);
    expect(prompt.length).toBeLessThanOrEqual(CLOUDFLARE_PICTURE_PROMPT_LIMIT);
    expect(prompt).not.toContain('previous-picture-must-stay-local');
  });
  it('drops the oldest turns first and keeps the newest turn and the scene within the limit', () => {
    const turns = Array.from({ length: 6 }, (_, index) => ({ speaker: index % 2 ? 'tutor' as const : 'learner' as const, text: `turn ${index} ` + 'x'.repeat(400) }));
    const { prompt } = buildCloudflarePictureRequest('A small bakery at dawn.', { turns, picture: 'old' });
    expect(prompt.length).toBeLessThanOrEqual(CLOUDFLARE_PICTURE_PROMPT_LIMIT);
    expect(prompt).toContain('A small bakery at dawn.');
    expect(prompt).toContain('turn 5 ');
    expect(prompt).not.toContain('turn 0 ');
    expect(prompt).not.toContain('old');
  });

  it('shortens an overlong scene rather than sending a prompt Cloudflare rejects', () => {
    const { prompt } = buildCloudflarePictureRequest('y'.repeat(5000));
    expect(prompt.length).toBeLessThanOrEqual(CLOUDFLARE_PICTURE_PROMPT_LIMIT);
    expect(prompt.startsWith(SITUATION_PICTURE_STYLE)).toBe(true);
  });
});
