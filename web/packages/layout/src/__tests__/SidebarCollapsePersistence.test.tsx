import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { AppShell } from '../AppShell';
import { Sidebar } from '../Sidebar';

const KEY = 'neutrino.sidebar.collapsed';

function renderShell() {
  return render(<AppShell sidebar={<Sidebar />} topbar={null}>{null}</AppShell>);
}

/** The toggle is the only control that reports the state, via its label. */
function toggle() {
  return screen.getByRole('button', { name: /(Collapse|Expand) sidebar/ });
}

describe('sidebar collapse persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts expanded when nothing is stored', () => {
    renderShell();

    expect(toggle()).toHaveAccessibleName('Collapse sidebar');
  });

  it('stores the choice when the sidebar is collapsed', () => {
    renderShell();

    fireEvent.click(toggle());

    expect(toggle()).toHaveAccessibleName('Expand sidebar');
    expect(localStorage.getItem(KEY)).toBe('true');
  });

  it('restores the collapsed state on a later mount', () => {
    localStorage.setItem(KEY, 'true');

    renderShell();

    expect(toggle()).toHaveAccessibleName('Expand sidebar');
  });

  it('stores the choice when the sidebar is expanded again', () => {
    localStorage.setItem(KEY, 'true');
    renderShell();

    fireEvent.click(toggle());

    expect(toggle()).toHaveAccessibleName('Collapse sidebar');
    expect(localStorage.getItem(KEY)).toBe('false');
  });

  it('picks up a change made in another tab', () => {
    renderShell();

    localStorage.setItem(KEY, 'true');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'true' }));
    });

    expect(toggle()).toHaveAccessibleName('Expand sidebar');
  });
});
