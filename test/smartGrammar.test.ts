import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GrammarIssue } from '@kren/core/contracts';
import { mergeSmartGrammarIssues, smartGrammarIssues } from '../src/smartGrammar.js';

// Line endings normalized. This repository has core.autocrlf=true, so the working tree
// carries CRLF while every regex below is written with a bare newline. The signature
// assertion failed on 2026-08-20 for that reason alone, with the signature it asked for
// sitting in the file, and it would fail the same way on any fresh clone.
const normalizeLineEndings = (source: string): string => source.split('\r\n').join('\n');
const extension = normalizeLineEndings(readFileSync('src/extension.ts', 'utf8'));
const manifest = JSON.parse(
  readFileSync('package.json', 'utf8')
) as { contributes: { configuration: { properties: Record<string, { default?: unknown }> } } };

const SETTINGS = {
  provider: 'gemini' as const,
  model: 'test-model',
  thinkingOrEffort: 'low' as const,
  apiKey: 'test-key'
};

function geminiResponse(correctedText: string): Response {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ correctedText }) }] } }]
  }), { status: 200 });
}

function harperIssue(start: number, end: number, original: string): GrammarIssue {
  return {
    id: `harper-${start}`,
    start,
    end,
    original,
    category: 'spelling',
    message: 'Harper finding.',
    suggestions: [{ kind: 'replace', replacement: 'fixed', label: 'fixed' }]
  };
}

/** Splits a call's argument text on commas that are not inside brackets. */
function topLevelArguments(call: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of call) {
    if ('([{'.includes(character)) depth += 1;
    if (')]}'.includes(character)) depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  parts.push(current.trim());
  return parts;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  });
}

