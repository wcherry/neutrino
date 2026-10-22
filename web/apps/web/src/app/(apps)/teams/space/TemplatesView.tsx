'use client';

/**
 * The team's template gallery (customization roadmap T3): every template in the team's library,
 * found by type — a template is published to the team by putting it in the team's Files. A Docs
 * template makes a new document from itself; a Sheets or Slides one opens, until those editors keep
 * the template type on save (`web/CLAUDE.md`, templates).
 */

import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { FileText, LayoutTemplate, Presentation, Table2 } from 'lucide-react';
import { Button, EmptyState, Heading, Text, useToast } from '@neutrino/ui';
import { useUser } from '@neutrino/auth';
import { teamsApi, type Team, type TeamFile } from '@/lib/api';
import { createDocFromTemplate, TemplateEncryptionUnavailableError } from '@/lib/docTemplates';
import { templateApp } from '@/lib/teamResources';
import styles from './space.module.css';

const ICONS = { docs: FileText, sheets: Table2, slides: Presentation } as const;

/** The team's templates: the library's root and its folders, one level down. */
async function listTemplates(teamId: string): Promise<TeamFile[]> {
  const root = await teamsApi.listLibrary(teamId);
  const nested = await Promise.all(root.folders.map((f) => teamsApi.listLibrary(teamId, f.id).catch(() => null)));
  return [...root.files, ...nested.flatMap((r) => r?.files ?? [])]
    .filter((f) => templateApp(f) !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function TemplatesView({ team }: { team: Team }) {
  const router = useRouter();
  const user = useUser();
  const { error: toastError } = useToast();
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['team-templates', team.id],
    queryFn: () => listTemplates(team.id),
  });

  const use = useMutation({
    mutationFn: async (file: TeamFile) => {
      const app = templateApp(file);
      if (app !== 'docs') return `/open/file/${encodeURIComponent(file.id)}`;
      const title = file.name.replace(/\.[^.]+$/, '');
      const id = await createDocFromTemplate({ userId: user?.id, templateId: file.id, title });
      return `/docs/editor?id=${encodeURIComponent(id)}`;
    },
    onSuccess: (href) => router.push(href),
    onError: (err) =>
      toastError(err instanceof TemplateEncryptionUnavailableError
        ? 'Unlock your encryption key in Settings → Security to use a template.'
        : 'Could not use this template.'),
  });

  return (
    <>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderText}>
          <Heading level={1} size="lg">Templates</Heading>
          <Text size="sm" color="secondary">
            Templates in the team&rsquo;s Files — add a .dotx, .xltx or .potx there to share one.
          </Text>
        </div>
      </div>
      {!isLoading && templates.length === 0 ? (
        <EmptyState
          icon={LayoutTemplate}
          title="No templates yet"
          description="Upload a Word, Excel or PowerPoint template to the team's Files and it appears here for every member."
        />
      ) : (
        <ul className={styles.templateList} aria-label={`${team.name} templates`}>
          {templates.map((file) => {
            const app = templateApp(file)!;
            const Icon = ICONS[app];
            return (
              <li key={file.id} className={styles.templateItem}>
                <span className={styles.templateIcon} style={{ color: `var(--app-color-${app})` }} aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span className={styles.templateName}>{file.name.replace(/\.[^.]+$/, '')}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => use.mutate(file)}
                  loading={use.isPending && use.variables?.id === file.id}
                >
                  {app === 'docs' ? 'Use template' : 'Open'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
