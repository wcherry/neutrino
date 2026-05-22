# Plan: Grammar check and dictionary lookup in DocEditor context menu

## Branch
`feature/docs-grammar-dictionary-context-menu`

## What is changing and why

The docs editor already has nspell-powered spell-check suggestions in the right-click context menu (gated by `feature.editors.spellCheckSuggestions`). This feature extends that capability in two directions:

1. **Grammar check** — detect common grammatical errors (subject-verb agreement, article misuse, double words, comma splices, passive voice overuse) for the selected text or the sentence containing the cursor, and surface them in the context menu under a "Grammar" submenu header.

2. **Dictionary lookup** — when the user right-clicks a word, show a "Define: <word>" menu item that opens a popover/modal with the dictionary definition fetched from the free [Free Dictionary API](https://dictionaryapi.dev/). This works for any word, not just misspelled ones.

Both features are independently gated by new feature flags so they can be toggled in each environment without a deployment.

## Layers affected

- **Frontend logic (`DocEditor.tsx`)** — wire up grammar and dictionary state; pass new props to `EditorContextMenu`.
- **Frontend hook (`useGrammarCheck.ts`)** — new hook that runs lightweight client-side grammar heuristics on a text string and returns an array of `GrammarIssue` objects.
- **Frontend hook (`useDictionaryLookup.ts`)** — new hook that fetches a word definition from `dictionaryapi.dev` and caches results in a `Map` for the session.
- **Frontend UI (`EditorContextMenu.tsx`)** — new `grammarIssues` prop renders issues below the spell section; new `dictionaryWord` + `onLookupWord` props add a "Define" item; new `DictionaryPopover` sub-component renders inline below the menu when a definition is loaded.
- **CSS (`EditorContextMenu.module.css`)** — new styles for grammar issue rows, the "Define" item, and the definition popover.
- **Feature flags (`featureFlags.ts`)** — two new flags: `grammarCheck` and `dictionaryLookup`.
- **Env example (`.env.local.example`)** — document the two new env vars.
- **Tests** — unit tests for both new hooks; updated `EditorContextMenu` tests for grammar and dictionary sections.

## Feature flags

| Flag name | Env var | Default |
|---|---|---|
| `feature.editors.grammarCheck` | `NEXT_PUBLIC_FEATURE_GRAMMAR_CHECK` | off |
| `feature.editors.dictionaryLookup` | `NEXT_PUBLIC_FEATURE_DICTIONARY_LOOKUP` | off |

## Grammar check approach

A pure client-side rule engine — no external API call, no network dependency.

Rules (each returns zero or more `GrammarIssue`s with an `offset`, `length`, `message`, and optional `suggestion`):

| Rule | Description |
|---|---|
| Double word | "the the", "a a", etc. |
| Article before vowel | "a apple" → "an apple" |
| Article before consonant | "an book" → "a book" |
| Subject-verb: third-person singular | "he go", "she have" (simple heuristic) |
| Repeated punctuation | "!!" or ".." (except "...") |
| Space before punctuation | "Hello ." |

Grammar issues are shown in the context menu below spell suggestions with an amber indicator colour. Each issue shows the message and, if a suggestion is available, a "Fix: <suggestion>" action button that replaces the text.

## Dictionary lookup approach

- On right-click with flag on, capture the word under cursor (same logic as spell check).
- Show a "Define: <word>" item in the menu.
- When clicked, fetch `https://api.dictionaryapi.dev/api/v2/entries/en/<word>`.
- Display the first definition in a popover that opens beneath the context menu.
- Results cached in a module-level `Map<string, DictionaryResult | null>` to avoid repeated fetches.
- If the API is unreachable or returns no results, show a graceful "No definition found" message.

## Architecture decisions

1. Grammar check is entirely local — zero network cost and instant results.
2. Dictionary uses a public, free, no-auth API; results are cached per session.
3. Both features share the same word-detection logic already in `DocEditor.tsx` (the `useCallback`-wrapped word-at-cursor extraction is extracted into a shared utility to avoid duplication).
4. The definition popover is rendered inside the context menu div (not a separate portal) to keep z-index and positioning logic simple.

## Acceptance criteria

- Right-clicking a sentence with a grammar error (flag on) shows the issue and "Fix" button in the menu.
- Clicking "Fix" replaces the problematic fragment with the suggestion at the exact document position.
- Right-clicking a word (flag on) shows "Define: <word>" in the menu.
- Clicking "Define" fetches and displays a definition; errors show "No definition found".
- Both sections are absent when their respective flags are off.
- Spell-check suggestions still work as before — no regression.
- All existing context menu items remain functional.
- Grammar rules are tested in isolation via the hook's exported `applyGrammarRules` helper.
- Dictionary hook is tested with a mocked fetch.
