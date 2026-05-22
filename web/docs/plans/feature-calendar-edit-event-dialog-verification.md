# Manual Verification: Calendar Edit Event Dialog

## Prerequisites
- [ ] Dev server running (`pnpm dev` in `neutrino-web`)
- [ ] At least one calendar event already created

## Steps to Verify

### Happy Path — Edit an Existing Event
1. Open the Calendar app.
2. Click any existing event. The EventDetail panel opens in the right sidebar.
3. Verify an **Edit** button is visible alongside the **Delete Event** button.
4. Click **Edit**.
5. Verify the modal title reads **"Edit Event"** (not "New Event").
6. Verify all fields are pre-populated: title, start time, end time, all-day checkbox, location, description, and any attendees.
7. Verify the **Reminders** section is not shown.
8. Verify the submit button reads **"Save Changes"** (not "Create Event").
9. Change the title and/or location.
10. Click **Save Changes**.
11. Verify the modal closes.
12. Verify the event in the calendar grid reflects the updated title.
13. Click the event again — verify the EventDetail panel shows the updated values.

### Edit with All Fields
1. Create a new event with title, location, description, and at least two attendees.
2. Click **Edit** on that event.
3. Confirm every field is pre-populated correctly.
4. Edit each field (change title, location, description, remove one attendee, add a new one).
5. Save and re-open the event to confirm all changes persisted.

### All-Day Event Editing
1. Create an all-day event.
2. Click **Edit** — verify the all-day checkbox is pre-checked and the date pickers show date-only format.
3. Save without changes and confirm no data is corrupted.

### Cancel Edit
1. Click **Edit** on an event.
2. Change the title.
3. Click **Cancel**.
4. Verify the modal closes and the event is unchanged.

### Create Flow Still Works
1. Click the **New Event** toolbar button.
2. Verify the modal title reads **"New Event"**.
3. Verify the **Reminders** section is visible.
4. Verify the submit button reads **"Create Event"**.
5. Fill in the form and create an event — confirm it appears on the calendar.

### ICS Import Still Works
1. Drop a `.ics` file onto the calendar area.
2. Verify the modal opens in create mode with the ICS fields pre-filled.
3. Verify the Reminders section is still shown.

### Edge Cases
- Edit an event with no location or description — verify those fields are empty (not showing "null").
- Edit an event with no attendees — verify the attendees list is empty.
- Leave the title blank in edit mode and try to save — verify nothing is submitted.

## Expected Results
- Edit button is always visible on the EventDetail panel.
- The same modal component handles both create and edit flows.
- Saving an edit calls PUT `/api/v1/events/:id` (visible in Network tab).
- Creating an event calls POST `/api/v1/events` (unchanged).
- The EventDetail panel remains open after a save, showing updated data.

## Rollback
No feature flag is used for this change. To roll back, revert the `feature/calendar-edit-event-dialog` branch.
