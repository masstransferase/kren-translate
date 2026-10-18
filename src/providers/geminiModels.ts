import { providerHttpError } from './httpError.js';
import { ProviderError } from '../errors.js';

interface GeminiModelsPayload {
  models?: unknown;
  nextPageToken?: unknown;
  error?: { message?: unknown };
}

export interface GeminiModelOption {
  id: string;
  displayName: string;
  /** Set only when Google advertised bidiGenerateContent for this identifier. */
  liveOnly?: true;
}

/** Successful HTTP without a usable list is inconclusive, never evidence of removal. */
export class UnreadableProviderListError extends Error {
  constructor() { super("The provider's list could not be read."); }
}

export function providerListedIds(payload: unknown, field: 'models' | 'data' | 'voices'): Array<{ id: string }> {
  const entries = payload && typeof payload === 'object' ? (payload as Record<string, unknown>)[field] : undefined;
  if (!Array.isArray(entries) || !entries.length) throw new UnreadableProviderListError();
  return entries.map(entry => {
    const id: unknown = entry && typeof entry === 'object' ? entry[field === 'data' ? 'id' : 'name'] : undefined;
    if (typeof id !== 'string' || !id.trim()) throw new UnreadableProviderListError();
    return { id };
  });
}

export async function readProviderListedIds(response: Response, field: 'data' | 'voices'): Promise<Array<{ id: string }>> {
  const payload: unknown = await response.json().catch(() => { throw new UnreadableProviderListError(); });
  return providerListedIds(payload, field);
}

export interface GeminiModelCatalog {
  text: GeminiModelOption[];
  live: GeminiModelOption[];
  image: GeminiModelOption[];
}

export interface GeminiModelCatalogProtections {
  textStoredIds?: readonly string[];
  textCustomIds?: readonly string[];
  liveStoredIds?: readonly string[];
  liveCustomIds?: readonly string[];
}

interface AdvertisedGeminiModel extends GeminiModelOption {
  methods: string[];
}

interface GeminiGeneration {
  major: number;
  minor: number;
}

/**
 * The one place the default Gemini model is written. It used to be a literal repeated in
 * eight source sites and two package.json settings, so a model upgrade meant ten edits and
 * any one of them could be missed.
 *
 * This is a default, never a constraint: every caller reads a user setting and falls back to
 * this only when the user has not chosen. The model field stays editable everywhere.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

/** Resolve the retired identifier at read time; never rewrite a stored setting. */
export function normalizeGeminiModel(model: string): string {
  return model.trim().replace(/^(models\/)?gemini-3\.5-flash$/u, '$1gemini-3.6-flash');
}

export function normalizeModelSetting<T>(key: string, value: T): T {
  return (typeof value === 'string' && /model$/iu.test(key) ? normalizeGeminiModel(value) : value) as T;
}

