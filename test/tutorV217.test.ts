// 2026-10-11: V218 uses the coaching card shape in the existing lifecycle fixture.
// 2026-10-10: V217 moves credentials and makes the closing card optional.
import { describe, expect, it, vi } from 'vitest';
import { load } from 'cheerio';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn() }, env: {},
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback }) },
  window: { showWarningMessage: vi.fn(async () => 'OK') } }));
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { renderKrenResultViewHtml, renderTutorConversation } from '../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { validatedPanelSetting } from '../src/panelSettings.js';
import { TUTOR_DEFAULTS } from '../src/tutor/defaults.js';
import type { TutorStructuredGenerationRequest } from '../src/tutor/generation.js';

const card = { doneWell: [], naturally: [], tryNext: 'Try a polite request.' };
function harness(enabled?: boolean, pending = false) {
  const settings = { ...PANEL_SETTINGS_FIXTURE, tutorConversationTakeHome: enabled,
    credentialPresence: { geminiDefault: true, geminiAlternate: true } };
  let finish!: (value: unknown) => void;
  const generateTutor = vi.fn(async (_request: TutorStructuredGenerationRequest): Promise<unknown> =>
    pending ? new Promise((resolve) => { finish = resolve; }) : card);
  const postMessage = vi.fn(async (_: unknown) => true);
  const actions = { settings: () => settings, generateTutor, writeTutorPreferences: vi.fn(),
    updateSetting: vi.fn(async (_key: string, value: unknown) => { settings.tutorConversationTakeHome = value as boolean; }),
    log: vi.fn(), notify: vi.fn(), stopReadAloud: vi.fn(), readAloudText: vi.fn(async () => undefined) };
  const view = new KrenResultsViewProvider(actions as never, {} as never);
  view.tutorState.conversation = { ...view.tutorState.conversation, from: 'anything', replies: 'standard',
    status: 'active', speakerOn: true, draftAnswer: 'Keep my draft.',
    transcript: [{ question: 'What do you like?', learnerAnswer: 'I like tea.', correction: '', explanation: '' }] };
  view.view = { webview: { html: '', cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }), postMessage } } as never;
  const message = (command: string, extra = {}) => (view as any).handleMessage({ command, ...extra });
  const toggle = (value: boolean) => message('updateSetting', { key: 'tutor.conversation.takeHome', value });
  return { view, actions, settings, generateTutor, postMessage, message, toggle, finish: (value: unknown) => finish(value) };
}
function panel(screen: 'settings' | 'credentials' | 'tutor' = 'credentials') {
  return load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [],
    activeScreen: screen, settings: PANEL_SETTINGS_FIXTURE }));
}

