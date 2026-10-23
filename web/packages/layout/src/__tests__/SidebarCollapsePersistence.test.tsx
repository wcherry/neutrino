import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { preferences } from '@neutrino/preferences';
import { AppShell } from '../AppShell';
import { Sidebar } from '../Sidebar';

/** Where device-tier preferences live (`@neutrino/preferences` store). */
const DEVICE_KEY = 'neutrino.prefs.device';

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
    preferences.reset('shell.sidebarCollapsed');
  });

  it('starts expanded when nothing is stored', () => {
    renderShell();

    expect(toggle()).toHaveAccessibleName('Collapse sidebar');
  });

  it('stores the choice, on this device only, when the sidebar is collapsed', () => {
    renderShell();

    fireEvent.click(toggle());

    expect(toggle()).toHaveAccessibleName('Expand sidebar');
    expect(JSON.parse(localStorage.getItem(DEVICE_KEY)!)['shell.sidebarCollapsed']).toBe(true);
  });

  it('restores the collapsed state on a later mount', () => {
    preferences.set('shell.sidebarCollapsed', true);

    renderShell();

    expect(toggle()).toHaveAccessibleName('Expand sidebar');
  });

  it('stores the choice when the sidebar is expanded again', () => {
    preferences.set('shell.sidebarCollapsed', true);
    renderShell();

    fireEvent.click(toggle());

    expect(toggle()).toHaveAccessibleName('Collapse sidebar');
    expect(JSON.parse(localStorage.getItem(DEVICE_KEY)!)['shell.sidebarCollapsed']).toBe(false);
  });

  it('picks up a change made in another tab', () => {
    renderShell();

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: DEVICE_KEY, newValue: JSON.stringify({ 'shell.sidebarCollapsed': true }) }),
      );
    });

    expect(toggle()).toHaveAccessibleName('Expand sidebar');
  });
});
