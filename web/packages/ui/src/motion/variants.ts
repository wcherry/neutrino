import type { Variants, Transition } from 'framer-motion';

const defaultTransition: Transition = {
  duration: 0.15,
  ease: [0.4, 0, 0.2, 1],
};

const slowTransition: Transition = {
  duration: 0.2,
  ease: [0.4, 0, 0.2, 1],
};

export const fadeIn: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: defaultTransition },
  exit: { opacity: 0, transition: defaultTransition },
};

export const slideUp: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: slowTransition },
  exit: { opacity: 0, y: 8, transition: slowTransition },
};

export const slideDown: Variants = {
  initial: { opacity: 0, y: -8 },
  animate: { opacity: 1, y: 0, transition: slowTransition },
  exit: { opacity: 0, y: -8, transition: slowTransition },
};

export const slideLeft: Variants = {
  initial: { opacity: 0, x: 16 },
  animate: { opacity: 1, x: 0, transition: slowTransition },
  exit: { opacity: 0, x: 16, transition: slowTransition },
};

export const slideRight: Variants = {
  initial: { opacity: 0, x: -16 },
  animate: { opacity: 1, x: 0, transition: slowTransition },
  exit: { opacity: 0, x: -16, transition: slowTransition },
};

export const scaleIn: Variants = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1, transition: defaultTransition },
  exit: { opacity: 0, scale: 0.95, transition: defaultTransition },
};

export const scaleUp: Variants = {
  initial: { opacity: 0, scale: 0.9 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.2, ease: [0.34, 1.56, 0.64, 1] },
  },
  exit: { opacity: 0, scale: 0.9, transition: defaultTransition },
};

export const drawerLeft: Variants = {
  initial: { x: '-100%' },
  animate: { x: 0, transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] } },
  exit: { x: '-100%', transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } },
};

export const drawerRight: Variants = {
  initial: { x: '100%' },
  animate: { x: 0, transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] } },
  exit: { x: '100%', transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } },
};

export const drawerBottom: Variants = {
  initial: { y: '100%' },
  animate: { y: 0, transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] } },
  exit: { y: '100%', transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } },
};

export const staggerContainer: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.05,
    },
  },
};

export const staggerItem: Variants = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: defaultTransition },
};

export const toastVariants: Variants = {
  initial: { opacity: 0, y: 24, scale: 0.95 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.2, ease: [0.34, 1.56, 0.64, 1] },
  },
  exit: {
    opacity: 0,
    y: -8,
    scale: 0.95,
    transition: { duration: 0.15, ease: [0.4, 0, 1, 1] },
  },
};
