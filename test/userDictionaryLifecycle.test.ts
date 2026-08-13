import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { UserDictionaryService } from '../src/userDictionary/service.js';
import { UserDictionaryStorage } from '../src/userDictionary/storage.js';
import {
  filterUserDictionaryEntries,
  isUserDictionaryExportFormat,
  isUserDictionarySourceFilter,
  USER_DICTIONARY_EXPORT_FORMATS,
  USER_DICTIONARY_SOURCE_FILTERS,
  USER_DICTIONARY_VIEW_STATUSES,
  isUserDictionaryViewStatus
} from '../src/userDictionary/lifecycle.js';
import {
  exportUserDictionaryJson,
  exportUserDictionaryMarkdown
} from '../src/userDictionary/importExport.js';
import {
  requiresRemoveAllConfirmation,
  USER_DICTIONARY_PURGE_SELECTIONS
} from '../src/userDictionary/purge.js';
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

  it('requires the stronger confirmation path only for remove all', () => {
    for (const selection of USER_DICTIONARY_PURGE_SELECTIONS) {
      expect(requiresRemoveAllConfirmation(selection.id)).toBe(selection.id === 'all');
    }
    expect(USER_DICTIONARY_PURGE_SELECTIONS.slice(0, 4).every((selection) =>
      !requiresRemoveAllConfirmation(selection.id)
    )).toBe(true);
  });

  it('searches all blueprint fields and combines every lifecycle filter', () => {
    const referenced = userDictionaryEntry({
      id: 'referenced',
      term: 'Zulu',
      language: 'en',
      entryType: 'idiom',
      collection: 'Work',
      aliases: ['last letter'],
      tags: ['alphabet'],
      senses: [{
        ...userDictionaryEntry().senses[0]!,
        definition: 'A final character.',
        usageNote: 'Used figuratively.'
      }]
    });
    const local = userDictionaryEntry({
      id: 'local',
      term: 'alpha',
      normalizedTerm: 'alpha',
      language: 'ko',
      entryType: 'technical expression',
      collection: 'Other',
      merriamWebsterReference: undefined,
      capture: { ...userDictionaryEntry().capture, mode: 'merriamWebsterAndLlm' }
    });
    const entries = [referenced, local];

    for (const search of ['zulu', 'LAST LETTER', 'final character', 'FIGURATIVELY', 'alphabet', 'work']) {
      expect(filterUserDictionaryEntries(entries, { search }).map((entry) => entry.id))
        .toEqual(['referenced']);
    }
    expect(filterUserDictionaryEntries(entries, {
      language: 'ko',
      collection: 'Other',
      entryType: 'technical expression',
      captureMode: 'merriamWebsterAndLlm',
      source: 'withoutMerriamWebster'
    }).map((entry) => entry.id)).toEqual(['local']);
    expect(filterUserDictionaryEntries(entries, {}).map((entry) => entry.term))
      .toEqual(['alpha', 'Zulu']);
  });

  it('derives lifecycle value guards from their single source arrays', () => {
    for (const option of USER_DICTIONARY_SOURCE_FILTERS) {
      expect(isUserDictionarySourceFilter(option.id)).toBe(true);
    }
    for (const option of USER_DICTIONARY_EXPORT_FORMATS) {
      expect(isUserDictionaryExportFormat(option.id)).toBe(true);
    }
    for (const option of USER_DICTIONARY_VIEW_STATUSES) {
      expect(isUserDictionaryViewStatus(option.id)).toBe(true);
    }
    expect(isUserDictionarySourceFilter('remoteOnly')).toBe(false);
    expect(isUserDictionaryExportFormat('csv')).toBe(false);
    expect(isUserDictionaryViewStatus('missing')).toBe(false);
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

  it('exports selected entries without changing the source entries', () => {
    const first = userDictionaryEntry({ id: 'first' });
    const second = userDictionaryEntry({
      id: 'second',
      term: 'second',
      normalizedTerm: 'second'
    });
    const selected = { schemaVersion: 1 as const, entries: [second] };
    expect(exportUserDictionaryJson(selected)).toContain('"id": "second"');
    expect(exportUserDictionaryMarkdown(selected)).toContain('"second"');
    expect(first.id).toBe('first');
  });
});
