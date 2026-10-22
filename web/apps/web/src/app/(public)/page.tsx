import Link from 'next/link';
import type { Metadata } from 'next';
import styles from './page.module.css';
import { AppShowcase, BrowserFrame, type ShowcaseApp } from './AppShowcase';

const GITHUB_URL = 'https://github.com/wcherry/neutrino';
const HOSTED_URL = 'https://getneutrino.app';

export const metadata: Metadata = {
  title: 'Neutrino — The self-hosted productivity suite',
  description:
    'Drive, Docs, Sheets, Slides, Notes, Photos, Calendar, Diagrams and Drawings in a single Rust binary. End-to-end encrypted, open source, and hosted wherever you want.',
};

// ── Icon components (inline SVGs — no runtime dependency) ─────────────────────

function IconLock() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  );
}

function IconKey() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="7.5" cy="15.5" r="4.5"/>
      <path d="m10.7 12.3 8.8-8.8"/>
      <path d="m17 6 2.5 2.5"/>
      <path d="m14.5 8.5 2.5 2.5"/>
    </svg>
  );
}

function IconUsers() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="8"/>
      <path d="m21 21-4.3-4.3"/>
    </svg>
  );
}

function IconOffline() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h.01"/>
      <path d="M8.5 16.4a5 5 0 0 1 7 0"/>
      <path d="M5 12.9a10 10 0 0 1 14 0"/>
      <path d="m2 2 20 20"/>
    </svg>
  );
}

function IconShare() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="18" cy="5" r="3"/>
      <circle cx="6" cy="12" r="3"/>
      <circle cx="18" cy="19" r="3"/>
      <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>
    </svg>
  );
}

function IconImport() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <path d="m7 10 5 5 5-5"/>
      <path d="M12 15V3"/>
    </svg>
  );
}

function IconZap() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14Z"/>
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z"/>
    </svg>
  );
}

function IconServer() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="20" height="8" x="2" y="2" rx="2" ry="2"/>
      <rect width="20" height="8" x="2" y="14" rx="2" ry="2"/>
      <line x1="6" x2="6.01" y1="6" y2="6"/>
      <line x1="6" x2="6.01" y1="18" y2="18"/>
    </svg>
  );
}

function IconMonitor() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="20" height="14" x="2" y="3" rx="2"/>
      <path d="M8 21h8M12 17v4"/>
    </svg>
  );
}

function IconApple() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.365 1.43c0 1.14-.42 2.2-1.13 3.01-.85.98-2.24 1.74-3.4 1.65a3.6 3.6 0 0 1 1.15-2.9c.79-.84 2.16-1.5 3.38-1.76ZM20.5 17.1c-.6 1.38-.88 2-1.66 3.22-1.08 1.7-2.6 3.82-4.49 3.83-1.68.02-2.11-1.1-4.39-1.08-2.28.01-2.75 1.1-4.43 1.08-1.89-.02-3.33-1.93-4.41-3.63C-1.9 15.75-2.2 9.2 1.05 6.5c1.16-.98 2.62-1.55 4.12-1.55 1.7 0 2.77 1.09 4.18 1.09 1.36 0 2.19-1.09 4.16-1.09 1.33 0 2.74.58 3.75 1.58-3.3 1.8-2.76 6.5.24 7.6-.34 1-.5 1.44-1 2.97Z"/>
    </svg>
  );
}

function IconSmartphone() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="14" height="20" x="5" y="2" rx="2" ry="2"/>
      <path d="M12 18h.01"/>
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

function IconArrowRight() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M12 5l7 7-7 7"/>
    </svg>
  );
}

function IconGithub() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z"/>
    </svg>
  );
}

// ── Data ──────────────────────────────────────────────────────────────────────

