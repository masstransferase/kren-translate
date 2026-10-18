import type { TutorGenerationKind, TutorStructuredGenerationRequest } from './generation.js';
import { tutorConversationTurn, tutorConversationOpening, tutorConversationDemoCast, tutorConversationDemoBatch, tutorProseAnswer, tutorWrittenHint, tutorTargetSearchSelection } from './generation.js';
import { tutorLearnerTurnNotShown } from './learnerLanguage.js';
import type { TutorLanguageModelRoute } from '../operations.js';
import { ProviderError } from '../errors.js';
import { validateLanguageModelOutput } from '../languageModelUsage.js';
import { configuredThinkingLevel, thinkingLevelForModel } from '../providers/gemini.js';
import type { LanguageModelRoutingEffort, LanguageModelRoutingProvider } from '../languageModelRouting.js';
import { TUTOR_MODELS, tutorModeModel, type ThinkingMode } from './models.js';
export { TUTOR_MODELS, tutorModeModel, type ThinkingMode } from './models.js';

/** A validation rejection permits one Fast to Thorough transition, never a transport retry. */
export function canEscalateThinking(mode: ThinkingMode, aborted: boolean, validationFailure: boolean): boolean {
  return mode === 'fast' && !aborted && validationFailure;
}

/** Every generation kind is explicit; unknown future requests still default to thorough. */
export const TUTOR_THINKING_MODES = {
  targetSearch: 'fast', liveSessionCredential: 'thorough', conversationOpening: 'thorough',
  conversationDemoCast: 'fast', conversationDemoBatch: 'fast', conversationCorrections: 'thorough',
  conversationDiagnosis: 'thorough', passageDiagnosis: 'thorough', conversationTakeHome: 'thorough', tailoredPrompt: 'thorough',
  practiceHint: 'fast', conversationHint: 'fast', lesson: 'thorough', example: 'thorough',
  exercises: 'thorough', review: 'thorough', reviewBatch: 'thorough', conversationStop: 'thorough',
  exampleQuestion: 'fast', practiceQuestion: 'fast', conversationTurn: 'fast', translate: 'fast'
} as const satisfies Record<TutorGenerationKind | 'translate', ThinkingMode>;

export function tutorFastModel(provider: LanguageModelRoutingProvider, configured: string | undefined, thorough: string): string {
  if (configured === '') return tutorModeModel(provider, 'thorough', thorough);
  const model = tutorModeModel(provider, 'fast', configured);
  return (provider === 'openai' || provider === 'anthropic') && model === TUTOR_MODELS[provider].fast
    ? tutorModeModel(provider, 'thorough', thorough) : model;
}

export function modeEffort(provider: LanguageModelRoutingProvider, model: string, mode: ThinkingMode,
  configured: LanguageModelRoutingEffort): LanguageModelRoutingEffort {
  if (mode === 'thorough') return configured === 'auto'
    ? provider === 'gemini' ? configuredThinkingLevel(model, 'auto') ?? 'none'
      : provider === 'openai' ? lowestOpenAIEffort(model)
        : provider === 'anthropic' ? lowestAnthropicEffort(model)
          : provider === 'groq' && /^openai\/gpt-oss-/u.test(model) ? 'low' : 'none'
    : provider === 'gemini' && configured !== 'none' ? configuredThinkingLevel(model, configured) ?? 'none' : configured;
  return provider === 'gemini' ? thinkingLevelForModel(model) ?? 'none'
    : provider === 'anthropic' ? lowestAnthropicEffort(model)
      : provider === 'groq' && /^openai\/gpt-oss-/u.test(model) ? 'low'
      : provider === 'openai' ? lowestOpenAIEffort(model) : 'none';
}

function lowestOpenAIEffort(model: string): LanguageModelRoutingEffort {
  // 2026-10-11: GPT-5.4 supports none; legacy GPT-5 starts at minimal and o-series at low.
  return /^gpt-5\.[1-4](?:$|[-.])/u.test(model) ? 'none'
    : /^gpt-5(?:$|-)/u.test(model) ? 'minimal' : /^o\d/u.test(model) ? 'low' : 'auto';
}

function lowestAnthropicEffort(model: string): LanguageModelRoutingEffort {
  // 2026-10-11: older Sonnet/Haiku models do not accept output_config.effort.
  return /^claude-(?:opus-4-[56]|sonnet-4-6)(?:$|-)/u.test(model) ? 'low' : 'auto';
}

export const wordCount = (text: string): number => text.trim() ? text.trim().split(/\s+/u).length : 0;
export function adaptiveEffort(provider: LanguageModelRoutingProvider, model: string, text: string,
  configured: LanguageModelRoutingEffort): LanguageModelRoutingEffort {
  return modeEffort(provider, model, wordCount(text) <= 40 ? 'fast' : 'thorough', configured);
}

