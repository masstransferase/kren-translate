import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { load } from 'cheerio';
import ts from 'typescript';
import { renderKrenResultViewHtml, renderLanguageModelUsage } from '../src/resultViewHtml.js';
import { configureLanguageModelUsage, LanguageModelUsageRecorder, type LanguageModelUsage } from '../src/languageModelUsage.js';
import { generateSituationPicture } from '../src/providers/situationPicture.js';
import { TutorLiveSession, type TutorLiveSocket, type TutorLiveSocketEvent } from '../src/tutor/liveSession.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';

afterEach(() => { configureLanguageModelUsage(undefined); vi.unstubAllGlobals(); });

function rows(count: number): LanguageModelUsage[] {
  return Array.from({ length: count }, (_, index) => ({ provider: 'gemini',
    geminiProfile: index % 2 ? 'pro' : 'standard', model: `model-${index + 1}`,
    requests: 1, input: 100, output: 10, thinking: 0 }));
}

function html(count: number) {
  return renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'credentials',
    settings: { ...PANEL_SETTINGS_FIXTURE, languageModelUsageToday: rows(count) }, proModels: [] });
}

// The mounted DOM adapter has no layout engine. Supply independently varying row rectangles
// before the shipped script runs, including wrapping and the scroll offset of its box.
function panel(count: number) {
  const $ = load(html(count));
  const css = $('style').text();
  const staticLimit = Number(css.match(/\[data-language-model-usage\]\s*\{[^}]*max-height:\s*(\d+)px/u)?.[1]) || 0;
  $('script').first().before(`<script>
    const testUsageBox = document.querySelector('[data-language-model-usage]');
    let testWrap = 1;
    const testRowHeight = index => (60 + (index % 3) * 30) * testWrap;
    const testNaturalHeight = () => 50 + Array.from(testUsageBox.querySelectorAll('li'), (_, index) => testRowHeight(index)).reduce((a, b) => a + b, 0) + 43;
    Object.defineProperty(testUsageBox, 'scrollHeight', { get: testNaturalHeight });
    Object.defineProperty(testUsageBox, 'clientHeight', { get() {
      const cap = parseFloat(this.style.maxHeight) || ${staticLimit};
      return cap ? Math.min(testNaturalHeight(), cap - 2) : testNaturalHeight();
    } });
    testUsageBox.getBoundingClientRect = () => ({ top: 100, bottom: 102 + testUsageBox.clientHeight });
    const testOriginalQuery = testUsageBox.querySelectorAll.bind(testUsageBox);
    testUsageBox.querySelectorAll = selector => {
      const found = testOriginalQuery(selector);
      if (selector === 'ul > li') found.forEach((row, index) => {
        row.getBoundingClientRect = () => {
          const top = 150 + Array.from({ length: index }, (_, i) => testRowHeight(i)).reduce((a, b) => a + b, 0) - testUsageBox.scrollTop;
          return { top, bottom: top + testRowHeight(index) };
        };
      });
      return found;
    };
  </script>`);
  return mountedPanel($.html(), vi.fn(), { style: () => ({ paddingBottom: '12px', borderBottomWidth: '1px' }) });
}

