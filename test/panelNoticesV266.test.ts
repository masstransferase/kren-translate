import { afterEach, expect, it, vi } from 'vitest';
import { PanelNoticeQueue, type PanelNotice } from '../src/panelNotices.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

afterEach(() => vi.useRealTimers());
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const host = (post: (notice: PanelNotice) => PromiseLike<boolean> = async () => true) => {
  const fallback = vi.fn(async (_kind: string, _message: string, _options: object, _choices: string[]) => 'Continue' as string | undefined);
  const withdraw = vi.fn(), log = vi.fn();
  const queue = new PanelNoticeQueue(() => true, post, fallback, withdraw, log);
  return { queue, fallback, withdraw, log };
};
const html = (busyNotice?: string) => renderKrenResultViewHtml({ nonce: 'test', cspSource: 'test', settings: PANEL_SETTINGS_FIXTURE, proModels: [], busyNotice });
// Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
// V266 visibility, acknowledgment, cancellation, and fallback checks now exercise status notices.
const notice: PanelNotice = { id: 1, kind: 'warning', message: 'A private status', modal: false, choices: [] };

it.each(['delivered', 'unsettled'] as const)('V266 falls back at 1500 ms for a never-acknowledged %s post', async mode => {
  vi.useFakeTimers();
  const h = host(mode === 'unsettled' ? () => new Promise(() => {}) : undefined);
  const result = h.queue.show('warning', notice.message, { detail: 'Private detail' });
  await vi.advanceTimersByTimeAsync(1499); expect(h.fallback).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(h.withdraw).toHaveBeenCalledExactlyOnceWith(1);
  expect(h.queue.snapshot()).toEqual([]);
  // Changed 2026-10-22 (V292, owner I59/D20 A): popup instead of notification.
  expect(h.fallback).toHaveBeenCalledExactlyOnceWith('warning', notice.message, { modal: true, detail: 'Private detail' }, ['OK']);
  await expect(result).resolves.toBe('Continue');
  expect(h.log).toHaveBeenCalledExactlyOnceWith('[panel notice] 1 fell back: no acknowledgment in 1.5 s');
});

it('V266 withdraws a negative acknowledgment immediately and only the native answer resolves the original question', async () => {
  vi.useFakeTimers(); const h = host();
  let answer!: (value: string) => void;
  h.fallback.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
  const result = h.queue.show('warning', notice.message, undefined);
  h.queue.acknowledge({ id: 1, visible: false, reason: 'zero box' }); await flush();
  expect(h.withdraw).toHaveBeenCalledExactlyOnceWith(1);
  expect(h.fallback).toHaveBeenCalledOnce();
  h.queue.respond({ id: 1, choice: 'Continue' });
  let settled = false; void result.then(() => { settled = true; }); await flush(); expect(settled).toBe(false);
  h.queue.acknowledge({ id: 1, visible: true });
  await vi.advanceTimersByTimeAsync(2000); expect(h.fallback).toHaveBeenCalledOnce();
  answer('Continue'); await expect(result).resolves.toBe('Continue');
  expect(h.log).toHaveBeenCalledExactlyOnceWith('[panel notice] 1 fell back: not visible (zero box)');
});

it('V266 a visible acknowledgment stops the timer but preserves cancellation and ignores malformed acknowledgments', async () => {
  vi.useFakeTimers(); const h = host(), controller = new AbortController();
  const result = h.queue.show('warning', notice.message, { signal: controller.signal });
  h.queue.acknowledge({ id: 1, visible: 'true' }); await vi.advanceTimersByTimeAsync(1000);
  h.queue.acknowledge({ id: 1, visible: true }); await vi.advanceTimersByTimeAsync(3000);
  expect(h.fallback).not.toHaveBeenCalled(); expect(h.queue.snapshot()).toHaveLength(1);
  controller.abort(); await expect(result).resolves.toBeUndefined();
  expect(h.queue.snapshot()).toEqual([]); expect(h.withdraw).toHaveBeenCalledExactlyOnceWith(1);
});

it.each(['opacity', 'display', 'visibility', 'zero', 'offscreen'] as const)('V266 %s cards acknowledge false and cannot capture clicks', kind => {
  const sent = vi.fn();
  const panel = mountedPanel(html(), sent, { style: element => element.getAttribute('class')?.includes('notice-card')
    ? kind === 'opacity' ? { opacity: '0' } : kind === 'display' ? { display: 'none' } : kind === 'visibility' ? { visibility: 'hidden' } : {} : {} });
  if (kind === 'zero' || kind === 'offscreen') {
    // Exercise the shipped visibility measurement with actual DOM methods in the VM.
    panel.evaluate(`const originalCreate = document.createElement; document.createElement = tag => {
      const element = originalCreate(tag);
      const box = element.getBoundingClientRect.bind(element);
      element.getBoundingClientRect = () => element.className.includes('notice-card')
        ? ${kind === 'zero' ? '{left:0,right:0,top:0,bottom:0,width:0,height:0}' : '{left:900,right:1000,top:0,bottom:100,width:100,height:100}'} : box();
      return element;
    };`);
  }
  panel.message({ command: 'panelNotice', notice });
  expect(sent).toHaveBeenCalledWith({ command: 'panelNoticeShown', id: 1, visible: false,
    reason: kind === 'zero' ? 'zero box' : kind === 'offscreen' ? 'outside viewport' : kind });
  expect(panel.query('[data-kren-notice]')!.style.pointerEvents).toBe('none');
  expect(panel.document.body.hasAttribute('data-notice')).toBe(false);
});

