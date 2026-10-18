import { TUTOR_DEFAULTS } from '../src/tutor/defaults.js';
import { load } from 'cheerio';
import { describe, expect, it, vi } from 'vitest';

const showWarningMessage = vi.hoisted(() => vi.fn());

vi.mock('vscode', () => ({
  commands: { executeCommand: vi.fn() },
  env: { remoteName: undefined },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
  Uri: { joinPath: (...parts: unknown[]) => parts },
  window: { showWarningMessage }
}));

import { KrenResultsViewProvider } from '../src/resultsView.js';
import { renderTutorConversation } from '../src/resultViewHtml.js';
import {
  createTutorViewState,
  resetTutorGeneratedWork,
  tutorConversationPreferences,
  type TutorConversationPreferences
} from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

interface ProviderInternals {
  tutorState: ReturnType<typeof createTutorViewState>;
  view?: unknown;
  handleMessage(message: unknown): Promise<void>;
}

/**
 * V129, 2026-09-20. Every conversation choice used to live in memory alone, so each window
 * reload returned a reader who had chosen Standard to Live (Gemini), which opens a paid
 * streaming session and takes over the microphone without saying so.
 */
function preferenceProvider(stored?: unknown): {
  internals: ProviderInternals;
  written: TutorConversationPreferences[];
} {
  const written: TutorConversationPreferences[] = [];
  const actions = {
    notify: vi.fn(), copy: vi.fn(), details: vi.fn(), replace: vi.fn(), copyText: vi.fn(),
    replaceText: vi.fn(), applyGrammarChoices: vi.fn(), manageGrammarIssue: vi.fn(),
    readAloudText: vi.fn(), stopReadAloud: vi.fn(), clear: vi.fn(),
    loadUserDictionary: vi.fn(), saveUserDictionaryEntry: vi.fn(),
    deleteUserDictionaryEntry: vi.fn(), deleteUserDictionaryEntries: vi.fn(),
    previewUserDictionaryPurge: vi.fn(), confirmUserDictionaryPurge: vi.fn(),
    previewUserDictionaryImport: vi.fn(), applyUserDictionaryImport: vi.fn(),
    exportUserDictionary: vi.fn(), regenerateUserDictionaryEntry: vi.fn(),
    readSelectedEditorPassage: vi.fn(), generateTutor: vi.fn(), transcribeTutorAudio: vi.fn(),
    runTutorTool: vi.fn(), updateSetting: vi.fn(), updateTutorVoiceSetting: vi.fn(),
    runCommand: vi.fn(), rerunOperation: vi.fn(), log: vi.fn(),
    settings: vi.fn(() => ({ ...PANEL_SETTINGS_FIXTURE })),
    refreshGeminiModels: vi.fn(), refreshGeminiLiveModels: vi.fn(),
    refreshProModels: vi.fn(), refreshOpenAIModels: vi.fn(),
    refreshAnthropicModels: vi.fn(), refreshReadAloudVoices: vi.fn(),
    readTutorPreferences: vi.fn(() => stored),
    writeTutorPreferences: vi.fn((preferences: TutorConversationPreferences) => {
      written.push(preferences);
    })
  };
  const provider = new KrenResultsViewProvider(actions as never, {} as never);
  const internals = provider as unknown as ProviderInternals;
  internals.view = { webview: {
    html: '', cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }),
    postMessage: vi.fn(async () => true)
  } };
  return { internals, written };
}

const EVERY_CHOICE: TutorConversationPreferences = {
  // Changed 2026-10-17: V262, owner item I39, Source joins the stored conversation preferences.
  from: 'situation',
  // Changed 2026-10-18: V263, owner item I43, runtime preferences have one Send value.
  send: 'stopSpeaking',
  replies: 'standard',
  replyLength: 'long',
  situationPicture: 'none',
  // 2026-10-01: V178 stores transparency with every other conversation preference.
  pictureTransparency: '40',
  // 2026-10-02: V182 remembers balloon backgrounds alongside pictures.
  balloonTransparency: '30',
  coaching: 'teaching',
  liveVoice: 'Puck'
};

