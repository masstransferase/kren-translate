import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

// 2026-10-24: V311. V310's fake DOM has no layout, so it could not see the jump the owner saw.
// This file runs the shipped panel in Microsoft Edge, which is Chromium as VS Code webviews are,
// with the real host behind it, and measures where the changed dropdown sits on screen.
const configuration = vi.hoisted(() => new Map<string, unknown>());
vi.mock('vscode', () => ({
  workspace: { getConfiguration: (section?: string) => ({
    get: (key: string, fallback: unknown) => {
      const full = section ? section + '.' + key : key;
      return configuration.has(full) ? configuration.get(full) : fallback;
    },
    inspect: () => undefined, update: async () => undefined }) },
  window: {}, commands: {}, env: {}, ConfigurationTarget: { Global: 1 },
  Uri: { joinPath: () => ({ toString: () => 'test' }) }
}));
import { KrenResultsViewProvider } from '../src/resultsView.js';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const hasEdge = process.platform === 'win32' && existsSync(EDGE);

type Cdp = { send(method: string, params?: Record<string, unknown>): Promise<any>;
  on(method: string, callback: (params: any) => void): () => void; close(): void };

function connect(url: string): Promise<Cdp> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let next = 0;
    const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
    const listeners = new Set<{ method: string; callback(params: unknown): void }>();
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== undefined) {
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) waiter?.reject(new Error(message.error.message));
        else waiter?.resolve(message.result);
        return;
      }
      for (const listener of [...listeners]) if (listener.method === message.method) listener.callback(message.params);
    };
    socket.onerror = () => reject(new Error('DevTools socket failed: ' + url));
    socket.onopen = () => resolve({
      send: (method, params = {}) => new Promise((done, fail) => {
        const id = ++next;
        pending.set(id, { resolve: done, reject: fail });
        socket.send(JSON.stringify({ id, method, params }));
      }),
      on(method, callback) {
        const listener = { method, callback };
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      close: () => socket.close()
    });
  });
}

let edge: ChildProcess | undefined;
let profile = '';
let browser: Cdp | undefined;
let page: Cdp;
let server: Server | undefined;
let origin = '';
const documents: string[] = [];
let onBinding: (name: string, payload: string) => void = () => undefined;
// One injected bridge at a time, across panel sessions, so an older session's state never wins.
let stateScript: string | undefined;

async function waitFor<T>(probe: () => T | undefined | Promise<T | undefined>, what: string, timeout = 20000): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > end) throw new Error('Timed out waiting for ' + what);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

beforeAll(async () => {
  if (!hasEdge) return;
  server = createServer((request, response) => {
    const index = Number((request.url ?? '').replace('/document/', ''));
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(documents[index] ?? '');
  });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  profile = mkdtempSync(join(tmpdir(), 'kren-v311-edge-'));
  // Port 0 lets Edge choose a free port and write it to DevToolsActivePort in the profile.
  edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--window-size=420,900', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-sync', '--disable-background-networking', 'about:blank'], { stdio: 'ignore' });
  const active = await waitFor(() => {
    try {
      const [port, path] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n');
      return port && path ? { port, path: path.trim() } : undefined;
    } catch { return undefined; }
  }, 'Edge to open its DevTools port');
  browser = await connect('ws://127.0.0.1:' + active.port + active.path);
  const target = await waitFor(async () => {
    const list = await (await fetch('http://127.0.0.1:' + active.port + '/json/list')).json() as Array<{ type: string; webSocketDebuggerUrl: string }>;
    return list.find(entry => entry.type === 'page');
  }, 'the Edge page');
  page = await connect(target.webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const name of ['krenPost', 'krenState', 'krenTrace']) await page.send('Runtime.addBinding', { name });
  page.on('Runtime.bindingCalled', ({ name, payload }) => onBinding(name, payload));
}, 60000);

