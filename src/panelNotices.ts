import type { MessageOptions } from 'vscode';

export type PanelNoticeKind = 'information' | 'warning' | 'error';
export interface PanelNoticeOptions extends MessageOptions { signal?: AbortSignal }
export interface PanelNotice {
  id: number;
  kind: PanelNoticeKind;
  message: string;
  detail?: string;
  modal: boolean;
  choices: string[];
}

/** The only native message boundary. Every fallback is a dialog with an explicit action. */
export function showNativePanelNotice(window: Pick<typeof import('vscode').window,
    'showInformationMessage' | 'showWarningMessage' | 'showErrorMessage'>,
    kind: PanelNoticeKind, message: string, options: MessageOptions, choices: string[]): Thenable<string | undefined> {
  if (kind === 'information') return window.showInformationMessage(message, { ...options, modal: true }, ...choices);
  if (kind === 'warning') return window.showWarningMessage(message, { ...options, modal: true }, ...choices);
  return window.showErrorMessage(message, { ...options, modal: true }, ...choices);
}

/** Pending status notices survive a webview render, but never the panel closing. */
export class PanelNoticeQueue {
  private nextId = 0;
  private closed = false;
  private readonly nativeWaiting: Array<() => void> = [];
  private readonly pending = new Map<number, { notice: PanelNotice; resolve(value: string | undefined): void;
    cleanup(): void; startTimer(): void; stopTimer(): void; fallback(reason: string): void; shown: boolean; diagnostics: Set<string> }>();
  constructor(private readonly visible: () => boolean,
    private readonly post: (notice: PanelNotice) => PromiseLike<boolean> | undefined,
    private readonly fallback: (kind: PanelNoticeKind, message: string, options: MessageOptions, choices: string[]) => PromiseLike<string | undefined>,
    private readonly withdraw: (id: number) => PromiseLike<unknown> | void = () => {},
    private readonly log: (line: string) => void = () => {}) {}

  snapshot(): PanelNotice[] { return [...this.pending.values()].map(item => item.notice); }

  open(): void { this.closed = false; }

  private native(kind: PanelNoticeKind, message: string, options: MessageOptions, choices: string[]): PromiseLike<string | undefined> {
    return this.fallback(kind, message, { ...options, modal: true }, choices.length ? choices : ['OK']);
  }

  private drainNative(): void {
    if (this.pending.size) return;
    // VS Code owns native question ordering. A pending Find must not hold Reset.
    while (!this.pending.size && this.nativeWaiting.length) this.nativeWaiting.shift()?.();
  }

  private question(kind: PanelNoticeKind, message: string, options: MessageOptions, choices: string[], signal?: AbortSignal): Promise<string | undefined> {
    return new Promise(resolve => {
      const cancel = () => {
        const index = this.nativeWaiting.indexOf(show);
        if (index < 0) return;
        this.nativeWaiting.splice(index, 1);
        signal?.removeEventListener('abort', cancel);
        resolve(undefined);
      };
      const show = () => {
        signal?.removeEventListener('abort', cancel);
        if (signal?.aborted) { resolve(undefined); return; }
        let answer: PromiseLike<string | undefined>;
        try { answer = this.native(kind, message, options, choices); }
        catch { answer = Promise.resolve(undefined); }
        void Promise.resolve(answer)
          .catch(() => undefined).then(answer => {
            resolve(signal?.aborted ? undefined : answer);
          });
      };
      this.nativeWaiting.push(show);
      signal?.addEventListener('abort', cancel, { once: true });
      this.drainNative();
    });
  }

