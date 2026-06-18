'use client';

import React, { useState, useRef, useCallback } from 'react';
import {
  ChevronLeft,
  Eye,
  EyeOff,
  Trash2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Check,
  Loader,
} from 'lucide-react';
import { SHAPE_CATEGORIES } from './ShapeLibrary';
import { KNOWN_DRAWIO_LIBRARIES } from './useShapeLibraries';
import type { ThirdPartyLibrary, CustomShapeLibrary } from './useShapeLibraries';
import styles from './ShapeLibraryConfigPanel.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ShapeLibraryConfigPanelProps {
  onClose: () => void;
  isBuiltinVisible: (cat: string) => boolean;
  setBuiltinVisible: (cat: string, vis: boolean) => void;
  isThirdPartyVisible: (id: string) => boolean;
  setThirdPartyVisible: (id: string, vis: boolean) => void;
  thirdParty: ThirdPartyLibrary[];
  onAddThirdParty: (name: string, url: string) => void;
  onRemoveThirdParty: (id: string) => void;
  onRetryThirdParty: (id: string) => void;
  custom: CustomShapeLibrary[];
  onCreateCustom: (name: string) => void;
  onDeleteCustom: (id: string) => void;
  onRenameCustom: (id: string, name: string) => void;
}

// ---------------------------------------------------------------------------
// Utility — derive a display name from a URL
// ---------------------------------------------------------------------------

function deriveNameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split('/').pop() ?? '';
    const base = filename.replace(/\.xml$/i, '');
    return base
      .replace(/_/g, ' ')
      .replace(/-/g, ' ')
      .split(' ')
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(' ');
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Third-party add form
// ---------------------------------------------------------------------------

interface AddThirdPartyFormProps {
  existingUrls: Set<string>;
  onAdd: (name: string, url: string) => void;
  onCancel: () => void;
}

