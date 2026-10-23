# UI look-and-feel roadmap

**Status:** proposal, 2026-10-21 — light mode at comfortable density. Dark mode and the compact /
spacious densities follow once the light versions are signed off.
**Scope:** the web client.
**Mockups:** [Neutrino UI Refresh Mockups](https://claude.ai/artifact/SBPrEaMZVuWHztKnJLmrM8) — one
row per look, each with Drive, Docs and Sheets; each board has a `look` tweak to flip between them
on the same screen, and hover states work in Play mode.
**Companions:** [`ui-roadmap.md`](ui-roadmap.md),
[`ui-customization-roadmap.md`](ui-customization-roadmap.md),
[`ui-performance-roadmap.md`](ui-performance-roadmap.md).

**The decision:** Neutrino ships **three looks** — **Light Flow**, **Quiet Precision** and
**Blended Flow** — over **one** structure and **one** token system. A look is a set of token
values plus a handful of structural switches, never a second copy of the CSS. Users pick one;
organisations can set the default or lock it (customization roadmap §3.3, §6.2).

---

## 1. Why the UI looks the way it does today

Not a matter of taste; the source shows it.

- **Stock framework values.** The neutrals are Tailwind's gray ramp (`#f9fafb` … `#111827`), the
  accent is Tailwind's `blue-600` (`#2563eb`), the shadows are Tailwind's `shadow-sm`…`xl`
  verbatim (`tokens/src/colors.css`, `shadows.css`). Nothing reads as Neutrino.
- **One accent for every app.** `data-app="drive"` is hard-coded on `<html>`, so Docs, Sheets and
  Photos all wear Drive's blue; the per-app theme file (`tokens/src/themes/drive-theme.css`) is the
  only one that exists.
- **Small, inconsistent type.** 17 distinct font sizes; the most common are 13, 12 and 11 px. UI
  text at 11–12 px reads cramped and is hard on accessibility.
- **Inconsistent shape and layering.** 16 distinct radii (3, 4, 6, 8, 10 px…), 26 distinct
  z-indexes, 98 hand-written box-shadows beside the four tokens.
- **Chrome stacked on chrome.** A 64 px logo row and a 64 px top bar, dashed-border upload button,
  bordered everything — every region is outlined, so nothing has priority.
- **Tokens are optional.** 822 hard-coded `font-size: Npx` vs 377 tokenised; 1 363 px spacings vs
  852; 472 px radii vs 328; 1 821 hex fallbacks inside `var()` that hide missing tokens; 829 inline
  `style={{…}}` sites in 148 files.

The last point is the real problem: a redesign applied to tokens alone would change only about a
third of the UI. The migration in §6 is most of the work.

---

## 2. What all three looks share

These rules hold in every look; only the values in §4 differ.

### Structure

- **No separate app bar.** Apps live in the sidebar under an **Apps** heading, below the Drive
  views (My Drive, Shared with me, Recent, Starred, Trash) and above Teams — the current
  `navSections.ts` order. The logo sits at the top of the sidebar.
- **One top bar** (Drive and the listings): logo, a centred search field that is also the command
  palette (⌘K), the "End-to-end encrypted" pill, notifications, account. It replaces today's
  stacked logo row and top bar.
- **One editor frame** for Docs, Sheets, Slides, Diagrams and Drawing: the sidebar stays (with a
  collapse control) and the editor's own title bar carries the document icon in its app colour,
  the title, the File/Edit/View… menus, the save state ("Saved and encrypted · just now"),
  presence avatars, Comments and Share. Below it, one formatting toolbar.
- **Encryption as a quiet trust signal**, not a warning: the top-bar pill, the save state, the
  toast ("Encrypted on this device before upload"), and one plain-language line in the Share dialog
  ("Each person gets their own copy of the file key… The server can't open this spreadsheet").

### Colour

- **Brand accent:** `#3346E8`, a deeper, more saturated blue than today's, used for the logo, the
  primary action and selection. Contrast 6.6:1 on white.
- **Per-app identity colours**, used for the app's icon, its document icon in listings and
  quick access, and (in Blended Flow) its wash. They identify; they never carry text.

  | Docs | Sheets | Slides | Notes | Photos | Calendar | Diagrams | Drawing |
  |---|---|---|---|---|---|---|---|
  | `#2F6FE4` | `#13945A` | `#D97706` | `#B88A00` | `#D6336C` | `#0E8C8C` | `#7A4FDB` | `#E0533D` |

- **Neutrals** are a cool grey ramp of our own (text `#16181D` / `#4A5160` / muted `#656C7A`),
  not Tailwind's. Muted text passes 4.5:1 on every surface it sits on.

### Type

- **UI:** Inter, self-hosted as a variable font (performance roadmap P5). **Base UI size 14 px**;
  nothing below 12 px.
- **Scale, six steps:** 12 · 13 · 14 · 16 · 22 · 32 px, replacing the 17 sizes in use.
  Headings use −0.02 em tracking and weight 650.
- **Numbers:** JetBrains Mono for sizes, storage figures, shortcut hints and cell references;
  `tabular-nums` in the grid.
- **Document content keeps its own fonts** (Source Serif in the Docs mockup) — the UI font never
  leaks into the page.

### Shape

Four radii: **8 px** controls and rows, **10 px** inputs and buttons, **12 px** cards and menus,
**16 px** dialogs; `999px` for pills and avatars.

### Iconography

Line icons (lucide, already a dependency) at 1.8 px stroke, 16–20 px. File types are the app's own
icon in its identity colour — no coloured tiles behind them.

### Menus, popups and translucency

- **Every transient surface is frosted:** menus and submenus, the command palette, dialogs, toasts.
  `background: rgba(255,255,255,0.74–0.82)` with `backdrop-filter: blur(22–28px) saturate(1.5)`,
  a hairline at 8 % ink, and a two-layer soft shadow. Dialogs and the palette add a 16–22 % scrim
  with a 2–3 px blur behind.
- **Menu groups are separated by space (8 px), not by rules.**
- **Toasts are dark frosted** (`rgba(22,24,29,0.84)`) so they read over any content.
- **Only transient surfaces blur.** Never the top bar, sidebar or toolbar over scrolling content —
  that is a per-frame GPU cost (performance roadmap §7). Under `prefers-reduced-transparency`, or
  the user's "reduce transparency" setting, every frosted surface falls back to opaque.

The mockups show the full set: Drive's row menu with an "Open with" submenu and the upload toast,
the ⌘K palette (Blended Drive board), Docs' Insert menu with a table-size picker, and Sheets' Share
dialog.

### Interaction states

- **Hover:** a light 1 px border appears (12 % ink) and the background shifts by ~3.5 % ink. The
  border slot is always present (transparent at rest) so nothing moves on hover.
- **Pressed / selected:** a tint of the accent (`#EEF0FE`) with the text darkened — never a solid
  fill in the flow looks.
- **Focus:** a 2 px accent ring offset 2 px; inputs get a 3 px accent halo at 14 % opacity.

---

## 3. The three looks

### 3.1 Light Flow — one seamless surface

*The header, toolbar and document are one continuous white page.*

- **Ground and every surface are `#FFFFFF`.** Regions are told apart by spacing and type
  weight alone.
- **No horizontal separators** — not between the title bar and toolbar, the toolbar and the
  document, rows in a list, the formula bar and the grid, or above the status bar. (A spreadsheet's
  own cell gridlines stay, at `#F0F1F4`; they are content.)
- **Buttons have no border at rest.** The hover rule in §2 brings one in.
- **No filled buttons.** The primary action (New, Share, Done) is accent-coloured text and icon,
  picking up a soft accent border (35 %) and a pale accent ground (`#F3F4FE`) on hover.
- **Selection** is the pale accent tint; the active filter chip is a neutral tint with bold text.
- **Documents sit directly on the page** — no paper card, no drop shadow. The comment in the margin
  is plain text with an avatar, not a card.
- Search field and segmented controls use a barely-there fill (`#F4F5F7`) as their only boundary.

**Feels like:** a quiet writing tool. **Best for:** people who live in documents.

### 3.2 Quiet Precision — every element floats

*A cool neutral ground (`#EEF0F3`); every functional element is its own white sheet.*

- **Each element is a separate card** — 14 px radius, 1 px `#E3E6EB` border, soft two-layer shadow
  (`0 1px 2px` at 4 % + `0 6px 20px` at 5 %), 8–10 px gaps between them:
  - Drive: top bar · sidebar · Quick access · the Files list (title, filters and table together).
  - Docs: sidebar · title bar · toolbar pill (centred) · page · comment · status bar.
  - Sheets: sidebar · title bar · toolbar pill · formula bar · grid · sheet tabs.
- **Inside a card**, list rows keep hairline dividers (`#F0F2F5`) — the card is the boundary,
  the dividers are row rhythm.
- **Primary actions are filled** (`#3346E8`, white text, 1 px shadow) — the one look where a solid
  button is right, because it sits on a white card on a grey ground and needs to lead.
- **The document is a paper sheet** with a top radius and a soft shadow on the grey ground.
- The active sidebar entry is a pale accent tint; hover uses `#F6F7F9` with a `#D4D8E0` border.

**Feels like:** an instrument panel. **Best for:** people who work across many files and apps at
once and want each region to hold still.

### 3.3 Blended Flow — seamless, with colour

*Light Flow's continuous surface, with the current app's colour washing down from the top.*

- **A vertical wash in the app's identity colour**: Drive and Docs blue
  (`#E4E9FF → #EEF1FF → #F8F9FF → #FFFFFF` over ~700 px), Sheets green (`#D8F0E2 → … → #FFFFFF`
  over ~340 px). The header, toolbar and the top of the document all sit in it; the page fades to
  white where the work is.
- Everything from Light Flow holds — **no separators, borderless buttons until hover, no filled
  buttons** — but neutrals are tinted toward the app colour (text `#3F4767`, muted `#5D6584` in
  Drive) and hover is a frosted white (`rgba(255,255,255,0.55)`) with an accent-tinted border.
- Search, active nav and pressed controls are translucent white over the wash, so the colour shows
  through.
- Popups carry the tint: menus at `rgba(246,247,255,0.7)`, shadows tinted toward the accent, the
  toast in deep blue.

**Feels like:** the app has a place. **Best for:** people who switch apps often and want to know
where they are at a glance.

---

## 4. Token architecture

One structure, three value sets. The look is an attribute on `<html>`, applied before first paint
by the boot cache (customization roadmap §3.2):

```html
<html data-look="flow" data-theme="light" data-app="sheets" data-density="comfortable">
```

`data-app` stops being hard-coded and follows the route, so per-app colour and Blended's wash come
from one attribute.

### Token groups

| Group | Tokens (new or renamed) | Light Flow | Quiet Precision | Blended Flow |
|---|---|---|---|---|
| Ground | `--surface-ground` | `#FFFFFF` | `#EEF0F3` | app wash gradient |
| Region | `--surface-region`, `--region-border`, `--region-radius`, `--region-shadow`, `--region-gap` | transparent, none, 0, none, 0 | `#FFFFFF`, 1 px `#E3E6EB`, 14 px, soft ×2, 10 px | transparent, none, 0, none, 0 |
| Separators | `--rule`, `--row-rule` | none, none | `#E3E6EB`, `#F0F2F5` | none, none |
| Buttons | `--button-border-rest`, `--button-border-hover`, `--button-bg-hover` | transparent, 12 % ink, 3.5 % ink | `#E3E6EB`/transparent, `#D4D8E0`, `#F6F7F9` | transparent, 24 % accent, 55 % white |
| Primary | `--primary-bg`, `--primary-fg`, `--primary-border-hover` | transparent, accent, 35 % accent | accent, white, accent | transparent, accent, 40 % accent |
| Paper | `--paper-bg`, `--paper-shadow`, `--paper-radius` | white, none, 0 | white, soft, 8 px top | transparent, none, 0 |
| Glass | `--glass-bg`, `--glass-border`, `--glass-shadow`, `--glass-filter`, `--scrim`, `--scrim-filter` | 74 % white | 82 % white | 70 % tinted white, accent-tinted shadow |
| Neutrals | `--text-1/2/3` | `#16181D` `#4A5160` `#656C7A` | same | tinted toward the app colour |
| App | `--app-color`, `--app-wash-from/-to` | used for icons | used for icons | icons **and** wash |

Below these, each primitive has its own small group, so its CSS names a token and never a look:
buttons by variant (`--button-bg-rest`, `--ghost-*`, `--primary-border-rest`, `--primary-bg-hover`,
`--danger-*`), fields (`--field-bg/-border/-border-hover/-border-focus/-ring`), selection
(`--selected-bg/-fg`), chips (`--chip-*`), menus (`--menu-radius`, `--menu-item-hover`,
`--menu-separator`), dialogs (`--dialog-radius/-shadow/-rule`), toasts (`--toast-*`, with an opaque
fallback for reduced transparency), `--control-radius` and `--accent-ui`. Classic's value for each
is what the component drew before it read the token (`packages/tokens/src/looks.css`).

Density (`--row-height`, `--control-height`, `--space-*` multipliers) is a separate axis that
multiplies across all three looks; the windowed lists read `--row-height` (performance roadmap P1).

### Rules for components

- **No literal colours, sizes, radii, shadows or z-indexes in component CSS.** Lint for it
  (`stylelint` with `declaration-property-value-disallowed-list` for px font sizes, hex outside
  `tokens/`, and numeric z-index) and ratchet the count down per release.
- **No hex fallbacks inside `var()`.** A missing token should fail visibly in development, not
  quietly render the 2024 palette.
- **Structural switches are tokens too.** "Does this region have a card?" is `--surface-region` /
  `--region-border`, not a `data-look` branch in each component; the handful of genuine structural
  differences (Precision's centred toolbar pill) are one attribute selector in the shell.
- **The legacy `data-theme` presets** (glass, midnight, beach, forest, sunbeams, light-glass)
  become colour themes that apply on top of any look; custom themes keep working because they
  only ever set colour tokens.

---

## 5. Screens

What the mockups specify, per screen, in every look:

- **Drive:** top bar; sidebar (New, Drive views, Apps, Teams, storage meter); **Quick access** —
  four recent files with previews — as its own section above **My Drive**, which holds the sort and
  view controls, the type chips and the list. Rows are 44 px with the app icon, name, shared
  marker, owner avatar, friendly date and mono size.
- **Docs:** editor frame (§2); toolbar of undo/redo, style, font, size, B/I/U, link, list, align,
  Assist; page with margin comments; status bar (page, word count, language, zoom).
- **Sheets:** editor frame; toolbar; formula bar with a mono name box and colour-coded reference;
  grid with header highlight for the selected column/row, a 2 px selection ring and a range tint
  for formula references; sheet tabs with the running Sum.

Still to mock before build: Slides, Notes, Photos, Calendar, Diagrams, Drawing, Settings, sign-in,
empty states — each inheriting the shell and editor frame rather than inventing its own.

---

## 6. Migration plan

| Phase | Contents | Exit criterion |
|---|---|---|
| **0 — Sign-off** | Dark mode for each look; compact and spacious densities; the screens still to mock | Approved boards for all three looks × light/dark × three densities |
| **1 — Token contract** | New token groups (§4) in `packages/tokens`, all three look value sets, `data-look` / dynamic `data-app`; lint rules in warn mode; remove `var()` hex fallbacks | Tokens exist and lint reports the baseline debt |
| **2 — Primitives** | `@neutrino/ui` Button (rest/hover/primary per look), inputs, chips, menus, Popover/Modal/Toast glass, Tabs — all token-only | Storybook shows every primitive in all three looks — **done in Stage 2**: *Looks/All primitives* renders them side by side in light and dark, the toolbar's Look switch covers the portalled dialogs, and classic's computed styles are unchanged |
| **3 — Shell** | New top bar, sidebar with Apps, editor frame; delete the logo row and the stacked bars | Every route renders in the new shell in all three looks — **done in Stage 3**: `@neutrino/layout`'s `ShellTopBar`, `ShellSidebar` and `AppShell variant="flow"` render every route in the three new looks (classic keeps today's shell); the editors get the frame — no top bar, the brand, search, notifications and account in the sidebar — while their own title bars and toolbars keep today's styling until phase 5 |
| **4 — Drive and listings** | `FileGrid` restyle **on the windowed version** (performance P1 lands first), Quick access, DocumentLibrary pages | Drive matches the mockups — **done in Stage 4**: a listing token group in `looks.css` (classic's values are what FileGrid drew, so classic is unchanged); in the new looks Drive is two regions on the ground, Quick access (the four files last edited, as preview cards) and Files (the folder as the title, the controls, chips and a `--row-height` list), and every `DocumentLibrary` page is one such region. Diagrams moved onto `DocumentLibrary`. Not built: the Owner column (the listing carries no owner, and in My Drive it is always you) and friendly dates in the list's Modified column; Photos stays its own timeline — it is not a file listing |
| **5 — Editors** | Docs, Sheets, Slides, Diagrams, Drawing chrome and panels, one editor at a time | Each editor matches; lint debt for that editor at zero |
| **6 — Everything else** | Photos, Calendar, Notes, Settings, admin, sign-in, dialogs; lint rules to error | Zero lint debt; no hard-coded visual values outside `tokens/` |

The three looks become selectable once phase 3 (the shell) is complete, and the current look stays
the default until the Docs and Sheets editors are done in phase 5, so nobody is defaulted into a
half-migrated UI — see [`ui-roadmap.md`](ui-roadmap.md), stage 5.

---

## 7. Where this meets the other two roadmaps

- **Customization** consumes the looks as a preference (`appearance.look`, user-choosable,
  org default and lock) and adds density, type size, shape and accent on top. Its theme engine v2
  depends on phases 1–2 here; the migration is what makes those settings reach every screen.
- **Performance**: the windowed `FileGrid` lands before its restyle; fonts are self-hosted; blur is
  confined to transient surfaces with an opaque fallback; the Blended wash is a static gradient on
  the ground (cheap), not on scrolling content.
