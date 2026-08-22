import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { UserDictionaryService } from '../src/userDictionary/service.js';
import { UserDictionaryStorage } from '../src/userDictionary/storage.js';
import { exportUserDictionaryJson } from '@kren/core/user-dictionary';
import { userDictionaryEntry } from './userDictionaryFixtures.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

async function lifecycleService(): Promise<{
  service: UserDictionaryService;
  storage: UserDictionaryStorage;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kren-user-dictionary-lifecycle-'));
  temporaryDirectories.push(directory);
  const storage = new UserDictionaryStorage(directory);
  const service = new UserDictionaryService(
    storage,
    () => '2026-08-13T12:00:00.000Z'
  );
  await service.initialize();
  return { service, storage };
}

describe('User Dictionary lifecycle service', () => {
  it('confirmed purge deletes the previewed identifiers even when ages change before confirmation', async () => {
    const { service, storage } = await lifecycleService();
    const previewed = userDictionaryEntry({
      id: 'previewed',
      updatedAt: '2026-06-01T00:00:00.000Z'
    });
    const notPreviewed = userDictionaryEntry({
      id: 'not-previewed',
      term: 'recent term',
      normalizedTerm: 'recent term',
      updatedAt: '2026-08-01T00:00:00.000Z'
    });
    await storage.replace({ schemaVersion: 1, entries: [previewed, notPreviewed] });

    const preview = await service.previewPurge('olderThan1Month');
    expect(preview.entryIds).toEqual(['previewed']);

    await storage.replace({
      schemaVersion: 1,
      entries: [
        { ...previewed, updatedAt: '2026-08-12T00:00:00.000Z' },
        { ...notPreviewed, updatedAt: '2026-06-01T00:00:00.000Z' }
      ]
    });

    const remaining = await service.confirmPurge(preview);
    expect(remaining.map((entry) => entry.id)).toEqual(['not-previewed']);
  });

  it('leaves the complete old store when the atomic purge write is interrupted', async () => {
    const { service, storage } = await lifecycleService();
    const old = userDictionaryEntry({
      id: 'old',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });
    const recent = userDictionaryEntry({
      id: 'recent',
      term: 'recent',
      normalizedTerm: 'recent',
      updatedAt: '2026-08-01T00:00:00.000Z'
    });
    await storage.replace({ schemaVersion: 1, entries: [old, recent] });
    const interrupted = new UserDictionaryService(new UserDictionaryStorage(
      storage.directory,
      { commitTemporaryFile: async () => { throw new Error('simulated interruption'); } }
    ), () => '2026-08-13T12:00:00.000Z');
    await interrupted.initialize();
    const preview = await interrupted.previewPurge('olderThan1Month');

    let failure: unknown;
    try {
      await interrupted.confirmPurge(preview);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('Existing data was preserved');
    expect((failure as Error).message).not.toContain(old.term);
    expect((failure as Error).message).not.toContain(recent.term);
    expect((await storage.read()).entries.map((entry) => entry.id)).toEqual(['old', 'recent']);
  });

  it('never modifies the original import file after accepted and rejected decisions', async () => {
    const { service, storage } = await lifecycleService();
    await storage.replace({ schemaVersion: 1, entries: [] });
    const sourcePath = path.join(storage.directory, 'backup.json');
    const source = exportUserDictionaryJson({
      schemaVersion: 1,
      entries: [userDictionaryEntry({ id: 'from-backup' })]
    });
    await writeFile(sourcePath, source, 'utf8');
    const preview = await service.previewImport(await readFile(sourcePath, 'utf8'), 'json');

    await service.applyImport(preview, { mode: 'cancel' });
    expect(await readFile(sourcePath, 'utf8')).toBe(source);
    await service.applyImport(preview, { mode: 'merge', duplicateStrategy: 'keepExisting' });
    expect(await readFile(sourcePath, 'utf8')).toBe(source);
  });

  it('never overwrites an existing duplicate without the explicit replace decision', async () => {
    const { service, storage } = await lifecycleService();
    const existing = userDictionaryEntry({ id: 'existing' });
    await storage.replace({ schemaVersion: 1, entries: [existing] });
    const incoming = userDictionaryEntry({
      id: 'incoming',
      term: 'LEDGER',
      normalizedTerm: 'ledger',
      senses: [{ ...existing.senses[0]!, definition: 'Replacement definition.' }]
    });
    const preview = await service.previewImport(exportUserDictionaryJson({
      schemaVersion: 1,
      entries: [incoming]
    }), 'json');

    expect((await service.applyImport(preview, {
      mode: 'merge',
      duplicateStrategy: 'keepExisting'
    }))[0]?.id).toBe('existing');
    expect((await service.applyImport(preview, {
      mode: 'merge',
      duplicateStrategy: 'replaceExisting'
    }))[0]?.id).toBe('incoming');
  });

});
