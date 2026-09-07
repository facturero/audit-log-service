import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../interface/http/app.js';
import { AuditLogService } from '../application/audit-logs.js';

const ORG = 'org-1';
const WITH_PERMS = {
  'X-Organization-Id': ORG,
  'X-Permissions': 'invoice:read, audit:read',
  'X-User-Id': 'usr-1',
  'X-Request-Id': 'req-1',
};

function buildApp(overrides: Partial<AuditLogService> = {}) {
  const service = {
    record: vi.fn(),
    list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 }),
    getById: vi.fn().mockResolvedValue(null),
    summary: vi.fn().mockResolvedValue({ byEvent: [], byUser: [] }),
    ...overrides,
  } as unknown as AuditLogService;
  return createApp({ service, corsOrigin: '*' });
}

describe('HTTP', () => {
  it('/health responde sin auth', async () => {
    const app = buildApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('/audit-logs sin contexto de organización → 400', async () => {
    const app = buildApp();
    const res = await app.request('/audit-logs', {
      headers: { 'X-Permissions': 'invoice:read, audit:read' },
    });
    expect(res.status).toBe(400);
  });

  it('/audit-logs sin audit:read → 403', async () => {
    const app = buildApp();
    const res = await app.request('/audit-logs', {
      headers: { 'X-Organization-Id': ORG, 'X-Permissions': 'invoice:read' },
    });
    expect(res.status).toBe(403);
  });

  it('/audit-logs con el permiso → lista', async () => {
    const app = buildApp();
    const res = await app.request('/audit-logs', { headers: WITH_PERMS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ items: [], total: 0, limit: 50, offset: 0 });
  });

  it('/audit-logs/summary no lo captura la ruta :id', async () => {
    const app = buildApp();
    const res = await app.request('/audit-logs/summary', { headers: WITH_PERMS });
    expect(res.status).toBe(200);
  });

  it('id inexistente → 404', async () => {
    const app = buildApp();
    const res = await app.request('/audit-logs/9f3c2d89-0000-0000-0000-000000000000', {
      headers: WITH_PERMS,
    });
    expect(res.status).toBe(404);
  });

  it('query inválida (limit=0) → 400', async () => {
    const app = buildApp();
    const res = await app.request('/audit-logs?limit=0', { headers: WITH_PERMS });
    expect(res.status).toBe(400);
  });
});