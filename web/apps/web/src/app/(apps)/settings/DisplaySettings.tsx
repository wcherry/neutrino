'use client';

import React from 'react';
import { RotateCcw } from 'lucide-react';
import { usePreference, type PreferenceKey, type PreferenceValues } from '@neutrino/preferences';
import { accentPalette } from '@/lib/accent';
import { useAvailableFonts } from '@/hooks/useAvailableFonts';
import { resetListingView, storedView, type ListingId } from '@/lib/listingViews';
import { InheritedNote, useLocked } from './InheritedNote';
import styles from './DisplaySettings.module.css';

/**
 * Settings › Appearance below the look and theme (customization roadmap U2, U3, U5, U9, §3.3):
 * density, text size, corners and the interface font, an accent colour with a contrast guarantee, the accessibility switches, where
 * Drive opens, and the views each listing has remembered.
 */

function Segmented<K extends PreferenceKey>({ prefKey, label, options }: {
  prefKey: K;
  label: string;
  options: { value: PreferenceValues[K]; label: string }[];
}) {
  const [value, setValue] = usePreference(prefKey);
  const locked = useLocked(prefKey);
  return (
    <div className={styles.row}>
      <span className={styles.label} id={`${prefKey}-label`}>{label}</span>
      <div className={styles.segmented} role="radiogroup" aria-labelledby={`${prefKey}-label`}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={styles.segment}
            disabled={locked}
            onClick={() => setValue(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <InheritedNote prefKey={prefKey} />
    </div>
  );
}

/** Distinct hues that each stay legible; any colour can still be typed or picked. */
const SWATCHES = ['#3346e8', '#2f6fe4', '#0e7a4a', '#0e8c8c', '#7a4fdb', '#d6336c', '#c2410c', '#16181d'];

function AccentPicker() {
  const [accent, setAccent] = usePreference('appearance.accent');
  const locked = useLocked('appearance.accent');
  const [draft, setDraft] = React.useState(accent ?? '');
  React.useEffect(() => setDraft(accent ?? ''), [accent]);
  const palette = accentPalette(draft);
  return (
    <div className={styles.row}>
      <span className={styles.label} id="accent-label">Accent colour</span>
      <div className={styles.swatches} role="radiogroup" aria-labelledby="accent-label">
        <button
          type="button"
          role="radio"
          aria-checked={!accent}
          className={styles.swatchDefault}
          disabled={locked}
          onClick={() => setAccent(null)}
        >
          Look&rsquo;s own
        </button>
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={accent?.toLowerCase() === c}
            aria-label={`Accent ${c}`}
            className={styles.swatch}
            style={{ background: c }}
            disabled={locked}
            onClick={() => setAccent(c)}
          />
        ))}
        <input
          type="color"
          className={styles.picker}
          aria-label="Pick any colour"
          value={palette ? draft : '#3346e8'}
          disabled={locked}
          onChange={(e) => {
            setDraft(e.target.value);
            setAccent(e.target.value);
          }}
        />
      </div>
      {accent && palette?.adjusted && (
        <p className={styles.hint}>
          Adjusted where it is drawn so text in it stays readable (4.5:1) — lighter in dark mode, darker
          where it was too light. Your colour is kept as you picked it.
        </p>
      )}
      <InheritedNote prefKey="appearance.accent" />
    </div>
  );
}

