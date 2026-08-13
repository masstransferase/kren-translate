import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { UserDictionaryStoreV1 } from './contract.js';
import { exportUserDictionaryJson, importUserDictionaryJson } from './importExport.js';
import { emptyUserDictionaryStore } from './validation.js';

export const USER_DICTIONARY_STORAGE_ERROR_CODES = [
  'corruptStore',
  'lockTimeout',
  'storageFailure'
] as const;

export type UserDictionaryStorageErrorCode =
  typeof USER_DICTIONARY_STORAGE_ERROR_CODES[number];

export class UserDictionaryStorageError extends Error {
  public constructor(
    public readonly code: UserDictionaryStorageErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'UserDictionaryStorageError';
  }
}

export interface UserDictionaryStorageOptions {
  staleLockAgeMs?: number;
  lockWaitMs?: number;
  lockRetryMs?: number;
  commitTemporaryFile?: (temporaryPath: string, destinationPath: string) => Promise<void>;
}

interface LockOwner {
  token: string;
  processId: number;
  createdAt: number;
}

export class UserDictionaryStorage {
  public readonly filePath: string;
  public readonly lockPath: string;
  private pending: Promise<void> = Promise.resolve();
  private readonly staleLockAgeMs: number;
  private readonly lockWaitMs: number;
  private readonly lockRetryMs: number;
  private readonly commitTemporaryFile: (
    temporaryPath: string,
    destinationPath: string
  ) => Promise<void>;

  public constructor(
    public readonly directory: string,
    options: UserDictionaryStorageOptions = {}
  ) {
    this.filePath = path.join(directory, 'entries.json');
    this.lockPath = `${this.filePath}.lock`;
    this.staleLockAgeMs = options.staleLockAgeMs ?? 30_000;
    this.lockWaitMs = options.lockWaitMs ?? 5_000;
    this.lockRetryMs = options.lockRetryMs ?? 50;
    this.commitTemporaryFile = options.commitTemporaryFile ?? rename;
  }

  public initialize(): Promise<UserDictionaryStoreV1> {
    return this.enqueue(() => this.withLock(async () => {
      await mkdir(this.directory, { recursive: true });
      try {
        return await this.readExisting();
      } catch (error) {
        if (!isMissingFile(error)) throw error;
        const empty = emptyUserDictionaryStore();
        await this.atomicWrite(empty);
        return empty;
      }
    }));
  }

  public read(): Promise<UserDictionaryStoreV1> {
    return this.enqueue(() => this.withLock(() => this.readRequired()));
  }

  public replace(store: UserDictionaryStoreV1): Promise<UserDictionaryStoreV1> {
    return this.enqueue(() => this.withLock(async () => {
      const canonical = importUserDictionaryJson(exportUserDictionaryJson(store));
      await this.atomicWrite(canonical);
      return canonical;
    }));
  }

  public update(
    operation: (
      store: UserDictionaryStoreV1
    ) => UserDictionaryStoreV1 | Promise<UserDictionaryStoreV1>
  ): Promise<UserDictionaryStoreV1> {
    return this.enqueue(() => this.withLock(async () => {
      const current = await this.readRequired();
      const next = await operation(current);
      const canonical = importUserDictionaryJson(exportUserDictionaryJson(next));
      await this.atomicWrite(canonical);
      return canonical;
    }));
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    let result!: T;
    const queued = this.pending.then(async () => {
      result = await operation();
    });
    this.pending = queued.catch(() => undefined);
    return queued.then(() => result);
  }

  private async readExisting(): Promise<UserDictionaryStoreV1> {
    let content: string;
    try {
      content = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isMissingFile(error)) throw error;
      throw this.corruptStoreError('is unreadable', error);
    }
    try {
      return importUserDictionaryJson(content);
    } catch (error) {
      throw this.corruptStoreError('contains invalid JSON or schema data', error);
    }
  }

  private async readRequired(): Promise<UserDictionaryStoreV1> {
    try {
      return await this.readExisting();
    } catch (error) {
      if (isMissingFile(error)) {
        throw this.corruptStoreError('is missing after initialization', error);
      }
      throw error;
    }
  }

  private async atomicWrite(store: UserDictionaryStoreV1): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(exportUserDictionaryJson(store), 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.commitTemporaryFile(temporaryPath, this.filePath);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      if (error instanceof UserDictionaryStorageError) throw error;
      throw new UserDictionaryStorageError(
        'storageFailure',
        `User Dictionary could not atomically replace its local store: ${this.filePath}. Existing data was preserved.`,
        { cause: error }
      );
    }
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true });
    const deadline = Date.now() + this.lockWaitMs;
    const owner: LockOwner = {
      token: randomUUID(),
      processId: process.pid,
      createdAt: Date.now()
    };
    let handle;
    while (!handle) {
      try {
        handle = await open(this.lockPath, 'wx', 0o600);
        try {
          await handle.writeFile(`${JSON.stringify(owner)}\n`, 'utf8');
          await handle.sync();
        } catch (error) {
          await handle.close().catch(() => undefined);
          await rm(this.lockPath, { force: true }).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
        if (await this.breakStaleLock()) continue;
        if (Date.now() >= deadline) {
          throw new UserDictionaryStorageError(
            'lockTimeout',
            `Could not acquire the User Dictionary lock: ${this.lockPath}. Close other KREN extension hosts, or remove this lock only after confirming none is using the dictionary.`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, this.lockRetryMs));
      }
    }
    try {
      return await operation();
    } finally {
      await handle.close();
      await this.releaseOwnedLock(owner.token);
    }
  }

  private async breakStaleLock(): Promise<boolean> {
    let lockAge: number;
    try {
      lockAge = Date.now() - (await stat(this.lockPath)).mtimeMs;
    } catch (error) {
      return isMissingFile(error);
    }

    let owner: LockOwner | undefined;
    try {
      owner = parseLockOwner(await readFile(this.lockPath, 'utf8'));
    } catch (error) {
      if (isMissingFile(error)) return true;
    }
    if (owner && isProcessAlive(owner.processId)) return false;
    if (!owner && lockAge < this.staleLockAgeMs) return false;

    const stalePath = `${this.lockPath}.${randomUUID()}.stale`;
    try {
      await rename(this.lockPath, stalePath);
    } catch (error) {
      if (isMissingFile(error)) return true;
      return false;
    }
    await rm(stalePath, { force: true });
    return true;
  }

  private async releaseOwnedLock(token: string): Promise<void> {
    try {
      const owner = parseLockOwner(await readFile(this.lockPath, 'utf8'));
      if (owner?.token === token) await rm(this.lockPath, { force: true });
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }

  private corruptStoreError(detail: string, cause?: unknown): UserDictionaryStorageError {
    return new UserDictionaryStorageError(
      'corruptStore',
      `KREN blocked User Dictionary access because its local store ${detail}: ${this.filePath}. The original file was preserved; recover it or import a known-good JSON export.`,
      { cause }
    );
  }
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