const showcaseApps: ShowcaseApp[] = [
  {
    id: 'drive',
    label: 'Drive',
    headline: 'Every file, one place',
    description:
      'Streaming uploads up to 10 GB, nested folders, tags, stars and shortcuts. Quick access surfaces what you starred; the grid, list and detail views are all one click away.',
    bullets: [
      'Large grid, small grid and detailed list views',
      'Folders, tags, colour labels, shortcuts and bulk actions',
      'Trash with restore, plus a full activity trail on every file',
      'HTTP Range downloads, so an interrupted transfer resumes',
    ],
    image: '/screenshots/drive.png',
    alt: 'Neutrino Drive showing Quick access, folders and files in the grid view',
  },
  {
    id: 'docs',
    label: 'Docs',
    headline: 'Documents that write like paper',
    description:
      'A full rich-text editor with a live outline, page rulers, styles and a word count — collaborative in real time and encrypted before a single byte leaves the browser.',
    bullets: [
      'Real-time co-editing with presence',
      'Automatic outline from your headings',
      'Version history with restore',
      'Import and export Word, PDF and plain text',
    ],
    image: '/screenshots/docs.png',
    alt: 'The Neutrino Docs editor showing a formatted document with an outline sidebar',
  },
  {
    id: 'sheets',
    label: 'Sheets',
    headline: 'Spreadsheets with real formulas',
    description:
      'A virtualised grid that stays fast at scale, with a formula engine, cross-sheet references, named ranges, conditional formatting and charts.',
    bullets: [
      'Formulas, named ranges and cross-sheet references',
      'Currency, percent, date and custom number formats',
      'Charts, conditional formatting and filters',
      'Round-trips with .xlsx',
    ],
    image: '/screenshots/sheets.png',
    alt: 'A Neutrino Sheets spreadsheet showing a revenue plan with currency and percentage formatting',
  },
  {
    id: 'slides',
    label: 'Slides',
    headline: 'Decks without the ceremony',
    description:
      'Pick a layout, type, present. Master slides and themes keep a deck consistent, and speaker notes travel with it.',
    bullets: [
      'Layout and theme library, plus master slides',
      'Speaker notes and presenter mode',
      'Import and export PowerPoint',
      'Real-time co-editing with presence',
    ],
    image: '/screenshots/slides.png',
    alt: 'The Neutrino Slides editor showing a title slide and the layout picker',
  },
  {
    id: 'notes',
    label: 'Notes',
    headline: 'Quick thoughts, kept private',
    description:
      'Block-based notes that sync live across every device you own. Notes are end-to-end encrypted, so the server stores ciphertext and nothing else.',
    bullets: [
      'Live sync across devices and tabs',
      'End-to-end encrypted — the relay never sees content',
      'Markdown-style inline formatting',
      'Import straight from Google Keep',
    ],
    image: '/screenshots/notes.png',
    alt: 'The Neutrino Notes library showing a grid of notes',
  },
  {
    id: 'photos',
    label: 'Photos',
    headline: 'Your library, not theirs',
    description:
      'Albums, favourites, archive and memories over the same storage as the rest of your drive — with people grouping that runs against your own data.',
    bullets: [
      'Albums, favourites, archive and memories',
      'People grouping and suggestions',
      'Backed by the same Drive storage and quota',
      'Import your Google Takeout archive',
    ],
    image: '/screenshots/photos.png',
    alt: 'The Neutrino Photos library showing a grid of photographs',
  },
  {
    id: 'calendar',
    label: 'Calendar',
    headline: 'Schedules, reminders and tasks',
    description:
      'Month, week and agenda views with recurring events, reminders and task lists in the sidebar. Sync with Google or Outlook, or import an .ics and keep it local.',
    bullets: [
      'Month, week and agenda views',
      'Recurring events, reminders and browser notifications',
      'Task lists alongside the calendar',
      'Google and Outlook sync, plus ICS import and export',
    ],
    image: '/screenshots/calendar.png',
    alt: 'The Neutrino Calendar showing a month view with events and a reminders sidebar',
  },
];

