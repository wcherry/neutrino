'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ColorPicker } from './ColorPicker';
import { ToolbarButton } from '../display/Toolbar';

export interface ColorPickerPopoverProps {
    color: string;
    onChange: (hex: string) => void;
    disabled?: boolean;
    title?: string;
    children?: React.ReactNode;
}

export function ColorPickerPopover({ color, onChange, disabled, title, children }: ColorPickerPopoverProps) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const wrapperRef = useRef<HTMLDivElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;

        function isOutside(target: EventTarget | null) {
            if (wrapperRef.current?.contains(target as Node)) return false;
            if (popoverRef.current?.contains(target as Node)) return false;
            return true;
        }

        function handleMouseDown(e: MouseEvent) {
            if (isOutside(e.target)) setOpen(false);
        }

        // Also close on mouseup outside so that a drag starting on the color
        // wheel and ending outside the popover dismisses it correctly.
        function handleMouseUp(e: MouseEvent) {
            if (isOutside(e.target)) setOpen(false);
        }

        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') setOpen(false);
        }

        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open]);

    function handleOpen() {
        if (disabled) return;
        const rect = wrapperRef.current?.getBoundingClientRect();
        if (rect) setPos({ top: rect.bottom + 6, left: rect.left });
        setOpen(o => !o);
    }

    return (
        <>
            <div ref={wrapperRef} style={{ display: 'inline-flex' }}>
                <ToolbarButton onClick={handleOpen} disabled={disabled} title={title} type="button">
                    {children ?? (
                        <span style={{
                            display: 'inline-block',
                            width: 16,
                            height: 16,
                            borderRadius: 2,
                            background: color,
                            border: '1px solid rgba(0,0,0,0.15)',
                        }} />
                    )}
                </ToolbarButton>
            </div>
            {open && createPortal(
                <div ref={popoverRef} style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}>
                    <ColorPicker value={color} onChange={(hex) => { onChange(hex); }} />
                </div>,
                document.body
            )}
        </>
    );
}
