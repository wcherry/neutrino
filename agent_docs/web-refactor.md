I examined `neutrino-web` read-only. The strongest refactor opportunities are in the large client route/editor files and the spreadsheet/rendering paths.

**Top Recommendations**
1. Split large feature editors into domain modules and focused components.
   Biggest files: [SlideEditor.tsx](/Users/williamcherry/neutrino-repos/neutrino-web/apps/web/src/app/(apps)/slides/editor/SlideEditor.tsx:1) at ~2,500 lines, [calendar/page.tsx](/Users/williamcherry/neutrino-repos/neutrino-web/apps/web/src/app/(apps)/calendar/page.tsx:1) at ~1,400, [BlockEditor.tsx](/Users/williamcherry/neutrino-repos/neutrino-web/apps/web/src/app/(apps)/notes/editor/BlockEditor.tsx:1) at ~1,200. Move models, constants, export helpers, drag/resize logic, and persistence hooks into sibling files. This will improve readability and make unit testing practical.

2. Fix spreadsheet autosave lifecycle.
   [usePersistence.ts](/Users/williamcherry/neutrino-repos/neutrino-web/apps/web/src/app/(apps)/sheets/editor/hooks/usePersistence.ts:175) creates a `window.setInterval` inside `load()` and never clears it. If the editor remounts or reloads data, intervals can stack and keep saving old closures. Wrap this in a `useEffect` with cleanup or return a disposer from the persistence hook.

3. Optimize spreadsheet virtualization math.
   [SheetGrid.tsx](/Users/williamcherry/neutrino-repos/neutrino-web/apps/web/src/app/(apps)/sheets/editor/SheetGrid.tsx:34) already virtualizes cells, which is good, but variable width/height paths scan from zero on scroll and offset calculation also loops from zero at [SheetGrid.tsx:147](/Users/williamcherry/neutrino-repos/neutrino-web/apps/web/src/app/(apps)/sheets/editor/SheetGrid.tsx:147). Introduce cached prefix-sum arrays for column widths and row heights, then binary search visible ranges. This should make large sheets feel much smoother.

4. Reduce `Map`/`Set` churn in sheets.
   Spreadsheet editing frequently clones full maps for undo and edits, for example [useCellEditing.ts](/Users/williamcherry/neutrino-repos/neutrino-web/apps/web/src/app/(apps)/sheets/editor/hooks/useCellEditing.ts:66). Consider a reducer-based sheet store with patch operations: changed cells, prior values for undo, and derived dependency updates. That keeps React updates smaller and makes mutations easier to reason about.

5. Memoize derived Drive data.
   [drive/page.tsx](/Users/williamcherry/neutrino-repos/neutrino-web/apps/web/src/app/(apps)/drive/page.tsx:169) rebuilds `fileMap`, `folderMap`, and `gridItems` every render. Wrap those in `useMemo`, and wrap handlers passed into `FileGrid` with `useCallback`. Also memoize `filteredItems` in [FileGrid.tsx](/Users/williamcherry/neutrino-repos/neutrino-web/apps/web/src/components/FileGrid/FileGrid.tsx:124). This is small now with `limit: 200`, but it becomes noticeable as Drive grows.

6. Move heavyweight editor/export helpers out of initial client bundles.
   Docs already dynamically imports `docx` and `file-saver` at [DocEditor.tsx](/Users/williamcherry/neutrino-repos/neutrino-web/apps/web/src/app/(apps)/docs/editor/DocEditor.tsx:148), which is good. Apply the same pattern consistently to large editor-only features: presentation export, import parsers, AI panels, and code highlighting. Also consider `next/dynamic` for side panels such as history/comments/AI panels.

7. Extract shared persistence/encryption flow.
   Docs, sheets, and slides each repeat: load metadata, resolve E2EE key, read/decrypt content, serialize, autosave, create version. A shared hook like `useEncryptedDocumentContent({ id, filename, api })` would reduce bugs and make performance fixes, retries, and cancellation behavior reusable.

8. Narrow client boundaries where possible.
   Many route pages start with `'use client'`, including entire Drive, Photos, Calendar, Docs, Sheets, and Slides pages. Some can stay client-heavy, but list pages could split server/static shells from client controls. This improves bundle size and makes route files easier to scan.

9. Add bundle and render profiling targets.
   Add a repeatable check like `ANALYZE=true next build` or `@next/bundle-analyzer`, then profile these routes first: slides editor, docs editor, sheets editor, photos page, drive page. Without that, optimization work will drift toward “feels large” rather than measured wins.

10. Tighten generated-file/tooling boundaries.
   `apps/web/tsconfig.json` includes `.next/types/**/*.ts`, which is normal for Next, but local scans picked up `.next` unless excluded. Consider adding repo scripts or lint config that consistently ignore generated output for metrics and refactor tooling.

**Best First Slice**
Start with Sheets: fix the autosave interval cleanup, add prefix-offset caches in `SheetGrid`, and convert broad cell updates into small patch helpers. That gives the highest likely performance payoff while also cleaning up some of the hardest-to-follow code.