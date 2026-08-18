/**
 * Tests for the header/footer bands and the edit-mode toolbar.
 *
 * What these hold down is the behaviour that makes variants usable rather than
 * merely stored: every page draws the band its own variant says it should, and
 * typing into one page's header updates every other page sharing that variant
 * as you type. Without that live echo, "different odd & even" is a checkbox
 * whose effect you can only see by exporting.
 */

import React, { useRef, useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import {
  HeaderFooterLayer,
  type HeaderFooterFocus,
  type HeaderFooterLayerHandle,
} from '@/app/(apps)/docs/editor/HeaderFooterLayer';
import { HeaderFooterToolbar } from '@/app/(apps)/docs/editor/HeaderFooterToolbar';
import {
  FIELDS,
  clearBand,
  defaultHeaderFooterConfig,
  setSlot,
  variantForPage,
  type HeaderFooterConfig,
} from '@/lib/docHeaderFooter';

/** The editor's own wiring, small enough to stand in for it. */
function Harness({
  initial,
  totalPages = 4,
  startEditing = true,
  withToolbar = false,
}: {
  initial?: HeaderFooterConfig;
  totalPages?: number;
  startEditing?: boolean;
  withToolbar?: boolean;
}) {
  const [config, setConfig] = useState(initial ?? defaultHeaderFooterConfig());
  const [editing, setEditing] = useState(startEditing);
  const [focus, setFocus] = useState<HeaderFooterFocus>({ page: 1, band: 'header', slot: 'left' });
  const layer = useRef<HeaderFooterLayerHandle>(null);

  return (
    <>
      {withToolbar && editing && (
        <HeaderFooterToolbar
          config={config}
          focus={focus}
          onToggleDifferentFirstPage={v => setConfig(c => ({ ...c, differentFirstPage: v }))}
          onToggleDifferentEvenOdd={v => setConfig(c => ({ ...c, differentEvenOdd: v }))}
          onMarginChange={(band, pts) =>
            setConfig(c => (band === 'header' ? { ...c, headerMargin: pts } : { ...c, footerMargin: pts }))
          }
          onInsertField={field =>
            setConfig(c => {
              const variant = variantForPage(focus.page, c);
              const current = c.variants[variant][focus.band][focus.slot];
              return setSlot(c, variant, focus.band, focus.slot, current + FIELDS[field]);
            })
          }
          onGoToBand={band => layer.current?.focusField({ ...focus, band })}
          onClearBand={() =>
            setConfig(c => clearBand(c, variantForPage(focus.page, c), focus.band))
          }
          onClose={() => setEditing(false)}
        />
      )}
      <HeaderFooterLayer
        ref={layer}
        config={config}
        totalPages={totalPages}
        pageHeight={1056}
        gap={48}
        marginLeft={72}
        marginRight={72}
        title="Quarterly report"
        editing={editing}
        focus={focus}
        onFocusChange={setFocus}
        onSlotChange={(variant, band, slot, value) =>
          setConfig(c => setSlot(c, variant, band, slot, value))
        }
        onRequestEdit={f => { setFocus(f); setEditing(true); }}
        onExitEdit={() => setEditing(false)}
      />
    </>
  );
}

const band = (page: number, b: 'header' | 'footer') => screen.getByTestId(`hf-band-${page}-${b}`);

describe('HeaderFooterLayer', () => {
  it('renders a header and a footer band for every page', () => {
    render(<Harness totalPages={3} />);
    for (const page of [1, 2, 3]) {
      expect(band(page, 'header')).toBeInTheDocument();
      expect(band(page, 'footer')).toBeInTheDocument();
    }
  });

  it('positions each band inside its own page, from the sheet stride', () => {
    render(<Harness totalPages={2} />);
    // Page 2's sheet starts at 1056 + 48; its header sits 36pt below that.
    expect(band(2, 'header')).toHaveStyle({ top: '1140px' });
    // The footer's bottom edge is 36 above the sheet's bottom, less its height.
    expect(band(1, 'footer')).toHaveStyle({ top: `${1056 - 36 - 24}px` });
  });

  it('shows text typed on one page on every other page of the same variant', () => {
    render(<Harness totalPages={4} />);

    const first = within(band(1, 'header')).getByLabelText('Header, left');
    fireEvent.change(first, { target: { value: 'Confidential' } });

    for (const page of [1, 2, 3]) {
      expect(within(band(page, 'header')).getByLabelText('Header, left')).toHaveValue('Confidential');
    }
  });

  it('gives odd and even pages separate bands once the switch is on', () => {
    let config = defaultHeaderFooterConfig();
    config = { ...config, differentEvenOdd: true };
    config = setSlot(config, 'default', 'header', 'left', 'Odd side');
    config = setSlot(config, 'even', 'header', 'left', 'Even side');
    render(<Harness initial={config} totalPages={4} startEditing={false} />);

    expect(band(1, 'header')).toHaveTextContent('Odd side');
    expect(band(2, 'header')).toHaveTextContent('Even side');
    expect(band(3, 'header')).toHaveTextContent('Odd side');
    expect(band(4, 'header')).toHaveTextContent('Even side');
  });

  it('gives page 1 the first-page variant, which beats odd/even', () => {
    let config = { ...defaultHeaderFooterConfig(), differentFirstPage: true, differentEvenOdd: true };
    config = setSlot(config, 'first', 'header', 'center', 'Cover');
    config = setSlot(config, 'even', 'header', 'center', 'Even');
    config = setSlot(config, 'default', 'header', 'center', 'Odd');
    render(<Harness initial={config} totalPages={3} startEditing={false} />);

    expect(band(1, 'header')).toHaveAttribute('data-variant', 'first');
    expect(band(1, 'header')).toHaveTextContent('Cover');
    expect(band(2, 'header')).toHaveTextContent('Even');
    expect(band(3, 'header')).toHaveTextContent('Odd');
  });

  it('resolves field tokens per page when not editing', () => {
    const config = setSlot(
      defaultHeaderFooterConfig(), 'default', 'footer', 'center', 'Page {{page}} of {{pages}} — {{title}}',
    );
    render(<Harness initial={config} totalPages={3} startEditing={false} />);

    expect(band(1, 'footer')).toHaveTextContent('Page 1 of 3 — Quarterly report');
    expect(band(3, 'footer')).toHaveTextContent('Page 3 of 3 — Quarterly report');
  });

  it('keeps the raw token in the input while editing, so it stays editable', () => {
    const config = setSlot(defaultHeaderFooterConfig(), 'default', 'footer', 'center', 'Page {{page}}');
    render(<Harness initial={config} totalPages={2} />);

    expect(within(band(1, 'footer')).getByLabelText('Footer, center')).toHaveValue('Page {{page}}');
  });

  it('opens edit mode on a double-click in an empty band', () => {
    render(<Harness totalPages={2} startEditing={false} />);
    // Nothing is editable until then.
    expect(screen.queryByLabelText('Header, left')).not.toBeInTheDocument();

    fireEvent.doubleClick(screen.getAllByTitle('Double-click to edit the header')[0]);
    expect(screen.getAllByLabelText('Header, left').length).toBeGreaterThan(0);
  });

  it('leaves edit mode on Escape', () => {
    render(<Harness totalPages={2} />);
    const input = within(band(1, 'header')).getByLabelText('Header, left');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByLabelText('Header, left')).not.toBeInTheDocument();
  });

  it('only mounts inputs near the focused page, and focuses a distant one on click', () => {
    render(<Harness totalPages={12} />);
    // Page 9 is outside the window around page 1: static text, no input.
    expect(within(band(9, 'header')).queryByLabelText('Header, left')).not.toBeInTheDocument();

    // The left slot, standing in for its input until it is clicked.
    fireEvent.mouseDown(band(9, 'header').firstElementChild!);
    // Focus moved there, so its input now exists.
    expect(within(band(9, 'header')).getByLabelText('Header, left')).toBeInTheDocument();
  });
});

