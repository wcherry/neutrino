'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@neutrino/ui';

/**
 * Copies a recovery kit to the clipboard, for the dialogs that show a newly created kit exactly
 * once — pasting it into a password manager beats transcribing it by hand. Says "Copied" for two
 * seconds. A refused clipboard leaves the kit on screen and selectable, so nothing else is needed.
 */
export function RecoveryKitCopyButton({ kit }: { kit: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(kit);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied — the kit is on screen and selectable anyway.
    }
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      icon={copied ? <Check size={14} /> : <Copy size={14} />}
      onClick={() => void copy()}
      disabled={!kit}
    >
      {copied ? 'Copied' : 'Copy recovery kit'}
    </Button>
  );
}
