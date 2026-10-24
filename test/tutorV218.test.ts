// 2026-10-11: V218 photographic prompts and short teaching cards, including in-place controls.
import { describe, expect, it, vi } from 'vitest';
vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn() }, env: {},
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback }) },
  window: { showWarningMessage: vi.fn(async () => 'OK') } }));
import { load } from 'cheerio';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { buildCloudflarePictureRequest, buildSituationPictureRequest, generateCloudflareSituationPicture,
  generateSituationPicture, SITUATION_PICTURE_STYLE, SITUATION_PICTURE_ILLUSTRATED_STYLE } from '../src/providers/situationPicture.js';
import { PANEL_SETTING_KEYS, validatedPanelSetting } from '../src/panelSettings.js';
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { postTutorPictureStyleSetting, updateTutorSetting } from '../src/resultsViewSettings.js';
import { renderKrenResultViewHtml, renderTutorConversation, renderTutorTakeHome } from '../src/resultViewHtml.js';
import { createTutorViewState } from '../src/tutor/state.js';
import { tutorConversationTakeHome, tutorConversationTakeHomeRequest, tutorTakeHomeSpeech,
  type TutorTakeHome, type TutorTakeHomeInput } from '../src/tutor/takeHome.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const input: TutorTakeHomeInput = { source: 'anything', demo: false, register: 'neutral', demoLines: [], turns: [
  { turnIndex: 0, question: 'When?', learnerAnswer: 'I want that we meet tomorrow.', reply: 'At nine?' },
  { turnIndex: 1, question: 'Anything else?', learnerAnswer: 'Could you tell me the price?', reply: 'Ten dollars.' }
] };
const card: TutorTakeHome = {
  // 2026-10-14: The native version is now the first better way in a single list.
  naturally: [{ turnIndex: 0, quote: input.turns[0]!.learnerAnswer,
    alternatives: ['Can we meet tomorrow?', 'How about meeting tomorrow?', 'Are you free tomorrow?'], why: 'For a suggestion, ask directly instead of using want + that.' }],
  pattern: { name: 'How about + -ing?', examples: ['How about trying the new café?', 'How about starting at nine?'] },
  doneWell: [{ turnIndex: 1, quote: input.turns[1]!.learnerAnswer, note: 'Polite and complete.' }],
  tryNext: 'Open your first reply with How about.'
};
const source = readFileSync('src/resultViewHtml.ts', 'utf8');

