import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { load } from 'cheerio';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { createTutorViewState, tutorConversationPreferencesOf, tutorResetAvailability } from '../src/tutor/state.js';
import { TUTOR_DEFAULTS } from '../src/tutor/defaults.js';
import { generateSituationPicture } from '../src/providers/situationPicture.js';
import { geminiModelCatalog, listGeminiImageModels } from '../src/providers/geminiModels.js';
import { validatedPanelSetting } from '../src/panelSettings.js';
import { isCommandMessage } from '../src/resultsViewCommands.js';
import { confirmTutorReset, updateTutorSetting } from '../src/resultsViewSettings.js';
import type { KrenResultsViewProvider } from '../src/resultsView.js';

const warning = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn(async (_key: string, _value: unknown, _target: number) => undefined));
vi.mock('vscode', () => ({
  window: { showWarningMessage: warning },
  workspace: { getConfiguration: () => ({ update }) },
  ConfigurationTarget: { Global: 1 }
}));
vi.mock('../src/resultsViewLive.js', () => ({ releaseTutorConversationResources: vi.fn(async () => undefined) }));
vi.mock('../src/resultsViewDictation.js', () => ({ cancelTutorSessionDictation: vi.fn() }));

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

function html(overrides = {}, liveModels: { id: string; displayName: string; liveOnly?: true }[] = []) {
  return renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'tutor',
    tutor: createTutorViewState(), settings: { ...PANEL_SETTINGS_FIXTURE, ...overrides },
    proModels: [{ id: 'gemini-listed', displayName: 'Listed' }], liveModels });
}

function resetView() {
  const state = createTutorViewState();
  state.question = 'A lesson question';
  state.settings.exampleCount = 11;
  state.settings.axes.formality = 'formal';
  state.settings.routing.model = 'gemini-custom-tutor';
  state.conversation.starts = 'learner';
  state.conversation.from = 'anything';
  const view = {
    // 2026-10-12: Model the shared confirmation API rather than bypassing the panel.
    showWarningMessage: warning,
    tutorState: state, tutorConversationRawAnswers: new Map(),
    tutorConversationPictureAccepted: new Set(['picture']),
    actions: { notify: vi.fn(), writeTutorPreferences: vi.fn(), settings: () => PANEL_SETTINGS_FIXTURE },
    render: vi.fn(), refresh: vi.fn(),
    view: { webview: { postMessage: vi.fn() } }
  };
  return view;
}

