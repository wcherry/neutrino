'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import type { SlidePresentation } from '../(apps)/slides/editor/slideEditorTypes';
import { slideBackgroundStyle } from '../(apps)/slides/editor/slideEditorHelpers';
import { SlideRenderer } from '../(apps)/slides/editor/SlideRenderer';

function MirrorContent() {
  const searchParams = useSearchParams();
  const channelId = searchParams.get('channelId');
  const [presentation, setPresentation] = useState<SlidePresentation | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);

  useEffect(() => {
    document.documentElement.requestFullscreen().catch(() => {});
  }, []);

  useEffect(() => {
    if (!channelId) return;
    const channel = new BroadcastChannel(channelId);
    let initialized = false;

    channel.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'init') {
        setPresentation(e.data.presentation);
        setSlideIndex(e.data.slideIndex);
        initialized = true;
      } else if (e.data.type === 'slide') {
        setSlideIndex(e.data.slideIndex);
      } else if (e.data.type === 'exit') {
        window.close();
      }
    };

    channel.postMessage({ type: 'ready' });
    const retryInterval = setInterval(() => {
      if (!initialized) channel.postMessage({ type: 'ready' });
      else clearInterval(retryInterval);
    }, 600);

    return () => {
      clearInterval(retryInterval);
      channel.close();
    };
  }, [channelId]);

  if (!presentation) {
    return (
      <div style={{
        background: '#000',
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'rgba(255,255,255,0.25)',
        fontSize: 14,
        fontFamily: 'system-ui, sans-serif',
      }}>
        Waiting for presentation…
      </div>
    );
  }

  const slide = presentation.slides[slideIndex];
  if (!slide) return null;

  return (
    <div style={{
      background: '#000',
      width: '100vw',
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div
        style={{
          ...slideBackgroundStyle(slide.background),
          aspectRatio: '16 / 9',
          width: '100%',
          maxHeight: '100vh',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <SlideRenderer slide={slide} scale={1.0} />
      </div>
    </div>
  );
}

export default function SlideMirrorPage() {
  return (
    <Suspense>
      <MirrorContent />
    </Suspense>
  );
}
