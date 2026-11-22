/**
 * Creating a new document of each app's kind, in one place.
 *
 * The New menu (`NewItemFAB`) and every app library's "New …" button make the
 * same file the same way, so they share this table rather than each holding a
 * copy of the create call and the editor route it lands on.
 */

import { docsApi, sheetsApi, slidesApi, diagramsApi, drawingApi } from '@/lib/api';
import { createNote } from '@/lib/noteFiles';

export type NewItemKind = 'doc' | 'sheet' | 'slide' | 'note' | 'diagram' | 'drawing';

const CREATORS: Record<NewItemKind, () => Promise<string>> = {
  doc: async () => `/docs/editor?id=${(await docsApi.createDoc({ title: 'Untitled document' })).id}`,
  sheet: async () => `/sheets/editor?id=${(await sheetsApi.createSheet({ title: 'Untitled spreadsheet' })).id}`,
  slide: async () => `/slides/editor?id=${(await slidesApi.createSlide({ title: 'Untitled presentation' })).id}`,
  note: async () => `/notes/editor?id=${(await createNote('Untitled note')).id}`,
  diagram: async () => `/diagrams/editor?id=${(await diagramsApi.createDiagram({ title: 'Untitled diagram' })).id}`,
  drawing: async () => `/drawing/editor?id=${(await drawingApi.createDrawing({ title: 'Untitled drawing' })).id}`,
};

/** Create an empty item of `kind` and return the editor URL that opens it. */
export function createNewItem(kind: NewItemKind): Promise<string> {
  return CREATORS[kind]();
}
