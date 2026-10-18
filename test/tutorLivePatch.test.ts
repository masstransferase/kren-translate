// Changed 2026-10-18: V263, owner item I43, the in-chat microphone owns state and replaces the lower control.
// Added 2026-09-19 after the owner's first Talk conversation in 1.64.0: each Live reply's first
// sentence got a new bubble and its later sentences were appended to the opening bubble. A full
// re-render from host state showed the right order, so the fault was the panel's live patch.
// These tests run the panel's own patch functions against a minimal fake document.
import { runInNewContext } from 'node:vm';
import { load } from 'cheerio';
import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  commands: { executeCommand: vi.fn() },
  env: { remoteName: undefined },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) }
}));
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { liveTranscriptFragment } from '../src/resultsView.js';
import { createTutorViewState } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

class FakeElement {
  public readonly attributes = new Map<string, string>();
  public readonly children: FakeElement[] = [];
  public parent: FakeElement | undefined;
  public className = '';
  public hidden = false;
  public disabled = false;
  public title = '';
  public innerHTML = '';
  public readonly classList = {
    contains: (name: string) => this.className.split(/\s+/u).includes(name),
    toggle: (name: string, enabled: boolean) => {
      this.classList.remove(name);
      if (enabled) this.className += ' ' + name;
    },
    remove: (name: string) => {
      this.className = this.className.split(/\s+/u).filter((entry) => entry && entry !== name).join(' ');
    }
  };
  private text = '';
  public constructor(public readonly tagName: string) {}
  public cloneNode(deep: boolean): FakeElement {
    const clone = new FakeElement(this.tagName);
    for (const [name, value] of this.attributes) clone.setAttribute(name, value);
    clone.className = this.className;
    clone.title = this.title;
    clone.disabled = this.disabled;
    clone.innerHTML = this.innerHTML;
    if (deep) clone.append(...this.children.map((child) => child.cloneNode(true)));
    return clone;
  }
  public setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  public getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  public hasAttribute(name: string): boolean { return this.attributes.has(name); }
  public removeAttribute(name: string): void { this.attributes.delete(name); }
  public appendChild(child: FakeElement): FakeElement {
    // Changed 2026-10-18: V263, owner item I43, model native DOM moves for the persistent control.
    child.remove();
    child.parent = this;
    this.children.push(child);
    return child;
  }
  public append(...children: FakeElement[]): void {
    for (const child of children) this.appendChild(child);
  }
  public remove(): void {
    if (!this.parent) return;
    const siblings = this.parent.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parent = undefined;
  }
  public replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length);
    this.text = '';
    this.append(...children);
  }
  public replaceWith(next: FakeElement): void {
    const siblings = this.parent!.children;
    siblings[siblings.indexOf(this)] = next;
    next.parent = this.parent;
  }
  // 2026-10-01: V181 can move the retained image between the fixed layer and storyboard.
  public insertBefore(child: FakeElement, before: FakeElement): void { child.remove(); before.before(child); }
  public before(next: FakeElement): void {
    if (!this.parent) return;
    const siblings = this.parent.children;
    next.parent = this.parent;
    siblings.splice(siblings.indexOf(this), 0, next);
  }
  public get textContent(): string {
    return this.children.length ? this.children.map((child) => child.textContent).join('') : this.text;
  }
  public set textContent(value: string) { this.children.length = 0; this.text = value; }
  private descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
  private matches(selector: string): boolean {
    if (selector.includes(',')) return selector.split(',').some((part) => this.matches(part.trim()));
    if (selector.startsWith('button[')) return this.tagName === 'button' && this.matches(selector.slice(6));
    if (selector.startsWith('.')) return this.className.split(/\s+/u).includes(selector.slice(1));
    const valuedAttribute = /^\[([\w-]+)="([^"]*)"\]$/u.exec(selector);
    if (valuedAttribute) return this.attributes.get(valuedAttribute[1]!) === valuedAttribute[2];
    const attribute = /^\[([\w-]+)\]$/u.exec(selector);
    if (attribute) return this.attributes.has(attribute[1]!);
    return this.tagName === selector;
  }
  public querySelectorAll(selector: string): FakeElement[] {
    return this.descendants().filter((element) => element.matches(selector));
  }
  public querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  public closest(selector: string): FakeElement | null {
    return this.matches(selector) ? this : this.parent?.closest(selector) ?? null;
  }
}

// Changed 2026-10-04: isolated patch tests load the shared text segmenter and safe DOM composer.
function withMarkingHelpers(script: string, body: string): string {
  if (!body.includes('patchTutorMarkedText(')) return body;
  const start = script.indexOf('const tutorTextSegments =');
  const helper = script.indexOf('function patchTutorMarkedText(');
  const end = script.indexOf('\n    }\n', helper) + 6;
  return script.slice(start, end).replace('const tutorTextSegments', 'var tutorTextSegments') + '\n' + body;
}

function optionalPanelFunction(name: string): string {
  const script = panelScript();
  const start = script.indexOf(`function ${name}(`);
  return start < 0 ? `function ${name}() {}` : withMarkingHelpers(script, script.slice(start, script.indexOf('\n    }\n', start) + 6));
}

function panelScript(): string {
  const state = createTutorViewState();
  Object.assign(state.conversation, { status: 'active', replies: 'liveGemini', speakerOn: true });
  const html = renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
    activeScreen: 'tutor', tutor: state, proModels: [] });
  return [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gu)]
    .map((match) => match[1]).join('\n');
}

