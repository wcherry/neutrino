import { describe, expect, it } from 'vitest';
import { lines, threeWayMerge } from '../sync/merge';
import { SplitMix } from './splitMix';

// AtlasKit's ThreeWayMergeTests, ported.
describe('threeWayMerge', () => {
  it('merges edits to different lines', () => {
    const base = '# Plan\n\nOne\nTwo\nThree\n';
    const local = '# Plan\n\nOne, edited here\nTwo\nThree\n';
    const remote = '# Plan\n\nOne\nTwo\nThree, edited there\n';
    expect(threeWayMerge(base, local, remote)).toBe('# Plan\n\nOne, edited here\nTwo\nThree, edited there\n');
  });

  it('merges insertions and deletions on both sides', () => {
    const base = 'a\nb\nc\nd\ne\n';
    const local = 'a\nb\nlocal insert\nc\nd\ne\n'; // insert after b
    const remote = 'a\nb\nc\nd\n'; // delete e
    expect(threeWayMerge(base, local, remote)).toBe('a\nb\nlocal insert\nc\nd\n');
  });

  it('takes the same change on both sides once', () => {
    expect(threeWayMerge('x\ny\n', 'x\nY\n', 'x\nY\n')).toBe('x\nY\n');
    expect(threeWayMerge('x\ny\nz\n', 'x\nY\nz\n', 'x\nY\nz\nmore\n')).toBe('x\nY\nz\nmore\n');
  });

  it('fails on conflicting edits to the same line', () => {
    expect(threeWayMerge('a\nb\nc\n', 'a\nB1\nc\n', 'a\nB2\nc\n')).toBeNull();
    // Different insertions at the same place conflict too: their order is unknowable.
    expect(threeWayMerge('a\nc\n', 'a\nX\nc\n', 'a\nY\nc\n')).toBeNull();
  });

  it('takes the other side when one side is unchanged', () => {
    expect(threeWayMerge('a\n', 'a\n', 'b\n')).toBe('b\n');
    expect(threeWayMerge('a\n', 'b\n', 'a\n')).toBe('b\n');
    expect(threeWayMerge('', 'new\n', '')).toBe('new\n');
  });

  it('keeps line endings and a missing final newline', () => {
    expect(threeWayMerge('a\r\nb\r\nc', 'A\r\nb\r\nc', 'a\r\nb\r\nC')).toBe('A\r\nb\r\nC');
  });

  // Random edits: whenever a merge succeeds, every line either side added survives, every base
  // line both sides kept survives in order, and nothing either side deleted comes back.
  it('keeps both sides’ changes under random edits', () => {
    const rng = new SplitMix(42n);
    for (let round = 0; round < 2_000; round++) {
      const base = Array.from({ length: rng.next(12) }, (_, i) => `base ${i}\n`);
      const edit = (tag: string) => {
        const out = [...base];
        for (let n = rng.next(4); n > 0; n--) {
          const op = rng.next(3);
          if (op === 0 && out.length) out.splice(rng.next(out.length), 1);
          else if (op === 1 && out.length) out[rng.next(out.length)] = `${tag} changed ${rng.next(1000)}\n`;
          else out.splice(rng.next(out.length + 1), 0, `${tag} added ${rng.next(1000)}\n`);
        }
        return out;
      };
      const local = edit('L');
      const remote = edit('R');
      const merged = threeWayMerge(base.join(''), local.join(''), remote.join(''));
      if (merged === null) continue;
      const mergedLines = lines(merged);
      for (const line of new Set([...local, ...remote])) {
        if (!base.includes(line)) expect(mergedLines, `lost added line ${line}`).toContain(line);
      }
      const kept = base.filter((l) => local.includes(l) && remote.includes(l));
      expect(mergedLines.filter((l) => kept.includes(l))).toEqual(kept);
      for (const line of base) {
        if (!local.includes(line) || !remote.includes(line)) expect(mergedLines, `resurrected ${line}`).not.toContain(line);
      }
    }
  });

  it('stays fast on a long page', () => {
    const base = Array.from({ length: 20_000 }, (_, i) => `line ${i}\n`);
    const local = [...base];
    local[100] = 'changed here\n';
    const remote = [...base];
    remote[19_000] = 'changed there\n';
    const start = performance.now();
    const merged = threeWayMerge(base.join(''), local.join(''), remote.join(''));
    expect(performance.now() - start).toBeLessThan(1_000);
    expect(merged).toContain('changed here\n');
    expect(merged).toContain('changed there\n');
  });
});
