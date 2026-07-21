export type LanguageCode = string;
export type LookupKind = 'dictionary' | 'translation';
export type TranslationProviderId = 'gemini' | 'googleCloudTranslation';
export type LanguageModelProviderId = 'gemini' | 'openai' | 'anthropic';
export type ExplanationOutputLanguage = string;
export type RewriteDomain = 'general' | 'academic' | 'technical' | 'business' | 'email';
export type RewriteEnglishVariety =
  | 'american'
  | 'british'
  | 'australian'
  | 'canadian'
  | 'indian'
  | 'international';
export type RewriteEnglishVarietySetting = 'followGrammar' | RewriteEnglishVariety;
export type RewriteTone =
  | 'preserveVoice'
  | 'neutral'
  | 'professional'
  | 'warm'
  | 'assertive'
  | 'cautious'
  | 'diplomatic'
  | 'formal'
  | 'direct'
  | 'plainLanguage';
export type RewriteRhetoricalMode =
  | 'preserveOriginal'
  | 'explain'
  | 'persuade'
  | 'recommend'
  | 'constructivelyChallenge';
export type RewriteOperation =
  | 'rewrite'
  | 'rewriteNatural'
  | 'rewriteConcise'
  | 'rewriteJargonFree';

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

export interface RewriteRequest extends BaseRequest {
  kind: 'translation';
  operation: RewriteOperation;
  englishVariety: RewriteEnglishVariety;
  domain: RewriteDomain;
  tone: RewriteTone;
  rhetoricalMode?: RewriteRhetoricalMode;
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

export type RewriteVariantId = 'natural' | 'concise' | 'jargonFree';

export interface RewriteVariant {
  id: RewriteVariantId;
  label: string;
  text: string;
  changeNote?: string;
}

export interface RewriteResult extends BaseResult {
  kind: 'rewrite';
  variants: RewriteVariant[];
  englishVariety: RewriteEnglishVariety;
  domain: RewriteDomain;
  tone: RewriteTone;
  rhetoricalMode: RewriteRhetoricalMode;
  modelId?: string;
  fallbackFromModel?: string;
}

export type GrammarDialect = 'american' | 'british' | 'australian' | 'canadian' | 'indian';
export type GrammarSuggestionKind = 'replace' | 'remove' | 'insertAfter';

export interface GrammarSuggestion {
  kind: GrammarSuggestionKind;
  replacement: string;
  label: string;
}

export interface GrammarIssue {
  id: string;
  start: number;
  end: number;
  original: string;
  category: string;
  message: string;
  suggestions: GrammarSuggestion[];
  /** Harper's privacy-preserving context hash; never contains the checked passage. */
  ignoreHash?: string;
}

export interface GrammarResult extends BaseResult {
  kind: 'grammar';
  dialect: GrammarDialect;
  issues: GrammarIssue[];
}

export interface GrammarChoice {
  issueId: string;
  suggestionIndex: number;
}

export interface DictionaryEntry {
  senseNumber?: string;
  grammaticalLabel?: string;
  partOfSpeech?: string;
  meaning: string;
  definition?: string;
  examples?: string[];
}

export interface DictionarySection {
  headword: string;
  homograph?: number;
  partOfSpeech?: string;
  pronunciation?: string;
  audioUrl?: string;
  inflections?: string[];
  entries: DictionaryEntry[];
  synonymDiscussions?: DictionaryDiscussion[];
}

export interface DictionaryDiscussion {
  label?: string;
  text: string;
  examples?: string[];
  seeAlso?: string[];
  blocks?: DictionaryDiscussionBlock[];
}

export interface DictionaryDiscussionBlock {
  kind: 'text' | 'example';
  text: string;
}

export interface ThesaurusWord {
  word: string;
  labels?: string[];
}

export interface ThesaurusSense {
  senseNumber?: string;
  definition?: string;
  synonyms: ThesaurusWord[];
  nearSynonyms?: ThesaurusWord[];
  relatedWords?: ThesaurusWord[];
  synonymousPhrases?: ThesaurusWord[];
  antonyms?: ThesaurusWord[];
  nearAntonyms?: ThesaurusWord[];
}

export interface ThesaurusSection {
  headword: string;
  partOfSpeech?: string;
  pronunciation?: string;
  audioUrl?: string;
  senses: ThesaurusSense[];
}

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
