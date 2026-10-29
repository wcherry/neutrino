import { describe, it, expect } from 'vitest';
import { FIRST_STEP, LAST_STEP, STEPS, canGoBack, canGoNext, statusOf, type StepId } from '@/components/WelcomeWizard';

const none = new Set<StepId>();

describe('the seven steps', () => {
  it('are the ones the wizard promises, in order, with the key first', () => {
    expect(STEPS.map((s) => s.label)).toEqual([
      'Encryption key',
      'Look & theme',
      'Your profile',
      'AI assistant',
      'Calendar',
      'Bring your files',
      'Invite friends',
    ]);
    expect(STEPS.map((s) => s.heading).slice(1)).toEqual([
      'Make it yours',
      'How should people see you?',
      'Bring your own AI',
      'See all your calendars in one place',
      'Bring your files with you',
      'Neutrino is better with people you trust',
    ]);
  });

  it('never call anything optional', () => {
    for (const s of STEPS) {
      expect(JSON.stringify(s).toLowerCase()).not.toContain('optional');
    }
  });

  it('each say where they live later, in places that exist', () => {
    const notes = Object.fromEntries(STEPS.map((s) => [s.id, s.footnote]));
    expect(notes.look).toContain('Settings › Appearance');
    expect(notes.profile).toContain('account menu');
    expect(notes.ai).toContain('Settings › AI Assistant');
    // The calendar sidebar lists calendars but cannot connect one: only Settings can.
    expect(notes.calendar).toContain('Settings › Calendar');
    expect(notes.files).toContain('New › Import folders');
    expect(notes.files).toContain('Import in the account menu for Google Takeout');
    expect(notes.invite).toContain('Invite friends in the account menu');
  });
});

describe('Back and Next', () => {
  it('opens on step 2, where Back is off and Next is on', () => {
    expect(FIRST_STEP).toBe(1);
    expect(canGoBack(FIRST_STEP)).toBe(false);
    expect(canGoNext(FIRST_STEP)).toBe(true);
  });

  it('are both on in the middle', () => {
    for (let i = FIRST_STEP + 1; i < LAST_STEP; i += 1) {
      expect(canGoBack(i)).toBe(true);
      expect(canGoNext(i)).toBe(true);
    }
  });

  it('turn Next off on step 7, the last', () => {
    expect(LAST_STEP).toBe(6);
    expect(canGoBack(LAST_STEP)).toBe(true);
    expect(canGoNext(LAST_STEP)).toBe(false);
  });
});

describe('what the list says about a step', () => {
  it('shows the key as done whatever else is true', () => {
    expect(statusOf(0, 1, none, none)).toBe('done');
    expect(statusOf(0, 4, none, new Set(['look']))).toBe('done');
  });

  it('marks the one on screen as current and the rest as upcoming', () => {
    expect(statusOf(1, 1, none, none)).toBe('current');
    expect(statusOf(2, 1, none, none)).toBe('upcoming');
  });

  it('marks a step left with nothing done as skipped, and one with something done as done', () => {
    const left = new Set<StepId>(['look', 'profile']);
    const done = new Set<StepId>(['profile']);
    expect(statusOf(1, 3, done, left)).toBe('skipped');
    expect(statusOf(2, 3, done, left)).toBe('done');
  });

  it('takes the skipped mark back when the user returns and does something', () => {
    const left = new Set<StepId>(['look']);
    expect(statusOf(1, 3, none, left)).toBe('skipped');
    expect(statusOf(1, 3, new Set(['look']), left)).toBe('done');
  });
});
