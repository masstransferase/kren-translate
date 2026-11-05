import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  commands: { executeCommand: vi.fn() },
  window: { showWarningMessage: vi.fn(), showErrorMessage: vi.fn(async () => undefined) },
  env: { remoteName: undefined },
  Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) }
}));

import { TUTOR_CONVERSATION_SCENE_SLANTS, tutorConversationHandoffGreetingTurn } from '@kren/core/tutor';
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { applyTutorConversationHandoff, reopenLiveTutorSession } from '../src/resultsViewTurns.js';
import { TUTOR_LIVE_HANDOFF_LINE_WAIT_MS, tutorLivePlaybackProgress, toggleTutorLiveMicrophone } from '../src/resultsViewLive.js';
import { TutorLiveSession } from '../src/tutor/liveSession.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

/**
 * F3 (plan rows V18 and V19, VS Code side): at a Live handoff the old session closes only after its line has played out, and the
 * microphone reopens by itself only when the learner was listening hands-free. Verify results: these read the view's state and the
 * calls it makes. Whether the new voice is heard and the microphone is live needs a person running VS Code with a microphone.
 */

const flush = async () => { for (let i = 0; i < 200; i++) await Promise.resolve(); };
const HANDOFF = { role: 'Sarah, the manager', gender: 'female' as const };

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function setup(options: { playing?: boolean; listening?: boolean; pressToTalk?: boolean; credential?: Promise<unknown> } = {}) {
  vi.useFakeTimers();
  const settings = { ...PANEL_SETTINGS_FIXTURE, credentialPresence: { geminiDefault: true, geminiAlternate: true } };
  const actions = {
    settings: () => settings, log: vi.fn(), notify: vi.fn(), stopReadAloud: vi.fn(), readAloudText: vi.fn(async () => undefined),
    writeTutorPreferences: vi.fn(), generateSituationPicture: vi.fn(),
    generateTutor: vi.fn(async () => (options.credential ? options.credential : { apiKey: 'example' }))
  };
  const player = { close: vi.fn(), stop: vi.fn(), play: vi.fn() };
  const waveOutPlayer = { start: vi.fn(async () => player) };
  const microphone = { stop: vi.fn() };
  const waveInRecorder = { start: vi.fn(async () => microphone) };
  const view = new KrenResultsViewProvider(actions as never, {} as never, undefined, undefined, undefined,
    waveOutPlayer as never, waveInRecorder as never);
  const posted: Array<Record<string, unknown>> = [];
  view.view = { visible: true, webview: { html: '', cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }),
    postMessage: vi.fn(async (message: Record<string, unknown>) => { posted.push(message); return true; }) } } as never;
  Object.assign(view.tutorState.conversation, { status: 'active', replies: 'liveGemini', from: 'anything', coaching: 'inline',
    speakerOn: true, situationPicture: 'none', tutorRole: 'store clerk', learnerRole: 'customer', currentQuestion: 'How can I help?',
    liveVoice: 'Zephyr' });
  view.tutorLiveOpeningContext = { kind: 'anything', register: 'casual', sceneSlant: TUTOR_CONVERSATION_SCENE_SLANTS[0],
    tutorRole: 'store clerk', learnerRole: 'customer' } as never;
  view.tutorLivePressToTalk = options.pressToTalk === true;
  const oldSession = { close: vi.fn(), activityEnd: vi.fn(), endAudioStream: vi.fn(), sendAudio: vi.fn(), takeHandoff: () => undefined };
  view.tutorLiveSession = oldSession as never;
  if (options.playing) view.tutorLivePlaybackBlockedUntil = Number.POSITIVE_INFINITY;
  if (options.listening) view.tutorLiveMicrophone = { stop: vi.fn() } as never;
  // The system instruction each new session was opened with, so a test can read what the newcomer was told.
  const instructions: string[] = [];
  const connect = vi.spyOn(TutorLiveSession.prototype, 'connect').mockImplementation(async function (this: unknown) {
    instructions.push((this as { options: { systemInstruction: string } }).options.systemInstruction);
  });
  // The greeting turn: the words the newcomer speaks arrive in the view's reply text before the turn completes.
  const greeting = 'Hello, I am Sarah, the manager. How can I help you today?';
  const sendTurn = vi.spyOn(TutorLiveSession.prototype, 'sendTurn').mockImplementation(async () => { view.tutorLiveReplyText = greeting; });
  const talkStates = () => posted.filter((message) => message.command === 'tutorLiveTalkState');
  /** The player reports its last buffer done: the speaker is idle. */
  const idle = () => tutorLivePlaybackProgress(view, 1, 0, view.tutorLiveAudioGeneration);
  return { view, actions, oldSession, connect, sendTurn, instructions, greeting, waveInRecorder, posted, talkStates, idle };
}

