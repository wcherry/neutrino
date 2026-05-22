# Plan: Calendar Drive File Picker

## Branch
`feature/calendar-drive-file-picker`

## What is changing and why

The `AddAttachmentModal` in `EventDetail.tsx` currently shows a raw "File ID" text input in its "File" tab. This is unusable without knowing Drive internal IDs. We are replacing it with a visual `DriveFilePicker` dialog that lets users browse their Drive, navigate folders, filter by name, and click a file to select it.

## Layers affected

- **Frontend logic** — new `DriveFilePicker` component, React Query hooks for `getRootContents`/`getFolderContents`, breadcrumb state machine, filter state
- **UI/visual design** — file/folder list item styling, breadcrumb trail in picker, loading/empty states, "Browse Drive" button + selected-file chip in `AddAttachmentModal`
- **Tests** — unit tests for the picker's folder navigation and filter logic

## Files to create/modify

### New file
- `apps/web/src/app/(apps)/calendar/DriveFilePicker.tsx`

### Modified files
- `apps/web/src/app/(apps)/calendar/EventDetail.tsx` — replace File tab raw inputs with Browse button + selected-file chip
- `apps/web/src/app/(apps)/calendar/page.module.css` — add picker-specific CSS classes

## API details

From `@/lib/api` (re-exports `@neutrino/api-drive`):

```ts
filesystemApi.getRootContents()   // returns FolderContentsResponse { folder: null, folders: Folder[], files: FileItem[], shortcuts: unknown[] }
filesystemApi.getFolderContents(folderId: string)  // same shape, folder is non-null
```

Types:
- `FileItem` — `{ id, name, mimeType, sizeBytes, ... }`
- `Folder`   — `{ id, name, parentId, color, ... }`

## DriveFilePicker component API

```tsx
interface DriveFilePickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (file: { id: string; name: string }) => void;
}
```

## DriveFilePicker internal behaviour

1. On open, fetch root: `useQuery(['drive-picker', null], () => filesystemApi.getRootContents())`
2. `currentFolderId: string | null` — null = root
3. `breadcrumbs: Array<{ id: string | null; name: string }>` — always starts with `{ id: null, name: 'My Drive' }`
4. Clicking a folder: push to breadcrumbs, set `currentFolderId` to folder id
5. Clicking a breadcrumb: pop stack back to that point
6. Filter input filters displayed folders+files by name (client-side, case-insensitive)
7. Clicking a file: call `onSelect({ id: file.id, name: file.name })`, then `onClose()`
8. Cancel button: call `onClose()`
9. Loading state: spinner centered in list area
10. Empty state (no items after filter): "No files here" message

## AddAttachmentModal changes

In the File tab, replace the two raw inputs with:
- If no file selected: a "Browse Drive…" button (secondary variant), opens picker
- If file selected: a chip showing filename with an X clear button
- On form submit: use the selected file's `id` and `name`
- Remove the separate "Name (optional)" input — use the file's name directly

## UI primitives to use

From `@neutrino/ui`:
- `Modal`, `ModalHeader`, `ModalBody`, `ModalFooter` — picker dialog shell
- `Button` — Cancel, Browse Drive
- `Spinner` — loading state
- `EmptyState` — empty folder / no search results

Icons from `lucide-react` (already installed):
- `Folder` — folder items
- `FileText` — file items
- `ChevronRight` — breadcrumb separator
- `Search` — search input prefix
- `X` — clear file selection

## CSS approach

Reuse existing classes from `page.module.css`:
- `.formGroup`, `.formLabel`, `.formInput` — for the filter input
- `.reminderActionBtn`, `.reminderActionDelete` — for clear button

New classes to add to `page.module.css`:
- `.drivePickerList` — scrollable file list container
- `.drivePickerItem` — individual row (folder or file)
- `.drivePickerItemIcon` — icon wrapper
- `.drivePickerBreadcrumb` — breadcrumb bar
- `.drivePickerBreadcrumbSep` — separator between crumbs
- `.drivePickerBreadcrumbBtn` — clickable crumb
- `.drivePickerSearch` — search bar wrapper
- `.drivePickerSelectedFile` — the selected-file chip in AddAttachmentModal
- `.drivePickerClearBtn` — X button on the chip

## Acceptance criteria

- [ ] Clicking "Browse Drive…" opens the picker modal
- [ ] Root folder contents load (folders + files)
- [ ] Clicking a folder navigates into it, breadcrumb updates
- [ ] Clicking a breadcrumb navigates back
- [ ] Typing in the search box filters the visible list
- [ ] Clicking a file closes the picker and shows the filename chip
- [ ] Clicking X on the chip clears the selection and shows the button again
- [ ] Submitting the form passes `{ fileId, name }` to `onCreate`
- [ ] Loading state shown while fetching
- [ ] Empty state shown when folder has no items (or no search matches)
- [ ] TypeScript compiles cleanly
