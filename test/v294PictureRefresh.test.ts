import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { load } from 'cheerio';
import { effectivePictureSettings, CLOUDFLARE_IMAGE_MODEL_DEFAULT } from '../src/tutor/pictureSettings.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { createTutorViewState } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';
import { KREN_SECRET_KEYS } from '../src/operations.js';
import { missingCredentialError, missingCredentialDetails, missingCredentialMessage } from '../src/requestCenter.js';

vi.mock('vscode', () => ({
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
  window: {}, commands: {}, env: {}, Uri: { joinPath: () => ({ toString: () => 'test' }) }
}));
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { pauseTutorPictures } from '../src/resultsViewConversation.js';
import { disableTutorLive } from '../src/resultsViewLive.js';
import { TutorLiveSessionError } from '../src/tutor/liveSession.js';

const extension = readFileSync('src/extension.ts', 'utf8');
const transpile = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const both = { cloudflareAccountId: true, cloudflareApiToken: true };
const schnell = '@cf/black-forest-labs/flux-1-schnell';
const manifestOnly = { defaultValue: 'gemini' as const };
const table = [
  ['explicit Gemini', { globalValue: 'gemini' as const }, {}, both, 'gemini', true],
  ['explicit Cloudflare', { workspaceValue: 'cloudflare' as const }, {}, {}, 'cloudflare', true],
  ['explicit image', manifestOnly, { workspaceFolderValue: schnell }, both, 'cloudflare', false],
  ['both keys', manifestOnly, { defaultValue: schnell }, both, 'cloudflare', false],
  ['account only', manifestOnly, {}, { cloudflareAccountId: true }, 'gemini', false],
  ['token only', manifestOnly, {}, { cloudflareApiToken: true }, 'gemini', false],
  ['no keys', undefined, undefined, {}, 'gemini', false]
] as const;

describe('V294 effective picture settings', () => {
  it.each(table)('%s', (_name, provider, model, presence, expected, explicit) => {
    const result = effectivePictureSettings(provider, model, presence);
    expect(result).toEqual({ tutorPictureProvider: expected,
      tutorCloudflareImageModel: 'workspaceFolderValue' in (model ?? {}) ? schnell : CLOUDFLARE_IMAGE_MODEL_DEFAULT,
      tutorPictureProviderAutomatic: !explicit });
  });

  it.each(['globalValue', 'workspaceValue', 'workspaceFolderValue', 'globalLanguageValue',
    'workspaceLanguageValue', 'workspaceFolderLanguageValue'])('preserves explicit Gemini and image at %s', scope => {
    expect(effectivePictureSettings({ [scope]: 'gemini' }, { [scope]: schnell }, both))
      .toEqual({ tutorPictureProvider: 'gemini', tutorCloudflareImageModel: schnell, tutorPictureProviderAutomatic: false });
  });

  it('reads inspect at the display boundary and updates when credentials are added and removed', () => {
    const tree = ts.createSourceFile('extension.ts', extension, ts.ScriptTarget.Latest, true);
    const read = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'readPanelSettings')!;
    let call: ts.CallExpression | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(tree) === 'effectivePictureSettings') call = node;
      ts.forEachChild(node, visit);
    };
    visit(read);
    expect(call).toBeDefined();
    const storedSecretKeys = new Set<string>();
    const inspect = vi.fn((key: string) => key === 'tutor.pictureProvider' ? manifestOnly : { defaultValue: schnell });
    const readEffective = () => runInNewContext(transpile('result = ' + call!.getText(tree)), {
      effectivePictureSettings, pictureConfiguration: { inspect }, storedSecretKeys, KREN_SECRET_KEYS
    });
    expect(readEffective().tutorPictureProvider).toBe('gemini');
    storedSecretKeys.add(KREN_SECRET_KEYS.cloudflareAccountId);
    expect(readEffective().tutorPictureProvider).toBe('gemini');
    storedSecretKeys.add(KREN_SECRET_KEYS.cloudflareApiToken);
    expect(readEffective().tutorPictureProvider).toBe('cloudflare');
    storedSecretKeys.delete(KREN_SECRET_KEYS.cloudflareAccountId);
    expect(readEffective().tutorPictureProvider).toBe('gemini');
    expect(extension).toContain('vscode.window.activeTextEditor?.document ?? vscode.workspace.workspaceFolders?.[0]?.uri');
    expect(inspect).toHaveBeenCalledWith('tutor.pictureProvider');
    expect(inspect).toHaveBeenCalledWith('tutor.cloudflareImageModel');
    expect(extension).toContain('reconcileTutorPictureProviderChange(resultsView, previousPictureProvider);');
  });

  it.each(table)('%s: display and execution consume the same effective choice', async (_name, provider, model, presence) => {
    const settings = { ...PANEL_SETTINGS_FIXTURE, ...effectivePictureSettings(provider, model, presence) };
    const $ = load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'tutor', settings, proModels: [] }));
    expect($('[data-setting="tutor.pictureProvider"] option:selected').val()).toBe(settings.tutorPictureProvider);
    const note = $('[data-picture-provider-automatic]');
    expect(note.length).toBe(settings.tutorPictureProviderAutomatic ? 1 : 0);
    if (note.length) expect(note.text()).toBe(settings.tutorPictureProvider === 'cloudflare'
      ? 'Chosen automatically: Cloudflare (both Cloudflare keys are stored).' : 'Chosen automatically: Gemini Paid.');
    const start = extension.indexOf('generateSituationPicture: async');
    const action = extension.slice(start + 'generateSituationPicture: '.length, extension.indexOf('    transcribeTutorAudio:', start)).trim().replace(/,$/u, '');
    const cloudflare = vi.fn(async () => 'image'), gemini = vi.fn(async () => 'image');
    const callback = runInNewContext('(' + transpile('const action = ' + action).replace(/^const action = /u, '').replace(/;\s*$/u, '') + ')', {
      context: {}, readPanelSettings: () => settings, TUTOR_DEFAULTS: { configuration: {} },
      extensionRuntime: () => ({ getSecret: async () => 'present', beforeGeminiRequest: async () => {} }),
      generateCloudflareSituationPicture: cloudflare, generateSituationPicture: gemini, KREN_SECRET_KEYS,
      vscode: { workspace: { getConfiguration: () => ({ get: () => 'gemini-image' }) } }
    });
    await callback('Scene.', new AbortController().signal);
    expect(cloudflare).toHaveBeenCalledTimes(settings.tutorPictureProvider === 'cloudflare' ? 1 : 0);
    expect(gemini).toHaveBeenCalledTimes(settings.tutorPictureProvider === 'gemini' ? 1 : 0);
    if (cloudflare.mock.calls.length) expect(cloudflare.mock.calls[0]).toContain(settings.tutorCloudflareImageModel);
  });
});

