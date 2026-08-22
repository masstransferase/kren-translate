import { describe, expect, it } from 'vitest';
import {
  rewriteOutputViolation,
  rewriteSystemInstruction
} from '../src/providers/gemini.js';
import {
  REWRITE_FORMALITIES,
  rewriteAxisInstruction
} from '@kren/core/rewrite-axes';
import { REWRITE_MODES } from '@kren/core/rewrite-modes';
import {
  REWRITE_OUTPUT_RULES,
  REWRITE_VARIANTS
} from '@kren/core/rewrite-variants';
import type { RewriteRequest } from '../src/types.js';

const defaultRequest = {
  text: 'Only this selected text.',
  sourceLanguage: 'auto',
  targetLanguage: 'auto',
  kind: 'translation',
  operation: 'rewrite',
  modality: 'written',
  function: 'general',
  englishVariety: 'american',
  domain: 'general',
  formality: 'preserve',
  voice: 'preserve',
  stance: 'preserve',
  length: 'preserve',
  perspective: 'preserve',
  rhetoricalMode: 'preserve',
  preserveFormatting: true,
  includeChangeNotes: false
} as RewriteRequest;

function request(overrides: Partial<RewriteRequest>): RewriteRequest {
  return { ...defaultRequest, ...overrides };
}

describe('rewrite prompt defaults', () => {
  it.each(REWRITE_MODES)(
    '$label emits at most the Formality axis instruction about formality',
    (mode) => {
      const promptLines = rewriteSystemInstruction(request(mode.axes)).split('\n');
      const formalityInstruction = rewriteAxisInstruction(
        REWRITE_FORMALITIES,
        mode.axes.formality
      );
      const formalityLines = promptLines.filter((line) =>
        line === formalityInstruction || /\bformality\b/iu.test(line)
      );

      expect(formalityLines).toHaveLength(formalityInstruction ? 1 : 0);
      if (formalityInstruction) {
        expect(formalityLines[0]).toBe(formalityInstruction);
      }
    }
  );

  it('attaches every style axis to Full Rewrite and none to Minimal Rewrite', () => {
    const styled = request({
      function: 'proposal',
      domain: 'scientific',
      englishVariety: 'british',
      formality: 'formal',
      voice: 'objective',
      stance: 'cautious',
      perspective: 'impersonal',
      rhetoricalMode: 'explain',
      modality: 'spoken',
      length: 'compress'
    });
    const prompt = rewriteSystemInstruction(styled);
    const minimalInstruction = REWRITE_VARIANTS[0].instruction;
    const fullInstruction = REWRITE_VARIANTS[1].instruction;
    const minimalStart = prompt.indexOf(minimalInstruction);
    const fullStart = prompt.indexOf(fullInstruction);
    const axisMarkers = [
      'suitable for a proposal',
      'precise scientific prose',
      'standard British English',
      'formal, precise wording',
      'objective voice',
      'appropriately qualified stance',
      'impersonal perspective',
      'Rhetorical mode: explain',
      'Write for spoken delivery',
      'shorter than the supplied text'
    ];
    const minimalSection = prompt.slice(minimalStart, fullStart);
    const fullSection = prompt.slice(fullStart);
    const minimalOnly = rewriteSystemInstruction({ ...styled, operation: 'rewriteMinimal' });
    const fullOnly = rewriteSystemInstruction({ ...styled, operation: 'rewriteFull' });

    expect({
      includesSharedInstructions: [
        prompt.includes(minimalInstruction),
        prompt.includes(fullInstruction)
      ],
      sharedOrder: minimalStart >= 0 && fullStart > minimalStart,
      axesAfterFull: axisMarkers.every((marker) => prompt.indexOf(marker) > fullStart),
      axesInMinimalSection: axisMarkers.filter((marker) => minimalSection.includes(marker)),
      axesInFullSection: axisMarkers.filter((marker) => fullSection.includes(marker)),
      axesInMinimalOnly: axisMarkers.filter((marker) => minimalOnly.includes(marker)),
      axesInFullOnly: axisMarkers.filter((marker) => fullOnly.includes(marker))
    }).toEqual({
      includesSharedInstructions: [true, true],
      sharedOrder: true,
      axesAfterFull: true,
      axesInMinimalSection: [],
      axesInFullSection: axisMarkers,
      axesInMinimalOnly: [],
      axesInFullOnly: axisMarkers
    });
  });

  it('states every shared output rule once for the whole request', () => {
    const prompt = rewriteSystemInstruction(defaultRequest);
    const ruleCounts = REWRITE_OUTPUT_RULES.map((rule) =>
      prompt.split(rule).length - 1
    );
    const sharedRuleMarker = 'The following output rules apply to every requested variant:';

    expect({
      ruleCounts,
      markerCount: prompt.split(sharedRuleMarker).length - 1,
      beforeVariants: prompt.indexOf(sharedRuleMarker) < prompt.indexOf('Produce exactly two')
    }).toEqual({
      ruleCounts: REWRITE_OUTPUT_RULES.map(() => 1),
      markerCount: 1,
      beforeVariants: true
    });
  });

  it('assembles axis instructions in the approved load-bearing order', () => {
    const prompt = rewriteSystemInstruction(request({
      function: 'proposal',
      domain: 'scientific',
      englishVariety: 'british',
      formality: 'formal',
      voice: 'objective',
      stance: 'cautious',
      perspective: 'impersonal',
      rhetoricalMode: 'explain',
      modality: 'spoken',
      length: 'compress'
    }));
    const markers = [
      'Produce exactly two variants',
      REWRITE_VARIANTS[0].instruction,
      REWRITE_VARIANTS[1].instruction,
      'suitable for a proposal',
      'precise scientific prose',
      'standard British English',
      'When detectedLanguage is not English',
      'formal, precise wording',
      'objective voice',
      'appropriately qualified stance',
      'impersonal perspective',
      'Rhetorical mode: explain',
      'Write for spoken delivery',
      'shorter than the supplied text',
      'Do not include commentary or change notes',
      'Return exactly this JSON shape and order'
    ];
    const positions = markers.map((marker) => prompt.indexOf(marker));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it('suppresses formatting only for spoken modality and states the spoken rules', () => {
    const written = rewriteSystemInstruction(request({
      operation: 'rewriteFull',
      modality: 'written'
    }));
    const spoken = rewriteSystemInstruction(request({
      operation: 'rewriteFull',
      modality: 'spoken'
    }));
    const minimal = rewriteSystemInstruction(request({
      operation: 'rewriteMinimal',
      modality: 'spoken'
    }));

    expect(written).toContain('Preserve Markdown, LaTeX commands');
    expect(spoken).not.toContain('Preserve Markdown, LaTeX commands');
    expect(minimal).toContain('Preserve Markdown, LaTeX commands');
    expect(spoken).toContain('Keep clauses near 20 words or fewer');
    expect(spoken).toContain('Use no parentheses, semicolons, em dashes, or en dashes');
    expect(spoken).toContain('shown above');
    expect(spoken).toContain('the former director');
  });

  it.each([
    ['A longer source sentence.', 'Short.'],
    ['The original has many characters.', 'Brief.'],
    ['Retain this important point clearly.', 'Keep the point.'],
    ['A fourth deliberately longer source.', 'Fourth source.'],
    ['The fifth source contains enough detail.', 'Fifth detail.'],
    ['A sixth source for the fixture.', 'Sixth.'],
    ['A seventh source for comparison.', 'Seventh.'],
    ['An eighth source with more wording.', 'Eighth.'],
    ['The ninth source remains straightforward.', 'Ninth.'],
    ['The tenth source completes the fixture.', 'Tenth.']
  ])('accepts compressed output shorter than source: %s', (source, output) => {
    expect(rewriteOutputViolation(output, request({ text: source, length: 'compress' }), 'en'))
      .toBeUndefined();
  });

  it.each([
    ['Short.', 'This is a longer version of the same short point.'],
    ['Clear.', 'This point is clear in the supplied wording.'],
    ['Third.', 'This is the longer third supplied point.'],
    ['Fourth.', 'This is the expanded wording of the fourth point.'],
    ['Fifth.', 'This is the expanded wording of the fifth point.'],
    ['Sixth.', 'This is the expanded wording of the sixth point.'],
    ['Seventh.', 'This is the expanded wording of the seventh point.'],
    ['Eighth.', 'This is the expanded wording of the eighth point.'],
    ['Ninth.', 'This is the expanded wording of the ninth point.'],
    ['Tenth.', 'This is the expanded wording of the tenth point.']
  ])('accepts expanded output longer than source: %s', (source, output) => {
    expect(rewriteOutputViolation(output, request({ text: source, length: 'expand' }), 'en'))
      .toBeUndefined();
  });

  it.each([
    ['I support the supplied conclusion.', 'The supplied conclusion is supported.'],
    ['We measured the result.', 'The result was measured.'],
    ['My review found the issue.', 'The review found the issue.'],
    ['Our analysis supports it.', 'The analysis supports it.'],
    ['I can confirm the number.', 'The number can be confirmed.'],
    ['We observed the change.', 'The change was observed.'],
    ['My reading is unchanged.', 'The reading is unchanged.'],
    ['Our report states the point.', 'The report states the point.'],
    ['I retained the qualification.', 'The qualification was retained.'],
    ['We reached the supplied result.', 'The supplied result was reached.']
  ])('enforces perspective across the ten-case fixture', (personal, impersonal) => {
    expect(rewriteOutputViolation(
      personal,
      request({ perspective: 'first person' }),
      'en'
    )).toBeUndefined();
    expect(rewriteOutputViolation(
      impersonal,
      request({ perspective: 'impersonal' }),
      'en'
    )).toBeUndefined();
    expect(rewriteOutputViolation(
      impersonal,
      request({ perspective: 'first person' }),
      'en'
    )).toBe('perspective');
    expect(rewriteOutputViolation(
      personal,
      request({ perspective: 'impersonal' }),
      'en'
    )).toBe('perspective');
  });

  it('rejects only the mechanically unambiguous spoken defects', () => {
    const spoken = request({ modality: 'spoken' });
    const defects = [
      'A parenthetical (aside).',
      'Two clauses; one sentence.',
      'An em dash \u2014 is silent.',
      'An en dash \u2013 is silent.',
      'The value is 15%.',
      'The value is 15&.'
    ];
    defects.push(...[
      'e.g.', 'i.e.', 'Fig.', 'vs.', 'etc.', 'et al.', 'cf.'
    ].map((value) => `Do not retain ${value} in speech.`));
    defects.push(...[
      'shown above', 'shown below', 'see above', 'see below', 'described above',
      'described below', 'listed above', 'listed below', 'the figure above',
      'the table below', 'as above', 'the latter'
    ].map((value) => `Do not say ${value} in speech.`));
    for (const text of defects) {
      expect(rewriteOutputViolation(text, spoken, 'en')).toBe('spoken modality');
    }
    expect(rewriteOutputViolation(
      'Concentrations below the detection limit rose above 40 degrees under the former director.',
      spoken,
      'en'
    )).toBeUndefined();
  });
});
