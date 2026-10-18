import { describe, expect, it } from 'vitest';
import { load } from 'cheerio';
import { renderTutorConversation } from '../src/resultViewHtml.js';
import { createTutorViewState, type TutorConversationTurn } from '../src/tutor/state.js';
import { tutorConversationTurn, tutorConversationTurnRequest } from '../src/tutor/generation.js';

const response = {
  move: 'silence', reply: 'That sounds like a long day.', targetId: '',
  replyQuote: '',
  correction: 'I went home before dinner.', explanation: 'Use went for the past event.',
  rephrase: 'I headed home before dinner.',
  rephraseWhy: 'This is a natural way to answer what happened.'
};
function page(value: unknown = response, coachOpen = true) {
  const state = createTutorViewState();
  const turn = { question: 'What happened?', learnerAnswer: 'I go home before dinner.',
    ...tutorConversationTurn(value) };
  Object.assign(state.conversation, { coachOpen, status: 'active',
    transcript: [turn], currentQuestion: turn.reply ?? turn.correction });
  return load(renderTutorConversation(state));
}

describe('V90 correction moves', () => {
  it('R1 names every field in the instruction and schema and makes nextQuestion optional', () => {
    const request = tutorConversationTurnRequest({ register: 'neutral', recipeTargets: { supportingTargets: [] },
      transcript: [], question: 'What happened?', learnerAnswer: 'I go home.' });
    // Changed 2026-09-20: V125 prefixes the repeated English-only rule. Read the response
    // shape sentence itself rather than assuming it is the first sentence forever.
    const enumerationStart = request.instruction.indexOf('Return one JSON object');
    const enumeration = request.instruction.slice(
      enumerationStart, request.instruction.indexOf('.', enumerationStart)
    );
    for (const field of [
      'move', 'reply', 'replyQuote', 'correction', 'targetId', 'explanation',
      'rephrase', 'rephraseWhy', 'nextQuestion'
    ]) {
      expect(enumeration).toContain(`"${field}"`);
      expect(request.schema.properties).toHaveProperty(field);
    }
    // Changed 2026-09-25 for V152: the model must name the exact reply fragment instead
    // of KREN guessing by comparing two independently generated strings.
    // Changed 2026-09-25 for V157: the same response carries the instant rephrasing pair.
    expect(request.schema.required).toEqual([
      'move', 'reply', 'replyQuote', 'correction', 'targetId', 'explanation',
      'rephrase', 'rephraseWhy'
    ]);
    expect(request.schema.required).not.toContain('nextQuestion');
    expect(request.schema.properties).toMatchObject({ move: { type: 'string', enum: ['clarification', 'recast', 'reaction', 'silence'] }, reply: { type: 'string' } });
    expect(request.instruction).toContain('nextQuestion is optional');
    expect(request.instruction).toContain('Always produce correction and explanation, including when move is silence.');
    expect(tutorConversationTurn(response)).not.toHaveProperty('nextQuestion');
  });

  it.each(['clarification', 'recast', 'reaction', 'silence'])('R2 renders the %s reply as one bubble', (move) => {
    const $ = page({ ...response, move });
    const transcript = $('[data-tutor-transcript]');
    expect(transcript.find('[data-tutor-kren-bubble] > p').map((_, el) => $(el).text()).get())
      .toEqual(['What happened?', response.reply]);
    expect(transcript.find('[data-tutor-correction]').text()).toBe(response.correction);
    expect(transcript.find('[data-tutor-turn-explanation] > p').text()).toBe(response.explanation);
  });

  it('R3 silence keeps the correction visible and the explanation in a collapsed inline disclosure', () => {
    const $ = page();
    const learner = $('[data-tutor-learner-turn="0"]');
    // Changed 2026-09-25 for V152: the owner reversed V148. Correction text is plain text
    // in the learner turn's feedback above the collapsed explanation and Ask action.
    const correction = learner.find('[data-tutor-turn-feedback] > [data-tutor-correction]');
    expect(correction.text()).toBe(response.correction);
    expect(correction.parents('details')).toHaveLength(0);
    const disclosure = learner.find('[data-tutor-turn-explanation]');
    expect(disclosure.attr('open')).toBeUndefined();
    expect(disclosure.children('summary').text()).toBe('Why?');
    expect(disclosure.children('p').text()).toBe(response.explanation);
    expect($('[data-tutor-coach]')).toHaveLength(0);
    expect(tutorConversationTurn(response)).toMatchObject({ correction: response.correction, explanation: response.explanation });
    for (const field of ['correction', 'explanation', 'rephrase', 'rephraseWhy']) {
      expect(() => tutorConversationTurn({ ...response, [field]: undefined })).toThrow(field);
    }
  });

  it('R2 recast keeps the conversational reply and adds correction without a marking caption', () => {
    const $ = page({ ...response, move: 'recast', reply: 'You went home early. How was dinner?' });
    const transcript = $('[data-tutor-transcript]');
    expect(transcript.find('[data-tutor-kren-bubble]').last().text()).toContain('You went home early. How was dinner?');
    expect(transcript.find('[data-tutor-correction]').text()).toBe(response.correction);
    expect(transcript.find('[data-tutor-turn-explanation] > p').text()).toBe(response.explanation);
    expect(transcript.text()).not.toMatch(/Correction:|Explanation:/u);
  });

  it.each(['unrecognised-fifth-move', undefined])('R4 preserves the correction fallback for move %s', (move) => {
    // Changed 2026-10-14: V235, owner item 1.1, a present reply is never discarded for a missing move.
    const value = { ...response, move };
    if (move === undefined) delete value.move;
    const $ = page(value);
    expect($('[data-tutor-transcript] [data-tutor-kren-bubble] > p').map((_, el) => $(el).text()).get())
      .toEqual(['What happened?', response.reply]);
    expect($('[data-tutor-transcript]').text()).toContain(response.reply);
    expect($('[data-tutor-correction]').text()).toBe(response.correction);
    expect($('[data-tutor-turn-explanation] > p').text()).toBe(response.explanation);
    expect($('[data-tutor-learner-turn="0"] [data-tutor-correction]').text()).toBe(response.correction);
    expect($('[data-tutor-learner-turn="0"] [data-tutor-turn-explanation] > p').text()).toBe(response.explanation);
    expect($('[data-tutor-reply-bubble]').attr('aria-label')).toBe('KREN');
    expect($('[data-tutor-learner-turn="0"] [data-tutor-reply-bubble]')).toHaveLength(0);
    // Also exercise a held turn directly, so the panel cannot rely on parser normalization.
    const state = createTutorViewState();
    Object.assign(state.conversation, { status: 'stopped', transcript: [{
      question: 'What happened?', learnerAnswer: 'I go home before dinner.', ...value
    } as TutorConversationTurn] });
    const raw = load(renderTutorConversation(state));
    expect(raw('[data-tutor-kren-bubble]').last().find('p').text()).toBe(response.reply);
    expect(raw('[data-tutor-correction]').text()).toBe(response.correction);
    expect(raw('[data-tutor-learner-turn="0"] [data-tutor-turn-explanation] > p').text()).toBe(response.explanation);
    expect(raw('[data-tutor-reply-bubble]').attr('aria-label')).toBe('KREN');
    expect(raw('[data-tutor-learner-turn="0"] [data-tutor-reply-bubble]')).toHaveLength(0);
    for (const reply of ['', response.correction]) {
      const exception = { ...value, reply };
      const parsedException = page(exception);
      Object.assign(state.conversation, { transcript: [{
        question: 'What happened?', learnerAnswer: 'I go home before dinner.', ...exception
      } as TutorConversationTurn] });
      const heldException = load(renderTutorConversation(state));
      for (const rendered of [parsedException, heldException]) {
        expect(rendered('[data-tutor-reply-bubble]')).toHaveLength(0);
        expect(rendered('[data-tutor-kren-bubble] > p').map((_, el) => rendered(el).text()).get()).toEqual(['What happened?']);
        expect(rendered('[data-tutor-learner-turn="0"] [data-tutor-correction]').text()).toBe(response.correction);
        expect(rendered('[data-tutor-learner-turn="0"] [data-tutor-turn-explanation] > p').text()).toBe(response.explanation);
      }
    }
  });

  it('R2 escapes reply text and preserves the last reply after Stop', () => {
    const state = createTutorViewState();
    Object.assign(state.conversation, { status: 'stopped', transcript: [{
      question: 'What happened?', learnerAnswer: 'My answer.',
      ...tutorConversationTurn({ ...response, reply: '<img src=x onerror=alert(1)>' })
    }] });
    const $ = load(renderTutorConversation(state));
    // Changed 2026-09-26: V166 adds a controlled backdrop image; reader text still creates none.
    expect($('[data-tutor-transcript] img:not([data-tutor-picture])')).toHaveLength(0);
    expect($('[data-tutor-transcript] [data-tutor-kren-bubble]').last().find('p').text())
      .toBe('<img src=x onerror=alert(1)>');
  });
});
