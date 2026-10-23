/**
 * Every font the app uses, served from our own origin.
 *
 * These used to come from a render-blocking `fonts.googleapis.com` stylesheet
 * on every page, signed-out ones included. Healthy, that cost ~60 ms of first
 * paint; with the host slow or unreachable — a filtering proxy, an air-gapped
 * self-hosted install — first paint waited for it (an 8 s stall measured as an
 * 8.3 s FCP), and every page view told a third party who was using Neutrino.
 * See agent_docs/ui-performance-roadmap.md, P5.
 *
 * Importing these costs almost nothing: `@font-face` only downloads a file when
 * text on the page uses that family, weight and unicode range. So Inter loads
 * for the UI, and Roboto, Open Sans, Lato and Playfair Display load only when
 * a document or slide uses them (the editors' font pickers,
 * `constants/editor.ts`). The files are emitted under `/_next/static/media`
 * with content hashes, so they get the same immutable caching as the chunks.
 *
 * The static builds, not `@fontsource-variable/*`: those register the family
 * as "Inter Variable", and every stylesheet and stored document here names
 * plain "Inter". The weights are the ones the old Google request asked for.
 */
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import '@fontsource/open-sans/400.css';
import '@fontsource/open-sans/600.css';
import '@fontsource/open-sans/700.css';
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/700.css';
