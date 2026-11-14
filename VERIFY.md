# Manual Verification: Folder link sharing (#321)

## Prerequisites
- Stack running locally via `docker-compose-dev.yml`
- An owner account with encryption set up and unlocked in this browser
- A second browser profile or a private window, signed out, to play the guest

## Steps

### Happy Path
1. As the owner, in My Drive create a folder **Shared test** and upload two files into it, one in a
   subfolder.
2. Open **Share** on the folder → **Create link**. Expect the notice "Anyone with the link can open
   and download the files…" and "Preparing files for the link…", which clears within a few seconds.
3. Change **Anyone with link can** to **Editor**. The notice changes to "…add, rename, move and delete
   files in this folder…".
4. **Add password** → `hunter22` → Save. The row reads "Password: Required".
5. **Copy link**. The URL ends in `#k=` followed by 43 characters.
6. In the private window, open the link. Expect "This link needs a password", with no folder name.
7. Enter `wrong` → "That password is not right." Enter `hunter22` → the folder opens with its files
   and subfolder.
8. Click a file → it downloads and opens correctly (decrypted).
9. Click **Upload**, pick a file → "Uploaded …"; it appears in the list.
10. **New folder** → `From guest` → it appears. Rename it to `From guest 2`. Delete a file → **Delete**.
11. As the owner, reload My Drive → the guest's upload is there and opens; `From guest 2` is there;
    the deleted file is in **Trash** and restores.

### Edge Cases
1. **Link copied without the key**: open the URL with everything after `#` removed → "This link is
   incomplete…", no listing.
2. **Damaged key**: change one character after `#k=` → "This link is damaged…".
3. **Turn off**: owner clicks **Turn off** → the guest's next click says "This link is no longer
   open…".
4. **Password change**: owner changes the password → the guest's next action fails; reopening the
   link asks for the new password.
5. **Too many wrong passwords**: ten wrong attempts → "Too many wrong passwords…" for about 15
   minutes, even with the right one.
6. **View-only**: set the link to **Viewer** → the guest sees no Upload, New folder, rename or
   delete controls.
7. **Outside the folder**: the guest cannot reach the owner's other files. Try
   `GET /api/v1/drive/files/<other file id>` with the guest token → refused.
8. **Member upload into a link-shared folder**: upload a file as the owner into the folder from
   My Drive; the guest can open it without the owner reopening the Share dialog.
9. **File added by a native client**: upload into the folder from the iOS app. The guest sees the
   file but "is not ready to open through this link yet". After the owner opens the Share dialog,
   it opens.
10. **Old folder link**: a folder link made before this change shows "This link was made before
    folder links carried a key…" → **Add a key to this link**; the old token keeps working.
11. **Signed-in visitor**: open the link in a window where another account is signed in → after
    browsing, that account's own Drive is still signed in and unchanged.

### Cleanup
Delete this section once the feature is proven stable.

---

# Manual Verification: Self-contained uploads (neutrino_drive_ios_mobile#38)

Delete this section once the Drive iOS photo sync has shipped on it and proven stable. Design:
`neutrino_drive_ios_mobile/agent_docs/research/2026-10-09-photo-sync-latency.md`, Phase 1.

## Prerequisites
- Backend running locally (`cargo run`, or docker-compose-dev.yml)
- An account with an access token in `$T`, and two published keys: `POST /api/v1/auth/keys`
  twice with different 32-byte base64url `publicKey` values, so version 1 is retired and 2 active
- Any small file at `./f.bin`

## Steps

### Happy Path
1. `curl -s localhost:8080/api/v1/drive/files/upload -H "Authorization: Bearer $T" -F encrypted_file_key=sealed -F key_version=2 -F created_at=2014-03-01T12:00:00Z -F updated_at=2014-03-02T08:30:00Z -F import_source=photo-sync:test -F "file=@f.bin"`
2. The response has `createdAt` `2014-03-01T12:00:00`, `updatedAt` `2014-03-02T08:30:00`,
   `importSource` `photo-sync:test` and a non-null `importedAt`.
