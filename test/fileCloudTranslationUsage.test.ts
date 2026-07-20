import { mkdtemp, rm } from 'node:fs/promises';
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
});
