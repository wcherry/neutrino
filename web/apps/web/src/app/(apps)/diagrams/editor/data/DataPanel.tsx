'use client';

import React, { useRef, useState } from 'react';
import { Upload, X, Database, AlertCircle } from 'lucide-react';
import type { DiagramShape, DataBinding, ConditionalRule, ShapeStyle } from '../../types';
import styles from './DataPanel.module.css';

interface DataPanelProps {
  selectedShape: DiagramShape | null;
  onImport: (rows: Record<string, string>[], labelField: string) => void;
  onUpdateBinding: (shapeId: string, binding: DataBinding | undefined) => void;
  onUpdateRules: (shapeId: string, rules: ConditionalRule[]) => void;
}

// ---------------------------------------------------------------------------
// CSV parser (RFC 4180 subset)
// ---------------------------------------------------------------------------

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DataPanel({ selectedShape, onImport, onUpdateBinding, onUpdateRules }: DataPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Record<string, string>[] | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [labelField, setLabelField] = useState('');
  const [parseError, setParseError] = useState('');
  const [tab, setTab] = useState<'import' | 'binding' | 'rules'>('import');

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError('');

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      try {
        let rows: Record<string, string>[];
        if (file.name.endsWith('.json')) {
          const parsed = JSON.parse(text);
          rows = Array.isArray(parsed) ? parsed : [parsed];
        } else {
          rows = parseCsv(text);
        }
        if (rows.length === 0) { setParseError('No data rows found.'); return; }
        const hdrs = Object.keys(rows[0]);
        setHeaders(hdrs);
        setLabelField(hdrs[0] ?? '');
        setPreview(rows.slice(0, 5));
      } catch {
        setParseError('Failed to parse file. Expected CSV or JSON.');
      }
    };
    reader.readAsText(file);
  };

  const handleImport = () => {
    if (!preview || !labelField) return;
    // Re-read full file — for simplicity use preview rows here
    onImport(preview, labelField);
    setPreview(null);
    setHeaders([]);
    setLabelField('');
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <Database size={14} />
        <span>Data</span>
      </div>

      <div className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'import' ? styles.activeTab : ''}`} onClick={() => setTab('import')}>Import</button>
        <button className={`${styles.tab} ${tab === 'binding' ? styles.activeTab : ''}`} onClick={() => setTab('binding')}>Binding</button>
        <button className={`${styles.tab} ${tab === 'rules' ? styles.activeTab : ''}`} onClick={() => setTab('rules')}>Format</button>
      </div>

      {tab === 'import' && (
        <div className={styles.section}>
          <p className={styles.hint}>Upload a CSV or JSON file to create shapes from data rows.</p>

          <button className={styles.uploadBtn} onClick={() => fileRef.current?.click()}>
            <Upload size={14} />
            Choose file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.json"
            style={{ display: 'none' }}
            onChange={handleFile}
          />

          {parseError && (
            <div className={styles.error}><AlertCircle size={12} /> {parseError}</div>
          )}

          {preview && preview.length > 0 && (
            <>
              <div className={styles.row}>
                <label className={styles.label}>Label field</label>
                <select
                  value={labelField}
                  onChange={(e) => setLabelField(e.target.value)}
                  className={styles.select}
                >
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>

              <div className={styles.previewTable}>
                <div className={styles.previewHeader}>
                  {headers.map((h) => <span key={h}>{h}</span>)}
                </div>
                {preview.map((row, i) => (
                  <div key={i} className={styles.previewRow}>
                    {headers.map((h) => <span key={h}>{row[h]}</span>)}
                  </div>
                ))}
              </div>

              <button className={styles.importBtn} onClick={handleImport}>
                Import {preview.length} rows
              </button>
            </>
          )}
        </div>
      )}

      {tab === 'binding' && (
        <DataBindingSection
          shape={selectedShape}
          onUpdateBinding={onUpdateBinding}
        />
      )}

      {tab === 'rules' && (
        <ConditionalRulesSection
          shape={selectedShape}
          onUpdateRules={onUpdateRules}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data binding section
// ---------------------------------------------------------------------------

function DataBindingSection({
  shape,
  onUpdateBinding,
}: {
  shape: DiagramShape | null;
  onUpdateBinding: (shapeId: string, binding: DataBinding | undefined) => void;
}) {
  if (!shape) {
    return <div className={styles.empty}>Select a shape to configure its data binding.</div>;
  }

  const binding = shape.dataBinding;
  const fields = shape.boundData ? Object.keys(shape.boundData) : [];

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Shape: <em>{shape.label || shape.id.slice(0, 8)}</em></div>

      {fields.length > 0 ? (
        <>
          <div className={styles.row}>
            <label className={styles.label}>Label field</label>
            <select
              value={binding?.labelField ?? ''}
              onChange={(e) => onUpdateBinding(shape.id, { ...binding, labelField: e.target.value })}
              className={styles.select}
            >
              <option value="">— none —</option>
              {fields.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className={styles.row}>
            <label className={styles.label}>Status field</label>
            <select
              value={binding?.statusField ?? ''}
              onChange={(e) => onUpdateBinding(shape.id, { ...binding, labelField: binding?.labelField ?? '', statusField: e.target.value || undefined })}
              className={styles.select}
            >
              <option value="">— none —</option>
              {fields.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          {binding?.labelField && (
            <button
              className={styles.clearBtn}
              onClick={() => onUpdateBinding(shape.id, undefined)}
            >
              <X size={12} /> Remove binding
            </button>
          )}
        </>
      ) : (
        <div className={styles.empty}>This shape has no bound data. Import a dataset first.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conditional formatting rules section
// ---------------------------------------------------------------------------

const RULE_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  green:  { fill: '#dcfce7', stroke: '#16a34a', text: '#15803d' },
  yellow: { fill: '#fef9c3', stroke: '#ca8a04', text: '#854d0e' },
  red:    { fill: '#fee2e2', stroke: '#dc2626', text: '#991b1b' },
  blue:   { fill: '#dbeafe', stroke: '#2563eb', text: '#1d4ed8' },
};

function ConditionalRulesSection({
  shape,
  onUpdateRules,
}: {
  shape: DiagramShape | null;
  onUpdateRules: (shapeId: string, rules: ConditionalRule[]) => void;
}) {
  const [newField, setNewField] = useState('');
  const [newOp, setNewOp] = useState<ConditionalRule['operator']>('eq');
  const [newValue, setNewValue] = useState('');
  const [newColor, setNewColor] = useState('green');

  if (!shape) {
    return <div className={styles.empty}>Select a shape to add conditional formatting.</div>;
  }

  const rules = shape.conditionalRules ?? [];
  const fields = shape.boundData ? Object.keys(shape.boundData) : [];

  const addRule = () => {
    if (!newField || !newValue) return;
    const colorStyle = RULE_COLORS[newColor] ?? RULE_COLORS.green;
    const style: Partial<ShapeStyle> = {
      fill: colorStyle.fill,
      stroke: colorStyle.stroke,
      textColor: colorStyle.text,
    };
    const rule: ConditionalRule = {
      id: crypto.randomUUID(),
      field: newField,
      operator: newOp,
      value: newValue,
      style,
    };
    onUpdateRules(shape.id, [...rules, rule]);
    setNewField('');
    setNewValue('');
  };

  const removeRule = (id: string) => {
    onUpdateRules(shape.id, rules.filter((r) => r.id !== id));
  };

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Conditional rules for: <em>{shape.label || shape.id.slice(0, 8)}</em></div>

      {rules.map((rule) => (
        <div key={rule.id} className={styles.ruleRow}>
          <span className={styles.ruleText}>
            {rule.field} {rule.operator} &ldquo;{rule.value}&rdquo;
          </span>
          <span
            className={styles.ruleSwatch}
            style={{ background: rule.style.fill, border: `2px solid ${rule.style.stroke}` }}
          />
          <button className={styles.ruleRemove} onClick={() => removeRule(rule.id)}>
            <X size={11} />
          </button>
        </div>
      ))}

      <div className={styles.addRule}>
        <div className={styles.row}>
          <label className={styles.label}>Field</label>
          {fields.length > 0 ? (
            <select value={newField} onChange={(e) => setNewField(e.target.value)} className={styles.select}>
              <option value="">— pick —</option>
              {fields.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          ) : (
            <input
              className={styles.textInput}
              placeholder="field name"
              value={newField}
              onChange={(e) => setNewField(e.target.value)}
            />
          )}
        </div>
        <div className={styles.row}>
          <label className={styles.label}>Op</label>
          <select value={newOp} onChange={(e) => setNewOp(e.target.value as ConditionalRule['operator'])} className={styles.select}>
            <option value="eq">equals</option>
            <option value="neq">not equals</option>
            <option value="gt">greater than</option>
            <option value="lt">less than</option>
            <option value="contains">contains</option>
          </select>
        </div>
        <div className={styles.row}>
          <label className={styles.label}>Value</label>
          <input
            className={styles.textInput}
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="e.g. Online"
          />
        </div>
        <div className={styles.row}>
          <label className={styles.label}>Color</label>
          <select value={newColor} onChange={(e) => setNewColor(e.target.value)} className={styles.select}>
            <option value="green">Green (healthy)</option>
            <option value="yellow">Yellow (warning)</option>
            <option value="red">Red (critical)</option>
            <option value="blue">Blue (info)</option>
          </select>
        </div>
        <button className={styles.importBtn} onClick={addRule} disabled={!newField || !newValue}>
          Add rule
        </button>
      </div>
    </div>
  );
}
