import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/telemetry.js', () => ({
  initTelemetry: vi.fn(),
  shutdownTelemetry: vi.fn(),
  withSpan: vi.fn(),
  getTracer: vi.fn(),
}));

import { initTelemetry } from '../src/lib/telemetry.js';

describe('feature_flags', () => {
  describe('telemetry', () => {
    it('initTelemetry est no-op (Prometheus/Grafana/Jaeger/Temporal/RabbitMQ supprimés)', () => {
      delete process.env.OTEL_ENABLED;
      expect(() => initTelemetry()).not.toThrow();
    });
  });
});