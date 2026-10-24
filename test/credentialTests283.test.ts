// Changed 2026-10-22 (V293, owner I61/D22 A): one missing-key message with Open Credentials.
import { missingCredentialError, missingCredentialsOf, showMissingCredentialNotice } from '../src/requestCenter.js';
// 2026-10-21: V283 exercises the registered credential actions with real providers and mocked fetch.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { load } from 'cheerio';
import { listGroqModels } from '../src/providers/openAICompatible.js';
import { listGeminiProModels } from '../src/providers/geminiModels.js';
import { testCloudflareCredentials } from '../src/providers/cloudflare.js';
import { GoogleCloudTranslationProvider } from '../src/providers/googleCloudTranslation.js';
import { MerriamWebsterProvider } from '../src/providers/merriamWebster.js';
import { geminiRefreshTarget } from '../src/geminiProfileRefresh.js';
import { KREN_SECRET_KEYS } from '../src/operations.js';
import { ProviderError, errorMessage } from '../src/errors.js';
import { PANEL_COMMAND_LIST } from '../src/panelCommands.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const source = ts.createSourceFile('extension.ts', readFileSync('src/extension.ts', 'utf8'), ts.ScriptTarget.ES2022, true);
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const definitions = source.statements.filter(node => ts.isFunctionDeclaration(node) &&
  ['missingSecretCredential', 'testLanguageModelConnection', 'testGeminiConnection', 'testCredentialConnection', 'testMerriamWebsterConnection', 'showLookupError'].includes(node.name?.text ?? ''));
const registrations = new Map<string, string>();
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'vscode.commands.registerCommand' &&
      node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[1]) {
    registrations.set(node.arguments[0].text, node.arguments[1].getText(source));
  }
  ts.forEachChild(node, visit);
}
visit(source);

function harness(stored: Partial<Record<string, string>> = {}) {
  const notices = vi.fn();
  const popup = vi.fn(async (message: string, _options: unknown, _choice: string): Promise<string | undefined> => { notices('error', message); return undefined; });
  const showCredentials = vi.fn(async () => {});
  const reserve = vi.fn(async (_characters: number) => undefined);
  const executeCommand = vi.fn(async (_command: string) => undefined);
  const openExternal = vi.fn(async (_uri: string) => true);
  const context = { secrets: { get: vi.fn(async (slot: string) => stored[slot]) } };
  const scope = {
    missingCredentialError, missingCredentialsOf, showMissingCredentialNotice, resultsView: { showErrorMessage: popup, showCredentials },
    context, listGroqModels, listGeminiProModels, testCloudflareCredentials, GoogleCloudTranslationProvider,
    MerriamWebsterProvider, geminiRefreshTarget, KREN_SECRET_KEYS, ProviderError, errorMessage,
    GEMINI_KEY: KREN_SECRET_KEYS.gemini, GEMINI_PRO_KEY: KREN_SECRET_KEYS.geminiPro,
    GROQ_KEY: KREN_SECRET_KEYS.groq, GOOGLE_CLOUD_TRANSLATION_KEY: KREN_SECRET_KEYS.googleCloudTranslation,
    MW_COLLEGIATE_KEY: KREN_SECRET_KEYS.merriamWebsterCollegiate,
    MW_THESAURUS_KEY: KREN_SECRET_KEYS.merriamWebsterThesaurus, MW_MEDICAL_KEY: KREN_SECRET_KEYS.merriamWebsterMedical,
    cloudTranslationUsage: { reserve }, geminiModelDiscoveryProtections: () => ({}),
    vscode: { commands: { executeCommand }, env: { openExternal }, Uri: { parse: (s: string) => s } },
    notify: notices, showKrenErrorMessage: vi.fn(async (message: string) => { notices('error', message); }),
    recordedRequestOutcome: () => undefined, presentRequestFailure: () => undefined,
    actionLabel: () => 'Set key', isCredentialSetupAction: () => true,
    handleLookupErrorSelection: async () => undefined,
    AbortController, setTimeout, clearTimeout
  };
  const run = async (command: string, ...args: unknown[]) => {
    expect(registrations.has(command)).toBe(true);
    const code = definitions.map(node => node.getText(source)).join('\n') + `\n(${registrations.get(command)})`;
    const callback = runInNewContext(ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
    }).outputText, scope);
    return callback(...args);
  };
  return { run, context, notices, reserve, executeCommand, openExternal, popup, showCredentials };
}

