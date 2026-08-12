import * as esbuild from 'esbuild';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const projectRoot = import.meta.dirname;
const commonOptions = {
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
