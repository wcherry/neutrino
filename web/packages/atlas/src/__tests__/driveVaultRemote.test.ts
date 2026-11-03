// @vitest-environment node
import {
  clearSession,
  createKeyring,
  encryptFileKey,
  generateKeyPair,
  initSodium,
  rotateKeyring,
  setSessionKeyring,
  type Keyring,
} from '@neutrino/e2e-crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriveVaultRemote } from '../drive/driveVaultRemote';
import { MemoryStorage, Vault } from '../sync/vault';
import { VaultRemoteError, VaultSync } from '../sync/vaultSync';

const USER = 'user-1';

/**
 * Drive's API, in memory, behind `fetch`: the endpoints the remote uses, with the server's
 * semantics (content versions, guarded autosave with 409, key refs, 404s). It stores what the
 * real server would: ciphertext, encrypted metadata, sealed keys, and folder and file names.
 */
class FakeDriveServer {
  folders = new Map<string, { name: string; parentId: string | null }>();
  files = new Map<
    string,
    { name: string; folderId: string; mimeType: string; content: Uint8Array; contentVersion: number; encryptedMetadata: string; key: { encryptedFileKey: string; keyVersion: number } | null }
  >();
  requests: string[] = [];
  private next = 1;

  constructor() {
    this.folders.set('vault', { name: 'Vault', parentId: USER });
  }

  private id(prefix: string) {
    return `${prefix}${String(this.next++).padStart(4, '0')}`;
  }

  private dto(id: string) {
    const f = this.files.get(id)!;
    return { id, name: f.name, contentVersion: f.contentVersion, encryptedMetadata: f.encryptedMetadata, mimeType: f.mimeType };
  }

  fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? 'GET';
    const { pathname, searchParams } = new URL(url, 'http://drive.test');
    this.requests.push(`${method} ${pathname}`);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const error = (status: number, code: string) => json({ error: { code, message: code } }, status);
    const m = (pattern: RegExp) => pathname.match(pattern);
    let match: RegExpMatchArray | null;

    if ((match = m(/^\/api\/v1\/drive\/folders\/([^/]+)$/)) && method === 'GET') {
      const id = match[1];
      if (id !== USER && !this.folders.has(id)) return error(404, 'NOT_FOUND');
      return json({
        folder: null,
        folders: [...this.folders].filter(([, f]) => f.parentId === id).map(([fid, f]) => ({ id: fid, name: f.name })),
        files: [...this.files].filter(([, f]) => f.folderId === id).map(([fid]) => this.dto(fid)),
      });
    }
    if (pathname === '/api/v1/drive/folders' && method === 'POST') {
      const body = JSON.parse(init.body as string) as { name: string; parentId?: string };
      const id = this.id('d');
      this.folders.set(id, { name: body.name, parentId: body.parentId ?? USER });
      return json({ id, name: body.name });
    }
    if (pathname === '/api/v1/drive/files/upload' && method === 'POST') {
      const form = init.body as FormData;
      const file = form.get('file') as Blob;
      const id = this.id('f');
      this.files.set(id, {
        name: (form.get('file') as File).name,
        folderId: form.get('folder_id') as string,
        mimeType: form.get('mime_type') as string,
        content: new Uint8Array(await file.arrayBuffer()),
        contentVersion: 1,
        encryptedMetadata: form.get('encrypted_metadata') as string,
        key: { encryptedFileKey: form.get('encrypted_file_key') as string, keyVersion: Number(form.get('key_version')) },
      });
      return json(this.dto(id), 201);
    }
    if ((match = m(/^\/api\/v1\/drive\/files\/([^/]+)(\/info|\/key|\/autosave)?$/))) {
      const [, id, sub] = match;
      const f = this.files.get(id);
      if (!f) return error(404, 'NOT_FOUND');
      if (sub === '/info' && method === 'GET') return json(this.dto(id));
      if (sub === '/key' && method === 'GET') return f.key ? json({ fileId: id, userId: USER, ...f.key }) : error(404, 'NOT_FOUND');
      if (sub === '/key' && method === 'PUT') {
        f.key = JSON.parse(init.body as string) as { encryptedFileKey: string; keyVersion: number };
        return json({ fileId: id, userId: USER, ...f.key });
      }
      if (sub === '/autosave' && method === 'PUT') {
        const expected = searchParams.get('expectedContentVersion');
        if (expected !== null && Number(expected) !== f.contentVersion) return error(409, 'CONTENT_VERSION_CONFLICT');
        f.content = new Uint8Array(await ((init.body as FormData).get('file') as Blob).arrayBuffer());
        f.contentVersion++;
        return json(this.dto(id));
      }
      if (!sub && method === 'GET') return new Response(new Blob([f.content as BlobPart]), { status: 200 });
      if (!sub && method === 'PATCH') {
        const body = JSON.parse(init.body as string) as { name?: string; folderId?: string };
        if (body.name) f.name = body.name;
        if (body.folderId) f.folderId = body.folderId;
        return json(this.dto(id));
      }
      if (!sub && method === 'DELETE') {
        this.files.delete(id);
        return new Response(null, { status: 204 });
      }
    }
    return error(400, `UNHANDLED ${method} ${pathname}`);
  };

  /** Path → id, from the folder names. */
  pathOf(id: string): string {
    const f = this.files.get(id)!;
    const parts = [f.name];
    for (let folder = f.folderId; folder !== 'vault'; folder = this.folders.get(folder)!.parentId!) parts.unshift(this.folders.get(folder)!.name);
    return parts.join('/');
  }
}

