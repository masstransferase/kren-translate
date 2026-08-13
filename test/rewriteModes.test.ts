import { describe, expect, it } from 'vitest';
import { rewriteSystemInstruction } from '../src/providers/gemini.js';
import {
  CUSTOM_REWRITE_MODE_LABEL,
  REWRITE_MODES,
  isRewriteModeId,
  rewriteModeById,
  rewriteModeLabel,
  rewriteModeOptions,
  rewriteModeSettingEntries,
  type RewriteModeAxes,
  type RewriteModeId
} from '../src/rewriteModes.js';
import type { RewriteRequest } from '../src/types.js';

// The presets the owner specified on 2026-08-13, in order. This pins the user-facing
// contract without duplicating every axis value: a second copy of the full table meant
// two places to edit for one change, and the copy is what goes stale.
//
// Axis values are verified by property instead, below: eight axes, never the two the
// modes deliberately leave alone, and no two modes sharing a combination.
const EXPECTED_MODE_LABELS = [
  'Plain English',
  'Manuscript',
  'Grant Proposal',
  'Instruction',
  'Technical document',
  'Legal document',
  'Regulatory document',
  'Professional email',
  'Casual email',
  'Professional presentation',
  'Research presentation',
  'Teaching presentation',
  'Investor presentation'
];

const baseRequest = {
  text: 'Only this selected text is submitted.',
  sourceLanguage: 'auto',
  targetLanguage: 'auto',
  kind: 'translation',
  operation: 'rewrite',
  englishVariety: 'american',
  rhetoricalMode: 'preserveOriginal',
  preserveFormatting: true,
  includeChangeNotes: false
} as const;

function axesWrittenByMode(id: RewriteModeId): RewriteModeAxes {
  return Object.fromEntries(
    rewriteModeSettingEntries(id).map(({ key, value }) => [key.replace('rewrite.', ''), value])
  ) as unknown as RewriteModeAxes;
}

describe('rewrite modes', () => {
  it('offers exactly the specified presets, in order', () => {
    expect(REWRITE_MODES.map((mode) => mode.label)).toEqual(EXPECTED_MODE_LABELS);
  });

  // matchingRewriteMode returns the first mode whose axes all match, so two modes with
  // identical axes would make the later one unreachable: selecting it would relabel
  // itself as the earlier one instantly. Nothing else would report that, and it is easy
  // to introduce when adding presets that differ only in intent.
  it('gives every mode a distinct axis combination', () => {
    const seen = new Map<string, string>();
    for (const mode of REWRITE_MODES) {
      const fingerprint = JSON.stringify(
        Object.entries(mode.axes).sort(([left], [right]) => left.localeCompare(right))
      );
      const clash = seen.get(fingerprint);
      expect(clash, `${mode.label} has the same axes as ${clash}`).toBeUndefined();
      seen.set(fingerprint, mode.label);
    }
  });

  it('derives the runtime guard and panel options from the mode array', () => {
    expect(rewriteModeOptions()).toEqual(REWRITE_MODES.map(({ id, label }) => [id, label]));
    for (const mode of REWRITE_MODES) expect(isRewriteModeId(mode.id)).toBe(true);
    expect(isRewriteModeId('custom')).toBe(false);
    expect(isRewriteModeId('upwardEmail')).toBe(false);
  });

  it.each(REWRITE_MODES)('writes $label as eight axes and no more', (mode) => {
    const entries = rewriteModeSettingEntries(mode.id);

    expect(axesWrittenByMode(mode.id)).toEqual(rewriteModeById(mode.id).axes);
    expect(entries).toHaveLength(8);
    // englishVariety is a dialect preference that should survive a preset, and
    // rhetoricalMode is what the writer is trying to do. No preset overwrites either.
    expect(entries.map(({ key }) => key)).not.toContain('rewrite.englishVariety');
    expect(entries.map(({ key }) => key)).not.toContain('rewrite.rhetoricalMode');
  });

  it.each(REWRITE_MODES)('recognises $label from axes set by hand', (mode) => {
    expect(rewriteModeLabel({ ...mode.axes })).toBe(mode.label);
  });

  it.each([
    ['CHANNEL', 'modality'],
    ['SUBJECT', 'domain'],
    ['REGISTER', 'voice'],
    ['SHAPE', 'length']
  ] as const)('reports Custom after a %s axis changes', (_group, axis) => {
    const manuscript = rewriteModeById('manuscript');
    // Pick any value the mode does not already use, so the change is real.
    const alternatives: Record<string, string> = {
      modality: 'spoken',
      domain: 'legal',
      voice: 'analytical',
      length: 'expand'
    };
    const changed = { ...manuscript.axes, [axis]: alternatives[axis] } as RewriteModeAxes;
    expect(rewriteModeLabel(changed)).toBe(CUSTOM_REWRITE_MODE_LABEL);
  });

  it.each(REWRITE_MODES)(
    'assembles identical rewrite instructions for $label set by mode or by hand',
    (mode) => {
      const modeRequest = { ...baseRequest, ...axesWrittenByMode(mode.id) } as RewriteRequest;
      const manualRequest = { ...baseRequest, ...mode.axes } as RewriteRequest;

      expect(rewriteSystemInstruction(modeRequest)).toBe(rewriteSystemInstruction(manualRequest));
    }
  );
});
