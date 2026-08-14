import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const guide = readFileSync('docs/USER_GUIDE.md', 'utf8');
const manifestVersion = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
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
  // The guide ships inside the VSIX, so a stale version on it is delivered to every
  // user. This shipped with "KREN 1.0.4" on the 1.1.0 release and reached a public
  // pull request before an automated reviewer caught it. A hand-maintained version
  // string in a shipped document rots on every release unless something asserts it.
  it('states the version in package.json', () => {
    const stated = /This guide applies to KREN ([0-9]+\.[0-9]+\.[0-9]+)\./.exec(guide);
    expect(stated, 'The guide must state which version it applies to.').not.toBeNull();
    expect(stated?.[1]).toBe(manifestVersion);
  });

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
      'Rewrite Text',
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
      'Merriam-Webster Medical Dictionary API key',
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
    expect(guide).toContain('KREN includes no shared credentials');
    expect(guide).toContain('KREN includes no shared credentials');
    expect(guide).toContain('KREN makes no service-tier claim');
    expect(guide).toContain('Gemini API users to be at least 18');
    expect(guide).toContain('professional or business purposes');
    expect(guide).toContain('Delete all stored API keys');
    expect(guide).toContain('https://ai.google.dev/gemini-api/docs/available-regions');
    expect(guide).not.toMatch(/Free API|Paid Gemini/iu);
    expect(guide).toContain('Medical Dictionary');
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

  // A byte-order mark reached USER_GUIDE.md on 2026-08-14 from a PowerShell
  // Set-Content -Encoding utf8, which writes one in Windows PowerShell 5.1. It is
  // invisible in an editor and surfaces only as a noisy diff and the occasional renderer
  // printing a stray character before the first heading. Checked across every public
  // document, because the tool that produced it will be reached for again.
  it('starts no public document with a byte-order mark', () => {
    const withMark = publicSurfaceFiles.filter((file) =>
      readFileSync(file, 'utf8').charCodeAt(0) === 0xFEFF
    );

    expect(withMark, `byte-order mark found in: ${withMark.join(', ')}`).toEqual([]);
  });

  it('keeps the local Medical Dictionary documented without Gemini tier labels', () => {
    for (const file of publicSurfaceFiles) {
      const content = readFileSync(file, 'utf8');
      expect(content, file).not.toMatch(
        /Free API|(?:free[- ]?tier|paid|unpaid)\s+Gemini|Gemini\s+(?:free[- ]?tier|paid|unpaid)|paid profile/iu
      );
    }
    expect(readFileSync('README.md', 'utf8')).toContain('Medical Dictionary');
    expect(readFileSync('PRIVACY.md', 'utf8')).toContain('Medical Dictionary');
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

// DESIGN.md used to enumerate every setting by hand. The list went stale without anyone
// noticing: it named kren.rewrite.tone, removed in 1.2.0, and gave pre-1.2.0 domain
// values, while omitting the ten rewrite axes entirely. A delegated run read it as
// specification and had to be corrected mid-flight.
//
// The enumeration is gone and the manifest is the source of truth, but prose still
// mentions individual keys where that is the clearest way to explain a rule. This asserts
// that every key it mentions actually exists, so the document can go out of date in tone
// but never in fact.
//
// This file is copied into both channels, and DESIGN.md is private-only, so the check is
// conditional on the document being present. That conditional is the point rather than a
// weakness: asserting on a file that does not exist in one channel is how a shared test
// passes privately and fails the public build, which is exactly what happened when this
// test was first written.
describe('DESIGN.md names only settings that exist', () => {
  it.skipIf(!existsSync('DESIGN.md'))('mentions no kren setting key absent from the manifest', () => {
    const design = readFileSync('DESIGN.md', 'utf8');
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      contributes: { configuration: { properties: Record<string, unknown> } };
    };
    const declared = new Set(Object.keys(manifest.contributes.configuration.properties));
    // Retired keys may be named only where the document is explaining their migration.
    const retired = new Set(['kren.rewrite.tone', 'kren.rewrite.mode']);
    const mentioned = [...design.matchAll(/`(kren\.[A-Za-z0-9.]+)`/gu)].map((match) => match[1]!);
    const unknown = [...new Set(mentioned)]
      .filter((key) => !declared.has(key) && !retired.has(key));

    expect(unknown, `DESIGN.md names settings that do not exist: ${unknown.join(', ')}`)
      .toEqual([]);
  });
});
