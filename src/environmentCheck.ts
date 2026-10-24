import { execFile } from 'node:child_process';
import { DEFAULT_GEMINI_MODEL, DEFAULT_PRO_MODELS, listGeminiAdvertisedModels,
  readProviderListedIds, UnreadableProviderListError } from './providers/geminiModels.js';
import { GROQ_MODELS, CLOUDFLARE_TEXT_MODELS, routedModel } from './providers/openAICompatible.js';
import { TUTOR_MODELS, tutorModeModel } from './tutor/models.js';
import { TUTOR_DEFAULTS } from './tutor/defaults.js';
import { TUTOR_LIVE_VOICES } from './tutor/state.js';
import { TUTOR_CONVERSATION_VOICE_PRESETS } from './speech/voiceSelection.js';
import { customModelIdentifiers, READ_ALOUD_EDGE_VOICE_DEFAULT } from './panelSettings.js';

export type EnvironmentStatus = 'ok' | 'update' | 'missing' | 'unknown';
export type EnvironmentName = 'Python' | 'edge-tts' | 'Handy' | 'VS Code' | 'Models' | 'Voices';
export type UpdateFixTarget = 'translation' | 'grammar' | 'explanation' | 'rewrite' | 'userDictionary' | 'tutor' | 'tutorVoice' | 'readAloud';
export interface EnvironmentItem {
  name: string;
  group?: 'System' | 'Models' | 'Voices';
  status: EnvironmentStatus;
  found: string;
  expected: string;
  explanation: string;
  fix?: 'updateEdgeTts' | 'pythonSetting' | 'vscodeUpdate';
  fixTarget?: UpdateFixTarget;
}
export type EnvironmentStatuses = Partial<Record<EnvironmentName, EnvironmentStatus>>;
export interface EnvironmentSnapshot { date: string; statuses: EnvironmentStatuses; availabilityStatuses?: Record<string, EnvironmentStatus> }
export interface EnvironmentStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}
export interface ProcessResult { code: number | null; stdout: string; stderr: string; errorCode?: string }
export type EnvironmentProcessRunner = (command: string, args: string[], timeoutMs: number) => Promise<ProcessResult>;

/** The interpreter is one executable, never shell text, matching WindowsEdgeReadAloudTransport. */
export function environmentPythonCommand(value: string | undefined): string {
  const command = value?.trim();
  return !command || /[\r\n\0]/u.test(command) ? 'python' : command;
}

/** Pip can echo package-index or proxy credentials, so sanitize once before either sink. */
export function sanitizePipErrorLine(line: string): string {
  return line.replace(/[a-z][a-z\d+.-]*:\/\/\S+/giu, '<URL>')
    .replace(/[^\s@]+@/gu, '<credentials>').replace(/[\r\n\0]/gu, ' ').slice(0, 200);
}

export const runEnvironmentProcess: EnvironmentProcessRunner = (command, args, timeoutMs) =>
  new Promise(resolve => {
    execFile(command, args, { shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 },
      (error, stdout, stderr) => resolve({ code: error ? typeof error.code === 'number' ? error.code : null : 0,
        stdout, stderr, errorCode: error ? String(error.code ?? 'PROCESS_FAILED') : undefined }));
  });

const EDGE_VERSION_SCRIPT = 'import importlib.metadata, sys\ntry:\n print(importlib.metadata.version("edge-tts"))\nexcept importlib.metadata.PackageNotFoundError:\n sys.exit(3)';
export const ENVIRONMENT_STATE_KEY = 'kren.updates.environment';
export const EDGE_TTS_PYPI_URL = 'https://pypi.org/pypi/edge-tts/json';

