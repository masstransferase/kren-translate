import { describe, expect, it, vi } from 'vitest';
import { runInNewContext, Script } from 'node:vm';
import { readFileSync } from 'node:fs';
import { transpileModule, ScriptTarget } from 'typescript';
import { load } from 'cheerio';
import { PanelNoticeQueue, panelNoticeScript, buildPanelNoticeCard, type PanelNotice } from '../src/panelNotices.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

function browser(initial: PanelNotice[] = []) {
  const listeners = new Map<string, (event: any) => void>();
  let observe!: () => void;
  let active: Element;
  class Element {
    children: Element[] = []; parent?: Element;
    attributes = new Map<string, string>();
    events = new Map<string, () => void>();
    className = ''; textContent = ''; id = ''; type = '';
    constructor(readonly tag = 'div') {}
    // Changed 2026-10-18: V266, owner item I49, notice acknowledgments measure the actual card and its viewport.
    get tagName() { return this.tag.toUpperCase(); }
    get parentElement(): Element | null { return this.parent ?? null; }
    getAttribute(key: string) { return key === 'class' ? this.className : this.attributes.get(key) ?? null; }
    getBoundingClientRect() { return { left: 0, right: 300, top: 0, bottom: 200, width: 300, height: 200 }; }
    style = { pointerEvents: '' };
    get isConnected(): boolean { return this === body || !!this.parent?.isConnected; }
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    removeAttribute(key: string) { this.attributes.delete(key); }
    append(...nodes: Element[]) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = undefined; }
    contains(node: Element): boolean { return this === node || this.children.some(child => child.contains(node)); }
    focus() { active = this; }
    addEventListener(name: string, callback: () => void) { this.events.set(name, callback); }
    descendants(): Element[] { return this.children.flatMap(child => [child, ...child.descendants()]); }
    querySelectorAll(selector: string): Element[] {
      if (selector === '.notice-card') return this.descendants().filter(node => node.className.split(' ').includes('notice-card'));
      if (selector === '.busy-card') return this.descendants().filter(node => node.className.split(' ').includes('busy-card'));
      if (selector === 'button') return this.descendants().filter(node => node.tag === 'button');
      if (selector === '.busy-overlay:not([data-kren-notice])') return this.descendants().filter(node => node.className === 'busy-overlay' && !node.attributes.has('data-kren-notice'));
      return this.descendants().filter(node => node.attributes.has('data-kren-notice'));
    }
    querySelector(selector: string): Element | undefined {
      if (selector === '.notice-actions button:last-child') return this.querySelectorAll('button').at(-1);
      return this.querySelectorAll(selector)[0];
    }
  }
  const body = new Element('body');
  const original = new Element('textarea'); body.append(original); original.focus();
  const sent = vi.fn();
  const document = { body, get activeElement() { return active; },
    elementFromPoint: () => body.querySelector('.notice-card'),
    createElement: (tag: string) => new Element(tag), createElementNS: (_ns: string, tag: string) => new Element(tag),
    querySelector: (selector: string) => body.querySelector(selector),
    querySelectorAll: (selector: string) => body.querySelectorAll(selector),
    addEventListener: (name: string, callback: (event: any) => void) => listeners.set(name, callback) };
  const window = { innerWidth: 800, innerHeight: 600, addEventListener: (name: string, callback: (event: any) => void) => listeners.set(name, callback) };
  class Observer { constructor(callback: () => void) { observe = callback; } observe() {} disconnect() {} }
  // Changed 2026-10-14: V238, the harness loads the shared notice script the renderer embeds.
  runInNewContext(panelNoticeScript(initial), {
    document, window, HTMLElement: Element, Node: Element, MutationObserver: Observer, vscode: { postMessage: sent },
    getComputedStyle: () => ({ visibility: 'visible', display: 'grid', opacity: '1' })
  });
  const markup = (element: Element): string => {
    const $ = load(`<${element.tag}></${element.tag}>`, {}, false);
    const node = $(element.tag).first();
    for (const [name, value] of element.attributes) node.attr(name, value);
    for (const [name, value] of [['class', element.className], ['id', element.id], ['type', element.type]]) if (value) node.attr(name!, value!);
    node.text(element.textContent);
    for (const child of element.children) node.append(markup(child));
    return $.html();
  };
  return { body, original, sent, Element,
    busy: () => { const overlay = new Element(); overlay.className = 'busy-overlay';
      const card = new Element(); card.className = 'busy-card'; overlay.append(card); body.append(overlay); return overlay; },
    markup: () => markup(body.querySelector('[data-kren-notice]')!),
    buildMarkup: (item: PanelNotice) => markup(buildPanelNoticeCard(
      document as unknown as Pick<Document, 'createElement' | 'createElementNS'>, item
    ).overlay as unknown as Element),
    active: () => active,
    notice: (notice: PanelNotice) => listeners.get('message')!({ data: { command: 'panelNotice', notice } }),
    card: () => body.querySelector('[data-kren-notice]'),
    click: (label: string) => body.querySelectorAll('button').find(node => node.textContent === label)!.events.get('click')!(),
    key: (key: string, shiftKey = false) => listeners.get('keydown')!({ key, shiftKey, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }),
    mutate: () => observe()
  };
}
const notice = (id: number, modal = false, choices: string[] = []): PanelNotice => ({ id, kind: 'warning', message: `Notice ${id}`, modal, choices });

