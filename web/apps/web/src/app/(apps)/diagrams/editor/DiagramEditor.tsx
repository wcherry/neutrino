'use client';

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Spinner } from '@neutrino/ui';
import { diagramsApi } from '@neutrino/api-drawing';
import { authApi } from '@neutrino/auth';
import { useFeatureFlags } from '@/providers/FeatureFlagsProvider';
import { useDiagramEditor } from './hooks/useDiagramEditor';
import { useDiagramCollab } from './hooks/useDiagramCollab';
import { DiagramCanvas } from './DiagramCanvas';
import { DiagramToolbar } from './DiagramToolbar';
import { ShapePanel } from './ShapePanel';
import { PropertiesPanel } from './PropertiesPanel';
import { PagePanel } from './PagePanel';
import { CommentsPanel } from './collab/CommentsPanel';
import { PresenceBar } from './collab/PresenceBar';
import type { DiagramDocument, EditorSelection, SelectionMode } from '../types';
import styles from './DiagramEditor.module.css';

// ---------------------------------------------------------------------------
// Empty diagram document
// ---------------------------------------------------------------------------

function makeEmptyDocument(): DiagramDocument {
  return {
    version: 1,
    pages: [
      {
        id: 'page-1',
        name: 'Page 1',
        shapes: [],
        connectors: [],
        gridEnabled: true,
        gridSize: 20,
        snapEnabled: true,
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function parseDocument(raw: string): DiagramDocument {
  try {
    const parsed = JSON.parse(raw) as DiagramDocument;
    if (!parsed.pages || !Array.isArray(parsed.pages)) {
      return makeEmptyDocument();
    }
    return parsed;
  } catch {
    return makeEmptyDocument();
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DiagramEditor() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const diagramId = searchParams.get('id') ?? '';
  const queryClient = useQueryClient();
  const flags = useFeatureFlags();

  const [selection, setSelection] = useState<EditorSelection>({
    shapeIds: new Set(),
    connectorIds: new Set(),
  });
  const [mode, setMode] = useState<SelectionMode>('select');
  const [showComments, setShowComments] = useState(false);
  const [title, setTitle] = useState('Untitled diagram');
  const [titleEditing, setTitleEditing] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load auth token for collab WebSocket
  useEffect(() => {
    // JWT is stored by the auth module as 'neutrino.access_token'
    const stored = localStorage.getItem('neutrino.access_token');
    if (stored) setAuthToken(stored);
    authApi.getProfile().then((p) => setUserName(p.name)).catch(() => {});
  }, []);

  // ── Editor state ───────────────────────────────────────────────────────────

  const editor = useDiagramEditor(makeEmptyDocument());

  // ── Remote collaboration ───────────────────────────────────────────────────

  const collab = useDiagramCollab({
    diagramId,
    userName,
    authToken,
    enabled: flags.diagramsApp && !!diagramId,
  });

  // ── Load diagram from server ───────────────────────────────────────────────

  const { isLoading } = useQuery({
    queryKey: ['diagram', diagramId],
    queryFn: async () => {
      const diagram = await diagramsApi.getDiagram(diagramId);
      setTitle(diagram.title);
      if (diagram.contentUrl) {
        try {
          const res = await fetch(diagram.contentUrl, {
            headers: { Authorization: `Bearer ${authToken ?? ''}` },
          });
          if (res.ok) {
            const raw = await res.text();
            const doc = parseDocument(raw);
            editor.setDocument(doc);
          }
        } catch {
          // Use empty document on fetch failure
        }
      }
      return diagram;
    },
    enabled: !!diagramId,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // ── Save / autosave ────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!diagramId) return;
      const content = JSON.stringify(editor.document, null, 0);
      await diagramsApi.autosaveContent(diagramId, content, 'diagram.json', {
        title,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['diagrams'] });
    },
  });

  // Schedule autosave 2 s after last change
  useEffect(() => {
    if (!diagramId) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      saveMutation.mutate();
    }, 2000);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.document, diagramId]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isInput =
        (e.target as HTMLElement).tagName === 'INPUT' ||
        (e.target as HTMLElement).tagName === 'TEXTAREA' ||
        (e.target as HTMLElement).isContentEditable;
      if (isInput) return;

      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          editor.redo();
        } else {
          editor.undo();
        }
      }

      if (meta && e.key === 'y') {
        e.preventDefault();
        editor.redo();
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput) {
        e.preventDefault();
        if (selection.shapeIds.size > 0) {
          editor.removeShapes(Array.from(selection.shapeIds));
          setSelection({ shapeIds: new Set(), connectorIds: new Set() });
        }
        if (selection.connectorIds.size > 0) {
          editor.removeConnectors(Array.from(selection.connectorIds));
          setSelection({ shapeIds: new Set(), connectorIds: new Set() });
        }
      }

      if (meta && e.key === 'd') {
        e.preventDefault();
        if (selection.shapeIds.size > 0) {
          const newIds = editor.duplicateShapes(Array.from(selection.shapeIds));
          setSelection({ shapeIds: new Set(newIds), connectorIds: new Set() });
        }
      }

      if (meta && e.key === 'a') {
        e.preventDefault();
        const page = editor.document.pages[editor.activePageIndex];
        if (page) {
          setSelection({
            shapeIds: new Set(page.shapes.map((s) => s.id)),
            connectorIds: new Set(page.connectors.map((c) => c.id)),
          });
        }
      }

      // Escape — deselect
      if (e.key === 'Escape') {
        setSelection({ shapeIds: new Set(), connectorIds: new Set() });
        setMode('select');
      }

      // V — select tool
      if (e.key === 'v' || e.key === 'V') setMode('select');
      // H — pan
      if (e.key === 'h' || e.key === 'H') setMode('pan');
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, editor]);

  // ── Rendering ──────────────────────────────────────────────────────────────

  if (!flags.diagramsApp) {
    return (
      <div className={styles.disabled}>
        <p>Diagramming is not enabled.</p>
      </div>
    );
  }

  if (!diagramId) {
    router.replace('/diagrams');
    return null;
  }

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="lg" />
      </div>
    );
  }

  const activePage = editor.document.pages[editor.activePageIndex] ?? editor.document.pages[0];

  return (
    <div className={styles.root}>
      {/* Top toolbar */}
      <DiagramToolbar
        title={title}
        titleEditing={titleEditing}
        onTitleClick={() => setTitleEditing(true)}
        onTitleChange={setTitle}
        onTitleBlur={() => {
          setTitleEditing(false);
          if (diagramId) diagramsApi.saveDiagram(diagramId, { title });
        }}
        mode={mode}
        onModeChange={setMode}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        onUndo={editor.undo}
        onRedo={editor.redo}
        onSave={() => saveMutation.mutate()}
        isSaving={saveMutation.isPending}
        onToggleComments={() => setShowComments((v) => !v)}
        showComments={showComments}
        selection={selection}
        onAlign={(dir) => editor.align(Array.from(selection.shapeIds), dir)}
        onDistribute={(axis) => editor.distribute(Array.from(selection.shapeIds), axis)}
        onBringForward={() => editor.bringForward(Array.from(selection.shapeIds))}
        onSendBackward={() => editor.sendBackward(Array.from(selection.shapeIds))}
        onBringToFront={() => editor.bringToFront(Array.from(selection.shapeIds))}
        onSendToBack={() => editor.sendToBack(Array.from(selection.shapeIds))}
        presenceBar={
          <PresenceBar
            users={collab.remoteUsers}
            connected={collab.isConnected}
          />
        }
      />

      <div className={styles.workspace}>
        {/* Left: shape library panel */}
        <ShapePanel
          onAddShape={(type, label) => {
            const id = editor.addShape(
              type,
              200 - editor.document.viewport.x,
              200 - editor.document.viewport.y,
            );
            if (label) editor.updateShape(id, { label });
            setSelection({ shapeIds: new Set([id]), connectorIds: new Set() });
            setMode('select');
          }}
        />

        {/* Center: infinite canvas */}
        <div className={styles.canvasWrapper}>
          {activePage && (
            <DiagramCanvas
              page={activePage}
              viewport={editor.document.viewport}
              selection={selection}
              mode={mode}
              remoteUsers={collab.remoteUsers}
              onSelect={(sel) => setSelection(sel)}
              onModeChange={setMode}
              onViewportChange={(v) => editor.setViewport(v)}
              onShapeMove={(id, x, y) => editor.updateShape(id, { x, y })}
              onShapeResize={(id, x, y, w, h) =>
                editor.updateShape(id, { x, y, width: w, height: h })
              }
              onShapeLabel={(id, label) => editor.updateShape(id, { label })}
              onAddShape={(type, x, y) => {
                const id = editor.addShape(type, x, y);
                setSelection({ shapeIds: new Set([id]), connectorIds: new Set() });
                setMode('select');
              }}
              onConnectorUpdate={(id, changes) => editor.updateConnector(id, changes)}
              onCanvasMouseMove={(pos) => collab.sendCursor(pos)}
            />
          )}
        </div>

        {/* Right: properties / comments panel */}
        {showComments ? (
          <CommentsPanel diagramId={diagramId} />
        ) : (
          <PropertiesPanel
            selection={selection}
            page={activePage}
            onShapeUpdate={(id, changes) => editor.updateShape(id, changes)}
            onConnectorUpdate={(id, changes) => editor.updateConnector(id, changes)}
          />
        )}
      </div>

      {/* Bottom: page tabs */}
      <PagePanel
        pages={editor.document.pages}
        activeIndex={editor.activePageIndex}
        onSelect={editor.setActivePage}
        onAdd={editor.addPage}
        onRemove={(id) => editor.removePage(id)}
        onRename={(id, name) => editor.renamePage(id, name)}
      />
    </div>
  );
}
