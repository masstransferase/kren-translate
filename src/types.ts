import type {
  DictionaryDiscussion as CoreDictionaryDiscussion,
  DictionaryDiscussionBlock as CoreDictionaryDiscussionBlock,
  DictionaryEntry as CoreDictionaryEntry,
  DictionarySection as CoreDictionarySection,
  GrammarDialect as CoreGrammarDialect,
  GrammarIssue as CoreGrammarIssue,
  GrammarSuggestion as CoreGrammarSuggestion,
  GrammarSuggestionKind as CoreGrammarSuggestionKind,
  LanguageModelProviderId as CoreLanguageModelProviderId,
  RewriteVariant as CoreRewriteVariant,
  RewriteVariantId as CoreRewriteVariantId,
  ThesaurusSection as CoreThesaurusSection,
  ThesaurusSense as CoreThesaurusSense,
  ThesaurusWord as CoreThesaurusWord
} from '@kren/core/contracts';
import type {
  RewriteAxes,
  RewriteDomain,
  RewriteEnglishVariety,
  RewriteEnglishVarietySetting,
  RewriteFormality,
  RewriteFunction,
  RewriteLength,
  RewriteModality,
  RewritePerspective,
  RewriteRhetoricalMode,
  RewriteStance,
  RewriteVoice
} from '@kren/core/rewrite-axes';

export type LanguageCode = string;
export type LookupKind = 'dictionary' | 'translation';
export type TranslationProviderId = 'gemini' | 'googleCloudTranslation' | 'groq' | 'cloudflare';
export type LanguageModelProviderId = CoreLanguageModelProviderId | 'groq' | 'cloudflare';
export type ExplanationOutputLanguage = string;

/**
 * Explanation language: write the note in the language of the selected text.
 *
 * Stored as its own value rather than as a language code, because the language is not
 * known until the text is analysed. `bilingual` remains the default and the only other
 * value that is not a code.
 */
export const EXPLANATION_SAME_AS_SOURCE = 'sameAsSource';

/**
 * Translation input language: work it out from the text rather than being told.
 *
 * The same word every provider already understands for an undeclared source, so passing it
 * straight through is meaningful rather than a KREN-only token that would have to be
 * translated at the boundary.
 */
export const TRANSLATION_AUTO_SOURCE = 'auto';

/**
 * The language a translation is written in when nothing has been chosen.
 *
 * It was `auto-en-ko`, a mode that sent English to Korean and Korean to English. The owner
 * removed it on 2026-08-28: an output language that changes with the input is a second
 * detection the reader cannot see on the control, and the reason it existed, avoiding a
 * translation from a language into itself, is now handled by a warning on the result.
 *
 * The locale id rather than the bare `ko`, because the Output control is built from the
 * Read Aloud catalog and offers `ko-KR`. A bare `ko` is not one of its options, so the
 * control rendered the default as "ko (stored)" instead of Korean.
 */
export const DEFAULT_TRANSLATION_TARGET = 'ko-KR';

/**
 * The translation target KREN itself stored until 1.7.9, kept only so a copy left in any
 * configuration scope is read as the default rather than raising "Invalid output language
 * code" at a reader who never typed it.
 */
export const LEGACY_AUTO_TRANSLATION_TARGET = 'auto-en-ko';
export type {
  RewriteDomain,
  RewriteEnglishVariety,
  RewriteEnglishVarietySetting,
  RewriteFormality,
  RewriteFunction,
  RewriteLength,
  RewriteModality,
  RewritePerspective,
  RewriteRhetoricalMode,
  RewriteStance,
  RewriteVoice
} from '@kren/core/rewrite-axes';
export type RewriteOperation =
  | 'rewrite'
  | 'rewriteMinimal'
  | 'rewriteFull';

export interface SelectionAnalysis {
  text: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  kind: LookupKind;
}

export interface BaseRequest extends SelectionAnalysis {
  operation: 'translate' | 'explain' | RewriteOperation;
}

