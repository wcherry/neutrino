/**
 * Copying a Live Photo still's EXIF onto its new key photo (issue #317): the
 * capture date, GPS, camera and the Apple MakerNote survive; Orientation becomes
 * 1 and the pixel dimensions become the frame's.
 */

import { describe, it, expect } from 'vitest';
import { copyExifToJpeg, extractExifTiff, insertExifIntoJpeg, patchExifTiff } from '../exif';

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** A big-endian writer that can reserve and fill offsets, which is all a TIFF needs. */
class Writer {
  bytes: number[] = [];
  u16(v: number) { this.bytes.push((v >> 8) & 0xff, v & 0xff); }
  u32(v: number) { this.bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff); }
  at() { return this.bytes.length; }
  set32(at: number, v: number) { this.bytes.splice(at, 4, (v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff); }
}

const MAKER_NOTE = [...ascii('Apple iOS\0'), 0, 1, ...ascii('MM'), ...Array.from({ length: 40 }, (_, i) => (i * 13) & 0xff)];
const DATE = ascii('2024:06:01 12:34:56\0');

interface Layout {
  tiff: Uint8Array;
  makerNoteAt: number;
  dateAt: number;
  gpsAt: number;
}

/** An iPhone-shaped EXIF block: IFD0 → Exif IFD (date, MakerNote, pixel size) and GPS, then IFD1. */
function iphoneTiff(): Layout {
  const w = new Writer();
  w.bytes.push(...ascii('MM'));
  w.u16(42);
  w.u32(8);
  const entry = (tag: number, type: number, count: number, value: number) => { w.u16(tag); w.u16(type); w.u32(count); w.u32(value); };

  // IFD0: Make, Orientation, ExifIFD, GPS — with offsets filled in below.
  w.u16(4);
  const makeEntry = w.at(); entry(0x010f, 2, 6, 0);
  entry(0x0112, 3, 1, 6 << 16); // SHORT 6 (rotate 90° CW), left-justified
  const exifEntry = w.at(); entry(0x8769, 4, 1, 0);
  const gpsEntry = w.at(); entry(0x8825, 4, 1, 0);
  const ifd1Link = w.at(); w.u32(0);

  const makeAt = w.at(); w.bytes.push(...ascii('Apple\0'));
  w.set32(makeEntry + 8, makeAt);

  // Exif IFD.
  const exifAt = w.at(); w.set32(exifEntry + 8, exifAt);
  w.u16(4);
  const dateEntry = w.at(); entry(0x9003, 2, DATE.length, 0);
  const noteEntry = w.at(); entry(0x927c, 7, MAKER_NOTE.length, 0);
  entry(0xa002, 3, 1, 4032 << 16);
  entry(0xa003, 3, 1, 3024 << 16);
  w.u32(0);
  const dateAt = w.at(); w.bytes.push(...DATE); w.set32(dateEntry + 8, dateAt);
  const makerNoteAt = w.at(); w.bytes.push(...MAKER_NOTE); w.set32(noteEntry + 8, makerNoteAt);

  // GPS IFD.
  const gpsAt = w.at(); w.set32(gpsEntry + 8, gpsAt);
  w.u16(1); entry(0x0001, 2, 2, ascii('N\0\0\0').reduce((a, b) => a * 256 + b, 0)); w.u32(0);

  // IFD1, the old picture's thumbnail.
  const ifd1At = w.at(); w.set32(ifd1Link, ifd1At);
  w.u16(1); entry(0x0103, 3, 1, 6 << 16); w.u32(0);

  return { tiff: new Uint8Array(w.bytes), makerNoteAt, dateAt, gpsAt };
}

function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

const SCAN = [0xff, 0xda, 0, 4, 1, 2, 9, 9, 9, 0xff, 0xd9];

/** What a canvas encodes: SOI, APP0 JFIF, a table, a scan. */
function canvasJpeg(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, ...segment(0xe0, ascii('JFIF\0\x01\x01')), ...segment(0xdb, [0, 1, 2]), ...SCAN]);
}

function jpegWithExif(tiff: Uint8Array): Uint8Array {
  return new Uint8Array([0xff, 0xd8, ...segment(0xe1, [...ascii('Exif\0\0'), ...tiff]), ...segment(0xdb, [0, 1, 2]), ...SCAN]);
}

/** A HEIC with its Exif as item 2, located by `iloc` in `mdat`. */
function heicWithExif(tiff: Uint8Array): Uint8Array {
  const u32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
  const u16 = (v: number) => [(v >> 8) & 0xff, v & 0xff];
  const box = (type: string, body: number[]) => [...u32(body.length + 8), ...ascii(type), ...body];
  const fullBox = (type: string, version: number, body: number[]) => box(type, [version, 0, 0, 0, ...body]);
  const item = [...u32(6), ...ascii('Exif\0\0'), ...tiff];
  const infe = (id: number, type: string) => fullBox('infe', 2, [...u16(id), ...u16(0), ...ascii(type), 0]);
  const build = (exifOffset: number) => {
    const iinf = fullBox('iinf', 0, [...u16(2), ...infe(1, 'hvc1'), ...infe(2, 'Exif')]);
    // version 0: offset_size 4, length_size 4, base_offset_size 0.
    const iloc = fullBox('iloc', 0, [0x44, 0x00, ...u16(2),
      ...u16(1), ...u16(0), ...u16(1), ...u32(0), ...u32(0),
      ...u16(2), ...u16(0), ...u16(1), ...u32(exifOffset), ...u32(item.length)]);
    const meta = fullBox('meta', 0, [...fullBox('hdlr', 0, [...u32(0), ...ascii('pict'), ...new Array(13).fill(0)]), ...iinf, ...iloc]);
    const ftyp = box('ftyp', [...ascii('heic'), ...u32(0), ...ascii('mif1heic')]);
    return [...ftyp, ...meta];
  };
  const head = build(0);
  const mdatPayloadAt = head.length + 8;
  return new Uint8Array([...build(mdatPayloadAt), ...box('mdat', item)]);
}

