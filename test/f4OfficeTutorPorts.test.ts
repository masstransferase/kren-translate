import { afterEach, describe, expect, it, vi } from 'vitest';
import { load } from 'cheerio';
import { parse as parseCss } from 'postcss';
vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn() }, env: {},
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback }) },
  window: { showWarningMessage: vi.fn(async () => 'Proceed') } }));
import { TUTOR_MAP, type TutorLesson } from '@kren/core/tutor';
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { generateSituationPicture, SITUATION_PICTURE_GEMINI_LIMIT_MS } from '../src/providers/situationPicture.js';
import { createTutorViewState, tutorRecipeFromState } from '../src/tutor/state.js';
import type { TutorStructuredGenerationRequest } from '../src/tutor/generation.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

/*
 * VS4TUTOR (family F4 of the 2.0.2 plan, 2026-11-04): four tutor defects found by the sibling host that VS Code 2.0.1 may share.
 * V14 TAKE-HOME Cancel while preparing, V16 the Gemini picture time limit, V23 the Practice button spacing.
 * Each test below was run against the unfixed source first and failed there; the report names the failures.
 */

const card = { naturally: [], doneWell: [], tryNext: 'Ask a follow-up question.' };
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

function harness(settingsOverride: Record<string, unknown> = {}) {
  const settings = { ...PANEL_SETTINGS_FIXTURE, tutorConversationTakeHome: true, ...settingsOverride };
  const generateTutor = vi.fn(async (request: TutorStructuredGenerationRequest): Promise<unknown> => {
    if (request.kind === 'conversationTakeHome') return card;
    throw new Error(`Unexpected request ${request.kind}`);
  });
  const actions = { settings: () => settings, generateTutor, log: vi.fn(), notify: vi.fn(),
    writeTutorPreferences: vi.fn(), stopReadAloud: vi.fn(), readAloudText: vi.fn(async () => {}) };
  const view = new KrenResultsViewProvider(actions as never, {} as never);
  let panel!: ReturnType<typeof mountedPanel>;
  const internals = view as any;
  internals.activeScreen = 'tutor';
  const message = async (command: string) => { await internals.handleMessage({ command }); await flush(); };
  const postMessage = vi.fn(async (value: Record<string, unknown>) => { panel?.message(value); return true; });
  view.view = { visible: true, webview: { cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }),
    set html(value: string) { panel = mountedPanel(value, value => { void internals.handleMessage(value); }); }, postMessage } } as never;
  return { view, internals, message, generateTutor, panel: () => panel };
}

describe('V14 TAKE-HOME Cancel while the card is being prepared', () => {
  function stoppedWithPendingCard(count = 5) {
    const h = harness();
    Object.assign(h.view.tutorState.conversation, { status: 'active', from: 'anything', replies: 'standard', speakerOn: false,
      currentQuestion: 'Anything else?', transcript: Array.from({ length: count }, () => ({ question: 'What do you like?',
        learnerAnswer: 'I like tea.', correction: '', explanation: '' })) });
    return h;
  }

  it('shows the canceled sentence with Retry and Cancel, reachable, and Retry makes the card', async () => {
    const h = stoppedWithPendingCard();
    await h.message('stopTutorConversation');
    h.generateTutor.mockImplementationOnce(() => new Promise(() => {}));
    await h.message('reviewTutorConversation');
    expect(h.panel().query('.tutor-take-home')?.textContent).toContain('Preparing your take-home card.');
    await h.message('cancelTutorTakeHome');
    const section = h.panel().query('.tutor-take-home');
    // The reader needs the sentence on the page, not only in the stored state.
    expect(section, 'the section is still drawn after Cancel').toBeTruthy();
    expect(section!.textContent).toContain('The take-home card was canceled. Try again.');
    expect(section!.textContent).not.toContain('Preparing your take-home card.');
    const retry = h.panel().query('[data-command="retryTutorTakeHome"]')!;
    expect(retry.tagName).toBe('BUTTON');
    expect(retry.disabled).toBe(false);
    expect(retry.closest('details')).toBeNull();
    expect(h.panel().query('[data-command="cancelTutorTakeHome"]')).toBeTruthy();
    await h.message('retryTutorTakeHome');
    expect(h.view.tutorState.conversation.takeHome?.card).toEqual(card);
    expect(h.panel().query('.tutor-take-home')?.textContent).toContain(card.tryNext);
  }, 30_000);

  it('a second Cancel dismisses the sentence, and Cancel on a finished card still hides it', async () => {
    const h = stoppedWithPendingCard();
    await h.message('stopTutorConversation');
    h.generateTutor.mockImplementationOnce(() => new Promise(() => {}));
    await h.message('reviewTutorConversation');
    await h.message('cancelTutorTakeHome');
    expect(h.panel().query('.tutor-take-home')).toBeTruthy();
    await h.message('cancelTutorTakeHome');
    expect(h.panel().query('.tutor-take-home')).toBeFalsy();

    const finished = stoppedWithPendingCard();
    await finished.message('stopTutorConversation');
    await finished.message('reviewTutorConversation');
    expect(finished.panel().query('.tutor-take-home')?.textContent).toContain(card.tryNext);
    await finished.message('cancelTutorTakeHome');
    expect(finished.panel().query('.tutor-take-home')).toBeFalsy();
  }, 30_000);
});