function compareVersions(found: string, expected: string): number {
  if (![found, expected].every(value => /^\d+(?:\.\d+)*$/u.test(value))) throw new Error('The version format could not be compared.');
  const a = found.split('.').map(Number), b = expected.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

class CheckFailure extends Error {}
const RESTRICTED_MODE_REASON = 'Restricted Mode: KREN does not run the configured Python in an untrusted workspace.';

function processFailure(result: ProcessResult): string {
  const code = result.errorCode && /^(?:ENOENT|EACCES|EPERM|ETIMEDOUT|ERR_CHILD_PROCESS_STDIO_MAXBUFFER)$/u.test(result.errorCode)
    ? result.errorCode : result.code === null ? 'process failure' : `exit code ${result.code}`;
  return code;
}

function checkReason(error: unknown, fallback: string): string {
  return error instanceof CheckFailure || error instanceof UnreadableProviderListError ? error.message : fallback;
}

async function bounded<T>(operation: () => PromiseLike<T> | T, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new CheckFailure('The check timed out.')), ms);
    })]);
  } finally { clearTimeout(timer); }
}

export function systemUpdatesAvailable(statuses: EnvironmentStatuses): boolean {
  return (['edge-tts', 'Python', 'VS Code', 'Models', 'Voices'] as const).some(name => statuses[name] === 'update' || statuses[name] === 'missing');
}

export type ModelCheckProvider = keyof typeof TUTOR_MODELS | 'geminiPro';
export interface OfferedName { name: string; feature: string; fixTarget: UpdateFixTarget }
export interface ManualAvailabilityChecks {
  getKey(provider: ModelCheckProvider | 'googleChirp'): PromiseLike<string | undefined>;
  models(): Partial<Record<ModelCheckProvider, OfferedName[]>>;
  edgeVoices(): OfferedName[];
  chirpVoices(): OfferedName[];
  listers: Partial<Record<ModelCheckProvider, (key: string, signal: AbortSignal) => Promise<readonly { id: string }[]>>>;
}

