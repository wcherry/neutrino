/**
 * The `{{` autocomplete inside a header or footer band.
 *
 * The bands are plain `<input>` elements, not the ProseMirror document, so none
 * of the body editor's machinery reaches them — the behaviour has to be built a
 * second time over a caret offset and a string. These tests are what says the
 * two are the same feature: the same codes, the same ranking, the same keys,
 * and the same rule that a fallback closes the menu.
 *
 * The band-specific hazard is Escape and Enter. The band already binds both —
 * Escape leaves edit mode, Enter commits and blurs — so an autocomplete that
 * did not take them first would be dismissible only by deleting what you typed.
 */

import React, { useRef, useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import {
  HeaderFooterLayer,
  type HeaderFooterFocus,
  type HeaderFooterLayerHandle,
} from '@/app/(apps)/docs/editor/HeaderFooterLayer';
import {
  defaultHeaderFooterConfig,
  setSlot,
  type HeaderFooterConfig,
} from '@/lib/docHeaderFooter';
import { emptyDocProperties, type DocProperties } from '@/lib/docFields';

function Harness({
  properties,
  totalPages = 2,
}: {
  properties?: DocProperties;
  totalPages?: number;
}) {
  const [config, setConfig] = useState<HeaderFooterConfig>(defaultHeaderFooterConfig);
  const [focus, setFocus] = useState<HeaderFooterFocus>({ page: 1, band: 'header', slot: 'left' });
  const layer = useRef<HeaderFooterLayerHandle>(null);

  return (
    <HeaderFooterLayer
      ref={layer}
      config={config}
      totalPages={totalPages}
      pageHeight={1056}
      gap={48}
      marginLeft={72}
      marginRight={72}
      title="Quarterly report"
      properties={properties}
      editing
      focus={focus}
      onFocusChange={setFocus}
      onSlotChange={(variant, band, slot, value) =>
        setConfig(c => setSlot(c, variant, band, slot, value))
      }
      onRequestEdit={setFocus}
      onExitEdit={() => {}}
    />
  );
}

afterEach(cleanup);

/** The left slot of page 1's header — where the caret starts. */
function slot(): HTMLInputElement {
  return screen.getAllByLabelText('Header, left')[0] as HTMLInputElement;
}

/** Type `text` into the band, as a keystroke would: value plus caret. */
function type(input: HTMLInputElement, text: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text, selectionStart: text.length } });
}

const rows = () => screen.queryAllByRole('option').map(el => el.textContent ?? '');
const menu = () => screen.queryByRole('listbox');

describe('the menu in a band', () => {
  it('opens on {{ and lists every code', () => {
    render(<Harness />);
    type(slot(), '{{');

    expect(menu()).toBeInTheDocument();
    expect(screen.getByText('Page number')).toBeInTheDocument();
    expect(screen.getByText('Author')).toBeInTheDocument();
  });

  it('narrows and ranks as more is typed', () => {
    render(<Harness />);
    type(slot(), '{{p');

    expect(rows()[0]).toContain('Page number');
    expect(rows()[1]).toContain('Page count');
    expect(screen.queryByText('Title')).toBeNull();
  });

  it('opens mid-text, not only at the start of the band', () => {
    render(<Harness />);
    type(slot(), 'Draft — {{ti');

    expect(rows()[0]).toContain('Title');
  });

  it('closes once a fallback starts', () => {
    render(<Harness />);
    type(slot(), '{{author');
    expect(menu()).toBeInTheDocument();

    type(slot(), '{{author:');
    expect(menu()).toBeNull();
  });

  it('closes when nothing matches', () => {
    render(<Harness />);
    type(slot(), '{{zzz');
    expect(menu()).toBeNull();
  });

  it("offers the document's own custom properties", () => {
    render(<Harness properties={{ ...emptyDocProperties(), custom: { client: 'Initech' } }} />);
    type(slot(), '{{cl');

    expect(rows()[0]).toContain('client');
  });

  it('draws nothing before a token is started', () => {
    render(<Harness />);
    type(slot(), 'Confidential');
    expect(menu()).toBeNull();
  });
});