const features = [
  {
    icon: <IconLock />,
    title: 'Encrypted, with no way around it',
    description:
      'Every write to your drive is encrypted in the browser first — documents, notes, uploads, photos and imports alike. There is no plaintext path left to fall back to, so a server operator, including you, only ever sees ciphertext.',
  },
  {
    icon: <IconKey />,
    title: 'Keys you actually control',
    description:
      'No passphrase to forget: your keyring unlocks with the device. Add a phone by scanning a PIN-protected code, and rotate your identity whenever you like — retired keys are archived so older files keep opening.',
  },
  {
    icon: <IconUsers />,
    title: 'Real-time collaboration',
    description:
      'Docs, Sheets, Slides and Diagrams carry live presence and co-editing. Notes sync between your own devices the moment a save lands.',
  },
  {
    icon: <IconSearch />,
    title: 'Search across everything',
    description:
      'One index spans every app. Because content is encrypted, search runs locally in your browser — the server is never asked what you were looking for.',
  },
  {
    icon: <IconOffline />,
    title: 'Works offline',
    description:
      'Keep editing on a plane. Writes queue locally and reconcile when you reconnect, on the web app and the native clients alike.',
  },
  {
    icon: <IconShare />,
    title: 'Sharing and permissions',
    description:
      'Share links with roles and expiry, shared drives for teams, access requests, comments and an activity trail on every file.',
  },
  {
    icon: <IconImport />,
    title: 'Bring your data with you',
    description:
      'Import a Google Takeout archive straight from the browser — Keep becomes Notes, Drive documents and spreadsheets become Docs and Sheets, Google Photos becomes Photos. Folder tree intact, and every file keeps the dates it already had.',
  },
  {
    icon: <IconZap />,
    title: 'One binary, no dependencies',
    description:
      'A Rust server that embeds its own migrations and serves the web app. SQLite by default — no external database to run before you start.',
  },
  {
    icon: <IconShield />,
    title: 'Admin you can actually run',
    description:
      'Per-user quotas, upload caps, TOTP two-factor, session management, feature flags and an audit trail, all in the admin panel.',
  },
];

/**
 * Native-client screenshots are supplied by hand (App Store / TestFlight
 * captures), so each card declares the file it expects. Drop a PNG at that path
 * and flip `hasImage` to true — until then the card renders a labelled slot
 * rather than a broken image.
 */
const platforms = [
  {
    icon: <IconMonitor />,
    name: 'Web',
    status: 'available' as const,
    statusLabel: 'Available',
    description:
      'The full suite in any modern browser, installable as a PWA so it opens in its own window and keeps working offline.',
    shape: 'wide' as const,
    image: { src: '/screenshots/drive.png', alt: 'The Neutrino web app', hasImage: true },
  },
  {
    icon: <IconApple />,
    name: 'macOS desktop',
    status: 'available' as const,
    statusLabel: 'Available',
    description:
      'A native menu-bar app with a Finder File Provider extension, so your drive is a folder like any other and syncs in the background.',
    shape: 'wide' as const,
    image: { src: '/screenshots/desktop-macos.png', alt: 'Neutrino Drive for macOS', hasImage: true },
  },
  {
    icon: <IconSmartphone />,
    name: 'iOS — Notes & Docs',
    status: 'available' as const,
    statusLabel: 'Available',
    description:
      'Native SwiftUI apps with offline editing, version history, Face ID app lock and the same end-to-end encryption as the web.',
    shape: 'tall' as const,
    image: { src: '/screenshots/ios-notes.png', alt: 'Neutrino Notes for iOS', hasImage: false },
  },
  {
    icon: <IconSmartphone />,
    name: 'iOS — Drive',
    status: 'progress' as const,
    statusLabel: 'In development',
    description:
      'The mobile file browser — browsing, uploads, viewers, version history, offline files, search and photo sync, with the key imported by scanning the code from the web app. In testing ahead of release.',
    shape: 'tall' as const,
    image: { src: '/screenshots/ios-drive.png', alt: 'Neutrino Drive for iOS', hasImage: false },
  },
];

