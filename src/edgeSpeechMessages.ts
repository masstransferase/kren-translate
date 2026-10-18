import { edgeSpeechLocale, resolveEdgeSpeechVoice } from '@kren/core/edge-speech';

/** Renders a locale identifier as the catalog's human label, or as itself when unknown. */
export function edgeSpeechLocaleLabel(id: string): string {
  return edgeSpeechLocale(id)?.label ?? id;
}

/**
 * Names what KREN actually tried, because the generic failure text sent the reader to check
 * the Python command, the edge-tts installation, the voice identifier, and the network when
 * the cause was usually a Language/Region that does not match the text. Every branch below
 * names at least one locale, so the message points at the setting that produced it.
 */
export function edgeSpeechFailureMessage(
  attempted: string,
  retried: string | undefined,
  voice: string
): string {
  if (retried) {
    return `KREN could not speak this text with ${edgeSpeechLocaleLabel(attempted)} or with ` +
      `${edgeSpeechLocaleLabel(retried)}, which it detected from the text itself. Because both ` +
      'locales failed, the cause is not Language/Region: check the Python command, the ' +
      'edge-tts installation, and the network connection.';
  }
  const resolved = resolveEdgeSpeechVoice(attempted, voice) ?? 'its default voice';
  return `KREN could not speak this text with ${edgeSpeechLocaleLabel(attempted)} using ` +
    `${resolved}. Language/Region is already Auto-detect, so KREN has no other locale to try. ` +
    'Set Language/Region to the language of the text, or check the Python command, the ' +
    'edge-tts installation, and the network connection.';
}

/**
 * The sentence shown when the retry succeeded. It says which locale spoke and that the
 * stored choice was left alone, because silently rewriting a setting the reader chose
 * deliberately is worse than speaking once from a resolved one and reporting it.
 */
export function edgeSpeechRetryNotice(attempted: string, used: string): string {
  return `KREN could not speak with ${edgeSpeechLocaleLabel(attempted)}, so it used ` +
    `${edgeSpeechLocaleLabel(used)} instead. Your Language/Region setting is unchanged.`;
}
