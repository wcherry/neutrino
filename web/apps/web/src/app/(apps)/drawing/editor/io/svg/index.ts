/**
 * SVG — the vector interchange format, in both directions.
 *
 * The writer lives in `render/documentSvg.ts` rather than here, because it is
 * one of the renderers and shares its shape emitters with the canvas one; this
 * module re-exports it so an importer and an exporter are reached the same way.
 */

export { SvgReadError, readSvg } from './readSvg';
export type { SvgReadResult } from './readSvg';
export { parsePathData } from './pathData';
export { isAxisAligned, isTranslationOnly, parseTransform } from './transform';
export { documentToSvg } from '../../render/documentSvg';
export type { SvgExportOptions } from '../../render/documentSvg';
