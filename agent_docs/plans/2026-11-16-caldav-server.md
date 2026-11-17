# Plan: Neutrino as a CalDAV server, for Apple Calendar and Apple Reminders

So that Neutrino can be added as an account in the iPhone's Settings, with its calendars in Apple
Calendar and its task lists in Apple Reminders:

- **Calendar.** A Neutrino calendar can be the iPhone's **default calendar**, so anything the system
  writes there lands in Neutrino: "Siri Found an Event → Add" in Messages and Mail, invitations
  accepted in Mail, and events made in Apple Calendar or by Siri.
- **Reminders.** Neutrino task lists appear as lists in Apple Reminders, and one can be the default
  list, so "Hey Siri, remind me to…", reminders made in Messages and the Reminders widget all
  create Neutrino tasks.

The same account works in macOS Calendar and Reminders, Thunderbird, DAVx⁵ (with jtx Board or
Tasks.org) on Android, and any other CalDAV client.

## Why this, and not something in the iOS apps

iOS's "Add" for a detected event, and Siri's "remind me", write through EventKit to the default
calendar or list set in Settings. No API lets a third-party app take those over or register as a
calendar store. The only calendars and lists that can be the default are ones the system holds an
account for: iCloud, Exchange, Google, or a CalDAV server. So Neutrino has to be one of those, and
CalDAV is the open one. Apple Reminders syncs to third-party servers only through CalDAV `VTODO`.

What exists today goes the other way: `calendar::connections::apple` is a CalDAV **client** that
reads iCloud into a read-only connection calendar. Nothing here serves CalDAV.

## Decisions already made

- **Calendars and tasks stay unencrypted.** They are plaintext on the server today (`events`,
  `tasks`), and that is final: calendar data won't be end-to-end encrypted. This is what makes the
  feature possible, since the server must read and write iCalendar itself to answer a CalDAV
  client. Anything later that proposes encrypting events or tasks has to drop or redesign this
  feature. The one encrypted thing in this area, `task_places.encrypted_payload` (saved place
  names), stays encrypted and is not exposed (see the VTODO mapping).
- **Apple Reminders is in scope.** It is delivered after Calendar, on the same branch and the same
  server.

## Why it is feasible

- **The event recurrence model is already RFC 5545's.** A master row with an RRULE, plus exception
  rows keyed by `recurring_event_id` + `original_start_time`, with `cancelled` for a deleted
  occurrence (`agent_docs/recurrence-exceptions.md`). That is exactly a VEVENT with RRULE plus
  VEVENTs with RECURRENCE-ID, and a cancelled one is an EXDATE.
- **The task model covers what Reminders has:** title, notes, done, due and start (each with or
  without a time), priority, location, a repeat rule, lists, tags, a geofence and an order.
- **Calendars and task lists already exist as collections** (`calendars`, `task_lists`), and
  events already have a change feed and soft deletes (`EventsService::changes`, `deleted_at`).

## What has to be built first: gaps in the task model

Reminders does three things Neutrino's task API can't do today. Each is filled additively, and
the web and native clients get the same abilities through `/api/v1`. A Reminders user who deletes
a reminder must not see it come back.

1. **Deleting a task.** There is no delete route and no soft delete; `tasks` rows are never
   removed. Add `tasks.deleted_at`, filter it in every task read, add
   `DELETE /api/v1/calendar/tasks/{id}`, and purge after `DELETED_RETENTION_DAYS` (90) as events do.
2. **Removing a task from a list, and renaming or deleting a list.** Today a task can only be added
   to a list (`POST /tasks/{id}/lists/{list_id}`). Add the removal, `PATCH` and `DELETE` on
   `/tasks/lists/{id}`. Deleting a list leaves its tasks in place, without that list.
3. **Change tracking for tasks.** Tasks have `updated_at` but no feed and no record of deletions.
   This comes from the change log in §5, which serves tasks and events alike.

## Affected repos

- `neutrino` — backend: app passwords, task-model gaps, the change log, the `/dav` routes, the
  iCalendar mapping for VEVENT and VTODO, migrations. Web: Settings UI for app passwords. Also a
  delete action for tasks and list rename/delete in the web Tasks UI, since the API gains them.
- Native clients (`neutrino_calendar_ios_mobile`, `neutrino_calendar_android_mobile`) — **no
  required change.** Everything on `/api/v1` is additive. One behaviour change reaches them: a
  task deleted from Reminders disappears. They should pick that up on their next refresh, and a
  client that caches tasks needs to drop rows that stop coming back. Check each app's task cache
  before release; a follow-up PR per app adds the new delete action to their UI.

## Design

