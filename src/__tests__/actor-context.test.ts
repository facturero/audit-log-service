import { describe, expect, it } from 'vitest';
import { getActor, runWithActor, withActor } from '@facturero/outbox-relay';
import { extractAuditEntry } from '../domain/audit-entry.js';

/**
 * El contrato del actor es de la librería, pero es ESTE servicio el que
 * depende de él: sin `actorId`/`actorEmail`/`actorIp` en el payload, la
 * bitácora no puede decir quién hizo cada cosa. Se prueba contra el paquete
 * instalado, no contra el fuente.
 */
describe('contexto de actor', () => {
  it('fuera de una petición no hay actor y el payload no se toca', () => {
    expect(getActor()).toBeUndefined();
    const payload = { invoiceId: 'inv-1' };
    expect(withActor(payload)).toEqual({ invoiceId: 'inv-1' });
  });

  it('inyecta actor, ip y request-id en el payload del evento', () => {
    const out = runWithActor(
      {
        actorId: 'admin-1',
        actorEmail: 'admin@x.com',
        actorIp: '10.0.0.9',
        requestId: 'req-7',
      },
      () => withActor({ invoiceId: 'inv-1' }),
    );
    expect(out).toEqual({
      invoiceId: 'inv-1',
      actorId: 'admin-1',
      actorEmail: 'admin@x.com',
      actorIp: '10.0.0.9',
      requestId: 'req-7',
    });
  });

  it('no pisa lo que el caso de uso puso a mano', () => {
    const out = runWithActor({ actorId: 'del-contexto' }, () =>
      withActor({ actorId: 'del-caso-de-uso' }),
    );
    expect(out.actorId).toBe('del-caso-de-uso');
  });

  it('no inventa claves para valores vacíos', () => {
    const out = runWithActor({ actorId: null, actorEmail: '', actorIp: undefined }, () =>
      withActor({ productId: 'p-1' }),
    );
    // Mejor NULL en la bitácora que una cadena vacía que parece un dato.
    expect(Object.keys(out)).toEqual(['productId']);
  });

  it('sobrevive a los await (el outbox se escribe dentro de una transacción)', async () => {
    const out = await runWithActor({ actorId: 'admin-1' }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return withActor({ customerId: 'c-1' });
    });
    expect(out.actorId).toBe('admin-1');
  });

  it('cierra el círculo: lo que inyecta withActor es lo que lee la bitácora', () => {
    const payload = runWithActor(
      { actorId: 'admin-1', actorEmail: 'admin@x.com', actorIp: '10.0.0.9', requestId: 'req-7' },
      () => withActor({ userId: 'victima-1', organizationId: 'org-1' }),
    );

    const draft = extractAuditEntry({
      routingKey: 'identity.user.disabled',
      eventId: 'evt-1',
      payload: payload as unknown as Record<string, unknown>,
    })!;

    expect(draft.userId).toBe('admin-1');
    expect(draft.actorEmail).toBe('admin@x.com');
    expect(draft.ip).toBe('10.0.0.9');
    expect(draft.requestId).toBe('req-7');
    // Y el usuario afectado sigue siendo el target, no el actor.
    expect(draft.targetId).toBe('victima-1');
  });
});
