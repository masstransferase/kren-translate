// 2026-10-12: ADVANCED now groups microphone values in the compact summary.
import { TUTOR_DEFAULTS } from '../src/tutor/defaults.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { createTutorViewState } from '../src/tutor/state.js';
import type { TutorPauseBeforeReply } from '../src/tutorMicrophoneGate.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { validatedPanelSetting } from '../src/panelSettings.js';

describe('V136 shared microphone sensitivity', () => {
  const render = (standardQuietPeriodMs: number, tutor = createTutorViewState(), pauseBeforeReply: TutorPauseBeforeReply = 5): string => renderKrenResultViewHtml({
    cspSource: 'vscode-webview://test',
    nonce: 'test-nonce',
    settings: { ...PANEL_SETTINGS_FIXTURE, tutorConversationPauseBeforeReply: pauseBeforeReply },
    activeScreen: 'tutor',
    tutor,
    proModels: [],
    tutorStandardQuietPeriodMs: standardQuietPeriodMs
  });

  it.each([500, 800, 1_000])(
    'uses the selected %i ms Standard quiet period in the Handy watcher',
    (quietPeriodMs) => {
      const html = render(quietPeriodMs);
      expect(html).toContain(`window.setTimeout(submitAfterQuiet, ${quietPeriodMs})`);
    }
  );

  it('declares the reader-facing control and explains its boundary in both documents', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      contributes: { configuration: { properties: Record<string, {
        default?: unknown; enum?: unknown[]; enumDescriptions?: string[]; description?: string
      }> } };
    };
    const setting = manifest.contributes.configuration.properties[
      'kren.tutor.conversation.microphoneSensitivity'
    ];
    expect(setting).toMatchObject({
      default: 'balanced',
      enum: ['quietRoom', 'balanced', 'noisyRoom']
    });
    expect(setting?.description).toContain('cannot make the provider answer faster');
    // Changed 2026-10-02 for V186: sensitivity controls speech and Standard's wait;
    // the separate pause now controls Live. Assert those meanings rather than wording.
    expect(setting?.description).toMatch(/local gate.*speech.*Standard/u);
    // 2026-10-02: V186b describes both Standard timer origins, including a late paste.
    expect(setting?.description).toMatch(/Standard waits after your speech or its transcription before sending/u);
    expect(setting?.description).toMatch(/Pause before reply.*hands-free Live/u);
    expect(setting?.description).toContain("Gemini's automatic activity detection is disabled");
    const pressToTalk = manifest.contributes.configuration.properties[
      'kren.tutor.conversation.pressToTalk'
    ];
    // 2026-10-12: Press to talk describes the actual two-press action.
    expect(pressToTalk?.description).toMatch(/once.*start.*again.*finish.*next conversation/u);
    const closeWait = manifest.contributes.configuration.properties[
      'kren.tutor.conversation.microphoneCloseWait'
    ];
    // Changed 2026-10-03: invalid/missing close wait uses current tutor defaults.
    expect(closeWait).toMatchObject({ default: TUTOR_DEFAULTS.configuration['tutor.conversation.microphoneCloseWait'], enum: [2, 4, 6, 8] });
    expect(closeWait?.enumDescriptions).toHaveLength(4);
    for (const [index, seconds] of [2, 4, 6, 8].entries()) {
      const description = closeWait?.enumDescriptions?.[index] ?? '';
      expect(description).toContain(`${seconds} seconds`);
      expect(description.match(/[.!?]/gu)).toHaveLength(1);
    }
    expect(closeWait?.description).toContain('Windows to hand the microphone back');
    expect(closeWait?.description).toContain('indicator can stay lit for a few seconds');
    const guide = readFileSync('docs/USER_GUIDE.md', 'utf8');
    expect(guide).toContain('Microphone sensitivity');
    expect(guide).toMatch(/In Standard,.*500.*800.*1000.*after your speech or its transcription before sending/u);
    expect(guide).toContain('cannot make the provider answer faster');
    // Changed 2026-10-06: V211 keeps the detector's privacy boundary in Reference without pinning the old sentence.
    expect(guide).toMatch(/KREN speech detection[^.]*Gemini's automatic activity detection is disabled/u);
    expect(guide).toContain('Microphone close wait'); // 2026-10-12: The guide names the setting, while ADVANCED abbreviates seconds.
    expect(guide).toContain('Windows microphone indicator can stay lit');
  });

  it('V140 keeps Send, Gemini voice, and sensitivity enabled while active', () => {
    const state = createTutorViewState();
    Object.assign(state.conversation, { status: 'active', replies: 'standard' });
    const $ = renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test', nonce: 'test-nonce',
      settings: PANEL_SETTINGS_FIXTURE, activeScreen: 'tutor', tutor: state, proModels: []
    });
    for (const attribute of [
      // Changed 2026-09-23: Answers was removed; input kind is recorded per turn.
      'data-tutor-conversation-send',
      // 2026-10-12: Reply thinking was removed; the remaining active controls stay usable.
      'data-tutor-conversation-live-voice'
    ]) {
      expect($).toContain(attribute);
      expect($).not.toMatch(new RegExp(`${attribute}[^>]* disabled`, 'u'));
    }
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      contributes: { configuration: { properties: Record<string, Record<string, unknown>> } };
    };
    const sensitivity = manifest.contributes.configuration.properties[
      'kren.tutor.conversation.microphoneSensitivity'
    ];
    expect(sensitivity).toBeDefined();
    expect(sensitivity).not.toHaveProperty('enablement');
  });

  it('V186 puts Pause before reply between sensitivity and close wait in conversation ADVANCED', () => {
    const state = createTutorViewState();
    state.conversation.status = 'idle';
    const $ = load(renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test', nonce: 'test-nonce',
      settings: {
        ...PANEL_SETTINGS_FIXTURE,
        tutorConversationMicrophoneSensitivity: 'quietRoom',
        tutorConversationMicrophoneCloseWait: 2,
        tutorConversationPressToTalk: true
      },
      activeScreen: 'tutor', tutor: state, proModels: []
    }));
    const advanced = $('[data-tutor-conversation-advanced]');
    const sensitivity = advanced.find(
      '[data-setting="tutor.conversation.microphoneSensitivity"]'
    );
    const closeWait = advanced.find(
      '[data-setting="tutor.conversation.microphoneCloseWait"]'
    );
    const pressToTalk = advanced.find('[data-setting="tutor.conversation.pressToTalk"]');

    // Added 2026-09-23: these are the existing VS Code keys, so no migration is involved.
    expect(sensitivity).toHaveLength(1);
    expect(sensitivity.val()).toBe('quietRoom');
    // Changed 2026-09-23: the owner asked for one-sentence descriptions, so the reason now
    // sits inside the sentence. What this guards is unchanged: the reader is told when the
    // change takes effect.
    expect(sensitivity.closest('.setting').text()).toContain('from the next conversation');
    expect(closeWait).toHaveLength(1);
    expect(closeWait.val()).toBe('2');
    // Changed 2026-10-02: V187 inserts Speech detection after the pause.
    expect(closeWait.closest('.setting').prev().find(
      '[data-setting="tutor.conversation.speechDetection"]'
    )).toHaveLength(1);
    expect(closeWait.closest('.setting').next().find(
      '[data-setting="tutor.conversation.pressToTalk"]'
    )).toHaveLength(1);
    expect(pressToTalk).toHaveLength(1);
    expect(pressToTalk.is(':checked')).toBe(true);
    expect(pressToTalk.closest('.setting').text()).toContain('from the next conversation');
  });

  it('V186 exposes the five pause options below sensitivity with a 2-second default and summary', () => {
    const $ = load(render(800));
    const advanced = $('[data-tutor-conversation-advanced]');
    const pause = advanced.find('[data-setting="tutor.conversation.pauseBeforeReply"]');
    expect(pause.find('option').map((_, option) => [$(option).attr('value')]).get())
      .toEqual(['1', '2', '3', '4', '5']);
    expect(pause.find('option').map((_, option) => $(option).text()).get())
      .toEqual(['1 second', '2 seconds', '3 seconds', '4 seconds', '5 seconds']);
    expect(pause.val()).toBe('5');
    expect(pause.closest('.setting').prev().find('[data-setting="tutor.conversation.microphoneSensitivity"]')).toHaveLength(1);
    expect(pause.closest('.setting').find('.setting-description').text())
      .toBe('How long you can pause before KREN treats your turn as finished, in hands-free Live, from the next conversation.');
    // 2026-10-02: the native select is keyboard reachable after opening the named,
    // persistent ADVANCED disclosure; its closed summary still exposes the choice.
    expect(advanced.children('summary').find('.rewrite-group-name').text()).toBe('ADVANCED');
    expect(advanced.attr('data-persist-id')).toBe('tutor-conversation-advanced');
    expect(pause.is(':disabled')).toBe(false);
    expect(pause.attr('tabindex')).toBeUndefined();
    // 2026-10-02: Each chosen control must appear in the shared summary.
    for (const choice of ['Microphone: Balanced', '5sec', // Changed 2026-10-03: verify the chosen detection label shown by its control.
      `${advanced.find('[data-setting="tutor.conversation.speechDetection"] option:selected').text()}`, `${TUTOR_DEFAULTS.configuration['tutor.conversation.microphoneCloseWait']}sec`]) {
      expect(advanced.children('summary').text()).toContain(choice);
    }
    const defaults = load(renderKrenResultViewHtml({
      cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
      activeScreen: 'tutor', tutor: createTutorViewState(), proModels: []
    }));
    expect(defaults('[data-setting="tutor.conversation.pauseBeforeReply"]').val()).toBe('2');
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(manifest.contributes.configuration.properties['kren.tutor.conversation.pauseBeforeReply'])
      .toMatchObject({ type: 'number', enum: [1, 2, 3, 4, 5], default: 2 });
    // Changed 2026-10-06: Preserve the control's relative position in the numbered voice/model task.
    expect(readFileSync('docs/USER_GUIDE.md', 'utf8')).toMatch(/\*\*Pause before reply\*\* below \*\*Microphone sensitivity\*\*/u);
  });

  it.each([1, 2, 3, 4, 5])('V186 validates numeric and select pause %i', (seconds) => {
    expect(validatedPanelSetting('tutor.conversation.pauseBeforeReply', seconds)).toBe(seconds);
    expect(validatedPanelSetting('tutor.conversation.pauseBeforeReply', String(seconds))).toBe(seconds);
  });

  it.each([0, 6, 2.5, '3 seconds', '03', '', true])('V186 refuses invalid pause %s', (value) => {
    expect(validatedPanelSetting('tutor.conversation.pauseBeforeReply', value)).toBeUndefined();
  });

  it('V186 patches the pause select and summary in place through its message handler', () => {
    // Changed 2026-10-02: V186b exercises the review's control sequence against the
    // full-render summary instead of supplying an already complete summary stub.
    const tutor = createTutorViewState();
    tutor.conversation.status = 'active';
    const rendered = render(800, tutor);
    const $ = load(rendered);
    const sourceOf = (name: string) => {
      const start = rendered.indexOf(`function ${name}(`);
      expect(start, name).toBeGreaterThan(-1);
      return rendered.slice(start, rendered.indexOf('\n    }\n', start) + 6);
    };
    const handler = rendered.match(/if \(message.command === 'tutorConversationPauseBeforeReply'\)[^\n]+/u)![0];
    const summarySelector = '[data-tutor-conversation-advanced] > summary .rewrite-group-summary';
    class Element { textContent = ''; getAttribute() { return null; } hasAttribute() { return false; } }
    class Input extends Element { checked = false; }
    class Select extends Element {
      value: string;
      disabled = false;
      constructor(private readonly selector: string) { super(); this.value = $(selector).val() as string; }
      get selectedOptions() { return [{ textContent: $(this.selector).find(`option[value="${this.value}"]`).text() }]; }
      closest() { return null; }
    }
    const summary = Object.assign(new Element(), { textContent: $(summarySelector).text() });
    const controls: Record<string, Element> = { [summarySelector]: summary };
    $('select').each((_i, node) => {
      const attribute = Object.keys(node.attribs).find((name) => name === 'data-setting' || name.startsWith('data-tutor-conversation-'));
      if (!attribute) return;
      const selector = attribute === 'data-setting' ? `[data-setting="${node.attribs[attribute]}"]` : `[${attribute}]`;
      controls[selector] = new Select(selector);
    });
    const control = controls['[data-setting="tutor.conversation.pauseBeforeReply"]'] as Select;
    const pressToTalk = '[data-setting="tutor.conversation.pressToTalk"]';
    // 2026-10-10: V217 adds a second conversation switch; initialize both from the rendered controls.
    for (const key of ['pressToTalk', 'takeHome']) {
      const selector = `[data-setting="tutor.conversation.${key}"]`;
      controls[selector] = Object.assign(new Input(), { checked: $(selector).is(':checked') });
    }
    const answer = { value: 'Keep my unfinished answer.' };
    const context = { document: { querySelector: (selector: string) => controls[selector] ?? null },
      HTMLElement: Element, HTMLSelectElement: Select, HTMLInputElement: Input,
      // 2026-10-12: Mode synchronization also updates the mounted composer visibility.
      HTMLTextAreaElement: Element, HTMLButtonElement: Element,
      syncTutorConversationPictureSettings: () => {}, syncTutorPictureMicrophone: () => {},
      updateTutorLiveReplay: () => {}, updateTutorReplayMode: () => {},
      // 2026-10-11: V223 refreshes profile visibility alongside the mode summary.
      applyConditionalSettings: () => {},
      message: { command: 'tutorConversationPauseBeforeReply', seconds: 1 }, answer };
    const functions = ['tutorConversationAdvancedSummary', 'syncTutorConversationAdvancedSummary',
      'syncTutorConversationMode', 'patchTutorConversationPauseBeforeReply',
      'patchTutorConversationSpeechDetection', 'syncTutorSpeechDetection'].map(sourceOf).join('\n');
    for (const [key, value] of [['situationPicture', 'graduallyEntering'], ['pictureTransparency', '40'], ['balloonTransparency', '30']] as const) {
      Object.assign(tutor.conversation, { [key]: value });
      const attribute = key === 'situationPicture' ? 'situation-picture' : key === 'pictureTransparency' ? 'picture-transparency' : 'balloon-transparency';
      const changed = controls[`[data-tutor-conversation-${attribute}]`] as Select;
      changed.value = value;
      runInNewContext(functions + '\nsyncTutorConversationMode(changed);', { ...context, changed });
      expect(summary.textContent).toBe(load(render(800, tutor))(summarySelector).text());
      expect(summary.textContent).toMatch(/Microphone: Balanced, 5sec/u);
      expect(answer.value).toBe('Keep my unfinished answer.');
    }
    runInNewContext(functions + handler, context);
    expect(control.value).toBe('1');
    expect(summary.textContent).toContain('Microphone: Balanced, 1sec,');
    expect(summary.textContent).toBe(load(render(800, tutor, 1))(summarySelector).text());
    expect(answer.value).toBe('Keep my unfinished answer.');
    // 2026-10-02: V187 updates the stored select and shared summary without replacing the composer.
    const speech = controls['[data-setting="tutor.conversation.speechDetection"]'] as Select & { title: string };
    runInNewContext(functions + "patchTutorConversationSpeechDetection({ value: 'geminiKren' });", context);
    expect(speech.value).toBe('geminiKren');
    expect(summary.textContent).toContain('Gemini + KREN');
    (controls[pressToTalk] as Input).checked = true;
    runInNewContext(functions + 'syncTutorSpeechDetection();', context);
    expect(speech.disabled).toBe(true);
    expect(speech.title).toBe('Press to talk uses KREN detection.');
    expect(speech.value).toBe('geminiKren');
    (controls[pressToTalk] as Input).checked = false;
    runInNewContext(functions + 'syncTutorSpeechDetection();', context);
    expect(speech.disabled).toBe(false);
    expect(speech.title).toBe('');
    runInNewContext(functions + "patchTutorConversationSpeechDetection({ value: 'invalid' });", context);
    expect(speech.value).toBe('geminiKren');
    expect(answer.value).toBe('Keep my unfinished answer.');
    context.message.seconds = 9;
    runInNewContext(functions + handler, context);
    expect(control.value).toBe('1');
  });
});