3. `GET /api/v1/drive/files/{id}/key` returns `encryptedFileKey: "sealed"`, `keyVersion: 2`,
   with no `PUT /key` ever sent.

### Edge Cases
1. Retired key: repeat with `key_version=1` → 200, and `GET /key` shows `keyVersion: 1`.
2. Unpublished key: `key_version=9` → 400 `UNKNOWN_KEY_VERSION`, and no file is created.
3. `key_version` without `encrypted_file_key` → 400.
4. `created_at=yesterday` → 400 naming the unreadable timestamp.
5. Dates without `import_source` → 200, dates kept, `importedAt` null.
6. No extra fields at all (any existing client) → 200, today's dates, no key row.

## Cleanup
Delete this section once the feature is proven stable.

# Manual Verification: Task geofencing — server, web and E2EE envelope (#243)

Delete this section once task geofencing is proven stable. The iOS half (arrival alerts) is
wcherry/neutrino_calendar_ios_mobile#23, branch `feature/task-geofencing`.

## Prerequisites

- The stack running locally: `cargo xtask dev`. Migration `00140_calendar__…_task_geofencing`
  runs on start.
- An account with encryption set up and unlocked (saving places needs the key).
- For the cross-client checks: the calendar iOS app built from `feature/task-geofencing`, signed in
  to the same account.

## Steps

### Happy path

1. Open `/calendar`, open a task, and under **Remind me when I arrive** choose **Choose a place…**.
   Search "Buckingham Palace", pick the result. → A map shows the point and its circle; drag the
   radius slider → the circle and "Remind within …" follow. Tick **Save as a place**, name it
   "Home", **Remind me here**, then **Save**. → The row reads "Home"; the location reads
   "Home".
2. `sqlite3 ./data/neutrino.db "SELECT encrypted_payload FROM task_places;"` → JSON with only
   `v`, `keyVersion`, `key`, `data`; no "Home", no coordinates.
3. Settings → Calendar → **Saved places** → "Home" with its coordinates and radius. Rename it to
   "My home". → The task's row reads "My home".
4. In the task sidebar type `Water plants @home` → the preview chip says "My home · reminds on
   arrival" → Enter. → The task has the place (open it to see).
5. Type `Buy milk @Safeway` → Enter. → The task is created, then "Remind you when you arrive at
   Safeway?" appears with the address. **No thanks** → nothing set. Repeat and **Remind me** → the
   task gets a point (open it: "lat, lng · 150 m").
6. On iOS, sync. → "My home" appears under Saved Places, and the tasks show their places. Save a
   place on iOS → it appears in web Settings with the right name and coordinates.
7. Delete "My home" in Settings (confirm). → The tasks that used it show "Nowhere".

### Edge cases

1. **Older clients keep geofences**: with a geofenced task, edit only its title, then complete it,
   from a client that predates geofencing (or `PATCH /tasks/{id}` with `{"title":"x"}` and
   `{"done":true}`) → `geoPlaceId` / `geoLat` are unchanged.
2. **Repeating**: complete a weekly task that has a point → `nextTask` has the same point.
3. **Validation**: `PATCH` with `{"geoLat":91,"geoLng":0}` → 400; `{"geoLat":1}` on a task with no
   point → 400; `{"geoRadiusM":50,"geoLat":1,"geoLng":1}` → 400; another user's `geoPlaceId` → 404;
   a 5 KB `encryptedPayload` → 400.
4. **Locked key**: lock the vault and open the picker → "Save as a place" is disabled and says why;
   Settings says to unlock to see saved places.

## Cleanup

Delete this section once the feature is proven stable.

---

# Manual Verification: Calendars and holiday calendars (#236, #237)

Delete this section once calendars and holidays are proven stable. Design:
`agent_docs/calendars.md`.

## Prerequisites

- The stack running locally: `cargo xtask dev` (backend, worker and frontend). The migration
  `00139_calendar__…_calendars` runs on start.
