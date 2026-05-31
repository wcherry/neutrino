## Plan: Feature gap analysis for Neutrino Docs

TL;DR: Compare Neutrino Docs currently implemented editor capabilities against Microsoft Word / Google Docs feature expectations, and define a practical list of feature areas still needing implementation.

**Current Neutrino Docs capabilities observed**
- Rich text formatting: bold, italic, underline, strikethrough, text color, highlight, font family/size, headings, paragraph styling
- Document structure: tables, images by URL, links, blockquote, inline code, horizontal rule
- Document metadata: title edit, page setup (size/orientation/margins), word/character count
- File operations: new doc, duplicate, import .docx, export .docx/.pdf/.html/.txt, print, save versions, autosave
- Collaboration/workflow: comments panel, version history panel, outline navigation, spell-check suggestions, basic context menu
- Backend support observed for Yjs-based collaboration and comments storage

**Feature areas still to implement for Word/Docs parity**
1. **Document layout & structure**
   - Headers, footers, and page numbering
   - Footnotes/endnotes and cross-references
   - Table of contents generation
   - Section breaks and multi-column layouts
   - Page backgrounds, document themes, and watermarks

2. **Advanced formatting & styles**
   - Superscript/subscript and text-case controls
   - Indent/outdent and richer list formatting
   - Named styles / style palette / custom styles
   - More advanced tables: borders, shading, cell formatting
   - Better image support: local upload, resize, alignment, text wrap, captions, alt text

3. **Editing and productivity tools**
   - Find-and-replace dialog
   - Grammar checking and writing suggestions in editor
   - AI-assisted writing integrated into UI
   - Better import/export fidelity and more file formats
   - Equation editor / math support

4. **Collaboration & sharing**
   - Real-time presence/cursor awareness in the Docs editor
   - Share links and file permission controls
   - Full comment threading anchored to text selection
   - Suggesting / review mode (track changes)
   - Collaboration activity indicators and user presence UI

5. **Review and versioning**
   - Review sidebar for comments and suggestions
   - Track changes markup and accept/reject flow
   - Document compare / revision compare
   - Named version snapshots and preview restore

6. **Polish, accessibility, and UX**
   - Full keyboard shortcut support and discovery
   - Better accessibility/screen-reader support
   - Dark mode and responsive/mobile editing
   - Drag-and-drop insertion and stronger paste handling
   - Document preview mode improvements

**Next step**
- Share this feature gap list for prioritization.
- If desired, break it into an implementation roadmap by area and value.
