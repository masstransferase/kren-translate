// 2026-10-12: Replies precedes Send; Reply thinking was retired by the owner.
import { TUTOR_DEFAULTS } from '../src/tutor/defaults.js';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { hostSource } from './support/hostSource.js';
import { describe, expect, it } from 'vitest';
import { load } from 'cheerio';
import { parse as parseCss } from 'postcss';
import { iconSvgMarkup } from '@kren/core/icons';
import { TUTOR_SITUATIONS, TUTOR_MAP } from '@kren/core/tutor';
import { renderKrenResultViewHtml, renderTutorConversation } from '../src/resultViewHtml.js';
import { createTutorViewState } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

function state() {
  const state = createTutorViewState();
  Object.assign(state.conversation, { from: 'situation', status: 'active',
    currentQuestion: 'Where did you go?', transcript: Array.from({ length: 5 }, (_, i) => ({
      question: `Question ${i}?`, learnerAnswer: `Answer ${i}.`, correction: `Corrected ${i}.`,
      explanation: `Explanation ${i}.`, nextQuestion: `Next ${i}?`, targetId: TUTOR_MAP[0]!.id,
      move: 'recast', reply: `Reply ${i}.`
    })), currentTurnIndex: 2 });
  return state;
}
function page(value = state(), tutorConversationReplayAvailable = false) {
  return load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
    activeScreen: 'tutor', tutor: value, proModels: [], tutorConversationReplayAvailable }));
}
function declarations($: ReturnType<typeof page>, selector: string) {
  const values: Record<string, string> = {};
  parseCss($('style').text()).walkRules((rule) => {
    if (rule.selectors.includes(selector)) rule.walkDecls((decl) => { values[decl.prop] = decl.value; });
  });
  return values;
}

function conversationModeReader(value: ReturnType<typeof state>, remembered: boolean) {
  const output = renderKrenResultViewHtml({
    cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
    activeScreen: 'tutor', tutor: value, proModels: []
  });
  const tag = output.match(/<details[^>]*data-persist-id="tutor-conversation-mode"[^>]*>/u)?.[0] ?? '';
  class Details {
    public open = /\sopen(?:\s|>)/u.test(tag);
    public getAttribute(name: string): string | null {
      return tag.match(new RegExp(`${name}="([^"]*)"`, 'u'))?.[1] ?? null;
    }
  }
  const section = new Details();
  let saved = { openSections: { 'tutor-conversation-mode': remembered } };
  let onToggle: (event: { target: Details }) => void = () => {};
  const script = output.match(/<script nonce="test">([\s\S]*?)<\/script>/u)?.[1] ?? '';
  runInNewContext(script.slice(0, script.indexOf('const activeScreen =')), {
    acquireVsCodeApi: () => ({
      getState: () => saved,
      setState: (value: typeof saved) => { saved = value; }
    }),
    HTMLDetailsElement: Details,
    document: {
      querySelectorAll: () => [section],
      addEventListener: (_name: string, handler: typeof onToggle) => { onToggle = handler; }
    }
  });
  return {
    section,
    saved: () => saved.openSections['tutor-conversation-mode'],
    toggle: (open: boolean) => { section.open = open; onToggle({ target: section }); }
  };
}

