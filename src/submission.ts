import type { KrenOperationInput } from './operations.js';

/** Builds the complete operation input at editor and clipboard trust boundaries. */
export function explicitTextSubmission(text: string): KrenOperationInput {
  return { text };
}
