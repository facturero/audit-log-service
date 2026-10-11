import { beforeAll, describe, expect, it } from 'vitest';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { createApp } from '../interface/http/app.js';

// Telemetría de audit-log-service: ruta con plantilla, quién la hizo y, con un 500, la excepción.
// Se prueba con el SDK real y una aplicación con dependencias de mentira: lo que importa es el cableado de app.ts.
const exporter = new InMemorySpanExporter();
const servidor = () => exporter.getFinishedSpans().filter((s) => s.kind === 1);

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }).register();
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://colector:4318'; // lo que activa el middleware (como en producción)
  const service = {
    list: async () => {
      throw new Error('falla interna');
    },
  };
  app = createApp({ service: service as never, corsOrigin: '' });
});

const headers = { 'x-organization-id': 'org-1', 'x-user-id': 'user-1', 'x-permissions': 'audit:read' };

describe('telemetría', () => {
  it('el span de servidor usa la plantilla de ruta y lleva organización y usuario (los pone el gateway, no el cliente)', async () => {
    exporter.reset();
    const res = await app.request('/health', { headers });
    expect(res.status).toBe(200);
    const spans = servidor();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toContain('/health');
    expect(spans[0].attributes['app.org_id']).toBe('org-1');
    expect(spans[0].attributes['app.user_id']).toBe('user-1');
  });

  it('un 500 deja UNA excepción con su pila y el span en error', async () => {
    exporter.reset();
    const res = await app.request('/audit-logs', { headers });
    expect(res.status).toBe(500);
    const [span] = servidor();
    expect(span.status.code).toBe(2);
    const excepciones = span.events.filter((e) => e.name === 'exception');
    expect(excepciones).toHaveLength(1);
    expect(excepciones[0].attributes?.['exception.stacktrace']).toBeTruthy();
  });
});
