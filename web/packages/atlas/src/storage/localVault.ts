import { Vault } from '../sync/vault';
import { DeviceSealer, IndexedDBStorage, acquireVaultLock } from './indexedDB';

/** The vault is open in another tab of this browser, which owns its local copy. */
export class VaultInUseError extends Error {
  constructor() {
    super('This vault is open in another tab');
    this.name = 'VaultInUseError';
  }
}

/**
 * A vault's sealed local copy in this browser, opened for one tab: the tab holds the vault's
 * lock until `close()`, so its journal has one writer.
 */
export class LocalVault {
  private constructor(
    readonly vault: Vault,
    private readonly storage: IndexedDBStorage,
    private readonly release: () => Promise<void>,
  ) {}

  /**
   * Opens (or starts) `vaultID`'s local copy for `userId`, sealed with this browser's key.
   * Throws `VaultInUseError` when another tab has it open.
   */
  static async open(userId: string, vaultID: string): Promise<LocalVault> {
    const release = await acquireVaultLock(userId, vaultID);
    if (!release) throw new VaultInUseError();
    try {
      const storage = await IndexedDBStorage.open(userId, vaultID, await DeviceSealer.forUser(userId));
      try {
        return new LocalVault(await Vault.open(storage), storage, release);
      } catch (e) {
        storage.close();
        throw e;
      }
    } catch (e) {
      await release();
      throw e;
    }
  }

  /** Closes the local copy and lets another tab open it; resolves once it can. */
  async close(): Promise<void> {
    this.storage.close();
    await this.release();
  }

  /**
   * Deletes `vaultID`'s local copy, for when it can't be opened (its key is gone) or the user
   * removes the vault from this browser. The next sync downloads it again; edits not yet synced
   * are lost, so say so first.
   */
  static async discard(userId: string, vaultID: string): Promise<void> {
    await IndexedDBStorage.remove(userId, vaultID);
  }
}
