'use client';

import React from 'react';
import { Modal, ModalHeader, ModalBody } from '@neutrino/ui';
import { SHEET_TEMPLATES, type SheetTemplate } from '../templates/sheetTemplates';
import { MiniGridPreview } from './MiniGridPreview';
import styles from './SheetTemplatePickerModal.module.css';

interface SheetTemplatePickerModalProps {
    open: boolean;
    onClose: () => void;
    onSelect: (template: SheetTemplate) => void;
    busy?: boolean;
}

export function SheetTemplatePickerModal({ open, onClose, onSelect, busy }: SheetTemplatePickerModalProps) {
    return (
        <Modal open={open} onClose={onClose} size="xl">
            <ModalHeader title="New from template" onClose={onClose} />
            <ModalBody>
                <div className={styles.grid}>
                    {SHEET_TEMPLATES.map((template) => (
                        <button
                            key={template.id}
                            type="button"
                            className={styles.card}
                            disabled={busy}
                            onClick={() => onSelect(template)}
                        >
                            <div className={styles.previewWrap}>
                                <MiniGridPreview headers={template.preview.headers} rows={template.preview.rows} />
                            </div>
                            <div className={styles.cardName}>{template.name}</div>
                            <div className={styles.cardDesc}>{template.description}</div>
                        </button>
                    ))}
                </div>
            </ModalBody>
        </Modal>
    );
}
