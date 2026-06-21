'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  ModalHeader,
  ModalBody,
  Button,
  Text,
  Badge,
  Avatar,
  Spinner,
  Divider,
  useToast,
} from '../../index';
import { Link, Copy, Trash2, Check, UserPlus, Globe, Lock, Calendar } from 'lucide-react';
import styles from './ShareDialog.module.css';

// ── Public types ─────────────────────────────────────────────────────────────

export type SharePermissionRole = 'owner' | 'editor' | 'commenter' | 'viewer';

export interface SharePermission {
  id: string;
  userId: string;
  role: SharePermissionRole;
  userName?: string | null;
  userEmail?: string | null;
}

export interface ShareLinkData {
  token: string;
  isActive: boolean;
  role: string;
  visibility: 'public' | 'anyoneWithLink';
  expiresAt: string | null;
}

export interface ShareUserSuggestion {
  id: string;
  email: string;
  name?: string | null;
}

export interface ShareDialogProps {
  resourceName: string;
  permissions?: SharePermission[];
  permissionsLoading?: boolean;
  shareLink?: ShareLinkData | null;
  shareLinkLoading?: boolean;
  permissionsPending?: boolean;
  linkPending?: boolean;
  createLinkPending?: boolean;
  onClose: () => void;
  onAddPerson: (email: string, role: SharePermissionRole) => Promise<void>;
  onSearchUsers?: (query: string) => Promise<ShareUserSuggestion[]>;
  onRoleChange: (userId: string, role: SharePermissionRole) => void;
  onRevoke: (userId: string) => void;
  onCreateLink: () => void;
  onToggleLink: (isActive: boolean) => void;
  onLinkRoleChange: (role: string) => void;
  onLinkVisibilityChange: (visibility: 'public' | 'anyoneWithLink') => void;
  onLinkExpiryChange: (expiresAt: string | null) => void;
  onDeleteLink: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  editor: 'Editor',
  commenter: 'Commenter',
  viewer: 'Viewer',
};

const LINK_ROLE_OPTIONS = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'commenter', label: 'Commenter' },
  { value: 'editor', label: 'Editor' },
];

const LINK_VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Public' },
  { value: 'anyoneWithLink', label: 'Anyone with link' },
];

const PERM_ROLE_OPTIONS: { value: SharePermissionRole; label: string }[] = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'commenter', label: 'Commenter' },
  { value: 'editor', label: 'Editor' },
];

const HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// ── Date/picker helpers ───────────────────────────────────────────────────────

