import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | null = null;

export function initTelemetry(): void {
  if (process.env.OTEL_ENABLED !== 'true') return;

  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/$/, '') ??
    'http://localhost:4318/v1/traces';

  const exporter = new OTLPTraceExporter({ url: endpoint });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'overmind-mcp',
      [ATTR_SERVICE_VERSION]: '1.0.0',
    }),
    traceExporter: exporter,
  });

  sdk.start();
}

export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string>,
): Promise<T> {
  const tracer = trace.getTracer('overmind-mcp');
  return tracer.startActiveSpan(name, async (span: Span) => {
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        span.setAttribute(key, value);
      }
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}

export function getTracer() {
  return trace.getTracer('overmind-mcp');
}
