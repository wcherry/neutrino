'use client';

import React, { createContext, useContext, useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import styles from './Accordion.module.css';

interface AccordionContextValue {
  openItems: Set<string>;
  toggle: (id: string) => void;
  multiple: boolean;
  baseId: string;
}

const AccordionContext = createContext<AccordionContextValue | null>(null);

function useAccordionContext() {
  const ctx = useContext(AccordionContext);
  if (!ctx) throw new Error('Accordion components must be used within <Accordion>');
  return ctx;
}

export interface AccordionProps {
  multiple?: boolean;
  defaultOpen?: string | string[];
  className?: string;
  children: React.ReactNode;
}

export function Accordion({
  multiple = false,
  defaultOpen,
  className = '',
  children,
}: AccordionProps) {
  const baseId = useId();
  const [openItems, setOpenItems] = useState<Set<string>>(() => {
    if (!defaultOpen) return new Set();
    if (Array.isArray(defaultOpen)) return new Set(defaultOpen);
    return new Set([defaultOpen]);
  });

  const toggle = (id: string) => {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (!multiple) next.clear();
        next.add(id);
      }
      return next;
    });
  };

  return (
    <AccordionContext.Provider value={{ openItems, toggle, multiple, baseId }}>
      <div className={[styles.accordion, className].filter(Boolean).join(' ')}>
        {children}
      </div>
    </AccordionContext.Provider>
  );
}

export interface AccordionItemProps {
  id: string;
  title: string;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function AccordionItem({ id, title, icon, className = '', children }: AccordionItemProps) {
  const { openItems, toggle, baseId } = useAccordionContext();
  const isOpen = openItems.has(id);
  const triggerId = `${baseId}-trigger-${id}`;
  const panelId = `${baseId}-panel-${id}`;

  return (
    <div className={[styles.item, className].filter(Boolean).join(' ')}>
      <button
        type="button"
        id={triggerId}
        className={styles.trigger}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => toggle(id)}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {icon}
          {title}
        </span>
        <ChevronDown size={16} className={styles.chevron} aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={panelId}
            role="region"
            aria-labelledby={triggerId}
            className={styles.content}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className={styles.inner}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
