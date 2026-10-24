import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { it, vi } from 'vitest';
vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) }, env: {} }));
import { renderKrenResultViewHtml, renderProviderSwitchSettings, renderTutorTakeHome } from '../src/resultViewHtml.js';
import { createTutorViewState } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

function page(extra: Partial<Parameters<typeof renderKrenResultViewHtml>[0]> = {}) {
  return renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [], settings: PANEL_SETTINGS_FIXTURE, ...extra });
}
function declarations(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const rule = css.match(new RegExp(`(?:^|[{}])\\s*${escaped}\\s*\\{([^}]+)\\}`, 'u'));
  assert.ok(rule, `Missing rule: ${selector}`);
  return Object.fromEntries(rule[1]!.split(';').filter(part => part.includes(':')).map(part => {
    const colon = part.indexOf(':'); return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
  }));
}

it('V261 renders the owner descriptions exactly, including the composed Paid model note', () => {
  const $ = load(page());
  const description = (key: string) => $(`[data-setting="${key}"]`).first().closest('.setting').find('.setting-description').text();
  assert.equal(description('translation.sourceLanguage'), 'Auto-detect works like Read Aloud and defers to the provider when unsure. A named language is sent as the source.');
  assert.equal(description('translation.targetLanguage'), 'The language to translate into. KREN warns if the text is already in that language.');
  assert.equal(description('request.timeoutMs'), 'How long KREN waits for a provider. Cloudflare pictures wait at least 60 seconds; Google Cloud speech ignores this.');
  assert.ok($('.setting-description').toArray().some(el => $(el).text() === 'Pick a discovered model or enter a compatible identifier. Saved for the Gemini Paid profile only.'));
  const off = load(page({ settings: { ...PANEL_SETTINGS_FIXTURE, userDictionaryEnabled: false } }));
  assert.equal(off('[data-setting="userDictionary.smartWordCapture"]').closest('.setting').find('.setting-description').text(), 'Sends the sentence so the model picks the meaning used there; the entry keeps all meanings. Needs User Dictionary. Off: no model runs.');
});

it('V261 patches provider order with named triangle buttons and preserves focus and disabled ends', () => {
  const panel = mountedPanel(page({ activeScreen: 'settings', focusSettingsSection: 'usage' }), () => {});
  const region = panel.query('[data-provider-switch-settings]')!;
  const start = panel.query('[data-provider-order] li:first-child [data-provider-move="1"]')!;
  start.focus();
  panel.message({ command: 'providerSwitchSettings', html: renderProviderSwitchSettings(PANEL_SETTINGS_FIXTURE) });
  assert.equal(panel.query('[data-provider-switch-settings]'), region);
  assert.equal(panel.document.activeElement?.getAttribute('aria-label'), start.getAttribute('aria-label'));
  const $ = load(region.innerHTML);
  const rows = $('[data-provider-order] li');
  assert.ok(rows.length >= 3);
  rows.each((index, row) => {
    for (const [move, direction, path] of [['-1', 'up', 'M12 7l6 9H6z'], ['1', 'down', 'M12 17l-6-9h12z']]) {
      const button = $(row).find(`[data-provider-move="${move}"]`);
      assert.equal(button.hasClass('icon-button'), true);
      assert.equal(button.attr('aria-label'), `Move ${$(row).attr('data-provider')} ${direction}`);
      assert.equal(button.attr('title'), `Move ${direction}`);
      assert.equal(button.find('svg[aria-hidden="true"] path').attr('d'), path);
      assert.equal(button.find('path').attr('fill'), 'currentColor');
      assert.equal(button.find('path').attr('stroke'), 'none');
      assert.equal(button.text(), '');
      assert.equal(button.prop('disabled'), direction === 'up' ? index === 0 : index === rows.length - 1);
      assert.equal(button.attr('style'), undefined);
    }
  });
  const css = load(page())('style').text();
  const grid = declarations(css, '.provider-switch-order');
  assert.equal(grid.display, 'grid'); assert.equal(grid['grid-template-columns'], 'max-content auto auto');
  assert.equal(grid['row-gap'], '6px'); assert.equal(grid['padding-left'], '25px');
  const icons = declarations(css, '.provider-switch-order .icon-button[data-provider-move]');
  assert.equal(icons.top, '6px'); assert.equal(icons['background-color'], 'transparent');
  assert.equal(icons['border-color'], 'transparent'); assert.equal(icons.color, 'var(--vscode-foreground)');
});

it('V261 sizes Start text with stylesheet rules and keeps Updates available reachable below the header buttons', () => {
  const $ = load(page({ activeScreen: 'start', systemUpdatesAvailable: true })); const css = $('style').text();
  assert.equal(declarations(css, '.welcome-lead')['font-size'], '14px');
  assert.equal(declarations(css, '.welcome-step strong')['font-size'], '18px');
  assert.equal(declarations(css, '.capability-label')['font-size'], '14px');
  assert.deepEqual($('.welcome-step > strong').map((_, el) => $(el).text()).get(), ['1. Select or copy', '2. Choose an action', '3. Use the result']);
  assert.equal($('.welcome-lead[style], .welcome-step strong[style]').length, 0);
  const button = $('#result-screen [data-system-updates]');
  assert.equal(button.text(), 'Updates available'); assert.equal(button.hasClass('secondary'), false);
  // Changed 2026-10-21 (owner, canvas): The row follows the header and moves up 50px.
  assert.equal(button.parent().hasClass('system-updates-row'), true);
  assert.equal(button.parent().prev().is('header.intro-header'), true);
  assert.equal(button.parent().parent().attr('id'), 'result-screen');
  assert.equal(declarations(css, '.system-updates-row').display, 'flex');
  assert.equal(declarations(css, '.system-updates-row').position, 'relative');
  assert.equal(declarations(css, '.system-updates-row').top, '-50px');
  assert.equal(declarations(css, '.system-updates-row')['justify-content'], 'flex-end');
  assert.equal(button.closest('details, .hidden, [hidden]').length, 0);
  assert.equal(button.is('button:not([disabled])'), true);
  assert.equal(declarations(css, '[data-system-updates]')['font-size'], '10px');
  assert.equal(declarations(css, '[data-system-updates]')['font-weight'], 'bold');
  assert.equal(declarations(css, 'button').background, 'var(--vscode-button-background)');
});

