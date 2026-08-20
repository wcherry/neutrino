/**
 * Google Keep → Neutrino note.
 *
 * Each note in `Takeout/Keep/` is one JSON file. This module turns that JSON
 * into the `Block[]` a Neutrino note stores (see `blockEditorTypes.ts`), going
 * through markdown on the way: Keep's text is converted to note markdown
 * (`inlineHtml.ts`), then that markdown is parsed into blocks.
 *
 * What maps to what:
 *
 * | Keep                        | Neutrino                                    |
 * |-----------------------------|---------------------------------------------|
 * | `title`                     | note title (derived from the body if blank) |
 * | `listContent[]`             | `task` blocks, `isChecked` → `checked`      |
 * | `textContent`/`textContentHtml` | markdown → paragraph/bullet/quote/code  |
 * | `annotations[]`             | trailing "Links" bullets                    |
 * | `attachments[]`             | trailing note of the filenames (see below)  |
 * | `labels[]`                  | trailing "Labels" line                      |
 * | `isTrashed` / `isArchived`  | import filters, not stored                  |
 *
 * Keep concepts with no home in Neutrino notes — pin state, note colour and
 * sharees — are dropped. The created and edited timestamps are not converted
 * here but are not lost either: they are on the parsed note in microseconds,
 * and `importKeep.ts` writes them onto the file after its body is saved.
 * Attachments are listed by filename rather than dropped silently, because the
 * bytes stay in the user's zip and the filename is what lets them find them.
 */

import type { Block, BlockType } from '@/app/(apps)/notes/editor/blockEditorTypes';
import { keepTextToMarkdown, stripInlineMarkdown } from './inlineHtml';
import { sanitiseTitle } from './titles';

// ── Keep's JSON shape ─────────────────────────────────────────────────────────

export interface KeepListItem {
  text?: string;
  textHtml?: string;
  isChecked?: boolean;
}

export interface KeepAnnotation {
  description?: string;
  source?: string;
  title?: string;
  url?: string;
}

export interface KeepAttachment {
  filePath?: string;
  mimetype?: string;
}

export interface KeepLabel {
  name?: string;
}

export interface KeepNote {
  title?: string;
  textContent?: string;
  textContentHtml?: string;
  listContent?: KeepListItem[];
  annotations?: KeepAnnotation[];
  attachments?: KeepAttachment[];
  labels?: KeepLabel[];
  color?: string;
  isTrashed?: boolean;
  isPinned?: boolean;
  isArchived?: boolean;
  createdTimestampUsec?: number;
  userEditedTimestampUsec?: number;
}

/** Longest title we will derive from a note's body. */
const DERIVED_TITLE_MAX = 60;

export const UNTITLED = 'Untitled note';

// ── Parsing ───────────────────────────────────────────────────────────────────

/**
 * Whether a parsed JSON value is a Keep note.
 *
 * Used both to reject unrelated JSON inside `Keep/` and to recognise the Keep
 * directory in exports where Google localised its name.
 */
export function looksLikeKeepNote(value: unknown): value is KeepNote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const note = value as Record<string, unknown>;
  const hasBody =
    typeof note.textContent === 'string' ||
    typeof note.textContentHtml === 'string' ||
    Array.isArray(note.listContent);
  // `isTrashed` and the timestamps are on every Keep note including empty
  // ones, so they identify the format even when there is no body at all.
  const hasKeepFields =
    typeof note.isTrashed === 'boolean' ||
    typeof note.isArchived === 'boolean' ||
    typeof note.createdTimestampUsec === 'number' ||
    typeof note.userEditedTimestampUsec === 'number';
  return hasBody || (hasKeepFields && typeof note.title === 'string');
}

/** Parse one Keep JSON file, or `null` when it is not a Keep note. */
export function parseKeepNote(json: string): KeepNote | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  return looksLikeKeepNote(parsed) ? parsed : null;
}

// ── Markdown → blocks ─────────────────────────────────────────────────────────

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function block(type: BlockType, content: string, checked?: boolean): Block {
  return checked === undefined
    ? { id: genId(), type, content }
    : { id: genId(), type, content, checked };
}

