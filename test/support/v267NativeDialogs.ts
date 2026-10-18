import assert from 'node:assert/strict';
import type { MessageOptions } from 'vscode';

export interface NativeDialogV267 {
  kind: 'warning' | 'error';
  message: string;
  options: MessageOptions;
  choices: string[];
  answer(choice?: string): void;
}
let dialogs: NativeDialogV267[] = [];
export function resetNativeDialogsV267(): NativeDialogV267[] { dialogs = []; return dialogs; }
export function nativeDialogV267(message: string, options: MessageOptions, ...choices: string[]): Promise<string | undefined> {
  return createDialog('warning', message, options, choices);
}
export function nativeErrorDialogV267(message: string, options: MessageOptions, ...choices: string[]): Promise<string | undefined> {
  return createDialog('error', message, options, choices);
}
function createDialog(kind: 'warning' | 'error', message: string, options: MessageOptions, choices: string[]): Promise<string | undefined> {
  return new Promise(resolve => { dialogs.push({ kind, message, options, choices, answer: resolve }); });
}
export function questionV267(h: { dialogs: NativeDialogV267[]; messages: { command: string }[];
  panel(): { query(selector: string): unknown } }, index = h.dialogs.length - 1): NativeDialogV267 {
  const dialog = h.dialogs[index];
  assert.ok(dialog, 'The reader must receive VS Code\'s dialog immediately');
  assert.equal(h.messages.some(message => message.command === 'panelNotice'), false,
    'A question must not post a panelNotice');
  assert.equal(h.panel().query('[data-kren-notice]'), null, 'No question veil may cover the panel');
  return dialog;
}