describe('V217 take-home switch', () => {
  it('red probe A: Stop with the switch off makes zero structured card requests, sections or speech', async () => {
    const h = harness(false);
    await h.message('stopTutorConversation');
    expect(h.generateTutor.mock.calls.filter(([request]) => request.kind === 'conversationTakeHome')).toHaveLength(0);
    expect(load(renderTutorConversation(h.view.tutorState))('.tutor-take-home')).toHaveLength(0);
    expect(h.actions.readAloudText).not.toHaveBeenCalled();
  });
  it('defaults on, validates booleans and stores the switch', async () => {
    expect(TUTOR_DEFAULTS.configuration['tutor.conversation.takeHome']).toBe(true);
    expect(validatedPanelSetting('tutor.conversation.takeHome', false)).toBe(false);
    expect(validatedPanelSetting('tutor.conversation.takeHome', 'false')).toBeUndefined();
    const h = harness();
    // Changed 2026-10-15: V241, owner item I6, request the optional card explicitly.
    await h.message('stopTutorConversation'); await h.message('reviewTutorConversation');
    await vi.waitFor(() => expect(h.view.tutorState.conversation.takeHome?.card).toBeDefined());
    expect(h.generateTutor.mock.calls.filter(([request]) => request.kind === 'conversationTakeHome')).toHaveLength(1);
    await h.toggle(false);
    expect(h.actions.updateSetting).toHaveBeenCalledWith('tutor.conversation.takeHome', false);
  });
  it('turning off cancels preparation, patches the section away, and drops a late result without rendering', async () => {
    const h = harness(true, true);
    // Changed 2026-10-15: V241, owner item I6, request the optional card explicitly.
    await h.message('stopTutorConversation'); await h.message('reviewTutorConversation');
    const controller = h.view.tutorTakeHomeController!;
    const render = vi.spyOn(h.view, 'render');
    await h.toggle(false);
    expect(controller.signal.aborted).toBe(true);
    expect(h.postMessage).toHaveBeenCalledWith({ command: 'tutorTakeHomeReady', html: '' });
    expect(render).not.toHaveBeenCalled();
    expect(h.view.tutorState.conversation.draftAnswer).toBe('Keep my draft.');
    h.finish(card);
    await Promise.resolve(); await Promise.resolve();
    expect(h.view.tutorState.conversation.takeHome).toBeUndefined();
    expect(h.actions.readAloudText).not.toHaveBeenCalled();
    await h.toggle(true);
    expect(h.generateTutor).toHaveBeenCalledTimes(1);
    expect(load(renderTutorConversation(h.view.tutorState))('.tutor-take-home')).toHaveLength(0);
  });
  it('a shown card survives turning off until Cancel, with no fresh speech or request', async () => {
    const h = harness(true);
    // Changed 2026-10-15: V241, owner item I6, request the optional card explicitly.
    await h.message('stopTutorConversation'); await h.message('reviewTutorConversation');
    await vi.waitFor(() => expect(h.view.tutorState.conversation.takeHome?.card).toBeDefined());
    const shown = h.view.tutorState.conversation.takeHome?.card;
    await h.toggle(false);
    expect(h.view.tutorState.conversation.takeHome?.card).toBe(shown);
    expect(load(renderTutorConversation(h.view.tutorState))('.tutor-take-home')).toHaveLength(1);
    await h.toggle(true);
    expect(h.generateTutor).toHaveBeenCalledTimes(1);
    await h.message('cancelTutorTakeHome');
    expect(load(renderTutorConversation(h.view.tutorState))('.tutor-take-home')).toHaveLength(0);
  });
  it('VS Code setting changes cancel preparation through the same in-place patch', async () => {
    const h = harness(true, true);
    // Changed 2026-10-15: V241, owner item I6, request the optional card explicitly.
    await h.message('stopTutorConversation'); await h.message('reviewTutorConversation');
    const controller = h.view.tutorTakeHomeController!;
    h.settings.tutorConversationTakeHome = false;
    const render = vi.spyOn(h.view, 'render');
    h.view.refreshTutorTakeHomeSetting();
    expect(controller.signal.aborted).toBe(true);
    expect(render).not.toHaveBeenCalled();
    expect(h.postMessage).toHaveBeenCalledWith({ command: 'tutorConversationTakeHomeSetting', value: false });
  });
  it('the labeled switch is the last ADVANCED row and its state reaches the summary', () => {
    const $ = panel('tutor');
    const advanced = $('[data-tutor-conversation-advanced]');
    const input = advanced.find('[data-setting="tutor.conversation.takeHome"]');
    expect(input.is(':checked')).toBe(true);
    expect(input.closest('label').find('.setting-title').text()).toBe('Take-home card');
    expect(advanced.find('[data-setting]').last().attr('data-setting')).toBe('tutor.conversation.takeHome');
    expect(advanced.children('summary').text()).toMatch(/Take-home card: On/u);
  });
  it('the runtime summary follows the stored toggle without replacing the answer box', () => {
    const source = readFileSync('src/resultViewHtml.ts', 'utf8');
    const sync = source.match(/    function syncTutorConversationAdvancedSummary\(\) \{([\s\S]*?)\n    \}/)![1];
    const summary = { textContent: '' };
    class Element {}
    class Select extends Element { selectedOptions = [{ textContent: 'Default' }]; }
    Object.setPrototypeOf(summary, Element.prototype);
    const control = { checked: false };
    // 2026-10-12: Execute the rendered JavaScript formatter, with TypeScript types removed by the build.
    const script = panel()('script').text();
    const begin = script.indexOf('function tutorConversationAdvancedSummary(values)');
    const summarize = script.slice(begin, script.indexOf('\n    }', begin) + 6);
    runInNewContext(`${summarize}; function syncTutorConversationAdvancedSummary() {${sync}}; syncTutorConversationAdvancedSummary();`, {
      HTMLElement: Element, HTMLSelectElement: Select,
      document: { querySelector: (selector: string) => selector.includes('> summary') ? summary : selector.includes('takeHome') ? control : new Select() }
    });
    expect(summary.textContent).toContain('Take-home card: Off');
  });
});

