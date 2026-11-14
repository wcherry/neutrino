// Generates the canonical chunked-file decrypt vectors (`agent_docs/chunked-file-encryption.md`
// §11): `src/__tests__/fixtures/chunked_file_vectors.json`. Every client vendors that file and must
// open every `cases` entry and reject every `rejected` one.
//
// Implements NEB1 and the Photos-chunked shape directly against libsodium rather than importing
// `crypto.ts`, so the vectors are a second implementation the package's own code is checked
// against, not an echo of it.
//
//   node packages/e2e-crypto/scripts/generate-chunked-file-vectors.mjs
//
// secretstream headers are random, so every run produces different bytes; regenerate only when the
// cases change, then copy the file into each client (see the spec, §11.1).
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The CommonJS build: 0.7.16's ESM entry imports a `libsodium.mjs` the package doesn't ship.
const sodium = createRequire(import.meta.url)('libsodium-wrappers');
await sodium.ready;

const A = 17;
const TAG_MESSAGE = sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;
const TAG_FINAL = sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL;

const plaintextOf = (length) => {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (i * 7 + 3) & 0xff;
  return bytes;
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

function prefixFor(chunkSize, length, { version = 1, alg = 1, reserved = 0 } = {}) {
  const prefix = new Uint8Array(20);
  prefix.set([0x4e, 0x45, 0x42, 0x31], 0);
  prefix[4] = version;
  prefix[5] = alg;
  const view = new DataView(prefix.buffer);
  view.setUint16(6, reserved);
  view.setUint32(8, chunkSize >>> 0);
  view.setBigUint64(12, BigInt(length));
  return prefix;
}

/** NEB1 as chunks, so the negative cases can rearrange them. */
function neb1Parts(plain, dek, chunkSize) {
  const P = plain.length;
  const n = Math.max(1, Math.ceil(P / chunkSize));
  const prefix = prefixFor(chunkSize, P);
  const { state, header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(dek);
  const chunks = [];
  for (let i = 0; i < n; i++) {
    const part = plain.subarray(i * chunkSize, Math.min(P, (i + 1) * chunkSize));
    chunks.push(sodium.crypto_secretstream_xchacha20poly1305_push(
      state, part, prefix, i === n - 1 ? TAG_FINAL : TAG_MESSAGE));
  }
  return { prefix, header, chunks };
}
const neb1 = (plain, dek, chunkSize) => {
  const { prefix, header, chunks } = neb1Parts(plain, dek, chunkSize);
  return concat([prefix, header, ...chunks]);
};

/** Photos iOS's `MediaCrypto.encryptStream`: no prefix, no AD. */
function photosParts(plain, dek, chunkSize) {
  const n = Math.max(1, Math.ceil(plain.length / chunkSize));
  const { state, header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(dek);
  const chunks = [];
  for (let i = 0; i < n; i++) {
    const part = plain.subarray(i * chunkSize, Math.min(plain.length, (i + 1) * chunkSize));
    chunks.push(sodium.crypto_secretstream_xchacha20poly1305_push(
      state, part, null, i === n - 1 ? TAG_FINAL : TAG_MESSAGE));
  }
  return { header, chunks };
}
const photos = (plain, dek, chunkSize) => {
  const { header, chunks } = photosParts(plain, dek, chunkSize);
  return concat([header, ...chunks]);
};

/** Today's single push, with the header `init_push` would have chosen at random — or one we pick. */
function v0(plain, dek, header = null) {
  if (header) {
    // push and pull states are the same structure, so a state set up from a chosen header pushes
    // exactly what `init_push` would have with that header.
    const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, dek);
    return concat([header, sodium.crypto_secretstream_xchacha20poly1305_push(state, plain, null, TAG_FINAL)]);
  }
  const { state, header: h } = sodium.crypto_secretstream_xchacha20poly1305_init_push(dek);
  return concat([h, sodium.crypto_secretstream_xchacha20poly1305_push(state, plain, null, TAG_FINAL)]);
}

const dek = sodium.crypto_secretstream_xchacha20poly1305_keygen();
const otherDek = sodium.crypto_secretstream_xchacha20poly1305_keygen();
const MiB = 1 << 20;

const cases = [];
const add = (name, shape, length, ciphertext, chunkSize) =>
  cases.push({ name, shape, length, ...(chunkSize ? { chunkSize } : {}), sha256: sha256(plaintextOf(length)), ciphertext: b64(ciphertext) });

add('neb1-empty', 'neb1', 0, neb1(plaintextOf(0), dek, 4096));
add('neb1-single', 'neb1', 100, neb1(plaintextOf(100), dek, 4096));
add('neb1-exact', 'neb1', 8192, neb1(plaintextOf(8192), dek, 4096));
add('neb1-multi', 'neb1', 10000, neb1(plaintextOf(10000), dek, 4096));
add('neb1-1mib', 'neb1', MiB + 7, neb1(plaintextOf(MiB + 7), dek, MiB));
// `chunkSize` here is the metadata a reader would be given. Photos writes 1 MiB; the small sizes
// are what a reader with the metadata must honour.
add('photos-multi', 'photos-chunked', 1000, photos(plaintextOf(1000), dek, 256), 256);
add('photos-exact', 'photos-chunked', 1024, photos(plaintextOf(1024), dek, 256), 256);
add('photos-single-is-v0', 'photos-chunked', 100, photos(plaintextOf(100), dek, 256), 256);
// Read with *and* without the metadata: a reader that has none retries at 1 MiB.
add('photos-1mib', 'photos-chunked', MiB + 7, photos(plaintextOf(MiB + 7), dek, MiB), MiB);
add('v0-legacy', 'v0', 5000, v0(plaintextOf(5000), dek));
// A v0 header that begins `NEB1` with a version byte no NEB1 reader accepts: a structural
// rejection that must fall through and decrypt as v0 (§3.5).
const collision = concat([new Uint8Array([0x4e, 0x45, 0x42, 0x31, 0x02]), sodium.randombytes_buf(19)]);
add('v0-magic-collision', 'v0', 5000, v0(plaintextOf(5000), dek, collision));

const rejected = [];
const reject = (name, ciphertext, extra = {}) => rejected.push({ name, ciphertext: b64(ciphertext), ...extra });

{
  const plain = plaintextOf(10000);
  const { prefix, header, chunks } = neb1Parts(plain, dek, 4096);
  const whole = concat([prefix, header, ...chunks]);
  reject('neb1-truncated-final-chunk', whole.subarray(0, whole.length - 5));
  const shorter = prefixFor(4096, 10000 - 4096);
  reject('neb1-chunk-removed-length-rewritten', concat([shorter, header, chunks[0], chunks[2]]));
  reject('neb1-chunks-swapped', concat([prefix, header, chunks[1], chunks[0], chunks[2]]));
  const flipped = whole.slice(); flipped[100] ^= 0x01;
  reject('neb1-byte-flipped', flipped);
  const altered = whole.slice(); new DataView(altered.buffer).setUint32(8, 8192);
  reject('neb1-chunksize-altered', altered);
  const reserved = whole.slice(); reserved[7] = 0x01;
  reject('neb1-reserved-nonzero', reserved);
  const alg2 = whole.slice(); alg2[5] = 0x02;
  reject('neb1-alg-unimplemented', alg2);
  reject('neb1-chunksize-below-floor', neb1Small(plaintextOf(3000)));
  const huge = whole.slice(); new DataView(huge.buffer).setUint32(8, 0x40000000);
  reject('neb1-chunksize-above-ceiling', huge);
  reject('neb1-wrong-dek', whole, { dek: b64(otherDek) });
}
{
  const plain = plaintextOf(1000);
  const { header, chunks } = photosParts(plain, dek, 256);
  reject('photos-final-chunk-missing', concat([header, ...chunks.slice(0, -1)]), { chunkSize: 256 });
  reject('photos-bytes-appended', concat([header, ...chunks, new Uint8Array([1, 2, 3])]), { chunkSize: 256 });
  reject('photos-chunks-swapped', concat([header, chunks[1], chunks[0], ...chunks.slice(2)]), { chunkSize: 256 });
}

/** NEB1 framing with a 1024-byte chunk, below the floor: well-formed except for that. */
function neb1Small(plain) {
  const C = 1024;
  const n = Math.ceil(plain.length / C);
  const prefix = prefixFor(C, plain.length);
  const { state, header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(dek);
  const chunks = [];
  for (let i = 0; i < n; i++) {
    chunks.push(sodium.crypto_secretstream_xchacha20poly1305_push(
      state, plain.subarray(i * C, (i + 1) * C), prefix, i === n - 1 ? TAG_FINAL : TAG_MESSAGE));
  }
  return concat([prefix, header, ...chunks]);
}

const out = {
  comment: 'Canonical chunked-file decrypt vectors; see agent_docs/chunked-file-encryption.md §11. ' +
    'Generated by packages/e2e-crypto/scripts/generate-chunked-file-vectors.mjs (libsodium-wrappers). ' +
    'Plaintext byte i = (i*7+3) & 0xff; sha256 is of the plaintext. Keys and ciphertext are standard base64. ' +
    'Every case must decrypt (with `chunkSize` as the file metadata where given) and every rejected entry must fail, ' +
    'using `dek` unless the entry names its own. This copy in neutrino is the only editable one.',
  dek: b64(dek),
  cases,
  rejected,
};
const target = fileURLToPath(new URL('../src/__tests__/fixtures/chunked_file_vectors.json', import.meta.url));
writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${cases.length} cases and ${rejected.length} rejections to ${target}`);