export interface TranslationRequest extends BaseRequest {
  kind: 'translation' | 'dictionary';
  operation: 'translate' | 'explain';
  explanationLanguage?: ExplanationOutputLanguage;
  /**
   * Subject area the result is written for, from the same eight the Rewrite Text axis uses.
   *
   * Added 1.7.11 at the owner's request. Absent, or `general`, adds nothing to the prompt:
   * a domain instruction that says "use general-purpose prose" is noise in every request
   * that did not ask for a subject area.
   *
   * It reaches the language-model providers only. Google Cloud Translation Basic v2 takes
   * `q`, `source`, `target`, and `format`, and has no domain, glossary, or model parameter
   * of any kind, so there is nothing to send it.
   */
  domain?: RewriteDomain;
}

export interface DictionaryRequest extends BaseRequest {
  kind: 'dictionary';
  operation: 'translate';
}

export interface RewriteRequest extends BaseRequest, RewriteAxes {
  kind: 'translation';
  operation: RewriteOperation;
  /** BCP-47 source language, or auto to detect it within the rewrite request. */
  sourceLanguage: LanguageCode;
  preserveFormatting?: boolean;
  includeChangeNotes?: boolean;
}

export interface BaseResult {
  providerId: string;
  sourceText: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  createdAt: string;
}

export interface TranslationResult extends BaseResult {
  kind: 'translation';
  /**
   * Which operation produced this, because Translate and Explain share the shape and the
   * panel renders them the same way.
   *
   * Added 1.7.10. The same-language warning cannot be decided without it: for a translation
   * the two languages agreeing is a mistake worth naming, and for an explanation under Same
   * as source it is the default and intended. Without this field the warning fired on every
   * explanation, which is how it shipped in 1.7.9.
   */
  operation: 'translate' | 'explain';
  translatedText: string;
  alternatives?: string[];
  note?: string;
  modelId?: string;
  fallbackFromModel?: string;
}

export type RewriteVariantId = CoreRewriteVariantId;

export interface RewriteVariant extends CoreRewriteVariant {
  targetLanguage?: LanguageCode;
}

export interface RewriteResult extends BaseResult, RewriteAxes {
  kind: 'rewrite';
  variants: RewriteVariant[];
  modelId?: string;
  fallbackFromModel?: string;
}

export type GrammarDialect = CoreGrammarDialect;
export type GrammarSuggestionKind = CoreGrammarSuggestionKind;

export interface GrammarSuggestion extends CoreGrammarSuggestion {}

/** Harper's privacy-preserving context hash never contains the checked passage. */
export interface GrammarIssue extends CoreGrammarIssue {}

export interface GrammarResult extends BaseResult {
  kind: 'grammar';
  dialect: GrammarDialect;
  issues: GrammarIssue[];
  // Present only when the Smart Grammar pass completed. `providerId` stays `harper`,
  // because the local check always runs and always produces the findings this result is
  // built from; this names the model that added to them.
  smartModelId?: string;
}

export interface GrammarChoice {
  issueId: string;
  suggestionIndex: number;
}

export interface DictionaryEntry extends CoreDictionaryEntry {}

export interface DictionarySection extends CoreDictionarySection {}

export interface DictionaryDiscussion extends CoreDictionaryDiscussion {}

export interface DictionaryDiscussionBlock extends CoreDictionaryDiscussionBlock {}

export interface ThesaurusWord extends CoreThesaurusWord {}

export interface ThesaurusSense extends CoreThesaurusSense {}

export interface ThesaurusSection extends CoreThesaurusSection {}

export interface ThesaurusResult extends BaseResult {
  kind: 'thesaurus';
  headword: string;
  sections: ThesaurusSection[];
  note?: string;
}

export interface DictionaryResult extends BaseResult {
  kind: 'dictionary';
  headword: string;
  pronunciation?: string;
  entries: DictionaryEntry[];
  sections?: DictionarySection[];
  note?: string;
}

export type KrenResult =
  | TranslationResult
  | DictionaryResult
  | ThesaurusResult
  | RewriteResult
  | GrammarResult;

export interface TranslationProvider {
  readonly id: TranslationProviderId;
  translate(request: TranslationRequest, signal: AbortSignal): Promise<TranslationResult>;
}

export interface LanguageModelProvider {
  readonly id: LanguageModelProviderId;
  explain(request: TranslationRequest, signal: AbortSignal): Promise<TranslationResult>;
  rewrite(request: RewriteRequest, signal: AbortSignal): Promise<RewriteResult>;
}

export interface DictionaryProvider {
  readonly id: string;
  lookup(request: DictionaryRequest, signal: AbortSignal): Promise<DictionaryResult | undefined>;
}
