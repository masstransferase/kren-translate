// 2026-10-10: V216 renames reader-facing Gemini profiles Free Tier and Paid; exact expectations follow the brief.
import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { TUTOR_MAP } from '@kren/core/tutor';

const configuredSpeechProvider = vi.hoisted(() => ({ value: 'gemini' }));

vi.mock('vscode', () => ({
  // 2026-10-04: Rendering now reads VS Code's current theme kind for Follow VS Code.
  window: { activeColorTheme: { kind: 1 } },
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) =>
        key === 'tutor.speechProvider' ? configuredSpeechProvider.value : fallback
    })
  },
  Uri: { joinPath: (...parts: unknown[]) => parts }
}));

import { KrenResultsViewProvider } from '../src/resultsView.js';
import {
  renderKrenResultViewHtml,
  renderTutorConversation,
  renderTutorExercises
} from '../src/resultViewHtml.js';
import {
  createTutorViewState,
  resolveTutorSpeechRoute,
  type TutorViewState
} from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

function practiceState(): TutorViewState {
  const state = createTutorViewState();
  state.exerciseSet = {
    schemaVersion: 1,
    mapVersion: '1.0.0',
    channel: 'written',
    exercises: [{
      id: 'practice-1',
      channel: 'written',
      prompt: 'Tell me what you did yesterday.',
      targetIds: [TUTOR_MAP[0]!.id]
    }]
  };
  state.answers['practice-1'] = 'I already typed this.';
  return state;
}

function geminiProvider(options: {
  startError?: Error;
  transcript?: string | Error;
} = {}) {
  const postMessage = vi.fn(async (_message: unknown) => true);
  const recording = {
    filePath: 'temporary.wav',
    finish: vi.fn(async (consume: (
      audio: Uint8Array,
      format: { sampleRate: number; channels: number; bitsPerSample: number }
    ) => Promise<string>) => consume(
      Uint8Array.from([1]),
      { sampleRate: 11_025, channels: 1, bitsPerSample: 16 }
    )),
    cancel: vi.fn(async () => undefined)
  };
  const recorder = {
    start: options.startError
      ? vi.fn(async () => { throw options.startError; })
      : vi.fn(async () => recording)
  };
  const actions = {
    notify: vi.fn(),
    log: vi.fn(),
    transcribeTutorAudio: options.transcript instanceof Error
      ? vi.fn(async () => { throw options.transcript; })
      : vi.fn(async () => options.transcript ?? 'I dictated this.'),
    generateTutor: vi.fn(async (_request: unknown) => ({
      move: 'reaction',
      reply: 'Thanks for telling me.',
      // 2026-10-11: the Fast validator needs a valid reaction quote and target field.
      replyQuote: 'Thanks for telling me.', targetId: '',
      correction: typeof options.transcript === 'string' ? options.transcript : 'I dictated this.',
      explanation: 'The answer is clear.',
      rephrase: typeof options.transcript === 'string' ? options.transcript : 'I dictated this.',
      rephraseWhy: 'The original is natural.',
      nextQuestion: 'What happened after that?'
    })),
    settings: vi.fn(() => ({
      ...PANEL_SETTINGS_FIXTURE,
      credentialPresence: { geminiDefault: true }
    }))
  };
  const provider = new KrenResultsViewProvider(
    actions as never,
    {} as never,
    { detect: vi.fn(async () => undefined), toggle: vi.fn() },
    recorder as never
  );
  const internals = provider as unknown as {
    tutorState: TutorViewState;
    view: { webview: {
      postMessage: typeof postMessage;
      html: string;
      cspSource: string;
      asWebviewUri(value: unknown): { toString(): string };
    } };
    handleMessage(message: unknown): Promise<void>;
  };
  internals.tutorState = practiceState();
  internals.tutorState.speech.handyStatus = 'notFound';
  internals.view = { webview: {
    postMessage,
    html: '',
    cspSource: 'vscode-webview://test',
    asWebviewUri: (_value: unknown) => ({ toString: () => 'vscode-webview://test/asset' })
  } };
  return { actions, internals, postMessage, recorder, recording };
}

