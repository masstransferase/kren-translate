export type PriorityWebviewCommand =
  | 'stopReadAloud'
  | 'pronunciationStarted'
  | 'pronunciationFailed'
  | 'generatedAudioEnded'
  | 'generatedAudioFailed';

const PRIORITY_COMMANDS = new Set<PriorityWebviewCommand>([
  'stopReadAloud',
  'pronunciationStarted',
  'pronunciationFailed',
  'generatedAudioEnded',
  'generatedAudioFailed'
]);

export function priorityWebviewCommand(value: unknown): PriorityWebviewCommand | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const command = (value as { command?: unknown }).command;
  return typeof command === 'string' && PRIORITY_COMMANDS.has(command as PriorityWebviewCommand)
    ? command as PriorityWebviewCommand
    : undefined;
}