describe('V129 conversation preferences survive a reload', () => {
  it('restores stored Source without restoring lesson completion', () => {
    const { internals } = preferenceProvider({ from: 'lesson', lessonContext: { subject: 'Old work' }, lessonRevision: 1 });
    expect(internals.tutorState.lesson).toBeUndefined();
    expect(internals.tutorState.conversation.lessonContext).toBeUndefined();
    // Changed 2026-10-17: V262, owner item I39, Source is stored, but lesson completion stays session-only.
    expect(tutorConversationPreferences({ from: 'lesson' })).toEqual({ from: 'lesson' });
    expect(internals.tutorState.conversation.from).toBe('lesson');
  });
  it('restores every stored choice when the provider is built again', () => {
    const { internals } = preferenceProvider(EVERY_CHOICE);
    expect(internals.tutorState.conversation).toMatchObject(EVERY_CHOICE);
  });

  it('V157 writes all six choices and no retired Answers preference', async () => {
    const { internals, written } = preferenceProvider();
    await internals.handleMessage({
      command: 'updateTutorConversationReplies', input: 'standard'
    });
    expect(written).toHaveLength(1);
    // Changed 2026-10-01: picture transparency joins the stored picture choice.
    // 2026-10-12: Stored Reply thinking is ignored and never written back.
    expect(written[0]).not.toHaveProperty('replyThinking');
    expect(Object.keys(written[0]!).sort()).toEqual(
      // Changed 2026-10-17: V262, owner item I39, the write list now includes Source.
      ['balloonTransparency', 'coaching', 'from', 'liveVoice', 'pictureTransparency', 'replies', 'replyLength', 'send', 'situationPicture']
    );
    expect(written[0]).toMatchObject({ replies: 'standard' });
  });

  it('V157 writes Reply length and restores that exact choice in a new window', async () => {
    const first = preferenceProvider();
    await first.internals.handleMessage({
      command: 'updateTutorConversationReplyLength', input: 'medium'
    });
    expect(first.written.at(-1)).toMatchObject({ replyLength: 'medium' });
    const second = preferenceProvider(first.written.at(-1));
    expect(second.internals.tutorState.conversation.replyLength).toBe('medium');
  });

  it('keeps all six remembered choices through Reset and the next preference write', async () => {
    const { internals, written } = preferenceProvider(EVERY_CHOICE);
    Object.assign(internals.tutorState.conversation, { status: 'stopped' });
    showWarningMessage.mockResolvedValueOnce('Reset');

    await internals.handleMessage({ command: 'resetTutorSession' });

    expect(internals.tutorState.conversation).toMatchObject(EVERY_CHOICE);
    await internals.handleMessage({ command: 'updateTutorConversationSend', input: 'stopSpeaking' });
    expect(written.at(-1)).toEqual({ ...EVERY_CHOICE, send: 'stopSpeaking' });
  });

  it('V147 keeps every conversation preference when Apply resets generated work', () => {
    // Changed 2026-09-25 for V157. These are all six owner-preference keys,
    // and every value differs from the fresh-state default so dropping any one is observable.
    const state = createTutorViewState();
    Object.assign(state.conversation, EVERY_CHOICE, {
      status: 'active', currentQuestion: 'Old question?',
      transcript: [{
        question: 'Old question?', learnerAnswer: 'Old answer.',
        correction: 'Old answer.', explanation: ''
      }]
    });
    state.toolDrawer = { tool: 'ask', input: 'Old generated work.', status: 'ready' };

    const reset = resetTutorGeneratedWork(state);

    expect(reset.conversation).toMatchObject({
      // Changed 2026-10-18: V263, owner item I43, runtime preferences have one Send value.
      send: 'stopSpeaking',
      replies: 'standard',
          replyLength: 'long',
      coaching: 'teaching',
      liveVoice: 'Puck'
    });
    expect(reset.conversation.status).toBe('idle');
    expect(reset.conversation.transcript).toEqual([]);
    expect(reset.toolDrawer).toBeUndefined();
  });

  it('stores nothing about the conversation that is running', async () => {
    const { internals, written } = preferenceProvider();
    Object.assign(internals.tutorState.conversation, {
      status: 'active',
      draftAnswer: 'Words the reader has not sent.',
      busy: true,
      transcript: [{
        question: 'What happened?', learnerAnswer: 'I go there yesterday.',
        correction: 'I went there yesterday.', explanation: 'Use the past tense.'
      }]
    });
    await internals.handleMessage({ command: 'updateTutorConversationSend', input: 'button' });
    const record = JSON.stringify(written[0]);
    expect(record).not.toContain('Words the reader has not sent.');
    expect(record).not.toContain('transcript');
    expect(record).not.toContain('busy');
    expect(record).not.toContain('active');
  });

  it.each([
    ['send', 'telepathy'],
    ['replies', 'liveOpenAI'],
    ['replyThinking', 'slow'],
    ['replyLength', 'unbounded'],
    ['coaching', 'silently'],
    ['liveVoice', 'Ganymede']
  ])('drops a stored %s this build no longer offers', (key, value) => {
    const fresh = createTutorViewState().conversation;
    const { internals } = preferenceProvider({ ...EVERY_CHOICE, [key]: value });
    expect(tutorConversationPreferences({ [key]: value })).toEqual({});
    expect(internals.tutorState.conversation[key as keyof typeof fresh])
      .toBe(fresh[key as keyof typeof fresh]);
  });

  it('keeps the reader\'s other choices when one stored value is unusable', () => {
    const { internals } = preferenceProvider({ ...EVERY_CHOICE, liveVoice: 'Ganymede' });
    expect(internals.tutorState.conversation).toMatchObject({
      // Changed 2026-10-18: V263, owner item I43, runtime preferences have one Send value.
      send: 'stopSpeaking', replies: 'standard', coaching: 'teaching'
    });
    // Changed 2026-10-03: omitted voice uses current defaults.
    expect(internals.tutorState.conversation.liveVoice).toBe(TUTOR_DEFAULTS.conversation.liveVoice);
  });

  it('V140 tolerantly ignores the retired stored Answers value', async () => {
    // Added 2026-09-23: old globalState records remain readable, but the retired field is
    // neither restored nor written back into the current preference shape.
    const stored = { ...EVERY_CHOICE, answers: 'spoken' };
    const { internals, written } = preferenceProvider(stored);
    expect(tutorConversationPreferences(stored)).toEqual(EVERY_CHOICE);
    expect('answers' in internals.tutorState.conversation).toBe(false);
    await internals.handleMessage({ command: 'updateTutorConversationSend', input: 'button' });
    expect(written[0]).toEqual(EVERY_CHOICE);
  });

  it('ignores stored state that is not an object at all', () => {
    for (const stored of ['liveGemini', 42, null, undefined, []]) {
      const { internals } = preferenceProvider(stored);
      expect(internals.tutorState.conversation.replies).toBe('liveGemini');
    }
  });
});

