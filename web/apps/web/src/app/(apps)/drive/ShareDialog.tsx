'use client';

import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
} from '@neutrino/ui';
import { Link, Copy, Trash2, Check, UserPlus, Globe, Lock, Calendar } from 'lucide-react';
import {
  permissionsApi,
  sharingApi,
  usersApi,
  authApi,
  encryptionApi,
  type FileItem,
  type Folder as FolderItem,
  type Permission,
  type ShareLink,
  type PermissionRole,
  type ResourceType,
} from '@/lib/api';
import { initSodium, loadKeyPair, decryptFileKey, encryptFileKey, fromBase64url } from '@neutrino/e2e-crypto';
import { useUser } from '@neutrino/auth';
import styles from './ShareDialog.module.css';

interface Props {
  resource: FileItem | FolderItem;
  resourceType: ResourceType;
  onClose: () => void;
}

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

const PERM_ROLE_OPTIONS: { value: PermissionRole; label: string }[] = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'commenter', label: 'Commenter' },
  { value: 'editor', label: 'Editor' },
];

export function ShareDialog({ resource, resourceType, onClose }: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const currentUser = useUser();

  const [emailInput, setEmailInput] = useState('');
  const [selectedRole, setSelectedRole] = useState<PermissionRole>('viewer');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [isGranting, setIsGranting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const permsKey = ['permissions', resourceType, resource.id];
  const linkKey = ['share-link', resourceType, resource.id];

  useEffect(()=>{
    setOpen(true);
  },[resource]);

  const { data: permsData, isLoading: permsLoading } = useQuery({
    queryKey: permsKey,
    queryFn: () => permissionsApi.listPermissions(resourceType, resource.id),
    retry: false,
  });

  const { data: shareLink, isLoading: linkLoading } = useQuery({
    queryKey: linkKey,
    queryFn: () => sharingApi.getShareLink(resourceType, resource.id),
    retry: false,
  });

  const grantMutation = useMutation({
    mutationFn: (req: Parameters<typeof permissionsApi.grantPermission>[2]) =>
      permissionsApi.grantPermission(resourceType, resource.id, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: permsKey });
      setEmailInput('');
      toast.success('Access granted');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: PermissionRole }) =>
      permissionsApi.updatePermission(resourceType, resource.id, userId, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: permsKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeMutation = useMutation({
    mutationFn: (userId: string) =>
      permissionsApi.revokePermission(resourceType, resource.id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: permsKey });
      toast.success('Access removed');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createLinkMutation = useMutation({
    mutationFn: () =>
      sharingApi.upsertShareLink(resourceType, resource.id, {
        visibility: 'anyoneWithLink',
        role: 'viewer',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: linkKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleLinkMutation = useMutation({
    mutationFn: (isActive: boolean) =>
      sharingApi.updateShareLink(resourceType, resource.id, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: linkKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const updateLinkRoleMutation = useMutation({
    mutationFn: (role: string) =>
      sharingApi.updateShareLink(resourceType, resource.id, { role: role as ShareLink['role'] }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: linkKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const updateLinkVisibilityMutation = useMutation({
    mutationFn: (visibility: ShareLink['visibility']) =>
      sharingApi.updateShareLink(resourceType, resource.id, { visibility }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: linkKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const updateLinkExpiryMutation = useMutation({
    mutationFn: (expiresAt: string | null) =>
      sharingApi.updateShareLink(resourceType, resource.id, { expiresAt }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: linkKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteLinkMutation = useMutation({
    mutationFn: () => sharingApi.deleteShareLink(resourceType, resource.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: linkKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  async function shareE2EKey(fileId: string, recipientId: string): Promise<void> {
    const userId = currentUser?.id;
    if (!userId) return;

    await initSodium();
    const kp = loadKeyPair(userId);
    if (!kp) return; // no local keypair — file is plaintext

    const keyRef = await encryptionApi.getFileKey(fileId);
    if (!keyRef) return; // file has no DEK — plaintext file

    const dek = decryptFileKey(keyRef.encryptedFileKey, kp.publicKey, kp.secretKey);

    const recipientKeyResp = await authApi.getUserPublicKey(recipientId);
    if (!recipientKeyResp) return; // recipient hasn't registered a public key yet

    const recipientPubKey = fromBase64url(recipientKeyResp.publicKey);
    const encryptedFileKey = encryptFileKey(dek, recipientPubKey);

    await encryptionApi.shareFileKey(fileId, { recipientId, encryptedFileKey });
  }

  async function handleAddPerson() {
    if (!emailInput.trim()) return;
    setLookupLoading(true);
    setIsGranting(true);
    try {
      const user = await usersApi.lookupByEmail(emailInput.trim());
      if (!user) {
        toast.error('No user found with that email address');
        return;
      }
      await permissionsApi.grantPermission(resourceType, resource.id, {
        userId: user.id,
        userEmail: user.email,
        userName: user.name,
        role: selectedRole,
      });

      // For files only: share the encrypted DEK with the recipient.
      // Silent failure — if either party has no keypair the file is plaintext.
      if (resourceType === 'file') {
        await shareE2EKey(resource.id, user.id).catch((err) => {
          console.warn('E2E key share failed (non-fatal):', err);
        });
      }

      queryClient.invalidateQueries({ queryKey: permsKey });
      setEmailInput('');
      toast.success('Access granted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to grant access');
    } finally {
      setLookupLoading(false);
      setIsGranting(false);
    }
  }

  function getLinkUrl(link: ShareLink): string {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/share?token=${link.token}`;
  }

  function handleCopyLink(link: ShareLink) {
    const url = getLinkUrl(link);
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => toast.error('Failed to copy link')
    );
  }

  const permissions = permsData?.permissions ?? [];
  const nonOwners = permissions.filter((p) => p.role !== 'owner');
  const owners = permissions.filter((p) => p.role === 'owner');

  return (
    <Modal open={open} onClose={onClose} size="md">
      <ModalHeader title={`Share "${resource.name}"`} onClose={onClose} />
      <ModalBody>
        {/* Add people */}
        <div className={styles.section}>
          <Text size="sm" weight="semibold">Add people</Text>
          <div className={styles.addRow}>
            <input
              className={styles.emailInput}
              type="email"
              placeholder="Enter email address"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddPerson()}
              aria-label="Email address to share with"
            />
            <select
              className={styles.roleSelect}
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as PermissionRole)}
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
              disabled={!emailInput.trim() || lookupLoading || isGranting}
            >
              {lookupLoading || isGranting ? 'Adding…' : 'Add'}
            </Button>
          </div>
        </div>

        <Divider spacing="sm" />

        {/* Collaborators */}
        <div className={styles.section}>
          <Text size="sm" weight="semibold">People with access</Text>
          {permsLoading ? (
            <div className={styles.loadingRow}><Spinner size="sm" /></div>
          ) : permissions.length === 0 ? (
            <Text size="sm" color="muted">No collaborators yet.</Text>
          ) : (
            <div className={styles.collaboratorList}>
              {[...owners, ...nonOwners].map((perm) => (
                <CollaboratorRow
                  key={perm.id}
                  perm={perm}
                  onRoleChange={(role) => updateMutation.mutate({ userId: perm.userId, role })}
                  onRevoke={() => revokeMutation.mutate(perm.userId)}
                  isPending={updateMutation.isPending || revokeMutation.isPending}
                />
              ))}
            </div>
          )}
        </div>

        <Divider spacing="sm" />

        {/* Share link */}
        <div className={styles.section}>
          <Text size="sm" weight="semibold">Share link</Text>
          {linkLoading ? (
            <div className={styles.loadingRow}><Spinner size="sm" /></div>
          ) : shareLink ? (
            <ShareLinkSection
              link={shareLink}
              onCopy={() => handleCopyLink(shareLink)}
              copied={copied}
              onToggle={(active) => toggleLinkMutation.mutate(active)}
              onRoleChange={(role) => updateLinkRoleMutation.mutate(role)}
              onVisibilityChange={(visibility) => updateLinkVisibilityMutation.mutate(visibility)}
              onExpiryChange={(expiresAt) => updateLinkExpiryMutation.mutate(expiresAt)}
              onDelete={() => deleteLinkMutation.mutate()}
              isPending={
                toggleLinkMutation.isPending ||
                updateLinkRoleMutation.isPending ||
                updateLinkVisibilityMutation.isPending ||
                updateLinkExpiryMutation.isPending ||
                deleteLinkMutation.isPending
              }
            />
          ) : (
            <div className={styles.noLink}>
              <Text size="sm" color="muted">No shareable link yet.</Text>
              <Button
                variant="secondary"
                size="sm"
                icon={<Link size={14} />}
                onClick={() => createLinkMutation.mutate()}
                disabled={createLinkMutation.isPending}
              >
                {createLinkMutation.isPending ? 'Creating…' : 'Create link'}
              </Button>
            </div>
          )}
        </div>
      </ModalBody>
    </Modal>
  );
}

function CollaboratorRow({
  perm,
  onRoleChange,
  onRevoke,
  isPending,
}: {
  perm: Permission;
  onRoleChange: (role: PermissionRole) => void;
  onRevoke: () => void;
  isPending: boolean;
}) {
  const isOwner = perm.role === 'owner';
  const displayName = perm.userName || perm.userEmail || perm.userId;
  const displayEmail = perm.userEmail || perm.userId;

  return (
    <div className={styles.collaborator}>
      <Avatar
        name={displayName}
        size="sm"
      />
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
            onChange={(e) => onRoleChange(e.target.value as PermissionRole)}
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
  link: ShareLink;
  onCopy: () => void;
  copied: boolean;
  onToggle: (active: boolean) => void;
  onRoleChange: (role: string) => void;
  onVisibilityChange: (visibility: ShareLink['visibility']) => void;
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
              onChange={(e) => onVisibilityChange(e.target.value as ShareLink['visibility'])}
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

function normalizeDateTimeInput(value: string): string | null {
  if (!value) return null;
  if (value.length === 16) return `${value}:00`;
  return value;
}

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
