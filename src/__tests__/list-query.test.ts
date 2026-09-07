import { describe, expect, it } from 'vitest';
import { Op } from 'sequelize';
import { buildAuditWhere, normalizePagination } from '../application/list-query.js';

describe('normalizePagination', () => {
  it('por defecto 50 y 0', () => {
    expect(normalizePagination()).toEqual({ limit: 50, offset: 0 });
  });

  it('respeta valores válidos y capea a 500', () => {
    expect(normalizePagination(10, 2)).toEqual({ limit: 10, offset: 2 });
    expect(normalizePagination(5000, -4)).toEqual({ limit: 500, offset: 0 });
  });
});

describe('buildAuditWhere', () => {
  it('siempre aísla por organización', () => {
    const where = buildAuditWhere('org-1', {});
    expect(where).toEqual({ organizationId: 'org-1' });
  });

  it('event exacto = igualdad, prefijo con punto final = LIKE', () => {
    const exact = buildAuditWhere('org-1', { event: 'billing.invoice.issued' });
    expect(exact.event).toBe('billing.invoice.issued');

    const prefixed = buildAuditWhere('org-1', { event: 'billing.' });
    expect(prefixed.event).toEqual({ [Op.like]: 'billing.%' });
  });

  it('from/to se combinan como ventana de occurredAt', () => {
    const { occurredAt } = buildAuditWhere('org-1', {
      from: '2026-09-01T00:00:00Z',
      to: '2026-09-07T00:00:00Z',
    }) as { occurredAt: Record<PropertyKey, unknown> };
    // Las claves de Op sont symbols: Object.keys() los ignora.
    expect(Object.getOwnPropertySymbols(occurredAt).map(String).sort()).toEqual([
      'Symbol(gte)',
      'Symbol(lte)',
    ]);
  });

  it('search busca en payload o actor', () => {
    const where = buildAuditWhere('org-1', { search: 'factura' }) as Record<
      PropertyKey,
      unknown
    > & { [Op.or]: Record<string, unknown>[] };
    expect(Array.isArray(where[Op.or])).toBe(true);
    expect(where[Op.or]).toHaveLength(2);
  });
});