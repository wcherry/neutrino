# Refactor Plan: Split Large Feature Editors into Domain Modules

## Branch
`refactor/split-feature-editors`

## What is Changing and Why

Three large monolithic editor files are being decomposed into focused sibling modules. No logic changes — purely structural extraction with proper imports. Goals: readability, unit testability, and separation of concerns.

## Files Affected

### 1. `apps/web/src/app/(apps)/slides/editor/SlideEditor.tsx` (~2,500 lines)

Extract into the same `editor/` directory:

| New File | What Goes There |
|---|---|
| `slideEditorTypes.ts` | All exported TS interfaces: TextStyle, ElementAnimation, TextElement, ShapeElement, SlideElement, SlideBackground, Slide, Theme, SlideMaster, SlidePresentation |
| `slideEditorConstants.ts` | DEFAULT_THEME, SHAPE_CATALOG, SHAPE_GROUPS, SLIDE_LAYOUTS, PRESET_GRADIENTS, RESIZE_HANDLES, uid(), makeDefaultPresentation(), makeDefaultMaster() |
| `slideEditorHelpers.ts` | slideBackgroundStyle, getAnimationStyle, bgPreviewStyle, dbThemeToTheme |
| `pptxExport.ts` | exportAsPptx function and its direct helpers |
| `pptxImport.ts` | importFromPptx, PPTX_MAX_BYTES, NS_A, NS_P, SLIDE_W_EMU, SLIDE_H_EMU, icsDateToIso-equivalent parsing helpers |
| `BackgroundPicker.tsx` | BackgroundPicker component (uses PRESET_GRADIENTS from constants) |
| `SlideCanvas.tsx` | SlideCanvas component + drag/resize logic |
| `SlideThumbnail.tsx` | SlideThumbnail component |
| `PresenterView.tsx` | PresenterView component |

`SlideEditor.tsx` becomes the orchestrator: imports from all siblings, retains the main `SlideEditor` export with state/mutations/event handlers.

---

### 2. `apps/web/src/app/(apps)/calendar/page.tsx` (~1,400 lines)

Extract into the same `calendar/` directory (siblings to `page.tsx`):

| New File | What Goes There |
|---|---|
| `calendarTypes.ts` | View type, ParsedIcsEvent, ReminderEntry, all local interfaces |
| `calendarConstants.ts` | DAYS, MONTHS, REMINDER_PRESETS |
| `calendarHelpers.ts` | startOfMonth, isSameDay, fmtTime, weekStartDate, fmtRangeLabel, monthRange, buildMonthGrid, eventsForDay, isOverdue, parseIcs, icsDateToIso |
| `NewEventModal.tsx` | NewEventModal component |
| `ReminderModal.tsx` | ReminderModal component |
| `RemindersSidebar.tsx` | RemindersSidebar + ReminderItem components |
| `EventDetail.tsx` | EventDetail + AttachmentItem components |
| `MonthView.tsx` | MonthView component |
| `WeekView.tsx` | WeekView component |
| `AgendaView.tsx` | AgendaView component |

`page.tsx` becomes the orchestrator: imports from siblings, retains CalendarPage with queries/mutations/state.

---

### 3. `apps/web/src/app/(apps)/notes/editor/BlockEditor.tsx` (~1,200 lines)

Extract into the same `editor/` directory:

| New File | What Goes There |
|---|---|
| `blockEditorTypes.ts` | BlockType, TableCell, TableRow, TableColumn, TableStyle, TableData, Block, FocusRequest, all component prop interfaces |
| `blockEditorConstants.ts` | SLASH_COMMANDS, TABLE_PRESETS, TABLE_STRUCTURE_OPTIONS, INLINE_PATTERN |
| `blockEditorHelpers.ts` | genId, createDefaultTable, parseBlocks (keep export), serializeBlocks (keep export), getWikiLinkQuery, insertWikiLink, renderInline, numberedIndexInGroup |
| `TableBlock.tsx` | TableBlock component (uses TablePreset type from types, TABLE_PRESETS from constants, helpers) |
| `BlockRow.tsx` | BlockRow component (uses Block/FocusRequest from types, SLASH_COMMANDS from constants, helpers) |

`BlockEditor.tsx` becomes the orchestrator: re-exports parseBlocks/serializeBlocks/Block/BlockType (preserving public API), imports BlockRow and renders the block list.

---

## Layers Affected
- Frontend (React/TypeScript) only — no backend changes

## Specialist Agents
- `frontend-developer` — performs all TypeScript/React file moves and import rewiring

## Feature Flag
None required — this is a pure structural refactor with no behavior change. No flag gating needed.

## Known Risks and Edge Cases
- `parseBlocks`, `serializeBlocks`, `Block`, `BlockType` are already exported from `BlockEditor.tsx` and may be imported by consumers. The refactored `BlockEditor.tsx` must re-export these from the new locations to preserve the public API.
- `importFromPptx` is already exported from `SlideEditor.tsx` — same re-export requirement.
- The calendar `constants.ts` file already exists and exports `WEEK_START_KEY`. The new `calendarConstants.ts` should NOT conflict — `DAYS`, `MONTHS`, and `REMINDER_PRESETS` can live in `calendarConstants.ts` while the pre-existing `constants.ts` keeps `WEEK_START_KEY`.
- All CSS module imports (`styles from './BlockEditor.module.css'` etc.) must remain in the files that render JSX referencing those classes.

## Acceptance Criteria
- All three editor files reduced to ~150-400 lines each (orchestrator role only)
- No logic changes — identical runtime behaviour
- All existing exports remain accessible from their original module paths (re-exported if needed)
- TypeScript compiles with no new errors
- All existing tests pass
