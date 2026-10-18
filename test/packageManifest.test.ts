// 2026-10-10: V216 renames reader-facing Gemini profiles Free Tier and Paid; exact expectations follow the brief.
import { TUTOR_DEFAULTS } from '../src/tutor/defaults.js';
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REWRITE_AXIS_SETTINGS,
  REWRITE_OTHER_LANGUAGES,
  REWRITE_RHETORICAL_MODES
} from '@kren/core/rewrite-axes';
import { GRAMMAR_INPUT_LANGUAGES } from '@kren/core/contracts';
import { USER_DICTIONARY_MAX_IMPORT_ENTRIES } from '@kren/core/user-dictionary';
// 2026-10-11: V219 extends the frozen Core provider enum in the host adapter.
import {
  USER_DICTIONARY_CAPTURE_MODES,
  USER_DICTIONARY_MANUAL_CAPTURE_MODE,
  USER_DICTIONARY_PROVIDERS
} from '../src/userDictionary/providerContract.js';
import {
  USER_DICTIONARY_EXAMPLE_COUNTS,
  USER_DICTIONARY_PROVIDER_CAPTURE_MODES,
  USER_DICTIONARY_THINKING_OR_EFFORTS
} from '../src/userDictionary/settings.js';

interface MenuItem {
  command?: string;
  submenu?: string;
  when?: string;
  group?: string;
}

interface Manifest {
  version: string;
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
  it('declares the model for Fast tutor steps with the Thorough fallback', () => {
    const hintModel = manifest.contributes.configuration.properties['kren.tutor.hintModel'];
    // Changed 2026-10-03: Hint follows the current tutor default.
    expect(hintModel?.default).toBe(TUTOR_DEFAULTS.configuration['tutor.hintModel']);
    expect(hintModel?.description).toContain('Leave empty');
    // 2026-10-12: Fast steps use Thorough when the Fast model is empty.
    expect(hintModel?.description).toMatch(/use the Thorough model/u);
  });

  it('keeps noisy-room Press to talk absent from behaviour until the reader enables it', () => {
    const setting = manifest.contributes.configuration.properties[
      'kren.tutor.conversation.pressToTalk'
    ];
    expect(setting?.default).toBe(false);
    // 2026-10-12: The description names the next conversation and the two-press action.
    expect(setting?.description).toMatch(/next conversation/u);
    expect(setting?.description).toMatch(/once.*start.*again.*finish/u);
  });

  it('uses language-workbench metadata and opens KREN in the Secondary Sidebar', () => {
    // Two channels, two publishers. The sideloaded build publishes as "local"; the
    // produced public tree is rewritten to "masstransferase", because the Marketplace
    // requires the manifest to match the account. Pinning either one here fails in the
    // other tree, and this file is copied into both.
    expect(['local', 'masstransferase']).toContain(manifest.publisher);
    /*
     * Education first, at the owner's request on 2026-09-01, because the AI English
     * Tutor is what the extension is becoming and it is the category a learner browses.
     * Order is what the Marketplace shows first, so it is asserted rather than sorted.
     */
    expect(manifest.categories).toEqual(['Education', 'Other']);
    expect(manifest.keywords).toEqual(expect.arrayContaining(['language', 'productivity']));
    expect(manifest.engines.vscode).toBe('^1.106.0');
    expect(manifest.activationEvents).toEqual(['onStartupFinished']);
    /*
     * On since 1.7.9, when the owner asked for their current settings to become KREN's
     * declared defaults. It is a checkpoint rather than a preference: `STARTUP_SIDEBAR_TEST_1.0.4.md`
     * records a Windows boot problem investigated against this preference on 2026-07-31 and
     * concludes that it "may be enabled or disabled according to user preference while Fast
     * Startup remains disabled". The finding was that Windows Fast Startup decided the
     * problem and this setting did not, and the recorded faulting module was the Intel
     * graphics kernel driver, which KREN does not load. Moving this default without reading
     * that record is what the assertion exists to prevent.
     */
    expect(
      manifest.contributes.configuration.properties['kren.results.openAtStartup']?.default
    ).toBe(true);
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
    expect(titles.get('kren.setGeminiApiKey')).toBe('Set Gemini Free Tier API Key');
    expect(titles.get('kren.deleteGeminiApiKey')).toBe('Delete Gemini Free Tier API Key');
    expect(titles.get('kren.deleteAllApiKeys')).toBe('Delete All Stored API Keys');
    expect(manifest.contributes.configuration.properties['kren.explanation.geminiProfile']?.default)
      .toBe('standard');
    expect(manifest.contributes.configuration.properties['kren.rewrite.englishVariety']?.default)
      .toBe('sameAsSource');
  });

  // Adding Auto-detect to the setting, the panel select, and the manifest still left the
  // panel rejecting it, because the validator carried a fourth hand-written copy of the list
  // and nothing compared them. The reader saw "KREN rejected an invalid value for
  // grammar.dialect" and the control snapped back to American English.
  it('keeps the Other output language enum aligned with core', () => {
    const property = manifest.contributes.configuration.properties['kren.rewrite.otherOutputLanguage'];
    expect(property?.enum).toEqual(REWRITE_OTHER_LANGUAGES.map((language) => language.id));
    expect(property?.enumDescriptions)
      .toEqual(REWRITE_OTHER_LANGUAGES.map((language) => language.label));
    // Not the first entry, deliberately: the default has to be a language, and Arabic is
    // first only because the list is alphabetical.
    expect(REWRITE_OTHER_LANGUAGES.map((language) => language.id))
      .toContain(property?.default);
  });

