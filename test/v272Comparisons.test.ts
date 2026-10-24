import { it, vi } from 'vitest';
// The same stand-in tutorV258.test.ts uses: the request center's import chain reaches 'vscode'.
vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (_: string, value: unknown) => value }) },
  commands: { executeCommand: vi.fn() }, env: {}, window: {}, Uri: { joinPath: (...parts: unknown[]) => parts } }));
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { v272Cases } from './support/v272Cases.js';

const capturePath = process.env.KREN_V272_CAPTURE;
const expectedPath = existsSync('test/support/v272Expected.json') ? 'test/support/v272Expected.json' : 'apps/vscode/test/support/v272Expected.json';
const expected = capturePath ? undefined : JSON.parse(readFileSync(expectedPath, 'utf8'));
const captured: Record<string, unknown> = {};
for (const c of v272Cases) it(c.name, async () => {
  const trace = await c.run();
  if (capturePath) {
    captured[c.name] = trace;
    writeFileSync(capturePath, JSON.stringify(captured, null, 2) + '\n');
  } else {
    assert.deepEqual(trace, expected[c.name]);
  }
});
