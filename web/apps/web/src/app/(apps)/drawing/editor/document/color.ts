/**
 * Colour management — profiles, bit depth and HDR.
 *
 * Redesign §5. Three things are described here and each is honest about what
 * this pipeline can and cannot do, because the alternative is a document that
 * *claims* sixteen bits and holds eight.
 *
 * **The working space** is sRGB by default and Display P3 where the browser can
 * give us a wide-gamut canvas. That is a real difference rather than a label:
 * `surfaceFactoryFor` asks for `{ colorSpace: 'display-p3' }` and every buffer
 * the compositor allocates, including the merged image, is then wide-gamut. A
 * browser that does not support it falls back to sRGB and the document says so
 * rather than pretending.
 *
 * **An embedded ICC profile** is stored as bytes on the document and written
 * into the package twice: as an archive entry a reader can find, and as an
 * `iCCP` chunk inside `mergedimage.png`, which is the only place a viewer that
 * knows nothing about OpenRaster will look. `io/png/chunks.ts` does the
 * chunking and `io/icc.ts` reads the profile's own name out of it.
 *
 * **Bit depth is read, not written.** A canvas is eight bits per channel, so
 * encoding a 16-bit PNG out of one would write eight bits padded to sixteen —
 * a file twice the size and not one bit more accurate. What the model does
 * instead is *record* the depth an imported asset arrived with, so a 16-bit
 * source is known to have been one and the loss is visible rather than silent.
 *
 * **HDR is a description plus an SDR preview**, which is exactly what §5 asks
 * for: OpenRaster's merged image is PNG-based, so floating-point HDR cannot be
 * assumed to round-trip, and a reader that does not understand the extension
 * must still see the right picture. The document carries the transfer function
 * and headroom it was authored for, the package carries an SDR `mergedimage.png`
 * declared as the preview, and the compositor stays 8-bit. Nothing here
 * tone-maps an SDR render into a dimmer SDR render to look busy.
 */

export type ColorSpaceName = 'srgb' | 'display-p3';

export const COLOR_SPACE_LABELS: Record<ColorSpaceName, string> = {
  'srgb': 'sRGB',
  'display-p3': 'Display P3',
};

/** The two transfer functions HDR still is actually delivered in. */
export type HdrTransfer = 'pq' | 'hlg';

export interface HdrSettings {
  enabled: boolean;
  transfer: HdrTransfer;
  /**
   * Stops of highlight headroom above SDR white the document is authored for.
   * Carried so a reader that *can* show HDR knows how far the whites go; the
   * SDR preview beside it is what everything else shows.
   */
  headroom: number;
}

export interface ColorProfile {
  /** The display name — the ICC profile's own description where one is embedded. */
  name: string;
  /** An embedded ICC profile, as a `data:application/vnd.iccprofile;base64,…` URL. */
  iccUri?: string;
  /** The working space buffers are allocated in. Absent means sRGB. */
  space?: ColorSpaceName;
  /** Bits per channel the *source* carried. Editing is 8-bit — see above. */
  bitDepth?: 8 | 16;
  hdr?: HdrSettings;
}

export const DEFAULT_COLOR_PROFILE: ColorProfile = { name: 'sRGB', space: 'srgb', bitDepth: 8 };

export const DEFAULT_HDR: HdrSettings = { enabled: false, transfer: 'pq', headroom: 2 };

export const ICC_MIME = 'application/vnd.iccprofile';

export function isColorSpaceName(value: unknown): value is ColorSpaceName {
  return value === 'srgb' || value === 'display-p3';
}

/** The space to allocate buffers in, defaulting rather than throwing on nonsense. */
export function workingSpace(profile: ColorProfile | undefined): ColorSpaceName {
  return isColorSpaceName(profile?.space) ? profile.space : 'srgb';
}

/**
 * Whether this browser will actually give us a canvas in `space`.
 *
 * **Answered once per space and remembered**, because the answer cannot change
 * for the life of the page and the question is asked on the way into every
 * render — a probe allocates a 1×1 canvas, and one per frame during a drag is a
 * canvas per frame for a fact that was settled at load.
 *
 * A browser that ignores the option hands back an sRGB context and reports it
 * in `getContextAttributes`, which is why the answer is read back rather than
 * assumed from the call succeeding.
 */
const colorSpaceSupport = new Map<ColorSpaceName, boolean>();

export function canvasSupportsColorSpace(space: ColorSpaceName): boolean {
  if (space === 'srgb') return true;
  const remembered = colorSpaceSupport.get(space);
  if (remembered !== undefined) return remembered;
  if (typeof document === 'undefined') return false;

  let supported = false;
  try {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    const ctx = probe.getContext('2d', { colorSpace: space } as CanvasRenderingContext2DSettings);
    const attributes = ctx?.getContextAttributes?.() as { colorSpace?: string } | undefined;
    supported = attributes?.colorSpace === space;
  } catch {
    supported = false;
  }
  colorSpaceSupport.set(space, supported);
  return supported;
}

/**
 * A human sentence about what the document is in, for the inspector.
 *
 * Says what is *embedded* rather than what is configured where the two differ,
 * because an embedded profile is the one that travels with the file.
 */
export function describeProfile(profile: ColorProfile): string {
  const parts = [profile.name || COLOR_SPACE_LABELS[workingSpace(profile)]];
  parts.push(`${profile.bitDepth ?? 8}-bit`);
  if (profile.iccUri) parts.push('ICC embedded');
  if (profile.hdr?.enabled) parts.push(`HDR ${profile.hdr.transfer.toUpperCase()}`);
  return parts.join(' · ');
}
