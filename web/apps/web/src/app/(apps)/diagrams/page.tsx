'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { useToast } from '@neutrino/ui';
import { diagramsApi } from '@neutrino/api-diagrams';
import { FileLibrary } from '../FileLibrary';
import { TemplatePickerModal } from './TemplatePickerModal';
import type { DiagramTemplate } from './editor/templates/diagramTemplates';

const TEMPLATE_SESSION_KEY_PREFIX = 'neutrino:diagram-template:';

/**
 * The Diagrams library — the shared `FileLibrary`. New diagrams start from the template picker,
 * which creates the diagram itself.
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
      <FileLibrary library="diagrams" onCreate={() => setShowTemplatePicker(true)} />
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
