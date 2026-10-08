import { describe, it, expect } from 'vitest';
import { orientationOf, mediaKindOf } from '@/app/(apps)/drive/mediaDimensions';

describe('orientationOf', () => {
  it('names the long side', () => {
    expect(orientationOf(1920, 1080)).toBe('landscape');
    expect(orientationOf(1080, 1920)).toBe('portrait');
    expect(orientationOf(500, 500)).toBe('square');
  });
});

describe('mediaKindOf', () => {
  it('measures pictures and movies, within a size cap', () => {
    expect(mediaKindOf({ mimeType: 'image/jpeg', sizeBytes: 1000 })).toBe('image');
    expect(mediaKindOf({ mimeType: 'video/mp4', sizeBytes: 1000 })).toBe('video');
    expect(mediaKindOf({ mimeType: 'video/mp4', sizeBytes: 1e10 })).toBeNull();
    expect(mediaKindOf({ mimeType: 'text/plain', sizeBytes: 10 })).toBeNull();
  });
});