describe('V97 KREN owned dictation', () => {
  it('R1 auto prefers Handy, then Gemini, and every unavailable route says why', () => {
    expect(resolveTutorSpeechRoute('auto', 'available', true)).toEqual({ provider: 'handy' });
    expect(resolveTutorSpeechRoute('auto', 'notFound', true)).toEqual({ provider: 'gemini' });
    expect(resolveTutorSpeechRoute('auto', 'notFound', false).reason)
      .toMatch(/Handy was not found.+Gemini Free Tier API key/iu);
    expect(resolveTutorSpeechRoute('handy', 'notFound', true).reason).toMatch(/Handy was not found/iu);
    expect(resolveTutorSpeechRoute('gemini', 'available', false).reason)
      .toMatch(/Gemini Free Tier API key/iu);
    expect(resolveTutorSpeechRoute('off', 'available', true).reason).toMatch(/turned off/iu);
  });

  it('R2 enables Gemini only with a key and explains the selected unavailable route', () => {
    const state = practiceState();
    state.speech.handyStatus = 'notFound';
    const enabled = load(renderTutorExercises(state, 'gemini', true))(
      'button[data-command="dictateTutorExercise"]'
    );
    expect(enabled.is('[disabled]')).toBe(false);
    expect(enabled.attr('title')).toMatch(/Gemini/iu);
    const missing = load(renderTutorExercises(state, 'gemini', false))(
      'button[data-command="dictateTutorExercise"]'
    );
    expect(missing.is('[disabled]')).toBe(true);
    expect(missing.attr('title')).toMatch(/Gemini Free Tier API key/iu);

    const page = load(renderKrenResultViewHtml({
      cspSource: 'test', nonce: 'test', settings: {
        ...PANEL_SETTINGS_FIXTURE,
        credentialPresence: { geminiDefault: true }
      },
      activeScreen: 'tutor', tutor: state, tutorSpeechProvider: 'gemini', proModels: []
    }));
    const reachable = page('button[data-command="dictateTutorExercise"]');
    expect(reachable).toHaveLength(1);
    expect(reachable.closest('details')).toHaveLength(0);
  });

  it('R3 states plainly in the setting itself that the Gemini route sends voice audio to Google', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      contributes: { configuration: { properties: Record<string, {
        description: string;
        enumDescriptions: string[];
      }> } };
    };
    const setting = manifest.contributes.configuration.properties['kren.tutor.speechProvider']!;
    expect(`${setting.description} ${setting.enumDescriptions.join(' ')}`)
      .toMatch(/voice audio is sent to Google/iu);
  });

  it('R4 starts, stops, transcribes, and reports the measured device WAV format in place', async () => {
    const { actions, internals, postMessage, recorder, recording } = geminiProvider();
    await internals.handleMessage({ command: 'dictateTutorExercise', exerciseId: 'practice-1' });
    expect(recorder.start).toHaveBeenCalledOnce();
    expect(internals.tutorState.speech.dictatingExerciseId).toBe('practice-1');
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      command: 'tutorDictationState', exerciseId: 'practice-1', state: 'recording', provider: 'gemini'
    }));

    await internals.handleMessage({ command: 'dictateTutorExercise', exerciseId: 'practice-1' });
    expect(recording.finish).toHaveBeenCalledOnce();
    expect(actions.transcribeTutorAudio).toHaveBeenCalledOnce();
    expect(actions.log).toHaveBeenCalledWith(expect.stringMatching(/11025 Hz, 1 channel, 16 bit/iu));
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      command: 'tutorDictationState', state: 'idle', transcript: 'I dictated this.'
    }));
    expect(internals.tutorState.speech.dictatingExerciseId).toBeUndefined();
  });

  it('R5 makes the webview append the transcript to the live textarea and sync it back', () => {
    const output = renderKrenResultViewHtml({
      cspSource: 'test', nonce: 'test', settings: {
        ...PANEL_SETTINGS_FIXTURE,
        credentialPresence: { geminiDefault: true }
      },
      activeScreen: 'tutor', tutor: practiceState(), tutorSpeechProvider: 'gemini', proModels: []
    });
    const handler = output.slice(output.indexOf("if (message.command === 'tutorDictationState')"));
    expect(handler).toContain("textarea[data-tutor-exercise=\"");
    expect(handler).toMatch(/answer\.value\s*=\s*answer\.value\s*\+\s*separator\s*\+\s*message\.transcript/u);
    expect(handler).toContain("command: 'updateTutorAnswer'");
    expect(handler).not.toContain('window.location.reload');
  });

  it('R6 names a microphone start failure', async () => {
    const { actions, internals } = geminiProvider({ startError: new Error('no input device') });
    await internals.handleMessage({ command: 'dictateTutorExercise', exerciseId: 'practice-1' });
    expect(actions.notify).toHaveBeenCalledWith(
      'error', expect.stringMatching(/microphone.+could not start.+no input device/iu)
    );
  });

  it('R7 names a provider failure and an empty transcript', async () => {
    const failed = geminiProvider({ transcript: new Error('provider unavailable') });
    await failed.internals.handleMessage({ command: 'dictateTutorExercise', exerciseId: 'practice-1' });
    await failed.internals.handleMessage({ command: 'dictateTutorExercise', exerciseId: 'practice-1' });
    expect(failed.actions.notify).toHaveBeenCalledWith(
      'error', expect.stringMatching(/Gemini transcription failed.+provider unavailable/iu)
    );

    const empty = geminiProvider({ transcript: '   ' });
    await empty.internals.handleMessage({ command: 'dictateTutorExercise', exerciseId: 'practice-1' });
    await empty.internals.handleMessage({ command: 'dictateTutorExercise', exerciseId: 'practice-1' });
    expect(empty.actions.notify).toHaveBeenCalledWith(
      'error', expect.stringMatching(/empty transcript/iu)
    );
  });
});

