# Photo sharing: encrypted share links and `/open/photo/` Universal Links

Status: **proposed — needs a decision before any code.** Epic 13 of the Photos iOS roadmap
(`neutrino_photos_ios_mobile/agent_docs/roadmap.md`) asks for share links that open a photo or an
album in a signed-out browser. Photos are end-to-end encrypted, so that is a wire-format change
across the server, the web app and iOS (CLAUDE.md rule 5), and it is designed here first.

What shipped without this design, in `wcherry/neutrino_photos_ios_mobile` (`feature/basic-sharing`):

- **Share Sheet export** — one or many photos decrypted on the device and handed to iOS's Share
  Sheet. No server involvement.
- **The iOS half of `/open/photo/<file id>`** — a router that opens the photo from the library.
  Live, but iOS delivers these links to the app only once §6's web and AASA pieces exist.

---

## 1. The problem

A Drive share link today (`/api/v1/drive/share/{token}`, `src/drive/sharing/`) resolves a token to
a file and serves its bytes. For an encrypted photo those bytes are ciphertext, and the
`/share/{token}` web page has no decryption path — it could not have one, because the file's data
key (DEK) is sealed only to the owner's X25519 key (and to any Neutrino user it was shared with via
`POST /drive/files/{id}/key/share`). A signed-out recipient has no key pair at all.

So a link has to carry its own key, and the server must never learn it.

## 2. Requirements

From Epic 13's verification steps, plus the platform's rules:

| # | Requirement |
|---|---|
| R1 | A photo or album link opens in a **signed-out** browser and displays. |
| R2 | A link can **expire**; past it the link is refused with a clear message. |
| R3 | **Revoking** stops the link working immediately, not on a cache expiry. |
| R4 | **View-only**: no download control, and the original's asset URL is not fetchable. |
| R5 | The link never exposes the account's identity key, and the key it carries is **scoped to the items shared** — it opens nothing else. |
| R6 | The server holds nothing that decrypts the shared items without the link (client-only keys, `client-only-key-architecture.md` D1). |

## 3. Design

### 3.1 The link key travels in the URL fragment

The sharing device generates a fresh 32-byte `linkKey` per link. The link is:

```
https://www.getneutrino.app/s/<token>#k=<base64url(linkKey)>
```

`<token>` identifies the link record on the server. The fragment (`#k=…`) is **never sent to the
server** by a browser, so the server stores and serves only material the link key opens. This is
the same construction as Firefox Send, Bitwarden Send and Proton Drive's public links.

`linkKey` is independent of every account key (R5): it is random, used for one link, and opens only
the DEKs wrapped to it.

### 3.2 Wrapping the DEKs

For each shared item the sharing device — which can already unseal the item's DEK — wraps it:

```
wrapped = nonce(24) || crypto_secretbox_easy(DEK, nonce, linkKey)   // XSalsa20-Poly1305
```

`crypto_secretbox` because both sides already ship it: `keystoreLocal.ts` uses it in the web app,
and swift-sodium's `SecretBox` is in every iOS app. The content itself is not re-encrypted; the
ciphertext in Drive is reused as-is (chunked secretstream, `chunked-file-encryption.md`).

What gets wrapped depends on the link's role:

| Role | Wrapped | Served |
|---|---|---|
| `viewer` (view-only) | the **preview rendition's** DEK only | the preview file only |
| `downloader` | the preview's and the **original's** DEK | both |

That is what makes R4 a property rather than a promise. A view-only link does not contain the
original's key at all, and the server refuses to serve the original's ciphertext for it — so there
is nothing for a recipient to fetch even with the URL in hand. (A recipient can always screenshot
what they are shown. View-only means "no original", and the UI should not claim more.)

Previews are 2048 px renditions the importing iOS device uploads as separate encrypted Drive files.
They are re-encoded from pixels with no metadata copied (`RenditionGenerator` in the Photos app), so
view-only links also do not leak location.

Not every photo has one. The iOS app skips the preview when it would not be smaller than the
original, and photos uploaded from the web or another client may never have had one. The sharing
device can always make one, since it can decrypt the original. So link creation generates and
uploads any missing preview first, and only then wraps its key. The original's key is never
substituted for a missing preview's.

### 3.3 Server

New table, one row per wrapped key, cascading from the existing `share_links` row:

```
photo_share_link_keys (
  share_link_id  TEXT REFERENCES share_links(id) ON DELETE CASCADE,
  file_id        TEXT NOT NULL,          -- the Drive file the key opens
  photo_id       TEXT NOT NULL,          -- for ordering and the item list
  rendition      TEXT NOT NULL,          -- 'preview' | 'original'
  wrapped_key    TEXT NOT NULL,          -- base64url(nonce || secretbox)
  position       INTEGER NOT NULL,
  PRIMARY KEY (share_link_id, file_id)
)
```

`share_links` gains `resource_type` values `photo` and `photo_album`; its existing `role`,
`expires_at` and `is_active` columns carry R2 and R3.

