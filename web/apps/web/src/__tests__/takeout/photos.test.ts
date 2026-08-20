/**
 * Tests for finding Google Photos media in an archive (`lib/takeout/photos.ts`).
 *
 * Three things about a Photos export make this more than a file filter: the
 * same photo is written into both its album and its year folder, the sidecar
 * beside each file has been named four different ways across export versions,
 * and a folder is only an album when it isn't a year, an archive or a trash.
 */

import { describe, it, expect } from 'vitest';
import { captureDateOf, findTakeoutPhotos, readPhotoInfo } from '@/lib/takeout/photos';
import type { TakeoutArchive, TakeoutEntry } from '@/lib/takeout/archive';

function entry(path: string, { text = '', size = 100, lastModified = null as Date | null } = {}): TakeoutEntry {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return {
    path,
    fullPath: `Takeout/${path}`,
    ext: dot > 0 ? base.slice(dot + 1).toLowerCase() : '',
    size,
    lastModified,
    text: async () => text,
    blob: async () => new Blob([]),
  };
}

function archiveOf(products: Record<string, TakeoutEntry[]>): TakeoutArchive {
  const list = Object.entries(products).map(([name, entries]) => ({ name, entries }));
  return {
    root: 'Takeout/',
    products: list,
    product: (name) => list.find((p) => p.name.toLowerCase() === name.toLowerCase()),
    close: async () => {},
  };
}

const photosArchive = (entries: TakeoutEntry[]) => archiveOf({ 'Google Photos': entries });

