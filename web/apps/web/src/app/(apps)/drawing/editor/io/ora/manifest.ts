/**
 * `META-INF/neutrino/document.json` — everything OpenRaster cannot say.
 *
 * The redesign's central rule is that every advanced feature gets both a
 * Neutrino description and a rendered fallback (`agent_docs/drawing_app_redesign.md`,
 * closing paragraph). `stack.xml` and the PNGs beside it are the fallback; this
 * file is the description, and it is *complete* — it carries the whole document
 * model verbatim, so reopening a `.ora` written here loses nothing at all,
 * while any other OpenRaster reader ignores the file and still sees the right
 * picture.
 *
 * Carrying the whole model rather than a diff against `stack.xml` is a
 * deliberate trade. It duplicates layer names, opacities and blend modes, at a
 * cost of a few kilobytes of JSON inside a package whose PNGs are measured in
 * megabytes. What it buys is that the reader has exactly one thing to parse for
 * a Neutrino-written file, and that adding a field to the model never needs a
 * matching change here.
 *
 * `masks` and `assets` are the two things that are *not* in the model, because
 * they only exist once the package is being written: which archive entry each
 * node was rasterised into, and where each mask's channel went. `maskFor` is
 * the shape §3 of the redesign specifies.
 */

import { APPLICATION_NAME, APPLICATION_VERSION } from '../../document/factory';
import { isActiveFilter } from '../../document/filters';
import type { AdjustmentKind } from '../../document/adjustments';
import type { FilterKind } from '../../document/filters';
import type { HdrTransfer } from '../../document/color';
import type { DrawingDocument, DrawingNode, LayerMask } from '../../document/types';
import type { LayerAsset } from './stackXml';

/** Where a node's rasterised PNG landed, and what it was rasterised *from*. */
export interface AssetEntry {
  nodeId: string;
  src: string;
  x: number;
  y: number;
  /**
   * The node type behind the PNG. A `vector` or `text` entry is the flag that
   * says "these pixels are a rendering, and the editable original is in
   * `document`" — which is what stops a reader treating a rasterised text layer
   * as a raster layer and quietly discarding the text on the next save.
   */
  renderedFrom: DrawingNode['type'];
}

/** The relationship entry redesign §3 specifies for a mask. */
export interface MaskEntry {
  maskFor: string;
  maskSource: string | null;
  mode: LayerMask['kind'];
  inverted: boolean;
  enabled: boolean;
}

/**
 * An adjustment layer and where its rendered fallback is.
 *
 * Redesign §4 asks for three things and this entry is the first of them: the
 * parameters are in `document`, the **rendered fallback is
 * `mergedimage.png`** — the merged result, which is composited through the
 * adjustment like everything else — and **the source layers are unchanged**,
 * because an adjustment layer writes no pixels into the layers below it and the
 * `data/layer-*.png` beside it are the originals. A reader that ignores this
 * file sees the corrected picture in the merged image and the uncorrected
 * layers under it, which is the only honest answer a format with no adjustment
 * layer can give.
 */
export interface AdjustmentEntry {
  nodeId: string;
  kind: AdjustmentKind;
  /** The archive entry showing the result. Always the merged image. */
  renderedFallback: string;
}

/**
 * A layer's filter chain, and the PNG its result was baked into.
 *
 * The fallback here is per-layer rather than the merged image, because a filter
 * belongs to one layer and `data/layer-*.png` is rendered *through* it — so a
 * reader that knows nothing about filters opens a blurred layer already
 * blurred, in the right place, with the right alpha.
 */
export interface FilterEntry {
  nodeId: string;
  kinds: FilterKind[];
  renderedInto: string | null;
}

/** The document's colour, and where the profile went. */
export interface ColorEntry {
  space: string;
  bitDepth: number;
  /** The archive entry holding the ICC profile, or null when none is embedded. */
  icc: string | null;
  /**
   * `mergedimage.png` is PNG-based and therefore SDR, so an HDR document names
   * it as the preview a reader without HDR should show — redesign §5's "include
   * an SDR preview and merged image". The compositor is 8-bit, so this
   * describes the document's intent rather than carrying HDR samples.
   */
  hdr: { transfer: HdrTransfer; headroom: number; sdrPreview: string } | null;
}