const be16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const be32 = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];

/** Value of an inline SHORT tag in the IFD at `ifdAt`. */
function shortTag(tiff: Uint8Array, ifdAt: number, tag: number): number | null {
  const count = be16(tiff, ifdAt);
  for (let i = 0; i < count; i++) {
    const e = ifdAt + 2 + i * 12;
    if (be16(tiff, e) === tag) return be16(tiff, e + 8);
  }
  return null;
}

describe('extractExifTiff', () => {
  it("lifts the TIFF block out of a JPEG's APP1", () => {
    const { tiff } = iphoneTiff();
    expect(extractExifTiff(jpegWithExif(tiff))).toEqual(tiff);
  });

  it("lifts it out of a HEIC's Exif item, past the item's own Exif header", () => {
    const { tiff } = iphoneTiff();
    expect(extractExifTiff(heicWithExif(tiff))).toEqual(tiff);
  });

  it('answers null for an image with none', () => {
    expect(extractExifTiff(canvasJpeg())).toBeNull();
    expect(extractExifTiff(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('patchExifTiff', () => {
  const layout = iphoneTiff();
  const patched = patchExifTiff(layout.tiff, { width: 1440, height: 1080 });
  const exifIfd = be32(patched, 8 + 2 + 2 * 12 + 8);

  it('sets Orientation to 1, because the frame is already upright', () => {
    expect(shortTag(patched, 8, 0x0112)).toBe(1);
  });

  it("sets the pixel dimensions to the frame's", () => {
    expect(shortTag(patched, exifIfd, 0xa002)).toBe(1440);
    expect(shortTag(patched, exifIfd, 0xa003)).toBe(1080);
  });

  it('keeps the capture date, GPS and the Apple MakerNote byte for byte', () => {
    const { makerNoteAt, dateAt, gpsAt } = layout;
    expect(patched.slice(makerNoteAt, makerNoteAt + 50)).toEqual(layout.tiff.slice(makerNoteAt, makerNoteAt + 50));
    expect(patched.slice(dateAt, dateAt + 20)).toEqual(layout.tiff.slice(dateAt, dateAt + 20));
    expect(patched.slice(gpsAt, gpsAt + 18)).toEqual(layout.tiff.slice(gpsAt, gpsAt + 18));
    expect(patched.length).toBe(layout.tiff.length);
  });

  it("cuts the link to IFD1, the old picture's thumbnail", () => {
    expect(be32(patched, 8 + 2 + 4 * 12)).toBe(0);
  });

  it('does not modify its input', () => {
    expect(shortTag(layout.tiff, 8, 0x0112)).toBe(6);
  });
});

describe('copyExifToJpeg', () => {
  it("puts the original's patched EXIF into the canvas JPEG", () => {
    const { tiff } = iphoneTiff();
    const { bytes, copied } = copyExifToJpeg(heicWithExif(tiff), canvasJpeg(), { width: 1440, height: 1080 });
    expect(copied).toBe(true);
    const carried = extractExifTiff(bytes)!;
    expect(shortTag(carried, 8, 0x0112)).toBe(1);
    // The image data after the headers is untouched.
    expect(bytes.slice(bytes.length - SCAN.length)).toEqual(new Uint8Array(SCAN));
  });

  it('replaces EXIF the frame already had rather than adding a second', () => {
    const { tiff } = iphoneTiff();
    const out = insertExifIntoJpeg(jpegWithExif(new Uint8Array([...'MM'].map((c) => c.charCodeAt(0)).concat([0, 42, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0]))), tiff)!;
    const app1s = [...out].filter((b, i) => b === 0xff && out[i + 1] === 0xe1).length;
    expect(app1s).toBe(1);
    expect(extractExifTiff(out)).toEqual(tiff);
  });

  it('copies nothing when the original has no EXIF', () => {
    const frame = canvasJpeg();
    expect(copyExifToJpeg(canvasJpeg(), frame, { width: 1, height: 1 })).toEqual({ bytes: frame, copied: false });
  });

  it('copies nothing rather than writing an APP1 too large to be one', () => {
    const huge = new Uint8Array(70_000);
    huge.set([0x4d, 0x4d, 0, 42, 0, 0, 0, 8]);
    expect(insertExifIntoJpeg(canvasJpeg(), huge)).toBeNull();
    const { copied } = copyExifToJpeg(jpegWithExif(huge.slice(0, 60_000)), canvasJpeg(), { width: 1, height: 1 });
    expect(copied).toBe(true);
  });
});
