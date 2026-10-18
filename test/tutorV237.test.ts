import { describe, expect, it, vi } from 'vitest';
vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn() }, env: {},
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback }) },
  window: { showWarningMessage: vi.fn(async () => 'OK') } }));
import { load } from 'cheerio';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { findTrainingMapNode, TUTOR_MAP } from '@kren/core/tutor';
import { tutorConversationTakeHome, tutorConversationTakeHomeRequest, tutorConversationStopRequest,
  tutorTakeHomeSpeech, type TutorTakeHomeInput } from '../src/tutor/takeHome.js';
import { renderTutorConversation, renderTutorTakeHome } from '../src/resultViewHtml.js';
import { createTutorViewState } from '../src/tutor/state.js';
import { tutorTakeHomeInput } from '../src/resultsViewTakeHome.js';
import type { KrenResultsViewProvider } from '../src/resultsView.js';

const targetId = 'mechanics.time-reality.tense-aspect.present-past-future-reference';
const supportId = 'formulaic.functional-speech-acts.requesting-offering';
const input: TutorTakeHomeInput = { source: 'situation', demo: false, register: 'neutral', demoLines: [],
  turns: [{ turnIndex: 0, question: 'When did you review it?', learnerAnswer: 'i review it yesterday', reply: 'Thanks.' }] };
const rawCard = {
  naturally: [{ turnIndex: 0, quote: input.turns[0]!.learnerAnswer,
    alternatives: ['I reviewed it yesterday.', 'I went over it yesterday.'], why: 'Use the past form for yesterday.' }],
  learningTargets: [{ targetId, why: 'Practice past forms when describing yesterday.' }],
  pattern: { name: 'Past verb + yesterday', examples: ['I called yesterday.', 'We met yesterday.'] },
  doneWell: [], tryNext: 'I checked the plan yesterday.'
};
const lesson: TutorTakeHomeInput = { ...input, source: 'lesson', lessonContext: {
  subject: 'Past events and requests', targets: [targetId, supportId].map((id, index) => ({
    targetId: id, role: index === 0 ? 'primary' : 'support', label: findTrainingMapNode(id)!.label,
    description: findTrainingMapNode(id)!.description })), examples: [], missedPractice: [] } };

describe('V237 spoken take-home teaching', () => {
  it('preserves spoken provenance from the committed transcript', () => {
    const state = createTutorViewState();
    state.conversation.transcript = [{ question: 'When?', learnerAnswer: 'i review it yesterday', spoken: true,
      correction: '', explanation: '' }];
    const view = { tutorState: state, tutorConversationRawAnswers: new Map([[0, 'i review it yesterday']]) } as KrenResultsViewProvider;
    expect(tutorTakeHomeInput(view).turns[0]).toMatchObject({ spoken: true, learnerAnswer: 'i review it yesterday' });
  });

  // Changed 2026-10-15: V241, owner item I6, Stop carries corrections only and card guidance stays in Review now.
  it('instructs the card against written-form advice only when a turn was spoken', () => {
    const spoken = { ...input, turns: input.turns.map(turn => ({ ...turn, spoken: true })) };
    const clause = /spoken turns.*capitalization.*punctuation.*written form/u;
    expect(tutorConversationTakeHomeRequest(spoken).instruction).toMatch(clause);
    expect(tutorConversationTakeHomeRequest(input).instruction).not.toMatch(clause);
    const corrections = { turns: [], recipeTargets: { supportingTargets: [] }, register: 'neutral' as const };
    const stop = tutorConversationStopRequest(corrections, spoken);
    expect(stop.instruction).not.toMatch(clause);
    expect(JSON.parse(tutorConversationTakeHomeRequest(spoken).input).turns[0].spoken).toBe(true);
    expect(JSON.parse(stop.input)).not.toHaveProperty('learningMapTargets');
    expect(JSON.parse(tutorConversationTakeHomeRequest(spoken).input).learningMapTargets.length).toBeGreaterThan(0);
    expect(JSON.parse(stop.input)).toEqual(corrections);
  });

  it('leaves written-form compliance to the instruction without rejecting the response', () => {
    const spoken = { ...input, turns: input.turns.map(turn => ({ ...turn, spoken: true })) };
    expect(tutorConversationTakeHome({ ...rawCard, naturally: [{ ...rawCard.naturally[0],
      why: 'Capitalize the first word.' }] }, spoken).naturally).toHaveLength(1);
  });
});

