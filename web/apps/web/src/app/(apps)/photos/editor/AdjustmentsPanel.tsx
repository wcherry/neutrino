'use client';

import React, { useRef, useState } from 'react';
import { RotateCcw, RotateCw, FlipHorizontal, FlipVertical, RefreshCcw, Check, Scissors, Sparkles, ScanText, ScreenShare, Loader2, Copy, Eraser, Blend, Grid3x3, Wand2 } from 'lucide-react';
import { Circle, Square } from 'lucide-react';
import { FillPicker, PanelContainer, ColorPickerPopover } from '@neutrino/ui';
import type { Background, PanelTab } from '@neutrino/ui';
import type { Adjustments, PhotoFilter, Tool, CloneStampSettings, TextSettings, StrokeSettings, AreaSelection } from './types';
import type { DetectedObject, SmartEraseTarget } from '@neutrino/api-photos';
import { DEFAULT_ADJUSTMENTS, FILTER_LABELS, FILTER_PREVIEW_CSS } from './types';
import styles from './page.module.css';

const ALL_FILTERS: PhotoFilter[] = ['none', 'grayscale', 'sepia', 'vintage', 'hdr', 'bw'];

interface AdjustmentsPanelProps {
  adjustments: Adjustments;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  photoFilter: PhotoFilter;
  bgReplaceFill: Background;
  activeTool: Tool;
  cloneSettings: CloneStampSettings;
  textSettings: TextSettings;
  strokeSettings: StrokeSettings;
  activeTabId?: string;
  onTabChange?: (id: string) => void;
  onAdjustmentChange: (key: keyof Adjustments, value: number) => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onFlipH: () => void;
  onFlipV: () => void;
  onResetAdjustments: () => void;
  onApply: () => void;
  onRevert: () => void;
  onFilterChange: (filter: PhotoFilter) => void;
  onRemoveBackground: () => void;
  onReplaceBackground: (fill: Background) => void;
  onBgReplaceFillChange: (fill: Background) => void;
  onCloneSettingsChange: (settings: CloneStampSettings) => void;
  onTextSettingsChange: (settings: TextSettings) => void;
  onStrokeSettingsChange: (settings: StrokeSettings) => void;
  onAutoEnhance: () => void;
  onOcr: () => Promise<string>;
  onScreenshotIntel: (outputType: 'table' | 'document' | 'diagram') => Promise<string>;
  areaSelection?: AreaSelection | null;
  onAreaOp?: (op: 'blur' | 'pixelate' | 'fill') => void;
  onAreaClear?: () => void;
  detectedObjects?: DetectedObject[] | null;
  onSmartErase?: (target: SmartEraseTarget) => Promise<void>;
  onRemoveObjects?: () => void;
  onSmartEraseClear?: () => void;
}

interface SliderRowProps {
  label: string;
  value: number;
  adjKey: keyof Adjustments;
  min?: number;
  max?: number;
  onChange: (key: keyof Adjustments, value: number) => void;
}

function SliderRow({ label, value, adjKey, min = -100, max = 100, onChange }: SliderRowProps) {
  return (
    <div className={styles.sliderRow}>
      <div className={styles.sliderLabel}>
        <span>{label}</span>
        <span className={styles.sliderValue}>{value > 0 ? `+${value}` : value}</span>
      </div>
      <input
        type="range"
        className={styles.slider}
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(adjKey, Number(e.target.value))}
      />
    </div>
  );
}