function normalizeDateTimeInput(value: string): string | null {
  if (!value) return null;
  if (value.length === 16) return `${value}:00`;
  return value;
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const date = new Date(year, month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

function buildCalendarDays(
  year: number,
  month: number
): Array<{ day: number; date: string } | null> {
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalSlots = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const days: Array<{ day: number; date: string } | null> = [];
  for (let i = 0; i < totalSlots; i += 1) {
    const dayNum = i - startOffset + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      days.push(null);
    } else {
      const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(
        2,
        '0'
      )}`;
      days.push({ day: dayNum, date });
    }
  }
  return days;
}

function getCalendarMonthFromValue(value: string): { year: number; month: number } {
  const parts = parsePickerParts(value || defaultExpiryISO());
  const [year, month] = parts.date.split('-').map((segment) => parseInt(segment, 10));
  return {
    year: Number.isFinite(year) ? year : new Date().getFullYear(),
    month: Number.isFinite(month) ? month - 1 : new Date().getMonth(),
  };
}

function parsePickerParts(value: string): {
  date: string;
  hour: string;
  minute: string;
  meridiem: 'am' | 'pm';
} {
  const normalized = value.replace(' ', 'T');
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!match) {
    const fallback = defaultExpiryISO();
    return parsePickerParts(fallback);
  }
  const [, date, hh, mm] = match;
  let hour24 = parseInt(hh, 10);
  const meridiem: 'am' | 'pm' = hour24 >= 12 ? 'pm' : 'am';
  hour24 %= 12;
  const hour12 = hour24 === 0 ? 12 : hour24;
  return {
    date,
    hour: String(hour12).padStart(2, '0'),
    minute: String(parseInt(mm, 10)).padStart(2, '0'),
    meridiem,
  };
}

function buildPickerValue(
  date: string,
  hour: string,
  minute: string,
  meridiem: 'am' | 'pm'
): string {
  if (!date) return '';
  const hourNum = parseInt(hour, 10);
  let hour24 = hourNum % 12;
  if (meridiem === 'pm') hour24 += 12;
  const hh = String(hour24).padStart(2, '0');
  const mm = String(parseInt(minute, 10)).padStart(2, '0');
  return `${date}T${hh}:${mm}`;
}

function toPickerValue(value: string | null): string {
  if (!value) return '';
  const normalized = value.replace(' ', 'T');
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!match) return '';
  return `${match[1]}T${match[2]}`;
}

function formatDisplayFromISO(value: string | null): string {
  if (!value) return '';
  const normalized = value.replace(' ', 'T');
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return '';
  const [, yyyy, mm, dd, hh, min] = match;
  let hour24 = parseInt(hh, 10);
  const meridiem = hour24 >= 12 ? 'pm' : 'am';
  hour24 %= 12;
  const hour12 = hour24 === 0 ? 12 : hour24;
  return `${mm}/${dd}/${yyyy}, ${String(hour12).padStart(2, '0')}:${min} ${meridiem}`;
}

function parseDisplayToISO(value: string): string | null {
  const match = value
    .trim()
    .match(/^(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{2}):(\d{2})\s*(am|pm)$/i);
  if (!match) return null;
  const [, mm, dd, yyyy, hh, min, meridiem] = match;
  const month = parseInt(mm, 10);
  const day = parseInt(dd, 10);
  const hour12 = parseInt(hh, 10);
  const minute = parseInt(min, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour12 < 1 || hour12 > 12 || minute < 0 || minute > 59) return null;
  let hour24 = hour12 % 12;
  if (meridiem.toLowerCase() === 'pm') hour24 += 12;
  const hh24 = String(hour24).padStart(2, '0');
  const mmPad = String(month).padStart(2, '0');
  const ddPad = String(day).padStart(2, '0');
  const minPad = String(minute).padStart(2, '0');
  return `${yyyy}-${mmPad}-${ddPad}T${hh24}:${minPad}:00`;
}

function formatExpiryDisplayInput(raw: string): string {
  const lower = raw.toLowerCase();
  const digits = lower.replace(/\D/g, '');
  const mm = digits.slice(0, 2);
  const dd = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);
  const hh = digits.slice(8, 10);
  const min = digits.slice(10, 12);
  const merMatch = lower.match(/([ap])m?$/);
  const meridiem = merMatch ? (merMatch[1] === 'a' ? 'am' : 'pm') : '';
  let result = '';
  if (mm) result += mm;
  if (dd) result += `/${dd}`;
  if (yyyy) result += `/${yyyy}`;
  if (hh) result += `, ${hh}`;
  if (min) result += `:${min}`;
  if (meridiem) result += ` ${meridiem}`;
  return result;
}

function defaultExpiryISO(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  date.setHours(12, 0, 0, 0);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T12:00:00`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CollaboratorRow({
  perm,
  onRoleChange,
  onRevoke,
  isPending,
}: {
  perm: SharePermission;
  onRoleChange: (role: SharePermissionRole) => void;
  onRevoke: () => void;
  isPending: boolean;
}) {
  const isOwner = perm.role === 'owner';
  const displayName = perm.userName || perm.userEmail || perm.userId;
  const displayEmail = perm.userEmail || perm.userId;

  return (
    <div className={styles.collaborator}>
      <Avatar name={displayName} size="sm" />
      <div className={styles.collaboratorInfo}>
        <Text size="sm" weight="medium">{displayName}</Text>
        <Text size="xs" color="muted">{displayEmail}</Text>
      </div>
      {isOwner ? (
        <Badge variant="default" size="sm">Owner</Badge>
      ) : (
        <>
          <select
            className={styles.roleSelectSm}
            value={perm.role}
            onChange={(e) => onRoleChange(e.target.value as SharePermissionRole)}
            disabled={isPending}
            aria-label={`Role for ${displayName}`}
          >
            {PERM_ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            type="button"
            className={styles.revokeBtn}
            onClick={onRevoke}
            disabled={isPending}
            aria-label={`Remove access for ${displayName}`}
            title="Remove access"
          >
            <Trash2 size={13} />
          </button>
        </>
      )}
    </div>
  );
}

function ShareLinkSection({
  link,
  onCopy,
  copied,
  onToggle,
  onRoleChange,
  onVisibilityChange,
  onExpiryChange,
  onDelete,
  isPending,
}: {
  link: ShareLinkData;
  onCopy: () => void;
  copied: boolean;
  onToggle: (active: boolean) => void;
  onRoleChange: (role: string) => void;
  onVisibilityChange: (visibility: 'public' | 'anyoneWithLink') => void;
  onExpiryChange: (expiresAt: string | null) => void;
  onDelete: () => void;
  isPending: boolean;
}) {
  const currentExpiryDisplay = formatDisplayFromISO(link.expiresAt);
  const currentPickerValue = toPickerValue(link.expiresAt);
  const [draftExpiry, setDraftExpiry] = React.useState(currentExpiryDisplay);
  const [pickerValue, setPickerValue] = React.useState(currentPickerValue);
  const isDirty = draftExpiry !== currentExpiryDisplay;
  const [isPickerOpen, setIsPickerOpen] = React.useState(false);
  const [pickerPos, setPickerPos] = React.useState<{ top: number; left: number } | null>(null);
  const [calendarMonth, setCalendarMonth] = React.useState(() =>
    getCalendarMonthFromValue(currentPickerValue || defaultExpiryISO())
  );
  const expiryControlRef = React.useRef<HTMLDivElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setDraftExpiry(currentExpiryDisplay);
    setPickerValue(currentPickerValue);
    setCalendarMonth(getCalendarMonthFromValue(currentPickerValue || defaultExpiryISO()));
  }, [currentExpiryDisplay, currentPickerValue]);

  React.useLayoutEffect(() => {
    if (!isPickerOpen || !popoverRef.current || !pickerPos) return;
    const popover = popoverRef.current.getBoundingClientRect();
    const margin = 12;
    const maxLeft = Math.max(margin, window.innerWidth - popover.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - popover.height - margin);
    const nextLeft = Math.min(Math.max(pickerPos.left, margin), maxLeft);
    const nextTop = Math.min(Math.max(pickerPos.top, margin), maxTop);
    if (nextLeft !== pickerPos.left || nextTop !== pickerPos.top) {
      setPickerPos({ top: nextTop, left: nextLeft });
    }
  }, [isPickerOpen, pickerPos]);

  return (
    <div className={styles.linkSection}>
      <div className={styles.linkStatusRow}>
        <span className={styles.linkIcon}>
          {link.isActive ? <Globe size={15} /> : <Lock size={15} />}
        </span>
        <div className={styles.linkStatus}>
          <Text size="sm" weight="medium">
            {link.isActive ? 'Link sharing is on' : 'Link sharing is off'}
          </Text>
          <Text size="xs" color="muted">
            {link.isActive
              ? link.visibility === 'public'
                ? 'Anyone on the internet can find and access'
                : 'Anyone with the link can access'
              : 'Only people with permission can access'}
          </Text>
        </div>
        <Button
          variant={link.isActive ? 'ghost' : 'secondary'}
          size="sm"
          onClick={() => onToggle(!link.isActive)}
          disabled={isPending}
        >
          {link.isActive ? 'Turn off' : 'Turn on'}
        </Button>
      </div>

      {link.isActive && (
        <>
          <div className={styles.linkRoleRow}>
            <Text size="xs" color="muted">
              {link.visibility === 'public' ? 'Anyone can:' : 'Anyone with link can:'}
            </Text>
            <select
              className={styles.roleSelectSm}
              value={link.role}
              onChange={(e) => onRoleChange(e.target.value)}
              disabled={isPending}
              aria-label="Link sharing role"
            >
              {LINK_ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className={styles.linkRoleRow}>
            <Text size="xs" color="muted">Visibility:</Text>
            <select
              className={styles.roleSelectSm}
              value={link.visibility}
              onChange={(e) => onVisibilityChange(e.target.value as 'public' | 'anyoneWithLink')}
              disabled={isPending}
              aria-label="Link visibility"
            >
              {LINK_VISIBILITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className={styles.linkRoleRow}>
            <Text size="xs" color="muted">Expires:</Text>
            <div className={styles.expiryControl} ref={expiryControlRef}>
              <input
                type="text"
                className={styles.expiryDisplay}
                value={draftExpiry || ''}
                placeholder="mm/dd/yyyy, hh:mm am"
                onChange={(e) => {
                  const formatted = formatExpiryDisplayInput(e.target.value);
                  setDraftExpiry(formatted);
                  const iso = parseDisplayToISO(formatted);
                  if (iso) {
                    setPickerValue(toPickerValue(iso));
                  }
                }}
                onBlur={() => {
                  if (isPending || !isDirty) return;
                  const iso = parseDisplayToISO(draftExpiry);
                  if (!iso) return;
                  onExpiryChange(iso);
                  setDraftExpiry(formatDisplayFromISO(iso));
                  setPickerValue(toPickerValue(iso));
                }}
                disabled={isPending}
                aria-label="Link expiration"
              />
              <button
                type="button"
                className={styles.expiryIconBtn}
                onClick={() => {
                  const rect = expiryControlRef.current?.getBoundingClientRect();
                  if (rect) {
                    setPickerPos({
                      top: rect.bottom + 8,
                      left: Math.min(rect.left, window.innerWidth - 280),
                    });
                  }
                  const iso = parseDisplayToISO(draftExpiry) ?? defaultExpiryISO();
                  const nextPickerValue = pickerValue || toPickerValue(iso);
                  if (!pickerValue) {
                    setPickerValue(nextPickerValue);
                  }
                  setCalendarMonth(getCalendarMonthFromValue(nextPickerValue || iso));
                  setIsPickerOpen(true);
                }}
                disabled={isPending}
                aria-label="Open expiration picker"
              >
                <Calendar size={14} />
              </button>
              {isPickerOpen && (
                <div
                  className={styles.expiryPopover}
                  role="dialog"
                  aria-label="Expiration picker"
                  ref={popoverRef}
                  style={{
                    top: pickerPos?.top ?? 120,
                    left: pickerPos?.left ?? 24,
                  }}
                >
                  <div className={styles.expiryField}>
                    <Text size="xs" color="muted">Date</Text>
                    <CalendarPicker
                      month={calendarMonth}
                      selectedDate={parsePickerParts(pickerValue).date}
                      isDisabled={isPending}
                      onMonthChange={(next) => setCalendarMonth(next)}
                      onSelectDate={(date) => {
                        const parts = parsePickerParts(pickerValue);
                        const nextValue = buildPickerValue(
                          date,
                          parts.hour,
                          parts.minute,
                          parts.meridiem
                        );
                        setPickerValue(nextValue);
                        setDraftExpiry(formatDisplayFromISO(nextValue));
                        setCalendarMonth(getCalendarMonthFromValue(nextValue));
                      }}
                    />
                  </div>
                  <div className={styles.expiryField}>
                    <Text size="xs" color="muted">Time</Text>
                    <div className={styles.expiryTimeRow}>
                      <select
                        className={styles.roleSelectSm}
                        value={parsePickerParts(pickerValue).hour}
                        onChange={(e) => {
                          const parts = parsePickerParts(pickerValue);
                          const next = buildPickerValue(
                            parts.date,
                            e.target.value,
                            parts.minute,
                            parts.meridiem
                          );
                          setPickerValue(next);
                          setDraftExpiry(formatDisplayFromISO(next));
                        }}
                        aria-label="Expiration hour"
                        disabled={isPending}
                      >
                        {HOUR_OPTIONS.map((h) => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                      <select
                        className={styles.roleSelectSm}
                        value={parsePickerParts(pickerValue).minute}
                        onChange={(e) => {
                          const parts = parsePickerParts(pickerValue);
                          const next = buildPickerValue(
                            parts.date,
                            parts.hour,
                            e.target.value,
                            parts.meridiem
                          );
                          setPickerValue(next);
                          setDraftExpiry(formatDisplayFromISO(next));
                        }}
                        aria-label="Expiration minute"
                        disabled={isPending}
                      >
                        {MINUTE_OPTIONS.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      <select
                        className={styles.roleSelectSm}
                        value={parsePickerParts(pickerValue).meridiem}
                        onChange={(e) => {
                          const parts = parsePickerParts(pickerValue);
                          const next = buildPickerValue(
                            parts.date,
                            parts.hour,
                            parts.minute,
                            e.target.value as 'am' | 'pm'
                          );
                          setPickerValue(next);
                          setDraftExpiry(formatDisplayFromISO(next));
                        }}
                        aria-label="Expiration meridiem"
                        disabled={isPending}
                      >
                        <option value="am">am</option>
                        <option value="pm">pm</option>
                      </select>
                    </div>
                  </div>
                  <div className={styles.expiryActions}>
                    <Button
                      size="sm"
                      onClick={() => {
                        const iso = pickerValue
                          ? normalizeDateTimeInput(pickerValue)
                          : parseDisplayToISO(draftExpiry);
                        onExpiryChange(iso);
                        setDraftExpiry(formatDisplayFromISO(iso));
                        setPickerValue(toPickerValue(iso));
                        setIsPickerOpen(false);
                      }}
                      disabled={!isDirty || isPending}
                    >
                      Okay
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDraftExpiry(currentExpiryDisplay);
                        setPickerValue(currentPickerValue);
                        setIsPickerOpen(false);
                      }}
                      disabled={isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className={styles.linkActions}>
            <Button
              variant="secondary"
              size="sm"
              icon={copied ? <Check size={14} /> : <Copy size={14} />}
              onClick={onCopy}
            >
              {copied ? 'Copied!' : 'Copy link'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={14} />}
              onClick={onDelete}
              disabled={isPending}
            >
              Remove link
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function CalendarPicker({
  month,
  selectedDate,
  onMonthChange,
  onSelectDate,
  isDisabled,
}: {
  month: { year: number; month: number };
  selectedDate: string;
  onMonthChange: (next: { year: number; month: number }) => void;
  onSelectDate: (date: string) => void;
  isDisabled: boolean;
}) {
  const { year, month: monthIndex } = month;
  const monthLabel = `${MONTH_LABELS[monthIndex]} ${year}`;
  const days = buildCalendarDays(year, monthIndex);

  return (
    <div className={styles.calendar}>
      <div className={styles.calendarHeader}>
        <button
          type="button"
          className={styles.calendarNavBtn}
          onClick={() => onMonthChange(shiftMonth(year, monthIndex, -1))}
          aria-label="Previous month"
          disabled={isDisabled}
        >
          ‹
        </button>
        <div className={styles.calendarMonthLabel}>
          <Text size="sm" weight="semibold">
            {monthLabel}
          </Text>
        </div>
        <button
          type="button"
          className={styles.calendarNavBtn}
          onClick={() => onMonthChange(shiftMonth(year, monthIndex, 1))}
          aria-label="Next month"
          disabled={isDisabled}
        >
          ›
        </button>
      </div>
      <div className={styles.calendarWeekdays}>
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className={styles.calendarGrid}>
        {days.map((day, index) => {
          if (!day) {
            return <div key={`empty-${index}`} className={styles.calendarDayPlaceholder} />;
          }
          const isSelected = day.date === selectedDate;
          return (
            <button
              key={day.date}
              type="button"
              className={`${styles.calendarDay} ${
                isSelected ? styles.calendarDaySelected : ''
              }`}
              onClick={() => onSelectDate(day.date)}
              aria-label={`Select ${day.date}`}
              disabled={isDisabled}
            >
              {day.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ShareDialog({
  resourceName,
  permissions = [],
  permissionsLoading = false,
  shareLink,
  shareLinkLoading = false,
  permissionsPending = false,
  linkPending = false,
  createLinkPending = false,
  onClose,
  onAddPerson,
  onSearchUsers,
  onRoleChange,
  onRevoke,
  onCreateLink,
  onToggleLink,
  onLinkRoleChange,
  onLinkVisibilityChange,
  onLinkExpiryChange,
  onDeleteLink,
}: ShareDialogProps) {
  const toast = useToast();

  const [emailInput, setEmailInput] = useState('');
  const [selectedRole, setSelectedRole] = useState<SharePermissionRole>('viewer');
  const [isAdding, setIsAdding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const [suggestions, setSuggestions] = useState<ShareUserSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setOpen(true);
  }, []);

  const runSearch = useCallback(async (query: string) => {
    if (!onSearchUsers || !query.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    setSuggestionsLoading(true);
    try {
      const results = await onSearchUsers(query);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
      setActiveIndex(-1);
    } catch {
      setSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  }, [onSearchUsers]);

  function handleEmailChange(value: string) {
    setEmailInput(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!value.trim() || !onSearchUsers) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    searchTimerRef.current = setTimeout(() => runSearch(value), 250);
  }

  function selectSuggestion(s: ShareUserSuggestion) {
    setEmailInput(s.email);
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      if (showSuggestions && activeIndex >= 0 && suggestions[activeIndex]) {
        e.preventDefault();
        selectSuggestion(suggestions[activeIndex]);
      } else {
        handleAddPerson();
      }
      return;
    }
    if (!showSuggestions) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setActiveIndex(-1);
    }
  }

  async function handleAddPerson() {
    if (!emailInput.trim() || isAdding) return;
    setIsAdding(true);
    setSuggestions([]);
    setShowSuggestions(false);
    try {
      await onAddPerson(emailInput.trim(), selectedRole);
      setEmailInput('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add person');
    } finally {
      setIsAdding(false);
    }
  }

  function getLinkUrl(link: ShareLinkData): string {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/share?token=${link.token}`;
  }

  function handleCopyLink(link: ShareLinkData) {
    const url = getLinkUrl(link);
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => toast.error('Failed to copy link')
    );
  }

  const nonOwners = permissions.filter((p) => p.role !== 'owner');
  const owners = permissions.filter((p) => p.role === 'owner');

  return (
    <Modal open={open} onClose={onClose} size="md">
      <ModalHeader title={`Share "${resourceName}"`} onClose={onClose} />
      <ModalBody>
        {/* Add people */}
        <div className={styles.section}>
          <Text size="sm" weight="semibold">Add people</Text>
          <div className={styles.addRow}>
            <div className={styles.emailInputWrap}>
              <input
                ref={inputRef}
                className={styles.emailInput}
                type="text"
                placeholder="Enter email address"
                value={emailInput}
                onChange={(e) => handleEmailChange(e.target.value)}
                onKeyDown={handleInputKeyDown}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
                aria-label="Email address to share with"
                aria-autocomplete="list"
                aria-expanded={showSuggestions}
                autoComplete="off"
              />
              {showSuggestions && (
                <div className={styles.suggestionsDropdown} role="listbox">
                  {suggestionsLoading ? (
                    <div className={styles.suggestionLoading}><Spinner size="sm" /></div>
                  ) : suggestions.map((s, i) => (
                    <button
                      key={s.id}
                      type="button"
                      role="option"
                      aria-selected={i === activeIndex}
                      className={`${styles.suggestionItem} ${i === activeIndex ? styles.suggestionItemActive : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s); }}
                    >
                      <Avatar name={s.name || s.email} size="sm" />
                      <div className={styles.suggestionInfo}>
                        {s.name && <Text size="sm" weight="medium">{s.name}</Text>}
                        <Text size="xs" color="muted">{s.email}</Text>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <select
              className={styles.roleSelect}
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as SharePermissionRole)}
              aria-label="Role"
            >
              {PERM_ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <Button
              variant="primary"
              size="sm"
              icon={<UserPlus size={14} />}
              onClick={handleAddPerson}
              disabled={!emailInput.trim() || isAdding}
            >
              {isAdding ? 'Adding…' : 'Add'}
            </Button>
          </div>
        </div>

        <Divider spacing="sm" />

        {/* Collaborators */}
        <div className={styles.section}>
          <Text size="sm" weight="semibold">People with access</Text>
          {permissionsLoading ? (
            <div className={styles.loadingRow}><Spinner size="sm" /></div>
          ) : permissions.length === 0 ? (
            <Text size="sm" color="muted">No collaborators yet.</Text>
          ) : (
            <div className={styles.collaboratorList}>
              {[...owners, ...nonOwners].map((perm) => (
                <CollaboratorRow
                  key={perm.id}
                  perm={perm}
                  onRoleChange={(role) => onRoleChange(perm.userId, role)}
                  onRevoke={() => onRevoke(perm.userId)}
                  isPending={permissionsPending}
                />
              ))}
            </div>
          )}
        </div>

        <Divider spacing="sm" />

        {/* Share link */}
        <div className={styles.section}>
          <Text size="sm" weight="semibold">Share link</Text>
          {shareLinkLoading ? (
            <div className={styles.loadingRow}><Spinner size="sm" /></div>
          ) : shareLink ? (
            <ShareLinkSection
              link={shareLink}
              onCopy={() => handleCopyLink(shareLink)}
              copied={copied}
              onToggle={onToggleLink}
              onRoleChange={onLinkRoleChange}
              onVisibilityChange={onLinkVisibilityChange}
              onExpiryChange={onLinkExpiryChange}
              onDelete={onDeleteLink}
              isPending={linkPending}
            />
          ) : (
            <div className={styles.noLink}>
              <Text size="sm" color="muted">No shareable link yet.</Text>
              <Button
                variant="secondary"
                size="sm"
                icon={<Link size={14} />}
                onClick={onCreateLink}
                disabled={createLinkPending}
              >
                {createLinkPending ? 'Creating…' : 'Create link'}
              </Button>
            </div>
          )}
        </div>
      </ModalBody>
    </Modal>
  );
}
