import { describe, it, expect } from 'vitest';
import type { Variants } from 'framer-motion';
import {
  fadeIn,
  slideUp,
  slideDown,
  slideLeft,
  slideRight,
  scaleIn,
  scaleUp,
  drawerLeft,
  drawerRight,
  drawerBottom,
  staggerContainer,
  staggerItem,
  toastVariants,
} from '../motion/variants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasAllStates(v: Variants) {
  return 'initial' in v && 'animate' in v && 'exit' in v;
}

// ---------------------------------------------------------------------------
// Presence of initial / animate / exit
// ---------------------------------------------------------------------------

describe('all variants expose initial, animate, and exit states', () => {
  const variantMap: Record<string, Variants> = {
    fadeIn,
    slideUp,
    slideDown,
    slideLeft,
    slideRight,
    scaleIn,
    scaleUp,
    drawerLeft,
    drawerRight,
    drawerBottom,
    toastVariants,
  };

  for (const [name, variant] of Object.entries(variantMap)) {
    it(`${name} has initial, animate, and exit`, () => {
      expect(hasAllStates(variant)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// fadeIn
// ---------------------------------------------------------------------------

describe('fadeIn', () => {
  it('initial opacity is 0', () => {
    expect((fadeIn.initial as { opacity: number }).opacity).toBe(0);
  });

  it('animate opacity is 1', () => {
    expect((fadeIn.animate as { opacity: number }).opacity).toBe(1);
  });

  it('exit opacity is 0', () => {
    expect((fadeIn.exit as { opacity: number }).opacity).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// slideUp
// ---------------------------------------------------------------------------

describe('slideUp', () => {
  it('initial y is positive (starts below)', () => {
    const { y } = slideUp.initial as { y: number };
    expect(y).toBeGreaterThan(0);
  });

  it('animate y is 0', () => {
    expect((slideUp.animate as { y: number }).y).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// slideDown
// ---------------------------------------------------------------------------

describe('slideDown', () => {
  it('initial y is negative (starts above)', () => {
    const { y } = slideDown.initial as { y: number };
    expect(y).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// slideLeft / slideRight
// ---------------------------------------------------------------------------

describe('slideLeft', () => {
  it('initial x is positive (starts to the right)', () => {
    const { x } = slideLeft.initial as { x: number };
    expect(x).toBeGreaterThan(0);
  });
});

describe('slideRight', () => {
  it('initial x is negative (starts to the left)', () => {
    const { x } = slideRight.initial as { x: number };
    expect(x).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// scale variants
// ---------------------------------------------------------------------------

describe('scaleIn', () => {
  it('initial scale is less than 1', () => {
    const { scale } = scaleIn.initial as { scale: number };
    expect(scale).toBeLessThan(1);
  });

  it('animate scale is 1', () => {
    expect((scaleIn.animate as { scale: number }).scale).toBe(1);
  });
});

describe('scaleUp', () => {
  it('initial scale is less than 1', () => {
    const { scale } = scaleUp.initial as { scale: number };
    expect(scale).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// Drawer variants use percentage strings
// ---------------------------------------------------------------------------

describe('drawer variants use percentage offset strings', () => {
  it('drawerLeft initial x is "-100%"', () => {
    expect((drawerLeft.initial as { x: string }).x).toBe('-100%');
  });

  it('drawerRight initial x is "100%"', () => {
    expect((drawerRight.initial as { x: string }).x).toBe('100%');
  });

  it('drawerBottom initial y is "100%"', () => {
    expect((drawerBottom.initial as { y: string }).y).toBe('100%');
  });

  it('drawers animate to 0', () => {
    expect((drawerLeft.animate as { x: number }).x).toBe(0);
    expect((drawerRight.animate as { x: number }).x).toBe(0);
    expect((drawerBottom.animate as { y: number }).y).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// stagger variants
// ---------------------------------------------------------------------------

describe('staggerContainer', () => {
  it('has initial and animate states', () => {
    expect(staggerContainer).toHaveProperty('initial');
    expect(staggerContainer).toHaveProperty('animate');
  });

  it('animate transition uses staggerChildren', () => {
    const animate = staggerContainer.animate as { transition: { staggerChildren: number } };
    expect(animate.transition.staggerChildren).toBe(0.05);
  });
});

describe('staggerItem', () => {
  it('animates to full opacity at y=0', () => {
    const animate = staggerItem.animate as { opacity: number; y: number };
    expect(animate.opacity).toBe(1);
    expect(animate.y).toBe(0);
  });

  it('starts with reduced opacity', () => {
    const initial = staggerItem.initial as { opacity: number };
    expect(initial.opacity).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// toastVariants
// ---------------------------------------------------------------------------

describe('toastVariants', () => {
  it('initial state has opacity 0 and positive y offset', () => {
    const initial = toastVariants.initial as { opacity: number; y: number; scale: number };
    expect(initial.opacity).toBe(0);
    expect(initial.y).toBeGreaterThan(0);
    expect(initial.scale).toBeLessThan(1);
  });

  it('animate state brings element to full opacity', () => {
    const animate = toastVariants.animate as { opacity: number; y: number; scale: number };
    expect(animate.opacity).toBe(1);
    expect(animate.y).toBe(0);
    expect(animate.scale).toBe(1);
  });
});
