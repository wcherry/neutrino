/**
 * Device-local override of whether the welcome wizard opens by itself: `on` always, `off` never,
 * anything else the default, which is "except under browser automation" (`navigator.webdriver`).
 * The same rule as the guided tours' (`neutrino.tours.autoStart`): Playwright sets that flag and
 * every spec registers a fresh user, who is marked for the wizard, so no spec gets a dialog over
 * the page it is testing unless it asks for one by setting this key to `on` before the app loads.
 */
export const WIZARD_AUTO_START_KEY = 'neutrino.wizard.autoStart';

/**
 * The step the user left the app from, for a calendar provider's sign-in page. Google and Outlook
 * connect by leaving Neutrino and coming back, and the wizard is otherwise not resumable; this
 * carries it across that one round trip. `sessionStorage`, so it never outlives the tab.
 */
export const WIZARD_RETURN_KEY = 'neutrino.wizard.returnTo';

export function wizardAutoStartAllowed(): boolean {
  let override: string | null = null;
  try {
    override = window.localStorage.getItem(WIZARD_AUTO_START_KEY);
  } catch {
    // No storage: fall through to the default.
  }
  if (override === 'on') return true;
  if (override === 'off') return false;
  return !(typeof navigator !== 'undefined' && navigator.webdriver);
}

/** Remember that the wizard should reopen on `stepId` when the user comes back. */
export function rememberReturnStep(stepId: string): void {
  try {
    window.sessionStorage.setItem(WIZARD_RETURN_KEY, stepId);
  } catch {
    // Without it the wizard reopens at its first step, which is only less convenient.
  }
}

/** The step to reopen on, if the user is coming back from a provider; read once. */
export function takeReturnStep(): string | null {
  try {
    const stepId = window.sessionStorage.getItem(WIZARD_RETURN_KEY);
    if (stepId) window.sessionStorage.removeItem(WIZARD_RETURN_KEY);
    return stepId;
  } catch {
    return null;
  }
}
