/**
 * OpenRaster — the portable format a Neutrino drawing exports to.
 *
 * The writer only, for now. Redesign phase 3 adds the reader, and the pieces it
 * will need are already here and already tested in both directions where that
 * was cheap (`fromCompositeOp`, the manifest shape).
 */

export { ORA_EXTENSION, ORA_MIME_TYPE, createCanvasRenderer, writeOra } from './writeOra';
export type { CanvasRendererOptions, OraRenderer, RenderedLayer } from './writeOra';
export { ORA_VERSION, buildStackXml } from './stackXml';
export type { LayerAsset, StackXmlOptions } from './stackXml';
export { MANIFEST_PATH, buildManifest } from './manifest';
export type { AssetEntry, MaskEntry, NeutrinoManifest } from './manifest';
export { fromCompositeOp, toCompositeOp } from './compositeOp';