describe('V218 picture styles', () => {
  it('realistic Cloudflare prompt uses positive photographic language without art or JSON noise', () => {
    const { prompt } = buildCloudflarePictureRequest('Two colleagues in a café.');
    expect(prompt).toBe(SITUATION_PICTURE_STYLE + '\nScene: Two colleagues in a café.');
    expect(prompt).not.toMatch(/cartoon|anime|illustration|painting|\{/iu);
    expect(prompt).not.toContain('No text');
  });
  it('illustrated Cloudflare prompt uses the chosen sentence and labeled newest dialogue', () => {
    const { prompt } = buildCloudflarePictureRequest('A café.', { picture: 'LOCAL_PICTURE', turns: [
      { speaker: 'learner', text: 'Two teas, please.' }, { speaker: 'tutor', text: 'Of course.' }
    ] }, 'illustrated');
    expect(prompt).toBe(SITUATION_PICTURE_ILLUSTRATED_STYLE + '\nScene: A café.\nLatest moment:\nLearner: Two teas, please.\nTutor: Of course.');
    expect(prompt).not.toContain('LOCAL_PICTURE');
    expect(prompt).not.toContain('No text');
  });
  it.each(['realistic', 'illustrated'] as const)('Gemini uses %s and keeps its reference picture', (style) => {
    const request = buildSituationPictureRequest('A café.', { picture: 'data:image/png;base64,YWJj',
      turns: [{ speaker: 'learner', text: 'Tea.' }] }, style);
    const parts = request.contents[0]!.parts;
    expect((parts[0] as { text: string }).text).toContain(
      (style === 'realistic' ? SITUATION_PICTURE_STYLE : SITUATION_PICTURE_ILLUSTRATED_STYLE) + ' No text, lettering or captions.');
    expect(parts[2]).toEqual({ inlineData: { mimeType: 'image/png', data: 'YWJj' } });
  });
  it.each(['gemini', 'cloudflare'] as const)('%s generation passes the selected style to the actual request', async (provider) => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, headers: new Headers(), json: async () =>
      provider === 'cloudflare' ? { success: true, result: { image: 'YWJj' } }
        : { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'YWJj' } }] } }] } }));
    vi.stubGlobal('fetch', fetcher);
    try {
      if (provider === 'gemini') await generateSituationPicture('A café.', 'credential', new AbortController().signal, undefined, undefined, 'illustrated');
      else await generateCloudflareSituationPicture('A café.', 'account', 'credential', new AbortController().signal, undefined, undefined, 'illustrated');
      // Changed 2026-10-22 (V294, owner I60/I64): the default Cloudflare model sends its style in multipart prompt.
      const sent = ((fetcher.mock.calls as unknown[][])[0]![1] as RequestInit).body;
      const body = sent instanceof FormData ? String(sent.get('prompt')) : String(sent);
      expect(body).toContain(SITUATION_PICTURE_ILLUSTRATED_STYLE);
      expect(body).not.toContain(SITUATION_PICTURE_STYLE);
    } finally { vi.unstubAllGlobals(); }
  });
  it('allowlists and validates the style setting', () => {
    expect(PANEL_SETTING_KEYS.has('tutor.conversation.pictureStyle')).toBe(true);
    for (const style of ['realistic', 'illustrated']) expect(validatedPanelSetting('tutor.conversation.pictureStyle', style)).toBe(style);
    for (const invalid of ['cartoon', '', true, 1]) expect(validatedPanelSetting('tutor.conversation.pictureStyle', invalid)).toBeUndefined();
  });
  it.each(['none', 'intro'] as const)('puts the keyboard select immediately after Situation picture in ADVANCED under %s', (mode) => {
    const state = createTutorViewState(); state.conversation.situationPicture = mode;
    const $ = load(renderTutorConversation(state));
    // Changed 2026-10-24 (V309, owner I80): Situation picture moved to MODE; Picture style stays in ADVANCED after Reply length.
    const picture = $('[data-tutor-conversation-situation-picture]');
    expect(picture.closest('details').is('[data-persist-id="tutor-conversation-mode"]')).toBe(true);
    const style = $('[data-tutor-conversation-reply-length]').closest('label').next().find('select');
    expect(style.attr('data-setting')).toBe('tutor.conversation.pictureStyle');
    expect(style.closest('label').text()).toContain('Picture style');
    expect(style.closest('label').text()).toContain('How situation pictures look.');
    expect(style.find('option').map((_, element) => $(element).text()).get()).toEqual(['Realistic', 'Illustrated']);
    expect(style.find('option[selected]').val()).toBe('realistic');
    expect(style.is('[disabled]')).toBe(mode === 'none');
    expect(style.attr('tabindex')).toBeUndefined();
    expect(style.closest('details').children('summary').text()).toContain('ADVANCED');
  });
  it('stores a mid-conversation change without rendering or replacing the answer box', async () => {
    const settings = { ...PANEL_SETTINGS_FIXTURE, tutorConversationPictureStyle: 'realistic' as 'realistic' | 'illustrated' };
    const updateSetting = vi.fn(async (_key: string, value: unknown) => { settings.tutorConversationPictureStyle = value as 'illustrated'; });
    const view = new KrenResultsViewProvider({ settings: () => settings, updateSetting } as never, {} as never);
    view.tutorState.conversation.status = 'active'; view.tutorState.conversation.draftAnswer = 'Keep my draft';
    const postMessage = vi.fn(async () => true);
    view.view = { webview: { postMessage } } as never;
    const render = vi.spyOn(view, 'render');
    await updateTutorSetting(view, 'tutor.conversation.pictureStyle', 'illustrated');
    expect(updateSetting).toHaveBeenCalledWith('tutor.conversation.pictureStyle', 'illustrated');
    expect(postMessage).toHaveBeenCalledWith({ command: 'tutorConversationPictureStyleSetting', value: 'illustrated' });
    expect(render).not.toHaveBeenCalled();
    expect(view.tutorState.conversation.draftAnswer).toBe('Keep my draft');
    view.dispose();
  });
  it('reads the current configuration for each new picture in the extension action', async () => {
    const extension = readFileSync('src/extension.ts', 'utf8');
    const action = extension.split('generateSituationPicture: async ')[1]!.split('\n    transcribeTutorAudio:')[0]!.trim().replace(/,$/u, '');
    const settings = { tutorPictureProvider: 'cloudflare', tutorConversationPictureStyle: 'realistic', tutorCloudflareImageModel: 'model' };
    const generate = vi.fn(async () => 'image');
    const callback = runInNewContext(`async ${action}`, { context: {}, readPanelSettings: () => settings,
      extensionRuntime: () => ({ getSecret: async () => 'credential' }), KREN_SECRET_KEYS: {},
      generateCloudflareSituationPicture: generate }) as (...args: unknown[]) => Promise<string>;
    await callback('Scene', new AbortController().signal);
    settings.tutorConversationPictureStyle = 'illustrated';
    await callback('Next scene', new AbortController().signal);
    expect((generate.mock.calls as unknown[][]).map((args) => args[6])).toEqual(['realistic', 'illustrated']);
  });
  it('patches a saved style through the configuration event without refreshing the panel', () => {
    const extension = readFileSync('src/extension.ts', 'utf8');
    const body = extension.split('vscode.workspace.onDidChangeConfiguration((event) => {')[1]!.split('\n    }),')[0]!;
    const postMessage = vi.fn(), refresh = vi.fn();
    runInNewContext(`(function(event) {${body}})(event)`, {
      event: { affectsConfiguration: (key: string) => ['kren', 'kren.tutor.conversation.pictureStyle'].includes(key) },
      resultsView: { view: { webview: { postMessage } }, refresh,
        actions: { settings: () => ({ tutorConversationPictureStyle: 'illustrated' }) } },
      postTutorPictureStyleSetting
    });
    expect(postMessage).toHaveBeenCalledWith({ command: 'tutorConversationPictureStyleSetting', value: 'illustrated' });
    expect(refresh).not.toHaveBeenCalled();
  });
  it('patches the style and disables it in place when Situation picture becomes None', () => {
    // 2026-10-12: Picture style now carries and clears its disabled reason in place.
    class Select { value = 'intro'; disabled = false; attributes = new Map<string, string>();
      setAttribute(name: string, value: string) { this.attributes.set(name, value); }
      removeAttribute(name: string) { this.attributes.delete(name); }
    }
    const style = new Select(), mode = new Select(); style.value = 'realistic';
    const sync = source.match(/    function syncTutorConversationPictureSettings\(\) \{([\s\S]*?)\n    \}/u)![1];
    const patch = source.split("if (message.command === 'tutorConversationPictureStyleSetting') {")[1]!.split("if (message.command === 'languageModelUsage')")[0]!; // 2026-10-11: isolate the style patch before the new usage handler.
    const document = { querySelector: (selector: string) => selector.includes('pictureStyle') ? style : selector.includes('situation-picture') ? mode : undefined };
    const summary = vi.fn();
    runInNewContext(`function syncTutorConversationPictureSettings() {${sync}}; if (true) {${patch}`, {
      document, HTMLSelectElement: Select, message: { value: 'illustrated' }, syncTutorConversationAdvancedSummary: summary });
    expect(style.value).toBe('illustrated'); expect(style.disabled).toBe(false); expect(summary).toHaveBeenCalledOnce();
    mode.value = 'none';
    runInNewContext(`function syncTutorConversationPictureSettings() {${sync}}; syncTutorConversationPictureSettings();`, { document, HTMLSelectElement: Select });
    expect(style.disabled).toBe(true);
    // 2026-10-12: The disabled explanation follows the mode in both directions.
    expect(style.attributes.get('title')).toBe('Choose a Situation picture mode to enable Picture style');
    mode.value = 'intro';
    runInNewContext(`function syncTutorConversationPictureSettings() {${sync}}; syncTutorConversationPictureSettings();`, { document, HTMLSelectElement: Select });
    expect(style.disabled).toBe(false);
    expect(style.attributes.has('title')).toBe(false);
  });
});

