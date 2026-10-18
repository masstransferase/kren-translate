import { afterEach, expect, it, vi } from 'vitest';
import { load } from 'cheerio';
import { EnvironmentChecks, availabilityNames, systemUpdatesAvailable, listEnvironmentGeminiModels,
  type EnvironmentCheckOptions, type EnvironmentSnapshot, type ManualAvailabilityChecks } from '../src/environmentCheck.js';
import { focusEnvironmentFix, renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

const webviewState = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('node:vm', async importOriginal => {
  const actual = await importOriginal<typeof import('node:vm')>();
  return { ...actual, runInNewContext: (code: string, context: Record<string, any>) => {
    const originalApi = context.acquireVsCodeApi;
    context.acquireVsCodeApi = () => ({ ...originalApi(), getState: () => webviewState.value,
      setState: (state: Record<string, unknown>) => { webviewState.value = state; } });
    return actual.runInNewContext(code, context);
  } };
});

const credential = ['private', 'credential', 'probe'].join('-');
const groqChoice = { name: 'retired-groq-model', feature: 'Translation', fixTarget: 'translation' as const };
function harness() {
  let snapshot: EnvironmentSnapshot | undefined;
  let date = '2026-10-16';
  const list = vi.fn(async () => [{ id: groqChoice.name }]);
  const getKey = vi.fn(async () => credential as string | undefined);
  const manual: ManualAvailabilityChecks = {
    getKey, models: () => ({ groq: [groqChoice] }),
    edgeVoices: () => [{ name: 'en-US-AvaNeural', feature: 'Tutor preset', fixTarget: 'tutorVoice' }],
    chirpVoices: () => [{ name: 'en-US-Chirp3-HD-Kore', feature: 'Tutor', fixTarget: 'tutorVoice' }],
    listers: { gemini: list, geminiPro: list, groq: list, openai: list, anthropic: list }
  };
  const request = vi.fn(async (url: string | URL | Request) => ({ ok: true, json: async () => String(url).includes('pypi.org')
    ? { info: { version: '7.3.1' } } : { voices: [{ name: 'en-US-Chirp3-HD-Kore' }] } }) as Response);
  const process = vi.fn(async (_command: string, args: string[]) => ({ code: 0, stderr: '',
    stdout: args[0] === '--version' ? 'Python 3.13.0' : args[1]?.includes('list_voices') ? '["en-US-AvaNeural"]' : '7.3.1' }));
  const log = vi.fn();
  const options: EnvironmentCheckOptions = { pythonCommand: () => 'C:\\Python Folder\\python.exe', vscodeVersion: '1.106.0', vscodeMinimum: '^1.106.0',
    detectHandy: async () => undefined, dailyEnabled: () => true, manual, fetch: request as typeof fetch, runProcess: process,
    store: { get: <T>() => snapshot as T | undefined, update: async (_key, value) => { snapshot = value as EnvironmentSnapshot; } },
    now: () => new Date(`${date}T12:00:00Z`), log, report: vi.fn(), confirm: async () => true, progress: async task => task(), timeoutMs: 10 };
  const checks = new EnvironmentChecks(options);
  return { checks, options, manual, list, getKey, request, process, log, saved: () => snapshot,
    nextDate: () => { date = '2026-10-17'; } };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); webviewState.value = {}; });

