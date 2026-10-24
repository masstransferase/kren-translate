// Changed 2026-10-22 (V298, owner I70/D33 B): Fast covers fallback.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { load } from 'cheerio';
import { KREN_SECRET_KEYS, runKrenOperation, runTutorStructuredRequest, runTutorTranslation,
  type KrenRuntime, type TutorLanguageModelRoute } from '../src/operations.js';
import { ProviderExhaustionState } from '../src/languageModelSwitching.js';
import { type TutorStructuredGenerationRequest } from '../src/tutor/generation.js';
import { TUTOR_DEFAULTS } from '../src/tutor/defaults.js';
import { runTutorThinking } from '../src/tutor/thinkingMode.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { validatedPanelSetting } from '../src/panelSettings.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';
import { CURRENT_REQUEST_POLICIES, runTutorGeneration, unwrapRequestOutcome } from '../src/requestCenter.js';

const signal = () => new AbortController().signal;
const route: TutorLanguageModelRoute = { provider: 'gemini', model: 'gemini-3.8-flash', thinkingOrEffort: 'low',
  fastModel: 'gemini-3.5-flash-lite', fastThinkingOrEffort: 'high', geminiProfile: 'standard',
  fallbackEnabled: true, fallbackModel: 'gemini-3.6-flash', fallbackThinkingOrEffort: 'minimal' };
const lesson: TutorStructuredGenerationRequest = { kind: 'lesson', input: '{}', instruction: 'Return a value.',
  schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] }, schemaName: 'v298' };