describe('V263 removes the Send setting in Standard and Live', () => {
  it('uses automatic speech submission in Live without a Send row', () => {
    const state = createTutorViewState();
    Object.assign(state.conversation, {
      status: 'active', replies: 'liveGemini', currentQuestion: 'What happened next?'
    });
    const $ = load(renderTutorConversation(state, 'handy'));
    const send = $('[data-tutor-conversation-send]');
    // Changed 2026-10-18: V263, owner item I43, Live has no Send setting.
    expect(send).toHaveLength(0);
    expect($('[data-tutor-chat-microphone] [data-command="dictateTutorConversation"]')).toHaveLength(1);
    // The chosen value is kept, so it applies again the moment Standard returns.
    expect(state.conversation.send).toBe('stopSpeaking');
  });

  it('uses automatic speech submission in Standard without a Send row', () => {
    const state = createTutorViewState();
    Object.assign(state.conversation, {
      status: 'active', replies: 'standard', currentQuestion: 'What happened next?'
    });
    const $ = load(renderTutorConversation(state, 'handy'));
    const send = $('[data-tutor-conversation-send]');
    // Changed 2026-10-18: V263, owner item I43, Standard also sends automatically.
    expect(send).toHaveLength(0);
    expect(state.conversation.send).toBe('stopSpeaking');
  });
});
