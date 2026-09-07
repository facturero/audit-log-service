import { Context } from 'hono';
import { z } from 'zod';
import { AuditLogService, AuditLogPageDTO, AuditLogSummaryDTO } from '../../application/audit-logs.js';
import { ContextVariables } from './middlewares.js';

const listQuerySchema = z.object({
  event: z.string().trim().max(200).optional(),
  userId: z.string().trim().max(36).optional(),
  targetId: z.string().trim().max(36).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type AuditLogQueryContext = Context<{ Variables: ContextVariables }>;

function invalidQuery(c: AuditLogQueryContext, error: z.ZodError): Response {
  return c.json(
    {
      error: {
        code: 'INVALID_QUERY',
        message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      },
    },
    400,
  );
}

export function listController(service: AuditLogService) {
  return async (c: AuditLogQueryContext) => {
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return invalidQuery(c, parsed.error);

    const organizationId = c.get('organizationId');
    const page: AuditLogPageDTO = await service.list(organizationId, parsed.data);
    return c.json(page, 200);
  };
}

export function detailController(service: AuditLogService) {
  return async (c: AuditLogQueryContext) => {
    const organizationId = c.get('organizationId');
    const id = c.req.param('id') ?? '';
    const detail = await service.getById(organizationId, id);
    if (!detail) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Evento de auditoría no encontrado' } }, 404);
    }
    return c.json(detail, 200);
  };
}

export function summaryController(service: AuditLogService) {
  return async (c: AuditLogQueryContext) => {
    const raw = {
      from: c.req.query('from'),
      to: c.req.query('to'),
    };
    const parsed = z
      .object({
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
      })
      .safeParse(raw);
    if (!parsed.success) return invalidQuery(c, parsed.error);

    const organizationId = c.get('organizationId');
    const summary: AuditLogSummaryDTO = await service.summary(organizationId, parsed.data);
    return c.json(summary, 200);
  };
}