import { load } from 'cheerio';
import { parse as parseCss } from 'postcss';
import { describe, expect, it } from 'vitest';
import { TUTOR_MAP } from '@kren/core/tutor';
import { renderKrenResultViewHtml, renderTutorConversation } from '../src/resultViewHtml.js';
import { createTutorViewState, tutorRecipeFromState, type TutorViewState } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const target = TUTOR_MAP.find((node) => node.kind === 'microTarget')!;

function conversationState(): TutorViewState {
  const state = createTutorViewState();
  state.selection = [{ nodeId: target.id, role: 'primary' }];
  state.lesson = {
    recipe: tutorRecipeFromState(state),
    lesson: {
      schemaVersion: 1,
      mapVersion: '1.0.0',
      lessonTitle: 'A lesson',
      level: 'B2',
      primaryTarget: {
        nodeId: target.id,
        label: target.label,
        kind: target.kind,
        role: 'primary',
        description: target.description
      },
      supportingTargets: [],
      conceptExplanation: 'Concept.',
      interactionExplanation: 'Interaction.',
      rules: [],
      examples: [],
      commonErrors: [],
      generationNotes: []
    },
    findings: []
  };
  state.exerciseSet = {
    schemaVersion: 1,
    mapVersion: '1.0.0',
    channel: 'written',
    exercises: [{ id: 'exercise-1', channel: 'written', prompt: 'Answer this.', targetIds: [target.id] }]
  };
  Object.assign(state.conversation, {
    from: 'situation',
    status: 'active',
    speakerOn: true,
    currentQuestion: 'What happened next?',
    draftAnswer: 'I called my friend.',
    transcript: Array.from({ length: 5 }, (_, index) => ({
      question: `Question ${index + 1}?`,
      learnerAnswer: `Answer ${index + 1}.`,
      correction: index === 4 ? 'A corrected final answer.' : `Answer ${index + 1}.`,
      explanation: 'A concise explanation.',
      move: 'reaction' as const,
      reply: `Reply ${index + 1}.`
    }))
  });
  return state;
}

function page(state = conversationState()) {
  return load(renderKrenResultViewHtml({
    cspSource: 'test',
    nonce: 'test',
    settings: PANEL_SETTINGS_FIXTURE,
    activeScreen: 'tutor',
    tutor: state,
    proModels: []
  }));
}

