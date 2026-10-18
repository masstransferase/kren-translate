import { createContext, runInContext } from 'node:vm';
import { CHIRP_24K_MONO_MP3_BASE64 } from './support/chirp24kMonoMp3.js';
import { GoogleChirpSpeech } from '../src/speech/speechCenter.js';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  activeTextEditorState, executeCommand, showErrorMessage, showInformationMessage,
  showWarningMessage, writeText
} = vi.hoisted(() => ({
  activeTextEditorState: { value: undefined as unknown },
  executeCommand: vi.fn(async (..._args: unknown[]) => undefined),
  showErrorMessage: vi.fn(async (_message: string) => undefined),
  showInformationMessage: vi.fn(async (_message: string) => undefined),
  showWarningMessage: vi.fn(async (_message: string): Promise<string | undefined> => undefined),
  writeText: vi.fn(async (_text: string) => undefined)
}));

vi.mock('vscode', () => ({
  commands: { executeCommand },
  env: { clipboard: { writeText }, remoteName: undefined },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
  Uri: {
    joinPath: (base: { path?: string }, ...parts: string[]) => ({
      path: [base.path ?? '', ...parts].join('/'),
      toString() { return this.path; }
    })
  },
  window: {
    get activeTextEditor() { return activeTextEditorState.value; },
    showErrorMessage,
    showInformationMessage,
    showWarningMessage
  }
}));

import { copyTextResult, notify, readSelectedEditorPassage } from '../src/extension.js';
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { REWRITE_MODES, rewriteModeSettingEntries } from '@kren/core/rewrite-modes';
import { userDictionaryEntry } from './userDictionaryFixtures.js';

type MessageListener = (message: unknown) => void;

describe('Start page credential refresh', () => {
  it('updates the mounted Start page when a routed key is added and removed', () => {
    const harness = createHarness();
    const initial = harness.actions.settings();
    const settings = { ...initial, translationProvider: 'gemini', grammarSmart: true,
      userDictionaryEnabled: true, credentialPresence: {} as Record<string, boolean> };
    harness.actions.settings.mockImplementation(() => settings as typeof initial);
    harness.dispatch({ command: 'showStartPage' });
    const translationButton = () => harness.webview.html.match(
      /<button[^>]*data-action="kren.translateSelection"[^>]*>/u
    )?.[0];
    expect(translationButton()).toContain('disabled');
    settings.credentialPresence = { geminiDefault: true };
    harness.provider.refresh();
    expect(translationButton()).toBeDefined();
    expect(translationButton()).not.toContain('disabled');
    settings.credentialPresence = {};
    harness.provider.refresh();
    expect(translationButton()).toContain('disabled');
    harness.provider.dispose();
  });
});

describe('V201 theme commands preserve the mounted panel', () => {
  it.each([
    ['followVSCode', 'dark'], ['light', 'dark'], ['dark', 'light']
  ])('stores the opposite of %s and patches every open panel', async (initial, next) => {
    const first = createHarness(), second = createHarness();
    let theme = initial;
    const base = first.actions.settings();
    first.actions.settings.mockImplementation(() => ({ ...base, panelTheme: theme }) as typeof base);
    first.actions.updateSetting.mockImplementation(async (_key, value) => { theme = String(value); });
    // 2026-10-12: Finish the stubbed startup refresh before comparing mounted documents.
    await settleMessages();
    const before = [first.webview.html, second.webview.html];
    try {
      first.dispatch({ command: 'toggleTheme' });
      await vi.waitFor(() => expect(first.actions.updateSetting).toHaveBeenCalledWith('display.panelTheme', next));
      for (const panel of [first, second]) expect(panel.webview.postMessage).toHaveBeenCalledWith({ command: 'panelThemeChanged', theme: next, kind: 'light' });
      expect([first.webview.html, second.webview.html]).toEqual(before);
      // The saved value is used by a new session's initial render.
      first.provider.render();
      expect(first.webview.html).toContain(`data-kren-theme="${next}"`);
    } finally { first.provider.dispose(); second.provider.dispose(); }
  });

  it('stores Follow VS Code through the settings write path without replacing the document', async () => {
    const harness = createHarness();
    // 2026-10-12: Finish the stubbed startup refresh before comparing mounted documents.
    await settleMessages();
    const before = harness.webview.html;
    try {
      harness.dispatch({ command: 'updateSetting', key: 'display.panelTheme', value: 'followVSCode' });
      await vi.waitFor(() => expect(harness.actions.updateSetting).toHaveBeenCalledWith('display.panelTheme', 'followVSCode'));
      expect(harness.webview.postMessage).toHaveBeenCalledWith({ command: 'panelThemeChanged', theme: 'followVSCode', kind: 'light' });
      expect(harness.webview.html).toBe(before);
      harness.dispatch({ command: 'updateSetting', key: 'display.panelTheme', value: 'invalid' });
      await Promise.resolve();
      expect(harness.actions.updateSetting).toHaveBeenCalledTimes(1);
    } finally { harness.provider.dispose(); }
  });
});

describe('the tutor editor-passage host action', () => {
  it('V63 R1 returns the exact single editor selection and undefined without an editor', () => {
    activeTextEditorState.value = undefined;
    expect(readSelectedEditorPassage()).toBeUndefined();

    const selection = { isEmpty: false };
    const passage = '  Keep the exact selected whitespace.\nAnd the second line.  ';
    const getText = vi.fn(() => passage);
    activeTextEditorState.value = {
      selections: [selection],
      document: { getText }
    };

    expect(readSelectedEditorPassage()).toBe(passage);
    expect(getText).toHaveBeenCalledWith(selection);
    activeTextEditorState.value = undefined;
  });
});

function createHarness(
  overrides: Record<string, unknown> = {},
  recorder?: { start(): Promise<unknown> },
  // 2026-10-12: Default discovery is deterministic and never inspects this PC.
  handy: { detect(): Promise<string | undefined>; toggle(executable: string): Promise<void> } = { detect: vi.fn(async () => undefined), toggle: vi.fn(async () => {}) }
) {
  let receiveMessage: MessageListener | undefined;
  let changeVisibility: (() => void) | undefined;
  const actions = {
    notify: vi.fn((kind: 'information' | 'warning' | 'error', message: string) => {
      if (kind === 'information') void showInformationMessage(message);
      if (kind === 'warning') void showWarningMessage(message);
      if (kind === 'error') void showErrorMessage(message);
    }),
    copy: vi.fn(async () => undefined),
    details: vi.fn(),
    replace: vi.fn(async () => undefined),
    copyText: vi.fn(async () => undefined),
    replaceText: vi.fn(async () => undefined),
    applyGrammarChoices: vi.fn(async () => undefined),
    manageGrammarIssue: vi.fn(async () => undefined),
    readAloudText: vi.fn(async () => undefined),
    stopReadAloud: vi.fn(),
    clear: vi.fn(),
    loadUserDictionary: vi.fn(async () => []),
    saveUserDictionaryEntry: vi.fn(),
    deleteUserDictionaryEntry: vi.fn(async () => []),
    deleteUserDictionaryEntries: vi.fn(async () => []),
    previewUserDictionaryPurge: vi.fn(),
    confirmUserDictionaryPurge: vi.fn(),
    previewUserDictionaryImport: vi.fn(),
    applyUserDictionaryImport: vi.fn(async () => []),
    exportUserDictionary: vi.fn(async () => undefined),
    regenerateUserDictionaryEntry: vi.fn(),
    updateSetting: vi.fn(async (
      _key: string,
      _value: string | number | boolean
    ) => undefined),
    updateTutorVoiceSetting: vi.fn(async () => undefined),
    runCommand: vi.fn(async () => undefined),
    rerunOperation: vi.fn(async () => undefined),
    log: vi.fn(),
    settings: vi.fn(() => ({
      userDictionaryEnabled: true,
      userDictionaryCaptureMode: 'llmOnly',
      userDictionaryFallbackOnMerriamWebsterNoMatch: false,
      userDictionaryProvider: 'gemini',
      userDictionaryModel: 'gemini-3.5-flash',
      userDictionaryAlternateModel: 'gemini-3.1-pro-preview',
      userDictionaryThinkingOrEffort: 'low',
      userDictionaryProfile: 'standard',
      userDictionaryFallbackEnabled: false,
      userDictionaryFallbackModel: 'gemini-3.5-flash',
      userDictionaryFallbackThinkingOrEffort: 'low',
      userDictionaryEntryLanguage: 'auto',
      userDictionaryIncludePronunciation: true,
      userDictionaryIncludeSynonyms: true,
      userDictionaryIncludeUsageNotes: true,
      userDictionaryNumberOfExamples: 2,
      userDictionaryIncludeTechnicalMeanings: true,
      openResultsAtStartup: false,
      translationProvider: 'googleCloudTranslation',
      translationSourceLanguage: 'auto',
      translationTargetLanguage: 'ko',
      translationRoutingProvider: 'gemini',
      translationModel: 'gemini-3.6-flash',
      translationAlternateModel: 'gemini-3.1-pro-preview',
      translationThinkingOrEffort: 'auto',
      translationProfile: 'standard',
      translationFallbackEnabled: false,
      translationFallbackModel: 'gemini-3.5-flash',
      translationFallbackThinkingOrEffort: 'low',
      grammarDialect: 'american',
      grammarSmart: false,
      grammarAutoCheck: false,
      grammarAutoCheckDelayMs: 900,
      grammarCustomWordCount: 0,
      grammarIgnoredFindingCount: 0,
      explanationOutputLanguage: 'sameAsSource',
      explanationProvider: 'gemini',
      explanationModel: 'gemini-3.5-flash',
      explanationAlternateModel: 'gemini-3.1-pro-preview',
      explanationThinkingOrEffort: 'auto',
      explanationProfile: 'standard',
      explanationFallbackEnabled: true,
      explanationFallbackModel: 'gemini-3.5-flash',
      explanationFallbackThinkingOrEffort: 'low',
      rewriteProvider: 'gemini',
      rewriteModel: 'gemini-3.5-flash',
      rewriteAlternateModel: 'gemini-3.1-pro-preview',
      rewriteThinkingOrEffort: 'auto',
      rewriteFallbackEnabled: true,
      rewriteFallbackModel: 'gemini-3.5-flash',
      rewriteFallbackThinkingOrEffort: 'low',
      rewriteSourceLanguage: 'auto',
      rewriteEnglishVariety: 'followGrammar',
      geminiModel: 'gemini-3.5-flash',
      geminiThinkingLevel: 'auto',
      openAIModel: 'gpt-5.4',
      openAIReasoningEffort: 'low',
      anthropicModel: 'claude-sonnet-4-6',
      anthropicEffort: 'low',
      rewriteProfile: 'standard',
      alternateModel: 'gemini-3.1-pro-preview',
      alternateThinkingLevel: 'low',
      alternateFallbackEnabled: true,
      alternateFallbackModel: 'gemini-3.5-flash',
      alternateFallbackThinkingLevel: 'low',
      tutorProvider: 'gemini',
      tutorModel: 'gemini-3.5-flash',
      tutorAlternateModel: 'gemini-3.1-pro-preview',
      tutorThinkingOrEffort: 'medium',
      tutorProfile: 'standard',
      tutorFallbackEnabled: false,
      tutorFallbackModel: 'gemini-3.5-flash',
      tutorFallbackThinkingOrEffort: 'low',
      quickMenuRewriteVariant: 'all',
      rewriteModality: 'written',
      rewriteFunction: 'general',
      rewriteDomain: 'general',
      rewriteFormality: 'preserve',
      rewriteVoice: 'preserve',
      rewriteStance: 'preserve',
      rewriteLength: 'preserve',
      rewritePerspective: 'preserve',
      rewriteRhetoricalMode: 'preserve',
      preserveFormatting: true,
      includeChangeNotes: false,
      multiWordTranslationFallback: true,
      windowsNativePronunciation: true,
      geminiRetryEnabled: true,
      geminiRetryMaxAttempts: 4,
      languageModelRetryEnabled: true,
      languageModelRetryMaxAttempts: 3,
      ttsEnabled: true,
      readAloudVoice: '',
      readAloudRate: 0,
      readAloudVolume: 100,
      readAloudVoices: [],
      readAloudProvider: 'windowsLocal',
      edgeReadAloudVoice: 'en-US-ChristopherNeural',
      edgeReadAloudRatePercent: 0,
      edgeReadAloudPythonCommand: 'python',
      credentialPresence: {},
      translationDomain: 'general',
      explanationDomain: 'general',
      displayMode: 'hover',
      requestTimeoutMs: 45000,
      translationMaxCharacters: 5000,
      userDictionaryMaxImportEntries: 5000,
      extensionVersion: '1.0.4'
    })),
    refreshProModels: vi.fn(async () => []),
    refreshOpenAIModels: vi.fn(async () => []),
    refreshAnthropicModels: vi.fn(async () => []),
    refreshReadAloudVoices: vi.fn(async () => undefined),
    ...overrides
  };
  const webview = {
    options: {},
    cspSource: 'vscode-webview://test',
    html: '',
    asWebviewUri: (uri: unknown) => uri,
    postMessage: vi.fn(async (_message: unknown) => true),
    onDidReceiveMessage: vi.fn((listener: MessageListener) => {
      receiveMessage = listener;
      return { dispose: vi.fn() };
    })
  };
  const view = {
    visible: true,
    webview,
    onDidChangeVisibility: vi.fn((listener: () => void) => {
      changeVisibility = listener;
      return { dispose: vi.fn() };
    }),
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() }))
  };
  const provider = new KrenResultsViewProvider(
    actions as never, { path: '/extension' } as never, handy as never, recorder as never
  );
  provider.resolveWebviewView(view as never);
  return {
    actions,
    provider,
    webview,
    hidePanel() { view.visible = false; changeVisibility?.(); },
    showAgain() {
      view.visible = true;
      if (!changeVisibility) throw new Error('The real visibility handler was not registered.');
      changeVisibility();
    },
    dispatch(message: unknown) {
      if (!receiveMessage) throw new Error('The real webview message handler was not registered.');
      receiveMessage(message);
    }
  };
}

