// Added 2026-09-25 for V157: the owner asked for bounded conversation replies and an
// instant Rephrase? action on every checked reader turn. These tests pin both the model
// boundary and the mounted-panel path, because an initial-render-only test missed two live bugs.
import { runInNewContext } from 'node:vm';
import { load } from 'cheerio';
import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  commands: { executeCommand: vi.fn() },
  env: { remoteName: undefined },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) }
}));

import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import {
  TUTOR_CONVERSATION_CORRECTIONS_SCHEMA,
  TUTOR_CONVERSATION_TURN_SCHEMA,
  tutorConversationCorrections,
  tutorConversationCorrectionsRequest,
  tutorConversationLiveResumeInstruction,
  tutorConversationLiveSystemInstruction,
  tutorConversationReplyLengthInstruction,
  tutorConversationTurn,
  tutorConversationTurnRequest
} from '../src/tutor/generation.js';
import {
  createTutorViewState,
  tutorConversationPreferences,
  tutorConversationPreferencesOf
} from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

function render(state = createTutorViewState()): string {
  return renderKrenResultViewHtml({
    cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
    activeScreen: 'tutor', tutor: state, proModels: []
  });
}

function panelFunction(name: string): string {
  const scripts = [...render().matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gu)]
    .map((match) => match[1]).join('\n');
  const start = scripts.indexOf(`function ${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return scripts.slice(start, scripts.indexOf('\n    }\n', start) + 6);
}

class FakeElement {
  public readonly attributes = new Map<string, string>();
  public readonly children: FakeElement[] = [];
  public parent: FakeElement | undefined;
  public className = '';
  public hidden = false;
  public disabled = false;
  private text = '';
  public constructor(public readonly tagName: string) {}
  public setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  public getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  public hasAttribute(name: string): boolean { return this.attributes.has(name); }
  public appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  public append(...children: FakeElement[]): void {
    for (const child of children) this.appendChild(child);
  }
  public remove(): void {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = undefined;
  }
  public replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length);
    this.text = '';
    this.append(...children);
  }
  public get textContent(): string {
    return this.children.length ? this.children.map((child) => child.textContent).join('') : this.text;
  }
  public set textContent(value: string) { this.children.length = 0; this.text = value; }
  private descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
  private matches(selector: string): boolean {
    const valued = /^\[([\w-]+)="([^"]*)"\]$/u.exec(selector);
    if (valued) return this.attributes.get(valued[1]!) === valued[2];
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
    for (let current: FakeElement | undefined = this; current; current = current.parent) {
      if (current.matches(selector)) return current;
    }
    return null;
  }
}

describe('V157 reply length and reader rephrasing, 2026-09-25', () => {
  // Added 2026-09-25 in verification of V157. The other tests prove the chosen length reaches
  // every call site, and none checked what each length actually tells the model: changing Short,
  // the default, from "one or two sentences" to "up to five sentences" passed the whole suite.
  // The owner raised over-long replies, so the default's wording is the thing worth pinning.
  it('tells the model the sentence limit each length stands for, and Short by default', () => {
    expect(tutorConversationReplyLengthInstruction('brief')).toContain('one sentence');
    expect(tutorConversationReplyLengthInstruction('short')).toContain('one or two sentences');
    expect(tutorConversationReplyLengthInstruction('medium')).toContain('two or three sentences');
    expect(tutorConversationReplyLengthInstruction('long')).toContain('up to five sentences');
    expect(tutorConversationReplyLengthInstruction()).toBe(tutorConversationReplyLengthInstruction('short'));
    expect(tutorConversationReplyLengthInstruction('short')).not.toContain('five');
  });

  it('renders the four-option Reply length dial after Live transcription language, defaulting to Short', () => {
    const $ = load(render());
    const length = $('[data-tutor-conversation-reply-length]');
    expect(length.find('option').get().map((option) => [$(option).attr('value'), $(option).text()]))
      .toEqual([
        ['brief', 'Brief'], ['short', 'Short'], ['medium', 'Medium'], ['long', 'Long']
      ]);
    expect(length.val()).toBe('short');
    expect(length.closest('.setting').prev().find('.setting-title').text()).toBe('Live transcription language'); // 2026-10-12: Reply thinking was retired.
    expect(length.closest('.setting').find('.setting-description').text())
      .toContain('from the next conversation');
  });

  it('writes, validates, and remembers Reply length with the other conversation preferences', () => {
    const state = createTutorViewState();
    state.conversation.replyLength = 'long';
    expect(tutorConversationPreferencesOf(state.conversation)).toMatchObject({ replyLength: 'long' });
    expect(tutorConversationPreferences({ replyLength: 'brief' })).toEqual({ replyLength: 'brief' });
    expect(tutorConversationPreferences({ replyLength: 'unbounded' })).toEqual({});
  });

  it('sends the chosen limit to Standard, Live, and resumed Live replies', () => {
    const standard = tutorConversationTurnRequest({
      register: 'neutral', recipeTargets: { supportingTargets: [] }, transcript: [],
      question: 'What happened?', learnerAnswer: 'I missed the bus.', replyLength: 'brief'
    });
    const live = tutorConversationLiveSystemInstruction({
      kind: 'anything', register: 'neutral',
      sceneSlant: 'the counterpart is strong, competent, well prepared',
      replyLength: 'medium'
    }, false);
    const resumed = tutorConversationLiveResumeInstruction([], 'long');
    expect(standard.instruction).toContain('one sentence');
    expect(standard.instruction).toContain('sentences in reply and nextQuestion together');
    expect(standard.instruction).toContain('For Brief, omit nextQuestion');
    expect(live).toContain('two or three sentences');
    expect(resumed).toContain('up to five sentences');
    for (const instruction of [standard.instruction, live, resumed]) {
      expect(instruction).toContain('recast counts toward the limit');
      expect(instruction).toContain('must never be cut');
      expect(instruction).toContain('the learner can answer');
    }
  });

  it('requires and validates rephrase and rephraseWhy on turn and deferred correction responses', () => {
    expect(TUTOR_CONVERSATION_TURN_SCHEMA.required).toEqual(expect.arrayContaining([
      'rephrase', 'rephraseWhy'
    ]));
    expect(TUTOR_CONVERSATION_CORRECTIONS_SCHEMA).toMatchObject({
      properties: { corrections: { items: { required: expect.arrayContaining([
        'rephrase', 'rephraseWhy'
      ]) } } }
    });
    expect(tutorConversationTurn({
      move: 'reaction', reply: 'That sounds frustrating. What did you do next?', replyQuote: '',
      correction: 'I missed the bus.', targetId: '', explanation: 'The answer was already natural.',
      rephrase: 'I ended up missing the bus.',
      rephraseWhy: 'This is also natural and fits the setback in KREN\'s question.'
    })).toMatchObject({ rephrase: 'I ended up missing the bus.' });
    expect(tutorConversationCorrections({ corrections: [{
      correction: 'I missed the bus.', targetId: '', explanation: 'The answer was already natural.',
      rephrase: 'I ended up missing the bus.',
      rephraseWhy: 'This is also natural and fits the preceding question.'
    }] }, 1)[0]).toMatchObject({ rephraseWhy: expect.stringContaining('preceding question') });

    const deferred = tutorConversationCorrectionsRequest({
      register: 'neutral', recipeTargets: { supportingTargets: [] },
      turns: [{ question: 'Why were you late?', learnerAnswer: 'I miss bus.' }]
    });
    expect(deferred.instruction).toContain('message in question that the learner was answering');
    expect(deferred.instruction).toContain('already as natural as it can be');
  });

  it('times Rephrase? after checking, after visible correction feedback, and never in a Demo', () => {
    const state = createTutorViewState();
    // 2026-10-11: this visibility probe explicitly exercises As you go rather than the new Stop default.
    Object.assign(state.conversation, { status: 'active', replies: 'standard', coaching: 'inline', currentQuestion: 'Next?' });
    state.conversation.transcript = [
      {
        question: 'How was the trip?', learnerAnswer: 'It was wonderful.',
        correction: 'It was wonderful.', explanation: 'The answer was already natural.',
        rephrase: 'I had a wonderful time.', rephraseWhy: 'This directly answers the trip question.'
      },
      {
        question: 'How did you travel?', learnerAnswer: 'I go by bus.',
        correction: 'I went by bus.', explanation: 'Use the past tense.',
        rephrase: 'I took the bus.', rephraseWhy: 'This is the most natural fit here.'
      },
      {
        question: 'Where next?', learnerAnswer: 'I go home.', correction: '', explanation: '',
        coachingPending: true, rephrase: 'I headed home.', rephraseWhy: 'This is more idiomatic.'
      }
    ];
    const $ = load(render(state));
    expect($('[data-tutor-learner-turn="0"] [data-command="showTutorConversationRephrase"]'))
      .toHaveLength(1);
    const corrected = $('[data-tutor-learner-turn="1"]');
    expect(corrected.find('[data-tutor-turn-feedback]')).toHaveLength(1);
    expect(corrected.find('[data-tutor-turn-feedback] summary').text()).toBe('Why?');
    expect(corrected.find('[data-command="showTutorConversationRephrase"]')).toHaveLength(1);
    expect($('[data-tutor-learner-turn="2"] [data-command="showTutorConversationRephrase"]'))
      .toHaveLength(0);

    state.conversation.demoMode = true;
    state.conversation.demoLines = [{ speaker: 'female', text: 'Welcome.' }];
    expect(load(render(state))('[data-command="showTutorConversationRephrase"]')).toHaveLength(0);
  });

  it.each(['standard', 'liveGemini'] as const)(
    'replaces a showing correction and Why? by in-place patch in %s without replacing the answer box',
    (replies) => {
      const root = new FakeElement('div');
      const turn = root.appendChild(new FakeElement('div'));
      turn.setAttribute('data-tutor-learner-turn', '0');
      turn.setAttribute('data-tutor-replies', replies);
      const bubble = turn.appendChild(new FakeElement('div'));
      const control = bubble.appendChild(new FakeElement('button'));
      control.setAttribute('data-command', 'showTutorConversationRephrase');
      control.setAttribute('data-tutor-rephrase', 'I took the bus.');
      control.setAttribute('data-tutor-rephrase-why', 'This fits KREN\'s travel question naturally.');
      const feedback = turn.appendChild(new FakeElement('div'));
      feedback.setAttribute('data-tutor-turn-feedback', '');
      const correction = feedback.appendChild(new FakeElement('p'));
      correction.setAttribute('data-tutor-correction', '');
      correction.textContent = 'I went by bus.';
      const oldWhy = feedback.appendChild(new FakeElement('details'));
      oldWhy.textContent = 'Why? Use the past tense.';
      const answer = root.appendChild(new FakeElement('textarea'));
      answer.setAttribute('data-tutor-conversation-answer', '');
      answer.textContent = 'The reader is composing the next answer.';
      const messages: Array<Record<string, unknown>> = [];
      const document = {
        createElement: (tag: string) => new FakeElement(tag)
      };
      const show = runInNewContext(
        `${panelFunction('showTutorConversationRephrase')}\nshowTutorConversationRephrase`,
        {
          document, HTMLElement: FakeElement, HTMLButtonElement: FakeElement,
          vscode: { postMessage: (message: Record<string, unknown>) => messages.push(message) }
        }
      ) as (button: FakeElement) => void;

      show(control);

      expect(turn.querySelector('[data-tutor-correction]')).toBeNull();
      expect(turn.querySelector('[data-tutor-rephrase]')?.textContent).toBe('I took the bus.');
      expect(turn.querySelector('[data-tutor-turn-explanation]')?.textContent)
        .toContain('This fits KREN\'s travel question naturally.');
      expect(root.querySelector('[data-tutor-conversation-answer]')).toBe(answer);
      expect(answer.textContent).toBe('The reader is composing the next answer.');
      expect(messages).toEqual([{ command: 'showTutorConversationRephrase', input: '0' }]);
    }
  );

  it.each([
    [' I   took the BUS! ', 'i took the bus.'],
    ['I took the bus?', ' i took  the bus ']
  ])('shows an unchanged rephrase without Why? in the mounted panel', (learnerWords, rephraseWords) => {
    const root = new FakeElement('div');
    const turn = root.appendChild(new FakeElement('div'));
    turn.setAttribute('data-tutor-learner-turn', '0');
    const bubble = turn.appendChild(new FakeElement('div'));
    const spoken = bubble.appendChild(new FakeElement('p'));
    spoken.setAttribute('data-tutor-learner-answer', '');
    spoken.textContent = learnerWords;
    const control = bubble.appendChild(new FakeElement('button'));
    control.setAttribute('data-tutor-rephrase', rephraseWords);
    control.setAttribute('data-tutor-rephrase-why', 'The model supplied a reason.');
    const feedback = turn.appendChild(new FakeElement('div'));
    feedback.setAttribute('data-tutor-turn-feedback', '');
    feedback.appendChild(new FakeElement('p')).textContent = 'An earlier correction.';
    feedback.appendChild(new FakeElement('details')).textContent = 'Why?';
    const answer = root.appendChild(new FakeElement('textarea'));
    answer.textContent = 'Still composing.';
    const messages: Array<Record<string, unknown>> = [];
    const show = runInNewContext(
      `${panelFunction('showTutorConversationRephrase')}\nshowTutorConversationRephrase`,
      {
        document: { createElement: (tag: string) => new FakeElement(tag) },
        HTMLElement: FakeElement, HTMLButtonElement: FakeElement,
        vscode: { postMessage: (message: Record<string, unknown>) => messages.push(message) }
      }
    ) as (button: FakeElement) => void;

    show(control);

    expect(feedback.textContent).toBe('Nothing to rephrase for this chat.');
    expect(feedback.querySelector('[data-tutor-turn-explanation]')).toBeNull();
    expect(root.querySelector('textarea')).toBe(answer);
    expect(answer.textContent).toBe('Still composing.');
    expect(messages).toEqual([{ command: 'showTutorConversationRephrase', input: '0' }]);
  });

  it('keeps the unchanged notice after the conversation renders again', () => {
    const state = createTutorViewState();
    state.conversation.status = 'stopped';
    state.conversation.transcript = [{
      question: 'How did you travel?', learnerAnswer: 'I   took the bus!',
      correction: 'I took the bus!', explanation: 'Already natural.',
      rephrase: 'i took the bus.', rephraseWhy: 'A model reason.', rephraseShown: true
    }];
    const $ = load(render(state));
    const turn = $('[data-tutor-learner-turn="0"]');
    expect(turn.find('[data-tutor-rephrase]').text()).toBe('Nothing to rephrase for this chat.');
    expect(turn.find('[data-tutor-turn-explanation]')).toHaveLength(0);
    expect(turn.find('[data-command="showTutorConversationRephrase"]')).toHaveLength(0);
  });
});
