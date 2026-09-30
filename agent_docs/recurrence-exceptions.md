# Recurrence exceptions — "this event", "this and following", "all events"

Status: implemented on `feature/recurrence-exceptions` (`neutrino`, `neutrino_calendar_ios_mobile`).
This is Epic 21 of the calendar roadmap.

## Why

A repeating event used to be one row carrying an RRULE and nothing else, so it could only be
edited or deleted as a whole. Every calendar people use lets them change one occurrence, or cut
the series at an occurrence, and the clients now ask which one is meant whenever a repeating
event or reminder is edited or deleted.

## How Google and Outlook do it, and what this copies

Both follow RFC 5545: a repeating event is a **master** holding the rule, plus **exceptions**
keyed by the *original* start of the occurrence they replace.

| Choice | Google Calendar | Outlook / Graph | Neutrino |
|---|---|---|---|
| This event, edit | An instance stored with `recurringEventId` + `originalStartTime` | An `exception` with `seriesMasterId` + `originalStart` | An exception row, `recurring_event_id` + `original_start_time` |
| This event, delete | An instance with `status: cancelled` | Added to `cancelledOccurrences` | An exception row with `cancelled = true` |
| This and following | Split: `UNTIL` on the old master, a new series from the occurrence | Split, done by the client | Split, done by the **server** in one transaction |
| All events | Edit the master; exceptions keep their own changes | Edit the master; a pattern change drops exceptions | Edit the master; exceptions follow it (rules below) |
| Expansion | Server | Server | Still the clients (see "Why the clients still expand") |

`RANGE=THISANDFUTURE` exists in the RFC but almost nothing supports it, so everyone splits, and
so does this.

## Data model

`events` gains three columns (migration `00138_calendar__…_recurrence_exceptions`):

| Column | Meaning |
|---|---|
| `recurring_event_id` | The master this row is an exception of. NULL for a master or a one-off. `ON DELETE CASCADE`. |
| `original_start_time` | The start the occurrence had in the series, before any edit. The exception's key. |
| `cancelled` | The occurrence is deleted. Its other fields are kept but meaningless. |

An exception is otherwise an ordinary event row with every field filled in: copied from the
master when it is made, then changed. It never has a recurrence rule of its own. One live
exception per `(recurring_event_id, original_start_time)`, enforced by a partial unique index.

## API

All under `/api/v1/calendar`. Every change is **additive**: a client that doesn't ask for
exceptions never sees an exception row, and sees each series exactly as before.

### Reading

- `GET /events?from&to&exceptions=true` returns the events in the range as before, plus every
  live exception of every recurring master returned. Without `exceptions=true` exception rows
  are left out. An old client then simply shows the series without its exceptions, rather than
  showing an override twice or a cancelled occurrence as an event.
- `GET /events/changes?since&exceptions=true` works the same way. Deleted exceptions appear in
  `deletedIds` either way; an id a client never held is harmless.
- `EventResponse` gains `recurringEventId`, `originalStartTime` and `cancelled`.

### This event

- `PUT /events/{seriesId}/occurrences/{originalStart}` with an `UpdateEventRequest` creates the
  exception for that occurrence, or updates the one there is, and returns it. A `recurrenceRule`
  is refused: an exception can't repeat. A cancelled occurrence edited this way comes back.
- `DELETE /events/{seriesId}/occurrences/{originalStart}` cancels the occurrence.
- `PUT /events/{exceptionId}` edits an exception directly, like any event.
- `DELETE /events/{exceptionId}` **cancels** it rather than deleting the row, since deleting it
  would bring the original occurrence back.

`originalStart` is the ISO 8601 instant: the exception's own `originalStartTime` when the
occurrence already has one, or the start the client expanded it to otherwise.

### This and following

- `POST /events/{seriesId}/split` with `{ originalStartTime, …UpdateEventRequest }`. In one
  transaction, the server:
  1. Ends the old series before the occurrence: drops its COUNT and UNTIL and writes
     `UNTIL=<originalStart − 1 s>` in UTC. For an all-day series that is the `T235959Z` of the
     day before, the form an all-day UNTIL already takes.
  2. Creates the new series from the master's fields and the request's: starting at the
     occurrence, as long as the master, with the request's `recurrenceRule`, or the master's own
     if there is none. **The client sends the rule** because only the client can count how many
     occurrences came before, which is what a COUNT has to be reduced by.
  3. Copies the attendees, and moves the exceptions from the occurrence on to the new series,
     reconciling them with its changes (see "All events").

  It returns the new series. At or before the master's first occurrence, a split is simply an
  edit of the whole series, and returns the master.
- `DELETE /events/{seriesId}?fromOccurrence=<originalStart>` ends the series before the
  occurrence, in the same way, and deletes the exceptions from there on. At or before the first
  occurrence, it deletes the whole series.

