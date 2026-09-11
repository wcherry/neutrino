/**
 * PNG bytes — the parts a canvas cannot put in a file.
 *
 * `chunks` is the pure half (framing, CRC, the IHDR's bit depth, splicing an
 * `iCCP` in) and `deflate` is the one step that needs the platform. Split that
 * way so the format work is testable in jsdom, where `CompressionStream` does
 * not exist and neither does a canvas to make a PNG with.
 */

export {
  buildChunk,
  buildIccpData,
  crc32,
  embedIccProfile,
  hasChunk,
  insertAfterIhdr,
  isPng,
  pngBitDepth,
  readChunks,
} from './chunks';
export type { PngChunk } from './chunks';
export { canDeflate, deflateBytes } from './deflate';