const selfHostBenefits = [
  'Your data never leaves your servers',
  'No per-seat pricing and no vendor lock-in',
  'Set your own quotas, retention and policies',
  'Runs on a VPS, a NAS or a Raspberry Pi',
  'Single binary with SQLite — no external database',
  'MIT licensed, so you can fork it and keep going',
];

const roadmapShipped = [
  { label: 'Accounts & security', desc: 'Auth, sessions, TOTP two-factor, per-user quotas, admin panel' },
  { label: 'Drive', desc: 'Streaming upload and download, folders, trash, stars, tags, shortcuts, bulk operations' },
  { label: 'Sharing', desc: 'Share links with roles, shared drives, access requests, comments, per-file activity trail' },
  { label: 'Office suite', desc: 'Docs, Sheets and Slides with real-time collaboration and Office file round-trips' },
  { label: 'Notes, Photos & Calendar', desc: 'Block notes, photo library with albums and people, calendar with reminders and tasks' },
  { label: 'Diagrams & Drawings', desc: 'Flowchart, UML, BPMN, ERD and cloud shape libraries, plus a freehand canvas' },
  { label: 'End-to-end encryption', desc: 'Every write to Drive encrypted in the browser, with no plaintext path left behind' },
  { label: 'Key management', desc: 'Device-wrapped key vault with no passphrase prompt, QR device enrolment, and rotation that archives retired keys' },
  { label: 'Search & offline', desc: 'Local encrypted index across every app, offline editing and a cross-device snapshot' },
  { label: 'Google Takeout import', desc: 'Keep, Drive documents and spreadsheets, and Google Photos — entirely in the browser' },
  { label: 'macOS desktop client', desc: 'Menu-bar app with a File Provider extension and a background sync agent' },
  { label: 'iOS — Notes & Docs', desc: 'Native SwiftUI apps with offline editing, version history and Face ID lock' },
];

