import Link from 'next/link';
import type { Metadata } from 'next';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Neutrino — Cloud Storage for Everyone',
  description:
    'Secure, fast, open-source cloud storage. Self-host on your own infrastructure or use our hosted service at neutrino.app.',
};

// ── Icon components (inline SVGs — no runtime dependency) ─────────────────────

function IconCloud() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>
    </svg>
  );
}

function IconFolder() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
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

function IconZap() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14Z"/>
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

function IconGlobe() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>
      <path d="M2 12h20"/>
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

function IconStar() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
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

const features = [
  {
    icon: <IconCloud />,
    title: 'Unlimited Storage',
    description:
      'Store files of any type, up to 10 GB per file. Your data lives on infrastructure you control — no artificial limits from a vendor.',
  },
  {
    icon: <IconFolder />,
    title: 'Smart Organization',
    description:
      'Nested folders, star favorites, color-label folders, create shortcuts, and bulk-manage thousands of files in seconds.',
  },
  {
    icon: <IconShield />,
    title: 'Privacy First',
    description:
      'Self-hosted means only you hold the keys. Your files never touch a third-party cloud. Full audit trail on every action.',
  },
  {
    icon: <IconZap />,
    title: 'Built for Speed',
    description:
      'Rust backend handles streaming uploads and downloads with HTTP Range support. Resume interrupted transfers without losing progress.',
  },
  {
    icon: <IconUsers />,
    title: 'Team-Ready',
    description:
      'Per-user storage quotas, daily upload caps, and admin controls. Built from day one for organizations of any size.',
  },
  {
    icon: <IconGlobe />,
    title: 'Open Source',
    description:
      'Every line of code is auditable and forkable. Build on top of Neutrino, contribute back, or just trust what you can verify.',
  },
];

const selfHostBenefits = [
  'Your data never leaves your servers',
  'No per-seat pricing or vendor lock-in',
  'Customize storage limits and policies',
  'Integrate with your existing infrastructure',
  'Full control over retention and deletion',
  'GDPR and compliance-friendly by default',
];

