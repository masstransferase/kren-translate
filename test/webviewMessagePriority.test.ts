import { describe, expect, it } from 'vitest';
import { priorityWebviewCommand } from '../src/webviewMessagePriority.js';

describe('results webview priority messages', () => {
  it.each([
    'stopReadAloud',
    'pronunciationStarted',
    'pronunciationFailed',
    'generatedAudioEnded',
    'generatedAudioFailed'
  ] as const)('routes %s outside the serialized slow-operation queue', (command) => {
    expect(priorityWebviewCommand({ command })).toBe(command);
  });

  it('keeps state-changing and slow operations on the ordinary path', () => {
    expect(priorityWebviewCommand({ command: 'updateSetting' })).toBeUndefined();
    expect(priorityWebviewCommand({ command: 'refreshProModels' })).toBeUndefined();
    expect(priorityWebviewCommand(null)).toBeUndefined();
  });
});
