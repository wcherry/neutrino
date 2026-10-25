# Plan: Onboarding phase 5 — friend invites and the welcome email

Branch `feature/onboarding-invites`, stacked on `feature/editor-shell-and-quick-access` (PR #281).
Phase 3 (the welcome wizard, a separate session) embeds the invite component built here as its last
step, "Invite friends".

## Summary

A signed-in user can invite people two ways: a **personal invite link** they copy or hand to the
native share sheet, and **invitation emails** the server sends to addresses they type, with an
optional note. Every emailed invite works once and expires after 14 days. Signing up through a valid
invite works even when public sign-up is closed. Separately, every new account gets one **welcome
email** that walks through the same setup steps as the wizard, each a link into the web app.

## Affected repos

- `neutrino` only (server + web + e2e). Every change to `/api/v1` is additive: new routes, a new
  optional `inviteToken` field on `POST /auth/register`, a new table. No existing response shape
  changes, so the iOS, Android and desktop clients are unaffected.

## What exists today (findings)

- **Closed sign-up does not exist.** `POST /api/v1/auth/register` is open to anyone; there is no
  env var, flag, admin setting or migration for it. So this phase adds it: `PUBLIC_SIGNUP`
  (`open` by default, `closed` to require an invite), read once in `config.rs`. An env var rather
  than a DB row because the instance's sign-up policy is deployment configuration (like `MAIL_*`),
  and because the e2e suite has no admin to flip a row with. Admin-created accounts are unaffected.
- **Mail**: `src/shared/mail.rs` (`Mailer::{Outbox,Smtp,Resend}`, `Message{to,subject,body,html,headers}`).
  Templates follow `src/drive/notifications/email.rs`: a pure `compose()` returning
  `Content{subject,text,html}`, inline-styled HTML, links built from `DRIVE_URL`
  (`config.drive_base_url`). The mailer has no on/off switch beyond the transport, so the welcome
  email gets none. The test double is `Mailer::Outbox(path)`; the e2e stack writes it to
  `${RUN_DIR}/data/outbox.jsonl`, which the Playwright runner can read from the host.
- **Rate limiting**: there is no general limiter. The existing pattern is a DB-counted cap (the
  daily upload allowance in `drive/storage/service.rs`, 429 `DAILY_LIMIT_EXCEEDED`). Invites reuse
  that pattern: count this user's emailed invites in the last 24 hours.
- **Token hashing**: `shared::auth::tokens::hash_token` is a 64-bit `DefaultHasher`, fine for its
  refresh-token lookups but not for a bearer secret. Invites use SHA-256 (hex) instead.

## Design

### Table — migration `00148_auth__2026-10-24-000000_create_invites`

```
invites (
  id               TEXT PK
  inviter_id       TEXT NOT NULL  -> users(id) ON DELETE CASCADE
  kind             TEXT NOT NULL  CHECK (kind IN ('email','link'))
  token_hash       TEXT NOT NULL UNIQUE      -- sha256 hex of the token
  invitee_email    TEXT                      -- emailed invites only, lower-cased
  note             TEXT
  created_at       TIMESTAMP NOT NULL
  expires_at       TIMESTAMP NOT NULL        -- created_at + 14 days
  accepted_at      TIMESTAMP                 -- email: when used; link: last use
  accepted_user_id TEXT -> users(id) ON DELETE SET NULL
  revoked_at       TIMESTAMP
  use_count        INTEGER NOT NULL DEFAULT 0
)
index (inviter_id, kind, created_at)
```

### Personal link policy — reusable, rotating

The personal link can be used by several people (it is meant to be pasted into a group chat), but it
expires 14 days after it was minted and the user can reset it at any time, which kills the old one.
After expiry or reset a new one is minted the next time it is asked for. Its token is
`base64url(HMAC-SHA256(JWT secret, "neutrino-invite-link:" + id))`, so the server can show the same
link again while storing only its SHA-256 hash. (Rotating the JWT secret invalidates personal links,
which is acceptable.) Emailed invite tokens are 32 random bytes, base64url, shown only in the email.

### Routes (all new)

| Method | Path | Auth | What |
|---|---|---|---|
| GET | `/api/v1/invites` | user | My emailed invites with status, newest first |
| POST | `/api/v1/invites` | user | `{emails: string[], note?: string}` → 201 `{invites: Invite[]}` |
| DELETE | `/api/v1/invites/{id}` | user | Revoke a pending invite → 204 |
| GET | `/api/v1/invites/link` | user | My personal link (minted if none live) |
| POST | `/api/v1/invites/link/reset` | user | Kill the current link, mint a new one |
| POST | `/api/v1/invites/validate` | none | `{token}` → who invited you, prefilled email |
| GET | `/api/v1/auth/signup-policy` | none | `{publicSignup: boolean}` |

`Invite = {id, email, status: 'pending'|'accepted'|'expired'|'revoked', createdAt, expiresAt, acceptedAt?}`.
`PersonalInviteLink = {token, url, expiresAt, useCount}`.
`InviteValidation = {kind: 'email'|'link', inviterName, email?, expiresAt}`.
Errors: invalid address → 400 `INVALID_EMAIL`; more than 20 in a day → 429 `INVITE_LIMIT_EXCEEDED`;
unknown token → 404 `INVITE_NOT_FOUND`; spent → 410 `INVITE_USED`; expired → 410 `INVITE_EXPIRED`;
revoked → 410 `INVITE_REVOKED`; closed sign-up without a token → 403 `SIGNUP_CLOSED`.

### Sign-up through an invite

`POST /auth/register` gains an optional `inviteToken`. A `SignupService` wraps `AuthService::register`:

1. Closed and no token → 403 `SIGNUP_CLOSED`.
2. Token present → **claim** it with one conditional UPDATE (unused/unrevoked/unexpired), so two
   concurrent sign-ups cannot both spend a single-use invite. Closed: a bad token is the error.
   Open: a bad token is logged and ignored, since sign-up needs no invite.
3. `AuthService::register` runs every existing check unchanged (email, name, password policy,
   duplicate address). If it fails the claim is released, so a typo does not burn the invite.
4. Success → record `accepted_user_id`, then send the welcome email.

The sign-up address does not have to match the invited address (people use other addresses); the
emailed link only pre-fills it.

### Rate limit and validation

At most 20 addresses per request and 20 emailed invites per user per rolling 24 hours (DB-counted).
Addresses are trimmed, lower-cased, de-duplicated and checked for shape; your own address is refused.
Re-inviting an address that already has a pending invite from you revokes the old one. The note is
capped at 500 characters.

### Welcome email

Sent once, from the account-creation paths only (self-serve registration, invite registration,
admin-created), on a spawned task so a slow mail provider never holds up sign-up. Nothing else
calls it, so existing users never get one. Links (from `DRIVE_URL`):

| Step | Link |
|---|---|
| Look & theme | `/settings?tab=appearance` |
| Profile | `/profile` |
| AI assistant | `/settings?tab=ai` |
| Calendar | `/calendar` (the Calendars list is its sidebar) |
| Bring your files | `/drive`, and `/import` for a Google Takeout archive |
| Invite friends | `/invite` |

No step says "optional".

### Web

- `@neutrino/auth`: `invitesApi` (`getLink`, `resetLink`, `list`, `send`, `revoke`, `validate`),
  `authApi.signupPolicy()`, `inviteUrl(token)`, `RegisterRequest.inviteToken?`, types.
- `apps/web/src/components/InviteFriends/`: `useInvites()` hook, `InviteFriendsPanel` (the reusable
  body: link + Copy + Share…, email chips, note, "Send N invites" in the body, the 14-day footnote,
  the sent list with status and Revoke), `InviteFriendsDialog` (`Modal` around the panel).
- Account menu "Invite friends" in every look: `AccountMenu` (Flow/Blended top bar and editor chrome)
  and the classic `Topbar`, both via a new optional `onInvite` prop. The dialog is mounted by
  `AppShellLayout` and loaded lazily so it adds nothing to first-load route budgets.
- `/invite` page in `(apps)`: the panel on its own page, the welcome email's link target.
- `/register?invite=<token>`: validates the token, says who invited you, pre-fills the email, and
  sends `inviteToken`. With public sign-up closed and no valid invite the form explains it is
  invite-only instead.

## Specialists

- `test-writer`: Rust tests (invites, sign-up gate, rate limit, welcome email), web unit tests, e2e spec.
- `rust-developer`: migration, schema, `src/auth/invites/`, `SignupService`, welcome email, wiring.
- `frontend-developer` + `ui-designer` scope: API client, components, menu entries, pages, CSS modules.

## Test plan

- Rust: token hashing; validate wrong/expired/used/revoked; personal link reuse + reset; closed
  sign-up with and without a valid token; release on failed registration; rate limit at 20/21;
  address validation; welcome email sent once on register and admin-create, never on login or to a
  pre-existing user; welcome copy has every link and never says "optional".
- Web (vitest): panel renders link, copy/share, chips → "Send N invites", status list, revoke;
  `parseEmails`; AccountMenu/Topbar show "Invite friends"; register page reads the token.
- E2E `e2e/tests/onboarding/invites.spec.ts`: send an invite from the account menu, see it pending,
  read the invitation from the outbox, sign up from the link in a fresh browser, see it accepted;
  welcome email in the outbox. The shared e2e stack runs with public sign-up open (every other spec
  registers), so closed sign-up is covered by the Rust tests, not e2e.

## Risks

- `PUBLIC_SIGNUP=closed` also closes registration for the native apps (they call the same route);
  intended, and they get a clear 403 `SIGNUP_CLOSED`.
- The personal link is a bearer credential for sign-up while closed; 14-day rotation and reset
  bound that.

## Acceptance criteria

- Invite friends opens from the account menu in Classic and Flow/Blended; links copy/share; emails send.
- Emailed links work once and expire after 14 days; revoked ones stop working.
- With `PUBLIC_SIGNUP=closed`, register refuses without an invite and succeeds with one.
- Every new account gets exactly one welcome email; no existing user gets one.
- No new tsc errors in `apps/web`; lint, vitest and `cargo test` green.

## Contract (binding for tests and implementation)

### Rust module layout

```
src/auth/invites/mod.rs         pub mod api; pub mod email; pub mod model; pub mod repository; pub mod service;
                                #[cfg(test)] mod tests;   // tests live in src/auth/invites/tests.rs
src/auth/invites/model.rs       InviteRecord (Queryable/Selectable on crate::schema::invites), NewInvite (Insertable)
src/auth/invites/repository.rs  InviteRepository::new(pool: crate::shared::DbPool)
src/auth/invites/email.rs       pub fn compose(base_url: &str, inviter_name: &str, note: Option<&str>, token: &str) -> Content
src/auth/invites/service.rs     (below)
src/auth/invites/api.rs         InvitesApiState { invites: Arc<InviteService> }; pub fn configure(cfg)
src/auth/welcome.rs             (below)
src/auth/signup.rs              (below); its tests in src/auth/signup_tests.rs, included from signup.rs
                                with #[cfg(test)] #[path = "signup_tests.rs"] mod tests;
```

`Content` is `pub struct Content { pub subject: String, pub text: String, pub html: String }`, defined
in `src/auth/welcome.rs` and reused by `invites::email`.

### `src/auth/invites/service.rs`

```rust
pub const INVITE_TTL_DAYS: i64 = 14;
pub const MAX_EMAIL_INVITES_PER_DAY: i64 = 20;
pub const MAX_ADDRESSES_PER_REQUEST: usize = 20;
pub const MAX_NOTE_CHARS: usize = 500;

/// SHA-256 of the token, lower-case hex (64 chars).
pub fn hash_invite_token(token: &str) -> String;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)] #[serde(rename_all = "lowercase")]
pub enum InviteStatus { Pending, Accepted, Expired, Revoked }

// InviteRecord fields (model.rs): id, inviter_id, kind ("email"|"link"), token_hash,
// invitee_email: Option<String>, note: Option<String>, created_at, expires_at: NaiveDateTime,
// accepted_at: Option<NaiveDateTime>, accepted_user_id: Option<String>,
// revoked_at: Option<NaiveDateTime>, use_count: i32
// Timestamps are naive UTC (chrono::Utc::now().naive_utc()).
impl InviteRecord {
    /// revoked > accepted (email kind) > expired (now >= expires_at) > pending.
    pub fn status(&self, now: NaiveDateTime) -> InviteStatus;
}

pub struct PersonalLink { pub id: String, pub token: String, pub expires_at: NaiveDateTime, pub use_count: i32 }
pub struct ValidatedInvite { pub record: InviteRecord, pub inviter_name: String }
pub struct InviteClaim { pub invite_id: String, pub kind: String }

pub struct InviteService { /* repo, link_secret, mailer, base_url */ }
impl InviteService {
    pub fn new(repo: Arc<InviteRepository>, link_secret: String,
               mailer: Arc<crate::shared::mail::Mailer>, base_url: String) -> Self;

    /// The live personal link, minting one when none is live (none yet, expired or revoked).
    /// Same token on every call while it lives (HMAC of the row id).
    pub fn personal_link(&self, inviter_id: &str) -> Result<PersonalLink, ApiError>;
    /// Revoke the live link and mint a new one; the old token then fails validation (410 INVITE_REVOKED).
    pub fn reset_personal_link(&self, inviter_id: &str) -> Result<PersonalLink, ApiError>;

    /// Validate + rate-limit + store; returns each new row with its plaintext token. No mail.
    /// 400 INVALID_EMAIL (bad shape, own address, empty list, > MAX_ADDRESSES_PER_REQUEST),
    /// 400 NOTE_TOO_LONG, 429 INVITE_LIMIT_EXCEEDED when the user's emailed invites in the last
    /// 24h plus this batch would exceed MAX_EMAIL_INVITES_PER_DAY. Addresses trimmed, lower-cased,
    /// de-duplicated. A pending invite from the same inviter to the same address is revoked first
    /// (it still counts toward the daily limit).
    pub fn create_email_invites(&self, inviter_id: &str, emails: &[String], note: Option<&str>)
        -> Result<Vec<(InviteRecord, String)>, ApiError>;
    /// create_email_invites, then send each invitation through the mailer (awaited; a failed send
    /// is logged, not returned). Looks the inviter's name and email up itself.
    pub async fn send_email_invites(&self, inviter_id: &str, emails: &[String], note: Option<&str>)
        -> Result<Vec<InviteRecord>, ApiError>;

    /// Emailed invites only, newest first.
    pub fn list_mine(&self, inviter_id: &str) -> Result<Vec<InviteRecord>, ApiError>;
    /// 404 INVITE_NOT_FOUND if not the caller's; 409 INVITE_USED if already accepted; idempotent if revoked.
    pub fn revoke(&self, inviter_id: &str, invite_id: &str) -> Result<(), ApiError>;

    /// 404 INVITE_NOT_FOUND (unknown token), 410 INVITE_REVOKED, 410 INVITE_USED (email kind,
    /// accepted), 410 INVITE_EXPIRED — checked in that order.
    pub fn validate(&self, token: &str) -> Result<ValidatedInvite, ApiError>;
    /// validate, then atomically spend it: email kind sets accepted_at only if still unused
    /// (a lost race is 410 INVITE_USED); link kind bumps use_count and accepted_at.
    pub fn claim(&self, token: &str) -> Result<InviteClaim, ApiError>;
    /// Record who signed up with the claim.
    pub fn confirm(&self, claim: &InviteClaim, user_id: &str) -> Result<(), ApiError>;
    /// Undo a claim whose sign-up then failed: email kind clears accepted_at; link kind decrements use_count.
    pub fn release(&self, claim: &InviteClaim) -> Result<(), ApiError>;
}
```

ApiError codes are the `code` field of `ApiError::new(status, code, message)` (check
`src/shared/api_error.rs` for the field names).

### `src/auth/welcome.rs`

```rust
pub struct Content { pub subject: String, pub text: String, pub html: String }
/// Pure. Subject "Welcome to Neutrino". Text and HTML both carry every link in the table above,
/// absolute from base_url (trailing slash trimmed). Never contains the word "optional".
pub fn compose(base_url: &str, name: &str) -> Content;
pub struct WelcomeMailer { /* mailer, base_url */ }
impl WelcomeMailer {
    pub fn new(mailer: Arc<Mailer>, base_url: String) -> Self;
    pub async fn send(&self, email: &str, name: &str) -> Result<(), MailError>;
    /// tokio::spawn(send), logging a failure.
    pub fn send_later(&self, email: String, name: String);
}
```

### `src/auth/signup.rs`

```rust
pub struct SignupService { /* auth, invites, welcome, public_signup_open */ }
impl SignupService {
    pub fn new(auth: Arc<AuthService>, invites: Arc<InviteService>,
               welcome: Arc<WelcomeMailer>, public_signup_open: bool) -> Self;
    pub fn public_signup_open(&self) -> bool;
    /// The sign-up gate described above; on success sends the welcome email (send_later).
    pub async fn register(&self, req: RegisterRequest) -> Result<RegisterResponse, ApiError>;
    /// For admin-created accounts: send the welcome email (send_later).
    pub fn account_created(&self, user: &RegisterResponse);
}
```

`RegisterRequest` gains `#[serde(default, rename = "inviteToken")] pub invite_token: Option<String>`.
`AuthApiState` gains `pub signup: Arc<SignupService>`; `register` and `admin_create_user` go through it.
`Config` gains `pub public_signup_open: bool` from `PUBLIC_SIGNUP` (`open` default | `closed`; anything
else is a startup error).

Rust test pools: `:memory:` SQLite with `Pool::builder().max_size(1)` and
`run_pending_migrations(crate::MIGRATIONS)` (see `src/drive/notifications/service.rs` tests); insert
`users` rows before invites (foreign keys). Mail test double: `Mailer::Outbox(path)` in a temp dir;
a spawned send is awaited by polling the file (as the notifications test does).

### HTTP JSON (camelCase)

- `GET /api/v1/invites` → `{ "invites": [Invite] }`
- `POST /api/v1/invites` `{ "emails": [..], "note"?: ".." }` → 201 `{ "invites": [Invite] }`
- `DELETE /api/v1/invites/{id}` → 204
- `GET /api/v1/invites/link`, `POST /api/v1/invites/link/reset` → `PersonalInviteLink`
- `POST /api/v1/invites/validate` `{ "token": ".." }` → `InviteValidation`
- `GET /api/v1/auth/signup-policy` → `{ "publicSignup": true }`

```ts
type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked';
interface Invite { id: string; email: string; status: InviteStatus; createdAt: string; expiresAt: string; acceptedAt: string | null }
interface PersonalInviteLink { token: string; url: string; expiresAt: string; useCount: number }
interface InviteValidation { kind: 'email' | 'link'; inviterName: string; email: string | null; expiresAt: string }
```
Timestamps are RFC 3339 UTC strings (`...Z`). `url` is `${DRIVE_URL}/register?invite=<token>`;
the web builds its own from `window.location.origin` with `inviteUrl(token)`.

### Web contract

`@neutrino/auth` (`packages/auth/src/invites.ts`, re-exported from the index):

```ts
export const invitesApi = {
  getLink(): Promise<PersonalInviteLink>;            // GET  /api/v1/invites/link
  resetLink(): Promise<PersonalInviteLink>;          // POST /api/v1/invites/link/reset
  list(): Promise<Invite[]>;                         // GET  /api/v1/invites  (unwraps .invites)
  send(body: { emails: string[]; note?: string }): Promise<Invite[]>;  // POST /api/v1/invites (unwraps .invites)
  revoke(id: string): Promise<void>;                 // DELETE /api/v1/invites/{id}
  validate(token: string): Promise<InviteValidation>; // POST /api/v1/invites/validate
};
export function inviteUrl(token: string, origin?: string): string; // `${origin ?? window.location.origin}/register?invite=${encodeURIComponent(token)}`
authApi.signupPolicy(): Promise<{ publicSignup: boolean }>;        // GET /api/v1/auth/signup-policy
RegisterRequest.inviteToken?: string;
```

`apps/web/src/components/InviteFriends/` (index.ts re-exports all of these):

```ts
export function parseEmails(text: string): { valid: string[]; invalid: string[] }; // split on , ; whitespace; trim; lower-case; de-dupe
export function useInvites(opts?: { enabled?: boolean }): {
  link: PersonalInviteLink | undefined; linkUrl: string | undefined; invites: Invite[] | undefined;
  isLoading: boolean; send(emails: string[], note?: string): Promise<Invite[]>; sending: boolean;
  revoke(id: string): Promise<void>; resetLink(): Promise<void>;
};  // react-query; keys ['invites'] and ['invites', 'link']
export interface InviteFriendsPanelProps {
  /** Called after a batch is sent. */
  onSent?: (invites: Invite[]) => void;
  /** Show the list of invites already sent (default true). */
  showSentList?: boolean;
  /** Focus the email field on mount. */
  autoFocus?: boolean;
  className?: string;
}
export function InviteFriendsPanel(props: InviteFriendsPanelProps): JSX.Element;
export interface InviteFriendsDialogProps { open: boolean; onClose: () => void }
export function InviteFriendsDialog(props: InviteFriendsDialogProps): JSX.Element;
```

The panel needs a react-query `QueryClientProvider` above it (the app shell has one); tests wrap it.

Panel copy and accessible names (tests rely on these):
- link field `aria-label="Invite link"` (read-only input showing `linkUrl`); buttons "Copy" (→ "Copied"
  for 2s after `navigator.clipboard.writeText`) and "Share…" (only when `navigator.share` exists; calls
  it with `{ title: 'Join me on Neutrino', url }`); a "Reset link" text button.
- email field label "Or send invitations by email" (`id` + `<label htmlFor>`); typing an address and
  pressing Enter, comma or space, or blurring, turns valid addresses into chips (each chip has a remove
  button `aria-label="Remove <address>"`); pasting several splits them. Invalid text stays in the
  field with an inline error "<text> doesn't look like an email address".
- note field label "A note" (textarea, maxLength 500, placeholder "Come and try it — the files are
  encrypted end to end.").
- button "Send 1 invite" / "Send N invites" (counts chips plus a valid address still in the field);
  shown as "Send invites" and disabled at 0, disabled while sending; afterwards chips and note clear
  and a status line (`role="status"`) says "Sent 1 invite." / "Sent N invites."; a server error shows
  its message (`role="alert"`).
- footnote "Each invite link works once and expires after 14 days."
- sent list heading "Invites you've sent", one row per invite: the address, a status label
  (Pending / Joined / Expired / Revoked) and, for pending ones, a "Revoke" button
  `aria-label="Revoke invite to <address>"`. Empty: "No invites sent yet."
- dialog title "Invite friends".

Account menu: `AccountMenuProps.onInvite?: () => void` → menu item "Invite friends" (lucide `UserPlus`),
right after "Settings". Classic `Topbar` gets the same `onInvite` prop and item. `AppShellLayout`
wires both to open `InviteFriendsDialog` (lazily loaded).

Register page: reads `invite` from `window.location.search`; calls `invitesApi.validate`; on success
shows "<inviterName> invited you to Neutrino." and pre-fills the email when the invite has one; on a
failure shows "This invite link has expired or was already used." (keeps the form when public sign-up
is open). Calls `authApi.signupPolicy()`; when `publicSignup` is false and there is no valid invite, it
shows "Sign-up on this server is by invitation only. Ask someone with an account to invite you."
instead of the form. Sends `inviteToken` with `authApi.register` when it has a valid one.

`/invite` page (`apps/web/src/app/(apps)/invite/page.tsx`): heading "Invite friends" + `InviteFriendsPanel`.
