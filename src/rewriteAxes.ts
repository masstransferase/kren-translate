// Rewrite axes used to be repeated as type unions, validators, settings options,
// panel options, and provider conditionals. A value added to only one copy could
// render normally while being rejected before it reached the provider.
//
// Each axis now has one array as its single TypeScript source. Types, guards,
// labels, panel options, migration, and prompt instructions derive from those
// arrays, so a missing source edit becomes a compile error or a manifest-drift
// test failure instead of a silent no-op.
//
// This module deliberately imports nothing from vscode, so it can be unit tested.

interface RewriteAxisOption {
  id: string;
  label: string;
  instruction?: string;
}

type RewriteAxisId<T extends readonly RewriteAxisOption[]> = T[number]['id'];

export const REWRITE_MODALITIES = [
  { id: 'written', label: 'Written' },
  {
    id: 'spoken',
    label: 'Spoken',
    instruction: 'Write for spoken delivery. Keep clauses near 20 words or fewer. Use no parentheses, semicolons, em dashes, or en dashes; split those structures into sentences. Expand abbreviations and symbols that are read incorrectly: e.g. to for example, 15% to fifteen percent, n = 12 to twelve samples, and Fig. 2 to figure two. Also expand i.e., vs., etc., et al., cf., and an ampersand immediately after a number. Replace visual-layout references such as shown above, shown below, see above, see below, described above, described below, listed above, listed below, the figure above, the table below, as above, and see Figure 1. Avoid positional back-references such as the former and the latter, but preserve ordinary uses such as concentrations below a limit, temperatures above a threshold, and the former director. Prefer a common synonym when a homophone would be ambiguous.'
  }
] as const satisfies readonly RewriteAxisOption[];

export const REWRITE_FUNCTIONS = [
  { id: 'general', label: 'General' },
  { id: 'proposal', label: 'Proposal', instruction: 'Make the wording suitable for a proposal without inventing benefits, evidence, commitments, or implementation details.' },
  { id: 'manuscript', label: 'Manuscript', instruction: 'Make the wording suitable for a manuscript, with disciplined exposition and no invented evidence, citations, or conclusions.' },
  { id: 'report', label: 'Report', instruction: 'Make the wording suitable for a report, with clear findings and qualifications and no invented context.' },
  { id: 'presentation', label: 'Presentation', instruction: 'Make the wording suitable for a presentation while preserving every supplied claim and qualification.' },
  { id: 'letter', label: 'Letter', instruction: 'Make the wording suitable for a letter without inventing a salutation, closing, recipient, or relationship.' },
  { id: 'email', label: 'Email', instruction: 'Make the wording suitable for a natural professional email. Do not invent a greeting, sign-off, recipient, or relationship that is absent from the source.' }
] as const satisfies readonly RewriteAxisOption[];

export const REWRITE_ENGLISH_VARIETIES = [
  { id: 'followGrammar', label: 'Follow Grammar Check' },
  { id: 'american', label: 'American English', instruction: 'Use standard American English spelling, punctuation, vocabulary, idiom, and usage consistently.' },
  { id: 'british', label: 'British English', instruction: 'Use standard British English spelling, punctuation, vocabulary, idiom, and usage consistently.' },
  { id: 'australian', label: 'Australian English', instruction: 'Use standard Australian English spelling, punctuation, vocabulary, idiom, and usage consistently.' },
  { id: 'canadian', label: 'Canadian English', instruction: 'Use standard Canadian English spelling, punctuation, vocabulary, idiom, and usage consistently.' },
  { id: 'indian', label: 'Indian English', instruction: 'Use standard Indian English spelling, punctuation, vocabulary, idiom, and usage consistently while avoiding stereotypes or exaggerated regionalisms.' },
  { id: 'international', label: 'International English', instruction: 'Use clear internationally accessible English. Prefer region-neutral wording and avoid culture-specific idioms when a natural neutral alternative exists.' }
] as const satisfies readonly RewriteAxisOption[];

