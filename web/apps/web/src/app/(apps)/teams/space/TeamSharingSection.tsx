'use client';

/**
 * What a team's Owners and Admins share with every member (customization roadmap §5): pinned
 * resources (T5), palette shortcuts to the team's Docs templates (T6) and the shared library (T4).
 * Pins and shortcuts are team defaults; the library is an encrypted team file — see
 * lib/teamResources.ts for why the two are stored differently.
 */

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { Button, Heading, Select, Text, TextInput, useToast } from '@neutrino/ui';
import { useUser } from '@neutrino/auth';
import { teamsApi, type Team } from '@/lib/api';
import {
  ownLibrary,
  publishTeamLibrary,
  readCommands,
  readPins,
  templateApp,
  type TeamCommand,
  type TeamPin,
} from '@/lib/teamResources';
import styles from './space.module.css';

const newId = () => Math.random().toString(36).slice(2, 10);

function move<T>(list: T[], index: number, delta: number): T[] {
  const next = [...list];
  const target = index + delta;
  if (target < 0 || target >= next.length) return list;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function TeamSharingSection({ team }: { team: Team }) {
  const qc = useQueryClient();
  const user = useUser();
  const { success, error: toastError } = useToast();
  const { data: prefs } = useQuery({
    queryKey: ['team-preferences', team.id],
    queryFn: () => teamsApi.getPreferences(team.id),
  });
  const { data: library } = useQuery({
    queryKey: ['team-library', team.id, null],
    queryFn: () => teamsApi.listLibrary(team.id),
  });

  const pins = readPins(prefs?.values['team.pins']);
  const commands = readCommands(prefs?.values['team.commands']);
  const libraryInfo = prefs?.values['team.library'] as { updatedAt?: string } | undefined;
  const entries = [...(library?.folders ?? []).map((f) => ({ id: f.id, name: f.name, kind: 'folder' as const })),
    ...(library?.files ?? []).filter((f) => !f.name.startsWith('.')).map((f) => ({ id: f.id, name: f.name, kind: 'file' as const }))];
  const docTemplates = (library?.files ?? []).filter((f) => templateApp(f) === 'docs');

  const patch = useMutation({
    mutationFn: (values: Record<string, unknown>) => teamsApi.patchPreferences(team.id, values),
    onSuccess: (result) => {
      qc.setQueryData(['team-preferences', team.id], result);
      qc.invalidateQueries({ queryKey: ['preferences'] });
    },
    onError: () => toastError('Could not save.'),
  });
  const savePins = (next: TeamPin[]) => patch.mutate({ 'team.pins': next.length ? { items: next } : null });
  const saveCommands = (next: TeamCommand[]) => patch.mutate({ 'team.commands': next.length ? { items: next } : null });

  const [pinChoice, setPinChoice] = useState('');
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [shortcutTitle, setShortcutTitle] = useState('');
  const [shortcutTemplate, setShortcutTemplate] = useState('');

  const publish = useMutation({
    mutationFn: () => publishTeamLibrary(team.id, user!.id, ownLibrary()),
    onSuccess: (handover) => {
      qc.invalidateQueries({ queryKey: ['team-preferences', team.id] });
      success(handover.unverified.length
        ? `Library shared. ${handover.unverified.length} member(s) skipped until their key is verified.`
        : 'Library shared with the team.');
    },
    onError: () => toastError('Could not share the library. Is your encryption key unlocked?'),
  });

  return (
    <>
      <div className={styles.storageSection}>
        <Heading level={2} size="sm">Pinned for everyone</Heading>
        <Text size="sm" color="secondary">
          Folders, files and links at the top of this space and under the team in each member&rsquo;s sidebar.
        </Text>
        {pins.length > 0 && (
          <ul className={styles.sharingList} aria-label="Pinned resources">
            {pins.map((pin, i) => (
              <li key={pin.id} className={styles.sharingRow}>
                <span className={styles.sharingName}>{pin.name}</span>
                <span className={styles.sharingKind}>{pin.kind}</span>
                <button type="button" className={styles.iconButton} aria-label={`Move ${pin.name} up`} disabled={i === 0} onClick={() => savePins(move(pins, i, -1))}><ArrowUp size={13} /></button>
                <button type="button" className={styles.iconButton} aria-label={`Move ${pin.name} down`} disabled={i === pins.length - 1} onClick={() => savePins(move(pins, i, 1))}><ArrowDown size={13} /></button>
                <button type="button" className={styles.iconButton} aria-label={`Unpin ${pin.name}`} onClick={() => savePins(pins.filter((p) => p.id !== pin.id))}><Trash2 size={13} /></button>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.sharingForm}>
          <Select
            aria-label="Folder or file to pin"
            value={pinChoice}
            onChange={(e) => setPinChoice(e.target.value)}
            options={[{ value: '', label: 'Choose a folder or file…' }, ...entries.map((e) => ({ value: `${e.kind}:${e.id}`, label: e.name }))]}
          />
          <Button
            variant="secondary"
            disabled={!pinChoice || pins.length >= 20}
            onClick={() => {
              const [kind, id] = pinChoice.split(':') as ['file' | 'folder', string];
              const entry = entries.find((e) => e.id === id);
              if (!entry) return;
              savePins([...pins, { id: newId(), kind, name: entry.name, target: id }]);
              setPinChoice('');
            }}
          >
            Pin
          </Button>
        </div>
        <div className={styles.sharingForm}>
          <TextInput aria-label="Link name" placeholder="Link name" value={linkName} onChange={(e) => setLinkName(e.target.value)} />
          <TextInput aria-label="Link URL" placeholder="https://…" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
          <Button
            variant="secondary"
            disabled={!linkName.trim() || !/^https?:\/\/\S+$/i.test(linkUrl.trim()) || pins.length >= 20}
            onClick={() => {
              savePins([...pins, { id: newId(), kind: 'link', name: linkName.trim(), target: linkUrl.trim() }]);
              setLinkName('');
              setLinkUrl('');
            }}
          >
            Pin link
          </Button>
        </div>
      </div>

      <div className={styles.storageSection}>
        <Heading level={2} size="sm">Palette shortcuts</Heading>
        <Text size="sm" color="secondary">
          A command in every member&rsquo;s palette (⌘K) that makes a new document from one of the team&rsquo;s Docs templates.
        </Text>
        {commands.length > 0 && (
          <ul className={styles.sharingList} aria-label="Palette shortcuts">
            {commands.map((c) => (
              <li key={c.id} className={styles.sharingRow}>
                <span className={styles.sharingName}>{c.title}</span>
                <button type="button" className={styles.iconButton} aria-label={`Remove ${c.title}`} onClick={() => saveCommands(commands.filter((x) => x.id !== c.id))}><Trash2 size={13} /></button>
              </li>
            ))}
          </ul>
        )}
        {docTemplates.length === 0 ? (
          <Text size="sm" color="secondary">Add a .dotx template to the team&rsquo;s Files to make a shortcut to it.</Text>
        ) : (
          <div className={styles.sharingForm}>
            <TextInput aria-label="Shortcut name" placeholder="New incident report" value={shortcutTitle} onChange={(e) => setShortcutTitle(e.target.value)} />
            <Select
              aria-label="Template"
              value={shortcutTemplate}
              onChange={(e) => setShortcutTemplate(e.target.value)}
              options={[{ value: '', label: 'Choose a template…' }, ...docTemplates.map((f) => ({ value: f.id, label: f.name }))]}
            />
            <Button
              variant="secondary"
              disabled={!shortcutTitle.trim() || !shortcutTemplate || commands.length >= 20}
              onClick={() => {
                saveCommands([...commands, { id: newId(), title: shortcutTitle.trim(), templateId: shortcutTemplate }]);
                setShortcutTitle('');
                setShortcutTemplate('');
              }}
            >
              Add shortcut
            </Button>
          </div>
        )}
      </div>

      <div className={styles.storageSection}>
        <Heading level={2} size="sm">Shared library</Heading>
        <Text size="sm" color="secondary">
          Share your saved gradients and conditional-format templates with the team. They are encrypted
          for the current members; anyone who joins later sees them after the next share.
          {libraryInfo?.updatedAt ? ` Last shared ${new Date(libraryInfo.updatedAt).toLocaleString()}.` : ''}
        </Text>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => publish.mutate()} loading={publish.isPending} disabled={!user?.id}>
            Share my library with the team
          </Button>
        </div>
      </div>
    </>
  );
}