Attachments and linked reminders stay with the old series. A reminder is linked to an event id,
not an occurrence, and moving one would guess.

### All events

`PUT /events/{seriesId}` as before, plus reconciliation of the exceptions, the way Google keeps
them:

- **Other fields follow the series.** For title, description, location, time zone and
  attendees, an exception still holding the master's old value takes the new one. One whose
  value was changed keeps it.
- **A move of the series moves its exceptions.** When the start moves by some amount, each
  exception's `original_start_time` moves by the same amount. So does its start and end, unless
  the exception had moved its own time. A change of length changes the end of each exception
  that hadn't changed its own time.
- **A new pattern drops them.** A changed rule, switching all-day, or a move to another weekday
  for a rule with BYDAY cancels nothing but deletes every exception, as Outlook does: their
  original starts no longer name occurrences. Rules are compared without COUNT and UNTIL, so
  changing only when the series ends keeps them.

Deleting a master deletes its exceptions with it.

### Reminders

A recurring reminder is one row whose due time is its next occurrence; completing it moves it
on (`calendar::recurrence`). Earlier occurrences no longer exist, so "this and following" and
"all" are the same thing and the clients do the same for both. The clients still offer all three
choices, so reminders read like events.

- `POST /reminders/{id}/skip` with `{ timezone }` moves the series to its next occurrence, and
  deletes it when the rule is used up. Returns `{ series }`, which is `null` once deleted. This
  is "delete this reminder".
- `POST /reminders/{id}/occurrence` with `{ title?, dueTime?, timezone }` makes a one-off
  reminder from the current occurrence with the changes, then skips the series as above. Both
  happen in one transaction. Returns `{ reminder, series }`. This is "edit this reminder".

## Expanding with exceptions: both clients, the same way

`expandRecurringEvents` (web) and `RecurrenceExpander` (iOS) are ports of each other, held
together by `RecurrenceVectorTests`. Both now:

1. Set every exception row aside, grouped by `recurringEventId`.
2. Expand each master exactly as before.
3. **Match** each generated occurrence to the exception of its series whose
   `originalStartTime` is nearest to it, **within two hours**. Expansion steps in the *viewer's*
   zone, so two viewers whose zones change for DST on different dates can put the same
   occurrence up to an hour apart. Occurrences are at least a day apart, so two hours can't
   match the wrong one.
4. For a match: a cancelled exception drops the occurrence. Otherwise the exception is shown in
   its place, with its own times, when it starts in the range.
5. An exception not matched in the range is shown when it starts in the range and its original
   start does not. That is an occurrence moved in from a neighbouring month. An exception whose
   original start is in the range but matched nothing belongs to an occurrence the series no
   longer has, and is not shown.

Every occurrence of a series carries its **series** (the master) and its **original start**. An
edit or delete uses those, never the id of the row shown, which for an exception is the
exception's.

COUNT counts cancelled occurrences, as the RFC's EXDATE does: deleting one occurrence of "10
times" leaves nine, not ten with one more at the end.

## The clients

Editing or deleting an occurrence of a repeating event, or a repeating reminder, asks
**This event / This and following events / All events** (or "reminder").

| | This event | This and following | All events |
|---|---|---|---|
| Form shows | The occurrence, without repeat options | The occurrence, with the series' rule (COUNT reduced by the occurrences before it) | The series from its own start |
| Save | `PUT …/occurrences/{originalStart}` | `POST …/split` | `PUT /events/{seriesId}` |
| Delete | `DELETE …/occurrences/{originalStart}` | `DELETE /events/{seriesId}?fromOccurrence=` | `DELETE /events/{seriesId}` |

When the occurrence is the series' first, "This and following" is the same as "All events", and
the clients send the plain update. This also fixes the web's old bug of saving an occurrence's
date as the series' start: "All events" now edits from the series' own start, as iOS does.

## Why the clients still expand

Expanding on the server, as Google's `singleEvents=true` and Graph's `calendarView` do, would
make one implementation the truth instead of two kept in step by vectors, and the roadmap leans
that way. It would also change the changes feed, iOS's offline cache and every view on both
clients. Exceptions here are rows that the existing feed and cache already carry, so this
change doesn't depend on that move and doesn't block it.

## Known limits

- A provider-synced series (Google, Outlook, iCloud) stays read-only on iOS. The server takes
  exceptions for one, but a provider sync that rewrites the master doesn't know about them.
- `.ics` import still skips `RECURRENCE-ID` overrides and ignores EXDATE. Importing them into
  exception rows is a follow-up.
- A time move that crosses a DST change in the event's zone shifts the exceptions by the same
  instant, which can put them an hour off the wall-clock time the series moved to.
