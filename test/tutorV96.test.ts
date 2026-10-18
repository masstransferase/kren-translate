import { load } from 'cheerio';
import { parse as parseCss } from 'postcss';
import { describe, expect, it } from 'vitest';
import { TUTOR_MAP } from '@kren/core/tutor';
import { renderKrenResultViewHtml, renderTutorConversation } from '../src/resultViewHtml.js';
import { createTutorViewState, type TutorViewState } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

function conversationState(): TutorViewState {
  const state = createTutorViewState();
  Object.assign(state.conversation, {
    coachOpen: true,
    from: 'situation',
    status: 'active',
    speakerOn: true,
    // Changed 2026-09-20: V125 defaults to Live. This reachability test needs text Replay.
    replies: 'standard',
    currentQuestion: 'What happened next?',
    currentTurnIndex: 0,
    draftAnswer: 'I called my friend.',
    transcript: [
      {
        question: 'Where did you go?',
        learnerAnswer: 'I go to the library.',
        correction: 'I went to the library.',
        explanation: 'Use went for a completed past action.',
        targetId: TUTOR_MAP[0]!.id,
        move: 'recast',
        reply: 'You went to the library. What did you read?'
      },
      {
        question: 'What did you read?',
        learnerAnswer: "It's a novel.",
        correction: 'It\u2019s a novel.',
        explanation: 'This answer already uses the expected form.',
        targetId: TUTOR_MAP[1]!.id,
        move: 'reaction',
        reply: 'That sounds interesting.'
      },
      {
        question: 'Who wrote it?',
        learnerAnswer: 'A local writer wrote it.',
        correction: 'A local writer wrote it.',
        explanation: 'The simple past is correct here.',
        move: 'reaction',
        reply: 'I would like to read it.'
      },
      {
        question: 'Would you recommend it?',
        learnerAnswer: 'Yes, I recommend it.',
        correction: 'Yes, I would recommend it.',
        explanation: 'Would matches the wording of the question.',
        move: 'recast',
        reply: 'You would recommend it. Why?'
      },
      {
        question: 'Why?',
        learnerAnswer: 'Because story was exciting.',
        correction: 'Because the story was exciting.',
        explanation: 'A singular count noun needs a determiner here.',
        move: 'recast',
        reply: 'The story was exciting. That is a good recommendation.'
      }
    ]
  });
  return state;
}

function fullPage(state = conversationState()) {
  return load(renderKrenResultViewHtml({
    cspSource: 'test',
    nonce: 'test',
    settings: PANEL_SETTINGS_FIXTURE,
    activeScreen: 'tutor',
    tutor: state,
    proModels: []
  }));
}

function declarations($: ReturnType<typeof fullPage>, selector: string) {
  const values: Record<string, string> = {};
  parseCss($('style').text()).walkRules((rule) => {
    if (rule.selectors.includes(selector)) {
      rule.walkDecls((declaration) => { values[declaration.prop] = declaration.value; });
    }
  });
  return values;
}