describe('V296 Credentials usage box', () => {
  it('follows all 13 credentials and Delete all API keys outside collapsed content', () => {
    const mounted = panel(9);
    const box = mounted.query('[data-language-model-usage]')!;
    const screen = mounted.query('#credentials-screen')!;
    expect(screen.querySelectorAll('.credential-row')).toHaveLength(13);
    const siblings = screen.children;
    const actions = screen.querySelector('.credentials-actions')!;
    expect(actions.querySelector('[data-action="kren.deleteAllApiKeys"]')?.textContent).toBe('Delete all API keys');
    expect(siblings.indexOf(box)).toBe(siblings.indexOf(actions) + 1);
    expect(siblings.filter(node => node.classList.contains('credential-row')).every(node => siblings.indexOf(node) < siblings.indexOf(actions))).toBe(true);
    expect(box.closest('details')).toBeNull();
    expect(box.closest('[hidden], .hidden')).toBeNull();
    expect(box.getAttribute('tabindex')).toBe('0');
    box.focus();
    expect(mounted.document.activeElement).toBe(box);
    expect(mounted.query('#' + box.getAttribute('aria-labelledby'))?.textContent).toBe('Requests today');
    expect(html(9)).toMatch(/\[data-language-model-usage\]:focus-visible\s*\{[^}]*outline: 2px solid var\(--vscode-focusBorder\)/u);
    expect(html(9)).toMatch(/\[data-language-model-usage\]\s*\{[^}]*border: 1px solid/u);
  });

  it.each([0, 1, 8])('keeps %i rows at natural height without a scrollbar', count => {
    const mounted = panel(count);
    const box = mounted.query('[data-language-model-usage]')!;
    expect(box.scrollHeight).toBe(box.clientHeight);
    expect((box.style as { maxHeight?: string }).maxHeight).toBe('');
    if (!count) expect(box.textContent).toContain('No language-model requests today.');
  });

  it('measures eight wrapped rows and allows scrolling to row nine', () => {
    const mounted = panel(9);
    const box = mounted.query('[data-language-model-usage]')!;
    const eighth = box.querySelectorAll('ul > li')[7]!;
    expect(parseFloat((box.style as typeof box.style & { maxHeight: string }).maxHeight)).toBe(eighth.getBoundingClientRect().bottom - box.getBoundingClientRect().top + 13);
    expect(box.scrollHeight).toBeGreaterThan(box.clientHeight);
    expect(html(9)).toMatch(/\[data-language-model-usage\]\s*\{[^}]*overflow-y: auto/u);
    box.scrollTop = box.scrollHeight - box.clientHeight;
    const ninth = box.querySelectorAll('ul > li')[8]!;
    expect(ninth.textContent).toContain('model-9');
    expect(ninth.getBoundingClientRect().bottom).toBeLessThanOrEqual(box.getBoundingClientRect().bottom);
    const previous = (box.style as typeof box.style & { maxHeight: string }).maxHeight;
    mounted.browserEvent('resize', {});
    expect((box.style as typeof box.style & { maxHeight: string }).maxHeight).toBe(previous);
    mounted.evaluate('testWrap = 2');
    mounted.browserEvent('resize', {});
    expect(parseFloat((box.style as typeof box.style & { maxHeight: string }).maxHeight)).toBeGreaterThan(parseFloat(previous));
  });

  it('preserves the focused box, accessible name and height rule on live updates', () => {
    const mounted = panel(8);
    const box = mounted.query('[data-language-model-usage]')!;
    box.focus();
    mounted.message({ command: 'languageModelUsage', html: renderLanguageModelUsage(rows(9)) });
    expect(mounted.query('[data-language-model-usage]')).toBe(box);
    expect(mounted.document.activeElement).toBe(box);
    expect(mounted.query('#' + box.getAttribute('aria-labelledby'))?.textContent).toBe('Requests today');
    expect(box.scrollHeight).toBeGreaterThan(box.clientHeight);
    mounted.message({ command: 'languageModelUsage', html: renderLanguageModelUsage(rows(8)) });
    expect(box.scrollHeight).toBe(box.clientHeight);
    expect((box.style as typeof box.style & { maxHeight: string }).maxHeight).toBe('');
  });
});

function recorder() {
  const usage = new LanguageModelUsageRecorder({ get: <T>(_key: string, fallback: T) => fallback,
    update: async () => {} }, () => {});
  configureLanguageModelUsage(usage);
  return usage;
}

class Socket implements TutorLiveSocket {
  readyState = 1;
  private listeners = new Map<string, Array<(event: TutorLiveSocketEvent) => void>>();
  send() {}
  close() {}
  addEventListener(type: string, listener: (event: TutorLiveSocketEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, value?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data: JSON.stringify(value) });
  }
}

