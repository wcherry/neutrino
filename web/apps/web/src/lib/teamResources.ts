'use client';

import { useContext, useMemo } from 'react';
import { QueryClient, QueryClientContext, useQueries, useQuery } from '@tanstack/react-query';
import { preferences, useTeamDefaults } from '@neutrino/preferences';
import { useUser } from '@neutrino/auth';
import {
  downloadAndDecryptFile,
  teamsApi,
  uploadDriveFile,
  type TeamFile,
} from '@/lib/api';
import { readVaultOrLegacy } from '@neutrino/preferences';
import { handFileKeyToTeam } from '@/lib/teamTransfer';

/**
 * What a team shares with its members beyond files (customization roadmap §5, UI roadmap stage 6):
 *
 * - **T3** its template gallery — the templates in its library, found by type;
 * - **T4** a shared library — gradient presets and conditional-format templates, end-to-end
 *   encrypted like any team file;
 * - **T5** pinned resources — folders, files and links at the top of the space and in each
 *   member's sidebar;
 * - **T6** palette shortcuts — "New incident report" in every member's command palette.
 *
 * Pins and shortcuts are team defaults (`team.pins`, `team.commands`): plain, set by Owners and
 * Admins, read by members. They name files and say what to call them — nothing a server could not
 * already see. The library holds the presets themselves, so it is a file sealed to the members, and
 * the team default only says which file.
 */

/**
 * The page's query client, or one of these hooks' own where a component renders outside the app's
 * provider (an editor panel in a test, say) — a picker that shows team presets must not need one.
 */
const standaloneClient = new QueryClient();
function useClient(): QueryClient {
  return useContext(QueryClientContext) ?? standaloneClient;
}

// ── Pins (T5) ────────────────────────────────────────────────────────────────

export interface TeamPin {
  id: string;
  kind: 'file' | 'folder' | 'link';
  name: string;
  /** A file or folder id, or an http(s) URL. */
  target: string;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function str(v: unknown, max = 200): string | null {
  return typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null;
}

/** The pins in a stored `team.pins`, with anything malformed dropped. */
export function readPins(value: unknown): TeamPin[] {
  const items = (value as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: TeamPin[] = [];
  for (const raw of items) {
    const r = raw as Record<string, unknown>;
    const id = str(r?.id, 64);
    const name = str(r?.name, 120);
    const target = str(r?.target, 500);
    const kind = r?.kind;
    if (!id || !name || !target) continue;
    if (kind === 'link') {
      if (!/^https?:\/\//i.test(target)) continue;
    } else if (kind === 'file' || kind === 'folder') {
      if (!ID.test(target)) continue;
    } else continue;
    out.push({ id, kind, name, target });
  }
  return out.slice(0, 20);
}

/** Where a pin leads. A folder opens in the team's Files view; a file opens in its app. */
export function pinHref(teamId: string, pin: TeamPin): string {
  if (pin.kind === 'link') return pin.target;
  if (pin.kind === 'folder') {
    const params = new URLSearchParams({ id: teamId, view: 'files', folder: pin.target, folderName: pin.name });
    return `/teams/space?${params.toString()}`;
  }
  return `/open/file/${encodeURIComponent(pin.target)}`;
}

// ── Palette shortcuts (T6) ───────────────────────────────────────────────────

export interface TeamCommand {
  id: string;
  title: string;
  /** A Docs template in the team's library. */
  templateId: string;
}

export function readCommands(value: unknown): TeamCommand[] {
  const items = (value as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: TeamCommand[] = [];
  for (const raw of items) {
    const r = raw as Record<string, unknown>;
    const id = str(r?.id, 64);
    const title = str(r?.title, 80);
    const templateId = str(r?.templateId, 64);
    if (id && title && templateId && ID.test(templateId)) out.push({ id, title, templateId });
  }
  return out.slice(0, 20);
}

/** Every team's shortcuts, for the palette, with the team they come from. */
export function useTeamCommands(): { teamId: string; command: TeamCommand }[] {
  const teams = useTeamDefaults();
  return useMemo(
    () => Object.entries(teams).flatMap(([teamId, values]) =>
      readCommands(values['team.commands']).map((command) => ({ teamId, command }))),
    [teams],
  );
}

/** Every team's pins, by team id — for the sidebar. */
export function useTeamPins(): Record<string, TeamPin[]> {
  const teams = useTeamDefaults();
  return useMemo(
    () => Object.fromEntries(Object.entries(teams).map(([teamId, values]) => [teamId, readPins(values['team.pins'])])),
    [teams],
  );
}

// ── Templates (T3) ───────────────────────────────────────────────────────────

const TEMPLATE_EXTENSIONS: Record<string, 'docs' | 'sheets' | 'slides'> = {
  dotx: 'docs',
  xltx: 'sheets',
  potx: 'slides',
};

/** The app a template is for, or null for a file that is not a template. */
export function templateApp(file: Pick<TeamFile, 'name'>): 'docs' | 'sheets' | 'slides' | null {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  return TEMPLATE_EXTENSIONS[ext] ?? null;
}

// ── Shared library (T4) ──────────────────────────────────────────────────────

/** The file a team's library is published as. The name keeps it out of the Files view. */
export const TEAM_LIBRARY_NAME = '.neutrino-team-library.json';

export interface TeamLibrary {
  version: 1;
  publishedAt: string;
  fills: Partial<Record<'slides' | 'diagrams' | 'drawing' | 'default', string[]>>;
  cfTemplates: unknown[];
}

const FILL_KEYS = {
  slides: 'library.fill.slides',
  diagrams: 'library.fill.diagrams',
  drawing: 'library.fill.drawing',
  default: 'library.fill.default',
} as const;

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 50) : [];
}

/** A decrypted library, checked — it came from a file another member wrote. */
export function readLibrary(raw: unknown): TeamLibrary | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || r.version !== 1) return null;
  const fills = (r.fills ?? {}) as Record<string, unknown>;
  return {
    version: 1,
    publishedAt: typeof r.publishedAt === 'string' ? r.publishedAt : '',
    fills: Object.fromEntries((Object.keys(FILL_KEYS) as (keyof typeof FILL_KEYS)[]).map((k) => [k, strings(fills[k])])),
    cfTemplates: Array.isArray(r.cfTemplates) ? r.cfTemplates.slice(0, 50) : [],
  };
}

