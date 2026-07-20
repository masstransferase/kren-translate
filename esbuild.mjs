import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
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
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  external: ['vscode']
}, {
  ...commonOptions,
  entryPoints: ['src/workers/grammarWorker.ts'],
  outfile: 'dist/grammar-worker.js'
}, {
  ...commonOptions,
  entryPoints: ['test/integration/grammar.test.ts'],
  outfile: 'dist/test/grammar.test.js',
  external: ['vscode']
}];

if (watch) {
  const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
  await Promise.all(contexts.map((context) => context.watch()));
  console.log('Watching Kren Translate sources...');
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
