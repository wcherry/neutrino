# Live Photos: one convention for every client

**Status:** Accepted (2026-11-14). Decided in wcherry/neutrino_drive_ios_mobile#45; implemented by
wcherry/neutrino#315 (web, server) and wcherry/neutrino_photos_ios_mobile#27 (Photos iOS). Drive iOS
registers to it (wcherry/neutrino_drive_ios_mobile#51).

An Apple Live Photo is two files: a still (`IMG_1234.HEIC`) and a ~3 second clip (`IMG_1234.MOV`).
Three clients put them in a user's library — the web (local folder import, Google Takeout), Neutrino
Photos on iOS, and Drive iOS's photo sync — and every client has to show the pair as **one** Live
Photo, play it, and (on iOS) save it back to Apple Photos as one. Before this document, the web and
Photos iOS linked the halves in two incompatible ways, so a Live Photo imported on one was a plain
still on the other.

Google Motion Photos (one file, the MP4 appended to the JPEG) are unaffected: there is no second file
to link. See `web/packages/api-photos/src/motionPhoto.ts`.

## The rules

1. **The still carries the link.** Its photo record's metadata has `motionPhoto` **and**
   `device.liveVideoFileID` — the Drive file id of the clip.
2. **The clip is registered too**, with its own `metadata.motionPhoto`. The web finds clips through
   the photo library as well as through Drive, and a registered clip carries what the web reads.
3. **A claimed clip never shows on its own.** Every client hides a registered video that some still
   claims, so a Live Photo is one tile in the timeline, albums, search and counts. Claimed means, in
   order: the still's `device.liveVideoFileID` names it; else both halves carry the same
   `motionPhoto.contentIdentifier`; else (web only, for libraries imported before any of this)
   their filename stems match.
4. **Metadata is never written as a whole document from a client.** Use
   `PATCH /api/v1/photos/{id}/metadata` (below), which merges. A client that writes the whole
   document with `PUT` erases every key it doesn't know about — another client's `motionPhoto`, or a
   field a later build adds.
5. **Where the clip lives is each client's business.** Next to the still under the same stem (the
   web, Drive iOS — what Apple's own export and Google Takeout do), or in `Live Photos/` named
   `<stillFileId>.live.mov` (Photos iOS). The link is by id, not by folder or name.

## The metadata

Both live in a photo record's `metadata` document (`photos.metadata`, JSON).

```jsonc
{
  "motionPhoto": {
    "subtype": "live_photo_apple",          // or "motion_photo_google"
    "signal": "com.apple.quicktime.content.identifier",  // what classified it
    "contentIdentifier": "6A1F…",           // Apple's UUID shared by still and clip, when read
    "stillImageTime": 1.53                   // seconds into the clip of the key frame, when read
  },
  "device": {                                // Neutrino Photos iOS's `MediaDeviceFacts`, key for key
    "localIdentifier": "…/L0/001",           // the PHAsset on the importing device
    "isLivePhoto": true,
    "isRAW": false,
    "subtypes": ["live", "hdr"],
    "liveVideoFileID": "<clip's Drive file id>"   // on the still only
  }
}
```

Every field is optional. A reader treats an absent one as unknown, never as false.

## Writing it

| Endpoint | Use it for |
|---|---|
| `POST /api/v1/photos` | Registering a file, with its initial `metadata`. **Idempotent per file:** an already-registered file answers with its existing record *unchanged* — `metadata` is not applied. A client that needs its keys there checks the returned record and merges. |
| `PATCH /api/v1/photos/{id}/metadata` | Adding or changing keys. An RFC 7396 JSON Merge Patch: objects merge recursively, `null` removes a key, anything else replaces. Read and write are one transaction. Returns the merged document. |
| `PUT /api/v1/photos/{id}/metadata` | Replaces the whole document. Kept for compatibility; no client should write with it (rule 4). |

So linking a still to its clip is one call, whatever else the record holds:

```http
PATCH /api/v1/photos/{stillPhotoId}/metadata
{ "device": { "liveVideoFileID": "<clip file id>" } }
```

## What each client does

**Web** (`web/packages/api-photos/src/motionPhoto.ts`, `web/apps/web/src/lib/motionLinks.ts`)
- `pairMotionPhotos` pairs by `liveVideoFileID` first, then content identifier, then stem. Clip
  candidates come Drive-wide (`photosApi.listMotionCandidates`), so a linked clip pairs even where it
  isn't registered and isn't named like its still.
- Writes the link wherever it made a pair without one: at the end of a local or Takeout import run
  (`linkMotionPairs`), and as the library is browsed (`useMotionLinkBackfill` — the repair for
  libraries imported before this). Always through the merging `PATCH`.
- Registers both halves at import, each with its `motionPhoto` (unchanged).

**Neutrino Photos iOS** (wcherry/neutrino_photos_ios_mobile#27) — registers the clip with
`motionPhoto`, puts `motionPhoto` on the still beside `liveVideoFileID`, writes metadata by merging,
hides claimed clips, and backfills its existing Live Photos.

**Drive iOS** (wcherry/neutrino_drive_ios_mobile#51) — when "Show in Neutrino Photos" is on,
registers the clip, then the still in one complete write with `motionPhoto` and `liveVideoFileID`.

## Why the link is an id

The two older mechanisms each fail somewhere. A filename stem breaks the moment a clip is stored
under another name (Photos iOS does exactly that), and Apple's content identifier is read from the
clip easily but from the still only out of a MakerNote nothing here parses — so it is often present
on one half only. A file id is known to whichever client uploaded the pair, survives renames and
moves, and costs one lookup to follow.
