import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// 2026-10-10: a loop that renders the whole panel once per gallery page blocks the event loop for
// seconds, and Vitest's worker then fails an unrelated file with "Timeout calling onTaskUpdate".
// Every such loop yields to the runner between iterations, as panelV203, reviewR4a and
// documentationLabels do. A loop over an inline list of a few values (`for (const x of [a, b])`)
// is cheap and exempt.
const testDir = 'test';
const RENDER = /renderKrenResultViewHtml\(/u;
const YIELD = /setImmediate|yieldToRunner/u;
const INLINE_LIST = /\bof\s*\[/u;
const offending = ({ header, body }: { header: string; body: string }) =>
  RENDER.test(body) && !YIELD.test(body) && !INLINE_LIST.test(header);

/** Each `for (...) {` block in the source: its line, the text in its parentheses, and its body. */
export function forLoopBodies(source: string): Array<{ line: number; header: string; body: string }> {
  const bodies: Array<{ line: number; header: string; body: string }> = [];
  for (const match of source.matchAll(/\bfor\s*(?:await\s*)?\(/gu)) {
    const open = match.index! + match[0].length; let i = open; let depth = 1;
    for (; i < source.length && depth > 0; i++) depth += source[i] === '(' ? 1 : source[i] === ')' ? -1 : 0;
    const header = source.slice(open, i - 1);
    while (i < source.length && /\s/u.test(source[i]!)) i++;
    if (source[i] !== '{') continue;
    const start = i; depth = 0;
    for (; i < source.length; i++) { if (source[i] === '{') depth++; else if (source[i] === '}' && --depth === 0) break; }
    bodies.push({ line: source.slice(0, match.index).split('\n').length, header, body: source.slice(start + 1, i) });
  }
  return bodies;
}

describe('heavy panel-rendering test loops yield to the runner', () => {
  it('every loop that renders the panel per gallery page awaits setImmediate inside the loop', () => {
    const offenders = readdirSync(testDir).filter((file) => file.endsWith('.test.ts') && file !== 'panelYieldGuard.test.ts').flatMap((file) =>
      forLoopBodies(readFileSync(path.join(testDir, file), 'utf8')).filter(offending).map(({ line }) => `${file}:${line}`));
    expect(offenders).toEqual([]);
  });

  it('flags a rendering loop without a yield and passes one with a yield or over an inline list', () => {
    const bad = 'for (const page of pages) {\n  const $ = load(renderKrenResultViewHtml(page.options));\n}';
    const good = 'for (const page of pages) {\n  await new Promise((r) => setImmediate(r));\n  load(renderKrenResultViewHtml(page.options));\n}';
    expect(forLoopBodies(bad).filter(offending)).toHaveLength(1);
    expect(forLoopBodies(good).filter(offending)).toHaveLength(0);
    expect(forLoopBodies(bad.replace('of pages', 'of [first, second]')).filter(offending)).toHaveLength(0);
  });
});
