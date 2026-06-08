'use client';

import React from 'react';
import type { DiagramPage, EditorSelection, DiagramShape, DiagramConnector } from '../types';
import styles from './PropertiesPanel.module.css';

interface PropertiesPanelProps {
  selection: EditorSelection;
  page: DiagramPage;
  onShapeUpdate: (id: string, changes: Partial<DiagramShape>) => void;
  onConnectorUpdate: (id: string, changes: Partial<DiagramConnector>) => void;
}

export function PropertiesPanel({
  selection,
  page,
  onShapeUpdate,
  onConnectorUpdate,
}: PropertiesPanelProps) {
  const selectedShapes = page.shapes.filter((s) => selection.shapeIds.has(s.id));
  const selectedConnectors = page.connectors.filter((c) => selection.connectorIds.has(c.id));
  const singleShape = selectedShapes.length === 1 ? selectedShapes[0] : null;
  const singleConnector = selectedConnectors.length === 1 ? selectedConnectors[0] : null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>Properties</div>
      <div className={styles.scroll}>
        {!singleShape && !singleConnector && (
          <div className={styles.empty}>
            Select a shape or connector to edit its properties.
          </div>
        )}

        {singleShape && (
          <ShapeProperties
            shape={singleShape}
            onUpdate={(changes) => onShapeUpdate(singleShape.id, changes)}
          />
        )}

        {singleConnector && (
          <ConnectorProperties
            connector={singleConnector}
            onUpdate={(changes) => onConnectorUpdate(singleConnector.id, changes)}
          />
        )}

        {selectedShapes.length > 1 && (
          <MultiShapeProperties
            shapes={selectedShapes}
            onUpdate={(changes) => {
              selectedShapes.forEach((s) => onShapeUpdate(s.id, changes));
            }}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single shape properties
// ---------------------------------------------------------------------------

function ShapeProperties({
  shape,
  onUpdate,
}: {
  shape: DiagramShape;
  onUpdate: (changes: Partial<DiagramShape>) => void;
}) {
  const { style, x, y, width, height, rotation } = shape;

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Geometry</div>
      <div className={styles.row}>
        <label>X</label>
        <input
          type="number"
          value={Math.round(x)}
          onChange={(e) => onUpdate({ x: Number(e.target.value) })}
          className={styles.numInput}
        />
        <label>Y</label>
        <input
          type="number"
          value={Math.round(y)}
          onChange={(e) => onUpdate({ y: Number(e.target.value) })}
          className={styles.numInput}
        />
      </div>
      <div className={styles.row}>
        <label>W</label>
        <input
          type="number"
          value={Math.round(width)}
          onChange={(e) => onUpdate({ width: Math.max(10, Number(e.target.value)) })}
          className={styles.numInput}
        />
        <label>H</label>
        <input
          type="number"
          value={Math.round(height)}
          onChange={(e) => onUpdate({ height: Math.max(10, Number(e.target.value)) })}
          className={styles.numInput}
        />
      </div>
      <div className={styles.row}>
        <label>Rotation</label>
        <input
          type="number"
          value={rotation ?? 0}
          onChange={(e) => onUpdate({ rotation: Number(e.target.value) })}
          className={styles.numInput}
        />
        °
      </div>

      <div className={styles.sectionTitle}>Style</div>
      <div className={styles.row}>
        <label>Fill</label>
        <input
          type="color"
          value={style.fill}
          onChange={(e) =>
            onUpdate({ style: { ...style, fill: e.target.value } })
          }
          className={styles.colorInput}
        />
      </div>
      <div className={styles.row}>
        <label>Stroke</label>
        <input
          type="color"
          value={style.stroke}
          onChange={(e) =>
            onUpdate({ style: { ...style, stroke: e.target.value } })
          }
          className={styles.colorInput}
        />
        <label>Width</label>
        <input
          type="number"
          min={0.5}
          max={20}
          step={0.5}
          value={style.strokeWidth}
          onChange={(e) =>
            onUpdate({ style: { ...style, strokeWidth: Number(e.target.value) } })
          }
          className={styles.numInput}
        />
      </div>
      <div className={styles.row}>
        <label>Text color</label>
        <input
          type="color"
          value={style.textColor}
          onChange={(e) =>
            onUpdate({ style: { ...style, textColor: e.target.value } })
          }
          className={styles.colorInput}
        />
      </div>
      <div className={styles.row}>
        <label>Font size</label>
        <input
          type="number"
          min={8}
          max={72}
          value={style.fontSize}
          onChange={(e) =>
            onUpdate({ style: { ...style, fontSize: Number(e.target.value) } })
          }
          className={styles.numInput}
        />
      </div>
      <div className={styles.row}>
        <label>Opacity</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={style.opacity}
          onChange={(e) =>
            onUpdate({ style: { ...style, opacity: Number(e.target.value) } })
          }
          className={styles.rangeInput}
        />
        <span>{Math.round(style.opacity * 100)}%</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single connector properties
// ---------------------------------------------------------------------------

function ConnectorProperties({
  connector,
  onUpdate,
}: {
  connector: DiagramConnector;
  onUpdate: (changes: Partial<DiagramConnector>) => void;
}) {
  const { style, type, label } = connector;

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Connector</div>
      <div className={styles.row}>
        <label>Type</label>
        <select
          value={type}
          onChange={(e) => onUpdate({ type: e.target.value as DiagramConnector['type'] })}
          className={styles.select}
        >
          <option value="straight">Straight</option>
          <option value="orthogonal">Orthogonal</option>
          <option value="curved">Curved</option>
          <option value="elbow">Elbow</option>
        </select>
      </div>
      <div className={styles.row}>
        <label>Label</label>
        <input
          type="text"
          value={label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          className={styles.textInput}
        />
      </div>
      <div className={styles.sectionTitle}>Style</div>
      <div className={styles.row}>
        <label>Color</label>
        <input
          type="color"
          value={style.stroke}
          onChange={(e) =>
            onUpdate({ style: { ...style, stroke: e.target.value } })
          }
          className={styles.colorInput}
        />
        <label>Width</label>
        <input
          type="number"
          min={0.5}
          max={10}
          step={0.5}
          value={style.strokeWidth}
          onChange={(e) =>
            onUpdate({ style: { ...style, strokeWidth: Number(e.target.value) } })
          }
          className={styles.numInput}
        />
      </div>
      <div className={styles.row}>
        <label>End arrow</label>
        <select
          value={style.endArrow}
          onChange={(e) =>
            onUpdate({ style: { ...style, endArrow: e.target.value as DiagramConnector['style']['endArrow'] } })
          }
          className={styles.select}
        >
          <option value="none">None</option>
          <option value="filled">Filled</option>
          <option value="open">Open</option>
          <option value="diamond">Diamond</option>
          <option value="circle">Circle</option>
        </select>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-shape bulk properties
// ---------------------------------------------------------------------------

function MultiShapeProperties({
  shapes,
  onUpdate,
}: {
  shapes: DiagramShape[];
  onUpdate: (changes: Partial<DiagramShape>) => void;
}) {
  const firstStyle = shapes[0].style;

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>
        {shapes.length} shapes selected
      </div>
      <div className={styles.row}>
        <label>Fill</label>
        <input
          type="color"
          value={firstStyle.fill}
          onChange={(e) =>
            onUpdate({ style: { ...firstStyle, fill: e.target.value } })
          }
          className={styles.colorInput}
        />
      </div>
      <div className={styles.row}>
        <label>Stroke</label>
        <input
          type="color"
          value={firstStyle.stroke}
          onChange={(e) =>
            onUpdate({ style: { ...firstStyle, stroke: e.target.value } })
          }
          className={styles.colorInput}
        />
      </div>
    </div>
  );
}
