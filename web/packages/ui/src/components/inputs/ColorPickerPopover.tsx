'use client';

import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ColorPicker } from './ColorPicker';
import { ToolbarButton } from '../display/Toolbar';

export interface ColorPickerPopoverProps {
    color: string;
    onChange: (hex: string) => void;
    disabled?: boolean;
    title?: string;
    children?: React.ReactNode;
    showAlpha?: boolean;
}

export function ColorPickerPopover({ color, onChange, disabled, title, children, showAlpha }: ColorPickerPopoverProps) {
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

    // After the popover renders, clamp it so it stays fully within the viewport.
    // useLayoutEffect fires before the browser paints, avoiding any visible flicker.
    useLayoutEffect(() => {
        if (!open || !popoverRef.current) return;
        const el = popoverRef.current;
        const elRect = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const pad = 8;

        let { top, left } = pos;

        // Flip above the trigger if the bottom edge overflows the viewport
        if (top + elRect.height > vh - pad) {
            const wrapRect = wrapperRef.current?.getBoundingClientRect();
            top = wrapRect ? wrapRect.top - elRect.height - 6 : vh - elRect.height - pad;
            if (top < pad) top = pad;
        }

        // Shift left if the right edge overflows the viewport
        if (left + elRect.width > vw - pad) {
            left = vw - elRect.width - pad;
        }
        if (left < pad) left = pad;

        el.style.top = `${top}px`;
        el.style.left = `${left}px`;
    }, [open, pos]);

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
                <div ref={popoverRef} data-color-picker-portal="" style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}>
                    <ColorPicker value={color} onChange={(hex) => { onChange(hex); }} showAlpha={showAlpha} />
                </div>,
                document.body
            )}
        </>
    );
}