describe('V98 embedded tutor conversation', () => {
  it('R1 keeps conversation separate from the Lesson section and practice, with no modal semantics', () => {
    const $ = page();
    const tutorPage = $('.tutor-page');
    // Changed 2026-09-30: V175 wraps Lesson settings and output together; Conversation remains a sibling region.
    const lesson = tutorPage.children('.tutor-lesson-section').children('[data-tutor-result="lesson"]');
    const practice = tutorPage.children('[data-tutor-result="exercises"]');
    const conversation = tutorPage.children('[data-tutor-result="conversation"]');

    expect(lesson).toHaveLength(1);
    expect(practice).toHaveLength(1);
    expect(conversation).toHaveLength(1);
    expect(conversation.is('section[role="region"]')).toBe(true);
    const conversationModals = $('[aria-modal]').filter((_, element) =>
      /conversation/iu.test($(element).attr('aria-label') ?? '') ||
      $(element).is('[class*="tutor-conversation"], [data-tutor-result="conversation"]') ||
      $(element).find('[class*="tutor-conversation"], [data-tutor-result="conversation"]').length > 0
    );
    expect(conversationModals).toHaveLength(0);
    expect(conversation.find('[role="dialog"]').add(conversation.filter('[role="dialog"]'))).toHaveLength(0);
  });

  it('R2 follows lesson and practice by staying present without a disclosure or open and close commands', () => {
    const idle = page(createTutorViewState());
    expect(idle('.tutor-page').children('[data-tutor-result="conversation"]')).toHaveLength(1);
    expect(idle('[data-tutor-result="conversation"]').parents('details')).toHaveLength(0);
    expect(idle('[data-command="openTutorConversation"], [data-command="closeTutorConversation"]')).toHaveLength(0);

    const active = page();
    expect(active('.tutor-page').children('[data-tutor-result="conversation"]')).toHaveLength(1);
  });

  it('R3 removes Back to tutor because conversation is already on the tutor page', () => {
    const $ = page();
    expect($('[data-tutor-result="conversation"]')).not.toContain('Back to tutor');
    expect($('[data-command="closeTutorConversation"]')).toHaveLength(0);
  });

  // Changed 2026-10-15: V241, owner item I6, the active conversation has no diagnosis button.
  it('R4 replaces the launcher with one conversation section that keeps its transcript and diagnosis action', () => {
    const $ = page();
    const conversation = $('[data-tutor-result="conversation"]');
    expect($('[data-tutor-conversation-launcher]')).toHaveLength(0);
    // Changed 2026-09-16: V107 removes the state-reporting facts list.
    expect(conversation.find('[data-tutor-conversation-facts]')).toHaveLength(0);
    expect(conversation.text()).toContain('A corrected final answer.');
    expect(conversation.find('[data-command="diagnoseTutorConversation"]')).toHaveLength(0);
  });

  // Changed 2026-10-15: V241, owner item I6, active controls exclude the stopped review action.
  it('R5 keeps the complete conversation workflow in the embedded section', () => {
    const active = load(renderTutorConversation(conversationState()));
    for (const command of [
      'toggleTutorConversationSpeaker',
      'dictateTutorConversation',
      'replayTutorQuestion',
      'hintTutorConversation',
      'skipTutorConversationTurn',
      'stopTutorConversation',
      'submitTutorConversationTurn',
      'askTutorConversationTurn',
      'diagnoseTutorConversation'
    ]) expect(active(`[data-command="${command}"]`).length > 0, command).toBe(!['diagnoseTutorConversation', 'submitTutorConversationTurn'].includes(command)); // Changed 2026-10-18: V263, owner item I43, Send is absent from the reachable workflow.
    expect(active('[data-tutor-microphone-slot]')).toHaveLength(0);
    // Changed 2026-09-17: turns that needed no correction carry no coaching block, and only
    // the last of these five was corrected.
    expect(active('[data-tutor-transcript] [data-tutor-turn-feedback]')).toHaveLength(1);

    const stopped = conversationState();
    stopped.conversation.status = 'stopped';
    // Changed 2026-09-25 for V156: stopped Start new has its own setup-only command;
    // the never-started Start button remains startTutorConversation.
    expect(load(renderTutorConversation(stopped))('[data-command="startNewTutorConversation"]'))
      .toHaveLength(1);
  });

  it('R6 keeps the conversation flexible while only the transcript has a scroll ceiling', () => {
    const $ = page();
    const offenders: string[] = [];
    parseCss($('style').text()).walkRules((rule) => {
      if (!rule.selectors.some((selector) => /tutor-(?:conversation|chat|turn)/u.test(selector))) return;
      rule.walkDecls((declaration) => {
        if (declaration.prop === 'max-height' ||
            (declaration.prop === 'overflow-y' && declaration.value === 'auto')) {
          offenders.push(`${rule.selector}: ${declaration.prop}: ${declaration.value}`);
        }
      });
    });
    // Changed 2026-10-01: V178 removes the transcript ceiling only inside a shown picture.
    expect(offenders.every((entry) => entry.startsWith('.tutor-chat-transcript:') ||
      entry === '.tutor-chat-viewport-picture > .tutor-chat-transcript: max-height: none')).toBe(true);
    expect(offenders.some((entry) => entry.includes('max-height:'))).toBe(true);
    expect(offenders.some((entry) => entry.includes('overflow-y: auto'))).toBe(true);
  });

  // Changed 2026-10-15: V241, owner item I6, review follows the stopped transcript outside disclosures.
  it('R7 places the diagnosis choice directly after the transcript', () => {
    const state = conversationState(); state.conversation.status = 'stopped';
    const $ = page(state);
    const conversation = $('[data-tutor-result="conversation"]');
    const disclosure = conversation.find('.tutor-conversation-disclosure');
    const diagnosis = conversation.find('[data-command="reviewTutorConversation"]');
    // Changed 2026-09-16: V107 removes the disclosure sentence and its wrapper.
    expect(disclosure).toHaveLength(0);
    // Changed 2026-09-27: diagnosis follows the picture viewport around the transcript.
    expect(diagnosis.closest('[data-tutor-stopped-actions]').parent().prevAll('[data-tutor-transcript], [data-tutor-picture-viewport]').length > 0)
      .toBe(true);
    expect(diagnosis).toHaveLength(1);
    expect(diagnosis.parents('details, [hidden], [inert]')).toHaveLength(0);
  });
});