describe('V237 learning-map evidence', () => {
  it.each([['situation', input], ['anything', { ...input, source: 'anything' as const }]])(
    'supplies compact map identifiers and labels across all clusters for %s', (_source, context) => {
      const candidates = JSON.parse(tutorConversationTakeHomeRequest(context).input).learningMapTargets;
      expect(JSON.stringify(candidates).length).toBeLessThanOrEqual(4000);
      for (const candidate of candidates) expect(candidate.label).toBe(findTrainingMapNode(candidate.targetId)?.label);
      for (const cluster of TUTOR_MAP.filter(node => node.kind === 'cluster')) {
        expect(candidates.some((candidate: { targetId: string }) => candidate.targetId === cluster.id)).toBe(true);
      }
    });

  it('supplies Primary and Support targets and their map neighbors for a lesson', () => {
    const candidates = JSON.parse(tutorConversationTakeHomeRequest(lesson).input).learningMapTargets;
    const ids = candidates.map((candidate: { targetId: string }) => candidate.targetId);
    for (const id of [targetId, supportId]) {
      const node = findTrainingMapNode(id)!;
      for (const neighbor of [id, node.parentId, ...node.prerequisites, ...node.recommendedSupports,
        ...TUTOR_MAP.filter(child => child.parentId === id).map(child => child.id)].filter(Boolean)) expect(ids).toContain(neighbor);
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(JSON.stringify(candidates).length).toBeLessThanOrEqual(4000);
  });

  it('keeps a valid target identifier and drops an unknown identifier', () => {
    const card = tutorConversationTakeHome({ ...rawCard, learningTargets: [rawCard.learningTargets[0],
      { targetId: 'unknown.map.target', why: 'Practice describing past events.' }] }, input);
    expect(card.learningTargets).toEqual(rawCard.learningTargets);
  });

  it('omits unsupported targets when every identifier is unknown', () => {
    const card = tutorConversationTakeHome({ ...rawCard, learningTargets: [
      { targetId: 'unknown.map.target', why: 'Practice describing past events.' }] }, input);
    expect(card.learningTargets ?? []).toEqual([]);
    const state = createTutorViewState(); state.conversation.takeHome = { identity: 'test', card };
    expect(load(renderTutorTakeHome(state.conversation))('h3').text()).not.toContain('Learning targets');
  });

  it.each([undefined, []])('omits Learning targets without evidence %#', (learningTargets) => {
    const card = tutorConversationTakeHome({ ...rawCard, learningTargets }, input);
    const state = createTutorViewState(); state.conversation.takeHome = { identity: 'test', card };
    expect(load(renderTutorTakeHome(state.conversation))('h3').text()).not.toContain('Learning targets');
    expect(tutorTakeHomeSpeech(card)).not.toContain('Learning targets');
  });

  it.each([null, [null], [{ targetId, why: '' }], [{ targetId, why: 'x'.repeat(91) }],
    [{ targetId, why: 'Use the past. Practice requests.' }], [{ targetId: 2, why: 'Use the past.' }],
    [{ targetId, why: 'Use the past.', label: 'Invented label' }],
    Array.from({ length: 4 }, () => rawCard.learningTargets[0])])('drops malformed or excessive target reasons without losing the card %#', (learningTargets) => {
    // Changed 2026-10-15: V245, owner item I22, target failures preserve the other valid sections.
    const log = vi.fn();
    const result = tutorConversationTakeHome({ ...rawCard, learningTargets }, input, log);
    expect(result).toMatchObject({ naturally: rawCard.naturally, tryNext: rawCard.tryNext });
    expect(result.learningTargets ?? []).toEqual(Array.isArray(learningTargets) && learningTargets.length === 4 ? rawCard.learningTargets : []);
    expect(log).toHaveBeenCalled();
  });

  it('permits up to three evidenced targets in demos while keeping scripted speech out of naturally', () => {
    const demo = { ...input, demo: true, turns: [], demoLines: [{ speaker: 'male', text: 'I reviewed it yesterday.' }] };
    const learningTargets = [targetId, supportId, 'mechanics.time-reality'].map(targetId => ({ targetId, why: 'Practice the scripted pattern.' }));
    const card = tutorConversationTakeHome({ ...rawCard, naturally: [], learningTargets }, demo);
    expect(card.learningTargets).toHaveLength(3);
    // Changed 2026-10-15: V245, owner item I22, demo evidence is dropped instead of rejecting teaching.
    expect(tutorConversationTakeHome(rawCard, demo)).toMatchObject({ naturally: [], learningTargets: rawCard.learningTargets });
    expect(tutorConversationTakeHomeRequest(demo).instruction).toMatch(/learningTargets.*scripted lines/u);
  });
});

describe('V237 take-home layout and reading', () => {
  it.each([1, 2, 3])('accepts and renders %i better ways as a list after one learner quote', (count) => {
    const alternatives = ['I reviewed it yesterday.', 'I went over it yesterday.', 'Yesterday I checked it.'].slice(0, count);
    const card = tutorConversationTakeHome({ ...rawCard, naturally: [{ ...rawCard.naturally[0], alternatives }] }, input);
    const state = createTutorViewState(); state.conversation.takeHome = { identity: 'test', card };
    const $ = load(renderTutorConversation(state));
    const section = $('.tutor-take-home-natural');
    // Changed 2026-10-17: V261, F5 owner canvas edit, the learner quote is a paragraph without a small wrapper.
    expect(section.find('p').first().find('q').text()).toBe(input.turns[0]!.learnerAnswer);
    expect(section.find('q').filter((_, node) => $(node).text() === input.turns[0]!.learnerAnswer)).toHaveLength(1);
    expect(section.find('ul li').map((_, node) => $(node).text()).get()).toEqual(alternatives);
    expect(section.children().map((_, node) => node.tagName).get()).toEqual(['p', 'ul', 'p']);
    expect(section.find('p').last().text()).toBe(rawCard.naturally[0]!.why);
    expect(section.text()).not.toMatch(/You said|Native|Also/u);
    expect($('.tutor-take-home').closest('details, [hidden], .hidden')).toHaveLength(0);
    expect($('.tutor-take-home-learning-targets button')).toHaveLength(0);
  });

  it('renders and reads the same section order using map labels', () => {
    const card = tutorConversationTakeHome(rawCard, input);
    const state = createTutorViewState(); state.conversation.takeHome = { identity: 'test', card };
    const $ = load(renderTutorTakeHome(state.conversation));
    expect($('h3').map((_, node) => $(node).text()).get()).toEqual([
      'Say it naturally', 'Learning targets', `Pattern to keep: ${rawCard.pattern.name}`, 'Try next time']);
    expect($('.tutor-take-home-learning-targets').text()).toContain(findTrainingMapNode(targetId)!.label);
    expect($('.tutor-take-home-learning-targets').text()).toContain(rawCard.learningTargets[0]!.why);
    expect($('.tutor-take-home-learning-targets').text()).not.toContain(targetId);
    const speech = tutorTakeHomeSpeech(card);
    expect(speech).toBe(['Take-home.', 'Say it naturally.', ...rawCard.naturally[0]!.alternatives,
      'Learning targets.', `${findTrainingMapNode(targetId)!.label}: ${rawCard.learningTargets[0]!.why}`,
      `Pattern to keep: ${rawCard.pattern.name}`, ...rawCard.pattern.examples, `Try next time: ${rawCard.tryNext}`].join(' '));
    expect(speech).not.toContain(input.turns[0]!.learnerAnswer);
  });

  it('patches the new card in place without replacing the active answer or transcript', () => {
    const source = readFileSync('src/resultViewHtml.ts', 'utf8');
    const patch = source.slice(source.indexOf('function patchTutorTakeHome(message)'), source.indexOf('function syncTutorConversationMode(control)'));
    class Element { innerHTML = ''; }
    const container = new Element(), answer = { value: 'Keep this draft', focused: true }, transcript = new Element();
    transcript.innerHTML = 'Keep these turns';
    const query = vi.fn((selector: string) => selector === '[data-tutor-take-home]' ? container : undefined);
    const state = createTutorViewState(); state.conversation.takeHome = { identity: 'test', card: tutorConversationTakeHome(rawCard, input) };
    runInNewContext(`${patch}\npatchTutorTakeHome(message);`, {
      HTMLElement: Element, document: { querySelector: query }, message: { html: renderTutorTakeHome(state.conversation) } });
    const $ = load(container.innerHTML);
    expect($('.tutor-take-home-natural ul li')).toHaveLength(2);
    expect($('.tutor-take-home-learning-targets').text()).toContain(findTrainingMapNode(targetId)!.label);
    expect(query).toHaveBeenCalledExactlyOnceWith('[data-tutor-take-home]');
    expect(answer).toEqual({ value: 'Keep this draft', focused: true });
    expect(transcript.innerHTML).toBe('Keep these turns');
  });
});
