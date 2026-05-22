# Manual Verification: Calendar Week Hour Grid

## Prerequisites
- [ ] Feature flag `calendarWeekHourGrid` enabled: set `NEXT_PUBLIC_FEATURE_CALENDAR_WEEK_HOUR_GRID=true` in your `.env.local`
- [ ] Dev server running: `pnpm dev`
- [ ] At least a few calendar events created across different times of day

## Steps to Verify

### Happy Path — Hour Grid Rendering

1. Navigate to `/calendar`
2. Click the "Week" view button in the toolbar
3. **Expect:** A Google Calendar-style grid appears with:
   - Day column headers across the top (e.g. "Sun 8", "Mon 9" … "Sat 14")
   - Today's column header has the day number highlighted in a blue circle
   - An "all day" band below the column headers
   - Hour labels in the left gutter (e.g. "8 AM", "9 AM" … "7 PM" for the default 8am–8pm window)
   - Horizontal lines at each hour (solid) and half-hour (dashed)

### Timed Event Positioning

1. Create an event for today at 10:00 AM — 11:00 AM
2. Switch to week view
3. **Expect:** The event chip appears in today's column, vertically positioned at the 10 AM row (2 hours below the 8 AM start), occupying 60px of height

4. Create a short event (15 minutes) at 2:30 PM
5. **Expect:** The event appears at the correct half-hour position and has a minimum visible height (at least 24px)

### All-Day Events

1. Create an all-day event for any day in the current week
2. Switch to week view
3. **Expect:** The event title appears in the "all day" band at the top of that day's column, not in the timed grid

### Overflow — Early Events (before day start)

1. Create an event at 6:00 AM (before the default 8 AM day start)
2. Switch to week view
3. **Expect:** A narrow "↑" row appears above the timed grid. The event chip is shown in that row with its time prefix (e.g. "6:00 AM Early Meeting")

### Overflow — Late Events (after day end)

1. Create an event at 9:00 PM (after the default 8 PM day end)
2. Switch to week view
3. **Expect:** A narrow "↓" row appears below the timed grid. The event chip is shown in that row

### Settings — Day Start/End Configuration

1. Navigate to `/settings?tab=calendar` (requires `NEXT_PUBLIC_FEATURE_SETTINGS_PAGE=true` as well)
2. **Expect:** Under "General", you see two new rows:
   - "Day starts at" dropdown (default: 8:00 AM)
   - "Day ends at" dropdown (default: 8:00 PM)
3. Change "Day starts at" to 9:00 AM
4. Navigate back to Calendar → Week view
5. **Expect:** The grid now starts at 9 AM; the 8 AM event is now in the early-overflow "↑" zone

6. Change "Day ends at" to 6:00 PM (18:00)
7. Return to Week view
8. **Expect:** The grid ends at 5 PM (the 6 PM end is the boundary); any events at 6 PM or later appear in the late-overflow "↓" zone

### Live Settings Update (cross-tab)

1. Open the calendar in one tab and settings in another
2. Change day start/end hours in settings
3. Switch back to calendar tab without refreshing
4. **Expect:** The week view updates to reflect the new window immediately

### Clicking Events

1. Click any event chip in the hour grid (timed, all-day, or overflow)
2. **Expect:** The event detail modal/panel opens

### Feature Flag Off

1. Remove or set `NEXT_PUBLIC_FEATURE_CALENDAR_WEEK_HOUR_GRID=false`
2. Restart the dev server
3. Navigate to Calendar → Week view
4. **Expect:** The old flat week view renders (day cells with stacked event chips, no hour rows)
5. The settings page should NOT show the "Day starts at" / "Day ends at" rows

## Expected Results Summary

| Scenario | Expected |
|---|---|
| Flag on, week view | Hour grid with gutter labels |
| Timed event at 10 AM | Positioned ~120px from top (for 8am start, 60px/hr) |
| All-day event | In "all day" band, not in hour grid |
| Event at 6 AM (start=8) | In "↑" early overflow row |
| Event at 9 PM (end=20) | In "↓" late overflow row |
| Change day start to 9 AM | Grid shifts; 8 AM events move to overflow |
| Flag off | Old flat week view |

## Rollback

Disable `calendarWeekHourGrid` by setting `NEXT_PUBLIC_FEATURE_CALENDAR_WEEK_HOUR_GRID=false` (or removing the env var) and restarting the server. No database changes involved — instant rollback.
