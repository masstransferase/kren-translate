import { readFileSync, readdirSync } from 'node:fs';
import { load } from 'cheerio';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { createTutorViewState } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

// Added 2026-09-25 for V156. Keep this list about spellings, not words whose American and
// British forms are identical, so identifiers such as `cancellable` need no false-positive
// waiver. The three persisted situation identifiers are removed before checking prose.
const BRITISH_SPELLING = /\b(?:neighbours?|neighbourhood|neighbouring|colours?|coloured|colouring|behaviours?|favours?|favoured|favouring|honours?|honoured|honouring|labours?|laboured|labouring|apologis\w*|organis\w*|recognis\w*|realis(?:e|ed|es|ing)|analys(?:e|ed|es|ing)|summaris\w*|prioritis\w*|capitalis\w*|centres?|centred|centring|defences?|offences?|licences?|practis(?:e|ed|es|ing)|catalogues?|cancelled|cancelling|travelled|travelling|modelled|modelling|(?:re|un)?labelled|(?:re|un)?labelling|judgements?|grey|whilst|amongst|learnt|programmes?)\b/giu;
const IDENTIFIERS = /neighbour-noise|thesis-defence|apologise-late|aria-labelledby/giu;

function prose(value: string): string {
  return value
    .replace(IDENTIFIERS, '')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|\n)\s*\/\/[^\n]*/gu, '$1');
}

function matches(label: string, value: string): string[] {
  return [...prose(value).matchAll(BRITISH_SPELLING)]
    .map((match) => `${label}: ${match[0]}`);
}

function sourceStringMatches(path: string): string[] {
  const sourceText = readFileSync(path, 'utf8');
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      // `cancelled` is a state-machine value, not prose. Renaming it would break command and
      // discriminated-union wiring, just like the three persisted situation identifiers.
      if (node.text !== 'cancelled') hits.push(...matches(`${path}:${line}`, node.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

function descriptionMatches(value: unknown, path = 'package.json'): string[] {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const nextPath = `${path}.${key}`;
    if (key === 'description' && typeof child === 'string') return matches(nextPath, child);
    return descriptionMatches(child, nextPath);
  });
}

describe('reader-facing American English guard', () => {
  it('writes the user guide in American English while exempting persisted identifiers', () => {
    const hits = matches('docs/USER_GUIDE.md', readFileSync('docs/USER_GUIDE.md', 'utf8'));
    expect(hits, hits.join('\n')).toEqual([]);
  });

  it('writes rendered panel text and reader-facing host strings in American English', () => {
    const rendered = renderKrenResultViewHtml({
      cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
      activeScreen: 'tutor', tutor: createTutorViewState(), proModels: []
    });
    const $ = load(rendered);
    $('style, script').remove();
    const attributes = $('[title], [aria-label], [placeholder]').map((_, element) => [
      $(element).attr('title'), $(element).attr('aria-label'), $(element).attr('placeholder')
    ].filter(Boolean).join(' ')).get().join(' ');
    const hits = [
      ...matches('rendered panel', `${$.root().text()} ${attributes}`),
      ...[
        'src/resultViewHtml.ts', ...readdirSync('src')
          .filter((name) => /^resultsView.*\.ts$/u.test(name))
          .sort().map((name) => `src/${name}`), 'src/extension.ts',
        'src/chatTools.ts', 'src/panelSettings.ts'
      ].flatMap(sourceStringMatches)
    ];
    expect(hits, hits.join('\n')).toEqual([]);
  });

  it('writes every model instruction in American English', () => {
    const hits = sourceStringMatches('src/tutor/generation.ts');
    expect(hits, hits.join('\n')).toEqual([]);
  });

  it('writes every VS Code configuration description in American English', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as unknown;
    const hits = descriptionMatches(manifest);
    expect(hits, hits.join('\n')).toEqual([]);
  });
});
