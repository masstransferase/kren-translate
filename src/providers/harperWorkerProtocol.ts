import type { GrammarDialect, GrammarIssue } from '../types.js';

export interface HarperCheckPayload {
  text: string;
  dialect: GrammarDialect;
  customWords: string[];
  ignoredLints: string;
}

export type HarperWorkerRequest =
  | { id: number; type: 'check'; payload: HarperCheckPayload }
  | { id: number; type: 'addWord'; word: string }
  | { id: number; type: 'ignoreLint'; hash: string }
  | { id: number; type: 'clearIgnoredLints' }
  | { id: number; type: 'clearWords' }
  | { id: number; type: 'dispose' };

export type HarperWorkerResponse =
  | { id: number; ok: true; result: GrammarIssue[] | string[] | string | null }
  | { id: number; ok: false; error: string };
