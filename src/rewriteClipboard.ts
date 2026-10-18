import { REWRITE_VARIANT_LIST } from './rewriteVariants.js';
import type { KrenOperation } from './operations.js';
import type { KrenResult, RewriteResult } from './types.js';

/**
 * The two commands the owner named: `Rewrite Text: Minimal Rewrite` and
 * `Rewrite Text: Full Rewrite`. `Rewrite Text: Both Variants` is deliberately absent, because
 * it returns two results to choose between and copying one of them would be choosing on the
 * reader's behalf.
 */
export const CLIPBOARD_REWRITE_OPERATIONS: readonly KrenOperation[] =
  ['rewriteMinimal', 'rewriteFull'] as const;

/**
 * Whether this run should go to the clipboard instead of the panel.
 *
 * Keyed on the operation rather than on how many variants the provider returned. 1.7.0 tested
 * `variants.length === 1`, which is a proxy: it is what the provider is supposed to return for
 * a single-variant command, so it reads as equivalent and is not. A proxy that disagrees with
 * the thing it stands for fails silently and falls through to the panel, which is what the
 * owner saw. The operation is decided before the request is sent and no provider can change
 * it.
 */
export function shouldCopyRewriteToClipboard(
  operation: KrenOperation,
  copyToClipboardEnabled: boolean
): boolean {
  return copyToClipboardEnabled && CLIPBOARD_REWRITE_OPERATIONS.includes(operation);
}

/**
 * The text to copy: the variant this operation asked for, found by the same operation-to-variant
 * mapping the provider uses to build the request.
 *
 * Taking `variants[0]` would be right only while the provider returns exactly the one variant
 * requested. If it ever returns both, the first is Minimal, so a Full Rewrite would silently
 * copy the Minimal text. Matching by identifier cannot make that mistake, and falls back to the
 * first variant so a response that omits the identifier still copies something.
 */
export function rewriteClipboardText(
  result: KrenResult,
  operation: KrenOperation
): string | undefined {
  if (result.kind !== 'rewrite') return undefined;
  const rewrite = result as RewriteResult;
  const wanted = REWRITE_VARIANT_LIST.find((variant) => variant.operation === operation)?.id;
  const match = wanted
    ? rewrite.variants.find((variant) => variant.id === wanted)
    : undefined;
  const text = (match ?? rewrite.variants[0])?.text;
  return text && text.trim() ? text : undefined;
}

/**
 * One line for the KREN output channel, written on every rewrite whether or not the route
 * fires. Three rounds of this feature were diagnosed by reading source and reasoning about
 * what must be true, and the reasoning was right about the code and wrong about the running
 * product every time. A line naming the operation, the stored setting, and the decision turns
 * the next report into evidence instead of another inference.
 */
export function describeClipboardDecision(
  operation: KrenOperation,
  copyToClipboardEnabled: boolean,
  result: KrenResult
): string {
  const variants = result.kind === 'rewrite'
    ? (result as RewriteResult).variants.map((variant) => variant.id ?? '?').join(',')
    : 'not a rewrite';
  const fired = shouldCopyRewriteToClipboard(operation, copyToClipboardEnabled);
  const text = fired ? rewriteClipboardText(result, operation) : undefined;
  return `[clipboard] operation=${operation} setting=${copyToClipboardEnabled} ` +
    `variants=[${variants}] route=${fired ? 'clipboard' : 'panel'} ` +
    `copied=${text ? `${text.length} characters` : 'nothing'}`;
}
