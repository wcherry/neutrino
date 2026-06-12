'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Minus,
  Maximize2,
  PanelLeft,
  PanelRight,
  PanelBottom,
  Move,
} from 'lucide-react';
import styles from './PanelContainer.module.css';

export type PanelLocation = 'left' | 'right' | 'bottom' | 'float';

export interface PanelTab {
  id: string;
  title: string;
  content: React.ReactNode;
  footer?: React.ReactNode;
}

export interface PanelContainerProps {
  /** Used when no tabs are provided */
  title?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** Multi-tab mode — takes precedence over title/children/footer */
  tabs?: PanelTab[];
  activeTabId?: string;
  defaultActiveTabId?: string;
  onTabChange?: (tabId: string) => void;
  /** Common */
  location?: PanelLocation;
  defaultLocation?: PanelLocation;
  onLocationChange?: (location: PanelLocation) => void;
  minimized?: boolean;
  defaultMinimized?: boolean;
  onMinimizedChange?: (minimized: boolean) => void;
  onClose?: () => void;
  headerActions?: React.ReactNode;
  width?: number | string;
  height?: number | string;
  className?: string;
}

const LOCATION_ICONS: Record<PanelLocation, React.ElementType> = {
  left: PanelLeft,
  right: PanelRight,
  bottom: PanelBottom,
  float: Move,
};

const LOCATION_LABELS: Record<PanelLocation, string> = {
  left: 'Left',
  right: 'Right',
  bottom: 'Bottom',
  float: 'Float',
};

const ALL_LOCATIONS: PanelLocation[] = ['left', 'right', 'bottom', 'float'];

function MinimizeIcon({ location, minimized }: { location: PanelLocation; minimized: boolean }) {
  const size = 14;
  if (minimized) {
    if (location === 'left') return <ChevronRight size={size} />;
    if (location === 'right') return <ChevronLeft size={size} />;
    if (location === 'bottom') return <ChevronUp size={size} />;
    return <Maximize2 size={size} />;
  }
  if (location === 'left') return <ChevronLeft size={size} />;
  if (location === 'right') return <ChevronRight size={size} />;
  if (location === 'bottom') return <ChevronDown size={size} />;
  return <Minus size={size} />;
}

function useClickOutside(
  refs: React.RefObject<HTMLElement | null>[],
  onClickOutside: () => void,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: MouseEvent) => {
      if (refs.every((r) => !r.current?.contains(e.target as Node))) {
        onClickOutside();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [refs, onClickOutside, enabled]);
}

