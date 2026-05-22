# Plan: Spell-check suggestions in DocEditor context menu

## Branch
`feature/spell-check-suggestions`

## What is changing and why
Replace the previous behaviour where right-clicking with spell check on and no selection fell through to the native browser context menu. Instead, always show the custom EditorContextMenu and include nspell-generated suggestions at the top when the right-clicked word is misspelled.

## Layers affected
- **Frontend logic** — new `useNspell` hook; changes to `DocEditor.tsx` (word detection, context-menu state, revert previous handleContextMenu bypass)
- **Frontend UI** — `EditorContextMenu.tsx` gets new `spellWord`, `spellSuggestions`, and `onApplySuggestion` props; suggestions rendered at top with separator
- **CSS** — new `.suggestion` and `.checking` classes in `EditorContextMenu.module.css`
- **Static assets** — dictionary `.aff`/`.dic` files copied to `public/dictionaries/en/`
- **Tests** — unit tests for `useNspell`; updated `EditorContextMenu` tests for suggestion rendering

## Feature flag
`feature.editors.spellCheckSuggestions`
- Env var: `NEXT_PUBLIC_FEATURE_SPELL_CHECK_SUGGESTIONS`
- Default: **off** in all environments
- When off: `handleContextMenu` always calls `e.preventDefault()` and opens the custom menu without suggestions (same behaviour as before the previous session's change)

## Architecture decisions
1. Dictionary served as static files from `public/dictionaries/en/index.aff` and `public/dictionaries/en/index.dic` — avoids Node.js fs dependency in browser
2. Module-level singleton for nspell instance so it is initialised once per page session
3. `useNspell` returns `null` until loaded; shows "Checking…" placeholder in the menu

## Acceptance criteria
- Right-clicking a misspelled word (with spell check on) opens custom menu with up to 5 suggestions at top
- Clicking a suggestion replaces the word in the editor at the exact document position
- Correctly spelled words show no extra items
- "Checking…" placeholder appears while dictionary loads
- When spell check is off, no suggestions appear; custom menu still opens
- All existing context menu items remain functional
- No performance regression at page load (dictionary not loaded until first right-click)
