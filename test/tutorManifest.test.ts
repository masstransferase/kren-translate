import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Manifest {
  contributes: {
    commands: Array<{ command: string; title: string; category?: string }>;
    menus: Record<string, Array<{ command?: string }>>;
  };
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as Manifest;

describe('AI English Tutor contribution', () => {
  it('contributes and registers the command with no editor context-menu entry', () => {
    expect(manifest.contributes.commands).toContainEqual(expect.objectContaining({
      command: 'kren.openTutor',
      // Changed 2026-10-19: V282 (2.0.1 page text) uses the approved palette title.
      title: 'Start LLM-based AI English Tutor',
      category: 'KREN'
    }));
    expect(manifest.contributes.menus['editor/context'] ?? [])
      .not.toContainEqual(expect.objectContaining({ command: 'kren.openTutor' }));
    expect(readFileSync('src/extension.ts', 'utf8'))
      .toContain("registerCommand('kren.openTutor'");
  });

  it('renders the map from Core without embedding its hierarchy in the panel source', () => {
    const renderer = readFileSync('src/resultViewHtml.ts', 'utf8');
    expect(renderer.match(/mechanics\./gu) ?? []).toHaveLength(0);
    expect(renderer).toContain("from '@kren/core/tutor'");
    expect(renderer).toContain('TUTOR_MAP');
  });
});
