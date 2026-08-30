/**
 * Finding and reading the XMP packet that marks a Google Motion Photo.
 *
 * Google's camera writes its motion-photo flags into XMP rather than into any
 * container-native metadata, which is why issue #156 names the fields it does.
 * Two generations exist and both are still in the wild:
 *
 * - **MicroVideo** (Pixel 2–3, `MVIMG_*.jpg`) — `GCamera:MicroVideo="1"` with
 *   `GCamera:MicroVideoOffset` counting *back from the end of the file* to the
 *   start of the embedded MP4.
 * - **MotionPhoto** (Pixel 4 and later, `PXL_*.MP.jpg`) — `GCamera:MotionPhoto="1"`
 *   with the embedded MP4's length in a `Container:Directory` item whose
 *   `Item:Semantic` is `MotionPhoto`.
 *
 * The packet is parsed with regular expressions rather than an XML parser on
 * purpose: it is read from files we did not write, `DOMParser` is not available
 * to every caller, and the handful of fields wanted here are flat scalars that
 * appear either as attributes or as elements depending on who serialised them.
 * Anything unrecognised simply reads as absent.
 */

/** How far into a JPEG to look for the packet. XMP sits in the first segments. */
const MAX_JPEG_SCAN_BYTES = 2 * 1024 * 1024;

/** The namespace header that marks an APP1 segment as carrying XMP. */
const XMP_APP1_HEADER = 'http://ns.adobe.com/xap/1.0/\0';

function decodeAscii(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Pull the XMP packet out of a JPEG's APP1 segments.
 *
 * The scan walks the marker chain and stops at the start of scan (`FFDA`) —
 * everything past it is entropy-coded image data, and on a Motion Photo it is
 * also where the embedded MP4 hides.
 */
export function findXmpInJpeg(bytes: Uint8Array): string | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    // Standalone markers carry no payload.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    // Start of scan: image data from here on.
    if (marker === 0xda) return null;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    const payload = bytes.subarray(offset + 4, offset + 2 + length);
    if (marker === 0xe1 && payload.length > XMP_APP1_HEADER.length) {
      const header = decodeAscii(payload.subarray(0, XMP_APP1_HEADER.length));
      if (header === XMP_APP1_HEADER) {
        return decodeAscii(payload.subarray(XMP_APP1_HEADER.length));
      }
    }
    offset += 2 + length;
  }
  return null;
}

/** Read a JPEG's XMP packet, reading only as far into the file as it can sit. */
export async function readJpegXmp(source: Blob): Promise<string | null> {
  try {
    const head = new Uint8Array(
      await source.slice(0, Math.min(source.size, MAX_JPEG_SCAN_BYTES)).arrayBuffer(),
    );
    return findXmpInJpeg(head);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reading fields out of a packet
// ---------------------------------------------------------------------------

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * One XMP property's value, whether it was serialised as an attribute
 * (`GCamera:MotionPhoto="1"`) or as an element
 * (`<GCamera:MotionPhoto>1</GCamera:MotionPhoto>`).
 */
export function xmpValue(xmp: string, property: string): string | null {
  const name = escapeForRegExp(property);
  const attribute = new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`).exec(xmp);
  if (attribute) return attribute[2].trim();
  const element = new RegExp(`<${name}[^>]*>([^<]*)</${name}>`).exec(xmp);
  return element ? element[1].trim() : null;
}

function xmpNumber(xmp: string, property: string): number | undefined {
  const raw = xmpValue(xmp, property);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** Is this property present and set to something other than "no"? */
function xmpFlag(xmp: string, property: string): boolean {
  const raw = xmpValue(xmp, property);
  return raw !== null && raw !== '0' && raw.toLowerCase() !== 'false';
}

/**
 * The length of the embedded motion clip, from the `Container:Directory` a
 * MotionPhoto v2 file carries.
 *
 * The directory lists the file's parts in order — the primary still, then the
 * video — so the video's `Item:Length` is also its distance back from the end of
 * the file. Attribute order inside the element varies by writer, so the element
 * is matched first and its attributes read afterwards. Both the `Container:` and
 * the older `GContainer:` prefixes appear in real files.
 */
function containerMotionLength(xmp: string): number | undefined {
  const items = xmp.match(/<G?Container:Item\b[^>]*\/?>/g) ?? [];
  for (const item of items) {
    const semantic = /Item:Semantic\s*=\s*(["'])(.*?)\1/.exec(item);
    if (!semantic || semantic[2] !== 'MotionPhoto') continue;
    const length = /Item:Length\s*=\s*(["'])(.*?)\1/.exec(item);
    if (!length) continue;
    const value = Number(length[2]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

export interface GCameraMotion {
  /** Which field classified the file, for import logs and support cases. */
  signal: string;
  /** `GCamera:MotionPhotoVersion` or `GCamera:MicroVideoVersion`. */
  version?: number;
  /** Where in the clip the still frame was taken, in microseconds. */
  presentationTimestampUs?: number;
  /** Bytes from the end of the file to the start of the embedded MP4. */
  videoLengthFromEnd?: number;
}

/**
 * Read Google's motion-photo markers out of an XMP packet, or null if it carries
 * none — which is what keeps an ordinary video an ordinary video.
 */
export function readGCameraMotion(xmp: string): GCameraMotion | null {
  const motionPhoto = xmpFlag(xmp, 'GCamera:MotionPhoto');
  const microVideo = xmpFlag(xmp, 'GCamera:MicroVideo');
  const version = xmpNumber(xmp, 'GCamera:MotionPhotoVersion');
  const microVersion = xmpNumber(xmp, 'GCamera:MicroVideoVersion');

  // A file that carries only the version — some writers drop the flag — is
  // still unambiguously a motion photo, so either one is taken as the signal.
  let signal: string | null = null;
  if (motionPhoto) signal = 'GCamera:MotionPhoto';
  else if (microVideo) signal = 'GCamera:MicroVideo';
  else if (version !== undefined) signal = 'GCamera:MotionPhotoVersion';
  else if (microVersion !== undefined) signal = 'GCamera:MicroVideoVersion';
  if (!signal) return null;

  const presentationTimestampUs =
    xmpNumber(xmp, 'GCamera:MotionPhotoPresentationTimestampUs') ??
    xmpNumber(xmp, 'GCamera:MicroVideoPresentationTimestampUs');

  // v2 states the clip's length in the container directory; v1 states the same
  // distance directly as an offset back from the end of the file.
  const videoLengthFromEnd = containerMotionLength(xmp) ?? xmpNumber(xmp, 'GCamera:MicroVideoOffset');

  const resolvedVersion = version ?? microVersion;
  return {
    signal,
    ...(resolvedVersion !== undefined ? { version: resolvedVersion } : {}),
    ...(presentationTimestampUs !== undefined ? { presentationTimestampUs } : {}),
    ...(videoLengthFromEnd !== undefined && videoLengthFromEnd > 0 ? { videoLengthFromEnd } : {}),
  };
}
