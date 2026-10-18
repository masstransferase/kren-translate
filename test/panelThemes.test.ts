import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { load } from 'cheerio';
import { parse } from 'postcss';
import { describe, expect, it, vi } from 'vitest';
import { PANEL_PALETTES, PANEL_THEME_CSS, oppositePanelTheme, type PanelTheme } from '../src/panelThemes.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { validatedPanelSetting, PANEL_SETTING_KEYS } from '../src/panelSettings.js';
import { isCommandMessage } from '../src/resultsViewCommands.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const appearance = vi.hoisted(() => ({ kind: 1, config: [] as Array<(event: { affectsConfiguration(key: string): boolean }) => void>, theme: [] as Array<() => void> }));
vi.mock('vscode', () => ({
  window: { get activeColorTheme() { return { kind: appearance.kind }; },
    onDidChangeActiveColorTheme: (fn: () => void) => { appearance.theme.push(fn); return { dispose: vi.fn() }; } },
  workspace: { onDidChangeConfiguration: (fn: typeof appearance.config[number]) => {
    appearance.config.push(fn); return { dispose: vi.fn() };
  } }
}));
import { broadcastPanelTheme, currentPanelThemeKind, registerPanelTheme } from '../src/resultsViewTheme.js';

const source = readFileSync('src/resultViewHtml.ts', 'utf8');
const html = (theme: PanelTheme = 'followVSCode', kind: 'light' | 'dark' = 'light') => renderKrenResultViewHtml({
  nonce: 'theme-test', cspSource: 'test', proModels: [], settings: { ...PANEL_SETTINGS_FIXTURE, panelTheme: theme }, themeKind: kind
});
const css = load(html())('style').text().replace(PANEL_THEME_CSS, '');

