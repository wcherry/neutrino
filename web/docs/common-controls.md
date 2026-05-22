# Common Controls Inventory

Last updated: 2026-05-20

This inventory summarizes the common UI controls used across the Neutrino web project. The main source of reusable controls is `packages/ui/src`, with shell-level controls in `packages/layout/src` and several recurring app-specific controls in `apps/web/src`.

## Shared UI Package Controls

These controls are exported from `packages/ui/src/index.ts` and are intended for reuse across the app.

### Primitives

| Control | Source | Common use |
| --- | --- | --- |
| `Button` | `packages/ui/src/components/primitives/Button.tsx` | Primary, secondary, ghost, and danger actions. Supports `sm`, `md`, `lg`, loading state, and optional left/right icon. |
| `Text` | `packages/ui/src/components/primitives/Text.tsx` | Body copy, muted metadata, truncating file names, labels, and small helper text. |
| `Heading` | `packages/ui/src/components/primitives/Heading.tsx` | Page titles, section headings, and dialog headings. |
| `Link` | `packages/ui/src/components/primitives/Link.tsx` | Styled navigation or inline links. |
| `Divider` | `packages/ui/src/components/primitives/Divider.tsx` | Visual separation between groups or sections. |
| `Badge` | `packages/ui/src/components/primitives/Badge.tsx` | Counts, statuses, roles, resource types, and small metadata chips. |
| `Avatar` | `packages/ui/src/components/primitives/Avatar.tsx` | User identity in topbar, share dialogs, and profile surfaces. |
| `Icon` | `packages/ui/src/icons/Icon.tsx` | Shared icon wrapper where a normalized icon surface is needed. |

### Inputs

| Control | Source | Common use |
| --- | --- | --- |
| `TextInput` | `packages/ui/src/components/inputs/TextInput.tsx` | Text fields with labels, hints, errors, optional icons, and full-width layout. |
| `Textarea` | `packages/ui/src/components/inputs/Textarea.tsx` | Multi-line text entry with shared form styling. |
| `Select` | `packages/ui/src/components/inputs/Select.tsx` | Native select menus with label, hint, error, placeholder, and standardized sizes. |
| `Checkbox` | `packages/ui/src/components/inputs/Checkbox.tsx` | Boolean or multi-select options, including indeterminate state. |
| `Radio` / `RadioGroup` | `packages/ui/src/components/inputs/Radio.tsx` | Mutually exclusive option groups. |
| `Toggle` | `packages/ui/src/components/inputs/Toggle.tsx` | Switch-style boolean settings with optional label and description. |
| `SearchInput` | `packages/ui/src/components/inputs/SearchInput.tsx` | Search boxes with search icon, subtle/default variants, clear button, and sizes. Used by the app shell topbar. |

### Feedback

| Control | Source | Common use |
| --- | --- | --- |
| `Alert` | `packages/ui/src/components/feedback/Alert.tsx` | Inline status, warning, error, or informational messages. |
| `Toast`, `ToastProvider`, `useToast` | `packages/ui/src/components/feedback/Toast.tsx`, `ToastProvider.tsx` | Temporary global notifications for create, rename, upload, and failure outcomes. |
| `ProgressBar` | `packages/ui/src/components/feedback/ProgressBar.tsx` | Progress and quota-style indicators. |
| `Spinner` | `packages/ui/src/components/feedback/Spinner.tsx` | Loading indicators, including inline and overlay loading states. |
| `Skeleton`, `FileListSkeleton` | `packages/ui/src/components/feedback/SkeletonLoader.tsx` | Placeholder loading states for lists and file grids. |
| `EmptyState` | `packages/ui/src/components/feedback/EmptyState.tsx` | Empty or error state screens with optional action. |

### Containers

| Control | Source | Common use |
| --- | --- | --- |
| `Card`, `CardHeader`, `CardFooter` | `packages/ui/src/components/containers/Card.tsx` | File tiles, quick-access items, share token surfaces, and repeated item cards. |
| `Panel` | `packages/ui/src/components/containers/Panel.tsx` | Bounded layout regions and side panels. |
| `Modal`, `ModalHeader`, `ModalBody`, `ModalFooter` | `packages/ui/src/components/containers/Modal.tsx` | Dialogs for sharing, moving files, calendar events, reminders, attachment picking, settings connections, previews, and help. |
| `Popover` | `packages/ui/src/components/containers/Popover.tsx` | Lightweight anchored overlays with outside-click and Escape dismissal. |
| `Drawer` | `packages/ui/src/components/containers/Drawer.tsx` | Slide-in side or bottom panels. |
| `Tabs`, `TabList`, `Tab`, `TabPanel` | `packages/ui/src/components/containers/Tabs.tsx` | Tabbed settings or grouped views with default and pill variants. |
| `Accordion`, `AccordionItem` | `packages/ui/src/components/containers/Accordion.tsx` | Expandable/collapsible grouped content. |

### Navigation