function AddThirdPartyForm({ existingUrls, onAdd, onCancel }: AddThirdPartyFormProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [knownOpen, setKnownOpen] = useState(false);

  const handleAdd = () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    const trimmedName = name.trim() || deriveNameFromUrl(trimmedUrl);
    onAdd(trimmedName, trimmedUrl);
  };

  const handleKnownPick = (knownName: string, knownUrl: string) => {
    if (existingUrls.has(knownUrl)) return;
    onAdd(knownName, knownUrl);
  };

  return (
    <div className={styles.addForm}>
      <div className={styles.knownSection}>
        <button
          className={styles.knownToggle}
          onClick={() => setKnownOpen((v) => !v)}
          type="button"
        >
          {knownOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          Browse known libraries
        </button>
        {knownOpen && (
          <div className={styles.knownList}>
            {KNOWN_DRAWIO_LIBRARIES.map((lib) => {
              const alreadyAdded = existingUrls.has(lib.url);
              return (
                <button
                  key={lib.url}
                  className={styles.knownItem}
                  onClick={() => handleKnownPick(lib.name, lib.url)}
                  disabled={alreadyAdded}
                  type="button"
                  title={lib.url}
                >
                  {alreadyAdded ? <Check size={9} /> : null}
                  {lib.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <input
        className={styles.urlInput}
        placeholder="Name (optional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className={styles.urlInput}
        placeholder="drawio-libs .xml URL"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleAdd();
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button
          className={styles.confirmBtn}
          onClick={handleAdd}
          disabled={!url.trim()}
          type="button"
        >
          Add
        </button>
        <a
          href="https://github.com/jgraph/drawio-libs"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.link}
        >
          <ExternalLink size={10} />
          Browse libraries
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom library name editor (inline rename)
// ---------------------------------------------------------------------------

interface InlineRenameProps {
  initialName: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}

function InlineRename({ initialName, onCommit, onCancel }: InlineRenameProps) {
  const [value, setValue] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed) onCommit(trimmed);
    else onCancel();
  }, [value, onCommit, onCancel]);

  return (
    <input
      ref={inputRef}
      autoFocus
      className={styles.renameInput}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onCancel();
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function ShapeLibraryConfigPanel({
  onClose,
  isBuiltinVisible,
  setBuiltinVisible,
  isThirdPartyVisible,
  setThirdPartyVisible,
  thirdParty,
  onAddThirdParty,
  onRemoveThirdParty,
  onRetryThirdParty,
  custom,
  onCreateCustom,
  onDeleteCustom,
  onRenameCustom,
}: ShapeLibraryConfigPanelProps) {
  const [addingThirdParty, setAddingThirdParty] = useState(false);
  const [addingCustom, setAddingCustom] = useState(false);
  const [newCustomName, setNewCustomName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const existingUrls = new Set(thirdParty.map((lib) => lib.url));

  const handleAddThirdParty = (name: string, url: string) => {
    onAddThirdParty(name, url);
    setAddingThirdParty(false);
  };

  const handleCreateCustom = () => {
    const trimmed = newCustomName.trim();
    if (!trimmed) return;
    onCreateCustom(trimmed);
    setNewCustomName('');
    setAddingCustom(false);
  };

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onClose} type="button" aria-label="Back to shapes">
          <ChevronLeft size={14} />
        </button>
        <span className={styles.headerTitle}>Library Config</span>
      </div>

      <div className={styles.scroll}>
        {/* Section 1: Built-in Libraries */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>Built-in Libraries</span>
          </div>
          {(SHAPE_CATEGORIES as readonly string[]).map((cat) => {
            const visible = isBuiltinVisible(cat);
            return (
              <div key={cat} className={`${styles.builtinRow} ${!visible ? styles.dimmed : ''}`}>
                <button
                  className={styles.eyeBtn}
                  onClick={() => setBuiltinVisible(cat, !visible)}
                  type="button"
                  aria-label={visible ? `Hide ${cat}` : `Show ${cat}`}
                  title={visible ? `Hide ${cat}` : `Show ${cat}`}
                >
                  {visible ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
                <span className={styles.builtinRowName}>{cat}</span>
              </div>
            );
          })}
        </div>

        {/* Section 2: Third-Party Libraries */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>Third-Party Libraries</span>
            {!addingThirdParty && (
              <button
                className={styles.addBtn}
                onClick={() => setAddingThirdParty(true)}
                type="button"
              >
                + Add
              </button>
            )}
          </div>

          {addingThirdParty && (
            <AddThirdPartyForm
              existingUrls={existingUrls}
              onAdd={handleAddThirdParty}
              onCancel={() => setAddingThirdParty(false)}
            />
          )}

          {thirdParty.length === 0 && !addingThirdParty && (
            <p className={styles.emptyNote}>No third-party libraries added.</p>
          )}

          {thirdParty.map((lib) => {
            const visible = isThirdPartyVisible(lib.id);
            return (
              <div key={lib.id} className={`${styles.tpRow} ${!visible ? styles.dimmed : ''}`}>
                <button
                  className={styles.eyeBtn}
                  onClick={() => setThirdPartyVisible(lib.id, !visible)}
                  type="button"
                  aria-label={visible ? `Hide ${lib.name}` : `Show ${lib.name}`}
                  title={visible ? `Hide ${lib.name}` : `Show ${lib.name}`}
                >
                  {visible ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
                <div className={styles.tpInfo}>
                  <span className={styles.tpName} title={lib.url}>{lib.name}</span>
                  <div className={styles.tpStatus}>
                    {lib.loadStatus === 'loading' && (
                      <span className={styles.spin} aria-label="Loading">
                        <Loader size={10} />
                      </span>
                    )}
                    {lib.loadStatus === 'loaded' && (
                      <span className={styles.tpCount}>{lib.shapes.length} shapes</span>
                    )}
                    {lib.loadStatus === 'error' && (
                      <>
                        <AlertCircle size={10} className={styles.errorIcon} />
                        <button
                          className={styles.retryBtn}
                          onClick={() => onRetryThirdParty(lib.id)}
                          type="button"
                          title="Retry"
                        >
                          <RefreshCw size={10} />
                        </button>
                      </>
                    )}
                    {lib.loadStatus === 'idle' && (
                      <span className={styles.tpCount}>Pending...</span>
                    )}
                  </div>
                </div>
                <button
                  className={styles.removeBtn}
                  onClick={() => onRemoveThirdParty(lib.id)}
                  type="button"
                  aria-label={`Remove ${lib.name}`}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Section 3: Custom Libraries */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>Custom Libraries</span>
            {!addingCustom && (
              <button
                className={styles.addBtn}
                onClick={() => setAddingCustom(true)}
                type="button"
              >
                + New
              </button>
            )}
          </div>

          {addingCustom && (
            <div className={styles.createForm}>
              <input
                autoFocus
                className={styles.urlInput}
                placeholder="Library name"
                value={newCustomName}
                onChange={(e) => setNewCustomName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateCustom();
                  if (e.key === 'Escape') {
                    setNewCustomName('');
                    setAddingCustom(false);
                  }
                }}
              />
              <button
                className={styles.confirmBtn}
                onClick={handleCreateCustom}
                disabled={!newCustomName.trim()}
                type="button"
              >
                Create
              </button>
            </div>
          )}

          {addingCustom && (
            <p className={styles.hint}>
              After creating, drag shapes from the panel into the new library.
            </p>
          )}

          {custom.length === 0 && !addingCustom && (
            <p className={styles.emptyNote}>No custom libraries yet.</p>
          )}

          {custom.map((lib) => (
            <div key={lib.id} className={styles.customRow}>
              <div className={styles.customNameArea}>
                {renamingId === lib.id ? (
                  <InlineRename
                    initialName={lib.name}
                    onCommit={(name) => {
                      onRenameCustom(lib.id, name);
                      setRenamingId(null);
                    }}
                    onCancel={() => setRenamingId(null)}
                  />
                ) : (
                  <button
                    className={styles.customName}
                    onDoubleClick={() => setRenamingId(lib.id)}
                    type="button"
                    title="Double-click to rename"
                  >
                    {lib.name}
                  </button>
                )}
                <span className={styles.shapeBadge}>{lib.shapes.length}</span>
              </div>
              <button
                className={styles.removeBtn}
                onClick={() => onDeleteCustom(lib.id)}
                type="button"
                aria-label={`Delete ${lib.name}`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
