# Plan: Reuse Add-Event Dialog for Edit-Event Flow

## Branch
`feature/calendar-edit-event-dialog`

## What Is Changing and Why

Currently, when a user clicks an event in the Calendar app, the `EventDetail` panel opens in the right sidebar. That panel shows event details (title, time, location, description, attendees, reminders, attachments) and provides a **Delete Event** button — but no way to edit the event fields. The user must delete and recreate to change anything.

This change adds an **Edit Event** button to `EventDetail` that opens `NewEventModal` pre-populated with all current event fields. On save, the modal calls `calendarApi.updateEvent` (PUT) instead of `calendarApi.createEvent` (POST). Reminders created as part of the initial save are unaffected by an edit; the reminder section in the modal is hidden when editing (reminders are already managed via the `EventDetail` panel).

## Layers Affected

| Layer | Change |
|---|---|
| **Frontend – types** | Extend `NewEventModalProps` to accept optional `existingEvent: EventResponse` and `onUpdate` callback |
| **Frontend – `NewEventModal`** | Accept `existingEvent` prop; pre-populate state from it; swap "Create Event" label to "Save Changes"; call `onUpdate` instead of `onCreate` when editing; hide reminders section when editing |
| **Frontend – `calendarTypes`** | Add `onUpdate` prop signature; import `EventResponse` |
| **Frontend – `EventDetail`** | Add "Edit" button; expose `onEdit` callback; internal state to track whether edit modal is open |
| **Frontend – `page.tsx`** | Wire `updateEvent` mutation; pass `onEdit` to `EventDetail` |

## Specialist Agents

- `frontend-developer` — all `.tsx`/`.ts` changes
- `test-writer` — new tests for `NewEventModal` (edit mode) and updated `EventDetail`

## Feature Flag

No feature flag needed — this is a pure UX improvement (editing is a missing capability, not a behaviour toggle). The existing `calendarDriveFilePicker` flag is unrelated and untouched.

## Known Risks and Edge Cases

- **Reminders on edit:** We do not delete existing linked reminders when the event is updated. Reminders are already independently managed via `EventDetail`. Hiding the reminder section in edit mode prevents creating duplicates.
- **`allDay` date handling:** The `toLocal` helper in `NewEventModal` that converts ISO strings to `datetime-local` format must behave correctly when editing existing events, which already store times in UTC ISO format — it already does, via `new Date(prefill.startTime)` which we will mirror.
- **`prefill` vs `existingEvent`:** The existing `prefill` prop is typed as `ParsedIcsEvent` (ICS import). We keep that prop for ICS import and add a separate `existingEvent: EventResponse` prop. When `existingEvent` is set, its fields take precedence for initialising state and the `onUpdate` handler is used.
- **Submit routing:** `handleSubmit` will check whether `existingEvent` is set and call either `onUpdate` or `onCreate` accordingly.

## Acceptance Criteria

- [ ] Clicking an event opens `EventDetail` with an "Edit" button.
- [ ] Clicking "Edit" opens `NewEventModal` with all fields (title, start, end, all-day, location, description, attendees) pre-populated from the event.
- [ ] Saving calls `calendarApi.updateEvent` and invalidates the `['events']` cache.
- [ ] The modal title reads "Edit Event" and the submit button reads "Save Changes".
- [ ] The reminders section is not shown when editing.
- [ ] Creating a new event still works exactly as before.
- [ ] TypeScript compiles without errors.
- [ ] All existing and new tests pass.