- An account that already has some events, to check they survive the migration.
- No feature flag: the change is additive.

## Steps

### Happy path

1. Before upgrading, note a few existing events. Start the new build and open `/calendar`.
   → The same events show, unchanged, in the same colour as before. The sidebar has a
   **Calendars** list with one calendar, "Calendar", checked.
2. Click **+** beside Calendars, name it "Work", pick the red swatch, **Add**.
   → "Work" appears, checked.
3. **New Event** → the form has a **Calendar** picker → choose "Work" → create.
   → The event is drawn in red in month, week and agenda views.
4. Untick "Work". → Its events disappear from all three views; the default calendar's stay.
   Reload. → Still hidden. Tick it again. → They come back (nothing was deleted).
5. Hover "Work", click its swatch, pick another colour. → Its events change colour at once.
6. **Settings → Calendar → Holidays**: type "United States", pick it.
   → A row for United States appears, with a region list, **Observances** and **Show**.
7. Back in the calendar, go to November. → **Thanksgiving Day** on the fourth Thursday, in purple.
   September → **Labor Day** on the first Monday. Next year, the same.
8. Click Thanksgiving. → The detail shows "United States · Read-only" and has no Edit or Delete.
9. In settings, tick **Observances**. → Halloween (Oct 31) and Mother's Day (May) appear.
   Pick region "California". → California's own days appear too.
10. Add a second country (e.g. Canada) with its own colour. → Both countries' holidays show,
    each in its colour; unticking one in the sidebar hides only its holidays.
11. Add a task with a due date ("Pay rent ^tue") and one with a time ("Dentist ^thu 3pm").
    → Both appear on their days in month, week and agenda views, amber, with an unticked box;
    the timed one at 3:00 PM. Tick one → it's struck through, and ticked in the Tasks sidebar too.
    Click its title → the task editor opens.
12. Open the same account in another browser. → The same calendars, colours, visibility and
    holiday countries (they are stored on the server).

### Edge cases

1. **Read-only via the API**: `POST /api/v1/calendar/events` with the holiday calendar's id as
   `calendarId` → 403 "This calendar is read-only". `PUT` an event with that `calendarId` → 403.
2. **Default calendar**: hover it in the sidebar → no delete button. `DELETE` it via the API → 400.
3. **Delete a calendar**: delete "Work" → confirm dialog says its events go too → they disappear.
4. **Connected provider**: with Google connected, sync → its events appear under "Google Calendar".
   Deleting that calendar while connected → "Disconnect the account before deleting its calendar".
5. **Repeating event**: move a repeating event with an edited occurrence to "Work" with
   **All events** → every occurrence, the edited one too, is in "Work". Edit with **This event** →
   no Calendar picker.
6. **Offline**: with November shown and holidays loaded, go offline and switch Month/Agenda →
   the holidays still show.
7. **iOS app (shipped build)**: create and edit events → they land in the default calendar; the app
   keeps working (it ignores `calendarId`).

## Cleanup

Delete this section once the feature is proven stable.

---

# Manual Verification: Recurrence exceptions (this event / this and following / all events)

Design: `agent_docs/recurrence-exceptions.md`. Companion PR: `neutrino_calendar_ios_mobile`
`feature/recurrence-exceptions`.

## Prerequisites
- Stack running locally via docker-compose-dev.yml, with migration `00138` applied
- The web calendar at http://localhost:3000/calendar, and the iOS app pointed at the same server

## Steps

### Happy path — events (web)
1. Create "Standup", weekly on a Monday at 09:00, ending after 6 times.
2. Open the third occurrence and click **Edit**. Expected: a dialog offering "This event",
   "This and following events" and "All events".
3. Choose **This event**, change the title to "Planning" and move it to 14:00. Expected: the
   form has no Repeats field, and only that week shows "Planning" at 14:00.
