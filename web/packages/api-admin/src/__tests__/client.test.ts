import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminApi } from '../client';

// ---------------------------------------------------------------------------
// Mock @neutrino/api-core request
// ---------------------------------------------------------------------------

vi.mock('@neutrino/api-core', () => ({
  request: vi.fn(),
}));

import { request } from '@neutrino/api-core';
const mockRequest = vi.mocked(request);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleUser = {
  id: 'u1',
  email: 'alice@example.com',
  name: 'Alice',
  role: 'user',
  totpEnabled: false,
  createdAt: '2026-01-01T00:00:00Z',
  deletedAt: null,
};

const sampleUserList = {
  users: [sampleUser],
  total: 1,
  page: 1,
  pageSize: 20,
};

const sampleProcess = {
  pid: 123,
  name: 'neutrino-drive',
  status: 'Running',
  cpuPercent: 0.5,
  memoryRssKb: 8192,
  openFiles: 12,
};

const sampleDisk = {
  totalBytes: 100_000_000,
  usedBytes: 60_000_000,
  freeBytes: 40_000_000,
  paths: [{ path: '/data', usedBytes: 60_000_000, percent: 60 }],
};

const sampleService = {
  name: 'neutrino-drive',
  endpoint: 'http://localhost:8080',
  version: '1.0.0',
  healthCheckUrl: 'http://localhost:8080/health',
  registeredAt: '2026-01-01T00:00:00Z',
  enabled: true,
  autoUpdate: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('adminApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getProcesses', () => {
    it('calls GET /api/v1/admin/processes and returns the array', async () => {
      mockRequest.mockResolvedValueOnce([sampleProcess]);
      const result = await adminApi.getProcesses();
      expect(mockRequest).toHaveBeenCalledWith('/api/v1/admin/processes');
      expect(result).toEqual([sampleProcess]);
    });
  });

  describe('getDisk', () => {
    it('calls GET /api/v1/admin/disk and returns DiskUsageInfo', async () => {
      mockRequest.mockResolvedValueOnce(sampleDisk);
      const result = await adminApi.getDisk();
      expect(mockRequest).toHaveBeenCalledWith('/api/v1/admin/disk');
      expect(result).toEqual(sampleDisk);
    });
  });

  describe('listServices', () => {
    it('calls GET /api/v1/admin/services and returns the array', async () => {
      mockRequest.mockResolvedValueOnce([sampleService]);
      const result = await adminApi.listServices();
      expect(mockRequest).toHaveBeenCalledWith('/api/v1/admin/services');
      expect(result).toEqual([sampleService]);
    });
  });

  describe('updateService', () => {
    it('calls PATCH /api/v1/admin/services/{name} with enabled body', async () => {
      mockRequest.mockResolvedValueOnce({ ...sampleService, enabled: true });
      await adminApi.updateService('neutrino-drive', true);
      expect(mockRequest).toHaveBeenCalledWith(
        '/api/v1/admin/services/neutrino-drive',
        {
          method: 'PATCH',
          body: JSON.stringify({ enabled: true }),
        },
      );
    });

    it('omits undefined fields from the request body', async () => {
      mockRequest.mockResolvedValueOnce(sampleService);
      await adminApi.updateService('my-svc', true, undefined);
      const callArgs = mockRequest.mock.calls[0];
      const body = JSON.parse((callArgs[1] as RequestInit).body as string);
      expect(body).toEqual({ enabled: true });
      expect(body).not.toHaveProperty('autoUpdate');
    });

    it('includes autoUpdate when provided', async () => {
      mockRequest.mockResolvedValueOnce(sampleService);
      await adminApi.updateService('my-svc', undefined, true);
      const callArgs = mockRequest.mock.calls[0];
      const body = JSON.parse((callArgs[1] as RequestInit).body as string);
      expect(body).toEqual({ autoUpdate: true });
      expect(body).not.toHaveProperty('enabled');
    });

    it('encodes the service name in the URL', async () => {
      mockRequest.mockResolvedValueOnce(sampleService);
      await adminApi.updateService('svc with spaces', true);
      expect(mockRequest).toHaveBeenCalledWith(
        '/api/v1/admin/services/svc%20with%20spaces',
        expect.any(Object),
      );
    });
  });

  describe('listUsers', () => {
    it('calls GET /api/v1/admin/users with default pagination', async () => {
      mockRequest.mockResolvedValueOnce(sampleUserList);
      const result = await adminApi.listUsers();
      expect(mockRequest).toHaveBeenCalledWith('/api/v1/admin/users?page=1&pageSize=20');
      expect(result).toEqual(sampleUserList);
    });

    it('passes custom page and pageSize', async () => {
      mockRequest.mockResolvedValueOnce(sampleUserList);
      await adminApi.listUsers(3, 50);
      expect(mockRequest).toHaveBeenCalledWith('/api/v1/admin/users?page=3&pageSize=50');
    });
  });

  describe('getUser', () => {
    it('calls GET /api/v1/admin/users/{userId}', async () => {
      mockRequest.mockResolvedValueOnce(sampleUser);
      const result = await adminApi.getUser('u1');
      expect(mockRequest).toHaveBeenCalledWith('/api/v1/admin/users/u1');
      expect(result).toEqual(sampleUser);
    });
  });

  describe('updateUser', () => {
    it('calls PATCH /api/v1/admin/users/{userId} with updates', async () => {
      mockRequest.mockResolvedValueOnce({ ...sampleUser, role: 'admin' });
      await adminApi.updateUser('u1', { role: 'admin' });
      expect(mockRequest).toHaveBeenCalledWith(
        '/api/v1/admin/users/u1',
        { method: 'PATCH', body: JSON.stringify({ role: 'admin' }) },
      );
    });
  });

  describe('deleteUser', () => {
    it('calls DELETE /api/v1/admin/users/{userId}', async () => {
      mockRequest.mockResolvedValueOnce(undefined);
      await adminApi.deleteUser('u1');
      expect(mockRequest).toHaveBeenCalledWith(
        '/api/v1/admin/users/u1',
        { method: 'DELETE' },
      );
    });
  });
});
