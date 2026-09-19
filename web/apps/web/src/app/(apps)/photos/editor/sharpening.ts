/**
 * Sharpening, by subtracting a blur from the image.
 *
 * Both sharpening controls in the editor are the same operation — an unsharp mask — and differ
 * only in the blur they subtract. Sharpness subtracts an isotropic blur and crisps everything;
 * Deblur subtracts the estimated *motion* kernel and crisps along one axis only.
 *
 * An ordinary sharpen raises local contrast in every direction at once, including the direction
 * the image was already smeared in, so on camera shake it amplifies the smear along with the
 * detail. Motion blur has an axis, and correcting it means sharpening *along that axis only* —
 * subtracting a blur built from the same kernel that caused the damage.
 *
 * This is an unsharp mask whose blur is the estimated motion kernel, not a true deconvolution. It
 * recovers mild smear convincingly and cannot rescue a badly smeared frame; nothing here pretends
 * otherwise, which is why the analysis that drives it reports `recoverable` separately from
 * `blurred`.
 *
 * The work is split because the two halves have very different costs. {@link directionalBlur} is
 * O(pixels × taps) and depends only on the kernel, so it is computed once and cached;
 * {@link unsharpFrom} is O(pixels) and is what a slider drag re-runs.
 */

/** A motion-blur kernel: the axis the image smeared along, and how far. */
export interface DeblurKernel {
  /** Degrees anticlockwise from horizontal, in [0, 180). A smear has no head or tail. */
  angleDegrees: number;
  /** Smear length in pixels of the image being corrected. */
  lengthPx: number;
}

/** A pixel buffer. `ImageData` satisfies this, and so does a plain object in a test. */
export interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Sample offsets along the smear axis, centred on zero.
 *
 * Screen y grows downward while the angle is measured anticlockwise from horizontal, so the y
 * component is negated — without that, a correction for a smear tilted one way is applied tilted
 * the other, which looks like sharpening that makes the photo worse.
 */
export function motionTaps(angleDegrees: number, lengthPx: number): Array<{ dx: number; dy: number }> {
  const n = Math.round(lengthPx);
  // Fewer than two taps is the identity, and there is nothing to subtract.
  if (!Number.isFinite(n) || n < 2) return [];

  const theta = (angleDegrees * Math.PI) / 180;
  const ux = Math.cos(theta);
  const uy = -Math.sin(theta);
  const half = (n - 1) / 2;

  // Math.round(-0.4) is -0, which indexes identically but compares as its own value and reads as a
  // bug in anything that inspects the taps. Normalise it away at the source.
  const offset = (v: number) => (v === 0 ? 0 : v);

  const taps: Array<{ dx: number; dy: number }> = [];
  for (let i = 0; i < n; i++) {
    const t = i - half;
    taps.push({ dx: offset(Math.round(ux * t)), dy: offset(Math.round(uy * t)) });
  }
  return taps;
}

/**
 * Blur `image` along the kernel's axis. Returns a new buffer; the input is untouched.
 *
 * Edges replicate rather than wrap: a tap that falls outside the image is clamped back to the
 * nearest real pixel, so the correction does not pull the opposite edge of the photo into a
 * border.
 */
export function directionalBlur(image: PixelBuffer, kernel: DeblurKernel): Uint8ClampedArray {
  const { data, width, height } = image;
  const out = new Uint8ClampedArray(data);
  const taps = motionTaps(kernel.angleDegrees, kernel.lengthPx);
  if (taps.length < 2) return out;

  const n = taps.length;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let t = 0; t < n; t++) {
        const sx = Math.min(width - 1, Math.max(0, x + taps[t].dx));
        const sy = Math.min(height - 1, Math.max(0, y + taps[t].dy));
        const si = (sy * width + sx) * 4;
        r += data[si];
        g += data[si + 1];
        b += data[si + 2];
      }
      const i = (y * width + x) * 4;
      out[i] = r / n;
      out[i + 1] = g / n;
      out[i + 2] = b / n;
      // Alpha is carried over by the copy. Averaging it would soften a cut-out's edge, which is
      // not what a blurred photograph needs correcting.
    }
  }
  return out;
}

/**
 * Write `original + amount × (original − blurred)` into `dest`.
 *
 * Cheap enough to re-run on every frame of a slider drag, which is the point of keeping it apart
 * from the blur. `Uint8ClampedArray` does the clamping, so an overshoot on a strong correction
 * saturates rather than wrapping around into the opposite tone.
 *
 * A **negative** amount blends towards the blur instead of away from it, which is what makes one
 * primitive serve both halves of a −100…+100 Sharpness slider: at −1 the result is the blurred
 * image exactly.
 */
