import * as vscode from 'vscode';
import { renderResultMarkdown } from './render.js';
import type { KrenResult } from './types.js';

interface CachedHover {
  uri: string;
  version: number;
  range: vscode.Range;
  result: KrenResult;
}

export class HoverStore implements vscode.HoverProvider {
  private cached: CachedHover | undefined;

  public constructor(private readonly assetBaseUri?: vscode.Uri) {}

  public set(
    document: vscode.TextDocument,
    range: vscode.Range,
    result: KrenResult
  ): void {
    this.cached = {
      uri: document.uri.toString(),
      version: document.version,
      range,
      result
    };
  }

  public clear(): void {
    this.cached = undefined;
  }

  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | undefined {
    const cached = this.cached;
    if (
      !cached ||
      cached.uri !== document.uri.toString() ||
      cached.version !== document.version ||
      !cached.range.contains(position)
    ) {
      return undefined;
    }
    return new vscode.Hover(renderResultMarkdown(cached.result, this.assetBaseUri), cached.range);
  }
}