export function AdjustmentsPanel({
  adjustments,
  rotation,
  flipH,
  flipV,
  photoFilter,
  bgReplaceFill,
  activeTool,
  cloneSettings,
  textSettings,
  strokeSettings,
  activeTabId,
  onTabChange,
  onAdjustmentChange,
  onRotateLeft,
  onRotateRight,
  onFlipH,
  onFlipV,
  onResetAdjustments,
  onApply,
  onRevert,
  onFilterChange,
  onRemoveBackground,
  onReplaceBackground,
  onBgReplaceFillChange,
  onCloneSettingsChange,
  onTextSettingsChange,
  onStrokeSettingsChange,
  onAutoEnhance,
  onOcr,
  onScreenshotIntel,
  areaSelection,
  onAreaOp,
  onAreaClear,
  detectedObjects,
  onSmartErase,
  onRemoveObjects,
  onSmartEraseClear,
}: AdjustmentsPanelProps) {

  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrResult, setOcrResult] = useState<string | null>(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [intelResult, setIntelResult] = useState<string | null>(null);
  const [intelType, setIntelType] = useState<'table' | 'document' | 'diagram'>('table');
  const [smartEraseTarget, setSmartEraseTarget] = useState<SmartEraseTarget>('people');
  const [smartEraseLoading, setSmartEraseLoading] = useState(false);

  async function handleOcr() {
    setOcrLoading(true);
    setOcrResult(null);
    try {
      const text = await onOcr();
      setOcrResult(text || '(no text found)');
    } catch {
      setOcrResult('OCR failed. Please try again.');
    } finally {
      setOcrLoading(false);
    }
  }

  async function handleScreenshotIntel() {
    setIntelLoading(true);
    setIntelResult(null);
    try {
      const result = await onScreenshotIntel(intelType);
      setIntelResult(result || '(no content detected)');
    } catch {
      setIntelResult('Conversion failed. Please try again.');
    } finally {
      setIntelLoading(false);
    }
  }

  const tabs: PanelTab[] = [
    {
      id: 'filters',
      title: 'Filters',
      content: (
        <div className={styles.section}>
          <div className={styles.filterGrid}>
            {ALL_FILTERS.map((f) => (
              <button
                key={f}
                className={`${styles.filterBtn} ${photoFilter === f ? styles.filterBtnActive : ''}`}
                onClick={() => onFilterChange(f)}
                title={FILTER_LABELS[f]}
              >
                <div
                  className={styles.filterSwatch}
                  style={{ filter: FILTER_PREVIEW_CSS[f] || undefined }}
                />
                <span className={styles.filterLabel}>{FILTER_LABELS[f]}</span>
              </button>
            ))}
          </div>
        </div>
      ),
    },
    {
      id: 'adjust',
      title: 'Adjust',
      content: (
        <>
          <div className={styles.section}>
            <p className={styles.sectionTitle}>Light</p>
            <SliderRow label="Brightness" value={adjustments.brightness} adjKey="brightness" onChange={onAdjustmentChange} />
            <SliderRow label="Contrast" value={adjustments.contrast} adjKey="contrast" onChange={onAdjustmentChange} />
            <SliderRow label="Exposure" value={adjustments.exposure} adjKey="exposure" onChange={onAdjustmentChange} />
          </div>
          <div className={styles.section}>
            <p className={styles.sectionTitle}>Color</p>
            <SliderRow label="Saturation" value={adjustments.saturation} adjKey="saturation" onChange={onAdjustmentChange} />
            <SliderRow label="Temperature" value={adjustments.temperature} adjKey="temperature" onChange={onAdjustmentChange} />
          </div>
          <div className={styles.section}>
            <p className={styles.sectionTitle}>Color Tools</p>
            <SliderRow label="Hue" value={adjustments.hue} adjKey="hue" min={-180} max={180} onChange={onAdjustmentChange} />
            <SliderRow label="Vibrance" value={adjustments.vibrance} adjKey="vibrance" onChange={onAdjustmentChange} />
            <SliderRow label="Color Balance" value={adjustments.colorBalance} adjKey="colorBalance" onChange={onAdjustmentChange} />
          </div>
          <div className={styles.section}>
            <p className={styles.sectionTitle}>Details</p>
            <SliderRow label="Sharpness" value={adjustments.sharpness} adjKey="sharpness" onChange={onAdjustmentChange} />
          </div>
        </>
      ),
    },
    {
      id: 'transform',
      title: 'Transform',
      content: (
        <>
          <div className={styles.section}>
            <p className={styles.sectionTitle}>Orientation</p>
            <div className={styles.orientationGrid}>
              <button className={styles.orientBtn} onClick={onRotateLeft} title="Rotate left">
                <RotateCcw size={16} />
                <span>CCW</span>
              </button>
              <button className={styles.orientBtn} onClick={onRotateRight} title="Rotate right">
                <RotateCw size={16} />
                <span>CW</span>
              </button>
              <button
                className={`${styles.orientBtn} ${flipH ? styles.orientBtnActive : ''}`}
                onClick={onFlipH}
                title="Flip horizontal"
                aria-pressed={flipH}
              >
                <FlipHorizontal size={16} />
                <span>Flip H</span>
              </button>
              <button
                className={`${styles.orientBtn} ${flipV ? styles.orientBtnActive : ''}`}
                onClick={onFlipV}
                title="Flip vertical"
                aria-pressed={flipV}
              >
                <FlipVertical size={16} />
                <span>Flip V</span>
              </button>
            </div>
            <p className={styles.rotationHint}>{rotation}&deg; rotation</p>
            <button className={styles.resetBtn} onClick={onResetAdjustments} title="Reset all adjustments">
              <RefreshCcw size={14} />
              Reset all
            </button>
          </div>
          <div className={styles.section}>
            <p className={styles.sectionTitle}>Background</p>
            <button className={styles.bgRemoveBtn} onClick={onRemoveBackground} title="Remove background (corner-sampled)">
              <Scissors size={14} />
              Remove Background
            </button>
            <div className={styles.bgReplaceRow}>
              <label className={styles.bgColorLabel}>Replace with</label>
              <FillPicker
                background={bgReplaceFill}
                onChange={onBgReplaceFillChange}
                triggerLabel=""
              />
              <button
                className={styles.bgReplaceBtn}
                onClick={() => onReplaceBackground(bgReplaceFill)}
                title="Remove background and fill with selected color or gradient"
              >
                Apply
              </button>
            </div>
            <p className={styles.bgHint}>Export as PNG to preserve transparency.</p>
          </div>
        </>
      ),
    },
    {
      id: 'tools',
      title: 'Tools',
      content: (activeTool === 'pen' || activeTool === 'highlighter' || activeTool === 'arrow' || activeTool === 'rectangle' || activeTool === 'circle' || activeTool === 'line') ? (
        <div className={styles.section}>
          <p className={styles.sectionTitle}>
            {activeTool === 'pen' ? 'Pen' : activeTool === 'highlighter' ? 'Highlighter' : activeTool === 'arrow' ? 'Arrow' : activeTool === 'rectangle' ? 'Rectangle' : activeTool === 'circle' ? 'Circle' : 'Line'}
          </p>

          <div className={styles.toolPropRow}>
            <div className={styles.toolPropLabel}>
              <span>Color</span>
            </div>
            <ColorPickerPopover
              color={strokeSettings.color}
              onChange={(hex) => onStrokeSettingsChange({ ...strokeSettings, color: hex })}
              title="Stroke color"
            />
          </div>

          <div className={styles.toolPropRow}>
            <div className={styles.toolPropLabel}>
              <span>Width</span>
              <span className={styles.toolPropValue}>{strokeSettings.lineWidth}px</span>
            </div>
            <input
              type="range"
              className={styles.slider}
              min={1}
              max={30}
              step={1}
              value={strokeSettings.lineWidth}
              onChange={(e) => onStrokeSettingsChange({ ...strokeSettings, lineWidth: Number(e.target.value) })}
            />
          </div>
        </div>
      ) : activeTool === 'text' ? (
        <div className={styles.section}>
          <p className={styles.sectionTitle}>Text</p>

          <div className={styles.toolPropRow}>
            <div className={styles.toolPropLabel}>
              <span>Color</span>
            </div>
            <ColorPickerPopover
              color={textSettings.color}
              onChange={(hex) => onTextSettingsChange({ ...textSettings, color: hex })}
              title="Text color"
            />
          </div>

          <div className={styles.toolPropRow}>
            <div className={styles.toolPropLabel}>
              <span>Size</span>
              <span className={styles.toolPropValue}>{textSettings.size}px</span>
            </div>
            <input
              type="range"
              className={styles.slider}
              min={12}
              max={72}
              step={2}
              value={textSettings.size}
              onChange={(e) => onTextSettingsChange({ ...textSettings, size: Number(e.target.value) })}
            />
          </div>
        </div>
      ) : (activeTool === 'clone' || activeTool === 'blur' || activeTool === 'pixelate') ? (
        <div className={styles.section}>
          <p className={styles.sectionTitle}>
            {activeTool === 'blur' ? 'Blur Brush' : activeTool === 'pixelate' ? 'Pixelate Brush' : 'Clone Stamp'}
          </p>

          <div className={styles.toolPropRow}>
            <div className={styles.toolPropLabel}>
              <span>Size</span>
              <span className={styles.toolPropValue}>{cloneSettings.size}px</span>
            </div>
            <input
              type="range"
              className={styles.slider}
              min={10}
              max={200}
              step={2}
              value={cloneSettings.size}
              onChange={(e) => onCloneSettingsChange({ ...cloneSettings, size: Number(e.target.value) })}
            />
          </div>

          <div className={styles.toolPropRow}>
            <div className={styles.toolPropLabel}>
              <span>Shape</span>
            </div>
            <div className={styles.shapeSelector}>
              <button
                className={`${styles.shapeBtn} ${cloneSettings.shape === 'circle' ? styles.shapeBtnActive : ''}`}
                onClick={() => onCloneSettingsChange({ ...cloneSettings, shape: 'circle' })}
                aria-pressed={cloneSettings.shape === 'circle'}
                title="Circle brush"
              >
                <Circle size={14} />
                Circle
              </button>
              <button
                className={`${styles.shapeBtn} ${cloneSettings.shape === 'square' ? styles.shapeBtnActive : ''}`}
                onClick={() => onCloneSettingsChange({ ...cloneSettings, shape: 'square' })}
                aria-pressed={cloneSettings.shape === 'square'}
                title="Square brush"
              >
                <Square size={14} />
                Square
              </button>
            </div>
          </div>

          <div className={styles.toolPropRow}>
            <div className={styles.toolPropLabel}>
              <span>Edge Blur</span>
              <span className={styles.toolPropValue}>{cloneSettings.edgeBlur}px</span>
            </div>
            <input
              type="range"
              className={styles.slider}
              min={0}
              max={50}
              step={1}
              value={cloneSettings.edgeBlur}
              onChange={(e) => onCloneSettingsChange({ ...cloneSettings, edgeBlur: Number(e.target.value) })}
            />
          </div>

          {(activeTool === 'blur' || activeTool === 'pixelate') && (
            <div className={styles.toolPropRow}>
              <div className={styles.toolPropLabel}>
                <span>{activeTool === 'blur' ? 'Blur Strength' : 'Pixel Size'}</span>
                <span className={styles.toolPropValue}>{cloneSettings.amount}</span>
              </div>
              <input
                type="range"
                className={styles.slider}
                min={1}
                max={40}
                step={1}
                value={cloneSettings.amount}
                onChange={(e) => onCloneSettingsChange({ ...cloneSettings, amount: Number(e.target.value) })}
              />
            </div>
          )}
        </div>
      ) : activeTool === 'select' ? (
        <div className={styles.section}>
          <p className={styles.sectionTitle}>Area Selection</p>
          <p className={styles.bgHint}>Hold <strong>Shift</strong> and drag on the photo to select a region. Actions will appear in the AI tab.</p>
        </div>
      ) : (
        <div className={styles.section}>
          <p className={styles.panelPlaceholder}>Select a drawing or editing tool to see its properties.</p>
        </div>
      ),
    },
    {
      id: 'ai',
      title: 'AI',
      content: (
        <>
          <div className={styles.section}>
            <p className={styles.sectionTitle}>Smart Erase</p>
            <p className={styles.bgHint}>AI detects objects and removes them with content-aware fill.</p>
            <div className={styles.intelTypeRow}>
              {(['people', 'power_lines', 'cars', 'clutter'] as const).map((t) => (
                <button
                  key={t}
                  className={`${styles.intelTypeBtn} ${smartEraseTarget === t ? styles.intelTypeBtnActive : ''}`}
                  onClick={() => setSmartEraseTarget(t)}
                  aria-pressed={smartEraseTarget === t}
                >
                  {t === 'people' ? 'People' : t === 'power_lines' ? 'Power Lines' : t === 'cars' ? 'Cars' : 'Clutter'}
                </button>
              ))}
            </div>
            <button
              className={styles.bgRemoveBtn}
              disabled={smartEraseLoading}
              onClick={async () => {
                setSmartEraseLoading(true);
                try { await onSmartErase?.(smartEraseTarget); } finally { setSmartEraseLoading(false); }
              }}
            >
              {smartEraseLoading ? <Loader2 size={14} className={styles.spinIcon} /> : <Wand2 size={14} />}
              {smartEraseLoading ? 'Scanning…' : 'Find Objects'}
            </button>
            {detectedObjects != null && detectedObjects.length === 0 && (
              <p className={styles.bgHint}>No objects found.</p>
            )}
            {detectedObjects != null && detectedObjects.length > 0 && (
              <>
                <p className={styles.bgHint}>{detectedObjects.length} object{detectedObjects.length !== 1 ? 's' : ''} detected.</p>
                <div className={styles.detectedObjectsList}>
                  {detectedObjects.map((obj, i) => (
                    <span key={i} className={styles.detectedObjectChip}>{obj.label}</span>
                  ))}
                </div>
                <button className={styles.bgRemoveBtn} onClick={onRemoveObjects}>
                  <Eraser size={14} />
                  Remove All
                </button>
                <button className={styles.clearAreaBtn} onClick={onSmartEraseClear}>
                  Clear results
                </button>
              </>
            )}
          </div>
          {areaSelection && (
            <div className={styles.section}>
              <p className={styles.sectionTitle}>Remove Object</p>
              <p className={styles.bgHint}>Apply an operation to the selected region. Bakes current adjustments into the photo.</p>
              <button className={styles.bgRemoveBtn} onClick={() => onAreaOp?.('fill')}>
                <Eraser size={14} />
                Content Fill
              </button>
              <button className={styles.bgRemoveBtn} onClick={() => onAreaOp?.('blur')}>
                <Blend size={14} />
                Blur Region
              </button>
              <button className={styles.bgRemoveBtn} onClick={() => onAreaOp?.('pixelate')}>
                <Grid3x3 size={14} />
                Pixelate Region
              </button>
              <button className={styles.clearAreaBtn} onClick={onAreaClear}>
                Clear selection
              </button>
            </div>
          )}
          <div className={styles.section}>
            <p className={styles.sectionTitle}>Auto Enhance</p>
            <p className={styles.bgHint}>Automatically optimize brightness, contrast, and color balance.</p>
            <button className={styles.bgRemoveBtn} onClick={onAutoEnhance}>
              <Sparkles size={14} />
              Enhance Photo
            </button>
          </div>

          <div className={styles.section}>
            <p className={styles.sectionTitle}>OCR — Extract Text</p>
            <p className={styles.bgHint}>Extract all text visible in the image using AI.</p>
            <button
              className={styles.bgRemoveBtn}
              onClick={handleOcr}
              disabled={ocrLoading}
            >
              {ocrLoading ? <Loader2 size={14} className={styles.spinIcon} /> : <ScanText size={14} />}
              {ocrLoading ? 'Extracting…' : 'Extract Text'}
            </button>
            {ocrResult !== null && (
              <div className={styles.aiResultBox}>
                <div className={styles.aiResultHeader}>
                  <span>Result</span>
                  <button
                    className={styles.aiCopyBtn}
                    onClick={() => navigator.clipboard.writeText(ocrResult)}
                    title="Copy to clipboard"
                  >
                    <Copy size={12} />
                  </button>
                </div>
                <textarea
                  className={styles.aiResultText}
                  readOnly
                  value={ocrResult}
                  rows={6}
                />
              </div>
            )}
          </div>

          <div className={styles.section}>
            <p className={styles.sectionTitle}>Screenshot Intelligence</p>
            <p className={styles.bgHint}>Convert this screenshot into structured content.</p>
            <div className={styles.intelTypeRow}>
              {(['table', 'document', 'diagram'] as const).map((t) => (
                <button
                  key={t}
                  className={`${styles.intelTypeBtn} ${intelType === t ? styles.intelTypeBtnActive : ''}`}
                  onClick={() => setIntelType(t)}
                  aria-pressed={intelType === t}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <button
              className={styles.bgRemoveBtn}
              onClick={handleScreenshotIntel}
              disabled={intelLoading}
            >
              {intelLoading ? <Loader2 size={14} className={styles.spinIcon} /> : <ScreenShare size={14} />}
              {intelLoading ? 'Converting…' : 'Convert'}
            </button>
            {intelResult !== null && (
              <div className={styles.aiResultBox}>
                <div className={styles.aiResultHeader}>
                  <span>Result</span>
                  <button
                    className={styles.aiCopyBtn}
                    onClick={() => navigator.clipboard.writeText(intelResult)}
                    title="Copy to clipboard"
                  >
                    <Copy size={12} />
                  </button>
                </div>
                <textarea
                  className={styles.aiResultText}
                  readOnly
                  value={intelResult}
                  rows={8}
                />
              </div>
            )}
          </div>
        </>
      ),
    },
  ];

  return (
    <PanelContainer
      tabs={tabs}
      tabsSide="left"
      defaultLocation="right"
      width={280}
      className={styles.panelDark}
      activeTabId={activeTabId}
      onTabChange={onTabChange}
      headerActions={
        <>
          <button className={styles.applyHeaderBtn} onClick={onRevert} title="Revert to last applied">
            Revert
          </button>
          <button
            className={`${styles.applyHeaderBtn} ${styles.applyHeaderBtnAccent}`}
            onClick={onApply}
            title="Apply adjustments"
          >
            <Check size={11} />
            Apply
          </button>
        </>
      }
    />
  );
}
