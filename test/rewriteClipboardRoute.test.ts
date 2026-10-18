import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CLIPBOARD_REWRITE_OPERATIONS,
  rewriteClipboardText,
  shouldCopyRewriteToClipboard
} from '../src/rewriteClipboard.js';
import type { KrenResult } from '../src/types.js';

function rewrite(variants: Array<{ id: 'minimal' | 'full'; text: string }>): KrenResult {
  return { kind: 'rewrite', variants, sourceText: 'x' } as unknown as KrenResult;
}

/*
 * 1.7.0 shipped this route conditioned on `result.variants.length === 1`, which is what the
 * provider is supposed to return for a single-variant command. It reads as equivalent to "the
 * reader asked for one variant" and is not: it is a proxy, decided by the response rather than
 * by the request, and when it disagreed the route fell through to the panel with no error. The
 * owner ran Minimal Rewrite with the setting on and got the panel, twice.
 *
 * The decision is now keyed on the operation, which is fixed before the request is sent. These
 * tests exercise that decision directly rather than reading the source, so they fail on
 * behaviour rather than on wording.
 */
describe('which runs go to the clipboard', () => {
  it('copies the two rewrite commands the owner named, when the setting is on', () => {
    expect(shouldCopyRewriteToClipboard('rewriteMinimal', true)).toBe(true);
    expect(shouldCopyRewriteToClipboard('rewriteFull', true)).toBe(true);
  });

  it('never copies Both Variants, which returns two results to choose between', () => {
    expect(shouldCopyRewriteToClipboard('rewrite', true)).toBe(false);
    expect(CLIPBOARD_REWRITE_OPERATIONS).not.toContain('rewrite');
  });

  it('never copies a non-rewrite operation, whatever the setting says', () => {
    for (const operation of ['translate', 'explain', 'grammar', 'synonyms'] as const) {
      expect(shouldCopyRewriteToClipboard(operation, true), operation).toBe(false);
    }
  });

  it('uses the panel for everything while the setting is off', () => {
    for (const operation of ['rewriteMinimal', 'rewriteFull', 'rewrite'] as const) {
      expect(shouldCopyRewriteToClipboard(operation, false), operation).toBe(false);
    }
  });

  /*
   * The regression that produced this module. A provider returning both variants for a
   * single-variant command is exactly the case the old condition mishandled, and the decision
   * must not consult the response at all.
   */
  it('still copies when the provider returns more variants than were asked for', () => {
    expect(shouldCopyRewriteToClipboard('rewriteMinimal', true)).toBe(true);
    expect(rewriteClipboardText(
      rewrite([{ id: 'minimal', text: 'M' }, { id: 'full', text: 'F' }]),
      'rewriteFull'
    )).toBe('F');
  });
});

describe('which text is copied', () => {
  it('takes the variant the operation asked for, not the first in the list', () => {
    const both = rewrite([{ id: 'minimal', text: 'minimal text' }, { id: 'full', text: 'full text' }]);
    expect(rewriteClipboardText(both, 'rewriteMinimal')).toBe('minimal text');
    expect(rewriteClipboardText(both, 'rewriteFull')).toBe('full text');
  });

  it('takes the only variant when the provider returns exactly one', () => {
    expect(rewriteClipboardText(rewrite([{ id: 'full', text: 'only' }]), 'rewriteFull'))
      .toBe('only');
  });

  it('falls back to the first variant when the identifier is missing', () => {
    const odd = { kind: 'rewrite', variants: [{ text: 'unlabelled' }], sourceText: 'x' };
    expect(rewriteClipboardText(odd as unknown as KrenResult, 'rewriteMinimal'))
      .toBe('unlabelled');
  });

  it('returns nothing for an empty result, so the route is abandoned rather than silent', () => {
    expect(rewriteClipboardText(rewrite([]), 'rewriteMinimal')).toBeUndefined();
    expect(rewriteClipboardText(rewrite([{ id: 'minimal', text: '   ' }]), 'rewriteMinimal'))
      .toBeUndefined();
  });

  it('returns nothing for a result that is not a rewrite', () => {
    expect(rewriteClipboardText(
      { kind: 'translation', translatedText: 't' } as unknown as KrenResult,
      'rewriteMinimal'
    )).toBeUndefined();
  });
});

