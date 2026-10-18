// 2026-10-12: Run the entire shipped panel script with the repository's Cheerio DOM adapter.
// Media events are explicit, because resolving play() does not mean playback ended.
import { load } from 'cheerio';
import { createContext, runInContext, runInNewContext } from 'node:vm';

export function mountedPanel(html: string, postMessage: (message: Record<string, unknown>) => void,
  media: { playError?: { name: string }; state?: Record<string, unknown>;
    style?: (element: { getAttribute(name: string): string | null }) => Record<string, string | undefined>;
    startupError?: string } = {}) {
  const $ = load(html);
  const cache = new Map<unknown, Element>();
  const events = new Map<unknown, Map<string, Array<(event: any) => void>>>();
  const listen = (owner: unknown, name: string, callback: (event: any) => void) => {
    if (!events.has(owner)) events.set(owner, new Map());
    const list = events.get(owner)!;
    list.set(name, [...(list.get(name) ?? []), callback]);
  };
  const emit = (owner: unknown, name: string, event: any = {}) => {
    for (const callback of events.get(owner)?.get(name) ?? []) callback(event);
  };
  class Element {
    constructor(public node: ReturnType<typeof $>) {}
    get tagName() { return this.node[0]?.type === 'tag' ? this.node[0].name.toUpperCase() : ''; }
    get textContent() { return this.node.text(); }
    set textContent(value: string) { this.node.text(value); }
    get innerHTML() { return this.node.html() ?? ''; }
    set innerHTML(value: string) { this.node.html(value); }
    get outerHTML() { return $.html(this.node); }
    get className() { return this.node.attr('class') ?? ''; }
    set className(value: string) { this.node.attr('class', value); }
    get hidden() { return this.hasAttribute('hidden'); }
    set hidden(value: boolean) { this.flag('hidden', value); }
    get disabled() { return this.hasAttribute('disabled'); }
    set disabled(value: boolean) { this.flag('disabled', value); }
    get checked() { return this.hasAttribute('checked'); }
    set checked(value: boolean) { this.flag('checked', value); }
    get open() { return this.hasAttribute('open'); }
    set open(value: boolean) { this.flag('open', value); }
    private storedValue?: string;
    get value(): string { return this.storedValue ?? (this.tagName === 'TEXTAREA' ? this.textContent : this.tagName === 'SELECT' ? this.node.find('option[selected]').attr('value') ?? this.node.find('option').attr('value') ?? '' : this.getAttribute('value') ?? ''); }
    set value(value: string) { this.storedValue = value; }
    get selectedOptions() { return [wrap(this.node.find('option[value="' + this.value + '"]').first())]; }
    get options() { return this.querySelectorAll('option'); }
    get title() { return this.getAttribute('title') ?? ''; }
    set title(value: string) { this.setAttribute('title', value); }
    get id() { return this.getAttribute('id') ?? ''; }
    set id(value: string) { this.setAttribute('id', value); }
    get src() { return this.getAttribute('src') ?? ''; }
    set src(value: string) { this.setAttribute('src', value); }
    get parentElement() { return wrap(this.node.parent()); }
    get children() { return this.node.children().toArray().map(node => wrap($(node))!); }
    get firstChild() { return wrap(this.node.contents().first()); }
    get lastElementChild() { return wrap(this.node.children().last()); }
    get isConnected() { return this.node.parents('html').length > 0; }
    flag(name: string, value: boolean) { if (value) this.setAttribute(name, ''); else this.removeAttribute(name); }
    getAttribute(name: string) { return this.node.attr(name) ?? null; }
    hasAttribute(name: string) { return this.node.is('[' + name + ']'); }
    setAttribute(name: string, value: string) { this.node.attr(name, String(value)); }
    removeAttribute(name: string) { this.node.removeAttr(name); }
    querySelector(selector: string) { return wrap(this.node.find(selector).first()); }
    querySelectorAll(selector: string) { return this.node.find(selector).toArray().map(node => wrap($(node))!); }
    closest(selector: string) { return wrap(this.node.closest(selector)); }
    matches(selector: string) { return this.node.is(selector); }
    contains(child: Element) { return child === this || child.node.parents().toArray().some(node => node === this.node[0]); }
    appendChild(child: Element) { this.node.append(child.node); return child; }
    append(...children: Element[]) { children.forEach(child => this.appendChild(child)); }
    replaceChildren(...children: Element[]) { this.node.empty(); this.append(...children); }
    replaceWith(child: Element) { this.node.replaceWith(child.node); }
    insertBefore(child: Element, before: Element | null) { if (before) before.node.before(child.node); else this.appendChild(child); }
    cloneNode() { return wrap(this.node.clone())!; }
    remove() { this.node.remove(); }
    addEventListener(name: string, callback: (event: any) => void) { listen(this, name, callback); }
    removeEventListener() {}
    focus(_options?: unknown) { document.activeElement = this; }
    scrollIntoView() {}
    getBoundingClientRect() { return { top: 0, bottom: 300, left: 0, right: 500, width: 500, height: 300 }; }
    scrollTop = 0; scrollHeight = 300; clientHeight = 300;
    complete = false; naturalWidth = 0;
    style: { pointerEvents?: string; setProperty(): void; removeProperty(): void } = { setProperty() {}, removeProperty() {} };
    classList = { contains: (name: string) => this.node.hasClass(name), add: (...names: string[]) => names.forEach(name => this.node.addClass(name)),
      remove: (...names: string[]) => names.forEach(name => this.node.removeClass(name)),
      toggle: (name: string, on: boolean) => this.node.toggleClass(name, on) };
  }
  class Textarea extends Element {}
  class Select extends Element {}
  class Button extends Element {}
  class Input extends Element {}
  class PanelInputEvent { constructor(public readonly inputType: string) {} }
  class Details extends Element {}
  class Audio extends Element {
    ended = false; error: unknown = null; volume = 1;
    play() { this.ended = false; return media.playError ? Promise.reject(media.playError) : Promise.resolve(); }
    pause() {}
    load() {}
  }
  const classes: Record<string, typeof Element> = { textarea: Textarea, select: Select, button: Button, input: Input, details: Details, audio: Audio };
  const wrap = (node: ReturnType<typeof $>): Element | null => {
    if (!node.length) return null;
    if (!cache.has(node[0])) {
      const tag = (node[0] as { name?: string }).name ?? '';
      cache.set(node[0], new (classes[tag] ?? Element)(node));
    }
    return cache.get(node[0])!;
  };
  const document = { querySelector: (selector: string) => wrap($(selector).first()),
    elementFromPoint: (_x: number, _y: number) => wrap($('.notice-card').last()),
    querySelectorAll: (selector: string) => $(selector).toArray().map(node => wrap($(node))!),
    getElementById: (id: string) => wrap($('#' + id)),
    createElement: (tag: string) => wrap($('<' + tag + '>'))!,
    createElementNS: (_namespace: string, tag: string) => wrap($('<' + tag + '>'))!,
    createTextNode: (text: string) => wrap($('<span>').text(text).contents())!,
    documentElement: wrap($('html'))!, body: wrap($('body'))!, activeElement: null as Element | null,
    fonts: { ready: Promise.resolve() }, addEventListener: (name: string, callback: (event: any) => void) => listen(document, name, callback) };
  const window = { addEventListener: (name: string, callback: (event: any) => void) => listen(window, name, callback),
    setTimeout, clearTimeout, scrollTo() {}, scrollY: 0, innerWidth: 800, innerHeight: 600 };
  const api = { getState: () => { if (media.startupError) throw new Error(media.startupError); return media.state ?? {}; }, setState() {}, postMessage };
  const observers: Array<() => void> = [];
  const context = createContext({ document, window, acquireVsCodeApi: () => api,
    HTMLElement: Element, Element, Node: Element, InputEvent: PanelInputEvent, HTMLTextAreaElement: Textarea, HTMLSelectElement: Select, HTMLButtonElement: Button,
    HTMLInputElement: Input, HTMLDetailsElement: Details, HTMLAudioElement: Audio, HTMLImageElement: Element,
    HTMLParagraphElement: Element, HTMLDivElement: Element, HTMLSpanElement: Element,
    MutationObserver: class { constructor(callback: () => void) { observers.push(callback); } observe() {} disconnect() {} }, ResizeObserver: class { observe() {} },
    DOMParser: class { parseFromString(value: string) {
      const parsed = load(value);
      return { querySelector: (selector: string) => wrap(parsed(selector).first()) };
    } },
    setTimeout, clearTimeout, requestAnimationFrame: (callback: () => void) => callback(),
    getComputedStyle: (element: Element) => ({ visibility: 'visible', display: element.hidden || element.classList.contains('hidden') ? 'none' : 'grid',
      opacity: '1', getPropertyValue: () => '', ...media.style?.(element) }) });
  // Changed 2026-10-18: V266, owner item I49, preserve separate browser script execution and browser error events.
  for (const script of $('script').toArray()) {
    try { runInNewContext($(script).text(), context); }
    catch (error) {
      if (!media.startupError) throw error;
      emit(window, 'error', { message: (error as Error).message, lineno: 12, colno: 7 });
    }
  }
  return { document, query: document.querySelector, message: (message: Record<string, unknown>) => emit(window, 'message', { data: message }),
    event: (element: Element, name: string) => emit(element, name, { target: element }),
    input: (element: Element, inputType: string) => {
      const event = Object.assign(new PanelInputEvent(inputType), { target: element });
      emit(element, 'input', event); emit(document, 'input', event);
    },
    change: (element: Element) => emit(document, 'change', { target: element }),
    click: (element: Element) => { const event = { target: element, preventDefault() {} }; emit(element, 'click', event); emit(document, 'click', event); },
    key: (key: string) => emit(document, 'keydown', { key, preventDefault() {}, stopImmediatePropagation() {} }),
    mutate: () => observers.forEach(callback => callback()),
    browserEvent: (name: string, event: Record<string, unknown>) => emit(window, name, { type: name, ...event }),
    evaluate: (code: string) => runInContext(code, context),
    audioStart() { emit(document.getElementById('kren-audio'), 'playing'); },
    audioError(code: number) { const audio = document.getElementById('kren-audio') as Audio; audio.error = { code }; emit(audio, 'error'); },
    audioEnd() { const audio = document.getElementById('kren-audio') as Audio; audio.ended = true; emit(audio, 'ended'); } };
}