4. Open the fifth occurrence, **Delete**, **This event**. Expected: only that week is gone.
5. Open the fourth occurrence, **Edit**, **This and following events**. Expected: Repeats
   shows "after 3 times". Change the location and save. Expected: weeks 1–3 keep the old
   location, weeks 4 and 6 have the new one (5 is still deleted), and there are 6 in all.
6. Open the first occurrence, **Edit**, **All events**, and rename it. Expected: the form starts
   on the first Monday, not the one clicked. Every occurrence that hadn't been renamed takes
   the new name. "Planning" keeps its own.
7. Reload the iOS app. Expected: the same occurrences, titles and times as the web.

### Happy path — events (iOS)
1. Open an occurrence of a repeating event and tap **Edit**. Expected: an action sheet with
   This Event / This and Following Events / All Events.
2. Repeat steps 3–6 above from the phone and check the web shows the same.
3. In the editor tap **Delete Event**. Expected: the three delete choices.

### Happy path — reminders (web and iOS)
1. Create a reminder repeating daily. Edit it. Expected: the scope dialog.
2. **This reminder**, then change the time. Expected: a one-off reminder at the new time, and
   the repeating one moved on to tomorrow.
3. Delete it with **This reminder**. Expected: the repeating one moves on a day and is not
   marked completed.
4. **All reminders** / **This and following reminders**: edits the repeating reminder itself.

### Edge cases
1. **This and following** on the first occurrence: the whole series is edited, not split.
2. Changing the repeat rule under **All events**: every exception is dropped, and the series
   shows plainly.
3. An older client (no `exceptions=true`): `GET /api/v1/calendar/events` lists no exception
   rows.
4. `DELETE /api/v1/calendar/events/{exceptionId}` cancels that occurrence; it does not bring
   back the original.

## Cleanup
Delete this section once recurrence exceptions are proven stable; the Team Spaces steps above have their own cleanup.

---

# Manual Verification: Templates for Docs (issue #128)

## Prerequisites
- Stack running locally via docker-compose-dev.yml
- A signed-in account with encryption set up (Settings → Security)
- Microsoft Word or LibreOffice on the machine, for the download check

## Steps

### Happy Path
1. Open http://localhost:9880/docs and create a document. Type a heading and a
   paragraph, add a footer (Format → Header & footer…) and set landscape in
   File → Page setup….
2. File → Export as… → **Word template (.dotx)**. Choose **Neutrino Drive**, keep
   My Drive, click **Save to Drive**.
   → A toast says the file was saved as a template. My Drive shows `<name>.dotx`.
3. Go back to http://localhost:9880/docs and click **New from template**.
   → The dialog lists the template, preselected, with its name in
   "Document name".
4. Change the name and click **Create**.
   → The editor opens a new document with that title, holding the heading,
   paragraph, footer and landscape page setup. No "Template" badge is shown.
5. In the new document, File → **New from template…**.
   → The same dialog opens from inside the editor.
6. Open the `.dotx` from My Drive.
   → It opens in the Docs editor with a **Template** badge by the title and a
   **Use template** button. Edit it; the save status returns to
   "All changes saved". Rename it from the title field.
   → Drive shows the new name still ending in `.dotx`.
7. Click **Use template**.
   → A new document opens with the template's content, including the edit made
   in step 6.

### Edge Cases
1. No templates: a fresh account → /docs → New from template → the dialog says
   how to make one, and Create is disabled.
2. Download: File → Export as… → Word template (.dotx) → **Download**. Open the
   file in Word or LibreOffice.
   → It opens as a template (Word: a new untitled document based on it), not
   with a "file is corrupt" error.
3. Upload a `.dotx` made in Word to Drive, then New from template.
   → It is listed and a document created from it carries its content.
4. Duplicate a template (File → Duplicate while it is open).
   → The copy is a `.docx` document, and opens in Word without error after
   download.
5. Locked vault: sign in on a new browser without unlocking the key, then
   New from template → Create.
   → An encryption warning appears and no empty document is created.

## Cleanup
Delete this section once templates are proven stable; the Team Spaces section above has its own condition.
