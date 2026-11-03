'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ArrowUpToLine,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleAlert,
  Code,
  Eye,
  FileText,
  Folder,
  FolderPlus,
  Hash,
  Link as LinkIcon,
  RefreshCw,
  Search,
  SquarePen,
  Star,
  Trash2,
  Waypoints,
} from 'lucide-react';
import { getCurrentUserId } from '@neutrino/api-core';
import { useCommands, useDismiss } from '@neutrino/commands';
import {
  Alert,
  AlertDialog,
  Button,
  EmptyState,
  Modal,
  ModalBody,
  ModalFooter,
  SearchInput,
  Spinner,
  TextInput,
  useToast,
} from '@neutrino/ui';
import { VaultIndex, folderOf, pageTree, tagTree, type EditorMode, type Mention, type PageNode, type Snippet, type TagNode } from '@neutrino/atlas';
import { requestEncryptionGate, subscribeToGateState, getGateState } from '@/components/E2EEUnlockGate';
import { AtlasModel, browserServices, type AtlasServices } from './atlasModel';
import { AtlasEditor } from './AtlasEditor';
import styles from './atlas.module.css';
import menuStyles from '../drive/FileContextMenu.module.css';

/** Re-renders on every change to the model. */
function useAtlasModel(model: AtlasModel): AtlasModel {
  useSyncExternalStore(model.subscribe, () => model.version, () => model.version);
  return model;
}

/** A per-browser view setting, remembered in local storage. */
function useRemembered<T extends string>(key: string, initial: T, allowed: readonly T[]): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key) as T | null;
      return stored !== null && allowed.includes(stored) ? stored : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback((v: T) => {
    setValue(v);
    try {
      window.localStorage.setItem(key, v);
    } catch {
      // Not remembered; it still applies.
    }
  }, [key]);
  return [value, set];
}

/** `/atlas`: Neutrino Atlas for the signed-in user. `services` stand in for the browser and Drive in tests. */
export function AtlasApp({ services }: { services?: AtlasServices }) {
  const [userId] = useState(() => getCurrentUserId());
  if (!userId) {
    return <EmptyState icon={Waypoints} title="Sign in to use Atlas" description="Atlas opens your vaults from your Neutrino Drive." />;
  }
  return <AtlasForUser userId={userId} services={services} />;
}

function AtlasForUser({ userId, services }: { userId: string; services?: AtlasServices }) {
  // The model belongs to the effect that disposes it, so a remount (Strict Mode's, or React's
  // own) starts a fresh one rather than reusing one already closed.
  const [model, setModel] = useState<AtlasModel | null>(null);
  useEffect(() => {
    const m = new AtlasModel(userId, services ?? browserServices());
    setModel(m);
    void m.route();
    // A key restored or set up through the unlock gate lets the vault open.
    let last = getGateState();
    const off = subscribeToGateState(() => {
      const now = getGateState();
      if (now === 'clear' && last !== 'clear') void m.route();
      last = now;
    });
    // Typing is saved as it happens; this catches the last keystrokes when the tab goes away.
    const hide = () => void m.flush();
    window.addEventListener('pagehide', hide);
    return () => {
      off();
      window.removeEventListener('pagehide', hide);
      void m.dispose();
    };
  }, [userId, services]);
  if (!model) return <div className={styles.empty}><Spinner label="Opening Atlas" /></div>;
  return <AtlasView model={model} />;
}

function AtlasView({ model }: { model: AtlasModel }) {
  useAtlasModel(model);

  const banner = model.error && (
    <div className={styles.banner}>
      <Alert variant="error" message={model.error} onClose={() => model.dismissError()} />
    </div>
  );

  switch (model.phase) {
    case 'starting':
      return <div className={styles.empty}><Spinner label="Opening Atlas" /></div>;
    case 'needsKey':
      return (
        <div className={styles.setup}>
          <h1>Your encryption key</h1>
          <p className={styles.subtitle}>
            Atlas needs your account&rsquo;s key in this browser to read and write your pages: they&rsquo;re end-to-end
            encrypted, so the server stores them but can&rsquo;t read them.
          </p>
          <div className={styles.row}>
            <Button onClick={() => requestEncryptionGate()}>Set up encryption</Button>
            <Button variant="secondary" onClick={() => void model.route()}>Check again</Button>
          </div>
        </div>
      );
    case 'inUse':
      return (
        <div className={styles.setup}>
          {banner}
          <h1>Open in another tab</h1>
          <p className={styles.subtitle}>
            This vault is open in another tab of this browser, which keeps its copy here up to date. Close it there, or
            use that tab.
          </p>
          <div className={styles.row}>
            <Button onClick={() => void model.route()}>Try again</Button>
            <Button variant="secondary" onClick={() => void model.changeVault()}>Choose another vault</Button>
          </div>
        </div>
      );
    case 'needsVault':
      return <VaultPicker model={model} banner={banner} />;
    case 'ready':
      return <Workspace model={model} banner={banner} />;
  }
}

