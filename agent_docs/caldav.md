# CalDAV: Neutrino in Apple Calendar and Apple Reminders

Status: implemented on `feature/caldav` (`neutrino`: backend and web). Plan:
`agent_docs/plans/2026-11-16-caldav-server.md`.

## Why

iOS's **Add** on a "Siri Found an Event" banner, "Hey Siri, remind me…", and every event or
reminder made in Apple's own apps write through EventKit to the **default** calendar or list set
in Settings. No API lets a third-party app take those over. The only calendars that can be the
default are ones the system holds an account for, and CalDAV is the open kind. So Neutrino serves
CalDAV, and a Neutrino calendar and list can be the iPhone's defaults. The same account works in
macOS Calendar and Reminders, Thunderbird, DAVx⁵ and other CalDAV clients.

**Calendars and tasks stay unencrypted.** That is a decision, not an oversight: the server reads
and writes iCalendar itself to answer a CalDAV client, which it couldn't do over ciphertext. A
proposal to encrypt events or tasks has to drop or redesign this. The one encrypted thing nearby,
`task_places` (saved place names), is not exposed.

## Signing in: app passwords

`src/auth/app_passwords/`. CalDAV clients use HTTP Basic, the account email and an **app
password**, never the account password: an account with two-factor sign-in couldn't use that,
and a phone shouldn't hold it.

- Made in Settings → Calendar → Calendar & Reminders apps (`CalendarAppsSection.tsx`), shown
  once, stored as an Argon2 hash. Sixteen lowercase letters in four groups; compared with case,
  spaces and dashes ignored, since it is typed on a phone.
- `GET/POST /api/v1/auth/app-passwords`, `DELETE /api/v1/auth/app-passwords/{id}`. Registered
  inside the `/auth` scope, because a second `/auth/...` route beside it would never be reached.
- A client sends credentials on every request and an Argon2 verify is slow by design, so a
  verified pair is cached for five minutes under a SHA-256 of the pair. Revoking clears it, so a
  revoked password stops working at once. `last_used_at` is written at most once a minute.
- Ten failures per address or per client IP lock that key out for 15 minutes (`429`). The IP is
  read with the same `CLIENT_IP_HEADER` setting as sign-up; behind a proxy without it, every
  client would be the proxy.
- "Sign out everywhere" (`DELETE /auth/sessions`) revokes app passwords too. Changing the account
  password does not, as with Apple and Google. A disabled, locked-out or deleted account can't
  sign in.

## Routes

`src/calendar/dav/`, mounted on the app ahead of the static web app (whose catch-all would answer
with `index.html`), outside `/api/v1`:

| Path | Resource |
|---|---|
| `/.well-known/caldav` | `301` to `/dav/` (RFC 6764). What a client tries first when given the host. |
| `/dav/` | Root: `current-user-principal`. |
| `/dav/principals/{userId}/` | Principal: `calendar-home-set`, `calendar-user-address-set`. |
| `/dav/calendars/{userId}/` | Home: one collection per calendar and per task list. |
| `/dav/calendars/{userId}/{collection}/` | A collection. |
| `/dav/calendars/{userId}/{collection}/{name}.ics` | An object: one event series or one task. |

Methods: `OPTIONS` (`DAV: 1, 3, calendar-access`; no sign-in), `PROPFIND` (depth 0/1),
`REPORT` (`calendar-multiget`, `calendar-query`, `sync-collection`), `GET`/`HEAD`, `PUT`,
`DELETE`, `MOVE`, `MKCALENDAR`, `PROPPATCH`. Another user's `{userId}` is `404`.

## Collections

| Neutrino | Collection id | Component |
|---|---|---|
| A `local` calendar | `cal-<id>` | VEVENT |
| A task list | `list-<id>` | VTODO |
| Tasks in no list | `list-inbox`, "Tasks" | VTODO |

Connection calendars (copies of Google, Outlook and iCloud) are not served: the phone reaches
those directly and would show every event twice. Holiday calendars have no rows; the web computes
them.

`MKCALENDAR` makes a calendar, or a task list when the body asks for `VTODO` only; asking for
both is refused, which tells the client to make two. The client chooses the URL, so the path
segment it used is kept as an alias (`dav_objects` with `kind = 'collection'`) and the collection
is served there from then on. `PROPPATCH` renames and recolours (Apple's `#RRGGBBAA` is stored as
`#rrggbb`). Other properties, such as `calendar-order`, are accepted and not stored, because a
refusal makes Apple Calendar undo the whole change. Deleting a list keeps its tasks; deleting
the default calendar is refused by the calendars service; the inbox can't be deleted.

**A task's home list.** A task can be in many lists; a reminder is in exactly one. Each task is
served in one collection: the one a client last put it in, while it is still a member of that
list; otherwise its oldest list; otherwise the inbox (`store::home_of`). `MOVE` between lists
changes the membership and the home list. Its other lists stay visible in Neutrino.

## Bookkeeping beside the rows

Nothing on `events`, `tasks` or `task_lists` changed. What CalDAV needs lives beside them
(migration `00158_calendar__2026-11-16-000000_caldav`):

- **`dav_objects`**: for each object a client has touched, its `uid`, the resource `name` it PUT,
  the `collection` it is served in, and `extra`, the iCalendar it sent that Neutrino doesn't
  model, merged back in on `GET`. Before a client touches an object, its UID is its id and its
  name is `<id>.ics`. A row outlives its object until the change log forgets the object too: a
  client that named a reminder itself learns of the deletion only through that name.
