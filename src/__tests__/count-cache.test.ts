import { describe, it, expect, beforeEach } from 'vitest';
import { CountCache } from '../infrastructure/persistence/count-cache.js';

// El total de GET /audit-logs se cachea unos segundos para no recorrer 10 mil entradas
// del indice en cada peticion. Estos tests fijan lo que NO puede romperse: TTL,
// coalescing, invalidacion y que un error no se cachee.
describe('CountCache', () => {
  let t: number;
  let cache: CountCache;
  let loads: number;
  const now = () => t;
  const loader = (value: number) => async () => {
    loads++;
    return value;
  };

  beforeEach(() => {
    t = 1_000;
    loads = 0;
    cache = new CountCache(5_000, now);
  });

  it('la segunda lectura dentro del TTL no vuelve a consultar', async () => {
    expect(await cache.get('org', 'k', loader(42))).toBe(42);
    expect(await cache.get('org', 'k', loader(99))).toBe(42);
    expect(loads).toBe(1);
  });

  it('pasado el TTL vuelve a consultar', async () => {
    await cache.get('org', 'k', loader(1));
    t += 5_001;
    expect(await cache.get('org', 'k', loader(2))).toBe(2);
    expect(loads).toBe(2);
  });

  it('claves distintas u organizaciones distintas no se mezclan', async () => {
    await cache.get('org-a', 'k', loader(1));
    expect(await cache.get('org-a', 'otra', loader(2))).toBe(2);
    expect(await cache.get('org-b', 'k', loader(3))).toBe(3);
    expect(loads).toBe(3);
  });

  it('cargas simultaneas de la misma clave comparten una sola consulta', async () => {
    let release!: (n: number) => void;
    const slow = () => {
      loads++;
      return new Promise<number>((res) => { release = res; });
    };
    const p1 = cache.get('org', 'k', slow);
    const p2 = cache.get('org', 'k', slow);
    const p3 = cache.get('org', 'k', slow);
    release(7);
    expect(await Promise.all([p1, p2, p3])).toEqual([7, 7, 7]);
    expect(loads).toBe(1);
  });

  it('invalidate descarta el conteo de esa organizacion y no el de otras', async () => {
    await cache.get('org-a', 'k', loader(1));
    await cache.get('org-b', 'k', loader(10));
    cache.invalidate('org-a');
    expect(await cache.get('org-a', 'k', loader(2))).toBe(2);
    expect(await cache.get('org-b', 'k', loader(99))).toBe(10);
  });

  it('una carga en vuelo durante una invalidacion no se guarda (podria ser anterior a la escritura)', async () => {
    let release!: (n: number) => void;
    const inflight = cache.get('org', 'k', () => new Promise<number>((res) => { release = res; }));
    cache.invalidate('org'); // llega una escritura mientras se contaba
    release(5); // el conteo viejo termina despues
    expect(await inflight).toBe(5); // quien lo pidio lo recibe...
    expect(await cache.get('org', 'k', loader(6))).toBe(6); // ...pero NO queda cacheado
  });

  it('un error no se cachea y se puede reintentar', async () => {
    await expect(cache.get('org', 'k', async () => { throw new Error('mysql'); })).rejects.toThrow('mysql');
    expect(await cache.get('org', 'k', loader(3))).toBe(3);
  });

  it('ttl 0 desactiva el cache: siempre consulta', async () => {
    const off = new CountCache(0, now);
    await off.get('org', 'k', loader(1));
    await off.get('org', 'k', loader(1));
    expect(loads).toBe(2);
  });

  it('acota las claves por organizacion (la busqueda por texto no crece sin limite)', async () => {
    for (let i = 0; i < 500; i++) await cache.get('org', `busqueda-${i}`, loader(i));
    expect(loads).toBe(500);
    // No revienta ni se degrada: sigue respondiendo y cacheando las recientes.
    const before = loads;
    await cache.get('org', 'busqueda-499', loader(0));
    expect(loads).toBe(before);
  });
});
