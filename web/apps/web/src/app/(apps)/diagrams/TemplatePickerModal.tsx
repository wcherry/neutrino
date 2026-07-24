'use client';

import React from 'react';
import { Modal, ModalHeader, ModalBody } from '@neutrino/ui';
import { FileText, Workflow, Network, Brain } from 'lucide-react';
import { DIAGRAM_TEMPLATES, type DiagramTemplate } from './editor/templates/diagramTemplates';
import styles from './TemplatePickerModal.module.css';

const ICONS = { FileText, Workflow, Network, Brain };

interface TemplatePickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (template: DiagramTemplate) => void;
  busy?: boolean;
}

export function TemplatePickerModal({ open, onClose, onSelect, busy }: TemplatePickerModalProps) {
  return (
    <Modal open={open} onClose={onClose} size="md">
      <ModalHeader title="New diagram" onClose={onClose} />
      <ModalBody>
        <div className={styles.grid}>
          {DIAGRAM_TEMPLATES.map((template) => {
            const Icon = ICONS[template.icon];
            return (
              <button
                key={template.id}
                type="button"
                className={styles.card}
                disabled={busy}
                onClick={() => onSelect(template)}
              >
                <div className={styles.cardIcon}>
                  <Icon size={28} />
                </div>
                <div className={styles.cardName}>{template.name}</div>
                <div className={styles.cardDesc}>{template.description}</div>
              </button>
            );
          })}
        </div>
      </ModalBody>
    </Modal>
  );
}
