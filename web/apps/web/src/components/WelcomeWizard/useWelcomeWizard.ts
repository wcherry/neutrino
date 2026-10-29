'use client';

import { useCallback, useState } from 'react';
import { usePreference, type PreferenceStore } from '@neutrino/preferences';
import { takeReturnStep, wizardAutoStartAllowed } from './autoStart';
import { FIRST_STEP, STEPS } from './steps';

export interface WelcomeWizardOptions {
  /** Signed in, and this user's preferences have come from the server — `onboarding.welcome` is real. */
  ready: boolean;
  /** Something the wizard must not open over (the encryption key dialog) is still deciding or showing. */
  blocked: boolean;
  store?: PreferenceStore;
}

export interface WelcomeWizardState {
  open: boolean;
  startStep: number;
  /** Ends the wizard for good: Finish, or closing it early. */
  finish: () => void;
}

/**
 * Whether the welcome wizard is open.
 *
 * The decision is `onboarding.welcome`, which the server sets to `pending` when it creates an
 * account (self-serve, from an invite, or by an administrator) and which defaults to `done`, so
 * an account the server never marked — every account that existed before the wizard — cannot see
 * it. It is read only once the user's own values have arrived (`ready`), never on the default a
 * fresh browser starts with. Finishing or closing writes `done`, which syncs: it does not come
 * back on reload or on another device.
 */
export function useWelcomeWizard({ ready, blocked, store }: WelcomeWizardOptions): WelcomeWizardState {
  const [mark, setMark] = usePreference('onboarding.welcome', store);
  const pending = ready && !blocked && mark === 'pending';
  // Read once, when it first opens: the step a calendar provider's sign-in page sent the user from.
  const [startStep] = useState(() => {
    if (typeof window === 'undefined') return FIRST_STEP;
    const returning = takeReturnStep();
    const index = STEPS.findIndex((s) => s.id === returning);
    return index > 0 ? index : FIRST_STEP;
  });
  const open = pending && wizardAutoStartAllowed();
  const finish = useCallback(() => setMark('done'), [setMark]);
  return { open, startStep, finish };
}
