import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { load } from 'cheerio';
import { renderKrenResultViewHtml, type KrenPanelSettings } from '../src/resultViewHtml.js';
import { createTutorViewState } from '../src/tutor/state.js';
import { missingCredentialDetails, missingCredentialError, missingCredentialMessage, missingCredentialsOf,
  showMissingCredentialNotice } from '../src/requestCenter.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

vi.mock('vscode', () => ({
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
  window: {}, commands: {}, env: {}, Uri: { joinPath: () => ({ toString: () => 'test' }) }
}));
import { KrenResultsViewProvider } from '../src/resultsView.js';

type Presence = NonNullable<KrenPanelSettings['credentialPresence']>;
const keyStates = [
  ['both', true, true], ['Free only', true, false], ['Paid only', false, true], ['neither', false, false]
] as const;
const grayClass = 'credential-missing';
function render(presence: Presence = {}, overrides: Partial<KrenPanelSettings> = {}, screen: 'tutor' | 'settings' = 'tutor') {
  const settings = { ...PANEL_SETTINGS_FIXTURE, translationProvider: 'gemini' as const,
    credentialPresence: presence, tutorPictureProvider: 'gemini' as const, tutorSpeechProvider: 'gemini' as const, ...overrides };
  const before = JSON.stringify(settings);
  return { settings, before, html: renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: screen,
    proModels: [{ id: 'gemini-3.5-flash', displayName: 'Flash' }], tutor: createTutorViewState(), settings }) };
}

