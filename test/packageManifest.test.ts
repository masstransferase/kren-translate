import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REWRITE_AXIS_SETTINGS,
  REWRITE_RHETORICAL_MODES
} from '../src/rewriteAxes.js';
import { USER_DICTIONARY_MAX_IMPORT_ENTRIES } from '../src/userDictionary/importExport.js';
import {
  USER_DICTIONARY_CAPTURE_MODES,
  USER_DICTIONARY_PROVIDERS
} from '../src/userDictionary/contract.js';
import {
  USER_DICTIONARY_EXAMPLE_COUNTS,
  USER_DICTIONARY_THINKING_OR_EFFORTS
} from '../src/userDictionary/settings.js';

interface MenuItem {
  command?: string;
  submenu?: string;
  when?: string;
  group?: string;
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
    commands: Array<{ command: string; title: string; shortTitle?: string; enablement?: string }>;
    submenus: Array<{ id: string; label: string }>;
    menus: Record<string, MenuItem[]>;
    keybindings: Array<{ command: string; key: string; when: string }>;
    configuration: {
      properties: Record<string, {
        default?: unknown;
        scope?: string;
        description?: string;
        enum?: unknown[];
        enumDescriptions?: string[];
      }>;
    };
    languageModelTools: Array<{ name: string; modelDescription: string }>;
    viewsContainers: Record<string, Array<{ id: string; title: string }>>;
  };
  scripts: Record<string, string>;
}

const manifest = JSON.parse(
  readFileSync('package.json', 'utf8')
) as Manifest;

describe('VS Code menu contributions', () => {
  it('uses language-workbench metadata and opens KREN in the Secondary Sidebar', () => {
    // Two channels, two publishers. The sideloaded build publishes as "local"; the
    // produced public tree is rewritten to "masstransferase", because the Marketplace
    // requires the manifest to match the account. Pinning either one here fails in the
    // other tree, and this file is copied into both.
    expect(['local', 'masstransferase']).toContain(manifest.publisher);
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

  it('keeps every rewrite configuration enum in exact axis-array order', () => {
    for (const axis of REWRITE_AXIS_SETTINGS) {
      expect(
        manifest.contributes.configuration.properties[`kren.${axis.key}`]?.enum,
        `${axis.key} drifted from its TypeScript source of truth`
      ).toEqual(axis.values.map((option) => option.id));
      expect(
        manifest.contributes.configuration.properties[`kren.${axis.key}`]?.default,
        `${axis.key} default is not the first axis value`
      ).toBe(axis.values[0].id);
    }
  });

  it('derives the rhetorical-mode manifest values from its axis array', () => {
    const rhetoricalMode = manifest.contributes.configuration.properties[
      'kren.rewrite.rhetoricalMode'
    ];
    expect(rhetoricalMode?.enum).toEqual(
      REWRITE_RHETORICAL_MODES.map((option) => option.id)
    );
    expect(rhetoricalMode?.default).toBe(REWRITE_RHETORICAL_MODES[0].id);
    expect(rhetoricalMode?.enumDescriptions).toHaveLength(REWRITE_RHETORICAL_MODES.length);
  });

  it('keeps every User Dictionary configuration enum in exact source-array order', () => {
    const properties = manifest.contributes.configuration.properties;
    expect(properties['kren.userDictionary.defaultCaptureMode']?.enum)
      .toEqual([...USER_DICTIONARY_CAPTURE_MODES]);
    expect(properties['kren.userDictionary.provider']?.enum)
      .toEqual([...USER_DICTIONARY_PROVIDERS]);
    expect(properties['kren.userDictionary.thinkingOrEffort']?.enum)
      .toEqual(USER_DICTIONARY_THINKING_OR_EFFORTS.map((option) => option.id));
    expect(properties['kren.userDictionary.numberOfExamples']?.enum)
      .toEqual(USER_DICTIONARY_EXAMPLE_COUNTS.map((option) => option.id));
  });

  // The refusal message names this setting, so a message promising a knob that does not
  // exist is worse than no knob. The default is asserted against the constant rather than
  // the literal 5000, which is the rule everywhere else here.
  it('derives the import ceiling default from its constant', () => {
    const ceiling = manifest.contributes.configuration.properties[
      'kren.userDictionary.maxImportEntries'
    ];
    expect(ceiling, 'the message names a setting the manifest does not declare')
      .toBeDefined();
    expect(ceiling?.default).toBe(USER_DICTIONARY_MAX_IMPORT_ENTRIES);
  });

  it('makes both User Dictionary commands unavailable while the feature is disabled', () => {
    const commands = manifest.contributes.commands.filter((command) =>
      command.command === 'kren.addToUserDictionary' ||
      command.command === 'kren.openUserDictionary'
    );
    expect(commands).toHaveLength(2);
    expect(commands.every((command) =>
      command.enablement === 'config.kren.userDictionary.enabled'
    )).toBe(true);
    const editorItems = manifest.contributes.menus['editor/context'] ?? [];
    expect(editorItems.filter((item) =>
      item.command === 'kren.addToUserDictionary' ||
      item.command === 'kren.openUserDictionary'
    )).toEqual([
      {
        command: 'kren.addToUserDictionary',
        when: 'editorHasSelection && config.kren.userDictionary.enabled',
        group: 'kren_userDictionary@10'
      },
      {
        command: 'kren.openUserDictionary',
        when: 'config.kren.userDictionary.enabled',
        group: 'kren_userDictionary@20'
      }
    ]);
  });

  it('does not contribute a stored rewrite mode setting', () => {
    expect(manifest.contributes.configuration.properties)
      .not.toHaveProperty('kren.rewrite.mode');
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

  // A VSIX built on 2026-08-13 shipped a dist/extension.js that predated the last two
  // features, because `vsce package` was run directly instead of through `npm run
  // package` and nothing made it compile first. vsce runs vscode:prepublish on every
  // invocation, so defining it there is what closes the hole; this test is what stops
  // the script being moved back into a wrapper that is easy to bypass.
  it('compiles on every vsce invocation rather than only through the package script', () => {
    expect(manifest.scripts['vscode:prepublish']).toBe('npm run compile');
    expect(manifest.scripts.package).not.toContain('npm run compile');
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
