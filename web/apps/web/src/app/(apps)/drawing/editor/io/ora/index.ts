/**
 * OpenRaster — the portable format a Neutrino drawing exports to, and reads
 * back.
 *
 * The two halves are deliberately asymmetric. The **writer** produces the
 * baseline plus a complete Neutrino manifest, so a package this app writes
 * round-trips losslessly through it while every other reader still sees the
 * right picture. The **reader** prefers that manifest and falls back to
 * `stack.xml` for a file from Krita, GIMP or anything else — where every layer
 * is necessarily raster, because the baseline has no other kind.
 */

export { ORA_EXTENSION, ORA_MIME_TYPE, createCanvasRenderer, writeOra } from './writeOra';
export type { CanvasRendererOptions, OraRenderer, RenderedLayer, WriteOraOptions } from './writeOra';
export { ORA_VERSION, buildStackXml } from './stackXml';
export type { LayerAsset, StackXmlOptions } from './stackXml';
export { MANIFEST_PATH, SELECTION_PATH, buildManifest } from './manifest';
export type { AssetEntry, MaskEntry, NeutrinoManifest } from './manifest';
export { fromCompositeOp, toCompositeOp } from './compositeOp';
export { OraReadError, pngSize, readOra } from './readOra';
export type { OraReadResult } from './readOra';
export { DEFAULT_ORA_DPI, parseStackXml } from './parseStackXml';
export type { ParsedImage, ParsedLayer, ParsedNode, ParsedStack } from './parseStackXml';