- **`dav_changes`**: the change log behind sync tokens. One row per write to an event (logged
  under its series' master), a task or a task's list membership, **written by SQLite triggers**,
  so the API, CalDAV and calendar sync all log and no write path can forget. A row names the
  object, not the collection. A sync of a collection reports each logged object as changed if it
  is live there now, and as removed otherwise, which also covers an object moved out. Purged
  after 90 days with deleted events. A token older than the log answers `403 valid-sync-token`,
  and the client resyncs in full.

The plan put `ical_uid`/`dav_name`/`ical_extra` columns on `events` and `tasks`, a service-written
log and a soft delete for tasks. The side table and triggers do the same without touching every
read of those tables. Task deletion is a hard delete: the log records it, and no other client
reads a task changes feed.

## The mapping

### Events (`vevent.rs`)

One object is one **series**: the master `VEVENT` (with `RRULE`, and an `EXDATE` per cancelled
occurrence) plus a `VEVENT` per edited occurrence with `RECURRENCE-ID`. That is Neutrino's model
(`recurrence-exceptions.md`) as RFC 5545 writes it. A `PUT` is applied through `EventsService`:

1. Create the master, or update it as a whole replacement (absent text is sent as `""`).
2. `edit_occurrence` for each override, `cancel_occurrence` for each `EXDATE` (and each override
   sent as `STATUS:CANCELLED`).
3. `restore_occurrence` (new) for each existing exception the client no longer sends: the
   occurrence is the series' own again.

These are separate service calls, not one transaction. A failure partway leaves the series as
far as it got, and the client's next sync shows what is there.

- **All-day** is a `DATE` with an exclusive `DTEND`; the model's all-day event ends on its last
  day at 23:59:59. Converted both ways.
- **Time zones**: an IANA `TZID` (including `/mozilla.org/…/Europe/London` forms) is stored as
  `events.timezone` and written back with a generated `VTIMEZONE` for the years the event spans.
  A floating time, or a non-IANA zone, is read as UTC. That is lossy, and documented as such.
- **RRULE** passes through, with `UNTIL` normalised to UTC (`…T…Z`), the form every expander here
  reads.
- **Attendees** are `event_attendees.email`. The client's `ATTENDEE` lines (with `CN`,
  `PARTSTAT`) are kept and written back for the addresses still on the event. Nobody is sent
  invitations.
- **Extras**: everything unmodelled (alarms, `SEQUENCE`, `TRANSP`, `X-APPLE-*`) is kept per
  `VEVENT`, keyed by `RECURRENCE-ID`.

### Tasks (`vtodo.rs`)

| VTODO | Neutrino |
|---|---|
| `SUMMARY`, `DESCRIPTION`, `LOCATION` | `title`, `notes`, `location` |
| `DUE`, `DTSTART` | `due_date` + `due_has_time`, `start_date` + `start_has_time` (a `DATE` is a date) |
| `STATUS:COMPLETED` or `COMPLETED` | `done`; the client's `COMPLETED` time is kept and dropped when reopened |
| `PRIORITY` (1–9; Apple writes 1, 5, 9) | `priority` 1–3: 1–4 → 1, 5 → 2, 6–9 → 3, and back as 1/5/9 |
| `RRULE` | `recurrence_rule` |
| `CATEGORIES` | tags |
| An arrival `VALARM` (`X-APPLE-PROXIMITY:ARRIVE`, `X-APPLE-STRUCTURED-LOCATION`) | the geofence point and radius (clamped to 100–2000 m); the place's title is kept while the point is unchanged |

A saved place's coordinates are encrypted, so a task with one shows the client only the alarm
it sent, and its absence in a `PUT` clears nothing. Timed alarms, departure alarms,
`X-APPLE-SORT-ORDER` and subtask links (`RELATED-TO`) are extras. Subtasks show flat in Neutrino.

**Repeating reminders.** Neutrino completes a repeating task by marking it done and **making a
new task** for the next occurrence. Apple moves the **same** reminder's `DUE` forward. Both work
without duplicates:

- A `PUT` that keeps the rule, stays open and moves `DUE` is an ordinary update. Nothing is made.
- A `PUT` that marks a task with a rule `COMPLETED` runs Neutrino's completion: one next task, in
  the same list. Sent twice, it still makes one, since only the transition from open makes one.
- A reminder that arrives already completed doesn't repeat.

## Sync and concurrency

- **ETag**: a hash of the rendered object. `PUT` and `DELETE` honour `If-Match` and
  `If-None-Match: *` (`412`). A `PUT` returns no ETag, because what is stored is Neutrino's
  rendering, not the bytes sent (RFC 4791 §5.3.4); the client reads it back.
- **CTag** and **sync-token** are the user's newest `dav_changes.seq`.
- **`calendar-query`** applies the component, a time range on events (a recurring series is
  always sent; expanding it is the client's job), and open or completed on tasks. Anything finer
  is the client's to filter: a superset is allowed, a subset is not.

## Tests

- Unit: `ical.rs` (folding, escaping, times, `VTIMEZONE`, `UNTIL`), `xml.rs`, `vevent.rs`,
  `vtodo.rs`, `store::home_of`, the app-password service.
- End to end (`dav/tests.rs`): the real routes over an in-memory database. They cover discovery,
  a Siri event put and read back with its alarm, preconditions, sync-collection across API and
  CalDAV writes with deletions under the client's name, a series' overrides, `EXDATE`s and
  restores, reminders moving between lists and staying deleted, completing a repeating reminder,
  `MKCALENDAR`/`PROPPATCH` and querying open reminders.
- Not run here: a real iPhone, macOS, Thunderbird or DAVx⁵, or a CalDAV conformance suite. Both
  are in the plan's test plan and should be done before relying on this.
