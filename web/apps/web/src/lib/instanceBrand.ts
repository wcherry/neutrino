/**
 * The instance's brand, as the server wrote it into this page (`src/branding/inject.rs`).
 *
 * Every branded element reads it on its first render — none is prerendered (the app shell renders
 * on hydration, sign-in behind its Suspense boundary) — so the page never shows Neutrino's name
 * and then swaps. An uploaded logo is drawn by the server's CSS over `data-brand="logo"`.
 *
 * A plain module with no imports, so the signed-out pages can read it without the app's stores.
 */

export interface InstanceBrand {
  name?: string;
  signInMessage?: string;
}

export function readInstanceBrand(): InstanceBrand {
  if (typeof window === 'undefined') return {};
  const brand = (window as unknown as { __NEUTRINO_INSTANCE__?: { brand?: Record<string, unknown> } }).__NEUTRINO_INSTANCE__?.brand;
  const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  return brand ? { name: text(brand.name), signInMessage: text(brand.signInMessage) } : {};
}