/** The interface font: the look's own, a built-in, or one from the instance's font library. */
function InterfaceFont() {
  const [font, setFont] = usePreference('appearance.font');
  const locked = useLocked('appearance.font');
  const { fontFamilyNames } = useAvailableFonts();
  return (
    <div className={styles.row}>
      <label className={styles.label} htmlFor="appearance-font">Interface font</label>
      <select
        id="appearance-font"
        className={styles.select}
        value={font}
        disabled={locked}
        onChange={e => setFont(e.target.value)}
        style={font ? { fontFamily: `'${font}', sans-serif` } : undefined}
      >
        <option value="">Look&rsquo;s own</option>
        {fontFamilyNames.map(f => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>
      <InheritedNote prefKey="appearance.font" />
    </div>
  );
}

const LISTINGS: { id: ListingId; label: string }[] = [
  { id: 'drive', label: 'My Drive' },
  { id: 'recent', label: 'Recent' },
  { id: 'starred', label: 'Starred' },
  { id: 'shared', label: 'Shared with me' },
  { id: 'trash', label: 'Trash' },
  { id: 'docs', label: 'Docs' },
  { id: 'sheets', label: 'Sheets' },
  { id: 'slides', label: 'Slides' },
  { id: 'drawings', label: 'Drawings' },
  { id: 'diagrams', label: 'Diagrams' },
  { id: 'notes', label: 'Notes' },
];

const VIEW_LABELS: Record<string, string> = { large: 'Large grid', small: 'Small grid', list: 'List' };
const SORT_LABELS: Record<string, string> = { name: 'name', updatedAt: 'last modified', createdAt: 'created', size: 'size' };

function RememberedViews() {
  const [all] = usePreference('listing.views');
  const remembered = LISTINGS.map((l) => ({ ...l, stored: storedView(all, l.id) })).filter(
    (l) => l.stored.view || l.stored.sort,
  );
  return (
    <div className={styles.row}>
      <span className={styles.label}>Default views</span>
      <p className={styles.hint}>
        Each list remembers how you last viewed and sorted it, on every device. Reset one to open it as it
        comes.
      </p>
      {remembered.length === 0 ? (
        <p className={styles.hint}>Nothing remembered yet.</p>
      ) : (
        <ul className={styles.views}>
          {remembered.map((l) => (
            <li key={l.id} className={styles.view}>
              <span className={styles.viewName}>{l.label}</span>
              <span className={styles.viewValue}>
                {[l.stored.view && VIEW_LABELS[l.stored.view], l.stored.sort && `by ${SORT_LABELS[l.stored.sort]}`]
                  .filter(Boolean)
                  .join(', ')}
              </span>
              <button type="button" className={styles.reset} onClick={() => resetListingView(l.id)}>
                <RotateCcw size={13} aria-hidden="true" /> Reset
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DisplaySettings() {
  return (
    <div className={styles.root}>
      <Segmented
        prefKey="appearance.density"
        label="Density"
        options={[
          { value: 'compact', label: 'Compact' },
          { value: 'comfortable', label: 'Comfortable' },
          { value: 'spacious', label: 'Spacious' },
        ]}
      />
      <Segmented
        prefKey="appearance.textSize"
        label="Text size"
        options={[
          { value: 'sm', label: 'Small' },
          { value: 'md', label: 'Default' },
          { value: 'lg', label: 'Large' },
        ]}
      />
      <Segmented
        prefKey="appearance.shape"
        label="Corners"
        options={[
          { value: 'sharper', label: 'Sharper' },
          { value: 'default', label: 'Default' },
          { value: 'rounder', label: 'Rounder' },
        ]}
      />
      <InterfaceFont />
      <AccentPicker />
      <Segmented
        prefKey="a11y.reduceMotion"
        label="Reduce motion"
        options={[
          { value: 'system', label: 'As the device' },
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ]}
      />
      <Segmented
        prefKey="a11y.reduceTransparency"
        label="Reduce transparency"
        options={[
          { value: 'system', label: 'As the device' },
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ]}
      />
      <Segmented
        prefKey="a11y.contrast"
        label="Higher contrast"
        options={[
          { value: 'system', label: 'As the device' },
          { value: 'more', label: 'On' },
          { value: 'standard', label: 'Off' },
        ]}
      />
      <Segmented
        prefKey="drive.landing"
        label="Drive opens on"
        options={[
          { value: 'drive', label: 'My Drive' },
          { value: 'recent', label: 'Recent' },
          { value: 'starred', label: 'Starred' },
        ]}
      />
      <Segmented
        prefKey="drive.quickAccessDays"
        label="Quick access shows files edited in the last"
        options={[
          { value: '3', label: '3 days' },
          { value: '7', label: '7 days' },
          { value: '30', label: '30 days' },
          { value: '90', label: '90 days' },
        ]}
      />
      <RememberedViews />
    </div>
  );
}
