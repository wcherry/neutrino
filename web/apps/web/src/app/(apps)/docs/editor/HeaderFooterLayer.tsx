'use client';

/**
 * The header and footer bands, drawn on every page.
 *
 * The editor renders a document as one continuous sheet with the gaps between
 * pages painted on as a background gradient, so there is no per-page element to
 * hang a header off. This layer positions the bands itself: page k's sheet
 * starts at `k * (pageHeight + gap)`, its header sits `headerMargin` below that
 * and its footer `footerMargin` above the sheet's bottom edge. Both sit in the
 * page's top and bottom margins, outside the text column, so they never collide
 * with content — the pagination plugin already keeps text inside the same
 * bands.
 *
 * Bands are absolutely positioned inside `.page`, whose containing block is its
 * padding box — `left: 0` is the sheet's edge, not the edge of the text column,
 * which is why each band applies the page's left/right margins as its own
 * padding.
 *
 * Editing is inline rather than in a dialog: the same band you read is the one
 * you type into, on whichever page you are looking at. Every page showing a
 * variant is bound to that variant's stored slots, so typing in page 5's header
 * updates page 3's as you type — the feedback that makes "different odd & even"
 * legible at all. Only the pages near the one being edited get real inputs
 * (`EDIT_WINDOW`); a hundred-page document would otherwise mount six hundred of
 * them, and the rest stay resolved text that focuses on click.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  hasBandContent,
  resolveFields,
  variantForPage,
  variantLabel,
  type HeaderFooterBand,
  type HeaderFooterConfig,
  type HeaderFooterSlot,
  type HeaderFooterVariant,
} from '@/lib/docHeaderFooter';
import { emptyDocProperties, type DocProperties } from '@/lib/docFields';
import { useFieldCodeAutocomplete } from '@/hooks/useFieldCodeAutocomplete';
import { FieldSuggestionList } from './FieldSuggestionList';
import styles from './HeaderFooterLayer.module.css';

/** Which field the caret is in, and so which variant the toolbar is acting on. */
export interface HeaderFooterFocus {
  page: number;
  band: HeaderFooterBand;
  slot: HeaderFooterSlot;
}

export interface HeaderFooterLayerHandle {
  /** Put the caret in a field, mounting its input first if it is off-window. */
  focusField: (focus: HeaderFooterFocus) => void;
  /** The input the caret was last in — where the toolbar inserts a field. */
  activeInput: () => HTMLInputElement | null;
}

export interface HeaderFooterLayerProps {
  config: HeaderFooterConfig;
  totalPages: number;
  /** Sheet height and inter-sheet gap, in CSS px. */
  pageHeight: number;
  gap: number;
  marginLeft: number;
  marginRight: number;
  /** Resolves `{{title}}`. */
  title: string;
  /** Resolves `{{author}}` and the rest; also what the autocomplete offers. */
  properties?: DocProperties;
  editing: boolean;
  focus: HeaderFooterFocus;
  onFocusChange: (focus: HeaderFooterFocus) => void;
  onSlotChange: (
    variant: HeaderFooterVariant,
    band: HeaderFooterBand,
    slot: HeaderFooterSlot,
    value: string,
  ) => void;
  /** Double-click in a band while not editing — the way in, as in Word. */
  onRequestEdit: (focus: HeaderFooterFocus) => void;
  onExitEdit: () => void;
}

/** Height of one band, sized to a single line of the band's 9pt text. */
const BAND_HEIGHT = 24;

/** Pages either side of the focused one that get real inputs. */
const EDIT_WINDOW = 2;

const SLOTS: HeaderFooterSlot[] = ['left', 'center', 'right'];
const BANDS: HeaderFooterBand[] = ['header', 'footer'];

function fieldKey(f: HeaderFooterFocus): string {
  return `${f.page}:${f.band}:${f.slot}`;
}

