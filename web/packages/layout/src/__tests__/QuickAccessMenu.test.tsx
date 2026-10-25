import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickAccessMenu } from '../shell/ShellMenus';
import { Topbar } from '../Topbar';
import { ShellTopBar } from '../shell/ShellTopBar';

const items = [
  { id: 'a', title: 'Plan.docx', subtitle: 'Edited · Today' },
  { id: 's', title: 'Budget.xlsx', subtitle: 'Edited · Monday', starred: true },
];

describe('QuickAccessMenu', () => {
  it('lists the items and opens the one clicked', async () => {
    const onOpen = vi.fn();
    render(<QuickAccessMenu items={items} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: 'Quick access' }));
    expect(screen.getByLabelText('Starred')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Budget\.xlsx/ }));
    expect(onOpen).toHaveBeenCalledWith('s');
  });

  it('says what will appear when there is nothing yet', async () => {
    render(<QuickAccessMenu items={[]} onOpen={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Quick access' }));
    expect(screen.getByText('Files you edit or star appear here.')).toBeTruthy();
  });

  it('sits between the bell and the avatar in both top bars', () => {
    const user = { name: 'Pat', email: 'pat@example.test' };
    const order = () =>
      screen.getAllByRole('button').map((b) => b.getAttribute('aria-label')).filter((n) => /Notifications|Quick access|Account|User menu/i.test(n ?? ''));

    const classic = render(<Topbar user={user} quickAccess={{ items, onOpen: vi.fn() }} />);
    const classicOrder = order();
    expect(classicOrder.indexOf('Quick access')).toBe(classicOrder.indexOf('Notifications') + 1);
    classic.unmount();

    render(<ShellTopBar logoHref="/drive" onOpenPalette={vi.fn()} user={user} quickAccess={{ items, onOpen: vi.fn() }} />);
    const flowOrder = order();
    expect(flowOrder.indexOf('Quick access')).toBe(flowOrder.indexOf('Notifications') + 1);
    expect(flowOrder.indexOf('Quick access')).toBe(flowOrder.length - 2);
  });
});
