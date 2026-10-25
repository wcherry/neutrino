import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { WelcomeWizard } from '@/components/WelcomeWizard';
import { useCommitOnLeave, useStep } from '@/components/WelcomeWizard/stepApi';

// The wizard's frame is under test here: each real step has its own suite. A stand-in step can do
// something (`Do it`), and can fail to save (`failSave`), which is all the frame needs to know.
const saves = vi.hoisted(() => ({ fail: false, saved: 0 }));
function standIn(name: string) {
  return function StandIn() {
    const { markDone } = useStep();
    useCommitOnLeave(async () => {
      if (saves.fail) throw new Error('boom');
      saves.saved += 1;
      return false;
    });
    return (
      <div>
        <p>{name} body</p>
        <button onClick={markDone}>Do it</button>
      </div>
    );
  };
}
vi.mock('@/components/WelcomeWizard/steps/LookStep', () => ({ LookStep: standIn('look') }));
vi.mock('@/components/WelcomeWizard/steps/ProfileStep', () => ({ ProfileStep: standIn('profile') }));
vi.mock('@/components/WelcomeWizard/steps/AiStep', () => ({ AiStep: standIn('ai') }));
vi.mock('@/components/WelcomeWizard/steps/CalendarStep', () => ({ CalendarStep: standIn('calendar') }));
vi.mock('@/components/WelcomeWizard/steps/FilesStep', () => ({ FilesStep: standIn('files') }));
vi.mock('@/components/WelcomeWizard/steps/InviteStep', () => ({ InviteStep: standIn('invite') }));

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const item = (step: string) => document.querySelector(`[data-step="${step}"]`) as HTMLElement;
async function click(name: string) {
  await act(async () => { fireEvent.click(button(name)); });
}

function open(props: Partial<React.ComponentProps<typeof WelcomeWizard>> = {}) {
  const onClose = vi.fn();
  render(<WelcomeWizard onClose={onClose} {...props} />);
  return onClose;
}

describe('the frame', () => {
  it('is a dialog titled "Set up Neutrino" with the seven steps listed and the key done', () => {
    open();
    const dialog = screen.getByRole('dialog', { name: 'Set up Neutrino' });
    const list = within(dialog).getAllByRole('listitem');
    expect(list.map((li) => li.getAttribute('data-step'))).toEqual(['key', 'look', 'profile', 'ai', 'calendar', 'files', 'invite']);
    expect(item('key').getAttribute('data-status')).toBe('done');
    expect(item('look').getAttribute('data-status')).toBe('current');
    expect(item('look').getAttribute('aria-current')).toBe('step');
    expect(item('invite').getAttribute('data-status')).toBe('upcoming');
  });

  it('opens on step 2 of 7 with its heading, intro and footnote', () => {
    open();
    expect(screen.getByText('Step 2 of 7')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Make it yours' })).toBeTruthy();
    expect(screen.getByTestId('wizard-footnote').textContent).toContain('Settings › Appearance');
  });

  it('has Back, Next and Finish in the footer and nothing else', () => {
    open();
    const footer = document.querySelector('footer') as HTMLElement;
    expect(within(footer).getAllByRole('button').map((b) => b.textContent)).toEqual(['Back', 'Next', 'Finish']);
  });

  it('never shows the word "optional", on any step', async () => {
    open();
    for (let i = 0; i < 5; i += 1) {
      expect(document.body.textContent?.toLowerCase()).not.toContain('optional');
      await click('Next');
    }
    expect(document.body.textContent?.toLowerCase()).not.toContain('optional');
  });
});

describe('Back, Next and Finish', () => {
  it('disables Back on step 2', () => {
    open();
    expect(button('Back').disabled).toBe(true);
    expect(button('Next').disabled).toBe(false);
  });

  it('walks forward and back, and each step shows its own heading and footnote', async () => {
    open();
    await click('Next');
    expect(screen.getByText('Step 3 of 7')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'How should people see you?' })).toBeTruthy();
    expect(button('Back').disabled).toBe(false);
    await click('Back');
    expect(screen.getByText('Step 2 of 7')).toBeTruthy();
  });

  it('turns Next off on step 7 and makes Finish the primary button', async () => {
    open();
    for (let i = 0; i < 5; i += 1) await click('Next');
    expect(screen.getByText('Step 7 of 7')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Neutrino is better with people you trust' })).toBeTruthy();
    expect(button('Next').disabled).toBe(true);
    expect(button('Back').disabled).toBe(false);
    expect(button('Finish').className).toMatch(/primary/);
    expect(button('Next').className).not.toMatch(/primary/);
  });

  it('keeps Next as the primary button before step 7, with Finish still there', () => {
    open();
    expect(button('Next').className).toMatch(/primary/);
    expect(button('Finish').disabled).toBe(false);
    expect(button('Finish').className).not.toMatch(/primary/);
  });

  it('ends with onClose("finish") from Finish, from any step', async () => {
    const onClose = open();
    await click('Next');
    await click('Finish');
    expect(onClose).toHaveBeenCalledWith('finish');
  });

  it('ends with onClose("close") from the close button and from Escape', async () => {
    const onClose = open();
    await click('Close');
    expect(onClose).toHaveBeenCalledWith('close');

    const again = open();
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(again).toHaveBeenCalledWith('close');
  });

  it('opens on the step it is told to (back from a calendar provider)', () => {
    open({ startStep: 4 });
    expect(screen.getByText('Step 5 of 7')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'See all your calendars in one place' })).toBeTruthy();
  });
});

describe('skipped', () => {
  it('lists a step the user left having done nothing as "skipped"', async () => {
    open();
    await click('Next');
    expect(within(item('look')).getByText('skipped')).toBeTruthy();
    expect(item('look').getAttribute('data-status')).toBe('skipped');
    expect(item('profile').getAttribute('data-status')).toBe('current');
  });

  it('lists a step the user did something in as done, with no "skipped"', async () => {
    open();
    await click('Do it');
    await click('Next');
    expect(item('look').getAttribute('data-status')).toBe('done');
    expect(within(item('look')).queryByText('skipped')).toBeNull();
  });

  it('counts leaving by Back the same way, and takes it back when the step is done on return', async () => {
    open();
    await click('Next');
    await click('Next');
    await click('Back');
    expect(item('ai').getAttribute('data-status')).toBe('skipped');
    expect(item('profile').getAttribute('data-status')).toBe('current');
    await click('Back');
    expect(item('profile').getAttribute('data-status')).toBe('skipped');
    await click('Do it');
    await click('Next');
    expect(item('look').getAttribute('data-status')).toBe('done');
  });

  it('does not mark a step it has not reached', async () => {
    open();
    await click('Next');
    expect(item('ai').getAttribute('data-status')).toBe('upcoming');
  });
});

describe('saving when a step is left', () => {
  it('runs the step\'s save on Next, Back and Finish', async () => {
    saves.saved = 0;
    open();
    await click('Next');
    await click('Back');
    await click('Finish');
    expect(saves.saved).toBe(3);
  });

  it('keeps the user on a step whose save failed, but lets them close', async () => {
    saves.fail = true;
    const onClose = open();
    await click('Next');
    expect(screen.getByText('Step 2 of 7')).toBeTruthy();
    await click('Finish');
    expect(onClose).not.toHaveBeenCalled();
    await click('Close');
    expect(onClose).toHaveBeenCalledWith('close');
    saves.fail = false;
  });
});