function panelFunction(name: string): string {
  const script = panelScript();
  const start = script.indexOf(`function ${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return withMarkingHelpers(script, script.slice(start, script.indexOf('\n    }\n', start) + 6));
}

function fakePanel() {
  const transcript = new FakeElement('div');
  transcript.setAttribute('data-tutor-transcript', '');
  const document = {
    querySelector: (selector: string) => selector === '[data-tutor-transcript]' ? transcript : null,
    createTextNode: (text: string) => { const node = new FakeElement('#text'); node.textContent = text; return node; },
    createElement: (tag: string) => new FakeElement(tag)
  };
  const HTMLParagraphElement = FakeElement;
  const HTMLElement = FakeElement;
  const postMessage = vi.fn();
  const build = (name: string) => new Function(
    'document', 'HTMLElement', 'HTMLParagraphElement', 'vscode',
    `${panelFunction('hideTutorChatMicrophone')}\nfunction syncTutorPictureMicrophone() {}\n${panelFunction('tutorPictureMicrophoneMode')}\n${panelFunction(name)}\nreturn ${name};`
  )(document, HTMLElement, HTMLParagraphElement, { postMessage }) as
    (message: { text: string; reset?: boolean; started?: boolean }) => void;
  return {
    transcript, postMessage,
    appendReply: build('appendTutorLiveReply'), appendInput: build('appendTutorLiveInput')
  };
}

function bubbleTexts(transcript: FakeElement): string[] {
  // Changed 2026-10-18: V263, owner item I43, persistent microphone controls are not transcript words.
  return transcript.children.filter(child => !child.hasAttribute('data-tutor-chat-microphone')).map((child) => child.textContent);
}

describe('V204 target highlights in the mounted page', () => {
  it('renders opening and current question marks with correction overlap and escapes HTML-looking target text', () => {
    const state = createTutorViewState();
    Object.assign(state.conversation, { status: 'active', replies: 'standard', currentQuestion: '<Could you> wait?',
      currentQuestionTargetMarks: [{ field: 'nextQuestion', targetId: 'p', quote: '<Could you>', occurrence: 0 }],
      transcript: [{ question: 'Could you help?', learnerAnswer: 'Help.', move: 'reaction', reply: '<Could you> help?',
        replyQuote: 'you> help', correction: 'Please help.', explanation: 'Polite.',
        questionTargetMarks: [{ field: 'opening', targetId: 'p', quote: 'Could you', occurrence: 0 }],
        targetMarks: [{ field: 'reply', targetId: 'p', quote: '<Could you>', occurrence: 0 }] }] });
    const $ = load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
      activeScreen: 'tutor', tutor: state, proModels: [] }));
    expect($('[data-tutor-target-use]').map((_, node) => $(node).text()).get().join('')).toBe('Could you<Could you><Could you>');
    expect($('[data-tutor-reply-quote]').map((_, node) => $(node).text()).get().join('')).toBe('you> help');
    expect($('[data-tutor-transcript] could')).toHaveLength(0);
    // Changed 2026-10-18: V263, owner item I43, conversation text input is absent.
    expect($('[data-tutor-conversation-answer]')).toHaveLength(0);
    expect($('style').text()).toMatch(/\.tutor-target-use\s*\{[^}]*color:\s*var\(--vscode-textLink-foreground\);[^}]*text-decoration:\s*underline;[^}]*background:\s*none;/u);
    expect($('[data-tutor-target-use][style]')).toHaveLength(0);
  });
  it('keeps one streamed reply and the mounted answer while fragments gain local target ranges', () => {
    const panel = pictureMicrophonePanel();
    const composer = panel.composer;
    panel.call('appendTutorLiveReply', { text: '😀 <Could', reset: true, targetRanges: [] });
    panel.call('appendTutorLiveReply', { text: ' you> help?', targetRanges: [{ start: 3, end: 14 }] });
    const reply = panel.transcript.querySelector('[data-tutor-reply-bubble]')!;
    expect(reply.textContent).toBe('😀 <Could you> help?');
    expect(reply.querySelector('[data-tutor-target-use]')!.textContent).toBe('<Could you>');
    expect(panel.composer).toBe(composer);
    expect(reply.querySelector('Could')).toBeNull();
    panel.call('appendTutorLiveReply', { text: ' Please.', targetRanges: [{ start: 3, end: 14 }] });
    expect(panel.transcript.querySelectorAll('[data-tutor-reply-bubble]')).toHaveLength(1);
    expect(reply.textContent).toBe('😀 <Could you> help? Please.');
  });
});

// 2026-10-01: Run the real Live patches and delegated click handler against a decoded picture.
function pictureMicrophonePanel(options: {
  active?: boolean; live?: boolean; listening?: boolean; pressToTalk?: boolean; available?: boolean;
  pictureMode?: 'none' | 'intro' | 'switching' | 'graduallyEntering';
} = {}) {
  class Select extends FakeElement { public value = 'liveGemini'; }
  class Button extends FakeElement {}
  class Picture extends FakeElement {
    public complete = false;
    public naturalWidth = 0;
    public listeners = new Map<string, () => void>();
    public set src(value: string) {
      this.setAttribute('src', value);
      this.complete = false;
      this.naturalWidth = 0;
    }
    public addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); }
  }
  // Preserve the button's DOM type when the production patch clones its SVG and attributes.
  Button.prototype.cloneNode = function (deep: boolean) {
    const clone = new Button('button');
    Object.assign(clone, { className: this.className, title: this.title, disabled: this.disabled, innerHTML: this.innerHTML });
    for (const [name, value] of this.attributes) clone.setAttribute(name, value);
    if (deep) clone.append(...this.children.map((child) => child.cloneNode(true)));
    return clone;
  };
  const state = createTutorViewState();
  Object.assign(state.conversation, {
    status: options.active === false ? 'stopped' : 'active',
    replies: options.live === false ? 'standard' : 'liveGemini', situationPicture: options.pictureMode ?? 'intro'
  });
  const html = renderKrenResultViewHtml({
    cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
    activeScreen: 'tutor', tutor: state, proModels: [],
    tutorLiveTalkAvailable: options.available !== false,
    tutorLiveTalkListening: options.listening === true,
    tutorLivePressToTalk: options.pressToTalk === true
  });
  const $ = load(html);
  const root = new FakeElement('section');
  for (const [name, value] of Object.entries($('[data-tutor-result="conversation"]').attr() ?? {})) {
    root.setAttribute(name, value);
  }
  const replies = root.appendChild(new Select('select')) as Select;
  replies.setAttribute('data-tutor-conversation-replies', '');
  replies.value = state.conversation.replies;
  const viewport = root.appendChild(new FakeElement('div'));
  viewport.setAttribute('data-tutor-picture-viewport', '');
  const picture = viewport.appendChild(new Picture('img')) as Picture;
  picture.setAttribute('data-tutor-picture', '');
  const column = viewport.appendChild(new FakeElement('div'));
  column.setAttribute('data-tutor-picture-column', '');
  const stack = column.appendChild(new FakeElement('div'));
  stack.className = 'tutor-picture-frames';
  const mode = root.appendChild(new Select('select')) as Select;
  mode.setAttribute('data-tutor-conversation-situation-picture', '');
  mode.value = options.pictureMode ?? 'intro';
  const transcript = viewport.appendChild(new FakeElement('div'));
  transcript.setAttribute('data-tutor-transcript', '');
  // Changed 2026-10-18: V263, owner item I43, the fixture renders the real microphone inside the transcript.
  const slot = transcript.appendChild(new FakeElement('div'));
  slot.setAttribute('data-tutor-chat-microphone', '');
  const composer = slot.appendChild(new Button('button')) as Button;
  for (const [name, value] of Object.entries($('[data-tutor-chat-mic-control]').attr() ?? {})) {
    composer.setAttribute(name, value);
  }
  composer.className = $('[data-tutor-chat-mic-control]').attr('class') ?? '';
  composer.title = $('[data-tutor-chat-mic-control]').attr('title') ?? '';
  composer.disabled = $('[data-tutor-chat-mic-control]').is('[disabled]');
  composer.innerHTML = $('[data-tutor-chat-mic-control]').html() ?? '';
  // Added 2026-10-02: V183 mirrors the actual composer Stop, including its disabled state.
  const stop = root.appendChild(composer.cloneNode(true));
  stop.removeAttribute('data-tutor-chat-mic-control');
  stop.setAttribute('data-command', 'stopTutorConversation');
  stop.setAttribute('data-tutor-composer-stop', '');
  stop.setAttribute('aria-label', 'Stop conversation');
  stop.title = 'Stop conversation';
  const chatStop = stop.cloneNode(true);
  chatStop.removeAttribute('data-tutor-composer-stop');
  chatStop.setAttribute('data-tutor-chat-stop', '');
  slot.appendChild(chatStop);
  slot.appendChild(composer);
  const glyph = composer.appendChild(new FakeElement('svg'));
  glyph.setAttribute('aria-hidden', 'true');
  const document = {
    querySelector: (selector: string) => selector === '[data-tutor-result="conversation"]'
      ? root : root.querySelector(selector),
    querySelectorAll: (selector: string) => root.querySelectorAll(selector),
    createTextNode: (text: string) => { const node = new FakeElement('#text'); node.textContent = text; return node; },
    createElement: (tag: string) => { const element = tag === 'button' ? new Button(tag) : new FakeElement(tag);
      Object.assign(element, { focus: vi.fn() }); return element; },
    addEventListener: (_name: string, listener: (event: unknown) => void) => { clickListener = listener; }
  };
  let clickListener: ((event: unknown) => void) | undefined;
  const postMessage = vi.fn();
  const script = $('script').text();
  const clickStart = script.indexOf("document.addEventListener('click',");
  const clickEnd = script.indexOf("window.addEventListener('message',", clickStart);
  const names = ['hideTutorChatMicrophone', 'tutorPictureMicrophoneMode', 'syncTutorPictureMicrophone',
    'syncTutorConversationPictureViewport', 'initializeTutorConversationPicture',
    'patchTutorConversationPicture', 'appendTutorLiveInput', 'commitTutorLiveInput', 'cancelTutorLiveTurn',
    'appendTutorLiveReply', 'updateTutorLiveTalk', 'markTutorLiveConversationReady',
    'commitTutorLiveTurn', 'updateTutorConversationStop', 'updateTutorTurnCheckAvailability',
    'discardTutorLiveInput', 'updateTutorReplayMode', 'updateTutorConversationReplay',
    'updateTutorConversationDiagnosis'];
  const context = {
    document, Element: FakeElement, HTMLElement: FakeElement, HTMLSelectElement: Select,
    HTMLButtonElement: Button, HTMLImageElement: Picture, HTMLParagraphElement: FakeElement,
    HTMLTextAreaElement: class {}, HTMLDetailsElement: class {},
    vscode: { postMessage }, activeScreen: 'tutor', window: { scrollY: 0 },
    savePanelState: vi.fn(), cancelTutorHandyAutoSend: vi.fn(), armTutorHandyAutoSend: vi.fn(),
    updateTutorLiveReplay: vi.fn(), syncTutorResetAvailability: vi.fn(),
    syncTutorStoryboardScroll: vi.fn(), checkTutorDevelopingPicture: vi.fn(),
    syncTutorConversationPictureSettings: vi.fn(), updateTutorConversationHint: vi.fn(),
    patchTutorLiveCoaching: vi.fn(), updateTutorPracticeTranscription: vi.fn()
  };
  runInNewContext(names.map(panelFunction).join('\n') + '\n' +
    script.slice(clickStart, clickEnd) + '\ninitializeTutorConversationPicture();', context);
  const call = (name: string, message: unknown = {}) =>
    runInNewContext(`${name}(message);`, { ...context, message });
  return {
    root, transcript, composer, stop, picture, viewport, replies, postMessage, html,
    createButton: () => new Button('button'),
    patchCoaching: (message: unknown) => runInNewContext(
      panelFunction('patchTutorLiveCoaching') + '\n' + panelFunction('patchLateTutorLiveCoaching') + '\npatchLateTutorLiveCoaching(message);',
      { ...context, message }
    ),
    // Changed 2026-10-18: V263, owner item I43, report the reachable microphone while the node persists during replies.
    chatButton: () => transcript.querySelector('[data-tutor-chat-microphone]')?.hidden ? null : transcript.querySelector('[data-command="dictateTutorConversation"]'),
    dictation: (message: unknown) => {
      const start = script.indexOf("if (message.command === 'tutorDictationState') {");
      const end = script.indexOf("if (message.command === 'tutorReplayAllState') {", start);
      runInNewContext(script.slice(start, end), { ...context, message: { command: 'tutorDictationState', ...message as object } });
    },
    call,
    load: () => {
      picture.src = 'data:image/png;base64,YQ==';
      picture.complete = true;
      picture.naturalWidth = 1;
      picture.listeners.get('load')?.();
    },
    click: (target: FakeElement) => clickListener?.({ target, preventDefault: vi.fn() })
  };
}

// 2026-10-10: Handy listening uses Pause in place, including the composer's in-chat mirror.
describe('V212 Handy pause microphone', () => {
  it.each(['practice', 'conversation'] as const)('patches %s Handy start and pause without replacing controls', (target) => {
    const panel = pictureMicrophonePanel({ live: false, pictureMode: 'none' });
    const practice = panel.createButton();
    practice.setAttribute('data-command', 'dictateTutorExercise');
    practice.setAttribute('data-tutor-exercise', 'answer-1');
    practice.innerHTML = panel.composer.innerHTML;
    panel.root.appendChild(practice);
    const chat = panel.chatButton()!;
    const buttons = target === 'practice' ? [practice] : [panel.composer, chat];
    const microphones = buttons.map((button) => button.innerHTML);
    const subject = target === 'practice' ? { exerciseId: 'answer-1' } : { conversation: true };
    panel.dictation({ ...subject, provider: 'handy', state: 'recording' });
    for (const button of buttons) {
      expect(load(button.innerHTML)('svg rect')).toHaveLength(2);
      expect(button.getAttribute('aria-label')).toMatch(/Pause.*dictation/u);
      expect(button.title).toMatch(/Pause.*dictation/u);
      expect(button.classList.contains('tutor-microphone-pulsing')).toBe(true);
      expect(button.getAttribute('aria-pressed')).toBe('true');
    }
    panel.click(buttons.at(-1)!);
    expect(panel.postMessage).toHaveBeenCalledWith(expect.objectContaining(target === 'practice'
      ? { command: 'dictateTutorExercise', exerciseId: 'answer-1' }
      : { command: 'dictateTutorConversation' }));
    panel.dictation({ ...subject, provider: 'handy', state: 'idle' });
    buttons.forEach((button, index) => {
      expect(load(button.innerHTML)('svg').toString()).toBe(load(microphones[index]!)('svg').toString());
      expect(button.getAttribute('aria-label')).toMatch(/Start.*dictation/u);
      expect(button.title).toMatch(/Start.*dictation/u);
      expect(button.classList.contains('tutor-microphone-pulsing')).toBe(false);
      expect(button.getAttribute('aria-pressed')).toBe('false');
    });
    expect(panel.chatButton()).toBe(chat);
    expect(panel.root.querySelector('[data-tutor-chat-mic-control]')).toBe(panel.composer);
    expect(practice.parent).toBe(panel.root);
  });

  it.each(['gemini', 'live'] as const)('keeps the %s active microphone glyph and labels', (provider) => {
    const panel = pictureMicrophonePanel({ live: provider === 'live', pictureMode: 'none' });
    const glyph = panel.composer.innerHTML;
    if (provider === 'live') panel.call('updateTutorLiveTalk', { available: true, listening: true });
    else panel.dictation({ conversation: true, provider, state: 'recording' });
    for (const button of [panel.composer, panel.chatButton()!]) {
      expect(load(button.innerHTML)('svg').toString()).toBe(load(glyph)('svg').toString());
      expect(button.getAttribute('aria-label')).toBe(provider === 'live'
        ? 'Stop talking' : 'Stop speaking your conversation answer with Gemini');
      expect(button.classList.contains('tutor-microphone-pulsing')).toBe(true);
    }
  });

  it('defines the gentle pulse in CSS and disables animation for reduced motion', () => {
    const css = load(pictureMicrophonePanel({ live: false }).html)('style').text();
    // Changed 2026-10-17: V261, F5 owner canvas edit, the listening pulse now takes two seconds per cycle.
    expect(css).toMatch(/\.icon-button\.tutor-microphone-pulsing\s*\{[^}]*animation:\s*kren-tutor-microphone-pulse\s+2s\s+ease-in-out\s+infinite/u);
    expect(css).toMatch(/@keyframes kren-tutor-microphone-pulse/u);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.icon-button\.tutor-microphone-pulsing\s*\{[^}]*animation:\s*none/u);
  });
});

describe('V185 conversation order', () => {
  it.each([true, false])('V212: no-picture microphone and Stop are reachable at each learner turn, live=%s', (live) => {
    const panel = pictureMicrophonePanel({ live, pictureMode: 'none' });
    const assertControls = () => {
      const slot = panel.transcript.children.at(-1)!;
      expect(slot).toBeDefined();
      expect(slot.hasAttribute('data-tutor-chat-microphone')).toBe(true);
      expect(slot.querySelector('[data-command="dictateTutorConversation"]')).not.toBeNull();
      expect(slot.querySelector('[data-tutor-chat-stop]')?.getAttribute('data-command')).toBe('stopTutorConversation');
      expect(slot.closest('details')).toBeNull();
      expect(panel.chatButton()?.tagName).toBe('button');
      expect(panel.chatButton()?.getAttribute('aria-label')).toBe(panel.composer.getAttribute('aria-label'));
      expect(panel.chatButton()?.disabled).toBe(panel.composer.disabled);
    };
    assertControls();
    panel.call('appendTutorLiveInput', { text: 'Hello.', reset: true });
    panel.call('commitTutorLiveInput', { text: 'Hello.', index: 0 });
    panel.call('appendTutorLiveReply', { text: 'Hello to you.', reset: true });
    panel.call('commitTutorLiveTurn', { index: 0 });
    assertControls();
  });
  it.each([true, false].flatMap((live) =>
    (['none', 'intro', 'switching', 'graduallyEntering'] as const).flatMap((pictureMode) =>
      [false, true].map((overlap) => ({ live, pictureMode, overlap })))))
  ('matches the full transcript after every patch: $live/$pictureMode/overlap=$overlap', ({ live, pictureMode, overlap }) => {
    const panel = pictureMicrophonePanel({ live, pictureMode });
    if (pictureMode !== 'none') panel.load();
    const opening = "Hey there, sorry, I'm in the middle of a quick count, but what are you looking for?";
    const answers = ["I'm looking for organic cream cheese without any flavor added and some bread.",
      'What type of loaf do you have? Anything freshly baked in the store?'];
    const replies = ['The organic cream cheese is in the dairy aisle, two rows over, and the bread is just past that. Are you looking for a specific kind of loaf?',
      'We have freshly baked sourdough and whole wheat loaves at the bakery counter right in front of you.'];
    let shownOpening = '';
    const shownAnswers: string[] = [];
    const shownReplies: string[] = [];
    const state = createTutorViewState();
    Object.assign(state.conversation, { status: 'active', replies: live ? 'liveGemini' : 'standard', situationPicture: pictureMode });
    const assertOrder = () => {
      // 2026-10-02: Project each partial message into the same stored turns used after Stop.
      state.conversation.transcript = shownAnswers.map((learnerAnswer, index) => ({
        question: index === 0 ? shownOpening : shownReplies[index - 1] ?? '', learnerAnswer,
        move: 'reaction', reply: shownReplies[index] ?? '', correction: '', explanation: '', coachingPending: true
      }));
      state.conversation.currentQuestion = shownAnswers.length ? '' : shownOpening;
      const $ = load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
        activeScreen: 'tutor', tutor: state, proModels: [] }));
      const fullOrder = $('[data-tutor-transcript] > [data-tutor-kren-bubble] > p, [data-tutor-transcript] > .tutor-chat-learner-turn > .tutor-chat-learner > [data-tutor-learner-answer]')
        .map((_index, element) => $(element).text()).get();
      const patchedOrder = panel.transcript.children.flatMap((child) => {
        const paragraph = child.querySelector('[data-tutor-learner-answer]') ??
          (child.hasAttribute('data-tutor-kren-bubble') ? child.querySelector('p') : null);
        return paragraph ? [paragraph.textContent] : [];
      });
      expect(patchedOrder).toEqual(fullOrder);
      return fullOrder;
    };
    const patch = (name: string, message: unknown) => { panel.call(name, message); assertOrder(); };
    shownOpening = opening;
    patch('appendTutorLiveReply', { text: opening, reset: true });
    patch('markTutorLiveConversationReady', {});
    shownAnswers[0] = answers[0]!;
    patch('appendTutorLiveInput', { text: answers[0], reset: true });
    patch('commitTutorLiveInput', { text: answers[0], index: 0 });
    shownReplies[0] = replies[0]!.slice(0, 80);
    patch('appendTutorLiveReply', { text: shownReplies[0], reset: true });
    if (overlap) {
      shownAnswers[1] = answers[1]!;
      patch('appendTutorLiveInput', { text: answers[1], reset: true });
      patch('commitTutorLiveInput', { text: answers[1], index: 1 });
    }
    shownReplies[0] = replies[0]!;
    patch('appendTutorLiveReply', { text: replies[0]!.slice(80) });
    patch('commitTutorLiveTurn', { index: 0, completedTurnGeneration: 1 });
    expect(panel.transcript.querySelector('[data-tutor-learner-turn="0"]')?.hasAttribute('data-tutor-pending')).toBe(false);
    if (!overlap) {
      shownAnswers[1] = answers[1]!;
      patch('appendTutorLiveInput', { text: answers[1], reset: true });
      patch('commitTutorLiveInput', { text: answers[1], index: 1 });
    }
    expect(panel.transcript.querySelector('[data-tutor-learner-turn="1"]')?.hasAttribute('data-tutor-pending')).toBe(true);
    shownReplies[1] = replies[1]!;
    patch('appendTutorLiveReply', { text: replies[1], reset: true });
    patch('commitTutorLiveTurn', { index: 1, completedTurnGeneration: 2 });
    state.conversation.status = 'stopped';
    expect(assertOrder()).toEqual([opening, answers[0], replies[0], answers[1], replies[1]]);
    expect(panel.root.querySelector('[data-tutor-chat-mic-control]')).toBe(panel.composer);
  });
});

describe('Live microphone in the shown situation picture', () => {
  // Added 2026-10-02: V183 tests the mirror and delegated command against the mounted document.
  it('V183 mirrors Stop immediately left of the microphone even without the picture', () => {
    // Changed 2026-10-10: V212 keeps the mirrored controls independent of pictures and reply mode.
    const panel = pictureMicrophonePanel();
    expect(panel.transcript.querySelector('[data-tutor-chat-stop]')).not.toBeNull();
    panel.load();
    const slot = panel.transcript.querySelector('[data-tutor-chat-microphone]')!;
    const stop = slot.querySelector('[data-tutor-chat-stop]')!;
    expect(slot.children[0]).toBe(stop);
    expect(slot.children[1]).toBe(panel.chatButton());
    expect(stop.getAttribute('data-command')).toBe('stopTutorConversation');
    panel.call('updateTutorConversationStop', { disabled: true, title: 'Stop is available when this turn finishes' });
    expect(stop.disabled).toBe(true);
    expect(stop.title).toBe(panel.stop.title);
    panel.click(stop);
    expect(panel.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'stopTutorConversation' }));
    panel.call('updateTutorConversationStop', { disabled: false });
    panel.click(stop);
    expect(panel.postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'stopTutorConversation' }));
    panel.viewport.classList.remove('tutor-chat-viewport-picture');
    panel.call('syncTutorPictureMicrophone');
    expect(panel.transcript.querySelector('[data-tutor-chat-stop]')).not.toBeNull();
    expect(panel.chatButton()).not.toBeNull();
  });

  it('V183 sends one Retry command with its turn index and replaces the failure in place', () => {
    // Changed 2026-10-10: V212 keeps the mirrored controls independent of pictures and reply mode.
    const panel = pictureMicrophonePanel();
    const turn = panel.transcript.appendChild(new FakeElement('div'));
    turn.setAttribute('data-tutor-learner-turn', '0');
    panel.patchCoaching({ index: 0, coachingFailed: true });
    const retry = turn.querySelector('[data-command="retryTutorTurnCheck"]')!;
    expect(retry.getAttribute('aria-label')).toBe('Check this turn again');
    expect(retry.title).toBe('Check this turn again');
    expect((retry as unknown as { innerHTML: string }).innerHTML).toContain('<svg');
    panel.call('updateTutorTurnCheckAvailability', { replyInProgress: true });
    expect(retry.disabled).toBe(true);
    panel.click(retry);
    expect(panel.postMessage).not.toHaveBeenCalled();
    panel.call('updateTutorTurnCheckAvailability', { replyInProgress: false });
    panel.click(retry);
    panel.click(retry);
    expect(panel.postMessage).toHaveBeenCalledTimes(1);
    expect(panel.postMessage).toHaveBeenCalledWith({ command: 'retryTutorTurnCheck', input: '0' });
    panel.patchCoaching({ index: 0, coachingFailed: true, coachingPending: true });
    const pending = turn.querySelector('[data-command="retryTutorTurnCheck"]')!;
    panel.call('updateTutorTurnCheckAvailability', { replyInProgress: false });
    expect(pending.disabled).toBe(true);
    panel.patchCoaching({ index: 0, coachingFailed: false, feedbackEligible: true,
      correction: 'I went yesterday.', explanation: 'Use past tense.', showFeedback: true });
    expect(turn.querySelector('[data-tutor-coaching-failed]')).toBeNull();
    expect(turn.querySelector('[data-tutor-correction]')?.textContent).toBe('I went yesterday.');
    expect(panel.transcript.children).toContain(turn);
    panel.patchCoaching({ index: 0, coachingFailed: true });
    expect(turn.querySelector('[data-command="retryTutorTurnCheck"]')?.disabled).toBe(false);
  });

  it.each(['나 지금 20분 뒤에.', '네.', '你好。', '¿Cómo se llama tu papá?'])('V184 replaces finalized foreign input with one faint note: %s', (text) => {
    const panel = pictureMicrophonePanel();
    panel.call('appendTutorLiveInput', { text, reset: true });
    const turn = panel.transcript.querySelector('[data-tutor-live-input]')!;
    panel.call('commitTutorLiveInput', { text, index: 0, learnerNotShown: true });
    expect(panel.transcript.children[0]).toBe(turn);
    expect(turn.querySelector('.tutor-chat-learner')).toBeNull();
    expect(turn.querySelector('[data-tutor-learner-not-shown]')?.textContent).toBe('Not in English, so not shown.');
    expect(turn.textContent).not.toContain(text);
    panel.call('appendTutorLiveReply', { text: 'Please tell me more.', reset: true });
    panel.call('commitTutorLiveTurn', { index: 0, learnerNotShown: true, answeredTurnCount: 0, skippedTurnCount: 0 });
    expect(turn.querySelectorAll('[data-tutor-learner-not-shown]')).toHaveLength(1);
    expect(turn.querySelector('[data-tutor-correction]')).toBeNull();
    expect(turn.querySelector('.tutor-rephrase-action')).toBeNull();
    // 2026-10-02: V187 removes the reply as well as the hidden learner's words.
    expect(panel.transcript.querySelector('[data-tutor-kren-bubble]')).toBeNull();
  });

  it.each(['How do I say 안녕하세요 in English?', 'How do you translate gracias?', 'Yes.', '¡Yes!', '¿OK?'])('V184 keeps shown input in the live patch: %s', (text) => {
    const panel = pictureMicrophonePanel();
    panel.call('appendTutorLiveInput', { text, reset: true });
    panel.call('commitTutorLiveInput', { text, index: 0, learnerNotShown: false });
    expect(panel.transcript.querySelector('[data-tutor-learner-answer]')?.textContent).toBe(text);
    expect(panel.transcript.querySelector('[data-tutor-learner-not-shown]')).toBeNull();
  });

  // Changed 2026-10-15: V241, owner item I6, active patches never reveal review actions.
  it('V184b keeps review actions unavailable through hidden and shown active patches', () => {
    const panel = pictureMicrophonePanel();
    const actions = panel.root.appendChild(new FakeElement('div'));
    actions.setAttribute('data-tutor-conversation-actions', '');
    actions.hidden = true;
    for (let index = 0; index < 10; index += 1) {
      const hidden = index < 5;
      const text = hidden ? '네.' : 'Yes.';
      panel.call('appendTutorLiveInput', { text, reset: true });
      panel.call('commitTutorLiveInput', { text, index, learnerNotShown: hidden });
      panel.call('appendTutorLiveReply', { text: 'Please tell me more.', reset: true });
      panel.call('commitTutorLiveTurn', {
        index, learnerNotShown: hidden, answeredTurnCount: Math.max(0, index - 4), skippedTurnCount: 0
      });
      expect(actions.hidden).toBe(true);
      expect(actions.querySelector('[data-command="diagnoseTutorConversation"]') !== null).toBe(false);
      expect(panel.root.querySelector('[data-tutor-chat-mic-control]')).toBe(panel.composer);
    }
    expect(panel.transcript.querySelectorAll('[data-tutor-learner-not-shown]')).toHaveLength(5);
    expect(panel.transcript.querySelectorAll('[data-tutor-learner-answer]')).toHaveLength(5);
  });

  it('V183 removes the provisional input for a discarded tiny transcript without removing KREN replies', () => {
    const panel = pictureMicrophonePanel();
    panel.call('appendTutorLiveInput', { text: 'I.', reset: true });
    panel.call('appendTutorLiveReply', { text: 'Say it again?', reset: true });
    panel.call('discardTutorLiveInput');
    expect(panel.transcript.querySelector('[data-tutor-live-input]')).toBeNull();
    expect(panel.transcript.querySelector('[data-tutor-kren-bubble]')?.textContent).toBe('Say it again?');
  });

  // 2026-10-02: V186b archives the partial reply, so its ready patch must keep the same text.
  it('V186b keeps an interrupted reply to I. identical to its archived full render', () => {
    const panel = pictureMicrophonePanel();
    panel.call('appendTutorLiveInput', { text: 'I.', reset: true });
    panel.call('appendTutorLiveReply', { text: 'Could you repeat that?', reset: true });
    panel.call('discardTutorLiveInput');
    panel.call('markTutorLiveConversationReady', { talkAvailable: true, replayAvailable: false });
    expect(panel.transcript.querySelector('[data-tutor-live-input]')).toBeNull();
    expect(panel.transcript.querySelector('[data-tutor-live-reply]')).toBeNull();
    const state = createTutorViewState();
    Object.assign(state.conversation, { status: 'stopped', replies: 'liveGemini',
      unansweredReplies: [{ beforeTurn: 0, text: 'Could you repeat that?' }] });
    const full = load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test',
      settings: PANEL_SETTINGS_FIXTURE, activeScreen: 'tutor', tutor: state, proModels: [] }));
    expect(panel.transcript.querySelectorAll('[data-tutor-kren-bubble]').map((bubble) => bubble.textContent))
      .toEqual(full('[data-tutor-kren-bubble]').map((_i, node) => full(node).text()).get());
  });

  it('V183 scrolls the stopped actions row fully into view and spaces active picture diagnosis in CSS', () => {
    const scrollIntoView = vi.fn();
    const document = { querySelector: vi.fn(() => ({ scrollIntoView })) };
    new Function('document', panelFunction('scrollTutorStoppedActions') + '\nscrollTutorStoppedActions();')(document);
    expect(document.querySelector).toHaveBeenCalledWith('[data-tutor-stopped-actions]');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end' });
    const panel = pictureMicrophonePanel({ active: false });
    expect(load(panel.html)('[data-tutor-stopped-actions] [data-command="startNewTutorConversation"]')).toHaveLength(1);
    expect(load(panel.html)('[data-tutor-stopped-actions] [data-command="resumeTutorConversation"]')).toHaveLength(1);
    expect(panel.html).toMatch(/\[data-tutor-conversation-active="true"\] \.tutor-chat-viewport-picture \+ \.tutor-conversation-actions \{ padding-top: 10px; \}/u);
    // 2026-10-02: V183b scrolls once when Stop completes; later renders restore the reader's position.
    expect(panelScript()).not.toContain('scrollTutorStoppedActions();');
  });

  it('V183b keeps both microphone indicators listening after a discarded-input ready patch', () => {
    const panel = pictureMicrophonePanel({ listening: true });
    panel.load();
    panel.call('markTutorLiveConversationReady', { talkAvailable: true, listening: true, pressToTalk: false });
    expect(panel.composer.getAttribute('aria-pressed')).toBe('true');
    expect(panel.chatButton()?.getAttribute('aria-pressed')).toBe('true');
    expect(panel.chatButton()?.classList.contains('tutor-dictation-active')).toBe(true);
  });

  it('V183b restores later input before an already streaming reply in place', () => {
    const panel = pictureMicrophonePanel();
    panel.call('appendTutorLiveReply', { text: 'Let us begin.', reset: true });
    panel.call('appendTutorLiveInput', { text: 'I am ready.', reset: true });
    panel.call('commitTutorLiveInput', { text: 'I am ready.', index: 0 });
    const turn = panel.transcript.querySelector('[data-tutor-learner-turn="0"]')!;
    const reply = panel.transcript.querySelector('[data-tutor-live-reply]')!;
    expect(turn.querySelector('[data-tutor-learner-answer]')?.textContent).toBe('I am ready.');
    expect(panel.transcript.children.indexOf(turn)).toBeLessThan(panel.transcript.children.indexOf(reply));
  });

  it('V183b normalizes a successful Retry patch to the stored spoken answer', () => {
    const panel = pictureMicrophonePanel();
    panel.call('appendTutorLiveInput', { text: 'i live in seoul.', reset: true });
    panel.call('commitTutorLiveInput', { text: 'i live in seoul.', index: 0 });
    panel.patchCoaching({ index: 0, coachingFailed: true });
    panel.patchCoaching({ index: 0, coachingFailed: false, spokenEquivalent: true, correction: 'I live in Seoul.' });
    // Changed 2026-10-16: V253, owner item I34, only the host's checked learnerAnswer may replace balloon text.
    expect(panel.transcript.querySelector('[data-tutor-learner-answer]')?.textContent).toBe('i live in seoul.');
  });

  it('V183b preserves the disabled Standard replay explanation in place after Stop', () => {
    const panel = pictureMicrophonePanel({ active: false, live: false });
    const speaker = panel.root.appendChild(panel.createButton());
    speaker.setAttribute('data-command', 'toggleTutorConversationSpeaker');
    speaker.setAttribute('aria-pressed', 'true');
    const replay = panel.root.appendChild(panel.createButton());
    replay.setAttribute('data-command', 'replayTutorQuestion');
    replay.setAttribute('data-tutor-replay-mode', 'conversation');
    panel.call('updateTutorConversationReplay', false);
    expect(replay.disabled).toBe(true);
    expect(replay.title).toMatch(/has not said anything/i);
    panel.call('updateTutorConversationReplay', true);
    expect(replay.disabled).toBe(false);
    expect(replay.title).toMatch(/replay.*conversation/i);
    speaker.setAttribute('aria-pressed', 'false');
    panel.call('updateTutorReplayMode');
    expect(replay.disabled).toBe(true);
    expect(replay.title).toMatch(/speaker on/i);
  });

  // 2026-10-01: V181 retains the next-balloon microphone in both picture modes.
  it.each(['intro', 'switching'] as const)('keeps the mirrored microphone in %s mode', (pictureMode) => {
    const panel = pictureMicrophonePanel({ pictureMode });
    panel.load();
    expect(panel.chatButton()).not.toBeNull();
    expect(panel.transcript.children.at(-1)?.querySelector('[data-command="dictateTutorConversation"]')).not.toBeNull();
  });

  it('sits after the last turn before picture decoding without pulsing before the first press', () => {
    const panel = pictureMicrophonePanel();
    const lastTurn = new FakeElement('div');
    panel.transcript.children.at(-1)!.before(lastTurn);
    lastTurn.textContent = 'Your last message';
    // Changed 2026-10-10: V212 makes controls available without waiting for a picture.
    panel.call('syncTutorPictureMicrophone');
    expect(panel.chatButton()).not.toBeNull();
    panel.load();
    expect(panel.transcript.children).toContain(lastTurn);
    expect(panel.transcript.children.indexOf(lastTurn)).toBeLessThan(panel.transcript.children.length - 1);
    expect(panel.transcript.children.at(-1)?.hasAttribute('data-tutor-chat-microphone')).toBe(true);
    expect(panel.chatButton()?.getAttribute('aria-pressed')).toBe('false');
    expect(panel.chatButton()?.classList.contains('tutor-microphone-pulsing')).toBe(false);
    expect(panel.chatButton()?.querySelector('svg')).not.toBeNull();
  });

  // 2026-10-02: the owner wants the bare button in the chat, not a learner balloon around it.
  it('shows the bare microphone with no balloon behind it', () => {
    const panel = pictureMicrophonePanel();
    panel.load();
    const slot = panel.transcript.children.at(-1)!;
    expect(slot.hasAttribute('data-tutor-chat-microphone')).toBe(true);
    expect(slot.querySelector('.tutor-chat-learner')).toBeNull();
    // Changed 2026-10-02: V183 puts Stop before the bare microphone.
    expect(slot.children[0]?.getAttribute('data-command')).toBe('stopTutorConversation');
    expect(slot.children[1]?.getAttribute('data-command')).toBe('dictateTutorConversation');
  });

  // 2026-10-02: over a picture, balloon edges touched the picture's edges.
  it('keeps balloons 6px from the chat edges and right-aligns a learner balloon narrower than its correction', () => {
    const state = createTutorViewState();
    const html = renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
      activeScreen: 'tutor', tutor: state, proModels: [] });
    const rule = (selector: string) => html.split(/\r?\n/u).find((line) => line.trim().startsWith(`${selector} {`)) ?? '';
    expect(rule('.tutor-chat-kren')).toContain('margin-left: 6px;');
    expect(rule('.tutor-chat-learner-turn')).toContain('margin-right: 6px;');
    expect(rule('.tutor-chat-learner')).toContain('margin-left: auto;');
  });

  it.each([{ active: false }, { live: false }])('follows conversation activity for %j', (options) => {
    const panel = pictureMicrophonePanel(options);
    panel.load();
    // Changed 2026-10-10: V212 also mirrors the Standard microphone.
    expect(panel.chatButton() !== null).toBe(options.active !== false);
  });

  it.each(['chat', 'composer'])('a press on the %s microphone updates both controls together and sends the same command', (which) => {
    const panel = pictureMicrophonePanel();
    panel.load();
    const press = () => panel.click(which === 'chat' ? panel.chatButton()! : panel.composer);
    for (const pressed of [true, false, true]) {
      press();
      for (const button of [panel.chatButton()!, panel.composer]) {
        expect(button.getAttribute('aria-pressed')).toBe(String(pressed));
        expect(button.classList.contains('tutor-microphone-pulsing')).toBe(pressed);
        expect(button.title).toBe(panel.composer.title);
        expect(button.getAttribute('aria-label')).toBe(panel.composer.getAttribute('aria-label'));
        expect(button.disabled).toBe(panel.composer.disabled);
      }
      expect(panel.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ command: 'dictateTutorConversation' }));
      // Confirm the same state from the host; a state report must not toggle a second time.
      panel.call('updateTutorLiveTalk', { available: true, listening: pressed });
      expect(panel.chatButton()?.getAttribute('aria-pressed')).toBe(String(pressed));
    }
  });

  it('replaces the microphone with streaming learner words without any hearing dots, then restores it pulsing after the reply', () => {
    const panel = pictureMicrophonePanel({ listening: true });
    panel.load();
    panel.call('appendTutorLiveInput', { text: '', reset: true, started: true });
    expect(panel.transcript.querySelectorAll('.tutor-typing-dot')).toHaveLength(0);
    expect(panel.chatButton()?.classList.contains('tutor-microphone-pulsing')).toBe(true);
    panel.call('appendTutorLiveInput', { text: 'My kitchen', reset: true });
    // Changed 2026-10-18: V263, owner item I43, the only microphone must remain reachable to finish speaking.
    expect(panel.chatButton()).not.toBeNull();
    panel.call('appendTutorLiveInput', { text: ' sink leaks.' });
    expect(bubbleTexts(panel.transcript)).toEqual(['My kitchen sink leaks.']);
    panel.call('commitTutorLiveInput', { text: 'My kitchen sink leaks.', index: 0 });
    panel.call('appendTutorLiveReply', { text: 'Can you describe it?', reset: true });
    expect(panel.chatButton()).toBeNull();
    panel.call('commitTutorLiveTurn', { index: 0 });
    expect(panel.transcript.children.at(-1)?.hasAttribute('data-tutor-chat-microphone')).toBe(true);
    expect(panel.chatButton()?.classList.contains('tutor-microphone-pulsing')).toBe(true);
    expect(bubbleTexts(panel.transcript).slice(0, 2)).toEqual(['My kitchen sink leaks.', 'Can you describe it?']);
    expect(panel.postMessage).toHaveBeenCalledWith({ command: 'tutorLiveInputBubblePatched' });
    panel.call('updateTutorLiveTalk', { available: true, listening: false });
    expect(panel.chatButton()?.classList.contains('tutor-microphone-pulsing')).toBe(false);
  });

  it('reappears without pulsing after a reply when the learner has stopped listening', () => {
    const panel = pictureMicrophonePanel({ listening: true });
    panel.load();
    panel.call('appendTutorLiveInput', { text: 'Hello', reset: true });
    panel.call('updateTutorLiveTalk', { available: true, listening: false });
    panel.call('appendTutorLiveReply', { text: 'Hello to you.', reset: true });
    panel.call('commitTutorLiveTurn', { index: 0 });
    expect(panel.chatButton()?.getAttribute('aria-pressed')).toBe('false');
    expect(panel.chatButton()?.classList.contains('tutor-microphone-pulsing')).toBe(false);
  });

  it('retains the microphone when the picture is removed or fails decoding and on a later load', () => {
    // Changed 2026-10-10: V212 keeps the mirrored controls independent of pictures and reply mode.
    const panel = pictureMicrophonePanel();
    panel.load();
    panel.call('patchTutorConversationPicture', {});
    expect(panel.chatButton()).not.toBeNull();
    panel.call('patchTutorConversationPicture', { image: 'data:image/png;base64,YQ==' });
    expect(panel.chatButton()).not.toBeNull();
    panel.picture.listeners.get('error')?.();
    expect(panel.chatButton()).not.toBeNull();
    panel.load();
    expect(panel.chatButton()).not.toBeNull();
    panel.picture.listeners.get('error')?.();
    expect(panel.chatButton()).not.toBeNull();
  });

  it('keeps the microphone instead of hearing dots before and after picture arrival', () => {
    // Changed 2026-10-10: V212 keeps the mirrored controls independent of pictures and reply mode.
    const panel = pictureMicrophonePanel({ listening: true });
    panel.call('appendTutorLiveInput', { text: '', reset: true, started: true });
    expect(panel.transcript.querySelectorAll('.tutor-typing-dot')).toHaveLength(0);
    panel.load();
    expect(panel.transcript.querySelectorAll('.tutor-typing-dot')).toHaveLength(0);
    expect(panel.chatButton()?.classList.contains('tutor-microphone-pulsing')).toBe(true);
    panel.call('appendTutorLiveInput', { text: 'Here are my words', reset: true });
    expect(bubbleTexts(panel.transcript)).toEqual(['Here are my words']);
  });

  // Changed 2026-10-10: V212 retains the microphone when a picture disappears before recognition.
  it('retains the microphone in place when picture mode ends before the first words', () => {
    // Changed 2026-10-10: V212 keeps the mirrored controls independent of pictures and reply mode.
    for (const pictureMode of ['intro', 'switching'] as const) {
      for (const end of ['off', 'removed', 'error']) {
        const panel = pictureMicrophonePanel({ listening: true, pictureMode });
        const composer = panel.composer;
        const transcript = panel.transcript;
        panel.load();
        panel.call('appendTutorLiveInput', { text: '', reset: true, started: true });
        expect(panel.transcript.querySelectorAll('.tutor-typing-dot')).toHaveLength(0);
        expect(panel.chatButton()?.classList.contains('tutor-microphone-pulsing')).toBe(true);

        if (end === 'error') panel.picture.listeners.get('error')?.();
        else panel.call('patchTutorConversationPicture', end === 'off' ? { mode: 'none' } : {});
        expect(panel.chatButton()).not.toBeNull();
        expect(panel.transcript.querySelectorAll('.tutor-typing-dot')).toHaveLength(0);
        expect(panel.transcript.querySelectorAll('[data-tutor-live-input]')).toHaveLength(0);
        expect(bubbleTexts(panel.transcript).join('')).toBe('');
        panel.call('syncTutorPictureMicrophone');
        expect(panel.transcript.querySelectorAll('[data-tutor-live-input]')).toHaveLength(0);
        panel.call('appendTutorLiveInput', { text: 'My first words', reset: true });
        expect(bubbleTexts(panel.transcript)).toEqual(['My first words']);
        panel.call('syncTutorPictureMicrophone');
        expect(panel.transcript.querySelectorAll('.tutor-typing-dot')).toHaveLength(0);
        expect(panel.composer).toBe(composer);
        expect(panel.root.querySelector('[data-tutor-transcript]')).toBe(transcript);
      }
    }
  });

  it('keeps the pulsing microphone when a picture arrives or leaves again', () => {
    // Changed 2026-10-10: V212 keeps the mirrored controls independent of pictures and reply mode.
    for (const pictureMode of ['intro', 'switching'] as const) {
      const panel = pictureMicrophonePanel({ listening: true, pictureMode });
      const transcript = panel.transcript;
      const composer = panel.composer;
      panel.call('appendTutorLiveInput', { text: '', reset: true, started: true });
      expect(panel.transcript.querySelectorAll('.tutor-typing-dot')).toHaveLength(0);
      panel.load();
      expect(panel.transcript.querySelectorAll('.tutor-typing-dot')).toHaveLength(0);
      expect(panel.transcript.querySelector('[data-tutor-live-input]')).toBeNull();
      expect(panel.chatButton()?.classList.contains('tutor-microphone-pulsing')).toBe(true);
      panel.picture.listeners.get('error')?.();
      expect(panel.chatButton()).not.toBeNull();
      expect(panel.transcript.querySelectorAll('.tutor-typing-dot')).toHaveLength(0);
      panel.load();
      panel.call('appendTutorLiveInput', { text: 'Words after switching', reset: true });
      panel.picture.listeners.get('error')?.();
      expect(bubbleTexts(panel.transcript)).toEqual(['Words after switching']);
      expect(panel.transcript.querySelectorAll('.tutor-typing-dot')).toHaveLength(0);
      expect(panel.composer).toBe(composer);
      expect(panel.root.querySelector('[data-tutor-transcript]')).toBe(transcript);
    }
  });

  it('does not restore stale hearing dots after an input is committed or the Live turn is canceled', () => {
    // Changed 2026-10-10: V212 keeps the mirrored controls independent of pictures and reply mode.
    for (const command of ['commitTutorLiveInput', 'cancelTutorLiveTurn']) {
      const panel = pictureMicrophonePanel({ listening: true });
      panel.load();
      panel.call('appendTutorLiveInput', { text: '', reset: true, started: true });
      panel.call(command, { text: '', index: 0 });
      panel.picture.listeners.get('error')?.();
      expect(panel.chatButton()).not.toBeNull();
      expect(panel.transcript.querySelectorAll('.tutor-typing-dot')).toHaveLength(0);
      expect(panel.transcript.querySelector('[data-tutor-live-input]')).toBeNull();
    }
  });

  it('removes the control when the conversation ends and retains it for Standard replies', () => {
    // Changed 2026-10-10: V212 keeps the mirrored controls independent of pictures and reply mode.
    const panel = pictureMicrophonePanel();
    panel.load();
    panel.root.setAttribute('data-tutor-conversation-active', 'false');
    panel.call('syncTutorPictureMicrophone');
    expect(panel.chatButton()).toBeNull();
    panel.root.setAttribute('data-tutor-conversation-active', 'true');
    panel.call('syncTutorPictureMicrophone');
    panel.replies.value = 'standard';
    panel.call('syncTutorPictureMicrophone');
    expect(panel.chatButton()).not.toBeNull();
  });

  it('mirrors disabled and unavailable state, including a refused press', () => {
    const panel = pictureMicrophonePanel({ available: false });
    panel.load();
    expect(panel.chatButton()?.disabled).toBe(panel.composer.disabled);
    panel.call('updateTutorLiveTalk', { available: true, listening: true });
    expect(panel.chatButton()?.disabled).toBe(false);
    panel.call('updateTutorLiveTalk', { available: false });
    expect(panel.chatButton()?.disabled).toBe(true);
    expect(panel.chatButton()?.getAttribute('aria-pressed')).toBe('false');
    expect(panel.chatButton()?.title).toBe(panel.composer.title);
  });

  it('V200 preserves the round microphone styling and composer during an in-place Talk patch', () => {
    const panel = pictureMicrophonePanel({ pressToTalk: true });
    const originalComposer = panel.composer;
    panel.load();
    const originalPicture = panel.picture;
    panel.call('updateTutorLiveTalk', { available: true, listening: true, pressToTalk: true });
    const microphone = panel.chatButton()!;
    expect(microphone.classList.contains('icon-button')).toBe(true);
    expect(microphone.getAttribute('data-command')).toBe('dictateTutorConversation');
    expect(microphone.getAttribute('style')).toBeNull();
    expect(microphone.getAttribute('aria-label')).toBe('Press when you finish');
    expect(microphone.title).toBe('Press when you finish');
    const $ = load(panel.html);
    expect($('style').text()).toMatch(/\.icon-button\[data-command="dictateTutorConversation"\]\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;[^}]*border-radius:\s*50% !important/u);
    expect(panel.composer).toBe(originalComposer);
    expect(panel.picture).toBe(originalPicture);
    panel.call('updateTutorLiveTalk', { available: true, listening: false, pressToTalk: true });
    expect(panel.chatButton()?.getAttribute('aria-label')).toBe('Press to talk');
  });

  it('uses the existing press-to-talk labels and toggles for both microphones', () => {
    const panel = pictureMicrophonePanel({ pressToTalk: true });
    panel.load();
    expect(panel.chatButton()?.title).toBe('Press to talk');
    panel.click(panel.chatButton()!);
    expect(panel.chatButton()?.title).toBe('Press when you finish');
    expect(panel.composer.title).toBe('Press when you finish');
    panel.click(panel.composer);
    expect(panel.chatButton()?.getAttribute('aria-pressed')).toBe('false');
    expect(panel.chatButton()?.title).toBe('Press to talk');
  });
});

function conversationModePanel() {
  const state = createTutorViewState();
  Object.assign(state.conversation, { status: 'active', replies: 'standard' });
  const html = renderKrenResultViewHtml({
    cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
    activeScreen: 'tutor', tutor: state, proModels: []
  });
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gu)]
    .map((match) => match[1]).join('\n');
  const changeStart = script.indexOf("document.addEventListener('change'");
  const syncStart = script.indexOf('function syncTutorConversationMode', changeStart);
  const syncEnd = script.indexOf('function syncTutorReviewAvailability', syncStart);
  expect(changeStart).toBeGreaterThan(-1);
  expect(syncStart).toBeGreaterThan(changeStart);
  expect(syncEnd).toBeGreaterThan(syncStart);

  class TestElement {
    public readonly attributes = new Map<string, string>();
    public disabled = false;
    public textContent = '';
    public setting: TestElement | undefined;
    public description: TestElement | undefined;
    public hasAttribute(name: string): boolean { return this.attributes.has(name); }
    public getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
    public setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
    public closest(selector: string): TestElement | null {
      return selector === '.setting' ? this.setting ?? null : null;
    }
    public querySelector(selector: string): TestElement | null {
      return selector === '.setting-description' ? this.description ?? null : null;
    }
  }
  class TestSelect extends TestElement {
    public readonly labels: Record<string, string>;
    public constructor(public value: string, labels: Record<string, string>) {
      super();
      this.labels = labels;
    }
    public get selectedOptions(): Array<{ textContent: string }> {
      return [{ textContent: this.labels[this.value] ?? this.value }];
    }
  }
  class TestTextArea extends TestElement { public value = ''; }
  class TestInput extends TestElement { public type = ''; public checked = false; public value = ''; }
  const send = new TestSelect('stopSpeaking', {
    button: 'With the Send button', stopSpeaking: 'When I stop speaking'
  });
  send.attributes.set('data-tutor-conversation-send', '');
  const setting = new TestElement();
  const description = new TestElement();
  setting.description = description;
  send.setting = setting;
  const replies = new TestSelect('standard', { standard: 'Standard', liveGemini: 'Live (Gemini)' });
  replies.attributes.set('data-tutor-conversation-replies', '');
  const messages: Array<Record<string, unknown>> = [];
  let changeListener: ((event: { target: TestElement }) => void) | undefined;
  const document = {
    addEventListener(name: string, listener: (event: { target: TestElement }) => void) {
      if (name === 'change') changeListener = listener;
    },
    querySelector(selector: string) {
      if (selector === '[data-tutor-conversation-send]') return send;
      if (selector === '[data-tutor-conversation-replies]') return replies;
      return null;
    },
    querySelectorAll() { return []; }
  };
  runInNewContext(
    // 2026-10-01: Mode synchronization also calls the real picture settings patch.
    `${panelFunction('syncTutorPictureMicrophone')}\n${panelFunction('tutorPictureMicrophoneMode')}\n${panelFunction('syncTutorConversationPictureSettings')}\n${script.slice(changeStart, syncStart)}\n${script.slice(syncStart, syncEnd)}`,
    {
      document,
      vscode: { postMessage: (message: Record<string, unknown>) => messages.push(message) },
      updateTutorLiveReplay: () => undefined,
      updateTutorReplayMode: () => undefined,
      applyConditionalSettings: () => undefined,
      HTMLElement: TestElement,
      HTMLInputElement: TestInput,
      HTMLSelectElement: TestSelect,
      HTMLTextAreaElement: TestTextArea,
      HTMLButtonElement: TestElement // 2026-10-12: Composer Send visibility follows Replies.
    }
  );
  return {
    send, replies, description, messages,
    changeReplies(value: 'standard' | 'liveGemini') {
      replies.value = value;
      changeListener?.({ target: replies });
    }
  };
}

describe('Live transcript patching in the panel', () => {
  it('keeps every sentence of a later reply in that reply\'s bubble', () => {
    const { transcript, appendReply } = fakePanel();
    appendReply({ text: 'Hello, this is Apex Plumbing.', reset: true });
    appendReply({ text: ' How can I help you today?' });
    appendReply({ text: 'I\'m sorry to hear that.', reset: true });
    appendReply({ text: ' Is it a slow drip?' });
    appendReply({ text: 'That sounds urgent.', reset: true });
    appendReply({ text: ' Could you give me your address?' });
    expect(bubbleTexts(transcript)).toEqual([
      'Hello, this is Apex Plumbing. How can I help you today?',
      'I\'m sorry to hear that. Is it a slow drip?',
      'That sounds urgent. Could you give me your address?'
    ]);
  });

  it('keeps every piece of a later spoken answer in that answer\'s bubble', () => {
    const { transcript, appendInput } = fakePanel();
    appendInput({ text: 'My kitchen', reset: true });
    appendInput({ text: ' sink is leaking.' });
    appendInput({ text: 'It happened', reset: true });
    appendInput({ text: ' all of a sudden.' });
    expect(bubbleTexts(transcript)).toEqual([
      'My kitchen sink is leaking.',
      'It happened all of a sudden.'
    ]);
  });

  it('shows a pending learner bubble at first audio and replaces its dots with transcription', () => {
    const { transcript, postMessage, appendInput } = fakePanel();
    appendInput({ text: '', reset: true, started: true });
    expect(transcript.children).toHaveLength(1);
    expect(transcript.querySelectorAll('[data-tutor-live-input]')).toHaveLength(1);
    expect(transcript.children[0]!.querySelectorAll('span')).toHaveLength(3);
    expect(postMessage).toHaveBeenCalledWith({ command: 'tutorLiveInputBubblePatched' });

    appendInput({ text: 'KREN can hear me.', reset: true });
    expect(transcript.children).toHaveLength(1);
    expect(bubbleTexts(transcript)).toEqual(['KREN can hear me.']);
  });
});

describe('active conversation mode patching', () => {
  it('drives Send disabled state and description in both directions from the panel change event', () => {
    const panel = conversationModePanel();

    panel.changeReplies('liveGemini');
    // Changed 2026-10-18: V263, owner item I43, Replies no longer controls a Send setting.
    expect(panel.send.disabled).toBe(false);
    expect(panel.description.textContent).not.toContain('Standard only');

    panel.changeReplies('standard');
    expect(panel.send.disabled).toBe(false);
    expect(panel.description.textContent).not.toContain('With the Send button');
    expect(panel.messages).toContainEqual({
      command: 'updateTutorConversationReplies', input: 'liveGemini'
    });
    expect(panel.messages).toContainEqual({
      command: 'updateTutorConversationReplies', input: 'standard'
    });
  });

  it('V155 patches Stop in place with its reason and preserves the answer box', () => {
    // Added 2026-09-25: a full render also produces the right disabled markup, but it
    // destroys this textarea. The mounted panel must take the dedicated patch path.
    const root = new FakeElement('div');
    const answer = root.appendChild(new FakeElement('textarea'));
    answer.setAttribute('data-tutor-conversation-answer', '');
    answer.textContent = 'An answer still being written.';
    const stop = root.appendChild(new FakeElement('button'));
    stop.setAttribute('data-command', 'stopTutorConversation');
    const document = { querySelector: (selector: string) => root.querySelector(selector) };
    const updateStop = new Function(
      'document', 'HTMLButtonElement',
      `${panelFunction('updateTutorConversationStop')}\nreturn updateTutorConversationStop;`
    )(document, FakeElement, FakeElement) as (message: Record<string, unknown>) => void;

    updateStop({
      disabled: true, title: 'Stop is available when this turn finishes'
    });
    expect(stop.disabled).toBe(true);
    expect(stop.getAttribute('aria-label')).toBe('Stop is available when this turn finishes');
    expect((stop as unknown as { title: string }).title)
      .toBe('Stop is available when this turn finishes');
    expect(root.querySelector('[data-tutor-conversation-answer]')).toBe(answer);
    expect(answer.textContent).toBe('An answer still being written.');

    updateStop({ disabled: false, title: 'Stop conversation' });
    expect(stop.disabled).toBe(false);
    expect(root.querySelector('[data-tutor-conversation-answer]')).toBe(answer);
  });
});

describe('Live turn completion patching', () => {
  it('V152 reverses V148 in place and highlights a model-named no-shared-words Live quote', () => {
    const root = new FakeElement('div');
    const answer = root.appendChild(new FakeElement('textarea'));
    answer.setAttribute('data-tutor-conversation-answer', '');
    answer.textContent = 'The reader is already typing the next answer.';
    const pending = root.appendChild(new FakeElement('div'));
    pending.setAttribute('data-tutor-pending', '');
    const learnerBubble = pending.appendChild(new FakeElement('div'));
    learnerBubble.className = 'tutor-chat-learner';
    const bubble = root.appendChild(new FakeElement('div'));
    bubble.setAttribute('data-tutor-live-reply', '');
    const paragraph = bubble.appendChild(new FakeElement('p'));
    paragraph.textContent = 'Actually, you would say: from overseas. What happened next?';
    const document = {
      querySelector: (selector: string) => root.querySelector(selector),
      createElement: (tag: string) => new FakeElement(tag),
      createTextNode: (value: string) => {
        const node = new FakeElement('#text');
        node.textContent = value;
        return node;
      }
    };
    const source = `${optionalPanelFunction('updateTutorConversationHint')}\n${optionalPanelFunction('patchTutorLiveCoaching')}
${panelFunction('commitTutorLiveTurn')}`;
    const commit = new Function(
      'document', 'HTMLElement', 'HTMLParagraphElement', 'HTMLButtonElement',
      'markTutorLiveConversationReady', 'updateTutorConversationDiagnosis',
      // 2026-10-01: These isolated coaching tests stub the new commit-only picture check.
      `const checkTutorDevelopingPicture = () => {};\n${source}\nreturn commitTutorLiveTurn;`
    )(document, FakeElement, FakeElement, FakeElement, () => undefined, () => undefined) as
      (message: Record<string, unknown>) => void;

    commit({
      index: 0,
      teaching: true,
      correction: 'I took a bus yesterday.',
      // Added 2026-10-04: a target mark and correction share this exact span in the in-place patch.
      targetRanges: [{ start: 25, end: 38 }],
      replyQuote: 'from overseas',
      explanation: 'Use the past tense and the article.',
      rephrase: 'I took the bus yesterday.',
      rephraseWhy: 'This fits the travel question naturally.',
      rephraseEligible: true,
      showRephrase: true,
      feedbackEligible: true,
      showFeedback: true,
      answeredTurnCount: 1,
      skippedTurnCount: 0
    });
    // Changed 2026-09-25 for V152: the owner reversed V148. The complete correction is
    // plain feedback under the learner, and the independently named Live span is highlighted.
    expect(root.querySelector('[data-tutor-correction-bubble]')).toBeNull();
    expect(pending.querySelector('[data-tutor-correction]')?.textContent)
      .toBe('I took a bus yesterday.');
    // Changed 2026-09-25 for V157: the rephrasing arrives through this mounted-panel patch,
    // beside the correction it may replace, without replacing the active answer box.
    const rephrase = pending.querySelector('[data-command="showTutorConversationRephrase"]');
    expect(rephrase?.textContent).toBe('Rephrase?');
    expect(rephrase?.getAttribute('data-tutor-rephrase')).toBe('I took the bus yesterday.');
    expect(paragraph.querySelector('[data-tutor-target-use]')?.textContent).toBe('from overseas');
    expect(paragraph.querySelector('[data-tutor-reply-quote]')?.textContent).toBe('from overseas');
    expect(paragraph.querySelector('strong')?.className).toBe('tutor-reply-quote');
    expect(paragraph.textContent).toBe('Actually, you would say: from overseas. What happened next?');
    expect(root.querySelector('[data-tutor-conversation-answer]')).toBe(answer);
    expect(answer.textContent).toBe('The reader is already typing the next answer.');
  });

  // Changed 2026-10-15: V241, owner item I6, the fifth answered turn updates counts without adding an active review button.
  it('V131 keeps review actions stopped-only when the fifth answer crosses the patch path', () => {
    // Added 2026-09-20: a full render already handled this gate. The defect existed only in
    // the mounted panel, so this test executes the completion patch five times and keeps the
    // separately counted skipped turn from satisfying the five-answer floor.
    const root = new FakeElement('div');
    const actions = root.appendChild(new FakeElement('div'));
    actions.setAttribute('data-tutor-conversation-actions', '');
    actions.hidden = true;
    let pending: FakeElement | undefined;
    const document = {
      querySelector(selector: string) {
        if (selector === '[data-tutor-pending]') return pending ?? null;
        if (selector === '[data-tutor-live-reply]') return null;
        if (selector === '[data-tutor-conversation-actions]') return actions;
        return root.querySelector(selector);
      },
      createElement: (tag: string) => new FakeElement(tag),
      createTextNode: (text: string) => {
        const node = new FakeElement('#text');
        node.textContent = text;
        return node;
      }
    };
    const source = `${optionalPanelFunction('updateTutorConversationHint')}\n${panelFunction('updateTutorConversationDiagnosis')}\n${optionalPanelFunction('applyTutorLiveTeaching')}
${optionalPanelFunction('patchTutorLiveCoaching')}
${panelFunction('commitTutorLiveTurn')}`;
    const commit = new Function(
      'document', 'HTMLElement', 'HTMLParagraphElement', 'HTMLButtonElement',
      'markTutorLiveConversationReady',
      // 2026-10-01: These isolated coaching tests stub the new commit-only picture check.
      `const checkTutorDevelopingPicture = () => {};\n${source}\nreturn commitTutorLiveTurn;`
    )(
      document, FakeElement, FakeElement, FakeElement, () => undefined
    ) as (message: Record<string, unknown>) => void;

    for (let answered = 1; answered <= 4; answered += 1) {
      pending = root.appendChild(new FakeElement('div'));
      pending.setAttribute('data-tutor-pending', '');
      commit({ index: answered - 1, answeredTurnCount: answered, skippedTurnCount: answered === 4 ? 1 : 0 });
    }
    expect(actions.hidden).toBe(true);
    expect(actions.querySelector('[data-command]')).toBeNull();

    pending = root.appendChild(new FakeElement('div'));
    pending.setAttribute('data-tutor-pending', '');
    commit({ index: 5, answeredTurnCount: 5, skippedTurnCount: 1 });
    const diagnosis = actions.querySelector('[data-command]');
    expect(actions.hidden).toBe(true);
    expect(diagnosis).toBeNull();
    expect(actions.getAttribute('data-tutor-answered-turns')).toBe('5');
    expect(actions.getAttribute('data-tutor-skipped-turns')).toBe('1');
  });

  // Changed 2026-10-15: V241, owner item I6, Stop availability no longer creates or controls an active diagnosis button.
  it('V163 patches Stop availability while keeping review out of the mounted active conversation', () => {
    const root = new FakeElement('div');
    const stop = root.appendChild(new FakeElement('button'));
    stop.setAttribute('data-command', 'stopTutorConversation');
    const actions = root.appendChild(new FakeElement('div'));
    actions.setAttribute('data-tutor-conversation-actions', '');
    const document = {
      querySelector: (selector: string) => root.querySelector(selector),
      createTextNode: (text: string) => { const node = new FakeElement('#text'); node.textContent = text; return node; },
    createElement: (tag: string) => new FakeElement(tag)
    };
    const patch = new Function('document', 'HTMLButtonElement', 'HTMLElement',
      `${panelFunction('updateTutorConversationStop')}\n` +
      `${panelFunction('updateTutorConversationDiagnosis')}\n` +
      'return { updateTutorConversationStop, updateTutorConversationDiagnosis };'
    )(document, FakeElement, FakeElement) as {
      updateTutorConversationStop(message: Record<string, unknown>): void;
      updateTutorConversationDiagnosis(answered: number, skipped: number): void;
    };
    patch.updateTutorConversationStop({ disabled: true, title: 'Stop is available when this turn finishes' });
    patch.updateTutorConversationDiagnosis(5, 0);
    const diagnosis = actions.querySelector('[data-command="diagnoseTutorConversation"]')!;
    expect(actions.hidden).toBe(true);
    expect(diagnosis).toBeNull();
    expect(stop.disabled).toBe(true);
    expect(stop.title).toMatch(/turn finishes/iu);
    patch.updateTutorConversationStop({ disabled: false, title: 'Stop conversation' });
    expect(stop.disabled).toBe(false);
    expect(actions.querySelector('[data-command]')).toBeNull();
  });

  // Changed 2026-10-15: V241, owner item I6, changing Stop availability leaves review actions absent until Stop.
  it('V163 keeps review actions absent when Stop availability changes', () => {
    const root = new FakeElement('div');
    const stop = root.appendChild(new FakeElement('button'));
    stop.setAttribute('data-command', 'stopTutorConversation');
    const actions = root.appendChild(new FakeElement('div'));
    actions.setAttribute('data-tutor-conversation-actions', '');
    const document = {
      querySelector: (selector: string) => root.querySelector(selector),
      createTextNode: (text: string) => { const node = new FakeElement('#text'); node.textContent = text; return node; },
    createElement: (tag: string) => new FakeElement(tag)
    };
    const patch = new Function('document', 'HTMLButtonElement', 'HTMLElement',
      `${panelFunction('updateTutorConversationStop')}\n` +
      `${panelFunction('updateTutorConversationDiagnosis')}\n` +
      'return { updateTutorConversationStop, updateTutorConversationDiagnosis };'
    )(document, FakeElement, FakeElement) as {
      updateTutorConversationStop(message: Record<string, unknown>): void;
      updateTutorConversationDiagnosis(answered: number, skipped: number): void;
    };
    patch.updateTutorConversationDiagnosis(5, 0);
    const diagnosis = actions.querySelector('[data-command="diagnoseTutorConversation"]')!;
    expect(actions.hidden).toBe(true);
    expect(diagnosis).toBeNull();

    const unavailable = 'Stop is available when you finish speaking';
    patch.updateTutorConversationStop({ disabled: true, title: unavailable });
    expect(stop.disabled).toBe(true);
    expect(actions.hidden).toBe(true);
    expect(actions.querySelector('[data-command]')).toBeNull();
    patch.updateTutorConversationStop({ disabled: false, title: 'Stop conversation' });
    expect(stop.disabled).toBe(false);
    expect(diagnosis).toBeNull();
    expect(actions.getAttribute('data-tutor-answered-turns')).toBe('5');
  });

  it('V131 refuses a hint whose turn has already advanced, even in flight', () => {
    const block = new FakeElement('div');
    block.setAttribute('data-tutor-hint', '');
    const explanation = block.appendChild(new FakeElement('p'));
    explanation.setAttribute('data-tutor-hint-explanation', '');
    const example = block.appendChild(new FakeElement('p'));
    example.setAttribute('data-tutor-hint-example', '');
    const exampleText = example.appendChild(new FakeElement('span'));
    exampleText.setAttribute('data-tutor-hint-example-text', '');
    const root = new FakeElement('div');
    root.appendChild(block);
    const document = {
      querySelector: (selector: string) => root.querySelector(selector),
      createElement: (tag: string) => new FakeElement(tag),
      createTextNode: (text: string) => {
        const node = new FakeElement('#text');
        node.textContent = text;
        return node;
      }
    };
    const updateHint = new Function(
      'document', 'HTMLElement', 'HTMLParagraphElement', 'HTMLButtonElement',
      `${panelFunction('updateTutorConversationHint')}
return updateTutorConversationHint;`
    )(document, FakeElement, FakeElement, FakeElement) as (
      message: Record<string, unknown>
    ) => void;

    // The reader asks for a hint on turn 1, then Skip or Send moves the conversation on.
    updateHint({ busy: true, turnGeneration: 1 });
    expect(block.getAttribute('data-tutor-hint-turn')).toBe('1');
    updateHint({ clear: true, turnGeneration: 2 });
    expect(block.getAttribute('data-tutor-hint-turn')).toBeNull();

    // The provider's answer for turn 1 arrives after that. It belonged to a question the
    // reader has left, so it must not appear under the new one.
    updateHint({
      busy: false, turnGeneration: 1,
      hint: { explanation: 'An explanation for the old question.', example: 'An old example.' }
    });
    expect(explanation.textContent ?? '').not.toContain('old question');
    expect(block.hidden).toBe(true);

    // A hint for the turn the reader is actually on is still shown.
    updateHint({ busy: true, turnGeneration: 2 });
    updateHint({
      busy: false, turnGeneration: 2,
      hint: { explanation: 'An explanation for this question.', example: 'A current example.' }
    });
    expect(explanation.textContent ?? '').toContain('this question');
    expect(block.hidden).toBe(false);
  });

  it('V132 accepts a current hint after a full render and re-enables Hint', () => {
    // Added 2026-09-21: a speaker toggle replaces the document while Hint is pending. The
    // full renderer must carry the same turn token that the busy patch put on the old node.
    const state = createTutorViewState();
    Object.assign(state.conversation, {
      status: 'active', replies: 'standard', currentQuestion: 'What happened?', hintBusy: true
    });
    const options = {
      cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
      activeScreen: 'tutor' as const, tutor: state, proModels: [],
      tutorConversationHintTurnGeneration: 7
    } as Parameters<typeof renderKrenResultViewHtml>[0];
    const rendered = renderKrenResultViewHtml(options);
    const renderedHint = rendered.match(/<div data-tutor-hint[^>]*>/u)?.[0] ?? '';
    const renderedButton = rendered.match(/<button[^>]*data-command="hintTutorConversation"[^>]*>/u)?.[0] ?? '';
    expect(renderedHint).toContain('data-tutor-hint-turn="7"');
    expect(renderedButton).toContain('disabled');

    const root = new FakeElement('div');
    const block = root.appendChild(new FakeElement('div'));
    block.setAttribute('data-tutor-hint', '');
    block.setAttribute('data-tutor-hint-turn', '7');
    const explanation = block.appendChild(new FakeElement('p'));
    explanation.setAttribute('data-tutor-hint-explanation', '');
    const example = block.appendChild(new FakeElement('p'));
    example.setAttribute('data-tutor-hint-example', '');
    const exampleText = example.appendChild(new FakeElement('span'));
    exampleText.setAttribute('data-tutor-hint-example-text', '');
    const control = root.appendChild(new FakeElement('button'));
    control.setAttribute('data-command', 'hintTutorConversation');
    control.disabled = true;
    const document = { querySelector: (selector: string) => root.querySelector(selector) };
    const updateHint = new Function(
      'document', 'HTMLElement', 'HTMLParagraphElement', 'HTMLButtonElement',
      `${panelFunction('updateTutorConversationHint')}\nreturn updateTutorConversationHint;`
    )(document, FakeElement, FakeElement, FakeElement) as (message: Record<string, unknown>) => void;

    updateHint({
      busy: false, turnGeneration: 7,
      hint: { explanation: 'Use a past-tense event.', example: 'I visited a museum yesterday.' }
    });
    expect(explanation.textContent).toBe('Use a past-tense event.');
    expect(exampleText.textContent).toBe('I visited a museum yesterday.');
    expect(block.hidden).toBe(false);
    expect(control.disabled).toBe(false);
  });

  it('V131 disables stopped Live Replay when the host reports its stored audio was cleared', () => {
    const replay = new FakeElement('button');
    replay.setAttribute('data-command', 'replayTutorQuestion');
    replay.setAttribute('data-tutor-replay-mode', 'conversation');
    replay.setAttribute('data-tutor-replay-conversation-available', 'true');
    replay.setAttribute('aria-pressed', 'false');
    const speaker = new FakeElement('button');
    speaker.setAttribute('aria-pressed', 'true');
    class SelectElement extends FakeElement {
      public value = 'liveGemini';
      public constructor() { super('select'); }
    }
    const replies = new SelectElement();
    const document = { querySelector(selector: string) {
      if (selector === '[data-command="replayTutorQuestion"]') return replay;
      if (selector === '[data-command="toggleTutorConversationSpeaker"]') return speaker;
      if (selector === '[data-tutor-conversation-replies]') return replies;
      return null;
    } };
    const source = `${panelFunction('updateTutorConversationReplay')}\n${panelFunction('updateTutorReplayMode')}`;
    const update = new Function(
      'document', 'HTMLElement', 'HTMLButtonElement', 'HTMLSelectElement',
      `${source}\nreturn updateTutorConversationReplay;`
    )(document, FakeElement, FakeElement, SelectElement) as (available: boolean) => void;

    update(false);
    expect(replay.getAttribute('data-tutor-replay-conversation-available')).toBe('false');
    expect(replay.disabled).toBe(true);
  });

  it('V131 creates hidden eligible feedback, then Correction As you go reveals it in place', () => {
    // Added 2026-09-20: rendering the transcript whole already created this hidden node. This
    // regression drives the mounted completion patch while Correction is When you stop, then
    // executes the panel's own mode synchronizer after the reader chooses As you go.
    class SelectElement extends FakeElement {
      public constructor(public value: string) { super('select'); }
      public get selectedOptions(): Array<{ textContent: string }> {
        return [{ textContent: this.value }];
      }
    }
    const root = new FakeElement('div');
    const pending = root.appendChild(new FakeElement('div'));
    pending.setAttribute('data-tutor-pending', '');
    const coaching = new SelectElement('afterwards');
    root.appendChild(coaching);
    coaching.setAttribute('data-tutor-conversation-coaching', '');
    // Changed 2026-09-23: feedback visibility no longer depends on a global Answers control.
    const composer = root.appendChild(new FakeElement('div'));
    composer.setAttribute('data-tutor-composer', '');
    const document = {
      querySelector(selector: string) {
        if (selector === '[data-tutor-live-reply]') return null;
        return root.querySelector(selector);
      },
      querySelectorAll: (selector: string) => root.querySelectorAll(selector),
      createElement: (tag: string) => new FakeElement(tag),
      createTextNode: (text: string) => {
        const node = new FakeElement('#text');
        node.textContent = text;
        return node;
      }
    };
    const commitSource = `${optionalPanelFunction('updateTutorConversationHint')}\n${optionalPanelFunction('applyTutorLiveTeaching')}
${optionalPanelFunction('patchTutorLiveCoaching')}
${panelFunction('commitTutorLiveTurn')}`;
    const commit = new Function(
      'document', 'HTMLElement', 'HTMLParagraphElement', 'HTMLButtonElement',
      'markTutorLiveConversationReady', 'updateTutorConversationDiagnosis',
      // 2026-10-01: Picture-trigger integration is guarded in tutorV166.
      `const checkTutorDevelopingPicture = () => {};\n${commitSource}\nreturn commitTutorLiveTurn;`
    )(document, FakeElement, FakeElement, FakeElement, () => undefined, () => undefined) as
      (message: Record<string, unknown>) => void;
    commit({
      index: 0, correction: 'I went home.', explanation: 'Use the past tense.',
      showFeedback: false, feedbackEligible: true, spokenEquivalent: false,
      answeredTurnCount: 1, skippedTurnCount: 0
    });

    const feedback = root.querySelector('[data-tutor-turn-feedback]');
    expect(feedback, 'the Live patch omitted feedback that a later mode can reveal').not.toBeNull();
    expect(feedback?.hidden).toBe(true);

    // Changed 2026-10-02: Include the shared summary dependency while preserving the feedback reveal guard.
    const syncSource = `${panelFunction('syncTutorPictureMicrophone')}\n${panelFunction('tutorPictureMicrophoneMode')}\n${panelFunction('syncTutorConversationPictureSettings')}\n${panelFunction('syncTutorConversationAdvancedSummary')}\n${panelFunction('tutorConversationAdvancedSummary')}\n${panelFunction('syncTutorConversationMode')}`;
    const sync = new Function(
      'document', 'HTMLElement', 'HTMLParagraphElement', 'HTMLSelectElement',
      // 2026-10-11: V223 also refreshes profile visibility when reply mode changes.
      'updateTutorLiveReplay', 'updateTutorReplayMode', 'applyConditionalSettings',
      `${syncSource}\nreturn syncTutorConversationMode;`
    )(document, FakeElement, FakeElement, SelectElement, () => undefined, () => undefined, () => undefined) as
      (control: FakeElement) => void;
    coaching.value = 'inline';
    sync(coaching);
    expect(feedback?.hidden).toBe(false);
  });

  it('V135 patches one quiet unchecked notice onto a Live turn whose coaching failed', () => {
    const root = new FakeElement('div');
    const pending = root.appendChild(new FakeElement('div'));
    pending.setAttribute('data-tutor-pending', '');
    const document = {
      querySelector(selector: string) {
        if (selector === '[data-tutor-live-reply]') return null;
        return root.querySelector(selector);
      },
      createElement: (tag: string) => new FakeElement(tag),
      createTextNode: (text: string) => {
        const node = new FakeElement('#text');
        node.textContent = text;
        return node;
      }
    };
    const source = `${optionalPanelFunction('updateTutorConversationHint')}\n${optionalPanelFunction('applyTutorLiveTeaching')}
${optionalPanelFunction('patchTutorLiveCoaching')}
${panelFunction('commitTutorLiveTurn')}`;
    const commit = new Function(
      'document', 'HTMLElement', 'HTMLParagraphElement', 'HTMLButtonElement',
      'markTutorLiveConversationReady', 'updateTutorConversationDiagnosis',
      // 2026-10-01: These isolated coaching tests stub the new commit-only picture check.
      `const checkTutorDevelopingPicture = () => {};\n${source}\nreturn commitTutorLiveTurn;`
    )(document, FakeElement, FakeElement, FakeElement, () => undefined, () => undefined) as
      (message: Record<string, unknown>) => void;

    commit({
      index: 0, coachingFailed: true, correction: '', explanation: '',
      feedbackEligible: false, answeredTurnCount: 1, skippedTurnCount: 0
    });

    const notices = root.querySelectorAll('[data-tutor-coaching-failed]');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.textContent).toBe('KREN could not check this turn.');
    expect(root.querySelector('[data-tutor-turn-feedback]')).toBeNull();
  });

  it('V150 patches the generated scene and opening into the mounted conversation', () => {
    // Added 2026-09-24 for V150 mutation probe 6: the host deliberately does not replace the
    // active document, so this panel message is the only path that can reveal either field.
    const scene = new FakeElement('div');
    scene.setAttribute('data-tutor-scene', '');
    scene.hidden = true;
    const sceneText = scene.appendChild(new FakeElement('p'));
    sceneText.setAttribute('data-tutor-scene-text', '');
    const transcript = new FakeElement('div');
    transcript.setAttribute('data-tutor-transcript', '');
    const typing = transcript.appendChild(new FakeElement('div'));
    typing.setAttribute('data-tutor-typing', '');
    // Changed 2026-09-24 after the owner chose spoken Live opening B: a partial Live opening
    // must be removed if that opening fails and this structured fallback takes over.
    const partialLiveOpening = transcript.appendChild(new FakeElement('div'));
    partialLiveOpening.setAttribute('data-tutor-live-reply', '');
    const document = {
      // 2026-10-11: Opening patches can hide both mounted composer controls.
      querySelectorAll: (_selector: string) => [],
      querySelector(selector: string) {
        if (selector === '[data-tutor-scene]') return scene;
        if (selector === '[data-tutor-transcript]') return transcript;
        return null;
      },
      createTextNode: (text: string) => { const node = new FakeElement('#text'); node.textContent = text; return node; },
    createElement: (tag: string) => new FakeElement(tag)
    };
    const ready = vi.fn();
    const patchOpening = new Function(
      'document', 'HTMLElement', 'HTMLParagraphElement', 'HTMLButtonElement',
      'markTutorLiveConversationReady',
      `${panelFunction('patchTutorConversationScene')}\n` +
      `${panelFunction('patchTutorConversationOpening')}\nreturn patchTutorConversationOpening;`
    )(document, FakeElement, FakeElement, FakeElement, ready) as
      (message: Record<string, unknown>) => void;

    patchOpening({
      command: 'tutorConversationOpeningReady',
      scene: 'The interviewer has only twenty minutes and expects specific evidence.',
      opening: 'Which result best demonstrates your leadership?'
    });

    expect(sceneText.textContent)
      .toBe('The interviewer has only twenty minutes and expects specific evidence.');
    expect(scene.hidden).toBe(false);
    expect(transcript.children).toHaveLength(1);
    expect(transcript.children[0]).toMatchObject({ className: 'tutor-chat-kren' });
    expect(transcript.children[0]?.getAttribute('data-tutor-kren-bubble')).toBe('');
    expect(transcript.children[0]?.textContent)
      .toBe('Which result best demonstrates your leadership?');
    expect(ready).toHaveBeenCalledOnce();
  });

  it('V150 reveals a Live scene without inserting or enabling an opening bubble', () => {
    // Added 2026-09-24 after the owner chose spoken Live opening B: scene casting completes
    // before the socket, while the first bubble remains owned by Gemini's later transcription.
    const scene = new FakeElement('div');
    scene.setAttribute('data-tutor-scene', '');
    scene.hidden = true;
    const sceneText = scene.appendChild(new FakeElement('p'));
    sceneText.setAttribute('data-tutor-scene-text', '');
    const transcript = new FakeElement('div');
    transcript.setAttribute('data-tutor-transcript', '');
    const typing = transcript.appendChild(new FakeElement('div'));
    typing.setAttribute('data-tutor-typing', '');
    const document = {
      querySelector(selector: string) {
        if (selector === '[data-tutor-scene]') return scene;
        if (selector === '[data-tutor-transcript]') return transcript;
        return null;
      }
    };
    const patchScene = new Function(
      'document', 'HTMLElement', 'HTMLParagraphElement',
      `${panelFunction('patchTutorConversationScene')}\nreturn patchTutorConversationScene;`
    )(document, FakeElement, FakeElement) as (message: Record<string, unknown>) => void;

    patchScene({
      command: 'tutorConversationSceneReady',
      scene: 'The interviewer is rushed and expects one concrete example.'
    });

    expect(sceneText.textContent)
      .toBe('The interviewer is rushed and expects one concrete example.');
    expect(scene.hidden).toBe(false);
    expect(transcript.children).toEqual([typing]);
    expect(transcript.querySelector('[data-tutor-kren-bubble]')).toBeNull();
    expect(panelScript()).toContain(
      "if (message.command === 'tutorConversationSceneReady') patchTutorConversationScene(message);"
    );
  });

  it('V154 appends each spoken demo line through the mounted-page patch as a named non-reader bubble', () => {
    const transcript = new FakeElement('div');
    transcript.setAttribute('data-tutor-transcript', '');
    const document = {
      querySelector: (selector: string) => selector === '[data-tutor-transcript]' ? transcript : null,
      createTextNode: (text: string) => { const node = new FakeElement('#text'); node.textContent = text; return node; },
    createElement: (tag: string) => new FakeElement(tag)
    };
    const appendDemo = new Function(
      'document', 'HTMLElement', 'HTMLParagraphElement',
      `${panelFunction('appendTutorConversationDemoLine')}\nreturn appendTutorConversationDemoLine;`
    )(document, FakeElement, FakeElement) as (message: Record<string, unknown>) => void;

    appendDemo({ speaker: 'female', name: 'Mina', text: 'How can I help?' });
    appendDemo({ speaker: 'male', name: 'Tom', text: 'Could I change my appointment?' });

    expect(transcript.children).toHaveLength(2);
    expect(transcript.children.map((bubble) => bubble.className)).toEqual([
      'tutor-chat-demo tutor-chat-demo-female',
      'tutor-chat-demo tutor-chat-demo-male'
    ]);
    expect(transcript.children.map((bubble) => bubble.getAttribute('aria-label')))
      .toEqual(['Mina', 'Tom']);
    expect(transcript.children.map((bubble) => bubble.textContent))
      .toEqual(['MinaHow can I help?', 'TomCould I change my appointment?']);
    expect(transcript.querySelector('[data-tutor-learner-turn]')).toBeNull();
    expect(panelScript()).toContain(
      "if (message.command === 'tutorConversationDemoLine') appendTutorConversationDemoLine(message);"
    );
  });
});

describe('joining Live transcript pieces', () => {
  it.each([
    ['How can I help you today?', 'Is it a slow drip', ' Is it a slow drip'],
    ['That sounds urgent.', 'I can help', ' I can help'],
    ['Hello, this is', ' Apex', ' Apex'],
    ['I go', 'ing home', 'ing home'],
    ['It costs 3.', '50 dollars', '50 dollars'],
    ['', 'Hello', 'Hello']
  ])('joins %j and %j as %j', (previous, fragment, expected) => {
    expect(liveTranscriptFragment(previous, fragment)).toBe(expected);
  });
});
