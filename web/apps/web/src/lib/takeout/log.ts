/**
 * Logging for a Takeout import.
 *
 * An import is a long, one-shot, unattended run over files we did not write,
 * on a machine we cannot reproduce: when one document out of four hundred
 * fails, the console is the only record of what it was and how far it got. So
 * every stage logs — which directory was chosen and why, what each file
 * converted to, how big the body was, and which API call rejected it.
 *
 * Logging is always on rather than behind a debug flag, for the same reason
 * the collaboration client logs unconditionally: a failure the user has
 * already hit is not reproducible on demand, and asking them to turn logging
 * on and do it again is asking them to hit it twice. The volume is one line
 * per file, on a page the user visits deliberately.
 */

/** Prefix every line so an import is greppable in a noisy console. */
function prefix(scope: string): string {
  return `[takeout:${scope}]`;
}

export function logStep(scope: string, message: string, details?: unknown): void {
  if (details === undefined) console.log(`${prefix(scope)} ${message}`);
  else console.log(`${prefix(scope)} ${message}`, details);
}

export function logWarn(scope: string, message: string, details?: unknown): void {
  if (details === undefined) console.warn(`${prefix(scope)} ${message}`);
  else console.warn(`${prefix(scope)} ${message}`, details);
}

/**
 * Log a failure with the error object itself, not just its message — the stack
 * is the half that says which call threw.
 */
export function logFail(scope: string, message: string, err: unknown, details?: unknown): void {
  console.error(`${prefix(scope)} ${message}`, { ...(details ?? {}), error: describeError(err) }, err);
}

/**
 * A readable one-line description of anything that was thrown.
 *
 * API rejections carry the status and code separately from the message, and
 * those are what distinguish "your session expired" from "that file was too
 * big" — both of which arrive as a failed autosave. The class is matched by
 * shape rather than imported so this module stays free of the API client.
 */
export function describeError(err: unknown): string {
  if (err && typeof err === 'object') {
    const candidate = err as { statusCode?: unknown; code?: unknown; message?: unknown };
    if (typeof candidate.statusCode === 'number') {
      const code = typeof candidate.code === 'string' && candidate.code ? ` ${candidate.code}` : '';
      const message = typeof candidate.message === 'string' && candidate.message ? `: ${candidate.message}` : '';
      return `HTTP ${candidate.statusCode}${code}${message}`;
    }
  }
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

/** Bytes as something readable in a log line. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
