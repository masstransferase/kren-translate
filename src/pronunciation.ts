const MERRIAM_WEBSTER_AUDIO_HOST = 'media.merriam-webster.com';

export function isAllowedPronunciationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname === MERRIAM_WEBSTER_AUDIO_HOST &&
      url.pathname.startsWith('/audio/prons/en/us/mp3/') &&
      url.pathname.endsWith('.mp3');
  } catch {
    return false;
  }
}
