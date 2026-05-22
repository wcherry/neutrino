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
