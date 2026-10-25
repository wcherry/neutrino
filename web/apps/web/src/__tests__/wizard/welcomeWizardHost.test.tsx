import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { PreferenceStore } from '@neutrino/preferences';
import {
  WIZARD_AUTO_START_KEY,
  WIZARD_RETURN_KEY,
  useWelcomeWizard,
  wizardAutoStartAllowed,
} from '@/components/WelcomeWizard';
import { SETTLE_MS, useTourController, type TourDefinition } from '@/components/Tour';

function setWebdriver(value: boolean | undefined) {
  Object.defineProperty(navigator, 'webdriver', { value, configurable: true });
}

beforeEach(() => {
  window.localStorage.setItem(WIZARD_AUTO_START_KEY, 'on');
});
afterEach(() => {
  window.localStorage.removeItem(WIZARD_AUTO_START_KEY);
  window.sessionStorage.removeItem(WIZARD_RETURN_KEY);
  setWebdriver(undefined);
  vi.useRealTimers();
});

describe('who sees the wizard', () => {
  it('nobody, unless the server marked the account: an existing account is never shown it', () => {
    const store = new PreferenceStore(null, null);
    // What every account that predates the wizard reads: the default.
    expect(store.get('onboarding.welcome')).toBe('done');
    const { result } = renderHook(() => useWelcomeWizard({ ready: true, blocked: false, store }));
    expect(result.current.open).toBe(false);
  });

  it('a new account, marked pending, once its preferences have arrived and nothing else is in the way', () => {
    const store = new PreferenceStore(null, null);
    store.set('onboarding.welcome', 'pending');
    const { result, rerender } = renderHook((p: { ready: boolean; blocked: boolean }) => useWelcomeWizard({ ...p, store }), {
      initialProps: { ready: false, blocked: false },
    });
    // Preferences not here yet: the mark is not yet the user's real value.
    expect(result.current.open).toBe(false);
    // The encryption key dialog is still deciding or showing.
    rerender({ ready: true, blocked: true });
    expect(result.current.open).toBe(false);
    rerender({ ready: true, blocked: false });
    expect(result.current.open).toBe(true);
    expect(result.current.startStep).toBe(1);
  });

  it('once: finishing or closing writes done, so it does not come back', () => {
    const store = new PreferenceStore(null, null);
    store.set('onboarding.welcome', 'pending');
    const { result, rerender } = renderHook(() => useWelcomeWizard({ ready: true, blocked: false, store }));
    expect(result.current.open).toBe(true);
    act(() => result.current.finish());
    expect(store.get('onboarding.welcome')).toBe('done');
    // The write is queued for the server like any preference, so a reload or a second sign-in reads done.
    expect(store.pendingKeys().has('onboarding.welcome')).toBe(true);
    rerender();
    expect(result.current.open).toBe(false);
  });
});

describe('under browser automation', () => {
  it('does not open by itself, because every e2e spec registers a fresh, marked user', () => {
    window.localStorage.removeItem(WIZARD_AUTO_START_KEY);
    setWebdriver(true);
    expect(wizardAutoStartAllowed()).toBe(false);
    const store = new PreferenceStore(null, null);
    store.set('onboarding.welcome', 'pending');
    const { result } = renderHook(() => useWelcomeWizard({ ready: true, blocked: false, store }));
    expect(result.current.open).toBe(false);
  });

  it('opens when a spec asks for it, and not when it is switched off', () => {
    setWebdriver(true);
    window.localStorage.setItem(WIZARD_AUTO_START_KEY, 'on');
    expect(wizardAutoStartAllowed()).toBe(true);
    window.localStorage.setItem(WIZARD_AUTO_START_KEY, 'off');
    setWebdriver(undefined);
    expect(wizardAutoStartAllowed()).toBe(false);
    window.localStorage.removeItem(WIZARD_AUTO_START_KEY);
    expect(wizardAutoStartAllowed()).toBe(true);
  });
});

describe('coming back from a calendar provider', () => {
  it('reopens on the calendar step once, and then forgets it', () => {
    window.sessionStorage.setItem(WIZARD_RETURN_KEY, 'calendar');
    const store = new PreferenceStore(null, null);
    store.set('onboarding.welcome', 'pending');
    const { result } = renderHook(() => useWelcomeWizard({ ready: true, blocked: false, store }));
    expect(result.current.startStep).toBe(4);
    expect(window.sessionStorage.getItem(WIZARD_RETURN_KEY)).toBeNull();
  });

  it('ignores a step name it does not know', () => {
    window.sessionStorage.setItem(WIZARD_RETURN_KEY, 'nonsense');
    const { result } = renderHook(() => useWelcomeWizard({ ready: true, blocked: false, store: new PreferenceStore(null, null) }));
    expect(result.current.startStep).toBe(1);
  });
});

describe('the hand-off to the Drive tour', () => {
  const TOUR: TourDefinition = {
    id: 'drive',
    appName: 'Drive',
    startsOn: (p) => p === '/drive',
    home: '/drive',
    steps: [{ target: 'new', title: 'New', body: 'Make something.' }],
  };

  function Shell({ store }: { store: PreferenceStore }) {
    // Wired as AppShellLayout wires them: the wizard open blocks the tour.
    const wizard = useWelcomeWizard({ ready: true, blocked: false, store });
    const tours = useTourController({ pathname: '/drive', ready: true, blocked: wizard.open, store, tours: [TOUR] });
    return (
      <>
        <button data-tour="new" ref={(el) => {
          if (el) el.getBoundingClientRect = () => ({ left: 10, top: 10, width: 100, height: 30, right: 110, bottom: 40, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect;
        }}>New</button>
        {wizard.open && (
          <div role="dialog" aria-modal="true" aria-label="Set up Neutrino">
            <button onClick={wizard.finish}>Finish</button>
          </div>
        )}
        {tours.overlay}
      </>
    );
  }

  const tourDialog = () => screen.queryByRole('dialog', { name: 'Drive tour' });

  it('waits while the wizard is open, then starts by itself when it closes', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem('neutrino.tours.autoStart', 'on');
    const store = new PreferenceStore(null, null);
    store.set('onboarding.welcome', 'pending');
    render(<Shell store={store} />);

    await act(async () => { vi.advanceTimersByTime(SETTLE_MS * 6); });
    expect(screen.getByRole('dialog', { name: 'Set up Neutrino' })).toBeTruthy();
    expect(tourDialog()).toBeNull();

    await act(async () => { screen.getByRole('button', { name: 'Finish' }).click(); });
    expect(screen.queryByRole('dialog', { name: 'Set up Neutrino' })).toBeNull();
    await act(async () => { vi.advanceTimersByTime(SETTLE_MS * 3); });
    expect(tourDialog()).not.toBeNull();
    window.localStorage.removeItem('neutrino.tours.autoStart');
  });

  it('does not start a tour for a user whose tour has been seen, wizard or not', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem('neutrino.tours.autoStart', 'on');
    const store = new PreferenceStore(null, null);
    store.set('onboarding.toursSeen', ['drive']);
    render(<Shell store={store} />);
    await act(async () => { vi.advanceTimersByTime(SETTLE_MS * 6); });
    expect(screen.queryByRole('dialog', { name: 'Set up Neutrino' })).toBeNull();
    expect(tourDialog()).toBeNull();
    window.localStorage.removeItem('neutrino.tours.autoStart');
  });
});
