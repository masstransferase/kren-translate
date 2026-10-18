import { readFileSync } from 'node:fs';
import { hostSource } from './support/hostSource.js';
import { describe, expect, it } from 'vitest';
import { isGrammarIssueId, PANEL_TEXT_MAX_LENGTH } from '../src/grammarIssueId.js';
import {
  repeatedSpaceIssues,
  smartGrammarCorrectionToIssues
} from '@kren/core/grammar';

// Three modules produce grammar finding identifiers and, until 2026-08-22, three modules
// recognised only their own format. The panel validator dropped Apply and Copy in silence
// whenever a Smart Grammar finding was selected. The editor's Quick Fix provider offered no
// actions at all on a Smart Grammar or spacing underline. Both are the same defect and both
// are now decided by this one predicate.
describe('grammar finding identifiers', () => {
  it('accepts every identifier core actually produces', () => {
    // Produced rather than written out, so a format change in core reaches this test
    // instead of a hand-copied literal that stays correct-looking and stops matching.
    const produced = [
      ...(smartGrammarCorrectionToIssues(
        'Their going to the libary.',
        "They're going to the library."
      ) ?? []),
      ...repeatedSpaceIssues('Two  spaces  here.')
    ];

    expect(produced.length).toBeGreaterThan(1);
    for (const issue of produced) {
      expect(isGrammarIssueId(issue.id), `core identifier rejected: ${issue.id}`).toBe(true);
    }
    // Both shapes must actually be represented, otherwise this passes on Harper-style ids
    // alone and covers neither of the two routes that were dead.
    expect(produced.some((issue) => issue.id.startsWith('smart-grammar-'))).toBe(true);
    expect(produced.some((issue) => issue.id.startsWith('spacing-'))).toBe(true);
    // The Harper worker's own format, which is the one every consumer already handled.
    expect(isGrammarIssueId('issue-1')).toBe(true);
    expect(isGrammarIssueId('issue-42')).toBe(true);
  });

  it('refuses anything that is not a bounded safe string', () => {
    for (const value of ['', '../etc/passwd', 'a'.repeat(65), '<script>', 'a b', undefined, 7]) {
      expect(isGrammarIssueId(value), `accepted ${String(value)}`).toBe(false);
    }
  });

  it('is the only rule any consumer applies', () => {
    // A second copy of the identifier scheme is exactly what produced the two dead routes.
    // Nothing may match the Harper format by hand again.
    expect(hostSource(), `host source matches one producer's format by hand`)
      .not.toMatch(/issue-\\\\d\+/u);
    for (const file of ['src/grammarCodeActions.ts', 'src/resultViewHtml.ts']) {
      expect(readFileSync(file, 'utf8'), `${file} matches one producer's format by hand`)
        .not.toMatch(/issue-\\\\d\+/u);
    }
    expect(readFileSync('src/grammarCodeActions.ts', 'utf8'))
      .toContain('isGrammarIssueId(identifier)');
  });

  it('caps panel text in one place, and the input the reader types into honours it', () => {
    // The validator rejected an oversized message while the textarea had no limit, so the
    // reader could type past it and watch Replace and Copy do nothing, with Copy still
    // reporting success on its own label.
    const panel = readFileSync('src/resultViewHtml.ts', 'utf8');
    expect(panel).toContain('maxlength="${PANEL_TEXT_MAX_LENGTH}"');
    expect(hostSource())
      .toContain('candidate.draftText.length <= PANEL_TEXT_MAX_LENGTH');
    expect(PANEL_TEXT_MAX_LENGTH).toBe(200_000);
  });
});