describe('HeaderFooterToolbar', () => {
  it('names the variant the caret is in', () => {
    render(<Harness totalPages={4} withToolbar />);
    expect(screen.getByRole('toolbar', { name: 'Header and footer tools' })).toHaveTextContent('Header');

    fireEvent.click(screen.getByTitle('Go to the footer on this page'));
    expect(screen.getByRole('toolbar', { name: 'Header and footer tools' })).toHaveTextContent('Footer');
  });

  it('renames the default variant once odd and even are split', () => {
    render(<Harness totalPages={4} withToolbar />);
    fireEvent.click(screen.getByLabelText('Different odd & even'));
    expect(screen.getByRole('toolbar', { name: 'Header and footer tools' }))
      .toHaveTextContent('Odd page header');
  });

  it('inserts a field token into the focused band', () => {
    render(<Harness totalPages={2} withToolbar />);
    fireEvent.mouseDown(screen.getByTitle('Insert the page number'));

    expect(within(band(1, 'header')).getByLabelText('Header, left')).toHaveValue(FIELDS.page);
  });

  it('clears only the band it is pointed at', () => {
    let config = setSlot(defaultHeaderFooterConfig(), 'default', 'header', 'left', 'Header text');
    config = setSlot(config, 'default', 'footer', 'left', 'Footer text');
    render(<Harness initial={config} totalPages={2} withToolbar />);

    fireEvent.click(screen.getByTitle('Clear the header on this page'));

    expect(within(band(1, 'header')).getByLabelText('Header, left')).toHaveValue('');
    expect(within(band(1, 'footer')).getByLabelText('Footer, left')).toHaveValue('Footer text');
  });

  it('sets the band offsets in inches', () => {
    render(<Harness totalPages={2} withToolbar />);
    const input = screen.getByLabelText('Header from top');
    expect(input).toHaveValue(0.5);

    fireEvent.change(input, { target: { value: '1' } });
    // 1in = 72pt, the unit PageSetup margins use.
    expect(band(1, 'header')).toHaveStyle({ top: '72px' });
  });
});
