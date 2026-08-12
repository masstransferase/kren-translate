import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileCloudTranslationUsage } from '../src/fileCloudTranslationUsage.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe('shared Cloud Translation usage ledger', () => {
  it('shares reservations safely between independent instances', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'kren-usage-'));
    directories.push(directory);
    const file = path.join(directory, 'usage.json');
    const now = () => new Date('2026-07-13T00:00:00Z');
    const first = new FileCloudTranslationUsage(file, 10, now);
    const second = new FileCloudTranslationUsage(file, 10, now);
    await first.initialize();
    await second.initialize();

    await Promise.all([first.reserve(4), second.reserve(6)]);

    await expect(first.get()).resolves.toMatchObject({ characters: 10 });
    await expect(second.reserve(1)).rejects.toThrow('was not called');
  });

  it('fails closed without overwriting a corrupt usage ledger', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'kren-usage-'));
    directories.push(directory);
    const file = path.join(directory, 'usage.json');
    await writeFile(file, '{not-json', 'utf8');
    const usage = new FileCloudTranslationUsage(
      file,
      10,
      () => new Date('2026-07-13T00:00:00Z')
    );

    await expect(usage.initialize()).rejects.toThrow('blocked Google Cloud Translation');
    await expect(readFile(file, 'utf8')).resolves.toBe('{not-json');
    await expect(usage.reserve(1)).rejects.toThrow(file);
  });

  it('resets a structurally valid previous-month ledger', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'kren-usage-'));
    directories.push(directory);
    const file = path.join(directory, 'usage.json');
    await writeFile(file, JSON.stringify({ month: '2026-06', characters: 10 }), 'utf8');
    const usage = new FileCloudTranslationUsage(
      file,
      10,
      () => new Date('2026-07-13T00:00:00Z')
    );
    await usage.initialize();

    await expect(usage.reserve(3)).resolves.toEqual({ month: '2026-07', characters: 3 });
  });

  it('recovers an abandoned malformed lock after the stale threshold', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'kren-usage-'));
    directories.push(directory);
    const file = path.join(directory, 'usage.json');
    const usage = new FileCloudTranslationUsage(
      file,
      10,
      () => new Date('2026-07-13T00:00:00Z'),
      0
    );
    await usage.initialize();
    await writeFile(`${file}.lock`, 'incomplete-owner', 'utf8');

    await expect(usage.reserve(2)).resolves.toEqual({ month: '2026-07', characters: 2 });
    await expect(readFile(file, 'utf8')).resolves.toContain('"characters":2');
  });
});
