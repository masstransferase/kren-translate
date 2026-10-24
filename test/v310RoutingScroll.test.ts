import { describe, expect, it, vi } from 'vitest';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

vi.mock('vscode', () => ({
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
  window: {}, commands: {}, env: {}, Uri: { joinPath: () => ({ toString: () => 'test' }) }
}));
import { KrenResultsViewProvider } from '../src/resultsView.js';

// 2026-10-24: V310. Pattern copied from V294: a mounted panel, scrollY set far below the Provider row.
// The host side is the real one. The configuration event that makes the host replace the
// document (extension.ts, onDidChangeConfiguration) is stood in for by render() inside the
// updateSetting stub, because that event is the only thing the stub leaves out.
const stored = [{ id: 'stored-model', displayName: 'Stored model' }, { id: 'other-model', displayName: 'Other model' }];
const settings = { ...PANEL_SETTINGS_FIXTURE, tutorPictureProvider: 'gemini' as const,
  credentialPresence: { geminiDefault: true, geminiAlternate: true, cloudflareAccountId: true, cloudflareApiToken: true, groq: true, openai: true, anthropic: true, googleCloudTranslation: true, googleCloudTextToSpeech: true },
  tutorModel: 'stored-model', tutorAlternateModel: 'stored-model', tutorLiveModel: 'stored-model', tutorImageModel: 'stored-model',
  tutorProvider: 'gemini', tutorProfile: 'standard', tutorLiveProfile: 'standard' } as typeof PANEL_SETTINGS_FIXTURE;
const scrolled = 731;

function session(shiftOnPatch: boolean) {
  const actions = { settings: () => settings, generateTutor: vi.fn(), log: vi.fn(),
    updateSetting: vi.fn(async () => { view.render(); }) };
  const view = new KrenResultsViewProvider(actions as never, {} as never);
  const internals = view as unknown as { activeScreen: string; liveModels: typeof stored; handleMessage(message: unknown): Promise<void> };
  internals.liveModels = stored;
  const sent: Record<string, unknown>[] = [];
  let patches = 0, replacements = 0;
  let panel: ReturnType<typeof mountedPanel>;
  const mount = (html: string, carried?: Record<string, unknown>) => {
    const mounted = mountedPanel(html, message => { sent.push(message); void internals.handleMessage(message); },
      { state: carried ?? {}, stateful: true, scrollable: true });
    for (const section of mounted.document.querySelectorAll('details')) section.open = true;
    if (shiftOnPatch) {
      // The browser has no layout here, so the move that replacing a block of rows can cause is injected.
      const block = mounted.document.querySelector('details[data-persist-id="tutor-setting"]')!;
      let owner = Object.getPrototypeOf(block);
      while (owner && !Object.getOwnPropertyDescriptor(owner, 'innerHTML')) owner = Object.getPrototypeOf(owner);
      const original = Object.getOwnPropertyDescriptor(owner, 'innerHTML')!;
      Object.defineProperty(block, 'innerHTML', { configurable: true, get() { return original.get!.call(this); },
        set(value: string) { original.set!.call(this, value); mounted.evaluate('window.scrollY = 619'); } });
    }
    return mounted;
  };
  view.view = { webview: { cspSource: 'test', asWebviewUri: () => ({ toString: () => '' }),
    postMessage: async (message: Record<string, unknown>) => {
      if (message.command === 'tutorVoiceModelReady') patches++;
      panel.message(message); return true;
    },
    get html() { return ''; },
    // A new document starts at the top and gets whatever state the old one stored.
    set html(value: string) { replacements++; panel = mount(value, panel?.state()); } } } as never;
  internals.activeScreen = 'tutor';
  view.render();
  const routing = () => panel.document.querySelectorAll('[data-llm-routing="tutor"] select');
  const keyOf = (select: ReturnType<typeof routing>[number]) =>
    select.getAttribute('data-model-preset') ?? select.getAttribute('data-setting') ?? '';
  return {
    actions, routing, keyOf, replaced: () => replacements,
    panel: () => panel,
    scrollY: () => panel.evaluate('window.scrollY') as number,
    // The reader scrolls, and then changes a control before the 120 ms scroll save has run.
    scrollTo(top: number) { panel.evaluate(`window.scrollY = ${top}`); },
    async change(key: string, value: string) {
      const select = routing().find(candidate => keyOf(candidate) === key)!;
      expect(select, `${key} must be in the tutor LLM ROUTING section`).toBeTruthy();
      const before = patches;
      select.value = value;
      panel.change(select);
      await vi.waitFor(() => expect(patches).toBeGreaterThan(before), { timeout: 20000, interval: 20 });
      expect(sent.filter(message => message.command === 'panelScriptError')).toEqual([]);
    },
    alternative(key: string) {
      const select = routing().find(candidate => keyOf(candidate) === key)!;
      return select.querySelectorAll('option').map(option => option.getAttribute('value') ?? '')
        .find(value => value !== select.value && value !== '__custom__');
    }
  };
}

const first = session(false);
const keys = first.routing().map(first.keyOf);

// Each change renders the whole tutor page twice, so the 5 s default is too short when this file is run alone.
describe('V310 tutor LLM ROUTING dropdowns leave the scroll position alone', { timeout: 120000 }, () => {
  it('lists the dropdowns the owner named, so the cases below are not an empty loop', () => {
    expect(keys).toEqual(expect.arrayContaining(['tutor.provider', 'tutor.geminiProfile', 'tutor.model',
      'tutor.thinkingOrEffort', 'tutor.hintModel', 'tutor.liveGeminiProfile', 'tutor.liveModel']));
  });

  for (const [name, shift] of [['the saved position', false], ['a block replacement that moves the page', true]] as const) {
    describe(name, () => {
      it.each(keys)('%s as the very first change after opening', async key => {
        const tutor = session(shift);
        const value = tutor.alternative(key);
        expect(value, `${key} needs a second choice for this test`).toBeDefined();
        tutor.scrollTo(scrolled);
        await tutor.change(key, value!);
        expect(tutor.actions.updateSetting).toHaveBeenCalledWith(key, value);
        expect(tutor.replaced()).toBeGreaterThan(1);
        expect(tutor.scrollY()).toBe(scrolled);
      });

      it('holds through a sequence, with Live Model first or last', async () => {
        const others = ['tutor.provider', 'tutor.geminiProfile', 'tutor.thinkingOrEffort', 'tutor.liveGeminiProfile'];
        for (const order of [['tutor.liveModel', ...others], [...others, 'tutor.liveModel']]) {
          const tutor = session(shift);
          for (const key of order) {
            const value = tutor.alternative(key);
            expect(value, `${key} needs a second choice for this test`).toBeDefined();
            tutor.scrollTo(scrolled);
            await tutor.change(key, value!);
            expect(tutor.scrollY(), `${key} after ${order.indexOf(key)} earlier changes`).toBe(scrolled);
          }
        }
      });
    });
  }
});
