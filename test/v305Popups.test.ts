import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
import { TUTOR_MAP, type TutorLesson } from '@kren/core/tutor';
import { GoogleChirpSpeech, SpeechCenter } from '../src/speech/speechCenter.js';
import { EdgeOnlineSpeechAdapter, LocalWindowsSpeechAdapter } from '../src/speech/windowsSpeechAdapters.js';
import { TUTOR_DEFAULTS } from '../src/tutor/defaults.js';
import * as tutorState from '../src/tutor/state.js';
import { startTutorLessonGeneration } from '../src/resultsViewLesson.js';
import { speakTutorConversationSequence } from '../src/resultsViewReplay.js';
import { missingCredentialError, missingCredentialMessage, showMissingCredentialNotice } from '../src/requestCenter.js';
import { queueHostV265, flushV265, deferredV265 } from './support/v265QueueChecks.js';

vi.mock('vscode', async () => {
  const { nativeDialogV267, nativeErrorDialogV267 } = await import('./support/v267NativeDialogs.js');
  return {
  window: { showInformationMessage: async () => undefined,
    showWarningMessage: nativeDialogV267, showErrorMessage: nativeErrorDialogV267 },
  commands: { executeCommand: async () => {} }, Uri: { joinPath: (...parts: unknown[]) => parts },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback,
    update: async () => {} }) }, ConfigurationTarget: { Global: 1 }
  };
});

afterEach(() => vi.restoreAllMocks());

function host() {
  const h = queueHostV265();
  const notify = vi.fn((kind: 'information' | 'warning' | 'error', message: string) => {
    void (kind === 'error' ? h.view.showErrorMessage(message) : kind === 'warning'
      ? h.view.showWarningMessage(message) : h.view.showInformationMessage(message));
  });
  h.actions.notify = notify;
  return { ...h, notify };
}

const target = TUTOR_MAP.find(node => !TUTOR_MAP.some(child => child.parentId === node.id))!;
function drafted(h: ReturnType<typeof host>) {
  const state = h.view.tutorState;
  state.selection = [{ nodeId: target.id, role: 'primary' }];
  const recipe = tutorState.tutorRecipeFromState(state);
  const lesson = { schemaVersion: 1, mapVersion: recipe.mapVersion, lessonTitle: 'Kept lesson',
    level: 'B2', primaryTarget: { ...target, nodeId: target.id, role: 'primary' }, supportingTargets: [],
    conceptExplanation: 'Use this pattern.', interactionExplanation: 'Keep the meaning.',
    rules: [], commonErrors: [], generationNotes: [], examples: [{ id: 'example-1',
      sentence: 'Could you help me with this report?', targetIds: [target.id], annotations: [] }]
  } as TutorLesson;
  state.lesson = { recipe, lesson, findings: [] };
  return state.lesson;
}