let server: FakeDriveServer;
let keyring: Keyring;

beforeAll(async () => {
  await initSodium();
});

beforeEach(() => {
  server = new FakeDriveServer();
  vi.stubGlobal('fetch', server.fetch);
  keyring = createKeyring(USER);
  setSessionKeyring(keyring);
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearSession();
});

async function device(): Promise<VaultSync> {
  return new VaultSync(await Vault.open(new MemoryStorage()), new DriveVaultRemote(USER, 'vault'));
}

const contains = (haystack: Uint8Array | string, needle: string) => Buffer.from(haystack).includes(Buffer.from(needle));

describe('DriveVaultRemote', () => {
  it('syncs two devices through Drive, end-to-end encrypted', async () => {
    const a = await device();
    const b = await device();
    await a.vault.writeText('# Roadmap\n\nSecret plans\n', 'Projects/Q4/Roadmap.md');
    await a.vault.write(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'Attachments/diagram.png');
    await a.sync();

    // Only names reach the server in the clear: content and metadata are ciphertext.
    expect([...server.files.values()].map((f) => f.mimeType).sort()).toEqual(['image/png', 'text/markdown']);
    for (const f of server.files.values()) {
      expect(contains(f.content, 'Secret')).toBe(false);
      expect(contains(f.encryptedMetadata, 'Roadmap')).toBe(false);
      expect(f.key?.keyVersion).toBe(1);
    }
    expect([...server.files.keys()].map((id) => server.pathOf(id)).sort()).toEqual(['Attachments/diagram.png', 'Projects/Q4/Roadmap.md']);

    expect((await b.sync()).updated.sort()).toEqual(['Attachments/diagram.png', 'Projects/Q4/Roadmap.md']);
    expect(await b.vault.text('Projects/Q4/Roadmap.md')).toBe('# Roadmap\n\nSecret plans\n');
    expect(await b.vault.content('Attachments/diagram.png')).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

    // Edits on both sides merge through guarded autosaves.
    await a.vault.writeText('# Roadmap (A)\n\nSecret plans\n', 'Projects/Q4/Roadmap.md');
    await b.vault.writeText('# Roadmap\n\nSecret plans, revised by B\n', 'Projects/Q4/Roadmap.md');
    await a.sync();
    expect((await b.sync()).merged).toEqual(['Projects/Q4/Roadmap.md']);
    await a.sync();
    expect(await a.vault.text('Projects/Q4/Roadmap.md')).toBe('# Roadmap (A)\n\nSecret plans, revised by B\n');

    // Moves make the folders they need, reusing ones that exist; deletions trash.
    await b.vault.move('Projects/Q4/Roadmap.md', 'Archive/2026/Roadmap.md');
    await b.vault.delete('Attachments/diagram.png');
    await b.sync();
    expect([...server.files.keys()].map((id) => server.pathOf(id))).toEqual(['Archive/2026/Roadmap.md']);
    const r = await a.sync();
    expect(r.moved).toEqual([{ from: 'Projects/Q4/Roadmap.md', to: 'Archive/2026/Roadmap.md' }]);
    expect(r.removed).toEqual(['Attachments/diagram.png']);
    await a.vault.writeText('New\n', 'Archive/2026/Other.md');
    await a.sync();
    expect([...server.folders.values()].filter((f) => f.name === 'Archive')).toHaveLength(1);
    expect([...server.folders.values()].filter((f) => f.name === '2026')).toHaveLength(1);
  });

  it('turns a stale write into a conflict and a missing file into notFound', async () => {
    const remote = new DriveVaultRemote(USER, 'vault');
    const file = await remote.create('Page.md', new TextEncoder().encode('one\n'));
    expect(await remote.replace(file.id, new TextEncoder().encode('two\n'), 1)).toBe(2);
    await expect(remote.replace(file.id, new TextEncoder().encode('three\n'), 1)).rejects.toEqual(new VaultRemoteError('conflict', 'CONTENT_VERSION_CONFLICT'));
    expect(new TextDecoder().decode((await remote.download(file.id)).data)).toBe('two\n');
    await remote.delete(file.id);
    await expect(remote.download(file.id)).rejects.toMatchObject({ code: 'notFound' });
  });

  it('opens a key filed under the wrong version, and files it again', async () => {
    const remote = new DriveVaultRemote(USER, 'vault');
    const file = await remote.create('Page.md', new TextEncoder().encode('sealed to v1\n'));
    // Rotate, then reseal the file's key to v2 but leave it filed as v1, as the iOS apps did.
    keyring = rotateKeyring(keyring);
    setSessionKeyring(keyring);
    const { data } = await new DriveVaultRemote(USER, 'vault').download(file.id);
    expect(new TextDecoder().decode(data)).toBe('sealed to v1\n');

    const v2 = keyring.entries.find((e) => e.version === 2)!;
    const stored = server.files.get(file.id)!;
    const dek = await (async () => {
      const { decryptFileKey } = await import('@neutrino/e2e-crypto');
      const v1 = keyring.entries.find((e) => e.version === 1)!;
      return decryptFileKey(stored.key!.encryptedFileKey, v1.publicKey, v1.secretKey);
    })();
    stored.key = { encryptedFileKey: encryptFileKey(dek, v2.publicKey), keyVersion: 1 };
    const fresh = new DriveVaultRemote(USER, 'vault');
    expect(new TextDecoder().decode((await fresh.download(file.id)).data)).toBe('sealed to v1\n');
    await vi.waitFor(() => expect(server.files.get(file.id)!.key!.keyVersion).toBe(2));
    // New files are sealed to the active key.
    expect((await fresh.create('New.md', new Uint8Array([1]))).id).toBeTruthy();
    expect([...server.files.values()].find((f) => f.name === 'New.md')!.key!.keyVersion).toBe(2);
  });

  it('reports a file sealed to a key this device lacks as unreadable, and syncs the rest', async () => {
    const a = await device();
    await a.vault.writeText('readable\n', 'Mine.md');
    await a.sync();
    const stranger = generateKeyPair();
    const remote = new DriveVaultRemote(USER, 'vault');
    const other = await remote.create('Theirs.md', new TextEncoder().encode('x'));
    const otherFile = server.files.get(other.id)!;
    otherFile.key = { encryptedFileKey: encryptFileKey(new Uint8Array(32), stranger.publicKey), keyVersion: 1 };
    const noKey = await remote.create('NoKey.md', new TextEncoder().encode('y'));
    server.files.get(noKey.id)!.key = null;

    const b = await device();
    const r = await b.sync();
    expect(r.updated).toEqual(['Mine.md']);
    expect(r.unreadable.sort()).toEqual(['NoKey.md', 'Theirs.md']);
  });

  it("won't write without a key", async () => {
    clearSession();
    const remote = new DriveVaultRemote(USER, 'vault');
    await expect(remote.create('Page.md', new Uint8Array([1]))).rejects.toThrow('no-dek');
    expect(server.files.size).toBe(0);
  });

  it('lists root folders and creates a vault', async () => {
    const id = await DriveVaultRemote.createVault('Notes 10');
    await DriveVaultRemote.createVault('Notes 9');
    expect((await DriveVaultRemote.rootFolders(USER)).map((f) => f.name)).toEqual(['Notes 9', 'Notes 10', 'Vault']);
    expect(server.folders.get(id)?.parentId).toBe(USER);
  });
});
