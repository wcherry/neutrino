'use client';

import { readInstanceBrand } from '@/lib/instanceBrand';
import styles from './page.module.css';

/**
 * The instance's name and logo. The name comes from the brand the server wrote into this page
 * (`lib/instanceBrand.ts`) — this form is never prerendered, so its first paint is already the
 * instance's. An uploaded logo is drawn over `data-brand="logo"` by the server's CSS, which also
 * hides the name beside it (`data-brand="name"`).
 */
export function BrandRow() {
  return (
    <div className={styles.logoRow}>
      <div className={styles.logoMark} data-brand="logo">N</div>
      <span className={styles.logoText} data-brand="name">{readInstanceBrand().name ?? 'Neutrino'}</span>
    </div>
  );
}
