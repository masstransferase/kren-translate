import { it, vi } from 'vitest';
vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (_: string, value: unknown) => value }) },
  commands: { executeCommand: vi.fn() }, env: {}, window: {}, Uri: { joinPath: (...parts: unknown[]) => parts } }));
import assert from 'node:assert/strict';
import { exportUserDictionaryJson, previewUserDictionaryImportDocument, applyUserDictionaryImport } from '../src/userDictionary/providerContract.js';
import { userDictionaryEntry } from './userDictionaryFixtures.js';
import { v272Trace } from './support/v272Cases.js';

it('keeps imported Cloudflare attribution when replacing the same Groq identifier and term', () => {
  // Review finding 1: keep lossless JSON import, required by USER_DICTIONARY_BLUEPRINT.md near line 610.
  const entry = userDictionaryEntry();
  const existing = { ...entry, capture: { ...entry.capture, mode: 'llmOnly' as const, model: 'synthetic-model', provider: 'groq' as const } };
  const incoming = { ...entry, capture: { ...entry.capture, mode: 'llmOnly' as const, model: 'synthetic-model', provider: 'cloudflare' as const } };
  const store = { schemaVersion: 1 as const, entries: [existing] };
  const preview = previewUserDictionaryImportDocument(exportUserDictionaryJson({ schemaVersion: 1, entries: [incoming] }), 'json', store);
  assert.equal(preview.validEntryCount, 1);
  assert.equal(preview.storeDuplicateCount, 1);
  const merged = applyUserDictionaryImport(store, preview, { mode: 'merge', duplicateStrategy: 'replaceExisting' });
  assert.equal(merged.entries.length, 1);
  assert.equal(merged.entries[0]?.id, existing.id);
  assert.equal(merged.entries[0]?.term, existing.term);
  assert.equal(merged.entries[0]?.capture.provider, 'cloudflare');
});

it('rejects an empty Gemini fallback model after one HTTP 404 attempt', async () => {
  // Review finding 2: the production host already rejected empty fallback models before F7, and no production caller builds this CenterRequest.
  const result = await v272Trace('emptyFallback');
  assert.equal(result.outcome.type, 'failed');
  assert.equal(result.trace.filter(item => Array.isArray(item) && item[0] === 'attempt').length, 1);
  assert.equal(result.outcome.history.length, 1);
  assert.equal(result.outcome.history[0]?.status, 404);
  assert.equal(result.outcome.recovery.some(item => item.decision === 'fallback'), false);
});
