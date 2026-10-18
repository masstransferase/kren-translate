import { stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { win32 } from 'node:path';

export interface HandyDetectionOptions {
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  isFile?: (candidate: string) => Promise<boolean>;
}

async function isRegularFile(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

/** Finds an existing Windows Handy executable without starting it or reading its settings. */
export async function findHandyExecutable(
  options: HandyDetectionOptions = {}
): Promise<string | undefined> {
  if ((options.platform ?? process.platform) !== 'win32') return undefined;
  const environment = options.environment ?? process.env;
  const isFile = options.isFile ?? isRegularFile;
  const candidates: string[] = [];
  const pathValue = environment.PATH ?? environment.Path;
  for (const rawDirectory of pathValue?.split(';') ?? []) {
    const directory = rawDirectory.trim().replace(/^"|"$/gu, '');
    if (directory) candidates.push(win32.join(directory, 'handy.exe'));
  }
  if (environment.LOCALAPPDATA) {
    candidates.push(win32.join(environment.LOCALAPPDATA, 'Handy', 'handy.exe'));
  }
  for (const candidate of [...new Set(candidates)]) {
    if (await isFile(candidate)) return candidate;
  }
  return undefined;
}

interface HandyChildProcess {
  once(event: 'spawn', listener: () => void): HandyChildProcess;
  once(event: 'error', listener: (error: Error) => void): HandyChildProcess;
  unref(): void;
}

type HandySpawn = (
  executable: string,
  args: string[],
  options: { detached: true; stdio: 'ignore'; windowsHide: true }
) => HandyChildProcess;

/** Sends only Handy's control flag. KREN never creates or passes an audio payload. */
export function toggleHandyTranscription(
  executable: string,
  spawnProcess: HandySpawn = (command, args, options) => spawn(command, args, options)
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(
      executable,
      ['--toggle-transcription'],
      { detached: true, stdio: 'ignore', windowsHide: true }
    );
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
export interface HandyIntegration {
  detect(): Promise<string | undefined>;
  toggle(executable: string): Promise<void>;
}

const DEFAULT_HANDY_INTEGRATION: HandyIntegration = {
  detect: () => findHandyExecutable(),
  toggle: (executable) => toggleHandyTranscription(executable)
};


export { DEFAULT_HANDY_INTEGRATION };