| Control | Source | Common use |
| --- | --- | --- |
| `Breadcrumbs` | `packages/ui/src/components/navigation/Breadcrumbs.tsx` | Hierarchical navigation paths. |
| `Pagination` | `packages/ui/src/components/navigation/Pagination.tsx` | Paged list navigation. |
| `Menu`, `MenuItem`, `MenuSeparator`, `MenuGroup` | `packages/ui/src/components/navigation/Menu.tsx` | Command menus with icons, shortcuts, active state, disabled state, and danger actions. |
| `HamburgerMenu` | `packages/ui/src/components/navigation/HamburgerMenu.tsx` | Editor menu buttons with actions, separators, nested submenus, shortcuts, and danger actions. Used by Docs and Sheets editors. |
| `Dropdown` | `packages/ui/src/components/navigation/Dropdown.tsx` | Triggered menus backed by `Menu` items or custom children. |

## Shell Controls

These controls live in `packages/layout/src` and appear across the authenticated app shell.

| Control | Source | Common use |
| --- | --- | --- |
| `AppShell` | `packages/layout/src/AppShell.tsx` | Shared application frame for sidebar/topbar layout. |
| `Sidebar` | `packages/layout/src/Sidebar.tsx` | Primary navigation, collapsible nav items, upload entry point, and storage quota indicator. |
| `Topbar` | `packages/layout/src/Topbar.tsx` | Mobile menu toggle, global search, notification/action icon buttons, avatar, and user menu. |

## Recurring Application Controls

These controls are not all part of the shared UI package, but they recur across product surfaces or represent important app-level interaction patterns.

| Control / pattern | Source examples | Common use |
| --- | --- | --- |
| File grid/list picker | `apps/web/src/components/FileGrid/FileGrid.tsx`, `apps/web/src/app/(apps)/drive/page.tsx` | Grid/list display for Drive-like resources, quick access, shared files, and file actions. |
| File context menu | `apps/web/src/app/(apps)/drive/FileContextMenu.tsx`, `FolderContextMenu.tsx` | Right-click actions such as preview, info, share, rename, star, copy link, move, download, and trash. |
| Upload/drop zone | `packages/layout/src/Sidebar.tsx`, `apps/web/src/app/(apps)/drive/UploadZone.tsx`, photo upload modal | File upload via button, hidden file input, and drag-and-drop. |
| Share dialog | `apps/web/src/app/(apps)/drive/ShareDialog.tsx` | Add collaborators, list access, manage links, roles, visibility, expiration, and copy/share actions. |
| Move folder dialog | `apps/web/src/app/(apps)/drive/MoveFolderDialog.tsx` | Modal folder browser for moving files/folders. |
| Preview modal | `apps/web/src/app/(apps)/drive/PreviewModal.tsx`, `apps/web/src/components/DocumentPreviewModal/DocumentPreviewModal.tsx` | In-app previews for documents, spreadsheets, presentations, notes, archives, and files. |
| Info side panels | `apps/web/src/app/(apps)/drive/FileInfoPanel.tsx`, `apps/web/src/app/(apps)/photos/PhotoInfoPanel.tsx` | Metadata panels for selected files/photos, with headings, text rows, and loading states. |
| Editor toolbar | `apps/web/src/app/(apps)/docs/editor/Toolbar.tsx`, `apps/web/src/app/(apps)/sheets/editor/StyleToolbar.tsx` | Dense command bars for undo/redo, fonts, sizing, formatting, colors, alignment, list/table tools, merge, and number formats. |
| Editor menu bar | `apps/web/src/app/(apps)/docs/editor/MenuBar.tsx`, `apps/web/src/app/(apps)/sheets/editor/components/HamburgerMenu.tsx` | Top-level editor menus with nested commands and help/export actions. |
| Color picker | `apps/web/src/app/(apps)/sheets/editor/ColorPicker.tsx`, docs toolbar color inputs | Swatches/custom color selection for text, fill, highlight, and cell styling. |
| Formula bar and sheet tabs | `apps/web/src/app/(apps)/sheets/editor/components/FormulaBar.tsx`, `SheetTabBar.tsx` | Spreadsheet-specific controls for formulas, active cell display, and sheet navigation. |
| Calendar event/reminder dialogs | `apps/web/src/app/(apps)/calendar/NewEventModal.tsx`, `ReminderModal.tsx`, `EventDetail.tsx` | Modal forms for events, reminders, recurrence, attendees, attachments, and event detail actions. |
| Drive file picker | `apps/web/src/app/(apps)/calendar/DriveFilePicker.tsx` | Modal picker for attaching Drive files to calendar events. |
| Comments/version panels | `apps/web/src/components/CommentsPanel/CommentsPanel.tsx`, `VersionHistoryPanel/VersionHistoryPanel.tsx` | Document collaboration panels for comments and historical revisions. |
| Avatar picker | `apps/web/src/app/(apps)/profile/AvatarPickerDialog.tsx` | Profile avatar selection via initials or available avatar options. |

## Usage Notes

- Prefer `@neutrino/ui` controls for common primitives, form elements, feedback states, modals, menus, and cards.
- App-specific editors currently use several local toolbar, select, color, and context-menu patterns because their interactions are dense and domain-specific.
- Several calendar and editor forms still use native `input`, `select`, `textarea`, and `checkbox` elements with local CSS classes; these are candidates for gradual alignment with shared `TextInput`, `Select`, `Textarea`, and `Checkbox` where behavior permits.
- Shell-level navigation/search/user controls are centralized in `@neutrino/layout`, not `@neutrino/ui`.