export const REWRITE_DOMAINS = [
  { id: 'general', label: 'General', instruction: 'Use general-purpose prose in the source language without imposing a specialized domain style.' },
  { id: 'business', label: 'Business', instruction: 'Use clear, professional business prose that makes actions and decisions easy to understand without adding commitments.' },
  { id: 'academic', label: 'Academic', instruction: 'Use disciplined academic prose, field-appropriate terminology, and appropriately qualified claims. Do not make the text more certain than the source.' },
  { id: 'scientific', label: 'Scientific', instruction: 'Use precise scientific prose, preserve units and field-specific terms, and keep every uncertainty and evidentiary qualification from the source.' },
  { id: 'technical', label: 'Technical', instruction: 'Use precise technical prose and preserve necessary technical terms, identifiers, units, and distinctions.' },
  { id: 'regulatory', label: 'Regulatory', instruction: 'Use precise regulatory prose, preserve defined terms and obligations exactly, and do not invent requirements, authority, or compliance claims.' },
  { id: 'medical', label: 'Medical', instruction: 'Use precise medical prose, preserve clinical qualifications and terminology, and do not invent diagnosis, prognosis, treatment, or certainty.' },
  { id: 'legal', label: 'Legal', instruction: 'Use precise legal prose, preserve defined terms, qualifications, and legal effect, and do not invent rights, duties, authority, or conclusions.' }
] as const satisfies readonly RewriteAxisOption[];

export const REWRITE_FORMALITIES = [
  { id: 'preserve', label: 'Preserve' },
  { id: 'ceremonial', label: 'Ceremonial', instruction: 'Use ceremonial, dignified formality without becoming archaic or adding honorifics absent from the source.' },
  { id: 'formal', label: 'Formal', instruction: 'Use formal, precise wording and complete sentence structure without becoming ornate or bureaucratic.' },
  { id: 'neutral', label: 'Neutral', instruction: 'Use a neutral level of formality that is natural, clear, and professional.' },
  { id: 'informal', label: 'Informal', instruction: 'Use natural informal wording without adding familiarity, slang, or emotion absent from the source.' },
  { id: 'casual', label: 'Casual', instruction: 'Use relaxed, conversational wording without becoming careless or changing the source claim.' }
] as const satisfies readonly RewriteAxisOption[];

export const REWRITE_VOICES = [
  { id: 'preserve', label: 'Preserve', instruction: "Preserve the writer's recognizable voice, formality, cadence, emphasis, and personality as far as the requested variant allows." },
  { id: 'authoritative', label: 'Authoritative', instruction: 'Use an authoritative voice while preserving the source\'s actual authority, evidence, certainty, and commitments.' },
  { id: 'objective', label: 'Objective', instruction: 'Use an objective voice that distinguishes observations from interpretations and preserves uncertainty.' },
  { id: 'analytical', label: 'Analytical', instruction: 'Use an analytical voice that makes the supplied reasoning and distinctions clear without adding analysis or evidence.' },
  { id: 'instructional', label: 'Instructional', instruction: 'Use an instructional voice that makes supplied actions easy to follow without inventing steps, prerequisites, or outcomes.' }
] as const satisfies readonly RewriteAxisOption[];

export const REWRITE_STANCES = [
  { id: 'preserve', label: 'Preserve' },
  { id: 'neutral', label: 'Neutral', instruction: 'Use a neutral interpersonal stance without adding approval, criticism, warmth, or distance.' },
  { id: 'warm', label: 'Warm', instruction: 'Use a warm, approachable, and respectful stance without adding sentiment or familiarity absent from the source.' },
  { id: 'diplomatic', label: 'Diplomatic', instruction: 'Use a tactful, constructive, and respectful stance while keeping the message and necessary disagreements clear.' },
  { id: 'cautious', label: 'Cautious', instruction: 'Use a careful, appropriately qualified stance. Preserve uncertainty and avoid implying conclusions stronger than the source supports.' },
  { id: 'assertive', label: 'Assertive', instruction: 'Use a confident, assertive stance, but do not strengthen claims, certainty, authority, or commitments beyond the source.' },
  { id: 'direct', label: 'Direct', instruction: 'Use a direct, economical stance that states the point clearly without becoming abrupt or changing the source claim.' }
] as const satisfies readonly RewriteAxisOption[];

