import { describe, expect, it } from 'vitest';
import { explicitTextSubmission } from '../src/submission.js';

describe('editor and clipboard submission boundary', () => {
  it.each(['editor selection', 'clipboard snapshot'])('keeps exact %s text as the only field', () => {
    const exact = '  selected text\nwith formatting  ';
    const input = explicitTextSubmission(exact);
    expect(input).toEqual({ text: exact });
    expect(Object.keys(input)).toEqual(['text']);
    expect(input).not.toHaveProperty('filename');
    expect(input).not.toHaveProperty('workspace');
    expect(input).not.toHaveProperty('surroundingText');
    expect(input).not.toHaveProperty('clipboardHistory');
  });
});