it('V266 repairs a removed card, removes orphan veils and withdraws without blocking the next card', () => {
  const sent = vi.fn(), panel = mountedPanel(html(), sent);
  panel.message({ command: 'panelNotice', notice });
  const first = panel.query('[data-kren-notice]')!;
  expect(first.style.pointerEvents).toBe('auto');
  expect(sent).toHaveBeenCalledWith({ command: 'panelNoticeShown', id: 1, visible: true });
  first.remove(); panel.mutate();
  expect(panel.query('[data-kren-notice]')!.isConnected).toBe(true);
  expect(panel.query('[data-kren-notice]')).not.toBe(first);
  const orphan = panel.document.createElement('div'); orphan.setAttribute('data-kren-notice', '999');
  panel.document.body.append(orphan); panel.mutate(); expect(orphan.isConnected).toBe(false);
  panel.message({ command: 'panelNotice', notice: { ...notice, id: 2 } });
  panel.message({ command: 'panelNoticeWithdraw', id: 1 });
  expect(panel.query('[data-kren-notice]')?.getAttribute('data-kren-notice')).toBe('2');
  panel.message({ command: 'panelNoticeWithdraw', id: 2 });
  expect(panel.query('[data-kren-notice]')).toBeNull();
});

it('V266 a later invisible card drops pointer capture and reports its loss', () => {
  let hidden = false; const sent = vi.fn();
  const panel = mountedPanel(html(), sent, { style: () => ({ opacity: hidden ? '0' : '1' }) });
  panel.message({ command: 'panelNotice', notice }); hidden = true; panel.mutate();
  expect(sent.mock.calls.filter(([message]) => message.command === 'panelNoticeShown').map(([message]) => message.visible)).toEqual([true, false]);
  expect(panel.query('[data-kren-notice]')!.style.pointerEvents).toBe('none');
});

it('V266 an initialization throw is reported by the independent script, without page text', () => {
  const sent = vi.fn();
  const panel = mountedPanel(html(), sent, { startupError: 'Initialization failed' });
  expect(sent).toHaveBeenCalledExactlyOnceWith({ command: 'panelScriptError', message: 'Initialization failed', line: 12, column: 7 });
  panel.browserEvent('error', { message: 'Initialization failed', lineno: 12, colno: 7, target: { textContent: 'Private page text' } });
  panel.browserEvent('unhandledrejection', { reason: 'Private input rejection' });
  panel.browserEvent('unhandledrejection', { reason: panel.evaluate('new Error("Rejected operation")') });
  expect(sent.mock.calls.map(([message]) => message)).toEqual([
    { command: 'panelScriptError', message: 'Initialization failed', line: 12, column: 7 },
    { command: 'panelScriptError', message: 'unhandledrejection', line: 0, column: 0 },
    { command: 'panelScriptError', message: 'Rejected operation', line: 0, column: 0 }
  ]);
});

it('V266 a covered card reports only the center hit tag and classes and falls back immediately', async () => {
  const h = host(notice => { panel.message({ command: 'panelNotice', notice }); return Promise.resolve(true); });
  const sent = vi.fn((message: Record<string, unknown>) => { if (message.command === 'panelNoticeShown') h.queue.acknowledge(message); });
  const panel = mountedPanel(html(), sent);
  panel.evaluate(`const cover = document.createElement('section'); cover.id = 'cover'; cover.className = 'panel-cover top';
    cover.textContent = 'Private page content'; document.body.append(cover);
    document.elementFromPoint = (x, y) => { if (x !== 250 || y !== 150) throw new Error('Wrong center'); return cover; };`);
  const result = h.queue.show('warning', notice.message, undefined);
  await expect(result).resolves.toBe('Continue');
  expect(sent).toHaveBeenCalledWith({ command: 'panelNoticeShown', id: 1, visible: false, reason: 'covered', coveredBy: 'section.panel-cover.top' });
  expect(h.log).toHaveBeenCalledExactlyOnceWith('[panel notice] 1 fell back: covered by section.panel-cover.top');
  expect(panel.query('[data-kren-notice]')!.style.pointerEvents).toBe('none');
});