export const REWRITE_LENGTHS = [
  { id: 'preserve', label: 'Preserve' },
  { id: 'compress', label: 'Compress', instruction: 'Make every rewrite shorter than the supplied text while retaining every important point.' },
  { id: 'expand', label: 'Expand', instruction: 'Make every rewrite longer than the supplied text using only information already present; do not invent examples, evidence, or context.' }
] as const satisfies readonly RewriteAxisOption[];

export const REWRITE_PERSPECTIVES = [
  { id: 'preserve', label: 'Preserve' },
  { id: 'first person', label: 'First Person', instruction: 'Use first-person perspective while preserving who is speaking and without inventing personal experience, authority, or opinion.' },
  { id: 'impersonal', label: 'Impersonal', instruction: 'Use impersonal perspective with no first-person pronouns while preserving agency whenever it matters to the meaning.' }
] as const satisfies readonly RewriteAxisOption[];

export const REWRITE_RHETORICAL_MODES = [
  { id: 'preserveOriginal', label: 'Preserve Original', instruction: 'Rhetorical mode: preserve the original communicative intent. Do not turn an observation into an explanation, persuasion, recommendation, or challenge.' },
  { id: 'explain', label: 'Explain', instruction: 'Rhetorical mode: explain. Make the supplied point easier to understand using only information already present; do not invent examples or background.' },
  { id: 'persuade', label: 'Persuade', instruction: 'Rhetorical mode: persuade. Organize the supplied claims persuasively, but introduce no new evidence, benefits, urgency, certainty, or promises.' },
  { id: 'recommend', label: 'Recommend', instruction: 'Rhetorical mode: recommend. Frame the supplied position as a clear recommendation without inventing reasons, authority, obligations, or implementation details.' },
  { id: 'constructivelyChallenge', label: 'Constructively Challenge', instruction: 'Rhetorical mode: constructively challenge. Express the supplied concern or disagreement clearly, respectfully, and specifically without inventing criticism or becoming combative.' }
] as const satisfies readonly RewriteAxisOption[];

export type RewriteModality = RewriteAxisId<typeof REWRITE_MODALITIES>;
export type RewriteFunction = RewriteAxisId<typeof REWRITE_FUNCTIONS>;
export type RewriteEnglishVarietySetting = RewriteAxisId<typeof REWRITE_ENGLISH_VARIETIES>;
export type RewriteEnglishVariety = Exclude<
  RewriteEnglishVarietySetting,
  typeof REWRITE_ENGLISH_VARIETIES[0]['id']
>;
export type RewriteDomain = RewriteAxisId<typeof REWRITE_DOMAINS>;
export type RewriteFormality = RewriteAxisId<typeof REWRITE_FORMALITIES>;
export type RewriteVoice = RewriteAxisId<typeof REWRITE_VOICES>;
export type RewriteStance = RewriteAxisId<typeof REWRITE_STANCES>;
export type RewriteLength = RewriteAxisId<typeof REWRITE_LENGTHS>;
export type RewritePerspective = RewriteAxisId<typeof REWRITE_PERSPECTIVES>;
export type RewriteRhetoricalMode = RewriteAxisId<typeof REWRITE_RHETORICAL_MODES>;

export interface RewriteAxes {
  modality: RewriteModality;
  function: RewriteFunction;
  englishVariety: RewriteEnglishVariety;
  domain: RewriteDomain;
  formality: RewriteFormality;
  voice: RewriteVoice;
  stance: RewriteStance;
  length: RewriteLength;
  perspective: RewritePerspective;
  rhetoricalMode: RewriteRhetoricalMode;
}