describe('V297 initial rendering and selectable routing', () => {
  for (const prefix of ['explanation', 'tutor']) for (const profile of ['standard', 'pro'] as const) {
    it.each(keyStates)(`${prefix} ${profile}, %s: independent Gemini keys, selectable and preserved`, (_name, free, paid) => {
      const { settings, html, before } = render({ geminiDefault: free, geminiAlternate: paid },
        { explanationProfile: profile, tutorProfile: profile });
      const $ = load(html);
      const provider = $(`[data-setting="${prefix}.provider"]`);
      const profiles = $(`[data-setting="${prefix}.geminiProfile"]`);
      expect(profiles.find('option[value="standard"]').hasClass(grayClass)).toBe(!free);
      expect(profiles.find('option[value="pro"]').hasClass(grayClass)).toBe(!paid);
      expect(profiles.find('option[disabled]')).toHaveLength(0);
      expect(profiles.find('option[selected]').attr('value')).toBe(profile);
      const missing = !(profile === 'standard' ? free : paid);
      expect(provider.find('option[value="gemini"]').hasClass(grayClass)).toBe(missing);
      expect(provider.find('option[value="gemini"]').is('[disabled]')).toBe(false);
      expect(provider.find('option[selected]').attr('value')).toBe('gemini');
      expect(profiles.hasClass(grayClass)).toBe(missing);
      const model = $(`[data-model-preset="${prefix}.${profile === 'pro' ? 'alternateModel' : 'model'}"]`);
      expect(model.hasClass(grayClass)).toBe(missing);
      model.find('option').each((_i, option) => {
        expect($(option).hasClass(grayClass)).toBe(missing);
        expect($(option).is('[disabled]')).toBe(false);
        expect($(option).attr('aria-description')).toBe(missing ? 'No key stored' : undefined);
      });
      expect($(`[data-setting="${prefix}.thinkingOrEffort"]`).hasClass(grayClass)).toBe(missing);
      if (prefix === 'tutor') {
        expect($('[data-model-preset="tutor.hintModel"]').hasClass(grayClass)).toBe(missing);
        // Changed 2026-10-23 (V304, owner I75): Live defaults to its independent Free Tier profile.
        expect($('[data-model-preset="tutor.liveModel"]').hasClass(grayClass)).toBe(!free);
        expect($('[data-model-preset="tutor.imageModel"]').hasClass(grayClass)).toBe(!paid);
        expect($('[data-setting="tutor.pictureProvider"] option[value="gemini"]').hasClass(grayClass)).toBe(!paid);
        expect($('[data-setting="tutor.speechProvider"] option[value="gemini"]').hasClass(grayClass)).toBe(!free);
      }
      const note = $(`[data-credential-setting="${prefix}.provider"]`);
      expect(note.is('[hidden]')).toBe(!missing);
      if (missing) expect(note.text()).toContain(`No Gemini ${profile === 'pro' ? 'Paid' : 'Free Tier'} key yet.`);
      expect(JSON.stringify(settings)).toBe(before);
    });
  }
  it.each(['openai', 'anthropic', 'groq', 'cloudflare'] as const)('%s options and dependents follow presence, not capability disabling', provider => {
    for (const available of [false, true]) {
      const presence: Presence = { [provider]: available, cloudflareAccountId: available, cloudflareApiToken: available };
      const $ = load(render(presence, { explanationProvider: provider, tutorProvider: provider }).html);
      for (const prefix of ['translation', 'explanation', 'rewrite', 'userDictionary', 'tutor']) {
        $(`[data-setting="${prefix}.provider"] option[value="${provider}"]`).each((_i, option) => {
          expect($(option).hasClass(grayClass)).toBe(!available);
          expect($(option).is('[disabled]')).toBe(prefix === 'translation' && ['openai', 'anthropic'].includes(provider));
        });
      }
      expect($('[data-model-preset="explanation.model"]').hasClass(grayClass)).toBe(!available);
      expect($('[data-model-preset="tutor.hintModel"]').hasClass(grayClass)).toBe(!available);
    }
  });
  it.each([[false, false], [true, false], [false, true], [true, true]])('Cloudflare account=%s token=%s requires both', (account, token) => {
    const $ = load(render({ cloudflareAccountId: account, cloudflareApiToken: token }, { tutorPictureProvider: 'cloudflare' }).html);
    for (const key of ['tutor.provider', 'tutor.pictureProvider', 'tutor.speechProvider']) {
      expect($(`[data-setting="${key}"] option[value="cloudflare"]`).hasClass(grayClass)).toBe(!(account && token));
    }
    expect($('[data-setting="tutor.cloudflareImageModel"]').hasClass(grayClass)).toBe(!(account && token));
  });
  it('all routing dependents stay usable, and missing-key guidance is beside the selector and keyboard reachable', () => {
    const panel = mountedPanel(render().html, vi.fn());
    for (const section of panel.document.querySelectorAll('details')) section.open = true;
    for (const key of ['explanation.geminiProfile', 'explanation.thinkingOrEffort', 'explanation.fallbackEnabled',
      'explanation.fallbackThinkingOrEffort', 'tutor.hintThinkingOrEffort']) {
      const control = panel.query(`[data-setting="${key}"]`)!;
      expect(control.classList.contains(grayClass)).toBe(true);
      expect(control.disabled).toBe(false);
    }
    for (const key of ['explanation.model', 'explanation.fallbackModel', 'tutor.hintModel', 'tutor.liveModel', 'tutor.imageModel']) {
      const control = panel.query(`[data-model-preset="${key}"]`)!;
      expect(control.classList.contains(grayClass)).toBe(true);
      expect(control.disabled).toBe(false);
      expect(control.getAttribute('tabindex')).not.toBe('-1');
    }
    const provider = panel.query('[data-setting="tutor.provider"]')!;
    expect(provider.closest('[hidden], .hidden')).toBeNull();
    provider.focus();
    expect(panel.document.activeElement).toBe(provider);
    const note = panel.query('[data-credential-setting="tutor.provider"]')!;
    expect(note.parentElement).toBe(provider.closest('label')!.parentElement);
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('No Gemini Free Tier key yet.');
    const link = note.querySelector('a[data-command="showCredentials"]')!;
    expect(link.closest('[hidden], .hidden')).toBeNull();
    expect(link.href).toBe('#');
    expect(link.getAttribute('tabindex')).not.toBe('-1');
    link.focus();
    expect(panel.document.activeElement).toBe(link);
  });
});

