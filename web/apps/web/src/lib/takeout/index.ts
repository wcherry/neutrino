export { openTakeout, TakeoutError } from './archive';
export type { TakeoutArchive, TakeoutEntry, TakeoutProductDir } from './archive';

export type { ImportItem, ImportProgress, ImportStatus, ImportSummary } from './types';

export { htmlToMarkdown, keepTextToMarkdown, stripInlineMarkdown } from './inlineHtml';

// `markdownToBlocks` used to be re-exported here. It moved to the note
// editor's `noteMarkdown` module when notes became Markdown — it is the
// storage format's parser, not a takeout concern — and callers import it
// from there.
export {
  convertKeepNote,
  keepNoteToBlocks,
  keepNoteTitle,
  looksLikeKeepNote,
  parseKeepNote,
  UNTITLED,
} from './keep';
export type {
  ConvertedKeepNote,
  KeepAnnotation,
  KeepAttachment,
  KeepLabel,
  KeepListItem,
  KeepNote,
} from './keep';

export { findKeepNotes, runKeepImport, DEFAULT_KEEP_IMPORT_OPTIONS } from './importKeep';
export type { KeepImportOptions, KeepImportProgress, KeepImportSummary, KeepSource } from './importKeep';

export { htmlToDocJson, textToDocJson } from './docHtml';
export type { PmMark, PmNode } from './docHtml';

export { findDriveDocs, readDocInfo } from './driveDocs';
export type { DocFormat, DriveDocEntry, DriveDocInfo, DriveDocsSource, UnsupportedDoc } from './driveDocs';

export {
  storedDocxFor,
  runDocsImport,
  DEFAULT_DOCS_IMPORT_OPTIONS,
  UNTITLED_DOC,
} from './importDocs';
export type { DocsImportOptions } from './importDocs';

export { findDriveSheets, readSheetInfo } from './driveSheets';
export type {
  DriveSheetEntry,
  DriveSheetsSource,
  SheetFormat,
  UnsupportedSheet,
} from './driveSheets';

export { delimitedToSheetFile } from './sheetXlsx';
export type { SheetConversionOptions } from './sheetXlsx';

export {
  storedXlsxFor,
  runSheetsImport,
  DEFAULT_SHEETS_IMPORT_OPTIONS,
  UNTITLED_SHEET,
} from './importSheets';
export type { SheetsImportOptions } from './importSheets';

export { findDriveSlides, readSlideInfo } from './driveSlides';
export type {
  DriveSlideEntry,
  DriveSlideInfo,
  DriveSlidesSource,
  SlideFormat,
  UnsupportedSlide,
} from './driveSlides';

export {
  storedPptxFor,
  runSlidesImport,
  DEFAULT_SLIDES_IMPORT_OPTIONS,
  UNTITLED_SLIDE,
} from './importSlides';
export type { SlidesImportOptions } from './importSlides';

export { captureDateOf, findTakeoutPhotos, readPhotoInfo } from './photos';
export type { MediaKind, PhotoInfo, PhotosSource, TakeoutAlbum, TakeoutPhoto } from './photos';

export { runPhotosImport, DEFAULT_PHOTOS_IMPORT_OPTIONS } from './importPhotos';
export type { PhotosImportOptions } from './importPhotos';
