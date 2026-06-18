'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import type { CFRule } from '../types';

export function useConditionalFormatting({
    dirtyRef,
    activeSheetIndexRef,
}: {
    dirtyRef: React.MutableRefObject<boolean>;
    activeSheetIndexRef: React.MutableRefObject<number>;
}) {
    const sheetsConditionalFormatsRef = useRef<CFRule[][]>([[]]);

    const [conditionalFormats, setConditionalFormats] = useState<CFRule[]>([]);
    const conditionalFormatsRef = useRef<CFRule[]>([]);

    useEffect(() => { conditionalFormatsRef.current = conditionalFormats; }, [conditionalFormats]);

    const flushActiveConditionalFormats = useCallback(() => {
        sheetsConditionalFormatsRef.current[activeSheetIndexRef.current] = conditionalFormatsRef.current;
    }, [activeSheetIndexRef]);

    const switchSheetConditionalFormats = useCallback((newIndex: number) => {
        while (sheetsConditionalFormatsRef.current.length <= newIndex) {
            sheetsConditionalFormatsRef.current.push([]);
        }
        setConditionalFormats(sheetsConditionalFormatsRef.current[newIndex] ?? []);
    }, []);

    const updateConditionalFormats = useCallback((rules: CFRule[]) => {
        conditionalFormatsRef.current = rules;
        setConditionalFormats(rules);
        dirtyRef.current = true;
    }, [dirtyRef]);

    return {
        conditionalFormats,
        conditionalFormatsRef,
        sheetsConditionalFormatsRef,
        setConditionalFormats,
        updateConditionalFormats,
        flushActiveConditionalFormats,
        switchSheetConditionalFormats,
    };
}