describe('V188 tutor defaults and reset choices', () => {
  it('agrees with every declared tutor configuration default and panel preference fallback', () => {
    const properties = JSON.parse(readFileSync('package.json', 'utf8')).contributes.configuration.properties;
    const declared = Object.fromEntries(Object.entries(properties)
      .filter(([key]) => key.startsWith('kren.tutor.'))
      .map(([key, property]) => [key.slice(5), (property as { default: unknown }).default]));
    expect(declared).toEqual(TUTOR_DEFAULTS.configuration);
    const state = createTutorViewState();
    expect(state.settings).toMatchObject(TUTOR_DEFAULTS.lesson);
    expect(state.settings.axes).toEqual(TUTOR_DEFAULTS.axes);
    expect(state.conversation).toMatchObject(TUTOR_DEFAULTS.conversation);
    expect(TUTOR_DEFAULTS.lesson.exerciseCount).toBe(6);
  });

  it.each(['Reset panel', 'Reset everything', undefined])('resets the requested scope for %s', async (choice) => {
    const view = resetView();
    const before = structuredClone(view.tutorState);
    warning.mockResolvedValueOnce(choice);
    await confirmTutorReset(view as unknown as KrenResultsViewProvider);
    expect(warning).toHaveBeenCalledWith('Reset the AI English Tutor to its defaults?', {
      modal: true,
      detail: 'Reset panel keeps your model, microphone and voice settings. Reset everything also returns them to the defaults.'
    }, 'Reset panel', 'Reset everything');
    if (choice === undefined) {
      expect(view.tutorState).toEqual(before);
      expect(update).not.toHaveBeenCalled();
      expect(view.render).not.toHaveBeenCalled();
      expect(view.refresh).not.toHaveBeenCalled();
      expect(view.actions.writeTutorPreferences).not.toHaveBeenCalled();
      expect(view.tutorConversationPictureAccepted.size).toBe(1);
      return;
    }
    expect(view.tutorState.question).toBeUndefined();
    expect(view.tutorState.settings).toMatchObject(TUTOR_DEFAULTS.lesson);
    expect(view.tutorState.settings.axes).toEqual(TUTOR_DEFAULTS.axes);
    expect(view.tutorState.conversation).toMatchObject(TUTOR_DEFAULTS.conversation);
    // 2026-10-11: both reset scopes restore the new deferred coaching default.
    expect(view.tutorState.conversation.coaching).toBe('afterwards');
    expect(view.actions.writeTutorPreferences).toHaveBeenCalledWith(tutorConversationPreferencesOf(view.tutorState.conversation));
    expect(view.tutorConversationPictureAccepted.size).toBe(0);
    if (choice === 'Reset panel') {
      expect(update).not.toHaveBeenCalled();
      expect(view.tutorState.settings.routing).toEqual(before.settings.routing);
      expect(view.render).toHaveBeenCalledOnce();
    } else {
      expect(update.mock.calls.map(([key]) => key)).toEqual(Object.keys(TUTOR_DEFAULTS.configuration));
      expect(update.mock.calls.every(([key]) => String(key).startsWith('tutor.'))).toBe(true);
      // Changed 2026-10-03: remove overrides so future declared defaults also apply.
      for (const key of Object.keys(TUTOR_DEFAULTS.configuration)) {
        expect(update).toHaveBeenCalledWith(key, undefined, 1);
      }
      // Changed 2026-10-16: V254, owner item I36, edgeOnline to googleChirp default.
      const properties = JSON.parse(readFileSync('package.json', 'utf8')).contributes.configuration.properties;
      const speechReset = update.mock.calls.find(([key]) => key === 'tutor.readAloud.provider');
      expect(speechReset).toBeDefined();
      expect(speechReset![1] ?? properties['kren.tutor.readAloud.provider'].default).toBe('googleChirp');
      expect(view.refresh).toHaveBeenCalledOnce();
    }
  });

  it.each(['Reset panel', 'Reset everything'])('restores settings on an empty session with %s', async (choice) => {
    const view = resetView();
    view.tutorState = createTutorViewState();
    view.tutorState.settings.exerciseCount = 12;
    view.tutorState.settings.axes.voice = 'preserve';
    view.tutorState.conversation.liveVoice = 'Kore';
    warning.mockResolvedValueOnce(choice);
    await confirmTutorReset(view as unknown as KrenResultsViewProvider);
    expect(warning).toHaveBeenCalledOnce();
    expect(view.tutorState.settings).toMatchObject(TUTOR_DEFAULTS.lesson);
    expect(view.tutorState.settings.axes).toEqual(TUTOR_DEFAULTS.axes);
    expect(view.tutorState.conversation).toMatchObject(TUTOR_DEFAULTS.conversation);
    // 2026-10-11: both reset scopes restore the new deferred coaching default.
    expect(view.tutorState.conversation.coaching).toBe('afterwards');
    expect(update).toHaveBeenCalledTimes(choice === 'Reset everything' ? Object.keys(TUTOR_DEFAULTS.configuration).length : 0);
    // Added 2026-10-03: V190 folds all nested groups only for Reset everything.
    expect((view as unknown as KrenResultsViewProvider).pendingTutorResetAllDisclosures).toBe(choice === 'Reset everything');
  });

  it('keeps initial and in-place master reset availability aligned for empty and busy sessions', async () => {
    const view = resetView();
    view.tutorState = createTutorViewState();
    const render = () => load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test',
      activeScreen: 'tutor', tutor: view.tutorState, settings: PANEL_SETTINGS_FIXTURE, proModels: [] }));
    expect(render()('[data-command="resetTutorSession"]').prop('disabled')).toBe(false);
    expect(tutorResetAvailability(view.tutorState)).toEqual({ master: true, lesson: false });
    view.tutorState.lessonBusy = true;
    expect(render()('[data-command="resetTutorSession"]').prop('disabled')).toBe(true);
    expect(tutorResetAvailability(view.tutorState)).toEqual({ master: false, lesson: false });
    await confirmTutorReset(view as unknown as KrenResultsViewProvider);
    // Changed 2026-10-18: V265, owner item I45, ignored busy-warning results use notify, whose warning route opens the panel notice.
    expect(view.actions.notify).toHaveBeenCalledWith('warning', expect.stringMatching(/finishing work.*try Reset again/iu));
  });

  it('stores Live language during an active conversation and patches its summary without replacing the answer', async () => {
    const view = resetView();
    view.tutorState.conversation.status = 'active';
    const store = vi.fn();
    Object.assign(view.actions, { updateSetting: store });
    await updateTutorSetting(view as unknown as KrenResultsViewProvider, 'tutor.conversation.liveTranscriptionLanguage', 'automatic');
    expect(store).toHaveBeenCalledWith('tutor.conversation.liveTranscriptionLanguage', 'automatic');
    expect(view.render).not.toHaveBeenCalled();
    expect(view.view.webview.postMessage).toHaveBeenCalledWith({ command: 'tutorConversationLiveTranscriptionLanguage', value: 'automatic' });

    const script = load(html())('script').text();
    const start = script.indexOf('function syncTutorConversationAdvancedSummary()');
    const end = script.indexOf('function syncTutorConversationMode(', start);
    const builderStart = script.indexOf('function tutorConversationAdvancedSummary(');
    const builderEnd = script.indexOf('    // The extension replaces', builderStart);
    const builder = script.slice(builderStart, builderEnd);
    class Element { textContent = ''; }
    class Select extends Element { selectedOptions = [{ textContent: 'Automatic' }]; value = 'automatic'; }
    const summary = new Element();
    const language = new Select();
    const answer = { value: 'My unfinished answer' };
    const document = { querySelector: (selector: string) => selector.includes('> summary') ? summary
      : selector.includes('liveTranscriptionLanguage') ? language : selector.includes('conversation-answer') ? answer : undefined };
    runInNewContext(builder + '\n' + script.slice(start, end) + '\nsyncTutorConversationAdvancedSummary();',
      { document, HTMLElement: Element, HTMLSelectElement: Select });
    expect(summary.textContent).toContain('Live transcription language: Automatic');
    expect(document.querySelector('[data-tutor-conversation-answer]')).toBe(answer);
    expect(answer.value).toBe('My unfinished answer');
  });
});

