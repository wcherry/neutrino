'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CornerDownLeft, Search } from 'lucide-react';
import { useDismiss } from '@neutrino/commands';
import { usePresence } from '@neutrino/ui';
import type { TopbarSearchResult } from '../Topbar';
import styles from './CommandPalette.module.css';

export interface PaletteCommand {
  id: string;
  title: string;
  /** Where it applies — "Everywhere", "Docs" — shown beside it and searched. */
  group: string;
  /** Its keys, formatted for this platform. */
  keys?: string[];
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
  /** Called as the query changes; the caller searches files and answers with `searchResults`. */
  onSearch?: (query: string) => void;
  searchResults?: TopbarSearchResult[];
  searchPending?: boolean;
  onResultClick?: (result: TopbarSearchResult) => void;
  /** Enter on the query itself, with nothing selected: the full results page. */
  onSearchSubmit?: (query: string) => void;
}

/** Characters before files are searched — the same threshold as the classic search box. */
const MIN_SEARCH_LENGTH = 3;
const MAX_COMMANDS = 40;

type Row =
  | { kind: 'file'; key: string; result: TopbarSearchResult }
  | { kind: 'command'; key: string; command: PaletteCommand };

/** Every word of the query must appear in the title or the group; a title that starts with it ranks first. */
export function matchCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return commands.slice(0, MAX_COMMANDS);
  const scored: { c: PaletteCommand; score: number }[] = [];
  for (const c of commands) {
    const hay = `${c.title} ${c.group}`.toLowerCase();
    if (!terms.every((t) => hay.includes(t))) continue;
    const title = c.title.toLowerCase();
    scored.push({ c, score: title.startsWith(terms[0]) ? 0 : title.includes(terms[0]) ? 1 : 2 });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, MAX_COMMANDS).map((s) => s.c);
}

/**
 * The command palette (customization roadmap U6): one field that searches files and runs any
 * command the screen underneath has registered — what ⌘K opens everywhere. Frosted, over a light
 * scrim (look-and-feel roadmap §2).
 */
export function CommandPalette({
  open,
  onClose,
  commands,
  onSearch,
  searchResults = [],
  searchPending = false,
  onResultClick,
  onSearchSubmit,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const { mounted, state } = usePresence(open);
  useDismiss(onClose, open);

  // A fresh palette each time it opens, focused on the field; focus returns where it was.
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    setQuery('');
    setActive(0);
    onSearch?.('');
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      before?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, [open]);

  const searching = query.trim().length >= MIN_SEARCH_LENGTH;
  const rows: Row[] = useMemo(() => {
    const files: Row[] = searching
      ? searchResults.slice(0, 8).map((result) => ({ kind: 'file', key: `f:${result.id}`, result }))
      : [];
    const cmds: Row[] = matchCommands(commands, query).map((command) => ({ kind: 'command', key: `c:${command.id}`, command }));
    return [...files, ...cmds];
  }, [commands, query, searching, searchResults]);

  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  if (!mounted || typeof document === 'undefined') return null;

  const choose = (row: Row | undefined) => {
    if (!row) return;
    onClose();
    if (row.kind === 'file') onResultClick?.(row.result);
    else row.command.run();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (rows.length ? (i + 1) % rows.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rows[active]) choose(rows[active]);
      else if (query.trim() && onSearchSubmit) {
        onClose();
        onSearchSubmit(query.trim());
      }
    }
  };

  const fileRows = rows.filter((r) => r.kind === 'file');
  const commandRows = rows.filter((r) => r.kind === 'command');
  const optionId = (i: number) => `${listId}-${i}`;
  const renderRow = (row: Row, i: number) => {
    const selected = i === active;
    const common = {
      id: optionId(i),
      role: 'option' as const,
      'aria-selected': selected,
      className: styles.row,
      'data-active': selected || undefined,
      onMouseMove: () => setActive(i),
      onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
      onClick: () => choose(row),
    };
    if (row.kind === 'file') {
      const r = row.result;
      return (
        <li key={row.key} {...common}>
          <span className={styles.icon} style={r.iconColor ? { color: r.iconColor } : undefined} aria-hidden="true">{r.icon}</span>
          <span className={styles.text}>
            <span className={styles.title}>{r.title}</span>
            <span className={styles.sub}>{r.subtitle}</span>
          </span>
          {r.modified && <span className={styles.meta}>{r.modified}</span>}
        </li>
      );
    }
    const c = row.command;
    return (
      <li key={row.key} {...common}>
        <span className={styles.text}>
          <span className={styles.title}>{c.title}</span>
        </span>
        <span className={styles.meta}>{c.group}</span>
        {c.keys?.[0] && <kbd className={styles.kbd}>{c.keys[0]}</kbd>}
      </li>
    );
  };

  return createPortal(
    <div className={styles.scrim} data-motion="fade" data-state={state} onMouseDown={onClose} aria-hidden={open ? undefined : true}>
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        data-motion="scale"
        data-state={state}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.field}>
          <Search size={18} strokeWidth={2} aria-hidden="true" />
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            placeholder="Search files, or type a command"
            aria-label="Search files and commands"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={rows[active] ? optionId(active) : undefined}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              onSearch?.(e.target.value);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <ul id={listId} className={styles.list} role="listbox" aria-label="Results">
          {searching && (
            <li className={styles.heading} role="presentation">
              Files {searchPending && fileRows.length === 0 ? '· searching…' : ''}
            </li>
          )}
          {searching && !searchPending && fileRows.length === 0 && (
            <li className={styles.none} role="presentation">No matching files</li>
          )}
          {fileRows.map((row) => renderRow(row, rows.indexOf(row)))}
          {commandRows.length > 0 && <li className={styles.heading} role="presentation">Commands</li>}
          {commandRows.map((row) => renderRow(row, rows.indexOf(row)))}
          {rows.length === 0 && !searching && <li className={styles.none} role="presentation">No matching commands</li>}
        </ul>
        <div className={styles.foot} aria-hidden="true">
          <span><kbd className={styles.kbd}>↑</kbd><kbd className={styles.kbd}>↓</kbd> to move</span>
          <span><kbd className={styles.kbd}><CornerDownLeft size={11} /></kbd> to open</span>
          <span><kbd className={styles.kbd}>esc</kbd> to close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
