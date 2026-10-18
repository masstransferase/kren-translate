import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { assertEmbeddedScriptBindings, checkProductionPanelBindings, checkProductionPanelNotices } from './support/productionPanelChecks.js';

let directory: string;
let bundle: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'kren-v267-production-'));
  bundle = path.join(directory, 'panel.cjs');
  // Match esbuild.mjs's production options, including identifier minification.
  await build({ absWorkingDir: process.cwd(), entryPoints: ['src/resultViewHtml.ts'], outfile: bundle,
    bundle: true, format: 'cjs', platform: 'node', target: 'node20', minify: true,
    sourcemap: false, external: ['vscode'], logLevel: 'silent' });
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

it('executes no-choice and injected choice notices from the production-minified renderer', () => {
  checkProductionPanelNotices(bundle);
});
it('resolves every identifier in the production renderer embedded scripts', () => {
  checkProductionPanelBindings(bundle);
});
it('rejects module-only helpers and Node globals in copied page functions', () => {
  for (const identifier of ['moduleOnlyHelper', '__name', 'process']) {
    expect(() => assertEmbeddedScriptBindings(`<script>function copied() { ${identifier}(); }</script>`))
      .toThrow(new RegExp(identifier));
  }
});
it('accepts parameters, locals, browser globals, and same-page function bindings', () => {
  assertEmbeddedScriptBindings(`<script>
    const helper = value => String(value);
    function copied(document) {
      const local = value => helper(value);
      document.body.textContent = local('Ready');
    }
  </script>`);
});
