import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { load } from 'cheerio';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));
import { KREN_SECRET_KEYS, runKrenOperation, runTutorStructuredRequest, runTutorTranslation,
  runTutorAudioTranscription, runUserDictionaryCapture, type KrenRuntime, type TutorLanguageModelRoute } from '../src/operations.js';
import { MissingCredentialError, OPEN_CREDENTIALS, missingCredentialDetails, missingCredentialError,
  missingCredentialMessage, missingCredentialsOf, presentRequestFailure, requestFailure, recordedRequestOutcome,
  showMissingCredentialNotice, type CredentialProvider } from '../src/requestCenter.js';
import { languageModelCredentialSlot } from '../src/languageModelRouting.js';
import { ProviderError } from '../src/errors.js';
import { PanelNoticeQueue } from '../src/panelNotices.js';
import { resolveTutorSpeechRoute, createTutorViewState } from '../src/tutor/state.js';
import { runCloudflareAi, transcribeCloudflareAudio } from '../src/providers/cloudflare.js';
import { GoogleChirpPlayer } from '../src/googleChirpSpeech.js';
import { GoogleChirpSpeech, SpeechCenter, type SpeechHost } from '../src/speech/speechCenter.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

const signal = () => new AbortController().signal;
const request = { kind: 'lesson' as const, instruction: 'Return JSON.', input: '{}', schema: {}, schemaName: 'probe' };
const route = (provider: TutorLanguageModelRoute['provider'], geminiProfile: 'standard' | 'pro' = 'standard'): TutorLanguageModelRoute => ({
  provider, geminiProfile, model: 'model', thinkingOrEffort: 'low', fallbackEnabled: false, fallbackModel: '', fallbackThinkingOrEffort: 'low'
});
const runtime = (settings: Record<string, unknown> = {}): KrenRuntime => ({
  getSecret: async () => undefined,
  getSetting: <T>(key: string, fallback: T) => (settings[key] ?? fallback) as T,
  beforeGeminiRequest: async () => {}, reserveCloudCharacters: async () => {}
});
const extension = readFileSync('src/extension.ts', 'utf8');
function extensionFunction(name: string, dependencies: Record<string, unknown>): (...args: any[]) => any {
  const tree = ts.createSourceFile('extension.ts', extension, ts.ScriptTarget.Latest, true);
  const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
  const code = ts.transpileModule(declaration.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(`${code}\n${name}`, dependencies);
}
async function capture(call: Promise<unknown>): Promise<unknown> {
  try { await call; } catch (error) { return error; }
  throw new Error('Expected a missing credential.');
}
afterEach(() => vi.unstubAllGlobals());

type Pair = { feature: string; provider: CredentialProvider; profile?: 'standard' | 'pro'; run(): Promise<unknown> };
const pairs: Pair[] = [];
const routes = [route('gemini'), route('gemini', 'pro'), route('openai'), route('anthropic'), route('groq'), route('cloudflare')];
for (const selected of routes) {
  const { provider, geminiProfile: profile } = selected;
  const settings = (prefix: string) => ({ 'userDictionary.enabled': true, [`${prefix}.provider`]: provider,
    [`${prefix}.geminiProfile`]: profile, [`${prefix}.model`]: 'model', [`${prefix}.alternateModel`]: 'model' });
  for (const [feature, operation, prefix] of [['Translate', 'translate', 'translation'], ['Explain', 'explain', 'explanation'],
    ['Rewrite', 'rewrite', 'rewrite']] as const) {
    if (feature === 'Translate' && (provider === 'openai' || provider === 'anthropic')) continue;
    pairs.push({ feature, provider, profile, run: () => runKrenOperation(runtime({ translationProvider: 'gemini', ...settings(prefix) }), operation, { text: 'A sample sentence.' }, signal()) });
  }
  pairs.push({ feature: 'Smart Word Capture', provider, profile, run: () => runUserDictionaryCapture(runtime(settings('userDictionary')), 'ledger', signal()) });
  for (const feature of ['Tutor Fast', 'Tutor Thorough', 'Tutor lesson', 'Tutor practice', 'Tutor Learning Tools Ask']) {
    pairs.push({ feature, provider, profile, run: () => runTutorStructuredRequest(runtime(), selected,
      { ...request, thinkingMode: feature === 'Tutor Fast' ? 'fast' : 'thorough' }, signal()) });
  }
  pairs.push({ feature: 'Tutor Learning Tools Translate', provider, profile, run: () => runTutorTranslation(runtime(), selected, 'A sample sentence.', signal(), 'ko') });
  pairs.push({ feature: 'Smart Grammar', provider, profile, run: async () => {
    const run = extensionFunction('runSmartGrammarPass', {
      vscode: { workspace: { getConfiguration: () => ({ get: (key: string, fallback: unknown) => settings('userDictionary')[key] ?? fallback }) } },
      GRAMMAR_SMART_DEFAULT: true, DEFAULT_GEMINI_MODEL: 'model', KREN_SECRET_KEYS, languageModelCredentialSlot,
      extensionRuntime: () => runtime(), featureModel: () => 'model', ensureLanguageModelConsent: async () => {},
      missingCredentialError, showLookupError: async (error: unknown) => { throw error; }
    });
    return run({}, 'A sample sentence.', [], signal());
  } });
}
pairs.push({ feature: 'Translate', provider: 'googleCloudTranslation', run: () => runKrenOperation(runtime({ translationProvider: 'googleCloudTranslation' }), 'translate', { text: 'Hello.' }, signal()) });
for (const [operation, provider] of [['englishDictionary', 'merriamWebsterCollegiate'], ['medical', 'merriamWebsterMedical'],
  ['synonyms', 'merriamWebsterThesaurus'], ['koreanDictionary', 'koreanDictionary']] as const) {
  pairs.push({ feature: operation, provider, run: () => runKrenOperation(runtime(), operation, { text: operation === 'koreanDictionary' ? '나무' : 'ledger' }, signal()) });
}
pairs.push({ feature: 'Tutor Learning Tools Dictionary', provider: 'merriamWebsterCollegiate', run: () => runKrenOperation(runtime(), 'englishDictionary', { text: 'ledger' }, signal()) });
pairs.push({ feature: 'Merriam-Webster + model capture', provider: 'merriamWebsterCollegiate', run: () => runUserDictionaryCapture({ ...runtime({ 'userDictionary.enabled': true }),
  getSecret: async key => key === KREN_SECRET_KEYS.gemini ? 'present' : undefined }, 'ledger', signal(), 'merriamWebsterAndLlm') });
for (const provider of ['gemini', 'groq', 'cloudflare'] as const) pairs.push({ feature: 'Transcription', provider,
  run: () => runTutorAudioTranscription(runtime(), Uint8Array.of(1), signal(), undefined, provider) });
pairs.push({ feature: 'Cloudflare pictures transport', provider: 'cloudflare', run: () => runCloudflareAi('', '', 'model', {}, signal(), 'picture') });
for (const profile of ['standard', 'pro'] as const) pairs.push({ feature: 'Gemini Live credential getter', provider: 'gemini', profile,
  // Changed 2026-10-23 (V306, verification R30): Live credentials follow the separate Live profile.
  run: () => runTutorStructuredRequest(runtime({ 'tutor.liveGeminiProfile': profile }), route('gemini', profile), { ...request, kind: 'liveSessionCredential' }, signal()) });

describe('R25 feature and provider table outside V295', () => {
  it.each(pairs)('$feature / $provider / $profile: one reason, Open Credentials, zero requests', async pair => {
    const fetcher = vi.fn(() => { throw new Error('No request may be sent.'); });
    vi.stubGlobal('fetch', fetcher);
    const error = await capture(pair.run());
    expect(error).toBeInstanceOf(MissingCredentialError);
    const details = missingCredentialsOf(error)!;
    expect(details).toMatchObject({ provider: pair.provider, action: 'openCredentials' });
    if (pair.provider === 'gemini') expect(details.geminiProfile).toBe(pair.profile ?? 'standard');
    for (const slot of details.slots) expect((error as Error).message).toContain(slot);
    const show = vi.fn(async () => OPEN_CREDENTIALS), open = vi.fn(async () => {});
    await showMissingCredentialNotice(details, { showErrorMessage: show, showCredentials: open });
    expect(show).toHaveBeenCalledWith((error as Error).message, { modal: true }, 'Open Credentials');
    expect(open).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
    expect(recordedRequestOutcome(error)).toMatchObject({ type: 'failed', cause: 'missingCredentials', history: [] });
  });

  it('missing credentials are distinct from rejected credentials, even after earlier attempts', () => {
    const selected = { ...route('cloudflare'), mode: 'thorough' as const, effort: 'low' as const };
    const missing = requestFailure(missingCredentialError('cloudflare'), selected);
    expect(missing).toMatchObject({ type: 'failed', cause: 'missingCredentials', missingCredentials: {
      provider: 'cloudflare', slots: ['account ID', 'API token'], action: 'openCredentials'
    } });
    const rejected = requestFailure(new ProviderError('Rejected.', 'setCloudflareCredentials', false, 401), selected);
    expect(rejected.cause).toBe('authenticationRejected');
    expect(rejected.missingCredentials).toBeUndefined();
    expect(presentRequestFailure(missing).message).toMatch(/Cloudflare account ID and API token.*Credentials/u);
    expect(presentRequestFailure(rejected).message).not.toContain('Cloudflare API key');
    expect(requestFailure(missingCredentialError('cloudflare'), selected, [{ attempt: 1, route: selected,
      status: 503, outcome: 'failed', cause: 'overloaded', codes: [] }]).cause).toBe('missingCredentials');
  });

  it('the multi-word fallback sends no Cloud Translation request when its key is missing', async () => {
    const fetcher = vi.fn(async (_input: unknown) => new Response('[]', { status: 200 })); vi.stubGlobal('fetch', fetcher);
    const rt = { ...runtime(), getSecret: async (key: string) => key === KREN_SECRET_KEYS.merriamWebsterCollegiate ? 'present' : undefined };
    const error = await capture(runKrenOperation(rt, 'englishDictionary', { text: 'out of scope' }, signal()));
    expect(missingCredentialsOf(error)).toMatchObject({ provider: 'googleCloudTranslation', slots: ['API key'], action: 'openCredentials' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('dictionaryapi.com');
  });
  it('combined capture checks the Cloudflare account before starting either parallel request', async () => {
    const fetcher = vi.fn(async () => new Response('[]', { status: 200 })); vi.stubGlobal('fetch', fetcher);
    const rt = { ...runtime({ 'userDictionary.enabled': true, 'userDictionary.provider': 'cloudflare' }),
      getSecret: async (key: string) => key === KREN_SECRET_KEYS.cloudflareApiToken || key === KREN_SECRET_KEYS.merriamWebsterCollegiate ? 'present' : undefined };
    const error = await capture(runUserDictionaryCapture(rt, 'ledger', signal(), 'merriamWebsterAndLlm'));
    expect(missingCredentialsOf(error)).toMatchObject({ provider: 'cloudflare', slots: ['account ID'] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([['', 'present', ['account ID']], ['present', '', ['API token']], ['', '', ['account ID', 'API token']]] as const)(
    'Cloudflare transcription names exactly the missing slots (%s, %s)', async (account, token, slots) => {
      const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
      const error = await capture(transcribeCloudflareAudio(account, token, Uint8Array.of(1), signal()));
      expect(missingCredentialsOf(error)?.slots).toEqual(slots);
      expect((error as Error).message).toContain('KREN menu, Credentials');
      expect((error as Error).message).not.toContain('Settings');
      expect(fetcher).not.toHaveBeenCalled();
    });

  it('Cloudflare transcription availability points to Credentials, never Settings', () => {
    expect(resolveTutorSpeechRoute('cloudflare', 'notFound', false).reason).toBe(missingCredentialMessage(missingCredentialDetails('cloudflare')));
    expect(resolveTutorSpeechRoute('cloudflare', 'notFound', false).reason).not.toContain('Settings');
  });
  it('Auto transcription names its alternatives and Credentials without a request', () => {
    const result = resolveTutorSpeechRoute('auto', 'notFound', false);
    expect(result.provider).toBeUndefined();
    expect(result.reason).toMatch(/Cloudflare.*account ID.*API token.*Credentials.*Groq.*Credentials.*Gemini Free Tier.*Credentials/u);
    expect(result.missingCredentials?.action).toBe('openCredentials');
  });
  it('Chirp names both accepted credential alternatives and sends zero requests', async () => {
    const fetcher = vi.fn(), play = vi.fn();
    const player = new GoogleChirpPlayer(async () => undefined, { play, stop: () => false }, fetcher);
    const result = await player.speak('Hello.', { voice: 'Callirrhoe', languageCode: 'en-US' }, 0, 100);
    expect(result).toMatchObject({ status: 'failed', missingKey: true,
      message: missingCredentialMessage(missingCredentialDetails('googleCloudTextToSpeech')) });
    expect(fetcher).not.toHaveBeenCalled(); expect(play).not.toHaveBeenCalled();
  });
  it('Open Credentials is one modal choice and opens the Credentials screen', async () => {
    const post = vi.fn(), open = vi.fn(async () => {}), native = vi.fn(async () => OPEN_CREDENTIALS);
    const queue = new PanelNoticeQueue(() => true, post, native);
    await showMissingCredentialNotice(missingCredentialDetails('groq'), {
      showErrorMessage: (message, options, choice) => queue.show('error', message, options, choice), showCredentials: open
    });
    expect(native).toHaveBeenCalledWith('error', expect.stringMatching(/Groq.*API key.*Credentials/u), { modal: true }, ['Open Credentials']);
    expect(post).not.toHaveBeenCalled(); expect(open).toHaveBeenCalledOnce();
  });
  it('the credential action includes Open Credentials', async () => {
    const show = vi.fn(async () => undefined);
    await showMissingCredentialNotice(missingCredentialDetails('groq'), { showErrorMessage: show, showCredentials: async () => {} });
    expect(show).toHaveBeenCalledWith(expect.stringMatching(/Groq.*API key.*Credentials/u), { modal: true }, 'Open Credentials');
  });
  it('the editor missing-key popup cannot claim the provider rejected a credential', async () => {
    const show = vi.fn(async () => undefined);
    const showError = extensionFunction('showLookupError', { missingCredentialsOf, showMissingCredentialNotice,
      resultsView: { showErrorMessage: show, showCredentials: async () => {} } });
    await showError(missingCredentialError('gemini', 'pro'));
    expect(show).toHaveBeenCalledWith(expect.stringMatching(/Gemini Paid.*Credentials/u), { modal: true }, 'Open Credentials');
    expect(JSON.stringify(show.mock.calls)).not.toMatch(/reject/iu);
  });
  it.each(['tutor', 'shared'] as const)('the %s speech fallback retains missing-key metadata for its Credentials popup', async feature => {
    const notify = vi.fn(), fetcher = vi.fn();
    const player = () => new GoogleChirpSpeech(async () => undefined, { play: async () => 'completed', stop: () => false }, notify, fetcher);
    const tutor = player(), shared = player();
    const host: SpeechHost = { configuration: () => ({ get: <T>(key: string, fallback: T) => key.endsWith('.provider') ? 'googleChirp' as T : fallback }),
      trusted: () => true, consent: async () => true, active: async () => {}, status: () => ({ dispose() {} }),
      hold: () => () => {}, started() {}, liveSpeaking: () => false, conversation: () => 'conversation',
      speakerVoice: () => 'Callirrhoe', playback: () => undefined, notify: vi.fn(), log() {} };
    const fallback = { stop: () => false, speak: vi.fn(async () => ({ status: 'completed' as const })) };
    const center = new SpeechCenter(tutor, shared, fallback, fallback, host);
    await center.speak('Hello.', 'en', feature);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('KREN menu, Credentials'), expect.objectContaining({
      provider: 'googleCloudTextToSpeech', action: 'openCredentials'
    }));
    expect(fetcher).not.toHaveBeenCalled();
    expect(fallback.speak).toHaveBeenCalledOnce();
  });
  it('dismissing the credential question leaves the current screen alone', async () => {
    const open = vi.fn(async () => {});
    await showMissingCredentialNotice(missingCredentialDetails('gemini', 'pro'), { showErrorMessage: async () => undefined, showCredentials: open });
    expect(open).not.toHaveBeenCalled();
  });
});

function render(overrides: Partial<typeof PANEL_SETTINGS_FIXTURE> = {}, tutor = createTutorViewState()) {
  return renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'tutor', proModels: [], tutor,
    settings: { ...PANEL_SETTINGS_FIXTURE, credentialPresence: {}, ...overrides } });
}
describe('D22 A selection guidance and reader reachability', () => {
  it.each(routes)('each routing selector shows the missing $provider/$geminiProfile line and keeps its selection', selected => {
    const overrides: any = { tutorProvider: selected.provider, tutorProfile: selected.geminiProfile,
      translationRoutingProvider: selected.provider, translationProfile: selected.geminiProfile,
      explanationProvider: selected.provider, explanationProfile: selected.geminiProfile,
      rewriteProvider: selected.provider, rewriteProfile: selected.geminiProfile,
      userDictionaryProvider: selected.provider, userDictionaryProfile: selected.geminiProfile };
    const tutor = createTutorViewState(); tutor.settings.routing.provider = selected.provider;
    const html = render(overrides, tutor), $ = load(html);
    for (const key of ['translation', 'explanation', 'rewrite', 'userDictionary', 'tutor']) {
      const note = $(`[data-credential-setting="${key}.provider"]`).first();
      expect(note.text()).toContain(missingCredentialMessage(missingCredentialDetails(selected.provider, selected.geminiProfile)).includes('Cloudflare')
        ? 'No Cloudflare account ID and API token yet.' : `No ${selected.provider === 'gemini' ? selected.geminiProfile === 'pro' ? 'Gemini Paid' : 'Gemini Free Tier' : selected.provider === 'openai' ? 'OpenAI' : selected.provider === 'anthropic' ? 'Anthropic' : 'Groq'} key yet.`);
      expect(note.is('[hidden]')).toBe(false);
      // Changed 2026-10-23 (V302, owner D35 A): guidance follows the Gemini profile group so the named choice is beside its note.
      expect(note.prev().find(`[data-setting="${key}.geminiProfile"]`)).toHaveLength(1);
      expect(note.find('a').attr('data-command')).toBe('showCredentials');
      expect(note.find('a').attr('href')).toBe('#');
      expect(note.find('a').attr('tabindex')).not.toBe('-1');
      expect(note.find('a').parents('button[disabled]')).toHaveLength(0);
      expect(note.parent().get(0)).toBe(note.prev().parent().get(0));
      expect($(`[data-setting="${key}.provider"] option[selected]`).first().attr('value')).toBe(selected.provider);
    }
    const presence = { geminiDefault: true, geminiAlternate: true, groq: true, openai: true, anthropic: true,
      cloudflareAccountId: true, cloudflareApiToken: true };
    const stored = load(render({ ...overrides, credentialPresence: presence }, tutor));
    for (const key of ['translation', 'explanation', 'rewrite', 'userDictionary', 'tutor']) {
      expect(stored(`[data-credential-setting="${key}.provider"]`).is('[hidden]')).toBe(true);
    }
    expect(stored('[data-setting="tutor.provider"] option[selected]').attr('value')).toBe(selected.provider);
  });
  it.each(['gemini', 'cloudflare'] as const)('picture selection keeps %s and puts its link beside that setting', provider => {
    const $ = load(render({ tutorPictureProvider: provider }));
    const note = $('[data-credential-setting="tutor.pictureProvider"]');
    expect(note.text()).toMatch(provider === 'gemini' ? /No Gemini Paid key yet/u : /No Cloudflare account ID and API token yet/u);
    expect(note.prev().find('[data-setting="tutor.pictureProvider"]')).toHaveLength(1);
    expect(note.parents('details').toArray()).toEqual($('[data-setting="tutor.pictureProvider"]').parents('details').toArray());
    expect(note.find('a').attr('data-command')).toBe('showCredentials');
    const stored = load(render({ tutorPictureProvider: provider, credentialPresence: { geminiAlternate: true, cloudflareAccountId: true, cloudflareApiToken: true } }));
    expect(stored('[data-credential-setting="tutor.pictureProvider"]').is('[hidden]')).toBe(true);
    expect(stored('[data-setting="tutor.pictureProvider"] option[selected]').attr('value')).toBe(provider);
  });
  it('the failed Learning Tools drawer shows the shared reason beside a keyboard-reachable Credentials link', () => {
    const tutor = createTutorViewState();
    tutor.toolDrawer = { tool: 'dictionary', input: 'ledger', status: 'failed',
      message: missingCredentialMessage(missingCredentialDetails('merriamWebsterCollegiate')) };
    const html = render({}, tutor), $ = load(html);
    const reason = $('.tutor-drawer .tutor-failure');
    const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gu)].map(match => match[1]).join('\n');
    const start = script.indexOf('function linkCredentialReasons('), end = script.indexOf('\n    }', start) + 6;
    const patch = runInNewContext(`${script.slice(start, end)}; linkCredentialReasons`, {
      document: { querySelectorAll: () => [{ textContent: reason.text(), querySelector: (selector: string) => reason.find(selector).get(0),
        append: (_space: string, link: any) => reason.append(`<a href="${link.href}" data-command="${link.dataset.command}">${link.textContent}</a>`) }],
        createElement: () => ({ dataset: {} }) }
    });
    expect(script).toContain('Promise.resolve().then(linkCredentialReasons)');
    // Changed 2026-10-22 (V297, owner I67/I68): gray updates may precede link repair in the same conditional pass.
    expect(script).toMatch(/function applyConditionalSettings\(\) \{[^}]*linkCredentialReasons\(\);/u);
    patch(); patch();
    expect(reason.find('[data-command="showCredentials"]')).toHaveLength(1);
    expect(reason.text()).toContain(tutor.toolDrawer.message);
    const link = reason.find('[data-command="showCredentials"]');
    expect(link.attr('href')).toBe('#');
    expect(link.attr('tabindex')).not.toBe('-1');
    expect(link.parents('details:not([open]), [hidden], button[disabled]')).toHaveLength(0);
  });
  it('Start-page credential links sit outside disabled actions and collapsed sections', () => {
    const $ = load(render());
    const links = $('#result-screen a[data-command="showCredentials"]');
    expect(links.length).toBeGreaterThan(0);
    expect(links.parents('button[disabled], details:not([open])')).toHaveLength(0);
    expect(links.parent('.capability-item')).toHaveLength(links.length);
    expect(links.prev('button.capability:disabled')).toHaveLength(links.length);
  });
  it('activating an Open Credentials link by keyboard reaches the host Credentials command', () => {
    const html = render(), post = vi.fn(), preventDefault = vi.fn();
    const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gu)].map(match => match[1]).join('\n');
    const start = script.indexOf("document.addEventListener('click',"), end = script.indexOf("window.addEventListener('message',", start);
    class Link {
      closest(selector: string) { return selector === 'a[data-command="showCredentials"]' ? this : null; }
    }
    let click: (event: unknown) => void = () => {};
    runInNewContext(script.slice(start, end), { Element: Link, HTMLButtonElement: class {},
      document: { addEventListener: (_type: string, listener: typeof click) => { click = listener; }, querySelectorAll: () => [] },
      vscode: { postMessage: post } });
    click({ target: new Link(), detail: 0, preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledExactlyOnceWith({ command: 'showCredentials' });
  });
  it('patches notes after provider and Gemini-profile changes without changing the selected control', () => {
    // Changed 2026-10-22 (V297, owner I67/I68): exercise notes with the mounted presence rule instead of an isolated closure.
    const panel = mountedPanel(render(), vi.fn());
    const provider = panel.query('[data-setting="tutor.provider"]')!;
    const profile = panel.query('[data-setting="tutor.geminiProfile"]')!;
    const note = panel.query('[data-credential-setting="tutor.provider"]')!;
    provider.value = 'groq'; panel.change(provider);
    expect(note.textContent).toContain('No Groq key yet.'); expect(note.hidden).toBe(false);
    provider.value = 'gemini'; profile.value = 'pro'; panel.change(profile);
    expect(note.textContent).toContain('No Gemini Paid key yet.');
    expect({ 'tutor.provider': provider.value, 'tutor.geminiProfile': profile.value })
      .toEqual({ 'tutor.provider': 'gemini', 'tutor.geminiProfile': 'pro' });
  });
  it('saving a provider without credentials writes the exact choice and never warns', async () => {
    const update = vi.fn(async () => {}), warn = vi.fn();
    const save = extensionFunction('updatePanelSetting', {
      validatedPanelSetting: (_key: string, value: unknown) => value,
      vscode: { ConfigurationTarget: { Global: 1 }, workspace: { getConfiguration: () => ({ update }) } },
      chirpSpeech: { warnMissingKey: warn }, storedSecretKeys: new Set(), notify: warn
    });
    for (const [key, value] of [['tutor.provider', 'groq'], ['tutor.pictureProvider', 'cloudflare'], ['tutor.readAloud.provider', 'googleChirp']]) {
      await save(key, value); expect(update).toHaveBeenLastCalledWith(key, value, 1);
    }
    expect(warn).not.toHaveBeenCalled();
  });
});