describe('V188 model controls', () => {
  it('puts axes after lesson rows and language inside ADVANCED, with keyboard reachable disclosure summaries', () => {
    const $ = load(html());
    const lesson = $('[data-persist-id="tutor-lesson"]');
    for (const id of ['channel', 'subject', 'register', 'shape', 'intent']) {
      const group = lesson.find(`[data-persist-id="tutor-${id}"]`);
      expect(group).toHaveLength(1);
      expect($(`[data-persist-id="tutor-${id}"]`)).toHaveLength(1);
      expect(group.children('summary')).toHaveLength(1);
      expect(group.children('summary').attr('tabindex')).not.toBe('-1');
      expect(group.attr('open')).toBeUndefined();
    }
    expect(lesson.html()!.indexOf('tutor.exerciseCount')).toBeLessThan(lesson.html()!.indexOf('tutor-channel'));
    const language = $('[data-setting="tutor.conversation.liveTranscriptionLanguage"]');
    expect(language.closest('[data-tutor-conversation-advanced]')).toHaveLength(1);
    expect(language.closest('[data-tutor-conversation-advanced]').children('summary').text()).toContain('Live transcription language: English');
    expect(language.closest('[data-llm-routing]')).toHaveLength(0);
  });

  it('names tutor routing models without renaming Translation routing', () => {
    const tutor = load(html());
    // 2026-10-11: V221 labels the two routing roles; assert their meaning and owned settings.
    expect(tutor('[data-model-preset="tutor.model"]').closest('.setting').text()).toMatch(/thorough.*lessons/iu);
    expect(tutor('[data-llm-routing="tutor"] > summary').text()).toMatch(/thorough.*Fallback Tutor Model:/iu);
    // 2026-10-05: assert all named model controls while allowing label capitalization changes.
    const titles = tutor('.setting-title').map((_i, el) => tutor(el).text().toLowerCase()).get();
    for (const title of ['Thorough model', 'Thorough model identifier', 'Fallback Tutor Model', 'Fallback Tutor Model identifier', 'Fallback Tutor Model thinking level', 'Image Model']) expect(titles).toContain(title.toLowerCase());
    const $ = load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'settings', settings: PANEL_SETTINGS_FIXTURE, proModels: [] }));
    expect($('[data-model-preset="translation.model"]').closest('.setting').find('.setting-title').text()).toBe('Model');
    expect($('[data-model-preset="translation.fallbackModel"]').closest('.setting').find('.setting-title').text()).toBe('Fallback model');
  });

  it.each(['gemini-listed', 'gemini-unlisted'])('shows only a custom identifier box for %s', (model) => {
    const $ = load(html({ tutorModel: model, tutorProfile: 'standard', customGeminiModels: ['gemini-owned'] }));
    const row = $('[data-model-identifier="tutor.model"]');
    expect(row.attr('hidden') !== undefined).toBe(model === 'gemini-listed');
    expect(row.find('input').val()).toBe(model === 'gemini-listed' ? '' : model);
    expect($('[data-model-preset="tutor.model"] option[selected]').val()).toBe(model === 'gemini-listed' ? model : '__custom__');
    for (const [command, label] of [['refreshGeminiModels', 'Refresh models'], ['addCustomModel', 'Add model'], ['removeCustomModel', 'Remove model']]) {
      const buttons = $(`.model-icon-button[data-command="${command}"]`);
      expect(buttons.length).toBeGreaterThan(0);
      for (const button of buttons.toArray()) {
        expect($(button).attr('aria-label')).toBe(label);
        expect($(button).attr('title')).toBe(label);
        expect($(button).text()).toBe('');
        expect($(button).find('svg')).toHaveLength(1);
        expect($(button).attr('style')).toBeUndefined();
      }
    }
    expect($('style').text()).toMatch(/\.icon-button\s*\{[^}]*background: transparent/);
    expect($('style').text()).toContain('stroke: currentColor');
  });

  it('opens the custom box on selection, keeps listed identifiers out of it, and focuses the box', () => {
    const script = load(html())('script').text();
    const start = script.indexOf("if (target instanceof HTMLSelectElement && target.hasAttribute('data-model-preset'))");
    const end = script.indexOf("if (target instanceof HTMLSelectElement && target.hasAttribute('data-edge-voice-preset'))", start);
    class Element { hidden = true; }
    class Input extends Element { value = ''; focus = vi.fn(); }
    const field = new Input();
    class Row extends Element { querySelector() { return field; } }
    const row = new Row();
    class Select extends Element {
      value = '__custom__';
      hasAttribute() { return true; }
      getAttribute() { return 'tutor.model'; }
      // 2026-10-05: custom fields are resolved inside this control's own routing group.
      closest() { return { querySelector: () => row }; }
    }
    const target = new Select();
    const postMessage = vi.fn();
    const context = { target, document: { querySelector: () => row }, vscode: { postMessage }, HTMLElement: Element, HTMLInputElement: Input, HTMLSelectElement: Select };
    const handler = '(function() {' + script.slice(start, end) + '})()';
    runInNewContext(handler, context);
    expect(row.hidden).toBe(false);
    expect(field.focus).toHaveBeenCalledOnce();
    expect(postMessage).not.toHaveBeenCalled();
    field.value = 'gemini-draft';
    target.value = 'gemini-listed';
    runInNewContext(handler, context);
    expect(row.hidden).toBe(true);
    expect(field.value).toBe('');
    expect(postMessage).toHaveBeenCalledWith({ command: 'updateSetting', key: 'tutor.model', value: 'gemini-listed' });
  });

  it('accepts Image Model storage and validates the custom Add command', () => {
    expect(validatedPanelSetting('tutor.imageModel', 'gemini-future-image')).toBe('gemini-future-image');
    expect(validatedPanelSetting('tutor.imageModel', '../bad model')).toBeUndefined();
    expect(validatedPanelSetting('tutor.imageCustomModels', '["gemini-future-image"]')).toBe('["gemini-future-image"]');
    expect(isCommandMessage({ command: 'refreshGeminiImageModels' })).toBe(true);
    expect(isCommandMessage({ command: 'addCustomModel', modelProvider: 'geminiImage', modelId: 'gemini-future-image', modelKey: 'tutor.imageModel' })).toBe(true);
  });

  it('keeps the ordinary hint route reachable by adding an empty custom hint identifier', () => {
    const script = load(html())('script').text();
    const start = script.indexOf("if (command === 'addCustomModel')");
    const end = script.indexOf("if (command === 'removeCustomModel')", start);
    class Input { value = ''; }
    const field = new Input();
    const postMessage = vi.fn();
    const target = { getAttribute: (name: string) => name === 'data-model-key' ? 'tutor.hintModel' : 'gemini',
      closest: () => ({ querySelector: () => field }) };
    runInNewContext('(function() {' + script.slice(start, end) + '})()',
      { target, command: 'addCustomModel', HTMLInputElement: Input, vscode: { postMessage } });
    expect(postMessage).toHaveBeenCalledWith({ command: 'updateSetting', key: 'tutor.hintModel', value: '' });
  });

  it('keeps the Live-only warning visible when an added ordinary model is listed', () => {
    const $ = load(html({ tutorModel: 'gemini-3.8-live', tutorProfile: 'standard', customGeminiModels: ['gemini-3.8-live'] },
      [{ id: 'gemini-3.8-live', displayName: 'Live', liveOnly: true }]));
    expect($('[data-model-identifier="tutor.model"]').attr('hidden')).toBeDefined();
    expect($('[data-model-preset="tutor.model"]').closest('.setting').text()).toContain('Live-only model');
  });
});

