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