export const REWRITE_AXIS_DEFAULTS = {
  modality: REWRITE_MODALITIES[0].id,
  function: REWRITE_FUNCTIONS[0].id,
  englishVariety: REWRITE_ENGLISH_VARIETIES[0].id,
  domain: REWRITE_DOMAINS[0].id,
  formality: REWRITE_FORMALITIES[0].id,
  voice: REWRITE_VOICES[0].id,
  stance: REWRITE_STANCES[0].id,
  length: REWRITE_LENGTHS[0].id,
  perspective: REWRITE_PERSPECTIVES[0].id,
  rhetoricalMode: REWRITE_RHETORICAL_MODES[0].id
} as const;

export const REWRITE_AXIS_SETTINGS = [
  { key: 'rewrite.modality', values: REWRITE_MODALITIES },
  { key: 'rewrite.function', values: REWRITE_FUNCTIONS },
  { key: 'rewrite.englishVariety', values: REWRITE_ENGLISH_VARIETIES },
  { key: 'rewrite.domain', values: REWRITE_DOMAINS },
  { key: 'rewrite.formality', values: REWRITE_FORMALITIES },
  { key: 'rewrite.voice', values: REWRITE_VOICES },
  { key: 'rewrite.stance', values: REWRITE_STANCES },
  { key: 'rewrite.length', values: REWRITE_LENGTHS },
  { key: 'rewrite.perspective', values: REWRITE_PERSPECTIVES },
  { key: 'rewrite.rhetoricalMode', values: REWRITE_RHETORICAL_MODES }
] as const;

export type RewriteAxisSettingKey = typeof REWRITE_AXIS_SETTINGS[number]['key'];

function isAxisValue<T extends readonly RewriteAxisOption[]>(
  options: T,
  value: unknown
): value is RewriteAxisId<T> {
  return typeof value === 'string' && options.some((option) => option.id === value);
}

export const isRewriteModality = (value: unknown): value is RewriteModality =>
  isAxisValue(REWRITE_MODALITIES, value);
export const isRewriteFunction = (value: unknown): value is RewriteFunction =>
  isAxisValue(REWRITE_FUNCTIONS, value);
export const isRewriteEnglishVarietySetting = (
  value: unknown
): value is RewriteEnglishVarietySetting => isAxisValue(REWRITE_ENGLISH_VARIETIES, value);
export const isRewriteEnglishVariety = (value: unknown): value is RewriteEnglishVariety =>
  isRewriteEnglishVarietySetting(value) && value !== REWRITE_ENGLISH_VARIETIES[0].id;
export const isRewriteDomain = (value: unknown): value is RewriteDomain =>
  isAxisValue(REWRITE_DOMAINS, value);
export const isRewriteFormality = (value: unknown): value is RewriteFormality =>
  isAxisValue(REWRITE_FORMALITIES, value);
export const isRewriteVoice = (value: unknown): value is RewriteVoice =>
  isAxisValue(REWRITE_VOICES, value);
export const isRewriteStance = (value: unknown): value is RewriteStance =>
  isAxisValue(REWRITE_STANCES, value);
export const isRewriteLength = (value: unknown): value is RewriteLength =>
  isAxisValue(REWRITE_LENGTHS, value);
export const isRewritePerspective = (value: unknown): value is RewritePerspective =>
  isAxisValue(REWRITE_PERSPECTIVES, value);
export const isRewriteRhetoricalMode = (value: unknown): value is RewriteRhetoricalMode =>
  isAxisValue(REWRITE_RHETORICAL_MODES, value);

export function isRewriteAxisSetting(
  key: string,
  value: unknown
): value is string {
  const axis = REWRITE_AXIS_SETTINGS.find((candidate) => candidate.key === key);
  return axis !== undefined && typeof value === 'string' &&
    axis.values.some((option) => option.id === value);
}

