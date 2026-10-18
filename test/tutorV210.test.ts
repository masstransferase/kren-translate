// 2026-10-11: transcript patches now share the shipped local navigation/review-state helper.
import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { load } from 'cheerio';
import { parse } from 'postcss';
import { renderKrenResultViewHtml, renderTutorConversation, renderTutorExercises } from '../src/resultViewHtml.js';
import { createTutorViewState } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const page = () => renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', activeScreen: 'tutor',
  tutor: createTutorViewState(), settings: PANEL_SETTINGS_FIXTURE, proModels: [] });
const html = page();
const css = parse(load(html)('style').text());
const script = load(html)('script').text();
function declarations(selector: string) {
  const values: Record<string, string> = {};
  css.walkRules(rule => {
    if (rule.selectors.includes(selector)) rule.walkDecls(decl => { values[decl.prop] = decl.value; });
  });
  return values;
}
function panelFunction(name: string) {
  const start = script.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  return script.slice(start, script.indexOf('\n    }', start) + 6);
}
function practice() {
  const state = createTutorViewState();
  state.exerciseSet = { exercises: [{ id: 'one', prompt: 'Ask politely.', targetIds: [] }] } as never;
  return state;
}

// A small mounted DOM for running the actual webview patch functions.
class Element {
  attributes = new Map<string, string>();
  children: Element[] = [];
  parent?: Element;
  className = ''; textContent = ''; value = ''; hidden = false; disabled = false; title = '';
  classList = {
    toggle: (name: string, on: boolean) => {
      const names = new Set(this.className.split(/\s+/u).filter(Boolean));
      if (on) names.add(name); else names.delete(name);
      this.className = [...names].join(' ');
    },
    remove: (name: string) => this.classList.toggle(name, false)
  };
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  append(child: Element) { child.parent = this; this.children.push(child); return child; }
  after(child: Element) { child.parent = this.parent; this.parent?.children.splice(this.parent.children.indexOf(this) + 1, 0, child); }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  querySelector(selector: string): Element | null {
    const match = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/u);
    for (const child of this.children) {
      if (match && child.attributes.has(match[1]!) && (match[2] === undefined || child.getAttribute(match[1]!) === match[2])) return child;
      const found = child.querySelector(selector); if (found) return found;
    }
    return null;
  }
  closest(selector: string): Element | null {
    if (this.className.split(' ').includes(selector.slice(1))) return this;
    return this.parent?.closest(selector) ?? null;
  }
}
class Button extends Element {}
class Textarea extends Element {}

