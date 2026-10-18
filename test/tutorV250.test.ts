import { randomUUID } from 'node:crypto';
import { load } from 'cheerio';
import { expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn() }, window: {},
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));

import { KrenResultsViewProvider } from '../src/resultsView.js';
import { completeStandardTutorTurn } from '../src/resultsViewTurns.js';
import { completeTutorConversationOpening } from '../src/resultsViewConversation.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { createTutorViewState, sanitizeTutorConversationText, tutorConversationReply } from '../src/tutor/state.js';
import { requestTutorStructuredJson, tutorConversationTurn, tutorConversationOpening, tutorConversationDemoBatch,
  type TutorStructuredGenerationRequest } from '../src/tutor/generation.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

const ownerReply = 'I think we have a few cartons of the Silk soy milk left, if that works for your recipe. Are you baking something special today?';
const response = { move: 'reaction', reply: ownerReply, replyQuote: '', correction: 'I need soy milk.', targetId: '',
  explanation: 'Use a complete sentence.', rephrase: 'I would like soy milk.', rephraseWhy: 'This is a polite request.' };
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };

async function returned(kind: TutorStructuredGenerationRequest['kind'], value: unknown) {
  return requestTutorStructuredJson({ provider: 'openai', model: 'test-model', apiKey: randomUUID(),
    thinkingOrEffort: 'auto', maxAttempts: 1 }, {
    kind, instruction: 'Return the requested object.', input: '', schemaName: 'test', schema: { type: 'object' }
  }, new AbortController().signal, vi.fn(async () => new Response(JSON.stringify({
    output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }]
  }))) as typeof fetch);
}

function harness() {
  let panel!: ReturnType<typeof mountedPanel>;
  let documents = 0;
  const actions = { settings: () => PANEL_SETTINGS_FIXTURE, log: vi.fn(), notify: vi.fn(), stopReadAloud: vi.fn(),
    readAloudText: vi.fn(async (_text: string) => {}), refreshReadAloudVoices: vi.fn(async () => {}),
    writeTutorPreferences: vi.fn() };
  const view = new KrenResultsViewProvider(actions as never, {} as never);
  const internals = view as unknown as { activeScreen: string; tutorSpeechHolds: number };
  internals.activeScreen = 'tutor';
  Object.assign(view.tutorState.conversation, { status: 'active', speakerOn: true, replies: 'standard',
    coaching: 'inline', situationPicture: 'none', currentQuestion: 'What do you need?' });
  view.view = { visible: true, webview: { cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }),
    set html(value: string) { documents++; panel = mountedPanel(value, () => {}); },
    postMessage: vi.fn(async (message: Record<string, unknown>) => { panel.message(message); return true; }) } } as never;
  view.render();
  internals.tutorSpeechHolds = 1;
  return { view, actions, panel: () => panel, documents: () => documents };
}

it.each(['***', '---', '___', '===', '###', '~~~', '* - _ = # ~', '**********', '* * *'])(
  'drops a separator line %s without changing adjacent text or line endings', separator => {
    expect(sanitizeTutorConversationText(`Before.\r\n \t${separator} \t\r\nAfter.`)).toBe('Before.\r\nAfter.');
    expect(sanitizeTutorConversationText(`  Before.\n${separator}\n `)).toBe('Before.');
  });

it.each(['**', '__', '*', '_'])('removes %s emphasis around words and single letters', marker => {
  expect(sanitizeTutorConversationText(`Try the ${marker}oat milk${marker} today.`)).toBe('Try the oat milk today.');
  expect(sanitizeTutorConversationText(`Choose ${marker}a${marker}.`)).toBe('Choose a.');
});

it.each(['co*operate', 'well-known', 'file_name', '2 * 3 = 6', '--', 'Hello.\r\nNext.', 'a**b**c'])(
  'preserves ordinary text %s', text => expect(sanitizeTutorConversationText(text)).toBe(text));

