# Implementation Plan: AI Submenu for Docs Editor

## Branch
`feature/ai-submenu` (both `neutrino-web` and `neutrino-docs`)

## What is changing and why

Adding an AI menu to the Neutrino Docs editor (hamburger menu + right-click context menu) with three operations:
- **Suggestions** — suggest the next sentence/paragraph
- **Summarize** — summarize doc or selection; optionally save to metadata
- **Change Tone** — rewrite with slider-controlled tone (formal/cheerful/verbose)

Supporting three AI providers: Anthropic Claude (existing), OpenAI GPT-4o (new), Google Gemini (new, with free tier).

## Layers affected

### Backend (`neutrino-docs`)
- New `AiProvider` trait abstracting Claude, OpenAI, Gemini
- New `OpenAiClient` and `GeminiClient` implementations
- New service methods: `suggestions`, `change_tone`; modify `summarize` to accept `save_to_metadata`
- New endpoints: `POST /docs/{id}/ai/suggestions`, `POST /docs/{id}/ai/change-tone`
- Modified endpoint: `POST /docs/{id}/ai/summarize` — add `save_to_metadata`, `selected_text`, `provider`, `api_key`
- Config: add optional `OPENAI_API_KEY`, `GEMINI_API_KEY`, `DEFAULT_AI_PROVIDER`

### Frontend (`neutrino-web`)
- `packages/api-docs/src/index.ts` — add `aiSuggestions`, `aiSummarize`, `aiChangeTone` API methods
- `apps/web/src/app/(apps)/docs/editor/AiPanel.tsx` — new component (sliding result panel)
- `apps/web/src/app/(apps)/docs/editor/ChangeToneDialog.tsx` — new component (3-slider modal)
- `apps/web/src/app/(apps)/docs/editor/AiPanel.module.css` — styles
- `apps/web/src/app/(apps)/docs/editor/ChangeToneDialog.module.css` — styles
- `apps/web/src/app/(apps)/docs/editor/MenuBar.tsx` — add AI submenu
- `apps/web/src/app/(apps)/docs/editor/EditorContextMenu.tsx` — add AI section
- `apps/web/src/app/(apps)/docs/editor/DocEditor.tsx` — wire up AI actions and modals
- `apps/web/src/lib/featureFlags.ts` — add `aiFeatures` flag
- `apps/web/src/lib/useAiSettings.ts` — hook for localStorage-persisted AI provider settings
- Profile page — add AI settings section (provider + API key)

## Feature flag
`feature.docs.aiFeatures` — env var `NEXT_PUBLIC_FEATURE_AI_FEATURES`
- Default: `false`
- Gates: all AI menu items and dialogs

## AI provider routing strategy
- Request body includes optional `provider` and `apiKey` fields
- Backend selects provider: request body > env default > "gemini" (if GEMINI_API_KEY set) > "claude"
- Gemini free tier: used when no API key provided and provider is "gemini"

## Key design decisions
- AI results shown in `AiPanel` — a dismissable panel that slides in at bottom of editor
- "Insert" button in AiPanel replaces selection (if any) or appends at cursor
- Change Tone dialog previews the result before applying
- AI settings stored in localStorage (no backend auth service changes needed)
- Summarize with `save_to_metadata`: updates the Drive file description (name field extension)

## Acceptance criteria
- AI submenu appears in hamburger menu and right-click context menu when feature flag enabled
- All three operations call backend, show result in AiPanel
- Change Tone shows 3-slider dialog before calling backend
- Provider/API key settings persist in localStorage and are sent with requests
- When text is selected, operations apply only to selection
- When no text selected, operations apply to whole document
- Gemini free tier used when no key provided (backend falls back)
- All tests pass with feature flag enabled

## Known risks
- Gemini free tier rate limits
- Long AI responses may overflow the panel — add scrolling
- The backend `save_to_metadata` path needs Drive file update — using existing `update_file_name` pattern
