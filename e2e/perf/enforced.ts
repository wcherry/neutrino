/**
 * What `PERF_ENFORCE=1` fails a run on (UI roadmap stage 6, ui-performance-roadmap.md §5–6).
 *
 * Two kinds of metric, each against the budget its scenario already declares:
 *
 * - **The protected list** — things that were fine before the roadmap and must stay fine through
 *   every refactor: A4 navigation hops, A5 frames over 100 ms, D1 open ratio, E3/E4 drag frame
 *   rate, E5 first row, F3 heap growth, F4 heap per cycle.
 * - **Every target the roadmap met**, so a met target cannot quietly come back: Drive windowing
 *   (B1, B2, B4, B5), delivery (F1), Docs typing and spell-check (C2, C3, C8), the Sheets fixes
 *   (D2–D3, D6–D9), sealing off the main thread (F5).
 *
 * Everything else stays advisory: reported, and failing only the run's summary, until it too is
 * met. A metric goes on this list the stage it meets its target, never before.
 */
export const ENFORCED: Record<string, readonly string[]> = {
  // Protected
  A4: ['maxHop'],
  A5: ['framesOver100ms'],
  D1: ['openRatio'],
  E3: ['dragFps'],
  E4: ['dragFps'],
  E5: ['firstRow'],
  F3: ['heapGrowthRatio'],
  F4: ['heapPerCycle'],
  // Met
  B1: ['growthRatio'],
  B2: ['scrollDroppedRatio'],
  B4: ['inp'],
  B5: ['inp'],
  F1: ['uncompressedTextAssets', 'staticAssetsWithoutImmutable', 'thirdPartyRequests'],
  C2: ['inp'],
  C3: ['longTaskMax'],
  C8: ['longTaskMax'],
  D2: ['loafMax', 'scrollDownDroppedRatio', 'scrollAcrossDroppedRatio'],
  D3: ['inp'],
  D6: ['inp'],
  D7: ['chartPainted'],
  D8: ['inp'],
  D9: ['longTaskMax'],
  F5: ['maxBlock'],
};

export function isEnforced(scenario: string, metric: string): boolean {
  return ENFORCED[scenario]?.includes(metric) ?? false;
}