describe('V188 Image Model discovery and requests', () => {
  it('refreshes only image identifiers supporting generateContent', async () => {
    const models = [
      { name: 'models/gemini-future-image', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-future-image-live', supportedGenerationMethods: ['bidiGenerateContent'] },
      { name: 'models/gemini-future-image-embedding', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-future', supportedGenerationMethods: ['generateContent'] }
    ];
    expect(geminiModelCatalog(models).image.map(({ id }) => id)).toEqual(['gemini-future-image']);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ models }) })));
    expect((await listGeminiImageModels('example', new AbortController().signal)).map(({ id }) => id)).toEqual(['gemini-future-image']);
  });

  it.each(['gemini-custom-image', 'models/gemini-custom-image', '../invalid model', 'nonsense'])('uses the configured picture model or falls back for %s', async (configured) => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'YWJj' } }] } }] }) }));
    vi.stubGlobal('fetch', fetchMock);
    await generateSituationPicture('A cafe.', 'example', new AbortController().signal, undefined, configured);
    const model = configured.endsWith('gemini-custom-image') ? 'gemini-custom-image' : TUTOR_DEFAULTS.configuration['tutor.imageModel'];
    expect(fetchMock).toHaveBeenCalledWith(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, expect.objectContaining({ headers: { 'Content-Type': 'application/json', 'x-goog-api-key': 'example' } }));
  });
});