const places = [
  ['Translation', 'settings', 'translation'], ['Grammar', 'settings', 'userDictionary'],
  ['Explain', 'settings', 'explanation'], ['Rewrite', 'settings', 'rewrite'],
  ['User Dictionary', 'settings', 'userDictionary'], ['LLM ROUTING', 'tutor', 'tutor'],
  ['Live Model', 'tutor', 'tutor.liveModel'], ['Gemini Image Model', 'tutor', 'tutor.imageModel']
] as const;
const commands = ['refreshGeminiModels', 'refreshProModels', 'refreshOpenAIModels',
  'refreshAnthropicModels', 'refreshGroqModels', 'refreshGeminiLiveModels', 'refreshGeminiImageModels'] as const;
const catalogs = ['gemini', 'gemini', 'openai', 'anthropic', 'groq', 'geminiLive', 'geminiImage'];

function host(settings = PANEL_SETTINGS_FIXTURE) {
  const refresh = Object.fromEntries(commands.map(command => [command, vi.fn(async () => [{ id: 'discovered-model', displayName: 'Discovered model' }])])) as Record<typeof commands[number], ReturnType<typeof vi.fn>>;
  const actions = { settings: () => settings, generateTutor: vi.fn(), log: vi.fn(), ...refresh };
  const view = new KrenResultsViewProvider(actions as never, {} as never);
  return { view, actions };
}