it('reports an absent stored Groq name with its feature and routing destination', async () => {
  // Changed 2026-10-16: V252, R11 finding 4, a removal needs a readable nonempty provider list.
  const h = harness(); h.list.mockResolvedValue([{ id: 'another-offered-model' }]);
  const items = await h.checks.check();
  expect(items).toContainEqual(expect.objectContaining({ name: 'Groq', group: 'Models', status: 'update',
    found: expect.stringContaining('Translation: retired-groq-model'), fixTarget: 'translation' }));
  expect(systemUpdatesAvailable(h.checks.statuses)).toBe(true);
  expect(h.checks.statuses.Models).toBe('update');
});
it('reports all present names as ok and Cloudflare as explicitly not checked', async () => {
  const h = harness(); const items = await h.checks.check();
  expect(items.find(item => item.name === 'Groq')).toMatchObject({ status: 'ok' });
  expect(items.find(item => item.name === 'Cloudflare')).toMatchObject({ status: 'unknown', explanation: expect.stringMatching(/not checked.*no model lister/iu) });
  expect(items.filter(item => item.group === 'Voices').every(item => item.status === 'ok')).toBe(true);
  expect(systemUpdatesAvailable(h.checks.statuses)).toBe(false);
});
it('skips a provider without a stored key and never calls its lister', async () => {
  const h = harness(); h.getKey.mockResolvedValue(undefined);
  const items = await h.checks.check();
  expect(h.list).not.toHaveBeenCalled();
  expect(h.request.mock.calls.map(([url]) => String(url))).toEqual(['https://pypi.org/pypi/edge-tts/json']);
  for (const item of items.filter(item => item.group === 'Models' || item.name === 'Google Cloud Chirp'))
    expect(item.explanation).toBe('No key stored, not checked');
});
it('never obtains keys or calls model listers, Edge voice discovery, or Google voices from the daily check', async () => {
  const h = harness(); await h.checks.daily();
  expect(h.getKey).not.toHaveBeenCalled(); expect(h.list).not.toHaveBeenCalled();
  expect(h.manual.listers.groq).not.toHaveBeenCalled();
  expect(h.process.mock.calls.some(([, args]) => args[1]?.includes('list_voices'))).toBe(false);
  expect(h.request.mock.calls.map(([url]) => String(url))).toEqual(['https://pypi.org/pypi/edge-tts/json']);
});
it('marks a lister timeout unknown and aborts its signal', async () => {
  vi.useFakeTimers(); const h = harness();
  h.list.mockImplementation(() => new Promise(() => {}));
  const pending = h.checks.check(); await vi.advanceTimersByTimeAsync(30);
  expect((await pending).find(item => item.name === 'Groq')).toMatchObject({ status: 'unknown', explanation: expect.stringMatching(/timed out/iu) });
  const call = h.list.mock.calls[0] as unknown as [string, AbortSignal];
  expect(call[1].aborted).toBe(true);
});
it('reports a missing Edge preset and keeps the configured executable separate from Python arguments', async () => {
  const h = harness(); h.manual.edgeVoices = () => [{ name: 'en-US-JennyNeural', feature: 'Tutor preset', fixTarget: 'tutorVoice' }];
  expect((await h.checks.check()).find(item => item.name === 'Edge Online')).toMatchObject({ status: 'update',
    found: expect.stringContaining('en-US-JennyNeural'), fixTarget: 'tutorVoice' });
  expect(h.process.mock.calls.every(([command]) => command === 'C:\\Python Folder\\python.exe')).toBe(true);
  expect(h.process.mock.calls.find(([, args]) => args[1]?.includes('list_voices'))?.[1][0]).toBe('-c');
});
it('sends the Chirp key only in the header, with no key or text in the URL or body', async () => {
  const h = harness(); await h.checks.check();
  const call = h.request.mock.calls.find(([url]) => String(url).includes('texttospeech')) as unknown as [string, RequestInit];
  expect(call[0]).toBe('https://texttospeech.googleapis.com/v1/voices?languageCode=en-US');
  expect(call[0]).not.toContain(credential);
  expect(call[1]).toMatchObject({ method: 'GET', headers: { 'X-Goog-Api-Key': credential }, credentials: 'omit', redirect: 'error' });
  expect(call[1].body).toBeUndefined();
});
it('never logs provider exception text, response bodies, or credentials', async () => {
  const h = harness(); h.list.mockRejectedValue(Error(`request failed ${credential}`));
  const items = await h.checks.check();
  expect(items.find(item => item.name === 'Groq')).toMatchObject({ status: 'unknown', explanation: expect.stringContaining('list failed') });
  expect(JSON.stringify(items)).not.toContain(credential);
  expect(JSON.stringify(h.log.mock.calls)).not.toContain(credential);
  expect(h.log.mock.calls.every(([line]) => /^\[updates\].*: \d+ missing names\.$/u.test(line))).toBe(true);
});
it('preserves menu findings through a daily check and restart, then clears them when the names are offered', async () => {
  // Changed 2026-10-16: V252, R11 finding 4, an empty list is inconclusive rather than proof of removal.
  const h = harness(); h.list.mockResolvedValue([{ id: 'another-offered-model' }]); await h.checks.check();
  h.nextDate(); await h.checks.daily();
  expect(systemUpdatesAvailable(new EnvironmentChecks(h.options).statuses)).toBe(true);
  h.list.mockResolvedValue([{ id: groqChoice.name }]); await h.checks.check();
  expect(systemUpdatesAvailable(h.checks.statuses)).toBe(false);
  expect(JSON.stringify(h.saved())).not.toContain(groqChoice.name);
  expect(JSON.stringify(h.saved())).not.toContain(credential);
});
it('retains an unresolved provider notice when that provider times out later', async () => {
  // Changed 2026-10-16: V252, R11 finding 4, establish the missing name with a readable nonempty list.
  const h = harness(); h.list.mockResolvedValue([{ id: 'another-offered-model' }]); await h.checks.check();
  h.list.mockRejectedValue(Error('offline')); await h.checks.check();
  expect(h.checks.statuses.Models).toBe('update');
});
it('runs the requested manual check after an already-running daily check', async () => {
  const h = harness();
  h.options.timeoutMs = 1000;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  h.options.runProcess = async (command, args) => { await gate; return h.process(command, args); };
  const daily = h.checks.daily();
  await vi.waitFor(() => expect(h.checks.busy).toBe(true));
  const menu = h.checks.check();
  expect(h.list).not.toHaveBeenCalled();
  release(); await Promise.all([daily, menu]);
  expect(h.list).toHaveBeenCalled();
  expect(h.checks.items.some(item => item.group === 'Models')).toBe(true);
});
it('collects shared grammar routing, every model default, tutor fallback and stored voice names', () => {
  const values: Record<string, string> = { 'translation.provider': 'groq', 'translation.model': groqChoice.name,
    'tutor.fallbackModel': 'gemini-retired', 'readAloud.edgeVoice': 'en-US-StoredNeural', 'readAloud.chirpVoice': 'StoredChirp',
    'groq.customModels': '["qwen/custom-choice"]' };
  const names = availabilityNames((key, fallback) => values[key] ?? fallback);
  expect(names.models.groq).toContainEqual(expect.objectContaining({ name: groqChoice.name, fixTarget: 'translation' }));
  expect(names.models.groq).toContainEqual(expect.objectContaining({ name: 'qwen/custom-choice', feature: 'groq custom model list' }));
  expect(names.models.gemini).toContainEqual(expect.objectContaining({ name: 'gemini-retired', feature: 'Tutor, fallback' }));
  expect(names.models.gemini).toContainEqual(expect.objectContaining({ feature: expect.stringContaining('Smart Grammar'), fixTarget: 'grammar' }));
  expect(names.edgeVoices).toContainEqual(expect.objectContaining({ name: 'en-US-StoredNeural', fixTarget: 'readAloud' }));
  expect(names.chirpVoices).toContainEqual(expect.objectContaining({ name: 'en-US-Chirp3-HD-StoredChirp', fixTarget: 'readAloud' }));
});
it('compares Gemini discovery before picker defaults or stored names can hide a removal', async () => {
  const request = vi.fn(async (_url: string | URL | Request) => ({ ok: true, json: async () => ({ models: [{ name: 'models/gemini-listed' }] }) }) as Response);
  vi.stubGlobal('fetch', request);
  expect(await listEnvironmentGeminiModels(credential, new AbortController().signal)).toEqual([{ id: 'gemini-listed' }]);
  expect(String(request.mock.calls[0]?.[0])).not.toContain(credential);
});

