import { describe, expect, it } from 'vitest';
import { isAllowedPronunciationUrl } from '../src/pronunciation.js';

describe('pronunciation player', () => {
  const validUrl = 'https://media.merriam-webster.com/audio/prons/en/us/mp3/d/delibe01.mp3';

  it('allows only Merriam-Webster pronunciation MP3 URLs', () => {
    expect(isAllowedPronunciationUrl(validUrl)).toBe(true);
    expect(isAllowedPronunciationUrl('https://example.com/audio.mp3')).toBe(false);
    expect(isAllowedPronunciationUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedPronunciationUrl('https://media.merriam-webster.com/not-audio/file.mp3')).toBe(false);
  });
});
