import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TUTOR_MAP, type TutorLesson } from '@kren/core/tutor';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { mountedPanel } from './support/mountedPanel.js';
import { tutorSpeechPlaybackBarriers } from '../src/speech/speechAdapter.js';
import { tutorRecipeFromState } from '../src/tutor/state.js';
import type { TutorLiveSocketEvent } from '../src/tutor/liveSession.js';
import type { TutorStructuredGenerationRequest } from '../src/tutor/generation.js';
import * as usage from '../src/languageModelUsage.js';

const config = vi.hoisted(() => {
  const scopes = new Map<string, Record<string, unknown>>();
  const effective = (key: string, fallback: unknown) => {
    const values = scopes.get(key);
    return values?.workspaceFolderValue ?? values?.workspaceValue ?? values?.globalValue ?? fallback;
  };
  return { scopes, effective, update: vi.fn(async (key: string, value: unknown, target: number) => {
    scopes.set(key, { ...scopes.get(key), [target === 3 ? 'workspaceFolderValue'
      : target === 2 ? 'workspaceValue' : 'globalValue']: value });
  }) };
});
vi.mock('vscode', () => ({
  workspace: { getConfiguration: () => ({ get: config.effective,
    inspect: (key: string) => config.scopes.get(key), update: config.update }) },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  commands: { executeCommand: vi.fn() }, env: {}, window: {},
  Uri: { joinPath: () => ({ toString: () => 'test' }) }
}));
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { generateTutorConversation, startTutorConversation } from '../src/resultsViewConversation.js';
import { openTutorReplayLearnerSession, speakTutorConversationSequence } from '../src/resultsViewReplay.js';
import { confirmTutorLessonReset, confirmTutorReset } from '../src/resultsViewSettings.js';
import { confirmTutorDiagnosticReportDeletion } from '../src/resultsViewLesson.js';

const scene = 'Two colleagues meet. A visitor approaches.';
const opening = 'How can I help?';
class Socket {
  readyState = 0;
  frames: Record<string, any>[] = [];
  listeners = new Map<string, Set<(event: TutorLiveSocketEvent) => void>>();
  send(raw: string) { this.frames.push(JSON.parse(raw)); }
  close() { this.readyState = 3; }
  addEventListener(type: string, callback: (event: TutorLiveSocketEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(callback);
  }
  removeEventListener(type: string, callback: (event: TutorLiveSocketEvent) => void) { this.listeners.get(type)?.delete(callback); }
  emit(type: string, data?: unknown) {
    if (type === 'open') this.readyState = 1;
    this.listeners.get(type)?.forEach(callback => callback({ data }));
  }
  complete(text: string) {
    this.emit('message', JSON.stringify({ serverContent: { outputTranscription: { text }, turnComplete: true },
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 } }));
  }
}
const views: KrenResultsViewProvider[] = [];
function fixture() {
  const settings = { ...PANEL_SETTINGS_FIXTURE, tutorProfile: 'standard' as const,
    tutorLiveProfile: 'pro' as 'standard' | 'pro', tutorReadAloudProvider: 'edgeOnline' as const,
    credentialPresence: { geminiDefault: true, geminiAlternate: true } };
  const played = vi.fn();
  const actions = {
    settings: () => ({ ...settings, tutorLiveProfile: config.effective('tutor.liveGeminiProfile', settings.tutorLiveProfile) }),
    notify: vi.fn(), log: vi.fn(), stopReadAloud: vi.fn(), writeTutorPreferences: vi.fn(),
    updateSetting: vi.fn(async (key: string, value: unknown) => config.update(key, value, 1)),
    readAloudText: vi.fn(async (text: string) => {
      const barrier = tutorSpeechPlaybackBarriers.get(actions.readAloudText);
      if (barrier && !await barrier()) return;
      played(text); view.tutorSpeechPlaybackStarted();
    }),
    generateTutor: vi.fn(async (request: TutorStructuredGenerationRequest): Promise<unknown> => {
      if (request.kind === 'liveSessionCredential') return { apiKey: String(Symbol()) };
      return { scene, opening, tutorRole: 'colleague', learnerRole: 'visitor' };
    })
  };
  const sockets: Socket[] = [];
  const view = new KrenResultsViewProvider(actions as never, {} as never, undefined, undefined,
    () => { const socket = new Socket(); sockets.push(socket); return socket; },
    { start: vi.fn(async () => ({ play: vi.fn(), close: vi.fn(), stop: vi.fn() })) });
  views.push(view);
  const internals = view as unknown as { activeScreen: string; handleMessage(message: unknown): Promise<void> };
  internals.activeScreen = 'tutor';
  Object.assign(view.tutorState.conversation, { from: 'anything', replies: 'liveGemini', starts: 'kren',
    speakerOn: true, situationPicture: 'none', coaching: 'afterwards' });
  let panel: ReturnType<typeof mountedPanel>;
  let html = '';
  const messages: Record<string, any>[] = [];
  view.view = { webview: { cspSource: 'test', asWebviewUri: () => ({ toString: () => 'test' }),
    get html() { return html; }, set html(value: string) { html = value; panel = mountedPanel(value, () => {}); },
    postMessage: async (message: Record<string, any>) => { messages.push(message); panel?.message(message); return true; }
  } } as never;
  view.render();
  return { view, actions, settings, sockets, played, messages, panel: () => panel,
    command: (command: string) => internals.handleMessage({ command }) };
}
async function flush() { await vi.advanceTimersByTimeAsync(0); }
async function liveGap(f: ReturnType<typeof fixture>) {
  startTutorConversation(f.view); await flush();
  const socket = f.sockets[0]!;
  socket.emit('open'); socket.emit('message', JSON.stringify({ setupComplete: {} })); await flush();
  socket.complete(scene); await flush();
  expect(socket.frames.filter(frame => frame.clientContent)).toHaveLength(2);
  socket.complete(opening); await flush();
  expect(f.view.tutorState.conversation.busy).toBe(true);
  await vi.advanceTimersByTimeAsync(600);
  return socket;
}
function drafted(f: ReturnType<typeof fixture>) {
  const target = TUTOR_MAP.find(node => !TUTOR_MAP.some(child => child.parentId === node.id))!;
  f.view.tutorState.selection = [{ nodeId: target.id, role: 'primary' }];
  const recipe = tutorRecipeFromState(f.view.tutorState);
  const lesson = { schemaVersion: 1, mapVersion: recipe.mapVersion, lessonTitle: 'Kept lesson',
    level: 'B2', primaryTarget: { ...target, nodeId: target.id, role: 'primary' }, supportingTargets: [],
    conceptExplanation: 'Use this pattern.', interactionExplanation: 'Keep the meaning.', rules: [],
    commonErrors: [], generationNotes: [], examples: [{ id: 'example-1',
      sentence: 'Could you help me with this report?', targetIds: [target.id], annotations: [] }]
  } as TutorLesson;
  f.view.tutorState.lesson = { recipe, lesson, findings: [] };
}

