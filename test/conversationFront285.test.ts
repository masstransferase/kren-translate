// Changed 2026-10-21 (owner, I56/I57): verify reachable entry actions against the shipped webview script.
import { describe, expect, it, vi } from 'vitest';
import { load } from 'cheerio';
import { parse } from 'postcss';
import { renderKrenResultViewHtml, renderTutorConversation } from '../src/resultViewHtml.js';
import { TUTOR_DEFAULTS } from '../src/tutor/defaults.js';
import { TUTOR_LESSON_UNAVAILABLE } from '../src/tutor/lessonConversation.js';
import { createTutorViewState, tutorConversationPreferences } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

function render(state = createTutorViewState()) {
  return renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'tutor',
    settings: { ...PANEL_SETTINGS_FIXTURE, credentialPresence: { ...PANEL_SETTINGS_FIXTURE.credentialPresence, geminiDefault: true } }, tutor: state, proModels: [] });
}
function setup(state = createTutorViewState(), open = false) {
  const postMessage = vi.fn();
  const html = render(state);
  const panel = mountedPanel(html, postMessage, { state: { openSections: { 'tutor-conversation-mode': open } } });
  postMessage.mockClear();
  return { panel, html, postMessage, mode: panel.query('details[data-persist-id="tutor-conversation-mode"]')! };
}
function visibleButtons(panel: ReturnType<typeof mountedPanel>) {
  return panel.query('[data-tutor-conversation-entry-actions]')!.children.filter(button => !button.hidden);
}