describe('V228 panel notices through the registered message listener', () => {
  // Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
  it('resolves native confirmation responses while a command is waiting on that confirmation', async () => {
    const h = createHarness();
    await settleMessages();
    let answer!: (choice: string) => void;
    showWarningMessage.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    let chosen: string | undefined;
    h.actions.runCommand.mockImplementationOnce(async () => {
      chosen = await h.provider.showWarningMessage('Delete entry?', { modal: true }, 'Delete');
      return undefined;
    });
    h.dispatch({ command: 'runCommand', action: 'kren.translateSelection' });
    await settleMessages();
    expect(showWarningMessage).toHaveBeenCalledExactlyOnceWith('Delete entry?', { modal: true }, 'Delete');
    expect(h.webview.postMessage.mock.calls.some(([message]) => (message as { command: string }).command === 'panelNotice')).toBe(false);
    answer('Delete'); await settleMessages();
    expect(chosen).toBe('Delete');
    expect((h.provider as unknown as { notices: { snapshot(): unknown[] } }).notices.snapshot()).toEqual([]);
    h.provider.dispose();
  });
  // Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
  it('panel visibility loss leaves a native confirmation with VS Code', async () => {
    const h = createHarness(); await settleMessages(); showWarningMessage.mockClear();
    let answer!: (choice: string) => void;
    showWarningMessage.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    const pending = h.provider.showWarningMessage('Delete entry?', { modal: true }, 'Delete');
    h.hidePanel();
    expect(showWarningMessage).toHaveBeenCalledExactlyOnceWith('Delete entry?', { modal: true }, 'Delete');
    expect(h.webview.postMessage.mock.calls.some(([message]) => (message as { command: string }).command === 'panelNotice')).toBe(false);
    answer('Delete'); await expect(pending).resolves.toBe('Delete');
    expect(h.webview.postMessage).toHaveBeenCalledWith({ command: 'panelNoticesClosed' });
    h.provider.dispose();
  });
  it('stores Speech provider and patches VOICE & MODEL during a conversation', async () => {
    const h = createHarness(); await settleMessages();
    h.provider.tutorState.conversation.status = 'active';
    h.provider.tutorState.conversation.draftAnswer = 'Unsent answer';
    await h.provider.showTutor(); await settleMessages();
    const before = h.webview.html;
    h.dispatch({ command: 'updateSetting', key: 'tutor.speechProvider', value: 'groq' });
    await settleMessages();
    expect(h.actions.updateSetting).toHaveBeenCalledWith('tutor.speechProvider', 'groq');
    expect(h.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'tutorVoiceModelReady' }));
    expect(h.webview.html).toBe(before); expect(h.provider.tutorState.conversation.draftAnswer).toBe('Unsent answer');
    h.provider.dispose();
  });
});