it('shows and speaks the owner reply without the ten-asterisk line, including an in-place patch', async () => {
  const h = harness(); const panel = h.panel();
  const answer = panel.query('[data-tutor-conversation-answer]');
  const turn = tutorConversationTurn(await returned('conversationTurn', { ...response, reply: `${ownerReply}\n**********` }));
  completeStandardTutorTurn(h.view, turn, 'What do you need?', 'Soy milk, please.', false);
  h.view.render(); await flush();
  expect(h.actions.readAloudText.mock.calls.map(call => call[0])).toEqual([ownerReply]);
  expect(h.view.tutorState.conversation.transcript[0]?.reply).toBe(ownerReply);
  expect(h.view.tutorState.conversation.currentQuestion).toBe(ownerReply);
  expect(h.panel()).toBe(panel); expect(h.documents()).toBe(1);
  expect(panel.query('[data-tutor-conversation-answer]')).toBe(answer);
  const bubble = panel.query('[data-tutor-reply-bubble]')!;
  expect(bubble.textContent).toBe(ownerReply);
  expect(bubble.closest('details')).toBeNull(); expect(bubble.hidden).toBe(false);
  const firstRender = load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [],
    settings: PANEL_SETTINGS_FIXTURE, activeScreen: 'tutor', tutor: h.view.tutorState }));
  expect(firstRender('[data-tutor-reply-bubble]').text()).toBe(ownerReply);
});

it('accepts a separator-only reply, retains feedback, and never substitutes feedback into its balloon', async () => {
  const h = harness();
  const turn = tutorConversationTurn(await returned('conversationTurn', { ...response, reply: '**********', replyQuote: '***' }));
  expect(turn).toMatchObject({ move: response.move, reply: '', correction: response.correction,
    explanation: response.explanation, rephrase: response.rephrase, rephraseWhy: response.rephraseWhy });
  expect(tutorConversationReply(turn)).toBe('');
  completeStandardTutorTurn(h.view, turn, 'What do you need?', 'Soy milk, please.', false);
  h.view.render(); await flush();
  expect(h.view.tutorState.conversation.transcript[0]).toMatchObject({ reply: '', replyQuote: '', correction: response.correction,
    explanation: response.explanation, rephrase: response.rephrase, rephraseWhy: response.rephraseWhy });
  expect(h.view.tutorState.conversation.failure).toBeUndefined();
  expect(h.actions.readAloudText).not.toHaveBeenCalled();
  expect(h.panel().query('[data-tutor-transcript]')!.querySelectorAll('[data-tutor-kren-bubble]')
    .some(bubble => bubble.textContent.includes(response.correction))).toBe(false);
});

it('drops quotes and target marks that refer only to removed markers, while keeping valid marks', () => {
  const h = harness();
  const turn = tutorConversationTurn({ ...response, reply: 'Try the **oat milk** today.\n**********', replyQuote: '**',
    targetMarks: [{ field: 'reply', targetId: 'target', quote: '**', occurrence: 0 },
      { field: 'reply', targetId: 'target', quote: 'oat milk', occurrence: 0 }] }, false, ['target']);
  expect(turn.targetMarks).toEqual([{ field: 'reply', targetId: 'target', quote: 'oat milk', occurrence: 0 }]);
  completeStandardTutorTurn(h.view, turn, 'What do you need?', 'Soy milk, please.', false);
  expect(h.view.tutorState.conversation.transcript[0]?.replyQuote).toBe('');
  expect(h.view.tutorState.conversation.failure).toBeUndefined();
});

it('uses cleaned reply and nextQuestion text for both the balloons and speech', async () => {
  const h = harness();
  const turn = tutorConversationTurn(await returned('conversationTurn', { ...response,
    reply: 'Try the **oat milk** today.', nextQuestion: 'What will you __bake__?\n---', replyQuote: 'oat milk' }));
  completeStandardTutorTurn(h.view, turn, 'What do you need?', 'Soy milk, please.', false);
  h.view.render(); await flush();
  expect(h.actions.readAloudText.mock.calls.map(call => call[0])).toEqual(['Try the oat milk today.', 'What will you bake?']);
  expect(h.view.tutorState.conversation.currentQuestion).toBe('What will you bake?');
  expect(h.view.tutorState.conversation.transcript[0]?.replyQuote).toBe('oat milk');
  const dialogue = h.panel().query('[data-tutor-transcript]')!.textContent;
  expect(dialogue).toContain('Try the oat milk today.'); expect(dialogue).toContain('What will you bake?');
});

