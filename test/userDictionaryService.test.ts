import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { UserDictionaryService } from '../src/userDictionary/service.js';
import { UserDictionaryStorage } from '../src/userDictionary/storage.js';
import { userDictionaryEntry } from './userDictionaryFixtures.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

async function service(): Promise<UserDictionaryService> {
  const directory = await mkdtemp(path.join(tmpdir(), 'kren-d8-service-'));
  temporaryDirectories.push(directory);
  return new UserDictionaryService(
    new UserDictionaryStorage(directory),
    () => '2026-08-12T12:00:00.000Z'
  );
}

describe('User Dictionary approved-entry service', () => {
  it('offers a duplicate instead of creating a second same-language copy', async () => {
    const dictionary = await service();
    const original = userDictionaryEntry({ id: 'original', term: 'Ledger', language: 'en' });
    expect((await dictionary.save(original)).kind).toBe('saved');

    const duplicate = await dictionary.save(userDictionaryEntry({
      id: 'duplicate', term: ' ledger ', language: 'EN'
    }));

    expect(duplicate).toMatchObject({ kind: 'duplicate', existing: { id: 'original' } });
    expect(await dictionary.list()).toHaveLength(1);
  });

  it('updates the existing entry after explicit Update existing approval', async () => {
    const dictionary = await service();
    await dictionary.save(userDictionaryEntry({ id: 'original', term: 'ledger', language: 'en' }));
    const replacement = userDictionaryEntry({ id: 'draft', term: 'ledger', language: 'en' });
    replacement.senses[0]!.definition = 'An account book or digital accounting record.';

    const saved = await dictionary.save(replacement, 'original');

    expect(saved).toMatchObject({ kind: 'saved', entry: { id: 'original' } });
    expect(await dictionary.list()).toHaveLength(1);
    expect((await dictionary.list())[0]?.senses[0]?.definition).toContain('digital accounting');
  });

  it('keeps the same spelling in two different languages', async () => {
    const dictionary = await service();
    await dictionary.save(userDictionaryEntry({ id: 'english', term: 'gift', language: 'en' }));
    await dictionary.save(userDictionaryEntry({ id: 'german', term: 'gift', language: 'de' }));

    expect((await dictionary.list()).map((entry) => entry.language).sort()).toEqual(['de', 'en']);
  });

  it('still detects the same spelling in the same language', async () => {
    const dictionary = await service();
    await dictionary.save(userDictionaryEntry({ id: 'one', term: 'gift', language: 'de' }));
    const duplicate = await dictionary.save(userDictionaryEntry({
      id: 'two', term: 'GIFT', language: 'DE'
    }));

    expect(duplicate.kind).toBe('duplicate');
    expect(await dictionary.list()).toHaveLength(1);
  });
});
