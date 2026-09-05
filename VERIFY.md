# Manual Verification: Team Spaces and the feature flag system (#185)

Replaces the verification steps for issue #69, which has shipped (commit `c707518`).

Delete this file once Team Spaces is proven stable — in the same PR that removes the
`teamSpaces` flag.

## Prerequisites

- The stack running locally: `cargo xtask dev` (backend, worker and frontend).
- An **admin** account. Flags are database rows and only an admin can change one; there is no
  bootstrap endpoint, so promote an account by hand:
  ```bash
  sqlite3 ./data/neutrino.db "UPDATE users SET role='admin' WHERE email='you@example.com';"
  ```
  Sign out and back in — the role is carried in the access token.

  Safe here, and only here: `cargo xtask dev` runs the backend natively, so this is an ordinary
  same-host SQLite write and its locking works. Do **not** do the equivalent against the e2e stack's
  database — that file is a Docker bind mount, where the locks do not carry and a host-side write
  corrupts it. See `e2e/README.md`.
- A second ordinary account, for the membership and role checks.

The flag ships **disabled**. Nothing below is visible until you turn it on, which is the first
thing to confirm.

---

## Steps

### The flag is off — the app is unchanged

1. Open the app and sign in as an ordinary user.
2. The sidebar's Team section says **Shared Drives** and points at `/drive/team`. There is no
   Shared Spaces entry. → *This is the state every existing deployment is in after this release.*
3. `curl http://localhost:<port>/api/v1/feature-flags` returns exactly one key, `teamSpaces`,
   `false`. It needs no authentication. One flag is the whole switch — there are no per-phase
   sub-flags to reason about.
4. `curl -H "Authorization: Bearer <token>" http://localhost:<port>/api/v1/drive/teams` answers
   **404**, not 403. → *With the flag off the feature does not exist on this deployment; 403 would
   confirm it is coming.*

### Turning it on

5. Sign in as the admin, open **Admin → Feature Flags**.
6. There is one row. It shows its owner and the condition under which it is removed, beside the
   toggle.
7. Turn on `teamSpaces`.
8. Reload as the ordinary user. The Team section now says **Shared Spaces** and points at `/teams`.
   Shared Drives is gone — replaced, not joined. → *No restart was needed; that is the property
   these are rows rather than environment variables for.*

### Happy path — a team, its wiki and its files

9. Open **Shared Spaces** → **New Team**. Name it `Marketing`, pick an avatar colour, create it.
10. You land inside the team, on a **Home** page reading "Welcome to Marketing". The team sidebar
    shows Home, Pages, Files, Members, Settings, and a Pages tree with Home in it.
11. **Edit** the Home page, change a line, **Save**. The rendered page shows the change.
12. **History** → one version, holding the text you replaced. **Preview** it, then **Restore** it.
    The page goes back, and the history now has *two* versions — the restore recorded what it
    replaced. → *Restoring the wrong version must not destroy what it replaced.*
13. **Subpage** → `Meeting notes`. It appears indented under Home in the tree, and the page shows a
    breadcrumb trail.
14. In the page body, write some markdown — a heading, a table, a `- [ ] task`, a fenced code
    block, a link. Save. All of it renders.
15. **Files** → **Upload**, pick any file. It appears in the library and the storage figure moves.
16. Open **My Drive**. The uploaded file is **not** there. → *It belongs to the team now, not to
    you.* Its versions, trash and encryption are the ordinary ones — this is the same row in the
    same table, with a `team_id`.
17. **Files** → **New folder**, then upload into it. Breadcrumbs walk in and out of the folder.

### Roles

18. **Members** → **Add member**, the second account's email, role **Viewer**.
19. Sign in as that second account. Shared Spaces shows Marketing. Open it: the pages are readable,
    and there is no New page button, no Edit, no Upload.
20. As the owner, change their role to **Contributor**. As them, reload: New page and Upload appear;
    Delete does not. → *A Contributor adds but does not remove.*
21. As them, try `DELETE /api/v1/drive/teams/<id>/pages/<page id>` directly — **403**. The buttons
    are an affordance; the server is the rule.
22. As the owner, **Settings** → try to demote yourself to Viewer. Refused: you are the only owner.

### Visibility — who can find the team, and how they get in

The setting decides two things at once, and the three values are the three combinations worth
having. Marketing is `private` so far, which is the default.

22a. As a second account, open **Shared Spaces**. There is no Discover section: nothing is
     discoverable yet. `GET /api/v1/drive/teams/discoverable` returns an empty list.
