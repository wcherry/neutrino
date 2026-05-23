# Manual Verification: Google Calendar OAuth Fix

## Prerequisites
- Docker Compose stack running locally (dev)
- A Google Cloud project with an OAuth 2.0 Client ID of type "Web application"
- The following Authorized Redirect URI registered in Google Cloud Console:
    http://localhost:8880/calendar/settings/oauth/google/callback
- `./secrets/google_client_id.txt` and `./secrets/google_client_secret.txt` present

## Steps to Verify

### Happy Path
1. Start the dev stack: `docker compose -f docker-compose-dev.yml up`
2. Open http://localhost:8880 and sign in
3. Navigate to Calendar > Settings
4. Click "Connect" next to Google Calendar
5. You should be redirected to Google's consent page — NO "Access blocked" error
6. Grant calendar access
7. You are redirected back to http://localhost:8880/calendar/settings/oauth/google/callback
8. The page shows "Connecting Google Calendar…" then "Google Calendar connected successfully."
9. You are automatically redirected to the Calendar Settings page
10. The Google Calendar row shows the connected email address

### Error Path — User Denies Access
1. Click "Connect" for Google Calendar
2. On the Google consent screen click "Cancel" / deny access
3. You are redirected back to the callback page
4. The page shows "You declined the Google Calendar permission request."
5. A "Back to Settings" button is present and works

### Redirect URI Mismatch (verifying the original bug is fixed)
1. In the Google Cloud Console, temporarily remove
   http://localhost:8880/calendar/settings/oauth/google/callback from Authorized URIs
2. Click "Connect" — Google should show "Access blocked" (expected)
3. Re-add the URI; click "Connect" again — the flow succeeds

## Expected Results
- Google consent screen loads without "Access blocked" error
- After granting consent, connection is saved and settings page reflects it

## Notes for Production
- Register `https://<your-domain>/calendar/settings/oauth/google/callback` as an
  Authorized Redirect URI in Google Cloud Console
- Set the `GOOGLE_REDIRECT_URI` environment variable in docker-compose-prod.yml
  (or via a `.env` file) to the same value
