# Manual Verification: Spell-check suggestions in DocEditor context menu

## Prerequisites
- Feature flag `feature.editors.spellCheckSuggestions` enabled:
  set `NEXT_PUBLIC_FEATURE_SPELL_CHECK_SUGGESTIONS=true` in `.env.local`
- Dev server running: `pnpm dev` from `apps/web`
- A document open in the DocEditor (`/docs/editor?id=<id>`)
- Spell check enabled (default is on; toggle with Cmd+Shift+; if needed)

## Steps to Verify

### Happy Path — misspelled word

1. Type a misspelled word in the document (e.g. "teh" or "recieve").
2. Right-click directly on the misspelled word (no text selected).
3. Verify the custom context menu opens (browser native menu does NOT appear).
4. Verify up to 5 suggestion items appear at the TOP of the menu, rendered in bold.
5. Verify a separator line follows the suggestions before the regular menu items.
6. Click one of the suggestions.
7. Verify the misspelled word in the document is replaced with the chosen suggestion.
8. Verify the context menu closes after applying the suggestion.

### Correctly spelled word

1. Right-click on a correctly spelled word (e.g. "the").
2. Verify the custom context menu opens.
3. Verify NO suggestion items appear at the top — the menu starts with "Add comment".

### Dictionary loading (Checking… placeholder)

1. Hard-reload the page (Cmd+Shift+R) to clear any cached nspell instance.
2. Immediately right-click on a misspelled word before the dictionary finishes loading.
3. Verify "Checking…" placeholder is visible at the top of the menu (in italic text).
4. Wait a moment — the placeholder should be replaced by actual suggestions once
   the dictionary finishes loading.

### With text selected

1. Select some text in the document.
2. Right-click within the selection.
3. Verify the custom context menu opens.
4. Verify NO spell suggestions appear (spell detection only applies when selection is empty).
5. Verify "Add comment", Bold, Italic, etc. are all clickable and functional.

### Feature Flag Off

1. Set `NEXT_PUBLIC_FEATURE_SPELL_CHECK_SUGGESTIONS=false` (or unset the variable).
2. Restart the dev server.
3. Right-click on a misspelled word with no selection.
4. Verify the custom context menu opens (e.preventDefault is always called).
5. Verify NO spell suggestions appear.
6. Verify all existing context menu items work normally.

### Spell check preference off

1. With the feature flag ON, disable spell check (toggle with Cmd+Shift+;).
2. Right-click anywhere in the document.
3. Verify the custom context menu opens.
4. Verify NO spell suggestions appear regardless of whether the word is misspelled.
5. Re-enable spell check.

### Edge cases

1. Right-click on whitespace / empty line — verify no spell section appears and
   the menu opens normally.
2. Right-click on a number or URL — word detection falls back gracefully (only
   `\w` characters are matched).
3. Right-click at the very start of the document — verify no crash.

## Expected Results

| Scenario | Expected |
|---|---|
| Misspelled word, flag on, spell check on | Up to 5 bold suggestions at top, separator, then standard items |
| Correct word | No suggestions; standard items only |
| Dictionary loading | "Checking…" italic placeholder, updated when loaded |
| Text selected | No suggestions; standard items (Add comment enabled) |
| Flag off | No suggestions; standard items |
| Spell check off | No suggestions; standard items |

## Rollback

Disable `NEXT_PUBLIC_FEATURE_SPELL_CHECK_SUGGESTIONS` — set to `false` or remove it.
No deployment change needed; existing context menu behaviour is fully preserved when
the flag is off.
