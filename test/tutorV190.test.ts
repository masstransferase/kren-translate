import { describe, expect, it, vi } from 'vitest';
import { load } from 'cheerio';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { createTutorViewState } from '../src/tutor/state.js';
import { TUTOR_DEFAULTS } from '../src/tutor/defaults.js';
import { validatedPanelSetting } from '../src/panelSettings.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

function page(overrides = {}, models = [{ id: 'ordinary-new', displayName: 'New ordinary' }], resetAll = false, resetPanel = false) {
  return renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'tutor',
    tutor: createTutorViewState(), tutorResetDisclosures: resetAll || resetPanel, tutorResetAllDisclosures: resetAll,
    settings: { ...PANEL_SETTINGS_FIXTURE, tutorProfile: 'standard', ...overrides }, proModels: models });
}

function restoreDisclosures(markup: string, stored: { openSections?: Record<string, boolean> } = {}) {
  const $ = load(markup);
  class Details {
    constructor(readonly element: ReturnType<typeof $>) {}
    getAttribute(key: string) { return this.element.attr(key); }
    get open() { return this.element.attr('open') !== undefined; }
    set open(value: boolean) {
      if (value) this.element.attr('open', '');
      else this.element.removeAttr('open');
    }
  }
  const sections = $('details[data-persist-id]').toArray().map((element) => new Details($(element)));
  let saved = structuredClone(stored);
  const listeners = new Map<string, (event: { target: Details }) => void>();
  const script = $('script').text();
  runInNewContext(script.slice(script.indexOf('function panelState()'), script.indexOf('    const activeScreen =')), {
    vscode: { getState: () => saved, setState: (state: typeof saved) => { saved = state; } },
    HTMLDetailsElement: Details,
    document: {
      querySelectorAll: (selector: string) => sections.filter((section) => section.element.is(selector)),
      querySelector: (selector: string) => sections.find((section) => section.element.is(selector)),
      addEventListener: (name: string, listener: (event: { target: Details }) => void) => listeners.set(name, listener)
    }
  });
  return { $, sections, saved: () => saved, toggle: (id: string, open: boolean) => {
    const section = sections.find((section) => section.getAttribute('data-persist-id') === id)!;
    section.open = open;
    listeners.get('toggle')!({ target: section });
  } };
}

