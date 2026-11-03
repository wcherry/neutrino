// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceSealer, IndexedDBStorage, acquireVaultLock } from '../storage/indexedDB';
import { LocalVault, VaultInUseError } from '../storage/localVault';
import { Vault } from '../sync/vault';
import { VaultSync } from '../sync/vaultSync';
import { FakeDrive } from './fakeDrive';

let n = 0;
const ids = () => ({ user: `user-${++n}`, vault: `vault-${n}` });
const contains = (haystack: Uint8Array, needle: string) => Buffer.from(haystack).includes(Buffer.from(needle));

/** Every value stored in a database, raw: what someone reading the browser's disk would see. */
async function rawValues(name: string): Promise<{ store: string; key: IDBValidKey; value: unknown }[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(name);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const out: { store: string; key: IDBValidKey; value: unknown }[] = [];
  for (const store of [...db.objectStoreNames]) {
    const os = db.transaction(store).objectStore(store);
    const [keys, values] = await Promise.all(
      [os.getAllKeys(), os.getAll()].map((r) => new Promise<unknown[]>((resolve) => (r.onsuccess = () => resolve(r.result)))),
    );
    keys.forEach((key, i) => out.push({ store, key: key as IDBValidKey, value: values[i] }));
  }
  db.close();
  return out;
}

const opened: { close(): void }[] = [];
afterEach(() => {
  for (const o of opened.splice(0)) o.close();
});

async function openStorage(user: string, vault: string, sealer?: DeviceSealer) {
  const storage = await IndexedDBStorage.open(user, vault, sealer ?? (await DeviceSealer.forUser(user)));
  opened.push(storage);
  return storage;
}

describe('DeviceSealer', () => {
  it('round-trips, and nothing it seals opens under another key', async () => {
    const sealer = await DeviceSealer.ephemeral();
    const plain = new TextEncoder().encode('Secret plans');
    const sealed = await sealer.seal(plain);
    expect(contains(sealed, 'Secret')).toBe(false);
    expect(await sealer.open(sealed)).toEqual(plain);
    // A fresh IV each time.
    expect(await sealer.seal(plain)).not.toEqual(sealed);
    await expect((await DeviceSealer.ephemeral()).open(sealed)).rejects.toThrow();
    // Tampering is caught.
    sealed[sealed.length - 1] ^= 1;
    await expect(sealer.open(sealed)).rejects.toThrow();
  });

  it('keeps one non-extractable key per user in this browser', async () => {
    const { user } = ids();
    const [a, b] = await Promise.all([DeviceSealer.forUser(user), DeviceSealer.forUser(user)]);
    expect(await b.open(await a.seal(new Uint8Array([1, 2, 3])))).toEqual(new Uint8Array([1, 2, 3]));
    const other = await DeviceSealer.forUser(`${user}-other`);
    await expect(other.open(await a.seal(new Uint8Array([1])))).rejects.toThrow();

    const [{ value: key }] = (await rawValues('neutrino-atlas-keys')).filter((r) => r.key === user);
    expect((key as CryptoKey).extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key as CryptoKey)).rejects.toThrow();

    // Forgetting it makes a new one, which can't open what the old one sealed.
    const sealed = await a.seal(new Uint8Array([7]));
    await DeviceSealer.forget(user);
    await expect((await DeviceSealer.forUser(user)).open(sealed)).rejects.toThrow();
  });
});