describe('V238 shared notice markup and embedded script', () => {
  it('ships exactly the notice script the isolated harness executes', () => {
    const initial = [{ ...notice(1), message: '<script>example</script>' }];
    const html = renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE, proModels: [], panelNotices: initial });
    expect(load(html)('script').last().text()).toContain(panelNoticeScript(initial));
    expect(panelNoticeScript(initial)).not.toContain('<script>example</script>');
    expect(browser(initial).card()).toBeDefined();
  });
  // Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
  it.each([
    { ...notice(1), kind: 'error' as const },
    notice(2),
    { ...notice(3), detail: 'Status detail' },
    { ...notice(4), message: 'A long status message. '.repeat(8) },
    { ...notice(5), message: '<img src=x onerror=bad()>', detail: 'Details: <script>bad()</script> & "quoted"' }
  ])('keeps the delivered script and static gallery card identical for notice $id', item => {
    const staticHtml = browser().buildMarkup(item);
    // 2026-10-14: Compare initial render and message insertion, which patches an active panel.
    for (const b of [browser([item]), browser()]) {
      b.notice(item);
      const runtime = load(b.markup());
      const gallery = load(staticHtml);
      const structure = ($: ReturnType<typeof load>) => $('[data-kren-notice]').find('*').addBack().map((_, node) => ({
        tag: 'name' in node ? node.name : '', attributes: 'attribs' in node ? node.attribs : {}, text: $(node).text()
      })).get();
      expect(structure(runtime)).toEqual(structure(gallery));
      expect(runtime('script, img')).toHaveLength(0);
    }
  });
});

