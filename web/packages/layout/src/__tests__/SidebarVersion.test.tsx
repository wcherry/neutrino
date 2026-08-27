import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShell } from '../AppShell';
import { Sidebar } from '../Sidebar';

/** `Sidebar` reads the collapsed state off the shell, so it renders inside one. */
function renderSidebar(props: React.ComponentProps<typeof Sidebar>) {
  return render(<AppShell sidebar={<Sidebar {...props} />}>{null}</AppShell>);
}

describe('Sidebar version footer', () => {
  it('shows the running version', () => {
    renderSidebar({ version: 'v0.1.0', versionTitle: 'Neutrino v0.1.0 (a1b2c3d)' });

    const label = screen.getByText('v0.1.0');
    expect(label).toBeInTheDocument();
    // The build id is what makes a bug report actionable, but it is too long
    // for the rail — it rides along in the tooltip.
    expect(label).toHaveAttribute('title', 'Neutrino v0.1.0 (a1b2c3d)');
  });

  it('falls back to the version itself when no longer form is given', () => {
    renderSidebar({ version: 'v0.1.0' });

    expect(screen.getByText('v0.1.0')).toHaveAttribute('title', 'v0.1.0');
  });

  it('renders no footer when there is no version to report', () => {
    renderSidebar({});

    expect(screen.queryByText(/^v\d/)).not.toBeInTheDocument();
  });
});
