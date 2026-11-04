/**
 * Atlas Markdown for the web (SPEC `specs/atlas-markdown/SPEC.md`): the parser, page extraction,
 * link resolution, anchors, and the source-preserving writer, agreeing with AtlasKit (Swift)
 * byte for byte; and a vault's data: its encrypted copy in this browser, sync with Drive, and
 * its index (backlinks, tags, search, the quick switcher). The conformance corpus is run against it in `__tests__/corpus.test.ts`.
 */
export { SPEC_VERSION, parse, parseLayout, anatomy, type Anatomy } from './parse';
export { extract, frontmatter, internalPageReference, type PageExtract } from './extract';
export { LinkResolver } from './resolve';
export { anchorLine, headingKey, headingLinkText } from './anchors';
export { MarkdownDocument, type EditResult, type LinkOccurrence } from './document';
export { serializeCanonical, serializeBlock } from './serialize';
export { isValidTag, matchKey } from './tags';
export type { TopLevelBlock } from './convert';
export type { Align, CalloutFold, MarkdownNode, NodeOf, WikiLinkReference } from './tree';
export { childrenOf, plainText } from './tree';
export { threeWayMerge } from './sync/merge';
export { Vault, MemoryStorage, VaultStorageError, syncRecord, type SyncRecord, type VaultStorage } from './sync/vault';
export {
  VaultSync,
  VaultRemoteError,
  emptySyncReport,
  isQuiet,
  type RemoteFile,
  type SyncReport,
  type VaultRemote,
  type VaultRemoteErrorCode,
} from './sync/vaultSync';
export { DeviceSealer, IndexedDBStorage, acquireVaultLock, type Sealer } from './storage/indexedDB';
export { LocalVault, VaultInUseError } from './storage/localVault';
export { DriveVaultRemote } from './drive/driveVaultRemote';
export {
  VaultIndex,
  fuzzyScore,
  type ExtractedPage,
  parseSearchQuery,
  type Heading,
  type IndexedLink,
  type LinkKind,
  type Mention,
  type SearchHit,
  type SearchQuery,
  type Snippet,
  type SwitcherHit,
} from './indexing/vaultIndex';
export { storageIndexCache, type IndexCacheStore } from './indexing/indexCache';
export { VaultWorkspace, FileExistsError, FolderIntoItselfError, folderMovedInto, pastedImageName, trimmedFolder } from './workspace/vaultWorkspace';
export {
  pageSyntax,
  allSpans,
  type PageSyntax,
  type SyntaxBlock,
  type SyntaxKind,
  type SyntaxRole,
  type SyntaxSpan,
} from './syntax/pageSyntax';
export { styleRuns, isConcealable, linkAt, shouldOpenLink, type EditorMode, type LinkTarget, type StyleRun, type TextStyle } from './syntax/styler';
export { linkingMentions } from './syntax/mentionLinker';
export {
  PageList,
  pageTree,
  tagTree,
  pageForUnresolvedLink,
  renamedPath,
  folderOf,
  movedInto,
  ATTACHMENT_EXTENSIONS,
  type PageNode,
  type TagNode,
} from './workspace/pagePaths';
export {
  applyEdit,
  newline,
  indent,
  outdent,
  toggleTask,
  toggleWrap,
  linkCompletionContext,
  acceptCompletion,
  isInCode,
  isInVerbatimBlock,
  type TextEdit,
  type LinkCompletion,
  type LinkCompletionContext,
} from './editing/markdownEditing';
export {
  builtInSlashCommands,
  slashContext,
  matchingSlashCommands,
  applySlashCommand,
  insertAction,
  type SlashAction,
  type SlashCommand,
  type SlashContext,
} from './editing/slashCommands';
export {
  blockImage,
  imageFileExtension,
  imageMimeType,
  imageSourceKey,
  insertBlocks,
  insertEmbeds,
  fileLinkAt,
  setPreview,
  IMAGE_EXTENSIONS,
  type BlockImage,
  type ImageSource,
} from './editing/images';
export { pastedLink, pasteLink } from './editing/pastedLinks';
export { moveLines } from './editing/moveLines';
export { formatDate, parseDate } from './workspace/dates';
export {
  renderTemplate,
  dailyNotePath,
  dailyNoteDate,
  openDailyNote,
  templates,
  templateText,
  createPageFromTemplate,
  BUILT_IN_TEMPLATES,
  DEFAULT_DAILY_NOTES,
  type DailyNotes,
  type Template,
} from './workspace/templates';
export {
  snapshotOf,
  importFiles,
  exportFiles,
  cleanDriveName,
  notePageName,
  MAX_IMPORT_SIZE,
  type FolderSnapshot,
  type ImportReport,
  type PickedFile,
} from './workspace/importExport';
export { AtlasLog, LogChannel, logLine, type LogEntry, type LogLevel } from './log';
export { dragBlocks, moveBlock, editBetween, type DragBlock } from './editing/blockDrag';
