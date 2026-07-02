'use client';

import React, { useState, useRef } from 'react';
import { ChevronDown, ChevronRight, Settings, GripVertical, Loader, AlertCircle } from 'lucide-react';
import type { ShapeType } from '../types';
import { getShapesByCategory, getShapePath } from './shapes/ShapeLibrary';
import { useShapeLibraries } from './shapes/useShapeLibraries';
import type { CustomShapeLibrary, ThirdPartyLibrary } from './shapes/useShapeLibraries';
import { ShapeLibraryConfigPanel } from './shapes/ShapeLibraryConfigPanel';
import styles from './ShapePanel.module.css';

interface ShapePanelProps {
  onAddShape: (type: ShapeType, label: string, dataUrl?: string) => void;
}

type DragOver = { key: string; position: 'before' | 'after' } | null;

export function ShapePanel({ onAddShape }: ShapePanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['builtin:Basic', 'builtin:Flowchart']));
  const [configOpen, setConfigOpen] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<DragOver>(null);

  const libs = useShapeLibraries();
  // Prevents the section wrapper's dragstart from firing when a shape item is dragged
  const draggingSection = useRef(false);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // When config panel is open, render it instead of the normal panel content
  if (configOpen) {
    return (
      <ShapeLibraryConfigPanel
        onClose={() => setConfigOpen(false)}
        isBuiltinVisible={libs.isBuiltinVisible}
        setBuiltinVisible={libs.setBuiltinVisible}
        isThirdPartyVisible={libs.isThirdPartyVisible}
        setThirdPartyVisible={libs.setThirdPartyVisible}
        thirdParty={libs.thirdParty}
        onAddThirdParty={(name, url) => { void libs.addThirdParty(name, url); }}
        onRemoveThirdParty={libs.removeThirdParty}
        onRetryThirdParty={libs.retryThirdParty}
        custom={libs.custom}
        onCreateCustom={libs.createCustomLibrary}
        onDeleteCustom={libs.deleteCustomLibrary}
        onRenameCustom={libs.renameCustomLibrary}
      />
    );
  }

  // Build an ordered list of visible section descriptors from the persisted order
  type SectionDef =
    | { key: string; kind: 'builtin'; cat: string; count: number }
    | { key: string; kind: 'tp'; lib: ThirdPartyLibrary }
    | { key: string; kind: 'custom'; lib: CustomShapeLibrary };

  const orderedSections: SectionDef[] = libs.libraryOrder
    .map((key): SectionDef | null => {
      if (key.startsWith('builtin:')) {
        const cat = key.slice(8);
        if (!libs.isBuiltinVisible(cat)) return null;
        return { key, kind: 'builtin', cat, count: getShapesByCategory(cat).length };
      }
      if (key.startsWith('tp:')) {
        const id = key.slice(3);
        const lib = libs.thirdParty.find((l) => l.id === id);
        if (!lib) return null;
        if (!libs.isThirdPartyVisible(id)) return null;
        return { key, kind: 'tp', lib };
      }
      if (key.startsWith('custom:')) {
        const id = key.slice(7);
        const lib = libs.custom.find((l) => l.id === id);
        if (!lib) return null;
        return { key, kind: 'custom', lib };
      }
      return null;
    })
    .filter((s): s is SectionDef => s !== null);

  function handleGripDragStart(e: React.DragEvent, key: string) {
    e.stopPropagation();
    draggingSection.current = true;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('library-section-key', key);
    setDragKey(key);
  }

  function handleGripDragEnd() {
    draggingSection.current = false;
    setDragKey(null);
    setDragOver(null);
  }

  function handleSectionDragOver(e: React.DragEvent, key: string) {
    if (!dragKey || dragKey === key) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    if (dragOver?.key !== key || dragOver?.position !== position) {
      setDragOver({ key, position });
    }
  }

  function handleSectionDrop(e: React.DragEvent, targetKey: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!dragKey || dragKey === targetKey) {
      setDragKey(null);
      setDragOver(null);
      return;
    }
    const order = libs.libraryOrder;
    const fromIdx = order.indexOf(dragKey);
    const toIdx = order.indexOf(targetKey);
    if (fromIdx === -1 || toIdx === -1) return;

    const newOrder = [...order];
    newOrder.splice(fromIdx, 1);
    const insertAt = newOrder.indexOf(targetKey);
    const offset = dragOver?.position === 'after' ? 1 : 0;
    newOrder.splice(insertAt + offset, 0, dragKey);
    libs.reorderLibraries(newOrder);
    setDragKey(null);
    setDragOver(null);
  }

  function sectionClassName(key: string) {
    const classes = [styles.category];
    if (dragKey === key) classes.push(styles.dragging);
    if (dragOver?.key === key) {
      classes.push(dragOver.position === 'before' ? styles.dropBefore : styles.dropAfter);
    }
    return classes.join(' ');
  }

  function renderSectionHeader(key: string, label: string, count: number) {
    const isOpen = expanded.has(key);
    return (
      <div className={styles.categoryHeaderRow}>
        <span
          className={styles.gripHandle}
          draggable
          onDragStart={(e) => handleGripDragStart(e, key)}
          onDragEnd={handleGripDragEnd}
          title="Drag to reorder"
          aria-label="Drag to reorder library"
        >
          <GripVertical size={11} />
        </span>
        <button className={styles.categoryHeader} onClick={() => toggle(key)}>
          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span>{label}</span>
          <span className={styles.count}>{count}</span>
        </button>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.headerRow}>
        <span className={styles.headerTitle}>Shapes</span>
        <button
          className={styles.gearBtn}
          onClick={() => setConfigOpen(true)}
          type="button"
          aria-label="Configure shape libraries"
          title="Configure libraries"
        >
          <Settings size={13} />
        </button>
      </div>
      <div className={styles.scroll}>
        {orderedSections.map((section) => {
          if (section.kind === 'builtin') {
            const shapes = getShapesByCategory(section.cat);
            const isOpen = expanded.has(section.key);
            return (
              <div
                key={section.key}
                className={sectionClassName(section.key)}
                onDragOver={(e) => handleSectionDragOver(e, section.key)}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => handleSectionDrop(e, section.key)}
              >
                {renderSectionHeader(section.key, section.cat, shapes.length)}
                {isOpen && (
                  <div className={styles.grid}>
                    {shapes.map((item) => (
                      <button
                        key={item.id}
                        className={styles.shapeItem}
                        title={item.label}
                        onClick={() => onAddShape(item.type, item.label)}
                        draggable
                        onDragStart={(e) => {
                          e.stopPropagation();
                          e.dataTransfer.setData('shape-type', item.type);
                          e.dataTransfer.setData('shape-label', item.label);
                        }}
                      >
                        <ShapePreview type={item.type} />
                        <span className={styles.shapeLabel}>{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          if (section.kind === 'tp') {
            const lib = section.lib;
            const isOpen = expanded.has(section.key);
            const isLoading = lib.loadStatus === 'loading' || lib.loadStatus === 'idle';
            const isError = lib.loadStatus === 'error';
            const statusEl = isLoading
              ? <Loader size={11} className={styles.tpSpinner} />
              : isError
              ? <span title={lib.error}><AlertCircle size={11} className={styles.tpError} /></span>
              : lib.shapes.length > 0
              ? <span className={styles.count}>{lib.shapes.length}</span>
              : null;
            return (
              <div
                key={section.key}
                className={sectionClassName(section.key)}
                onDragOver={(e) => handleSectionDragOver(e, section.key)}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => handleSectionDrop(e, section.key)}
              >
                <div className={styles.categoryHeaderRow}>
                  <span
                    className={styles.gripHandle}
                    draggable
                    onDragStart={(e) => handleGripDragStart(e, section.key)}
                    onDragEnd={handleGripDragEnd}
                    title="Drag to reorder"
                    aria-label="Drag to reorder library"
                  >
                    <GripVertical size={11} />
                  </span>
                  <button className={styles.categoryHeader} onClick={() => toggle(section.key)}>
                    {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <span>{lib.name}</span>
                    {statusEl}
                  </button>
                </div>
                {isOpen && lib.loadStatus === 'loaded' && lib.shapes.length > 0 && (
                  <div className={styles.grid}>
                    {lib.shapes.map((shape) => {
                      const shapeType = shape.previewUrl ? 'drawio-image' : 'rectangle';
                      return (
                        <button
                          key={shape.id}
                          className={styles.shapeItem}
                          title={shape.title}
                          onClick={() => onAddShape(shapeType as ShapeType, shape.title, shape.previewUrl)}
                          draggable
                          onDragStart={(e) => {
                            e.stopPropagation();
                            e.dataTransfer.setData('shape-type', shapeType);
                            e.dataTransfer.setData('shape-label', shape.title);
                            if (shape.previewUrl) {
                              e.dataTransfer.setData('shape-data-url', shape.previewUrl);
                            }
                          }}
                        >
                          <DrawioShapePreview previewUrl={shape.previewUrl} title={shape.title} />
                          <span className={styles.shapeLabel}>{shape.title}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {isOpen && isError && (
                  <p className={styles.tpErrorMsg}>{lib.error ?? 'Failed to load library'}</p>
                )}
              </div>
            );
          }

          // custom
          const lib = section.lib;
          const isOpen = expanded.has(section.key);
          const isShapeDrop = dropTarget === lib.id;
          return (
            <div
              key={section.key}
              className={sectionClassName(section.key)}
              onDragOver={(e) => {
                // Section reorder takes priority; shape drops handled by the inner dropZone
                handleSectionDragOver(e, section.key);
              }}
              onDragLeave={() => { setDragOver(null); }}
              onDrop={(e) => handleSectionDrop(e, section.key)}
            >
              {renderSectionHeader(section.key, lib.name, lib.shapes.length)}
              {isOpen && (
                <>
                  {lib.shapes.length > 0 && (
                    <div className={styles.grid}>
                      {lib.shapes.map((shape) => (
                        <div key={shape.id} className={`${styles.shapeItem} ${styles.shapeItemWithRemove}`}>
                          <button
                            className={styles.shapeItem}
                            title={shape.label}
                            onClick={() => onAddShape(shape.type, shape.label)}
                            draggable
                            onDragStart={(e) => {
                              e.stopPropagation();
                              e.dataTransfer.setData('shape-type', shape.type);
                              e.dataTransfer.setData('shape-label', shape.label);
                            }}
                            style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: '100%' }}
                          >
                            <ShapePreview type={shape.type} />
                            <span className={styles.shapeLabel}>{shape.label}</span>
                          </button>
                          <button
                            className={styles.removeShapeBtn}
                            onClick={(e) => { e.stopPropagation(); libs.removeFromCustom(lib.id, shape.id); }}
                            type="button"
                            aria-label={`Remove ${shape.label}`}
                          >
                            &times;
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div
                    className={`${styles.dropZone} ${isShapeDrop ? styles.dropZoneActive : ''}`}
                    onDragOver={(e) => {
                      if (dragKey) return; // let section reorder handle it
                      e.preventDefault();
                      e.stopPropagation();
                      setDropTarget(lib.id);
                    }}
                    onDragLeave={() => setDropTarget(null)}
                    onDrop={(e) => {
                      if (dragKey) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setDropTarget(null);
                      const type = e.dataTransfer.getData('shape-type') as ShapeType;
                      const label = e.dataTransfer.getData('shape-label');
                      if (type && label) libs.addToCustom(lib.id, { type, label });
                    }}
                  >
                    Drag shapes here
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Third-party shape preview — shows actual image when a data URI is available
// ---------------------------------------------------------------------------

function DrawioShapePreview({ previewUrl, title }: { previewUrl?: string; title: string }) {
  const W = 32;
  const H = 28;
  if (previewUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={previewUrl}
        alt={title}
        width={W}
        height={H}
        style={{ objectFit: 'contain', display: 'block' }}
        draggable={false}
      />
    );
  }
  // Fallback: abbreviated title in a rounded rect
  return (
    <svg width={W} height={H}>
      <rect x={1} y={1} width={W - 2} height={H - 2} rx={4} fill="#f1f5f9" stroke="#94a3b8" strokeWidth={1} />
      <text x={W / 2} y={H / 2 + 3} textAnchor="middle" fontSize={7} fill="#64748b" fontWeight="600">
        {title.slice(0, 3)}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Mini SVG preview for each shape type in the library panel
// ---------------------------------------------------------------------------

function ShapePreview({ type }: { type: ShapeType }) {
  const W = 32;
  const H = 20;
  const style = { fill: '#e2e8f0', stroke: '#94a3b8', strokeWidth: 1 };

  switch (type) {
    case 'rectangle':
    case 'flowchart-process':
      return <svg width={W} height={H}><rect x={1} y={1} width={W - 2} height={H - 2} {...style} /></svg>;
    case 'rounded-rectangle':
    case 'flowchart-terminator':
      return <svg width={W} height={H}><rect x={1} y={1} width={W - 2} height={H - 2} rx={H / 2 - 1} {...style} /></svg>;
    case 'ellipse':
    case 'circle':
      return <svg width={W} height={H}><ellipse cx={W / 2} cy={H / 2} rx={W / 2 - 1} ry={H / 2 - 1} {...style} /></svg>;
    case 'diamond':
    case 'flowchart-decision':
      return (
        <svg width={W} height={H}>
          <polygon points={`${W / 2},1 ${W - 1},${H / 2} ${W / 2},${H - 1} 1,${H / 2}`} {...style} />
        </svg>
      );
    case 'triangle':
      return (
        <svg width={W} height={H}>
          <polygon points={`${W / 2},1 ${W - 1},${H - 1} 1,${H - 1}`} {...style} />
        </svg>
      );
    case 'hexagon':
      return (
        <svg width={W} height={H}>
          <polygon
            points={`${W * 0.25},1 ${W * 0.75},1 ${W - 1},${H / 2} ${W * 0.75},${H - 1} ${W * 0.25},${H - 1} 1,${H / 2}`}
            {...style}
          />
        </svg>
      );
    // BPMN
    case 'bpmn-start-event':
      return <svg width={W} height={H}><circle cx={W/2} cy={H/2} r={Math.min(W,H)/2-1} fill="#dcfce7" stroke="#16a34a" strokeWidth={1.5} /></svg>;
    case 'bpmn-end-event':
      return <svg width={W} height={H}><circle cx={W/2} cy={H/2} r={Math.min(W,H)/2-1} fill="#fee2e2" stroke="#dc2626" strokeWidth={3} /></svg>;
    case 'bpmn-intermediate-event': {
      const r = Math.min(W,H)/2-1;
      return <svg width={W} height={H}><circle cx={W/2} cy={H/2} r={r} fill="#fff7ed" stroke="#ea580c" strokeWidth={1.5} /><circle cx={W/2} cy={H/2} r={r*0.75} fill="none" stroke="#ea580c" strokeWidth={1.5} /></svg>;
    }
    case 'bpmn-task':
      return <svg width={W} height={H}><rect x={1} y={1} width={W-2} height={H-2} rx={4} fill="#eff6ff" stroke="#2563eb" strokeWidth={1} /></svg>;
    case 'bpmn-gateway-exclusive': {
      const pts = `${W/2},1 ${W-1},${H/2} ${W/2},${H-1} 1,${H/2}`;
      const ms = 4;
      return <svg width={W} height={H}><polygon points={pts} fill="#fafaf9" stroke="#374151" strokeWidth={1} /><line x1={W/2-ms} y1={H/2-ms} x2={W/2+ms} y2={H/2+ms} stroke="#374151" strokeWidth={1.5}/><line x1={W/2+ms} y1={H/2-ms} x2={W/2-ms} y2={H/2+ms} stroke="#374151" strokeWidth={1.5}/></svg>;
    }
    case 'bpmn-gateway-parallel': {
      const pts = `${W/2},1 ${W-1},${H/2} ${W/2},${H-1} 1,${H/2}`;
      const ms = 4;
      return <svg width={W} height={H}><polygon points={pts} fill="#fafaf9" stroke="#374151" strokeWidth={1} /><line x1={W/2} y1={H/2-ms} x2={W/2} y2={H/2+ms} stroke="#374151" strokeWidth={1.5}/><line x1={W/2-ms} y1={H/2} x2={W/2+ms} y2={H/2} stroke="#374151" strokeWidth={1.5}/></svg>;
    }
    case 'bpmn-gateway-inclusive': {
      const pts = `${W/2},1 ${W-1},${H/2} ${W/2},${H-1} 1,${H/2}`;
      return <svg width={W} height={H}><polygon points={pts} fill="#fafaf9" stroke="#374151" strokeWidth={1} /><circle cx={W/2} cy={H/2} r={4} fill="none" stroke="#374151" strokeWidth={1.5}/></svg>;
    }
    case 'bpmn-pool':
      return <svg width={W} height={H}><rect x={1} y={1} width={W-2} height={H-2} fill="#f8fafc" stroke="#374151" strokeWidth={1} /><line x1={8} y1={1} x2={8} y2={H-1} stroke="#374151" strokeWidth={1}/></svg>;

    // ERD
    case 'erd-entity':
      return <svg width={W} height={H}><rect x={1} y={1} width={W-2} height={H-2} fill="#eff6ff" stroke="#2563eb" strokeWidth={1} /></svg>;
    case 'erd-weak-entity':
      return <svg width={W} height={H}><rect x={1} y={1} width={W-2} height={H-2} fill="#eff6ff" stroke="#2563eb" strokeWidth={1} /><rect x={3} y={3} width={W-6} height={H-6} fill="none" stroke="#2563eb" strokeWidth={1} /></svg>;
    case 'erd-attribute':
      return <svg width={W} height={H}><ellipse cx={W/2} cy={H/2} rx={W/2-1} ry={H/2-1} fill="#ffffff" stroke="#374151" strokeWidth={1} /></svg>;
    case 'erd-key-attribute':
      return <svg width={W} height={H}><ellipse cx={W/2} cy={H/2} rx={W/2-1} ry={H/2-1} fill="#ffffff" stroke="#374151" strokeWidth={1} /><line x1={W*0.25} y1={H*0.72} x2={W*0.75} y2={H*0.72} stroke="#374151" strokeWidth={1.5}/></svg>;
    case 'erd-relationship': {
      const pts = `${W/2},1 ${W-1},${H/2} ${W/2},${H-1} 1,${H/2}`;
      return <svg width={W} height={H}><polygon points={pts} fill="#fefce8" stroke="#ca8a04" strokeWidth={1} /></svg>;
    }
    case 'erd-identifying-relationship': {
      const pts = `${W/2},1 ${W-1},${H/2} ${W/2},${H-1} 1,${H/2}`;
      const inner = `${W/2},4 ${W-4},${H/2} ${W/2},${H-4} 4,${H/2}`;
      return <svg width={W} height={H}><polygon points={pts} fill="#fefce8" stroke="#ca8a04" strokeWidth={1} /><polygon points={inner} fill="none" stroke="#ca8a04" strokeWidth={1} /></svg>;
    }

    // AWS — orange-tinted rectangles with rounded corners
    case 'aws-ec2':
    case 'aws-cloudfront':
      return <svg width={W} height={H}><rect x={1} y={1} width={W-2} height={H-2} rx={3} fill="#fff7ed" stroke="#ea580c" strokeWidth={1} /><text x={W/2} y={H/2+4} textAnchor="middle" fontSize={7} fill="#ea580c" fontWeight="600">{type === 'aws-ec2' ? 'EC2' : 'CF'}</text></svg>;
    case 'aws-s3':
      return <svg width={W} height={H}><rect x={1} y={1} width={W-2} height={H-2} rx={3} fill="#f0fdf4" stroke="#16a34a" strokeWidth={1} /><text x={W/2} y={H/2+4} textAnchor="middle" fontSize={8} fill="#16a34a" fontWeight="600">S3</text></svg>;
    case 'aws-rds':
      return <svg width={W} height={H}><rect x={1} y={1} width={W-2} height={H-2} rx={3} fill="#eff6ff" stroke="#2563eb" strokeWidth={1} /><text x={W/2} y={H/2+4} textAnchor="middle" fontSize={7} fill="#2563eb" fontWeight="600">RDS</text></svg>;
    case 'aws-lambda':
      return <svg width={W} height={H}><rect x={1} y={1} width={W-2} height={H-2} rx={3} fill="#faf5ff" stroke="#9333ea" strokeWidth={1} /><text x={W/2} y={H/2+4} textAnchor="middle" fontSize={8} fill="#9333ea" fontWeight="600">λ</text></svg>;
    case 'aws-api-gateway':
    case 'aws-elb': {
      const hx = W*0.2;
      return <svg width={W} height={H}><polygon points={`${hx},1 ${W-hx},1 ${W-1},${H/2} ${W-hx},${H-1} ${hx},${H-1} 1,${H/2}`} fill="#fdf4ff" stroke="#a855f7" strokeWidth={1} /></svg>;
    }
    case 'aws-sns':
    case 'aws-sqs': {
      const hx = W*0.2;
      return <svg width={W} height={H}><polygon points={`${hx},1 ${W-hx},1 ${W-1},${H/2} ${W-hx},${H-1} ${hx},${H-1} 1,${H/2}`} fill="#fff7ed" stroke="#f97316" strokeWidth={1} /></svg>;
    }
    case 'aws-vpc':
      return <svg width={W} height={H}><rect x={1} y={1} width={W-2} height={H-2} rx={3} fill="#f0fdf4" stroke="#16a34a" strokeWidth={1} strokeDasharray="3 2" /></svg>;

    // Azure — blue-tinted
    case 'azure-vm':
    case 'azure-blob':
    case 'azure-sql':
    case 'azure-function':
    case 'azure-apim': {
      const aLabel: Record<string, string> = { 'azure-vm': 'VM', 'azure-blob': 'Blob', 'azure-sql': 'SQL', 'azure-function': 'Fn', 'azure-apim': 'APIM' };
      const aColor = type === 'azure-function' ? { fill: '#faf5ff', stroke: '#7c3aed' } : { fill: '#eff6ff', stroke: '#0078d4' };
      return <svg width={W} height={H}><rect x={1} y={1} width={W-2} height={H-2} rx={3} fill={aColor.fill} stroke={aColor.stroke} strokeWidth={1} /><text x={W/2} y={H/2+4} textAnchor="middle" fontSize={7} fill={aColor.stroke} fontWeight="600">{aLabel[type]}</text></svg>;
    }

    // GCP — colored rounded rects
    case 'gcp-compute':
    case 'gcp-storage':
    case 'gcp-sql':
    case 'gcp-function':
    case 'gcp-pubsub': {
      const gLabel: Record<string, string> = { 'gcp-compute': 'GCE', 'gcp-storage': 'GCS', 'gcp-sql': 'SQL', 'gcp-function': 'Fn', 'gcp-pubsub': 'PS' };
      const gColors: Record<string, { fill: string; stroke: string }> = { 'gcp-compute': { fill: '#fef2f2', stroke: '#dc2626' }, 'gcp-storage': { fill: '#f0fdf4', stroke: '#16a34a' }, 'gcp-sql': { fill: '#eff6ff', stroke: '#2563eb' }, 'gcp-function': { fill: '#faf5ff', stroke: '#9333ea' }, 'gcp-pubsub': { fill: '#fff7ed', stroke: '#f97316' } };
      const gc = gColors[type] ?? { fill: '#f8f9fa', stroke: '#374151' };
      return <svg width={W} height={H}><rect x={1} y={1} width={W-2} height={H-2} rx={3} fill={gc.fill} stroke={gc.stroke} strokeWidth={1} /><text x={W/2} y={H/2+4} textAnchor="middle" fontSize={7} fill={gc.stroke} fontWeight="600">{gLabel[type]}</text></svg>;
    }

    case 'sticky-note': {
      const fold = 5;
      const noteStyle = { fill: '#fef9c3', stroke: '#ca8a04', strokeWidth: 1 };
      return (
        <svg width={W} height={H}>
          <path d={`M 1 1 L ${W - fold - 1} 1 L ${W - 1} ${fold + 1} L ${W - 1} ${H - 1} L 1 ${H - 1} Z`} {...noteStyle} />
          <path d={`M ${W - fold - 1} 1 L ${W - fold - 1} ${fold + 1} L ${W - 1} ${fold + 1}`} fill="none" stroke="#ca8a04" strokeWidth={0.8} />
        </svg>
      );
    }
    case 'arrow-right':
    case 'arrow-left':
    case 'arrow-up':
    case 'arrow-down':
    case 'arrow-left-right':
    case 'arrow-up-down':
    case 'arrow-bent':
    case 'arrow-circular':
    case 'arrow-pentagon':
    case 'arrow-notched':
    case 'arrow-quad':
      return (
        <svg width={W} height={H}>
          <path d={getShapePath(type, W, H)} fill="#dbeafe" stroke="#2563eb" strokeWidth={0.8} />
        </svg>
      );
    default:
      return <svg width={W} height={H}><rect x={1} y={1} width={W - 2} height={H - 2} {...style} /></svg>;
  }
}
