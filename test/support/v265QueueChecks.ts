import assert from 'node:assert/strict';
import { resetNativeDialogsV267, questionV267 } from './v267NativeDialogs.js';
import { KrenResultsViewProvider } from '../../src/resultsView.js';
import { PANEL_COMMAND_LIST } from '../../src/panelCommands.js';
import { PANEL_SETTINGS_FIXTURE } from './panelSettingsFixture.js';
import { mountedPanel } from './mountedPanel.js';
import { findTutorTargets } from '../../src/tutor/search.js';

export const flushV265 = async () => { for (let i = 0; i < 120; i++) await Promise.resolve(); };
export function deferredV265() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** Uses the registered receiver, real host handlers, and the shipped panel script. */
export function queueHostV265() {
  const dialogs = resetNativeDialogsV267();
  let receive!: (message: unknown) => void;
  let panel!: ReturnType<typeof mountedPanel>;
  const messages: any[] = [], logs: string[] = [], commands: string[] = [], requests: unknown[] = [];
  const settings = { ...PANEL_SETTINGS_FIXTURE, tutorReadAloudProvider: 'googleChirp' as const,
    tutorConversationTakeHome: false, tutorConversationHintPrefetch: false };
  let copyCalls = 0, writes = 0;
  const actions = {
    settings: () => settings, log: (line: string) => logs.push(line),
    // Changed 2026-10-18: V265, owner item I45, mirror extension.notify's panel warning route and rejection handling.
    notify: (kind: 'information' | 'warning' | 'error', message: string) => {
      if (kind === 'warning') void Promise.resolve(view.showWarningMessage(message)).catch(() => undefined);
    },
    copy: async () => { copyCalls++; }, refreshReadAloudVoices: async () => {},
    stopReadAloud: () => {}, readAloudText: async (_text: string) => {},
    updateSetting: async (_key: string, _value: unknown) => {},
    writeTutorPreferences: () => { writes++; },
    generateTutor: async (request: unknown) => { requests.push(request); return new Promise<unknown>(() => {}); },
    // Probe dispatch with a modal-producing action. This does not assert which registered
    // extension commands currently ask a question; single-key deletion currently does not.
    runCommand: async (command: string) => {
      commands.push(command);
      await view.showWarningMessage(command === 'kren.restoreDefaultSettings'
        ? 'Return every KREN setting to its default? Your API keys stay.' : `Confirm ${command}?`, { modal: true }, 'Continue');
    }
  };
  const view = new KrenResultsViewProvider(actions as never, {} as never,
    { detect: async () => undefined, toggle: async () => {} });
  const webview = {
    cspSource: 'test', options: {}, asWebviewUri: () => ({ toString: () => 'test' }),
    set html(value: string) { panel = mountedPanel(value, message => receive(message)); },
    postMessage: async (message: any) => { messages.push(message); panel?.message(message); return true; },
    onDidReceiveMessage: (callback: typeof receive) => { receive = callback; return { dispose() {} }; }
  };
  (view as any).activeScreen = 'tutor';
  view.resolveWebviewView({ webview, visible: true,
    onDidChangeVisibility: () => ({ dispose() {} }), onDidDispose: () => ({ dispose() {} }) } as never);
  return { view, actions, messages, logs, commands, requests, settings, dialogs, receive: (message: unknown) => receive(message),
    panel: () => panel, copyCalls: () => copyCalls, writes: () => writes };
}

export async function checkV265HeldConfirmation(command: string) {
  const h = queueHostV265();
  await flushV265();
  const held = deferredV265();
  h.actions.copy = () => held.promise;
  h.receive({ command: 'copy' }); await flushV265();
  // Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
  h.receive(command === 'resetTutorSession' ? { command } : { command: 'runCommand', action: command });
  // No clock advance or release of the queued copy is allowed before this assertion.
  const dialog = questionV267(h);
  assert.equal(h.dialogs.length, 1);
  assert.equal(dialog.options.modal, true);
  if (command === 'resetTutorSession') {
    assert.equal(dialog.message, 'Reset the AI English Tutor to its defaults?');
    assert.deepEqual(dialog.choices, ['Reset panel', 'Reset everything']);
  } else assert.deepEqual(h.commands, [command]);
  dialog.answer();
  held.resolve(); await flushV265(); h.view.dispose();
}

