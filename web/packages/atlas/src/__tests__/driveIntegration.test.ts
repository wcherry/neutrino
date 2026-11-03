// @vitest-environment node
//
// Against a real Neutrino server. Set ATLAS_TEST_SERVER and NEXT_PUBLIC_API_URL to its URL to run
// (scripts/test-against-server.sh builds and starts one from this repo); otherwise skipped. Every
// test registers its own user, so they can run against a shared dev server.
import { initSodium, createKeyring, setSessionKeyring, clearSession, toBase64url } from '@neutrino/e2e-crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DriveVaultRemote } from '../drive/driveVaultRemote';
import { MemoryStorage, Vault } from '../sync/vault';
import { VaultSync } from '../sync/vaultSync';

const server = process.env.ATLAS_TEST_SERVER;

async function call<T>(method: string, path: string, body?: object, token?: string): Promise<T> {
  const res = await fetch(`${server}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

/** A new user with a published key and an unlocked session, as the web app has after setup. */
async function newAccount(): Promise<{ userId: string; token: string }> {
  const email = `atlas-web-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const password = `Correct-horse-${crypto.randomUUID().slice(0, 6)}!`;
  const user = await call<{ id: string }>('POST', '/api/v1/auth/register', { email, password, name: 'Atlas web test' });
  const { accessToken } = await call<{ accessToken: string }>('POST', '/api/v1/auth/login', { email, password });
  const keyring = createKeyring(user.id);
  const published = await call<{ version: number }>('POST', '/api/v1/auth/keys', { publicKey: toBase64url(keyring.entries[0].publicKey) }, accessToken);
  expect(published.version).toBe(1);
  setSessionKeyring(keyring);
  // api-core reads the token where the web app keeps it.
  const storage = new Map([['access_token', accessToken]]);
  vi.stubGlobal('window', { location: { pathname: '/atlas' } });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  });
  return { userId: user.id, token: accessToken };
}

describe.skipIf(!server)('DriveVaultRemote against a server', () => {
  beforeAll(async () => {
    expect(process.env.NEXT_PUBLIC_API_URL, 'api-core sends requests to NEXT_PUBLIC_API_URL').toBe(server);
    await initSodium();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearSession();
  });

  it('round-trips encrypted and guarded', async () => {
    const { userId, token } = await newAccount();
    const vault = await DriveVaultRemote.createVault('Atlas web test vault');
    expect((await DriveVaultRemote.rootFolders(userId)).find((f) => f.id === vault)?.name).toBe('Atlas web test vault');
    const drive = new DriveVaultRemote(userId, vault);

    const text = new TextEncoder().encode('# Secret roadmap\n\nThe plan.\n');
    const file = await drive.create('Projects/Q4/Roadmap.md', text);
    expect(file.version).toBe(1);
    expect(await drive.list()).toEqual([{ id: file.id, path: 'Projects/Q4/Roadmap.md', version: 1 }]);

    // A second client with only the keyring reads it back.
    const other = new DriveVaultRemote(userId, vault);
    await other.list();
    expect(await other.download(file.id)).toEqual({ data: text, version: 1 });

    // The server holds ciphertext.
    const stored = new Uint8Array(await (await fetch(`${server}/api/v1/drive/files/${file.id}`, { headers: { Authorization: `Bearer ${token}` } })).arrayBuffer());
    expect(Buffer.from(stored).includes(Buffer.from('Secret'))).toBe(false);

    // Guarded writes.
    expect(await drive.replace(file.id, new TextEncoder().encode('v2\n'), 1)).toBe(2);
    await expect(other.replace(file.id, new TextEncoder().encode('stale\n'), 1)).rejects.toMatchObject({ code: 'conflict' });
    expect(new TextDecoder().decode((await other.download(file.id)).data)).toBe('v2\n');

    // Move into a folder that doesn't exist yet, then delete.
    await drive.move(file.id, 'Archive/Roadmap 2026.md');
    expect((await other.list()).map((f) => f.path)).toEqual(['Archive/Roadmap 2026.md']);
    await drive.delete(file.id);
    expect(await other.list()).toEqual([]);
  });

  it('syncs two devices', async () => {
    const { userId } = await newAccount();
    const vaultID = await DriveVaultRemote.createVault('Atlas');
    const device = async () => new VaultSync(await Vault.open(new MemoryStorage()), new DriveVaultRemote(userId, vaultID));
    const a = await device();
    const b = await device();
    await a.vault.writeText('# Plan\n\nOne\nTwo\nThree\n', 'Plan.md');
    await a.vault.write(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'Attachments/p.png');
    await a.sync();
    await b.sync();
    await a.vault.writeText('# Plan\n\nOne (A)\nTwo\nThree\n', 'Plan.md');
    await b.vault.writeText('# Plan\n\nOne\nTwo\nThree (B)\n', 'Plan.md');
    await a.sync();
    expect((await b.sync()).merged).toEqual(['Plan.md']);
    await a.sync();
    expect(await a.vault.text('Plan.md')).toBe('# Plan\n\nOne (A)\nTwo\nThree (B)\n');
    expect(await b.vault.content('Attachments/p.png')).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });
});
