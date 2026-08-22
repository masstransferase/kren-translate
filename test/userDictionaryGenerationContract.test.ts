import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  captureUserDictionaryDraft,
  type UserDictionaryGenerationRequest,
  type UserDictionaryProviderTransport
} from '../src/userDictionary/capture.js';
import {
  USER_DICTIONARY_CAPTURE_DEFAULTS,
  type UserDictionaryCaptureSettings
} from '../src/userDictionary/settings.js';

const SETTINGS: UserDictionaryCaptureSettings = {
  ...USER_DICTIONARY_CAPTURE_DEFAULTS,
  entryLanguage: 'en',
  numberOfExamples: 1
};

function generatedContent(term: string): Record<string, unknown> {
  return {
    term,
    language: 'en',
    entryType: 'expression',
    domains: [],
    tags: [],
    pronunciation: '',
    senses: [{
      partOfSpeech: 'verb',
      definition: 'A test definition.',
      usageNote: '',
      synonyms: [],
      antonyms: [],
      relatedTerms: [],
      examples: []
    }],
    aliases: []
  };
}

function transportFor(
  value: unknown,
  requests: UserDictionaryGenerationRequest[] = []
): UserDictionaryProviderTransport {
  return {
    provider: 'gemini',
    model: 'gemini-dictionary-test',
    async generate(request) {
      requests.push(request);
      return value;
    }
  };
}

describe('the shared User Dictionary generation contract', () => {
  it('files selected showed up under show up and preserves the selection as an alias', async () => {
    const draft = await captureUserDictionaryDraft(
      'showed up',
      SETTINGS,
      transportFor(generatedContent('show up')),
      new AbortController().signal
    );

    expect(draft.term).toBe('show up');
    expect(draft.aliases).toContain('showed up');
  });

  it('keeps a selected phrase instead of lemmatising a word inside it', async () => {
    const expression = 'an image attached to an email';
    const draft = await captureUserDictionaryDraft(
      expression,
      SETTINGS,
      transportFor(generatedContent(expression)),
      new AbortController().signal
    );

    expect(draft.term).toBe(expression);
    expect(draft.aliases).not.toContain(expression);
  });

  it('keeps an expression supplied through Regenerate exactly as typed', async () => {
    const requests: UserDictionaryGenerationRequest[] = [];
    const draft = await captureUserDictionaryDraft(
      'attached',
      SETTINGS,
      transportFor(generatedContent('attach'), requests),
      new AbortController().signal,
      { termSuppliedByUser: true }
    );

    expect(draft.term).toBe('attached');
    expect(requests[0]?.instruction).toContain('Return it in term exactly as given');
  });
});

describe('the generation contract stays in core', () => {
  const OWNED_BY_CORE = [
    'Create a concise personal dictionary draft for exactly the ' +
      'expression supplied by the user.',
    'The term is the citation form of the lexical unit actually being ' +
      'recorded'
  ];

  it('keeps no repository-owned copy of the instruction', () => {
    const offenders: string[] = [];
    let scanned = 0;
    const extensions = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']);

    const walk = (directory: string): void => {
      // Every file under tools/ is private-side, so the produced public tree has no such
      // directory at all and this crashed there with ENOENT. Skipping what is absent lets
      // one guard serve both channels, which is the point of it.
      if (!existsSync(directory)) return;
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        const child = join(directory, item.name);
        if (item.isDirectory()) {
          walk(child);
          continue;
        }
        if (![...extensions].some((extension) => item.name.endsWith(extension))) continue;
        scanned += 1;
        const source = readFileSync(child, 'utf8');
        for (const sentence of OWNED_BY_CORE) {
          if (source.includes(sentence)) offenders.push(child);
        }
      }
    };
    for (const directory of ['src', 'test', 'tools']) walk(directory);

    // Skipping a missing directory must not become skipping everything. Without this the
    // guard passes by looking nowhere, which is how a check goes green while the thing it
    // checks walks in unnoticed.
    expect(scanned, 'the walk read source files rather than finding nothing').toBeGreaterThan(50);
    expect(
      [...new Set(offenders)],
      `import the instruction from @kren/core/user-dictionary instead of copying it: ${offenders.join(', ')}`
    ).toEqual([]);
  });
});