const roadmapNext = [
  { label: 'iOS — Drive', desc: 'Full mobile file browser with viewers, uploads and downloads', status: 'In development' },
  { label: 'iOS — Sheets', desc: 'The spreadsheet editor on iPhone and iPad — cell editing and formatting are in', status: 'In development' },
  { label: 'iOS — Slides & Photos', desc: 'The rest of the suite on iPhone and iPad', status: 'Planned' },
  { label: 'Android apps', desc: 'Drive, Notes and Docs for Android, sharing the same encryption model', status: 'Planned' },
  { label: 'Windows client', desc: 'Native sync client with Explorer integration', status: 'Planned' },
  { label: 'Linux client', desc: 'Native sync client with a virtual filesystem mount', status: 'Planned' },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className={styles.page}>

      {/* ── Nav ── */}
      <header className={styles.nav}>
        <div className={styles.navInner}>
          <div className={styles.logo}>
            <span className={styles.logoMark}>N</span>
            <span className={styles.logoText}>Neutrino</span>
          </div>
          <nav className={styles.navLinks} aria-label="Site navigation">
            <a href="#apps" className={styles.navLink}>Apps</a>
            <a href="#features" className={styles.navLink}>Features</a>
            <a href="#platforms" className={styles.navLink}>Clients</a>
            <Link href="/self-host" className={styles.navLink}>Self-host</Link>
            <a href="#roadmap" className={styles.navLink}>Roadmap</a>
            <a
              href={GITHUB_URL}
              className={styles.navLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              <IconGithub />
              GitHub
            </a>
          </nav>
          <div className={styles.navActions}>
            <Link href="/sign-in" className={styles.navSignIn}>
              Sign in
            </Link>
            <Link href="/register" className={styles.btnPrimary}>
              Get started free
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className={styles.hero}>
        <div className={styles.heroGlow} aria-hidden />
        <div className={styles.heroInner}>
          <div className={styles.heroBadge}>
            <span className={styles.heroBadgeDot} />
            Open source · MIT licensed · End-to-end encrypted
          </div>
          <h1 className={styles.heroHeading}>
            Your whole office.
            <br />
            <span className={styles.heroAccent}>On your own server.</span>
          </h1>
          <p className={styles.heroSub}>
            Drive, Docs, Sheets, Slides, Notes, Photos, Calendar, Diagrams and Drawings —
            nine apps in a single Rust binary. End-to-end encrypted, works offline, and
            runs on hardware you control.
          </p>
          <div className={styles.heroCtas}>
            <Link href="/register" className={styles.ctaPrimary}>
              Try it free
              <IconArrowRight />
            </Link>
            <Link href="/self-host" className={styles.ctaSecondary}>
              Self-host in minutes
            </Link>
          </div>
          <p className={styles.heroNote}>
            Hosted at{' '}
            <a href={HOSTED_URL} className={styles.heroNoteLink}>
              getneutrino.app
            </a>{' '}
            · No credit card required
          </p>
        </div>

        <div className={styles.heroVisual}>
          <BrowserFrame
            src="/screenshots/drive.png"
            alt="Neutrino Drive showing Quick access, folders and files alongside the app sidebar"
            eager
            className={styles.heroFrame}
          />
        </div>
      </section>

      {/* ── Stats bar ── */}
      <div className={styles.stats}>
        <div className={styles.statsInner}>
          <div className={styles.stat}>
            <span className={styles.statValue}>9 apps</span>
            <span className={styles.statLabel}>one suite</span>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.stat}>
            <span className={styles.statValue}>1 binary</span>
            <span className={styles.statLabel}>Rust + SQLite</span>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.stat}>
            <span className={styles.statValue}>E2E</span>
            <span className={styles.statLabel}>encrypted by default</span>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.stat}>
            <span className={styles.statValue}>MIT</span>
            <span className={styles.statLabel}>open source licence</span>
          </div>
        </div>
      </div>

      {/* ── App showcase ── */}
      <section id="apps" className={styles.section}>
        <div className={styles.sectionInner}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionEyebrow}>The suite</span>
            <h2 className={styles.sectionHeading}>Nine apps that already work together</h2>
            <p className={styles.sectionSub}>
              Not a file host with an editor bolted on. Every app writes to the same drive,
              shares the same search index, and is encrypted with the same key.
            </p>
          </div>
          <AppShowcase apps={showcaseApps} />
          <p className={styles.platformFootnote}>
            Diagrams and Drawing round out the nine — flowchart, UML, BPMN, ERD and cloud
            shape libraries, plus a freehand canvas, both saving into the same drive.
          </p>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className={styles.sectionAlt}>
        <div className={styles.sectionInner}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionEyebrow}>What you get</span>
            <h2 className={styles.sectionHeading}>Built for real work</h2>
            <p className={styles.sectionSub}>
              Everything below is shipped and running today — not a plan.
            </p>
          </div>
          <div className={styles.featuresGrid}>
            {features.map((f) => (
              <div key={f.title} className={styles.featureCard}>
                <div className={styles.featureIcon}>{f.icon}</div>
                <h3 className={styles.featureTitle}>{f.title}</h3>
                <p className={styles.featureDesc}>{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Platforms ── */}
      <section id="platforms" className={styles.section}>
        <div className={styles.sectionInner}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionEyebrow}>Clients</span>
            <h2 className={styles.sectionHeading}>On the web, on your Mac, in your pocket</h2>
            <p className={styles.sectionSub}>
              Native clients speak the same encrypted protocol as the web app, so a file
              you edit on your phone is the same file your desktop syncs a second later.
            </p>
          </div>
          <div className={styles.platformGrid}>
            {platforms.map((p) => (
              <article key={p.name} className={styles.platformCard}>
                <div
                  className={`${styles.platformShot} ${
                    p.shape === 'tall' ? styles.platformShotTall : styles.platformShotWide
                  }`}
                >
                  {p.image.hasImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.image.src}
                      alt={p.image.alt}
                      className={styles.platformImg}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className={styles.platformSlot}>
                      <span className={styles.platformSlotIcon} aria-hidden>{p.icon}</span>
                      <span className={styles.platformSlotLabel}>Screenshot slot</span>
                      <code className={styles.platformSlotPath}>{p.image.src}</code>
                    </div>
                  )}
                </div>
                <div className={styles.platformBody}>
                  <div className={styles.platformTop}>
                    <span className={styles.platformIcon} aria-hidden>{p.icon}</span>
                    <h3 className={styles.platformName}>{p.name}</h3>
                    <span
                      className={`${styles.platformStatus} ${
                        p.status === 'available' ? styles.platformStatusReady : styles.platformStatusProgress
                      }`}
                    >
                      {p.statusLabel}
                    </span>
                  </div>
                  <p className={styles.platformDesc}>{p.description}</p>
                </div>
              </article>
            ))}
          </div>
          <p className={styles.platformFootnote}>
            Android, Windows and Linux clients are on the roadmap — see{' '}
            <a href="#roadmap" className={styles.inlineLink}>what&apos;s next</a>.
          </p>
        </div>
      </section>

      {/* ── Self-host ── */}
      <section id="self-host" className={styles.selfHost}>
        <div className={styles.sectionInner}>
          <div className={styles.selfHostLayout}>
            <div className={styles.selfHostContent}>
              <span className={styles.sectionEyebrow}>
                <IconServer />
                Self-host
              </span>
              <h2 className={styles.sectionHeading}>Your server. Your rules.</h2>
              <p className={styles.sectionSub}>
                Deploy Neutrino on any Linux server, VPS, NAS or Raspberry Pi. One binary
                backed by SQLite — migrations run themselves on first boot, and the same
                process serves the API and the web app.
              </p>
              <ul className={styles.benefitList}>
                {selfHostBenefits.map((b) => (
                  <li key={b} className={styles.benefitItem}>
                    <span className={styles.checkIcon}>
                      <IconCheck />
                    </span>
                    {b}
                  </li>
                ))}
              </ul>
              <div className={styles.selfHostCtas}>
                <Link href="/self-host" className={styles.ctaPrimary}>
                  Read the self-hosting guide
                  <IconArrowRight />
                </Link>
              </div>
            </div>
            <div className={styles.selfHostCode}>
              <div className={styles.codeWindow}>
                <div className={styles.codeWindowBar}>
                  <span className={styles.dot} style={{ background: '#ff5f57' }} />
                  <span className={styles.dot} style={{ background: '#febc2e' }} />
                  <span className={styles.dot} style={{ background: '#28c840' }} />
                  <span className={styles.codeWindowTitle}>Terminal</span>
                </div>
                <pre className={styles.code}><code>{`# One container — API and web app on one port
docker run -d --name neutrino -p 8080:8080 \\
  -e JWT_SECRET="$(openssl rand -hex 32)" \\
  -e WORKER_SECRET="$(openssl rand -hex 32)" \\
  -e DATABASE_URL=/usr/local/data/neutrino.db \\
  -e STORAGE_PATH=/usr/local/data/storage \\
  -v neutrino-data:/usr/local/data \\
  ghcr.io/wcherry/neutrino:latest

# ✓ Migrations applied
# ✓ Storage path: /usr/local/data/storage
# ✓ Listening on 0.0.0.0:8080`}</code></pre>
              </div>
              <p className={styles.codeNote}>
                Prefer a binary? Grab a release, set four environment variables and run it.
                The <Link href="/self-host" className={styles.inlineLink}>full guide</Link> covers
                TLS, backups and upgrades.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Roadmap ── */}
      <section id="roadmap" className={styles.sectionAlt}>
        <div className={styles.sectionInner}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionEyebrow}>Where this is going</span>
            <h2 className={styles.sectionHeading}>Roadmap</h2>
            <p className={styles.sectionSub}>
              The suite and the macOS and iOS clients are shipped. Next up is finishing iOS
              and bringing the same native experience to Android, Windows and Linux.
            </p>
          </div>

          <div className={styles.roadmapColumns}>
            <div className={styles.roadmapColumn}>
              <h3 className={styles.roadmapColumnTitle}>
                <span className={styles.roadmapColumnBadgeDone}>Shipped</span>
              </h3>
              <div className={styles.roadmap}>
                {roadmapShipped.map((item) => (
                  <div key={item.label} className={`${styles.roadmapItem} ${styles.roadmapItemDone}`}>
                    <div className={styles.roadmapDot}>
                      <IconCheck />
                    </div>
                    <div className={styles.roadmapContent}>
                      <div className={styles.roadmapLabel}>{item.label}</div>
                      <div className={styles.roadmapDesc}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.roadmapColumn}>
              <h3 className={styles.roadmapColumnTitle}>
                <span className={styles.roadmapColumnBadgeNext}>Next</span>
              </h3>
              <div className={styles.roadmap}>
                {roadmapNext.map((item) => (
                  <div key={item.label} className={styles.roadmapItem}>
                    <div className={styles.roadmapDot} />
                    <div className={styles.roadmapContent}>
                      <div className={styles.roadmapPhase}>{item.status}</div>
                      <div className={styles.roadmapLabel}>{item.label}</div>
                      <div className={styles.roadmapDesc}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className={styles.finalCta}>
        <div className={styles.finalCtaGlow} aria-hidden />
        <div className={styles.sectionInner}>
          <h2 className={styles.finalCtaHeading}>
            Your files, your control.
            <br />
            Start today.
          </h2>
          <p className={styles.finalCtaSub}>
            Use the hosted version at getneutrino.app — free, no credit card.
            Or self-host in minutes on your own infrastructure.
          </p>
          <div className={styles.finalCtaButtons}>
            <Link href="/register" className={styles.ctaPrimary}>
              Create free account
              <IconArrowRight />
            </Link>
            <Link href="/self-host" className={styles.ctaSecondary}>
              Self-host it instead
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <div className={styles.logo}>
              <span className={styles.logoMark}>N</span>
              <span className={styles.logoText}>Neutrino</span>
            </div>
            <p className={styles.footerTagline}>
              The self-hosted productivity suite, built with Rust.
            </p>
            <a
              href={GITHUB_URL}
              className={styles.footerGithub}
              target="_blank"
              rel="noopener noreferrer"
            >
              <IconGithub />
              View on GitHub
            </a>
          </div>
          <div className={styles.footerLinks}>
            <div className={styles.footerCol}>
              <div className={styles.footerColTitle}>Product</div>
              <a href="#apps" className={styles.footerLink}>Apps</a>
              <a href="#features" className={styles.footerLink}>Features</a>
              <a href="#platforms" className={styles.footerLink}>Clients</a>
              <a href="#roadmap" className={styles.footerLink}>Roadmap</a>
            </div>
            <div className={styles.footerCol}>
              <div className={styles.footerColTitle}>Self-Host</div>
              <Link href="/self-host" className={styles.footerLink}>Self-hosting guide</Link>
              <a href={`${GITHUB_URL}/releases`} className={styles.footerLink} target="_blank" rel="noopener noreferrer">Releases</a>
              <a href={`${GITHUB_URL}#configuration`} className={styles.footerLink} target="_blank" rel="noopener noreferrer">Configuration</a>
              <a href={GITHUB_URL} className={styles.footerLink} target="_blank" rel="noopener noreferrer">Source code</a>
            </div>
            <div className={styles.footerCol}>
              <div className={styles.footerColTitle}>Account</div>
              <Link href="/sign-in" className={styles.footerLink}>Sign in</Link>
              <Link href="/register" className={styles.footerLink}>Register</Link>
              <a href={HOSTED_URL} className={styles.footerLink}>Hosted version</a>
            </div>
          </div>
        </div>
        <div className={styles.footerBottom}>
          <span>© {new Date().getFullYear()} Neutrino. MIT License.</span>
          <div className={styles.footerBottomLinks}>
            <a href={GITHUB_URL} className={styles.footerBottomLink} target="_blank" rel="noopener noreferrer">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