describe('V285 Conversation front actions', () => {
  it('defaults to A situation and preserves a saved lesson choice without completion', () => {
    expect(TUTOR_DEFAULTS.conversation.from).toBe('situation');
    const state = createTutorViewState();
    expect(state.conversation.from).toBe('situation');
    expect(tutorConversationPreferences({ from: 'lesson' })).toEqual({ from: 'lesson' });
    const { panel } = setup(state);
    expect(panel.query('[data-tutor-conversation-from]')!.value).toBe('situation');
  });

  it('keeps the closed MODE summary and shows Setting, Start, Demo with the shared Lesson size rule', () => {
    const state = createTutorViewState();
    const { panel, mode, html } = setup(state);
    expect(mode.open).toBe(false);
    const summary = mode.querySelector('summary')!.textContent;
    for (const label of ['MODE', 'Source: A situation', 'Situation:', 'Roles:', 'Who starts:', 'Register:', 'Correction:', 'Sends when you stop']) {
      expect(summary).toContain(label);
    }
    expect(visibleButtons(panel).map(button => button.textContent)).toEqual(['Setting', 'Start', 'Demo']);
    expect(visibleButtons(panel).slice(1).map(button => button.getAttribute('data-command')))
      .toEqual(['startTutorConversation', 'startTutorConversationDemo']);
    const row = panel.query('[data-tutor-conversation-entry-actions]')!;
    expect(row.classList.contains('tutor-conversation-front-actions')).toBe(true);
    let shared = false;
    parse(load(html)('style').text()).walkRules(rule => {
      if (rule.selectors.includes('.tutor-heading-actions > button') && rule.selectors.includes('.tutor-conversation-front-actions > button')) {
        shared = true;
        const values: Record<string, string> = {};
        rule.walkDecls(decl => { values[decl.prop] = decl.value; });
        expect(values).toMatchObject({ width: '60px', 'box-sizing': 'border-box', 'padding-left': '6px', 'padding-right': '6px' });
      }
    });
    expect(shared).toBe(true);
    expect(panel.query('.tutor-conversation-invitation')!.textContent).toMatch(/start.*speak.*microphone/i);
  });

  it('Setting opens MODE, scrolls and focuses the summary, and changes no option', () => {
    const state = createTutorViewState();
    Object.assign(state.conversation, { from: 'lesson', register: 'formal', starts: 'learner', rolesSwapped: true });
    const { panel, mode, postMessage } = setup(state);
    expect(panel.query('[data-tutor-conversation-from]')!.value).toBe('lesson');
    const before = panel.document.querySelectorAll('.tutor-conversation-settings select, .tutor-conversation-settings input')
      .map(control => [control.value, control.checked]);
    const scroll = vi.spyOn(mode, 'scrollIntoView').mockImplementation(() => { expect(mode.open).toBe(true); });
    panel.click(panel.query('[data-tutor-open-conversation-settings]')!);
    expect(mode.open).toBe(true);
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(panel.document.activeElement).toBe(mode.querySelector('summary'));
    expect(postMessage).not.toHaveBeenCalled();
    expect(panel.document.querySelectorAll('.tutor-conversation-settings select, .tutor-conversation-settings input')
      .map(control => [control.value, control.checked])).toEqual(before);
    expect(visibleButtons(panel).map(button => button.textContent)).toEqual(['Start', 'Demo', 'Reset']);
    expect(panel.query('[data-tutor-conversation-entry-actions]')!.classList.contains('tutor-conversation-front-actions')).toBe(false);
  });

  it('follows summary toggles in both directions and restores open MODE after a redraw or in-place patch', () => {
    const { panel, mode } = setup();
    mode.open = true;
    panel.event(mode, 'toggle');
    expect(visibleButtons(panel).map(button => button.textContent)).toEqual(['Start', 'Demo', 'Reset']);
    panel.message({ command: 'tutorConversationRender', html: render() });
    expect(panel.query('details[data-persist-id="tutor-conversation-mode"]')!.open).toBe(true);
    expect(visibleButtons(panel).map(button => button.textContent)).toEqual(['Start', 'Demo', 'Reset']);
    const current = panel.query('details[data-persist-id="tutor-conversation-mode"]')!;
    current.open = false;
    panel.event(current, 'toggle');
    expect(visibleButtons(panel).map(button => button.textContent)).toEqual(['Setting', 'Start', 'Demo']);
    const restored = setup(createTutorViewState(), true);
    expect(restored.mode.open).toBe(true);
    expect(visibleButtons(restored.panel).map(button => button.textContent)).toEqual(['Start', 'Demo', 'Reset']);
  });

  it('keeps disabled lesson Start and Demo outside collapsed details with the completion tooltip and Setting enabled', () => {
    const state = createTutorViewState();
    state.conversation.from = 'lesson';
    const { panel } = setup(state);
    for (const command of ['startTutorConversation', 'startTutorConversationDemo']) {
      const button = panel.query(`[data-command="${command}"]`)!;
      expect(button.disabled).toBe(true);
      expect(button.title).toBe(TUTOR_LESSON_UNAVAILABLE);
      expect(button.closest('details, [hidden]')).toBeNull();
    }
    const setting = panel.query('[data-tutor-open-conversation-settings]')!;
    expect(setting.disabled).toBe(false);
    expect(setting.getAttribute('data-command')).toBeNull();
    expect(panel.query('.tutor-conversation-start')!.textContent).not.toContain(TUTOR_LESSON_UNAVAILABLE);
    expect(panel.query('[data-command="useTutorSituationSource"]')).toBeNull();
  });

  it('keeps every available front action keyboard reachable outside disclosures and posts the existing commands', () => {
    const { panel, postMessage, mode } = setup();
    for (const open of [false, true]) {
      mode.open = open;
      panel.event(mode, 'toggle');
      for (const button of visibleButtons(panel)) {
        expect(button.tagName).toBe('BUTTON');
        expect(button.closest('details, [hidden]')).toBeNull();
        expect(button.getAttribute('tabindex')).not.toBe('-1');
        expect(button.disabled).toBe(false);
        if (!button.disabled) {
          button.focus();
          expect(panel.document.activeElement).toBe(button);
        }
      }
    }
    for (const command of ['startTutorConversation', 'startTutorConversationDemo']) {
      panel.click(panel.query(`[data-command="${command}"]`)!);
      expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ command }));
    }
    const coach = createTutorViewState();
    coach.conversation.from = 'speakAndRephrase';
    expect(load(renderTutorConversation(coach))('[data-command="startTutorConversationDemo"]')).toHaveLength(0);
  });
});