describe('F3 handoff waits for the old character\'s line (V19)', () => {
  it('keeps the old session open and Talk unavailable while the line plays, then closes it and reopens when the speaker goes idle', async () => {
    const t = setup({ playing: true });
    expect(applyTutorConversationHandoff(t.view, HANDOFF)).toBe(true);
    await flush();
    expect(t.oldSession.close).not.toHaveBeenCalled();
    expect(t.connect).not.toHaveBeenCalled();
    expect(t.view.tutorLiveSession).toBe(t.oldSession);
    // What a reader reaches: the panel was told Talk is unavailable, and that the new voice is connecting.
    expect(t.talkStates().at(-1)).toMatchObject({ available: false });
    expect(t.posted).toContainEqual(expect.objectContaining({ command: 'tutorConversationHandoff', reconnecting: true }));
    t.idle();
    await flush();
    expect(t.oldSession.close).toHaveBeenCalledTimes(1);
    expect(t.connect).toHaveBeenCalledTimes(1);
    expect(t.oldSession.close.mock.invocationCallOrder[0]!).toBeLessThan(t.connect.mock.invocationCallOrder[0]!);
    expect(t.view.tutorLiveSession).not.toBe(t.oldSession);
    expect(t.talkStates().at(-1)).toMatchObject({ available: true });
    expect(t.posted.filter((message) => message.command === 'tutorConversationHandoff').at(-1)).toMatchObject({ reconnecting: false });
  });

  it('closes the old microphone at once, before the line has finished', async () => {
    const t = setup({ playing: true, listening: true });
    const microphone = t.view.tutorLiveMicrophone as unknown as { stop: ReturnType<typeof vi.fn> };
    applyTutorConversationHandoff(t.view, HANDOFF);
    expect(microphone.stop).toHaveBeenCalledTimes(1);
    expect(t.view.tutorLiveMicrophone).toBeUndefined();
    expect(t.oldSession.close).not.toHaveBeenCalled();
  });

  it(`waits at most ${TUTOR_LIVE_HANDOFF_LINE_WAIT_MS} ms for a speaker that never reports idle`, async () => {
    expect(TUTOR_LIVE_HANDOFF_LINE_WAIT_MS).toBe(8000);
    const t = setup({ playing: true });
    applyTutorConversationHandoff(t.view, HANDOFF);
    await vi.advanceTimersByTimeAsync(TUTOR_LIVE_HANDOFF_LINE_WAIT_MS - 1);
    await flush();
    expect(t.oldSession.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(t.oldSession.close).toHaveBeenCalledTimes(1);
    expect(t.connect).toHaveBeenCalledTimes(1);
  });

  it('does not wait when no line is playing, or when the speaker is off', async () => {
    const quiet = setup({ playing: false });
    applyTutorConversationHandoff(quiet.view, HANDOFF);
    expect(quiet.oldSession.close).toHaveBeenCalledTimes(1);
    await flush();
    expect(quiet.connect).toHaveBeenCalledTimes(1);
    const muted = setup({ playing: true });
    muted.view.tutorState.conversation.speakerOn = false;
    applyTutorConversationHandoff(muted.view, HANDOFF);
    expect(muted.oldSession.close).toHaveBeenCalledTimes(1);
  });

  it.each(['Stop', 'Reset or Start new', 'a second handoff'])('%s abandons the wait: no reopen follows, even after the 8 seconds', async (abandon) => {
    const t = setup({ playing: true });
    applyTutorConversationHandoff(t.view, HANDOFF);
    await flush();
    if (abandon === 'Stop') {
      const internals = t.view as unknown as { handleMessage(message: unknown): Promise<void> };
      await internals.handleMessage({ command: 'stopTutorConversation' });
    } else if (abandon === 'Reset or Start new') {
      const { releaseTutorConversationResources } = await import('../src/resultsViewLive.js');
      await releaseTutorConversationResources(t.view, true);
      t.view.tutorState.conversation.status = 'stopped';
    } else {
      applyTutorConversationHandoff(t.view, { role: 'Tom, the director', gender: 'male' });
    }
    await vi.advanceTimersByTimeAsync(TUTOR_LIVE_HANDOFF_LINE_WAIT_MS + 1);
    await flush();
    if (abandon === 'a second handoff') {
      // The second handoff's own wait ran out once: exactly one reopen, not two.
      expect(t.connect).toHaveBeenCalledTimes(1);
      expect(t.oldSession.close).toHaveBeenCalledTimes(1);
    } else {
      expect(t.connect).not.toHaveBeenCalled();
      expect(t.view.tutorLiveSession).toBeUndefined();
      expect(t.posted).toContainEqual(expect.objectContaining({ command: 'tutorConversationHandoff', reconnecting: false }));
    }
  });
});

describe('F3 the newcomer greets in the new voice after a handoff reopen (V19)', () => {
  it.each([[false, 'with no line playing'], [true, 'after the old line has played out']])(
    'sends the greeting turn once, after the new session connects, and the greeting becomes the line to answer (playing=%s, %s)', async (playing) => {
      const t = setup({ playing });
      applyTutorConversationHandoff(t.view, HANDOFF);
      if (playing) t.idle();
      await flush();
      expect(t.connect).toHaveBeenCalledTimes(1);
      expect(t.sendTurn).toHaveBeenCalledTimes(1);
      expect(t.sendTurn).toHaveBeenCalledWith(tutorConversationHandoffGreetingTurn(HANDOFF.role));
      expect(t.connect.mock.invocationCallOrder[0]!).toBeLessThan(t.sendTurn.mock.invocationCallOrder[0]!);
      // What the newcomer was told when the session opened: it has arrived as the new role and is to wait for the greeting turn.
      expect(t.instructions).toHaveLength(1);
      expect(t.instructions[0]).toContain(`You have just arrived as ${JSON.stringify(HANDOFF.role)}`);
      expect(t.instructions[0]).not.toContain('do not greet');
      // What a reader meets: the greeting is the line now waiting for their answer.
      expect(t.view.tutorState.conversation.currentQuestion).toBe(t.greeting);
      expect(t.view.tutorLiveFailed).toBeFalsy();
    });

  it('does not greet after a reconnect, a Replies switch or Back to chat: those reopen with no handoff role', async () => {
    const t = setup({ playing: false });
    t.view.tutorLiveSession = undefined;
    await reopenLiveTutorSession(t.view);
    await flush();
    expect(t.connect).toHaveBeenCalledTimes(1);
    expect(t.sendTurn).not.toHaveBeenCalled();
    expect(t.instructions[0]).toContain('do not greet');
    expect(t.instructions[0]).not.toContain('just arrived');
    expect(t.view.tutorState.conversation.currentQuestion).toBe('How can I help?');
  });

  it('does not greet when Stop ends the reopen while the new session connects', async () => {
    let resolve!: (credential: unknown) => void;
    const t = setup({ playing: false, credential: new Promise((done) => { resolve = done; }) });
    applyTutorConversationHandoff(t.view, HANDOFF);
    await flush();
    const internals = t.view as unknown as { handleMessage(message: unknown): Promise<void> };
    await internals.handleMessage({ command: 'stopTutorConversation' });
    resolve({ apiKey: 'example' });
    await flush();
    expect(t.sendTurn).not.toHaveBeenCalled();
  });

  it('treats a greeting that cannot be asked as a Live problem and leaves the old line in place', async () => {
    const t = setup({ playing: false });
    t.sendTurn.mockRejectedValue(new Error('socket closed'));
    applyTutorConversationHandoff(t.view, HANDOFF);
    await flush();
    expect(t.sendTurn).toHaveBeenCalledTimes(1);
    expect(t.view.tutorLiveFailed).toBe(true);
    expect(t.view.tutorState.conversation.currentQuestion).toBe('How can I help?');
  });
});

describe('F3 the microphone reopens by itself only after a hands-free handoff (V18)', () => {
  it.each([[false, 'while the old line plays'], [true, 'with no line playing']])(
    'opens it once when the learner was listening hands-free (quiet=%s, %s)', async (quiet) => {
      const t = setup({ playing: !quiet, listening: true });
      applyTutorConversationHandoff(t.view, HANDOFF);
      if (!quiet) t.idle();
      await flush();
      expect(t.connect).toHaveBeenCalledTimes(1);
      expect(t.waveInRecorder.start).toHaveBeenCalledTimes(1);
      expect(t.view.tutorLiveMicrophone).toBeDefined();
      expect(t.talkStates().at(-1)).toMatchObject({ available: true, listening: true });
    });

  it('stays closed when the learner was not listening', async () => {
    const t = setup({ playing: false, listening: false });
    applyTutorConversationHandoff(t.view, HANDOFF);
    await flush();
    expect(t.connect).toHaveBeenCalledTimes(1);
    expect(t.waveInRecorder.start).not.toHaveBeenCalled();
    expect(t.view.tutorLiveMicrophone).toBeUndefined();
  });

  it('stays closed with Press to talk, even when the microphone was held open', async () => {
    const t = setup({ playing: false, listening: true, pressToTalk: true });
    applyTutorConversationHandoff(t.view, HANDOFF);
    await flush();
    expect(t.connect).toHaveBeenCalledTimes(1);
    expect(t.waveInRecorder.start).not.toHaveBeenCalled();
  });

  it('stays closed after Back to chat, a Replies switch or a reconnect (a reopen that is not a handoff)', async () => {
    const t = setup({ playing: false, listening: true });
    t.view.tutorLiveSession = undefined;
    await reopenLiveTutorSession(t.view);
    await flush();
    expect(t.connect).toHaveBeenCalledTimes(1);
    expect(t.waveInRecorder.start).not.toHaveBeenCalled();
  });

  it('is canceled by a press while the new session connects', async () => {
    let resolve!: (credential: unknown) => void;
    const t = setup({ playing: false, listening: true, credential: new Promise((done) => { resolve = done; }) });
    applyTutorConversationHandoff(t.view, HANDOFF);
    await flush();
    expect(t.view.tutorLiveResumeController).toBeDefined();
    await toggleTutorLiveMicrophone(t.view);
    resolve({ apiKey: 'example' });
    await flush();
    expect(t.connect).toHaveBeenCalledTimes(1);
    expect(t.waveInRecorder.start).not.toHaveBeenCalled();
    expect(t.view.tutorLiveMicrophone).toBeUndefined();
  });

  it('is canceled by a press during the wait for the old line, and Talk stays unavailable', async () => {
    const t = setup({ playing: true, listening: true });
    applyTutorConversationHandoff(t.view, HANDOFF);
    await toggleTutorLiveMicrophone(t.view);
    expect(t.waveInRecorder.start).not.toHaveBeenCalled();
    t.idle();
    await flush();
    expect(t.connect).toHaveBeenCalledTimes(1);
    expect(t.waveInRecorder.start).not.toHaveBeenCalled();
  });

  it('is canceled by Stop while the new session connects', async () => {
    let resolve!: (credential: unknown) => void;
    const t = setup({ playing: false, listening: true, credential: new Promise((done) => { resolve = done; }) });
    applyTutorConversationHandoff(t.view, HANDOFF);
    await flush();
    const internals = t.view as unknown as { handleMessage(message: unknown): Promise<void> };
    await internals.handleMessage({ command: 'stopTutorConversation' });
    resolve({ apiKey: 'example' });
    await flush();
    expect(t.waveInRecorder.start).not.toHaveBeenCalled();
    expect(t.view.tutorLiveMicrophone).toBeUndefined();
  });
});