const roadmapItems = [
  { phase: '1.0', label: 'Bootstrap', done: true, desc: 'Auth, health checks, workspace setup' },
  { phase: '1.1', label: 'Cloud Storage', done: true, desc: 'Upload, download, quotas, metadata' },
  { phase: '1.2', label: 'File System', done: true, desc: 'Folders, trash, stars, shortcuts, bulk ops' },
  { phase: '1.3', label: 'File Preview', done: false, desc: 'In-browser PDF, image, video, text viewer' },
  { phase: '1.4', label: 'Versioning', done: false, desc: 'Automatic snapshots, version history, restore' },
  { phase: '2.0', label: 'Sharing', done: false, desc: 'Link sharing, role-based permissions, IRM' },
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
            <a href="#features" className={styles.navLink}>Features</a>
            <a href="#self-host" className={styles.navLink}>Self-Host</a>
            <a href="#roadmap" className={styles.navLink}>Roadmap</a>
            <a
              href="https://github.com/your-org/neutrino"
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
            Open source · MIT license
          </div>
          <h1 className={styles.heroHeading}>
            Cloud storage that
            <br />
            <span className={styles.heroAccent}>belongs to you</span>
          </h1>
          <p className={styles.heroSub}>
            Neutrino is a fast, open-source cloud storage platform built with Rust.
            Self-host on any server you own, or use our fully managed service.
            No artificial limits. No surveillance. Just your files.
          </p>
          <div className={styles.heroCtas}>
            <Link href="/register" className={styles.ctaPrimary}>
              Try hosted free
              <IconArrowRight />
            </Link>
            <a href="#self-host" className={styles.ctaSecondary}>
              Self-host in minutes
            </a>
          </div>
          <p className={styles.heroNote}>
            Hosted version at{' '}
            <a href="/sign-in" className={styles.heroNoteLink}>
              neutrino.app
            </a>{' '}
            · No credit card required
          </p>
        </div>

        {/* Hero visual */}
        <div className={styles.heroVisual} aria-hidden>
          <div className={styles.heroCard}>
            <div className={styles.heroCardBar}>
              <span className={styles.dot} style={{ background: '#ff5f57' }} />
              <span className={styles.dot} style={{ background: '#febc2e' }} />
              <span className={styles.dot} style={{ background: '#28c840' }} />
              <span className={styles.heroCardTitle}>My Drive</span>
            </div>
            <div className={styles.heroCardRow}>
              <span className={styles.heroCardIcon}>📁</span>
              <span className={styles.heroCardName}>Projects</span>
              <span className={styles.heroCardMeta}>4 items</span>
            </div>
            <div className={styles.heroCardRow}>
              <span className={styles.heroCardIcon}>📁</span>
              <span className={styles.heroCardName}>Design</span>
              <span className={styles.heroCardMeta}>12 items</span>
            </div>
            <div className={`${styles.heroCardRow} ${styles.heroCardRowActive}`}>
              <span className={styles.heroCardIcon}>📄</span>
              <span className={styles.heroCardName}>Q4 Report.pdf</span>
              <span className={styles.heroCardMeta}>2.4 MB</span>
            </div>
            <div className={styles.heroCardRow}>
              <span className={styles.heroCardIcon}>🖼️</span>
              <span className={styles.heroCardName}>Cover photo.png</span>
              <span className={styles.heroCardMeta}>840 KB</span>
            </div>
            <div className={styles.heroCardRow}>
              <span className={styles.heroCardIcon}>📦</span>
              <span className={styles.heroCardName}>Archive.zip</span>
              <span className={styles.heroCardMeta}>18 MB</span>
            </div>
            <div className={styles.heroCardQuota}>
              <div className={styles.heroCardQuotaBar}>
                <div className={styles.heroCardQuotaFill} style={{ width: '34%' }} />
              </div>
              <span>21.3 GB of 50 GB used</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats bar ── */}
      <div className={styles.stats}>
        <div className={styles.statsInner}>
          <div className={styles.stat}>
            <span className={styles.statValue}>10 GB</span>
            <span className={styles.statLabel}>max file size</span>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.stat}>
            <span className={styles.statValue}>Rust</span>
            <span className={styles.statLabel}>backend language</span>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.stat}>
            <span className={styles.statValue}>HTTP Range</span>
            <span className={styles.statLabel}>resume support</span>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.stat}>
            <span className={styles.statValue}>MIT</span>
            <span className={styles.statLabel}>open source license</span>
          </div>
        </div>
      </div>

      {/* ── Features ── */}
      <section id="features" className={styles.section}>
        <div className={styles.sectionInner}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionEyebrow}>Everything you need</span>
            <h2 className={styles.sectionHeading}>Built for real work</h2>
            <p className={styles.sectionSub}>
              Neutrino covers the full lifecycle of cloud storage — from upload to organization,
              search, sharing, and beyond. Here&apos;s what&apos;s available today.
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

      {/* ── How it works ── */}
      <section className={styles.sectionAlt}>
        <div className={styles.sectionInner}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionEyebrow}>Simple workflow</span>
            <h2 className={styles.sectionHeading}>Store, organize, access</h2>
          </div>
          <div className={styles.stepsGrid}>
            <div className={styles.step}>
              <div className={styles.stepNumber}>01</div>
              <h3 className={styles.stepTitle}>Upload anything</h3>
              <p className={styles.stepDesc}>
                Drag and drop files up to 10 GB. Streaming multipart upload means
                you never wait for the whole file to buffer before transfer begins.
              </p>
            </div>
            <div className={styles.stepConnector} aria-hidden />
            <div className={styles.step}>
              <div className={styles.stepNumber}>02</div>
              <h3 className={styles.stepTitle}>Organize your way</h3>
              <p className={styles.stepDesc}>
                Create nested folders, star favorites, add color labels, and build shortcuts
                so a file appears in multiple places without duplicating storage.
              </p>
            </div>
            <div className={styles.stepConnector} aria-hidden />
            <div className={styles.step}>
              <div className={styles.stepNumber}>03</div>
              <h3 className={styles.stepTitle}>Access from anywhere</h3>
              <p className={styles.stepDesc}>
                Download with HTTP Range support so interrupted transfers resume exactly
                where they left off — even on slow or flaky connections.
              </p>
            </div>
          </div>
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
                Deploy Neutrino on any Linux server, VPS, Raspberry Pi, or bare metal box.
                A single binary backed by SQLite — no external database required to get started.
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
                <a
                  href="https://github.com/your-org/neutrino#self-hosting"
                  className={styles.ctaPrimary}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Read the docs
                  <IconArrowRight />
                </a>
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
                <pre className={styles.code}><code>{`# Download the latest release
curl -LO https://github.com/your-org/neutrino/releases/latest/download/drive-linux-x86_64

chmod +x drive-linux-x86_64

# Configure your instance
export JWT_SECRET="$(openssl rand -hex 32)"
export DATABASE_URL="neutrino.db"
export STORAGE_PATH="/var/neutrino/storage"
export PORT=8080

# Run
./drive-linux-x86_64

# ✓ Neutrino Drive listening on 0.0.0.0:8080
# ✓ Database migrations applied
# ✓ Storage path: /var/neutrino/storage`}</code></pre>
              </div>
              <p className={styles.codeNote}>
                Or use Docker: <code>docker run -e JWT_SECRET=... ghcr.io/your-org/neutrino:latest</code>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Roadmap ── */}
      <section id="roadmap" className={styles.section}>
        <div className={styles.sectionInner}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionEyebrow}>What&apos;s coming</span>
            <h2 className={styles.sectionHeading}>Roadmap</h2>
            <p className={styles.sectionSub}>
              Neutrino is under active development. File storage and organization are
              complete and production-ready. Here&apos;s what&apos;s next.
            </p>
          </div>
          <div className={styles.roadmap}>
            {roadmapItems.map((item) => (
              <div key={item.phase} className={`${styles.roadmapItem} ${item.done ? styles.roadmapItemDone : ''}`}>
                <div className={styles.roadmapDot}>
                  {item.done ? <IconCheck /> : null}
                </div>
                <div className={styles.roadmapContent}>
                  <div className={styles.roadmapPhase}>Phase {item.phase}</div>
                  <div className={styles.roadmapLabel}>{item.label}</div>
                  <div className={styles.roadmapDesc}>{item.desc}</div>
                </div>
              </div>
            ))}
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
            Use the hosted version at neutrino.app — free, no credit card.
            Or self-host in minutes on your own infrastructure.
          </p>
          <div className={styles.finalCtaButtons}>
            <Link href="/register" className={styles.ctaPrimary}>
              Create free account
              <IconArrowRight />
            </Link>
            <Link href="/sign-in" className={styles.ctaSecondary}>
              Sign in
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
              Open-source cloud storage built with Rust.
            </p>
            <a
              href="https://github.com/your-org/neutrino"
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
              <a href="#features" className={styles.footerLink}>Features</a>
              <a href="#roadmap" className={styles.footerLink}>Roadmap</a>
              <Link href="/register" className={styles.footerLink}>Hosted version</Link>
            </div>
            <div className={styles.footerCol}>
              <div className={styles.footerColTitle}>Self-Host</div>
              <a href="https://github.com/your-org/neutrino#self-hosting" className={styles.footerLink} target="_blank" rel="noopener noreferrer">Getting started</a>
              <a href="https://github.com/your-org/neutrino/releases" className={styles.footerLink} target="_blank" rel="noopener noreferrer">Releases</a>
              <a href="https://github.com/your-org/neutrino/blob/main/docs" className={styles.footerLink} target="_blank" rel="noopener noreferrer">Documentation</a>
            </div>
            <div className={styles.footerCol}>
              <div className={styles.footerColTitle}>Account</div>
              <Link href="/sign-in" className={styles.footerLink}>Sign in</Link>
              <Link href="/register" className={styles.footerLink}>Register</Link>
            </div>
          </div>
        </div>
        <div className={styles.footerBottom}>
          <span>© {new Date().getFullYear()} Neutrino. MIT License.</span>
          <div className={styles.footerBottomLinks}>
            <a href="/privacy" className={styles.footerBottomLink}>Privacy</a>
            <a href="/terms" className={styles.footerBottomLink}>Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
