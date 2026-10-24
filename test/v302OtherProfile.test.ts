import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { load } from 'cheerio';
import { capabilityAvailability, renderKrenResultViewHtml, type KrenPanelSettings } from '../src/resultViewHtml.js';
import { missingCredentialDetails, missingCredentialError, missingCredentialMessage, missingCredentialsOf,
  missingCredentialSelectionMessage, showMissingCredentialNotice } from '../src/requestCenter.js';
import { runKrenOperation, KREN_SECRET_KEYS, type KrenRuntime } from '../src/operations.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

vi.mock('vscode', () => ({
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
  window: {}, commands: {}, env: {}, Uri: { joinPath: () => ({ toString: () => 'test' }) }
}));
import { KrenResultsViewProvider } from '../src/resultsView.js';

type Presence = NonNullable<KrenPanelSettings['credentialPresence']>;
const states = [
  ['both', true, true], ['Free-only', true, false], ['Paid-only', false, true], ['neither', false, false]
] as const;
const hints = {
  standard: " Gemini Paid has a key: choose Paid in this feature's settings to use it.",
  pro: " Gemini Free Tier has a key: choose Free Tier in this feature's settings to use it."
};
const cancel = ' Or press Cancel and choose another provider.';
const base = (profile: 'standard' | 'pro') => `Set your Gemini ${profile === 'pro' ? 'Paid' : 'Free Tier'} API key in KREN menu, Credentials.`;
const noteBase = (profile: 'standard' | 'pro') => `No Gemini ${profile === 'pro' ? 'Paid' : 'Free Tier'} key yet.`;
function settings(presence: Presence, profile: 'standard' | 'pro'): KrenPanelSettings {
  return { ...PANEL_SETTINGS_FIXTURE, credentialPresence: presence, translationProvider: 'gemini',
    translationRoutingProvider: 'gemini', translationProfile: profile, explanationProvider: 'gemini', explanationProfile: profile };
}
function html(value: KrenPanelSettings, activeScreen: 'settings' | 'result' = 'settings') {
  return renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', settings: value, activeScreen, proModels: [] });
}
const extension = readFileSync('src/extension.ts', 'utf8');
function extensionFunction(name: string, dependencies: Record<string, unknown>) {
  const source = ts.createSourceFile('extension.ts', extension, ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
  const js = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(js + '\n' + name, dependencies) as (...args: any[]) => Promise<unknown>;
}
afterEach(() => vi.unstubAllGlobals());

describe('V302 other Gemini profile guidance', () => {
  for (const profile of ['standard', 'pro'] as const) {
    it.each(states)(`${profile} %s: Translate popup, Start Translation reason and Explain profile note`, async (_state, free, paid) => {
      const presence = { geminiDefault: free, geminiAlternate: paid };
      const selected = profile === 'pro' ? paid : free;
      const other = profile === 'pro' ? free : paid;
      const hint = !selected && other ? hints[profile] : '';
      const value = settings(presence, profile);
      expect(missingCredentialMessage(missingCredentialDetails('gemini', profile), presence)).toBe(base(profile) + hint);
      expect(missingCredentialSelectionMessage(missingCredentialDetails('gemini', profile), presence)).toBe(noteBase(profile) + hint);

      // Exercise the real host presence wiring and the Translate action's error boundary.
      const view = new KrenResultsViewProvider({ settings: () => value } as never, {} as never);
      const popup = vi.spyOn(view, 'showErrorMessage').mockResolvedValue(undefined);
      const showLookupError = extensionFunction('showLookupError', { missingCredentialsOf, showMissingCredentialNotice, resultsView: view });
      if (!selected) {
        const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
        const rt: KrenRuntime = {
          getSetting: <T>(key: string, fallback: T) => ({ translationProvider: 'gemini',
            'translation.geminiProfile': profile, 'llm.providerSwitch': false }[key] ?? fallback) as T,
          getSecret: async key => (key === KREN_SECRET_KEYS.gemini && free || key === KREN_SECRET_KEYS.geminiPro && paid) ? 'configured' : undefined,
          reserveCloudCharacters: async () => {}, beforeGeminiRequest: async () => {}
        };
        const error = await runKrenOperation(rt, 'translate', { text: 'Hello.' }, new AbortController().signal).catch(error => error);
        expect(missingCredentialsOf(error)).toMatchObject({ provider: 'gemini', geminiProfile: profile });
        await showLookupError(error, undefined, true);
        expect(fetcher).not.toHaveBeenCalled();
      } else {
        // A stale missing-key descriptor must not suggest switching when its key is now stored.
        await showLookupError(missingCredentialError('gemini', profile), undefined, true);
      }
      expect(popup).toHaveBeenCalledWith(base(profile) + hint + cancel, { modal: true }, 'Open Credentials');

      const translation = capabilityAvailability(value).find(item => item.label === 'Translation')!;
      expect(translation.available).toBe(selected);
      expect(translation.reason).toBe(base(profile) + hint);
      const $ = load(html(value));
      const note = $('[data-credential-setting="explanation.provider"]');
      expect(note.is('[hidden]')).toBe(selected);
      expect(note.find('span').text()).toBe(selected ? '' : noteBase(profile) + hint);
      // The note follows the profile selector's group, so it cannot be folded away on its own.
      expect(note.prev().find('[data-setting="explanation.geminiProfile"]')).toHaveLength(1);
      const start = load(html(value, 'result'));
      const button = start('[data-action="kren.translateSelection"]');
      expect(button.is('[disabled]')).toBe(!selected);
      expect(button.find('.capability-reason').text()).toBe(selected ? '' : base(profile) + hint);
      expect(button.parents('details:not([open]), [hidden], .hidden')).toHaveLength(0);
    });

    it.each(states)(`${profile} %s: mounted Explain presence updates preserve the selector and reachability`, (_state, free, paid) => {
      const panel = mountedPanel(html(settings({}, profile)), vi.fn());
      const control = panel.query('[data-setting="explanation.geminiProfile"]')!;
      for (const section of panel.document.querySelectorAll('details')) section.open = true;
      for (const presence of [{ geminiDefault: free, geminiAlternate: paid }, { geminiDefault: paid, geminiAlternate: free }]) {
        panel.message({ command: 'credentialPresenceReady', presence });
        const selected = profile === 'pro' ? presence.geminiAlternate : presence.geminiDefault;
        const other = profile === 'pro' ? presence.geminiDefault : presence.geminiAlternate;
        const note = panel.query('[data-credential-setting="explanation.provider"]')!;
        expect(note.hidden).toBe(selected);
        expect(note.querySelector('span')!.textContent).toBe(selected ? '' : noteBase(profile) + (other ? hints[profile] : ''));
        expect(panel.query('[data-setting="explanation.geminiProfile"]')).toBe(control);
        expect(control.value).toBe(profile);
        if (!selected) {
          const link = note.querySelector('a[data-command="showCredentials"]')!;
          expect(link.closest('[hidden], .hidden')).toBeNull();
          expect(link.closest('details:not([open])')).toBeNull();
          link.focus(); expect(panel.document.activeElement).toBe(link);
          panel.click(link);
        }
      }
    });
  }

  it('changing Gemini profiles updates the mounted hint and Refresh preserves it', () => {
    const panel = mountedPanel(html(settings({ geminiAlternate: true }, 'standard')), vi.fn());
    const control = panel.query('[data-setting="explanation.geminiProfile"]')!;
    const text = () => panel.query('[data-credential-setting="explanation.provider"]')!.querySelector('span')!.textContent;
    expect(text()).toBe(noteBase('standard') + hints.standard);
    control.value = 'pro'; panel.change(control); expect(text()).toBe('');
    control.value = 'standard'; panel.change(control); expect(text()).toBe(noteBase('standard') + hints.standard);
    panel.message({ command: 'modelCatalogReady', catalog: 'gemini', models: [{ id: 'new-model', displayName: 'New' }] });
    expect(text()).toBe(noteBase('standard') + hints.standard);
  });

  it.each(['standard', 'pro'] as const)('Credentials Test of Gemini %s retains its original popup with the other key stored', async profile => {
    const value = settings({ geminiDefault: profile === 'pro', geminiAlternate: profile === 'standard' }, profile);
    const view = new KrenResultsViewProvider({ settings: () => value } as never, {} as never);
    const popup = vi.spyOn(view, 'showErrorMessage').mockResolvedValue(undefined);
    const showLookupError = extensionFunction('showLookupError', { missingCredentialsOf, showMissingCredentialNotice, resultsView: view });
    const testConnection = extensionFunction('testLanguageModelConnection', { showLookupError,
      missingSecretCredential: () => missingCredentialError('gemini', profile) });
    const list = vi.fn();
    await testConnection({ secrets: { get: async () => undefined } }, 'Gemini', profile === 'pro' ? 'geminiPro' : 'gemini', 'setKey', list);
    expect(list).not.toHaveBeenCalled();
    expect(popup).toHaveBeenCalledWith(base(profile), { modal: true }, 'Open Credentials');
  });

  it.each(['openai', 'anthropic', 'groq', 'cloudflare'] as const)('%s does not mention a stored Gemini key', async provider => {
    const presence = { geminiAlternate: true };
    const details = missingCredentialDetails(provider);
    const popup = vi.fn(async () => undefined);
    await showMissingCredentialNotice(details, { credentialPresence: () => presence, showErrorMessage: popup, showCredentials: async () => {} }, '', true);
    expect(popup).toHaveBeenCalledWith(missingCredentialMessage(details) + cancel, { modal: true }, 'Open Credentials');
    const value = { ...settings(presence, 'standard'), explanationProvider: provider };
    const $ = load(html(value));
    expect($('[data-credential-setting="explanation.provider"] span').text()).toBe(missingCredentialSelectionMessage(details));
  });
});
