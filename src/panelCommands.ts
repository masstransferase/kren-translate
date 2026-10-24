// The commands the settings webview is allowed to invoke.
//
// This used to be two lists: a KrenPanelCommand type union for compile time and a
// PANEL_COMMANDS Set for runtime. A command added to the union alone type-checked,
// rendered a normal-looking button, and then did nothing when clicked, because the
// runtime check rejected it and the caller swallowed the rejection. That shipped once:
// the Medical Dictionary Set and Remove buttons rendered correctly and were dead.
//
// One array is now the single source. The type is derived from it, so the two can no
// longer disagree, and the failure mode is a compile error rather than a silent no-op.
//
// This module deliberately imports nothing from vscode, so it can be unit tested.

export const PANEL_COMMAND_LIST = [
  // The welcome-screen capability buttons. Each runs the same command as the editor
  // context menu, so the grid cannot drift from the menu. Added 2026-08-22, when the
  // capabilities stopped being decorative labels.
  'kren.dictionarySearchSelection',
  'kren.synonymsSearchSelection',
  'kren.lookupMedicalSelection',
  'kren.koreanDictionarySearchSelection',
  'kren.translateSelection',
  'kren.explainSelection',
  'kren.grammarCheckSelection',
  'kren.rewriteEnglishSelection',
  'kren.readAloudSelection',
  'kren.addToUserDictionary',
  'kren.openUserDictionary',
  'kren.setGeminiApiKey',
  'kren.deleteGeminiApiKey',
  'kren.setGeminiProApiKey',
  'kren.deleteGeminiProApiKey',
  'kren.setGroqApiKey',
  'kren.deleteGroqApiKey',
  'kren.testGeminiConnection',
  'kren.testGeminiProConnection',
  'kren.testCloudflareConnection',
  'kren.testGoogleCloudTranslation',
  'kren.testMerriamWebsterCollegiate',
  'kren.testMerriamWebsterThesaurus',
  'kren.testMerriamWebsterMedical',
  'kren.openGeminiUsage',
  'kren.testGroqConnection',
  'kren.testGoogleCloudTextToSpeech',
  'kren.setOpenAIApiKey',
  'kren.deleteOpenAIApiKey',
  'kren.setCloudflareAccountId',
  'kren.deleteCloudflareAccountId',
  'kren.setCloudflareApiToken',
  'kren.deleteCloudflareApiToken',
  'kren.setAnthropicApiKey',
  'kren.deleteAnthropicApiKey',
  'kren.setGoogleCloudTextToSpeechApiKey',
  'kren.deleteGoogleCloudTextToSpeechApiKey',
  'kren.setGoogleCloudTranslationApiKey',
  'kren.deleteGoogleCloudTranslationApiKey',
  'kren.setMerriamWebsterCollegiateApiKey',
  'kren.deleteMerriamWebsterCollegiateApiKey',
  'kren.setMerriamWebsterMedicalApiKey',
  'kren.deleteMerriamWebsterMedicalApiKey',
  'kren.setMerriamWebsterThesaurusApiKey',
  'kren.deleteMerriamWebsterThesaurusApiKey',
  'kren.setKoreanDictionaryApiKey',
  'kren.deleteKoreanDictionaryApiKey',
  'kren.testKoreanDictionary',
  'kren.deleteAllApiKeys',
  // The two reset actions beside it. Both confirm before removing anything, and Reset KREN
  // confirms twice, because a deleted credential has to be fetched from the provider again.
  'kren.restoreDefaultSettings',
  'kren.resetKren',
  'kren.testOpenAIConnection',
  'kren.testAnthropicConnection',
  'kren.showGoogleCloudTranslationUsage',
  'kren.previewReadAloud',
  'kren.stopReadAloud',
  'kren.clearGrammarFindings',
  'kren.clearGrammarCustomDictionary',
  'kren.clearIgnoredGrammarFindings',
  // Kept in the allow list although no button renders it since 1.7.8, when the owner
  // renamed that button to Reset KREN. The Command Palette still reaches VS Code's own
  // settings screen, and removing it here would only make a future button silently dead.
  'workbench.action.openSettings'
] as const;

export type KrenPanelCommand = typeof PANEL_COMMAND_LIST[number];

/**
 * What the panel says it is waiting for while one of these commands runs.
 *
 * Only the commands that reach a provider or the local grammar worker are listed. Setting
 * a key opens an input box and stopping speech returns at once, and covering the panel for
 * either would be a freeze with nothing behind it.
 *
 * Read Aloud is deliberately absent even though it is slow. `readAloudText` awaits playback
 * to completion, so its command does not resolve until the speech ends, and an overlay over
 * that whole span would sit on top of the panel's own Stop control for the entire reading.
 * The one control the reader wants during speech is the one it would cover. Speech announces
 * itself through the status bar and through being audible, so it needs no overlay.
 */
export const PANEL_COMMAND_BUSY_NOTICES = {
  'kren.dictionarySearchSelection': 'Looking up the selected text. Please wait.',
  'kren.synonymsSearchSelection': 'Looking up synonyms for the selected text. Please wait.',
  'kren.lookupMedicalSelection': 'Looking up the selected medical term. Please wait.',
  'kren.koreanDictionarySearchSelection': 'Looking up the selected Korean text. Please wait.',
  'kren.translateSelection': 'Translating the selected text. Please wait.',
  'kren.explainSelection': 'Explaining the selected text. Please wait.',
  'kren.grammarCheckSelection': 'Checking the selected text. Please wait.',
  'kren.rewriteEnglishSelection': 'Rewriting the selected text. Please wait.',
  'kren.addToUserDictionary': 'Preparing a User Dictionary draft. Please wait.'
} as const satisfies Partial<Record<KrenPanelCommand, string>>;

export function panelCommandBusyNotice(command: KrenPanelCommand): string | undefined {
  return Object.hasOwn(PANEL_COMMAND_BUSY_NOTICES, command)
    ? PANEL_COMMAND_BUSY_NOTICES[command as keyof typeof PANEL_COMMAND_BUSY_NOTICES]
    : undefined;
}

export const PANEL_COMMANDS: ReadonlySet<KrenPanelCommand> = new Set(PANEL_COMMAND_LIST);
