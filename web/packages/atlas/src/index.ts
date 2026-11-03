/**
 * Atlas Markdown for the web (SPEC `specs/atlas-markdown/SPEC.md`): the parser, page extraction,
 * link resolution, anchors, and the source-preserving writer, agreeing with AtlasKit (Swift)
 * byte for byte. The conformance corpus is run against it in `__tests__/corpus.test.ts`.
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