### 1. Authentication: app passwords

CalDAV clients sign in with HTTP Basic, and iOS has no OAuth flow for a generic CalDAV account.
The account password can't be used: accounts with TOTP (`totp_backup_codes`) would be locked out,
and a phone holding the main password is the wrong trade anyway.

- New table `app_passwords`: `id`, `user_id`, `name` ("iPhone"), `hash` (Argon2, as account
  passwords are), `scope` (`caldav`), `created_at`, `last_used_at`, `revoked_at`.
- Generated server-side as 4×4 random characters (`abcd-efgh-ijkl-mnop`), shown **once**.
- Basic auth: username is the account email, password an unrevoked app password with scope
  `caldav`. The account password is never accepted on `/dav`.
- Failed attempts are rate-limited per account and per IP.
- An `AppPasswordUser` extractor for the DAV routes, producing the same `AuthenticatedUser` the
  services take, so the events and tasks services are reused unchanged.
- Changing the account password doesn't revoke app passwords; "Sign out everywhere" and account
  deletion do.

### 2. Routes and discovery

Mounted outside `/api/v1`, ahead of the static web app (the same placement as
`/.well-known/apple-app-site-association` in `main.rs`, or the app's catch-all answers with
`index.html`):

| Path | Purpose |
|---|---|
| `/.well-known/caldav` | `301` to `/dav/` (RFC 6764). What iOS tries first after the user types the host. |
| `/dav/` | Root. `PROPFIND` answers `current-user-principal`. |
| `/dav/principals/{userId}/` | Principal: `calendar-home-set`, `calendar-user-address-set` (mailto:email), `displayname`. |
| `/dav/calendars/{userId}/` | Home: one child collection per calendar and per task list. |
| `/dav/calendars/{userId}/{collectionId}/` | One collection: an event calendar or a task list. |
| `/dav/calendars/{userId}/{collectionId}/{name}.ics` | One object: an event series or a task. |

Methods: `OPTIONS` (`DAV: 1, 3, calendar-access`), `PROPFIND` (Depth 0/1), `REPORT`
(`calendar-multiget`, `calendar-query` with time-range and, for tasks, `comp-filter VTODO`,
`sync-collection`), `GET`, `PUT`, `DELETE`, `MOVE` (Reminders moves a reminder between lists this
way), `MKCALENDAR` (Reminders' "Add List", Calendar's new calendar), and `PROPPATCH` for
`displayname`, `calendar-color` and `calendar-order` (renaming or recolouring a list). actix routes
custom methods with `Method::from_bytes`.

A `{userId}` that isn't the authenticated user is `404`, matching the rest of the API.

Discovery also needs HTTPS on the instance's public host (`PUBLIC_URL`), and a reverse proxy that
passes `PROPFIND`, `REPORT`, `MKCALENDAR`, `MOVE` and the `Depth`, `Destination`, `If-Match` and
`If-None-Match` headers through untouched. The self-host page
(`web/apps/web/src/app/(public)/self-host/`) gets a note on this.

### 3. Collections

Each collection holds **one** component type and says so in
`supported-calendar-component-set`. That is how Apple decides whether a collection is a calendar
or a reminders list. Collection ids are prefixed so the two namespaces can't collide:
`cal-<calendarId>` and `list-<taskListId>`.

| Neutrino | Collection | Served |
|---|---|---|
| `calendars`, `kind = local` | VEVENT | Read/write; the default calendar first. |
| `calendars`, `kind = connection` | — | **Not served.** These are copies of Google, Outlook or iCloud the phone can usually reach directly; serving them puts every event in Apple Calendar twice. |
| `calendars`, `kind = holidays` | — | **Not served.** They have no rows; the web computes them with `date-holidays`. |
| `task_lists` | VTODO | Read/write, one collection per list. |
| Tasks in no list | VTODO, `list-inbox`, named "Tasks" | Read/write. A virtual collection: it has no row. Creating a reminder in it makes a task with no list. |

`MKCALENDAR` creates a `calendars` row (`kind = local`) or a `task_lists` row, depending on the
component set the client asks for. A request for both is refused, which tells the client to make
two.

**A task in several lists.** Neutrino lets a task belong to many lists
(`task_list_memberships`); a reminder has exactly one. Each task is therefore served in one
collection, its **home list**:

- A new column, `tasks.home_list_id`, nullable (null means the "Tasks" collection).
- Set to the list a task is created in or first added to. When the home list is removed or deleted,
  it falls back to the oldest remaining membership.
- A `MOVE` (or `DELETE` + `PUT` elsewhere) changes the home list and the membership. Other
  memberships are left alone and stay visible in Neutrino.