  show(kind: PanelNoticeKind, message: string, optionsOrChoice?: PanelNoticeOptions | string, ...items: string[]): Promise<string | undefined> {
    const { signal, ...options } = typeof optionsOrChoice === 'object' ? optionsOrChoice : {};
    const choices = typeof optionsOrChoice === 'string' ? [optionsOrChoice, ...items] : items;
    if (signal?.aborted) return Promise.resolve(undefined);
    // Questions use VS Code after the reader dismisses existing panel cards.
    if (choices.length > 0 || options.modal === true) {
      return this.question(kind, message, options, choices, signal);
    }
    if (this.closed || !this.visible()) {
      return Promise.resolve(this.native(kind, message, options, choices));
    }
    return new Promise(resolve => {
      const notice: PanelNotice = { id: ++this.nextId, kind, message, detail: options.detail,
        modal: options.modal === true, choices };
      const cancel = () => { if (this.remove(notice.id)) resolve(undefined); };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const startTimer = () => {
        if (timer || this.pending.get(notice.id)?.shown) return;
        timer = setTimeout(() => fallback('no acknowledgment in 1.5 s'), 1_500);
        timer.unref?.();
      };
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
      const fallback = (reason: string) => {
        if (!this.remove(notice.id)) return;
        this.log(`[panel notice] ${notice.id} fell back: ${reason}`);
        // The panel card is retired before the native modal can answer it.
        void Promise.resolve().then(() => this.native(kind, message, options, choices))
          .then(answer => resolve(signal?.aborted ? undefined : answer), () => resolve(undefined));
      };
      this.pending.set(notice.id, { notice, resolve, cleanup, startTimer, stopTimer: () => clearTimeout(timer), fallback, shown: false, diagnostics: new Set() });
      // Only the front card is eligible for acknowledgment. Reading an earlier card
      // never spends a queued notice's display budget.
      if (this.pending.size === 1) startTimer();
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        void Promise.resolve(this.post(notice)).then(delivered => {
          if (delivered !== true) fallback('not delivered');
        }, () => fallback('post failed'));
      } catch { fallback('post failed'); }
    });
  }

  /** A transport receipt is insufficient: the card must have a visible viewport box. */
  acknowledge(message: unknown): void {
    if (!message || typeof message !== 'object') return;
    const { id, visible, reason, coveredBy } = message as { id?: unknown; visible?: unknown; reason?: unknown; coveredBy?: unknown };
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || typeof visible !== 'boolean') return;
    const item = this.pending.get(id);
    if (!item) { this.withdrawCard(id); return; }
    if (!visible) {
      const check = ['zero box', 'outside viewport', 'visibility', 'display', 'opacity'].includes(String(reason))
        ? String(reason) : 'unspecified';
      const covered = reason === 'covered' && typeof coveredBy === 'string' && coveredBy.length <= 240 &&
        /^[a-z][a-z0-9-]*(?:\.[\w-]+)*$/u.test(coveredBy);
      item.fallback(covered ? `covered by ${coveredBy}` : `not visible (${check})`);
      return;
    }
    if (item.shown) return;
    item.shown = true;
    item.stopTimer();
  }

  notShown(message: unknown): void {
    if (!message || typeof message !== 'object') return;
    const { id, reason, error } = message as { id?: unknown; reason?: unknown; error?: unknown };
    if (typeof id !== 'number' || !Number.isSafeInteger(id)) return;
    const item = this.pending.get(id);
    if (!item) { this.withdrawCard(id); return; }
    if (!['already showing another card', 'a spinner card present', 'a stale overlay reference',
      'listener caught an exception'].includes(String(reason))) return;
    const detail = reason === 'listener caught an exception' && typeof error === 'string' ? ` (${error})` : '';
    const line = `[panel notice] ${id} not shown: ${reason}${detail}`;
    if (item.diagnostics.has(line)) return;
    item.diagnostics.add(line);
    this.log(line);
  }

  private remove(id: number) {
    const item = this.pending.get(id);
    if (!item) return undefined;
    this.pending.delete(id);
    item.cleanup();
    this.withdrawCard(id);
    this.pending.values().next().value?.startTimer();
    this.drainNative();
    return item;
  }

  private withdrawCard(id: number): void {
    // A dead transport cannot prevent the native dialog or leave its promise unresolved.
    try { void Promise.resolve(this.withdraw(id)).catch(() => undefined); } catch { /* The card is already retired. */ }
  }

  respond(message: unknown): void {
    if (!message || typeof message !== 'object') return;
    const { id, choice } = message as { id?: unknown; choice?: unknown };
    if (typeof id !== 'number') return;
    const item = this.pending.get(id);
    if (!item || (choice !== undefined && (typeof choice !== 'string' || !item.notice.choices.includes(choice)))) return;
    this.remove(id);
    item.resolve(choice as string | undefined);
  }

  close(): void {
    this.closed = true;
    const pending = [...this.pending.values()];
    for (const { notice, resolve } of pending) {
      this.remove(notice.id);
      void Promise.resolve(this.native(notice.kind, notice.message, { detail: notice.detail }, notice.choices)).then(resolve, () => resolve(undefined));
    }
  }
}

