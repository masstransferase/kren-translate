import { parentPort } from 'node:worker_threads';
import type { Dialect as HarperDialectValue, LocalLinter } from 'harper.js';
import type { GrammarDialect, GrammarIssue, GrammarSuggestion, GrammarSuggestionKind } from '../types.js';
import type {
  HarperCheckPayload,
  HarperWorkerRequest,
  HarperWorkerResponse
} from '../providers/harperWorkerProtocol.js';

type HarperModule = typeof import('harper.js');

if (!parentPort) throw new Error('The KREN grammar worker requires a parent port.');

let linterPromise: Promise<{ linter: LocalLinter; module: HarperModule }> | undefined;
let configuredWords = '';
let configuredIgnoredLints = '';
let queue = Promise.resolve();

parentPort.on('message', (request: HarperWorkerRequest) => {
  queue = queue.then(() => handleRequest(request)).catch((error) => {
    respond({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  });
});

async function handleRequest(request: HarperWorkerRequest): Promise<void> {
  if (request.type === 'dispose') {
    const active = linterPromise ? await linterPromise.catch(() => undefined) : undefined;
    linterPromise = undefined;
    if (active) await active.linter.dispose();
    respond({ id: request.id, ok: true, result: null });
    return;
  }
  const active = await getLinter();
  if (request.type === 'check') {
    await configure(active.linter, request.payload);
    await active.linter.setDialect(harperDialect(active.module, request.payload.dialect));
    respond({ id: request.id, ok: true, result: await lint(active.linter, request.payload.text) });
    return;
  }
  if (request.type === 'addWord') {
    await active.linter.importWords([request.word]);
    const words = await active.linter.exportWords();
    configuredWords = JSON.stringify([...words].sort());
    respond({ id: request.id, ok: true, result: words });
    return;
  }
  if (request.type === 'ignoreLint') {
    await active.linter.ignoreLintHash(BigInt(request.hash));
    configuredIgnoredLints = await active.linter.exportIgnoredLints();
    respond({ id: request.id, ok: true, result: configuredIgnoredLints });
    return;
  }
  if (request.type === 'clearIgnoredLints') {
    await active.linter.clearIgnoredLints();
    configuredIgnoredLints = await active.linter.exportIgnoredLints();
    respond({ id: request.id, ok: true, result: configuredIgnoredLints });
    return;
  }
  await active.linter.clearWords();
  configuredWords = '[]';
  respond({ id: request.id, ok: true, result: [] });
}

async function configure(linter: LocalLinter, payload: HarperCheckPayload): Promise<void> {
  const words = JSON.stringify([...payload.customWords].sort());
  if (words !== configuredWords) {
    await linter.clearWords();
    if (payload.customWords.length) await linter.importWords(payload.customWords);
    configuredWords = words;
  }
  if (payload.ignoredLints !== configuredIgnoredLints) {
    await linter.clearIgnoredLints();
    if (payload.ignoredLints.trim()) await linter.importIgnoredLints(payload.ignoredLints);
    configuredIgnoredLints = payload.ignoredLints;
  }
}

async function lint(linter: LocalLinter, text: string): Promise<GrammarIssue[]> {
  const lints = await linter.lint(text, { language: 'markdown', dedup: true });
  const issues: GrammarIssue[] = [];
  try {
    for (const current of lints) {
      const span = current.span();
      const suggestions = current.suggestions();
      try {
        const normalized = suggestions
          .map((suggestion) => normalizeSuggestion(
            suggestion.kind(), suggestion.get_replacement_text(), current.get_problem_text()
          ))
          .filter((suggestion, index, all) => all.findIndex((candidate) =>
            candidate.kind === suggestion.kind && candidate.replacement === suggestion.replacement
          ) === index);
        issues.push({
          id: `issue-${issues.length + 1}`,
          start: span.start,
          end: span.end,
          original: current.get_problem_text(),
          category: current.lint_kind_pretty() || current.lint_kind(),
          message: current.message(),
          suggestions: normalized,
          ignoreHash: (await linter.contextHash(text, current)).toString()
        });
      } finally {
        span.free();
        suggestions.forEach((suggestion) => suggestion.free());
      }
    }
  } finally {
    lints.forEach((current) => current.free());
  }
  issues.sort((left, right) => left.start - right.start || left.end - right.end);
  issues.forEach((issue, index) => { issue.id = `issue-${index + 1}`; });
  return issues;
}

async function getLinter(): Promise<{ linter: LocalLinter; module: HarperModule }> {
  linterPromise ??= Promise.all([import('harper.js'), import('harper.js/binaryInlined')])
    .then(async ([module, binaryModule]) => {
      const linter = new module.LocalLinter({
        binary: binaryModule.binaryInlined,
        dialect: module.Dialect.American
      });
      await linter.setup();
      return { linter, module };
    });
  return linterPromise;
}

function harperDialect(module: HarperModule, dialect: GrammarDialect): HarperDialectValue {
  if (dialect === 'british') return module.Dialect.British;
  if (dialect === 'australian') return module.Dialect.Australian;
  if (dialect === 'canadian') return module.Dialect.Canadian;
  if (dialect === 'indian') return module.Dialect.Indian;
  return module.Dialect.American;
}

function normalizeSuggestion(kind: number, replacement: string, original: string): GrammarSuggestion {
  const normalizedKind: GrammarSuggestionKind = kind === 1 ? 'remove' : kind === 2 ? 'insertAfter' : 'replace';
  const label = normalizedKind === 'remove'
    ? `Remove “${original}”`
    : normalizedKind === 'insertAfter'
      ? `Add “${replacement}” after “${original}”`
      : `Replace with “${replacement}”`;
  return { kind: normalizedKind, replacement, label };
}

function respond(response: HarperWorkerResponse): void {
  parentPort?.postMessage(response);
}