function requestData(request: TutorStructuredGenerationRequest): Record<string, any> {
  try { const data = JSON.parse(request.input); return data && typeof data === 'object' ? data : {}; } catch { return {}; }
}
function validateFast(request: TutorStructuredGenerationRequest, value: unknown): void {
  const data = requestData(request);
  const targets = (data.lessonContext?.targets ?? []).map((target: { targetId: string }) => target.targetId);
  switch (request.kind) {
    case 'practiceHint': case 'conversationHint':
      if (!tutorWrittenHint(value)) throw new Error('The provider returned no readable hint fields.');
      break;
    case 'exampleQuestion': case 'practiceQuestion': tutorProseAnswer(value); break;
    case 'targetSearch': tutorTargetSearchSelection(value); break;
    case 'conversationOpening': tutorConversationOpening(value, request.schema.required instanceof Array && request.schema.required.includes('opening'), targets); break;
    case 'conversationDemoCast': tutorConversationDemoCast(value); break;
    case 'conversationDemoBatch': tutorConversationDemoBatch(value, data.exchanges); break;
    case 'conversationTurn': tutorConversationTurn(value, tutorLearnerTurnNotShown(data.learnerAnswer ?? ''), targets); break;
  }
}

/** Non-tutor features keep their selected model while validation engages configured thinking once. */
export async function runAdaptiveThinking<T>(kind: string, text: string, signal: AbortSignal,
  generate: (mode: ThinkingMode) => Promise<T>, log: (line: string) => void = () => {}, retry = false): Promise<T> {
  const mode: ThinkingMode = retry || wordCount(text) > 40 ? 'thorough' : 'fast';
  if (retry) log(`[thinking] ${kind} fast -> thorough (retry)`);
  else if (mode === 'thorough') log(`[thinking] ${kind} fast -> thorough (long input)`);
  try { return await generate(mode); }
  catch (error) {
    if (!canEscalateThinking(mode, signal.aborted, error instanceof ProviderError && error.reason === 'structuredOutput' ||
        error instanceof SyntaxError || error instanceof Error && error.name === 'UserDictionaryMalformedOutputError')) throw error;
    log(`[thinking] ${kind} fast -> thorough (validation)`);
    return generate('thorough');
  }
}

class TutorValidationError extends Error {}

/** Host-only mode metadata prevents nested panel/transport boundaries from escalating twice. */
export async function runTutorThinking(request: TutorStructuredGenerationRequest, route: TutorLanguageModelRoute,
  signal: AbortSignal, generate: (request: TutorStructuredGenerationRequest, route: TutorLanguageModelRoute, signal: AbortSignal) => Promise<unknown>,
  log: (line: string) => void = () => {}): Promise<unknown> {
  if (request.thinkingMode || request.kind === 'liveSessionCredential') return generate(request, route, signal);
  const data = requestData(request);
  const base: ThinkingMode = (TUTOR_THINKING_MODES as Record<string, ThinkingMode>)[request.kind] ?? 'thorough';
  const learnerInput = request.learnerInput ?? (request.kind === 'conversationTurn' ? data.learnerAnswer ?? ''
    : [data.learnerAnswer, data.question].filter((value): value is string => typeof value === 'string').join(' '));
  const reason = base === 'fast' ? request.retry ? 'retry'
    : wordCount(learnerInput) > 40 || (request.transcriptTurns ?? data.transcript?.length ?? 0) > 10 ? 'long input' : undefined : undefined;
  const mode = reason ? 'thorough' : base;
  if (reason) log(`[thinking] ${request.kind} fast -> thorough (${reason})`);
  const perform = async (selected: ThinkingMode) => {
    signal.throwIfAborted();
    const model = selected === 'fast' ? tutorFastModel(route.provider, route.fastModel, route.model)
      : tutorModeModel(route.provider, selected, route.model);
    const value = await generate({ ...request, thinkingMode: selected }, { ...route, model,
      thinkingOrEffort: modeEffort(route.provider, model, selected, route.thinkingOrEffort) }, signal);
    if (base === 'fast') {
      try { validateLanguageModelOutput(value, () => validateFast(request, value)); }
      catch (error) { throw new TutorValidationError(error instanceof Error ? error.message : 'The provider returned invalid structured output.'); }
    }
    return value;
  };
  try { return await perform(mode); }
  catch (error) {
    if (!canEscalateThinking(mode, signal.aborted, error instanceof TutorValidationError || error instanceof SyntaxError ||
        error instanceof ProviderError && error.reason === 'structuredOutput')) throw error;
    log(`[thinking] ${request.kind} fast -> thorough (validation)`);
    return perform('thorough');
  }
}
