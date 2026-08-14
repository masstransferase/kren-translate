import { describe, expect, it } from 'vitest';
import {
  rewriteOutputViolation,
  rewriteSystemInstruction
} from '../src/providers/gemini.js';
import {
  REWRITE_FORMALITIES,
  rewriteAxisInstruction
} from '../src/rewriteAxes.js';
import { REWRITE_MODES } from '../src/rewriteModes.js';
import type { RewriteRequest } from '../src/types.js';

const legacyDefaultInstructionLines = [
  'Rewrite only the exact text supplied by the user.',
  'Detect the dominant natural language of the supplied text. Return its BCP-47 language code in detectedLanguage. Rewrite in that same language and never translate it.',
  'Preserve intentional mixed-language terms, names, quotations, code, and necessary domain terminology.',
  'Preserve its factual meaning, claims, qualifications, numbers, citations, and necessary domain terminology.',
  'Correct grammar and awkward phrasing, but do not add facts, evidence, promises, certainty, examples, or document context.',
  'Never intensify a claim beyond the evidence or qualifications present in the supplied text.',
  'Return JSON only. Every variant must be complete and usable on its own.',
  'Use general-purpose prose in the source language without imposing a specialized domain style.',
  'Only when detectedLanguage is English, use standard American English spelling, punctuation, vocabulary, idiom, and usage consistently.',
  'When detectedLanguage is not English, ignore the English-variety setting and use natural conventions for the detected language.',
  "Preserve the writer's recognizable voice, cadence, emphasis, and personality as far as the requested variant allows.",
  'Rhetorical mode: preserve the original communicative intent. Do not turn an observation into an explanation, persuasion, recommendation, or challenge.',
  'Preserve Markdown, LaTeX commands, citations, links, placeholders, code identifiers, filenames, inline code, and fenced code blocks exactly unless grammar inside ordinary prose requires a change.',
  'Produce exactly three meaning-preserving variants:',
  '1. Natural: fluent, native-level writing in the detected language that follows the configured tone and rhetorical mode while preserving the original level of detail.',
  '2. Concise: tighter and more direct writing in the detected language while retaining every important point.',
  '3. Jargon-Free: Write clear, natural, human-like prose in the detected language. Remove buzzwords, cliches, corporate jargon, and unnecessary specialist jargon. Keep precise domain terminology only when it is needed for correctness. Use no em dashes or en dashes. Use commas, parentheses, colons, semicolons, or separate sentences instead. Use no metaphors unless removing one would change the intended meaning.',
  'Do not include commentary or change notes.',
  'Return exactly this JSON shape and order:',
  '{"kind":"rewrite","detectedLanguage":"BCP-47 code","variants":[{"id":"natural","label":"Natural","text":"rewritten text"},{"id":"concise","label":"Concise","text":"rewritten text"},{"id":"jargonFree","label":"Jargon-Free","text":"rewritten text"}]}'
] as const;

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

  it('keeps the legacy set of instruction sentences on a fresh install', () => {
    expect(rewriteSystemInstruction(defaultRequest).split('\n').sort())
      .toEqual([...legacyDefaultInstructionLines].sort());
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
      'Produce exactly three meaning-preserving variants',
      'Do not include commentary or change notes',
      'Return exactly this JSON shape and order'
    ];
    const positions = markers.map((marker) => prompt.indexOf(marker));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it('suppresses formatting only for spoken modality and states the spoken rules', () => {
    const written = rewriteSystemInstruction(request({ modality: 'written' }));
    const spoken = rewriteSystemInstruction(request({ modality: 'spoken' }));

    expect(written).toContain('Preserve Markdown, LaTeX commands');
    expect(spoken).not.toContain('Preserve Markdown, LaTeX commands');
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
      'An em dash — is silent.',
      'An en dash – is silent.',
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
