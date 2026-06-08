'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ShapeType } from '../types';
import { SHAPE_CATEGORIES, getShapesByCategory } from './shapes/ShapeLibrary';
import styles from './ShapePanel.module.css';

interface ShapePanelProps {
  onAddShape: (type: ShapeType, label: string) => void;
}

export function ShapePanel({ onAddShape }: ShapePanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['Basic', 'Flowchart']));

  const toggle = (cat: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>Shapes</div>
      <div className={styles.scroll}>
        {SHAPE_CATEGORIES.map((cat) => {
          const shapes = getShapesByCategory(cat);
          const isOpen = expanded.has(cat);
          return (
            <div key={cat} className={styles.category}>
              <button className={styles.categoryHeader} onClick={() => toggle(cat)}>
                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span>{cat}</span>
                <span className={styles.count}>{shapes.length}</span>
              </button>
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
        })}
      </div>
    </div>
  );
}

// Mini SVG preview for each shape type in the library panel
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
    default:
      return <svg width={W} height={H}><rect x={1} y={1} width={W - 2} height={H - 2} {...style} /></svg>;
  }
}
