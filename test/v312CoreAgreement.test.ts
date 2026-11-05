import { describe, expect, it, vi } from 'vitest';
// The same stand-in tutorV258.test.ts uses: the request center's import chain reaches 'vscode'.
vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (_: string, value: unknown) => value }) },
  commands: { executeCommand: vi.fn() }, env: {}, window: {}, Uri: { joinPath: (...parts: unknown[]) => parts } }));
import * as core from '@kren/core/tutor';
import * as generation from '../src/tutor/generation.js';
import * as state from '../src/tutor/state.js';
import * as lessonConversation from '../src/tutor/lessonConversation.js';
import * as takeHome from '../src/tutor/takeHome.js';
import * as plainText from '../src/tutor/plainText.js';
import { tutorFastEffort } from '../src/tutor/thinkingMode.js';
import { TUTOR_MODELS } from '../src/tutor/models.js';
import { ProviderExhaustionState } from '../src/languageModelSwitching.js';
import { runTutorStructuredRequest, type KrenRuntime, type TutorLanguageModelRoute } from '../src/operations.js';

/*
 * V312: KREN VS Code builds its tutor requests by calling core. These checks fail if a VS Code
 * name quietly stops pointing at core, or if the host's tutor fallback (still decided in
 * requestCenter.ts, outside this run's fence) and core's B9 rule drift apart.
 */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const replyLengths: Equal<state.TutorConversationReplyLength, core.TutorConversationReplyLength> = true;
const coaching: Equal<state.TutorConversationCoaching, core.TutorConversationCoaching> = true;
const voiceGender: Equal<state.TutorLiveVoiceGender, core.TutorLiveVoiceGender> = true;
const kinds: Equal<generation.TutorGenerationKind, core.TutorGenerationKind> = true;
// Kept in VS Code (see generation.ts): checked below for identical output instead of identity.
const keptInVsCode = ['tutorConversationTurnRequest', 'tutorConversationDiagnosisRequest', 'tutorPassageDiagnosisRequest'];

describe('V312 VS Code calls core for its tutor requests', () => {
  it('keeps every moved VS Code name pointing at the core function or constant', () => {
    expect([replyLengths, coaching, voiceGender, kinds]).toEqual([true, true, true, true]);
    const moved = Object.keys(generation).filter(name => name in core && !keptInVsCode.includes(name));
    // 79 since 2.0.2: tutorConversationHandoffGreetingTurn joined the re-exports for the Live newcomer's greeting.
    expect(moved.length).toBe(79);
    for (const name of moved) expect((generation as Record<string, unknown>)[name], name).toBe((core as Record<string, unknown>)[name]);
    for (const [module, names] of [[state, ['TUTOR_WRITING_CONSTRAINT_LABELS', 'tutorWritingConstraints', 'tutorExcerptShowsPattern', 'sanitizeTutorConversationText', 'TUTOR_EXCERPT_SENTENCE_LIMIT']],
      [lessonConversation, ['TUTOR_LESSON_TARGET_INSTRUCTION', 'tutorTargetRanges', 'tutorTargetMarks']],
      [takeHome, ['tutorConversationTakeHomeRequest', 'tutorConversationStopRequest', 'tutorConversationTakeHome']],
      [plainText, ['tutorPlainText', 'cleanTutorModelText']]] as const) {
      for (const name of names) expect((module as Record<string, unknown>)[name], name).toBe((core as Record<string, unknown>)[name]);
    }
    expect(tutorFastEffort).toBe(core.tutorFastEffort);
  });

  it('builds the same diagnosis requests in VS Code and in core', () => {
    const turns = [{ question: 'Q?', learnerAnswer: 'I has went.', correction: 'I have gone.', explanation: 'x', rephrase: 'r', rephraseWhy: 'w' },
      { question: 'S?', learnerAnswer: '', correction: '', explanation: '', skipped: true }];
    const settings = [state.createTutorViewState().settings,
      { axes: { domain: 'general', function: 'email', modality: 'spoken', formality: 'formal' }, learnerLevel: 'C1' } as core.TutorWritingSettings];
    const controls = [undefined, { coach: true, register: 'casual' as const }, { tutorRole: 'clerk', learnerRole: 'guest', rolesSwapped: true, register: 'formal' as const },
      { rolesSwapped: true, register: 'neutral' as const }];
    const source = core.createTutorInstructionSource('Custom privacy.');
    for (const setting of settings) {
      for (const control of controls) {
        expect(generation.tutorConversationDiagnosisRequest(turns, setting, undefined, control)).toEqual(core.tutorConversationDiagnosisRequest(turns, setting, undefined, control));
        expect(generation.tutorConversationDiagnosisRequest(turns, setting, source, control)).toEqual(core.tutorConversationDiagnosisRequest(turns, setting, source, control));
      }
      for (const analysis of core.TUTOR_PASSAGE_ANALYSIS_CHOICES) {
        expect(generation.tutorPassageDiagnosisRequest('Passage.', analysis, setting)).toEqual(core.tutorPassageDiagnosisRequest('Passage.', analysis, setting));
        expect(generation.tutorPassageDiagnosisRequest('Passage.', analysis, setting, source)).toEqual(core.tutorPassageDiagnosisRequest('Passage.', analysis, setting, source));
      }
    }
  });

  it('passes KREN language detection to the core turn builder', () => {
    const body = { register: 'neutral' as const, recipeTargets: { supportingTargets: [] }, transcript: [], question: 'Q?', learnerAnswer: '안녕하세요 감사합니다' };
    expect(generation.tutorConversationTurnRequest(body)).toEqual(core.tutorConversationTurnRequest(body, undefined, true));
    const english = { ...body, learnerAnswer: 'I would like a coffee.' };
    expect(generation.tutorConversationTurnRequest(english)).toEqual(core.tutorConversationTurnRequest(english, undefined, false));
    expect(generation.tutorConversationTurnRequest({ ...body, coach: true })).toEqual(core.tutorConversationTurnRequest({ ...body, coach: true }));
  });
});

