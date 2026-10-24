import { detectPlatform, type Platform } from '@neutrino/commands';

/**
 * Whether a mousedown is a Mac Ctrl-click — a right-click that arrives as a left-button
 * mousedown with Ctrl held. Elsewhere Ctrl-click is an ordinary click (Ctrl+click to extend or
 * follow a link), so the platform decides.
 */
export function isMacContextClick(event: Pick<MouseEvent, 'ctrlKey' | 'button'>, platform: Platform = detectPlatform()): boolean {
  return platform === 'mac' && event.ctrlKey && event.button === 0;
}
