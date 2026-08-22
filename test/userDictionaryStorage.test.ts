import { existsSync } from 'node:fs';
import { rename, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { exportUserDictionaryJson } from '@kren/core/user-dictionary';
import {
  UserDictionaryStorage,
  UserDictionaryStorageError
} from '../src/userDictionary/storage.js';
import { userDictionaryEntry } from './userDictionaryFixtures.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

async function temporaryStorageDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'kren-user-dictionary-'));
  directories.push(directory);
  return directory;
}

describe('User Dictionary atomic local storage', () => {
  it('uses only the caller-supplied temporary directory', async () => {
    const directory = await temporaryStorageDirectory();
    const committedPaths: string[] = [];
    const storage = new UserDictionaryStorage(directory, {
      commitTemporaryFile: async (temporaryPath, destinationPath) => {
        committedPaths.push(temporaryPath, destinationPath);
        await rename(temporaryPath, destinationPath);
      }
    });
    await storage.initialize();
    await storage.replace({ schemaVersion: 1, entries: [userDictionaryEntry()] });
    expect(storage.filePath).toBe(path.join(directory, 'entries.json'));
    expect(storage.lockPath).toBe(path.join(directory, 'entries.json.lock'));
    expect(committedPaths.every((file) => path.dirname(file) === directory)).toBe(true);
  });

  it('leaves the previous good file intact when committing a new write fails', async () => {
    const directory = await temporaryStorageDirectory();
    const initial = new UserDictionaryStorage(directory);
    await initial.initialize();
    const previous = { schemaVersion: 1 as const, entries: [userDictionaryEntry()] };
    await initial.replace(previous);
    const previousBytes = await readFile(initial.filePath, 'utf8');

    const failed = new UserDictionaryStorage(directory, {
      commitTemporaryFile: async () => {
        throw new Error('simulated commit interruption');
      }
    });
    await expect(failed.replace({
      schemaVersion: 1,
      entries: [userDictionaryEntry({ id: 'new-entry', term: 'new', normalizedTerm: 'new' })]
    })).rejects.toMatchObject({ code: 'storageFailure' });
    await expect(readFile(initial.filePath, 'utf8')).resolves.toBe(previousBytes);
    await expect(initial.read()).resolves.toEqual(previous);
  });

  it('fails closed and preserves a corrupt store instead of returning empty', async () => {
    const directory = await temporaryStorageDirectory();
    const storage = new UserDictionaryStorage(directory);
    const corruptBytes = '{not-json';
    await writeFile(storage.filePath, corruptBytes, 'utf8');

    await expect(storage.initialize()).rejects.toMatchObject({
      code: 'corruptStore'
    });
    await expect(readFile(storage.filePath, 'utf8')).resolves.toBe(corruptBytes);
    await expect(storage.read()).rejects.toBeInstanceOf(UserDictionaryStorageError);
  });

  it('preserves a schema-invalid store and reports corruption', async () => {
    const directory = await temporaryStorageDirectory();
    const storage = new UserDictionaryStorage(directory);
    const invalidBytes = '{"schemaVersion":2,"entries":[]}\n';
    await writeFile(storage.filePath, invalidBytes, 'utf8');
    await expect(storage.initialize()).rejects.toMatchObject({ code: 'corruptStore' });
    await expect(readFile(storage.filePath, 'utf8')).resolves.toBe(invalidBytes);
  });

  it('reports a missing initialized store instead of recreating it as empty', async () => {
    const directory = await temporaryStorageDirectory();
    const storage = new UserDictionaryStorage(directory);
    await storage.initialize();
    await rm(storage.filePath);
    await expect(storage.read()).rejects.toMatchObject({ code: 'corruptStore' });
    await expect(stat(storage.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('makes a second writer wait until the first writer releases its owned lock', async () => {
    const directory = await temporaryStorageDirectory();
    await new UserDictionaryStorage(directory).initialize();
    let signalCommitStarted!: () => void;
    const commitStarted = new Promise<void>((resolve) => { signalCommitStarted = resolve; });
    let releaseCommit!: () => void;
    const commitMayFinish = new Promise<void>((resolve) => { releaseCommit = resolve; });
    const first = new UserDictionaryStorage(directory, {
      lockRetryMs: 5,
      commitTemporaryFile: async (temporaryPath, destinationPath) => {
        signalCommitStarted();
        await commitMayFinish;
        await rename(temporaryPath, destinationPath);
      }
    });
    const second = new UserDictionaryStorage(directory, { lockRetryMs: 5 });
    const firstWrite = first.replace({
      schemaVersion: 1,
      entries: [userDictionaryEntry({ id: 'first' })]
    });
    await commitStarted;
    const owner = JSON.parse(await readFile(first.lockPath, 'utf8')) as Record<string, unknown>;
    expect(owner).toMatchObject({ processId: process.pid });
    expect(owner.token).toEqual(expect.any(String));
    expect(owner.createdAt).toEqual(expect.any(Number));

    let secondFinished = false;
    const secondWrite = second.replace({
      schemaVersion: 1,
      entries: [userDictionaryEntry({ id: 'second', term: 'second', normalizedTerm: 'second' })]
    }).then((value) => {
      secondFinished = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(secondFinished).toBe(false);
    releaseCommit();
    await firstWrite;
    await secondWrite;
    expect((await second.read()).entries[0]?.id).toBe('second');
  });

  it('recovers a stale lock older than the configured bound', async () => {
    const directory = await temporaryStorageDirectory();
    const storage = new UserDictionaryStorage(directory, {
      staleLockAgeMs: 10,
      lockRetryMs: 5
    });
    await storage.initialize();
    await writeFile(storage.lockPath, 'incomplete-owner', 'utf8');
    const old = new Date(Date.now() - 60_000);
    await utimes(storage.lockPath, old, old);
    await expect(storage.replace({
      schemaVersion: 1,
      entries: [userDictionaryEntry()]
    })).resolves.toMatchObject({ entries: [{ id: 'entry-ledger' }] });
    await expect(stat(storage.lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('times out on a live lock and names only the lock path', async () => {
    const directory = await temporaryStorageDirectory();
    const storage = new UserDictionaryStorage(directory, {
      lockWaitMs: 20,
      lockRetryMs: 5
    });
    await storage.initialize();
    await writeFile(storage.lockPath, JSON.stringify({
      token: ['owned', 'lock', 'token'].join('-'),
      processId: process.pid,
      createdAt: Date.now()
    }), 'utf8');
    let failure: unknown;
    try {
      await storage.read();
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'lockTimeout' });
    expect((failure as Error).message).toContain(storage.lockPath);
    expect((failure as Error).message).not.toContain('ledger');
  });

  it('writes canonical JSON with restrictive permissions where supported', async () => {
    const directory = await temporaryStorageDirectory();
    const storage = new UserDictionaryStorage(directory);
    const store = { schemaVersion: 1 as const, entries: [userDictionaryEntry()] };
    await storage.initialize();
    await storage.replace(store);
    await expect(readFile(storage.filePath, 'utf8')).resolves.toBe(
      exportUserDictionaryJson(store)
    );
    if (process.platform !== 'win32') {
      expect((await stat(storage.filePath)).mode & 0o777).toBe(0o600);
    }
  });

  it('stores the same spelling under two language tags without merging either entry', async () => {
    const directory = await temporaryStorageDirectory();
    const storage = new UserDictionaryStorage(directory);
    await storage.initialize();
    await storage.replace({
      schemaVersion: 1,
      entries: [
        userDictionaryEntry({ id: 'english', language: 'en' }),
        userDictionaryEntry({ id: 'french', language: 'fr' })
      ]
    });
    await expect(storage.read()).resolves.toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({ id: 'english', language: 'en', normalizedTerm: 'ledger' }),
        expect.objectContaining({ id: 'french', language: 'fr', normalizedTerm: 'ledger' })
      ])
    });
  });

  it('still rejects the same spelling twice in the same language', async () => {
    const directory = await temporaryStorageDirectory();
    const storage = new UserDictionaryStorage(directory);
    await storage.initialize();
    await expect(storage.replace({
      schemaVersion: 1,
      entries: [
        userDictionaryEntry({ id: 'first', language: 'en' }),
        userDictionaryEntry({ id: 'second', language: 'EN' })
      ]
    })).rejects.toThrow('duplicate normalizedTerm');
  });
});

// Added 2026-08-14 from an automated review finding, verified against the code before
// being accepted. withLock closed the lock handle and released the lock as two adjacent
// awaits in one finally block, so a rejecting close() skipped the release entirely and
// left the lock file on disk. The dictionary then stayed unwritable until breakStaleLock
// aged it out, which is thirty seconds by default rather than the "indefinitely" the
// review suggested. Wrong either way, and the fix is to nest the close.
describe('lock release when closing the handle fails', () => {
  it('releases the lock even though close rejects, so the next write succeeds', async () => {
    // temporaryStorageDirectory rather than a bare mkdtemp, so the afterEach hook removes
    // it. A directory created outside that helper is never registered and leaks one
    // temporary tree per run, which is invisible until someone looks at their temp folder.
    const directory = await temporaryStorageDirectory();
    const failing = new UserDictionaryStorage(directory, {
      closeLockHandle: async () => { throw new Error('simulated close failure'); }
    });

    let failure: unknown;
    try {
      await failing.initialize();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);

    // The obligation that matters: the lock file is gone, so the dictionary is usable.
    expect(existsSync(failing.lockPath), 'the lock file survived a failing close').toBe(false);

    const healthy = new UserDictionaryStorage(directory, { lockWaitMs: 250 });
    const store = await healthy.initialize();
    expect(store.schemaVersion).toBe(1);
  });
});