### 4. The iCalendar mapping

#### 4a. Events (VEVENT)

One **object** is one series: the master row plus all its live exception rows, rendered as one
`VCALENDAR` holding the master `VEVENT` (RRULE, and an EXDATE for each `cancelled` exception) and
one `VEVENT` per edited exception carrying `RECURRENCE-ID` = `original_start_time`. A PUT is parsed
back into the same shape and reconciled with the existing exception rows in one transaction:
insert, update, or soft-delete each exception. That reconciliation is the hardest part of the event
half. It sits beside `series.rs` and reuses its rules: an exception never has its own RRULE, and
moving a series moves its exceptions.

- **All-day.** iCalendar sends `DTSTART;VALUE=DATE` with an **exclusive** `DTEND`. Neutrino stores
  all-day events as `T00:00:00Z`–`T23:59:59Z` of the last day (the web's `.ics` import converts
  the same way, `calendar/icsImport.ts`). Convert both ways.
- **Time zones.** An IANA `TZID` (Apple and Google always send these) goes into `events.timezone`
  and the instant into `start_time`/`end_time`. A Windows name goes through the mapping the web
  import uses. Output carries `TZID` plus a generated `VTIMEZONE`. Floating times are stored as UTC
  with no timezone, and documented as lossy.
- **RRULE** passes through as text after the same `UNTIL` normalisation `buildRepeatRule` does
  (`calendar/repeatRule.ts`), since every expander reads only the UTC form.
- **Attendees** map to `event_attendees.email`. Neutrino sends no invitations (no iTIP/iMIP).
  `ATTENDEE` parameters are kept in `ical_extra`.

#### 4b. Tasks (VTODO)

| VTODO | Neutrino `tasks` | Notes |
|---|---|---|
| `UID` | `ical_uid` | Backfilled `<id>@<host>`. |
| `SUMMARY` | `title` | |
| `DESCRIPTION` | `notes` | |
| `STATUS:COMPLETED`, `COMPLETED` | `done`, new `completed_at` | `completed_at` is new; Reminders shows it, and today nothing records it. Set by every completion, not only CalDAV ones. |
| `DUE` | `due_date` + `due_has_time` | `VALUE=DATE` when there is no time. TZID handled as for events. |
| `DTSTART` | `start_date` + `start_has_time` | |
| `PRIORITY` | `priority` | iCalendar is 1–9, 0 = none; Apple writes 1 (high), 5 (medium), 9 (low). Neutrino is 1–3: 1–4 → 1, 5 → 2, 6–9 → 3, and back as 1/5/9. |
| `LOCATION` | `location` | |
| `RRULE` | `recurrence_rule` | See "Repeating reminders" below. |
| `CATEGORIES` | `task_tags` | Apple Reminders' own tags don't sync over CalDAV, but other clients use CATEGORIES. |
| `X-APPLE-SORT-ORDER` | `position` | Reminders' manual order. |
| `VALARM` with a proximity trigger and `X-APPLE-STRUCTURED-LOCATION` | `geo_lat`, `geo_lng`, `geo_radius_m` | Apple's "remind me when I arrive". Only the coordinates and radius: `geo_place_id` points into `task_places`, whose name is encrypted, so the title Apple shows is whatever it sent, kept in `ical_extra`. A geofence set in Neutrino goes out with a generic title ("Location"). |
| Other `VALARM`s, `URL`, `RELATED-TO` (subtasks), `X-APPLE-*` | `ical_extra` | Kept and sent back. Subtasks show flat in Neutrino; see open questions. |

`repeat_after_completion`, `estimate_minutes` and `event_id` (a task scheduled as an event) have
no iCalendar form and are left untouched by a PUT.

**Repeating reminders.** The two models differ, and getting this wrong creates duplicates or loses
history:

- Neutrino (RTM style, `TasksService::update_task`): completing a repeating task leaves it done and
  without a rule, and **creates a new task** for the next occurrence.
- Apple Reminders: completing a repeating reminder **moves the same VTODO's DUE forward** and keeps
  it open. The client does the arithmetic and PUTs the result.

Rule for DAV writes: a PUT that keeps the RRULE, leaves the task open and moves DUE forward is an
ordinary update; the server spawns nothing. A PUT that sets `STATUS:COMPLETED` on a task that still
has an RRULE runs Neutrino's completion, which spawns the next task. Apple will then see a new
reminder for the next occurrence, which matches what it would have done itself. Both paths are
pinned by tests, and checked against a real iPhone before release, since Apple's exact write on
completion has varied between iOS versions.

#### 4c. Both

New columns, in the same migration:

| Column | On | Why |
|---|---|---|
| `ical_uid` | `events`, `tasks` | The client's `UID`, returned unchanged. Unique per (user, collection) among live rows. |
| `dav_name` | `events`, `tasks` | The last path segment as the client PUT it. Clients address an object by the href they created. NULL means `<id>.ics`. |
| `ical_extra` | `events`, `tasks` | Properties and components Neutrino doesn't model, stored as raw iCalendar text and merged back on GET. Without this, an alert or subtask link set on the phone disappears on the next sync, and the phone puts it back, forever. |

Writing is hand-rolled, with line folding at 75 octets and escaping per RFC 5545 §3.1/3.3.11.
Parsing uses the `ical` crate, which is already a dependency.

### 5. Concurrency and sync: one change log

- **ETag** per object: a hash of the rendered bytes. PUT honours `If-Match` (412 on mismatch) and
  `If-None-Match: *` (412 if it exists); iOS relies on both.
- **Change log.** A new table `dav_changes`: `seq` (bigserial), `user_id`, `collection_id`
  (`cal-…`/`list-…`), `object_id`, `deleted` bool, `at`. It is written in the same transaction as
  every create, update, delete and move of an event or task, **by the services**, so `/api/v1`
  writes from the web and the apps are logged as well as DAV writes. A move writes two rows:
  deleted in the old collection, changed in the new one. This replaces timestamp cursors for DAV,
  for two reasons:
  - Tasks have no feed and no deletion record at all.
  - The events `changes` cursor works to the second, so two writes in the same second as the token
    is issued can be missed. A phone syncing in the background would then show an event that
    never arrives.
- **sync-token** is the collection's highest `seq`. **CTag** (`CS:getctag`) is the same number.
  `sync-collection` returns objects with `seq > token`, deletions as `404` entries. A token older
  than the log's 90-day retention answers `403 DAV:valid-sync-token`, which makes the client
  resync in full. This matches `full_resync_required` on the events feed.
- Rows are purged after `DELETED_RETENTION_DAYS`, by the job that already purges deleted events.
- The native clients' `changes` endpoint could move to `seq` later; not in this change.

### 6. Web: Settings → Calendar → "Calendar & Reminders apps"

- Lists app passwords (name, created, last used) with Revoke.
- "Add a device" asks for a name, creates the password, and shows it once together with the server
  (`<host>`), the user name (the email) and short iPhone steps: Settings → Apps → Calendar →
  Calendar Accounts → Add Account → Other → Add CalDAV Account. Then turn on Calendars and
  Reminders for it, and set the Default Calendar and Default List to Neutrino's.
- Phase 2: **"Set up this iPhone"** downloads a `.mobileconfig` CalDAV payload with the host, user
  and password filled in, so nothing has to be typed.

No feature flag (beta rule): the section ships with the server half, on the same branch.

## Tasks

Delivered in this order, each step shippable on its own.

**Milestone A: groundwork**
1. Migration `00158_calendar__…_caldav`: `app_passwords`; `dav_changes`; on `events` and `tasks`
   `ical_uid` (backfilled), `dav_name`, `ical_extra`; on `tasks` `deleted_at`, `completed_at`,
   `home_list_id` (backfilled from the oldest membership). `schema.rs`.
2. Task-model gaps: soft delete and `DELETE /tasks/{id}`; remove from a list; `PATCH`/`DELETE`
   `/tasks/lists/{id}`; `completed_at`; home-list rules; every task read filters `deleted_at`. Web
   Tasks UI gets delete, and list rename/delete.
3. `dav_changes` written by the events and tasks services on every write, plus the purge.
4. `src/auth/app_passwords/`: model, repository, service (create → plaintext once, verify, revoke,
   touch `last_used_at` at most once a minute), `/api/v1/auth/app-passwords` (list, create,
   delete), OpenAPI. Web Settings section (§6).

**Milestone B: Calendar (VEVENT)**
5. `src/calendar/dav/`: `auth.rs` (Basic → `AppPasswordUser`, rate-limited); `xml.rs` (PROPFIND,
   REPORT and PROPPATCH bodies in; `multistatus` out, starting from the reader in
   `connections/apple.rs`); `props.rs` (`resourcetype`, `displayname`, `getetag`, `getctag`,
   `sync-token`, `supported-calendar-component-set`, `calendar-color` and `calendar-order` in the
   Apple namespace, `current-user-principal`, `current-user-privilege-set`, `calendar-home-set`,
   `calendar-user-address-set`, `supported-report-set`, `owner`; unknown → `404` inside the
   multistatus); `handlers.rs`; `vevent.rs`; `reconcile.rs` (a series PUT → master and exceptions
   in one transaction).
