/**
 * Cache en memoria de conteos por organizacion, con TTL corto.
 *
 * Por que existe: GET /audit-logs devuelve `total` con un COUNT acotado (hasta 10.001
 * filas). Acotado o no, recorre 10.001 entradas del indice en cada peticion: ~13 ms
 * de MySQL frente a 1-1,5 ms de la pagina en si; a ~107 RPS son ~1,4 nucleos de MySQL
 * solo contando, mientras Node estaba al 0,79. El total tolera unos segundos de
 * retraso (la bitacora crece sin parar y por encima del tope ya es constante); la
 * pagina nunca se cachea.
 *
 * - Las cargas simultaneas de la misma clave comparten una sola consulta.
 * - No hay invalidacion por escritura: los eventos los inserta otro modulo y el TTL
 *   acota el retraso. `invalidate(org)` existe por si hiciera falta.
 * - Un error no se cachea; una carga en vuelo durante una invalidacion no se guarda.
 * - Acotado: la clave incluye filtros y texto de busqueda, asi que hay un tope de
 *   claves por organizacion para que no crezca sin limite.
 */
const MAX_KEYS_PER_ORG = 200;

interface Entry {
  value: number;
  expiresAt: number;
}

export class CountCache {
  private readonly byOrg = new Map<string, Map<string, Entry>>();
  private readonly generation = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<number>>();

  /** ttlMs <= 0 desactiva el caché: siempre se consulta. */
  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async get(organizationId: string, key: string, load: () => Promise<number>): Promise<number> {
    if (this.ttlMs <= 0) return load();

    const cached = this.byOrg.get(organizationId)?.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value;

    const gen = this.generation.get(organizationId) ?? 0;
    const flightKey = `${organizationId}\u0000${gen}\u0000${key}`;
    const pending = this.inflight.get(flightKey);
    if (pending) return pending;

    const promise = load()
      .then((value) => {
        // Solo se guarda si nadie invalidó la organización mientras se contaba.
        if ((this.generation.get(organizationId) ?? 0) === gen) this.store(organizationId, key, value);
        return value;
      })
      .finally(() => {
        this.inflight.delete(flightKey);
      });
    this.inflight.set(flightKey, promise);
    return promise;
  }

  /** Descarta los conteos cacheados de una organización (llamar tras escribir). */
  invalidate(organizationId: string): void {
    this.byOrg.delete(organizationId);
    this.generation.set(organizationId, (this.generation.get(organizationId) ?? 0) + 1);
  }

  private store(organizationId: string, key: string, value: number): void {
    let entries = this.byOrg.get(organizationId);
    if (!entries) {
      entries = new Map();
      this.byOrg.set(organizationId, entries);
    }
    if (entries.size >= MAX_KEYS_PER_ORG) {
      const t = this.now();
      for (const [k, e] of entries) if (e.expiresAt <= t) entries.delete(k);
      if (entries.size >= MAX_KEYS_PER_ORG) entries.clear();
    }
    entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }
}