it('accepts cleaned openings before patching the panel and speaking them', async () => {
  const h = harness(); const panel = h.panel();
  const controller = new AbortController(); h.view.tutorConversationController = controller;
  const opening = tutorConversationOpening(await returned('conversationOpening', { scene: 'You are in a store.',
    tutorRole: 'clerk', learnerRole: 'customer', opening: 'Try the *oat milk* today.\n**********',
    targetMarks: [{ field: 'opening', targetId: 'target', quote: '**', occurrence: 0 }] }), true, ['target']);
  expect(opening.targetMarks).toEqual([]);
  completeTutorConversationOpening(h.view, opening, controller, false); await flush();
  expect(h.view.tutorState.conversation.currentQuestion).toBe('Try the oat milk today.');
  expect(h.actions.readAloudText.mock.calls.map(call => call[0])).toEqual(['You are in a store.', 'Try the oat milk today.']);
  expect(h.panel()).toBe(panel);
  expect(panel.query('[data-tutor-transcript]')!.textContent).toContain('Try the oat milk today.');
});

it('cleans Demo lines at acceptance, including lines containing only separators', async () => {
  const lines = tutorConversationDemoBatch(await returned('conversationDemoBatch', { lines: [
    { speaker: 'male', text: 'Try the **oat milk** today.\n**********' }, { speaker: 'female', text: '===\n__Thank you.__' },
    { speaker: 'male', text: '**********' }, { speaker: 'female', text: 'It is well-known.' }
  ] }), 2);
  expect(lines).toEqual([{ speaker: 'male', text: 'Try the oat milk today.' }, { speaker: 'female', text: 'Thank you.' },
    { speaker: 'male', text: '' }, { speaker: 'female', text: 'It is well-known.' }]);
});

it.each(['light', 'dark'] as const)('keeps %s bridges transparent and shares every gear stroke declaration with the header', theme => {
  const tutor = createTutorViewState(); tutor.conversation.status = 'stopped';
  const page = load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [], activeScreen: 'tutor', tutor,
    settings: { ...PANEL_SETTINGS_FIXTURE, panelTheme: theme } }));
  const css = page('style').text();
  const bridge = css.match(/\.tutor-settings-bridge\s*\{([^}]+)\}/u)?.[1] ?? '';
  expect(bridge).toMatch(/background:\s*transparent/u);
  expect(bridge).toMatch(/border-color:\s*transparent/u);
  expect(bridge).not.toMatch(/(?:^|;)\s*(?:border|outline)(?:-width|-style)?:/u);
  expect(bridge).not.toMatch(/(?:height|font-size):/u);
  const shared = css.match(/\.icon-button svg,\s*\.tutor-settings-bridge svg\s*\{([^}]+)\}/u)?.[1] ?? '';
  for (const declaration of ['fill: none', 'stroke: currentColor', 'stroke-width: 2', 'stroke-linecap: round', 'stroke-linejoin: round']) {
    expect(shared).toContain(declaration);
  }
  const headerGear = page('.icon-button[data-command="showSettings"] svg').first().html();
  expect(headerGear).toBeTruthy();
  for (const row of ['[data-tutor-heading-actions]', '[data-tutor-stopped-actions]']) {
    const buttons = page(`${row} .tutor-settings-bridge`);
    expect(buttons).toHaveLength(2);
    buttons.each((_, button) => {
      expect(page(button).find('svg').html()).toBe(headerGear);
      expect(page(button).closest('details:not([open]), [hidden]')).toHaveLength(0);
      expect(page(button).attr('tabindex')).not.toBe('-1');
    });
  }
});