it('groups results, exposes keyboard-reachable fixes, and shows the Start notice for a model update', async () => {
  // Changed 2026-10-16: V252, R11 finding 4, render a confirmed removal from a readable nonempty list.
  const h = harness(); h.list.mockResolvedValue([{ id: 'another-offered-model' }]); const items = await h.checks.check();
  const render = (activeScreen: 'start' | 'updates') => renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [],
    settings: PANEL_SETTINGS_FIXTURE, activeScreen, environmentItems: items, systemUpdatesAvailable: systemUpdatesAvailable(h.checks.statuses) });
  const $ = load(render('updates'));
  expect($('#updates-screen > [data-update-group]').map((_, el) => $(el).attr('data-update-group')).get()).toEqual(['System', 'Models', 'Voices']);
  const button = $('[data-update-group="Models"] [data-update-fix-target="translation"]').first();
  expect(button.is('button:not([disabled])')).toBe(true); expect(button.text()).toMatch(/LLM ROUTING/u);
  expect(button.parents('details, .hidden')).toHaveLength(0);
  const post = vi.fn();
  const updates = mountedPanel(render('updates'), post);
  updates.click(updates.query('[data-update-fix-target="translation"]')!);
  expect(post).toHaveBeenCalledWith({ command: 'showSettings' });
  const start = mountedPanel(render('start'), () => {});
  const notice = start.query('#result-screen [data-system-updates]')!;
  expect(notice.classList.contains('hidden')).toBe(false);
  start.message({ command: 'systemUpdatesStatus', available: false });
  expect(notice.classList.contains('hidden')).toBe(true);
  start.message({ command: 'systemUpdatesStatus', available: true });
  expect(start.query('#result-screen [data-system-updates]')).toBe(notice);
  expect(notice.classList.contains('hidden')).toBe(false);
});
it.each(['translation', 'grammar', 'explanation', 'rewrite', 'userDictionary', 'tutor', 'tutorVoice', 'readAloud'] as const)(
  'opens and focuses the %s destination through every collapsed ancestor', destination => {
    const summary = { focus: vi.fn() };
    const parent = { tagName: 'DETAILS', open: false, parentElement: null };
    const section = { tagName: 'DETAILS', open: false, parentElement: parent, scrollIntoView: vi.fn(), querySelector: vi.fn(() => summary) };
    const doc = { querySelector: vi.fn((_selector: string) => section) };
    expect(focusEnvironmentFix(doc as unknown as Document, destination)).toBe(true);
    expect(section.open).toBe(true); expect(parent.open).toBe(true);
    expect(section.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(summary.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(doc.querySelector.mock.calls[0]?.[0]).toMatch(destination === 'explanation' ? /explain/u : destination === 'tutorVoice' ? /tutor-voice/u : new RegExp(destination));
    const panel = mountedPanel(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [], settings: PANEL_SETTINGS_FIXTURE,
      activeScreen: destination.startsWith('tutor') ? 'tutor' : 'settings' }), () => {});
    expect(focusEnvironmentFix(panel.document as unknown as Document, destination)).toBe(true);
  });