describe('V306 conversation verification fixes', () => {
  beforeEach(() => vi.useFakeTimers({ now: 10_000 }));
  afterEach(async () => {
    for (const view of views.splice(0)) view.dispose();
    await flush(); config.scopes.clear(); config.update.mockClear(); vi.restoreAllMocks(); vi.useRealTimers();
  });

  it('fix 1: socket closes at 600 ms, settles busy and delivers the opening through Standard', async () => {
    const f = fixture(); const socket = await liveGap(f);
    socket.emit('close'); await flush();
    expect(f.view.tutorState.conversation).toMatchObject({ busy: false, currentQuestion: opening });
    expect(f.view.tutorConversationController).toBeUndefined();
    expect(f.actions.notify).toHaveBeenCalledWith('warning', 'The Live session stopped. KREN continues with Standard replies.');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.played).toHaveBeenCalledWith(opening);
    const stop = f.panel().query('[data-tutor-composer-stop]')!;
    expect(stop.disabled).toBe(false);
    expect(stop.closest('[hidden], details:not([open])')).toBeNull();
    stop.focus(); expect(f.panel().document.activeElement).toBe(stop);
  });

  it.each(['stopTutorConversation', 'showStartPage', 'startNewTutorConversation', 'abort'])('fix 1: %s during the gap cancels without delivering', async command => {
    const f = fixture(); const socket = await liveGap(f);
    if (command === 'abort') f.view.tutorConversationController!.abort();
    else {
      if (command === 'startNewTutorConversation') await f.command('stopTutorConversation');
      await f.command(command);
    }
    socket.emit('close'); await vi.advanceTimersByTimeAsync(2_000);
    expect(f.played).not.toHaveBeenCalledWith(opening);
    expect(f.messages.filter(message => message.command === 'tutorConversationOpeningReady' && message.opening === opening)).toEqual([]);
  });

  it.each(['workspaceValue', 'workspaceFolderValue', 'globalValue'])('fix 2: Use Gemini Paid writes effective %s and starts with one question', async scope => {
    config.scopes.set('tutor.liveGeminiProfile', { globalValue: 'pro', workspaceValue: 'standard',
      ...(scope === 'globalValue' ? { workspaceValue: undefined, globalValue: 'standard' } : {}),
      ...(scope === 'workspaceFolderValue' ? { workspaceFolderValue: 'standard' } : {}) });
    const f = fixture(); f.settings.credentialPresence.geminiDefault = false;
    const popup = vi.spyOn(f.view, 'showInformationMessage').mockResolvedValueOnce('Use Gemini Paid').mockResolvedValue('Stop');
    startTutorConversation(f.view); await flush();
    expect(config.update).toHaveBeenCalledWith('tutor.liveGeminiProfile', 'pro', scope === 'workspaceFolderValue' ? 3 : scope === 'workspaceValue' ? 2 : 1);
    expect(config.effective('tutor.liveGeminiProfile', undefined)).toBe('pro');
    expect(popup).toHaveBeenCalledTimes(1);
    expect(f.actions.generateTutor).toHaveBeenCalled();
    expect(f.view.tutorState.conversation.status).toBe('active');
  });

  it('fix 2: Switch to Standard persists the tutor preference before starting', async () => {
    const f = fixture(); f.settings.credentialPresence.geminiAlternate = false;
    const popup = vi.spyOn(f.view, 'showInformationMessage').mockResolvedValue('Switch to Standard');
    startTutorConversation(f.view); await flush();
    expect(popup).toHaveBeenCalledTimes(1);
    expect(f.actions.writeTutorPreferences).toHaveBeenCalledWith(expect.objectContaining({ replies: 'standard' }));
    expect(f.view.tutorState.conversation).toMatchObject({ replies: 'standard', status: 'active' });
  });

  it.each(['Lesson Reset', 'Tutor Reset', 'Delete and Reset'])('fix 3: %s during speech updates the lesson and delivers its announcement after speech', async kind => {
    const f = fixture(); drafted(f);
    Object.assign(f.view.tutorState.conversation, { replies: 'standard', status: 'active', currentQuestion: opening });
    f.view.render();
    expect(f.panel().query('[data-tutor-result="lesson"]')).not.toBeNull();
    let finish!: () => void;
    f.actions.readAloudText.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    speakTutorConversationSequence(f.view, ['A sufficiently long conversation reply.'], 'Speech failed.'); await flush();
    expect(f.view.tutorConversationSpeechSequenceRunning).toBe(true);
    const hold = f.view.holdTutorSpeech();
    vi.spyOn(f.view, 'showWarningMessage').mockResolvedValue(kind === 'Lesson Reset' ? 'Reset' : kind === 'Tutor Reset' ? 'Reset panel' : 'Delete & Reset');
    if (kind === 'Lesson Reset') await confirmTutorLessonReset(f.view);
    else if (kind === 'Tutor Reset') await confirmTutorReset(f.view);
    else {
      f.view.tutorState.diagnosticReport = { findings: [], targets: [] };
      f.view.tutorState.diagnosticReportDrawerOpen = true;
      await confirmTutorDiagnosticReportDeletion(f.view);
    }
    expect(f.view.tutorState.lesson).toBeUndefined();
    finish(); hold(); await flush();
    expect(f.panel().query('[data-tutor-result="lesson"]')).toBeNull();
    const announcement = f.panel().query('[data-tutor-live]');
    expect(announcement?.textContent).toMatch(/reset|deleted/i);
    expect(f.actions.notify).not.toHaveBeenCalled();
    const draft = f.panel().query('[data-command="generateTutorLesson"]')!;
    expect(draft.closest('[hidden], details:not([open])')).toBeNull();
    expect(draft.getAttribute('tabindex')).not.toBe('-1');
    if (draft.disabled) expect(draft.getAttribute('aria-description')).toMatch(/learning map|target|question/i);
    else { draft.focus(); expect(f.panel().document.activeElement).toBe(draft); }
  });

  it('fix 4: Live learner Replay records the Live profile rather than the text profile', async () => {
    const record = vi.spyOn(usage, 'recordLanguageModelUsage');
    const f = fixture();
    const pending = openTutorReplayLearnerSession(f.view, f.view.tutorReplayAllGeneration, new AbortController());
    await flush(); const socket = f.sockets[0]!;
    socket.emit('open'); socket.emit('message', JSON.stringify({ setupComplete: {} })); await flush();
    const session = (await pending)!;
    const turn = session.sendTurn('Hello.'); socket.complete('Hello.'); await turn;
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ feature: 'conversationLive', geminiProfile: 'pro' }), expect.anything());
  });

  it('fix 5: fallback off still refuses a Live-only Fast model and names kren.tutor.hintModel', async () => {
    const f = fixture();
    f.view.liveModels = [{ id: 'known-live-model', displayName: 'Live model', liveOnly: true }];
    await expect(generateTutorConversation(f.view, { kind: 'conversationTurn', input: '{}', schema: {} } as TutorStructuredGenerationRequest,
      new AbortController().signal, undefined, { provider: 'gemini', model: 'gemini-3.8-flash', geminiProfile: 'standard',
        fastModel: 'known-live-model', fallbackEnabled: false, fallbackModel: '', fallbackThinkingOrEffort: 'auto', thinkingOrEffort: 'auto' }))
      .rejects.toThrow(/kren\.tutor\.hintModel/);
    expect(f.actions.generateTutor).not.toHaveBeenCalled();
  });
});
