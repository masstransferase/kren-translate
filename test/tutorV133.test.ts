import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import { renderKrenResultViewHtml, type KrenPanelSettings } from '../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { migratedTutorLiveCustomModels } from '../src/panelSettings.js';

function render(
  activeScreen: 'settings' | 'tutor',
  settings: KrenPanelSettings = PANEL_SETTINGS_FIXTURE
): string {
  return renderKrenResultViewHtml({
    cspSource: 'test',
    nonce: 'nonce',
    activeScreen,
    settings,
    proModels: [
      { id: 'gemini-3.6-flash', displayName: 'Gemini 3.6 Flash' },
      { id: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro Preview' }
    ],
    liveModels: [
      { id: 'gemini-3.8-live', displayName: 'Gemini 3.8 Live', liveOnly: true },
      { id: 'gemini-4.0-conversation', displayName: 'Gemini 4.0 Conversation', liveOnly: true }
    ]
  });
}

describe('V133 routing controls', () => {
  it('V149 places the Hint-only model inside Tutor LLM ROUTING and keeps empty editable', () => {
    const $ = load(render('tutor', { ...PANEL_SETTINGS_FIXTURE, tutorHintModel: '' }));
    const control = $('[data-setting="tutor.hintModel"]');
    expect(control).toHaveLength(1);
    expect(control.val()).toBe('');
    expect(control.parents('[data-llm-routing="tutor"]')).toHaveLength(1);
    // 2026-10-11: V221 keeps empty editable and describes the Fast role by its actions.
    expect(control.parents('[data-llm-routing="tutor"]').text()).toMatch(/fast.*hints.*Ask/isu);
  });

  // Changed 2026-10-16: V258, owner decision A, every feature's fallback controls show on both
  // Gemini profiles, as the tutor's already did.
  it('shows the fallback controls on both Gemini profiles for the tutor and every other feature', () => {
    const tutor = load(render('tutor'));
    for (const key of [
      'tutor.fallbackEnabled', 'tutor.fallbackModel', 'tutor.fallbackThinkingOrEffort'
    ]) {
      const control = tutor(`[data-setting="${key}"]`);
      expect(control, `${key} is not rendered`).toHaveLength(1);
      expect(control.parents('[data-provider-value="gemini"]')).toHaveLength(1);
      expect(control.parents('[data-gemini-profile-value="pro"]')).toHaveLength(0);
    }

    const ordinary = load(render('settings'));
    for (const prefix of ['translation', 'explanation', 'rewrite']) {
      for (const suffix of ['fallbackEnabled', 'fallbackModel', 'fallbackThinkingOrEffort']) {
        const control = ordinary(`[data-setting="${prefix}.${suffix}"]`).first();
        expect(control, `${prefix}.${suffix} is not rendered`).toHaveLength(1);
        expect(control.parents('[data-gemini-profile-value="pro"]')).toHaveLength(0);
      }
    }
  });

  it('offers only live-capable presets while preserving the authoritative typed field', () => {
    const html = render('tutor', {
      ...PANEL_SETTINGS_FIXTURE,
      tutorLiveModel: 'gemini-future-streaming-model'
    });
    const $ = load(html);
    const values = $('[data-model-preset="tutor.liveModel"] option')
      .map((_index, option) => $(option).attr('value')).get();
    expect(values).toEqual([
      'gemini-3.8-live', 'gemini-4.0-conversation', '__custom__'
    ]);
    expect($('[data-model-preset="tutor.liveModel"] option[selected]').attr('value'))
      .toBe('__custom__');
    expect($('[data-setting="tutor.liveModel"]').val()).toBe('gemini-future-streaming-model');
    expect($('[data-setting="tutor.liveModel"]').closest('.setting').prev().text())
      .toContain('Live API needs a live model');
    expect($('[data-model-preset="tutor.liveModel"]').siblings('[data-command]').attr('data-command'))
      .toBe('refreshGeminiLiveModels');
  });

  it('V135 marks a known Live-only ordinary model while keeping an unknown identifier editable', () => {
    const known = load(render('tutor', {
      ...PANEL_SETTINGS_FIXTURE,
      tutorModel: 'gemini-3.8-live'
    }));
    const knownField = known('[data-setting="tutor.model"]');
    expect(knownField.val()).toBe('gemini-3.8-live');
    // Changed 2026-10-03: the warning belongs to the always-visible dropdown row.
    expect(known('[data-model-preset="tutor.model"]').closest('.setting').text())
      .toMatch(/Live-only.*cannot answer ordinary requests/u);
    const fallback = load(render('tutor', {
      ...PANEL_SETTINGS_FIXTURE,
      tutorFallbackEnabled: true,
      tutorFallbackModel: 'gemini-3.8-live'
    }));
    expect(fallback('[data-model-preset="tutor.fallbackModel"]').closest('.setting').text())
      .toMatch(/Live-only.*cannot answer ordinary requests/u);

    const unknown = load(render('tutor', {
      ...PANEL_SETTINGS_FIXTURE,
      tutorModel: 'gemini-future-reader-model'
    }));
    const unknownField = unknown('[data-setting="tutor.model"]');
    expect(unknownField.val()).toBe('gemini-future-reader-model');
    expect(unknown('[data-model-preset="tutor.model"]').closest('.setting').text())
      .not.toMatch(/Live-only.*cannot answer ordinary requests/u);
    expect(unknownField.siblings('[data-command="addCustomModel"]')).toHaveLength(1);
  });

  it('declares and runs a one-way migration from existing Gemini custom entries', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      contributes: { configuration: { properties: Record<string, unknown> } };
    };
    expect(manifest.contributes.configuration.properties)
      .toHaveProperty('kren.tutor.liveCustomModels');
    const source = readFileSync('src/extension.ts', 'utf8');
    expect(source).toContain('migrateTutorLiveCustomModels');
    expect(source).toContain("'gemini.customModels'");
    expect(source).toContain("'tutor.liveCustomModels'");
    expect(source.indexOf('await migrateTutorLiveCustomModels'))
      .toBeLessThan(source.indexOf('new KrenResultsViewProvider'));
    expect(migratedTutorLiveCustomModels('["gemini-existing"]', undefined))
      .toBe('["gemini-existing"]');
    expect(migratedTutorLiveCustomModels('["gemini-existing"]', '[]'))
      .toBeUndefined();
  });
});
