import { afterEach, expect, it, vi } from 'vitest';
const fallback = vi.hoisted(() => vi.fn(async (..._args: any[]) => undefined as string | undefined));
vi.mock('vscode', async () => {
  const { nativeDialogV267 } = await import('./support/v267NativeDialogs.js');
  fallback.mockImplementation(nativeDialogV267);
  return ({ commands: { executeCommand: async () => {} }, window: { showWarningMessage: fallback, showErrorMessage: fallback },
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_key: string, value: unknown) => value }) } });
});
import { checkV265HeldConfirmation, checkV265IndependentWait, checkV265RepeatedReset,
  confirmingCommandsV265, checkV265QueueGuard, checkV265LateQueueGuard, checkV265HandyStopOrdering } from './support/v265QueueChecks.js';
import { checkV265Quotes } from './support/v263Checks.js';

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it.each(confirmingCommandsV265)('V265 I45 posts %s immediately while the queue is held forever', async command => {
  await checkV265HeldConfirmation(command);
  // Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
  expect(fallback).toHaveBeenCalledOnce();
});
it.each(['previewTutorEdgeVoice', 'previewTutorGeminiVoice', 'previewTutorGeminiVoiceLive', 'retryTutorTurnCheck', 'stopTutorConversation', 'updateTutorConversationFrom'])
  ('V265 I45 %s does not hold the queue on an unresolved dependency', checkV265IndependentWait);
it('V265 I45 confirmations bypass the ordered Find choices', () => checkV265IndependentWait('findTutorTargets'));
it('V265 I45 repeated Reset explains its state and clears the session once', checkV265RepeatedReset);
it('V265 I45 orders Stop after Handy microphone stop while Reset confirmation stays immediate', checkV265HandyStopOrdering);
it('V265 I45 logs one command-only line per stalled message at both thresholds', async () => {
  vi.useFakeTimers();
  await checkV265QueueGuard(async milliseconds => { await vi.advanceTimersByTimeAsync(milliseconds); });
});
it('V265 I45 also logs elapsed waits when the extension host delays its timers', async () => {
  vi.useFakeTimers();
  await checkV265LateQueueGuard(milliseconds => { vi.setSystemTime(Date.now() + milliseconds); });
});
it.each(['standard', 'liveGemini'] as const)('V265 I46 owner quotes survive every rendering path in %s', checkV265Quotes);
