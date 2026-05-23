# Fix: Google Calendar OAuth "Access blocked" Error

## Symptom
When a user clicks "Connect" for Google Calendar, Google returns:
"Access blocked: This app's request is invalid"

## Root Cause Analysis

### Issue 1 (PRIMARY — causes the "Access blocked" error):
The `GOOGLE_REDIRECT_URI` environment variable is never set in either
`docker-compose-dev.yml` or `docker-compose-prod.yml`. When it is absent,
`config/mod.rs` falls back to:

  `format!("{}/api/v1/connections/google/callback", default_base)`

where `default_base` comes from `APP_BASE_URL`, which is also not set.
The final fallback is:

  `http://localhost:8080/api/v1/connections/google/callback`

This is the **internal container address** (port 8080 inside the Docker network).
The URI sent to Google in the OAuth authorization request therefore does not match
any URI registered in Google Cloud Console (which should be the public-facing
address, e.g., `http://localhost:8880/api/v1/connections/google/callback` for dev
or `https://<domain>/api/v1/connections/google/callback` for prod).

Google's strict redirect URI validation rejects the request immediately and shows
"Access blocked: This app's request is invalid".

### Issue 2 (SECONDARY — callback will always 401 after Google redirects):
The `/api/v1/connections/google/callback` handler requires `AuthenticatedUser`
(Bearer JWT). When Google redirects the browser back to this URL after consent,
there is no Authorization header — the request arrives as a plain browser GET.
The Actix extractor will return 401, and the connection can never be completed.

The `state` parameter is generated as a UUID but never stored, so it cannot be
used to recover the user's identity at callback time.

### Issue 3 (SECONDARY — prod compose is missing Google OAuth secrets):
`docker-compose-prod.yml` does not define `google_client_id` or
`google_client_secret` secrets and does not mount them to the calendar service.

## Fix Strategy

### Fix 1 — Add GOOGLE_REDIRECT_URI to docker-compose files (both repos)

**neutrino-calendar / docker-compose-dev.yml** — add to the `calendar` service:
```yaml
APP_BASE_URL: http://localhost:8880
GOOGLE_REDIRECT_URI: http://localhost:8880/api/v1/connections/google/callback
```
Port 8880 is the exposed port of the `web` (nginx) container in dev.

**neutrino-calendar / docker-compose-prod.yml** — add Google secrets and set:
```yaml
GOOGLE_REDIRECT_URI: https://<your-domain>/api/v1/connections/google/callback
```

For prod, the GOOGLE_REDIRECT_URI needs to be the real hostname. Since this
varies per deployment, we add a placeholder and also add the missing secrets.

### Fix 2 — Redesign the callback to not require JWT auth

The callback URL Google calls is a browser redirect. The user's JWT is in
localStorage — not available to the server at redirect time.

**Correct approach:** Make the callback an unauthenticated endpoint that:
1. Validates the `state` parameter against a short-lived store
2. The `state` is generated during `initiate_google` and stored with the user_id
3. At callback time, state is looked up to retrieve user_id, then tokens are stored

**Simpler approach (used here):** Have the backend callback return an HTML page
with the auth code that the frontend JS then posts to a separate authenticated
endpoint. Or — even simpler and consistent with the current architecture — change
the redirect URI to a **frontend route** that handles the callback in the browser:
the frontend captures `?code=...` from the URL, reads the user's JWT from
localStorage, and then calls the authenticated backend endpoint.

We will use the **frontend callback page approach**:
- `GOOGLE_REDIRECT_URI` points to the **web frontend** at
  `/calendar/settings/oauth/google/callback`
- The Next.js page at that route reads `code` from the URL search params,
  then calls `calendarApi.completeGoogleOAuth(code)` — an authenticated POST
- The backend gets a new `/api/v1/connections/google/complete` endpoint that
  accepts `{ code }` in the body and is authenticated with Bearer JWT

This completely eliminates the auth problem at the callback step.

## Affected Files

### neutrino-calendar (backend):
- `docker-compose-dev.yml` — add `GOOGLE_REDIRECT_URI` and `APP_BASE_URL`
- `docker-compose-prod.yml` — add Google secrets + `GOOGLE_REDIRECT_URI`
- `src/connections/api.rs` — add `POST /connections/google/complete` endpoint
- `src/connections/service.rs` — add `complete_google(user, code)` method
- `src/connections/dto.rs` — add `CompleteGoogleRequest` DTO

### neutrino-web (frontend):
- `packages/api-calendar/src/index.ts` — add `completeGoogleOAuth(code)` method
- `apps/web/src/app/(apps)/calendar/settings/oauth/google/callback/page.tsx` — new page

## Acceptance Criteria
1. Clicking "Connect" for Google Calendar opens Google's consent page without
   "Access blocked" error.
2. After granting consent, the user is redirected back to the app, the connection
   is created, and the settings page shows the connected Google Calendar.
3. The JWT-authenticated callback no longer exists or is no longer called during
   the OAuth flow.
4. Both dev and prod docker-compose files have the correct redirect URI configuration.
