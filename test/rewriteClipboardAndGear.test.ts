import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  renderKrenResultViewHtml,
  type KrenPanelSettings
} from '../src/resultViewHtml.js';
import { REPLAY_SUBJECTS } from '../src/operations.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const settings: KrenPanelSettings = PANEL_SETTINGS_FIXTURE;

interface ManifestProperty { type?: string; default?: unknown; description?: string }

function manifestProperty(key: string): ManifestProperty {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
    contributes: { configuration: { properties: Record<string, ManifestProperty> } };
  };
  const property = manifest.contributes.configuration.properties[key];
  if (!property) throw new Error(`package.json declares no setting named ${key}`);
  return property;
}

describe('the Settings gear sits beside Home in the header', () => {
  const html = renderKrenResultViewHtml({
    cspSource: 'vscode-webview://test',
    nonce: 'test-nonce',
    settings,
    activeScreen: 'start',
    proModels: []
  });

  it('renders a Settings control in the header actions, not only in the menu', () => {
    const actions = html.slice(
      html.indexOf('<div class="top-actions">'),
      html.indexOf('<div class="menu-wrap">')
    );
    expect(actions, 'the header no longer has a top-actions block').not.toBe('');
    expect(actions).toContain('data-command="showSettings"');
    expect(actions).toContain('data-command="showStartPage"');
  });

  it('places the gear immediately after Home, so the pair reads as one group', () => {
    const home = html.indexOf('data-command="showStartPage"');
    const gear = html.indexOf('data-command="showSettings"');
    const menu = html.indexOf('data-menu-toggle');
    expect(home).toBeGreaterThan(-1);
    expect(gear).toBeGreaterThan(home);
    expect(gear).toBeLessThan(menu);
  });

  it('carries an accessible name, because an icon on its own says nothing', () => {
    const gear = html.slice(html.indexOf('data-command="showSettings"'));
    expect(gear.slice(0, 200)).toContain('aria-label="Open KREN Settings"');
  });

  it('keeps the Settings entry in the menu as well', () => {
    expect(html).toContain('<button class="menu-item" data-command="showSettings"');
  });
});

describe('the shipped documentation describes what shipped', () => {
  /*
   * Added after 1.7.1, when a review pass found that both features had shipped with the
   * documentation still describing the interface they replaced. The in-panel manual named a
   * header carrying only Home, and the User Guide did not mention the clipboard option at
   * all. Neither is visible to any test that checks behaviour, which is why both survived a
   * green suite twice.
   */
  it('describes the Settings gear in the in-panel manual, not just Home', () => {
    const manual = readFileSync('src/resultViewHtml.ts', 'utf8');
    // Changed 2026-10-06: V211 makes setup a task; preserve the gear's name and purpose.
    const setup = manual.slice(manual.indexOf('<h3>Set up</h3>'), manual.indexOf('<h3>Look up a word</h3>'));
    // 2026-10-10: V217 moves key setup to the Credentials menu screen; assert the route and action.
    expect(setup).toMatch(/KREN menu[^\n]*Credentials[^\n]*Set key/u);
  });

  it('documents the clipboard option in the User Guide, including what Both Variants does', () => {
    const guide = readFileSync('docs/USER_GUIDE.md', 'utf8');
    expect(guide).toContain('Copy result to clipboard');
    // Changed 2026-10-06: Assert the comparison destination, independent of the old sentence.
    expect(guide).toMatch(/Both Variants always[^.]*panel/u);
    expect(guide).toContain('Rewrite Text');
  });
});

