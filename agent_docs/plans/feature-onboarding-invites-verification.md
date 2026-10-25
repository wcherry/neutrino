# Manual Verification: Friend invites and the welcome email

## Prerequisites
- [ ] Server running with the default outbox mailer (no `MAIL_TRANSPORT`/`SMTP_HOST`/`RESEND_API_KEY`), so mail lands in `outbox.jsonl` beside the database. Tail it: `tail -f <data dir>/outbox.jsonl`.
- [ ] `DRIVE_URL` set to the URL you open the web app on, so links in mail point there.
- [ ] Two browsers (or one normal + one private window).

## Steps to Verify

### Happy Path
1. Register account A at `/register`. Finish the encryption key dialog.
2. Check the outbox: one "Welcome to Neutrino" message to A, with links to `/settings?tab=appearance`, `/profile`, `/settings?tab=ai`, `/calendar`, `/drive`, `/import`, `/invite`. Click each and confirm it lands on the right screen. Nothing in it says "optional".
3. In Classic, open the user menu: "Invite friends" sits right after Settings. Switch to Flow or Blended (Settings › Appearance) and open the account avatar menu: the same item is there. Open an editor (e.g. a document) and check its account menu too.
4. Open "Invite friends". The link field shows `<origin>/register?invite=…`. Click Copy: it says "Copied" and the clipboard holds the link. On a browser with a share sheet (Safari, mobile Chrome), "Share…" opens it.
5. Type `friend@example.com`, press Enter: a chip appears. Add a note. The button says "Send 1 invite". Click it: "Sent 1 invite." and a "Pending" row under "Invites you've sent".
6. Check the outbox: an invitation to friend@example.com with A's name, the note and a `/register?invite=` link, mentioning 14 days.
7. In the second browser open that link: the banner says "A invited you to Neutrino." and the email is pre-filled. Register; you land in Drive. B also gets a welcome email.
8. Back as A, reopen the dialog: the row now says "Joined".
9. Open `/invite` directly: the same panel on its own page.

### Edge Cases
1. Open the same emailed link again in a private window: "This invite link has expired or was already used."; with public sign-up open the form still works without the invite.
2. Revoke a pending invite: its row says "Revoked" and its link no longer validates.
3. Type `not-an-email` and press Enter: inline error, no chip, nothing sent.
4. Send 20 invites in one day, then one more: the dialog shows the rate-limit error (429).
5. Click "Reset link": the link changes and the old one stops working.
6. Restart the server with `PUBLIC_SIGNUP=closed`:
   - `/register` with no invite shows "Sign-up on this server is by invitation only…" and no form; `POST /api/v1/auth/register` returns 403 `SIGNUP_CLOSED`.
   - A fresh emailed invite or A's personal link lets someone register.
   - An admin creating a user in the admin console still works and that user gets a welcome email.
7. Sign in as an existing account: no welcome email is sent.
8. Dark mode: repeat step 4 with a dark theme. Chips, badges and errors stay legible.

## Expected Results
- One welcome email per new account (self-serve, invite or admin-created), never for sign-in.
- Emailed invites work once and expire after 14 days; the personal link is reusable until it expires (14 days) or is reset.
- Closed sign-up refuses registration without a valid invite and accepts it with one.