describe('the keys in a band', () => {
  it('inserts the highlighted code on Enter, leaving no braces behind', () => {
    render(<Harness />);
    const input = slot();
    type(input, 'Page {{p');

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input).toHaveValue('Page {{page}}');
    expect(menu()).toBeNull();
  });

  it('walks the list with the arrows before inserting', () => {
    render(<Harness />);
    const input = slot();
    type(input, '{{p');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input).toHaveValue('{{pages}}');
  });

  it('wraps the highlight at the top of the list', () => {
    render(<Harness />);
    const input = slot();
    type(input, '{{pag');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Two matches — page, pages — so Up from the first lands on the last.
    expect(input).toHaveValue('{{pages}}');
  });

  it('inserts on Tab as well', () => {
    render(<Harness />);
    const input = slot();
    type(input, '{{ti');

    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input).toHaveValue('{{title}}');
  });

  it('keeps what follows the token', () => {
    render(<Harness />);
    const input = slot();
    type(input, '{{p of 12');
    // Nothing is open: the caret is at the end, past the spaces, so there is no
    // token there to complete.
    expect(menu()).toBeNull();

    // Click back into the middle, just after `{{p`.
    input.setSelectionRange(3, 3);
    fireEvent.select(input);
    expect(rows()[0]).toContain('Page number');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('{{page}} of 12');
  });

  it('leaves the band open when Escape only dismisses the menu', () => {
    let exits = 0;
    function Wrapper() {
      const [config, setConfig] = useState<HeaderFooterConfig>(defaultHeaderFooterConfig);
      const [focus, setFocus] = useState<HeaderFooterFocus>({
        page: 1, band: 'header', slot: 'left',
      });
      return (
        <HeaderFooterLayer
          config={config}
          totalPages={1}
          pageHeight={1056}
          gap={48}
          marginLeft={72}
          marginRight={72}
          title="Quarterly report"
          editing
          focus={focus}
          onFocusChange={setFocus}
          onSlotChange={(v, b, s, value) => setConfig(c => setSlot(c, v, b, s, value))}
          onRequestEdit={setFocus}
          onExitEdit={() => { exits += 1; }}
        />
      );
    }
    render(<Wrapper />);
    const input = slot();
    type(input, '{{p');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(menu()).toBeNull();
    expect(exits).toBe(0);

    // Second Escape, with no menu to dismiss, leaves the band as it always did.
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(exits).toBe(1);
  });

  it('stays dismissed while the caret is still in the token', () => {
    render(<Harness />);
    const input = slot();
    type(input, '{{p');
    fireEvent.keyDown(input, { key: 'Escape' });

    type(input, '{{pa');
    expect(menu()).toBeNull();
  });
});

describe('clicking a row', () => {
  it('inserts that row', () => {
    render(<Harness />);
    const input = slot();
    type(input, '{{p');

    fireEvent.mouseDown(screen.getAllByRole('option')[1]);
    expect(input).toHaveValue('{{pages}}');
  });
});

// Pages more than `EDIT_WINDOW` away from the focused one render resolved text
// instead of an input, which is where a band's resolved value is visible.
const RESOLVED_PAGE = 6;
const resolved = () => within(screen.getByTestId(`hf-band-${RESOLVED_PAGE}-header`));

describe('what the band then shows', () => {
  it('resolves a metadata code the band never used to understand', () => {
    render(
      <Harness properties={{ ...emptyDocProperties(), author: 'Ada Lovelace' }} totalPages={8} />,
    );
    type(slot(), '{{author}}');

    expect(resolved().getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('shows the fallback until the property is filled in', () => {
    render(<Harness totalPages={8} />);
    type(slot(), '{{author:My Self}}');

    expect(resolved().getByText('My Self')).toBeInTheDocument();
  });

  it('resolves a custom property', () => {
    render(
      <Harness properties={{ ...emptyDocProperties(), custom: { client: 'Initech' } }} totalPages={8} />,
    );
    type(slot(), 'For {{client}}');

    expect(resolved().getByText('For Initech')).toBeInTheDocument();
  });
});
