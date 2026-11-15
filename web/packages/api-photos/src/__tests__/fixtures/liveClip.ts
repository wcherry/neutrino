/**
 * Synthetic QuickTime movies carrying Apple's `still-image-time` timed metadata
 * track, built to the two layouts issue #317 expects. **Not real iPhone
 * clips** — those are still to be committed beside these (see the issue's
 * "Fixtures first"); until then the writer refuses anything else.
 */

import { CONTENT_IDENTIFIER_KEY, STILL_IMAGE_TIME_KEY } from '../../motionPhoto';
import { STILL_IMAGE_TIME_TRACK_KEY } from '../../quicktime';

export const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
const u32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const u16 = (v: number) => [(v >>> 8) & 0xff, v & 0xff];
const u64 = (v: number) => [...u32(Math.floor(v / 0x1_0000_0000)), ...u32(v >>> 0)];
const atom = (type: string, body: number[]) => [...u32(body.length + 8), ...ascii(type), ...body];
const full = (type: string, body: number[], version = 0) => atom(type, [version, 0, 0, 0, ...body]);

function mvhd(timescale: number, duration: number): number[] {
  return full('mvhd', [...u32(0), ...u32(0), ...u32(timescale), ...u32(duration), ...new Array(80).fill(0)]);
}

function mdhd(timescale: number, duration: number): number[] {
  return full('mdhd', [...u32(0), ...u32(0), ...u32(timescale), ...u32(duration), ...u16(0), ...u16(0)]);
}

function hdlr(subtype: string): number[] {
  return full('hdlr', [...ascii('mhlr'), ...ascii(subtype), ...u32(0), ...u32(0), ...u32(0), 0]);
}

function tkhd(duration: number): number[] {
  return full('tkhd', [...u32(0), ...u32(0), ...u32(1), ...u32(0), ...u32(duration), ...new Array(60).fill(0)]);
}

export function elstV0(entries: Array<[number, number]>): number[] {
  return atom('edts', full('elst', [...u32(entries.length), ...entries.flatMap(([d, m]) => [...u32(d), ...u32(m >>> 0), ...u32(0x0001_0000)])]));
}

function elstV1(entries: Array<[number, number]>): number[] {
  return atom(
    'edts',
    full(
      'elst',
      [
        ...u32(entries.length),
        ...entries.flatMap(([d, m]) => [...u64(d), ...(m === -1 ? [...u32(0xffff_ffff), ...u32(0xffff_ffff)] : u64(m)), ...u32(0x0001_0000)]),
      ],
      1,
    ),
  );
}

function stts(entries: Array<[number, number]>): number[] {
  return full('stts', [...u32(entries.length), ...entries.flatMap(([c, d]) => [...u32(c), ...u32(d)])]);
}

/** A `mebx` sample entry declaring `keys` (a plain box of key boxes, each with a `keyd`). */
function mebx(key: string): number[] {
  const keyBox = [...u32(8 + 8 + 4 + key.length + 8 + 8), ...u32(1), ...atom('keyd', [...ascii('mdta'), ...ascii(key)]), ...atom('dtyp', [...u32(0), ...u32(65)])];
  return atom('mebx', [...new Array(6).fill(0), ...u16(1), ...atom('keys', keyBox)]);
}

export function metaTrack(opts: { edts?: number[]; stts: Array<[number, number]>; mediaTimescale: number; key?: string; duration: number }): number[] {
  const stsd = full('stsd', [...u32(1), ...mebx(opts.key ?? STILL_IMAGE_TIME_TRACK_KEY)]);
  const stbl = atom('stbl', [...stsd, ...stts(opts.stts)]);
  return atom('trak', [
    ...tkhd(opts.duration),
    ...(opts.edts ?? []),
    ...atom('mdia', [...mdhd(opts.mediaTimescale, opts.duration), ...hdlr('meta'), ...atom('minf', stbl)]),
  ]);
}

/** A stand-in video track whose `stco` points into `mdat`, so offsets can be checked untouched. */
function videoTrack(chunkOffset: number): number[] {
  const stbl = atom('stbl', [...full('stsd', u32(0)), ...stts([[45, 20]]), ...full('stco', [...u32(1), ...u32(chunkOffset)])]);
  return atom('trak', [...tkhd(1800), ...atom('mdia', [...mdhd(600, 900), ...hdlr('vide'), ...atom('minf', stbl)])]);
}

export const MDAT_PAYLOAD = Array.from({ length: 256 }, (_, i) => (i * 37) & 0xff);

export interface Built {
  bytes: Uint8Array;
  mdat: [number, number];
}

/** ftyp + moov + mdat, or ftyp + mdat + moov. */
export function movie(meta: number[], opts: { trailingMoov?: boolean; contentIdentifier?: boolean } = {}): Built {
  const ftyp = atom('ftyp', [...ascii('qt  '), ...u32(0)]);
  const mdat = atom('mdat', MDAT_PAYLOAD);
  const ilst = opts.contentIdentifier
    ? atom('meta', [
        ...atom('keys', [...u32(0), ...u32(2), ...u32(8 + CONTENT_IDENTIFIER_KEY.length), ...ascii('mdta'), ...ascii(CONTENT_IDENTIFIER_KEY), ...u32(8 + STILL_IMAGE_TIME_KEY.length), ...ascii('mdta'), ...ascii(STILL_IMAGE_TIME_KEY)]),
        ...atom('ilst', [
          ...(() => { const d = atom('data', [...u32(1), ...u32(0), ...ascii('ABC-123')]); return [...u32(d.length + 8), ...u32(1), ...d]; })(),
          // Apple's placeholder, which defers to the timed track.
          ...(() => { const d = atom('data', [...u32(21), ...u32(0), 0xff]); return [...u32(d.length + 8), ...u32(2), ...d]; })(),
        ]),
      ])
    : [];
  // The video chunk offset is wherever mdat's payload lands; work it out from the layout.
  const build = (chunkOffset: number) => atom('moov', [...mvhd(600, 1800), ...videoTrack(chunkOffset), ...meta, ...ilst]);
  const moovLength = build(0).length;
  const mdatStart = opts.trailingMoov ? ftyp.length + 8 : ftyp.length + moovLength + 8;
  const moov = build(mdatStart);
  const bytes = opts.trailingMoov ? [...ftyp, ...mdat, ...moov] : [...ftyp, ...moov, ...mdat];
  return { bytes: new Uint8Array(bytes), mdat: [mdatStart, mdatStart + MDAT_PAYLOAD.length] };
}

export const emptyEditLayout = (version: 0 | 1 = 0) =>
  metaTrack({
    // 1.5 s of nothing, then the one sample for the remaining 1.5 s (movie timescale 600).
    edts: version === 0 ? elstV0([[900, -1], [900, 0]]) : elstV1([[900, -1], [900, 0]]),
    stts: [[1, 900]],
    mediaTimescale: 600,
    duration: 900,
  });

export const fillerLayout = () =>
  metaTrack({
    // Media timescale 1000: a 1.2 s filler, then the key sample.
    stts: [[1, 1200], [1, 1800]],
    mediaTimescale: 1000,
    duration: 3000,
  });

