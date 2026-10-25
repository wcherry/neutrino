import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Topbar } from '../Topbar';
import { ShellTopBar } from '../shell/ShellTopBar';
import { Sidebar } from '../Sidebar';
import { ShellSidebar } from '../shell/ShellSidebar';

const user = { name: 'Pat', email: 'pat@example.test' };

describe('"Take the … tour" in the account menu', () => {
  it('replays the tour from the classic user menu', async () => {
    const onTakeTour = vi.fn();
    render(<Topbar user={user} onTakeTour={onTakeTour} tourLabel="Take the Drive tour" />);
    await userEvent.click(screen.getByRole('button', { name: 'User menu' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Take the Drive tour' }));
    expect(onTakeTour).toHaveBeenCalledOnce();
  });

  it('replays the tour from the new looks’ account menu', async () => {
    const onTakeTour = vi.fn();
    render(
      <ShellTopBar logoHref="/drive" onOpenPalette={vi.fn()} user={user} account={{ onTakeTour, tourLabel: 'Take the Drive tour' }} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Take the Drive tour' }));
    expect(onTakeTour).toHaveBeenCalledOnce();
  });

  it('is not there when the app on screen has no tour', async () => {
    render(<ShellTopBar logoHref="/drive" onOpenPalette={vi.fn()} user={user} account={{ onSettings: vi.fn() }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.queryByRole('menuitem', { name: /tour/ })).toBeNull();
  });
});

describe('tour targets in the shell', () => {
  const quota = { usedBytes: 1, totalBytes: 10 };

  it('marks the top bar’s right end and the storage meter in both shells', () => {
    const classic = render(
      <>
        <Topbar user={user} onOpenPalette={vi.fn()} />
        <Sidebar sections={[]} quota={quota} />
      </>,
    );
    const corner = document.querySelector('[data-tour="top-right"]')!;
    expect(corner).toContainElement(screen.getByRole('button', { name: 'Search and commands' }));
    expect(corner).toContainElement(screen.getByRole('button', { name: 'User menu' }));
    expect(document.querySelector('[data-tour="storage"]')).toContainElement(screen.getByRole('progressbar'));
    classic.unmount();

    render(
      <>
        <ShellTopBar logoHref="/drive" onOpenPalette={vi.fn()} user={user} />
        <ShellSidebar sections={[]} quota={quota} />
      </>,
    );
    const flowCorner = document.querySelector('[data-tour="top-right"]')!;
    expect(flowCorner).toContainElement(screen.getByRole('button', { name: 'Search and commands' }));
    expect(flowCorner).toContainElement(screen.getByRole('button', { name: 'Account' }));
    expect(document.querySelector('[data-tour="storage"]')).toContainElement(screen.getByRole('progressbar'));
  });
});
