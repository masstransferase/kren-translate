import { describe, expect, it } from 'vitest';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { createTutorViewState } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

const modeSelector = 'details[data-persist-id="tutor-conversation-mode"]';
const advancedSelector = 'details[data-tutor-conversation-advanced]';
const modeOrder = ['Source', 'Situation', 'Swap roles', 'Who starts', 'Register', 'Correction', 'Replies', 'Situation picture'];
const advancedOrder = ['Live transcription language', 'Reply length', 'Picture style', 'Picture transparency',
  'Balloon transparency', 'Microphone sensitivity', 'Pause before reply', 'Speech detection', 'Microphone close wait',
  'Press to talk', 'Prepare hints in advance', 'Take-home card'];

function html(options: { active?: boolean; coach?: boolean; live?: boolean; picture?: 'none' | 'intro' | 'switching' | 'graduallyEntering' } = {}) {
  const tutor = createTutorViewState();
  Object.assign(tutor.conversation, { from: options.coach ? 'speakAndRephrase' : 'situation',
    status: options.active ? 'active' : 'idle', replies: options.live ? 'liveGemini' : 'standard',
    situationPicture: options.picture ?? 'none', currentQuestion: options.active ? 'How can I help?' : '' });
  return renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'tutor', tutor,
    settings: PANEL_SETTINGS_FIXTURE, proModels: [] });
}

describe('V309 MODE rows', () => {
  it('makes Replies and Situation picture reachable from Setting without opening ADVANCED', () => {
    const panel = mountedPanel(html(), () => {});
    const mode = panel.query(modeSelector)!;
    const advanced = panel.query(advancedSelector)!;
    expect(mode.open).toBe(false);
    expect(advanced.open).toBe(false);
    const setting = panel.query('[data-tutor-open-conversation-settings]')!;
    expect(setting).not.toBeNull();
    expect(setting.disabled).toBe(false);
    expect(setting.getAttribute('tabindex')).not.toBe('-1');
    panel.click(setting);
    expect(mode.open).toBe(true);
    expect(advanced.open).toBe(false);
    const titles = (group: typeof mode) => group.querySelectorAll('.setting-title')
      .filter(title => title.closest('details') === group).map(title => title.textContent);
    expect(titles(mode)).toEqual(modeOrder);
    expect(titles(advanced)).toEqual(advancedOrder);
    for (const selector of ['[data-tutor-conversation-replies]', '[data-tutor-conversation-situation-picture]']) {
      const control = panel.query(selector)!;
      expect(control.closest('details')).toBe(mode);
      expect(control.closest('.hidden, [hidden]')).toBeNull();
      expect(control.disabled).toBe(false);
      expect(control.getAttribute('tabindex')).not.toBe('-1');
      control.focus();
      expect(panel.document.activeElement).toBe(control);
    }
  });

  it.each([false, true])('folded summaries keep the moved values only in MODE, Live %s', live => {
    const panel = mountedPanel(html({ live, picture: 'graduallyEntering' }), () => {});
    const mode = panel.query(modeSelector)!;
    expect(mode.open).toBe(false);
    const summary = panel.query(modeSelector + ' > summary .rewrite-group-summary')!;
    expect(summary.textContent).toContain(`Reply: ${live ? 'Live (Gemini)' : 'Standard'}`);
    expect(summary.textContent).toContain('Picture: Gradually Entering');
    const advanced = panel.query(advancedSelector + ' > summary .rewrite-group-summary')!;
    expect(advanced.textContent).not.toMatch(/Reply:|Gradually Entering/);
    expect(advanced.textContent).toContain('Realistic');
  });

  it('patches MODE, Live rows and note, and picture dependencies without replacing the controls', () => {
    const messages: Record<string, unknown>[] = [];
    const panel = mountedPanel(html(), message => messages.push(message));
    const modeSummary = panel.query(modeSelector + ' > summary .rewrite-group-summary')!;
    const advancedSummary = panel.query(advancedSelector + ' > summary .rewrite-group-summary')!;
    const replies = panel.query('[data-tutor-conversation-replies]')!;
    const picture = panel.query('[data-tutor-conversation-situation-picture]')!;
    const note = panel.query('[data-setting="tutor.readAloud.sentencePauseMilliseconds"]')!.closest('label')!.querySelector('.setting-description')!;
    for (const value of ['liveGemini', 'standard']) {
      replies.value = value; panel.change(replies);
      expect(modeSummary.textContent).toContain(`Reply: ${value === 'liveGemini' ? 'Live (Gemini)' : 'Standard'}`);
      expect(note.textContent).toBe(value === 'liveGemini' ? 'Gemini Live sets its own pauses.' : 'Pause between sentences in tutor speech.');
      // Coordinator 2026-10-24: Live rows stay visible whatever Replies is (V308); V309 moves rows only.
      expect(messages).toContainEqual({ command: 'updateTutorConversationReplies', input: value });
    }
    for (const value of ['intro', 'switching', 'graduallyEntering', 'none']) {
      picture.value = value; panel.change(picture);
      expect(modeSummary.textContent).toContain('Picture: ' + picture.selectedOptions[0]!.textContent);
      for (const selector of ['[data-setting="tutor.conversation.pictureStyle"]', '[data-tutor-conversation-picture-transparency]', '[data-tutor-conversation-balloon-transparency]']) {
        expect(panel.query(selector)!.disabled).toBe(value === 'none');
      }
      expect(messages).toContainEqual({ command: 'updateTutorConversationSituationPicture', input: value });
      expect(advancedSummary.textContent).not.toContain('Reply:');
      expect(advancedSummary.textContent).not.toContain(picture.selectedOptions[0]!.textContent);
    }
    expect(panel.query('[data-tutor-conversation-replies]')).toBe(replies);
    expect(panel.query('[data-tutor-conversation-situation-picture]')).toBe(picture);
    expect(panel.query(modeSelector + ' > summary .rewrite-group-summary')).toBe(modeSummary);
  });

  it.each([{ active: false, coach: false }, { active: true, coach: false }, { active: false, coach: true }, { active: true, coach: true }])(
    'keeps disabled conditions and explanations for %j', options => {
      const panel = mountedPanel(html(options), () => {});
      const replies = panel.query('[data-tutor-conversation-replies]')!;
      const picture = panel.query('[data-tutor-conversation-situation-picture]')!;
      expect(replies.disabled).toBe(options.active && !options.coach);
      expect(picture.disabled).toBe(options.coach);
      expect(replies.closest('label')!.querySelector('.setting-description')!.textContent)
        .toBe('Whether Gemini speaks with you live, from the next conversation.');
      expect(picture.closest('label')!.querySelector('.setting-description')!.textContent)
        .toBe(options.coach ? 'Not used in Speak and rephrase.' : 'A picture of the scene behind the conversation, made by the chosen picture provider.');
      expect(picture.closest('label')!.hasAttribute('data-tutor-coach-unused')).toBe(options.coach);
    }
  );
});