describe('V16 Gemini situation picture time limit', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  function hangingFetch() {
    const seen: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
      seen.push(init.signal!);
      const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
      if (init.signal!.aborted) abort(); else init.signal!.addEventListener('abort', abort);
    })));
    return seen;
  }

  it('is the 120,000 ms Office uses', () => {
    expect(SITUATION_PICTURE_GEMINI_LIMIT_MS).toBe(120_000);
  });

  it('ends a hung request at the limit through the existing failure path, while the caller has not canceled', async () => {
    vi.useFakeTimers();
    const seen = hangingFetch();
    const caller = new AbortController();
    const outcome = generateSituationPicture('a room', 'test-key', caller.signal).then(() => undefined, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(SITUATION_PICTURE_GEMINI_LIMIT_MS - 1);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen[0]!.aborted).toBe(true);
    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('timed out');
    expect(caller.signal.aborted).toBe(false);
  });

  it('still stops at once when the caller cancels, with the abort error and no timer left behind', async () => {
    vi.useFakeTimers();
    const seen = hangingFetch();
    const caller = new AbortController();
    const outcome = generateSituationPicture('a room', 'test-key', caller.signal).then(() => undefined, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);
    caller.abort();
    expect(seen[0]!.aborted).toBe(true);
    const error = await outcome;
    expect((error as Error).name).toBe('AbortError');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer when the provider answers, and refuses to start when already canceled', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    const error = await generateSituationPicture('a room', 'test-key', new AbortController().signal).catch((value: Error) => value);
    expect((error as Error).message).toContain('(500)');
    expect(vi.getTimerCount()).toBe(0);
    const seen = hangingFetch();
    const canceled = new AbortController();
    canceled.abort();
    const outcome = await generateSituationPicture('a room', 'test-key', canceled.signal).catch((value: Error) => value);
    expect(seen[0]!.aborted).toBe(true);
    expect((outcome as Error).name).toBe('AbortError');
  });
});

describe('V23 10 px under Practice now and Practice again', () => {
  const leaf = TUTOR_MAP.find((node) => !TUTOR_MAP.some((candidate) => candidate.parentId === node.id))!;
  function lesson(): TutorLesson {
    return {
      schemaVersion: 1, mapVersion: '1.0.0', lessonTitle: 'Reference', level: 'B2',
      primaryTarget: { nodeId: leaf.id, label: leaf.label, kind: leaf.kind, role: 'primary', description: leaf.description },
      supportingTargets: [], conceptExplanation: 'Concept.', patternStatement: 'Pattern.', interactionExplanation: 'Interaction.',
      rules: [{ statement: 'Rule.', status: 'rule' }],
      examples: [{ id: 'example-1', sentence: 'This initiative was approved.', targetIds: [leaf.id],
        annotations: [{ targetId: leaf.id, excerpt: 'This initiative', explanation: 'Refers back.' }] }],
      commonErrors: [{ id: 'error-1', incorrect: 'It initiative.', corrected: 'This initiative.', explanation: 'Needs a noun.', status: 'rule' }],
      practice: [], answerKey: [], generationNotes: []
    };
  }
  const render = (withPractice: boolean) => {
    const state = createTutorViewState();
    state.selection = [{ nodeId: leaf.id, role: 'primary' }];
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(), findings: [] };
    if (withPractice) {
      state.exerciseSet = { schemaVersion: 1, mapVersion: '1.0.0', channel: 'written',
        exercises: [{ id: 'practice-1', channel: 'written', prompt: 'Refer back.', targetIds: [leaf.id] }] };
    }
    return renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
      activeScreen: 'tutor', tutor: state, proModels: [] });
  };
  /** Every bottom margin the stylesheet gives the element, in source order; the last one wins. */
  function bottomMarginsOf(rules: Array<{ selectors: string[]; prop: string; value: string }>, element: ReturnType<ReturnType<typeof load>>): string[] {
    return rules.filter(rule => rule.selectors.some(selector => element.is(selector))).map(rule => {
      const parts = rule.value.split(/\s+/u);
      return rule.prop === 'margin-bottom' ? parts[0]! : (parts[2] ?? parts[0]!);
    });
  }

  it.each([[false, 'Practice now'], [true, 'Practice again']] as const)('the %s button, %s, ends with a 10 px margin and no other button gains one', (withPractice, label) => {
    const markup = render(withPractice);
    const $ = load(markup);
    const rules: Array<{ selectors: string[]; prop: string; value: string }> = [];
    parseCss($('style').text()).walkRules(rule => {
      rule.walkDecls(/^(?:margin|margin-bottom)$/u, declaration => {
        rules.push({ selectors: rule.selectors, prop: declaration.prop, value: declaration.value });
      });
    });
    const button = $('[data-command="generateTutorExercises"]');
    expect(button).toHaveLength(1);
    expect(button.text()).toBe(label);
    // Reachable: a real button outside any closed section.
    expect(button.is('button')).toBe(true);
    expect(button.closest('details:not([open])')).toHaveLength(0);
    expect(bottomMarginsOf(rules, button).at(-1)).toBe('10px');
    // Scoped to this button: the other buttons the page draws do not gain the 10 px through this change.
    const others = $('button').not('[data-command="generateTutorExercises"]').toArray();
    expect(others.length).toBeGreaterThan(0);
    for (const other of others) {
      expect(bottomMarginsOf(rules, $(other)).at(-1) ?? '0', $.html(other).slice(0, 120)).not.toBe('10px');
    }
  }, 30_000);
});
