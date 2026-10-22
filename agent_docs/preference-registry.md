# Preference registry — the key list

**Status:** implemented in Stage 1 of [`ui-roadmap.md`](ui-roadmap.md); the organisation and team
layers in Stage 3. The list below is `web/packages/preferences/src/registry.json`;
`src/preferences/catalog.rs` is the server's copy of its plain tier, and
`the_catalog_matches_the_registry` fails when the two drift — in a key, its type or its scopes.
Architecture: [`ui-customization-roadmap.md`](ui-customization-roadmap.md) §3.1–3.2.

**Scopes are enforced (Stage 3).** A user write to a key without `user` is refused (400
`NOT_A_USER_PREFERENCE`), and so is one to a key an administrator has locked (403
`PREFERENCE_LOCKED`); an admin default for a key without `org` (400 `NOT_AN_ORG_PREFERENCE`) and a
team default for one without `team` (400 `NOT_A_TEAM_PREFERENCE`) likewise. Org defaults and locks
live in `org_preferences` (written through `PATCH /api/v1/admin/preferences`), team defaults in
`team_preferences` (`PATCH /api/v1/drive/teams/{id}/preferences`, Owners and Admins). Every user's
`GET /api/v1/preferences` carries both layers, and the store resolves
`org lock → device → user → team (inside its space) → org default → default`. The org layer also
comes with every page the server serves (`__NEUTRINO_INSTANCE__`, `src/branding/inject.rs`), so the
anti-FOUC script applies a lock or a newer org default before first paint; the boot record's `$own`
list says which values are the user's own and must not be replaced by an org default.

This is every value the web client keeps in `localStorage`/`sessionStorage` today, sorted into
what becomes a **preference** in the registry, what becomes **personal library content** in the
encrypted tier, and what **stays device-local because it is not a preference at all** — with the
reason for each. A key not listed here is a bug in this document; the Stage 1 tests should fail on
any `localStorage` read outside the registry and the device-local allowlist in §3.

