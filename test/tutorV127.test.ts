import { runInNewContext } from 'node:vm';
import { load } from 'cheerio';
import { describe, expect, it, vi } from 'vitest';
import { renderKrenResultViewHtml, renderTutorConversation } from '../src/resultViewHtml.js';
import { mountedPanel } from './support/mountedPanel.js';
import { createTutorViewState, tutorConversationPreferences } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

function activeConversation(replies: 'standard' | 'liveGemini' = 'standard') {
  const state = createTutorViewState();
  Object.assign(state.conversation, {
    status: 'active',
    replies,
    currentQuestion: 'What happened next?',
    draftAnswer: ''
  });
  state.speech.handyStatus = 'available';
  return state;
}

// Changed 2026-10-18: V263, owner item I43, exercise Handy capture through the shipped panel and the one microphone.
function standardPanelHarness(send: 'button' | 'stopSpeaking') {
  const state = activeConversation('standard');
  state.conversation.send = tutorConversationPreferences({ send }).send!;
  const messages: Array<Record<string, unknown>> = [];
  const panel = mountedPanel(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
    activeScreen: 'tutor', tutor: state, tutorSpeechProvider: 'handy', proModels: [] }), message => messages.push(message));
  const microphone = panel.query('[data-tutor-chat-mic-control]')!;
  return { panel, microphone, messages };
}

describe('V127 conversation controls and voices, 2026-09-20', () => {
  it.each([
    ['When I stop speaking', 'stopSpeaking' as const],
    ['With the Send button', 'button' as const]
  ])('drives Handy through Standard and sends the pasted answer with %s', (_name, send) => {
    vi.useFakeTimers();
    try {
      const panel = standardPanelHarness(send);
      panel.panel.click(panel.microphone);
      const capture = panel.panel.query('[data-tutor-handy-capture]')!;
      expect(panel.panel.document.activeElement).toBe(capture);
      panel.panel.message({ command: 'tutorDictationState', conversation: true, provider: 'handy', state: 'recording' });
      panel.panel.click(panel.microphone);
      capture.textContent = 'Handy pasted this Standard answer.';
      panel.panel.input(capture, 'insertFromPaste');
      vi.advanceTimersByTime(800);
      expect(panel.panel.query('[data-tutor-conversation-answer]')).toBeNull();
      expect(panel.messages).toContainEqual({
        command: 'updateTutorConversationAnswer',
        answer: 'Handy pasted this Standard answer.',
        spoken: true
      });
      expect(panel.messages).toContainEqual(expect.objectContaining({
        command: 'submitTutorConversationTurn'
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders a reloaded Standard conversation with Handy, never the Live Talk route', () => {
    const state = activeConversation('standard');
    const $ = renderTutorConversation(state, 'handy');
    expect($).toContain('data-tutor-live-talk="false"');
    expect($).toContain('data-tutor-dictation-provider="handy"');
  });

  it('orders the reachable controls speaker, hint, skip, replay, stop, with the only microphone inside chat', () => {
    const state = activeConversation('standard');
    state.conversation.currentQuestion = 'A question to replay.';
    state.conversation.draftAnswer = 'An answer to send.';
    const $ = load(renderTutorConversation(state, 'handy'));
    const left = $('[data-tutor-composer-actions] [data-command]').map(
      (_index, element) => $(element).attr('data-command')
    ).get();
    const right = $('[data-tutor-chat-microphone] [data-command]').map(
      (_index, element) => $(element).attr('data-command')
    ).get();

    expect(left).toEqual([
      'toggleTutorConversationSpeaker',
      'hintTutorConversation',
      'skipTutorConversationTurn',
      'replayTutorQuestion',
      'stopTutorConversation'
    ]);
    // Changed 2026-10-18: V263, owner item I43, chat has Stop and the microphone; Send is removed.
    expect(right).toEqual(['stopTutorConversation', 'dictateTutorConversation']);
    expect($('[data-command="replayTutorConversation"]')).toHaveLength(0);
  });

  it('gives the one Replay control its active, stopped, and playing jobs and titles', () => {
    const state = activeConversation('standard');
    state.conversation.currentQuestion = 'The latest KREN reply.';
    const active = load(renderTutorConversation(state, 'handy'));
    expect(active('[data-command="replayTutorQuestion"]').attr('title'))
      .toBe('Replay the last thing KREN said');

    Object.assign(state.conversation, {
      status: 'stopped',
      transcript: [{
        question: 'Question?', learnerAnswer: 'Answer.', correction: 'Answer.', explanation: ''
      }]
    });
    const stopped = load(renderTutorConversation(state, 'handy'));
    expect(stopped('[data-command="replayTutorQuestion"]').attr('title'))
      .toBe('Replay the conversation');
    state.conversation.replayAllSpeaking = true;
    const playing = load(renderTutorConversation(state, 'handy'));
    expect(playing('[data-command="replayTutorQuestion"]').attr('title')).toBe('Stop replaying');
  });

  it.each(['handy', 'gemini'] as const)(
    'pulses the Standard microphone while %s dictation is recording',
    (provider) => {
      const state = activeConversation('standard');
      state.speech.dictatingConversation = true;
      state.speech.dictationProvider = provider;
      const $ = load(renderTutorConversation(state, provider, true));
      const microphone = $('[data-command="dictateTutorConversation"]');
      expect(microphone.attr('data-tutor-live-talk')).toBe('false');
      expect(microphone.hasClass('tutor-microphone-pulsing')).toBe(true);
    }
  );
});
