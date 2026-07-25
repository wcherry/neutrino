'use client';

import React from 'react';
import { Modal, ModalHeader, ModalBody } from '@neutrino/ui';
import { TABLE_STYLES, type TableStyle } from '../styles/tableStyles';
import { TableStylePreviewSwatch } from './TableStylePreviewSwatch';
import styles from './TableStyleGalleryModal.module.css';

interface TableStyleGalleryModalProps {
    open: boolean;
    onClose: () => void;
    onSelect: (style: TableStyle) => void;
}

export function TableStyleGalleryModal({ open, onClose, onSelect }: TableStyleGalleryModalProps) {
    return (
        <Modal open={open} onClose={onClose} size="xl">
            <ModalHeader title="Table styles" onClose={onClose} />
            <ModalBody>
                <div className={styles.grid}>
                    {TABLE_STYLES.map((style) => (
                        <button
                            key={style.id}
                            type="button"
                            className={styles.card}
                            onClick={() => onSelect(style)}
                        >
                            <div className={styles.previewWrap}>
                                <TableStylePreviewSwatch style={style} />
                            </div>
                            <div className={styles.cardName}>{style.name}</div>
                        </button>
                    ))}
                </div>
            </ModalBody>
        </Modal>
    );
}
