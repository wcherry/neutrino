import { APP_IDS } from '@/lib/appForPath';
import { BOOT_KEY, BOOT_OWN_KEY } from '@neutrino/preferences';
import { ACCENT_CSS_KEY } from '@/lib/accent';

/**
 * The script every root document runs first in `<head>`, before any stylesheet applies or React
 * loads: it sets `data-look`, `data-density`, `data-theme` and `data-app` on `<html>` so the first
 * paint is already the user's.
 *
 * The boot record is the preference store's mirror of every before-paint
 * preference (@neutrino/preferences, BOOT_KEY); the legacy theme key covers the
 * first load after an upgrade, before the migration has run. The organisation's
 * layer comes with the page itself — the server writes `__NEUTRINO_INSTANCE__` in
 * ahead of this script (src/branding/inject.rs) — so a locked value always wins, and
 * a newer org default replaces whatever the record inherited but never the user's own
 * choice (the record's `$own` list). The same order as the store's `resolve`.
 *
 * Text size, motion, transparency and contrast are attributes the same way (tokens a11y.css); the
 * accent is the CSS `lib/accent.ts` derived and the ThemeProvider kept on this device, applied only
 * while the resolved preference still has an accent.
 *
 * Kept as a string here, rather than inline in `RootDocument`, so a test can run it
 * (`__tests__/antiFouc.test.ts`).
 */
export const ANTI_FOUC_SCRIPT = `(function(){var b={};try{b=JSON.parse(localStorage.getItem('${BOOT_KEY}')||'{}')||{};}catch(e){}var I=window.__NEUTRINO_INSTANCE__||{};var O=(I.org&&I.org.values)||{};var L=(I.org&&I.org.locked)||[];var W=b['${BOOT_OWN_KEY}'];function p(k){if(L.indexOf(k)>=0&&O[k]!==undefined)return O[k];if(W&&W.indexOf(k)<0&&O[k]!==undefined)return O[k];return b[k]!==undefined?b[k]:O[k];}var d=document.documentElement;try{var l=p('appearance.look');if(['classic','lightflow','precision','blended'].indexOf(l)>=0)d.setAttribute('data-look',l);var n=p('appearance.density');if(['compact','comfortable','spacious'].indexOf(n)>=0)d.setAttribute('data-density',n);var z=p('appearance.textSize');if(z==='sm'||z==='lg')d.setAttribute('data-text-size',z);var m=p('a11y.reduceMotion');if(m==='on'||m==='off')d.setAttribute('data-reduce-motion',m);var q=p('a11y.reduceTransparency');if(q==='on'||q==='off')d.setAttribute('data-transparency',q==='on'?'off':'on');var c=p('a11y.contrast');if(c==='more'||c==='standard')d.setAttribute('data-contrast',c);var x=localStorage.getItem('${ACCENT_CSS_KEY}');if(x&&p('appearance.accent')&&/^[^<]*$/.test(x)){var st=document.createElement('style');st.id='neutrino-accent';st.textContent=x;document.head.appendChild(st);}}catch(e){}try{var v=['light','dark','system','glass','midnight','beach','forest','sunbeams','light-glass'];var t=p('appearance.theme')||localStorage.getItem('neutrino.theme')||'system';if(v.indexOf(t)<0&&t.indexOf('custom-')!==0)t='system';var r=t==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;document.documentElement.setAttribute('data-theme',r);}catch(e){}try{var a=${JSON.stringify(APP_IDS)};var s=location.pathname.split('/').filter(Boolean)[0]||'';document.documentElement.setAttribute('data-app',a.indexOf(s)>=0?s:'drive');}catch(e){}})();`;
