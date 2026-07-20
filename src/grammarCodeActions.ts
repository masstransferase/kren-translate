import * as vscode from 'vscode';
import type { GrammarIssue, GrammarResult } from './types.js';

export interface GrammarDiagnosticState {
  generation: number;
  uri: string;
  documentVersion: number;
  range: vscode.Range;
  selectedText: string;
  result: GrammarResult;
}

export class GrammarCodeActions implements vscode.CodeActionProvider, vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('kren-grammar');
  private readonly states = new Map<string, GrammarDiagnosticState>();
  private generation = 0;

  public setResult(
    document: vscode.TextDocument,
    range: vscode.Range,
    selectedText: string,
    result: GrammarResult
  ): GrammarDiagnosticState {
    const state: GrammarDiagnosticState = {
      generation: ++this.generation,
      uri: document.uri.toString(),
      documentVersion: document.version,
      range,
      selectedText,
      result
    };
    this.states.set(state.uri, state);
    const baseOffset = document.offsetAt(range.start);
    const diagnostics = result.issues.map((issue) => {
      const issueRange = new vscode.Range(
        document.positionAt(baseOffset + issue.start),
        document.positionAt(baseOffset + issue.end)
      );
      const diagnostic = new vscode.Diagnostic(
        issueRange,
        `${issue.category}: ${issue.message}`,
        vscode.DiagnosticSeverity.Information
      );
      diagnostic.source = 'KREN · Harper';
      diagnostic.code = `kren-grammar:${issue.id}`;
      return diagnostic;
    });
    this.diagnostics.set(document.uri, diagnostics);
    return state;
  }

  public getState(uri: string, generation: number): GrammarDiagnosticState | undefined {
    const state = this.states.get(uri);
    return state?.generation === generation ? state : undefined;
  }

  public clear(uri?: vscode.Uri): void {
    if (uri) {
      this.states.delete(uri.toString());
      this.diagnostics.delete(uri);
      return;
    }
    this.states.clear();
    this.diagnostics.clear();
  }

  public provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const state = this.states.get(document.uri.toString());
    if (!state || state.documentVersion !== document.version) return [];
    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of context.diagnostics) {
      const issueId = grammarIssueId(diagnostic);
      if (!issueId) continue;
      const issue = state.result.issues.find((candidate) => candidate.id === issueId);
      if (!issue) continue;
      issue.suggestions.forEach((suggestion, suggestionIndex) => {
        const action = new vscode.CodeAction(`KREN: ${suggestion.label}`, vscode.CodeActionKind.QuickFix);
        action.diagnostics = [diagnostic];
        action.isPreferred = suggestionIndex === 0;
        action.command = {
          command: 'kren.applyGrammarSuggestion',
          title: suggestion.label,
          arguments: [state.uri, state.generation, issue.id, suggestionIndex]
        };
        actions.push(action);
      });
      const word = dictionaryWord(issue);
      if (word) {
        const action = new vscode.CodeAction(
          `KREN: Add “${word}” to local dictionary`,
          vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];
        action.command = {
          command: 'kren.addGrammarWord',
          title: `Add ${word} to local dictionary`,
          arguments: [state.uri, state.generation, issue.id]
        };
        actions.push(action);
      }
      if (issue.ignoreHash) {
        const action = new vscode.CodeAction(
          'KREN: Ignore this finding',
          vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];
        action.command = {
          command: 'kren.ignoreGrammarFinding',
          title: 'Ignore this grammar finding',
          arguments: [state.uri, state.generation, issue.id]
        };
        actions.push(action);
      }
      actions.push(moreDetailsAction(state, issue, diagnostic));
    }
    return actions;
  }

  public dispose(): void {
    this.states.clear();
    this.diagnostics.dispose();
  }
}

function dictionaryWord(issue: GrammarIssue): string | undefined {
  if (!/spell/iu.test(issue.category)) return undefined;
  const word = issue.original.trim();
  return /^[\p{L}][\p{L}\p{M}'’-]*$/u.test(word) ? word : undefined;
}

function grammarIssueId(diagnostic: vscode.Diagnostic): string | undefined {
  if (diagnostic.source !== 'KREN · Harper' || typeof diagnostic.code !== 'string') {
    return undefined;
  }
  const match = /^kren-grammar:(issue-\d+)$/u.exec(diagnostic.code);
  return match?.[1];
}

function moreDetailsAction(
  state: GrammarDiagnosticState,
  issue: GrammarIssue,
  diagnostic: vscode.Diagnostic
): vscode.CodeAction {
  const action = new vscode.CodeAction('KREN: More details', vscode.CodeActionKind.QuickFix);
  action.diagnostics = [diagnostic];
  action.command = {
    command: 'kren.showGrammarDetails',
    title: 'More details in KREN',
    arguments: [state.uri, state.generation, issue.id]
  };
  return action;
}
