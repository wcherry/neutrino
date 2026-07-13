'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Spinner, Toggle, ProgressBar, useToast, DropZone } from '@neutrino/ui';
import { useAuth } from '@neutrino/auth';
import { adminApi, fontsApi } from '@neutrino/api-admin';
import type { ProcessInfo, DiskUsageInfo, ServiceInfo, AdminUser, FeatureFlag, JobResponse, CustomFont } from '@neutrino/api-admin';
import styles from './page.module.css';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === 'running') return styles.statusRunning;
  if (s === 'sleeping') return styles.statusSleeping;
  return styles.statusOther;
}

// Job status codes stored in the DB: R (running), I (in progress),
// C (completed), E (error).
const JOB_STATUS_LABELS: Record<string, string> = {
  R: 'Queued',
  I: 'In progress',
  C: 'Completed',
  E: 'Error',
};

function jobStatusLabel(status: string): string {
  return JOB_STATUS_LABELS[status] ?? status;
}

function jobStatusClass(status: string): string {
  if (status === 'C') return styles.statusRunning;
  if (status === 'E') return styles.statusOther;
  return styles.statusSleeping;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProcessesTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-processes'],
    queryFn: () => adminApi.getProcesses(),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        Failed to load process information. You may not have admin permissions.
      </div>
    );
  }

  const processes: ProcessInfo[] = data ?? [];

  if (processes.length === 0) {
    return <div className={styles.empty}>No process data available.</div>;
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Running Processes</h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>PID</th>
              <th>Name</th>
              <th>Status</th>
              <th>CPU %</th>
              <th>Memory (RSS KB)</th>
              <th>Open Files</th>
            </tr>
          </thead>
          <tbody>
            {processes.map((proc) => (
              <tr key={proc.pid}>
                <td>{proc.pid}</td>
                <td>{proc.name}</td>
                <td>
                  <span className={statusClass(proc.status)}>{proc.status}</span>
                </td>
                <td>{proc.cpuPercent.toFixed(1)}</td>
                <td>{proc.memoryRssKb.toLocaleString()}</td>
                <td>{proc.openFiles}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DiskTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-disk'],
    queryFn: () => adminApi.getDisk(),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        Failed to load disk usage information.
      </div>
    );
  }

  const disk: DiskUsageInfo = data ?? { totalBytes: 0, usedBytes: 0, freeBytes: 0, paths: [] };
  const usedPercent =
    disk.totalBytes > 0
      ? Math.round((disk.usedBytes / disk.totalBytes) * 100)
      : 0;

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Disk Usage</h2>
      <div className={styles.diskStats}>
        <div className={styles.diskStat}>
          <span className={styles.diskStatLabel}>Total</span>
          <span className={styles.diskStatValue}>{formatBytes(disk.totalBytes)}</span>
        </div>
        <div className={styles.diskStat}>
          <span className={styles.diskStatLabel}>Used</span>
          <span className={styles.diskStatValue}>{formatBytes(disk.usedBytes)}</span>
        </div>
        <div className={styles.diskStat}>
          <span className={styles.diskStatLabel}>Free</span>
          <span className={styles.diskStatValue}>{formatBytes(disk.freeBytes)}</span>
        </div>
      </div>
      <div className={styles.diskBarWrap}>
        <div className={styles.diskBarLabel}>{usedPercent}% used</div>
        <ProgressBar
          value={usedPercent}
          max={100}
          size="lg"
          color={usedPercent >= 90 ? 'error' : usedPercent >= 75 ? 'warning' : 'accent'}
          aria-label="Disk usage"
        />
      </div>
      {disk.paths.length > 0 && (
        <>
          <h2 className={styles.sectionTitle}>Paths</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Path</th>
                  <th>Used</th>
                  <th>% Used</th>
                </tr>
              </thead>
              <tbody>
                {disk.paths.map((p) => (
                  <tr key={p.path}>
                    <td>{p.path}</td>
                    <td>{formatBytes(p.usedBytes)}</td>
                    <td>{p.percent.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ServicesTab() {
  const qc = useQueryClient();
  const { error: toastError } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-services'],
    queryFn: () => adminApi.listServices(),
  });

  const toggleEnabled = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      adminApi.updateService(name, enabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-services'] });
    },
    onError: () => {
      toastError('Failed to update service. Please try again.');
    },
  });

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        Failed to load service information.
      </div>
    );
  }

  const services: ServiceInfo[] = data ?? [];

  if (services.length === 0) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Registered Services</h2>
        <div className={styles.empty}>No services registered yet.</div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Registered Services</h2>
      <div className={styles.serviceList}>
        {services.map((svc) => (
          <div key={svc.name} className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              <span className={styles.serviceName}>{svc.name}</span>
              <span className={styles.serviceMeta}>
                {svc.endpoint} &middot; v{svc.version}
              </span>
            </div>
            <div className={styles.serviceControls}>
              <span className={styles.serviceLabel}>
                {svc.enabled ? 'Enabled' : 'Disabled'}
              </span>
              <Toggle
                checked={svc.enabled}
                disabled={toggleEnabled.isPending}
                aria-label={`Toggle ${svc.name}`}
                onChange={() => {
                  toggleEnabled.mutate({ name: svc.name, enabled: !svc.enabled });
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UsersTab() {
  const { user: currentUser } = useAuth();
  const qc = useQueryClient();
  const { error: toastError, success: toastSuccess } = useToast();
  const [page, setPage] = useState(1);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-users', page],
    queryFn: () => adminApi.listUsers(page, 20),
  });

  const updateUser = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      adminApi.updateUser(userId, { role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      toastSuccess('User updated.');
    },
    onError: () => {
      toastError('Failed to update user. Please try again.');
    },
  });

  const deleteUser = useMutation({
    mutationFn: (userId: string) => adminApi.deleteUser(userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      setConfirmDeleteId(null);
      toastSuccess('User deleted.');
    },
    onError: () => {
      toastError('Failed to delete user. Please try again.');
      setConfirmDeleteId(null);
    },
  });

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        Failed to load users. You may not have admin permissions.
      </div>
    );
  }

  const users: AdminUser[] = data?.users ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  if (users.length === 0) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Users</h2>
        <div className={styles.empty}>No users found.</div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>
        Users <span className={styles.userCount}>({total})</span>
      </h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>2FA</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>
                  <select
                    className={styles.roleSelect}
                    value={u.role}
                    disabled={u.id === currentUser?.id || updateUser.isPending}
                    onChange={(e) =>
                      updateUser.mutate({ userId: u.id, role: e.target.value })
                    }
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td>
                  <span className={u.totpEnabled ? styles.twoFaOn : styles.twoFaOff}>
                    {u.totpEnabled ? 'On' : 'Off'}
                  </span>
                </td>
                <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                <td>
                  {u.id === currentUser?.id ? (
                    <span className={styles.selfLabel}>You</span>
                  ) : confirmDeleteId === u.id ? (
                    <span className={styles.confirmRow}>
                      <button
                        className={styles.confirmBtn}
                        onClick={() => deleteUser.mutate(u.id)}
                        disabled={deleteUser.isPending}
                        type="button"
                      >
                        Confirm
                      </button>
                      <button
                        className={styles.cancelBtn}
                        onClick={() => setConfirmDeleteId(null)}
                        type="button"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      className={styles.deleteBtn}
                      onClick={() => setConfirmDeleteId(u.id)}
                      type="button"
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button
            className={styles.pageBtn}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            type="button"
          >
            Previous
          </button>
          <span className={styles.pageInfo}>
            Page {page} of {totalPages}
          </span>
          <button
            className={styles.pageBtn}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            type="button"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function FeatureFlagsTab() {
  const qc = useQueryClient();
  const { error: toastError, success: toastSuccess } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-feature-flags'],
    queryFn: () => adminApi.listFeatureFlags(),
  });

  const toggleFlag = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      adminApi.updateFeatureFlag(key, { enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-feature-flags'] });
      toastSuccess('Feature flag updated.');
    },
    onError: () => {
      toastError('Failed to update feature flag. Please try again.');
    },
  });

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        Failed to load feature flags.
      </div>
    );
  }

  const flags: FeatureFlag[] = data ?? [];

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Feature Flags</h2>
      <div className={styles.serviceList}>
        {flags.map((flag) => (
          <div key={flag.key} className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              <span className={styles.serviceName}>{flag.key}</span>
              {flag.description && (
                <span className={styles.serviceMeta}>{flag.description}</span>
              )}
            </div>
            <div className={styles.serviceControls}>
              <span className={styles.serviceLabel}>
                {flag.enabled ? 'Enabled' : 'Disabled'}
              </span>
              <Toggle
                checked={flag.enabled}
                disabled={toggleFlag.isPending}
                aria-label={`Toggle ${flag.key}`}
                onChange={() => {
                  toggleFlag.mutate({ key: flag.key, enabled: !flag.enabled });
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FontsTab() {
  const qc = useQueryClient();
  const { error: toastError, success: toastSuccess } = useToast();
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-fonts'],
    queryFn: () => fontsApi.list(),
  });

  const uploadFont = useMutation({
    mutationFn: () => adminApi.uploadFont(pendingFile!, displayName.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-fonts'] });
      toastSuccess('Font uploaded.');
      setPendingFile(null);
      setDisplayName('');
    },
    onError: () => {
      toastError('Failed to upload font. Check the format (woff2/woff/ttf/otf) and size (max 50 MB).');
    },
  });

  const deleteFont = useMutation({
    mutationFn: (id: string) => adminApi.deleteFont(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-fonts'] });
      toastSuccess('Font deleted.');
    },
    onError: () => {
      toastError('Failed to delete font. Please try again.');
    },
  });

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        Failed to load custom fonts.
      </div>
    );
  }

  const fonts: CustomFont[] = data ?? [];

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Upload a font</h2>
      <DropZone
        onFiles={(files) => setPendingFile(files[0] ?? null)}
        multiple={false}
        accept=".woff2,.woff,.ttf,.otf"
        label={pendingFile ? pendingFile.name : 'Drag & drop a font file here'}
        hint="woff2, woff, ttf, or otf — max 50 MB"
      />
      <div className={styles.serviceRow}>
        <input
          type="text"
          className={styles.roleSelect}
          placeholder="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <button
          className={styles.pageBtn}
          type="button"
          disabled={!pendingFile || !displayName.trim() || uploadFont.isPending}
          onClick={() => uploadFont.mutate()}
        >
          Upload
        </button>
      </div>

      <h2 className={styles.sectionTitle}>Custom Fonts</h2>
      {fonts.length === 0 ? (
        <div className={styles.empty}>No custom fonts uploaded yet.</div>
      ) : (
        <div className={styles.serviceList}>
          {fonts.map((font) => (
            <div key={font.id} className={styles.serviceRow}>
              <div className={styles.serviceInfo}>
                <span className={styles.serviceName}>{font.displayName}</span>
                <span className={styles.serviceMeta}>
                  {font.format} &middot; uploaded {new Date(font.createdAt).toLocaleDateString()}
                </span>
              </div>
              <button
                className={styles.deleteBtn}
                type="button"
                disabled={deleteFont.isPending}
                onClick={() => deleteFont.mutate(font.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JobsTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-jobs'],
    queryFn: () => adminApi.listJobs(),
    refetchInterval: 15_000,
  });

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        Failed to load jobs. You may not have admin permissions.
      </div>
    );
  }

  const jobs: JobResponse[] = data ?? [];

  if (jobs.length === 0) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Jobs</h2>
        <div className={styles.empty}>No jobs found.</div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>
        Jobs <span className={styles.userCount}>({jobs.length})</span>
      </h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Type</th>
              <th>Status</th>
              <th>Worker</th>
              <th>Timeout</th>
              <th>Created</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{job.id}</td>
                <td>{job.jobType}</td>
                <td>
                  <span className={jobStatusClass(job.status)}>
                    {jobStatusLabel(job.status)}
                  </span>
                </td>
                <td>{job.workerId ?? '—'}</td>
                <td>{job.timeoutSecs}s</td>
                <td>{new Date(job.createdAt).toLocaleString()}</td>
                <td>{job.errorMessage ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Tab = 'processes' | 'disk' | 'services' | 'users' | 'flags' | 'fonts' | 'jobs';

const TABS: { id: Tab; label: string }[] = [
  { id: 'processes', label: 'Processes' },
  { id: 'disk', label: 'Disk Space' },
  { id: 'services', label: 'Services' },
  { id: 'users', label: 'Users' },
  { id: 'flags', label: 'Feature Flags' },
  { id: 'fonts', label: 'Fonts' },
  { id: 'jobs', label: 'Jobs' },
];

export default function AdminPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('processes');

  // Guard: redirect non-admins
  if (!authLoading && !user?.isAdmin) {
    router.replace('/drive');
    return (
      <div className={styles.loading}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => router.back()} type="button">
          <ArrowLeft size={16} />
          Back
        </button>
        <h1 className={styles.heading}>Admin</h1>

        {/* ── Tab bar ─────────────────────────────────────────────────── */}
        <div className={styles.tabBar}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`${styles.tabBtn} ${activeTab === tab.id ? styles.tabBtnActive : ''}`}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────── */}
      <div className={styles.content}>
        {activeTab === 'processes' && <ProcessesTab />}
        {activeTab === 'disk' && <DiskTab />}
        {activeTab === 'services' && <ServicesTab />}
        {activeTab === 'users' && <UsersTab />}
        {activeTab === 'flags' && <FeatureFlagsTab />}
        {activeTab === 'fonts' && <FontsTab />}
        {activeTab === 'jobs' && <JobsTab />}
      </div>
    </div>
  );
}