it('V261 puts the primary Check again on the visible status line for both ready and busy results', () => {
  for (const busy of [false, true]) {
    const $ = load(page({ activeScreen: 'updates', environmentBusy: busy, environmentItems: [
      { name: 'Python', status: 'ok', found: '3.12', expected: '3.10 or newer', explanation: 'Ready.' }
    ] }));
    const screen = $('#updates-screen'); const status = screen.children('[role="status"]');
    const button = status.children('button[data-command="checkForUpdates"]');
    assert.equal(button.length, 1); assert.equal(button.text(), 'Check again');
    assert.equal(button.hasClass('secondary'), false); assert.equal(button.prop('disabled'), busy);
    assert.equal(button.closest('details, .hidden, [hidden]').length, 0);
    assert.match(status.text(), busy ? /Checking.*Please wait/u : /Latest check results/u);
    assert.equal(screen.children('.settings-intro').text(), 'System checks need no key. Providers with stored keys are asked only for model lists, Google for voices. No text is sent. Edge uses the configured Python.');
    const css = $('style').text();
    assert.equal(declarations(css, '#updates-screen > [role="status"]')['justify-content'], 'space-between');
    assert.equal(declarations(css, 'section[data-update-group] > h3')['text-transform'], 'uppercase');
    assert.equal(declarations(css, 'section[data-update-group] > h3')['padding-left'], '6px');
    assert.equal(declarations(css, '.card-body > p + p')['margin-top'], '6px');
    assert.equal(declarations(css, '.card-body > p:has(+ p)')['margin-bottom'], '0');
  }
});

it('V261 uses compact manual and popup rules while keeping the manual within its word budget', () => {
  const $ = load(page({ activeScreen: 'manual' })); const css = $('style').text();
  assert.equal(declarations(css, '#manual-screen ol, #manual-screen ul')['padding-left'], '15px');
  assert.equal(declarations(css, '.manual-screen h3')['text-transform'], 'uppercase');
  const popup = declarations(css, '.popup-long-message > .popup-message');
  assert.equal(popup['max-width'], '354px'); assert.equal(popup.height, undefined); assert.equal(popup.width, undefined);
  const guide = readFileSync('docs/USER_GUIDE.md', 'utf8');
  const words = $('#manual-screen h2, #manual-screen h3, #manual-screen h4, #manual-screen p, #manual-screen li')
    .map((_, el) => $(el).text()).get().join(' ').replace(/\s+/gu, ' ').trim().split(' ').length;
  const budget = Math.ceil(guide.match(/\S+/gu)!.length * 0.35) + guide.split('\n').filter(line => line.startsWith('With Standard replies and the speaker on,') || line.startsWith('Chirp requests speech by sentence,')).join(' ').split(/\s+/u).length;
  assert.ok(words <= budget, `Manual ${words} words exceeds ${budget}.`);
});

it('V261 patches take-home quotes into 13px paragraphs and indents every list by 16px', () => {
  const tutor = createTutorViewState(); tutor.conversation.status = 'stopped';
  tutor.conversation.takeHome = { identity: 'test', card: { naturally: [
    { turnIndex: 0, quote: 'I buy it yesterday.', alternatives: ['I bought it yesterday.'], why: 'Use the past form.' }
  ], doneWell: [], tryNext: 'Use a past-tense verb.' } };
  const panel = mountedPanel(page({ activeScreen: 'tutor', tutor }), () => {});
  const slot = panel.query('[data-tutor-take-home]')!;
  panel.message({ command: 'tutorTakeHomeReady', html: renderTutorTakeHome(tutor.conversation) });
  assert.equal(panel.query('[data-tutor-take-home]'), slot);
  const $ = load(slot.innerHTML);
  assert.equal($('.tutor-take-home-natural > p.tutor-take-home-explanation q').text(), 'I buy it yesterday.');
  assert.equal($('.tutor-take-home small, .tutor-take-home [style]').length, 0);
  const css = load(page())('style').text();
  assert.equal(declarations(css, '.tutor-take-home-explanation')['font-size'], '13px');
  assert.equal(declarations(css, '.tutor-take-home ul')['padding-left'], '16px');
});

it('V261 slows the listening pulse to two seconds and preserves reduced motion', () => {
  const css = load(page())('style').text();
  assert.equal(declarations(css, '.icon-button.tutor-microphone-pulsing').animation, 'kren-tutor-microphone-pulse 2s ease-in-out infinite');
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.icon-button\.tutor-microphone-pulsing\s*\{[^}]*animation:\s*none/u);
});