export const DEFAULT_PRO_MODELS: GeminiModelOption[] = [
  { id: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro Preview' },
  { id: 'gemini-3.6-flash', displayName: 'Gemini 3.6 Flash' }
];

/**
 * Build the two reader-facing catalogs from Google's advertised model metadata.
 *
 * Google calls the payload field `supportedGenerationMethods`. Ordinary chat models advertise
 * `generateContent`; Live API models advertise `bidiGenerateContent`. Classification uses those
 * capabilities, not a substring in an identifier, so a future Live model with a new name works.
 */
export function geminiModelCatalog(
  values: readonly unknown[],
  protections: GeminiModelCatalogProtections = {}
): GeminiModelCatalog {
  const advertised = values.map(normalizeAdvertisedModel)
    .filter((value): value is AdvertisedGeminiModel => value !== undefined)
    .filter((value) => value.id !== 'gemini-3.5-flash')
    .filter((value) => isGeminiChatFamily(value.id))
    .filter((value) => !isExcludedModelKind(value.id));
  const textProtected = new Set([
    ...DEFAULT_PRO_MODELS.map((model) => model.id),
    ...(protections.textStoredIds ?? []),
    ...(protections.textCustomIds ?? [])
  ]);
  const liveProtected = new Set([
    ...(protections.liveStoredIds ?? []),
    ...(protections.liveCustomIds ?? [])
  ]);
  const textAdvertised = advertised.filter((model) =>
    supportsMethod(model, 'generateContent') && !supportsMethod(model, 'bidiGenerateContent')
  );
  const liveAdvertised = advertised.filter((model) =>
    supportsMethod(model, 'bidiGenerateContent')
  ).map((model): GeminiModelOption => ({
    id: model.id,
    displayName: model.displayName,
    liveOnly: true
  }));
  const knownLiveOnlyIds = new Set(liveAdvertised.map((model) => model.id));
  const text = filterCatalogSeries(
    deduplicateModels([
      ...DEFAULT_PRO_MODELS,
      ...identifiersAsOptions(protections.textStoredIds?.map(normalizeGeminiModel), knownLiveOnlyIds),
      ...identifiersAsOptions(protections.textCustomIds?.map(normalizeGeminiModel), knownLiveOnlyIds),
      ...textAdvertised
    ]),
    textAdvertised,
    textProtected
  );
  const live = filterCatalogSeries(
    deduplicateModels([
      ...identifiersAsOptions(protections.liveStoredIds),
      ...identifiersAsOptions(protections.liveCustomIds),
      ...liveAdvertised
    ], []),
    liveAdvertised,
    liveProtected
  );
  const image = values.map(normalizeAdvertisedModel)
    .filter((model): model is AdvertisedGeminiModel => model !== undefined)
    .filter((model) => supportsMethod(model, 'generateContent') && /image/iu.test(model.id))
    .map(({ id, displayName }) => ({ id, displayName }));
  return { text, live, image };
}

/** The ordinary text models one Gemini key can reach. */
export async function listGeminiProModels(
  apiKey: string,
  signal: AbortSignal,
  keyHint: 'setGeminiKey' | 'setGeminiProKey' = 'setGeminiProKey',
  protections: GeminiModelCatalogProtections = {}
): Promise<GeminiModelOption[]> {
  return (await listGeminiModelCatalog(apiKey, signal, keyHint, protections)).text;
}

/** The bidirectional-streaming models one default Gemini key can reach. */
export async function listGeminiLiveModels(
  apiKey: string,
  signal: AbortSignal,
  keyHint: 'setGeminiKey' | 'setGeminiProKey' = 'setGeminiKey',
  protections: GeminiModelCatalogProtections = {}
): Promise<GeminiModelOption[]> {
  return (await listGeminiModelCatalog(apiKey, signal, keyHint, protections)).live;
}

export async function listGeminiImageModels(apiKey: string, signal: AbortSignal, keyHint: 'setGeminiKey' | 'setGeminiProKey' = 'setGeminiKey'): Promise<GeminiModelOption[]> {
  return (await listGeminiModelCatalog(apiKey, signal, keyHint, {})).image;
}

async function listGeminiModelCatalog(
  apiKey: string,
  signal: AbortSignal,
  keyHint: 'setGeminiKey' | 'setGeminiProKey',
  protections: GeminiModelCatalogProtections
): Promise<GeminiModelCatalog> {
  return geminiModelCatalog(await listGeminiAdvertisedModels(apiKey, signal, keyHint), protections);
}

/** Discovery before picker defaults and stored identifiers are merged in. */
export async function listGeminiAdvertisedModels(
  apiKey: string,
  signal: AbortSignal,
  keyHint: 'setGeminiKey' | 'setGeminiProKey' = 'setGeminiKey',
  strict = false
): Promise<unknown[]> {
  const values: unknown[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'x-goog-api-key': apiKey },
        signal
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ProviderError('Gemini model discovery could not reach Google.', keyHint);
    }

    const payload = (await response.json().catch(() => ({}))) as GeminiModelsPayload;
    if (!response.ok) {
      throw new ProviderError(
        providerHttpError('Gemini', response.status),
        response.status === 401 || response.status === 403 ? keyHint : undefined
      );
    }

    if (strict) providerListedIds(payload, 'models');
    if (Array.isArray(payload.models)) values.push(...payload.models);
    pageToken = typeof payload.nextPageToken === 'string' && payload.nextPageToken
      ? payload.nextPageToken
      : undefined;
  } while (pageToken);

  return values;
}

/**
 * Kept as the single-entry compatibility seam used by older tests and callers. Catalog-level
 * generation and snapshot rules necessarily run in `geminiModelCatalog`, where siblings exist.
 */
export function normalizeProModel(value: unknown): GeminiModelOption | undefined {
  const model = normalizeAdvertisedModel(value);
  if (!model || !isGeminiChatFamily(model.id) || isExcludedModelKind(model.id) ||
      !supportsMethod(model, 'generateContent') || supportsMethod(model, 'bidiGenerateContent')) {
    return undefined;
  }
  return { id: model.id, displayName: model.displayName };
}

