import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface LockPackage {
  version?: string;
  license?: string;
  dev?: boolean;
}

interface Lockfile {
  packages: Record<string, LockPackage>;
}

const lockfile = JSON.parse(readFileSync('package-lock.json', 'utf8')) as Lockfile;
const notices = readFileSync('THIRD_PARTY_NOTICES.md', 'utf8');

describe('third-party release notices', () => {
  it('lists every bundled production package with its locked version and license', () => {
    const productionPackages = Object.entries(lockfile.packages)
      .filter(([path, metadata]) => path.startsWith('node_modules/') && metadata.dev !== true)
      .map(([path, metadata]) => ({
        name: path.replace(/^node_modules\//u, ''),
        version: metadata.version,
        license: metadata.license
      }));

    expect(productionPackages.length).toBeGreaterThan(0);
    for (const dependency of productionPackages) {
      expect(notices, dependency.name).toContain(`\`${dependency.name}\``);
      expect(dependency.version, dependency.name).toBeTypeOf('string');
      expect(dependency.license, dependency.name).toBeTypeOf('string');
      expect(notices, dependency.name).toContain(dependency.version!);
      expect(notices, dependency.name).toContain(dependency.license!);
    }
  });

  it('ships complete license texts for bundled MIT and Apache software', () => {
    expect(readFileSync('licenses/MIT.txt', 'utf8')).toContain('MIT License');
    expect(readFileSync('licenses/Apache-2.0.txt', 'utf8')).toContain('Apache License');
  });
});
