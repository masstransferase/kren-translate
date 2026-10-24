import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { load } from 'cheerio';
import { GLOBAL_ROUTING_DEFAULTS, GLOBAL_ROUTING_SUFFIXES, PANEL_SETTING_KEYS, globalRoutingPlan,
  globalRoutingSettings, validatedPanelSetting, type KrenPanelSettingKey } from '../src/panelSettings.js';
import { renderKrenResultViewHtml, type KrenPanelSettings } from '../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
  window: {}, commands: {}, env: {}, Uri: { joinPath: () => ({ toString: () => 'test' }) } }));
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { isCommandMessage } from '../src/resultsViewCommands.js';

const manifest = JSON.parse(readFileSync('package.json', 'utf8')).contributes.configuration.properties;
const extension = readFileSync('src/extension.ts', 'utf8');
const prefixes = ['translation', 'userDictionary', 'explanation', 'rewrite'];
const chosen = { provider: 'groq', geminiProfile: 'pro', model: 'llama-3.3-70b-versatile',
  alternateModel: 'gemini-3.1-pro-preview', thinkingOrEffort: 'high', fallbackEnabled: true,
  fallbackModel: 'gemini-3.6-flash', fallbackThinkingOrEffort: 'high' };
function configuration(provider = 'groq') {
  const values: Record<string, unknown> = {};
  const overrides: Record<string, Record<string, unknown>> = {};
  for (const prefix of prefixes) Object.assign(values, Object.fromEntries(Object.entries({
    provider: 'gemini', geminiProfile: 'standard', model: 'old-model', alternateModel: 'old-paid',
    thinkingOrEffort: 'low', fallbackEnabled: false, fallbackModel: 'old-fallback', fallbackThinkingOrEffort: 'low'
  }).map(([suffix, value]) => [`${prefix}.${suffix}`, value])));
  for (const suffix of GLOBAL_ROUTING_SUFFIXES) values[`global.${suffix}`] = suffix === 'provider' ? provider : chosen[suffix];
  values.translationProvider = 'googleCloudTranslation';
  values['grammar.smart'] = false;
  values['tutor.provider'] = 'anthropic';
  const config = {
    get: (key: string, fallback?: unknown) => overrides[key]?.workspaceFolderValue ?? overrides[key]?.workspaceValue ?? values[key] ?? manifest[`kren.${key}`]?.default ?? fallback,
    inspect: (key: string) => ({ defaultValue: manifest[`kren.${key}`]?.default, globalValue: values[key], ...overrides[key] }),
    update: vi.fn(async (key: string, value: unknown, _target: number) => { values[key] = value; })
  };
  return { config: config as never, values, overrides, update: config.update };
}
function hostFunction(name: string, dependencies: Record<string, unknown>) {
  const source = ts.createSourceFile('extension.ts', extension, ts.ScriptTarget.Latest, true);
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
  return runInNewContext(ts.transpileModule(`let globalRoutingApplyPending = false; ${fn.getText(source)}; ${name};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, dependencies);
}
function host(provider = 'groq', answer: string | undefined = 'Apply') {
  const state = configuration(provider);
  const confirm = vi.fn<(...args: unknown[]) => Promise<string | undefined>>(async () => answer);
  const refresh = vi.fn();
  const getConfiguration = vi.fn(() => state.config);
  const run = hostFunction('applyGlobalRouting', { vscode: { workspace: { getConfiguration }, ConfigurationTarget: { Global: 1 } },
    globalRoutingPlan, showKrenWarningMessage: confirm, resultsView: { refresh } });
  return { ...state, confirm, refresh, run };
}
function html(settings: Partial<KrenPanelSettings> = {}) {
  return renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'settings',
    proModels: [{ id: 'gemini-3.6-flash', displayName: 'Flash' }],
    settings: { ...PANEL_SETTINGS_FIXTURE, credentialPresence: {}, ...settings } });
}

describe('V299 Apply to All host writes', () => {
  it('applies Groq to all four routings and previews every changed value before writing', async () => {
    const h = host();
    h.confirm.mockImplementation(async (...args: unknown[]) => {
      expect(h.update).not.toHaveBeenCalled();
      expect(args).toHaveLength(4);
      expect(args[1]).toMatchObject({ modal: true });
      const detail = (args[1] as { detail: string }).detail;
      for (const name of ['Translation', 'Grammar and User Dictionary', 'Explain', 'Rewrite']) expect(detail).toContain(`${name}:`);
      for (const title of ['Provider', 'Gemini profile', 'Model', 'Paid model', 'Thinking level', 'Automatic fallback', 'Fallback model', 'Fallback thinking level']) expect(detail).toContain(`${title}:`);
      expect(detail).toContain('Gemini → Groq');
      return 'Apply';
    });
    await h.run();
    expect(h.confirm).toHaveBeenCalledOnce();
    expect(h.update).toHaveBeenCalledTimes(32);
    for (const prefix of prefixes) for (const suffix of GLOBAL_ROUTING_SUFFIXES) {
      expect(h.update).toHaveBeenCalledWith(`${prefix}.${suffix}`, chosen[suffix], 1);
    }
    expect(h.values.translationProvider).toBe('googleCloudTranslation');
    expect(h.values['grammar.smart']).toBe(false);
    expect(h.values['tutor.provider']).toBe('anthropic');
    expect(h.refresh).toHaveBeenCalledOnce();
  });
  it.each(['openai', 'anthropic'])('skips Translation entirely for %s with the reason', async provider => {
    const h = host(provider);
    const before = GLOBAL_ROUTING_SUFFIXES.map(suffix => h.values[`translation.${suffix}`]);
    await h.run();
    expect(h.update.mock.calls.filter(([key]) => key.startsWith('translation.'))).toEqual([]);
    expect(GLOBAL_ROUTING_SUFFIXES.map(suffix => h.values[`translation.${suffix}`])).toEqual(before);
    const detail = (h.confirm.mock.calls[0] as unknown as [string, { detail: string }])[1].detail;
    expect(detail).toContain(`Translation kept Gemini (Translation cannot use ${provider === 'openai' ? 'OpenAI' : 'Anthropic'}).`);
    expect(h.update).toHaveBeenCalledTimes(24);
  });
  it.each(['Cancel', undefined])('Cancel or dismiss (%s) makes zero writes', async answer => {
    const h = host('groq', answer);
    // An explicit undefined represents Escape or a closed dialog.
    h.confirm.mockResolvedValue(answer);
    const before = JSON.stringify(h.values);
    await h.run();
    expect(h.update).not.toHaveBeenCalled();
    expect(JSON.stringify(h.values)).toBe(before);
    expect(h.refresh).not.toHaveBeenCalled();
  });
  it('writes the shared Grammar and User Dictionary routing once and every changed key exactly once at Global', async () => {
    const h = host();
    await h.run();
    const calls = h.update.mock.calls;
    expect(calls.filter(([key]) => key.startsWith('userDictionary.'))).toHaveLength(8);
    expect(new Set(calls.map(([key]) => key)).size).toBe(calls.length);
    expect(calls.every(([, , target]) => target === 1)).toBe(true);
    h.update.mockClear();
    await h.run();
    expect(h.update).not.toHaveBeenCalled();
  });
  it('reports workspace and folder overrides and preserves them during Global writes', async () => {
    const h = host();
    h.overrides['explanation.model'] = { workspaceValue: 'workspace-model' };
    h.overrides['rewrite.provider'] = { workspaceFolderValue: 'gemini' };
    await h.run();
    const preview = (h.confirm.mock.calls[0] as unknown as [string, { detail: string }])[1].detail;
    expect(preview).toContain('Model: workspace override remains');
    expect(preview).toContain('Provider: folder override remains');
    expect(h.overrides['explanation.model']).toEqual({ workspaceValue: 'workspace-model' });
    expect(h.values['explanation.model']).toBe(chosen.model);
    expect(globalRoutingPlan(h.config).writes).toHaveLength(0);
  });
  it('reports an override in a different workspace folder', () => {
    const state = configuration();
    const folder = { name: 'Other folder', config: { inspect: (key: string) => key === 'translation.model' ? { workspaceFolderValue: 'folder-model' } : undefined } as never };
    expect(globalRoutingPlan(state.config, [folder]).preview).toContain('folder "Other folder" override remains');
  });
  it('opens only one preview for repeated presses while a choice is pending', async () => {
    const h = host();
    let finish!: (choice: string) => void;
    h.confirm.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = h.run();
    await h.run();
    expect(h.confirm).toHaveBeenCalledOnce();
    finish('Apply');
    await first;
    expect(h.update).toHaveBeenCalledTimes(32);
  });
});

describe('V299 saved choices and reachable panel controls', () => {
  it('declares and validates all eight saved choices using Translation defaults', () => {
    for (const suffix of GLOBAL_ROUTING_SUFFIXES) {
      const key = `global.${suffix}` as const;
      expect(PANEL_SETTING_KEYS.has(key)).toBe(true);
      expect(manifest[`kren.${key}`]).toMatchObject({ ...manifest[`kren.translation.${suffix}`], description: expect.any(String) });
      expect(manifest[`kren.${key}`].default).toBe(GLOBAL_ROUTING_DEFAULTS[suffix]);
      expect(validatedPanelSetting(key, chosen[suffix])).toBe(chosen[suffix]);
      expect(validatedPanelSetting(key, suffix === 'fallbackEnabled' ? 'true' : 'nonsense')).toBeUndefined();
    }
  });
  it('stores only the global draft and restores its rendered selections after reload', async () => {
    const state = configuration();
    for (const suffix of GLOBAL_ROUTING_SUFFIXES) state.values[`global.${suffix}`] = GLOBAL_ROUTING_DEFAULTS[suffix];
    const view = new KrenResultsViewProvider({ settings: () => ({ ...PANEL_SETTINGS_FIXTURE,
      globalRouting: globalRoutingSettings(state.config) }) } as never, {} as never);
    const snapshot = (view as any).settingsSnapshot();
    const before = Object.fromEntries(Object.entries(state.values).filter(([key]) => !key.startsWith('global.')));
    const update = hostFunction('updatePanelSetting', { validatedPanelSetting, vscode: { workspace: { getConfiguration: () => state.config }, ConfigurationTarget: { Global: 1 } } });
    for (const suffix of GLOBAL_ROUTING_SUFFIXES) await update(`global.${suffix}`, chosen[suffix]);
    expect(state.update.mock.calls.every(([key, , target]) => key.startsWith('global.') && target === 1)).toBe(true);
    expect(Object.fromEntries(Object.entries(state.values).filter(([key]) => !key.startsWith('global.')))).toEqual(before);
    expect((view as any).settingsSnapshot()).toBe(snapshot);
    const saved = globalRoutingSettings(state.config) as NonNullable<KrenPanelSettings['globalRouting']>;
    const $ = load(html({ globalRouting: saved }));
    expect($('[data-setting="global.provider"] option[selected]').attr('value')).toBe('groq');
    expect($('[data-setting="global.geminiProfile"] option[selected]').attr('value')).toBe('pro');
    expect($('[data-model-identifier="global.model"] input').attr('value')).toBe(chosen.model);
    expect(extension).toContain('globalRouting: globalRoutingSettings(configuration)');
  });
  it('keeps Apply to All immediately before Default Setting in the open Usage row and keyboard reachable', () => {
    const panel = mountedPanel(html(), vi.fn());
    const apply = panel.query('[data-action="kren.applyGlobalRouting"]')!;
    const usage = apply.closest('details')!;
    expect(usage.getAttribute('data-settings-section')).toBe('usage');
    expect(usage.open).toBe(true);
    expect(apply.closest('details details')).toBeNull();
    expect(apply.tagName).toBe('BUTTON');
    expect(apply.disabled).toBe(false);
    expect(apply.getAttribute('tabindex')).not.toBe('-1');
    expect(apply.parentElement!.children.map(child => child.getAttribute('data-action')))
      .toEqual(['kren.applyGlobalRouting', 'kren.restoreDefaultSettings', 'kren.resetKren']);
    expect(apply.className).toBe(panel.query('[data-action="kren.restoreDefaultSettings"]')!.className);
    apply.focus();
    expect(panel.document.activeElement).toBe(apply);
    expect(panel.query('[data-global-routing]')!.textContent).toContain('Missing keys can be added in Credentials.');
    expect(panel.query('[data-global-routing]')!.closest('details')!.open).toBe(true);
  });
  it('dispatches the real button through the bounded registered host command', async () => {
    const post = vi.fn();
    const panel = mountedPanel(html(), post);
    panel.click(panel.query('[data-action="kren.applyGlobalRouting"]')!);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ command: 'runCommand', action: 'kren.applyGlobalRouting' }));
    expect(isCommandMessage(post.mock.calls.at(-1)![0])).toBe(true);
    const vscode = await import('vscode');
    const execute = vi.fn(async () => undefined);
    Object.assign(vscode.commands, { executeCommand: execute });
    const view = new KrenResultsViewProvider({ settings: () => PANEL_SETTINGS_FIXTURE } as never, {} as never);
    await (view as any).handleMessage({ command: 'runCommand', action: 'kren.applyGlobalRouting' });
    expect(execute).toHaveBeenCalledExactlyOnceWith('kren.applyGlobalRouting');
    expect(extension).toContain("vscode.commands.registerCommand('kren.applyGlobalRouting', () => applyGlobalRouting())");
    expect(readFileSync('src/resultsView.ts', 'utf8')).toContain("message.action !== 'kren.applyGlobalRouting'");
  });
  it.each([[true, true], [true, false], [false, true], [false, false]])('keeps global routing selectable with independent Gemini credentials %s/%s', (free, paid) => {
    const panel = mountedPanel(html({ credentialPresence: { geminiDefault: free, geminiAlternate: paid } }), vi.fn());
    for (const [value, present] of [['standard', free], ['pro', paid]] as const) {
      const option = panel.query(`[data-setting="global.geminiProfile"] option[value="${value}"]`)!;
      expect(option.classList.contains('credential-missing')).toBe(!present);
      expect(option.disabled).toBe(false);
    }
    expect(panel.query('[data-model-preset="global.model"]')!.classList.contains('credential-missing')).toBe(!free);
    expect(panel.query('[data-setting="global.thinkingOrEffort"]')!.classList.contains('credential-missing')).toBe(!free);
    expect(panel.query('[data-model-preset="global.alternateModel"]')!.classList.contains('credential-missing')).toBe(!paid);
    expect(panel.query('[data-setting="global.provider"]')!.querySelectorAll('option').every(option => !option.disabled)).toBe(true);
  });
  it('Refresh patches the global model list, restores gray after credential changes, and preserves selection', () => {
    const post = vi.fn();
    const panel = mountedPanel(html(), post);
    const select = panel.query('[data-model-preset="global.model"]')!;
    const before = select.value;
    panel.click(panel.query('[data-model-slot="default"][data-provider-for="global.provider"] [data-command="refreshGeminiModels"]')!);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ command: 'refreshGeminiModels' }));
    for (const present of [false, true, false]) {
      panel.message({ command: 'credentialPresenceReady', presence: { geminiDefault: present } });
      panel.message({ command: 'modelCatalogReady', catalog: 'gemini', models: [{ id: 'new-model', displayName: 'Discovered' }] });
      expect(select.value).toBe(before);
      expect(select.querySelector('[value="new-model"]')!.classList.contains('credential-missing')).toBe(!present);
      expect(select.querySelector('[value="new-model"]')!.disabled).toBe(false);
    }
  });
  it('reveals a custom model identifier in the same routing group and posts only a global model save', () => {
    const post = vi.fn();
    const panel = mountedPanel(html(), post);
    const select = panel.query('[data-model-preset="global.model"]')!;
    const row = panel.query('[data-model-identifier="global.model"]')!;
    expect(row.hidden).toBe(true);
    select.value = '__custom__';
    panel.change(select);
    expect(row.hidden).toBe(false);
    const input = row.querySelector('input')!;
    expect(panel.document.activeElement).toBe(input);
    input.value = 'custom-model';
    panel.click(row.querySelector('[data-command="addCustomModel"]')!);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ command: 'addCustomModel', modelKey: 'global.model', modelId: 'custom-model' }));
  });
});
