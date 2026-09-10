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

export interface NeutrinoManifest {
  application: { name: string; version: string };
  /**
   * Bumped when the *manifest's* shape changes, independently of the
   * document's.
   *
   * Still 1 after phases 3–5. What they added — a `selection` entry, and
   * `renderedFrom: 'instance'` appearing among the asset entries — is additive,
   * and the reader ignores fields it does not know, so a manifest written
   * before them and one written after are both readable by both. The number
   * exists for a change that would *break* that, and this was not one.
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
}

export const MANIFEST_PATH = 'META-INF/neutrino/document.json';

/** Where the active selection's channel is written inside the archive. */
export const SELECTION_PATH = 'data/selection.png';

export function buildManifest(
  doc: DrawingDocument,
  assets: ReadonlyMap<string, LayerAsset>,
  maskSources: ReadonlyMap<string, string>,
  extras: { selection?: string | null } = {},
): NeutrinoManifest {
  const assetEntries: AssetEntry[] = [];
  const maskEntries: MaskEntry[] = [];

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
    if (node.type === 'stack') node.children.forEach(walk);
  };
  doc.root.children.forEach(walk);

  return {
    application: { name: APPLICATION_NAME, version: APPLICATION_VERSION },
    manifestVersion: 1,
    document: doc,
    assets: assetEntries,
    masks: maskEntries,
    selection: extras.selection ?? null,
  };
}
