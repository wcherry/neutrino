'use client';

import React, { useState } from 'react';
import { Sparkles, Send, Lightbulb, X, AlertCircle } from 'lucide-react';
import { Button } from '@neutrino/ui';
import { sheetsAI, ExploreResponse, Insight } from '@/lib/api';
import styles from './ExplorePanel.module.css';

interface ExplorePanelProps {
  sheetId: string;
  /** Current sheet data serialized as JSON string (passed from the editor) */
  getSheetData: () => string;
  onClose: () => void;
}

export function ExplorePanel({ sheetId, getSheetData, onClose }: ExplorePanelProps) {
  const [question, setQuestion] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [isFetchingInsights, setIsFetchingInsights] = useState(false);
  const [exploreResult, setExploreResult] = useState<ExploreResponse | null>(null);
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAsk() {
    if (!question.trim()) return;
    setIsAsking(true);
    setError(null);
    setExploreResult(null);
    try {
      const sheetData = getSheetData();
      const result = await sheetsAI.explore(sheetId, question.trim(), sheetData);
      setExploreResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get answer');
    } finally {
      setIsAsking(false);
    }
  }

  async function handleGetInsights() {
    setIsFetchingInsights(true);
    setError(null);
    setInsights(null);
    try {
      const sheetData = getSheetData();
      const result = await sheetsAI.insights(sheetId, sheetData);
      setInsights(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get insights');
    } finally {
      setIsFetchingInsights(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <Sparkles size={16} />
          <span>AI Explore</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close AI panel">
          <X size={16} />
        </button>
      </div>

      <div className={styles.content}>
        {/* Question input */}
        <div className={styles.section}>
          <p className={styles.sectionLabel}>Ask a question about your data</p>
          <div className={styles.inputRow}>
            <input
              className={styles.questionInput}
              type="text"
              placeholder="e.g. What is the average revenue?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isAsking}
            />
            <Button
              variant="primary"
              icon={<Send size={14} />}
              onClick={handleAsk}
              disabled={isAsking || !question.trim()}
            >
              {isAsking ? 'Asking…' : 'Ask'}
            </Button>
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div className={styles.error}>
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {/* Explore result */}
        {exploreResult && (
          <div className={styles.resultCard}>
            <p className={styles.answerText}>{exploreResult.answer}</p>
            {exploreResult.formula && (
              <div className={styles.formulaBox}>
                <span className={styles.formulaLabel}>Suggested formula:</span>
                <code className={styles.formulaCode}>{exploreResult.formula}</code>
              </div>
            )}
          </div>
        )}

        {/* Insights section */}
        <div className={styles.section}>
          <Button
            variant="secondary"
            icon={<Lightbulb size={14} />}
            onClick={handleGetInsights}
            disabled={isFetchingInsights}
          >
            {isFetchingInsights ? 'Analyzing…' : 'Get Insights'}
          </Button>
        </div>

        {insights && insights.length === 0 && (
          <p className={styles.emptyInsights}>No anomalies or notable insights found.</p>
        )}

        {insights && insights.length > 0 && (
          <div className={styles.insightsList}>
            {insights.map((insight, idx) => (
              <div
                key={idx}
                className={`${styles.insightItem} ${styles[`insightType_${insight.type}`] ?? ''}`}
              >
                <span className={styles.insightBadge}>{insight.type}</span>
                <p className={styles.insightMessage}>{insight.message}</p>
                {insight.row >= 0 && insight.col >= 0 && (
                  <span className={styles.insightLocation}>
                    Row {insight.row + 1}, Col {insight.col + 1}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