/** Busy-card sizing, also checked against the self-contained notice builder. */
export function panelPopupCardClass(message: string, detail = ''): string {
  return `busy-card${message.length + detail.length > 120 ? ' popup-long-message' : ''}`;
}

/** Self-contained DOM builder; textContent escapes all notice text in both consumers. */
export function buildPanelNoticeCard(document: Pick<Document, 'createElement' | 'createElementNS'>,
    notice: PanelNotice, close: () => void = () => {}): { overlay: HTMLElement; safe: HTMLButtonElement } {
  const overlay = document.createElement('div');
  overlay.className = 'busy-overlay';
  overlay.setAttribute('data-kren-notice', String(notice.id));
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', notice.kind === 'error' ? 'Error' : notice.kind === 'information' ? 'Information' : 'Warning');
  overlay.setAttribute('aria-describedby', 'kren-notice-message');
  const card = document.createElement('div');
  // This function is copied with toString() after production minification. Module
  // names are renamed there, so its body must use only locals and parameters.
  const longMessage = notice.message.length + (notice.detail?.length ?? 0) > 120;
  card.className = `busy-card${longMessage ? ' popup-long-message' : ''} notice-card`;
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'notice-icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = notice.kind === 'error' ? '⛔' : notice.kind === 'information' ? 'i' : '⚠';
  const text = document.createElement('div');
  text.className = 'popup-message';
  text.id = 'kren-notice-message';
  text.textContent = notice.message;
  if (notice.detail) {
    const detail = document.createElement('p');
    detail.textContent = notice.detail;
    text.append(detail);
  }
  const buttons = document.createElement('div');
  buttons.className = 'notice-actions';
  const safe = document.createElement('button');
  safe.type = 'button';
  safe.textContent = 'OK';
  safe.addEventListener('click', () => close());
  buttons.append(safe);
  card.append(icon, text, buttons);
  overlay.append(card);
  return { overlay, safe };
}

/** The renderer and isolated tests embed this exact script, including its card builder. */
export function panelNoticeScript(initial: PanelNotice[] = []): string {
  const notices = JSON.stringify(initial).replace(/</gu, String.raw`\u003c`);
  return `(() => { (${installPanelNotices.toString()})(vscode, ${notices}, ${buildPanelNoticeCard.toString()}, ${panelNoticeVisibility.toString()}); })();`.replace(/\r\n?/gu, '\n');
}

/** Measure the card as well as its overlay, because a full-screen empty veil is unsafe. */
export function panelNoticeVisibility(element: HTMLElement, hitTest = false): {
  visible: boolean; reason?: string; coveredBy?: string;
} {
  if (!element.isConnected) return { visible: false, reason: 'zero box' };
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.visibility !== 'visible') return { visible: false, reason: 'visibility' };
    if (style.display === 'none') return { visible: false, reason: 'display' };
    if (Number(style.opacity) <= 0) return { visible: false, reason: 'opacity' };
  }
  const box = element.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return { visible: false, reason: 'zero box' };
  if (box.right <= 0 || box.bottom <= 0 || box.left >= window.innerWidth || box.top >= window.innerHeight) {
    return { visible: false, reason: 'outside viewport' };
  }
  if (hitTest) {
    const x = (box.left + box.right) / 2;
    const y = (box.top + box.bottom) / 2;
    const top = document.elementFromPoint(x, y);
    if (!top || !element.contains(top)) {
      const tag = top?.tagName.toLowerCase() ?? 'none';
      const classes = (top?.getAttribute('class') ?? '').trim().split(/\s+/u).filter(Boolean);
      return { visible: false, reason: 'covered', coveredBy: [tag, ...classes].join('.').slice(0, 240) };
    }
  }
  return { visible: true };
}