it.each(['translation', 'tutorVoice'] as const)('carries the %s fix through navigation and consumes its stored focus once', destination => {
  const item = { name: 'Provider', group: 'Models' as const, status: 'update' as const, found: 'Missing name',
    expected: 'Offered name', explanation: 'Review the stored choice.', fixTarget: destination };
  const render = (activeScreen: 'updates' | 'settings' | 'tutor') => renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [],
    settings: PANEL_SETTINGS_FIXTURE, activeScreen, environmentItems: [item] });
  const post = vi.fn();
  const updates = mountedPanel(render('updates'), post);
  updates.click(updates.query(`[data-update-fix-target="${destination}"]`)!);
  expect(webviewState.value.updateFixTarget).toBe(destination);
  expect(post).toHaveBeenCalledWith({ command: destination === 'translation' ? 'showSettings' : 'showTutor' });
  const opened = mountedPanel(render(destination === 'translation' ? 'settings' : 'tutor'), () => {});
  const section = opened.query(destination === 'translation' ? '[data-llm-routing="translation"]' : '[data-persist-id="tutor-voice"]')!;
  expect(section.open).toBe(true);
  for (let ancestor = section.parentElement; ancestor; ancestor = ancestor.parentElement)
    if (ancestor.tagName === 'DETAILS') expect(ancestor.open).toBe(true);
  expect(webviewState.value.updateFixTarget).toBeUndefined();
});
