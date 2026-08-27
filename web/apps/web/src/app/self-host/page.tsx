import Link from 'next/link';
import type { Metadata } from 'next';
import styles from './page.module.css';

const GITHUB_URL = 'https://github.com/wcherry/neutrino';
const IMAGE = 'ghcr.io/wcherry/neutrino:latest';

export const metadata: Metadata = {
  title: 'Self-hosting Neutrino — installation, configuration and upgrades',
  description:
    'Run the whole Neutrino suite on your own server. Docker and binary installs, the full environment variable reference, TLS, backups and upgrades.',
};

function IconGithub() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z"/>
    </svg>
  );
}

function Code({ children, title = 'Terminal' }: { children: string; title?: string }) {
  return (
    <div className={styles.codeWindow}>
      <div className={styles.codeWindowBar}>
        <span className={styles.dot} style={{ background: '#ff5f57' }} />
        <span className={styles.dot} style={{ background: '#febc2e' }} />
        <span className={styles.dot} style={{ background: '#28c840' }} />
        <span className={styles.codeWindowTitle}>{title}</span>
      </div>
      <pre className={styles.code}><code>{children}</code></pre>
    </div>
  );
}

const requiredVars = [
  {
    name: 'JWT_SECRET',
    default: '—',
    desc: 'Secret used to sign access and refresh tokens. Generate with openssl rand -hex 32. Changing it signs everyone out.',
  },
  {
    name: 'WORKER_SECRET',
    default: '—',
    desc: 'Shared secret the background worker authenticates with. Generate the same way; never reuse JWT_SECRET.',
  },
];

const commonVars = [
  { name: 'PORT', default: '8080', desc: 'HTTP listen port.' },
  { name: 'DATABASE_URL', default: './data/neutrino.db', desc: 'Path to the SQLite database file. Point this at your mounted volume.' },
  { name: 'STORAGE_PATH', default: './data/storage', desc: 'Root directory for uploaded files. Put it on the same volume as the database.' },
  { name: 'APP_BASE_URL', default: 'http://localhost:<PORT>', desc: 'Public base URL used in links sent to users. Set this to your real hostname or emailed links will point at localhost.' },
  { name: 'SELF_URL', default: 'http://localhost:<PORT>', desc: 'Public base URL of this server.' },
  { name: 'DRIVE_URL', default: 'http://localhost:<PORT>', desc: 'Public URL of the Drive service.' },
  { name: 'MAX_UPLOAD_BYTES', default: '10737418240', desc: 'Largest single-file upload, in bytes. Defaults to 10 GiB.' },
  { name: 'LOG_LEVEL', default: 'info', desc: 'One of error, warn, info, debug, trace.' },
  { name: 'LOG_PATH', default: '(stdout only)', desc: 'Directory for log files. Leave unset to log to stdout, which is what you want under Docker.' },
  { name: 'WEB_DIR', default: 'web/apps/web/out', desc: 'Path to the built web app. Already set correctly inside the Docker image.' },
];

const optionalVars = [
  { name: 'JWT_ACCESS_EXPIRY_SECS', default: '900', desc: 'Access token lifetime in seconds.' },
  { name: 'JWT_REFRESH_EXPIRY_SECS', default: '604800', desc: 'Refresh token lifetime in seconds. Defaults to 7 days.' },
  { name: 'JOBS_PER_WORKER', default: '4', desc: 'Maximum concurrent background jobs per worker.' },
  { name: 'GOOGLE_CLIENT_ID', default: '(optional)', desc: 'Google OAuth client ID, for calendar sync.' },
  { name: 'GOOGLE_CLIENT_SECRET', default: '(optional)', desc: 'Google OAuth client secret.' },
  { name: 'GOOGLE_REDIRECT_URI', default: '<DRIVE_URL>/api/v1/connections/google/callback', desc: 'OAuth redirect URI registered with Google.' },
  { name: 'OUTLOOK_CLIENT_ID', default: '(optional)', desc: 'Microsoft OAuth client ID, for calendar sync.' },
  { name: 'OUTLOOK_CLIENT_SECRET', default: '(optional)', desc: 'Microsoft OAuth client secret.' },
];

