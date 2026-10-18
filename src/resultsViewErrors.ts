export function safePanelErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\bBearer\s+\S+/giu, 'Bearer [redacted]')
    .replace(/([?&](?:api[_-]?key|key|token)=)[^\s&#"'<>}]+/giu, '$1[redacted]')
    .replace(/\b((?:api[_-]?key|key|token|secret)\s*[:=]\s*)[^\s,;]+/giu, '$1[redacted]')
    .replace(/\b(?:AIza[\w-]+|sk-[\w-]+)\b/gu, '[redacted]')
    .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/giu, '[redacted]')
    // Catch-all for opaque tokens the named patterns above do not know about. It requires
    // both a letter and a digit, because a long run of letters alone is a word, not a key.
    // The looser form matched any twenty-character run and so redacted ordinary English,
    // including the dictionary terms and provider messages that make a failure diagnosable.
    // Over-redaction is not the safe direction here: this function exists so that a failure
    // can be read, and a message reduced to "[redacted]" fails at that as surely as a leak.
    .replace(
      /\b(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}\b/gu,
      '[redacted]'
    );
}

export function tutorFailureMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'The request was canceled.';
  return safePanelErrorMessage(error);
}
