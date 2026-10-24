import type { TutorGenerationKind, TutorStructuredGenerationRequest } from './generation.js';
import { tutorConversationTurn, tutorConversationOpening, tutorConversationDemoCast, tutorConversationDemoBatch, tutorProseAnswer, tutorWrittenHint, tutorTargetSearchSelection } from './generation.js';
import { tutorLearnerTurnNotShown } from './learnerLanguage.js';
import type { TutorLanguageModelRoute } from '../operations.js';
import { ProviderError } from '../errors.js';
import { validateLanguageModelOutput } from '../languageModelUsage.js';
import type { LanguageModelRoutingEffort, LanguageModelRoutingProvider } from '../languageModelRouting.js';
import { TUTOR_MODELS, tutorModeModel, type ThinkingMode } from './models.js';
export { TUTOR_MODELS, tutorModeModel, type ThinkingMode } from './models.js';

import { canEscalateThinking, TUTOR_THINKING_MODES, tutorFastModel, modeEffort, wordCount, adaptiveEffort, selectAdaptiveThinking, selectTutorThinking } from '@kren/core/request-decisions';
export { canEscalateThinking, TUTOR_THINKING_MODES, tutorFastModel, modeEffort, wordCount, adaptiveEffort };

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
  const { mode } = selectAdaptiveThinking(text, retry);
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

/** Auto preserves the lowest supported Fast level; an explicit choice uses normal model normalization. */
export function tutorFastEffort(provider: LanguageModelRoutingProvider, model: string,
  configured: LanguageModelRoutingEffort = 'auto'): LanguageModelRoutingEffort {
  return modeEffort(provider, model, configured === 'auto' ? 'fast' : 'thorough', configured);
}

/** Host-only mode metadata prevents nested panel/transport boundaries from escalating twice. */
export async function runTutorThinking(request: TutorStructuredGenerationRequest, route: TutorLanguageModelRoute,
  signal: AbortSignal, generate: (request: TutorStructuredGenerationRequest, route: TutorLanguageModelRoute, signal: AbortSignal) => Promise<unknown>,
  log: (line: string) => void = () => {}): Promise<unknown> {
  if (request.thinkingMode || request.kind === 'liveSessionCredential') return generate(request, route, signal);
  const data = requestData(request);
  const learnerInput = request.learnerInput ?? (request.kind === 'conversationTurn' ? data.learnerAnswer ?? ''
    : [data.learnerAnswer, data.question].filter((value): value is string => typeof value === 'string').join(' '));
  const { base, mode, reason } = selectTutorThinking(request.kind, request.retry, learnerInput, request.transcriptTurns ?? data.transcript?.length ?? 0);
  if (reason) log(`[thinking] ${request.kind} fast -> thorough (${reason})`);
  const perform = async (selected: ThinkingMode) => {
    signal.throwIfAborted();
    const model = selected === 'fast' ? tutorFastModel(route.provider, route.fastModel, route.model)
      : tutorModeModel(route.provider, selected, route.model);
    const value = await generate({ ...request, thinkingMode: selected }, { ...route, model,
      thinkingOrEffort: selected === 'fast' ? tutorFastEffort(route.provider, model, route.fastThinkingOrEffort)
        : modeEffort(route.provider, model, selected, route.thinkingOrEffort) }, signal);
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
