// Changed 2026-10-22 (V293, owner I61/D22 A): one missing-key message with Open Credentials.
import { missingCredentialError, missingCredentialsOf, showMissingCredentialNotice } from '../../src/requestCenter.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ProviderError } from '../../src/errors.js';
import { confirmTutorReset, confirmTutorLessonReset, showTutorLessonUnavailable } from '../../src/resultsViewSettings.js';
import { findTutorTargets, confirmTutorDiagnosticReportDeletion, diagnoseSelectedEditorPassage, diagnoseTutorConversation } from '../../src/resultsViewLesson.js';
import { queueHostV265, flushV265 } from './v265QueueChecks.js';
import { questionV267 } from './v267NativeDialogs.js';

/** Execute private extension handlers, as the existing Reset KREN test does, without activation. */
function extensionHandlers(scope: Record<string, unknown>) {
  const source = ts.createSourceFile('extension.ts', readFileSync('src/extension.ts', 'utf8'), ts.ScriptTarget.ES2022, true);
  const names = ['restoreDefaultSettings', 'resetKren', 'deleteAllApiKeys', 'testKoreanDictionary',
    'ensureEdgeTtsConsent', 'ensureLanguageModelConsent', 'ensureGeminiConsent', 'regenerateUserDictionaryDraft',
    'deleteUserDictionaryEntry', 'deleteUserDictionaryEntries', 'confirmUserDictionaryPurge', 'showLookupError'];
  const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ''));
  let update = '';
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'confirm' && ts.isArrowFunction(node.initializer)) {
      update = node.initializer.getText(source);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const code = functions.map(node => node.getText(source)).join('\n') +
    `\nconst update = ${update}; ({ ${names.join(', ')}, update });`;
  return runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, scope);
}

