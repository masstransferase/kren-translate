import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { load } from 'cheerio';
import { mountedPanel } from './mountedPanel.js';
import { PANEL_SETTINGS_FIXTURE } from './panelSettingsFixture.js';
import type { renderKrenResultViewHtml } from '../../src/resultViewHtml.js';

/** Check executable output, including copied function bodies and any esbuild helpers. */
export function assertEmbeddedScriptBindings(html: string): void {
  const $ = load(html);
  const script = $('script').map((_, node) => $(node).text()).get().join('\n;\n');
  const file = path.resolve('kren-production-panel.js').replaceAll('\\', '/');
  const declarations = path.resolve('kren-production-panel-host.d.ts').replaceAll('\\', '/');
  const options: ts.CompilerOptions = { allowJs: true, checkJs: true, noEmit: true,
    target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: [] };
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (name === file) return ts.createSourceFile(name, script, languageVersion, true, ts.ScriptKind.JS);
    if (name === declarations) return ts.createSourceFile(name,
      'declare function acquireVsCodeApi(): any;', languageVersion, true);
    return originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  };
  const program = ts.createProgram([file, declarations], options, host);
  const page = program.getSourceFile(file);
  assert.ok(page, 'The binding guard must load the generated page script');
  assert.deepEqual(program.getSyntacticDiagnostics(page), [], 'The shipped scripts must parse');
  // Other checkJs diagnostics describe the intentionally untyped DOM script. These
  // diagnostics specifically identify names without a lexical or browser binding.
  const unbound = program.getSemanticDiagnostics(page).filter(diagnostic =>
    [2304, 2552, 2663].includes(diagnostic.code) ||
    ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ').startsWith('Cannot find name'));
  assert.deepEqual(unbound.map(diagnostic => {
    const { line, character } = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start!);
    return `${line + 1}:${character + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`;
  }), [], 'Every identifier in the shipped embedded scripts must resolve locally, in the page, or to a browser/VS Code global');
}

export function productionPanelHtml(bundle: string): string {
  const require = createRequire(path.resolve('package.json'));
  const built = require(bundle) as { renderKrenResultViewHtml: typeof renderKrenResultViewHtml };
  return built.renderKrenResultViewHtml({ nonce: 'production-test', cspSource: 'test',
    settings: PANEL_SETTINGS_FIXTURE, proModels: [] });
}

/** Run the actual minified renderer's scripts, never a source-text substitute. */
export function checkProductionPanelNotices(bundle: string): void {
  const html = productionPanelHtml(bundle);
  const messages: Record<string, unknown>[] = [];
  const panel = mountedPanel(html, message => { messages.push(message); });
  for (const [index, choices] of [[], ['Reset panel', 'Reset everything']].entries()) {
    const id = index + 1;
    const before = messages.length;
    // V267 routes real questions to VS Code. The deliberate low-level choice
    // payload also proves the renderer cannot resurrect the old minifier failure.
    const detail = index === 0 ? 'Production detail' : 'Production detail'.repeat(8);
    panel.message({ command: 'panelNotice', notice: { id, kind: 'error', message: `Production notice ${id}`,
      detail, modal: choices.length > 0, choices } });
    const card = panel.query('[data-kren-notice]');
    const errors = messages.slice(before).filter(message => message.command === 'panelScriptError' ||
      message.command === 'panelNoticeNotShown');
    assert.deepEqual(errors, [], 'The minified page must report no notice exception');
    assert.ok(card?.isConnected, 'The minified page must display the notice');
    assert.equal(card.closest('details, [hidden], .hidden'), null, 'The status popup must be reachable');
    assert.match(card.textContent, new RegExp(`Production notice ${id}`));
    assert.equal(card.querySelector('.notice-card')?.classList.contains('popup-long-message'), index > 0);
    assert.equal(panel.document.activeElement?.textContent, 'OK');
    assert.ok(messages.slice(before).some(message => message.command === 'panelNoticeShown' &&
      message.id === id && message.visible === true));
    panel.key('Tab'); assert.equal(panel.document.activeElement?.textContent, 'OK');
    panel.key('Escape'); assert.equal(panel.query('[data-kren-notice]'), null);
  }
  // A JavaScript error may be reported by the independent listener after startup.
  assert.equal(messages.some(message => message.command === 'panelScriptError'), false);
}

/** Static guard inputs are generated by the built renderer, not source files. */
export function checkProductionPanelBindings(bundle: string): void {
  assertEmbeddedScriptBindings(productionPanelHtml(bundle));
}