export interface NeutrinoManifest {
  application: { name: string; version: string };
  /**
   * Bumped when the *manifest's* shape changes, independently of the
   * document's.
   *
   * Still 1 after phases 3–8. What they added — a `selection` entry,
   * `renderedFrom: 'instance'` among the asset entries, and the `adjustments`,
   * `filters` and `color` blocks below — is additive, and the reader ignores
   * fields it does not know, so a manifest written before them and one written
   * after are both readable by both. The number exists for a change that would
   * *break* that, and none of these was one.
   */
  manifestVersion: 1;
  /** The document model, verbatim — guides, grid, symbols, viewport and all. */
  document: DrawingDocument;
  assets: AssetEntry[];
  masks: MaskEntry[];
  /**
   * Where the active selection's grayscale channel landed, or null when
   * nothing was selected. The shape itself is in `document.selection`; this is
   * the rendered fallback beside it, so an application that knows nothing about
   * Neutrino can still see what was selected.
   */
  selection: string | null;
  adjustments: AdjustmentEntry[];
  filters: FilterEntry[];
  color: ColorEntry;
}

export const MANIFEST_PATH = 'META-INF/neutrino/document.json';

/** Where the active selection's channel is written inside the archive. */
export const SELECTION_PATH = 'data/selection.png';

/** Where an embedded ICC profile is written inside the archive. */
export const ICC_PATH = 'META-INF/neutrino/color.icc';

/** The archive entry every rendered fallback that is not per-layer points at. */
export const MERGED_PATH = 'mergedimage.png';

export function buildManifest(
  doc: DrawingDocument,
  assets: ReadonlyMap<string, LayerAsset>,
  maskSources: ReadonlyMap<string, string>,
  extras: { selection?: string | null; icc?: string | null } = {},
): NeutrinoManifest {
  const assetEntries: AssetEntry[] = [];
  const maskEntries: MaskEntry[] = [];
  const adjustmentEntries: AdjustmentEntry[] = [];
  const filterEntries: FilterEntry[] = [];

  const walk = (node: DrawingNode): void => {
    const asset = assets.get(node.id);
    if (asset) {
      assetEntries.push({
        nodeId: node.id,
        src: asset.src,
        x: asset.x,
        y: asset.y,
        renderedFrom: node.type,
      });
    }
    if (node.mask) {
      maskEntries.push({
        maskFor: node.id,
        maskSource: maskSources.get(node.mask.id) ?? null,
        mode: node.mask.kind,
        inverted: node.mask.inverted,
        enabled: node.mask.enabled,
      });
    }
    if (node.type === 'adjustment') {
      adjustmentEntries.push({
        nodeId: node.id,
        kind: node.adjustment.kind,
        renderedFallback: MERGED_PATH,
      });
    }
    const active = node.filters?.filter(isActiveFilter) ?? [];
    if (active.length > 0) {
      filterEntries.push({
        nodeId: node.id,
        kinds: active.map((filter) => filter.kind),
        renderedInto: asset?.src ?? null,
      });
    }
    if (node.type === 'stack') node.children.forEach(walk);
  };
  doc.root.children.forEach(walk);

  const profile = doc.colorProfile;
  const hdr = profile.hdr?.enabled ? profile.hdr : null;

  return {
    application: { name: APPLICATION_NAME, version: APPLICATION_VERSION },
    manifestVersion: 1,
    document: doc,
    assets: assetEntries,
    masks: maskEntries,
    selection: extras.selection ?? null,
    adjustments: adjustmentEntries,
    filters: filterEntries,
    color: {
      space: profile.space ?? 'srgb',
      bitDepth: profile.bitDepth ?? 8,
      icc: extras.icc ?? null,
      hdr: hdr ? { transfer: hdr.transfer, headroom: hdr.headroom, sdrPreview: MERGED_PATH } : null,
    },
  };
}