/** Installed in a separate script before page initialization, including notice setup. */
export function panelScriptErrorScript(): string {
  // Resolve the main script's API lazily. A syntax error there still needs a reporting API.
  return `(() => {
    let errorApi;
    (${installPanelScriptErrors.toString()})({ postMessage(message) {
      if (!errorApi) { try { errorApi = vscode; } catch { errorApi = acquireVsCodeApi(); } }
      errorApi.postMessage(message);
    } });
  })();`.replace(/\r\n?/gu, '\n');
}

export function installPanelScriptErrors(vscode: { postMessage(message: unknown): void }): void {
  const seen = new Set<string>();
  const report = (message: unknown, line: unknown, column: unknown) => {
    if (typeof message !== 'string' || !message) return;
    const position = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
    const error = { command: 'panelScriptError', message, line: position(line), column: position(column) };
    const key = JSON.stringify(error);
    if (seen.has(key)) return;
    seen.add(key);
    vscode.postMessage(error);
  };
  window.addEventListener('error', event => report(event.message, event.lineno, event.colno));
  window.addEventListener('unhandledrejection', event => {
    // Only native Error metadata is eligible for text. Other values use browser event metadata.
    const reason: unknown = event.reason;
    report(reason instanceof Error ? reason.message : event.type, 0, 0);
  });
}

