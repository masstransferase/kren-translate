import { describe, expect, it } from 'vitest';
import { rewriteSystemInstruction } from '../src/providers/gemini.js';
import {
  REWRITE_MODES,
  rewriteModeSettingEntries,
  type RewriteModeAxes,
  type RewriteModeId
} from '@kren/core/rewrite-modes';
import type { RewriteRequest } from '../src/types.js';

const baseRequest = {
  text: 'Only this selected text is submitted.',
  sourceLanguage: 'auto',
  targetLanguage: 'auto',
  kind: 'translation',
  operation: 'rewrite',
  englishVariety: 'american',
  rhetoricalMode: 'preserve',
  preserveFormatting: true,
  includeChangeNotes: false
} as const;

function axesWrittenByMode(id: RewriteModeId): RewriteModeAxes {
  return Object.fromEntries(
    rewriteModeSettingEntries(id).map(({ key, value }) => [key.replace('rewrite.', ''), value])
  ) as unknown as RewriteModeAxes;
}

describe('rewrite modes', () => {
  it.each(REWRITE_MODES)(
    'assembles identical rewrite instructions for $label set by mode or by hand',
    (mode) => {
      const modeRequest = { ...baseRequest, ...axesWrittenByMode(mode.id) } as RewriteRequest;
      const manualRequest = { ...baseRequest, ...mode.axes } as RewriteRequest;

      expect(rewriteSystemInstruction(modeRequest)).toBe(rewriteSystemInstruction(manualRequest));
    }
  );
});