describe('V228 notice cards', () => {
  // Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
  it.each([
    'Gemini gemini-3.8-flash is overloaded. KREN is using Groq for this request.',
    'Gemini gemini-3.8-flash (Free Tier) reached a daily or monthly free limit. KREN is using Groq for it until local midnight.'
  ])('V244 makes the provider switch popup reachable with OK: %s', message => {
    const b = browser();
    b.notice({ ...notice(1), message });
    const $ = load(b.markup());
    const ok = $('button').filter((_index, element) => $(element).text() === 'OK');
    expect($('[role="alertdialog"]').text()).toContain(message);
    expect(ok).toHaveLength(1);
    expect(ok.parents('details:not([open]), [hidden]')).toHaveLength(0);
    expect(b.active().textContent).toBe('OK');
    b.key('Tab'); expect(b.active().textContent).toBe('OK');
    b.click('OK'); expect(b.active()).toBe(b.original);
    expect(b.original.isConnected).toBe(true);
    // Changed 2026-10-18: V266, owner item I49, the visibility receipt precedes the single response.
    expect(b.sent.mock.calls.filter(([message]) => message.command === 'panelNoticeResponse')).toEqual([[{ command: 'panelNoticeResponse', id: 1, choice: undefined }]]);
  });
  it('embeds valid script and uses the existing theme palette and overlay classes', () => {
    const html = renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE, proModels: [], panelNotices: [notice(1)] });
    const $ = load(html);
    expect(() => new Script($('script').last().text())).not.toThrow();
    expect($('script').text()).toContain('alertdialog');
    expect($('style').text()).toContain('.notice-card');
    expect($('style').text()).toContain('max-height: calc(100vh - 36px); overflow: auto;');
    expect($('style').text()).toContain('color: var(--vscode-foreground)');
    // Changed 2026-10-18: V267 checks rendered behavior instead of source text.
    expect(browser([notice(1)]).card()?.className).toBe('busy-overlay');
  });
  it('focuses OK, dismisses it and restores the answer focus', () => {
    const b = browser(); b.notice(notice(1));
    expect(b.card()?.attributes.get('role')).toBe('alertdialog');
    expect(b.active().textContent).toBe('OK');
    b.click('OK');
    expect(b.card()).toBeUndefined(); expect(b.active()).toBe(b.original);
    expect(b.sent).toHaveBeenCalledWith({ command: 'panelNoticeResponse', id: 1, choice: undefined });
  });
  it('Escape dismisses a plain notice', () => {
    const b = browser(); b.notice(notice(1)); b.key('Escape');
    expect(b.card()).toBeUndefined(); expect(b.active()).toBe(b.original);
  });
  it('queues notices one at a time and ignores a duplicate delivery', () => {
    const b = browser(); b.notice(notice(1)); b.notice(notice(2)); b.notice(notice(2));
    expect(b.card()?.attributes.get('data-kren-notice')).toBe('1');
    b.click('OK'); expect(b.card()?.attributes.get('data-kren-notice')).toBe('2');
    // Changed 2026-10-18: V266, owner item I49, count responses separately from acknowledgments and waiting diagnostics.
    b.click('OK'); expect(b.card()).toBeUndefined(); expect(b.sent.mock.calls.filter(([message]) => message.command === 'panelNoticeResponse')).toHaveLength(2);
  });
  it('waits behind the busy overlay until it closes', () => {
    // Changed 2026-10-18: V266, owner item I49, use the rendered overlay/card structure for visibility checks.
    const b = browser(); const busy = b.busy();
    b.notice(notice(1)); expect(b.card()).toBeUndefined(); expect(b.active()).toBe(b.original);
    busy.remove(); b.mutate(); expect(b.active().textContent).toBe('OK');
  });
  // Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
  it('keeps consent in VS Code while the busy card and answer box stay mounted', async () => {
    const b = browser(); const busy = b.busy();
    const post = vi.fn(); const fallback = vi.fn(async () => 'I Understand');
    const queue = new PanelNoticeQueue(() => true, post, fallback);
    await expect(queue.show('warning', 'Consent', { modal: true }, 'I Understand')).resolves.toBe('I Understand');
    expect(fallback).toHaveBeenCalledExactlyOnceWith('warning', 'Consent', { modal: true }, ['I Understand']);
    expect(post).not.toHaveBeenCalled(); expect(b.card()).toBeUndefined();
    expect(busy.isConnected).toBe(true); expect(b.original.isConnected).toBe(true);
  });
  // Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
  it('V233 exposes the failure cause and keyboard actions while a language operation is busy', () => {
    // Changed 2026-10-18: V266, owner item I49, use the rendered overlay/card structure for visibility checks.
    const b = browser(); const busy = b.busy();
    b.notice({ ...notice(1), kind: 'error', message: 'Gemini returned malformed structured output.' });
    expect(b.card()?.descendants().some(node => node.textContent.includes('malformed structured output'))).toBe(true);
    expect(busy.isConnected).toBe(false); expect(b.active().textContent).toBe('OK');
    b.key('Tab'); expect(b.active().textContent).toBe('OK');
    b.click('OK'); expect(busy.isConnected).toBe(true); expect(b.original.isConnected).toBe(true);
  });
  // Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
  it('preserves action buttons and returns the chosen action through VS Code', async () => {
    const post = vi.fn(); const fallback = vi.fn(async () => 'Retry Now');
    const queue = new PanelNoticeQueue(() => true, post, fallback);
    await expect(queue.show('error', 'Failure', 'Retry Now', 'Set key')).resolves.toBe('Retry Now');
    expect(fallback).toHaveBeenCalledExactlyOnceWith('error', 'Failure', {}, ['Retry Now', 'Set key']);
    expect(post).not.toHaveBeenCalled();
  });
  // Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
  it.each(['Delete', 'I Understand', 'Continue', 'Restore Defaults', 'Reset KREN', 'Reset panel', 'Reset everything', 'Proceed', 'Text analysis', 'Weakness analysis', 'Regenerate'])('returns the original confirmation choice %s from VS Code', async choice => {
    const post = vi.fn(); const fallback = vi.fn(async () => choice);
    const queue = new PanelNoticeQueue(() => true, post, fallback);
    await expect(queue.show('warning', 'Confirm?', { modal: true }, choice)).resolves.toBe(choice);
    expect(fallback).toHaveBeenCalledExactlyOnceWith('warning', 'Confirm?', { modal: true }, [choice]);
    expect(post).not.toHaveBeenCalled(); expect(queue.snapshot()).toEqual([]);
  });
  // Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
  it('Escape declines Delete through VS Code and never selects a destructive choice', async () => {
    const post = vi.fn(); const fallback = vi.fn(async () => undefined);
    const queue = new PanelNoticeQueue(() => true, post, fallback);
    await expect(queue.show('warning', 'Delete?', { modal: true }, 'Delete')).resolves.toBeUndefined();
    expect(fallback).toHaveBeenCalledExactlyOnceWith('warning', 'Delete?', { modal: true }, ['Delete']);
    expect(post).not.toHaveBeenCalled();
  });
  // Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
  it('Cancel reaches the caller through VS Code without an in-panel focus trap', async () => {
    const b = browser(); const post = vi.fn(); const fallback = vi.fn(async () => 'Cancel');
    const queue = new PanelNoticeQueue(() => true, post, fallback);
    await expect(queue.show('warning', 'Delete?', { modal: true }, 'Delete', 'Cancel')).resolves.toBe('Cancel');
    expect(fallback).toHaveBeenCalledExactlyOnceWith('warning', 'Delete?', { modal: true }, ['Delete', 'Cancel']);
    expect(post).not.toHaveBeenCalled(); expect(b.card()).toBeUndefined(); expect(b.active()).toBe(b.original);
  });
});

