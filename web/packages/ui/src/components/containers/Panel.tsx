'use client';

import React from 'react';
import styles from './Panel.module.css';

/**
 * The one frame every app panel is drawn in: a header (icon, title, the panel's own actions, a
 * menu slot and one control at the end) over a scrolling body, with an optional footer.
 *
 * `PanelRail` draws its docked and floating panels through this, so a panel looks the same in a
 * rail, floating, or on its own. The control is the only way out of a panel and there is one of
 * it: in a rail it collapses, floating or standalone it closes. A panel's content renders only its
 * body — no frame, header or close button of its own.
 */

export interface PanelControl {
  /** Accessible name, e.g. "Collapse Outline". */
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  /** Tooltip; defaults to the label. */
  title?: string;
}

export interface PanelProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title: React.ReactNode;
  icon?: React.ReactNode;
  /** The panel's own buttons, shown in the header before the menu and the control. */
  actions?: React.ReactNode;
  /** A menu button before the control — `PanelRail` puts its Move menu here. */
  menu?: React.ReactNode;
  /** The single control at the end of the header: collapse in a rail, close otherwise. */
  control?: PanelControl;
  footer?: React.ReactNode;
  /** Id for the title element, so the panel can be labelled by it. */
  titleId?: string;
  /** Props for the header element — a floating panel uses its header as the drag handle. */
  headerProps?: React.HTMLAttributes<HTMLElement>;
  as?: 'section' | 'div' | 'aside';
  children?: React.ReactNode;
}

export function Panel({
  title,
  icon,
  actions,
  menu,
  control,
  footer,
  titleId,
  headerProps,
  as: Element = 'section',
  className,
  children,
  ...rest
}: PanelProps) {
  const { className: headerClassName, ...headerRest } = headerProps ?? {};
  return (
    <Element {...rest} className={[styles.panel, className].filter(Boolean).join(' ')}>
      <header {...headerRest} className={[styles.header, headerClassName].filter(Boolean).join(' ')}>
        {icon && <span className={styles.icon} aria-hidden="true">{icon}</span>}
        <span className={styles.title} id={titleId}>{title}</span>
        {actions && <span className={styles.actions}>{actions}</span>}
        {menu}
        {control && (
          <button
            type="button"
            className={styles.iconButton}
            aria-label={control.label}
            title={control.title ?? control.label}
            onClick={control.onClick}
          >
            {control.icon}
          </button>
        )}
      </header>
      <div className={styles.body}>{children}</div>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </Element>
  );
}
