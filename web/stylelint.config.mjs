/**
 * The token contract, as lint rules (agent_docs/ui-look-and-feel-roadmap.md §4).
 *
 * The three looks, density and themes only reach CSS that reads tokens, and
 * most of it doesn't yet: hundreds of px font sizes, numeric z-indexes and
 * literal colours. These rules name every one of them.
 *
 * **Warnings, not errors, until the migration says otherwise** — `pnpm
 * lint:css` reports and exits 0. Roadmap stage 6 turns `defaultSeverity` to
 * "error"; until then the count should only go down. `packages/tokens` is
 * where literal values belong, so it is exempt.
 */
export default {
  defaultSeverity: 'warning',
  ignoreFiles: ['packages/tokens/src/**/*.css', '**/node_modules/**', '**/.next/**', '**/out/**'],
  rules: {
    // Colours come from tokens; a literal colour is one no theme can change.
    'color-no-hex': true,
    'color-named': 'never',
    'declaration-property-value-disallowed-list': {
      // The six-step type scale is tokens (`--text-*`); a px size is a seventh.
      'font-size': ['/^\\d+(\\.\\d+)?px$/'],
      // Layering is the `--z-*` scale; 26 hand-picked numbers is how two
      // overlays end up fighting.
      'z-index': ['/^-?\\d+$/'],
      // A fallback inside var() hides a token that does not exist instead of
      // failing visibly — that is how 110 references to undefined tokens
      // survived (e.g. var(--color-danger, #dc2626)).
      '/.*/': ['/var\\(--[\\w-]+,\\s*#[0-9a-fA-F]{3,8}\\)/'],
    },
  },
};
