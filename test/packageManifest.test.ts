import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface MenuItem {
  command?: string;
  submenu?: string;
  when?: string;
}

interface Manifest {
  publisher: string;
  activationEvents: string[];
  categories: string[];
  keywords: string[];
  engines: { vscode: string };
  capabilities: {
    untrustedWorkspaces: {
      supported: string;
      restrictedConfigurations: string[];
    };
    virtualWorkspaces: { supported: boolean };
  };
  contributes: {
    commands: Array<{ command: string; title: string; shortTitle?: string }>;
    submenus: Array<{ id: string; label: string }>;
    menus: Record<string, MenuItem[]>;
    keybindings: Array<{ command: string; key: string; when: string }>;
    configuration: {
      properties: Record<string, {
        default?: unknown;
        scope?: string;
        description?: string;
        enumDescriptions?: string[];
      }>;
    };
    languageModelTools: Array<{ name: string; modelDescription: string }>;
    viewsContainers: Record<string, Array<{ id: string; title: string }>>;
  };
}

const manifest = JSON.parse(
  readFileSync('package.json', 'utf8')
) as Manifest;

describe('VS Code menu contributions', () => {
  it('uses language-workbench metadata and opens KREN in the Secondary Sidebar', () => {
    expect(manifest.publisher).toBe('local');
    expect(manifest.categories).toEqual(['Other']);
    expect(manifest.keywords).toEqual(expect.arrayContaining(['language', 'productivity']));
    expect(manifest.engines.vscode).toBe('^1.106.0');
    expect(manifest.activationEvents).toEqual(['onStartupFinished']);
    expect(
      manifest.contributes.configuration.properties['kren.results.openAtStartup']?.default
    ).toBe(false);
    expect(manifest.contributes.viewsContainers.secondarySidebar).toContainEqual({
      id: 'kren-results',
      title: 'KREN',
      icon: 'media/kren-book.svg'
    });
    expect(manifest.contributes.viewsContainers.panel).toBeUndefined();
    expect(
      (manifest.contributes as unknown as {
        views: Record<string, Array<{ id: string; when?: string }>>;
      }).views['kren-results']
    ).toContainEqual(expect.objectContaining({
      id: 'kren.resultsView',
      when: 'kren.resultsEnabled'
    }));
  });

  it('exposes accurate Gemini and credential-deletion commands', () => {
    const titles = new Map(
      manifest.contributes.commands.map((command) => [command.command, command.title])
    );
    expect(titles.get('kren.setGeminiApiKey')).toBe('Set Default Gemini API Key');
    expect(titles.get('kren.deleteGeminiApiKey')).toBe('Delete Default Gemini API Key');
    expect(titles.get('kren.deleteAllApiKeys')).toBe('Delete All Stored API Keys');
    expect(manifest.contributes.configuration.properties['kren.explanation.geminiProfile']?.default)
      .toBe('standard');
    expect(manifest.contributes.configuration.properties['kren.rewrite.englishVariety']?.default)
      .toBe('followGrammar');
  });

  it('groups dictionaries in the requested order', () => {
    expect(manifest.contributes.submenus).toContainEqual({
      id: 'kren.dictionaryMenu',
      label: 'Dictionary Search'
    });
    expect(manifest.contributes.menus['kren.dictionaryMenu']?.map((item) => item.command)).toEqual([
      'kren.dictionarySearchSelection',
      'kren.synonymsSearchSelection',
      'kren.lookupMedicalSelection',
      'kren.koreanDictionarySearchSelection'
    ]);
    const shortTitles = new Map(
      manifest.contributes.commands.map((command) => [command.command, command.shortTitle])
    );
    expect([...shortTitles.entries()].filter(([command]) => [
      'kren.dictionarySearchSelection',
      'kren.synonymsSearchSelection',
      'kren.lookupMedicalSelection',
      'kren.koreanDictionarySearchSelection'
    ].includes(command))).toEqual([
      ['kren.dictionarySearchSelection', 'English Dictionary'],
      ['kren.koreanDictionarySearchSelection', 'Korean Dictionary'],
      ['kren.lookupMedicalSelection', 'Medical Dictionary'],
      ['kren.synonymsSearchSelection', 'Synonyms']
    ]);
    expect(manifest.contributes.languageModelTools.map((tool) => tool.name))
      .toContain('kren_lookupMedicalDictionary');
  });

  it('uses Escape only while KREN speech is active', () => {
    const editorMenu = manifest.contributes.menus['editor/context'] ?? [];
    expect(editorMenu.some((item) => item.command === 'kren.stopReadAloud')).toBe(false);
    expect(manifest.contributes.keybindings).toContainEqual({
      command: 'kren.stopReadAloud',
      key: 'escape',
      when: 'kren.readAloudActive'
    });
  });

  it('keeps automatic grammar checking opt-in and exposes local reset commands', () => {
    expect(manifest.contributes.configuration.properties['kren.grammar.autoCheck']?.default).toBe(false);
    const commands = manifest.contributes.commands.map((command) => command.command);
    expect(commands).toEqual(expect.arrayContaining([
      'kren.clearGrammarFindings',
      'kren.clearGrammarCustomDictionary',
      'kren.clearIgnoredGrammarFindings'
    ]));
  });

  it('isolates Harper from the main extension bundle', () => {
    expect(statSync('dist/extension.js').size).toBeLessThan(1_000_000);
    expect(statSync('dist/grammar-worker.js').size).toBeGreaterThan(1_000_000);
  });

  it('fails closed when the packaged grammar worker is missing', () => {
    const source = readFileSync('src/providers/harperGrammar.ts', 'utf8');
    expect(source).not.toContain("path.resolve(process.cwd(), 'dist', 'grammar-worker.js')");
    expect(source).toContain('KREN grammar worker is missing from the extension installation');
  });

  it('requires Workspace Trust for the configurable Edge Python executable', () => {
    expect(manifest.capabilities.untrustedWorkspaces.supported).toBe('limited');
    expect(manifest.capabilities.untrustedWorkspaces.restrictedConfigurations).toContain(
      'kren.readAloud.edgePythonCommand'
    );
    expect(manifest.capabilities.virtualWorkspaces.supported).toBe(false);
    expect(
      manifest.contributes.configuration.properties['kren.readAloud.edgePythonCommand']?.scope
    ).toBe('machine');
  });

  it('describes every configurable explanation provider before chat tool use', () => {
    const tool = manifest.contributes.languageModelTools.find(
      (candidate) => candidate.name === 'kren_explainText'
    );
    expect(tool?.modelDescription).toContain('Gemini');
    expect(tool?.modelDescription).toContain('OpenAI API');
    expect(tool?.modelDescription).toContain('Anthropic Claude API');
  });

  it('does not classify user-supplied Gemini credentials as free or paid', () => {
    const geminiCommands = manifest.contributes.commands.filter((command) =>
      /gemini/iu.test(command.command)
    );
    const geminiSettings = Object.entries(manifest.contributes.configuration.properties)
      .filter(([key]) => /gemini/iu.test(key))
      .map(([, value]) => value);
    const publicGeminiText = JSON.stringify({ geminiCommands, geminiSettings });
    expect(publicGeminiText).not.toMatch(/free[ -]?tier|paid gemini|paid profile/iu);
    expect(publicGeminiText).toContain('Alternate Gemini API Key');
  });
});