describe('V218 teaching take-home', () => {
  it('accepts short evidenced teaching and an optional pattern', () => {
    expect(tutorConversationTakeHome(card, input)).toEqual(card);
    expect(tutorConversationTakeHome({ naturally: [], doneWell: [], tryNext: 'Ask a question.' }, input)).not.toHaveProperty('pattern');
  });
  it.each([
    { naturally: [{ ...card.naturally[0], quote: 'Invented sentence.' }] },
    { naturally: [{ ...card.naturally[0], why: 'Ask directly. Use a question.' }] },
    { naturally: [{ ...card.naturally[0], why: 'x'.repeat(91) }] },
    { naturally: [{ ...card.naturally[0], why: 'x'.repeat(200) }] },
    { naturally: [{ ...card.naturally[0], alternatives: [] }] },
    // 2026-10-14: The list now permits three better ways, so four tests the same overflow guard.
    { naturally: [{ ...card.naturally[0], alternatives: ['a', 'b', 'c', 'd'] }] },
    { naturally: [{ ...card.naturally[0], alternatives: ['x'.repeat(81)] }] },
    { naturally: [card.naturally[0], card.naturally[0], card.naturally[0]] },
    { doneWell: [{ ...card.doneWell[0], quote: 'Invented praise.' }] },
    { doneWell: [{ ...card.doneWell[0], note: 'Good. Complete.' }] },
    { doneWell: [{ ...card.doneWell[0], note: 'x'.repeat(41) }] },
    { doneWell: [card.doneWell[0], card.doneWell[0]] },
    { tryNext: 'Ask directly. Use a question.' }, { tryNext: 'x'.repeat(101) },
    { pattern: { name: 'Pattern', examples: ['One.'] } },
    { pattern: { name: 'Pattern', examples: ['One.', 'Two.', 'Three.'] } },
    { pattern: { name: 'Pattern', examples: ['x'.repeat(81), 'Two.'] } },
    { pattern: { name: '', examples: ['One.', 'Two.'] } }
  ])('salvages other sections after unsupported evidence or oversized teaching %#', (patch) => {
    // Changed 2026-10-15: V245, owner item I22, an invalid field is logged and valid sections survive.
    const log = vi.fn();
    const result = tutorConversationTakeHome({ ...card, ...patch }, input, log);
    expect(log).toHaveBeenCalled();
    expect(result).toMatchObject('naturally' in patch || 'doneWell' in patch ? { pattern: card.pattern, tryNext: card.tryNext }
      : { naturally: card.naturally, doneWell: card.doneWell });
    if ('naturally' in patch) {
      const candidates = patch.naturally ?? [];
      const expected = candidates.length > 2 ? candidates.slice(0, 2)
        : candidates[0]?.alternatives?.length === 4 ? [{ ...candidates[0], alternatives: candidates[0].alternatives.slice(0, 3) }] : [];
      expect(result.naturally).toEqual(expected);
    }
    if ('doneWell' in patch) expect(result.doneWell).toEqual((patch.doneWell?.length ?? 0) > 1 ? patch.doneWell?.slice(0, 1) : []);
    if ('pattern' in patch) expect(result).not.toHaveProperty('pattern');
    if ('tryNext' in patch) expect(result.tryNext).toBe('');
  });
  it('accepts the exact character limits', () => {
    expect(tutorConversationTakeHome({ ...card, naturally: [{ ...card.naturally[0], why: 'x'.repeat(90), alternatives: ['x'.repeat(80)] }],
      doneWell: [{ ...card.doneWell[0], note: 'x'.repeat(40) }], pattern: { name: 'Pattern', examples: ['x'.repeat(80), 'y'.repeat(80)] }, tryNext: 'x'.repeat(100) }, input).tryNext).toHaveLength(100);
  });
  it('rejects demo evidence and accepts scripted teaching with empty evidence lists', () => {
    const demo = { ...input, demo: true, turns: [], demoLines: [{ speaker: 'male', text: 'How about meeting tomorrow?' }] };
    // Changed 2026-10-15: V245, owner item I22, scripted evidence is dropped while teaching survives.
    expect(tutorConversationTakeHome({ ...card, doneWell: [] }, demo)).toMatchObject({ naturally: [], pattern: card.pattern });
    expect(tutorConversationTakeHome({ ...card, naturally: [] }, demo)).toMatchObject({ doneWell: [], pattern: card.pattern });
    expect(tutorConversationTakeHome({ ...card, naturally: [], doneWell: [] }, demo).pattern).toEqual(card.pattern);
  });
  it('instructs teaching, Primary patterns, scripted demo teaching, and concrete next steps', () => {
    const request = tutorConversationTakeHomeRequest(input);
    expect(request.instruction).toMatch(/Teach.*native-level.*short teaching reason.*Never invent mistakes or praise/u);
    expect(request.instruction).toMatch(/Primary target.*demo naturally and doneWell must be empty.*scripted lines/u);
    // 2026-10-13: The next attempt is a learner line instead of an instruction to the tutor.
    expect(request.instruction).toMatch(/tryNext.*one line the learner.*could say next time/u);
    expect(request.schema).toMatchObject({ properties: { naturally: { maxItems: 2 }, doneWell: { maxItems: 1 },
      tryNext: { maxLength: 100 }, pattern: { properties: { examples: { minItems: 2, maxItems: 2 } } } } });
  });
  it('renders teaching sections and better ways as a list with no inline styling', () => {
    const conversation = createTutorViewState().conversation;
    conversation.takeHome = { identity: 'test', card };
    const html = renderTutorTakeHome(conversation), $ = load(html);
    expect($('h3').map((_, element) => $(element).text()).get()).toEqual([
      'Say it naturally', 'Pattern to keep: How about + -ing?', 'Done well', 'Try next time']);
    // 2026-10-14: Assert the new quote, list, and reason roles instead of pinning replacement labels.
    expect($('.tutor-take-home-natural').text()).not.toMatch(/You said|Native|Also/u);
    expect($('.tutor-take-home').text()).toContain(card.naturally[0]!.alternatives[0]);
    expect($('[style]')).toHaveLength(0);
    // 2026-10-14: Alternatives are separate bullets; pattern examples retain the middle-dot separator.
    const alternatives = $('.tutor-take-home-natural ul li').map((_, element) => $(element).text()).get();
    expect(alternatives).toEqual(card.naturally[0]!.alternatives);
    expect($('h3').filter((_, element) => $(element).text().startsWith('Pattern to keep')).next('p').text()).toContain(' · ');
    expect(html).not.toContain('</q> ? <q>');
  });
  it('omits empty evidence and absent pattern, keeping the next step outside disclosures', () => {
    const state = createTutorViewState();
    state.conversation.takeHome = { identity: 'test', card: { naturally: [], doneWell: [], tryNext: 'Ask a question.' } };
    const $ = load(renderTutorConversation(state));
    expect($('.tutor-take-home h3').map((_, element) => $(element).text()).get()).toEqual(['Try next time']);
    expect($('.tutor-take-home').closest('details')).toHaveLength(0);
    expect($('.tutor-take-home').text()).not.toMatch(/nothing to quote|No learner|No corrections/iu);
    expect($('.tutor-take-home button').attr('data-command')).toBe('cancelTutorTakeHome');
  });
  it('speaks better ways, pattern and next step in section order, never original learner evidence', () => {
    for (const demo of [false, true]) {
      const speech = tutorTakeHomeSpeech(card, demo);
      // 2026-10-14: Read the list and section names in card order, preserving evidence exclusions.
      expect(speech).toBe(['Take-home.', 'Say it naturally.', ...card.naturally[0]!.alternatives,
        `Pattern to keep: ${card.pattern!.name}`, ...card.pattern!.examples, `Try next time: ${card.tryNext}`].join(' '));
      for (const entry of [...card.naturally, ...card.doneWell]) expect(speech).not.toContain(entry.quote);
    }
  });
  it('both manuals name the four sections and keep the version', () => {
    // Changed 2026-10-14: V237, owner item 1.4, the card gains Learning targets, so both manuals name five sections.
    const guide = readFileSync('docs/USER_GUIDE.md', 'utf8');
    for (const document of [source, guide]) expect(document).toContain('Say it naturally, Learning targets, Pattern to keep, Done well, and Try next time');
    // 2026-10-11: the baseline pinned an older version; verify the guide follows the manifest.
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
    expect(guide).toContain(`This guide applies to KREN ${version}.`);
    const $ = load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [], settings: PANEL_SETTINGS_FIXTURE }));
    expect($('style').text()).toContain('.tutor-take-home > button + button { margin-left: 6px; }');
  });
});