describe('V294 mounted Refresh results', () => {
  for (const [place, screen, prefix] of places) {
    const relevant = prefix.endsWith('liveModel') ? [commands[5]] : prefix.endsWith('imageModel') ? [commands[6]] : commands.slice(0, 5);
    for (const command of relevant) {
      const slots = screen === 'settings' ? ['model', 'alternateModel', 'fallbackModel']
        : prefix === 'tutor' ? ['model', 'alternateModel'] : [''];
      for (const slot of slots) {
        if ((slot === 'alternateModel' || slot === 'fallbackModel') && command !== 'refreshProModels') continue;
        if (slot === 'model' && command === 'refreshProModels') continue;
        it(`${place} ${slot} ${command}: zero scroll difference, focus, disclosures, selection and catalog`, async () => {
          await new Promise<void>(resolve => setImmediate(resolve));
          const catalog = catalogs[commands.indexOf(command)]!;
          const provider = ['geminiLive', 'geminiImage'].includes(catalog) ? 'gemini' : catalog;
          const profile = command === 'refreshProModels' ? 'pro' : 'standard';
          const settings = { ...PANEL_SETTINGS_FIXTURE, tutorPictureProvider: 'gemini' as const,
            credentialPresence: { geminiDefault: true, geminiAlternate: true, cloudflareAccountId: true, cloudflareApiToken: true, groq: true, openai: true, anthropic: true, googleCloudTranslation: true, googleCloudTextToSpeech: true },
            translationModel: 'stored-model', translationAlternateModel: 'stored-model', translationFallbackModel: 'stored-model',
            explanationModel: 'stored-model', explanationAlternateModel: 'stored-model', explanationFallbackModel: 'stored-model',
            rewriteModel: 'stored-model', rewriteAlternateModel: 'stored-model', rewriteFallbackModel: 'stored-model',
            userDictionaryModel: 'stored-model', userDictionaryAlternateModel: 'stored-model', userDictionaryFallbackModel: 'stored-model',
            tutorModel: 'stored-model', tutorAlternateModel: 'stored-model', tutorLiveModel: 'stored-model', tutorImageModel: 'stored-model',
            tutorProvider: provider, translationRoutingProvider: provider, explanationProvider: provider,
            rewriteProvider: provider, userDictionaryProvider: provider,
            tutorProfile: profile, translationProfile: profile, explanationProfile: profile, rewriteProfile: profile,
            userDictionaryProfile: profile, userDictionaryFallbackEnabled: true, translationFallbackEnabled: true,
            explanationFallbackEnabled: true, rewriteFallbackEnabled: true } as typeof PANEL_SETTINGS_FIXTURE;
          const { view, actions } = host(settings);
          const html = renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: screen, settings,
            tutor: createTutorViewState(), proModels: [{ id: 'stored-model', displayName: 'Stored model' }],
            openAIModels: [{ id: 'stored-model', displayName: 'Stored model' }], anthropicModels: [{ id: 'stored-model', displayName: 'Stored model' }] });
          const internals = view as unknown as { activeScreen: string; handleMessage(message: unknown): Promise<void> };
          const sent: Record<string, unknown>[] = [];
          const panel = mountedPanel(html, message => { sent.push(message); void internals.handleMessage(message); });
          expect(sent.filter(message => message.command === 'panelScriptError')).toEqual([]);
          internals.activeScreen = screen;
          const replacement = vi.fn();
          view.view = { webview: { cspSource: 'test', asWebviewUri: () => ({ toString: () => '' }), postMessage: async (message: Record<string, unknown>) => { try { panel.message(message); } catch (error) { sent.push({ command: 'patchError', error: String(error) }); } return true; },
            get html() { return html; }, set html(value: string) { replacement(value); panel.evaluate('window.scrollY = 0'); } } } as never;
          const key = slot ? prefix + '.' + slot : prefix;
          const selects = panel.document.querySelectorAll(`[data-model-preset="${key}"]`);
          // Grammar and User Dictionary deliberately exercise both duplicate routing controls.
          if (place === 'Grammar' || place === 'User Dictionary') expect(selects).toHaveLength(2);
          const select = place === 'User Dictionary' ? selects.at(-1)! : selects[0]!;
          expect(select).toBeTruthy();
          const button = select.closest('label')!.querySelector(`[data-command="${command}"]`)!;
          expect(button, `${key} Refresh must be keyboard reachable`).toBeTruthy();
          expect(button.disabled).toBe(false);
          expect(button.getAttribute('tabindex')).not.toBe('-1');
          const disclosures = panel.document.querySelectorAll('details');
          for (const section of disclosures) section.open = true;
          expect(button.closest('[hidden], .hidden')).toBeNull();
          const selected = select.value;
          const selections = selects.map(control => control.value);
          button.focus();
          const focus = vi.spyOn(button, 'focus');
          panel.evaluate('window.scrollX = 0; window.scrollY = 731; window.scrollTo = (x, y) => { window.scrollX = x; window.scrollY = y; };');
          // Inject layout/focus disturbance during an option update to test restoration, because
          // the DOM adapter has no browser layout or scroll anchoring of its own.
          const replaceOptions = select.replaceChildren.bind(select);
          vi.spyOn(select, 'replaceChildren').mockImplementation((...children) => {
            replaceOptions(...children); panel.document.activeElement = null; panel.evaluate('window.scrollY = 619');
          });
          panel.click(button);
          expect(sent).toContainEqual(expect.objectContaining({ command }));
          await vi.waitFor(() => expect(actions[command]).toHaveBeenCalledOnce());
          for (let step = 0; step < 8; step++) await Promise.resolve();
          expect(sent.filter(message => message.command === 'patchError')).toEqual([]);
          expect(actions.log.mock.calls).toEqual([]);
          expect(panel.evaluate('window.scrollY')).toBe(731);
          expect(panel.document.activeElement === button).toBe(true);
          expect(focus).toHaveBeenCalledWith({ preventScroll: true });
          expect(select.querySelector('option[value="discovered-model"]')).not.toBeNull();
          expect(select.value).toBe(selected);
          expect(disclosures.every(section => section.open && section.isConnected)).toBe(true);
          expect(panel.document.querySelectorAll(`[data-model-preset="${key}"]`)).toEqual(selects);
          for (const duplicate of selects) expect(duplicate.querySelector('option[value="discovered-model"]')).not.toBeNull();
          expect(selects.map(control => control.value)).toEqual(selections);
          expect(sent.some(message => message.command === 'updateSetting')).toBe(false);
          expect(replacement).not.toHaveBeenCalled();
        });
      }
    }
  }
});

