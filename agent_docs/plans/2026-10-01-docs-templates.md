# Plan: Templates for Docs (issue #128)

## Summary
A Docs template is a regular Drive file stored as a real Word template — `.dotx`,
`application/vnd.openxmlformats-officedocument.wordprocessingml.template`. There is no
template table and no server-side copy: the `doc_templates` API was removed in #132
because instantiating a template on the server wrote the body in the clear. Everything
here happens in the browser, encrypted like every other write. A template is made with
**Export as → Word template (.dotx)** (to Drive or to disk, through the existing Save As
dialog), opened and edited in the docs editor like a document, and used through
**New from template…** in the editor's File menu and on the `/docs` landing page, which
copies the template's decrypted package into a new `.docx` sealed under its own key.

## Affected Repos
- neutrino — web (mime constants, `.dotx` package kind, editor + library UI, Drive
  routing/preview) and backend (register the mime type as native; backlink label).
- No iOS / macOS change. The iOS Docs app filters its listing by mime type client-side
  and never asks for `type=doc`, so a new type is invisible to it rather than breaking it.
  Opening templates there is a follow-up.

## Tasks
1. `packages/api-core/src/ooxml.ts` — `OOXML_TEMPLATE_MIME.dotx`, `.dotx` extension;
   `ooxmlAppForMime` maps the template type to `docs`; `stripOoxmlExtension` strips
   `.dotx`; `isOoxmlTemplateMime`; `withOoxmlExtension` takes a `template` flag.
2. `apps/web/src/lib/ooxml/docx/packageKind.ts` — rewrite the main part's content type
   in `[Content_Types].xml` (`document.main+xml` ↔ `template.main+xml`). Word refuses a
   `.dotx` whose main part says "document", so this is not cosmetic.
3. `packages/api-docs` — `DOTX_MIME_TYPE`, `listTemplates`, `createDoc` unchanged.
4. `apps/web/src/lib/docTemplates.ts` — `createDocFromTemplate`: read + decrypt template,
   flip package kind to document, create `.docx`, mint DEK, write encrypted version.
5. `DocEditor` — template-aware filename/rename/autosave (keeps `.dotx` and its content
   type); Export as `dotx`; "New from template…"; banner on a template with "Use template".
6. `DocTemplatePickerModal` — lists templates, picks one, names the new document.
7. `/docs` page — "New from template" button (DocumentLibrary gets an optional
   `extraActions` slot).
8. Drive — `previewKindForMime` for `.dotx`; routing follows from task 1.
9. Backend — `native_types::DOTX` (no seed); `links::file_type_label` → `doc`.

## Test Plan
- Unit (web): ooxml helpers, package-kind round trip (and `readDocx` still reads a
  template), `createDocFromTemplate` (encrypts with the new key, flips kind, names
  `.docx`), routing/preview of `.dotx`.
- Unit (Rust): `DOTX` is native and unseeded; backlink label.
- E2E: `e2e/tests/docs/templates.spec.ts` — save a document as a template to Drive, create
  a document from it, the new document holds the template's text.

## Open Questions
- Sheets (`.xltx`) and Slides (`.potx`) are named in the issue but it is filed against
  Docs; they follow the same shape and are left for a follow-up.