describe('V312 host tutor fallback agrees with core B9', () => {
  const runtime = (): KrenRuntime => ({ getSetting: <T>(key: string, fallback: T) => ({ 'llm.providerSwitch': false, 'gemini.retry.maxAttempts': 1 }[key] ?? fallback) as T,
    getSecret: async () => 'fixture-secret', beforeGeminiRequest: async () => {}, reserveCloudCharacters: async () => {},
    providerExhaustion: new ProviderExhaustionState(), log: () => {} });
  async function sends(request: core.TutorStructuredGenerationRequest, route: TutorLanguageModelRoute) {
    const original = globalThis.fetch, seen: Array<{ url: string; body: any }> = [];
    globalThis.fetch = (async (url, init) => {
      seen.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return seen.length === 1 ? new Response('{}', { status: 503 })
        : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ explanation: 'x', example: 'y', ready: true }) }] } }] }));
    }) as typeof fetch;
    try { await runTutorStructuredRequest(runtime(), route, request, new AbortController().signal).catch(() => undefined); return seen; }
    finally { globalThis.fetch = original; }
  }
  const lesson = core.tutorLessonGenerationRequest({ schemaVersion: 1, mapVersion: '1.0.0', primaryTargets: [], supportingTargets: [],
    output: { learnerLevel: 'B2' } } as never);
  const hint = core.tutorConversationHintRequest({ question: 'Q?', setting: 'S.', register: 'neutral', recentTurns: [] });
  for (const fastThinkingOrEffort of ['auto', 'low', 'high'] as const) {
    it(`Thorough Gemini falls back to the Fast model with Fast thinking ${fastThinkingOrEffort}`, async () => {
      const route: TutorLanguageModelRoute = { provider: 'gemini', model: TUTOR_MODELS.gemini.thorough, geminiProfile: 'standard', thinkingOrEffort: 'auto',
        fallbackEnabled: true, fallbackModel: 'retired-fallback-model', fallbackThinkingOrEffort: 'medium', fastModel: TUTOR_MODELS.gemini.fast, fastThinkingOrEffort };
      const seen = await sends(lesson, route);
      const decided = core.tutorFallbackRoute({ mode: 'thorough', provider: 'gemini', model: route.model, fastModel: route.fastModel, fastThinkingOrEffort });
      expect(seen).toHaveLength(2);
      expect(seen[1]!.url).toContain(`/models/${decided!.model}:generateContent`);
      expect(seen[1]!.body.generationConfig.thinkingConfig.thinkingLevel).toBe(decided!.thinkingOrEffort);
    });
  }
  it('a Fast Gemini request never falls back, in the host or in core', async () => {
    const route: TutorLanguageModelRoute = { provider: 'gemini', model: TUTOR_MODELS.gemini.thorough, geminiProfile: 'standard', thinkingOrEffort: 'auto',
      fallbackEnabled: true, fallbackModel: 'retired-fallback-model', fallbackThinkingOrEffort: 'medium', fastModel: TUTOR_MODELS.gemini.fast };
    expect(await sends(hint, route)).toHaveLength(1);
    expect(core.tutorFallbackRoute({ mode: 'fast', provider: 'gemini', model: route.model, fastModel: route.fastModel })).toBeUndefined();
  });
});