// Generated placeholders are not service credentials and are never written to disk.
const placeholder = () => `fixture-${crypto.randomUUID()}`;
const newChecks = [
  { command: 'testGeminiConnection', slot: KREN_SECRET_KEYS.gemini, set: 'setGeminiApiKey', profile: 'Gemini Free Tier', host: 'generativelanguage.googleapis.com', path: '/v1beta/models', payload: { models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] } },
  { command: 'testGeminiProConnection', slot: KREN_SECRET_KEYS.geminiPro, set: 'setGeminiProApiKey', profile: 'Gemini Paid', host: 'generativelanguage.googleapis.com', path: '/v1beta/models', payload: { models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] } },
  { command: 'testGoogleCloudTranslation', slot: KREN_SECRET_KEYS.googleCloudTranslation, set: 'setGoogleCloudTranslationApiKey', profile: 'Google Cloud Translation', host: 'translation.googleapis.com', path: '/language/translate/v2', payload: { data: { translations: [{ translatedText: 'translated' }] } } },
  { command: 'testCloudflareConnection', slot: KREN_SECRET_KEYS.cloudflareApiToken, set: 'setCloudflareApiToken', profile: 'Cloudflare', host: 'api.cloudflare.com', path: '/client/v4/accounts/account-fixture/ai/models/search', payload: { success: true, result: [{ name: 'model' }] } },
  ...(['Collegiate', 'Thesaurus', 'Medical'] as const).map(reference => ({ command: `testMerriamWebster${reference}`,
    slot: KREN_SECRET_KEYS[`merriamWebster${reference}`], set: `setMerriamWebster${reference}ApiKey`,
    profile: `Merriam-Webster ${reference}`, host: 'www.dictionaryapi.com',
    path: `/api/v3/references/${reference.toLowerCase()}/json/test`,
    payload: [{ meta: { id: 'test', syns: [['trial']] }, hwi: { hw: 'test' }, fl: 'noun', shortdef: ['a trial'] }] }))
];

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('V283 registered credential checks', () => {
  it.each(newChecks)('$command makes exactly one bounded request using its own credential', async check => {
    const secret = placeholder();
    const h = harness({ [check.slot]: secret, [KREN_SECRET_KEYS.cloudflareAccountId]: 'account-fixture' });
    const fetch = vi.fn(async () => new Response(JSON.stringify(check.payload)));
    vi.stubGlobal('fetch', fetch);
    await h.run(`kren.${check.command}`);
    expect(fetch).toHaveBeenCalledOnce();
    const [input, init] = fetch.mock.calls[0] as unknown as [string | URL, RequestInit];
    const url = new URL(input);
    expect(url.hostname).toBe(check.host);
    expect(url.pathname).toBe(check.path);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
    const headers = new Headers(init.headers);
    if (check.host === 'generativelanguage.googleapis.com') {
      expect(headers.get('x-goog-api-key')).toBe(secret);
      expect(init.method ?? 'GET').toBe('GET');
      expect(init.body).toBeUndefined();
    } else if (check.host === 'api.cloudflare.com') {
      expect(headers.get('authorization')).toBe(`Bearer ${secret}`);
      expect(init.method ?? 'GET').toBe('GET');
      expect(url.searchParams.get('per_page')).toBe('1');
      expect(init.body).toBeUndefined();
      expect(h.notices.mock.calls[0]?.[1]).toContain('no neurons used');
    } else {
      expect(url.searchParams.get('key')).toBe(secret);
      if (check.command === 'testGoogleCloudTranslation') {
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({ q: 'test', source: 'en', target: 'ko', format: 'text' });
        expect(h.reserve).toHaveBeenCalledExactlyOnceWith(4);
        expect(h.reserve.mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[0]!);
        expect(h.notices.mock.calls[0]?.[1]).toMatch(/4 characters.*local monthly ledger/u);
      } else {
        expect(init.method ?? 'GET').toBe('GET');
        expect(init.body).toBeUndefined();
      }
    }
    expect(h.notices).toHaveBeenCalledWith('information', expect.stringContaining(`${check.profile} connection succeeded`));
    expect(JSON.stringify(h.notices.mock.calls)).not.toContain(secret);
    expect(h.executeCommand).not.toHaveBeenCalled();
  });

  it.each(newChecks)('$command offers Open Credentials and makes no request when the question is dismissed', async check => {
    const h = harness({ [KREN_SECRET_KEYS.cloudflareAccountId]: 'account-fixture' });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await h.run(`kren.${check.command}`);
    // Changed 2026-10-22 (V293, owner I61/D22 A): one missing-key message with Open Credentials.
    expect(h.executeCommand).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(h.notices).toHaveBeenCalledExactlyOnceWith('error', expect.stringContaining('KREN menu, Credentials'));
    expect(h.popup).toHaveBeenCalledWith(expect.stringMatching(new RegExp(check.profile.split(' ').join('.*'), 'u')), { modal: true }, 'Open Credentials');
    expect(h.showCredentials).not.toHaveBeenCalled();
  });

  // Changed 2026-10-22 (V293, owner I61/D22 A): one missing-key message with Open Credentials.
  it.each(newChecks)('$command opens Credentials without sending, then manual Retry after storage sends exactly one request', async check => {
    const secret = placeholder();
    const stored: Partial<Record<string, string>> = { [KREN_SECRET_KEYS.cloudflareAccountId]: 'account-fixture' };
    const h = harness(stored); h.popup.mockResolvedValue('Open Credentials');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(check.payload))));
    await h.run(`kren.${check.command}`);
    expect(h.executeCommand).not.toHaveBeenCalled();
    expect(h.showCredentials).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    stored[check.slot] = secret;
    await h.run(`kren.${check.command}`);
    expect(fetch).toHaveBeenCalledOnce();
    expect(h.notices).toHaveBeenCalledWith('information', expect.stringContaining('connection succeeded'));
  });

  it('Cloudflare names the missing account ID and offers Credentials before testing the token', async () => {
    const h = harness({ [KREN_SECRET_KEYS.cloudflareApiToken]: placeholder() });
    vi.stubGlobal('fetch', vi.fn());
    await h.run('kren.testCloudflareConnection');
    // Changed 2026-10-22 (V293, owner I61/D22 A): one missing-key message with Open Credentials.
    expect(h.executeCommand).not.toHaveBeenCalled();
    expect(h.popup).toHaveBeenCalledWith(expect.stringMatching(/Cloudflare account ID.*Credentials/u), { modal: true }, 'Open Credentials');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(newChecks)('$command reports an HTTP failure through the safe existing notice', async check => {
    const secret = placeholder(); const raw = `remote-${placeholder()}`;
    const h = harness({ [check.slot]: secret, [KREN_SECRET_KEYS.cloudflareAccountId]: 'account-fixture' });
    const log = vi.spyOn(console, 'log'); const error = vi.spyOn(console, 'error');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: `${raw} ${secret}` } }), { status: 403 })));
    await h.run(`kren.${check.command}`);
    expect(fetch).toHaveBeenCalledOnce();
    expect(h.notices).toHaveBeenCalledWith('error', expect.stringMatching(/^KREN:/u));
    for (const value of [JSON.stringify(h.notices.mock.calls), JSON.stringify(log.mock.calls), JSON.stringify(error.mock.calls)]) {
      expect(value).not.toContain(secret); expect(value).not.toContain(raw);
    }
  });

  it.each(newChecks)('$command does not expose a rejected fetch error', async check => {
    const secret = placeholder();
    const h = harness({ [check.slot]: secret, [KREN_SECRET_KEYS.cloudflareAccountId]: 'account-fixture' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(`remote response ${secret}`); }));
    await h.run(`kren.${check.command}`);
    expect(fetch).toHaveBeenCalledOnce();
    expect(h.notices).toHaveBeenCalledWith('error', expect.stringMatching(/^KREN:/u));
    expect(JSON.stringify(h.notices.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(h.notices.mock.calls)).not.toContain('remote response');
  });

  it('Translation respects a ledger refusal before making any request', async () => {
    const h = harness({ [KREN_SECRET_KEYS.googleCloudTranslation]: placeholder() });
    h.reserve.mockRejectedValue(new ProviderError('The local monthly character limit has been reached.'));
    vi.stubGlobal('fetch', vi.fn());
    await h.run('kren.testGoogleCloudTranslation');
    expect(h.reserve).toHaveBeenCalledExactlyOnceWith(4);
    expect(fetch).not.toHaveBeenCalled();
    expect(h.notices).toHaveBeenCalledWith('error', expect.stringContaining('local monthly character limit'));
  });

  it('Cloudflare refuses an unsuccessful envelope even with HTTP 200', async () => {
    const secret = placeholder(); const h = harness({ [KREN_SECRET_KEYS.cloudflareApiToken]: secret, [KREN_SECRET_KEYS.cloudflareAccountId]: 'account-fixture' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, errors: [{ message: secret }] }))));
    await h.run('kren.testCloudflareConnection');
    expect(fetch).toHaveBeenCalledOnce();
    expect(h.notices).toHaveBeenCalledWith('error', expect.stringContaining('invalid response'));
    expect(JSON.stringify(h.notices.mock.calls)).not.toContain(secret);
  });

  it.each([true, false])('Groq uses the existing model-list response, daily headers present: %s', async withHeaders => {
    const h = harness({ [KREN_SECRET_KEYS.groq]: placeholder() });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b', active: true }] }), {
      headers: withHeaders ? { 'x-ratelimit-limit-requests': '14400', 'x-ratelimit-remaining-requests': '13960' } : {}
    })));
    await h.run('kren.testGroqConnection');
    expect(fetch).toHaveBeenCalledOnce();
    expect(new URL(vi.mocked(fetch).mock.calls[0]![0].toString()).pathname).toBe('/openai/v1/models');
    const message = h.notices.mock.calls[0]?.[1];
    expect(message).toContain('1 compatible models found');
    if (withHeaders) expect(message).toContain('13960 of 14400 requests left today');
    else expect(message).not.toContain('requests left today');
  });

  it.each<Record<string, string>>([{}, { 'x-ratelimit-limit-requests': '14400' }, { 'x-ratelimit-limit-requests': 'remote error', 'x-ratelimit-remaining-requests': '1' }])('omits absent, partial, or invalid Groq counts (%j)', async headers => {
    const h = harness({ [KREN_SECRET_KEYS.groq]: placeholder() });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"data":[]}', { headers })));
    await h.run('kren.testGroqConnection');
    expect(fetch).toHaveBeenCalledOnce();
    expect(h.notices.mock.calls[0]?.[1]).not.toContain('requests left today');
    expect(h.notices.mock.calls[0]?.[1]).not.toContain('remote error');
  });
});