/** Self-contained behavior; every non-browser dependency is an explicit parameter. */
export function installPanelNotices(vscode: { postMessage(message: unknown): void }, initial: PanelNotice[],
    buildCard: typeof buildPanelNoticeCard, visibility: typeof panelNoticeVisibility): void {
  const queue: PanelNotice[] = [];
  const seen = new Set<number>();
  const acknowledged = new Map<number, boolean>();
  const reported = new Set<string>();
  let overlay: HTMLElement | undefined;
  let previousFocus: Element | null = null;
  const suspendedBusy: HTMLElement[] = [];
  let observer: MutationObserver | undefined;
  const observe = () => observer?.observe(document.body, { childList: true, subtree: true,
    attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  const notShown = (id: number, reason: string, error?: string) => {
    const key = JSON.stringify([id, reason, error]);
    if (reported.has(key)) return;
    reported.add(key);
    vscode.postMessage({ command: 'panelNoticeNotShown', id, reason, ...(error ? { error } : {}) });
  };
  const busy = () => Array.from(document.querySelectorAll<HTMLElement>('.busy-overlay:not([data-kren-notice])'))
    .map(overlay => {
      const card = overlay.querySelector<HTMLElement>('.busy-card');
      const visible = visibility(overlay).visible && !!card && visibility(card).visible;
      const pointerEvents = visible ? 'auto' : 'none';
      if (overlay.style.pointerEvents !== pointerEvents) overlay.style.pointerEvents = pointerEvents;
      return visible;
    }).some(Boolean);
  const clearOverlay = () => {
    overlay?.remove();
    overlay = undefined;
    document.body.removeAttribute('data-notice');
  };
  const restoreFocus = () => {
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    previousFocus = null;
  };
  const close = () => {
    const notice = queue.shift();
    if (!notice) return;
    clearOverlay();
    restoreFocus();
    vscode.postMessage({ command: 'panelNoticeResponse', id: notice.id, choice: undefined });
    showNext();
  };
  const showNext = () => {
    // Our own pointer-event measurements must not schedule another observer measurement.
    observer?.disconnect();
    try {
      // Reconcile DOM replacements and orphan veils before deciding a card is already shown.
      if (overlay && !overlay.isConnected) {
        if (queue[0]) notShown(queue[0].id, 'a stale overlay reference');
        overlay = undefined;
      }
      for (const card of Array.from(document.querySelectorAll<HTMLElement>('[data-kren-notice]'))) {
        if (card !== overlay || card.getAttribute('data-kren-notice') !== String(queue[0]?.id)) card.remove();
      }
      // Failures must remain reachable while an operation is busy.
      // Detach the busy card until dismissal, preserving the answer box and player.
      if (queue.some(notice => notice.kind === 'error')) {
        for (const card of Array.from(document.querySelectorAll<HTMLElement>('.busy-overlay:not([data-kren-notice])'))) {
          suspendedBusy.push(card);
          card.remove();
        }
      } else {
        for (const card of suspendedBusy.splice(0)) {
          if (!card.hasAttribute('data-panel-progress-retired')) document.body.append(card);
        }
      }
      if (busy()) {
        clearOverlay();
        for (const notice of queue) notShown(notice.id, 'a spinner card present');
        return;
      }
      if (!queue.length) { clearOverlay(); return; }
      const notice = queue[0]!;
      let safe: HTMLButtonElement | undefined;
      if (!overlay) {
        previousFocus ??= document.activeElement;
        const built = buildCard(document, notice, close);
        overlay = built.overlay;
        overlay.style.pointerEvents = 'none';
        document.body.append(overlay);
        document.body.setAttribute('data-notice', '');
        safe = built.safe;
      }
      const card = overlay.querySelector<HTMLElement>('.notice-card');
      let result = visibility(overlay);
      if (result.visible) result = card ? visibility(card) : { visible: false, reason: 'zero box' };
      if (result.visible && card) {
        // Hit testing honors pointer-events. Enable it only within this synchronous check.
        overlay.style.pointerEvents = 'auto';
        result = visibility(card, true);
      }
      const { visible } = result;
      const pointerEvents = visible ? 'auto' : 'none';
      if (overlay.style.pointerEvents !== pointerEvents) overlay.style.pointerEvents = pointerEvents;
      if (!visible) document.body.removeAttribute('data-notice');
      else { document.body.setAttribute('data-notice', ''); safe?.focus(); }
      if (!acknowledged.has(notice.id) || (acknowledged.get(notice.id) && !visible)) {
        acknowledged.set(notice.id, visible);
        vscode.postMessage({ command: 'panelNoticeShown', id: notice.id, ...result });
      }
    } catch (error) {
      const id = queue[0]?.id;
      clearOverlay();
      if (id !== undefined) notShown(id, 'listener caught an exception', error instanceof Error ? error.message : 'Unknown exception');
    } finally { observe(); }
  };
  const enqueue = (notice: PanelNotice) => {
    if (seen.has(notice.id)) return;
    seen.add(notice.id);
    queue.push(notice);
    if (queue.length > 1) notShown(notice.id, overlay && !overlay.isConnected
      ? 'a stale overlay reference' : 'already showing another card');
    showNext();
  };
  window.addEventListener('message', event => {
    if (event.data?.command === 'panelNotice') enqueue(event.data.notice);
    if (event.data?.command === 'panelNoticeWithdraw') {
      const index = queue.findIndex(notice => notice.id === event.data.id);
      if (index >= 0) queue.splice(index, 1);
      if (overlay?.getAttribute('data-kren-notice') === String(event.data.id)) { clearOverlay(); restoreFocus(); }
      showNext();
    }
    if (event.data?.command === 'panelNoticesClosed') {
      queue.splice(0);
      clearOverlay();
      restoreFocus();
      showNext();
    }
  });
  document.addEventListener('keydown', event => {
    if (!overlay || overlay.style.pointerEvents === 'none') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      overlay.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }, true);
  document.addEventListener('focusin', event => {
    if (overlay && overlay.style.pointerEvents !== 'none' && event.target instanceof Node && !overlay.contains(event.target)) {
      overlay.querySelector<HTMLButtonElement>('.notice-actions button:last-child')?.focus();
    }
  });
  observer = new MutationObserver(showNext);
  observe();
  window.addEventListener('resize', showNext);
  window.addEventListener('scroll', showNext);
  showNext();
  initial.forEach(enqueue);
}