const hint = { ...lesson, kind: 'practiceHint' as const };
const validHint = { explanation: 'Think about the tense.', example: 'She has finished her work.' };
const answer = (value: unknown = { value: 'accepted' }) => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }]
}), { status: 200 });
const failure = (status: number, message = 'Temporary request failure.') => new Response(JSON.stringify({
  error: { code: status, message }
}), { status });
function runtime(settings: Record<string, unknown> = {}): KrenRuntime {
  return { providerExhaustion: new ProviderExhaustionState(),
    getSecret: vi.fn(async key => [KREN_SECRET_KEYS.gemini, KREN_SECRET_KEYS.geminiPro].includes(key as never) ? 'fixture-credential' : undefined),
    getSetting: <T>(key: string, fallback: T): T => (Object.hasOwn(settings, key) ? settings[key]
      : key === 'gemini.retry.enabled' || key === 'llm.providerSwitch' ? false : fallback) as T,
    reserveCloudCharacters: vi.fn(), beforeGeminiRequest: vi.fn() };
}
function capture(respond: (model: string, index: number) => Response) {
  const sends: Array<{ model: string; thinking: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const model = decodeURIComponent(/models\/([^:]+):/u.exec(String(input))?.[1] ?? '');
    const body = JSON.parse(String(init?.body));
    sends.push({ model, thinking: body.generationConfig?.thinkingConfig?.thinkingLevel ?? 'auto' });
    return respond(model, sends.length);
  }));
  return sends;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('V298 request sequences', () => {
  it.each(['standard', 'pro'] as const)('429 lesson exhausts primary retries then succeeds on Fast with its thinking and %s key', async geminiProfile => {
    vi.useFakeTimers();
    const host = runtime({ 'gemini.retry.enabled': true, 'gemini.retry.maxAttempts': 2 });
    const sends = capture(model => model === route.model ? failure(429) : answer());
    const pending = runTutorStructuredRequest(host, { ...route, geminiProfile }, lesson, signal());
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ value: 'accepted' });
    expect(sends).toEqual([{ model: route.model, thinking: 'low' }, { model: route.model, thinking: 'low' },
      { model: route.fastModel, thinking: 'high' }]);
    expect(host.getSecret).toHaveBeenCalledTimes(2);
    expect(vi.mocked(host.getSecret).mock.calls.every(([key]) => key === (geminiProfile === 'pro' ? KREN_SECRET_KEYS.geminiPro : KREN_SECRET_KEYS.gemini))).toBe(true);
    expect(vi.mocked(host.beforeGeminiRequest).mock.calls).toEqual([[geminiProfile], [geminiProfile]]);
  });
  it('toggle off sends only Thorough', async () => {
    const sends = capture(() => failure(429));
    await expect(runTutorStructuredRequest(runtime(), { ...route, fallbackEnabled: false }, lesson, signal())).rejects.toMatchObject({ status: 429 });
    expect(sends.map(send => send.model)).toEqual([route.model]);
  });
  it('Fast 503 cannot fall back to itself', async () => {
    const sends = capture(() => failure(503));
    await expect(runTutorStructuredRequest(runtime(), route, hint, signal())).rejects.toMatchObject({ status: 503 });
    expect(sends).toEqual([{ model: route.fastModel, thinking: 'high' }]);
  });
  it.each(['', route.model])('Fast value %j means no distinct fallback for a Thorough failure', async fastModel => {
    const sends = capture(() => failure(503));
    await expect(runTutorStructuredRequest(runtime(), { ...route, fastModel }, lesson, signal())).rejects.toMatchObject({ status: 503 });
    expect(sends.map(send => send.model)).toEqual([route.model]);
  });
  it.each([404, 504])('keeps eligible status %i', async status => {
    const sends = capture(model => model === route.model ? failure(status) : answer());
    await expect(runTutorStructuredRequest(runtime(), route, lesson, signal())).resolves.toEqual({ value: 'accepted' });
    expect(sends.map(send => send.model)).toEqual([route.model, route.fastModel]);
  });
  it.each(['400', 'structured output'])('%s does not fall back', async kind => {
    const sends = capture(() => kind === '400' ? failure(400) : new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{invalid' }] } }]
    }), { status: 200 }));
    await expect(runTutorStructuredRequest(runtime(), route, lesson, signal())).rejects.toThrow();
    expect(sends.map(send => send.model)).toEqual([route.model]);
  });
  it.each([[429, 'You exceeded your current quota. Check your plan and billing details.'],
    [503, 'This model is currently experiencing high demand.']] as const)('provider switching takes priority over Fast on %i', async (status, message) => {
    const sends = capture(() => failure(status, message));
    await expect(runTutorStructuredRequest(runtime({ 'llm.providerSwitch': true }), route, lesson, signal())).rejects.toThrow();
    expect(sends.map(send => send.model)).toEqual([route.model]);
  });
  it('cancellation during the primary send prevents fallback', async () => {
    const controller = new AbortController();
    const sends = capture(() => { controller.abort(); return failure(429); });
    await expect(runTutorStructuredRequest(runtime(), route, lesson, controller.signal)).rejects.toThrow();
    expect(sends).toHaveLength(1);
  });
  it('Fast Auto preserves minimal, explicit thinking applies to routine Fast requests', async () => {
    const sends = capture(() => answer(validHint));
    await runTutorStructuredRequest(runtime(), { ...route, fastThinkingOrEffort: 'auto' }, hint, signal());
    await runTutorStructuredRequest(runtime(), route, hint, signal());
    expect(sends).toEqual([{ model: route.fastModel, thinking: 'minimal' }, { model: route.fastModel, thinking: 'high' }]);
  });
  it('a validation failure still escalates once to Thorough thinking', async () => {
    const generate = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce(validHint);
    await runTutorThinking(hint, { ...route, thinkingOrEffort: 'medium' }, signal(), generate);
    expect(generate.mock.calls.map(call => [call[1].model, call[1].thinkingOrEffort])).toEqual([
      [route.fastModel, 'high'], [route.model, 'medium']]);
  });
  it('non-tutor Translate keeps its independent fallback model and effort', async () => {
    const sends = capture(model => model === route.model ? failure(429) : answer({ translatedText: 'Translated.', alternatives: [], note: '' }));
    await runKrenOperation(runtime({ translationProvider: 'gemini', 'translation.model': route.model,
      'translation.fallbackEnabled': true, 'translation.fallbackModel': 'gemini-3.6-flash',
      'translation.fallbackThinkingOrEffort': 'medium', 'tutor.hintModel': route.fastModel }), 'translate', { text: 'Hello.' }, signal());
    expect(sends).toEqual([{ model: route.model, thinking: 'low' }, { model: 'gemini-3.6-flash', thinking: 'medium' }]);
  });
});

