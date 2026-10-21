import { describe, it, expect } from 'vitest';
import { APP_IDS, appForPath } from '@/lib/appForPath';

describe('appForPath', () => {
  it('names the app a route belongs to', () => {
    expect(appForPath('/docs/editor/')).toBe('docs');
    expect(appForPath('/sheets')).toBe('sheets');
    expect(appForPath('/photos/edit')).toBe('photos');
    expect(appForPath('/drawing/editor')).toBe('drawing');
  });

  it('is Drive for Drive views and everything that is not an app', () => {
    for (const path of ['/', '/drive', '/drive/trash', '/settings', '/teams/space', '/admin', '/search']) {
      expect(appForPath(path)).toBe('drive');
    }
  });

  it('does not match on a prefix', () => {
    expect(appForPath('/docsearch')).toBe('drive');
  });

  it('has a colour for every app it can return', async () => {
    // apps.css must define [data-app="<id>"] for each id, or the app silently wears Drive's colour.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const css = fs.readFileSync(path.resolve(__dirname, '../../../../packages/tokens/src/apps.css'), 'utf8');
    for (const id of APP_IDS) expect(css).toContain(`[data-app="${id}"]`);
  });
});
