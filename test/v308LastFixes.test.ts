import { afterEach, describe, expect, it, vi } from 'vitest';
import { load } from 'cheerio';
import { renderKrenResultViewHtml, type KrenPanelSettings } from '../src/resultViewHtml.js';
import { createTutorViewState } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({
  get: (_key: string, fallback: unknown) => fallback, inspect: () => undefined
}) }, window: {}, commands: { executeCommand: vi.fn() }, env: {},
Uri: { joinPath: () => ({ toString: () => 'test' }) } }));
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { guardTutorLiveStart } from '../src/resultsViewConversation.js';
import { completeStandardTutorTurn } from '../src/resultsViewTurns.js';
import { priorityWebviewCommand } from '../src/webviewMessagePriority.js';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const views: KrenResultsViewProvider[] = [];
afterEach(() => { views.splice(0).forEach(view => view.dispose()); vi.useRealTimers(); vi.restoreAllMocks(); });

function html(provider: KrenPanelSettings['tutorProvider'], replies: 'standard' | 'liveGemini' = 'standard') {
  const tutor = createTutorViewState();
  Object.assign(tutor.conversation, { status: 'active', currentQuestion: 'How can I help?', replies,
    situationPicture: 'none', speakerOn: false });
  tutor.speech.handyStatus = 'available';
  return renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'tutor', tutor,
    tutorSpeechProvider: 'handy', settings: { ...PANEL_SETTINGS_FIXTURE, tutorProvider: provider }, proModels: [] });
}

describe('I77 Live start choices', () => {
  for (const profile of ['standard', 'pro'] as const) for (const otherStored of [false, true]) {
    it(`${profile}, other key ${otherStored}: offers only routes and cancellation saves nothing`, async () => {
      const updateSetting = vi.fn();
      const persistTutorPreferences = vi.fn();
      const start = vi.fn();
      const showInformationMessage = vi.fn(async () => undefined);
      const view = { actions: { settings: () => ({ tutorLiveProfile: profile, credentialPresence: {
        geminiDefault: profile === 'pro' && otherStored, geminiAlternate: profile === 'standard' && otherStored
      } }), updateSetting }, tutorState: { conversation: { replies: 'liveGemini' } },
      persistTutorPreferences, showInformationMessage } as unknown as KrenResultsViewProvider;
      expect(guardTutorLiveStart(view, start)).toBe(false);
      const otherLabel = profile === 'pro' ? 'Free Tier' : 'Paid';
      expect(showInformationMessage.mock.calls[0]?.slice(1)).toEqual([
        { modal: true }, ...(otherStored ? [`Use Gemini ${otherLabel}`] : []), 'Switch to Standard'
      ]);
      await flush();
      expect(start).not.toHaveBeenCalled();
      expect(updateSetting).not.toHaveBeenCalled();
      expect(persistTutorPreferences).not.toHaveBeenCalled();
      expect(view.tutorState.conversation.replies).toBe('liveGemini');
    });
  }
});

describe('I78 tutor text profile visibility', () => {
  for (const replies of ['standard', 'liveGemini'] as const) {
    it.each(['gemini', 'groq', 'openai', 'anthropic', 'cloudflare'] as const)(`${replies}: initial %s summary follows Provider`, provider => {
      const $ = load(html(provider, replies));
      const summary = $('[data-llm-routing="tutor"] > summary').text();
      expect(summary.includes('Gemini Profile:')).toBe(provider === 'gemini');
    });
    it(`${replies}: mounted Provider changes hide only text profile without replacing the composer`, () => {
      const messages: Record<string, unknown>[] = [];
      const panel = mountedPanel(html('gemini', replies), message => messages.push(message));
      const provider = panel.query('[data-setting="tutor.provider"]')!;
      const profile = panel.query('[data-setting="tutor.geminiProfile"]')!;
      const group = profile.closest('[data-provider-for]')!;
      const composer = panel.query('[data-tutor-composer]');
      const summary = panel.query('[data-llm-routing="tutor"] > summary')!;
      for (const value of ['groq', 'openai', 'anthropic', 'cloudflare', 'gemini']) {
        provider.value = value; panel.change(provider);
        expect(group.classList.contains('hidden')).toBe(value !== 'gemini');
        expect(summary.textContent.includes('Gemini Profile:')).toBe(value === 'gemini');
        expect(panel.query('[data-tutor-composer]')).toBe(composer);
        for (const selector of ['[data-setting="tutor.liveGeminiProfile"]', '[data-model-preset="tutor.liveModel"]']) {
          const live = panel.query(selector)!;
          expect(live).not.toBeNull();
          expect(live.closest('.hidden, [hidden], [data-provider-for]')).toBeNull();
          expect(live.getAttribute('tabindex')).not.toBe('-1');
        }
        expect(messages).toContainEqual(expect.objectContaining({ command: 'updateSetting', key: 'tutor.provider', value }));
      }
      profile.value = 'pro'; panel.change(profile);
      expect(summary.textContent).toContain('Gemini Profile: Paid');
    });
  }
});

