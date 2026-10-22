# UI customization roadmap

**Status:** proposal, 2026-10-21. **Scope:** the web client, for three audiences — **end users**,
**teams**, and **organisation administrators / self-hosters**. A third-party plugin or extension
API is deliberately out of scope (§9).
**Companions:** [`ui-roadmap.md`](ui-roadmap.md),
[`ui-performance-roadmap.md`](ui-performance-roadmap.md), and the custom-themes plan this builds on,
[`plans/feature-custom-themes.md`](plans/feature-custom-themes.md).

The one-sentence version: **today customization means picking colours; the goal is a workspace
whose look, density, layout, commands and defaults can be shaped by the person, their team and
their organisation — resolved in one place, applied before first paint, and synced everywhere.**
Most of the work is the foundation in §3, not the features in §4–6; the features are each small
once the foundation exists, and each is a mess without it.

---

## 1. What exists today

| Capability | Where | Limit |
|---|---|---|
| Nine preset themes + user-defined custom themes, shareable publicly | `tokens/src/colors.css`, `providers/ThemeProvider.tsx`, `CustomThemesProvider.tsx`, `src/themes/` | **Colour only** — 24 allowlisted `--color-*` tokens (`src/themes/dto.rs`). No type, spacing, radius, density, elevation. |
| Admin-imported fonts | `admin/FontsTab.tsx`, `CustomFontsProvider.tsx` | Instance-wide font library; no per-user UI font choice. |
| Sidebar collapse | `layout/AppShell.tsx` (`neutrino.sidebar.collapsed`) | The only layout preference. |
| Calendar week start, day hours; spell-check; brush; Photos face detection | assorted `localStorage` keys | Per device, per browser. |
| AI provider + **API key** | `neutrino.ai.settings` in `localStorage` (`@neutrino/api-core/ai.ts`) | A secret in plaintext browser storage, re-entered on every device. |
| User-authored libraries — CF templates and variables, gradient and fill presets, diagram shape libraries | `neutrino:sheets:cf-*`, `neutrino:*:gradientPresets`, `neutrino:diagrams:shapeLibraries`, … | **Content stored as a preference**: lost on a new device, invisible to teammates. |
| Keyboard shortcuts | 35 files each registering their own `keydown` listener | No registry, no remapping, no discoverability, no command palette. |
| Organisation identity | `data-app="drive"` hard-coded on `<html>` | No instance name, logo, accent or sign-in page branding. |

Two smells worth naming because the design in §3 exists to remove them:

1. **Two sources of truth for the same preference.** The theme is written to `localStorage`
   *and* to the server profile (`theme` on `UpdateProfileRequest` / `user_profiles`). Nothing
   reconciles them, so a second device shows whichever it last wrote locally.
2. **Roughly 25 `localStorage` keys, each with its own read/parse/validate/listen code.** Adding a
   preference means writing all of that again, and every one of them is per-device.

**And the reason "beyond colour" isn't possible yet:** the styles don't consistently read tokens.
Across `web/` source CSS there are 822 hard-coded `font-size: Npx` against 377 that use a token,
1 363 px paddings/margins/gaps against 852 tokenised, 472 px radii against 328, 17 distinct font
sizes, 16 distinct radii, 26 distinct z-indexes, and 1 821 hex fallbacks inside `var()` that mask
missing tokens. A density or type-scale setting changes nothing on a component that ignores the
token. The look-and-feel migration is what fixes this; customization depends on it (§8).

---

## 2. Principles

1. **Customization is data, never code.** Users, teams and admins choose values from a declared
   schema; they never supply CSS, HTML or scripts. This is what keeps it safe in an E2EE product
   and keeps the UI maintainable — §6.4 explains why arbitrary custom CSS is rejected.
2. **One resolution chain.** Every setting resolves through the same layers in the same order
   (§3.1). A component asks for `density` and gets one answer; it never looks at storage.
3. **Applied before first paint, reconciled after.** Anything that changes how the page looks is
   applied synchronously from a local cache; the server copy reconciles in the background. No
   preference fetch on the critical path (performance roadmap P4).