describe('V89 conversation controls', () => {
  it('V112 starts a new tutor session with its conversation speaker on', () => {
    // Changed 2026-09-17: KREN speaks the first question unless the reader turns it off.
    expect(createTutorViewState().conversation.speakerOn).toBe(true);
  });

  it('V106 places the conversation introduction between its heading and box', () => {
    const $ = page();
    const heading = $('#tutor-conversation-heading');
    const introduction = heading.next();

    expect(introduction.is('p.tutor-conversation-intro')).toBe(true);
    expect(introduction.text()).toBe('Talk with KREN in English. It answers, shows corrections under your turns, and the transcript stays in this tutor session.');
    expect(introduction.next().is('section[data-tutor-result="conversation"]')).toBe(true);
    expect(introduction.parents('[data-tutor-result="conversation"]')).toHaveLength(0);
  });

  it('R1 keeps diagnosis cancellation paired with its overlay while a conversation turn runs', () => {
    const value = state();
    value.conversation.busy = true;
    value.askBusy = 'conversationDiagnosis';
    const $ = page(value);
    const overlay = $('.busy-overlay');
    expect(overlay.text()).toContain('Diagnosing your conversation. Please wait.');
    expect(overlay.find('[data-command="cancelTutorAsk"]')).toHaveLength(1);
    expect(overlay.find('[data-command="stopTutorConversation"]')).toHaveLength(0);
    expect($('[data-tutor-result="conversation"]').attr('inert')).toBeUndefined();
  });

  it('V118 shows only an accessible typing bubble while KREN writes the opening', () => {
    const value = state();
    Object.assign(value.conversation, {
      status: 'active', busy: true, currentQuestion: '', transcript: [], pendingAnswer: undefined
    });
    const $ = load(renderTutorConversation(value));
    const transcript = $('[data-tutor-transcript]');
    const typing = transcript.children('[data-tutor-typing]');

    expect(typing).toHaveLength(1);
    expect(typing.attr('role')).toBe('status');
    expect(typing.attr('aria-label')).toBe('KREN is typing');
    expect(typing.find('.tutor-typing-dot')).toHaveLength(3);
    expect(transcript.children('[data-tutor-kren-bubble]:not([data-tutor-typing])')).toHaveLength(0);
    expect(transcript.find('[data-tutor-learner-turn]')).toHaveLength(0);
  });

  it('V118 replaces both waiting sentences with non-animated-on-request typing dots', () => {
    const value = state();
    Object.assign(value.conversation, {
      busy: true, pendingAnswer: 'This answer is already sent.', draftAnswer: ''
    });
    const $ = page(value);
    const typing = $('[data-tutor-transcript] [data-tutor-typing]');

    expect(typing).toHaveLength(1);
    expect(typing.attr('role')).toBe('status');
    expect(typing.attr('aria-label')).toBe('KREN is typing');
    expect(typing.text()).toBe('...');
    expect($.html()).not.toContain('Continuing the conversation. Please wait.');
    expect($.html()).not.toContain('Writing the opening. Please wait.');
    // Added 2026-09-18: reduced motion stops the dots instead of merely slowing them.
    expect($('style').text()).toContain(
      '@media (prefers-reduced-motion: reduce) { .tutor-typing-dot { animation: none; } }'
    );
  });

  it.each([
    { name: 'an answer pending', pendingAnswer: 'I need a frying pan.', busy: true },
    { name: 'only the typing bubble showing', pendingAnswer: undefined, busy: true },
    { name: 'neither a pending answer nor typing', pendingAnswer: undefined, busy: false }
  ])('V144 keeps Hint immediately above the composer with $name', ({ pendingAnswer, busy }) => {
    const value = state();
    Object.assign(value.conversation, {
      hint: {
        explanation: 'Ask whether the shop has the item you need.',
        example: 'Do you have this kettle in a smaller size?'
      },
      pendingAnswer,
      busy
    });
    const $ = load(renderTutorConversation(value));
    const transcript = $('[data-tutor-transcript]');
    const hint = $('[data-tutor-hint]');

    // Added 2026-09-23: Hint belongs to the answer area, not to transcript content whose
    // length changes while an answer and KREN's typing bubble are in flight.
    expect(hint.parents('[data-tutor-transcript]')).toHaveLength(0);
    expect(hint.next().is('[data-tutor-composer]')).toBe(true);
    expect(transcript.find('[data-tutor-pending]')).toHaveLength(pendingAnswer === undefined ? 0 : 1);
    expect(transcript.find('[data-tutor-typing]')).toHaveLength(busy ? 1 : 0);
  });

  it('R1 renders as ordinary tutor output without drawer positioning or a focus trap', () => {
    const $ = page();
    const conversation = $('.tutor-page > .tutor-conversation[data-tutor-result="conversation"]');
    expect(conversation).toHaveLength(1);
    expect(conversation.is('section[role="region"]')).toBe(true);
    expect(conversation.parents('details')).toHaveLength(0);
    expect(conversation.find('[aria-modal], [role="dialog"]')).toHaveLength(0);
    expect($('[data-tutor-conversation-launcher], [data-command="closeTutorConversation"]')).toHaveLength(0);
    expect(declarations($, '.tutor-drawer')).toMatchObject({ position: 'fixed', inset: '10px' });
    expect(declarations($, '.tutor-conversation')).not.toHaveProperty('position');
    // Changed 2026-09-27: the embedded section remains nonmodal, while its transcript
    // now scrolls under a stationary situation picture.
    expect(declarations($, '.tutor-chat-transcript')).toMatchObject({
      'overflow-x': 'hidden', 'overflow-y': 'auto'
    });
    expect(declarations($, '.tutor-conversation')).not.toHaveProperty('overflow-y');
    expect($('script').text()).not.toContain('const conversationDrawer =');
  });

  // Changed 2026-10-15: V241, owner item I6, review actions appear only after Stop.
  it('R1 carries the situation in MODE and keeps the diagnosis action in the section', () => {
    const value = state();
    const $ = page(value);
    const conversation = $('[data-tutor-result="conversation"]');
    expect(conversation.text()).toContain(TUTOR_SITUATIONS[0]!.label);
    // Changed 2026-09-16: V107 removes the three state-reporting facts and puts the
    // selected situation in the MODE summary instead.
    expect(conversation.find('details[data-persist-id="tutor-conversation-mode"] > summary').text())
      .toContain(`Situation: ${TUTOR_SITUATIONS[0]!.label}`);
    expect(conversation.find('[data-tutor-conversation-facts]')).toHaveLength(0);
    expect(conversation.find('[data-command="diagnoseTutorConversation"]')).toHaveLength(0);
    value.conversation.transcript.push({ question: 'Skipped?', learnerAnswer: '', correction: '', explanation: '', nextQuestion: 'Next?', skipped: true });
    expect(page(value)('[data-tutor-result="conversation"] [data-tutor-conversation-facts]'))
      .toHaveLength(0);
  });

  // Changed 2026-10-15: V241, owner item I6, the active transcript has no diagnosis action.
  it('R2 folds every correction into the complete transcript before the composer', () => {
    const value = state();
    const $ = page(value);
    expect($('[data-tutor-transcript] [data-tutor-kren-bubble]')).toHaveLength(11);
    expect($('[data-tutor-transcript]').text()).toContain('Corrected 0.');
    expect($('[data-tutor-transcript]').text()).toContain('Corrected 4.');
    // Changed 2026-09-16: V107 removes the disclosure, so diagnosis follows the transcript.
    // Changed 2026-09-27: the picture viewport is the transcript's wrapper.
    expect($('[data-tutor-transcript]').parent().next().is('[data-tutor-conversation-actions]')).toBe(true);
    expect($('.tutor-conversation-disclosure')).toHaveLength(0);
    // Changed 2026-09-23: V144 inserts the stable Hint block outside the transcript and
    // immediately above the composer, after the conversation-level action row.
    expect($('[data-tutor-conversation-actions]').next().is('[data-tutor-hint]')).toBe(true);
    expect($('[data-tutor-hint]').next().is('[data-tutor-composer]')).toBe(true);
    expect($('[data-tutor-coach], [data-tutor-conversation-turn], .tutor-coach-strip')).toHaveLength(0);
    expect($('[data-command="showPreviousTutorConversationTurn"], [data-command="showNextTutorConversationTurn"]'))
      .toHaveLength(0);
    expect($('[data-tutor-turn-explanation]')).toHaveLength(5);
    expect($('[data-tutor-turn-explanation] [data-command="askTutorConversationTurn"]')).toHaveLength(5);
    expect($('[data-tutor-conversation-actions] [data-command="diagnoseTutorConversation"]')).toHaveLength(0);
  });

  it('R3 renders exactly the core groups and situations with the written option last', () => {
    const value = state();
    value.conversation.status = 'idle';
    const $ = page(value);
    const select = $('[data-tutor-conversation-situation]');
    const groups = [...new Set(TUTOR_SITUATIONS.map((entry) => entry.group))];
    // Changed 2026-09-25 for V156: My own situation now has the owner's chosen native group.
    expect(select.children('optgroup').map((_, el) => $(el).attr('label')).get())
      .toEqual([...groups, 'Your own']);
    for (const group of groups) {
      expect(select.children(`optgroup[label="${group}"]`).find('option').map((_, el) => $(el).attr('value')).get())
        .toEqual(TUTOR_SITUATIONS.filter((entry) => entry.group === group).map((entry) => entry.id));
    }
    expect(select.find('option').map((_, el) => $(el).attr('value')).get())
      .toEqual(['auto', ...TUTOR_SITUATIONS.map((entry) => entry.id), 'custom']);
    expect(select.children().last().attr('label')).toBe('Your own');
    expect(select.children().last().find('option').attr('value')).toBe('custom');
    // Changed 2026-09-24 for V150: the retained scene owns the one slot between MODE and the
    // transcript. It begins hidden while idle, then the existing opening request patches it.
    const scene = $('[data-tutor-conversation-setup]').next();
    expect(scene.is('[data-tutor-scene][hidden]')).toBe(true);
    // Changed 2026-10-04: V205's picture notice can sit between the scene and viewport.
    expect(scene.nextAll('[data-tutor-picture-viewport]').first().is('[data-tutor-picture-viewport]')).toBe(true);
    expect(scene.nextAll('[data-tutor-picture-viewport]').first().find('[data-tutor-transcript]')).toHaveLength(1);
    expect($('[data-tutor-conversation-facts]')).toHaveLength(0);
  });

  it('V137 freezes model-defining choices while input-side choices stay live', () => {
    const value = state();
    value.conversation.status = 'idle';
    for (const situation of TUTOR_SITUATIONS) {
      value.conversation.situationId = situation.id;
      value.conversation.register = situation.register;
      // 2026-09-17: this loop rendered the whole panel 41 times and timed out at 5 seconds
      // under full-suite load while passing alone. The conversation is what it asserts.
      const $ = load(renderTutorConversation(value));
      expect($('[data-tutor-conversation-register]').val()).toBe(situation.register);
      expect($('[data-tutor-conversation-register]').is('select')).toBe(true);
      expect($('[data-tutor-conversation-register] option').map((_, element) => $(element).text()).get())
        .toEqual(['Casual', 'Neutral', 'Professional', 'Formal']);
      expect($('[data-tutor-conversation-register]').attr('contenteditable')).toBeUndefined();
    }
    // Changed 2026-09-16: V106 keeps the same three setting rows in all frames. Situation
    // remains readable but disabled outside A situation, instead of disappearing.
    // Changed 2026-10-17: V262, owner item I39, the fourth Source keeps the same MODE rows.
    for (const from of ['situation', 'lesson', 'anything', 'speakAndRephrase'] as const) {
      value.conversation.from = from;
      const $ = page(value);
      const setup = $('[data-tutor-conversation-setup]');
      // Changed 2026-09-25 for V152: role and starter are session-only MODE controls.
      // Changed 2026-09-26: V166 adds one reachable ADVANCED setting.
      // 2026-10-01: V178 adds the transparency row immediately below the picture switch.
      // 2026-10-02: V182 adds one balloon-background control without retiring other settings.
      // Changed 2026-10-02: V186 adds Pause before reply without removing a setting.
      // 2026-10-02: V187 adds Speech detection without retiring any control.
      // Changed 2026-10-03: Live transcription language is the nineteenth MODE row.
      // 2026-10-10: V217 adds the Take-home card switch without retiring any existing control.
      // 2026-10-11: V218 adds Picture style without retiring an existing setup control.
      // 2026-10-11: V220 adds the writable advance-hint switch.
      expect(setup.find('.setting')).toHaveLength(20); // Changed 2026-10-18: V263, owner item I43, the Send setting was removed.
      expect(setup.find('[data-setting="tutor.conversation.liveTranscriptionLanguage"]')).toHaveLength(1);
      expect(setup.find('.setting').filter((_, row) => $(row).find('[data-setting="tutor.conversation.liveTranscriptionLanguage"]').length === 0).find('.setting-title').map((_, element) => $(element).text()).get())
        // Changed 2026-10-02: V186 adds the separate Live pause beside sensitivity.
        .toEqual(['Source', 'Situation', 'Swap roles', 'Who starts', 'Register', 'Correction', 'Replies', 'Reply length', 'Situation picture', 'Picture style', 'Picture transparency', 'Balloon transparency', 'Microphone sensitivity', 'Pause before reply', 'Speech detection', 'Microphone close wait', 'Press to talk', 'Prepare hints in advance', 'Take-home card']);
      const advanced = setup.find('details[data-tutor-conversation-advanced]');
      expect(advanced.find('.setting').filter((_, row) => $(row).find('[data-setting="tutor.conversation.liveTranscriptionLanguage"]').length === 0).find('.setting-title').map((_, element) => $(element).text()).get())
        // Changed 2026-10-02: preserve the required order with the new Live pause.
        .toEqual(['Replies', 'Reply length', 'Situation picture', 'Picture style', 'Picture transparency', 'Balloon transparency', 'Microphone sensitivity', 'Pause before reply', 'Speech detection', 'Microphone close wait', 'Press to talk', 'Prepare hints in advance', 'Take-home card']);
      expect(setup.html()).not.toContain('.tutor-conversation-advanced');
      expect(setup.find('[data-tutor-conversation-from]')).toHaveLength(1);
      expect(setup.find('[data-tutor-conversation-situation]')).toHaveLength(1);
      expect(setup.find('[data-tutor-conversation-register]')).toHaveLength(1);
      expect(setup.find('[data-tutor-conversation-coaching]')).toHaveLength(1);
      expect(setup.find('[data-tutor-conversation-answers]')).toHaveLength(0);
      // Changed 2026-10-18: V263, owner item I43, no Source offers a Send row.
      expect(setup.find('[data-tutor-conversation-send]')).toHaveLength(0);
      expect(setup.find('[data-tutor-conversation-replies]')).toHaveLength(1);
      // Changed 2026-10-04: lesson Situation remains active, Anything has no situation.
      // Changed 2026-10-17: V262, owner item I39, coach mode also disables Situation.
      expect(setup.find('[data-tutor-conversation-situation]').is(':disabled')).toBe(from === 'anything' || from === 'speakAndRephrase');
    }
    // Changed 2026-10-17: V262, owner item I39, retain this active-state check for the original Anything Source.
    value.conversation.from = 'anything';
    value.conversation.status = 'active';
    const active = page(value)('[data-tutor-conversation-setup]');
    // Changed 2026-09-25 for V152: the role toggle and starter dropdown are frozen with setup.
    // Changed 2026-09-26: V166 adds Situation picture as the eighth ADVANCED row.
    // 2026-10-01: V178 adds one native select to the active conversation settings.
    // 2026-10-02: The active panel also retains the new transparency control.
    // Changed 2026-10-02: the next-conversation pause remains reachable during chat.
    // 2026-10-02: V187 keeps Speech detection reachable as a next-conversation choice.
    // Changed 2026-10-03: the moved language choice stays reachable during chat.
    // 2026-10-10: V217 keeps the Take-home card switch available during a conversation.
    // 2026-10-11: the added Picture style row also remains present during a conversation.
    // 2026-10-11: advance hints remain available during an active conversation.
    expect(active.find('.setting')).toHaveLength(20); // Changed 2026-10-18: V263, owner item I43, the Send setting was removed.
    expect(active.find('[data-setting="tutor.conversation.liveTranscriptionLanguage"]').is(':disabled')).toBe(false);
    // 2026-10-01: V181 replaces the picture switch with a mode select that stays available during chat.
    // 2026-10-02: Balloon transparency is the fourteenth native select.
    // Changed 2026-10-02: Pause before reply adds the fifteenth native select.
    // 2026-10-02: V187 adds the sixteenth select and keeps every existing control.
    // Changed 2026-10-03: language adds a seventeenth native select.
    // 2026-10-11: Picture style is the eighteenth native select.
    expect(active.find('select')).toHaveLength(16); // Changed 2026-10-18: V263, owner item I43, the Send select was removed.
    expect(active.find('[data-tutor-conversation-situation-picture]').is('select')).toBe(true);
    expect(active.find('[data-tutor-conversation-situation-picture]').is(':disabled')).toBe(false);
    // Changed 2026-09-22: Replies, Correction, and Register join Source and Situation because
    // changing any of those three would change the model's engine or instruction mid-session.
    expect(active.find('[data-tutor-conversation-from]').is(':disabled')).toBe(true);
    expect(active.find('[data-tutor-conversation-situation]').is(':disabled')).toBe(true);
    expect(active.find('[data-tutor-conversation-role-swapped]').is(':disabled')).toBe(true);
    expect(active.find('[data-tutor-conversation-starts]').is(':disabled')).toBe(true);
    expect(active.find('[data-tutor-conversation-register]').is(':disabled')).toBe(true);
    expect(active.find('[data-tutor-conversation-coaching]').is(':disabled')).toBe(true);
    expect(active.find('[data-tutor-conversation-replies]').is(':disabled')).toBe(true);
    for (const selector of [
      '[data-tutor-conversation-register]',
      '[data-tutor-conversation-coaching]',
      '[data-tutor-conversation-replies]'
    ]) {
      const description = active.find(selector).closest('label').find('.setting-description').text();
      // Changed 2026-09-23: the owner asked for one-sentence descriptions, so the reason
      // is now carried inside that sentence. What this guards is unchanged: the reader is
      // told when the change takes effect.
      expect(description).toContain('from the next conversation');
    }
    expect(active.find('[data-tutor-conversation-replies]').closest('label').text())
      .toContain('Whether Gemini speaks with you live');
    // Changed 2026-09-23: the owner asked for one-sentence descriptions. The explanation of
    // why these two freeze has gone; that they are frozen, and that the reader is told when
    // the change applies, is asserted above and is what this test is for.
    for (const selector of [
      '[data-tutor-conversation-register]', '[data-tutor-conversation-coaching]'
    ]) {
      expect(active.find(selector).is(':disabled')).toBe(true);
    }
    expect(active.find('[data-tutor-conversation-answers]')).toHaveLength(0);
    // Changed 2026-09-20: V129 makes Send a Standard-only control, because Live streams
    // speech as it is spoken and has no dictated draft for a press to release. The state
    // here is the product default, which is Live.
    expect(value.conversation.replies).toBe('liveGemini');
    // Changed 2026-10-18: V263, owner item I43, Live has no Send row.
    expect(active.find('[data-tutor-conversation-send]')).toHaveLength(0);
    value.conversation.replies = 'standard';
    const standardActive = page(value);
    expect(standardActive('[data-tutor-conversation-send]')).toHaveLength(0);
    expect(standardActive('[data-tutor-conversation-answers]')).toHaveLength(0);
    expect(standardActive('[data-tutor-conversation-reply-thinking]').is(':disabled')).toBe(false);
    value.conversation.replies = 'liveGemini';
    expect(active.find('[data-tutor-conversation-reply-thinking]').is(':disabled')).toBe(false);
    const liveVoice = page(value)('[data-tutor-conversation-live-voice]');
    expect(liveVoice).toHaveLength(1);
    expect(liveVoice.is(':disabled')).toBe(false);

    value.conversation.status = 'stopped';
    const stopped = page(value);
    expect(stopped('[data-tutor-conversation-register]').is(':disabled')).toBe(false);
    expect(stopped('[data-tutor-conversation-coaching]').is(':disabled')).toBe(false);
    expect(stopped('[data-tutor-conversation-replies]').is(':disabled')).toBe(false);
  });

  it('V119 nests a persisted, closed ADVANCED foldable inside MODE', () => {
    const value = createTutorViewState();
    const $ = load(renderTutorConversation(value));
    const mode = $('details[data-persist-id="tutor-conversation-mode"]');
    const advanced = mode.find('details[data-tutor-conversation-advanced]');

    expect(advanced).toHaveLength(1);
    expect(advanced.attr('data-persist-id')).toBe('tutor-conversation-advanced');
    expect(advanced.is('[open]')).toBe(false);
    expect(advanced.hasClass('rewrite-settings-group')).toBe(true);
    expect(advanced.children('summary').find('.rewrite-group-name').text()).toBe('ADVANCED');
    expect(advanced.prev().find('[data-tutor-conversation-coaching]')).toHaveLength(1);
  });

  it('V119 summarizes every Advanced value in default and non-default states', () => {
    const value = createTutorViewState();
    const summary = (rendered: ReturnType<typeof load>) =>
      rendered('details[data-tutor-conversation-advanced] > summary .rewrite-group-summary').text();

    // Changed 2026-09-26: assert each preference's meaning as the summary grows.
    // 2026-10-01: V181 summarizes the selected mode; guard agreement with the visible option rather than wording.
    const defaultPage = load(renderTutorConversation(value));
    const defaultSummary = summary(defaultPage);
    expect(defaultSummary).not.toContain('Send:');
    expect(defaultSummary).not.toContain('Reply thinking');
    for (const part of ['Reply: Live',
      `Picture: ${defaultPage('[data-tutor-conversation-situation-picture] option[selected]').text()}`,
      'Microphone: Balanced', // Changed 2026-10-03: summarize the current default wait.
      `${TUTOR_DEFAULTS.configuration['tutor.conversation.microphoneCloseWait']}sec`, 'Press to talk: Off']) {
      expect(defaultSummary).toContain(part);
    }

    // Changed 2026-09-20: Voice is no longer part of ADVANCED or its summary.
    Object.assign(value.conversation, {
      send: 'button', replies: 'standard', replyThinking: 'routing', replyLength: 'long'
    });
    const changedPage = load(renderTutorConversation(value));
    const changedSummary = summary(changedPage);
    for (const part of ['Send: When I stop speaking', 'Reply: Standard',
      `Picture: ${changedPage('[data-tutor-conversation-situation-picture] option[selected]').text()}`]) {
      expect(changedSummary).toContain(part);
    }
    value.conversation.liveVoice = 'Kore';
    expect(summary(load(renderTutorConversation(value)))).toBe(changedSummary);
  });

  it('V140 patches the ADVANCED summary from its conversation preference selects', () => {
    const script = page()('script').text();
    // Changed 2026-10-02: V186b shares formatting with full renders; check the inputs
    // and delegation instead of pinning concatenation syntax. Runtime parity is in V136.
    const start = script.indexOf('function syncTutorConversationAdvancedSummary()');
    const end = script.indexOf("document.addEventListener('input'", start);
    const patch = script.slice(start, end);

    expect(patch).toContain(
      "'[data-tutor-conversation-advanced] > summary .rewrite-group-summary'"
    );
    expect(patch).toContain(
      'summary.textContent = tutorConversationAdvancedSummary({'
    );
    expect(patch).not.toContain("replyThinking");
    expect(patch).toContain("situationPicture: selectedText('[data-tutor-conversation-situation-picture]')");
  });

  it('V124 labels every Gemini voice with its gender and offers no unknown default', () => {
    const $ = page();
    const options = $('[data-tutor-conversation-live-voice] option');
    expect(options).toHaveLength(30);
    expect(options.map((_, element) => $(element).text()).get().every(
      (label) => /\((?:[^,]+), (?:female|male)\)$/u.test(label)
    )).toBe(true);
    expect(options.map((_, element) => $(element).attr('value')).get()).not.toContain('');
    // Changed 2026-10-03: the selected voice follows current tutor defaults.
    expect($('[data-tutor-conversation-live-voice]').val()).toBe(TUTOR_DEFAULTS.conversation.liveVoice);
  });

  it('V119 gives ADVANCED spacing and the same summary layout and marker as MODE', () => {
    const $ = page();

    expect(declarations($, '.tutor-conversation-settings > details[data-tutor-conversation-advanced]'))
      .toMatchObject({ 'margin-top': '8px' });
    expect(declarations($, 'details.rewrite-settings-group > summary')).toMatchObject({
      display: 'grid',
      'grid-template-columns': '20px minmax(78px, auto) minmax(0, 1fr)'
    });
    expect(declarations($, '.rewrite-settings-group > summary::before').content).toBe("'▸'");
    expect(declarations($, '.rewrite-settings-group[open] > summary::before').content).toBe("'▾'");
    expect($('details[data-tutor-conversation-advanced] .icon-button')).toHaveLength(0);
    expect($('style').text()).not.toContain('.tutor-conversation-advanced');
  });

  it('V140 shows teaching and As you go coaching while running, and holds When you stop', () => {
    const corrected = () => {
      const value = state();
      value.conversation.transcript = [{
        question: 'What happened?', learnerAnswer: 'I go.', correction: 'I went.',
        explanation: 'Past tense.', nextQuestion: 'Where?'
      }];
      return value;
    };

    // Changed 2026-09-23: the setting named KREN corrects as it replies promises the same
    // visible correction block as As you go. The spoken correction is additional feedback.
    for (const coaching of ['inline', 'teaching'] as const) {
      const running = corrected();
      running.conversation.coaching = coaching;
      const visible = page(running)('[data-tutor-turn-feedback]');
      expect(visible, `${coaching}, active`).toHaveLength(1);
      expect(visible.is('[hidden]'), `${coaching}, active`).toBe(false);
    }

    for (const coaching of ['afterwards'] as const) {
      const running = corrected();
      running.conversation.coaching = coaching;
      const held = page(running)('[data-tutor-turn-feedback]');
      expect(held, `${coaching}, active`).toHaveLength(1);
      expect(held.is('[hidden]'), `${coaching}, active`).toBe(true);
      // The learner still sees their own words while the conversation runs.
      expect(page(running)('[data-tutor-learner-answer]').text()).toBe('I go.');

      const stopped = corrected();
      stopped.conversation.coaching = coaching;
      stopped.conversation.status = 'stopped';
      const $ = page(stopped);
      expect($('[data-tutor-turn-feedback]'), `${coaching}, stopped`).toHaveLength(1);
      expect($('[data-tutor-turn-feedback]').is('[hidden]'), `${coaching}, stopped`).toBe(false);
      expect($('[data-tutor-correction]').text()).toBe('I went.');
      expect($('details[data-tutor-turn-explanation] summary').first().text()).toBe('Why?');
    }

    const teachingStopped = corrected();
    teachingStopped.conversation.coaching = 'teaching';
    teachingStopped.conversation.status = 'stopped';
    expect(page(teachingStopped)('[data-tutor-turn-feedback]').is('[hidden]')).toBe(false);
  });

  it('V113 gives the setup a Correction row that names the three modes', () => {
    const value = state();
    value.conversation.status = 'idle';
    const $ = page(value);
    const control = $('[data-tutor-conversation-coaching]');

    expect(control.is('select')).toBe(true);
    expect(control.children('option').map((_, element) => $(element).attr('value')).get())
      .toEqual(['inline', 'afterwards', 'teaching']);
    expect(control.children('option').map((_, element) => $(element).text()).get())
      .toEqual(['As you go', 'When you stop', 'KREN corrects as it replies']);
    // 2026-10-11: V220 defaults corrections to Stop.
    expect(control.val()).toBe('afterwards');

    value.conversation.coaching = 'teaching';
    expect(page(value)('[data-tutor-conversation-coaching]').val()).toBe('teaching');
    expect(page(value)('[data-persist-id="tutor-conversation-mode"] > summary > .rewrite-group-summary').text())
      .toContain('Correction: KREN corrects as it replies');
  });

  it('V140 forgives punctuation and case only on a dictated turn', () => {
    const value = state();
    value.conversation.transcript = [{
      question: 'What happened?', learnerAnswer: 'i went home', correction: 'I went home.',
      explanation: 'Capitalisation and punctuation only.', move: 'reaction',
      reply: 'Thanks for telling me.'
    }];
    expect(page(value)('[data-tutor-turn-feedback]')).toHaveLength(1);
    value.conversation.transcript[0]!.spoken = true;
    expect(page(value)('[data-tutor-turn-feedback]')).toHaveLength(0);

    value.conversation.transcript[0]!.correction = 'I walked home.';
    expect(page(value)('[data-tutor-turn-feedback]')).toHaveLength(1);
  });

  it('V152 reverses V148 under the learner turn and highlights only the model-named reply span', () => {
    const value = state();
    value.conversation.replies = 'standard';
    value.conversation.coaching = 'teaching';
    value.conversation.transcript = [{
      question: 'What happened?',
      learnerAnswer: 'I take bus.',
      correction: 'I took a bus yesterday.',
      explanation: 'Use the past tense and the article.',
      move: 'reaction',
      reply: 'Actually, you would say: from overseas. What happened next?',
      replyQuote: 'from overseas',
      nextQuestion: 'What happened next?'
    }, {
      question: 'Was this sentence correct?',
      learnerAnswer: 'Yes, it was.',
      correction: 'Yes, it was.',
      explanation: 'No correction is needed.',
      move: 'reaction',
      reply: 'Excellent. Tell me another detail.'
    }];
    const $ = page(value);

    // Changed 2026-09-25 for V152: the owner reversed V148. The full correction is plain
    // text beside the blue bar, and only replyQuote is blue and bold in KREN's reply.
    expect($('[data-tutor-correction-bubble], .tutor-chat-correction')).toHaveLength(0);
    const feedback = $('[data-tutor-learner-turn="0"] [data-tutor-turn-feedback]');
    expect(feedback.children('p').first().text()).toBe('I took a bus yesterday.');
    expect(feedback.children('p').first().find('strong')).toHaveLength(0);
    expect(declarations($, '.tutor-turn-feedback')).toMatchObject({
      color: 'var(--vscode-foreground)'
    });
    expect(declarations($, '.tutor-turn-feedback > p')).not.toHaveProperty('font-weight');
    const highlighted = $('[data-tutor-reply-bubble]').first().find('[data-tutor-reply-quote]');
    expect(highlighted.text()).toBe('from overseas');
    expect(highlighted[0]?.tagName).toBe('strong');
    expect($('[data-tutor-reply-bubble]').first().text())
      .toBe('Actually, you would say: from overseas. What happened next?');
    expect($('[data-tutor-turn-feedback] summary').first().text()).toBe('Why?');
    expect($('[data-tutor-turn-feedback] [data-command="askTutorConversationTurn"]')).toHaveLength(1);
    expect(declarations($, '.tutor-reply-quote')).toMatchObject({
      color: 'var(--vscode-textLink-foreground)',
      'font-weight': '700'
    });
  });

  it('V156 gives My own situation a native group heading and keeps the two MODE choices below it', () => {
    const value = state();
    value.conversation.status = 'idle';
    value.conversation.from = 'situation';
    const $ = page(value);
    const situation = $('[data-tutor-conversation-situation]');
    const ownGroup = situation.children('optgroup[label="Your own"]');
    const custom = ownGroup.children('option[value="custom"]');
    // Changed 2026-09-25 for V156: Windows ignores font weight on option, while the same
    // native optgroup heading used by the nine catalogue groups is reliably distinct.
    expect(ownGroup).toHaveLength(1);
    expect(situation.children('optgroup').last().is(ownGroup)).toBe(true);
    expect(custom.text()).toBe('My own situation');
    expect(custom.attr('style')).toBeUndefined();
    expect(custom.val()).toBe('custom');
    const situationRow = situation.closest('.setting');
    const roleRow = situationRow.next('.setting');
    const startsRow = roleRow.next('.setting');
    const roleSwitch = roleRow.find('.switch');
    expect(roleSwitch.children('input[data-tutor-conversation-role-swapped]')).toHaveLength(1);
    expect(roleSwitch.children('.slider')).toHaveLength(1);
    expect(roleSwitch.find('[data-setting]')).toHaveLength(0);
    expect(startsRow.find('select[data-tutor-conversation-starts]')).toHaveLength(1);
    expect(startsRow.find('select').val()).toBe('kren');
    expect(startsRow.find('option').map((_, option) => $(option).text()).get())
      .toEqual(['KREN starts', 'I start']);
  });

  it('V111 renders My own situation directly between Situation and Register', () => {
    const value = state();
    value.conversation.status = 'idle';
    value.conversation.from = 'situation';
    value.conversation.situationId = 'custom';
    value.conversation.customSituation = 'A neighbourhood meeting';
    const $ = page(value);
    const fields = $('.tutor-conversation-settings');
    const custom = fields.children('.tutor-conversation-custom');

    // Changed 2026-09-25 for V152: role and starter sit directly below Situation, while the
    // custom text remains before Register and still belongs only to My own situation.
    expect(custom).toHaveLength(1);
    expect(custom.prev().find('[data-tutor-conversation-starts]')).toHaveLength(1);
    expect(custom.next().find('[data-tutor-conversation-register]')).toHaveLength(1);
    expect(custom.find('[data-tutor-conversation-custom]').val()).toBe('A neighbourhood meeting');
    expect(custom.find('[data-tutor-conversation-custom]').is(':disabled')).toBe(false);

    value.conversation.status = 'active';
    expect(page(value)('[data-tutor-conversation-custom]').is(':disabled')).toBe(true);
    value.conversation.status = 'idle';
    value.conversation.from = 'anything';
    expect(page(value)('[data-tutor-conversation-custom]').is(':disabled')).toBe(true);
  });

  it('V127 keeps five left controls and two right controls in their requested order', () => {
    const value = state();
    // Changed 2026-09-20: this test exercises text Replay, so it chooses Standard explicitly.
    value.conversation.replies = 'standard';
    value.conversation.draftAnswer = 'A ready answer.';
    value.conversation.speakerOn = true;
    const $ = page(value);
    const composer = $('[data-tutor-composer]');
    const controls = composer.find('[data-tutor-composer-controls]');
    // Changed 2026-09-17: V110 makes both groups stable icon rows below the textarea.
    // Changed 2026-10-18: V263, owner item I43, the lower row contains controls without a text box.
    expect(composer.find('textarea')).toHaveLength(0);
    expect(composer.children().first().is('[data-tutor-composer-controls]')).toBe(true);
    const expectations = [
      // Changed 2026-09-20: V127 moves the speaker to the first position on the left.
      ['toggleTutorConversationSpeaker', 'speaker', 'Turn speaker off'],
      ['hintTutorConversation', 'hint', 'Hint'],
      ['skipTutorConversationTurn', 'skip', 'Skip this question'],
      // Changed 2026-09-17: replay controls use Core's open clockwise arrow.
      ['replayTutorQuestion', 'replay', 'Replay the last thing KREN said'],
      ['stopTutorConversation', 'stop', 'Stop conversation']
    ] as const;
    expect(controls.find('[data-tutor-composer-actions]').children('button').map((_, element) =>
      $(element).attr('data-command')).get()).toEqual(expectations.map(([command]) => command));
    for (const [command, icon, accessibleName] of expectations) {
      const button = controls.find(`[data-command="${command}"]`);
      expect(button.is('button:not(:disabled)')).toBe(true);
      expect(button.hasClass('icon-button')).toBe(true);
      expect(button.attr('aria-label')).toBe(accessibleName);
      expect(button.attr('title')).toBeTruthy();
      expect(button.text().trim()).toBe('');
      const expectedIcon = load(iconSvgMarkup(icon));
      expect(button.find('svg path').map((_, path) => $(path).attr('d')).get())
        .toEqual(expectedIcon('path').map((_, path) => expectedIcon(path).attr('d')).get());
      expect(button.parents('details')).toHaveLength(0);
    }
    const audio = $('[data-tutor-chat-microphone]');
    expect(audio.children('button').map((_, element) => $(element).attr('data-command')).get())
      .toEqual(['stopTutorConversation', 'dictateTutorConversation']);
    for (const [command, icon] of [
      ['dictateTutorConversation', 'microphone'],
      ['stopTutorConversation', 'stop']
    ] as const) {
      const button = audio.children(`[data-command="${command}"]`);
      const expectedIcon = load(iconSvgMarkup(icon));
      expect(button.find('svg path').map((_, path) => $(path).attr('d')).get())
        .toEqual(expectedIcon('path').map((_, path) => expectedIcon(path).attr('d')).get());
    }
    expect(audio.children('button').map((_, element) => $(element).text().trim()).get())
      .toEqual(['', '']);
    expect(audio.children('button').map((_, element) => $(element).attr('aria-label')).get()
      .every(Boolean)).toBe(true);
    expect(declarations($, '.tutor-content .icon-button')).toMatchObject({
      color: 'var(--vscode-button-foreground)',
      background: 'var(--vscode-button-background)'
    });
  });

  it('V111 pins every measured conversation spacing value on the repeating selectors', () => {
    const $ = page();

    // Changed 2026-09-17: these are the reader's exported per-turn values, not first-item offsets.
    expect(declarations($, '.tutor-chat-kren')['margin-top']).toBe('30px');
    expect(declarations($, '.tutor-chat-learner')['margin-top']).toBe('20px');
    expect(declarations($, '.tutor-conversation-answer')['margin-top']).toBe('30px');
    expect(declarations($, '.tutor-composer-controls')).toMatchObject({
      'margin-top': '15px',
      'margin-bottom': '10px'
    });
    expect(declarations($, '.tutor-chat-learner-turn')['margin-top']).toBe('0');
  });

  it('V110 removes Replay this question from every rendered conversation state', () => {
    const value = state();
    for (const status of ['idle', 'active', 'stopped'] as const) {
      value.conversation.status = status;
      const $ = page(value);
      // Changed 2026-09-17: replay belongs to the control row, never to a bubble.
      expect($.html()).not.toContain('Replay this question');
      expect($('[data-tutor-kren-bubble] [data-command="replayTutorQuestion"]')).toHaveLength(0);
    }
  });

  it.each(['standard', 'liveGemini'] as const)(
    'V155 disables Stop with an explanatory tooltip while a %s reply is in progress', (replies) => {
      const value = state();
      Object.assign(value.conversation, { replies, busy: true });
      const $ = load(renderTutorConversation(value));
      const stop = $('[data-command="stopTutorConversation"]');
      // Changed 2026-09-25 for V155: Stop used to have no disabled condition in this
      // literal action row. A busy turn now carries both the condition and its reason.
      expect(stop.is(':disabled')).toBe(true);
      expect(stop.attr('title')).toBe('Stop is available when this turn finishes');
      expect(stop.attr('aria-label')).toBe('Stop is available when this turn finishes');
    }
  );

  it('V155 waits for both reply and per-turn correction, in either completion order', () => {
    const value = state();
    value.conversation.coaching = 'inline';
    value.conversation.busy = false;
    value.conversation.transcript[0] = {
      ...value.conversation.transcript[0]!, coachingPending: true
    };
    let $ = load(renderTutorConversation(value));
    expect($('[data-command="stopTutorConversation"]').is(':disabled')).toBe(true);

    value.conversation.transcript[0] = {
      ...value.conversation.transcript[0]!, coachingPending: undefined,
      correction: 'A completed correction.'
    };
    $ = load(renderTutorConversation(value));
    expect($('[data-command="stopTutorConversation"]').is(':disabled')).toBe(false);

    value.conversation.busy = true;
    $ = load(renderTutorConversation(value));
    expect($('[data-command="stopTutorConversation"]').is(':disabled')).toBe(true);
    value.conversation.busy = false;
    $ = load(renderTutorConversation(value));
    expect($('[data-command="stopTutorConversation"]').is(':disabled')).toBe(false);
  });

  it('V155 does not wait for a per-turn correction in When you stop', () => {
    const value = state();
    value.conversation.coaching = 'afterwards';
    value.conversation.busy = false;
    value.conversation.transcript[0] = {
      ...value.conversation.transcript[0]!, coachingPending: true
    };
    const $ = load(renderTutorConversation(value));
    expect($('[data-command="stopTutorConversation"]').is(':disabled')).toBe(false);
  });

  it('V156 leaves Stop enabled while a hands-free Live microphone is only waiting', () => {
    const value = state();
    value.conversation.replies = 'liveGemini';
    const listening = load(renderTutorConversation(
      value, 'auto', true, false, true, true, false
    ));
    expect(listening('[data-command="stopTutorConversation"]').is(':disabled')).toBe(false);
    expect(listening('[data-command="dictateTutorConversation"]').is(':disabled')).toBe(false);
  });

  it('V156 disables Stop between the two Press to talk presses as reader speech', () => {
    const value = state();
    value.conversation.replies = 'liveGemini';
    const speaking = load(renderTutorConversation(
      value, 'auto', true, false, true, true, true
    ));
    const stop = speaking('[data-command="stopTutorConversation"]');
    expect(stop.is(':disabled')).toBe(true);
    expect(stop.attr('title')).toBe('Stop is available when you finish speaking');
    expect(speaking('[data-command="dictateTutorConversation"]').is(':disabled')).toBe(false);
  });

  it('V156 removes the microphone-off Stop tooltip from every host and panel path', () => {
    expect(hostSource()).not.toContain('Turn the microphone off to stop');
    for (const path of ['src/resultViewHtml.ts']) {
      expect(readFileSync(path, 'utf8')).not.toContain('Turn the microphone off to stop');
    }
  });

  it('V155 disables Stop during Standard dictation but leaves its microphone able to end it', () => {
    const value = state();
    value.conversation.replies = 'standard';
    Object.assign(value.speech, {
      handyStatus: 'available', dictationProvider: 'handy', dictatingConversation: true
    });
    let $ = load(renderTutorConversation(value, 'auto'));
    expect($('[data-command="stopTutorConversation"]').is(':disabled')).toBe(true);
    expect($('[data-command="stopTutorConversation"]').attr('title'))
      .toBe('Stop is available when you finish speaking');
    expect($('[data-command="dictateTutorConversation"]').is(':disabled')).toBe(false);

    value.speech.dictatingConversation = undefined;
    value.speech.dictationProvider = undefined;
    $ = load(renderTutorConversation(value, 'auto'));
    expect($('[data-command="stopTutorConversation"]').is(':disabled')).toBe(false);
  });

  it('V127 gives the one Replay button its stopped-conversation job in Standard and Live', () => {
    const value = state();
    value.conversation.speakerOn = true;
    // Changed 2026-09-17: before the first conversation the control is absent, not disabled.
    value.conversation.status = 'idle';
    expect(page(value)('[data-command="replayTutorQuestion"]')).toHaveLength(0);
    value.conversation.status = 'active';
    expect(page(value)('[data-command="replayTutorQuestion"]').attr('title'))
      .toBe('Replay the last thing KREN said');
    // Changed 2026-09-20: V127 removes Replay all, including its dedicated styling.
    expect(page(value).html()).not.toContain('replayTutorConversation');
    // 2026-10-04: V203 restores the owner's disabled icon fade.
    expect(declarations(page(value), '.icon-button:disabled').opacity).toBe('.55');

    value.conversation.replies = 'standard';
    value.conversation.status = 'stopped';
    const stopped = page(value);
    const replay = stopped('[data-command="replayTutorQuestion"]');
    expect(replay.is(':disabled')).toBe(false);
    expect(replay.attr('aria-pressed')).toBe('false');
    expect(replay.attr('aria-label')).toBe('Replay the conversation');
    expect(replay.find('svg path').map((_, path) => stopped(path).attr('d')).get())
      .toEqual(load(iconSvgMarkup('replay'))('path').map((_, path) => load(iconSvgMarkup('replay'))(path).attr('d')).get());
    expect(stopped('[data-tutor-composer]')).toHaveLength(0);
    expect(stopped('[data-tutor-composer-actions]')).toHaveLength(1);
    // Changed 2026-09-27: stopped controls follow the transcript's picture viewport.
    expect(stopped('[data-tutor-transcript]').parent().next().is('[data-tutor-composer-controls]')).toBe(true);

    // Changed 2026-09-20: Live now replays both sides with Gemini voices.
    value.conversation.replies = 'liveGemini';
    expect(page(value, true)('[data-command="replayTutorQuestion"]').is(':disabled')).toBe(false);

    value.conversation.speakerOn = false;
    expect(page(value)('[data-command="replayTutorQuestion"]').is(':disabled')).toBe(true);
    value.conversation.speakerOn = true;
    value.conversation.transcript = value.conversation.transcript.map((turn) => ({ ...turn, skipped: true }));
    expect(page(value)('[data-command="replayTutorQuestion"]').is(':disabled')).toBe(true);
  });

  it('V127 renders stop and a stopping name while the conversation Replay is speaking', () => {
    const value = state();
    Object.assign(value.conversation, { status: 'stopped', speakerOn: true, replayAllSpeaking: true });
    const $ = page(value);
    const replay = $('[data-command="replayTutorQuestion"]');

    // Changed 2026-09-17: the pressed state must be visible without relying on aria-pressed.
    expect(replay.attr('aria-pressed')).toBe('true');
    expect(replay.attr('aria-label')).toBe('Stop replaying');
    expect(replay.find('svg path').map((_, path) => $(path).attr('d')).get())
      .toEqual(load(iconSvgMarkup('stop'))('path').map((_, path) => load(iconSvgMarkup('stop'))(path).attr('d')).get());
  });

  // Changed 2026-09-20: no controls exist before the first conversation, then the stopped
  // left group keeps only speaker and the same Replay button.
  it('V127 hides controls until a conversation exists, then exposes stopped Replay and speaker', () => {
    const value = state();
    value.conversation.status = 'idle';
    value.conversation.transcript = [];
    expect(page(value)('[data-tutor-composer-audio]')).toHaveLength(0);

    value.conversation.status = 'stopped';
    value.conversation.transcript = state().conversation.transcript;
    const $ = page(value);
    const controls = $('[data-tutor-result="conversation"] > [data-tutor-composer-controls]');
    const buttons = controls.find('[data-tutor-composer-actions]').children('button');

    expect(buttons.map((_, element) => $(element).attr('data-command')).get())
      .toEqual(['toggleTutorConversationSpeaker', 'replayTutorQuestion']);
    for (const button of buttons.toArray()) {
      expect($(button).hasClass('icon-button')).toBe(true);
    }
    expect(buttons.eq(0).hasClass('tutor-action-icon')).toBe(true);
    expect(buttons.eq(1).hasClass('secondary')).toBe(true);
    expect(controls.find('[data-tutor-composer-audio]').children()).toHaveLength(0);
  });

  it('V108 keeps learner coaching outside the blue learner bubble and names both speakers', () => {
    const $ = page();
    const learnerTurn = $('[data-tutor-learner-turn="0"]');
    const learnerBubble = learnerTurn.children('.tutor-chat-learner');
    const feedback = learnerTurn.children('[data-tutor-turn-feedback]');

    expect(learnerBubble).toHaveLength(1);
    expect(learnerBubble.find('[data-tutor-learner-answer]').text()).toBe('Answer 0.');
    // Changed 2026-09-25 for V152: the owner reversed V148. Correction text is the first
    // plain paragraph in the blue-bar feedback under the reader's turn.
    expect(feedback.children('[data-tutor-correction]').text()).toBe('Corrected 0.');
    expect(learnerTurn.next().is('[data-tutor-reply-bubble]')).toBe(true);
    expect(feedback.find('[data-tutor-turn-explanation] summary').text()).toBe('Why?');
    expect(learnerBubble.find('[data-tutor-turn-feedback], [data-tutor-correction], [data-tutor-turn-explanation]'))
      .toHaveLength(0);
    expect(declarations($, '.tutor-chat-learner').background).toBe('var(--vscode-button-background)');
    expect(declarations($, '.tutor-chat-learner').color).toBe('var(--vscode-button-foreground)');

    expect(learnerBubble.attr('aria-label')).toBe('You');
    expect($('[data-tutor-kren-bubble]').first().attr('aria-label')).toBe('KREN');
    // 2026-09-17: a name on a plain div is not announced. The role is what exposes it once
    // the visible KREN and You labels are gone.
    expect(learnerBubble.attr('role')).toBe('group');
    expect($('[data-tutor-kren-bubble]').first().attr('role')).toBe('group');
    expect(learnerBubble.hasClass('tutor-chat-kren')).toBe(false);
    expect($('[data-tutor-kren-bubble]').first().hasClass('tutor-chat-learner')).toBe(false);
    expect($('[data-tutor-transcript]').html()).not.toContain('<strong>KREN</strong>');
    expect($('[data-tutor-transcript]').html()).not.toContain('<strong>You</strong>');
    // Changed 2026-09-17: V111 doubles the three round corners and keeps the speaker corner square.
    expect(declarations($, '.tutor-chat-kren')).toMatchObject({
      'border-radius': '16px',
      'border-top-left-radius': '0'
    });
    for (const corner of ['border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius']) {
      expect(declarations($, '.tutor-chat-kren')[corner] ?? declarations($, '.tutor-chat-kren')['border-radius'])
        .toBe('16px');
    }
    expect(declarations($, '.tutor-chat-learner')).toMatchObject({
      'border-radius': '16px',
      'border-top-right-radius': '0'
    });
    for (const corner of ['border-top-left-radius', 'border-bottom-right-radius', 'border-bottom-left-radius']) {
      expect(declarations($, '.tutor-chat-learner')[corner] ?? declarations($, '.tutor-chat-learner')['border-radius'])
        .toBe('16px');
    }
  });

  it('V112 omits feedback for an answer that is already correct and keeps real correction feedback', () => {
    const value = state();
    value.conversation.transcript = [
      { question: 'Correct?', learnerAnswer: 'Already right.', correction: 'Already right.', explanation: 'No change.' },
      { question: 'Needs work?', learnerAnswer: 'I go.', correction: 'I went.', explanation: 'Use past tense.' }
    ];
    const $ = page(value);

    // Changed 2026-09-25 for V152: the owner reversed V148. A correct turn has no feedback;
    // the one real correction is back inside the reader turn's blue-bar feedback.
    expect($('[data-tutor-learner-turn="0"] [data-tutor-turn-feedback]')).toHaveLength(0);
    expect($('[data-tutor-learner-turn="0"] + [data-tutor-correction-bubble]')).toHaveLength(0);
    expect($('[data-tutor-learner-turn="0"]').text()).toBe('Already right.');
    expect($('[data-tutor-learner-turn="1"] [data-tutor-turn-feedback]')).toHaveLength(1);
    expect($('[data-tutor-learner-turn="1"] [data-tutor-turn-feedback] [data-tutor-correction]').text())
      .toBe('I went.');
  });

  it('V111 aligns feedback to short and multiline learner bubbles through their shared wrapper', () => {
    const value = state();
    value.conversation.transcript = [
      // Changed 2026-09-17: both turns carry a real correction, because a turn that needed
      // none no longer renders the block this alignment is about.
      { question: 'Ready?', learnerAnswer: 'Yes.', correction: 'Yes, I am.', explanation: 'One word is enough.', nextQuestion: 'More?' },
      { question: 'What happened?', learnerAnswer: 'I arrived early.\nThen I waited near the entrance for the rest of the group.',
        correction: 'I arrived early, then waited near the entrance for the rest of the group.',
        explanation: 'Join the related events.', nextQuestion: 'And then?' }
    ];
    const $ = page(value);
    const turns = $('[data-tutor-learner-turn]');

    expect(turns).toHaveLength(2);
    expect(turns.eq(0).children('.tutor-chat-learner').find('[data-tutor-learner-answer]').text()).toBe('Yes.');
    expect(turns.eq(1).children('.tutor-chat-learner').text()).toContain('Then I waited');
    for (const turn of turns.toArray()) {
      const children = $(turn).children();
      expect(children.eq(0).is('.tutor-chat-learner')).toBe(true);
      expect(children.eq(1).is('[data-tutor-turn-feedback]')).toBe(true);
    }

    // Changed 2026-09-17: answer length changes wrapper width, not a percentage feedback offset.
    expect(declarations($, '.tutor-chat-learner-turn')).toMatchObject({
      width: 'fit-content',
      'max-width': '78%',
      'margin-left': 'auto'
    });
    // Changed 2026-10-02: the owner chose a narrow balloon at the right edge over aligning it
    // with the left end of a wider correction.
    expect(declarations($, '.tutor-chat-learner')).toMatchObject({
      'max-width': '100%',
      'margin-left': 'auto'
    });
    const feedback = declarations($, '.tutor-turn-feedback');
    expect(feedback['margin-top']).toBe('8px');
    expect(feedback).not.toHaveProperty('margin');
    expect(feedback).not.toHaveProperty('margin-left');
    expect(feedback['border-left']).toBe('3px solid var(--vscode-textLink-foreground)');
    expect(feedback.color).toBe('var(--vscode-foreground)');
    expect($('style').text()).not.toContain('22%');
  });

  it('V108 keeps Hint and Skip present but disabled while a conversation request is in flight', () => {
    const value = state();
    value.conversation.busy = true;
    const $ = page(value);

    for (const command of ['hintTutorConversation', 'skipTutorConversationTurn']) {
      expect($(`[data-tutor-composer-actions] [data-command="${command}"]`)).toHaveLength(1);
      expect($(`[data-tutor-composer-actions] [data-command="${command}"]`).is(':disabled')).toBe(true);
    }
    // Changed 2026-09-17: Send answer moved into the right-hand audio group.
    // Changed 2026-10-18: V263, owner item I43, Send is absent even while waiting.
    expect($('[data-command="submitTutorConversationTurn"]')).toHaveLength(0);
    value.conversation.busy = false;
    value.conversation.draftAnswer = '';
    expect(page(value)('[data-command="submitTutorConversationTurn"]')).toHaveLength(0);
  });

  it('V127 renders one state-correct speaker in the left control group in every state', () => {
    // Changed 2026-09-17: idle carries no audio row, so it carries no speaker either.
    for (const status of ['active', 'stopped'] as const) {
      const value = state();
      value.conversation.status = status;
      for (const speakerOn of [false, true]) {
        value.conversation.speakerOn = speakerOn;
        const $ = page(value);
        const speakers = $('[data-command="toggleTutorConversationSpeaker"]');
        expect(speakers, `${status}, speaker ${speakerOn ? 'on' : 'off'}`).toHaveLength(1);
        const expectedIcon = load(iconSvgMarkup(speakerOn ? 'speaker' : 'speakerOff'));
        expect(speakers.find('svg path').map((_, path) => $(path).attr('d')).get())
          .toEqual(expectedIcon('path').map((_, path) => expectedIcon(path).attr('d')).get());
        expect(speakers.attr('aria-label')).toBe(speakerOn ? 'Turn speaker off' : 'Turn speaker on');
        expect($('.tutor-conversation > header').find(speakers)).toHaveLength(0);
        expect($('[data-tutor-composer-actions]').find(speakers)).toHaveLength(1);
      }
    }
  });

  // Changed 2026-10-15: V241, owner item I6, Start new and Back to chat precede the explicit review action.
  it('V114 keeps the stopped sentence above the ordered review actions', () => {
    const value = state();
    value.conversation.status = 'stopped';
    const $ = page(value);
    const start = $('.tutor-conversation-start');
    const actions = start.children('[data-tutor-conversation-actions]');

    // Changed 2026-09-21: this count is retained transcript turns, not turns left to use.
    expect(start.children('p').text()).toBe(
      `This conversation is stopped. This tutor session has kept all ${value.conversation.transcript.length} turns.`
    );
    expect(actions.find('button').map((_, element) => $(element).attr('data-command')).get())
      .toEqual(['startNewTutorConversation', 'resumeTutorConversation', 'reviewTutorConversation']);
    // Changed 2026-10-16: V247, owner item I28, the Voice and Model bridge buttons follow the row.
    expect(actions.find('button').map((_, element) => $(element).text()).get())
      .toEqual([expect.stringMatching(/start.*new/iu), expect.stringMatching(/back.*chat/iu), expect.stringMatching(/review/iu), 'Voice', 'Model']);
    expect(actions.find('button').map((_, element) => $(element).attr('aria-label') ?? $(element).text()).get())
      .toEqual([expect.stringMatching(/start.*new/iu), expect.stringMatching(/back.*chat/iu), expect.stringMatching(/review/iu), 'Open voice settings', 'Open model settings']);
    expect(declarations($, '.tutor-conversation-start > p:first-child')['margin-top']).toBeUndefined();
    expect(declarations($, '.tutor-conversation-start > .tutor-conversation-invitation')['margin-top'])
      .toBe('-20px');
  });

  it('V156 gives a stopped Demo both immediate and setup restart paths', () => {
    const value = state();
    Object.assign(value.conversation, {
      status: 'stopped', demoMode: true, demoEndedAtCap: undefined,
      demoLines: [{ speaker: 'female', text: 'A line.' }]
    });
    const $ = page(value);
    const actions = $('[data-tutor-conversation-actions]').children('button');
    expect(actions.map((_, button) => $(button).attr('data-command')).get())
      .toEqual(['startTutorConversation', 'startNewTutorConversation']);
    // Changed 2026-10-16: V247, owner item I28, the Voice and Model bridge buttons follow the row.
    expect(actions.map((_, button) => $(button).text()).get())
      .toEqual(['Start now', 'Start new', 'Voice', 'Model']);
  });

  it('V154 puts Demo between Start and Reset with an unambiguous tooltip', () => {
    const value = state();
    Object.assign(value.conversation, { status: 'idle', from: 'anything' });
    const $ = page(value);
    const row = $('.tutor-conversation-start > .tutor-conversation-actions');

    // Changed 2026-09-25 for V154: Demo occupies the slot V153 deliberately left in the
    // shared flex-wrapped row, between the two controls the owner named.
    expect(row.children('button').map((_, button) => $(button).attr('data-command')).get())
      .toEqual(['startTutorConversation', 'startTutorConversationDemo', 'resetTutorConversationDefaults']);
    expect(row.children('button').map((_, button) => $(button).text()).get())
      .toEqual(['Start', 'Demo', 'Reset']);
    expect(row.children('[data-command="startTutorConversationDemo"]').attr('title'))
      .toMatch(/Gemini.*key.*Demo/u); // 2026-10-12: Disabled Demo names the missing key.
    expect(row.children('[data-command="resetTutorConversationDefaults"]').attr('title'))
      .toBe('Reset the mode settings to defaults');
    expect(declarations($, '.tutor-conversation-actions')).toMatchObject({
      display: 'flex', 'flex-wrap': 'wrap', gap: '8px'
    });
  });

  it('V153 renders the scene with only its bar, normal foreground text, and left padding', () => {
    const $ = page(state());
    const scene = declarations($, '.tutor-conversation-scene');
    expect(scene.background).toBeUndefined();
    expect(scene.color).toBe('var(--vscode-foreground)');
    expect(scene['font-weight']).toBe('400');
    expect(scene['border-left']).toBe('3px solid var(--vscode-descriptionForeground)');
    expect(scene.padding).toBe('10px 12px');
  });

  it('V154 makes a running demo visible and disables every learner control', () => {
    const value = state();
    Object.assign(value.conversation, {
      status: 'active', demoMode: true, busy: false,
      demoCast: {
        scene: 'Tom and Mina are discussing an appointment.',
        male: { name: 'Tom', role: 'patient', description: 'A man with an appointment.' },
        female: { name: 'Mina', role: 'receptionist', description: 'A woman at reception.' }
      },
      demoLines: [
        { speaker: 'female', text: 'How can I help, Tom?' },
        { speaker: 'male', text: 'Could I change my appointment, Mina?' }
      ]
    });
    const $ = page(value);

    expect($('[data-tutor-demo-status]').text()).toContain('Demo is running');
    // Changed 2026-10-18: V263, owner item I43, Demo has no answer text box.
    expect($('[data-tutor-conversation-answer]')).toHaveLength(0);
    expect($('[data-command="dictateTutorConversation"]').is(':disabled')).toBe(true);
    expect($('[data-command="hintTutorConversation"]').is(':disabled')).toBe(true);
    expect($('[data-tutor-conversation-role-swapped]').is(':disabled')).toBe(true);
    expect($('[data-tutor-conversation-starts]').is(':disabled')).toBe(true);
    expect($('[data-command="stopTutorConversation"]')).toHaveLength(1);
    // Changed 2026-09-25 for V155: Demo is the one busy speaking state whose Stop remains live.
    expect($('[data-command="stopTutorConversation"]').is(':disabled')).toBe(false);
    expect($('[data-tutor-demo-bubble]').map((_, bubble) => $(bubble).attr('aria-label')).get())
      .toEqual(['Mina', 'Tom']);
    expect($('[data-tutor-demo-bubble].tutor-chat-learner, [data-tutor-learner-turn]'))
      .toHaveLength(0);
  });

  it('disables Demo with the speaker off and enables Standard Demo with Windows speech', () => {
    const value = state();
    Object.assign(value.conversation, { status: 'idle', from: 'anything', speakerOn: false });
    expect(page(value)('[data-command="startTutorConversationDemo"]').is(':disabled')).toBe(true);

    value.conversation.speakerOn = true;
    value.conversation.replies = 'standard';
    const windows = load(renderKrenResultViewHtml({
      cspSource: 'test', nonce: 'test',
      settings: { ...PANEL_SETTINGS_FIXTURE, tutorReadAloudProvider: 'windowsLocal' },
      activeScreen: 'tutor', tutor: value, proModels: []
    }));
    // 2026-10-11: V223 makes availability follow the actual speech service, including Windows.
    expect(windows('[data-command="startTutorConversationDemo"]').is(':disabled')).toBe(false);
  });
});

