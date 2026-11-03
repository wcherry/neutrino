# Password reset ("Forgot password?")

Status: **server and web done.** Native clients have no screen of their own yet; the simplest
follow-up is a "Forgot password?" link on the shared iOS (`NeutrinoUI`) and Android sign-in screens
that opens `{server}/forgot-password` in the browser.

## Flow

1. Sign-in → **Forgot password?** → `/forgot-password` → `POST /api/v1/auth/password/forgot {email}`.
2. The server always answers **202**, account or not. If the address belongs to a live, enabled
   account under the hourly cap, it stores a link and mails
   `{DRIVE_URL}/reset-password?token=<token>` (sent after the response, so its latency reveals
   nothing).
3. `/reset-password` calls `POST /auth/password/reset/check {token}` → `{email, requiresTwoFactor}`,
   then `POST /auth/password/reset {token, newPassword, totpCode?}` → 204.
4. The owner is mailed "Your Neutrino password was changed".

## Rules

| Rule | Why |
|---|---|
| Token: 32 random bytes, base64url; only its SHA-256 is stored (`password_resets`, migration 151) | A database read yields no usable link |
| Works once, expires after 60 min; a new request revokes older live links; a reset revokes all | Only the newest email in the inbox works |
| ≤ 3 links per account per rolling hour; past that, still 202 and nothing sent | The form cannot flood an inbox or confirm an account |
| Disabled account: nothing sent, link refused (403 `ACCOUNT_DISABLED`) | A reset is not a way back into an account an admin shut |
| Two-factor code required when the account has it | The mailbox alone cannot sign the owner out everywhere |
| Password checked (policy, history, ≠ current) **before** the link is spent | A refused password can be retried with the same link |
| Success: clears forced expiry and a failed-sign-in lockout, revokes every session | Lockout guards against guessing; the reset proved the mailbox, not a guess |

Errors on `check`/`reset`: 404 `RESET_NOT_FOUND`, 410 `RESET_REVOKED` / `RESET_USED` /
`RESET_EXPIRED`, 403 `ACCOUNT_DISABLED`, plus the usual 400/401 from the password policy and the
two-factor check.

## Encryption

Unaffected. Identity keys are client-only and never derived from the password
(`client-only-key-architecture.md`), so a reset changes how the account signs in and nothing about
what it can decrypt. A user on a new device still needs a QR transfer or their recovery kit.

## Code

- Server: `src/auth/password_reset/` (service, repository, emails, API, tests);
  `AuthService::prepare_reset_password` / `apply_reset_password`.
- Web: `(public)/forgot-password`, `(public)/reset-password`, `authApi.forgotPassword` /
  `checkPasswordReset` / `resetPassword`.
- Tests: `src/auth/password_reset/tests.rs`, `web/apps/web/src/__tests__/auth/passwordReset.test.tsx`,
  `e2e/tests/auth/password-reset.spec.ts`.