/** Use the existing paginated Gemini discovery, before picker preservation adds absent names. */
export async function listEnvironmentGeminiModels(key: string, signal: AbortSignal): Promise<{ id: string }[]> {
  return (await listGeminiAdvertisedModels(key, signal, 'setGeminiKey', true)).flatMap(value =>
    value && typeof value === 'object' && 'name' in value && typeof value.name === 'string'
      ? [{ id: value.name.replace(/^models\//u, '') }] : []);
}

/** Read effective settings, including manifest defaults, without changing stored choices. */
export function availabilityNames(get: (key: string, fallback: string) => string,
  getDefault: (key: string, fallback: string) => string = (_key, fallback) => fallback) {
  const models: Partial<Record<ModelCheckProvider, OfferedName[]>> = {};
  const add = (provider: ModelCheckProvider, name: string, feature: string, fixTarget: UpdateFixTarget) => {
    const normalized = name.trim().replace(/^models\//u, '');
    if (!normalized) return;
    const choices = models[provider] ??= [];
    if (!choices.some(item => item.name === normalized && item.feature === feature && item.fixTarget === fixTarget))
      choices.push({ name: normalized, feature, fixTarget });
  };
  const owner = (name: string, provider: ModelCheckProvider): ModelCheckProvider =>
    /^(models\/)?gemini-/u.test(name) ? provider === 'geminiPro' ? 'geminiPro' : 'gemini'
      : /^@(?:cf|hf)\//u.test(name) ? 'cloudflare' : /^openai\/|^qwen\//u.test(name) ? 'groq'
        : /^claude-/u.test(name) ? 'anthropic' : /^(gpt-|o\d)/u.test(name) ? 'openai' : provider;
  for (const [prefix, label, target] of [['translation', 'Translation', 'translation'], ['userDictionary', 'User Dictionary', 'userDictionary'],
    ['userDictionary', 'Smart Grammar', 'grammar'], ['explanation', 'Explain', 'explanation'],
    ['rewrite', 'Rewrite Text', 'rewrite'], ['tutor', 'Tutor', 'tutor']] as const) {
    const provider = get(`${prefix}.provider`, 'gemini') as keyof typeof TUTOR_MODELS;
    const profile = get(`${prefix}.geminiProfile`, 'standard');
    const primaryProvider = provider === 'gemini' && profile === 'pro' ? 'geminiPro' : provider;
    const defaultModel = prefix === 'tutor' ? TUTOR_DEFAULTS.configuration['tutor.model'] : DEFAULT_GEMINI_MODEL;
    const raw = get(`${prefix}.model`, defaultModel);
    add(owner(raw, provider), raw, `${label}, stored model`, target);
    add(primaryProvider, routedModel(provider, profile === 'pro' && provider === 'gemini'
      ? get(`${prefix}.alternateModel`, prefix === 'tutor' ? TUTOR_DEFAULTS.configuration['tutor.alternateModel'] : DEFAULT_PRO_MODELS[0]!.id) : raw), label, target);
    const alternate = get(`${prefix}.alternateModel`, prefix === 'tutor' ? TUTOR_DEFAULTS.configuration['tutor.alternateModel'] : DEFAULT_PRO_MODELS[0]!.id);
    add(owner(alternate, 'geminiPro'), alternate, `${label}, paid model`, target);
    const fallback = prefix === 'tutor' ? get('tutor.hintModel', TUTOR_DEFAULTS.configuration['tutor.hintModel'])
      : get(`${prefix}.fallbackModel`, DEFAULT_GEMINI_MODEL);
    add(owner(fallback, primaryProvider), fallback, prefix === 'tutor' ? 'Tutor, Fast model' : `${label}, fallback`, target);
  }
  for (const provider of Object.keys(TUTOR_MODELS) as Array<keyof typeof TUTOR_MODELS>) {
    for (const name of Object.values(TUTOR_MODELS[provider])) add(provider, name, 'Tutor default', 'tutor');
  }
  for (const name of GROQ_MODELS) add('groq', name, 'Routing default', 'tutor');
  for (const name of CLOUDFLARE_TEXT_MODELS) add('cloudflare', name, 'Routing default', 'tutor');
  for (const name of [DEFAULT_GEMINI_MODEL, ...DEFAULT_PRO_MODELS.map(model => model.id)]) {
    add('gemini', name, 'Gemini default', 'tutor'); add('geminiPro', name, 'Gemini default', 'tutor');
  }
  for (const [key, fallback, provider, target] of [
    ['gemini.model', DEFAULT_GEMINI_MODEL, 'gemini', 'grammar'],
    ['gemini.alternateModel', DEFAULT_PRO_MODELS[0]!.id, 'geminiPro', 'grammar'],
    ['gemini.alternateFallbackModel', DEFAULT_GEMINI_MODEL, 'geminiPro', 'grammar'],
    ['openai.model', TUTOR_MODELS.openai.thorough, 'openai', 'grammar'],
    ['anthropic.model', TUTOR_MODELS.anthropic.thorough, 'anthropic', 'grammar'],
    ['tutor.liveModel', TUTOR_DEFAULTS.configuration['tutor.liveModel'], get('tutor.geminiProfile', 'standard') === 'pro' ? 'geminiPro' : 'gemini', 'tutor'],
    ['tutor.imageModel', TUTOR_DEFAULTS.configuration['tutor.imageModel'], 'geminiPro', 'tutor']
  ] as const) add(provider, get(key, fallback), key, target);
  const tutorProvider = get('tutor.provider', 'gemini') as keyof typeof TUTOR_MODELS;
  const tutorGeminiProvider = get('tutor.geminiProfile', 'standard') === 'pro' ? 'geminiPro' : 'gemini';
  const fast = get('tutor.hintModel', TUTOR_DEFAULTS.configuration['tutor.hintModel']);
  add(owner(fast, tutorProvider === 'gemini' ? tutorGeminiProvider : tutorProvider), fast, 'Tutor, stored Fast model', 'tutor');
  add(tutorProvider === 'gemini' ? tutorGeminiProvider : tutorProvider,
    tutorModeModel(tutorProvider, 'fast', fast), 'Tutor, Fast model', 'tutor');
  for (const key of ['tutor.alternateModel', 'tutor.hintModel', 'tutor.liveModel', 'tutor.imageModel'] as const) {
    for (const provider of ['gemini', 'geminiPro'] as const) add(provider, TUTOR_DEFAULTS.configuration[key], `Tutor default, ${key}`, 'tutor');
  }
  for (const provider of ['gemini', 'openai', 'anthropic', 'groq', 'cloudflare'] as const) {
    for (const name of customModelIdentifiers(get(`${provider}.customModels`, '[]'))) {
      add(provider, name, `${provider} custom model list`, 'tutor');
      if (provider === 'gemini') add('geminiPro', name, 'Gemini custom model list', 'tutor');
    }
  }
  for (const [key, provider] of [['tutor.liveCustomModels', tutorGeminiProvider], ['tutor.imageCustomModels', 'geminiPro']] as const)
    for (const name of customModelIdentifiers(get(key, '[]'))) add(provider, name, key, 'tutor');
  add('cloudflare', get('tutor.cloudflareImageModel', TUTOR_DEFAULTS.configuration['tutor.cloudflareImageModel']), 'Tutor picture', 'tutor');
  const edgeVoices: OfferedName[] = Object.values(TUTOR_CONVERSATION_VOICE_PRESETS.edgeOnline).flat()
    .map(name => ({ name, feature: 'Tutor preset', fixTarget: 'tutorVoice' }));
  for (const key of ['tutor.readAloud.edgeVoice', 'tutor.readAloud.edgeFemaleVoice', 'tutor.readAloud.edgeMaleVoice'] as const) {
    edgeVoices.push({ name: get(key, TUTOR_DEFAULTS.configuration[key]), feature: 'Tutor', fixTarget: 'tutorVoice' });
    edgeVoices.push({ name: getDefault(key, TUTOR_DEFAULTS.configuration[key]), feature: 'Default Tutor voice', fixTarget: 'tutorVoice' });
  }
  edgeVoices.push({ name: get('readAloud.edgeVoice', READ_ALOUD_EDGE_VOICE_DEFAULT), feature: 'Read Aloud', fixTarget: 'readAloud' });
  edgeVoices.push({ name: getDefault('readAloud.edgeVoice', READ_ALOUD_EDGE_VOICE_DEFAULT), feature: 'Default Read Aloud voice', fixTarget: 'readAloud' });
  const chirpVoices: OfferedName[] = TUTOR_LIVE_VOICES.map(([name]) => ({ name: `en-US-Chirp3-HD-${name}`, feature: 'Tutor preset', fixTarget: 'tutorVoice' }));
  for (const key of ['tutor.liveFemaleVoice', 'tutor.liveMaleVoice'] as const) {
    chirpVoices.push({ name: `en-US-Chirp3-HD-${get(key, TUTOR_DEFAULTS.configuration[key])}`, feature: 'Tutor', fixTarget: 'tutorVoice' });
    chirpVoices.push({ name: `en-US-Chirp3-HD-${getDefault(key, TUTOR_DEFAULTS.configuration[key])}`, feature: 'Default Tutor voice', fixTarget: 'tutorVoice' });
  }
  chirpVoices.push({ name: `en-US-Chirp3-HD-${get('readAloud.chirpVoice', 'Callirrhoe')}`, feature: 'Read Aloud', fixTarget: 'readAloud' });
  chirpVoices.push({ name: `en-US-Chirp3-HD-${getDefault('readAloud.chirpVoice', 'Callirrhoe')}`, feature: 'Default Read Aloud voice', fixTarget: 'readAloud' });
  return { models, edgeVoices: edgeVoices.filter(voice => voice.name), chirpVoices };
}

export interface EnvironmentCheckOptions {
  pythonCommand(): string;
  trusted?(): boolean;
  vscodeVersion: string;
  vscodeMinimum: string;
  detectHandy(): Promise<string | undefined>;
  dailyEnabled(): boolean;
  store: EnvironmentStore;
  fetch?: typeof fetch;
  runProcess?: EnvironmentProcessRunner;
  timeoutMs?: number;
  now?: () => Date;
  changed?: () => void;
  confirm(command: string): PromiseLike<boolean>;
  progress<T>(task: () => Promise<T>): Promise<T>;
  report(message: string): void;
  log(message: string): void;
  manual?: ManualAvailabilityChecks;
}

/** Owns system checks, menu-only availability checks, the daily gate, and the consent-gated pip action. */
export class EnvironmentChecks {
  items: EnvironmentItem[] = [];
  busy = false;
  private snapshot: EnvironmentSnapshot | undefined;
  private running: Promise<EnvironmentItem[]> | undefined;
  private runningManual = false;
  private dailyRunning: Promise<void> | undefined;
  private updating: Promise<void> | undefined;
  constructor(private readonly options: EnvironmentCheckOptions) {
    this.snapshot = options.store.get<EnvironmentSnapshot>(ENVIRONMENT_STATE_KEY);
    this.items = (['Models', 'Voices'] as const).filter(group => this.statuses[group] === 'update').map(group => ({
      name: group, group, status: 'update', found: 'Updates found by the last menu check', expected: 'Names still offered',
      explanation: 'Choose Check again for details.'
    }));
  }
  get statuses(): EnvironmentStatuses { return this.snapshot?.statuses ?? {}; }
  private get timeout(): number { return this.options.timeoutMs ?? 10_000; }
  private date(): string { return (this.options.now?.() ?? new Date()).toISOString().slice(0, 10); }
  private unknown(name: EnvironmentName, expected: string, explanation: string, found = 'Unknown'): EnvironmentItem {
    return { name, status: 'unknown', found, expected, explanation };
  }
  private process(command: string, args: string[], timeoutMs = this.timeout): Promise<ProcessResult> {
    // Every configured-Python path, including a stale Update action, crosses this guard.
    return bounded(() => {
      if (this.options.trusted?.() === false) throw new CheckFailure(RESTRICTED_MODE_REASON);
      return (this.options.runProcess ?? runEnvironmentProcess)(command, args, timeoutMs);
    }, timeoutMs);
  }
  private async python(command: string): Promise<EnvironmentItem> {
    try {
      const result = await this.process(command, ['--version']);
      if (result.errorCode === 'ENOENT' || result.code === 127 || result.code === 9009) return {
        name: 'Python', status: 'missing', found: 'Not found', expected: 'A Python interpreter',
        explanation: 'Set kren.readAloud.edgePythonCommand to an installed Python interpreter.', fix: 'pythonSetting'
      };
      const version = /Python (\d+(?:\.\d+)+)/u.exec(result.stdout || result.stderr)?.[1];
      if (result.code !== 0) return this.unknown('Python', 'A Python version response', `The Python version probe failed (${processFailure(result)}).`);
      if (!version) return this.unknown('Python', 'A Python version response', 'The configured Python did not return a version.');
      return { name: 'Python', status: 'ok', found: version, expected: 'A Python version response', explanation: 'The configured Python answers with a version.' };
    } catch (error) { return this.unknown('Python', 'A Python version response', checkReason(error, 'The Python version probe could not be run.')); }
  }
  private async edge(command: string, python: EnvironmentItem): Promise<EnvironmentItem> {
    if (python.status !== 'ok') return this.unknown('edge-tts', 'Latest version on PyPI', python.status === 'unknown'
      ? python.explanation : 'edge-tts could not be checked because Python is unavailable.');
    let found = 'Unknown';
    try {
      const installed = await this.process(command, ['-c', EDGE_VERSION_SCRIPT]);
      const missing = installed.code === 3;
      if (installed.code !== 0 && !missing) return this.unknown('edge-tts', 'Latest version on PyPI', `The installed version probe failed (${processFailure(installed)}).`);
      if (!missing && !/^\d+(?:\.\d+)*$/u.test(installed.stdout.trim())) {
        return this.unknown('edge-tts', 'Latest version on PyPI', 'The installed edge-tts version format could not be compared.');
      }
      found = missing ? 'Not installed' : installed.stdout.trim();
      const controller = new AbortController();
      let latest: string;
      try {
        latest = await bounded(async () => {
          const response = await (this.options.fetch ?? fetch)(EDGE_TTS_PYPI_URL,
            { method: 'GET', signal: controller.signal, credentials: 'omit', redirect: 'error' });
          if (!response.ok) throw new CheckFailure(`PyPI returned HTTP ${response.status}.`);
          const body = await response.json() as { info?: { version?: unknown } };
          if (typeof body.info?.version !== 'string' || !/^\d+(?:\.\d+)*$/u.test(body.info.version)) throw new CheckFailure('PyPI did not return a comparable release version.');
          return body.info.version;
        }, this.timeout);
      } finally { controller.abort(); }
      const status = missing ? 'missing' : compareVersions(found, latest) < 0 ? 'update' : 'ok';
      return { name: 'edge-tts', status, found, expected: latest,
        explanation: missing ? 'Install edge-tts to use Edge Online Read Aloud.' : status === 'update'
          ? 'A newer edge-tts version is available on PyPI.' : 'The installed edge-tts is at least as new as the PyPI release.',
        ...(status !== 'ok' ? { fix: 'updateEdgeTts' as const } : {}) };
    } catch (error) { return this.unknown('edge-tts', 'Latest version on PyPI', checkReason(error, 'The installed version or PyPI lookup could not be read.'), found); }
  }
  private async handy(): Promise<EnvironmentItem> {
    try {
      const executable = await bounded(() => this.options.detectHandy(), this.timeout);
      return { name: 'Handy', status: executable ? 'ok' : 'missing', found: executable ? 'Detected' : 'Not found', expected: 'Optional Handy installation',
        explanation: executable ? 'Handy is available for local tutor dictation.' : 'Handy is optional and provides local tutor dictation.' };
    } catch (error) { return this.unknown('Handy', 'Optional Handy installation', checkReason(error, 'Handy detection failed.')); }
  }
  private async vscode(): Promise<EnvironmentItem> {
    try {
      return await bounded(() => {
        const minimum = this.options.vscodeMinimum.replace(/^\^/u, '');
        const status = compareVersions(this.options.vscodeVersion.split('-')[0]!, minimum) < 0 ? 'update' : 'ok';
        return { name: 'VS Code' as const, status, found: this.options.vscodeVersion, expected: minimum,
          explanation: status === 'ok' ? 'VS Code meets the extension minimum.' : 'Update VS Code to meet the extension minimum.',
          ...(status === 'update' ? { fix: 'vscodeUpdate' as const } : {}) };
      }, this.timeout);
    } catch { return this.unknown('VS Code', this.options.vscodeMinimum, 'The VS Code version could not be compared.'); }
  }
  private compareNames(group: 'Models' | 'Voices', name: string, wanted: readonly OfferedName[], offered: readonly string[]): EnvironmentItem[] {
    if (!offered.length || !offered.every(id => typeof id === 'string' && id.trim())) throw new UnreadableProviderListError();
    const available = new Set(offered.map(id => id.replace(/^models\//u, '')));
    const missing = wanted.filter(item => !available.has(item.name));
    this.options.log(`[updates] ${name}: ${new Set(missing.map(item => item.name)).size} missing names.`);
    if (!missing.length) return [{ name, group, status: 'ok', found: `${wanted.length} names checked`, expected: 'Names still offered', explanation: 'All stored and default names checked are offered.' }];
    return missing.map(item => ({ name, group, status: 'update', found: `${item.feature}: ${item.name}`, expected: 'A name still offered',
      explanation: item.feature.startsWith('Default ') ? `${item.feature} ${item.name} is no longer listed.`
        : `${item.feature} uses ${item.name}, which the provider no longer lists.`, fixTarget: item.fixTarget }));
  }
  private async availability(command: string): Promise<EnvironmentItem[]> {
    const manual = this.options.manual;
    if (!manual) return [];
    const wanted = manual.models();
    const providers: ModelCheckProvider[] = ['gemini', 'geminiPro', 'openai', 'anthropic', 'groq', 'cloudflare'];
    const modelChecks = providers.map(async provider => {
      const name = ({ gemini: 'Gemini Free Tier', geminiPro: 'Gemini Paid', openai: 'OpenAI', anthropic: 'Anthropic', groq: 'Groq', cloudflare: 'Cloudflare' })[provider];
      return this.remoteAvailability('Models', name, () => manual.getKey(provider), wanted[provider] ?? [], manual.listers[provider]);
    });
    const edge = (async (): Promise<EnvironmentItem[]> => {
      try {
        const result = await this.process(command,
          ['-c', 'import asyncio, json, edge_tts\nprint(json.dumps([v["ShortName"] for v in asyncio.run(edge_tts.list_voices())]))']);
        if (result.code !== 0) throw new CheckFailure(`The Edge voice probe failed (${processFailure(result)}).`);
        let voices: unknown;
        try { voices = JSON.parse(result.stdout); } catch { throw new UnreadableProviderListError(); }
        if (!Array.isArray(voices) || !voices.every(name => typeof name === 'string')) throw new UnreadableProviderListError();
        return this.compareNames('Voices', 'Edge Online', manual.edgeVoices(), voices);
      } catch (error) { return [{ ...this.unknown('Voices', 'Available Edge voices', checkReason(error, 'The Edge voice list could not be read.')), name: 'Edge Online', group: 'Voices' }]; }
    })();
    const chirp = this.remoteAvailability('Voices', 'Google Cloud Chirp', () => manual.getKey('googleChirp'), manual.chirpVoices(), async (key, signal) => {
      const response = await (this.options.fetch ?? fetch)('https://texttospeech.googleapis.com/v1/voices?languageCode=en-US', {
        method: 'GET', headers: { 'X-Goog-Api-Key': key }, signal, credentials: 'omit', redirect: 'error'
      });
      if (!response.ok) throw new CheckFailure(`Google voice list returned HTTP ${response.status}.`);
      return readProviderListedIds(response, 'voices');
    });
    return (await Promise.all([...modelChecks, edge, chirp])).flat();
  }
  private async remoteAvailability(group: 'Models' | 'Voices', name: string, getKey: () => PromiseLike<string | undefined>,
    wanted: readonly OfferedName[], list: ((key: string, signal: AbortSignal) => Promise<readonly { id: string }[]>) | undefined): Promise<EnvironmentItem[]> {
    const controller = new AbortController();
    try {
      return await bounded(async () => {
        const key = await getKey();
        if (!key) return [{ name, group, status: 'unknown' as const, found: 'Not checked', expected: 'Stored key', explanation: 'No key stored, not checked' }];
        if (!list) return [{ name, group, status: 'unknown' as const, found: 'Not checked', expected: 'Provider model list', explanation: 'Cloudflare not checked: KREN has no model lister.' }];
        return this.compareNames(group, name, wanted, (await list(key, controller.signal)).map(model => model.id));
      }, this.timeout);
    } catch (error) {
      // Provider error messages and bodies are untrusted and can contain credentials.
      return [{ name, group, status: 'unknown', found: 'Unknown', expected: 'Names still offered',
        explanation: checkReason(error, `${name} list failed. Check the stored key, service availability, and connection.`) }];
    } finally { controller.abort(); }
  }
  check(manual = true): Promise<EnvironmentItem[]> {
    if (this.running) return manual && !this.runningManual ? this.running.then(() => this.check()) : this.running;
    this.runningManual = manual;
    this.busy = true;
    this.options.changed?.();
    const command = environmentPythonCommand(this.options.pythonCommand());
    this.running = (async () => {
      const python = this.python(command);
      const [py, edge, handy, editor] = await Promise.all([python, python.then(item => this.edge(command, item)), this.handy(), this.vscode()]);
      const extra = manual ? await this.availability(command) : this.items.filter(item => item.group === 'Models' || item.group === 'Voices');
      this.items = [py, edge, handy, editor, ...extra];
      const statuses: EnvironmentStatuses = { ...this.statuses, Python: py.status, 'edge-tts': edge.status, Handy: handy.status, 'VS Code': editor.status };
      const availabilityStatuses = { ...this.snapshot?.availabilityStatuses };
      for (const group of ['Models', 'Voices'] as const) {
        const items = extra.filter(item => item.group === group);
        if (!items.length) continue;
        for (const name of new Set(items.map(item => item.name))) {
          const results = items.filter(item => item.name === name);
          const key = `${group}:${name}`;
          const status = results.some(item => item.status === 'update') ? 'update' : results.some(item => item.status === 'unknown') ? 'unknown' : 'ok';
          // A failed lookup cannot erase that provider's unresolved notice.
          if (status !== 'unknown' || availabilityStatuses[key] !== 'update') availabilityStatuses[key] = status;
        }
        const values = Object.entries(availabilityStatuses).filter(([key]) => key.startsWith(`${group}:`)).map(([, status]) => status);
        statuses[group] = values.includes('update') ? 'update' : values.includes('unknown') ? 'unknown' : 'ok';
      }
      this.snapshot = { date: this.date(), statuses, ...(Object.keys(availabilityStatuses).length ? { availabilityStatuses } : {}) };
      await Promise.resolve(this.options.store.update(ENVIRONMENT_STATE_KEY, this.snapshot)).catch(() => undefined);
      return this.items;
    })().finally(() => { this.running = undefined; this.busy = false; this.options.changed?.(); });
    return this.running;
  }
  daily(): Promise<void> {
    if (this.dailyRunning) return this.dailyRunning;
    this.dailyRunning = (async () => {
      if (!this.options.dailyEnabled() || this.snapshot?.date === this.date()) return;
      // Claim the date before starting, including across extension host restarts.
      this.snapshot = { ...this.snapshot, date: this.date(), statuses: this.statuses };
      await Promise.resolve(this.options.store.update(ENVIRONMENT_STATE_KEY, this.snapshot)).catch(() => undefined);
      await this.check(false);
    })().finally(() => { this.dailyRunning = undefined; });
    return this.dailyRunning;
  }
  updateEdgeTts(): Promise<void> {
    if (this.updating) return this.updating;
    this.updating = this.performUpdate().finally(() => { this.updating = undefined; });
    return this.updating;
  }
  private async performUpdate(): Promise<void> {
    await this.running;
    if (!this.items.some(item => item.name === 'edge-tts' && item.fix === 'updateEdgeTts')) return;
    const command = environmentPythonCommand(this.options.pythonCommand());
    if (!await this.options.confirm(`"${command}" -m pip install -U edge-tts`)) return;
    this.busy = true;
    this.options.changed?.();
    await this.options.progress(async () => {
      let errorLine: string | undefined;
      try {
        const result = await this.process(command, ['-m', 'pip', 'install', '-U', 'edge-tts'], 120_000);
        if (result.code !== 0) {
          const lines = result.stderr.trim().split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
          errorLine = lines.filter(line => /^ERROR:/iu.test(line)).at(-1) ?? lines.at(-1) ?? `pip failed (${processFailure(result)}) without an error line.`;
        }
      } catch (error) { errorLine = checkReason(error, 'pip could not be started or timed out.'); }
      if (errorLine) {
        // Only this final line is ever exposed, never the rest of pip's output.
        errorLine = sanitizePipErrorLine(errorLine);
        this.options.log(errorLine);
        this.options.report(`edge-tts update failed: ${errorLine}`);
      }
      await this.check(false);
      const item = this.items.find(item => item.name === 'edge-tts')!;
      if (!errorLine) this.options.report(`edge-tts: ${item.status}. ${item.explanation}`);
    });
  }
}