describe('V109 conversation dictation', () => {
  function activeConversation(): TutorViewState {
    const state = createTutorViewState();
    Object.assign(state.conversation, {
      status: 'active',
      // Changed 2026-09-20: V125 defaults to Live and automatic send. These dictation tests
      // exercise the Standard manual-send route unless a case explicitly changes Send.
      replies: 'standard',
      // Changed 2026-10-18: V263, owner item I43, Standard dictation always sends on stop.
      send: 'stopSpeaking',
      currentQuestion: 'What happened next?',
      draftAnswer: ''
    });
    return state;
  }

  it('renders the practice microphone treatment beside the speaker in every active state', () => {
    const cases = [
      { name: 'ready', provider: 'gemini' as const, key: true, disabled: false },
      { name: 'speech unavailable', provider: 'gemini' as const, key: false, disabled: true },
      { name: 'turn busy', provider: 'gemini' as const, key: true, busy: true, disabled: true },
      { name: 'recording', provider: 'gemini' as const, key: true, dictating: true, disabled: false },
      { name: 'transcribing', provider: 'gemini' as const, key: true, transcribing: true, disabled: true },
      { name: 'another transcription', provider: 'gemini' as const, key: true,
        exerciseTranscribing: true, disabled: true }
    ];
    for (const entry of cases) {
      const state = activeConversation();
      state.conversation.busy = Boolean(entry.busy);
      state.speech.dictatingConversation = entry.dictating || undefined;
      state.speech.transcribingConversation = entry.transcribing || undefined;
      state.speech.transcribingExerciseId = entry.exerciseTranscribing ? 'practice-1' : undefined;
      state.speech.dictationProvider = entry.dictating || entry.transcribing ? 'gemini' : undefined;
      const $ = load(renderTutorConversation(state, entry.provider, entry.key));
      const audio = $('[data-tutor-chat-microphone]');
      // Changed 2026-09-20: V127 moves speaker left and leaves microphone first on the right.
      const microphone = audio.find('[data-command="dictateTutorConversation"]');
      const speaker = $('[data-tutor-composer-actions]').children().first();
      expect(speaker.is('[data-command="toggleTutorConversationSpeaker"]'), entry.name).toBe(true);
      expect(microphone.is('button[data-command="dictateTutorConversation"]'), entry.name).toBe(true);
      expect(microphone.attr('data-tutor-exercise'), entry.name).toBeUndefined();
      expect(microphone.hasClass('icon-button'), entry.name).toBe(true);
      expect(microphone.hasClass('tutor-action-icon'), entry.name).toBe(true);
      expect(microphone.is('[disabled]'), entry.name).toBe(entry.disabled);
      expect(microphone.attr('aria-pressed'), entry.name).toBe(entry.dictating ? 'true' : 'false');
      expect(microphone.hasClass('tutor-dictation-active'), entry.name).toBe(Boolean(entry.dictating));
      expect(microphone.hasClass('tutor-microphone-pulsing'), entry.name)
        .toBe(Boolean(entry.dictating));
      expect(microphone.attr('aria-label'), entry.name).toMatch(/conversation answer/iu);
      expect(microphone.attr('title'), entry.name).toBeTruthy();
      if (entry.name === 'ready') {
        const practice = load(renderTutorExercises(practiceState(), 'gemini', true))(
          'button[data-command="dictateTutorExercise"]'
        );
        expect(microphone.find('svg').html()).toBe(practice.find('svg').html());
      }
    }
  });

  it('sends exactly the dictated words without a conversation draft', async () => {
    const dictated = 'The exact words from the microphone.';
    const { actions, internals } = geminiProvider({ transcript: dictated });
    internals.tutorState = activeConversation();
    internals.tutorState.speech.handyStatus = 'notFound';

    await internals.handleMessage({ command: 'dictateTutorConversation' });
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    // Changed 2026-10-18: V263, owner item I43, dictation submits directly without a draft or Send.
    expect(internals.tutorState.conversation.draftAnswer).toBe('');
    expect(actions.generateTutor).toHaveBeenCalledOnce();

    await internals.handleMessage({ command: 'submitTutorConversationTurn' });
    await vi.waitFor(() => expect(internals.tutorState.conversation.busy).toBe(false));
    const request = actions.generateTutor.mock.calls[0]?.[0] as { input: string };
    expect(JSON.parse(request.input).learnerAnswer).toBe(dictated);
  });

  it('V115 submits a Gemini transcript at once only when Send is When I stop speaking', async () => {
    const dictated = 'Gemini sends this when speech stops.';
    const automatic = geminiProvider({ transcript: dictated });
    automatic.internals.tutorState = activeConversation();
    automatic.internals.tutorState.conversation.send = 'stopSpeaking';
    automatic.internals.tutorState.speech.handyStatus = 'notFound';

    await automatic.internals.handleMessage({ command: 'dictateTutorConversation' });
    await automatic.internals.handleMessage({ command: 'dictateTutorConversation' });
    await vi.waitFor(() => expect(automatic.internals.tutorState.conversation.busy).toBe(false));
    expect(automatic.actions.generateTutor).toHaveBeenCalledOnce();
    const automaticRequest = automatic.actions.generateTutor.mock.calls[0]?.[0] as { input: string };
    expect(JSON.parse(automaticRequest.input).learnerAnswer).toBe(dictated);

    const manual = geminiProvider({ transcript: dictated });
    manual.internals.tutorState = activeConversation();
    manual.internals.tutorState.conversation.send = 'stopSpeaking'; // Changed 2026-10-18: V263, owner item I43, every runtime turn sends on speech stop.
    manual.internals.tutorState.speech.handyStatus = 'notFound';
    await manual.internals.handleMessage({ command: 'dictateTutorConversation' });
    await manual.internals.handleMessage({ command: 'dictateTutorConversation' });
    // Changed 2026-10-18: V263, owner item I43, every dictated turn is sent when speech stops.
    expect(manual.internals.tutorState.conversation.draftAnswer).toBe('');
    expect(manual.actions.generateTutor).toHaveBeenCalledOnce();
  });

  it('V115 submits Handy paste after 800 ms of quiet and never submits typed input', () => {
    vi.useFakeTimers();
    try {
      const output = renderKrenResultViewHtml({
        cspSource: 'test', nonce: 'test', settings: {
          ...PANEL_SETTINGS_FIXTURE, credentialPresence: { geminiDefault: true }
        },
        activeScreen: 'tutor', tutor: activeConversation(), tutorSpeechProvider: 'handy',
        proModels: []
      });
      const start = output.indexOf('let cancelTutorHandyAutoSend');
      const end = output.indexOf("document.addEventListener('click'", start);
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      expect(output).toContain("target.getAttribute('aria-pressed') === 'true'");
      expect(output).toContain("target.getAttribute('data-tutor-dictation-provider') === 'handy'");

      class TestInputEvent {
        public constructor(public readonly inputType: string) {}
      }
      class TestTextArea {
        public value = '';
        public isConnected = true;
        private inputListener: ((event: TestInputEvent) => void) | undefined;
        public addEventListener(_name: string, listener: (event: TestInputEvent) => void): void {
          this.inputListener = listener;
        }
        public removeEventListener(_name: string, listener: (event: TestInputEvent) => void): void {
          if (this.inputListener === listener) this.inputListener = undefined;
        }
        public remove(): void {}
        public input(inputType: string): void {
          this.inputListener?.(new TestInputEvent(inputType));
        }
      }
      const postMessage = vi.fn();
      const arm = runInNewContext(
        `${output.slice(start, end)}; armTutorHandyAutoSend;`,
        {
          vscode: { postMessage }, InputEvent: TestInputEvent, HTMLTextAreaElement: TestTextArea,
          document: { querySelector: () => null },
          window: { setTimeout, clearTimeout }
        }
      ) as (answer: TestTextArea) => void;

      const pasted = new TestTextArea();
      arm(pasted);
      pasted.value = 'Handy pasted this answer.';
      pasted.input('insertFromPaste');
      vi.advanceTimersByTime(799);
      expect(postMessage).not.toHaveBeenCalledWith({ command: 'submitTutorConversationTurn' });
      vi.advanceTimersByTime(1);
      // Updated 2026-09-22 for V136: these content-free markers let the host put the
      // existing 800 ms wait on the one Standard timing line. The answer and submit
      // assertions remain, in the same order, after those markers.
      expect(postMessage.mock.calls.map(([message]) => message)).toEqual([
        { command: 'tutorHandyTranscriptReceived' },
        { command: 'tutorHandyQuietPeriodStarted' },
        { command: 'tutorHandyQuietPeriodElapsed' },
        // Changed 2026-09-23: the host records this answer as dictated for per-turn tolerance.
        { command: 'updateTutorConversationAnswer', answer: 'Handy pasted this answer.', spoken: true },
        { command: 'submitTutorConversationTurn' }
      ]);

      postMessage.mockClear();
      const typed = new TestTextArea();
      arm(typed);
      typed.value = 'The reader typed this.';
      typed.input('insertText');
      vi.advanceTimersByTime(15_000);
      expect(postMessage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends dictation state and text to the panel without audio data or credentials', async () => {
    const { internals, postMessage } = geminiProvider({ transcript: 'Panel-safe text.' });
    internals.tutorState = activeConversation();
    internals.tutorState.speech.handyStatus = 'notFound';
    await internals.handleMessage({ command: 'dictateTutorConversation' });
    await internals.handleMessage({ command: 'dictateTutorConversation' });

    const messages = postMessage.mock.calls.map(([message]) => message as Record<string, unknown>);
    // Changed 2026-09-25 for V156: microphone transitions also patch Stop, so retain the
    // original three-message dictation assertion over the messages it was written to specify.
    const dictationMessages = messages.filter((message) => message.command === 'tutorDictationState');
    expect(dictationMessages).toHaveLength(3);
    expect(dictationMessages.at(-1)).toMatchObject({
      command: 'tutorDictationState',
      conversation: true,
      state: 'idle' // Changed 2026-10-18: V263, owner item I43, the submitted transcript is not echoed into a removed text box.
    });
    expect(messages).toContainEqual({
      command: 'tutorConversationStopState', disabled: true,
      title: 'Stop is available when you finish speaking'
    });
    // Changed 2026-10-18: V263, owner item I43, automatic submission can post later speaker updates.
    expect(messages).toContainEqual({
      command: 'tutorConversationStopState', disabled: false, title: 'Stop conversation'
    });
    expect(JSON.stringify(messages)).not.toMatch(/audioBase64|apiKey|credential/iu);
    expect(messages.every((message) => !Object.hasOwn(message, 'audio'))).toBe(true);
  });
});
