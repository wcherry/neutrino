# Manual Verification: Calendar Drive File Picker

## Prerequisites
- [ ] App running locally (`pnpm dev`)
- [ ] Logged in with a user who has Drive files
- [ ] At least one file and one folder exist in Drive

## Steps to Verify

### Happy Path — selecting a file

1. Open the Calendar app
2. Click on any event to open the event detail panel
3. Click the "+" (Plus) button next to "Attachments"
4. In the Add Attachment modal, click the "File" tab
5. Verify: a "Browse Drive…" button is shown (no raw text inputs)
6. Click "Browse Drive…"
7. Verify: the DriveFilePicker modal opens with title "Browse Drive"
8. Verify: root Drive contents load — folders appear with folder icons, files appear with file icons
9. Verify: a breadcrumb shows "My Drive" as the current location
10. Type a partial filename in the search/filter box
11. Verify: the list filters to show only matching items
12. Clear the search box
13. Click a folder
14. Verify: the folder's contents load; the breadcrumb updates to show "My Drive > FolderName"
15. Click "My Drive" in the breadcrumb
16. Verify: root contents are shown again
17. Click a file
18. Verify: the DriveFilePicker closes and the Add Attachment modal now shows the filename in a chip
19. Verify: an X button is visible on the chip
20. Click "Add"
21. Verify: the attachment appears in the event detail with the file's name

### Clearing a selection

1. Follow happy path steps 1–18 above
2. Click the X on the filename chip
3. Verify: the chip is replaced by the "Browse Drive…" button again

### Cancel picker without selecting

1. Open the DriveFilePicker (steps 1–6 in happy path)
2. Click "Cancel" in the picker
3. Verify: picker closes, Add Attachment modal is still open, no file is selected

### Cancel Add Attachment modal

1. Open Add Attachment modal, switch to File tab
2. Click "Browse Drive…", select a file
3. Click "Cancel" in the Add Attachment modal
4. Verify: no attachment is added to the event

### Empty folder state

1. Navigate into a folder that has no subfolders or files
2. Verify: an "This folder is empty" empty state is shown in the list area

### No search results

1. Open the picker, type a search term that matches nothing
2. Verify: "No matches" empty state appears

### Loading state

1. Open the picker on a slow connection (or throttle in DevTools)
2. Verify: a spinner is shown while contents are loading

## Expected Results
- "Browse Drive…" button in File tab replaces the raw "File ID" and "Name" inputs
- Picker opens as a modal on top of the Add Attachment modal
- Breadcrumb navigation works correctly in both directions
- Search filter is client-side and instant
- Selected file name is shown in the chip; form submits with correct `fileId` and `name`
- Cancel / X at any step does not corrupt state — reopening the picker shows root again

## Rollback
This change is a direct replacement — there is no feature flag. To revert, check out the `main` branch or revert the PR.
