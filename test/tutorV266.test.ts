import { expect, it, vi } from 'vitest';
const fallback = vi.hoisted(() => vi.fn(async (..._args: any[]) => undefined as string | undefined));
vi.mock('vscode', async () => {
  const { nativeDialogV267 } = await import('./support/v267NativeDialogs.js');
  fallback.mockImplementation(nativeDialogV267);
  return ({ commands: { executeCommand: async () => {} },
  window: { showWarningMessage: fallback, showErrorMessage: fallback },
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_key: string, value: unknown) => value }) } });
});
import { checkV266Journey, checkV266FindQueue } from './support/v266NoticeChecks.js';
import { queueHostV265, flushV265 } from './support/v265QueueChecks.js';

it('V266 diagnoses the real provider Find, Reset and Settings journey in the mounted page', checkV266Journey);
it('V266 releases Find, presents Reset immediately and refuses retired choices', checkV266FindQueue);

it('V266 the real receiver withdraws a card whose id is no longer pending', async () => {
  const h = queueHostV265();
  try {
    h.panel().message({ command: 'panelNotice', notice: { id: 999, kind: 'warning', message: 'An orphan', modal: false, choices: [] } });
    await flushV265();
    expect(h.panel().query('[data-kren-notice]')).toBeNull();
    expect(h.messages).toContainEqual({ command: 'panelNoticeWithdraw', id: 999 });
  } finally { h.view.dispose(); }
});

it('V266 the real receiver logs each browser error once, using message and position only', () => {
  const h = queueHostV265();
  try {
    for (let i = 0; i < 2; i++) h.panel().browserEvent('error', { message: 'Panel operation failed', lineno: 123, colno: 7,
      target: { textContent: 'Private learner words' } });
    h.receive({ command: 'panelScriptError', message: 'Panel operation failed', line: 123, column: 7, text: 'Private input' });
    h.receive({ command: 'panelScriptError', message: 'Malformed', line: '123', column: 7 });
    h.panel().browserEvent('unhandledrejection', { reason: h.panel().evaluate('new Error("Async operation failed")') });
    h.panel().browserEvent('unhandledrejection', { reason: { message: 'Private rejected value' } });
    expect(h.logs.filter(line => line.startsWith('[panel error]'))).toEqual([
      '[panel error] Panel operation failed @123:7', '[panel error] Async operation failed @0:0',
      '[panel error] unhandledrejection @0:0'
    ]);
  } finally { h.view.dispose(); }
});

it('V266 a native Find choice arriving after Reset cannot change the reset session', async () => {
  const h = queueHostV265();
  let answer!: (choice: string) => void;
  fallback.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
  try {
    h.receive({ command: 'findTutorTargets', search: 'past tense' }); await flushV265();
    // Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
    expect(h.panel().query('[data-kren-notice]')).toBeNull();
    expect(fallback).toHaveBeenCalled();
    h.receive({ command: 'resetTutorSession' }); await flushV265();
    const reset = h.dialogs.at(-1)!;
    expect(reset.message).toContain('Reset the AI English Tutor');
    expect(reset.choices).toEqual(['Reset panel', 'Reset everything']);
    reset.answer('Reset panel'); await flushV265();
    answer('Set as primary'); await flushV265();
    expect(h.view.tutorState.selection).toEqual([]);
    expect(h.view.tutorState.mapSearch).toBe('');
    expect(h.panel().query('[data-kren-notice]')).toBeNull();
  } finally { h.view.dispose(); fallback.mockClear(); }
});
