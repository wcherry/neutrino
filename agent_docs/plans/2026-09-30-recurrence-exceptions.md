# Plan: Recurrence exceptions (edit/delete this, this and following, all)

## Summary
Editing or deleting an occurrence of a repeating event, or a repeating reminder, asks whether
the change is meant for this occurrence, this and the following ones, or all of them. Backed by
exception rows on the server (Google's model), a server-side split for "this and following", and
exception-aware expansion in both clients. The design is `agent_docs/recurrence-exceptions.md`.

## Affected Repos
- neutrino: migration, events API (exceptions, occurrences, split, truncate, series
  reconciliation), reminders API (skip, occurrence), web calendar (expansion, scope dialog, form
  scopes)
- neutrino_calendar_ios_mobile: models, expander, API client, services, scope dialogs, editors

## Tasks
1. Migration `00138_calendar__2026-09-30-000000_recurrence_exceptions` and `schema.rs`.
2. `events/model.rs`, `dto.rs`: the new columns and response fields, the split request, the
   query flags.
3. `events/repository.rs`: listing that leaves out or adds exceptions, exception upsert,
   series-cascading delete, and the transactional split, truncate and reconcile.
4. `events/service.rs` and `api.rs`: the new routes, plus cancel-on-delete for an exception.
5. `reminders`: skip and occurrence endpoints.
6. Web `api-calendar`: the types and methods.
7. Web `calendarHelpers.expandRecurringEvents`: exceptions, series and original start.
8. Web `RecurrenceScopeModal`, and the scope flow in `page.tsx`, `NewEventModal`,
   `EventDetail`, `ReminderModal` and `RemindersSidebar`.
9. iOS `CalendarEvent`, `EventOccurrence`, `RecurrenceExpander`.
10. iOS `CalendarAPIClient`, `EventsService`, `RemindersService`, `EventDraft`.
11. iOS scope dialogs in `EventDetailView`, `EventEditorView`, `RemindersView` and
    `ReminderEditorView`.

## Test Plan
- Unit (Rust): exception create, update, cancel and list, with and without the flag; split
  moving exceptions; truncate; series edits that follow, shift and drop exceptions; deleting a
  master cascades; reminder skip and occurrence.
- Unit (web, vitest): expansion with exceptions; the scope modal; the form in each scope.
- Unit (iOS, XCTest): expansion with exceptions (the same cases as web), request building,
  service scopes.
- E2E: not added. The Playwright calendar suite has no recurring-event coverage to extend. That
  is a follow-up.

## Open Questions
None. Reminders offer all three choices, and "this and following" acts as "all" (the user's
call).
