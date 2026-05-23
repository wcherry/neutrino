import type React from 'react';
import type { SlideBackground, ElementAnimation, Theme } from './slideEditorTypes';
import type { SlideTheme } from '@neutrino/api-slides';

export function slideBackgroundStyle(bg: SlideBackground): React.CSSProperties {
  if (bg.type === 'image') {
    const size = bg.objectFit === 'contain' ? 'contain' : bg.objectFit === 'fill' ? '100% 100%' : 'cover';
    return { backgroundImage: `url(${bg.value})`, backgroundSize: size, backgroundPosition: 'center', backgroundRepeat: 'no-repeat' };
  }
  return { background: bg.value };
}

export function getAnimationStyle(anim: ElementAnimation | undefined): React.CSSProperties | undefined {
  if (!anim || anim.type === 'none') return undefined;
  let keyframe = '';
  if (anim.type === 'fade') {
    keyframe = 'slideAnimFade';
  } else if (anim.type === 'zoom') {
    keyframe = 'slideAnimZoom';
  } else if (anim.type === 'fly-in') {
    const dir = anim.direction ?? 'left';
    keyframe =
      dir === 'left' ? 'slideAnimFlyLeft' :
      dir === 'right' ? 'slideAnimFlyRight' :
      dir === 'top' ? 'slideAnimFlyTop' :
      'slideAnimFlyBottom';
  }
  return {
    animation: `${keyframe} ${anim.duration}ms ease-out ${anim.delay}ms both`,
  };
}

export function bgPreviewStyle(bg: SlideBackground): React.CSSProperties {
  if (bg.type === 'image') return { backgroundImage: `url(${bg.value})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  return { background: bg.value };
}

export type VideoProvider = 'youtube' | 'vimeo' | 'loom' | 'mp4';

export interface VideoEmbedInfo {
  provider: VideoProvider;
  embedUrl: string;
  thumbnailUrl?: string;
  /** True for portrait (9:16) formats such as YouTube Shorts. */
  isPortrait: boolean;
}

export interface VideoEmbedOpts {
  startSeconds?: number;
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
}

export function getVideoEmbedInfo(url: string, opts: VideoEmbedOpts = {}): VideoEmbedInfo {
  const { startSeconds, autoplay, loop, muted } = opts;
  const isShorts = /youtube\.com\/shorts\//.test(url);
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) {
    const id = ytMatch[1];
    const params = new URLSearchParams({ enablejsapi: '1' });
    if (startSeconds) params.set('start', String(Math.floor(startSeconds)));
    if (autoplay) params.set('autoplay', '1');
    if (loop) { params.set('loop', '1'); params.set('playlist', id); }
    if (muted) params.set('mute', '1');
    return {
      provider: 'youtube',
      embedUrl: `https://www.youtube.com/embed/${id}?${params}`,
      thumbnailUrl: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
      isPortrait: isShorts,
    };
  }
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) {
    const params = new URLSearchParams();
    if (startSeconds) params.set('t', String(Math.floor(startSeconds)));
    if (autoplay) params.set('autoplay', '1');
    if (loop) params.set('loop', '1');
    if (muted) params.set('muted', '1');
    const query = params.toString();
    return {
      provider: 'vimeo',
      embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}${query ? `?${query}` : ''}`,
      isPortrait: false,
    };
  }
  const loomMatch = url.match(/loom\.com\/share\/([a-f0-9]+)/i);
  if (loomMatch) {
    return {
      provider: 'loom',
      embedUrl: `https://www.loom.com/embed/${loomMatch[1]}`,
      isPortrait: false,
    };
  }
  return { provider: 'mp4', embedUrl: url, isPortrait: false };
}

export function dbThemeToTheme(t: SlideTheme): Theme {
  return {
    name: t.name,
    primaryColor: t.primaryColor,
    backgroundColor: t.backgroundColor,
    textColor: t.textColor,
    accentColor: t.accentColor,
    fontFamily: t.fontFamily,
    backgroundImage: t.backgroundImage ?? undefined,
    gradient: t.gradientBackground ?? undefined,
    defaultTransition: t.defaultTransition as Theme['defaultTransition'],
  };
}