describe('findTakeoutPhotos', () => {
  it('picks up pictures and videos and leaves everything else', async () => {
    const found = await findTakeoutPhotos(
      photosArchive([
        entry('Photos from 2019/IMG_1.jpg'),
        entry('Photos from 2019/IMG_1.jpg.json'),
        entry('Photos from 2019/CLIP.MP4'),
        entry('Photos from 2019/RAW.dng'),
        entry('archive_browser.html'),
        entry('print-subscriptions.json'),
      ]),
    );

    expect(found).toMatchObject({ directory: 'Google Photos' });
    expect(found!.photos.map((p) => [p.title, p.kind, p.mimeType])).toEqual([
      ['IMG_1.jpg', 'image', 'image/jpeg'],
      ['CLIP.MP4', 'video', 'video/mp4'],
      ['RAW.dng', 'image', 'image/x-adobe-dng'],
    ]);
  });

  it('pairs a photo with its sidecar however that export named it', async () => {
    const found = await findTakeoutPhotos(
      photosArchive([
        entry('Photos from 2019/a.jpg'),
        entry('Photos from 2019/a.jpg.json'),
        entry('Photos from 2019/b.jpg'),
        entry('Photos from 2019/b.jpg.supplemental-metadata.json'),
        // Google numbers the duplicate on the sidecar, after the extension.
        entry('Photos from 2019/c(1).jpg'),
        entry('Photos from 2019/c.jpg(1).json'),
        // A name too long for the filesystem gets its sidecar truncated.
        entry('Photos from 2019/a-very-long-photo-name-indeed.jpg'),
        entry('Photos from 2019/a-very-long-photo-name-inde.json'),
        entry('Photos from 2019/none.jpg'),
      ]),
    );

    expect(found!.photos.map((p) => [p.title, p.info?.path.split('/')[1]])).toEqual([
      ['a.jpg', 'a.jpg.json'],
      ['b.jpg', 'b.jpg.supplemental-metadata.json'],
      ['c(1).jpg', 'c.jpg(1).json'],
      ['a-very-long-photo-name-indeed.jpg', 'a-very-long-photo-name-inde.json'],
      ['none.jpg', undefined],
    ]);
  });

  it('takes an album’s title from its metadata rather than its folder name', async () => {
    const found = await findTakeoutPhotos(
      photosArchive([
        entry('Rome 2019 - trip/metadata.json', { text: '{"title":"Rome 2019 / trip"}' }),
        entry('Rome 2019 - trip/a.jpg'),
      ]),
    );

    // The folder name has the slash Google could not store; the metadata has
    // what the album was really called — and the year in it must not make the
    // folder look like a year folder.
    expect(found!.photos[0].albums).toEqual(['Rome 2019 / trip']);
    expect(found!.albums).toEqual([{ folder: 'Rome 2019 - trip', title: 'Rome 2019 / trip', count: 1 }]);
  });

  it('treats a year folder as the library, not as an album', async () => {
    const found = await findTakeoutPhotos(
      photosArchive([entry('Photos from 2019/a.jpg'), entry('2020/b.jpg')]),
    );

    expect(found!.photos.every((p) => p.albums.length === 0)).toBe(true);
    expect(found!.albums).toEqual([]);
  });

  it('falls back to the folder name for an album with no metadata', async () => {
    const found = await findTakeoutPhotos(photosArchive([entry('Holiday/a.jpg')]));
    expect(found!.photos[0].albums).toEqual(['Holiday']);
  });

  it('marks what Google had archived or in the trash', async () => {
    const found = await findTakeoutPhotos(
      photosArchive([entry('Archive/a.jpg'), entry('Trash/b.jpg'), entry('Photos from 2019/c.jpg')]),
    );

    expect(found!.photos.map((p) => [p.title, p.archived, p.trashed])).toEqual([
      ['a.jpg', true, false],
      ['b.jpg', false, true],
      ['c.jpg', false, false],
    ]);
    // Neither folder is an album.
    expect(found!.albums).toEqual([]);
  });

  it('folds the album copy and the year copy of a photo into one', async () => {
    const found = await findTakeoutPhotos(
      photosArchive([
        entry('Photos from 2019/IMG_1.jpg', { size: 2048 }),
        entry('Photos from 2019/IMG_1.jpg.json', { text: '{"title":"IMG_1.jpg"}' }),
        entry('Rome/IMG_1.jpg', { size: 2048 }),
        entry('Rome/IMG_1.jpg.json', { text: '{"title":"IMG_1.jpg"}' }),
      ]),
    );

    expect(found!.photos).toHaveLength(1);
    expect(found!.photos[0].albums).toEqual(['Rome']);
    expect(found!.duplicates).toBe(1);
    expect(found!.albums).toEqual([{ folder: 'Rome', title: 'Rome', count: 1 }]);
  });

  it('keeps two photos apart when only their names match', async () => {
    const found = await findTakeoutPhotos(
      photosArchive([
        entry('Photos from 2019/IMG_1.jpg', { size: 2048 }),
        entry('Photos from 2020/IMG_1.jpg', { size: 4096 }),
      ]),
    );
    expect(found!.photos).toHaveLength(2);
  });

  it('collects every album a photo was filed in', async () => {
    const found = await findTakeoutPhotos(
      photosArchive([
        entry('Photos from 2019/a.jpg', { size: 10 }),
        entry('Rome/a.jpg', { size: 10 }),
        entry('Favourites/a.jpg', { size: 10 }),
      ]),
    );

    expect(found!.photos).toHaveLength(1);
    expect(found!.photos[0].albums).toEqual(['Rome', 'Favourites']);
  });

  it('does not call a photo trashed when another copy of it was not', async () => {
    // A photo in an album and in the trash is one the user still has.
    const found = await findTakeoutPhotos(
      photosArchive([entry('Trash/a.jpg', { size: 10 }), entry('Rome/a.jpg', { size: 10 })]),
    );

    expect(found!.photos).toHaveLength(1);
    expect(found!.photos[0].trashed).toBe(false);
    expect(found!.photos[0].albums).toEqual(['Rome']);
  });

  it('recognises a Photos directory Google localised, by the sidecars in it', async () => {
    const found = await findTakeoutPhotos(
      archiveOf({
        'Google Fotos': [entry('Fotos von 2019/a.jpg'), entry('Fotos von 2019/a.jpg.json')],
      }),
    );
    expect(found).toMatchObject({ directory: 'Google Fotos' });
  });

  it('finds pictures that reached the archive as Drive files, with no sidecars', async () => {
    // What the old Drive/Photos integration produces: `Drive/Google Photos/`,
    // bare media, no sidecar and no album metadata anywhere.
    const found = await findTakeoutPhotos(
      archiveOf({
        Drive: [
          entry('Google Photos/Screenshot_20180614-162705.png'),
          entry('Google Photos/20180803_122352.jpg'),
          entry('Google Photos/IMG_20181105_141610.jpg'),
          entry('Report.docx'),
        ],
      }),
    );

    expect(found).toMatchObject({ directory: 'Drive/Google Photos' });
    expect(found!.photos.map((p) => p.title)).toEqual([
      'Screenshot_20180614-162705.png',
      '20180803_122352.jpg',
      'IMG_20181105_141610.jpg',
    ]);
    // No sidecars, so nothing is invented: no albums, no capture dates.
    expect(found!.albums).toEqual([]);
    expect(found!.photos.every((p) => p.info === undefined)).toBe(true);
  });

  it('keeps album folders under a nested Photos folder', async () => {
    const found = await findTakeoutPhotos(
      archiveOf({ Drive: [entry('Google Photos/2018/a.jpg'), entry('Google Photos/Rome/b.jpg')] }),
    );
    expect(found!.albums.map((a) => [a.title, a.count])).toEqual([['Rome', 1]]);
  });

  it('prefers a real Photos export over a Google Photos folder in Drive', async () => {
    const found = await findTakeoutPhotos(
      archiveOf({
        Drive: [entry('Google Photos/from-drive.jpg')],
        'Google Photos': [entry('Photos from 2019/real.jpg'), entry('Photos from 2019/real.jpg.json')],
      }),
    );
    expect(found).toMatchObject({ directory: 'Google Photos' });
    expect(found!.photos.map((p) => p.title)).toEqual(['real.jpg']);
  });

  it('leaves Keep’s attached images alone', async () => {
    // Keep writes `<note>.json` beside `<note>.html` and its attachments, but
    // never a sidecar named after an image — which is the whole signal.
    const found = await findTakeoutPhotos(
      archiveOf({ Keep: [entry('Note.json'), entry('Note.html'), entry('attachment.jpg')] }),
    );
    expect(found).toBeNull();
  });

  it('finds nothing in an archive with no media', async () => {
    expect(await findTakeoutPhotos(archiveOf({ Drive: [entry('Report.docx')] }))).toBeNull();
  });
});