describe('V107 conversation MODE foldable, 2026-09-16', () => {
  it.each([false, true])(
    'V147 Start conversation focuses the conversation with LLM ROUTING open: %s',
    (settingsOpen) => {
      // Added 2026-09-24: when Start conversation replaces the document, saved page scroll
      // must not win merely because unfolded configuration makes that old offset reachable.
      const value = state();
      Object.assign(value.conversation, { status: 'active', openModeAfterRender: false });
      const output = renderKrenResultViewHtml({
        cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
        activeScreen: 'tutor', tutor: value, proModels: [], focusTutorConversation: true
      } as Parameters<typeof renderKrenResultViewHtml>[0] & { focusTutorConversation: boolean });
      const script = output.match(/<script nonce="test">([\s\S]*?)<\/script>/u)?.[1] ?? '';
      const focusCode = script.slice(
        script.indexOf('const focusSection ='), script.indexOf('const focusTutorTarget =')
      );
      class Element {
        public scrolls = 0;
        public open = false;
        public scrollIntoView(): void { this.scrolls += 1; }
        public getAttribute(): string | null { return null; }
      }
      const conversation = new Element();
      const configuration = new Element();
      configuration.open = settingsOpen;
      let restoredScrolls = 0;
      new Function(
        'document', 'window', 'HTMLElement', 'HTMLDetailsElement', 'activeScreen',
        'restored', 'scrollIsStable', 'openSections', 'savePanelState',
        'tutorReportKeepsMapOpen', focusCode
      )(
        {
          body: { getAttribute: (name: string) => name === 'data-focus-tutor-conversation' ? 'true' : null },
          querySelector: (selector: string) => selector === '[data-tutor-result="conversation"]'
            ? conversation : selector.includes('data-settings-section') ? configuration : null,
          querySelectorAll: () => []
        },
        { scrollTo: () => { restoredScrolls += 1; } },
        Element, Element, 'tutor',
        { scroll: { screen: 'tutor', top: 900 }, openSections: { 'tutor-setting': settingsOpen } },
        true, {}, () => undefined, () => false
      );

      expect(conversation.scrolls).toBe(1);
      expect(configuration.scrolls).toBe(0);
      expect(restoredScrolls).toBe(0);
    }
  );

  it('V144 folds for Start conversation once, opens for Start new, then remembers the reader', () => {
    const choosing = state();
    Object.assign(choosing.conversation, { status: 'idle', openModeAfterRender: true });
    expect(conversationModeReader(choosing, false).section.open).toBe(true);

    const starting = state();
    Object.assign(starting.conversation, { status: 'active', openModeAfterRender: false });
    const firstActiveFrame = conversationModeReader(starting, true);
    // Added 2026-09-23: the start action overrides a previously open MODE exactly once.
    expect(firstActiveFrame.section.open).toBe(false);
    expect(firstActiveFrame.saved()).toBe(false);

    firstActiveFrame.toggle(true);
    expect(firstActiveFrame.saved()).toBe(true);
    const laterActiveRender = state();
    Object.assign(laterActiveRender.conversation, {
      status: 'active', openModeAfterRender: undefined
    });
    expect(conversationModeReader(laterActiveRender, firstActiveFrame.saved()!).section.open)
      .toBe(true);
  });

  it('renames only the visible From title to Source', () => {
    const value = state();
    value.conversation.status = 'idle';
    const $ = page(value);
    const source = $('[data-tutor-conversation-from]');

    expect(source).toHaveLength(1);
    expect(source.closest('label').find('.setting-title').text()).toBe('Source');
    expect($.html()).toContain('data-tutor-conversation-from');
  });

  it('uses the reader measured start sentence, and only where starting is possible', () => {
    const value = createTutorViewState();
    value.conversation.from = 'anything';
    const $ = page(value);

    // Changed 2026-09-25 for V153: the invitation no longer repeats the retired button label.
    expect($('.tutor-conversation-start > p:first-child').text())
      .toMatch(/start.*speak.*microphone/iu); // Changed 2026-10-18: V263, owner item I43, the invitation names spoken input.
    expect($('.tutor-conversation-start [data-command="startTutorConversation"]')).toHaveLength(1);

    // Changed 2026-09-18: the sentence names both available Source fixes and one reachable
    // button performs the situation fix without hiding inside the folded MODE group.
    const blockedPage = page(createTutorViewState());
    const blocked = blockedPage('.tutor-conversation-start');
    expect(blocked.children('p')).toHaveLength(1);
    expect(blocked.children('p').text()).toBe(
      'Finish the lesson and its practice first.'
    );
    // Changed 2026-10-05 (owner issue 17): a start reason shows only itself and Source setting;
    // Start, Demo and Reset are absent until the source is usable.
    expect(blocked.find('[data-command="startTutorConversation"]')).toHaveLength(0);
    expect(blocked.find('[data-command="startTutorConversationDemo"]')).toHaveLength(0);
    expect(blocked.find('[data-command="resetTutorConversationDefaults"]')).toHaveLength(0);
    expect(blocked.children('[data-command="useTutorSituationSource"]').text()).toBe('Source setting');
    expect(blockedPage('details[data-persist-id="tutor-conversation-mode"]').is('[open]')).toBe(false);
    expect(blockedPage('details[data-persist-id="tutor-conversation-mode"]')
      .is('[data-force-closed]')).toBe(true);
  });

  it('removes the disclosure sentence in every conversation state', () => {
    for (const status of ['idle', 'active', 'stopped'] as const) {
      const value = state();
      value.conversation.status = status;
      const markup = renderKrenResultViewHtml({
        cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
        activeScreen: 'tutor', tutor: value, proModels: []
      });
      // Changed 2026-10-06: The manual's Reference contains this disclosure; the conversation itself must not.
      expect(load(markup)('#tutor-screen').text(), status).not.toContain('Diagnosis sends');
    }
  });

  it('removes the conversation facts list in every conversation state', () => {
    for (const status of ['idle', 'active', 'stopped'] as const) {
      const value = state();
      value.conversation.status = status;
      expect(page(value).html(), status).not.toContain('tutor-conversation-facts');
    }
  });

  it('puts all three setup controls inside the persisted MODE foldable', () => {
    const value = state();
    value.conversation.status = 'idle';
    let $ = page(value);
    let mode = $('details[data-persist-id="tutor-conversation-mode"]');

    expect(mode).toHaveLength(1);
    expect(mode.children('summary').find('.rewrite-group-name').text()).toBe('MODE');
    expect(mode.find('[data-tutor-conversation-from]')).toHaveLength(1);
    expect(mode.find('[data-tutor-conversation-situation]')).toHaveLength(1);
    expect(mode.find('[data-tutor-conversation-register]')).toHaveLength(1);
    // Changed 2026-10-10: V212 leaves only LEARNING MAP unfolded in the initial state.
    expect(mode.is('[open]')).toBe(false);

    value.conversation.status = 'active';
    $ = page(value);
    mode = $('details[data-persist-id="tutor-conversation-mode"]');
    expect(mode.is('[open]')).toBe(false);
  });

  it('computes the MODE summary from two different conversation states', () => {
    const value = createTutorViewState();
    Object.assign(value.conversation, {
      from: 'situation', situationId: TUTOR_SITUATIONS[0]!.id, register: 'formal', status: 'idle'
    });
    let $ = page(value);
    let summary = $('details[data-persist-id="tutor-conversation-mode"] > summary .rewrite-group-summary');
    // 2026-10-11: preserve each summary field without pinning the default correction wording.
    const selectedCorrection = $('[data-tutor-conversation-coaching] option[selected]').text();
    for (const fact of ['Source: A situation', `Situation: ${TUTOR_SITUATIONS[0]!.label}`, 'Roles: Usual',
      'Who starts: KREN starts', 'Register: Formal', `Correction: ${selectedCorrection}`, 'Sends when you stop']) {
      expect(summary.text()).toContain(fact);
    }

    value.conversation.situationId = 'custom';
    value.conversation.customSituation = 'Meeting a new project team';
    $ = page(value);
    summary = $('details[data-persist-id="tutor-conversation-mode"] > summary .rewrite-group-summary');
    for (const fact of ['Source: A situation', 'Situation: Meeting a new project team', 'Roles: Usual',
      'Who starts: KREN starts', 'Register: Formal', `Correction: ${selectedCorrection}`, 'Sends when you stop']) {
      expect(summary.text()).toContain(fact);
    }

    value.conversation.from = 'lesson';
    $ = page(value);
    summary = $('details[data-persist-id="tutor-conversation-mode"] > summary .rewrite-group-summary');
    // Changed 2026-10-04: lesson source retains the situation in its summary.
    expect(summary.text()).toContain('Source: The lesson');
    expect(summary.text()).toContain('Situation: Meeting a new project team');
    expect(summary.text()).toContain(`Correction: ${selectedCorrection}`);
    expect(summary.text()).toContain('Sends when you stop');

    value.conversation.send = 'stopSpeaking'; // Changed 2026-10-18: V263, owner item I43, every runtime turn sends on speech stop.
    $ = page(value);
    summary = $('details[data-persist-id="tutor-conversation-mode"] > summary .rewrite-group-summary');
    // Changed 2026-10-04: assert the selected situation and send semantics rather than punctuation.
    expect(summary.text()).toContain('Situation: Meeting a new project team');
    expect(summary.text()).toContain('Sends when you stop'); // Changed 2026-10-18: V263, owner item I43, every turn sends automatically.
  });
});