// Execute the shipped construction and both forwarding paths, including its status callback.
function speech(h: ReturnType<typeof host>, provider: 'edgeOnline' | 'windowsLocal') {
  const source = readFileSync('src/extension.ts', 'utf8');
  const tree = ts.createSourceFile('extension.ts', source, ts.ScriptTarget.ES2022, true);
  const functions = ['krenSpeechProgress', 'readAloudText'].map(name => {
    const node = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    if (!node) throw new Error(`Missing ${name}`);
    return node.getText(tree);
  }).join('\n');
  const construction = source.slice(source.indexOf('  chirpSpeech = new GoogleChirpSpeech'), source.indexOf('\n  grammarCodeActions ='));
  const forwarding = source.slice(source.indexOf('  const panelReadAloudText ='), source.indexOf('\n  resultsView = new KrenResultsViewProvider'));
  const held = deferredV265();
  const edge = { speak: vi.fn(async () => { await held.promise; return 'completed' as const; }), stop: () => false };
  const windows = { speak: vi.fn(async () => { await held.promise; return true; }), stop: () => false };
  const disposeStatus = vi.fn(), setStatusBarMessage = vi.fn(() => ({ dispose: disposeStatus }));
  const config = { get: (key: string, fallback: unknown) => key.endsWith('.provider') ? provider : fallback };
  const scope = { resultsView: h.view, GoogleChirpSpeech, SpeechCenter, EdgeOnlineSpeechAdapter,
    LocalWindowsSpeechAdapter, TUTOR_DEFAULTS, missingCredentialMessage, showMissingCredentialNotice,
    context: { secrets: { get: async () => undefined } },
    nativeAudioPlayer: { stop: () => false }, readAloudPlayer: windows, edgeReadAloudPlayer: edge,
    outputChannel: { appendLine: () => {} }, notify: h.notify, fetch,
    ensureEdgeTtsConsent: async () => true, showKrenErrorMessage: vi.fn(),
    READ_ALOUD_PROVIDER_DEFAULT: provider, tutorSpeechPlaybackBarriers: new WeakMap(),
    vscode: { workspace: { isTrusted: true, getConfiguration: () => config },
      commands: { executeCommand: async () => {} }, window: { setStatusBarMessage } } };
  const entry = runInNewContext(ts.transpileModule(`${functions}\n${construction}\n${forwarding}
    ;({ panelReadAloudText, editor: () => readAloudText(context, 'Read this editor selection.', 'en') });`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, scope);
  h.actions.readAloudText = entry.panelReadAloudText;
  return { ...entry, held, edge, windows, setStatusBarMessage, disposeStatus };
}

const speechCases = (['edgeOnline', 'windowsLocal'] as const).flatMap(provider =>
  [true, false].flatMap(visible => ['Standard reply', 'example', 'editor'].map(path => ({ provider, visible, path }))));
it.each(speechCases)('speech never covers the panel: $provider, visible $visible, $path', async ({ provider, visible, path }) => {
    const h = host();
    const s = speech(h, provider);
    const busy = vi.spyOn(h.view, 'withPanelProgress');
    try {
      (h.view as any).view.visible = visible;
      h.settings.tutorReadAloudProvider = provider as never;
      h.view.tutorState.conversation.replies = 'standard';
      h.view.tutorState.conversation.speakerOn = true;
      let editor: Promise<void> | undefined;
      if (path === 'Standard reply') speakTutorConversationSequence(h.view, ['Here is the Standard reply.'], 'Speech failed.');
      else if (path === 'example') {
        drafted(h);
        h.receive({ command: 'playTutorExample', exampleId: 'example-1' });
      } else editor = s.editor();
      await flushV265();
      expect(s.edge.speak.mock.calls.length + s.windows.speak.mock.calls.length, path).toBe(1);
      expect(busy, path).not.toHaveBeenCalled();
      expect(h.panel().query('.busy-overlay, [role="alertdialog"]')).toBeNull();
      if (visible) expect(s.setStatusBarMessage).not.toHaveBeenCalled();
      else expect(s.setStatusBarMessage).toHaveBeenCalledWith(provider === 'edgeOnline'
        ? 'KREN: Generating and reading Edge voice...' : 'KREN: Reading aloud...');
      s.held.resolve(); await editor; await flushV265();
      expect(s.disposeStatus).toHaveBeenCalledTimes(visible ? 0 : 1);
      expect(h.notify).not.toHaveBeenCalled();
    } finally { s.held.resolve(); h.view.dispose(); }
});

it.each(['Reset panel', 'Reset everything', 'lesson Reset', 'Delete & Reset'])('%s keeps its announcement without a success popup', async choice => {
  const h = host();
  try {
    const snapshots: Array<{ announcement: string | null; live: ReturnType<ReturnType<typeof h.panel>['query']> }> = [];
    const render = h.view.render.bind(h.view);
    vi.spyOn(h.view, 'render').mockImplementation(() => {
      render();
      snapshots.push({ announcement: h.panel().document.body.getAttribute('data-tutor-announcement'),
        live: h.panel().query('[data-tutor-live]') });
    });
    drafted(h);
    h.view.tutorState.answers = { example: 'Clear this.' };
    h.view.tutorState.diagnosticReport = { findings: [], targets: [] };
    h.view.tutorState.diagnosticReportDrawerOpen = choice === 'Delete & Reset';
    h.receive({ command: choice === 'lesson Reset' ? 'resetTutorLesson'
      : choice === 'Delete & Reset' ? 'cancelTutorDiagnosticReport' : 'resetTutorSession' });
    await flushV265();
    expect(h.dialogs).toHaveLength(1);
    const dialog = h.dialogs[0]!;
    expect(dialog.options.modal).toBe(true);
    if (choice === 'Delete & Reset') {
      expect(dialog.options.detail).not.toMatch(/['"+]/u);
      expect(dialog.options.detail).toMatch(/Delete & Reset also clears.*lesson.*answers.*conversation.*question.*target.*Delete prompts removes this report and keeps everything else/su);
    }
    dialog.answer(choice === 'lesson Reset' ? 'Reset' : choice);
    await flushV265();
    expect(h.view.tutorState.lesson).toBeUndefined();
    expect(h.view.tutorState.answers).toEqual({});
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.messages.filter(message => message.command === 'panelNotice')).toEqual([]);
    expect(h.dialogs).toHaveLength(1);
    const announcement = choice === 'lesson Reset' ? 'The lesson and practice were reset.'
      : choice === 'Delete & Reset' ? 'The diagnostic report was deleted and AI English Tutor was reset.'
      : 'AI English Tutor was reset.';
    const announced = snapshots.find(snapshot => snapshot.announcement === announcement);
    expect(announced).toBeDefined();
    await vi.waitFor(() => expect(announced?.live?.textContent).toBe(announcement));
    expect(h.panel().query('[role="alertdialog"]')).toBeNull();
  } finally { h.view.dispose(); }
});

it.each(['recipe', 'Draft', 'Redraft', 'missing-key recipe', 'missing-key Draft'])('%s failure remains reachable and keeps only missing-key popups', async kind => {
  const h = host();
  try {
    const old = drafted(h);
    if (kind !== 'Redraft') h.view.tutorState.lesson = undefined;
    const missing = kind.startsWith('missing-key');
    const error = missing ? missingCredentialError('gemini') : new Error('The lesson request failed. Try again.');
    const recipe = kind.endsWith('recipe');
    if (recipe) vi.spyOn(tutorState, 'tutorRecipeFromState').mockImplementationOnce(() => { throw error; });
    else h.actions.generateTutor = vi.fn(async () => { throw error; });
    startTutorLessonGeneration(h.view);
    if (!recipe) {
      expect(h.panel().query('.busy-overlay .popup-message')?.textContent).toMatch(/drafting.*Please wait/iu);
      const cancel = h.panel().query('.busy-overlay button')!;
      expect(cancel.getAttribute('data-command')).toBe('cancelTutorLesson');
      expect(cancel.disabled).toBe(false);
    }
    await flushV265();
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.view.tutorState.lesson).toBe(kind === 'Redraft' ? old : undefined);
    const failure = h.panel().query('[data-tutor-action-status] .tutor-failure')!;
    expect(failure?.textContent.startsWith(h.view.tutorState.lessonFailure!)).toBe(true);
    expect(failure.closest('details, [hidden], .hidden')).toBeNull();
    expect(failure.closest('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
    const retry = h.panel().query('[data-command="generateTutorLesson"]')!;
    expect(retry.textContent).toBe(kind === 'Redraft' ? 'Redraft' : 'Draft');
    expect(retry.closest('details, [hidden], .hidden')).toBeNull();
    expect(retry.disabled).toBe(false);
    expect(retry.getAttribute('tabindex')).not.toBe('-1');
    retry.focus(); expect(h.panel().document.activeElement).toBe(retry);
    expect(h.panel().query('.busy-overlay, [role="alertdialog"]')).toBeNull();
    if (missing) {
      expect(h.dialogs).toHaveLength(1);
      expect(h.dialogs[0]!.message).toMatch(/Gemini.*key/iu);
      expect(h.dialogs[0]!.choices).toContain('Open Credentials');
      h.dialogs[0]!.answer();
    } else expect(h.dialogs).toEqual([]);
  } finally { h.view.dispose(); }
});

it('an unavailable Draft explains what the reader must do beside the actions', () => {
  const h = host();
  try {
    const button = h.panel().query('[data-command="generateTutorLesson"]')!;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-description')).toMatch(/learning map|target|question/iu);
    const reason = h.panel().query('#tutor-action-readiness')!;
    expect(reason.textContent).toMatch(/learning map|target|question/iu);
    expect(reason.closest('details, [hidden], .hidden')).toBeNull();
  } finally { h.view.dispose(); }
});