export const confirmingCommandsV265 = ['resetTutorSession', 'kren.restoreDefaultSettings', 'kren.resetKren',
  'kren.deleteAllApiKeys', ...PANEL_COMMAND_LIST.filter(command => command.startsWith('kren.delete') && command !== 'kren.deleteAllApiKeys')];

export async function checkV265IndependentWait(command: string) {
  const h = queueHostV265(); await flushV265();
  const never = deferredV265();
  let speechCalls = 0;
  h.actions.readAloudText = () => { speechCalls++; return never.promise; };
  const conversation = h.view.tutorState.conversation;
  Object.assign(conversation, { status: 'active', speakerOn: false, situationPicture: 'none',
    from: 'speakAndRephrase', currentQuestion: 'Say anything.' });
  if (command === 'stopTutorConversation') Object.assign(conversation, { from: 'anything', replies: 'liveGemini', coaching: 'afterwards' });
  if (command === 'updateTutorConversationFrom') conversation.status = 'stopped';
  if (command === 'previewTutorGeminiVoiceLive') h.settings.tutorReadAloudProvider = 'edgeOnline' as never;
  if (command === 'findTutorTargets') assert.ok(findTutorTargets('past tense').length > 0);
  if (command === 'retryTutorTurnCheck' || command === 'stopTutorConversation') {
    conversation.transcript = [{ question: 'Say anything.', learnerAnswer: 'I go yesterday.', correction: '', explanation: '',
      reply: 'Try the past tense.', move: 'reaction', coachingFailed: command === 'retryTutorTurnCheck' ? true : undefined,
      coachingPending: command === 'stopTutorConversation' ? true : undefined }];
  }
  h.receive({ command: command === 'previewTutorGeminiVoiceLive' ? 'previewTutorGeminiVoice' : command,
    ...(command === 'retryTutorTurnCheck' ? { input: '0' } : command === 'updateTutorConversationFrom'
      ? { input: 'lesson' } : command === 'findTutorTargets' ? { search: 'past tense' } : {}) });
  await flushV265();
  if (command === 'previewTutorEdgeVoice' || command === 'previewTutorGeminiVoice') assert.equal(speechCalls, 1);
  else if (command === 'updateTutorConversationFrom' || command === 'findTutorTargets') {
    // Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
    assert.equal(questionV267(h).options.modal, true);
  } else assert.equal(h.requests.length, 1, 'The unresolved provider request must actually have started');
  h.receive({ command: 'copy' }); await flushV265();
  if (command === 'findTutorTargets') {
    // Changed 2026-10-18: V266, owner item I49, Find now retires its card and stale choices, so it releases the queue.
    assert.equal(h.copyCalls(), 1, 'A pending Find must leave the settings queue available');
    h.receive({ command: 'resetTutorSession' });
    assert.equal(questionV267(h).message,
      'Reset the AI English Tutor to its defaults?');
  } else assert.equal(h.copyCalls(), 1, `${command} must not hold the queue while speech, a provider, or a notice waits`);
  for (const dialog of h.dialogs) dialog.answer();
  await flushV265();
  never.resolve(); await flushV265(); h.view.dispose();
}

// Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
export async function checkV265RepeatedReset() {
  const h = queueHostV265(); await flushV265();
  const cleanup = deferredV265();
  h.view.geminiRecording = { cancel: () => cleanup.promise } as never;
  h.view.geminiRecordingTarget = { conversation: true };
  h.receive({ command: 'resetTutorSession' });
  h.receive({ command: 'resetTutorSession' });
  const notices = h.messages.filter(message => message.command === 'panelNotice');
  assert.equal(h.dialogs.length, 1);
  assert.match(notices[0].notice.message, /reset.*already.*finish/iu);
  assert.equal(h.dialogs[0]!.message, 'Reset the AI English Tutor to its defaults?');
  assert.deepEqual(h.dialogs[0]!.choices, ['Reset panel', 'Reset everything']);
  h.dialogs[0]!.answer('Reset panel');
  await flushV265();
  assert.equal(h.writes(), 0, 'The first reset must still be finishing its capture cleanup');
  h.receive({ command: 'resetTutorSession' });
  const finishing = h.messages.filter(message => message.command === 'panelNotice');
  assert.equal(h.dialogs.length, 1);
  assert.ok(finishing.every(message => !message.notice.modal && message.notice.choices.length === 0));
  assert.match(finishing.at(-1).notice.message, /reset.*already.*finish/iu);
  cleanup.resolve(); await flushV265();
  assert.equal(h.writes(), 1, 'Only one reset may clear and store the session');
  for (const message of finishing) h.receive({ command: 'panelNoticeResponse', id: message.notice.id });
  h.view.dispose();
}

export async function checkV265HandyStopOrdering() {
  const h = queueHostV265(); await flushV265();
  const microphoneStop = deferredV265();
  let toggles = 0;
  h.view.handy.toggle = () => { toggles++; return microphoneStop.promise; };
  h.view.handyExecutable = 'handy-test-helper';
  Object.assign(h.view.tutorState.conversation, { status: 'active', replies: 'standard', busy: false, speakerOn: false });
  Object.assign(h.view.tutorState.speech, { handyStatus: 'available', dictationProvider: 'handy', dictatingConversation: true });
  h.receive({ command: 'dictateTutorConversation' }); await flushV265();
  assert.equal(toggles, 1);
  h.receive({ command: 'stopTutorConversation' }); await flushV265();
  assert.equal(toggles, 1, 'Stop must wait for the microphone toggle to retire Handy ownership');
  assert.equal(h.view.tutorState.conversation.status, 'active');
  // Changed 2026-10-18: V267, owner item I50, choice questions use VS Code's dialog.
  h.receive({ command: 'resetTutorSession' });
  const dialog = questionV267(h);
  assert.equal(dialog.message, 'Reset the AI English Tutor to its defaults?');
  dialog.answer();
  microphoneStop.resolve(); await flushV265();
  assert.equal(h.view.tutorState.conversation.status, 'stopped');
  assert.equal(toggles, 1, 'The two presses must send exactly one Handy stop');
  h.view.dispose();
}

export async function checkV265QueueGuard(advance: (milliseconds: number) => Promise<void>) {
  const h = queueHostV265(); await flushV265();
  const held = deferredV265();
  h.actions.copy = () => held.promise;
  h.receive({ command: 'copy', text: 'private learner words' }); await flushV265();
  h.receive({ command: 'updateTutorSearch', search: 'private provider words' });
  await advance(5_000);
  assert.deepEqual(h.logs.filter(line => line.startsWith('[panel queue]')), []);
  await advance(1);
  assert.ok(h.logs.includes('[panel queue] updateTutorSearch waited 5 s behind copy'));
  await advance(24_999);
  assert.deepEqual(h.logs.filter(line => line.includes(' ran ')), []);
  await advance(1);
  assert.ok(h.logs.includes('[panel queue] copy ran 30 s'));
  await advance(120_000);
  const lines = h.logs.filter(line => line.startsWith('[panel queue]'));
  assert.equal(lines.length, 2);
  assert.doesNotMatch(lines.join('\n'), /private|learner|provider|words/u);
  held.resolve(); await flushV265(); h.view.dispose();
}

export async function checkV265LateQueueGuard(jump: (milliseconds: number) => void) {
  const h = queueHostV265(); await flushV265();
  const held = deferredV265();
  h.actions.copy = () => held.promise;
  h.receive({ command: 'copy' }); await flushV265();
  h.receive({ command: 'updateTutorSearch', search: 'private words' });
  // Simulate an extension host whose event loop did not get to run its timers.
  jump(31_001);
  held.resolve(); await flushV265();
  assert.deepEqual(h.logs.filter(line => line.startsWith('[panel queue]')), [
    '[panel queue] copy ran 31 s', '[panel queue] updateTutorSearch waited 31 s'
  ]);
  h.view.dispose();
}