describe('Smart Grammar Check stays on the explicit command', () => {
  // The owner chose this on 2026-08-20. Automatic paragraph checking runs while the user
  // types rather than when they ask, so a remote call there would send the document
  // continuously with nobody requesting it. The flag has no default, which is what makes a
  // new caller decide instead of inheriting one.
  it('gives checkGrammarRange a required allowSmartGrammar parameter', () => {
    expect(extension).toMatch(
      /async function checkGrammarRange\([\s\S]*?allowSmartGrammar: boolean,\n\s+announce: boolean,/u
    );
    expect(extension).not.toContain('allowSmartGrammar: boolean = ');
    expect(extension).not.toContain('allowSmartGrammar = ');
  });

  it('lets exactly one caller allow the remote pass, and it is the explicit command', () => {
    const calls = Array.from(
      extension.matchAll(/(?:await |void )checkGrammarRange\(([\s\S]*?)\);/gu),
      (match) => match[1]!.replace(/\s+/gu, ' ')
    );
    expect(calls.length).toBeGreaterThanOrEqual(5);

    // An independent review defeated the earlier version of this test two ways, so both are
    // closed here. First: it matched a literal `true`, so a caller passing a variable that
    // held true was invisible. Every call's allowSmartGrammar argument must now be one of
    // the two literals, which makes an indirection a failure rather than a loophole.
    const argument = calls.map((call) => topLevelArguments(call)[3] ?? '');
    expect(
      argument.filter((value) => value !== 'true' && value !== 'false'),
      'allowSmartGrammar must be written as the literal true or false at every call site'
    ).toEqual([]);

    const allowing = calls.filter((_call, index) => argument[index] === 'true');
    expect(allowing, `exactly one caller may allow the remote pass, saw ${allowing.length}`)
      .toHaveLength(1);
    expect(allowing[0]).toContain('selections[0].start');
  });

  it('keeps the remote pass reachable only through checkGrammarRange', () => {
    // The second bypass the review found: calling runSmartGrammarPass straight from the
    // automatic checker sends the paragraph without touching checkGrammarRange at all, so
    // every assertion above would still pass. One definition, one call site.
    expect(
      extension.split('runSmartGrammarPass').length - 1,
      'runSmartGrammarPass has exactly one definition and one caller'
    ).toBe(2);
    const guarded = extension.slice(
      extension.indexOf('async function checkGrammarRange('),
      extension.indexOf('async function applyGrammarSuggestion(')
    );
    expect(guarded).not.toBe('');
    expect(guarded).toContain('await runSmartGrammarPass(context, selectedText)');
  });

  it('shows the reason when the remote pass does not complete', () => {
    // The reason used to be computed and dropped, so a missing key, a timeout, or a
    // discarded rewrite looked like a clean local-only pass.
    const merge = extension.slice(
      extension.indexOf('const smart = allowSmartGrammar'),
      extension.indexOf('if (editor.document.uri.toString() !== snapshot.uri')
    );
    expect(merge).not.toBe('');
    expect(merge).toContain("notify('information', smart.reason)");
  });

  it('never lets the automatic paragraph checker allow it', () => {
    const scheduler = extension.slice(
      extension.indexOf('function scheduleAutomaticGrammarCheck('),
      extension.indexOf('function currentParagraphRange(')
    );
    expect(scheduler).not.toBe('');
    expect(scheduler).toContain('checkGrammarRange(context, currentEditor, range, false, false, false, false)');
  });

  it('ships on by default', () => {
    // The owner chose this on 2026-08-20, after confirming the feature works. Automatic
    // paragraph checking is unaffected and stays local, which is the assertion above this
    // one, and that is what makes an on-by-default remote pass acceptable here.
    expect(manifest.contributes.configuration.properties['kren.grammar.smart']?.default).toBe(true);
  });

  it('uses the User Dictionary language-model profile and removes the retired settings', () => {
    const smartPass = extension.slice(
      extension.indexOf('async function runSmartGrammarPass('),
      extension.indexOf('async function checkGrammarRange(')
    );
    const retiredSourceNames = ['grammar.smartProvider', 'grammar.smartModel'];
    const retiredManifestNames = retiredSourceNames.map((name) => `kren.${name}`);
    const sourceOccurrences = sourceFiles('src').flatMap((file) => {
      const source = normalizeLineEndings(readFileSync(file, 'utf8'));
      return retiredSourceNames
        .filter((name) => source.includes(name))
        .map((name) => [file, name]);
    });
    const manifestOccurrences = retiredManifestNames.filter((name) =>
      Object.hasOwn(manifest.contributes.configuration.properties, name)
    );

    expect({
      reads: [
        smartPass.includes("'userDictionary.provider'"),
        smartPass.includes("'userDictionary.model'"),
        smartPass.includes("'userDictionary.thinkingOrEffort'")
      ],
      retiredReads: retiredSourceNames.filter((name) => smartPass.includes(`'${name}'`)),
      passesSharedProfile: smartPass.includes('{ provider, model, thinkingOrEffort, apiKey }'),
      sourceOccurrences,
      manifestOccurrences
    }).toEqual({
      reads: [true, true, true],
      retiredReads: [],
      passesSharedProfile: true,
      sourceOccurrences: [],
      manifestOccurrences: []
    });
  });
});

describe('Smart Grammar Check behaviour', () => {
  it('turns the owner sentence into one issue the user can accept', async () => {
    const outcome = await smartGrammarIssues(
      'He showed up my office today',
      SETTINGS,
      new AbortController().signal,
      async () => geminiResponse('He showed up at my office today')
    );

    expect(outcome.status).toBe('completed');
    expect(outcome.status === 'completed' && outcome.issues).toHaveLength(1);
  });

  it('sends the passage and nothing else', async () => {
    let body: Record<string, unknown> = {};
    await smartGrammarIssues(
      'He showed up my office today',
      SETTINGS,
      new AbortController().signal,
      async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return geminiResponse('He showed up at my office today');
      }
    );

    expect(JSON.stringify(body.contents)).toContain('He showed up my office today');
    expect(JSON.stringify(body)).not.toContain('test-key');
  });

  it('discards a restyle rather than presenting it as a grammar fix', async () => {
    const outcome = await smartGrammarIssues(
      'Please send me the report tomorrow.',
      SETTINGS,
      new AbortController().signal,
      async () => geminiResponse('Could you kindly forward the document at your earliest convenience?')
    );

    expect(outcome.status).toBe('discarded');
    expect(outcome.status === 'discarded' && outcome.reason).toContain('rewrote too much');
  });

  it('names a provider failure instead of throwing, so local findings survive', async () => {
    const outcome = await smartGrammarIssues(
      'He showed up my office today',
      SETTINGS,
      new AbortController().signal,
      async () => new Response('{}', { status: 503 })
    );

    expect(outcome.status).toBe('failed');
    expect(outcome.status === 'failed' && outcome.reason).toContain('only local findings are shown');
    // The reason names the provider and the status, never anything the provider returned.
    expect(outcome.status === 'failed' && outcome.reason).not.toContain('showed up');
  });

  it('keeps Harper and drops the model issue when their spans overlap', () => {
    const harper = [harperIssue(3, 9, 'showed')];
    const overlapping: GrammarIssue = {
      ...harperIssue(6, 12, 'wed up'),
      id: 'smart-grammar-6-12-0'
    };
    const separate: GrammarIssue = {
      ...harperIssue(20, 25, 'today'),
      id: 'smart-grammar-20-25-1'
    };

    const merged = mergeSmartGrammarIssues(harper, [overlapping, separate]);
    expect(merged.map((issue) => issue.id)).toEqual(['harper-3', 'smart-grammar-20-25-1']);
  });
});
