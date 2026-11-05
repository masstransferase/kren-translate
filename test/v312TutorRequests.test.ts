import { it, vi } from 'vitest';
// The same stand-in tutorV258.test.ts uses: the request center's import chain reaches 'vscode'.
vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (_: string, value: unknown) => value, inspect: () => undefined, update: async () => {} }) },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  commands: { executeCommand: vi.fn() }, env: {}, window: {}, Uri: { joinPath: (...parts: unknown[]) => parts } }));
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { v312Cases } from './support/v312TutorRequests.js';

/*
 * Recorded before the move on 2026-10-25 (V312, F7 run 4). Expected values must remain unchanged.
 * A missing expected file is written once from the current tree and that run fails, so a deleted
 * file can never pass silently.
 */
const expectedPath = existsSync('test/support') ? 'test/support/v312Expected.json' : 'apps/vscode/test/support/v312Expected.json';
const capture = !existsSync(expectedPath);
const expected = capture ? undefined : JSON.parse(readFileSync(expectedPath, 'utf8'));
const captured: Record<string, unknown> = {};
it('records one expected value per case and no others', () => {
  assert.ok(!capture, `No expected file; captured ${expectedPath} from this tree. Review it and run again.`);
  assert.deepEqual(Object.keys(expected).sort(), v312Cases.map(c => c.name).sort());
});
for (const c of v312Cases) it(c.name, async () => {
  const value = await c.run();
  if (capture) {
    captured[c.name] = value;
    writeFileSync(expectedPath, JSON.stringify(captured, null, 2) + '\n');
  } else {
    assert.deepEqual(value, expected[c.name]);
  }
});
