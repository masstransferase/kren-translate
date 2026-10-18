import { parseStructuredJson } from '@kren/core/structured-json';
import {
  harperReferenceInstruction,
  SMART_GRAMMAR_INSTRUCTION,
  SMART_GRAMMAR_RESPONSE_SCHEMA,
  smartGrammarCorrectionToIssues
} from '@kren/core/grammar';
import type { GrammarIssue } from '@kren/core/contracts';
import type { LanguageModelRoutingProvider as UserDictionaryProvider } from './languageModelRouting.js';
import { ProviderError } from './errors.js';
import {
  requestStructuredJson,
  structuredJsonProviderName,
} from './providers/structuredJsonTransport.js';
import type { UserDictionaryThinkingOrEffort } from './userDictionary/settings.js';

export interface SmartGrammarSettings {
  geminiProfile?: 'standard' | 'pro';
  provider: UserDictionaryProvider;
  model: string;
  thinkingOrEffort: UserDictionaryThinkingOrEffort;
  apiKey: string;
  accountId?: string;
  maxAttempts?: number;
  throwProviderErrors?: boolean;
}

export type SmartGrammarOutcome =
  // The model is reported on success so the result header can name it. Without it the
  // panel showed only "Harper (offline)" for a check a language model had also run, which
  // understated what had been sent and to whom.
  | { status: 'completed'; issues: GrammarIssue[]; model: string }
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
 * A final provider failure returns a named reason unless the host requests errors for
 * its configured fallback. The caller shows both
 * Harper's findings and that reason, because losing a local result to a remote problem
 * would be worse than the feature being unavailable and a silently dropped reason would
 * make a failure look like agreement.
 */
export async function smartGrammarIssues(
  sourceText: string,
  settings: SmartGrammarSettings,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  harperIssues: readonly GrammarIssue[] = []
): Promise<SmartGrammarOutcome> {
  let correctedText: string;
  try {
    correctedText = await requestStructuredJson(
      { ...settings, schema: SMART_GRAMMAR_RESPONSE_SCHEMA, schemaName: 'kren_smart_grammar_correction' },
      { instruction: SMART_GRAMMAR_INSTRUCTION + harperReferenceInstruction(harperIssues), input: sourceText },
      signal, fetcher, settings.maxAttempts ?? 1,
      text => validCorrectedText(parseStructuredJson(text))
    ) as string;
  } catch (error) {
    if (signal.aborted || settings.throwProviderErrors) throw error;
    return {
      status: 'failed',
      reason: smartGrammarFailureReason(settings.provider, error)
    };
  }

  const issues = smartGrammarCorrectionToIssues(sourceText, correctedText);
  if (issues === undefined) {
    return {
      status: 'discarded',
      reason: 'Smart Grammar Check rewrote too much of the passage to be a grammar correction, so it was discarded and only local findings are shown.'
    };
  }
  return { status: 'completed', issues, model: settings.model };
}

/** Reader-facing failures use fixed classifications, never remote message text. */
export function smartGrammarFailureReason(provider: UserDictionaryProvider, error: unknown): string {
  const name = structuredJsonProviderName(provider);
  const failure = error instanceof ProviderError ? error : undefined;
  const status = failure?.status;
  const http = status === undefined ? '' : ` (${status})`;
  const cause = failure?.reason === 'structuredOutput' || error instanceof SyntaxError
    ? `received unreadable output from ${name}`
    : failure?.reason === 'quotaExhausted' ? `reached the daily or monthly quota for ${name}${http}`
      : failure?.reason === 'overloaded' || provider === 'gemini' && status === 503 ? `found ${name} temporarily overloaded${http}`
        : status === 401 || status === 403 ? `could not authenticate with ${name}${http}`
          : status === 429 ? `reached a usage limit for ${name}${http}`
            : status !== undefined && status >= 500 ? `found ${name} temporarily unavailable${http}`
              : status !== undefined ? `had its request rejected by ${name}${http}` : `could not reach ${name}`;
  return `Smart Grammar Check ${cause}, so only local findings are shown.`;
}