// The Edge process and its profile folder go even when an assertion above failed.
afterAll(async () => {
  try { await browser?.send('Browser.close'); } catch { /* already gone */ }
  page?.close();
  browser?.close();
  if (edge && edge.exitCode === null) {
    await Promise.race([new Promise(resolve => edge!.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
    if (edge.exitCode === null) edge.kill();
  }
  await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve());
  // 2026-10-24: under full-suite load, Edge's helper processes still held the profile after the
  // main process exited (EPERM), failing a run whose tests all passed. The folder is in the OS
  // temp directory, so a leftover copy is not a test failure.
  try {
    if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } catch { /* left for the OS temp cleanup */ }
}, 30000);

const stored = [{ id: 'stored-model', displayName: 'Stored model' }, { id: 'other-model', displayName: 'Other model' }];

/** One panel lifetime: a fresh host and a fresh webview state, as when the panel is opened. */
async function openPanel() {
  configuration.clear();
  for (const [key, value] of Object.entries({ 'tutor.provider': 'gemini', 'tutor.model': 'stored-model',
    'tutor.alternateModel': 'stored-model', 'tutor.liveModel': 'stored-model', 'tutor.imageModel': 'stored-model',
    'tutor.geminiProfile': 'standard', 'tutor.liveGeminiProfile': 'standard' })) configuration.set('kren.' + key, value);
  const read = (key: string, fallback: unknown) => configuration.has('kren.' + key) ? configuration.get('kren.' + key) : fallback;
  const settings = () => ({ ...PANEL_SETTINGS_FIXTURE, tutorPictureProvider: 'gemini' as const,
    credentialPresence: { geminiDefault: true, geminiAlternate: true, cloudflareAccountId: true, cloudflareApiToken: true, groq: true, openai: true, anthropic: true, googleCloudTranslation: true, googleCloudTextToSpeech: true },
    tutorProvider: read('tutor.provider', 'gemini'), tutorModel: read('tutor.model', 'stored-model'),
    tutorAlternateModel: read('tutor.alternateModel', 'stored-model'), tutorHintModel: read('tutor.hintModel', PANEL_SETTINGS_FIXTURE.tutorHintModel),
    tutorFallbackModel: read('tutor.hintModel', PANEL_SETTINGS_FIXTURE.tutorHintModel),
    tutorThinkingOrEffort: read('tutor.thinkingOrEffort', PANEL_SETTINGS_FIXTURE.tutorThinkingOrEffort),
    tutorHintThinkingOrEffort: read('tutor.hintThinkingOrEffort', PANEL_SETTINGS_FIXTURE.tutorHintThinkingOrEffort),
    tutorProfile: read('tutor.geminiProfile', 'standard'), tutorLiveProfile: read('tutor.liveGeminiProfile', 'standard'),
    tutorFallbackEnabled: read('tutor.fallbackEnabled', PANEL_SETTINGS_FIXTURE.tutorFallbackEnabled),
    tutorImageModel: read('tutor.imageModel', 'stored-model'), tutorLiveModel: read('tutor.liveModel', 'stored-model') }) as typeof PANEL_SETTINGS_FIXTURE;
  const errors: string[] = [];
  const trace: string[] = [];
  let lastActivity = Date.now();
  let replacements = 0, patches = 0;
  // VS Code keeps the webview state across webview.html replacements, so it lives here.
  let state: unknown = undefined;
  // Everything that reaches the page goes through one queue, so a message the host posts after
  // replacing the document arrives after that document has loaded, as VS Code delivers it.
  let queue: Promise<void> = Promise.resolve();
  let busy = 0;
  const enqueue = (step: () => Promise<void>) => {
    busy++;
    lastActivity = Date.now();
    queue = queue.then(step).catch(error => { errors.push(String(error)); })
      .finally(() => { busy--; lastActivity = Date.now(); });
  };
  const actions = new Proxy({ settings, log: () => undefined,
    // The real updatePanelSetting writes the setting, and the configuration event calls refresh().
    updateSetting: async (key: string, value: unknown) => {
      await new Promise(resolve => setTimeout(resolve, 0));
      configuration.set('kren.' + key, value);
      view.refresh();
    } } as Record<string | symbol, unknown>, {
    get: (target, name) => name in target ? target[name] : async () => undefined
  });
  const view = new KrenResultsViewProvider(actions as never, {} as never);
  const internals = view as unknown as { activeScreen: string; liveModels: typeof stored; handleMessage(message: unknown): Promise<void> };
  internals.liveModels = stored;
  onBinding = (name, payload) => {
    lastActivity = Date.now();
    if (name === 'krenTrace') { trace.push(payload); return; }
    if (name === 'krenState') {
      state = JSON.parse(payload);
      trace.push('saved scroll ' + JSON.stringify((state as { scroll?: unknown } | null)?.scroll));
      return;
    }
    trace.push('panel posted ' + payload.slice(0, 80));
    const message = JSON.parse(payload) as Record<string, unknown>;
    if (message.command === 'panelScriptError') errors.push('panel: ' + JSON.stringify(message));
    void internals.handleMessage(message).catch(error => errors.push('host: ' + String(error)));
  };
  const load = async (index: number) => {
    if (stateScript) await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: stateScript });
    const source = '(() => { let state = ' + JSON.stringify(state ?? null) + ';' +
      'const api = { getState: () => state, setState: (value) => { state = value; window.krenState(JSON.stringify(value)); },' +
      'postMessage: (message) => window.krenPost(JSON.stringify(message)) };' +
      'window.acquireVsCodeApi = () => api; })();' +
      // Where each document's scroll goes, for the failure message: the trace that found the cause.
      'window.addEventListener("scroll", () => window.krenTrace("document ' + index + ' scrolled to " + Math.round(window.scrollY) +' +
      '" of " + document.documentElement.scrollHeight), { passive: true });';
    stateScript = (await page.send('Page.addScriptToEvaluateOnNewDocument', { source })).identifier;
    let loaded!: () => void;
    const done = new Promise<void>(resolve => { loaded = resolve; });
    const stop = page.on('Page.loadEventFired', () => loaded());
    await page.send('Page.navigate', { url: origin + '/document/' + index });
    await done;
    stop();
  };
  view.view = { webview: { cspSource: 'test', asWebviewUri: () => ({ toString: () => '' }),
    postMessage: async (message: Record<string, unknown>) => {
      if (message.command === 'tutorVoiceModelReady') patches++;
      trace.push('host posted ' + String(message.command));
      const expression = 'window.dispatchEvent(new MessageEvent("message", { data: ' + JSON.stringify(message) + ' }))';
      enqueue(async () => { await page.send('Runtime.evaluate', { expression }); });
      return true;
    },
    get html() { return ''; },
    set html(value: string) {
      replacements++;
      const index = documents.push(value) - 1;
      trace.push('host replaced the page with document ' + index);
      enqueue(() => load(index));
    } } } as never;
  internals.activeScreen = 'tutor';
  view.render();

  const evaluate = async <T>(expression: string): Promise<T> => {
    const result = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(expression.slice(0, 160) + '\n' + JSON.stringify(result.exceptionDetails.exception?.description));
    return result.result.value as T;
  };
  // Settled means: nothing queued, nothing posted for 400 ms, then two frames painted.
  const settle = async () => {
    for (let round = 0; round < 2; round++) {
      await waitFor(() => busy === 0 && Date.now() - lastActivity > 400 ? true : undefined, 'the panel to settle');
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    }
  };
  // The shown control for a key: a slot the current provider or profile hides is not the one a reader uses.
  const select = (key: string) => `Array.from(document.querySelectorAll(${JSON.stringify('[data-llm-routing="tutor"] select[data-model-preset="' + key +
    '"], [data-llm-routing="tutor"] select[data-setting="' + key + '"]')})).find(candidate => candidate.getClientRects().length > 0)`;
  await settle();
  // The reader opens LLM ROUTING and every section around it, the way a click does.
  await evaluate(`(() => { const routing = document.querySelector('[data-llm-routing="tutor"]');
    for (let node = routing; node; node = node.parentElement) if (node instanceof HTMLDetailsElement) node.open = true; })()`);
  await settle();
  return {
    errors, replaced: () => replacements, patched: () => patches, settle, evaluate,
    keys: () => evaluate<string[]>(`Array.from(document.querySelectorAll('[data-llm-routing="tutor"] select'))
      .map(select => select.getAttribute('data-model-preset') || select.getAttribute('data-setting') || '').filter(Boolean)`),
    /** Changes one dropdown the way a reader does, after scrolling so Provider is above the view. */
    async change(key: string) {
      const placed = await evaluate<{ value: string; scrollY: number } | null>(`(() => {
        const select = ${select(key)};
        const provider = (${select('tutor.provider')})?.closest('.setting');
        if (!(select instanceof HTMLSelectElement) || !provider) return null;
        const value = Array.from(select.options).map(option => option.value)
          .find(value => value !== select.value && value !== '__custom__');
        if (value === undefined) return null;
        const providerBottom = provider.getBoundingClientRect().bottom + window.scrollY;
        const selectTop = select.getBoundingClientRect().top + window.scrollY;
        // Provider just above the view while the select stays on screen, else the select at 300 px.
        // Provider itself goes to the top edge, with the LLM ROUTING summary just above the view.
        const top = ${JSON.stringify(key)} === 'tutor.provider' ? selectTop - 12
          : selectTop - providerBottom - 10 < window.innerHeight - 120 ? providerBottom + 10 : selectTop - 300;
        window.scrollTo(0, top);
        return { value, scrollY: window.scrollY };
      })()`);
      expect(placed, key + ' must be a shown tutor LLM ROUTING dropdown with a second choice').toBeTruthy();
      // A reader takes longer than the 120 ms scroll save to open a dropdown and choose.
      await new Promise(resolve => setTimeout(resolve, 300));
      const summary = `document.querySelector('[data-llm-routing="tutor"] > summary').getBoundingClientRect().height`;
      const before = await evaluate<{ scrollY: number; top: number; summary: number }>(`(() => {
        const select = ${select(key)};
        return { scrollY: window.scrollY, top: select.getBoundingClientRect().top, summary: ${summary} };
      })()`);
      const counts = { replaced: replacements, patched: patches };
      trace.length = 0;
      await evaluate(`(() => {
        const select = ${select(key)};
        select.focus();
        select.value = ${JSON.stringify(placed!.value)};
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await waitFor(() => patches > counts.patched ? true : undefined, key + ' to patch the settings block');
      await settle();
      const after = await evaluate<{ scrollY: number; top: number; summary: number; viewport: number; value: string; atTop: string }>(`(() => {
        const select = ${select(key)};
        const atTop = document.elementFromPoint(200, 4)?.closest('.setting, summary, details, section');
        return { scrollY: window.scrollY, top: select ? select.getBoundingClientRect().top : NaN, summary: ${summary},
          viewport: window.innerHeight, value: select ? select.value : '',
          atTop: atTop ? (atTop.querySelector('.setting-title')?.textContent || atTop.textContent || '').trim().slice(0, 40) : '' };
      })()`);
      const events = trace.splice(0).join('\n');
      return { key, value: placed!.value, before, after, events, replaced: replacements - counts.replaced, patched: patches - counts.patched };
    }
  };
}

type Panel = Awaited<ReturnType<typeof openPanel>>;
type Step = Awaited<ReturnType<Panel['change']>>;
// The measurements, one line per change, when KREN_V311_REPORT is set; a failure message carries them anyway.
const report = (order: string, step: Step) => process.env.KREN_V311_REPORT &&
  // eslint-disable-next-line no-console
  console.log(`[V311] ${order} | ${step.key} -> ${step.value} | scrollY ${step.before.scrollY} -> ${step.after.scrollY} | ` +
    `select top ${step.before.top.toFixed(1)} -> ${step.after.top.toFixed(1)} | documents ${step.replaced}, patches ${step.patched} | top of view: ${step.after.atTop}`);
const expectStill = (step: Step, context: string) => {
  expect(step.after.value, `${context}: ${step.key} keeps the chosen value`).toBe(step.value);
  expect(Math.abs(step.after.top - step.before.top), `${context}: ${step.key} moved on screen from ${step.before.top} to ${step.after.top}\n${step.events}`).toBeLessThanOrEqual(2);
  // What a reader can reach: the select they just used is still inside the view, not only unmoved.
  expect(step.after.top, `${context}: ${step.key} is on screen`).toBeGreaterThanOrEqual(0);
  expect(step.after.top, `${context}: ${step.key} is on screen`).toBeLessThan(step.after.viewport - 20);
  // The brief asks for an unchanged scrollY. That holds whenever nothing above the control
  // changes height, which is every dropdown but Provider: leaving Gemini removes "Gemini Profile"
  // from the LLM ROUTING summary above it, and the select can only stay still if scrollY moves by
  // exactly that height. So scrollY moves by the summary's measured change, which is 0 elsewhere.
  const reflow = step.after.summary - step.before.summary;
  if (step.key !== 'tutor.provider') expect(reflow, `${context}: the summary above ${step.key} keeps its height`).toBe(0);
  expect(Math.abs(step.after.scrollY - (step.before.scrollY + reflow)), `${context}: scrollY after ${step.key} went ${step.before.scrollY} to ${step.after.scrollY}, summary reflow ${reflow}`).toBeLessThanOrEqual(1);
};

const ROUTING = ['tutor.provider', 'tutor.geminiProfile', 'tutor.model', 'tutor.thinkingOrEffort', 'tutor.hintModel',
  'tutor.liveGeminiProfile', 'tutor.liveModel'];

describe.skipIf(!hasEdge)('V311 tutor LLM ROUTING dropdowns in Edge keep what the reader sees', { timeout: 180000 }, () => {
  it('draws the dropdowns the owner named inside the open section, on a page taller than the view', async () => {
    const panel = await openPanel();
    const keys = await panel.keys();
    expect(keys).toEqual(expect.arrayContaining(ROUTING));
    const reach = await panel.evaluate<{ height: number; viewport: number; open: boolean }>(`({
      height: document.documentElement.scrollHeight, viewport: window.innerHeight,
      open: document.querySelector('[data-llm-routing="tutor"]').open })`);
    expect(reach.open).toBe(true);
    expect(reach.height).toBeGreaterThan(reach.viewport);
    expect(panel.errors).toEqual([]);
  });

  it.each(ROUTING)('%s as the very first change after opening', async key => {
    const panel = await openPanel();
    const step = await panel.change(key);
    report('first', step);
    expect(step.replaced, 'the host replaced the document, as the configuration event makes it').toBeGreaterThan(0);
    expect(panel.errors).toEqual([]);
    expectStill(step, 'first change');
  });

  it.each([
    // Pro shows the alternate Model slot and another provider hides the Gemini rows, so each
    // order changes a control while it is shown, and Provider and the profiles come late.
    ['Live Model first', ['tutor.liveModel', 'tutor.model', 'tutor.thinkingOrEffort', 'tutor.hintModel', 'tutor.liveGeminiProfile', 'tutor.geminiProfile', 'tutor.alternateModel', 'tutor.provider']],
    ['Live Model last', ['tutor.model', 'tutor.thinkingOrEffort', 'tutor.hintModel', 'tutor.geminiProfile', 'tutor.liveGeminiProfile', 'tutor.provider', 'tutor.liveModel']],
    ['Live Model and Live profile back and forth', ['tutor.liveGeminiProfile', 'tutor.liveModel', 'tutor.hintModel', 'tutor.liveModel', 'tutor.liveGeminiProfile', 'tutor.thinkingOrEffort']]
  ])('%s', async (order, keys) => {
    const panel = await openPanel();
    const steps: Step[] = [];
    for (const key of keys) {
      const step = await panel.change(key);
      report(order, step);
      steps.push(step);
    }
    expect(panel.errors).toEqual([]);
    steps.forEach((step, index) => expectStill(step, `${order}, change ${index + 1}`));
  });
});
