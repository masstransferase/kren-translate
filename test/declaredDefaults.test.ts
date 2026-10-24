import { assertDeclaredDefaultFallbacks } from './support/declaredDefaultFallbacks.js';
import { TUTOR_DEFAULTS } from '../src/tutor/defaults.js';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { krenConfigurationKeys, krenResetPlan } from '../src/resetKren.js';

/*
 * KREN's declared defaults, pinned as one set.
 *
 * The owner asked on 2026-08-28 for the settings they were running to become the defaults,
 * so that Default Setting returns KREN to the state they actually work in rather than to
 * the state it happened to ship with. That makes the default set a decision, and a decision
 * with no record drifts: every earlier default here was chosen at some point and none of
 * them said so.
 *
 * This is a checkpoint, not a rule. A default may move whenever there is a reason to move
 * it; what it may not do is move unnoticed. Update the table in the same commit that moves
 * the default, and say in the commit message why.
 *
 * A new setting fails this test until it is listed, which is the point: a default nobody
 * chose is how the Model list came to be filtered to Pro models and how Translation came to
 * send `auto` whatever the reader picked.
 */
const DECLARED_DEFAULTS: Record<string, unknown> = {
    // Changed 2026-10-22 (V299, owner I69): saved global choices start with Translation's defaults.
    "kren.global.provider": "gemini",
    "kren.global.geminiProfile": "standard",
    "kren.global.model": "gemini-3.6-flash",
    "kren.global.alternateModel": "gemini-3.1-pro-preview",
    "kren.global.thinkingOrEffort": "auto",
    "kren.global.fallbackEnabled": false,
    "kren.global.fallbackModel": "gemini-3.6-flash",
    "kren.global.fallbackThinkingOrEffort": "low",
    // Changed 2026-10-16: V249, F12a, record the default for the opt-out daily check.
    "kren.updates.dailyCheck": true,
    "kren.anthropic.customModels": "[]",
    "kren.anthropic.effort": "low",
    "kren.anthropic.model": "claude-sonnet-4-6",
    // 2026-10-11: V219 adds provider model lists without moving existing defaults.
    "kren.groq.customModels": "[]",
    // 2026-10-11: V221 adds opt-out provider switching and its order.
    "kren.llm.providerSwitch": true,
    "kren.llm.providerOrder": ["gemini", "groq", "cloudflare"],
    "kren.cloudflare.customModels": "[]",
    "kren.dictionary.multiWordTranslationFallback": true,
    "kren.display.mode": "hover",
    // 2026-10-04: V201 adds the remembered panel theme, following VS Code initially.
    "kren.display.panelTheme": "followVSCode",
    "kren.explanation.alternateModel": "gemini-3.1-pro-preview",
    "kren.explanation.domain": "general",
    "kren.explanation.fallbackEnabled": true,
    "kren.explanation.fallbackModel": "gemini-3.6-flash",
    "kren.explanation.fallbackThinkingOrEffort": "low",
    "kren.explanation.geminiProfile": "standard",
    "kren.explanation.model": "gemini-3.6-flash",
    "kren.explanation.outputLanguage": "sameAsSource",
    "kren.explanation.provider": "gemini",
    "kren.explanation.thinkingOrEffort": "auto",
    "kren.gemini.alternateFallbackEnabled": true,
    "kren.gemini.alternateFallbackModel": "gemini-3.6-flash",
    "kren.gemini.alternateFallbackThinkingLevel": "medium",
    "kren.gemini.alternateModel": "gemini-3.1-pro-preview",
    "kren.gemini.alternateThinkingLevel": "low",
    "kren.gemini.customModels": "[]",
    "kren.gemini.model": "gemini-3.6-flash",
    "kren.gemini.retry.enabled": false,
    "kren.gemini.retry.maxAttempts": 4,
    "kren.gemini.thinkingLevel": "auto",
    "kren.grammar.autoCheck": false,
    "kren.grammar.autoCheckDelayMs": 900,
    "kren.grammar.dialect": "auto",
    "kren.grammar.smart": true,
    "kren.languageModel.retry.enabled": true,
    "kren.languageModel.retry.maxAttempts": 3,
    "kren.openai.customModels": "[]",
    "kren.openai.model": "gpt-5.4",
    "kren.openai.reasoningEffort": "low",
    "kren.pronunciation.windowsNativePlayback": true,
    // 2026-10-13: V231 defaults the separate Read Aloud Chirp voice to Callirrhoe.
    "kren.readAloud.chirpVoice": "Callirrhoe",
    "kren.readAloud.edgeLocale": "auto",
    "kren.readAloud.edgePythonCommand": "python",
    "kren.readAloud.edgeRatePercent": 0,
    // Changed 2026-10-16: V254, owner item I36, de-DE-AmalaNeural to en-US-ChristopherNeural default.
    "kren.readAloud.edgeVoice": "en-US-ChristopherNeural",
    "kren.readAloud.provider": "edgeOnline",
    "kren.readAloud.rate": 0,
    "kren.readAloud.voice": "Microsoft David Desktop",
    "kren.readAloud.volume": 100,
    "kren.request.timeoutMs": 30000,
    "kren.results.openAtStartup": true,
    "kren.rewrite.alternateModel": "gemini-3.1-pro-preview",
    "kren.rewrite.copyToClipboard": true,
    "kren.rewrite.domain": "general",
    "kren.rewrite.englishVariety": "sameAsSource",
    "kren.rewrite.fallbackEnabled": true,
    "kren.rewrite.fallbackModel": "gemini-3.6-flash",
    "kren.rewrite.fallbackThinkingOrEffort": "low",
    "kren.rewrite.formality": "neutral",
    "kren.rewrite.function": "general",
    "kren.rewrite.geminiProfile": "standard",
    "kren.rewrite.includeChangeNotes": false,
    "kren.rewrite.length": "preserve",
    "kren.rewrite.modality": "written",
    "kren.rewrite.model": "gemini-3.6-flash",
    "kren.rewrite.otherOutputLanguage": "de",
    "kren.rewrite.perspective": "preserve",
    "kren.rewrite.preserveFormatting": false,
    "kren.rewrite.provider": "gemini",
    "kren.rewrite.quickMenuVariant": "all",
    "kren.rewrite.rhetoricalMode": "preserve",
    "kren.rewrite.sourceLanguage": "auto",
    "kren.rewrite.stance": "direct",
    "kren.rewrite.thinkingOrEffort": "auto",
    "kren.rewrite.tts.enabled": true,
    "kren.rewrite.voice": "preserve",
    "kren.translation.alternateModel": "gemini-3.1-pro-preview",
    "kren.translation.domain": "general",
    "kren.translation.fallbackEnabled": false,
    "kren.translation.fallbackModel": "gemini-3.6-flash",
    "kren.translation.fallbackThinkingOrEffort": "low",
    "kren.translation.geminiProfile": "standard",
    "kren.translation.maxCharacters": 5000,
    "kren.translation.model": "gemini-3.6-flash",
    "kren.translation.provider": "gemini",
    "kren.translation.sourceLanguage": "auto",
    "kren.translation.targetLanguage": "ko-KR",
    "kren.translation.thinkingOrEffort": "auto",
    "kren.translationProvider": "googleCloudTranslation",
    // Changed 2026-10-03: changed tutor defaults derive from the shared owner choices.
    "kren.tutor.alternateModel": TUTOR_DEFAULTS.configuration['tutor.alternateModel'],
    // Added 2026-09-24: V146 gives a slow Windows audio driver the owner's chosen maximum.
    "kren.tutor.conversation.microphoneCloseWait": TUTOR_DEFAULTS.configuration['tutor.conversation.microphoneCloseWait'],
    // Added 2026-09-24: V148 defaults Live recognition to the language being practised.
    "kren.tutor.conversation.liveTranscriptionLanguage": "english",
    // Added 2026-09-22: V136 preserves the earlier waits unless the reader moves this dial.
    "kren.tutor.conversation.microphoneSensitivity": "balanced",
    // Added 2026-10-02: V186 gives hands-free Live a separate pause in seconds.
    "kren.tutor.conversation.pauseBeforeReply": 2,
    "kren.tutor.conversation.speechDetection": TUTOR_DEFAULTS.configuration['tutor.conversation.speechDetection'],
    // Added 2026-09-20: V126 is opt-in so ordinary Live conversations stay continuous.
    "kren.tutor.conversation.pressToTalk": false,
    "kren.tutor.conversation.pictureStyle": "realistic",
    "kren.tutor.conversation.takeHome": true,
    // 2026-10-11: V220 chooses on-demand hints as the shipped default.
    "kren.tutor.conversation.hintPrefetch": false,
    "kren.tutor.fallbackEnabled": TUTOR_DEFAULTS.configuration['tutor.fallbackEnabled'],
    // Changed 2026-10-22 (V298, owner I70/D33 B): Fast covers fallback.
    "kren.tutor.hintThinkingOrEffort": TUTOR_DEFAULTS.configuration['tutor.hintThinkingOrEffort'],
    "kren.tutor.geminiProfile": TUTOR_DEFAULTS.configuration['tutor.geminiProfile'],
    // Added 2026-09-24: V149 gives only conversation Hint the lower-latency Flash route.
    "kren.tutor.hintModel": TUTOR_DEFAULTS.configuration['tutor.hintModel'],
    "kren.tutor.liveFemaleVoice": TUTOR_DEFAULTS.configuration['tutor.liveFemaleVoice'],
    // Changed 2026-10-10: V212 selects Enceladus as the male Gemini default.
    "kren.tutor.liveMaleVoice": "Enceladus",
    // Added 2026-09-21: ordinary and Live custom Gemini identifiers are stored separately.
    "kren.tutor.liveCustomModels": "[]",
    // Changed 2026-10-03: Image Model and its custom identifiers are declared tutor settings.
    // 2026-10-10: Gemini remains the default after adding the Cloudflare picture route.
    "kren.tutor.pictureProvider": "gemini",
    "kren.tutor.imageModel": "gemini-3.1-flash-lite-image",
    // 2026-10-10: the Cloudflare picture model is a separate choice so the Gemini one survives a switch.
    // Changed 2026-10-22 (V294, owner I60/I64): preserve explicit schnell and default to klein.
    "kren.tutor.cloudflareImageModel": "@cf/black-forest-labs/flux-2-klein-4b",
    "kren.tutor.imageCustomModels": "[]",
    "kren.tutor.liveModel": "gemini-3.8-live",
    // Changed 2026-10-23 (V306, verification R30): record V304's separate Live profile default.
    "kren.tutor.liveGeminiProfile": TUTOR_DEFAULTS.configuration['tutor.liveGeminiProfile'],
    "kren.tutor.model": TUTOR_DEFAULTS.configuration['tutor.model'],
    "kren.tutor.provider": "gemini",
    "kren.tutor.readAloud.edgeLocale": "en-US",
    "kren.tutor.readAloud.edgeFemaleVoice": "en-US-AvaNeural",
    "kren.tutor.readAloud.edgeMaleVoice": "en-US-ChristopherNeural",
    "kren.tutor.readAloud.edgeRatePercent": 0,
    "kren.tutor.readAloud.edgeVoice": "en-US-ChristopherNeural",
    // Changed 2026-10-16: V254, owner item I36, edgeOnline to googleChirp default.
    "kren.tutor.readAloud.provider": "googleChirp",
    "kren.tutor.readAloud.rate": 0,
    "kren.tutor.readAloud.voice": "Microsoft David Desktop",
    "kren.tutor.readAloud.volume": 100,
    // 2026-10-21: V286 records the declared engine-default sentence pause.
    "kren.tutor.readAloud.sentencePauseMilliseconds": 0,
    "kren.tutor.speechProvider": "auto",
    "kren.tutor.thinkingOrEffort": TUTOR_DEFAULTS.configuration['tutor.thinkingOrEffort'],
    "kren.userDictionary.alternateModel": "gemini-3.1-pro-preview",
    "kren.userDictionary.defaultCaptureMode": "llmOnly",
    "kren.userDictionary.enabled": true,
    "kren.userDictionary.entryLanguage": "auto",
    "kren.userDictionary.fallbackEnabled": false,
    "kren.userDictionary.fallbackModel": "gemini-3.6-flash",
    "kren.userDictionary.fallbackOnMerriamWebsterNoMatch": false,
    "kren.userDictionary.fallbackThinkingOrEffort": "low",
    "kren.userDictionary.geminiProfile": "standard",
    "kren.userDictionary.includePronunciation": true,
    "kren.userDictionary.includeSynonyms": true,
    "kren.userDictionary.includeTechnicalMeanings": true,
    "kren.userDictionary.includeUsageNotes": true,
    "kren.userDictionary.maxImportEntries": 5000,
    "kren.userDictionary.model": "gemini-3.6-flash",
    "kren.userDictionary.numberOfExamples": 2,
    "kren.userDictionary.provider": "gemini",
    "kren.userDictionary.smartWordCapture": true,
    "kren.userDictionary.thinkingOrEffort": "low"
};

