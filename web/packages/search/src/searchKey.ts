const STORAGE_KEY_PREFIX = 'search_key_v1_';
const KEY_BYTES = 32;

export function getOrCreateSearchKey(userId: string): Uint8Array {
  const storageKey = `${STORAGE_KEY_PREFIX}${userId}`;
  const stored = localStorage.getItem(storageKey);
  if (stored) {
    return Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
  }
  const key = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  localStorage.setItem(storageKey, btoa(String.fromCharCode(...key)));
  return key;
}