describe('V133 Live conversation visibility', () => {
  it('retains the DOM and re-posts every host-owned control state without rendering', () => {
    const harness = createHarness();
    const internals = harness.provider as unknown as {
      tutorState: {
        conversation: {
          status: string;
          hint?: { explanation: string; example: string };
          hintBusy: boolean;
          hintFailure?: string;
          speakerOn: boolean;
        };
      };
      tutorConversationTurnGeneration: number;
    };
    Object.assign(internals.tutorState.conversation, {
      status: 'active',
      hint: { explanation: 'Think about the time.', example: 'Yesterday, I ...' },
      hintBusy: false,
      hintFailure: undefined,
      speakerOn: false
    });
    internals.tutorConversationTurnGeneration = 7;
    const rendered = harness.webview.html;
    harness.webview.postMessage.mockClear();

    harness.showAgain();

    // Added 2026-09-21: a Live reply and pending learner bubble live in this retained DOM.
    const extensionSource = readFileSync('src/extension.ts', 'utf8');
    expect(extensionSource).toMatch(/registerWebviewViewProvider\([\s\S]*?webviewOptions:\s*\{\s*retainContextWhenHidden:\s*true\s*\}/u);
    expect(harness.webview.html).toBe(rendered);
    // Changed 2026-10-01: V177b refreshes Reset availability alongside Stop and Hint state.
    expect(harness.webview.postMessage.mock.calls.map(([message]) => message)).toEqual([
      expect.objectContaining({ command: 'tutorLiveTalkState' }),
      { command: 'tutorResetAvailability', resetAvailability: { master: true, lesson: false } },
      // Changed 2026-09-25 for V155: visibility restoration also refreshes the in-place Stop gate.
      { command: 'tutorConversationStopState', disabled: false, title: 'Stop conversation' },
      expect.objectContaining({ command: 'tutorLiveSpeakerState' }),
      expect.objectContaining({ command: 'tutorConversationReplayState' }),
      { command: 'tutorResetAvailability', resetAvailability: { master: true, lesson: false } },
      {
        command: 'tutorConversationHintState',
        busy: false,
        hint: { explanation: 'Think about the time.', example: 'Yesterday, I ...' },
        turnGeneration: 7
      }
    ]);
  });
});

async function settleMessages(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('AI English Tutor result focus reaches the page', () => {
  it('V56 R3 renders data-focus-tutor-result from the armed field', () => {
    // Found by mutation on 2026-09-03: renaming the option the controller emits left all 866
    // tests passing, because the controller tests assert the private field and the page test
    // hands the option straight into the renderer. Neither side crossed the join, so the
    // panel could stop scrolling to a new lesson without anything going red.
    const harness = createHarness();
    const renders: string[] = [];
    Object.defineProperty(harness.webview, 'html', {
      get: () => renders[renders.length - 1] ?? '',
      set: (value: string) => {
        renders.push(value);
      },
      configurable: true
    });

    const internals = harness.provider as unknown as {
      pendingTutorResultFocus?: 'lesson' | 'exercises';
      activeScreen: string;
      render(): void;
    };
    internals.activeScreen = 'tutor';
    internals.pendingTutorResultFocus = 'lesson';
    internals.render();

    expect(renders.length, 'the harness captured no render').toBeGreaterThan(0);
    expect(renders[renders.length - 1]).toContain('data-focus-tutor-result="lesson"');
  });
});

describe('V128 queued conversation endings', () => {
  it('acts on Stop through the real queue while a conversation Hint is still pending', async () => {
    let finishHint!: (value: unknown) => void;
    let hintSignal: AbortSignal | undefined;
    const generateTutor = vi.fn((
      _request: unknown,
      _route: unknown,
      signal: AbortSignal
    ) => {
      // Changed 2026-10-04: Stop's independent card signal must not replace the Hint signal.
      if ((_request as { kind: string }).kind === 'conversationHint') hintSignal = signal;
      return new Promise<unknown>((resolve) => { finishHint = resolve; });
    });
    const harness = createHarness({ generateTutor });
    const internals = harness.provider as unknown as {
      tutorState: {
        conversation: {
          status: string;
          currentQuestion: string;
          busy: boolean;
          hintBusy: boolean;
        };
      };
    };
    Object.assign(internals.tutorState.conversation, {
      status: 'active', currentQuestion: 'What happened next?', busy: false, hintBusy: false
    });

    harness.dispatch({ command: 'hintTutorConversation' });
    await vi.waitFor(() => expect(generateTutor).toHaveBeenCalledOnce());
    harness.dispatch({ command: 'stopTutorConversation' });
    await settleMessages();
    const statusWhileHintPending = internals.tutorState.conversation.status;
    const hintWasCancelled = hintSignal?.aborted;
    finishHint({ explanation: 'Late explanation.', example: 'Late example.' });
    await settleMessages();

    expect(statusWhileHintPending).toBe('stopped');
    expect(hintWasCancelled).toBe(true);
  });

  it('V131 lets Stop pass a delayed Standard dictation start through onDidReceiveMessage', async () => {
    // Added 2026-09-20: direct handler calls cannot reproduce the serialized panel queue.
    // The recorder start remains pending while Stop must end the conversation immediately.
    let resolveStart!: (recording: unknown) => void;
    const cancel = vi.fn(async () => undefined);
    const recorder = {
      start: vi.fn(() => new Promise<unknown>((resolve) => { resolveStart = resolve; }))
    };
    const harness = createHarness({}, recorder);
    const internals = harness.provider as unknown as {
      tutorState: { conversation: { status: string; busy: boolean; replies: string }; speech: {
        dictationProvider?: string; dictatingConversation?: boolean
      } };
    };
    // Changed 2026-09-24: V146 refuses a Live microphone with no Live session. This test is
    // specifically about Standard recording, so its fixture must select Standard explicitly.
    Object.assign(internals.tutorState.conversation, {
      status: 'active', busy: false, replies: 'standard'
    });
    internals.tutorState.speech.dictationProvider = 'gemini';

    harness.dispatch({ command: 'dictateTutorConversation' });
    await vi.waitFor(() => expect(recorder.start).toHaveBeenCalledOnce());
    harness.dispatch({ command: 'stopTutorConversation' });
    await settleMessages();
    expect(internals.tutorState.conversation.status).toBe('stopped');

    resolveStart({ filePath: 'owned-in-memory-test', cancel, finish: vi.fn() });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  });

  it('V131 lets Stop cancel delayed Standard transcription and rejects its late text', async () => {
    // Added 2026-09-20: both dictation presses enter through the real listener. Stop must not
    // wait behind the second press, and the completed transcript must not submit a turn later.
    let resolveTranscript!: (value: string) => void;
    const finish = vi.fn(async (consume: (
      audio: Uint8Array,
      format: { sampleRate: number; channels: number; bitsPerSample: number }
    ) => Promise<string>) => consume(new Uint8Array([1, 2]), {
      sampleRate: 16_000, channels: 1, bitsPerSample: 16
    }));
    const recording = { filePath: 'owned-in-memory-test', cancel: vi.fn(async () => undefined), finish };
    const recorder = { start: vi.fn(async () => recording) };
    const transcribeTutorAudio = vi.fn((_audio: Uint8Array, _signal: AbortSignal) =>
      new Promise<string>((resolve) => { resolveTranscript = resolve; }));
    const generateTutor = vi.fn();
    const harness = createHarness({ transcribeTutorAudio, generateTutor }, recorder);
    const internals = harness.provider as unknown as {
      tutorState: { conversation: {
        status: string; busy: boolean; draftAnswer: string; transcript: unknown[]; send: string;
        replies: string
      }; speech: { dictationProvider?: string; dictatingConversation?: boolean } };
    };
    Object.assign(internals.tutorState.conversation, {
      status: 'active', busy: false, draftAnswer: '', transcript: [], send: 'stopSpeaking',
      // Changed 2026-09-24: this is a Standard transcription race, not a Live refusal.
      replies: 'standard'
    });
    internals.tutorState.speech.dictationProvider = 'gemini';

    harness.dispatch({ command: 'dictateTutorConversation' });
    await vi.waitFor(() => expect(internals.tutorState.speech.dictatingConversation).toBe(true));
    harness.dispatch({ command: 'dictateTutorConversation' });
    await vi.waitFor(() => expect(transcribeTutorAudio).toHaveBeenCalledOnce());
    harness.dispatch({ command: 'stopTutorConversation' });
    await settleMessages();
    expect(internals.tutorState.conversation.status).toBe('stopped');

    resolveTranscript('Late words that must be discarded.');
    await settleMessages();
    expect(internals.tutorState.conversation.draftAnswer).toBe('');
    expect(internals.tutorState.conversation.transcript).toEqual([]);
    // Changed 2026-10-10: V212 makes no take-home request without a committed learner answer.
    expect((generateTutor.mock.calls as unknown as Array<[{ kind: string }]>).map(([request]) => request.kind)).toEqual([]);
  });

  it('V132 sends one Handy stop when the microphone and Stop conversation are pressed together', async () => {
    // Added 2026-09-21: direct handler calls serialize themselves and cannot reproduce the
    // detached Handy race. Both presses must enter through the registered webview listener.
    let finishMicrophoneStop!: () => void;
    const microphoneStop = new Promise<void>((resolve) => { finishMicrophoneStop = resolve; });
    const handy = {
      detect: vi.fn(async () => 'C:\\Tools\\Handy\\handy.exe'),
      toggle: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(() => microphoneStop)
        .mockResolvedValue(undefined)
    };
    const harness = createHarness({}, undefined, handy);
    const internals = harness.provider as unknown as {
      handyExecutable: string;
      tutorState: { conversation: { status: string; busy: boolean; replies: string }; speech: {
        handyStatus: string; dictationProvider?: string; dictatingConversation?: boolean
      } };
    };
    internals.handyExecutable = 'C:\\Tools\\Handy\\handy.exe';
    Object.assign(internals.tutorState.conversation, {
      status: 'active', busy: false, replies: 'standard'
    });
    internals.tutorState.speech.handyStatus = 'available';

    harness.dispatch({ command: 'dictateTutorConversation' });
    await vi.waitFor(() => expect(internals.tutorState.speech.dictatingConversation).toBe(true));
    handy.toggle.mockClear();

    harness.dispatch({ command: 'dictateTutorConversation' });
    await vi.waitFor(() => expect(handy.toggle).toHaveBeenCalledOnce());
    harness.dispatch({ command: 'stopTutorConversation' });
    await settleMessages();

    expect(handy.toggle, 'Stop conversation must not send a second Handy toggle').toHaveBeenCalledOnce();
    finishMicrophoneStop();
    await vi.waitFor(() => expect(internals.tutorState.conversation.status).toBe('stopped'));
    expect(handy.toggle).toHaveBeenCalledTimes(1);
  });
});

describe('results webview failure reporting', () => {
  beforeEach(() => {
    showErrorMessage.mockReset().mockResolvedValue(undefined);
    showInformationMessage.mockReset().mockResolvedValue(undefined);
    showWarningMessage.mockReset().mockResolvedValue(undefined);
    writeText.mockReset().mockResolvedValue(undefined);
  });

  // The copy path no longer notifies at all: the panel button confirms itself. The
  // property this test exists for is unchanged and still load-bearing for the other 59
  // call sites, so it is exercised through a handler that does notify. A stub that
  // resolves immediately could never reproduce the freeze, which is why it needs one
  // that never resolves.
  it('handles the next queued message while a notification raised by a handler stays open', async () => {
    showInformationMessage.mockReturnValueOnce(new Promise(() => undefined));
    const harness = createHarness({
      copyText: async (text: string) => {
        await copyTextResult(text);
        notify('information', 'A notice the user never dismisses.');
      }
    });
    harness.provider.setResult({
      kind: 'rewrite',
      providerId: 'gemini',
      sourceText: 'Source text.',
      sourceLanguage: 'en',
      targetLanguage: 'en',
      createdAt: '1970-01-01T00:00:00.000Z',
      englishVariety: 'american',
      domain: 'general',
      modality: 'written',
      function: 'general',
      formality: 'neutral',
      voice: 'preserve',
      stance: 'neutral',
      length: 'preserve',
      perspective: 'preserve',
      rhetoricalMode: 'preserve',
      variants: [{ id: 'minimal', label: 'Minimal Rewrite', text: 'Copied result.' }]
    }, 'Source text.', false);

    harness.dispatch({ command: 'copyVariant', variantId: 'minimal' });
    harness.dispatch({ command: 'details' });

    await vi.waitFor(() => expect(harness.actions.details).toHaveBeenCalledOnce());
    expect(writeText).toHaveBeenCalledWith('Copied result.');
    expect(showInformationMessage).toHaveBeenCalledWith('A notice the user never dismisses.');
  });

  it('keeps an operation successful when its notification rejects', async () => {
    showInformationMessage.mockRejectedValueOnce(new Error('Notification host failed.'));

    expect(() => notify('information', 'A notice whose host fails.')).not.toThrow();
    await expect(copyTextResult('Copied anyway.')).resolves.toBeUndefined();
    expect(writeText).toHaveBeenCalledWith('Copied anyway.');
  });

  // The copy confirmation moved onto the button itself, so copying must raise nothing.
  // Asserted rather than assumed, because the notification that used to be here is what
  // froze the panel, and a future change that quietly restores it would restore that too.
  it('raises no notification when copying, because the button confirms itself', async () => {
    await copyTextResult('Silently copied.');

    expect(writeText).toHaveBeenCalledWith('Silently copied.');
    expect(showInformationMessage).not.toHaveBeenCalled();
    expect(showWarningMessage).not.toHaveBeenCalled();
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  // Redaction has to be judged in both directions. A leaked key is the obvious
  // failure; a message flattened to "[redacted]" is the quieter one, and it defeats
  // the whole reason this reporting exists. The catch-all therefore requires a digit
  // and a letter together, so an ordinary long word survives and an opaque token
  // does not.
  it('redacts opaque tokens without redacting ordinary long words', async () => {
    // Assembled from parts on purpose. A literal key shape here is caught by
    // scan-secrets, correctly: this file is copied into the public tree, and the
    // scanner cannot tell a test fixture from a real credential. Nor should it try.
    const fakeGoogleKey = ['AIza', 'SyC1234567890abcdefghijklmnopqrstuvw'].join('');
    const fakeBearerToken = ['abcdefghijklmnop', 'qrstuvwxyz012345'].join('');

    const cases: Array<{ thrown: string; redacted: string[]; kept: string[] }> = [
      {
        thrown: `Request failed with key ${fakeGoogleKey}`,
        redacted: [fakeGoogleKey],
        kept: ['Request failed']
      },
      {
        thrown: 'No entry for internationalization or contradistinction',
        redacted: [],
        kept: ['internationalization', 'contradistinction']
      },
      {
        // Assembled for the same reason as the key above. A literal bearer token in a
        // file that is copied into the public tree reads as a credential to anyone
        // scanning the repository, whether or not it ever was one.
        thrown: `Authorization: Bearer ${fakeBearerToken} rejected`,
        redacted: [fakeBearerToken],
        kept: ['Bearer', 'rejected']
      }
    ];

    for (const { thrown, redacted, kept } of cases) {
      showErrorMessage.mockClear();
      const harness = createHarness({
        runCommand: vi.fn(async () => { throw new Error(thrown); })
      });
      harness.dispatch({ command: 'runCommand', action: 'kren.deleteAllApiKeys' });
      await settleMessages();

      const lastCall = showErrorMessage.mock.calls.at(-1) as unknown[] | undefined;
      const shown = String(lastCall?.[0] ?? '');
      for (const secret of redacted) {
        expect(shown, `leaked: ${secret}`).not.toContain(secret);
      }
      for (const word of kept) {
        expect(shown, `over-redacted: ${word}`).toContain(word);
      }
    }
  });

  it('reports a rendered command that is unavailable in this build', async () => {
    const harness = createHarness();

    harness.dispatch({ command: 'runCommand', action: 'kren.commandMissingFromBuild' });
    await settleMessages();

    expect(showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('kren.commandMissingFromBuild')
    );
    expect(showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('not available in this build')
    );
    expect(harness.actions.log).toHaveBeenCalledWith(
      expect.stringContaining('[panel command unavailable]')
    );
  });

  it('reports the original error from a command that ran', async () => {
    const failure = new Error('OpenAI connection failed before a response arrived.');
    const harness = createHarness({ runCommand: vi.fn(async () => { throw failure; }) });

    harness.dispatch({ command: 'runCommand', action: 'kren.testOpenAIConnection' });
    await settleMessages();

    expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining(failure.message));
    expect(harness.actions.log).toHaveBeenCalledWith(
      expect.stringContaining('[panel command failed]')
    );
  });

  it('reports a Read Aloud failure with its original message', async () => {
    const failure = new Error('The selected speech voice could not start.');
    const harness = createHarness({ readAloudText: vi.fn(async () => { throw failure; }) });
    harness.provider.setResult({
      kind: 'rewrite',
      providerId: 'gemini',
      sourceText: 'Source text.',
      sourceLanguage: 'en',
      targetLanguage: 'en',
      createdAt: '1970-01-01T00:00:00.000Z',
      englishVariety: 'american',
      domain: 'general',
      modality: 'written',
      function: 'general',
      formality: 'neutral',
      voice: 'preserve',
      stance: 'neutral',
      length: 'preserve',
      perspective: 'preserve',
      rhetoricalMode: 'preserve',
      variants: [{ id: 'minimal', label: 'Minimal Rewrite', text: 'Spoken text.' }]
    }, 'Source text.', false);

    harness.dispatch({ command: 'readVariant', variantId: 'minimal' });
    await settleMessages();

    expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining(failure.message));
    expect(harness.actions.log).toHaveBeenCalledWith(
      expect.stringContaining('[panel read aloud failed]')
    );
  });

  it('marks Read Aloud modality as inferred and lets the user pin it', async () => {
    const harness = createHarness();
    harness.provider.setResult({
      kind: 'rewrite',
      providerId: 'gemini',
      sourceText: 'Source text.',
      sourceLanguage: 'en',
      targetLanguage: 'en',
      createdAt: '1970-01-01T00:00:00.000Z',
      englishVariety: 'american',
      domain: 'general',
      modality: 'written',
      function: 'general',
      formality: 'preserve',
      voice: 'preserve',
      stance: 'preserve',
      length: 'preserve',
      perspective: 'preserve',
      rhetoricalMode: 'preserve',
      variants: [{ id: 'minimal', label: 'Minimal Rewrite', text: 'Spoken text.' }]
    }, 'Source text.', false);

    harness.dispatch({ command: 'readVariant', variantId: 'minimal' });
    await settleMessages();
    expect(harness.webview.html).toContain('Modality (inferred)');
    expect(harness.webview.html).toContain('data-command="pinInferredModality"');
    expect(harness.webview.html).toContain(
      'data-setting="rewrite.preserveFormatting" checked disabled'
    );
    // The result's target language travels with the text, so Edge Read Aloud speaks a
    // rewrite in the language it was written in rather than detecting it again.
    expect(harness.actions.readAloudText).toHaveBeenCalledWith('Spoken text.', 'en');

    harness.dispatch({ command: 'pinInferredModality' });
    await settleMessages();
    expect(harness.actions.updateSetting).toHaveBeenCalledWith('rewrite.modality', 'spoken');
    expect(harness.webview.html).not.toContain('Modality (inferred)');
  });

  it.each(REWRITE_MODES)('applies every $label axis through the existing setting path', async (mode) => {
    const harness = createHarness();

    harness.dispatch({ command: 'applyRewriteMode', modeId: mode.id });
    await vi.waitFor(() => expect(harness.actions.updateSetting).toHaveBeenCalledTimes(8));

    expect(harness.actions.updateSetting.mock.calls).toEqual(
      rewriteModeSettingEntries(mode.id).map(({ key, value }) => [key, value])
    );
  });

  it('does not notify for any background settings refresh failure', async () => {
    const backgroundFailure = () => Promise.reject(new Error('Background refresh failed.'));
    const harness = createHarness({
      refreshProModels: vi.fn(backgroundFailure),
      refreshOpenAIModels: vi.fn(backgroundFailure),
      refreshAnthropicModels: vi.fn(backgroundFailure),
      refreshReadAloudVoices: vi.fn(backgroundFailure)
    });

    harness.dispatch({ command: 'showSettings' });
    harness.dispatch({ command: 'refreshProModels' });
    harness.dispatch({ command: 'refreshOpenAIModels' });
    harness.dispatch({ command: 'refreshAnthropicModels' });
    await vi.waitFor(() => expect(harness.actions.log).toHaveBeenCalledTimes(4));

    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  it('opens User Dictionary without clearing the most recent ordinary result', async () => {
    const harness = createHarness();
    harness.provider.setResult({
      kind: 'translation',
      operation: 'translate' as const,
      providerId: 'gemini',
      sourceText: 'ordinary source',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      createdAt: '1970-01-01T00:00:00.000Z',
      translatedText: 'ordinary result'
    }, 'ordinary source', false);

    await harness.provider.showUserDictionary();
    expect(harness.webview.html).toContain('User Dictionary');

    harness.dispatch({ command: 'showResult' });
    await settleMessages();
    expect(harness.webview.html).toContain('ordinary source');
    expect(harness.webview.html).toContain('ordinary result');
  });

  it('renders a storage failure as an error and never as an empty dictionary', async () => {
    const harness = createHarness({
      loadUserDictionary: vi.fn(async () => {
        throw new Error('The local store could not be read.');
      })
    });

    await expect(harness.provider.showUserDictionary()).rejects.toThrow(
      'The local store could not be read.'
    );
    expect(harness.webview.html).toContain('User Dictionary storage error');
    expect(harness.webview.html).not.toContain('Your User Dictionary is empty.');
  });

  it('uses multi-select only for deletion and export', async () => {
    const first = userDictionaryEntry({ id: 'first' });
    const second = userDictionaryEntry({
      id: 'second',
      term: 'second',
      normalizedTerm: 'second'
    });
    const deleteUserDictionaryEntries = vi.fn(async () => [second]);
    const exportUserDictionary = vi.fn(async () => undefined);
    const regenerateUserDictionaryEntry = vi.fn();
    const harness = createHarness({
      loadUserDictionary: vi.fn(async () => [first, second]),
      deleteUserDictionaryEntries,
      exportUserDictionary,
      regenerateUserDictionaryEntry
    });
    await harness.provider.showUserDictionary();

    harness.dispatch({ command: 'selectUserDictionaryEntries', entryIds: ['first'] });
    await settleMessages();
    harness.dispatch({ command: 'exportUserDictionary', format: 'json', selectedOnly: true });
    await settleMessages();
    expect(exportUserDictionary).toHaveBeenCalledWith('json', ['first']);

    harness.dispatch({ command: 'deleteSelectedUserDictionaryEntries' });
    await settleMessages();
    expect(deleteUserDictionaryEntries).toHaveBeenCalledWith(['first']);
    expect(regenerateUserDictionaryEntry).not.toHaveBeenCalled();
  });

  it('previews imports before passing an explicit duplicate decision to storage', async () => {
    const entry = userDictionaryEntry();
    const preview = {
      currentEntryCount: 1,
      entryCount: 1,
      validEntryCount: 1,
      duplicateCount: 1,
      invalidRecordCount: 0,
      proposedAddCount: 0,
      storeDuplicateCount: 1,
      duplicates: [{
        recordIndex: 0,
        entryId: 'incoming',
        duplicateEntryId: entry.id,
        source: 'store' as const
      }],
      invalidRecords: [],
      entries: [entry]
    };
    const applyUserDictionaryImport = vi.fn(async () => [entry]);
    const harness = createHarness({
      loadUserDictionary: vi.fn(async () => [entry]),
      previewUserDictionaryImport: vi.fn(async () => preview),
      applyUserDictionaryImport
    });

    harness.dispatch({ command: 'previewUserDictionaryImport' });
    await settleMessages();
    expect(harness.webview.html).toContain('Import preview');
    expect(applyUserDictionaryImport).not.toHaveBeenCalled();

    const decision = { mode: 'merge' as const, duplicateStrategy: 'keepExisting' as const };
    harness.dispatch({ command: 'applyUserDictionaryImport', importDecision: decision });
    await settleMessages();
    expect(applyUserDictionaryImport).toHaveBeenCalledWith(preview, decision);
  });

  it('cancels an editable draft without calling storage', async () => {
    const harness = createHarness();
    await harness.provider.showUserDictionaryDraft(userDictionaryEntry({
      id: 'unsaved-draft',
      merriamWebsterReference: undefined
    }));
    expect(harness.webview.html).toContain('Nothing is stored until Save');

    harness.dispatch({ command: 'cancelUserDictionaryDraft' });
    await settleMessages();

    expect(harness.actions.saveUserDictionaryEntry).not.toHaveBeenCalled();
    expect(harness.webview.html).not.toContain('Nothing is stored until Save');
  });

  it('offers Open existing and Update existing after an explicit duplicate save', async () => {
    const existing = userDictionaryEntry({ id: 'existing-entry' });
    const draft = userDictionaryEntry({ id: 'duplicate-draft', merriamWebsterReference: undefined });
    const saveUserDictionaryEntry = vi.fn(async () => ({
      kind: 'duplicate' as const,
      existing,
      entries: [existing]
    }));
    const harness = createHarness({ saveUserDictionaryEntry });
    await harness.provider.showUserDictionaryDraft(draft);

    harness.dispatch({ command: 'saveUserDictionaryDraft', entry: editableDraft(draft) });
    await settleMessages();

    expect(saveUserDictionaryEntry).toHaveBeenCalledTimes(1);
    expect(harness.webview.html).toContain('Open existing');
    expect(harness.webview.html).toContain('Update existing');
    expect(harness.webview.html).toContain('This expression is already in your User Dictionary');
  });
});

function editableDraft(entry: ReturnType<typeof userDictionaryEntry>) {
  return {
    term: entry.term,
    language: entry.language,
    entryType: entry.entryType,
    collection: entry.collection,
    domains: entry.domains,
    tags: entry.tags,
    pronunciation: entry.pronunciation?.display ?? '',
    senses: entry.senses.map((sense) => ({
      partOfSpeech: sense.partOfSpeech ?? '',
      definition: sense.definition,
      usageNote: sense.usageNote ?? '',
      synonyms: sense.synonyms,
      antonyms: sense.antonyms,
      relatedTerms: sense.relatedTerms,
      examples: sense.examples
    })),
    aliases: entry.aliases
  };
}

describe('R5a finding 3: dictionary regeneration preserves unsaved work', () => {
  it.each(['declined', 'failed'])('keeps edited draft fields when regeneration is %s', async (outcome) => {
    const regenerateUserDictionaryEntry = vi.fn(async () => {
      if (outcome === 'failed') throw new Error('Request unavailable.');
      return undefined;
    });
    const harness = createHarness({ regenerateUserDictionaryEntry });
    const entry = userDictionaryEntry({ merriamWebsterReference: undefined });
    await harness.provider.showUserDictionaryDraft(entry);
    const edited = editableDraft(entry);
    edited.senses[0]!.definition = 'My unsaved definition';
    harness.dispatch({ command: 'regenerateUserDictionaryDraft', entry: edited });
    await settleMessages();
    expect(regenerateUserDictionaryEntry).toHaveBeenCalledOnce();
    expect(harness.webview.html).toContain('My unsaved definition');
    expect(harness.webview.html).toContain('saveUserDictionaryDraft');
  });
});

describe('R5a finding 16: navigation settles Edge playback', () => {
  it.each(['showStartPage', 'showSettings'])('defers %s until pending audio ends', async (command) => {
    const harness = createHarness();
    await settleMessages();
    const before = harness.webview.html;
    const internals = harness.provider as unknown as { generatedAudioResolver?: (result: string) => void };
    const pending = harness.provider.playGeneratedAudioBase64('AQIDBA==');
    harness.dispatch({ command });
    await settleMessages();
    // 2026-10-13: V230 keeps the playing document until the clip completes, then navigates.
    expect(harness.webview.html).toBe(before);
    expect(internals.generatedAudioResolver).toBeDefined();
    // Changed 2026-10-16: V247, owner item I24, navigation requests Stop while this mock leaves playback pending.
    expect(harness.actions.stopReadAloud).toHaveBeenCalled();
    internals.generatedAudioResolver?.('completed');
    expect(await pending).toBe('completed');
    await settleMessages();
    expect(internals.generatedAudioResolver).toBeUndefined();
    expect(harness.webview.html).not.toBe(before);
    harness.provider.dispose();
  });
});

describe('R5a finding 4: panel navigation invalidates publication', () => {
  it.each(['clear', 'showStartPage'])('%s revokes outstanding result requests', async (command) => {
    const invalidateResultRequests = vi.fn();
    const harness = createHarness({ invalidateResultRequests });
    invalidateResultRequests.mockClear();
    if (command === 'clear') harness.provider.clear();
    else harness.dispatch({ command });
    await settleMessages();
    expect(invalidateResultRequests).toHaveBeenCalled();
  });
});



// The hide command used to run workbench.action.closeAuxiliaryBar, which closes the whole
// Secondary Sidebar. Chat, Claude Code, and Codex live there too, so hiding KREN took all
// of them down, and reopening the panel from one of those brought KREN back because it had
// never been hidden. Reported by the owner on 2026-08-14.
//
// Asserted in both directions: the context is cleared, and the workbench command is not
// called. Only the first half would still pass if someone added the close back alongside
// it, which is exactly the shape of an accidental restoration.
describe('hiding KREN', () => {
  it('clears its own context and leaves the Secondary Sidebar alone', async () => {
    executeCommand.mockClear();
    const harness = createHarness();

    await harness.provider.hide();

    expect(executeCommand).toHaveBeenCalledWith('setContext', 'kren.resultsEnabled', false);
    const commandNames = executeCommand.mock.calls.map((call) => call[0]);
    expect(commandNames).not.toContain('workbench.action.closeAuxiliaryBar');
  });

  it('reveals by setting the same context true, so the two are symmetric', async () => {
    executeCommand.mockClear();
    const harness = createHarness();

    await harness.provider.reveal();

    expect(executeCommand).toHaveBeenCalledWith('setContext', 'kren.resultsEnabled', true);
  });

  // The owner reported on 2026-08-22 that selecting Claude Code in the Secondary Sidebar
  // removed KREN's tab entirely. VS Code had recorded the container as
  // {"id":"workbench.view.extension.kren-results","pinned":false}, alone among the five
  // containers in that bar, because activation gated its only view off before the
  // workbench built the bar. An unpinned container shows only while it is the active tab.
  //
  // kren.results.openAtStartup is now the one record of the shown state, so these two
  // assertions are what stop a second copy of that fact appearing.
  it('records the shown state on the setting that restores it', async () => {
    const harness = createHarness();

    await harness.provider.reveal();

    expect(harness.actions.updateSetting)
      .toHaveBeenCalledWith('results.openAtStartup', true);
  });

  // Overriding settings wholesale would drop every other field the renderer reads, so the
  // defaults are carried and only the one under test is changed.
  const harnessWithSidebarShown = (): ReturnType<typeof createHarness> => {
    const defaults = createHarness().actions.settings();
    return createHarness({ settings: () => ({ ...defaults, openResultsAtStartup: true }) });
  };

  it('clears the same setting on hide, so a restart does not bring KREN back', async () => {
    const harness = harnessWithSidebarShown();

    await harness.provider.hide();

    expect(harness.actions.updateSetting)
      .toHaveBeenCalledWith('results.openAtStartup', false);
  });

  it('restores the last shown state at activation rather than always starting hidden', () => {
    // Activation used to clear the context unconditionally, so a KREN that had been shown
    // came back hidden after every restart and the openAtStartup setting was the only way
    // to get it back. Seeding from that setting makes show and hide survive a restart.
    //
    // This guarantees nothing about the workbench pin. An earlier version of this comment
    // claimed the timing of this call decided whether KREN's tab stayed in the tab strip
    // when another tab was selected. It does not: the pin lives in the workbench's own
    // per-tab state and only the tab context menu changes it. The claim was wrong and the
    // behaviour it promised never appeared, which is why it is written down here.
    //
    // Anchored on the setContext call in activate() rather than on the file, because a
    // false anywhere else in extension.ts is none of this test's business.
    const source = readFileSync('src/extension.ts', 'utf8');
    const activation = source.slice(
      source.indexOf('export async function activate('),
      source.indexOf('activeExtensionContext = context;')
    );
    expect(activation).not.toBe('');
    expect(activation).toContain('KrenResultsViewProvider.enabledContext');
    // Changed 2026-10-16: V254, owner item I36, false to true default.
    expect(activation).toContain("get<boolean>('results.openAtStartup', RESULTS_OPEN_AT_STARTUP_DEFAULT)");
    // The literal that caused it. Present again, the tab vanishes again.
    expect(activation).not.toMatch(/enabledContext,\s*false/u);
  });

  it('does not rewrite the setting when it already says what is wanted', async () => {
    // Every write lands in the owner's settings.json. Showing a sidebar that is already
    // shown must not churn a file they read.
    const harness = harnessWithSidebarShown();

    await harness.provider.reveal();

    expect(harness.actions.updateSetting).not.toHaveBeenCalled();
  });
});

describe('grammar choices from every finding producer', () => {
  function grammarResult() {
    return {
      kind: 'grammar',
      providerId: 'harper',
      sourceText: 'Their going to the libary.',
      sourceLanguage: 'en',
      targetLanguage: 'en',
      dialect: 'american',
      issues: [
        {
          id: 'issue-1',
          category: 'Word choice',
          original: 'Their',
          start: 0,
          end: 5,
          message: 'Wrong word.',
          suggestions: [{ label: "They're", replacement: "They're" }]
        },
        {
          id: 'smart-grammar-19-25-0',
          category: 'Spelling',
          original: 'libary',
          start: 19,
          end: 25,
          message: 'Misspelling.',
          suggestions: [{ label: 'library', replacement: 'library' }]
        }
      ]
    } as never;
  }

  // The validator matched only the Harper worker's issue-<n>. Core also produces
  // smart-grammar-<start>-<end>-<index> and spacing-<start>-<length>, so one Smart Grammar
  // finding in the selection made the whole message invalid, and an invalid message is
  // dropped in silence. Apply and Copy did nothing, with no error anywhere, and Smart
  // Grammar Check is on by default.
  it('accepts a choice for a Smart Grammar finding and rebuilds the corrected text', async () => {
    const harness = createHarness();
    harness.provider.setResult(grammarResult(), 'Their going to the libary.', true);

    harness.dispatch({
      command: 'updateGrammarChoice',
      issueId: 'smart-grammar-19-25-0',
      suggestionIndex: -1
    });
    await settleMessages();

    // Turning that finding off has to change the corrected text. A rejected message would
    // leave the box exactly as it was, which is what the reader saw before this was fixed.
    expect(harness.webview.html).toContain('>They&#39;re going to the libary.</textarea>');

    harness.dispatch({
      command: 'updateGrammarChoice',
      issueId: 'smart-grammar-19-25-0',
      suggestionIndex: 0
    });
    await settleMessages();

    expect(harness.webview.html).toContain('>They&#39;re going to the library.</textarea>');
  });

  it('accepts a choice for a spacing repair', async () => {
    const harness = createHarness();
    harness.provider.setResult(grammarResult(), 'Their going to the libary.', true);

    harness.dispatch({
      command: 'updateGrammarChoice',
      issueId: 'spacing-12-2',
      suggestionIndex: 0
    });
    await settleMessages();

    // An identifier that matches no finding selects nothing, so the text is unchanged. The
    // point is that the message was accepted rather than dropped for its shape.
    expect(harness.webview.html).toContain('</textarea>');
  });

  it('manages a Smart Grammar finding from the panel', async () => {
    const harness = createHarness();
    harness.provider.setResult(grammarResult(), 'Their going to the libary.', true);

    harness.dispatch({ command: 'addGrammarWord', issueId: 'smart-grammar-19-25-0' });
    await settleMessages();

    expect(harness.actions.manageGrammarIssue)
      .toHaveBeenCalledWith('smart-grammar-19-25-0', 'addWord');
  });

  // The test above builds the message by hand, so it proved the extension would act on one
  // if it ever arrived and proved nothing about whether the panel sends one. It never did:
  // the buttons put the identifier in data-grammar-issue and the sender read every other
  // data attribute except that one, so Add to local dictionary and Ignore this finding were
  // dead for every finding, including the Harper findings that predate Smart Grammar.
  it('sends the identifier the management buttons carry', () => {
    const panel = readFileSync('src/resultViewHtml.ts', 'utf8');
    const sender = panel.slice(
      panel.indexOf('if (command) vscode.postMessage({'),
      panel.indexOf("const audioUrl = target.getAttribute('data-audio-url')")
    );

    expect(sender).not.toBe('');
    expect(sender).toContain("issueId: target.getAttribute('data-grammar-issue')");
    // Every attribute the buttons carry must be read by the sender that dispatches them.
    for (const attribute of [...panel.matchAll(/data-command="(?:addGrammarWord|ignoreGrammarIssue)" (data-[a-z-]+)=/gu)]) {
      expect(sender, `sender must read ${attribute[1]}`).toContain(`getAttribute('${attribute[1]}')`);
    }
  });

  it('still refuses an identifier that is not a bounded safe string', async () => {
    const harness = createHarness();
    harness.provider.setResult(grammarResult(), 'Their going to the libary.', true);

    for (const issueId of ['', '../etc', 'a'.repeat(65), '<script>']) {
      harness.dispatch({ command: 'addGrammarWord', issueId });
    }
    await settleMessages();

    expect(harness.actions.manageGrammarIssue).not.toHaveBeenCalled();
  });

  it('replaces and copies exactly what the corrected-text box holds', async () => {
    const harness = createHarness();
    harness.provider.setResult(grammarResult(), 'Their going to the libary.', true);

    harness.dispatch({ command: 'applyGrammar', draftText: 'Hand edited by the reader.' });
    await settleMessages();
    harness.dispatch({ command: 'copyGrammar', draftText: 'Hand edited by the reader.' });
    await settleMessages();

    // Recomputing from the radio buttons here would silently discard the edit, which is the
    // one thing the editable box exists for.
    expect(harness.actions.replaceText).toHaveBeenCalledWith('Hand edited by the reader.');
    expect(harness.actions.copyText).toHaveBeenCalledWith('Hand edited by the reader.');
  });

  it('returns the corrected text to the preselected corrections on reset', async () => {
    const harness = createHarness();
    harness.provider.setResult(grammarResult(), 'Their going to the libary.', true);
    harness.dispatch({
      command: 'updateGrammarChoice',
      issueId: 'issue-1',
      suggestionIndex: -1
    });
    await settleMessages();
    expect(harness.webview.html).toContain('>Their going to the library.</textarea>');

    harness.dispatch({ command: 'resetGrammarDraft' });
    await settleMessages();

    expect(harness.webview.html).toContain('>They&#39;re going to the library.</textarea>');
  });
});

// The owner asked for this on 2026-08-22. A found-issues toast repeated what the editor
// underlines and the panel list were both already showing, and had to be dismissed every
// time. The clean-result notice is the opposite case and stays: nothing else on screen
// changes when a check finds nothing, so silence there is indistinguishable from a check
// that never ran.
describe('what a finished grammar check reports', () => {
  it('records the Smart Grammar model on the result it merged findings from', () => {
    const source = readFileSync('src/extension.ts', 'utf8');
    const merge = source.slice(
      source.indexOf("if (smart?.status === 'completed')"),
      source.indexOf('} else if (smart)')
    );

    expect(merge).not.toBe('');
    // The panel header renders result.smartModelId. Nothing else writes it, so deleting
    // this line makes the header silently understate what ran, and a renderer test that
    // sets the field by hand cannot see that.
    expect(merge).toContain('result.smartModelId = smart.model;');
  });
});

describe('what a finished grammar check announces', () => {
  it('raises no notification for findings, and still announces a clean result', () => {
    const source = readFileSync('src/extension.ts', 'utf8');
    const announce = source.slice(
      source.indexOf('if (announce'),
      source.indexOf('return state;')
    );

    expect(announce).not.toBe('');
    expect(announce).toContain('Harper found no spelling or grammar issues.');
    expect(announce).not.toMatch(/possible issue/u);
    expect(announce).not.toMatch(/Quick Fix/u);
  });
});

/**
 * The Read Aloud jump the owner reported on 2026-08-25. Opening Settings through the gear
 * beside a rewrite result sets a pending focus on the Rewrite Text section, which is wanted.
 * The same action starts a background voice refresh, and when that refresh completed it
 * re-rendered with the focus still pending, so the panel scrolled back to Rewrite Text after
 * the reader had moved to Read Aloud and changed a control.
 *
 * The guard is that the background completion does not render while a focus is pending. A
 * test asserting the message path alone passes whether the guard is there or not, because
 * the bug is in the asynchronous completion, so this counts renders instead.
 */
describe('the background voice refresh and a pending settings focus', () => {
  it('does not re-render while a settings focus is still pending', async () => {
    let releaseRefresh: (() => void) | undefined;
    const harness = createHarness({
      refreshReadAloudVoices: vi.fn(() => new Promise<void>((resolve) => {
        releaseRefresh = () => resolve();
      }))
    });

    harness.dispatch({ command: 'editRewriteSettings' });
    await vi.waitFor(() => expect(harness.webview.html).toContain('data-focus-section="rewrite"'));
    const afterOpening = harness.webview.html;

    releaseRefresh?.();
    await Promise.resolve();
    await Promise.resolve();

    // Unchanged: the completion declined to render, so nothing re-applied the stale focus.
    expect(harness.webview.html).toBe(afterOpening);
  });
});

describe('the panel wait notice', () => {
  it('covers the panel while a capability command runs, and uncovers it after', async () => {
    let finish = () => undefined as void;
    const harness = createHarness({
      runCommand: vi.fn(() => new Promise<void>((resolve) => { finish = () => { resolve(); }; }))
    });

    harness.dispatch({ command: 'runCommand', action: 'kren.rewriteEnglishSelection' });
    await settleMessages();
    expect(harness.webview.html).toContain('Rewriting the selected text. Please wait.');

    finish();
    await settleMessages();
    expect(harness.webview.html).not.toContain('Rewriting the selected text. Please wait.');
  });

  // Setting a key opens an input box and stopping speech returns at once. Covering the
  // panel for either would be a freeze with nothing behind it.
  it('does not cover the panel for a command that returns at once', async () => {
    let finish = () => undefined as void;
    const harness = createHarness({
      runCommand: vi.fn(() => new Promise<void>((resolve) => { finish = () => { resolve(); }; }))
    });

    harness.dispatch({ command: 'runCommand', action: 'kren.setGeminiApiKey' });
    await settleMessages();

    expect(harness.webview.html).not.toContain('class="busy-overlay"');
    finish();
  });

  // readAloudText awaits playback, so kren.readAloudSelection does not resolve until the
  // speech ends. Covering the panel for that span would put the overlay on top of the
  // panel's own Stop control for the entire reading, which is the one control the reader
  // wants while speech is playing.
  it('does not cover the panel while speech is playing', async () => {
    let finish = () => undefined as void;
    const harness = createHarness({
      runCommand: vi.fn(() => new Promise<void>((resolve) => { finish = () => { resolve(); }; }))
    });

    harness.dispatch({ command: 'runCommand', action: 'kren.readAloudSelection' });
    await settleMessages();

    expect(harness.webview.html).not.toContain('class="busy-overlay"');
    finish();
  });

  // The notice was one string, cleared by whichever completion found its own text still in
  // place. Two Rewrites share a notice, so the first to finish uncovered the panel while the
  // second was still running, and Translate followed by Rewrite uncovered it the moment
  // Rewrite returned.
  it('keeps the panel covered until the last overlapping command finishes', async () => {
    const finishes: Array<() => void> = [];
    const harness = createHarness({
      runCommand: vi.fn(() => new Promise<void>((resolve) => { finishes.push(resolve); }))
    });

    harness.dispatch({ command: 'runCommand', action: 'kren.translateSelection' });
    await settleMessages();
    harness.dispatch({ command: 'runCommand', action: 'kren.rewriteEnglishSelection' });
    await settleMessages();
    expect(harness.webview.html).toContain('Rewriting the selected text. Please wait.');

    finishes[1]?.();
    await settleMessages();
    expect(harness.webview.html).toContain('class="busy-overlay"');
    expect(harness.webview.html).toContain('Translating the selected text. Please wait.');

    finishes[0]?.();
    await settleMessages();
    expect(harness.webview.html).not.toContain('class="busy-overlay"');
  });

  it('keeps the panel covered when two commands share a notice', async () => {
    const finishes: Array<() => void> = [];
    const harness = createHarness({
      runCommand: vi.fn(() => new Promise<void>((resolve) => { finishes.push(resolve); }))
    });

    harness.dispatch({ command: 'runCommand', action: 'kren.rewriteEnglishSelection' });
    await settleMessages();
    harness.dispatch({ command: 'runCommand', action: 'kren.rewriteEnglishSelection' });
    await settleMessages();

    finishes[0]?.();
    await settleMessages();
    expect(harness.webview.html).toContain('class="busy-overlay"');

    finishes[1]?.();
    await settleMessages();
    expect(harness.webview.html).not.toContain('class="busy-overlay"');
  });

  it('uncovers the panel when the command fails', async () => {
    const harness = createHarness({
      runCommand: vi.fn(async () => { throw new Error('provider down'); })
    });

    harness.dispatch({ command: 'runCommand', action: 'kren.translateSelection' });
    await settleMessages();
    await settleMessages();

    expect(harness.webview.html).not.toContain('class="busy-overlay"');
  });
});

describe('the Grammar Check and User Dictionary shared routing profile', () => {
  async function writeSharedModel(origin: 'grammar' | 'userDictionary', model: string) {
    const harness = createHarness();
    const before = harness.actions.settings();
    harness.actions.settings.mockReturnValue({
      ...before,
      grammarSmart: true,
      userDictionaryModel: 'before-model'
    });
    harness.provider.refresh();
    const marker = `data-llm-routing="${origin}"`;
    const start = harness.webview.html.indexOf(marker);
    const end = harness.webview.html.indexOf('</details>', start);
    expect(harness.webview.html.slice(start, end))
      .toContain('data-setting="userDictionary.model"');

    harness.actions.updateSetting.mockImplementation(async (key, value) => {
      if (key !== 'userDictionary.model') return;
      harness.actions.settings.mockReturnValue({
        ...harness.actions.settings(),
        userDictionaryModel: String(value)
      });
    });
    harness.dispatch({
      command: 'updateSetting',
      key: 'userDictionary.model',
      value: model
    });
    await settleMessages();
    harness.provider.refresh();
    return harness;
  }

  it('reflects a model written from Grammar Check in User Dictionary immediately', async () => {
    const harness = await writeSharedModel('grammar', 'model-from-grammar');
    expect(harness.actions.updateSetting)
      .toHaveBeenCalledWith('userDictionary.model', 'model-from-grammar');
    expect(harness.webview.html.match(
      /data-setting="userDictionary\.model" value="model-from-grammar"/gu
    )).toHaveLength(2);
  });

  it('reflects a model written from User Dictionary in Grammar Check immediately', async () => {
    const harness = await writeSharedModel('userDictionary', 'model-from-dictionary');
    expect(harness.actions.updateSetting)
      .toHaveBeenCalledWith('userDictionary.model', 'model-from-dictionary');
    expect(harness.webview.html.match(
      /data-setting="userDictionary\.model" value="model-from-dictionary"/gu
    )).toHaveLength(2);
  });
});

describe('the Settings apply bar', () => {
  function rewriteResult() {
    return {
      kind: 'rewrite',
      providerId: 'gemini',
      sourceText: 'Source text.',
      sourceLanguage: 'en',
      targetLanguage: 'en',
      modelId: 'gemini-3.5-flash',
      englishVariety: 'american',
      domain: 'general',
      modality: 'written',
      function: 'general',
      formality: 'preserve',
      voice: 'preserve',
      stance: 'preserve',
      length: 'preserve',
      perspective: 'preserve',
      rhetoricalMode: 'preserve',
      variants: [{ id: 'minimal', label: 'Minimal Rewrite', text: 'Rewritten.' }]
    } as never;
  }

  it('R5a finding 13: keeps the changed-settings apply bar after a failed rewrite request', async () => {
    const harness = createHarness({ rerunOperation: vi.fn(async () => { throw new Error('Service unavailable.'); }) });
    harness.provider.setResult(rewriteResult(), 'Source text.', true, 'rewriteFull');
    harness.dispatch({ command: 'editRewriteSettings' });
    await settleMessages();
    const before = harness.actions.settings();
    harness.actions.settings.mockReturnValue({ ...before, rewriteFormality: 'formal' });
    harness.provider.refresh();
    harness.dispatch({ command: 'regenerateResult' });
    await settleMessages();
    expect(harness.webview.html).toContain('class="apply-bar"');
    expect(harness.webview.html).not.toMatch(/data-command="regenerateResult"[^>]*disabled>/u);
  });

  it('arms only when the gear opened Settings, not the menu entry', async () => {
    const harness = createHarness();
    harness.provider.setResult(rewriteResult(), 'Source text.', true, 'rewrite');

    harness.dispatch({ command: 'showSettings' });
    await settleMessages();
    expect(harness.webview.html).not.toContain('class="apply-bar"');

    harness.dispatch({ command: 'editRewriteSettings' });
    await settleMessages();
    expect(harness.webview.html).toContain('class="apply-bar"');
    expect(harness.webview.html).toContain('Change a setting below, then regenerate the rewrite.');
  });

  it('opens Settings at the rewrite section, once, when the gear brought the reader there', async () => {
    const harness = createHarness();
    harness.provider.setResult(rewriteResult(), 'Source text.', true, 'rewrite');

    harness.dispatch({ command: 'editRewriteSettings' });
    await settleMessages();
    expect(harness.webview.html).toContain('data-focus-section="rewrite"');

    // Survives a background render, because opening Settings this way also kicks off a
    // voice refresh whose render would otherwise erase the target before the webview
    // script had read it.
    harness.provider.refresh();
    expect(harness.webview.html).toContain('data-focus-section="rewrite"');

    // Dropped by the reader's next action. Left set, every later change on the Settings
    // screen would drag them back to the rewrite heading mid-edit.
    harness.dispatch({ command: 'editRewriteGroup', group: 'register' });
    await settleMessages();
    harness.provider.refresh();
    expect(harness.webview.html).not.toMatch(/<body[^>]*data-focus-section/u);
  });

  it.each([
    ['readAloud.edgeLocale', 'ko-KR'],
    ['readAloud.edgeVoice', 'ko-KR-SunHiNeural'],
    ['readAloud.voice', 'Microsoft Zira Desktop'],
    ['readAloud.rate', 2],
    ['readAloud.edgeRatePercent', 10],
    ['readAloud.volume', 75],
    ['readAloud.provider', 'edgeOnline'],
    ['readAloud.edgePythonCommand', 'python']
  ] as const)('does not leak Rewrite Text focus into a %s change', async (key, value) => {
    const harness = createHarness();
    harness.provider.setResult(rewriteResult(), 'Source text.', true, 'rewrite');
    harness.dispatch({ command: 'editRewriteSettings' });
    await settleMessages();
    expect(harness.webview.html).toContain('data-focus-section="rewrite"');

    harness.dispatch({ command: 'updateSetting', key, value });
    await settleMessages();
    harness.provider.refresh();

    expect(harness.actions.updateSetting).toHaveBeenCalledWith(key, value);
    expect(harness.webview.html).not.toMatch(/<body[^>]*data-focus-section/u);
  });

  it('does not scroll Settings anywhere when the menu opened it', async () => {
    const harness = createHarness();
    harness.provider.setResult(rewriteResult(), 'Source text.', true, 'rewrite');

    harness.dispatch({ command: 'showSettings' });
    await settleMessages();

    // Matched on the body tag: the panel script reads this attribute by name, so the bare
    // name appears on every screen and a plain negative would pass for the wrong reason.
    expect(harness.webview.html).not.toMatch(/<body[^>]*data-focus-section/u);
  });

  it('cannot arm on a result with no recorded operation', async () => {
    const harness = createHarness();
    harness.provider.setResult(rewriteResult(), 'Source text.', true);

    harness.dispatch({ command: 'editRewriteSettings' });
    await settleMessages();

    expect(harness.webview.html).not.toContain('class="apply-bar"');
  });

  it('enables Regenerate once a setting moves, and runs the recorded operation', async () => {
    const harness = createHarness();
    harness.provider.setResult(rewriteResult(), 'Source text.', true, 'rewriteFull');
    harness.dispatch({ command: 'editRewriteSettings' });
    await settleMessages();
    expect(harness.webview.html).toMatch(/data-command="regenerateResult"[^>]*disabled>/u);

    const before = harness.actions.settings();
    harness.actions.settings.mockReturnValue({ ...before, rewriteFormality: 'formal' });
    harness.provider.refresh();
    expect(harness.webview.html).toContain('Regenerate the Full Rewrite with these settings.');
    expect(harness.webview.html).not.toMatch(/data-command="regenerateResult"[^>]*disabled>/u);

    harness.dispatch({ command: 'regenerateResult' });
    await settleMessages();
    expect(harness.actions.rerunOperation).toHaveBeenCalledWith('rewriteFull', 'Source text.');
  });

  // The voice roster and the credential map are refreshed in the background while the
  // Settings screen is open. Comparing them would light up Regenerate for a change the
  // reader never made, and pressing it would spend a request to produce the same result.
  it('ignores host-supplied fields that change without the reader touching anything', async () => {
    const harness = createHarness();
    harness.provider.setResult(rewriteResult(), 'Source text.', true, 'rewrite');
    harness.dispatch({ command: 'editRewriteSettings' });
    await settleMessages();

    const before = harness.actions.settings();
    harness.actions.settings.mockReturnValue({
      ...before,
      readAloudVoices: ['Microsoft David', 'Microsoft Zira'],
      credentialPresence: { geminiDefault: true }
    } as never);
    harness.provider.refresh();

    expect(harness.webview.html).toMatch(/data-command="regenerateResult"[^>]*disabled>/u);
  });

  it('disarms when the new result arrives, so the bar does not survive its own replay', async () => {
    const harness = createHarness();
    harness.provider.setResult(rewriteResult(), 'Source text.', true, 'rewrite');
    harness.dispatch({ command: 'editRewriteSettings' });
    await settleMessages();
    expect(harness.webview.html).toContain('class="apply-bar"');

    harness.provider.setResult(rewriteResult(), 'Source text.', true, 'rewrite');
    harness.dispatch({ command: 'showSettings' });
    await settleMessages();

    expect(harness.webview.html).not.toContain('class="apply-bar"');
  });
});

// The command identifier changed in 1.3.3. A hand-written keybinding on the old name
// would otherwise break silently, so the old identifier stays registered as an alias. It
// runs the new behaviour on purpose: someone who bound it wanted KREN out of the way, not
// the Secondary Sidebar closed. Asserted here as a contract on the manifest, since the
// alias must not be contributed and so must not appear in the Command Palette.
describe('the retired hide identifier', () => {
  it('is no longer contributed, so it stays out of the Command Palette', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      contributes: { commands: Array<{ command: string; title: string }> };
    };
    const contributed = manifest.contributes.commands.map((command) => command.command);

    expect(contributed).toContain('kren.hideResults');
    expect(contributed).not.toContain('kren.hideSecondarySidebar');
  });

  // VS Code's own Secondary Sidebar tab menu carries an entry reading Hide 'KREN', which
  // unpins the container and drops the tab from the strip as soon as another tab is
  // selected. Confirmed in the installed workbench bundle on 2026-08-22: that label is
  // nls message 5941, Hide '{0}', and its action toggles compositeBar.pin/unpin.
  //
  // KREN's own command was titled Hide KREN, one word away from it and doing something
  // else entirely. The owner spent an afternoon on a vanishing tab that was most likely
  // one wrong click in that menu, so KREN's label must not read as VS Code's.
  it('does not title its own command so it reads like the workbench unpin entry', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      contributes: { commands: Array<{ command: string; title: string }> };
    };
    const hide = manifest.contributes.commands.find((c) => c.command === 'kren.hideResults');

    expect(hide?.title).toBe('Close KREN Panel');
    // The shape, not just today's string: any title starting with Hide collides again.
    for (const command of manifest.contributes.commands) {
      expect(command.title, `${command.command} must not read as the workbench entry`)
        .not.toMatch(/^Hide/u);
    }
  });
});

