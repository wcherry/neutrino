/** AtlasKit's test `SplitMix`: a small deterministic generator, the same sequence for a seed. */
export class SplitMix {
  private state: bigint;
  constructor(seed: bigint) {
    this.state = seed;
  }

  private nextRaw(): bigint {
    const mask = 0xffffffffffffffffn;
    this.state = (this.state + 0x9e3779b97f4a7c15n) & mask;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & mask;
    return z ^ (z >> 31n);
  }

  /** In `0..<bound`; 0 for an empty range. */
  next(bound: number): number {
    if (bound <= 0) return 0;
    return Number(this.nextRaw() % BigInt(bound));
  }

  pick<T>(items: T[]): T | undefined {
    return items.length ? items[this.next(items.length)] : undefined;
  }
}
