import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function hostSource(): string {
  return readdirSync('src')
    .filter((name) => /^resultsView.*\.ts$/u.test(name))
    .sort()
    .map((name) => readFileSync(join('src', name), 'utf8'))
    .join('\n');
}
