/**
 * Minimal telemetry stub — no-op since Prometheus/Grafana/Jaeger/Temporal/RabbitMQ removed.
 * Defines a minimal Span-like interface compatible with what runners expect.
 */

export interface MinimalSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(options: { code: number; message?: string }): void;
  end(): void;
  spanContext(): string;
  addEvent(_name: string, _attributes?: Record<string, string | number | boolean>): void;
  recordException(_error: Error): void;
}

// Re-export as 'Span' for compatibility with existing code
export type Span = MinimalSpan;

export function initTelemetry(): void {
  // no-op
}

export async function shutdownTelemetry(): Promise<void> {
  // no-op
}

export async function withSpan<T>(
  _name: string,
  fn: (span: MinimalSpan) => Promise<T>,
  _attributes?: Record<string, string>,
): Promise<T> {
  const noopSpan: MinimalSpan = {
    setAttribute: () => {},
    setStatus: () => {},
    end: () => {},
    spanContext: () => '',
    addEvent: () => {},
    recordException: () => {},
  };
  try {
    return await fn(noopSpan);
  } finally {
    noopSpan.end();
  }
}

export function getTracer() {
  return null;
}
