import type { TaskResponse } from '@/lib/api';

/**
 * Task tag rules, shared by the task editor and its tag picker. The iOS app's
 * `TaskTags` follows the same ones.
 */

/** "#Errands, home  ##work" → ["errands", "home", "work"], in the order typed. */
export function splitTags(text: string): string[] {
  const tags = text
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#+/, '').toLowerCase())
    .filter(Boolean);
  return [...new Set(tags)];
}

/** Every tag on `tasks`, most used first, then alphabetically. */
export function allTags(tasks: TaskResponse[]): string[] {
  const counts = new Map<string, number>();
  for (const tag of tasks.flatMap((t) => t.tags ?? [])) {
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b));
}

/**
 * The tags in `known` worth offering for `query`, leaving out those already
 * `chosen`: those starting with it first, then those containing it, each in
 * `known`'s order. An empty query offers everything.
 */
export function suggestTags(query: string, known: string[], chosen: string[]): string[] {
  const q = splitTags(query).at(-1) ?? '';
  const open = known.filter((t) => !chosen.includes(t));
  if (!q) return open;
  return [
    ...open.filter((t) => t.startsWith(q)),
    ...open.filter((t) => !t.startsWith(q) && t.includes(q)),
  ];
}