describe('V217 Credentials screen', () => {
  it('menu order and keyboard-reachable Credentials lead to a visible screen with ordinary back controls', async () => {
    const $ = panel();
    // Changed 2026-10-16: V249, F12a, check action order with updates last without pinning unrelated menu wording.
    expect($('#credentials-screen [data-menu-popover] button').map((_, n) => $(n).attr('data-command')).get())
      .toEqual(['showStartPage', 'showTutor', 'showUserDictionary', 'showManual', 'showCredentials', 'showSettings', 'checkForUpdates']);
    expect($('#credentials-screen [data-menu-popover] button').last().text()).toMatch(/check for updates/iu);
    const item = $('#credentials-screen [data-command="showCredentials"]');
    expect(item.is('button[role="menuitem"]:not([disabled])')).toBe(true);
    expect($('#credentials-screen').hasClass('hidden')).toBe(false);
    expect($('#result-screen').hasClass('hidden')).toBe(true);
    expect($('#credentials-screen h2').text()).toBe('KREN Credentials');
    expect($('#credentials-screen > header .top-actions > [data-command="showStartPage"]')).toHaveLength(1);
    expect($('#credentials-screen > details')).toHaveLength(0);
    const h = harness();
    await h.message('showCredentials');
    expect((h.view as any).activeScreen).toBe('credentials');
    expect(load(h.view.view!.webview.html)('#credentials-screen').hasClass('hidden')).toBe(false);
    await h.message('showStartPage');
    expect((h.view as any).activeScreen).toBe('start');
  });
  it('red probe B: every key row and Delete all move out of Settings; Usage holds the usage and switching controls', () => {
    const $ = panel('settings');
    expect($('#settings-screen .credential-row')).toHaveLength(0);
    expect($('#settings-screen [data-action="kren.deleteAllApiKeys"]')).toHaveLength(0);
    const screen = $('#credentials-screen');
    expect(screen.find('.credential-label').map((_, n) => $(n).contents().first().text().trim()).get())
      // 2026-10-11: V219 adds Groq alongside the existing credential rows.
      // 2026-10-11: V222 adds the separate Text-to-Speech credential on this same screen.
      .toEqual(['Cloudflare account ID', 'Cloudflare API token', 'Gemini Free Tier', 'Gemini Paid', 'Google Cloud Text-to-Speech', 'Google Cloud Translation', 'OpenAI', 'Groq', 'Anthropic', 'Merriam-Webster Collegiate', 'Merriam-Webster Thesaurus', 'Merriam-Webster Medical', 'Korean Dictionary']);
    expect(screen.find('[data-action="kren.deleteAllApiKeys"]')).toHaveLength(1);
    expect(screen.find('[data-action="kren.showGoogleCloudTranslationUsage"]')).toHaveLength(1);
    for (const action of ['kren.testOpenAIConnection', 'kren.testAnthropicConnection', 'kren.testKoreanDictionary']) expect(screen.find(`[data-action="${action}"]`)).toHaveLength(1);
    // Changed 2026-10-17: V261, F5 owner canvas edit: Secret Storage encrypts keys for this profile.
    expect(screen.find('.settings-intro').text()).toMatch(/Secret Storage encrypts keys/u);
    expect(screen.find('.model-note').text()).toMatch(/Google AI Studio/u);
    const usage = $('#settings-screen [data-settings-section="usage"]');
    expect(usage.find('summary h3').text()).toBe('Usage');
    expect(usage.find('[data-setting], [data-action]').map((_, n) => $(n).attr('data-setting') ?? $(n).attr('data-action')).get())
      // Changed 2026-10-22 (V299, owner I69): Usage gains eight global routing controls and Apply to All; credentials remain separate.
      .toEqual(['llm.providerSwitch', 'display.mode', 'request.timeoutMs', 'global.provider', 'global.geminiProfile',
        'global.model', 'global.alternateModel', 'global.thinkingOrEffort', 'global.fallbackEnabled',
        'global.fallbackModel', 'global.fallbackThinkingOrEffort', 'kren.applyGlobalRouting',
        'kren.restoreDefaultSettings', 'kren.resetKren']);
    expect(usage.attr('data-persist-id')).toBe('settings-usage');
  });
  it('manual and guide name the new routes and the Take-home card switch', () => {
    const $ = panel();
    expect($('#manual-screen').text()).not.toMatch(/Credentials and Usage/iu);
    expect($('#manual-screen').text()).toMatch(/KREN menu, Credentials/u);
    expect($('#manual-screen').text()).toMatch(/CONVERSATION, ADVANCED, Take-home card/u);
    const guide = readFileSync('docs/USER_GUIDE.md', 'utf8');
    expect(guide).not.toMatch(/Credentials and Usage/iu);
    expect(guide).toMatch(/\*\*Settings\*\*, \*\*Usage\*\*/u);
    expect(guide).toMatch(/\*\*CONVERSATION\*\*, \*\*ADVANCED\*\*, \*\*Take-home card\*\*/u);
  });
});
