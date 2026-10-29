# Plan: Atlas Markdown spec v1 and conformance corpus

## Summary

This is the first Neutrino Atlas Phase 1 task (roadmap: `agent_docs/neutrino-atlas.md`,
constraint 3). Three independent editors read and write Atlas pages: Swift (`AtlasKit`),
TypeScript (web) and Kotlin (Android). This change defines the single Markdown dialect they
share, in `specs/atlas-markdown/SPEC.md`, along with a language-neutral conformance corpus every
implementation runs, so they agree on the tree, extraction, link resolution and the exact bytes
written. There is no runtime code: no parser is implemented here, and nothing ships to users.

## Affected Repos
- neutrino: adds `specs/atlas-markdown/` (spec, corpus, checker) and a CI workflow.
- Later consumers, not changed now: `neutrino_atlaskit` and `neutrino_atlas_android_mobile`
  vendor the corpus (SPEC §9.3), and `web/packages/atlas` runs it directly.

## Tasks
1. `specs/atlas-markdown/SPEC.md`, covering:
   - the base dialect (CommonMark 0.31.2 + GFM);
   - the AST (mdast plus extensions);
   - extension grammars (frontmatter, wiki links, embeds, tags, highlight, block ids,
     callouts, math);
   - extraction, link resolution and link writing;
   - source preservation and canonical serialization;
   - the conformance checks (P/R/C/E) and versioning.
2. `specs/atlas-markdown/corpus/`: 39 cases across core, non-canonical input, wiki links,
   embeds, tags, highlight, block ids, callouts, math and frontmatter, plus a vault fixture
   for resolution and link writing.
3. `specs/atlas-markdown/check.mjs`: a dependency-free consistency checker covering node
   shapes, canonical bytes, extraction derived from the tree, and resolution.
4. `specs/atlas-markdown/.gitattributes` (`-text`), so CRLF and BOM test inputs keep their
   exact bytes.
5. `.github/workflows/atlas-markdown-spec.yml`, which runs the checker on changes under
   `specs/atlas-markdown/`.

## Test Plan
- Unit:
  - `node specs/atlas-markdown/check.mjs` passes.
  - Mutations caught by the checker: a missing explicit null, an extract that disagrees with
    the tree, an invalid tag, a wrong resolution expectation, unmerged text nodes, and CRLF
    in canonical output.
- Cross-check (one-off, not committed): every case's `input.md` and `canonical.md` was parsed
  with micromark/mdast (GFM, frontmatter, `$$` math). The extension nodes were lowered back to
  their source text and the results compared with `ast.json`. All 39 agree. The two
  raw-bracket wiki-link cases were checked by hand, since escapes inside `[[…]]` are raw by
  design.
- E2E: none. There is no runtime behaviour.

## Open Questions

These are the decisions the draft takes by default (SPEC §11), to confirm before any editor
implements them:
1. Source preservation at top-level-block granularity as the MUST, with finer granularity as
   a SHOULD.
2. Spaces, not Obsidian's tabs, for nested lists in canonical form.
3. Pandoc's `$` rule for inline math.
4. Plural-only frontmatter keys (`tags`, `aliases`).
