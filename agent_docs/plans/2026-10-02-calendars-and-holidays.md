# Plan: Multiple calendars per user, and holiday calendars by country

Issues #236 (calendars: colour, show/hide, read-only) and #237 (holiday and observance calendars by
country, which depends on #236). Design: `agent_docs/calendars.md`.

## Summary

Every event now belongs to a **calendar**: a named, coloured group a user can show or hide, and
which can be read-only. Each user has a default local calendar that every existing event and every
event created without a `calendarId` lands in, and each connected provider (Google, Outlook, Apple)
has a calendar of its own that its synced events land in. Read-only is enforced by the server: the
event write routes refuse an event in a read-only calendar. On top of that, a **holiday calendar**
is a read-only calendar of kind `holidays` that stores only its settings (country, region, whether
observances are included, colour, visibility). The web computes its days from the `date-holidays`
rules library when a range is shown, so no holiday rows are written and no third party learns which
countries a user picked.

## Affected Repos

- `neutrino` — migration, `calendar::calendars` module and API, `calendarId` on events (additive),
  read-only enforcement, sync into connection calendars; web calendar list, colours, event form's
  calendar picker, Settings → Calendar → Holidays, holiday expansion; e2e spec.
- `neutrino_calendar_ios_mobile` — **not in this change.** `calendarId` is an additive optional
  field and no existing event is read-only, so shipped builds keep working unchanged. The calendar
  list, colours and holidays on iOS are a follow-up with its own branch and PR (#236 asks for this).

## Tasks

1. Migration `00139_calendar__2026-10-02-000000_calendars`: `calendars` table; one default
   calendar per user (users and event owners); one connection calendar per (user, provider) that
   has events or a connection; `events.calendar_id`, backfilled. `updated_at` is not bumped, so
   clients aren't made to re-download every event.
2. `src/schema.rs`: `calendars`, `events.calendar_id`.
3. `src/calendar/calendars/` — `model.rs`, `dto.rs`, `store.rs` (connection-taking helpers used
   by events and sync: default calendar, provider calendar, writable check), `service.rs`,
   `api.rs`: `GET/POST /calendar/calendars`, `PATCH/DELETE /calendar/calendars/{id}`.
4. Events: `calendarId` on create/update/split requests and on `EventResponse`; create lands in
   the default calendar when none is given; every write refuses a read-only calendar (403);
   exceptions and split series take their series' calendar; moving a series moves its exceptions;
   one occurrence can't move calendar on its own.
5. Tasks service: scheduling a task creates its event in the default calendar.
6. Connections sync: synced events land in the provider's calendar (made on first sync).
7. `main.rs`: wire the calendars service, API and OpenAPI doc.
8. `@neutrino/api-calendar`: calendar types and methods; `calendarId` on event types.
9. Web: `calendars.ts` (colour lookup, visibility filter, holiday expansion via `date-holidays`,
   loaded on demand), `CalendarsSidebar.tsx` (swatch + show/hide per calendar, new calendar),
   events drawn in their calendar's colour in month, week and agenda views, a calendar picker in
   the event form, edit/delete hidden for read-only events in the detail views.
10. Web settings: `HolidaysSection.tsx` in Settings → Calendar — searchable country list, region,
    observances, colour, show/hide, remove.

## Test Plan

- Unit (Rust, inline):
  - calendars service: default made once; list/create/update/delete; a holiday calendar needs a
    country and is read-only; one per country; the default and a connected provider's calendar
    can't be deleted; deleting a calendar deletes its events; another user's calendar is 404.
  - events service: create lands in the default calendar, or the one given; a read-only
    calendar refuses create, update, delete, occurrence edit/cancel and split (403); moving a
    series moves its exceptions; an exception can't move on its own; split keeps the calendar.
  - migration backfill: existing events land in the default calendar; synced events in their
    provider's.
- Unit (web, Vitest): holiday expansion (US Thanksgiving and Labor Day in 2026 and 2027, observances
  only when asked, a hidden calendar shows nothing); visibility filter; colour lookup; calendar
  sidebar toggling; the event detail hiding edit/delete for a read-only event.
- E2E (`e2e/tests/calendar/calendars.spec.ts`): create a calendar, put an event in it, hide it and
  reload (still hidden), show it; add United States holidays in settings and see Thanksgiving in
  month and agenda view with no edit or delete; API refuses writes to a read-only calendar.

## Open Questions

Decided here, from the issue's own leanings — say if any should change:

- Holiday choices sync across devices (stored server-side as calendar rows), not per-browser.
- Observances are off by default.
- iOS gets this as a follow-up, not in the same release.
- Synced provider calendars are **not** read-only: their events were editable before this change,
  and #236 requires existing events to appear unchanged.
- The web has no event drag or ICS export today, so "can't be dragged" and "ICS export leaves them
  out" have nothing to act on yet; holidays are never stored as events, so any future export of
  stored events leaves them out by construction.
