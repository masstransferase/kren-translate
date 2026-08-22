import { parseStructuredJson } from '@kren/core/structured-json';
import {
  SMART_GRAMMAR_INSTRUCTION,
  SMART_GRAMMAR_RESPONSE_SCHEMA,
  smartGrammarCorrectionToIssues
} from '@kren/core/grammar';
import type { GrammarIssue } from '@kren/core/contracts';
import type { UserDictionaryProvider } from '@kren/core/user-dictionary';
import { ProviderError } from './errors.js';
import {
  structuredJsonConfigureAction,
  structuredJsonOutputText,
  structuredJsonProviderName,
  structuredJsonRequestInit,
  structuredJsonUrl
} from './providers/structuredJsonTransport.js';
import type { UserDictionaryThinkingOrEffort } from './userDictionary/settings.js';

export interface SmartGrammarSettings {
  provider: UserDictionaryProvider;
  model: string;
  thinkingOrEffort: UserDictionaryThinkingOrEffort;
  apiKey: string;
}

export type SmartGrammarOutcome =
  | { status: 'completed'; issues: GrammarIssue[] }
  | { status: 'discarded'; reason: string }
  | { status: 'failed'; reason: string };

/**
 * Asks a language model for a minimal grammatical correction of `sourceText` and turns the
 * difference into issues in Harper's existing shape.
 *
 * The model returns corrected text only, never character offsets, because a wrong offset
 * would corrupt a document. Core diffs the correction and rejects one that changed too
 * much of the input to be a grammar repair rather than a restyle.
 *
 * This never throws. A provider failure returns a named reason, and the caller shows both
 * Harper's findings and that reason, because losing a local result to a remote problem
 * would be worse than the feature being unavailable and a silently dropped reason would
 * make a failure look like agreement.
 */
export async function smartGrammarIssues(
  sourceText: string,
  settings: SmartGrammarSettings,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch
): Promise<SmartGrammarOutcome> {
  const providerName = structuredJsonProviderName(settings.provider);
  let correctedText: string;
  try {
    const response = await fetcher(
      structuredJsonUrl(settings.provider, settings.model),
      structuredJsonRequestInit(
        {
          provider: settings.provider,
          model: settings.model,
          thinkingOrEffort: settings.thinkingOrEffort,
          apiKey: settings.apiKey,
          schema: SMART_GRAMMAR_RESPONSE_SCHEMA,
          schemaName: 'kren_smart_grammar_correction'
        },
        { instruction: SMART_GRAMMAR_INSTRUCTION, input: sourceText },
        signal
      )
    );
    if (!response.ok) {
      throw new ProviderError(
        `${providerName} Smart Grammar Check failed (${response.status}).`,
        structuredJsonConfigureAction(settings.provider),
        response.status >= 500,
        response.status
      );
    }
    const text = structuredJsonOutputText(settings.provider, await response.json());
    const value = text === undefined ? undefined : parseStructuredJson(text);
    correctedText = validCorrectedText(value);
  } catch (error) {
    if (signal.aborted) throw error;
    // The reason names the provider and nothing else. A provider message can quote the
    // text it was sent, and this string reaches the panel.
    return {
      status: 'failed',
      reason: error instanceof ProviderError && error.status !== undefined
        ? `Smart Grammar Check could not reach ${providerName} (${error.status}), so only local findings are shown.`
        : `Smart Grammar Check could not reach ${providerName}, so only local findings are shown.`
    };
  }

  const issues = smartGrammarCorrectionToIssues(sourceText, correctedText);
  if (issues === undefined) {
    return {
      status: 'discarded',
      reason: 'Smart Grammar Check rewrote too much of the passage to be a grammar correction, so it was discarded and only local findings are shown.'
    };
  }
  return { status: 'completed', issues };
}

/**
 * Keeps Harper's issue and drops the model's when their spans overlap. Two suggestions on
 * one span cannot both be applied, and Harper's is deterministic.
 */
export function mergeSmartGrammarIssues(
  harperIssues: readonly GrammarIssue[],
  modelIssues: readonly GrammarIssue[]
): GrammarIssue[] {
  const kept = modelIssues.filter((modelIssue) =>
    !harperIssues.some((harperIssue) =>
      modelIssue.start < harperIssue.end && harperIssue.start < modelIssue.end
    )
  );
  return [...harperIssues, ...kept]
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

function validCorrectedText(value: unknown): string {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Smart Grammar Check received a malformed response.');
  }
  const corrected = (value as Record<string, unknown>).correctedText;
  if (typeof corrected !== 'string' || !corrected.trim()) {
    throw new Error('Smart Grammar Check received a response with no corrected text.');
  }
  return corrected;
}
