import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { createTutorViewState } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { userDictionaryEntry } from './userDictionaryFixtures.js';

type Options = Parameters<typeof renderKrenResultViewHtml>[0];

function page(extra: Partial<Options> = {}): string {
  return renderKrenResultViewHtml({
    cspSource: 'test', nonce: 'test', proModels: [], settings: PANEL_SETTINGS_FIXTURE, ...extra
  } as Options);
}

function rule(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  // A selector can have several rules; the cascade lets the later declaration win.
  const matches = [...css.matchAll(new RegExp(`(?:^|[{}])\\s*${escaped}\\s*\\{([^}]+)\\}`, 'gu'))];
  expect(matches.length, `Missing rule: ${selector}`).toBeGreaterThan(0);
  return Object.fromEntries(matches.flatMap((match) => match[1]!.split(';').filter((part) => part.includes(':')).map((part) => {
    const colon = part.indexOf(':');
    return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()] as [string, string];
  })));
}

describe('F5B: ports of the sibling host touch-ups', () => {
  it('V2 shows the User Dictionary update as a date, never the raw timestamp', () => {
    const entry = userDictionaryEntry({ updatedAt: '2026-10-25T01:00:00.000Z' });
    const html = page({
      settings: { ...PANEL_SETTINGS_FIXTURE, userDictionaryEnabled: true },
      activeScreen: 'userDictionary',
      userDictionary: { entries: [entry], selectedId: entry.id }
    });
    const meta = load(html)('.dictionary-meta').last().text();
    expect(meta).toContain('Updated 2026-10-25.');
    expect(html).not.toContain('2026-10-25T01:00:00.000Z');
  });

  describe('V3 Start page lead sentence', () => {
    const lead = 'KREN is a privacy-conscious language copilot';
    const heldResult = {
      kind: 'translation', operation: 'translate', providerId: 'googleCloudTranslation',
      sourceLanguage: 'en', targetLanguage: 'ko', sourceText: 'hello', translatedText: 'annyeong'
    } as unknown as Options['result'];

    it('keeps the sentence on the first run, with no saved key and no held result', () => {
      const $ = load(page({ activeScreen: 'start', settings: { ...PANEL_SETTINGS_FIXTURE, credentialPresence: {} } }));
      expect($('.welcome-lead').text()).toContain(lead);
      expect($('.welcome-heading')).toHaveLength(0);
      expect($('.welcome-lead').parents('details, [hidden]')).toHaveLength(0);
    });

    it('drops the sentence on a later visit and puts the steps below the action buttons', () => {
      const later = [
        page({ activeScreen: 'start', settings: { ...PANEL_SETTINGS_FIXTURE, credentialPresence: { geminiDefault: true } } }),
        page({ activeScreen: 'start', sourceText: 'hello', result: heldResult, settings: { ...PANEL_SETTINGS_FIXTURE, credentialPresence: {} } })
      ];
      for (const html of later) {
        const $ = load(html);
        expect(html).not.toContain(lead);
        expect($('.welcome-lead')).toHaveLength(0);
        const heading = $('.welcome .welcome-heading');
        expect(heading.text()).toBe('Choose a KREN action');
        expect(heading.parents('details, [hidden]')).toHaveLength(0);
        const grid = $('.welcome .capability-grid');
        const flow = $('.welcome .welcome-flow');
        expect(grid).toHaveLength(1);
        expect(flow).toHaveLength(1);
        // Reading order is document order: the buttons come first, and the three steps follow.
        expect(html.indexOf('class="capability-grid"')).toBeLessThan(html.indexOf('class="welcome-flow"'));
        expect(html.indexOf('class="welcome-heading"')).toBeLessThan(html.indexOf('class="capability-grid"'));
        expect(flow.parents('details, [hidden]')).toHaveLength(0);
        expect($('.welcome-step > strong').map((_, el) => $(el).text()).get())
          .toEqual(['1. Select or copy', '2. Choose an action', '3. Use the result']);
        expect($('.welcome .capability-grid button').length).toBeGreaterThan(0);
        expect($('[style]')).toHaveLength(0);
      }
    });
  });

  describe('V13 Learning Tools drawer', () => {
    function drawerPage(tool: 'dictionary' | 'translate'): string {
      const state = createTutorViewState();
      state.toolDrawer = {
        tool, input: 'The plan is ready.', status: 'editing',
        ...(tool === 'dictionary' ? { context: 'The plan is ready.' } : {})
      } as typeof state.toolDrawer;
      return page({ activeScreen: 'tutor', tutor: state });
    }

    it('labels the Dictionary second button Restore, beside Look up', () => {
      const $ = load(drawerPage('dictionary'));
      const actions = $('.tutor-drawer .tutor-dictionary-actions');
      expect(actions).toHaveLength(1);
      expect(actions.children('button').map((_, el) => $(el).text()).get()).toEqual(['Look up', 'Restore']);
      expect(actions.find('[data-command="restoreTutorDictionaryContext"]').text()).toBe('Restore');
      expect(actions.parents('details, [hidden]')).toHaveLength(0);
    });

    it('gives every drawer box 12 px above and below, and top-aligns the Dictionary buttons at 33 px', () => {
      const css = load(drawerPage('dictionary'))('style').text();
      expect(rule(css, '.tutor-drawer-input').margin).toBe('12px 0');
      expect(rule(css, '.tutor-tool-output-language').margin).toBe('12px 0');
      expect(rule(css, '.tutor-drawer > section').margin).toBe('12px 0');
      expect(rule(css, '.tutor-drawer > .tutor-item-actions').margin).toBe('12px 0');
      expect(rule(css, '.tutor-drawer-result')['margin-top']).toBe('12px');
      expect(rule(css, '.tutor-drawer .tutor-dictionary-actions')['align-items']).toBe('flex-start');
      expect(rule(css, '.tutor-drawer .tutor-dictionary-actions > button').height).toBe('33px');
    });

    it('does not mark the Translate row as the Dictionary row', () => {
      expect(load(drawerPage('translate'))('.tutor-dictionary-actions')).toHaveLength(0);
    });
  });
});