// The provider hands the language to actions.readAloudText, and the harness above proves it.
// What that cannot reach is the extension wiring the two together: a hook that drops the
// second argument type-checks, renders nothing different, and silently returns Read Aloud to
// detecting a language KREN already recorded.
describe('the extension read-aloud hook', () => {
  it('forwards the language the panel supplies', () => {
    const extension = readFileSync('src/extension.ts', 'utf8');
    // V102, 2026-09-15. The third argument selects tutor settings without changing callers
    // that omit it and continue through the shared Read Aloud settings.
    // Changed 2026-09-20: the conversation replay keeps a fourth, optional voice for one reading (the learner's
    // learner voice) that leaves the reader's settings untouched.
    expect(extension)
      .toContain('readAloudText: (text, language, settingsSource, edgeVoice) =>');
    expect(extension)
      .toContain('readAloudText(context, text, language, settingsSource, edgeVoice)');
  });

  it('resolves the locale and the voice together before speaking', () => {
    const extension = readFileSync('src/speech/speechCenter.ts', 'utf8');
    /*
     * The window starts at speakIn rather than at the locale resolution, because the retry
     * added in 1.6.1 speaks twice and both attempts share one voice-resolution site. The
     * invariant is unchanged and the assertions below are stronger: exactly one place hands
     * a voice to the runtime, and its locale argument is whichever locale that attempt
     * resolved, so neither attempt can pass the stored voice straight through.
     */
    const speak = extension.slice(
      extension.indexOf('const speakIn = async ('),
      extension.indexOf('if (result === \'dependencyMissing\')')
    );
    expect(speak, 'the Edge speak call no longer resolves a locale').not.toBe('');
    expect(speak).toContain('resultLanguage');
    // The stored voice must go through the locale, or an English voice reads Korean.
    expect(speak).toContain('voice: resolveEdgeSpeechVoice(chosen, storedVoice)');
    expect(speak).not.toContain('voice: storedVoice');
    /*
     * One resolution site inside the speak path, so both the first attempt and the retry
     * share it. The file holds a second call, the settings follower that moves the voice
     * when Language/Region changes, and that one is deliberate and out of this window.
     */
    expect(speak.split('resolveEdgeSpeechVoice(').length - 1).toBe(1);
  });
});