describe('V283 reader access and command wiring', () => {
  it.each([{}, { merriamWebsterCollegiate: true, merriamWebsterThesaurus: true }])('every credential row exposes Test outside hidden help, with keyboard access, disabled until its key is stored (%j)', credentialPresence => {
    const $ = load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [], activeScreen: 'credentials', settings: { ...PANEL_SETTINGS_FIXTURE, credentialPresence } }));
    const rows = $('#credentials-screen .credential-row');
    expect(rows).toHaveLength(13);
    rows.each((_, element) => {
      const row = $(element);
      const test = row.find('button').filter((_, button) => $(button).text() === 'Test');
      expect(test).toHaveLength(1);
      expect(test.parents('details:not([open]), [hidden], .hidden')).toHaveLength(0);
      expect(test.attr('tabindex')).not.toBe('-1');
      expect(test.attr('data-command')).toBe('runCommand');
      // Changed 2026-10-21 (coordinator): Test stays disabled until its row's key is stored, as before V283;
      // the speech row keeps its Cloud Translation fallback.
      const removeDisabled = row.find('button[data-action^="kren.delete"]').is('[disabled]');
      if (test.attr('data-action') !== 'kren.testGoogleCloudTextToSpeech') expect(test.is('[disabled]')).toBe(removeDisabled);
      if (row.hasClass('unavailable')) expect(row.find('.credential-reason').text()).toMatch(/two|2/iu);
      const command = test.attr('data-action')!;
      expect(PANEL_COMMAND_LIST).toContain(command);
      expect(registrations.has(command)).toBe(true);
      expect(manifest.contributes.commands.some((entry: { command: string }) => entry.command === command)).toBe(true);
    });
    // Changed 2026-10-21 (owner): Cloud Translation's button reads Usage, like Gemini's.
    expect($('#credentials-screen [data-action="kren.showGoogleCloudTranslationUsage"]').text()).toBe('Usage');
  });

  it('both Gemini Usage buttons are visible and can only open the fixed quota page', async () => {
    const $ = load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [], activeScreen: 'credentials', settings: PANEL_SETTINGS_FIXTURE }));
    const buttons = $('[data-action="kren.openGeminiUsage"]');
    expect(buttons).toHaveLength(2);
    buttons.each((_, element) => {
      const button = $(element);
      expect(button.text()).toBe('Usage');
      expect(button.is('[disabled]')).toBe(false);
      expect(button.parents('details:not([open]), [hidden], .hidden')).toHaveLength(0);
      expect(button.attr('tabindex')).not.toBe('-1');
    });
    expect(PANEL_COMMAND_LIST).toContain('kren.openGeminiUsage');
    expect(manifest.contributes.commands.some((entry: { command: string }) => entry.command === 'kren.openGeminiUsage')).toBe(true);
    const h = harness();
    await h.run('kren.openGeminiUsage', 'https://example.com/untrusted');
    expect(h.openExternal).toHaveBeenCalledExactlyOnceWith('https://ai.dev/rate-limit');
  });
});
