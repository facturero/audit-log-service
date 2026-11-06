import { describe, expect, it } from 'vitest';
import { originOf } from '../application/audit-logs.js';

describe('originOf (payload.via)', () => {
  it('devuelve la regla o el formulario que ejecutó el cambio', () => {
    expect(originOf({ via: { type: 'rule', id: 'r1', name: 'Cerrar al terminar' } })).toEqual({ type: 'rule', id: 'r1', name: 'Cerrar al terminar' });
    expect(originOf({ via: { type: 'form' } })).toEqual({ type: 'form', id: null, name: null });
  });

  it('sin via, o con una forma rara, es null: lo hizo la persona y la lista no se rompe', () => {
    expect(originOf(null)).toBeNull();
    expect(originOf({})).toBeNull();
    expect(originOf({ via: 'rule' })).toBeNull();
    expect(originOf({ via: ['rule'] })).toBeNull();
    expect(originOf({ via: { type: '' } })).toBeNull();
    expect(originOf({ via: { type: 42, name: 'x' } })).toBeNull();
  });

  it('recorta lo largo: el payload viene de otro servicio', () => {
    const o = originOf({ via: { type: 'rule', id: 'x'.repeat(100), name: 'n'.repeat(500) } });
    expect(o?.id).toHaveLength(64);
    expect(o?.name).toHaveLength(200);
  });
});