it('I79 Handy capture stays invisible and focusable through paste, auto-send, and learner bubble', async () => {
  vi.useFakeTimers();
  let panel!: ReturnType<typeof mountedPanel>;
  const messages: Record<string, unknown>[] = [];
  const actions = { settings: () => ({ ...PANEL_SETTINGS_FIXTURE, tutorSpeechProvider: 'handy' }),
    notify: vi.fn(), log: vi.fn(), stopReadAloud: vi.fn(), writeTutorPreferences: vi.fn(),
    generateTutor: vi.fn(() => new Promise(() => {})) };
  const view = new KrenResultsViewProvider(actions as never, {} as never,
    { detect: vi.fn(async () => undefined), toggle: vi.fn(async () => {}) } as never);
  views.push(view);
  const host = view as unknown as { activeScreen: string; handleMessage(message: unknown): Promise<void>;
    handlePriorityMessage(command: string, message: unknown): void };
  host.activeScreen = 'tutor';
  Object.assign(view.tutorState.conversation, { status: 'active', currentQuestion: 'How can I help?',
    replies: 'standard', send: 'stopSpeaking', situationPicture: 'none', speakerOn: false });
  view.tutorState.speech.handyStatus = 'available';
  view.view = { webview: { cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }),
    set html(value: string) { panel = mountedPanel(value, message => {
      messages.push(message);
      const priority = priorityWebviewCommand(message);
      if (priority) host.handlePriorityMessage(priority, message);
      else void host.handleMessage(message);
    }); }, postMessage: vi.fn(async (message: Record<string, unknown>) => { panel.message(message); return true; })
  } } as never;
  view.render();
  const microphone = panel.query('[data-tutor-chat-mic-control]')!;
  expect(microphone.closest('details, .hidden, [hidden]')).toBeNull();
  expect(microphone.disabled).toBe(false);
  panel.click(microphone); await flush();
  const capture = panel.query('[data-tutor-handy-capture]')!;
  const assertInvisible = () => {
    // Match shipped style selectors against the actual sink, because the old class-only assertion missed the defect.
    const $ = load(panel.document.documentElement.outerHTML);
    const sink = $('[data-tutor-handy-capture]');
    const declarations: Record<string, string> = {};
    for (const rule of $('style').text().matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      try {
        if (!sink.is(rule[1]!.trim())) continue;
      } catch { continue; }
      for (const declaration of rule[2]!.split(';')) {
        const [name, ...value] = declaration.split(':');
        if (name && value.length) declarations[name.trim()] = value.join(':').trim();
      }
    }
    expect(declarations.position).toBe('absolute');
    expect(declarations.left).toBe('-10000px');
    expect(declarations.opacity).toBe('0');
    expect(declarations['pointer-events']).toBe('none');
    expect(declarations.display).not.toBe('none');
    expect(declarations.visibility).not.toBe('hidden');
    expect(capture.closest('[hidden], .hidden')).toBeNull();
    expect(capture.getAttribute('contenteditable')).toBe('true');
    expect(capture.getAttribute('aria-hidden')).toBe('true');
    expect(capture.getAttribute('tabindex')).toBe('-1');
    expect(panel.document.activeElement).toBe(capture);
  };
  assertInvisible();
  panel.message({ command: 'tutorDictationState', conversation: true, provider: 'handy', state: 'recording' });
  panel.click(microphone); await flush();
  capture.textContent = 'I would like some milk.';
  panel.input(capture, 'insertFromPaste');
  assertInvisible();
  await vi.advanceTimersByTimeAsync(800); await flush();
  expect(messages).toContainEqual({ command: 'updateTutorConversationAnswer', answer: 'I would like some milk.', spoken: true });
  expect(messages.filter(message => message.command === 'submitTutorConversationTurn')).toHaveLength(1);
  expect(view.tutorState.conversation.pendingAnswer).toBe('I would like some milk.');
  expect(panel.query('[data-tutor-handy-capture]')).toBeNull();
  expect(panel.query('[data-tutor-conversation-answer], [data-command="submitTutorConversationTurn"]')).toBeNull();
  completeStandardTutorTurn(view, { move: 'reaction', reply: 'The milk is by the bread.', correction: '', explanation: '' },
    'How can I help?', 'I would like some milk.', true);
  await flush();
  expect(panel.query('[data-tutor-learner-answer]')!.textContent).toContain('I would like some milk.');
  expect(panel.query('[data-tutor-handy-capture]')).toBeNull();
});