describe('V96 inline conversation coaching', () => {
  it('R1 places a correction beside its learner turn and omits an identical correction', () => {
    const $ = load(renderTutorConversation(conversationState()));
    const first = $('[data-tutor-learner-turn="0"]');
    // Changed 2026-09-25 for V152: the owner reversed V148. Answer, correction, and
    // explanation share the turn wrapper, with the correction in plain feedback text.
    expect(first.children('.tutor-chat-learner').children('[data-tutor-learner-answer]').text())
      .toBe('I go to the library.');
    expect(first.find('[data-tutor-turn-feedback] > [data-tutor-correction]').text())
      .toBe('I went to the library.');

    // Changed 2026-09-17 at the reader's instruction: a turn KREN did not correct carries no
    // coaching at all. The short line that used to say so is gone with it.
    for (const position of [1, 2]) {
      expect($(`[data-tutor-learner-turn="${position}"] [data-tutor-turn-feedback]`)).toHaveLength(0);
      expect($(`[data-tutor-learner-turn="${position}"] + [data-tutor-correction-bubble]`)).toHaveLength(0);
      expect($(`[data-tutor-learner-turn="${position}"] [data-tutor-learner-answer]`).text())
        .toBe(conversationState().conversation.transcript[position]!.learnerAnswer);
    }
  });

  it('R2 removes the separate coaching card and prints each learner answer only in its transcript bubble', () => {
    const markup = renderTutorConversation(conversationState());
    const $ = load(markup);
    expect($('[data-tutor-coach], [data-tutor-conversation-turn], .tutor-coach-strip')).toHaveLength(0);
    expect(markup).not.toMatch(/KREN asked:|You answered:/u);
    const renderedAnswers = $('[data-tutor-learner-answer]').map((_, element) => $(element).text()).get();
    for (const turn of conversationState().conversation.transcript) {
      expect(renderedAnswers.filter((answer) => answer === turn.learnerAnswer), turn.learnerAnswer)
        .toHaveLength(1);
    }
    // Changed 2026-09-17: two of these five turns were already right, and those carry no
    // coaching block now, so three remain.
    expect($('[data-tutor-turn-feedback]')).toHaveLength(3);
    expect($('[data-tutor-turn-feedback] [data-command="askTutorConversationTurn"]')).toHaveLength(3);
  });

  it('R3 keeps correction visible and puts the explanation and Ask control in a quiet per-turn disclosure', () => {
    const $ = load(renderTutorConversation(conversationState()));
    const learner = $('[data-tutor-learner-turn="0"]');
    // Changed 2026-09-25 for V152: the owner reversed V148. Correction, Why?, and Ask are
    // together in feedback, while only the model-named reply span can be blue and bold.
    const correction = learner.find('[data-tutor-turn-feedback] > [data-tutor-correction]');
    const disclosure = learner.find('details[data-tutor-turn-explanation]');
    expect(correction.text()).toBe('I went to the library.');
    expect(correction.parents('details')).toHaveLength(0);
    expect(disclosure.attr('open')).toBeUndefined();
    expect(disclosure.children('summary').text()).toBe('Why?');
    expect(disclosure.text()).toContain('Use went for a completed past action.');
    expect(disclosure.find('[data-command="askTutorConversationTurn"][data-tutor-turn="0"]')).toHaveLength(1);
    const script = fullPage()('script').text();
    const askBranch = script.slice(
      script.indexOf("if (command === 'askTutorConversationTurn')"),
      script.indexOf("if (command === 'submitTutorTool')")
    );
    expect(askBranch).toContain("input: target.getAttribute('data-tutor-turn')");
  });

  it('R4 makes the complete transcript the turn navigation and removes Back and Next', () => {
    const $ = load(renderTutorConversation(conversationState()));
    expect($('[data-command="showPreviousTutorConversationTurn"], [data-command="showNextTutorConversationTurn"]'))
      .toHaveLength(0);
    expect($('[data-tutor-learner-turn]')).toHaveLength(5);
    // Changed 2026-09-17: only turns KREN corrected print a correction.
    expect($('[data-tutor-correction]').map((_, element) => $(element).text()).get())
      .toEqual([
        'I went to the library.',
        'Yes, I would recommend it.',
        'Because the story was exciting.'
      ]);
  });

  it('R5 gives setup one labelled MODE summary and removes progress facts', () => {
    const state = conversationState();
    const sectionMarkup = renderTutorConversation(state);
    const section = load(sectionMarkup);
    // Changed 2026-09-16: V106 keeps the setup as disabled controls during a conversation.
    expect(section('[data-tutor-conversation-from]').val()).toBe('situation');
    expect(section('[data-tutor-conversation-from]').is(':disabled')).toBe(true);
    // Changed 2026-09-16: V107 uses the shared pipe-separated summary and removes facts.
    expect(section('details[data-persist-id="tutor-conversation-mode"] > summary').text())
      .toContain('Source: A situation | Situation:');
    expect(section('[data-tutor-conversation-facts]')).toHaveLength(0);
  });

  it('R6 omits internal learning-map vocabulary and target labels from the conversation interface', () => {
    const state = conversationState();
    const labels = state.conversation.transcript.flatMap((turn) => turn.targetId
      ? [TUTOR_MAP.find((node) => node.id === turn.targetId)?.label ?? turn.targetId]
      : []);
    const markup = renderTutorConversation(state);
    expect(markup).not.toMatch(/Learning-map target/iu);
    for (const label of labels) expect(markup).not.toContain(label);
  });

  it('R7 gives no conversation rule horizontal auto scrolling and wraps constrained content', () => {
    const $ = fullPage();
    const offenders: string[] = [];
    parseCss($('style').text()).walkRules((rule) => {
      if (!rule.selectors.some((selector) => /tutor-(?:conversation|chat|coach|turn)/u.test(selector))) return;
      rule.walkDecls('overflow-x', (declaration) => {
        if (declaration.value === 'auto') offenders.push(rule.selector);
      });
    });
    expect(offenders).toEqual([]);
    // Changed 2026-09-17: V110 removes the speaker header, and its control row owns wrapping.
    expect(declarations($, '.tutor-composer-controls')).toMatchObject({ 'flex-wrap': 'wrap' });
    expect(declarations($, '.tutor-chat-transcript')).toMatchObject({ 'overflow-x': 'hidden' });
    for (const selector of ['.tutor-chat-kren', '.tutor-chat-learner']) {
      expect(declarations($, selector)).toMatchObject({ 'overflow-wrap': 'anywhere' });
    }
    expect($('[data-command="toggleTutorCoach"]')).toHaveLength(0);
  });

  it('R8 keeps setup and composer flexible while bounding the scrolling transcript', () => {
    const $ = fullPage();
    const setup = declarations($, '.tutor-conversation-setup');
    expect(setup).not.toHaveProperty('max-height');
    expect(setup).not.toHaveProperty('overflow');
    // Changed 2026-09-27: the transcript has a viewport-based ceiling so its image
    // stays the size of the visible area as turns accumulate.
    expect(declarations($, '.tutor-chat-transcript')['max-height']).toMatch(/vh/u);
    expect(declarations($, '.tutor-chat-transcript')['overflow-y']).toBe('auto');
    expect(declarations($, '.tutor-conversation-composer')).not.toHaveProperty('max-height');
    expect($('.tutor-coach')).toHaveLength(0);
  });

  // Changed 2026-10-15: V241, owner item I6, the reachable review control belongs to the stopped conversation.
  it('R9 keeps every conversation action and the diagnosis control reachable', () => {
    const $ = load(renderTutorConversation(conversationState()));
    for (const command of [
      'toggleTutorConversationSpeaker',
      'replayTutorQuestion',
      'hintTutorConversation',
      'skipTutorConversationTurn',
      'stopTutorConversation',
      'submitTutorConversationTurn',
      'askTutorConversationTurn',
      'diagnoseTutorConversation'
    ]) {
      expect($(`[data-command="${command}"]`).first().is('button:not(:disabled)'), command).toBe(!['diagnoseTutorConversation', 'submitTutorConversationTurn'].includes(command)); // Changed 2026-10-18: V263, owner item I43, Send is absent from the reachable workflow.
    }
    const stopped = conversationState(); stopped.conversation.status = 'stopped';
    const diagnosis = load(renderTutorConversation(stopped))('[data-command="reviewTutorConversation"]');
    expect(diagnosis.parents('details, [hidden], [inert]')).toHaveLength(0);
    expect(diagnosis.closest('.tutor-conversation')).toHaveLength(1);
  });
});
