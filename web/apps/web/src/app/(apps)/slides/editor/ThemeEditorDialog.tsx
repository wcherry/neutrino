'use client';

import React, { useState } from 'react';
import { Copy, Lock, Trash2 } from 'lucide-react';
import { ColorPickerPopover } from '@neutrino/ui';
import type { SlideTheme, CreateThemeRequest, UpdateThemeRequest } from '@neutrino/api-slides';
import { useAvailableFonts } from '@/hooks/useAvailableFonts';
import { ThemePreview } from './slideEditorPreviews';
import styles from './page.module.css';

const TRANSITION_OPTIONS: { value: string; label: string }[] = [
  { value: 'none', label: 'No transition' },
  { value: 'fade', label: 'Fade' },
  { value: 'dissolve', label: 'Dissolve' },
  { value: 'slide', label: 'Slide Right' },
  { value: 'slide-left', label: 'Slide Left' },
  { value: 'flip', label: 'Flip' },
  { value: 'cube', label: 'Cube' },
  { value: 'gallery', label: 'Gallery' },
  { value: 'pixelate', label: 'Pixelate' },
  { value: 'cover', label: 'Cover' },
  { value: 'wipe', label: 'Wipe' },
  { value: 'zoom', label: 'Zoom' },
];

const BLANK_THEME: Omit<SlideTheme, 'id' | 'isSystem' | 'createdAt' | 'updatedAt'> = {
  name: '',
  primaryColor: '#4f46e5',
  backgroundColor: '#ffffff',
  textColor: '#1f2937',
  accentColor: '#818cf8',
  fontFamily: 'Inter',
  backgroundImage: null,
  gradientBackground: null,
  defaultTransition: 'fade',
};

export type ThemeEditorMode = 'create' | 'edit' | 'view';

interface ColorFieldProps {
  label: string;
  color: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
}

function ColorField({ label, color, onChange, disabled }: ColorFieldProps) {
  return (
    <div className={styles.themeFieldRow}>
      <span className={styles.themeFieldLabel}>{label}</span>
      <ColorPickerPopover color={color} onChange={onChange} disabled={disabled} title={label} />
    </div>
  );
}

interface ThemeEditorDialogProps {
  mode: ThemeEditorMode;
  /** Seed values. Omit (or pass null) to start a blank "from scratch" theme. */
  theme?: SlideTheme | null;
  saving?: boolean;
  onClose: () => void;
  onCreate?: (body: CreateThemeRequest) => void;
  onSave?: (body: UpdateThemeRequest) => void;
  onDelete?: () => void;
  onDuplicate?: (body: CreateThemeRequest) => void;
}

export function ThemeEditorDialog({
  mode,
  theme,
  saving,
  onClose,
  onCreate,
  onSave,
  onDelete,
  onDuplicate,
}: ThemeEditorDialogProps) {
  const seed = theme ?? BLANK_THEME;
  const [name, setName] = useState(mode === 'create' && !theme ? '' : seed.name);
  const [primaryColor, setPrimaryColor] = useState(seed.primaryColor);
  const [backgroundColor, setBackgroundColor] = useState(seed.backgroundColor);
  const [textColor, setTextColor] = useState(seed.textColor);
  const [accentColor, setAccentColor] = useState(seed.accentColor);
  const [fontFamily, setFontFamily] = useState(seed.fontFamily);
  const [defaultTransition, setDefaultTransition] = useState(seed.defaultTransition);
  const { fontFamilyNames } = useAvailableFonts();

  const readOnly = mode === 'view';
  const title = mode === 'create' ? 'New theme' : mode === 'edit' ? 'Edit theme' : theme?.name ?? 'Theme';

  const previewTheme: SlideTheme = {
    id: theme?.id ?? '',
    name,
    primaryColor,
    backgroundColor,
    textColor,
    accentColor,
    fontFamily,
    backgroundImage: seed.backgroundImage,
    gradientBackground: seed.gradientBackground,
    defaultTransition,
    isSystem: theme?.isSystem ?? false,
    createdAt: theme?.createdAt ?? '',
    updatedAt: theme?.updatedAt ?? '',
  };

  function buildRequestBody(): CreateThemeRequest {
    return {
      name: name.trim(),
      primaryColor,
      backgroundColor,
      textColor,
      accentColor,
      fontFamily,
      backgroundImage: seed.backgroundImage,
      gradientBackground: seed.gradientBackground,
      defaultTransition,
    };
  }

  const canSubmit = name.trim().length > 0;

  function handlePrimaryAction() {
    if (!canSubmit) return;
    if (mode === 'create') onCreate?.(buildRequestBody());
    else if (mode === 'edit') onSave?.(buildRequestBody());
  }

  function handleDuplicate() {
    const body = buildRequestBody();
    onDuplicate?.({ ...body, name: `${body.name} copy` });
  }

  return (
    <div className={styles.dialogOverlay} onClick={onClose}>
      <div className={styles.dialogBox} onClick={(e) => e.stopPropagation()}>
        <div className={styles.dialogTitle}>
          {title}
          {readOnly && (
            <span className={styles.themeReadOnlyBadge} title="Built-in themes can't be edited directly — duplicate it to customize">
              <Lock size={11} />
              View only
            </span>
          )}
        </div>

        <div className={styles.themeEditorPreview}>
          <ThemePreview theme={previewTheme} />
        </div>

        <div className={styles.themeFieldRow}>
          <span className={styles.themeFieldLabel}>Name</span>
          <input
            className={styles.dialogInput}
            style={{ flex: 1 }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My theme"
            disabled={readOnly}
            autoFocus={mode !== 'view'}
          />
        </div>

        <ColorField label="Primary" color={primaryColor} onChange={setPrimaryColor} disabled={readOnly} />
        <ColorField label="Background" color={backgroundColor} onChange={setBackgroundColor} disabled={readOnly} />
        <ColorField label="Text" color={textColor} onChange={setTextColor} disabled={readOnly} />
        <ColorField label="Accent" color={accentColor} onChange={setAccentColor} disabled={readOnly} />

        <div className={styles.themeFieldRow}>
          <span className={styles.themeFieldLabel}>Font</span>
          <select
            className={styles.dialogInput}
            style={{ flex: 1 }}
            value={fontFamily}
            onChange={(e) => setFontFamily(e.target.value)}
            disabled={readOnly}
          >
            {fontFamilyNames.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>

        <div className={styles.themeFieldRow}>
          <span className={styles.themeFieldLabel}>Transition</span>
          <select
            className={styles.dialogInput}
            style={{ flex: 1 }}
            value={defaultTransition}
            onChange={(e) => setDefaultTransition(e.target.value as SlideTheme['defaultTransition'])}
            disabled={readOnly}
          >
            {TRANSITION_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <div className={styles.dialogActions}>
          {mode === 'edit' && (
            <button
              className={styles.dialogDeleteBtn}
              onClick={onDelete}
              disabled={saving}
              title="Delete theme"
            >
              <Trash2 size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: -2 }} />
              Delete
            </button>
          )}
          {mode !== 'create' && (
            <button className={styles.dialogCancelBtn} onClick={handleDuplicate} disabled={saving}>
              <Copy size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: -2 }} />
              Duplicate
            </button>
          )}
          <button className={styles.dialogCancelBtn} onClick={onClose}>
            {readOnly ? 'Close' : 'Cancel'}
          </button>
          {mode !== 'view' && (
            <button
              className={styles.dialogConfirmBtn}
              onClick={handlePrimaryAction}
              disabled={!canSubmit || saving}
            >
              {mode === 'create' ? 'Create theme' : 'Save changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
