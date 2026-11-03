import { describe, expect, it } from 'vitest';
import { MemoryStorage, Vault } from '../sync/vault';
import { type SyncReport, type VaultRemote, VaultSync, emptySyncReport } from '../sync/vaultSync';
import { FakeDrive, NetworkError } from './fakeDrive';
import { SplitMix } from './splitMix';

// AtlasKit's VaultSyncTests, ported: the same scenarios and the same three-device property.

const text = (b: Uint8Array) => new TextDecoder().decode(b);
const bytes = (...b: number[]) => new Uint8Array(b);

async function device(drive: VaultRemote): Promise<VaultSync> {
  const sync = new VaultSync(await Vault.open(new MemoryStorage()), drive);
  sync.now = () => new Date(1_793_000_000_000);
  return sync;
}

async function contents(vault: Vault): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const path of vault.paths) out[path] = (await vault.text(path)) ?? '';
  return out;
}

const report = (fields: Partial<SyncReport> = {}): SyncReport => ({ ...emptySyncReport(), ...fields });

describe('VaultSync', () => {
  it('creates, edits and pulls across devices', async () => {
    const drive = new FakeDrive();
    const a = await device(drive);
    const b = await device(drive);
    await a.vault.writeText('# One\n', 'One.md');
    await a.vault.writeText('# Two\n', 'Notes/Two.md');
    expect(new Set((await a.sync()).uploaded)).toEqual(new Set(['One.md', 'Notes/Two.md']));

    expect(new Set((await b.sync()).updated)).toEqual(new Set(['One.md', 'Notes/Two.md']));
    await b.vault.writeText('# One\n\nEdited on B.\n', 'One.md');
    expect((await b.sync()).uploaded).toEqual(['One.md']);
    expect((await a.sync()).updated).toEqual(['One.md']);
    expect(await a.vault.text('One.md')).toBe('# One\n\nEdited on B.\n');
    // Nothing left to do.
    expect(await a.sync()).toEqual(report());
    expect(await b.sync()).toEqual(report());
  });

  it("doesn't let a file that can't be decrypted stop the rest", async () => {
    const drive = new FakeDrive();
    const a = await device(drive);
    const b = await device(drive);
    await a.vault.writeText('# One\n', 'One.md');
    await a.vault.write(bytes(0x89, 0x50), 'Attachments/photo.png');
    await a.sync();
    const photo = [...drive.files].find(([, f]) => f.path === 'Attachments/photo.png')![0];
    drive.unreadable = new Set([photo]);

    await b.vault.writeText('# Mine\n', 'Mine.md');
    const first = await b.sync();
    expect(first.unreadable).toEqual(['Attachments/photo.png']);
    expect(first.updated).toEqual(['One.md']);
    expect(first.uploaded, 'the rest of the pass went ahead').toEqual(['Mine.md']);
    expect(await b.vault.content('Attachments/photo.png')).toBeNull();

    // Once it can be read, the next pass brings it in.
    drive.unreadable = new Set();
    const second = await b.sync();
    expect(second.updated).toEqual(['Attachments/photo.png']);
    expect(second.unreadable).toEqual([]);
  });

  it('merges concurrent edits to different lines', async () => {
    const drive = new FakeDrive();
    const a = await device(drive);
    const b = await device(drive);
    await a.vault.writeText('# Plan\n\nOne\nTwo\nThree\n', 'Plan.md');
    await a.sync();
    await b.sync();

    await a.vault.writeText('# Plan\n\nOne (A)\nTwo\nThree\n', 'Plan.md');
    await b.vault.writeText('# Plan\n\nOne\nTwo\nThree (B)\n', 'Plan.md');
    await a.sync();
    const r = await b.sync();
    expect(r.merged).toEqual(['Plan.md']);
    expect(r.conflicts).toEqual([]);
    await a.sync();
    const merged = '# Plan\n\nOne (A)\nTwo\nThree (B)\n';
    expect(await a.vault.text('Plan.md')).toBe(merged);
    expect(await b.vault.text('Plan.md')).toBe(merged);
    expect(drive.snapshot).toEqual({ 'Plan.md': merged });
  });

  it('keeps both versions of conflicting edits', async () => {
    const drive = new FakeDrive();
    const a = await device(drive);
    const b = await device(drive);
    await a.vault.writeText('Line\n', 'Plan.md');
    await a.sync();
    await b.sync();

    await a.vault.writeText('Line by A\n', 'Plan.md');
    await b.vault.writeText('Line by B\n', 'Plan.md');
    await a.sync();
    const r = await b.sync();
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].path).toBe('Plan.md');
    expect(r.conflicts[0].copy).toMatch(/^Plan \(conflicted copy \d{4}-\d\d-\d\d \d{4}\)\.md$/);
    await a.sync();
    // The server's (A's) version keeps the page; B's is beside it, everywhere.
    expect((await contents(a.vault))['Plan.md']).toBe('Line by A\n');
    expect((await contents(a.vault))[r.conflicts[0].copy]).toBe('Line by B\n');
    expect(await contents(a.vault)).toEqual(await contents(b.vault));
  });

  it('lets an edit win over a deletion elsewhere', async () => {
    const drive = new FakeDrive();
    const a = await device(drive);
    const b = await device(drive);
    await a.vault.writeText('Keep me\n', 'Page.md');
    await a.sync();
    await b.sync();

    await a.vault.delete('Page.md');
    await b.vault.writeText('Keep me, edited\n', 'Page.md');
    expect((await a.sync()).deletedRemotely).toEqual(['Page.md']);
    expect((await b.sync()).restored).toEqual(['Page.md']);
    await a.sync();
    expect(await a.vault.text('Page.md')).toBe('Keep me, edited\n');
  });

  it('propagates deletions and moves', async () => {
    const drive = new FakeDrive();
    const a = await device(drive);
    const b = await device(drive);
    await a.vault.writeText('x\n', 'Gone.md');
    await a.vault.writeText('Body\n', 'Inbox/Moving.md');
    await a.sync();
    await b.sync();

    await a.vault.delete('Gone.md');
    await a.vault.move('Inbox/Moving.md', 'Archive/Moved.md');
    await b.vault.writeText('Body\nedited while it moved\n', 'Inbox/Moving.md');
    await a.sync();
    const r = await b.sync();
    expect(r.removed).toEqual(['Gone.md']);
    expect(r.moved).toEqual([{ from: 'Inbox/Moving.md', to: 'Archive/Moved.md' }]);
    await a.sync();
    expect(await contents(a.vault)).toEqual({ 'Archive/Moved.md': 'Body\nedited while it moved\n' });
    expect(await contents(b.vault)).toEqual(await contents(a.vault));
  });

  it('handles the same path created on two devices', async () => {
    const drive = new FakeDrive();
    const a = await device(drive);
    const b = await device(drive);
    const c = await device(drive);
    await a.vault.writeText('same\n', 'Daily/2026-10-29.md');
    await b.vault.writeText('same\n', 'Daily/2026-10-29.md');
    await c.vault.writeText('different\n', 'Daily/2026-10-29.md');
    await a.sync();
    expect((await b.sync()).conflicts).toEqual([]); // identical: adopted
    expect((await c.sync()).conflicts).toHaveLength(1);
    await a.sync();
    await b.sync();
    expect(await contents(a.vault)).toEqual(await contents(c.vault));
    expect(drive.files.size).toBe(2);
  });

  it('never merges attachments, only keeps both', async () => {
    const drive = new FakeDrive();
    const a = await device(drive);
    const b = await device(drive);
    await a.vault.write(bytes(1, 2, 3), 'img.png');
    await a.sync();
    await b.sync();
    await a.vault.write(bytes(4), 'img.png');
    await b.vault.write(bytes(5), 'img.png');
    await a.sync();
    const r = await b.sync();
    expect(r.conflicts).toHaveLength(1);
    expect(await b.vault.content('img.png')).toEqual(bytes(4));
    expect(await b.vault.content(r.conflicts[0].copy)).toEqual(bytes(5));
  });

  it('resumes an interrupted sync without loss', async () => {
    const drive = new FakeDrive();
    const a = await device(drive);
    for (let i = 0; i < 10; i++) await a.vault.writeText(`page ${i}\n`, `P${i}.md`);
    drive.failEvery = 4;
    for (let attempts = 1; ; attempts++) {
      try {
        await a.sync();
        break;
      } catch (e) {
        expect(e).toBeInstanceOf(NetworkError);
        expect(attempts).toBeLessThan(20);
      }
    }
    drive.failEvery = null;
    await a.sync();
    expect(Object.keys(drive.snapshot)).toHaveLength(10);
    expect(drive.snapshot['P7.md']).toBe('page 7\n');
    expect(a.vault.records.every((r) => !r.dirty && r.fileID !== null)).toBe(true);
  });

  it('takes local edits made during a pass', async () => {
    const drive = new FakeDrive();
    const a = await device(drive);
    await a.vault.writeText('one\n', 'One.md');
    const pass = a.sync();
    // An edit while the upload is in flight stays dirty for the next pass.
    await a.vault.writeText('one, edited mid-sync\n', 'One.md');
    await pass;
    await a.sync();
    expect(drive.snapshot).toEqual({ 'One.md': 'one, edited mid-sync\n' });
    expect(await a.sync()).toEqual(report());
  });

  it('settles duplicate server paths the same way on every device', async () => {
    const drive = new FakeDrive();
    drive.files.set('f2', { path: 'Page.md', data: new TextEncoder().encode('second\n'), version: 1 });
    drive.files.set('f1', { path: 'Page.md', data: new TextEncoder().encode('first\n'), version: 1 });
    const a = await device(drive);
    await a.sync();
    expect(await contents(a.vault)).toEqual({ 'Page.md': 'first\n', 'Page (conflicted copy f2).md': 'second\n' });
    expect(drive.snapshot).toEqual(await contents(a.vault));
  });

  // ── Property: random edits on three devices converge, and nothing is lost ──

  it.each(Array.from({ length: Number(process.env.ATLAS_SYNC_SEEDS ?? 40) }, (_, seed) => seed))('converges without loss on three devices (seed %i)', async (seed) => {
    await runRandomScenario(BigInt(seed), Number(process.env.ATLAS_SYNC_OPS ?? 60));
  });

  it('keeps a quiet pass over 5,000 files cheap', async () => {
    const drive = new FakeDrive();
    const sync = await device(drive);
    for (let i = 0; i < 5_000; i++) await sync.vault.writeText(`page ${i}\n`, `Folder ${i % 50}/Page ${i}.md`);
    let start = performance.now();
    await sync.sync();
    const first = performance.now() - start;
    start = performance.now();
    const quiet = await sync.sync();
    const elapsed = performance.now() - start;
    expect(quiet).toEqual(report());
    expect(elapsed).toBeLessThan(500);
    expect(first).toBeLessThan(10_000);
  }, 30_000);
});

