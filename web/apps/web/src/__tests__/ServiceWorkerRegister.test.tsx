import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// ServiceWorkerRegister
//
// The worker's cache-first strategy plus an unstamped `__BUILD_ID__` in dev
// means a registered worker pins the whole app shell to its first-ever fetch,
// so only a hard reload picks up code changes. These tests pin down that the
// component registers in production and tears the worker down everywhere else.
// ---------------------------------------------------------------------------

type Registration = { unregister: () => Promise<boolean> };

const register = vi.fn(() => Promise.resolve({} as ServiceWorkerRegistration));
const getRegistrations = vi.fn(() => Promise.resolve([] as Registration[]));
const cacheKeys = vi.fn(() => Promise.resolve([] as string[]));
const cacheDelete = vi.fn(() => Promise.resolve(true));
const reload = vi.fn();

/** Imports the component fresh, so its module-scope NODE_ENV read re-runs. */
async function importUnder(nodeEnv: string) {
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.resetModules();
  return (await import('../components/ServiceWorkerRegister')).ServiceWorkerRegister;
}

beforeEach(() => {
  vi.clearAllMocks();

  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register, getRegistrations, controller: {} },
  });
  Object.defineProperty(window, 'caches', {
    configurable: true,
    value: { keys: cacheKeys, delete: cacheDelete },
  });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ServiceWorkerRegister', () => {
  it('registers the worker in production', async () => {
    const ServiceWorkerRegister = await importUnder('production');
    render(<ServiceWorkerRegister />);

    await waitFor(() => expect(register).toHaveBeenCalledWith('/sw.js'));
    expect(getRegistrations).not.toHaveBeenCalled();
  });

  it('does not register the worker in development', async () => {
    const ServiceWorkerRegister = await importUnder('development');
    render(<ServiceWorkerRegister />);

    await waitFor(() => expect(getRegistrations).toHaveBeenCalled());
    expect(register).not.toHaveBeenCalled();
  });

  it('unregisters a worker left behind by an earlier dev session', async () => {
    const unregister = vi.fn(() => Promise.resolve(true));
    getRegistrations.mockResolvedValueOnce([{ unregister }]);

    const ServiceWorkerRegister = await importUnder('development');
    render(<ServiceWorkerRegister />);

    await waitFor(() => expect(unregister).toHaveBeenCalled());
  });

  it('drops the shell caches without touching unrelated ones', async () => {
    cacheKeys.mockResolvedValueOnce([
      'neutrino-shell-__BUILD_ID__',
      'neutrino-shell-abc1234',
      'some-other-cache',
    ]);

    const ServiceWorkerRegister = await importUnder('development');
    render(<ServiceWorkerRegister />);

    await waitFor(() => expect(cacheDelete).toHaveBeenCalledTimes(2));
    expect(cacheDelete).toHaveBeenCalledWith('neutrino-shell-__BUILD_ID__');
    expect(cacheDelete).toHaveBeenCalledWith('neutrino-shell-abc1234');
    expect(cacheDelete).not.toHaveBeenCalledWith('some-other-cache');
  });

  it('reloads once when the current page is still worker-controlled', async () => {
    getRegistrations.mockResolvedValueOnce([{ unregister: () => Promise.resolve(true) }]);

    const ServiceWorkerRegister = await importUnder('development');
    render(<ServiceWorkerRegister />);

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('does not reload when there was no worker to remove', async () => {
    const ServiceWorkerRegister = await importUnder('development');
    render(<ServiceWorkerRegister />);

    await waitFor(() => expect(getRegistrations).toHaveBeenCalled());
    expect(reload).not.toHaveBeenCalled();
  });

  it('survives a browser that refuses to enumerate registrations', async () => {
    getRegistrations.mockRejectedValueOnce(new Error('not allowed'));

    const ServiceWorkerRegister = await importUnder('development');
    expect(() => render(<ServiceWorkerRegister />)).not.toThrow();

    await waitFor(() => expect(getRegistrations).toHaveBeenCalled());
    expect(reload).not.toHaveBeenCalled();
  });
});