export function PanelContainer({
  title,
  children,
  footer,
  tabs,
  activeTabId: activeTabIdProp,
  defaultActiveTabId,
  onTabChange,
  location: locationProp,
  defaultLocation = 'right',
  onLocationChange,
  minimized: minimizedProp,
  defaultMinimized = false,
  onMinimizedChange,
  onClose,
  headerActions,
  width,
  height,
  className = '',
}: PanelContainerProps) {
  const hasTabs = tabs != null && tabs.length > 0;

  const [locationState, setLocationState] = useState<PanelLocation>(defaultLocation);
  const [minimizedState, setMinimizedState] = useState(defaultMinimized);
  const [locationMenuOpen, setLocationMenuOpen] = useState(false);
  const [activeTabIdState, setActiveTabIdState] = useState<string>(
    defaultActiveTabId ?? (hasTabs ? tabs![0].id : ''),
  );
  const [tabMenuOpen, setTabMenuOpen] = useState(false);

  const locationBtnRef = useRef<HTMLButtonElement>(null);
  const locationMenuRef = useRef<HTMLDivElement>(null);
  const tabSelectorRef = useRef<HTMLButtonElement>(null);
  const tabMenuRef = useRef<HTMLDivElement>(null);

  const location = locationProp ?? locationState;
  const minimized = minimizedProp ?? minimizedState;
  const activeTabId = activeTabIdProp ?? activeTabIdState;
  const activeTab = hasTabs ? (tabs!.find((t) => t.id === activeTabId) ?? tabs![0]) : null;

  useClickOutside(
    [locationBtnRef, locationMenuRef],
    () => setLocationMenuOpen(false),
    locationMenuOpen,
  );
  useClickOutside(
    [tabSelectorRef, tabMenuRef],
    () => setTabMenuOpen(false),
    tabMenuOpen,
  );

  const handleLocationChange = (newLocation: PanelLocation) => {
    setLocationMenuOpen(false);
    if (locationProp === undefined) setLocationState(newLocation);
    onLocationChange?.(newLocation);
  };

  const handleTabChange = (tabId: string) => {
    setTabMenuOpen(false);
    if (activeTabIdProp === undefined) setActiveTabIdState(tabId);
    onTabChange?.(tabId);
  };

  const expand = () => {
    if (minimizedProp === undefined) setMinimizedState(false);
    onMinimizedChange?.(false);
  };

  const handleMinimize = () => {
    const next = !minimized;
    if (minimizedProp === undefined) setMinimizedState(next);
    onMinimizedChange?.(next);
  };

  const handleRestoreTab = (tabId: string) => {
    handleTabChange(tabId);
    expand();
  };

  const LocationIcon = LOCATION_ICONS[location];

  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height && location !== 'bottom') style.height = typeof height === 'number' ? `${height}px` : height;

  // ── Minimized state ────────────────────────────────────────────────────────
  if (minimized) {
    return (
      <div
        className={[styles.container, styles[location], styles.minimized, className]
          .filter(Boolean)
          .join(' ')}
        role="complementary"
        aria-label={hasTabs ? 'Panel group' : (title ?? 'Panel')}
      >
        {hasTabs ? (
          tabs!.map((tab, i) => (
            <React.Fragment key={tab.id}>
              {i > 0 && <div className={styles.tabStripDivider} aria-hidden="true" />}
              <button
                type="button"
                className={[
                  styles.tabStripBtn,
                  tab.id === activeTabId ? styles.tabStripBtnActive : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => handleRestoreTab(tab.id)}
                aria-label={`Expand ${tab.title}`}
              >
                <span className={styles.tabStripTitle}>{tab.title}</span>
              </button>
            </React.Fragment>
          ))
        ) : (
          <button
            type="button"
            className={styles.restoreBtn}
            onClick={handleMinimize}
            aria-label="Expand panel"
          >
            <MinimizeIcon location={location} minimized={true} />
            {title && <span className={styles.restoreTitle}>{title}</span>}
          </button>
        )}
      </div>
    );
  }

  // ── Expanded state ─────────────────────────────────────────────────────────
  const bodyContent = hasTabs ? activeTab!.content : children;
  const footerContent = hasTabs ? (activeTab!.footer ?? null) : footer ?? null;
  const displayTitle = hasTabs ? activeTab!.title : title;

  return (
    <div
      className={[styles.container, styles[location], className].filter(Boolean).join(' ')}
      style={style}
      role="complementary"
      aria-label={displayTitle ?? 'Panel'}
    >
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={handleMinimize}
            aria-label="Minimize panel"
          >
            <MinimizeIcon location={location} minimized={false} />
          </button>

          <div className={styles.locationWrapper}>
            <button
              ref={locationBtnRef}
              type="button"
              className={styles.locationBtn}
              onClick={() => setLocationMenuOpen((o) => !o)}
              aria-label={`Panel location: ${LOCATION_LABELS[location]}`}
              aria-expanded={locationMenuOpen}
              aria-haspopup="menu"
            >
              <LocationIcon size={14} />
              <ChevronDown size={10} className={styles.locationChevron} />
            </button>
            {locationMenuOpen && (
              <div ref={locationMenuRef} className={styles.locationMenu} role="menu">
                {ALL_LOCATIONS.map((loc) => {
                  const Icon = LOCATION_ICONS[loc];
                  return (
                    <button
                      key={loc}
                      type="button"
                      role="menuitem"
                      className={[
                        styles.locationMenuItem,
                        loc === location ? styles.locationMenuItemActive : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => handleLocationChange(loc)}
                    >
                      <Icon size={14} />
                      <span>{LOCATION_LABELS[loc]}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {hasTabs ? (
            <div className={styles.tabSelectorWrapper}>
              <button
                ref={tabSelectorRef}
                type="button"
                className={styles.tabSelector}
                onClick={() => setTabMenuOpen((o) => !o)}
                aria-label={`Active panel: ${activeTab!.title}`}
                aria-expanded={tabMenuOpen}
                aria-haspopup="menu"
              >
                <span className={styles.tabSelectorTitle}>{activeTab!.title}</span>
                <ChevronDown size={10} className={styles.locationChevron} />
              </button>
              {tabMenuOpen && (
                <div ref={tabMenuRef} className={styles.tabMenu} role="menu">
                  {tabs!.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="menuitem"
                      className={[
                        styles.tabMenuItem,
                        tab.id === activeTabId ? styles.tabMenuItemActive : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => handleTabChange(tab.id)}
                    >
                      {tab.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            displayTitle && <span className={styles.title}>{displayTitle}</span>
          )}
        </div>

        <div className={styles.headerRight}>
          {headerActions && <div className={styles.headerActions}>{headerActions}</div>}
          {onClose && (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onClose}
              aria-label="Close panel"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className={styles.body}>{bodyContent}</div>

      {footerContent != null && <div className={styles.footer}>{footerContent}</div>}
    </div>
  );
}