describe('every entry point that runs a rewrite takes the same route', () => {
  const source = readFileSync('src/extension.ts', 'utf8');

  /*
   * The defect this exists to prevent, and it survived four fixes. A rewrite reaches KREN by
   * two independent paths: executeLookup, for the Command Palette and an editor selection, and
   * executeClipboardLookup, for the status bar Quick Pick. Only the first was ever changed, so
   * the owner, who uses the Quick Pick, saw no difference across 1.7.0, 1.7.1, 1.7.3 and 1.7.4
   * while every test passed.
   *
   * Counting the call sites is the check. A third entry point added later fails this test
   * rather than silently omitting the route, which is exactly how the second one behaved.
   */
  it('routes from both entry points, not only the editor one', () => {
    // One call site per entry point. The import carries no parenthesis and is not counted.
    const decisions = source.split('shouldCopyRewriteToClipboard(').length - 1;
    expect(decisions, 'a rewrite entry point is missing the clipboard route').toBe(2);
  });

  it('reaches the decision before showResult in both paths', () => {
    for (const reveal of [
      'resultsView.showResult(result, snapshot.selectedText, true, operation)',
      // 2026-10-05: clipboard publication records the operation for gear regeneration.
      'resultsView.showResult(result, rawText, false, selectedOperation)'
    ]) {
      const at = source.indexOf(reveal);
      expect(at, reveal).toBeGreaterThan(-1);
      const before = source.slice(0, at);
      const lastDecision = before.lastIndexOf('shouldCopyRewriteToClipboard(');
      expect(lastDecision, `no clipboard decision precedes ${reveal}`).toBeGreaterThan(-1);
      // And the decision must belong to this path, not the previous one, so a return sits between.
      expect(before.slice(lastDecision)).toContain('return;');
    }
  });

  it('logs the decision from both paths, so either can be diagnosed', () => {
    expect(source.split('describeClipboardDecision(').length - 1).toBe(2);
  });
});

describe('the clipboard route updates the panel without surfacing it', () => {
  /*
   * Comments are stripped before these checks. The first version of this test failed against
   * correct code, because the comment explaining "setResult and not showResult" contains the
   * word it was asserting the absence of. A structural assertion must read code only.
   */
  const source = readFileSync('src/extension.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/u, ''))
    .join('\n');

  /*
   * The distinction the owner asked for on 2026-08-27: "silently update". setResult renders,
   * so the panel holds the current result and cannot show a stale one. showResult also calls
   * reveal, which takes focus and is what pulled them out of Claude Code. Leaving the panel
   * untouched was the earlier behaviour and it produced a stale result that looked like a
   * failure, which cost an evening to diagnose.
   */
  /*
   * Read the branch itself, from the decision to the return that ends it, and assert against
   * that text only. An earlier version searched the whole file for the setResult call, and
   * deleting the one inside the branch still passed, because the identical call on the normal
   * path below it was found instead. A structural assertion has to be bounded by the structure
   * it is about.
   */
  function clipboardBranches(): string[] {
    const branches: string[] = [];
    let from = 0;
    for (;;) {
      const decision = source.indexOf('if (shouldCopyRewriteToClipboard(', from);
      if (decision === -1) break;
      const end = source.indexOf('return;', decision);
      expect(end, 'a clipboard branch has no return').toBeGreaterThan(decision);
      branches.push(source.slice(decision, end + 'return;'.length));
      from = end;
    }
    return branches;
  }

  it('finds one clipboard branch per entry point', () => {
    expect(clipboardBranches()).toHaveLength(2);
  });

  it('updates the panel and never reveals it, inside every branch', () => {
    for (const branch of clipboardBranches()) {
      expect(branch).toContain('copyTextResult(clipboardText)');
      expect(branch, 'the branch stopped updating the panel, so a stale result can show')
        .toContain('resultsView.setResult(');
      expect(branch, 'the branch reveals the panel, which takes focus')
        .not.toContain('showResult');
      expect(branch).toContain('return;');
    }
  });

  it('falls through to the panel when there is nothing to copy', () => {
    const branch = source.slice(source.indexOf('if (shouldCopyRewriteToClipboard('));
    // The return is inside the `if (clipboardText)` guard, never beside it.
    expect(branch.slice(0, 800)).toContain('if (clipboardText) {');
  });

  it('reports progress and completion in the status bar, never in a notification', () => {
    const branch = source.slice(source.indexOf('if (shouldCopyRewriteToClipboard('));
    expect(branch.slice(0, 900)).toContain('setStatusBarMessage');
    expect(branch.slice(0, 900)).not.toContain("notify('information'");
  });
});
