import path from 'node:path';
import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import type {
  GrammarChoice,
  GrammarDialect,
  GrammarIssue,
  GrammarResult
} from '../types.js';
import type { HarperWorkerRequest, HarperWorkerResponse } from './harperWorkerProtocol.js';
import { applyGrammarChoices as applyCoreGrammarChoices } from '@kren/core/grammar';

interface HarperPreferences {
  customWords: string[];
  ignoredLints: string;
}

let workerClient: HarperWorkerClient | undefined;
let preferences: HarperPreferences = { customWords: [], ignoredLints: '' };

export function configureHarperGrammar(next: Partial<HarperPreferences>): void {
  preferences = {
    customWords: normalizeWords(next.customWords ?? preferences.customWords),
    ignoredLints: next.ignoredLints ?? preferences.ignoredLints
  };
}

/** Starts Harper in its background worker so the first user command avoids cold-start latency. */
export async function warmHarperGrammar(): Promise<void> {
  await client().request<GrammarIssue[]>({
    type: 'check',
    payload: { text: '', dialect: 'american', ...preferences }
  });
}

export async function checkGrammarWithHarper(
  text: string,
  dialect: GrammarDialect,
  signal: AbortSignal
): Promise<GrammarResult> {
  signal.throwIfAborted();
  const issues = await client().request<GrammarIssue[]>({
    type: 'check',
    payload: { text, dialect, ...preferences }
  }, signal);
  signal.throwIfAborted();
  return {
    kind: 'grammar',
    providerId: 'harper',
    sourceText: text,
    sourceLanguage: 'en',
    targetLanguage: 'en',
    createdAt: new Date().toISOString(),
    dialect,
    issues
  };
}

export async function addHarperWord(word: string): Promise<string[]> {
  const normalized = normalizeCustomWord(word);
  if (!normalized) throw new Error('KREN can add only one word containing letters, apostrophes, or hyphens.');
  const words = await client().request<string[]>({ type: 'addWord', word: normalized });
  preferences.customWords = normalizeWords(words);
  return preferences.customWords;
}

export async function ignoreHarperLint(hash: string): Promise<string> {
  if (!/^\d+$/u.test(hash)) throw new Error('That grammar finding cannot be ignored.');
  const ignoredLints = await client().request<string>({ type: 'ignoreLint', hash });
  preferences.ignoredLints = ignoredLints;
  return ignoredLints;
}

export async function clearHarperIgnoredLints(): Promise<void> {
  preferences.ignoredLints = await client().request<string>({ type: 'clearIgnoredLints' });
}

export async function clearHarperWords(): Promise<void> {
  await client().request<string[]>({ type: 'clearWords' });
  preferences.customWords = [];
}

export function applyGrammarChoices(result: GrammarResult, choices: readonly GrammarChoice[]): string {
  return applyCoreGrammarChoices(result, choices);
}

export async function disposeHarperGrammar(): Promise<void> {
  const active = workerClient;
  workerClient = undefined;
  await active?.dispose();
}

export function normalizeCustomWord(word: string): string | undefined {
  const normalized = word.trim();
  return /^[\p{L}][\p{L}\p{M}'’-]*$/u.test(normalized) ? normalized : undefined;
}

function normalizeWords(words: readonly string[]): string[] {
  return [...new Set(words.map(normalizeCustomWord).filter((word): word is string => Boolean(word)))]
    .sort((left, right) => left.localeCompare(right));
}

function client(): HarperWorkerClient {
  workerClient ??= new HarperWorkerClient();
  return workerClient;
}

type RequestWithoutId = HarperWorkerRequest extends infer Request
  ? Request extends { id: number } ? Omit<Request, 'id'> : never
  : never;

class HarperWorkerClient {
  private readonly worker = new Worker(grammarWorkerPath());
  private readonly pending = new Map<number, {
    resolve(value: unknown): void;
    reject(error: Error): void;
  }>();
  private requestId = 0;

  public constructor() {
    this.worker.on('message', (response: HarperWorkerResponse) => {
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new Error(response.error));
    });
    this.worker.on('error', (error) => this.failAll(error));
    this.worker.on('exit', (code) => {
      if (code !== 0) this.failAll(new Error(`KREN grammar worker exited with code ${code}.`));
      if (workerClient === this) workerClient = undefined;
    });
  }

  public request<T>(request: RequestWithoutId, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const id = ++this.requestId;
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id);
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      };
      this.pending.set(id, {
        resolve: (value) => { signal?.removeEventListener('abort', abort); resolve(value as T); },
        reject: (error) => { signal?.removeEventListener('abort', abort); reject(error); }
      });
      signal?.addEventListener('abort', abort, { once: true });
      this.worker.postMessage({ ...request, id } satisfies HarperWorkerRequest);
    });
  }

  public async dispose(): Promise<void> {
    try {
      await this.request({ type: 'dispose' });
    } finally {
      await this.worker.terminate();
      this.failAll(new Error('KREN grammar worker was disposed.'));
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function grammarWorkerPath(): string {
  const bundled = path.join(__dirname, 'grammar-worker.js');
  if (existsSync(bundled)) return bundled;
  return path.resolve(process.cwd(), 'dist', 'grammar-worker.js');
}
