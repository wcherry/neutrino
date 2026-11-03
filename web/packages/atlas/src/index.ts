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
