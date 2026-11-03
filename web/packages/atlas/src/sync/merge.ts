import { splitLines } from '../preprocess';

/**
 * A line-level three-way merge (diff3), for when the same page changed on this device and on
 * the server since they last agreed (neutrino-atlas.md, Phase 1 "Conflict handling"). A port of
 * AtlasKit's `ThreeWayMerge`.
 *
 * Lines unchanged on one side take the other side's version; identical changes on both sides
 * are taken once. A region both sides changed differently is a conflict, and the merge fails:
 * the caller then keeps both versions rather than writing conflict markers into the page.
 *
 * @returns the merged text, or null if both sides changed the same lines differently.
 */
export function threeWayMerge(base: string, local: string, remote: string): string | null {
  if (local === remote) return local;
  if (local === base) return remote;
  if (remote === base) return local;
  const merged = mergeLines(lines(base), lines(local), lines(remote));
  return merged === null ? null : merged.join('');
}

/** Splits text into lines that keep their line endings, so joining them gives the text back. */
export function lines(text: string): string[] {
  return splitLines(text).map((l) => l.content + l.ending);
}

function mergeLines(base: string[], local: string[], remote: string[]): string[] | null {
  // For each base line, its matching line in local and in remote, if any.
  const toLocal = matches(base, local);
  const toRemote = matches(base, remote);

  const out: string[] = [];
  let bi = 0;
  let li = 0;
  let ri = 0;
  while (bi <= base.length) {
    // The next base line kept by both sides is a stable anchor.
    let anchor = bi;
    while (anchor < base.length && !(toLocal[anchor] !== null && toRemote[anchor] !== null)) anchor++;
    const lEnd = anchor < base.length ? toLocal[anchor]! : local.length;
    const rEnd = anchor < base.length ? toRemote[anchor]! : remote.length;
    if (lEnd < li || rEnd < ri) return null;

    const baseChunk = base.slice(bi, anchor);
    const localChunk = local.slice(li, lEnd);
    const remoteChunk = remote.slice(ri, rEnd);
    if (same(localChunk, baseChunk)) out.push(...remoteChunk);
    else if (same(remoteChunk, baseChunk)) out.push(...localChunk);
    else if (same(localChunk, remoteChunk)) out.push(...localChunk);
    else return null;

    if (anchor >= base.length) break;
    out.push(base[anchor]);
    bi = anchor + 1;
    li = lEnd + 1;
    ri = rEnd + 1;
  }
  return out;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * For each element of `a`, the index of the element of `b` it is matched with in a longest
 * common subsequence, or null. Myers' O(ND) diff, so typical edits to long pages stay cheap.
 */
export function matches(a: string[], b: string[]): (number | null)[] {
  const n = a.length;
  const m = b.length;
  const result: (number | null)[] = new Array(n).fill(null);
  // Trim a common prefix and suffix first: most edits touch a small middle.
  let start = 0;
  while (start < n && start < m && a[start] === b[start]) {
    result[start] = start;
    start++;
  }
  let endA = n;
  let endB = m;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
    result[endA] = endB;
  }
  for (const [i, j] of myers(a.slice(start, endA), b.slice(start, endB))) result[start + i] = start + j;
  return result;
}

/** Matched index pairs of a shortest edit script between `a` and `b` (Myers 1986). */
function myers(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return [];
  const max = n + m;
  let v = new Array<number>(2 * max + 2).fill(0);
  const trace: number[][] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[k - 1 + max] < v[k + 1 + max]) ? v[k + 1 + max] : v[k - 1 + max] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k + max] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  // Walk the trace back to recover the diagonal moves (the matches).
  const pairs: [number, number][] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    v = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && v[k - 1 + max] < v[k + 1 + max]) ? k + 1 : k - 1;
    const prevX = v[prevK + max];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      pairs.push([x, y]);
    }
    if (d > 0) {
      x = prevX;
      y = prevY;
    }
  }
  return pairs.reverse();
}
