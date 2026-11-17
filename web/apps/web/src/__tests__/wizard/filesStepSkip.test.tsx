/**
 * The Files step inside the real wizard frame (#331): the footer's forward button reads Skip
 * until an import starts, and skipping with files picked but not imported asks first.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const imp = vi.hoisted(() => ({
  fileCount: 0,
  startResult: true,
  start: vi.fn(),
  runState: { status: 'idle' } as { status: string; kind?: string },
}));

vi.mock('@/components/ImportRun', () => ({ useImportRun: () => ({ state: imp.runState }) }));
vi.mock('@/components/LocalImport', () => ({
  useLocalImport: () => ({ fileCount: imp.fileCount, start: imp.start }),
  LocalImportPanel: ({ onStarted }: { onStarted?: () => void }) => (
    <div data-testid="local-import">
      <button onClick={() => onStarted?.()}>Import {imp.fileCount} files</button>
    </div>
  ),
}));

// Every other step is a stand-in: only the Files step is under test here.
function standIn(name: string) {
  return function StandIn() {
    return <p>{name} body</p>;
  };
}
vi.mock('@/components/WelcomeWizard/steps/LookStep', () => ({ LookStep: standIn('look') }));
vi.mock('@/components/WelcomeWizard/steps/ProfileStep', () => ({ ProfileStep: standIn('profile') }));
vi.mock('@/components/WelcomeWizard/steps/AiStep', () => ({ AiStep: standIn('ai') }));
vi.mock('@/components/WelcomeWizard/steps/CalendarStep', () => ({ CalendarStep: standIn('calendar') }));
vi.mock('@/components/WelcomeWizard/steps/InviteStep', () => ({ InviteStep: standIn('invite') }));

import { WelcomeWizard } from '@/components/WelcomeWizard';
import { STEPS } from '@/components/WelcomeWizard/steps';

const FILES = STEPS.findIndex((s) => s.id === 'files');
const footer = () => document.querySelector('footer') as HTMLElement;
const forward = () => within(footer()).getAllByRole('button')[1] as HTMLButtonElement;
const filesStatus = () => document.querySelector('[data-step="files"]')?.getAttribute('data-status');
const skipDialog = () => screen.queryByRole('dialog', { name: /^Skip importing/ });
async function click(el: HTMLElement) {
  await act(async () => { fireEvent.click(el); });
}

function open() {
  const onClose = vi.fn();
  render(<WelcomeWizard startStep={FILES} onClose={onClose} />);
  return onClose;
}

beforeEach(() => {
  imp.fileCount = 0;
  imp.startResult = true;
  imp.runState = { status: 'idle' };
  imp.start.mockReset();
  imp.start.mockImplementation(async () => imp.startResult);
});

describe('the Files step forward button', () => {
  it('reads Skip, not as the primary button, before an import starts', () => {
    open();
    expect(forward().textContent).toBe('Skip');
    expect(forward().className).not.toMatch(/primary/);
  });

  it('skips with no dialog when nothing is picked, and the step reads skipped', async () => {
    open();
    await click(forward());
    expect(skipDialog()).toBeNull();
    expect(screen.getByText('invite body')).toBeTruthy();
    expect(filesStatus()).toBe('skipped');
  });

  it('turns back into Next once Import is pressed, and moves on without asking', async () => {
    imp.fileCount = 1766;
    open();
    await click(screen.getByRole('button', { name: 'Import 1766 files' }));
    expect(forward().textContent).toBe('Next');
    expect(forward().className).toMatch(/primary/);
    await click(forward());
    expect(skipDialog()).toBeNull();
    expect(screen.getByText('invite body')).toBeTruthy();
    expect(filesStatus()).toBe('done');
  });

  it('reads Next when a local import is already running (Back into the step)', () => {
    imp.runState = { status: 'running', kind: 'local' };
    open();
    expect(forward().textContent).toBe('Next');
  });
});

describe('skipping with files picked but not imported', () => {
  beforeEach(() => {
    imp.fileCount = 1766;
  });

  it('asks first, naming how many files', async () => {
    open();
    await click(forward());
    const dialog = skipDialog();
    expect(dialog).toBeTruthy();
    expect(within(dialog as HTMLElement).getByText(/Skip importing 1,766 files\?/)).toBeTruthy();
    expect(screen.queryByText('invite body')).toBeNull();
  });

  it('Skip anyway moves on without importing, and the step reads skipped', async () => {
    open();
    await click(forward());
    await click(screen.getByRole('button', { name: 'Skip anyway' }));
    expect(imp.start).not.toHaveBeenCalled();
    expect(screen.getByText('invite body')).toBeTruthy();
    expect(filesStatus()).toBe('skipped');
  });

  it('Import now starts the import, then moves on with the step done', async () => {
    open();
    await click(forward());
    await click(screen.getByRole('button', { name: 'Import now' }));
    expect(imp.start).toHaveBeenCalledTimes(1);
    expect(screen.getByText('invite body')).toBeTruthy();
    expect(filesStatus()).toBe('done');
  });

  it('Import now stays on the step when the import cannot start', async () => {
    imp.startResult = false;
    open();
    await click(forward());
    await click(screen.getByRole('button', { name: 'Import now' }));
    expect(skipDialog()).toBeNull();
    expect(screen.getByTestId('local-import')).toBeTruthy();
    expect(screen.queryByText('invite body')).toBeNull();
  });

  it('dismissing the question stays on the step', async () => {
    open();
    await click(forward());
    const dialog = skipDialog() as HTMLElement;
    await click(within(dialog).getAllByRole('button', { name: /close/i })[0]);
    expect(skipDialog()).toBeNull();
    expect(screen.getByTestId('local-import')).toBeTruthy();
    expect(imp.start).not.toHaveBeenCalled();
  });

  it('asks before Finish too, since finishing drops the pick the same way', async () => {
    const onClose = open();
    await click(screen.getByRole('button', { name: 'Finish' }));
    expect(skipDialog()).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    await click(screen.getByRole('button', { name: 'Skip anyway' }));
    expect(onClose).toHaveBeenCalledWith('finish');
  });
});