/** Each row of I49 is reached through its handler and the real provider's native boundary. */
export async function checkV267Questions() {
  const h = queueHostV265();
  const calls: Array<{ kind: string; message: string; options: Record<string, unknown>; choices: string[] }> = [];
  for (const [method, kind] of [['showWarningMessage', 'warning'], ['showErrorMessage', 'error']] as const) {
    const original = h.view[method].bind(h.view);
    h.view[method] = (message: string, optionsOrChoice?: any, ...items: string[]) => {
      const { signal: _signal, ...options } = typeof optionsOrChoice === 'object' ? optionsOrChoice : {};
      const choices = typeof optionsOrChoice === 'string' ? [optionsOrChoice, ...items] : items;
      calls.push({ kind, message, options, choices });
      return original(message, optionsOrChoice, ...items);
    };
  }
  let verified = 0;
  const verify = (opening: RegExp, choices: string[]) => {
    const dialog = questionV267(h);
    const call = calls.at(-1)!;
    assert.match(dialog.message, opening);
    assert.deepEqual(dialog.choices, choices);
    // Compare the executed caller's complete arguments, including optional detail and modal.
    // Changed 2026-10-22 (V292, owner I59/D20 A): popup instead of notification.
    assert.deepEqual(JSON.parse(JSON.stringify(dialog)), JSON.parse(JSON.stringify({ kind: call.kind, message: call.message, options: { ...call.options, modal: true }, choices: call.choices })));
    assert.equal(h.dialogs.length, calls.length, 'Exactly one native dialog per question');
    assert.equal(h.panel().query('[data-kren-notice]'), null);
    verified++;
    return dialog;
  };
  const ask = async (run: () => Promise<unknown>, opening: RegExp, choices: string[]) => {
    const pending = run(); await flushV265();
    verify(opening, choices).answer(); await pending;
  };
  try {
    await ask(() => confirmTutorReset(h.view), /^Reset the AI English Tutor/u, ['Reset panel', 'Reset everything']);
    h.view.tutorState.lesson = {} as never;
    await ask(() => confirmTutorLessonReset(h.view), /^Reset the lesson/u, ['Reset']);
    h.view.tutorState.lesson = undefined;
    const find = findTutorTargets(h.view, 'past tense'); await flushV265();
    const found = verify(/^Search found/u, ['Set as primary', 'Add as support']);
    h.view.cancelTutorFind(); found.answer(); await find;
    Object.assign(h.view.tutorState.conversation, { status: 'active', speakerOn: false,
      transcript: Array.from({ length: 5 }, () => ({ question: 'Tell me more.', learnerAnswer: 'I arrived.', correction: '', explanation: '', reply: 'Good.' })) });
    await ask(() => diagnoseTutorConversation(h.view), /^To diagnose now/u, ['Proceed']);
    h.view.tutorState.conversation.status = 'idle';
    Object.assign(h.view.tutorState, { diagnosticReportDrawerOpen: true, diagnosticReport: { summary: 'A report', findings: [], targets: [], focus: 'Past tense' } });
    await ask(() => confirmTutorDiagnosticReportDeletion(h.view), /^Delete this diagnostic report/u, ['Delete & Reset', 'Delete prompts']);
    await ask(() => showTutorLessonUnavailable(h.view), /^Finish the lesson/u, ['OK']);
    (h.actions as any).readSelectedEditorPassage = () => 'An explicitly selected passage.';
    await ask(() => diagnoseSelectedEditorPassage(h.view), /^KREN will send this selected editor passage/u, ['Weakness analysis', 'Text analysis']);
    let mutations = 0;
    const context = { secrets: { get: async () => undefined, delete: async () => { mutations++; } },
      globalState: { get: () => false, update: async () => { mutations++; } } };
    const scope = {
      missingCredentialError, missingCredentialsOf, showMissingCredentialNotice,
      showKrenWarningMessage: h.view.showWarningMessage.bind(h.view), showKrenErrorMessage: h.view.showErrorMessage.bind(h.view),
      resultsView: h.view, ProviderError, errorMessage: (error: Error) => error.message,
      recordedRequestOutcome: () => undefined, handleLookupErrorSelection: async () => {}, actionLabel: () => 'Set key',
      isCredentialSetupAction: () => true,
      userDictionaryService: { list: () => [] }, requiresRemoveAllConfirmation: () => false,
      krenResetPlan: () => ({ configuration: true }), changedSettingCount: async () => 2,
      restoreDefaultConfiguration: async () => { mutations++; }, KREN_SECRET_KEYS: {},
      EDGE_TTS_CONSENT: 'edge', OPENAI_CONSENT: 'openai', ANTHROPIC_CONSENT: 'anthropic', GEMINI_CONSENT: 'gemini', DICTIONARY_KEY: 'dictionary'
    };
    const ext = extensionHandlers(scope);
    for (const [name, first, second, choices] of [
      ['restoreDefaultSettings', /^Return every KREN setting/u, /^Last check.*2 settings/u, ['Restore Defaults']],
      ['resetKren', /^Reset KREN/u, /^Last check.*0 stored API keys/u, ['Reset KREN']]
    ] as const) {
      const pending = ext[name](context); await flushV265();
      verify(first, ['Continue']).answer('Continue'); await flushV265();
      verify(second, [...choices]).answer(); await pending;
    }
    await ask(() => ext.deleteAllApiKeys(context), /^Delete every API key/u, ['Delete All API Keys']);
    await ask(() => ext.testKoreanDictionary(context), /Korean Basic Dictionary.*Credentials/u, ['Open Credentials']);
    await ask(() => ext.update('python -m pip install -U edge-tts'), /^Run python/u, ['Update']);
    await ask(() => ext.ensureEdgeTtsConsent(context), /^KREN Edge Online speech/u, ['Continue']);
    for (const [provider, opening] of [['groq', /^Groq receives/u], ['openai', /^OpenAI API use/u]] as const) {
      await ask(() => ext.ensureLanguageModelConsent(context, provider).catch(() => undefined), opening, ['I Understand']);
    }
    await ask(() => ext.ensureGeminiConsent(context).catch(() => undefined), /^Google's current Gemini API Terms/u, ['I Am 18+ and Confirm', 'Open Gemini API Terms']);
    await ask(() => ext.regenerateUserDictionaryDraft(context, 'arrive', 'llm'), /^Regenerate this User Dictionary/u, ['Regenerate']);
    await ask(() => ext.deleteUserDictionaryEntry('entry'), /^Delete this User Dictionary/u, ['Delete']);
    await ask(() => ext.deleteUserDictionaryEntries(['a', 'b']), /^Delete the 2 selected/u, ['Delete selected entries']);
    await ask(() => ext.confirmUserDictionaryPurge({ count: 2, selection: {} }), /^Delete exactly the 2 entries/u, ['Delete previewed entries']);
    await ask(() => ext.showLookupError(new ProviderError('Lookup failed.', 'setGeminiKey', true), async () => {}), /^KREN: Lookup failed/u, ['Retry Now', 'Set key']);
    assert.equal(mutations, 0, 'Cancel must not alter settings, credentials, or consent');
    assert.equal(verified, 23, 'Every I49 question must be exercised');
    return verified;
  } finally { h.view.dispose(); }
}
