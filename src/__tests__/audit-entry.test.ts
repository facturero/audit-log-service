import { describe, expect, it } from 'vitest';
import {
  deriveResourceAndAction,
  deterministicUuidV5,
  extractAuditEntry,
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
    expect(d.userId).toBe('usr-1');
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
});

describe('summarize', () => {
  it('humaniza la acción para el listado', () => {
    expect(summarize('identity.user.role_assigned')).toBe('user role assigned');
  });
});