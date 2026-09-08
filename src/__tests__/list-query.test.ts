import { describe, expect, it } from 'vitest';
import { Op } from 'sequelize';
import { buildAuditWhere, escapeLike, normalizePagination } from '../application/list-query.js';

/** El WHERE es `{ [Op.and]: [...] }`; los tests miran dentro de esa lista. */
function clausesOf(where: Record<PropertyKey, unknown>): Array<Record<PropertyKey, unknown>> {
  return where[Op.and] as Array<Record<PropertyKey, unknown>>;
}

describe('normalizePagination', () => {
  it('por defecto 50 y 0', () => {
    expect(normalizePagination()).toEqual({ limit: 50, offset: 0 });
  });

  it('respeta valores válidos y capea a 500', () => {
    expect(normalizePagination(10, 2)).toEqual({ limit: 10, offset: 2 });
    expect(normalizePagination(5000, -4)).toEqual({ limit: 500, offset: 0 });
  });
});

describe('escapeLike', () => {
  it('neutraliza los comodines de LIKE', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('c:\\tmp')).toBe('c:\\\\tmp');
  });
});

describe('buildAuditWhere', () => {
  it('siempre aísla por organización', () => {
    const clauses = clausesOf(buildAuditWhere('org-1', {}));
    expect(clauses).toEqual([{ organizationId: 'org-1' }]);
  });

  it('sin includePlatform NO se ven los eventos sin tenant', () => {
    const [tenant] = clausesOf(buildAuditWhere('org-1', {}));
    expect(tenant).toEqual({ organizationId: 'org-1' });
    expect(Object.getOwnPropertySymbols(tenant)).toHaveLength(0);
  });

  it('includePlatform amplía a organization_id NULL, nunca a otro tenant', () => {
    const [tenant] = clausesOf(buildAuditWhere('org-1', { includePlatform: true }));
    expect(tenant[Op.or]).toEqual([{ organizationId: 'org-1' }, { organizationId: null }]);
  });

  it('event exacto = igualdad, prefijo con punto final = LIKE', () => {
    const [, exact] = clausesOf(buildAuditWhere('org-1', { event: 'billing.invoice.issued' }));
    expect(exact).toEqual({ event: 'billing.invoice.issued' });

    const [, prefixed] = clausesOf(buildAuditWhere('org-1', { event: 'billing.' }));
    expect(prefixed).toEqual({ event: { [Op.like]: 'billing.%' } });
  });

  it('from/to se combinan como ventana de occurredAt', () => {
    const [, range] = clausesOf(
      buildAuditWhere('org-1', { from: '2026-09-01T00:00:00Z', to: '2026-09-07T00:00:00Z' }),
    );
    const occurred = range.occurredAt as Record<PropertyKey, unknown>;
    // Las claves de Op son symbols: Object.keys() los ignora.
    expect(Object.getOwnPropertySymbols(occurred).map(String).sort()).toEqual([
      'Symbol(gte)',
      'Symbol(lte)',
    ]);
  });

  it('search busca en payload o actor, y escapa los comodines', () => {
    const [, search] = clausesOf(buildAuditWhere('org-1', { search: '50%' }));
    const or = search[Op.or] as Array<Record<string, Record<PropertyKey, string>>>;
    expect(or).toHaveLength(2);
    expect(or[0].payload[Op.like]).toBe('%50\\%%');
    expect(or[1].actorEmail[Op.like]).toBe('%50\\%%');
  });

  it('el filtro de tenant sobrevive junto a un search con Op.or', () => {
    const clauses = clausesOf(buildAuditWhere('org-1', { search: 'factura' }));
    // El bug que evita el Op.and: antes `where[Op.or]` del search y el de
    // includePlatform compartían clave y uno pisaba al otro.
    expect(clauses[0]).toEqual({ organizationId: 'org-1' });
    expect(clauses).toHaveLength(2);
  });
});
