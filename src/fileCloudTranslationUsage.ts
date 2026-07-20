import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  GOOGLE_CLOUD_FREE_TIER_CHARACTERS,
  googleBillingMonth,
  type CloudTranslationUsageState
} from './cloudTranslationUsage.js';
import { ProviderError } from './errors.js';

export class FileCloudTranslationUsage {
  private pending: Promise<void> = Promise.resolve();

  public constructor(
    private readonly filePath: string,
    private readonly limit = GOOGLE_CLOUD_FREE_TIER_CHARACTERS,
    private readonly now: () => Date = () => new Date()
  ) {}

  public async initialize(legacy?: CloudTranslationUsageState): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      const state = validState(legacy, this.now())
        ? legacy
        : { month: googleBillingMonth(this.now()), characters: 0 };
      await this.write(state);
    }
  }

  public async get(): Promise<CloudTranslationUsageState> {
    return this.withLock(async () => this.read());
  }

  public reserve(characters: number): Promise<CloudTranslationUsageState> {
    if (!Number.isSafeInteger(characters) || characters < 0) {
      return Promise.reject(new Error('Invalid Cloud Translation character count.'));
    }

    let result!: CloudTranslationUsageState;
    const operation = this.pending.then(async () => {
      result = await this.withLock(async () => {
        const usage = await this.read();
        const next = usage.characters + characters;
        if (next > this.limit) {
          const remaining = Math.max(0, this.limit - usage.characters);
          throw new ProviderError(
            `Google Cloud Translation was not called because only ${remaining.toLocaleString()} of the shared locally tracked ${this.limit.toLocaleString()} monthly characters remain.`
          );
        }
        const updated = { month: usage.month, characters: next };
        await this.write(updated);
        return updated;
      });
    });
    this.pending = operation.catch(() => undefined);
    return operation.then(() => result);
  }

  private async read(): Promise<CloudTranslationUsageState> {
    const month = googleBillingMonth(this.now());
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      if (validState(parsed, this.now())) return parsed;
    } catch (error) {
      if (!isMissingFile(error) && !(error instanceof SyntaxError)) throw error;
    }
    return { month, characters: 0 };
  }

  private async write(state: CloudTranslationUsageState): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.filePath);
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockPath = `${this.filePath}.lock`;
    const deadline = Date.now() + 5000;
    let handle;
    while (!handle) {
      try {
        handle = await open(lockPath, 'wx', 0o600);
      } catch (error) {
        if (!isAlreadyExists(error) || Date.now() >= deadline) {
          throw new Error('Could not acquire the shared Google Cloud usage ledger lock.');
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    try {
      return await operation();
    } finally {
      await handle.close();
      await rm(lockPath, { force: true });
    }
  }
}

function validState(
  value: unknown,
  now: Date
): value is CloudTranslationUsageState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Partial<CloudTranslationUsageState>;
  return state.month === googleBillingMonth(now) &&
    Number.isSafeInteger(state.characters) &&
    (state.characters ?? -1) >= 0;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
