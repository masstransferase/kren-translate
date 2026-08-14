import { describe, expect, it } from 'vitest';
import {
  applyUserDictionaryImport,
  exportUserDictionaryJson,
  exportUserDictionaryMarkdown,
  importUserDictionaryMarkdown,
  importUserDictionaryJson,
  previewUserDictionaryImport,
  UserDictionaryImportError
} from '../src/userDictionary/importExport.js';
import { normalizeUserDictionaryTerm } from '../src/userDictionary/normalization.js';
import {
  representativeUserDictionaryStore,
  userDictionaryEntry
} from './userDictionaryFixtures.js';

describe('User Dictionary JSON import and export', () => {
  it('round-trips representative Unicode entries byte for byte in canonical form', () => {
    const canonical = exportUserDictionaryJson(representativeUserDictionaryStore());
    const restored = importUserDictionaryJson(canonical);
    expect(exportUserDictionaryJson(restored)).toBe(canonical);
    expect(restored.entries.map((entry) => entry.term)).toEqual([
      'Café', 'compare-and-swap', 'get   rid\tof', '사전'
    ]);
  });

  it('round-trips the representative fixture through Markdown as a lossy best effort', () => {
    const original = representativeUserDictionaryStore();
    const markdown = exportUserDictionaryMarkdown(original);
    const restored = importUserDictionaryMarkdown(markdown);
    const project = (entry: typeof original.entries[number]) => ({
      term: entry.term,
      normalizedTerm: entry.normalizedTerm,
      language: entry.language,
      entryType: entry.entryType,
      collection: entry.collection,
      domains: entry.domains,
      tags: entry.tags,
      aliases: entry.aliases,
      senses: entry.senses.map(({ id: _id, ...sense }) => sense)
    });
    const byTerm = (left: ReturnType<typeof project>, right: ReturnType<typeof project>) =>
      left.normalizedTerm.localeCompare(right.normalizedTerm);
    expect(restored.entries.map(project).sort(byTerm))
      .toEqual(original.entries.map(project).sort(byTerm));
    expect(markdown).toContain('Markdown is lossy by design');
    expect(restored.entries.every((entry) => entry.pronunciation === undefined)).toBe(true);
  });

  it('accepts schemaVersion 1 backups and refuses a future version without applying it', () => {
    const versionOne = exportUserDictionaryJson(representativeUserDictionaryStore());
    expect(importUserDictionaryJson(versionOne).entries).toHaveLength(4);
    expect(() => previewUserDictionaryImport(JSON.stringify({
      schemaVersion: 99,
      entries: [userDictionaryEntry({ id: 'future' })]
    }), representativeUserDictionaryStore())).toThrow(
      'schemaVersion 99 is not supported by this version of KREN. Nothing was imported.'
    );
  });

  it('previews entry, duplicate, and invalid-record counts without applying changes', () => {
    const existing = {
      schemaVersion: 1 as const,
      entries: [userDictionaryEntry({ id: 'existing' })]
    };
    const duplicate = userDictionaryEntry({ id: 'duplicate', term: 'LEDGER', normalizedTerm: 'ledger' });
    const internalDuplicate = userDictionaryEntry({ id: 'internal', term: ' ledger ', normalizedTerm: 'ledger' });
    const invalid = { ...userDictionaryEntry({ id: 'invalid' }), rawModelResponse: 'not retained' };
    const preview = previewUserDictionaryImport(JSON.stringify({
      schemaVersion: 1,
      entries: [duplicate, internalDuplicate, invalid]
    }), existing);
    expect(preview).toMatchObject({
      entryCount: 3,
      validEntryCount: 2,
      invalidRecordCount: 1,
      duplicateCount: 3
    });
    expect(existing.entries).toHaveLength(1);
  });

  it('does nothing when the caller explicitly cancels', () => {
    const current = representativeUserDictionaryStore();
    const content = exportUserDictionaryJson({
      schemaVersion: 1,
      entries: [userDictionaryEntry({ id: 'replacement' })]
    });
    const preview = previewUserDictionaryImport(content, current);
    expect(applyUserDictionaryImport(current, preview, { mode: 'cancel' })).toEqual(
      importUserDictionaryJson(exportUserDictionaryJson(current))
    );
  });

  it('replaces only after an explicit replace decision', () => {
    const current = representativeUserDictionaryStore();
    const replacement = userDictionaryEntry({ id: 'replacement' });
    const preview = previewUserDictionaryImport(
      exportUserDictionaryJson({ schemaVersion: 1, entries: [replacement] }),
      current
    );
    expect(applyUserDictionaryImport(current, preview, { mode: 'replace' }).entries).toEqual([
      replacement
    ]);
  });

  it('requires an explicit strategy for merge duplicates', () => {
    const existing = userDictionaryEntry({ id: 'existing' });
    const incoming = userDictionaryEntry({ id: 'incoming', term: 'LEDGER', normalizedTerm: 'ledger' });
    const current = { schemaVersion: 1 as const, entries: [existing] };
    const preview = previewUserDictionaryImport(
      exportUserDictionaryJson({ schemaVersion: 1, entries: [incoming] }),
      current
    );
    expect(applyUserDictionaryImport(current, preview, {
      mode: 'merge',
      duplicateStrategy: 'keepExisting'
    }).entries[0]?.id).toBe('existing');
    expect(applyUserDictionaryImport(current, preview, {
      mode: 'merge',
      duplicateStrategy: 'replaceExisting'
    }).entries[0]?.id).toBe('incoming');
  });

  it('does not apply a preview containing invalid or internal duplicate records', () => {
    const invalidPreview = previewUserDictionaryImport(JSON.stringify({
      schemaVersion: 1,
      entries: [{ ...userDictionaryEntry(), extra: 'value' }]
    }), { schemaVersion: 1, entries: [] });
    expect(() => applyUserDictionaryImport(
      { schemaVersion: 1, entries: [] },
      invalidPreview,
      { mode: 'replace' }
    )).toThrow('1 records are invalid');

    const first = userDictionaryEntry({ id: 'first' });
    const second = userDictionaryEntry({ id: 'second' });
    const duplicatePreview = previewUserDictionaryImport(JSON.stringify({
      schemaVersion: 1,
      entries: [first, second]
    }), { schemaVersion: 1, entries: [] });
    expect(() => applyUserDictionaryImport(
      { schemaVersion: 1, entries: [] },
      duplicatePreview,
      { mode: 'replace' }
    )).toThrow('duplicate records occur in the import');
  });

  it.each([
    '<script>run()</script>',
    '<img src=x onerror=run()>',
    'javascript:run()',
    'data:text/html,<script>run()</script>',
    '#!/usr/bin/env node'
  ])('rejects unexpected executable or HTML content', (definition) => {
    const entry = userDictionaryEntry({
      senses: [{
        ...userDictionaryEntry().senses[0]!,
        definition
      }]
    });
    expect(() => previewUserDictionaryImport(JSON.stringify({
      schemaVersion: 1,
      entries: [entry]
    }), { schemaVersion: 1, entries: [] })).toThrow(
      'unexpected executable or HTML content'
    );
  });

  it('rejects invalid JSON and unknown top-level fields without echoing entry content', () => {
    expect(() => importUserDictionaryJson('{not-json')).toThrow('invalid JSON');
    expect(() => previewUserDictionaryImport(JSON.stringify({
      schemaVersion: 1,
      entries: [],
      executable: 'private term and definition'
    }), { schemaVersion: 1, entries: [] })).toThrow('executable');
  });

  it('reports normalization-form duplicates against the current store', () => {
    const existing = userDictionaryEntry({
      id: 'existing',
      term: 'Café',
      normalizedTerm: normalizeUserDictionaryTerm('Café')
    });
    const incoming = userDictionaryEntry({
      id: 'incoming',
      term: 'CAFE\u0301',
      normalizedTerm: normalizeUserDictionaryTerm('CAFE\u0301')
    });
    const preview = previewUserDictionaryImport(
      exportUserDictionaryJson({ schemaVersion: 1, entries: [incoming] }),
      { schemaVersion: 1, entries: [existing] }
    );
    expect(preview.duplicates).toEqual([{
      recordIndex: 0,
      entryId: 'incoming',
      duplicateEntryId: 'existing',
      source: 'store'
    }]);
  });

  it('treats the same normalized term in different languages as distinct', () => {
    const existing = userDictionaryEntry({ id: 'english', language: 'en' });
    const incoming = userDictionaryEntry({ id: 'french', language: 'fr' });
    const preview = previewUserDictionaryImport(
      exportUserDictionaryJson({ schemaVersion: 1, entries: [incoming] }),
      { schemaVersion: 1, entries: [existing] }
    );
    expect(preview.duplicates).toEqual([]);
    expect(applyUserDictionaryImport(
      { schemaVersion: 1, entries: [existing] },
      preview,
      { mode: 'merge', duplicateStrategy: 'keepExisting' }
    ).entries.map((entry) => entry.id)).toEqual(['english', 'french']);
  });

  it('uses safe import errors that never contain definitions', () => {
    const definition = 'definition that must remain private';
    const content = JSON.stringify({
      schemaVersion: 1,
      entries: [{
        ...userDictionaryEntry(),
        senses: [{ ...userDictionaryEntry().senses[0]!, examples: definition }]
      }]
    });
    let failure: unknown;
    try {
      importUserDictionaryJson(content);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(UserDictionaryImportError);
    expect((failure as Error).message).not.toContain(definition);
  });
});
