import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { parse } from 'postcss';
import { renderKrenResultViewHtml } from '../../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './panelSettingsFixture.js';

export function checkV265CredentialStyles() {
  const $ = load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [],
    activeScreen: 'credentials', settings: PANEL_SETTINGS_FIXTURE }));
  const rules = new Map<string, Record<string, string>>();
  parse($('style').text()).walkRules(rule => {
    const declarations: Record<string, string> = {};
    rule.walkDecls(declaration => { declarations[declaration.prop] = declaration.value; });
    rules.set(rule.selector, declarations);
  });
  const selector = '.credentials-screen .credential-row .tutor-map-information';
  assert.equal(rules.get(selector)?.background, 'var(--vscode-button-secondaryBackground)');
  assert.equal(rules.get(selector)?.background, rules.get('button.secondary')?.background);
  assert.equal(rules.get(selector)?.border, '0');
  assert.equal(rules.get(`${selector}:not(:focus-visible)`)?.outline, 'none');
  assert.equal(rules.get('.tutor-map-information:focus-visible')?.outline, '1px solid var(--vscode-focusBorder)');
  assert.equal($(selector).length, 13);
  assert.ok($('#credentials-screen [data-action="kren.testGroqConnection"]').hasClass('secondary'));
  assert.ok($('#credentials-screen [data-action="kren.showGoogleCloudTranslationUsage"]').hasClass('secondary'));
}
