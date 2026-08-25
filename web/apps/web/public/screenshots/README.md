# Landing page screenshots

## Web app (generated)

`drive.png`, `docs.png`, `sheets.png`, `slides.png`, `notes.png`, `photos.png`
and `calendar.png` are real captures of the running app at 2000×1250 (a 1600×1000
viewport at 2× DPI, downscaled). They are referenced by the app showcase on `/`.

To regenerate: run the server against a throwaway database, seed it with demo
content, and capture at a 1600×1000 viewport with `deviceScaleFactor: 2`. Keep the
dimensions consistent — the showcase reserves a 2000×1250 box, and mismatched
sizes will shift the layout as images load.

## Native clients (supplied by hand)

The platform cards on `/` expect these files. Until one exists, the card renders a
dashed placeholder naming the missing path rather than a broken image.

| File | Card | Suggested size | Status |
|------|------|----------------|--------|
| `desktop-macos.png` | macOS desktop | 2000×1250 (16:10 window capture) | Supplied |
| `ios-notes.png` | iOS — Notes & Docs | 1290×2796 (iPhone portrait) | Missing |
| `ios-drive.png` | iOS — Drive | 1290×2796 (iPhone portrait) | Missing |

Screenshots with photographic content (a desktop wallpaper, say) compress badly as
truecolour PNGs — `desktop-macos.png` was 3.2 MB before being reduced to a 256-colour
palette, which is visually indistinguishable at the size the card renders and lands in
the same weight class as the flat UI captures. Quantise before committing one.

After dropping a file in, set `hasImage: true` on the matching entry in the
`platforms` array in `apps/web/src/app/page.tsx`. The cards letterbox whatever
you give them, so portrait phone captures and landscape window captures both
work without cropping.