4. **Synced by default, device-local by declaration.** A preference follows the user to every
   device unless its schema says it is device-specific (e.g. "reduce motion on this laptop").
5. **Secrets and personal content are encrypted.** The same client-side keys that protect files
   protect any preference the server has no business reading.
6. **Tokens are the contract.** Themes, density, type scale and the organisation's brand are all
   expressed as token values. A component that hard-codes a value is a bug against this contract.

---

## 3. The foundation

### 3.1 One preference model with layered resolution

A **preference registry** — the same idea as the feature-flag catalogue (`FLAG_KEYS`): a single
declared list, tests that fail when the halves disagree, and no undeclared key ever read.

```ts
// packages/preferences/src/registry.ts — sketch
definePreference('appearance.density', {
  type: enumOf('compact', 'comfortable', 'spacious'),
  default: 'comfortable',
  scopes: ['org', 'team', 'user', 'device'],  // who may set it
  sync: 'plain',                               // 'plain' | 'encrypted' | 'device'
  appliesBeforePaint: true,                    // mirrored into the boot cache
});
```

**Resolution order, most specific wins, with an organisation lock on top:**

```
org lock ─► device ─► user ─► team (in a team context) ─► org default ─► product default
```

- **Product default** — the registry's `default`.
- **Org default** — set by an administrator; what a new account starts with.
- **Team default** — applies inside that team's space (its library, its files), e.g. a team accent
  or default view. Outside the team it doesn't apply.
- **User** — the person's own choice, synced.
- **Device** — only for keys that declare `scopes` including `device`.
- **Org lock** — an administrator can pin a value; the UI then shows the setting disabled with
  "Set by your organisation" rather than hiding it (the feature-flag doc's lesson: a setting that
  silently stops applying is worse than one that says why).

`usePreference('appearance.density')` returns the resolved value plus **where it came from**, so
Settings can say "Compact — your team's default" and offer to override it.

### 3.2 Storage and sync

| Tier | Holds | Server | Example keys |
|---|---|---|---|
| `plain` | Appearance and behaviour | New `user_preferences` table: `(user_id, key, value_json, updated_at)`, values validated against the registry server-side | theme, density, look, sidebar order, default views |
| `encrypted` | Secrets and personal content | One sealed blob per user, encrypted with the user's key exactly like a file DEK; the server stores bytes it cannot read | AI API key, saved places, personal snippet libraries |
| `device` | Per-browser only | Never leaves the device | "reduce transparency on this machine" |

- **`org_preferences`** and **`team_preferences`** tables hold the defaults and locks; only admins
  (org) and team Owners/Admins (team) write them, through routes in the authority modules that
  already exist (`src/drive/admin`, `src/drive/teams`).
- **Boot cache.** Every `appliesBeforePaint` value is mirrored into one `localStorage` record
  (`neutrino.prefs.boot`), which the existing anti-FOUC script in `app/layout.tsx` reads to set
  `data-theme`, `data-density`, `data-look` and the accent before React runs. This *replaces* the
  scattered keys, it does not add another one.
- **Cross-device sync** rides the per-user notification socket, the same way Drive listings do
  (`useDriveLiveUpdates`): a `preferences-changed` signal, then a re-read. No new socket.
- **Migration.** On first load after the change, each legacy `localStorage` key is read once,
  written through the new API, and deleted. The server-side `theme` column becomes the `plain` row
  and the duplicate write goes away — fixing smell 1 in §1.

### 3.3 Theme engine v2 — beyond colour

A theme becomes a set of token values across **five dimensions**, each a token group the
look-and-feel migration introduces:

| Dimension | Tokens | User-facing control |
|---|---|---|
| **Colour** | today's 24 + the per-app accents | Theme picker, accent picker |
| **Density** | `--space-*` multipliers, `--row-height`, `--control-height` | Compact · Comfortable · Spacious |
| **Type** | `--font-ui`, `--text-*` scale, `--leading-*` | UI font (from the instance's font library), text size |
| **Shape** | `--radius-*` | Sharper · Default · Rounder |
| **Surface style** ("look") | elevation, borders, separators, translucency | Light Flow · Quiet Precision · Blended Flow — the three looks in [`ui-look-and-feel-roadmap.md`](ui-look-and-feel-roadmap.md), so the redesign ships *as* a customization rather than beside it |

Two pieces of engine work make this safe for users rather than a way to produce unreadable UIs:

- **Accent derivation.** The user picks one colour; the engine generates hover, subtle, text-on and
  focus-ring variants and **adjusts lightness until text contrast passes 4.5:1** on the theme's
  surfaces. A user cannot create an accent that makes buttons illegible.
- **Accessibility settings are part of the theme, not separate from it:** reduce motion, reduce
  transparency (the translucent popups fall back to opaque), increased contrast, underline links.
  Each maps to tokens or a `data-*` attribute, and each defaults from the OS media query.

Custom themes keep their existing CRUD, sharing and server-side validation; their schema widens
from 24 colour keys to the five groups, with the same allowlist-and-strict-value rule
(`src/themes/dto.rs`) extended to lengths and enums.

### 3.4 A command and shortcut registry

> **Built in Stage 2** (`@neutrino/commands`). What shipped differs from the sketch below in
> three ways, each for a reason found in the code:
>
> - **The catalog is separate from the handlers.** `catalog.ts` lists every command (id, title,
>   app, default keys) whether or not its screen is loaded; a screen supplies the behaviour with
>   `useCommand(id, run)` while mounted. Settings › Keyboard — and later the palette — can then
>   name every shortcut without importing an editor. `when` became the handler's own `enabled`
>   flag, or a `run` that returns `false` to decline.
> - **Three kinds of key behaviour, not one.** Of the ~55 listeners there were, about half only
>   closed something on Escape; those are *dismiss layers* (`useDismiss`), and Escape now closes
>   the topmost one only — before, one Escape closed every open menu and dialog at once. Behaviour
>   that is not a nameable command (arrow keys moving a sheet's selection, type-to-edit, holding
>   Space to pan) is a *key handler* (`useKeyHandler`). Everything else is a command.
> - **One dispatcher, three listeners.** It listens on `window` for keydown in the capture and
>   bubble phases and for keyup. Bubble is the default, so an input's own `onKeyDown` and
>   ProseMirror's keymap still see a key first; capture exists for the one command that must beat
>   the focused element (Docs' ⌘K, which macOS Chrome otherwise takes as "delete to end of line").
>   A test fails if any other source file adds a key listener.
>
> Bindings are the `keyboard.preset` and `keyboard.bindings` preferences (plain tier). The presets
> change only what Google Workspace or Microsoft 365 binds differently for commands Neutrino has
> (find and replace in Sheets, the spell-check toggle). A binding without Ctrl, ⌘ or ⌥ never fires
> while typing, whatever the user maps it to. Not yet in the registry: ProseMirror's own keymaps
> inside the Docs and Notes editors (⌘B and friends) — they are element-scoped, not listeners, and
> move when the toolbars become command lists (§4, U10). Menu labels still print their shortcut as
> text; they read the keymap when the toolbars do.

Every action the UI can perform — *New spreadsheet*, *Share*, *Toggle sidebar*, *Bold*, *Insert
table*, *Switch density* — is registered once:

```ts
registerCommand({
  id: 'docs.insert.table', title: 'Insert table', app: 'docs',
  when: (ctx) => ctx.editor === 'docs' && !ctx.readOnly,
  defaultKeys: ['Mod+Alt+T'],
  run: (ctx) => ctx.docs.insertTable(),
});
```

One `keydown` listener in the shell dispatches through it, replacing the 35 independent ones (and
the conflicts between them that nobody can currently see). It gives three features at once:

1. **The command palette** (⌘K, in the mockups) — searches commands, files, people and settings.
2. **Remappable shortcuts** — Settings › Keyboard lists every command, its binding and any
   conflict; user bindings are a `plain` preference. Presets for people coming from Google
   Workspace or Microsoft 365.
3. **Toolbar and menu customization** (§4) — toolbars become ordered lists of command ids, so
   pinning, hiding and reordering are data.

### 3.5 Layout as data

The sidebar's sections already live in `navSections.ts`, separate from rendering; extend that to a
declared, user-orderable structure. Same for Drive's home/quick access, each list view's columns,
and each editor's toolbar. Each layout is a list of ids (apps, sections, columns, commands) with
visibility and order — validated against the registry so a stale id is dropped, never rendered as
a hole.

---

## 4. End users

In delivery order; each depends only on §3 items before it.

| # | Feature | Detail | Depends on |
|---|---|---|---|
| U1 | **Synced appearance** | Theme, accent, density, look and text size follow the user across devices | 3.1, 3.2 |
| U2 | **Density and text size** | Compact / Comfortable / Spacious; text size steps | 3.3 + token migration |
| U3 | **Accent picker with contrast guarantee** | Any colour; the engine keeps it legible | 3.3 |
| U4 | **Look presets** | Choose Light Flow, Quiet Precision or Blended Flow | 3.3 + L&F phases 1–3 |
| U5 | **Accessibility** | Reduce motion / transparency, higher contrast, link underlines | 3.3 |
| U6 | **Command palette** | ⌘K everywhere | 3.4 |
| U7 | **Shortcut remapping and presets** | Settings › Keyboard | 3.4 |
| U8 | **Sidebar customization** | Pin, reorder and hide apps and sections; pin folders, tags and team spaces | 3.5 |
| U9 | **Default views** | Per view: grid or list, sort, visible columns; Drive's landing page (Home, My Drive, Recent) | 3.5 |
| U10 | **Toolbar customization** | Per editor: pin, hide and reorder tools; compact or labelled toolbar | 3.4, 3.5 |
| U11 | **Personal libraries that sync** | CF templates, gradient and fill presets, shape libraries and table styles move from `localStorage` into the `encrypted` tier — lost-on-a-new-device stops | 3.2 |
| U12 | **Secrets that sync** | AI provider and key move into the `encrypted` tier, and out of plaintext `localStorage` | 3.2 |
| U13 | **Settings search** | Settings is a searchable list generated from the registry, not a hand-built page per tab | 3.1 |

**Built in Stage 4:** U2 (density and text size, Settings › Appearance), U3 (any accent, drawn
adjusted to 4.5:1 in light and dark, stored as picked — `lib/accent.ts`, the same arithmetic as the
instance brand), U5 (reduce motion, reduce transparency, higher contrast, each following the OS while
left at "as the device"), U8 (pin folders from their menu, hide entries and sections, reorder the
apps — `shell.sidebar`) and U9 (each listing remembers its view and sort, synced; Drive's landing
page). All of them apply before first paint where they are visual. Not yet: link underlines (U5),
visible-column choice (U9), pinning tags and team spaces (U8).

U11 and U12 are worth doing early even though they look unglamorous: one is data loss in slow
motion, the other is an API key sitting in plaintext on every browser the user has ever signed in
on.

---

## 5. Teams

A team is already a space with members, roles, a library and an activity feed (Team Spaces,
`src/drive/teams/`). Customization at team level means **shared defaults and shared libraries**,
written by Owners and Admins:

| # | Feature | Detail |
|---|---|---|
| T1 | **Team identity** | Accent and icon (today: a square `TeamAvatar` initial). The team's accent tints its space, so you can tell which team's library you're in. |
| T2 | **Team defaults** | Default view, sort and density inside the team space; members can still override for themselves (user beats team in §3.1). |
| T3 | **Team template gallery** | Templates published to the team: `.dotx` for Docs today; Sheets `.xltx` and Slides `.potx` once those editors keep the template content type on save (`web/CLAUDE.md`, templates section). |
| T4 | **Team libraries** | The personal libraries from U11, published to the team: CF templates, colour palettes, gradient presets, shape libraries, table styles. A team library is E2EE content and is sealed to members like any team file — it reuses `lib/teamTransfer.ts`'s reseal-to-members rule rather than inventing a second one. |
| T5 | **Pinned resources** | Owners pin folders, documents or links to the top of the space and to every member's sidebar section for that team. |
| T6 | **Team command presets** | A team can add shortcuts to its templates ("New incident report") to the command palette for its members. |

What a team **cannot** do: change another member's personal theme or shortcuts, or override an
organisation lock. A team default is a starting point, not a policy — policy is the org's.

---

## 6. Organisation administrators and self-hosters

### 6.1 Instance branding

Instance name, logo (light and dark), favicon, brand accent, a sign-in page message, and the
sender name and logo on notification emails (the Resend/SMTP pipeline from #259). Set in the admin
console; stored server-side.

**The delivery detail that matters:** production is a static export served by the Rust binary, so
there is no server render to put the brand into — and fetching it after load paints the default
brand first and then swaps, on the sign-in page of all places. The Rust server already decides how
`index.html` is served (`src/main.rs`, the two static mounts). It should **inject a small,
cache-busted `<script>`/`<style>` with the instance's brand tokens into the HTML it serves**, so
the brand is present at first paint with no extra request and no flash. That keeps the `/sign-in`
budget in the performance roadmap intact; a client-side branding provider would not.

### 6.2 Defaults and locks

Every registry key whose `scopes` include `org` can be given an organisation default, and
optionally **locked**. Examples worth shipping first: theme and look, density, AI assistant
(provider restricted or disabled entirely — relevant for organisations that forbid sending content
to third-party models), allowed UI fonts (from the font library that already exists), and the
default landing page.

### 6.3 Which apps an instance offers

A self-hoster who doesn't want Calendar or Photos should be able to hide them from the sidebar,
launcher and command palette for everyone. **This is a preference, not a feature flag** — the
feature-flag rules in `web/CLAUDE.md` are explicit that flags are for blast radius, not for
product configuration — so it is an org-scoped, lockable `apps.enabled` list in the registry. It
hides UI; it does not 404 the routes (which is the flag system's job).

### 6.5 Built in Stage 3

- **Defaults and locks** (§6.2): Admin › Organisation › Defaults and locks offers a default, and a
  lock, for every key whose scopes include `org` — look, theme, density, keyboard preset, AI
  provider, spell check, face detection, week start. A lock overrides each user's own value (their
  row is kept, only outranked), the server refuses user writes to it (403), and Settings shows the
  control disabled with "Set by your organisation". Org changes are pushed to every signed-in user
  on the notification socket (`NotificationHub::push_all`).
- **Apps** (§6.3): `apps.enabled`, an org-only key; hiding an app removes it from the sidebar, the
  New menu and the palette in both shells.
- **Branding** (§6.1): name, accent, sign-in message, logo (light and dark) and favicon, stored in
  `instance_branding`/`instance_branding_assets` and written into every page by
  `src/branding/inject.rs` — the brand data and the org layer as `window.__NEUTRINO_INSTANCE__`
  ahead of the anti-FOUC script, the accent as custom properties (`html:root[data-theme=…]`, so the
  light and dark palettes take it and the colour presets keep their own), the logo as CSS over the
  app's `data-brand="logo"` boxes, and the favicon. The ETag carries a hash of what was injected, so
  a revalidation is still a 304 until the brand or the org layer changes; the service worker now
  fetches pages network-first for the same reason. The accent must reach 4.5:1 on white (the server
  refuses anything lighter) and is lifted automatically until it reaches 4.5:1 on the dark ground.
  Images are PNG, WebP or ICO checked by their bytes, never SVG. **Not done:** the sender name and
  logo on notification emails.
- **Teams** (§5, T1–T2): a team's colour tints its space and marks it in the new sidebar; its
  colour is now validated as `#rrggbb` (it was stored unchecked, and drawn into every member's page).
  Owners and Admins set the space's default Files view, order and density; a member's own pick wins.

### 6.4 What admins don't get: arbitrary custom CSS

It is the obvious request and the wrong answer. Custom CSS couples every instance to internal
class names that change every release — the CSS Modules here generate hashed names, so it would
break on the first upgrade — and in an E2EE product an admin-controlled stylesheet is an exfiltration
channel (`background: url(https://…?…)` keyed off attribute selectors can leak what is on screen).
Token-level overrides (§3.3) give admins everything branding needs, through a validated schema.

---

## 7. Security and privacy

- **Validated on both sides.** Every preference value is checked against the registry type
  server-side, exactly as custom-theme tokens are today; the client sanitises again before writing
  any value into a `<style>` (`CustomThemesProvider`'s defence-in-depth rule).
- **Encrypted tier uses the existing keys.** The blob is sealed to the user's identity keypair
  like a file DEK; a lost key loses the blob, and recovery is the same recovery kit. Team
  libraries are sealed to members like team files.
- **Admin authority stays outside.** Org defaults and locks are written through the admin
  authority (`AdminUser`), never through a user route, matching the separation
  `src/drive/teams/admin_api.rs` documents for team quotas.
- **Nothing executes.** No preference, theme, team setting or brand can carry code.

---

## 8. Where this meets the other two roadmaps

Full treatment in [`ui-roadmap.md`](ui-roadmap.md).

- **Depends on the look-and-feel token migration.** Density, type scale, shape and look only work
  on components that read tokens. U2–U5 cannot ship ahead of the migration of the screens they
  affect; U1, U6–U13 can.
- **Constrained by performance.** Boot-cache application before paint; new providers mounted in the
  app shell, not the root; branding injected by the server, not fetched; the windowed lists reading
  row height from the density token; translucency gated by reduce-transparency and device capability.
- **The command registry is shared.** It is this roadmap's foundation and a small performance win
  (35 listeners → 1); build it once.

---

## 9. Out of scope, deliberately

**A plugin or extension API** — third-party code running in the client — was not requested and is
a different kind of decision. In an end-to-end-encrypted product, any plugin that can see a
document sees it in plaintext; a plugin system needs sandboxing (iframes with a capability-granting
message protocol), permission prompts, review and signing before it is safe. The command registry
(§3.4) and layout-as-data (§3.5) are the right internal shape for one if it is ever wanted, so
nothing here closes that door.

---

## 10. Phases

| Phase | Contents | Exit criterion |
|---|---|---|
| **1 — Preferences foundation** | Registry, `user_preferences` + encrypted blob, boot cache, socket sync, migration of the legacy keys; Settings generated from the registry | Every legacy `localStorage` preference read through `usePreference`; theme has one source of truth |
| **2 — Quick wins on the foundation** | U11 synced libraries, U12 synced AI secret, U1 synced appearance, U13 settings search | No user-authored content in `localStorage`; no secret in plaintext storage |
| **3 — Command registry** | 3.4, U6 palette, U7 remapping | One `keydown` listener in the app; every shortcut listed in Settings |
| **4 — Org and team layer** | `org_`/`team_preferences`, locks, 6.1 branding via server injection, 6.2 defaults, 6.3 apps list, T1–T2 | An admin can brand the instance with no flash and lock a setting |
| **5 — Theme engine v2** *(after the L&F token migration)* | 3.3 dimensions, accent derivation, U2–U5 | Density/type/shape change every migrated screen; contrast guaranteed |
| **6 — Layout as data** | 3.5, U8–U10, T5–T6 | Sidebar, views and toolbars reorderable and synced |
| **7 — Team libraries** | T3, T4 | Members of a team share templates and libraries, sealed to members |

## 11. Open questions

1. **Does the encrypted tier need to work for accounts without encryption set up?** Today some
   sessions hold no keypair (the plaintext fallback in `uploadAttachment`). Proposal: those
   accounts keep `encrypted`-tier values device-local until they set up a key, and Settings says so.
2. ~~**Is "look" a user choice at all, or an org-level one?**~~ **Settled:** all three looks ship and
   `appearance.look` is a user choice with an org default and lock.
3. **Native clients.** The preference API is a backend surface; iOS/Android/desktop could read
   theme and density from it later. Out of scope here, but the registry's keys should not be
   web-specific names.