it.each(['visible', 'overlay', 'card'] as const)('V266 spinner from the page render, hidden=%s, preserves error and warning status behavior', async mode => {
  vi.useFakeTimers();
  const hidden = mode !== 'visible';
  for (const kind of ['error', 'warning'] as const) {
    let panel!: ReturnType<typeof mountedPanel>;
    const fallback = vi.fn(async () => 'Continue');
    const log = vi.fn(), sent = vi.fn((message: Record<string, unknown>) => {
      if (message.command === 'panelNoticeShown') queue.acknowledge(message);
      if (message.command === 'panelNoticeNotShown') queue.notShown(message);
    });
    const queue = new PanelNoticeQueue(() => true,
      notice => { panel.message({ command: 'panelNotice', notice }); return Promise.resolve(true); }, fallback,
      id => panel.message({ command: 'panelNoticeWithdraw', id }), log);
    panel = mountedPanel(html('Working on the explicit request.'), sent);
    const spinner = panel.query('.busy-overlay:not([data-kren-notice])')!;
    expect(spinner.querySelector('.busy-spinner')).not.toBeNull();
    const hiddenElement = mode === 'card' ? spinner.querySelector('.busy-card')! : spinner;
    hiddenElement.hidden = hidden; panel.mutate();
    const result = queue.show(kind, 'The original status');
    if (kind === 'warning' && !hidden) {
      expect(panel.query('[data-kren-notice]')).toBeNull();
      expect(sent).toHaveBeenCalledWith({ command: 'panelNoticeNotShown', id: 1, reason: 'a spinner card present' });
      await vi.advanceTimersByTimeAsync(1500);
      await expect(result).resolves.toBe('Continue');
      // Changed 2026-10-22 (V292, owner I59/D20 A): popup instead of notification.
      expect(fallback).toHaveBeenCalledExactlyOnceWith('warning', 'The original status', { modal: true }, ['OK']);
      expect(log).toHaveBeenCalledWith('[panel notice] 1 fell back: no acknowledgment in 1.5 s');
    } else {
      const card = panel.query('[data-kren-notice]')!;
      expect(card.isConnected).toBe(true);
      expect(card.closest('details, [hidden], .hidden')).toBeNull();
      expect(panel.document.activeElement?.textContent).toBe('OK');
      expect(spinner.isConnected).toBe(kind !== 'error');
      expect(sent).toHaveBeenCalledWith({ command: 'panelNoticeShown', id: 1, visible: true });
      queue.respond({ id: 1 }); await expect(result).resolves.toBeUndefined();
      expect(spinner.isConnected).toBe(true); expect(hiddenElement.hidden).toBe(hidden);
      if (hidden) expect(spinner.style.pointerEvents).toBe('none');
      await vi.advanceTimersByTimeAsync(1500); expect(fallback).not.toHaveBeenCalled();
    }
    expect(panel.query('[data-kren-notice]')).toBeNull();
    queue.close();
  }
});

it.each(['zero box', 'outside viewport', 'visibility', 'display', 'opacity'])('V266 logs the exact %s visibility failure once', async reason => {
  const h = host(); const result = h.queue.show('warning', notice.message, undefined);
  h.queue.acknowledge({ id: 1, visible: false, reason });
  h.queue.acknowledge({ id: 1, visible: false, reason });
  await expect(result).resolves.toBe('Continue');
  expect(h.log).toHaveBeenCalledExactlyOnceWith(`[panel notice] 1 fell back: not visible (${reason})`);
  expect(h.fallback).toHaveBeenCalledOnce();
});

it.each(['throw', 'reject'] as const)('V266 a failed withdrawal transport (%s) cannot prevent the native fallback', async mode => {
  vi.useFakeTimers(); const fallback = vi.fn(async () => 'Continue');
  const queue = new PanelNoticeQueue(() => true, async () => true, fallback, () => {
    if (mode === 'throw') throw new Error('Panel transport closed');
    return Promise.reject(new Error('Panel transport closed'));
  });
  const result = queue.show('warning', notice.message, undefined);
  await vi.advanceTimersByTimeAsync(1500); await expect(result).resolves.toBe('Continue');
  expect(queue.snapshot()).toEqual([]); expect(fallback).toHaveBeenCalledOnce();
});

it('V266 reports another card, a stale reference and a caught listener exception without swallowing their identities', () => {
  const sent = vi.fn(), panel = mountedPanel(html(), sent);
  panel.message({ command: 'panelNotice', notice });
  panel.message({ command: 'panelNotice', notice: { ...notice, id: 2 } });
  expect(sent).toHaveBeenCalledWith({ command: 'panelNoticeNotShown', id: 2, reason: 'already showing another card' });
  panel.query('[data-kren-notice]')!.remove(); panel.mutate();
  expect(sent).toHaveBeenCalledWith({ command: 'panelNoticeNotShown', id: 1, reason: 'a stale overlay reference' });
  panel.message({ command: 'panelNoticesClosed' });
  panel.evaluate('document.createElement = () => { throw new Error("Card builder failed"); };');
  panel.message({ command: 'panelNotice', notice: { ...notice, id: 3 } });
  expect(sent).toHaveBeenCalledWith({ command: 'panelNoticeNotShown', id: 3, reason: 'listener caught an exception', error: 'Card builder failed' });
  expect(panel.query('[data-kren-notice]')).toBeNull();
});
