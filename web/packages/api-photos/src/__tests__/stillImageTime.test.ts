/**
 * Apple's `still-image-time` timed metadata track: reading the key frame, and
 * moving it in place (issue #317).
 *
 * These movies are **synthetic**, built to the two layouts the issue expects
 * (an empty edit in `elst`, or a leading filler sample in `stts`). The issue's
 * rule is that real iPhone clips decide which layouts are supported; until
 * trimmed real fixtures are committed beside these, the writer refuses anything
 * that is not exactly one of the two, and these tests pin that refusal down as
 * firmly as the rewrite itself.
 */

import { describe, it, expect } from 'vitest';
import { readQuickTimeBoxes, readStillImageTimeTrack, rewriteStillImageTime } from '../quicktime';
import { readMotionPhotoInfo } from '../motionPhoto';
import { ascii, elstV0, emptyEditLayout, fillerLayout, metaTrack, movie } from './fixtures/liveClip';

/** Byte positions where two equal-length arrays differ. */
function diff(a: Uint8Array, b: Uint8Array): number[] {
  expect(b.length).toBe(a.length);
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

describe('reading the still-image-time track', () => {
  it('reads the key frame from an empty edit in elst', () => {
    expect(readStillImageTimeTrack(movie(emptyEditLayout()).bytes)).toBeCloseTo(1.5);
  });

  it('reads a 64-bit (version 1) edit list', () => {
    expect(readStillImageTimeTrack(movie(emptyEditLayout(1)).bytes)).toBeCloseTo(1.5);
  });

  it('reads the key frame from a leading filler sample in stts', () => {
    expect(readStillImageTimeTrack(movie(fillerLayout()).bytes)).toBeCloseTo(1.2);
  });

  it('finds moov after mdat as well as before it', () => {
    expect(readStillImageTimeTrack(movie(emptyEditLayout(), { trailingMoov: true }).bytes)).toBeCloseTo(1.5);
  });

  it('ignores a metadata track declaring some other key', () => {
    const other = metaTrack({ stts: [[1, 1200], [1, 1800]], mediaTimescale: 1000, duration: 3000, key: 'com.apple.quicktime.live-photo-info' });
    expect(readStillImageTimeTrack(movie(other).bytes)).toBeNull();
  });

  it('answers null for a movie with no metadata track', () => {
    expect(readStillImageTimeTrack(movie([]).bytes)).toBeNull();
  });

  it('is reported by readQuickTimeBoxes from a Blob', async () => {
    const { stillImageTime } = await readQuickTimeBoxes(new Blob([movie(fillerLayout(), { trailingMoov: true }).bytes]));
    expect(stillImageTime).toBeCloseTo(1.2);
  });

  it("wins over the ilst placeholder in readMotionPhotoInfo, so the Original marker sits on it", async () => {
    const built = movie(emptyEditLayout(), { contentIdentifier: true });
    const info = await readMotionPhotoInfo(new Blob([built.bytes]), { fileName: 'IMG_1.MOV', mimeType: 'video/quicktime' });
    expect(info?.subtype).toBe('live_photo_apple');
    expect(info?.stillImageTime).toBeCloseTo(1.5);
  });
});

describe('rewriting the key frame in place', () => {
  it.each([
    ['moov before mdat', false],
    ['moov after mdat', true],
  ])('moves an empty-edit key frame (%s) and touches nothing else', (_label, trailingMoov) => {
    const built = movie(emptyEditLayout(), { trailingMoov });
    const out = rewriteStillImageTime(built.bytes, 0.75)!;

    expect(out).not.toBeNull();
    expect(readStillImageTimeTrack(out)).toBeCloseTo(0.75);
    // Exactly two integers moved: the empty edit and the edit after it.
    const changed = diff(built.bytes, out);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.length).toBeLessThanOrEqual(8);
    // Sample data is byte-identical.
    expect(out.slice(...built.mdat)).toEqual(built.bytes.slice(...built.mdat));
    // The input is not modified.
    expect(readStillImageTimeTrack(built.bytes)).toBeCloseTo(1.5);
  });

  it('keeps the edit list summing to the same duration', () => {
    const built = movie(emptyEditLayout());
    const out = rewriteStillImageTime(built.bytes, 2.25)!;
    expect(readStillImageTimeTrack(out)).toBeCloseTo(2.25);
    // 2.25 s = 1350 at 600/s, so the second edit is 450 — still 1800 in all.
    const view = new DataView(out.buffer);
    const at = tableEntries(out, 'elst');
    expect(view.getUint32(at) + view.getUint32(at + 12)).toBe(1800);
  });

  it('moves a version 1 edit list', () => {
    const out = rewriteStillImageTime(movie(emptyEditLayout(1)).bytes, 0.5)!;
    expect(readStillImageTimeTrack(out)).toBeCloseTo(0.5);
  });

  it('moves a leading-filler key frame and keeps the track length', () => {
    const built = movie(fillerLayout(), { trailingMoov: true });
    const out = rewriteStillImageTime(built.bytes, 2.0)!;
    expect(readStillImageTimeTrack(out)).toBeCloseTo(2.0);
    expect(diff(built.bytes, out).length).toBeLessThanOrEqual(8);
    const view = new DataView(out.buffer);
    // The metadata track's `stts` is the last one in the file; the video's comes first.
    const at = tableEntries(out, 'stts', 'last');
    // Filler + key still 3000 ms.
    expect(view.getUint32(at + 4) + view.getUint32(at + 12)).toBe(3000);
    expect(out.slice(...built.mdat)).toEqual(built.bytes.slice(...built.mdat));
  });

  it('leaves the video chunk offsets alone', () => {
    const built = movie(emptyEditLayout());
    const out = rewriteStillImageTime(built.bytes, 1)!;
    const at = tableEntries(out, 'stco');
    expect(new DataView(out.buffer).getUint32(at)).toBe(built.mdat[0]);
  });

  it('refuses a movie with no still-image-time track', () => {
    expect(rewriteStillImageTime(movie([]).bytes, 1)).toBeNull();
  });

  it('refuses a filler folded into a shared stts entry — it cannot be moved without resizing', () => {
    const folded = metaTrack({ stts: [[2, 1000]], mediaTimescale: 1000, duration: 2000 });
    expect(readStillImageTimeTrack(movie(folded).bytes)).toBeCloseTo(1);
    expect(rewriteStillImageTime(movie(folded).bytes, 0.5)).toBeNull();
  });

  it('refuses an edit list that does not start the key sample at its second edit', () => {
    const odd = metaTrack({ edts: elstV0([[300, 0], [900, 0]]), stts: [[1, 1200], [1, 600]], mediaTimescale: 600, duration: 1800 });
    expect(rewriteStillImageTime(movie(odd).bytes, 1)).toBeNull();
  });

  it('refuses a time at or past the end of the track', () => {
    expect(rewriteStillImageTime(movie(emptyEditLayout()).bytes, 3)).toBeNull();
    expect(rewriteStillImageTime(movie(fillerLayout()).bytes, 3)).toBeNull();
  });

  it('refuses nonsense', () => {
    expect(rewriteStillImageTime(movie(emptyEditLayout()).bytes, -1)).toBeNull();
    expect(rewriteStillImageTime(movie(emptyEditLayout()).bytes, Number.NaN)).toBeNull();
    expect(rewriteStillImageTime(new Uint8Array([1, 2, 3]), 1)).toBeNull();
  });
});

/**
 * Byte offset of the first entry in a full-box table (`elst`, `stts`, `stco`):
 * past the 8-byte box header, 4 bytes of version/flags and the 4-byte count.
 */
function tableEntries(bytes: Uint8Array, type: string, which: 'first' | 'last' = 'first'): number {
  const needle = ascii(type);
  let found = -1;
  outer: for (let i = 4; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    found = i - 4;
    if (which === 'first') break;
  }
  if (found < 0) throw new Error(`no ${type} box`);
  return found + 16;
}