async function runRandomScenario(seed: bigint, operations: number): Promise<void> {
  const rng = new SplitMix(seed);
  const drive = new FakeDrive();
  const devices = await Promise.all([0, 1, 2].map(() => device(drive)));
  let token = 0;
  const removed = new Set<string>(); // tokens some device deliberately removed
  const written = new Set<string>();
  const tokens = (t: string) => t.split('\n').filter((l) => l.startsWith('t'));

  for (let op = 0; op < operations; op++) {
    const d = devices[rng.next(devices.length)];
    const paths = d.vault.paths;
    switch (rng.next(6)) {
      case 0: {
        // New page (overwriting one that's there deliberately discards its lines).
        const t = `t${++token}`;
        written.add(t);
        const path = `Page ${rng.next(8)}.md`;
        const existing = await d.vault.text(path);
        if (existing !== null) tokens(existing).forEach((x) => removed.add(x));
        await d.vault.writeText(`${t}\n`, path);
        break;
      }
      case 1:
      case 2: {
        // Add or replace a line.
        const path = rng.pick(paths);
        if (path === undefined) break;
        const lines = (await d.vault.text(path))!.split('\n');
        const t = `t${++token}`;
        written.add(t);
        if (lines.length > 1 && rng.next(2) === 0) {
          const i = rng.next(lines.length - 1);
          tokens(lines[i]).forEach((x) => removed.add(x));
          lines[i] = t;
        } else {
          lines.splice(rng.next(lines.length), 0, t);
        }
        await d.vault.writeText(lines.join('\n'), path);
        break;
      }
      case 3: {
        const path = rng.pick(paths);
        if (path === undefined || rng.next(3) !== 0) break;
        tokens((await d.vault.text(path))!).forEach((x) => removed.add(x));
        await d.vault.delete(path);
        break;
      }
      case 4: {
        const path = rng.pick(paths);
        if (path === undefined) break;
        await d.vault.move(path, `Folder ${rng.next(3)}/Page ${rng.next(8)}.md`);
        break;
      }
      default:
        // Sync, sometimes interrupted.
        drive.failEvery = rng.next(3) === 0 ? 2 + rng.next(4) : null;
        try {
          await d.sync();
        } catch (e) {
          if (!(e instanceof NetworkError)) throw e;
        }
        drive.failEvery = null;
    }
  }

  // Settle: sync everyone until a whole round changes nothing.
  for (let round = 0; round < 6; round++) {
    let quiet = true;
    for (const d of devices) if (JSON.stringify(await d.sync()) !== JSON.stringify(report())) quiet = false;
    if (quiet) break;
  }
  for (const d of devices) expect(await d.sync(), `seed ${seed}: not quiescent`).toEqual(report());

  const reference = await contents(devices[0].vault);
  for (const d of devices.slice(1)) expect(await contents(d.vault), `seed ${seed}: devices disagree`).toEqual(reference);
  expect(drive.snapshot, `seed ${seed}: server disagrees`).toEqual(reference);
  const surviving = new Set(Object.values(reference).flatMap(tokens));
  const lost = [...written].filter((t) => !removed.has(t) && !surviving.has(t));
  expect(lost, `seed ${seed}: lost edits`).toEqual([]);
}