describe('V297 mounted presence and Refresh updates', () => {
  it('adding and deleting keys updates every mounted route without changing controls or choices', () => {
    const sent: unknown[] = [];
    const panel = mountedPanel(render().html, message => sent.push(message));
    const selects = panel.document.querySelectorAll('select');
    const choices = selects.map(control => control.value);
    for (const present of [true, false, true]) {
      panel.message({ command: 'credentialPresenceReady', presence: { geminiDefault: present, geminiAlternate: present,
        openai: present, anthropic: present, groq: present, cloudflareAccountId: present, cloudflareApiToken: present } });
      for (const prefix of ['translation', 'explanation', 'rewrite', 'userDictionary', 'tutor']) {
        for (const provider of panel.document.querySelectorAll(`[data-setting="${prefix}.provider"]`)) {
          expect(provider.classList.contains(grayClass)).toBe(!present);
          for (const option of provider.options) expect(option.classList.contains(grayClass)).toBe(!present);
        }
      }
      expect(panel.query('[data-credential-setting="tutor.provider"]')!.hidden).toBe(present);
      expect(selects.map(control => control.value)).toEqual(choices);
      selects.forEach(control => expect(control.isConnected).toBe(true));
    }
    expect(sent.filter((message: any) => message.command === 'updateSetting')).toEqual([]);
  });
  it('the host refresh publishes presence even when its tutor render is patched', () => {
    const { settings } = render({ geminiDefault: true });
    const view = new KrenResultsViewProvider({ settings: () => settings } as never, {} as never);
    const internals = view as any;
    const postMessage = vi.fn();
    view.view = { webview: { postMessage } } as never;
    const redraw = vi.spyOn(internals, 'render').mockImplementation(() => {});
    vi.spyOn(internals, 'syncTutorRoutingSettings').mockImplementation(() => {});
    // No speech refresh is needed to observe the synchronous presence delivery.
    postMessage.mockImplementation(() => { view.view = undefined; return Promise.resolve(true); });
    view.refresh();
    expect(postMessage).toHaveBeenCalledWith({ command: 'credentialPresenceReady', presence: settings.credentialPresence });
    expect(redraw).toHaveBeenCalledOnce();
  });
  it.each(['gemini', 'geminiLive', 'geminiImage'])('Refresh %s reapplies gray to rebuilt options and keeps every selection', catalog => {
    const panel = mountedPanel(render().html, vi.fn());
    const controls = panel.document.querySelectorAll('select');
    const selected = controls.map(control => control.value);
    for (const present of [false, true, false]) {
      panel.message({ command: 'credentialPresenceReady', presence: { geminiDefault: present, geminiAlternate: present } });
      panel.message({ command: 'modelCatalogReady', catalog, models: [{ id: 'new-model', displayName: 'Discovered model' }] });
      const missing = ['gemini', 'geminiLive', 'geminiImage'].includes(catalog) ? !present : true;
      const patched = panel.document.querySelectorAll(`[data-model-catalog="${catalog}"]`);
      expect(patched.length).toBeGreaterThan(0);
      patched.forEach(select => select.options.forEach(option => {
        expect(option.classList.contains(grayClass)).toBe(missing);
        expect(option.getAttribute('aria-description')).toBe(missing ? 'No key stored' : null);
        expect(option.disabled).toBe(false);
      }));
      expect(controls.map(control => control.value)).toEqual(selected);
    }
  });
  it.each(['openai', 'anthropic', 'groq'] as const)('Refresh rebuilds the missing %s catalog as gray', provider => {
    const panel = mountedPanel(render({}, { tutorProvider: provider }).html, vi.fn());
    panel.message({ command: 'modelCatalogReady', catalog: provider, models: [{ id: 'new-model', displayName: 'New' }] });
    const select = panel.query('[data-model-preset="tutor.model"]')!;
    expect(select.querySelector('[value="new-model"]')!.classList.contains(grayClass)).toBe(true);
    expect(select.querySelector('[value="new-model"]')!.disabled).toBe(false);
  });
  it('mounted tutor settings patch retains independent profile styling and the selected profile', () => {
    const panel = mountedPanel(render({}, { tutorProfile: 'pro' }).html, vi.fn());
    for (const section of panel.document.querySelectorAll('details')) section.open = true;
    const after = render({ geminiAlternate: true }, { tutorProfile: 'pro' });
    panel.message({ command: 'credentialPresenceReady', presence: { geminiAlternate: true } });
    panel.message({ command: 'tutorVoiceModelReady', html: after.html });
    const select = panel.query('[data-setting="tutor.geminiProfile"]')!;
    expect(select.value).toBe('pro');
    expect(select.querySelector('[value="standard"]')!.classList.contains(grayClass)).toBe(true);
    expect(select.querySelector('[value="pro"]')!.classList.contains(grayClass)).toBe(false);
    expect(panel.query('[data-model-preset="tutor.alternateModel"]')!.classList.contains(grayClass)).toBe(false);
  });
});

