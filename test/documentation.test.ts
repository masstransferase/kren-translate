import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const guide = readFileSync('docs/USER_GUIDE.md', 'utf8');
const skippedDirectories = new Set(['.git', '.vscode-test', 'coverage', 'dist', 'node_modules']);

function filesWithExtension(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return skippedDirectories.has(entry.name) ? [] : filesWithExtension(path, extension);
    }
    return entry.isFile() && entry.name.endsWith(extension) ? [path] : [];
  });
}

const publicSurfaceFiles = [
  'BRAND_ASSETS.md',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'PRIVACY.md',
  'README.md',
  'SECURITY.md',
  'SUPPORT.md',
  'THIRD_PARTY_NOTICES.md',
  'package.json',
  ...filesWithExtension('docs', '.md').filter((file) => !file.endsWith('RELEASE_CHECKLIST.md')),
  ...filesWithExtension('.github', '.md'),
  ...filesWithExtension('.github', '.yml'),
  ...filesWithExtension('.github', '.yaml')
];

describe('KREN User Guide', () => {
  it('retains every essential manual section', () => {
    for (const heading of [
      'Requirements',
      'Install and first setup',
      'Quick start',
      'KREN panel and navigation',
      'Dictionaries',
      'Grammar Check',
      'Translation',
      'Explain Meaning or Nuance',
      'Rewrite / Polish Text',
      'Pronunciation and Read Aloud',
      'Settings reference',
      'Native VS Code language-model tools',
      'Privacy, storage, limits, and cost',
      'Troubleshooting',
      'Clear data and uninstall',
      'Known limitations'
    ]) {
      expect(guide).toContain(`## ${heading}`);
    }
  });

  it('documents platform, credential, network, cost, and optional dependency boundaries', () => {
    for (const requirement of [
      'VS Code Desktop 1.106 or later',
      'No Node.js, npm, Python, GPU, or API key is required',
      'Merriam-Webster Collegiate API key',
      'Merriam-Webster Collegiate Thesaurus API key',
      'Korean Basic Dictionary Open API key',
      'Google Cloud Translation Basic v2',
      'Gemini, OpenAI API, or Anthropic API key',
      'local Windows extension host',
      'python -m pip install edge-tts',
      '500,000',
      '5,000',
      '45 seconds',
      'WSL, SSH, Dev Containers, Codespaces'
    ]) {
      expect(guide).toContain(requirement);
    }
    expect(guide).toContain('Every user must obtain and enter their own API keys');
    expect(guide).toContain('KREN includes no shared credentials');
    expect(guide).toContain('KREN makes no service-tier claim');
    expect(guide).toContain('Gemini API users to be at least 18');
    expect(guide).toContain('professional or business purposes');
    expect(guide).toContain('Delete all stored API keys');
    expect(guide).toContain('https://ai.google.dev/gemini-api/docs/available-regions');
    expect(guide).not.toMatch(/Free API|Paid Gemini/iu);
    expect(guide).not.toContain('Medical Dictionary');
  });

  it('omits private preview history from the public changelog', () => {
    const changelog = readFileSync('CHANGELOG.md', 'utf8');
    expect(changelog).not.toContain('Pre-public development');
    expect(changelog).not.toMatch(/0\.1\.0|0\.14\.1/u);
  });

  it('contains no obvious encoding corruption', () => {
    expect(guide).not.toContain('\uFFFD');
    expect(guide).not.toContain('??');
  });

  it('keeps retired Medical Dictionary and Gemini tier labels out of public surfaces', () => {
    for (const file of publicSurfaceFiles) {
      const content = readFileSync(file, 'utf8');
      expect(content, file).not.toContain('Medical Dictionary');
      expect(content, file).not.toMatch(
        /Free API|(?:free[- ]?tier|paid|unpaid)\s+Gemini|Gemini\s+(?:free[- ]?tier|paid|unpaid)|paid profile/iu
      );
    }
  });

  it('keeps public documentation on KREN branding without em or en dashes', () => {
    for (const file of filesWithExtension('.', '.md')) {
      const content = readFileSync(file, 'utf8');
      expect(content, file).not.toMatch(/\bKren\b/u);
      expect(content, file).not.toMatch(/[—–]/u);
    }
  });

  it('keeps user-facing source strings on KREN branding', () => {
    for (const file of filesWithExtension('src', '.ts')) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/\bKren\b/u);
    }
  });
});
