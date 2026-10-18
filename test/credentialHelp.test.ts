// Changed 2026-10-18: V264, owner item I44, credential help stays local until an explicit link click.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from 'cheerio';
import { runInNewContext } from 'node:vm';
import { checkV265CredentialStyles } from './support/v265CredentialChecks.js';
vi.mock('vscode', () => ({
  env: { openExternal: vi.fn(async () => true) },
  Uri: { parse: (value: string) => ({ toString: () => value }) },
  workspace: { getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback }) }
}));
import * as vscode from 'vscode';
import { CREDENTIAL_HELP } from '../src/credentialHelp.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const entries = Object.entries(CREDENTIAL_HELP);
const html = (groq = false) => renderKrenResultViewHtml({
  cspSource: 'test', nonce: 'test', proModels: [], activeScreen: 'credentials',
  settings: { ...PANEL_SETTINGS_FIXTURE, credentialPresence: { groq } }
});

it('V265 I47 gives Credentials information buttons the Test background with no resting border or outline and keeps focus', checkV265CredentialStyles);

/** Run the rendered click listener against the rendered elements, including SVG descendants. */
function browser(markup = html()) {
  const $ = load(markup);
  type Selection = ReturnType<typeof $>;
  class Element {
    constructor(readonly node: Selection) {}
    closest(selector: string): Element | null {
      const found = this.node.closest(selector);
      return found.length ? new Element(found) : null;
    }
    getAttribute(name: string) { return this.node.attr(name) ?? null; }
    hasAttribute(name: string) { return this.node.is(`[${name}]`); }
    setAttribute(name: string, value: string) { this.node.attr(name, value); }
    get hidden() { return this.hasAttribute('hidden'); }
    set hidden(value: boolean) { if (value) this.node.attr('hidden', ''); else this.node.removeAttr('hidden'); }
  }
  // The information and ordinary action paths need only these DOM operations.
  class Button extends Element {}
  let listener!: (event: unknown) => void;
  const postMessage = vi.fn();
  const script = $('script').text();
  const start = script.indexOf("document.addEventListener('click',");
  const end = script.indexOf("window.addEventListener('message',", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  runInNewContext(script.slice(start, end), {
    Element, HTMLElement: Element, HTMLButtonElement: Button,
    HTMLDetailsElement: class {}, HTMLInputElement: class {}, HTMLTextAreaElement: class {},
    activeScreen: 'credentials', vscode: { postMessage },
    document: {
      addEventListener: (_: string, callback: typeof listener) => { listener = callback; },
      querySelectorAll: () => [],
      getElementById: (id: string) => $(`[id="${id}"]`).length ? new Element($(`[id="${id}"]`)) : null
    }
  });
  return { $, postMessage, click: (selector: string, keyboard = false) => {
    const node = $(selector);
    expect(node).toHaveLength(1);
    const preventDefault = vi.fn();
    listener({ target: new Element(node), detail: keyboard ? 0 : 1, preventDefault });
    return preventDefault;
  } };
}

beforeEach(() => vi.clearAllMocks());

describe('credential information notes', () => {
  it('requires a table entry for every rendered credential row', () => {
    const $ = load(html());
    const rows = $('#credentials-screen .credential-row');
    expect(rows).toHaveLength(13);
    expect(rows).toHaveLength(entries.length);
    expect(rows.map((_, row) => $(row).find('[data-credential-help]').attr('data-credential-help')).get().sort())
      .toEqual(Object.keys(CREDENTIAL_HELP).sort());
  });

  it.each(entries)('%s has reachable help before its name, with its own note and id-only link', (id, help) => {
    const b = browser();
    const linkSelector = `a[data-credential-help="${id}"]`;
    const row = b.$(linkSelector).closest('.credential-row');
    const button = row.find('button[data-tutor-info-toggle]');
    const noteId = button.attr('aria-controls')!;
    const note = row.find(`#${noteId}`);
    expect(button).toHaveLength(1);
    expect(button.hasClass('tutor-map-information')).toBe(true);
    expect(button.attr('aria-label')).toBe(`Where to get the ${help.label}`);
    expect(button.attr('disabled')).toBeUndefined();
    expect(button.attr('tabindex')).not.toBe('-1');
    expect(button.parents('details:not([open]), [hidden], .hidden')).toHaveLength(0);
    expect(button.next('.credential-name').text()).toBe(help.label);
    expect(note.parent()[0]).toBe(row[0]);
    expect(row.children().last()[0]).toBe(note[0]);
    expect(note.is('[hidden]')).toBe(true);
    expect(note.text()).toContain(help.sentence);
    expect(note.find(linkSelector).text()).toBe(help.linkText);
    expect(note.find(linkSelector).attr('href')).toBe('#');
    expect(note.find(linkSelector).attr('tabindex')).not.toBe('-1');

    // Native button activation by keyboard and clicks on the glyph use the map listener.
    const buttonSelector = `button[aria-controls="${noteId}"]`;
    b.click(`${buttonSelector} svg`, true);
    expect(note.is('[hidden]')).toBe(false);
    expect(button.attr('aria-expanded')).toBe('true');
    expect(b.postMessage).not.toHaveBeenCalled();
    expect(b.click(linkSelector, true)).toHaveBeenCalledOnce();
    expect(b.postMessage.mock.calls).toEqual([[{ command: 'openCredentialHelp', credentialId: id }]]);
    b.click(buttonSelector);
    expect(note.is('[hidden]')).toBe(true);
    expect(button.attr('aria-expanded')).toBe('false');
  });

  it.each([false, true])('keeps Groq Set, Remove, Test, and stored presence behavior (%s)', stored => {
    const b = browser(html(stored));
    for (const [action, disabled] of [
      ['setGroqApiKey', stored], ['deleteGroqApiKey', !stored], ['testGroqConnection', !stored]
    ] as const) {
      const selector = `button[data-action="kren.${action}"]`;
      expect(b.$(selector).is('[disabled]')).toBe(disabled);
      if (!disabled) {
        b.click(selector);
        expect(b.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ command: 'runCommand', action: `kren.${action}` }));
      }
    }
  });
});

