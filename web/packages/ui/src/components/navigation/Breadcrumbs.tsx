import React from 'react';
import { ChevronRight } from 'lucide-react';
import styles from './Breadcrumbs.module.css';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  separator?: React.ReactNode;
  className?: string;
}

export function Breadcrumbs({
  items,
  separator = <ChevronRight size={14} />,
  className = '',
}: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className={[styles.breadcrumbs, className].filter(Boolean).join(' ')}>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li key={index} className={styles.item}>
              {isLast ? (
                <span className={styles.current} aria-current="page">
                  {item.label}
                </span>
              ) : item.href ? (
                <a href={item.href} className={styles.link}>
                  {item.label}
                </a>
              ) : (
                <button
                  type="button"
                  className={styles.link}
                  onClick={item.onClick}
                >
                  {item.label}
                </button>
              )}
              {!isLast && (
                <span className={styles.separator} aria-hidden="true">
                  {separator}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