// ── Choosing a vault ─────────────────────────────────────────────────────────

function VaultPicker({ model, banner }: { model: AtlasModel; banner: React.ReactNode }) {
  const [name, setName] = useState('Atlas');
  return (
    <div className={styles.setup}>
      {banner}
      <h1>Choose a vault</h1>
      <p className={styles.subtitle}>
        A vault is a folder in your Drive. Its pages are Markdown files you can also see in Drive, with their names
        visible and their content encrypted. This browser keeps an encrypted copy, so it works offline too.
      </p>
      <section className={styles.group}>
        <h2>Create a new vault</h2>
        <form
          className={styles.row}
          onSubmit={(e) => {
            e.preventDefault();
            void model.createVault(name);
          }}
        >
          <TextInput aria-label="Vault name" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
          <Button type="submit" disabled={name.trim() === '' || model.busy}>Create</Button>
        </form>
      </section>
      <section className={styles.group}>
        <h2>Or use a folder from your Drive</h2>
        {model.busy && model.rootFolders.length === 0 ? (
          <Spinner size="sm" />
        ) : model.rootFolders.length === 0 ? (
          <p className={styles.subtitle}>Your Drive has no folders at its top level yet.</p>
        ) : (
          <ul className={styles.folders}>
            {model.rootFolders.map((f) => (
              <li key={f.id}>
                <Folder size={16} aria-hidden />
                <span>{f.name}</span>
                <Button size="sm" variant="secondary" onClick={() => void model.chooseVault(f.id)}>Open</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── The open vault ───────────────────────────────────────────────────────────

const MODES = ['livePreview', 'source'] as const;
const SHOWN = ['shown', 'hidden'] as const;

function Workspace({ model, banner }: { model: AtlasModel; banner: React.ReactNode }) {
  const toast = useToast();
  const [mode, setMode] = useRemembered<EditorMode>('neutrino.atlas.mode', 'livePreview', MODES);
  const [backlinks, setBacklinks] = useRemembered('neutrino.atlas.backlinks', 'shown', SHOWN);
  const [quickOpen, setQuickOpen] = useState(false);
  const [naming, setNaming] = useState<{ parent: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const search = useRef<HTMLDivElement>(null);

  const copyLink = useCallback((path: string) => {
    const link = model.linkTo(path);
    navigator.clipboard?.writeText(link).then(
      () => toast.success(`Copied ${link}`),
      () => toast.error("Couldn't copy the link."),
    );
  }, [model, toast]);

  useCommands({
    'atlas.quickOpen': () => setQuickOpen(true),
    'atlas.newPage': () => void model.newPage(),
    'atlas.search': () => search.current?.querySelector('input')?.focus(),
    'atlas.sync': () => void model.syncNow(),
    'atlas.toggleSource': () => setMode(mode === 'livePreview' ? 'source' : 'livePreview'),
    'atlas.toggleBacklinks': () => setBacklinks(backlinks === 'shown' ? 'hidden' : 'shown'),
  });

  const open = model.selection;
  const starred = open !== null && model.favourites.contains(open);

  return (
    <div className={styles.app} data-app-root="atlas">
      <Sidebar
        model={model}
        searchRef={search}
        onCopyLink={copyLink}
        onDelete={setDeleting}
        onNewFolder={(parent) => setNaming({ parent })}
      />
      <div className={styles.main}>
        <div className={styles.toolbar}>
          <Button variant="ghost" size="sm" icon={<SquarePen size={16} />} onClick={() => void model.newPage()} title="New page">
            New page
          </Button>
          <Button variant="ghost" size="sm" icon={<Search size={16} />} onClick={() => setQuickOpen(true)} title="Open or create a page" data-tour="atlas-quick-open">
            Open
          </Button>
          <div className={styles.toolbarSpacer} />
          <Button
            variant="ghost"
            size="sm"
            icon={mode === 'livePreview' ? <Eye size={16} /> : <Code size={16} />}
            onClick={() => setMode(mode === 'livePreview' ? 'source' : 'livePreview')}
            title={mode === 'livePreview' ? 'Live Preview: Markdown hidden away from the cursor. Click for source.' : 'Source: every character shown. Click for Live Preview.'}
          >
            {mode === 'livePreview' ? 'Live Preview' : 'Source'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Star size={16} fill={starred ? 'currentColor' : 'none'} />}
            disabled={open === null}
            onClick={() => open !== null && model.toggleFavourite(open)}
            aria-pressed={starred}
            title={starred ? 'Remove this page from Favourites' : 'Add this page to Favourites'}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<LinkIcon size={16} />}
            onClick={() => setBacklinks(backlinks === 'shown' ? 'hidden' : 'shown')}
            aria-pressed={backlinks === 'shown'}
            title="Show or hide the pages linking here"
          />
          <SyncStatus model={model} />
          <Button variant="ghost" size="sm" onClick={() => void model.changeVault()} title="Close this vault and choose another">
            Change vault
          </Button>
        </div>
        {banner}
        <div className={styles.pageArea}>
          {open !== null ? (
            <PageView key={open} model={model} path={open} mode={mode} />
          ) : (
            <div className={styles.empty}>
              <EmptyState
                icon={FileText}
                title="No page open"
                description="Choose a page in the sidebar, or make one."
                action={<Button onClick={() => void model.newPage()}>New page</Button>}
              />
            </div>
          )}
          {open !== null && backlinks === 'shown' && <Backlinks model={model} path={open} />}
        </div>
      </div>
      {quickOpen && <QuickOpen model={model} onClose={() => setQuickOpen(false)} />}
      {naming && (
        <NameDialog
          title={naming.parent === '' ? 'New folder' : `New folder in “${naming.parent}”`}
          action="Create"
          onClose={() => setNaming(null)}
          onSubmit={(name) => {
            setNaming(null);
            void model.newFolder(name, naming.parent);
          }}
        />
      )}
      <AlertDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting ? VaultIndex.title(deleting) : ''}”?`}
        description="It's deleted here and, at the next sync, from your Drive."
        variant="error"
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleting) void model.delete(deleting);
          setDeleting(null);
        }}
      />
    </div>
  );
}

function SyncStatus({ model }: { model: AtlasModel }) {
  const s = model.syncState;
  const label = s.kind === 'syncing' ? 'Syncing…' : s.kind === 'synced' ? 'Synced' : s.kind === 'failed' ? 'Sync failed' : 'Sync';
  const title =
    s.kind === 'synced'
      ? `Last synced ${s.at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}. Click to sync now.`
      : s.kind === 'failed'
        ? `Sync failed: ${s.message}. Click to try again.`
        : s.kind === 'syncing'
          ? 'Syncing with Drive'
          : 'Sync now';
  const icon = s.kind === 'synced' ? <CircleCheck size={16} /> : s.kind === 'failed' ? <CircleAlert size={16} /> : <RefreshCw size={16} />;
  return (
    <Button variant="ghost" size="sm" icon={icon} onClick={() => void model.syncNow()} title={title} data-tour="atlas-sync">
      {label}
    </Button>
  );
}

// ── The sidebar ──────────────────────────────────────────────────────────────

/** What a dragged sidebar row carries: its path, and a wiki link for dropping into a page. */
const DRAG_TYPE = 'application/x-neutrino-atlas-page';

function Sidebar({
  model,
  searchRef,
  onCopyLink,
  onDelete,
  onNewFolder,
}: {
  model: AtlasModel;
  searchRef: React.RefObject<HTMLDivElement>;
  onCopyLink(path: string): void;
  onDelete(path: string): void;
  onNewFolder(parent: string): void;
}) {
  const [query, setQuery] = useState('');
  const [showing, setShowing] = useState<'pages' | 'tags'>('pages');
  const [menu, setMenu] = useState<{ path: string; folder: boolean; x: number; y: number } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const tree = useMemo(() => pageTree(model.pages), [model.pages]);
  const tags = showing === 'tags' ? tagTree(model.tags()) : [];

  const drop = (folder: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      setDropTarget(folder);
    },
    onDragLeave: () => setDropTarget((t) => (t === folder ? null : t)),
    onDrop: (e: React.DragEvent) => {
      const path = e.dataTransfer.getData(DRAG_TYPE);
      setDropTarget(null);
      if (!path) return;
      e.preventDefault();
      void model.move(path, folder);
    },
    'data-drop': dropTarget === folder ? 'true' : undefined,
  });

  const renderNode = (node: PageNode, depth: number): React.ReactNode => {
    const indent = { paddingLeft: 12 + depth * 14 };
    if (node.children) {
      const folder = node.id.slice(0, -1);
      const closed = collapsed.has(node.id);
      return (
        <li key={node.id}>
          <button
            type="button"
            className={styles.node}
            style={indent}
            aria-expanded={!closed}
            onClick={() => setCollapsed((c) => {
              const next = new Set(c);
              if (closed) next.delete(node.id);
              else next.add(node.id);
              return next;
            })}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ path: folder, folder: true, x: e.clientX, y: e.clientY });
            }}
            {...drop(folder)}
          >
            {closed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            <Folder size={14} />
            <span>{node.name}</span>
          </button>
          {!closed && <ul className={styles.tree}>{node.children.map((c) => renderNode(c, depth + 1))}</ul>}
        </li>
      );
    }
    return (
      <li key={node.id}>
        <PageRow model={model} path={node.id} name={node.name} style={indent} onMenu={(x, y) => setMenu({ path: node.id, folder: false, x, y })} {...drop(folderOf(node.id))} />
      </li>
    );
  };

  return (
    <nav className={styles.sidebar} aria-label="Pages" data-tour="atlas-sidebar">
      <div className={styles.sidebarTop}>
        <div ref={searchRef}>
          <SearchInput
            size="sm"
            placeholder="Search"
            aria-label="Search the vault"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery('')}
          />
        </div>
        {query === '' && (
          <div className={styles.segmented} role="group" aria-label="Show">
            <button type="button" aria-pressed={showing === 'pages'} onClick={() => setShowing('pages')}>Pages</button>
            <button type="button" aria-pressed={showing === 'tags'} onClick={() => setShowing('tags')}>Tags</button>
          </div>
        )}
      </div>
      <div className={styles.sidebarList}>
        {query !== '' ? (
          <SearchResults model={model} query={query} />
        ) : showing === 'tags' ? (
          tags.length === 0 ? (
            <p className={styles.hint}>No tags yet. Type #tag in a page.</p>
          ) : (
            <ul className={styles.tree}>{tags.map((t) => <TagRow key={t.id} node={t} depth={0} onChoose={(tag) => setQuery('#' + tag)} />)}</ul>
          )
        ) : (
          <>
            {model.favourites.paths.length > 0 && (
              <>
                <div className={styles.sectionLabel}>Favourites</div>
                <ul className={styles.tree}>
                  {model.favourites.paths.map((p) => (
                    <li key={'fav:' + p}>
                      <PageRow model={model} path={p} name={VaultIndex.title(p)} icon="star" style={{ paddingLeft: 12 }} onMenu={(x, y) => setMenu({ path: p, folder: false, x, y })} />
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className={styles.sectionLabel} title="Drop a page here to move it to the top of the vault" {...drop('')}>
              <span>Pages</span>
              <button type="button" className={styles.link} onClick={() => onNewFolder('')} title="New folder" aria-label="New folder">
                <FolderPlus size={14} />
              </button>
            </div>
            {tree.length === 0 ? (
              <p className={styles.hint}>No pages yet.</p>
            ) : (
              <ul className={styles.tree}>{tree.map((n) => renderNode(n, 0))}</ul>
            )}
          </>
        )}
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {menu.folder ? (
            <>
              <MenuItem icon={<SquarePen size={14} />} onClick={() => void model.newPage('Untitled', menu.path)}>New page here</MenuItem>
              <MenuItem icon={<FolderPlus size={14} />} onClick={() => onNewFolder(menu.path)}>New folder here</MenuItem>
            </>
          ) : (
            <>
              <MenuItem icon={<Star size={14} />} onClick={() => model.toggleFavourite(menu.path)}>
                {model.favourites.contains(menu.path) ? 'Remove from Favourites' : 'Add to Favourites'}
              </MenuItem>
              <MenuItem icon={<LinkIcon size={14} />} onClick={() => onCopyLink(menu.path)}>Copy link</MenuItem>
              {menu.path.includes('/') && (
                <MenuItem icon={<ArrowUpToLine size={14} />} onClick={() => void model.move(menu.path, '')}>Move to top level</MenuItem>
              )}
              <div className={menuStyles.separator} role="separator" />
              <MenuItem icon={<Trash2 size={14} />} danger onClick={() => onDelete(menu.path)}>Delete</MenuItem>
            </>
          )}
        </ContextMenu>
      )}
    </nav>
  );
}

function PageRow({
  model,
  path,
  name,
  icon = 'page',
  style,
  onMenu,
  ...dropProps
}: {
  model: AtlasModel;
  path: string;
  name: string;
  icon?: 'page' | 'star';
  style?: React.CSSProperties;
  onMenu(x: number, y: number): void;
} & React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={styles.node}
      style={style}
      title={path}
      aria-current={model.selection === path ? 'page' : undefined}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, path);
        // Dropped into a page, it's a link to this one.
        e.dataTransfer.setData('text/plain', model.linkTo(path));
        e.dataTransfer.effectAllowed = 'copyMove';
      }}
      onClick={() => void model.select(path)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      {...dropProps}
    >
      {icon === 'star' ? <Star size={14} /> : <FileText size={14} />}
      <span>{name}</span>
    </button>
  );
}

function TagRow({ node, depth, onChoose }: { node: TagNode; depth: number; onChoose(tag: string): void }) {
  return (
    <li>
      <button
        type="button"
        className={styles.node}
        style={{ paddingLeft: 12 + depth * 14 }}
        onClick={() => onChoose(node.id)}
        title={`Pages tagged #${node.id}, or with a tag nested under it`}
      >
        <Hash size={14} />
        <span>{node.name}</span>
        {node.count > 0 && <span className={styles.count}>{node.count}</span>}
      </button>
      {node.children && (
        <ul className={styles.tree}>{node.children.map((c) => <TagRow key={c.id} node={c} depth={depth + 1} onChoose={onChoose} />)}</ul>
      )}
    </li>
  );
}

function SearchResults({ model, query }: { model: AtlasModel; query: string }) {
  const hits = model.search(query);
  if (hits.length === 0) return <p className={styles.hint}>No pages match.</p>;
  return (
    <div role="list">
      {hits.map((hit) => (
        <button
          key={hit.path}
          type="button"
          role="listitem"
          className={styles.hit}
          aria-current={model.selection === hit.path ? 'page' : undefined}
          onClick={() => void model.select(hit.path)}
          title={hit.path}
        >
          <strong>{hit.title}</strong>
          <Highlighted snippet={hit.snippet} />
        </button>
      ))}
    </div>
  );
}

/** A search snippet with its matches in bold. */
function Highlighted({ snippet }: { snippet: Snippet }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  snippet.matches.forEach((m, k) => {
    if (m.start > at) parts.push(snippet.text.slice(at, m.start));
    parts.push(<mark key={k}>{snippet.text.slice(m.start, m.end)}</mark>);
    at = m.end;
  });
  parts.push(snippet.text.slice(at));
  return <span className={styles.snippet}>{parts}</span>;
}

function ContextMenu({ x, y, onClose, children }: { x: number; y: number; onClose(): void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [onClose]);
  useDismiss(() => onClose());
  return (
    <div
      ref={ref}
      className={menuStyles.menu}
      style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - 220) }}
      role="menu"
      onClick={onClose}
    >
      {children}
    </div>
  );
}

function MenuItem({ icon, danger, onClick, children }: { icon: React.ReactNode; danger?: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button type="button" role="menuitem" className={[menuStyles.item, danger ? menuStyles.danger : ''].join(' ')} onClick={onClick}>
      <span className={menuStyles.itemIcon}>{icon}</span>
      {children}
    </button>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────

function PageView({ model, path, mode }: { model: AtlasModel; path: string; mode: EditorMode }) {
  const [title, setTitle] = useState(VaultIndex.title(path));
  const rename = () => {
    if (title.trim() === '' || title.trim() === VaultIndex.title(path)) setTitle(VaultIndex.title(path));
    else void model.rename(path, title);
  };
  return (
    <div className={styles.page}>
      <div className={styles.pageColumn}>
        <input
          className={styles.title}
          aria-label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setTitle(VaultIndex.title(path));
            }
          }}
        />
        <AtlasEditor
          path={path}
          text={model.openText}
          textVersion={model.textVersion}
          mode={mode}
          anchor={model.anchor}
          onChange={(text) => model.edit(text)}
          onOpenLink={(target) => void model.open(target)}
        />
      </div>
    </div>
  );
}

function Backlinks({ model, path }: { model: AtlasModel; path: string }) {
  const sources = model.backlinks(path);
  const mentions = model.unlinkedMentions(path);
  return (
    <aside className={styles.backlinks} aria-label="Backlinks" data-tour="atlas-backlinks">
      <div className={styles.sectionLabel}>Linked from</div>
      {sources.length === 0 ? (
        <p className={styles.hint}>No pages link here yet.</p>
      ) : (
        sources.map((s) => (
          <div key={s} className={styles.mention}>
            <button type="button" className={styles.link} onClick={() => void model.select(s)} title={s}>
              {VaultIndex.title(s)}
            </button>
          </div>
        ))
      )}
      <div className={styles.sectionLabel}>Unlinked mentions</div>
      {mentions.length === 0 ? (
        <p className={styles.hint}>No other page mentions this one.</p>
      ) : (
        mentions.map((m: Mention) => (
          <div key={m.source} className={styles.mention}>
            <div className={styles.mentionHead}>
              <button type="button" className={styles.link} onClick={() => void model.select(m.source)} title={m.source}>
                {VaultIndex.title(m.source)}
              </button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void model.linkMention(m, path)}
                title={`Turn “${m.name}” in ${VaultIndex.title(m.source)} into a link to this page`}
              >
                Link
              </Button>
            </div>
            <Highlighted snippet={m.snippet} />
          </div>
        ))
      )}
    </aside>
  );
}

// ── Quick Open ───────────────────────────────────────────────────────────────

/** Jump to a page by title, or create it. Before anything is typed, the pages opened last. */
function QuickOpen({ model, onClose }: { model: AtlasModel; onClose(): void }) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState(0);
  const hits = useMemo(
    () =>
      query === ''
        ? model.recentPages().map((p) => ({ path: p, title: VaultIndex.title(p) }))
        : model.quickSwitch(query).map((h) => ({ path: h.path, title: h.alias ?? h.title })),
    [model, query],
  );
  useEffect(() => setChosen(0), [query]);

  const submit = () => {
    const pick = hits[chosen];
    if (pick && (query === '' || chosen > 0 || VaultIndex.title(pick.path).toLowerCase().includes(query.trim().toLowerCase()))) {
      void model.select(pick.path);
    } else {
      void model.openOrCreate(query);
    }
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Open a page" size="md">
      <ModalBody>
        <TextInput
          autoFocus
          aria-label="Open or create a page"
          placeholder="Open or create a page"
          value={query}
          fullWidth
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setChosen((c) => Math.min(c + 1, hits.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setChosen((c) => Math.max(c - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
        <ul className={styles.quickList} role="listbox" aria-label="Pages">
          {hits.map((h, k) => (
            <li key={h.path}>
              <button
                type="button"
                role="option"
                aria-selected={k === chosen}
                onMouseEnter={() => setChosen(k)}
                onClick={() => {
                  void model.select(h.path);
                  onClose();
                }}
              >
                {h.title}
                {h.path.includes('/') && <small>{h.path}</small>}
              </button>
            </li>
          ))}
        </ul>
        <p className={styles.quickHint}>
          {query === ''
            ? hits.length === 0 ? 'Type a title.' : 'Recent pages. Type a title to find another.'
            : `Return opens the first match, or creates “${query.trim()}”.`}
        </p>
      </ModalBody>
    </Modal>
  );
}

function NameDialog({ title, action, onClose, onSubmit }: { title: string; action: string; onClose(): void; onSubmit(name: string): void }) {
  const [name, setName] = useState('');
  return (
    <Modal open onClose={onClose} title={title} size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSubmit(name.trim());
        }}
      >
        <ModalBody>
          <TextInput autoFocus aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={name.trim() === ''}>{action}</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
