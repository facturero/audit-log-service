import { createMiddleware } from 'hono/factory';

export interface ContextVariables {
  userId: string;
  organizationId: string;
  permissions: string[];
}

/** Aislamiento por tenant: toda ruta de la bitácora exige el contexto de la
 *  organización que inyecta el gateway (X-Organization-Id). El servicio NO
 *  valida JWT: confía en los headers del gateway. */
export function requireOrganization() {
  return createMiddleware(async (c, next) => {
    const orgId = c.req.header('X-Organization-Id');
    if (!orgId) {
      return c.json(
        { error: { code: 'ORG_CONTEXT_REQUIRED', message: 'Falta X-Organization-Id' } },
        400,
      );
    }
    const perms = (c.req.header('X-Permissions') || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    c.set('organizationId', orgId);
    c.set('userId', c.req.header('X-User-Id') || '');
    c.set('permissions', perms);
    await next();
  });
}

/** Gate fino: el permiso debe venir en X-Permissions (el gateway ya reenvía la
 *  lista completa de claim). La capa gruesa está en la ruta del gateway. */
export function requirePermission(permission: string) {
  return createMiddleware(async (c, next) => {
    const permissions = c.get('permissions') as string[];
    if (!permissions.includes(permission) && !permissions.includes('*')) {
      return c.json(
        {
          error: {
            code: 'PERMISSION_DENIED',
            message: `Permiso requerido: ${permission}`,
          },
        },
        403,
      );
    }
    await next();
  });
}