const extension = readFileSync('src/extension.ts', 'utf8');
function extensionFunction(name: string, dependencies: Record<string, unknown>) {
  const source = ts.createSourceFile('extension.ts', extension, ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
  const js = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(js + '\n' + name, dependencies) as (...args: any[]) => Promise<unknown>;
}
describe('V297 caller-selected missing-key popup advice', () => {
  it('a feature popup contains both sentences and Open Credentials opens the page', async () => {
    const showErrorMessage = vi.fn(async () => 'Open Credentials'), showCredentials = vi.fn(async () => {});
    await showMissingCredentialNotice(missingCredentialDetails('groq'), { showErrorMessage, showCredentials }, '', true);
    expect(showErrorMessage).toHaveBeenCalledWith(missingCredentialMessage(missingCredentialDetails('groq')) +
      ' Or press Cancel and choose another provider.', { modal: true }, 'Open Credentials');
    expect(showCredentials).toHaveBeenCalledOnce();
  });
  it.each(['Credentials Test', 'model Refresh', 'Live fallback', 'fixed dictionary'])('%s keeps its current wording', async context => {
    const showErrorMessage = vi.fn(async (_message: string) => undefined), showCredentials = vi.fn(async () => {});
    const showLookupError = extensionFunction('showLookupError', { missingCredentialsOf, showMissingCredentialNotice,
      resultsView: { showErrorMessage, showCredentials } });
    if (context === 'Live fallback') await showMissingCredentialNotice(missingCredentialDetails('gemini'),
      { showErrorMessage, showCredentials }, 'KREN continues with Standard replies.');
    else if (context === 'fixed dictionary') await showLookupError(missingCredentialError('merriamWebsterCollegiate'), undefined, true);
    else {
      const action = extensionFunction(context === 'Credentials Test' ? 'testLanguageModelConnection' : 'refreshLanguageModels', {
        showLookupError, missingSecretCredential: () => missingCredentialError('groq')
      });
      const host = { secrets: { get: vi.fn(async () => undefined) } }, listModels = vi.fn();
      if (context === 'Credentials Test') await action(host, 'Groq', 'groq', 'setKey', listModels);
      else await action(host, 'groq', 'setKey', 'Groq', listModels, []);
      expect(listModels).not.toHaveBeenCalled();
    }
    expect(showErrorMessage.mock.calls[0]![0]).not.toContain('choose another provider');
    expect(showCredentials).not.toHaveBeenCalled();
  });
  it('the editor and tutor callers pass feature advice explicitly', async () => {
    const showErrorMessage = vi.fn(async (_message: string) => undefined), showCredentials = vi.fn(async () => {});
    const showLookupError = extensionFunction('showLookupError', { missingCredentialsOf, showMissingCredentialNotice,
      resultsView: { showErrorMessage, showCredentials } });
    await showLookupError(missingCredentialError('gemini'), undefined, true);
    expect(showErrorMessage.mock.calls[0]![0]).toContain('Or press Cancel and choose another provider.');
    const view = new KrenResultsViewProvider({ settings: () => PANEL_SETTINGS_FIXTURE } as never, {} as never);
    const tutorNotice = vi.spyOn(view, 'showErrorMessage').mockResolvedValue(undefined);
    view.showMissingCredentialError(missingCredentialError('groq'), true);
    expect(tutorNotice.mock.calls[0]![0]).toContain('Or press Cancel and choose another provider.');
    for (const file of ['resultsViewLesson', 'resultsViewPractice', 'resultsViewConversation', 'resultsViewTurns',
      'resultsViewDemo', 'resultsViewReplay', 'resultsViewDictation']) {
      const calls = readFileSync(`src/${file}.ts`, 'utf8').match(/showMissingCredentialError\([^)]*\)/g) ?? [];
      expect(calls.length).toBeGreaterThan(0);
      calls.forEach(call => expect(call).toMatch(/, true\)$/));
    }
  });
});