  it('keeps the Grammar Check input language list in one place, not four', () => {
    expect(manifest.contributes.configuration.properties['kren.grammar.dialect']?.enum)
      .toEqual([...GRAMMAR_INPUT_LANGUAGES]);
    expect(manifest.contributes.configuration.properties['kren.grammar.dialect']?.default)
      .toBe(GRAMMAR_INPUT_LANGUAGES[0]);
    expect(
      manifest.contributes.configuration.properties['kren.grammar.dialect']?.enumDescriptions
    ).toHaveLength(GRAMMAR_INPUT_LANGUAGES.length);

    // The panel validator must ask the shared predicate rather than list the values again.
    const settings = readFileSync('src/panelSettings.ts', 'utf8');
    const validator = settings.slice(
      settings.indexOf("if (key === 'grammar.dialect')"),
      settings.indexOf("if (key === 'grammar.autoCheckDelayMs')")
    );
    expect(validator).not.toBe('');
    expect(validator).toContain('isGrammarInputLanguage(value)');
    expect(validator).not.toContain("'american'");

    // And so must the panel select, which is what the reader actually clicks.
    const panel = readFileSync('src/resultViewHtml.ts', 'utf8');
    for (const language of GRAMMAR_INPUT_LANGUAGES) {
      expect(panel, `${language} is missing from the Input language select`)
        .toContain(`['${language}', `);
    }
  });

  it('keeps every rewrite configuration enum in exact axis-array order', () => {
    for (const axis of REWRITE_AXIS_SETTINGS) {
      expect(
        manifest.contributes.configuration.properties[`kren.${axis.key}`]?.enum,
        `${axis.key} drifted from its TypeScript source of truth`
      ).toEqual(axis.values.map((option) => option.id));
      /*
       * One of the axis values, not necessarily the first.
       *
       * It was pinned to the first until 1.7.9, which read as a rule and was really a
       * coincidence: every axis happened to open with `preserve`. When the owner made their
       * own settings the defaults, Formality became `neutral` and Stance `direct`, and the
       * assertion failed on a deliberate choice rather than on drift. Membership is what
       * actually guards against drift, because a default outside the array is a default the
       * control cannot show.
       */
      const declared = manifest.contributes.configuration.properties[`kren.${axis.key}`]?.default;
      expect(
        axis.values.map((option) => option.id),
        `${axis.key} default is not one of its axis values`
      ).toContain(declared);
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

  // `satisfies` on the source array rejects a wrong or renamed mode but says nothing about
  // an omitted one, so a capture mode added to core would silently never reach the setting.
  it('offers every capture mode core defines except the manual one', () => {
    expect([...USER_DICTIONARY_PROVIDER_CAPTURE_MODES]).toEqual(
      USER_DICTIONARY_CAPTURE_MODES.filter((mode) => mode !== USER_DICTIONARY_MANUAL_CAPTURE_MODE)
    );
  });

  it('keeps every User Dictionary configuration enum in exact source-array order', () => {
    const properties = manifest.contributes.configuration.properties;
    expect(properties['kren.userDictionary.defaultCaptureMode']?.enum)
      .toEqual([...USER_DICTIONARY_PROVIDER_CAPTURE_MODES]);
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
    // Changed 2026-10-02: ordinary growth passed 1 MB at 1.99.26; Harper alone is over 20 MB,
    // so 2 MB still catches it leaking into the main bundle.
    expect(statSync('dist/extension.js').size).toBeLessThan(2_000_000);
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

  it('names user-supplied Gemini credentials Free Tier and Paid', () => {
    const geminiCommands = manifest.contributes.commands.filter((command) =>
      /gemini/iu.test(command.command)
    );
    const geminiSettings = Object.entries(manifest.contributes.configuration.properties)
      .filter(([key]) => /gemini/iu.test(key))
      .map(([, value]) => value);
    const publicGeminiText = JSON.stringify({ geminiCommands, geminiSettings });
    // 2026-10-10: V216 names the two credential profiles Free Tier and Paid at the owner's request.
    expect(publicGeminiText).toContain('Gemini Free Tier');
    expect(publicGeminiText).toContain('Gemini Paid API Key');
  });
});

describe('the version is one fact', () => {
  // docs/RELEASE_PROCESS.md step 2 requires npm version to update package.json and
  // package-lock.json together. On 2026-08-22 three releases were cut by editing
  // package.json as text, so the lockfile sat at 1.3.3 while the manifest said 1.3.6 and
  // the produced public tree carried the mismatch into a release candidate. npm ci does
  // not object, and the VSIX takes its name from the manifest, so nothing failed.
  //
  // One fact in two files, which is this codebase's recurring defect, so it gets the
  // same treatment as the others: a check rather than a habit.
  it('agrees between the manifest and the lockfile', () => {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };

    expect(lock.version, 'package-lock.json version').toBe(manifest.version);
    // npm writes the root package a second time under packages[""], and npm version
    // updates both. A text edit updates neither, and a careless fix updates one.
    expect(lock.packages['']?.version, 'package-lock.json packages[""] version')
      .toBe(manifest.version);
  });
});
