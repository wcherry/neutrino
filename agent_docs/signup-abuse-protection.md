# Sign-up abuse protection

Defences against scripted mass registration. Code: `src/auth/signup_guard/`, wired into
`SignupService::register_from` (`src/auth/signup.rs`). Table: `signup_events` (migration 00157).

## What every public sign-up goes through

1. **Address checks** — must look like an email; the domain must not be a built-in throwaway
   provider (`domains.rs`) or listed in `SIGNUP_BLOCKED_EMAIL_DOMAINS`. Subdomains match too.
   Refused with 400 `INVALID_EMAIL` / `EMAIL_DOMAIN_NOT_ALLOWED`, before an invite is spent.
2. **CAPTCHA** (when Turnstile is configured) — a valid `turnstileToken`, or a valid invite, makes
   the sign-up *human-verified*. A bad token is 400 `CAPTCHA_FAILED`. No token is not an error.
   If Cloudflare is unreachable the sign-up counts as unverified, so an outage tightens limits
   rather than closing sign-up.
3. **Rate limits**, counted from `signup_events` (survive restarts). A row is reserved *before*
   counting, so concurrent requests can't slip through together, and released if the account is
   not created. 429 `SIGNUP_RATE_LIMITED`, or `SIGNUP_CAPTCHA_REQUIRED` for the unverified bucket.

The native apps (iOS, Android) send no CAPTCHA token today, so they fall into the unverified
bucket: they keep working at low volume while a script without a token is held to a trickle.
Giving them a CAPTCHA (or App Attest / Play Integrity) is the follow-up that lets that bucket
shrink further.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `CLIENT_IP_HEADER` | peer | Where the client IP comes from. `peer` (TCP address), `x-forwarded-for` (last entry — the one your proxy appended), or a header name such as `cf-connecting-ip`. **Set this if the server is behind a proxy**, or every sign-up shares the proxy's IP. Never set it if the server is exposed directly: the header would be forgeable. The server logs a warning on the first sign-up that looks proxied while this is unset. |
| `SIGNUP_IP_HOURLY_LIMIT` | 3 | Sign-ups per IP per hour. `0` = unlimited. |
| `SIGNUP_IP_DAILY_LIMIT` | 10 | Sign-ups per IP per day. |
| `SIGNUP_GLOBAL_HOURLY_LIMIT` | 60 | Sign-ups across the server per hour. |
| `SIGNUP_UNVERIFIED_IP_DAILY_LIMIT` | 2 | With Turnstile on: unverified sign-ups per IP per day. |
| `SIGNUP_UNVERIFIED_GLOBAL_HOURLY_LIMIT` | 10 | With Turnstile on: unverified sign-ups across the server per hour. |
| `SIGNUP_BLOCKED_EMAIL_DOMAINS` | — | Comma-separated extra domains to refuse. |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | — | Cloudflare Turnstile keys; set both or neither. The secret also reads from `TURNSTILE_SECRET_KEY_PATH`. The site key reaches the web app through `GET /auth/signup-policy`, so no web rebuild is needed. |

IPv6 addresses are grouped by /64. The startup log prints the resolved settings
(`Sign-up guard: …`).

## Cleaning up

Admin console → **Sign-ups**: the busiest sign-up IPs and email domains in a window, and a
bulk delete by IP, domain and creation window. API: `GET /api/v1/admin/signups/summary?hours=`,
`POST /api/v1/admin/users/bulk-delete` (dry run by default). Admins and the caller are never
matched; verified accounts only with `includeVerified`. Deletion is the ordinary soft delete
(sessions revoked, restorable until purged).

Accounts created before migration 00157 have no recorded IP — filter those by domain and time.
