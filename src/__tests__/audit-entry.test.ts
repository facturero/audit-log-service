import { describe, expect, it } from 'vitest';
import {
  deriveResourceAndAction,
  deterministicUuidV5,
  extractAuditEntry,
  redactPayload,
  summarize,
} from '../domain/audit-entry.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('deriveResourceAndAction', () => {
  it('deriva recurso y acción de 3 segmentos', () => {
    expect(deriveResourceAndAction('billing.invoice.issued')).toEqual({
      resource: 'invoice',
      action: 'issued',
    });
  });

  it('recurso con snapshots largos (billing_point) sigue siendo el penúltimo', () => {
    expect(deriveResourceAndAction('organization.billing_point.created')).toEqual({
      resource: 'billing_point',
      action: 'created',
    });
  });

  it('acomoda acciones compuestas (role_assigned)', () => {
    expect(deriveResourceAndAction('identity.user.role_assigned')).toEqual({
      resource: 'user',
      action: 'role_assigned',
    });
  });
});

describe('deterministicUuidV5', () => {
  it('es determinista y tiene formato v5', () => {
    const a = deterministicUuidV5('evt-1:billing.invoice.issued');
    expect(a).toMatch(UUID_RE);
    expect(a).toBe(deterministicUuidV5('evt-1:billing.invoice.issued'));
  });

  it('nombres distintos dan ids distintos', () => {
    expect(deterministicUuidV5('a:event.x')).not.toBe(deterministicUuidV5('b:event.x'));
  });
});

describe('extractAuditEntry', () => {
  const base = {
    routingKey: 'billing.invoice.issued',
    payload: { invoiceId: 'inv-1', organizationId: 'org-1', userId: 'usr-1', totalCents: 100 },
    eventId: 'evt-1',
  };

  it('arma la fila completa con los campos del payload', () => {
    const draft = extractAuditEntry({
      ...base,
      payload: {
        ...base.payload,
        actorId: 'act-1',
        actorEmail: 'a@x.com',
        ip: '1.2.3.4',
        requestId: 'req-1',
        occurredAt: '2026-09-07T14:02:11Z',
      },
    });
    expect(draft).not.toBeNull();
    const d = draft!;
    expect(d.id).toBe(deterministicUuidV5('evt-1:billing.invoice.issued'));
    expect(d.organizationId).toBe('org-1');
    expect(d.userId).toBe('act-1');
    expect(d.actorEmail).toBe('a@x.com');
    expect(d.event).toBe('billing.invoice.issued');
    expect(d.resource).toBe('invoice');
    expect(d.action).toBe('issued');
    expect(d.targetId).toBe('inv-1');
    expect(d.ip).toBe('1.2.3.4');
    expect(d.requestId).toBe('req-1');
    expect(d.occurredAt.toISOString()).toBe('2026-09-07T14:02:11.000Z');
  });

  it('mismo eventId+routingKey → mismo id (idempotencia de fila)', () => {
    const a = extractAuditEntry(base);
    const b = extractAuditEntry({ ...base, payload: { ...base.payload, totalCents: 999 } });
    expect(a!.id).toBe(b!.id);
  });

  it('descarta sin eventId', () => {
    expect(extractAuditEntry({ ...base, eventId: undefined })).toBeNull();
  });

  it('descarta organizationId inválido (presente pero no texto)', () => {
    expect(
      extractAuditEntry({ ...base, payload: { ...base.payload, organizationId: 42 } }),
    ).toBeNull();
  });

  it('sin organizationId = evento de plataforma (org null), pero se registra', () => {
    const { organizationId: _omit, ...rest } = base.payload;
    const draft = extractAuditEntry({ ...base, payload: rest });
    expect(draft).not.toBeNull();
    expect(draft!.organizationId).toBeNull();
  });

  it('fallback de occurredAt a timestamp AMQP (segundos)', () => {
    const draft = extractAuditEntry({ ...base, amqpTimestamp: 1720000000 });
    expect(draft!.occurredAt.getTime()).toBe(1720000000 * 1000);
  });

  it('userId null cuando no viene el actor', () => {
    const goods = { organizationId: 'org-1', invoiceId: 'inv-1' };
    const draft = extractAuditEntry({ ...base, payload: goods });
    expect(draft!.userId).toBeNull();
    expect(draft!.targetId).toBe('inv-1');
  });

  it('NO atribuye la acción al usuario afectado: payload.userId es el target', () => {
    // identity.user.disabled publica el usuario DESACTIVADO en `userId`. Antes
    // acababa en la columna de actor y la bitácora decía que la víctima se
    // desactivó a sí misma.
    const draft = extractAuditEntry({
      routingKey: 'identity.user.disabled',
      eventId: 'evt-9',
      payload: { userId: 'victima-1', organizationId: 'org-1' },
    });
    expect(draft!.userId).toBeNull();
    expect(draft!.targetId).toBe('victima-1');
  });

  it('con actor explícito distingue quién actúa y sobre quién', () => {
    const draft = extractAuditEntry({
      routingKey: 'identity.user.disabled',
      eventId: 'evt-10',
      payload: {
        userId: 'victima-1',
        actorId: 'admin-1',
        actorEmail: 'admin@x.com',
        organizationId: 'org-1',
      },
    });
    expect(draft!.userId).toBe('admin-1');
    expect(draft!.actorEmail).toBe('admin@x.com');
    expect(draft!.targetId).toBe('victima-1');
  });

  it('nunca persiste el enlace de reseteo ni el de invitación', () => {
    const reset = extractAuditEntry({
      routingKey: 'identity.user.password_reset_requested',
      eventId: 'evt-11',
      payload: {
        userId: 'usr-1',
        organizationId: 'org-1',
        resetUrl: 'https://crm.test/restablecer-contrasena?token=SECRETO',
      },
    });
    expect(reset!.payload!.resetUrl).toBe('[redacted]');
    expect(JSON.stringify(reset!.payload)).not.toContain('SECRETO');

    const invite = extractAuditEntry({
      routingKey: 'identity.user.invited',
      eventId: 'evt-12',
      payload: { organizationId: 'org-1', inviteUrl: 'https://crm.test/accept?token=OTRO' },
    });
    expect(JSON.stringify(invite!.payload)).not.toContain('OTRO');
  });
});