describe('the declared default of every KREN setting', () => {
  it('keeps every runtime fallback aligned with the declared owner defaults', () => {
    assertDeclaredDefaultFallbacks();
  });

  const properties = (JSON.parse(readFileSync('package.json', 'utf8')) as {
    contributes: { configuration: { properties: Record<string, { default?: unknown }> } };
  }).contributes.configuration.properties;

  it('matches the recorded set, with nothing added and nothing removed', () => {
    const declared = Object.keys(properties).filter((name) => name.startsWith('kren.')).sort();
    expect(declared, 'a setting was added or removed without recording its default')
      .toEqual(Object.keys(DECLARED_DEFAULTS).sort());
  });

  it('holds the recorded value for every setting', () => {
    for (const [key, expected] of Object.entries(DECLARED_DEFAULTS)) {
      expect(properties[key]?.default, `${key} default moved`).toEqual(expected);
    }
  });

  it('Reset KREN restores the owner voice and startup defaults at every configuration scope', async () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
    const overrides = [1, 2, 3].map(() => new Map<string, unknown>([
      ['readAloud.edgeVoice', 'de-DE-AmalaNeural'], ['results.openAtStartup', false]
    ]));
    const config = {
      inspect: (key: string) => ({ globalValue: overrides[0]!.get(key),
        workspaceValue: overrides[1]!.get(key), workspaceFolderValue: overrides[2]!.get(key) }),
      update: async (key: string, value: unknown, scope: number) => {
        expect(value).toBeUndefined();
        overrides[scope - 1]!.delete(key);
      },
      get: (key: string) => overrides[2]!.get(key) ?? overrides[1]!.get(key) ?? overrides[0]!.get(key)
        ?? properties[`kren.${key}`]?.default
    };
    const source = ts.createSourceFile('extension.ts', readFileSync('src/extension.ts', 'utf8'), ts.ScriptTarget.Latest, true);
    const functions = ['restoreDefaultConfiguration', 'resetKren'].map(name => {
      const node = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
      expect(node, name).toBeDefined();
      return node!.getText(source);
    }).join('\n');
    const noop = () => undefined;
    const context = { extension: { packageJSON: manifest }, secrets: { get: noop, delete: noop }, globalState: { update: noop } };
    const reset = runInNewContext(ts.transpile(functions + '\nresetKren;', { target: ts.ScriptTarget.ES2022 }), {
      vscode: { workspace: { getConfiguration: () => config }, ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 } },
      krenConfigurationKeys, krenResetPlan, KREN_SECRET_KEYS: {},
      showKrenWarningMessage: async (_message: string, _options: unknown, action: string) => action,
      storedSecretKeys: new Set(), resetProviderExhaustion: noop,
      cloudTranslationUsage: { reset: noop }, configureHarperGrammar: noop,
      resultsView: { refresh: noop }, notify: noop
    }) as (context: unknown) => Promise<void>;
    await reset(context);
    for (const scope of overrides) expect(scope.size).toBe(0);
    expect(config.get('readAloud.edgeVoice')).toBe('en-US-ChristopherNeural');
    expect(config.get('results.openAtStartup')).toBe(true);
  });

  /*
   * The three the owner should be able to find again. Each is theirs rather than a neutral
   * shipping choice, and each would be wrong on a different machine or in the public tree.
   */
  it('records the defaults that belong to this machine rather than to KREN', () => {
    expect(properties['kren.readAloud.voice']?.default).toBe('Microsoft David Desktop');
    // Changed 2026-10-16: V254, owner item I36, de-DE-AmalaNeural to en-US-ChristopherNeural default.
    expect(properties['kren.readAloud.edgeVoice']?.default).toBe('en-US-ChristopherNeural');
    expect(properties['kren.results.openAtStartup']?.default).toBe(true);
  });
});
