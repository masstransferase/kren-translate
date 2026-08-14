import * as esbuild from 'esbuild';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const projectRoot = import.meta.dirname;
const commonOptions = {
  // Pinned to this script's directory rather than left to process.cwd(), so the build
  // does not depend on where it was invoked from.
  //
  // This was added on 2026-08-13 in an attempt to fix the sandboxed
  // `Cannot read directory "../..": Access is denied` failure, and it did not: the next
  // delegated run hit the error 25 times with this in place. The cause is Node's module
  // resolution, which walks upward from the importing file looking for node_modules and
  // therefore reaches this repository's parent no matter what the working directory is.
  // No esbuild option prevents that walk, so the fix belongs in the sandbox, which needs
  // read access to the parent while keeping writes confined. See the harnessing-codex
  // skill for the invocation.
  //
  // Kept because pinning the working directory is correct on its own terms. Recorded
  // because a fix that did not work, left undocumented, gets attempted again.
  absWorkingDir: projectRoot,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: watch,
  minify: !watch,
  logLevel: 'info'
};

const builds = [{
  ...commonOptions,
  entryPoints: [path.join(projectRoot, 'src', 'extension.ts')],
  outfile: path.join(projectRoot, 'dist', 'extension.js'),
  external: ['vscode']
}, {
  ...commonOptions,
  entryPoints: [path.join(projectRoot, 'src', 'workers', 'grammarWorker.ts')],
  outfile: path.join(projectRoot, 'dist', 'grammar-worker.js')
}, {
  ...commonOptions,
  entryPoints: [path.join(projectRoot, 'test', 'integration', 'grammar.test.ts')],
  outfile: path.join(projectRoot, 'dist', 'test', 'grammar.test.js'),
  external: ['vscode']
}];

if (watch) {
  const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
  await Promise.all(contexts.map((context) => context.watch()));
  console.log('Watching Kren Translate sources...');
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
