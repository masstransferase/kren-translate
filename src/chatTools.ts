import * as vscode from 'vscode';
import { errorMessage } from './errors.js';
import {
  runKrenOperation,
  type KrenOperation,
  type KrenOperationInput,
  type KrenRuntime
} from './operations.js';
import { resultDetails } from './render.js';

interface TextToolInput {
  text: string;
  targetLanguage?: string;
  outputLanguage?: string;
}

const CHAT_TOOLS: ReadonlyArray<{ name: string; operation: KrenOperation }> = [
  { name: 'kren_lookupEnglishDictionary', operation: 'englishDictionary' },
  { name: 'kren_lookupKoreanDictionary', operation: 'koreanDictionary' },
  { name: 'kren_searchSynonyms', operation: 'synonyms' },
  { name: 'kren_translateText', operation: 'translate' },
  { name: 'kren_explainText', operation: 'explain' }
];

export function registerKrenChatTools(
  context: vscode.ExtensionContext,
  runtime: KrenRuntime
): void {
  for (const tool of CHAT_TOOLS) {
    context.subscriptions.push(
      vscode.lm.registerTool(tool.name, new KrenLanguageModelTool(runtime, tool.operation))
    );
  }
}

class KrenLanguageModelTool implements vscode.LanguageModelTool<TextToolInput> {
  public constructor(
    private readonly runtime: KrenRuntime,
    private readonly operation: KrenOperation
  ) {}

  public prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<TextToolInput>
  ): vscode.PreparedToolInvocation {
    const provider = providerDescription(this.runtime, this.operation);
    const message = new vscode.MarkdownString();
    message.appendMarkdown(`KREN will send only the following text to **${provider}**:\n\n`);
    message.appendCodeblock(options.input.text);
    return {
      invocationMessage: progressMessage(this.operation),
      confirmationMessages: {
        title: `Use KREN ${operationLabel(this.operation)}?`,
        message
      }
    };
  }

  public async invoke(
    options: vscode.LanguageModelToolInvocationOptions<TextToolInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());
    const timeoutMs = this.runtime.getSetting<number>('request.timeoutMs', 45000);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const input: KrenOperationInput = { text: options.input.text };
      if (options.input.targetLanguage) input.targetLanguage = options.input.targetLanguage;
      if (options.input.outputLanguage) input.outputLanguage = options.input.outputLanguage;
      const result = await runKrenOperation(
        this.runtime,
        this.operation,
        input,
        controller.signal
      );
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(resultDetails(result)),
        vscode.LanguageModelDataPart.json(result)
      ]);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`KREN ${operationLabel(this.operation)} was cancelled or timed out.`);
      }
      throw new Error(`KREN: ${errorMessage(error)}`);
    } finally {
      clearTimeout(timeout);
      cancellation.dispose();
    }
  }
}

function providerDescription(runtime: KrenRuntime, operation: KrenOperation): string {
  if (operation === 'englishDictionary') {
    return 'Merriam-Webster Collegiate (or Google Cloud Translation when a multi-word expression has no dictionary entry)';
  }
  if (operation === 'koreanDictionary') return 'Korean Basic Dictionary';
  if (operation === 'synonyms') return 'Merriam-Webster Collegiate Thesaurus';
  if (operation === 'explain') {
    const provider = runtime.getSetting<string>('explanation.provider', 'gemini');
    if (provider === 'openai') return 'OpenAI API';
    if (provider === 'anthropic') return 'Anthropic Claude API';
    return 'Gemini';
  }
  return runtime.getSetting<string>('translationProvider', 'googleCloudTranslation') === 'gemini'
    ? 'Gemini'
    : 'Google Cloud Translation';
}

function operationLabel(operation: KrenOperation): string {
  if (operation === 'englishDictionary') return 'English dictionary lookup';
  if (operation === 'koreanDictionary') return 'Korean dictionary lookup';
  if (operation === 'synonyms') return 'synonyms search';
  if (operation === 'explain') return 'meaning/nuance explanation';
  return 'translation';
}

function progressMessage(operation: KrenOperation): string {
  return `KREN is running ${operationLabel(operation)}…`;
}