describe('V228 host notice routing', () => {
  const host = (visible = true) => {
    const post = vi.fn(async (_notice: PanelNotice) => true);
    const fallback = vi.fn(async (_kind: string, _message: string, _options: object, _choices: string[]) => undefined as string | undefined);
    const queue = new PanelNoticeQueue(() => visible, post, fallback);
    return { queue, post, fallback };
  };
  it.each(['warning', 'error'] as const)('keeps a visible-panel %s status in the panel', async kind => {
    const h = host(); const pending = h.queue.show(kind, 'A notice');
    expect(h.fallback).not.toHaveBeenCalled(); expect(h.post).toHaveBeenCalledOnce();
    h.queue.respond({ id: 1 }); await expect(pending).resolves.toBeUndefined();
  });
  it.each(['warning', 'error'] as const)('routes extension notify %s into the visible panel', kind => {
    const h = host();
    const source = readFileSync('src/extension.ts', 'utf8');
    const start = source.indexOf('function showKrenWarningMessage(');
    const end = source.indexOf('// The extension identity', start);
    const code = transpileModule(source.slice(start, end).replace('export function notify', 'function notify'), {
      compilerOptions: { target: ScriptTarget.ES2022 }
    }).outputText;
    const vscode = { window: { showWarningMessage: vi.fn(), showErrorMessage: vi.fn(), showInformationMessage: vi.fn() } };
    const resultsView = {
      showWarningMessage: (...args: [message: string, optionsOrChoice?: import('vscode').MessageOptions | string, ...choices: string[]]) => h.queue.show('warning', ...args),
      showErrorMessage: (...args: [message: string, optionsOrChoice?: import('vscode').MessageOptions | string, ...choices: string[]]) => h.queue.show('error', ...args)
    };
    runInNewContext(`${code}; notify(kind, 'A notice');`, { resultsView, vscode, kind });
    expect(h.post).toHaveBeenCalledOnce(); expect(h.fallback).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled(); expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    h.queue.respond({ id: 1 });
  });
  it('uses the VS Code modal dialog and original choices when hidden', async () => {
    const h = host(false); h.fallback.mockResolvedValueOnce('Delete');
    await expect(h.queue.show('warning', 'Delete entry?', { modal: true, detail: 'Original detail' }, 'Delete')).resolves.toBe('Delete');
    expect(h.fallback).toHaveBeenCalledWith('warning', 'Delete entry?', { modal: true, detail: 'Original detail' }, ['Delete']);
    expect(h.post).not.toHaveBeenCalled();
  });
  // Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
  it('panel close leaves native confirmations with VS Code and preserves plain notices through VS Code', async () => {
    const h = host(); const pending = h.queue.show('warning', 'Delete entry?', { modal: true }, 'Delete');
    const plain = h.queue.show('error', 'An error'); h.queue.close();
    await expect(pending).resolves.toBeUndefined(); await plain;
    expect(h.fallback.mock.calls).toEqual([['warning', 'Delete entry?', { modal: true }, ['Delete']], ['error', 'An error', {}, []]]);
    expect(h.queue.snapshot()).toEqual([]);
  });
  // Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
  it('keeps Reset KREN as two separate native choices', async () => {
    const h = host(); h.fallback.mockResolvedValueOnce('Continue').mockResolvedValueOnce('Reset KREN');
    const run = async () => {
      if (await h.queue.show('warning', 'Reset KREN?', { modal: true }, 'Continue') !== 'Continue') return;
      return h.queue.show('warning', 'Last check.', { modal: true }, 'Reset KREN');
    };
    await expect(run()).resolves.toBe('Reset KREN');
    expect(h.fallback.mock.calls).toEqual([
      ['warning', 'Reset KREN?', { modal: true }, ['Continue']],
      ['warning', 'Last check.', { modal: true }, ['Reset KREN']]
    ]);
    expect(h.post).not.toHaveBeenCalled();
  });
  // Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
  it('ignores forged panel responses while VS Code owns the choice across a render', async () => {
    const h = host(); let answer!: (value: string) => void;
    h.fallback.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    const pending = h.queue.show('warning', 'Delete?', { modal: true }, 'Delete');
    h.queue.respond({ id: 1, choice: 'Other action' }); expect(h.queue.snapshot()).toEqual([]);
    h.queue.respond({ id: 1, choice: 'Delete' });
    expect(h.fallback).toHaveBeenCalledExactlyOnceWith('warning', 'Delete?', { modal: true }, ['Delete']);
    expect(h.post).not.toHaveBeenCalled();
    answer('Delete'); await expect(pending).resolves.toBe('Delete');
  });
  // Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
  it('the extension Reset KREN asks both original questions and declining the second deletes nothing', async () => {
    const h = host(); h.fallback.mockResolvedValueOnce('Continue');
    const source = readFileSync('src/extension.ts', 'utf8');
    const begin = source.indexOf('async function resetKren(');
    const end = source.indexOf('async function deleteAllApiKeys(', begin);
    const code = transpileModule(source.slice(begin, end), { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
    const clear = vi.fn(); const remove = vi.fn();
    const pending = runInNewContext(`${code}; resetKren(context);`, {
      context: { secrets: { get: vi.fn(async () => undefined), delete: remove } },
      KREN_SECRET_KEYS: {}, krenResetPlan: () => ({ configuration: true, credentials: true }),
      restoreDefaultConfiguration: clear,
      showKrenWarningMessage: (message: string, options: object, ...choices: string[]) => h.queue.show('warning', message, options, ...choices)
    });
    expect(h.fallback.mock.calls[0]![1]).toMatch(/^Reset KREN\?/u);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(h.fallback.mock.calls[1]![1]).toMatch(/^Last check\./u);
    expect(h.fallback.mock.calls[1]![3]).toEqual(['Reset KREN']);
    await pending; expect(h.post).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
  });
});
