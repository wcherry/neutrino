# Manual Verification: Calendar Document Attachments

## Prerequisites
- [ ] Feature flag `feature.calendar.driveFilePicker` enabled:
  set `NEXT_PUBLIC_FEATURE_CALENDAR_DRIVE_FILE_PICKER=true` in `apps/web/.env.local`
- [ ] At least a few files and one folder exist in your Drive (neutrino-drive service running)
- [ ] The neutrino-calendar service is running and reachable

## Steps to Verify

### Happy Path — Attach a Drive file to an event

1. Open the Calendar app.
2. Create or click an existing event to open the Event Detail panel.
3. In the Attachments section, click the **+** button to open "Add Attachment".
4. Click the **File** tab.
5. Verify the UI shows a **Browse Drive…** button (not a raw file ID input).
6. Click **Browse Drive…**.
7. Verify the Drive file picker modal opens and shows your Drive files and folders.
8. Type a partial filename in the search box.
9. Verify the list filters in real-time to show only matching files.
10. Clear the search. Click a **folder** to navigate into it.
11. Verify the breadcrumb updates to show `My Drive > <Folder Name>`.
12. Click on a **file** in the picker.
13. Verify the picker closes and the selected filename appears in the "Add Attachment" modal.
14. Click **Add**.
15. Verify the attachment appears in the event detail with the file's name.

### Happy Path — Attach a text note

1. Open Add Attachment for an event.
2. Click the **Note** tab.
3. Type some text and click **Add**.
4. Verify the note appears in the Attachments section of the event detail.

### Folder navigation

1. Open the Drive picker.
2. Navigate into a subfolder.
3. Click the **My Drive** breadcrumb.
4. Verify you are returned to root and see the root-level files/folders.

### Clearing a selected file

1. Open the Drive picker and select a file.
2. The file name is shown with an **X** button.
3. Click the **X** to clear the selection.
4. Verify the "Browse Drive…" button is shown again.
5. Click **Add** — verify it does NOT submit (button is disabled).

### Empty Drive folder

1. Navigate into an empty folder in the picker.
2. Verify a "This folder is empty" message is shown.

### Search with no match

1. Open the picker and type a string that matches nothing.
2. Verify the empty state message is shown.

### Deleting an attachment

1. After attaching a file, click the X next to it in the event detail.
2. Verify the attachment is removed.

## Feature Flag Off

1. Remove or set `NEXT_PUBLIC_FEATURE_CALENDAR_DRIVE_FILE_PICKER=false`.
2. Restart the dev server.
3. Open the "Add Attachment → File" tab.
4. Verify the old **File ID** text input and optional **Name** field are shown.
5. Enter a Drive file ID manually and click **Add** — verify it attaches.
6. Re-enable the flag and restart to continue using the picker.

## Expected Results

| Step | Expected |
|---|---|
| "File" tab with flag ON | "Browse Drive…" button, no raw ID input |
| Drive picker opens | Modal with search bar, breadcrumbs, and file list |
| Search | Real-time client-side filter |
| File clicked | Picker closes, file name shown in attachment modal |
| Add submitted | Attachment appears in event detail |
| Flag OFF | Raw File ID and Name inputs shown, old behaviour intact |

## Rollback

Set `NEXT_PUBLIC_FEATURE_CALENDAR_DRIVE_FILE_PICKER=false` and restart the server.
No database migrations are involved — instant rollback.