export const HeaderFooterLayer = forwardRef<HeaderFooterLayerHandle, HeaderFooterLayerProps>(
  function HeaderFooterLayer(
    {
      config,
      totalPages,
      pageHeight,
      gap,
      marginLeft,
      marginRight,
      title,
      properties,
      editing,
      focus,
      onFocusChange,
      onSlotChange,
      onRequestEdit,
      onExitEdit,
    },
    ref,
  ) {
    const inputs = useRef(new Map<string, HTMLInputElement>());
    const activeKey = useRef<string | null>(null);

    // Memoised because the fallback would otherwise be a fresh object on every
    // render, making the derived `customCodes` a fresh array each time too.
    const props = useMemo(() => properties ?? emptyDocProperties(), [properties]);
    const customCodes = useMemo(() => Object.keys(props.custom), [props.custom]);
    // One instance for every band on screen: only the focused field can have a
    // token open, so this tracks whichever that is.
    const autocomplete = useFieldCodeAutocomplete(customCodes);
    // A focus asked for before its input exists: recorded here, applied by the
    // effect below once the render that mounts the input has landed.
    const [pendingFocus, setPendingFocus] = useState<HeaderFooterFocus | null>(null);

    const requestFocus = useCallback(
      (next: HeaderFooterFocus) => {
        onFocusChange(next);
        setPendingFocus(next);
      },
      [onFocusChange],
    );

    useEffect(() => {
      if (!pendingFocus) return;
      const el = inputs.current.get(fieldKey(pendingFocus));
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      setPendingFocus(null);
    }, [pendingFocus, editing, focus]);

    useImperativeHandle(
      ref,
      () => ({
        focusField: requestFocus,
        activeInput: () => (activeKey.current ? inputs.current.get(activeKey.current) ?? null : null),
      }),
      [requestFocus],
    );

    const pages = useMemo(
      () => Array.from({ length: Math.max(1, totalPages) }, (_, i) => i + 1),
      [totalPages],
    );

    const registerInput = useCallback((key: string, el: HTMLInputElement | null) => {
      if (el) inputs.current.set(key, el);
      else inputs.current.delete(key);
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      // The autocomplete gets Enter, Tab, the arrows and Escape first, and only
      // while it is open. Without this, Escape would leave the band entirely
      // instead of dismissing the menu, and Enter would commit the half-typed
      // `{{p` rather than insert the code it is offering.
      if (autocomplete.handleKeyDown(e)) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onExitEdit();
      }
      // Enter commits rather than inserting a newline: a band is one line.
      if (e.key === 'Enter') {
        e.preventDefault();
        (e.target as HTMLInputElement).blur();
        onExitEdit();
      }
    };

    const renderBand = (page: number, band: HeaderFooterBand) => {
      const variant = variantForPage(page, config);
      const slots = config.variants[variant][band];
      const pageTop = (page - 1) * (pageHeight + gap);
      const top =
        band === 'header'
          ? pageTop + config.headerMargin
          : pageTop + pageHeight - config.footerMargin - BAND_HEIGHT;

      const empty = !hasBandContent(slots);
      // Outside edit mode an empty band draws nothing, but still occupies its
      // place as a double-click target — that is how the feature is discovered.
      if (!editing && empty) {
        return (
          <div
            key={`${page}-${band}`}
            className={styles.hitZone}
            style={{ top, height: BAND_HEIGHT, paddingLeft: marginLeft, paddingRight: marginRight }}
            onDoubleClick={() => onRequestEdit({ page, band, slot: 'left' })}
            title={`Double-click to edit the ${band}`}
          />
        );
      }

      const editable = editing && Math.abs(page - focus.page) <= EDIT_WINDOW;
      const isFocusedBand = editing && page === focus.page && band === focus.band;

      return (
        <div
          key={`${page}-${band}`}
          className={[
            styles.band,
            band === 'header' ? styles.header : styles.footer,
            editing ? styles.bandEditing : '',
            isFocusedBand ? styles.bandActive : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ top, height: BAND_HEIGHT, paddingLeft: marginLeft, paddingRight: marginRight }}
          onDoubleClick={
            editing
              // Already editing: swallow it, or it reaches the page's own
              // handler and closes the mode the user is working in.
              ? e => e.stopPropagation()
              : () => onRequestEdit({ page, band, slot: 'left' })
          }
          data-testid={`hf-band-${page}-${band}`}
          data-variant={variant}
        >
          {isFocusedBand && (
            <span className={styles.bandLabel}>{variantLabel(variant, band, config)}</span>
          )}

          {SLOTS.map(slot => {
            const key = fieldKey({ page, band, slot });
            const raw = slots[slot];

            if (!editable) {
              return (
                <div
                  key={slot}
                  className={`${styles.slot} ${styles[slot]}`}
                  onMouseDown={
                    editing
                      ? e => {
                          // Focus the field rather than starting a selection in
                          // the static text standing in for its input.
                          e.preventDefault();
                          requestFocus({ page, band, slot });
                        }
                      : undefined
                  }
                >
                  {resolveFields(raw, { page, pages: totalPages, title, properties: props })}
                </div>
              );
            }

            const commit = (value: string) => onSlotChange(variant, band, slot, value);

            return (
              <input
                key={slot}
                ref={el => registerInput(key, el)}
                className={`${styles.slot} ${styles.slotInput} ${styles[slot]}`}
                value={raw}
                aria-label={`${variantLabel(variant, band, config)}, ${slot}`}
                placeholder={slot === 'left' && band === 'header' && !raw ? 'Type header…' : ''}
                onChange={e => {
                  commit(e.target.value);
                  autocomplete.track(e.target, commit);
                }}
                // `select` covers every way the caret moves without the value
                // changing — arrow keys, a click into the middle, Home/End —
                // each of which can move it out of a token or into one.
                onSelect={e => autocomplete.track(e.currentTarget, commit)}
                onFocus={e => {
                  activeKey.current = key;
                  autocomplete.track(e.currentTarget, commit);
                  if (focus.page !== page || focus.band !== band || focus.slot !== slot) {
                    onFocusChange({ page, band, slot });
                  }
                }}
                // Clicking a row never blurs — the menu preventDefaults its
                // mousedown — so a blur really has left the field.
                onBlur={() => autocomplete.close()}
                onKeyDown={handleKeyDown}
              />
            );
          })}
        </div>
      );
    };

    return (
      <div className={styles.layer}>
        {pages.map(page => BANDS.map(band => renderBand(page, band)))}
        {autocomplete.open && (
          <FieldSuggestionList
            items={autocomplete.items}
            index={autocomplete.index}
            anchor={autocomplete.anchor}
            onPick={autocomplete.pick}
          />
        )}
      </div>
    );
  },
);
