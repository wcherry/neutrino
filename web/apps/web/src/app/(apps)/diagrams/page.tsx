'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { useToast } from '@neutrino/ui';
import { diagramsApi } from '@neutrino/api-diagrams';
import { GitBranch } from 'lucide-react';
import { DocumentLibrary } from '../DocumentLibrary';
import { TemplatePickerModal } from './TemplatePickerModal';
import type { DiagramTemplate } from './editor/templates/diagramTemplates';

const TEMPLATE_SESSION_KEY_PREFIX = 'neutrino:diagram-template:';

/**
 * The Diagrams library — the shared `DocumentLibrary` (FileGrid, views, sort, rename, delete) since
 * Stage 4, where it had been a grid of its own. New diagrams still start from the template picker.
 */
export default function DiagramsPage() {
  const router = useRouter();
  const toast = useToast();
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  const createMutation = useMutation({
    mutationFn: (template: DiagramTemplate) => diagramsApi.createDiagram({
      title: template.id === 'blank' ? 'Untitled diagram' : template.name,
    }),
    onSuccess: (diagram, template) => {
      if (template.id !== 'blank') {
        // The diagram is created blank; the editor seeds the template's starter
        // content client-side (see DiagramEditor.tsx) so it goes through the
        // same e2e-encrypted save path as any other edit, not a plaintext
        // server-side write.
        try {
          sessionStorage.setItem(`${TEMPLATE_SESSION_KEY_PREFIX}${diagram.id}`, JSON.stringify(template.build()));
        } catch {
          // sessionStorage unavailable — the diagram still opens, just blank
        }
      }
      router.push(`/diagrams/editor?id=${diagram.id}`);
    },
    onError: () => toast.error('Failed to create diagram'),
  });

  return (
    <>
      <DocumentLibrary
        title="Diagrams"
        noun="diagram"
        typeText="Diagram"
        icon={GitBranch}
        iconColor="var(--file-color-diagram)"
        editorPath="/diagrams/editor"
        queryKey="diagrams"
        previewKind="diagram"
        // Only the one that is not the default says so: what a reader needs to know is which of
        // these files is also a picture anything can open.
        fetchItems={async () =>
          (await diagramsApi.listDiagrams()).diagrams.map((d) => ({
            id: d.id,
            title: d.title,
            updatedAt: d.updatedAt,
            typeText: d.format === 'svg' ? 'Diagram (SVG)' : undefined,
          }))
        }
        createItem={() => diagramsApi.createDiagram({ title: 'Untitled diagram' })}
        onCreate={() => setShowTemplatePicker(true)}
        renameItem={(id, title) => diagramsApi.saveDiagram(id, { title })}
        deleteItem={(id) => diagramsApi.deleteDiagram(id)}
      />
      <TemplatePickerModal
        open={showTemplatePicker}
        onClose={() => setShowTemplatePicker(false)}
        onSelect={(template) => {
          setShowTemplatePicker(false);
          createMutation.mutate(template);
        }}
        busy={createMutation.isPending}
      />
    </>
  );
}
