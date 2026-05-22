# Plan: Calendar Week View — Hour-by-Hour Grid

## Branch
`feature/calendar-week-hour-grid`

## What is changing and why

The current `WeekView` component is a simple day-column grid with event chips stacked vertically — essentially a compact version of the month view. This plan replaces it with a Google Calendar-style timed grid where:

1. Rows represent hours of the day (e.g. 8 am – 6 pm)
2. Events are positioned at the correct vertical offset and height for their start/end time
3. All-day events appear in a pinned header band above the timed grid
4. Events that fall before the visible start hour float at the top with an up-arrow indicator
5. Events that fall after the visible end hour float at the bottom with a down-arrow indicator
6. Settings let users configure the visible day window (start hour / end hour)

## Layers affected

- **Frontend (WeekView component)**: Complete rewrite of `WeekView.tsx` — new grid layout, event positioning math, overflow buckets, all-day band
- **Frontend (settings page)**: Add two new selectors ("Day starts at" / "Day ends at") to the Calendar settings tab
- **Frontend (calendar page)**: Read the two new localStorage keys and pass them as props to `WeekView`; listen for storage events
- **Frontend (constants)**: Add the two new localStorage key constants
- **CSS (page.module.css)**: Add new CSS classes for the timed grid
- **Feature flag**: `calendarWeekHourGrid` — gates the new WeekView; old WeekView is rendered when flag is off
- **Tests**: Unit tests for helper functions; component smoke tests for WeekView

## Feature flag

**Name:** `calendarWeekHourGrid`  
**Env var:** `NEXT_PUBLIC_FEATURE_CALENDAR_WEEK_HOUR_GRID`  
**Default:** off  
**Guard location:** `apps/web/src/lib/featureFlags.ts` + in `page.tsx` WeekView branch

## Implementation detail

### New localStorage keys (constants.ts)
```
neutrino:calendar:dayStartHour   (number, 0–23, default 8)
neutrino:calendar:dayEndHour     (number, 1–24, default 20)
```

### Settings (settings/page.tsx — Calendar tab)
Add a "Day view hours" row below "Start of week":
- "Day starts at" — `<select>` 12am through 11pm (hours 0–23)
- "Day ends at"   — `<select>` 1am through midnight (hours 1–24)
- Validation: end must be > start (at least 1 hour window)
- Saved immediately to localStorage, dispatches `storage` event

### calendar/page.tsx
- Read `DAY_START_KEY` and `DAY_END_KEY` on mount (with storage listener for live updates)
- Pass `dayStartHour` and `dayEndHour` as props to `WeekView`
- When flag off → render existing `WeekView` (no props change needed)

### WeekView.tsx (new implementation behind flag)

**Grid layout:**
- Fixed left gutter (56px) showing hour labels (12am, 1am … 11pm)
- 7 day columns, each `flex:1`
- Each hour row has `height: HOUR_HEIGHT` (60px by default)
- Total timed grid height = `(dayEndHour - dayStartHour) * HOUR_HEIGHT`

**Event positioning:**
- For a timed event on a day column: compute `topPx = (startMinutesFromDayStart / 60) * HOUR_HEIGHT` and `heightPx = (durationMinutes / 60) * HOUR_HEIGHT` (minimum 24px)
- Events are `position: absolute` within a `position: relative` day column

**Overflow buckets (per day):**
- `earlyEvents`: timed events whose start is before `dayStartHour`
- `lateEvents`: timed events whose start is >= `dayEndHour`
- Rendered as compact chips in a pinned top/bottom band per day
- Top band shows `↑` arrow indicator; bottom band shows `↓` arrow indicator

**All-day events:**
- Collected via `ev.allDay === true`
- Rendered in a sticky header band above the hour grid, one chip per event per day

### Tests
- `calendarHelpers` helpers: test `eventsForDay` (already exists), add tests for the new positioning math helpers if extracted
- `WeekView` component smoke test: renders hour labels, renders an event chip in the correct column, renders overflow indicators when events fall outside window

## Acceptance criteria
- [ ] Week view shows a scrollable hour grid from `dayStartHour` to `dayEndHour`
- [ ] Hour labels appear in the left gutter
- [ ] Timed events render in the correct column at the correct vertical position
- [ ] All-day events render in the top band
- [ ] Events before `dayStartHour` appear in a top overflow row with `↑` indicator
- [ ] Events after `dayEndHour` appear in a bottom overflow row with `↓` indicator
- [ ] Settings page Calendar tab has "Day starts at" and "Day ends at" controls
- [ ] Changing settings live-updates the view (storage event listener)
- [ ] Feature flag off → old WeekView behavior unchanged
- [ ] All tests pass
