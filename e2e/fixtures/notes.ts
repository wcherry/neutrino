/**
 * Creating a note from a test.
 *
 * There is no notes service any more. `POST /api/v1/notes` and the rest of
 * `/api/v1/notes/*` were removed in ad0da75 ("remove backend routes no client
 * calls"): a note is now a Drive file with the note MIME type and nothing
 * notes-specific behind it, which is what `web/apps/web/src/lib/noteFiles.ts`
 * does on the app side. Seven specs kept their own copy of a helper posting to
 * the dead route; this is the one they share instead.
 *
 * Body is deliberately not written here. Note content is E2EE, so the only
 * place it can be produced is the browser — a test that needs content types it
 * into the editor and lets autosave encrypt it.
 */

import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** Mirrors `NOTE_MIME` in `apps/web/src/app/(apps)/drive/routeForFile.ts`. */
export const NOTE_MIME = 'application/x-neutrino-note';

const BASE_URL = 'http://localhost:9880';

async function authTokenFor(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found in localStorage');
  return token;
}

/**
 * Create an empty note and return its Drive file id.
 *
 * `auth` takes either the token or the page to read it from: the helpers this
 * replaced came in both shapes, and neither is worth rewriting call sites over.
 */
export async function createNoteViaApi(
  request: APIRequestContext,
  auth: string | Page,
  title: string,
): Promise<string> {
  const token = typeof auth === 'string' ? auth : await authTokenFor(auth);
  const res = await request.post(`${BASE_URL}/api/v1/drive/files`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {
      id: crypto.randomUUID(),
      name: title,
      mimeType: NOTE_MIME,
      folderId: null,
    },
  });
  expect(res.ok(), `create note failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const data = (await res.json()) as { id: string };
  return data.id;
}

/** Move a note to the trash, as Drive does for any other file. */
export async function deleteNoteViaApi(
  request: APIRequestContext,
  token: string,
  noteId: string,
): Promise<void> {
  const res = await request.delete(`${BASE_URL}/api/v1/drive/files/${noteId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `delete note failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}
