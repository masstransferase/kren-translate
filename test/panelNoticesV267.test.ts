import { expect, it, vi } from 'vitest';
vi.mock('vscode', async () => {
  const { nativeDialogV267, nativeErrorDialogV267 } = await import('./support/v267NativeDialogs.js');
  return { commands: { executeCommand: async () => {} },
    window: { showWarningMessage: nativeDialogV267, showErrorMessage: nativeErrorDialogV267 },
    Uri: { joinPath: (...parts: unknown[]) => parts },
    workspace: { getConfiguration: () => ({ get: (_key: string, value: unknown) => value }) } };
});
import { checkV267Questions } from './support/v267NoticeChecks.js';
import { PanelNoticeQueue } from '../src/panelNotices.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { load } from 'cheerio';

it('V267 the panel manual explains where questions and status popups appear', () => {
  const page = load(renderKrenResultViewHtml({ nonce: 'test', cspSource: 'test', settings: PANEL_SETTINGS_FIXTURE,
    proModels: [], activeScreen: 'manual' }));
  const manual = page('#manual-screen:not(.hidden)').text();
  expect(manual).toMatch(/questions with choices.*VS Code's own dialog/iu);
  expect(manual).toMatch(/Escape cancels/iu);
  // Changed 2026-10-23 (V305, owner I74/D41 A): speech has no busy popup; other activity and failure notices retain their panel location.
  expect(manual).toMatch(/speech.*no busy popup/iu);
  expect(manual).toMatch(/busy popups.*failures.*provider-switch notices.*stay in the KREN panel/iu);
});

it('V267 routes all 23 I49 questions through VS Code once with the original arguments', async () => {
  expect(await checkV267Questions()).toBe(23);
});
it.each([true, false])('V267 routes choices and modal-only notices natively with panel visible=%s', async visible => {
  for (const kind of ['warning', 'error'] as const) {
    for (const options of [{}, { modal: false, detail: 'Original detail' }, { modal: true }]) {
      const post = vi.fn(); const fallback = vi.fn(async () => 'Answer');
      const queue = new PanelNoticeQueue(() => visible, post, fallback);
      await expect(queue.show(kind, 'Original question', options, 'Answer', 'Cancel')).resolves.toBe('Answer');
      // Changed 2026-10-22 (V292, owner I59/D20 A): popup instead of notification.
      expect(fallback).toHaveBeenCalledExactlyOnceWith(kind, 'Original question', { ...options, modal: true }, ['Answer', 'Cancel']);
      expect(post).not.toHaveBeenCalled(); expect(queue.snapshot()).toEqual([]);
    }
    const post = vi.fn(); const fallback = vi.fn(async () => undefined);
    const queue = new PanelNoticeQueue(() => visible, post, fallback);
    await expect(queue.show(kind, 'Modal only', { modal: true, detail: 'Original detail' })).resolves.toBeUndefined();
    // Changed 2026-10-22 (V292, owner I59/D20 A): popup instead of notification.
    expect(fallback).toHaveBeenCalledExactlyOnceWith(kind, 'Modal only', { modal: true, detail: 'Original detail' }, ['OK']);
    expect(post).not.toHaveBeenCalled();
  }
});
