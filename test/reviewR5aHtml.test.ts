import { describe, expect, it } from 'vitest';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import ts from 'typescript';

function scriptBranch(condition: string): string {
  const html = renderKrenResultViewHtml({ cspSource: 'local', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE, proModels: [] });
  const script = html.match(/<script nonce="test">([\s\S]*?)<\/script>/u)?.[1] ?? '';
  const source = ts.createSourceFile('panel.js', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let found = '';
  const visit = (node: ts.Node) => {
    if (ts.isIfStatement(node) && node.expression.getText(source).includes(condition) && !found) found = node.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!found) throw new Error(`Missing panel branch ${condition}`);
  return found;
}

describe('R5a finding 2: bundled Merriam-Webster logos', () => {
  it('allows no remote image origin and renders only local image sources', () => {
    const html = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
      merriamWebsterLogoUris: { light: 'vscode-webview://test/light.png', dark: 'vscode-webview://test/dark.png' },
      autoplayAudio: { url: 'https://media.merriam-webster.com/audio/prons/en/us/mp3/h/hello001.mp3', headword: 'hello' },
      proModels: [], sourceText: 'hello', result: {
        kind: 'dictionary', providerId: 'merriamWebsterCollegiate', sourceText: 'hello',
        sourceLanguage: 'en', targetLanguage: 'en', headword: 'hello', entries: [], createdAt: new Date().toISOString()
      }
    });
    const policy = html.match(/img-src ([^;]+);/u)?.[1];
    expect(policy).toBeDefined();
    expect(policy).not.toMatch(/https?:/u);
    expect(html).toContain('src="vscode-webview://test/light.png"');
    expect(html).toContain('src="vscode-webview://test/dark.png"');
    expect([...html.matchAll(/<[^>]+\ssrc="([^"]+)"/gu)].map((match) => match[1]))
      .not.toEqual(expect.arrayContaining([expect.stringMatching(/^https:\/\//u)]));
  });
});

describe('R5a finding 5: visible purge period', () => {
  it('posts the period beside the clicked control despite a hidden Settings selector', () => {
    class Select { constructor(public value: string) {} }
    const hidden = new Select('olderThan3Months'), visible = new Select('olderThan1Year');
    const postMessage = (value: unknown) => { posted = value; };
    let posted: unknown;
    new Function('document', 'target', 'command', 'HTMLSelectElement', 'vscode', scriptBranch("command === 'previewUserDictionaryPurge'"))(
      { querySelector: () => hidden }, { closest: () => ({ querySelector: () => visible }) },
      'previewUserDictionaryPurge', Select, { postMessage }
    );
    expect(posted).toEqual({ command: 'previewUserDictionaryPurge', purgeSelection: 'olderThan1Year' });
  });
});

describe('R5a finding 17: custom model field belongs to its routing group', () => {
  it('reveals and focuses the User Dictionary field with a Grammar field earlier in the document', () => {
    class Element { hidden = true; querySelector() { return field; } }
    class Input { focus = () => { focused = true; }; }
    class Select {
      value = '__custom__'; hasAttribute() { return true; }
      getAttribute() { return 'userDictionary.model'; }
      closest() { return { querySelector: () => dictionary }; }
    }
    let focused = false;
    const field = new Input(), grammar = new Element(), dictionary = new Element();
    new Function('target', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'vscode', scriptBranch("target.hasAttribute('data-model-preset')"))(
      new Select(), { querySelector: () => grammar }, Element, Input, Select, { postMessage() {} }
    );
    expect(dictionary.hidden).toBe(false);
    expect(grammar.hidden).toBe(true);
    expect(focused).toBe(true);
  });
});

describe('R5a finding 20: speech selectors show valid nonpreset values', () => {
  it('selects the stored Edge speed 50 and Windows rate 1', () => {
    const html = renderKrenResultViewHtml({ cspSource: 'local', nonce: 'test', proModels: [], activeScreen: 'settings',
      settings: { ...PANEL_SETTINGS_FIXTURE, edgeReadAloudRatePercent: 50, readAloudRate: 1 } });
    for (const [key, value] of [['readAloud.edgeRatePercent', '50'], ['readAloud.rate', '1']]) {
      const select = [...html.matchAll(/<select[^>]*data-setting="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gu)]
        .find((match) => match[1] === key)?.[2];
      expect(select).toBeDefined();
      expect(select).toContain(`value="${value}" selected`);
    }
  });
});
