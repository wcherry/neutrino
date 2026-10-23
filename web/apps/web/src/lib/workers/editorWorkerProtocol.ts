/** The messages `editorWorker.ts` answers, shared by the worker and its client. */
export type EditorWorkerOps = {
  encrypt: { args: { bytes: Uint8Array; key: Uint8Array }; result: Uint8Array };
  decrypt: { args: { bytes: Uint8Array; key: Uint8Array }; result: Uint8Array };
  'spell.load': { args: Record<string, never>; result: true };
  'spell.check': { args: { words: string[] }; result: boolean[] };
  'spell.suggest': { args: { word: string }; result: string[] };
};

export type EditorWorkerRequest = {
  [K in keyof EditorWorkerOps]: { id: number; op: K; args: EditorWorkerOps[K]['args'] };
}[keyof EditorWorkerOps];

export type EditorWorkerReply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };
