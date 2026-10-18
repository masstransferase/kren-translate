import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * 2026-10-10: Google AI Studio notice "Update thinking_budget and sampling parameters". Upcoming
 * Gemini models return 400 INVALID_ARGUMENT for thinking_budget, temperature, top_p and top_k;
 * KREN uses thinkingLevel and sends no sampling parameters. This keeps them from coming back.
 */
const deprecated = /\b(?:temperature|topP|topK|top_p|top_k|thinkingBudget|thinking_budget)\s*:/u;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('Gemini requests send no deprecated generation parameters', () => {
  it('no source file sets temperature, top_p, top_k or thinking_budget', () => {
    for (const file of sourceFiles('src')) {
      const code = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(?:\/\/|\*)/u.test(line))
        .join('\n');
      expect(code, file).not.toMatch(deprecated);
    }
  });
});