const FENCE = /^\s*(```|~~~)/;
const TASK = /^\s*[-*+]\s+\[([ xX])\]\s*(.*)$/;
const BULLET = /^\s*[-*+•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const HEADING = /^\s*(#{1,6})\s+(.*)$/;

/**
 * Parse note markdown into blocks.
 *
 * The block editor has no heading type, so `# Heading` becomes a bold
 * paragraph — the closest thing the editor can actually render. Blank lines
 * produce no block: blocks are already spaced apart, so an empty paragraph
 * between every pair of lines would double the note's height.
 */
export function markdownToBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');

  let fence: string | null = null;
  let code: string[] = [];

  const flushCode = () => {
    blocks.push(block('code', code.join('\n')));
    code = [];
    fence = null;
  };

  for (const line of lines) {
    if (fence !== null) {
      if (line.trim().startsWith(fence)) flushCode();
      else code.push(line);
      continue;
    }

    const fenceMatch = line.match(FENCE);
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }

    if (!line.trim()) continue;

    let match: RegExpMatchArray | null;
    if ((match = line.match(TASK))) {
      blocks.push(block('task', match[2].trim(), match[1] !== ' '));
    } else if ((match = line.match(BULLET))) {
      blocks.push(block('bullet', match[1].trim()));
    } else if ((match = line.match(NUMBERED))) {
      blocks.push(block('numbered', match[1].trim()));
    } else if ((match = line.match(QUOTE))) {
      blocks.push(block('blockquote', match[1].trim()));
    } else if ((match = line.match(HEADING))) {
      const text = match[2].trim();
      blocks.push(block('paragraph', text ? `**${text}**` : ''));
    } else {
      blocks.push(block('paragraph', line.trim()));
    }
  }

  // An unterminated fence still holds the user's lines.
  if (fence !== null) flushCode();

  return blocks;
}

// ── Keep note → blocks ────────────────────────────────────────────────────────

function annotationBlocks(annotations: KeepAnnotation[]): Block[] {
  const links = annotations.filter((a) => a.url?.trim());
  if (links.length === 0) return [];
  return [
    block('paragraph', '**Links**'),
    ...links.map((a) => {
      const url = a.url!.trim();
      const title = a.title?.trim();
      return block('bullet', title && title !== url ? `${title} — ${url}` : url);
    }),
  ];
}

function attachmentBlocks(attachments: KeepAttachment[]): Block[] {
  const names = attachments.map((a) => a.filePath?.trim()).filter((p): p is string => !!p);
  if (names.length === 0) return [];
  // The files themselves are not imported (see the module comment) — the
  // filenames are recorded so the originals stay findable in the export.
  return [block('paragraph', `**Attachments (not imported):** ${names.join(', ')}`)];
}

function labelBlocks(labels: KeepLabel[]): Block[] {
  const names = labels.map((l) => l.name?.trim()).filter((n): n is string => !!n);
  if (names.length === 0) return [];
  // Keep labels are many-per-note and Neutrino notes live in a single folder,
  // so labels cannot become folders without losing some of them.
  return [block('paragraph', `**Labels:** ${names.join(', ')}`)];
}

/** Convert a Keep note's body — its list items or its text — into blocks. */
export function keepNoteToBlocks(note: KeepNote): Block[] {
  const blocks: Block[] = [];

  if (note.listContent?.length) {
    // A Keep list is a checklist, so every item is a task even when nothing in
    // it has ever been ticked.
    for (const item of note.listContent) {
      const content = keepTextToMarkdown(item.text, item.textHtml).replace(/\s+/g, ' ').trim();
      blocks.push(block('task', content, !!item.isChecked));
    }
  } else {
    blocks.push(...markdownToBlocks(keepTextToMarkdown(note.textContent, note.textContentHtml)));
  }

  blocks.push(...annotationBlocks(note.annotations ?? []));
  blocks.push(...attachmentBlocks(note.attachments ?? []));
  blocks.push(...labelBlocks(note.labels ?? []));

  // The editor always needs something to put a cursor in.
  if (blocks.length === 0) blocks.push(block('paragraph', ''));
  return blocks;
}

/**
 * The title to give the imported note.
 *
 * Most Keep notes have no title — Keep shows the first line of the body
 * instead — so an untitled note gets its first line, matching what the user
 * saw in Keep. Titles back drive file names, so newlines and slashes are
 * flattened out.
 */
export function keepNoteTitle(note: KeepNote, blocks: Block[]): string {
  const explicit = sanitiseTitle(note.title ?? '');
  if (explicit) return explicit;

  for (const b of blocks) {
    const derived = sanitiseTitle(stripInlineMarkdown(b.content));
    if (derived) {
      return derived.length > DERIVED_TITLE_MAX
        ? `${derived.slice(0, DERIVED_TITLE_MAX).trimEnd()}…`
        : derived;
    }
  }
  return UNTITLED;
}


export interface ConvertedKeepNote {
  title: string;
  blocks: Block[];
  /** `Block[]` JSON — exactly what the note editor writes as note content. */
  content: string;
}

/** Convert one Keep note into the title and content a Neutrino note stores. */
export function convertKeepNote(note: KeepNote): ConvertedKeepNote {
  const blocks = keepNoteToBlocks(note);
  return {
    title: keepNoteTitle(note, blocks),
    blocks,
    content: JSON.stringify(blocks),
  };
}
