'use client';

import { useState } from 'react';
import styles from './AppShowcase.module.css';

export interface ShowcaseApp {
  id: string;
  label: string;
  headline: string;
  description: string;
  bullets: string[];
  image: string;
  alt: string;
}

/**
 * Tabbed tour of the suite. Every panel stays mounted so switching tabs never
 * re-downloads a screenshot; only the first is eager, the rest load lazily as
 * the section scrolls into view.
 */
export function AppShowcase({ apps }: { apps: ShowcaseApp[] }) {
  const [active, setActive] = useState(apps[0]?.id);

  return (
    <div className={styles.showcase}>
      <div className={styles.tabs} role="tablist" aria-label="Applications">
        {apps.map((app) => (
          <button
            key={app.id}
            type="button"
            role="tab"
            id={`tab-${app.id}`}
            aria-selected={active === app.id}
            aria-controls={`panel-${app.id}`}
            className={`${styles.tab} ${active === app.id ? styles.tabActive : ''}`}
            onClick={() => setActive(app.id)}
          >
            {app.label}
          </button>
        ))}
      </div>

      {apps.map((app, i) => (
        <div
          key={app.id}
          role="tabpanel"
          id={`panel-${app.id}`}
          aria-labelledby={`tab-${app.id}`}
          hidden={active !== app.id}
          className={styles.panel}
        >
          <div className={styles.panelText}>
            <h3 className={styles.panelHeading}>{app.headline}</h3>
            <p className={styles.panelDesc}>{app.description}</p>
            <ul className={styles.panelList}>
              {app.bullets.map((b) => (
                <li key={b} className={styles.panelListItem}>
                  <span className={styles.panelBullet} aria-hidden />
                  {b}
                </li>
              ))}
            </ul>
          </div>
          <div className={styles.panelShot}>
            <BrowserFrame src={app.image} alt={app.alt} eager={i === 0} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A screenshot dressed as a browser window, so it reads as product not decoration. */
export function BrowserFrame({
  src,
  alt,
  eager = false,
  className = '',
}: {
  src: string;
  alt: string;
  eager?: boolean;
  className?: string;
}) {
  return (
    <figure className={`${styles.frame} ${className}`}>
      <div className={styles.frameBar} aria-hidden>
        <span className={styles.frameDot} style={{ background: '#ff5f57' }} />
        <span className={styles.frameDot} style={{ background: '#febc2e' }} />
        <span className={styles.frameDot} style={{ background: '#28c840' }} />
        <span className={styles.frameUrl}>getneutrino.app</span>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        width={2000}
        height={1250}
        className={styles.frameImg}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
    </figure>
  );
}
