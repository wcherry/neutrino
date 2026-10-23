/**
 * libsodium, loaded on first use rather than with the page.
 *
 * libsodium is the single largest script in the app (≈ 870 KB parsed with its wrappers), and a
 * static import put it on every route — `/sign-in` included, which encrypts nothing. Every
 * function in this package already required `initSodium()` to have resolved before it touched
 * libsodium (the wrappers' functions do not exist until `ready`), so loading the module inside
 * `initSodium()` changes when the bytes arrive, not what any caller has to do.
 */

import type Sodium from 'libsodium-wrappers';

type SodiumLib = typeof Sodium;

let lib: SodiumLib | null = null;
let loading: Promise<SodiumLib> | null = null;

/** Load and initialise libsodium once; later calls share the first. */
export function loadSodium(): Promise<SodiumLib> {
  if (lib) return Promise.resolve(lib);
  loading ??= importSodium()
    .then(async (m) => {
      const s = ((m as { default?: SodiumLib }).default ?? (m as unknown as SodiumLib));
      await s.ready;
      lib = s;
      return s;
    })
    .catch((err) => {
      // Let the next call retry — a failed chunk load (offline, a deploy mid-session) is not permanent.
      loading = null;
      throw err;
    });
  return loading;
}

/**
 * The module, by the `require` condition under Node and by a dynamic import everywhere else.
 *
 * libsodium-wrappers 0.7.16's ESM entry imports a file it does not ship, so Node's `import` of the
 * bare name fails — and Node is where the perf and e2e suites seal their fixtures with this
 * package. The browser bundle never has the problem (next.config.ts aliases the name to the
 * CommonJS build), nor does Vitest (vitest.config.ts does the same). `process.getBuiltinModule`
 * exists only in Node, so the browser never reaches the Node branch; `__filename` makes the
 * resolution start from this package, which is the one that depends on libsodium.
 */
function importSodium(): Promise<unknown> {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const nodeModule = typeof window === 'undefined'
    ? (proc?.getBuiltinModule?.('module') as { createRequire(from: string): (id: string) => unknown } | undefined)
    : undefined;
  if (nodeModule) {
    let from: string;
    try {
      // eslint-disable-next-line no-eval -- read CommonJS's module-scoped `__filename` without bundlers rewriting it
      from = eval('__filename') as string;
    } catch {
      from = `${(proc as unknown as { cwd(): string }).cwd()}/`;
    }
    return Promise.resolve(nodeModule.createRequire(from)('libsodium-wrappers'));
  }
  return import('libsodium-wrappers');
}

/**
 * libsodium itself, for code that runs after `initSodium()` has resolved. Touching it before
 * then throws the same error `initSodium`'s guard always has.
 */
export const sodium: SodiumLib = new Proxy({} as SodiumLib, {
  get(_target, prop) {
    if (!lib) throw new Error('Call initSodium() first');
    return (lib as unknown as Record<PropertyKey, unknown>)[prop];
  },
});
