import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  files: 'dist/test/**/*.test.js',
  extensionDevelopmentPath: fileURLToPath(new URL('.', import.meta.url)),
  launchArgs: ['--disable-extensions'],
  mocha: { timeout: 60000 }
});