6. `main.rs`: `/.well-known/caldav` and the `/dav` scope ahead of the static app. Confirm
   `NormalizePath(MergeOnly)` and `Compress` leave DAV responses alone; trailing slashes on
   collections are significant.

**Milestone C: Reminders (VTODO)**
7. `vtodo.rs` (the §4b mapping, including priority scaling and repeat rules); task-list
   collections and the virtual "Tasks" collection; `MKCALENDAR` for lists; `MOVE` between lists;
   `calendar-query` with `comp-filter VTODO` (Reminders asks for incomplete reminders and for
   completed ones since a date).

**Milestone D: docs**
8. `agent_docs/caldav.md` (the design: both mappings, the change log, what is lossy, the
   no-encryption decision); `web/CLAUDE.md` Settings and Tasks paragraphs; the self-host proxy
   note.

## Test plan

- **Unit (Rust):**
  - VEVENT round-trips: one-off timed; all-day (exclusive DTEND); IANA and Windows TZID; floating;
    RRULE with UNTIL in each form; a series with edited and cancelled exceptions; unknown properties
    and VALARM survive byte for byte; folding at 75 octets with multi-byte characters.
  - VTODO round-trips: due date with and without time; start; each priority value in both
    directions; done ↔ `STATUS:COMPLETED` with `COMPLETED`; CATEGORIES ↔ tags; a proximity
    alarm ↔ geofence; RELATED-TO kept; `repeat_after_completion` and `estimate_minutes` untouched
    by a PUT.
  - Repeating reminders: a PUT that moves DUE forward spawns nothing; a PUT that completes a task
    with an RRULE spawns exactly one next task; the same completing PUT sent twice spawns one.
  - `reconcile.rs`: a series PUT that adds, edits and removes exceptions; one that changes the
    RRULE; a UID belonging to another user is refused.
  - Home list: create in a list; MOVE; remove the home list → oldest remaining membership; a task
    in two lists is served once.
  - Change log: every service write logs; a move logs a delete and a change; sync-collection over
    add/edit/delete/move; an expired token is `403 valid-sync-token`; two writes in the same second
    are both reported.
  - App passwords: shown once; the hash verifies; revoked fails; the account password is refused on
    `/dav`; the rate limit trips.
  - ETag with `If-Match` and `If-None-Match`.
- **Protocol conformance:** run CalDAVTester or `caldav-server-tester` against a local instance in
  CI (Linux; no macOS runners).
- **Real clients (manual, recorded in the PR):**
  - iPhone Calendar: add the account by host name only; set it as default; tap **Add** on a "Siri
    Found an Event" banner in Messages, and the event appears in the Neutrino web calendar and the
    Neutrino Calendar app. Edit it on each side and see the other update. Add an alert, sync, and
    check it is still there. Edit one occurrence of a repeating event; delete "this and following".
  - iPhone Reminders: "Hey Siri, remind me to buy milk tomorrow at 9" lands in the default Neutrino
    list. Complete it. Complete a repeating reminder and count the tasks in Neutrino. Move a
    reminder between lists. Create, rename and delete a list. Add a location reminder. Delete a
    reminder and confirm it stays gone in Neutrino and on a second device.
  - macOS Calendar and Reminders, Thunderbird, DAVx⁵ with Tasks.org on Android: the same basics.
- **e2e (Playwright):** create an app password in Settings, PROPFIND and PUT a VEVENT and a VTODO
  with it from the test, and see both in the web app.

## Open questions

1. **Subtasks.** Reminders nests subtasks with `RELATED-TO;RELTYPE=PARENT`. Neutrino tasks have no
   parent, so subtasks show flat in Neutrino and keep their nesting on Apple devices only. Add
   `tasks.parent_id` if Neutrino should show them nested too.
2. **Serving holiday calendars and connection calendars** read-only, if users want them in Apple
   Calendar. Holidays would need `date-holidays` (or a Rust equivalent) on the server.
3. **Invitations (iTIP).** Attendees are a list of emails and nobody is sent anything. CalDAV
   scheduling (`schedule-inbox`/`outbox`) is a large feature, and isn't needed for the Siri,
   Messages or Reminders cases.
4. **Per-calendar sharing.** Teams can't share a calendar or list today. If they could, the
   principal model in §2 would need shared collections.
5. **The `reminders` table** (simple timed reminders behind the notification engine) is not
   exposed. Apple's alerts on events and reminders stay as `VALARM`s in `ical_extra` and fire on
   the phone. Whether Neutrino should also notify for them is separate.
