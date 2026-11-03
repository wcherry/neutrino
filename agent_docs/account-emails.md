# Account emails: verification, sharing, and the weekly email

Status: **server and web done.** Shipped together with password reset (`password-reset.md`). The
welcome email (`src/auth/welcome.rs`) already existed and is unchanged.

## Email verification

Every new account (self-serve, invite, admin-created) is mailed a single-use link to
`{DRIVE_URL}/verify-email?token=…`, alongside the welcome email. How strict it is comes from
`EMAIL_VERIFICATION`:

| Mode | Links sent | Banner | Sharing, password reset | Sign-in after 30 days |
|---|---|---|---|---|
| `off` | no | no | allowed | allowed |
| `soft` | yes | yes | allowed | allowed |
| `enforce` | yes | yes, says what waits | **403 `EMAIL_NOT_VERIFIED`** | **403 `EMAIL_NOT_VERIFIED`** |

Unset means `enforce` when mail really leaves the server (SMTP or Resend) and `off` when it only
reaches the outbox file, since nobody could follow a link nobody received. The e2e stack sets
`soft`.

| Rule | Why |
|---|---|
| Accounts that predate migration 152 count as verified at creation | None were asked; blocking them would lock out every current user |
| Token: 32 random bytes; only its SHA-256 is stored (`email_verifications`) | Same as reset links |
| Works once, 7 days; a new link revokes older ones; ≤ 3 per hour | Only the newest email works; the form cannot flood an inbox |
| A link verifies only the address it was sent to | An address changed since cannot be verified by an old email |
| `enforce`: sharing = granting a permission, approving an access request, creating or widening a share link | An unproved address may not be the holder's. Turning a link *off* is never refused |
| `enforce`: no reset link to an unverified address (still 202) | An unproved address must not be able to take the account over |
| `enforce`: sign-in, refresh and OAuth code/refresh refused once 30 days old and unverified | The grace period; following a link lifts it at once |

A blocked account cannot sign in to ask for a link, so the sign-in page offers "Send a new
verification link", which calls the public `POST /auth/email/verification/request` (always 202).

Endpoints: `POST /auth/email/verify {token}` → `{email}`; `GET /auth/email/verification` →
`{email, verified, verifiedAt, mode, blockAt}`; `POST /auth/email/verification/resend` (202, or
204 when already verified, 429 past the cap); `POST /auth/email/verification/request {email}`.
Link errors: 404 `VERIFY_NOT_FOUND`, 410 `VERIFY_REVOKED` / `VERIFY_USED` / `VERIFY_EXPIRED`.

Web: `(public)/verify-email`, `components/EmailVerificationBanner` (bottom right, dismissable for
the session until three days before the block), and the sign-in page's `EMAIL_NOT_VERIFIED` case.

**Native clients** (`NeutrinoAuth/AuthService.swift`, Android `AuthClient.kt`, Windows
`neutrino-core/src/auth.rs`) call `/auth/login` and the OAuth flow directly. Under `enforce` they
get a 403 `EMAIL_NOT_VERIFIED` they have no special case for: a blocked sign-in and a refused
share show the server's message. There is no native banner or "send a new link" button yet. That
follow-up is wanted before `enforce` is the default on a deployment with many native users.

## Sharing emails

Notifications (`src/drive/notifications/email.rs`) now mail:

| Event | To | Says |
|---|---|---|
| `access_requested` | every owner | who asked, for what role, their message; links to `/drive/requests` |
| `access_request_approved` | requester | what they can now do; opens the file |
| `access_request_denied` | requester | declined; opens Drive |
| `file_access_revoked` / `folder_access_revoked` | who lost it | no longer has access; opens Drive |

Grants (`file_shared`, `folder_shared`) were already mailed. All of them respect "General" email.
`AccessRequestsService` returns a `Notice` (as team key requests do) and the handler sends it.

`/drive/requests` is the owner's list, which did not exist on the web. Approving grants the role
and then, for an encrypted file, seals its key to the requester in the browser
(`lib/accessRequests.ts`). It goes in that order because the server refuses a key for someone
with no access yet. A folder's files keep their own keys and are not resealed.

## The weekly email

`src/weekly/`. It is checked hourly and goes out from Monday 09:00 UTC, covering the seven days
before that Monday. Each account's week is claimed in `weekly_emails` before anything is sent, so
a restart or a second instance never sends a week twice. A server that was down on Monday catches
up later in the week. Nothing is sent to an account with nothing to tell; storage alone doesn't
count.

| Part | From | Needs |
|---|---|---|
| Your week | the week's notifications (shares, mentions, replies, action items, access requests) + storage used | "General" email |
| Your teams | changes by *other* members to each live team's files: counts only, never names (team files are E2EE) | "General" email |
| What's new | product updates published that week | "Product updates" email |

Product updates are written in **Admin › Product Updates** (`/api/v1/admin/product-updates*`).
They start as drafts, and publishing stamps `published_at`. The same tab previews the admin's own
weekly email (`GET /api/v1/weekly-email/preview`, open to any signed-in account; 204 when there
is nothing to tell).

## Migrations

152 `users.email_verified_at` + `email_verifications`; 153 `product_updates` + `weekly_emails`.
Both are additive.
