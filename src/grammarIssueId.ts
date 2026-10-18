/**
 * Whether a value is shaped like a grammar finding identifier from any producer.
 *
 * Three modules produce these and every one of them used to recognise only its own format.
 * The Harper worker emits `issue-<n>`; core emits `smart-grammar-<start>-<end>-<index>` for
 * a Smart Grammar correction and `spacing-<start>-<length>` for a spacing repair. The panel
 * validator matched the first only, so Apply and Copy were dropped in silence whenever a
 * Smart Grammar finding was selected. The editor's Quick Fix provider matched the first
 * only, so a Smart Grammar or spacing underline offered no actions at all.
 *
 * This deliberately does not list the three formats. A list here would be a fourth copy of
 * a scheme two other modules own, and it would go stale the next time one is added. An
 * unknown identifier is already harmless everywhere it is consumed, because every consumer
 * looks it up against the identifiers the result actually carries and one that matches
 * nothing selects nothing. What has to be checked is only that the value is a bounded,
 * safe string.
 */
export function isGrammarIssueId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 &&
    value.length <= GRAMMAR_ISSUE_ID_MAX_LENGTH && /^[A-Za-z0-9_-]+$/u.test(value);
}

export const GRAMMAR_ISSUE_ID_MAX_LENGTH = 64;

/**
 * The largest text the panel will carry in one message.
 *
 * Used by the validator that rejects an oversized message and by the `maxlength` on every
 * input that can produce one, so the reader cannot type past the limit and then watch a
 * control do nothing. Those were two numbers until 2026-08-22, and only one of them was
 * enforced anywhere the reader could see.
 */
export const PANEL_TEXT_MAX_LENGTH = 200_000;
