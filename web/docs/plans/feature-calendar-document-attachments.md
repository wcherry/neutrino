# Plan: Calendar Document Attachments

## Branch
`feature/calendar-document-attachments` in `neutrino-web`

## What is Changing and Why

Calendar events already support two attachment types in the backend and frontend:
- **Notes** — inline text blobs stored on the attachment record
- **Files** — a reference to a Drive file ID

The file attachment UI in `EventDetail.tsx → AddAttachmentModal` currently shows a raw
text input asking the user to type a Drive file ID manually. This is unusable in practice.
We need to replace that input with a proper Drive file picker so users can browse their
Drive and select a document to attach.

## Affected Layers

| Layer | Change |
|---|---|
| **Backend (neutrino-calendar)** | None — API is already complete |
| **Frontend (neutrino-web)** | New `DriveFilePicker` modal + update `AddAttachmentModal` |
| **Design** | Styles for `DriveFilePicker` modal (search, folder nav, file list) |
| **Tests** | Unit tests for `DriveFilePicker` component |

## Architecture

### New component: `DriveFilePicker`
Location: `apps/web/src/app/(apps)/calendar/DriveFilePicker.tsx`

Responsibilities:
- Opens as a `Modal` (size="lg")
- Fetches root Drive contents via `filesystemApi.getRootContents()`
- Allows navigating into subfolders via `filesystemApi.getFolderContents()`
- Renders a breadcrumb trail for folder navigation
- Shows a search/filter input (client-side filter of loaded files by name)
- Lists files and folders in a scrollable list view
- Clicking a folder navigates into it; clicking a file selects and confirms it
- Returns `{ id: string; name: string }` to the caller via `onSelect`

### Updated component: `AddAttachmentModal` in `EventDetail.tsx`
- Remove the raw file ID input and optional "Name" field
- Replace with a "Browse Drive" button that opens `DriveFilePicker`
- Show the selected file's name (with an X to clear the selection) once chosen
- The `name` field in `CreateAttachmentRequest` is populated with the file's Drive name

### Feature flag
`feature.calendar.driveFilePicker` — env var `NEXT_PUBLIC_FEATURE_CALENDAR_DRIVE_FILE_PICKER`

When **off**: the `AddAttachmentModal` File tab shows the old raw file ID text input (unchanged behaviour).
When **on**: the File tab shows the Drive file picker button.

Default: **off**

## Known Risks / Edge Cases

- Drive API may return many files; we fetch up to 200 and do client-side search.
  Good enough for MVP; pagination can be a follow-up.
- If the user has no Drive files, the picker shows an empty state.
- Folder navigation requires separate API calls — we re-fetch on each folder enter.
- The picker does not need to handle E2EE files specially; it just captures the file ID.

## Acceptance Criteria

- [ ] Clicking "File" tab in Add Attachment → shows "Browse Drive" button (flag on)
- [ ] Clicking "Browse Drive" opens a modal with Drive file/folder list
- [ ] Typing in the search field filters the visible files by name
- [ ] Clicking a folder navigates into it; breadcrumb trail updates
- [ ] Clicking a file closes the picker and populates the selected file name
- [ ] Clicking "Add" submits with `fileId` and `name` correctly set
- [ ] Attachment appears in the event detail panel after save
- [ ] With flag off, the raw file ID input is still shown (no regression)
- [ ] Unit tests for DriveFilePicker: renders files, filters by search, navigates folder

## Feature Flag

Name: `feature.calendar.driveFilePicker`
Env var: `NEXT_PUBLIC_FEATURE_CALENDAR_DRIVE_FILE_PICKER`
Default: `false`