Endpoints:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/photos/share-links` | owner | Create: `{ resourceType, resourceId, role, expiresAt?, items: [{ photoId, fileId, rendition, wrappedKey }] }` → `{ id, token }`. The server checks the caller owns every photo and that each `fileId` is that photo's original or its preview. |
| `GET` | `/api/v1/photos/share-links` | owner | List the caller's active links (Epic 13 "share management"). |
| `PATCH` | `/api/v1/photos/share-links/{id}` | owner | Change expiry or role. A role upgrade needs new wrapped keys, so it takes `items` too. |
| `DELETE` | `/api/v1/photos/share-links/{id}` | owner | Revoke: deletes the row and, by cascade, every wrapped key. |
| `GET` | `/api/v1/share/{token}/photos` | none | The item list: `{ title, role, expiresAt, items: [{ photoId, fileId, rendition, wrappedKey, mimeType, captureDate }] }`. |
| `GET` | `/api/v1/share/{token}/files/{fileId}` | none | The ciphertext of one file **listed for this link**, at a rendition the role allows. |

Every unauthenticated request re-checks `is_active` and `expires_at` against the database — no
caching of the resolution — so a revoke or an expiry takes effect on the next request (R3). An
expired link answers `410 Gone` with a message the viewer shows; a revoked or unknown one `404`.

### 3.4 Web viewer

A static route `/s/[token]` (same SPA-fallback arrangement as `/open/[kind]/[id]`):

1. Read `k` from `location.hash`, then `history.replaceState` the fragment away so it is not left
   in the address bar for a screen share.
2. `GET /share/{token}/photos`.
3. For each item, `crypto_secretbox_open_easy` the wrapped key with `linkKey`, fetch the
   ciphertext, decrypt with the existing secretstream reader, and display.
4. Offer Download only for `role === 'downloader'`.

The wrap and unwrap functions go in `web/packages/e2e-crypto` with test vectors that the Swift side
(`NeutrinoCrypto`) asserts against too, so the two implementations cannot drift.

### 3.5 iOS

- **Create**: from the viewer or an album, choose view-only or download, and an expiry. The device
  unseals each DEK, wraps it, posts the link, and builds the URL with the fragment locally. The URL
  is shown once and can be copied; the server cannot reconstruct it.
- **Manage**: Settings › Shared Links lists links with their expiry, and lets the owner revoke one.
- The link key is not stored. Re-sharing an existing link means creating a new one. That is a
  deliberate trade: storing link keys on the device is a second secret to protect for little gain.

### 3.6 Albums are a snapshot

An album link wraps the keys of the photos in the album **when the link is made**. The server
cannot add a photo added later — it cannot wrap a key it never sees — so a live album link would
need the owner's device to re-wrap on every add. Proposed: links are snapshots, and adding to an
album with an active link offers "Update shared link" from that device, which posts the new items'
wrapped keys under the same token. See open question 1.

## 4. Threat model

| Attacker | Gets | Does not get |
|---|---|---|
| Server or database dump | wrapped DEKs and ciphertext | `linkKey`, so nothing decrypts (R6) |
| Someone with the link | exactly the shared items, at the role's rendition | any other item; the account's keys (R5) |
| Network observer (TLS intact) | that a link was opened | anything |
| Recipient after revoke | what their browser already decrypted and displayed | anything fetched after the revoke |

A link is a bearer credential: anyone holding it can open it, as with any "anyone with the link"
share. Expiry and revoke are the mitigations, and the create screen should say so.

## 5. Rollout

| Phase | Repo | Work |
|---|---|---|
| 1 | `neutrino` | Migration, endpoints and tests. Additive: no existing client changes. |
| 2 | `neutrino` (web) | `e2e-crypto` wrap/unwrap with test vectors; `/s/[token]` viewer. |
| 3 | `neutrino_shared_ios` | The same wrap/unwrap in `NeutrinoCrypto`, asserted against phase 2's vectors. |
| 4 | `neutrino_photos_ios_mobile` | Create, manage, revoke; "update shared link" on album add. |
| 5 | web Photos app | The same create and manage UI, so a link made in either place can be managed in both. |

One branch name across the repos touched, per `developer_workflow.md`.

## 6. `/open/photo/<file id>` Universal Links

Separate from share links: these open a photo **in the owner's own app**, and carry only a Drive
file id — no key and no access of their own. The iOS router exists and is live. Three more
pieces make iOS deliver the links to it:

1. **Web**: add `photo` to `APP_LINK_KINDS` in `web/apps/web/src/app/(apps)/open/appLink.ts`, routing
   to the Photos web viewer for that file, so the link works where the app is not installed.
2. **AASA**: add `{ "/": "/open/photo/*" }` for `46KWJJ63FU.com.neutrino.photos` to
   `static/apple-app-site-association`. The copy in `neutrino_drive_ios_mobile/deploy/` is
   identical today and should be kept so, or deleted in favour of this one.
3. **Shared vocabulary**: add `photo` to `NeutrinoAppLink.Kind` in `neutrino_shared_ios`, and give
   every app's `switch` over `Kind` a case for it in the same change. Until then the Photos app parses
   its own path (`PhotoLinkRouter`), with the same rules.

## 7. Open questions

1. **Snapshot or live albums?** §3.6 proposes snapshots with an explicit update. A live album needs
   the owner's device involved in every add, which no server-side design can avoid.
2. **Location in downloads.** A `downloader` link serves the original, EXIF and all. Stripping GPS
   means re-encrypting a stripped copy as another Drive file. Is a per-link "remove location" option
   worth that? (`PUT /photos/{id}/share-settings` already records a `strip_gps` preference that
   nothing enforces for encrypted files.)
3. **Item limit per link.** Proposed: 500, so link creation is a bounded request.
4. **Visibility.** Proposed: these links are always `anyone_with_link`, never `public` (indexable).
