import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Panel } from '../components/containers/Panel';
import { PanelRail, type RailPanel } from '../components/rails/PanelRail';

describe('Panel', () => {
  it('draws a header with the title, the panel’s actions and its one control, over the body and footer', () => {
    const onClick = vi.fn();
    render(
      <Panel
        title="Image properties"
        icon={<svg data-testid="icon" />}
        actions={<button type="button">Apply</button>}
        control={{ label: 'Close image properties', icon: <span>×</span>, onClick }}
        footer={<p>Footer text</p>}
      >
        <p>Body text</p>
      </Panel>,
    );
    const header = screen.getByText('Image properties').closest('header')!;
    expect(header).toContainElement(screen.getByTestId('icon'));
    expect(header).toContainElement(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByText('Body text').closest('header')).toBeNull();
    expect(screen.getByText('Footer text').closest('footer')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Close image properties' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('passes its own attributes through, and labels by its title when asked', () => {
    render(
      <Panel title="Outline" titleId="t1" role="dialog" aria-labelledby="t1" as="aside" headerProps={{ 'data-handle': 'yes' } as React.HTMLAttributes<HTMLElement>}>
        body
      </Panel>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Outline' });
    expect(dialog.tagName).toBe('ASIDE');
    expect(dialog.querySelector('header')).toHaveAttribute('data-handle', 'yes');
  });

  it('has no control when none is given', () => {
    render(<Panel title="Plain">body</Panel>);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('PanelRail panels', () => {
  it('carry their own header actions and footer, docked and floating', () => {
    const panels: RailPanel[] = [
      { id: 'adjust', title: 'Adjust', side: 'right', content: <p>Sliders</p>, actions: <button type="button">Apply</button>, footer: <p>Changes apply to the whole photo</p> },
    ];
    render(
      <PanelRail
        panels={panels}
        sides={['right']}
        defaultLayout={{ version: 1, rails: { right: { panels: [], expanded: null } }, floating: { adjust: { rect: { x: 10, y: 10, width: 300, height: 300 }, home: 'right', homeIndex: 0 } }, sizes: {} }}
      >
        <main>photo</main>
      </PanelRail>,
    );
    const win = screen.getByRole('dialog', { name: 'Adjust' });
    expect(win).toContainElement(screen.getByRole('button', { name: 'Apply' }));
    expect(win).toHaveTextContent('Changes apply to the whole photo');

    fireEvent.click(screen.getByRole('button', { name: 'Close Adjust' }));
    const docked = screen.getByRole('tabpanel', { name: 'Adjust' });
    expect(docked).toContainElement(screen.getByRole('button', { name: 'Apply' }));
    expect(docked).toHaveTextContent('Changes apply to the whole photo');
  });
});
