import { it, vi } from 'vitest';
// The same stand-in tutorV258.test.ts uses: the request center's import chain reaches 'vscode'.
vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (_: string, value: unknown) => value }) },
  commands: { executeCommand: vi.fn() }, env: {}, window: {}, Uri: { joinPath: (...parts: unknown[]) => parts } }));
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { decisionCases, decisionTrace } from './support/v270Decisions.js';
import { cases as tutorCases } from './support/tutorV258Cases.js';

// Recorded before extraction on 2026-10-19. Expected traces must remain unchanged.
const expectedPath = existsSync('test/support/v270Expected.json') ? 'test/support/v270Expected.json' : 'apps/vscode/test/support/v270Expected.json';
const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
for (const c of decisionCases) it(c.name, async () => assert.deepEqual(await decisionTrace(c.policy, c.scenario, c.provider, c.host), expected[c.name]));
for (const c of tutorCases) it(`V258: ${c.name}`, c.run);