describe('V296 Gemini usage profiles', () => {
  it('records Gemini Paid picture usage', async () => {
    const usage = recorder();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AQI=' } }] } }]
    }))));
    await generateSituationPicture('A room.', ['unit', 'credential'].join('-'), new AbortController().signal);
    expect(usage.today()).toEqual([expect.objectContaining({ provider: 'gemini', geminiProfile: 'pro', requests: 1 })]);
  });

  it.each(['standard', 'pro'] as const)('records the selected Live profile %s', async geminiProfile => {
    const usage = recorder();
    const socket = new Socket();
    const session = new TutorLiveSession({ apiKey: ['unit', 'credential'].join('-'), model: 'gemini-live',
      geminiProfile, systemInstruction: 'Speak English.', socketFactory: () => socket, onText() {}, onAudio() {} });
    try {
      const connected = session.connect();
      socket.emit('open');
      socket.emit('message', { setupComplete: {} });
      await connected;
      const turn = session.sendTurn('Hello.');
      socket.emit('message', { serverContent: { outputTranscription: { text: 'Hello.' }, turnComplete: true } });
      await turn;
      expect(usage.today()).toEqual([expect.objectContaining({ geminiProfile, requests: 1 })]);
    } finally { session.close(); }
  });

  it('labels Free Tier, Paid, and historical Gemini rows and escapes the model', () => {
    const $ = load(renderLanguageModelUsage([
      ...rows(2), { provider: 'gemini', model: '<historical>', requests: 1, input: 0, output: 0, thinking: 0 }
    ]));
    expect($('li strong').map((_, node) => $(node).text()).get()).toEqual([
      'Gemini Free Tier model-1', 'Gemini Paid model-2', 'Gemini Free Tier <historical>'
    ]);
    expect($('historical')).toHaveLength(0);
  });

  // Changed 2026-10-23 (V306, verification R30): evaluate the Live profile selection, including Replay's captured value, rather than pinning the old text-route expression.
  it.each(['Conversation', 'Replay', 'Demo', 'Settings'])('passes the selected Live profile at the %s construction boundary', name => {
    const filename = `src/resultsView${name}.ts`;
    const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
    const constructions: ts.ObjectLiteralExpression[] = [];
    const visit = (node: ts.Node) => {
      if ((ts.isNewExpression(node) && node.expression.getText(source) === 'TutorLiveSession') ||
          (ts.isCallExpression(node) && node.expression.getText(source) === 'createTutorReadOnlySession')) {
        const argument = node.arguments?.[0];
        if (argument && ts.isObjectLiteralExpression(argument)) constructions.push(argument);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(constructions.length).toBeGreaterThan(0);
    for (const argument of constructions) {
      const profile = argument.properties.find(property => property.name?.getText(source) === 'geminiProfile');
      expect(profile).toBeDefined();
      let expression = profile && ts.isPropertyAssignment(profile) ? profile.initializer : undefined;
      if (profile && ts.isShorthandPropertyAssignment(profile)) {
        const capture = (node: ts.Node) => {
          if (ts.isVariableDeclaration(node) && node.name.getText(source) === profile.name.getText(source)) expression = node.initializer;
          ts.forEachChild(node, capture);
        };
        capture(source);
      }
      expect(expression).toBeDefined();
      for (const liveProfile of ['standard', 'pro', undefined]) {
        const textProfile = liveProfile === 'standard' ? 'pro' : 'standard';
        expect(runInNewContext(expression!.getText(source), {
          view: { actions: { settings: () => ({ tutorLiveProfile: liveProfile, tutorProfile: textProfile }) } },
          tutorLanguageModelRoute: () => ({ geminiProfile: textProfile })
        })).toBe(liveProfile ?? 'standard');
      }
    }
  });
});
