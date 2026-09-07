import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3012),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DB_HOST: z.string().default('mysql'),
  DB_PORT: z.coerce.number().default(3306),
  DB_USER: z.string().default('root'),
  DB_PASSWORD: z.string().default('root123'),
  DB_NAME: z.string().default('audit_db'),
  RABBITMQ_URL: z.string().default('amqp://rabbitmq:5672'),
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('[config] invalid environment variables:', parsed.error.flatten());
    process.exit(1);
  }
  _config = parsed.data;
  return _config;
}

/**
 * Catálogo de routing keys que la bitácora registra. La cola bindea `#`
 * (catch-all): si llega un evento FUERA de esta lista, la librería lo descarta
 * con un warn ("sin handler") — es la señal de que hay que ampliar el catálogo.
 * Mantener sincronizado con el intercambio publicador (rg "type: 'x.y.z'" en
 * backend/*).
 */
export const AUDITED_EVENTS: readonly string[] = [
  'auth.credential.linked_google',
  'billing.invoice.created',
  'billing.invoice.issued',
  'billing.invoice.voided',
  'customer.customer.created',
  'customer.customer.disabled',
  'customer.customer.updated',
  'identity.pos_device.provisioned',
  'identity.role.updated',
  'identity.user.accepted_invite',
  'identity.user.created',
  'identity.user.disabled',
  'identity.user.enabled',
  'identity.user.invited',
  'identity.user.password_reset_completed',
  'identity.user.password_reset_requested',
  'identity.user.profile_completed',
  'identity.user.role_assigned',
  'organization.billing_point.created',
  'organization.billing_point.paired',
  'organization.billing_point.unlinked',
  'organization.establishment.created',
  'organization.org.updated',
  'plugin.custom_request.created',
  'plugin.custom_request.fulfilled',
  'plugin.custom_request.rejected',
  'product.product.created',
  'product.product.disabled',
  'product.product.updated',
  'tax.country.enabled',
  'tax.country.updated',
  'tax.document_type.upserted',
  'tax.identification_type.upserted',
  'tax.tax_rate.upserted',
];