function normalizeAdvertisedModel(value: unknown): AdvertisedGeminiModel | undefined {
  if (!isRecord(value)) return undefined;
  const rawName = stringValue(value.name) ?? stringValue(value.baseModelId);
  if (!rawName) return undefined;
  const id = rawName.replace(/^models\//u, '');
  const rawMethods = Array.isArray(value.supportedGenerationMethods)
    ? value.supportedGenerationMethods
    : Array.isArray(value.supportedActions)
      ? value.supportedActions
      : [];
  return {
    id,
    displayName: stringValue(value.displayName) ?? id,
    methods: rawMethods.filter((method): method is string => typeof method === 'string')
  };
}

function supportsMethod(model: AdvertisedGeminiModel, method: string): boolean {
  const expected = method.toLocaleLowerCase('en-US');
  return model.methods.some((value) => value.toLocaleLowerCase('en-US') === expected);
}

/** 2026-09-21: non-Gemini families such as Gemma, LearnLM, AQA and Bison are not KREN chat. */
function isGeminiChatFamily(id: string): boolean {
  return /^gemini-/iu.test(id);
}

/** 2026-09-21: image generation, including Nano Banana, is not a KREN chat model. */
function isImageModel(id: string): boolean {
  return /(?:^|[-_.])image(?:$|[-_.])/iu.test(id);
}

/** 2026-09-21: video generation is not a KREN chat model. */
function isVideoModel(id: string): boolean {
  return /(?:^|[-_.])video(?:$|[-_.])/iu.test(id);
}

/** 2026-09-21: omni models mix unsupported modalities and stay out of both reader lists. */
function isOmniModel(id: string): boolean {
  return /(?:^|[-_.])omni(?:$|[-_.])/iu.test(id);
}

/** 2026-09-21: embeddings do not produce a conversational answer. */
function isEmbeddingModel(id: string): boolean {
  return /(?:^|[-_.])embedding(?:s)?(?:$|[-_.])/iu.test(id);
}

/** 2026-09-21: TTS, audio, and transcription models are not reply-model choices. */
function isSpeechUtilityModel(id: string): boolean {
  return /(?:^|[-_.])(?:tts|audio|transcrib(?:e|er|ing|ption)?)(?:$|[-_.])/iu.test(id);
}

/** 2026-09-21: computer-use models have a different request and safety contract. */
function isComputerUseModel(id: string): boolean {
  return /(?:^|[-_.])computer-use(?:$|[-_.])/iu.test(id);
}

function isExcludedModelKind(id: string): boolean {
  return isImageModel(id) || isVideoModel(id) || isOmniModel(id) ||
    isEmbeddingModel(id) || isSpeechUtilityModel(id) || isComputerUseModel(id);
}

/** 2026-09-21: parse only the documented `gemini-major.minor-tier` shape and fail open otherwise. */
function modelGeneration(id: string): GeminiGeneration | undefined {
  const match = /^gemini-(\d+)\.(\d+)-/iu.exec(id);
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : undefined;
}

/** 2026-09-21: a dated snapshot is redundant only when its undated sibling is present. */
function undatedSnapshotId(id: string): string | undefined {
  const match = /^(.*)-(?:\d{4}-\d{2}-\d{2}|\d{8})$/u.exec(id);
  return match?.[1];
}

function filterCatalogSeries(
  models: GeminiModelOption[],
  advertised: readonly GeminiModelOption[],
  protectedIds: ReadonlySet<string>
): GeminiModelOption[] {
  const advertisedMajors = advertised.map((model) => modelGeneration(model.id)?.major)
    .filter((major): major is number => major !== undefined);
  const highestAdvertised = advertisedMajors.length > 0
    ? Math.max(...advertisedMajors)
    : undefined;
  const defaultMajors = DEFAULT_PRO_MODELS.map((model) => modelGeneration(model.id)?.major)
    .filter((major): major is number => major !== undefined);
  const currentSupportedMajor = Math.max(...defaultMajors);
  // 2026-09-21: the floor follows discovery. The current KREN default is the lower bound;
  // once a newer major appears, its major and predecessor remain without naming either one.
  const floor = highestAdvertised === undefined
    ? currentSupportedMajor
    : Math.max(currentSupportedMajor, highestAdvertised - 1);
  const ids = new Set(models.map((model) => model.id));

  return models.filter((model) => {
    const undated = undatedSnapshotId(model.id);
    if (undated && ids.has(undated) && !protectedIds.has(model.id)) return false;
    const major = modelGeneration(model.id)?.major;
    // Unparseable identifiers deliberately survive future naming changes.
    return major === undefined || major >= floor || protectedIds.has(model.id);
  });
}

function identifiersAsOptions(
  values: readonly string[] | undefined,
  knownLiveOnlyIds: ReadonlySet<string> = new Set()
): GeminiModelOption[] {
  return (values ?? []).filter((id) => isGeminiChatFamily(id) && !isExcludedModelKind(id))
    .map((id) => ({
      id,
      displayName: id,
      ...(knownLiveOnlyIds.has(id) ? { liveOnly: true as const } : {})
    }));
}

/** True only for a capability-classified identifier, never merely for a name containing live. */
export function isKnownGeminiLiveOnlyModel(
  value: string,
  models: readonly GeminiModelOption[]
): boolean {
  const normalized = value.trim().replace(/^models\//u, '');
  return models.some((model) =>
    model.liveOnly === true && model.id.replace(/^models\//u, '') === normalized
  );
}

function deduplicateModels(
  values: GeminiModelOption[],
  preferred: readonly GeminiModelOption[] = DEFAULT_PRO_MODELS
): GeminiModelOption[] {
  const byId = new Map<string, GeminiModelOption>();
  for (const value of values) byId.set(value.id, value);
  return [...byId.values()].sort((left, right) => {
    const leftIndex = preferred.findIndex((item) => item.id === left.id);
    const rightIndex = preferred.findIndex((item) => item.id === right.id);
    if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
    if (leftIndex >= 0) return -1;
    if (rightIndex >= 0) return 1;
    return left.displayName.localeCompare(right.displayName);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
