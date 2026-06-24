// ── Varint codec ──────────────────────────────────────────────────────────────
//
// Shared wire protocol helpers for the y-websocket binary protocol used by
// the backend collab server. Extracted from usePresence, useSheetPresence,
// useSlidePresence, and useDiagramCollab to avoid duplication.

export function writeVarint(n: number): number[] {
  const bytes: number[] = [];
  let value = n;
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return bytes;
}

export function readVarint(data: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < data.length) {
    const byte = data[pos++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return [result, pos];
}

export function readVarBytes(data: Uint8Array, offset: number): [Uint8Array, number] | null {
  const [len, after] = readVarint(data, offset);
  const end = after + len;
  if (end > data.length) return null;
  return [data.slice(after, end), end];
}

// ── Message encoders ──────────────────────────────────────────────────────────

/** Generic type-prefixed message encoder: [varint type] [payload_bytes] */
export function encodeMessage(type: number, payload: Uint8Array): Uint8Array {
  const typeBytes = writeVarint(type);
  const buf = new Uint8Array(typeBytes.length + payload.length);
  buf.set(typeBytes, 0);
  buf.set(payload, typeBytes.length);
  return buf;
}

/**
 * Yjs sync: SyncStep1
 * [varint 0] [varint 0] [varint sv_len] [sv_bytes]
 */
export function encodeSyncStep1(sv: Uint8Array): Uint8Array {
  const msgType = writeVarint(0);  // sync
  const subType = writeVarint(0);  // SyncStep1
  const lenBytes = writeVarint(sv.length);
  const buf = new Uint8Array(msgType.length + subType.length + lenBytes.length + sv.length);
  let off = 0;
  for (const b of [...msgType, ...subType, ...lenBytes]) buf[off++] = b;
  buf.set(sv, off);
  return buf;
}

/**
 * Yjs sync: Update
 * [varint 0] [varint 2] [varint update_len] [update_bytes]
 */
export function encodeUpdate(update: Uint8Array): Uint8Array {
  const msgType = writeVarint(0);  // sync
  const subType = writeVarint(2);  // Update
  const lenBytes = writeVarint(update.length);
  const buf = new Uint8Array(msgType.length + subType.length + lenBytes.length + update.length);
  let off = 0;
  for (const b of [...msgType, ...subType, ...lenBytes]) buf[off++] = b;
  buf.set(update, off);
  return buf;
}

/**
 * Awareness message: [varint 1] [payload_bytes]
 * Equivalent to encodeMessage(1, payload).
 */
export function encodeAwarenessMessage(payload: Uint8Array): Uint8Array {
  return encodeMessage(1, payload);
}

// ── Avatar color helpers ──────────────────────────────────────────────────────
//
// Mirrors Avatar's getColorIndex so presence cursors match avatar chips.
// These colors map to color-0 … color-7 in Avatar.module.css (same order,
// same hash function).

export const AVATAR_TEXT_COLORS = [
  '#1e40af', // color-0 blue
  '#166534', // color-1 green
  '#92400e', // color-2 amber
  '#991b1b', // color-3 red
  '#4c1d95', // color-4 purple
  '#701a75', // color-5 pink
  '#9a3412', // color-6 orange
  '#065f46', // color-7 teal
];

export function colorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_TEXT_COLORS[Math.abs(hash) % AVATAR_TEXT_COLORS.length];
}

// ── Timing constants ──────────────────────────────────────────────────────────

export const HEARTBEAT_INTERVAL_MS = 10_000;
export const STALE_TIMEOUT_MS = 30_000;
export const STALE_CHECK_INTERVAL_MS = 5_000;
