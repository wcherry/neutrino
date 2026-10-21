/**
 * The cross-device preferences signal, apart from the sync module so the notification socket can
 * recognise it without importing the store and its wiring.
 *
 * The server sends `preferences.changed` on the user's notification socket after any successful
 * write under `/api/v1/preferences` (`shared::drive_events`); `useNotifications` re-dispatches it
 * on `window`, and `usePreferencesSync` re-reads the store when it hears it.
 */
export const PREFERENCES_CHANGED_TYPE = 'preferences.changed';
export const PREFERENCES_CHANGED_EVENT = 'neutrino:preferences-changed';