describe('V210 tutor review findings', () => {
  it('1: all named tutor text boxes use the readable field border and retain disabled fading', () => {
    for (const selector of ['.tutor-map-search', '.tutor-conversation-custom textarea', '.tutor-conversation-answer',
      '.tutor-answer', '.tutor-prepared-prompt-text']) {
      expect(declarations(selector).border, selector).toBe('1px solid var(--kren-field-border)');
    }
    const $ = load(html);
    const state = practice();
    state.toolDrawer = { tool: 'dictionary', input: 'word', status: 'editing' };
    const drawer = load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', tutor: state,
      settings: PANEL_SETTINGS_FIXTURE, activeScreen: 'tutor', proModels: [] }));
    expect(drawer('[data-tutor-tool-input]').hasClass('tutor-answer')).toBe(true);
    expect($('[data-tutor-map-search]')).toHaveLength(1);
    expect(declarations('.setting-inactive').opacity).toBe('.5');
    expect(declarations('button:disabled').opacity).toBe('0.45');
  });

  it('2: search and conversation placeholders use full-opacity description text and the composer uses input colors', () => {
    for (const selector of ['.tutor-map-search::placeholder', '.tutor-conversation-answer::placeholder']) {
      expect(declarations(selector)).toMatchObject({ color: 'var(--vscode-descriptionForeground)', opacity: '1' });
    }
    expect(declarations('.tutor-conversation-answer')).toMatchObject({
      background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)'
    });
  });

  // 2026-10-10: both remote dictation routes must patch status without replacing the answer.
  it.each(['gemini', 'cloudflare'] as const)('3: %s practice transcription is visible beside the disabled microphone on render and patch, then removed without replacing the answer', provider => {
    const state = practice(); state.speech.transcribingExerciseId = 'one'; state.speech.dictationProvider = provider;
    const $ = load(renderTutorExercises(state, provider, true, true));
    const status = $('[data-tutor-transcription-status]');
    expect(status.hasClass('tutor-action-status')).toBe(true);
    expect(status.attr('role')).toBe('status');
    expect(status.text()).toMatch(new RegExp(`${provider}.*transcribing`, 'iu'));
    expect(status.prev().attr('data-command')).toBe('dictateTutorExercise');
    expect(status.prev().is('[disabled]')).toBe(true);
    state.speech.transcribingExerciseId = undefined;
    expect(load(renderTutorExercises(state))('[data-tutor-transcription-status]')).toHaveLength(0);

    const root = new Element(); root.className = 'tutor-practice-panel';
    const answer = root.append(new Textarea()); answer.value = 'Unsent draft';
    const actions = root.append(new Element()); actions.className = 'tutor-item-actions';
    const microphone = actions.append(new Button());
    microphone.setAttribute('data-command', 'dictateTutorExercise'); microphone.setAttribute('data-tutor-exercise', 'one');
    const start = script.indexOf("if (message.command === 'tutorDictationState') {");
    const handler = script.slice(start, script.indexOf("if (message.command === 'tutorReplayAllState')", start));
    const patch = (message: Record<string, unknown>) => runInNewContext(panelFunction('updateTutorPracticeTranscription') + panelFunction('syncTutorReviewState') + handler, {
      message: { command: 'tutorDictationState', exerciseId: 'one', provider, ...message },
      HTMLElement: Element, HTMLButtonElement: Button, HTMLTextAreaElement: Textarea,
      document: { querySelectorAll: () => [microphone], querySelector: () => answer, createElement: () => new Element() },
      vscode: { postMessage: vi.fn() }, syncTutorReviewAvailability: vi.fn()
    });
    patch({ state: 'transcribing' });
    expect(microphone.disabled).toBe(true);
    expect(actions.querySelector('[data-tutor-transcription-status]')?.textContent).toMatch(new RegExp(`${provider}.*transcribing`, 'iu'));
    expect(answer.value).toBe('Unsent draft');
    patch({ state: 'idle', transcript: 'Dictated text' });
    expect(actions.querySelector('[data-tutor-transcription-status]')).toBeNull();
    expect(root.children[0]).toBe(answer); expect(answer.value).toContain('Dictated text');
    patch({ state: 'transcribing' }); patch({ state: 'idle' });
    expect(actions.querySelector('[data-tutor-transcription-status]')).toBeNull();
  });

  it('4: Live Voice, Windows Voice and tutor model selects have full-width rows at 600 px with Preview in the same control', () => {
    const selectors = ['[data-persist-id="tutor-voice"] .setting:has([data-tutor-conversation-live-voice])',
      '[data-persist-id="tutor-voice"] .setting:has([data-setting="tutor.readAloud.voice"])',
      '[data-llm-routing="tutor"] .setting:has([data-model-preset])'];
    for (const selector of selectors) {
      let matched = false;
      css.walkRules(rule => {
        if (!rule.selectors.includes(selector)) return;
        expect(rule.parent).toMatchObject({ name: 'media', params: '(max-width: 600px)' });
        expect(declarations(selector)['grid-template-columns']).toBe('minmax(0, 1fr)'); matched = true;
      });
      expect(matched, selector).toBe(true);
    }
    const $ = load(html);
    expect($('[data-tutor-conversation-live-voice]').siblings('[data-command="previewTutorGeminiVoice"]')).toHaveLength(1);
    expect(declarations('.setting-control').display).toBe('flex');
  });

  it('5: failed practice and conversation hints use the shared failure style, including conversation patches and recovery', () => {
    const state = practice(); state.exerciseHintFailures.one = 'The hint could not be written.';
    expect(load(renderTutorExercises(state))('.tutor-question-explanation .tutor-failure').text()).toMatch(/hint.*could not/iu);
    Object.assign(state.conversation, { status: 'active', hintFailure: 'The hint could not be written.' });
    expect(load(renderTutorConversation(state))('[data-tutor-hint-explanation]').hasClass('tutor-failure')).toBe(true);
    const block = new Element();
    const explanation = block.append(new Element()); explanation.setAttribute('data-tutor-hint-explanation', '');
    const example = block.append(new Element()); example.setAttribute('data-tutor-hint-example', '');
    const text = example.append(new Element()); text.setAttribute('data-tutor-hint-example-text', '');
    const answer = new Textarea(); answer.value = 'Unsent draft';
    const patch = (message: Record<string, unknown>) => runInNewContext(panelFunction('updateTutorConversationHint') + '\nupdateTutorConversationHint(message);', {
      message, HTMLElement: Element, HTMLParagraphElement: Element, HTMLButtonElement: Button,
      document: { querySelector: (selector: string) => selector === '[data-tutor-hint]' ? block : answer }
    });
    patch({ failure: 'The hint could not be written.' }); expect(explanation.className).toContain('tutor-failure');
    patch({ busy: true }); expect(explanation.className).not.toContain('tutor-failure');
    patch({ hint: { explanation: 'Use a polite request.', example: 'Could you help?' } });
    expect(explanation.className).not.toContain('tutor-failure'); expect(example.hidden).toBe(false);
    patch({ failure: 'Failed again.' }); patch({ clear: true });
    expect(explanation.className).not.toContain('tutor-failure'); expect(block.hidden).toBe(true);
    expect(answer.value).toBe('Unsent draft');
  });

  it('6: the prepared prompt uses panel input colors and the readable border', () => {
    expect(declarations('.tutor-prepared-prompt-text')).toMatchObject({ background: 'var(--vscode-input-background)',
      color: 'var(--vscode-input-foreground)', border: '1px solid var(--kren-field-border)' });
  });

  it('7: tutor notices use the readable warning edge and failures retain the error edge', () => {
    for (const selector of ['.tutor-message', '.tutor-warning']) {
      expect(declarations(selector)['border-left']).toBe('3px solid var(--vscode-editorWarning-foreground)');
    }
    expect(declarations('.tutor-failure')['border-left-color']).toContain('--vscode-notificationsErrorIcon-foreground');
  });

  it('8: tutor busy cancel controls stay on one line in a viewport-bounded card', () => {
    expect(declarations('[data-active-screen="tutor"] .busy-card > button')).toMatchObject({ 'white-space': 'nowrap', flex: '0 0 auto' });
    expect(declarations('[data-active-screen="tutor"] .busy-card')['max-width']).toBe('min(480px, calc(100vw - 64px))');
  });

  it('9: tutor voice and routing labels use Title Case, including repeated summary labels', () => {
    const $ = load(html);
    const titles = $('[data-persist-id="tutor-voice"] .setting-title, [data-llm-routing="tutor"] .setting-title').map((_, node) => $(node).text()).get();
    for (const title of ['Thorough model', 'Fallback Tutor Model', 'Image Model', 'Fast model', 'Live Model', 'Live Voice', 'Windows Voice', 'Edge TTS Voice']) {
      expect(titles).toContain(title);
    }
    // 2026-10-11: V221 specifies sentence case for the Fast and Thorough model roles.
    for (const title of titles) {
      if (/^(?:Fast|Thorough) model/u.test(title)) expect(title).toMatch(/^(?:Fast|Thorough) model(?: Identifier)?$/u);
      else expect(title).toBe(title.replace(/\b[a-z]/gu, letter => letter.toUpperCase()));
    }
    const summaries = $('[data-persist-id="tutor-setting"] .rewrite-group-summary').text();
    for (const label of ['Fast model:', 'Live Model:', 'Live Voice:']) expect(summaries).toContain(label);
    expect(summaries).not.toMatch(/(?:Hint model|Live model|Live voice|Windows voice)/u);
  });

  it('10: unchecked picture-text decisions preserve transparent feedback and the existing 20 percent balloon transparency', () => {
    expect(declarations('.tutor-turn-feedback')['text-shadow']).toBeUndefined();
    expect(declarations('.tutor-turn-feedback').background).toBeUndefined();
    expect(declarations('.tutor-chat-viewport-picture[data-tutor-balloon-transparency="20"] .tutor-chat-learner::before').opacity).toBe('0.8');
  });
});