describe('redactPayload', () => {
  it('redacta por nombre de clave, a cualquier profundidad', () => {
    const out = redactPayload({
      ok: 'visible',
      apiKey: 'k',
      nested: { password: 'p', deeper: [{ accessToken: 't' }] },
    })!;
    expect(out.ok).toBe('visible');
    expect(out.apiKey).toBe('[redacted]');
    expect((out.nested as any).password).toBe('[redacted]');
    expect((out.nested as any).deeper[0].accessToken).toBe('[redacted]');
  });

  it('redacta por valor un JWT o una URL con token, aunque la clave sea inocente', () => {
    const out = redactPayload({
      nota: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.firma',
      enlace: 'https://x.test/a?token=abc',
      normal: 'https://x.test/factura/1',
    })!;
    expect(out.nota).toBe('[redacted]');
    expect(out.enlace).toBe('[redacted]');
    expect(out.normal).toBe('https://x.test/factura/1');
  });

  it('recorta payloads enormes conservando los escalares de primer nivel', () => {
    const out = redactPayload({
      invoiceId: 'inv-1',
      number: '001-001-1',
      lines: Array.from({ length: 500 }, (_, i) => ({ i, description: 'x'.repeat(50) })),
    })!;
    expect(out._truncated).toBe(true);
    expect(out.invoiceId).toBe('inv-1');
    expect(out.number).toBe('001-001-1');
    expect(out.lines).toBeUndefined();
  });

  it('payload vacío = null', () => {
    expect(redactPayload({})).toBeNull();
  });
});

describe('summarize', () => {
  it('humaniza la acción para el listado', () => {
    expect(summarize('identity.user.role_assigned')).toBe('user role assigned');
  });
});
describe('target_id de los eventos nuevos', () => {
  // Al añadir eventos de catálogo (categorías, unidades, direcciones,
  // contactos, etiquetas, ficheros) sus ids tienen que resolverse como target,
  // o la bitácora dice "se creó algo" sin decir qué.
  it.each([
    ['product.category.created', 'categoryId'],
    ['product.unit.created', 'unitId'],
    ['customer.address.added', 'addressId'],
    ['customer.contact.added', 'contactId'],
    ['customer.tag.created', 'tagId'],
    ['document.file.attached', 'fileId'],
  ])('%s resuelve el target desde %s', (routingKey, key) => {
    const draft = extractAuditEntry({
      routingKey,
      eventId: `evt-${key}`,
      payload: { organizationId: 'org-1', [key]: 'target-123' },
    });
    expect(draft!.targetId).toBe('target-123');
  });
});