function VarTable({ rows }: { rows: { name: string; default: string; desc: string }[] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Variable</th>
            <th scope="col">Default</th>
            <th scope="col">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td><code className={styles.inlineCode}>{r.name}</code></td>
              <td className={styles.tableDefault}><code className={styles.inlineCode}>{r.default}</code></td>
              <td>{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const toc = [
  { href: '#requirements', label: 'What you need' },
  { href: '#docker', label: 'Install with Docker' },
  { href: '#compose', label: 'Docker Compose' },
  { href: '#binary', label: 'Install from a binary' },
  { href: '#first-run', label: 'First run' },
  { href: '#configuration', label: 'Configuration reference' },
  { href: '#tls', label: 'TLS and reverse proxy' },
  { href: '#backups', label: 'Backups' },
  { href: '#upgrades', label: 'Upgrades' },
  { href: '#troubleshooting', label: 'Troubleshooting' },
];

export default function SelfHostPage() {
  return (
    <div className={styles.page}>
      {/* ── Nav ── */}
      <header className={styles.nav}>
        <div className={styles.navInner}>
          <Link href="/" className={styles.logo}>
            <span className={styles.logoMark}>N</span>
            <span className={styles.logoText}>Neutrino</span>
          </Link>
          <nav className={styles.navLinks} aria-label="Site navigation">
            <Link href="/#apps" className={styles.navLink}>Apps</Link>
            <Link href="/#features" className={styles.navLink}>Features</Link>
            <Link href="/#roadmap" className={styles.navLink}>Roadmap</Link>
            <a href={GITHUB_URL} className={styles.navLink} target="_blank" rel="noopener noreferrer">
              <IconGithub />
              GitHub
            </a>
          </nav>
          <div className={styles.navActions}>
            <Link href="/sign-in" className={styles.navSignIn}>Sign in</Link>
            <Link href="/register" className={styles.btnPrimary}>Get started free</Link>
          </div>
        </div>
      </header>

      {/* ── Header ── */}
      <section className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.backLink}>← Back to home</Link>
          <h1 className={styles.title}>Self-hosting Neutrino</h1>
          <p className={styles.lede}>
            Neutrino ships as a single binary that serves the API, the background worker
            and the web app from one process, backed by SQLite. There is no external
            database, message queue or object store to stand up first. A small VPS, a NAS
            or a Raspberry Pi is enough to run the whole suite for a household or a team.
          </p>
        </div>
      </section>

      <div className={styles.layout}>
        {/* ── Table of contents ── */}
        <aside className={styles.toc} aria-label="On this page">
          <div className={styles.tocInner}>
            <div className={styles.tocTitle}>On this page</div>
            <nav className={styles.tocList}>
              {toc.map((t) => (
                <a key={t.href} href={t.href} className={styles.tocLink}>{t.label}</a>
              ))}
            </nav>
          </div>
        </aside>

        {/* ── Content ── */}
        <main className={styles.content}>

          <section id="requirements" className={styles.block}>
            <h2 className={styles.h2}>What you need</h2>
            <ul className={styles.list}>
              <li><strong>A Linux host</strong> — x86-64 or ARM64. 1 vCPU and 1 GB of RAM runs a small instance comfortably.</li>
              <li><strong>Disk space</strong> for whatever you plan to store, plus a little headroom. Files live on the filesystem, not in the database.</li>
              <li><strong>Docker</strong>, if you want the one-command install. Otherwise just the binary.</li>
              <li><strong>A hostname and TLS certificate</strong> if you intend to reach it from outside your network. See <a href="#tls" className={styles.inlineLink}>TLS and reverse proxy</a>.</li>
            </ul>
            <div className={styles.callout}>
              <strong>Two secrets are mandatory.</strong> The server refuses to start without
              <code className={styles.inlineCode}>JWT_SECRET</code> and
              <code className={styles.inlineCode}>WORKER_SECRET</code>. Generate them once,
              store them somewhere safe, and reuse them across restarts — regenerating
              <code className={styles.inlineCode}>JWT_SECRET</code> invalidates every session.
            </div>
          </section>

          <section id="docker" className={styles.block}>
            <h2 className={styles.h2}>Install with Docker</h2>
            <p className={styles.p}>
              The published image contains the Rust server, the background worker and the
              prebuilt web app. It listens on port 8080 and keeps all state under
              <code className={styles.inlineCode}>/usr/local/data</code>, which is declared
              as a volume — mount it somewhere durable or an upgrade will take your data with it.
            </p>
            <Code>{`# Generate your secrets once and keep them
export JWT_SECRET="$(openssl rand -hex 32)"
export WORKER_SECRET="$(openssl rand -hex 32)"

docker run -d --name neutrino \\
  -p 8080:8080 \\
  -e JWT_SECRET="$JWT_SECRET" \\
  -e WORKER_SECRET="$WORKER_SECRET" \\
  -e DATABASE_URL=/usr/local/data/neutrino.db \\
  -e STORAGE_PATH=/usr/local/data/storage \\
  -e APP_BASE_URL=https://neutrino.example.com \\
  -e SELF_URL=https://neutrino.example.com \\
  -e DRIVE_URL=https://neutrino.example.com \\
  -v neutrino-data:/usr/local/data \\
  --restart unless-stopped \\
  ${IMAGE}`}</Code>
            <p className={styles.p}>
              Then open <code className={styles.inlineCode}>http://your-host:8080</code>. The
              database migrations run automatically on first boot — there is no separate
              migration step.
            </p>
          </section>

          <section id="compose" className={styles.block}>
            <h2 className={styles.h2}>Docker Compose</h2>
            <p className={styles.p}>
              Easier to live with than a long <code className={styles.inlineCode}>docker run</code>.
              Put the secrets in a <code className={styles.inlineCode}>.env</code> file next to
              this one and keep it out of version control.
            </p>
            <Code title="docker-compose.yml">{`services:
  neutrino:
    image: ${IMAGE}
    container_name: neutrino
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      JWT_SECRET: \${JWT_SECRET}
      WORKER_SECRET: \${WORKER_SECRET}
      DATABASE_URL: /usr/local/data/neutrino.db
      STORAGE_PATH: /usr/local/data/storage
      APP_BASE_URL: https://neutrino.example.com
      SELF_URL: https://neutrino.example.com
      DRIVE_URL: https://neutrino.example.com
      LOG_LEVEL: info
    volumes:
      - ./data:/usr/local/data
      - ./logs:/usr/local/logs`}</Code>
            <Code>{`docker compose up -d
docker compose logs -f neutrino`}</Code>
          </section>

          <section id="binary" className={styles.block}>
            <h2 className={styles.h2}>Install from a binary</h2>
            <p className={styles.p}>
              If you would rather not run Docker, grab a release, give it a config and run
              it under systemd. The binary needs the built web app on disk and pointed at
              by <code className={styles.inlineCode}>WEB_DIR</code>.
            </p>
            <Code>{`# Fetch the latest release for your platform
curl -fsSL -o neutrino \\
  ${GITHUB_URL}/releases/latest/download/neutrino-linux-x86_64
chmod +x neutrino
sudo mv neutrino /usr/local/bin/neutrino

# Somewhere for state to live
sudo mkdir -p /var/lib/neutrino/storage
sudo useradd --system --home /var/lib/neutrino neutrino
sudo chown -R neutrino:neutrino /var/lib/neutrino`}</Code>
            <p className={styles.p}>
              Put the configuration in an environment file rather than in the unit, so the
              secrets are not world-readable in <code className={styles.inlineCode}>systemctl show</code>:
            </p>
            <Code title="/etc/neutrino/neutrino.env">{`JWT_SECRET=replace-me-with-openssl-rand-hex-32
WORKER_SECRET=replace-me-too
DATABASE_URL=/var/lib/neutrino/neutrino.db
STORAGE_PATH=/var/lib/neutrino/storage
WEB_DIR=/usr/local/share/neutrino/web
APP_BASE_URL=https://neutrino.example.com
SELF_URL=https://neutrino.example.com
DRIVE_URL=https://neutrino.example.com
PORT=8080
LOG_LEVEL=info`}</Code>
            <Code title="/etc/systemd/system/neutrino.service">{`[Unit]
Description=Neutrino
After=network-online.target
Wants=network-online.target

[Service]
User=neutrino
Group=neutrino
EnvironmentFile=/etc/neutrino/neutrino.env
ExecStart=/usr/local/bin/neutrino
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/neutrino

[Install]
WantedBy=multi-user.target`}</Code>
            <Code>{`sudo chmod 600 /etc/neutrino/neutrino.env
sudo systemctl daemon-reload
sudo systemctl enable --now neutrino
sudo systemctl status neutrino`}</Code>
          </section>

          <section id="first-run" className={styles.block}>
            <h2 className={styles.h2}>First run</h2>
            <ol className={styles.orderedList}>
              <li>Open your instance and <strong>register the first account</strong>. Do this immediately — registration is open, so the first person to reach a fresh instance gets an account on it.</li>
              <li><strong>Turn on two-factor authentication</strong> in Settings. The server supports TOTP, so any authenticator app works.</li>
              <li><strong>Save your encryption key.</strong> Docs, Sheets, Slides and Notes are end-to-end encrypted with a key generated in your browser. The server never sees it, which also means it cannot recover it for you. Export it and store it with your other credentials before you put real work in.</li>
              <li><strong>Set quotas</strong> from the admin panel if more than one person will use the instance.</li>
              <li><strong>Check the API docs</strong> at <code className={styles.inlineCode}>/swagger-ui/</code> if you plan to script against it.</li>
            </ol>
            <div className={styles.calloutWarn}>
              <strong>The encryption key is not recoverable.</strong> Losing it means losing
              the contents of every encrypted document — self-hosting the server does not
              change that, because the server never held the key in the first place.
            </div>
          </section>

          <section id="configuration" className={styles.block}>
            <h2 className={styles.h2}>Configuration reference</h2>
            <p className={styles.p}>
              Everything is read from the environment, or from a
              <code className={styles.inlineCode}>.env</code> file in the working directory.
            </p>

            <h3 className={styles.h3}>Required</h3>
            <VarTable rows={requiredVars} />

            <h3 className={styles.h3}>Paths and networking</h3>
            <VarTable rows={commonVars} />

            <h3 className={styles.h3}>Optional</h3>
            <VarTable rows={optionalVars} />
          </section>

          <section id="tls" className={styles.block}>
            <h2 className={styles.h2}>TLS and reverse proxy</h2>
            <p className={styles.p}>
              Neutrino speaks plain HTTP and expects something in front of it to terminate
              TLS. Browsers gate the Web Crypto APIs that the end-to-end encryption depends
              on behind a secure context, so anything other than
              <code className={styles.inlineCode}>localhost</code> needs to be served over
              HTTPS — this is not optional in practice.
            </p>
            <Code title="Caddyfile">{`neutrino.example.com {
	reverse_proxy localhost:8080
}`}</Code>
            <p className={styles.p}>Or with nginx, raising the body limit so large uploads survive the proxy:</p>
            <Code title="nginx">{`server {
    server_name neutrino.example.com;
    listen 443 ssl http2;

    # Match or exceed MAX_UPLOAD_BYTES; 0 disables the check entirely.
    client_max_body_size 0;
    proxy_request_buffering off;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Live collaboration and note sync use WebSockets.
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}`}</Code>
            <div className={styles.callout}>
              Set <code className={styles.inlineCode}>APP_BASE_URL</code>,
              <code className={styles.inlineCode}>SELF_URL</code> and
              <code className={styles.inlineCode}>DRIVE_URL</code> to the public HTTPS
              hostname. They are what share links and emails are built from, so if they
              still say <code className={styles.inlineCode}>localhost</code> those links
              will be wrong for everyone but you.
            </div>
          </section>

          <section id="backups" className={styles.block}>
            <h2 className={styles.h2}>Backups</h2>
            <p className={styles.p}>
              There are two things to back up: the SQLite database and the storage
              directory. The database runs in WAL mode, so copying the file while the
              server is running can capture a torn state — use
              <code className={styles.inlineCode}>sqlite3 .backup</code>, which takes a
              consistent snapshot without stopping anything.
            </p>
            <Code>{`#!/bin/sh
set -eu
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="/backups/neutrino/$STAMP"
mkdir -p "$DEST"

# Consistent database snapshot, safe while the server is running
sqlite3 /var/lib/neutrino/neutrino.db ".backup '$DEST/neutrino.db'"

# File contents
rsync -a --delete /var/lib/neutrino/storage/ "$DEST/storage/"

# Keep the last 14 days
find /backups/neutrino -maxdepth 1 -mtime +14 -type d -exec rm -rf {} +`}</Code>
            <p className={styles.p}>
              Back up your <code className={styles.inlineCode}>JWT_SECRET</code> and
              <code className={styles.inlineCode}>WORKER_SECRET</code> alongside the data.
              Restoring a database against a different <code className={styles.inlineCode}>JWT_SECRET</code>
              signs out every user; it does not lose data, but it is a surprise you do not
              want during a restore. Test a restore before you need one.
            </p>
          </section>

          <section id="upgrades" className={styles.block}>
            <h2 className={styles.h2}>Upgrades</h2>
            <p className={styles.p}>
              Migrations are embedded in the binary and run on startup, so an upgrade is
              pull, restart, done. Take a backup first — migrations move forward only, and
              there is no downgrade path.
            </p>
            <Code>{`# Back up first (see above), then:
docker compose pull
docker compose up -d

# Or for a binary install:
sudo systemctl stop neutrino
sudo curl -fsSL -o /usr/local/bin/neutrino \\
  ${GITHUB_URL}/releases/latest/download/neutrino-linux-x86_64
sudo chmod +x /usr/local/bin/neutrino
sudo systemctl start neutrino`}</Code>
          </section>

          <section id="troubleshooting" className={styles.block}>
            <h2 className={styles.h2}>Troubleshooting</h2>

            <h3 className={styles.h3}>The server exits immediately on start</h3>
            <p className={styles.p}>
              Almost always a missing <code className={styles.inlineCode}>JWT_SECRET</code> or
              <code className={styles.inlineCode}>WORKER_SECRET</code>. Check the first few
              lines of the log — the failure is reported before anything else happens.
            </p>

            <h3 className={styles.h3}>Uploads fail for large files</h3>
            <p className={styles.p}>
              Your reverse proxy is rejecting the body before it reaches Neutrino. Raise
              <code className={styles.inlineCode}>client_max_body_size</code> in nginx (or the
              equivalent) to at least <code className={styles.inlineCode}>MAX_UPLOAD_BYTES</code>,
              and turn off request buffering so uploads stream rather than landing on the
              proxy&apos;s disk first.
            </p>

            <h3 className={styles.h3}>Editors will not open, or encryption errors appear</h3>
            <p className={styles.p}>
              The browser is not in a secure context. Serve the instance over HTTPS, or use
              <code className={styles.inlineCode}>http://localhost</code> for local testing.
            </p>

            <h3 className={styles.h3}>Share links point at localhost</h3>
            <p className={styles.p}>
              <code className={styles.inlineCode}>APP_BASE_URL</code>,
              <code className={styles.inlineCode}>SELF_URL</code> and
              <code className={styles.inlineCode}>DRIVE_URL</code> are still on their
              defaults. Set all three to the public hostname and restart.
            </p>

            <h3 className={styles.h3}>Live collaboration does not connect</h3>
            <p className={styles.p}>
              WebSocket upgrades are being dropped by the proxy. Forward the
              <code className={styles.inlineCode}>Upgrade</code> and
              <code className={styles.inlineCode}>Connection</code> headers, and raise the
              read timeout so idle sockets are not culled mid-session.
            </p>

            <h3 className={styles.h3}>Still stuck</h3>
            <p className={styles.p}>
              Turn up the logs with <code className={styles.inlineCode}>LOG_LEVEL=debug</code>,
              and check the API surface at <code className={styles.inlineCode}>/swagger-ui/</code>.
              If it looks like a bug, open an issue on{' '}
              <a href={`${GITHUB_URL}/issues`} className={styles.inlineLink} target="_blank" rel="noopener noreferrer">GitHub</a>{' '}
              with the log lines around the failure.
            </p>
          </section>

          <section className={styles.ctaBlock}>
            <h2 className={styles.ctaHeading}>Rather not run a server?</h2>
            <p className={styles.p}>
              The hosted version is the same software, kept up to date for you. You can
              export everything and move to your own box whenever you like.
            </p>
            <div className={styles.ctaButtons}>
              <Link href="/register" className={styles.ctaPrimary}>Try the hosted version</Link>
              <a href={GITHUB_URL} className={styles.ctaSecondary} target="_blank" rel="noopener noreferrer">
                <IconGithub />
                Read the source
              </a>
            </div>
          </section>
        </main>
      </div>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>© {new Date().getFullYear()} Neutrino. MIT License.</span>
          <div className={styles.footerLinks}>
            <Link href="/" className={styles.footerLink}>Home</Link>
            <a href={GITHUB_URL} className={styles.footerLink} target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href={`${GITHUB_URL}/releases`} className={styles.footerLink} target="_blank" rel="noopener noreferrer">Releases</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