export function unsharpFrom(
  dest: Uint8ClampedArray,
  original: Uint8ClampedArray,
  blurred: Uint8ClampedArray,
  amount: number,
): void {
  if (!Number.isFinite(amount) || amount === 0) {
    if (dest !== original) dest.set(original);
    return;
  }
  for (let i = 0; i < original.length; i += 4) {
    dest[i] = original[i] + amount * (original[i] - blurred[i]);
    dest[i + 1] = original[i + 1] + amount * (original[i + 1] - blurred[i + 1]);
    dest[i + 2] = original[i + 2] + amount * (original[i + 2] - blurred[i + 2]);
    dest[i + 3] = original[i + 3];
  }
}

/**
 * Sharpen `image` in place along the kernel's axis.
 *
 * The convenience path, for a one-shot apply (an export, or a first render). An interactive slider
 * should cache {@link directionalBlur} against the kernel and call {@link unsharpFrom} per frame
 * instead, since only `amount` changes while dragging.
 */
export function applyDirectionalSharpen(
  image: PixelBuffer,
  kernel: DeblurKernel,
  amount: number,
): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  if (motionTaps(kernel.angleDegrees, kernel.lengthPx).length < 2) return;
  const original = new Uint8ClampedArray(image.data);
  const blurred = directionalBlur(image, kernel);
  unsharpFrom(image.data, original, blurred, amount);
}

/**
 * Convert the slider's 0–100 into the unsharp multiplier.
 *
 * Capped well below the point where the halo around every edge is more visible than the detail it
 * is meant to recover — a correction that announces itself is not a correction.
 */
export function deblurAmountFromSlider(slider: number): number {
  if (!Number.isFinite(slider)) return 0;
  return (Math.min(100, Math.max(0, slider)) / 100) * 1.5;
}

/**
 * Scale a smear length measured on the analysed (downsampled) image up to the image being
 * corrected.
 *
 * The analysis runs on a downsampled copy because a full-resolution photo is a large base64
 * payload, and the kernel it reports is in that copy's pixels. Applying it unscaled would correct
 * a 9-pixel smear on an image where the smear is 36 pixels wide.
 */
export function scaleKernel(kernel: DeblurKernel, analysedWidth: number, targetWidth: number): DeblurKernel {
  if (!Number.isFinite(analysedWidth) || analysedWidth <= 0) return kernel;
  const ratio = targetWidth / analysedWidth;
  return {
    angleDegrees: kernel.angleDegrees,
    lengthPx: kernel.lengthPx * (Number.isFinite(ratio) && ratio > 0 ? ratio : 1),
  };
}

// ── Isotropic sharpening (the Sharpness slider) ──────────────────────────────

/**
 * Box-blur `image` in both axes. Returns a new buffer; the input is untouched.
 *
 * A box blur is separable, and a directional blur along 0° followed by one along 90° *is* that
 * separation — so this reuses {@link directionalBlur} twice rather than carrying a second
 * convolution that could disagree with it about edges or rounding.
 */
export function isotropicBlur(image: PixelBuffer, sizePx: number): Uint8ClampedArray {
  const horizontal = directionalBlur(image, { angleDegrees: 0, lengthPx: sizePx });
  return directionalBlur({ ...image, data: horizontal }, { angleDegrees: 90, lengthPx: sizePx });
}

/**
 * The neighbourhood Sharpness works against, in pixels.
 *
 * Deliberately small: a wide radius produces the halo that reads as "oversharpened" long before it
 * produces more apparent detail. Three pixels is one step out in each direction.
 */
export const SHARPNESS_BLUR_SIZE_PX = 3;

/**
 * Convert the Sharpness slider's −100…+100 into the unsharp multiplier.
 *
 * The two halves are not symmetric because they cannot be: softening is bounded — at −1 the
 * result is exactly the blurred image and there is nowhere further to go — while sharpening past
 * 1 keeps adding contrast. +1.5 is about where the halo starts to cost more than the detail
 * gained.
 */
export function sharpnessAmountFromSlider(slider: number): number {
  if (!Number.isFinite(slider)) return 0;
  const v = Math.min(100, Math.max(-100, slider));
  return v >= 0 ? (v / 100) * 1.5 : v / 100;
}

/**
 * Sharpen (or, for a negative amount, soften) `image` in place.
 *
 * The one-shot path. An interactive slider should cache {@link isotropicBlur} and call
 * {@link unsharpFrom} per frame instead, since only `amount` changes while dragging.
 */
export function applySharpness(image: PixelBuffer, amount: number): void {
  if (!Number.isFinite(amount) || amount === 0) return;
  const original = new Uint8ClampedArray(image.data);
  const blurred = isotropicBlur(image, SHARPNESS_BLUR_SIZE_PX);
  unsharpFrom(image.data, original, blurred, amount);
}
