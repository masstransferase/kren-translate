// 2026-10-15: V242 covers coherent turns, cooperative casting, and instruction-only handoffs.
import { describe, expect, it } from 'vitest';
import {
  TUTOR_CONVERSATION_SCENE_SLANT_WEIGHTS,
  tutorConversationLiveResumeInstruction,
  tutorConversationLiveSystemInstruction,
  tutorConversationSceneSlant,
  tutorConversationTurn,
  tutorConversationTurnRequest
} from '../src/tutor/generation.js';

const response = { move: 'reaction', replyQuote: '', correction: 'I need oat milk.', targetId: '',
  explanation: 'This is already natural.', rephrase: 'I need oat milk.', rephraseWhy: 'This fits the request.' };
const turnRequest = { register: 'neutral' as const, recipeTargets: { supportingTargets: [] },
  transcript: [], question: 'What would you like?', learnerAnswer: 'I need oat milk.' };

describe('V242 coherent conversation turns', () => {
  it.each([
    ['Do you have a preferred brand or just need any organic oat milk?', 'Do you have a preferred brand or just need any organic oat milk?'],
    ['We have organic oat milk. Which one sounds good to you?', '  WHICH one sounds good to you？！  '],
    ['Which brand would you like? We stock both.', 'Would you like anything else?'],
    ['We have two local brands. Which one sounds good to you', 'Which one sounds good to you?']
  ])('drops a redundant next question after %s', (reply, nextQuestion) => {
    const result = tutorConversationTurn({ ...response, reply, nextQuestion });
    expect(result).not.toHaveProperty('nextQuestion');
    expect(result.reply).toBe(reply);
    expect(result.correction).toBe(response.correction);
  });

  it.each([
    ['Sure, we have a couple of local oat milk brands, let me show you.', 'Which one sounds good to you?'],
    ['Sure, let me explain each brand to you.', 'Which one sounds good to you?'],
    ['Oat Valley is creamy; Farm Oats is unsweetened.', 'Which one sounds good to you?']
  ])('keeps a moving-on question after a statement: %s', (reply, nextQuestion) => {
    // The instruction supplies missing content; parsing cannot invent a brand or explanation.
    expect(tutorConversationTurn({ ...response, reply, nextQuestion })).toMatchObject({ reply, nextQuestion });
  });

  it('removes target marks for a dropped question and preserves marks for shown text', () => {
    const mark = { targetId: 'primary', quote: 'Could you', occurrence: 0 };
    const result = tutorConversationTurn({ ...response, reply: 'Could you choose a brand?',
      nextQuestion: 'Could you choose a brand?', targetMarks: [
        { ...mark, field: 'reply' }, { ...mark, field: 'nextQuestion' }
      ] }, false, ['primary']);
    expect(result.targetMarks).toEqual([{ ...mark, field: 'reply' }]);
  });

  it('keeps a follow-up when the only question is the quoted correction of the learner', () => {
    const replyQuote = 'Do you have oat milk?';
    const nextQuestion = 'Which brand would you like?';
    expect(tutorConversationTurn({ ...response, replyQuote,
      reply: `Actually, you would say: ${replyQuote} Yes, we have two brands.`, nextQuestion }))
      .toHaveProperty('nextQuestion', nextQuestion);
  });
});

describe('V242 weighted private scene slants', () => {
  it('draws about 60 percent cooperative, 30 percent mild, and 10 percent hard over 1,000 seeded draws', () => {
    const table = TUTOR_CONVERSATION_SCENE_SLANT_WEIGHTS;
    const total = table.reduce((sum, entry) => sum + entry.weight, 0);
    let seed = 242;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    const counts = { cooperative: 0, mild: 0, hard: 0 };
    for (let index = 0; index < 1000; index++) {
      const selected = tutorConversationSceneSlant(random);
      const entry = table.find(candidate => candidate.slant === selected)!;
      counts[entry.difficulty]++;
    }
    for (const difficulty of ['cooperative', 'mild', 'hard'] as const) {
      const expected = table.filter(entry => entry.difficulty === difficulty)
        .reduce((sum, entry) => sum + entry.weight, 0) / total;
      expect(expected).toBe({ cooperative: 0.6, mild: 0.3, hard: 0.1 }[difficulty]);
      expect(Math.abs(counts[difficulty] / 1000 - expected)).toBeLessThan(0.04);
    }
    for (const entry of table.filter(entry => entry.difficulty === 'hard')) {
      expect(entry.slant).toMatch(/still willing to help and stay in the conversation/u);
    }
  });

  it('uses every weight interval and clamps the ends', () => {
    const table = TUTOR_CONVERSATION_SCENE_SLANT_WEIGHTS;
    const total = table.reduce((sum, entry) => sum + entry.weight, 0);
    let cumulative = 0;
    for (const entry of table) {
      expect(entry.weight).toBeGreaterThan(0);
      expect(tutorConversationSceneSlant(() => (cumulative + entry.weight / 2) / total)).toBe(entry.slant);
      cumulative += entry.weight;
    }
    expect(tutorConversationSceneSlant(() => -1)).toBe(table[0].slant);
    expect(tutorConversationSceneSlant(() => 1)).toBe(table[table.length - 1]!.slant);
  });
});

describe('V242 conversation instructions', () => {
  const opening = { kind: 'anything' as const, register: 'neutral' as const,
    sceneSlant: 'the counterpart is strong, competent, well prepared' as const };
  const instructions = [
    ['Standard', () => tutorConversationTurnRequest(turnRequest).instruction],
    ['Standard hidden learner turn', () => tutorConversationTurnRequest({ ...turnRequest, learnerAnswer: '안녕하세요' }).instruction],
    ['Live', () => tutorConversationLiveSystemInstruction(opening, false)],
    ['resumed Live', () => tutorConversationLiveResumeInstruction([])]
  ] as const;
  it.each(instructions)('%s delivers offered information and keeps a requested replacement character', (_mode, instruction) => {
    const text = instruction();
    expect(text).toContain('A reply that offers information must give it in the same reply');
    expect(text).toMatch(/name the brands, explain the options, or give the directions/u);
    expect(text).toContain('never say "let me show you"');
    expect(text).toMatch(/manager, a supervisor, a colleague, or anyone else who could help/u);
    expect(text).toContain('hands over in one short line');
    expect(text).toContain('reply continues as the new character');
    expect(text).toContain('stays for the rest of the conversation');
    expect(text).toContain('consistent with the scene');
    expect(text).toContain('overrides the initial character assignment');
    expect(text).toContain('If the transcript already shows a handoff, continue as the replacement');
  });
  it('requires Standard to omit nextQuestion when reply asks something', () => {
    expect(tutorConversationTurnRequest(turnRequest).instruction)
      .toContain('When reply asks something, omit nextQuestion.');
  });
});