describe('complete shipped panel palettes', () => {
  it.each(['light', 'dark'] as const)('defines every CSS and SVG variable in %s', kind => {
    const used = new Set([...source.matchAll(/var\((--vscode-[\w-]+)/g)].map(m => m[1]!));
    // 2026-10-05: VS Code's default webview stylesheet also consumes inline-code and active-link tokens.
    for (const variable of ['--vscode-textPreformat-foreground', '--vscode-textPreformat-background',
      '--vscode-textLink-activeForeground']) used.add(variable);
    expect(used.size).toBeGreaterThan(40);
    for (const variable of used) {
      // 2026-10-04: restored disabledForeground deliberately uses descriptionForeground as its fallback.
      if (variable === '--vscode-disabledForeground') {
        expect(css).toContain('var(--vscode-disabledForeground, var(--vscode-descriptionForeground))');
      } else {
        expect(PANEL_PALETTES[kind], `${kind} is missing ${variable}`).toHaveProperty(variable);
        expect(PANEL_PALETTES[kind][variable as keyof typeof PANEL_PALETTES.light]).not.toBe('');
      }
    }
  });

  it('uses variables for every literal panel color, including shadows and SVG fills', () => {
    parse(css).walkDecls(decl => {
      if (/color|background|shadow|border|outline|fill|stroke/.test(decl.prop)) {
        const literals = decl.value.replace(/--[\w-]+/g, '');
        expect(literals, decl.toString()).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(|\b(?:white|black|red|blue|gray|grey)\b/i);
      }
    });
    expect(source).not.toMatch(/(?:fill|stroke)="(?:#[\da-f]+|white|black|rgb)/i);
  });

  it.each(['light', 'dark'] as const)('keeps body text readable on every %s panel surface', kind => {
    const palette = PANEL_PALETTES[kind] as Record<string, string>;
    const rgb = (key: string) => palette['--vscode-' + key]!.match(/[\d.]+/g)!.map(Number);
    const blend = (color: number[], bg: number[]) => color.slice(0, 3).map((c, i) => c * (color[3] ?? 1) + bg[i]! * (1 - (color[3] ?? 1)));
    const lum = (c: number[]) => c.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i]!, 0);
    const contrast = (a: number[], b: number[]) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
    const surfaces = ['editor-background', 'sideBar-background', 'editorWidget-background', 'sideBarSectionHeader-background', 'textBlockQuote-background', 'textCodeBlock-background', 'menu-background', 'inputValidation-warningBackground'];
    const text = ['foreground', 'descriptionForeground', 'disabledForeground', 'textLink-foreground', 'charts-green', 'charts-blue', 'charts-red', 'testing-iconPassed', 'testing-iconFailed', 'editorWarning-foreground', 'errorForeground'];
    for (const bg of surfaces) for (const fg of text.filter(key => palette['--vscode-' + key])) {
      expect(contrast(rgb(fg), rgb(bg)), `${kind}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const [fg, bg] of [['button-foreground', 'button-background'], ['button-foreground', 'button-hoverBackground'], ['badge-foreground', 'badge-background'], ['input-foreground', 'input-background'], ['menu-selectionForeground', 'menu-selectionBackground'], ['list-activeSelectionForeground', 'list-activeSelectionBackground'], ['button-secondaryForeground', 'button-secondaryBackground'], ['button-secondaryForeground', 'button-secondaryHoverBackground']]) {
      for (const surface of surfaces) {
        const background = blend(rgb(bg!), rgb(surface));
        expect(contrast(rgb(fg!), background), `${kind}: ${fg} on ${bg} / ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    // Focus is non-text: WCAG's required ratio is 3:1.
    for (const surface of surfaces) expect(contrast(blend(rgb('focusBorder'), rgb(surface)), rgb(surface)), `focus on ${surface}`).toBeGreaterThanOrEqual(3);
    // 2026-10-04: V203 restores transparent balloon text; the balloon alone paints its background.
    expect(css).not.toMatch(/\[data-tutor-balloon-transparency\] \.tutor-chat-learner p/u);
    expect(css).toMatch(/\.tutor-turn-feedback \{[^}]*color: var\(--vscode-foreground\)/u);
    expect(css).toMatch(/\.tutor-chat-learner \{[^}]*color: var\(--vscode-button-foreground\)/u);
  });
});

describe('remembered theme choice and live patch', () => {
  it('declares and validates the three settings and default', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const setting = pkg.contributes.configuration.properties['kren.display.panelTheme'];
    expect(setting.default).toBe('followVSCode');
    expect(setting.enum).toEqual(['followVSCode', 'light', 'dark']);
    expect(PANEL_SETTING_KEYS.has('display.panelTheme')).toBe(true);
    for (const value of setting.enum) expect(validatedPanelSetting('display.panelTheme', value)).toBe(value);
    for (const value of ['auto', '', true, 1]) expect(validatedPanelSetting('display.panelTheme', value)).toBeUndefined();
    expect(isCommandMessage({ command: 'toggleTheme' })).toBe(true);
  });

  it.each([
    ['followVSCode', 'light', 'dark'], ['followVSCode', 'dark', 'light'],
    ['light', 'light', 'dark'], ['light', 'dark', 'dark'],
    ['dark', 'light', 'light'], ['dark', 'dark', 'light']
  ] as const)('switches %s in VS Code %s to %s', (theme, kind, next) => {
    expect(oppositePanelTheme(theme, kind)).toBe(next);
    const $ = load(html(theme, kind));
    expect($('html').attr('data-kren-theme')).toBe(theme === 'followVSCode' ? undefined : theme);
    const button = $('[data-command="toggleTheme"]').first();
    expect(button.attr('aria-label')).toBe(`Switch to ${next} view`);
    expect(button.attr('title')).toBe(button.attr('aria-label'));
  });

  it('patches the mounted document, preserving typed input, focus and scroll', () => {
    const $ = load(html());
    const root = { setAttribute: (key: string, value: string) => { $('html').attr(key, value); }, removeAttribute: (key: string) => { $('html').removeAttr(key); } };
    const answer = { value: 'Unsent answer', selectionStart: 3 };
    const document = { documentElement: root, activeElement: answer,
      querySelectorAll: (selector: string) => $(selector).toArray().map(node => ({
        setAttribute: (key: string, value: string) => { $(node).attr(key, value); },
        set value(value: string) { $(node).val(value); }
      })) };
    const fn = html().match(/    function applyPanelTheme\(message\) \{[\s\S]*?\n    \}/)![0];
    const context = { document, message: { theme: 'dark', kind: 'light' }, scrollY: 321 };
    for (const theme of ['dark', 'light', 'followVSCode']) {
      context.message = { theme, kind: 'dark' };
      runInNewContext(fn + '\napplyPanelTheme(message);', context);
      expect($('html').attr('data-kren-theme')).toBe(theme === 'followVSCode' ? undefined : theme);
      expect($('html').attr('data-kren-kind')).toBe(theme === 'followVSCode' ? 'dark' : theme);
      expect($('[data-setting="display.panelTheme"]').val()).toBe(theme);
      expect(document.activeElement).toBe(answer);
      expect(answer).toEqual({ value: 'Unsent answer', selectionStart: 3 });
      expect(context.scrollY).toBe(321);
    }
  });

  it.each([1, 2, 3, 4])('uses the correct logo kind for VS Code theme kind %i', kind => {
    appearance.kind = kind;
    expect(currentPanelThemeKind()).toBe(kind === 1 || kind === 4 ? 'light' : 'dark');
  });

  it('broadcasts settings and VS Code theme changes to all open panels, then disposes', () => {
    const one = { postMessage: vi.fn() }, two = { postMessage: vi.fn() };
    let theme: PanelTheme = 'light';
    const a = registerPanelTheme(one as never, () => theme);
    const b = registerPanelTheme(two as never, () => theme);
    try {
      broadcastPanelTheme('dark');
      for (const panel of [one, two]) expect(panel.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ command: 'panelThemeChanged', theme: 'dark' }));
      theme = 'followVSCode'; appearance.kind = 2;
      appearance.config.at(-1)!({ affectsConfiguration: key => key === 'kren.display.panelTheme' });
      appearance.theme.at(-1)!();
      for (const panel of [one, two]) expect(panel.postMessage).toHaveBeenLastCalledWith({ command: 'panelThemeChanged', theme, kind: 'dark' });
    } finally { a.dispose(); b.dispose(); }
    one.postMessage.mockClear(); broadcastPanelTheme();
    expect(one.postMessage).not.toHaveBeenCalled();
  });
});

it('carries all nine owner edits through shared renderer rules and markup', () => {
  const $ = load(html());
  $('header').each((_, header) => {
    const buttons = $(header).find('.top-actions button').toArray();
    const gear = buttons.findIndex(node => node.attribs['data-command'] === 'showSettings');
    expect(buttons[gear + 1]!.attribs['data-command']).toBe('toggleTheme');
    expect(buttons[gear + 2]!.attribs).toHaveProperty('data-menu-toggle');
  });
  expect(source).toContain('class="audio secondary icon-button"');
  expect(source).toContain('M4 9.5h3.5L12 5.5v13l-4.5-4H4z');
  expect(css).toContain('button.audio.icon-button, button.audio.icon-button:hover');
  expect(css).toContain('.translation-alternatives { padding-left: 16px; }');
  expect(css).toContain('[data-kren-kind="dark"] .google-attribution');
  expect(css).toContain('.tutor-question-explanation { margin: 1.45em 0 5px; padding-left: 0; border-style: none; }');
  expect(source).not.toMatch(/style="/);
  expect(css).toContain('[data-kren-kind="light"] .provider-logo-dark');
  expect(css).toContain('[data-kren-kind="dark"] .provider-logo-light');
});