describe('V293 deferred notice boundaries', () => {
  // Changed 2026-10-23 (V300, verification R28): an active picture pause also shows the shared popup.
  it('Gemini picture pauses name Paid and offer reachable Open Credentials alongside the popup', () => {
    const { view } = host();
    const messages: Record<string, unknown>[] = [];
    view.view = { webview: { postMessage: async (message: Record<string, unknown>) => { messages.push(message); return true; } } } as never;
    const notice = vi.spyOn(view, 'showMissingCredentialError');
    vi.spyOn(view, 'showErrorMessage').mockResolvedValue(undefined);
    Object.assign(view.tutorState.conversation, { status: 'active', situationPicture: 'intro' });
    pauseTutorPictures(view, 'missing', false);
    const text = view.tutorState.conversation.picturePaused!;
    expect(text).toBe(missingCredentialMessage(missingCredentialDetails('gemini', 'pro')));
    expect(text).toContain('Gemini Paid');
    expect(notice).toHaveBeenCalledWith(expect.objectContaining({ missingCredentials: {
      provider: 'gemini', geminiProfile: 'pro', slots: ['API key'], action: 'openCredentials'
    } }), true);
    const tutor = view.tutorState;
    const $ = load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'tutor',
      settings: { ...PANEL_SETTINGS_FIXTURE, credentialPresence: { geminiDefault: true, geminiAlternate: true } }, tutor, proModels: [] }));
    expect(messages).toContainEqual({ command: 'tutorPicturePaused', text });
    // The real shipped message handler decorates the notice with a Credentials link.
    const sent: Record<string, unknown>[] = [];
    const panel = mountedPanel($.html(), message => { sent.push(message); });
    const target = panel.query('[data-tutor-picture-paused]')!;
    panel.message({ command: 'tutorPicturePaused', text });
    const link = target.querySelector('[data-command="showCredentials"]')!;
    expect(link.textContent).toBe('Open Credentials');
    expect(link.closest('details, [hidden]')).toBeNull();
    expect(link.getAttribute('href')).toBe('#');
    expect(link.getAttribute('tabindex')).not.toBe('-1');
    link.focus();
    expect(panel.document.activeElement === link).toBe(true);
    panel.click(link);
    expect(sent).toContainEqual(expect.objectContaining({ command: 'showCredentials' }));
  });

  it.each(['standard', 'pro'] as const)('Live fallback names %s profile and offers Open Credentials', async profile => {
    const { view } = host();
    const show = vi.spyOn(view, 'showErrorMessage').mockResolvedValue(undefined);
    disableTutorLive(view, new TutorLiveSessionError('socketOpen'), 'opening', missingCredentialDetails('gemini', profile));
    await Promise.resolve();
    expect(show).toHaveBeenCalledWith(expect.stringContaining(profile === 'pro' ? 'Gemini Paid' : 'Gemini Free Tier'),
      { modal: true }, 'Open Credentials');
    expect(show.mock.calls[0]![0]).toContain('KREN continues with Standard replies.');
    expect(view.tutorLiveFailed).toBe(true);
  });
});