describe('V190 tutor voice and model controls', () => {
  it('uses a circular refresh arc with separated ends and transparent model buttons in every state', () => {
    const $ = load(page({ customGeminiModels: ['owned-model'] }));
    const styles = $('style').text();
    for (const command of ['refreshGeminiModels', 'addCustomModel', 'removeCustomModel']) {
      const buttons = $(`[data-command="${command}"]`);
      expect(buttons.length).toBeGreaterThan(0);
      expect(buttons.toArray().every((button) => $(button).hasClass('model-icon-button'))).toBe(true);
    }
    expect($('[data-command="refreshGeminiModels"] path').first().attr('d')).toBe('M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5');
    for (const selector of ['.model-icon-button', '.tutor-content .model-icon-button']) {
      for (const state of ['', ':hover', ':active', ':focus']) {
        // Changed 2026-10-04: V203 guards disabled hover without changing the transparent model styling.
        const rule = styles.split('}').find((rule) => rule.split('{')[0]!.split(',').some((part) =>
          part.trim() === selector + state || (state === ':hover' && part.trim().startsWith(selector + state + ':where('))));
        expect(rule).toContain('background: transparent');
        expect(rule).toContain('border-color: transparent');
      }
    }
    expect(styles).toContain('stroke: currentColor');
  });

  it('keeps one ordinary Refresh and independent Live and Image Refresh controls', () => {
    const $ = load(page());
    for (const key of ['fallbackModel', 'hintModel']) {
      expect($(`[data-model-preset="tutor.${key}"]`).closest('.setting').find('[data-command^="refresh"]')).toHaveLength(0);
    }
    for (const [key, command] of [['model', 'refreshGeminiModels'], ['liveModel', 'refreshGeminiLiveModels'], ['imageModel', 'refreshGeminiImageModels']]) {
      expect($(`[data-model-preset="tutor.${key}"]`).closest('.setting').find(`[data-command="${command}"]`)).toHaveLength(1);
    }
  });

  it.each([
    { tutorReadAloudVolume: 50 },
    { tutorEdgeReadAloudFemaleVoice: 'en-GB-SoniaNeural' }
  ])('patches the catalogs and voice settings summary while retaining disclosures and the answer: %j', (voiceSettings) => {
    const before = load(page({ tutorFallbackEnabled: true, tutorModel: 'old-tutor' }, []));
    const afterHtml = page({ tutorFallbackEnabled: true, tutorModel: 'new-tutor', tutorFallbackModel: 'new-fallback',
      tutorLiveModel: 'new-live', tutorImageModel: 'new-image', ...voiceSettings });
    const selector = 'details[data-persist-id="tutor-setting"]';
    const group = before(selector);
    function sections() {
      return group.find('details[data-persist-id]').toArray().map((element) => ({
        getAttribute: (key: string) => before(element).attr(key),
        get open() { return before(element).attr('open') !== undefined; },
        set open(value: boolean) { if (value) before(element).attr('open', ''); else before(element).removeAttr('open'); }
      }));
    }
    group.attr('open', '');
    group.find('[data-persist-id="tutor-routing"]').attr('open', '');
    const answer = { value: 'Unsaved answer', selectionStart: 7 };
    const current = { querySelectorAll: sections, get innerHTML() { return group.html(); }, set innerHTML(value: string | null) { group.html(value ?? ''); } };
    class Parser { parseFromString(markup: string) { const $ = load(markup); return { querySelector: () => ({ innerHTML: $(selector).html() }) }; } }
    const script = before('script').text();
    const start = script.indexOf('function patchTutorVoiceModel(message)');
    const end = script.indexOf('function patchTutorConversationSpeechDetection', start);
    const applyConditionalSettings = vi.fn();
    runInNewContext(script.slice(start, end) + '\npatchTutorVoiceModel(message);', {
      document: { querySelector: () => current }, DOMParser: Parser, message: { html: afterHtml }, applyConditionalSettings
    });
    for (const key of ['model', 'fallbackModel', 'hintModel']) {
      expect(group.find(`[data-model-preset="tutor.${key}"] option[value="ordinary-new"]`)).toHaveLength(1);
    }
    expect(group.attr('open')).toBeDefined();
    expect(group.find('[data-persist-id="tutor-routing"]').attr('open')).toBeDefined();
    // 2026-10-05: normalize label case only, preserving exact selected values and their order.
    const summary = group.children('summary').find('.rewrite-group-summary').text().split(' | ')
      .map(part => part.replace(/^Live (voice|female|male):/iu, label => label.toLowerCase()));
    // Changed 2026-10-04: V203 labels Gemini voices beside the Edge block, after all models.
    const after = load(afterHtml);
    expect(summary).toEqual(['new-tutor', 'new-fallback', 'new-live',
      'new-image',
      after('[data-setting="tutor.readAloud.provider"] option:selected').text(),
      `Female: ${after('[data-tutor-voice-setting="tutor.readAloud.edgeFemaleVoice"] option:selected').text()}`,
      `Male: ${after('[data-tutor-voice-setting="tutor.readAloud.edgeMaleVoice"] option:selected').text()}`,
      // 2026-10-11: The Edge summary reads the Edge control, not the hidden Chirp copy.
      `Speed: ${after('[data-provider-value="edgeOnline"] [data-setting="tutor.readAloud.edgeRatePercent"] option:selected').text()}`,
      `Volume: ${after('[data-setting="tutor.readAloud.volume"] option:selected').text()}`,
      `live voice: ${after('[data-tutor-conversation-live-voice] option:selected').text()}`,
      `live female: ${after('[data-tutor-voice-setting="tutor.liveFemaleVoice"] option:selected').text()}`,
      `live male: ${after('[data-tutor-voice-setting="tutor.liveMaleVoice"] option:selected').text()}`]);
    expect(group.children('summary').find('.rewrite-group-summary').text())
      .not.toBe(load(page({ tutorFallbackEnabled: true, tutorModel: 'new-tutor', tutorFallbackModel: 'new-fallback',
        tutorLiveModel: 'new-live', tutorImageModel: 'new-image' }))(`${selector} > summary .rewrite-group-summary`).text());
    expect(group.children('summary').text()).not.toMatch(/Modality|Domain|Formality|Perspective|Rhetorical/);
    expect(answer).toEqual({ value: 'Unsaved answer', selectionStart: 7 });
    expect(applyConditionalSettings).toHaveBeenCalledOnce();
  });

  it('omits the fallback identifier when Automatic fallback is off and uses the active alternate model', () => {
    const $ = load(page({ tutorProfile: 'pro', tutorAlternateModel: 'alternate-active', tutorFallbackEnabled: false, tutorFallbackModel: 'hidden-fallback' }));
    const group = $('[data-persist-id="tutor-setting"] > summary');
    expect(group.text()).toContain('VOICE & MODEL');
    const summary = group.find('.rewrite-group-summary').text().split(' | ');
    // Changed 2026-10-04: V203 includes all three displayed Gemini voice controls.
    expect(summary).toHaveLength(3 + $('[data-setting="tutor.readAloud.provider"] option:selected').length +
      $('[data-tutor-voice-group="gemini"] select').length +
      $('[data-tutor-voice-group="edge"] [data-tutor-voice-setting]').length + 2);
    expect(summary[0]).toBe('alternate-active');
    expect(summary).not.toContain('hidden-fallback');
  });

  it.each(['edgeOnline', 'windowsLocal'])('summarizes every displayed voice setting for %s', (provider) => {
    const $ = load(page({ tutorFallbackEnabled: true, tutorModel: 'ordinary', tutorFallbackModel: 'fallback',
      tutorLiveModel: 'live', tutorImageModel: 'image', tutorReadAloudProvider: provider,
      tutorEdgeReadAloudRatePercent: 10, tutorReadAloudRate: -4, tutorReadAloudVolume: 75 }));
    // 2026-10-11: Mutually exclusive Edge and Chirp speed controls store the same setting.
    const selected = (key: string) => $(`[data-setting="${key}"], [data-tutor-voice-setting="${key}"]`).first().find('option:selected').text();
    // 2026-10-05: normalize label case only, preserving exact selected values and their order.
    const summary = $('[data-persist-id="tutor-setting"] > summary .rewrite-group-summary').text().split(' | ')
      .map(part => part.replace(/^Live (voice|female|male):/iu, label => label.toLowerCase()));
    // Changed 2026-10-04: V203 groups and labels the Gemini voices after the speech block.
    expect(summary).toEqual([
      'ordinary', 'fallback', 'live', 'image',
      selected('tutor.readAloud.provider'),
      ...(provider === 'edgeOnline' ? [
        `Female: ${selected('tutor.readAloud.edgeFemaleVoice')}`,
        `Male: ${selected('tutor.readAloud.edgeMaleVoice')}`
      ] : []),
      `Speed: ${selected(provider === 'edgeOnline' ? 'tutor.readAloud.edgeRatePercent' : 'tutor.readAloud.rate')}`,
      `Volume: ${selected('tutor.readAloud.volume')}`,
      `live voice: ${$('[data-tutor-conversation-live-voice] option:selected').text()}`,
      `live female: ${selected('tutor.liveFemaleVoice')}`,
      `live male: ${selected('tutor.liveMaleVoice')}`
    ]);
  });

  it('V192 opens LEARNING MAP initially and after reload without stored folding, and remembers reader toggles', () => {
    // Changed 2026-10-10: Anything avoids the unfinished-lesson gate masking an initially open MODE.
    const state = createTutorViewState();
    state.conversation.from = 'anything';
    const markup = renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'tutor',
      tutor: state, settings: PANEL_SETTINGS_FIXTURE, proModels: [] });
    expect(load(markup)('[data-persist-id="tutor-map"]').attr('open')).toBeDefined();
    const fresh = restoreDisclosures(markup);
    expect(fresh.$('[data-persist-id="tutor-map"]').attr('open')).toBeDefined();
    // Added 2026-10-10: V212 makes LEARNING MAP the sole unfolded section on first open.
    fresh.$('.tutor-content details').each((_index, element) => {
      expect(fresh.$(element).attr('open') !== undefined, fresh.$(element).attr('data-persist-id'))
        .toBe(fresh.$(element).attr('data-persist-id') === 'tutor-map');
    });
    expect(restoreDisclosures(markup, {}).$('[data-persist-id="tutor-map"]').attr('open')).toBeDefined();
    fresh.toggle('tutor-map', false);
    expect(fresh.saved().openSections?.['tutor-map']).toBe(false);
    const folded = restoreDisclosures(markup, fresh.saved());
    expect(folded.$('[data-persist-id="tutor-map"]').attr('open')).toBeUndefined();
    folded.toggle('tutor-map', true);
    expect(folded.saved().openSections?.['tutor-map']).toBe(true);
    expect(restoreDisclosures(markup, folded.saved()).$('[data-persist-id="tutor-map"]').attr('open')).toBeDefined();
  });

  it.each(['Reset panel', 'Reset everything'])('V192 opens LEARNING MAP and preserves the other disclosure rules on %s', (choice) => {
    const markup = page({}, [], choice === 'Reset everything', choice === 'Reset panel');
    const openSections: Record<string, boolean> = { 'tutor-old-nested': true, 'settings-translation': true };
    const $ = load(markup);
    $('.tutor-content details[data-persist-id]').each((_index, element) => {
      openSections[$(element).attr('data-persist-id')!] = true;
    });
    openSections['tutor-map'] = false;
    const restored = restoreDisclosures(markup, { openSections });
    const sections = restored.sections.filter((section) => section.element.is('.tutor-content details'));
    expect(sections.length).toBeGreaterThan(10);
    // Changed 2026-10-03: V192 makes the map the sole exception to the master reset folds.
    const panelFolds = ['tutor-lesson', 'tutor-channel', 'tutor-subject', 'tutor-register', 'tutor-shape', 'tutor-intent', 'tutor-conversation-mode', 'tutor-conversation-advanced', 'tutor-setting'];
    for (const section of sections) {
      const id = section.getAttribute('data-persist-id')!;
      const expected = id === 'tutor-map' || (choice === 'Reset panel' && !panelFolds.includes(id));
      expect(section.open, id).toBe(expected);
      expect(restored.saved().openSections?.[id], `stored ${id}`).toBe(expected);
    }
    expect(restored.saved().openSections?.['tutor-old-nested']).toBe(choice === 'Reset panel');
    expect(restored.saved().openSections?.['settings-translation']).toBe(true);
    expect(restoreDisclosures(page(), restored.saved()).$('[data-persist-id="tutor-map"]').attr('open')).toBeDefined();
    restored.toggle('tutor-map', false);
    expect(restoreDisclosures(page(), restored.saved()).$('[data-persist-id="tutor-map"]').attr('open')).toBeUndefined();
  });

  it('declares and accepts auto thinking', () => {
    const setting = JSON.parse(readFileSync('package.json', 'utf8')).contributes.configuration.properties['kren.tutor.thinkingOrEffort'];
    expect(setting.default).toBe('auto');
    expect(TUTOR_DEFAULTS.configuration['tutor.thinkingOrEffort']).toBe('auto');
    expect(setting.enum).toContain('auto');
    expect(validatedPanelSetting('tutor.thinkingOrEffort', 'auto')).toBe('auto');
  });
});