export function rewriteAxisOptions<T extends readonly RewriteAxisOption[]>(
  options: T
): Array<[RewriteAxisId<T>, string]> {
  return options.map((option) => [option.id, option.label]);
}

export function rewriteAxisLabel<T extends readonly RewriteAxisOption[]>(
  options: T,
  value: RewriteAxisId<T>
): string {
  return options.find((option) => option.id === value)?.label ?? value;
}

export function rewriteAxisInstruction<T extends readonly RewriteAxisOption[]>(
  options: T,
  value: RewriteAxisId<T>
): string | undefined {
  return options.find((option) => option.id === value)?.instruction;
}

const LEGACY_TONE_MIGRATIONS = [
  { id: 'preserveVoice', values: { formality: 'preserve', voice: 'preserve', stance: 'preserve' } },
  { id: 'formal', values: { formality: 'formal' } },
  { id: 'professional', values: { formality: 'formal', stance: 'neutral' } },
  { id: 'neutral', values: { formality: 'neutral', stance: 'neutral' } },
  { id: 'warm', values: { stance: 'warm' } },
  { id: 'assertive', values: { stance: 'assertive' } },
  { id: 'cautious', values: { stance: 'cautious' } },
  { id: 'diplomatic', values: { stance: 'diplomatic' } },
  { id: 'direct', values: { stance: 'direct' } },
  { id: 'plainLanguage', values: { formality: 'neutral', voice: 'preserve', stance: 'direct' } }
] as const satisfies readonly {
  id: string;
  values: Partial<Pick<RewriteAxes, 'formality' | 'voice' | 'stance'>>;
}[];

type LegacyRewriteTone = typeof LEGACY_TONE_MIGRATIONS[number]['id'];
export type RewriteConfigurationTarget = 'global' | 'workspace' | 'workspaceFolder';

interface InspectedRewriteSetting<T> {
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
}

export interface RewriteMigrationConfiguration {
  inspect<T>(key: string): InspectedRewriteSetting<T> | undefined;
  update(
    key: string,
    value: string | undefined,
    target: RewriteConfigurationTarget
  ): PromiseLike<void>;
}

const MIGRATION_TARGETS = [
  { target: 'global', property: 'globalValue' },
  { target: 'workspace', property: 'workspaceValue' },
  { target: 'workspaceFolder', property: 'workspaceFolderValue' }
] as const;

export async function migrateLegacyRewriteSettings(
  configuration: RewriteMigrationConfiguration
): Promise<void> {
  const tone = configuration.inspect<LegacyRewriteTone>('rewrite.tone');
  const domain = configuration.inspect<RewriteDomain | 'email'>('rewrite.domain');
  const formality = configuration.inspect<RewriteFormality>('rewrite.formality');
  const voice = configuration.inspect<RewriteVoice>('rewrite.voice');
  const stance = configuration.inspect<RewriteStance>('rewrite.stance');
  const rewriteFunction = configuration.inspect<RewriteFunction>('rewrite.function');

  for (const { target, property } of MIGRATION_TARGETS) {
    const legacyTone = tone?.[property];
    const migration = LEGACY_TONE_MIGRATIONS.find((candidate) => candidate.id === legacyTone);
    if (migration) {
      const values: Partial<Pick<RewriteAxes, 'formality' | 'voice' | 'stance'>> =
        migration.values;
      if (values.formality !== undefined && formality?.[property] === undefined) {
        await configuration.update('rewrite.formality', values.formality, target);
      }
      if (values.voice !== undefined && voice?.[property] === undefined) {
        await configuration.update('rewrite.voice', values.voice, target);
      }
      if (values.stance !== undefined && stance?.[property] === undefined) {
        await configuration.update('rewrite.stance', values.stance, target);
      }
      await configuration.update('rewrite.tone', undefined, target);
    }

    if (domain?.[property] === 'email') {
      if (rewriteFunction?.[property] === undefined) {
        await configuration.update('rewrite.function', 'email', target);
      }
      await configuration.update('rewrite.domain', 'business', target);
    }
  }
}