/**
 * Combines the two passes with the model's judgement on top, which is the reverse of what
 * this did until 2026-08-23.
 *
 * Harper is a rule engine reading one span. Asked about "moringn" it ranked candidates by
 * edit distance and offered "miring", "mooing", and "mooring", none of which the sentence
 * can mean. The model read the whole sentence and returned "morning", and that answer was
 * computed and then discarded here, because the old rule dropped every model finding whose
 * span touched a Harper finding. The owner's rule is the opposite: Harper finds, the model
 * judges, and the model's decision stands.
 *
 * Overlap is resolved three ways, and only the middle case is new.
 *
 * Where the model's edit sits inside a Harper finding, the two are one finding about one
 * span, so Harper's is kept and the model's replacement is put at the head of its
 * suggestion list. That makes the model's answer the selected one while Harper's remain
 * below it, and it keeps the parts of the Harper finding the model has no equivalent for:
 * its category, its Add to local dictionary control, and its alternatives for a reader who
 * disagrees.
 *
 * Where the spans overlap without nesting, the two passes disagree about what the unit
 * even is, so the model's finding wins outright and Harper's is dropped. Applying both is
 * impossible, and the model is the one that read the sentence.
 *
 * Where they do not overlap, both are kept, which is the whole point of running two passes.
 */
export function mergeSmartGrammarIssues(
  harperIssues: readonly GrammarIssue[],
  modelIssues: readonly GrammarIssue[],
  sourceText?: string
): GrammarIssue[] {
  const absorbed = new Set<GrammarIssue>();
  const merged = harperIssues.map((harperIssue) => {
    const inside = modelIssues.filter((modelIssue) =>
      modelIssue.start >= harperIssue.start && modelIssue.end <= harperIssue.end
    );
    if (inside.length !== 1 || sourceText === undefined) return harperIssue;
    const replacement = replacementAcross(harperIssue, inside[0]!, sourceText);
    if (replacement === undefined) return harperIssue;
    for (const modelIssue of inside) absorbed.add(modelIssue);
    return withLeadingSuggestion(harperIssue, replacement);
  });

  const overlapping = modelIssues.filter((modelIssue) =>
    !absorbed.has(modelIssue) && harperIssues.some((harperIssue) =>
      modelIssue.start < harperIssue.end && harperIssue.start < modelIssue.end
    )
  );
  const surviving = merged.filter((harperIssue) =>
    !overlapping.some((modelIssue) =>
      modelIssue.start < harperIssue.end && harperIssue.start < modelIssue.end
    )
  );
  const separate = modelIssues.filter((modelIssue) =>
    !absorbed.has(modelIssue) && !harperIssues.some((harperIssue) =>
      modelIssue.start < harperIssue.end && harperIssue.start < modelIssue.end
    )
  );
  return [...surviving, ...overlapping, ...separate]
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

/**
 * The model's edit expressed over the Harper span, so one replacement covers the whole
 * finding. The model may have changed only part of what Harper flagged, and applying its
 * shorter replacement to the longer span would delete the rest.
 */
function replacementAcross(
  harperIssue: GrammarIssue,
  modelIssue: GrammarIssue,
  sourceText: string
): string | undefined {
  const span = sourceText.slice(harperIssue.start, harperIssue.end);
  // The finding is stale if the source no longer reads the way the finding says it does,
  // and splicing into text that has moved would produce a plausible, wrong replacement.
  if (span !== harperIssue.original) return undefined;
  const modelReplacement = modelIssue.suggestions[0]?.replacement;
  if (modelReplacement === undefined) return undefined;
  const before = sourceText.slice(harperIssue.start, modelIssue.start);
  const after = sourceText.slice(modelIssue.end, harperIssue.end);
  return `${before}${modelReplacement}${after}`;
}

function withLeadingSuggestion(issue: GrammarIssue, replacement: string): GrammarIssue {
  const label = replacement.trim()
    ? `Replace with “${replacement.trim()}”, which fits the sentence`
    : 'Remove, which fits the sentence';
  const rest = issue.suggestions.filter(
    (suggestion) => suggestion.replacement !== replacement
  );
  return {
    ...issue,
    suggestions: [{ kind: 'replace', replacement, label }, ...rest]
  };
}

function validCorrectedText(value: unknown): string {
  if (typeof value !== 'object' || value === null) {
    throw new ProviderError('Smart Grammar Check received a malformed response.', undefined, false, undefined, 'structuredOutput');
  }
  const corrected = (value as Record<string, unknown>).correctedText;
  if (typeof corrected !== 'string' || !corrected.trim()) {
    throw new ProviderError('Smart Grammar Check received a response with no corrected text.', undefined, false, undefined, 'structuredOutput');
  }
  return corrected;
}
