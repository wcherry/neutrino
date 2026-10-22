'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { EXIT_MS } from '../../motion/presence';
import { Toast, type ToastData, type ToastVariant } from './Toast';
import styles from './Toast.module.css';

export type ToastPosition =
  | 'top-right'
  | 'top-left'
  | 'top-center'
  | 'bottom-right'
  | 'bottom-left'
  | 'bottom-center';

interface ToastContextValue {
  toast: (data: Omit<ToastData, 'id'>) => string;
  success: (message: React.ReactNode, title?: string) => string;
  error: (message: React.ReactNode, title?: string) => string;
  warning: (message: React.ReactNode, title?: string) => string;
  info: (message: React.ReactNode, title?: string) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let idCounter = 0;
function generateId() {
  return `toast-${++idCounter}`;
}

export interface ToastProviderProps {
  children: React.ReactNode;
  position?: ToastPosition;
  maxToasts?: number;
}

export function ToastProvider({
  children,
  position = 'bottom-right',
  maxToasts = 5,
}: ToastProviderProps) {
  // A dismissed toast stays in the list, `leaving`, for its exit animation (styles/motion.css).
  const [toasts, setToasts] = useState<(ToastData & { leaving?: boolean })[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), EXIT_MS);
  }, []);

  const dismissAll = useCallback(() => {
    setToasts((prev) => prev.map((t) => ({ ...t, leaving: true })));
    setTimeout(() => setToasts((prev) => prev.filter((t) => !t.leaving)), EXIT_MS);
  }, []);

  const addToast = useCallback(
    (data: Omit<ToastData, 'id'>): string => {
      const id = generateId();
      setToasts((prev) => {
        // The cap counts toasts on screen to stay, not ones already on their way out.
        const staying = prev.filter((t) => !t.leaving);
        const leaving = prev.filter((t) => t.leaving);
        return [{ ...data, id }, ...staying].slice(0, maxToasts).concat(leaving);
      });
      return id;
    },
    [maxToasts]
  );

  const makeHelper = (variant: ToastVariant) =>
    (message: React.ReactNode, title?: string) =>
      addToast({ variant, message, title });

  const ctx: ToastContextValue = {
    toast: addToast,
    success: makeHelper('success'),
    error: makeHelper('error'),
    warning: makeHelper('warning'),
    info: makeHelper('info'),
    dismiss,
    dismissAll,
  };

  const portalClasses = [styles.portal, styles[position]].filter(Boolean).join(' ');

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      {mounted &&
        createPortal(
          <div className={portalClasses} aria-label="Notifications" role="region">
            {toasts.map((t) => (
              <Toast key={t.id} {...t} onClose={dismiss} />
            ))}
          </div>,
          document.body
        )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
