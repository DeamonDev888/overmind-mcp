import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

let sdk: NodeSDK | null = null;

/**
 * Get version from package.json dynamically
 */
function getServiceVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const packagePath = join(__dirname, '../../package.json');
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
    return pkg.version || '1.0.0';
  } catch {
    return '1.0.0'; // Fallback version
  }
}

export function initTelemetry(): void {
  if (process.env.OTEL_ENABLED !== 'true') return;

  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/$/, '') ??
    'http://localhost:4318/v1/traces';

  const exporter = new OTLPTraceExporter({ url: endpoint });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'overmind-mcp',
      [ATTR_SERVICE_VERSION]: getServiceVersion(),
    }),
    traceExporter: exporter,
  });

  sdk.start();
}

/**
 * Gracefully shutdown the telemetry SDK
 */
export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
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