describe('captureDateOf', () => {
  it('formats a Takeout timestamp the way the register endpoint parses it', () => {
    const seconds = Date.UTC(2019, 7, 13, 12, 34, 56) / 1000;

    // `%Y-%m-%dT%H:%M:%S` and nothing else: a trailing Z or milliseconds and
    // the server drops the date without a word.
    expect(captureDateOf(String(seconds))).toBe('2019-08-13T12:34:56');
    expect(captureDateOf(seconds)).toBe('2019-08-13T12:34:56');
  });

  it('has nothing to say about a missing or nonsensical timestamp', () => {
    expect(captureDateOf(undefined)).toBeUndefined();
    expect(captureDateOf('')).toBeUndefined();
    expect(captureDateOf('0')).toBeUndefined();
    expect(captureDateOf('not a number')).toBeUndefined();
  });
});

describe('readPhotoInfo', () => {
  const sidecar = (json: string) => entry('Photos from 2019/a.jpg.json', { text: json });

  it('reads the title, the date taken and the favourite flag', async () => {
    const taken = Date.UTC(2019, 7, 13, 12, 0, 0) / 1000;
    const info = await readPhotoInfo(
      sidecar(
        JSON.stringify({
          title: 'IMG_1.jpg',
          description: 'On the roof',
          photoTakenTime: { timestamp: String(taken), formatted: '13 Aug 2019' },
          favorited: true,
        }),
      ),
    );

    expect(info).toEqual({
      title: 'IMG_1.jpg',
      description: 'On the roof',
      takenAt: '2019-08-13T12:00:00',
      favorite: true,
    });
  });

  it('prefers when the photo was taken over when Google received it', async () => {
    const taken = Date.UTC(2005, 0, 2, 3, 4, 5) / 1000;
    const uploaded = Date.UTC(2019, 7, 13, 12, 0, 0) / 1000;
    const info = await readPhotoInfo(
      sidecar(
        JSON.stringify({
          photoTakenTime: { timestamp: String(taken) },
          creationTime: { timestamp: String(uploaded) },
        }),
      ),
    );

    expect(info!.takenAt).toBe('2005-01-02T03:04:05');
  });

  it('falls back to the creation time when there is no taken time', async () => {
    const uploaded = Date.UTC(2019, 7, 13, 12, 0, 0) / 1000;
    const info = await readPhotoInfo(sidecar(JSON.stringify({ creationTime: { timestamp: String(uploaded) } })));
    expect(info!.takenAt).toBe('2019-08-13T12:00:00');
  });

  it('leaves the photo to its filename when there is no sidecar or it is broken', async () => {
    expect(await readPhotoInfo(undefined)).toBeNull();
    expect(await readPhotoInfo(sidecar('not json'))).toBeNull();
    expect(await readPhotoInfo(sidecar('[]'))).toBeNull();
  });
});