describe('a single-variant rewrite can go straight to the clipboard', () => {
  const source = readFileSync('src/extension.ts', 'utf8');

  /*
   * On by default since 1.7.9. It shipped off in 1.7.0 so that nothing changed for an
   * existing reader, and the owner turned it on and then asked, on 2026-08-28, for their
   * current settings to become KREN's declared defaults.
   */
  it('declares the setting, on by default since the owner made it their default', () => {
    const property = manifestProperty('kren.rewrite.copyToClipboard');
    expect(property.type).toBe('boolean');
    expect(property.default).toBe(true);
    expect(property.description).toContain('Both Variants');
  });

  /*
   * This is the assertion that was missing when 1.7.0 shipped. The setting was declared in
   * package.json and the logic was correct and tested, so every check passed while the owner
   * had no way to switch it on: KREN's own Settings screen is where they look, not VS Code's.
   * Declaring a setting and offering it are different things, and only the second is visible.
   */
  it('is switchable from the Rewrite Text section of the KREN Settings screen', () => {
    const settingsHtml = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings,
      activeScreen: 'settings',
      proModels: []
    });

    const rewriteSection = settingsHtml.slice(
      settingsHtml.indexOf('data-settings-section="rewrite"'),
      // 2026-10-04: the canvas stylesheet also names Read Aloud; bound this to markup.
      settingsHtml.indexOf('<details class="settings-group" data-settings-section="readAloud"')
    );
    expect(rewriteSection, 'the Rewrite Text settings section moved or was renamed').not.toBe('');
    expect(rewriteSection).toContain('data-setting="rewrite.copyToClipboard"');
    expect(rewriteSection).toContain('Copy result to clipboard');
    /*
     * The label has to name which rewrites it covers, or the option looks broken when Both
     * Variants ignores it. It said so at length until 2026-08-28, when the owner asked for
     * the short form: naming Minimal and Full is the same fact, and it is the fact the
     * assertion is about. The long form survives in the User Guide and the manifest.
     */
    // Changed 2026-10-17: V261, F5 owner canvas edit, the description still limits clipboard routing to these variants.
    expect(rewriteSection).toMatch(/Minimal or Full Rewrite only.*clipboard/u);

    /*
     * Outside every collapsible group, which is the whole point. 1.7.1 put it in the OUTPUT
     * group, and the owner's words were "so hidden in rewrite's output panel". A control the
     * reader has to expand a section to find is reachable in the same sense the tutor's
     * Generate button was.
     */
    const control = rewriteSection.indexOf('data-setting="rewrite.copyToClipboard"');
    const lastGroupSummary = rewriteSection.lastIndexOf('data-rewrite-group-summary="');
    expect(lastGroupSummary, 'the rewrite settings groups moved or were renamed')
      .toBeGreaterThan(-1);
    // After the last group and still outside all of them: the owner asked for it there, and
    // 1.7.1 put it inside OUTPUT where finding it meant expanding a section first.
    expect(control).toBeGreaterThan(lastGroupSummary);
    const enclosing = rewriteSection.slice(lastGroupSummary, control);
    expect(enclosing).toContain('</details>');
  });

  it('reflects the stored value, so the control is not always drawn unchecked', () => {
    const on = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings: { ...settings, rewriteCopyToClipboard: true },
      activeScreen: 'settings',
      proModels: []
    });
    const off = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      settings,
      activeScreen: 'settings',
      proModels: []
    });
    const control = (html: string): string => {
      const at = html.indexOf('data-setting="rewrite.copyToClipboard"');
      return html.slice(at - 300, at + 300);
    };
    expect(control(on)).toContain('checked');
    expect(control(off)).not.toContain('checked');
  });

  it('decides from the operation, never from how many variants came back', () => {
    expect(source).toContain('if (shouldCopyRewriteToClipboard(');
    expect(source).toContain("config.get<boolean>('rewrite.copyToClipboard', false)");
    // The 1.7.0 condition. Its return kept the route from ever firing for the owner.
    expect(source).not.toContain("result.variants.length === 1");
  });

  /*
   * Two source-reading tests lived here and were removed in 1.7.3. They matched the literal
   * text of the 1.7.0 condition, so they broke when the decision moved out of extension.ts,
   * and matching source text was never what they were for. Their subjects are now asserted
   * against behaviour in test/rewriteClipboardRoute.test.ts: which runs copy, which text is
   * copied, and that the route returns before both setResult and showResult.
   */
  it('names which rewrite it copied, from the one label map rather than a second copy', () => {
    expect(source).toContain('${REPLAY_SUBJECTS[operation]} copied.');
    expect(REPLAY_SUBJECTS.rewriteMinimal).toBe('Minimal Rewrite');
    expect(REPLAY_SUBJECTS.rewriteFull).toBe('Full Rewrite');
  });
});
