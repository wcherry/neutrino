import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShell } from '../AppShell';
import { ShellSidebar } from '../shell/ShellSidebar';

/** `ShellSidebar` reads the collapsed state off the shell, so it renders inside one. */
function renderSidebar(props: Partial<React.ComponentProps<typeof ShellSidebar>>) {
  return render(<AppShell sidebar={<ShellSidebar sections={[]} {...props} />}>{null}</AppShell>);
}

describe('ShellSidebar version footer', () => {
  it('shows the running version, with the long form in its tooltip', () => {
    renderSidebar({ version: 'v0.1.0', versionTitle: 'Neutrino v0.1.0 (a1b2c3d)' });

    expect(screen.getByText('v0.1.0')).toHaveAttribute('title', 'Neutrino v0.1.0 (a1b2c3d)');
    expect(screen.getByRole('button', { name: 'Copy version' })).toBeInTheDocument();
  });

  it('renders nothing when there is no version to report', () => {
    renderSidebar({ version: '' });

    expect(screen.queryByRole('button', { name: 'Copy version' })).not.toBeInTheDocument();
  });
});