/** This user's own presets and templates, as a library to publish. */
export function ownLibrary(): TeamLibrary {
  return {
    version: 1,
    publishedAt: new Date().toISOString(),
    fills: Object.fromEntries((Object.entries(FILL_KEYS) as [keyof typeof FILL_KEYS, string][]).map(([k, key]) => [
      k, strings(readVaultOrLegacy(preferences, key as 'library.fill.slides')),
    ])),
    cfTemplates: (readVaultOrLegacy(preferences, 'library.sheets.cfTemplates') as unknown[] | null) ?? [],
  };
}

/**
 * Publish `library` as the team's: encrypted on this device, added to the team's library, its key
 * sealed to every current member (`handFileKeyToTeam`, the rule every team file follows), and
 * named in `team.library`. The previous library file goes to the team's trash. A member who joins
 * later sees it after the next publish — the same as any team file today.
 */
export async function publishTeamLibrary(teamId: string, userId: string, library: TeamLibrary) {
  const body = new File([JSON.stringify(library)], TEAM_LIBRARY_NAME, { type: 'application/json' });
  const uploaded = await uploadDriveFile(body, userId, {});
  await teamsApi.claimFile(teamId, uploaded.id, undefined);
  const handover = await handFileKeyToTeam(teamId, uploaded.id, userId);
  const before = (await teamsApi.getPreferences(teamId)).values['team.library'] as { fileId?: string } | undefined;
  await teamsApi.patchPreferences(teamId, { 'team.library': { fileId: uploaded.id, updatedAt: library.publishedAt } });
  if (before?.fileId && before.fileId !== uploaded.id) {
    await teamsApi.trashLibraryFile(teamId, before.fileId).catch(() => {});
  }
  return handover;
}

/** Every team's library this user can open, decrypted — read-only for everyone but its publisher. */
export function useTeamLibraries(): { teamId: string; library: TeamLibrary }[] {
  const teams = useTeamDefaults();
  const user = useUser();
  const pointers = Object.entries(teams)
    .map(([teamId, values]) => ({ teamId, fileId: (values['team.library'] as { fileId?: unknown } | undefined)?.fileId }))
    .filter((p): p is { teamId: string; fileId: string } => typeof p.fileId === 'string' && ID.test(p.fileId));
  const client = useClient();
  const results = useQueries({
    queries: pointers.map(({ teamId, fileId }) => ({
      queryKey: ['team-shared-library', teamId, fileId],
      enabled: !!user?.id,
      staleTime: 5 * 60_000,
      retry: false,
      queryFn: async () => {
        const bytes = await downloadAndDecryptFile(fileId, user!.id);
        if (!bytes) return null;
        return readLibrary(JSON.parse(new TextDecoder().decode(bytes)));
      },
    })),
  }, client);
  return pointers.flatMap(({ teamId }, i) => {
    const library = results[i]?.data;
    return library ? [{ teamId, library }] : [];
  });
}

/** Team id → name, from the same cached list the sidebar reads; fetched only when something needs a label. */
export function useTeamNames(enabled = true): Record<string, string> {
  const { data } = useQuery({ queryKey: ['teams'], queryFn: () => teamsApi.list(), staleTime: 30_000, enabled }, useClient());
  return useMemo(() => Object.fromEntries((data?.teams ?? []).map((t) => [t.id, t.name])), [data]);
}

/** Gradient presets the user's teams share, one group per team, for a `FillPicker`'s `sharedPresets`. */
export function useSharedFillPresets(kind: keyof TeamLibrary['fills']): { label: string; presets: string[] }[] {
  const libraries = useTeamLibraries();
  const names = useTeamNames(libraries.length > 0);
  return useMemo(
    () => libraries
      .map(({ teamId, library }) => ({ label: `From ${names[teamId] ?? 'your team'}`, presets: library.fills[kind] ?? [] }))
      .filter((g) => g.presets.length > 0),
    [libraries, names, kind],
  );
}

