import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
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

describe('Sidebar version copy button', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function stubClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    return writeText;
  }

  /** `fireEvent` rather than `userEvent`, whose `setup()` installs a clipboard
   *  stub of its own over the one under test. */
  async function clickCopy() {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy version' }));
    });
  }

  it('copies the long form, which is what a bug report needs', async () => {
    const writeText = stubClipboard();
    renderSidebar({ version: 'v0.1.0', versionTitle: 'Neutrino v0.1.0 (a1b2c3d)' });

    await clickCopy();

    expect(writeText).toHaveBeenCalledWith('Neutrino v0.1.0 (a1b2c3d)');
  });

  it('copies the displayed version when there is no longer form', async () => {
    const writeText = stubClipboard();
    renderSidebar({ version: 'v0.1.0' });

    await clickCopy();

    expect(writeText).toHaveBeenCalledWith('v0.1.0');
  });

  it('shows the checkmark for three seconds, then goes back to the copy icon', async () => {
    stubClipboard();
    vi.useFakeTimers();
    renderSidebar({ version: 'v0.1.0' });

    await clickCopy();
    expect(screen.getByRole('button', { name: 'Version copied' })).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(2900); });
    expect(screen.getByRole('button', { name: 'Version copied' })).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByRole('button', { name: 'Copy version' })).toBeInTheDocument();
  });

  it('stays on the copy icon when the clipboard refuses', async () => {
    // A checkmark for a copy that did not happen sends the user off to paste
    // whatever was on the clipboard before.
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    renderSidebar({ version: 'v0.1.0' });

    await clickCopy();

    expect(screen.getByRole('button', { name: 'Copy version' })).toBeInTheDocument();
  });
});
