'use client';

import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { DiagramPage, DiagramShape, DiagramConnector } from '../../types';
import { analyzeDiagram, parseAiDiagramResponse } from './aiDiagramUtils';
import styles from './AiDiagramPanel.module.css';

const EXAMPLE_PROMPTS = [
  'Microservice architecture',
  'User auth flow',
  'CI/CD pipeline',
  'Database schema',
];

interface AiDiagramPanelProps {
  activePage: DiagramPage;
  onAddShapes: (shapes: DiagramShape[]) => void;
  onAddConnectors: (connectors: DiagramConnector[]) => void;
  onSetSelection: (shapeIds: string[]) => void;
  onRunLayout: () => void;
}

type Tab = 'generate' | 'analyze' | 'refactor';

export function AiDiagramPanel({
  activePage,
  onAddShapes,
  onAddConnectors,
  onSetSelection,
  onRunLayout,
}: AiDiagramPanelProps) {
  const [tab, setTab] = useState<Tab>('generate');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ReturnType<typeof analyzeDiagram> | null>(null);

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/ai/diagram-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `Request failed ${res.status}`);
      }
      const data = await res.json() as { shapes: DiagramShape[]; connectors: DiagramConnector[] };
      onAddShapes(data.shapes);
      onAddConnectors(data.connectors);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI request failed');
    } finally {
      setLoading(false);
    }
  }

  function handleAnalyze() {
    setError(null);
    const result = analyzeDiagram(activePage);
    setAnalysis(result);
  }

  function handleConvertBpmn() {
    const bpmnMap: Record<string, string> = {
      'flowchart-process': 'bpmn-task',
      'flowchart-decision': 'bpmn-gateway-exclusive',
      'flowchart-terminator': 'bpmn-end-event',
      'ellipse': 'bpmn-start-event',
      'circle': 'bpmn-start-event',
    };
    const updated = activePage.shapes.map((s) => ({
      ...s,
      type: (bpmnMap[s.type] ?? s.type) as DiagramShape['type'],
    }));
    onAddShapes(updated);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <Sparkles size={13} className={styles.headerIcon} />
        AI Diagrams
      </div>

      <div className={styles.tabs}>
        {(['generate', 'analyze', 'refactor'] as Tab[]).map((t) => (
          <button key={t} className={`${styles.tab} ${tab === t ? styles.active : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className={styles.content}>
        {tab === 'generate' && (
          <>
            <p className={styles.label}>Describe the diagram you want to create…</p>
            <textarea
              className={styles.textarea}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. A microservice architecture with an API gateway, auth service, and database"
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
            />
            <div className={styles.chips}>
              {EXAMPLE_PROMPTS.map((p) => (
                <button key={p} className={styles.chip} onClick={() => setPrompt(p)}>
                  {p}
                </button>
              ))}
            </div>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={handleGenerate}
              disabled={loading || !prompt.trim()}
            >
              {loading ? 'Generating…' : 'Generate'}
            </button>
          </>
        )}

        {tab === 'analyze' && (
          <>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleAnalyze}>
              Analyze Diagram
            </button>

            {analysis && (
              <>
                <div className={styles.analysisSection}>
                  <div className={styles.analysisSectionTitle}>Orphaned Nodes</div>
                  {analysis.orphanedNodes.length === 0 ? (
                    <div className={styles.empty}>None</div>
                  ) : (
                    analysis.orphanedNodes.map((id) => {
                      const shape = activePage.shapes.find((s) => s.id === id);
                      return (
                        <div key={id} className={styles.analysisItem}>
                          <button className={styles.analysisItemBtn} onClick={() => onSetSelection([id])}>
                            {shape?.label || id}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className={styles.analysisSection}>
                  <div className={styles.analysisSectionTitle}>Missing Outbound Connections</div>
                  {analysis.missingConnections.length === 0 ? (
                    <div className={styles.empty}>None</div>
                  ) : (
                    analysis.missingConnections.map((id) => {
                      const shape = activePage.shapes.find((s) => s.id === id);
                      return (
                        <div key={id} className={styles.analysisItem}>
                          <button className={styles.analysisItemBtn} onClick={() => onSetSelection([id])}>
                            {shape?.label || id}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className={styles.analysisSection}>
                  <div className={styles.analysisSectionTitle}>Circular Dependencies</div>
                  {analysis.circularDependencies.length === 0 ? (
                    <div className={styles.empty}>None</div>
                  ) : (
                    analysis.circularDependencies.map((cycle, i) => (
                      <div key={i} className={styles.analysisItem}>
                        {cycle.map((id) => activePage.shapes.find((s) => s.id === id)?.label || id).join(' → ')}
                      </div>
                    ))
                  )}
                </div>

                <div className={styles.analysisSection}>
                  <div className={styles.analysisSectionTitle}>Isolated Clusters</div>
                  <div className={styles.stat}>{analysis.isolatedClusters} cluster{analysis.isolatedClusters !== 1 ? 's' : ''}</div>
                </div>
              </>
            )}
          </>
        )}

        {tab === 'refactor' && (
          <>
            <button className={styles.btn} onClick={handleConvertBpmn}>
              Convert to BPMN
            </button>
            <button className={styles.btn} onClick={onRunLayout}>
              Clean up layout
            </button>
          </>
        )}

        {error && <div className={styles.error}>{error}</div>}
      </div>
    </div>
  );
}
