import { it, vi } from 'vitest';
vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn() }, window: {}, env: {},
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));
import { checkV263Instruction, checkV263Highlights, checkV263Spoken, checkV263Missing,
  checkV263Microphone, checkV263PreferencesAndOpenings } from './support/v263Checks.js';

it('V263 I40 shares paragraph rules and retains shared rules', checkV263Instruction);
// Changed 2026-10-18: V265, owner item I46, quoted phrases need not equal structured fields.
it('V263 I41 highlights quoted phrases and escapes model text', checkV263Highlights);
it('V265 I46 keeps unquoted structured expressions out of the paragraph without a mismatch log', checkV263Missing);
it.each(['standard', 'liveGemini'] as const)('V263 I42 restores punctuation for a coach echo in %s, with paragraph highlights and replay', checkV263Spoken);
for (const replies of ['standard', 'liveGemini'] as const) {
  it.each(['anything', 'situation', 'lesson', 'speakAndRephrase'] as const)(`V263 I43 has one reachable microphone with state and two-press behavior in ${replies}, %s`, from => checkV263Microphone(from, replies));
}
it('V263 migrates button Send and checks every local coaching invitation', checkV263PreferencesAndOpenings);