const extension = ts.createSourceFile('extension.ts', readFileSync('src/extension.ts', 'utf8'), ts.ScriptTarget.Latest, true);
function hostFunction(name: string, scope: Record<string, unknown>, tutorReader = false): (...args: any[]) => any {
  const node = extension.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  if (!node || !ts.isFunctionDeclaration(node)) throw new Error(`Missing host function ${name}`);
  let code = node.getText(extension);
  if (tutorReader) {
    // Execute the actual reader's tutor properties, excluding unrelated feature/credential dependencies.
    const returned = node.body!.statements.find(ts.isReturnStatement)!;
    const object = returned.expression as ts.ObjectLiteralExpression;
    const keys = new Set(['tutorProvider', 'tutorModel', 'tutorAlternateModel', 'tutorHintModel',
      'tutorHintThinkingOrEffort', 'tutorThinkingOrEffort', 'tutorProfile']);
    code = code.replace(returned.getText(extension), `return {${object.properties.filter(property =>
      property.name && keys.has(property.name.getText(extension))).map(property => property.getText(extension)).join(',')}};`);
  }
  return runInNewContext(ts.transpileModule(`${code}; ${name}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, scope);
}
const scopes = ['globalValue', 'workspaceValue', 'workspaceFolderValue'] as const;
function migration(values: Record<string, Record<string, unknown>>) {
  const update = vi.fn(async (key: string, value: unknown, target: number) => {
    const field = scopes[target - 1]!;
    if (value === undefined) delete values[key]?.[field];
    else (values[key] ??= {})[field] = value;
  });
  const config = { inspect: (key: string) => values[key], update };
  const run = hostFunction('migrateTutorFastSettings', { vscode: { ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    workspace: { getConfiguration: () => config } } });
  return { run, update, effective: () => {
    const stored = values['tutor.hintThinkingOrEffort'];
    return stored?.workspaceFolderValue ?? stored?.workspaceValue ?? stored?.globalValue ?? 'auto';
  } };
}
describe('V298 migration table', () => {
  it.each(scopes)('copies explicit fallback thinking at %s, clears both retired keys and is idempotent', async scope => {
    const values = { 'tutor.fallbackThinkingOrEffort': { [scope]: 'high' },
      'tutor.fallbackModel': { [scope]: 'gemini-old-reader-model' }, 'tutor.hintModel': { [scope]: 'gemini-reader-fast' } };
    const { run, update, effective } = migration(values);
    await run();
    expect(effective()).toBe('high');
    expect(values['tutor.fallbackThinkingOrEffort']).toEqual({});
    expect(values['tutor.fallbackModel']).toEqual({});
    expect(values['tutor.hintModel']).toEqual({ [scope]: 'gemini-reader-fast' });
    expect(update).toHaveBeenCalledTimes(3);
    update.mockClear(); await run(); expect(update).not.toHaveBeenCalled();
  });
  it.each(scopes)('keeps existing Fast thinking at %s even when fallback is explicitly set elsewhere', async scope => {
    const values = { 'tutor.fallbackThinkingOrEffort': { workspaceFolderValue: 'high', globalValue: 'medium' },
      'tutor.fallbackModel': { workspaceValue: 'gemini-old' }, 'tutor.hintThinkingOrEffort': { [scope]: 'auto' } };
    const { run, update, effective } = migration(values);
    await run();
    // Changed 2026-10-23 (V301, verification R28): an explicit Fast value protects only its own scope.
    const expected = { globalValue: 'medium', workspaceFolderValue: 'high', [scope]: 'auto' };
    expect(effective()).toBe(expected.workspaceFolderValue);
    expect(values['tutor.hintThinkingOrEffort']).toEqual(expected);
    expect(update.mock.calls.filter(([key]) => key === 'tutor.hintThinkingOrEffort')).toHaveLength(scope === 'workspaceValue' ? 2 : 1);
    expect(values['tutor.fallbackThinkingOrEffort']).toEqual({});
    expect(values['tutor.fallbackModel']).toEqual({});
    update.mockClear(); await run(); expect(update).not.toHaveBeenCalled();
  });
  it('nothing explicit gives Auto and performs no writes', async () => {
    const { run, update, effective } = migration({});
    await run(); await run();
    expect(effective()).toBe('auto'); expect(update).not.toHaveBeenCalled();
    expect(TUTOR_DEFAULTS.configuration['tutor.hintThinkingOrEffort']).toBe('auto');
  });
  it('preserves all old scope overrides when no Fast thinking is explicit', async () => {
    const values: Record<string, Record<string, unknown>> = { 'tutor.fallbackThinkingOrEffort': {
      globalValue: 'low', workspaceValue: 'medium', workspaceFolderValue: 'high' } };
    const { run, effective } = migration(values); await run();
    expect(values['tutor.hintThinkingOrEffort']).toEqual({ globalValue: 'low', workspaceValue: 'medium', workspaceFolderValue: 'high' });
    expect(effective()).toBe('high');
  });
  it('runs on activation before the panel is created', () => {
    const source = extension.getText();
    expect(source.indexOf('await migrateTutorFastSettings()')).toBeGreaterThan(source.indexOf('export async function activate'));
    expect(source.indexOf('await migrateTutorFastSettings()')).toBeLessThan(source.indexOf('new KrenResultsViewProvider'));
  });
});

describe('V298 Translate host wiring and reader controls', () => {
  it('the panel resolves routine Fast thinking from the configured choice before calling the host', async () => {
    const generateTutor = vi.fn(async () => validHint);
    const actions = { settings: () => ({ ...PANEL_SETTINGS_FIXTURE, tutorHintThinkingOrEffort: 'high' }),
      generateTutor, log: vi.fn() };
    const source = readFileSync('src/resultsView.ts', 'utf8');
    const wrapper = source.slice(source.indexOf("    const generate: ResultsViewActions['generateTutor']"), source.indexOf('    this.actions = new Proxy'));
    const generate = runInNewContext(ts.transpileModule(`function panelAction() { ${wrapper}; return generate; }
      panelAction.call({ tutorState: { conversation: { transcript: [] } } });`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    { actions, configuredTutorHintModel: () => route.fastModel, runTutorGeneration, CURRENT_REQUEST_POLICIES, unwrapRequestOutcome, TUTOR_DEFAULTS });
    await generate(hint, { ...route, fastThinkingOrEffort: undefined }, signal());
    expect(generateTutor).toHaveBeenCalledTimes(1);
    expect(generateTutor.mock.calls[0]).toEqual([expect.objectContaining({ thinkingMode: 'fast' }),
      expect.objectContaining({ model: route.fastModel, thinkingOrEffort: 'high' }), expect.any(AbortSignal)]);
  });
  it('I73 custom Fast model reaches the actual Translate tool request', async () => {
    const values: Record<string, unknown> = { 'tutor.hintModel': 'gemini-3.6-flash', 'tutor.hintThinkingOrEffort': 'medium' };
    const config = { get: (key: string, fallback: unknown) => values[key] ?? fallback };
    const reader = hostFunction('readPanelSettings', { vscode: { workspace: { getConfiguration: () => config }, window: {} },
      normalizeModelSetting: (_key: string, value: unknown) => value, routedModel: (_provider: string, model: string) => model, TUTOR_DEFAULTS }, true);
    const source = extension.getText();
    const code = source.split('runTutorTool: (operation, text, signal, targetLanguage, retry) => {')[1]!.split('\n    updateSetting:')[0]!;
    const run = runInNewContext(ts.transpileModule(`const runTutorTool = (operation, text, signal, targetLanguage, retry) => {${code.replace(/,\s*$/u, '')}; runTutorTool`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
      readPanelSettings: reader, runTutorTranslation, runKrenOperation, extensionRuntime: () => runtime(), context: {} });
    const sends = capture(() => answer({ translatedText: 'Translated.', alternatives: [], note: '' }));
    await run('translate', 'A short sentence.', signal(), 'ko', false);
    expect(sends).toEqual([{ model: 'gemini-3.6-flash', thinking: 'medium' }]);
  });
  it('Fast thinking is storable and retired keys are rejected', () => {
    for (const value of ['auto', 'none', 'minimal', 'low', 'medium', 'high']) expect(validatedPanelSetting('tutor.hintThinkingOrEffort', value)).toBe(value);
    expect(validatedPanelSetting('tutor.hintThinkingOrEffort', 'invalid')).toBeUndefined();
    for (const key of ['tutor.fallbackModel', 'tutor.fallbackThinkingOrEffort']) expect(validatedPanelSetting(key as never, 'high')).toBeUndefined();
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')).contributes.configuration.properties;
    expect(manifest['kren.tutor.hintThinkingOrEffort'].default).toBe('auto');
    expect(manifest).not.toHaveProperty('kren.tutor.fallbackModel');
    expect(manifest).not.toHaveProperty('kren.tutor.fallbackThinkingOrEffort');
    expect(readFileSync('src/resultsViewSettings.ts', 'utf8')).toContain("key === 'tutor.hintThinkingOrEffort'");
  });
  it('reader can find Fast thinking beside Fast model through native keyboard disclosures and save a choice', () => {
    const html = renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'tutor',
      settings: { ...PANEL_SETTINGS_FIXTURE, tutorHintModel: route.fastModel, tutorHintThinkingOrEffort: 'high' }, proModels: [] });
    const $ = load(html), fast = $('[data-setting="tutor.hintThinkingOrEffort"]'), routing = fast.closest('[data-llm-routing="tutor"]');
    expect(fast).toHaveLength(1); expect(fast.is('select')).toBe(true); expect(fast.attr('tabindex')).not.toBe('-1');
    expect(fast.is('[disabled],[hidden]')).toBe(false);
    expect(fast.closest('.setting').prev().find('[data-setting="tutor.hintModel"]')).toHaveLength(1);
    expect(routing.children('summary').text()).toContain('Fast thinking: High');
    expect(fast.parents('details').toArray().every(element => $(element).children('summary').length === 1)).toBe(true);
    expect(fast.parents('details').map((_, element) => $(element).attr('data-persist-id')).get()).toEqual(['tutor-routing', 'tutor-setting']);
    expect(fast.parents('[hidden],.hidden')).toHaveLength(0);
    expect(routing.text()).toContain('Use Fast when Thorough is unavailable');
    expect(routing.text()).toMatch(/Fast cannot fall back to itself/u);
    expect(routing.find('[data-setting="tutor.fallbackModel"],[data-setting="tutor.fallbackThinkingOrEffort"]')).toHaveLength(0);
    const messages: Record<string, unknown>[] = [], mounted = mountedPanel(html, message => messages.push(message));
    const control = mounted.document.querySelector('[data-setting="tutor.hintThinkingOrEffort"]')!;
    // Native details summaries are keyboard toggles. Open every containing disclosure before focusing the select.
    for (const element of fast.parents('details').toArray().reverse()) {
      const disclosure = mounted.document.querySelector(`[data-persist-id="${$(element).attr('data-persist-id')}"]`)!;
      disclosure.open = true; mounted.event(disclosure, 'toggle');
    }
    control.focus(); expect(mounted.document.activeElement).toBe(control);
    control.value = 'medium'; mounted.change(control);
    expect(messages).toContainEqual({ command: 'updateSetting', key: 'tutor.hintThinkingOrEffort', value: 'medium' });
    mounted.message({ command: 'tutorConversationHintState', busy: false });
    expect(mounted.document.querySelector('[data-setting="tutor.hintThinkingOrEffort"]')).toBe(control);
  });
});
