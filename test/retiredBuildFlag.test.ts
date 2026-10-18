import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

it('keeps the retired build flag out of product and build inputs', () => {
  // 2026-10-03: Split the retired symbol so the repository-wide grep stays empty.
  const symbol = '__KREN_' + 'DESIGN__';
  // 2026-10-04: The release workflow verifies a generated directory without a Git index.
  // Scan the actual inputs in both channels, including untracked additions, and require
  // product source plus both build inputs so an empty traversal cannot pass.
  const files: string[] = [];
  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(child);
      else files.push(child);
    }
  }
  walk('src');
  const sourceCount = files.length;
  if (existsSync('tools')) walk('tools');
  files.push('esbuild.mjs', 'package.json');
  expect(sourceCount, 'Product source was not scanned').toBeGreaterThan(0);
  const offenders = files.filter(file => readFileSync(file, 'utf8').includes(symbol));
  expect(offenders, 'Retired build flag reached a product or build input').toEqual([]);
  expect(files.slice(-2).every(file => existsSync(file)), 'Required build inputs are missing').toBe(true);
});
