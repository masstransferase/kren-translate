import type { UserDictionaryEntryV1, UserDictionaryStoreV1 } from '@kren/core/user-dictionary';
import {
  applyUserDictionaryImport,
  previewUserDictionaryImportDocument,
  type UserDictionaryImportDecision,
  type UserDictionaryImportPreview
} from '@kren/core/user-dictionary';
import type { UserDictionaryExportFormat } from '@kren/core/user-dictionary';
import { userDictionaryDuplicateKey } from '@kren/core/user-dictionary';
import {
  entriesRemainingAfterPurge,
  previewUserDictionaryPurge,
  type UserDictionaryPurgePreview,
  type UserDictionaryPurgeSelection
} from '@kren/core/user-dictionary';
import { UserDictionaryStorage } from './storage.js';
import { validateUserDictionaryEntry } from '@kren/core/user-dictionary';

export type UserDictionarySaveResult =
  | { kind: 'saved'; entry: UserDictionaryEntryV1; entries: UserDictionaryEntryV1[] }
  | { kind: 'duplicate'; existing: UserDictionaryEntryV1; entries: UserDictionaryEntryV1[] };

export class UserDictionaryService {
  private initialized = false;

  public constructor(
    private readonly storage: UserDictionaryStorage,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  public async initialize(): Promise<UserDictionaryEntryV1[]> {
    const store = await this.storage.initialize();
    this.initialized = true;
    return store.entries;
  }

  public async list(): Promise<UserDictionaryEntryV1[]> {
    return (await this.read()).entries;
  }

  public async save(
    candidate: UserDictionaryEntryV1,
    replaceId?: string
  ): Promise<UserDictionarySaveResult> {
    const validated = validateUserDictionaryEntry(candidate);
    let result: UserDictionarySaveResult | undefined;
    const store = await this.update((current) => {
      const replacing = replaceId
        ? current.entries.find((entry) => entry.id === replaceId)
        : undefined;
      const approved: UserDictionaryEntryV1 = validateUserDictionaryEntry({
        ...validated,
        ...(replacing ? { id: replacing.id, createdAt: replacing.createdAt } : {}),
        normalizedTerm: validated.normalizedTerm,
        capture: { ...validated.capture, userEdited: true },
        updatedAt: this.now()
      });
      const key = userDictionaryDuplicateKey(approved.language, approved.normalizedTerm);
      const duplicate = current.entries.find((entry) =>
        entry.id !== replacing?.id &&
        userDictionaryDuplicateKey(entry.language, entry.normalizedTerm) === key
      );
      if (duplicate) {
        result = { kind: 'duplicate', existing: duplicate, entries: current.entries };
        return current;
      }
      const entries = replacing
        ? current.entries.map((entry) => entry.id === replacing.id ? approved : entry)
        : [...current.entries, approved];
      result = { kind: 'saved', entry: approved, entries };
      return { schemaVersion: 1, entries };
    });
    if (!result) throw new Error('User Dictionary save did not complete.');
    return result.kind === 'saved'
      ? { ...result, entries: store.entries }
      : { ...result, entries: store.entries };
  }

  public async delete(id: string): Promise<UserDictionaryEntryV1[]> {
    return this.deleteMany([id]);
  }

  public async deleteMany(ids: readonly string[]): Promise<UserDictionaryEntryV1[]> {
    const deleted = new Set(ids);
    const store = await this.update((current) => ({
      schemaVersion: 1,
      entries: current.entries.filter((entry) => !deleted.has(entry.id))
    }));
    return store.entries;
  }

  public async previewImport(
    content: string,
    format: UserDictionaryExportFormat,
    maxEntries?: number
  ): Promise<UserDictionaryImportPreview> {
    return previewUserDictionaryImportDocument(content, format, await this.read(), maxEntries);
  }

  public async applyImport(
    preview: UserDictionaryImportPreview,
    decision: UserDictionaryImportDecision
  ): Promise<UserDictionaryEntryV1[]> {
    if (decision.mode === 'cancel') return (await this.read()).entries;
    const store = await this.update((current) =>
      applyUserDictionaryImport(current, preview, decision)
    );
    return store.entries;
  }

  public async previewPurge(
    selection: UserDictionaryPurgeSelection
  ): Promise<UserDictionaryPurgePreview> {
    return previewUserDictionaryPurge(
      await this.read(),
      selection,
      new Date(this.now())
    );
  }

  public async confirmPurge(
    preview: UserDictionaryPurgePreview
  ): Promise<UserDictionaryEntryV1[]> {
    const store = await this.update((current) => {
      return {
        schemaVersion: 1,
        entries: entriesRemainingAfterPurge(current, preview)
      };
    });
    return store.entries;
  }

  private async read(): Promise<UserDictionaryStoreV1> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.storage.read();
  }

  private async update(
    operation: (store: UserDictionaryStoreV1) => UserDictionaryStoreV1
  ): Promise<UserDictionaryStoreV1> {
    if (!this.initialized) await this.initialize();
    return this.storage.update(operation);
  }
}
