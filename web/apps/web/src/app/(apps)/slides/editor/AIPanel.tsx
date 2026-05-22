'use client';

import React, { useState } from 'react';
import { Sparkles, Search, Layout, X, AlertCircle, Image as ImageIcon } from 'lucide-react';
import { Button } from '@neutrino/ui';
import { slidesAI, ImageResult } from '@/lib/api';
import styles from './AIPanel.module.css';

interface AIPanelProps {
  slideId: string;
  /** Current slide content as a string for design/format endpoints */
  getSlideContent: () => string;
  /** Current slide JSON for the autoformat endpoint */
  getSlideJson: () => string;
  onClose: () => void;
  /** Called with the completed text when smart compose finishes */
  onCompose?: (text: string) => void;
}

export function AIPanel({
  slideId,
  getSlideContent,
  getSlideJson,
  onClose,
  onCompose,
}: AIPanelProps) {
  // Smart Compose state
  const [composeInput, setComposeInput] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [composeResult, setComposeResult] = useState<string | null>(null);

  // Image Search state
  const [imageQuery, setImageQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [imageResults, setImageResults] = useState<ImageResult[] | null>(null);

  // Design state
  const [designPrompt, setDesignPrompt] = useState('');
  const [isDesigning, setIsDesigning] = useState(false);
  const [designResult, setDesignResult] = useState<unknown | null>(null);

  const [error, setError] = useState<string | null>(null);

  async function handleSmartCompose() {
    if (!composeInput.trim()) return;
    setIsComposing(true);
    setError(null);
    setComposeResult(null);
    try {
      const result = await slidesAI.complete(slideId, composeInput.trim());
      setComposeResult(result.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Smart compose failed');
    } finally {
      setIsComposing(false);
    }
  }

  async function handleImageSearch() {
    if (!imageQuery.trim()) return;
    setIsSearching(true);
    setError(null);
    setImageResults(null);
    try {
      const result = await slidesAI.imageSearch(slideId, imageQuery.trim());
      setImageResults(result.images);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Image search failed');
    } finally {
      setIsSearching(false);
    }
  }

  async function handleDesign() {
    setIsDesigning(true);
    setError(null);
    setDesignResult(null);
    try {
      const content = designPrompt.trim() || getSlideContent();
      const result = await slidesAI.design(slideId, content);
      setDesignResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Design assistance failed');
    } finally {
      setIsDesigning(false);
    }
  }

  function handleKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    handler: () => void
  ) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handler();
    }
  }

  const designData = designResult as Record<string, any> | null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <Sparkles size={16} />
          <span>AI Assistant</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close AI panel">
          <X size={16} />
        </button>
      </div>

      <div className={styles.content}>
        {/* Error display */}
        {error && (
          <div className={styles.error}>
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {/* Smart Compose */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <Sparkles size={14} />
            <span className={styles.sectionTitle}>Smart Compose</span>
          </div>
          <input
            className={styles.textInput}
            type="text"
            placeholder="Start typing your slide text…"
            value={composeInput}
            onChange={(e) => setComposeInput(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, handleSmartCompose)}
            disabled={isComposing}
          />
          <Button
            variant="secondary"
            onClick={handleSmartCompose}
            disabled={isComposing || !composeInput.trim()}
          >
            {isComposing ? 'Composing…' : 'Complete'}
          </Button>
          {composeResult && (
            <div className={styles.composeResult}>
              <p className={styles.composeText}>{composeResult}</p>
              {onCompose && (
                <Button
                  variant="primary"
                  onClick={() => {
                    onCompose(composeResult);
                    setComposeResult(null);
                    setComposeInput('');
                  }}
                >
                  Use this text
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Image Search */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <Search size={14} />
            <span className={styles.sectionTitle}>Image Search</span>
          </div>
          <div className={styles.inputRow}>
            <input
              className={styles.textInput}
              type="text"
              placeholder="Search images in your Drive…"
              value={imageQuery}
              onChange={(e) => setImageQuery(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, handleImageSearch)}
              disabled={isSearching}
            />
            <Button
              variant="secondary"
              icon={<Search size={14} />}
              onClick={handleImageSearch}
              disabled={isSearching || !imageQuery.trim()}
            >
              {isSearching ? '…' : 'Search'}
            </Button>
          </div>
          {imageResults !== null && imageResults.length === 0 && (
            <p className={styles.emptyState}>No images found for this query.</p>
          )}
          {imageResults && imageResults.length > 0 && (
            <div className={styles.imageGrid}>
              {imageResults.map((img) => (
                <div key={img.id} className={styles.imageCard} title={img.name}>
                  {img.mimeType.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img.url}
                      alt={img.name}
                      className={styles.imageThumbnail}
                    />
                  ) : (
                    <div className={styles.imagePlaceholder}>
                      <ImageIcon size={24} color="var(--color-text-muted)" />
                    </div>
                  )}
                  <span className={styles.imageName}>{img.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Help me design */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <Layout size={14} />
            <span className={styles.sectionTitle}>Help me design</span>
          </div>
          <input
            className={styles.textInput}
            type="text"
            placeholder="Describe the slide or leave blank to use current"
            value={designPrompt}
            onChange={(e) => setDesignPrompt(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, handleDesign)}
            disabled={isDesigning}
          />
          <Button
            variant="secondary"
            icon={<Layout size={14} />}
            onClick={handleDesign}
            disabled={isDesigning}
          >
            {isDesigning ? 'Generating…' : 'Get design suggestions'}
          </Button>
          {designData && (
            <div className={styles.designResult}>
              {designData.layout && (
                <div className={styles.designRow}>
                  <span className={styles.designLabel}>Layout:</span>
                  <span className={styles.designValue}>{designData.layout}</span>
                </div>
              )}
              {designData.colorScheme && (
                <div className={styles.colorSwatches}>
                  {Object.entries(designData.colorScheme as Record<string, string>).map(
                    ([key, value]) => (
                      <div key={key} className={styles.swatch} title={`${key}: ${value}`}>
                        <div
                          className={styles.swatchColor}
                          style={{ backgroundColor: value }}
                        />
                        <span className={styles.swatchLabel}>{key}</span>
                      </div>
                    )
                  )}
                </div>
              )}
              {designData.tips && Array.isArray(designData.tips) && (
                <div className={styles.tips}>
                  {(designData.tips as string[]).map((tip, i) => (
                    <p key={i} className={styles.tipItem}>
                      {tip}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