describe('IndexedDBStorage', () => {
  it('keeps no plaintext, and reopens', async () => {
    const { user, vault: vaultID } = ids();
    const drive = new FakeDrive();
    {
      const vault = await Vault.open(await openStorage(user, vaultID));
      await vault.writeText('Secret plans\n', 'Private/Roadmap.md');
      await new VaultSync(vault, drive).sync();
    }
    const raw = await rawValues(IndexedDBStorage.databaseName(user, vaultID));
    expect(raw.length).toBeGreaterThan(0);
    for (const { key, value } of raw) {
      expect(String(key)).not.toContain('Roadmap');
      expect(value).toBeInstanceOf(Uint8Array);
      expect(contains(value as Uint8Array, 'Secret')).toBe(false);
      expect(contains(value as Uint8Array, 'Roadmap')).toBe(false);
    }

    const reopened = await Vault.open(await openStorage(user, vaultID));
    expect(await reopened.text('Private/Roadmap.md')).toBe('Secret plans\n');
    expect(reopened.record('Private/Roadmap.md')?.dirty).toBe(false);
    await expect(Vault.open(await openStorage(user, vaultID, await DeviceSealer.ephemeral()))).rejects.toThrow();
  });

  it('survives reopening and compaction, and a wrong key leaves the journal intact', async () => {
    const { user, vault: vaultID } = ids();
    const threshold = Vault.compactionThreshold;
    Vault.compactionThreshold = 50;
    try {
      {
        const vault = await Vault.open(await openStorage(user, vaultID));
        // More changes than one compaction's worth, so both the manifest and the journal matter.
        for (let i = 0; i < 125; i++) await vault.writeText(`v${i}\n`, `P${i % 30}.md`);
        await vault.move('P1.md', 'Moved/P1.md');
        await vault.delete('P2.md');
      }
      const reopened = await Vault.open(await openStorage(user, vaultID));
      expect(reopened.paths).toHaveLength(29);
      expect(await reopened.text('Moved/P1.md')).toBe('v121\n');
      expect(await reopened.text('P2.md')).toBeNull();
      expect(await reopened.text('P0.md')).toBe('v120\n');
      // Old blobs are removed: 29 live files, plus the manifest.
      const blobs = (await rawValues(IndexedDBStorage.databaseName(user, vaultID))).filter((r) => r.store === 'blobs');
      expect(blobs).toHaveLength(30);

      const journal = (await rawValues(IndexedDBStorage.databaseName(user, vaultID))).filter((r) => r.store === 'journal');
      await expect(Vault.open(await openStorage(user, vaultID, await DeviceSealer.ephemeral()))).rejects.toThrow();
      expect((await rawValues(IndexedDBStorage.databaseName(user, vaultID))).filter((r) => r.store === 'journal')).toEqual(journal);
      expect(await (await Vault.open(await openStorage(user, vaultID))).text('P0.md')).toBe('v120\n');
    } finally {
      Vault.compactionThreshold = threshold;
    }
  });

  it('stops taking changes after a failed save, so memory never runs ahead of storage', async () => {
    const { user, vault: vaultID } = ids();
    const storage = await openStorage(user, vaultID);
    const vault = await Vault.open(storage);
    await vault.writeText('kept\n', 'A.md');
    const append = storage.appendToJournal.bind(storage);
    storage.appendToJournal = async () => {
      throw new Error('QuotaExceededError');
    };
    await expect(vault.writeText('lost\n', 'B.md')).rejects.toThrow(/couldn't be saved/);
    storage.appendToJournal = append;
    await expect(vault.writeText('after\n', 'C.md')).rejects.toThrow(/couldn't be saved/);
    const reopened = await Vault.open(await openStorage(user, vaultID));
    expect(reopened.paths).toEqual(['A.md']);
  });

  it('can be discarded', async () => {
    const { user, vault: vaultID } = ids();
    const local = await LocalVault.open(user, vaultID);
    await local.vault.writeText('x\n', 'X.md');
    await local.close();
    await LocalVault.discard(user, vaultID);
    const fresh = await LocalVault.open(user, vaultID);
    expect(fresh.vault.paths).toEqual([]);
    await fresh.close();
  });
});

describe('LocalVault', () => {
  it('lets one tab at a time open a vault', async () => {
    if (!globalThis.navigator?.locks) installLockManager();
    const { user, vault: vaultID } = ids();
    const first = await LocalVault.open(user, vaultID);
    await expect(LocalVault.open(user, vaultID)).rejects.toBeInstanceOf(VaultInUseError);
    // Another vault is unaffected.
    const other = await LocalVault.open(user, `${vaultID}-other`);
    await other.close();
    await first.close();
    const again = await LocalVault.open(user, vaultID);
    await again.close();
    const release = await acquireVaultLock(user, vaultID);
    expect(release).toBeTypeOf('function');
    await release!();
  });
});

/** The part of the Web Locks API `acquireVaultLock` uses, for runtimes without it. */
function installLockManager(): void {
  const held = new Set<string>();
  const locks = {
    async request(name: string, _options: { ifAvailable: boolean }, callback: (lock: object | null) => unknown) {
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    },
  };
  Object.defineProperty(globalThis, 'navigator', { value: { ...globalThis.navigator, locks }, configurable: true });
}
