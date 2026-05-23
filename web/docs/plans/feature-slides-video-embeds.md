# Implementation Plan: Slides Video Embeds

## Branch
`feature/slides-video-embeds`

## What is changing and why

Adding a new `VideoElement` slide element type that allows users to embed videos (YouTube, Vimeo, Loom, and MP4/direct URLs) in their presentations. This is item 1 from `web/docs/slides-rich-embeds.md` and is identified as a high-value, medium-difficulty addition.

## Layers affected

- **Type system** (`slideEditorTypes.ts`): Add `VideoElement` interface, extend union `SlideElement`
- **Helpers** (`slideEditorHelpers.ts`): Add `getVideoEmbedInfo` URL parsing utility
- **Canvas rendering** (`SlideCanvas.tsx`): Add `video` case — placeholder in edit mode, iframe/video in present mode
- **Editor UI** (`SlideEditor.tsx`): Toolbar button + URL input dialog + property panel section
- **Presenter view** (`PresenterView.tsx`): Render video iframes/tags in presentation mode
- **CSS** (`page.module.css`): Styles for video placeholder, dialog, property panel rows
- **Feature flag** (`featureFlags.ts`): `feature.slides.videoEmbeds` off by default

## Specialist agents

- `frontend-developer`: Types, helpers, canvas rendering, editor UI, presenter view
- `ui-designer`: CSS for video placeholder, URL input dialog, property panel

## Feature flag

- Name: `slidesVideoEmbeds`
- Env var: `NEXT_PUBLIC_FEATURE_SLIDES_VIDEO_EMBEDS`
- Default: off
- The toolbar "Video" button and the video rendering path are both gated by this flag

## Architecture decisions

1. `VideoElement` is a standalone type (not a generic `EmbedElement`) per the instructions
2. In edit mode (SlideCanvas), render a dark placeholder box with provider label — no live iframe so mouse events work for drag/resize
3. In present mode (PresenterView), render live iframe (YouTube/Vimeo/Loom) or `<video>` (MP4)
4. `getVideoEmbedInfo` parses URLs and returns `{ provider, embedUrl, thumbnailUrl? }`
5. YouTube thumbnail uses `https://img.youtube.com/vi/ID/hqdefault.jpg`
6. Iframe sandbox: `allow-scripts allow-same-origin allow-presentation allow-popups`
7. `allowFullScreen` on all iframes
8. Property panel in the right panel shows autoplay / loop / muted / startSeconds controls when a video element is selected

## VideoElement interface

```ts
export interface VideoElement {
  id: string;
  type: 'video';
  x: number;        // percentage 0-100
  y: number;
  w: number;
  h: number;
  url: string;      // raw URL pasted by user
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
  startSeconds?: number;
  animation?: ElementAnimation;
}
```

## getVideoEmbedInfo logic

- YouTube: `youtube.com/watch?v=ID` or `youtu.be/ID` → embed `https://www.youtube.com/embed/ID`
- Vimeo: `vimeo.com/ID` → embed `https://player.vimeo.com/video/ID`
- Loom: `loom.com/share/ID` → embed `https://www.loom.com/embed/ID`
- MP4/fallback: use url as-is in a `<video>` tag

## Acceptance criteria

- [ ] `VideoElement` type exists and is in the `SlideElement` union
- [ ] `getVideoEmbedInfo` correctly parses YouTube, Vimeo, Loom, and MP4 URLs
- [ ] Toolbar "Video" button visible when feature flag is on
- [ ] Clicking toolbar button opens URL input dialog
- [ ] Valid URL inserts a video element onto the canvas
- [ ] Edit mode shows dark placeholder with provider name
- [ ] Property panel shows video controls (autoplay, loop, muted, startSeconds) when video selected
- [ ] Presenter mode renders live iframe or video tag
- [ ] Video element can be dragged, resized, and deleted
- [ ] `pnpm type-check` passes with no new errors

## Known risks / edge cases

- URL input must gracefully handle invalid/unknown URLs (fall back to mp4/generic)
- Autoplay requires `muted=true` in most browsers; the UI should reflect this
- iframe pointer-events must be `none` in edit mode to allow drag/resize
- Loom URLs may come in variants; handle both `loom.com/share/ID` and `www.loom.com/share/ID`
