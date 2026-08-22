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
export type TranslationProviderId = 'gemini' | 'googleCloudTranslation';
export type LanguageModelProviderId = CoreLanguageModelProviderId;
export type ExplanationOutputLanguage = string;
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
  translatedText: string;
  alternatives?: string[];
  note?: string;
  modelId?: string;
  fallbackFromModel?: string;
}

export type RewriteVariantId = CoreRewriteVariantId;

export interface RewriteVariant extends CoreRewriteVariant {}

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
