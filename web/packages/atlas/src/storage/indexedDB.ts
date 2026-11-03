import type { VaultStorage } from '../sync/vault';

/**
 * Seals what Atlas keeps in this browser. The web's counterpart of AtlasKit's `DeviceSealer`.
 */
export interface Sealer {
  seal(plaintext: Uint8Array): Promise<Uint8Array>;
  open(sealed: Uint8Array): Promise<Uint8Array>;
}

const KEYS_DB = 'neutrino-atlas-keys';
const IV_BYTES = 12;

/**
 * Seals with AES-256-GCM under a WebCrypto key that never leaves this browser: it is created
 * non-extractable and stored in IndexedDB as a `CryptoKey`, so script can use it but nothing
 * can read its bytes, and nothing sealed with it opens anywhere else.
 *
 * It is not the account's keyring and has nothing to do with what Drive holds: losing it loses
 * only this browser's copy of the vault, which the next sync downloads again. One per user, so
 * two accounts in one browser keep their copies apart.
 *
 * Format: a 12-byte random IV, then the ciphertext with its 16-byte tag.
 */
export class DeviceSealer implements Sealer {
  private constructor(private readonly key: CryptoKey) {}

  /** This browser's key for `userId`, created the first time. */
  static async forUser(userId: string): Promise<DeviceSealer> {
    const db = await openDatabase(KEYS_DB, (db) => db.createObjectStore('keys'));
    try {
      const existing = await promised<CryptoKey | undefined>(db.transaction('keys').objectStore('keys').get(userId));
      if (existing) return new DeviceSealer(existing);
      const fresh = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      // Another tab may have made one meanwhile: keep whichever got there first, in one
      // transaction, so both tabs end up with the same key.
      const tx = db.transaction('keys', 'readwrite');
      const store = tx.objectStore('keys');
      const chosen = await new Promise<CryptoKey>((resolve, reject) => {
        const get = store.get(userId);
        get.onsuccess = () => {
          const raced = get.result as CryptoKey | undefined;
          if (raced) return resolve(raced);
          store.add(fresh, userId).onsuccess = () => resolve(fresh);
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      await done(tx);
      return new DeviceSealer(chosen);
    } finally {
      db.close();
    }
  }

  /** For tests: a sealer with a fresh key, stored nowhere. */
  static async ephemeral(): Promise<DeviceSealer> {
    return new DeviceSealer(await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
  }

  async seal(plaintext: Uint8Array): Promise<Uint8Array> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, buffer(plaintext)));
    const out = new Uint8Array(IV_BYTES + sealed.length);
    out.set(iv);
    out.set(sealed, IV_BYTES);
    return out;
  }

  async open(sealed: Uint8Array): Promise<Uint8Array> {
    if (sealed.length < IV_BYTES) throw new Error('Sealed data is too short');
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buffer(sealed.subarray(0, IV_BYTES)) }, this.key, buffer(sealed.subarray(IV_BYTES))),
    );
  }

  /** Forgets this browser's key for `userId`: every vault copy sealed with it becomes unreadable. */
  static async forget(userId: string): Promise<void> {
    const db = await openDatabase(KEYS_DB, (db) => db.createObjectStore('keys'));
    try {
      const tx = db.transaction('keys', 'readwrite');
      tx.objectStore('keys').delete(userId);
      await done(tx);
    } finally {
      db.close();
    }
  }
}

/**
 * A vault's local copy in IndexedDB, every blob and journal entry sealed. Blob keys are random,
 * so the database shows neither titles nor structure; its name holds only the account and the
 * vault folder's ids. AtlasKit's `SealedDiskStorage`, for the browser.
 *
 * IndexedDB transactions are atomic, so a journal entry is either there in full or not at all:
 * unlike a file, there's no torn tail to cut off.
 */
export class IndexedDBStorage implements VaultStorage {
  private constructor(
    private readonly db: IDBDatabase,
    private readonly sealer: Sealer,
  ) {}

  static databaseName(userId: string, vaultID: string): string {
    return `neutrino-atlas-vault:${userId}:${vaultID}`;
  }

  static async open(userId: string, vaultID: string, sealer: Sealer): Promise<IndexedDBStorage> {
    const db = await openDatabase(IndexedDBStorage.databaseName(userId, vaultID), (db) => {
      db.createObjectStore('blobs');
      db.createObjectStore('journal', { autoIncrement: true });
    });
    return new IndexedDBStorage(db, sealer);
  }

  /** Deletes a vault's local copy. Close it first. */
  static async remove(userId: string, vaultID: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(IndexedDBStorage.databaseName(userId, vaultID));
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('The vault is open in another tab'));
    });
  }

  close(): void {
    this.db.close();
  }

  async read(key: string): Promise<Uint8Array | null> {
    const sealed = await promised<Uint8Array | undefined>(this.db.transaction('blobs').objectStore('blobs').get(key));
    return sealed ? this.sealer.open(sealed) : null;
  }

  async write(data: Uint8Array, key: string): Promise<void> {
    const sealed = await this.sealer.seal(data);
    const tx = this.db.transaction('blobs', 'readwrite');
    tx.objectStore('blobs').put(sealed, key);
    await done(tx);
  }

  async remove(key: string): Promise<void> {
    const tx = this.db.transaction('blobs', 'readwrite');
    tx.objectStore('blobs').delete(key);
    await done(tx);
  }

  async appendToJournal(entry: Uint8Array): Promise<void> {
    const sealed = await this.sealer.seal(entry);
    const tx = this.db.transaction('journal', 'readwrite');
    tx.objectStore('journal').add(sealed);
    await done(tx);
  }

  /** In the order appended: auto-increment keys only grow. A wrong key throws. */
  async readJournal(): Promise<Uint8Array[]> {
    const sealed = await promised<Uint8Array[]>(this.db.transaction('journal').objectStore('journal').getAll());
    const entries: Uint8Array[] = [];
    for (const entry of sealed) entries.push(await this.sealer.open(entry));
    return entries;
  }

  async clearJournal(): Promise<void> {
    const tx = this.db.transaction('journal', 'readwrite');
    tx.objectStore('journal').clear();
    await done(tx);
  }
}

/**
 * Holds the vault's lock in this browser for as long as it's open, so two tabs never write one
 * local copy at once (each would journal against its own idea of the manifest). Resolves to the
 * release function, or null when another tab holds it; release resolves once the lock is free
 * again. Where the Web Locks API is missing, every tab gets the lock.
 */
export async function acquireVaultLock(userId: string, vaultID: string): Promise<(() => Promise<void>) | null> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return async () => {};
  return new Promise((resolve, reject) => {
    let release = () => {};
    const held = locks.request(`neutrino-atlas-vault:${userId}:${vaultID}`, { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(null);
        return undefined;
      }
      // Held until released.
      const until = new Promise<void>((r) => (release = r));
      resolve(async () => {
        release();
        await held;
      });
      return until;
    });
    held.catch(reject);
  });
}

// ── IndexedDB helpers ──────────────────────────────────────────────────────────

function openDatabase(name: string, create: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => create(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function promised<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

/** A standalone `ArrayBuffer` of exactly these bytes, as WebCrypto wants. */
function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
