# Calendars, and holiday calendars by country

Status: implemented on `feature/calendars-and-holidays` (`neutrino`: backend and web). Issues #236
and #237. Plan: `agent_docs/plans/2026-10-02-calendars-and-holidays.md`.

## Why

Every event used to sit in one flat list per user, with only a free-text `source` to tell synced
events from local ones. There was no way to colour a group of events, hide a group without deleting
it, or have events that can't be edited — and holiday calendars need all three.

## Data model

`calendars` (migration `00139_calendar__…_calendars`):

| Column | Meaning |
|---|---|
| `kind` | `local` (the user's own), `connection` (a synced provider's events) or `holidays`. |
| `is_default` | Where an event created without a calendar goes. One per user (partial unique index). Can't be deleted. |
| `color` | `#rrggbb`. |
| `visible` | Shown or hidden. Stored on the server, so it is the same on every device and survives a reload. |
| `read_only` | Its events can't be created, edited or deleted. Enforced by the server. |
| `source` | `connection` only: the provider, as `events.source` names it. One per (user, provider). |
| `country`, `region`, `include_observances` | `holidays` only. One per (user, country). |

`events.calendar_id` names an event's calendar. The migration gives every user a default calendar
(every row of `users`, and every owner of an event, since `events.user_id` has no foreign key),
gives each provider a user has synced from or connected to a calendar of its own, and puts every
existing event in one of them. It does **not** bump `updated_at`: nothing a client shows changed,
and bumping it would send every event down every client's changes feed again.

A user added after the migration gets their default calendar the first time anything needs it
(`store::default_calendar`): listing calendars, or creating an event without one.

A provider's calendar is keyed by provider, not by connection id: reconnecting an account replaces
its `calendar_connections` row with a new id, and its events should stay where they were.

## API

All under `/api/v1/calendar`. Every change to events is **additive**: `calendarId` is a new optional
field on requests and responses, and a client that never sends it creates events in the default
calendar, as it always did. Shipped iOS builds keep working unchanged.

- `GET /calendars` — the user's calendars, the default first, then local, providers', holidays.
  Hidden ones are listed too; hiding is applied by the clients when they draw events.
- `POST /calendars` `{ name, color?, kind?: "local" | "holidays", country?, region?, includeObservances? }`
  — 201. A holiday calendar needs a two-letter `country`, is read-only, and is one per country
  (409). Connection calendars can't be made by hand (400); connecting an account makes one.
- `PATCH /calendars/{id}` `{ name?, color?, visible?, region?, includeObservances? }` — settings,
  so allowed on a read-only calendar. `region` and `includeObservances` only on a holiday calendar.
  An empty `region` clears it.
- `DELETE /calendars/{id}` — deletes it and soft-deletes its events (the changes feed reports
  them). Not the default (400); not a provider's while its account is connected (409), since the
  next sync would bring it straight back.

Events:

- `POST /events` takes `calendarId`; absent, the default. Another user's calendar is 404, a
  read-only one 403.
- `PUT /events/{id}` takes `calendarId` to move the event. A series moves with its exceptions:
  an exception is always in its series' calendar, so one occurrence can't move on its own (400).
- Every write to an event in a read-only calendar is refused with 403: update, delete, and the
  occurrence, split and `fromOccurrence` routes. Nothing can be moved into one either.
- `POST /events/{id}/split` keeps the series' calendar unless `calendarId` names another.
- `EventResponse.calendarId`.

Sync puts a provider's events in its calendar on insert, and on update only when the event has no
calendar: an event the user moved to a calendar of their own stays there.

## Holidays

A holiday calendar stores only its settings. The web computes its days with the
[`date-holidays`](https://github.com/commenthol/date-holidays) rules library (about 200 countries,
with regions and observances; data CC BY 3.0, credited in Settings):

- No holiday rows are written, so there is nothing to re-sync each year and nothing per user that
  grows with the years shown.
- A user's choice of countries never leaves Neutrino: there is no third-party fetch to tell anyone.
- The library is loaded with a dynamic `import()` only when a holiday calendar is shown or the
  settings list countries; it is the size of a large library, and most users have none.
- It works offline once the page has loaded, like every other computed view.

`calendars.ts` (`holidaysOf`) turns each holiday into an all-day `EventResponse` in its calendar —
id `holiday:<calendarId>:<date>:<name>`, `source: "holidays"` — dated by its date in the country,
`T00:00:00Z` to `T23:59:59Z`, the form every all-day event takes. `date-holidays` types `public` and
`bank` are holidays; with observances on, `optional` and `observance` are added (`school` never is).
Names are in the browser's language: the full tag, since `en-US` says "Labor Day" where `en` says
"Labour Day".

Holiday events are read-only twice over: the server has no row to edit, and the UI shows them
without edit or delete (`isReadOnlyEvent`), and never asks the server for their reminders or
attachments.

## The web

- **Sidebar** (`CalendarsSidebar`): a checkbox in each calendar's colour shows or hides it; the
  swatch is a colour input; any calendar but the default can be deleted (with a confirmation);
  a lock marks a read-only one; "Add holidays…" links to settings. Show/hide is applied
  optimistically.
- **Views**: month, week and agenda draw each event in its calendar's colour through the
  `--event-bg`, `--event-fg` and `--event-solid` custom properties (`eventColorStyle`), falling back
  to the primary colour for an event whose calendar isn't known yet.
- **Event form**: a Calendar picker of the writable calendars, when there is more than one; not
  for "this event", since one occurrence can't move on its own. An edit sends `calendarId` only
  when it changed.
- **Settings → Calendar → Holidays** (`HolidaysSection`): a searchable country list; per country,
  a region (where the rules have any), observances, colour, show/hide and remove.

## Known limits

- iOS doesn't show calendars, colours or holidays yet; that is its own follow-up PR in
  `neutrino_calendar_ios_mobile`. Until then iOS shows every event, hidden calendars included, and
  creates events in the default calendar.
- The web has no event drag or ICS export today. When either arrives, both must respect
  `isReadOnlyEvent`; holidays are never stored, so an export of stored events leaves them out by
  construction.
- A provider's calendar is not read-only: its events were editable before this change, and an
  edit stays local (sync is one-way). Making it read-only would be a behaviour change of its own.
- Calendars aren't in the events changes feed; a client re-lists them (they are few).