describe('credential help host boundary', () => {
  function host() {
    const log = vi.fn();
    const view = new KrenResultsViewProvider({
      log, generateTutor: vi.fn(), settings: () => PANEL_SETTINGS_FIXTURE
    } as never, {} as never);
    return { log, receive: (message: unknown) =>
      (view as unknown as { handleMessage(message: unknown): Promise<void> }).handleMessage(message) };
  }

  it.each(entries)('opens only the table destination for %s', async (id, help) => {
    const h = host();
    await h.receive({ command: 'openCredentialHelp', credentialId: id });
    expect(vscode.env.openExternal).toHaveBeenCalledOnce();
    expect(vi.mocked(vscode.env.openExternal).mock.calls[0]![0].toString()).toBe(help.url);
    expect(h.log).not.toHaveBeenCalled();
  });

  it.each(['unknownProvider', 'not-a-key', 'constructor', 'toString', '__proto__'])('never opens an unknown id (%s)', async id => {
    const h = host();
    await h.receive({ command: 'openCredentialHelp', credentialId: id });
    expect(vscode.env.openExternal).not.toHaveBeenCalled();
    expect(h.log.mock.calls).toEqual([[`[credential help unavailable] ${id}`]]);
    h.log.mockClear();
    await h.receive({ command: 'openCredentialHelp', credentialId: id, url: 'https://example.com/untrusted' });
    expect(vscode.env.openExternal).not.toHaveBeenCalled();
    expect(h.log.mock.calls).toEqual([[`[credential help unavailable] ${id}`]]);
  });

  it.each([
    { credentialId: 'groq', url: 'https://example.com/untrusted' },
    { credentialId: 'bad/id', url: 'https://example.com/untrusted' },
    { url: 'https://example.com/untrusted' },
    { credentialId: 'https://example.com/untrusted' },
    { credentialId: 'unknown\nProvider' },
    { credentialId: 1 },
    {}
  ])('rejects URL-bearing or malformed messages: %j', async payload => {
    const h = host();
    await h.receive({ command: 'openCredentialHelp', ...payload });
    expect(vscode.env.openExternal).not.toHaveBeenCalled();
    expect(h.log).not.toHaveBeenCalled();
  });
});