// 2026-10-11: Bridge real Chirp synthesis handling and host acknowledgement to the panel player.
function chirpPanelHarness() {
  // 2026-10-12: Chirp playback cannot depend on discovery of installed Handy programs.
  const harness = createHarness({}, undefined, { detect: vi.fn(async () => undefined), toggle: vi.fn(async () => {}) });
  const source = readFileSync('src/resultViewHtml.ts', 'utf8').replace(/\r\n/gu, '\n');
  const begin = source.indexOf("if (message.command === 'playGeneratedAudio' &&");
  const end = source.indexOf("if (message.command === 'tutorLiveReplyFragment')", begin);
  // 2026-10-12: The player now observes playing before ended.
  const listenerStart = source.indexOf("if (player instanceof HTMLAudioElement) {\n      player.addEventListener('playing'");
  const listenerEnd = source.indexOf("document.addEventListener('change'", listenerStart);
  expect(listenerStart).toBeGreaterThanOrEqual(0);
  class AudioBoundary {
    src = ''; volume = 1; ended = false; error: unknown = null;
    classList = { add: vi.fn() };
    listeners = new Map<string, () => void>();
    pause = vi.fn(); load = vi.fn();
    play = vi.fn(async () => {});
    removeAttribute = vi.fn((name: string) => { if (name === 'src') this.src = ''; });
    addEventListener(name: string, listener: () => void) { this.listeners.set(name, listener); }
    emit(name: 'playing' | 'ended' | 'error') {
      if (name === 'ended') this.ended = true; else if (name === 'error') this.error = { code: 3 };
      this.listeners.get(name)?.();
    }
  }
  const player = new AudioBoundary();
  const context = createContext({ player, HTMLAudioElement: AudioBoundary,
    vscode: { postMessage: (message: unknown) => harness.dispatch(message) }, message: undefined });
  // Read the initialization from the rendered program, rather than duplicating its state.
  const initStart = source.indexOf("let playerMode = 'idle';");
  runInContext(source.slice(initStart, source.indexOf('function allowedPronunciationUrl', initStart)) +
    source.slice(listenerStart, listenerEnd), context);
  harness.webview.postMessage.mockImplementation(async (message: unknown) => {
    context.message = message;
    runInContext(source.slice(begin, end), context);
    return true;
  });
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ audioContent: CHIRP_24K_MONO_MP3_BASE64 })));
  const fallback = vi.fn(async () => {}), notice = vi.fn(), log = vi.fn();
  const speech = new GoogleChirpSpeech(async () => ['mock', 'speech', 'credential'].join('-'), {
    play: (base64, volume, started) => harness.provider.playGeneratedAudioBase64(base64, volume, started),
    stop: () => harness.provider.stopGeneratedAudio()
  }, notice, fetcher as typeof fetch, log);
  return { ...harness, player, speech, fetcher, fallback, notice, log };
}
it('V224 plays Google-format 24 kHz mono MP3 through Chirp, the host bridge and the panel player', async () => {
  const f = chirpPanelHarness();
  // 2026-10-12: Complete the harness's background model refresh before isolating playback.
  await vi.waitFor(() => expect(f.provider.tutorState.speech.handyStatus).not.toBe('checking'));
  const bytes = Buffer.from(CHIRP_24K_MONO_MP3_BASE64, 'base64');
  expect(bytes.subarray(0, 4).toString('hex')).toBe('fff344c4'); // MPEG-2 Layer III, 24 kHz mono.
  const pending = f.speech.speak('A short sentence.', { voice: 'Callirrhoe', ratePercent: 0, volume: 50 }, f.fallback);
  await vi.waitFor(() => expect(f.player.play).toHaveBeenCalledOnce());
  expect(f.player.src).toBe(`data:audio/mpeg;base64,${CHIRP_24K_MONO_MP3_BASE64}`);
  expect(f.player.volume).toBe(0.5);
  f.player.emit('playing'); f.player.emit('ended');
  await pending;
  // 2026-10-12: Successful playback records one timing line and carries a clip identity.
  expect(f.fallback).not.toHaveBeenCalled(); expect(f.notice).not.toHaveBeenCalled();
  expect(f.log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^\[speech\] Chirp first audio after \d+ ms$/u));
  expect(f.webview.postMessage).toHaveBeenCalledWith({ command: 'playGeneratedAudio', audioBase64: CHIRP_24K_MONO_MP3_BASE64, volume: 50, playbackId: expect.any(Number) });
});
it('V224 a canceled play promise cannot fail a replacement Chirp MP3', async () => {
  const f = chirpPanelHarness();
  // 2026-10-12: Startup refresh is independent of this two-clip lifecycle.
  await vi.waitFor(() => expect(f.provider.tutorState.speech.handyStatus).not.toBe('checking'));
  let rejectOld!: (error: Error) => void;
  f.player.play.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectOld = reject; }));
  const options = { voice: 'Callirrhoe', ratePercent: 0, volume: 50 };
  const first = f.speech.speak('Old clip.', options, f.fallback);
  await vi.waitFor(() => expect(f.player.play).toHaveBeenCalledOnce());
  const second = f.speech.speak('Replacement clip.', options, f.fallback);
  await vi.waitFor(() => expect(f.player.play).toHaveBeenCalledTimes(2));
  rejectOld(new Error('The play request was interrupted by a new load request.'));
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(f.fallback).not.toHaveBeenCalled(); expect(f.notice).not.toHaveBeenCalled();
  f.player.emit('playing'); f.player.emit('ended');
  await Promise.all([first, second]);
  // 2026-10-12: Only the replacement reached playback, so it alone gets a timing line.
  expect(f.log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^\[speech\] Chirp first audio after \d+ ms$/u));
});