22b. As the owner, **Settings** → visibility **Organization**, save. The hint below the picker says
     anyone signed in can find it and join it themselves.
22c. As the second account, reload Shared Spaces. Marketing appears under **Discover** with a
     **Join** button. Click it: you land in the team as a **Viewer** — you can read the pages, and
     there is no Edit, no New page, no Upload. → *Making a team findable is not the same as
     granting write access to everyone who finds it.*
22d. As the owner, promote them to Editor in Members. They can write. → *One click, and in the
     recoverable direction.*
22e. Have them leave the team. Set visibility to **Invite only**. As them, Shared Spaces now shows
     Marketing under Discover with **Request access** rather than Join; clicking it turns the
     button into "Requested — waiting on an admin". Clicking `POST …/join` directly answers
     **403**: they can see the team, so there is nothing left to hide — only something they may not
     do.
22f. As the owner, **Members** shows a **Requests to join (1)** panel above the member list, with
     their note if they left one and a role picker defaulting to Viewer. **Approve** it. They are
     in the team and the panel is gone.
22g. Ask again from a third account and **Decline** it instead. They are not admitted, the panel
     empties, and `GET …/join-requests?status=declined` still holds the row with who decided it and
     when. → *A decline is remembered, so the same person does not reappear in the queue tomorrow
     with nothing to say they were already answered. It is not a ban — they may ask again.*
22h. Set visibility back to **Private**. As a fourth account, Discover no longer lists Marketing and
     `POST …/join` answers **404**. Everyone already in the team stays in. → *Closing a team hides
     it; it does not evict anyone.*
22i. The team's **activity feed** carries a `team.visibility_changed` entry for each of those
     changes, with the old and new value. → *Opening a team up is worth its own line in the log.*

### Edge cases

- **A team you are not in**: as a third account, `GET /api/v1/drive/teams/<id>` answers **404** —
  the same status and message as a team id that never existed. → *Whether a team exists is itself
  something membership decides.* This holds for a **discoverable** team too: it appears in
  `/teams/discoverable` as a name, a description and a member count, and every other route about it
  still answers 404 until you are in it. Findable is not readable.
- **An archived team is not joinable**: archive an `organization` team and it drops out of Discover;
  `POST …/join` answers **409**. → *Every write in an archived team is refused, so admitting someone
  would hand them a room they cannot act in.*
- **Requesting access to an open team**: `POST …/join-requests` on an `organization` team answers
  **400**. There is nothing to ask for when anyone may simply join.
- **Answering a request twice**: approve or decline the same request again — **409**.
- **An admin cannot approve someone into ownership**: as an Admin (not the Owner), approve a request
  with `{"role": "owner"}` — **403**, the same rule that governs inviting.
- **An administrator is not a member**: the admin account, which is in no team, gets 404 on the
  same call. Authority over the deployment is not membership of every team on it.
- **Deleting Home**: the Home page has no Delete button, and the API answers 400. A team always has
  exactly one.
- **A page inside itself**: `PATCH` a page with its own child as `parentPageId` — 400. A cycle
  would hang the tree walk.
- **Archiving**: Settings → Archive. Everything stays readable; every write answers 403, including
  the owner's. Restore, and writes work again.
- **The switch is whole**: turn `teamSpaces` off while a team is open and reload. Pages, Files,
  Members and the activity feed all go dark together and the sidebar reverts to Shared Drives —
  there is no half-on state in which a team exists but its wiki does not.

### A declared flag with no row

The failure this design exists to prevent. Delete a row the server declares:

```bash
sqlite3 ./data/neutrino.db "DELETE FROM feature_flags WHERE key='teamSpaces';"
```

23. `GET /api/v1/feature-flags` now answers **500**, and the message names `teamSpaces`.
24. **Admin → Feature Flags** still loads — it is how you diagnose this — and shows
    `teamSpaces` as a disabled row marked as having no row, with a banner above the list.
25. The web app logs `[feature-flags] … missing: teamSpaces` in the console rather than
    rendering the feature as quietly off.
26. Put it back:
    ```bash
    sqlite3 ./data/neutrino.db \
      "INSERT INTO feature_flags (key, enabled, description, updated_at) \
       VALUES ('teamSpaces', 0, 'restored by hand', datetime('now'));"
    ```

### Feature disabled

27. Turn `teamSpaces` off in the admin panel.
28. Reload: the sidebar says Shared Drives again, `/teams` says Team Spaces is not enabled, and
    every team route answers 404. Teams already created are untouched in the database and come back
    when the flag does.

## Cleanup

Delete this file in the PR that removes the `teamSpaces` flag.
