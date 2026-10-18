import { it, vi } from 'vitest';
vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (_: string, value: unknown) => value }) },
  commands: { executeCommand: vi.fn() }, env: {}, window: {}, Uri: { joinPath: (...parts: unknown[]) => parts } }));
import { cases } from './support/tutorV258Cases.js';
for (const item of cases) it(item.name, item.run);
