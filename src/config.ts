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
  /** Días que se conservan las filas. 0 = para siempre (default: una bitácora
   *  no se borra sola sin que alguien lo decida). Con un valor > 0 se purga a
   *  diario lo anterior a esa ventana. */
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(0).default(0),
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
 * Eventos que NO se registran. Antes esto era una lista blanca
 * (`AUDITED_EVENTS`) y la cola bindeaba `#`: todo lo que no estuviera en la
 * lista se descartaba con un warn. Eso hacía que cada evento nuevo del sistema
 * naciera sin auditar sin que nadie se enterase — `plugin.activated`,
 * `plugin.deactivated` y `plugin.created` llevaban meses fuera, y activar o
 * desactivar un módulo de pago es justo lo que una bitácora debe registrar.
 *
 * Ahora se audita TODO lo que pase por el exchange (handler comodín) y esta
 * lista existe solo para callar ruido concreto y demostrado. Quitar de la
 * bitácora es una decisión, no un olvido: cada entrada lleva su porqué.
 *
 * Una entrada que termina en `.` es un PREFIJO (`chat.message.` calla
 * `chat.message.created`, `.updated`…); si no, se compara exacto.
 */
export const AUDIT_DENYLIST: readonly string[] = [
  // Mensajería (chat-service, decisión del dueño 2026-11-14): la bitácora registra solo crear, renombrar y archivar canales.
  // Mensajes, reacciones, entradas y salidas de canales y el «leído» son conversación privada y ruido (uno por mensaje enviado).
  // Los eventos no traen texto, pero sí quién habló con quién y cuándo: tampoco eso es auditoría de la empresa.
  'chat.message.',
  'chat.reaction.',
  'chat.member.',
  'chat.conversation.read',
];

export function isAudited(routingKey: string): boolean {
  return !AUDIT_DENYLIST.some((entry) => (entry.endsWith('.') ? routingKey.startsWith(entry) : routingKey === entry));
}