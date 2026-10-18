// Changed 2026-10-18: V263, owner item I43, ADVANCED no longer includes the Send setting.
// 2026-10-12: Replies precedes Send; Reply thinking was retired by the owner.
// 2026-10-11: V218 inserts Picture style directly after Situation picture in the guarded order.
import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import {
  TUTOR_CONVERSATION_SCENE_SLANTS,
  tutorConversationLiveResumeInstruction,
  tutorConversationLiveSystemInstruction,
  tutorConversationOpeningRequest,
  tutorConversationTurnRequest
} from '../src/tutor/generation.js';
import { renderKrenResultViewHtml, renderTutorConversation } from '../src/resultViewHtml.js';
import { createTutorViewState } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

function tutorPage(provider: 'gemini' | 'openai' | 'anthropic' = 'gemini', hasGeminiKey = true): string {
  return renderKrenResultViewHtml({
    cspSource: 'test', nonce: 'test', activeScreen: 'tutor', proModels: [],
    settings: { ...PANEL_SETTINGS_FIXTURE, tutorProvider: provider, credentialPresence: { geminiDefault: hasGeminiKey } },
    tutor: createTutorViewState()
  });
}

describe('V125 English conversation boundary, 2026-09-20', () => {
  it('repeats the English-only and third-language rule in all four conversation instructions', () => {
    const openingContext = {
      kind: 'anything' as const, register: 'neutral' as const,
      sceneSlant: TUTOR_CONVERSATION_SCENE_SLANTS[0]
    };
    const instructions = {
      live: tutorConversationLiveSystemInstruction(openingContext, false),
      liveResume: tutorConversationLiveResumeInstruction([
        { speaker: 'KREN', text: 'Hello.' }, { speaker: 'learner', text: '안녕하세요.' }
      ]),
      standardTurn: tutorConversationTurnRequest({
        register: 'neutral', recipeTargets: { supportingTargets: [] }, transcript: [], question: 'Hello?',
        learnerAnswer: 'How do you say 안녕하세요 in German?'
      }).instruction,
      standardOpening: tutorConversationOpeningRequest(openingContext).instruction
    };
    for (const [name, instruction] of Object.entries(instructions)) {
      // 2026-10-02: V182 strengthens Live's noise rule; guard the English boundary by meaning.
      expect(instruction, name).toMatch(/(?:Always speak and write in|Speak and write only) English/u);
      expect(instruction, name).toMatch(/whatever language the learner(?: writes or speaks|'s turn appears to be in)/u);
      expect(instruction, name).toContain('asks about a third language');
      expect(instruction, name).toContain('"Hallo, wie geht\'s dir?"');
      expect(instruction, name).toContain('Every correction must stay in English.');
    }
  });
});

describe('V125 tutor controls and defaults, 2026-09-20', () => {
  it('moves Gemini Voice out of conversation ADVANCED and orders all voice groups in TUTOR VOICE', () => {
    const $ = load(tutorPage());
    const advanced = $('[data-tutor-conversation-advanced]');
    expect(advanced.find('[data-tutor-conversation-live-voice]')).toHaveLength(0);
    // Changed 2026-10-02: V182 places Balloon transparency immediately below Picture transparency.
    // Changed 2026-10-03: language precedes existing ADVANCED rows; their order stays guarded.
    expect(advanced.find('[data-setting="tutor.conversation.liveTranscriptionLanguage"]')).toHaveLength(1);
    expect(advanced.find('.setting').first().find('[data-tutor-conversation-replies]')).toHaveLength(1);
    expect(advanced.find('.setting').not('[data-model-identifier]').filter((_, row) => $(row).find('[data-setting="tutor.conversation.liveTranscriptionLanguage"]').length === 0).find('.setting-title').map((_, element) => $(element).text()).get())
      // Changed 2026-10-02: V187 inserts Speech detection immediately below Pause before reply.
      // 2026-10-10: V217 adds Take-home card last without moving the existing ADVANCED rows.
      // 2026-10-11: V220 adds Prepare hints in advance immediately before Take-home card.
      .toEqual(['Replies', 'Reply length', 'Situation picture', 'Picture style', 'Picture transparency', 'Balloon transparency', 'Microphone sensitivity', 'Pause before reply', 'Speech detection', 'Microphone close wait', 'Press to talk', 'Prepare hints in advance', 'Take-home card']);

    const tutorVoice = $('details[data-tutor-child]').filter((_, element) =>
      $(element).find('summary .rewrite-group-name').first().text().trim() === 'TUTOR VOICE'
    );
    expect(tutorVoice.find('[data-tutor-voice-group] > h4').map(
      (_, element) => $(element).text()
    ).get()).toEqual([expect.stringMatching(/Microsoft Edge Online/u), expect.stringMatching(/Gemini.*Voice/u), expect.stringMatching(/Local Windows/u)]); // 2026-10-11: Assert heading purpose and group order as the shared voice label changes.
    const gemini = tutorVoice.find('[data-tutor-voice-group="gemini"]');
    expect(gemini.find('[data-tutor-conversation-live-voice] option')).toHaveLength(30);
    // 2026-10-11: Describe the separate Live credential and shared Chirp defaults by meaning.
    expect(gemini.text()).toMatch(/Live replies.*stored Gemini key/iu);
    expect(gemini.text()).toMatch(/Chirp.*female and male defaults/iu);
    expect(gemini.find('[data-command="previewTutorGeminiVoice"]:not(:disabled)')).toHaveLength(1);
    expect(tutorVoice.find('[data-command="previewTutorEdgeVoice"]')).toHaveLength(1);

    const nonGemini = load(tutorPage('openai'))('[data-command="previewTutorGeminiVoice"]');
    // 2026-10-11: A stored Gemini key enables preview independently of the text provider.
    expect(nonGemini.is(':disabled')).toBe(false);
    const missingKey = load(tutorPage('openai', false))('[data-command="previewTutorGeminiVoice"]');
    expect(missingKey.is(':disabled')).toBe(true);
  });

  it('starts every new conversation with per-turn input tracking, stop-speaking, Live, and Short', () => {
    const conversation = createTutorViewState().conversation;
    // Changed 2026-09-23: dictated tolerance belongs to each answer, not a global default.
    // Changed 2026-09-25: V157 makes Short the default reply length.
    expect(conversation).toMatchObject({
      draftAnswerSpoken: false, send: 'stopSpeaking', replies: 'liveGemini',
      // 2026-10-12: The retired Reply thinking preference is absent.
      replyLength: 'short'
    });
    expect(conversation).not.toHaveProperty('answers');
  });

  it('adds the pulsing class only while Talk or dictation is listening and keeps reduced motion static', () => {
    const live = createTutorViewState();
    Object.assign(live.conversation, { status: 'active', replies: 'liveGemini' });
    const listening = load(renderTutorConversation(live, 'auto', true, false, true, true));
    const liveMicrophone = listening('[data-command="dictateTutorConversation"]');
    expect(liveMicrophone.attr('aria-pressed')).toBe('true');
    expect(liveMicrophone.hasClass('tutor-microphone-pulsing')).toBe(true);

    const idle = load(renderTutorConversation(live, 'auto', true, false, true, false));
    expect(idle('[data-command="dictateTutorConversation"]')
      .hasClass('tutor-microphone-pulsing')).toBe(false);

    live.conversation.replies = 'standard';
    live.speech.dictatingConversation = true;
    live.speech.dictationProvider = 'gemini';
    const dictating = load(renderTutorConversation(live, 'gemini', true));
    expect(dictating('[data-command="dictateTutorConversation"]')
      .hasClass('tutor-microphone-pulsing')).toBe(true);

    const css = load(tutorPage())('style').text();
    // Tightened 2026-09-20: the selector alone also appears in the reduced-motion rule, so
    // deleting the animation itself left every test passing.
    expect(css).toMatch(
      /\.icon-button\.tutor-microphone-pulsing \{ animation: kren-tutor-microphone-pulse [^}]*infinite;/u
    );
    expect(css).toContain('@keyframes kren-tutor-microphone-pulse');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?tutor-microphone-pulsing\s*\{\s*animation: none;/u);
  });

  it('gives every ordinary tutor input KREN font inheritance and preserves the two editor-font boxes', () => {
    const css = load(tutorPage())('style').text();
    for (const selector of ['.tutor-conversation-answer', '.tutor-answer', '.tutor-map-search']) {
      const rule = css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`, 'u'))?.[1] ?? '';
      expect(rule, selector).toContain('font: inherit');
    }
    expect(css.match(/\.tutor-conversation-custom textarea\s*\{([^}]*)\}/u)?.[1])
      .toContain('font: inherit');
    expect(css.match(/\.tutor-prepared-prompt-text\s*\{([^}]*)\}/u)?.[1])
      .toContain('font-family: var(--vscode-editor-font-family, monospace)');
    expect(css.match(/\.grammar-draft textarea\s*\{([^}]*)\}/u)?.[1])
      .not.toContain('font: inherit');
  });

  it('renders only tutor-prefixed setting writes on the tutor page, including conversation replay voices', () => {
    const $ = load(tutorPage());
    const keys = $('[data-tutor-configuration] [data-setting]')
      .map((_, element) => $(element).attr('data-setting')).get();
    expect(keys.length).toBeGreaterThan(0);
    const sharedKeys = keys.filter((key) => !key.startsWith('tutor.'));
    expect(sharedKeys, `shared settings rendered in Tutor: ${sharedKeys.join(', ')}`).toEqual([]);
    const voiceKeys = $('[data-tutor-configuration] [data-tutor-voice-setting]')
      .map((_, element) => $(element).attr('data-tutor-voice-setting')).get();
    expect(voiceKeys).toEqual([
      'tutor.readAloud.edgeFemaleVoice',
      'tutor.readAloud.edgeMaleVoice',
      'tutor.liveFemaleVoice',
      'tutor.liveMaleVoice'
    ]);
    expect(voiceKeys.every((key) => key.startsWith('tutor.'))).toBe(true);
    expect(keys).not.toContain('readAloud.edgeVoice');
    expect(keys).not.toContain('readAloud.edgePythonCommand');

    // 2026-09-26: Check the moved function itself so this guard still covers its setting keys.
    const controller = readFileSync('src/resultsViewSettings.ts', 'utf8');
    const start = controller.indexOf('export async function updateTutorSetting(');
    expect(start).toBeGreaterThanOrEqual(0);
    const nextExport = controller.indexOf('\nexport ', start + 1);
    const update = controller.slice(start, nextExport < 0 ? undefined : nextExport);
    expect(update).not.toMatch(/['"]readAloud\./u);
    expect(update).not.toMatch(/['"]kren\.readAloud\./u);
  });
});
