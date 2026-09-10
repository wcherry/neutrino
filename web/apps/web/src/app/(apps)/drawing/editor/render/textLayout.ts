/**
 * Laying out a text layer — in a box, or along a path.
 *
 * Both layouts are computed here and drawn elsewhere, which is what lets the
 * canvas renderer, the SVG writer and the editor's own caret arithmetic agree
 * about where a glyph sits. Measuring needs a 2D context (`measureText` is the
 * only honest source of a string's width), so the context is a parameter rather
 * than something this module goes looking for.
 *
 * The two layouts are genuinely different shapes and are kept as two functions
 * rather than one with a mode: box layout wraps and produces *lines*, path
 * layout cannot wrap at all and produces *glyphs*, each with its own rotation.
 */

import { normalizeRect } from '../document/geometry';
import { measurePath, positionAt, type MeasuredPath } from '../document/path';
import type { PathObject, TextLayerNode } from '../document/types';

export function textFont(node: TextLayerNode): string {
  const style = node.italic ? 'italic ' : '';
  return `${style}${node.fontWeight} ${node.fontSize}px ${node.fontFamily}`;
}

// ---------------------------------------------------------------------------
// In a box
// ---------------------------------------------------------------------------

export interface TextLine {
  text: string;
  /** Baseline position in canvas coordinates. */
  x: number;
  y: number;
}

/**
 * A text layer broken into positioned lines.
 *
 * Wrapping is greedy on whitespace and honours explicit newlines. A single word
 * wider than the box is left to overflow rather than broken mid-word, which is
 * what every text tool does and what makes a narrow box recoverable by widening
 * it.
 */
export function layoutText(ctx: CanvasRenderingContext2D, node: TextLayerNode): TextLine[] {
  ctx.font = textFont(node);
  const box = normalizeRect(node.box);
  const lineHeight = node.fontSize * node.lineHeight;
  const lines: string[] = [];

  for (const paragraph of node.text.split('\n')) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of paragraph.split(/(\s+)/)) {
      const candidate = current + word;
      if (current && box.width > 0 && ctx.measureText(candidate).width > box.width) {
        lines.push(current.trimEnd());
        current = word.trimStart();
      } else {
        current = candidate;
      }
    }
    lines.push(current.trimEnd());
  }

  return lines.map((text, i) => {
    const width = ctx.measureText(text).width;
    const x =
      node.align === 'center' ? box.x + (box.width - width) / 2 :
      node.align === 'right' ? box.x + box.width - width :
      box.x;
    // The first baseline sits one font size below the box's top, so the box
    // describes the text's top edge rather than its first baseline.
    return { text, x, y: box.y + node.fontSize + i * lineHeight };
  });
}

// ---------------------------------------------------------------------------
// Along a path
// ---------------------------------------------------------------------------

/** One character placed on a path, with the rotation that keeps it upright to the curve. */
export interface PlacedGlyph {
  char: string;
  x: number;
  y: number;
  /** Radians, clockwise, about (`x`, `y`). */
  angle: number;
}

/**
 * A string laid out along a path, one glyph at a time.
 *
 * Per glyph and not per word, because the whole point is that the baseline
 * curves: a word positioned once and drawn straight would leave the path the
 * moment the path turned. The cost is one `measureText` per character, which is
 * why `MeasuredPath` is built once outside the loop.
 *
 * **Newlines are collapsed to spaces.** A path has one baseline and no second
 * line to move to, and dropping the character entirely would silently join two
 * words. Wrapping is likewise not attempted — text longer than the path runs
 * past its end, where the overflow is visible and can be fixed, rather than
 * doubling back over itself.
 */
export function layoutTextOnPath(
  ctx: CanvasRenderingContext2D,
  node: TextLayerNode,
  path: PathObject,
): PlacedGlyph[] {
  const binding = node.textPath;
  if (!binding || !node.text) return [];

  const measured = measurePath(path);
  if (measured.total === 0) return [];

  ctx.font = textFont(node);
  const chars = [...node.text.replace(/\n/g, ' ')];
  const widths = chars.map((char) => ctx.measureText(char).width);
  const textWidth = widths.reduce((total, w) => total + w, 0);

  const start = startDistance(measured, binding.startOffset, binding.align, textWidth);
  // `side: 'right'` walks the path backwards, which is what puts text on the
  // inside of a circle the right way up instead of upside down on the outside.
  const direction = binding.side === 'right' ? -1 : 1;

  const glyphs: PlacedGlyph[] = [];
  let travelled = 0;
  for (let i = 0; i < chars.length; i++) {
    // Each glyph is anchored at its own centre so that a curve rotates it about
    // the point it actually occupies; anchoring at the left edge makes tall
    // characters fan apart on a tight radius.
    const centre = start + direction * (travelled + widths[i] / 2);
    const at = positionAt(measured, centre);
    const angle = at.angle + (direction < 0 ? Math.PI : 0);

    // The baseline offset is perpendicular to the direction of travel. Negative
    // y is "above the path" in canvas coordinates, matching how a baseline
    // shift reads everywhere else.
    const nx = Math.sin(angle) * binding.baselineOffset;
    const ny = -Math.cos(angle) * binding.baselineOffset;

    glyphs.push({
      char: chars[i],
      x: at.point.x - (Math.cos(angle) * widths[i]) / 2 + nx,
      y: at.point.y - (Math.sin(angle) * widths[i]) / 2 + ny,
      angle,
    });
    travelled += widths[i];
  }
  return glyphs;
}

/** Where the run begins, given the offset and how the text is aligned to it. */
function startDistance(
  measured: MeasuredPath,
  startOffset: number,
  align: 'start' | 'middle' | 'end',
  textWidth: number,
): number {
  const anchor = (Math.max(0, Math.min(100, startOffset)) / 100) * measured.total;
  switch (align) {
    case 'middle': return anchor - textWidth / 2;
    case 'end': return anchor - textWidth;
    default: return anchor;
  }
}

/** How much of the path the text needs, as a fraction — over 1 means it overflows. */
export function textPathFill(
  ctx: CanvasRenderingContext2D,
  node: TextLayerNode,
  path: PathObject,
): number {
  const measured = measurePath(path);
  if (measured.total === 0) return Infinity;
  ctx.font = textFont(node);
  return ctx.measureText(node.text.replace(/\n/g, ' ')).width / measured.total;
}