Columns: **Scopes** — who may set it (`org` default/lock, `team` default, `user`, `device`).
**Sync** — `plain` (server-readable, validated), `encrypted` (sealed with the user's key),
`device` (never leaves the browser). **Paint** — applied before first paint from the boot cache.

---

## 1. Preferences

| Registry key | Legacy key | Type | Default | Scopes | Sync | Paint | Notes |
|---|---|---|---|---|---|---|---|
| `appearance.theme` | `neutrino.theme` (+ `user_profiles.theme` server-side) | `ThemeChoice` (`system`, the presets, `custom-<id>`) | `system` | org, user | plain | ✓ | Ends the dual write: the server column becomes this row. A per-device override (`device` scope, so one machine can stay on `system`) is planned, not built. |
| `appearance.look` | — *(new)* | `classic` \| `lightflow` \| `precision` \| `blended` | `classic` until the default flips (roadmap stage 5) | org, user | plain | ✓ | `classic` is today's UI, kept selectable until stage 6. Chosen in Settings › Appearance (stage 3); the three new looks also switch the shell. |
| `appearance.density` | — *(new)* | `compact` \| `comfortable` \| `spacious` | `comfortable` | org, team, user | plain | ✓ | Feeds `--row-height`; windowed lists re-measure on change. A team default applies inside its space. No control yet (stage 4, U2). |
| `appearance.textSize` | — *(planned, stage 4)* | `sm` \| `md` \| `lg` | `md` | org, user, device | plain | ✓ | Not in the registry yet. |
| `appearance.accent` | — *(planned, stage 4)* | hex colour | look's accent | org, team, user | plain | ✓ | Not in the registry yet. Contrast-adjusted by the engine, never stored adjusted. The instance's brand accent (Admin › Organisation) is separate: it is branding, injected by the server. |
| `a11y.reduceMotion` | — *(planned, stage 4; today the OS query only)* | `system` \| `on` \| `off` | `system` | user, device | plain | ✓ | Not in the registry yet. |
| `a11y.reduceTransparency` | — *(planned, stage 4)* | `system` \| `on` \| `off` | `system` | org, user, device | plain | ✓ | Not in the registry yet. Frosted surfaces fall back to opaque. |
| `shell.sidebarCollapsed` | `neutrino.sidebar.collapsed` | boolean | `false` | user, device | device | ✓ | Device: a laptop and a wide monitor want different answers. Stays in the boot cache so it doesn't flash. |
| `calendar.weekStart` | `neutrino:calendar:weekStart` | 0–6 | 0 (Sunday) | org, user | plain | | |
| `calendar.dayStartHour` | `neutrino:calendar:dayStartHour` | 0–23 | 8 (`DEFAULT_DAY_START_HOUR`) | user | plain | | |
| `calendar.dayEndHour` | `neutrino:calendar:dayEndHour` | 1–24, > start | 20 (`DEFAULT_DAY_END_HOUR`) | user | plain | | Validated against `dayStartHour` as a pair. |
| `docs.spellCheck` | `neutrino.spellCheck` | boolean | `true` | org, user | plain | | |
| `docs.splitParagraphs` | `neutrino:docs:splitParagraphs` | boolean | `false` | user | plain | | Whether a paragraph may break across pages. |
| `photos.autoFaceDetect` | `neutrino:photos:autoFaceDetect` | boolean | `false` | org, user | plain | | An org lock to *off* is a real privacy policy. |
| `drawing.brush` | `neutrino:drawing:brush` | brush object, repaired by `clampBrush` | built-in brush | user | plain | | Already "never in the document"; now it follows the user. |
| `search.syncDisabled` | `neutrino:search:syncDisabled` | boolean | `false` | device | device | | Turns off this browser's index snapshot exchange; device by nature. An org lock forbidding the encrypted snapshot upload is planned, not built — a device key cannot take an org layer as the store stands. |
| `keyboard.preset` | — *(new, stage 2)* | `neutrino` \| `google` \| `microsoft` | `neutrino` | org, user | plain | | The starting keymap (`PRESETS` in `@neutrino/commands`); each preset changes only the commands where that suite differs. |
| `keyboard.bindings` | — *(new, stage 2)* | object, command id → chords, ≤ 8 KB | `null` (no changes) | user | plain | | Only the user's departures from the preset; an empty list unbinds. Read through `sanitizeBindings`, which drops ids no longer in the command catalog and chords that do not parse, so a stale binding is never dispatched. Edited in Settings › Keyboard. |
| `ai.provider` | `neutrino.ai.settings` (`provider`) | `gemini` \| `claude` \| `openai` | `gemini` (current) | org, user | plain | | An org default or lock picks the provider. Turning AI off entirely (`none`) is planned, not built. |
| `apps.enabled` | — *(new, stage 3)* | a set of apps (`docs`, `sheets`, `slides`, `notes`, `diagrams`, `drawing`, `photos`, `calendar`) | all of them | org | plain | | Which apps the instance offers (roadmap §6.3). Hides an app from the sidebar, the New menu and the command palette; does not 404 its routes. Admin › Organisation › Apps. |
| `teamSpace.view` | — *(new, stage 3)* | `large` \| `small` \| `list` | `large` | team, user | plain | | A team space's Files view (T2). A member's own pick becomes theirs, in every space. |
| `teamSpace.sort` | — *(new, stage 3)* | `name` \| `size` \| `createdAt` \| `updatedAt` | `name` | team, user | plain | | As above. |
| `teamSpace.sortDirection` | — *(new, stage 3)* | `asc` \| `desc` | `asc` | team, user | plain | | As above. |
| `ai.apiKey` | `neutrino.ai.settings` (`apiKey`) | string | `''` | user | **encrypted** | | Leaves plaintext `localStorage` (roadmap U12). `readAiSettings` in `@neutrino/api-core` keeps its signature and reads through the registry. |

## 2. Personal library content (encrypted tier)

Not preferences — things the user made. They move into the encrypted blob in stage 1 (roadmap U11)
and become publishable to a team in stage 6 (T4).

| Library | Legacy key | Shape | Reader |
|---|---|---|---|
| Conditional-format templates | `neutrino:sheets:cf-templates` | template[] | `sheets/editor/ConditionalFormattingDialog.tsx` |
| Conditional-format variables | `neutrino:sheets:cf-variables` | variable[] | same, and `SheetEditor.tsx` |
| Gradient presets — slides | `neutrino:slides:gradientPresets` | preset[] | `FillPicker` (`presetsKey` prop) |
| Gradient presets — diagrams | `neutrino:diagrams:gradientPresets` | preset[] | same |
| Gradient presets — default | `neutrino:bg:gradientPresets` | preset[] | `FillPicker` default |
| Fill presets — drawing | `neutrino:drawing:fillPresets` | preset[] | `drawing/editor/StylePanel.tsx` |
| Shape-library config — custom libraries, hidden built-in and third-party libraries, order | `neutrino:diagrams:shapeLibraries` → `library.diagrams.shapeLibraries` | one object, as the editor stores it | `diagrams/editor/shapes/useShapeLibraries.ts` |

The shape-library config was planned as two plain lists plus the custom libraries, and kept whole
instead: the editor treats hidden built-ins, hidden third-party libraries and order as one record,
and splitting the hidden lists would have lost which ids were built-in.

`FillPicker` lives in `@neutrino/ui`, which has no API dependency; it takes the presets through
`presets`/`onPresetsChange` props (falling back to `presetsKey` in `localStorage` when a caller
passes neither), the same pattern as `ImagePickerDialog`. Until the vault opens, `useLibrary` /
`readVaultOrLegacy` show a library's legacy copy so it does not flash empty.

## 3. Stays device-local — not a preference

These must **not** move into the registry or sync, and the stage 1 lint allowlist names them.

| Key | Why it stays on the device |
|---|---|
| `access_token`, `refresh_token` | The session. Syncing a credential is the opposite of the point. |
| E2EE key pins (`storeKey(ownerId)` in `e2e-crypto/src/pinning.ts`) | Trust-on-first-use pins exist precisely so the *server* cannot substitute a key; a pin served from the server protects nothing. |
| `neutrino:search:deviceId`, `…:lastSync:<user>`, `…:contentVersion:<user>`, `…:snapshotVersion:<user>`, `…:snapshotFingerprint:<user>` | Machine state of this browser's IndexedDB index and its snapshot exchange. |
| `neutrino:notified-reminders` | Which reminders this browser has already notified for — per-device by definition. |
| `neutrino:diagram-template:<id>`, `neutrino:sheet-template:<id>` | One-shot handoff from a template picker to the editor it opens. |

Not storage at all, listed so nobody migrates them: `neutrino:access-revoked` and
`neutrino:drive-changed` are `window` events.

## 4. Migration rules for stage 1

1. On first load with the registry, each legacy key in §1–2 is read **once**, validated against its
   registry type and written through the store — and **deleted only once the server has confirmed
   the save**. A failed save leaves the legacy key for the next load to retry; deleting it as soon as
   the value was in memory is how a busy server ("database is locked") once lost the AI key in
   testing. Only one migration runs at a time per store (sign-in and unlock both start one).
2. A value that fails validation is dropped and the default applies; the drop is logged
   (`[prefs:migrate]`), not surfaced.
3. `appearance.theme`: if `localStorage` and `user_profiles.theme` disagree, the browser's value
   wins for that migration — it is what the user is looking at.
4. `ai.apiKey` is written to the encrypted tier only when the session holds a keypair; otherwise it
   stays where it is until encryption is set up (customization roadmap, open question 1).
5. Libraries merge rather than replace: a user with presets on two browsers ends up with both sets,
   de-duplicated by content.
