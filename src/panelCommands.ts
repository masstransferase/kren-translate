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
  'kren.addToUserDictionary',
  'kren.openUserDictionary',
  'kren.setGeminiApiKey',
  'kren.deleteGeminiApiKey',
  'kren.setGeminiProApiKey',
  'kren.deleteGeminiProApiKey',
  'kren.setOpenAIApiKey',
  'kren.deleteOpenAIApiKey',
  'kren.setAnthropicApiKey',
  'kren.deleteAnthropicApiKey',
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
  'kren.testOpenAIConnection',
  'kren.testAnthropicConnection',
  'kren.showGoogleCloudTranslationUsage',
  'kren.previewReadAloud',
  'kren.stopReadAloud',
  'kren.clearGrammarFindings',
  'kren.clearGrammarCustomDictionary',
  'kren.clearIgnoredGrammarFindings',
  'workbench.action.openSettings'
] as const;

export type KrenPanelCommand = typeof PANEL_COMMAND_LIST[number];

export const PANEL_COMMANDS: ReadonlySet<KrenPanelCommand> = new Set(PANEL_COMMAND_LIST);
