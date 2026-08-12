import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
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
    private readonly now: () => Date = () => new Date(),
    private readonly staleLockAgeMs = 30_000
  ) {}

  public async initialize(legacy?: CloudTranslationUsageState): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      this.parseLedger(await readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (!isMissingFile(error)) {
        if (error instanceof ProviderError) throw error;
        throw this.corruptLedgerError();
      }
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
      const parsed = this.parseLedger(await readFile(this.filePath, 'utf8'));
      if (parsed.month === month) return parsed;
      if (parsed.month < month) return { month, characters: 0 };
      throw this.corruptLedgerError('contains a future billing month');
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (isMissingFile(error)) {
        throw this.corruptLedgerError('is missing after initialization');
      }
      throw this.corruptLedgerError();
    }
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
    const owner: LockOwner = {
      token: randomUUID(),
      processId: process.pid,
      createdAt: Date.now()
    };
    let handle;
    while (!handle) {
      try {
        handle = await open(lockPath, 'wx', 0o600);
        try {
          await handle.writeFile(`${JSON.stringify(owner)}\n`, 'utf8');
          await handle.sync();
        } catch (error) {
          await handle.close().catch(() => undefined);
          await rm(lockPath, { force: true }).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
        if (await this.breakStaleLock(lockPath)) continue;
        if (Date.now() >= deadline) {
          throw new ProviderError(
            `Could not acquire the shared Google Cloud usage ledger lock: ${lockPath}. Close other VS Code windows using KREN, or remove this lock only after confirming no KREN extension host is running.`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    try {
      return await operation();
    } finally {
      await handle.close();
      await this.releaseOwnedLock(lockPath, owner.token);
    }
  }

  private parseLedger(content: string): CloudTranslationUsageState {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch {
      throw this.corruptLedgerError('contains invalid JSON');
    }
    if (!validLedgerShape(parsed)) {
      throw this.corruptLedgerError('contains invalid usage data');
    }
    return parsed;
  }

  private corruptLedgerError(detail = 'is unreadable or corrupt'): ProviderError {
    return new ProviderError(
      `KREN blocked Google Cloud Translation because its local usage ledger ${detail}: ${this.filePath}. Check usage in Google Cloud before repairing or deleting this file.`
    );
  }

  private async breakStaleLock(lockPath: string): Promise<boolean> {
    let lockAge: number;
    try {
      lockAge = Date.now() - (await stat(lockPath)).mtimeMs;
    } catch (error) {
      return isMissingFile(error);
    }

    let owner: LockOwner | undefined;
    try {
      owner = parseLockOwner(await readFile(lockPath, 'utf8'));
    } catch (error) {
      if (isMissingFile(error)) return true;
    }

    if (owner && isProcessAlive(owner.processId)) return false;
    if (!owner && lockAge < this.staleLockAgeMs) return false;

    const stalePath = `${lockPath}.${randomUUID()}.stale`;
    try {
      await rename(lockPath, stalePath);
    } catch (error) {
      if (isMissingFile(error)) return true;
      return false;
    }
    await rm(stalePath, { force: true });
    return true;
  }

  private async releaseOwnedLock(lockPath: string, token: string): Promise<void> {
    try {
      const owner = parseLockOwner(await readFile(lockPath, 'utf8'));
      if (owner?.token === token) await rm(lockPath, { force: true });
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }
}

interface LockOwner {
  token: string;
  processId: number;
  createdAt: number;
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

function validLedgerShape(value: unknown): value is CloudTranslationUsageState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Partial<CloudTranslationUsageState>;
  return typeof state.month === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(state.month) &&
    Number.isSafeInteger(state.characters) && (state.characters ?? -1) >= 0;
}

function parseLockOwner(content: string): LockOwner | undefined {
  try {
    const value = JSON.parse(content) as Partial<LockOwner>;
    if (typeof value.token !== 'string' || !value.token ||
        !Number.isSafeInteger(value.processId) || (value.processId ?? 0) <= 0 ||
        !Number.isFinite(value.createdAt) || (value.createdAt ?? 0) <= 0) {
      return undefined;
    }
    return value as LockOwner;
  } catch {
    return undefined;
  }
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
