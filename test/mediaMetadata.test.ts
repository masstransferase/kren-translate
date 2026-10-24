import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

// 2026-10-24: the public icon carried Canva export metadata (author name, account IDs and a
// Content Credentials manifest). Published images keep only the chunks that draw the picture.
const ALLOWED = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'pHYs', 'sRGB', 'gAMA', 'cHRM', 'iCCP', 'bKGD', 'sBIT']);
const media = path.join(__dirname, '..', 'media');

function chunks(file: Buffer): { type: string; data: Buffer }[] {
  const found: { type: string; data: Buffer }[] = [];
  for (let offset = 8; offset < file.length;) {
    const length = file.readUInt32BE(offset);
    found.push({ type: file.toString('latin1', offset + 4, offset + 8), data: file.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return found;
}

describe('published media metadata', () => {
  const images = readdirSync(media).filter((name) => name.endsWith('.png'));

  it('finds the published images', () => {
    expect(images).toContain('kren-icon.png');
  });

  it.each(images)('%s carries no text, Exif, time or provenance chunks', (name) => {
    const file = readFileSync(path.join(media, name));
    expect(file.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const types = chunks(file).map((chunk) => chunk.type);
    expect(types.filter((type) => !ALLOWED.has(type))).toEqual([]);
    expect(file.toString('latin1')).not.toMatch(/fluxome|canva|xmpmeta/iu);
  });

  it('kren-icon.png still decodes', () => {
    const file = readFileSync(path.join(media, 'kren-icon.png'));
    const image = Buffer.concat(chunks(file).filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data));
    expect(inflateSync(image).length).toBeGreaterThan(0);
  });
});
